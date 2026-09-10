import { loadTown, foodOdor } from './world.js';
import { Fly, PERSONAS, TownClock, TUNE } from './flies.js';
import { UI } from './ui.js';

const READOUTS = ['DN_L', 'DN_R', 'MN_leg_L', 'MN_leg_R', 'wing_L', 'wing_R', 'proboscis_L', 'proboscis_R', 'KC', 'MBON', 'steer_attr_L', 'steer_attr_R', 'steer_danger_L', 'steer_danger_R'];
const canvas = document.getElementById('town'); const ctx = canvas.getContext('2d');
const loadingMsg = document.getElementById('loading-msg'), loadingBar = document.getElementById('loading-bar');
const setLoad = (p, msg) => { loadingBar.style.width = (p * 100) + '%'; if (msg) loadingMsg.textContent = msg; };

async function fetchProgress(url, onProgress) {
  const res = await fetch(url); const total = +res.headers.get('content-length') || 0; const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(total ? got / total : 0); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out.buffer;
}

const state = { world: null, flies: [], clock: new TownClock(), wind: { x: 1, y: 0, speed: 0.4, angle: 0 }, speedMul: 1, showOdor: false, showLabels: true,
  cam: { x: 22.5, y: 16, zoom: 1 }, ui: null, meta: null, ticksPerWindow: 10 };

async function boot() {
  setLoad(0.02, 'loading the town…');
  const worldP = loadTown();
  const metaP = fetch('assets/brain.json').then(r => r.json());
  const bufP = fetchProgress('assets/brain.bin', p => setLoad(0.05 + p * 0.7, `fetching connectome… ${(p * 100) | 0}%`));
  const [world, meta, buffer] = await Promise.all([worldP, metaP, bufP]);
  state.world = world; state.meta = meta;
  setLoad(0.8, 'spawning ' + PERSONAS.length + ' brains…');
  // soma positions for the brain view
  const N = meta.neuronCount, E = meta.edgeCount; const somaOff = 20 + (N + 1) * 4 + E * 2 + E * 2;
  const soma = new Uint16Array(buffer.slice(somaOff, somaOff + N * 6));
  const lif = meta.lif || { baseline: 0.03, noiseStd: 0.02, inputScale: 0.002 };
  let ready = 0;
  const flies = PERSONAS.map((p, i) => {
    const f = new Fly(p, world);
    const w = new Worker('src/brain-worker.js', { type: 'module' });
    f.worker = w; f.pending = false;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { ready++; setLoad(0.8 + 0.2 * ready / PERSONAS.length, `${ready}/${PERSONAS.length} brains online`); if (ready === PERSONAS.length) start(); }
      else if (m.type === 'result') { f.pending = false; f.simMs = m.ms; f.lastTicks = m.ticks; f.tick = m.tick; f.applyRates(m.rates); if (m.spiked) f.spiked = m.spiked; }
    };
    // each fly gets its own copy of the graph and its own seed; personality tweaks the noise/drive a little
    w.postMessage({ type: 'init', buffer: buffer.slice(0), meta: { groups: meta.groups }, seed: 1000 + i * 7919, params: { ...lif, noiseStd: lif.noiseStd * (0.8 + 0.4 * p.restless), baseline: lif.baseline } });
    return f;
  });
  state.flies = flies;
  state.ui = new UI(flies, state.clock, meta, soma);
  bindInput();
}

function start() {
  document.getElementById('loading').remove();
  state.ui.pushEvents(state.flies.map(f => f.remember(`Woke up at ${f.homePlace.name}. ${f.bio}`, state.clock, 'wake')));
  requestAnimationFrame(loop);
}

