// Side panel: town feed, fly inspector (inputs, readouts, memory, relationships), brain view.
export class UI {
  constructor(flies, clock, meta, soma) {
    this.flies = flies; this.clock = clock; this.meta = meta;
    this.feedEl = document.getElementById('feed'); this.insp = document.getElementById('inspector'); this.chips = document.getElementById('chips');
    this.selected = null; this.follow = false; this.lastInspect = 0;
    this.brainPos = this.layoutBrain(soma, meta);
    document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => this.showTab(b.dataset.tab));
    document.getElementById('toggle-panel').onclick = () => document.getElementById('app').classList.toggle('panel-hidden');
    for (const f of flies) {
      const c = document.createElement('div'); c.className = 'chip'; c.innerHTML = `<span class="dot" style="background:${f.color}"></span><span>${f.name}</span> <span class="st"></span>`;
      c.onclick = () => this.select(f, true); f.chip = c; this.chips.appendChild(c);
    }
  }
  showTab(name) { document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name)); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name)); }
  select(f, follow = false) {
    if (this.selected === f && follow) { this.follow = !this.follow; }
    else { this.selected = f; this.follow = follow; }
    this.flies.forEach(x => x.chip.classList.toggle('active', x === f));
    if (f) { this.showTab('fly'); this.renderInspector(true); }
    document.getElementById('app').classList.remove('panel-hidden');
  }
  pushEvents(events) {
    for (const e of events) {
      const li = document.createElement('li'); li.className = e.kind;
      li.innerHTML = `<span class="t">${e.t}</span><span class="who" style="color:${e.fly.color}">${e.fly.name}</span> ${e.text}`;
      this.feedEl.prepend(li);
    }
    while (this.feedEl.children.length > 120) this.feedEl.lastChild.remove();
  }
  updateChips() { for (const f of this.flies) f.chip.querySelector('.st').textContent = f.describeState(); }
  layoutBrain(soma, meta) {
    const N = meta.neuronCount; const pos = new Float32Array(N * 2);
    // choose the two axes with the widest spread for a 2D projection
    const mins = [65535, 65535, 65535], maxs = [0, 0, 0];
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { const v = soma[i * 3 + k]; if (v < mins[k]) mins[k] = v; if (v > maxs[k]) maxs[k] = v; }
    const spread = maxs.map((m, k) => m - mins[k]);
    const axes = [0, 1, 2].sort((a, b) => spread[b] - spread[a]);
    const ax = axes[0], ay = axes[1];
    for (let i = 0; i < N; i++) { pos[i * 2] = (soma[i * 3 + ax] - mins[ax]) / (spread[ax] || 1); pos[i * 2 + 1] = (soma[i * 3 + ay] - mins[ay]) / (spread[ay] || 1); }
    // orient: long axis horizontal
    return pos;
  }
  renderInspector(force = false) {
    const f = this.selected; if (!f) return;
    const now = performance.now(); if (!force && now - this.lastInspect < 200) return; this.lastInspect = now;
    const r = f.rates || {}, raw = f.raw || {};
    const hz = (x) => ((x || 0) * 1000).toFixed(1);
    if (!this.insp.dataset.fly || this.insp.dataset.fly !== String(f.id)) {
      this.insp.dataset.fly = String(f.id);
      this.insp.innerHTML = `
        <div class="fly-head"><span class="dot" style="background:${f.color}"></span><div><h2>${f.name}</h2><div class="bio">${f.bio}</div></div></div>
        <div class="kv" id="kv"></div>
        <canvas id="brainview" width="480" height="300"></canvas>
        <div class="muted" style="font-size:11px;margin-top:4px">Live spikes across the 30,000 retained neurons (soma positions, MaleCNS coordinates). Brain left, ventral nerve cord right.</div>
        <div class="bars" id="bars"></div>
        <h3>Relationships</h3><div class="rel" id="rel"></div>
        <h3>Memory stream</h3><ul class="memory" id="mem"></ul>`;
      this.bv = document.getElementById('brainview'); this.bvCtx = this.bv.getContext('2d');
      this.drawBrainBase();
    }
    const kv = document.getElementById('kv');
    const L = f.learn || {}; const pct = (x) => x == null ? '–' : Math.round(x * 100) + '%';
    const mb = `approach ${pct(L.approach)} · avoid ${pct(L.avoid)}${(L.reward > 0.05 || L.punish > 0.05) ? ` · <b style="color:${L.reward > L.punish ? '#7fe08a' : '#ff7f50'}">${L.reward > L.punish ? 'dopamine: reward' : 'dopamine: punishment'}</b>` : ''}`;
    const mod = f.mbMod ?? 1; const modTxt = mod > 1.15 ? `likes this smell ×${mod.toFixed(1)}` : mod < 0.85 ? `wary of this smell ×${mod.toFixed(2)}` : 'neutral';
    kv.innerHTML = `<b>Doing</b><span>${f.describeState()}</span><b>Where</b><span>${f.place?.name ?? 'the meadow'}</span><b>Hunger</b><span>${(f.hunger * 100) | 0}%</span><b>Meals</b><span>${f.meals}</span><b>Speed</b><span>${f.speed.toFixed(2)} tiles/s</span>` +
      `<b>Sleep pressure</b><span>${Math.round(f.sleepPressure * 100)}% · dFB ${hz(f.sleepRate)} Hz</span><b>Grooming</b><span>dust ${Math.round(f.dust * 100)}% · DNg ${hz(f.groomRate)} Hz</span>` +
      (f.sex === 'm' ? `<b>Courtship</b><span>drive ${Math.round(f.courtDrive * 100)}% · P1 ${hz(f.p1Rate)} Hz · song ${hz(f.songRate)} Hz</span>` : `<b>Sex</b><span>female (males court her)</span>`) +
      `<b>Mushroom body</b><span>KC→MBON synapses: ${mb}</span><b>Learned valence</b><span>${modTxt}</span>` +
      `<b>Brain</b><span>${f.simMs.toFixed(1)} ms / ${f.lastTicks || 0} ticks · t=${(f.tick / 1000).toFixed(1)}s</span>`;
    const bars = document.getElementById('bars');
    const row = (lbl, l, r, max) => `<div class="bar-row"><span class="lbl">${lbl}</span><div class="bar l"><i style="width:${Math.min(100, l / max * 100)}%"></i></div><div class="bar r"><i style="width:${Math.min(100, r / max * 100)}%"></i></div></div>`;
    bars.innerHTML = `<div class="bar-row"><span class="lbl muted">input L / R</span><span class="muted" style="text-align:right">left</span><span class="muted">right</span></div>` +
      row('food odor', raw.foodL || 0, raw.foodR || 0, 1.5) + row('fly odor', raw.socL || 0, raw.socR || 0, 1.5) + row('water/danger', raw.danL || 0, raw.danR || 0, 1.5) +
      row('pheromone ♀ / ♂', (raw.pfL || 0) + (raw.pfR || 0), (raw.pmL || 0) + (raw.pmR || 0), 1.5) + row('looming', raw.loomL || 0, raw.loomR || 0, 1) +
      `<div class="bar-row" style="margin-top:8px"><span class="lbl muted">output Hz L / R</span><span></span><span></span></div>` +
      row(`descending ${hz(r.DN_L)}/${hz(r.DN_R)}`, r.DN_L || 0, r.DN_R || 0, 0.06) + row(`leg motor ${hz(r.MN_leg_L)}/${hz(r.MN_leg_R)}`, r.MN_leg_L || 0, r.MN_leg_R || 0, 0.06) +
      row(`wing motor ${hz(r.wing_L)}/${hz(r.wing_R)}`, r.wing_L || 0, r.wing_R || 0, 0.08) + row(`proboscis ${hz(r.proboscis_L)}/${hz(r.proboscis_R)}`, r.proboscis_L || 0, r.proboscis_R || 0, 0.06) +
      row(`KC / MBON ${hz(r.KC)}/${hz(r.MBON)}`, r.KC || 0, r.MBON || 0, 0.06) +
      row(`MBON approach/avoid ${hz(r.MBON_approach)}/${hz(r.MBON_avoid)}`, r.MBON_approach || 0, r.MBON_avoid || 0, 0.06) +
      row(`DAN reward/punish ${hz(r.DAN_reward)}/${hz(r.DAN_punish)}`, r.DAN_reward || 0, r.DAN_punish || 0, 0.15) +
      row(`giant fiber / groom DN ${hz(r.GF)}/${hz(r.groom_DN)}`, r.GF || 0, r.groom_DN || 0, 0.1) +
      row(`P1 / song DN ${hz(r.P1)}/${hz(r.song_DN)}`, r.P1 || 0, r.song_DN || 0, 0.06) +
      row(`clock / sleep dFB ${hz(r.clock)}/${hz(r.sleep_FB)}`, r.clock || 0, r.sleep_FB || 0, 0.15) +
      row(`wind JO ${hz(r.wind_L)}/${hz(r.wind_R)}`, r.wind_L || 0, r.wind_R || 0, 0.06);
    const rel = document.getElementById('rel');
    const rels = Object.entries(f.relationships).sort((a, b) => b[1] - a[1]);
    rel.innerHTML = rels.length ? rels.map(([n, c]) => `<span>${n} · ${c} meeting${c > 1 ? 's' : ''}</span>`).join('') : '<span class="muted">hasn\'t met anyone yet</span>';
    const mem = document.getElementById('mem');
    mem.innerHTML = f.memory.slice(-40).reverse().map(m => `<li class="${m.kind}"><span class="t">${m.t}</span>${m.text}</li>`).join('');
    this.drawBrain(f);
  }
  drawBrainBase() {
    const c = this.bv, ctx = this.bvCtx, pos = this.brainPos, N = this.meta.neuronCount;
    const img = ctx.createImageData(c.width, c.height); const d = img.data;
    for (let i = 0; i < N; i++) { const x = (pos[i * 2] * (c.width - 8) + 4) | 0, y = (pos[i * 2 + 1] * (c.height - 8) + 4) | 0; const k = (y * c.width + x) * 4; d[k] = 40; d[k + 1] = 52; d[k + 2] = 64; d[k + 3] = 255; }
    this.baseImg = img;
  }
  drawBrain(f) {
    const c = this.bv, ctx = this.bvCtx, pos = this.brainPos; if (!this.baseImg) return;
    ctx.putImageData(this.baseImg, 0, 0);
    const sp = f.spiked; if (!sp) return;
    const role = this.meta.role, roles = this.meta.roles;
    const colors = {}; roles.forEach((r, i) => colors[i] = r === 'ORN' ? '#7fd4ff' : r === 'DN' ? '#ff7f50' : r.startsWith('MN') ? '#ffb347' : r === 'KC' ? '#c58cff' : '#e7eef5');
    for (let k = 0; k < sp.length; k++) { const i = sp[k]; ctx.fillStyle = colors[role[i]]; ctx.fillRect(pos[i * 2] * (c.width - 8) + 3, pos[i * 2 + 1] * (c.height - 8) + 3, 2, 2); }
    ctx.fillStyle = 'rgba(231,238,245,.7)'; ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`${sp.length} neurons spiked in the last ${f.lastTicks || 0} ms · ● ORN ● DN ● motor ● KC`, 6, c.height - 6);
  }
}
