// Sweep inhibition scale + adaptation for a regime that (a) rests quietly, (b) responds to odor, (c) returns to rest,
// then derive side-selective steering pools and write them (with the chosen LIF params) into brain.json.
import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const metaPath = 'public/assets/brain.json'; const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const graph = parseBrain(ab); const N = graph.N;
const roleOf = meta.role, roles = meta.roles, RI = Object.fromEntries(roles.map((r, i) => [r, i]));
const hz = (b, g, t) => +(b.rate(g, t) * 1000).toFixed(1);
const AMB = {}; for (const k of Object.keys(meta.groups)) if (k.startsWith('odor_')) AMB[k] = 0.015;

function evaluate(P) {
  const b = new Brain(graph, meta, 7, P);
  b.setInputs(AMB); const rest = b.run(400) / 400;                       // ambient-only rest
  b.setInputs({ ...AMB, odor_food_L: 0.2 }); const on = b.run(400) / 400; const resp = { ALPN: hz(b, 'ALPN', 400), LHN: hz(b, 'LHN', 400), KC: hz(b, 'KC', 400), DN: hz(b, 'DN_L', 400), MN: hz(b, 'MN_leg_L', 400), prob: hz(b, 'proboscis_L', 400) };
  b.setInputs({ ...AMB, odor_food_L: 0.3, odor_food_R: 0.3, odor_social_L: 0.2, odor_social_R: 0.2, odor_danger_L: 0.2, taste_leg_L: 0.2, taste_leg_R: 0.2 }); const strong = b.run(400) / 400;
  b.setInputs(AMB); b.run(300); const off = b.run(300) / 300;
  return { rest: +rest.toFixed(0), on: +on.toFixed(0), strong: +strong.toFixed(0), off: +off.toFixed(0), ...resp };
}
function lateralize(P, inL, inR, seeds = [11, 23]) {
  const L = new Float64Array(N), R = new Float64Array(N); const T = 500;
  for (const s of seeds) {
    let b = new Brain(graph, meta, s, P); b.setInputs(AMB); b.run(300); b.setInputs({ ...AMB, ...inL }); b.run(T); for (let i = 0; i < N; i++) L[i] += b.spikeAccum[i];
    b = new Brain(graph, meta, s, P); b.setInputs(AMB); b.run(300); b.setInputs({ ...AMB, ...inR }); b.run(T); for (let i = 0; i < N; i++) R[i] += b.spikeAccum[i];
  }
  const k = 1000 / (seeds.length * T); const sel = { L: {}, R: {} }; const counts = {};
  for (let i = 0; i < N; i++) { const l = L[i] * k, r = R[i] * k; if (l + r < 4) continue; const d = (l - r) / (l + r); const role = roles[roleOf[i]]; if (Math.abs(d) > 0.4) { (sel[d > 0 ? 'L' : 'R'][role] ||= []).push(i); counts[role] = (counts[role] || 0) + 1; } }
  return { sel, counts };
}
const results = [];
for (const inhScale of [1, 2, 3]) for (const adaptB of [0, 0.01, 0.03]) {
  const P = { baseline: 0.03, noiseStd: 0.02, inputScale: 0.002, inhScale, adaptB, adaptTau: 100 };
  const e = evaluate(P); results.push({ P, e });
  console.log(JSON.stringify({ inhScale, adaptB }), JSON.stringify(e));
}
// pick: must return to rest (off <= rest*1.5+20), respond (ALPN >= 30), prefer larger DN/LHN response
const ok = results.filter(r => r.e.off <= r.e.rest * 1.5 + 20 && r.e.ALPN >= 30 && r.e.strong < 1500);
ok.sort((a, b) => (b.e.DN + b.e.LHN / 4) - (a.e.DN + a.e.LHN / 4));
const best = ok[0] || results[0]; console.log('CHOSEN', JSON.stringify(best));
const P = best.P;
const att = lateralize(P, { odor_food_L: 0.2, odor_social_L: 0.2 }, { odor_food_R: 0.2, odor_social_R: 0.2 });
console.log('attractive side-selective counts by role:', JSON.stringify(att.counts));
const pool = (side) => { const dn = att.sel[side].DN || [], lh = att.sel[side].LHN || []; return dn.length >= 12 ? dn : dn.concat(lh).slice(0, 60); };
meta.groups.steer_attr_L = pool('L'); meta.groups.steer_attr_R = pool('R');
meta.groups.steer_danger_L = meta.groups.odor_danger_L; meta.groups.steer_danger_R = meta.groups.odor_danger_R; // reflex readout from the sensory neurons themselves
meta.lif = P; meta.steerSource = { L: meta.groups.steer_attr_L.length, R: meta.groups.steer_attr_R.length, roles: att.counts };
console.log('steer pools', meta.groups.steer_attr_L.length, meta.groups.steer_attr_R.length);
const asym = (b, a, c, t) => (b.rate(a, t) - b.rate(c, t)) / (b.rate(a, t) + b.rate(c, t) + 1e-6);
for (const g of [0.06, 0.12, 0.25]) for (const side of ['L', 'R']) {
  const b = new Brain(graph, meta, 99, P); b.setInputs(AMB); b.run(300); b.setInputs({ ...AMB, ['odor_food_' + side]: g }); b.run(500);
  console.log(`validate food ${side} g=${g}: attr asym(L-R)=${asym(b, 'steer_attr_L', 'steer_attr_R', 500).toFixed(2)} Hz L=${hz(b, 'steer_attr_L', 500)} R=${hz(b, 'steer_attr_R', 500)} MN=${hz(b, 'MN_leg_L', 500)} prob=${hz(b, 'proboscis_L', 500)}`);
}
{ const b = new Brain(graph, meta, 99, P); b.setInputs(AMB); b.run(300); b.setInputs({ ...AMB, odor_food_L: 0.12, odor_food_R: 0.12 }); b.run(500); console.log('validate symmetric food: asym', asym(b, 'steer_attr_L', 'steer_attr_R', 500).toFixed(2)); }
{ const b = new Brain(graph, meta, 99, P); b.setInputs(AMB); b.run(300); b.setInputs({ ...AMB, odor_social_R: 0.15 }); b.run(500); console.log('validate social R: asym', asym(b, 'steer_attr_L', 'steer_attr_R', 500).toFixed(2)); }
{ const b = new Brain(graph, meta, 99, P); b.setInputs(AMB); b.run(300); b.setInputs({ ...AMB, taste_leg_L: 0.15, taste_leg_R: 0.15 }); b.run(500); console.log('taste both: prob', hz(b, 'proboscis_L', 500), 'MN', hz(b, 'MN_leg_L', 500), 'DN', hz(b, 'DN_L', 500)); }
fs.writeFileSync(metaPath, JSON.stringify(meta)); console.log('wrote brain.json');
