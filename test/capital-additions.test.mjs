// The owner's ideas on the prior page (Oct 1, 2026): each trade's reason, the paths of Profit and Net, the agents' notes
// played in order on the card, the chart's start rule and the agents' marks, the route tags and per-trade results, and the
// game's six rungs on the Agents board. Pure helpers first, then the page mounted on a published record.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  plainTag, tickerCase, feedLine, positionsLedger, tradeReasons, riskTitle, funnelLine, agentStages, rungOf, swarmRows, levelOf, sparkSeries, scoreSeries,
  chartMarks, accountSeries, queueNotes, trimQueue, holdFor, settleAgents, startCapital, LEVEL_WORDS, LEVEL_TITLES, ROUTE_TAGS, INCUBATOR_TITLE,
  PROGRESS_TARGETS, AGENT_STAGES, CHART_START_AT,
} from '../capital/capital.js';
import { floor, post, withBrowser, stubPage, FLOOR_IDS, words, NOW } from './harness.mjs';
import {
  swarmCheckpoint, windowCheckpoint, ledgerCheckpoint, ledger, POSITIONS, STRUCTURES, structure, agent, note, trade, funnel, levelsBlock, rationaleBlock,
  GOOGL_THESIS, PUBLISHED_AT,
} from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
const batch = (...events) => ({ schema_version: 2, events });
const point = (minute, profit, net = profit === null ? null : String((Number(profit) - 300).toFixed(2))) => ({
  at: `2026-09-28T${minute}:00.000Z`, profit_usd: profit, costs_usd: '300.00', net_usd: net });
const SCORE = { schema_version: 2, sampled: false, step_ms: 300000, last_profit: null, last_net: null,
  points: [point('14:40', '190.00'), point('14:45', '201.10'), point('14:50', '208.00'), point('14:55', '211.00')] };
// The GOOGL spread as a real structure too (its ledger row's id), so the dot's detail can carry its reason.
const GOOGL_STRUCTURE = structure('real:8', { agent: 'googl-lags', underlying: 'GOOGL', structure: 'debit_vertical', legs: 2, expiry: '2026-10-07',
  opened_at: '2026-09-28T14:31:00.000Z', max_loss_usd: '157.00', pnl_usd: '-3.00' });
const windowed = (overrides = {}) => windowCheckpoint({ structures: [...STRUCTURES, GOOGL_STRUCTURE], ...overrides });

// ---------------------------------------------------------------------------- §3 why an agent traded that
test('a reason is a plain short tag with its tickers in capitals; a raw tape why never shows', () => {
  assert.equal(plainTag('three sessions up'), null, 'a number written as a word');
  assert.equal(plainTag('IV above 0.4'), null, 'a numeral');
  assert.equal(tickerCase('msft leads googl, qqq flat'), 'MSFT leads GOOGL, QQQ flat');
  assert.equal(tickerCase(plainTag('msft leads googl, qqq flat')), 'MSFT leads GOOGL, QQQ flat');
  // The tape's why can run to 240 characters: past 80, nothing shows inline.
  const long = `The open broke higher on heavy volume ${'and the follow through held '.repeat(5)}into the closing bell.`;
  assert.equal(long.length, 200);
  assert.equal(feedLine(trade('orb-4', { why: long })).why, '');
  assert.equal(feedLine(trade('orb-4', { why: 'msft leads googl, qqq flat', underlying: 'GOOGL' })).why, 'MSFT leads GOOGL, QQQ flat');
  assert.equal(feedLine(trade('orb-4', { why: 'the range broke three times' })).why, '', 'the tape keeps numbers: refused');
});

test('each agent row carries its reason, the family thesis behind it and its maximum loss; a close reason only when the agent closed it', () => {
  const book = positionsLedger(windowed(), at);
  const line = id => [...book.open, ...book.closed].find(row => row.id === id);
  assert.deepEqual([line('real:8').why, line('real:8').thesis, line('real:8').maxLoss, line('real:8').routeKey, line('real:8').route],
    ['MSFT leads GOOGL, QQQ flat', GOOGL_THESIS, '157.00', 'tuition', 'Tuition']);
  assert.equal(line('real:5').exit, 'agent');
  assert.equal(line('real:5').why, 'the open broke higher on heavy volume → target reached before the lunch lull');
  // A close reason the House sent for a trade the agent did not close never reads as the agent's.
  const houseClosed = windowed({ rationale: rationaleBlock({ trades: rationaleBlock().trades.map(entry => (entry.id === 'real:5' ? { ...entry, exit: 'house' } : entry)) }) });
  assert.equal(positionsLedger(houseClosed, at).closed.find(row => row.id === 'real:5').why, 'the open broke higher on heavy volume');
  assert.equal(line('real:9').why, 'gap not confirmed', 'closed by the agent, no close reason sent');
  assert.equal(line('real:9').route, 'Incubator');
  // No tag of its own: the thesis's first sentence, cut to 80 characters.
  assert.equal(line('real:3').why, 'Sells short-dated index premium when realized volatility runs under the level…');
  assert.equal(line('real:4').why, null, 'no reason and no thesis that passes the rules: nothing');
  // Calibration and the House's own rows have none of it.
  assert.deepEqual(['why', 'thesis', 'maxLoss', 'exit', 'routeKey', 'route'].map(key => line('real:1')[key]), [null, null, null, null, null, '']);
  // An older House (no rationale): the table is the prior table.
  const older = positionsLedger(ledgerCheckpoint(), at);
  for (const row of [...older.open, ...older.closed]) assert.deepEqual([row.why, row.thesis, row.maxLoss, row.routeKey], [null, null, null, null], row.id);
  assert.equal(tradeReasons(ledgerCheckpoint()).size, 0);
  assert.equal(riskTitle('-78.56', '157.00'), '−50% of its $157 max loss');
  assert.equal(riskTitle('31.00', '96.00'), '+32% of its $96 max loss');
  assert.equal(riskTitle('0.00', '10.00'), '0% of its $10 max loss');
  assert.equal(riskTitle('1.00', null), '');
});

