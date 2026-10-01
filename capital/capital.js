import {
  MAX_EVENT_LIMIT, SCHEMA_VERSION, REAL_BANDS, COMPUTE_PARTS, OTHER_PARTS, AGENT_SOURCES, agentId, computeParts, validCheckpoint, validPublicEvent,
  validDisplayName, validProgress, validScorePoint, socketMatches, tapeName, numbered, plainGlyphs, MAX_PUBLIC_CHECKPOINT_BYTES,
} from './schema.js';

// AI agents trading options on the Brokerage Account, drawn from the House's own record with text
// nodes only. The page never contacts a quote vendor or the brokerage, never shows a quote, and never
// starts work on anything.
const API = '/api/capital';
// A test tape: /capital/?tape=test reads the separate record a publisher filled under
// /api/capital/t/test, every fetch and the socket alike. Only the listed tapes (schema.js TAPES)
// count; without the parameter, or with any other name, nothing changes.
export function tapeOf(search) {
  let tape = null;
  try { tape = new URLSearchParams(typeof search === 'string' ? search : '').get('tape'); } catch { tape = null; }
  return tapeName(tape) ? tape : null;
}
export const apiBase = search => { const tape = tapeOf(search); return tape ? `${API}/t/${tape}` : API; };
const pageSearch = () => (typeof window === 'undefined' ? '' : window.location?.search);
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_SOCKET_MESSAGE = 64 * 1024;
const HISTORY_LIMIT = 2048;
const MARK = 'account.mark';
// The checkpoint read this page validates (the Worker's `WINDOW_READ`): progress, the positions ledger, the practice
// league, Claude as its own cost, the incubator route, and the House's `levels` and `rationale` (Oct 1, 2026).
export const CHECKPOINT_READ = '?progress=1&positions=1&practice=1&window=1';

// ---- the reset (Sept 26, 2026, the options swarm)
// The profit basis is the checkpoint's own `performance` block: the Brokerage Account's equity when the
// record started over, and the owner's deposits and withdrawals since. These two constants are the
// fallback while no checkpoint carries one, and the floor under it: a basis dated before the reset is
// never read, so the old record's numbers cannot leak into the new one. The main session sets them at
// deploy time to `league/config.json` `performance` (start_at, start_equity).
export const PERFORMANCE_START_AT = '2026-09-26T06:25:30.000Z';
export const START_EQUITY = '481.65';
// The balance chart's own start (Sept 27, 2026): the owner's $1,000 deposit is funding, not performance, so the chart
// starts over at the first recorded balance after it landed. The profit basis above is unchanged: profit already nets
// the deposit through `performance.net_flows`. A later published basis (a new reset) takes over from this.
export const CHART_START_AT = '2026-09-27T13:36:06.176Z';
export const CHART_START_EQUITY = '1481.63';
// A profit is shown only on an account reading and a funding check this fresh, against the checkpoint.
export const VERIFY_WINDOW_MS = 10 * 60 * 1000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 100000000n;
const responseCache = new Map();
// The status follows the data, never a switch in this file: the House publishes a checkpoint every
// minute, so it is running while the newest one the page holds is younger than this.
export const FLOOR_STALE_MS = 15 * 60 * 1000;
// The window runs both ways: a `published_at` in the future is a clock that is off, not a House that
// stopped; one further ahead than the window is not a time this page can read.
export function floorRunning(checkpoint, now = Date.now()) {
  const at = typeof checkpoint?.published_at === 'string' ? Date.parse(checkpoint.published_at) : NaN;
  return Number.isFinite(at) && Number.isFinite(now) && Math.abs(now - at) <= FLOOR_STALE_MS;
}

// ---- words
export const BAND_WORDS = { gym: 'Gym', candidate: 'Candidate', probe: 'Probe', sized: 'Sized', retired: 'Retired' };
// Highest first, the order the swarm is listed in.
export const BAND_ORDER = ['sized', 'probe', 'candidate', 'gym', 'retired'];
export const STRUCTURE_WORDS = {
  long_call: 'long call', long_put: 'long put', debit_vertical: 'debit vertical', credit_vertical: 'credit vertical',
  iron_condor: 'iron condor', iron_butterfly: 'iron butterfly', long_butterfly: 'long butterfly', long_straddle: 'long straddle',
  long_strangle: 'long strangle', calendar: 'calendar', diagonal: 'diagonal',
};
export const COMPUTE_WORDS = { sail_usd: 'Sail', claude_usd: 'Claude', openai_usd: 'OpenAI', thetadata_usd: 'ThetaData', market_data_usd: 'market data', other_usd: 'other' };
const show = value => typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
const plural = (count, word, many = `${word}s`) => `${Number(count).toLocaleString('en-US')} ${count === 1 ? word : many}`;
// "condor-vrp-3" reads as "Condor Vrp 3".
export const titleCase = slug => show(slug).split('-').filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-10-02" reads as "Oct 2": a contract's date, never shifted by a time zone.
export function expiryText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(show(value));
  return match && MONTH_NAMES[Number(match[2]) - 1] ? `${MONTH_NAMES[Number(match[2]) - 1]} ${Number(match[3])}` : '';
}
// "SPY iron condor", "XSP long call".
export const structureText = (underlyingSymbol, type) => [show(underlyingSymbol), STRUCTURE_WORDS[type] || ''].filter(Boolean).join(' ');

// ---- numbers
function scaled(value) {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return (BigInt(whole) * SCALE + BigInt((fraction + '00000000').slice(0, 8))) * (negative ? -1n : 1n);
}
function rounded(value, places) {
  const number = scaled(value);
  const negative = number < 0n;
  const absolute = negative ? -number : number;
  const divisor = 10n ** BigInt(8 - places);
  const result = (absolute + divisor / 2n) / divisor;
  return { value: result, negative: negative && result > 0n };
}
const numeric = value => typeof value === 'string' && /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,8})?$/.test(value);
// Sums and differences of the published decimals, exact to the cent: the page never adds floats.
const cents = value => (numeric(value) ? rounded(value, 2) : null);
const centsOf = value => { const amount = cents(value); return amount === null ? null : (amount.negative ? -amount.value : amount.value); };
const decimalOf = centsValue => { const negative = centsValue < 0n; const size = negative ? -centsValue : centsValue; return `${negative ? '-' : ''}${size / 100n}.${(size % 100n).toString().padStart(2, '0')}`; };
export function money(value, places = 2) {
  if (!numeric(value)) return '—';
  const amount = rounded(value, places);
  const unit = 10n ** BigInt(places);
  const whole = (amount.value / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = places ? `.${(amount.value % unit).toString().padStart(places, '0')}` : '';
  return `${amount.negative ? '−' : ''}$${whole}${fraction}`;
}
export function signOf(value) {
  if (!numeric(value)) return '';
  const amount = scaled(value);
  return amount > 0n ? 'positive' : amount < 0n ? 'negative' : '';
}
// A result carries its sign either way, so a green day and a red day read the same shape.
export function signedMoney(value, places = 2) {
  const amount = money(value, places);
  return amount !== '—' && signOf(value) === 'positive' ? `+${amount}` : amount;
}
function date(value, style = 'datetime') {
  const options = style === 'hm' ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : style === 'day' ? { month: 'short', day: 'numeric' }
        : style === 'short' ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
          : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }).format(new Date(value));
}
// "14 min ago", "2 h ago", "3 d ago".
export function ago(value, now = Date.now()) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return '';
  const seconds = Math.max(0, Math.floor((now - stamp) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}
export function truncate(value, max = 140) {
  const full = show(value).replace(/\s+/g, ' ').trim();
  if (full.length <= max) return { text: full, full, truncated: false };
  return { text: full.slice(0, max).replace(/\s+\S*$/, '') + '…', full, truncated: true };
}
// "23h 49m" of running, with the seconds that make it tick.
export function runningParts(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return { main: '—', tick: '' };
  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86400);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const tick = `${String(whole % 60).padStart(2, '0')}s`;
  if (hours >= 100) return { main: `${days}d ${Math.floor((whole % 86400) / 3600)}h`, tick: '' };
  if (hours) return { main: `${hours}h ${String(minutes).padStart(2, '0')}m`, tick };
  return { main: `${minutes}m`, tick };
}

// ---- the money: balance, profit, compute, and the one number
const within = (at, publishedAt, window = VERIFY_WINDOW_MS) => {
  const a = Date.parse(at);
  const b = Date.parse(publishedAt);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) <= window;
};
// The basis the profit is measured from: the checkpoint's, unless it predates the reset; else the constants.
export function profitBasis(checkpoint) {
  const basis = checkpoint?.performance;
  if (basis && Date.parse(basis.start_at) >= Date.parse(PERFORMANCE_START_AT)) return { ...basis, published: true };
  return { start_at: PERFORMANCE_START_AT, start_equity: START_EQUITY, net_flows: null, verified_at: null, published: false };
}
// Total profit since the reset: the account's equity, less its equity at the reset, less the owner's
// deposits net of withdrawals. A dash (null) unless the account was read fresh, is not stale, and the
// funding was verified against the account's own history within the window.
export function totalProfit(checkpoint) {
  const account = checkpoint?.account;
  const basis = profitBasis(checkpoint);
  if (!account || account.stale || !within(account.as_of, checkpoint.published_at)) return null;
  if (!basis.published || basis.net_flows === null || !within(basis.verified_at, checkpoint.published_at)) return null;
  return decimalOf(centsOf(account.equity) - centsOf(basis.start_equity) - centsOf(basis.net_flows));
}
// What the swarm has cost since the reset, part by part, and their total only when every part is known. `itemized`: the
// House names Claude as its own part (Sept 30, 2026), with Sail as billed; an older House's five parts are not itemized.
export function computeSpend(checkpoint) {
  const compute = checkpoint?.compute;
  if (!compute) return { parts: [], total: null, itemized: false };
  const parts = computeParts(compute).map(part => ({ part, label: COMPUTE_WORDS[part], usd: compute[part] }));
  const known = parts.every(row => numeric(row.usd));
  return { parts, total: known ? decimalOf(parts.reduce((sum, row) => sum + centsOf(row.usd), 0n)) : null, itemized: parts.length === COMPUTE_PARTS.length };
}
// Every input cost since the reset, by service: only an itemized bill (Claude named, Sail as billed) read fresh against
// the checkpoint and the browser's clock. `total` is null unless every part is known: the page shows no Net then.
export function inputCosts(checkpoint, now = Date.now()) {
  const spend = computeSpend(checkpoint);
  const asOf = checkpoint?.compute?.as_of;
  const fresh = spend.itemized && within(asOf, checkpoint.published_at) && within(asOf, new Date(now).toISOString());
  return { parts: spend.itemized ? spend.parts : [], total: fresh ? spend.total : null, itemized: spend.itemized, asOf: fresh ? asOf : null };
}
// Net: realized options P&L since the reset, after fees, less every input cost since the reset. Realized is Profit's own
// ledger with every open position's gain taken out (a loss still counts: an open loss never flatters Net) and an
// unreconciled difference counted only when it is a loss. Deposits never enter it. A dash unless Profit, its ledger and
// an itemized bill are all known and fresh.
export function netNumber(checkpoint, now = Date.now()) {
  const profit = tradingProfit(checkpoint, now);
  const block = checkpoint?.positions;
  const costs = inputCosts(checkpoint, now);
  if (profit === null || costs.total === null || !block || !Array.isArray(block.rows) || block.as_of !== checkpoint.trading?.as_of) return null;
  const gains = [...block.rows.filter(row => row?.status === 'open').map(row => row.pnl_usd), block.unreconciled_usd];
  if (gains.some(value => !numeric(value))) return null;
  const unrealized = gains.reduce((sum, value) => sum + (centsOf(value) > 0n ? centsOf(value) : 0n), 0n);
  return decimalOf(centsOf(profit) - unrealized - centsOf(costs.total));
}
// The one number: total profit after every input cost. A dash unless both sides are known.
export function profitAfterCompute(checkpoint) {
  const profit = totalProfit(checkpoint);
  const { total } = computeSpend(checkpoint);
  return profit === null || total === null ? null : decimalOf(centsOf(profit) - centsOf(total));
}
// The headline is the complete live-options book, never account movement or a roster subtotal.
// An old schema-2 checkpoint has no such reading: leave a dash until its publisher catches up.
export function tradingProfit(checkpoint, now = Date.now()) {
  const trading = checkpoint?.trading;
  if (!numeric(trading?.pnl_usd) || !within(trading.as_of, checkpoint.published_at)
      || !within(trading.as_of, new Date(now).toISOString())) return null;
  return trading.pnl_usd;
}
// When the timer started: the House's first start on its new ledger, else the reset itself.
export function startedAt(checkpoint) {
  if (!checkpoint) return null;
  const run = Date.parse(checkpoint.run?.started_at);
  if (Number.isFinite(run)) return run;
  const basis = Date.parse(profitBasis(checkpoint).start_at);
  return Number.isFinite(basis) ? basis : null;
}
// With the positions ledger (Sept 28, 2026) Profit is the whole account's real P&L since the reset, and the
// ledger below the chart adds up to it; a House that predates the ledger still publishes options alone.
export const PROFIT_TITLES = {
  ledger: 'Real options P&L on the Brokerage Account since the reset: every options position after fees, open ones at their current value, plus fees no position carries, crypto fees and interest. Not deposits, not compute, not the leftover crypto dust. The positions below add up to it.',
  options: 'Live options trading P&L, including open positions.',
};
export const NET_TITLE = 'Realized options P&L since the reset, after fees, less every input cost since the reset (below). An open position counts only while it is losing. Deposits are not P&L.';
export function mastheadNumbers(checkpoint, now = Date.now()) {
  const profit = tradingProfit(checkpoint, now);
  const net = netNumber(checkpoint, now);
  const started = startedAt(checkpoint);
  const elapsed = started === null ? { main: '—', tick: '' } : runningParts(Math.max(0, (now - started) / 1000));
  const title = checkpoint?.positions ? PROFIT_TITLES.ledger : PROFIT_TITLES.options;
  return [
    { key: 'profit', label: 'Profit', value: profit === null ? '—' : signedMoney(profit), tone: profit === null ? '' : signOf(profit), title },
    { key: 'net', label: 'Net', value: net === null ? '—' : signedMoney(net), tone: net === null ? '' : signOf(net), title: NET_TITLE },
    { key: 'clock', label: 'Running', value: elapsed.main, tick: elapsed.tick, tone: '', startedAt: started },
  ];
}
// The one line under the numbers: every input cost since the reset, by service ("Costs since the reset $528.20: Sail
// $294.15 · Claude $160.42 · …"). A part not yet metered says so. An older House's bill is not itemized (Claude unnamed,
// Sail booked rather than billed), so the line says only that.
export function costsLine(checkpoint, now = Date.now()) {
  const costs = inputCosts(checkpoint, now);
  if (!checkpoint?.compute) return 'Costs are not published yet.';
  if (!costs.itemized) return 'Costs are not itemized yet.';
  const named = costs.parts.map(row => `${row.label} ${numeric(row.usd) ? money(row.usd) : 'not yet metered'}`).join(' · ');
  return `Costs since the reset${costs.total === null ? '' : ` ${money(costs.total)}`}: ${named}.`;
}
// The reconciliation under the chart: every number the masthead shows, and where each comes from.
export function accountLines(checkpoint) {
  const account = checkpoint?.account;
  const basis = profitBasis(checkpoint);
  const profit = totalProfit(checkpoint);
  const spend = computeSpend(checkpoint);
  const net = profitAfterCompute(checkpoint);
  const lines = [];
  lines.push(account ? `${money(account.equity)} now · ${money(basis.start_equity)} at the reset, ${date(basis.start_at)}.`
    : `${money(basis.start_equity)} at the reset, ${date(basis.start_at)}. No balance has been published since.`);
  if (profit !== null) lines.push(`${signedMoney(profit)} total profit, after ${signedMoney(basis.net_flows)} of deposits less withdrawals.`);
  else lines.push('Total profit waits for a fresh balance and a verified funding history.');
  if (spend.parts.length) {
    const named = spend.parts.map(row => `${row.label} ${numeric(row.usd) ? money(row.usd) : 'not yet metered'}`).join(', ');
    lines.push(`${spend.total === null ? 'Compute so far' : `${money(spend.total)} compute`}: ${named}.`);
  } else lines.push('Compute is not yet metered.');
  if (net !== null) lines.push(`${signedMoney(net)} after compute: the one number.`);
  return lines;
}

