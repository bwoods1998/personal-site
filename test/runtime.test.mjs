import test from 'node:test';
import assert from 'node:assert/strict';
import { validRuntime, validPortfolio, sourceUrl, money, percent, chartData, mountRuntime, loadRuntime, startRuntime, activityStatus } from '../portfolio/runtime.js';

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
  querySelectorAll(selector) {
    if (selector.startsWith('details')) return this.all('details').filter(node => !selector.includes('[open]') || node.open);
    if (selector.startsWith('.')) return this.all('span').filter(node => node.className.split(' ').includes(selector.slice(1)));
    return [];
  }
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

test('unpaid dividends count in total value and returns without becoming cash', () => {
  const state = fixture(); state.portfolio = invested();
  const p = state.portfolio;
  state.published_at = '2026-09-14T15:00:00Z';
  p.dividend_receivable = '20'; p.equity = '100070';
  p.performance.investment_pnl = '70'; p.performance.time_weighted_return_pct = '0.07';
  p.performance.benchmark.excess_return_percentage_points = '-0.03';
  p.history.at(-1).equity = '100070'; p.history.at(-1).time_weighted_return_pct = '0.07';
  assert(validRuntime(state));
  const oldDocument = globalThis.document;
  globalThis.document = documentStub();
  try {
    const target = new Node('main'); mountRuntime(state, target);
    assert(target.textContent.includes('Cash$90,000.00'));
    assert(target.textContent.includes('Dividends pending$20.00'));
    assert.equal(p.net_deposits, '0');
  } finally { globalThis.document = oldDocument; }
  for (const mutate of [
    x => { x.cash = '90020'; }, // Cannot count the same dividend as cash and receivable.
    x => { x.equity = '100050'; }, // Cannot omit the earned entitlement from value.
    x => { x.performance.investment_pnl = '50'; },
    x => { x.history.at(-1).equity = '100050'; },
  ]) { const invalid = structuredClone(p); mutate(invalid); assert.equal(validPortfolio(invalid), false); }
});

