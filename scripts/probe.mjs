// Node calibration probe: which side's descending neurons respond to left-only odor? What are typical rates?
import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8'));
const graph = parseBrain(ab);
console.log('N', graph.N, 'E', graph.E);
const readouts = ['DN_L', 'DN_R', 'MN_leg_L', 'MN_leg_R', 'proboscis_L', 'proboscis_R', 'wing_L', 'wing_R', 'KC', 'MBON', 'DAN', 'LHN', 'ALPN'];
function trial(label, inputs, ticks = 400, params = {}) {
  const b = new Brain(graph, meta, 7, params);
  b.setInputs({}); b.run(300); // settle
  b.setInputs(inputs); const t0 = Date.now(); const total = b.run(ticks); const ms = Date.now() - t0;
  const r = {}; for (const n of readouts) r[n] = +(b.rate(n, ticks) * 1000).toFixed(2); // spikes/s per neuron
  console.log(label.padEnd(26), 'spk/tick', (total / ticks).toFixed(0), `${(ms / ticks).toFixed(2)}ms/tick`, JSON.stringify(r));
}
trial('baseline', {});
for (const g of [0.05, 0.1, 0.2, 0.4]) trial(`food L only g=${g}`, { odor_food_L: g });
trial('food R only g=0.2', { odor_food_R: 0.2 });
trial('social L g=0.2', { odor_social_L: 0.2 });
trial('danger L g=0.2', { odor_danger_L: 0.2 });
trial('taste both g=0.2', { taste_leg_L: 0.2, taste_leg_R: 0.2, taste_head_L: 0.2, taste_head_R: 0.2 });
trial('wind L g=0.2', { wind_L: 0.2 });
trial('baseline low drive', {}, 400, { baseline: 0.03 });
trial('baseline hi drive', {}, 400, { baseline: 0.07 });