// ---- the balance chart
// Recorded balances only: never interpolated, never reset on a loss. The chart starts at `CHART_START_AT` when that is
// later than the profit basis (the owner's deposit of Sept 27 is funding, not performance).
export function balanceSeries(points, { width = 1000, height = 120 } = {}) {
  const marks = (Array.isArray(points) ? points : []).filter(point => numeric(point?.equity))
    .map(point => ({ at: Date.parse(point.at), equity: Number(point.equity) }))
    .filter(point => Number.isFinite(point.at) && Number.isFinite(point.equity))
    .sort((left, right) => left.at - right.at);
  const unique = [...new Map(marks.map(point => [point.at, point])).values()];
  if (unique.length < 2) return null;
  const values = unique.map(point => point.equity);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1) { min -= 1; max += 1; }
  const span = unique.at(-1).at - unique[0].at || 1;
  const plotted = unique.map(point => ({ ...point, x: (point.at - unique[0].at) / span * width, y: 6 + (max - point.equity) / (max - min) * (height - 12) }));
  const path = plotted.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const change = unique.at(-1).equity - unique[0].equity;
  return {
    width, height, points: plotted, min, max, first: plotted[0], last: plotted.at(-1), path, area: `${path} L${width},${height} L0,${height} Z`,
    tone: change > 0.004 ? 'positive' : change < -0.004 ? 'negative' : '',
  };
}
// The chart's start (the reset, or the later chart start), every recorded mark since, and the checkpoint's own reading,
// in time order.
export function accountSeries(marks, checkpoint) {
  const basis = profitBasis(checkpoint);
  const origin = Date.parse(CHART_START_AT) > Date.parse(basis.start_at)
    ? { start_at: CHART_START_AT, start_equity: CHART_START_EQUITY } : basis;
  const start = Date.parse(origin.start_at);
  const end = checkpoint ? Date.parse(checkpoint.published_at) : Infinity;
  const points = (Array.isArray(marks) ? marks : []).filter(point => Date.parse(point?.at) >= start && Date.parse(point?.at) <= end);
  points.push({ at: origin.start_at, equity: origin.start_equity });
  if (checkpoint?.account && !checkpoint.account.stale) points.push({ at: checkpoint.account.as_of, equity: checkpoint.account.equity });
  return balanceSeries(points);
}

// ---- the swarm
const rankOf = band => { const index = BAND_ORDER.indexOf(band); return index === -1 ? BAND_ORDER.length : index; };
// The site's durable person alias is display-only. Old checkpoints still have a readable fallback.
export const agentName = agent => validDisplayName(agent?.display_name) ? agent.display_name : titleCase(agent?.id) || show(agent?.id);
// "real 4 trades · 3 won · +$12.40": the record that sizes money, when there is one; else the forward
// record; else the Gym's count of what its lineage has tried.
export function recordWords(agent) {
  const record = agent?.record || {};
  const tally = (label, row) => `${label} ${plural(row.trades, 'trade')} · ${row.wins} won · ${signedMoney(row.pnl_usd)}`;
  const tried = `${plural(record.trials ?? 0, 'trial')} · ${plural(record.revisions ?? 0, 'revision')}`;
  if (record.real && record.real.trades > 0) return { main: tally('real', record.real), tone: signOf(record.real.pnl_usd), rest: tried };
  if (record.forward && record.forward.trades > 0) return { main: tally('forward', record.forward), tone: signOf(record.forward.pnl_usd), rest: tried };
  return { main: tried, tone: '', rest: '' };
}
// `level`: where the agent stands in the game (the House's `levels`, or for an older House what the band and the open money
// can say for certain: `levelOf`).
export function swarmRows(checkpoint) {
  const agents = (Array.isArray(checkpoint?.agents) ? checkpoint.agents : []).filter(agent => agent && typeof agent === 'object');
  const pnl = agent => Number(agent.record?.real?.pnl_usd ?? agent.record?.forward?.pnl_usd ?? 0);
  const held = openMoney(checkpoint);
  const published = publishedLevels(checkpoint);
  const rows = moneyLevels(checkpoint);
  return agents.map((agent, index) => ({ agent, index }))
    .sort((left, right) => rankOf(left.agent.band) - rankOf(right.agent.band) || pnl(right.agent) - pnl(left.agent)
      || (right.agent.record?.trials ?? 0) - (left.agent.record?.trials ?? 0) || left.index - right.index)
    .map(({ agent }) => {
      const level = show(levelOf(agent, checkpoint, held, published, rows));
      return {
        id: show(agent.id), name: agentName(agent), family: show(agent.family), band: show(agent.band), bandText: BAND_WORDS[agent.band] || '',
        level, levelText: LEVEL_WORDS[level] || '',
        real: REAL_BANDS.includes(agent.band), structure: STRUCTURE_WORDS[agent.structure] || '', ...mechanismParts(agent.mechanism), record: recordWords(agent),
        progress: agentProgress(agent, checkpoint),
      };
    });
}

// Only the House's current prerequisite counts fill a ring. Trials, tenure and cumulative P&L
// are interesting records but cannot say how close a particular program is to promotion.
export const PROGRESS_TARGETS = {
  candidate: 'Candidate', probe: 'Probe', sized: 'Sized', maintain: 'Maintain capital',
};
export const PROGRESS_LABELS = {
  validation_run: 'Test completed', validation_trades: 'Validation trades', validation_days: 'Trading days',
  validation_mean: 'Positive returns', validation_t: 'Return consistency', validation_dsr: 'Survives trial adjustment',
  validation_quarters: 'Positive quarters', validation_stress: 'Higher trading costs', review: 'Strategy review',
  audit: 'Independent audit', holdout: 'Unseen market test', real_structure: 'Supported structure',
  credit_equity: 'Required equity', risk_fit: 'Fits risk limit', forward_nonnegative: 'Forward record intact',
  forward_trades: 'Forward trades', forward_mean: 'Positive forward returns', forward_confidence: 'Reliable forward edge',
  real_trades: 'Real trades', probe_sessions: 'Full trading sessions', real_record: 'Real record intact',
  execution_ready: 'Trading enabled',
};
export const PROGRESS_BLOCKERS = {
  validation_pending: 'Awaiting validation', evidence_stale: 'Evidence needs a fresh check', validation_failed: 'Validation needs improvement',
  review_pending: 'Awaiting strategy review', review_failed: 'Strategy review not passed', audit_pending: 'Awaiting independent audit',
  audit_failed: 'Independent audit not passed', holdout_pending: 'Awaiting unseen market test', holdout_failed: 'Unseen market test not passed',
  look_limit: 'Unseen test limit reached', gate_paused: 'Testing gate paused', real_money_off: 'Live trading is off',
  grant_inactive: 'Awaiting trading approval', account_unavailable: 'Awaiting account check', structure_ineligible: 'Structure stays in practice',
  equity_low: 'Needs more account equity', risk_too_large: 'Trade exceeds risk limit', forward_negative: 'Forward record needs improvement',
  forward_incomplete: 'Building a forward record', probe_incomplete: 'Building a live record', real_record_negative: 'Live record needs improvement',
};
export function agentProgress(agent, checkpoint, now = Date.now()) {
  const source = agent?.progress;
  if (agent?.band === 'retired' || !validProgress(source, agent?.band) || !floorRunning(checkpoint, now)) return null;
  const checks = source.checks.map(check => ({ ...check, label: PROGRESS_LABELS[check.key] || check.key,
    fraction: Math.min(1, check.done / check.need), met: check.done >= check.need }));
  const completed = checks.filter(check => check.met).length;
  const fraction = checks.reduce((sum, check) => sum + check.fraction, 0) / checks.length;
  return { target: source.target, label: PROGRESS_TARGETS[source.target], checks, completed, fraction,
    count: `${completed} / ${checks.length} checks`, blocked: source.blocked,
    blocker: PROGRESS_BLOCKERS[source.blocked] || '', ready: completed === checks.length && !source.blocked };
}
export function mechanismParts(value, max = 110) {
  const full = show(value).replace(/\s+/g, ' ').trim();
  const short = truncate(full, max).text;
  return { short, full, more: full.length > short.length };
}
// "3 Sized · 5 Probe · 12 Candidate · 48 Gym · 9 Retired": every band, empty ones too, so the ladder reads.
export function bandCounts(checkpoint) {
  const agents = Array.isArray(checkpoint?.agents) ? checkpoint.agents : [];
  return BAND_ORDER.map(band => ({ band, word: BAND_WORDS[band], count: agents.filter(agent => agent?.band === band).length }));
}
// The Gym's pace in one line, each number only when the House published it.
export function gymLine(checkpoint) {
  const gym = checkpoint?.gym;
  if (!gym) return 'The Gym has not reported yet.';
  const parts = [];
  if (gym.trials !== null) parts.push(`${plural(gym.trials, 'program')} tested`);
  if (gym.market_years !== null) parts.push(`${Number(gym.market_years).toLocaleString('en-US', { maximumFractionDigits: 1 })} market-years simulated`);
  if (gym.families_alive !== null) parts.push(`${plural(gym.families_alive, 'family', 'families')} alive`);
  if (gym.families_retired !== null) parts.push(`${gym.families_retired.toLocaleString('en-US')} retired`);
  return parts.length ? parts.join(' · ') : 'The Gym has not reported yet.';
}

// ---- open structures
export function structureRows(checkpoint) {
  const names = new Map((Array.isArray(checkpoint?.agents) ? checkpoint.agents : []).map(agent => [agent.id, agentName(agent)]));
  const rows = (Array.isArray(checkpoint?.structures) ? checkpoint.structures : []).filter(row => row && typeof row === 'object');
  return rows.map((row, index) => ({ row, index }))
    .sort((left, right) => Number(right.row.real) - Number(left.row.real) || Number(right.row.max_loss_usd) - Number(left.row.max_loss_usd) || left.index - right.index)
    .map(({ row }) => ({
      id: show(row.id), agent: show(row.agent), name: names.get(row.agent) || titleCase(row.agent), real: row.real === true,
      incubator: row.real === true && row.route === 'incubator', what: structureText(row.underlying, row.structure), detail: [`${row.legs} ${row.legs === 1 ? 'leg' : 'legs'}`, expiryText(row.expiry), `×${row.quantity}`].filter(Boolean).join(' · '),
      maxLossUsd: show(row.max_loss_usd), maxLoss: money(row.max_loss_usd), pnl: numeric(row.pnl_usd) ? signedMoney(row.pnl_usd) : '—', tone: signOf(row.pnl_usd),
    }));
}
// "2 real · 5 shadow · $840 at risk real": the book in one line.
export function structureLine(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const real = list.filter(row => row.real);
  const risk = real.reduce((sum, row) => sum + (centsOf(row.maxLossUsd) ?? 0n), 0n);
  const parts = [`${real.length} real`, `${list.length - real.length} shadow`];
  if (real.length) parts.push(`${money(decimalOf(risk), 0)} at risk on real money`);
  return parts.join(' · ');
}

