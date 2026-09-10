import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const metaPath = 'public/assets/brain.json'; const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const graph = parseBrain(ab); const N = graph.N; const roles = meta.roles, role = meta.role, side = meta.side;
const idx = (r, s) => { const out = []; const ri = roles.indexOf(r); for (let i = 0; i < N; i++) if (role[i] === ri && side[i] === s) out.push(i); return out; };
for (const r of ['ALPN', 'LHN', 'ALLN', 'KC', 'MBON']) for (const s of 'LR') meta.groups[`${r}_${s}`] = idx(r, s);
meta.groups.ORN_attr_L = meta.groups.odor_food_L.concat(meta.groups.odor_social_L); meta.groups.ORN_attr_R = meta.groups.odor_food_R.concat(meta.groups.odor_social_R);
console.log('sizes', Object.fromEntries(['ALPN_L','ALPN_R','LHN_L','LHN_R','ALLN_L','ALLN_R','ORN_attr_L','ORN_attr_R'].map(k => [k, meta.groups[k].length])));
const P = meta.lif; const hz = (b, g, t) => +(b.rate(g, t) * 1000).toFixed(1);
const asym = (b, a, c, t) => +((b.rate(a, t) - b.rate(c, t)) / (b.rate(a, t) + b.rate(c, t) + 1e-6)).toFixed(2);
const amb = (lvl) => { const o = {}; for (const k of Object.keys(meta.groups)) if (k.startsWith('odor_')) o[k] = lvl; return o; };
for (const lvl of [0.005, 0.01, 0.015]) { const b = new Brain(graph, meta, 3, P); b.setInputs(amb(lvl)); b.run(300); const r = b.run(300) / 300; console.log(`ambient ${lvl}: ${r.toFixed(0)} spk/tick, ALPN ${hz(b,'ALPN',300)} DN ${hz(b,'DN_L',300)} MN ${hz(b,'MN_leg_L',300)} prob ${hz(b,'proboscis_L',300)}`); }
const AMB = amb(0.01);
for (const seed of [5, 77]) for (const g of [0.05, 0.12, 0.25]) for (const side of ['L', 'R']) for (const odor of ['food', 'social']) {
  const b = new Brain(graph, meta, seed, P); b.setInputs(AMB); b.run(300); b.setInputs({ ...AMB, [`odor_${odor}_${side}`]: g }); b.run(400);
  console.log(`seed ${seed} ${odor} ${side} g=${g}: ORN ${asym(b,'ORN_attr_L','ORN_attr_R',400)}  ALPN ${asym(b,'ALPN_L','ALPN_R',400)} (${hz(b,'ALPN_L',400)}/${hz(b,'ALPN_R',400)})  LHN ${asym(b,'LHN_L','LHN_R',400)} (${hz(b,'LHN_L',400)}/${hz(b,'LHN_R',400)})  ALLN ${asym(b,'ALLN_L','ALLN_R',400)}  MN ${hz(b,'MN_leg_L',400)} prob ${hz(b,'proboscis_L',400)}`);
}
{ const b = new Brain(graph, meta, 5, P); b.setInputs(AMB); b.run(300); b.setInputs({ ...AMB, odor_food_L: 0.12, odor_food_R: 0.12 }); b.run(400); console.log('symmetric: ALPN', asym(b,'ALPN_L','ALPN_R',400), 'LHN', asym(b,'LHN_L','LHN_R',400)); }
{ const b = new Brain(graph, meta, 5, P); b.setInputs(AMB); b.run(300); b.setInputs({ ...AMB, taste_leg_L: 0.15, taste_leg_R: 0.15, taste_head_L: 0.15, taste_head_R: 0.15 }); b.run(400); console.log('taste: prob', hz(b,'proboscis_L',400), 'MN', hz(b,'MN_leg_L',400), 'DN', hz(b,'DN_L',400), 'total', (b.run(1)/1).toFixed(0)); }
fs.writeFileSync(metaPath, JSON.stringify(meta)); console.log('wrote side groups');
