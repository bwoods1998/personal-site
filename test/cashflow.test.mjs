import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validCashflow, cashflowView, periodValue, formatMillions, mountCashflow } from '../portfolio/cashflow.js';
const data = JSON.parse(await readFile(new URL('../portfolio/cashflow.json', import.meta.url), 'utf8'));

test('checked annual bridge and complete change reconcile to reported operating cash flow', () => {
  assert(validCashflow(data));
  assert.equal(cashflowView(data, 'FY2025').total, 136162n);
  assert.equal(cashflowView(data, 'FY2026').total, 182935n);
  const change = cashflowView(data);
  assert.equal(change.total, 46773n);
  assert.deepEqual(change.rows.map(row => row.value), [31917n, 9101n, 431n, -16376n, 21245n, 455n]);
  for (const period of ['FY2025', 'FY2026', 'change']) {
    const view = cashflowView(data, period);
    assert.equal(view.rows[0].start, 0n);
    assert.equal(view.rows.at(-1).end, view.total);
    for (let i = 1; i < view.rows.length; i++) assert.equal(view.rows[i].start, view.rows[i - 1].end);
    for (const row of view.rows) for (const point of [row.start, row.end]) assert(point >= view.minimum && point <= view.maximum);
  }
});

test('nine-row detail includes offsets to selected favorable cash-flow contributions', () => {
  assert.equal(cashflowView(data, 'FY2025', true).total, -5350n);
  assert.equal(cashflowView(data, 'FY2026', true).total, -4895n);
  const view = cashflowView(data, 'change', true);
  assert.equal(view.rows.length, 9); assert.equal(view.total, 455n);
  const selected = view.rows.filter(row => ['accounts_payable', 'unearned_revenue'].includes(row.id));
  assert.equal(selected.reduce((sum, row) => sum + row.value, 0n), 8622n);
  assert.equal(view.rows.filter(row => !selected.includes(row)).reduce((sum, row) => sum + row.value, 0n), -8167n);
});

test('strict publication boundary rejects private fields, changed scope, provenance and inconsistent numbers', () => {
  for (const change of [
    d => { d.raw_response = 'private'; }, d => { d.source.access_token = 'private'; },
    d => { d.company = 'Portfolio'; }, d => { d.unit = 'USD billions'; },
    d => { d.scope = 'ai_only'; }, d => { d.basis = 'quarterly'; },
    d => { d.source.sha256 = '0'.repeat(64); }, d => { d.source.url = 'https://example.com'; },
    d => { d.source.fetched_at = '2026-02-30T00:00:00Z'; },
    d => { d.provenance.audit_sha256 = '../.data'; },
    d => { d.groups.pop(); }, d => { d.groups.reverse(); },
    d => { d.details[1] = d.details[0]; }, d => { d.details[0].FY2026 = '-12736'; },
    d => { d.groups[0].FY2026 = '133750'; }, d => { d.totals.FY2026 = '182936'; },
    d => { d.groups[0].FY2025 = 101832; }, d => { d.groups[0].FY2025 = '1e5'; },
    d => { d.groups[0].FY2025 = 'NaN'; }, d => { d.groups[0].FY2025 = '0101832'; },
  ]) {
    const copy = structuredClone(data); change(copy);
    assert.equal(validCashflow(copy), false);
    assert.throws(() => cashflowView(copy), TypeError);
  }
});

test('integer presentation preserves millions, small contributions, signs and zero without rounding', () => {
  assert.equal(formatMillions(182935n), '182,935');
  assert.equal(formatMillions(455n, true), '+455');
  assert.equal(formatMillions(-8167n, true), '−8,167');
  assert.equal(formatMillions(0n, true), '0');
  assert.equal(periodValue({ FY2025: '-1', FY2026: '0' }, 'change'), 1n);
  assert.throws(() => periodValue(data.totals, 'quarter'), TypeError);
  assert.throws(() => formatMillions(0.455), TypeError);
});

test('period buttons update both bridges locally and preserve accessible pressed state', () => {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.textContent = ''; this.listeners = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, callback) { this.listeners[key] = callback; }
    text() { return this.textContent + this.children.map(item => item.text()).join(' '); }
    all(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(item => item.all(tag))]; }
  }
  const priorDocument = globalThis.document, priorFetch = globalThis.fetch;
  globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  globalThis.fetch = () => { throw new Error('Visitor controls must not fetch'); };
  try {
    const target = new Element('div'); mountCashflow(data, target);
    const buttons = target.all('button');
    assert.deepEqual(buttons.map(item => item.attributes['aria-pressed']), ['false', 'false', 'true']);
    assert.match(target.text(), /\+46,773/); assert.match(target.text(), /\+455/);
    assert.match(target.text(), /USD millions/); assert.match(target.text(), /Company-wide/);
    buttons[0].listeners.click();
    assert.equal(buttons[0].attributes['aria-pressed'], 'true');
    assert.match(target.text(), /136,162/); assert.match(target.text(), /−5,350/);
    buttons[1].listeners.click();
    assert.match(target.text(), /182,935/); assert.match(target.text(), /−4,895/);
    assert.equal(target.all('details').length, 2);
    assert.equal(target.all('svg').length, 17);
    assert(target.all('svg').every(item => item.attributes['aria-hidden'] === 'true'));
    assert(target.all('a').every(item => item.href.startsWith('https://') && item.rel === 'noopener noreferrer'));
    assert(target.all('span').some(item => item.attributes['aria-live'] === 'polite'));
  } finally {
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
  }
});

test('build and static server allowlist validate and serve only the checked projection', async () => {
  const html = await readFile(new URL('../portfolio/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="cashflow"[^>]*hidden/); assert.match(html, /src="\.\/cashflow\.js" type="module"/);
  const build = await readFile(new URL('../build.mjs', import.meta.url), 'utf8');
  assert.match(build, /validCashflow\(JSON\.parse\(cashflow\)\)/);
  assert.match(build, /portfolio\/cashflow\.json\\n  Cache-Control: no-cache/);
  const source = await readFile(new URL('../portfolio/cashflow.js', import.meta.url), 'utf8');
  assert.equal((source.match(/\bfetch\(/g) || []).length, 1);
  assert.match(source, /fetch\('\.\/cashflow\.json'/);
  assert.doesNotMatch(source, /\.innerHTML|localStorage|sessionStorage|sendBeacon|\/api\//);
});
