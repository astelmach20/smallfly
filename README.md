# Smallfly 🪰

**A little town where fruit-fly connectomes live.**

Six flies, each a leaky-integrate-and-fire simulation of a **30,000-neuron / 1.5-million-synapse slice of the real MaleCNS v1.0 connectome**, living in a tiny [generative-agents](https://arxiv.org/abs/2304.03442)-style town: they smell food and each other, steer with their descending neurons, eat when their proboscis motor pool fires, sleep at home at night, keep a memory stream, and reflect on their day at dawn.

Everything runs in the browser: one Web Worker per fly, no backend, no LLM.

## How it works

```
town odors (food · other flies · water)  →  currents on real ORNs, split by antenna side
   → antennal lobe → lateral horn + mushroom body → descending neurons → leg / wing / proboscis motor neurons
   → decoded steering + speed + feeding  →  body moves in the town  →  events → memory stream → dawn reflection
```

- `scripts/select_subgraph.py` picks the subgraph: all olfactory receptor neurons, antennal-lobe PNs/LNs, lateral horn, the full mushroom body (KCs, MBONs, DANs), gustatory + wind sensors, all descending neurons, leg/wing/proboscis motor neurons, then fills to 30k with the neurons most strongly connected to that set. Edges with ≥ 5 synapses are kept; sign comes from predicted neurotransmitter (GABA/glutamate inhibitory).
- `scripts/export_graph.py` writes `public/assets/brain.bin` (CSR graph + soma positions) and `brain.json` (named input/output groups).
- `scripts/decode_steering.mjs` stimulates left vs right ORNs offline and finds the descending neurons that are actually side-selective; those become the steering readout.
- `public/src/lif.js` is the neuron model (shared by the worker and the Node probes).

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
