// The swarm window (Oct 1, 2026): why each trade, every result, the levels and performance over time. The schema's two new
// blocks, the Worker's reads for old and new pages, one agent's tape, the score archive, and the page's pure models.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, ROUTES, EXITS, FUNNEL_KEYS, FUNNEL_CHAINS, OPTIONAL_CHECKPOINT_FIELDS, MAX_AGENTS, thesisWords, validCheckpoint, validLevels, validRationale, validFunnel,
  scorePoint, validScorePoint,
} from '../capital/schema.js';
import { CURRENT_READ, POSITIONS_READ, WINDOW_READ, MAX_SCORE_POINTS, SCORE_BUCKET_MS } from '../lib/capital.mjs';
import {
  CHECKPOINT_READ, STEPS, climbModel, climbLayout, levelOf, thesisText, houseThesis, agentThesis, plainTag, tickerCase, cutNumber, numbered, interimRationale,
  rationaleFor, riskShare, pitchFor,
  realizedSteps, realizedAt, scoreSeries, scoreModel, marketClosedBands, niceTicks, newsKind, feedLine, netNumber, lastKnown, holdMs, ordinalOf,
  HOUSE_RATIONALE, nyInstant,
} from '../capital/capital.js';
import { floor, post, get } from './harness.mjs';
import {
  swarmCheckpoint, ledgerCheckpoint, ledger, position, agent, structure, note, trade, news, POSITIONS, PUBLISHED_AT, RESET_AT, GOOGL_THESIS,
  WINDOW_AGENTS, WINDOW_POSITIONS, LEVEL_OF, funnel, levelsBlock, rationaleBlock, rationaleTrade, windowCheckpoint,
} from './swarm-fixture.mjs';

const at = Date.parse(PUBLISHED_AT);
const BILL = { as_of: '2026-09-28T14:57:00.000Z', sail_usd: '212.40', claude_usd: '41.20', openai_usd: '64.10', thetadata_usd: '5.43',
  market_data_usd: '5.66', other_usd: '0.00' };
const batch = (...events) => ({ schema_version: 2, events });
const withLevels = (agents, extra = {}) => windowCheckpoint({ levels: levelsBlock({ agents, ...extra }) });
const withTrades = trades => windowCheckpoint({ rationale: rationaleBlock({ trades }) });

// ---------------------------------------------------------------------------- the schema
test('the window adds two optional blocks: the words for levels, routes and exits, and fourteen funnel keys', () => {
  assert.deepEqual(LEVELS, ['train', 'practice', 'validation', 'incubator', 'tuition', 'candidate', 'probe', 'sized', 'retired']);
  assert.deepEqual(ROUTES, ['tuition', 'incubator', 'probe', 'sized', 'calibration', 'house']);
  assert.deepEqual(EXITS, ['agent', 'house', 'expiry']);
  assert.equal(FUNNEL_KEYS.length, 14);
  assert.deepEqual(OPTIONAL_CHECKPOINT_FIELDS, ['trading', 'positions', 'practice', 'levels', 'rationale']);
  assert.equal(validCheckpoint(windowCheckpoint()), true, 'a new House: both blocks');
  assert.equal(validCheckpoint(ledgerCheckpoint()), true, 'an old House: neither');
  const { rationale: _r, ...levelsOnly } = windowCheckpoint();
  assert.equal(validCheckpoint(levelsOnly), true, 'each block is optional on its own');
  assert.equal(validCheckpoint(windowCheckpoint({ levels: null, rationale: null })), true, 'or null');
  assert.equal(validCheckpoint({ ...windowCheckpoint(), climb: {} }), false, 'no other block');
});

test('levels: one level per roster agent, consistent with its band, and a funnel that only narrows', () => {
  const body = windowCheckpoint();
  assert.equal(validLevels(body.levels, body, PUBLISHED_AT), true);
  const agents = body.levels.agents;
  const swap = (id, level) => agents.map(row => (row.id === id ? { ...row, level } : row));
  for (const [label, value] of [
    ['an id off the roster', withLevels([...agents, { id: 'stranger', level: 'train' }])],
    ['an id twice', withLevels([...agents, agents[0]])],
    ['an unknown level', withLevels(swap('calendar-term', 'gym'))],
    ['a Gym agent on Probe', withLevels(swap('calendar-term', 'probe'))],
    ['a Gym agent past the holdout', withLevels(swap('calendar-term', 'candidate'))],
    ['a Sized agent anywhere else', withLevels(swap('condor-vrp-3', 'probe'))],
    ['a Candidate on Train', withLevels(swap('ironfly-quiet', 'train'))],
    ['a retired agent on Train', withLevels(swap('reversal-1', 'train'))],
    ['a retired agent in Validation', withLevels(swap('googl-lags', 'validation'))],
    ['an entry with more to say', withLevels(agents.map((row, n) => (n ? row : { ...row, why: 'x' })))],
    ['dated after its checkpoint', withLevels(agents, { as_of: '2026-09-28T15:00:00.000Z' })],
    ['too many', withLevels(Array.from({ length: MAX_AGENTS + 1 }, () => agents[0]))],
  ]) assert.equal(validCheckpoint(value), false, label);
  // Band consistency: a Gym agent may stand anywhere below the holdout; a retired one only where its money is.
  for (const level of ['train', 'practice', 'validation', 'incubator', 'tuition']) assert.equal(validCheckpoint(withLevels(swap('calendar-term', level))), true, level);
  for (const level of ['retired', 'tuition', 'incubator', 'probe', 'sized']) assert.equal(validCheckpoint(withLevels(swap('reversal-1', level))), true, level);
  assert.equal(validCheckpoint(withLevels([])), true, 'the House may send no agent entries');
});

test('the funnel: fourteen keys, counters or null, and each track narrows among the counts it knows', () => {
  assert.equal(validFunnel(funnel()), true);
  assert.equal(validFunnel(funnel({ validation: null, practice: null })), true, 'a source the House could not read is null');
  assert.equal(validFunnel(Object.fromEntries(FUNNEL_KEYS.map(key => [key, key === 'since' ? RESET_AT : null]))), true, 'all unknown');
  // Tuition is its own chain under Validation: a look needs no tuition first, and a failed look never gets one, so more
  // families may reach the Holdout than Tuition (the House's funnel since Oct 1, 2026).
  assert.deepEqual(FUNNEL_CHAINS, [['sized', 'probe', 'candidate', 'validation', 'born'], ['tuition', 'validation'], ['incubator', 'practice', 'born'],
    ['retired', 'born'], ['looks_passed', 'looks']]);
  assert.equal(validFunnel(funnel({ tuition: 1 })), true, 'candidate 6 above tuition 1');
  assert.equal(validFunnel(funnel({ tuition: 0, candidate: 9 })), true, 'every validated family looked, none paid tuition');
  assert.equal(validCheckpoint(windowCheckpoint({ levels: levelsBlock({ funnel: funnel({ tuition: 1 }) }) })), true, 'the whole window stands');
  for (const [label, value] of [
    ['probe above candidate', funnel({ probe: 7 })], ['sized above probe', funnel({ sized: 4 })], ['tuition above validation', funnel({ tuition: 10 })],
    ['validation above born', funnel({ validation: 50 })], ['the incubator above practice', funnel({ incubator: 4 })], ['practice above born', funnel({ practice: 60 })],
    ['more retired than born', funnel({ retired: 50 })], ['more passes than looks', funnel({ looks_passed: 5 })],
    ['a gap skipped by a null still narrows', funnel({ candidate: null, validation: 2 })], ['tuition above validation, alone', funnel({ tuition: 10, candidate: 0, probe: 0, sized: 0 })],
    ['a fraction', funnel({ born: 49.5 })], ['a negative', funnel({ looks: -1 })], ['a string', funnel({ born: '49' })], ['since not an instant', funnel({ since: '2026-09-26' })],
    ['a key missing', (({ live_test: _l, ...rest }) => rest)(funnel())], ['a key more', funnel({ odds: 1 })],
  ]) assert.equal(validFunnel(value), false, label);
});

