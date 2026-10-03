// The agents' reasons and the game's levels (Oct 1, 2026, kept in the five-section page of Oct 2): each position's reason
// and the thesis behind it, the agents' openings on the balance chart, and the five rungs drawn as a funnel (Oct 3), each
// as wide as the share that ever reached it. Pure helpers first, then the page mounted on a published record.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  plainTag, tickerCase, streamEntry, positionsLedger, tradeReasons, agentStages, rungOf, swarmRows, swarmLine, levelOf, chartMarks, accountSeries,
  settleAgents, startCapital, practisingAgents, LEVEL_WORDS, LEVEL_TITLES, ROUTE_TAGS, INCUBATOR_TITLE, PROGRESS_TARGETS, AGENT_STAGES, BAND_FLOOR,
} from '../capital/capital.js';
import { LEVELS, LEVELS_BY_BAND, validCheckpoint } from '../capital/schema.js';
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
// The practice read, as the House publishes it: one row per family that practised in its window.
const practiceRow = (id, overrides = {}) => ({ agent: id, family: id.replace(/-\d+$/, ''), structure: 'long_call', tier: 'validated', status: 'alive',
  sessions: 12, trades: 0, wins: 0, pnl_usd: '0.00', return_on_risk: null, ...overrides });
const practiceBlock = (...rows) => ({ as_of: PUBLISHED_AT, sessions: 20, capital_usd: '10000.00',
  totals: { families: rows.length, trades: 0, wins: 0, pnl_usd: '0.00' }, rows });
const ids = checkpoint => agentStages(checkpoint).map(stage => stage.agents.map(row => `${row.id}:${row.level}`));

test('the five rungs follow the House\'s levels, an older House\'s band, and a retired agent\'s open money; each says how many ever reached it', () => {
  assert.deepEqual(AGENT_STAGES.map(stage => `${stage.level} ${stage.label}`), ['5 Sized', '4 Probe', '3 Practice', '2 Validation', '1 Train']);
  assert.deepEqual(AGENT_STAGES.filter(stage => stage.real).map(stage => stage.key), ['sized', 'probe'], 'only the top two rungs trade real money');
  assert.deepEqual(ids(windowed()), [['condor-vrp-3:sized'], ['orb-4:probe', 'putspread-dip-2:probe'],
    ['butterfly-pin:candidate', 'ironfly-quiet:candidate', 'trend-vertical:candidate', 'skew-revert:practice', 'googl-lags:tuition'], ['gap-drift:validation'],
    ['calendar-term:train', 'eod-drift:train', 'strangle-cheap:train']], 'the older rungs stand on Practice, the furthest along first');
  // An older House: no levels, so the band decides; a Gym agent trains, unless its real money says it paid tuition.
  const older = windowed({ levels: null, rationale: null });
  assert.deepEqual(ids(older), [['condor-vrp-3:sized'], ['orb-4:probe', 'putspread-dip-2:probe'],
    ['butterfly-pin:candidate', 'ironfly-quiet:candidate', 'trend-vertical:candidate', 'googl-lags:tuition'], [],
    ['calendar-term:train', 'eod-drift:train', 'gap-drift:train', 'skew-revert:train', 'strangle-cheap:train']]);
  // A retired agent still holding money stands on its money's rung; the rest leave the board.
  const rows = swarmRows(windowed());
  assert.deepEqual(rows.filter(row => row.band === 'retired').map(row => [row.id, row.level, row.rung]), [['reversal-1', 'retired', null], ['googl-lags', 'tuition', 3]]);
  assert.equal(levelOf(agent('gone', { band: 'retired' }), windowed()), 'retired');
  assert.deepEqual(['train', 'validation', 'practice', 'incubator', 'tuition', 'candidate', 'probe', 'sized', 'retired'].map(level => rungOf(level)),
    [1, 2, 3, 3, 3, 3, 4, 5, null]);
  // Ever reached: the House's funnel since the reset, Train counting every birth and Practice every family that practised.
  const stages = agentStages(windowed());
  assert.deepEqual(stages.map(stage => stage.ever), [1, 3, 3, 9, 49]);
  assert.deepEqual(AGENT_STAGES.map(stage => stage.reached), ['sized', 'probe', 'practice', 'validation', 'born']);
  assert.equal(stages.at(-1).share, 1);
  assert.ok(stages[0].share > 0 && stages[0].share < stages[1].share, 'one family still shows, below three');
  assert.deepEqual(agentStages(windowed({ levels: levelsBlock({ funnel: funnel({ validation: null }) }) })).map(stage => stage.ever)[3], null);
  assert.deepEqual(agentStages(swarmCheckpoint()).map(stage => stage.ever), [null, null, null, null, null], 'no funnel: no counts');
  assert.equal(swarmLine(windowed()), '37 retired · 48,213 backtests');
  assert.equal(swarmLine(swarmCheckpoint({ gym: null })), '');
  assert.deepEqual(Object.values(PROGRESS_TARGETS).slice(0, 3), ['Candidate', 'Probe', 'Sized'], 'the dot detail reads "Next · Candidate"');
  assert.equal(LEVEL_TITLES.incubator, INCUBATOR_TITLE);
  assert.deepEqual(Object.keys(ROUTE_TAGS), ['tuition', 'incubator', 'probe', 'sized']);
  assert.equal(LEVEL_WORDS.validation, 'Validation');
});

