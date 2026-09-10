import { parseBrain, Brain } from './lif.js';
let brain = null;
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    brain = new Brain(parseBrain(m.buffer), m.meta, m.seed, m.params);
    postMessage({ type: 'ready', N: brain.N, E: brain.E });
  } else if (m.type === 'params') {
    Object.assign(brain.params, m.params);
  } else if (m.type === 'tick') {
    brain.setInputs(m.inputs);
    const t0 = performance.now();
    const total = brain.run(m.ticks);
    const rates = {}; for (const name of m.readouts) rates[name] = brain.rate(name, m.ticks);
    const msg = { type: 'result', id: m.id, ticks: m.ticks, totalSpikes: total, rates, ms: performance.now() - t0, tick: brain.tick };
    if (m.wantSpikes) { msg.spiked = brain.spikedIndices(); postMessage(msg, [msg.spiked.buffer]); }
    else postMessage(msg);
  }
};