test('rationale: theses in safe words, and each trade’s route, tags, exit and risk fit its ledger row', () => {
  const body = windowCheckpoint();
  assert.equal(validRationale(body.rationale, body, PUBLISHED_AT), true);
  const trades = body.rationale.trades;
  const patch = (id, change) => trades.map(row => (row.id === id ? { ...row, ...change } : row));
  for (const [label, value] of [
    ['a thesis for an agent off the roster', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'stranger', thesis: 'A fine idea.' }] }) })],
    ['a thesis with a digit', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'Breaks a fresh 60-day low.' }] }) })],
    ['a thesis with a colon', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'The rule: buy the break.' }] }) })],
    ['a thesis with code', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'When PARAMS[width] is wide.' }] }) })],
    ['a thesis naming the venue', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: 'Alpaca fills it at the open.' }] }) })],
    ['a thesis over 280', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: `${'word '.repeat(57)}end.` }] }) })],
    ['a blank thesis', windowCheckpoint({ rationale: rationaleBlock({ agents: [{ id: 'orb-4', thesis: '  ' }] }) })],
    ['a trade off the ledger', withTrades([...trades, rationaleTrade('real:99')])],
    ['a trade twice', withTrades([...trades, trades[0]])],
    ['an agent row on the calibration route', withTrades(patch('real:7', { route: 'calibration' }))],
    ['a calibration row on an agent route', withTrades(patch('real:1', { route: 'tuition' }))],
    ['an incubator row on Probe', withTrades(patch('real:9', { route: 'probe' }))],
    ['an unknown route', withTrades(patch('real:7', { route: 'gym' }))],
    ['a House row with a reason', withTrades(patch('real:1', { open_why: 'measures fills' }))],
    ['an open row with a close reason', withTrades(patch('real:8', { close_why: 'done here' }))],
    ['an open row with an exit', withTrades(patch('real:8', { exit: 'agent' }))],
    ['an exit in words', withTrades(patch('real:5', { exit: 'the agent closed it' }))],
    ['a tag with a digit', withTrades(patch('real:8', { open_why: 'msft up 3 days' }))],
    ['a tag over 80', withTrades(patch('real:8', { open_why: 'a'.repeat(81) }))],
    ['a tag with a quote', withTrades(patch('real:8', { open_why: 'bid 1.25 ask 1.30' }))],
    ['a risk below zero', withTrades(patch('real:8', { max_loss_usd: '-1.00' }))],
    ['a risk in fractions of a cent', withTrades(patch('real:8', { max_loss_usd: '157.005' }))],
    ['a maximum gain', withTrades(patch('real:8', { max_gain_usd: '43.00' }))],
    ['a strike', withTrades(patch('real:8', { strike: '170' }))],
    ['trades with no ledger', windowCheckpoint({ positions: undefined })],
  ]) {
    const value_ = { ...value };
    if (label === 'trades with no ledger') delete value_.positions;
    assert.equal(validCheckpoint(value_), false, label);
  }
  const noLedger = { ...windowCheckpoint({ rationale: rationaleBlock({ trades: [] }) }) };
  delete noLedger.positions;
  assert.equal(validCheckpoint(noLedger), true, 'no ledger: no trades');
  assert.equal(validCheckpoint(withTrades(patch('real:5', { exit: null, close_why: null }))), true, 'an exit nobody recorded is null');
  assert.equal(thesisWords("investors reprice one on the other's capex", 80), true);
  for (const bad of ['IWM breaks to a fresh 60-day low', 'the (wide) leg', 'a = b', 'snake_case', 'a #tag', 'pipe | here', 'back\\slash', 'x < y', '{ }', '[ ]', '',
    'the gap exceeds ½ of the move', 'the Ⅻ month lookback', 'IV is ٣ points over realized', 'a ３ day hold', 'sev\u00aden days', 'one\u200bsigma']) {
    assert.equal(thesisWords(bad, 280), false, bad);
  }
});

// ---------------------------------------------------------------------------- the Worker
test('every read but the window read is byte for byte what it was, with the blocks stored or not (C7)', async () => {
  const reads = ['', '?progress=1', POSITIONS_READ, CURRENT_READ, WINDOW_READ];
  assert.equal(CHECKPOINT_READ, WINDOW_READ);
  assert.equal(WINDOW_READ, '?progress=1&positions=1&practice=1&window=1');
  const bodies = async checkpoint => {
    const { capital } = floor(at + 30000);
    assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint)).status, 200);
    return Promise.all(reads.map(async query => { const response = await get(capital, `/api/capital/checkpoint${query}`); assert.equal(response.status, 200, query); return response.text(); }));
  };
  const withBlocks = await bodies(windowCheckpoint());
  const { levels: _l, rationale: _r, ...plain } = windowCheckpoint();
  const without = await bodies(plain);
  for (let index = 0; index < 4; index++) assert.equal(withBlocks[index], without[index], `${reads[index] || 'default'}: unchanged by the stored blocks`);
  for (let index = 0; index < 4; index++) {
    const body = JSON.parse(withBlocks[index]);
    assert.equal('levels' in body || 'rationale' in body, false, reads[index] || 'default');
  }
  const window = JSON.parse(withBlocks[4]);
  assert.deepEqual(window.levels, levelsBlock());
  assert.deepEqual(window.rationale, rationaleBlock());
  assert.equal(validCheckpoint(window, { publicRead: true }), true);
  // The window read is CURRENT_READ plus the two blocks, and nothing else.
  const current = JSON.parse(withBlocks[3]);
  assert.deepEqual({ ...current, levels: window.levels, rationale: window.rationale }, window);
  assert.deepEqual(JSON.parse(without[4]), JSON.parse(without[3]), 'an old House: the window read is CURRENT_READ');
  const { capital } = floor(at + 30000);
  await post(capital, '/api/capital/checkpoint', windowCheckpoint());
  for (const query of ['?window=1', '?progress=1&positions=1&window=1', '?progress=1&positions=1&practice=1&window=0', '?window=1&progress=1&positions=1&practice=1']) {
    assert.equal((await get(capital, `/api/capital/checkpoint${query}`)).status, 404, query);
  }
});

