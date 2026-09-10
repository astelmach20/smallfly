// Town map (AI Town "gentle" map, MIT; tiles from opengameart), named places, and odor fields.
export const PLACES = [
  { id: 'campsite', name: 'Campsite', x: 9.5, y: 8.5, r: 2.6, kind: 'home', desc: 'a canvas tent and a crate' },
  { id: 'crate', name: 'Sugar Crate', x: 7.2, y: 9.2, r: 1.2, kind: 'food', food: 'spilled sugar', strength: 0.9, plume: 5, odor: { sweet: 1.0, ferment: 0.1 } },
  { id: 'picnic', name: 'Picnic Table', x: 8.5, y: 12.4, r: 1.3, kind: 'food', food: 'a slice of melon', strength: 0.8, plume: 4.5, odor: { sweet: 0.6, ferment: 0.7 } },
  { id: 'log', name: 'Fallen Log', x: 14.3, y: 10.7, r: 1.6, kind: 'social', desc: 'a mossy log everyone rests on' },
  { id: 'mud', name: 'Mud Puddle', x: 10.8, y: 13.2, r: 1.2, kind: 'danger', strength: 0.5 },
  { id: 'garden', name: 'Garden Bed', x: 13.5, y: 21.6, r: 3.6, kind: 'food', food: 'overripe tomatoes', strength: 0.7, plume: 6, odor: { sweet: 0.1, ferment: 1.0 } },
  { id: 'berries', name: 'Berry Bushes', x: 17.0, y: 25.6, r: 2.2, kind: 'food', food: 'fermenting berries', strength: 1.0, plume: 7, odor: { sweet: 0.2, ferment: 1.0 } },
  { id: 'rocks', name: 'Sunning Rocks', x: 20.8, y: 23.6, r: 1.4, kind: 'social', desc: 'warm rocks by the river' },
  { id: 'oak', name: 'Old Oak', x: 33.5, y: 28.6, r: 2.8, kind: 'home', desc: 'the big tree where flies roost' },
  { id: 'easttent', name: 'Camper\'s Tent', x: 44.0, y: 8.3, r: 1.5, kind: 'home', desc: 'a tent at the east edge' },
  { id: 'easttable', name: 'East Table', x: 43.2, y: 12.6, r: 1.2, kind: 'food', food: 'bread crumbs', strength: 0.6, plume: 4, odor: { sweet: 0.5, ferment: 0.5 } },
  { id: 'flowers1', name: 'Meadow Flowers', x: 26.6, y: 22.2, r: 1.0, kind: 'food', food: 'nectar', strength: 0.45, plume: 3.5, odor: { sweet: 1.0, ferment: 0.0 } },
  { id: 'flowers2', name: 'Yellow Flowers', x: 32.3, y: 22.3, r: 0.9, kind: 'food', food: 'nectar', strength: 0.4, plume: 3.5, odor: { sweet: 1.0, ferment: 0.0 } },
  { id: 'flowers3', name: 'Pink Flowers', x: 33.3, y: 13.5, r: 0.9, kind: 'food', food: 'pollen', strength: 0.4, plume: 3.5, odor: { sweet: 1.0, ferment: 0.0 } },
  { id: 'river', name: 'The River', x: 24.5, y: 12, r: 0, kind: 'water' },
];

export async function loadTown() {
  const town = await (await fetch('assets/town.json')).json();
  const img = await loadImage('assets/' + town.tileset);
  const { width: W, height: H, tile: T, tilesetCols: cols } = town;
  const canvas = document.createElement('canvas'); canvas.width = W * T; canvas.height = H * T;
  const ctx = canvas.getContext('2d');
  const drawLayer = (layer) => {
    for (let i = 0; i < layer.length; i++) {
      const g = layer[i]; if (g < 0) continue;
      const x = i % W, y = (i / W) | 0;
      ctx.drawImage(img, (g % cols) * T, ((g / cols) | 0) * T, T, T, x * T, y * T, T, T);
    }
  };
  town.bg.forEach(drawLayer); town.obj.forEach(drawLayer);
  // danger field from water tiles (tile resolution, sampled bilinearly)
  const danger = new Float32Array(W * H);
  const waterTiles = [];
  for (let i = 0; i < town.water.length; i++) if (town.water[i]) waterTiles.push([i % W + 0.5, ((i / W) | 0) + 0.5]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0; const cx = x + 0.5, cy = y + 0.5;
    for (const [wx, wy] of waterTiles) { const d2 = (wx - cx) ** 2 + (wy - cy) ** 2; if (d2 < 36) s += 0.55 / (1 + d2 / 1.6); }
    for (const p of PLACES) if (p.kind === 'danger') { const d2 = (p.x - cx) ** 2 + (p.y - cy) ** 2; s += p.strength / (1 + d2 / (p.r * p.r)); }
    danger[y * W + x] = Math.min(1.2, s);
  }
  return { W, H, T, canvas, water: town.water, danger, places: PLACES,
    isWater(x, y) { const xi = x | 0, yi = y | 0; return xi >= 0 && yi >= 0 && xi < W && yi < H && town.water[yi * W + xi] === 1; },
    sampleDanger(x, y) { return bilinear(danger, W, H, x - 0.5, y - 0.5); },
  };
}

function bilinear(grid, W, H, x, y) {
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), y0 = Math.max(0, Math.min(H - 1, Math.floor(y)));
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
  const a = grid[y0 * W + x0], b = grid[y0 * W + x1], c = grid[y1 * W + x0], d = grid[y1 * W + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

// Food odor at (x,y): sum of plumes from active food places, skewed downwind.
export function foodOdor(world, x, y, wind, channel = null, exclude = null) {
  let s = 0;
  for (const p of world.places) {
    if (p.kind !== 'food' || p.depleted || p === exclude) continue;
    const dx = x - p.x, dy = y - p.y; const d = Math.hypot(dx, dy) + 1e-6;
    const downwind = (dx * wind.x + dy * wind.y) / d; // +1 when fly is downwind of source
    const deff = d * (1 - 0.35 * downwind);
    const cw = channel ? (p.odor?.[channel] ?? 0.5) : 1;
    if (cw <= 0) continue;
    s += cw * p.strength * (p.supply ?? 1) / (1 + (deff / p.plume) ** 2);
  }
  return s;
}
export function placeAt(world, x, y) {
  let best = null, bd = 1e9;
  for (const p of world.places) { if (p.r <= 0) continue; const d = Math.hypot(x - p.x, y - p.y); if (d < p.r && d < bd) { best = p; bd = d; } }
  if (!best && world.isWater(x, y)) return world.places.find(p => p.kind === 'water');
  return best;
}
