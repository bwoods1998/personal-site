// A record of the options swarm in schema 2: a dozen agents across the five bands, open structures on
// real money and the shadow book, the Gym's pace, compute by part, and a tape. Invented numbers, for
// the tests and the local preview only. Not a test file itself (`npm test` runs *.test.mjs).
import { PERFORMANCE_START_AT } from '../capital/capital.js';

export const PUBLISHED_AT = '2026-09-28T14:58:00.000Z';
// The record starts at the page's own reset constant, whatever the main session sets it to at deploy time.
export const RESET_AT = PERFORMANCE_START_AT;

export const tally = (trades, wins, pnl) => ({ trades, wins, pnl_usd: pnl });
export function agent(id, overrides = {}) {
  return {
    id, family: id.replace(/-\d+$/, ''),
    mechanism: 'Sells short-dated index premium when realized volatility runs under the level the options price in.',
    structure: 'iron_condor', band: 'gym', born_at: '2026-09-26T16:02:11.000Z', retired_at: null,
    record: { trials: 1204, revisions: 17, forward: null, real: null }, ...overrides,
  };
}
export function structure(id, overrides = {}) {
  return {
    id, agent: 'condor-vrp-3', underlying: 'XSP', structure: 'iron_condor', legs: 4, expiry: '2026-09-28', quantity: 1, real: true,
    opened_at: '2026-09-28T14:02:40.000Z', max_loss_usd: '184.00', pnl_usd: '12.50', ...overrides,
  };
}
export const AGENTS = [
  agent('condor-vrp-3', { band: 'sized', born_at: '2026-09-26T09:14:00.000Z',
    record: { trials: 5812, revisions: 41, forward: tally(64, 45, '1284.20'), real: tally(22, 16, '212.40') } }),
  agent('putspread-dip-2', { band: 'probe', structure: 'debit_vertical', born_at: '2026-09-26T09:20:00.000Z',
    mechanism: 'Buys a put debit vertical after a gap down that the first hour does not recover, and exits before the close.',
    record: { trials: 3390, revisions: 28, forward: tally(31, 18, '402.75'), real: tally(4, 2, '-18.30') } }),
  agent('orb-4', { band: 'probe', structure: 'debit_vertical', born_at: '2026-09-26T10:02:00.000Z',
    mechanism: 'Trades the break of the opening range in the direction of the break, with a vertical sized by its maximum loss.',
    record: { trials: 2877, revisions: 22, forward: tally(40, 23, '310.10'), real: tally(3, 2, '21.80') } }),
  agent('ironfly-quiet', { band: 'candidate', structure: 'iron_butterfly',
    mechanism: 'Sells an at-the-money iron butterfly on quiet mornings when the overnight range was narrow.',
    record: { trials: 2410, revisions: 19, forward: tally(18, 11, '96.40'), real: null } }),
  agent('butterfly-pin', { band: 'candidate', structure: 'long_butterfly',
    mechanism: 'Buys a long butterfly around the strike with the largest open interest on expiry afternoons, where prices tend to pin.',
    record: { trials: 1988, revisions: 15, forward: tally(9, 4, '-22.00'), real: null } }),
  agent('trend-vertical', { band: 'candidate', structure: 'debit_vertical',
    mechanism: 'Rides trend days: once the first two hours close far from the open, it buys a vertical in that direction.',
    record: { trials: 1760, revisions: 13, forward: tally(12, 7, '58.90'), real: null } }),
  agent('gap-drift', { structure: 'long_call', mechanism: 'Fades opening gaps that the premarket did not confirm, with a single long option.' }),
  agent('skew-revert', { structure: 'credit_vertical', mechanism: 'Sells the side of the smile that has steepened most against its own recent history.', record: { trials: 940, revisions: 9, forward: null, real: null } }),
  agent('calendar-term', { structure: 'calendar', mechanism: 'Buys a calendar when near-dated options are rich against the month behind them.', record: { trials: 611, revisions: 7, forward: null, real: null } }),
  agent('strangle-cheap', { structure: 'long_strangle', mechanism: 'Buys a strangle into scheduled news when the move the options expect is small beside past moves.', record: { trials: 402, revisions: 4, forward: null, real: null } }),
  agent('eod-drift', { structure: 'long_call', mechanism: 'Buys the last hour\'s drift into the close on days the index is up from the open.', record: { trials: 88, revisions: 1, forward: null, real: null } }),
  agent('reversal-1', { band: 'retired', structure: 'debit_vertical', retired_at: '2026-09-27T21:40:00.000Z',
    mechanism: 'Bought reversals after three down days; it never beat the fill cost on validation.', record: { trials: 2000, revisions: 30, forward: null, real: null } }),
];
export const STRUCTURES = [
  structure('st-condor-vrp-3-0928a'),
  structure('st-orb-4-0928a', { agent: 'orb-4', underlying: 'SPY', structure: 'debit_vertical', legs: 2, quantity: 2, max_loss_usd: '96.00', pnl_usd: '-8.00' }),
  structure('st-putspread-dip-2-0928a', { agent: 'putspread-dip-2', underlying: 'QQQ', structure: 'debit_vertical', legs: 2, expiry: '2026-09-30', max_loss_usd: '61.00', pnl_usd: null }),
  structure('st-ironfly-quiet-0928a', { agent: 'ironfly-quiet', underlying: 'SPY', structure: 'iron_butterfly', real: false, max_loss_usd: '312.00', pnl_usd: '41.00' }),
];
export function swarmCheckpoint(overrides = {}) {
  return {
    schema_version: 2, published_at: PUBLISHED_AT,
    trading: { as_of: PUBLISHED_AT, pnl_usd: '220.40' },
    run: { started_at: '2026-09-26T07:02:18.000Z' },
    account: { equity: '5694.37', cash: '5210.12', as_of: '2026-09-28T14:57:58.000Z', stale: false },
    performance: { start_at: RESET_AT, start_equity: '481.65', net_flows: '5000', verified_at: '2026-09-28T14:55:02.000Z' },
    compute: { as_of: '2026-09-28T14:57:00.000Z', sail_usd: '212.40', openai_usd: '64.10', thetadata_usd: '5.43', market_data_usd: '5.66', other_usd: '0' },
    gym: { as_of: '2026-09-28T14:50:00.000Z', trials: 48213, market_years: '51240.5', families_alive: 11, families_retired: 37 },
    agents: AGENTS, structures: STRUCTURES, ...overrides,
  };
}
// The positions ledger: every real position since the reset, open and closed, whose it was and its dollar P&L,
// adding up with the account's other activity to `trading.pnl_usd` (220.40) to the cent. Invented numbers; times to the
// minute, as the House publishes them.
export function position(id, overrides = {}) {
  return {
    id, source: 'agent', agent: 'condor-vrp-3', underlying: 'XSP', structure: 'iron_condor', right: 'both', legs: 4, quantity: 1, open_quantity: 1,
    status: 'open', expiry: '2026-09-28', opened_at: '2026-09-28T14:02:00.000Z', closed_at: null, pnl_usd: '12.50', ...overrides,
  };
}
const closed = (opened, closedAt) => ({ status: 'closed', open_quantity: 0, opened_at: opened, closed_at: closedAt });
export const POSITIONS = [
  position('real:7'),
  position('real:6', { agent: 'orb-4', underlying: 'SPY', structure: 'debit_vertical', right: 'call', legs: 2, quantity: 2, open_quantity: 2,
    opened_at: '2026-09-28T14:10:00.000Z', pnl_usd: '-8.00' }),
  position('real:5', { agent: 'orb-4', underlying: 'SPY', structure: 'debit_vertical', right: 'call', legs: 2, quantity: 2,
    ...closed('2026-09-28T13:41:00.000Z', '2026-09-28T14:30:00.000Z'), pnl_usd: '31.00' }),
  position('real:4', { agent: 'putspread-dip-2', underlying: 'QQQ', structure: 'debit_vertical', right: 'put', legs: 2, expiry: '2026-10-09',
    ...closed('2026-09-28T13:35:00.000Z', '2026-09-28T14:20:00.000Z'), pnl_usd: '-18.30' }),
  position('real:3', { ...closed('2026-09-28T13:32:00.000Z', '2026-09-28T13:58:00.000Z'), pnl_usd: '205.40' }),
  position('real:1', { source: 'calibration', agent: null, underlying: 'SPY', structure: 'debit_vertical', right: 'call', legs: 2, expiry: '2026-09-29',
    ...closed('2026-09-28T14:10:00.000Z', '2026-09-28T14:10:00.000Z'), pnl_usd: '-2.20' }),
];
export const ledger = (overrides = {}) => ({
  as_of: PUBLISHED_AT, rows: POSITIONS, earlier: null,
  other: { as_of: '2026-09-28T14:55:00.000Z', fees_usd: '0.08', crypto_usd: '-0.08', interest_usd: '0.00', misc_usd: '0.00' },
  unreconciled_usd: '0.00', ...overrides,
});
export const ledgerCheckpoint = (overrides = {}) => swarmCheckpoint({ positions: ledger(), ...overrides });
export const emptyCheckpoint = (overrides = {}) => ({
  schema_version: 2, published_at: '2026-09-26T07:03:00.000Z', run: { started_at: '2026-09-26T07:02:18.000Z' },
  account: null, performance: null, compute: null, gym: null, agents: [], structures: [], ...overrides,
});

