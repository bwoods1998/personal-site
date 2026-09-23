import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Capital, MAX_EVENTS_KEPT, MAX_HISTORY_POINTS, allowedOrigin } from '../lib/capital.mjs';
import { retiredRoute, RETIRED_TARGET } from '../lib/retired.mjs';
import { createServer } from '../server.mjs';
import {
  validEvent, validEventBatch, validCheckpoint, validDesk, validInfra, validStream, validKindPayload,
  validVenues, validVenueBalance, validBudget, socketMatches, parseStreamTags, sourceUrl, deskMode, isLive,
  validPosition, validMutation, validLiveSession, validExperiment, validCurveRow, validLab, validWatch, validCalibration, validRun,
  EVENT_KINDS, KIND_STREAMS, MAX_BATCH_BYTES, TAPES,
} from '../capital/schema.js';
import {
  orderDesks, partnerOf, partnerName, truncate, money, percent, signedMoney, streamUrl, startCapital, PARTNERS, PARTNER_ORDER,
  accountEquity, accountVenues, venueLabel, instrumentLabel, ago, roman, raceName, triggerText, flatLine,
  marketTitle, seriesTitle, quantityText, centsText, heldText, thesisParts, selfImprovingParts, mastheadNumbers,
  RESEARCH, FEED_KINDS, floorName, plainThought, feedLine, feedLines, heroThought, balanceSeries, performanceSeries, portfolioPerformance, PERFORMANCE_START_AT, openPositionRows,
  closedRecord, ladderMove, boardSnapshot, LEVELS, NEXT_LEVEL, levelOf, levelProgress, coinSize, reasonWords, moveWords, nextIndex,
  agentWords, progressWords, houseWords, settleStakes, replayable,
} from '../capital/capital.js';
import { NOW, floor, request, post, get, words, FLOOR_IDS, stubPage, withBrowser } from './harness.mjs';

function event(n = 1, overrides = {}) {
  return {
    id: `desk.rosenfeld.thought.${n}`,
    stream: 'desk:rosenfeld',
    kind: 'desk.thought',
    at: `2026-09-15T14:${String(n % 60).padStart(2, '0')}:00.000Z`,
    payload: { session_id: 'sess-2026-09-15', text: 'Margins widened for a third quarter. Waiting for the filing to confirm.' },
    digest: n.toString(16).padStart(64, '0'),
    ...overrides,
  };
}
const batch = (...events) => ({ schema_version: 1, events });
const ladderEvent = (message, overrides = {}) => published(300, { stream: 'lab', kind: 'lab.progress',
  payload: { component: 'league', stage: 'test', message }, ...overrides });
function desk(id = 'rosenfeld', overrides = {}) {
  return {
    id, name: 'Rosenfeld', family: 'rosenfeld', generation: 1, parent_id: null, mode: 'paper',
    venues: ['alpaca'], capital_usd: '50000', equity: '50250.25', cash: '10000', daily_pnl: '-125.50',
    return_pct: '0.5', max_drawdown_pct: '1.25', days_live: 12, orders: 34, cost_usd: '4.21',
    status: 'active', gate: { name: 'Sixty forward days', passed: false, evidence: { days: 12, sharpe: '0.8' } },
    updated_at: '2026-09-15T14:00:00.000Z', ...overrides,
  };
}
function checkpoint(overrides = {}) {
  return {
    schema_version: 1, published_at: '2026-09-15T14:05:00.000Z',
    floor: { equity: '100500', cash: '40000', daily_pnl: '-250.25', capital_usd: '100000', since_inception_pct: '0.5', benchmark: { name: 'S&P 500 Total Return', return_pct: '0.31' } },
    desks: [desk()],
    committee: { last_memo_at: '2026-09-14T21:00:00.000Z', allocations: { rosenfeld: '50000' } },
    budget: { spent_today_usd: '4.21', cap_usd: '25' },
    ...overrides,
  };
}

test('the ladder parses only real league lifecycle templates, never strategy claims or a successful trial', () => {
  assert.deepEqual([ladderMove(ladderEvent('haghani climbs from rung 1 to rung 2: audited evidence.')).kind,
    ladderMove(ladderEvent('haghani drops from rung 3 to rung 2: drift.')).kind,
    ladderMove(ladderEvent('haghani-2 is born (a child of haghani, generation 2, niche alpaca/day/revert). mutation.')).kind,
    ladderMove(ladderEvent('haghani-2 died of displaced. Newcomer earns the seat.')).kind], ['up', 'down', 'born', 'out']);
  for (const message of ['haghani passed replay: 24 trades.', 'The auditor approved haghani for real money.',
    'haghani climbs from rung 2 to rung 1: malformed.', 'haghani drops from rung 2 to rung 3: malformed.',
    'haghani climbs from rung 2 to rung 9: invalid.', 'I think haghani climbs from rung 1 to rung 2: rumor.',
    'haghani climbs from Bunt to Practice: malformed.', 'haghani drops from Bunt to Swing: malformed.', 'haghani climbs from Bunt to Bunt: nothing.',
    'haghani climbs from Paper to Bunt: the House word is never the page word.', "haghani's real stake is now $ten (Bunt): words."]) {
    assert.equal(ladderMove(ladderEvent(message)), null, message);
  }
  const change = ladderEvent('haghani climbs from rung 1 to rung 2: evidence.');
  assert.equal(ladderMove({ ...change, kind: 'desk.thought' }), null);
  assert.equal(ladderMove({ ...change, payload: { ...change.payload, component: 'agent' } }), null);
  // The allocator's band moves (Sept 23, 2026): the bands by name, the real stake when there is one.
  const pick = move => [move.kind, move.fromBand, move.toBand, move.stake, move.reason];
  assert.deepEqual(pick(ladderMove(ladderEvent('mullins-7 climbs from Practice to Bunt with a $10.00 real stake: E 1.041 after 6 trades.'))),
    ['up', 'paper', 'bunt', '10.00', 'E 1.041 after 6 trades.']);
  assert.deepEqual(pick(ladderMove(ladderEvent('mullins-7 climbs from Swing to Star with a $1,240.50 real stake: the top real P&L.'))),
    ['up', 'swing', 'star', '1240.50', 'the top real P&L.']);
  assert.deepEqual(pick(ladderMove(ladderEvent('mullins-7 drops from Swing to Practice: it lost 35% of its real stake.'))),
    ['down', 'swing', 'paper', null, 'it lost 35% of its real stake.']);
  assert.deepEqual(pick(ladderMove(ladderEvent("mullins-7's real stake is now $14.20 (Bunt): E 1.42."))), ['size', null, 'bunt', '14.20', 'E 1.42.']);
  assert.deepEqual(pick(ladderMove(ladderEvent('haghani climbs from rung 1 to rung 2: evidence.'))), ['up', 'paper', 'bunt', null, 'evidence.']);
});

const gateOf = (rung, extra = {}) => ({ name: `rung ${rung}`, passed: rung >= 2, evidence: { rung, ...extra } });
const evidenceOf = (W_paper, overrides = {}) => ({ W_paper, W_real: '1.000000', E: String(Math.sqrt(Number(W_paper)).toFixed(6)), trades: 6, real_trades: 0, ...overrides });

test('the ladder keeps every living agent on its level, by the allocator or by its rung, and never treats tape lag as a move', () => {
  const now = Date.parse('2026-09-15T15:00:00.000Z');
  const change = ladderEvent('haghani climbs from rung 1 to rung 2: evidence.', { at: '2026-09-15T14:59:00.000Z' });
  const board = checkpoint({ published_at: '2026-09-15T14:58:00.000Z', desks: [
    desk('haghani', { gate: gateOf(1), pnl_usd: '50.00' }), desk('winner', { gate: gateOf(3), mode: 'live', pnl_usd: '4', capital_usd: '60' }),
    desk('newcomer', { gate: gateOf(0), pnl_usd: '100' }), desk('old-agent', { gate: gateOf(2), status: 'retired' }),
    desk('legacy', { mode: 'live', gate: null }), desk('broken', { gate: gateOf('2') }),
    desk('star-agent', { gate: gateOf(3), band: 'star', mode: 'live', stake_usd: '120.00', pnl_usd: '31.20', evidence: evidenceOf('1.300000', { W_real: '1.410000', E: '1.607700', real_trades: 14 }) }),
    desk('bunter', { gate: gateOf(2), band: 'bunt', mode: 'live', stake_usd: '10.00', pnl_usd: '-0.40', evidence: evidenceOf('1.100000') }),
    desk('grower', { gate: gateOf(1), band: 'paper', pnl_usd: '-1', evidence: evidenceOf('1.100000') }),
  ] });
  assert.equal(validCheckpoint(board), true);
  const before = boardSnapshot(board, [change, change], now);
  // Three levels, the top first: the star leads Level 3, and the new agent still on history is last on Level 1.
  assert.deepEqual(before.levels.map(row => [row.level, row.word, row.agents.map(agent => agent.id)]), [
    [3, 'Increased capital', ['star-agent', 'winner']], [2, 'Live trading', ['bunter']], [1, 'Practice', ['grower', 'haghani', 'newcomer']],
  ]);
  assert.equal(before.living, 8);
  assert.equal(before.real, 3);
  assert.equal(before.retired.length, 1);
  assert.deepEqual(before.unknown.map(agent => agent.id), ['legacy', 'broken']);
  assert.equal(before.moves.filter(move => move.kind === 'up').length, 1, 'socket replay is deduplicated');
  const level = number => before.levels.find(row => row.level === number);
  const practice = id => level(1).agents.find(agent => agent.id === id);
  assert.equal(practice('haghani').recent, null, 'the event arrived before the roster changed');
  assert.equal(practice('newcomer').pnl, null, 'history-test P&L is not a forward result');
  // Coins: a real stake by its dollars, on one absolute scale; the rest are dots.
  assert.deepEqual([...level(3).agents, ...level(2).agents].map(agent => [agent.id, coinSize(agent.stake)]), [['star-agent', 56], ['winner', 46], ['bunter', 19]]);
  assert.equal(level(3).agents[1].stake, 60, 'before the allocator, a real desk\'s capital stands in for its stake');
  assert.equal(level(3).capital, 180);
  assert.equal(level(1).capital, null, 'practice holds no real capital');
  assert.equal(practice('grower').tone, 'positive', 'practice agents read by their growth, not their P&L');
  assert.equal(level(2).agents[0].tone, 'negative', 'real money reads by its P&L');
  assert.equal(level(2).capital, 10);
  // Without the allocator's board, the page cannot say how near the next level anyone is.
  assert.ok(before.agents.every(agent => agent.progress === null));
  assert.equal(before.closest, null);
  board.desks[0].gate = gateOf(2);
  const after = boardSnapshot(board, [change], now);
  assert.equal(after.levels[1].agents.find(agent => agent.id === 'haghani').recent.kind, 'up');
  assert.equal(after.stale, false);
  assert.equal(boardSnapshot(board, [change], now + 7200000).levels[1].agents.find(agent => agent.id === 'haghani').recent, null, 'old moves do not pulse forever');
  assert.equal(boardSnapshot(board, [], now + 7200000).stale, true);
  assert.deepEqual(boardSnapshot(null).levels.map(row => row.agents.length), [0, 0, 0]);
  assert.deepEqual(LEVELS.map(row => [row.level, row.word, row.bands, row.real]), [
    [3, 'Increased capital', ['star', 'swing'], true], [2, 'Live trading', ['bunt'], true], [1, 'Practice', ['paper', 'replay'], false],
  ]);
  assert.deepEqual(['replay', 'paper', 'bunt', 'swing', 'star', 'dead', null].map(levelOf), [1, 1, 2, 3, 3, null, null]);
  assert.deepEqual([10, 25, 56.11, 27.48, 11.52, 87, 1000, 1, 0, null, NaN].map(coinSize), [19, 30, 45, 31, 20, 56, 56, 18, 18, 18, 18]);
});

test('progress toward the next level follows the allocator\'s main rule, and only while its board is on', () => {
  // The constant the arcs read, pinned: league/constitution.py is the source.
  assert.deepEqual(NEXT_LEVEL, {
    paper: { level: 2, evidence: 1.01, trades: 5, count: 'trades' },
    bunt: { level: 3, evidence: 1.5, trades: 8, count: 'real_trades', belowEven: 0.95 },
  });
  const agent = (band, evidence, extra = {}) => ({ band, evidence: { W_paper: '1.000000', W_real: '1.000000', trades: 0, real_trades: 0, ...evidence }, retired: false, accountingIssue: false, ...extra });
  const progress = (band, evidence, extra, enabled = true) => levelProgress(agent(band, evidence, extra), enabled);
  assert.equal(progress('paper', { E: '1.006000', trades: 4 }), 0.6, 'the weaker of evidence and trades');
  assert.equal(progress('paper', { E: '1.010000', trades: 7 }), 1, 'both met: ready');
  assert.equal(progress('paper', { E: '1.030000', trades: 2 }), 0.4);
  assert.equal(progress('paper', { E: '0.990000', trades: 9 }), 0, 'evidence below even is no progress');
  assert.equal(progress('bunt', { E: '1.114366', W_real: '1.095627', real_trades: 4 }), 0.2287);
  assert.equal(progress('bunt', { E: '1.900000', W_real: '0.990000', real_trades: 9 }), 0.95, 'real results below even never read as ready');
  assert.equal(progress('bunt', { E: '1.600000', W_real: '1.010000', real_trades: 8 }), 1);
  for (const [band, extra, enabled, why] of [['paper', {}, false, 'the board is off'], ['paper', {}, null, 'no board at all'],
    ['swing', {}, true, 'Level 3 has no next level'], ['replay', {}, true, 'not trading yet'], ['paper', { retired: true }, true, 'retired'],
    ['paper', { accountingIssue: true }, true, 'accounting under review']]) {
    assert.equal(progress(band, { E: '1.010000', trades: 7 }, extra, enabled), null, why);
  }
  assert.equal(levelProgress({ band: 'paper', evidence: null }, true), null, 'no evidence');
  const words = progressWords({ band: 'paper', progress: 0.6, evidence: { E: '1.006000', trades: 4 } });
  assert.equal(words, '60% to Level 2 · evidence 1.006 of 1.01 · 4 of 5 trades');
  assert.equal(progressWords({ band: 'paper', progress: 1, evidence: { E: '1.012000', trades: 6 } }), 'Ready for Level 2 · evidence 1.012 of 1.01 · 6 trades');
  assert.equal(progressWords({ band: 'bunt', progress: 0.2287, evidence: { E: '1.114366', W_real: '0.980000', real_trades: 4 } }),
    '22% to Level 3 · evidence 1.114 of 1.5 · 4 of 8 real trades · real results below even');
  assert.equal(progressWords({ band: 'paper', progress: null, evidence: null }), '');
});

test('moves and reasons read as levels, rebuilt from fixed phrasings, never the House\'s own text', () => {
  const move = (kind, fromBand, toBand, extra = {}) => ({ id: 'm', agent: 'huang-h427345', at: '2026-09-15T14:30:00.000Z', kind, fromBand, toBand, stake: null, reason: '', ...extra });
  assert.equal(moveWords(move('up', 'paper', 'bunt', { stake: '10.00' })), 'Huang · Level 1 → 2 · $10');
  assert.equal(moveWords(move('up', null, 'bunt')), 'Huang · → Level 2');
  assert.equal(moveWords({ ...move('down', 'bunt', 'paper'), agent: 'hawkins-19' }), 'Hawkins XIX · Level 2 → 1');
  assert.equal(moveWords({ ...move('born', null, null), agent: 'haghani-56' }), 'Haghani LVI · born');
  assert.equal(moveWords(move('out', null, null)), 'Huang · retired');
  assert.equal(moveWords({ ...move('size', 'bunt', 'bunt', { stake: '56.11' }), agent: 'mullins-2' }), 'Mullins II · stake $56');
  assert.equal(moveWords(move('up', 'swing', 'star')), 'Huang · joined the top 3');
  for (const [reason, words] of [
    ['bunt: E 1.0162 is at or above 1.01 on 7 closed trades', 'evidence 1.016 on 7 trades'],
    ['it cleared the screen: 3 active hour blocks, 3 closed trades, growth above zero; the frontier audit follows on the micro rung', 'passed the practice screen'],
    ['the frontier Audit vetoed it: thin evidence', 'the audit vetoed it'],
    ['E 0.8510 fell below the floor', 'evidence fell to 0.851'],
    ['it lost 35% of its real stake.', 'lost 35% of its real stake'],
    ['passed deep replay and the sealed holdout', 'passed its history test'],
    ['displaced', ''], ['bunt stake follows the evidence', ''],
  ]) assert.equal(reasonWords(move('up', 'paper', 'bunt', { reason })), words, reason);
  assert.equal(reasonWords({ ...move('born', null, null), parent: 'haghani-40' }), 'child of Haghani XL');
  assert.equal(reasonWords({ ...move('born', null, null), founder: true }), 'founding agent');
  // The tape's own births name the parent or say the agent founds its line.
  const child = ladderMove(ladderEvent('huang-l23cdb7 is born (a child of huang-h6d3302, generation 2, niche kalshi/hour/prior-window-fade-loose-). an Alpha Lab graduate.'));
  assert.deepEqual([child.kind, child.parent, reasonWords(child)], ['born', 'huang-h6d3302', 'child of Huang']);
  const seed = ladderMove(ladderEvent('haghani-56 is born (a founding seed, generation 1, niche alpaca/hour/maker-reversion). Merton, as architect.'));
  assert.equal(reasonWords(seed), 'founding agent');
  // Numerals past thirty-nine: a desk's fifty-sixth agent is LVI, not XXXXXVI.
  assert.deepEqual([40, 49, 56, 90, 100, 399, 1994].map(roman), ['XL', 'XLIX', 'LVI', 'XC', 'C', 'CCCXCIX', 'MCMXCIV']);
});

test('the League\'s lines in the live feed speak in levels, and the House\'s band words never reach the page', () => {
  const line = message => feedLine(ladderEvent(message)).text;
  assert.equal(line('huang-h427345 climbs from Practice to Bunt with a $10.00 real stake: bunt: E 1.0162 is at or above 1.01 on 7 closed trades.'),
    'Huang climbs to Level 2 with $10 real: evidence 1.016 on 7 trades');
  assert.equal(line('mullins-7 drops from Swing to Practice: it lost 35% of its real stake.'), 'Mullins VII drops to Level 1: lost 35% of its real stake');
  assert.equal(line("mullins-2's real stake is now $14.20 (Bunt): bunt stake follows the evidence (E 1.42)."), "Mullins II's real stake is now $14");
  assert.equal(line('haghani-55 climbs from rung 0 to rung 1: passed deep replay and the sealed holdout.'), 'Haghani LV starts practice: passed its history test');
  assert.equal(line('haghani-37 climbs from rung 1 to rung 2: it cleared the screen: 3 active hour blocks.'), 'Haghani XXXVII climbs to Level 2: passed the practice screen');
  assert.equal(line('mullins-7 climbs from Swing to Star with a $1,240.50 real stake: the top real P&L.'), 'Mullins VII joins the top 3');
  assert.equal(line('meriwether-35 died of displaced. meriwether-35 (family sports-favorites) died on rung 1 of displaced.'), 'Meriwether XXXV retired');
  assert.equal(line('haghani-56 is born (a founding seed, generation 1, niche alpaca/hour/maker-reversion). Merton, as architect.'), 'Haghani LVI is born: founding agent');
  // Any other league line keeps its words, with the band words swapped for the page's.
  assert.equal(line('The evidence ended huang-h51fdd3: down 19.1% on paper after 6 active blocks; paper keeps no agent down 10%'),
    'The evidence ended huang-h51fdd3: down 19.1% on practice after 6 active blocks; practice keeps no agent down 10%');
  assert.equal(line('haghani-40 passed replay: trial 3 for the maker family, 24 trades, deflated Sharpe 1.2'), 'haghani-40 passed its history test: trial 3 for the maker family, 24 trades, deflated Sharpe 1.2');
  assert.equal(houseWords('Replay, then Bunt and Swing, a Star; E 1.0100 on the micro rung, starting at rung 0.'),
    'History test, then Level 2 and Level 3, a top 3; evidence 1.0100 on the micro level, starting at the history test.');
  assert.equal(houseWords('down 19.1% on paper. Paper keeps no agent on rung 2 down 10%'), 'down 19.1% on practice. Practice keeps no agent on Level 2 down 10%');
  assert.equal(line('Replayed 3 variants of crypto-reversion'), 'Replayed 3 variants of crypto-reversion', 'ordinary English is untouched');
});

test('arrow keys walk a floor a dot or a row at a time and leave it at its edges', () => {
  // A floor of 30 dots, 14 to a row: rows 0–13, 14–27, 28–29.
  assert.deepEqual(['ArrowLeft', 'ArrowRight', 'Home', 'End'].map(key => nextIndex(key, 15, 30, 14)), [14, 16, 0, 29]);
  assert.deepEqual([nextIndex('ArrowLeft', 0, 30, 14), nextIndex('ArrowRight', 29, 30, 14)], [0, 29], 'the ends hold');
  assert.equal(nextIndex('ArrowUp', 15, 30, 14), 1);
  assert.equal(nextIndex('ArrowUp', 3, 30, 14), -1, 'the top row leaves for the floor above');
  assert.equal(nextIndex('ArrowDown', 3, 30, 14), 17);
  assert.equal(nextIndex('ArrowDown', 20, 30, 14), 29, 'a short last row is still a row');
  assert.equal(nextIndex('ArrowDown', 29, 30, 14), 30, 'the last row leaves for the floor below');
  assert.deepEqual([nextIndex('ArrowUp', 0, 5, 1), nextIndex('ArrowDown', 4, 5, 1), nextIndex('ArrowDown', 2, 5)], [-1, 5, 3], 'without layout a row is one dot');
  assert.equal(nextIndex('Tab', 4, 5, 1), 4);
});

test('the board reads the allocator\'s own summary, trail and throttle, and tells one move once', () => {
  const now = Date.parse('2026-09-15T15:00:00.000Z');
  const moveAt = '2026-09-15T14:57:00.000Z';
  const board = checkpoint({ published_at: '2026-09-15T14:58:00.000Z', desks: [
    desk('bunter', { gate: gateOf(2), band: 'bunt', mode: 'live', venues: ['kalshi'], stake_usd: '10.00', pnl_usd: '0.40', evidence: evidenceOf('1.083000'),
      last_move: { at: moveAt, from_band: 'paper', to_band: 'bunt', reason: 'E crossed 1.03 after 6 trades' } }),
    desk('crypto', { gate: gateOf(3), band: 'swing', mode: 'live', venues: ['alpaca'], stake_usd: '42.50', evidence: null, last_move: null }),
  ], board: {
    enabled: true,
    bands: { kalshi: { bunt: { count: 2, capital_usd: '20.00' }, paper: { count: 40, capital_usd: '0' } }, alpaca: { bunt: { count: 1, capital_usd: '15.00' }, swing: { count: 1, capital_usd: '42.50' } } },
    moves: [{ id: 'le-1', at: moveAt, agent: 'bunter', venue: 'kalshi', from_band: 'paper', to_band: 'bunt', stake_usd: '10.00', reason: 'E crossed 1.03 after 6 trades' },
      { id: 'le-2', at: '2026-09-15T14:50:00.000Z', agent: 'crypto', venue: 'alpaca', from_band: 'swing', to_band: 'swing', stake_usd: '42.50', reason: 'E rose to 2.1' },
      { id: 'le-3', at: '2026-09-15T14:40:00.000Z', agent: 'newbie', venue: 'alpaca', from_band: 'replay', to_band: 'paper', stake_usd: null, reason: 'passed deep replay' }],
    throttle: { active: true, floor_pnl_usd: '-320.00', envelope_usd: '1017.75' },
  } });
  assert.equal(validCheckpoint(board), true);
  const tape = ladderEvent('bunter climbs from Practice to Bunt with a $10.00 real stake: E crossed 1.03 after 6 trades.', { id: 'le-1', at: moveAt });
  const model = boardSnapshot(board, [tape], now);
  assert.deepEqual(model.moves.map(move => [move.id, move.kind, move.venue]), [['le-1', 'up', 'kalshi'], ['le-2', 'size', 'alpaca']],
    'the board, the desk and the tape tell one move once, and a new agent starting practice is no crossing');
  const [three, two] = model.levels;
  assert.equal(two.capital, 35, 'Level 2 holds the bunt capital across both venues');
  assert.equal(three.capital, 42.5);
  assert.equal(two.agents[0].recent.id, 'le-1');
  assert.equal(model.throttle.active, true);
  assert.equal(model.enabled, true);
  assert.equal(two.agents[0].progress, 0, 'no real trade yet');
  assert.equal(agentWords(two.agents[0]), 'Level 2 · Kalshi · $10.00 stake · +$0.40 real · 0 real trades · 0% to Level 3');
  assert.equal(agentWords(three.agents[0]), 'Level 3 · Alpaca · $42.50 stake · +$250.25 real', 'no evidence: no progress and no invented trades');
  assert.equal(model.latestClimb.id, 'le-1', 'the first view replays the newest climb that still stands');
});

