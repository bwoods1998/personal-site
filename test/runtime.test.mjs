import test from 'node:test';
import assert from 'node:assert/strict';
import { validRuntime, validPortfolio, sourceUrl, money, percent, chartData, mountRuntime, loadRuntime, startRuntime } from '../portfolio/runtime.js';

function portfolio() {
  return {
    schema_version: 1, mode: 'paper', currency: 'USD', status: 'cash',
    created_at: '2026-09-13T18:00:00Z', as_of: '2026-09-13T18:00:00Z',
    initial_cash: '100000', cash: '100000', equity: '100000', net_deposits: '0', trading_fees: '0',
    holdings: [], pending_decisions: [],
    performance: { started_at: null, time_weighted_return_pct: null, investment_pnl: null,
      benchmark: { name: 'S&P 500 Total Return', status: 'unavailable', return_pct: null, excess_return_percentage_points: null } },
    history: [],
  };
}
function fixture() {
  return {
    schema_version: 1, published_at: '2026-09-13T18:30:00Z', portfolio: portfolio(),
    research: { status: 'not_started', updated_at: null, question: 'Which companies merit investment?', next: 'Prepare source-backed research.' },
    latest_decision: null,
    sail: { status: 'not_started', started_at: null, ends_at: null, known_cost_usd: '0', unsettled_requests: 0 },
  };
}
function invested() {
  const p = portfolio();
  Object.assign(p, { status: 'invested', cash: '90000', equity: '100050', as_of: '2026-09-14T15:00:00Z' });
  p.holdings = [{ symbol: 'MSFT', quantity: '20', price: '502.5', market_value: '10050' }];
  p.performance = {
    started_at: '2026-09-14T14:00:00Z', time_weighted_return_pct: '0.05', investment_pnl: '50',
    benchmark: { name: 'S&P 500 Total Return', status: 'available', return_pct: '0.1', excess_return_percentage_points: '-0.05' },
  };
  p.history = [
    { at: '2026-09-14T14:00:00Z', equity: '100000', time_weighted_return_pct: '0', benchmark_return_pct: '0' },
    { at: '2026-09-14T15:00:00Z', equity: '100050', time_weighted_return_pct: '0.05', benchmark_return_pct: '0.1' },
  ];
  return p;
}

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.className = ''; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  all(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.all(tag)]); }
  querySelectorAll(selector) { return selector.startsWith('details') ? this.all('details').filter(node => !selector.includes('[open]') || node.open) : []; }
}
function documentStub() {
  const listeners = new Map();
  return { createElement: tag => new Node(tag), createElementNS: (_ns, tag) => new Node(tag), querySelector: () => null,
    visibilityState: 'visible', addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name), listeners };
}

// Fixture states represent test-only observations, never published by the build.
test('paper states distinguish initialization, pending orders and recorded performance', () => {
  assert(validRuntime(fixture()));
  const state = fixture(); state.portfolio = null; assert(validRuntime(state));
  const pending = portfolio(); pending.status = 'pending';
  pending.pending_decisions = [{ id: 'decision-1', decided_at: '2026-09-13T18:10:00Z', targets: [{ symbol: 'BRK.B', weight: '0.2' }, { symbol: 'MSFT', weight: '0.3' }], evidence_count: 2 }];
  assert(validPortfolio(pending));
  assert.equal(pending.history.length, 0);
  assert(validPortfolio(invested()));
});

