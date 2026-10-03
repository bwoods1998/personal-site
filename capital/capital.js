import {
  MAX_EVENT_LIMIT, SCHEMA_VERSION, REAL_BANDS, OTHER_PARTS, AGENT_SOURCES, agentId, validCheckpoint, validPublicEvent,
  validDisplayName, validProgress, socketMatches, tapeName, numbered, plainGlyphs, MAX_PUBLIC_CHECKPOINT_BYTES,
} from './schema.js';

// AI agents trading options on the Brokerage Account, drawn from the House's own record with text nodes only. The page
// never contacts a quote vendor or the brokerage, never shows a quote, and never starts work on anything.
//
// The page is five things, top to bottom (the owner, Oct 1, 2026): Profit and Running; the account's balance over its
// whole record; the agents thinking, live; every real position, adding up to Profit; and the swarm climbing the game's
// levels. Nothing else.
const API = '/api/capital';
// A test tape: /capital/?tape=test reads the separate record a publisher filled under /api/capital/t/test, every fetch and
// the socket alike. Only the listed tapes (schema.js TAPES) count; without the parameter, or with any other name, nothing
// changes.
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
// The checkpoint read this page validates (the Worker's `WINDOW_READ`): progress, the positions ledger, the House's
// `levels` and `rationale`. The practice league rides the same read; this page draws none of its figures (the board reads
// only which agents practise: `practisingAgents`).
export const CHECKPOINT_READ = '?progress=1&positions=1&practice=1&window=1';

// ---- the reset (Sept 26, 2026, the options swarm)
// The profit basis is the checkpoint's own `performance` block: the Brokerage Account's equity when the record started
// over, and the owner's deposits and withdrawals since. These two constants are the fallback while no checkpoint carries
// one, and the floor under it: a basis dated before the reset is never read.
export const PERFORMANCE_START_AT = '2026-09-26T06:25:30.000Z';
export const START_EQUITY = '481.65';
// The owner's deposits since the reset, marked on the balance chart where they landed (the first recorded balance after
// each). Add a row here with each new deposit; Profit nets them through `performance.net_flows` either way.
export const DEPOSITS = [{ at: '2026-09-27T13:36:06.176Z', usd: '1000.00' }];
// A profit is shown only on an account reading and a funding check this fresh, against the checkpoint.
export const VERIFY_WINDOW_MS = 10 * 60 * 1000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 100000000n;
const responseCache = new Map();
// The status follows the data, never a switch in this file: the House publishes a checkpoint every minute, so it is
// running while the newest one the page holds is younger than this.
export const FLOOR_STALE_MS = 15 * 60 * 1000;
export function floorRunning(checkpoint, now = Date.now()) {
  const at = typeof checkpoint?.published_at === 'string' ? Date.parse(checkpoint.published_at) : NaN;
  return Number.isFinite(at) && Number.isFinite(now) && Math.abs(now - at) <= FLOOR_STALE_MS;
}

// ---- words
export const STRUCTURE_WORDS = {
  long_call: 'long call', long_put: 'long put', debit_vertical: 'debit vertical', credit_vertical: 'credit vertical',
  iron_condor: 'iron condor', iron_butterfly: 'iron butterfly', long_butterfly: 'long butterfly', long_straddle: 'long straddle',
  long_strangle: 'long strangle', calendar: 'calendar', diagonal: 'diagonal',
};
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
const sumOf = values => decimalOf(values.reduce((total, value) => total + centsOf(value), 0n));
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
const FORMATS = new Map();
function date(value, style = 'datetime') {
  if (!FORMATS.has(style)) {
    const options = style === 'day' ? { month: 'short', day: 'numeric' }
      : style === 'short' ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    FORMATS.set(style, new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }));
  }
  return FORMATS.get(style).format(new Date(value));
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
// "5d 19h 32m" of running, with the seconds that make it tick.
export function runningParts(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return { main: '—', tick: '' };
  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const tick = `${String(whole % 60).padStart(2, '0')}s`;
  if (days) return { main: `${days}d ${hours}h ${String(minutes).padStart(2, '0')}m`, tick };
  if (hours) return { main: `${hours}h ${String(minutes).padStart(2, '0')}m`, tick };
  return { main: `${minutes}m`, tick };
}

// ---- the money
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
// Total profit since the reset: the account's equity, less its equity at the reset, less the owner's deposits net of
// withdrawals. Null unless the account was read fresh, is not stale, and the funding was verified against the account's
// own history within the window. Every position is in it at the broker's own value, at any hour.
export function totalProfit(checkpoint) {
  const account = checkpoint?.account;
  const basis = profitBasis(checkpoint);
  if (!account || account.stale || !within(account.as_of, checkpoint.published_at)) return null;
  if (!basis.published || basis.net_flows === null || !within(basis.verified_at, checkpoint.published_at)) return null;
  return decimalOf(centsOf(account.equity) - centsOf(basis.start_equity) - centsOf(basis.net_flows));
}
// The House's own ledger total: complete only while it can value every open position (market hours).
export function tradingProfit(checkpoint, now = Date.now()) {
  const trading = checkpoint?.trading;
  if (!numeric(trading?.pnl_usd) || !within(trading.as_of, checkpoint.published_at)
      || !within(trading.as_of, new Date(now).toISOString())) return null;
  return trading.pnl_usd;
}
// The headline: what the account has made since the reset (the balance chart's own number), or the House's ledger total
// while the account cannot be read. A dash when neither is known.
export function profitNow(checkpoint, now = Date.now()) {
  return totalProfit(checkpoint) ?? tradingProfit(checkpoint, now);
}
export const PROFIT_TITLE = 'The account’s value now, less its value at the start and every deposit since.';
// When the timer started: the House's first start on its new ledger, else the reset itself.
export function startedAt(checkpoint) {
  if (!checkpoint) return null;
  const run = Date.parse(checkpoint.run?.started_at);
  if (Number.isFinite(run)) return run;
  const basis = Date.parse(profitBasis(checkpoint).start_at);
  return Number.isFinite(basis) ? basis : null;
}
export function headline(checkpoint, now = Date.now()) {
  const profit = profitNow(checkpoint, now);
  const started = startedAt(checkpoint);
  return {
    profit: { value: profit === null ? '—' : signedMoney(profit), tone: profit === null ? '' : signOf(profit), usd: profit },
    running: started === null ? { main: '—', tick: '', startedAt: null } : { ...runningParts(Math.max(0, (now - started) / 1000)), startedAt: started },
  };
}

// ---- the balance chart
// Clean round ticks around the data: at most `most` intervals of 1, 2, 2.5 or 5 times a power of ten.
export function niceTicks(low, high, most = 4) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (high - low < 1) { low -= 1; high += 1; }
  const base = 10 ** Math.floor(Math.log10((high - low) / most));
  for (const step of [1, 2, 2.5, 5, 10, 20, 25, 50].map(factor => factor * base)) {
    const from = Math.floor(low / step) * step;
    const to = Math.ceil(high / step) * step;
    if ((to - from) / step <= most) return { from, to, step, ticks: Array.from({ length: Math.round((to - from) / step) + 1 }, (_, n) => from + n * step) };
  }
  return null;
}
// Midnight in New York for each day the chart spans, thinned so at most `most` carry a label.
export function dayTicks(start, end, most = 7) {
  const days = [];
  const label = at => date(new Date(at).toISOString(), 'day');
  let last = label(start);
  // Hour steps from the first full hour find each New York midnight exactly, whatever the offset or a clock change.
  for (let at = Math.ceil(start / 3600000) * 3600000; at <= end; at += 3600000) {
    const name = label(at);
    if (name !== last) { days.push({ at, label: name }); last = name; }
  }
  const every = Math.max(1, Math.ceil(days.length / most));
  return days.filter((_, index) => index % every === 0);
}
// Recorded balances only: never interpolated, never reset on a loss. The whole record, from the reset to the newest reading.
export function balanceSeries(points, { width = 1000, height = 200 } = {}) {
  const marks = (Array.isArray(points) ? points : []).filter(point => numeric(point?.equity))
    .map(point => ({ at: Date.parse(point.at), equity: Number(point.equity) }))
    .filter(point => Number.isFinite(point.at) && Number.isFinite(point.equity))
    .sort((left, right) => left.at - right.at);
  const unique = [...new Map(marks.map(point => [point.at, point])).values()];
  if (unique.length < 2) return null;
  const values = unique.map(point => point.equity);
  const scale = niceTicks(Math.min(...values), Math.max(...values));
  if (!scale) return null;
  const start = unique[0].at;
  const span = unique.at(-1).at - start || 1;
  const x = at => (at - start) / span * width;
  const y = value => (scale.to - value) / (scale.to - scale.from) * height;
  const plotted = unique.map(point => ({ ...point, x: x(point.at), y: y(point.equity) }));
  const path = plotted.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  return {
    width, height, points: plotted, first: plotted[0], last: plotted.at(-1), path, area: `${path} L${width},${height} L0,${height} Z`,
    x, y, start, end: unique.at(-1).at, step: scale.step, ticks: scale.ticks.map(value => ({ value, y: y(value) })),
  };
}
// The reset's balance, every recorded mark since and the checkpoint's own reading, in time order.
export function accountSeries(marks, checkpoint, options) {
  const basis = profitBasis(checkpoint);
  const start = Date.parse(basis.start_at);
  // A live mark newer than the checkpoint is drawn too; one from the future is not.
  const end = Date.now() + 60000;
  const points = (Array.isArray(marks) ? marks : []).filter(point => Date.parse(point?.at) >= start && Date.parse(point?.at) <= end);
  points.push({ at: basis.start_at, equity: basis.start_equity });
  if (checkpoint?.account && !checkpoint.account.stale) points.push({ at: checkpoint.account.as_of, equity: checkpoint.account.equity });
  return balanceSeries(points, options);
}
// The deposits inside the chart, each where it landed.
export function depositMarks(series) {
  if (!series) return [];
  return DEPOSITS.map(deposit => ({ ...deposit, time: Date.parse(deposit.at) }))
    .filter(deposit => deposit.time >= series.start && deposit.time <= series.end)
    .map(deposit => {
      const after = series.points.find(point => point.at >= deposit.time) || series.last;
      return { label: `${signedMoney(deposit.usd, 0)} deposit`, x: after.x, y: after.y };
    });
}