test('a restake that changes nothing is no move, one the checkpoint does not bear out keeps no amount, and neither replays', () => {
  const now = Date.parse('2026-09-23T15:18:00.000Z');
  const real = (id, stake, E, realTrades) => desk(id, { gate: gateOf(2), band: 'bunt', mode: 'live', venues: ['kalshi'], stake_usd: stake,
    evidence: evidenceOf('1.030000', { E, W_real: '1.100000', real_trades: realTrades }) });
  const board = checkpoint({ published_at: '2026-09-23T15:17:00.000Z', desks: [real('mullins-2', '5.11', '1.179821', 10), real('mullins-6', '10.00', '1.056406', 2)],
    board: { enabled: true, bands: {}, moves: [], throttle: { active: false, floor_pnl_usd: '-2.10', envelope_usd: '1017.75' } } });
  assert.equal(validCheckpoint(board), true);
  // The live tape of Sept 23: Mullins II restaked to $10 twice, while its coin is published at $5.11.
  const tape = [
    ladderEvent("mullins-2's real stake is now $10.00 (Bunt): bunt stake follows the evidence (E 1.1798).", { id: 'r-3', seq: 303, at: '2026-09-23T14:35:55.153Z' }),
    ladderEvent("mullins-6's real stake is now $10.00 (Bunt): bunt stake follows the evidence (E 1.0564).", { id: 'r-2', seq: 302, at: '2026-09-23T14:35:55.155Z' }),
    ladderEvent("mullins-2's real stake is now $10.00 (Bunt): bunt stake follows the evidence (E 1.1580).", { id: 'r-1', seq: 301, at: '2026-09-23T14:14:20.638Z' }),
  ];
  const model = boardSnapshot(board, tape, now);
  assert.deepEqual(model.moves.map(move => [move.id, moveWords(move)]), [['r-2', 'Mullins VI · stake $10'], ['r-1', 'Mullins II · restaked']],
    'the second $10 changed nothing; the first says no amount the coin contradicts');
  const [mullins2, mullins6] = ['mullins-2', 'mullins-6'].map(id => model.agents.find(agent => agent.id === id));
  assert.deepEqual([mullins2.move.id, mullins2.move.stake, mullins2.recent], ['r-1', null, null], 'the readout tells the same restake, past the hour');
  assert.equal(mullins6.recent.id, 'r-2');
  // Pressing a restake selects its coin and plays nothing: only a crossing to where the agent sits replays.
  for (const agent of [mullins2, mullins6]) assert.equal(replayable(agent.move, agent), false);
  assert.equal(replayable({ kind: 'up', fromBand: 'paper', toBand: 'bunt' }, mullins6), true);
  assert.equal(replayable({ kind: 'up', fromBand: null, toBand: 'bunt' }, mullins6), true, 'a climb from an unknown level still came from below');
  assert.equal(replayable({ kind: 'down', fromBand: 'bunt', toBand: 'paper' }, mullins6), false, 'not where the agent sits now');
  assert.equal(replayable({ kind: 'up', fromBand: 'swing', toBand: 'star' }, { level: 3, retired: false }), false, 'no level crossed');
  for (const kind of ['size', 'born', 'out']) assert.equal(replayable({ kind, fromBand: null, toBand: 'bunt' }, mullins6), false, kind);
  // A crossing sets the stake a restake is measured against; an exit forgets it.
  const at = minutes => new Date(now - minutes * 60000).toISOString();
  const kept = settleStakes([
    { id: 'c', agent: 'a', kind: 'size', toBand: 'bunt', stake: '10.00', at: at(1) },
    { id: 'b', agent: 'a', kind: 'up', fromBand: 'paper', toBand: 'bunt', stake: '10.00', at: at(2) },
    { id: 'z', agent: 'b', kind: 'size', toBand: 'bunt', stake: '12.00', at: at(3) },
  ], new Map([['b', 12]]));
  assert.deepEqual(kept.map(move => [move.id, move.stake]), [['b', '10.00'], ['z', '12.00']]);
});

// The House's band words, and the other words the page never shows on the ladder or in the feed.
const HOUSE_JARGON = /\b(?:replay|bunt|swing|star|paper|rungs?)\b|\bE (?=\d)/i;
test('the live ladder redraws after socket moves, keeps selection, draws every agent as a dot, and never says a band', async () => {
  const root = stubPage('floor', FLOOR_IDS);
  const credits = { credits_usd: '12.50' };
  let board = checkpoint({ published_at: new Date().toISOString(), desks: [
    desk('haghani', { gate: gateOf(1, credits), band: 'paper', pnl_usd: '3.00', evidence: evidenceOf('1.083000', { E: '1.040673' }) }),
    desk('bunter', { gate: gateOf(2, credits), band: 'bunt', mode: 'live', stake_usd: '10.00', pnl_usd: '0.40' }),
    desk('haghani-2', { gate: gateOf(0), status: 'retired' }),
  ] });
  let socket;
  class Socket {
    constructor() { socket = this; this.listeners = {}; }
    addEventListener(name, work) { this.listeners[name] = work; }
    close() {}
  }
  await withBrowser('', path => {
    if (path.includes('/checkpoint')) return board;
    if (path.includes('/history')) return { schema_version: 1, total: 0, points: [] };
    return { schema_version: 1, latest_seq: 0, events: [] };
  }, async () => {
    globalThis.WebSocket = Socket;
    const feed = await startCapital(root);
    try {
      const read = () => root.querySelector('#floor-improvement');
      assert.deepEqual(read().withClass('board-lane-head').map(words), ['Level 3 Increased capital 0', 'Level 2 Live trading 1 · $10 real', 'Level 1 Practice 1', 'Retired 1']);
      assert.deepEqual(read().withClass('board-dots').map(group => group.getAttribute('aria-label')),
        ['Level 3, Increased capital: 0 agents', 'Level 2, Live trading: 1 agent, $10 real', 'Level 1, Practice: 1 agent', 'Retired: 1 agent']);
      assert.equal(words(read().withClass('board-level-3')[0].withClass('board-vacant')[0]), 'No one yet', 'an empty level keeps its place');
      // Every agent is one button, whatever the Positions switch says: a dot, a coin or a retired ring.
      assert.equal(read().withClass('board-dot').length + read().withClass('board-coin').length, 3);
      assert.equal(read().withClass('board-dot-retired').length, 1);
      assert.equal(read().withClass('board-gate').length, 2, 'one gate into each level above practice');
      assert.deepEqual(read().withClass('board-gate').map(gate => [gate.getAttribute('data-gate'), gate.getAttribute('aria-hidden')]), [['3', 'true'], ['2', 'true']]);
      // One tab stop per floor.
      assert.deepEqual(read().withClass('board-dots').map(group => group.find('button').filter(button => button.getAttribute('tabindex') === '0').length), [0, 1, 1, 1]);
      assert.equal(words(read().withClass('board-detail')[0]), 'Tap any dot to see its agent.');
      const practice = read().withClass('board-level-1')[0].withClass('board-dot')[0];
      assert.equal(practice.getAttribute('aria-label'), 'Haghani · Level 1 · Alpaca · practice +8.3% · 6 trades');
      practice.click();
      assert.equal(words(read().withClass('board-detail')[0]), 'Haghani Alpaca Level 1 · practice +8.3% · 6 trades');
      for (const [seq, band, message] of [[301, 'bunt', 'haghani climbs from Practice to Bunt with a $10.00 real stake: E crossed 1.03.'],
        [302, 'paper', 'haghani drops from Bunt to Practice: it lost 35% of its real stake.']]) {
        const real = band === 'bunt';
        board = { ...board, published_at: new Date().toISOString(), desks: [{ ...board.desks[0], band, gate: gateOf(real ? 2 : 1, credits), mode: real ? 'live' : 'shadow', stake_usd: real ? '10.00' : null }, ...board.desks.slice(1)] };
        const event = ladderEvent(message, { seq, id: `ladder:${seq}`, at: new Date().toISOString() });
        socket.listeners.message({ data: JSON.stringify(event) });
        for (let i = 0; i < 30; i += 1) await new Promise(resolve => setImmediate(resolve));
        const floor = read().withClass(real ? 'board-level-2' : 'board-level-1')[0];
        const mine = floor.find('button').find(button => button.getAttribute('data-agent') === 'haghani');
        assert.ok(mine, `haghani sits on ${real ? 'Level 2' : 'Level 1'}`);
        assert.equal(mine.className.split(' ')[0], real ? 'board-coin' : 'board-dot', 'a real stake is a coin, practice a dot');
        assert.equal(mine.getAttribute('aria-pressed'), 'true', 'the selection follows the agent across the redraw');
        assert.equal(mine.getAttribute('tabindex'), '0');
        assert.match(words(read().withClass('board-detail')[0]), real ? /^Haghani Alpaca Level 2 · \$10\.00 stake · \+\$3\.00 real · 0 real trades ↑ Level 1 → 2 · just now$/ : /^Haghani Alpaca Level 1 · practice \+8\.3% · 6 trades ↓ Level 2 → 1 · just now · lost 35% of its real stake$/);
        assert.equal(words(mine.withClass('board-mark')[0]), real ? '↑' : '↓', 'the arrow stays for the hour');
        assert.match(mine.getAttribute('aria-label'), real ? /· recently promoted$/ : /· recently demoted$/);
        const moves = read().withClass('board-moves')[0];
        assert.equal(moves.getAttribute('aria-label'), 'Latest moves, newest first');
        assert.match(words(moves), real ? /Haghani · Level 1 → 2 · \$10/ : /Haghani · Level 2 → 1/);
        const row = moves.withClass('board-change')[0];
        assert.equal(row.tag, 'button', 'a move whose agent has a dot selects it');
        assert.match(row.getAttribute('aria-label'), /^Show Haghani · Level \d → \d/);
        assert.doesNotMatch(read().textContent, HOUSE_JARGON);
        for (const node of read().descendants()) {
          for (const name of ['aria-label', 'title']) if (node.getAttribute(name)) assert.doesNotMatch(node.getAttribute(name), HOUSE_JARGON, node.getAttribute(name));
        }
      }
      // The feed's League lines say the same moves in the same words.
      assert.doesNotMatch(root.querySelector('#floor-feed').textContent, HOUSE_JARGON);
      assert.match(words(root.querySelector('#floor-feed')), /Haghani drops to Level 1: lost 35% of its real stake/);
      assert.match(words(root.querySelector('#floor-feed')), /Haghani climbs to Level 2 with \$10 real/);
      // Pressing a move selects its agent; the retired agent's own ring is a button too.
      read().withClass('board-dot-retired')[0].click();
      assert.equal(words(read().withClass('board-detail')[0]), 'Haghani II Alpaca Retired');
      read().withClass('board-moves')[0].withClass('board-change')[0].click();
      assert.match(words(read().withClass('board-detail')[0]), /^Haghani Alpaca Level 1/);
      assert.deepEqual(root.find('a'), [], 'no links');
    } finally { feed.stop(); }
  });
});

test('the ladder\'s edge states: a board on or off, a throttle, a star, accounting under review, an empty roster, stale data', async () => {
  const now = Date.now();
  const at = new Date(now - 60000).toISOString();
  const draw = (checkpointBody, look) => withBrowser('', path => {
    if (path.includes('/checkpoint')) return checkpointBody;
    if (path.includes('/history')) return { schema_version: 1, total: 0, points: [] };
    return { schema_version: 1, latest_seq: 0, events: [] };
  }, async () => {
    const root = stubPage('floor', FLOOR_IDS);
    const feed = await startCapital(root);
    feed.stop();
    const ladder = root.querySelector('#floor-improvement');
    assert.doesNotMatch(ladder.textContent, HOUSE_JARGON);
    await look(ladder);
  });
  const summary = { enabled: true, bands: {}, moves: [], throttle: { active: true, floor_pnl_usd: '-5.84', envelope_usd: '1017.75' } };
  const roster = [
    desk('mullins-13', { family: 'weather-favorites', venues: ['kalshi'], gate: gateOf(1), band: 'paper', stake_usd: null, evidence: evidenceOf('1.012000', { E: '1.006000', trades: 4 }) }),
    desk('scholes-20', { family: 'equity-trend', gate: gateOf(1), band: 'paper', stake_usd: null, evidence: evidenceOf('1.000000', { trades: 0 }) }),
    desk('krasker-4', { gate: gateOf(1, { accounting_ok: false }), band: 'paper', pnl_usd: '40.00', stake_usd: null, evidence: evidenceOf('1.200000') }),
    desk('hilibrand-3', { gate: gateOf(3), band: 'star', mode: 'live', venues: ['kalshi'], stake_usd: '240.00', pnl_usd: '-2.10', evidence: evidenceOf('1.3', { E: '1.700000', W_real: '1.2', real_trades: 20 }) }),
  ];
  await draw(checkpoint({ published_at: at, desks: roster, board: summary }), on => {
  assert.match(words(on), /^4 competing · 1 on real money Updates live Up Down Flat No trades yet Toward next level Top 3 Throttle on: every real stake is halved while the floor is −\$5\.84 on \$1,018\./);
  assert.equal(words(on.withClass('board-detail')[0]), 'Tap any dot. Closest to Level 2: Mullins XIII.');
  const dot = id => on.descendants().find(node => node.getAttribute('data-agent') === id);
  assert.match(dot('mullins-13').className, /\bboard-arc\b/);
  assert.match(dot('scholes-20').className, /\bboard-dot-untraded\b/);
  assert.match(dot('hilibrand-3').className, /\bboard-coin-star\b/);
  assert.equal(words(dot('hilibrand-3').withClass('board-glyph')[0]), '−', 'a loss reads without colour');
  dot('mullins-13').click();
  assert.equal(words(on.withClass('board-detail')[0]), 'Mullins XIII Kalshi weather favorites Level 1 · practice +1.2% · 4 trades 60% to Level 2 · evidence 1.006 of 1.01 · 4 of 5 trades');
  dot('scholes-20').click();
  assert.equal(words(on.withClass('board-detail')[0]), 'Scholes XX Alpaca equity trend Level 1 · no closed trades yet 0% to Level 2 · evidence 1.000 of 1.01 · 0 of 5 trades');
  dot('krasker-4').click();
  assert.equal(words(on.withClass('board-detail')[0]), 'Krasker IV Alpaca Level 1 · 6 trades · accounting under review', 'no growth, no arc, no P&L while the accounts are in question');
  assert.doesNotMatch(dot('krasker-4').className, /board-arc|positive/);
  dot('hilibrand-3').click();
  assert.equal(words(on.withClass('board-detail')[0]), 'Hilibrand III Kalshi Level 3 · top 3 earner · $240.00 stake · −$2.10 real · 20 real trades');
  });
  // The board switched off: bands as published, and no claim about how near anyone is.
  await draw(checkpoint({ published_at: at, desks: roster, board: { ...summary, enabled: false, throttle: { ...summary.throttle, active: false } } }), off => {
    assert.equal(off.withClass('board-arc').length, 0);
    assert.doesNotMatch(words(off), /Toward next level|Throttle/);
    assert.equal(words(off.withClass('board-detail')[0]), 'Tap any dot to see its agent.');
  });
  // Nobody yet: three empty floors, and the retired still shown.
  await draw(checkpoint({ published_at: at, desks: [desk('haghani-2', { gate: gateOf(1), status: 'retired', pnl_usd: '-3.00' })] }), empty => {
    assert.match(words(empty), /^0 competing · 0 on real money Updates live Level 3 Increased capital 0 No one yet ▲ Level 2 Live trading 0 No one yet ▲ Level 1 Practice 0 No one yet Retired 1 Haghani II No agent is competing yet\.$/);
    assert.match(empty.withClass('board-dot-retired')[0].className, /\bnegative\b/, 'a ring tinted by how the agent ended');
  });
  // Stale: the last known positions, said plainly.
  await draw(checkpoint({ published_at: '2026-09-15T14:05:00.000Z', desks: roster, board: summary }), stale => {
    assert.match(words(stale), /^4 competing · 1 on real money Last known positions · data stale/);
  });
});

test('checkpoint lifecycle survives a quiet or truncated tape and contaminated accounts never appear profitable', () => {
  const now = Date.parse('2026-09-15T15:00:00.000Z');
  const board = checkpoint({ desks: [desk('haghani', { pnl_usd: '500', gate: { name: 'rung 1', passed: false, evidence: {
    rung: 1, accounting_ok: false, lifecycle: { born_at: '2026-09-14T00:00:00.000Z', died_at: null, cause: null,
      last_move: { id: 'demote:1', at: '2026-09-15T14:59:00.000Z', decision: 'demote', from_rung: 2, to_rung: 1, reason: 'drift' } },
  } } })] });
  const snapshot = boardSnapshot(board, [], now);
  assert.equal(snapshot.moves[0].kind, 'down');
  const practice = snapshot.levels.find(row => row.level === 1).agents[0];
  assert.equal(practice.pnl, null);
  assert.equal(practice.tone, 'flat');
  assert.equal(practice.accountingIssue, true);
  assert.equal(practice.recent.kind, 'down');
  const same = ladderEvent('haghani drops from rung 2 to rung 1: drift.', { id: 'demote:1', at: '2026-09-15T14:59:00.000Z' });
  assert.equal(boardSnapshot(board, [same], now).moves.filter(move => move.kind === 'down').length, 1);
});

test('the checkpoint carries the capital board: bands, stakes, evidence and moves, typed, and old checkpoints still pass', () => {
  const at = '2026-09-15T14:05:00.000Z';
  const row = (overrides = {}) => desk('bunter', { band: 'bunt', stake_usd: '10.00', evidence: evidenceOf('1.083000'),
    last_move: { at: '2026-09-15T14:00:00.000Z', from_band: 'paper', to_band: 'bunt', reason: 'E crossed 1.03' }, ...overrides });
  const summary = (overrides = {}) => ({ enabled: true, bands: { kalshi: { bunt: { count: 1, capital_usd: '10.00' } } },
    moves: [{ id: 'le-1', at: '2026-09-15T14:00:00.000Z', agent: 'bunter', venue: 'kalshi', from_band: 'paper', to_band: 'bunt', stake_usd: '10.00', reason: 'E crossed 1.03' }],
    throttle: { active: false, floor_pnl_usd: '-12.40', envelope_usd: '1017.75' }, ...overrides });
  assert.equal(validCheckpoint(checkpoint()), true, 'a checkpoint without the board still validates');
  assert.equal(validDesk(row(), at), true);
  assert.equal(validCheckpoint(checkpoint({ desks: [row()], board: summary() })), true);
  for (const [why, value] of [['no evidence yet', row({ evidence: null, last_move: null, stake_usd: null })], ['no real trades field', row({ evidence: evidenceOf('0.9', { real_trades: undefined }) })],
    ['a first seat has no band to come from', row({ last_move: { at: '2026-09-15T14:00:00.000Z', from_band: null, to_band: 'replay', reason: '' } })],
    ['every band', row({ band: 'star' })], ['a big multiple', row({ evidence: evidenceOf('12.5', { E: '40.123456' }) })]]) {
    const clean = JSON.parse(JSON.stringify(value));
    assert.equal(validDesk(clean, at), true, why);
  }
  for (const [why, value] of [
    ['an unknown band', row({ band: 'practice' })], ['a negative stake', row({ stake_usd: '-1.00' })], ['a numeric stake', row({ stake_usd: 10 })],
    ['a negative multiple', row({ evidence: evidenceOf('-0.9') })], ['seven places', row({ evidence: evidenceOf('1.0000001') })],
    ['an extra evidence key', row({ evidence: { ...evidenceOf('1.1'), sharpe: '2' } })], ['a float trade count', row({ evidence: evidenceOf('1.1', { trades: 1.5 }) })],
    ['a move to nowhere', row({ last_move: { at: '2026-09-15T14:00:00.000Z', from_band: 'paper', to_band: 'dead', reason: 'x' } })],
    ['a move after the checkpoint', row({ last_move: { at: '2026-09-15T14:07:00.000Z', from_band: 'paper', to_band: 'bunt', reason: 'x' } })],
    ['a move with a link', row({ last_move: { at: '2026-09-15T14:00:00.000Z', from_band: 'paper', to_band: 'bunt', reason: '<b>x</b>' } })],
    ['a move with an extra key', row({ last_move: { at: '2026-09-15T14:00:00.000Z', from_band: 'paper', to_band: 'bunt', reason: 'x', stake_usd: '1' } })],
  ]) assert.equal(validDesk(value, at), false, why);
  const move = summary().moves[0];
  for (const [why, value] of [
    ['an unknown key', summary({ extra: 1 })], ['an unknown band', summary({ bands: { kalshi: { dead: { count: 1, capital_usd: '0' } } } })],
    ['a bad venue', summary({ bands: { 'Kalshi!': { bunt: { count: 1, capital_usd: '1' } } } })], ['a string count', summary({ bands: { kalshi: { bunt: { count: '1', capital_usd: '1' } } } })],
    ['fifty-one moves', summary({ moves: Array.from({ length: 51 }, (_, n) => ({ ...move, id: `le-${n}` })) })], ['duplicate moves', summary({ moves: [move, move] })],
    ['a move without an agent id', summary({ moves: [{ ...move, agent: 'Bunter' }] })], ['a move with a bad id', summary({ moves: [{ ...move, id: 'a/b' }] })],
    ['a throttle with more', summary({ throttle: { active: true, floor_pnl_usd: '-1', envelope_usd: '1', halved: true } })],
    ['an enabled string', summary({ enabled: 'yes' })], ['no moves', (({ moves, ...rest }) => rest)(summary())],
  ]) assert.equal(validCheckpoint(checkpoint({ desks: [row()], board: value })), false, why);
  assert.equal(validCheckpoint(checkpoint({ desks: [row()], board: summary({ moves: Array.from({ length: 50 }, (_, n) => ({ ...move, id: `le-${n}` })) }) })), true, 'fifty moves');
});