// ---- the positions ledger
// Every real position on the Brokerage Account since the reset (Sept 28, 2026, the owner: "line of sight into what the
// agents are trading"): open ones first, then closed, newest first, and the lines that add them up to Profit exactly,
// to the cent: the positions not listed (the oldest closed, and any the table cannot describe) as one line, the account's
// other activity, and any difference the House could not reconcile. A dollar result per line, never a price.
// `house`: the House's own positions other than the calibration's; since Sept 28, 2026 the House live test (the House's
// `league/live/house_test.py`, family house:rebound-live) is the only one.
export const SOURCE_WORDS = { calibration: 'House calibration', house: 'House live test' };
// The incubator route (from Oct 1, 2026): an agent's real position at tuition size. It is in Profit, and it is never
// evidence: the row keeps its agent's name and carries this label.
export const INCUBATOR_WORDS = 'Incubator';
export const INCUBATOR_TITLE = 'Incubator: real money at tuition size, never evidence.';
// Crypto is its fees only: the leftover dust of the coins sold at the reset is not counted (the House, account_activity.py).
export const OTHER_WORDS = { fees_usd: 'fees', crypto_usd: 'crypto fees', interest_usd: 'interest', misc_usd: 'other' };
export const NOT_LISTED = 'the oldest closed, and any the table can’t describe';
const RIGHT_FIRST = ['debit_vertical', 'credit_vertical', 'calendar', 'diagonal'];
// "SPY call debit vertical", "QQQ long put", "XSP iron condor", "SPY long put butterfly".
export function positionWhat(row) {
  const root = show(row?.underlying);
  const right = row?.right === 'call' || row?.right === 'put' ? row.right : '';
  if (row?.structure === 'long_butterfly' && right) return `${root} long ${right} butterfly`;
  if (RIGHT_FIRST.includes(row?.structure) && right) return `${root} ${right} ${STRUCTURE_WORDS[row.structure]}`;
  return structureText(root, row?.structure);
}
// A line's share of Profit to a tenth of a percent, rounded half away from zero: "100.0%", "−3.6%". The shares of every
// line add up to 100%; a negative share moved against the total. A dash while Profit is unknown, or zero.
export function shareOf(amount, profit) {
  const part = centsOf(amount);
  const whole = centsOf(profit);
  if (part === null || whole === null || whole === 0n) return '—';
  const size = part < 0n ? -part : part;
  const base = whole < 0n ? -whole : whole;
  const tenths = (size * 2000n + base) / (2n * base);
  const negative = tenths > 0n && (part < 0n) !== (whole < 0n);
  const digits = (tenths / 10n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${digits}.${tenths % 10n}%`;
}
const pidOf = row => Number(show(row?.id).slice(5)) || 0;
const stampOf = value => Date.parse(value) || 0;
export function positionsLedger(checkpoint, now = Date.now()) {
  const block = checkpoint?.positions;
  if (!block || typeof block !== 'object' || !Array.isArray(block.rows)) return null;
  const profit = tradingProfit(checkpoint, now);
  const names = new Map((Array.isArray(checkpoint.agents) ? checkpoint.agents : []).map(agent => [agent?.id, agentName(agent)]));
  const who = row => (AGENT_SOURCES.includes(row.source)
    ? (validDisplayName(row.display_name) ? row.display_name : names.get(row.agent) || titleCase(row.agent))
    : SOURCE_WORDS[row.source] || '');
  const rows = block.rows.filter(row => row && typeof row === 'object');
  // The agent's own words for each row (Oct 1, 2026): only from the House's `rationale`, so an older House's table is the
  // prior table. Calibration and the House's own rows have none.
  const explained = Boolean(checkpoint.rationale && typeof checkpoint.rationale === 'object');
  const reasons = tradeReasons(checkpoint);
  const theses = new Map();
  const thesisOf = id => { if (!theses.has(id)) theses.set(id, agentThesis(checkpoint, id)); return theses.get(id); };
  // `whyFrom`: whose words the line is, the agent's note at the order or, when it sent none, the family's thesis (its first
  // sentence). The quote's title says which.
  const reasonOf = row => {
    if (!AGENT_SOURCES.includes(row.source)) return { why: null, whyFrom: null, thesis: null, maxLoss: null, exit: null, routeKey: null };
    const reason = reasons.get(row.id) || null;
    const routeKey = ROUTE_TAGS[reason?.route] ? reason.route : row.source === 'incubator' ? 'incubator' : null;
    if (!explained) return { why: null, whyFrom: null, thesis: null, maxLoss: null, exit: null, routeKey };
    const thesis = thesisOf(row.agent);
    const opened = reason?.openWhy || null;
    const why = opened ? (reason.exit === 'agent' && reason.closeWhy ? `${opened} → ${reason.closeWhy}` : opened)
      : thesis ? truncate(sentencesOf(thesis)[0], 80).text : null;
    return { why, whyFrom: opened ? 'note' : why ? 'thesis' : null, thesis, maxLoss: reason?.maxLoss ?? null, exit: reason?.exit ?? null, routeKey };
  };
  const open = rows.filter(row => row.status === 'open')
    .sort((left, right) => stampOf(right.opened_at) - stampOf(left.opened_at) || pidOf(right) - pidOf(left));
  const closed = rows.filter(row => row.status === 'closed')
    .sort((left, right) => stampOf(right.closed_at) - stampOf(left.closed_at) || stampOf(right.opened_at) - stampOf(left.opened_at) || pidOf(right) - pidOf(left));
  const line = row => ({
    id: show(row.id), source: show(row.source), agent: AGENT_SOURCES.includes(row.source) ? show(row.agent) : null, who: who(row), what: positionWhat(row),
    ...reasonOf(row), open: row.status === 'open',
    quantity: row.status === 'open' && row.open_quantity < row.quantity ? `×${row.open_quantity} of ${row.quantity}` : `×${row.quantity}`,
    expiry: expiryText(row.expiry), openedAt: show(row.opened_at), closedAt: row.status === 'closed' ? show(row.closed_at) : null,
    usd: numeric(row.pnl_usd) ? row.pnl_usd : null, pnl: numeric(row.pnl_usd) ? signedMoney(row.pnl_usd) : '—', tone: signOf(row.pnl_usd),
    share: shareOf(row.pnl_usd, profit),
  });
  const named = row => { const entry = line(row); return { ...entry, route: entry.routeKey ? LEVEL_WORDS[entry.routeKey] : '' }; };
  const amount = (key, label, value, detail) => ({ key, label, detail, usd: numeric(value) ? value : null,
    pnl: numeric(value) ? signedMoney(value) : '—', tone: signOf(value), share: shareOf(value, profit) });
  const other = block.other && typeof block.other === 'object' ? block.other : null;
  const known = other && OTHER_PARTS.every(part => numeric(other[part]));
  const otherUsd = known ? decimalOf(OTHER_PARTS.reduce((sum, part) => sum + centsOf(other[part]), 0n)) : null;
  const parts = known ? OTHER_PARTS.filter(part => centsOf(other[part]) !== 0n).map(part => `${OTHER_WORDS[part]} ${signedMoney(other[part])}`) : [];
  // Never hidden: shown whenever the House sends it, a dash while its amount is unknown.
  const earlier = block.earlier && typeof block.earlier === 'object' ? { count: Number(block.earlier.positions) || 0,
    ...amount('earlier', `${plural(block.earlier.positions, 'position')} not listed`, block.earlier.pnl_usd, NOT_LISTED) } : null;
  const unreconciled = numeric(block.unreconciled_usd) && centsOf(block.unreconciled_usd) !== 0n
    ? amount('unreconciled', 'Unreconciled difference', block.unreconciled_usd, 'not yet matched to a position or account activity') : null;
  return {
    asOf: show(block.as_of), open: open.map(named), closed: closed.map(named), earlier, unreconciled,
    other: amount('other', 'Other account activity', otherUsd, known ? parts.join(' · ') || 'none' : ''),
    total: { key: 'total', label: 'Profit', detail: '', usd: profit, pnl: profit === null ? '—' : signedMoney(profit), tone: profit === null ? '' : signOf(profit),
      share: profit === null || centsOf(profit) === 0n ? '—' : '100.0%' },
  };
}
// "1 open · 3 closed · 12 not listed".
export function positionsLine(ledger) {
  if (!ledger) return '';
  const parts = [`${ledger.open.length} open`, `${ledger.closed.length} closed`];
  if (ledger.earlier) parts.push(`${ledger.earlier.count.toLocaleString('en-US')} not listed`);
  return parts.join(' · ');
}

// ---- the practice league (Sept 29, 2026)
// Shadow trades on live quotes under the Gym's fill rules, never real money: never Profit, never Net, never a
// position above. One row per family as the House sends them (the alive by trades, then the retired), and the totals
// over every family, shown or not. Null while the House publishes no block: the section stays hidden.
export const PRACTICE_CAPTION = 'Shadow trades on live quotes, never real money. Not in Profit or Net.';
export const PRACTICE_COLUMNS = [['who', 'Agent'], ['what', 'Structure'], ['tier', 'Version'], ['sessions', 'Sessions'], ['trades', 'Trades'],
  ['wins', 'Won'], ['pnl', 'P&L'], ['ror', 'On risk']];
export const PRACTICE_TIER_WORDS = { validated: 'validated', train: 'Train' };
export function practiceTable(checkpoint) {
  const block = checkpoint?.practice;
  if (!block || typeof block !== 'object' || !Array.isArray(block.rows) || !block.totals) return null;
  const names = new Map((Array.isArray(checkpoint.agents) ? checkpoint.agents : []).map(agent => [agent?.id, agentName(agent)]));
  const percent = value => {
    if (!numeric(value)) return '—';
    const hundredths = centsOf(value);
    const size = hundredths < 0n ? -hundredths : hundredths;
    return `${hundredths < 0n ? '−' : hundredths > 0n ? '+' : ''}${size}%`;
  };
  const rows = block.rows.filter(row => row && typeof row === 'object').map(row => ({
    agent: show(row.agent), who: validDisplayName(row.display_name) ? row.display_name : names.get(row.agent) || titleCase(row.agent),
    retired: row.status === 'retired', what: STRUCTURE_WORDS[row.structure] || '—', tier: PRACTICE_TIER_WORDS[row.tier] || '',
    sessions: show(row.sessions), trades: show(row.trades), wins: show(row.wins),
    pnl: numeric(row.pnl_usd) ? signedMoney(row.pnl_usd) : '—', tone: signOf(row.pnl_usd), ror: percent(row.return_on_risk), rorTone: signOf(row.return_on_risk),
  }));
  const totals = block.totals;
  const hidden = Math.max(0, Number(totals.families) - rows.length);
  return {
    asOf: show(block.as_of), sessions: Number(block.sessions) || 0, capital: money(block.capital_usd, 0), rows, hidden,
    total: { label: `${plural(totals.families, 'family', 'families')}`, trades: show(totals.trades), wins: show(totals.wins),
      pnl: numeric(totals.pnl_usd) ? signedMoney(totals.pnl_usd) : '—', tone: signOf(totals.pnl_usd) },
  };
}

// ---- the tape: the agents' decisions in their own words, their trades, the swarm's news
export const FEED_KINDS = ['agent.note', 'agent.trade', 'swarm.news'];
const streamAgentOf = stream => (typeof stream === 'string' && stream.startsWith('agent:') ? stream.slice(6) : null);
export const plainNote = value => show(value).replace(/\*\*|__|`+/g, '').replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim();
// "opened 3 SPY iron condors · Oct 2 · max loss $150"; "closed 3 SPY iron condors · +$42.10".
export function tradeWords(payload) {
  const what = structureText(payload.underlying, payload.structure);
  const count = payload.quantity === 1 ? `1 ${what}` : `${payload.quantity} ${what}s`;
  if (payload.action === 'open') return [`opened ${count}`, expiryText(payload.expiry), `max loss ${money(payload.max_loss_usd, 0)}`].filter(Boolean).join(' · ');
  return `closed ${count}`;
}
// One line of the feed, or null for anything the page does not show.
export function feedLine(event, names = new Map()) {
  if (!event || !FEED_KINDS.includes(event.kind)) return null;
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const base = { id: show(event.id), seq: Number(event.seq) || 0, at: show(event.at), pnl: '', tone: '', real: null };
  if (event.kind === 'swarm.news') {
    const text = plainNote(payload.text);
    const who = agentId(payload.agent) ? payload.agent : null;
    return text ? { ...base, kind: 'swarm', agent: who || 'swarm', name: who ? event.display_name || names.get(who) || titleCase(who) : 'The House', text } : null;
  }
  const agent = streamAgentOf(event.stream);
  if (!agentId(agent)) return null;
  const name = event.display_name || names.get(agent) || titleCase(agent);
  if (event.kind === 'agent.note') {
    const text = plainNote(payload.text);
    return text ? { ...base, kind: 'thinking', agent, name, text } : null;
  }
  return {
    ...base, kind: 'trading', agent, name, text: tradeWords(payload), real: payload.real === true, action: payload.action === 'open' ? 'open' : 'close',
    pnl: numeric(payload.pnl_usd) ? signedMoney(payload.pnl_usd) : '', tone: signOf(payload.pnl_usd),
    // The tape's `why` can run to 240 characters and keep numerals: it shows only as a short plain tag, never raw.
    why: tickerCase(plainTag(payload.why, 80), [payload.underlying]) || '',
  };
}
const sameness = line => `${line.kind}|${line.text.toLowerCase().replace(/[−+$]?\d[\d.,]*/g, '#').replace(/\s+/g, ' ').trim()}`;
// Newest first; an agent repeating itself folds into one line with a count.
export function feedLines(events, names = new Map(), { limit = 12, skip = [] } = {}) {
  const skipped = new Set((Array.isArray(skip) ? skip : [skip]).filter(Boolean));
  const ordered = [...(Array.isArray(events) ? events : [])].filter(event => event && typeof event === 'object')
    .sort((left, right) => ((Number(right.seq) || 0) - (Number(left.seq) || 0)) || (Date.parse(right.at) - Date.parse(left.at)));
  const lines = [];
  const last = new Map();
  const seen = new Set();
  for (const event of ordered) {
    if (skipped.has(event.id) || seen.has(event.id)) continue;
    seen.add(event.id);
    const line = feedLine(event, names);
    if (!line) continue;
    const key = sameness(line);
    const previous = last.get(line.agent);
    if (previous && previous.key === key) { previous.count += 1; continue; }
    if (lines.length >= limit) break;
    const entry = { ...line, key, count: 1 };
    lines.push(entry);
    last.set(line.agent, entry);
  }
  return lines.map(({ key, ...line }) => line);
}
// The stage: the newest note, but an agent that is still talking keeps it for a while, so the words
// do not jump between agents every few seconds.
export function heroNote(events, current = null, { holdMs = 45000 } = {}) {
  const notes = [...(Array.isArray(events) ? events : [])]
    .filter(event => event?.kind === 'agent.note' && agentId(streamAgentOf(event.stream)) && plainNote(event.payload?.text))
    .sort((left, right) => (Date.parse(right.at) - Date.parse(left.at)) || ((Number(right.seq) || 0) - (Number(left.seq) || 0)));
  if (!notes.length) return null;
  let pick = notes[0];
  if (current) {
    const own = notes.find(event => streamAgentOf(event.stream) === current);
    if (own && Date.parse(notes[0].at) - Date.parse(own.at) <= holdMs) pick = own;
  }
  return { id: show(pick.id), agent: streamAgentOf(pick.stream), at: show(pick.at), text: plainNote(pick.payload.text), display_name: pick.display_name };
}

// ---- the swarm window (Oct 1, 2026): why each trade, the levels, and performance over time
// The page's own copy of the House's sentence rules for a thesis (league/swarm/public.py `thesis_text`), used only while the
// House has not sent its own: whole sentences in order, none with a digit, a colon, a bracket, a code mark or a number
// written as a word (the pronoun "one" aside), within the limit. Null when nothing survives: the card then shows no
// thesis rather than a raw mechanism. The House's thesis always replaces this one. The number rules themselves
// (`numbered`, `plainGlyphs`) live in schema.js, the House's word for word, so the Worker refuses exactly what the page
// would hide.
const CODE_MARKS = /[=_{}[\]<>`#|\\]|->|::|\bctx\.|\bnp\.|\bPARAMS\b|\bNEEDS\b|\bdef\s|\breturn\s|\bimport\s|\blambda\b/;
export { numbered };
// One sentence the public may read: no numeral of any script, hidden mark or foreign letter, no colon or bracket, no code,
// no number word.
export const plainSentence = sentence => Boolean(sentence) && plainGlyphs(sentence) && !CODE_MARKS.test(sentence) && !/[:()]/.test(sentence)
  && !numbered(sentence);
// A short tag (an order's `why`) under the same rules, within its limit.
export const plainTag = (value, limit = 80) => {
  const text = plainNote(value);
  return text && text.length <= limit && plainSentence(text) ? text : null;
};
// A tag's tickers in capitals ("msft leads googl, qqq flat" reads "MSFT leads GOOGL, QQQ flat"): the symbols the swarm
// trades, and any the row names, never an ordinary word.
const TICKERS = new Set(['spy', 'qqq', 'iwm', 'dia', 'xsp', 'spx', 'spxw', 'ndx', 'rut', 'vix', 'vxx', 'uvxy', 'gld', 'slv', 'tlt', 'ief', 'hyg', 'lqd',
  'uso', 'eem', 'efa', 'fxi', 'smh', 'soxx', 'xle', 'xlf', 'xlk', 'xlu', 'xlv', 'xly', 'xlp', 'xli', 'xlb', 'kre', 'arkk', 'tqqq', 'sqqq', 'msft', 'googl',
  'goog', 'aapl', 'nvda', 'amzn', 'meta', 'tsla', 'amd', 'avgo', 'nflx', 'orcl', 'crm', 'intc', 'mu', 'jpm', 'gs', 'bac', 'xom', 'cvx', 'brk', 'unh', 'lly']);
const ORDINARY = new Set(['a', 'all', 'an', 'and', 'are', 'at', 'be', 'big', 'by', 'can', 'for', 'go', 'has', 'have', 'in', 'is', 'it', 'key', 'low', 'new',
  'now', 'of', 'on', 'one', 'or', 'out', 'see', 'so', 'the', 'to', 'top', 'two', 'up', 'was', 'well']);
export function tickerCase(text, symbols = []) {
  if (!text) return text ?? null;
  const own = new Set(symbols.map(symbol => show(symbol).toLowerCase()).filter(symbol => /^[a-z]{1,5}$/.test(symbol) && !ORDINARY.has(symbol)));
  return text.replace(/\b[a-z]{1,5}\b/gi, word => (TICKERS.has(word.toLowerCase()) || own.has(word.toLowerCase()) ? word.toUpperCase() : word));
}
export const sentencesOf = text => show(text).replace(/\s+/g, ' ').trim().replace(/([.!?…])\s+/g, '$1\u0000').split('\u0000').filter(Boolean);
// The units a cut number leaves behind it ("exceeds standard deviations"): the page's own list, apart from the House's rules.
const CUT_UNITS = new Set(['day', 'days', 'session', 'sessions', 'week', 'weeks', 'month', 'months', 'year', 'years', 'hour', 'hours', 'hr', 'hrs',
  'minute', 'minutes', 'min', 'mins', 'sec', 'secs', 'wk', 'wks', 'mo', 'mos', 'yr', 'yrs', 'bar', 'bars', 'standard', 'sigma', 'sigmas', 'deviation',
  'deviations', 'sd', 'sds', 'stdev', 'stdevs', 'atr', 'atrs', 'strike', 'strikes', 'contract', 'contracts', 'lot', 'lots', 'leg', 'legs', 'percent',
  'point', 'points', 'dte', 'delta', 'deltas', 'times', 'x', 'tick', 'ticks', 'cent', 'cents', 'dollar', 'dollars', 'notch', 'notches', 'handle',
  'handles', 'bp', 'pip', 'pips']);
// A sentence an older publisher has already cut a number out of ("exceeds standard deviations", "IV above ."): the House's
// news strips decimals and brackets, which can leave a sentence that reads whole but says something else. Never shown.
const COMPARATORS = new Set(['exceeds', 'exceed', 'exceeding', 'above', 'below', 'under', 'over', 'than', 'beyond', 'past', 'within', 'by', 'at',
  'least', 'most', 'near', 'around', 'about', 'next', 'last', 'top', 'bottom', 'roughly', 'nearly', 'almost']);
export function cutNumber(sentence) {
  if (/\s[.,;!?…]/.test(sentence)) return true;
  const tokens = show(sentence).toLowerCase().match(/[a-z']+/g) || [];
  return tokens.some((token, index) => COMPARATORS.has(token) && CUT_UNITS.has(tokens[index + 1]));
}
// Whole sentences in order while they fit, each one plain and ending ".", "!" or "?". `interim`: text an older publisher
// may have cut numbers out of, so a sentence that reads as cut is dropped too.
export function thesisText(text, limit = 280, minimum = 12, { interim = false } = {}) {
  const keep = sentencesOf(text).filter(sentence => plainSentence(sentence) && /[.!?]$/.test(sentence) && !(interim && cutNumber(sentence)));
  let out = '';
  for (const sentence of keep) {
    const next = `${out} ${sentence}`.trim();
    if (next.length > limit) break;
    out = next;
  }
  if (!out && keep.length) out = `${keep[0].slice(0, limit - 1).replace(/\s+\S*$/, '').replace(/[ ,;-]+$/, '')}…`;
  return out.length >= minimum ? out : null;
}
// The House's own thesis as the page shows it: the House filtered it already; the page drops any sentence its own rules
// refuse (they can be stricter), and shows nothing rather than a part that reads wrong.
export function houseThesis(text) {
  if (typeof text !== 'string') return null;
  const all = sentencesOf(text);
  const kept = all.filter(plainSentence);
  return kept.length && kept.join(' ').length >= 12 ? kept.join(' ') : null;
}
// Which agents hold money now, and what kind: real (the ledger's open agent rows and real structures), the incubator's,
// or the shadow book's.
export function openMoney(checkpoint) {
  const held = new Map();
  const mark = (id, key) => {
    if (!agentId(id)) return;
    const entry = held.get(id) || { real: false, incubator: false, shadow: false };
    entry[key] = true;
    held.set(id, entry);
  };
  for (const row of Array.isArray(checkpoint?.positions?.rows) ? checkpoint.positions.rows : []) {
    if (row?.status !== 'open') continue;
    if (row.source === 'incubator') mark(row.agent, 'incubator');
    else if (row.source === 'agent') mark(row.agent, 'real');
  }
  for (const row of Array.isArray(checkpoint?.structures) ? checkpoint.structures : []) {
    if (row?.real === true) mark(row.agent, row.route === 'incubator' ? 'incubator' : 'real');
    else if (row?.real === false) mark(row.agent, 'shadow');
  }
  return held;
}
const publishedLevels = checkpoint => new Map((Array.isArray(checkpoint?.levels?.agents) ? checkpoint.levels.agents : []).map(row => [row?.id, row?.level]));
// The level an open row of an agent's money stands on: the route its trade names when the House sent one (Tuition, the
// Incubator, Probe, Sized), else the Incubator for an incubator row and Tuition for any other agent row (the one real step a
// Gym agent reaches without the holdout).
const ROUTE_LEVELS = { tuition: 'tuition', incubator: 'incubator', probe: 'probe', sized: 'sized' };
const rowLevel = (row, routes) => ROUTE_LEVELS[routes.get(row.id)] || (row.source === 'incubator' ? 'incubator' : 'tuition');
const tradeRoutes = checkpoint => new Map((Array.isArray(checkpoint?.rationale?.trades) ? checkpoint.rationale.trades : []).map(trade => [trade?.id, trade?.route]));
// Each agent's first open row in the ledger (newest first), as the level that row stands on.
export function moneyLevels(checkpoint, routes = tradeRoutes(checkpoint)) {
  const levels = new Map();
  for (const row of Array.isArray(checkpoint?.positions?.rows) ? checkpoint.positions.rows : []) {
    if (row?.status === 'open' && AGENT_SOURCES.includes(row.source) && agentId(row.agent) && !levels.has(row.agent)) levels.set(row.agent, rowLevel(row, routes));
  }
  return levels;
}
// Where an agent stands: the House's own word when it sends `levels`; else what the roster and the ledger can say for
// certain. A band above the Gym is its own level; real money on a Gym agent with no incubator tag can only be tuition. A
// retired agent still holding money stands on that money's step (its ledger row's route, as `moneyLevels` reads it, or
// Tuition or the Incubator by the money's kind when only a structure says so), never in the graveyard while the money is open.
export function levelOf(agent, checkpoint, held = openMoney(checkpoint), published = publishedLevels(checkpoint), rows = moneyLevels(checkpoint)) {
  if (published.has(agent?.id)) return published.get(agent.id);
  const band = agent?.band;
  if (['candidate', 'probe', 'sized'].includes(band)) return band;
  const money = held.get(agent?.id);
  if (band === 'retired') return !money ? 'retired' : rows.get(agent.id) || (money.real ? 'tuition' : money.incubator ? 'incubator' : 'retired');
  if (money?.incubator) return 'incubator';
  if (money?.real) return 'tuition';
  return 'train';
}
// Every symbol the page has seen traded, for `tickerCase`.
const symbolsOf = checkpoint => [...new Set([...(Array.isArray(checkpoint?.positions?.rows) ? checkpoint.positions.rows : []),
  ...(Array.isArray(checkpoint?.structures) ? checkpoint.structures : [])].map(row => row?.underlying).filter(Boolean))];
// An agent's thesis wherever the page shows it (its card, its step's roster, its positions): the House's own when the House
// publishes `rationale` for it, even when that is null (nothing survived the House's filter: then nothing shows); else, from
// an older House, its mechanism or its birth news under the page's own rules. Never a raw mechanism.
export function agentThesis(checkpoint, id, births = new Map()) {
  const published = (Array.isArray(checkpoint?.rationale?.agents) ? checkpoint.rationale.agents : []).find(entry => entry?.id === id);
  if (published) return houseThesis(published.thesis);
  const agent = (Array.isArray(checkpoint?.agents) ? checkpoint.agents : []).find(entry => entry?.id === id) || null;
  return thesisText(agent?.mechanism, 280, 12, { interim: true }) || thesisText(births.get(id), 280, 12, { interim: true }) || null;
}
// "−8% of risk": the P&L as a share of the most the position could lose, to a whole percent. Never a maximum gain.
export function riskShare(pnl, risk) {
  const part = centsOf(pnl);
  const whole = centsOf(risk);
  if (part === null || whole === null || whole <= 0n) return null;
  return Number(part * 1000n / whole) / 10;
}
// One archived series in segments: a segment breaks on an unknown point or a gap of more than fifteen minutes, so the line
// never joins across what nobody recorded.
export const SCORE_GAP_MS = 15 * 60 * 1000;
export function scoreSeries(points, key, gapMs = SCORE_GAP_MS) {
  const segments = [];
  let current = null;
  let last = null;
  const ordered = (Array.isArray(points) ? points : []).map(point => ({ at: Date.parse(point?.at), value: point?.[key] }))
    .filter(point => Number.isFinite(point.at)).sort((left, right) => left.at - right.at);
  for (const point of ordered) {
    if (!numeric(point.value)) { current = null; continue; }
    if (!current || point.at - last > gapMs) { current = []; segments.push(current); }
    current.push({ at: point.at, cents: centsOf(point.value) });
    last = point.at;
  }
  return segments;
}

// ---- the owner's ideas on the prior page (Oct 1, 2026): the game's levels, each trade's reason, the paths of Profit and Net
// The game's words for each level, the tag each level wears (the page's own tag looks: dashed is shadow, dotted gold is
// small real money, gold is real money), and the levels that hold real money.
export const LEVEL_WORDS = { train: 'Train', validation: 'Validation', practice: 'Practice', incubator: 'Incubator', tuition: 'Tuition',
  candidate: 'Candidate', probe: 'Probe', sized: 'Sized', retired: 'Retired' };
export const LEVEL_TAG_KIND = { train: 'band', validation: 'band', candidate: 'band', practice: 'practice', incubator: 'incubator', tuition: 'tuition',
  probe: 'real', sized: 'real', retired: 'retired' };
export const REAL_LEVELS = ['tuition', 'incubator', 'probe', 'sized'];
// Hover only: never on the page.
export const LEVEL_TITLES = {
  train: 'Training on recorded markets', validation: 'Tested on held-back years', practice: 'Shadow trades on live quotes, never real money',
  incubator: INCUBATOR_TITLE, tuition: 'One real contract to measure fills, never evidence', candidate: 'Passed the unseen market test',
  probe: 'Real money, small', sized: 'Real money, sized by its record',
};
// A real position's route as a tag beside its agent's name: the incubator's as before, and the House's other routes (a new
// one also carries `tag-route`). Calibration and the House's own rows have none.
export const ROUTE_TAGS = {
  tuition: { kind: 'tuition', title: 'Tuition: one real contract to measure fills, never evidence.' },
  incubator: { kind: 'incubator', title: INCUBATOR_TITLE },
  probe: { kind: 'real', title: 'Probe: real money, small.' },
  sized: { kind: 'real', title: 'Sized: real money, sized by its record.' },
};
// Who closed a position, from the House's `exit`: a title on its Closed time.
export const EXIT_TITLES = { agent: 'closed by the agent', house: 'closed by the House', expiry: 'expired' };
// Whose words a quoted reason is: a title on the quote, never on the page. The agent's note at the order (`closed`: the
// tape's note at a close), or the family's thesis when the agent sent none; `fold` follows the note on the button that
// unfolds the thesis.
export const WHY_TITLES = {
  note: 'The agent’s own words when it opened the position.', closed: 'The agent’s own words when it closed the position.',
  thesis: 'From the family’s thesis; the agent sent no note for this order.', fold: 'Tap for the family’s thesis.',
};
// Each ledger row's reasons from the House's `rationale`, under the page's own rules again: an open or close tag only as a
// plain short tag (never a raw mechanism or a numeral), its tickers in capitals. Empty while the House sends no rationale.
export function tradeReasons(checkpoint) {
  const reasons = new Map();
  const roots = symbolsOf(checkpoint);
  const rows = new Map((Array.isArray(checkpoint?.positions?.rows) ? checkpoint.positions.rows : []).map(row => [row?.id, row]));
  for (const trade of Array.isArray(checkpoint?.rationale?.trades) ? checkpoint.rationale.trades : []) {
    if (!trade || typeof trade !== 'object') continue;
    const symbols = [rows.get(trade.id)?.underlying, ...roots].filter(Boolean);
    reasons.set(trade.id, {
      route: trade.route ?? null, openWhy: tickerCase(plainTag(trade.open_why), symbols), closeWhy: tickerCase(plainTag(trade.close_why), symbols),
      exit: trade.exit ?? null, maxLoss: numeric(trade.max_loss_usd) ? trade.max_loss_usd : null,
    });
  }
  return reasons;
}
// "−50% of its $157 max loss": a position's P&L against the most it could lose, to a whole percent. A title only.
export function riskTitle(pnl, maxLoss) {
  const share = riskShare(pnl, maxLoss);
  if (share === null) return '';
  const whole = Math.round(Math.abs(share));
  return `${whole === 0 ? '' : share < 0 ? '−' : '+'}${whole}% of its ${money(maxLoss, 0)} max loss`;
}
// "2,255 born › 360 validation › 2 tuition › 0 candidate › 0 probe › 0 sized": how many families reached each level since
// the reset; a count the House could not read is a dash. Null while the House sends no funnel.
export const FUNNEL_STEPS = ['born', 'validation', 'tuition', 'candidate', 'probe', 'sized'];
export const FUNNEL_TITLE = 'Since the reset: how many families reached each level.';
export function funnelLine(checkpoint) {
  const funnel = checkpoint?.levels?.funnel;
  if (!funnel || typeof funnel !== 'object') return null;
  return FUNNEL_STEPS.map(key => `${Number.isSafeInteger(funnel[key]) && funnel[key] >= 0 ? funnel[key].toLocaleString('en-US') : '—'} ${key}`).join(' › ');
}

// A headline's own path under it: the score archive's segments (`scoreSeries`), then the checkpoint's live reading when it
// is later than the archive. The segments are laid end to end: each takes width in proportion to its own duration, a fixed
// gap apart (narrowed only if the gaps would take more than half the width), so unpriced time (nights, the book before the
// open) is never drawn and never bridged. Null below two priced points.
export function sparkSeries(points, key, live = null, { width = 120, height = 24, gapPx = 3 } = {}) {
  const segments = scoreSeries(points, key).map(segment => [...segment]);
  const tail = segments.at(-1)?.at(-1);
  // An unpriced bucket after the last priced point: the live reading starts its own segment, never a bridge.
  const unpricedAfter = (Array.isArray(points) ? points : []).some(point => !numeric(point?.[key])
    && Date.parse(point?.at) > (tail?.at ?? -Infinity));
  if (live && Number.isFinite(live.at) && typeof live.cents === 'bigint' && (!tail || live.at > tail.at)) {
    if (!tail || unpricedAfter || live.at - tail.at > SCORE_GAP_MS) segments.push([{ at: live.at, cents: live.cents }]);
    else segments.at(-1).push({ at: live.at, cents: live.cents });
  }
  if (segments.reduce((sum, segment) => sum + segment.length, 0) < 2) return null;
  const values = segments.flat().map(point => Number(point.cents));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 2.5;
  const y = cents => (max === min ? height / 2 : pad + (max - Number(cents)) / (max - min) * (height - 2 * pad));
  const gap = segments.length > 1 ? Math.min(gapPx, width / 2 / (segments.length - 1)) : 0;
  const spans = segments.map(segment => segment.at(-1).at - segment[0].at);
  const total = spans.reduce((sum, span) => sum + span, 0);
  const room = width - gap * (segments.length - 1);
  let left = 0;
  const drawn = segments.map((segment, index) => {
    const share = total > 0 ? spans[index] / total * room : room / segments.length;
    const from = left;
    left += share + gap;
    const plotted = segment.map(point => ({ at: point.at, cents: point.cents, y: y(point.cents),
      x: from + (spans[index] ? (point.at - segment[0].at) / spans[index] * share : share / 2) }));
    const moves = plotted.map((point, n) => `${n ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    // A lone point is a zero-length stroke: its round cap draws it as a dot.
    if (plotted.length === 1) moves.push(`L${plotted[0].x.toFixed(1)},${plotted[0].y.toFixed(1)}`);
    return { from, to: from + share, points: plotted, path: moves.join(' ') };
  });
  const last = drawn.at(-1).points.at(-1);
  return { width, height, segments: drawn, points: drawn.flatMap(segment => segment.points), last,
    tone: last.cents > 0n ? 'positive' : last.cents < 0n ? 'negative' : '', zeroY: min < 0 && max > 0 ? y(0n) : null };
}
// The agents' own real positions on the balance chart: a mark at each opening on the chart's time scale, hollow while
// open. The House's calibration is in the line and the ledger already and gets none; an opening before the chart is not marked.
export function chartMarks(checkpoint, series, now = Date.now()) {
  const ledger = positionsLedger(checkpoint, now);
  if (!ledger || !series) return [];
  const start = series.first.at;
  const span = series.last.at - start || 1;
  return [...ledger.open, ...ledger.closed].filter(line => AGENT_SOURCES.includes(line.source))
    .map(line => ({ line, at: Date.parse(line.openedAt) })).filter(({ at }) => Number.isFinite(at) && at >= start)
    .map(({ line, at }) => ({ id: line.id, open: line.open, x: Math.min(series.width, (at - start) / span * series.width), label: `${line.who} · ${line.what} · ${line.pnl}` }));
}

