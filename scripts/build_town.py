# /// script
# dependencies = ["pillow"]
# ///
"""Convert the AI Town (a16z-infra/ai-town, MIT) 'gentle' map into public/assets/town.json with a water mask."""
import os
import json
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
m = json.load(open('/tmp/gentle.json'))
ts = Image.open(f'{ROOT}/public/assets/gentle-obj.png').convert('RGBA')
T = m['tiledim']; W, H = m['screenxtiles'], m['screenytiles']; cols = ts.width // T
def tile_rgb(g):
    sx, sy = (g % cols) * T, (g // cols) * T
    px = ts.crop((sx, sy, sx + T, sy + T)).resize((1, 1), Image.BOX).getpixel((0, 0))
    return px
water = [[0] * H for _ in range(W)]
for x in range(W):
    for y in range(H):
        g = m['bgtiles'][0][x][y]
        if g is None or g < 0: continue
        r, g_, b, a = tile_rgb(g)
        if b > r + 25 and b > g_ - 10 and r < 120: water[x][y] = 1
print('water tiles', sum(map(sum, water)))
for y in range(H): print(''.join('~' if water[x][y] else '.' for x in range(W)))
# layers: [x][y] -> keep compact as row-major flat arrays of ints (-1 empty)
def flat(layer): return [(-1 if layer[x][y] is None else layer[x][y]) for y in range(H) for x in range(W)]
town = {
    'tileset': 'gentle-obj.png', 'tile': T, 'width': W, 'height': H, 'tilesetCols': cols,
    'bg': [flat(l) for l in m['bgtiles']], 'obj': [flat(l) for l in m['objmap']],
    'anim': m['animatedsprites'], 'water': [water[x][y] for y in range(H) for x in range(W)],
}
json.dump(town, open(f'{ROOT}/public/assets/town.json', 'w'), separators=(',', ':'))
import os; print('town.json', os.path.getsize(f'{ROOT}/public/assets/town.json') // 1024, 'KB'); print('anim sample', m['animatedsprites'][:2])