test('the roster holds 160 desks and the checkpoint half a megabyte, and no more', async () => {
  const many = count => Array.from({ length: count }, (_, n) => desk(`agent-${n}`, { band: 'paper', evidence: evidenceOf('1.010000') }));
  const floorCounts = { ...checkpoint().floor, live_desks: 0, shadow_desks: 160 };
  assert.equal(validCheckpoint(checkpoint({ desks: many(160), floor: floorCounts, committee: { last_memo_at: null, allocations: Object.fromEntries(many(160).map(row => [row.id, '200'])) } })), true);
  assert.equal(validCheckpoint(checkpoint({ desks: many(161) })), false);
  assert.equal(validCheckpoint(checkpoint({ floor: { ...floorCounts, shadow_desks: 161 } })), false);
  assert.equal(validCurveRow({ generation: 1, desks: 160, decisions: 1, cost_usd: '1', pnl_usd: '0', cost_adjusted_excess_pct: '0', brier: null, pnl_per_inference_usd: '0' }), true);
  // 160 desks with a full book each: about 300 KiB, more than the old 256 KiB limit, stored whole.
  const thesis = 'Resting a post-only NO bid on a favourite in the 0.90-0.97 band, twenty hours to close. '.repeat(2);
  const book = Array.from({ length: 4 }, (_, n) => position({ thesis: thesis.slice(0, 240), instrument: { symbol: `KXHIGHNY-26SEP16-B${70 + n}.5`, asset_class: 'event', venue: 'kalshi' } }));
  const big = checkpoint({ published_at: '2026-09-15T14:59:00.000Z', desks: many(160).map(row => ({ ...row, positions: book })), floor: floorCounts });
  const size = new TextEncoder().encode(JSON.stringify(big)).length;
  assert.ok(size > 256 * 1024 && size < 512 * 1024, `${size} bytes`);
  const { capital } = floor();
  const reply = await post(capital, '/api/capital/checkpoint', big);
  assert.equal(reply.status, 200, await reply.clone().text());
  assert.equal((await reply.json()).desks, 160);
});
const infra = (overrides = {}) => ({
  host: 'sailbox', box_id: 'box-9f2c1ad4', checkpoint_count: 118, spend_usd: '4.21',
  uptime_seconds: 93784, region: 'us-east', requests_today: 37, ...overrides,
});
const review = (overrides = {}) => ({
  id: 'risk.review.1', stream: 'risk', kind: 'risk.review', at: '2026-09-15T14:02:00.000Z',
  digest: 'a'.repeat(64),
  payload: { intent_id: 'intent-2026-09-15-01', desk_id: 'merton', verdict: 'approve', reason: 'Inside the position cap and the mandate.', model: 'deterministic-rules-v4' },
  ...overrides,
});
test('the publisher projection is the only event shape the floor stores', async () => {
  const { capital } = floor();
  assert.equal(validEvent(event()), true);
  // Event.to_public() may be posted verbatim: the publisher's own seq is accepted and ignored.
  assert.equal(validEvent({ ...event(), seq: 41 }), true);
  assert.equal(Object.hasOwn(EVENT_KINDS, 'provider.request'), false);
  const rejected = [
    ['private key', e => { e.payload._prompt = 'system prompt'; }],
    ['nested private key', e => { e.payload.detail = { _raw: 'model output' }; }],
    ['api credential', e => { e.payload.text = 'exported sk-live-9aa1 for the run'; }],
    ['bearer credential', e => { e.payload.text = 'sent Bearer abc123 to the venue'; }],
    ['broker credential', e => { e.payload.text = 'header APCA-API-KEY-ID rotated'; }],
    ['markup', e => { e.payload.text = 'the filing said <b>growth</b>'; }],
    ['offsite url', e => { e.payload.text = 'source https://example.com/report'; }],
    ['insecure url', e => { e.payload.text = 'source http://www.sec.gov/x'; }],
    ['script uri', e => { e.payload.text = 'then javascript:alert(1) runs'; }],
    ['data uri', e => { e.payload.text = 'see data:text/plain;base64,QQ== for the table'; }],
    ['private model traffic', e => { e.kind = 'provider.request'; }],
    ['kind outside its stream', e => { e.stream = 'risk'; }],
    ['uppercase stream', e => { e.stream = 'desk:Rosenfeld'; }],
    ['unknown stream family', e => { e.stream = 'vault:rosenfeld'; }],
    ['timestamp without milliseconds', e => { e.at = '2026-09-15T14:01:00Z'; }],
    ['impossible timestamp', e => { e.at = '2026-09-31T14:01:00.000Z'; }],
    ['short digest', e => { e.digest = 'abc123'; }],
    ['uppercase digest', e => { e.digest = 'A'.repeat(64); }],
    ['spaced id', e => { e.id = 'desk rosenfeld 01'; }],
    ['array payload', e => { e.payload = ['text']; }],
    ['unknown field', e => { e.received_at = 1; }],
    ['long string', e => { e.payload.text = 'a'.repeat(8001); }],
    ['oversized payload', e => { e.payload.notes = Array.from({ length: 6 }, () => 'a'.repeat(7000)); }],
  ];
  for (const [label, mutate] of rejected) {
    const candidate = event();
    mutate(candidate);
    assert.equal(validEvent(candidate), false, label);
    assert.equal((await post(capital, '/api/capital/events', batch(candidate))).status, 400, label);
  }
  const cited = event(2);
  cited.payload.text = 'Filing https://www.sec.gov/Archives/edgar/data/1/2/3-index.html confirms the number.';
  assert.equal(validEvent(cited), true);
  // Hilibrand's first live thought was refused for the words "from the data:" before a
  // line break. A scheme needs something after its colon; prose does not.
  const prose = event(3);
  prose.payload.text = 'The dates near the end are clearly from the data:\n\nLooking at the last bar, the file: is closed.';
  assert.equal(validEvent(prose), true, 'a colon followed by whitespace is punctuation, not a scheme');
  assert.equal(sourceUrl('https://efts.sec.gov/LATEST/search-index?q=x'), 'https://efts.sec.gov/LATEST/search-index?q=x');
  assert.equal(sourceUrl('https://www.sec.gov:8443/x'), null, 'no alternate ports');
  assert.equal(sourceUrl('https://user:key@www.sec.gov/x'), null, 'no credentials in a citation');
  assert.equal(sourceUrl('https://finance.yahoo.com/quote/MSFT'), 'https://finance.yahoo.com/quote/MSFT');
  assert.equal(validStream('broker:kalshi'), true);
  assert.equal(validEventBatch({ schema_version: 2, events: [event()] }), false);
  assert.equal(validEventBatch({ schema_version: 1, events: [] }), false);
});

test('risk.review is publishable and carries one fixed payload shape', async () => {
  const { capital } = floor();
  assert.equal(EVENT_KINDS['risk.review'].tone, 'risk');
  assert.equal(validEvent(review()), true);
  assert.equal(validEvent(review({ payload: { ...review().payload, verdict: 'block', reason: 'Order exceeds the daily loss budget.' } })), true);
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(review()))).json(), { stored: 1, replayed: 0 });
  assert.deepEqual((await (await get(capital, '/api/capital/events?kind=risk.review')).json()).events.map(e => e.payload.verdict), ['approve']);
  const rejected = [
    ['unknown verdict', { verdict: 'maybe' }],
    ['missing model', { model: undefined }],
    ['empty reason', { reason: '   ' }],
    ['uppercase desk id', { desk_id: 'Merton' }],
    ['numeric intent', { intent_id: 7 }],
    ['extra field', { severity: 'high' }],
  ];
  for (const [label, patch] of rejected) {
    const payload = { ...review().payload, ...patch };
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete payload[key];
    const candidate = review({ id: `risk.review.${label.replace(/\W/g, '')}`, payload });
    assert.equal(validKindPayload('risk.review', payload), false, label);
    assert.equal(validEvent(candidate), false, label);
    assert.equal((await post(capital, '/api/capital/events', batch(candidate))).status, 400, label);
  }
  // Only the listed kinds are shape-checked; everything else keeps its free-form payload.
  assert.equal(validKindPayload('desk.thought', { anything: 'goes' }), true);
});

test('batches are idempotent by id and a conflicting digest rejects the whole batch', async () => {
  const { capital } = floor();
  assert.equal((await post(capital, '/api/capital/events', batch(event()), { auth: 'wrong-token-but-long-enough-to-compare' })).status, 401);
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(event(1), event(2)))).json(), { stored: 2, replayed: 0 });
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(event(1), event(2)))).json(), { stored: 0, replayed: 2 });
  const rewritten = event(1, { payload: { session_id: 'sess-2026-09-15', text: 'Rewritten history.' }, digest: 'f'.repeat(64) });
  assert.equal((await post(capital, '/api/capital/events', batch(event(3), rewritten))).status, 409);
  const stored = await (await get(capital, '/api/capital/events')).json();
  assert.deepEqual(stored.events.map(e => e.seq), [2, 1], 'the conflicting batch stored nothing');
  assert.equal(stored.latest_seq, 2);
  assert.deepEqual(stored.events[1], { ...event(1), seq: 1 });
  assert.equal((await post(capital, '/api/capital/events', batch(event(4), event(4)))).status, 400);
  assert.equal((await post(capital, '/api/capital/events', batch(...Array.from({ length: 101 }, (_, i) => event(i + 10))))).status, 400);
  assert.equal((await post(capital, '/api/capital/events', `{"schema_version":1,"padding":"${'x'.repeat(MAX_BATCH_BYTES)}"}`)).status, 413);
  assert.equal((await post(capital, '/api/capital/events', '{"schema_version":1,')).status, 400);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/events', { method: 'DELETE' }))).status, 405);
  assert.equal(MAX_EVENTS_KEPT > 1000, true);
});

test('checkpoints publish forward only and the desk roster follows them', async () => {
  const { capital } = floor();
  assert.equal(validCheckpoint(checkpoint()), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint(), { auth: 'short' })).status, 401);
  assert.equal((await get(capital, '/api/capital/checkpoint')).status, 404);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint())).status, 200);
  const read = await get(capital, '/api/capital/checkpoint');
  assert.deepEqual(await read.json(), checkpoint());
  assert.equal((await get(capital, '/api/capital/checkpoint', { 'If-None-Match': read.headers.get('ETag') })).status, 304);
  assert.match(read.headers.get('Cache-Control'), /max-age=5.*no-transform/);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint())).status, 200, 'an identical replay is a no-op');
  const older = checkpoint({ published_at: '2026-09-15T13:00:00.000Z', desks: [desk('rosenfeld', { updated_at: '2026-09-15T12:00:00.000Z' })] });
  assert.equal((await post(capital, '/api/capital/checkpoint', older)).status, 409);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint({ published_at: '2026-09-15T15:02:00.000Z' }))).status, 400, 'more than a minute ahead');
  for (const invalid of [
    checkpoint({ desks: [desk('rosenfeld', { mode: 'margin' })] }),
    checkpoint({ desks: [desk('rosenfeld', { status: 'trading' })] }),
    checkpoint({ desks: [desk('rosenfeld', { equity: 50250.25 })] }),
    checkpoint({ desks: [desk('rosenfeld', { updated_at: '2026-09-15T14:06:00.000Z' })] }),
    checkpoint({ desks: [desk('rosenfeld'), desk('rosenfeld')] }),
    checkpoint({ floor: { ...checkpoint().floor, benchmark: { name: 'S&P 500', return_pct: '0.31', source: 'vendor' } } }),
    checkpoint({ committee: { last_memo_at: '2026-09-15T14:06:00.000Z', allocations: {} } }),
    checkpoint({ budget: { spent_today_usd: '-1', cap_usd: '25' } }),
    checkpoint({ secret_notes: 'private' }),
  ]) {
    assert.equal(validCheckpoint(invalid), false);
    assert.equal((await post(capital, '/api/capital/checkpoint', invalid)).status, 400);
  }
  const desks = await (await get(capital, '/api/capital/desks')).json();
  assert.deepEqual(desks, { schema_version: 1, desks: [desk()] });
  assert.deepEqual(await (await get(capital, '/api/capital/desks/rosenfeld')).json(), desk());
  assert.equal((await get(capital, '/api/capital/desks/unknown-desk')).status, 404);
  assert.equal((await get(capital, '/api/capital/desks/..%2Fadmin')).status, 404);
  const next = checkpoint({ published_at: '2026-09-15T14:30:00.000Z', desks: [desk('mullins', { name: 'Mullins', family: 'mullins', parent_id: 'rosenfeld', gate: null })] });
  assert.equal((await post(capital, '/api/capital/checkpoint', next)).status, 200);
  assert.deepEqual((await (await get(capital, '/api/capital/desks')).json()).desks.map(row => row.id), ['mullins']);
  assert.equal((await get(capital, '/api/capital/desks/rosenfeld')).status, 404, 'a retired roster row leaves with its checkpoint');
  assert.equal(validDesk(desk('mullins', { parent_id: 'mullins' }), '2026-09-15T14:30:00.000Z'), false);
});

test('public reads page newest first and follow a cursor forward', async () => {
  const { capital } = floor();
  const events = [
    ...Array.from({ length: 6 }, (_, i) => event(i + 1)),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `ledger.rosenfeld.mark.${i}`, stream: 'ledger:rosenfeld', kind: 'ledger.mark',
      at: `2026-09-15T13:0${i}:00.000Z`, digest: (100 + i).toString(16).padStart(64, '0'),
      payload: { equity: String(50000 + i * 25), cash: '10000', daily_pnl: '25', as_of: `2026-09-15T13:0${i}:00.000Z`, positions: [{ instrument: 'MSFT', quantity: '20', price: '500', market_value: '10000' }] },
    })),
  ];
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(...events))).json(), { stored: 10, replayed: 0 });
  const newest = await (await get(capital, '/api/capital/events')).json();
  assert.deepEqual(newest.events.map(e => e.seq), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?limit=3')).json()).events.map(e => e.seq), [10, 9, 8]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?after=6&limit=2')).json()).events.map(e => e.seq), [7, 8]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?stream=ledger%3Arosenfeld')).json()).events.map(e => e.seq), [10, 9, 8, 7]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?kind=desk.thought&limit=2')).json()).events.map(e => e.seq), [6, 5]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?stream=risk')).json()).events, []);
  for (const query of ['?limit=201', '?limit=0', '?after=-1', '?after=abc', '?stream=Desk:X', '?kind=provider.request', '?cursor=1', '?limit=1&limit=2']) {
    assert.equal((await get(capital, '/api/capital/events' + query)).status, 400, query);
  }
  const page = await get(capital, '/api/capital/events?limit=3');
  assert.match(page.headers.get('Cache-Control'), /max-age=3.*no-transform/);
  assert.equal((await get(capital, '/api/capital/events?limit=3', { 'If-None-Match': page.headers.get('ETag') })).status, 304);
  assert.equal((await capital.fetch(request('POST', '/api/capital/desks', {}))).status, 405);
  assert.equal((await get(capital, '/api/capital/unknown')).status, 404);
});

test('the live tape fans out to matching subscribers only', async () => {
  assert.equal(socketMatches(['all'], 'desk:rosenfeld'), true);
  assert.equal(socketMatches(['desk:rosenfeld'], 'desk:rosenfeld'), true);
  assert.equal(socketMatches(['desk:rosenfeld'], 'desk:mullins'), false);
  assert.equal(socketMatches(['desk:rosenfeld', 'risk'], 'risk'), true);
  assert.equal(socketMatches([], 'risk'), false);
  assert.equal(socketMatches('all', 'risk'), false);
  assert.deepEqual(parseStreamTags('desk:rosenfeld,risk'), ['desk:rosenfeld', 'risk']);
  assert.deepEqual(parseStreamTags(null), ['all']);
  assert.deepEqual(parseStreamTags('all,risk'), ['all']);
  assert.deepEqual(parseStreamTags('desk:rosenfeld, desk:rosenfeld '), ['desk:rosenfeld']);
  assert.equal(parseStreamTags('desk:rosenfeld,not a stream'), null);
  assert.equal(parseStreamTags(Array.from({ length: 9 }, (_, i) => `desk:d${i}`).join(',')), null);
  assert.equal(allowedOrigin('https://blakewoods.us'), true);
  assert.equal(allowedOrigin('http://localhost:4173'), true);
  assert.equal(allowedOrigin('https://blakewoods.us.evil.example'), false);

  const { capital, listen } = floor();
  const deskSocket = listen(['desk:rosenfeld']);
  const riskSocket = listen(['risk']);
  const everything = listen(['all']);
  await post(capital, '/api/capital/events', batch(event(1), review()));
  assert.deepEqual(deskSocket.received.map(e => e.stream), ['desk:rosenfeld']);
  assert.deepEqual(riskSocket.received.map(e => e.kind), ['risk.review']);
  assert.equal(everything.received.length, 2);
  assert.equal(everything.received[0].seq, 1);
  await post(capital, '/api/capital/events', batch(event(1)));
  assert.equal(everything.received.length, 2, 'a replay is not rebroadcast');

  const upgrade = await capital.fetch(new Request('https://blakewoods.us/api/capital/stream', { headers: { Origin: 'https://blakewoods.us' } }));
  assert.equal(upgrade.status, 426);
  const websocket = { Upgrade: 'websocket' };
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream', { headers: { ...websocket, Origin: 'https://elsewhere.example' } }))).status, 403);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream', { headers: { ...websocket } }))).status, 403);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream?streams=nope', { headers: { ...websocket, Origin: 'https://blakewoods.us' } }))).status, 400);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream?limit=1', { headers: { ...websocket, Origin: 'https://blakewoods.us' } }))).status, 400);
  for (let index = 0; index < 200; index++) listen(['all']);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream', { headers: { ...websocket, Origin: 'https://www.blakewoods.us' } }))).status, 503);

  const { capital: quiet } = floor();
  const socket = { tags: ['all'], received: [], send() { throw new Error('gone'); }, close(code) { this.closed = code; } };
  quiet.ctx.getWebSockets = () => [socket];
  await post(quiet, '/api/capital/events', batch(event(1)));
  assert.equal(socket.closed, 1011, 'a broken socket is closed, not retried');
  quiet.webSocketMessage({ send() { throw new Error('unexpected'); }, close(code) { this.closed = code; } }, 'x'.repeat(2000));
  const keepalive = { sent: [], send(message) { this.sent.push(message); }, close() {} };
  quiet.webSocketMessage(keepalive, 'ping');
  assert.match(keepalive.sent[0], /"type":"pong"/);
  quiet.webSocketMessage(keepalive, 'publish something');
  assert.equal(keepalive.sent.length, 1, 'the tape is one way');
});

