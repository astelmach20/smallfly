import { foodOdor, placeAt } from './world.js';

export const PERSONAS = [
  { name: 'Fig', taste: { sweet: 0.6, ferment: 1.4 }, color: '#ffb347', home: 'oak', sweetTooth: 1.2, sociable: 0.8, timid: 0.7, restless: 1.0, bio: 'Bold forager. Lives for fermenting berries.' },
  { name: 'Plum', taste: { sweet: 1.1, ferment: 0.9 }, color: '#c58cff', home: 'oak', sweetTooth: 0.8, sociable: 1.4, timid: 0.9, restless: 0.8, bio: 'The social one. Follows the smell of other flies.' },
  { name: 'Basil', taste: { sweet: 0.9, ferment: 1.1 }, color: '#7fe08a', home: 'campsite', sweetTooth: 1.0, sociable: 0.6, timid: 1.5, restless: 0.7, bio: 'Nervous. Steers well clear of the river.' },
  { name: 'Clementine', taste: { sweet: 1.5, ferment: 0.5 }, color: '#ff7f50', home: 'campsite', sweetTooth: 1.4, sociable: 1.0, timid: 0.8, restless: 1.2, bio: 'Restless sugar hound. Nectar and spilled sugar only.' },
  { name: 'Pip', taste: { sweet: 1.0, ferment: 1.0 }, color: '#7fd4ff', home: 'easttent', sweetTooth: 0.9, sociable: 1.1, timid: 1.0, restless: 1.3, bio: 'Tiny and twitchy. Lives at the east tent.' },
  { name: 'Juniper', taste: { sweet: 0.5, ferment: 1.4 }, color: '#f5e663', home: 'oak', sweetTooth: 0.7, sociable: 0.9, timid: 1.2, restless: 0.6, bio: 'Calm. Likes the sunning rocks at dusk.' },
];

