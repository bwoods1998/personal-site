// The agents' reasons and the game's levels (Oct 1, 2026, kept in the five-section page of Oct 2): each position's reason
// and the thesis behind it, the agents' openings on the balance chart, and the five steps drawn as a staircase (Oct 3):
// wide Train at the bottom, narrow Sized at the top, one gold line under the two that trade real money. Pure helpers
// first, then the page mounted on a published record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  plainTag, tickerCase, streamEntry, positionsLedger, tradeReasons, agentStages, rungOf, swarmRows, swarmLine, levelOf, chartMarks, accountSeries,
  settleAgents, startCapital, practisingAgents, stairWidths, LEVEL_WORDS, LEVEL_TITLES, ROUTE_TAGS, INCUBATOR_TITLE, PROGRESS_TARGETS, AGENT_STAGES,
  STAIRS, REST_SHARES, MONEY_LINE,
} from '../capital/capital.js';
import { LEVELS, LEVELS_BY_BAND, validCheckpoint } from '../capital/schema.js';
import { floor, post, withBrowser, stubPage, FLOOR_IDS, words } from './harness.mjs';
import {
  swarmCheckpoint, windowCheckpoint, ledgerCheckpoint, ledger, POSITIONS, STRUCTURES, AGENTS, structure, agent, trade, funnel, levelsBlock, rationaleBlock,
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

// ---------------------------------------------------------------------------- the staircase
const widthsOf = (checkpoint, layout = 'wide') => agentStages(checkpoint).map(stage => stage.width[layout]);
const withFunnel = overrides => windowed({ levels: levelsBlock({ funnel: funnel(overrides) }) });
// The board's own promise, whatever the counts: Train is the whole width, and every step above it is at least a notch
// narrower than the one under it and never under its own floor or over its own cap.
function assertStaircase(widths, layout, label) {
  const { floor, cap, notch } = STAIRS[layout];
  assert.equal(widths.length, 5, label);
  assert.equal(widths[4], 1, `${label}: the base is the whole width`);
  for (let index = 0; index < 4; index += 1) {
    assert.ok(widths[index] <= widths[index + 1] - notch + 1e-9, `${label} ${layout}: step ${index} narrows by a notch (${widths})`);
    assert.ok(widths[index] >= floor[index] - 1e-9 && widths[index] <= cap[index] + 1e-9, `${label} ${layout}: step ${index} within its floor and cap (${widths})`);
  }
}

test('the staircase is the shape: each step as wide as the share that ever reached it, above a floor, and never wider than the step under it', () => {
  assert.deepEqual(STAIRS, {
    wide: { floor: [0.3, 0.36, 0.42, 0.48], cap: [1, 1, 1, 1], notch: 0.06 },
    narrow: { floor: [0.46, 0.56, 0.88, 0.93], cap: [0.59, 0.64, 0.9, 0.95], notch: 0.05 },
  });
  // 49 born, 9 validated, 3 practised, 3 on Probe, 1 Sized. Probe was counted level with Practice: it is held a notch
  // inside it, and its number is still the House's.
  assert.deepEqual(widthsOf(windowed()), [0.424, 0.5655, 0.6255, 0.7861, 1]);
  assert.deepEqual(agentStages(windowed()).map(stage => stage.ever), [1, 3, 3, 9, 49]);
  // The live swarm on Oct 3, 2026: thousands born, none on real money yet. Nobody there is the floor, never nothing.
  const live = withFunnel({ born: 2373, validation: 380, practice: 33, tuition: 2, incubator: 0, candidate: 0, probe: 0, sized: 0, retired: 2365 });
  assert.deepEqual(widthsOf(live), [0.3, 0.36, 0.6832, 0.8776, 1]);
  assert.deepEqual(widthsOf(live).slice(0, 2), STAIRS.wide.floor.slice(0, 2));
  const one = widthsOf(withFunnel({ born: 2373, validation: 380, practice: 33, candidate: 1, probe: 1, sized: 1, retired: 2365 }));
  assert.ok(one[0] > STAIRS.wide.floor[0] && one[1] > STAIRS.wide.floor[1] && one[1] < one[2], 'one family still shows, above nobody and below thirty-three');
  // A newborn swarm: nobody anywhere, every step at its floor under a whole-width base.
  const newborn = withFunnel({ born: 0, validation: 0, practice: 0, tuition: 0, incubator: 0, candidate: 0, probe: 0, sized: 0, retired: 0, looks: 0, looks_passed: 0 });
  assert.deepEqual(widthsOf(newborn), [...STAIRS.wide.floor, 1]);
  assert.deepEqual(widthsOf(newborn, 'narrow'), [...STAIRS.narrow.floor, 1]);
});

test('a count the House did not publish changes no shape: the step stands where a swarm\'s usual shares put it, and no data at all is the same staircase', () => {
  const rest = layout => stairWidths([null, null, null, null, null], STAIRS[layout]);
  assert.deepEqual(rest('wide'), [0.363, 0.52, 0.681, 0.844, 1]);
  assert.deepEqual(rest('narrow'), [0.4717, 0.58, 0.889, 0.944, 1]);
  assert.deepEqual(REST_SHARES, [0.09, 0.25, 0.45, 0.7]);
  // No funnel at all (an older House, or one whose `levels` carries none), and no checkpoint at all: never flat rows.
  for (const checkpoint of [swarmCheckpoint(), windowed({ levels: null }), windowed({ levels: { ...levelsBlock(), funnel: undefined } }),
    windowed({ levels: { ...levelsBlock(), funnel: null } }), windowed({ levels: { ...levelsBlock(), funnel: 'x' } }), null, undefined, {}]) {
    assert.deepEqual(widthsOf(checkpoint), rest('wide'));
    assert.deepEqual(widthsOf(checkpoint, 'narrow'), rest('narrow'));
    assert.deepEqual(agentStages(checkpoint).map(stage => stage.ever), [null, null, null, null, null], 'no funnel: no counts');
  }
  // Two counts unread: those two rest, the others keep their own.
  const partial = withFunnel({ validation: null, practice: null });
  assert.deepEqual(agentStages(partial).map(stage => stage.ever), [1, 3, null, null, 49]);
  assert.deepEqual(widthsOf(partial), [0.424, 0.5868, 0.681, 0.844, 1]);
  // Births unread: Train is still the base, and the rest are measured against the largest count there is.
  assert.deepEqual(widthsOf(withFunnel({ born: null })), [0.5107, 0.7092, 0.7692, 0.94, 1]);
  // A nonsense count is no count.
  const nonsense = withFunnel({ probe: -1, sized: 1.5, validation: '9' });
  assert.deepEqual(agentStages(nonsense).map(stage => stage.ever), [null, null, 3, null, 49]);
  assert.deepEqual(widthsOf(nonsense), [0.363, 0.52, 0.6255, 0.844, 1]);
});

test('the staircase never bulges: a step counted above the one under it is drawn a notch inside it, and its number is unchanged', () => {
  // The House's chains do not order Practice against Probe: 300 families on Probe over 47 that practised.
  const bulge = withFunnel({ born: 2412, validation: 391, practice: 47, candidate: 300, probe: 300, sized: 120, retired: 2000 });
  assert.equal(validCheckpoint(bulge), true, 'a read the schema accepts');
  assert.deepEqual(agentStages(bulge).map(stage => stage.ever), [120, 300, 47, 391, 2412], 'the numbers are the House\'s');
  assert.deepEqual(widthsOf(bulge), [0.5883, 0.6483, 0.7083, 0.8787, 1]);
  const stages = agentStages(bulge);
  assert.ok(stages[1].share > stages[2].share && stages[1].width.wide < stages[2].width.wide, 'counted above, drawn inside');
  // Whatever the shares say, on a wide screen and on a phone: every order of five counts from a mixed bag, unread ones too.
  const bag = [null, 0, 1, 3, 47, 391, 2412];
  let cases = 0;
  for (const sized of bag) for (const probe of bag) for (const practice of bag) for (const validation of bag) for (const born of bag) {
    const stagesOf = agentStages(swarmCheckpoint({ levels: { as_of: PUBLISHED_AT, agents: [], funnel: { ...funnel(), sized, probe, practice, validation, born } } }));
    assert.deepEqual(stagesOf.map(stage => stage.ever), [sized, probe, practice, validation, born]);
    for (const layout of ['wide', 'narrow']) assertStaircase(stagesOf.map(stage => stage.width[layout]), layout, [sized, probe, practice, validation, born].join('/'));
    cases += 1;
  }
  assert.equal(cases, 7 ** 5);
  // The helper itself, on shares no funnel would give.
  for (const layout of ['wide', 'narrow']) {
    for (const shares of [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [1, 0, 1, 0, 1], [9, -4, NaN, undefined, null], ['1', {}, [], true, 0.5]]) {
      assertStaircase(stairWidths(shares, STAIRS[layout]), layout, JSON.stringify(shares));
    }
  }
  // The two layouts keep their own promise: floors a notch apart, so the clamp can always hold.
  for (const { floor, cap, notch } of Object.values(STAIRS)) {
    assert.ok(notch >= 0.04, 'a notch the eye can see');
    for (let index = 0; index < 3; index += 1) assert.ok(floor[index] + notch <= floor[index + 1] + 1e-9);
    assert.ok(floor[3] + notch <= 1 + 1e-9);
    for (let index = 0; index < 4; index += 1) assert.ok(cap[index] >= floor[index]);
  }
});

test('a phone gives the agents room: seven dots in a row of Practice and eight in Train at 390 px, three on the top step at 320 px, and the label beside Probe', async () => {
  const css = await readFile(new URL('../capital/capital.css', import.meta.url), 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
  const small = css.slice(css.indexOf('@media (max-width: 480px)'));
  // The numbers the arithmetic below stands on, read from the stylesheet itself.
  assert.match(phone, /\.agent-dot \{ width: 44px; height: 44px; flex-basis: 44px; \}/, 'a dot is a 44 px target on a phone');
  assert.match(phone, /\.rung \{[^}]*padding: 9px 10px; \}/);
  assert.match(phone, /\.agent-dots \{[^}]*margin: 0 -8px -5px; \}/);
  assert.match(css, /\.rung \{[^}]*width: var\(--step, 100%\); min-width: var\(--least, 0px\); max-width: 100%;[^}]*border: 1px solid var\(--line\); \}/);
  assert.match(small, /\.rung \{ width: var\(--step-narrow, 100%\); \}/, 'under 480 px the phone\'s staircase');
  const least = Object.fromEntries([...phone.matchAll(/\.rung-(\d)(?:, \.rung-\d)* \{ --least: (\d+)px; \}/g)].map(match => [match[1], Number(match[2])]));
  assert.deepEqual(least, { 5: 144, 4: 164, 3: 184, 2: 204 }, 'each step\'s least width on a phone, widening down the stairs');
  // A row of dots is the step less its two borders and paddings, plus the dots' overhang into the padding.
  const DOT = 44;
  const row = step => step - 2 - 2 * 10 + 2 * 8;
  const board = screen => screen - 32;
  const fits = step => Math.floor(row(step) / DOT);
  const { floor, cap, notch } = STAIRS.narrow;
  assert.equal(fits(board(390)), 8, 'Train, the whole width');
  assert.ok(fits(floor[2] * board(390)) >= 7, 'Practice at its narrowest');
  assert.ok(fits(floor[3] * board(390)) >= 7, 'Validation at its narrowest');
  assert.ok(fits(Math.max(floor[0] * board(390), least[5])) >= 3 && fits(Math.max(floor[1] * board(390), least[4])) >= 4, 'the real-money steps at 390 px');
  assert.ok(fits(Math.max(floor[0] * board(320), least[5])) >= 3 && fits(Math.max(floor[1] * board(320), least[4])) >= 3, 'three agents never wrap, down to 320 px');
  assert.ok(fits(least[5]) >= 3);
  // It still reads as a staircase: every notch is at least 14 px on a 390 px screen, and the big one is the money line.
  assert.ok(notch * board(390) >= 14);
  assert.ok(floor[2] - cap[1] >= 4 * notch, 'the phone narrows hard only at the real-money line');
  // The label (a caret and ten letters of 10 px type) has room beside Probe at its widest, so it never wraps under it.
  const LABEL = 9 + 7 + 10 * 6.6 + 16;
  assert.ok(board(320) - cap[1] * board(320) >= LABEL && board(390) - cap[1] * board(390) >= LABEL);
  assert.match(small, /\.ladder-real-mark \{ margin-left: auto; \}/, 'on a phone it keeps to the line\'s right end');
  // A wide screen: three 40 px dots beside the name fit the narrowest step.
  const wideLeast = Object.fromEntries([...css.slice(0, css.indexOf('@media')).matchAll(/\.rung-(\d) \{ --least: (\d+)px; \}/g)].map(match => [match[1], Number(match[2])]));
  assert.deepEqual(wideLeast, { 5: 282, 4: 306, 3: 330, 2: 354 });
  assert.ok(wideLeast[5] - 2 - 2 * 14 - 92 - 2 * 12 - 16 >= 3 * 40, 'less its outline, padding, name, gaps and a two-figure count');
});

