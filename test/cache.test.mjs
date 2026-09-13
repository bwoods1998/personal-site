import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRICE_DATE, PROFILES, COST_DENOMINATOR, modeledCost, crossover, dollars, mountCache } from '../portfolio/cache.js';

test('zero reuse charges one ordinary input or one 100x write, never write plus ordinary input', () => {
  for (const [id, profile] of Object.entries(PROFILES)) {
    const result = modeledCost(id, 8000, 0);
    assert.equal(result.ordinary, 8000n * 10n * profile.input);
    assert.equal(result.supercache, result.ordinary * 100n);
    assert.equal(result.denominator, COST_DENOMINATOR);
    assert.equal(result.cheaper, 'ordinary');
  }
  assert.equal(PRICE_DATE, '2026-09-13');
  assert.equal(dollars(modeledCost('pro-flex', 8000, 0).ordinary), '$0.00528');
  assert.equal(dollars(modeledCost('pro-flex', 8000, 0).supercache), '$0.5280');
});

test('independent exact price calculations include all R subsequent reads', () => {
  const pro = modeledCost('pro-flex', 8000, 1);
  assert.equal(dollars(pro.ordinary), '$0.005456');
  assert.equal(dollars(pro.supercache), '$0.5280176');
  const kimi = modeledCost('kimi-balanced', 8000, 1);
  assert.equal(dollars(kimi.ordinary), '$0.0052');
  assert.equal(dollars(kimi.supercache), '$0.36016');
  assert.equal(dollars(0n), '$0.0000');
});

test('exact crossover and first strictly cheaper whole reuse avoid off-by-one savings', () => {
  for (const [id, equalAt, firstCheaper] of [['pro-flex', 3300, 3301], ['kimi-flex', 385, 386], ['kimi-balanced', null, 248]]) {
    const result = crossover(id);
    assert.equal(result.equalAt, equalAt); assert.equal(result.firstCheaper, firstCheaper);
    assert.equal(modeledCost(id, 1025, firstCheaper).cheaper, 'supercache');
    assert.notEqual(modeledCost(id, 1025, firstCheaper - 1).cheaper, 'supercache');
    if (equalAt !== null) assert.equal(modeledCost(id, 128000, equalAt).cheaper, 'equal');
  }
  const balanced = crossover('kimi-balanced');
  assert.equal(balanced.numerator * 2n, balanced.denominator * 495n);
  assert.equal(modeledCost('kimi-balanced', 8000, 247).cheaper, 'ordinary');
});

test('token scaling changes cost proportionally but cannot change which route is cheaper', () => {
  for (const id of Object.keys(PROFILES)) for (const reuse of [0, 1, 247, 248, 385, 386, 3300, 3301, 4000]) {
    const one = modeledCost(id, 8000, reuse), two = modeledCost(id, 16000, reuse);
    assert.equal(two.ordinary, one.ordinary * 2n); assert.equal(two.supercache, one.supercache * 2n);
    assert.equal(two.cheaper, one.cheaper);
    const next = modeledCost(id, 8000, Math.min(4000, reuse + 1));
    assert.ok(next.ordinary >= one.ordinary && next.supercache >= one.supercache);
  }
});

test('malformed input, invalid profiles and unsupported bounds cannot yield plausible costs', () => {
  for (const value of [0, 1024, 128001, -1, 1.5, NaN, Infinity, '1e4', '', '8,000', null, true]) {
    assert.throws(() => modeledCost('pro-flex', value, 1), RangeError);
  }
  for (const value of [-1, 4001, 0.5, NaN, '1e3', '', null, true]) assert.throws(() => modeledCost('pro-flex', 8000, value), RangeError);
  assert.throws(() => modeledCost('__proto__', 8000, 1), RangeError);
  assert.throws(() => modeledCost('unknown', 8000, 1), RangeError);
  assert.throws(() => dollars(-1n), TypeError);
  assert.throws(() => dollars(0.001), TypeError);
});

test('local controls update plot and exact results, preserve keyboard labels and hide invalid output', () => {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.textContent = ''; this.listeners = {}; }
    append(...children) { this.children.push(...children); } replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; } removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    text() { return this.textContent + this.children.map(child => child.text()).join(' '); }
    all(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(child => child.all(tag))]; }
  }
  const previous = globalThis.document, oldFetch = globalThis.fetch;
  globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  globalThis.fetch = () => { throw new Error('A local calculator must not fetch'); };
  try {
    const target = new Element('div'); mountCache(target);
    assert.match(target.text(), /\$0\.005456/); assert.match(target.text(), /3,301 reuses/);
    const tokens = target.all('input').find(e => e.id === 'cache-tokens');
    const reuses = target.all('input').find(e => e.id === 'cache-reuses');
    const slider = target.all('input').find(e => e.type === 'range');
    assert.ok(target.all('label').some(e => e.htmlFor === tokens.id));
    assert.ok(target.all('label').some(e => e.htmlFor === reuses.id));
    assert.ok(slider.attributes['aria-label']);
    reuses.value = '3300'; reuses.listeners.input();
    assert.equal(target.all('dd')[0].textContent, target.all('dd')[1].textContent);
    slider.value = '3301'; slider.listeners.input(); assert.equal(reuses.value, '3301');
    tokens.value = ''; tokens.listeners.input();
    assert.equal(tokens.attributes['aria-invalid'], 'true');
    assert.equal(target.children[2].hidden, true); assert.match(target.text(), /Use 1,025/);
    tokens.value = '8000'; tokens.listeners.input(); assert.equal(target.children[2].hidden, false);
    const select = target.all('select')[0]; select.value = 'kimi-balanced'; select.listeners.change();
    assert.match(target.text(), /Break-even 247.5/); assert.match(target.text(), /248 reuses/);
    assert.equal(target.all('svg')[0].attributes.role, 'img');
    assert.equal(target.all('details').length, 1);
    assert.ok(target.all('a').every(link => link.href.startsWith('https://')));
    assert.match(target.text(), /not a Supercache test/);
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    globalThis.fetch = oldFetch;
  }
});

test('optional UI starts collapsed and published build hooks expose only the static script', async () => {
  const html = await readFile(new URL('../portfolio/index.html', import.meta.url), 'utf8');
  const details = html.match(/<details\b[^>]*id="cache-calculator"[^>]*>/)?.[0];
  assert.ok(details); assert.doesNotMatch(details, /\bopen(?:\s|=|>)/);
  assert.match(html, /src="\.\/cache\.js" type="module"/);
  const source = await readFile(new URL('../portfolio/cache.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|sessionStorage|sendBeacon|\.innerHTML/);
  assert.match(await readFile(new URL('../build.mjs', import.meta.url), 'utf8'), /portfolio\/cache\.js/);
});
