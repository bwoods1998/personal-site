// A record of the options swarm in schema 2: a dozen agents across the five bands, open structures on
// real money and the shadow book, the Gym's pace, compute by part, and a tape. Invented numbers, for
// the tests and the local preview only. Not a test file itself (`npm test` runs *.test.mjs).
export const PUBLISHED_AT = '2026-09-28T14:58:00.000Z';
export const RESET_AT = '2026-09-26T06:25:30.000Z';

export const tally = (trades, wins, pnl) => ({ trades, wins, pnl_usd: pnl });
export function agent(id, overrides = {}) {
  return {
    id, family: id.replace(/-\d+$/, ''), name: id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '),
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
    run: { started_at: '2026-09-26T07:02:18.000Z' },
    account: { equity: '5694.37', cash: '5210.12', as_of: '2026-09-28T14:57:58.000Z', stale: false },
    performance: { start_at: RESET_AT, start_equity: '481.65', net_flows: '5000', verified_at: '2026-09-28T14:55:02.000Z' },
    compute: { as_of: '2026-09-28T14:57:00.000Z', sail_usd: '212.40', openai_usd: '64.10', thetadata_usd: '5.43', market_data_usd: '5.66', other_usd: '0' },
    gym: { as_of: '2026-09-28T14:50:00.000Z', trials: 48213, market_years: '51240.5', families_alive: 11, families_retired: 37 },
    agents: AGENTS, structures: STRUCTURES, ...overrides,
  };
}
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
export function news(text, at = '2026-09-28T13:10:00.000Z') {
  serial += 1;
  return { id: `news:${serial}`, stream: 'swarm', kind: 'swarm.news', at, payload: { text }, digest: hex(serial) };
}
export function mark(equity, at, cash = equity) {
  serial += 1;
  return { id: `mark:${at}`, stream: 'account', kind: 'account.mark', at, payload: { equity, cash, as_of: at }, digest: hex(serial) };
}
export const TAPE = () => [
  mark('481.65', '2026-09-26T06:30:00.000Z'),
  mark('5481.65', '2026-09-28T13:00:00.000Z', '5481.65'),
  news('Condor Vrp 3 reached Sized: its forward record held over 64 trades.', '2026-09-28T12:05:00.000Z'),
  trade('condor-vrp-3'),
  trade('orb-4', { underlying: 'SPY', structure: 'debit_vertical', legs: 2, quantity: 2, max_loss_usd: '96.00', why: 'The open broke higher on heavy volume.' }, '2026-09-28T14:10:00.000Z'),
  trade('orb-4', { action: 'close', underlying: 'SPY', structure: 'debit_vertical', legs: 2, quantity: 2, max_loss_usd: '96.00', pnl_usd: '31.00', why: 'Target reached before the lunch lull.' }, '2026-09-28T14:30:00.000Z'),
  note('putspread-dip-2', 'The gap down held through the first hour, so I bought the put vertical two weeks out and will close it before the final hour.', '2026-09-28T14:35:00.000Z'),
  note('condor-vrp-3', 'Realized volatility since the open is running under half of what the index options expect. Holding the condor; closing at the first touch of either short strike.', '2026-09-28T14:52:00.000Z'),
  mark('5694.37', '2026-09-28T14:55:00.000Z', '5210.12'),
];