// ---------------------------------------------------------------------------- §4 and §6 the paths of Profit and Net
test('a sparkline never joins across a null point or a gap over fifteen minutes, and its segments sit end to end in order', () => {
  const points = [point('13:00', '10.00'), point('13:05', '12.00'), point('13:10', null), point('13:15', '11.00'), point('13:20', '9.00'),
    point('13:50', '8.00'), point('13:55', '-4.00'), point('14:00', '-2.00')];
  assert.deepEqual(scoreSeries(points, 'profit_usd').map(segment => segment.length), [2, 2, 3]);
  const series = sparkSeries(points, 'profit_usd', { at: Date.parse('2026-09-28T14:03:00.000Z'), cents: -150n }, { width: 120, height: 24 });
  assert.equal(series.segments.length, 3);
  assert.deepEqual(series.segments.map(segment => segment.points.length), [2, 2, 4], 'the live reading continues the last segment');
  for (const [index, segment] of series.segments.entries()) {
    assert.equal(segment.path.split(/[ML]/).filter(Boolean).length, segment.points.length, 'a path holds only its own points');
    for (const entry of segment.points) assert.ok(entry.x >= segment.from - 1e-9 && entry.x <= segment.to + 1e-9);
    if (index) assert.ok(segment.from > series.segments[index - 1].to, 'disjoint and ordered');
    if (index) assert.equal(Number((segment.from - series.segments[index - 1].to).toFixed(6)), 3, 'a fixed three-pixel gap');
  }
  assert.ok(Math.abs(series.segments.at(-1).to - 120) < 1e-9, 'the last segment ends at the right edge');
  assert.equal(series.last.cents, -150n);
  assert.equal(series.tone, 'negative');
  assert.ok(series.zeroY > 0 && series.zeroY < 24, 'the zero line only when the path crosses it');
  assert.equal(sparkSeries([point('13:00', '1.00'), point('13:05', '2.00')], 'profit_usd').zeroY, null);
  // A live reading more than fifteen minutes after the archive starts its own segment; one no later than the archive is not added.
  assert.equal(sparkSeries(points.slice(0, 2), 'profit_usd', { at: Date.parse('2026-09-28T13:40:00.000Z'), cents: 0n }).segments.length, 2);
  assert.equal(sparkSeries(points.slice(0, 2), 'profit_usd', { at: Date.parse('2026-09-28T13:05:00.000Z'), cents: 0n }).points.length, 2);
  // Fewer than two priced points: nothing.
  assert.equal(sparkSeries([point('13:00', '1.00')], 'profit_usd'), null);
  assert.equal(sparkSeries([point('13:00', null), point('13:05', null)], 'profit_usd', { at: Date.parse('2026-09-28T13:06:00.000Z'), cents: 5n }), null);
  assert.equal(sparkSeries([point('13:00', '1.00')], 'profit_usd', { at: Date.parse('2026-09-28T13:06:00.000Z'), cents: 5n }).points.length, 2);
});

test('the chart marks each agent position at its opening on the chart\'s own time scale, hollow while open; calibration gets none', () => {
  const checkpoint = windowed();
  const series = accountSeries([{ at: '2026-09-28T13:00:00.000Z', equity: '5481.65' }], checkpoint);
  const marks = chartMarks(checkpoint, series, at);
  assert.deepEqual(marks.map(mark => [mark.id, mark.open]), [['real:8', true], ['real:6', true], ['real:7', true], ['real:5', false], ['real:4', false],
    ['real:3', false], ['real:9', false]]);
  const span = series.last.at - Date.parse(CHART_START_AT);
  assert.equal(marks[0].x, (Date.parse('2026-09-28T14:31:00.000Z') - Date.parse(CHART_START_AT)) / span * series.width);
  assert.match(marks[0].label, / · GOOGL call debit vertical · −\$3\.00$/);
  assert.equal(chartMarks(ledgerCheckpoint({ positions: ledger({ rows: [POSITIONS.at(-1)] }), trading: { as_of: PUBLISHED_AT, pnl_usd: '-2.12' } }), series, at).length, 0);
  assert.deepEqual(chartMarks(swarmCheckpoint(), series, at), [], 'no ledger, no marks');
  // An opening before the chart's start is not drawn.
  const early = windowed({ positions: ledger({ rows: POSITIONS.map(row => (row.id === 'real:3' ? { ...row, opened_at: '2026-09-27T09:00:00.000Z' } : row)) }),
    trading: { as_of: PUBLISHED_AT, pnl_usd: '220.40' }, rationale: rationaleBlock({ trades: [] }), levels: null });
  assert.equal(chartMarks(early, series, at).some(mark => mark.id === 'real:3'), false);
});