test('the retired Portfolio Agent redirects its pages and refuses its API', async () => {
  for (const path of ['/portfolio', '/portfolio/', '/portfolio/research/', '/portfolio/runtime.json']) {
    assert.deepEqual(retiredRoute(path), { status: 301, headers: { Location: RETIRED_TARGET, 'Cache-Control': 'public, max-age=3600' }, body: '' }, path);
  }
  for (const path of ['/api/portfolio', '/api/portfolio/state', '/api/portfolio/research/abc', '/api/portfolio/notifications/test']) {
    const route = retiredRoute(path);
    assert.equal(route.status, 410, path);
    assert.match(JSON.parse(route.body).error, /retired/);
  }
  // The desk pages are retired: one page carries every position and the reason for it.
  for (const path of ['/capital/desk', '/capital/desk/', '/capital/desk/?id=mullins', '/capital/desk/index.html']) {
    assert.deepEqual(retiredRoute(path.split('?')[0]), { status: 301, headers: { Location: RETIRED_TARGET, 'Cache-Control': 'public, max-age=3600' }, body: '' }, path);
  }
  for (const path of ['/capital/', '/api/capital/events', '/', '/api/exchange', '/portfoliox', '/api/portfoliox', '/capital/desks']) {
    assert.equal(retiredRoute(path), null, path);
  }

  const server = createServer(() => { throw new Error('No exchange calls expected'); }, { origin: 'http://localhost' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/portfolio', '/portfolio/', '/portfolio/research/', '/portfolio/runtime.js']) {
      const response = await fetch(origin + path, { redirect: 'manual' });
      assert.equal(response.status, 301, path);
      assert.equal(response.headers.get('location'), '/capital/', path);
    }
    for (const path of ['/api/portfolio/state', '/api/portfolio/research']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 410, path);
      assert.match((await response.json()).error, /Long-Term Capital Management publishes to \/api\/capital\//);
    }
    // The floor's own pages and modules are still the only public files.
    for (const path of ['/', '/capital/', '/capital/capital.js', '/capital/capital.css', '/capital/schema.js']) {
      assert.equal((await fetch(origin + path)).status, 200, path);
    }
    // The loop page is retired (Sept 19, 2026): its address sends a reader to the floor.
    const loopPage = await fetch(origin + '/capital/committee/', { redirect: 'manual' });
    assert.equal(loopPage.status, 301);
    assert.equal(loopPage.headers.get('location'), '/capital/');
    for (const path of ['/capital/desk', '/capital/desk/', '/capital/desk/?id=mullins']) {
      const deskPage = await fetch(origin + path, { redirect: 'manual' });
      assert.equal(deskPage.status, 301, path);
      assert.equal(deskPage.headers.get('location'), '/capital/', path);
    }
    for (const path of ['/capital/runtime.json', '/capital/private.json', '/.env', '/.data/credentials.json']) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the floor projects partner names, truncation, money and the stream address without touching markup', () => {
  assert.deepEqual(Object.keys(PARTNERS), PARTNER_ORDER);
  // The twelve desks of the rebuilt league, each a partner of the firm. Merton is not a desk: he is
  // the frontier model that writes the code and audits every candidate for real money.
  assert.deepEqual(PARTNER_ORDER, ['meriwether', 'hilibrand', 'scholes', 'rosenfeld', 'haghani', 'mullins',
    'mcentee', 'krasker', 'hawkins', 'hufschmid', 'huang', 'leahy']);
  assert.ok(!Object.hasOwn(PARTNERS, 'merton'));
  assert.equal(floorName('meriwether-3'), 'Meriwether III');
  assert.equal(floorName('meriwether'), 'Meriwether');
  assert.equal(partnerOf(desk('rosenfeld-02', { family: 'rosenfeld' })).surname, 'Rosenfeld', 'a bred desk keeps the partner name');
  assert.equal(partnerName('unknown-desk'), 'Unknown Desk', 'a slug reads as its words');
  // Desks the partner table does not know still get a name: Scholes, Scholes II, Haghani II once, not twice.
  assert.equal(partnerName('scholes'), 'Scholes');
  assert.equal(partnerName('scholes-2'), 'Scholes II');
  assert.equal(raceName(desk('haghani-2', { name: 'Haghani II', family: 'weather', generation: 2 })), 'Haghani II');
  assert.equal(raceName(desk('scholes', { name: 'Scholes', family: 'ranges' })), 'Scholes');
  assert.equal(partnerOf(desk('lab-07', { name: 'Lab Seven', family: 'lab' })).surname, 'Lab Seven');
  // The desks lead in the owner's order; Merton is no desk, so anything by that name follows them.
  assert.deepEqual(orderDesks([desk('mullins'), desk('merton'), desk('hilibrand')]).map(d => d.id), ['hilibrand', 'mullins', 'merton']);
  assert.equal(partnerName('rosenfeld-02'), 'Rosenfeld II', "one rule: a number on the end is always a numeral");

  const long = truncate('word '.repeat(60), 140);
  assert.equal(long.truncated, true);
  assert.ok(long.text.length <= 141 && long.text.endsWith('…'));
  assert.equal(long.full.length, 299);
  assert.deepEqual(truncate('short thought'), { text: 'short thought', full: 'short thought', truncated: false });

  assert.equal(money('1234567.891'), '$1,234,567.89');
  assert.equal(money('50000', 0), '$50,000');
  assert.equal(money('-0.005'), '−$0.01');
  assert.equal(money(null), '—');
  assert.equal(signedMoney('250.25', 0), '+$250');
  assert.equal(signedMoney('-250.25', 0), '−$250');
  assert.equal(signedMoney('0', 0), '$0');
  assert.equal(percent('-2.5'), '−2.50%');
  assert.equal(streamUrl(['all'], { protocol: 'https:', host: 'blakewoods.us' }), 'wss://blakewoods.us/api/capital/stream');
  assert.equal(streamUrl(['desk:merton', 'ledger:merton'], { protocol: 'http:', host: 'localhost:4173' }), 'ws://localhost:4173/api/capital/stream?streams=desk%3Amerton%2Cledger%3Amerton');
});

const SECTION_IDS = ['masthead', 'live', 'performance', 'positions', 'improvement'];
test('the page carries five sections in order, two numbers, the disclosure, no link and no external script', async () => {
  const source = await readFile(new URL('../capital/capital.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|localStorage|sessionStorage|sendBeacon|document\.write/);
  assert.doesNotMatch(source, /createElement\('a'\)|element\('a'|\/capital\/desk|github\.com/, 'the script builds no link');
  const floorHtml = await readFile(new URL('../capital/index.html', import.meta.url), 'utf8');
  assert.match(floorHtml, /<title>Long-Term Capital Management<\/title>/);
  assert.match(floorHtml, /<h1 id="title">Long-Term Capital Management<\/h1>/);
  assert.doesNotMatch(floorHtml, /http:\/\/|<script(?![^>]*type="module" *>)[^>]*>(?!\s*<\/script>)/);
  assert.doesNotMatch(floorHtml, /\/portfolio\//);
  assert.match(floorHtml, /data-capital="floor"/);
  assert.match(floorHtml, /AI agents trade real money on Kalshi and Alpaca and rewrite themselves from every result\./);
  // No hyperlink at all: not to the home page, the repository, a desk page or a skip target.
  // Exactly two links, both in the header: the owner's site on the left, the repository on the right.
  const anchors = [...floorHtml.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(match => [match[1], match[2]]);
  // The repository opens in a new tab, without handing the new page a reference to this one; the owner's site opens in place.
  assert.match(floorHtml, /<a href="https:\/\/github\.com\/bwoods1998\/long-term-capital-management" target="_blank" rel="noopener noreferrer">/);
  assert.match(floorHtml, /<a href="\/">Blake Woods<\/a>/);
  assert.deepEqual(anchors, [['/', 'Blake Woods'], ['https://github.com/bwoods1998/long-term-capital-management', 'GitHub ↗']]);
  assert.equal((floorHtml.match(/<a[\s>]/gi) || []).length, 2);
  assert.ok(floorHtml.indexOf('<a ') > floorHtml.indexOf('<header class="navigation">') && floorHtml.lastIndexOf('<a ') < floorHtml.indexOf('</header>'), 'both links sit in the header');
  assert.doesNotMatch(floorHtml.slice(floorHtml.indexOf('<body')), /capital\/committee|capital\/desk/, 'no retired page is linked');
  // Exactly five sections, in the owner's order.
  assert.deepEqual([...floorHtml.matchAll(/<section id="([a-z-]+)"/g)].map(match => match[1]), SECTION_IDS);
  assert.equal((floorHtml.match(/<section\b/g) || []).length, SECTION_IDS.length);
  assert.deepEqual([...floorHtml.matchAll(/<h2 [^>]*>([^<]+)<\/h2>/g)].map(match => match[1]), ['Performance', 'Positions', 'The ladder']);
  // The live section's heading is the status itself: one dot and one word, red and "stopped" until the floor runs.
  assert.match(floorHtml, /<h2 id="live-title" class="live-heading"><span id="floor-status" class="live-status live-stopped" role="status"><span class="pulse"><\/span><span>stopped<\/span><\/span><\/h2>/);
  // One short caption says what moves an agent up the board.
  assert.match(floorHtml, /<h2 id="improvement-title">The ladder<\/h2><span>Evidence earns real capital\.<\/span>/);
  assert.deepEqual([...floorHtml.matchAll(/<h3 [^>]*>([^<]+)<\/h3>/g)].map(match => match[1]), ['Open', 'Closed']);
  const order = FLOOR_IDS.map(id => floorHtml.indexOf(`id="${id}"`));
  assert.ok(order.every((index, n) => index > 0 && (n === 0 || index > order[n - 1])), 'numbers, the live status and stream, the chart, the practice switch, open then closed positions, improvement');
  // One switch in the Positions heading governs both tables.
  assert.match(floorHtml, /<div class="section-heading"><h2 id="positions-title">Positions<\/h2><div id="floor-practice" class="practice-switch"><\/div><\/div>/);
  for (const [id, section] of [['floor-status', 'live'], ['floor-numbers', 'masthead'], ['floor-now', 'live'], ['floor-feed', 'live'], ['floor-portfolio', 'performance'],
    ['floor-practice', 'positions'], ['floor-positions', 'positions'], ['floor-closed', 'positions'], ['floor-improvement', 'improvement']]) {
    const start = floorHtml.indexOf(`<section id="${section}"`);
    const inside = floorHtml.slice(start, floorHtml.indexOf('</section>', start));
    assert.ok(inside.includes(`id="${id}"`), `${id} sits in ${section}`);
  }
  for (const gone of ['floor-arena', 'floor-leaders', 'floor-learning', 'closed-toggle', 'floor-economics', 'floor-run', 'floor-tape', 'floor-partners', 'floor-race', 'floor-lab']) {
    assert.doesNotMatch(floorHtml, new RegExp(`id="${gone}"`), `${gone} is gone from the floor`);
  }
  // Two numbers, no more.
  assert.deepEqual([...floorHtml.matchAll(/<dt>([^<]+)<\/dt>/g)].map(match => match[1]), ['Total profit', 'Running']);
  assert.doesNotMatch(floorHtml, /Sail|Portfolio<|arena|Who’s winning/i);
  // No footer: the owner removed the ownership and advice line on Sept 19, 2026.
  assert.doesNotMatch(floorHtml, /<footer|owns every position|investment advice/i);
  // The word budget: at most 40 static words above the live feed, 90 on the whole page.
  const staticWords = html => html.replace(/<[^>]+>/g, ' ').replace(/[—…$]/g, ' ').split(/\s+/).filter(word => /[A-Za-z]/.test(word));
  const aboveFeed = staticWords(floorHtml.slice(floorHtml.indexOf('<body'), floorHtml.indexOf('id="floor-feed"')));
  assert.ok(aboveFeed.length <= 40, `static words above the feed: ${aboveFeed.length}`);
  const whole = staticWords(floorHtml.slice(floorHtml.indexOf('<body')));
  assert.ok(whole.length <= 90, `static words on the page: ${whole.length}`);

  const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(home, /Long-Term Capital Management[\s\S]{0,400}AI partners trading real money in public, rewriting themselves from the results\./);
  assert.match(home, /href="\/capital\/"/);
  assert.doesNotMatch(home, /href="\/portfolio\/"|Portfolio Agent|Woods Capital/, 'the retired project leaves the home page');
});

test('the build publishes the floor with hashed, self-hosted assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ltcm-build-'));
  try {
    for (const name of ['build.mjs', 'package.json', 'index.html', 'styles.css', 'app.js', 'chart.js', 'favicon.svg', 'admin', 'capital']) {
      await cp(new URL('../' + name, import.meta.url), join(root, name), { recursive: true });
    }
    const build = () => spawnSync(process.execPath, ['build.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(build().status, 0);
    assert.deepEqual((await readdir(join(root, 'dist'))).sort(), ['_headers', 'admin', 'assets', 'capital', 'index.html']);
    assert.deepEqual((await readdir(join(root, 'dist/capital'))).sort(), ['index.html'], 'one page');
    const floorHtml = await readFile(join(root, 'dist/capital/index.html'), 'utf8');
    assert.match(floorHtml, /\.\.\/assets\/capital\.[a-f0-9]{12}\.css/);
    assert.match(floorHtml, /\.\.\/assets\/capital\.[a-f0-9]{12}\.js/);
    assert.equal((floorHtml.match(/<a[\s>]/gi) || []).length, 2, 'the built page keeps only the two header links');
    for (const page of ['dist/capital/index.html']) {
      const html = await readFile(join(root, page), 'utf8');
      const directory = join(root, page.slice(0, page.lastIndexOf('/')));
      for (const reference of html.matchAll(/(?:src|href)="((?:\.\.\/)+assets\/[^"]+)"/g)) assert(await readFile(join(directory, reference[1])));
      assert.doesNotMatch(html, /src="https?:/, 'no external scripts');
    }
    const bundle = await readFile(join(root, 'dist/assets/' + (await readdir(join(root, 'dist/assets'))).find(name => /^capital\.[a-f0-9]{12}\.js$/.test(name))), 'utf8');
    assert.match(bundle, /from '\.\/schema\.[a-f0-9]{12}\.js'/);
    assert.doesNotMatch(bundle, /from '\.\/schema\.js'/);
    const headers = await readFile(join(root, 'dist/_headers'), 'utf8');
    assert.match(headers, /\/capital\/\n  Cache-Control: public, max-age=0, must-revalidate, no-transform/);
    assert.doesNotMatch(headers, /\/capital\/desk/, 'the retired desk page leaves the header table');
    assert.match(headers, /connect-src 'self' wss:\/\/blakewoods\.us wss:\/\/www\.blakewoods\.us/);
    assert.doesNotMatch(headers, /\/portfolio/, 'the retired pages leave the header table');
    // A second build leaves no retired output behind.
    assert.equal(build().status, 0);
    assert.deepEqual((await readdir(join(root, 'dist'))).sort(), ['_headers', 'admin', 'assets', 'capital', 'index.html']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const published = (n, overrides) => ({ ...event(n, overrides), seq: n });
function markEvent(id, index) {
  return {
    seq: 100 + index, id: `ledger.${id}.mark.${index}`, stream: `ledger:${id}`, kind: 'ledger.mark',
    at: `2026-09-15T13:0${index}:00.000Z`, digest: (200 + index).toString(16).padStart(64, '0'),
    payload: { equity: String(50000 + index * 100), cash: '10000', daily_pnl: '100', as_of: `2026-09-15T13:0${index}:00.000Z`, positions: [{ instrument: 'MSFT', quantity: '20', price: '500', market_value: '10000' }] },
  };
}

test('the floor page mounts the two numbers, the partner thinking now, and a live feed of thinking, research and trades', async () => {
  const root = stubPage('floor', FLOOR_IDS);
  const board = [
    desk('mullins', { name: 'Mullins', family: 'kalshi', mode: 'live', venues: ['kalshi'], gate: null, live_session: liveSession({ session_id: 'mullins:s', trigger: 'cadence:14:00' }) }),
    desk('mullins-2', { name: 'Mullins II', family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', venues: ['kalshi'], gate: null }),
  ];
  const at = minute => `2026-09-15T14:${String(minute).padStart(2, '0')}:00.000Z`;
  const on = (seq, stream, kind, minute, payload) => ({ seq, id: `${stream}:${kind}:${seq}`, stream, kind, at: at(minute), digest: seq.toString(16).padStart(64, '0'), payload });
  const fed = { asset_class: 'event', symbol: 'KXFEDDECISION-26SEP-H25', market_id: 'KXFEDDECISION-26SEP-H25', venue: 'kalshi', right: 'yes' };
  const routes = {
    'desk.thought': [
      on(10, 'desk:mullins', 'desk.thought', 10, { session_id: 'mullins:s', text: '**Hold** the hike: CPI ran `hot`.' }),
      on(3, 'desk:mullins-2', 'desk.thought', 3, { session_id: 'mullins-2:s', text: 'word '.repeat(60).trim() }),
    ],
    'desk.tool_call': [
      on(12, 'desk:mullins', 'desk.tool_call', 12, { session_id: 'mullins:s', tool: 'propose_order', arguments: { side: 'buy', quantity: '10' } }),
      on(11, 'desk:mullins', 'desk.tool_call', 11, { session_id: 'mullins:s', tool: 'news', arguments: { query: 'FOMC', limit: 8 } }),
      on(9, 'desk:mullins-2', 'desk.tool_call', 9, { session_id: 'mullins-2:s', tool: 'event_markets', arguments: { query: 'KXFEDDECISION' } }),
      on(8, 'desk:mullins-2', 'desk.tool_call', 8, { session_id: 'mullins-2:s', tool: 'event_markets', arguments: { query: 'KXFEDDECISION' } }),
    ],
    'broker.fill': [
      on(13, 'broker:kalshi', 'broker.fill', 13, { desk_id: 'mullins', instrument: fed, side: 'buy', quantity: '10.00', price: '0.8800', fee: '0' }),
      on(6, 'broker:kalshi', 'broker.fill', 6, { desk_id: 'mullins-2', instrument: fed, side: 'sell', quantity: '10', price: '1', settlement: true, result: 'yes' }),
      on(5, 'broker:shadow', 'broker.fill', 5, { desk_id: 'mullins-2', instrument: { ...fed, symbol: 'KXBTC-26SEP1614-B75750', market_id: 'KXBTC-26SEP1614-B75750' }, side: 'buy', quantity: '58', price: '0.14', shadow: true }),
    ],
    'desk.outcome': [on(4, 'desk:mullins', 'desk.outcome', 4, { market_id: 'KXFEDDECISION-26SEP-H25', result: 'yes', pnl: '1.32', held_for_hours: '5.4', rationale_excerpt: 'Hike priced below the evidence.' })],
  };
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint({ desks: board, floor: accountFloor(), run: run(), infra: infra() });
    const kind = Object.keys(routes).find(name => path.includes(`kind=${name}&`));
    return { schema_version: 1, latest_seq: 13, events: kind ? routes[kind] : [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const numbers = root.querySelector('#floor-numbers');
    assert.equal(numbers.getAttribute('aria-busy'), 'false');
    assert.equal(numbers.withClass('number').length, 2);
    assert.match(numbers.textContent, /Total profit —/, 'legacy desk P&L is not owner-account profit');
    assert.match(numbers.textContent, /Running (?:\d+d \d+h|\d+h \d\dm \d\ds)/);
    assert.doesNotMatch(numbers.textContent, /Portfolio|Sail/);
    assert.equal(numbers.withClass('number-profit')[0].find('dd')[0].className, '');

    const now = root.querySelector('#floor-now');
    assert.equal(now.getAttribute('aria-busy'), 'false');
    const hero = now.withClass('now-thought')[0];
    assert.equal(hero.textContent, 'Hold the hike: CPI ran hot.', 'the newest thought, as prose');
    assert.match(now.textContent, /Mullins real money sat down for the 14:00 slot thinking now/);
    assert.match(now.withClass('now-research')[0].textContent, /researching reading news on “FOMC”/);
    assert.equal(now.withClass('now-name')[0].tag, 'span', 'the agent is named, not linked');

    const list = root.querySelector('#floor-feed');
    const lines = () => list.withClass('feed-line');
    assert.deepEqual(lines().map(line => line.withClass('feed-kind')[0].textContent), ['trading', 'researching', 'trading', 'trading', 'thinking']);
    assert.match(lines()[0].textContent, /Mullins bought 10 YES on Fed Sep · hike 25bp at 88¢/);
    assert.ok(!lines()[0].className.includes('line-practice'), 'real money is unmarked');
    assert.match(lines()[1].textContent, /Mullins II practice searching Kalshi for Fed decision markets ×2/, 'a desk repeating itself folds into one line');
    assert.match(lines()[2].textContent, /bought 58 YES on BTC \$75,750 bucket · Sep 16 2pm ET at 14¢/);
    assert.ok(lines()[2].className.includes('line-practice'));
    assert.match(lines()[3].textContent, /closed Fed Sep · hike 25bp, settled YES \+\$1\.32/);
    assert.equal(lines()[3].withClass('feed-pnl')[0].className, 'feed-pnl positive');
    assert.doesNotMatch(list.textContent, /propose|settlement|Hold the hike|FOMC/, 'orders, settlements and the hero’s own lines stay out of the feed');
    const thought = lines()[4].find('button')[0];
    assert.equal(thought.getAttribute('aria-expanded'), 'false');
    thought.click();
    assert.equal(lines()[4].find('button')[0].getAttribute('aria-expanded'), 'true', 'a long thought opens in place');
    // This checkpoint was published days ago, so the floor reads as stopped though polling is up.
    assert.match(root.querySelector('#floor-status').textContent, /^\s*stopped$/);
    assert.equal(root.querySelector('#floor-status').className, 'live-status live-stopped');
    assert.deepEqual(root.find('a'), [], 'the page draws no link');
  });

  // Nothing yet: the numbers wait, the live panel says when the next partner sits down.
  const quiet = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => (path.startsWith('/api/capital/checkpoint') ? checkpoint() : { schema_version: 1, latest_seq: 1, events: [] }), async () => {
    const feed = await startCapital(quiet);
    feed.stop();
    assert.match(words(quiet.querySelector('#floor-numbers')), /^Total profit — Running —$/);
    assert.match(quiet.querySelector('#floor-now').textContent, /No partner is in session\./);
    assert.match(quiet.querySelector('#floor-feed').textContent, /Quiet for now\./);
    assert.match(quiet.querySelector('#floor-positions').textContent, /No real-money position open\./);
    assert.match(quiet.querySelector('#floor-closed').textContent, /No trade has closed yet\./);
    assert.match(words(quiet.querySelector('#floor-improvement')), /1 competing.*Level unknown 1 Rosenfeld/, 'legacy desks do not acquire an invented level');
    assert.deepEqual(quiet.find('a'), []);
  });
});


test('a shadow desk is published and validated, strategies and working orders included', async () => {
  const { capital } = floor();
  // The runtime's own vocabulary, and the one it used before the rename.
  assert.equal(validDesk(desk('merton', { mode: 'shadow' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { mode: 'paper' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { mode: 'margin' }), '2026-09-15T14:05:00.000Z'), false);
  // Strategies: code the desk deployed to trade for it, with each one's record. Optional.
  const strategy = {
    name: 'hourly_ranges', house: true, cadence_seconds: 300, runs: 12, intents: 5, approved: 4, errors: 0,
    fills: 3, settled: 2, wins: 1, settled_pnl_usd: '-1.25', last_run_at: '2026-09-15T14:00:00.000Z', last_notes: '3 buckets with edge',
  };
  assert.equal(validDesk(desk('merton', { strategies: [strategy] }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { strategies: [] }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { strategies: [{ ...strategy, last_run_at: null, last_notes: '' }] }), '2026-09-15T14:05:00.000Z'), true);
  for (const [label, bad] of Object.entries({
    'a name that is not a module name': { ...strategy, name: 'Hourly Ranges' },
    'a note with markup': { ...strategy, last_notes: '<b>edge</b>' },
    'a run from the future': { ...strategy, last_run_at: '2026-09-15T15:05:00.000Z' },
    'a negative count': { ...strategy, fills: -1 },
    'an extra field': { ...strategy, extra: 'x' },
    'a missing field': Object.fromEntries(Object.entries(strategy).filter(([k]) => k !== 'wins')),
  })) assert.equal(validDesk(desk('merton', { strategies: [bad] }), '2026-09-15T14:05:00.000Z'), false, label);
  assert.equal(validDesk(desk('merton', { strategies: [strategy, strategy] }), '2026-09-15T14:05:00.000Z'), false, 'duplicate names');
  assert.equal(validDesk(desk('merton', { strategies: [{ ...strategy, note: 'promoted from merton-2: 14 settled, +0.120 per $', params: { min_edge: 0.01, window: '5m', symbols: ['BTC-USD'] } }] }), '2026-09-15T14:05:00.000Z'), true, 'a note and params ride along');
  assert.equal(validDesk(desk('merton', { strategies: [{ ...strategy, note: 'x'.repeat(201) }] }), '2026-09-15T14:05:00.000Z'), false, 'a note is 200 characters at most');
  assert.equal(validDesk(desk('merton', { strategies: [{ ...strategy, params: { note: '<b>' } }] }), '2026-09-15T14:05:00.000Z'), false, 'params are a safe payload');
  // Working orders: what the desk is bidding and offering now. Optional.
  const working = {
    order_id: 'ord-abc', instrument: { symbol: 'KXBTC-26SEP1602-B75750', asset_class: 'event', venue: 'kalshi', market_id: 'KXBTC-26SEP1602-B75750', right: 'no' },
    side: 'buy', quantity: '13', limit_price: '0.75', submitted_at: '2026-09-15T14:00:00.000Z', purpose: 'entry', strategy: 'hourly_quotes', intent_id: 'oi-1',
  };
  assert.equal(validDesk(desk('merton', { working: [working], budget_factor: '1.50' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { working: [{ ...working, limit_price: null, strategy: null, intent_id: null, submitted_at: null }] }), '2026-09-15T14:05:00.000Z'), true);
  for (const [label, bad] of Object.entries({
    'a side that is not buy or sell': { ...working, side: 'hold' },
    'a strategy name with spaces': { ...working, strategy: 'Hourly Quotes' },
    'an order from the future': { ...working, submitted_at: '2026-09-15T15:05:00.000Z' },
    'an extra field': { ...working, note: 'x' },
  })) assert.equal(validDesk(desk('merton', { working: [bad] }), '2026-09-15T14:05:00.000Z'), false, label);
  assert.equal(validDesk(desk('merton', { working: [working, working] }), '2026-09-15T14:05:00.000Z'), false, 'duplicate order ids');
  assert.equal(validDesk(desk('merton', { budget_factor: '0' }), '2026-09-15T14:05:00.000Z'), false, 'a zero budget factor');
  assert.equal(validDesk(desk('merton', { budget_factor: '11' }), '2026-09-15T14:05:00.000Z'), false, 'an absurd budget factor');
  assert.equal(validDesk(desk('merton', { strategies: Array.from({ length: 9 }, (_, i) => ({ ...strategy, name: `s${i}` })) }), '2026-09-15T14:05:00.000Z'), false, 'too many');
  assert.equal(deskMode('paper'), 'shadow');
  assert.equal(deskMode('live'), 'live');
  assert.equal(isLive({ mode: 'shadow' }), false);
  assert.equal(isLive({ mode: 'paper' }), false);
  assert.equal(isLive({ mode: 'live' }), true);

  // `shadow: true` is ordinary payload data on an order, a fill and a mark.
  const shadowed = kind => event(9, {
    id: `broker.shadow.${kind}`, stream: 'broker:shadow', kind: `broker.${kind}`,
    payload: { order_id: 'o1', intent_id: 'i1', status: 'filled', filled_quantity: '2', shadow: true },
  });
  for (const kind of ['order', 'fill']) assert.equal(validEvent(shadowed(kind)), true);
  const mark = event(10, {
    id: 'ledger.merton.mark.1', stream: 'ledger:merton', kind: 'ledger.mark',
    payload: { equity: '2000', cash: '2000', daily_pnl: '0', positions: [], as_of: '2026-09-15T14:00:00.000Z', shadow: true },
  });
  assert.equal(validEvent(mark), true);
  assert.equal((await post(capital, '/api/capital/events', batch(shadowed('order'), mark))).status, 200);
});

test('the floor block separates real equity from the desks competing for it', async () => {
  const { capital } = floor();
  const board = [
    desk('mullins', { mode: 'live', equity: '210.55', return_pct: '5.2' }),
    desk('merton', { mode: 'shadow', equity: '2000', return_pct: '3.5' }),
    desk('krasker', { mode: 'shadow', equity: '1000', return_pct: '-1' }),
  ];
  const body = checkpoint({
    desks: board,
    floor: {
      ...checkpoint().floor, equity: '210.55', daily_pnl: '-1.25',
      live_equity: '210.55', live_daily_pnl: '-1.25', live_desks: 1, shadow_desks: 2,
    },
  });
  assert.equal(validCheckpoint(body), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', body)).status, 200);
  // The counts are optional: an older checkpoint still publishes.
  assert.equal(validCheckpoint(checkpoint({ desks: board })), true);
  assert.doesNotMatch(mastheadNumbers(body).map(item => item.value).join(' '), /2,000|1,000/, 'a notional book never reaches the headline');

  for (const invalid of [
    checkpoint({ floor: { ...checkpoint().floor, live_equity: -5 } }),
    checkpoint({ floor: { ...checkpoint().floor, live_equity: '-5' } }),
    checkpoint({ floor: { ...checkpoint().floor, live_daily_pnl: 1.25 } }),
    checkpoint({ floor: { ...checkpoint().floor, shadow_desks: '2' } }),
    checkpoint({ floor: { ...checkpoint().floor, shadow_desks: -1 } }),
    checkpoint({ floor: { ...checkpoint().floor, live_notes: 'private' } }),
  ]) {
    assert.equal(validCheckpoint(invalid), false);
    assert.equal((await post(capital, '/api/capital/checkpoint', invalid)).status, 400);
  }
});

test('the infrastructure block is optional and typed', async () => {
  const { capital } = floor();
  assert.equal(validCheckpoint(checkpoint()), true, 'a checkpoint without infra still publishes');
  const body = checkpoint({ infra: infra() });
  assert.equal(validCheckpoint(body), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', body)).status, 200);
  assert.deepEqual(await (await get(capital, '/api/capital/checkpoint')).json(), body);
  assert.equal(validInfra({ host: 'local' }), true, 'host alone is enough');
  assert.equal(validInfra({ host: 'local', box_id: null, region: null, spend_usd: null, checkpoint_count: null }), true);

  for (const bad of [
    {}, { box_id: 'b' }, { host: '' }, { host: 'local', hostname: 'blake-macbook' },
    { host: 'local', checkpoint_count: '4' }, { host: 'local', checkpoint_count: -1 },
    { host: 'local', uptime_seconds: 1.5 }, { host: 'local', spend_usd: 4.21 },
    { host: 'local', spend_usd: '-1' }, { host: 'local', region: 'a'.repeat(200) },
  ]) {
    assert.equal(validInfra(bad), false, JSON.stringify(bad));
    assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint({ infra: bad, published_at: '2026-09-15T14:30:00.000Z' }))).status, 400);
  }
});

test('a desk may say when it next sits down, or that it never does', () => {
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('rosenfeld', { next_session_at: '2026-09-15T19:30:00.000Z' })] })), true);
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('rosenfeld', { next_session_at: null })] })), true);
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('rosenfeld', { next_session_at: 'soon' })] })), false);
});

test('a calibration record may be scored by generation, the curve\'s own unit', () => {
  const record = event(11, { stream: 'lab', kind: 'lab.calibration', payload: {
    scope: 'generation', desk_id: null, family: 'kalshi', generation: 1, n: 3, brier: '0.0825',
    reliability: [{ bin: '0.9-1.0', forecast_mean: '0.9300', outcome_rate: '1.0000', n: 1 }],
    as_of: '2026-09-15T23:59:59.999Z', since: '2026-09-15T20:00:00.000Z',
  } });
  assert.equal(validEvent(record), true);
  assert.equal(validEvent({ ...record, payload: { ...record.payload, scope: 'decade' } }), false);
});

