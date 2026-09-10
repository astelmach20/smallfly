import { foodOdor, placeAt } from './world.js';

// Six flies. `taste` scales the two food-odor channels; `sex` decides who courts whom (the wiring is a
// male connectome for everyone — see About). Everything else is personality seasoning on the sensors.
export const PERSONAS = [
  { name: 'Fig', sex: 'm', taste: { sweet: 0.6, ferment: 1.4 }, color: '#ffb347', home: 'oak', sweetTooth: 1.2, sociable: 0.8, timid: 0.7, restless: 1.0, bio: 'Bold forager. Lives for fermenting berries.' },
  { name: 'Plum', sex: 'f', taste: { sweet: 1.1, ferment: 0.9 }, color: '#c58cff', home: 'oak', sweetTooth: 0.8, sociable: 1.4, timid: 0.9, restless: 0.8, bio: 'The social one. Follows the smell of other flies.' },
  { name: 'Basil', sex: 'm', taste: { sweet: 0.9, ferment: 1.1 }, color: '#7fe08a', home: 'campsite', sweetTooth: 1.0, sociable: 0.6, timid: 1.5, restless: 0.7, bio: 'Nervous. Steers well clear of the river.' },
  { name: 'Clementine', sex: 'f', taste: { sweet: 1.5, ferment: 0.5 }, color: '#ff7f50', home: 'campsite', sweetTooth: 1.4, sociable: 1.0, timid: 0.8, restless: 1.2, bio: 'Restless sugar hound. Nectar and spilled sugar only.' },
  { name: 'Pip', sex: 'm', taste: { sweet: 1.0, ferment: 1.0 }, color: '#7fd4ff', home: 'easttent', sweetTooth: 0.9, sociable: 1.1, timid: 1.0, restless: 1.3, bio: 'Tiny and twitchy. Lives at the east tent.' },
  { name: 'Juniper', sex: 'f', taste: { sweet: 0.5, ferment: 1.4 }, color: '#f5e663', home: 'oak', sweetTooth: 0.7, sociable: 0.9, timid: 1.2, restless: 0.6, bio: 'Calm. Likes the sunning rocks at dusk.' },
];

// Tuning knobs (calibrated with scripts/calib_balance.mjs, scripts/harness.mjs, scripts/circuits.mjs)
export const TUNE = {
  odorGain: 0.22,       // external current per ORN at full concentration
  contrast: 6.0,        // L/R contrast amplification
  halfConc: 0.55,       // odor saturation constant
  turnGain: 6.0,        // rad/s per unit L/R spike-rate asymmetry (offline sweep, scripts/harness.mjs)
  attrBalance: 1.464,   // L/R per-neuron rate ratio of steer_attr pools under symmetric input (scripts/calib_balance.mjs)
  sweetBalance: 1.02,   // same, sweet channel (calib, geometric mean over the 0.15-0.4 concentrations that matter)
  fermentBalance: 1.03, // same, ferment channel
  dangerBalance: 1.09,  // steer_danger pools: bias is ~2.1 at trace levels but ~1.03-1.17 at the concentrations that matter (near water)
  windBalance: 0.94,    // Johnston's-organ wind pools (calib)
  upwindGain: 1.2,      // surge: while odor drive is rising, turn toward the side the wind hits (JO L/R readout)
  turnSign: -1,         // sign fixed empirically: flies must turn toward attractive odor, away from water
  speedBase: 0.9,       // tiles/s when motor pools are quiet
  speedGain: 300,       // tiles/s per (spikes/neuron/tick) of leg motor pool
  speedMax: 3.2,
  wanderNoise: 1.2,     // rad/s random heading jitter
  steerFloor: 0.008,    // spikes/ms per neuron (8 Hz) at which L/R steering reaches half weight
  castGain: 6.0,        // run-and-tumble: jitter shrinks while attractive-odor drive is rising, grows while it falls
  surgeGain: 0.8,       // speed boost while odor drive is rising
  probEatThresh: 0.0015,// proboscis pool rate that triggers feeding when on food
  hungerRate: 1 / 240,  // per town-second scaled; ~4 town-hours to get hungry
  // mushroom body: the learned component of the MBON readout for the odor being smelled right now
  // (depression of the active Kenyon cells' approach vs avoid synapses) scales how hard the fly steers toward it
  mbGain: 2.0,
  danReward: 0.08,      // PAM drive while tasting food (sugar reward)
  danCopy: 0.05,        // PAM drive while watching another fly eat something you can smell (social learning)
  danPunish: 0.2,       // PPL1 drive for a few seconds after getting wet / a near miss (PPL1 also responds to odors and taste, so a real punishment has to stand well clear of that)
  // other circuits (thresholds in spikes/ms per neuron; baselines from scripts/circuits.mjs)
  sleepDrive: 0.2,      // external drive on dFB/ExR sleep neurons at full sleep pressure
  sleepOn: 0.085,       // dFB rate above which a fly settles down (85 Hz; ~14 town-hours awake in daylight, less at night)
  sleepOff: 0.04,       // ... and below which it wakes (40 Hz; the circadian term keeps it above this until dawn)
  escapeThresh: 0.06,   // giant fiber rate that fires a jump (60 Hz; baseline is 0, a hand swat drives it to ~170 Hz)
  groomThresh: 0.012,   // DNg11/12 rate that starts grooming (12 Hz; baseline ~1 Hz, dusty bristles ~17-26 Hz)
  songThresh: 0.016,    // pIP10 / vPR6 rate that starts singing (16 Hz; baseline 3-11 Hz depending on company, P1-driven 17-24 Hz)
  p1Thresh: 0.015,      // P1 must itself be firing (15 Hz; baseline 0) — the song DNs alone get some drive from pheromone/social input
  p1Drive: 0.06,        // tonic drive on P1 = courtship drive x pheromone gate (dopamine sets courtship motivation)
};