// ---------------------------------------------------------------------------- §5 the card's queue
test('the queue dedupes, plays oldest first and keeps twelve; it drops what trails the newest by three minutes; holds are shorter while notes wait', () => {
  const at_ = second => `2026-09-28T14:${String(50 + Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}.000Z`;
  const notes = Array.from({ length: 14 }, (_, n) => ({ ...note(`agent-${n}`, `Note ${'word '.repeat(n + 1)}`.trim(), at_(n * 5)), seq: 100 + n }));
  const queue = queueNotes([], [notes[3], notes[1], notes[2]]);
  assert.deepEqual(queue.map(event => event.id), [notes[1], notes[2], notes[3]].map(event => event.id), 'oldest first');
  assert.equal(queueNotes(queue, [notes[2], notes[1]]).length, 3, 'deduped by id');
  const full = queueNotes(queue, notes);
  assert.equal(full.length, 12);
  assert.deepEqual(full.map(event => event.id), notes.slice(2).map(event => event.id), 'the oldest drop first');
  assert.equal(queueNotes([], [trade('orb-4'), { ...note('one', '   '), seq: 1 }, { ...note('Bad Id', 'Words.'), seq: 2 }]).length, 0, 'only an agent\'s plain words');
  const late = [{ ...notes[0], at: '2026-09-28T14:40:00.000Z' }, { ...notes[1], at: '2026-09-28T14:43:00.000Z' }, { ...notes[2], at: '2026-09-28T14:43:01.000Z' },
    { ...notes[3], at: '2026-09-28T14:46:00.000Z' }];
  assert.deepEqual(trimQueue(late).map(event => event.at.slice(11, 19)), ['14:43:00', '14:43:01', '14:46:00'], 'newest − 180 s is kept, older drops');
  assert.deepEqual(trimQueue([]), []);
  // Waiting: max(8 s, min(20 s, words / 3.5 s)). None waiting: the prior max(12 s, min(45 s, words / 3 s + 2 s)).
  const words_ = count => Array(count).fill('word').join(' ');
  assert.deepEqual([holdFor(words_(10), true), holdFor(words_(42), true), holdFor(words_(100), true)], [8000, 12000, 20000]);
  assert.deepEqual([holdFor(words_(10), false), holdFor(words_(45), false), holdFor(words_(200), false)], [12000, 17000, 45000]);
});

// ---------------------------------------------------------------------------- §8 the game's rungs
test('the rungs follow the House\'s levels, an older House\'s band, and a retired agent\'s open money; the funnel reads a dash for an unknown count', () => {
  assert.deepEqual(AGENT_STAGES.map(stage => `${stage.level} ${stage.label}`), ['6 Sized', '5 Probe', '4 Candidate', '3 Tuition', '2 Validation', '1 Train']);
  assert.deepEqual(AGENT_STAGES.filter(stage => stage.real).map(stage => stage.key), ['sized', 'probe', 'tuition']);
  const ids = checkpoint => agentStages(checkpoint).map(stage => stage.agents.map(row => `${row.id}:${row.level}`));
  assert.deepEqual(ids(windowed()), [['condor-vrp-3:sized'], ['orb-4:probe', 'putspread-dip-2:probe'],
    ['butterfly-pin:candidate', 'ironfly-quiet:candidate', 'trend-vertical:candidate'], ['googl-lags:tuition'], ['gap-drift:validation'],
    ['skew-revert:practice', 'calendar-term:train', 'eod-drift:train', 'strangle-cheap:train']], 'the side path first in the Train row');
  // An older House: no levels, so the band decides; a Gym agent trains, unless its real money says it paid tuition.
  const older = windowed({ levels: null, rationale: null });
  assert.deepEqual(ids(older), [['condor-vrp-3:sized'], ['orb-4:probe', 'putspread-dip-2:probe'],
    ['butterfly-pin:candidate', 'ironfly-quiet:candidate', 'trend-vertical:candidate'], ['googl-lags:tuition'], [],
    ['calendar-term:train', 'eod-drift:train', 'gap-drift:train', 'skew-revert:train', 'strangle-cheap:train']]);
  // A retired agent still holding money stands on its money's rung, its retired look kept; the rest leave the board.
  const rows = swarmRows(windowed());
  assert.deepEqual(rows.filter(row => row.band === 'retired').map(row => [row.id, row.level]), [['reversal-1', 'retired'], ['googl-lags', 'tuition']]);
  assert.equal(levelOf(agent('gone', { band: 'retired' }), windowed()), 'retired');
  assert.deepEqual(['train', 'practice', 'incubator', 'validation', 'tuition', 'candidate', 'probe', 'sized', 'retired'].map(rungOf), [1, 1, 1, 2, 3, 4, 5, 6, null]);
  assert.equal(funnelLine(windowed()), '49 born › 9 validation › 7 tuition › 6 candidate › 3 probe › 1 sized');
  assert.equal(funnelLine(windowed({ levels: levelsBlock({ funnel: funnel({ validation: null, born: 2255 }) }) })),
    '2,255 born › — validation › 7 tuition › 6 candidate › 3 probe › 1 sized');
  assert.equal(funnelLine(swarmCheckpoint()), null, 'no funnel, no caption');
  assert.deepEqual(Object.values(PROGRESS_TARGETS).slice(0, 3), ['Candidate', 'Probe', 'Sized'], 'the dot detail reads "Next · Candidate"');
  assert.equal(LEVEL_TITLES.incubator, INCUBATOR_TITLE);
  assert.deepEqual(Object.keys(ROUTE_TAGS), ['tuition', 'incubator', 'probe', 'sized']);
  assert.equal(LEVEL_WORDS.validation, 'Validation');
});