// ---- the swarm
const BAND_ORDER = ['sized', 'probe', 'candidate', 'gym', 'retired'];
const rankOf = band => { const index = BAND_ORDER.indexOf(band); return index === -1 ? BAND_ORDER.length : index; };
// The site's durable person alias is display-only. Old checkpoints still have a readable fallback.
export const agentName = agent => validDisplayName(agent?.display_name) ? agent.display_name : titleCase(agent?.id) || show(agent?.id);
// "real 4 trades · 3 won · +$12.40": the record that sizes money, when there is one; else the forward record; else the
// Gym's count of what its lineage has tried.
export function recordWords(agent) {
  const record = agent?.record || {};
  const tally = (label, row) => `${label} ${plural(row.trades, 'trade')} · ${row.wins} won · ${signedMoney(row.pnl_usd)}`;
  const tried = `${plural(record.trials ?? 0, 'backtest')} · ${plural(record.revisions ?? 0, 'revision')}`;
  if (record.real && record.real.trades > 0) return { main: tally('real', record.real), tone: signOf(record.real.pnl_usd), rest: tried };
  if (record.forward && record.forward.trades > 0) return { main: tally('forward', record.forward), tone: signOf(record.forward.pnl_usd), rest: tried };
  return { main: tried, tone: '', rest: '' };
}
// `level`: where the agent stands in the game (the House's `levels`, or for an older House what the band and the open
// money can say for certain: `levelOf`). `rung`: the rung of the board its dot stands on (`rungOf`), null when retired.
export function swarmRows(checkpoint) {
  const agents = (Array.isArray(checkpoint?.agents) ? checkpoint.agents : []).filter(agent => agent && typeof agent === 'object');
  const pnl = agent => Number(agent.record?.real?.pnl_usd ?? agent.record?.forward?.pnl_usd ?? 0);
  const held = openMoney(checkpoint);
  const published = publishedLevels(checkpoint);
  const rows = moneyLevels(checkpoint);
  const practised = practisingAgents(checkpoint);
  return agents.map((agent, index) => ({ agent, index }))
    .sort((left, right) => rankOf(left.agent.band) - rankOf(right.agent.band) || pnl(right.agent) - pnl(left.agent)
      || (right.agent.record?.trials ?? 0) - (left.agent.record?.trials ?? 0) || left.index - right.index)
    .map(({ agent }) => {
      const level = show(levelOf(agent, checkpoint, held, published, rows));
      const practising = level === 'validation' && practised.has(agent.id);
      return {
        id: show(agent.id), name: agentName(agent), family: show(agent.family), band: show(agent.band), level, levelText: LEVEL_WORDS[level] || '',
        real: REAL_BANDS.includes(agent.band), structure: STRUCTURE_WORDS[agent.structure] || '', record: recordWords(agent),
        progress: agentProgress(agent, checkpoint), practising, rung: rungOf(level, practising),
      };
    });
}

// Only the House's current prerequisite counts fill a ring. Trials, tenure and cumulative P&L are interesting records but
// cannot say how close a particular program is to promotion.
export const PROGRESS_TARGETS = { candidate: 'Candidate', probe: 'Probe', sized: 'Sized', maintain: 'Maintain capital' };
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

// ---- the positions
// Every real position on the Brokerage Account since the reset (the owner: "line of sight into what the agents are
// trading"): open first, then closed, newest first, with the agent's own reason. The lines add up to the Profit headline
// exactly, to the cent: closed positions at their realized result, the account's other activity (fees no position
// carries, interest), and the open positions at what the account says they are worth now (the headline less the rest:
// one open position is that amount; several show the House's own value each, and the group carries the exact sum).
// The House's calibration round trips (one contract in and out, to measure real fills) fold into one line.
export const SOURCE_WORDS = { calibration: 'House fill tests', house: 'House live test' };
export const MARKS_TITLE = 'What the account says the open positions are worth together, less the House’s own value of each (a dash: not valued yet).';
export const CALIBRATION_TITLE = 'One-contract round trips the House makes to measure real fill costs.';
export const INCUBATOR_TITLE = 'Incubator: real money at tuition size, never evidence.';
const RIGHT_FIRST = ['debit_vertical', 'credit_vertical', 'calendar', 'diagonal'];
// "SPY call debit vertical", "QQQ long put", "XSP iron condor", "SPY long put butterfly".
export function positionWhat(row) {
  const root = show(row?.underlying);
  const right = row?.right === 'call' || row?.right === 'put' ? row.right : '';
  if (row?.structure === 'long_butterfly' && right) return `${root} long ${right} butterfly`;
  if (RIGHT_FIRST.includes(row?.structure) && right) return `${root} ${right} ${STRUCTURE_WORDS[row.structure]}`;
  return structureText(root, row?.structure);
}
const pidOf = row => Number(show(row?.id).slice(5)) || 0;
const stampOf = value => Date.parse(value) || 0;
const amountLine = value => ({ usd: numeric(value) ? value : null, pnl: numeric(value) ? signedMoney(value) : '—', tone: signOf(value) });
export function positionsLedger(checkpoint, now = Date.now()) {
  const block = checkpoint?.positions;
  if (!block || typeof block !== 'object' || !Array.isArray(block.rows)) return null;
  const profit = profitNow(checkpoint, now);
  const names = new Map((Array.isArray(checkpoint.agents) ? checkpoint.agents : []).map(agent => [agent?.id, agentName(agent)]));
  const reasons = tradeReasons(checkpoint);
  const theses = new Map();
  const thesisOf = id => { if (!theses.has(id)) theses.set(id, agentThesis(checkpoint, id)); return theses.get(id); };
  const rows = block.rows.filter(row => row && typeof row === 'object');
  const line = row => {
    const agentRow = AGENT_SOURCES.includes(row.source);
    const reason = agentRow ? reasons.get(row.id) || null : null;
    const routeKey = agentRow ? (ROUTE_TAGS[reason?.route] ? reason.route : row.source === 'incubator' ? 'incubator' : null) : null;
    return {
      id: show(row.id), source: show(row.source), agent: agentRow ? show(row.agent) : null,
      who: agentRow ? (validDisplayName(row.display_name) ? row.display_name : names.get(row.agent) || titleCase(row.agent)) : SOURCE_WORDS[row.source] || '',
      what: positionWhat(row), open: row.status === 'open', route: routeKey, routeText: routeKey ? LEVEL_WORDS[routeKey] : '',
      why: reason?.openWhy || null, closeWhy: reason?.exit === 'agent' ? reason.closeWhy : null, exit: reason?.exit ?? null,
      thesis: agentRow ? thesisOf(row.agent) : null, maxLoss: reason?.maxLoss ?? null,
      quantity: row.status === 'open' && row.open_quantity < row.quantity ? row.open_quantity : row.quantity,
      expiry: expiryText(row.expiry), openedAt: show(row.opened_at), closedAt: row.status === 'closed' ? show(row.closed_at) : null,
      ...amountLine(row.pnl_usd),
    };
  };
  const open = rows.filter(row => row.status === 'open')
    .sort((left, right) => stampOf(right.opened_at) - stampOf(left.opened_at) || pidOf(right) - pidOf(left)).map(line);
  const closedRows = rows.filter(row => row.status === 'closed')
    .sort((left, right) => stampOf(right.closed_at) - stampOf(left.closed_at) || stampOf(right.opened_at) - stampOf(left.opened_at) || pidOf(right) - pidOf(left))
    .map(line);
  const known = list => list.every(entry => entry.usd !== null);
  const total = list => (known(list) ? sumOf(list.map(entry => entry.usd)) : null);
  // The House's calibration folds into one line among the closed (its open round trip, if any, stays a row of its own).
  const tests = closedRows.filter(entry => entry.source === 'calibration');
  const calibration = tests.length ? {
    count: tests.length, rows: tests, ...amountLine(total(tests)),
    from: tests.at(-1).openedAt, to: tests[0].closedAt,
  } : null;
  const closed = closedRows.filter(entry => entry.source !== 'calibration');
  const other = block.other && typeof block.other === 'object' && OTHER_PARTS.every(part => numeric(block.other[part]))
    ? sumOf(OTHER_PARTS.map(part => block.other[part])) : null;
  const earlier = block.earlier && typeof block.earlier === 'object'
    ? { count: Number(block.earlier.positions) || 0, ...amountLine(block.earlier.pnl_usd) } : null;
  // The Closed group: every closed row, and the positions the House no longer lists.
  const closedTotal = total(earlier ? [...closedRows, earlier] : closedRows);
  // What is not an open position: realized results and the account's other activity.
  const settled = closedTotal === null || other === null ? null : centsOf(closedTotal) + centsOf(other);
  let openTotal = total(open);
  let otherShown = other;
  let marks = null;
  if (profit !== null && settled !== null) {
    const rest = decimalOf(centsOf(profit) - settled);
    if (open.length === 1) Object.assign(open[0], amountLine(rest));
    else if (open.length) {
      const valued = open.reduce((sum, line) => sum + (line.usd === null ? 0n : centsOf(line.usd)), 0n);
      if (valued !== centsOf(rest)) marks = amountLine(decimalOf(centsOf(rest) - valued));
    }
    if (open.length) openTotal = rest;
    else otherShown = decimalOf(centsOf(other) + centsOf(rest));
  }
  return {
    // `marks`: with several positions open, each row is the House's own value of it (or a dash), and this line is the
    // rest of what the account says they are worth together.
    asOf: show(block.as_of), open, closed, calibration, earlier, marks,
    openTotal: amountLine(openTotal), closedTotal: amountLine(closedTotal),
    other: amountLine(otherShown), total: amountLine(profit),
  };
}