test('dividend publication remains compatible with old checkpoints and rejects malformed receivables', () => {
  const p = portfolio(); assert(validPortfolio(p));
  p.dividend_receivable = '0'; assert(validPortfolio(p));
  for (const amount of [null, 0, '-1', '2e1', 'NaN', '1.000000000000001', {}]) {
    assert.equal(validPortfolio({ ...p, dividend_receivable: amount }), false);
  }
  assert.equal(validPortfolio({ ...p, dividend_payment_details: {} }), false);
  const oldDocument = globalThis.document;
  globalThis.document = documentStub();
  try {
    const state = fixture(); state.portfolio = p;
    const target = new Node('main'); mountRuntime(state, target);
    assert(!target.textContent.includes('Dividends pending'));
  } finally { globalThis.document = oldDocument; }
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
    assert.match(target.textContent, /Paper orders await market-session prices/);
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

function activeFixture() {
  const state = fixture();
  state.research.status = 'running';
  state.sail = { status: 'running', started_at: '2026-09-13T18:00:00Z', ends_at: '2026-09-13T23:00:00Z', known_cost_usd: '3.142', unsettled_requests: 8,
    activity: { heartbeat_at: '2026-09-13T18:30:00Z', completed_requests: 42, total_requests: 50,
      companies_researched: 28, universe_size: 503, reserved_cost_usd: '1.72', tasks: [
        { symbol: 'NVDA', kind: 'company', profile: 'pro_flex', status: 'running' },
        { symbol: 'JPM', kind: 'fresh_review', profile: 'kimi_flex', status: 'running' },
        { symbol: null, kind: 'portfolio_critic', profile: 'k3', status: 'queued' },
      ] },
  };
  return state;
}

test('optional public activity accepts only bounded typed operational facts', () => {
  assert(validRuntime(activeFixture()));
  for (const mutate of [
    a => { a.completed_requests = 51; },
    a => { a.total_requests = 1.5; },
    a => { a.companies_researched = 504; },
    a => { a.universe_size = 0; },
    a => { a.reserved_cost_usd = '-1'; },
    a => { a.heartbeat_at = '2026-09-13T18:31:00Z'; },
    a => { a.tasks.push(a.tasks[0]); },
    a => { a.tasks[0].symbol = '<script>'; },
    a => { a.tasks[0].kind = 'raw private reasoning'; },
    a => { a.tasks[0].profile = 'unknown-model'; },
    a => { a.tasks[0].status = 'completed'; },
    a => { a.tasks[0].request_id = 'private'; },
    a => { a.raw_response = 'private'; },
  ]) {
    const state = activeFixture(); mutate(state.sail.activity); assert.equal(validRuntime(state), false);
  }
  const state = activeFixture(); state.sail.activity = null; assert.equal(validRuntime(state), false);
});

test('current work renders actual tasks and separates known charges from unsettled reservations', () => {
  const previous = globalThis.document; globalThis.document = documentStub();
  try {
    const target = new Node('main'); mountRuntime(activeFixture(), target);
    assert.match(target.textContent, /42 \/ 50/);
    assert.match(target.textContent, /28 \/ 503/);
    assert.match(target.textContent, /Known inference cost\$3.14/);
    assert.match(target.textContent, /\$1.72 reserved · 8 unsettled requests/);
    assert.match(target.textContent, /NVDA · Company research/);
    assert.match(target.textContent, /Kimi K3 · Queued/);
    assert.equal(target.all('ul').filter(node => node.className === 'active-tasks')[0].children.length, 3);
    assert.match(target.textContent, /Run deadline/);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('deadline-critical allocation accepts and renders the Pro ASAP profile', () => {
  const state = activeFixture();
  state.sail.activity.tasks = [{ symbol: null, kind: 'allocation', profile: 'pro_asap', status: 'running' }];
  assert(validRuntime(state));
  const previous = globalThis.document; globalThis.document = documentStub();
  try {
    const target = new Node('main'); mountRuntime(state, target);
    assert.match(target.textContent, /Portfolio allocation/);
    assert.match(target.textContent, /DeepSeek V4 Pro · ASAP · In progress/);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('unchanged checkpoints age visibly without new provider calls or full page replacement', async () => {
  const previous = globalThis.document, oldFetch = globalThis.fetch, oldNow = Date.now;
  globalThis.document = documentStub(); const state = activeFixture();
  let at = Date.parse('2026-09-13T18:30:05Z'); Date.now = () => at;
  globalThis.fetch = async () => new Response(JSON.stringify(state), { status: 200 });
  try {
    const target = new Node('main'); await loadRuntime(target);
    assert.match(target.textContent, /Updated · just now/);
    const firstChild = target.children[0];
    at += 5 * 60000; await loadRuntime(target);
    assert.match(target.textContent, /Checkpoint delayed · 5m ago/);
    assert.equal(target.children[0], firstChild);
    assert(activityStatus(state.sail, at).delayed);
    state.sail.status = 'complete'; assert.equal(activityStatus(state.sail, at).delayed, false);
  } finally {
    Date.now = oldNow; globalThis.fetch = oldFetch;
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

test('persistent service reports deliberate waiting without pretending epoch work is running', () => {
  const state = fixture();
  state.service = { id: 'week-test', status: 'waiting', next_wake_at: '2026-09-14T12:00:00Z', heartbeat_at: state.published_at, week_ends_at: '2026-09-18T22:00:00Z', reason_code: 'scheduled_wait' };
  assert(validRuntime(state));
  const old = globalThis.document; globalThis.document = documentStub();
  try {
    const root = new Node('div'); mountRuntime(state, root);
    assert.match(root.textContent, /Between research sessions/);
    assert.match(root.textContent, /Next check/);
    assert.doesNotMatch(root.textContent, /Next session/);
    assert.equal(root.all('a').filter(a => a.href === '/portfolio/research/').length, 1);
  } finally { globalThis.document = old; }
  state.service.private_error = 'private'; assert.equal(validRuntime(state), false); delete state.service.private_error;
  state.service.heartbeat_at = '2027-01-01T00:00:00Z'; assert.equal(validRuntime(state), false);
});

test('service credit waiting overrides a running rehearsal and hides queued work', () => {
  const state = activeFixture();
  state.service = { id: 'week-test', status: 'waiting', next_wake_at: null, heartbeat_at: state.published_at, week_ends_at: '2026-09-19T04:00:00Z', reason_code: 'funding_needed',
    rehearsal: { starts_at: '2026-09-13T18:00:00Z', ends_at: '2026-09-13T23:00:00Z', status: 'running', completed_at: null } };
  const old = globalThis.document; globalThis.document = documentStub();
  try {
    const root = new Node('div'); mountRuntime(state, root);
    assert.match(root.textContent, /Awaiting research credit/);
    assert.match(root.textContent, /Research resumes when credit is available/);
    assert.doesNotMatch(root.textContent, /Rehearsal running|In progress|Queued/);
    assert.match(root.textContent, /42 \/ 50/);
    // A quiet checkpoint alone cannot establish a stall; service state remains authoritative.
    state.service.status = 'running'; state.service.reason_code = null;
    state.sail.activity.tasks = []; mountRuntime(state, root);
    assert.match(root.textContent, /Rehearsal running/);
    assert.doesNotMatch(root.textContent, /Awaiting research credit/);
  } finally { globalThis.document = old; }
});

test('epoch coverage and missing decisions are scoped to this session, not the entire project', () => {
  const state = activeFixture();
  state.service = { id: 'week-test', status: 'running', next_wake_at: null, heartbeat_at: state.published_at, week_ends_at: '2026-09-19T04:00:00Z', reason_code: null };
  state.research.question = '28 of 503 stocks researched. Which businesses justify a place in the portfolio?';
  const old = globalThis.document; globalThis.document = documentStub();
  try {
    const root = new Node('div'); mountRuntime(state, root);
    assert.match(root.textContent, /This session: 28 of 503 stocks researched/);
    assert.match(root.textContent, /Companies this session28 \/ 503/);
    assert.match(root.textContent, /No new allocation decision this session/);
    state.research.question = '0 of 503 stocks researched. Which businesses justify a place in the portfolio?';
    state.sail.activity.companies_researched = 0; mountRuntime(state, root);
    assert.match(root.textContent, /This session: 0 of 503 stocks researched/);
    assert.match(root.textContent, /Requests completed42 \/ 50/);
    assert.doesNotMatch(root.textContent, /No allocation decision published yet/);
    delete state.service; mountRuntime(state, root);
    assert.doesNotMatch(root.textContent, /This session:|Companies this session/);
  } finally { globalThis.document = old; }
});

test('retained research coverage has an explicit scope while older session checkpoints stay valid', () => {
  const state = activeFixture();
  state.service = { id: 'week-test', status: 'waiting', next_wake_at: null, heartbeat_at: state.published_at, week_ends_at: '2026-09-19T04:00:00Z', reason_code: 'scheduled_wait' };
  state.sail.activity.coverage_scope = 'retained';
  state.sail.activity.companies_researched = 180;
  state.research.question = '180 of 503 stocks researched.';
  assert(validRuntime(state));
  const old = globalThis.document; globalThis.document = documentStub();
  try {
    const root = new Node('div'); mountRuntime(state, root);
    assert.match(root.textContent, /180 of 503 stocks researched/);
    assert.match(root.textContent, /Retained company research180 \/ 503/);
    assert.doesNotMatch(root.textContent, /This session:|Companies this session/);
    state.sail.activity.coverage_scope = 'session'; mountRuntime(state, root);
    assert.match(root.textContent, /This session: 180 of 503/);
  } finally { globalThis.document = old; }
  for (const scope of [null, 'current_facts_verified', 1, {}]) {
    state.sail.activity.coverage_scope = scope; assert.equal(validRuntime(state), false);
  }
});

test('rehearsal checkpoints show bounded work without marking the week complete', () => {
  const state = activeFixture();
  state.service = { id: 'week-test', status: 'running', next_wake_at: null, heartbeat_at: state.published_at, week_ends_at: '2026-09-19T04:00:00Z', reason_code: null,
    rehearsal: { starts_at: '2026-09-13T18:00:00Z', ends_at: '2026-09-13T23:00:00Z', status: 'running', completed_at: null } };
  assert(validRuntime(state));
  const old = globalThis.document; globalThis.document = documentStub();
  try {
    const root = new Node('div'); mountRuntime(state, root);
    assert.match(root.textContent, /Rehearsal running/);
    assert.match(root.textContent, /Week ends/);
    state.published_at = state.service.heartbeat_at = '2026-09-13T23:05:00Z';
    state.service.status = 'waiting'; state.service.next_wake_at = '2026-09-14T04:00:00Z';
    state.service.rehearsal.status = 'complete'; state.service.rehearsal.completed_at = state.published_at;
    state.sail.status = 'complete';
    assert(validRuntime(state)); mountRuntime(state, root);
    assert.match(root.textContent, /Between research sessions/);
    assert.match(root.textContent, /Completed/);
    assert.doesNotMatch(root.textContent, /Week complete/);
  } finally { globalThis.document = old; }
  for (const mutate of [
    r => { r.private_error = 'not public'; },
    r => { r.completed_at = null; },
    r => { r.completed_at = '2026-09-13T22:00:00Z'; },
    r => { r.completed_at = '2026-09-14T04:00:00Z'; },
    r => { r.status = 'running'; },
  ]) {
    const changed = structuredClone(state); mutate(changed.service.rehearsal);
    assert.equal(validRuntime(changed), false);
  }
});