test('every level the House can publish lands on one of the five rungs; Tuition, Candidate and the Incubator stand on Practice under their own tag', () => {
  const home = { train: 'Train', validation: 'Validation', practice: 'Practice', incubator: 'Practice', tuition: 'Practice', candidate: 'Practice',
    probe: 'Probe', sized: 'Sized' };
  assert.deepEqual(Object.keys(home).sort(), LEVELS.filter(level => level !== 'retired').sort(), 'the House\'s whole list, less the graveyard');
  // One agent per (band, level) pair the schema allows: a retired agent holding money among them.
  const pairs = Object.entries(LEVELS_BY_BAND).flatMap(([band, levels]) => levels.map(level => ({ id: `${band}-${level}`, band, level })));
  assert.equal(pairs.length, 13);
  const checkpoint = swarmCheckpoint({ agents: pairs.map(pair => agent(pair.id, { band: pair.band })), structures: [],
    levels: { as_of: PUBLISHED_AT, agents: pairs.map(pair => ({ id: pair.id, level: pair.level })), funnel: funnel() } });
  const stages = agentStages(checkpoint);
  const placed = new Map(stages.flatMap(stage => stage.agents.map(row => [row.id, { stage, row }])));
  for (const pair of pairs) {
    const spot = placed.get(pair.id);
    if (pair.level === 'retired') { assert.equal(spot, undefined, 'the retired leave the board'); continue; }
    assert.equal(spot.stage.label, home[pair.level], pair.id);
    assert.ok(spot.stage.levels.includes(pair.level), `${pair.id}: its rung names its level`);
    assert.deepEqual([spot.row.level, spot.row.levelText], [pair.level, LEVEL_WORDS[pair.level]], `${pair.id} keeps its own tag`);
    assert.equal(spot.row.rung, spot.stage.level);
  }
  assert.equal([...placed.keys()].length, pairs.length - 1, 'each stands on exactly one rung');
  assert.deepEqual(stages.map(stage => stage.agents.map(row => row.id)), [['sized-sized', 'retired-sized'], ['probe-probe', 'retired-probe'],
    ['candidate-candidate', 'gym-practice', 'gym-tuition', 'retired-tuition', 'gym-incubator', 'retired-incubator'], ['gym-validation'], ['gym-train']]);
  // The legacy rungs by name: none is a real-money rung any more, and each still reads as itself in the detail.
  for (const level of ['tuition', 'candidate', 'incubator']) {
    assert.equal(rungOf(level), 3, level);
    assert.equal(AGENT_STAGES.find(stage => stage.level === rungOf(level)).real, undefined, level);
    assert.ok(LEVEL_WORDS[level] && LEVEL_TITLES[level], level);
  }
  // Each rung's own list agrees with `rungOf` (Validation stands on Practice only while it practises).
  for (const stage of AGENT_STAGES) for (const level of stage.levels) assert.equal(rungOf(level, stage.key === 'practice'), stage.level, `${stage.key}:${level}`);
  // A word the schema would refuse never crashes the board and never draws a dot.
  const odd = swarmCheckpoint({ agents: [agent('odd')], structures: [], levels: { as_of: PUBLISHED_AT, agents: [{ id: 'odd', level: 'mystery' }], funnel: funnel() } });
  assert.deepEqual(agentStages(odd).map(stage => stage.agents.length), [0, 0, 0, 0, 0]);
  assert.equal(rungOf('mystery'), null);
  assert.equal(rungOf(undefined), null);
});