// ---- the tape: the agents' thoughts in their own words, their trades, the swarm's news
export const FEED_KINDS = ['agent.note', 'agent.trade', 'swarm.news'];
const streamAgentOf = stream => (typeof stream === 'string' && stream.startsWith('agent:') ? stream.slice(6) : null);
export const plainNote = value => show(value).replace(/\*\*|__|`+/g, '').replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim();
// "opened 3 SPY iron condors · Oct 2 · max loss $150"; "closed 3 SPY iron condors".
export function tradeWords(payload) {
  const what = structureText(payload.underlying, payload.structure);
  const count = payload.quantity === 1 ? `1 ${what}` : `${payload.quantity} ${what}s`;
  if (payload.action === 'open') return [`opened ${count}`, expiryText(payload.expiry) && `expires ${expiryText(payload.expiry)}`, `max loss ${money(payload.max_loss_usd, 0)}`].filter(Boolean).join(' · ');
  return `closed ${count}`;
}
// One entry of the stream, or null for anything the page does not show: `note` (a thought), `trade` or `news` (a birth or
// a retirement, about the agent it names).
export function streamEntry(event, names = new Map()) {
  if (!event || !FEED_KINDS.includes(event.kind)) return null;
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const base = { id: show(event.id), seq: Number(event.seq) || 0, at: show(event.at) };
  if (event.kind === 'swarm.news') {
    const text = plainNote(payload.text);
    const who = agentId(payload.agent) ? payload.agent : null;
    if (!text) return null;
    const name = who ? event.display_name || names.get(who) || titleCase(who) : 'The House';
    // A birth with nothing more to say joins its neighbours on one line (`streamEntries`).
    if (who && PLAIN_BIRTH.test(text)) return { ...base, kind: 'births', agent: null, members: [{ id: base.id, agent: who, name }], text };
    return { ...base, kind: 'news', agent: who, name, text };
  }
  const agent = streamAgentOf(event.stream);
  if (!agentId(agent)) return null;
  const name = event.display_name || names.get(agent) || titleCase(agent);
  if (event.kind === 'agent.note') {
    const text = plainNote(payload.text);
    return text ? { ...base, kind: 'note', agent, name, text } : null;
  }
  return {
    ...base, kind: 'trade', agent, name, text: tradeWords(payload), real: payload.real === true, action: payload.action === 'open' ? 'open' : 'close',
    pnl: numeric(payload.pnl_usd) ? signedMoney(payload.pnl_usd) : '', tone: signOf(payload.pnl_usd),
    // The tape's `why` can run to 240 characters and keep numerals: it shows only as a short plain tag, never raw.
    why: tickerCase(plainTag(payload.why, 80), [payload.underlying]) || '',
  };
}
const PLAIN_BIRTH = /^is born, (?:forked from its parent|a new family)\.$/;
// Births this close together share a line.
export const BIRTH_WINDOW_MS = 30 * 60 * 1000;
export const joinBirths = (group, entry) => group?.kind === 'births' && entry?.kind === 'births'
  && Math.abs(Date.parse(group.at) - Date.parse(entry.at)) <= BIRTH_WINDOW_MS;
// "Scholes 196 is born." or "Haghani 196, Rosenfeld 196 and Scholes 196 are born.", as its parts.
export const birthWords = members => (members.length === 1 ? ' is born.' : ' are born.');
// Newest first, each event once, and an agent saying the same thing twice in a row shows once. Plain births in a row
// share one line, newest name first.
export function streamEntries(events, names = new Map(), limit = 40) {
  const ordered = [...(Array.isArray(events) ? events : [])].filter(event => event && typeof event === 'object')
    .sort((left, right) => (Date.parse(right.at) - Date.parse(left.at)) || ((Number(right.seq) || 0) - (Number(left.seq) || 0)));
  const entries = [];
  const seen = new Set();
  for (const event of ordered) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const entry = streamEntry(event, names);
    if (!entry) continue;
    const previous = entries.at(-1);
    if (joinBirths(previous, entry)) { previous.members.push(...entry.members); continue; }
    if (previous && entry.agent && previous.agent === entry.agent && previous.kind === entry.kind && previous.text === entry.text) continue;
    entries.push(entry);
    if (entries.length >= limit) break;
  }
  return entries;
}

// ---- the agents' own words, under the page's rules
// The page's own copy of the House's sentence rules for a thesis (league/swarm/public.py `thesis_text`), used only while
// the House has not sent its own: whole sentences in order, none with a digit, a colon, a bracket, a code mark or a number
// written as a word (the pronoun "one" aside), within the limit. The number rules themselves (`numbered`, `plainGlyphs`)
// live in schema.js, the House's word for word, so the Worker refuses exactly what the page would hide.
const CODE_MARKS = /[=_{}[\]<>`#|\\]|->|::|\bctx\.|\bnp\.|\bPARAMS\b|\bNEEDS\b|\bdef\s|\breturn\s|\bimport\s|\blambda\b/;
export { numbered };
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
// A sentence an older publisher has already cut a number out of ("exceeds standard deviations", "IV above ."). Never shown.
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
// The House's own thesis as the page shows it: the page drops any sentence its own rules refuse.
export function houseThesis(text) {
  if (typeof text !== 'string') return null;
  const kept = sentencesOf(text).filter(plainSentence);
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
// The level an open row of an agent's money stands on: the route its trade names when the House sent one, else the
// Incubator for an incubator row and Tuition for any other agent row.
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
// certain. A retired agent still holding money stands on that money's step, never in the graveyard while it is open.
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
// An agent's thesis wherever the page shows it: the House's own when it publishes `rationale` for it (even null: then
// nothing shows); else, from an older House, its mechanism under the page's own rules. Never a raw mechanism.
export function agentThesis(checkpoint, id) {
  const published = (Array.isArray(checkpoint?.rationale?.agents) ? checkpoint.rationale.agents : []).find(entry => entry?.id === id);
  if (published) return houseThesis(published.thesis);
  const agent = (Array.isArray(checkpoint?.agents) ? checkpoint.agents : []).find(entry => entry?.id === id) || null;
  return thesisText(agent?.mechanism, 280, 12, { interim: true });
}

// ---- the game's levels
export const LEVEL_WORDS = { train: 'Train', validation: 'Validation', practice: 'Practice', incubator: 'Incubator', tuition: 'Tuition',
  candidate: 'Candidate', probe: 'Probe', sized: 'Sized', retired: 'Retired' };
export const LEVEL_TAG_KIND = { train: 'band', validation: 'band', candidate: 'band', practice: 'practice', incubator: 'incubator', tuition: 'tuition',
  probe: 'real', sized: 'real', retired: 'retired' };
// Hover only: never on the page.
export const LEVEL_TITLES = {
  train: 'Learning on recorded markets', validation: 'Tested on years it never saw', practice: 'Shadow trades on live quotes, never real money',
  incubator: INCUBATOR_TITLE, tuition: 'One real contract to measure fills, never evidence', candidate: 'Passed the unseen market test',
  probe: 'Real money, small', sized: 'Real money, sized by its record',
};
// A real position's route as a tag beside its agent's name.
export const ROUTE_TAGS = {
  tuition: { kind: 'tuition', title: LEVEL_TITLES.tuition },
  incubator: { kind: 'incubator', title: INCUBATOR_TITLE },
  probe: { kind: 'real', title: LEVEL_TITLES.probe },
  sized: { kind: 'real', title: LEVEL_TITLES.sized },
};
// Who closed a position, from the House's `exit`.
export const EXIT_WORDS = { agent: 'closed by the agent', house: 'closed by the House', expiry: 'expired' };
// Each ledger row's reasons from the House's `rationale`, under the page's own rules again: an open or close tag only as
// a plain short tag (never a raw mechanism or a numeral), its tickers in capitals.
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
// The five rungs, top to bottom: one straight path (Train, Validation, Practice, Probe, Sized), and only the top two
// trade real money. `levels` is every published level that can stand on a rung, in the order its dots are drawn;
// `reached` is the House's funnel key for how many families ever reached it since the reset. The older rungs are no
// longer places of their own: Candidate, Tuition and the Incubator stand on Practice and keep their own tag and look. A
// retired agent that still holds money stands on its money's rung.
export const AGENT_STAGES = [
  { level: 5, key: 'sized', label: 'Sized', levels: ['sized'], real: true, reached: 'sized' },
  { level: 4, key: 'probe', label: 'Probe', levels: ['probe'], real: true, reached: 'probe' },
  { level: 3, key: 'practice', label: 'Practice', levels: ['candidate', 'validation', 'practice', 'tuition', 'incubator'], reached: 'practice' },
  { level: 2, key: 'validation', label: 'Validation', levels: ['validation'], reached: 'validation' },
  { level: 1, key: 'train', label: 'Train', levels: ['train'], reached: 'born' },
];
const HOME_RUNG = { sized: 5, probe: 4, candidate: 3, tuition: 3, incubator: 3, practice: 3, validation: 2, train: 1 };
// The rung number a level stands on; null for a retired agent's level. The House publishes a validated agent that
// practises as `validation` (its `level_of` asks "validated" before "practising"): `practising` moves it up to Practice.
export const rungOf = (level, practising = false) => (level === 'validation' && practising ? HOME_RUNG.practice : HOME_RUNG[level] ?? null);
// The agents that practise, from the practice read the checkpoint already carries: a living agent's row with at least one
// session. The row says it practised inside the read's window (the last 20 sessions), not that it practises this minute;
// the House does not publish that for a validated agent.
export function practisingAgents(checkpoint) {
  const rows = Array.isArray(checkpoint?.practice?.rows) ? checkpoint.practice.rows : [];
  return new Set(rows.filter(row => row && row.status === 'alive' && Number.isSafeInteger(row.sessions) && row.sessions >= 1 && agentId(row.agent))
    .map(row => row.agent));
}
// The staircase is the shape. Train, the base, is the whole width; each step above it is drawn between its own `floor`
// and its `cap` by the share of families that ever reached it (a log scale: one family still shows against thousands
// born), and always at least a `notch` narrower than the step under it. Every number is a share of the board's width,
// for the four steps above the base, top to bottom. A step nobody has reached stands at its floor. A phone (`narrow`)
// keeps the three lower steps wide, so seven dots fit one row of Practice on a 390 px screen, and narrows hard only at
// the real-money line: three dots still fit the top step, and the line's label fits beside Probe down to 320 px.
export const STAIRS = {
  wide: { floor: [0.3, 0.36, 0.42, 0.48], cap: [1, 1, 1, 1], notch: 0.06 },
  narrow: { floor: [0.46, 0.56, 0.88, 0.93], cap: [0.59, 0.64, 0.9, 0.95], notch: 0.05 },
};
// A step the House published no count for is drawn where a swarm's usual shares would put it, so a board with no data
// at all is the same staircase.
export const REST_SHARES = [0.09, 0.25, 0.45, 0.7];
// The drawn width of each step, top to bottom, from each step's share (0 to 1, or null when it was not counted). The
// widths only narrow going up, whatever the counts say: a step counted above the one under it is held a notch inside it.
export function stairWidths(shares, { floor, cap, notch }) {
  const widths = shares.map(() => 1);
  for (let index = shares.length - 2; index >= 0; index -= 1) {
    const share = Number.isFinite(shares[index]) ? Math.min(1, Math.max(0, shares[index])) : REST_SHARES[index];
    const wanted = floor[index] + (cap[index] - floor[index]) * share;
    widths[index] = Number(Math.max(floor[index], Math.min(wanted, widths[index + 1] - notch)).toFixed(4));
  }
  return widths;
}
const countOf = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);
export function agentStages(checkpoint) {
  const rows = swarmRows(checkpoint);
  const funnel = checkpoint?.levels?.funnel && typeof checkpoint.levels.funnel === 'object' ? checkpoint.levels.funnel : null;
  // `ever` is null when the House could not count the step (or sent no funnel): then it shows no number.
  const counts = AGENT_STAGES.map(stage => (funnel ? countOf(funnel[stage.reached]) : null));
  const most = Math.max(1, ...counts.map(count => count ?? 0));
  const shareOf = count => (count ? Math.log10(count + 1) / Math.log10(most + 1) : 0);
  const shares = counts.map(count => (count === null ? null : shareOf(count)));
  const wide = stairWidths(shares, STAIRS.wide);
  const narrow = stairWidths(shares, STAIRS.narrow);
  return AGENT_STAGES.map((stage, index) => ({ ...stage, agents: rows.filter(row => row.rung === stage.level)
    .sort((left, right) => stage.levels.indexOf(left.level) - stage.levels.indexOf(right.level) || rankOf(left.band) - rankOf(right.band)
      || left.id.localeCompare(right.id)),
  ever: counts[index], share: shareOf(counts[index]), width: { wide: wide[index], narrow: narrow[index] } }));
}
// "2,317 retired · 104,494 backtests": what the swarm has thrown away and tried since the reset (the hover on Train's count).
export function swarmLine(checkpoint) {
  const parts = [];
  const retired = countOf(checkpoint?.levels?.funnel?.retired);
  if (retired !== null) parts.push(`${retired.toLocaleString('en-US')} retired`);
  const trials = countOf(checkpoint?.gym?.trials);
  if (trials !== null) parts.push(plural(trials, 'backtest'));
  return parts.join(' · ');
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
    // Polling asks a new address each time: the cache keeps the newest few only.
    if (responseCache.size > 32) responseCache.delete(responseCache.keys().next().value);
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
  const data = await fetchJson(`${apiBase(pageSearch())}/checkpoint${CHECKPOINT_READ}`, MAX_PUBLIC_CHECKPOINT_BYTES);
  if (!validCheckpoint(data, { publicRead: true })) throw new Error('Invalid checkpoint.');
  return data;
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
function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined && content !== null) node.textContent = content;
  if (className) node.className = className;
  return node;
}
function timeNode(value, style, className) {
  const node = element('time', date(value, style), className);
  node.dateTime = value;
  return node;
}
function svgElement(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
const tagNode = (text, kind, title = '') => {
  const tag = element('span', text, `tag tag-${kind}`);
  if (title) tag.setAttribute('title', title);
  return tag;
};
// An agent's level as the page's own tag (TRAIN, VALIDATION, TUITION, …), its meaning on hover.
const levelTag = level => tagNode(LEVEL_WORDS[level] || 'unknown', LEVEL_TAG_KIND[level] || 'band', LEVEL_TITLES[level] || '');
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
// Types a thought out at a readable pace in about two seconds; off when the visitor asked for less motion.
const typers = new WeakMap();
function typeInto(node, text, animate = true, done = () => {}) {
  const previous = typers.get(node);
  if (previous) clearTimeout(previous);
  if (!animate || reducedMotion() || !text) { node.textContent = text; done(); return 0; }
  const chunk = Math.max(2, Math.ceil(text.length / 90));
  let shown = 0;
  const step = () => {
    shown = Math.min(text.length, shown + chunk);
    node.textContent = text.slice(0, shown);
    if (shown < text.length) typers.set(node, setTimeout(step, 24));
    else { typers.delete(node); done(); }
  };
  step();
  return Math.ceil(text.length / chunk) * 24;
}
// A chart's readout under the pointer: a mouse hovers it; a tap shows the same and keeps it until the next tap outside.
function readoutOn(plot, showAt, hide) {
  let away = null;
  const outside = event => {
    if (plot.contains?.(event.target)) return;
    hide();
    document.removeEventListener('pointerdown', outside, true);
    away = null;
  };
  const at = event => {
    showAt(event);
    if (event.pointerType !== 'mouse' && !away) { away = outside; document.addEventListener('pointerdown', outside, true); }
  };
  plot.addEventListener('pointermove', at);
  plot.addEventListener('pointerdown', at);
  plot.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') hide(); });
}

// 1. Profit and Running.
function numbersPanel(checkpoint, state) {
  const top = headline(checkpoint);
  const profit = element('div', null, 'number number-profit');
  profit.setAttribute('title', PROFIT_TITLE);
  const value = element('span', top.profit.value, `number-value${top.profit.tone ? ` ${top.profit.tone}` : ''}`);
  // A refresh that changes the number flashes it once, green up or red down; the first draw never does.
  const before = state.shownProfit;
  if (top.profit.usd !== null && before !== null && before !== undefined && centsOf(top.profit.usd) !== centsOf(before)) {
    value.className += centsOf(top.profit.usd) > centsOf(before) ? ' wash-up' : ' wash-down';
  }
  state.shownProfit = top.profit.usd;
  const profitValue = element('dd');
  profitValue.append(value);
  profit.append(element('dt', 'Profit'), profitValue);
  const running = element('div', null, 'number number-clock');
  const main = element('span', top.running.main, 'number-value');
  const tick = element('span', top.running.tick, 'number-tick');
  const runningValue = element('dd');
  runningValue.append(main, tick);
  running.append(element('dt', 'Running'), runningValue);
  state.clock = top.running.startedAt === null ? null : { main, tick, startedAt: top.running.startedAt };
  return [profit, running];
}

// 2. The balance over the whole record: round gridlines, the days along the bottom, each deposit where it landed, a gold
// dot where an agent opened a real position (hollow while it is open). Hover or tap reads any point.
export function chartMarks(checkpoint, series) {
  const ledger = positionsLedger(checkpoint);
  if (!ledger || !series) return [];
  return [...ledger.open, ...ledger.closed].filter(line => AGENT_SOURCES.includes(line.source))
    .map(line => ({ line, at: Date.parse(line.openedAt) })).filter(({ at }) => Number.isFinite(at) && at >= series.start && at <= series.end)
    .map(({ line, at }) => {
      const after = series.points.find(point => point.at >= at) || series.last;
      return { id: line.id, open: line.open, x: series.x(at), y: after.y, label: `${line.who} opened ${line.what}` };
    });
}
function accountPanel(checkpoint, marks) {
  const series = accountSeries(marks, checkpoint);
  const account = checkpoint?.account;
  const head = element('div', null, 'chart-head');
  head.append(element('span', 'Account', 'chart-label'));
  if (account) {
    const balance = element('span', money(account.equity), 'chart-balance');
    balance.setAttribute('title', `${account.stale ? 'Last recorded balance' : 'Balance'} · ${date(account.as_of)}`);
    head.append(balance);
  }
  if (!series) return [head, element('p', 'No balance recorded yet.', 'empty-state')];
  const figure = element('figure', null, 'balance');
  const { width, height } = series;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', class: 'balance-svg', role: 'img',
    'aria-label': `Brokerage Account balance since ${date(new Date(series.start).toISOString(), 'day')}: ${money(series.first.equity.toFixed(2))} to ${money(series.last.equity.toFixed(2))}.`,
  });
  for (const tick of series.ticks) svg.append(svgElement('line', { x1: 0, x2: width, y1: tick.y.toFixed(1), y2: tick.y.toFixed(1), class: 'balance-grid' }));
  svg.append(svgElement('path', { d: series.area, class: 'balance-area' }), svgElement('path', { d: series.path, class: 'balance-line' }));
  const cross = svgElement('line', { x1: 0, x2: 0, y1: 0, y2: height, class: 'balance-cross', opacity: 0 });
  svg.append(cross);
  const plot = element('div', null, 'balance-plot');
  const yLabels = series.ticks.map(tick => {
    const label = element('span', money(tick.value.toFixed(2), series.step < 1 ? 2 : 0), 'balance-y');
    place(label, { top: `${(tick.y / height * 100).toFixed(2)}%` });
    return label;
  });
  const deposits = depositMarks(series).map(deposit => {
    const note = element('span', deposit.label, `balance-deposit${deposit.x > width * 0.6 ? ' balance-deposit-left' : ''}`);
    place(note, { left: `${(deposit.x / width * 100).toFixed(2)}%`, top: `${(deposit.y / height * 100).toFixed(2)}%` });
    return note;
  });
  const trades = chartMarks(checkpoint, series);
  const dots = trades.map(mark => {
    const dot = element('span', null, `balance-mark${mark.open ? ' balance-mark-open' : ''}`);
    dot.setAttribute('aria-hidden', 'true');
    place(dot, { left: `${(mark.x / width * 100).toFixed(2)}%`, top: `${(mark.y / height * 100).toFixed(2)}%` });
    return dot;
  });
  const end = element('span', null, 'balance-dot');
  place(end, { left: `${(series.last.x / width * 100).toFixed(2)}%`, top: `${(series.last.y / height * 100).toFixed(2)}%` });
  const readout = element('span', '', 'balance-readout');
  readout.hidden = true;
  plot.append(svg, ...yLabels, ...deposits, ...dots, end, readout);
  readoutOn(plot, move => {
    try {
      const box = svg.getBoundingClientRect();
      const offset = move.clientX - box.left;
      const x = offset / box.width * width;
      // Within 10 px of an agent's mark, the readout names that position instead of the balance.
      const mark = trades.reduce((best, entry) => {
        const distance = Math.abs(entry.x / width * box.width - offset);
        return distance <= 10 && (!best || distance < best.distance) ? { entry, distance } : best;
      }, null)?.entry;
      const nearest = series.points.reduce((best, point) => (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best), series.points[0]);
      const at = mark ? mark.x : nearest.x;
      cross.setAttribute('x1', at.toFixed(1));
      cross.setAttribute('x2', at.toFixed(1));
      cross.setAttribute('opacity', '1');
      readout.textContent = mark ? mark.label : `${money(nearest.equity.toFixed(2))} · ${date(new Date(nearest.at).toISOString(), 'short')}`;
      readout.hidden = false;
      // Centred on the point, and never past either edge of the plot.
      const wide = readout.getBoundingClientRect().width;
      const left = Math.min(Math.max(at / width * box.width - wide / 2, 0), Math.max(0, box.width - wide));
      place(readout, { left: `${left.toFixed(1)}px` });
    } catch { /* no layout here */ }
  }, () => { readout.hidden = true; cross.setAttribute('opacity', '0'); });
  const axis = element('div', null, 'balance-x');
  axis.setAttribute('aria-hidden', 'true');
  for (const day of dayTicks(series.start, series.end)) {
    const label = element('span', day.label);
    place(label, { left: `${(series.x(day.at) / width * 100).toFixed(2)}%` });
    axis.append(label);
  }
  figure.append(plot, axis);
  return [head, figure];
}