let last = performance.now();
function loop(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
  const dt = dtReal * state.speedMul;
  const { world, flies, clock, wind } = state;
  if (!clock.paused && state.speedMul > 0) {
    clock.advance(dt);
    // slowly wandering wind
    wind.angle += (Math.random() - 0.5) * dt * 0.3; wind.x = Math.cos(wind.angle); wind.y = Math.sin(wind.angle); wind.speed = 0.3 + 0.2 * Math.sin(clock.now / 700);
    // food slowly regrows
    for (const p of world.places) if (p.kind === 'food') p.supply = Math.min(1, (p.supply ?? 1) + dt * clock.scale / 7200);
    const events = [];
    for (const f of flies) {
      events.push(...f.update(dt, world, flies, clock, wind));
      if (!f.pending && f.worker) {
        const inputs = f.sense(world, flies, wind, clock);
        // ambient odor keeps a little spontaneous activity in the antennal lobe
        for (const k of Object.keys(state.meta.groups)) if (k.startsWith('odor_')) inputs[k] = (inputs[k] || 0) + 0.01;
        if (f.state === 'sleeping') for (const k in inputs) inputs[k] *= 0.3;
        f.pending = true;
        const ticks = Math.max(4, Math.min(20, Math.round(state.ticksPerWindow * Math.max(1, state.speedMul / 3))));
        f.worker.postMessage({ type: 'tick', id: f.tick, inputs, ticks, readouts: READOUTS, wantSpikes: state.ui.selected === f });
      }
    }
    if (events.length) state.ui.pushEvents(events);
    // adapt tick budget to measured worker time (target ~10 ms per window)
    const avgMs = flies.reduce((s, f) => s + (f.simMs || 0), 0) / flies.length;
    if (avgMs > 14 && state.ticksPerWindow > 4) state.ticksPerWindow--; else if (avgMs < 7 && state.ticksPerWindow < 16) state.ticksPerWindow++;
  }
  if (state.ui.follow && state.ui.selected) { const f = state.ui.selected; state.cam.x += (f.x - state.cam.x) * 0.1; state.cam.y += (f.y - state.cam.y) * 0.1; }
  render();
  document.getElementById('clock').textContent = clock.stamp() + (clock.isNight ? ' 🌙' : ' ☀️');
  document.getElementById('weather').textContent = `wind ${['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][Math.round(((Math.atan2(wind.y, wind.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]}`;
  if (now % 500 < 20) state.ui.updateChips();
  state.ui.renderInspector();
  requestAnimationFrame(loop);
}

// ---------- rendering ----------
function resize() { const r = canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
window.addEventListener('resize', resize); resize();
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(document.getElementById('stage'));
function fitZoom() { const { world } = state; const r = canvas.getBoundingClientRect(); return Math.min(r.width / (world.W * world.T), r.height / (world.H * world.T)); }

function render() {
  const { world, flies, clock, cam } = state; if (!world) return;
  const dpr = canvas.width / canvas.getBoundingClientRect().width;
  const T = world.T; const base = fitZoom() * cam.zoom; const s = base * dpr; // screen px per world px
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0f1418'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const ox = canvas.width / 2 - cam.x * T * s, oy = canvas.height / 2 - cam.y * T * s;
  ctx.setTransform(s, 0, 0, s, ox, oy);
  ctx.drawImage(world.canvas, 0, 0);
  const W2T = (v) => v * T;
  // odor overlay
  if (state.showOdor) { const step = 1; for (let y = 0; y < world.H; y += step) for (let x = 0; x < world.W; x += step) { const c = Math.min(1, foodOdor(world, x + .5, y + .5, state.wind)); const d = Math.min(1, world.sampleDanger(x + .5, y + .5)); if (c > 0.03) { ctx.fillStyle = `rgba(255,179,71,${c * 0.5})`; ctx.fillRect(W2T(x), W2T(y), T, T); } if (d > 0.05) { ctx.fillStyle = `rgba(80,140,255,${d * 0.35})`; ctx.fillRect(W2T(x), W2T(y), T, T); } } }
  // places
  for (const p of world.places) {
    if (p.r <= 0) continue;
    if (p.kind === 'food') { const sup = p.supply ?? 1; ctx.beginPath(); ctx.arc(W2T(p.x), W2T(p.y), W2T(p.r), 0, Math.PI * 2); ctx.strokeStyle = `rgba(255,179,71,${0.15 + 0.35 * sup})`; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); }
    if (state.showLabels) { ctx.font = `bold ${Math.max(9, 11 / Math.max(1, cam.zoom * 0.7)) | 0}px ui-monospace, monospace`; ctx.textAlign = 'center'; const label = p.name + (p.kind === 'food' ? ` (${Math.round((p.supply ?? 1) * 100)}%)` : ''); const w = ctx.measureText(label).width; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(W2T(p.x) - w / 2 - 3, W2T(p.y) - W2T(p.r) - 14, w + 6, 13); ctx.fillStyle = p.kind === 'food' ? '#ffb347' : p.kind === 'home' ? '#7fd4ff' : p.kind === 'danger' ? '#ff7f50' : '#e7eef5'; ctx.fillText(label, W2T(p.x), W2T(p.y) - W2T(p.r) - 4); }
  }
  // flies
  for (const f of flies) drawFly(f, T, cam.zoom);
  // day/night
  const dl = clock.daylight; if (dl < 1) { ctx.fillStyle = `rgba(10,16,40,${(1 - dl) * 0.55})`; ctx.fillRect(0, 0, world.W * T, world.H * T); }
}

