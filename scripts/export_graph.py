# /// script
# dependencies = ["pyarrow", "pandas", "numpy"]
# ///
"""Pass 2: write public/assets/brain.bin + brain.json for the selected MaleCNS subgraph.

brain.bin (little-endian): magic "SMALLFLY", u32 version=1, u32 N, u32 E,
  u32 srcOffsets[N+1], u16 targets[E], i16 weights[E] (sign(nt) * synapse count),
  u16 soma[N*3] (x,y,z scaled to 0..65535 over the CNS bounding box).
"""
import sys, json, time, re
import numpy as np, pandas as pd, pyarrow.ipc as ipc

ROOT = '/home/botuser/.claude/work/flytown'
RAW = '/tmp/malecns'
MINW = int(sys.argv[1]) if len(sys.argv) > 1 else 5
t0 = time.time()
ann = pd.read_pickle(f'{ROOT}/data/ann_traced.pkl')
sel_ids = np.load(f'{ROOT}/data/selection.npz')['sel_ids']
sel_ids = np.sort(sel_ids); N = len(sel_ids)
ann = ann.set_index('bodyId').loc[sel_ids].reset_index()
assert len(ann) == N

sign = np.where(ann.nt.isin(['gaba', 'glutamate']), -1, 1).astype(np.int16)
# collect edges among selected
pres, posts, ws = [], [], []
r = ipc.open_file(f'{RAW}/edges.feather')
for bi in range(r.num_record_batches):
    b = r.get_batch(bi)
    pre = b.column('body_pre').to_numpy(); post = b.column('body_post').to_numpy(); w = b.column('weight').to_numpy()
    ok = w >= MINW
    pre, post, w = pre[ok], post[ok], w[ok]
    ip = np.searchsorted(sel_ids, pre); ip = np.minimum(ip, N - 1)
    iq = np.searchsorted(sel_ids, post); iq = np.minimum(iq, N - 1)
    ok = (sel_ids[ip] == pre) & (sel_ids[iq] == post)
    pres.append(ip[ok].astype(np.uint32)); posts.append(iq[ok].astype(np.uint32)); ws.append(w[ok])
pre = np.concatenate(pres); post = np.concatenate(posts); w = np.concatenate(ws)
E = len(pre); print('edges', E, f'({time.time()-t0:.0f}s)')
order = np.lexsort((post, pre)); pre, post, w = pre[order], post[order], w[order]
offsets = np.zeros(N + 1, np.uint32); np.add.at(offsets, pre + 1, 1); offsets = np.cumsum(offsets).astype(np.uint32)
weights = (np.clip(w, 0, 32767) * sign[pre]).astype(np.int16)

# resolve unknown ORN sides by weighted majority of postsynaptic partner sides
side = ann.side.to_numpy().astype(object)
unknown = np.where(side == 'U')[0]
for i in unknown:
    tg = post[offsets[i]:offsets[i + 1]]; ww = w[offsets[i]:offsets[i + 1]]
    l = ww[side[tg] == 'L'].sum(); rr = ww[side[tg] == 'R'].sum()
    side[i] = 'L' if l > rr else ('R' if rr > l else 'U')
print('unknown sides remaining', (side == 'U').sum())

# soma positions; fill missing by averaging partner positions
soma = np.full((N, 3), np.nan)
for i, loc in enumerate(ann.somaLocation):
    if loc is not None and len(loc) == 3: soma[i] = loc
missing = np.isnan(soma[:, 0]); print('missing soma', missing.sum())
in_pre = pre; in_post = post
for it in range(6):
    acc = np.zeros((N, 3)); cnt = np.zeros(N)
    have = ~np.isnan(soma[:, 0])
    m = have[in_post]; np.add.at(acc, in_pre[m], soma[in_post[m]]); np.add.at(cnt, in_pre[m], 1)
    m = have[in_pre]; np.add.at(acc, in_post[m], soma[in_pre[m]]); np.add.at(cnt, in_post[m], 1)
    fill = missing & (cnt > 0)
    soma[fill] = acc[fill] / cnt[fill, None]
    missing = np.isnan(soma[:, 0])
    if not missing.any(): break
soma[missing] = np.nanmean(soma, 0)
lo, hi = soma.min(0), soma.max(0)
soma16 = ((soma - lo) / (hi - lo) * 65535).astype(np.uint16)

with open(f'{ROOT}/public/assets/brain.bin', 'wb') as fh:
    fh.write(b'SMALLFLY'); fh.write(np.array([1, N, E], np.uint32).tobytes())
    fh.write(offsets.tobytes()); fh.write(post.astype(np.uint16).tobytes()); fh.write(weights.tobytes()); fh.write(soma16.tobytes())

