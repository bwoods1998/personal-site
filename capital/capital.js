import {
  MAX_EVENT_LIMIT, SCHEMA_VERSION, REAL_BANDS, COMPUTE_PARTS, agentId, validCheckpoint, validPublicEvent, validDisplayName, socketMatches, tapeName,
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

// ---- the reset (Sept 26, 2026, the options swarm)
// The profit basis is the checkpoint's own `performance` block: the Brokerage Account's equity when the
// record started over, and the owner's deposits and withdrawals since. These two constants are the
// fallback while no checkpoint carries one, and the floor under it: a basis dated before the reset is
// never read, so the old record's numbers cannot leak into the new one. The main session sets them at
// deploy time to `league/config.json` `performance` (start_at, start_equity).
export const PERFORMANCE_START_AT = '2026-09-26T06:25:30.000Z';
export const START_EQUITY = '481.65';
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
export const COMPUTE_WORDS = { sail_usd: 'Sail', openai_usd: 'OpenAI', thetadata_usd: 'ThetaData', market_data_usd: 'market data', other_usd: 'other' };
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
// What the swarm has cost since the reset, part by part, and their total only when every part is known.
export function computeSpend(checkpoint) {
  const compute = checkpoint?.compute;
  if (!compute) return { parts: [], total: null };
  const parts = COMPUTE_PARTS.map(part => ({ part, label: COMPUTE_WORDS[part], usd: compute[part] }));
  const known = parts.every(row => numeric(row.usd));
  return { parts, total: known ? decimalOf(parts.reduce((sum, row) => sum + centsOf(row.usd), 0n)) : null };
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
export function mastheadNumbers(checkpoint, now = Date.now()) {
  const profit = tradingProfit(checkpoint, now);
  const started = startedAt(checkpoint);
  const elapsed = started === null ? { main: '—', tick: '' } : runningParts(Math.max(0, (now - started) / 1000));
  return [
    { key: 'profit', label: 'Profit', value: profit === null ? '—' : signedMoney(profit), tone: profit === null ? '' : signOf(profit), title: 'Live options trading P&L, including open positions.' },
    { key: 'clock', label: 'Running', value: elapsed.main, tick: elapsed.tick, tone: '', startedAt: started },
  ];
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
// Recorded balances only: never interpolated, never reset on a loss or a deposit.
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
// The reset's balance, every recorded mark since, and the checkpoint's own reading, in time order.
export function accountSeries(marks, checkpoint) {
  const basis = profitBasis(checkpoint);
  const start = Date.parse(basis.start_at);
  const end = checkpoint ? Date.parse(checkpoint.published_at) : Infinity;
  const points = (Array.isArray(marks) ? marks : []).filter(point => Date.parse(point?.at) >= start && Date.parse(point?.at) <= end);
  points.push({ at: basis.start_at, equity: basis.start_equity });
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
    }));
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
      what: structureText(row.underlying, row.structure), detail: [`${row.legs} ${row.legs === 1 ? 'leg' : 'legs'}`, expiryText(row.expiry), `×${row.quantity}`].filter(Boolean).join(' · '),
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
    ...base, kind: 'trading', agent, name, text: tradeWords(payload), real: payload.real === true,
    pnl: numeric(payload.pnl_usd) ? signedMoney(payload.pnl_usd) : '', tone: signOf(payload.pnl_usd), why: plainNote(payload.why),
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
  const data = await fetchJson(`${apiBase(pageSearch())}/checkpoint`, MAX_CHECKPOINT_BYTES);
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
const moneyTag = real => tagNode(real ? 'real money' : 'shadow', real ? 'real' : 'shadow');
const bandTag = band => tagNode(BAND_WORDS[band] || 'unknown', REAL_BANDS.includes(band) ? 'real' : band === 'retired' ? 'retired' : 'band');
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
function numbersPanel(checkpoint, state) {
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
    if (item.note) value.append(element('span', item.note, 'number-note negative'));
    row.append(element('dt', item.label), value);
    return row;
  });
}
function drawHeroInto(box, state) {
  let hero = heroNote(state.feed, state.hero?.agent || null);
  // A fresh thought gets enough time to be read even if the same agent immediately writes another.
  if (state.hero?.note && Date.now() < state.hero.readUntil) hero = state.hero.note;
  if (!hero) {
    box.replaceChildren(element('p', state.checkpoint ? 'No agent has written a note yet.' : state.asked ? 'Nothing is running right now.' : 'Connecting…', 'empty-state now-empty'));
    state.hero = null;
    return;
  }
  const agent = state.agents.get(hero.agent) || null;
  if (!state.hero || state.hero.agent !== hero.agent) {
    const card = element('article', null, 'now');
    const head = element('div', null, 'now-head');
    const when = element('span', '', 'now-when');
    const name = element('span', '', 'now-name');
    const band = element('span', null, 'now-band');
    head.append(pulse('pulse now-pulse'), name, band, when);
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
      state.hero.readUntil = open ? Infinity : Date.now() + 12000;
      clearTimeout(state.heroTimer);
      if (!open) { state.heroTimer = setTimeout(() => state.drawLive(), 12010); state.heroTimer?.unref?.(); }
    });
    card.append(head, thought, more);
    state.hero = { agent: hero.agent, id: '', parts: { card, when, thought, name, band, more } };
    box.replaceChildren(card);
  }
  const { parts } = state.hero;
  parts.name.textContent = hero.display_name || (agent ? agentName(agent) : titleCase(hero.agent));
  parts.band.replaceChildren(...(agent ? [bandTag(agent.band)] : []));
  const recent = Date.now() - Date.parse(hero.at) < 180000;
  parts.when.textContent = recent ? 'deciding now' : `last note ${ago(hero.at)}`;
  parts.card.className = `now${agent && REAL_BANDS.includes(agent.band) ? ' now-real' : ''}${recent ? '' : ' now-idle'}`;
  if (state.hero.id !== hero.id) {
    state.hero.id = hero.id;
    state.hero.note = hero;
    parts.more.hidden = !truncate(hero.text, NOTE_TEXT_LIMIT).truncated;
    parts.more.setAttribute('aria-expanded', 'false');
    parts.more.textContent = 'Read more';
    parts.thought.className = 'now-thought';
    const readingMs = Math.max(12000, Math.min(45000, hero.text.split(/\s+/).length / 3 * 1000 + 2000));
    state.hero.readUntil = Date.now() + readingMs;
    clearTimeout(state.heroTimer);
    state.heroTimer = setTimeout(() => state.drawLive(), readingMs + 10);
    state.heroTimer?.unref?.();
    typeInto(parts.thought, truncate(hero.text, NOTE_TEXT_LIMIT).text);
  }
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
  body.append(element('span', open && line.why ? `${line.text}: ${line.why}` : line.text, 'feed-words'));
  if (line.pnl) body.append(element('b', line.pnl, `feed-pnl ${line.tone}`.trim()));
  if (line.count > 1) body.append(element('span', `×${line.count}`, 'feed-count'));
  item.append(who, body);
  return item;
}
function drawFeedInto(list, state) {
  const lines = feedLines(state.feed, state.names, { limit: FEED_LINES, skip: [state.hero?.id] });
  const items = lines.map(line => feedItem(line, state, state.primed && !state.rendered.has(line.id)));
  state.rendered = new Set(lines.map(line => line.id));
  state.primed = true;
  list.replaceChildren(...(items.length ? items : [element('li', 'Quiet for now. Lines appear here as the agents decide, trade and are born or retired.', 'empty-state')]));
}
function balanceChart(series) {
  const figure = element('figure', null, `balance balance-${series.tone || 'flat'}`);
  const { width, height } = series;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', class: 'balance-svg',
    role: 'img', 'aria-label': `Brokerage Account balance, ${money(series.first.equity.toFixed(2))} to ${money(series.last.equity.toFixed(2))}.`,
  });
  svg.append(svgElement('path', { d: series.area, class: 'balance-area' }), svgElement('path', { d: series.path, class: 'balance-line' }));
  const cross = svgElement('line', { x1: 0, x2: 0, y1: 0, y2: height, class: 'balance-cross', opacity: 0 });
  svg.append(cross);
  const plot = element('div', null, 'balance-plot');
  const end = element('span', null, 'balance-dot');
  place(end, { left: `${(series.last.x / width * 100).toFixed(2)}%`, top: `${(series.last.y / height * 100).toFixed(2)}%` });
  const readout = element('span', '', 'balance-readout');
  readout.hidden = true;
  plot.append(svg, end, readout);
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
function accountPanel(checkpoint, marks) {
  const series = accountSeries(marks, checkpoint);
  const nodes = series ? [balanceChart(series)] : [];
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
// The three stages of the earlier agent board, driven only by the published band. A Candidate
// stays in practice until the House grants real trading; a dot never implies a future promotion.
export const AGENT_STAGES = [
  { level: 3, label: 'Increased capital', bands: ['sized'] },
  { level: 2, label: 'Live trading', bands: ['probe'] },
  { level: 1, label: 'Practice', bands: ['candidate', 'gym'] },
];
export function agentStages(checkpoint) {
  const rows = swarmRows(checkpoint);
  return AGENT_STAGES.map(stage => ({ ...stage, agents: rows.filter(row => stage.bands.includes(row.band)) }));
}
function agentDetail(row, checkpoint, state) {
  const card = element('article', null, 'agent-detail-card');
  const head = element('div', null, 'agent-detail-head');
  const name = element('h3', row.name);
  const close = element('button', '×', 'agent-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close agent details');
  close.addEventListener('click', () => state.selectAgent(null, row.id));
  head.append(name, bandTag(row.band), close);
  const strategy = element('p', null, 'agent-strategy');
  if (row.structure) strategy.append(element('span', row.structure, 'strategy-tag'));
  strategy.append(element('span', row.full || 'No strategy published yet.'));
  card.append(head, strategy);
  const record = element('p', null, 'agent-record');
  record.setAttribute('title', 'Closed trades and training attempts. Forward results are simulated.');
  record.append(element('span', row.record.main, row.record.tone));
  if (row.record.rest) record.append(element('span', row.record.rest));
  card.append(record);
  const positions = structureRows(checkpoint).filter(position => position.agent === row.id);
  if (positions.length) {
    const list = element('ul', null, 'agent-positions');
    for (const position of positions) {
      const item = element('li');
      item.append(moneyTag(position.real), element('span', `${position.what} · ${position.detail}`),
        element('span', `max loss ${position.maxLoss}`), element('span', position.pnl, position.tone));
      list.append(item);
    }
    card.append(list);
  }
  return card;
}
function agentsPanel(checkpoint, state) {
  const board = element('div', null, 'agent-board');
  const rows = swarmRows(checkpoint);
  const details = element('div', null, 'agent-detail');
  details.id = 'agent-detail';
  details.setAttribute('aria-live', 'polite');
  board.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.selectedAgent) { event.preventDefault(); state.selectAgent(null, state.selectedAgent); }
  });
  const buttons = new Map();
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
      const button = element('button', null, `agent-dot dot-${row.band}`);
      button.type = 'button';
      button.dataset.agent = row.id;
      button.setAttribute('aria-label', `${row.name} · ${row.bandText} · ${row.structure || 'strategy pending'}`);
      button.setAttribute('aria-controls', details.id);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('title', `${row.name} · ${row.bandText}`);
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
    const section = element('section', null, `agent-stage stage-${stage.level}`);
    const heading = element('h3', null, 'stage-heading');
    heading.id = `agent-stage-${stage.level}`;
    heading.append(element('span', String(stage.level), 'stage-level'), element('span', stage.label, 'stage-label'),
      element('span', String(stage.agents.length), 'stage-count'));
    section.setAttribute('aria-labelledby', heading.id);
    section.append(heading, dots(stage.agents, section));
    board.append(section);
  }
  const retired = rows.filter(row => row.band === 'retired');
  if (retired.length) {
    const archive = element('details', null, 'agents-retired');
    archive.open = state.showRetired;
    archive.addEventListener('toggle', () => { state.showRetired = archive.open; });
    archive.append(element('summary', `${retired.length} retired`), dots(retired, archive));
    board.append(archive);
  }
  board.append(details);
  state.selectAgent(state.selectedAgent);
  return [board];
}