test('one agent’s tape: its notes and trades, and the swarm’s news about it, with kind, cursor and limit', async () => {
  const { capital } = floor();
  const events = [note('orb-4', 'One.'), news('is born, a new family: Breaks of the opening range.', PUBLISHED_AT, 'orb-4'), note('condor-vrp-3', 'Other.'),
    trade('orb-4'), news('retired: never beat the fill cost.', PUBLISHED_AT, 'condor-vrp-3'), news('New code on main.', PUBLISHED_AT, null)];
  assert.equal((await post(capital, '/api/capital/events', batch(...events))).status, 200);
  const read = async query => (await (await get(capital, `/api/capital/events${query}`)).json()).events.map(event => event.id);
  assert.deepEqual(await read('?agent=orb-4'), [events[3].id, events[1].id, events[0].id]);
  assert.deepEqual(await read('?agent=orb-4&kind=swarm.news'), [events[1].id]);
  assert.deepEqual(await read('?agent=orb-4&kind=agent.note&limit=5'), [events[0].id]);
  assert.deepEqual(await read('?agent=orb-4&after=1'), [events[1].id, events[3].id], 'a cursor reads forward');
  assert.deepEqual(await read('?agent=orb-4&limit=1'), [events[3].id]);
  assert.deepEqual(await read('?agent=nobody'), []);
  for (const query of ['?agent=orb-4&stream=agent%3Aorb-4', '?agent=Orb', '?agent=', '?agent=orb-4&agent=condor-vrp-3']) {
    assert.equal((await get(capital, `/api/capital/events${query}`)).status, 400, query);
  }
  const index = capital.sql.exec("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'events_news_agent'").toArray();
  assert.equal(index.length, 1, 'the news-by-agent index exists');
});

test('the score archive: one point per five minutes, the latest wins, nulls kept, key-range retention, keyed sampling, one basis, and the reset', async () => {
  assert.equal(SCORE_BUCKET_MS, 300000);
  assert.equal(MAX_SCORE_POINTS, 30000);
  let now = at + 30000;
  const { capital } = floor();
  capital.now = () => now;
  const itemized = (minute, pnl, basis = swarmCheckpoint().performance) => {
    const stamp = `2026-09-28T14:${String(minute).padStart(2, '0')}:00.000Z`;
    return ledgerCheckpoint({ published_at: stamp, trading: { as_of: stamp, pnl_usd: pnl }, compute: { ...BILL, as_of: stamp },
      positions: pnl === null ? ledger({ as_of: stamp, rows: POSITIONS.map(row => ({ ...row, pnl_usd: null })), other: null, unreconciled_usd: null })
        : ledger({ as_of: stamp, other: { ...ledger().other, as_of: stamp } }),
      account: { ...swarmCheckpoint().account, as_of: stamp }, gym: { ...swarmCheckpoint().gym, as_of: stamp }, performance: { ...basis, verified_at: stamp } });
  };
  const read = async () => (await get(capital, '/api/capital/score')).json();
  assert.deepEqual(await read(), { schema_version: 2, sampled: false, step_ms: 300000, points: [], last_profit: null, last_net: null });
  for (const [minute, pnl] of [[50, '220.40'], [51, '220.40'], [56, null]]) {
    assert.equal((await post(capital, '/api/capital/checkpoint', itemized(minute, pnl))).status, 200);
  }
  const score = await read();
  assert.deepEqual(score.points, [
    { at: '2026-09-28T14:51:00.000Z', profit_usd: '220.40', costs_usd: '328.79', net_usd: '-120.89' },
    { at: '2026-09-28T14:56:00.000Z', profit_usd: null, costs_usd: '328.79', net_usd: null },
  ], '14:50 and 14:51 share a bucket');
  assert.deepEqual(score.last_profit, { at: '2026-09-28T14:51:00.000Z', profit_usd: '220.40' }, 'the newest known Profit, past the unknown one');
  assert.deepEqual(score.last_net, { at: '2026-09-28T14:51:00.000Z', net_usd: '-120.89' });
  assert.ok(score.points.every(validScorePoint));
  assert.equal((await get(capital, '/api/capital/score?limit=5')).status, 400, 'no query string');
  assert.equal((await post(capital, '/api/capital/score', {})).status, 405);
  assert.match((await get(capital, '/api/capital/score')).headers.get('Cache-Control'), /max-age=300\b/, 'a point changes once per bucket at most');
  assert.equal((await post(capital, '/api/capital/checkpoint', itemized(56, null))).status, 200, 'an identical replay changes nothing');
  assert.equal((await read()).points.length, 2);
  // Spanning more than 2,048 buckets, a read samples by key: the first bucket at or after each step, and the newest.
  for (let bucket = 1; bucket <= 2100; bucket++) {
    capital.sql.exec('INSERT INTO score_history (bucket, at, profit_usd, costs_usd, net_usd, basis) VALUES (?, ?, NULL, ?, NULL, ?)', bucket, new Date(bucket * 300000).toISOString(), '1.00', RESET_AT);
  }
  const newest = Math.floor(Date.parse('2026-09-28T14:56:00.000Z') / SCORE_BUCKET_MS);
  const sampled = await read();
  assert.equal(sampled.sampled, true);
  assert.equal(sampled.step_ms, Math.ceil((newest - 1) / 2047) * SCORE_BUCKET_MS);
  assert.ok(sampled.points.length <= 2048);
  assert.deepEqual(sampled.points.map(point => point.at), [new Date(300000).toISOString(), '2026-09-28T14:51:00.000Z', '2026-09-28T14:56:00.000Z']);
  // Retention deletes by key range: every bucket MAX_SCORE_POINTS or more older than the newest.
  const next = Math.floor(Date.parse('2026-09-28T14:58:00.000Z') / SCORE_BUCKET_MS);
  for (let bucket = next - MAX_SCORE_POINTS - 5; bucket <= next - MAX_SCORE_POINTS + 10; bucket++) {
    capital.sql.exec('INSERT INTO score_history (bucket, at, costs_usd, basis) VALUES (?, ?, ?, ?)', bucket, new Date(bucket * 300000).toISOString(), '1.00', RESET_AT);
  }
  now += 600000;
  assert.equal((await post(capital, '/api/capital/checkpoint', itemized(58, '220.40'))).status, 200);
  const oldest = Number(capital.sql.exec('SELECT MIN(bucket) AS b FROM score_history').toArray()[0].b);
  assert.equal(oldest, next - MAX_SCORE_POINTS + 1, 'the oldest went, the rest stay');
  assert.equal(Number(capital.sql.exec('SELECT COUNT(*) AS n FROM score_history').toArray()[0].n), 10 + 2, 'ten kept, then 14:51 and 14:58 (in 14:56’s bucket)');
  // A new Profit basis starts the archive over: no line mixes two bases.
  now += 120000;
  const rebased = { ...swarmCheckpoint().performance, start_at: '2026-09-28T14:00:00.000Z' };
  assert.equal((await post(capital, '/api/capital/checkpoint', itemized(59, '220.40', rebased))).status, 200);
  assert.deepEqual((await read()).points.map(point => point.at), ['2026-09-28T14:59:00.000Z']);
  const reset = await (await post(capital, '/api/capital/reset?confirm=erase-everything', {})).json();
  assert.equal(reset.cleared.score_history, 1);
  assert.deepEqual((await read()).points, []);
});