test('positions and exit plans validate in the shapes the floor really publishes', () => {
  // A holding the floor could not tie to an intent carries null ids; a desk-initiated market
  // exit carries kind "desk" and no price yet; an instrument carries its venue fields.
  const holding = {
    instrument: { symbol: 'KXBTCD-26SEP15-T76000', asset_class: 'event', venue: 'kalshi' }, side: 'yes', quantity: '20',
    entry_price: '0.56', mark_price: '0.6', market_value: '12.0', unrealized_pnl: '0.8', opened_at: '2026-09-15T22:00:00.000Z',
    thesis: '', intent_id: null, session_id: null, target_price: null, stop_price: null, time_stop_at: null,
    exit_orders: [{ id: 'ord-2', kind: 'desk', price: null }, { id: 'ord-1', kind: 'target', price: '0.95' }],
  };
  assert.equal(validPosition(holding, '2026-09-15T23:00:00.000Z'), true);
  assert.equal(validPosition({ ...holding, exit_orders: [{ id: 'x', kind: 'panic', price: null }] }, '2026-09-15T23:00:00.000Z'), false);
  assert.equal(validPosition({ ...holding, intent_id: 7 }, '2026-09-15T23:00:00.000Z'), false);
  const plan = event(9, { kind: 'desk.exit_plan', payload: {
    intent_id: 'oi-abc', instrument: { asset_class: 'event', symbol: 'KXBTCD-26SEP15-T76000', venue: 'kalshi', multiplier: '1', expiry: null, strike: null, right: 'yes', market_id: 'KXBTCD-26SEP15-T76000', currency: 'USD' },
    target_price: '0.95', stop_price: '0.40', time_stop_at: '2026-09-17T23:00:00.000Z', venue_native: false, order_ids: [], entry_side: 'buy', quantity: '20',
  } });
  assert.equal(validEvent(plan), true);
  assert.equal(validEvent({ ...plan, payload: { ...plan.payload, entry_side: 'hold' } }), false);
  assert.equal(validEvent({ ...plan, payload: { ...plan.payload, instrument: { ...plan.payload.instrument, colour: 'red' } } }), false);
});

test('the runway spend policy is accepted, and refused when it is not arithmetic', () => {
  const runway = {
    spent_today_usd: '0.10', cap_usd: '269.82', mode: 'open', balance_usd: '279.82', spendable_usd: '269.82',
    runway_days: '385.4', burn_usd_per_day: '0.70', reserve_usd: '10', desk_fuse_usd: '67.45',
  };
  assert.equal(validBudget(runway), true);
  assert.equal(validCheckpoint(checkpoint({ budget: runway })), true);
  assert.equal(validBudget({ spent_today_usd: '4.21', cap_usd: '25' }), true, 'the capped policy still publishes');
  assert.equal(validBudget({ ...runway, mode: 'panic' }), false);
  assert.equal(validBudget({ ...runway, runway_days: 'soon' }), false);
  assert.equal(validBudget({ ...runway, balance_usd: null, runway_days: null, mode: 'unknown' }), true, 'an unread balance is null, not zero');
  assert.equal(validBudget({ ...runway, extra: '1' }), false);
});

test('the page says practice or shadow, never paper, and stills its motion on request', async () => {
  const html = await readFile(new URL('../capital/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /paper/i);
  const script = await readFile(new URL('../capital/capital.js', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /portfolio-agent|paper trad/i);
  const css = await readFile(new URL('../capital/capital.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.board-lane/);
  assert.doesNotMatch(css, /\.game-/, 'the rung ladder\'s styles are gone');
  for (const gone of ['ladder', 'rows-arena', 'rows-leaders', 'partners-grid', 'footer-links', 'skip-link']) assert.ok(!css.includes(`.${gone}`), `${gone} styles are gone`);
});

// ---------------------------------------------------------------- the owner's real balances
const venueRow = (name = 'kalshi', overrides = {}) => ({
  venue: name, equity: '492.29', cash: '492.29', as_of: '2026-09-15T14:00:00.000Z', ...overrides,
});
const COINBASE = { equity: '487.40', cash: '12.60' };
const accountFloor = (overrides = {}) => ({
  ...checkpoint().floor, account_equity: '979.69', account_cash: '504.89',
  venues: [venueRow(), venueRow('coinbase', COINBASE)], ...overrides,
});
// The account baseline was reset with the rebuild (Sept 19, 2026); these fixtures sit on the days after it.
const funding = (overrides = {}) => ({ start_at: PERFORMANCE_START_AT, start_equity: '976.11177639',
  net_flows: '0', verified_at: '2026-09-21T00:00:00.000Z', ...overrides });
function floorMark(index = 0, equity = '979.69', overrides = {}) {
  const at = `2026-09-15T13:0${index}:00.000Z`;
  return {
    seq: 300 + index, id: `ops.floor.mark.${index}`, stream: 'ops', kind: 'floor.mark', at,
    digest: (300 + index).toString(16).padStart(64, '0'),
    payload: {
      account_equity: equity, account_cash: '504.89', as_of: at,
      venues: [venueRow('kalshi', { as_of: at }), venueRow('coinbase', { ...COINBASE, as_of: at })],
    },
    ...overrides,
  };
}

test('the floor publishes its real venue balances, and only in one exact shape', async () => {
  const { capital } = floor();
  // floor.mark is the one kind whose name does not name its stream: it is the whole floor's.
  assert.equal(KIND_STREAMS['floor.mark'], 'ops');
  assert.equal(validEvent(floorMark()), true);
  assert.equal((await post(capital, '/api/capital/events', batch(floorMark()))).status, 200);
  const stale = floorMark(1, '979.69');
  stale.payload.venues[0].stale = true;
  assert.equal(validEvent(stale), true, 'a venue that stopped answering still publishes its last row');
  assert.equal((await post(capital, '/api/capital/events', batch(stale))).status, 200);

  assert.equal(validVenueBalance(venueRow()), true);
  assert.equal(validVenues([venueRow(), venueRow('coinbase', COINBASE)]), true);
  assert.equal(validVenues([]), false, 'no venue means no block, never an empty one');
  assert.equal(validVenues([venueRow(), venueRow()]), false, 'one row per venue');

  const broken = [
    ['off its stream', e => { e.stream = 'ledger:mullins'; }],
    ['on a desk stream', e => { e.stream = 'desk:mullins'; }],
    ['missing a field', e => { delete e.payload.account_cash; }],
    ['an extra field', e => { e.payload.note = 'read at noon'; }],
    ['a signed total', e => { e.payload.account_equity = '-1.00'; }],
    ['a numeric total', e => { e.payload.account_equity = 979.69; }],
    ['a stamp without milliseconds', e => { e.payload.as_of = '2026-09-15T13:00:00Z'; }],
    ['no venues at all', e => { e.payload.venues = []; }],
    ['a venue row missing its stamp', e => { delete e.payload.venues[0].as_of; }],
    ['an unnamed venue', e => { e.payload.venues[0].venue = 'Kalshi'; }],
    ['a signed venue balance', e => { e.payload.venues[0].equity = '-1'; }],
    ['a stale flag that is not a flag', e => { e.payload.venues[0].stale = 'yes'; }],
    ['an unknown venue field', e => { e.payload.venues[0].token = 'secret'; }],
    ['more venues than the floor can hold', e => { e.payload.venues = Array.from({ length: 9 }, (_, i) => venueRow(`venue-${i}`)); }],
  ];
  for (const [why, damage] of broken) {
    const event = floorMark(2);
    damage(event);
    assert.equal(validEvent(event), false, why);
    assert.equal((await post(capital, '/api/capital/events', batch(event))).status, 400, why);
  }
  // The exception is floor.mark's alone: every other kind still has to match its stream.
  assert.equal(validEvent({ ...event(), stream: 'ops', kind: 'ledger.mark' }), false);
});

test('the checkpoint carries the account balances beside the ledger, or not at all', async () => {
  const { capital } = floor();
  const body = checkpoint({ floor: accountFloor() });
  assert.equal(validCheckpoint(body), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', body)).status, 200);
  assert.equal(accountEquity(body.floor), '979.69');
  assert.deepEqual(accountVenues(body.floor).map(row => `${row.name} ${money(row.equity, 2)}`), ['Kalshi $492.29', 'Coinbase $487.40']);
  assert.equal(venueLabel('coinbase'), 'Coinbase');
  // A checkpoint from a box with no live venue says nothing about an account, and the page
  // falls back to the ledger's own number rather than showing a zero balance.
  assert.equal(accountEquity(checkpoint().floor), null);
  assert.deepEqual(accountVenues(checkpoint().floor), []);

  for (const invalid of [
    checkpoint({ floor: { ...checkpoint().floor, account_equity: '979.69' } }),
    checkpoint({ floor: accountFloor({ account_cash: undefined }) }),
    checkpoint({ floor: accountFloor({ account_equity: '-1' }) }),
    checkpoint({ floor: accountFloor({ venues: [] }) }),
    checkpoint({ floor: accountFloor({ venues: [venueRow('kalshi', { as_of: '2026-09-15T23:00:00.000Z' })] }) }),
    checkpoint({ floor: accountFloor({ venues: [venueRow('kalshi', { balance: '1' })] }) }),
  ]) {
    assert.equal(validCheckpoint(invalid), false);
    assert.equal((await post(capital, '/api/capital/checkpoint', invalid)).status, 400);
  }
});

test('all-time performance keeps the full balance history including transfers and losses', async () => {
  const marks = [floorMark(0, '950.00'), floorMark(1, '965.00'), floorMark(2, '979.69')]
    .map(event => ({ ...event, at: event.at.replace('2026-09-15', '2026-09-20') }));
  assert.equal(balanceSeries([marks[0]]), null, 'a line needs a second mark');
  const series = balanceSeries(marks);
  assert.equal(series.points.length, 3);
  assert.equal(series.changeText, '+$29.69');
  assert.equal(series.tone, 'positive');
  assert.equal(series.flowCut, false);
  assert.match(series.path, /^M0\.0,/);
  assert.ok(series.area.endsWith('Z'));
  // Show actual balances without guessing that a large move was a deposit or hiding a loss.
  const deposit = [floorMark(0, '497.21'), floorMark(1, '976.11'), floorMark(2, '960.15')];
  const afterDeposit = balanceSeries(deposit);
  assert.equal(afterDeposit.flowCut, false);
  assert.equal(afterDeposit.first.equity, 497.21);
  assert.equal(afterDeposit.changeText, '+$462.94');
  const loss = balanceSeries([floorMark(0, '1000'), floorMark(1, '700'), floorMark(2, '710')]);
  assert.equal(loss.first.equity, 1000, 'a loss must not reset the performance chart');
  assert.equal(loss.changeText, '−$290.00');
  // So is money leaving one venue, even when the total moves less.
  const venueMoved = (index, total, kalshi, coinbase) => floorMark(index, total, { payload: { account_equity: total, account_cash: '1', as_of: floorMark(index).at,
    venues: [venueRow('kalshi', { equity: kalshi, cash: kalshi, as_of: floorMark(index).at }), venueRow('coinbase', { equity: coinbase, cash: coinbase, as_of: floorMark(index).at })] } });
  const transfer = balanceSeries([venueMoved(0, '1000', '500', '500'), venueMoved(1, '900', '500', '400'), venueMoved(2, '905', '505', '400')]);
  assert.equal(transfer.points.length, 3, 'venue balance changes never discard earlier history');
  assert.equal(balanceSeries([]), null);

  const board = [desk('mullins', { name: 'Mullins', family: 'mullins', mode: 'live', equity: '210.55', gate: null })];
  const routes = (body, events) => path => {
    if (path.startsWith('/api/capital/checkpoint')) return body;
    if (path.includes('kind=floor.mark')) return { schema_version: 1, latest_seq: 302, events };
    return { schema_version: 1, latest_seq: 302, events: [] };
  };
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', routes(checkpoint({ published_at: '2026-09-21T00:00:00.000Z', desks: board, floor: accountFloor(), run: run({ sessions_today: 7 }) }), marks), async () => {
    const feed = await startCapital(root);
    feed.stop();
    const portfolio = root.querySelector('#floor-portfolio');
    assert.equal(portfolio.getAttribute('aria-busy'), 'false');
    assert.match(portfolio.withClass('venues')[0].textContent, /^Kalshi \$492\.29 Coinbase \$487\.40/, 'each account');
    assert.equal(portfolio.find('svg').length, 1, 'the balance line');
    assert.match(words(portfolio.withClass('balance-caption')[0]), /All tracked history · since .*\+\$29\.69 balance change · now \$979\.69/);
    assert.match(words(portfolio), /Profit unavailable until both balances and funding history are verified/);
    assert.match(root.querySelector('#floor-positions').textContent, /No real-money position open\. \$980 in cash across Kalshi and Coinbase\./);
    assert.match(root.querySelector('#floor-numbers').textContent, /Total profit —/, 'no profit figure before the funding history is verified');
  });

  // A venue that stopped answering keeps its last balance and says it is stale.
  const stale = stubPage('floor', FLOOR_IDS);
  const outage = accountFloor({ venues: [venueRow('kalshi', { stale: true }), venueRow('coinbase', COINBASE)] });
  await withBrowser('', routes(checkpoint({ desks: board, floor: outage }), []), async () => {
    const feed = await startCapital(stale);
    feed.stop();
    const accounts = stale.querySelector('#floor-portfolio').withClass('venues')[0];
    assert.match(accounts.textContent, /Kalshi \$492\.29 stale/, 'the stale account is still shown, and labelled');
    const [chip] = accounts.withClass('venue-stale');
    assert.match(chip.getAttribute('title'), /Kalshi did not answer the last balance request/);
    assert.equal(stale.querySelector('#floor-portfolio').find('svg').length, 0, 'no marks, no line');
  });
});

test('balance history survives tape retention and authenticated backfills do not replay live activity', async () => {
  const { capital, listen } = floor();
  const socket = listen(['all']);
  assert.equal((await post(capital, '/api/capital/history', batch(floorMark()), { auth: 'wrong' })).status, 401);
  assert.equal((await post(capital, '/api/capital/history', batch(event()))).status, 400);
  assert.equal((await post(capital, '/api/capital/events', batch(floorMark(1)))).status, 200);
  const cursor = capital.latest;
  const messages = socket.received.length;
  assert.equal((await post(capital, '/api/capital/history', batch(floorMark(0)))).status, 200);
  assert.equal(capital.latest, cursor);
  assert.equal(socket.received.length, messages);
  const replay = await post(capital, '/api/capital/history', batch(floorMark(0)));
  assert.deepEqual(await replay.json(), { stored: 0, replayed: 1 });
  const conflict = { ...floorMark(0), digest: 'b'.repeat(64) };
  assert.equal((await post(capital, '/api/capital/history', batch(floorMark(2), conflict))).status, 409);
  capital.sql.exec('DELETE FROM events');
  const history = await (await get(capital, '/api/capital/history')).json();
  assert.equal(history.total, 2, 'conflicting batch rolls back and tape retention leaves history intact');
  assert.equal(history.sampled, false);
  assert.deepEqual(history.points.map(point => point.at), [floorMark(0).at, floorMark(1).at]);
  const response = await get(capital, '/api/capital/history');
  assert.equal((await get(capital, '/api/capital/history', { 'If-None-Match': response.headers.get('etag') })).status, 304);
  assert.equal((await get(capital, '/api/capital/history?limit=1')).status, 400);
  // A later mark may void an earlier one (a venue read that missed a wallet): the chart leaves
  // the voided mark out, both stay archived, and the count of corrections is reported.
  const voiding = floorMark(3, '980.10', {});
  voiding.payload = { ...voiding.payload, voids: [floorMark(0).id], reason: 'Sept 18, 2026: the spot wallet alone was read while margin was held' };
  assert.equal((await post(capital, '/api/capital/history', batch(voiding))).status, 200);
  const corrected = await (await get(capital, '/api/capital/history')).json();
  assert.equal(corrected.total, 2, 'the voided mark is left out, the voiding mark counts');
  assert.equal(corrected.corrected, 1);
  assert.deepEqual(corrected.points.map(point => point.at), [floorMark(1).at, voiding.at]);
});

test('long-running chart history is bounded while retaining its first and last recorded values', async () => {
  const { capital } = floor();
  const total = MAX_HISTORY_POINTS * 3 + 17;
  for (let index = 0; index < total; index++) {
    const at = new Date(NOW + index * 300000).toISOString();
    capital.sql.exec('INSERT INTO floor_history (id, at, payload, digest) VALUES (?, ?, ?, ?)',
      `history-${index}`, at, JSON.stringify({ account_equity: String(1000 + index) }), 'a'.repeat(64));
  }
  const history = await (await get(capital, '/api/capital/history')).json();
  assert.equal(history.total, total);
  assert.equal(history.sampled, true);
  assert.ok(history.points.length <= MAX_HISTORY_POINTS);
  assert.equal(history.points[0].account_equity, '1000');
  assert.equal(history.points.at(-1).account_equity, String(1000 + total - 1));
});

test('upgrading an existing floor recovers its retained balance marks into durable history', async () => {
  const { capital } = floor();
  await post(capital, '/api/capital/events', batch(floorMark(0), floorMark(1)));
  capital.sql.exec('DELETE FROM floor_history'); // Simulate a tape written before the archive existed.
  const upgraded = new Capital(capital.ctx, capital.env, () => NOW);
  const history = await (await get(upgraded, '/api/capital/history')).json();
  assert.equal(history.total, 2);
  const restarted = new Capital(capital.ctx, capital.env, () => NOW);
  assert.equal((await (await get(restarted, '/api/capital/history')).json()).total, 2, 'migration is idempotent');
});

test('the floor chart loads archived marks older than the live tape', async () => {
  const root = stubPage('floor', FLOOR_IDS);
  const old = { at: PERFORMANCE_START_AT, account_equity: '500' };
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint({ published_at: '2026-09-21T00:00:00.000Z', floor: accountFloor() });
    if (path.startsWith('/api/capital/history')) return { schema_version: 1, total: 2, points: [old, { at: '2026-09-21T00:00:00.000Z', account_equity: '979.69' }] };
    return { schema_version: 1, latest_seq: 300, events: path.includes('kind=floor.mark') ? [floorMark()] : [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const portfolio = root.querySelector('#floor-portfolio');
    assert.match(words(portfolio.withClass('balance-caption')[0]), /All tracked history.*\+\$479\.69 balance change/);
    assert.match(portfolio.find('svg')[0].getAttribute('aria-label'), /\$500\.00 to \$979\.69/);
  });
});

test('performance starts at the complete-account boundary and never hides subsequent losses', () => {
  const point = (at, equity) => floorMark(0, equity, { at });
  const history = [
    point('2026-09-18T18:23:06.913Z', '979.61'),
    point('2026-09-19T04:47:46.709Z', '497.22'),
    point('2026-09-19T04:53:06.201Z', '504.54'),
    point(PERFORMANCE_START_AT, '976.11'),
    point('2026-09-19T05:05:01.805Z', '960.15'),
    point('2026-09-21T00:00:00.000Z', '450'),
  ];
  // The runtime's ltcm/config.json `account_performance.start_at`, to the millisecond.
  assert.equal(PERFORMANCE_START_AT, '2026-09-19T04:56:53.000Z');
  const series = performanceSeries(history);
  assert.equal(series.first.at, Date.parse(PERFORMANCE_START_AT));
  assert.equal(series.first.equity, 976.11);
  assert.equal(series.points.length, 3);
  assert.equal(series.last.equity, 450, 'even a later 50% loss stays visible');
  assert.equal(series.changeText, '−$526.11');
  assert.equal(history.length, 6, 'the original records are untouched');
  assert.equal(performanceSeries(history.slice(0, 3)), null);
});

test('owner profit, portfolio and chart share the same endpoint and funding basis', () => {
  const body = checkpoint({ published_at: '2026-09-21T00:00:00.000Z',
    floor: accountFloor({ account_equity: '918.54', performance: funding() }),
    run: run({ pnl_total_usd: '-98.93' }) });
  assert.equal(validCheckpoint(body), true);
  const marks = [floorMark(0, '976.11177639', { at: PERFORMANCE_START_AT }),
    floorMark(1, '917.69', { at: '2026-09-20T23:59:00.000Z' }),
    floorMark(2, '999', { at: '2026-09-21T00:01:00.000Z' })];
  const report = portfolioPerformance(body, marks);
  assert.equal(report.series.last.equity, 918.54, 'newer tape waits for the matching account checkpoint');
  assert.equal(report.profit, report.series.change);
  assert.equal(mastheadNumbers(body, 0, marks)[0].value, report.series.changeText);
  assert.equal(report.series.changeText, '−$57.57', 'desk ledger -98.93 never becomes headline profit');
  assert.equal(portfolioPerformance(body, marks.slice(1)).series.first.equity, 976.11177639,
    'archive sampling or temporary archive failure never rebases the opening mark');
  for (const flow of ['100', '-100']) {
    const moved = { ...body, floor: { ...body.floor, performance: funding({ net_flows: flow }) } };
    assert.equal(portfolioPerformance(moved, marks).profit, report.series.change - Number(flow));
    assert.equal(mastheadNumbers(moved, 0, marks)[0].note, '', 'cash flows do not produce a misleading simple percentage return');
  }
  for (const performance of [undefined, funding({ net_flows: null, verified_at: null }),
    funding({ verified_at: '2026-09-20T23:00:00.000Z' })]) {
    assert.equal(portfolioPerformance({ ...body, floor: { ...body.floor, performance } }, marks).profit, null);
  }
  const stale = { ...body, floor: { ...body.floor, venues: body.floor.venues.map(row => ({ ...row, stale: true })) } };
  assert.equal(portfolioPerformance(stale, marks).profit, null);
  assert.equal(balanceSeries([floorMark(0, null), floorMark(1, '10')]), null, 'null is never a zero-dollar mark');
});

test('performance metadata is strictly typed, bounded by the checkpoint, and public aggregates only', () => {
  const body = checkpoint({ published_at: '2026-09-21T00:00:00.000Z', floor: accountFloor({ performance: funding() }) });
  for (const performance of [funding({ net_flows: null, verified_at: null }), funding({ net_flows: '-123.45' })]) {
    assert.equal(validCheckpoint({ ...body, floor: { ...body.floor, performance } }), true);
  }
  for (const performance of [funding({ net_flows: 0 }), funding({ start_equity: '0' }),
    funding({ verified_at: null }), funding({ verified_at: '2026-09-22T00:00:00.000Z' }),
    funding({ private_transactions: [] }), funding({ net_flows: 'NaN' })]) {
    assert.equal(validCheckpoint({ ...body, floor: { ...body.floor, performance } }), false);
  }
});

// ------------------------------------------------------------------ contract v2: the leap
const position = (overrides = {}) => ({
  instrument: { symbol: 'BTC-USD', asset_class: 'crypto', venue: 'coinbase' }, side: 'long', quantity: '0.0100',
  entry_price: '76800.00', mark_price: '77210.50', market_value: '772.10', unrealized_pnl: '4.10', opened_at: '2026-09-15T13:00:00.000Z',
  thesis: 'Trend continuation on the daily bars; invalid under 75,500.', target_price: '80000', stop_price: '75500',
  time_stop_at: '2026-09-18T13:00:00.000Z', exit_orders: [{ id: 'o-tp', kind: 'target', price: '80000' }, { id: 'o-sl', kind: 'stop', price: '75500' }],
  ...overrides,
});
const mutation = (overrides = {}) => ({
  model_profile: 'pro_flex', reasoning_effort: 'high', session_shift_minutes: 45, memory_limit: 80,
  persona_trait: 'Prefers fewer, larger decisions and says so when the evidence is thin.', model_changed: false, ...overrides,
});
const liveSession = (overrides = {}) => ({ session_id: 'hilibrand:20260915-1400:cadence:14:00', trigger: 'cadence:14:00', started_at: '2026-09-15T14:00:00.000Z', ...overrides });
const experiment = (overrides = {}) => ({
  experiment_id: 'exp-0123456789ab', hypothesis: 'Mullins trades better with a slot before the close.', family: 'kalshi', parent_id: 'mullins',
  change: { 'cadence.sessions': ['08:10', '13:30', '16:30'], 'model.reasoning_effort': 'high' }, variant_desk_id: 'mullins-4', status: 'running',
  proposed_at: '2026-09-15T02:00:00.000Z', evaluate_after: '2026-09-18T02:00:00.000Z', ...overrides,
});
const curveRow = (generation, overrides = {}) => ({
  generation, desks: 2, decisions: 14, cost_usd: '1.20', pnl_usd: '12.50', cost_adjusted_excess_pct: '1.2', brier: '0.21', pnl_per_inference_usd: '10.4', ...overrides,
});
const lab = (overrides = {}) => ({ experiments: [experiment()], curve: [curveRow(1), curveRow(2, { cost_adjusted_excess_pct: '2.1', brier: '0.18' })], calibration: { n: 12, brier: '0.18' }, ...overrides });
const watch = (overrides = {}) => ({ triggers_today: 12, wakes_today: 3, last_trigger_at: '2026-09-15T14:02:00.000Z', cost_today_usd: '0.31', ...overrides });
const forecast = (overrides = {}) => ({
  id: 'mullins:20260915-1829:cadence:13:30:e0020', stream: 'desk:mullins', kind: 'desk.forecast', at: '2026-09-15T18:32:00.000Z', digest: 'd'.repeat(64),
  payload: { session_id: 'mullins:20260915-1829:cadence:13:30', market: 'KXFEDDECISION-26SEP-H25', venue: 'kalshi', probability: '0.93', market_price: '0.89', side: 'yes', resolves_at: '2026-09-16T18:00:00.000Z', reasoning: 'Reuters poll and a hot CPI; the market is a few cents shy of the evidence.' },
  ...overrides,
});
const exitPlan = (overrides = {}) => ({
  id: 'hilibrand:20260915-1830:cadence:18:30:e0030', stream: 'desk:hilibrand', kind: 'desk.exit_plan', at: '2026-09-15T18:40:00.000Z', digest: 'e'.repeat(64),
  payload: { intent_id: 'oi-abc123', instrument: { symbol: 'BTC-USD', asset_class: 'crypto', venue: 'coinbase' }, target_price: '80000', stop_price: '75500', time_stop_at: '2026-09-18T13:00:00.000Z', venue_native: true, order_ids: ['tp-1', 'sl-1'] },
  ...overrides,
});
const calibration = (overrides = {}) => ({
  id: 'lab:calibration:mullins:2026-09-15', stream: 'lab', kind: 'lab.calibration', at: '2026-09-15T21:00:00.000Z', digest: 'f'.repeat(64),
  payload: { scope: 'desk', desk_id: 'mullins', family: 'kalshi', generation: 1, n: 12, brier: '0.18',
    reliability: [{ bin: '0.8-0.9', forecast_mean: '0.86', outcome_rate: '0.83', n: 6 }, { bin: '0.9-1.0', forecast_mean: '0.93', outcome_rate: '1', n: 6 }],
    as_of: '2026-09-15T21:00:00.000Z', since: '2026-09-10T00:00:00.000Z' },
  ...overrides,
});

test('contract v2: forecasts, exit plans and calibration carry fixed shapes; the other new kinds publish free-form', async () => {
  const { capital } = floor();
  for (const kind of ['desk.watch', 'desk.forecast', 'desk.exit_plan', 'desk.code_run', 'lab.calibration', 'lab.experiment', 'lab.verdict']) {
    assert.ok(EVENT_KINDS[kind], kind);
  }
  assert.equal(validEvent(forecast()), true);
  assert.equal(validEvent(exitPlan()), true);
  assert.equal(validEvent(calibration()), true);
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(forecast(), exitPlan(), calibration()))).json(), { stored: 3, replayed: 0 });
  const refused = [
    ['a probability above one', forecast({ payload: { ...forecast().payload, probability: '1.2' } })],
    ['an unknown side', forecast({ payload: { ...forecast().payload, side: 'maybe' } })],
    ['a forecast with an extra field', forecast({ payload: { ...forecast().payload, confidence: 'high' } })],
    ['an exit plan without an instrument venue', exitPlan({ payload: { ...exitPlan().payload, instrument: { symbol: 'BTC-USD', asset_class: 'crypto' } } })],
    ['an exit plan whose bracket flag is a string', exitPlan({ payload: { ...exitPlan().payload, venue_native: 'yes' } })],
    ['calibration outside its scopes', calibration({ payload: { ...calibration().payload, scope: 'universe' } })],
    ['calibration with a rate above one', calibration({ payload: { ...calibration().payload, reliability: [{ bin: 'x', forecast_mean: '0.5', outcome_rate: '1.5', n: 1 }] } })],
    ['a forecast on the wrong stream', forecast({ stream: 'lab' })],
  ];
  for (const [label, candidate] of refused) {
    assert.equal(validEvent(candidate), false, label);
    assert.equal((await post(capital, '/api/capital/events', batch({ ...candidate, id: `${candidate.id}:${label.replace(/\W/g, '')}` }))).status, 400, label);
  }
  // Free-form kinds keep the ordinary payload rules and nothing more.
  const watchEvent = published(7, { id: 'hilibrand:watch:1', stream: 'desk:hilibrand', kind: 'desk.watch', payload: { trigger: 'price_move', detail: 'BTC fell 2.1% in an hour', decision: 'wake', reason: 'A held thesis is under its invalidation.', cost_usd: '0.0007' } });
  assert.equal(validEvent(watchEvent), true);
  assert.equal(validEvent(published(8, { id: 'lab:exp:1', stream: 'lab', kind: 'lab.experiment', payload: experiment() })), true);
  assert.equal(validEvent(published(9, { id: 'lab:verdict:1', stream: 'lab', kind: 'lab.verdict', payload: { experiment_id: 'exp-0123456789ab', status: 'adopted', evidence: {}, reason: 'Beat its parent on cost-adjusted return for four days.', as_of: '2026-09-19T02:00:00.000Z' } })), true);
  assert.equal(validEvent(published(10, { id: 'lab:exp:bad', stream: 'desk:mullins', kind: 'lab.experiment', payload: experiment() })), false, 'a lab kind stays on the lab stream');
});

test('the checkpoint carries positions, mutations, live sessions, the lab and the watch, or nothing at all', () => {
  const rich = checkpoint({
    desks: [desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', venues: ['coinbase'], positions: [position()], live_session: liveSession(), calibration: { n: 3, brier: '0.12', since: '2026-09-10T00:00:00.000Z' } }),
      desk('hilibrand-2', { name: 'Hilibrand II', family: 'crypto', generation: 2, parent_id: 'hilibrand', mode: 'shadow', venues: ['coinbase'], positions: [], mutation: mutation() })],
    lab: lab(), watch: watch(),
  });
  assert.equal(validCheckpoint(rich), true);
  assert.equal(validCheckpoint(checkpoint()), true, 'an older floor publishes none of it');
  assert.equal(validPosition(position(), '2026-09-15T14:05:00.000Z'), true);
  const badPositions = [
    ['an unknown side', position({ side: 'flat' })],
    ['an extra field', position({ leverage: '2' })],
    ['too many exit orders', position({ exit_orders: Array.from({ length: 9 }, (_, index) => ({ id: `o${index}`, kind: 'target', price: '1' })) })],
    ['an exit order of an unknown kind', position({ exit_orders: [{ id: 'o', kind: 'hope', price: '1' }] })],
    ['a P&L that is not a number', position({ unrealized_pnl: 'up' })],
    ['a thesis with markup', position({ thesis: '<b>buy</b>' })],
    ['opened after the checkpoint', position({ opened_at: '2026-09-15T15:00:00.000Z' })],
  ];
  for (const [label, candidate] of badPositions) assert.equal(validPosition(candidate, '2026-09-15T14:05:00.000Z'), false, label);
  assert.equal(validPosition(position({ thesis: '', target_price: null, stop_price: null, time_stop_at: null, exit_orders: [] }), '2026-09-15T14:05:00.000Z'), true, 'a bare position is still a position');
  assert.equal(validMutation(mutation()), true);
  assert.equal(validMutation(mutation({ session_shift_minutes: 5000 })), false);
  assert.equal(validMutation(mutation({ model_changed: 'no' })), false);
  assert.equal(validLiveSession(liveSession(), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validLiveSession(liveSession({ started_at: '2026-09-15T14:06:00.000Z' }), '2026-09-15T14:05:00.000Z'), false, 'a session cannot start after the checkpoint that reports it');
  assert.equal(validExperiment(experiment()), true);
  assert.equal(validExperiment(experiment({ verdict_reason: 'Beat its parent.' })), true);
  assert.equal(validExperiment(experiment({ experiment_id: 'exp-1' })), false);
  assert.equal(validExperiment(experiment({ status: 'maybe' })), false);
  assert.equal(validExperiment(experiment({ change: { _secret: 1 } })), false, 'no private keys in a change');
  assert.equal(validCurveRow(curveRow(3)), true);
  assert.equal(validCurveRow(curveRow(3, { brier: null })), true);
  assert.equal(validCurveRow(curveRow(3, { pnl_usd: 'lots' })), false);
  assert.equal(validLab(lab()), true);
  assert.equal(validLab(lab({ curve: [curveRow(1), curveRow(1)] })), false, 'one row per generation');
  assert.equal(validLab(lab({ experiments: [experiment(), experiment()] })), false, 'one row per experiment');
  assert.equal(validWatch(watch(), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validWatch(watch({ wakes_today: 13 }), '2026-09-15T14:05:00.000Z'), false, 'a desk cannot be woken more often than it was looked at');
  assert.equal(validWatch(watch({ last_trigger_at: null }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validCheckpoint(checkpoint({ lab: { experiments: [], curve: [] } })), false, 'the lab block is exact');
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('x', { positions: [position({ side: 'flat' })] })] })), false);
  assert.equal(validCalibration(calibration().payload), true);
  assert.equal(validCalibration({ ...calibration().payload, since: '2026-09-16T00:00:00.000Z' }), false, 'since cannot follow as_of');
});