function drawFly(f, T, zoom) {
  const x = f.x * T, y = f.y * T; const sel = state.ui.selected === f;
  ctx.save(); ctx.translate(x, y); ctx.scale(1.5, 1.5);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(2, 4, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(f.heading);
  const flying = f.state === 'foraging' && f.speed > 0.2;
  // wings
  const flap = flying ? Math.sin(f.wingPhase) * 0.5 : 0.25;
  ctx.fillStyle = 'rgba(220,235,255,.55)';
  for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.ellipse(-2, sgn * (3 + flap * 2), 6, 2.4, sgn * (0.5 + flap * 0.6), 0, Math.PI * 2); ctx.fill(); }
  // body
  ctx.fillStyle = '#2b1d12'; ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = f.color; ctx.beginPath(); ctx.ellipse(-1.5, 0, 3, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  // eyes
  ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(4.5, -1.6, 1.1, 0, Math.PI * 2); ctx.arc(4.5, 1.6, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // status
  if (sel) { ctx.strokeStyle = f.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke(); }
  if (state.showLabels || sel) { ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.6)'; const lbl = f.name + (f.state === 'eating' ? ' 🍽' : f.state === 'sleeping' ? ' 💤' : f.state === 'wet' ? ' 💦' : ''); const w = ctx.measureText(lbl).width; ctx.fillRect(x - w / 2 - 2, y - 24, w + 4, 12); ctx.fillStyle = f.color; ctx.fillText(lbl, x, y - 15); }
}

// ---------- input ----------
function bindInput() {
  const r = () => canvas.getBoundingClientRect();
  const toWorld = (cx, cy) => { const { world, cam } = state; const base = fitZoom() * cam.zoom; const rr = r(); return { x: (cx - rr.left - rr.width / 2) / (base * world.T) + cam.x, y: (cy - rr.top - rr.height / 2) / (base * world.T) + cam.y }; };
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 3) drag.moved = true; const base = fitZoom() * state.cam.zoom * state.world.T; state.cam.x -= dx / base; state.cam.y -= dy / base; drag.x = e.clientX; drag.y = e.clientY; if (drag.moved) state.ui.follow = false; });
  canvas.addEventListener('pointerup', e => { if (drag && !drag.moved) { const p = toWorld(e.clientX, e.clientY); let best = null, bd = 1.2; for (const f of state.flies) { const d = Math.hypot(f.x - p.x, f.y - p.y); if (d < bd) { best = f; bd = d; } } if (best) state.ui.select(best, true); } drag = null; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); state.cam.zoom = Math.max(0.6, Math.min(6, state.cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89))); }, { passive: false });
  document.querySelectorAll('#hud button[data-speed]').forEach(b => b.onclick = () => setSpeed(+b.dataset.speed));
  document.getElementById('toggle-odor').onclick = () => { state.showOdor = !state.showOdor; document.getElementById('toggle-odor').classList.toggle('active', state.showOdor); };
  document.getElementById('toggle-labels').onclick = () => { state.showLabels = !state.showLabels; document.getElementById('toggle-labels').classList.toggle('active', state.showLabels); };
  window.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.code === 'Space') { e.preventDefault(); setSpeed(state.speedMul ? 0 : 1); } if (e.key === '1') setSpeed(1); if (e.key === '2') setSpeed(3); if (e.key === '3') setSpeed(10); if (e.key === 'o') document.getElementById('toggle-odor').click(); if (e.key === 'l') document.getElementById('toggle-labels').click(); });
}
function setSpeed(v) { state.speedMul = v; state.clock.paused = v === 0; document.querySelectorAll('#hud button[data-speed]').forEach(b => b.classList.toggle('active', +b.dataset.speed === v)); }

// debug hook for headless checks
window.__smallfly = state;
boot().catch(err => { console.error(err); setLoad(1, 'failed: ' + err.message); });