// Tuning knobs (calibrated with scripts/probe.mjs)
export const TUNE = {
  odorGain: 0.22,       // external current per ORN at full concentration
  contrast: 6.0,        // L/R contrast amplification
  halfConc: 0.55,       // odor saturation constant
  turnGain: 6.0,        // rad/s per unit L/R spike-rate asymmetry (offline sweep, scripts/harness.mjs)
  attrBalance: 1.464,   // L/R per-neuron rate ratio of steer_attr pools under symmetric input (scripts/calib_balance.mjs)
  sweetBalance: 1.06,    // same, sweet channel (filled by calib)
  fermentBalance: 1.001,  // same, ferment channel (filled by calib)
  upwindGain: 1.2,      // surge: while odor drive is rising, bias heading upwind (rad/s per unit trend)
  dangerBalance: 1.15,  // steer_danger pools: bias is ~2.1 at trace levels but ~1.03 at the concentrations that matter (near water)
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
    this.dayLog = { visits: 0, meals: 0, met: {}, spooked: 0 };
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
    let socL = 0, socR = 0;
    for (const f of flies) { if (f === this) continue;
      socL += 0.5 / (1 + ((L[0] - f.x) ** 2 + (L[1] - f.y) ** 2) / 4); socR += 0.5 / (1 + ((R[0] - f.x) ** 2 + (R[1] - f.y) ** 2) / 4); }
    // at night, home smells like company
    if (clock.isNight) { const h = this.homePlace; const hl = 0.9 / (1 + ((L[0] - h.x) ** 2 + (L[1] - h.y) ** 2) / 40), hr = 0.9 / (1 + ((R[0] - h.x) ** 2 + (R[1] - h.y) ** 2) / 40); socL += hl; socR += hr; }
    socL *= this.sociable; socR *= this.sociable;
    const danL = world.sampleDanger(L[0], L[1]) * this.timid, danR = world.sampleDanger(R[0], R[1]) * this.timid;
    const inp = {};
    const amp = (c) => c / (c + TUNE.halfConc);
    const pair = (name, l, r) => {
      const tot = l + r; if (tot < 0.02) return;
      const con = (l - r) / (tot + 1e-6);
      inp[name + '_L'] = TUNE.odorGain * amp(l) * Math.max(0, 1 + TUNE.contrast * con);
      inp[name + '_R'] = TUNE.odorGain * amp(r) * Math.max(0, 1 - TUNE.contrast * con);
    };
    pair('odor_sweet', swL, swR); pair('odor_ferment', feL, feR); pair('odor_social', socL, socR); pair('odor_danger', danL, danR);
    const here = placeAt(world, this.x, this.y);
    if (here && here.kind === 'food' && !here.depleted) { inp.taste_leg_L = inp.taste_leg_R = 0.15 * hungerGain; if (this.state === 'eating') inp.taste_head_L = inp.taste_head_R = 0.2; }
    const side = -(lx * wind.x + ly * wind.y) * wind.speed; // wind hitting right side is positive
    if (Math.abs(side) > 0.05) { if (side > 0) inp.wind_R = 0.08 * side; else inp.wind_L = -0.08 * side; }
    this.inputs = inp; this.raw = { foodL, foodR, swL, swR, feL, feR, socL, socR, danL, danR };
    return inp;
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
    const attr = sw.asym * sw.w + fe.asym * fe.w;   // >0: attractive odor on the left
    const dang = dg.asym * dg.w;                    // >0: danger on the left
    this.turn = TUNE.turnSign * TUNE.turnGain * (-attr + dang);
    // temporal comparison (surge/cast): total attractive drive rising -> run straight, faster, upwind; falling -> cast
    const tot = (sw.tot + fe.tot) / 2;
    const slow = this.attrSlow ?? tot; this.attrSlow = slow * 0.92 + tot * 0.08;
    this.attrTrend = (tot - slow) / (slow + 0.003);
    this.attrRate = tot; this.channels = { sweet: sw, ferment: fe, danger: dg };
    const motor = ((r.MN_leg_L || 0) + (r.MN_leg_R || 0)) / 2 + ((r.wing_L || 0) + (r.wing_R || 0)) / 4;
    this.speedTarget = Math.min(TUNE.speedMax, (TUNE.speedBase + TUNE.speedGain * motor) * (1 + TUNE.surgeGain * Math.max(0, this.attrTrend || 0)));
    this.proboscis = ((r.proboscis_L || 0) + (r.proboscis_R || 0)) / 2;
  }
  // --- body + life state; dt in real seconds; returns feed events
  update(dt, world, flies, clock, wind) {
    const ev = [];
    this.stateT += dt; this.wingPhase += dt * 40;
    const townDt = dt * clock.scale; // town seconds
    this.hunger = Math.min(1, this.hunger + TUNE.hungerRate * townDt / 60 * (this.state === 'sleeping' ? 0.3 : 1));
    const here = placeAt(world, this.x, this.y);
    // sleeping at night when home
    if (clock.isNight && this.state !== 'sleeping' && here && here.id === this.homePlace.id && this.hunger < 0.85) {
      this.state = 'sleeping'; this.stateT = 0; ev.push(this.remember(`Curled up for the night at ${here.name}.`, clock, 'sleep'));
    }
    if (this.state === 'sleeping') {
      this.speed = 0; this.energy = Math.min(1, this.energy + townDt / 3600 * 0.3);
      if (!clock.isNight) { this.state = 'foraging'; this.stateT = 0; ev.push(this.remember(`Woke up at ${this.homePlace.name}, hunger ${(this.hunger * 100) | 0}%.`, clock, 'wake')); ev.push(...this.reflect(clock)); }
      return ev;
    }
    if (this.state === 'eating') {
      this.speed = 0; this.hunger = Math.max(0, this.hunger - townDt / 900);
      if (this.hunger <= 0.05 || this.stateT > 6) {
        this.state = 'foraging'; this.stateT = 0; this.meals++; this.dayLog.meals++;
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
    // feeding decision: on food + hungry + proboscis motor pool active (or hunger very high)
    if (here && here.kind === 'food' && this.hunger > 0.3 && (this.proboscis > TUNE.probEatThresh || this.hunger > 0.9) && this.stateT > 1) {
      this.state = 'eating'; this.stateT = 0; this.speed = 0; this.place = here;
      ev.push(this.remember(`Landed on ${here.food} at ${here.name} and started eating.`, clock, 'meal'));
      return ev;
    }
    // locomotion
    const cast = Math.min(2.5, Math.max(0.15, 1 - TUNE.castGain * (this.attrTrend || 0)));
    const jitter = (Math.random() - 0.5) * TUNE.wanderNoise * this.restless * cast;
    let upwind = 0;
    if ((this.attrTrend || 0) > 0 && wind.speed > 0.05) { // surge: real flies turn upwind when an odor gets stronger
      const target = Math.atan2(-wind.y, -wind.x); const diff = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
      upwind = TUNE.upwindGain * Math.min(1, this.attrTrend) * diff;
    }
    this.heading += (this.turn + jitter + upwind) * dt;
    const sp = this.speedTarget ?? TUNE.speedBase;
    this.speed += (sp - this.speed) * Math.min(1, dt * 4);
    let nx = this.x + Math.cos(this.heading) * this.speed * dt, ny = this.y + Math.sin(this.heading) * this.speed * dt;
    // world bounds: turn around
    if (nx < 0.5 || nx > world.W - 0.5) { this.heading = Math.PI - this.heading; nx = Math.max(0.5, Math.min(world.W - 0.5, nx)); }
    if (ny < 0.5 || ny > world.H - 0.5) { this.heading = -this.heading; ny = Math.max(0.5, Math.min(world.H - 0.5, ny)); }
    this.x = nx; this.y = ny;
    // river: flying over is fine, but a fly that lingers low over water gets wet
    if (world.isWater(this.x, this.y) && this.speed < 1.2 && Math.random() < dt * 0.6) {
      this.state = 'wet'; this.stateT = 0; this.heading += Math.PI; this.dayLog.spooked++;
      ev.push(this.remember('Dipped a wing in the river — scrambled back to the bank, soaked.', clock, 'danger'));
    }
    // spooked by danger cue
    if ((this.raw?.danL + this.raw?.danR) > 1.1 && clock.now - (this.lastSpook || -1e9) > 1800 && Math.random() < dt * 0.3) { this.lastSpook = clock.now; this.dayLog.spooked++; ev.push(this.remember('The smell of the water made me veer away.', clock, 'danger')); }
    // place tracking
    const pid = here && here.kind !== 'water' ? here.id : null;
    if (pid !== (this.place?.id ?? null)) {
      if (here && pid) {
        this.placeT = 0; this.dayLog.visits++;
        const first = !this.visited.has(pid); this.visited.add(pid);
        const why = here.kind === 'food' ? (this.hunger > 0.5 ? ' following the smell' : '') : here.kind === 'home' ? '' : '';
        ev.push(this.remember(`${first ? 'Discovered' : 'Arrived at'} ${here.name}${why}.`, clock, first ? 'discover' : 'visit'));
      }
      this.place = here && pid ? here : null;
    } else this.placeT += dt;
    // meeting other flies
    for (const f of flies) {
      if (f === this || f.id < this.id) continue;
      const d = Math.hypot(f.x - this.x, f.y - this.y);
      const cd = this.metCooldown[f.id] || 0;
      if (d < 1.3 && clock.now - cd > 90) {
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
  reflect(clock) {
    const d = this.dayLog; const met = Object.entries(d.met).sort((a, b) => b[1] - a[1]);
    const bits = [];
    bits.push(`${d.meals} meal${d.meals === 1 ? '' : 's'}`);
    bits.push(`${d.visits} place visit${d.visits === 1 ? '' : 's'}`);
    if (met.length) bits.push(`spent the most time with ${met[0][0]}`); else bits.push('saw nobody');
    if (d.spooked) bits.push(`got spooked ${d.spooked}×`);
    const mood = d.meals === 0 ? 'A hungry day.' : met.length ? 'A good day.' : 'A quiet day.';
    this.dayLog = { visits: 0, meals: 0, met: {}, spooked: 0 };
    return [this.remember(`Reflection on day ${clock.day - 1}: ${bits.join(', ')}. ${mood}`, clock, 'reflect')];
  }
  describeState() {
    if (this.state === 'sleeping') return 'sleeping';
    if (this.state === 'eating') return `eating at ${this.place?.name ?? '?'}`;
    if (this.state === 'wet') return 'shaking off river water';
    const f = this.raw || {}; const food = (f.foodL + f.foodR) || 0, soc = (f.socL + f.socR) || 0, dan = (f.danL + f.danR) || 0;
    if (dan > 0.6) return 'avoiding the water';
    if (food > 0.5 && this.hunger > 0.4) return 'tracking a food smell';
    if (soc > 0.4) return 'drawn to another fly';
    return this.hunger > 0.6 ? 'hungry, searching' : 'wandering';
  }
}

export class TownClock {
  constructor() { this.now = 0; this.scale = 60; this.startHour = 7; this.day = 1; this.paused = false; }
  advance(dt) { if (this.paused) return; const before = this.day; this.now += dt * this.scale; this.day = 1 + Math.floor((this.now / 3600 + this.startHour) / 24); }
  get hour() { return ((this.now / 3600 + this.startHour) % 24); }
  get isNight() { const h = this.hour; return h >= 21 || h < 6; }
  get daylight() { const h = this.hour; if (h < 5 || h >= 22) return 0; if (h < 7) return (h - 5) / 2; if (h < 19) return 1; if (h < 22) return 1 - (h - 19) / 3; return 0; }
  stamp() { const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60); return `Day ${this.day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}
