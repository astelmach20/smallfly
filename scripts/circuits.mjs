// Baseline rates and input responses of the new circuit pools in the current regime.
import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8')); const graph = parseBrain(ab);
const G = meta.groups; const amb = {}; for (const g of Object.keys(G)) if (g.startsWith('odor_')) amb[g] = 0.01;
const READ = ['P1', 'song_DN', 'wing_L', 'GF', 'escape_DN', 'groom_DN', 'clock', 'sleep_FB', 'MBON_approach', 'MBON_avoid', 'DAN_reward', 'DAN_punish', 'MN_leg_L', 'DN_L'];
function trial(label, inputs, ticks = 300) {
  const b = new Brain(graph, meta, 7, meta.lif); b.setInputs(amb); b.run(400);
  b.setInputs({ ...amb, ...inputs }); b.run(100); b.run(ticks);
  const r = {}; for (const n of READ) r[n] = +(b.rate(n, ticks) * 1000).toFixed(1);
  console.log(label.padEnd(34), JSON.stringify(r));
}
trial('baseline', {});
trial('female pheromone 0.1', { phero_female_L: 0.1, phero_female_R: 0.1 });
trial('female pheromone 0.3', { phero_female_L: 0.3, phero_female_R: 0.3 });
trial('male pheromone cVA 0.3', { phero_male_L: 0.3, phero_male_R: 0.3 });
trial('P1 direct 0.1', { P1: 0.1 });
trial('loom 0.2', { loom_L: 0.2, loom_R: 0.2 });
trial('loom 0.5', { loom_L: 0.5, loom_R: 0.5 });
trial('bristle 0.2', { bristle: 0.2 });
trial('bristle 0.5', { bristle: 0.5 });
trial('clock 0.2', { clock: 0.2 });
trial('sleep_FB 0.2', { sleep_FB: 0.2 });
trial('taste (sugar) 0.2', { taste_leg_L: 0.2, taste_leg_R: 0.2, taste_head_L: 0.2, taste_head_R: 0.2 });
trial('DAN_reward direct 0.1', { DAN_reward: 0.1 });
trial('DAN_punish direct 0.1', { DAN_punish: 0.1 });
