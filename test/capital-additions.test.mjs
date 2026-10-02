// The agents' reasons and the game's levels (Oct 1, 2026, kept in the five-section page of Oct 2): each position's reason
// and the thesis behind it, the agents' openings on the balance chart, and the six rungs with how many ever reached each.
// Pure helpers first, then the page mounted on a published record.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  plainTag, tickerCase, streamEntry, positionsLedger, tradeReasons, agentStages, rungOf, swarmRows, swarmLine, levelOf, chartMarks, accountSeries,
  settleAgents, startCapital, LEVEL_WORDS, LEVEL_TITLES, ROUTE_TAGS, INCUBATOR_TITLE, PROGRESS_TARGETS, AGENT_STAGES,
} from '../capital/capital.js';
import { floor, post, withBrowser, stubPage, FLOOR_IDS, words } from './harness.mjs';
import {
  swarmCheckpoint, windowCheckpoint, ledgerCheckpoint, ledger, POSITIONS, STRUCTURES, structure, agent, trade, funnel, levelsBlock, rationaleBlock,
  GOOGL_THESIS, PUBLISHED_AT,
} from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
// The GOOGL spread as a real structure too (its ledger row's id).
const GOOGL_STRUCTURE = structure('real:8', { agent: 'googl-lags', underlying: 'GOOGL', structure: 'debit_vertical', legs: 2, expiry: '2026-10-07',
  opened_at: '2026-09-28T14:31:00.000Z', max_loss_usd: '157.00', pnl_usd: '-3.00' });
const windowed = (overrides = {}) => windowCheckpoint({ structures: [...STRUCTURES, GOOGL_STRUCTURE], ...overrides });

// ---------------------------------------------------------------------------- why an agent traded that
test('a reason is a plain short tag with its tickers in capitals; a raw tape why never shows', () => {
  assert.equal(plainTag('three sessions up'), null, 'a number written as a word');
  assert.equal(plainTag('IV above 0.4'), null, 'a numeral');
  assert.equal(tickerCase('msft leads googl, qqq flat'), 'MSFT leads GOOGL, QQQ flat');
  assert.equal(tickerCase(plainTag('msft leads googl, qqq flat')), 'MSFT leads GOOGL, QQQ flat');
  // The tape's why can run to 240 characters: past 80, nothing shows inline.
  const long = `The open broke higher on heavy volume ${'and the follow through held '.repeat(5)}into the closing bell.`;
  assert.equal(long.length, 200);
  assert.equal(streamEntry(trade('orb-4', { why: long })).why, '');
  assert.equal(streamEntry(trade('orb-4', { why: 'msft leads googl, qqq flat', underlying: 'GOOGL' })).why, 'MSFT leads GOOGL, QQQ flat');
  assert.equal(streamEntry(trade('orb-4', { why: 'the range broke three times' })).why, '', 'the tape keeps numbers: refused');
});

test('each agent position carries its reason, the family thesis behind it and its maximum loss; a close reason only when the agent closed it', () => {
  const book = positionsLedger(windowed(), at);
  const line = id => [...book.open, ...book.closed].find(row => row.id === id);
  assert.deepEqual([line('real:8').why, line('real:8').thesis, line('real:8').maxLoss, line('real:8').route, line('real:8').routeText],
    ['MSFT leads GOOGL, QQQ flat', GOOGL_THESIS, '157.00', 'tuition', 'Tuition']);
  assert.deepEqual([line('real:5').exit, line('real:5').why, line('real:5').closeWhy], ['agent', 'the open broke higher on heavy volume', 'target reached before the lunch lull']);
  // A close reason the House sent for a trade the agent did not close never reads as the agent's.
  const houseClosed = windowed({ rationale: rationaleBlock({ trades: rationaleBlock().trades.map(entry => (entry.id === 'real:5' ? { ...entry, exit: 'house' } : entry)) }) });
  assert.equal(positionsLedger(houseClosed, at).closed.find(row => row.id === 'real:5').closeWhy, null);
  assert.deepEqual([line('real:9').why, line('real:9').routeText], ['gap not confirmed', 'Incubator']);
  assert.deepEqual([line('real:4').why, line('real:4').exit], [null, 'expiry'], 'no reason of its own');
  // The House's calibration has none of it, and folds into one line.
  assert.deepEqual(book.calibration.rows.map(row => [row.id, row.why, row.thesis, row.route]), [['real:1', null, null, null]]);
  // An older House (no rationale): no reasons; the thesis is the agent's mechanism under the page's own sentence rules.
  const older = positionsLedger(ledgerCheckpoint(), at);
  for (const row of [...older.open, ...older.closed]) assert.deepEqual([row.why, row.route], [null, null], row.id);
  assert.match(older.open.find(row => row.id === 'real:6').thesis, /^Trades the break of the opening range/);
  assert.equal(tradeReasons(ledgerCheckpoint()).size, 0);
});

test('the chart marks each agent position where it opened, hollow while open; the House\'s calibration gets none', () => {
  const checkpoint = windowed();
  const series = accountSeries([{ at: '2026-09-28T13:00:00.000Z', equity: '5481.65' }], checkpoint);
  const marks = chartMarks(checkpoint, series);
  assert.deepEqual(marks.map(mark => [mark.id, mark.open]), [['real:8', true], ['real:6', true], ['real:7', true], ['real:5', false], ['real:4', false],
    ['real:3', false], ['real:9', false]]);
  assert.equal(marks[0].x, series.x(Date.parse('2026-09-28T14:31:00.000Z')));
  assert.match(marks[0].label, / opened GOOGL call debit vertical$/);
  assert.equal(chartMarks(ledgerCheckpoint({ positions: ledger({ rows: [POSITIONS.at(-1)] }) }), series).length, 0);
  assert.deepEqual(chartMarks(swarmCheckpoint(), series), [], 'no ledger, no marks');
  // An opening before the record's start is not drawn.
  const early = windowed({ positions: ledger({ rows: POSITIONS.map(row => (row.id === 'real:3' ? { ...row, opened_at: '2026-09-25T09:00:00.000Z' } : row)) }),
    trading: { as_of: PUBLISHED_AT, pnl_usd: '220.40' }, rationale: rationaleBlock({ trades: [] }), levels: null });
  assert.equal(chartMarks(early, series).some(mark => mark.id === 'real:3'), false);
});