// The card's queue: a burst of live notes plays one after another, oldest first. Deduped by id, at most twelve (the oldest
// drop first); a note that is not an agent's plain words never joins.
export const QUEUE_LIMIT = 12;
export const QUEUE_WINDOW_MS = 180000;
const byTime = (left, right) => (Date.parse(left.at) - Date.parse(right.at)) || ((Number(left.seq) || 0) - (Number(right.seq) || 0));
export function queueNotes(queue, events) {
  const kept = new Map((Array.isArray(queue) ? queue : []).map(event => [event.id, event]));
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.kind !== 'agent.note' || !agentId(streamAgentOf(event.stream)) || !plainNote(event.payload?.text) || kept.has(event.id)) continue;
    kept.set(event.id, event);
  }
  return [...kept.values()].sort(byTime).slice(-QUEUE_LIMIT);
}
// Before the card takes a note, anything more than three minutes older than the newest queued note drops out (to the feed),
// so the card never trails the swarm by much more than that.
export function trimQueue(queue) {
  const list = Array.isArray(queue) ? queue : [];
  const newest = Math.max(...list.map(event => Date.parse(event.at)).filter(Number.isFinite));
  return list.filter(event => !(newest - Date.parse(event.at) > QUEUE_WINDOW_MS));
}
// How long a note holds the card: shorter while notes wait, the prior reading time when none do.
export function holdFor(text, waiting = false) {
  const words = show(text).trim().split(/\s+/).length;
  return waiting ? Math.max(8000, Math.min(20000, words / 3.5 * 1000)) : Math.max(12000, Math.min(45000, words / 3 * 1000 + 2000));
}
// A live note, as the card shows it.
const noteHero = event => ({ id: show(event.id), agent: streamAgentOf(event.stream), at: show(event.at), text: plainNote(event.payload?.text), display_name: event.display_name });