let serial = 0;
const hex = n => n.toString(16).padStart(64, '0');
export function note(agentIdValue, text, at = '2026-09-28T14:40:00.000Z', overrides = {}) {
  serial += 1;
  return { id: `note:${agentIdValue}:${serial}`, stream: `agent:${agentIdValue}`, kind: 'agent.note', at, payload: { text }, digest: hex(serial), ...overrides };
}
export function trade(agentIdValue, payload = {}, at = '2026-09-28T14:02:40.000Z') {
  serial += 1;
  return {
    id: `trade:${agentIdValue}:${serial}`, stream: `agent:${agentIdValue}`, kind: 'agent.trade', at, digest: hex(serial),
    payload: { action: 'open', real: true, underlying: 'XSP', structure: 'iron_condor', legs: 4, expiry: '2026-09-28', quantity: 1,
      max_loss_usd: '184.00', pnl_usd: null, why: 'Realized volatility is running well under what the options price in.', ...payload },
  };
}
export function news(text, at = '2026-09-28T13:10:00.000Z', agent = null) {
  serial += 1;
  return { id: `news:${serial}`, stream: 'swarm', kind: 'swarm.news', at, payload: { agent, text }, digest: hex(serial) };
}
export function mark(equity, at, cash = equity) {
  serial += 1;
  return { id: `mark:${at}`, stream: 'account', kind: 'account.mark', at, payload: { equity, cash, as_of: at }, digest: hex(serial) };
}
export const TAPE = () => [
  mark('481.65', '2026-09-26T06:30:00.000Z'),
  mark('5481.65', '2026-09-28T13:00:00.000Z', '5481.65'),
  news('moves from Probe to Sized: its forward record held over 64 trades.', '2026-09-28T12:05:00.000Z', 'condor-vrp-3'),
  trade('condor-vrp-3'),
  trade('orb-4', { underlying: 'SPY', structure: 'debit_vertical', legs: 2, quantity: 2, max_loss_usd: '96.00', why: 'The open broke higher on heavy volume.' }, '2026-09-28T14:10:00.000Z'),
  trade('orb-4', { action: 'close', underlying: 'SPY', structure: 'debit_vertical', legs: 2, quantity: 2, max_loss_usd: '96.00', pnl_usd: '31.00', why: 'Target reached before the lunch lull.' }, '2026-09-28T14:30:00.000Z'),
  note('putspread-dip-2', 'The gap down held through the first hour, so I bought the put vertical two weeks out and will close it before the final hour.', '2026-09-28T14:35:00.000Z'),
  note('condor-vrp-3', 'Realized volatility since the open is running under half of what the index options expect. Holding the condor; closing at the first touch of either short strike.', '2026-09-28T14:52:00.000Z'),
  mark('5694.37', '2026-09-28T14:55:00.000Z', '5210.12'),
];

