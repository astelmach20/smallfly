// Leaky integrate-and-fire network over the Smallfly MaleCNS subgraph.
// Wiring = measured connectome (MaleCNS v1.0, CC BY 4.0). Dynamics, currents and readouts are modeling choices.
export const DEFAULT_PARAMS = {
  tau: 20, threshold: 1, reset: 0, dt: 1, refractory: 2,
  noiseStd: 0.02, inputScale: 0.002, baseline: 0.03, extGain: 1.0,
  inhScale: 1.0,      // multiplier on inhibitory (GABA/glutamate) synapses
  adaptB: 0.0,        // spike-frequency adaptation increment per spike
  adaptTau: 100,      // adaptation decay (ticks)
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
    // pre-scale inhibitory weights once (copy so the shared buffer stays pristine)
    if (this.params.inhScale !== 1) { const w = new Int16Array(this.weights); for (let j = 0; j < w.length; j++) if (w[j] < 0) w[j] = Math.max(-32767, Math.round(w[j] * this.params.inhScale)); this.weights = w; }
    this.xs = (0x9e3779b9 ^ (seed * 2654435761)) >>> 0 || 1;
    this.ys = (0x85ebca6b ^ (seed * 40503)) >>> 0 || 2;
    for (let i = 0; i < N; i++) this.v[i] = this.rand() * 0.5;
    this.tick = 0;
    this.gauss = GAUSS;
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
    const { N, offsets, targets, weights, syn, v, refr, spikes, ext, spikeAccum, adapt } = this;
    const { tau, threshold, reset, dt, refractory, noiseStd, inputScale, baseline, adaptB, adaptTau } = this.params;
    const adaptDecay = 1 - 1 / adaptTau;
    syn.fill(0);
    for (let i = 0; i < N; i++) {
      if (spikes[i] === 0) continue;
      const b = offsets[i + 1];
      for (let j = offsets[i]; j < b; j++) syn[targets[j]] += weights[j];
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
        if (vi > threshold) { spikes[i] = 1; vi = reset; refr[i] = refractory; count++; spikeAccum[i]++; adapt[i] += adaptB; }
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