// 3. The agents thinking, live: newest first. On arrival the newest few play in, oldest first, typed out; after that each
// live thought, trade or birth types in at the top as it lands. Every entry carries its real time.
const STREAM_LIMIT = 40;
const STREAM_INTRO = 5;
// An agent's name: it opens its agent on the board, as clicking its dot does; an agent off the board is a plain name.
function nameNode(agentKey, text, state, className) {
  const hasDot = Boolean(agentKey && state.dotNodes?.has(agentKey));
  const name = element(hasDot ? 'button' : 'span', text, className);
  if (hasDot) {
    name.type = 'button';
    name.setAttribute('aria-controls', 'agent-detail');
    name.addEventListener('click', () => state.openAgent?.(agentKey));
  }
  return name;
}
// One line of births: every name, then "is born." or "are born.".
function birthsLine(line, members, state) {
  const nodes = [];
  members.forEach((member, index) => {
    if (index) nodes.push(element('span', index === members.length - 1 ? ' and ' : ', '));
    nodes.push(nameNode(member.agent, member.name, state, 'entry-name'));
  });
  line.replaceChildren(...nodes, element('span', birthWords(members), 'entry-words'));
}
function entryNode(entry, state) {
  const item = element('li', null, `entry entry-${entry.kind === 'births' ? 'news entry-births' : entry.kind}${entry.kind === 'trade' && entry.real ? ' entry-real' : ''}`);
  item.dataset.entry = entry.id;
  const agent = entry.agent ? state.agents.get(entry.agent) : null;
  const name = nameNode(entry.agent, entry.name, state, 'entry-name');
  const when = timeNode(entry.at, 'short', 'entry-when');
  when.textContent = ago(entry.at);
  when.setAttribute('title', date(entry.at));
  state.times.add(when);
  if (entry.kind === 'births') {
    const line = element('p', null, 'entry-text');
    birthsLine(line, entry.members, state);
    item.append(line, when);
    return { item, words: null, line, when };
  }
  if (entry.kind === 'news') {
    const line = element('p', null, 'entry-text');
    line.append(name, element('span', ` ${entry.text}`, 'entry-words'));
    item.append(line, when);
    return { item, words: null };
  }
  const head = element('div', null, 'entry-head');
  head.append(name);
  if (agent) head.append(levelTag(levelOf(agent, state.checkpoint)));
  if (entry.kind === 'trade') head.append(tagNode(entry.real ? 'real money' : 'shadow', entry.real ? 'real' : 'shadow'));
  head.append(when);
  const text = element('p', null, 'entry-text');
  const words = element('span', '', 'entry-words');
  text.append(words);
  if (entry.kind === 'trade') {
    if (entry.why) text.append(element('span', ` “${entry.why}”`, 'entry-why'));
    if (entry.pnl) text.append(element('b', ` ${entry.pnl}`, `entry-pnl ${entry.tone}`.trim()));
  }
  item.append(head, text);
  return { item, words };
}
function drawEntry(entry, state, animate) {
  for (const member of entry.members || [entry]) state.seen.add(member.id);
  // A birth soon after the births on top joins their line.
  const top = state.births;
  if (top && state.streamList.firstElementChild === top.item && joinBirths(top.entry, entry)) {
    top.entry.members.unshift(...entry.members);
    top.entry.at = entry.at;
    birthsLine(top.line, top.entry.members, state);
    top.when.dateTime = entry.at;
    top.when.textContent = ago(entry.at);
    top.when.setAttribute('title', date(entry.at));
    return;
  }
  const { item, words, line, when } = entryNode(entry, state);
  state.births = entry.kind === 'births' ? { item, line, when, entry: { ...entry, members: [...entry.members] } } : null;
  if (animate) item.className += ' entry-new';
  state.streamList.prepend(item);
  if (words) typeInto(words, entry.text, animate);
  state.shown.unshift(entry.id);
  while (state.shown.length > STREAM_LIMIT) {
    state.shown.pop();
    const last = state.streamList.lastElementChild;
    if (last) { state.times.delete(last.querySelector('time')); last.remove(); }
  }
  // While it is deciding, the speaker's dot on the board breathes.
  if (entry.kind === 'note' && Date.now() - Date.parse(entry.at) < 180000) speak(state, entry.agent);
}
// The queue plays one entry at a time, long enough apart to see each one land.
function playQueue(state) {
  // Less motion: everything waiting lands at once.
  if (reducedMotion()) { while (state.queue.length) { const entry = state.queue.shift(); if (!(entry.members || [entry]).every(member => state.seen.has(member.id))) drawEntry(entry, state, false); } return; }
  if (state.playing || !state.queue.length) return;
  // A long backlog (a tab coming back) lands at once but for the newest few, which play in.
  while (state.queue.length > STREAM_INTRO) {
    const late = state.queue.shift();
    if (!(late.members || [late]).every(member => state.seen.has(member.id))) drawEntry(late, state, false);
  }
  const entry = state.queue.shift();
  if ((entry.members || [entry]).every(member => state.seen.has(member.id))) { playQueue(state); return; }
  state.playing = true;
  drawEntry(entry, state, true);
  const wait = entry.kind === 'news' || entry.kind === 'births' ? 900 : Math.min(4000, 1200 + entry.text.length * 6);
  state.playTimer = setTimeout(() => { state.playing = false; playQueue(state); }, wait);
}
function streamPanel(state) {
  const list = element('ol', null, 'stream');
  list.setAttribute('aria-label', 'The agents’ thoughts, trades and news, newest first');
  state.streamList = list;
  state.shown = [];
  state.seen = new Set();
  state.births = null;
  state.times = new Set();
  const entries = streamEntries(state.feed, state.names, STREAM_LIMIT);
  if (!entries.length) {
    list.append(element('li', state.checkpoint ? 'Quiet for now.' : 'Connecting…', 'empty-state stream-empty'));
    return list;
  }
  const intro = reducedMotion() ? 0 : Math.min(STREAM_INTRO, entries.length);
  for (const entry of entries.slice(intro).reverse()) drawEntry(entry, state, false);
  state.queue = [...entries.slice(0, intro).reverse(), ...state.queue];
  return list;
}
// While the card says it is deciding, its speaker's dot on the board breathes: one dot at a time.
// `id` starts three minutes of breathing; without one, the dots are re-marked as they stand (a redraw), never extended.
function speak(state, id) {
  if (id !== undefined) {
    state.speaking = id || null;
    clearTimeout(state.speakTimer);
    if (id) state.speakTimer = setTimeout(() => speak(state, null), 180000);
  }
  for (const [agent, node] of state.dotNodes || []) {
    const classes = String(node.className).split(' ').filter(name => name && name !== 'dot-speaking');
    if (agent === state.speaking) classes.push('dot-speaking');
    const next = classes.join(' ');
    if (next !== node.className) node.className = next;
  }
}

