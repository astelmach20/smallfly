// Mushroom-body learning test: pair one odor with punishment (PPL1) or reward (PAM) and check that the
// MBON valence readout for THAT odor shifts more than for the other odor.
import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8')); const graph = parseBrain(ab);
const extra = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const amb = {}; for (const g of Object.keys(meta.groups)) if (g.startsWith('odor_')) amb[g] = 0.01;
const odor = (ch, c = 0.12) => ({ ...amb, [`odor_${ch}_L`]: c, [`odor_${ch}_R`]: c });
const b = new Brain(graph, meta, 11, { ...meta.lif, ...extra });
b.setInputs(amb); b.run(400);
function valence(ch) { b.setInputs(odor(ch)); b.run(150); const T = 400; b.run(T); const ap = b.rate('MBON_approach', T) * 1000, av = b.rate('MBON_avoid', T) * 1000; const lv = b.learnedValence(); b.setInputs(amb); b.run(200); return { ap: +ap.toFixed(1), av: +av.toFixed(1), v: +(ap - av).toFixed(1), lv: +lv.toFixed(3) }; }
const pre = { sweet: valence('sweet'), ferment: valence('ferment') };
console.log('before   sweet', JSON.stringify(pre.sweet), 'ferment', JSON.stringify(pre.ferment), 'learn', JSON.stringify(b.learnStats()));
const mode = process.argv[3] || 'punish';
for (let k = 0; k < 4; k++) { b.setInputs({ ...odor('sweet'), [mode === 'punish' ? 'DAN_punish' : 'DAN_reward']: mode === 'punish' ? 0.2 : 0.1 }); b.run(600); b.setInputs(amb); b.run(300); }
const post = { sweet: valence('sweet'), ferment: valence('ferment') };
console.log(`after ${mode} sweet`, JSON.stringify(post.sweet), 'ferment', JSON.stringify(post.ferment), 'learn', JSON.stringify(b.learnStats()));
console.log('delta MBON valence  sweet', (post.sweet.v - pre.sweet.v).toFixed(1), ' ferment', (post.ferment.v - pre.ferment.v).toFixed(1), '| learned valence sweet', post.sweet.lv, 'ferment', post.ferment.lv);
