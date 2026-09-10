import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8'));
const graph = parseBrain(ab);
const R = ['ALPN', 'LHN', 'KC', 'MBON', 'DN_L', 'DN_R', 'MN_leg_L', 'MN_leg_R', 'proboscis_L'];
function run(params, inputs, ticks = 400) {
  const b = new Brain(graph, meta, 7, params); b.run(300);
  b.setInputs(inputs); const t0 = Date.now(); const total = b.run(ticks); const ms = (Date.now() - t0) / ticks;
  const r = {}; for (const n of R) r[n] = +(b.rate(n, ticks) * 1000).toFixed(1);
  return { hz: +(total / ticks / graph.N * 1000).toFixed(2), ms: +ms.toFixed(2), ...r };
}
const configs = [];
for (const baseline of [0.02, 0.03, 0.04]) for (const noiseStd of [0.02, 0.04]) for (const inputScale of [0.001, 0.002, 0.004]) configs.push({ baseline, noiseStd, inputScale });
for (const p of configs) {
  const base = run(p, {});
  if (base.hz > 60) { console.log(JSON.stringify(p), 'RUNAWAY base', base.hz, 'Hz'); continue; }
  const L = run(p, { odor_food_L: 0.2 }), Rr = run(p, { odor_food_R: 0.2 });
  console.log(JSON.stringify(p), `${base.ms}ms/tick`, '\n   base', JSON.stringify(base), '\n   foodL', JSON.stringify(L), '\n   foodR', JSON.stringify(Rr), '\n   DN asym L-stim (R-L)=', (L.DN_R - L.DN_L).toFixed(1), ' R-stim (R-L)=', (Rr.DN_R - Rr.DN_L).toFixed(1));
}