// The swarm window (Oct 1, 2026): a new House's checkpoint with `levels` and `rationale`, a retired agent pinned to the
// roster while its tuition position is open, and a closed incubator row. 220.40 − 3.00 − 4.00 = 213.40.
export const GOOGL_THESIS = "MSFT and GOOGL sell competing AI-cloud and search products, and investors reprice one on the other's capex or product news with a delay. When MSFT moves strongly over several sessions, QQQ is flat and GOOGL has not followed, GOOGL is expected to close part of the gap.";
export const WINDOW_AGENTS = [...AGENTS, agent('googl-lags', { band: 'retired', structure: 'debit_vertical', retired_at: '2026-09-28T14:30:00.000Z',
  mechanism: GOOGL_THESIS.slice(0, 240), record: { trials: 131, revisions: 6, forward: null, real: tally(0, 0, '0.00') } })];
export const WINDOW_POSITIONS = [
  position('real:8', { agent: 'googl-lags', underlying: 'GOOGL', structure: 'debit_vertical', right: 'call', legs: 2, expiry: '2026-10-07',
    opened_at: '2026-09-28T14:31:00.000Z', pnl_usd: '-3.00' }),
  ...POSITIONS,
  position('real:9', { source: 'incubator', agent: 'gap-drift', underlying: 'SPY', structure: 'long_call', right: 'call', legs: 1,
    status: 'closed', open_quantity: 0, opened_at: '2026-09-28T13:20:00.000Z', closed_at: '2026-09-28T13:50:00.000Z', pnl_usd: '-4.00' }),
];
export const LEVEL_OF = { 'condor-vrp-3': 'sized', 'putspread-dip-2': 'probe', 'orb-4': 'probe', 'ironfly-quiet': 'candidate', 'butterfly-pin': 'candidate',
  'trend-vertical': 'candidate', 'gap-drift': 'validation', 'skew-revert': 'practice', 'calendar-term': 'train', 'strangle-cheap': 'train', 'eod-drift': 'train',
  'reversal-1': 'retired', 'googl-lags': 'tuition' };