test('a score point is Profit, the bill and Net by the page’s own rule, measured against its checkpoint only', () => {
  const body = ledgerCheckpoint({ compute: BILL });
  assert.deepEqual(scorePoint(body), { at: PUBLISHED_AT, profit_usd: '220.40', costs_usd: '328.79', net_usd: '-120.89' });
  assert.equal(scorePoint(body).net_usd, netNumber(body, at), 'parity with the headline’s Net');
  for (const [label, value] of [
    ['an unreconciled gain', ledgerCheckpoint({ compute: BILL, trading: { as_of: PUBLISHED_AT, pnl_usd: '221.40' }, positions: ledger({ unreconciled_usd: '1.00' }) })],
    ['an unreconciled loss', ledgerCheckpoint({ compute: BILL, trading: { as_of: PUBLISHED_AT, pnl_usd: '219.40' }, positions: ledger({ unreconciled_usd: '-1.00' }) })],
    ['a bill in fractions of a cent', ledgerCheckpoint({ compute: { ...BILL, sail_usd: '212.405', claude_usd: '41.2049' } })],
  ]) assert.equal(scorePoint(value).net_usd, netNumber(value, at), label);
  assert.equal(scorePoint(ledgerCheckpoint()).costs_usd, null, 'an older bill is not itemized');
  assert.equal(scorePoint(ledgerCheckpoint()).net_usd, null);
  assert.equal(scorePoint(ledgerCheckpoint({ compute: { ...BILL, openai_usd: null } })).costs_usd, null);
  assert.equal(scorePoint(ledgerCheckpoint({ compute: { ...BILL, as_of: '2026-09-28T14:40:00.000Z' } })).costs_usd, null, 'a stale bill');
  assert.equal(scorePoint(ledgerCheckpoint({ compute: BILL, trading: { as_of: '2026-09-28T14:40:00.000Z', pnl_usd: '220.40' }, positions: ledger({ as_of: '2026-09-28T14:40:00.000Z' }) })).profit_usd, null, 'a stale Profit');
  assert.equal(scorePoint(swarmCheckpoint({ compute: BILL })).net_usd, null, 'no ledger: no Net');
  assert.equal(scorePoint(windowCheckpoint({ compute: BILL })).net_usd, netNumber(windowCheckpoint({ compute: BILL }), at), 'an open loss counts');
});

// ---------------------------------------------------------------------------- the Climb
test('the Climb: the House’s levels first, a retired agent with open money on its money’s step, and unknown counts as dashes', () => {
  const model = climbModel(windowCheckpoint(), {});
  const where = Object.fromEntries(STEPS.map(step => [step.key, model.steps[step.key].agents.map(dot => dot.id)]));
  const sorted = Object.fromEntries(Object.entries(where).map(([key, ids]) => [key, [...ids].sort()]));
  assert.deepEqual(sorted, { train: ['calendar-term', 'eod-drift', 'strangle-cheap'], validation: ['gap-drift'], tuition: ['googl-lags'],
    holdout: ['butterfly-pin', 'ironfly-quiet', 'trend-vertical'], probe: ['orb-4', 'putspread-dip-2'], sized: ['condor-vrp-3'], practice: ['skew-revert'], incubator: [] });
  const googl = model.dots.get('googl-lags');
  assert.deepEqual([googl.retired, googl.money, googl.level], [true, 'real', 'tuition'], 'retired, filled gold, standing on Tuition');
  assert.equal(model.dots.has('reversal-1'), false, 'retired with no money: in the graveyard');
  assert.equal(model.dots.get('condor-vrp-3').money, 'real');
  assert.equal(model.dots.get('ironfly-quiet').money, 'shadow', 'a Candidate’s forward book is dashed');
  assert.equal(model.dots.get('skew-revert').money, 'shadow', 'practice is dashed');
  assert.equal(model.dots.get('calendar-term').money, 'research');
  assert.deepEqual(STEPS.map(step => [step.key, model.steps[step.key].now, model.steps[step.key].everCount]), [
    ['train', 3, 49], ['validation', 1, 9], ['tuition', 1, 7], ['holdout', 3, 6], ['probe', 2, 3], ['sized', 1, 1], ['practice', 1, 3], ['incubator', 0, 1]]);
  assert.deepEqual([model.graveyard, model.house, model.looks, model.trials], [37, { calibration: 1, liveTest: 0 }, { looks: 4, passed: 3 }, 48213]);
  // An older House: the band and the ledger say what they can; the rest is a dash, never 0.
  const old = climbModel(ledgerCheckpoint(), {});
  assert.deepEqual(STEPS.map(step => [step.key, old.steps[step.key].now, old.steps[step.key].everCount]), [
    ['train', 5, 48], ['validation', null, null], ['tuition', 0, null], ['holdout', 3, null], ['probe', 2, null], ['sized', 1, null], ['practice', null, null], ['incubator', 0, null]]);
  assert.equal(old.looks, null, 'no pips without the House');
  assert.deepEqual(old.house, { calibration: 1, liveTest: 0 });
  assert.equal(climbModel(ledgerCheckpoint({ positions: ledger({ rows: POSITIONS.slice(0, 4), earlier: { positions: 2, pnl_usd: '203.20' } }) })).house.calibration, null,
    'with positions folded away the rows cannot count them');
  // Interim tuition: real money on a Gym agent with no incubator tag; an incubator row puts its agent on the Incubator.
  const interim = ledgerCheckpoint({ positions: ledger({ rows: [position('real:20', { agent: 'gap-drift', underlying: 'SPY', structure: 'long_call', right: 'call', legs: 1, pnl_usd: '0.00' }),
    ...POSITIONS.map(row => (row.id === 'real:7' ? { ...row, pnl_usd: '12.50' } : row))] }), trading: { as_of: PUBLISHED_AT, pnl_usd: '220.40' } });
  assert.equal(levelOf(interim.agents.find(row => row.id === 'gap-drift'), interim), 'tuition');
  const incubated = ledgerCheckpoint({ structures: [structure('s-inc', { agent: 'eod-drift', route: 'incubator' })] });
  assert.equal(levelOf(incubated.agents.find(row => row.id === 'eod-drift'), incubated), 'incubator');
  assert.equal(climbModel(incubated).dots.get('eod-drift').money, 'incubator');
});

test('dots keep a stable order by partner ordinal; births and retirements on the tape move the map until the checkpoint confirms them', () => {
  assert.deepEqual(['Mullins 166', 'Meriwether', 'Leahy 2', 'Hilibrand', 'someone'].map(ordinalOf), [1986, 1, 24, 2, Infinity]);
  const named = WINDOW_AGENTS.map(row => ({ ...row, display_name: { 'calendar-term': 'Scholes', 'strangle-cheap': 'Meriwether 2', 'eod-drift': 'Hilibrand' }[row.id] }))
    .map(row => (row.display_name ? row : (({ display_name: _d, ...rest }) => rest)(row)));
  const ids = model => model.steps.train.agents.map(dot => dot.id);
  const before = climbModel(windowCheckpoint({ agents: named }));
  assert.deepEqual(ids(before), ['eod-drift', 'calendar-term', 'strangle-cheap'], 'Hilibrand (2), Scholes (3), Meriwether 2 (13)');
  const busier = named.map(row => (row.id === 'eod-drift' ? { ...row, record: { ...row.record, trials: 99999 } } : row));
  assert.deepEqual(ids(climbModel(windowCheckpoint({ agents: busier }))), ids(before), 'trials never reorder');
  const born = climbModel(windowCheckpoint({ agents: named }), { born: [{ id: 'new-idea', name: 'Leahy 9' }, { id: 'calendar-term' }] });
  assert.deepEqual(ids(born), [...ids(before), 'new-idea']);
  assert.equal(born.dots.get('new-idea').provisional, true);
  assert.equal(born.steps.train.now, 4);
  const gone = climbModel(windowCheckpoint({ agents: named }), { gone: ['calendar-term', 'googl-lags'] });
  assert.equal(gone.dots.has('calendar-term'), false);
  assert.equal(gone.dots.has('googl-lags'), true, 'an agent still holding money stays on the map');
  assert.equal(gone.graveyard, 38);
});

