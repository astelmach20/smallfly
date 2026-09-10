import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8'));
const graph = parseBrain(ab);
const amb = {}; for (const g of Object.keys(meta.groups)) if (g.startsWith('odor_')) amb[g] = 0.01;
const amp = c => c / (c + 0.55);
for (const c of [0.1, 0.3, 1.0]) for (const con of [-0.3, -0.1, 0, 0.1, 0.3]) {
  const b = new Brain(graph, meta, 7, meta.lif); b.setInputs(amb); b.run(300);
  const inp = { ...amb }; inp.odor_food_L = 0.22 * amp(c) * Math.max(0, 1 + 2 * con); inp.odor_food_R = 0.22 * amp(c) * Math.max(0, 1 - 2 * con);
  b.setInputs(inp); b.run(200); const T = 200; b.run(T);
  const L = b.rate('steer_attr_L', T) * 1000, R = b.rate('steer_attr_R', T) * 1000, dL = b.rate('DN_L', T) * 1000, dR = b.rate('DN_R', T) * 1000, ml = b.rate('MN_leg_L', T)*1000, mr = b.rate('MN_leg_R', T)*1000;
  console.log(`c=${c} con=${con}`.padEnd(18), `inL=${inp.odor_food_L.toFixed(3)} inR=${inp.odor_food_R.toFixed(3)}`, `ORN_attr L=${L.toFixed(1)} R=${R.toFixed(1)} asym=${((L - R) / (L + R + 1e-4)).toFixed(3)}`, `DN ${dL.toFixed(1)}/${dR.toFixed(1)} MNleg ${ml.toFixed(1)}/${mr.toFixed(1)}`);
}