async function startPage(root) {
  const find = id => root.querySelector(`#${id}`);
  const box = {
    numbers: find('floor-numbers'), status: find('floor-status'), now: find('floor-now'), feed: find('floor-feed'),
    account: find('floor-account'), agents: find('floor-agents'),
  };
  const state = {
    checkpoint: null, agents: new Map(), names: new Map(), feed: [], marks: [], mode: 'loading',
    hero: null, rendered: new Set(), primed: false, expanded: new Set(), selectedAgent: null, showRetired: false, clock: null,
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
    if (focusedAgent) box.agents?.querySelector(`[data-agent="${focusedAgent}"]`)?.focus?.({ preventScroll: true });
    else if (focusedClose) box.agents?.querySelector('.agent-close')?.focus?.({ preventScroll: true });
  };
  const drawMoney = () => {
    if (!state.checkpoint) return;
    drawn(box.numbers, numbersPanel(state.checkpoint, state));
    drawn(box.account, accountPanel(state.checkpoint, state.marks));
  };
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
      drawMoney();
      state.drawAgents();
      if (state.primed) drawLive();
    } catch {
      if (state.checkpoint) return;
      // Nothing published yet, or the record cannot be reached: the numbers keep their dashes and
      // every section says plainly that it is empty.
      ready(box.numbers);
      drawn(box.account, [element('p', 'No balance has been published yet.', 'empty-state')]);
      drawn(box.agents, [element('p', 'Waiting for the agents.', 'empty-state')]);
    } finally {
      state.asked = true;
      // Every refresh re-reads the status: a fresh checkpoint turns the word to live, and the last one
      // held turns it to stopped once it is older than the window.
      drawStatus();
      if (state.checkpoint) drawn(box.numbers, numbersPanel(state.checkpoint, state));
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
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
      if (live.length) { keepFeed(live); drawLive(); }
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
  return { ...feed, stop() { clearTimeout(state.followUp); clearTimeout(state.heroTimer); feed.stop(); } };
}

export function startCapital(root = document.querySelector('[data-capital]')) {
  if (!root) return Promise.resolve(null);
  return startPage(root);
}
if (typeof document !== 'undefined' && document.querySelector('[data-capital]')) startCapital();