test('a dot glides when its rung changes (train to validation), once, and never under reduced motion', () => {
  const saved = { window: globalThis.window, document: globalThis.document, now: Date.now };
  try {
    Date.now = () => at + 60000;
    globalThis.document = { visibilityState: 'visible' };
    let reduced = false;
    globalThis.window = { scrollX: 0, scrollY: 0, innerHeight: 900, matchMedia: () => ({ matches: reduced }) };
    const calls = [];
    const dot = (level, top) => ({ dataset: { level }, querySelector: () => null, animate: (...args) => calls.push(args),
      getBoundingClientRect: () => ({ left: 100, top, bottom: top + 44, width: 44, height: 44 }) });
    const state = { checkpoint: swarmCheckpoint(), agentPositions: new Map(), dotNodes: new Map([['one', dot('train', 600)]]) };
    settleAgents(state);
    assert.equal(calls.length, 0, 'the first draw never animates');
    state.dotNodes = new Map([['one', dot('validation', 500)]]);
    settleAgents(state);
    assert.equal(calls.length, 1, 'train → validation: one glide');
    assert.deepEqual(calls[0][0], [{ transform: 'translate(0px, 100px)' }, { transform: 'translate(0, 0)' }]);
    state.dotNodes = new Map([['one', dot('validation', 500)]]);
    settleAgents(state);
    assert.equal(calls.length, 1, 'the same rung: no glide');
    state.dotNodes = new Map([['one', dot('practice', 650)]]);
    settleAgents(state);
    assert.equal(calls.length, 2, 'the side path stands on Train: validation → practice is a rung change');
    state.dotNodes = new Map([['one', dot('incubator', 600)]]);
    settleAgents(state);
    assert.equal(calls.length, 2, 'practice → incubator stays on Train: no glide');
    reduced = true;
    state.dotNodes = new Map([['one', dot('tuition', 400)]]);
    settleAgents(state);
    assert.equal(calls.length, 2, 'reduced motion: no glide');
  } finally {
    globalThis.window = saved.window; globalThis.document = saved.document; Date.now = saved.now;
  }
});

// ---------------------------------------------------------------------------- the page, mounted
// A fake clock and timers for the card: `tick(ms)` runs every timer that falls due, in order.
function fakeTimers(start) {
  const saved = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  let clock = start;
  let serial = 0;
  const timers = new Map();
  globalThis.setTimeout = (callback, ms = 0) => { serial += 1; timers.set(serial, { callback, due: clock + ms }); return serial; };
  globalThis.clearTimeout = id => { timers.delete(id); };
  Date.now = () => clock;
  return {
    get now() { return clock; },
    tick(ms) {
      const end = clock + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= end).sort((left, right) => left[1].due - right[1].due)[0];
        if (!next) break;
        timers.delete(next[0]);
        clock = Math.max(clock, next[1].due);
        next[1].callback();
      }
      clock = end;
    },
    restore() { globalThis.setTimeout = saved.set; globalThis.clearTimeout = saved.clear; },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
// SVG nodes carry their class as an attribute.
const svgClass = (node, name) => node.descendants().filter(child => child.getAttribute('class') === name);
// The page on a published record. `routes(path, capital)` may answer a request itself (return undefined to pass it on);
// `/score` answers SCORE unless a route says otherwise. `work` gets the root, the record, and the page's 30-second refresh and
// 8-second poll.
async function mounted(checkpoint, events, work, routes = () => undefined) {
  const { capital } = floor(at + 30000);
  if (events.length) assert.equal((await post(capital, '/api/capital/events', batch(...events))).status, 200);
  if (checkpoint) assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
  const root = stubPage('floor', FLOOR_IDS);
  const answer = async path => {
    const own = await routes(path, capital);
    if (own !== undefined) return own;
    if (path.endsWith('/score')) return SCORE;
    return capital.fetch(new Request('https://blakewoods.us' + path));
  };
  await withBrowser('', answer, async () => {
    const intervals = new Map();
    globalThis.setInterval = (callback, delay) => { intervals.set(delay, callback); return 0; };
    const feed = await startCapital(root);
    await settle();
    try { await work(root, capital, { refresh: async () => { intervals.get(30000)(); await settle(); await settle(); }, poll: async () => { intervals.get(8000)(); await settle(); await settle(); } }); }
    finally { feed.stop(); }
  });
}
const byPosition = (root, id) => root.querySelector('#floor-positions').withClass('pos-row').find(row => row.dataset.position === id);

