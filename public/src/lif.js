// Leaky integrate-and-fire network over the Smallfly MaleCNS subgraph.
// Wiring = measured connectome (MaleCNS v1.0, CC BY 4.0). Dynamics, currents and readouts are modeling choices.
export const DEFAULT_PARAMS = {
  tau: 20, threshold: 1, reset: 0, dt: 1, refractory: 2,
  noiseStd: 0.02, inputScale: 0.002, baseline: 0.03, extGain: 1.0,
  inhScale: 1.0,      // multiplier on inhibitory (GABA/glutamate) synapses
  adaptB: 0.0,        // spike-frequency adaptation increment per spike
  adaptTau: 100,      // adaptation decay (ticks)
  thresholdMul: {},   // {groupName: multiplier} per-neuron spike threshold scaling (e.g. sparse Kenyon cells)
  // Mushroom-body plasticity (dopamine-gated depression of Kenyon-cell -> MBON synapses).
  // Reward DANs (PAM) depress KC->avoidance-MBON synapses of the KCs active for the current odor;
  // punishment DANs (PPL1) depress KC->approach-MBON synapses. The odor specificity comes from
  // the KC population code; the wiring says which synapses exist. Rates in spikes/ms per neuron.
  learnRate: 0.004,   // depression per (eligibility x dopamine drive) per learning step
  eligTau: 800,       // ticks; how long a KC spike stays eligible (~0.8 s coincidence window)
  danGain: 40,        // scales DAN pool rate *above its running baseline* (spikes/ms/neuron) into a 0..1 dopamine drive
  danBaseTau: 300,    // learning steps (x learnEvery ticks) for the DAN baseline estimate; DANs are tonically active
                      // in this network, so only deviations from baseline count as teaching signals
  danThresh: { reward: 0.01, punish: 0.03 }, // spikes/ms above baseline before a deviation counts; odors alone lift PPL1 by
                      // ~0.02-0.03 (scripts/dan_probe), the injected punishment by ~0.08
  forgetTau: 600000,  // ticks; slow recovery of depressed synapses (~10 sim minutes)
  learnEvery: 10,     // apply the rule every N ticks
  // Feedforward-dominated sensory stages: scale *excitatory* synapses onto a target group that do not
  // come from its canonical feedforward source. The rest of the brain sits in a self-sustained
  // up-state in this LIF model; without this the antennal lobe and calyx just echo that up-state and
  // carry no odor identity. Inhibitory synapses (lateral inhibition, APL) are left untouched.
  feedforward: {},    // {targetGroup: {from: sourceGroup, gain: ffGain, other: recurrentGain}}
};

export function parseBrain(buf) {
  const dv = new DataView(buf);
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 8));
  if (magic !== 'SMALLFLY') throw new Error('bad brain.bin magic');
  const N = dv.getUint32(12, true), E = dv.getUint32(16, true);
  let p = 20;
  const offsets = new Uint32Array(buf, p, N + 1); p += (N + 1) * 4;
  const targets = new Uint16Array(buf, p, E); p += E * 2;
  const weights = new Int16Array(buf, p, E); p += E * 2;
  const soma = new Uint16Array(buf, p, N * 3);
  return { N, E, offsets, targets, weights, soma };
}

// 65536 precomputed standard normals (shared); indexed by a cheap xorshift in the hot loop
const GAUSS = (() => { const t = new Float32Array(65536); let s = 12345 >>> 0;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < 65536; i += 2) { const u1 = r() || 1e-9, u2 = r(), m = Math.sqrt(-2 * Math.log(u1)); t[i] = m * Math.cos(6.283185307179586 * u2); t[i + 1] = m * Math.sin(6.283185307179586 * u2); }
  return t; })();

