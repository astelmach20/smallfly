// Offline decoder: which descending neurons are side-selective for left vs right ORN input?
// Writes steer_* groups into public/assets/brain.json. Also checks the network returns to rest after strong input.
import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const metaPath = 'public/assets/brain.json'; const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const graph = parseBrain(ab);
const P = { baseline: 0.03, noiseStd: 0.02, inputScale: 0.002 };
const G = 0.2, TICKS = 600, SEEDS = [11, 23, 37];
const dnIdx = meta.groups.DN_L.concat(meta.groups.DN_R);
const dnMask = new Uint8Array(graph.N); for (const i of dnIdx) dnMask[i] = 1;

function collect(inputs) {
  const acc = new Float64Array(graph.N);
  for (const s of SEEDS) { const b = new Brain(graph, meta, s, P); b.run(300); b.setInputs(inputs); b.run(TICKS); for (let i = 0; i < graph.N; i++) acc[i] += b.spikeAccum[i]; }
  for (let i = 0; i < graph.N; i++) acc[i] = acc[i] / (SEEDS.length * TICKS) * 1000; // Hz
  return acc;
}
function decode(label, inL, inR) {
  const L = collect(inL), R = collect(inR);
  const selL = [], selR = [];
  for (const i of dnIdx) { const l = L[i], r = R[i]; if (l + r < 3) continue; const d = (l - r) / (l + r); if (d > 0.35) selL.push(i); else if (d < -0.35) selR.push(i); }
  console.log(label, 'side-selective DNs: L', selL.length, 'R', selR.length);
  return { selL, selR };
}
const attr = decode('attractive', { odor_food_L: G, odor_social_L: G }, { odor_food_R: G, odor_social_R: G });
const dang = decode('danger', { odor_danger_L: G }, { odor_danger_R: G });
meta.groups.steer_attr_L = attr.selL; meta.groups.steer_attr_R = attr.selR; meta.groups.steer_danger_L = dang.selL; meta.groups.steer_danger_R = dang.selR;
meta.lif = P;
// validation with unseen seed and gains
function asym(b, a, c, t) { return (b.rate(a, t) - b.rate(c, t)) / (b.rate(a, t) + b.rate(c, t) + 1e-6); }
for (const g of [0.08, 0.2]) for (const side of ['L', 'R']) {
  const b = new Brain(graph, meta, 99, P); b.run(300); b.setInputs({ ['odor_food_' + side]: g }); b.run(500);
  console.log(`validate food ${side} g=${g}: attr asym(L-R)=${asym(b, 'steer_attr_L', 'steer_attr_R', 500).toFixed(2)}  danger asym=${asym(b, 'steer_danger_L', 'steer_danger_R', 500).toFixed(2)}  Hz steerL=${(b.rate('steer_attr_L', 500) * 1000).toFixed(1)} steerR=${(b.rate('steer_attr_R', 500) * 1000).toFixed(1)} MN=${(b.rate('MN_leg_L', 500) * 1000).toFixed(1)}`);
}
for (const side of ['L', 'R']) { const b = new Brain(graph, meta, 99, P); b.run(300); b.setInputs({ ['odor_danger_' + side]: 0.2 }); b.run(500);
  console.log(`validate danger ${side}: danger asym(L-R)=${asym(b, 'steer_danger_L', 'steer_danger_R', 500).toFixed(2)} attr asym=${asym(b, 'steer_attr_L', 'steer_attr_R', 500).toFixed(2)}`); }
// stability: strong mixed input then silence
{ const b = new Brain(graph, meta, 5, P); b.setInputs({ odor_food_L: 0.3, odor_food_R: 0.3, odor_social_L: 0.2, odor_social_R: 0.2, odor_danger_L: 0.2, taste_leg_L: 0.2, taste_leg_R: 0.2 }); const on = b.run(400); b.setInputs({}); const off1 = b.run(300); const off2 = b.run(300);
  console.log('stability: on', (on / 400).toFixed(0), 'spk/tick; off(0-300ms)', (off1 / 300).toFixed(1), '; off(300-600ms)', (off2 / 300).toFixed(1)); }
{ const b = new Brain(graph, meta, 5, P); const amb = {}; for (const k of Object.keys(meta.groups)) if (k.startsWith('odor_')) amb[k] = 0.02; b.setInputs(amb); const r = b.run(600); console.log('ambient 0.02 on all ORNs:', (r / 600).toFixed(1), 'spk/tick', 'DN', (b.rate('DN_L', 600) * 1000).toFixed(1), 'Hz'); }
fs.writeFileSync(metaPath, JSON.stringify(meta));
console.log('wrote', metaPath);