// ---- transport
export function streamUrl(streams, location) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const selection = Array.isArray(streams) && streams.length && !streams.includes('all') ? `?streams=${encodeURIComponent(streams.join(','))}` : '';
  return `${protocol}//${location.host}${apiBase(location.search)}/stream${selection}`;
}
async function fetchJson(path, limit = MAX_FEED_BYTES) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const previous = responseCache.get(path);
    const response = await fetch(path, {
      method: 'GET', cache: 'no-store', credentials: 'omit', signal: controller.signal,
      headers: previous?.etag ? { 'If-None-Match': previous.etag } : {},
    });
    if (response.status === 304 && previous) return previous.value;
    if (!response.ok) throw new Error('Unavailable.');
    if (Number(response.headers?.get('content-length') || 0) > limit) throw new Error('Response exceeds size limit.');
    const raw = await response.text();
    if (new TextEncoder().encode(raw).length > limit) throw new Error('Response exceeds size limit.');
    const value = JSON.parse(raw);
    responseCache.set(path, { value, etag: response.headers?.get('etag') || null });
    return value;
  } finally { clearTimeout(timeout); }
}
async function loadEvents(query) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== null && value !== undefined));
  const data = await fetchJson(`${apiBase(pageSearch())}/events?${params}`);
  if (data?.schema_version !== SCHEMA_VERSION || !Array.isArray(data.events) || data.events.length > MAX_EVENT_LIMIT || !data.events.every(validPublicEvent)) throw new Error('Invalid tape.');
  return data;
}
async function loadCheckpoint() {
  // Both opt-ins: the promotion checklist and the positions ledger. Pages already open ask for less and keep working.
  const data = await fetchJson(`${apiBase(pageSearch())}/checkpoint${CHECKPOINT_READ}`, MAX_PUBLIC_CHECKPOINT_BYTES);
  if (!validCheckpoint(data, { publicRead: true })) throw new Error('Invalid checkpoint.');
  return data;
}
// Performance over time (Oct 1, 2026): the Worker's archive of Profit, costs and Net. An older Worker has none: a 404.
async function loadScore() {
  const data = await fetchJson(`${apiBase(pageSearch())}/score`);
  const last = (value, key) => value === null || (value && typeof value === 'object' && Object.keys(value).length === 2
    && typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) && numeric(value[key]));
  if (data?.schema_version !== SCHEMA_VERSION || !Array.isArray(data.points) || data.points.length > HISTORY_LIMIT || !data.points.every(validScorePoint)
      || !last(data.last_profit, 'profit_usd') || !last(data.last_net, 'net_usd')) throw new Error('Invalid score history.');
  // `step_ms`: the archive's spacing once it is sampled (an older Worker sends none: five minutes).
  const step = Number.isSafeInteger(data.step_ms) && data.step_ms >= 300000 ? data.step_ms : 300000;
  return { points: data.points, last_profit: data.last_profit, last_net: data.last_net, step_ms: step };
}
async function loadHistory() {
  const data = await fetchJson(`${apiBase(pageSearch())}/history`);
  if (data?.schema_version !== SCHEMA_VERSION || !Array.isArray(data.points) || data.points.length > HISTORY_LIMIT
      || !data.points.every(point => typeof point.at === 'string' && Number.isFinite(Date.parse(point.at)) && numeric(point.equity))) throw new Error('Invalid balance history.');
  return data.points.map(point => ({ at: point.at, equity: point.equity }));
}
// The live tape prefers the WebSocket and keeps reading through polling when it drops.
function startFeed({ streams, onEvents, onStatus }) {
  let socket = null;
  let poller = null;
  let reconnect = null;
  let stopped = false;
  let latest = 0;
  const seen = new Set();
  const fresh = events => {
    const list = [];
    for (const event of events) {
      if (seen.has(event.id)) continue;
      if (seen.size > 4000) seen.clear();
      seen.add(event.id);
      if (event.seq > latest) latest = event.seq;
      list.push(event);
    }
    return list;
  };
  async function drain() {
    if (stopped || document.visibilityState !== 'visible') return;
    try {
      const batch = await loadEvents({ after: latest, limit: 100 });
      const events = fresh(batch.events.sort((left, right) => left.seq - right.seq));
      if (events.length) onEvents(events);
    } catch { /* The tape keeps the events it already holds. */ }
  }
  function poll() {
    if (poller || stopped) return;
    onStatus('polling');
    poller = setInterval(drain, 8000);
    drain();
  }
  function stopPolling() {
    if (poller) clearInterval(poller);
    poller = null;
  }
  function fallback() {
    socket = null;
    if (stopped) return;
    poll();
    if (!reconnect) reconnect = setTimeout(() => { reconnect = null; connect(); }, 60000);
  }
  function connect() {
    if (stopped) return;
    if (typeof WebSocket === 'undefined') { poll(); return; }
    let next;
    try { next = new WebSocket(streamUrl(streams, window.location)); } catch { fallback(); return; }
    socket = next;
    next.addEventListener('open', () => { stopPolling(); onStatus('live'); });
    next.addEventListener('message', message => {
      if (typeof message.data !== 'string' || message.data.length > MAX_SOCKET_MESSAGE) return;
      let value;
      try { value = JSON.parse(message.data); } catch { return; }
      if (value?.type === 'hello' || value?.type === 'pong') {
        if (Number.isSafeInteger(value.latest_seq) && value.latest_seq > latest && latest > 0) drain();
        return;
      }
      if (!validPublicEvent(value) || !socketMatches(streams, value.stream)) return;
      const events = fresh([value]);
      if (events.length) onEvents(events);
    });
    next.addEventListener('close', () => { if (socket === next) fallback(); });
    next.addEventListener('error', () => { if (socket === next) fallback(); });
  }
  const wake = () => { if (document.visibilityState === 'visible') { if (!socket) connect(); drain(); } };
  document.addEventListener('visibilitychange', wake);
  connect();
  return {
    prime(seq) { if (Number.isSafeInteger(seq) && seq > latest) latest = seq; },
    remember(events) { fresh(events); },
    stop() {
      stopped = true;
      stopPolling();
      if (reconnect) clearTimeout(reconnect);
      document.removeEventListener('visibilitychange', wake);
      try { socket?.close(1000, 'Page closed'); } catch { /* Already closed. */ }
    },
  };
}