// ---------------------------------------------------------------------------- the game's rungs
test('the rungs follow the House\'s levels, an older House\'s band, and a retired agent\'s open money; each says how many ever reached it', () => {
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
  // A retired agent still holding money stands on its money's rung; the rest leave the board.
  const rows = swarmRows(windowed());
  assert.deepEqual(rows.filter(row => row.band === 'retired').map(row => [row.id, row.level]), [['reversal-1', 'retired'], ['googl-lags', 'tuition']]);
  assert.equal(levelOf(agent('gone', { band: 'retired' }), windowed()), 'retired');
  assert.deepEqual(['train', 'practice', 'incubator', 'validation', 'tuition', 'candidate', 'probe', 'sized', 'retired'].map(rungOf), [1, 1, 1, 2, 3, 4, 5, 6, null]);
  // Ever reached: the House's funnel since the reset, Train counting every birth; a bar on a log scale beside each.
  const stages = agentStages(windowed());
  assert.deepEqual(stages.map(stage => stage.ever), [1, 3, 6, 7, 9, 49]);
  assert.equal(stages.at(-1).share, 1);
  assert.ok(stages[0].share > 0 && stages[0].share < stages[1].share, 'one family still shows, below three');
  assert.deepEqual(agentStages(windowed({ levels: levelsBlock({ funnel: funnel({ validation: null }) }) })).map(stage => stage.ever)[4], null);
  assert.deepEqual(agentStages(swarmCheckpoint()).map(stage => stage.ever), [null, null, null, null, null, null], 'no funnel: no counts');
  assert.equal(swarmLine(windowed()), '37 retired · 48,213 backtests');
  assert.equal(swarmLine(swarmCheckpoint({ gym: null })), '');
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
async function mounted(checkpoint, work) {
  const { capital } = floor(at + 30000);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => capital.fetch(new Request('https://blakewoods.us' + path)), async () => {
    const feed = await startCapital(root);
    try { await work(root); } finally { feed.stop(); }
  });
}
const byPosition = (root, id) => root.querySelector('#floor-positions').withClass('pos').find(row => row.dataset.position === id);

test('mounted: each agent position shows its reason, the thesis behind it, its level and who closed it; the name opens its dot', async () => {
  await mounted(windowed(), async root => {
    const googl = byPosition(root, 'real:8');
    assert.equal(words(googl.withClass('pos-why')[0]), '“MSFT leads GOOGL, QQQ flat”');
    assert.equal(googl.withClass('pos-why')[0].getAttribute('title'), 'The agent’s own words when it opened the position.');
    assert.equal(words(googl.withClass('pos-thesis')[0]), GOOGL_THESIS);
    assert.match(words(googl.withClass('pos-meta')[0]), /^Meriwether 2 Tuition 1 contract · opened Sep 28 · expires Oct 7 · max loss \$157$/);
    assert.equal(googl.withClass('tag-tuition')[0].getAttribute('title'), ROUTE_TAGS.tuition.title);
    const closedByAgent = byPosition(root, 'real:5');
    assert.equal(words(closedByAgent.withClass('pos-close-why')[0]), 'Closed: “target reached before the lunch lull”');
    assert.equal(words(closedByAgent.withClass('pos-status')[0]), 'closed by the agent');
    assert.equal(words(byPosition(root, 'real:4').withClass('pos-status')[0]), 'expired');
    // The name is the agent's dot, as on the board.
    const board = root.querySelector('#floor-agents');
    const who = googl.withClass('pos-who')[0];
    assert.equal(who.tag, 'button');
    who.click();
    assert.equal(board.querySelector('#agent-detail').hidden, false);
    assert.match(words(board.querySelector('#agent-detail')), /^Meriwether 2 Tuition × debit vertical MSFT and GOOGL/);
  });
});

test('mounted: the board is six rungs, each dot in its level\'s look, and beside each rung how many ever reached it', async () => {
  await mounted(windowed(), async root => {
    const board = root.querySelector('#floor-agents');
    assert.deepEqual(board.withClass('rung-name').map(words), ['6 Sized', '5 Probe', '4 Candidate', '3 Tuition', '2 Validation', '1 Train']);
    assert.deepEqual(board.withClass('reached-count').map(words), ['1', '3', '6', '7', '9', '49']);
    assert.equal(board.withClass('rung-reached')[3].getAttribute('title'), '7 families have ever reached Tuition');
    assert.deepEqual(board.withClass('rung').map(rung => rung.withClass('agent-dot').length), [1, 2, 3, 1, 1, 4]);
    assert.deepEqual(board.withClass('rung').filter(rung => String(rung.className).includes('rung-real')).map(rung => words(rung.withClass('rung-level')[0])), ['6', '5', '3']);
    assert.equal(board.withClass('level-tuition').length, 1);
    assert.equal(board.withClass('level-practice').length, 1);
    assert.equal(words(board.withClass('ladder-foot')[0]), '37 retired · 48,213 backtests');
    assert.equal(board.withClass('agent-dot').some(dot => dot.dataset.agent === 'reversal-1'), false, 'the retired leave the board');
  });
});