test('mounted: a reason under each agent position, a tap unfolds the thesis in place, and it stays open across a refresh', async () => {
  await mounted(windowed(), [], async (root, _capital, { refresh }) => {
    const row = byPosition(root, 'real:8');
    const [reason] = row.withClass('pos-why');
    assert.equal(reason.tag, 'button');
    assert.equal(reason.textContent, '“MSFT leads GOOGL, QQQ flat”');
    assert.equal(reason.getAttribute('aria-controls'), 'why-real-8');
    assert.equal(reason.getAttribute('aria-expanded'), 'false');
    assert.equal(row.withClass('pos-what')[0].children.at(-1), reason, 'the second line of the What cell');
    const panel = root.querySelector('#why-real-8');
    assert.equal(panel.hidden, true);
    assert.equal(panel.find('td')[0].getAttribute('colspan'), '8');
    assert.equal(words(panel.withClass('pos-thesis')[0]), GOOGL_THESIS);
    assert.equal(words(panel.withClass('pos-why-meta')[0]), 'max loss $157');
    reason.click();
    assert.equal(panel.hidden, false);
    assert.equal(reason.getAttribute('aria-expanded'), 'true');
    assert.match(row.className, /\bwhy-open\b/);
    assert.match(words(panel), /^MSFT and GOOGL sell/);
    reason.click();
    assert.equal(panel.hidden, true);
    assert.doesNotMatch(row.className, /why-open/);
    reason.click();
    await refresh();
    const again = root.querySelector('#why-real-8');
    assert.notEqual(again, panel, 'the table was redrawn');
    assert.equal(again.hidden, false, 'an open card survives the refresh');
    assert.equal(byPosition(root, 'real:8').withClass('pos-why')[0].getAttribute('aria-expanded'), 'true');
    // A reason with no thesis behind it is plain text with no fold; no reason and no thesis, nothing.
    const box = root.querySelector('#floor-positions');
    assert.equal(byPosition(root, 'real:4').withClass('pos-why').length, 0);
    assert.equal(byPosition(root, 'real:5').withClass('pos-why')[0].textContent, '“the open broke higher on heavy volume → target reached before the lunch lull”');
    // House calibration: no reason, no tag, one line as before.
    const calibration = byPosition(root, 'real:1');
    assert.equal(calibration.withClass('pos-why').length, 0);
    assert.equal(calibration.withClass('tag').length, 0);
    assert.equal(words(calibration), 'House calibration SPY call debit vertical ×1 Sep 29 Sep 28, 10:10 Sep 28, 10:10 −$2.20 −1.0%');
    assert.equal(box.withClass('pos-why-row').every(node => node.find('td').length === 1), true);
  });
});

test('mounted: route tags, the P&L against the maximum loss, who closed it, the open pulse, and an older House\'s table unchanged', async () => {
  await mounted(windowed(), [], async root => {
    const tagOf = id => byPosition(root, id).withClass('tag')[0];
    assert.deepEqual(['real:8', 'real:7', 'real:6', 'real:9'].map(id => [tagOf(id).textContent, tagOf(id).className, tagOf(id).getAttribute('title')]), [
      ['Tuition', 'tag tag-tuition tag-route', 'Tuition: one real contract to measure fills, never evidence.'],
      ['Sized', 'tag tag-real tag-route', 'Sized: real money, sized by its record.'],
      ['Probe', 'tag tag-real tag-route', 'Probe: real money, small.'],
      ['Incubator', 'tag tag-incubator', INCUBATOR_TITLE],
    ]);
    assert.equal(root.querySelector('#floor-positions').withClass('tag-tuition').length, 1);
    assert.equal(byPosition(root, 'real:8').withClass('pos-pnl')[0].getAttribute('title'), '−2% of its $157 max loss');
    assert.equal(byPosition(root, 'real:5').withClass('pos-pnl')[0].getAttribute('title'), '+32% of its $96 max loss');
    assert.equal(byPosition(root, 'real:1').withClass('pos-pnl')[0].getAttribute('title'), null, 'calibration: no risk title');
    const closedTitle = id => byPosition(root, id).withClass('pos-closed')[0].find('time')[0].getAttribute('title');
    assert.equal(closedTitle('real:5'), 'Sep 28, 10:30 AM EDT · closed by the agent');
    assert.equal(closedTitle('real:4'), 'Sep 28, 10:20 AM EDT · expired');
    assert.equal(closedTitle('real:1'), 'Sep 28, 10:10 AM EDT');
    const openCell = byPosition(root, 'real:8').withClass('pos-closed')[0];
    assert.deepEqual(openCell.children.map(node => node.className || node.textContent), ['pulse', 'open']);
    assert.equal(words(openCell), 'open');
  });
  // An older House: no rationale, no levels. The table is the prior table, word for word.
  await mounted(ledgerCheckpoint(), [], async root => {
    const box = root.querySelector('#floor-positions');
    assert.equal(box.withClass('pos-why').length + box.withClass('pos-why-row').length + box.withClass('tag').length, 0);
    assert.equal(words(byPosition(root, 'real:6')), 'Scholes SPY call debit vertical ×2 Sep 28 Sep 28, 10:10 open −$8.00 −3.6%');
    assert.equal(byPosition(root, 'real:6').withClass('pos-pnl')[0].getAttribute('title'), null);
    assert.equal(root.querySelector('#floor-agents').withClass('agents-funnel').length, 0, 'no funnel caption either');
  });
});