test('the stylesheet draws hairlines, not boxes: no fill on a step, gold only for the line and for real money, the halo clear of the outline', async () => {
  const css = await readFile(new URL('../capital/capital.css', import.meta.url), 'utf8');
  const rules = css.split('\n').filter(line => /^\s*\.(rung|ladder)/.test(line));
  assert.ok(rules.length >= 12);
  assert.doesNotMatch(rules.join('\n'), /background/, 'no step and no part of the board is filled');
  assert.doesNotMatch(rules.join('\n'), /animation|transition/, 'the board itself never moves: only its dots do');
  // The threshold is the one full-strength gold line, twice a hairline; the real-money steps wear the softer gold.
  assert.match(css, /\.ladder-real \{ width: 100%; border-bottom: 2px solid var\(--accent\); \}/);
  assert.match(css, /\.rung-real \{ border-color: #6b5836; \}/);
  assert.match(css, /\.rung-real \.reached-count \{ color: var\(--accent\); \}/);
  assert.match(css, /\.rung-hollow \{ border-style: dashed; \}/);
  // Its label rides the same row as Probe, bottom-aligned on the line and a gap to Probe's right: on a wide screen it is
  // never pushed to the far edge (a phone does that, in its own block).
  assert.match(css, /\.ladder-floor \{ display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0 16px; width: 100%; margin-top: -1px; \}/);
  const markRule = css.split('\n').find(line => line.startsWith('.ladder-real-mark {'));
  assert.match(markRule, /color: var\(--accent\);.*cursor: help; \}$/);
  assert.doesNotMatch(markRule, /margin|position|float/);
  assert.deepEqual(css.match(/\.ladder-real-mark \{ margin-left: auto; \}/g), ['.ladder-real-mark { margin-left: auto; }'], 'once, for the phone');
  assert.ok(css.indexOf('.ladder-real-mark { margin-left: auto; }') > css.indexOf('@media (max-width: 480px)'));
  // Probe's bottom edge is the line itself, so its box is closed by full gold.
  assert.match(css, /\.ladder-floor \.rung \{ flex: none; margin-bottom: -1px; border-bottom-color: var\(--accent\); \}/);
  assert.match(css, /\.ladder-real \+ \.rung \{ border-top: 0; \}/);
  // The caret is drawn, never typed.
  assert.match(css, /\.ladder-real-caret \{[^}]*fill: none; stroke: currentColor;/);
  assert.doesNotMatch(css, /\.ladder-real-mark::before|content: '[\^▲△↑⌃]'/);
  // The open dot's halo is a 36 px circle inside its 40 or 44 px button, so it cannot reach a step's outline or its name.
  assert.match(css, /\.agent-dot\[aria-expanded="true"\]::before \{[^}]*width: 36px; height: 36px;[^}]*border: 1px solid var\(--accent\); border-radius: 50%;/);
  assert.doesNotMatch(css, /\.agent-dot\[aria-expanded="true"\] \{[^}]*box-shadow/);
  assert.match(css, /\.agent-dot:focus-visible \{ outline-offset: -2px; \}/, 'the keyboard\'s ring stays, inside the button');
  assert.match(css, /button:focus-visible, summary:focus-visible \{ outline: 2px solid var\(--accent\);/);
  // Reduced motion still stills every moving part of a dot.
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'), css.indexOf('@media (max-width: 720px)'));
  assert.match(reduced, /\.dot-speaking \.agent-dot-core/);
  assert.match(reduced, /\.agent-dot-core \{ transition: none; \}/);
  assert.match(reduced, /\.agent-activity \{ display: none; \}/);
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
// The stub has no layout. This gives every node the one CSSOM call the board makes (`style.setProperty`), so a test can
// read the width a step was drawn at. `checkpoint` null mounts the page before the House has published anything.
function withStyle() {
  const make = document.createElement;
  document.createElement = tag => { const node = make(tag); node.style = { setProperty(name, value) { this[name] = value; } }; return node; };
}
async function mounted(checkpoint, work) {
  const { capital } = floor(at + 30000);
  if (checkpoint) assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => capital.fetch(new Request('https://blakewoods.us' + path)), async () => {
    withStyle();
    const feed = await startCapital(root);
    try { await work(root); } finally { feed.stop(); }
  });
}
const percent = share => `${(share * 100).toFixed(2)}%`;
// Each step's drawn width, top to bottom, as the stylesheet reads it: [wide, narrow].
const drawnWidths = board => board.withClass('rung').map(rung => [rung.style['--step'], rung.style['--step-narrow']]);
const expectedWidths = checkpoint => agentStages(checkpoint).map(stage => [percent(stage.width.wide), percent(stage.width.narrow)]);
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

const rungClasses = board => board.withClass('rung').map(rung => String(rung.className).split(' ').filter(name => /^rung-(real|vacant|hollow)$/.test(name)).join(' '));
// The whole class list of every step, to pin that nothing else is ever hung on one.
const KNOWN_RUNG_CLASSES = /^(rung|rung-[1-5]|rung-real|rung-vacant|rung-hollow)$/;

// What every board must keep for a keyboard and a screen reader, whatever it was drawn from.
function assertAccessible(board) {
  for (const rung of board.withClass('rung')) {
    for (const name of String(rung.className).split(' ')) assert.match(name, KNOWN_RUNG_CLASSES);
    assert.equal(rung.tag, 'section');
    const heading = rung.withClass('rung-name')[0];
    assert.equal(heading.tag, 'h3');
    assert.ok(heading.id && rung.getAttribute('aria-labelledby') === heading.id, 'each step is named by its own heading');
    assert.ok(heading.getAttribute('title'), 'and says what it means on hover');
  }
  for (const dot of board.withClass('agent-dot')) {
    assert.deepEqual([dot.tag, dot.type, dot.getAttribute('aria-controls'), dot.getAttribute('title')], ['button', 'button', 'agent-detail', dot.getAttribute('aria-label')]);
    assert.match(dot.getAttribute('aria-expanded'), /^(true|false)$/);
    assert.deepEqual(dot.find('svg').map(ring => [ring.getAttribute('class'), ring.getAttribute('aria-hidden')]), [['agent-progress-ring', 'true']]);
  }
  const money = board.withClass('ladder-real');
  assert.deepEqual([money.length, money[0].getAttribute('role'), money[0].getAttribute('aria-label')], [1, 'group', 'Real money']);
  assert.deepEqual([board.querySelector('#agent-detail').getAttribute('aria-live')], ['polite']);
}
// The line's label: a drawn up-caret, the two words, and what the line means on hover.
function assertMoneyMark(board) {
  const marks = board.withClass('ladder-real-mark');
  assert.deepEqual(marks.map(words), ['Real money'], 'two words, once, and the caret is not a character');
  const [mark] = marks;
  assert.equal(MONEY_LINE, 'Only the steps above this line trade real money');
  assert.equal(mark.getAttribute('title'), MONEY_LINE);
  assert.equal(mark.getAttribute('aria-hidden'), 'true', 'the group already says it');
  assert.deepEqual(mark.children.map(child => child.tag), ['svg', 'span']);
  const [caret, text] = mark.children;
  assert.deepEqual([caret.className || caret.getAttribute('class'), caret.getAttribute('aria-hidden'), caret.getAttribute('viewBox'), caret.textContent.trim()],
    ['ladder-real-caret', 'true', '0 0 10 6', '']);
  assert.deepEqual(caret.children.map(child => [child.tag, child.getAttribute('d')]), [['path', 'M1 5 5 1l4 4']], 'one stroke, pointing up');
  assert.equal(words(text), 'Real money');
  // It stands beside the lowest real-money step, on the line under the group, and the group is the top of the board.
  assert.equal(mark.parentNode, board.withClass('rung-4')[0].parentNode, 'beside the lowest real-money step');
  assert.deepEqual(mark.parentNode.children.map(child => String(child.className).split(' ')[0]), ['rung', 'ladder-real-mark'], 'after Probe, on its line');
  assert.equal(mark.parentNode.parentNode, board.withClass('ladder-real')[0]);
  assert.equal(board.withClass('ladder')[0].children[0], board.withClass('ladder-real')[0], 'real money on top');
  assert.deepEqual(board.withClass('ladder-real')[0].withClass('rung').map(rung => words(rung.withClass('rung-name')[0])), ['Sized', 'Probe']);
}

test('mounted: the board is five steps and one real-money line, each dot in its level\'s look, and in each step how many ever reached it', async () => {
  await mounted(windowed(), async root => {
    const board = root.querySelector('#floor-agents');
    const ladder = board.withClass('ladder')[0];
    // Every word the board shows: the five names, the line's two words, and the House's five counts.
    assert.equal(words(ladder), 'Sized 1 Probe 3 Real money Practice 3 Validation 9 Train 49');
    assert.deepEqual(board.withClass('rung-name').map(words), ['Sized', 'Probe', 'Practice', 'Validation', 'Train']);
    assert.deepEqual(board.withClass('rung-name').map(name => name.getAttribute('title')),
      ['sized', 'probe', 'practice', 'validation', 'train'].map(key => LEVEL_TITLES[key]), 'what each step means stays a hover');
    assert.deepEqual(board.withClass('reached-count').map(words), ['1', '3', '3', '9', '49']);
    const counts = board.withClass('reached-count');
    assert.equal(counts[2].getAttribute('title'), '3 families have ever reached Practice');
    assert.equal(counts[0].getAttribute('title'), '1 family has ever reached Sized');
    assert.equal(counts[4].getAttribute('title'), '49 families have ever reached Train · 37 retired · 48,213 backtests', 'the old foot line is Train\'s hover');
    for (const count of counts) assert.deepEqual([count.getAttribute('role'), count.getAttribute('aria-label')], ['img', count.getAttribute('title')]);
    assert.deepEqual(board.withClass('rung').map(rung => rung.withClass('agent-dot').length), [1, 2, 5, 1, 3]);
    assert.deepEqual(rungClasses(board), ['rung-real', 'rung-real', '', '', '']);
    // The staircase: each step's width for a wide screen and for a phone, narrowing all the way up. Probe was counted
    // level with Practice (3 and 3) and is drawn a notch inside it, under its own number.
    assert.deepEqual(drawnWidths(board), [['42.40%', '48.30%'], ['56.55%', '58.83%'], ['62.55%', '88.71%'], ['78.61%', '94.18%'], ['100.00%', '100.00%']]);
    assert.deepEqual(drawnWidths(board), expectedWidths(windowed()));
    // One line: the real-money steps are a named group, its label on the line under Probe and nowhere else.
    assertMoneyMark(board);
    assertAccessible(board);
    // The older levels stand on Practice in their own look.
    const practice = board.withClass('rung-3')[0];
    assert.deepEqual(practice.withClass('agent-dot').map(dot => [dot.dataset.level, dot.dataset.rung]),
      [['candidate', '3'], ['candidate', '3'], ['candidate', '3'], ['practice', '3'], ['tuition', '3']]);
    assert.equal(board.withClass('level-tuition').length, 1);
    assert.equal(board.withClass('level-practice').length, 1);
    assert.equal(board.withClass('dot-practising').length, 0);
    // No header row, no step numbers, no bar, no foot line, no sentence, no date.
    for (const gone of ['ladder-head', 'rung-level', 'reached-bar', 'ladder-foot', 'empty-state', 'rung-unreached', 'rung-uncounted']) assert.deepEqual(board.withClass(gone), [], gone);
    assert.deepEqual(board.find('p'), [], 'no paragraph on the board');
    assert.doesNotMatch(words(ladder), /—|\b20\d\d\b|retired|backtest|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\d+ (days?|sessions?)|[.!?]/i);
    assert.equal(words(ladder).split(' ').length, 12, 'twelve words in all');
    assert.equal(board.withClass('agent-dot').some(dot => dot.dataset.agent === 'reversal-1'), false, 'the retired leave the board');
    // The detail after a tap is as it was: the name, its own level tag, the close button, the structure, the record.
    const sized = board.withClass('level-sized')[0];
    sized.click();
    const detail = board.querySelector('#agent-detail');
    assert.equal(detail.hidden, false);
    assert.equal(sized.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(detail.withClass('agent-detail-head')[0].children.map(child => [child.tag, String(child.className), words(child)]),
      [['h3', '', 'Meriwether'], ['span', 'tag tag-real', 'Sized'], ['button', 'agent-close', '×']]);
    assert.equal(detail.withClass('tag')[0].getAttribute('title'), LEVEL_TITLES.sized);
    assert.match(words(detail), /^Meriwether Sized × iron condor .* real 22 trades · 16 won · \+\$212\.40 5,812 backtests · 41 revisions/);
    assert.equal(words(ladder), 'Sized 1 Probe 3 Real money Practice 3 Validation 9 Train 49', 'the board says nothing more while a detail is open');
    detail.withClass('agent-close')[0].click();
    assert.deepEqual([detail.hidden, sized.getAttribute('aria-expanded')], [true, 'false']);
  });
});

test('mounted: a validated agent that practises is drawn on Practice, dashed, under its Validation tag', async () => {
  const practising = windowed({ practice: practiceBlock(practiceRow('gap-drift')) });
  await mounted(practising, async root => {
    const board = root.querySelector('#floor-agents');
    assert.deepEqual(board.withClass('rung').map(rung => rung.withClass('agent-dot').length), [1, 2, 6, 0, 3]);
    // Validation is empty now, but nine families have reached it: an outline, not a hollow step.
    assert.deepEqual(rungClasses(board), ['rung-real', 'rung-real', '', 'rung-vacant', '']);
    assert.deepEqual(drawnWidths(board), expectedWidths(windowed()), 'who practises moves a dot, never a step\'s width');
    const dot = board.withClass('dot-practising')[0];
    assert.equal(board.withClass('dot-practising').length, 1);
    assert.deepEqual([dot.dataset.agent, dot.dataset.level, dot.dataset.rung], ['gap-drift', 'validation', '3']);
    assert.ok(String(dot.className).split(' ').includes('level-validation'), 'validated, in the validated tone');
    assert.match(dot.getAttribute('aria-label'), /^[A-Za-z]+( \d+)? · Validation, practising · long call$/);
    assert.equal(dot.getAttribute('title'), dot.getAttribute('aria-label'));
    assertAccessible(board);
    dot.click();
    assert.match(words(board.querySelector('#agent-detail')), /^[A-Za-z]+( \d+)? Validation × long call /, 'the detail keeps the House\'s own tag');
    assert.deepEqual(board.querySelector('#agent-detail').withClass('tag').map(tag => [String(tag.className), words(tag)]), [['tag tag-band', 'Validation']]);
    assert.equal(words(board.withClass('ladder')[0]), 'Sized 1 Probe 3 Real money Practice 3 Validation 9 Train 49', 'no new word for it');
  });
});

test('mounted: every level the House can publish has its dot on a step; legacy Tuition, Candidate and the Incubator stand on Practice and open under their own tag', async () => {
  // One agent per (band, level) pair the schema allows, the retired ones holding money among them.
  const pairs = Object.entries(LEVELS_BY_BAND).flatMap(([band, levels]) => levels.map(level => ({ id: `${band}-${level}`, band, level })));
  const checkpoint = swarmCheckpoint({ agents: pairs.map(pair => agent(pair.id, { band: pair.band, ...(pair.band === 'retired' ? { retired_at: PUBLISHED_AT } : {}) })),
    structures: [], levels: { as_of: PUBLISHED_AT, agents: pairs.map(pair => ({ id: pair.id, level: pair.level })), funnel: funnel() } });
  assert.equal(validCheckpoint(checkpoint), true);
  await mounted(checkpoint, async root => {
    const board = root.querySelector('#floor-agents');
    const steps = Object.fromEntries(board.withClass('rung').map(rung => [words(rung.withClass('rung-name')[0]), rung.withClass('agent-dot').map(dot => dot.dataset.agent)]));
    assert.deepEqual(steps, { Sized: ['sized-sized', 'retired-sized'], Probe: ['probe-probe', 'retired-probe'],
      Practice: ['candidate-candidate', 'gym-practice', 'gym-tuition', 'retired-tuition', 'gym-incubator', 'retired-incubator'], Validation: ['gym-validation'], Train: ['gym-train'] });
    assert.equal(board.withClass('agent-dot').length, pairs.length - 1, 'every pair but the retired one with no money');
    assert.equal(board.withClass('agent-dot').some(dot => dot.dataset.agent === 'retired-retired'), false);
    const dots = new Map(board.withClass('agent-dot').map(dot => [dot.dataset.agent, dot]));
    const detail = board.querySelector('#agent-detail');
    const tagKinds = { train: 'band', validation: 'band', practice: 'practice', incubator: 'incubator', tuition: 'tuition', candidate: 'band', probe: 'real', sized: 'real' };
    for (const pair of pairs.filter(entry => entry.level !== 'retired')) {
      const dot = dots.get(pair.id);
      const classes = String(dot.className).split(' ');
      assert.ok(classes.includes(`level-${pair.level}`) && classes.includes(`dot-${pair.band}`), `${pair.id} keeps its level's look`);
      assert.equal(dot.dataset.level, pair.level);
      assert.equal(dot.dataset.rung, String(rungOf(pair.level)), `${pair.id} is drawn on its level's step`);
      assert.match(dot.getAttribute('aria-label'), new RegExp(` · ${LEVEL_WORDS[pair.level]} · `), pair.id);
      dot.click();
      assert.deepEqual(detail.withClass('tag').map(tag => [String(tag.className), words(tag), tag.getAttribute('title')]),
        [[`tag tag-${tagKinds[pair.level]}`, LEVEL_WORDS[pair.level], LEVEL_TITLES[pair.level]]], `${pair.id} opens under its own tag`);
    }
    // The legacy levels by name: on Practice, under the line, never among the real-money steps.
    const real = board.withClass('ladder-real')[0].withClass('agent-dot').map(dot => dot.dataset.level);
    assert.deepEqual([...new Set(real)].sort(), ['probe', 'sized']);
    for (const level of ['tuition', 'candidate', 'incubator']) assert.ok(board.withClass('rung-3')[0].withClass(`level-${level}`).length >= 1, level);
    assertAccessible(board);
    assertMoneyMark(board);
  });
});

test('mounted: a read without the funnel or the practice block draws the same staircase with no number and no placeholder', async () => {
  // An older House: no `levels`, no `practice`, no `rationale`.
  const rest = [['36.30%', '47.17%'], ['52.00%', '58.00%'], ['68.10%', '88.90%'], ['84.40%', '94.40%'], ['100.00%', '100.00%']];
  await mounted(swarmCheckpoint(), async root => {
    const board = root.querySelector('#floor-agents');
    assert.equal(words(board.withClass('ladder')[0]), 'Sized Probe Real money Practice Validation Train');
    assert.deepEqual(board.withClass('reached-count'), []);
    // A step somebody stands on is an outline; the one nobody stands on, with no count to say otherwise, is hollow.
    assert.deepEqual(rungClasses(board), ['rung-real', 'rung-real', '', 'rung-vacant rung-hollow', '']);
    assert.deepEqual(drawnWidths(board), rest, 'the staircase, never flat rows');
    assert.deepEqual(board.withClass('rung').map(rung => rung.withClass('agent-dot').length), [1, 2, 3, 0, 5]);
    assertMoneyMark(board);
    assertAccessible(board);
    board.withClass('agent-dot')[3].click();
    assert.match(words(board.querySelector('#agent-detail')), /^[A-Za-z]+( \d+)? Candidate × /, 'a Candidate stands on Practice under its own tag');
  });
  // The House could not read two of its counts, and its funnel says nobody has reached real money: the rest keep their
  // numbers, the two show none (no dash, no zero, no word), and the shape holds.
  const partial = windowed({ practice: null, levels: levelsBlock({ funnel: funnel({ validation: null, practice: null, candidate: 0, probe: 0, sized: 0, looks_passed: 0 }) }) });
  assert.equal(validCheckpoint(partial), true);
  await mounted(partial, async root => {
    const board = root.querySelector('#floor-agents');
    assert.equal(words(board.withClass('ladder')[0]), 'Sized 0 Probe 0 Real money Practice Validation Train 49');
    assert.deepEqual(board.withClass('rung').map(rung => rung.withClass('reached-count').map(words)), [['0'], ['0'], [], [], ['49']]);
    assert.deepEqual(rungClasses(board), ['rung-real', 'rung-real', '', '', ''], 'agents stand on every step: none is hollow');
    assert.deepEqual(drawnWidths(board), [['30.00%', '46.00%'], ['36.00%', '56.00%'], ['68.10%', '88.90%'], ['84.40%', '94.40%'], ['100.00%', '100.00%']]);
    assert.equal(board.withClass('reached-count')[0].getAttribute('title'), '0 families have ever reached Sized');
    assert.doesNotMatch(words(board), /—|–|Unknown|null|NaN|undefined/);
    assert.equal(board.withClass('agent-dot').length, 12, 'every agent still has its dot');
    assertAccessible(board);
  });
});

test('mounted: a step nobody stands on and nobody has reached is hollow; one that is only empty now keeps its outline', async () => {
  // The live swarm on Oct 3, 2026 in small: agents train and practise, some were validated, nobody is on real money.
  const gym = AGENTS.filter(entry => entry.band === 'gym');
  const level = { 'gap-drift': 'practice', 'skew-revert': 'practice' };
  const quiet = swarmCheckpoint({ agents: gym, structures: [],
    levels: { as_of: PUBLISHED_AT, agents: gym.map(entry => ({ id: entry.id, level: level[entry.id] || 'train' })),
      funnel: funnel({ born: 2373, validation: 380, practice: 33, tuition: 0, incubator: 0, looks: 3, looks_passed: 0, candidate: 0, probe: 0, sized: 0, retired: 2365 }) } });
  assert.equal(validCheckpoint(quiet), true);
  await mounted(quiet, async root => {
    const board = root.querySelector('#floor-agents');
    assert.equal(words(board.withClass('ladder')[0]), 'Sized 0 Probe 0 Real money Practice 33 Validation 380 Train 2,373');
    assert.deepEqual(board.withClass('rung').map(rung => rung.withClass('agent-dot').length), [0, 0, 2, 0, 3]);
    assert.deepEqual(rungClasses(board), ['rung-real rung-vacant rung-hollow', 'rung-real rung-vacant rung-hollow', '', 'rung-vacant', '']);
    assert.deepEqual(drawnWidths(board), [['30.00%', '46.00%'], ['36.00%', '56.00%'], ['68.32%', '88.91%'], ['87.76%', '94.53%'], ['100.00%', '100.00%']]);
    assertMoneyMark(board);
    assertAccessible(board);
  });
});

test('mounted with no data at all: the same silhouette, hollow steps and their names, no count, no dot and no sentence', async () => {
  await mounted(null, async root => {
    const board = root.querySelector('#floor-agents');
    assert.equal(board.getAttribute('aria-busy'), 'false');
    assert.equal(words(board), 'Sized Probe Real money Practice Validation Train', 'seven words: five names and the line');
    assert.deepEqual(board.withClass('rung-name').map(words), ['Sized', 'Probe', 'Practice', 'Validation', 'Train']);
    assert.deepEqual(rungClasses(board), ['rung-real rung-vacant rung-hollow', 'rung-real rung-vacant rung-hollow', 'rung-vacant rung-hollow', 'rung-vacant rung-hollow',
      'rung-vacant rung-hollow'], 'every step is hollow');
    // The staircase a swarm's usual shares draw, on a wide screen and on a phone: never flat rows.
    assert.deepEqual(drawnWidths(board), [['36.30%', '47.17%'], ['52.00%', '58.00%'], ['68.10%', '88.90%'], ['84.40%', '94.40%'], ['100.00%', '100.00%']]);
    assert.deepEqual(drawnWidths(board), expectedWidths(null));
    for (const gone of ['agent-dot', 'reached-count', 'empty-state', 'agent-detail-card']) assert.deepEqual(board.withClass(gone), [], gone);
    assert.deepEqual(board.find('p'), [], 'no sentence');
    assert.doesNotMatch(words(board), /Waiting|—|\d/);
    assertMoneyMark(board);
    assertAccessible(board);
    assert.equal(board.querySelector('#agent-detail').hidden, true);
  });
});
