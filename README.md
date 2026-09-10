# Smallfly 🪰

**A little town where fruit-fly connectomes live.**

Six flies, each a leaky-integrate-and-fire simulation of a **30,000-neuron / 1.5-million-synapse slice of the real MaleCNS v1.0 connectome**, living in a tiny [generative-agents](https://arxiv.org/abs/2304.03442)-style town: they smell food and each other, steer with their descending neurons, eat when their proboscis motor pool fires, sleep at home at night, keep a memory stream, and reflect on their day at dawn.

Everything runs in the browser: one Web Worker per fly, no backend, no LLM.

## How it works

```
town odors (food · other flies · pheromones · water) + looming + wind + bristle dust + internal drives
   →  currents on the real sensory neurons (ORNs, LC4/LPLC2, JO, bristle mechanosensors) and modulatory neurons (dFB, clock, DANs, P1)
   → antennal lobe → lateral horn + mushroom body (plastic KC→MBON synapses) → descending neurons → motor neurons
   → decoded steering, speed, feeding, escape, grooming, song, sleep  →  body moves in the town  →  events → memory stream → dawn reflection
```

Behaviours, and the real neurons whose spike rates gate them:

| behaviour | input neurons | readout neurons | mechanism |
|---|---|---|---|
| chemotaxis | ORNs by glomerulus (sweet: VA2, DP1m, VM5d, DM3 · ferment: DM1, DM4, DM2 · water: DA2, DL5, V, DM5) | side-selective LH/steer pools; leg + wing MNs for vigor | per-channel L/R contrast, drive-weighted, plus surge/cast on the temporal derivative |
| learning | PAM (reward, 316) and PPL1 (punishment, 16) dopamine neurons | MBON_approach (71 GABA/ACh) vs MBON_avoid (26 glutamate) | three-factor rule on 33k KC→MBON synapses: KC eligibility × dopamine above baseline depresses approach (punish) or avoid (reward) synapses; the learned part scales steering toward the smelled odor |
| social learning | same PAM pathway, pulsed while watching a neighbour eat something you can smell | same | Danchin-style copying |
| courtship | Or47b/Or88a pheromone ORNs (VA1v/VA1d) gate a drive on P1/pC1 (58) | pIP10, vPR6, dPR1 song DNs (12) | male chases, extends a wing and sings when song DNs cross 10 Hz |
| escape | LC4, LPLC2, LPLC4 looming detectors (168) | giant fiber DNp01 + DNp02-06 | swat (click the grass) or a diving fly → GF > 60 Hz → jump away, even from sleep; punishing |
| grooming | bristle mechanosensors (57) | DNg11, DNg12 (48) | dust from meals and river water |
| sleep | dFB / ExR sleep neurons (23) driven by a homeostat; clock neurons DN1, LNd, aMe (33) add night | dFB rate | > 85 Hz settles (home preferred), < 40 Hz wakes; hunger overrides |
| wind | Johnston's organ wind pools | JO L/R contrast | when odor rises, turn toward the side the wind is pushing on |

Not included: phototaxis and gravitaxis (no photoreceptors in the slice — looming is injected at the LC4/LPLC2 stage). No LLM anywhere; feed lines are templates.

### Making learning odor-specific

Left alone the LIF network sits in a self-sustained up-state where PN and Kenyon-cell codes carry no odor identity (sweet vs ferment KC codes correlate 0.99, 44% of KCs active). Fully input-driven regimes (`inputScale` 0.0012) are silent at rest with zero motor output, so instead `lif.feedforward` scales *recurrent excitatory* input onto ALPNs and KCs down (×0.3) and their canonical feedforward synapses up (ORN→PN ×5, PN→KC ×3), leaving inhibition alone (`scripts/regime.mjs`):

| regime | KC active | KC corr same odor | KC corr sweet vs ferment | motor output |
|---|---|---|---|---|
| default up-state | 44% | 0.99 | 0.99 | yes |
| input-driven (inputScale 0.0012) | 3% | 0.94 | 0.87 | none |
| feedforward AL/calyx (shipped) | 11% | 0.95 | 0.58 | yes |

`scripts/learn_test.mjs` pairs one odor with dopamine and reads the MBON valence for both odors before/after: punishment paired with sweet shifts the sweet MBON valence by −13 Hz and ferment by −3 Hz; reward paired with sweet shifts sweet by +23 Hz and ferment by +11 Hz (learned-synapse valence −0.60 vs −0.38 and +0.58 vs +0.37: specific, with the generalisation you'd expect from overlapping Kenyon-cell codes). Dopamine neurons are tonically active here and odors + taste alone lift PPL1 by up to ~60 Hz, so only deviations above a running baseline (which follows the floor quickly but creeps up slowly) plus a threshold (`danThresh`) count as teaching signals; the injected punishment lifts PPL1 by ~130 Hz. Without this the flies slowly "learn" to avoid every food smell.

### Does it work?

`scripts/harness.mjs`: one fly, one brain, one food source (the garden, a ferment smell) 8 tiles away, 3 seeds × 60 s, eating disabled. `inPct` = share of time spent on the food.

| condition | mean distance to food (tiles) | time on food | reached it |
|---|---|---|---|
| no steering (random walk, motor vigor only) | 17.4 | 3% | 2 of 3 |
| naive fly | 4.1 | 43% | 3 of 3 |
| garden smell pre-paired with punishment (PPL1, 4 × 0.6 s) | 11.7 | 9% | 3 of 3 |
| garden smell pre-paired with reward (PAM, 4 × 0.6 s) | 2.8 | 70% | 3 of 3 |
| upwind term from the JO readout inverted | 11.1 | 13% | 3 of 3 |

Learning is graded (`learnRate` 0.003: a couple of meals to notice, a day to settle) and recovers over ~30 sim-minutes, so a punished fly still visits — it just doesn't linger. In the town the flies mostly earn reward (meals), so after a day most of them "like" food smells a bit more than they did at dawn; punishment comes from the river and from being swatted.

- `scripts/select_subgraph.py` picks the subgraph: all olfactory receptor neurons, antennal-lobe PNs/LNs, lateral horn, the full mushroom body (KCs, MBONs, DANs), gustatory + wind sensors, all descending neurons, leg/wing/proboscis motor neurons, then fills to 30k with the neurons most strongly connected to that set. Edges with ≥ 5 synapses are kept; sign comes from predicted neurotransmitter (GABA/glutamate inhibitory).
- `scripts/export_graph.py` writes `public/assets/brain.bin` (CSR graph + soma positions) and `brain.json` (named input/output groups).
- `scripts/decode_steering.mjs` stimulates left vs right ORNs offline and finds the descending neurons that are actually side-selective; those become the steering readout.
- `public/src/lif.js` is the neuron model (shared by the worker and the Node probes), including the plasticity rule and the feedforward scaling.
- `scripts/circuits.mjs`, `scripts/dan_probe.mjs`, `scripts/regime.mjs`, `scripts/learn_test.mjs` are the probes used to pick every threshold in `flies.js` `TUNE`.

**Caveats, honestly:** the wiring is measured; neuron dynamics, synaptic scaling, sensory mapping and motor decoding are engineering choices. This is a connectome-shaped toy, not a digital fly.

## Run locally

```sh
cd public && python3 -m http.server 8000   # any static server works (module workers need http://)
```

To regenerate the brain you need the MaleCNS flat-connectome files (~1.1 GB) from https://male-cns.janelia.org/download/ in `/tmp/malecns/`, then `uv run scripts/select_subgraph.py && uv run scripts/export_graph.py && node scripts/decode_steering.mjs`.

## Credits

- Connectome: **MaleCNS v1.0** — HHMI Janelia FlyEM, University of Cambridge, MRC LMB, Google Research. CC BY 4.0.
- Map: [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) (MIT); tiles by George Bailey, hilau and ansimuz (OpenGameArt).
- Inspired by fly-brain week on X: DOOMFLY, fly-escape, flyhard, Fly64, NeuroCraft Fly, Bootoshi's maze.

Code: MIT.