test('positions list open (real money, then practice, tagged) and closed real-money trades with their reasons and no link; the ladder shows the roster', async () => {
  const root = stubPage('floor', FLOOR_IDS);
  const austin = position({
    instrument: { symbol: 'KXHIGHAUS-26SEP16-B100.5', asset_class: 'event', venue: 'kalshi' }, side: 'no', quantity: '23.00', entry_price: '0.4300', mark_price: '0.4350',
    market_value: '10.005000', unrealized_pnl: '0.115000', thesis: '[strategy daily_temps] Austin forecast high 101F (sigma 2.5F) against the 100° to 101° market settling in 24h: p=0.305, shrunk to 0.440 against the market’s 0.57; NO at 0.43 has 0.110 of edge after fees. Holds to settlement.',
  });
  const board = checkpoint({
    floor: accountFloor(), run: run(),
    desks: [
      desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', venues: ['coinbase'], return_pct: '1.2', pnl_usd: '4.10', capital_usd: '341.67', orders: 30, positions: [position(), position({ market_value: '0.12', instrument: { symbol: 'ETH-USD', asset_class: 'crypto', venue: 'coinbase' } })], live_session: liveSession() }),
      desk('hilibrand-2', { name: 'Hilibrand II', family: 'crypto', generation: 2, parent_id: 'hilibrand', mode: 'shadow', venues: ['coinbase'], return_pct: '0.4', pnl_usd: '1.00', capital_usd: '250', mutation: mutation(), positions: [position({ thesis: 'Shadow copy.' })] }),
      desk('haghani', { name: 'Haghani', family: 'weather', mode: 'live', venues: ['kalshi'], return_pct: '-20.6', pnl_usd: '-21.63', capital_usd: '104.93', positions: [austin] }),
      desk('haghani-2', { name: 'Haghani II', family: 'weather', generation: 2, parent_id: 'haghani', mode: 'shadow', venues: ['kalshi'], return_pct: '-2.6', pnl_usd: '-3.95', capital_usd: '150', positions: [austin] }),
    ],
    lab: lab({ experiments: [] }),
  });
  const outcome = (seq, id, pnl) => ({ seq, id: `outcome:${id}:${seq}`, stream: `desk:${id}`, kind: 'desk.outcome', at: `2026-09-15T13:${String(seq).padStart(2, '0')}:00.000Z`, digest: seq.toString(16).padStart(64, '0'),
    payload: { market_id: 'KXHIGHNY-26SEP15-B81.5', result: 'no', pnl, held_for_hours: 20, rationale_excerpt: '[strategy daily_temps] NYC forecast high 79F against the 81° to 82° market.' } });
  const outcomes = [outcome(20, 'haghani-2', '5.00'), ...Array.from({ length: 9 }, (_, n) => outcome(10 + n, 'haghani', n % 2 ? '1.00' : '-2.00'))];
  const spawned = { seq: 2, id: 'spawned:haghani-2', stream: 'evolution', kind: 'evolution.spawned', at: '2026-09-15T12:00:00.000Z', digest: '2'.repeat(64), payload: { desk_id: 'haghani-2', parent_id: 'haghani', family: 'weather', generation: 2, mutation: mutation() } };
  const trial = { seq: 3, id: 'lab:exp-1', stream: 'lab', kind: 'lab.experiment', at: '2026-09-15T12:00:00.000Z', digest: '3'.repeat(64), payload: experiment({ experiment_id: 'exp-000000000001' }) };
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return board;
    if (path.includes('kind=desk.outcome')) return { schema_version: 1, latest_seq: 20, events: outcomes };
    if (path.includes('stream=evolution')) return { schema_version: 1, latest_seq: 20, events: [spawned] };
    if (path.includes('kind=lab.experiment')) return { schema_version: 1, latest_seq: 20, events: [trial] };
    return { schema_version: 1, latest_seq: 20, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const positions = root.querySelector('#floor-positions');
    // Off on arrival: real money only, and nothing practice to count.
    assert.deepEqual(positions.find('tbody')[0].find('tr').map(row => row.find('td').slice(0, 5).map(words)), [
      ['Hilibrand', 'BTC', 'long', '$772.10', '+$4.10'],
      ['Haghani', 'Austin high 100–101°F · Sep 16', 'NO', '$10.01', '+$0.12'],
    ]);
    assert.equal(positions.withClass('record-line').length, 0);
    const toggle = () => root.querySelector('#floor-practice').find('button')[0];
    assert.equal(toggle().textContent, 'show practice trades');
    toggle().click();
    const rows = positions.find('tbody')[0].find('tr');
    assert.equal(rows.length, 4, 'real money first, then the practice books, dust left out');
    assert.deepEqual(rows.map(row => row.find('td').slice(0, 5).map(words)), [
      ['Hilibrand', 'BTC', 'long', '$772.10', '+$4.10'],
      ['Haghani', 'Austin high 100–101°F · Sep 16', 'NO', '$10.01', '+$0.12'],
      ['Hilibrand II practice', 'BTC', 'long', '$772.10', '+$4.10'],
      ['Haghani II practice', 'Austin high 100–101°F · Sep 16', 'NO', '$10.01', '+$0.12'],
    ]);
    // The closed table's own tag and tone, nothing new: real rows stay unmarked.
    assert.deepEqual(rows.map(row => [row.className, row.withClass('tag-practice').length]), [['', 0], ['', 0], ['row-practice', 1], ['row-practice', 1]]);
    assert.deepEqual(rows.map(row => row.withClass('tag-practice').map(tag => [tag.tag, tag.className, tag.textContent])).flat(), [['span', 'tag tag-practice', 'practice'], ['span', 'tag tag-practice', 'practice']]);
    assert.equal(words(positions.withClass('record-line')[0]), '2 real · 2 practice');
    assert.equal(positions.withClass('empty-state').length, 0, 'a book with real money open has no flat line');
    const why = rows[1].withClass('why-toggle')[0];
    assert.match(why.textContent, /^daily temps Austin forecast high 101F .*…$/);
    assert.equal(why.getAttribute('aria-expanded'), 'false');
    why.click();
    assert.equal(why.getAttribute('aria-expanded'), 'true');
    assert.match(why.textContent, /Holds to settlement\.$/, 'the whole thesis on demand');
    assert.deepEqual(positions.withClass('agent-name').map(node => node.tag), ['span', 'span', 'span', 'span'], 'agents are named in plain text');
    assert.match(words(rows[2].withClass('col-why')[0]), /^Shadow copy\.$/, 'a practice position says why as well');

    const closed = root.querySelector('#floor-closed');
    // The same switch shows the practice trades that closed, the newest first among the real ones.
    assert.match(words(closed.find('tbody')[0].find('tr')[0]), /^Haghani II practice NYC high 81–82°F · Sep 15 won \+\$5\.00/);
    toggle().click();
    assert.equal(toggle().getAttribute('aria-pressed'), 'false');
    assert.match(closed.withClass('record-line')[0].textContent, /9 real-money trades · 4 won · −\$6\.00/);
    assert.equal(closed.find('tbody')[0].find('tr').length, 8, 'eight rows by default');
    assert.doesNotMatch(closed.textContent, /Haghani II|practice/, 'real money only: no practice row and no toggle');
    assert.equal(closed.find('button').filter(button => button.getAttribute('aria-pressed') !== null).length, 0);
    const more = closed.withClass('more')[0];
    assert.equal(more.textContent, '1 more');
    more.click();
    const all = root.querySelector('#floor-closed').find('tbody')[0].find('tr');
    assert.equal(all.length, 9);
    assert.match(words(all[0]), /^Haghani NYC high 81–82°F · Sep 15 (?:won|lost) [+−]\$\d\.00 20h daily temps NYC forecast high 79F/, 'who, what, how it ended, and why');

    const improvement = root.querySelector('#floor-improvement');
    assert.equal(improvement.getAttribute('aria-busy'), 'false');
    assert.equal(improvement.withClass('board-lane').length, 4, 'three levels and the unknown');
    assert.equal(improvement.withClass('board-dot-unknown').length, 4);
    assert.match(words(improvement), /4 competing · 0 on real money/);
    assert.match(words(improvement), /Level unknown 4/, 'mode alone cannot prove an earned level');
    assert.equal(improvement.find('table').length, 0, 'a ladder, not another table');
    assert.deepEqual(root.find('a'), [], 'nothing on the page is a link');
  });
});

test('a floor that has published nothing says so in every section and keeps its two dashes', async () => {
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => (path.startsWith('/api/capital/events') ? { schema_version: 1, latest_seq: 0, events: [] } : null), async () => {
    const feed = await startCapital(root);
    feed.stop();
    assert.equal(root.querySelector('#floor-numbers').children.length, 0, 'the page’s own dashes stay');
    assert.equal(root.querySelector('#floor-numbers').getAttribute('aria-busy'), 'false');
    assert.equal(words(root.querySelector('#floor-now')), 'Nothing is running right now.');
    assert.equal(words(root.querySelector('#floor-portfolio')), 'No balance has been published yet.');
    assert.equal(words(root.querySelector('#floor-positions')), 'No position is open.');
    assert.equal(words(root.querySelector('#floor-closed')), 'No trade has closed yet.');
    assert.equal(words(root.querySelector('#floor-improvement')), 'Waiting for the agent roster.');
    // No checkpoint at all (the address answers 404): stopped, whatever the transport is doing.
    assert.match(root.querySelector('#floor-status').textContent, /^\s*stopped$/);
    assert.equal(root.querySelector('#floor-status').className, 'live-status live-stopped');
  });
});

test('when practice trades are all there is, the Positions switch shows them in both tables, off until asked', async () => {
  const root = stubPage('floor', FLOOR_IDS);
  const board = checkpoint({ floor: accountFloor(), desks: [desk('haghani-2', { name: 'Haghani II', family: 'weather', generation: 2, parent_id: 'haghani', mode: 'shadow', venues: ['kalshi'], orders: 0, gate: null,
    positions: [position({ thesis: 'Practice book. Watching the trend.' }), position({ market_value: '0.20' })] })] });
  const outcomes = [{ seq: 5, id: 'outcome:haghani-2:5', stream: 'desk:haghani-2', kind: 'desk.outcome', at: '2026-09-15T13:05:00.000Z', digest: '5'.repeat(64),
    payload: { market_id: 'KXHIGHNY-26SEP15-B81.5', result: 'no', pnl: '5.00', held_for_hours: 20, real_money: false, rationale_excerpt: 'NYC forecast high 79F against the 81° to 82° market.' } }];
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return board;
    return { schema_version: 1, latest_seq: 5, events: path.includes('kind=desk.outcome') ? outcomes : [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const closed = () => root.querySelector('#floor-closed');
    const open = () => root.querySelector('#floor-positions');
    const toggle = () => root.querySelector('#floor-practice').find('button');
    // Off on arrival: neither table lists a practice row, and neither table carries a button.
    assert.match(closed().textContent, /No real-money trade has closed yet\./);
    assert.equal(closed().find('table').length, 0);
    assert.equal(open().find('table').length, 0);
    assert.equal(words(open().withClass('empty-state')[0]), 'No real-money position open. $980 in cash across Kalshi and Coinbase.');
    assert.equal(closed().find('button').length + open().find('button').length, 0, 'the switch lives in the heading');
    assert.equal(toggle().length, 1, 'a single switch');
    assert.equal(toggle()[0].textContent, 'show practice trades');
    assert.equal(toggle()[0].getAttribute('aria-pressed'), 'false');
    assert.equal(toggle()[0].getAttribute('aria-controls'), 'floor-positions floor-closed', 'the ladder shows every agent whatever the switch says');
    toggle()[0].click();
    assert.match(words(closed().find('tbody')[0].find('tr')[0]), /^Haghani II practice NYC high 81–82°F · Sep 15 won \+\$5\.00 20h/);
    assert.equal(toggle()[0].getAttribute('aria-pressed'), 'true');
    assert.equal(toggle()[0].textContent, 'hide practice trades');
    assert.match(words(root.querySelector('#floor-improvement')), /1 competing.*Level unknown 1 Haghani II/);
    // An all-practice book, shown: the flat line says what the real accounts hold and announces the
    // practice rows under it; each row is tagged, and there is nothing mixed to count.
    assert.equal(words(open().withClass('empty-state')[0]), 'No real-money position open. $980 in cash across Kalshi and Coinbase. 1 practice position below.');
    const held = open().find('tbody')[0].find('tr');
    assert.deepEqual(held.map(row => [row.className, ...row.find('td').slice(0, 5).map(words)]), [['row-practice', 'Haghani II practice', 'BTC', 'long', '$772.10', '+$4.10']]);
    assert.equal(open().withClass('record-line').length, 0);
    // And off again, from either table's point of view.
    toggle()[0].click();
    assert.equal(open().find('table').length + closed().find('table').length, 0);
    assert.equal(toggle()[0].getAttribute('aria-pressed'), 'false');
  });
});

const run = (overrides = {}) => ({
  started_at: '2026-09-12T10:00:00.000Z', uptime_seconds: 93784, availability_7d_pct: '99.2', sessions_total: 412, sessions_today: 18, decisions_total: 57,
  sail_model_spend_today_usd: '3.10', sail_model_spend_total_usd: '41.20', sail_infra_spend_total_usd: '0.77', sail_spend_total_usd: '41.97',
  pnl_total_usd: '63.40', pnl_per_sail_dollar: '1.51', models_used: ['DeepSeek V4 Pro', 'Kimi K2.6', 'GLM-5.3'], ...overrides,
});