export const funnel = (overrides = {}) => ({ since: RESET_AT, born: 49, practice: 3, validation: 9, tuition: 7, incubator: 1, looks: 4, looks_passed: 3,
  candidate: 6, probe: 3, sized: 1, retired: 37, calibration: 1, live_test: 0, ...overrides });
export const levelsBlock = (overrides = {}) => ({ as_of: PUBLISHED_AT, agents: WINDOW_AGENTS.map(row => ({ id: row.id, level: LEVEL_OF[row.id] })),
  funnel: funnel(), ...overrides });
export const rationaleTrade = (id, overrides = {}) => ({ id, route: null, open_why: null, close_why: null, exit: null, max_loss_usd: null, ...overrides });
export const rationaleBlock = (overrides = {}) => ({
  as_of: PUBLISHED_AT,
  agents: [{ id: 'googl-lags', thesis: GOOGL_THESIS }, { id: 'orb-4', thesis: 'The opening range breaks in the direction the day keeps. A vertical rides it with a known worst case.' },
    { id: 'reversal-1', thesis: null }],
  trades: [
    rationaleTrade('real:8', { route: 'tuition', open_why: 'msft leads googl, qqq flat', max_loss_usd: '157.00' }),
    rationaleTrade('real:7', { route: 'sized', open_why: 'realized running under what the options price', max_loss_usd: '184.00' }),
    rationaleTrade('real:6', { route: 'probe', open_why: 'the open broke higher on heavy volume', max_loss_usd: '96.00' }),
    rationaleTrade('real:5', { route: 'probe', open_why: 'the open broke higher on heavy volume', close_why: 'target reached before the lunch lull', exit: 'agent', max_loss_usd: '96.00' }),
    rationaleTrade('real:4', { route: 'probe', exit: 'expiry', max_loss_usd: '61.00' }),
    rationaleTrade('real:1', { route: 'calibration', exit: 'house', max_loss_usd: '5.00' }),
    rationaleTrade('real:9', { route: 'incubator', open_why: 'gap not confirmed', exit: 'agent', max_loss_usd: '40.00' }),
  ],
  ...overrides,
});
export const windowCheckpoint = (overrides = {}) => swarmCheckpoint({
  trading: { as_of: PUBLISHED_AT, pnl_usd: '213.40' }, agents: WINDOW_AGENTS, positions: ledger({ rows: WINDOW_POSITIONS }),
  levels: levelsBlock(), rationale: rationaleBlock(), ...overrides,
});