let nextId = 1;
export class Fly {
  constructor(persona, world) {
    Object.assign(this, persona);
    this.id = nextId++;
    const home = world.places.find(p => p.id === persona.home);
    this.homePlace = home;
    this.x = home.x + (Math.random() - 0.5) * 2; this.y = home.y + (Math.random() - 0.5) * 2;
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 0; this.turn = 0;
    this.hunger = 0.5 + Math.random() * 0.4; this.energy = 1;
    this.state = 'foraging'; this.stateT = 0;
    this.inputs = {}; this.rates = {}; this.pending = false; this.spiked = null; this.simMs = 0; this.tick = 0;
    this.memory = []; this.relationships = {}; this.metCooldown = {};
    this.place = null; this.placeT = 0; this.meals = 0; this.visited = new Set(); this.wingPhase = 0;
    // internal states that drive the new circuits
    this.sleepPressure = 0.2 + Math.random() * 0.3; // homeostat: rises awake, drains asleep
    this.dust = 0;                                  // grooming drive (bristle input)
    this.courtDrive = this.sex === 'm' ? Math.random() * 0.6 : 0;
    this.punishT = 0; this.mate = null; this.singing = false; this.copying = null; this.loom = null;
    this.mbMod = 1; this.learn = null; this.lastReflectDay = 1;
    this.dayLog = { visits: 0, meals: 0, met: {}, spooked: 0, groomed: 0, sang: 0, escaped: 0, learned: 0 };
  }
  remember(text, clock, kind = 'event') {
    this.memory.push({ t: clock.stamp(), text, kind });
    if (this.memory.length > 200) this.memory.shift();
    return { fly: this, text, t: clock.stamp(), kind };
  }
  // --- senses -> external currents on named neuron groups
  sense(world, flies, wind, clock) {
    const nose = 0.35, ear = 0.4;
    const fx = Math.cos(this.heading), fy = Math.sin(this.heading), lx = -fy, ly = fx;
    const L = [this.x + fx * nose + lx * ear, this.y + fy * nose + ly * ear];
    const R = [this.x + fx * nose - lx * ear, this.y + fy * nose - ly * ear];
    const hungerGain = 0.25 + 1.5 * this.hunger; // state-dependent food drive
    const tSw = hungerGain * this.taste.sweet, tFe = hungerGain * this.taste.ferment;
    const swL = foodOdor(world, L[0], L[1], wind, 'sweet') * tSw, swR = foodOdor(world, R[0], R[1], wind, 'sweet') * tSw;
    const feL = foodOdor(world, L[0], L[1], wind, 'ferment') * tFe, feR = foodOdor(world, R[0], R[1], wind, 'ferment') * tFe;
    const foodL = swL + feL, foodR = swR + feR;
    let socL = 0, socR = 0, pfL = 0, pfR = 0, pmL = 0, pmR = 0, loomL = 0, loomR = 0; let loomSrc = null, loomMax = 0; this.copying = null;
    const asleep = this.state === 'sleeping';
    for (const f of flies) { if (f === this) continue;
      const dl2 = (L[0] - f.x) ** 2 + (L[1] - f.y) ** 2, dr2 = (R[0] - f.x) ** 2 + (R[1] - f.y) ** 2;
      socL += 0.5 / (1 + dl2 / 4); socR += 0.5 / (1 + dr2 / 4);
      // cuticular pheromones: females carry 7,11-HD (Or47b/Or88a -> VA1v/VA1d), males carry cVA (Or67d -> DA1)
      if (f.sex === 'f') { pfL += 0.6 / (1 + dl2 / 2); pfR += 0.6 / (1 + dr2 / 2); } else { pmL += 0.6 / (1 + dl2 / 2); pmR += 0.6 / (1 + dr2 / 2); }
      // looming: another fly closing fast (its own escape jump, a dive) is an expanding object on the eye
      const dx = this.x - f.x, dy = this.y - f.y, d = Math.hypot(dx, dy) + 1e-3;
      if (d < 3) { const closing = (dx * Math.cos(f.heading) + dy * Math.sin(f.heading)) / d * f.speed; if (closing > 2.6) { const I = Math.min(1, closing / 3.5) * (1 - d / 3); this.addLoom(dx, dy, I, lx, ly); if (I > loomMax) { loomMax = I; loomSrc = { x: f.x, y: f.y, who: f.name }; } } }
      // social learning: watching a neighbour feed on something you can smell
      if (!asleep && f.state === 'eating' && d < 3 && this.hunger > 0.3 && foodL + foodR > 0.15) this.copying = f;
    }
    // hands / swats from the viewer are looming objects too
    for (const t of world.threats || []) { const dx = this.x - t.x, dy = this.y - t.y, d = Math.hypot(dx, dy) + 1e-3; if (d < 4) { const I = Math.max(0.3, 1 - d / 4); this.addLoom(dx, dy, I, lx, ly); if (I > loomMax) { loomMax = I; loomSrc = { x: t.x, y: t.y, who: 'a hand' }; } } }
    loomL = this._loomL; loomR = this._loomR; this._loomL = this._loomR = 0; this.loom = loomMax > 0 ? loomSrc : null;
    // at night, home smells like company
    if (clock.isNight) { const h = this.homePlace; const hl = 0.9 / (1 + ((L[0] - h.x) ** 2 + (L[1] - h.y) ** 2) / 40), hr = 0.9 / (1 + ((R[0] - h.x) ** 2 + (R[1] - h.y) ** 2) / 40); socL += hl; socR += hr; }
    socL *= this.sociable; socR *= this.sociable;
    const danL = world.sampleDanger(L[0], L[1]) * this.timid, danR = world.sampleDanger(R[0], R[1]) * this.timid;
    const inp = {};
    const amp = (c) => c / (c + TUNE.halfConc);
    const pair = (name, l, r, gain = TUNE.odorGain) => {
      const tot = l + r; if (tot < 0.02) return;
      const con = (l - r) / (tot + 1e-6);
      inp[name + '_L'] = gain * amp(l) * Math.max(0, 1 + TUNE.contrast * con);
      inp[name + '_R'] = gain * amp(r) * Math.max(0, 1 - TUNE.contrast * con);
    };
    pair('odor_sweet', swL, swR); pair('odor_ferment', feL, feR); pair('odor_social', socL, socR); pair('odor_danger', danL, danR);
    pair('phero_female', pfL, pfR); pair('phero_male', pmL, pmR);
    if (loomL + loomR > 0.02) { inp.loom_L = 0.3 * loomL; inp.loom_R = 0.3 * loomR; }
    const here = placeAt(world, this.x, this.y);
    const onFood = here && here.kind === 'food' && !here.depleted && (here.supply ?? 1) > 0.15;
    if (onFood) { inp.taste_leg_L = inp.taste_leg_R = 0.15 * hungerGain; if (this.state === 'eating') inp.taste_head_L = inp.taste_head_R = 0.2; }
    const side = -(lx * wind.x + ly * wind.y) * wind.speed; // wind hitting the +l side (upwind is there) is positive
    if (Math.abs(side) > 0.05) { if (side > 0) inp.wind_R = 0.08 * side; else inp.wind_L = -0.08 * side; }
    if (this.dust > 0.1) inp.bristle = 0.5 * this.dust;
    // sleeping flies keep their antennae but the gain on the world drops (only the eyes stay jumpy)
    if (asleep) for (const k in inp) if (!k.startsWith('loom')) inp[k] *= 0.3;
    // internal drives: circadian clock + sleep homeostat, courtship motivation, dopamine teaching signals
    const night = 1 - clock.daylight;
    inp.clock = 0.1 * night;
    inp.sleep_FB = TUNE.sleepDrive * Math.min(1.2, 0.75 * this.sleepPressure + 0.35 * night);
    if (this.sex === 'm' && !asleep && this.hunger < 0.8) {
      const r = this.rates || {}; const pf = ((r.phero_female_L || 0) + (r.phero_female_R || 0)) / 2; // pheromone gate read from the fly's own ORNs
      const gate = Math.min(1, pf / 0.1); if (gate > 0.05) inp.P1 = TUNE.p1Drive * this.courtDrive * gate;
    }
    let rew = 0;
    if (this.state === 'eating' && this.hunger > 0.15) rew = TUNE.danReward;
    if (this.copying) rew = Math.max(rew, TUNE.danCopy);
    if (rew > 0) inp.DAN_reward = rew;
    if (this.punishT > 0) inp.DAN_punish = TUNE.danPunish;
    this.inputs = inp; this.raw = { foodL, foodR, swL, swR, feL, feR, socL, socR, danL, danR, pfL, pfR, pmL, pmR, loomL, loomR };
    return inp;
  }
  addLoom(dx, dy, I, lx, ly) { // dx,dy: vector from source to this fly. Object on the +l side excites the left eye more.
    const d = Math.hypot(dx, dy) + 1e-3; const s = -(dx * lx + dy * ly) / d; // +1: source on +l side
    this._loomL = (this._loomL || 0) + I * (0.5 + 0.5 * s); this._loomR = (this._loomR || 0) + I * (0.5 - 0.5 * s);
  }
  // --- motor readout -> body commands
  applyRates(raw) {
    // exponential smoothing: short worker windows (4-20 ticks) make small motor pools very noisy
    const r = this.rates || {}; const a = 0.2;
    for (const k in raw) r[k] = (r[k] ?? raw[k]) * (1 - a) + raw[k] * a;
    this.rates = r;
    // steering: decoded side-selective descending neurons (see scripts/decode_steering.mjs)
    // the L and R pools contain different glomerulus mixes, so under symmetric input they fire at different
    // per-neuron rates; divide out that calibrated bias before comparing sides (otherwise every fly circles).
    // Each odor channel is compared separately and weighted by its own drive: no smell -> no steering,
    // because the L/R asymmetry of a near-silent pool is pure noise.
    const chan = (a, b, bal) => { const l = (r[a] || 0) / bal, rr = r[b] || 0; const tot = (l + rr) / 2; return { asym: (l - rr) / (l + rr + 1e-4), tot, w: tot / (tot + TUNE.steerFloor) }; };
    const sw = chan('steer_sweet_L', 'steer_sweet_R', TUNE.sweetBalance);
    const fe = chan('steer_ferment_L', 'steer_ferment_R', TUNE.fermentBalance);
    const dg = chan('steer_danger_L', 'steer_danger_R', TUNE.dangerBalance);
    const tot = (sw.tot + fe.tot) / 2;
    // mushroom body: learned valence of whatever is being smelled right now (see Brain.learnedValence).
    // Depressed KC->approach synapses (punishment) pull it down, depressed KC->avoid synapses (reward) push it up.
    // The raw MBON rates also move with odor concentration (innate valence), so we read the learned part directly.
    const lv = this.learn?.valence ?? 0; this.mbMod = Math.min(2.0, Math.max(0.15, 1 + TUNE.mbGain * lv));
    const attr = (sw.asym * sw.w + fe.asym * fe.w) * this.mbMod;   // >0: attractive odor on the left
    const dang = dg.asym * dg.w;                                    // >0: danger on the left
    this.turn = TUNE.turnSign * TUNE.turnGain * (-attr + dang);
    // temporal comparison (surge/cast): total attractive drive rising -> run straight, faster, upwind; falling -> cast
    const slow = this.attrSlow ?? tot; this.attrSlow = slow * 0.92 + tot * 0.08;
    this.attrTrend = (tot - slow) / (slow + 0.003) * Math.min(1.5, this.mbMod);
    this.attrRate = tot; this.channels = { sweet: sw, ferment: fe, danger: dg };
    // wind direction from the Johnston's organ pools (which antenna is being pushed)
    const wl = (r.wind_L || 0) / TUNE.windBalance, wr = r.wind_R || 0; const ws = wl + wr;
    this.windAsym = ((wr - wl) / (ws + 1e-4)) * (ws / (ws + TUNE.steerFloor));
    const motor = ((r.MN_leg_L || 0) + (r.MN_leg_R || 0)) / 2 + ((r.wing_L || 0) + (r.wing_R || 0)) / 4;
    this.speedTarget = Math.min(TUNE.speedMax, (TUNE.speedBase + TUNE.speedGain * motor) * (1 + TUNE.surgeGain * Math.max(0, this.attrTrend || 0)));
    this.proboscis = ((r.proboscis_L || 0) + (r.proboscis_R || 0)) / 2;
    this.sleepRate = r.sleep_FB || 0; this.gfRate = r.GF || 0; this.groomRate = r.groom_DN || 0; this.songRate = r.song_DN || 0; this.p1Rate = r.P1 || 0;
  }
  // --- body + life state; dt in real seconds; returns feed events
  update(dt, world, flies, clock, wind) {
    const ev = [];
    this.stateT += dt; this.wingPhase += dt * 40;
    const townDt = dt * clock.scale; // town seconds
    const asleep = this.state === 'sleeping';
    this.hunger = Math.min(1, this.hunger + TUNE.hungerRate * townDt / 60 * (asleep ? 0.3 : 1));
    this.sleepPressure = Math.max(0, Math.min(1.2, this.sleepPressure + townDt / 3600 * (asleep ? -1 / 6 : 1 / 14)));
    if (this.sex === 'm' && !asleep) this.courtDrive = Math.min(1, this.courtDrive + townDt / 3600 * 0.25);
    this.punishT = Math.max(0, this.punishT - dt);
    ev.push(...this.noteLearning(clock));
    const here = placeAt(world, this.x, this.y);
    // --- escape: giant fiber fires -> jump away from whatever loomed. Works in any state, wakes sleepers.
    if (this.state !== 'escaping' && this.gfRate > TUNE.escapeThresh && this.loom) {
      const wasAsleep = asleep; this.state = 'escaping'; this.stateT = 0; this.singing = false; this.mate = null;
      this.heading = Math.atan2(this.y - this.loom.y, this.x - this.loom.x) + (Math.random() - 0.5) * 0.6; this.speed = 4.5;
      this.punishT = 1.5; this.dayLog.escaped++; this.dayLog.spooked++;
      ev.push(this.remember(`${this.loom.who === 'a hand' ? 'A hand came down' : this.loom.who + ' came flying straight at me'} — jumped${wasAsleep ? ' awake' : ''} and bolted.`, clock, 'danger'));
    }
    if (this.state === 'escaping') {
      this.speed = Math.max(1.5, this.speed - dt * 4);
      this.move(dt, world);
      if (this.stateT > 0.7) { this.state = 'foraging'; this.stateT = 0; }
      return ev;
    }
    if (asleep) {
      this.speed = 0; this.energy = Math.min(1, this.energy + townDt / 3600 * 0.3);
      if ((this.sleepRate < TUNE.sleepOff && this.stateT > 3) || this.hunger > 0.92) {
        this.state = 'foraging'; this.stateT = 0;
        ev.push(this.remember(`Woke up at ${this.homePlace.name}, hunger ${(this.hunger * 100) | 0}%${clock.isNight ? ' — still dark' : ''}.`, clock, 'wake'));
        if (clock.day > this.lastReflectDay) { this.lastReflectDay = clock.day; ev.push(...this.reflect(clock)); }
      }
      return ev;
    }
    if (this.state === 'eating') {
      this.speed = 0; this.hunger = Math.max(0, this.hunger - townDt / 900);
      if (this.hunger <= 0.05 || this.stateT > 6 || !here || here.kind !== 'food') {
        this.state = 'foraging'; this.stateT = 0; this.meals++; this.dayLog.meals++; this.dust = Math.min(1, this.dust + 0.3);
        if (here && here.kind === 'food') { here.supply = Math.max(0.15, (here.supply ?? 1) - 0.12); }
        ev.push(this.remember(`Finished eating ${here?.food ?? 'something'} at ${here?.name ?? 'somewhere'}. Feeling ${this.hunger < 0.2 ? 'stuffed' : 'better'}.`, clock, 'meal'));
      }
      return ev;
    }
    if (this.state === 'wet') {
      this.speed = 0;
      if (this.stateT > 2.5) { this.state = 'foraging'; this.stateT = 0; }
      return ev;
    }
    if (this.state === 'grooming') {
      this.speed = 0; this.dust = Math.max(0, this.dust - dt / 3);
      if (this.stateT > 3.5 || this.dust <= 0.02) { this.state = 'foraging'; this.stateT = 0; }
      return ev;
    }
    if (this.state === 'courting') {
      const her = this.mate; const d = her ? Math.hypot(her.x - this.x, her.y - this.y) : 99;
      if (!her || d > 4.5 || this.stateT > 12 || her.state === 'sleeping' || her.state === 'escaping') {
        this.state = 'foraging'; this.stateT = 0; this.singing = false; this.mate = null; this.courtDrive *= 0.6;
        ev.push(this.remember(`Lost track of ${her?.name ?? 'her'} mid-song. Ah well.`, clock, 'social')); return ev;
      }
      const target = Math.atan2(her.y - this.y, her.x - this.x); const diff = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
      this.heading += diff * Math.min(1, dt * 6);
      this.singing = d < 1.4 && this.songRate > TUNE.songThresh * 0.6;
      this.speed += ((d < 1.0 ? 0 : Math.min(2.2, d)) - this.speed) * Math.min(1, dt * 4);
      this.move(dt, world);
      this.songT = (this.songT || 0) + (this.singing ? dt : 0);
      if (this.songT > 4) {
        const receptive = her.hunger < 0.7 && clock.now - (her.matedAt ?? -1e9) > 3600 && Math.random() < 0.7;
        this.state = 'foraging'; this.stateT = 0; this.singing = false; this.songT = 0; this.dayLog.sang++;
        if (receptive) { this.courtDrive = 0; this.matedAt = her.matedAt = clock.now; ev.push(this.remember(`Sang to ${her.name} by ${here?.name ?? 'the meadow'} — she stayed. 💛`, clock, 'social')); ev.push(her.remember(`${this.name} sang for me by ${here?.name ?? 'the meadow'}. I stayed.`, clock, 'social')); }
        else { this.courtDrive *= 0.4; ev.push(this.remember(`Sang my best song to ${her.name}. She flicked a wing and left.`, clock, 'social')); ev.push(her.remember(`${this.name} kept singing at me. Not today.`, clock, 'social')); }
        this.relationships[her.name] = (this.relationships[her.name] || 0) + 1; her.relationships[this.name] = (her.relationships[this.name] || 0) + 1;
        this.mate = null;
      }
      return ev;
    }
    // ---- decisions from the foraging state
    if (here && here.kind === 'food' && (here.supply ?? 1) > 0.15 && this.hunger > 0.3 && (this.proboscis > TUNE.probEatThresh || this.hunger > 0.9) && this.stateT > 1) {
      this.state = 'eating'; this.stateT = 0; this.speed = 0; this.place = here;
      const copied = this.copiedFrom && this.copiedFrom.place === here.id ? this.copiedFrom.who : null;
      ev.push(this.remember(`Landed on ${here.food} at ${here.name} and started eating${copied ? ` — ${copied} was right about this place` : ''}.`, clock, 'meal'));
      return ev;
    }
    if (this.sleepRate > TUNE.sleepOn && this.hunger < 0.85 && this.stateT > 2 && ((here && here.id === this.homePlace.id) || this.sleepPressure > 1.0)) {
      this.state = 'sleeping'; this.stateT = 0; this.speed = 0;
      ev.push(this.remember(here && here.id === this.homePlace.id ? `Curled up ${clock.isNight ? 'for the night' : 'for a nap'} at ${here.name}.` : `Too tired to go on — dozed off ${here ? 'at ' + here.name : 'in the grass'}.`, clock, 'sleep'));
      return ev;
    }
    if (this.groomRate > TUNE.groomThresh && this.dust > 0.25 && this.stateT > 1) {
      this.state = 'grooming'; this.stateT = 0; this.speed = 0; this.dayLog.groomed++;
      ev.push(this.remember(this.dust > 0.8 ? 'Soaked. Stopped to groom every bristle dry.' : 'Sticky legs after that meal — stopped to groom.', clock, 'groom'));
      return ev;
    }
    if (this.sex === 'm' && this.p1Rate > TUNE.p1Thresh && this.songRate > TUNE.songThresh && this.stateT > 1) {
      let best = null, bd = 2.5; for (const f of flies) if (f !== this && f.sex === 'f' && f.state !== 'sleeping') { const d = Math.hypot(f.x - this.x, f.y - this.y); if (d < bd) { bd = d; best = f; } }
      if (best) { this.state = 'courting'; this.stateT = 0; this.mate = best; this.songT = 0; ev.push(this.remember(`Caught ${best.name}'s scent — started chasing her, wing out.`, clock, 'social')); return ev; }
    }
    // ---- locomotion
    const cast = Math.min(2.5, Math.max(0.15, 1 - TUNE.castGain * (this.attrTrend || 0)));
    const jitter = (Math.random() - 0.5) * TUNE.wanderNoise * this.restless * cast;
    // surge: when an odor gets stronger, turn toward the side the wind is pushing on (read from the JO pools)
    const upwind = (this.attrTrend || 0) > 0 ? TUNE.upwindGain * Math.min(1, this.attrTrend) * (this.windAsym || 0) : 0;
    this.heading += (this.turn + jitter + upwind) * dt;
    let sp = this.speedTarget ?? TUNE.speedBase;
    // a female hearing a courtship song nearby slows down and listens
    if (this.sex === 'f') for (const f of flies) if (f.singing && f.mate === this) sp *= 0.25;
    this.speed += (sp - this.speed) * Math.min(1, dt * 4);
    this.move(dt, world);
    this.dust = Math.min(1, this.dust + dt * 0.004 * (this.speed > 0.5 ? 1 : 0));
    // river: flying over is fine, but a fly that lingers low over water gets wet
    if (world.isWater(this.x, this.y) && this.speed < 1.2 && Math.random() < dt * 0.6) {
      this.state = 'wet'; this.stateT = 0; this.heading += Math.PI; this.dayLog.spooked++; this.dust = 1; this.punishT = 2;
      ev.push(this.remember('Dipped a wing in the river — scrambled back to the bank, soaked.', clock, 'danger'));
    }
    // spooked by danger cue
    if ((this.raw?.danL + this.raw?.danR) > 1.1 && clock.now - (this.lastSpook || -1e9) > 1800 && Math.random() < dt * 0.3) { this.lastSpook = clock.now; this.dayLog.spooked++; ev.push(this.remember('The smell of the water made me veer away.', clock, 'danger')); }
    // social learning note (the dopamine already went into the brain in sense())
    if (this.copying) { const f = this.copying; const pl = placeAt(world, f.x, f.y); if (pl && (!this.copiedFrom || this.copiedFrom.place !== pl.id || clock.now - this.copiedFrom.t > 1800)) { this.copiedFrom = { place: pl.id, who: f.name, t: clock.now }; this.dayLog.learned++; ev.push(this.remember(`Watched ${f.name} eating at ${pl.name}. That smell is worth remembering.`, clock, 'learn')); } }
    // place tracking
    const pid = here && here.kind !== 'water' ? here.id : null;
    if (pid !== (this.place?.id ?? null)) {
      if (here && pid) {
        this.placeT = 0; this.dayLog.visits++;
        const first = !this.visited.has(pid); this.visited.add(pid);
        const why = here.kind === 'food' ? (this.hunger > 0.5 ? ' following the smell' : '') : '';
        ev.push(this.remember(`${first ? 'Discovered' : 'Arrived at'} ${here.name}${why}.`, clock, first ? 'discover' : 'visit'));
      }
      this.place = here && pid ? here : null;
    } else this.placeT += dt;
    // meeting other flies
    for (const f of flies) {
      if (f === this || f.id < this.id) continue;
      const d = Math.hypot(f.x - this.x, f.y - this.y);
      const cd = this.metCooldown[f.id] || 0;
      if (d < 1.3 && clock.now - cd > 600 && !(this.mate === f || f.mate === this)) {
        this.metCooldown[f.id] = clock.now; f.metCooldown[this.id] = clock.now;
        this.relationships[f.name] = (this.relationships[f.name] || 0) + 1; f.relationships[this.name] = (f.relationships[this.name] || 0) + 1;
        this.dayLog.met[f.name] = (this.dayLog.met[f.name] || 0) + 1; f.dayLog.met[this.name] = (f.dayLog.met[this.name] || 0) + 1;
        const where = here ? `at ${here.name}` : 'in the meadow';
        const n = this.relationships[f.name];
        const tone = n === 1 ? 'for the first time' : n < 4 ? 'again' : n < 8 ? '— we keep running into each other' : '— my closest friend in town';
        ev.push(this.remember(`Bumped into ${f.name} ${where} ${tone}.`, clock, 'social'));
        ev.push(f.remember(`Bumped into ${this.name} ${where} ${tone}.`, clock, 'social'));
      }
    }
    return ev;
  }
  // announce when the mushroom body's opinion of a smell crosses a threshold (the synapses moved; this just says so)
  noteLearning(clock) {
    const by = this.learn?.bySmell; if (!by) return [];
    this.opinion = this.opinion || {}; const out = [];
    const names = { sweet: 'sugary smell', ferment: 'fermenting smell' };
    for (const ch in by) { const v = by[ch]; if (v == null) continue; const was = this.opinion[ch] || 'neutral';
      const now = v < -0.12 ? 'wary' : v > 0.12 ? 'fond' : Math.abs(v) < 0.06 ? 'neutral' : was;
      if (now !== was) { this.opinion[ch] = now; this.dayLog.learned++;
        out.push(this.remember(now === 'wary' ? `That ${names[ch] ?? ch} is starting to feel like trouble.` : now === 'fond' ? `I'm getting a real taste for the ${names[ch] ?? ch}.` : `The ${names[ch] ?? ch} feels ordinary again.`, clock, 'learn')); }
    }
    return out;
  }
  move(dt, world) {
    let nx = this.x + Math.cos(this.heading) * this.speed * dt, ny = this.y + Math.sin(this.heading) * this.speed * dt;
    if (nx < 0.5 || nx > world.W - 0.5) { this.heading = Math.PI - this.heading; nx = Math.max(0.5, Math.min(world.W - 0.5, nx)); }
    if (ny < 0.5 || ny > world.H - 0.5) { this.heading = -this.heading; ny = Math.max(0.5, Math.min(world.H - 0.5, ny)); }
    this.x = nx; this.y = ny;
  }
  reflect(clock) {
    const d = this.dayLog; const met = Object.entries(d.met).sort((a, b) => b[1] - a[1]);
    const bits = [];
    bits.push(`${d.meals} meal${d.meals === 1 ? '' : 's'}`);
    bits.push(`${d.visits} place visit${d.visits === 1 ? '' : 's'}`);
    if (met.length) bits.push(`spent the most time with ${met[0][0]}`); else bits.push('saw nobody');
    if (d.learned) bits.push(`picked up ${d.learned} food tip${d.learned === 1 ? '' : 's'} from the others`);
    if (d.sang) bits.push(`sang ${d.sang}×`);
    if (d.escaped) bits.push(`jumped for my life ${d.escaped}×`); else if (d.spooked) bits.push(`got spooked ${d.spooked}×`);
    if (d.groomed) bits.push(`groomed ${d.groomed}×`);
    const mood = d.meals === 0 ? 'A hungry day.' : d.escaped > 2 ? 'A frightening day.' : met.length ? 'A good day.' : 'A quiet day.';
    this.dayLog = { visits: 0, meals: 0, met: {}, spooked: 0, groomed: 0, sang: 0, escaped: 0, learned: 0 };
    return [this.remember(`Reflection on day ${clock.day - 1}: ${bits.join(', ')}. ${mood}`, clock, 'reflect')];
  }
  describeState() {
    if (this.state === 'sleeping') return 'sleeping';
    if (this.state === 'eating') return `eating at ${this.place?.name ?? '?'}`;
    if (this.state === 'wet') return 'shaking off river water';
    if (this.state === 'grooming') return 'grooming';
    if (this.state === 'escaping') return 'escaping!';
    if (this.state === 'courting') return this.singing ? `singing to ${this.mate?.name ?? '?'}` : `chasing ${this.mate?.name ?? '?'}`;
    const f = this.raw || {}; const food = (f.foodL + f.foodR) || 0, soc = (f.socL + f.socR) || 0, dan = (f.danL + f.danR) || 0;
    if (dan > 0.6) return 'avoiding the water';
    if (this.copying) return `watching ${this.copying.name} eat`;
    if (food > 0.5 && this.hunger > 0.4) return (this.mbMod || 1) < 0.6 ? 'smells food… but remembers' : 'tracking a food smell';
    if (this.sleepPressure > 0.8) return 'sleepy, heading home';
    if (soc > 0.4) return 'drawn to another fly';
    return this.hunger > 0.6 ? 'hungry, searching' : 'wandering';
  }
}

export class TownClock {
  constructor() { this.now = 0; this.scale = 60; this.startHour = 7; this.day = 1; this.paused = false; }
  advance(dt) { if (this.paused) return; this.now += dt * this.scale; this.day = 1 + Math.floor((this.now / 3600 + this.startHour) / 24); }
  get hour() { return ((this.now / 3600 + this.startHour) % 24); }
  get isNight() { const h = this.hour; return h >= 21 || h < 6; }
  get daylight() { const h = this.hour; if (h < 5 || h >= 22) return 0; if (h < 7) return (h - 5) / 2; if (h < 19) return 1; if (h < 22) return 1 - (h - 19) / 3; return 0; }
  stamp() { const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60); return `Day ${this.day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}