test('the map’s geometry: stairs rise, the side path stays flat, every dot inside the box, real money right of the gold line', () => {
  // The map is drawn from 760 pixels wide; a phone reads the ladder instead.
  for (const [width, height] of [[800, 300], [1100, 600], [728, 330], [840, 280]]) {
    const model = climbModel(windowCheckpoint());
    const layout = climbLayout(model, width, height);
    const mains = ['train', 'validation', 'tuition', 'holdout', 'probe', 'sized'].map(key => layout.steps[key]);
    mains.forEach((step, index) => { if (index) { assert.ok(step.y < mains[index - 1].y, `${width}: rises`); assert.ok(step.x >= mains[index - 1].x + mains[index - 1].w); } });
    assert.equal(layout.steps.practice.y, layout.steps.incubator.y, 'the side path is flat');
    assert.ok(layout.steps.practice.y > layout.steps.train.y, 'below Train, never above it');
    assert.ok(layout.steps.practice.x < layout.goldX && layout.steps.incubator.x > layout.goldX, 'the gold line cuts both tracks');
    assert.ok(layout.steps.validation.x + layout.steps.validation.w < layout.goldX && layout.steps.tuition.x > layout.goldX);
    for (const [id, dot] of layout.dots) {
      assert.ok(dot.cx > 0 && dot.cx < layout.width && dot.cy > 0 && dot.cy < layout.height, `${width}×${height}: ${id}`);
    }
    assert.equal(layout.dots.size, model.dots.size);
  }
  const crowd = climbModel(swarmCheckpoint({ agents: Array.from({ length: 60 }, (_, n) => agent(`family-${n}`)) }));
  const grid = climbLayout(crowd, 900, 300);
  assert.equal(grid.steps.train.cols, 12, '60 dots: a 12 × 5 grid');
  assert.equal(grid.steps.train.rows, 5);
});

test('an agent off the roster that still holds real money stands, retired, on that money’s step; a big box spreads the map', () => {
  const stray = position('real:30', { agent: 'off-roster', display_name: 'Mullins 166', underlying: 'GOOGL', structure: 'debit_vertical', right: 'call', legs: 2,
    pnl_usd: '-3.00' });
  const old = ledgerCheckpoint({ positions: ledger({ rows: [stray, ...POSITIONS] }), trading: { as_of: PUBLISHED_AT, pnl_usd: '217.40' } });
  const model = climbModel(old);
  const dot = model.dots.get('off-roster');
  assert.deepEqual([dot.step, dot.money, dot.retired, dot.name], ['tuition', 'real', true, 'Mullins 166']);
  assert.equal(model.steps.tuition.now, 1, 'the Climb agrees with Positions');
  const routed = windowCheckpoint();
  const withStray = { ...routed, positions: { ...routed.positions, rows: [{ ...stray, agent: 'off-roster-2', id: 'real:31' }, ...routed.positions.rows] },
    rationale: { ...routed.rationale, trades: [...routed.rationale.trades, { id: 'real:31', route: 'probe', open_why: null, close_why: null, exit: null, max_loss_usd: null }] } };
  assert.equal(climbModel(withStray).dots.get('off-roster-2').step, 'probe', 'the trade’s own route names the step');
  assert.deepEqual([pitchFor(920, 300), pitchFor(1560, 465), pitchFor(4000, 300)], [14, 18, 14]);
  const wide = climbLayout(climbModel(windowCheckpoint()), 1560, 465);
  assert.ok(wide.steps.sized.x + wide.steps.sized.w >= 1560 - 16 - 1, 'the stairs reach the right edge');
  assert.equal(wide.pitch, 18);
});

// ---------------------------------------------------------------------------- the rationale
test('the page’s thesis filter keeps whole safe sentences, like the House’s', () => {
  assert.equal(thesisText(GOOGL_THESIS), GOOGL_THESIS, 'the pronoun "one" passes; both sentences fit');
  assert.ok(GOOGL_THESIS.length <= 280);
  assert.equal(thesisText(GOOGL_THESIS.slice(0, 240)), GOOGL_THESIS.split('. ')[0] + '.', 'the published mechanism is cut: its fragment never shows');
  for (const [label, text] of [['a digit', 'IWM breaks to a fresh 60-day low.'], ['a number word', 'Sell a twenty five delta wing.'],
    ['one with a unit', 'Wait one standard deviation.'], ['one beside a number word', 'Hold one hundred lots.'], ['a colon', 'The rule: buy it.'],
    ['brackets', 'Buy the (wide) wing.'], ['a code mark', 'When ctx.price breaks.'], ['a parameter-like name', 'Use lookback_days here.'], ['no end', 'A sentence with no end']]) {
    assert.equal(thesisText(text), null, label);
  }
  assert.equal(numbered("reprice one on the other's"), false);
  assert.equal(numbered('one day'), true);
  assert.equal(thesisText('Short. A sentence long enough to keep. Then 3 more.'), 'Short. A sentence long enough to keep.');
  const long = `${'A careful sentence about markets and their habits that runs on. '.repeat(5).trim()}`;
  assert.ok(thesisText(long).length <= 280);
  assert.ok(thesisText(`${'word '.repeat(80)}end.`).endsWith('…'), 'a single long sentence cuts at a word with an ellipsis');
});

test('every number hidden in words or other scripts is refused; only the pronoun "one" passes', () => {
  // A fixed adversarial list (the safety review of Oct 1, 2026): each must come out null, through the thesis and the tag rules.
  const leaks = [
    'Buy the call when GOOGL lags MSFT by more than one stdev.', 'Enter when the gap exceeds one ATR over the prior close.', 'Enter at one sd.',
    'Use a lookback of one hr.', 'Exit after one trading session closes.', 'Hold through one full standard deviation.', 'Hold for one more week.',
    'Exit at the eleventh session.', 'Sell a twelfth of the range.', 'Close by the ninetieth minute.', 'The move runs threefold.',
    'Sell the twentyfive delta wing.', 'Size it at tenpercent.', 'Wait a single sigma.', 'Collect a nickel.', 'Collect a dime of premium.',
    'Hold for a fortnight.', 'When one name leads, follow it.', 'Enter when the gap exceeds ½ of the prior move.', 'Use the Ⅻ month lookback.',
    'Wait ｏｎｅ sigma.', 'Wait οne sigma.', 'Wait sev\u00aden days.', 'Wait fo\u200bur days.', 'Enter when IV is ٣ points over realized.',
  ];
  for (const text of leaks) {
    assert.equal(thesisText(text), null, text);
    assert.equal(houseThesis(text), null, `House: ${text}`);
    assert.equal(plainTag(text.replace(/\.$/, '')), null, `tag: ${text}`);
  }
  for (const text of ["MSFT and GOOGL sell competing products, and investors reprice one on the other's capex with a delay.", 'Investors move one another.',
    'No one prices it in.', 'One of the legs decays faster.', 'The two names reprice one against the other.', 'Within seconds the spread widens.',
    'Once MSFT moves, GOOGL follows.']) {
    assert.equal(thesisText(text) === null, /two/.test(text), text);
  }
  assert.equal(numbered('the one day a week'), true, 'a pronoun before a unit is a number');
  // An older publisher cut decimals out of its news: a sentence that reads as cut never shows in the interim.
  assert.equal(cutNumber('Enter when the z-score exceeds standard deviations.'), true);
  assert.equal(cutNumber('IV above .'), true);
  assert.equal(cutNumber('GOOGL lags MSFT after strong cloud news.'), false);
  assert.equal(thesisText('Enter when the z-score exceeds standard deviations. Small caps lag the index.', 280, 12, { interim: true }), 'Small caps lag the index.');
  // Tags read their tickers in capitals; ordinary words stay as written.
  assert.equal(tickerCase('msft leads googl, qqq flat'), 'MSFT leads GOOGL, QQQ flat');
  assert.equal(tickerCase('xyz breaks on news', ['XYZ']), 'XYZ breaks on news');
  assert.equal(tickerCase('it is on', ['ON']), 'it is on', 'a ticker that is an ordinary word stays a word');
  assert.equal(plainTag('msft up 4 sessions, googl flat'), null);
  assert.equal(plainTag('a'.repeat(81)), null);
});