test('a validated agent that practises stands on Practice: the practice read tells it from one that only passed', () => {
  // The House publishes it as `validation`; its living row in the practice read is what says it practises.
  const practising = windowed({ practice: practiceBlock(practiceRow('gap-drift')) });
  assert.equal(validCheckpoint(practising), true);
  assert.deepEqual([...practisingAgents(practising)], ['gap-drift']);
  assert.deepEqual(ids(practising).slice(2, 4), [['butterfly-pin:candidate', 'ironfly-quiet:candidate', 'trend-vertical:candidate', 'gap-drift:validation',
    'skew-revert:practice', 'googl-lags:tuition'], []], 'on Practice, ahead of the agents that practise unvalidated');
  const row = swarmRows(practising).find(entry => entry.id === 'gap-drift');
  assert.deepEqual([row.level, row.levelText, row.practising, row.rung], ['validation', 'Validation', true, 3], 'its tag stays Validation');
  assert.deepEqual([rungOf('validation'), rungOf('validation', true), rungOf('train', true), rungOf('probe', true)], [2, 3, 1, 4]);
  // Not practising: no row, a row whose agent is off the roster, or a row with no session yet.
  for (const [label, block] of [['no rows', practiceBlock()], ['a retired row', practiceBlock(practiceRow('gap-drift', { status: 'retired' }))],
    ['no session yet', practiceBlock(practiceRow('gap-drift', { sessions: 0 }))], ['another agent\'s row', practiceBlock(practiceRow('orb-4'))]]) {
    assert.deepEqual(ids(windowed({ practice: block }))[3], ['gap-drift:validation'], label);
  }
  // The row moves a validated agent only: the House's own word places every other level.
  const others = windowed({ practice: practiceBlock(practiceRow('calendar-term', { tier: 'train' }), practiceRow('skew-revert', { tier: 'train' }),
    practiceRow('condor-vrp-3'), practiceRow('butterfly-pin')) });
  assert.deepEqual(ids(others), ids(windowed()));
  assert.equal(swarmRows(others).some(entry => entry.practising), false);
  // A read without the block, with a null one, or with a broken one: nobody practises, nothing throws.
  for (const practice of [undefined, null, {}, { rows: null }, { rows: [null, 7, { agent: 'gap-drift' }, { agent: 'gap-drift', status: 'alive', sessions: '3' }] }]) {
    assert.deepEqual([...practisingAgents({ practice })], []);
    assert.deepEqual(ids(windowed({ practice }))[3], ['gap-drift:validation']);
  }
  assert.deepEqual([...practisingAgents(null)], []);
});

