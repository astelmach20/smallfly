// Is there an input-driven (non-self-sustaining) regime where the antennal lobe carries odor identity?
import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8')); const graph = parseBrain(ab);
const G = meta.groups; const amb = {}; for (const g of Object.keys(G)) if (g.startsWith('odor_')) amb[g] = 0.01;
const T = 300;
const corr = (a, b) => { const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb || 1e-9); };
function probe(inputs, params, seed = 7) {
  const b = new Brain(graph, meta, seed, { ...meta.lif, ...params }); b.setInputs(amb); b.run(400);
  b.setInputs({ ...amb, ...inputs }); b.run(150);
  const acc = new Float32Array(graph.N); let tot = 0; for (let t = 0; t < T; t++) { tot += b.step(); const sp = b.spikes; for (let i = 0; i < graph.N; i++) acc[i] += sp[i]; }
  const hz = (grp) => { const idx = G[grp]; let s = 0; for (const i of idx) s += acc[i]; return s / idx.length / T * 1000; };
  const vec = (grp) => G[grp].map(i => acc[i]);
  const kcActive = G.KC.filter(i => acc[i] / T * 1000 > 10).length / G.KC.length;
  return { spk: tot / T, orn: hz('ORN_attr_L'), pn: hz('ALPN'), kc: hz('KC'), kcFrac: kcActive, mbA: hz('MBON_approach'), mbV: hz('MBON_avoid'), dn: hz('DN_L'), mn: hz('MN_leg_L'), pnVec: vec('ALPN'), kcVec: vec('KC') };
}
const g = 0.066;
for (const c of JSON.parse(process.argv[2])) {
  const B = probe({}, c), S = probe({ odor_sweet_L: g, odor_sweet_R: g }, c), F = probe({ odor_ferment_L: g, odor_ferment_R: g }, c), S2 = probe({ odor_sweet_L: g, odor_sweet_R: g }, c, 11);
  console.log(JSON.stringify(c).padEnd(48), `spk base ${B.spk.toFixed(0)} sweet ${S.spk.toFixed(0)} | ORN ${B.orn.toFixed(0)}->${S.orn.toFixed(0)} PN ${B.pn.toFixed(0)}->${S.pn.toFixed(0)} KC ${B.kc.toFixed(1)}->${S.kc.toFixed(1)} (frac ${S.kcFrac.toFixed(2)}) MBON ${S.mbA.toFixed(0)}/${S.mbV.toFixed(0)} DN ${S.dn.toFixed(1)} MN ${S.mn.toFixed(1)} | PNcorr same ${corr(S.pnVec, S2.pnVec).toFixed(2)} sw/fe ${corr(S.pnVec, F.pnVec).toFixed(2)} sw/base ${corr(S.pnVec, B.pnVec).toFixed(2)} | KCcorr same ${corr(S.kcVec, S2.kcVec).toFixed(2)} sw/fe ${corr(S.kcVec, F.kcVec).toFixed(2)}`);
}
