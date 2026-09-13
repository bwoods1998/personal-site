import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioJournal, MAX_JOURNAL_BYTES } from '../lib/portfolio-journal.mjs';
import { validEntry, filingUrl } from '../portfolio/research/schema.js';
import { detailView, groupEntries, issueLabel, revealEntry } from '../portfolio/research/research.js';

const secret = 'private-test-journal-token-longer-than32';
function entry(n = 1) {
  return { schema_version: 1, id: n.toString(16).padStart(64, '0'), started_at: '2026-09-13T16:00:00.000Z', completed_at: `2026-09-13T16:${String(n).padStart(2,'0')}:00.000Z`, symbol: 'TEST', kind: 'company', profile: 'kimi_flex', outcome: 'passed', title: 'Cash exceeds debt.', case: 'Cash exceeds debt. Valuation remains uncertain.', questions: [{ symbol: 'TEST', question: 'What valuation supports a purchase?' }], claims: ['assets', 'cash', 'debt'].map((metric, i) => ({ symbol: 'TEST', metric, tag: metric, start: null, end: '2026-06-30', value: String(100 - i * 30), unit: 'USD', source: { title: 'TEST · 10-Q', url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/0001234567-26-000001-index.html' } })), decision: { action: 'research', targets: [], abstain_reason: null }, metrics: { source_checks_passed: true, claims_checked: 3, cost_usd: '0.01', latency_seconds: 60 * n } };
}
function setup() {
  const map = new Map();
  const storage = {
    async get(k) { return structuredClone(map.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [key, value] of Object.entries(k)) map.set(key, structuredClone(value)); else map.set(k, structuredClone(v)); },
    async list({ prefix, end, reverse, limit }) { let rows = [...map].filter(([k]) => k.startsWith(prefix) && (!end || k < end)).sort(([a],[b]) => a.localeCompare(b)); if (reverse) rows.reverse(); return new Map(rows.slice(0, limit)); },
    async transaction(callback) { return callback(storage); },
  };
  return createPortfolioJournal(storage, secret, () => Date.parse('2026-09-14T00:00:00Z'));
}
const req = (method = 'GET', data, path = '', token = secret, extra = {}) => new Request('https://blakewoods.us/api/portfolio/research' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...extra }, ...(data ? { body: JSON.stringify(data) } : {}) });
const batch = (...entries) => ({ schema_version: 1, entries });

test('strict publication strips nothing silently and rejects private or unsafe content', async () => {
  assert(validEntry(entry()));
  for (const mutate of [e => { e.raw_reasoning = 'private'; }, e => { e.case = 'Bearer secret'; }, e => { e.case = 'private@example.com'; }, e => { e.title = '<script>alert(1)</script>'; }, e => { e.claims[0].source.url = 'https://evil.example/'; }, e => { e.claims[0].source.url += '?secret=private'; }, e => { e.metrics.private_id = 'private'; }, e => { e.outcome = 'unverified'; }, e => { e.started_at = '2027-01-01T00:00:00Z'; }]) {
    const e = entry(); mutate(e); assert.equal(validEntry(e), false);
    assert.equal((await setup()(req('POST', batch(e)))).status, 400);
  }
  assert.equal(filingUrl('https://www.sec.gov.evil.example/Archives/edgar/data/1/1/1-index.html'), false);
});
test('authenticated append is immutable, atomic on conflicts and replay-safe', async () => {
  const api = setup(); assert.equal((await api(req('POST', batch(entry()), '', 'wrong'))).status, 401);
  assert.deepEqual(await (await api(req('POST', batch(entry())))).json(), { accepted: 1, inserted: 1 });
  assert.deepEqual(await (await api(req('POST', batch(entry())))).json(), { accepted: 1, inserted: 0 });
  const changed = entry(); changed.title = 'Rewritten history.';
  assert.equal((await api(req('POST', batch(entry(2), changed)))).status, 409);
  assert.equal((await api(req('GET', null, '/' + entry(2).id))).status, 404);
  const reads = await api(req()); const etag = reads.headers.get('ETag');
  assert.equal((await api(req('GET', null, '', secret, { 'If-None-Match': etag }))).status, 304);
  const saved = await api(req('GET', null, '/' + entry().id)); assert.deepEqual(await saved.json(), entry());
});
test('pagination remains stable while newer records arrive and list pages omit full findings', async () => {
  const api = setup(); await api(req('POST', batch(...Array.from({ length: 15 }, (_, i) => entry(i + 1)))));
  const first = await (await api(req())).json(); assert.equal(first.entries.length, 12); assert.equal(first.entries[0].id, entry(15).id);
  assert.equal(Object.hasOwn(first.entries[0], 'case'), false);
  await api(req('POST', batch(entry(16))));
  const next = await (await api(req('GET', null, '?cursor=' + encodeURIComponent(first.next_cursor)))).json();
  assert.deepEqual(next.entries.map(e => e.id), [3,2,1].map(n => entry(n).id)); assert.equal(next.next_cursor, null);
  assert.equal((await api(req('GET', null, '?cursor=../private'))).status, 400);
  assert.equal((await api(req('GET', null, '?cursor=a&cursor=b'))).status, 400);
  assert.equal((await api(req('DELETE', null, '/' + entry().id))).status, 405);
});
test('bounded and timestamped publication cannot be used as unbounded storage', async () => {
  const api = setup(); const future = entry(); future.completed_at = '2027-01-01T00:00:00Z';
  assert.equal((await api(req('POST', batch(future)))).status, 400);
  assert.equal((await api(req('POST', batch(...Array.from({ length: 21 }, (_, i) => entry(i + 1)))))).status, 400);
  assert.equal((await api(req('POST', { filler: 'x'.repeat(MAX_JOURNAL_BYTES) }))).status, 413);
});
test('renderer uses text nodes for finance explanations and keeps methods optional', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this._text = ''; }
    set textContent(v) { this._text = String(v); }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    append(...nodes) { this.children.push(...nodes); }
    get lastChild() { return this.children.at(-1); }
    all(tag) { return this.children.flatMap(c => [...(c.tag === tag ? [c] : []), ...c.all(tag)]); }
  }
  const old = globalThis.document; globalThis.document = { createElement: tag => new Node(tag) };
  try {
    const view = detailView(entry());
    assert.match(view.textContent, /Investment case/); assert.match(view.textContent, /Open questions/); assert.match(view.textContent, /No portfolio order/);
    assert.equal(view.all('details').length, 1); assert.match(view.all('details')[0].textContent, /Completion observed/);
    assert(view.all('a').every(a => a.href.startsWith('https://www.sec.gov/') || a.href.startsWith('/portfolio/research/#')));
  } finally { globalThis.document = old; }
});