test('the rationale: the House’s block first, else the tape’s open trade and the roster’s mechanism; House rows are fixed lines', () => {
  const body = windowCheckpoint();
  const rows = new Map(body.positions.rows.map(row => [row.id, row]));
  const googl = rationaleFor(rows.get('real:8'), body);
  assert.deepEqual(googl, { house: false, interim: false, thesis: GOOGL_THESIS, route: 'tuition', openWhy: 'MSFT leads GOOGL, QQQ flat', closeWhy: null, exit: null, maxLoss: '157.00' });
  assert.deepEqual(rationaleFor(rows.get('real:5'), body), { house: false, interim: false, thesis: rationaleBlock().agents[1].thesis, route: 'probe',
    openWhy: 'the open broke higher on heavy volume', closeWhy: 'target reached before the lunch lull', exit: 'agent', maxLoss: '96.00' });
  assert.deepEqual(rationaleFor(rows.get('real:1'), body), { house: true, interim: false, thesis: HOUSE_RATIONALE.calibration, openWhy: null, closeWhy: null,
    exit: 'house', route: 'calibration', maxLoss: '5.00' });
  // An older House: the tape's open trade within five minutes of the opening minute, and the mechanism's whole sentences.
  const old = ledgerCheckpoint();
  const open = trade('orb-4', { underlying: 'SPY', structure: 'debit_vertical', legs: 2, quantity: 2, expiry: '2026-09-28', max_loss_usd: '96.00', why: 'The open broke higher on heavy volume.' }, '2026-09-28T14:11:30.000Z');
  const row6 = old.positions.rows.find(row => row.id === 'real:6');
  assert.deepEqual(interimRationale(row6, [open]), { openWhy: 'The open broke higher on heavy volume.', maxLoss: '96.00' });
  for (const [label, event] of [['too late', { ...open, at: '2026-09-28T14:16:00.000Z' }], ['too early', { ...open, at: '2026-09-28T14:09:59.000Z' }],
    ['another expiry', { ...open, payload: { ...open.payload, expiry: '2026-10-02' } }], ['another agent', { ...open, stream: 'agent:condor-vrp-3' }],
    ['a close', { ...open, payload: { ...open.payload, action: 'close', pnl_usd: '1.00' } }], ['the shadow book', { ...open, payload: { ...open.payload, real: false } }]]) {
    assert.deepEqual(interimRationale(row6, [event]), { openWhy: null, maxLoss: null }, label);
  }
  const interim = rationaleFor(row6, old, { trades: [open] });
  assert.equal(interim.interim, true);
  assert.equal(interim.route, 'probe', 'from the band');
  assert.equal(interim.thesis, 'Trades the break of the opening range in the direction of the break, with a vertical sized by its maximum loss.');
  assert.equal(interim.maxLoss, '96.00', 'the open structure’s risk');
  assert.equal(interim.closeWhy, null, 'a close’s own reason is never the entry tag');
  // Off the roster: the birth news's idea.
  const stray = position('real:30', { agent: 'off-roster', pnl_usd: '0.00' });
  assert.equal(rationaleFor(stray, old, { births: new Map([['off-roster', 'Small caps lag the index after a shock.']]) }).thesis, 'Small caps lag the index after a shock.');
  assert.equal(rationaleFor(stray, old).route, null, 'its band is unknown');
  // A House thesis of null means nothing survived the House's filter: no interim stands in, on the card, the roster or a row.
  assert.equal(rationaleFor(position('real:31', { agent: 'reversal-1' }), body).thesis, null);
  const nulled = windowCheckpoint({ agents: body.agents.map(row => (row.id === 'reversal-1' ? { ...row, mechanism: 'Buys when 7-14 DTE IV trades below realized.' } : row)) });
  assert.equal(agentThesis(nulled, 'reversal-1'), null);
  // An older House: the roster's mechanism under the page's rules, never raw.
  const raw = ledgerCheckpoint({ agents: old.agents.map(row => (row.id === 'orb-4' ? { ...row, mechanism: 'When 7-14 DTE IV trades below realized, buy it. Vol mean-reverts upward.' } : row)) });
  assert.equal(agentThesis(raw, 'orb-4'), 'Vol mean-reverts upward.');
  // The interim trigger is a tag under the thesis rules, its tickers in capitals.
  const numbered_ = trade('orb-4', { ...open.payload, why: 'spy up 4 sessions' }, '2026-09-28T14:11:30.000Z');
  assert.equal(interimRationale(row6, [numbered_]).openWhy, null);
  assert.equal(rationaleFor(row6, old, { trades: [{ ...open, payload: { ...open.payload, why: 'spy broke the open' } }] }).openWhy, 'SPY broke the open');
  assert.equal(riskShare('-12.56', '157.00'), -8);
  assert.equal(riskShare('31.00', '96.00'), 32.2);
  assert.equal(riskShare(null, '157.00'), null);
  assert.equal(riskShare('1.00', '0.00'), null);
});