// 4. The positions: open, then closed, each with the agent's reason; then the account's other activity and the total,
// which is the Profit headline.
function groupHead(label, line) {
  const head = element('div', null, 'ledger-group');
  head.append(element('h3', label), element('span', line.pnl, `ledger-sum ${line.tone}`.trim()));
  return head;
}
function positionNode(line, state) {
  const item = element('li', null, `pos${line.open ? ' pos-open' : ''}`);
  item.dataset.position = line.id;
  const main = element('div', null, 'pos-main');
  main.append(element('p', line.what, 'pos-what'));
  if (line.why) {
    const why = element('p', `“${line.why}”`, 'pos-why');
    why.setAttribute('title', 'The agent’s own words when it opened the position.');
    main.append(why);
  }
  if (line.thesis) main.append(element('p', line.thesis, 'pos-thesis'));
  if (line.closeWhy) main.append(element('p', `Closed: “${line.closeWhy}”`, 'pos-why pos-close-why'));
  const meta = element('p', null, 'pos-meta');
  const hasDot = Boolean(line.agent && state.dotNodes?.has(line.agent));
  const who = element(hasDot ? 'button' : 'span', line.who, 'pos-who');
  if (hasDot) {
    who.type = 'button';
    who.setAttribute('aria-controls', 'agent-detail');
    who.addEventListener('click', () => state.openAgent?.(line.agent));
  }
  meta.append(who);
  if (line.route && ROUTE_TAGS[line.route]) meta.append(tagNode(line.routeText, ROUTE_TAGS[line.route].kind, ROUTE_TAGS[line.route].title));
  const facts = [plural(line.quantity, 'contract'), `opened ${date(line.openedAt, 'day')}`];
  if (line.closedAt) facts.push(`closed ${date(line.closedAt, 'day')}`);
  else if (line.expiry) facts.push(`expires ${line.expiry}`);
  if (line.maxLoss) facts.push(`max loss ${money(line.maxLoss, 0)}`);
  meta.append(element('span', facts.join(' · ')));
  main.append(meta);
  const result = element('div', null, 'pos-result');
  const pnl = element('span', line.pnl, `pos-pnl ${line.tone}`.trim());
  const before = state.lastPnl.get(line.id);
  if (line.open && line.usd !== null && before && centsOf(before) !== centsOf(line.usd)) pnl.className += centsOf(line.usd) > centsOf(before) ? ' wash-up' : ' wash-down';
  result.append(pnl);
  const status = element('span', null, 'pos-status');
  if (line.open) status.append(pulse(), element('span', 'open'));
  else status.append(element('span', EXIT_WORDS[line.exit] || 'closed'));
  result.append(status);
  item.append(main, result);
  return item;
}
function calibrationNode(group) {
  const item = element('li', null, 'pos pos-house');
  const fold = element('details', null, 'pos-fold');
  const summary = element('summary');
  summary.setAttribute('title', CALIBRATION_TITLE);
  const main = element('span', null, 'pos-main');
  main.append(element('span', SOURCE_WORDS.calibration, 'pos-what'),
    element('span', `${plural(group.count, 'round trip')} · ${date(group.from, 'day')} – ${date(group.to, 'day')}`, 'pos-meta'));
  summary.append(main, element('span', group.pnl, `pos-pnl ${group.tone}`.trim()));
  const list = element('ol', null, 'fold-list');
  for (const line of group.rows) {
    const row = element('li', null, 'fold-row');
    row.append(timeNode(line.openedAt, 'short', 'fold-when'), element('span', line.what, 'fold-what'), element('span', line.pnl, `fold-pnl ${line.tone}`.trim()));
    list.append(row);
  }
  fold.append(summary, list);
  item.append(fold);
  return item;
}
function positionsPanel(checkpoint, state) {
  const ledger = positionsLedger(checkpoint);
  if (!ledger) return [element('p', 'No positions yet.', 'empty-state')];
  const nodes = [];
  if (ledger.open.length) {
    const list = element('ol', null, 'ledger-list');
    list.append(...ledger.open.map(line => positionNode(line, state)));
    if (ledger.marks) {
      const item = element('li', null, 'pos pos-marks');
      item.setAttribute('title', MARKS_TITLE);
      item.append(element('span', 'Valuation difference', 'pos-what'), element('span', ledger.marks.pnl, `pos-pnl ${ledger.marks.tone}`.trim()));
      list.append(item);
    }
    nodes.push(groupHead('Open', ledger.openTotal), list);
  }
  if (ledger.closed.length || ledger.calibration || ledger.earlier) {
    const list = element('ol', null, 'ledger-list');
    list.append(...ledger.closed.map(line => positionNode(line, state)));
    if (ledger.calibration) list.append(calibrationNode(ledger.calibration));
    if (ledger.earlier) {
      const item = element('li', null, 'pos pos-earlier');
      item.append(element('span', `${plural(ledger.earlier.count, 'older position')}`, 'pos-what'), element('span', ledger.earlier.pnl, `pos-pnl ${ledger.earlier.tone}`.trim()));
      list.append(item);
    }
    nodes.push(groupHead('Closed', ledger.closedTotal), list);
  }
  if (!nodes.length) nodes.push(element('p', 'No real positions yet.', 'empty-state'));
  state.lastPnl = new Map([...ledger.open, ...ledger.closed].map(line => [line.id, line.usd]));
  const other = element('div', null, 'ledger-line');
  other.setAttribute('title', 'Fees no position carries, and interest.');
  other.append(element('span', 'Fees & other'), element('span', ledger.other.pnl, `ledger-sum ${ledger.other.tone}`.trim()));
  const total = element('div', null, 'ledger-total');
  total.append(element('span', 'Profit'), element('span', ledger.total.pnl, `ledger-sum ${ledger.total.tone}`.trim()));
  nodes.push(other, total);
  return nodes;
}