// ---- drawing
const FEED_LINES = 12;
const NOTE_TEXT_LIMIT = 420;
const FEED_LABELS = { thinking: 'thinking', trading: 'trading', swarm: 'news' };
function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined && content !== null) node.textContent = content;
  if (className) node.className = className;
  return node;
}
function timeNode(value, style) {
  const node = element('time', date(value, style));
  node.dateTime = value;
  return node;
}
function svgElement(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
const tagNode = (text, kind) => element('span', text, `tag tag-${kind}`);
const moneyTag = (real, incubator = false) => {
  if (!incubator) return tagNode(real ? 'real money' : 'shadow', real ? 'real' : 'shadow');
  const tag = tagNode(INCUBATOR_WORDS.toLowerCase(), 'incubator');
  tag.setAttribute('title', INCUBATOR_TITLE);
  return tag;
};
// An agent's level as the page's own tag (TRAIN, VALIDATION, TUITION, …), its meaning on hover.
function levelTag(level) {
  const tag = tagNode(LEVEL_WORDS[level] || 'unknown', LEVEL_TAG_KIND[level] || 'band');
  if (LEVEL_TITLES[level]) tag.setAttribute('title', LEVEL_TITLES[level]);
  return tag;
}
// Whether the visitor asked for less motion (or the page cannot tell, as in a test).
const reducedMotion = () => typeof window === 'undefined' || typeof window.matchMedia !== 'function'
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function pulse(className = 'pulse') {
  const dot = element('span', null, className);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}
// CSSOM, not a style attribute: the page's policy allows the one and refuses the other.
function place(node, properties) {
  try { for (const [key, value] of Object.entries(properties)) node.style[key] = value; } catch { /* no layout here */ }
}
// Types a note out at a readable pace in about two seconds; off when the visitor asked for less motion.
const typers = new WeakMap();
function typeInto(node, text, animate = true) {
  const previous = typers.get(node);
  if (previous) clearTimeout(previous);
  const canAnimate = animate && typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!canAnimate || !text) { node.textContent = text; return; }
  const chunk = Math.max(2, Math.ceil(text.length / 90));
  let shown = 0;
  const step = () => {
    shown = Math.min(text.length, shown + chunk);
    node.textContent = text.slice(0, shown);
    if (shown < text.length) typers.set(node, setTimeout(step, 24));
    else typers.delete(node);
  };
  step();
}
// A chart's readout under the pointer: a mouse hovers it; a tap (pointerdown) shows the same and keeps it until the next tap
// anywhere outside the chart.
function readoutOn(plot, show, hide) {
  let away = null;
  const outside = event => {
    if (plot.contains?.(event.target)) return;
    hide();
    document.removeEventListener('pointerdown', outside, true);
    away = null;
  };
  const at = event => {
    show(event);
    if (event.pointerType !== 'mouse' && !away) { away = outside; document.addEventListener('pointerdown', outside, true); }
  };
  plot.addEventListener('pointermove', at);
  plot.addEventListener('pointerdown', at);
  plot.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') hide(); });
}
// The small line under Profit or Net: its path from the score archive to the headline. A dash in the headline leaves the
// last path the House could price, its end a hollow ring, and its label says there is no current figure. The label names
// the recorded span, never a basis: Profit is since the reset; the archive starts wherever the Worker began sampling.
const SCORE_KEYS = { profit: 'profit_usd', net: 'net_usd' };
function sparkline(series, label, { stale = false } = {}) {
  const box = element('span', null, `spark${series.tone ? ` ${series.tone}` : ''}`);
  const { width, height } = series;
  const first = series.points[0];
  const from = signedMoney(decimalOf(first.cents));
  const to = signedMoney(decimalOf(series.last.cents));
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', class: 'spark-svg', role: 'img',
    'aria-label': `${label}, recorded from ${date(new Date(first.at).toISOString())} to ${date(new Date(series.last.at).toISOString())}: ${from} to ${to}${stale ? '; no current figure' : ''}.`,
  });
  if (series.zeroY !== null) svg.append(svgElement('line', { x1: 0, x2: width, y1: series.zeroY.toFixed(1), y2: series.zeroY.toFixed(1), class: 'spark-zero' }));
  for (const segment of series.segments) svg.append(svgElement('path', { d: segment.path, class: 'spark-line' }));
  const cross = svgElement('line', { x1: 0, x2: 0, y1: 0, y2: height, class: 'balance-cross', opacity: 0 });
  svg.append(cross);
  const dot = element('span', null, `spark-dot${stale ? ' spark-stale' : ''}`);
  place(dot, { left: `${(series.last.x / width * 100).toFixed(2)}%`, top: `${(series.last.y / height * 100).toFixed(2)}%` });
  const readout = element('span', '', 'balance-readout');
  readout.hidden = true;
  box.append(svg, dot, readout);
  readoutOn(box, move => {
    try {
      const frame = svg.getBoundingClientRect();
      const x = (move.clientX - frame.left) / frame.width * width;
      const nearest = series.points.reduce((best, point) => (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best), series.points[0]);
      cross.setAttribute('x1', nearest.x.toFixed(1));
      cross.setAttribute('x2', nearest.x.toFixed(1));
      cross.setAttribute('opacity', '1');
      readout.textContent = `${signedMoney(decimalOf(nearest.cents))} · ${date(new Date(nearest.at).toISOString())}`;
      readout.hidden = false;
      // Anchored on the side with room, so a readout never pushes past the page's edge.
      const share = nearest.x / width * 100;
      place(readout, share < 50 ? { left: `${share.toFixed(2)}%`, right: 'auto' } : { left: 'auto', right: `${(100 - share).toFixed(2)}%` });
    } catch { /* no layout here */ }
  }, () => { readout.hidden = true; cross.setAttribute('opacity', '0'); });
  return box;
}
function numbersPanel(checkpoint, state) {
  const live = { profit: tradingProfit(checkpoint), net: netNumber(checkpoint) };
  return mastheadNumbers(checkpoint).map(item => {
    const row = element('div', null, `number number-${item.key}`);
    if (item.title) row.setAttribute('title', item.title);
    const value = element('dd', null, item.tone || null);
    const main = element('span', item.value, 'number-value');
    value.append(main);
    if (Object.hasOwn(SCORE_KEYS, item.key)) {
      const amount = live[item.key];
      const series = state.score ? sparkSeries(state.score.points, SCORE_KEYS[item.key],
        amount === null ? null : { at: Date.parse(checkpoint.published_at), cents: centsOf(amount) }) : null;
      if (series) value.append(sparkline(series, item.label, { stale: amount === null }));
      // A refresh that changes the number flashes it once, green up or red down; the first draw never does.
      const shown = state.shown[item.key];
      if (amount !== null && shown !== null && centsOf(amount) !== centsOf(shown)) state.washes[item.key] = centsOf(amount) > centsOf(shown) ? 'wash-up' : 'wash-down';
      state.shown[item.key] = amount;
      if (state.washes[item.key]) main.className = `number-value ${state.washes[item.key]}`;
    }
    if (item.key === 'clock') {
      const tick = element('span', item.tick, 'number-tick');
      value.append(tick);
      state.clock = item.startedAt === null ? null : { main, tick, startedAt: item.startedAt };
    }
    if (item.note) value.append(element('span', item.note, 'number-note negative'));
    row.append(element('dt', item.label), value);
    return row;
  });
}
// The card's next note. A note keeps the card for its reading time; then the oldest queued live note takes it (anything more
// than three minutes behind the newest queued one dropped first, to the feed). With nothing queued the card keeps its note;
// the page's first draw takes the newest note (the prior rule).
function nextHero(state) {
  const current = state.hero?.note || null;
  if (current && Date.now() < state.hero.readUntil) return current;
  state.heroQueue = trimQueue(state.heroQueue);
  if (state.heroQueue.length) return noteHero(state.heroQueue.shift());
  return current || heroNote(state.feed, state.hero?.agent || null);
}
function holdHero(state, until) {
  state.hero.readUntil = until;
  clearTimeout(state.heroTimer);
  if (!Number.isFinite(until)) return;
  state.heroTimer = setTimeout(() => state.drawLive(), Math.max(0, until - Date.now()) + 10);
  state.heroTimer?.unref?.();
}
// While the card says "deciding now", its speaker's dot on the board breathes: one dot at a time, never inside the
// collapsed retired summary, toggled on the dots as drawn.
function speak(state, id) {
  state.speaking = id || null;
  for (const [agent, node] of state.dotNodes || []) {
    const classes = String(node.className).split(' ').filter(name => name && name !== 'dot-speaking');
    const hidden = node.dataset?.level === 'retired' && !state.showRetired;
    if (agent === state.speaking && !hidden) classes.push('dot-speaking');
    const next = classes.join(' ');
    if (next !== node.className) node.className = next;
  }
}
function drawHeroInto(box, state) {
  // Notes waiting shorten the hold of the note on the card (never below what its reader asked for).
  if (state.hero?.note && state.heroQueue.length && Number.isFinite(state.hero.readUntil)) {
    const due = Math.max(state.hero.keepUntil || 0, state.hero.shownAt + holdFor(state.hero.note.text, true));
    if (due < state.hero.readUntil) holdHero(state, due);
  }
  const hero = nextHero(state);
  if (!hero) {
    box.replaceChildren(element('p', state.checkpoint ? 'No agent has written a note yet.' : state.asked ? 'Nothing is running right now.' : 'Connecting…', 'empty-state now-empty'));
    state.hero = null;
    speak(state, null);
    return;
  }
  const agent = state.agents.get(hero.agent) || null;
  if (!state.hero || state.hero.agent !== hero.agent) {
    const card = element('article', null, 'now');
    const head = element('div', null, 'now-head');
    const when = element('span', '', 'now-when');
    // The name opens its dot on the board, as clicking the dot does; an agent off the roster has no dot.
    const name = element(agent ? 'button' : 'span', '', 'now-name');
    if (agent) {
      name.type = 'button';
      name.setAttribute('aria-controls', 'agent-detail');
      name.setAttribute('title', 'Show this agent on the board');
      name.addEventListener('click', () => state.openAgent?.(hero.agent));
    }
    const band = element('span', null, 'now-band');
    const queue = element('button', '', 'feed-count now-queue');
    queue.type = 'button';
    queue.hidden = true;
    queue.addEventListener('click', () => {
      if (!state.heroQueue.length || !state.hero) return;
      // Straight to the newest: the notes between drop into the feed.
      state.heroQueue = [state.heroQueue.at(-1)];
      state.hero.keepUntil = 0;
      holdHero(state, 0);
      state.drawLive();
    });
    head.append(pulse('pulse now-pulse'), name, band, queue, when);
    const thought = element('p', '', 'now-thought');
    const more = element('button', 'Read more', 'thought-more');
    more.type = 'button';
    more.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Less' : 'Read more';
      thought.className = `now-thought${open ? ' thought-open' : ''}`;
      typeInto(thought, open ? state.hero.note.text : truncate(state.hero.note.text, NOTE_TEXT_LIMIT).text, false);
      // Do not replace an expanded thought until the reader closes it.
      state.hero.keepUntil = open ? Infinity : Date.now() + 12000;
      holdHero(state, state.hero.keepUntil);
    });
    card.append(head, thought, more);
    state.hero = { agent: hero.agent, id: '', parts: { card, when, thought, name, band, queue, more } };
    box.replaceChildren(card);
  }
  const { parts } = state.hero;
  parts.name.textContent = hero.display_name || (agent ? agentName(agent) : titleCase(hero.agent));
  const level = agent ? levelOf(agent, state.checkpoint) : null;
  parts.band.replaceChildren(...(agent ? [levelTag(level)] : []));
  const recent = Date.now() - Date.parse(hero.at) < 180000;
  parts.when.textContent = recent ? 'deciding now' : `last note ${ago(hero.at)}`;
  parts.card.className = `now${REAL_LEVELS.includes(level) ? ' now-real' : ''}${recent ? '' : ' now-idle'}`;
  if (state.hero.id !== hero.id) {
    state.hero.id = hero.id;
    state.hero.note = hero;
    state.hero.shownAt = Date.now();
    state.hero.keepUntil = 0;
    parts.more.hidden = !truncate(hero.text, NOTE_TEXT_LIMIT).truncated;
    parts.more.setAttribute('aria-expanded', 'false');
    parts.more.textContent = 'Read more';
    parts.thought.className = 'now-thought';
    holdHero(state, Date.now() + holdFor(hero.text, state.heroQueue.length > 0));
    typeInto(parts.thought, truncate(hero.text, NOTE_TEXT_LIMIT).text);
  }
  const waiting = state.heroQueue.length;
  parts.queue.hidden = !waiting;
  parts.queue.textContent = waiting ? `+${waiting}` : '';
  if (waiting) parts.queue.setAttribute('aria-label', `${waiting} more ${waiting === 1 ? 'note' : 'notes'}; show the newest`);
  speak(state, recent ? hero.agent : null);
}
function feedItem(line, state, fresh) {
  const item = element('li', null, `feed-line line-${line.kind}${line.real === false ? ' line-shadow' : ''}${fresh ? ' line-new' : ''}`);
  item.append(timeNode(line.at, 'hm'), element('span', FEED_LABELS[line.kind], `feed-kind kind-${line.kind}`));
  const who = element('span', null, 'feed-who');
  who.append(element('span', line.name, 'feed-name'));
  if (line.real !== null) who.append(moneyTag(line.real));
  const open = state.expanded.has(line.id);
  const expandable = line.kind === 'thinking' || Boolean(line.why);
  const body = element(expandable ? 'button' : 'span', null, `feed-text${open ? ' feed-open' : ''}`);
  if (expandable) {
    body.type = 'button';
    body.setAttribute('aria-expanded', open ? 'true' : 'false');
    body.addEventListener('click', () => {
      if (state.expanded.has(line.id)) state.expanded.delete(line.id); else state.expanded.add(line.id);
      state.drawFeed();
    });
  }
  // A trade carries its agent's own reason inline, muted; open or folded, the words are the same. Its title says whose
  // words they are, at the open or at the close.
  const text = element('span', line.text, 'feed-words');
  if (line.why) {
    const why = element('span', ` — ${line.why}`, 'feed-why');
    why.setAttribute('title', line.action === 'close' ? WHY_TITLES.closed : WHY_TITLES.note);
    text.append(why);
  }
  body.append(text);
  if (line.pnl) body.append(element('b', line.pnl, `feed-pnl ${line.tone}`.trim()));
  if (line.count > 1) body.append(element('span', `×${line.count}`, 'feed-count'));
  item.append(who, body);
  return item;
}
function drawFeedInto(list, state) {
  // The card's note and the notes queued for it are not repeated below: a note reaches the feed once the card has shown it
  // or skipped it.
  const lines = feedLines(state.feed, state.names, { limit: FEED_LINES, skip: [state.hero?.id, ...state.heroQueue.map(event => event.id)] });
  const items = lines.map(line => feedItem(line, state, state.primed && !state.rendered.has(line.id)));
  state.rendered = new Set(lines.map(line => line.id));
  state.primed = true;
  list.replaceChildren(...(items.length ? items : [element('li', 'Quiet for now. Lines appear here as the agents decide, trade and are born or retired.', 'empty-state')]));
}
// `marks`: the agents' positions (`chartMarks`), a gold dot at each opening on the bottom edge; the dashed rule is the chart's
// starting balance.
function balanceChart(series, marks = []) {
  const figure = element('figure', null, `balance balance-${series.tone || 'flat'}`);
  const { width, height } = series;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', class: 'balance-svg',
    role: 'img', 'aria-label': `Brokerage Account balance, ${money(series.first.equity.toFixed(2))} to ${money(series.last.equity.toFixed(2))}.`,
  });
  svg.append(svgElement('path', { d: series.area, class: 'balance-area' }),
    svgElement('line', { x1: 0, x2: width, y1: series.first.y, y2: series.first.y, class: 'balance-start' }),
    svgElement('path', { d: series.path, class: 'balance-line' }));
  const cross = svgElement('line', { x1: 0, x2: 0, y1: 0, y2: height, class: 'balance-cross', opacity: 0 });
  svg.append(cross);
  const plot = element('div', null, 'balance-plot');
  const dots = marks.map(mark => {
    const dot = element('span', null, `balance-mark${mark.open ? ' balance-mark-open' : ''}`);
    dot.setAttribute('aria-hidden', 'true');
    place(dot, { left: `${(mark.x / width * 100).toFixed(2)}%` });
    return dot;
  });
  const end = element('span', null, 'balance-dot');
  place(end, { left: `${(series.last.x / width * 100).toFixed(2)}%`, top: `${(series.last.y / height * 100).toFixed(2)}%` });
  const readout = element('span', '', 'balance-readout');
  readout.hidden = true;
  plot.append(svg, ...dots, end, readout);
  readoutOn(plot, move => {
    try {
      const box = svg.getBoundingClientRect();
      const offset = move.clientX - box.left;
      const x = offset / box.width * width;
      // Within 8 px of an agent's mark, the readout names that position instead of the balance.
      const mark = marks.reduce((best, entry) => {
        const distance = Math.abs(entry.x / width * box.width - offset);
        return distance <= 8 && (!best || distance < best.distance) ? { entry, distance } : best;
      }, null)?.entry;
      const nearest = series.points.reduce((best, point) => (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best), series.points[0]);
      const at = mark ? mark.x : nearest.x;
      cross.setAttribute('x1', at.toFixed(1));
      cross.setAttribute('x2', at.toFixed(1));
      cross.setAttribute('opacity', '1');
      readout.textContent = mark ? mark.label : `${money(nearest.equity.toFixed(2))} · ${date(new Date(nearest.at).toISOString())}`;
      readout.hidden = false;
      place(readout, { left: `${Math.min(80, Math.max(0, at / width * 100 - 10)).toFixed(2)}%` });
    } catch { /* no layout here */ }
  }, () => { readout.hidden = true; cross.setAttribute('opacity', '0'); });
  figure.append(plot);
  return figure;
}
function accountPanel(checkpoint, marks) {
  const series = accountSeries(marks, checkpoint);
  const nodes = series ? [balanceChart(series, chartMarks(checkpoint, series))] : [];
  const account = checkpoint?.account;
  const caption = element('p', null, 'balance-caption');
  if (account) {
    const balance = element('span', money(account.equity), 'balance-current');
    balance.setAttribute('aria-label', `Current account balance ${money(account.equity)}`);
    caption.append(balance, element('span', '·'), timeNode(account.as_of));
    if (account.stale) caption.setAttribute('title', 'Last recorded balance; the account could not be refreshed.');
  } else caption.append(element('span', 'No balance yet.'));
  nodes.push(caption);
  return nodes;
}
// The ledger under the chart: one table, open positions then closed, and the lines that make up Profit in its footer.
// On a phone each row stacks into a short block (capital.css); the table never widens the page.
export const POSITION_COLUMNS = [['who', 'Who'], ['what', 'Position'], ['qty', 'Qty'], ['expiry', 'Expiry'], ['opened', 'Opened'],
  ['closed', 'Closed'], ['pnl', 'P&L'], ['share', 'Share']];