test('publication rejects private fields, invented performance, broken marks and malformed chronology', () => {
  for (const mutate of [
    s => { s.secret = 'private'; },
    s => { s.portfolio.mode = 'live'; },
    s => { s.portfolio.account_number = 'private'; },
    s => { s.portfolio.equity = '99999'; },
    s => { s.portfolio.cash = '1e5'; },
    s => { s.portfolio.cash = '-1'; },
    s => { s.portfolio.performance.time_weighted_return_pct = '12'; },
    s => { s.portfolio.performance.benchmark.name = 'SPY'; },
    s => { s.portfolio.performance.benchmark.return_pct = '0'; },
    s => { s.portfolio.history.push({ at: '2026-09-13T18:10:00Z', equity: '100000', time_weighted_return_pct: '0', benchmark_return_pct: null }); },
    s => { s.research.raw_reasoning = 'private'; },
    s => { s.research.updated_at = '2026-09-13T19:00:00Z'; },
    s => { s.research.status = 'approved'; },
    s => { s.published_at = '2026-02-30T12:00:00Z'; },
    s => { s.sail.known_cost_usd = '-1'; },
    s => { s.sail.status = 'running'; },
    s => { s.sail.unsettled_requests = 1.5; },
    s => { s.sail.trace_url = 'private'; },
  ]) {
    const state = fixture(); mutate(state); assert.equal(validRuntime(state), false, JSON.stringify(state));
  }
  for (const mutate of [
    p => { p.holdings[0].market_value = '10049'; },
    p => { p.performance.investment_pnl = '500'; },
    p => { p.performance.benchmark.excess_return_percentage_points = '0.05'; },
    p => { p.performance.started_at = '2026-09-14T14:01:00Z'; },
    p => { p.history[1].equity = '100500'; },
    p => { p.history[1].time_weighted_return_pct = '0.06'; },
    p => { p.holdings[0].price = null; },
    p => { p.holdings[0].secret = 'private'; },
    p => { p.holdings.push(structuredClone(p.holdings[0])); },
    p => { p.history[1].at = p.history[0].at; },
    p => { p.history.reverse(); },
    p => { p.history[1].raw_quote = 'private'; },
    p => { p.history[1].at = '2026-09-15T12:00:00Z'; },
  ]) { const p = invested(); mutate(p); assert.equal(validPortfolio(p), false); }
});

test('allocation weights are fractional and constrained to available capital', () => {
  const p = portfolio(); p.status = 'pending';
  p.pending_decisions = [{ id: 'decision', decided_at: '2026-09-13T18:10:00Z', targets: [{ symbol: 'MSFT', weight: '0.5' }], evidence_count: 1 }];
  assert(validPortfolio(p));
  p.pending_decisions[0].targets.push({ symbol: 'AAPL', weight: '0.50000000000001' });
  assert.equal(validPortfolio(p), false);
  p.pending_decisions[0].targets[1].weight = '0.5'; assert(validPortfolio(p));
  p.pending_decisions[0].targets[1].symbol = 'MSFT'; assert.equal(validPortfolio(p), false);
});

test('source navigation excludes private or active URLs and unrelated hosts', () => {
  assert.equal(sourceUrl('https://www.sec.gov/Archives/edgar/data/1/report.htm'), 'https://www.sec.gov/Archives/edgar/data/1/report.htm');
  for (const value of ['http://www.sec.gov/report', 'javascript:alert(1)', 'https://www.sec.gov.evil.test/', 'https://key:secret@www.sec.gov/', 'https://127.0.0.1/', 'https://www.sec.gov/report?token=private', 'https://www.sec.gov/report#private', 'https://github.com/other/repo', null]) assert.equal(sourceUrl(value), null);
  const state = fixture();
  state.latest_decision = { at: '2026-09-13T18:15:00Z', action: 'hold', summary: 'Retain cash while verifying sources.', sources: [{ title: 'SEC filing', url: 'https://www.sec.gov/Archives/edgar/data/1/report.htm' }] };
  assert(validRuntime(state)); state.latest_decision.sources[0].raw_document = 'private'; assert.equal(validRuntime(state), false);
});

test('money preserves exact cents and returns retain signs and units', () => {
  assert.equal(money('999999999999999.995'), '$1,000,000,000,000,000.00');
  assert.equal(money('100000'), '$100,000.00');
  assert.equal(money('-1.235'), '−$1.24');
  assert.equal(money(null), '—');
  assert.equal(percent('0'), '0.00%');
  assert.equal(percent('-0.00001'), '0.00%');
  assert.equal(percent('0.052'), '+0.05%');
  assert.equal(percent('-0.05', ' pp'), '−0.05 pp');
  assert.equal(percent(null), '—');
});

test('charts require distinct sourced times and never manufacture benchmark observations', () => {
  assert.equal(chartData([]), null);
  const history = invested().history;
  assert.equal(chartData(history.slice(0, 1)), null);
  assert(chartData(history).benchmark);
  history[1].benchmark_return_pct = null;
  assert.equal(chartData(history).benchmark, null);
  assert(chartData(history).portfolio);
  history[1].at = history[0].at; assert.equal(chartData(history), null);
});