// ---------------------------------------------------------------------------- performance over time
test('Realized steps exactly at each close from the ledger; the archive’s lines break on unknowns and gaps', () => {
  const realized = realizedSteps(ledgerCheckpoint());
  assert.equal(realized.start, Date.parse(RESET_AT));
  assert.deepEqual(realized.steps.map(step => [new Date(step.at).toISOString().slice(11, 16), step.id, Number(step.cents)]),
    [['13:58', 'real:3', 20540], ['14:10', 'real:1', 20320], ['14:20', 'real:4', 18490], ['14:30', 'real:5', 21590]]);
  assert.equal(realized.complete, true);
  assert.equal(realizedAt(realized, Date.parse('2026-09-28T14:15:00.000Z')), 20320n);
  assert.equal(realizedAt(realized, Date.parse('2026-09-20T00:00:00.000Z')), null, 'nothing before the start');
  const folded = realizedSteps(ledgerCheckpoint({ positions: ledger({ rows: POSITIONS.slice(0, 4), earlier: { positions: 2, pnl_usd: '203.20' } }) }));
  assert.equal(folded.start, Date.parse('2026-09-28T14:20:00.000Z'), 'starts at the oldest listed close');
  assert.equal(folded.startCents, 20320n);
  assert.deepEqual(folded.steps.map(step => Number(step.cents)), [18490, 21590]);
  const unknown = realizedSteps(ledgerCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: null }, positions: ledger({ rows: POSITIONS.map(row => (row.id === 'real:1' ? { ...row, pnl_usd: null } : row)) }) }));
  assert.deepEqual(unknown.steps.map(step => step.id), ['real:3'], 'stops at an unknown result');
  assert.equal(unknown.complete, false);
  assert.equal(realizedSteps(swarmCheckpoint()), null);
  const points = [['14:00', '1.00'], ['14:05', '2.00'], ['14:10', null], ['14:15', '3.00'], ['14:20', '4.00'], ['14:40', '5.00']]
    .map(([time, value]) => ({ at: `2026-09-28T${time}:00.000Z`, profit_usd: value, costs_usd: '1.00', net_usd: null }));
  assert.deepEqual(scoreSeries(points, 'profit_usd').map(segment => segment.map(point => Number(point.cents))), [[100, 200], [300, 400], [500]]);
  assert.deepEqual(scoreSeries(points, 'costs_usd').map(segment => segment.length), [5, 1], 'a gap over fifteen minutes breaks the line');
  assert.deepEqual(scoreSeries(points, 'net_usd'), []);
  const model = scoreModel(ledgerCheckpoint({ compute: BILL }), null, at);
  assert.deepEqual([model.profit, model.costs, model.costsNow?.cents], [[], [], 32879n], 'no archive: the current costs as one point');
  // Points from before the Profit basis never show; a sampled archive breaks its lines only on a gap three samples wide.
  const archive = { step_ms: 1800000, points: [['2026-09-26T05:00', '9.00'], ['2026-09-28T13:00', '1.00'], ['2026-09-28T13:30', '2.00'], ['2026-09-28T14:00', '3.00'],
    ['2026-09-28T16:00', '4.00']].map(([time, value]) => ({ at: `${time}:00.000Z`, profit_usd: value, costs_usd: value, net_usd: null })) };
  const sampledModel = scoreModel(ledgerCheckpoint({ compute: BILL }), archive, at);
  assert.deepEqual(sampledModel.profit.map(segment => segment.map(point => Number(point.cents))), [[100, 200, 300], [400]]);
  assert.equal(sampledModel.points.length, 4, 'the point before the reset is gone');
  assert.deepEqual(lastKnown({ last_profit: { at: '2026-09-26T05:00:00.000Z', profit_usd: '9.00' }, last_net: null }, at, RESET_AT), { profit: null, net: null },
    'never from before the basis');
  assert.deepEqual(lastKnown({ last_profit: { at: '2026-09-25T14:00:00.000Z', profit_usd: '-27.05' }, last_net: { at: '2026-09-28T14:00:00.000Z', net_usd: '-582.57' } }, at),
    { profit: { at: '2026-09-25T14:00:00.000Z', usd: '-27.05' }, net: { at: '2026-09-28T14:00:00.000Z', usd: '-582.57' } });
  assert.deepEqual(lastKnown({ last_profit: { at: '2026-09-20T14:00:00.000Z', profit_usd: '-27.05' }, last_net: null }, at), { profit: null, net: null }, 'older than four days');
  assert.deepEqual(lastKnown(null, at), { profit: null, net: null });
});

test('market-closed bands are the hours outside 9:30 to 4:00 New York time on weekdays; ticks are clean', () => {
  const bands = marketClosedBands(Date.parse('2026-09-26T06:25:30.000Z'), Date.parse('2026-09-30T23:00:00.000Z'))
    .map(([from, to]) => [new Date(from).toISOString(), new Date(to).toISOString()]);
  assert.deepEqual(bands, [
    ['2026-09-26T06:25:30.000Z', '2026-09-28T13:30:00.000Z'], ['2026-09-28T20:00:00.000Z', '2026-09-29T13:30:00.000Z'],
    ['2026-09-29T20:00:00.000Z', '2026-09-30T13:30:00.000Z'], ['2026-09-30T20:00:00.000Z', '2026-09-30T23:00:00.000Z']]);
  assert.equal(new Date(nyInstant(2026, 11, 2, 9, 30)).toISOString(), '2026-11-02T14:30:00.000Z', 'after the clocks change');
  assert.equal(new Date(nyInstant(2026, 10, 7, 16, 0)).toISOString(), '2026-10-07T20:00:00.000Z');
  assert.deepEqual(marketClosedBands(5, 1), []);
  assert.deepEqual(niceTicks(-25.8, 555.81), [0, 200, 400]);
  assert.deepEqual(niceTicks(-30, 0), [-20, 0]);
  assert.deepEqual(niceTicks(1400, 1560), [1400, 1500]);
  assert.ok(niceTicks(0, 0).length >= 2);
});

// ---------------------------------------------------------------------------- the tape and the thought
test('the tape names each line by its verb: a thought, a trade, a birth as its idea, a move, a retirement as its cause', () => {
  assert.deepEqual(newsKind('is born, a new family: Small caps lag the index.', 'x'), { kind: 'born', brief: 'Small caps lag the index.', idea: 'Small caps lag the index.', head: 'is born, a new family' });
  assert.deepEqual(newsKind('is born, forked from its parent: Holds longer.', 'x').brief, 'Holds longer.');
  assert.deepEqual(newsKind('is born, a new family.', 'x'), { kind: 'born', brief: 'is born, a new family.', idea: null, head: 'is born, a new family' });
  // A birth's idea is a thesis: an entry rule with its numbers never shows, on the line or opened.
  const rule = feedLine(news('is born, a new family: Buys when 3-7 DTE IV trades below realized.', PUBLISHED_AT, 'orb-4'));
  assert.deepEqual([rule.brief, rule.text], ['is born, a new family.', 'is born, a new family.']);
  const mixed = feedLine(news('is born, a new family: Buys when 3-7 DTE IV trades below realized. Vol mean-reverts upward.', PUBLISHED_AT, 'orb-4'));
  assert.deepEqual([mixed.brief, mixed.text], ['Vol mean-reverts upward.', 'is born, a new family: Vol mean-reverts upward.']);
  // A trade's tag on the tape follows the tag rules too.
  assert.equal(feedLine(trade('orb-4', { why: 'spy up 4 sessions' })).brief, 'opened 1 XSP iron condor · Sep 28 · max loss $184');
  assert.deepEqual(newsKind('retired: never beat the fill cost.', 'x'), { kind: 'retired', brief: 'never beat the fill cost.' });
  assert.deepEqual(newsKind('moves from Probe to Sized: its forward record held.', 'x'), { kind: 'moved', brief: 'Probe → Sized · its forward record held', from: 'Probe', to: 'Sized' });
  assert.deepEqual(newsKind('approved for real money by the auditor. Clean.', 'x'), { kind: 'approved', brief: 'Clean.' });
  assert.deepEqual(newsKind('refused for real money by the auditor.', 'x'), { kind: 'refused', brief: 'refused for real money by the auditor.' });
  assert.deepEqual(newsKind('New code on main.', null), { kind: 'house', brief: 'New code on main.' });
  const line = feedLine(trade('orb-4', { why: 'The open broke higher.' }));
  assert.deepEqual([line.tape, line.group, line.brief], ['trade', 'trades', 'opened 1 XSP iron condor · Sep 28 · max loss $184 · The open broke higher.']);
  assert.deepEqual([feedLine(note('orb-4', 'Thinking.')).group, feedLine(news('retired: x.', PUBLISHED_AT, 'orb-4')).group], ['thoughts', 'life']);
  assert.equal(holdMs('one two three'), 6000, 'at least six seconds');
  assert.equal(holdMs('word '.repeat(35)), 10000, 'three and a half words a second');
  assert.equal(holdMs('word '.repeat(200)), 20000, 'at most twenty');
});

