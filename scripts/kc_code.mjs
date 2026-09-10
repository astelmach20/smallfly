import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8')); const graph = parseBrain(ab);
const amb = {}; for (const g of Object.keys(meta.groups)) if (g.startsWith('odor_')) amb[g] = 0.01;
const KC = meta.groups.KC; const T = 300;
function kcSet(inputs, kcMul, seed = 7) {
  const b = new Brain(graph, meta, seed, { ...meta.lif, thresholdMul: { KC: kcMul } }); b.setInputs(amb); b.run(300);
  b.setInputs({ ...amb, ...inputs }); b.run(150);
  const acc = new Float32Array(graph.N); for (let t = 0; t < T; t++) { b.step(); const sp = b.spikes; for (let k = 0; k < KC.length; k++) acc[KC[k]] += sp[KC[k]]; }
  const rates = KC.map(i => acc[i] / T * 1000); const active = new Set(KC.filter((i, k) => rates[k] > 15));
  const mean = rates.reduce((a, r) => a + r, 0) / rates.length;
  return { active, mean, frac: active.size / KC.length, mbA: b.rate('MBON_approach', 150) * 1000, mbV: b.rate('MBON_avoid', 150) * 1000, dan: b.rate('DAN_reward', 150) * 1000 };
}
const jacc = (a, b) => { let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter || 1); };
const g = 0.22 * 0.6 / 2;
for (const mul of [1, 2, 3, 4]) {
  const S = kcSet({ odor_sweet_L: g, odor_sweet_R: g }, mul), F = kcSet({ odor_ferment_L: g, odor_ferment_R: g }, mul), D = kcSet({ odor_danger_L: g, odor_danger_R: g }, mul), B = kcSet({}, mul), S2 = kcSet({ odor_sweet_L: g, odor_sweet_R: g }, mul, 11);
  console.log(`KC thr x${mul}: meanHz base ${B.mean.toFixed(1)} sweet ${S.mean.toFixed(1)} | active frac base ${B.frac.toFixed(3)} sweet ${S.frac.toFixed(3)} | J(sweet,ferment) ${jacc(S.active, F.active).toFixed(2)} J(sweet,danger) ${jacc(S.active, D.active).toFixed(2)} J(sweet,base) ${jacc(S.active, B.active).toFixed(2)} J(sweet,sweet') ${jacc(S.active, S2.active).toFixed(2)} | MBON appr/avoid ${S.mbA.toFixed(1)}/${S.mbV.toFixed(1)} DANrew ${S.dan.toFixed(1)}`);
}