test('mounted: Profit and Net each draw their path to the headline; a 404 draws none; a dash leaves a hollow end; a change flashes once', async () => {
  const itemized = { as_of: '2026-09-28T14:57:00.000Z', sail_usd: '212.40', claude_usd: '41.20', openai_usd: '64.10', thetadata_usd: '5.43',
    market_data_usd: '5.66', other_usd: '0.00' };
  await mounted(ledgerCheckpoint({ compute: itemized }), [], async root => {
    const numbers = root.querySelector('#floor-numbers');
    const [profit, net, clock] = ['number-profit', 'number-net', 'number-clock'].map(name => numbers.withClass(name)[0]);
    assert.equal(svgClass(profit, 'spark-line').length, 1);
    assert.match(profit.find('svg')[0].getAttribute('aria-label'), /^Profit since .*: \+\$190\.00 to \+\$220\.40\.$/, 'the line ends at the headline, to the cent');
    assert.equal(words(profit.withClass('number-value')[0]), '+$220.40');
    assert.equal(profit.withClass('spark')[0].className, 'spark positive');
    assert.equal(words(net.withClass('number-value')[0]), '−$120.89');
    assert.match(net.find('svg')[0].getAttribute('aria-label'), /^Net since .*: −\$110\.00 to −\$120\.89\.$/, 'Net\'s own path, to its headline');
    assert.equal(clock.withClass('spark').length, 0);
    assert.equal(profit.withClass('spark-dot')[0].className, 'spark-dot');
    assert.equal(numbers.withClass('wash-up').length + numbers.withClass('wash-down').length, 0, 'the first draw never flashes');
    assert.match(words(numbers), /^Profit \+\$220\.40 Net −\$120\.89 Running /, 'no new words');
  });
  await mounted(ledgerCheckpoint(), [], async root => {
    assert.equal(root.querySelector('#floor-numbers').withClass('spark').length, 0);
  }, path => (path.endsWith('/score') ? null : undefined));
  const unpriced = swarmCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: null } });
  await mounted(unpriced, [], async root => {
    const profit = root.querySelector('#floor-numbers').withClass('number-profit')[0];
    assert.equal(words(profit.withClass('number-value')[0]), '—');
    assert.equal(profit.withClass('spark-dot')[0].className, 'spark-dot spark-stale', 'the last path the House could price, ending hollow');
    assert.match(profit.find('svg')[0].getAttribute('aria-label'), /to \+\$211\.00\.$/);
  });
  // Two successive checkpoints, Profit then lower: one red wash on Profit; the open row the House revalued washes too.
  let current = ledgerCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: '-96.15' },
    positions: ledger({ rows: POSITIONS.map(row => (row.id === 'real:7' ? { ...row, pnl_usd: '-304.05' } : row)) }) });
  await mounted(current, [], async (root, _capital, { refresh }) => {
    const numbers = root.querySelector('#floor-numbers');
    assert.equal(numbers.withClass('wash-down').length, 0);
    current = { ...current, trading: { as_of: PUBLISHED_AT, pnl_usd: '-105.65' },
      positions: ledger({ rows: POSITIONS.map(row => (row.id === 'real:7' ? { ...row, pnl_usd: '-313.55' } : row)) }) };
    await refresh();
    const washed = root.querySelector('#floor-numbers').withClass('wash-down');
    assert.equal(washed.length, 1);
    assert.equal(washed[0].className, 'number-value wash-down');
    assert.equal(words(washed[0]), '−$105.65');
    assert.equal(root.querySelector('#floor-numbers').withClass('wash-up').length, 0);
    assert.equal(byPosition(root, 'real:7').withClass('pos-pnl')[0].className, 'pos-pnl negative wash-down');
    assert.equal(byPosition(root, 'real:6').withClass('pos-pnl')[0].className, 'pos-pnl negative', 'unchanged: no wash');
    await refresh();
    assert.equal(root.querySelector('#floor-numbers').withClass('wash-down').length, 0, 'no change, no flash');
    assert.equal(byPosition(root, 'real:7').withClass('pos-pnl')[0].className, 'pos-pnl negative');
  }, path => (path.includes('/checkpoint') ? current : undefined));
});

test('mounted: the balance chart has its start rule and a gold mark at each agent opening, open ones hollow', async () => {
  const marks = [{ id: 'mark:a', stream: 'account', kind: 'account.mark', at: '2026-09-28T13:00:00.000Z', payload: { equity: '5481.65', cash: '5481.65', as_of: '2026-09-28T13:00:00.000Z' }, digest: 'a'.repeat(64) }];
  await mounted(windowed(), marks, async root => {
    const account = root.querySelector('#floor-account');
    const [start] = svgClass(account, 'balance-start');
    const [line] = svgClass(account, 'balance-line');
    assert.equal(start.getAttribute('y1'), start.getAttribute('y2'));
    assert.equal(Number(start.getAttribute('y1')).toFixed(1), /^M[\d.]+,([\d.]+)/.exec(line.getAttribute('d'))[1], 'at the chart\'s first point');
    const svg = account.find('svg')[0];
    assert.ok(svg.children.indexOf(start) < svg.children.indexOf(line), 'drawn under the line');
    assert.equal(account.withClass('balance-mark').length, 7);
    assert.equal(account.withClass('balance-mark-open').length, 3);
    assert.equal(words(account), '$5,694.37 · Sep 28, 10:57 AM EDT', 'no new words');
  });
});