// 5. The swarm on the game's five steps, drawn as a staircase: wide Train at the bottom, narrow Sized at the top, each
// step as wide as the share of families that ever reached it, with one gold line under the two steps that trade real
// money. Each agent is a dot on the step it stands on, a ring filling as it meets the next step's checks.
function progressRing(progress) {
  const ring = svgElement('svg', { viewBox: '0 0 36 36', class: 'agent-progress-ring', 'aria-hidden': 'true' });
  ring.append(svgElement('circle', { cx: 18, cy: 18, r: 14, class: 'agent-progress-track' }));
  if (progress && progress.fraction > 0) {
    ring.append(svgElement('circle', { cx: 18, cy: 18, r: 14, pathLength: 100, class: 'agent-progress-fill',
      'stroke-dasharray': `${(100 * progress.fraction).toFixed(2)} 100` }));
  }
  return ring;
}
function progressDetail(progress) {
  const panel = element('div', null, 'agent-progress');
  if (!progress) return panel;
  const head = element('div', null, 'progress-heading');
  head.append(element('span', progress.target === 'maintain' ? progress.label : `Next · ${progress.label}`), element('span', progress.count, 'progress-count'));
  const list = element('ul', null, 'progress-checks');
  for (const check of progress.checks) {
    const item = element('li', null, `progress-check${check.met ? ' check-met' : ''}`);
    const marker = element('span', check.met ? '✓' : '·', 'check-mark');
    marker.setAttribute('aria-hidden', 'true');
    const count = check.need === 1 ? (check.met ? 'Met' : 'Not met') : `${check.done.toLocaleString('en-US')} / ${check.need.toLocaleString('en-US')}`;
    item.append(marker, element('span', check.label, 'check-label'), element('span', count, 'check-count'));
    list.append(item);
  }
  panel.append(head, list);
  if (progress.blocker) panel.append(element('p', progress.blocker, 'progress-blocker'));
  return panel;
}
function agentDetail(row, checkpoint, state) {
  const card = element('article', null, 'agent-detail-card');
  const head = element('div', null, 'agent-detail-head');
  const close = element('button', '×', 'agent-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => state.selectAgent(null, row.id));
  head.append(element('h3', row.name), levelTag(row.level), close);
  card.append(head);
  const thesis = agentThesis(checkpoint, row.id);
  if (thesis || row.structure) {
    const strategy = element('p', null, 'agent-strategy');
    if (row.structure) strategy.append(element('span', row.structure, 'strategy-tag'));
    if (thesis) strategy.append(element('span', thesis));
    card.append(strategy);
  }
  const record = element('p', null, 'agent-record');
  record.append(element('span', row.record.main, row.record.tone));
  if (row.record.rest) record.append(element('span', row.record.rest));
  card.append(record, progressDetail(row.progress));
  return card;
}
// The one line across the board. What it means is for a hover, never on the page.
export const MONEY_LINE = 'Only the steps above this line trade real money';
// The line's label: an up-caret (drawn, not a character) and its two words.
function moneyMark() {
  const mark = element('span', null, 'ladder-real-mark');
  // The group of steps above the line is already named "Real money" for a screen reader.
  mark.setAttribute('aria-hidden', 'true');
  mark.setAttribute('title', MONEY_LINE);
  const caret = svgElement('svg', { viewBox: '0 0 10 6', class: 'ladder-real-caret', 'aria-hidden': 'true' });
  caret.append(svgElement('path', { d: 'M1 5 5 1l4 4' }));
  mark.append(caret, element('span', 'Real money'));
  return mark;
}
// A step's width as the stylesheet reads it: `--step` on a wide screen, `--step-narrow` on a phone.
function stepWidth(node, width) {
  const percent = share => `${(share * 100).toFixed(2)}%`;
  try { node.style.setProperty('--step', percent(width.wide)); node.style.setProperty('--step-narrow', percent(width.narrow)); } catch { /* no layout here */ }
}
// How many ever reached a rung, for a hover and a screen reader; Train's also says what the swarm threw away and tried.
function reachedTitle(stage, checkpoint) {
  const reached = `${stage.ever.toLocaleString('en-US')} ${stage.ever === 1 ? 'family has' : 'families have'} ever reached ${stage.label}`;
  const line = stage.reached === 'born' ? swarmLine(checkpoint) : '';
  return line ? `${reached} · ${line}` : reached;
}
function agentsPanel(checkpoint, state) {
  const board = element('div', null, 'ladder');
  // Every agent that stands on a rung: the retired are off the board.
  const rows = swarmRows(checkpoint).filter(row => row.rung !== null);
  const details = element('div', null, 'agent-detail');
  details.id = 'agent-detail';
  details.setAttribute('aria-live', 'polite');
  const escape = event => {
    if (event.key === 'Escape' && state.selectedAgent) { event.preventDefault(); state.selectAgent(null, state.selectedAgent); }
  };
  board.addEventListener('keydown', escape);
  details.addEventListener('keydown', escape);
  const buttons = new Map();
  state.dotNodes = buttons;
  const rowById = new Map(rows.map(row => [row.id, row]));
  state.selectAgent = (id, focusId = null) => {
    state.selectedAgent = rowById.has(id) ? id : null;
    const row = rowById.get(state.selectedAgent);
    for (const [agent, button] of buttons) button.setAttribute('aria-expanded', String(agent === state.selectedAgent));
    details.replaceChildren(...(row ? [agentDetail(row, checkpoint, state)] : []));
    details.hidden = !row;
    if (focusId) buttons.get(focusId)?.focus?.({ preventScroll: true });
  };
  // The steps that trade real money are one group; the gold line under it is the board's only divider, and its label
  // stands on that line beside the lowest of them.
  const money = element('div', null, 'ladder-real');
  money.setAttribute('role', 'group');
  money.setAttribute('aria-label', 'Real money');
  const floor = element('div', null, 'ladder-floor');
  board.append(money);
  const stages = agentStages(checkpoint);
  const lowestReal = stages.filter(stage => stage.real).at(-1);
  for (const stage of stages) {
    // A step nobody stands on and nobody is known to have reached is hollow: a dashed outline around its name. With no
    // data at all that is every step, so the board keeps its shape.
    const hollow = !stage.agents.length && !(stage.ever > 0);
    const rung = element('section', null, `rung rung-${stage.level}${stage.real ? ' rung-real' : ''}${stage.agents.length ? '' : ' rung-vacant'}${hollow ? ' rung-hollow' : ''}`);
    stepWidth(rung, stage.width);
    const heading = element('h3', stage.label, 'rung-name');
    heading.id = `rung-${stage.level}`;
    heading.setAttribute('title', LEVEL_TITLES[stage.key]);
    rung.setAttribute('aria-labelledby', heading.id);
    const group = element('div', null, 'agent-dots');
    for (const row of stage.agents) {
      const button = element('button', null, `agent-dot dot-${row.band} level-${row.level}${row.practising ? ' dot-practising' : ''}`);
      button.type = 'button';
      button.dataset.agent = row.id;
      button.dataset.level = row.level;
      button.dataset.rung = String(stage.level);
      const progress = row.progress ? ` · ${row.progress.count} toward ${row.progress.label}` : '';
      const label = `${row.name} · ${row.levelText}${row.practising ? ', practising' : ''}${row.structure ? ` · ${row.structure}` : ''}${progress}`;
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-controls', details.id);
      button.setAttribute('aria-expanded', 'false');
      button.append(progressRing(row.progress), element('span', null, 'agent-dot-core'));
      button.addEventListener('click', () => {
        const opening = state.selectedAgent !== row.id;
        state.selectAgent(opening ? row.id : null);
        if (opening) details.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      });
      buttons.set(row.id, button);
      group.append(button);
    }
    rung.append(heading, group);
    // The count the House published, as a small number at the step's end; a step it did not count shows none.
    if (stage.ever !== null) {
      const reached = element('span', stage.ever.toLocaleString('en-US'), 'reached-count');
      const title = reachedTitle(stage, checkpoint);
      reached.setAttribute('role', 'img');
      reached.setAttribute('aria-label', title);
      reached.setAttribute('title', title);
      rung.append(reached);
    }
    (stage === lowestReal ? floor : stage.real ? money : board).append(rung);
  }
  floor.append(moneyMark());
  money.append(floor);
  state.selectAgent(state.selectedAgent);
  return [board, details];
}
// A live publication produces one short ripple on its agent's dot. Historical batches, hidden tabs, stale events and
// reduced-motion readers never get simulated activity.
export function freshAgentActivity(event, now = Date.now()) {
  const age = now - Date.parse(event?.at);
  if (!Number.isFinite(age) || age < -60000 || age > 120000) return null;
  if (event.kind === 'agent.note' || event.kind === 'agent.trade') return streamAgentOf(event.stream);
  return event.kind === 'swarm.news' ? event.payload?.agent : null;
}
function pulseAgents(events, state) {
  if (document.visibilityState !== 'visible' || !floorRunning(state.checkpoint) || reducedMotion()) return;
  const now = Date.now();
  for (const event of events) {
    const id = freshAgentActivity(event, now);
    const button = state.dotNodes?.get(id);
    if (!button || state.pulsing >= 4 || now - (state.lastPulse.get(id) || 0) < 8000) continue;
    const box = button.getBoundingClientRect?.();
    if (!box || box.bottom < 0 || box.top > window.innerHeight) continue;
    state.lastPulse.set(id, now); state.pulsing += 1;
    const ring = element('span', null, `agent-activity${event.kind === 'agent.trade' ? ' activity-trade' : ''}`);
    ring.setAttribute('aria-hidden', 'true'); button.append(ring);
    const timer = setTimeout(() => { ring.remove?.(); state.pulsing -= 1; state.pulseTimers.delete(timer); }, 900);
    state.pulseTimers.add(timer);
  }
}
// A dot whose rung changed glides from its old place; a ring that moved fills to its new mark.
export function settleAgents(state) {
  const previous = state.agentPositions;
  const positions = new Map();
  const animate = previous.size && document.visibilityState === 'visible' && floorRunning(state.checkpoint) && !reducedMotion();
  for (const [id, node] of state.dotNodes || []) {
    const box = node.getBoundingClientRect?.();
    if (!box || !box.width || !box.height) continue;
    // The rung the board drew the dot on: a level alone cannot say it (a validated agent may stand on Practice).
    const rung = node.dataset.rung;
    const fill = node.querySelector?.('.agent-progress-fill');
    const dash = fill?.getAttribute('stroke-dasharray');
    positions.set(id, { x: box.left + window.scrollX, y: box.top + window.scrollY, rung, dash });
    const old = previous.get(id);
    if (!animate || !old || box.bottom < 0 || box.top > window.innerHeight) continue;
    const current = positions.get(id);
    if (old.rung !== rung) {
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
    numbers: find('floor-numbers'), account: find('floor-account'), status: find('floor-status'), stream: find('floor-stream'),
    positions: find('floor-positions'), agents: find('floor-agents'),
  };
  const state = {
    checkpoint: null, agents: new Map(), names: new Map(), feed: [], marks: [], mode: 'loading', clock: null,
    queue: [], shown: [], seen: new Set(), births: null, times: new Set(), playing: false, streamList: null,
    selectedAgent: null, lastPulse: new Map(), pulseTimers: new Set(), pulsing: 0, agentPositions: new Map(),
    shownProfit: null, lastPnl: new Map(), speaking: null, dotNodes: new Map(),
  };
  const ready = node => node && node.setAttribute('aria-busy', 'false');
  const drawn = (node, children) => { if (!node) return; node.replaceChildren(...children); ready(node); };
  const drawStatus = () => {
    if (!box.status) return;
    const live = state.mode === 'live' || state.mode === 'polling';
    const stopped = !floorRunning(state.checkpoint);
    const text = stopped ? (state.checkpoint ? 'paused' : 'connecting') : live ? 'live' : 'connecting';
    box.status.className = `live-status ${stopped && state.checkpoint ? 'live-stopped' : live && !stopped ? 'live-live' : 'live-idle'}`;
    // A status region re-announces whatever replaces it, so it changes only when the words do.
    if (state.statusText === text) return;
    state.statusText = text;
    box.status.replaceChildren(pulse(), element('span', text, 'status-word'));
  };
  const drawAgents = () => {
    if (!state.checkpoint) return;
    const focusedAgent = document.activeElement?.dataset?.agent;
    drawn(box.agents, agentsPanel(state.checkpoint, state));
    settleAgents(state);
    speak(state);
    if (focusedAgent) box.agents?.querySelector(`[data-agent="${focusedAgent}"]`)?.focus?.({ preventScroll: true });
  };
  // A name in the stream or the positions opens its dot's detail, as a click on the dot does, and focus lands on the dot.
  state.openAgent = id => {
    if (!state.dotNodes?.get(id)) return;
    state.selectAgent(id, id);
    box.agents?.querySelector('#agent-detail')?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  const drawStream = () => { if (box.stream) { drawn(box.stream, [streamPanel(state)]); playQueue(state); } };
  const keepFeed = events => {
    const byId = new Map([...state.feed, ...events].map(event => [event.id, event]));
    state.feed = [...byId.values()].sort((left, right) => (Number(right.seq) || 0) - (Number(left.seq) || 0)).slice(0, 400);
  };
  async function refresh() {
    try {
      state.checkpoint = await loadCheckpoint();
      try { state.marks = await loadHistory(); } catch { /* Keep the last verified history during an outage. */ }
      state.agents = new Map(state.checkpoint.agents.map(agent => [agent.id, agent]));
      state.names = new Map(state.checkpoint.agents.map(agent => [agent.id, agentName(agent)]));
    } catch {
      if (!state.checkpoint) {
        // Nothing published yet, or the record cannot be reached: the numbers keep their dashes.
        ready(box.numbers);
        drawn(box.account, [element('p', 'No balance recorded yet.', 'empty-state')]);
        drawn(box.positions, [element('p', 'No positions yet.', 'empty-state')]);
        drawn(box.agents, agentsPanel(null, state));
      }
    } finally {
      state.asked = true;
      drawStatus();
      if (state.checkpoint) {
        drawn(box.numbers, numbersPanel(state.checkpoint, state));
        drawn(box.account, accountPanel(state.checkpoint, state.marks));
        // The board first: the stream and the positions link their names to its dots.
        drawAgents();
        const focused = document.activeElement?.closest?.('[data-position]')?.dataset?.position;
        drawn(box.positions, positionsPanel(state.checkpoint, state));
        if (focused) box.positions?.querySelector(`[data-position="${focused}"] button`)?.focus?.({ preventScroll: true });
      }
    }
  }
  await refresh();
  const loads = [{ kind: 'agent.note', limit: 100 }, { kind: 'agent.trade', limit: 100 }, { kind: 'swarm.news', limit: 60 }, { kind: MARK, limit: MAX_EVENT_LIMIT }];
  const [notes, trades, news, marks] = await Promise.all(loads.map(query => loadEvents(query).catch(() => ({ events: [] }))));
  keepFeed([...notes.events, ...trades.events, ...news.events]);
  if (!state.marks.length && state.checkpoint) {
    state.marks = marks.events.map(event => ({ at: event.at, equity: event.payload.equity }));
    drawn(box.account, accountPanel(state.checkpoint, state.marks));
  }
  drawStream();
  const refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  const wake = () => { if (document.visibilityState === 'visible') refresh(); };
  document.addEventListener('visibilitychange', wake);
  let aged = Date.now();
  // The running clock ticks in the browser between checkpoints; the stream's times age with it.
  const tickTimer = setInterval(() => {
    if (state.clock) {
      const parts = runningParts(Math.max(0, (Date.now() - state.clock.startedAt) / 1000));
      state.clock.main.textContent = parts.main;
      state.clock.tick.textContent = parts.tick;
    }
    if (Date.now() - aged >= 20000) { aged = Date.now(); for (const node of state.times) node.textContent = ago(node.dateTime); }
  }, 1000);
  const loaded = [notes, trades, news, marks].flatMap(batch => batch.events);
  const feed = startFeed({
    streams: ['all'],
    onStatus: mode => { state.mode = mode; drawStatus(); },
    onEvents: events => {
      const live = events.filter(event => FEED_KINDS.includes(event.kind));
      const balance = events.filter(event => event.kind === MARK);
      if (live.length) {
        keepFeed(live);
        const entries = streamEntries(live, state.names).reverse().filter(entry => !(entry.members || [entry]).every(member => state.seen.has(member.id)));
        if (state.streamList && !state.shown.length) drawStream();
        else { state.queue.push(...entries); playQueue(state); }
        pulseAgents(live, state);
      }
      if (balance.length && state.checkpoint) {
        state.marks = [...state.marks, ...balance.map(event => ({ at: event.at, equity: event.payload.equity }))];
        drawn(box.account, accountPanel(state.checkpoint, state.marks));
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
  return { ...feed, stop() { clearTimeout(state.followUp); clearTimeout(state.playTimer); clearTimeout(state.speakTimer);
    clearInterval(refreshTimer); clearInterval(tickTimer); document.removeEventListener('visibilitychange', wake);
    for (const timer of state.pulseTimers) clearTimeout(timer); feed.stop(); } };
}

export function startCapital(root = document.querySelector('[data-capital]')) {
  if (!root) return Promise.resolve(null);
  return startPage(root);
}
if (typeof document !== 'undefined' && document.querySelector('[data-capital]')) startCapital();
