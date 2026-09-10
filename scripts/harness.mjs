// Offline chemotaxis harness: one fly + one brain + one food source, no canvas. Usage: node scripts/harness.mjs '{"turnGain":2.5}' [seeds] [secs]
import fs from 'node:fs';
import { parseBrain, Brain } from '../public/src/lif.js';
import { Fly, PERSONAS, TUNE, TownClock } from '../public/src/flies.js';
const buf = fs.readFileSync('public/assets/brain.bin'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const meta = JSON.parse(fs.readFileSync('public/assets/brain.json', 'utf8')); const graph = parseBrain(ab);
const over = JSON.parse(process.argv[2] || '{}'); Object.assign(TUNE, over);
const seeds = +(process.argv[3] || 4), secs = +(process.argv[4] || 60);
const garden = { id: 'garden', name: 'Garden Bed', x: 13.5, y: 21.6, r: 3.6, kind: 'food', food: 'tomatoes', strength: 0.7, plume: 6, supply: 1, odor: { sweet: 0.1, ferment: 1.0 } };
const home = { id: 'oak', name: 'Old Oak', x: 19.5, y: 20.6, r: 0.01, kind: 'home' };
const world = { places: [garden, home], W: 45, H: 32, isWater: () => false, sampleDanger: () => 0 };
const wind = { x: 1, y: 0, speed: 0.4 }; const clock = new TownClock(); clock.now = 0;
const READ = ['steer_attr_L','steer_attr_R','steer_sweet_L','steer_sweet_R','steer_ferment_L','steer_ferment_R','steer_danger_L','steer_danger_R','MN_leg_L','MN_leg_R','wing_L','wing_R','proboscis_L','proboscis_R','MBON_approach','MBON_avoid','wind_L','wind_R','GF','groom_DN','song_DN','P1','sleep_FB'];
const pretrain = over.pretrain; delete over.pretrain; // 'punish' | 'reward': pair the garden odor (ferment) with dopamine before the run
const amb = {}; for (const g of Object.keys(meta.groups)) if (g.startsWith('odor_')) amb[g] = 0.01;
let seedRand = 1; const rnd = () => { seedRand = (seedRand * 1103515245 + 12345) & 0x7fffffff; return seedRand / 0x7fffffff; };
Math.random = rnd;
const res = [];
for (let sd = 0; sd < seeds; sd++) {
  seedRand = 17 + sd * 101;
  const b = new Brain(graph, meta, 1000 + sd * 7919, meta.lif); b.setInputs(amb); b.run(1500);
  if (pretrain) for (let k = 0; k < 4; k++) { b.setInputs({ ...amb, odor_ferment_L: 0.12, odor_ferment_R: 0.12, [pretrain === 'punish' ? 'DAN_punish' : 'DAN_reward']: 0.1 }); b.run(600); b.setInputs(amb); b.run(300); }
  const persona = { ...PERSONAS[sd % PERSONAS.length], home: 'oak' };
  const fly = new Fly(persona, world); fly.x = garden.x + 8 + (rnd() - .5); fly.y = garden.y - 1 + (rnd() - .5); fly.heading = rnd() * Math.PI * 2;
  const dt = 1 / 15, ticks = +(process.env.TICKS || 8); let dsum = 0, n = 0, reached = 0, tReach = null;
  for (let t = 0; t < secs; t += dt) {
    fly.hunger = 0.6; fly.sleepPressure = 0; fly.dust = 0; TUNE.probEatThresh = 1e9;
    const inp = fly.sense(world, [fly], wind, clock); const merged = { ...amb }; for (const k in inp) merged[k] = (merged[k] || 0) + inp[k];
    b.setInputs(merged); b.run(ticks); const rates = {}; for (const g of READ) rates[g] = b.rate(g, ticks);
    fly.learn = b.learnStats(); fly.applyRates(rates); fly.update(dt, world, [fly], clock, wind);
    fly.x = Math.max(0.5, Math.min(44.5, fly.x)); fly.y = Math.max(0.5, Math.min(31.5, fly.y));
    if (process.env.DEBUG && n < 6) console.log(n, JSON.stringify({x:fly.x,y:fly.y,h:fly.heading,turn:fly.turn,sp:fly.speedTarget,trend:fly.attrTrend,slow:fly.attrSlow,rate:fly.attrRate,rates}));
    if (Number.isNaN(fly.x) || Number.isNaN(fly.heading)) { console.log('NaN at frame', n, JSON.stringify({turn:fly.turn,sp:fly.speedTarget,trend:fly.attrTrend,slow:fly.attrSlow,rate:fly.attrRate,speed:fly.speed,rates})); process.exit(2); }
    const d = Math.hypot(fly.x - garden.x, fly.y - garden.y); dsum += d; n++; if (d < garden.r) { reached++; if (tReach === null) tReach = t; }
  }
  res.push({ seed: sd, meanDist: dsum / n, inPct: 100 * reached / n, tReach, final: Math.hypot(fly.x - garden.x, fly.y - garden.y), attrHz: (fly.attrRate || 0) * 1000, mbMod: fly.mbMod, learn: b.learnStats() });
}
const avg = k => res.reduce((a, r) => a + (r[k] ?? 0), 0) / res.length;
console.log(JSON.stringify(over), `meanDist=${avg('meanDist').toFixed(2)} inPct=${avg('inPct').toFixed(0)} reachedN=${res.filter(r => r.tReach !== null).length}/${seeds} tReach=${res.map(r => r.tReach === null ? '-' : r.tReach.toFixed(0)).join(',')} attrHz=${avg('attrHz').toFixed(0)} mbMod=${avg('mbMod').toFixed(2)} syn(app/avo)=${res[0].learn.approach.toFixed(2)}/${res[0].learn.avoid.toFixed(2)}`);