// ---------------------------------------------------------------------------- the page, mounted on a new House
test('mounted on a new House: the retired agent on Tuition, each position’s reason, the last known Profit and the tape’s filters', async () => {
  const { withBrowser, stubPage, FLOOR_IDS, words } = await import('./harness.mjs');
  const { startCapital } = await import('../capital/capital.js');
  let now = at + 30000;
  const { capital } = floor();
  capital.now = () => now;
  // An earlier priced checkpoint for the archive, then the current one with Profit unknown.
  const priced = windowCheckpoint({ published_at: '2026-09-28T14:40:00.000Z', trading: { as_of: '2026-09-28T14:40:00.000Z', pnl_usd: '213.40' },
    compute: { ...BILL, as_of: '2026-09-28T14:40:00.000Z' }, positions: ledger({ as_of: '2026-09-28T14:40:00.000Z', rows: WINDOW_POSITIONS, other: { ...ledger().other, as_of: '2026-09-28T14:40:00.000Z' } }),
    account: { ...swarmCheckpoint().account, as_of: '2026-09-28T14:40:00.000Z' }, gym: { ...swarmCheckpoint().gym, as_of: '2026-09-28T14:40:00.000Z' },
    performance: { ...swarmCheckpoint().performance, verified_at: '2026-09-28T14:40:00.000Z' }, structures: [],
    levels: levelsBlock({ as_of: '2026-09-28T14:40:00.000Z' }), rationale: rationaleBlock({ as_of: '2026-09-28T14:40:00.000Z' }) });
  priced.agents = priced.agents.map(row => ({ ...row, retired_at: row.retired_at && row.retired_at > priced.published_at ? '2026-09-28T14:35:00.000Z' : row.retired_at }));
  assert.equal(validCheckpoint(priced), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', priced)).status, 200);
  const unpriced = windowCheckpoint({ trading: { as_of: PUBLISHED_AT, pnl_usd: null }, compute: BILL,
    positions: ledger({ rows: WINDOW_POSITIONS.map(row => (row.id === 'real:8' ? { ...row, pnl_usd: null } : row)), other: null, unreconciled_usd: null }) });
  assert.equal((await post(capital, '/api/capital/checkpoint', unpriced)).status, 200);
  const events = [trade('googl-lags', { underlying: 'GOOGL', structure: 'debit_vertical', legs: 2, expiry: '2026-10-07', max_loss_usd: '157.00', why: 'msft leads googl, qqq flat' }, '2026-09-28T14:31:40.000Z'),
    note('googl-lags', 'GOOGL has not followed MSFT yet; the vertical stays on.', '2026-09-28T14:45:00.000Z'),
    news('retired: the family left the Gym after review.', '2026-09-28T14:46:00.000Z', 'reversal-1')];
  assert.equal((await post(capital, '/api/capital/events', batch(...events))).status, 200);
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => capital.fetch(new Request('https://blakewoods.us' + path)), async () => {
    Date.now = () => now;
    const feed = await startCapital(root);
    feed.stop();
    // Profit is unknown now: a dash, and under it the last value the House could price, dated.
    const numbers = root.querySelector('#floor-numbers');
    assert.equal(numbers.withClass('number-value')[0].textContent, '—');
    const last = numbers.withClass('number-last');
    assert.deepEqual(last.map(node => node.textContent), ['+$213.40 · 10:40 AM', '−$127.89 · 10:40 AM'], 'Net: Profit without open gains, less the bill');
    assert.equal(last[0].getAttribute('title'), 'Last value the House could price.');
    // The Climb: the House's counts, the look pips, and the retired agent standing on Tuition with its real money.
    const board = root.querySelector('#floor-agents');
    const tuition = board.withClass('dot').filter(node => node.dataset.step === 'tuition');
    assert.deepEqual(tuition.map(node => [node.dataset.agent, node.getAttribute('aria-label')]), [['googl-lags', 'Meriwether 2, Tuition, retired, real money open']]);
    assert.match(tuition[0].className, /money-real.*is-retired/);
    const pips = board.withClass('pips')[0];
    assert.deepEqual(pips.children.map(node => node.className), ['pip is-pass', 'pip is-pass', 'pip is-pass', 'pip is-fail']);
    assert.match(words(board.withClass('step-label').find(node => node.dataset.step === 'train')), /^Train ever 49$/);
    // The thought on the card is the agent's, with its level.
    assert.equal(root.querySelector('#floor-now').withClass('chip-level')[0].textContent, 'Tuition');
    // Its position: the House's thesis, the trigger, Tuition, the life bar, and its risk with no result yet.
    const positions = root.querySelector('#floor-positions');
    const item = positions.withClass('pos-item').find(node => node.dataset.position === 'real:8');
    assert.equal(words(item.children[0]), 'Meriwether 2 GOOGL call debit vertical open 27m —');
    // The newest open agent position stands open: its reason is the first thing the panel says.
    assert.equal(item.children[0].getAttribute('aria-expanded'), 'true');
    const card = item.withClass('rationale')[0];
    assert.equal(card.withClass('rationale-thesis')[0].textContent, GOOGL_THESIS, 'the whole thesis, its conclusion too');
    assert.equal(words(card.withClass('rationale-why')[0]), 'MSFT leads GOOGL, QQQ flat Tuition');
    assert.match(words(card), /Sep 28 Oct 7 risk \$157 — → thoughts → agent$/);
    assert.equal(card.withClass('life-now').length, 1, 'open: a now tick on its life');
    // A closed one says who closed it.
    positions.withClass('pos-item').find(node => node.dataset.position === 'real:5').children[0].click();
    const closed = positions.withClass('pos-item').find(node => node.dataset.position === 'real:5').withClass('rationale')[0];
    assert.equal(words(closed.withClass('rationale-why')[0]), 'the open broke higher on heavy volume ↩ target reached before the lunch lull · agent Probe');
    assert.match(words(closed), /\+32% of risk/);
    assert.equal(words(positions.withClass('pos-foot')[0]), 'other — · Profit —', 'while Profit is unknown, so is the sum');
    // The tape's filters: Life alone.
    const filters = root.querySelector('#floor-filters').withClass('filter');
    filters[0].click();
    filters[1].click();
    const kinds = root.querySelector('#floor-feed').withClass('tape-line').map(node => node.dataset.kind);
    assert.deepEqual(kinds, ['retired']);
    assert.match(words(root.querySelector('#floor-feed')), /^Leahy the family left the Gym after review\. \d+m$/);
  });
});