const COLUMN_TITLES = {
  opened: 'New York time.', closed: 'New York time.', pnl: 'After fees: realized when closed, at the current value while open.',
  share: 'The line’s P&L as a share of Profit. Shares add up to 100%; a negative share moved against the total.',
};
function cell(tag, className, content) {
  const node = element(tag, content, `pos-${className}`);
  if (tag === 'th') node.setAttribute('scope', 'row');
  return node;
}
function stampCell(className, value, note = '') {
  const node = cell('td', className);
  if (!value) return node;
  const time = element('time', date(value, 'short'));
  time.dateTime = value;
  time.setAttribute('title', note ? `${date(value)} · ${note}` : date(value));
  node.append(time);
  return node;
}
// One position, and under it (hidden until its reason is tapped) the family's thesis across the table. `wash`: the open
// row's P&L moved since the last draw.
function positionRow(line, state, wash = '') {
  const unfolded = Boolean(line.thesis) && state.openWhy.has(line.id);
  const row = element('tr', null, `pos-row pos-${line.source}${line.open ? ' pos-open' : ''}${unfolded ? ' why-open' : ''}`);
  row.dataset.position = line.id;
  let closed;
  if (line.open) {
    closed = cell('td', 'closed pos-still-open');
    closed.append(pulse(), element('span', 'open'));
  } else closed = stampCell('closed', line.closedAt, EXIT_TITLES[line.exit] || '');
  // An agent's row keeps its name, with its route beside it (the incubator's label as before).
  const route = ROUTE_TAGS[line.routeKey] && line.route ? ROUTE_TAGS[line.routeKey] : null;
  const who = cell('th', 'who', route ? null : line.who);
  if (route) {
    const tag = tagNode(line.route, route.kind);
    if (line.routeKey !== 'incubator') tag.className += ' tag-route';
    tag.setAttribute('title', route.title);
    who.append(element('span', line.who), tag);
  }
  const what = cell('td', 'what', line.what);
  let detail = null;
  if (line.why) {
    const quoted = `“${line.why}”`;
    const whose = WHY_TITLES[line.whyFrom] || '';
    if (line.thesis) {
      const id = `why-${line.id.replace(/[^A-Za-z0-9-]+/g, '-')}`;
      const reason = element('button', quoted, 'pos-why');
      reason.type = 'button';
      reason.setAttribute('aria-expanded', String(unfolded));
      reason.setAttribute('aria-controls', id);
      if (whose) reason.setAttribute('title', line.whyFrom === 'note' ? `${whose} ${WHY_TITLES.fold}` : whose);
      detail = element('tr', null, 'pos-why-row');
      detail.id = id;
      detail.hidden = !unfolded;
      const holder = element('td');
      holder.setAttribute('colspan', String(POSITION_COLUMNS.length));
      const card = element('div', null, 'pos-why-card');
      card.append(element('p', line.thesis, 'pos-thesis'));
      if (line.maxLoss) card.append(element('p', `max loss ${money(line.maxLoss, 0)}`, 'pos-why-meta'));
      holder.append(card);
      detail.append(holder);
      // A tap unfolds or folds the thesis in place; the table is not redrawn, and the 30-second redraw keeps it open.
      reason.addEventListener('click', () => {
        const opening = !state.openWhy.has(line.id);
        if (opening) state.openWhy.add(line.id); else state.openWhy.delete(line.id);
        detail.hidden = !opening;
        reason.setAttribute('aria-expanded', String(opening));
        const classes = String(row.className).split(' ').filter(name => name && name !== 'why-open');
        row.className = [...classes, ...(opening ? ['why-open'] : [])].join(' ');
      });
      what.append(reason);
    } else {
      const reason = element('span', quoted, 'pos-why');
      if (whose) reason.setAttribute('title', whose);
      what.append(reason);
    }
  }
  const pnl = cell('td', `pnl ${line.tone}${wash ? ` ${wash}` : ''}`.trim(), line.pnl);
  const risk = riskTitle(line.usd, line.maxLoss);
  if (risk) pnl.setAttribute('title', risk);
  row.append(who, what, cell('td', 'qty', line.quantity), cell('td', 'expiry', line.expiry),
    stampCell('opened', line.openedAt), closed, pnl, cell('td', 'share', line.share));
  return detail ? [row, detail] : [row];
}
function sumRow(line) {
  const row = element('tr', null, `pos-sum pos-${line.key}`);
  const detail = cell('td', 'what pos-detail', line.detail);
  detail.setAttribute('colspan', '5');
  row.append(cell('th', 'who', line.label), detail, cell('td', `pnl ${line.tone}`.trim(), line.pnl), cell('td', 'share', line.share));
  return row;
}
function groupBody(label, rows) {
  const body = element('tbody', null, `pos-body pos-body-${label.toLowerCase()}`);
  const head = element('tr', null, 'pos-group');
  const title = element('th', label);
  title.setAttribute('scope', 'rowgroup');
  title.setAttribute('colspan', String(POSITION_COLUMNS.length));
  head.append(title);
  body.append(head, ...rows);
  return body;
}
function positionsPanel(checkpoint, state, now = Date.now()) {
  const ledger = positionsLedger(checkpoint, now);
  if (!ledger) return [element('p', 'No positions have been published yet.', 'empty-state')];
  // A row that left the ledger (folded into the positions not listed) leaves the set of unfolded reasons too.
  const listed = new Set([...ledger.open, ...ledger.closed].map(line => line.id));
  for (const id of state.openWhy) if (!listed.has(id)) state.openWhy.delete(id);
  const caption = element('p', null, 'positions-caption');
  caption.append(element('span', positionsLine(ledger)));
  if (Number.isFinite(Date.parse(ledger.asOf))) caption.append(element('span', '·'), element('span', 'as of'), timeNode(ledger.asOf));
  const table = element('table', null, 'positions-table');
  table.append(element('caption', 'Real positions on the Brokerage Account since the reset, and the lines that add up to Profit.', 'visually-hidden'));
  const head = element('thead');
  const headings = element('tr');
  for (const [key, label] of POSITION_COLUMNS) {
    const heading = element('th', label, `pos-${key}`);
    heading.setAttribute('scope', 'col');
    if (COLUMN_TITLES[key]) heading.setAttribute('title', COLUMN_TITLES[key]);
    headings.append(heading);
  }
  head.append(headings);
  table.append(head);
  // An open row the House revalued since the last draw washes once on its P&L; the first draw never does.
  const washOf = line => {
    const before = state.lastPnl.get(line.id);
    if (!line.open || line.usd === null || before === undefined || before === null || centsOf(before) === centsOf(line.usd)) return '';
    return centsOf(line.usd) > centsOf(before) ? 'wash-up' : 'wash-down';
  };
  if (ledger.open.length) table.append(groupBody('Open', ledger.open.flatMap(line => positionRow(line, state, washOf(line)))));
  if (ledger.closed.length) table.append(groupBody('Closed', ledger.closed.flatMap(line => positionRow(line, state))));
  state.lastPnl = new Map([...ledger.open, ...ledger.closed].map(line => [line.id, line.usd]));
  if (!ledger.open.length && !ledger.closed.length && !ledger.earlier) {
    const body = element('tbody', null, 'pos-body pos-body-empty');
    const row = element('tr', null, 'pos-empty');
    const empty = element('td', 'No real positions yet.', 'empty-state');
    empty.setAttribute('colspan', String(POSITION_COLUMNS.length));
    row.append(empty);
    body.append(row);
    table.append(body);
  }
  const foot = element('tfoot');
  // The positions not listed sit with the other lines that are not one position: never under Closed, since an open
  // position the table cannot describe is counted there too.
  foot.append(...(ledger.earlier ? [sumRow(ledger.earlier)] : []), sumRow(ledger.other), ...(ledger.unreconciled ? [sumRow(ledger.unreconciled)] : []),
    sumRow(ledger.total));
  foot.setAttribute('title', 'Every line above adds up to Profit, to the cent.');
  table.append(foot);
  const scroll = element('div', null, 'positions-scroll');
  scroll.append(table);
  return [caption, scroll];
}

// The practice league under the agents: one quiet table, the House's rows in its order, and the totals over every family.
// Hidden while the House publishes no block.
function practicePanel(checkpoint) {
  const league = practiceTable(checkpoint);
  if (!league) return null;
  const caption = element('p', null, 'positions-caption practice-caption');
  caption.append(element('span', PRACTICE_CAPTION));
  if (Number.isFinite(Date.parse(league.asOf))) caption.append(element('span', '·'), element('span', 'as of'), timeNode(league.asOf));
  const table = element('table', null, 'positions-table practice-table');
  table.append(element('caption', `The practice league: ${PRACTICE_CAPTION}`, 'visually-hidden'));
  const head = element('thead');
  const headings = element('tr');
  for (const [key, label] of PRACTICE_COLUMNS) {
    const heading = element('th', label, `pr-${key}`);
    heading.setAttribute('scope', 'col');
    headings.append(heading);
  }
  head.append(headings);
  const body = element('tbody', null, 'pos-body');
  for (const line of league.rows) {
    const row = element('tr', null, `pr-row${line.retired ? ' pr-retired' : ''}`);
    row.dataset.agent = line.agent;
    const who = element('th', line.retired ? null : line.who, 'pr-who');
    who.setAttribute('scope', 'row');
    if (line.retired) who.append(element('span', line.who), tagNode('retired', 'retired'));
    row.append(who, element('td', line.what, 'pr-what'), element('td', line.tier, 'pr-tier'), element('td', line.sessions, 'pr-sessions'),
      element('td', line.trades, 'pr-trades'), element('td', line.wins, 'pr-wins'), element('td', line.pnl, `pr-pnl ${line.tone}`.trim()),
      element('td', line.ror, `pr-ror ${line.rorTone}`.trim()));
    body.append(row);
  }
  if (!league.rows.length) {
    const row = element('tr', null, 'pos-empty');
    const empty = element('td', 'No practice trades yet.', 'empty-state');
    empty.setAttribute('colspan', String(PRACTICE_COLUMNS.length));
    row.append(empty);
    body.append(row);
  }
  const foot = element('tfoot');
  const total = element('tr', null, 'pos-sum pr-total');
  const label = element('th', league.hidden ? `${league.total.label} (${league.hidden} not listed)` : league.total.label, 'pr-who');
  label.setAttribute('scope', 'row');
  const blank = element('td', '', 'pr-what');
  blank.setAttribute('colspan', '3');
  total.append(label, blank, element('td', league.total.trades, 'pr-trades'), element('td', league.total.wins, 'pr-wins'),
    element('td', league.total.pnl, `pr-pnl ${league.total.tone}`.trim()), element('td', '', 'pr-ror'));
  foot.append(total);
  table.append(head, body, foot);
  const scroll = element('div', null, 'positions-scroll');
  scroll.append(table);
  return [caption, scroll];
}

// The game's six rungs, top to bottom, placed by each agent's level (the House's `levels`; for an older House, `levelOf`).
// The side path (the Incubator, then Practice) stands on Train, first in its row; a retired agent that still holds money
// stands on its money's rung. A dot never implies a future promotion.
export const AGENT_STAGES = [
  { level: 6, key: 'sized', label: 'Sized', levels: ['sized'], real: true },
  { level: 5, key: 'probe', label: 'Probe', levels: ['probe'], real: true },
  { level: 4, key: 'candidate', label: 'Candidate', levels: ['candidate'] },
  { level: 3, key: 'tuition', label: 'Tuition', levels: ['tuition'], real: true },
  { level: 2, key: 'validation', label: 'Validation', levels: ['validation'] },
  { level: 1, key: 'train', label: 'Train', levels: ['incubator', 'practice', 'train'] },
];
// The rung number a level stands on; null for a retired agent's level (the collapsed summary).
export const rungOf = level => AGENT_STAGES.find(stage => stage.levels.includes(level))?.level ?? null;
export function agentStages(checkpoint) {
  const rows = swarmRows(checkpoint);
  return AGENT_STAGES.map(stage => ({ ...stage, agents: rows.filter(row => stage.levels.includes(row.level))
    .sort((left, right) => stage.levels.indexOf(left.level) - stage.levels.indexOf(right.level) || rankOf(left.band) - rankOf(right.band)
      || left.id.localeCompare(right.id)) }));
}

function progressRing(progress) {
  const ring = svgElement('svg', { viewBox: '0 0 36 36', class: 'agent-progress-ring', 'aria-hidden': 'true' });
  ring.append(svgElement('circle', { cx: 18, cy: 18, r: 14, class: 'agent-progress-track' }));
  if (progress && progress.fraction > 0) {
    ring.append(svgElement('circle', { cx: 18, cy: 18, r: 14, pathLength: 100, class: 'agent-progress-fill',
      'stroke-dasharray': `${(100 * progress.fraction).toFixed(2)} 100` }));
  }
  return ring;
}

function progressDetail(progress, band) {
  const panel = element('div', null, 'agent-progress');
  if (!progress) {
    if (band !== 'retired') panel.append(element('p', 'Progress unavailable', 'progress-unavailable'));
    return panel;
  }
  const head = element('div', null, 'progress-heading');
  head.append(element('span', progress.target === 'maintain' ? progress.label : `Next · ${progress.label}`),
    element('span', progress.count, 'progress-count'));
  panel.append(head);
  const list = element('ul', null, 'progress-checks');
  for (const check of progress.checks) {
    const item = element('li', null, `progress-check${check.met ? ' check-met' : ''}`);
    const marker = element('span', check.met ? '✓' : '·', 'check-mark');
    marker.setAttribute('aria-hidden', 'true');
    const count = check.need === 1 ? (check.met ? 'Met' : 'Not met') : `${check.done.toLocaleString('en-US')} / ${check.need.toLocaleString('en-US')}`;
    item.append(marker, element('span', check.label, 'check-label'), element('span', count, 'check-count'));
    const meter = element('span', null, 'check-meter');
    const fill = element('span');
    place(fill, { width: `${100 * check.fraction}%` });
    meter.setAttribute('aria-hidden', 'true'); meter.append(fill); item.append(meter);
    list.append(item);
  }
  panel.append(list);
  if (progress.blocker) panel.append(element('p', progress.blocker, 'progress-blocker'));
  else if (progress.ready) panel.append(element('p', progress.target === 'maintain' ? 'Holding the line' : 'Checks complete', 'progress-ready'));
  return panel;
}
function agentDetail(row, checkpoint, state) {
  const card = element('article', null, 'agent-detail-card');
  const head = element('div', null, 'agent-detail-head');
  const name = element('h3', row.name);
  const close = element('button', '×', 'agent-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close agent details');
  close.addEventListener('click', () => state.selectAgent(null, row.id));
  head.append(name, levelTag(row.level), close);
  // The family's thesis under the page's sentence rules, never the raw mechanism; none survives, only the structure shows.
  const strategy = element('p', null, 'agent-strategy');
  if (row.structure) strategy.append(element('span', row.structure, 'strategy-tag'));
  const thesis = agentThesis(checkpoint, row.id);
  if (thesis) strategy.append(element('span', thesis));
  card.append(head, strategy);
  const record = element('p', null, 'agent-record');
  record.setAttribute('title', 'Closed trades and training attempts. Forward results are simulated.');
  record.append(element('span', row.record.main, row.record.tone));
  if (row.record.rest) record.append(element('span', row.record.rest));
  card.append(record);
  card.append(progressDetail(row.progress, row.band));
  const positions = structureRows(checkpoint).filter(position => position.agent === row.id);
  if (positions.length) {
    const list = element('ul', null, 'agent-positions');
    const reasons = tradeReasons(checkpoint);
    for (const position of positions) {
      const item = element('li');
      item.append(moneyTag(position.real, position.incubator), element('span', `${position.what} · ${position.detail}`),
        element('span', `max loss ${position.maxLoss}`), element('span', position.pnl, position.tone));
      // A real structure and its ledger row share an id (`real:<n>`): the agent's own reason for it.
      const why = position.real ? reasons.get(position.id)?.openWhy : null;
      if (why) {
        const quote = element('span', `“${why}”`, 'agent-position-why');
        quote.setAttribute('title', WHY_TITLES.note);
        item.append(quote);
      }
      list.append(item);
    }
    card.append(list);
  }
  return card;
}
function agentsPanel(checkpoint, state) {
  const board = element('div', null, 'agent-board');
  // The key sits on the heading line, anchored to the section (capital.css), so the funnel caption never meets it.
  const key = element('span', 'Promotion progress', 'agent-board-key');
  key.setAttribute('title', 'The ring fills as the current program meets its next-stage checks. Click an agent for the remaining checks.');
  const funnel = funnelLine(checkpoint);
  const caption = funnel ? element('p', funnel, 'agents-funnel') : null;
  if (caption) caption.setAttribute('title', FUNNEL_TITLE);
  const rows = swarmRows(checkpoint);
  const details = element('div', null, 'agent-detail');
  details.id = 'agent-detail';
  details.setAttribute('aria-live', 'polite');
  board.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.selectedAgent) { event.preventDefault(); state.selectAgent(null, state.selectedAgent); }
  });
  const buttons = new Map();
  state.dotNodes = buttons;
  const detailHosts = new Map();
  const rowById = new Map(rows.map(row => [row.id, row]));
  state.selectAgent = (id, focusId = null) => {
    state.selectedAgent = rowById.has(id) ? id : null;
    const row = rowById.get(state.selectedAgent);
    for (const [agent, button] of buttons) button.setAttribute('aria-expanded', String(agent === state.selectedAgent));
    details.replaceChildren(...(row ? [agentDetail(row, checkpoint, state)] : []));
    details.hidden = !row;
    if (row) detailHosts.get(row.id)?.append(details);
    if (focusId) buttons.get(focusId)?.focus?.({ preventScroll: true });
  };
  const dots = (list, host) => {
    const group = element('div', null, 'agent-dots');
    for (const row of list) {
      const button = element('button', null, `agent-dot dot-${row.band} level-${row.level}`);
      button.type = 'button';
      button.dataset.agent = row.id;
      button.dataset.band = row.band;
      button.dataset.level = row.level;
      const progressLabel = row.progress ? `${row.progress.count} · ${row.progress.label}${row.progress.blocker ? ` · ${row.progress.blocker}` : ''}`
        : row.band === 'retired' ? '' : 'Progress unavailable';
      // A retired agent on a money rung says so: the sighted cue is its small dotted core.
      const retired = row.band === 'retired' && row.level !== 'retired' ? ' · retired' : '';
      const label = `${row.name} · ${row.levelText} · ${row.structure || 'strategy pending'}${progressLabel ? ` · ${progressLabel}` : ''}${retired}`;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-controls', details.id);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('title', label);
      if (row.band !== 'retired') button.append(progressRing(row.progress));
      button.append(element('span', null, 'agent-dot-core'));
      button.addEventListener('click', () => {
        const opening = state.selectedAgent !== row.id;
        state.selectAgent(opening ? row.id : null);
        if (opening) {
          const animate = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          details.scrollIntoView?.({ block: 'nearest', behavior: animate ? 'smooth' : 'auto' });
        }
      });
      buttons.set(row.id, button);
      detailHosts.set(row.id, host);
      group.append(button);
    }
    if (!list.length) { const empty = element('span', '—', 'stage-empty'); empty.setAttribute('aria-hidden', 'true'); group.append(empty); }
    return group;
  };
  for (const stage of agentStages(checkpoint)) {
    // A vacant rung keeps its place as one short line, so the climb ahead stays in view.
    const section = element('section', null, `agent-stage stage-${stage.level}${stage.real ? ' stage-real' : ''}${stage.agents.length ? '' : ' stage-vacant'}`);
    const heading = element('h3', null, 'stage-heading');
    heading.id = `agent-stage-${stage.level}`;
    heading.setAttribute('title', LEVEL_TITLES[stage.key]);
    heading.append(element('span', String(stage.level), 'stage-level'), element('span', stage.label, 'stage-label'),
      element('span', String(stage.agents.length), 'stage-count'));
    section.setAttribute('aria-labelledby', heading.id);
    section.append(heading, dots(stage.agents, section));
    board.append(section);
  }
  // A retired agent that still holds money stands on its money's rung; the rest fold away here.
  const retired = rows.filter(row => row.level === 'retired');
  if (retired.length) {
    const archive = element('details', null, 'agents-retired');
    archive.open = state.showRetired;
    // Opening the summary lets a retired speaker's dot breathe at once, without waiting for the next draw.
    archive.addEventListener('toggle', () => { state.showRetired = archive.open; speak(state, state.speaking); });
    archive.append(element('summary', `${retired.length} retired`), dots(retired, archive));
    board.append(archive);
  }
  board.append(details);
  state.selectAgent(state.selectedAgent);
  return [key, ...(caption ? [caption] : []), board];
}