test('the funnel is the shape: a rung\'s band is as wide as the share that ever reached it, above a floor; an uncounted rung has no band', () => {
  const bands = checkpoint => agentStages(checkpoint).map(stage => (stage.band === null ? null : Number(stage.band.toFixed(3))));
  const withFunnel = overrides => windowed({ levels: levelsBlock({ funnel: funnel(overrides) }) });
  assert.equal(BAND_FLOOR, 0.3);
  // 49 born, 9 validated, 3 practised, 3 on Probe, 1 Sized: narrowing to the top, the widest rung the whole width.
  assert.deepEqual(bands(windowed()), [0.424, 0.548, 0.548, 0.712, 1]);
  // The live swarm on Oct 3, 2026: thousands born, none on real money yet. Nobody there is the floor, never nothing.
  const live = withFunnel({ born: 2373, validation: 380, practice: 33, tuition: 2, incubator: 0, candidate: 0, probe: 0, sized: 0, retired: 2365 });
  assert.deepEqual(bands(live), [0.3, 0.3, 0.618, 0.835, 1]);
  const one = bands(withFunnel({ born: 2373, validation: 380, practice: 33, candidate: 1, probe: 1, sized: 1, retired: 2365 }));
  assert.ok(one[0] > BAND_FLOOR && one[0] < one[2], 'one family still shows, above nobody and below thirty-three');
  // A count the House could not read: no band and no number, and the others keep their own.
  assert.deepEqual(bands(withFunnel({ validation: null, practice: null })), [0.424, 0.548, null, null, 1]);
  assert.deepEqual(bands(withFunnel({ born: null })), [0.511, 0.721, 0.721, 1, null], 'the widest known rung is the whole width');
  // No funnel at all (an older House, or one whose `levels` carries none), and no checkpoint at all.
  for (const checkpoint of [swarmCheckpoint(), windowed({ levels: null }), windowed({ levels: { ...levelsBlock(), funnel: undefined } }),
    windowed({ levels: { ...levelsBlock(), funnel: null } }), windowed({ levels: { ...levelsBlock(), funnel: 'x' } }), null, undefined, {}]) {
    assert.deepEqual(bands(checkpoint), [null, null, null, null, null]);
    assert.deepEqual(agentStages(checkpoint).map(stage => stage.ever), [null, null, null, null, null]);
  }
  // A nonsense count is no count.
  assert.deepEqual(agentStages(withFunnel({ probe: -1, sized: 1.5, validation: '9' })).map(stage => stage.ever), [null, null, 3, null, 49]);
  // A newborn swarm: nobody anywhere, every band at the floor.
  assert.deepEqual(bands(withFunnel({ born: 0, validation: 0, practice: 0, tuition: 0, incubator: 0, candidate: 0, probe: 0, sized: 0, retired: 0, looks: 0, looks_passed: 0 })),
    [0.3, 0.3, 0.3, 0.3, 0.3]);
});