test('mounted: the card plays a burst in order with a "+N" count, the feed gets each note once the card has moved on, and the speaker\'s dot breathes', async () => {
  const opening = note('calendar-term', 'Holding the calendar while the term structure stays flat.', '2026-09-28T14:50:00.000Z');
  await mounted(windowed(), [opening], async (root, capital, { poll, refresh }) => {
    const timers = fakeTimers(NOW);
    try {
      const now = root.querySelector('#floor-now');
      const feedText = () => words(root.querySelector('#floor-feed'));
      assert.match(words(now), /Holding the calendar/);
      const burst = [note('eod-drift', 'First of the burst, the drift is fading.', '2026-09-28T14:59:10.000Z'),
        note('strangle-cheap', 'Second of the burst, the news is priced.', '2026-09-28T14:59:20.000Z'),
        note('skew-revert', 'Third of the burst, the smile is steep.', '2026-09-28T14:59:30.000Z')];
      assert.equal((await post(capital, '/api/capital/events', batch(burst[2], burst[0], burst[1]))).status, 200);
      await poll();
      const pill = () => now.withClass('now-queue')[0];
      const dots = root.querySelector('#floor-agents').withClass('agent-dot');
      const speaking = () => dots.filter(dot => /\bdot-speaking\b/.test(dot.className)).map(dot => dot.dataset.agent);
      const nameOf = id => dots.find(dot => dot.dataset.agent === id).getAttribute('aria-label').split(' · ')[0];
      assert.match(words(now), /Holding the calendar/, 'the note on the card keeps it while it is read');
      assert.equal(words(pill()), '+3');
      assert.equal(pill().getAttribute('aria-label'), '3 more notes; show the newest');
      assert.doesNotMatch(feedText(), /of the burst/, 'nothing reaches the feed before the card has shown it');
      timers.tick(holdFor(opening.payload.text, true) + 20);
      assert.match(words(now), /First of the burst/);
      assert.match(words(now), new RegExp(`^${nameOf('eod-drift')} Train \\+2 deciding now`));
      assert.match(feedText(), /Holding the calendar/);
      assert.doesNotMatch(feedText(), /of the burst/);
      assert.deepEqual(speaking(), ['eod-drift']);
      timers.tick(holdFor(burst[0].payload.text, true) + 20);
      assert.match(words(now), /Second of the burst/);
      assert.equal(words(pill()), '+1');
      assert.equal(pill().getAttribute('aria-label'), '1 more note; show the newest');
      assert.match(feedText(), /First of the burst/);
      assert.doesNotMatch(feedText(), /Second of the burst|Third of the burst/);
      assert.deepEqual(speaking(), ['strangle-cheap']);
      timers.tick(holdFor(burst[1].payload.text, true) + 20);
      assert.match(words(now), /Third of the burst/);
      assert.equal(pill().hidden, true);
      assert.match(feedText(), /Second of the burst/);
      assert.doesNotMatch(feedText(), /Third of the burst/);
      assert.deepEqual(speaking(), ['skew-revert']);
      // Once the note is three minutes old the card is idle (at the next draw) and nothing breathes.
      timers.tick(200000);
      await refresh();
      assert.match(words(now), /last note/);
      assert.deepEqual(speaking(), []);
    } finally { timers.restore(); }
  });
});

test('mounted: "+N" jumps to the newest note and drops the rest into the feed; the name opens its dot; the card\'s tag is the level', async () => {
  const opening = note('calendar-term', 'Holding the calendar while the term structure stays flat.', '2026-09-28T14:50:00.000Z');
  await mounted(windowed(), [opening], async (root, capital, { poll }) => {
    const timers = fakeTimers(NOW);
    try {
      const now = root.querySelector('#floor-now');
      const card = () => now.withClass('now')[0];
      const burst = [note('eod-drift', 'First of the burst.', '2026-09-28T14:59:10.000Z'), note('strangle-cheap', 'Second of the burst.', '2026-09-28T14:59:20.000Z'),
        note('googl-lags', 'Third of the burst, the spread is open.', '2026-09-28T14:59:30.000Z')];
      await post(capital, '/api/capital/events', batch(...burst));
      await poll();
      timers.tick(holdFor(opening.payload.text, true) + 20);
      assert.match(words(now), /First of the burst/);
      assert.equal(words(now.withClass('now-queue')[0]), '+2');
      now.withClass('now-queue')[0].click();
      assert.match(words(now), /Third of the burst/);
      assert.equal(now.withClass('now-queue')[0].hidden, true);
      assert.match(words(root.querySelector('#floor-feed')), /First of the burst[^]*|Second of the burst/);
      assert.match(words(root.querySelector('#floor-feed')), /Second of the burst/);
      assert.match(words(root.querySelector('#floor-feed')), /First of the burst/);
      // The retired agent paying tuition: its level's tag, and the gold border of real money.
      assert.equal(words(now.withClass('now-band')[0]), 'Tuition');
      assert.equal(now.withClass('tag-tuition')[0].getAttribute('title'), LEVEL_TITLES.tuition);
      assert.match(card().className, /\bnow-real\b/);
      // The name is a button that opens its dot's detail on the board.
      const name = now.withClass('now-name')[0];
      assert.equal(name.tag, 'button');
      const scrolls = [];
      root.querySelector('#agent-detail').scrollIntoView = options => scrolls.push(options);
      name.click();
      const detail = root.querySelector('#agent-detail');
      assert.equal(detail.hidden, false);
      assert.equal(detail.withClass('agent-detail-card').length, 1);
      assert.match(words(detail), new RegExp(`^${words(name)} Tuition ×`));
      assert.deepEqual(scrolls, [{ block: 'nearest', behavior: 'auto' }]);
      // A Validation speaker: its tag, no gold border.
      await post(capital, '/api/capital/events', batch(note('gap-drift', 'Validation notes, quietly.', '2026-09-28T14:59:40.000Z')));
      await poll();
      timers.tick(30000);
      assert.match(words(now), /Validation notes/);
      assert.equal(words(now.withClass('now-band')[0]), 'Validation');
      assert.doesNotMatch(card().className, /now-real/);
      // A speaker in the collapsed retired summary: the name opens the summary, then the dot.
      await post(capital, '/api/capital/events', batch(note('reversal-1', 'Retired, still talking.', '2026-09-28T14:59:50.000Z')));
      await poll();
      timers.tick(30000);
      assert.match(words(now), /Retired, still talking/);
      assert.equal(words(now.withClass('now-band')[0]), 'Retired');
      assert.equal(root.querySelector('#floor-agents').withClass('agents-retired')[0].open, false);
      assert.equal(root.querySelector('#floor-agents').withClass('dot-speaking').length, 0, 'never inside the collapsed summary');
      now.withClass('now-name')[0].click();
      assert.equal(root.querySelector('#floor-agents').withClass('agents-retired')[0].open, true);
      assert.match(words(root.querySelector('#agent-detail')), /Retired ×/);
    } finally { timers.restore(); }
  });
});