test('the run clock validates like the rest of the checkpoint', () => {
  assert.equal(validRun(run(), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validCheckpoint(checkpoint({ run: run() })), true);
  assert.equal(validCheckpoint(checkpoint()), true, 'an older floor publishes no run clock');
  const refused = [
    ['started after the checkpoint', run({ started_at: '2026-09-15T15:00:00.000Z' })],
    ['availability above 100', run({ availability_7d_pct: '101' })],
    ['more sessions today than ever', run({ sessions_today: 500 })],
    ['a P&L that is not a number', run({ pnl_total_usd: 'lots' })],
    ['too many models', run({ models_used: Array.from({ length: 9 }, (_, i) => `m${i}`) })],
    ['an extra field', run({ mood: 'good' })],
  ];
  for (const [label, candidate] of refused) assert.equal(validRun(candidate, '2026-09-15T14:05:00.000Z'), false, label);
  assert.equal(validRun(run({ availability_7d_pct: null, sail_infra_spend_total_usd: null, pnl_per_sail_dollar: null }), '2026-09-15T14:05:00.000Z'), true, 'unknowns are null, not guesses');

});

test('the floor’s helpers read as words: relative times, numerals, triggers, instruments, the flat line', () => {
  assert.equal(ago('2026-09-15T14:00:00.000Z', Date.parse('2026-09-15T14:00:30.000Z')), 'just now');
  assert.equal(ago('2026-09-15T14:00:00.000Z', Date.parse('2026-09-15T14:14:00.000Z')), '14 min ago');
  assert.equal(ago('2026-09-15T14:00:00.000Z', Date.parse('2026-09-15T16:30:00.000Z')), '2 h ago');
  assert.equal(ago('2026-09-12T14:00:00.000Z', Date.parse('2026-09-15T16:30:00.000Z')), '3 d ago');
  assert.equal(ago('nope'), '');
  assert.deepEqual([1, 2, 3, 4, 9].map(roman), ['I', 'II', 'III', 'IV', 'IX']);
  assert.equal(raceName(desk('mullins-2', { family: 'kalshi', generation: 2 })), 'Mullins II');
  assert.equal(raceName(desk('mullins', { family: 'kalshi' })), 'Mullins');

  assert.equal(triggerText('cadence:13:30'), 'sat down for the 13:30 slot');
  assert.equal(triggerText('watch:price_move'), 'woke on a price move');
  assert.equal(triggerText('event_resolution'), 'woke because a market resolved');
  assert.equal(triggerText('postmortem'), 'writing its post-mortem');
  assert.equal(triggerText(''), 'in session');
  assert.equal(instrumentLabel({ symbol: 'ETH-USD', asset_class: 'crypto', venue: 'coinbase' }), 'ETH-USD');
  assert.equal(instrumentLabel('MSFT'), 'MSFT');

  assert.equal(flatLine(checkpoint()), 'No real-money position open.');
  assert.equal(flatLine(checkpoint({ floor: accountFloor() })), 'No real-money position open. $980 in cash across Kalshi and Coinbase.');
  // Three accounts read as a list, not as a pair (Alpaca joined on Sept 19, 2026).
  const three = accountFloor({ venues: [venueRow(), venueRow('coinbase', COINBASE), venueRow('alpaca', { equity: '500.00', cash: '500.00' })], account_equity: '1479.69' });
  assert.equal(flatLine(checkpoint({ floor: three })), 'No real-money position open. $1,480 in cash across Kalshi, Coinbase and Alpaca.');

});

import { closedRows, quietLine, tapeOf, apiBase, titleCase, positionCounts, floorRunning, FLOOR_STALE_MS } from '../capital/capital.js';

test('the floor is running while its newest checkpoint is recent: the status follows the data', () => {
  const now = Date.parse('2026-09-20T13:30:00.000Z');
  const aged = ms => ({ published_at: new Date(now - ms).toISOString() });
  assert.equal(FLOOR_STALE_MS, 15 * 60 * 1000, 'fifteen of the runtime’s one-minute checkpoints');
  assert.equal(floorRunning(aged(0), now), true);
  assert.equal(floorRunning(aged(60 * 1000), now), true, 'the usual case: published a minute ago');
  assert.equal(floorRunning(aged(FLOOR_STALE_MS), now), true, 'the last instant of the window');
  assert.equal(floorRunning(aged(FLOOR_STALE_MS + 1), now), false);
  assert.equal(floorRunning(aged(16 * 60 * 1000), now), false, 'sixteen minutes without a checkpoint is a stopped floor');
  assert.equal(floorRunning(aged(4 * 24 * 60 * 60 * 1000), now), false);
  // A clock that is a little off: the worker accepts a checkpoint stamped up to a minute ahead.
  assert.equal(floorRunning(aged(-1000), now), true);
  assert.equal(floorRunning(aged(-60 * 1000), now), true);
  assert.equal(floorRunning(aged(-16 * 60 * 1000), now), false, 'further ahead than the window is not a time the page can read');
  // Nothing published, or nothing that reads as a time.
  for (const nothing of [null, undefined, {}, [], 'live', 7, true, { published_at: null }, { published_at: '' }, { published_at: 'this morning' },
    { published_at: Date.parse('2026-09-20T13:29:00.000Z') }, { published_at: {} }, { published_at: [] }]) {
    assert.equal(floorRunning(nothing, now), false, JSON.stringify(nothing) ?? 'undefined');
  }
  assert.equal(floorRunning(aged(0), NaN), false);
  // Without a second argument it is measured against the clock on the wall.
  assert.equal(floorRunning({ published_at: new Date().toISOString() }), true);
  assert.equal(floorRunning(checkpoint()), false, 'the fixture was published on Sept 15');
  assert.equal(floorRunning(checkpoint({ published_at: new Date(Date.now() - 60 * 1000).toISOString() })), true);
});

test('past trades name the desk, the market, the result and the reason', () => {
  const checkpoint = { desks: [
    { id: 'scholes', family: 'ranges', mode: 'live', generation: 1, equity: '150.00', capital_usd: '142', cost_usd: '2.00', return_pct: '0.0563', days_live: 2, orders: 42, strategies: [{ name: 'a' }], budget_factor: '1.50', next_session_at: '2026-09-16T08:05:00.000Z' },
    { id: 'scholes-2', family: 'ranges', mode: 'shadow', generation: 2, parent_id: 'scholes', equity: '140.00', capital_usd: '142', cost_usd: '1.00', return_pct: '-0.0141', days_live: 1, orders: 12, strategies: [] },
    { id: 'haghani', family: 'weather', mode: 'live', generation: 1, equity: '150.00', capital_usd: '150', cost_usd: '0', return_pct: '0', days_live: 1, live_session: liveSession() },
  ] };
  const events = [
    { id: 'o1', stream: 'desk:scholes', kind: 'desk.outcome', at: '2026-09-16T06:02:28.000Z', payload: { instrument: { symbol: 'ETH-USD', asset_class: 'event', venue: 'kalshi', market_id: 'KXETH-26SEP1602-B2397', right: 'no' }, market_id: 'KXETH-26SEP1602-B2397', result: 'no', entry_price: '0.79', exit_price: '1', quantity: '12', pnl: '2.52', held_for_hours: 1, rationale_excerpt: '[strategy hourly_quotes] Quote: ETH-USD spot 2,400; resting NO bid at 0.79' } },
    { id: 'o2', stream: 'desk:scholes-2', kind: 'desk.outcome', at: '2026-09-16T06:02:30.000Z', payload: { market_id: 'KXBTC-26SEP1602-B75750', result: 'yes', pnl: '-9.86', quantity: '58', rationale_excerpt: 'shadow bet' } },
    { id: 'o3', stream: 'desk:scholes', kind: 'desk.outcome', at: '2026-09-16T05:00:00.000Z', payload: { market_id: 'AAVE-USD', instrument: 'crypto:AAVE-USD:coinbase', result: 'sold', pnl: '-0.36030101621000', held_for_hours: '4.3', rationale_excerpt: 'Floor exit of oi-a470af373c967ca109d1c8338bc5860b: the mark reached the stop at 114.81. The plan was stated by the desk with its entry.' } },
    { id: 'x', stream: 'desk:scholes', kind: 'desk.thought', at: '2026-09-16T06:03:00.000Z', payload: { text: 'not an outcome' } },
  ];
  const rows = closedRows(events, checkpoint);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].desk, 'scholes-2', 'newest first');
  assert.deepEqual([rows[1].name, rows[1].live, rows[1].instrument, rows[1].right, rows[1].pnlText, rows[1].tone, rows[1].strategy, rows[1].held], ['Scholes', true, 'KXETH-26SEP1602-B2397', 'NO', '+$2.52', 'positive', 'hourly_quotes', 'held 1h']);
  assert.equal(rows[1].why, 'Quote: ETH-USD spot 2,400; resting NO bid at 0.79', 'the strategy prefix is lifted into its own field');
  assert.deepEqual([rows[1].market, rows[1].outcome, rows[1].settled, rows[1].heldText, rows[1].tag, rows[1].short], ['ETH $2,397 bucket · Sep 16 2am ET', 'won', 'settled NO', '1h', 'hourly quotes', 'Quote: ETH-USD spot 2,400; resting NO bid at 0.79']);
  assert.deepEqual([rows[0].name, rows[0].live, rows[0].outcome, rows[0].market], ['Scholes II', false, 'lost', 'BTC $75,750 bucket · Sep 16 2am ET']);
  assert.deepEqual([rows[2].market, rows[2].outcome, rows[2].pnlText, rows[2].heldText], ['AAVE', 'sold', '−$0.36', '4.3h']);
  assert.equal(rows[2].short, 'Floor exit: the mark reached the stop at 114.81.', 'an intent id is not a reason');
  assert.equal(closedRecord(rows), '2 real-money trades · 1 won · +$2.16');
  assert.equal(closedRecord(rows.filter(row => !row.live)), '');
  // A founder demoted to a shadow book keeps its real trades real; an outcome that says so wins.
  const demoted = { desks: checkpoint.desks.map(desk => desk.id === 'scholes' ? { ...desk, mode: 'shadow', parent_id: null } : desk) };
  const after = closedRows(events, demoted);
  assert.equal(after[1].live, true, 'a legacy outcome of a human founder stays real money after its demotion');
  const flagged = closedRows([{ ...events[0], payload: { ...events[0].payload, real_money: false } }], checkpoint);
  assert.equal(flagged[0].live, false, 'the recorded flag decides when present');

  assert.equal(validDesk(desk('merton', { pnl_usd: '-51.25' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { pnl_usd: 'lots' }), '2026-09-15T14:05:00.000Z'), false);

  const now = Date.parse('2026-09-16T07:35:00.000Z');
  assert.equal(quietLine(checkpoint, now), 'No partner is in session. Scholes sits down in 30 min. Their strategies keep quoting meanwhile.');
});

test('market tickers read as the thing they bet on, and anything unknown keeps its ticker', () => {
  const cases = [
    ['KXHIGHNY-26SEP16-B81.5', 'NYC high 81–82°F · Sep 16'],
    ['KXHIGHAUS-26SEP16-B100.5', 'Austin high 100–101°F · Sep 16'],
    ['KXHIGHCHI-26SEP16-B73.5', 'Chicago high 73–74°F · Sep 16'],
    ['KXHIGHMIA-26SEP17-B88.5', 'Miami high 88–89°F · Sep 17'],
    ['KXHIGHDEN-26SEP16-T86', 'Denver high 86°F line · Sep 16'],
    ['KXHIGHNY-26SEP16-T86', 'NYC high 86°F line · Sep 16'],
    ['KXHIGHLAX-26SEP16-B77.5', 'LA high 77–78°F · Sep 16'],
    ['KXHIGHPHIL-26SEP16-B70.5', 'Philadelphia high 70–71°F · Sep 16'],
    ['KXLOWTCHI-26SEP16-B55.5', 'Chicago low 55–56°F · Sep 16'],
    ['KXHIGHCHI-26SEP16', 'Chicago high · Sep 16'],
    ['KXHIGHXYZ-26SEP16-B70.5', 'XYZ high 70–71°F · Sep 16'],
    ['KXBTC-26SEP1600-B75950', 'BTC $75,950 bucket · Sep 16 12am ET'],
    ['KXBTC-26SEP1616-B75950', 'BTC $75,950 bucket · Sep 16 4pm ET'],
    ['KXETH-26SEP1601-B2397', 'ETH $2,397 bucket · Sep 16 1am ET'],
    ['KXBTCD-26SEP1617-T76000', 'BTC above $76,000 · Sep 16 5pm ET'],
    ['KXETHD-26SEP1612-T2400', 'ETH above $2,400 · Sep 16 12pm ET'],
    ['KXBTCD-26SEP15-T76000', 'BTC above $76,000 · Sep 15'],
    ['KXCPIYOY-26SEP-T3.5', 'CPI YoY above 3.5% · Sep'],
    ['KXFEDDECISION-26SEP-H25', 'Fed Sep · hike 25bp'],
    ['KXFEDDECISION-26SEP-C25', 'Fed Sep · cut 25bp'],
    ['KXFEDDECISION-26SEP-H0', 'Fed Sep · hold'],
    ['KXFEDDECISION-26SEP', 'Fed decision · Sep'],
    ['KXFED-26SEP-T3.75', 'Fed rate above 3.75% · Sep'],
    ['AAVE-USD', 'AAVE'],
    ['BTC-USD', 'BTC'],
    ['BTC/USD', 'BTC'],
    ['ETH/USDC', 'ETH'],
    ['SPY', 'SPY'],
    ['KXSOMETHING-26SEP16-Q1', 'KXSOMETHING-26SEP16-Q1'],
    ['KXBTC-26XYZ16-B1', 'KXBTC-26XYZ16-B1'],
    ['SPX', 'SPX'],
  ];
  for (const [ticker, title] of cases) assert.equal(marketTitle(ticker), title, ticker);
  assert.equal(marketTitle({ asset_class: 'event', symbol: 'KXHIGHAUS-26SEP16-B100.5', venue: 'kalshi' }), 'Austin high 100–101°F · Sep 16', 'an instrument object reads the same');
  assert.equal(marketTitle(null), '');
  assert.equal(seriesTitle('KXFEDDECISION'), 'Fed decision');
  assert.equal(seriesTitle('KXHIGHNY'), 'NYC high temperature');
  assert.equal(seriesTitle('KXBTCD'), 'BTC price');
  assert.equal(seriesTitle('KXNOPE'), '');

  assert.deepEqual(['23.00', '4.69', '0.087843', '0.00000164', '137.00', '0'].map(quantityText), ['23', '4.69', '0.0878', '0.00000164', '137', '0']);
  assert.deepEqual(['0.43', '0.005', '0.4350', '1'].map(centsText), ['43¢', '0.5¢', '43.5¢', '100¢']);
  assert.deepEqual([0.4, '4.3', 1, 30, 100, null, 'soon'].map(heldText), ['24m', '4.3h', '1h', '30h', '4d', '', '']);
  const thesis = thesisParts('[strategy daily_temps] Austin forecast high 101F (sigma 2.5F) against the 100° to 101° market settling in 24h: p=0.305, shrunk to 0.440. Holds to settlement.');
  assert.equal(thesis.tag, 'daily temps');
  assert.equal(thesis.short, 'Austin forecast high 101F (sigma 2.5F) against the 100° to 101° market settling in 24h: p=0.305,…');
  assert.ok(thesis.full.endsWith('Holds to settlement.') && thesis.more);
  assert.deepEqual(thesisParts('Short and done. Then more.'), { tag: '', short: 'Short and done.', full: 'Short and done. Then more.', more: true });
  assert.deepEqual(thesisParts(''), { tag: '', short: '', full: '', more: false });
  assert.equal(floorName('mullins-4'), 'Mullins IV', 'a known partner’s child reads with a numeral');
  assert.equal(floorName('haghani-2'), 'Haghani II');
  assert.equal(floorName('scholes'), 'Scholes');
  assert.equal(plainThought('**Hold** the `H25` line.\n\n## Next\nwait'), 'Hold the H25 line. Next wait');
});

test('the masthead reads two numbers, total profit and running, and the clock ticks in hours, minutes and seconds', () => {
  const now = Date.parse('2026-09-20T18:00:00.000Z');
  const body = checkpoint({ published_at: '2026-09-20T18:00:00.000Z', floor: accountFloor({ account_equity: '943.83', performance: funding({ verified_at: '2026-09-20T18:00:00.000Z' }) }), run: run({ started_at: '2026-09-19T18:11:00.000Z', pnl_total_usd: '-75.80', sail_spend_total_usd: '18.86', sail_model_spend_today_usd: '13.15', pnl_per_sail_dollar: '-4.01' }) });
  assert.deepEqual(mastheadNumbers(body, now).map(item => [item.label, item.value, item.tone, item.note || '', item.tick || '']), [
    ['Total profit', '−$32.28', 'negative', '−3.31%', ''],
    ['Running', '23h 49m', '', '', '00s'],
  ]);
  assert.equal(mastheadNumbers(body, now)[1].startedAt, Date.parse('2026-09-19T18:11:00.000Z'));
  const deposits = { ...body, floor: { ...body.floor, net_deposits: '1000' } };
  assert.equal(mastheadNumbers(deposits, now)[0].note, '−3.31%', 'internal desk funding never changes the account baseline');
  assert.deepEqual(mastheadNumbers(checkpoint(), now).map(item => item.value), ['—', '—'], 'no run, no guesses');
  // Honesty: a stale funding check or a venue that did not answer leaves a dash, never a guess.
  const stale = { ...body, floor: { ...body.floor, performance: funding({ verified_at: '2026-09-20T10:00:00.000Z' }) } };
  assert.equal(mastheadNumbers(stale, now)[0].value, '—', 'an unverified profit is not shown');
  assert.equal(mastheadNumbers(checkpoint({ run: run() }), now)[0].value, '—', 'the run’s own P&L claim is not the owner’s profit');
  assert.deepEqual(selfImprovingParts(42 * 60 + 5), { main: '42m', tick: '05s' });
  assert.deepEqual(selfImprovingParts(24 * 3600 + 12 * 60), { main: '24h 12m', tick: '00s' });
  assert.deepEqual(selfImprovingParts(5 * 86400), { main: '5d 0h', tick: '' });
  assert.deepEqual(selfImprovingParts(-1), { main: '—', tick: '' });
});

test('the live feed shows thinking, research and trades in plain words, folds repeats, and keeps the stage steady', () => {
  const live = new Set(['haghani', 'hilibrand']);
  let seq = 0;
  const ev = (kind, stream, payload, at = `2026-09-16T17:${String(10 + seq).padStart(2, '0')}:00.000Z`) => ({ seq: ++seq, id: `${kind}:${seq}`, kind, stream, at, payload });
  const call = (tool, args, desk = 'haghani-2') => feedLine(ev('desk.tool_call', `desk:${desk}`, { tool, arguments: args }), live);
  assert.equal(call('event_markets', { query: 'KXHIGHCHI-26SEP16-B73.5' }).text, 'searching Kalshi for Chicago high 73–74°F · Sep 16');
  assert.equal(call('event_markets', { query: 'Fed September' }).text, 'searching Kalshi for “Fed September”');
  assert.equal(call('event_markets', {}).text, 'browsing Kalshi markets');
  assert.equal(call('news', { query: 'Fed FOMC decision', limit: 8 }).text, 'reading news on “Fed FOMC decision”');
  assert.equal(call('weather_forecast', { city: 'Chicago' }).text, 'reading the NWS forecast for Chicago');
  assert.equal(call('calendar', {}).text, 'checking the economic calendar');
  assert.equal(call('memo_read', { title: 'FOMC day' }).text, 'rereading its memo “FOMC day”');
  assert.equal(call('memory_read', { query: 'KXFEDDECISION' }).text, 'recalling what it learned about Fed decision markets');
  assert.equal(call('outcomes', {}).text, 'reviewing how its past trades turned out');
  assert.equal(call('positions', {}).text, 'checking its open positions');
  assert.equal(call('run_code', { purpose: 'Compute bucket probability for Chicago high 73-74', code: 'print(1)' }).text, 'running code: compute bucket probability for Chicago high 73-74');
  assert.equal(call('strategy_report', { name: 'daily_temps' }).text, 'reading the report on its daily temps strategy');
  assert.equal(call('quote', { instrument: { asset_class: 'future', symbol: 'SPX' } }).text, 'checking the price of SPX');
  assert.equal(call('bars', { instrument: { asset_class: 'crypto', symbol: 'ETH-USD' }, interval: '1d', limit: 60 }).text, 'reading 60 daily ETH price bars');
  // The rebuilt runtime's research tools, in the same plain words.
  assert.equal(call('web_search', { query: 'bitcoin ETF flows this week' }).text, 'searching the web for “bitcoin ETF flows this week”');
  assert.equal(call('web_search', {}).text, 'searching the web');
  assert.equal(call('library_search', { query: 'Kalshi maker fees' }).text, 'searching the research library for “Kalshi maker fees”');
  assert.equal(call('library_search', {}).text, 'searching the research library');
  assert.equal(call('library_read', { title: 'Why favorites pay' }).text, 'reading “Why favorites pay” in the research library');
  assert.equal(call('library_read', {}).text, 'reading the research library');
  assert.equal(call('library_write', { title: 'Hourly BTC reversion, 30 days' }).text, 'writing up “Hourly BTC reversion, 30 days” for the library');
  assert.equal(call('library_write', {}).text, 'writing up its research for the library');
  assert.equal(call('replay', { purpose: 'z-entry 2.5 on 5-minute BTC bars' }).text, 'replaying “z-entry 2.5 on 5-minute BTC bars” against history');
  assert.equal(call('replay', {}).text, 'replaying a strategy against history');
  assert.equal(call('request_tool', { name: 'funding_rates' }).text, 'asking the architect for a tool: funding rates');
  assert.equal(call('request_tool', {}).text, 'asking the architect for a tool');
  assert.equal(call('playbook_read', { query: 'reversion' }).text, 'reading the graveyard playbook');
  assert.equal(call('playbook_read', {}).text, 'reading the graveyard playbook');
  assert.equal(call('web_search', { query: 'word '.repeat(40) }).text.length < 110, true, 'a long query is cut, like every quoted argument');
  assert.equal(call('web_search', { query: 'x' }, 'crypto-reversion-2').name, 'Crypto Reversion II');
  for (const tool of ['propose_order', 'cancel_order', 'memo', 'playbook_write', 'memory_write', 'record_forecast', 'end_session', 'mystery']) assert.equal(call(tool, { side: 'buy' }), null, tool);
  assert.equal(call('news', { query: 'x' }).practice, true, 'a shadow desk is practice');
  assert.equal(call('news', { query: 'x' }, 'haghani').practice, false);
  assert.equal(call('news', { query: 'x' }, 'haghani-2').name, 'Haghani II');

  const thought = feedLine(ev('desk.thought', 'desk:haghani', { text: '  **Buy** NO\n  here.  ' }), live);
  assert.deepEqual([thought.kind, thought.text, thought.name, thought.practice], ['thinking', 'Buy NO here.', 'Haghani', false]);
  assert.equal(feedLine(ev('desk.thought', 'desk:haghani', { text: '   ' }), live), null);

  const kalshi = { asset_class: 'event', market_id: 'KXHIGHAUS-26SEP16-B100.5', symbol: 'KXHIGHAUS-26SEP16-B100.5', venue: 'kalshi', right: 'no' };
  const fill = feedLine(ev('broker.fill', 'broker:kalshi', { desk_id: 'haghani', instrument: kalshi, side: 'buy', quantity: '23.00', price: '0.4300' }), live);
  assert.deepEqual([fill.kind, fill.text, fill.desk, fill.practice], ['trading', 'bought 23 NO on Austin high 100–101°F · Sep 16 at 43¢', 'haghani', false]);
  const coin = feedLine(ev('broker.fill', 'broker:shadow', { desk_id: 'hilibrand-2', instrument: { asset_class: 'crypto', symbol: 'AAVE-USD', venue: 'coinbase' }, side: 'buy', quantity: '0.087843', price: '113.62000000', shadow: true }), live);
  assert.deepEqual([coin.text, coin.practice], ['bought 0.0878 AAVE at $113.62', true]);
  assert.equal(feedLine(ev('broker.fill', 'broker:shadow', { desk_id: 'hilibrand', instrument: kalshi, side: 'buy', quantity: '1', price: '0.5', shadow: true }), live).practice, true, 'a shadow fill is practice whoever placed it');
  assert.equal(feedLine(ev('broker.fill', 'broker:shadow', { desk_id: 'settlement', instrument: kalshi, side: 'sell', quantity: '1', price: '0' }), live), null);
  assert.equal(feedLine(ev('broker.fill', 'broker:kalshi', { desk_id: 'scholes-4', instrument: kalshi, side: 'sell', quantity: '1', price: '0', settlement: true }), live), null);
  assert.equal(feedLine({ ...ev('broker.fill', 'broker:kalshi', { desk_id: 'haghani', instrument: kalshi, side: 'buy', quantity: '1', price: '0.48', note: 'reverses a fill recorded on the wrong side' }), id: 'fill:kalshi:x:reversal:3' }, live), null);
  const closed = feedLine(ev('desk.outcome', 'desk:hilibrand-4', { market_id: 'AAVE-USD', instrument: 'crypto:AAVE-USD:coinbase', result: 'sold', pnl: '-0.36030101621000' }), live);
  assert.deepEqual([closed.text, closed.pnl, closed.tone, closed.practice], ['closed AAVE, sold', '−$0.36', 'negative', true]);
  const settled = feedLine(ev('desk.outcome', 'desk:haghani', { market_id: 'KXHIGHAUS-26SEP16-B100.5', result: 'no', pnl: '4.12' }), live);
  assert.deepEqual([settled.text, settled.pnl, settled.tone], ['closed Austin high 100–101°F · Sep 16, settled NO', '+$4.12', 'positive']);
  for (const kind of ['desk.tool_result', 'ledger.mark', 'risk.decision', 'desk.code_run', 'ops.alert', 'ops.budget']) assert.equal(feedLine(ev(kind, 'desk:haghani', { text: 'x' }), live), null, kind);
  assert.deepEqual(FEED_KINDS, ['desk.thought', 'desk.tool_call', 'broker.fill', 'desk.outcome', 'lab.progress']);
  const progress = feedLine(ev('lab.progress', 'lab', { stage: 'test', message: 'Testing 12 candidates on Sail' }), live);
  assert.deepEqual([progress.kind, progress.name, progress.text, progress.practice], ['testing', 'Foundry', 'Testing 12 candidates on Sail', false]);
  assert.equal(feedLine(ev('lab.progress', 'lab', { stage: 'learn', message: 'No candidates qualified' }), live).kind, 'learning');
  const pulse = feedLine(ev('lab.progress', 'lab', { component: 'execution', stage: 'heartbeat', message: 'Coinbase: 0 real fills; 16 shadow strategies testing' }), live);
  assert.deepEqual([pulse.kind, pulse.name, pulse.desk, pulse.practice], ['monitoring', 'Execution', 'arena', false]);
  // The rebuilt runtime's loop speaks as the League; testing or learning is still said by `stage`.
  const league = stage => feedLine(ev('lab.progress', 'lab', { component: 'league', stage, message: 'Replayed 3 variants of crypto-reversion' }), live);
  assert.deepEqual([league('test').kind, league('test').name, league('test').desk, league('test').practice], ['testing', 'League', 'league', false]);
  assert.deepEqual([league('learn').kind, league('learn').name, league('learn').desk], ['learning', 'League', 'league']);
  assert.deepEqual([league('heartbeat').kind, league(undefined).kind], ['testing', 'testing']);
  assert.equal(feedLine(ev('lab.progress', 'lab', { component: 'league', stage: 'test', message: '  ' }), live), null);
  assert.deepEqual([progress.desk, feedLine(ev('lab.progress', 'lab', { component: 'foundry', stage: 'test', message: 'x' }), live).name], ['foundry', 'Foundry'], 'any other component keeps the old speaker');
  assert.equal(validDesk(desk('merton', { equity: '-5', cash: '-10' }), '2026-09-15T14:05:00.000Z'), true, 'signed sleeve balances are honest');
  assert.ok(Object.keys(RESEARCH).every(tool => !['propose_order', 'cancel_order', 'memo', 'playbook_write'].includes(tool)));

  // Newest first; a desk repeating itself, numbers aside, folds into one line with a count.
  seq = 0;
  const events = [
    ev('desk.tool_call', 'desk:haghani-2', { tool: 'event_markets', arguments: { query: 'KXHIGHCHI-26SEP16-B71.5' } }),
    ev('desk.tool_call', 'desk:haghani-2', { tool: 'event_markets', arguments: { query: 'KXHIGHCHI-26SEP16-B73.5' } }),
    ev('desk.thought', 'desk:haghani', { text: 'Different desk in between.' }),
    ev('desk.tool_call', 'desk:haghani-2', { tool: 'event_markets', arguments: { query: 'KXHIGHCHI-26SEP16-B75.5' } }),
    ev('desk.tool_call', 'desk:haghani-2', { tool: 'propose_order', arguments: {} }),
    ev('desk.thought', 'desk:haghani-2', { text: 'Now propose orders.' }),
  ];
  const lines = feedLines([...events].reverse(), live);
  assert.deepEqual(lines.map(line => [line.name, line.kind, line.count]), [['Haghani II', 'thinking', 1], ['Haghani II', 'researching', 3], ['Haghani', 'thinking', 1]]);
  assert.equal(lines[1].text, 'searching Kalshi for Chicago high 75–76°F · Sep 16', 'the newest of the repeats is the one shown');
  assert.equal(feedLines(events, live, { limit: 2 }).length, 2);
  assert.deepEqual(feedLines(events, live, { skip: [events[5].id] }).map(line => line.kind), ['researching', 'thinking'], 'the thought on stage is not repeated below it');
  assert.deepEqual(feedLines([], live), []);

  // The stage: the newest thought, unless the desk already on it spoke within the hold.
  const think = (desk, minute, text, session = `${desk}:s`) => ({ seq: minute * 100, id: `${desk}:${minute}`, kind: 'desk.thought', stream: `desk:${desk}`, at: `2026-09-16T17:00:${String(minute).padStart(2, '0')}.000Z`, payload: { session_id: session, text } });
  const stage = [think('haghani-2', 10, 'first'), think('mullins', 30, 'newer'), { seq: 1100, id: 'r', kind: 'desk.tool_call', stream: 'desk:haghani-2', at: '2026-09-16T17:00:11.000Z', payload: { session_id: 'haghani-2:s', tool: 'weather_forecast', arguments: { city: 'Chicago' } } }];
  assert.deepEqual(pick(heroThought(stage)), ['mullins', 'newer', '']);
  assert.deepEqual(pick(heroThought(stage, 'haghani-2')), ['haghani-2', 'first', 'reading the NWS forecast for Chicago'], 'a desk mid-thought keeps the stage');
  assert.equal(heroThought(stage, 'haghani-2', { holdMs: 5000 }).desk, 'mullins', 'but not past the hold');
  const ended = [...stage, { seq: 1200, id: 'end', kind: 'desk.session_ended', stream: 'desk:haghani-2', at: '2026-09-16T17:00:12.000Z', payload: {} }];
  assert.equal(heroThought(ended, 'haghani-2').desk, 'mullins', 'a desk whose session ended gives up the stage');
  assert.equal(heroThought([]), null);
  function pick(hero) { return [hero.desk, hero.text, hero.research]; }
});