// A live publication produces one short ripple. Historical batches, hidden tabs, stale events,
// retired agents and reduced-motion readers never get simulated activity.
export function freshAgentActivity(event, now = Date.now()) {
  const age = now - Date.parse(event?.at);
  if (!Number.isFinite(age) || age < -60000 || age > 120000) return null;
  if (event.kind === 'agent.note' || event.kind === 'agent.trade') return streamAgentOf(event.stream);
  return event.kind === 'swarm.news' ? event.payload?.agent : null;
}
function pulseAgents(events, state) {
  if (document.visibilityState !== 'visible' || !floorRunning(state.checkpoint)
      || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const now = Date.now();
  for (const event of events) {
    const id = freshAgentActivity(event, now);
    const button = state.dotNodes?.get(id);
    if (!button || String(button.className).includes('dot-retired') || state.pulsing >= 4
        || now - (state.lastPulse.get(id) || 0) < 8000) continue;
    const box = button.getBoundingClientRect?.();
    if (!box || box.bottom < 0 || box.top > window.innerHeight) continue;
    state.lastPulse.set(id, now); state.pulsing += 1;
    const ring = element('span', null, `agent-activity${event.kind === 'agent.trade' ? ' activity-trade' : ''}`);
    ring.setAttribute('aria-hidden', 'true'); button.append(ring);
    const timer = setTimeout(() => { ring.remove?.(); state.pulsing -= 1; state.pulseTimers.delete(timer); }, 900);
    state.pulseTimers.add(timer);
  }
}

export function settleAgents(state) {
  const previous = state.agentPositions;
  const positions = new Map();
  const animate = previous.size && document.visibilityState === 'visible' && floorRunning(state.checkpoint)
    && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const [id, node] of state.dotNodes || []) {
    const box = node.getBoundingClientRect?.();
    if (!box || !box.width || !box.height) continue;
    // A dot's rung follows its level, not its band: a promotion from Train to Validation glides up one rung.
    const level = node.dataset.level;
    const fill = node.querySelector?.('.agent-progress-fill');
    const dash = fill?.getAttribute('stroke-dasharray');
    positions.set(id, { x: box.left + window.scrollX, y: box.top + window.scrollY, level, dash });
    const old = previous.get(id);
    if (!animate || !old || box.bottom < 0 || box.top > window.innerHeight || level === 'retired') continue;
    const current = positions.get(id);
    if (rungOf(old.level) !== rungOf(level)) {
      node.animate?.([{ transform: `translate(${old.x - current.x}px, ${old.y - current.y}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 700, easing: 'cubic-bezier(.2,.7,.2,1)' });
    } else if (dash && old.dash !== dash) {
      fill.animate?.([{ strokeDasharray: old.dash || '0 100' }, { strokeDasharray: dash }], { duration: 650, easing: 'ease-out' });
    }
  }
  state.agentPositions = positions;
}

async function startPage(root) {
  const find = id => root.querySelector(`#${id}`);
  const box = {
    numbers: find('floor-numbers'), costs: find('floor-costs'), status: find('floor-status'), now: find('floor-now'), feed: find('floor-feed'),
    account: find('floor-account'), positions: find('floor-positions'), agents: find('floor-agents'), practice: find('floor-league'),
    practiceSection: find('practice-league'),
  };
  const state = {
    checkpoint: null, agents: new Map(), names: new Map(), feed: [], marks: [], mode: 'loading',
    hero: null, rendered: new Set(), primed: false, expanded: new Set(), selectedAgent: null, showRetired: false, clock: null,
    lastPulse: new Map(), pulseTimers: new Set(), pulsing: 0, agentPositions: new Map(),
    // The owner's ideas (Oct 1, 2026): the score archive, the card's queue of live notes, the last Profit and Net drawn (for
    // the flash), each position's last P&L (for the wash), the reasons unfolded, and the dot that is speaking.
    score: null, heroQueue: [], shown: { profit: null, net: null }, washes: {}, lastPnl: new Map(), openWhy: new Set(), speaking: null,
  };
  const ready = node => node && node.setAttribute('aria-busy', 'false');
  const drawn = (node, children) => { if (!node) return; node.replaceChildren(...children); ready(node); };
  const drawStatus = () => {
    if (!box.status) return;
    const live = state.mode === 'live' || state.mode === 'polling';
    const stopped = !floorRunning(state.checkpoint);
    const text = stopped ? 'stopped' : live ? 'live' : 'connecting';
    box.status.className = `live-status ${stopped ? 'live-stopped' : live ? 'live-live' : 'live-idle'}`;
    // A status region re-announces whatever replaces it, so it changes only when the words do.
    if (state.statusText === text) return;
    state.statusText = text;
    box.status.replaceChildren(pulse(), element('span', text));
  };
  state.drawFeed = () => { if (box.feed) { drawFeedInto(box.feed, state); ready(box.feed); } };
  const drawLive = state.drawLive = () => { if (box.now) { drawHeroInto(box.now, state); ready(box.now); } state.drawFeed(); };
  state.drawAgents = () => {
    if (!state.checkpoint) return;
    const focusedAgent = document.activeElement?.dataset?.agent;
    const focusedClose = document.activeElement?.classList?.contains('agent-close');
    drawn(box.agents, agentsPanel(state.checkpoint, state));
    settleAgents(state);
    speak(state, state.speaking);
    if (focusedAgent) box.agents?.querySelector(`[data-agent="${focusedAgent}"]`)?.focus?.({ preventScroll: true });
    else if (focusedClose) box.agents?.querySelector('.agent-close')?.focus?.({ preventScroll: true });
  };
  // The card's name opens its dot's detail, as a click on the dot does (a dot in the retired summary opens the summary
  // first), and focus lands on the dot, the board's own convention.
  state.openAgent = id => {
    const dot = state.dotNodes?.get(id);
    if (!dot) return;
    if (dot.dataset.level === 'retired' && !state.showRetired) { state.showRetired = true; state.drawAgents(); }
    state.selectAgent(id, id);
    box.agents?.querySelector('#agent-detail')?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  const drawCosts = () => { if (state.checkpoint && box.costs) box.costs.textContent = costsLine(state.checkpoint); };
  const drawMoney = () => {
    if (!state.checkpoint) return;
    drawn(box.numbers, numbersPanel(state.checkpoint, state));
    drawCosts();
    drawn(box.account, accountPanel(state.checkpoint, state.marks));
  };
  // Redrawn on every refresh, like the headline, so a stale Profit leaves the ledger's total a dash as well. A reader on a
  // row's reason button keeps their place across the redraw, as a reader on a dot does.
  const drawPositions = () => {
    if (!state.checkpoint) return;
    const focused = document.activeElement?.closest?.('.pos-why')?.closest?.('tr')?.dataset?.position;
    drawn(box.positions, positionsPanel(state.checkpoint, state));
    if (focused) box.positions?.querySelector(`[data-position="${focused}"] .pos-why`)?.focus?.({ preventScroll: true });
  };
  // The practice league shows only while the House publishes it.
  const drawPractice = () => {
    if (!state.checkpoint || !box.practice) return;
    const panel = practicePanel(state.checkpoint);
    if (box.practiceSection) box.practiceSection.hidden = panel === null;
    drawn(box.practice, panel || []);
  };
  const keepFeed = events => {
    const byId = new Map([...state.feed, ...events].map(event => [event.id, event]));
    state.feed = [...byId.values()].sort((left, right) => (Number(right.seq) || 0) - (Number(left.seq) || 0)).slice(0, 400);
  };
  async function refresh() {
    try {
      state.checkpoint = await loadCheckpoint();
      try { state.marks = await loadHistory(); } catch { /* Keep the last verified history during an outage. */ }
      try { state.score = await loadScore(); } catch { /* An older Worker (a 404) or an outage: keep the score as it was. */ }
      state.agents = new Map(state.checkpoint.agents.map(agent => [agent.id, agent]));
      state.names = new Map(state.checkpoint.agents.map(agent => [agent.id, agentName(agent)]));
      drawMoney();
      if (state.primed) drawLive();
    } catch {
      if (state.checkpoint) return;
      // Nothing published yet, or the record cannot be reached: the numbers keep their dashes and
      // every section says plainly that it is empty.
      ready(box.numbers);
      drawn(box.account, [element('p', 'No balance has been published yet.', 'empty-state')]);
      drawn(box.positions, [element('p', 'No positions have been published yet.', 'empty-state')]);
      drawn(box.agents, [element('p', 'Waiting for the agents.', 'empty-state')]);
    } finally {
      state.asked = true;
      // Every refresh re-reads the status: a fresh checkpoint turns the word to live, and the last one
      // held turns it to stopped once it is older than the window.
      drawStatus();
      if (state.checkpoint) {
        drawn(box.numbers, numbersPanel(state.checkpoint, state));
        drawCosts();
        drawPositions();
        drawPractice();
        state.drawAgents(); // failed refreshes must also expire old promotion evidence
      }
      // A flash belongs to the refresh that changed the number: the next draw starts clean.
      state.washes = {};
    }
  }
  await refresh();
  const loads = [{ kind: 'agent.note', limit: 100 }, { kind: 'agent.trade', limit: 100 }, { kind: 'swarm.news', limit: 60 }, { kind: MARK, limit: MAX_EVENT_LIMIT }];
  const [notes, trades, news, marks] = await Promise.all(loads.map(query => loadEvents(query).catch(() => ({ events: [] }))));
  keepFeed([...notes.events, ...trades.events, ...news.events]);
  if (!state.marks.length) state.marks = marks.events.map(event => ({ at: event.at, equity: event.payload.equity }));
  drawLive();
  drawMoney();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  // A tab that was hidden asks the moment it is looked at again, so the status is never read off a
  // checkpoint that is only old because the page was away.
  // A tab that comes back keeps only the newest queued note: the card catches up instead of replaying what it missed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    state.heroQueue = state.heroQueue.slice(-1);
    refresh();
  });
  // The running clock ticks in the browser between checkpoints.
  setInterval(() => {
    if (!state.clock) return;
    const parts = runningParts(Math.max(0, (Date.now() - state.clock.startedAt) / 1000));
    state.clock.main.textContent = parts.main;
    state.clock.tick.textContent = parts.tick;
  }, 1000);
  const loaded = [notes, trades, news, marks].flatMap(batch => batch.events);
  const feed = startFeed({
    streams: ['all'],
    onStatus: mode => { state.mode = mode; drawStatus(); },
    onEvents: events => {
      const live = events.filter(event => FEED_KINDS.includes(event.kind));
      const balance = events.filter(event => event.kind === MARK);
      // Live notes queue for the card, oldest first (never the history the page opened with).
      if (live.length) {
        state.heroQueue = queueNotes(state.heroQueue, live.filter(event => event.id !== state.hero?.id));
        keepFeed(live); drawLive(); pulseAgents(live, state);
      }
      if (balance.length) { state.marks = [...state.marks, ...balance.map(event => ({ at: event.at, equity: event.payload.equity }))]; drawMoney(); }
      // A trade or a birth changes the roster and the book: ask for the checkpoint once it has landed.
      if (events.some(event => event.kind === 'agent.trade' || event.kind === 'swarm.news')) {
        clearTimeout(state.followUp);
        state.followUp = setTimeout(() => { refresh().catch(() => {}); }, 6000);
        state.followUp?.unref?.();
      }
    },
  });
  feed.remember(loaded);
  feed.prime(loaded.reduce((most, event) => Math.max(most, Number(event.seq) || 0), 0));
  return { ...feed, stop() { clearTimeout(state.followUp); clearTimeout(state.heroTimer);
    for (const timer of state.pulseTimers) clearTimeout(timer); feed.stop(); } };
}

export function startCapital(root = document.querySelector('[data-capital]')) {
  if (!root) return Promise.resolve(null);
  return startPage(root);
}
if (typeof document !== 'undefined' && document.querySelector('[data-capital]')) startCapital();
