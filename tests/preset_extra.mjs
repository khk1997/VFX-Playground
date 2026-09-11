import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual shared serializer using a minimal DOM with native-like controls.
const range = { id: 'strength', type: 'range', value: '0', defaultValue: '0', dataset: {}, dispatchEvent() {} };
const toggle = { id: 'multi', type: 'checkbox', checked: false, defaultChecked: false, dataset: {}, dispatchEvent() {} };
const panel = { querySelectorAll: () => [range, toggle], addEventListener() {} };
const storage = new Map();
const context = vm.createContext({
  window: {}, document: { querySelector: () => panel },
  localStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) },
  Event, setTimeout, clearTimeout, console,
});
vm.runInContext(readFileSync(new URL('../preset-io.js', import.meta.url), 'utf8'), context);
const init = context.window.PresetIO.init;
let memory = { light: { strength: 0.65, colors: ['#1265ed', '#ffe29a'] }, dark: { strength: 0 } };
const api = init({
  effect: 'tint-test',
  serializeExtra: () => ({ tintMemory: structuredClone(memory) }),
  afterApply: payload => { if (payload.extra) memory = payload.extra.tintMemory; },
});

api.save();
assert.equal(Object.keys(api.serialize().values).length, 0);
memory.light.strength = 0.1;
assert.equal(api.restore(), true, 'Opposite backdrop memory must restore even when visible controls equal defaults');
assert.equal(memory.light.strength, 0.65);
range.value = '0.8'; toggle.checked = true;
const exported = JSON.stringify(api.serialize());
range.value = '0.1'; toggle.checked = false; memory.light.colors = ['#000000'];
api.apply(exported);
assert.equal(range.value, '0.8');
assert.equal(toggle.checked, true);
assert.deepEqual(Array.from(memory.light.colors), ['#1265ed', '#ffe29a']);
assert.throws(() => api.apply({ effect: 'other-effect', values: {} }), /other-effect/);

let applied = 0;
const legacy = init({ effect: 'legacy', autosave: false, afterApply: () => applied++ });
assert.equal('extra' in legacy.serialize(), false, 'Existing effect payloads must stay unchanged');
legacy.apply({ effect: 'legacy', values: { strength: '0.4', multi: false } });
assert.equal(range.value, '0.4');
assert.equal(toggle.checked, false);
assert.equal(applied, 1);
console.log('preset metadata round-trip, metadata-only restore and legacy callback compatibility passed');