test('rendering keeps pending targets separate from holdings, literal text and no fabricated chart', () => {
  const previous = globalThis.document; globalThis.document = documentStub();
  try {
    const target = new Node('main'); const state = fixture();
    state.portfolio.status = 'pending';
    state.portfolio.pending_decisions = [{ id: 'first', decided_at: '2026-09-13T18:01:00Z', targets: [{ symbol: 'MSFT', weight: '0.2' }], evidence_count: 1 }];
    state.latest_decision = { at: '2026-09-13T18:01:00Z', action: 'rebalance', summary: '<img src=x onerror=alert(1)>', sources: [] };
    mountRuntime(state, target);
    assert.match(target.textContent, /Paper trading · Schwab not connected/);
    assert.match(target.textContent, /\$100,000.00 virtual capital/);
    assert.match(target.textContent, /No performance record yet/);
    assert.match(target.textContent, /Pending allocationMSFT20%/);
    assert.match(target.textContent, /fresh regular-session quotes/);
    assert.match(target.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.equal(target.all('img').length, 0);
    assert.equal(target.all('svg').length, 0);
    assert.equal(target.all('input').length, 0);
    assert.equal(target.attributes['aria-busy'], 'false');
    state.portfolio = invested(); state.published_at = '2026-09-14T15:30:00Z';
    mountRuntime(state, target);
    assert.equal(target.all('svg').length, 1);
    assert.equal(target.all('table').length, 1);
    assert.match(target.textContent, /S&P 500 Total Return/);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('live reads fall back safely, revalidate with ETags and do not replace newer state with old files', async () => {
  const previous = globalThis.document, oldFetch = globalThis.fetch;
  globalThis.document = documentStub();
  const target = new Node('main'), original = fixture();
  const newer = fixture(); newer.published_at = '2026-09-13T18:40:00Z'; newer.research.question = 'A newer research question.';
  const requests = []; let phase = 0;
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    if (path === './runtime.json') return new Response(JSON.stringify(original), { status: 200 });
    if (phase === 0 || phase === 3) return new Response('Unavailable', { status: 503 });
    if (phase === 2) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(newer), { status: 200, headers: { etag: '"new-state"' } });
  };
  try {
    await loadRuntime(target); assert.match(target.textContent, /Which companies/);
    phase = 1; await loadRuntime(target); assert.match(target.textContent, /A newer research question/);
    phase = 2; await loadRuntime(target); assert.match(target.textContent, /A newer research question/);
    assert.equal(requests.at(-1).options.headers['If-None-Match'], '"new-state"');
    phase = 3; await loadRuntime(target); assert.match(target.textContent, /A newer research question/);
    assert(requests.every(request => request.options.method === 'GET' && request.options.credentials === 'omit'));
  } finally {
    globalThis.fetch = oldFetch;
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

test('refresh scheduling is minute-paced and stops requesting while hidden', async () => {
  const previous = globalThis.document, oldFetch = globalThis.fetch, oldInterval = globalThis.setInterval, oldClear = globalThis.clearInterval;
  const doc = documentStub(); globalThis.document = doc;
  let callback, intervalDelay, requests = 0, cleared = false;
  globalThis.setInterval = (fn, delay) => { callback = fn; intervalDelay = delay; return 42; };
  globalThis.clearInterval = handle => { assert.equal(handle, 42); cleared = true; };
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify(fixture()), { status: 200 }); };
  try {
    const target = new Node('main'); const stop = startRuntime(target); await loadRuntime(target);
    assert.equal(intervalDelay, 60000); assert.equal(requests, 1);
    doc.visibilityState = 'hidden'; callback(); assert.equal(requests, 1);
    doc.visibilityState = 'visible'; doc.listeners.get('visibilitychange')(); await loadRuntime(target); assert.equal(requests, 2);
    stop(); assert(cleared); assert.equal(doc.listeners.size, 0);
  } finally {
    globalThis.fetch = oldFetch; globalThis.setInterval = oldInterval; globalThis.clearInterval = oldClear;
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

test('corporate-action suspension retains history without inventing a current mark or excess return', () => {
  const p = invested(); p.status = 'suspended'; p.equity = null;
  p.holdings[0].price = null; p.holdings[0].market_value = null;
  p.performance.time_weighted_return_pct = null; p.performance.investment_pnl = null;
  p.performance.benchmark.excess_return_percentage_points = null;
  assert(validPortfolio(p));
  p.status = 'invested'; assert.equal(validPortfolio(p), false);
});