export class Brain {
  constructor(graph, meta, seed = 1, params = {}) {
    Object.assign(this, graph);
    this.groups = meta.groups;
    this.params = { ...DEFAULT_PARAMS, ...params };
    const N = this.N;
    this.v = new Float32Array(N); this.refr = new Uint8Array(N); this.spikes = new Uint8Array(N);
    this.ext = new Float32Array(N); this.syn = new Float32Array(N); this.spikeAccum = new Uint16Array(N); this.adapt = new Float32Array(N);
    // weights become a float copy with all static scalings baked in (shared buffer stays pristine)
    { const w = new Float32Array(this.weights); const inh = this.params.inhScale;
      if (inh !== 1) for (let j = 0; j < w.length; j++) if (w[j] < 0) w[j] *= inh;
      const ff = this.params.feedforward || {};
      if (Object.keys(ff).length) {
        const tgt = new Int8Array(N).fill(-1), srcOf = []; let k = 0;
        for (const gname in ff) { const idx = meta.groups[gname]; if (!idx) continue; for (const i of idx) tgt[i] = k; const src = new Uint8Array(N); for (const i of (meta.groups[ff[gname].from] || [])) src[i] = 1; srcOf.push({ src, other: ff[gname].other, gain: ff[gname].gain ?? 1 }); k++; }
        for (let i = 0; i < N; i++) for (let j = this.offsets[i]; j < this.offsets[i + 1]; j++) { const g = tgt[this.targets[j]]; if (g >= 0 && w[j] > 0) w[j] *= srcOf[g].src[i] ? srcOf[g].gain : srcOf[g].other; }
      }
      this.weights = w; }
    this.thr = new Float32Array(N).fill(this.params.threshold);
    this.applyThresholds(this.params.thresholdMul);
    this.setupPlasticity();
    this.xs = (0x9e3779b9 ^ (seed * 2654435761)) >>> 0 || 1;
    this.ys = (0x85ebca6b ^ (seed * 40503)) >>> 0 || 2;
    for (let i = 0; i < N; i++) this.v[i] = this.rand() * 0.5;
    this.tick = 0;
    this.gauss = GAUSS;
  }
  // Collect KC->MBON edges once; wmod multiplies their (excitatory) weight, starts at 1, is depressed by learning.
  setupPlasticity() {
    const G = this.groups; const kc = G.KC, app = G.MBON_approach, avo = G.MBON_avoid;
    this.wmod = new Float32Array(this.E).fill(1);
    this.elig = new Float32Array(this.N);
    this.plasticApp = new Uint32Array(0); this.plasticAvo = new Uint32Array(0); this.plasticPre = null;
    if (!kc || !app || !avo) return;
    const isApp = new Uint8Array(this.N), isAvo = new Uint8Array(this.N);
    for (const i of app) isApp[i] = 1; for (const i of avo) isAvo[i] = 1;
    const ea = [], ev = [];
    for (const i of kc) { const b = this.offsets[i + 1]; for (let j = this.offsets[i]; j < b; j++) { if (this.weights[j] <= 0) continue; if (isApp[this.targets[j]]) ea.push(j); else if (isAvo[this.targets[j]]) ev.push(j); } }
    this.plasticApp = Uint32Array.from(ea); this.plasticAvo = Uint32Array.from(ev);
    // presynaptic KC for each plastic edge (binary search over offsets is overkill: build a reverse map once)
    const pre = new Uint16Array(this.E); for (let i = 0; i < this.N; i++) for (let j = this.offsets[i]; j < this.offsets[i + 1]; j++) pre[j] = i;
    this.plasticPre = pre;
    this.dopa = { reward: 0, punish: 0 }; // smoothed dopamine drives (0..1)
    this.danReward = G.DAN_reward || [], this.danPunish = G.DAN_punish || [];
    this.danAcc = { reward: 0, punish: 0 }; // DAN spikes since the last learning step (spikeAccum is per run(), not per window)
  }
  // one learning step: three-factor rule (KC eligibility x dopamine) depresses the matching synapses; slow recovery
  learn() {
    if (!this.plasticPre) return;
    const { learnRate, eligTau, danGain, forgetTau, learnEvery } = this.params;
    const spikes = this.spikes, elig = this.elig, wmod = this.wmod, pre = this.plasticPre;
    // dopamine drives from the DAN pools (spikes in this window / neuron), smoothed
    const win = Math.max(1, this.tick - (this.lastLearnTick ?? (this.tick - learnEvery))); this.lastLearnTick = this.tick;
    const rr = this.danAcc.reward / Math.max(1, this.danReward.length) / win, pp = this.danAcc.punish / Math.max(1, this.danPunish.length) / win;
    this.danAcc.reward = 0; this.danAcc.punish = 0;
    if (this.danBase === undefined) this.danBase = { reward: rr, punish: pp, n: 0 };
    const bt = Math.min(this.params.danBaseTau, 20 + this.danBase.n++); // fast at first, then slow
    this.danBase.reward += (rr - this.danBase.reward) / bt; this.danBase.punish += (pp - this.danBase.punish) / bt;
    const th = this.params.danThresh;
    const rew = Math.min(1, Math.max(0, rr - this.danBase.reward - th.reward) * danGain), pun = Math.min(1, Math.max(0, pp - this.danBase.punish - th.punish) * danGain);
    this.dopa.reward = this.dopa.reward * 0.7 + rew * 0.3; this.dopa.punish = this.dopa.punish * 0.7 + pun * 0.3;
    const recover = learnEvery / forgetTau;
    const dRew = learnRate * this.dopa.reward, dPun = learnRate * this.dopa.punish;
    if (dRew > 1e-5) for (let k = 0; k < this.plasticAvo.length; k++) { const j = this.plasticAvo[k]; const e = elig[pre[j]]; if (e > 0.1) wmod[j] = Math.max(0.05, wmod[j] - dRew * e); }
    if (dPun > 1e-5) for (let k = 0; k < this.plasticApp.length; k++) { const j = this.plasticApp[k]; const e = elig[pre[j]]; if (e > 0.1) wmod[j] = Math.max(0.05, wmod[j] - dPun * e); }
    for (let k = 0; k < this.plasticAvo.length; k++) { const j = this.plasticAvo[k]; wmod[j] += (1 - wmod[j]) * recover; }
    for (let k = 0; k < this.plasticApp.length; k++) { const j = this.plasticApp[k]; wmod[j] += (1 - wmod[j]) * recover; }
  }
  // Learned component of the mushroom-body output for the odor being smelled right now: over the Kenyon cells
  // that are currently active (eligibility trace), how much their approach-MBON synapses have been depressed
  // versus their avoid-MBON synapses. 0 = naive; negative = this smell was punished; positive = rewarded.
  learnedValence() {
    if (!this.plasticPre) return 0;
    const elig = this.elig, wmod = this.wmod, pre = this.plasticPre;
    let sa = 0, na = 0, sv = 0, nv = 0;
    for (let k = 0; k < this.plasticApp.length; k++) { const j = this.plasticApp[k]; const e = elig[pre[j]]; if (e > 0.3) { sa += (wmod[j] - 1) * e; na += e; } }
    for (let k = 0; k < this.plasticAvo.length; k++) { const j = this.plasticAvo[k]; const e = elig[pre[j]]; if (e > 0.3) { sv += (wmod[j] - 1) * e; nv += e; } }
    if (na < 1 || nv < 1) return 0;
    return sa / na - sv / nv;
  }
  // mean synaptic strength of the plastic pathways (1 = naive)
  learnStats() {
    const m = (arr) => { if (!arr.length) return 1; let s = 0; for (let k = 0; k < arr.length; k++) s += this.wmod[arr[k]]; return s / arr.length; };
    return { approach: m(this.plasticApp), avoid: m(this.plasticAvo), valence: this.learnedValence(), reward: this.dopa?.reward ?? 0, punish: this.dopa?.punish ?? 0, edges: this.plasticApp.length + this.plasticAvo.length, base: this.danBase ? { reward: +(this.danBase.reward * 1000).toFixed(1), punish: +(this.danBase.punish * 1000).toFixed(1) } : null };
  }
  applyThresholds(mul) {
    this.thr.fill(this.params.threshold);
    for (const name in mul || {}) { const idx = this.groups[name]; if (!idx) continue; for (let k = 0; k < idx.length; k++) this.thr[idx[k]] = this.params.threshold * mul[name]; }
  }
  rand() { // xorshift64-ish on two 32-bit words
    let x = this.xs, y = this.ys;
    x ^= x << 23; x >>>= 0; x ^= x >>> 17; x ^= y ^ (y >>> 26);
    this.xs = y; this.ys = x >>> 0;
    return ((this.xs + this.ys) >>> 0) / 4294967296;
  }
  setInputs(inputs) { // {groupName: current}
    this.ext.fill(0);
    const g = this.params.extGain;
    for (const name in inputs) {
      const idx = this.groups[name]; if (!idx) continue;
      const c = inputs[name] * g;
      for (let k = 0; k < idx.length; k++) this.ext[idx[k]] += c;
    }
  }
  step() {
    const { N, offsets, targets, weights, syn, v, refr, spikes, ext, spikeAccum, adapt, thr, wmod, elig } = this;
    const { tau, reset, dt, refractory, noiseStd, inputScale, baseline, adaptB, adaptTau, eligTau, learnEvery } = this.params;
    const adaptDecay = 1 - 1 / adaptTau, eligDecay = 1 - 1 / eligTau;
    syn.fill(0);
    const kc = this.groups.KC;
    for (let i = 0; i < N; i++) {
      if (spikes[i] === 0) continue;
      const b = offsets[i + 1];
      for (let j = offsets[i]; j < b; j++) syn[targets[j]] += weights[j] * wmod[j];
    }
    if (kc && this.plasticPre) {
      for (let k = 0; k < kc.length; k++) { const i = kc[k]; elig[i] = spikes[i] ? 1 : elig[i] * eligDecay; }
      let r = 0, p = 0; const dr = this.danReward, dp = this.danPunish; for (let k = 0; k < dr.length; k++) r += spikes[dr[k]]; for (let k = 0; k < dp.length; k++) p += spikes[dp[k]];
      this.danAcc.reward += r; this.danAcc.punish += p;
      if (this.tick % learnEvery === 0) this.learn();
    }
    const invTau = 1 / tau; let count = 0;
    const gauss = this.gauss; let gs = this.xs | 1;
    for (let i = 0; i < N; i++) {
      const can = refr[i] === 0;
      let vi = v[i];
      if (can) {
        gs ^= gs << 13; gs ^= gs >>> 17; gs ^= gs << 5;
        const noise = gauss[gs & 65535] * noiseStd;
        vi += (-vi * invTau + syn[i] * inputScale + ext[i] + noise + baseline - adapt[i]) * dt;
        if (vi > thr[i]) { spikes[i] = 1; vi = reset; refr[i] = refractory; count++; spikeAccum[i]++; adapt[i] += adaptB; }
        else spikes[i] = 0;
      } else { spikes[i] = 0; refr[i]--; }
      adapt[i] *= adaptDecay;
      v[i] = vi > 2 ? 2 : vi < -2 ? -2 : vi;
    }
    this.xs = gs >>> 0; this.ys = (this.ys + 0x9e3779b9) >>> 0;
    this.tick++;
    return count;
  }
  run(ticks) { this.spikeAccum.fill(0); let t = 0; for (let k = 0; k < ticks; k++) t += this.step(); return t; }
  rate(name, ticks) { // mean spikes per neuron per tick in the last run()
    const idx = this.groups[name]; if (!idx || !idx.length) return 0;
    let s = 0; for (let k = 0; k < idx.length; k++) s += this.spikeAccum[idx[k]];
    return s / (idx.length * ticks);
  }
  spikedIndices() { const out = []; const a = this.spikeAccum; for (let i = 0; i < a.length; i++) if (a[i]) out.push(i); return Uint16Array.from(out); }
}
