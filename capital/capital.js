import {
  MAX_EVENT_LIMIT, SCHEMA_VERSION, REAL_BANDS, COMPUTE_PARTS, OTHER_PARTS, AGENT_SOURCES, PARTNER_NAMES, agentId, computeParts, validCheckpoint,
  validPublicEvent, validDisplayName, validProgress, validScorePoint, socketMatches, tapeName,
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
const MAX_CHECKPOINT_BYTES = 512 * 1024;
const MAX_SOCKET_MESSAGE = 64 * 1024;
const HISTORY_LIMIT = 2048;
const MARK = 'account.mark';
// The checkpoint read this page validates (the Worker's `WINDOW_READ`): progress, the positions ledger, the practice
// league, Claude as its own cost, the incubator route, and the swarm window's levels and rationale (Oct 1, 2026).
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
export function swarmRows(checkpoint) {
  const agents = (Array.isArray(checkpoint?.agents) ? checkpoint.agents : []).filter(agent => agent && typeof agent === 'object');
  const pnl = agent => Number(agent.record?.real?.pnl_usd ?? agent.record?.forward?.pnl_usd ?? 0);
  return agents.map((agent, index) => ({ agent, index }))
    .sort((left, right) => rankOf(left.agent.band) - rankOf(right.agent.band) || pnl(right.agent) - pnl(left.agent)
      || (right.agent.record?.trials ?? 0) - (left.agent.record?.trials ?? 0) || left.index - right.index)
    .map(({ agent }) => ({
      id: show(agent.id), name: agentName(agent), family: show(agent.family), band: show(agent.band), bandText: BAND_WORDS[agent.band] || '',
      real: REAL_BANDS.includes(agent.band), structure: STRUCTURE_WORDS[agent.structure] || '', ...mechanismParts(agent.mechanism), record: recordWords(agent),
      progress: agentProgress(agent, checkpoint),
    }));
}

// Only the House's current prerequisite counts fill a ring. Trials, tenure and cumulative P&L
// are interesting records but cannot say how close a particular program is to promotion.
export const PROGRESS_TARGETS = {
  candidate: 'Live shadow', probe: 'Live trading', sized: 'Increased capital', maintain: 'Maintain capital',
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
  const open = rows.filter(row => row.status === 'open')
    .sort((left, right) => stampOf(right.opened_at) - stampOf(left.opened_at) || pidOf(right) - pidOf(left));
  const closed = rows.filter(row => row.status === 'closed')
    .sort((left, right) => stampOf(right.closed_at) - stampOf(left.closed_at) || stampOf(right.opened_at) - stampOf(left.opened_at) || pidOf(right) - pidOf(left));
  const line = row => ({
    id: show(row.id), source: show(row.source), agent: AGENT_SOURCES.includes(row.source) ? show(row.agent) : null, who: who(row), what: positionWhat(row),
    route: row.source === 'incubator' ? INCUBATOR_WORDS : '', open: row.status === 'open',
    quantity: row.status === 'open' && row.open_quantity < row.quantity ? `×${row.open_quantity} of ${row.quantity}` : `×${row.quantity}`,
    expiry: expiryText(row.expiry), openedAt: show(row.opened_at), closedAt: row.status === 'closed' ? show(row.closed_at) : null,
    usd: numeric(row.pnl_usd) ? row.pnl_usd : null, pnl: numeric(row.pnl_usd) ? signedMoney(row.pnl_usd) : '—', tone: signOf(row.pnl_usd),
    share: shareOf(row.pnl_usd, profit),
  });
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
    asOf: show(block.as_of), open: open.map(line), closed: closed.map(line), earlier, unreconciled,
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
    if (!text) return null;
    const life = newsKind(text, who);
    return { ...base, kind: 'swarm', agent: who || 'swarm', agentId: who, name: who ? event.display_name || names.get(who) || titleCase(who) : 'The House', text,
      tape: life.kind, brief: life.brief, group: 'life' };
  }
  const agent = streamAgentOf(event.stream);
  if (!agentId(agent)) return null;
  const name = event.display_name || names.get(agent) || titleCase(agent);
  if (event.kind === 'agent.note') {
    const text = plainNote(payload.text);
    return text ? { ...base, kind: 'thinking', agent, agentId: agent, name, text, tape: 'thought', brief: text, group: 'thoughts' } : null;
  }
  const why = plainNote(payload.why);
  return {
    ...base, kind: 'trading', agent, agentId: agent, name, text: tradeWords(payload), real: payload.real === true,
    pnl: numeric(payload.pnl_usd) ? signedMoney(payload.pnl_usd) : '', tone: signOf(payload.pnl_usd), why,
    tape: 'trade', brief: why ? `${tradeWords(payload)} · ${why}` : tradeWords(payload), group: 'trades',
  };
}
// The swarm's news, by its verb: a birth reads as its idea, a move as its two bands, a retirement as its cause, and the
// auditor's verdict as its summary. News with no agent is the House's own.
export function newsKind(text, agent) {
  const value = plainNote(text);
  if (!agent) return { kind: 'house', brief: value };
  let match = /^is born, (?:a new family|forked from its parent)(?::\s*(.+))?/i.exec(value);
  if (match) return { kind: 'born', brief: match[1] ? match[1].trim() : value };
  match = /^retired:\s*(.+)$/i.exec(value);
  if (match) return { kind: 'retired', brief: match[1].trim() };
  match = /^moves from (\w+) to (\w+)(?::\s*(.+))?/i.exec(value);
  if (match) return { kind: 'moved', brief: `${match[1]} → ${match[2]}${match[3] ? ` · ${match[3].replace(/[.]$/, '')}` : ''}`, from: match[1], to: match[2] };
  match = /^(approved|refused) for real money by the auditor\.?\s*(.*)$/i.exec(value);
  if (match) return { kind: match[1].toLowerCase(), brief: match[2] || value };
  return { kind: 'news', brief: value };
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
// thesis rather than a raw mechanism. The House's thesis always replaces this one.
const CODE_MARKS = /[=_{}[\]<>`#|\\]|->|::|\bctx\.|\bnp\.|\bPARAMS\b|\bNEEDS\b|\bdef\s|\breturn\s|\bimport\s|\blambda\b/;
const NUMBER_WORD = new RegExp('^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|'
  + 'seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|hundreds|thousand|thousands|million|half|'
  + 'halves|halve|third|thirds|quarter|quarters|fourth|fourths|fifth|fifths|sixth|sixths|seventh|eighth|ninth|tenth|tenths|hundredth|'
  + 'hundredths|first|second|twice|thrice|double|triple|dozen|point|percent|percentage|percentages|fraction|fractions|basis|bps|pct)$', 'i');
const UNIT_WORDS = new Set(['day', 'days', 'session', 'sessions', 'week', 'weeks', 'month', 'months', 'year', 'years', 'hour', 'hours', 'minute',
  'minutes', 'bar', 'bars', 'standard', 'sigma', 'sigmas', 'deviation', 'deviations', 'strike', 'strikes', 'contract', 'contracts', 'lot', 'lots',
  'leg', 'legs', 'percent', 'point', 'points', 'dte', 'delta', 'deltas', 'times', 'x', 'tick', 'ticks', 'cent', 'cents', 'dollar', 'dollars']);
// A number written as a word, except the pronoun "one" ("investors reprice one on the other's capex").
export function numbered(sentence) {
  const tokens = show(sentence).toLowerCase().match(/[a-z']+/g) || [];
  return tokens.some((token, index) => {
    if (!NUMBER_WORD.test(token)) return false;
    if (token !== 'one') return true;
    const before = tokens[index - 1] || '';
    const after = tokens[index + 1] || '';
    return NUMBER_WORD.test(before) || NUMBER_WORD.test(after) || UNIT_WORDS.has(after);
  });
}
export const sentencesOf = text => show(text).replace(/\s+/g, ' ').trim().replace(/([.!?])\s+/g, '$1\u0000').split('\u0000').filter(Boolean);
export function thesisText(text, limit = 280, minimum = 12) {
  const keep = sentencesOf(text).filter(sentence => !/\d/.test(sentence) && !CODE_MARKS.test(sentence) && !/[:()]/.test(sentence)
    && !numbered(sentence) && /[.!?]$/.test(sentence));
  let out = '';
  for (const sentence of keep) {
    const next = `${out} ${sentence}`.trim();
    if (next.length > limit) break;
    out = next;
  }
  if (!out && keep.length) out = `${keep[0].slice(0, limit - 1).replace(/\s+\S*$/, '').replace(/[ ,;-]+$/, '')}…`;
  return out.length >= minimum ? out : null;
}
// A published mechanism cut at its last full sentence (the publisher cuts it at 240 characters, mid-word if it must).
export function wholeSentences(text) {
  const full = show(text).replace(/\s+/g, ' ').trim();
  if (!full || /[.!?]$/.test(full)) return full;
  const end = Math.max(full.lastIndexOf('. '), full.lastIndexOf('! '), full.lastIndexOf('? '));
  return end > 0 ? full.slice(0, end + 1) : `${full.replace(/\s+\S*$/, '')}…`;
}
export const firstSentence = text => sentencesOf(text)[0] || '';

// The game, as steps on a map. The main stairs climb from Train to Sized; the side path (Practice, then the Incubator)
// leaves Train flat and never reaches the top. Right of the gold line is real money.
export const STEPS = [
  { key: 'train', word: 'Train', track: 'main', real: false, level: 'train', ever: 'born', title: 'Training on recorded markets' },
  { key: 'validation', word: 'Validation', track: 'main', real: false, level: 'validation', ever: 'validation', title: 'Tested on held-back years' },
  { key: 'tuition', word: 'Tuition', track: 'main', real: true, level: 'tuition', ever: 'tuition', title: 'One real contract to measure fills, never evidence' },
  { key: 'holdout', word: 'Holdout', track: 'main', real: true, level: 'candidate', ever: 'candidate', title: 'One look at untouched data' },
  { key: 'probe', word: 'Probe', track: 'main', real: true, level: 'probe', ever: 'probe', title: 'Real money, small' },
  { key: 'sized', word: 'Sized', track: 'main', real: true, level: 'sized', ever: 'sized', title: 'Real money, sized by its record' },
  { key: 'practice', word: 'Practice', track: 'side', real: false, level: 'practice', ever: 'practice', title: 'Shadow trades on live quotes, never real money' },
  { key: 'incubator', word: 'Incubator', track: 'side', real: true, level: 'incubator', ever: 'incubator', title: INCUBATOR_TITLE },
];
export const MAIN_STEPS = STEPS.filter(step => step.track === 'main').map(step => step.key);
const STEP_OF_LEVEL = Object.fromEntries(STEPS.map(step => [step.level, step.key]));
export const LEVEL_WORDS = { ...Object.fromEntries(STEPS.map(step => [step.level, step.word])), retired: 'Retired' };
// A partner name's durable ordinal ("Mullins 166" is the 1,986th name): dots keep this order inside a step.
export function ordinalOf(name) {
  const match = /^([A-Za-z]+)(?: (\d+))?$/.exec(show(name));
  const index = match ? PARTNER_NAMES.indexOf(match[1]) : -1;
  return index === -1 ? Infinity : index + 1 + ((Number(match[2]) || 1) - 1) * PARTNER_NAMES.length;
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
// Where an agent stands: the House's own word when it sends `levels`; else what the roster and the ledger can say for
// certain. A band above the Gym is its own level; real money on a Gym agent with no incubator tag can only be tuition.
export function levelOf(agent, checkpoint, held = openMoney(checkpoint), published = publishedLevels(checkpoint)) {
  if (published.has(agent?.id)) return published.get(agent.id);
  const band = agent?.band;
  if (['candidate', 'probe', 'sized'].includes(band)) return band;
  const money = held.get(agent?.id);
  if (band === 'retired') return money?.incubator ? 'incubator' : 'retired';
  if (money?.incubator) return 'incubator';
  if (money?.real) return 'tuition';
  return 'train';
}
// A dot's shape is its money: hollow while it researches, dashed while it trades the shadow book, dotted gold on the
// incubator, filled gold with real money open.
export const moneyOf = (level, money) => (money?.real ? 'real' : money?.incubator ? 'incubator' : level === 'practice' || money?.shadow ? 'shadow' : 'research');
export const MONEY_WORDS = { research: 'researching', shadow: 'trading the shadow book', incubator: 'incubator money open', real: 'real money open' };
const countOf = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);
// The whole map: each step's agents now and its families ever, the graveyard, the House's own trades and the holdout's
// looks. A count the House has not published is null and reads "—", never 0. `born` adds provisional dots for births on
// the tape the checkpoint has not confirmed yet; `gone` takes off the map the agents the tape has just retired.
export function climbModel(checkpoint, { born = [], gone = [] } = {}) {
  const levels = checkpoint?.levels && typeof checkpoint.levels === 'object' ? checkpoint.levels : null;
  const funnel = levels?.funnel && typeof levels.funnel === 'object' ? levels.funnel : null;
  const held = openMoney(checkpoint);
  const published = publishedLevels(checkpoint);
  const steps = Object.fromEntries(STEPS.map(step => [step.key, { ...step, agents: [], now: null, everCount: null }]));
  const roster = (Array.isArray(checkpoint?.agents) ? checkpoint.agents : []).filter(agent => agent && typeof agent === 'object');
  const dots = new Map();
  const leaving = new Set(gone);
  let left = 0;
  for (const agent of roster) {
    const level = levelOf(agent, checkpoint, held, published);
    const key = STEP_OF_LEVEL[level];
    if (!key) continue;
    if (leaving.has(agent.id) && !held.has(agent.id)) { left += 1; continue; }
    const dot = { id: show(agent.id), name: agentName(agent), ordinal: ordinalOf(agent.display_name), level, step: key, band: show(agent.band),
      money: moneyOf(level, held.get(agent.id)), retired: agent.band === 'retired', provisional: false, progress: agentProgress(agent, checkpoint) };
    steps[key].agents.push(dot);
    dots.set(dot.id, dot);
  }
  for (const baby of Array.isArray(born) ? born : []) {
    if (!agentId(baby?.id) || dots.has(baby.id)) continue;
    const dot = { id: baby.id, name: show(baby.name) || titleCase(baby.id), ordinal: Infinity, level: 'train', step: 'train', band: 'gym', money: 'research',
      retired: false, provisional: true, progress: null };
    steps.train.agents.push(dot);
    dots.set(dot.id, dot);
  }
  const gym = checkpoint?.gym && typeof checkpoint.gym === 'object' ? checkpoint.gym : null;
  // Without the House's levels the page knows Train, the real-money steps and the Incubator from the roster and the
  // ledger; Validation and Practice are unknown.
  const knownNow = levels ? STEPS.map(step => step.key) : ['train', 'tuition', 'holdout', 'probe', 'sized', 'incubator'];
  for (const step of Object.values(steps)) {
    step.agents.sort((left, right) => (left.ordinal - right.ordinal) || left.id.localeCompare(right.id));
    step.now = knownNow.includes(step.key) ? step.agents.length : null;
    step.everCount = funnel ? countOf(funnel[step.ever])
      : step.key === 'train' && countOf(gym?.families_alive) !== null && countOf(gym?.families_retired) !== null ? gym.families_alive + gym.families_retired : null;
  }
  const rows = Array.isArray(checkpoint?.positions?.rows) ? checkpoint.positions.rows : null;
  const listed = source => (rows && !checkpoint.positions.earlier ? rows.filter(row => row?.source === source).length : null);
  return {
    known: Boolean(levels), steps, dots,
    graveyard: (() => { const count = countOf(gym?.families_retired) ?? (funnel ? countOf(funnel.retired) : null); return count === null ? null : count + left; })(),
    house: { calibration: funnel ? countOf(funnel.calibration) : listed('calibration'), liveTest: funnel ? countOf(funnel.live_test) : listed('house') },
    looks: funnel && countOf(funnel.looks) !== null ? { looks: funnel.looks, passed: countOf(funnel.looks_passed) ?? 0 } : null,
    trials: countOf(gym?.trials),
  };
}
// The map's geometry for a box of `width` by `height` pixels: each step's platform (x, y, w), the centre of every dot, the
// gold line, the side path and the off-map marks. Pure, so a resize redraws the same map.
export const PITCH = 14;
export function climbLayout(model, width = 800, height = 300) {
  const W = Math.max(320, Number(width) || 800);
  const H = Math.max(240, Number(height) || 300);
  const pad = 16;
  const label = 32;
  const sideY = H - label;
  const mainY = sideY - 30 - label;
  const count = key => model?.steps?.[key]?.agents?.length || 0;
  const trainRows = Math.max(2, Math.min(8, Math.floor((mainY - 70) / PITCH)));
  const rowsOf = key => (key === 'train' ? trainRows : 3);
  const gate = key => (key === 'holdout' ? 22 : 0);
  // Train holds its crowd twelve wide (60 dots are a 12 × 5 grid), wider only when its rows run out.
  const colsOf = key => (key === 'train' ? Math.max(6, Math.min(12, count(key)), Math.ceil(count(key) / rowsOf(key))) : Math.max(1, Math.ceil(count(key) / rowsOf(key))));
  const need = key => Math.max(key === 'train' ? 120 : 96, colsOf(key) * PITCH + 24 + gate(key));
  const goldGap = 28;
  const widths = Object.fromEntries(MAIN_STEPS.map(key => [key, need(key)]));
  const total = Object.values(widths).reduce((sum, value) => sum + value, 0) + goldGap + pad * 2;
  if (total < W) {
    const others = MAIN_STEPS.filter(key => key !== 'train');
    const share = Math.min(110, (W - total) / others.length);
    for (const key of others) widths[key] += share;
  } else if (total > W) {
    const over = total - W;
    const others = MAIN_STEPS.filter(key => key !== 'train');
    for (const key of others) widths[key] = Math.max(64 + gate(key), widths[key] - over / others.length);
  }
  const rise = Math.max(14, Math.min(40, (mainY - 110) / (MAIN_STEPS.length - 1)));
  const steps = {};
  let x = pad;
  MAIN_STEPS.forEach((key, index) => {
    if (key === 'tuition') x += goldGap;
    steps[key] = { key, x, y: mainY - index * rise, w: widths[key] };
    x += widths[key];
  });
  const goldX = steps.validation.x + steps.validation.w + goldGap / 2;
  steps.practice = { key: 'practice', x: steps.validation.x, y: sideY, w: Math.max(96, steps.validation.w - 8) };
  steps.incubator = { key: 'incubator', x: steps.tuition.x, y: sideY, w: Math.max(80, Math.min(120, steps.tuition.w - 16)) };
  const dots = new Map();
  for (const [key, step] of Object.entries(steps)) {
    const agents = model?.steps?.[key]?.agents || [];
    const side = key === 'practice' || key === 'incubator';
    const rows = side ? 1 : rowsOf(key);
    const room = Math.max(1, Math.floor((step.w - (side ? 44 : 20) - gate(key)) / PITCH));
    const cols = Math.max(1, Math.min(room, key === 'train' ? colsOf(key) : Math.ceil(agents.length / rows)));
    step.cols = cols;
    step.rows = agents.length ? Math.ceil(agents.length / cols) : 0;
    agents.forEach((agent, index) => {
      const cx = step.x + 12 + gate(key) + (index % cols) * PITCH + PITCH / 2;
      const cy = step.y - 3 - PITCH / 2 - Math.floor(index / cols) * PITCH;
      dots.set(agent.id, { cx, cy, step: key });
    });
    step.top = step.y - 3 - step.rows * PITCH;
    // The side path's counts sit beside its one row of dots, clear of the stairs above.
    if (side) step.count = { x: step.x + 12 + Math.min(agents.length, cols) * PITCH + 8, y: step.y - 1 };
  }
  // A tall box (theatre) centres the map rather than leaving it at the bottom.
  const top = Math.min(...MAIN_STEPS.map(key => steps[key].top)) - 44;
  const lift = top > 24 ? Math.floor((top - 24) / 2) : 0;
  if (lift) {
    for (const step of Object.values(steps)) { step.y -= lift; step.top -= lift; if (step.count) step.count.y -= lift; }
    for (const dot of dots.values()) dot.cy -= lift;
  }
  return {
    width: W, height: H, rise, steps, dots, goldX, mainY: mainY - lift, sideY: sideY - lift,
    graveyard: { x: pad + 6, y: sideY - lift }, house: { x: Math.max(steps.incubator.x + steps.incubator.w + 44, steps.probe.x + 8), y: sideY - lift },
  };
}

// ---- why each real position: the thesis, the trigger, the exit, the risk
export const HOUSE_RATIONALE = { calibration: 'Measures real fills.', house: 'A pre-registered House test.' };
export const ROUTE_WORDS = { tuition: 'Tuition', incubator: 'Incubator', probe: 'Probe', sized: 'Sized', calibration: 'House', house: 'House' };
export const EXIT_WORDS = { agent: 'agent', house: 'House', expiry: 'expired' };
// The open trade on the tape that made a ledger row (while the House sends no rationale): the same agent, root, structure
// and expiry, published within five minutes of the row's opening minute. A close's own `why` is the entry tag, so it
// never stands for the close's reason.
export function interimRationale(row, tradeEvents = []) {
  const opened = Date.parse(row?.opened_at);
  const match = (Array.isArray(tradeEvents) ? tradeEvents : []).find(event => event?.kind === 'agent.trade' && event.payload?.action === 'open'
    && event.payload.real === true && streamAgentOf(event.stream) === row?.agent && event.payload.underlying === row.underlying
    && event.payload.structure === row.structure && event.payload.expiry === row.expiry
    && Date.parse(event.at) >= opened && Date.parse(event.at) <= opened + 5 * 60000);
  return match ? { openWhy: plainNote(match.payload.why) || null, maxLoss: numeric(match.payload.max_loss_usd) ? match.payload.max_loss_usd : null }
    : { openWhy: null, maxLoss: null };
}
// Everything the rationale card says about one ledger row. The House's `rationale` block first; while it sends none, the
// tape's open trade and the roster's mechanism (filtered by `thesisText`), or the agent's birth news when it has left the
// roster. A House row's reason is a fixed line.
export function rationaleFor(row, checkpoint, { trades = [], births = new Map() } = {}) {
  if (!row || typeof row !== 'object') return null;
  const block = checkpoint?.rationale && typeof checkpoint.rationale === 'object' ? checkpoint.rationale : null;
  const trade = (Array.isArray(block?.trades) ? block.trades : []).find(entry => entry?.id === row.id) || null;
  if (!AGENT_SOURCES.includes(row.source)) {
    return { house: true, interim: !trade, thesis: HOUSE_RATIONALE[row.source] || null, openWhy: null, closeWhy: null, exit: trade?.exit ?? null,
      route: trade?.route ?? (row.source === 'house' ? 'house' : 'calibration'), maxLoss: trade?.max_loss_usd ?? null };
  }
  const agent = (Array.isArray(checkpoint?.agents) ? checkpoint.agents : []).find(entry => entry?.id === row.agent) || null;
  const published = (Array.isArray(block?.agents) ? block.agents : []).find(entry => entry?.id === row.agent);
  const thesis = published ? published.thesis : thesisText(agent?.mechanism) || thesisText(births.get(row.agent)) || null;
  const interim = interimRationale(row, trades);
  const structure = (Array.isArray(checkpoint?.structures) ? checkpoint.structures : []).find(entry => entry?.real === true && entry.agent === row.agent
    && entry.underlying === row.underlying && entry.structure === row.structure && entry.expiry === row.expiry);
  const route = trade ? trade.route : row.source === 'incubator' ? 'incubator'
    : ['probe', 'sized'].includes(agent?.band) ? agent.band : agent?.band === 'gym' ? 'tuition' : null;
  return {
    house: false, interim: !trade, thesis, route,
    openWhy: trade ? trade.open_why : interim.openWhy,
    closeWhy: trade ? trade.close_why : null,
    exit: trade ? trade.exit : null,
    maxLoss: trade?.max_loss_usd ?? (row.status === 'open' && structure ? structure.max_loss_usd : null) ?? interim.maxLoss,
  };
}
// "−8% of risk": the P&L as a share of the most the position could lose, to a whole percent. Never a maximum gain.
export function riskShare(pnl, risk) {
  const part = centsOf(pnl);
  const whole = centsOf(risk);
  if (part === null || whole === null || whole <= 0n) return null;
  return Number(part * 1000n / whole) / 10;
}

// ---- performance over time
// Realized P&L since the reset, exact from the ledger: a step at each close, with the positions not listed as the offset
// (the line then starts at the oldest listed close). Stops at a close whose result is unknown: nothing unknown is drawn.
export function realizedSteps(checkpoint) {
  const block = checkpoint?.positions;
  if (!block || typeof block !== 'object' || !Array.isArray(block.rows)) return null;
  const closed = block.rows.filter(row => row?.status === 'closed' && Number.isFinite(Date.parse(row.closed_at)))
    .sort((left, right) => Date.parse(left.closed_at) - Date.parse(right.closed_at) || pidOf(left) - pidOf(right));
  let total = 0n;
  let start = Date.parse(profitBasis(checkpoint).start_at);
  if (block.earlier) {
    if (!numeric(block.earlier.pnl_usd) || !closed.length) return null;
    total = centsOf(block.earlier.pnl_usd);
    start = Date.parse(closed[0].closed_at);
  }
  const startCents = total;
  const steps = [];
  for (const row of closed) {
    if (!numeric(row.pnl_usd)) break;
    total += centsOf(row.pnl_usd);
    steps.push({ at: Date.parse(row.closed_at), cents: total, id: show(row.id) });
  }
  return { start, startCents, steps, complete: steps.length === closed.length, cents: total };
}
// The realized line's value at an instant (null before it starts).
export function realizedAt(realized, at) {
  if (!realized || at < realized.start) return null;
  let value = realized.startCents;
  for (const step of realized.steps) { if (step.at <= at) value = step.cents; else break; }
  return value;
}
// One archived series in segments: a segment breaks on an unknown point or a gap of more than fifteen minutes, so the line
// never joins across what nobody recorded.
export const SCORE_GAP_MS = 15 * 60 * 1000;
export function scoreSeries(points, key) {
  const segments = [];
  let current = null;
  let last = null;
  const ordered = (Array.isArray(points) ? points : []).map(point => ({ at: Date.parse(point?.at), value: point?.[key] }))
    .filter(point => Number.isFinite(point.at)).sort((left, right) => left.at - right.at);
  for (const point of ordered) {
    if (!numeric(point.value)) { current = null; continue; }
    if (!current || point.at - last > SCORE_GAP_MS) { current = []; segments.push(current); }
    current.push({ at: point.at, cents: centsOf(point.value) });
    last = point.at;
  }
  return segments;
}
// New York time, without a library: the wall clock of an instant, and the instant of a wall-clock time.
const NY_PARTS = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric',
  month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }) : null;
export function nyParts(ms) {
  const parts = Object.fromEntries(NY_PARTS.formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}
export function nyInstant(year, month, day, hour, minute) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive + 4 * 3600000;
  for (let pass = 0; pass < 3; pass++) {
    const shown = nyParts(guess);
    const delta = naive - Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
    if (!delta) break;
    guess += delta;
  }
  return guess;
}
// The stretches outside 9:30 to 4:00 New York time, Monday to Friday: the flat stretches and night gaps, without words.
export function marketClosedBands(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 400 * 86400000) return [];
  const first = nyParts(start - 86400000);
  const open = [];
  for (let day = Date.UTC(first.year, first.month - 1, first.day); day <= end + 2 * 86400000; day += 86400000) {
    const date = new Date(day);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const [year, month, dayOf] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    open.push([nyInstant(year, month, dayOf, 9, 30), nyInstant(year, month, dayOf, 16, 0)]);
  }
  const bands = [];
  let from = start;
  for (const [opens, closes] of open) {
    if (closes <= from || opens >= end) continue;
    if (opens > from) bands.push([from, Math.min(opens, end)]);
    from = Math.max(from, closes);
  }
  if (from < end) bands.push([from, end]);
  return bands;
}
// Up to three clean ticks inside [low, high], in dollars: the first step whose round multiples inside the range number two
// or three. The scale's domain is the data's own, so a tick never stretches it.
export function niceTicks(low, high, most = 3) {
  let min = Math.min(low, high);
  let max = Math.max(low, high);
  if (!(max > min)) { min -= 1; max += 1; }
  const power = 10 ** Math.floor(Math.log10((max - min) / most));
  for (const step of [1, 2, 2.5, 5, 10, 20, 25, 50, 100].map(multiple => multiple * power)) {
    const ticks = [];
    for (let value = Math.ceil(min / step - 1e-9) * step; value <= max + 1e-9; value += step) ticks.push(Math.round(value * 100) / 100 || 0);
    if (ticks.length >= 2 && ticks.length <= most) return ticks;
  }
  return [Math.round(min), Math.round(max)];
}
// "$1.2K", "−$40", "$0": a tick's words.
export function tickMoney(value) {
  const size = Math.abs(value);
  const text = size >= 1000 ? `$${(size / 1000).toFixed(size % 1000 ? 1 : 0)}K` : `$${Number.isInteger(size) ? size : size.toFixed(2)}`;
  return value < 0 ? `−${text}` : text;
}

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
  const data = await fetchJson(`${apiBase(pageSearch())}/checkpoint${CHECKPOINT_READ}`, MAX_CHECKPOINT_BYTES);
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
  return { points: data.points, last_profit: data.last_profit, last_net: data.last_net };
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
// Everything below draws with text nodes and CSSOM only: the page's policy refuses markup strings and style attributes.
// Motion follows only real events, never history, and stops under reduced motion.
const TAPE_LIMIT = 60;
const PHONE_TAPE_LINES = 6;
const NOTE_CLAMP_CHARS = 300;
const QUIET_MS = 10 * 60 * 1000;
const GLOW_MS = 10 * 60 * 1000;
const MAX_RIPPLES = 4;
const LAST_KNOWN_MS = 4 * 86400000;
export const LAST_KNOWN_TITLE = 'Last value the House could price.';
export const BALANCE_TITLE = 'Balance is not Profit.';
export const EMPTY_POSITIONS = 'No real positions yet.';
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
function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function button(content, className, label) {
  const node = element('button', content, className);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}
const tagNode = (text, kind) => element('span', text, `tag tag-${kind}`);
const moneyTag = (real, incubator = false) => {
  if (!incubator) return tagNode(real ? 'real money' : 'shadow', real ? 'real' : 'shadow');
  const tag = tagNode(INCUBATOR_WORDS.toLowerCase(), 'incubator');
  tag.setAttribute('title', INCUBATOR_TITLE);
  return tag;
};
function pulse(className = 'pulse') {
  const dot = element('span', null, className);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}
// CSSOM, not a style attribute: the page's policy allows the one and refuses the other.
function place(node, properties) {
  try { for (const [key, value] of Object.entries(properties)) node.style[key] = value; } catch { /* no layout here */ }
}
function setVar(node, name, value) {
  try { node.style.setProperty(name, String(value)); } catch { /* no layout here */ }
}
const matches = query => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
// Reduced motion, or no way to tell: then nothing moves.
const still = () => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => matches('(max-width: 759px)');
const finePointer = () => matches('(hover: hover) and (pointer: fine)');
// Per-viewer conveniences only (theatre, theme). Private windows and blocked storage simply forget.
function remembered(key) { try { return window.localStorage?.getItem(key) ?? null; } catch { return null; } }
function remember(key, value) {
  try { if (value === null) window.localStorage?.removeItem(key); else window.localStorage?.setItem(key, value); } catch { /* storage is off */ }
}
function boxOf(node) {
  try { const box = node?.getBoundingClientRect?.(); return box && box.width ? box : null; } catch { return null; }
}
// "40s", "3m", "12h", "2d".
export function shortAgo(value, now = Date.now()) {
  const stamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(stamp)) return '';
  const seconds = Math.max(0, Math.floor((now - stamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
// "3:58 PM", or "Sep 30, 3:58 PM" on another day, New York time.
export function clockTime(value, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
  const day = stamp => date(new Date(stamp).toISOString(), 'day');
  return day(at) === day(now) ? time : `${day(at)}, ${time}`;
}
// The newest Profit and Net the House could price, while Profit is a dash: dated, and no older than four days.
export function lastKnown(score, now = Date.now()) {
  const fresh = (entry, key) => (entry && numeric(entry[key]) && now - Date.parse(entry.at) <= LAST_KNOWN_MS && now >= Date.parse(entry.at) - 60000
    ? { at: entry.at, usd: entry[key] } : null);
  return { profit: fresh(score?.last_profit, 'profit_usd'), net: fresh(score?.last_net, 'net_usd') };
}
// The tape's marks, drawn in tone tokens: a thought, a trade, a birth, a move, a retirement, the auditor's two verdicts,
// and the House's own news.
const GLYPH_PATHS = {
  thought: ['circle', { cx: 6, cy: 6, r: 3.4 }], news: ['circle', { cx: 6, cy: 6, r: 2 }],
  trade: ['path', { d: 'M6 1.6 10.4 6 6 10.4 1.6 6Z' }], born: ['path', { d: 'M6 1 7.3 4.7 11 6 7.3 7.3 6 11 4.7 7.3 1 6 4.7 4.7Z' }],
  moved: ['path', { d: 'M6 1.8 10.2 6.4H7.5v3.8h-3V6.4H1.8Z' }], retired: ['path', { d: 'M3 3l6 6M9 3l-6 6', class: 'glyph-stroke' }],
  approved: ['path', { d: 'M2.4 6.4 5 9 9.6 3', class: 'glyph-stroke' }], refused: ['path', { d: 'M3 3l6 6M9 3l-6 6', class: 'glyph-stroke' }],
  house: ['path', { d: 'M2 6.2 6 2.6l4 3.6V10H2Z', class: 'glyph-stroke' }],
};
function glyph(kind) {
  const [tag, attributes] = GLYPH_PATHS[kind] || GLYPH_PATHS.news;
  const svg = svgElement('svg', { viewBox: '0 0 12 12', class: `glyph glyph-${kind}`, 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgElement(tag, attributes));
  return svg;
}
// An agent's mark, the same everywhere: shape is its money, colour its level, a × once retired.
function dotMark(dot, className = 'dot-mark') {
  const mark = element('span', null, `${className} money-${dot?.money || 'research'} lvl-${dot?.step || 'train'}${dot?.retired ? ' is-retired' : ''}`);
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}
// Types a note at about forty characters a second (faster for a long one, at most twelve seconds); off for readers who
// asked for less motion.
const typers = new WeakMap();
export const typingMs = text => Math.min(12000, show(text).length * 25);
function typeInto(node, text, animate = true, done = null) {
  const previous = typers.get(node);
  if (previous) clearTimeout(previous);
  if (!animate || still() || !text) { node.textContent = text; node.classList?.remove?.('typing'); done?.(); return; }
  const chunk = Math.max(1, Math.ceil(text.length / 480));
  let shown = 0;
  node.classList?.add?.('typing');
  const step = () => {
    shown = Math.min(text.length, shown + chunk);
    node.textContent = text.slice(0, shown);
    if (shown < text.length) { const timer = setTimeout(step, 25); timer?.unref?.(); typers.set(node, timer); }
    else { typers.delete(node); node.classList?.remove?.('typing'); done?.(); }
  };
  step();
}

// ---- the top bar: Profit, Net, Running, the last value the House could price, and the costs
function numbersPanel(checkpoint, state) {
  const last = lastKnown(state.score);
  return mastheadNumbers(checkpoint).map(item => {
    const row = element('div', null, `number number-${item.key}`);
    if (item.title) row.setAttribute('title', item.title);
    const value = element('dd', null, item.tone || null);
    const main = element('span', item.value, 'number-value');
    value.append(main);
    if (item.key === 'clock') {
      const tick = element('span', item.tick, 'number-tick');
      value.append(tick);
      state.clock = item.startedAt === null ? null : { main, tick, startedAt: item.startedAt };
    }
    const known = item.key === 'profit' ? last.profit : item.key === 'net' ? last.net : null;
    if (item.value === '—' && known) {
      const before = element('span', `${signedMoney(known.usd)} · ${clockTime(known.at)}`, 'number-last');
      before.setAttribute('title', LAST_KNOWN_TITLE);
      value.append(before);
    }
    row.append(element('dt', item.label), value);
    return row;
  });
}

// ---- thinking now: one note at a time, typed, held long enough to read
// How long a note stays: its reading time at three and a half words a second, at least six seconds and at most twenty,
// after it has finished typing. Then it stays until a newer note arrives.
export const holdMs = text => Math.max(6000, Math.min(20000, show(text).split(/\s+/).filter(Boolean).length / 3.5 * 1000));
const noteOf = (event, names) => {
  const agent = streamAgentOf(event?.stream);
  const text = plainNote(event?.payload?.text);
  return agentId(agent) && text ? { id: show(event.id), seq: Number(event.seq) || 0, agent, at: show(event.at), text,
    name: event.display_name || names.get(agent) || titleCase(agent) } : null;
};
function thinkCard(state) {
  const card = element('article', null, 'think-card');
  const head = element('div', null, 'think-head');
  const mark = element('span', null, 'think-dot');
  const name = element('span', '', 'think-name');
  const level = element('span', '', 'chip-level');
  const age = element('time', '', 'think-age');
  head.append(mark, name, level, age);
  const text = element('p', '', 'think-text');
  const foot = element('div', null, 'think-foot');
  const more = button('↓', 'think-more', 'Read the whole note');
  more.hidden = true;
  more.setAttribute('aria-expanded', 'false');
  const queue = button('', 'think-queue', 'Skip to the newest note');
  queue.hidden = true;
  foot.append(more, queue);
  const live = element('p', '', 'visually-hidden');
  live.setAttribute('aria-live', 'polite');
  card.append(head, text, foot, live);
  more.addEventListener('click', () => {
    const think = state.think;
    think.expanded = !think.expanded;
    more.setAttribute('aria-expanded', String(think.expanded));
    more.textContent = think.expanded ? '↑' : '↓';
    text.className = `think-text${think.expanded ? ' is-open' : ''}`;
    typers.get(text) && typeInto(text, think.current?.text || '', false);
    if (!think.expanded) { think.readUntil = Math.max(think.readUntil, Date.now() + 6000); thinkAdvance(state); }
  });
  queue.addEventListener('click', () => {
    const think = state.think;
    if (!think.queue.length) return;
    const newest = think.queue.pop();
    think.queue = [];
    think.expanded = false;
    thinkShow(state, newest, true);
  });
  card.addEventListener('pointerenter', () => { state.think.hovering = true; state.climb?.pulseDot?.(state.think.current?.agent); });
  card.addEventListener('pointerleave', () => { state.think.hovering = false; thinkAdvance(state); });
  state.think.parts = { card, mark, name, level, age, text, more, queue, live };
  return card;
}
function thinkDraw(state) {
  const box = state.box.now;
  if (!box) return;
  const think = state.think;
  if (!think.parts) box.replaceChildren(thinkCard(state));
  const { card, mark, name, level, age, text, more, queue } = think.parts;
  const note = think.current;
  const dot = note ? state.model?.dots?.get(note.agent) : null;
  const quiet = !note || Date.now() - Date.parse(note.at) > QUIET_MS;
  card.className = `think-card${quiet ? ' is-quiet' : ''}${dot && STEPS.find(step => step.key === dot.step)?.real ? ' is-real' : ''}${note ? '' : ' is-empty'}`;
  setVar(card, '--speaker', dot ? `var(--lvl-${dot.step})` : 'var(--line)');
  mark.replaceChildren(...(note ? [dotMark(dot || { money: 'research', step: 'train' })] : []));
  name.textContent = note ? note.name : '—';
  level.textContent = dot ? (dot.retired && dot.step === 'train' ? LEVEL_WORDS.retired : LEVEL_WORDS[dot.level] || '') : '';
  level.hidden = !level.textContent;
  age.textContent = note ? shortAgo(note.at) : '';
  if (note) age.dateTime = note.at;
  age.className = `think-age${note && Date.now() - Date.parse(note.at) < 120000 ? ' is-fresh' : ''}`;
  more.hidden = !note || note.text.length <= NOTE_CLAMP_CHARS;
  queue.hidden = !think.queue.length;
  queue.textContent = `+${think.queue.length}`;
  if (!note) text.textContent = '';
}
function thinkShow(state, note, animate) {
  const think = state.think;
  think.current = note;
  think.expanded = false;
  const { parts } = think;
  const now = Date.now();
  const typing = animate && !still() ? typingMs(note.text) : 0;
  think.readUntil = now + typing + holdMs(note.text);
  state.speaker = note.agent;
  state.spoke.set(note.agent, Math.max(state.spoke.get(note.agent) || 0, Date.parse(note.at) || now));
  thinkDraw(state);
  if (parts) {
    parts.more.setAttribute('aria-expanded', 'false');
    parts.more.textContent = '↓';
    parts.text.className = 'think-text';
    typeInto(parts.text, note.text, animate);
    // One announcement every twenty seconds at most.
    if (now - (think.announcedAt || 0) >= 20000) { think.announcedAt = now; parts.live.textContent = `${note.name}: ${note.text}`; }
  }
  state.climb?.speak?.(note.agent);
  clearTimeout(think.timer);
  think.timer = setTimeout(() => thinkAdvance(state), think.readUntil - now + 10);
  think.timer?.unref?.();
}
function thinkAdvance(state) {
  const think = state.think;
  if (!think.current || !think.queue.length) { thinkDraw(state); return; }
  if (think.hovering || think.expanded) { thinkDraw(state); return; }
  const wait = think.readUntil - Date.now();
  if (wait > 0) {
    thinkDraw(state);
    clearTimeout(think.timer);
    think.timer = setTimeout(() => thinkAdvance(state), wait + 10);
    think.timer?.unref?.();
    return;
  }
  thinkShow(state, think.queue.shift(), true);
}
// New notes join the queue behind the one being read; the very first note on a page types once, with its true age.
function thinkReceive(state, events, { initial = false } = {}) {
  const think = state.think;
  const notes = events.filter(event => event?.kind === 'agent.note').map(event => noteOf(event, state.names)).filter(Boolean)
    .sort((left, right) => left.seq - right.seq || Date.parse(left.at) - Date.parse(right.at));
  if (initial) {
    const newest = notes.at(-1);
    if (newest) thinkShow(state, newest, true);
    else thinkDraw(state);
    return;
  }
  for (const note of notes) {
    if (think.current?.id === note.id || think.queue.some(queued => queued.id === note.id)) continue;
    if (!think.current) { thinkShow(state, note, true); continue; }
    think.queue.push(note);
    if (think.queue.length > 12) think.queue.shift();
  }
  thinkAdvance(state);
}

// ---- the Climb: the levels as a map, read left to right and upward
const dotLabel = dot => [dot.name, dot.retired ? `${LEVEL_WORDS[dot.level] || ''}, retired` : LEVEL_WORDS[dot.level] || '', MONEY_WORDS[dot.money],
  dot.progress ? `${dot.progress.completed} of ${dot.progress.checks.length} checks` : ''].filter(Boolean).join(', ');
const countText = value => (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US'));
// ⟳ as a drawing: the Gym's counter of programs tested.
function cycleIcon() {
  const svg = svgElement('svg', { viewBox: '0 0 12 12', class: 'cycle', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgElement('path', { d: 'M10 6a4 4 0 1 1-1.2-2.85M9.6 1.4v2.4H7.2' }));
  return svg;
}
function looksPips(looks) {
  const box = element('span', null, 'pips');
  if (!looks) return box;
  const shown = Math.min(12, looks.looks);
  for (let index = 0; index < shown; index++) box.append(element('i', null, index < looks.passed ? 'pip is-pass' : 'pip is-fail'));
  if (looks.looks > shown) box.append(element('span', `+${looks.looks - shown}`, 'pips-more'));
  box.setAttribute('title', `${looks.looks} ${looks.looks === 1 ? 'look' : 'looks'} · ${looks.passed} passed`);
  return box;
}
function climbView(state) {
  const host = state.box.agents;
  const map = element('div', null, 'climb-map');
  const svg = svgElement('svg', { class: 'climb-lines', 'aria-hidden': 'true', focusable: 'false' });
  const labels = element('div', null, 'climb-labels');
  const dots = element('div', null, 'climb-dots');
  const bubble = element('div', '', 'climb-bubble');
  bubble.hidden = true;
  bubble.setAttribute('aria-hidden', 'true');
  const tag = element('div', '', 'climb-tag');
  tag.hidden = true;
  tag.setAttribute('aria-hidden', 'true');
  map.append(svg, labels, dots, bubble, tag);
  const ladder = element('ol', null, 'climb-ladder');
  host.replaceChildren(map, ladder);
  const view = { map, svg, labels, dots, bubble, tag, ladder, nodes: new Map(), order: new Map(), layout: null, drawn: false, ripples: 0, hovered: null };
  // The pointer only has to come within twelve pixels of a dot.
  const nearest = move => {
    const box = boxOf(map);
    if (!box || !view.layout) return null;
    const x = move.clientX - box.left;
    const y = move.clientY - box.top;
    let best = null;
    for (const [id, at] of view.layout.dots) {
      const distance = Math.hypot(at.cx - x, at.cy - y);
      if (distance <= 12 && (!best || distance < best.distance)) best = { id, distance, at };
    }
    return best;
  };
  map.addEventListener('pointermove', move => {
    if (move.pointerType && move.pointerType !== 'mouse') return;
    const hit = nearest(move);
    if (hit?.id === view.hovered) return;
    view.nodes.get(view.hovered)?.node.classList?.remove?.('is-hover');
    view.hovered = hit?.id || null;
    if (!hit) { bubble.hidden = true; return; }
    view.nodes.get(hit.id)?.node.classList?.add?.('is-hover');
    const dot = state.model?.dots?.get(hit.id);
    const said = latestNote(state, hit.id);
    bubble.textContent = said ? `${dot?.name || ''} · ${said}` : dot ? dotLabel(dot) : '';
    place(bubble, { left: `${hit.at.cx}px`, top: `${hit.at.cy - 12}px` });
    bubble.hidden = !bubble.textContent;
  });
  map.addEventListener('pointerleave', () => {
    view.nodes.get(view.hovered)?.node.classList?.remove?.('is-hover');
    view.hovered = null;
    bubble.hidden = true;
  });
  map.addEventListener('click', click => {
    if (click.target?.closest?.('button')) return;
    const hit = nearest(click);
    if (hit) openAgent(state, hit.id, view.nodes.get(hit.id)?.node);
  });
  view.ripple = (id, trade = false) => {
    const node = view.nodes.get(id)?.node;
    if (!node || view.ripples >= MAX_RIPPLES || still() || phone()) return;
    view.ripples += 1;
    const ring = element('span', null, `ripple${trade ? ' is-trade' : ''}`);
    ring.setAttribute('aria-hidden', 'true');
    node.append(ring);
    later(state, () => { ring.remove?.(); view.ripples -= 1; }, 650);
  };
  view.pulseDot = id => {
    const node = view.nodes.get(id)?.node;
    if (!node || still()) return;
    node.classList?.add?.('is-pulsing');
    later(state, () => node.classList?.remove?.('is-pulsing'), 1200);
  };
  // The speaker's dot breathes and wears its name while its note is on the card.
  view.speak = id => {
    for (const [other, entry] of view.nodes) entry.node.classList?.toggle?.('is-speaking', other === id);
    const at = view.layout?.dots?.get(id);
    const dot = state.model?.dots?.get(id);
    tag.hidden = !at || !dot;
    if (at && dot) { tag.textContent = dot.name; place(tag, { left: `${Math.max(36, Math.min((view.layout?.width || 800) - 36, at.cx))}px`, top: `${at.cy - 9}px` }); }
  };
  return view;
}
function latestNote(state, id) {
  const note = state.feed.find(event => event.kind === 'agent.note' && streamAgentOf(event.stream) === id);
  return note ? truncate(plainNote(note.payload?.text), 90).text : '';
}
function drawClimbLines(view, model, layout) {
  const { svg } = view;
  const { width: W, height: H, steps, goldX, mainY, sideY } = layout;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  const nodes = [svgElement('rect', { x: goldX, y: 0, width: Math.max(0, W - goldX), height: H, class: 'real-wash' })];
  // The risers, and the walk across the gold line.
  let path = '';
  MAIN_STEPS.forEach((key, index) => {
    const step = steps[key];
    if (!index) { path += `M${step.x} ${step.y}`; return; }
    const before = steps[MAIN_STEPS[index - 1]];
    path += `M${before.x + before.w} ${before.y}H${step.x}V${step.y}`;
  });
  nodes.push(svgElement('path', { d: path, class: 'climb-riser' }));
  // The side path leaves Train flat and never rises: dashed, then dotted gold on the Incubator's ledge, and a ╳ at its end.
  const fork = steps.validation.x;
  const end = steps.incubator.x + steps.incubator.w;
  nodes.push(svgElement('path', { d: `M${fork} ${mainY}Q${fork} ${sideY} ${fork + 16} ${sideY}H${end}`, class: 'side-path' }));
  nodes.push(svgElement('path', { d: `M${end + 3} ${sideY - 6}l8 8m0 -8l-8 8`, class: 'side-end' }));
  for (const key of [...MAIN_STEPS, 'practice', 'incubator']) {
    const step = steps[key];
    const empty = !(model?.steps?.[key]?.agents?.length);
    nodes.push(svgElement('line', { x1: step.x, x2: step.x + step.w, y1: step.y, y2: step.y,
      class: `platform platform-${key}${empty ? ' is-empty' : ''}` }));
  }
  // The holdout's gate: a narrow doorway at the start of its step.
  const gate = steps.holdout;
  nodes.push(svgElement('path', { d: `M${gate.x + 10} ${gate.y}V${gate.y - 17}H${gate.x + 22}V${gate.y}`, class: 'gate' }));
  nodes.push(svgElement('line', { x1: goldX, x2: goldX, y1: 16, y2: H - 4, class: 'gold-line' }));
  svg.replaceChildren(...nodes);
}
function drawClimbLabels(state, view, model, layout) {
  const nodes = [];
  const dollar = element('span', '$', 'gold-dollar');
  dollar.setAttribute('aria-hidden', 'true');
  place(dollar, { left: `${layout.goldX}px`, top: '0px' });
  nodes.push(dollar);
  for (const step of STEPS) {
    const at = layout.steps[step.key];
    const data = model.steps[step.key];
    const count = element('span', countText(data.now), `step-count${data.now === null ? ' is-unknown' : ''}${at.count ? ' is-side' : ''}`);
    count.setAttribute('aria-hidden', 'true');
    place(count, at.count ? { left: `${at.count.x}px`, top: `${at.count.y}px` }
      : { left: `${at.x + 10 + (step.key === 'holdout' ? 22 : 0)}px`, top: `${at.top - (data.agents.length ? 16 : 4)}px` });
    nodes.push(count);
    if (step.key === 'train' && model.trials !== null) {
      const trials = element('span', null, 'step-trials');
      trials.append(cycleIcon(), element('span', model.trials.toLocaleString('en-US'), 'trials-count'));
      trials.setAttribute('title', 'Programs tested in the Gym');
      count.append(trials);
      count.removeAttribute?.('aria-hidden');
      view.trials = trials;
    }
    const label = button(null, `step-label step-${step.key}${step.real ? ' is-real' : ''}${step.track === 'side' ? ' is-side' : ''}`);
    label.dataset.step = step.key;
    label.setAttribute('title', step.title);
    label.setAttribute('aria-label', `${step.word}: ${countText(data.now)} now, ${countText(data.everCount)} ever`);
    label.append(element('span', step.word, 'step-name'));
    const ever = element('span', null, 'step-ever');
    if (step.key === 'train') ever.append(element('span', 'ever', 'ever-word'));
    ever.append(element('span', countText(data.everCount)));
    label.append(ever);
    if (step.key === 'holdout') label.append(looksPips(model.looks));
    label.addEventListener('click', () => openRoster(state, step.key, label));
    place(label, { left: `${at.x + 6}px`, top: `${at.y + 3}px` });
    nodes.push(label);
  }
  const grave = button(null, 'graveyard', `${countText(model.graveyard)} retired`);
  const heap = svgElement('svg', { viewBox: '0 0 30 12', class: 'heap', 'aria-hidden': 'true', focusable: 'false' });
  for (const [cx, cy] of [[4, 10], [9, 10], [14, 10], [19, 10], [24, 10], [6.5, 6], [11.5, 6], [16.5, 6], [21.5, 6], [9, 2], [14, 2], [19, 2]]) {
    heap.append(svgElement('circle', { cx, cy, r: 1.8 }));
  }
  grave.append(heap, element('span', `× ${countText(model.graveyard)}`, 'graveyard-count'));
  grave.setAttribute('title', 'Retired since the reset');
  grave.addEventListener('click', () => openGraveyard(state, grave));
  place(grave, { left: `${layout.graveyard.x}px`, top: `${layout.graveyard.y - 22}px` });
  nodes.push(grave);
  const house = button(null, 'house', `House calibration: ${countText(model.house.calibration)}`);
  house.append(element('span', '⌂', 'house-mark'), element('span', countText(model.house.calibration), 'house-count'));
  if (model.house.liveTest) house.append(element('span', `· ${model.house.liveTest}`, 'house-test'));
  house.setAttribute('title', 'The House’s own trades');
  house.addEventListener('click', () => { state.positionsFilter = 'house'; state.ledgerTable = false; drawPositions(state); state.box.positions?.scrollIntoView?.({ block: 'nearest' }); });
  place(house, { left: `${layout.house.x}px`, top: `${layout.house.y - 22}px` });
  nodes.push(house);
  view.labels.replaceChildren(...nodes);
}
function glide(node, dx, dy) {
  node.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 900, easing: 'cubic-bezier(.2,.7,.2,1)' });
  node.classList?.add?.('is-moving');
  const timer = setTimeout(() => node.classList?.remove?.('is-moving'), 900);
  timer?.unref?.();
}
function drawClimbDots(state, view, model, layout, animate) {
  const seen = new Set();
  view.order = new Map();
  for (const step of STEPS) {
    const ids = [];
    for (const dot of model.steps[step.key].agents) {
      const at = layout.dots.get(dot.id);
      if (!at) continue;
      seen.add(dot.id);
      ids.push(dot.id);
      let entry = view.nodes.get(dot.id);
      const fresh = !entry;
      if (fresh) {
        const node = button(null, 'dot');
        node.dataset.agent = dot.id;
        node.addEventListener('click', () => openAgent(state, dot.id, node));
        node.addEventListener('keydown', key => roveDots(view, key, node));
        entry = { node };
        view.nodes.set(dot.id, entry);
        view.dots.append(node);
      }
      const { node } = entry;
      node.className = `dot money-${dot.money} lvl-${dot.step}${dot.retired ? ' is-retired' : ''}${dot.provisional ? ' is-provisional' : ''}`
        + `${state.speaker === dot.id ? ' is-speaking' : ''}${dot.progress ? ' has-progress' : ''}`;
      node.dataset.step = dot.step;
      node.setAttribute('aria-label', dotLabel(dot));
      place(node, { left: `${at.cx}px`, top: `${at.cy}px` });
      if (dot.progress) setVar(node, '--progress', `${Math.round(dot.progress.fraction * 360)}deg`);
      if (animate && !fresh && entry.step !== dot.step) glide(node, entry.cx - at.cx, entry.cy - at.cy);
      else if (animate && fresh) {
        node.animate?.([{ transform: 'translateY(-18px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 600, easing: 'ease-out' });
        later(state, () => view.ripple(dot.id), 600);
      }
      Object.assign(entry, { cx: at.cx, cy: at.cy, step: dot.step });
    }
    view.order.set(step.key, ids);
  }
  for (const [id, entry] of [...view.nodes]) {
    if (seen.has(id)) continue;
    view.nodes.delete(id);
    // Off the map: into the graveyard's heap.
    const motion = animate ? entry.node.animate?.([{ transform: 'translate(0, 0)', opacity: 1 },
      { transform: `translate(${layout.graveyard.x + 14 - entry.cx}px, ${layout.graveyard.y - 6 - entry.cy}px) scale(.5)`, opacity: 0 }],
    { duration: 900, easing: 'ease-in' }) : null;
    if (motion) motion.onfinish = () => entry.node.remove?.(); else entry.node.remove?.();
  }
  // Tab stops at each step; the arrow keys move between its dots.
  for (const ids of view.order.values()) {
    const keep = ids.includes(view.focus) ? view.focus : ids[0];
    for (const id of ids) view.nodes.get(id)?.node.setAttribute('tabindex', id === keep ? '0' : '-1');
  }
  glowDots(state);
}
function roveDots(view, key, node) {
  const ids = view.order.get(node.dataset.step) || [];
  const index = ids.indexOf(node.dataset.agent);
  const target = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: ids.length - 1 }[key.key];
  if (target === undefined || index === -1) return;
  key.preventDefault?.();
  const next = ids[Math.max(0, Math.min(ids.length - 1, target))];
  view.focus = next;
  for (const id of ids) view.nodes.get(id)?.node.setAttribute('tabindex', id === next ? '0' : '-1');
  view.nodes.get(next)?.node.focus?.();
}
// Dots that spoke in the last ten minutes glow, fading as the minutes pass: where the swarm is thinking.
function glowDots(state) {
  const now = Date.now();
  for (const [id, entry] of state.climb?.nodes || []) {
    const spoke = state.spoke.get(id);
    const glow = spoke ? Math.max(0, 1 - (now - spoke) / GLOW_MS) : 0;
    setVar(entry.node, '--glow', glow.toFixed(2));
  }
}
function drawLadder(state, view, model) {
  const rung = key => {
    const step = model.steps[key];
    const item = element('li', null, `rung rung-${key}${step.track === 'side' ? ' is-side' : ''}${step.real ? ' is-real' : ''}`);
    const control = button(null, 'rung-button');
    control.setAttribute('title', step.title);
    control.setAttribute('aria-label', `${step.word}: ${countText(step.now)} now, ${countText(step.everCount)} ever`);
    const dots = element('span', null, 'rung-dots');
    for (const dot of step.agents.slice(0, 12)) dots.append(dotMark(dot));
    if (step.agents.length > 12) dots.append(element('span', `+${step.agents.length - 12}`, 'rung-more'));
    if (key === 'holdout') dots.append(looksPips(model.looks));
    control.append(element('span', step.word, 'rung-name'), dots, element('span', countText(step.now), 'rung-count'));
    control.addEventListener('click', () => openRoster(state, key, control));
    item.append(control);
    return item;
  };
  const rule = element('li', null, 'rung-rule');
  rule.setAttribute('aria-hidden', 'true');
  rule.append(element('span', '$', 'rung-dollar'));
  const foot = element('li', null, 'rung-foot');
  const grave = button(`× ${countText(model.graveyard)}`, 'rung-grave', `${countText(model.graveyard)} retired`);
  grave.addEventListener('click', () => openGraveyard(state, grave));
  const house = button(`⌂ ${countText(model.house.calibration)}`, 'rung-house', `House calibration: ${countText(model.house.calibration)}`);
  house.addEventListener('click', () => { state.positionsFilter = 'house'; state.ledgerTable = false; drawPositions(state); state.box.positions?.scrollIntoView?.({ block: 'nearest' }); });
  foot.append(grave, house);
  view.ladder.replaceChildren(...['sized', 'probe', 'holdout', 'tuition'].map(rung), rule, ...['validation', 'train', 'practice', 'incubator'].map(rung), foot);
}
function drawClimb(state, { animate = false } = {}) {
  if (!state.box.agents) return;
  if (!state.checkpoint) { state.box.agents.replaceChildren(element('p', '—', 'empty-state')); state.climb = null; return; }
  state.model = climbModel(state.checkpoint, { born: [...state.born.values()], gone: [...state.gone] });
  const view = state.climb || (state.climb = climbView(state));
  const size = boxOf(view.map);
  const layout = climbLayout(state.model, size?.width || 800, size?.height || 300);
  view.layout = layout;
  drawClimbLines(view, state.model, layout);
  drawClimbLabels(state, view, state.model, layout);
  drawClimbDots(state, view, state.model, layout, animate && view.drawn && !still() && floorRunning(state.checkpoint));
  drawLadder(state, view, state.model);
  if (state.speaker) view.speak(state.speaker);
  view.drawn = true;
}
// The Gym's counter rolls to each new checkpoint's value; it never counts between checkpoints.
function rollTrials(state, from, to) {
  const node = state.climb?.trials;
  if (!node || from === null || to === null || from === to || still()) return;
  const start = Date.now();
  const step = () => {
    const share = Math.min(1, (Date.now() - start) / 600);
    const label = node.children?.[1] || node;
    label.textContent = Math.round(from + (to - from) * share).toLocaleString('en-US');
    if (share < 1) later(state, step, 30);
  };
  step();
}

// ---- sheets: an agent's card, a step's roster, the graveyard (a popover on a desktop, a bottom sheet on a phone)
function openSheet(state, nodes, opener, label, agent = null) {
  const sheet = state.box.sheet;
  if (!sheet) return;
  const close = button('×', 'sheet-close', 'Close');
  close.addEventListener('click', () => closeSheet(state));
  const body = element('div', null, 'sheet-body');
  body.append(...nodes);
  sheet.replaceChildren(close, body);
  sheet.setAttribute('aria-label', label);
  const reopened = state.sheet?.agent && state.sheet.agent === agent;
  sheet.hidden = false;
  state.sheet = { opener, label, agent };
  if (reopened) return;
  const anchor = boxOf(opener);
  const box = boxOf(sheet);
  if (anchor && box && !phone() && typeof window !== 'undefined' && window.innerWidth) {
    const left = anchor.right + 12 + box.width < window.innerWidth - 8 ? anchor.right + 12 : Math.max(8, anchor.left - box.width - 12);
    const top = Math.max(8, Math.min(window.innerHeight - box.height - 8, anchor.top - 24));
    place(sheet, { left: `${left}px`, top: `${top}px` });
  }
  close.focus?.({ preventScroll: true });
}
function closeSheet(state) {
  const sheet = state.box.sheet;
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  sheet.replaceChildren();
  const opener = state.sheet?.opener;
  state.sheet = null;
  opener?.focus?.({ preventScroll: true });
}
function sheetHead(title, chips = []) {
  const head = element('div', null, 'sheet-head');
  head.append(element('h3', title), ...chips.filter(Boolean));
  return head;
}
const levelChip = (level, extra = '') => {
  if (!level || !LEVEL_WORDS[level]) return null;
  const step = STEPS.find(entry => entry.level === level);
  const chip = element('span', LEVEL_WORDS[level], `chip-level lvl-${step?.key || 'retired'}${step?.real ? ' is-real' : ''}${extra}`);
  if (step) chip.setAttribute('title', step.title);
  return chip;
};
// A step's agents: each one's dot, name and the first sentence of its thesis. The Practice step is the practice league.
function openRoster(state, key, opener) {
  const step = state.model?.steps?.[key];
  if (!step) return;
  const nodes = [sheetHead(step.word, [element('span', countText(step.now), 'sheet-count')])];
  const league = key === 'practice' ? practicePanel(state.checkpoint) : null;
  nodes.push(...(league || [element('p', step.title, 'sheet-caption')]));
  if (step.agents.length) nodes.push(rosterList(state, step.agents));
  openSheet(state, nodes, opener, step.word);
}
function rosterList(state, dots) {
  const list = element('ul', null, 'roster');
  for (const dot of dots) {
    const item = element('li');
    const row = button(null, 'roster-row');
    const agent = state.agents.get(dot.id);
    const thesis = thesisOf(state, dot.id) || firstSentence(wholeSentences(agent?.mechanism));
    row.append(dotMark(dot), element('span', dot.name, 'roster-name'), element('span', firstSentence(thesis), 'roster-thesis'));
    row.addEventListener('click', () => openAgent(state, dot.id, row));
    item.append(row);
    list.append(item);
  }
  return list;
}
// The graveyard: the most recent retirements and their causes, the most interesting line the swarm writes.
function openGraveyard(state, opener) {
  const draw = () => {
    const lines = feedLines(state.graveyard || state.feed.filter(event => event.kind === 'swarm.news'), state.names, { limit: 40 })
      .filter(line => line.tape === 'retired');
    const list = element('ul', null, 'roster graveyard-list');
    for (const line of lines) {
      const item = element('li', null, 'grave-row');
      item.append(element('span', line.name, 'roster-name'), element('span', line.brief, 'roster-thesis'), element('time', shortAgo(line.at), 'grave-age'));
      list.append(item);
    }
    return [sheetHead('Retired', [element('span', `× ${countText(state.model?.graveyard)}`, 'sheet-count')]), list];
  };
  openSheet(state, draw(), opener, 'Retired');
  loadEvents({ kind: 'swarm.news', limit: MAX_EVENT_LIMIT }).then(data => {
    state.graveyard = data.events;
    if (state.sheet?.label === 'Retired') { const body = state.box.sheet?.children?.[1]; body?.replaceChildren?.(...draw()); }
  }).catch(() => {});
}
// An agent's card: its thesis, its record, its open structures, its checklist when the House publishes one, and its
// last five thoughts. Clicking a dot also follows it on the tape.
function thesisOf(state, id) {
  const published = (Array.isArray(state.checkpoint?.rationale?.agents) ? state.checkpoint.rationale.agents : []).find(entry => entry?.id === id);
  return published ? published.thesis : null;
}
function recordLine(agent) {
  const record = agent?.record;
  if (!record) return '';
  const tally = (label, row) => `${label} ${row.wins}/${row.trades} ${signedMoney(row.pnl_usd)}`;
  return [`trials ${Number(record.trials).toLocaleString('en-US')}`, `revisions ${Number(record.revisions).toLocaleString('en-US')}`,
    record.forward ? tally('forward', record.forward) : '', tally('real', record.real || { wins: 0, trades: 0, pnl_usd: '0' })].filter(Boolean).join(' · ');
}
function openAgent(state, id, opener, { follow = true, quiet = false } = {}) {
  if (!agentId(id)) return;
  const agent = state.agents.get(id) || null;
  const dot = state.model?.dots?.get(id) || null;
  const name = dot?.name || (agent ? agentName(agent) : state.names.get(id) || titleCase(id));
  const chips = [levelChip(dot?.level)];
  if (agent && dot && agent.band !== 'gym' && BAND_WORDS[agent.band] && BAND_WORDS[agent.band] !== LEVEL_WORDS[dot.level]) chips.push(tagNode(BAND_WORDS[agent.band], 'band'));
  const head = sheetHead(name, chips);
  head.prepend?.(dotMark(dot || { money: 'research', step: 'train' }));
  const nodes = [head];
  const thesis = thesisOf(state, id) || wholeSentences(agent?.mechanism) || state.births.get(id) && thesisText(state.births.get(id));
  if (thesis) nodes.push(element('blockquote', thesis, 'agent-thesis'));
  if (agent) nodes.push(element('p', recordLine(agent), 'agent-record'));
  const structures = structureRows(state.checkpoint).filter(row => row.agent === id);
  if (structures.length) {
    const list = element('ul', null, 'agent-positions');
    for (const row of structures) {
      const item = element('li');
      item.append(moneyTag(row.real, row.incubator), element('span', `${row.what} · ${row.detail}`), element('span', `risk ${row.maxLoss}`), element('span', row.pnl, row.tone));
      list.append(item);
    }
    nodes.push(list);
  }
  if (agent && agent.band !== 'retired' && dot?.progress) nodes.push(progressDetail(dot.progress, agent.band));
  const thoughts = element('ol', null, 'agent-thoughts');
  const fill = events => {
    const notes = events.filter(event => event.kind === 'agent.note').slice(0, 5);
    thoughts.replaceChildren(...notes.map(event => {
      const item = element('li');
      item.append(element('time', shortAgo(event.at), 'thought-age'), element('span', plainNote(event.payload?.text)));
      return item;
    }));
  };
  fill(state.feed.filter(event => streamAgentOf(event.stream) === id));
  nodes.push(thoughts);
  const links = element('p', null, 'agent-links');
  const follow_ = button('→ thoughts', 'link-button');
  follow_.addEventListener('click', () => { followAgent(state, id); closeSheet(state); });
  links.append(follow_);
  nodes.push(links);
  openSheet(state, nodes, opener, name, id);
  if (!quiet) state.climb?.pulseDot?.(id);
  loadEvents({ agent: id, kind: 'agent.note', limit: 5 }).then(data => { if (state.sheet?.agent === id) fill(data.events); }).catch(() => {});
  if (follow) followAgent(state, id);
}
// An open agent card is redrawn with every checkpoint, so its checklist and record never outlive their evidence.
function refreshSheet(state) {
  const id = state.sheet?.agent;
  if (id) openAgent(state, id, state.sheet.opener, { follow: false, quiet: true });
}
function progressDetail(progress, band) {
  const panel = element('div', null, 'agent-progress');
  if (!progress) {
    if (band !== 'retired') panel.append(element('p', 'Progress unavailable', 'progress-unavailable'));
    return panel;
  }
  const head = element('div', null, 'progress-heading');
  head.append(element('span', progress.target === 'maintain' ? progress.label : `Next · ${progress.label}`), element('span', progress.count, 'progress-count'));
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
    meter.setAttribute('aria-hidden', 'true');
    meter.append(fill);
    item.append(meter);
    list.append(item);
  }
  panel.append(list);
  if (progress.blocker) panel.append(element('p', progress.blocker, 'progress-blocker'));
  else if (progress.ready) panel.append(element('p', progress.target === 'maintain' ? 'Holding the line' : 'Checks complete', 'progress-ready'));
  return panel;
}

// ---- positions, each with its reason and its result
const ROUTE_LEVEL = { tuition: 'tuition', incubator: 'incubator', probe: 'probe', sized: 'sized' };
const centsText = cents => (cents === null ? '—' : signedMoney(decimalOf(cents)));
function heldText(line) {
  const opened = Date.parse(line.openedAt);
  if (line.open) return `open ${shortAgo(opened)}`;
  const minutes = Math.floor((Date.parse(line.closedAt) - opened) / 60000);
  return minutes < 1 ? 'held <1m' : `held ${shortAgo(opened, opened + minutes * 60000)}`;
}
// A bar that diverges from a hairline zero: losses left, gains right, on one scale for the whole table.
function microBar(cents, scale) {
  const bar = element('span', null, 'pos-bar');
  bar.setAttribute('aria-hidden', 'true');
  bar.append(element('span', null, 'pos-bar-zero'));
  if (cents !== null && scale > 0n && cents !== 0n) {
    const size = cents < 0n ? -cents : cents;
    const share = Math.max(2, Number(size * 500n / scale) / 10);
    const fill = element('span', null, `pos-bar-fill ${cents < 0n ? 'negative' : 'positive'}`);
    place(fill, cents < 0n ? { left: `${50 - share}%`, width: `${share}%` } : { left: '50%', width: `${share}%` });
    bar.append(fill);
  }
  return bar;
}
function lifeBar(row, now = Date.now()) {
  const opened = Date.parse(row.opened_at);
  const [year, month, day] = show(row.expiry).split('-').map(Number);
  const expires = year ? nyInstant(year, month, day, 16, 0) : NaN;
  const box = element('div', null, 'life');
  if (!Number.isFinite(opened) || !Number.isFinite(expires) || expires <= opened) return box;
  const at = value => `${Math.max(0, Math.min(100, (value - opened) / (expires - opened) * 100)).toFixed(2)}%`;
  const track = element('span', null, 'life-track');
  track.append(element('span', null, 'life-start'), element('span', null, 'life-end'));
  const mark = element('span', row.status === 'open' ? null : '×', row.status === 'open' ? 'life-now' : 'life-close');
  place(mark, { left: at(row.status === 'open' ? now : Date.parse(row.closed_at)) });
  track.append(mark);
  track.setAttribute('aria-hidden', 'true');
  const ends = element('span', null, 'life-dates');
  ends.append(element('span', date(row.opened_at, 'day')), element('span', expiryText(row.expiry)));
  box.setAttribute('title', `Opened ${date(row.opened_at)} · expires ${expiryText(row.expiry)}${row.status === 'open' ? '' : ` · closed ${date(row.closed_at)}`}`);
  box.append(track, ends);
  return box;
}
// The P&L against the most it could lose: a 6px track from −risk through zero to +risk. No maximum gain is ever shown:
// beside the maximum loss it would reveal the strikes' width.
function riskBar(pnl, risk) {
  if (!numeric(risk) || centsOf(risk) <= 0n) return null;
  const box = element('div', null, 'risk');
  const track = element('span', null, 'risk-track');
  track.setAttribute('aria-hidden', 'true');
  track.append(element('span', null, 'risk-zero'));
  const share = riskShare(pnl, risk);
  if (share !== null && share !== 0) {
    const width = Math.min(50, Math.abs(share) / 2);
    const fill = element('span', null, `risk-fill ${share < 0 ? 'negative' : 'positive'}`);
    place(fill, share < 0 ? { left: `${50 - width}%`, width: `${width}%` } : { left: '50%', width: `${width}%` });
    track.append(fill);
  }
  const labels = element('span', null, 'risk-labels');
  const size = share === null ? null : Math.abs(share) >= 0.5 ? `${Math.round(Math.abs(share))}%` : share ? '<1%' : '0%';
  labels.append(element('span', `risk ${money(risk, 0)}`), element('span', share === null ? '—' : `${share > 0 ? '+' : share < 0 ? '−' : ''}${size} of risk`, share < 0 ? 'negative' : share > 0 ? 'positive' : ''));
  box.append(track, labels);
  return box;
}
function rationaleCard(state, line, row) {
  const why = rationaleFor(row, state.checkpoint, { trades: state.trades, births: state.births });
  const card = element('div', null, `rationale${why.house ? ' is-house' : ''}`);
  if (why.thesis) {
    const thesis = element('blockquote', why.thesis, 'rationale-thesis');
    card.append(thesis);
    if (why.thesis.length > 220) {
      const more = button('↓', 'thesis-more', 'Read the whole thesis');
      more.addEventListener('click', event => { event.stopPropagation?.(); thesis.classList?.toggle?.('is-open'); more.textContent = more.textContent === '↓' ? '↑' : '↓'; });
      card.append(more);
    }
  }
  const trigger = element('p', null, 'rationale-why');
  if (why.openWhy) { const chip = element('span', null, 'why-chip why-open'); chip.append(glyph('trade'), element('span', why.openWhy)); trigger.append(chip); }
  if (!line.open && (why.closeWhy || why.exit)) {
    const chip = element('span', null, 'why-chip why-close');
    chip.append(element('span', '↩', 'why-mark'), element('span', [why.closeWhy, EXIT_WORDS[why.exit]].filter(Boolean).join(' · ')));
    trigger.append(chip);
  }
  const route = ROUTE_LEVEL[why.route] ? levelChip(ROUTE_LEVEL[why.route]) : why.route ? element('span', ROUTE_WORDS[why.route], 'chip-level lvl-house') : null;
  if (route) { if (why.route === 'incubator') route.setAttribute('title', INCUBATOR_TITLE); trigger.append(route); }
  if (trigger.children.length) card.append(trigger);
  card.append(lifeBar(row));
  const risk = riskBar(row.pnl_usd, why.maxLoss);
  if (risk) card.append(risk);
  if (!why.house && agentId(row.agent)) {
    const links = element('p', null, 'rationale-links');
    const thoughts = button('→ thoughts', 'link-button');
    thoughts.addEventListener('click', event => { event.stopPropagation?.(); followAgent(state, row.agent); state.box.tape?.scrollIntoView?.({ block: 'nearest' }); });
    const agent = button('→ agent', 'link-button');
    agent.addEventListener('click', event => { event.stopPropagation?.(); openAgent(state, row.agent, agent, { follow: false }); });
    links.append(thoughts, agent);
    card.append(links);
  }
  return card;
}
function positionItem(state, line, row, scale) {
  const expanded = state.openPosition === line.id;
  const item = element('li', null, `pos-item pos-${line.source}${line.open ? ' is-open' : ''}${expanded ? ' is-expanded' : ''}${state.seenPositions.size && !state.seenPositions.has(`${line.id}:${line.open}`) ? ' line-new' : ''}`);
  item.dataset.position = line.id;
  const control = button(null, 'pos-line');
  control.setAttribute('aria-expanded', String(expanded));
  const why = rationaleFor(row, state.checkpoint, { trades: state.trades, births: state.births });
  const step = ROUTE_LEVEL[why?.route] || (line.source === 'incubator' ? 'incubator' : AGENT_SOURCES.includes(line.source) ? 'tuition' : 'train');
  const mark = dotMark({ money: line.open ? (line.source === 'incubator' ? 'incubator' : 'real') : 'research', step });
  const who = element('span', null, 'pos-who');
  who.append(element('span', line.who, 'pos-name'));
  if (line.route) { const tag = tagNode(line.route, 'incubator'); tag.setAttribute('title', INCUBATOR_TITLE); who.append(tag); }
  const age = element('span', null, 'pos-age');
  if (line.open) age.append(pulse('pulse pos-pulse'));
  age.append(element('span', heldText(line)));
  control.append(mark, who, element('span', line.what, 'pos-what'), age, element('span', line.pnl, `pos-pnl ${line.tone}`.trim()), microBar(line.usd === null ? null : centsOf(line.usd), scale));
  control.addEventListener('click', () => {
    state.openPosition = expanded ? null : line.id;
    hidePeek(state);
    drawPositions(state);
    if (!expanded) state.chart?.pulse?.(line.id);
  });
  control.addEventListener('pointerenter', move => {
    state.chart?.pulse?.(line.id);
    if (!expanded && finePointer() && (!move.pointerType || move.pointerType === 'mouse')) showPeek(state, control, rationaleCard(state, line, row));
  });
  control.addEventListener('pointerleave', () => hidePeek(state));
  item.append(control);
  if (expanded) item.append(rationaleCard(state, line, row));
  return item;
}
function showPeek(state, anchor, card) {
  const peek = state.box.peek;
  const box = boxOf(anchor);
  const host = boxOf(state.box.positions);
  if (!peek || !box || !host) return;
  peek.replaceChildren(card);
  peek.hidden = false;
  const left = box.left - 332 > 8 ? box.left - 332 : Math.min(window.innerWidth - 328, box.right + 8);
  place(peek, { left: `${left}px`, top: `${Math.max(8, Math.min(window.innerHeight - 260, box.top - 40))}px` });
}
function hidePeek(state) { if (state.box.peek) { state.box.peek.hidden = true; state.box.peek.replaceChildren(); } }
// The House's own trades fold into one line per kind: a strip of ticks above or below a baseline by sign, and their sum.
function houseGroup(state, kind, lines, rows, scale) {
  const expanded = state.openGroup === kind || state.positionsFilter === 'house';
  const item = element('li', null, `pos-item pos-group pos-${kind}${expanded ? ' is-expanded' : ''}`);
  item.dataset.group = kind;
  const control = button(null, 'pos-line');
  control.setAttribute('aria-expanded', String(expanded));
  const known = lines.every(line => line.usd !== null);
  const sum = known ? lines.reduce((total, line) => total + centsOf(line.usd), 0n) : null;
  const strip = svgElement('svg', { viewBox: '0 0 64 16', class: 'pos-ticks', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'none' });
  strip.append(svgElement('line', { x1: 0, x2: 64, y1: 8, y2: 8, class: 'pos-ticks-base' }));
  const most = lines.reduce((top, line) => { const value = line.usd === null ? 0n : centsOf(line.usd); const size = value < 0n ? -value : value; return size > top ? size : top; }, 1n);
  lines.forEach((line, index) => {
    if (line.usd === null) return;
    const value = centsOf(line.usd);
    const height = Math.max(1, Number((value < 0n ? -value : value) * 70n / most) / 10);
    const x = (index + 0.5) * 64 / lines.length;
    strip.append(svgElement('line', { x1: x, x2: x, y1: 8, y2: value < 0n ? 8 + height : 8 - height, class: value < 0n ? 'negative' : 'positive' }));
  });
  const who = element('span', null, 'pos-who');
  who.append(element('span', `${SOURCE_WORDS[kind]} ×${lines.length}`, 'pos-name'));
  control.append(glyph('house'), who, strip, element('span', '', 'pos-age'), element('span', centsText(sum), `pos-pnl ${sum === null ? '' : sum < 0n ? 'negative' : sum > 0n ? 'positive' : ''}`.trim()),
    microBar(sum, scale));
  control.addEventListener('click', () => { state.openGroup = expanded ? null : kind; if (state.positionsFilter === 'house' && expanded) state.positionsFilter = null; drawPositions(state); });
  item.append(control);
  if (expanded) {
    const list = element('ul', null, 'pos-sublist');
    for (const line of lines) list.append(positionItem(state, line, rows.get(line.id), scale));
    item.append(list);
  }
  return item;
}
function positionsHead(state, ledger) {
  const head = element('div', null, 'pos-head');
  const chip = (label, key) => {
    const node = button(label, 'chip');
    node.setAttribute('aria-pressed', String(state.positionsFilter === key));
    node.addEventListener('click', () => { state.positionsFilter = state.positionsFilter === key ? null : key; drawPositions(state); });
    return node;
  };
  const count = list => list.length.toLocaleString('en-US');
  if (ledger) head.append(chip(`Open ${count(ledger.open)}`, 'open'), chip(`Closed ${count(ledger.closed)}`, 'closed'));
  if (state.positionsFilter === 'house') {
    const clear = button('⌂ ×', 'chip', 'Show every position');
    clear.setAttribute('aria-pressed', 'true');
    clear.addEventListener('click', () => { state.positionsFilter = null; drawPositions(state); });
    head.append(clear);
  }
  const table = button('≡', 'icon-button pos-table-toggle', 'The ledger, line by line');
  table.setAttribute('aria-pressed', String(Boolean(state.ledgerTable)));
  table.setAttribute('title', 'Every line, adding up to Profit');
  table.addEventListener('click', () => { state.ledgerTable = !state.ledgerTable; drawPositions(state); });
  head.append(table);
  return head;
}
function drawPositions(state) {
  const box = state.box.positions;
  if (!box) return;
  const ledger = state.checkpoint ? positionsLedger(state.checkpoint) : null;
  const ready = nodes => { box.replaceChildren(...nodes); box.setAttribute('aria-busy', 'false'); };
  if (!ledger) { ready([element('p', EMPTY_POSITIONS, 'empty-state')]); return; }
  const head = positionsHead(state, ledger);
  if (state.ledgerTable) { ready([head, ...positionsPanel(state.checkpoint)]); return; }
  const rows = new Map(state.checkpoint.positions.rows.map(row => [row.id, row]));
  const filter = state.positionsFilter;
  const lines = [...ledger.open, ...ledger.closed].filter(line => (filter === 'open' ? line.open : filter === 'closed' ? !line.open : true));
  const agents = filter === 'house' ? [] : lines.filter(line => AGENT_SOURCES.includes(line.source));
  const scale = lines.reduce((top, line) => { const value = line.usd === null ? 0n : centsOf(line.usd); const size = value < 0n ? -value : value; return size > top ? size : top; }, 0n);
  const groups = Object.keys(SOURCE_WORDS).map(kind => [kind, lines.filter(line => line.source === kind)]).filter(([, list]) => list.length);
  const groupScale = groups.reduce((top, [, list]) => {
    const sum = list.every(line => line.usd !== null) ? list.reduce((total, line) => total + centsOf(line.usd), 0n) : 0n;
    const size = sum < 0n ? -sum : sum;
    return size > top ? size : top;
  }, scale);
  const list = element('ul', null, 'pos-list');
  for (const line of agents) list.append(positionItem(state, line, rows.get(line.id), groupScale));
  for (const [kind, group] of groups) list.append(houseGroup(state, kind, group, rows, groupScale));
  const nodes = [head];
  if (!ledger.open.length && !ledger.closed.length) nodes.push(element('p', EMPTY_POSITIONS, 'empty-state'));
  else nodes.push(list);
  nodes.push(positionsFoot(ledger));
  ready(nodes);
  state.seenPositions = new Set([...ledger.open, ...ledger.closed].map(line => `${line.id}:${line.open}`));
}
// One quiet line under the rows, so they add up to Profit to the cent: the account's other activity, the positions not
// listed, any unreconciled difference, and Profit (a dash while it is unknown).
function positionsFoot(ledger) {
  const parts = [`other ${ledger.other.pnl}`];
  if (ledger.earlier) parts.push(`${ledger.earlier.count.toLocaleString('en-US')} not listed ${ledger.earlier.pnl}`);
  if (ledger.unreconciled) parts.push(`unreconciled ${ledger.unreconciled.pnl}`);
  parts.push(`Profit ${ledger.total.pnl}`);
  const foot = element('p', parts.join(' · '), 'pos-foot');
  foot.setAttribute('title', [`Other account activity: ${ledger.other.detail || '—'}`, ledger.earlier ? `${ledger.earlier.label}: ${ledger.earlier.detail}` : '',
    'Every position, with these, adds up to Profit to the cent.'].filter(Boolean).join('\n'));
  return foot;
}
// The ledger as a table (≡): the exact lines that add up to Profit, and the chart's table view.
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
function stampCell(className, value) {
  const node = cell('td', className);
  if (!value) return node;
  const time = element('time', date(value, 'short'));
  time.dateTime = value;
  time.setAttribute('title', date(value));
  node.append(time);
  return node;
}
function positionRow(line) {
  const row = element('tr', null, `pos-row pos-${line.source}${line.open ? ' pos-open' : ''}`);
  row.dataset.position = line.id;
  const closed = line.open ? cell('td', 'closed pos-still-open', 'open') : stampCell('closed', line.closedAt);
  const who = cell('th', 'who', line.route ? null : line.who);
  if (line.route) {
    const tag = tagNode(line.route, 'incubator');
    tag.setAttribute('title', INCUBATOR_TITLE);
    who.append(element('span', line.who), tag);
  }
  row.append(who, cell('td', 'what', line.what), cell('td', 'qty', line.quantity), cell('td', 'expiry', line.expiry),
    stampCell('opened', line.openedAt), closed, cell('td', `pnl ${line.tone}`.trim(), line.pnl), cell('td', 'share', line.share));
  return row;
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
  const head = element('tr', null, 'pos-group-head');
  const title = element('th', label);
  title.setAttribute('scope', 'rowgroup');
  title.setAttribute('colspan', String(POSITION_COLUMNS.length));
  head.append(title);
  body.append(head, ...rows);
  return body;
}
function positionsPanel(checkpoint, now = Date.now()) {
  const ledger = positionsLedger(checkpoint, now);
  if (!ledger) return [element('p', EMPTY_POSITIONS, 'empty-state')];
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
  if (ledger.open.length) table.append(groupBody('Open', ledger.open.map(positionRow)));
  if (ledger.closed.length) table.append(groupBody('Closed', ledger.closed.map(positionRow)));
  if (!ledger.open.length && !ledger.closed.length && !ledger.earlier) {
    const body = element('tbody', null, 'pos-body pos-body-empty');
    const row = element('tr', null, 'pos-empty');
    const empty = element('td', EMPTY_POSITIONS, 'empty-state');
    empty.setAttribute('colspan', String(POSITION_COLUMNS.length));
    row.append(empty);
    body.append(row);
    table.append(body);
  }
  const foot = element('tfoot');
  foot.append(...(ledger.earlier ? [sumRow(ledger.earlier)] : []), sumRow(ledger.other), ...(ledger.unreconciled ? [sumRow(ledger.unreconciled)] : []),
    sumRow(ledger.total));
  foot.setAttribute('title', 'Every line above adds up to Profit, to the cent.');
  table.append(foot);
  const scroll = element('div', null, 'positions-scroll');
  scroll.append(table);
  return [caption, scroll];
}
// The practice league, in the Practice step's sheet: shadow trades, never real money, under its caption; its totals in
// a dashed box labelled "practice".
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
  const totals = element('p', null, 'practice-total');
  totals.append(element('span', 'practice', 'practice-word'), element('span', `${league.total.label} · ${league.total.trades} trades · `), element('b', league.total.pnl, league.total.tone || null));
  return [caption, scroll, totals];
}

// ---- performance over time: Realized against Costs on one dollar axis, and the balance on its own
function balanceChart(series) {
  const figure = element('figure', null, `balance balance-${series.tone || 'flat'}`);
  figure.setAttribute('title', BALANCE_TITLE);
  const { width, height } = series;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', class: 'balance-svg',
    role: 'img', 'aria-label': `Brokerage Account balance, ${money(series.first.equity.toFixed(2))} to ${money(series.last.equity.toFixed(2))}.`,
  });
  const ticks = niceTicks(series.min, series.max);
  const yOf = value => 6 + (series.max - value) / (series.max - series.min) * (height - 12);
  const labels = element('div', null, 'balance-ticks');
  labels.setAttribute('aria-hidden', 'true');
  for (const tick of ticks) {
    svg.append(svgElement('line', { x1: 0, x2: width, y1: yOf(tick), y2: yOf(tick), class: 'grid' }));
    const label = element('span', tickMoney(tick), 'tick');
    place(label, { top: `${(yOf(tick) / height * 100).toFixed(2)}%` });
    labels.append(label);
  }
  svg.append(svgElement('path', { d: series.area, class: 'balance-area' }), svgElement('path', { d: series.path, class: 'balance-line' }));
  const cross = svgElement('line', { x1: 0, x2: 0, y1: 0, y2: height, class: 'balance-cross', opacity: 0 });
  svg.append(cross);
  const plot = element('div', null, 'balance-plot');
  const end = element('span', null, 'balance-dot');
  place(end, { left: `${(series.last.x / width * 100).toFixed(2)}%`, top: `${(series.last.y / height * 100).toFixed(2)}%` });
  const readout = element('span', '', 'balance-readout');
  readout.hidden = true;
  plot.append(svg, labels, end, readout);
  plot.addEventListener('pointermove', move => {
    try {
      const box = svg.getBoundingClientRect();
      const x = (move.clientX - box.left) / box.width * width;
      const nearest = series.points.reduce((best, point) => (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best), series.points[0]);
      cross.setAttribute('x1', nearest.x.toFixed(1));
      cross.setAttribute('x2', nearest.x.toFixed(1));
      cross.setAttribute('opacity', '1');
      readout.textContent = `${money(nearest.equity.toFixed(2))} · ${date(new Date(nearest.at).toISOString())}`;
      readout.hidden = false;
      place(readout, { left: `${Math.min(80, Math.max(0, nearest.x / width * 100 - 10)).toFixed(2)}%` });
    } catch { /* no layout here */ }
  });
  plot.addEventListener('pointerleave', () => { readout.hidden = true; cross.setAttribute('opacity', '0'); });
  figure.append(plot);
  return figure;
}
function balancePanel(checkpoint, marks) {
  const series = accountSeries(marks, checkpoint);
  const nodes = series ? [balanceChart(series)] : [];
  const account = checkpoint?.account;
  const caption = element('p', null, 'balance-caption');
  caption.setAttribute('title', BALANCE_TITLE);
  if (account) {
    const balance = element('span', money(account.equity), 'balance-current');
    balance.setAttribute('aria-label', `Current account balance ${money(account.equity)}`);
    caption.append(balance, element('span', '·'), timeNode(account.as_of));
  } else caption.append(element('span', '—'));
  nodes.push(caption);
  return nodes;
}
// The archive point nearest an instant, within five minutes.
function scoreNear(points, at) {
  let best = null;
  for (const point of points) {
    const distance = Math.abs(Date.parse(point.at) - at);
    if (distance <= 5 * 60000 && (!best || distance < best.distance)) best = { point, distance };
  }
  return best?.point || null;
}
export function scoreModel(checkpoint, score, now = Date.now()) {
  const realized = realizedSteps(checkpoint);
  const points = Array.isArray(score?.points) ? score.points : [];
  const profit = scoreSeries(points, 'profit_usd');
  const costs = scoreSeries(points, 'costs_usd');
  const bill = inputCosts(checkpoint, now);
  const basis = Date.parse(profitBasis(checkpoint).start_at);
  const start = realized && Number.isFinite(realized.start) ? Math.min(realized.start, basis) : basis;
  const published = Date.parse(checkpoint?.published_at);
  const end = Math.max(Number.isFinite(published) ? published : now, ...points.map(point => Date.parse(point.at)).filter(Number.isFinite));
  const lastProfit = profit.at(-1)?.at(-1) || null;
  return {
    start, end, realized, profit, costs, points,
    costsNow: bill.total === null ? null : { at: Date.parse(bill.asOf), cents: centsOf(bill.total) },
    profitFresh: lastProfit && end - lastProfit.at <= 10 * 60000 ? lastProfit : null,
  };
}
function scoreChart(state, plot) {
  const checkpoint = state.checkpoint;
  const model = scoreModel(checkpoint, state.score);
  const size = boxOf(plot);
  const W = Math.max(280, size?.width || 600);
  const H = Math.max(150, size?.height || 220);
  const margin = { left: 46, right: 132, top: 14, bottom: 22 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const values = [0];
  if (model.realized) values.push(Number(model.realized.startCents), ...model.realized.steps.map(step => Number(step.cents)));
  for (const segment of [...model.profit, ...model.costs]) values.push(...segment.map(point => Number(point.cents)));
  if (model.costsNow) values.push(Number(model.costsNow.cents));
  let low = Math.min(...values) / 100;
  let high = Math.max(...values) / 100;
  const pad = Math.max(1, (high - low) * 0.08);
  low -= low < 0 ? pad : 0;
  high += pad;
  const span = Math.max(1, model.end - model.start);
  const x = at => margin.left + (Math.max(model.start, Math.min(model.end, at)) - model.start) / span * plotW;
  const y = dollars => margin.top + (high - dollars) / (high - low) * plotH;
  const yc = cents => y(Number(cents) / 100);
  const svg = svgElement('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'score-svg', role: 'img',
    'aria-label': `Realized ${model.realized ? centsText(model.realized.cents) : '—'} since the reset; costs ${model.costsNow ? money(decimalOf(model.costsNow.cents)) : '—'}.` });
  const nodes = [];
  for (const [from, to] of marketClosedBands(model.start, model.end)) {
    nodes.push(svgElement('rect', { x: x(from), y: margin.top, width: Math.max(0, x(to) - x(from)), height: plotH, class: 'closed-band' }));
  }
  for (const tick of niceTicks(low, high)) {
    nodes.push(svgElement('line', { x1: margin.left, x2: margin.left + plotW, y1: y(tick), y2: y(tick), class: tick === 0 ? 'zero' : 'grid' }));
    const label = svgElement('text', { x: margin.left - 6, y: y(tick) + 3.5, class: 'tick', 'text-anchor': 'end' });
    label.textContent = tickMoney(tick);
    nodes.push(label);
  }
  if (low < 0 && !niceTicks(low, high).includes(0)) nodes.push(svgElement('line', { x1: margin.left, x2: margin.left + plotW, y1: y(0), y2: y(0), class: 'zero' }));
  // Day ticks at New York midnight, thinned to fit.
  const first = nyParts(model.start);
  const days = [];
  for (let day = Date.UTC(first.year, first.month - 1, first.day) + 86400000; day <= model.end + 86400000; day += 86400000) {
    const date_ = new Date(day);
    const at = nyInstant(date_.getUTCFullYear(), date_.getUTCMonth() + 1, date_.getUTCDate(), 0, 0);
    if (at > model.start && at < model.end) days.push(at);
  }
  const every = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 56))));
  days.forEach((at, index) => {
    if (index % every) return;
    const label = svgElement('text', { x: x(at), y: H - 6, class: 'tick', 'text-anchor': 'middle' });
    label.textContent = date(new Date(at + 3600000).toISOString(), 'day');
    nodes.push(label);
  });
  // The gap between Realized and Costs, washed by its sign wherever both are known. It is not Net (Net drops open gains
  // and counts other activity), so it carries no label.
  if (model.realized) {
    for (const segment of model.costs) {
      if (segment.length < 2) continue;
      const times = [...new Set([...segment.map(point => point.at), ...model.realized.steps.map(step => step.at)
        .filter(at => at > segment[0].at && at < segment.at(-1).at)])].sort((a, b) => a - b);
      const costAt = at => {
        const after = segment.findIndex(point => point.at >= at);
        if (after <= 0) return Number(segment[Math.max(0, after)].cents);
        const [a, b] = [segment[after - 1], segment[after]];
        return Number(a.cents) + (Number(b.cents) - Number(a.cents)) * (at - a.at) / (b.at - a.at);
      };
      let run = [];
      let sign = 0;
      const flush = () => {
        if (run.length > 1) {
          const top = run.map(point => `${x(point.at).toFixed(1)},${(y(point.cost / 100)).toFixed(1)}`);
          const bottom = run.slice().reverse().map(point => `${x(point.at).toFixed(1)},${yc(point.real).toFixed(1)}`);
          nodes.push(svgElement('polygon', { points: [...top, ...bottom].join(' '), class: sign < 0 ? 'wash-negative' : 'wash-positive' }));
        }
      };
      for (const at of times) {
        const real = realizedAt(model.realized, at);
        if (real === null) { flush(); run = []; continue; }
        const cost = costAt(at);
        const now = Number(real) < cost ? -1 : 1;
        if (sign && now !== sign) { flush(); run = run.slice(-1); }
        sign = now;
        run.push({ at, cost, real });
      }
      flush();
    }
  }
  const pathOf = segment => segment.map((point, index) => `${index ? 'L' : 'M'}${x(point.at).toFixed(1)},${yc(point.cents).toFixed(1)}`).join('');
  for (const segment of model.costs) nodes.push(svgElement('path', { d: segment.length > 1 ? pathOf(segment) : `M${x(segment[0].at)},${yc(segment[0].cents)}h0.1`, class: 'line-costs' }));
  // Costs since the reset are $0 at the reset by definition; what lies between that anchor and the first archived point
  // is unknown, so nothing joins them.
  nodes.push(svgElement('circle', { cx: x(model.start), cy: y(0), r: 4, class: 'anchor-costs' }));
  if (!model.costs.length && model.costsNow) nodes.push(svgElement('circle', { cx: x(model.costsNow.at), cy: yc(model.costsNow.cents), r: 4, class: 'dot-costs' }));
  for (const segment of model.profit) nodes.push(svgElement('path', { d: segment.length > 1 ? pathOf(segment) : `M${x(segment[0].at)},${yc(segment[0].cents)}h0.1`, class: 'line-profit' }));
  if (model.realized) {
    let d = `M${x(model.realized.start).toFixed(1)},${yc(model.realized.startCents).toFixed(1)}`;
    for (const step of model.realized.steps) d += `H${x(step.at).toFixed(1)}V${yc(step.cents).toFixed(1)}`;
    if (model.realized.complete) d += `H${x(model.end).toFixed(1)}`;
    nodes.push(svgElement('path', { d, class: 'line-realized' }));
  }
  // Each closed position is a dot on the Realized line where it closed; each open one a ▸ on the axis where it opened.
  const rows = Array.isArray(checkpoint?.positions?.rows) ? checkpoint.positions.rows : [];
  const markers = [];
  const markerNodes = new Map();
  for (const row of rows) {
    if (row.status === 'closed' && model.realized) {
      const step = model.realized.steps.find(entry => entry.id === row.id);
      if (!step) continue;
      const group = svgElement('g', { class: `marker source-${row.source}` });
      group.append(svgElement('circle', { cx: x(step.at), cy: yc(step.cents), r: AGENT_SOURCES.includes(row.source) ? 4 : 3, class: 'marker-dot' }));
      nodes.push(group);
      markerNodes.set(row.id, group);
      markers.push({ at: step.at, id: row.id, row, cents: step.cents });
    } else if (row.status === 'open') {
      const at = Date.parse(row.opened_at);
      const group = svgElement('g', { class: `marker marker-open source-${row.source}` });
      group.append(svgElement('path', { d: `M${x(at) - 4},${margin.top + plotH + 1}l8,4.5l-8,4.5z`, class: 'marker-open-mark' }));
      nodes.push(group);
      markerNodes.set(row.id, group);
      markers.push({ at, id: row.id, row, cents: null, open: true });
    }
  }
  // End labels are the legend: Realized and Costs always, Profit while its last point is fresh. Collisions move along a
  // leader line rather than stacking.
  const ends = [];
  if (model.realized) ends.push({ key: 'realized', label: `Realized ${centsText(model.realized.cents)}`, y: yc(model.realized.cents) });
  const lastCost = model.costs.at(-1)?.at(-1) || model.costsNow;
  if (lastCost) ends.push({ key: 'costs', label: `Costs ${money(decimalOf(lastCost.cents))}`, y: yc(lastCost.cents), x: x(lastCost.at) });
  if (model.profitFresh) ends.push({ key: 'profit', label: `Profit ${centsText(model.profitFresh.cents)}`, y: yc(model.profitFresh.cents), x: x(model.profitFresh.at) });
  ends.sort((a, b) => a.y - b.y);
  ends.forEach((entry, index) => { entry.ly = Math.max(entry.y, index ? ends[index - 1].ly + 14 : margin.top + 4); });
  for (let index = ends.length - 2; index >= 0; index--) ends[index].ly = Math.min(ends[index].ly, ends[index + 1].ly - 14);
  const edge = margin.left + plotW;
  for (const entry of ends) {
    const from = entry.x ?? edge;
    if (Math.abs(entry.ly - entry.y) > 1 || from < edge - 1) nodes.push(svgElement('path', { d: `M${from + 3},${entry.y}L${edge + 6},${entry.ly}`, class: 'leader' }));
    nodes.push(svgElement('line', { x1: edge + 8, x2: edge + 16, y1: entry.ly, y2: entry.ly, class: `key key-${entry.key}` }));
    const label = svgElement('text', { x: edge + 20, y: entry.ly + 3.5, class: 'end-label' });
    label.textContent = entry.label;
    nodes.push(label);
  }
  const cross = svgElement('line', { x1: 0, x2: 0, y1: margin.top, y2: margin.top + plotH, class: 'crosshair', opacity: 0 });
  nodes.push(cross);
  svg.replaceChildren(...nodes);
  // The crosshair snaps to every point and marker; ←/→ step through them; a tap pins it.
  const stops = [...new Set([model.start, ...(model.realized?.steps || []).map(step => step.at), ...model.points.map(point => Date.parse(point.at)),
    ...markers.map(marker => marker.at)].filter(at => Number.isFinite(at) && at >= model.start && at <= model.end))].sort((a, b) => a - b);
  const tip = element('div', null, 'chart-tip');
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  let index = -1;
  let pinned = false;
  const show_ = at => {
    const marker = markers.find(entry => Math.abs(entry.at - at) < 60000) || null;
    cross.setAttribute('x1', x(at).toFixed(1));
    cross.setAttribute('x2', x(at).toFixed(1));
    cross.setAttribute('opacity', '1');
    const rowsOut = [];
    const value = (key, label, text) => { const line = element('span', null, 'tip-row'); line.append(element('i', null, `key key-${key}`), element('b', text), element('span', label)); rowsOut.push(line); };
    if (marker) {
      const why = rationaleFor(marker.row, checkpoint, { trades: state.trades, births: state.births });
      const line = positionsLedger(checkpoint)?.[marker.open ? 'open' : 'closed']?.find(entry => entry.id === marker.id);
      rowsOut.push(element('b', line?.pnl || '—', `tip-value ${line?.tone || ''}`.trim()));
      rowsOut.push(element('span', `${line?.who || ''} · ${line?.what || ''}`, 'tip-who'));
      if (why?.thesis) rowsOut.push(element('span', firstSentence(why.thesis), 'tip-thesis'));
      const go = button('→ position', 'link-button');
      go.addEventListener('click', () => openPosition(state, marker.id));
      rowsOut.push(go);
      tip.dataset.position = marker.id;
    } else {
      delete tip.dataset.position;
      const real = realizedAt(model.realized, at);
      if (real !== null) value('realized', 'Realized', centsText(real));
      const point = scoreNear(model.points, at);
      if (point && numeric(point.profit_usd)) value('profit', 'Profit', signedMoney(point.profit_usd));
      if (point && numeric(point.costs_usd)) value('costs', 'Costs', money(point.costs_usd));
      if (point && numeric(point.net_usd)) value('net', 'Net', signedMoney(point.net_usd));
    }
    tip.replaceChildren(element('time', date(new Date(at).toISOString()), 'tip-time'), ...rowsOut);
    tip.hidden = false;
    place(tip, { left: `${Math.min(W - 200, Math.max(0, x(at) + 10))}px` });
  };
  const hide = () => { if (pinned) return; cross.setAttribute('opacity', '0'); tip.hidden = true; };
  const nearestStop = clientX => {
    const box = boxOf(svg);
    if (!box || !stops.length) return -1;
    const at = model.start + (clientX - box.left - margin.left) / plotW * span;
    let best = 0;
    stops.forEach((stop, n) => { if (Math.abs(stop - at) < Math.abs(stops[best] - at)) best = n; });
    return best;
  };
  plot.addEventListener('pointermove', move => { if (pinned || (move.pointerType && move.pointerType !== 'mouse')) return; index = nearestStop(move.clientX); if (index >= 0) show_(stops[index]); });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('pointerdown', down => {
    if (down.target?.closest?.('.chart-tip')) return;
    if (down.pointerType === 'mouse') { const marker = markers.find(entry => entry.at === stops[index]); if (marker) openPosition(state, marker.id); return; }
    if (pinned) { pinned = false; hide(); return; }
    index = nearestStop(down.clientX);
    if (index >= 0) { show_(stops[index]); pinned = true; }
  });
  plot.setAttribute('tabindex', '0');
  plot.addEventListener('keydown', key => {
    if (!stops.length) return;
    if (key.key === 'ArrowRight' || key.key === 'ArrowLeft') {
      key.preventDefault?.();
      index = index < 0 ? stops.length - 1 : Math.max(0, Math.min(stops.length - 1, index + (key.key === 'ArrowRight' ? 1 : -1)));
      show_(stops[index]);
    } else if (key.key === 'Enter' && tip.dataset.position) openPosition(state, tip.dataset.position);
    else if (key.key === 'Escape') { pinned = false; hide(); }
  });
  plot.addEventListener('blur', () => { pinned = false; hide(); });
  plot.replaceChildren(svg, tip);
  return { pulse: id => { const node = markerNodes.get(id); if (!node || still()) return; node.classList?.add?.('is-pulsing'); later(state, () => node.classList?.remove?.('is-pulsing'), 1200); } };
}
function drawChart(state) {
  const box = state.box.account;
  if (!box || !state.checkpoint) return;
  if (!state.chartParts) {
    const head = element('div', null, 'chart-head');
    const score = button('Profit & costs', 'chip');
    const balance = button('Balance', 'chip');
    score.addEventListener('click', () => { state.chartMode = 'score'; drawChart(state); });
    balance.addEventListener('click', () => { state.chartMode = 'balance'; drawChart(state); });
    head.append(score, balance);
    state.chartParts = { head, score, balance };
  }
  const { head, score, balance } = state.chartParts;
  score.setAttribute('aria-pressed', String(state.chartMode !== 'balance'));
  balance.setAttribute('aria-pressed', String(state.chartMode === 'balance'));
  // A fresh plot each time, so the listeners of the last drawing go with it; it takes the old one's size first.
  const previous = state.chartParts.plot;
  const plot = element('div', null, `chart-plot chart-${state.chartMode === 'balance' ? 'balance' : 'score'}`);
  if (previous) { const size = boxOf(previous); if (size) place(plot, { height: `${size.height}px` }); }
  box.replaceChildren(head, plot);
  if (previous) place(plot, { height: '' });
  state.chartParts.plot = plot;
  if (state.chartMode === 'balance') { plot.replaceChildren(...balancePanel(state.checkpoint, state.marks)); state.chart = null; }
  else state.chart = scoreChart(state, plot);
  box.setAttribute('aria-busy', 'false');
}
function openPosition(state, id) {
  state.openPosition = id;
  state.ledgerTable = false;
  if (state.positionsFilter) state.positionsFilter = null;
  const row = state.checkpoint?.positions?.rows?.find(entry => entry.id === id);
  if (row && !AGENT_SOURCES.includes(row.source)) state.openGroup = row.source;
  drawPositions(state);
  state.box.positions?.scrollIntoView?.({ block: 'nearest', behavior: still() ? 'auto' : 'smooth' });
}

// ---- the tape: thoughts, trades and the swarm's life, newest first
const FILTERS = [['thoughts', 'Thoughts', 'thought'], ['trades', 'Trades', 'trade'], ['life', 'Life', 'born']];
function drawFilters(state) {
  const box = state.box.filters;
  if (!box) return;
  const nodes = FILTERS.map(([key, label, mark]) => {
    const toggle = button(null, 'filter');
    toggle.append(glyph(mark), element('span', label));
    toggle.setAttribute('aria-pressed', String(state.tapeFilter[key]));
    toggle.addEventListener('click', () => { state.tapeFilter[key] = !state.tapeFilter[key]; drawFilters(state); drawTape(state); });
    return toggle;
  });
  if (state.follow) {
    const chip = button(`following ${state.names.get(state.follow) || titleCase(state.follow)} ×`, 'chip follow-chip', 'Stop following');
    chip.setAttribute('aria-pressed', 'true');
    chip.addEventListener('click', () => { state.follow = null; state.followEvents = []; drawFilters(state); drawTape(state); });
    nodes.push(chip);
  }
  box.replaceChildren(...nodes);
}
function followAgent(state, id) {
  if (!agentId(id)) return;
  state.follow = id;
  state.followEvents = state.feed.filter(event => streamAgentOf(event.stream) === id || (event.kind === 'swarm.news' && event.payload?.agent === id));
  drawFilters(state);
  drawTape(state);
  loadEvents({ agent: id, limit: 50 }).then(data => {
    if (state.follow !== id) return;
    const byId = new Map([...state.followEvents, ...data.events].map(event => [event.id, event]));
    state.followEvents = [...byId.values()];
    drawTape(state);
  }).catch(() => {});
}
function drawTape(state) {
  const list = state.box.feed;
  if (!list) return;
  const source = state.follow ? state.followEvents : state.feed;
  const lines = feedLines(source, state.names, { limit: TAPE_LIMIT, skip: state.follow ? [] : [state.think.current?.id] })
    .filter(line => state.tapeFilter[line.group]);
  const shown = phone() && !state.tapeMore ? lines.slice(0, PHONE_TAPE_LINES) : lines;
  const items = shown.map(line => {
    const open = state.expanded.has(line.id);
    const item = element('li', null, `tape-line tape-${line.tape}${line.real === false ? ' is-shadow' : ''}${state.primed && !state.rendered.has(line.id) ? ' line-new' : ''}`);
    item.dataset.kind = line.tape;
    item.dataset.id = line.id;
    const row = button(null, `tape-row${open ? ' is-open' : ''}`);
    row.setAttribute('aria-expanded', String(open));
    const text = element('span', null, 'tape-text');
    text.append(element('span', open ? (line.tape === 'trade' && line.why ? `${line.text} · ${line.why}` : line.text) : line.brief, 'tape-words'));
    if (line.pnl) text.append(element('b', line.pnl, `tape-pnl ${line.tone}`.trim()));
    if (line.count > 1) text.append(element('span', `×${line.count}`, 'tape-count'));
    const when = element('time', shortAgo(line.at), 'tape-time');
    when.dateTime = line.at;
    when.setAttribute('title', date(line.at));
    row.append(glyph(line.tape), element('span', line.name, 'tape-name'), text, when);
    row.addEventListener('click', () => { if (state.expanded.has(line.id)) state.expanded.delete(line.id); else state.expanded.add(line.id); drawTape(state); });
    item.append(row);
    if (open && line.agentId) {
      const go = button('→ agent', 'link-button tape-agent');
      go.addEventListener('click', () => openAgent(state, line.agentId, go, { follow: false }));
      item.append(go);
    }
    return item;
  });
  if (shown.length < lines.length) {
    const more = element('li', null, 'tape-more');
    const control = button('more', 'link-button');
    control.addEventListener('click', () => { state.tapeMore = true; drawTape(state); });
    more.append(control);
    items.push(more);
  }
  list.replaceChildren(...items);
  list.setAttribute('aria-busy', 'false');
  state.rendered = new Set(lines.map(line => line.id));
  state.primed = true;
}

// ---- motion that follows real events, and the page's own clock
// A live publication produces one short ripple. Historical batches, hidden tabs, stale events and reduced-motion readers
// never get simulated activity.
export function freshAgentActivity(event, now = Date.now()) {
  const age = now - Date.parse(event?.at);
  if (!Number.isFinite(age) || age < -60000 || age > 120000) return null;
  if (event.kind === 'agent.note' || event.kind === 'agent.trade') return streamAgentOf(event.stream);
  return event.kind === 'swarm.news' ? event.payload?.agent : null;
}
// A redraw keeps the reader's place: whatever had focus (a position, a group, a tape line, a step, the chart) has it again.
function focusKey(root) {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (!active || !root?.contains?.(active)) return null;
  const holder = active.closest?.('[data-position], [data-group], [data-id], [data-step]');
  const data = holder?.dataset || {};
  return { className: String(active.className).split(' ')[0], position: data.position, group: data.group, id: data.id, step: data.step,
    chart: active.classList?.contains?.('chart-plot') };
}
function restoreFocus(root, key) {
  if (!key || !root?.querySelector) return;
  const holder = key.chart ? null : key.position ? `[data-position="${key.position}"]` : key.group ? `[data-group="${key.group}"]` : key.id ? `[data-id="${key.id}"]`
    : key.step ? `[data-step="${key.step}"]` : null;
  try {
    const node = key.chart ? root.querySelector('.chart-plot') : holder && root.querySelector(`${holder}.${key.className}, ${holder} .${key.className}`);
    node?.focus?.({ preventScroll: true });
  } catch { /* an id this page cannot select */ }
}
function later(state, work, ms) {
  const timer = setTimeout(() => { state.timers.delete(timer); work(); }, ms);
  timer?.unref?.();
  state.timers.add(timer);
  return timer;
}
function liveMotion(state, events) {
  if (document.visibilityState !== 'visible' || !floorRunning(state.checkpoint)) return;
  const now = Date.now();
  let redraw = false;
  for (const event of events) {
    const id = freshAgentActivity(event, now);
    if (!id) continue;
    if (event.kind === 'agent.trade') state.climb?.ripple?.(id, true);
    if (event.kind === 'swarm.news') {
      const life = newsKind(event.payload?.text, id);
      if (life.kind === 'born' && !state.agents.has(id)) { state.born.set(id, { id, name: event.display_name || titleCase(id) }); redraw = true; }
      if (life.kind === 'retired' && state.model?.dots?.has(id)) { state.gone.add(id); redraw = true; }
    }
  }
  if (redraw) drawClimb(state, { animate: true });
}
function drawTicker(state) {
  const ticker = state.box.ticker;
  if (!ticker) return;
  const note = state.think.current;
  const show_ = Boolean(note) && phone() && !still() && state.cardVisible === false && state.tapeVisible === false;
  ticker.hidden = !show_;
  if (!show_ || ticker.dataset.note === note.id) return;
  ticker.dataset.note = note.id;
  const dot = state.model?.dots?.get(note.agent);
  const text = element('span', '', 'ticker-text');
  ticker.replaceChildren(dotMark(dot || { money: 'research', step: 'train' }), element('span', note.name, 'ticker-name'), text);
  typeInto(text, note.text);
}
function observe(state, node, key) {
  if (!node || typeof IntersectionObserver === 'undefined') return;
  const watcher = new IntersectionObserver(entries => {
    for (const entry of entries) state[key] = entry.isIntersecting;
    drawTicker(state);
  });
  watcher.observe(node);
  state.watchers.push(watcher);
}

async function startPage(root) {
  const find = id => root.querySelector(`#${id}`);
  const box = {
    numbers: find('floor-numbers'), costs: find('floor-costs'), status: find('floor-status'), now: find('floor-now'), feed: find('floor-feed'),
    filters: find('floor-filters'), account: find('floor-account'), positions: find('floor-positions'), agents: find('floor-agents'),
    sheet: find('floor-sheet'), peek: find('floor-peek'), ticker: find('floor-ticker'), theatre: find('floor-theatre'), theme: find('floor-theme'),
    live: find('live'), tape: find('tape'),
  };
  const state = {
    root, box, checkpoint: null, agents: new Map(), names: new Map(), feed: [], trades: [], marks: [], score: null, mode: 'loading',
    think: { current: null, queue: [], readUntil: 0, expanded: false, hovering: false, parts: null, timer: null },
    rendered: new Set(), primed: false, expanded: new Set(), clock: null, model: null, climb: null, speaker: null, spoke: new Map(),
    born: new Map(), gone: new Set(), births: new Map(), timers: new Set(), watchers: [], seenPositions: new Set(),
    tapeFilter: { thoughts: true, trades: true, life: true }, follow: null, followEvents: [], tapeMore: false,
    positionsFilter: null, ledgerTable: false, openPosition: null, openGroup: null, chartMode: 'score', chartParts: null, chart: null, sheet: null,
  };
  const ready = node => node && node.setAttribute('aria-busy', 'false');
  const drawStatus = () => {
    if (!box.status) return;
    const live = state.mode === 'live' || state.mode === 'polling';
    const stopped = !floorRunning(state.checkpoint);
    const text = stopped ? 'stopped' : live ? 'live' : 'connecting';
    box.status.className = `live-status ${stopped ? 'live-stopped' : live ? 'live-live' : 'live-idle'}`;
    box.status.setAttribute('title', text);
    if (state.statusText === text) return;
    state.statusText = text;
    box.status.replaceChildren(pulse(), element('span', text, 'visually-hidden'));
  };
  const drawMoney = () => {
    if (!state.checkpoint) return;
    if (box.numbers) { box.numbers.replaceChildren(...numbersPanel(state.checkpoint, state)); ready(box.numbers); }
    if (box.costs) { box.costs.textContent = costsLine(state.checkpoint); box.costs.setAttribute('title', box.costs.textContent); }
  };
  const drawAll = ({ animate = false } = {}) => {
    const focus = focusKey(root);
    drawMoney();
    drawClimb(state, { animate });
    ready(box.agents);
    drawPositions(state);
    drawChart(state);
    thinkDraw(state);
    ready(box.now);
    drawTape(state);
    restoreFocus(root, focus);
  };
  const keepFeed = events => {
    const byId = new Map([...state.feed, ...events].map(event => [event.id, event]));
    state.feed = [...byId.values()].sort((left, right) => (Number(right.seq) || 0) - (Number(left.seq) || 0)).slice(0, 600);
    const trades = new Map([...state.trades, ...events.filter(event => event.kind === 'agent.trade')].map(event => [event.id, event]));
    state.trades = [...trades.values()];
    for (const event of events) {
      if (event.kind === 'agent.note') {
        const id = streamAgentOf(event.stream);
        state.spoke.set(id, Math.max(state.spoke.get(id) || 0, Date.parse(event.at) || 0));
      }
      if (event.kind === 'swarm.news' && agentId(event.payload?.agent)) {
        const life = newsKind(event.payload.text, event.payload.agent);
        if (life.kind === 'born' && !state.births.has(event.payload.agent)) state.births.set(event.payload.agent, life.brief);
        if (event.display_name) state.names.set(event.payload.agent, state.names.get(event.payload.agent) || event.display_name);
      }
      const id = streamAgentOf(event.stream);
      if (id && event.display_name && !state.names.has(id)) state.names.set(id, event.display_name);
    }
  };
  async function refresh({ animate = true } = {}) {
    try {
      const previousTrials = state.model?.trials ?? null;
      state.checkpoint = await loadCheckpoint();
      const [marks, score] = await Promise.all([loadHistory().catch(() => null), loadScore().catch(() => null)]);
      if (marks) state.marks = marks;
      if (score) state.score = score;
      state.agents = new Map(state.checkpoint.agents.map(agent => [agent.id, agent]));
      for (const agent of state.checkpoint.agents) state.names.set(agent.id, agentName(agent));
      for (const row of state.checkpoint.positions?.rows || []) if (row.display_name) state.names.set(row.agent, row.display_name);
      // The checkpoint confirms or corrects every provisional birth and retirement.
      state.born.clear();
      state.gone.clear();
      drawAll({ animate });
      refreshSheet(state);
      rollTrials(state, previousTrials, state.model?.trials ?? null);
    } catch {
      if (!state.checkpoint) {
        ready(box.numbers);
        for (const node of [box.account, box.agents, box.now]) { if (node) { node.replaceChildren(element('p', '—', 'empty-state')); ready(node); } }
        drawPositions(state);
      } else {
        // A failed refresh still expires the evidence it showed: the status and the agents' checklists read the clock.
        drawMoney();
        drawClimb(state);
        refreshSheet(state);
      }
    } finally {
      state.asked = true;
      drawStatus();
    }
  }
  // The page's own controls: theatre and theme, both remembered per viewer.
  const setTheatre = on => {
    root.classList?.toggle?.('is-theatre', on);
    box.theatre?.setAttribute('aria-pressed', String(on));
    remember('ltcm-theatre', on ? '1' : null);
    later(state, () => { drawClimb(state); drawChart(state); }, 60);
  };
  box.theatre?.addEventListener('click', () => setTheatre(!root.classList?.contains?.('is-theatre')));
  if (remembered('ltcm-theatre') === '1' && !phone()) setTheatre(true);
  const html = typeof document !== 'undefined' ? document.documentElement : null;
  const theme = remembered('ltcm-theme');
  if (html?.dataset && (theme === 'light' || theme === 'dark')) html.dataset.theme = theme;
  box.theme?.addEventListener('click', () => {
    const dark = html?.dataset?.theme ? html.dataset.theme === 'dark' : !matches('(prefers-color-scheme: light)');
    if (html?.dataset) html.dataset.theme = dark ? 'light' : 'dark';
    remember('ltcm-theme', dark ? 'light' : 'dark');
    drawChart(state);
  });
  document.addEventListener('keydown', key => {
    if (key.key !== 'Escape') return;
    if (state.sheet) closeSheet(state);
    else if (root.classList?.contains?.('is-theatre')) setTheatre(false);
  });
  document.addEventListener('pointerdown', down => {
    if (!state.sheet || !box.sheet || box.sheet.contains?.(down.target) || state.sheet.opener?.contains?.(down.target)) return;
    if (typeof box.sheet.contains === 'function') closeSheet(state);
  });
  box.ticker?.addEventListener('click', () => box.live?.scrollIntoView?.({ block: 'start', behavior: still() ? 'auto' : 'smooth' }));
  observe(state, box.live, 'cardVisible');
  observe(state, box.tape, 'tapeVisible');
  drawFilters(state);
  await refresh({ animate: false });
  const loads = [{ kind: 'agent.note', limit: 100 }, { kind: 'agent.trade', limit: MAX_EVENT_LIMIT }, { kind: 'swarm.news', limit: 100 }, { kind: MARK, limit: MAX_EVENT_LIMIT }];
  const [notes, trades, news, marks] = await Promise.all(loads.map(query => loadEvents(query).catch(() => ({ events: [] }))));
  keepFeed([...notes.events, ...trades.events, ...news.events]);
  if (!state.marks.length) state.marks = marks.events.map(event => ({ at: event.at, equity: event.payload.equity }));
  thinkReceive(state, notes.events, { initial: true });
  drawAll();
  // Redraw the map and the chart when their boxes change size.
  const resized = () => { if (state.resizing) return; state.resizing = later(state, () => { state.resizing = null; drawClimb(state); drawChart(state); drawTape(state); }, 120); };
  if (typeof ResizeObserver !== 'undefined') {
    const watcher = new ResizeObserver(resized);
    for (const node of [box.agents, box.account]) if (node) watcher.observe(node);
    state.watchers.push(watcher);
  } else if (typeof window.addEventListener === 'function') window.addEventListener('resize', resized);
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  // Running ticks every second; ages, the quiet card and the fading glow every fifteen.
  setInterval(() => {
    if (!state.clock) return;
    const parts = runningParts(Math.max(0, (Date.now() - state.clock.startedAt) / 1000));
    state.clock.main.textContent = parts.main;
    state.clock.tick.textContent = parts.tick;
  }, 1000);
  setInterval(() => {
    thinkDraw(state);
    glowDots(state);
    drawStatus();
    for (const node of box.feed?.querySelectorAll?.('time.tape-time') || []) node.textContent = shortAgo(node.dateTime);
  }, 15000);
  const loaded = [notes, trades, news, marks].flatMap(batch => batch.events);
  const feed = startFeed({
    streams: ['all'],
    onStatus: mode => { state.mode = mode; drawStatus(); },
    onEvents: events => {
      const live = events.filter(event => FEED_KINDS.includes(event.kind));
      const balance = events.filter(event => event.kind === MARK);
      if (live.length) {
        keepFeed(live);
        if (state.follow) {
          const own = live.filter(event => streamAgentOf(event.stream) === state.follow || (event.kind === 'swarm.news' && event.payload?.agent === state.follow));
          if (own.length) state.followEvents = [...own, ...state.followEvents];
        }
        thinkReceive(state, live);
        const focus = focusKey(box.feed);
        drawTape(state);
        restoreFocus(box.feed, focus);
        glowDots(state);
        liveMotion(state, live);
        drawTicker(state);
      }
      if (balance.length) {
        state.marks = [...state.marks, ...balance.map(event => ({ at: event.at, equity: event.payload.equity }))];
        if (state.chartMode === 'balance') drawChart(state);
      }
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
  return {
    ...feed,
    state,
    stop() {
      clearTimeout(state.followUp);
      clearTimeout(state.think.timer);
      for (const timer of state.timers) clearTimeout(timer);
      for (const watcher of state.watchers) watcher.disconnect?.();
      feed.stop();
    },
  };
}

export function startCapital(root = document.querySelector('[data-capital]')) {
  if (!root) return Promise.resolve(null);
  return startPage(root);
}
if (typeof document !== 'undefined' && document.querySelector('[data-capital]')) startCapital();