test('open positions list real money then practice, skip dust and count each', () => {
  const board = checkpoint({ desks: [
    desk('haghani', { name: 'Haghani', family: 'weather', mode: 'live', return_pct: '-20.6', pnl_usd: '-21.63', capital_usd: '104.93', positions: [
      position({ instrument: { symbol: 'KXHIGHNY-26SEP16-B77.5', asset_class: 'event', venue: 'kalshi' }, side: 'no', market_value: '7.98', unrealized_pnl: '-11.780000', thesis: '' }),
      position({ instrument: { symbol: 'KXHIGHMIA-26SEP16-B90.5', asset_class: 'event', venue: 'kalshi' }, side: 'long', market_value: '18.9', unrealized_pnl: '9.03' }),
      position({ market_value: '0.49' }),
    ] }),
    desk('haghani-2', { name: 'Haghani II', family: 'weather', generation: 2, parent_id: 'haghani', mode: 'shadow', return_pct: '-2.63', pnl_usd: '-3.94', capital_usd: '150', positions: [position(), position()] }),
    desk('haghani-3', { name: 'Haghani III', family: 'weather', generation: 3, parent_id: 'haghani', mode: 'shadow', return_pct: '-22.1', pnl_usd: '-33.19', capital_usd: '150', positions: [
      position({ market_value: '0.30' }), position({ instrument: { symbol: 'ETH-USD', asset_class: 'crypto', venue: 'coinbase' }, market_value: '900.00', unrealized_pnl: '-3.00', thesis: '' }),
    ] }),
    desk('mullins', { family: 'kalshi', mode: 'live', return_pct: '0', pnl_usd: '0', capital_usd: '300' }),
    desk('mullins-2', { family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', return_pct: '-0.0671', pnl_usd: '-0.33', capital_usd: '492', status: 'retired' }),
  ], lab: lab({ experiments: [experiment()] }) });
  const book = openPositionRows(board);
  // Real money leads, by value; the practice books follow, by value, whatever they are worth.
  assert.deepEqual(book.rows.map(row => [row.name, row.live, row.market, row.side, row.valueText, row.pnlText, row.tone]), [
    ['Haghani', true, 'Miami high 90–91°F · Sep 16', 'YES', '$18.90', '+$9.03', 'positive'],
    ['Haghani', true, 'NYC high 77–78°F · Sep 16', 'NO', '$7.98', '−$11.78', 'negative'],
    ['Haghani III', false, 'ETH', 'long', '$900.00', '−$3.00', 'negative'],
    ['Haghani II', false, 'BTC', 'long', '$772.10', '+$4.10', 'positive'],
    ['Haghani II', false, 'BTC', 'long', '$772.10', '+$4.10', 'positive'],
  ]);
  assert.deepEqual([book.real, book.practice, book.dust], [2, 3, 2], 'dust is dust on either book');
  assert.equal(positionCounts(book), '2 real · 3 practice');
  assert.deepEqual(openPositionRows(checkpoint()), { rows: [], real: 0, practice: 0, dust: 0 });
  assert.equal(positionCounts(openPositionRows(checkpoint())), '');
  // One kind of book needs no count: real rows are untagged, and the flat line announces practice.
  const practiceOnly = openPositionRows(checkpoint({ desks: board.desks.filter(row => row.mode !== 'live') }));
  assert.deepEqual([practiceOnly.real, practiceOnly.practice, practiceOnly.rows.every(row => row.live === false), positionCounts(practiceOnly)], [0, 3, true, '']);
  const realOnly = openPositionRows(checkpoint({ desks: board.desks.filter(row => row.mode === 'live') }));
  assert.deepEqual([realOnly.real, realOnly.practice, positionCounts(realOnly)], [2, 0, '']);
  assert.equal(flatLine(checkpoint({ floor: accountFloor() }), 3), 'No real-money position open. $980 in cash across Kalshi and Coinbase. 3 practice positions below.');
  assert.equal(flatLine(checkpoint(), 1), 'No real-money position open. 1 practice position below.');
  assert.equal(flatLine(checkpoint(), 0), 'No real-money position open.');

});

// ------------------------------------------------------------ the rebuilt runtime's agents
test('an agent named by slug reads as its words in the feed and both tables, and unknown desks keep their published order', () => {
  assert.equal(titleCase('crypto-reversion-2'), 'Crypto Reversion 2', 'titleCase itself only spells a slug out');
  // One rule for every name on the page: a number on the end is a numeral, whatever precedes it.
  for (const [id, name] of [['favorites-maker', 'Favorites Maker'], ['crypto-reversion', 'Crypto Reversion'], ['crypto-reversion-2', 'Crypto Reversion II'],
    ['momentum-2', 'Momentum II'], ['x9', 'X9'], ['kalshi-hour-favorites-12', 'Kalshi Hour Favorites XII']]) {
    assert.equal(floorName(id), name, id);
    assert.equal(partnerName(id), name, id);
  }
  // The first run's partners still read with their generation as a numeral.
  assert.deepEqual(['mullins-4', 'scholes-2', 'haghani', 'hilibrand-3'].map(floorName), ['Mullins IV', 'Scholes II', 'Haghani', 'Hilibrand III']);

  // One name everywhere: it comes from the id, never from the generation. A third-generation agent
  // whose id is crypto-reversion-2 reads as II, the same in the race, the feed and both tables.
  const agent = (id, overrides = {}) => desk(id, { name: id, family: 'alpaca-hour-reversion', venues: ['alpaca'], gate: null, ...overrides });
  assert.equal(raceName(agent('crypto-reversion')), 'Crypto Reversion');
  assert.equal(raceName(agent('crypto-reversion-2', { generation: 3, parent_id: 'crypto-reversion' })), 'Crypto Reversion II');
  assert.equal(raceName(agent('meriwether-7', { generation: 2, parent_id: 'meriwether-3' })), 'Meriwether VII', 'a child takes the next number on its desk, not its generation');
  assert.equal(raceName(agent('trend', { name: 'Trend Follower', generation: 2, parent_id: 'crypto-reversion' })), 'Trend Follower', 'a name written for a reader is kept');
  assert.equal(partnerOf(agent('crypto-reversion-2')).variant, 'II');

  const board = checkpoint({ desks: [
    agent('zeta-maker', { mode: 'live', positions: [position({ market_value: '20.00', instrument: { symbol: 'BTC/USD', asset_class: 'crypto', venue: 'alpaca' } })] }),
    agent('crypto-reversion-2', { generation: 2, parent_id: 'crypto-reversion', mode: 'live', positions: [position({ market_value: '35.49', thesis: 'Two deviations under the mean. Out at the mean.' })] }),
    agent('alpha', { mode: 'shadow', positions: [position()] }),
    agent('crypto-reversion', { mode: 'live', next_session_at: '2026-09-15T14:20:00.000Z' }),
  ] });
  assert.equal(validCheckpoint(board), true);
  // No id is a founder and no family is a partner's: every rank ties, so the published order stands.
  assert.deepEqual(orderDesks(board.desks).map(row => row.id), ['zeta-maker', 'crypto-reversion-2', 'alpha', 'crypto-reversion']);
  assert.deepEqual(orderDesks([...board.desks].reverse()).map(row => row.id), ['crypto-reversion', 'alpha', 'crypto-reversion-2', 'zeta-maker']);
  assert.deepEqual(orderDesks([...board.desks, desk('mullins')]).map(row => row.id)[0], 'mullins', 'a founder still leads');
  const book = openPositionRows(board);
  assert.deepEqual(book.rows.map(row => [row.name, row.live, row.market, row.valueText, row.short]), [
    ['Crypto Reversion II', true, 'BTC', '$35.49', 'Two deviations under the mean.'],
    ['Zeta Maker', true, 'BTC', '$20.00', 'Trend continuation on the daily bars; invalid under 75,500.'],
    ['Alpha', false, 'BTC', '$772.10', 'Trend continuation on the daily bars; invalid under 75,500.'],
  ]);
  assert.equal(positionCounts(book), '2 real · 1 practice');
  assert.equal(quietLine(board, Date.parse('2026-09-15T14:05:00.000Z')), 'No partner is in session. Crypto Reversion sits down in 15 min. Their strategies keep quoting meanwhile.');

  // Closed rows: the recorded flag decides, with no founder to fall back on. An agent that has
  // died, or was promoted since, keeps the money its trade was really made with.
  const outcome = (n, id, payload) => ({ id: `o${n}`, stream: `desk:${id}`, kind: 'desk.outcome', at: `2026-09-15T13:0${n}:00.000Z`,
    payload: { market_id: 'KXBTCD-26SEP1513-T80999.99', result: 'yes', pnl: '0.14', held_for_hours: 0.8, rationale_excerpt: 'A favorite with an hour left.', ...payload } });
  const rows = closedRows([
    outcome(5, 'crypto-reversion-2', { real_money: true }), outcome(4, 'crypto-reversion-2', { real_money: false }),
    outcome(3, 'gone-agent', { real_money: true }), outcome(2, 'gone-agent', {}), outcome(1, 'alpha', { real_money: false }), outcome(0, 'zeta-maker', {}),
  ], board);
  assert.deepEqual(rows.map(row => [row.name, row.live]), [
    ['Crypto Reversion II', true], ['Crypto Reversion II', false], ['Gone Agent', true], ['Gone Agent', false], ['Alpha', false], ['Zeta Maker', true],
  ]);
  assert.equal(rows[0].market, 'BTC above $80,999.99 · Sep 15 1pm ET');
  assert.equal(closedRecord(rows), '3 real-money trades · 3 won · +$0.42');

  // The feed believes the same flag: a practice fill stays practice after its agent goes live.
  const live = new Set(['crypto-reversion-2']);
  const fill = (id, payload) => feedLine({ seq: 1, id: `fill:${id}`, kind: 'broker.fill', stream: 'broker:alpaca', at: '2026-09-15T13:00:00.000Z',
    payload: { desk_id: id, instrument: { symbol: 'BTC/USD', asset_class: 'crypto', venue: 'alpaca' }, side: 'buy', quantity: '0.000437', price: '80950.00', ...payload } }, live);
  assert.deepEqual([fill('crypto-reversion-2', { real_money: true }).text, fill('crypto-reversion-2', { real_money: true }).practice], ['bought 0.000437 BTC at $80,950.00', false]);
  assert.equal(fill('crypto-reversion-2', { real_money: false }).practice, true);
  assert.equal(fill('gone-agent', { real_money: true }).practice, false);
  assert.equal(fill('gone-agent', {}).practice, true, 'with no flag the desk’s mode today still decides');
  assert.equal(fill('crypto-reversion-2', { real_money: true, shadow: true }).practice, true, 'a shadow fill is never real');
});

// ---------------------------------------------------------------------------- the test tape
test('a test tape is read from its own API base, fetches and socket alike, and its status follows its checkpoints as the real floor’s does', async () => {
  // The same short list the worker routes by (schema.js TAPES): `test` and `canary`, nothing else.
  assert.deepEqual(TAPES, ['test', 'canary']);
  assert.equal(tapeOf('?tape=test'), 'test');
  assert.equal(tapeOf('?x=1&tape=canary'), 'canary');
  for (const search of ['', '?', '?tape=', '?tape=Test', '?tape=demo', '?tape=test-2', '?tape=a/b', '?tape=..', '?tape=constructor', `?tape=${'a'.repeat(25)}`, '?other=test', null, undefined, 7]) {
    assert.equal(tapeOf(search), null, String(search));
    assert.equal(apiBase(search), '/api/capital', String(search));
  }
  assert.equal(apiBase('?tape=canary'), '/api/capital/t/canary');
  assert.equal(streamUrl(['all'], { protocol: 'https:', host: 'blakewoods.us', search: '?tape=test' }), 'wss://blakewoods.us/api/capital/t/test/stream');
  assert.equal(streamUrl(['ops'], { protocol: 'http:', host: 'localhost:4173', search: '?tape=canary' }), 'ws://localhost:4173/api/capital/t/canary/stream?streams=ops');
  assert.equal(streamUrl(['all'], { protocol: 'https:', host: 'blakewoods.us', search: '?tape=NOPE' }), 'wss://blakewoods.us/api/capital/stream');

  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.listeners = {}; sockets.push(this); }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    close() {}
  }
  // `publishedAt` is when the floor last published: a function of the clock, or null for a floor
  // that has published nothing (its checkpoint address answers 404). `later` runs with the page
  // mounted and the socket open, and can publish again, move the clock, and run the page's own
  // 30-second refresh.
  const STOPPED = ['stopped', 'live-status live-stopped'];
  const CONNECTING = ['connecting', 'live-status live-idle'];
  const LIVE = ['live', 'live-status live-live'];
  const minutesAgo = minutes => () => new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const mount = async (search, publishedAt, later = null) => {
    const asked = [];
    const root = stubPage('floor', FLOOR_IDS);
    const wall = Date.now;
    const held = { at: publishedAt ? publishedAt() : null, down: false };
    try {
      await withBrowser(search, path => {
        asked.push(path);
        if (path.includes('/checkpoint')) return held.at && !held.down ? checkpoint({ published_at: held.at, floor: accountFloor(), run: run() }) : null;
        if (path.includes('/history')) return { schema_version: 1, total: 0, points: [] };
        return { schema_version: 1, latest_seq: 0, events: [] };
      }, async () => {
        globalThis.WebSocket = FakeSocket;
        const timers = [];
        globalThis.setInterval = (work, every) => { timers.push({ work, every }); return 0; };
        const feed = await startCapital(root);
        const status = root.querySelector('#floor-status');
        const read = () => [words(status), status.className];
        root.before = read();
        sockets.at(-1).listeners.open();
        root.after = read();
        if (later) {
          await later({
            read, word: () => status.children[1],
            publish(at) { held.at = at; held.down = false; },
            outage() { held.down = true; },
            clock(minutes) { Date.now = () => wall() + minutes * 60 * 1000; },
            // The page's own timer, not a new one: the refresh it already runs every 30 seconds.
            async refresh() {
              const every = timers.filter(timer => timer.every === 30000);
              assert.equal(every.length, 1, 'one 30-second refresh');
              assert.deepEqual(timers.map(timer => timer.every).sort((a, b) => a - b), [1000, 30000], 'the status adds no timer of its own');
              const before = asked.filter(path => path.includes('/checkpoint')).length;
              every[0].work();
              for (let turn = 0; turn < 500 && asked.filter(path => path.includes('/checkpoint')).length === before; turn += 1) await tick();
              for (let turn = 0; turn < 50; turn += 1) await tick();
            },
          });
        }
        feed.stop();
      });
    } finally { Date.now = wall; }
    return { root, asked };
  };

  const tape = await mount('?tape=test', minutesAgo(1));
  assert.ok(tape.asked.length >= 9, 'the checkpoint, the history and every event load');
  for (const path of tape.asked) assert.ok(path.startsWith('/api/capital/t/test/'), path);
  assert.deepEqual([...new Set(tape.asked.map(path => path.slice('/api/capital/t/test'.length).split('?')[0]))].sort(), ['/checkpoint', '/events', '/history']);
  assert.equal(sockets.at(-1).url, 'wss://blakewoods.us/api/capital/t/test/stream');
  // A tape whose publisher is running: the dot follows the transport.
  assert.deepEqual(tape.root.before, CONNECTING);
  assert.deepEqual(tape.root.after, LIVE);
  assert.match(tape.root.querySelector('#floor-positions').textContent, /No real-money position open\./, 'the sections themselves are the same');
  // A tape is given no special reading: nothing published, or nothing lately, is a stopped floor.
  for (const publishedAt of [null, minutesAgo(16), () => checkpoint().published_at]) {
    const still = await mount('?tape=test', publishedAt);
    assert.deepEqual(still.root.before, STOPPED);
    assert.deepEqual(still.root.after, STOPPED, 'an open socket does not make a stopped floor live');
  }

  // Without the parameter, or with a name that is not on the list, the page is the real floor's,
  // and it reads the same way: the word is what the checkpoints say, not a switch in the code.
  for (const search of ['', '?tape=Not%20A%20Tape', '?tape=demo']) {
    const real = await mount(search, minutesAgo(1));
    for (const path of real.asked) assert.ok(path.startsWith('/api/capital/') && !path.startsWith('/api/capital/t/'), path);
    assert.equal(sockets.at(-1).url, 'wss://blakewoods.us/api/capital/stream');
    assert.deepEqual(real.root.before, CONNECTING);
    assert.deepEqual(real.root.after, LIVE);
    for (const publishedAt of [null, minutesAgo(16)]) {
      const stopped = await mount(search, publishedAt);
      assert.deepEqual(stopped.root.before, STOPPED);
      assert.deepEqual(stopped.root.after, STOPPED);
    }
  }

  // The morning: the page is open on an empty floor, the runtime starts, and nothing else happens.
  // The next refresh finds the first checkpoint and the word turns by itself. Then the runtime
  // stops, and the word turns back once the last checkpoint is older than the window.
  for (const search of ['', '?tape=test']) {
    await mount(search, null, async page => {
      assert.deepEqual(page.read(), STOPPED);
      await page.refresh();
      assert.deepEqual(page.read(), STOPPED, 'still nothing published');
      page.publish(minutesAgo(0)());
      await page.refresh();
      assert.deepEqual(page.read(), LIVE, 'the first checkpoint turns the floor on');
      // A status region re-announces whatever replaces it: the same word leaves the node alone.
      const word = page.word();
      page.publish(minutesAgo(0)());
      await page.refresh();
      assert.deepEqual(page.read(), LIVE);
      assert.equal(page.word(), word, 'a second live checkpoint redraws nothing');
      // Ten minutes of silence is inside the window; sixteen is not, whether the last checkpoint
      // is still being served or the address has stopped answering.
      page.clock(10);
      await page.refresh();
      assert.deepEqual(page.read(), LIVE);
      assert.equal(page.word(), word);
      page.clock(16);
      page.outage();
      await page.refresh();
      assert.deepEqual(page.read(), STOPPED, 'a refresh that fails still ages the checkpoint the page holds');
      const stoppedWord = page.word();
      assert.notEqual(stoppedWord, word, 'the word changed, so the region was redrawn once');
      page.publish(minutesAgo(16)());
      await page.refresh();
      assert.deepEqual(page.read(), STOPPED);
      assert.equal(page.word(), stoppedWord);
      // And on again: the runtime is started a second time and publishes at the clock as it stands.
      page.publish(minutesAgo(0)());
      await page.refresh();
      assert.deepEqual(page.read(), LIVE);
    });
  }
});