typ = ann['type'].fillna('unknown').astype(str).to_numpy(); cls = ann['class'].fillna('').astype(str).to_numpy(); sc = ann['superclass'].fillna('').astype(str).to_numpy(); sub = ann['subclass'].fillna('').astype(str).to_numpy()
types = sorted(set(typ)); tindex = {t: i for i, t in enumerate(types)}
roles = ['other', 'ORN', 'ALPN', 'ALLN', 'LHN', 'KC', 'MBON', 'DAN', 'GRN', 'JO', 'DN', 'MN_leg', 'MN_head', 'MN_other', 'ascending', 'visual', 'vnc_intrinsic', 'cb_intrinsic']
role = np.zeros(N, np.uint8)
def setrole(mask, name): role[mask & (role == 0)] = roles.index(name)
setrole(cls == 'olfactory', 'ORN'); setrole(cls == 'ALPN', 'ALPN'); setrole(cls == 'ALLN', 'ALLN')
setrole(np.char.startswith(typ.astype(str), 'LH') & (sc == 'cb_intrinsic'), 'LHN')
setrole(cls == 'Kenyon_Cell', 'KC'); setrole(cls == 'MBON', 'MBON'); setrole(cls == 'DAN', 'DAN'); setrole(cls == 'gustatory', 'GRN')
setrole((cls == 'mechanosensory') & (sub == 'wind_gravity'), 'JO'); setrole(np.char.startswith(sc.astype(str), 'descending'), 'DN')
setrole((sc == 'vnc_motor') & np.isin(sub, ['fl', 'ml', 'hl']), 'MN_leg'); setrole(sc == 'cb_motor', 'MN_head'); setrole(sc == 'vnc_motor', 'MN_other')
setrole(sc == 'ascending_neuron', 'ascending'); setrole(np.isin(sc, ['visual_projection', 'visual_centrifugal', 'ol_intrinsic', 'ol_sensory']), 'visual')
setrole(sc == 'vnc_intrinsic', 'vnc_intrinsic'); setrole(sc == 'cb_intrinsic', 'cb_intrinsic')

def idx(mask): return [int(i) for i in np.where(mask)[0]]
def orn(gloms, s): return idx(np.isin(typ, [f'ORN_{g}' for g in gloms]) & (side == s))
ODORS = {
    'food': ['DM1', 'DM4', 'DM2', 'VA2', 'DP1m', 'VM5d', 'DM3'],      # fruit / vinegar attractive glomeruli
    'social': ['DA1', 'VA1v', 'VL2a', 'DL3'],                        # cVA / pheromone-related
    'danger': ['DA2', 'DL5', 'V', 'DM5'],                            # geosmin, benzaldehyde, CO2
}
groups = {}
for name, gl in ODORS.items():
    for s in 'LR': groups[f'odor_{name}_{s}'] = orn(gl, s)
for s in 'LR':
    groups[f'taste_head_{s}'] = idx((role == roles.index('GRN')) & (sc == 'cb_sensory') & (side == s))
    groups[f'taste_leg_{s}'] = idx((role == roles.index('GRN')) & (sc != 'cb_sensory') & (side == s))
    groups[f'wind_{s}'] = idx((role == roles.index('JO')) & (side == s))
    groups[f'DN_{s}'] = idx((role == roles.index('DN')) & (side == s))
    groups[f'MN_leg_{s}'] = idx((role == roles.index('MN_leg')) & (side == s))
    groups[f'proboscis_{s}'] = idx((sc == 'cb_motor') & (sub == 'pm') & (side == s))
    groups[f'wing_{s}'] = idx((sc == 'vnc_motor') & (sub == 'wm') & (side == s))
for nm in ['KC', 'MBON', 'DAN', 'LHN', 'ALPN']: groups[nm] = idx(role == roles.index(nm))
for k, v in groups.items(): print(f'{k:16s} {len(v)}')
meta = {
    'dataset': 'MaleCNS v1.0 (Janelia FlyEM / Google Research, CC BY 4.0)', 'source': 'https://male-cns.janelia.org/download/',
    'neuronCount': N, 'edgeCount': E, 'minWeight': MINW, 'roles': roles, 'role': role.tolist(),
    'types': types, 'typeIndex': [tindex[t] for t in typ], 'side': ''.join(side.tolist()),
    'nt': [str(x) for x in ann.nt], 'groups': groups,
}
json.dump(meta, open(f'{ROOT}/public/assets/brain.json', 'w'), separators=(',', ':'))
json.dump([str(b) for b in sel_ids], open(f'{ROOT}/data/bodyids.json', 'w'))
import os; print('brain.bin', os.path.getsize(f'{ROOT}/public/assets/brain.bin')//1024, 'KB; brain.json', os.path.getsize(f'{ROOT}/public/assets/brain.json')//1024, 'KB', f'({time.time()-t0:.0f}s)')
print('nt counts', ann.nt.value_counts().head(8).to_dict())