test('adjacent unsuccessful requests group without changing order, records or investment findings', () => {
  const records = ['failed', 'failed', 'passed', 'unverified', 'failed', 'passed'].map((outcome, i) => ({ ...entry(i + 1), outcome }));
  const groups = groupEntries(records);
  assert.deepEqual(groups.map(group => group.length), [2, 1, 2, 1]);
  assert.deepEqual(groups.flat(), records);
  assert.equal(issueLabel(groups[0]), '2 requests did not complete');
  assert.equal(issueLabel(groups[2]), '2 requests did not complete or pass checks');
  assert.equal(issueLabel([{ outcome: 'unverified' }, { outcome: 'unverified' }]), '2 requests did not pass checks');
  // A consecutive issue run still groups when it crosses a loaded page boundary.
  assert.equal(groupEntries([...records.slice(0, 1), ...records.slice(1)])[0].length, 2);
});

test('a stable failure link opens its parent group before scrolling to the individual entry', () => {
  const group = { tagName: 'DETAILS', open: false, parentElement: null };
  const row = { parentElement: { tagName: 'DIV', parentElement: group }, open: false, scrollIntoView(options) { assert.equal(group.open, true); assert.equal(this.open, true); assert.equal(options.block, 'start'); this.scrolled = true; } };
  revealEntry(row); assert.equal(row.scrolled, true);
});
