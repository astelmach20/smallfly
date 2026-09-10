import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8')); const graph = parseBrain(ab);
const amb = {}; for (const g of Object.keys(meta.groups)) if (g.startsWith('odor_')) amb[g] = 0.01;
const KC = meta.groups.KC, PN = meta.groups.ALPN; const T = 300;
function probe(inputs, params, seed = 7) {
  const b = new Brain(graph, meta, seed, { ...meta.lif, ...params }); b.setInputs(amb); b.run(300);
  b.setInputs({ ...amb, ...inputs }); b.run(150);
  const acc = new Float32Array(graph.N); let tot = 0; for (let t = 0; t < T; t++) { tot += b.step(); const sp = b.spikes; for (let i = 0; i < graph.N; i++) acc[i] += sp[i]; }
  const kcR = KC.map(i => acc[i] / T * 1000), pnR = PN.map(i => acc[i] / T * 1000);
  const active = new Set(KC.filter((i, k) => kcR[k] > 15));
  return { active, kcMean: kcR.reduce((a, r) => a + r, 0) / kcR.length, frac: active.size / KC.length, pn: pnR, spk: tot / T, mbA: b.rate('MBON_approach', 150) * 1000, mbV: b.rate('MBON_avoid', 150) * 1000 };
}
const jacc = (a, b) => { let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter || 1); };
const corr = (a, b) => { const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb || 1); };
const g = 0.22 * 0.6 / 2;
const configs = JSON.parse(process.argv[2]);
for (const c of configs) {
  const S = probe({ odor_sweet_L: g, odor_sweet_R: g }, c), F = probe({ odor_ferment_L: g, odor_ferment_R: g }, c), B = probe({}, c), S2 = probe({ odor_sweet_L: g, odor_sweet_R: g }, c, 11);
  console.log(JSON.stringify(c), `spk/tick ${S.spk.toFixed(0)} KC ${S.kcMean.toFixed(1)}Hz frac ${S.frac.toFixed(3)} | J same ${jacc(S.active, S2.active).toFixed(2)} vs ferment ${jacc(S.active, F.active).toFixed(2)} vs base ${jacc(S.active, B.active).toFixed(2)} | PN corr same ${corr(S.pn, S2.pn).toFixed(2)} vs ferment ${corr(S.pn, F.pn).toFixed(2)} vs base ${corr(S.pn, B.pn).toFixed(2)} | MBON ${S.mbA.toFixed(0)}/${S.mbV.toFixed(0)}`);
}
