// Measure per-neuron rate ratio R/L of the steering pools under perfectly symmetric input,
// so the fly can cancel the composition bias (L and R glomerulus mixes differ) before comparing sides.
import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8'));
const graph = parseBrain(ab);
const amb = {}; for (const g of Object.keys(meta.groups)) if (g.startsWith('odor_')) amb[g] = 0.01;
const amp = c => c / (c + 0.55);
const out = {};
for (const [name, grpL, grpR, inL, inR] of [['sweet','steer_sweet_L','steer_sweet_R','odor_sweet_L','odor_sweet_R'], ['ferment','steer_ferment_L','steer_ferment_R','odor_ferment_L','odor_ferment_R'], ['danger','steer_danger_L','steer_danger_R','odor_danger_L','odor_danger_R']]) {
  const ratios = [];
  for (const c of [0.05, 0.15, 0.4, 1.0]) for (const seed of [7, 11]) {
    const b = new Brain(graph, meta, seed, meta.lif); b.setInputs(amb); b.run(300);
    const inp = { ...amb }; inp[inL] = inp[inR] = 0.22 * amp(c); b.setInputs(inp); b.run(200); const T = 300; b.run(T);
    const L = b.rate(grpL, T), R = b.rate(grpR, T); ratios.push(L / R); console.log(name, 'c', c, 'seed', seed, 'L', (L*1000).toFixed(1), 'R', (R*1000).toFixed(1), 'L/R', (L/R).toFixed(3));
  }
  const geo = Math.exp(ratios.reduce((a, r) => a + Math.log(r), 0) / ratios.length); out[name] = +geo.toFixed(3);
}
console.log(JSON.stringify(out)); fs.writeFileSync('data/calib.json', JSON.stringify(out));