test('a dot glides when its rung changes (train to validation), once, and never under reduced motion', () => {
  const saved = { window: globalThis.window, document: globalThis.document, now: Date.now };
  try {
    Date.now = () => at + 60000;
    globalThis.document = { visibilityState: 'visible' };
    let reduced = false;
    globalThis.window = { scrollX: 0, scrollY: 0, innerHeight: 900, matchMedia: () => ({ matches: reduced }) };
    const calls = [];
    // A dot as the board draws it: its level, and the rung it was drawn on.
    const dot = (level, top, practising = false) => ({ dataset: { level, rung: String(rungOf(level, practising)) }, querySelector: () => null,
      animate: (...args) => calls.push(args), getBoundingClientRect: () => ({ left: 100, top, bottom: top + 44, width: 44, height: 44 }) });
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
    state.dotNodes = new Map([['one', dot('validation', 400, true)]]);
    settleAgents(state);
    assert.equal(calls.length, 2, 'it starts to practise: the same level, one rung up');
    assert.deepEqual(calls[1][0], [{ transform: 'translate(0px, 100px)' }, { transform: 'translate(0, 0)' }]);
    state.dotNodes = new Map([['one', dot('candidate', 400)]]);
    settleAgents(state);
    assert.equal(calls.length, 2, 'an older level that stands on Practice too: no glide');
    state.dotNodes = new Map([['one', dot('probe', 300)]]);
    settleAgents(state);
    assert.equal(calls.length, 3, 'practice → probe: across the real-money line');
    reduced = true;
    state.dotNodes = new Map([['one', dot('sized', 200)]]);
    settleAgents(state);
    assert.equal(calls.length, 3, 'reduced motion: no glide');
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

const rungClasses = board => board.withClass('rung').map(rung => String(rung.className).split(' ').filter(name => /^rung-(real|vacant|unreached|uncounted)$/.test(name)).join(' '));

test('mounted: the board is five rungs and one real-money divider, each dot in its level\'s look, and in each rung how many ever reached it', async () => {
  await mounted(windowed(), async root => {
    const board = root.querySelector('#floor-agents');
    const ladder = board.withClass('ladder')[0];
    // Every word the board shows: the five names, the divider's two words, and the House's five counts.
    assert.equal(words(ladder), 'Sized 1 Probe 3 Real money Practice 3 Validation 9 Train 49');
    assert.deepEqual(board.withClass('rung-name').map(words), ['Sized', 'Probe', 'Practice', 'Validation', 'Train']);
    assert.deepEqual(board.withClass('rung-name').map(name => name.getAttribute('title')),
      ['sized', 'probe', 'practice', 'validation', 'train'].map(key => LEVEL_TITLES[key]), 'what each rung means stays a hover');
    assert.deepEqual(board.withClass('reached-count').map(words), ['1', '3', '3', '9', '49']);
    const counts = board.withClass('reached-count');
    assert.equal(counts[2].getAttribute('title'), '3 families have ever reached Practice');
    assert.equal(counts[0].getAttribute('title'), '1 family has ever reached Sized');
    assert.equal(counts[4].getAttribute('title'), '49 families have ever reached Train · 37 retired · 48,213 backtests', 'the old foot line is Train\'s hover');
    for (const count of counts) assert.deepEqual([count.getAttribute('role'), count.getAttribute('aria-label')], ['img', count.getAttribute('title')]);
    assert.deepEqual(board.withClass('rung').map(rung => rung.withClass('agent-dot').length), [1, 2, 5, 1, 3]);
    assert.deepEqual(rungClasses(board), ['rung-real', 'rung-real', '', '', '']);
    // One divider: the real-money rungs are a named group, its words on the line under Probe and nowhere else.
    const money = board.withClass('ladder-real');
    assert.equal(money.length, 1);
    assert.deepEqual([money[0].getAttribute('role'), money[0].getAttribute('aria-label')], ['group', 'Real money']);
    assert.deepEqual(money[0].withClass('rung').map(rung => words(rung.withClass('rung-name')[0])), ['Sized', 'Probe']);
    const marks = board.withClass('ladder-real-mark');
    assert.deepEqual(marks.map(words), ['Real money']);
    assert.equal(marks[0].getAttribute('aria-hidden'), 'true', 'the group already says it');
    assert.equal(marks[0].parentNode, board.withClass('rung-4')[0].parentNode, 'beside the lowest real-money rung');
    assert.equal(ladder.children[0], money[0], 'real money on top');
    // The older levels stand on Practice in their own look.
    const practice = board.withClass('rung-3')[0];
    assert.deepEqual(practice.withClass('agent-dot').map(dot => [dot.dataset.level, dot.dataset.rung]),
      [['candidate', '3'], ['candidate', '3'], ['candidate', '3'], ['practice', '3'], ['tuition', '3']]);
    assert.equal(board.withClass('level-tuition').length, 1);
    assert.equal(board.withClass('level-practice').length, 1);
    assert.equal(board.withClass('dot-practising').length, 0);
    // No header row, no rung numbers, no bar, no foot line, no date.
    for (const gone of ['ladder-head', 'rung-level', 'reached-bar', 'ladder-foot', 'empty-state']) assert.deepEqual(board.withClass(gone), [], gone);
    assert.doesNotMatch(words(ladder), /—|\b20\d\d\b|retired|backtest/);
    assert.equal(board.withClass('agent-dot').some(dot => dot.dataset.agent === 'reversal-1'), false, 'the retired leave the board');
  });
});

test('mounted: a validated agent that practises is drawn on Practice, dashed, under its Validation tag', async () => {
  await mounted(windowed({ practice: practiceBlock(practiceRow('gap-drift')) }), async root => {
    const board = root.querySelector('#floor-agents');
    assert.deepEqual(board.withClass('rung').map(rung => rung.withClass('agent-dot').length), [1, 2, 6, 0, 3]);
    assert.deepEqual(rungClasses(board), ['rung-real', 'rung-real', '', 'rung-vacant', '']);
    const dot = board.withClass('dot-practising')[0];
    assert.equal(board.withClass('dot-practising').length, 1);
    assert.deepEqual([dot.dataset.agent, dot.dataset.level, dot.dataset.rung], ['gap-drift', 'validation', '3']);
    assert.ok(String(dot.className).split(' ').includes('level-validation'), 'validated, in the validated tone');
    assert.match(dot.getAttribute('aria-label'), /^[A-Za-z]+( \d+)? · Validation, practising · long call$/);
    assert.equal(dot.getAttribute('title'), dot.getAttribute('aria-label'));
    dot.click();
    assert.match(words(board.querySelector('#agent-detail')), /^[A-Za-z]+( \d+)? Validation × long call /, 'the detail keeps the House\'s own tag');
    assert.equal(words(board.withClass('ladder')[0]), 'Sized 1 Probe 3 Real money Practice 3 Validation 9 Train 49', 'no new word for it');
  });
});

test('mounted: a read without the funnel or the practice block draws the five rungs with no number and no placeholder', async () => {
  // An older House: no `levels`, no `practice`, no `rationale`.
  await mounted(swarmCheckpoint(), async root => {
    const board = root.querySelector('#floor-agents');
    assert.equal(words(board.withClass('ladder')[0]), 'Sized Probe Real money Practice Validation Train');
    assert.deepEqual(board.withClass('reached-count'), []);
    assert.deepEqual(rungClasses(board), ['rung-real rung-uncounted', 'rung-real rung-uncounted', 'rung-uncounted', 'rung-vacant rung-uncounted', 'rung-uncounted']);
    assert.deepEqual(board.withClass('rung').map(rung => rung.withClass('agent-dot').length), [1, 2, 3, 0, 5]);
    board.withClass('agent-dot')[3].click();
    assert.match(words(board.querySelector('#agent-detail')), /^[A-Za-z]+( \d+)? Candidate × /, 'a Candidate stands on Practice under its own tag');
  });
  // The House could not read two of its counts, and nobody has reached real money: the rest keep their numbers.
  const partial = windowed({ practice: null, levels: levelsBlock({ funnel: funnel({ validation: null, practice: null, candidate: 0, probe: 0, sized: 0, looks_passed: 0 }) }) });
  assert.equal(validCheckpoint(partial), true);
  await mounted(partial, async root => {
    const board = root.querySelector('#floor-agents');
    assert.equal(words(board.withClass('ladder')[0]), 'Sized 0 Probe 0 Real money Practice Validation Train 49');
    assert.deepEqual(rungClasses(board), ['rung-real rung-unreached', 'rung-real rung-unreached', 'rung-uncounted', 'rung-uncounted', '']);
    assert.equal(board.withClass('reached-count')[0].getAttribute('title'), '0 families have ever reached Sized');
    assert.doesNotMatch(words(board), /—|Unknown|null|NaN|undefined/);
    assert.equal(board.withClass('agent-dot').length, 12, 'every agent still has its dot');
  });
});
