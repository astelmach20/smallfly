# /// script
# dependencies = ["pyarrow", "pandas", "numpy"]
# ///
"""Pass 1: choose the FlyTown subgraph from MaleCNS v1.0 (CC-BY, Janelia FlyEM / Google Research).

Seeds = the sensorimotor loop we care about (smell, taste, mushroom body, descending, leg + proboscis motor).
Fill  = remaining Traced neurons ranked by total synapse weight shared with the seed set.
Writes data/selection.npz + prints edge counts at several weight thresholds.
"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import re, sys, json, time
import numpy as np, pandas as pd, pyarrow.feather as f, pyarrow.ipc as ipc

RAW = '/tmp/malecns'
TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 30000
t0 = time.time()
ann = f.read_table(f'{RAW}/annotations.feather').to_pandas()
ann = ann[ann.status == 'Traced'].copy()
nt = f.read_table(f'{RAW}/neurotransmitters.feather').to_pandas().set_index('body')
ann['nt'] = ann.bodyId.map(nt.consensus_nt).fillna('unknown')

def side_of(row):
    for c in ('somaSide', 'rootSide'):
        v = row[c]
        if isinstance(v, str) and v in ('L', 'R', 'M'): return v
    m = re.search(r'_([LRM])\b', str(row['instance']))
    return m.group(1) if m else 'U'
ann['side'] = ann.apply(side_of, axis=1)

typ = ann.type.astype(str); cls = ann['class'].astype(str); sc = ann.superclass.astype(str); sub = ann.subclass.astype(str)
seed_masks = {
    'ORN': cls == 'olfactory',
    'ALPN': cls == 'ALPN', 'ALLN': cls == 'ALLN',
    'LHN': typ.str.startswith('LH') & (sc == 'cb_intrinsic'),
    'KC': cls == 'Kenyon_Cell', 'MBON': cls == 'MBON', 'DAN': cls == 'DAN',
    'GRN_head': (cls == 'gustatory') & (sc == 'cb_sensory'),
    'GRN_leg': (cls == 'gustatory') & sc.isin(['vnc_sensory', 'sensory_ascending']),
    'JO': (cls == 'mechanosensory') & (sub == 'wind_gravity'),
    'DN': sc.str.startswith('descending_neuron'),
    'MN_leg': (sc == 'vnc_motor') & sub.isin(['fl', 'ml', 'hl']),
    'MN_other_vnc': (sc == 'vnc_motor') & ~sub.isin(['fl', 'ml', 'hl']),
    'MN_head': sc == 'cb_motor',
}
seed = np.zeros(len(ann), bool)
for k, m in seed_masks.items():
    seed |= m.values
    print(f'{k:14s} {m.sum():6d}  sides={ann[m].side.value_counts().to_dict()}')
print('seed total', seed.sum(), f'({time.time()-t0:.0f}s)')

ids = ann.bodyId.to_numpy(np.int64)
order = np.argsort(ids); ids_sorted = ids[order]
seed_sorted = seed[order]
score = np.zeros(len(ann), np.float64)   # weight shared with seeds, indexed by sorted position

def lookup(b):
    i = np.searchsorted(ids_sorted, b); i = np.minimum(i, len(ids_sorted) - 1)
    ok = ids_sorted[i] == b
    return i, ok

r = ipc.open_file(f'{RAW}/edges.feather')
for bi in range(r.num_record_batches):
    b = r.get_batch(bi)
    pre = b.column('body_pre').to_numpy(); post = b.column('body_post').to_numpy(); w = b.column('weight').to_numpy().astype(np.float64)
    ip, okp = lookup(pre); iq, okq = lookup(post)
    ok = okp & okq
    ip, iq, w = ip[ok], iq[ok], w[ok]
    sp, sq = seed_sorted[ip], seed_sorted[iq]
    np.add.at(score, iq[sp], w[sp])        # post neurons receiving from seeds
    np.add.at(score, ip[sq], w[sq])        # pre neurons projecting to seeds
    if bi % 400 == 0: print(f'  pass1 batch {bi}/{r.num_record_batches} ({time.time()-t0:.0f}s)', flush=True)

n_fill = max(0, TARGET - seed.sum())
cand = np.where(~seed_sorted)[0]
top = cand[np.argsort(-score[cand])[:n_fill]]
print('fill', len(top), 'min score kept', score[top].min() if len(top) else None)
selected_sorted = seed_sorted.copy(); selected_sorted[top] = True
sel_ids = ids_sorted[selected_sorted]
print('selected neurons', len(sel_ids), f'({time.time()-t0:.0f}s)')
print('fill superclass:', ann.iloc[order[top]].superclass.value_counts().head(8).to_dict())

# pass 2: edges among selected, histogram of thresholds
hist = {}
pos = np.searchsorted(ids_sorted, sel_ids)
keep_sorted = np.zeros(len(ids_sorted), bool); keep_sorted[pos] = True
for bi in range(r.num_record_batches):
    b = r.get_batch(bi)
    pre = b.column('body_pre').to_numpy(); post = b.column('body_post').to_numpy(); w = b.column('weight').to_numpy()
    ip, okp = lookup(pre); iq, okq = lookup(post)
    ok = okp & okq & keep_sorted[ip] & keep_sorted[iq]
    w = w[ok]
    for t in (1, 2, 3, 5, 8, 10):
        hist[t] = hist.get(t, 0) + int((w >= t).sum())
print('edges among selected by min weight:', hist, f'({time.time()-t0:.0f}s)')
np.savez(os.path.join(ROOT, 'data', 'selection.npz'), sel_ids=sel_ids)
ann.to_pickle(os.path.join(ROOT, 'data', 'ann_traced.pkl'))
json.dump(hist, open(os.path.join(ROOT, 'data', 'edge_hist.json'), 'w'))