test('mounted: the board is six rungs with the funnel under its heading, the key outside the board, and the dots in their level\'s look', async () => {
  await mounted(windowed(), [], async root => {
    const box = root.querySelector('#floor-agents');
    assert.deepEqual(box.children.map(node => node.className), ['agent-board-key', 'agents-funnel', 'agent-board'], 'the key first, outside the board');
    const caption = box.withClass('agents-funnel')[0];
    assert.equal(words(caption), '49 born › 9 validation › 7 tuition › 6 candidate › 3 probe › 1 sized');
    assert.equal(caption.getAttribute('title'), 'Since the reset: how many families reached each level.');
    assert.deepEqual(box.withClass('stage-heading').map(words), ['6 Sized 1', '5 Probe 2', '4 Candidate 3', '3 Tuition 1', '2 Validation 1', '1 Train 4']);
    assert.deepEqual(box.withClass('stage-heading').map(node => node.getAttribute('title')), ['sized', 'probe', 'candidate', 'tuition', 'validation', 'train'].map(key => LEVEL_TITLES[key]));
    const stages = box.withClass('agent-stage');
    assert.deepEqual(stages.map(node => node.className), ['agent-stage stage-6 stage-real', 'agent-stage stage-5 stage-real', 'agent-stage stage-4',
      'agent-stage stage-3 stage-real', 'agent-stage stage-2', 'agent-stage stage-1']);
    const googl = box.withClass('agent-dot').find(dot => dot.dataset.agent === 'googl-lags');
    assert.equal(googl.className, 'agent-dot dot-retired level-tuition');
    assert.equal(googl.dataset.level, 'tuition');
    assert.equal(stages[3].withClass('agent-dot')[0], googl, 'on the Tuition rung, holding its spread');
    assert.match(googl.getAttribute('aria-label'), /^\S+(?: \d+)? · Tuition · debit vertical$/);
    assert.equal(googl.getAttribute('title'), googl.getAttribute('aria-label'));
    assert.equal(words(box.withClass('agents-retired')[0].find('summary')[0]), '1 retired');
    assert.deepEqual(stages[5].withClass('agent-dot').map(dot => dot.className), ['agent-dot dot-gym level-practice', 'agent-dot dot-gym level-train',
      'agent-dot dot-gym level-train', 'agent-dot dot-gym level-train']);
    // The dot's detail: the level tag, the family's thesis instead of the raw mechanism, and the open spread's reason.
    googl.click();
    const detail = root.querySelector('#agent-detail');
    assert.equal(detail.withClass('tag-tuition').length, 1);
    assert.equal(words(detail.withClass('agent-strategy')[0]), `debit vertical ${GOOGL_THESIS}`);
    assert.equal(words(detail.withClass('agent-position-why')[0]), '“MSFT leads GOOGL, QQQ flat”');
    assert.match(words(detail.withClass('agent-positions')[0]), /^real money GOOGL debit vertical · 2 legs · Oct 7 · ×1 max loss \$157\.00 −\$3\.00 “MSFT leads GOOGL, QQQ flat”$/);
    // A thesis the House filtered to nothing: the structure alone.
    box.withClass('agents-retired')[0].open = true;
    box.withClass('agent-dot').find(dot => dot.dataset.agent === 'reversal-1').click();
    assert.equal(words(root.querySelector('#agent-detail').withClass('agent-strategy')[0]), 'debit vertical');
  });
  // An older House: the band decides, vacant rungs stay as short lines, and there is no caption.
  await mounted(swarmCheckpoint(), [], async root => {
    const box = root.querySelector('#floor-agents');
    assert.deepEqual(box.children.map(node => node.className), ['agent-board-key', 'agent-board']);
    assert.deepEqual(box.withClass('agent-stage').map(node => node.className.includes('stage-vacant')), [false, false, false, true, true, false]);
    assert.deepEqual(box.withClass('stage-heading').map(words), ['6 Sized 1', '5 Probe 2', '4 Candidate 3', '3 Tuition 0', '2 Validation 0', '1 Train 5']);
    assert.equal(words(box.withClass('agent-stage')[3]), '3 Tuition 0 —');
  });
});
