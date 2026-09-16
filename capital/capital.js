import {
  EVENT_KINDS, MAX_EVENT_LIMIT, deskId, deskMode, isLive,
  validCheckpoint, validDesk, validPublicEvent, socketMatches,
} from './schema.js';

// Long Term Capital Management's own record, rendered from text nodes only. Prices are the floor's
// fills and marks; the page never contacts a quote vendor and never starts work on a desk.
const API = '/api/capital';
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 512 * 1024;
const MAX_SOCKET_MESSAGE = 64 * 1024;
const TAPE_LIMIT = 120;
const TAPE_TEXT_LIMIT = 140;
const SPARK_POINTS = 40;
// The floor's own balance marks: kind, payload field, and how many of them the page holds.
const FLOOR_MARK = { kind: 'floor.mark', field: 'account_equity' };
const FLOOR_MARK_LIMIT = 200;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 100000000n;
const REPOSITORY = 'https://github.com/bwoods1998/long-term-capital-management';
const responseCache = new Map();
const STREAM_LABELS = { risk: 'Risk engine', committee: 'Meriwether', evolution: 'Evolution', lab: 'Lab', ops: 'Ops' };

// The partners the runtime publishes, with the human behind each surname. Page copy only: the
// numbers, the thinking and the orders all come from the published checkpoint and event log.
export const PARTNERS = {
  merton: {
    surname: 'Merton', first: 'Robert', role: 'filings, long horizon', via: 'Alpaca',
    mandate: 'Reads filings and holds for quarters rather than days. Concentrated, unlevered, and slow to change its mind.',
  },
  rosenfeld: {
    surname: 'Rosenfeld', first: 'Eric', role: 'earnings drift', via: 'DeepSeek',
    mandate: 'Buys the drift after an earnings surprise and leaves when the drift stops paying.',
  },
  hawkins: {
    surname: 'Hawkins', first: 'Greg', role: 'earnings drift', via: 'Kimi',
    mandate: 'The same drift mandate as Rosenfeld, run by a different model, so the family can be scored against itself.',
  },
  krasker: {
    surname: 'Krasker', first: 'William', role: 'earnings drift', via: 'GLM',
    mandate: 'The same drift mandate as Rosenfeld, run by a different model, so the family can be scored against itself.',
  },
  mullins: {
    surname: 'Mullins', first: 'David', role: 'Fed & economic events', via: 'Kalshi',
    mandate: 'Prices Fed decisions and economic releases as event contracts, sized to the edge it can argue for.',
  },
  hilibrand: {
    surname: 'Hilibrand', first: 'Lawrence', role: 'BTC and ETH', via: 'Coinbase',
    mandate: 'Trades BTC and ETH on trend and funding, and holds no position it cannot explain.',
  },
};
export const PARTNER_ORDER = ['merton', 'rosenfeld', 'hawkins', 'krasker', 'mullins', 'hilibrand'];

// One chip per family of events. Every published kind belongs to exactly one.
export const TAPE_FILTERS = [
  { key: 'thoughts', label: 'thoughts' },
  { key: 'trades', label: 'trades' },
  { key: 'risk', label: 'risk' },
  { key: 'committee', label: 'committee' },
  { key: 'evolution', label: 'evolution' },
];
const FILTER_GROUPS = {
  thoughts: ['desk.session_started', 'desk.thought', 'desk.tool_call', 'desk.tool_result', 'desk.memo', 'desk.postmortem', 'desk.session_ended',
    'desk.watch', 'desk.forecast', 'desk.code_run'],
  trades: ['desk.intent', 'broker.order', 'broker.fill', 'broker.reconciled', 'ledger.mark', 'floor.mark', 'desk.outcome', 'desk.exit_plan'],
  risk: ['risk.decision', 'risk.review', 'risk.breaker', 'ops.alert', 'ops.budget'],
  committee: ['committee.allocation', 'committee.memo', 'committee.gate'],
  evolution: ['evolution.spawned', 'evolution.retired', 'evolution.promoted', 'evolution.founded', 'desk.playbook_updated', 'lab.hypothesis', 'lab.result',
    'lab.calibration', 'lab.experiment', 'lab.verdict'],
};
const GROUP_OF_KIND = Object.fromEntries(Object.entries(FILTER_GROUPS).flatMap(([group, kinds]) => kinds.map(kind => [kind, group])));
// A glyph per tone, so a line reads at a glance without another typeface or an image request.
const TONE_ICONS = {
  thought: '~', tool: '>', memo: '¶', order: '→', fill: '●', mark: '=', risk: '!',
  committee: '§', evolution: '*', lab: '?', ops: '·', session: '○', playbook: '¶', watch: '◉', forecast: '%',
};
// Sail's model profiles, as a visitor would name them. Unknown profiles keep the runtime's id.
const PROFILE_NAMES = [
  ['pro', 'DeepSeek V4 Pro'], ['flash', 'DeepSeek V4 Flash'], ['kimi', 'Kimi K2.6'], ['k3', 'Kimi K3'],
  ['glm_flash', 'GLM-5.3 Flash'], ['glm', 'GLM-5.3'], ['oss', 'gpt-oss-120b'],
];
export function profileName(value) {
  const id = typeof value === 'string' ? value : '';
  const found = PROFILE_NAMES.find(([prefix]) => id === prefix || id.startsWith(`${prefix}_`));
  return found ? found[1] : id;
}
// "price_move" reads as "price move"; the runtime's ids are for the log, not the page.
const humanize = value => (typeof value === 'string' ? value.replace(/[_:]+/g, ' ').trim() : '');
// An instrument is published as {symbol, asset_class, venue}; older events carried a string.
export function instrumentLabel(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) return typeof value.symbol === 'string' ? value.symbol : '';
  return '';
}
// A probability as the desk stated it: "0.93" reads as 93%.
export function probabilityText(value) {
  if (typeof value !== 'string' || !/^(?:0|1)(?:\.\d{1,8})?$/.test(value)) return '—';
  return `${Math.round(Number(value) * 100)}%`;
}
// Event contracts trade in cents, coins in dollars: four places under a dollar, two above.
export const priceText = value => (typeof value === 'string' && /^-?\d/.test(value) && Math.abs(Number(value)) < 1 ? money(value, 4) : money(value, 2));

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
export function money(value, places = 2) {
  if (!numeric(value)) return '—';
  const amount = rounded(value, places);
  const unit = 10n ** BigInt(places);
  const whole = (amount.value / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = places ? `.${(amount.value % unit).toString().padStart(places, '0')}` : '';
  return `${amount.negative ? '−' : ''}$${whole}${fraction}`;
}
export function percent(value, suffix = '%') {
  if (!numeric(value)) return '—';
  const amount = rounded(value, 2);
  const sign = amount.negative ? '−' : amount.value > 0n ? '+' : '';
  return `${sign}${amount.value / 100n}.${(amount.value % 100n).toString().padStart(2, '0')}${suffix}`;
}
export function signOf(value) {
  if (!numeric(value)) return '';
  const amount = scaled(value);
  return amount > 0n ? 'positive' : amount < 0n ? 'negative' : '';
}
// Today's number carries its sign either way, so a green day and a red day read the same shape.
export function signedMoney(value, places = 0) {
  const amount = money(value, places);
  return amount !== '—' && signOf(value) === 'positive' ? `+${amount}` : amount;
}
function date(value, style = 'datetime') {
  const options = style === 'clock'
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
    : style === 'hm' ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : style === 'day' ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }).format(new Date(value));
}
function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined && content !== null) node.textContent = content;
  if (className) node.className = className;
  return node;
}
function link(label, href, className) {
  const node = element('a', label, className);
  node.href = href;
  return node;
}
function timeNode(value, style) {
  const node = element('time', date(value, style));
  node.dateTime = value;
  return node;
}
function metric(label, value, tone, note) {
  const row = element('div');
  row.append(element('dt', label));
  const result = element('dd', value);
  if (tone) result.className = tone;
  if (note) result.append(element('span', note, 'metric-note'));
  row.append(result);
  return row;
}
function facts(entries) {
  const list = element('dl', null, 'facts');
  for (const [label, value] of entries) list.append(element('dt', label), element('dd', value));
  return list;
}
function svgElement(tag, attributes, content) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content) node.textContent = content;
  return node;
}
function table(columns, rows, className = 'data-table') {
  const node = element('table', null, className);
  const head = element('thead');
  const header = element('tr');
  for (const column of columns) header.append(element('th', column));
  head.append(header);
  const body = element('tbody');
  for (const row of rows) {
    const line = element('tr');
    for (const cell of row) line.append(typeof cell === 'string' ? element('td', cell) : cell);
    body.append(line);
  }
  node.append(head, body);
  return node;
}

const show = value => typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
const join = (...parts) => parts.map(part => (part === null || part === undefined ? '' : String(part))).filter(Boolean).join(' · ');
const quantity = value => show(value) || '—';
const deskHref = id => `/capital/desk/?id=${encodeURIComponent(id)}`;

// Page copy for a published desk. An unknown or bred desk keeps the name the runtime gave it.
export function partnerOf(desk) {
  const id = typeof desk === 'string' ? desk : show(desk?.id);
  const family = typeof desk === 'string' ? '' : show(desk?.family);
  const known = PARTNERS[id] || PARTNERS[family] || PARTNERS[id.split('-')[0]] || null;
  const name = typeof desk === 'string' ? '' : show(desk?.name);
  if (!known) {
    // A desk the partner table does not know (Scholes, Haghani, anything the lab breeds later)
    // still gets a name: the id's base capitalised, a numeric suffix read as its generation,
    // and a name that already carries the numeral is not given it twice.
    const dash = id.lastIndexOf('-');
    const numbered = dash > 0 && /^\d+$/.test(id.slice(dash + 1));
    const base = numbered ? id.slice(0, dash) : id;
    const generation = numbered ? Number(id.slice(dash + 1)) : 0;
    const surname = (name ? name.replace(/\s+[IVXLCDM]+$/, '') : '') || (base ? base[0].toUpperCase() + base.slice(1) : id);
    return { id, surname, first: '', role: '', via: '', mandate: '', variant: generation > 1 ? roman(generation) : '' };
  }
  // A bred desk keeps the partner's name and carries the runtime's own suffix beside it.
  const base = known.surname.toLowerCase();
  const variant = id === base ? '' : id.startsWith(`${base}-`) ? id.slice(base.length + 1) : id;
  return { id, ...known, variant };
}
export const partnerName = id => { const partner = partnerOf(id); return partner.variant ? `${partner.surname} ${partner.variant}` : partner.surname; };
export function partnerRole(partner) {
  return join(partner.first, partner.role, partner.via);
}
export function streamLabel(stream) {
  if (typeof stream !== 'string') return '';
  if (!stream.includes(':')) return STREAM_LABELS[stream] || stream;
  const [family, id] = [stream.slice(0, stream.indexOf(':')), stream.slice(stream.indexOf(':') + 1)];
  return family === 'desk' || family === 'ledger' ? partnerName(id) : `${id} ${family}`;
}
// The six founding partners lead; anything the floor breeds follows in published order.
export function orderDesks(desks) {
  const list = Array.isArray(desks) ? desks : [];
  const rank = desk => {
    const index = PARTNER_ORDER.indexOf(show(desk?.id));
    return index === -1 ? PARTNER_ORDER.length + Math.max(PARTNER_ORDER.indexOf(show(desk?.family)), 0) : index;
  };
  return list.map((desk, index) => ({ desk, index })).sort((left, right) => {
    const compared = rank(left.desk) - rank(right.desk);
    return compared === 0 ? left.index - right.index : compared;
  }).map(entry => entry.desk);
}
export const filterGroup = kind => GROUP_OF_KIND[kind] || null;
// What a first-time visitor should see scroll by: thinking, decisions and money. The plumbing
// (tool calls, marks, budgets, gates, the night desk's passes) is one toggle away.
export const INTERESTING_KINDS = new Set([
  'desk.thought', 'desk.memo', 'desk.forecast', 'desk.watch', 'desk.intent', 'desk.postmortem', 'desk.outcome',
  'desk.exit_plan', 'desk.code_run', 'desk.playbook_updated', 'risk.decision', 'risk.review', 'risk.breaker',
  'broker.order', 'broker.fill', 'committee.allocation', 'committee.memo',
  'evolution.spawned', 'evolution.retired', 'evolution.promoted', 'lab.experiment', 'lab.verdict',
]);
export function isInteresting(event) {
  if (!INTERESTING_KINDS.has(event?.kind)) return false;
  if (event.kind === 'desk.watch') return event.payload?.decision === 'wake';
  return true;
}
// Chips are inclusive. Turning every chip off reads as no filter rather than an empty page.
export function matchesFilters(event, active) {
  const group = filterGroup(event?.kind);
  if (!group || !(active instanceof Set) || active.size === 0) return true;
  return active.has(group);
}
export function truncate(value, max = TAPE_TEXT_LIMIT) {
  const full = show(value).replace(/\s+/g, ' ').trim();
  if (full.length <= max) return { text: full, full, truncated: false };
  return { text: full.slice(0, max).replace(/\s+\S*$/, '') + '…', full, truncated: true };
}

const DETAILS = {
  'desk.session_started': p => triggerText(p.trigger, 'sat down'),
  'desk.thought': p => show(p.text),
  'desk.tool_call': p => join(`asked ${humanize(show(p.tool)) || 'a tool'}`, summarizeArguments(p.arguments)),
  'desk.tool_result': p => join(`${humanize(show(p.tool)) || 'the tool'} answered`, show(p.summary)),
  'desk.memo': p => join(`wrote "${show(p.title)}"`, show(p.text)),
  'desk.intent': p => join(`proposed ${orderWords(p)}`.trim(), p.limit_price ? `at ${priceText(show(p.limit_price))}` : show(p.order_type) === 'market' ? 'at market' : '', show(p.rationale)),
  'desk.playbook_updated': p => join(`rewrote its playbook${p.version ? ` (v${show(p.version)})` : ''}`, show(p.reason)),
  'desk.postmortem': p => join('post-mortem', show(p.text)),
  'desk.outcome': p => join(`${show(p.market_id) || instrumentLabel(p.instrument)} ${p.result ? `resolved ${show(p.result)}` : 'closed'}`.trim(), p.pnl ? `P&L ${signedMoney(show(p.pnl), 2)}` : '', p.held_for_hours === undefined ? '' : `held ${show(p.held_for_hours)}h`),
  'desk.session_ended': p => join(`ended${show(p.reason) === 'end_session' || !show(p.reason) ? '' : ` (${humanize(show(p.reason))})`}`, p.requests === undefined ? '' : `${show(p.requests)} model calls`, p.cost_usd ? money(show(p.cost_usd), 2) : ''),
  'risk.decision': p => join(`${p.approved === true ? 'approved' : p.approved === false ? 'blocked' : 'judged'} ${partnerName(show(p.desk_id))}'s order`, Array.isArray(p.reasons) ? p.reasons.map(show).filter(Boolean).join('; ') : ''),
  'risk.review': p => join(`${show(p.verdict) === 'block' ? 'blocked' : show(p.verdict) === 'approve' ? 'cleared' : show(p.verdict)} ${partnerName(show(p.desk_id))}'s order`, show(p.reason)),
  'risk.breaker': p => join(`breaker ${show(p.action) || 'tripped'}`, show(p.scope), show(p.rule), show(p.detail)),
  'broker.order': p => join(p.purpose === 'exit' ? `exit${p.exit_reason ? ` on ${humanize(show(p.exit_reason))}` : ''}` : 'order', show(p.status), p.filled_quantity === undefined ? '' : `filled ${quantity(p.filled_quantity)}`, p.average_price ? `at ${priceText(show(p.average_price))}` : ''),
  'broker.fill': p => join(`${fillVerb(p.side)} ${quantity(p.quantity)} ${instrumentLabel(p.instrument)}`.trim(), p.price ? `at ${priceText(show(p.price))}` : '', p.fee ? `fee ${money(show(p.fee), 2)}` : ''),
  'broker.reconciled': p => join(`${venueLabel(p.venue)} reconciled`, p.matches === undefined ? '' : `${show(p.matches)} matched`, Array.isArray(p.mismatches) && p.mismatches.length ? `${p.mismatches.length} mismatched` : ''),
  'ledger.mark': p => join(p.equity ? `marked ${money(show(p.equity))}` : 'marked', p.daily_pnl && show(p.daily_pnl) !== '0' ? `day ${signedMoney(show(p.daily_pnl), 2)}` : '', Array.isArray(p.positions) && p.positions.length ? `${p.positions.length} open` : ''),
  'floor.mark': p => join(p.account_equity ? `balance ${money(show(p.account_equity))}` : 'balance',
    Array.isArray(p.venues) ? p.venues.map(row => `${venueLabel(row?.venue)} ${money(show(row?.equity), 2)}${row?.stale === true ? ' (stale)' : ''}`).join(', ') : ''),
  'committee.allocation': p => {
    const allocations = p.allocations && typeof p.allocations === 'object' ? Object.entries(p.allocations) : [];
    return join(`funded ${allocations.length} desk${allocations.length === 1 ? '' : 's'}`, allocations.slice(0, 3).map(([id, usd]) => `${partnerName(id)} ${money(show(usd), 0)}`).join(', '));
  },
  'committee.memo': p => join(`wrote the ${show(p.period)} memo`, show(p.text)),
  'committee.gate': p => join(`${partnerName(show(p.desk_id))} ${p.passed === true ? 'passed' : p.passed === false ? 'did not pass' : 'faced'} gate ${show(p.gate)}`),
  'evolution.spawned': p => join(`bred ${partnerName(show(p.desk_id))}${p.parent_id ? ` from ${partnerName(show(p.parent_id))}` : ''}`, mutationWords(p.mutation)),
  'evolution.retired': p => join(`retired ${partnerName(show(p.desk_id))}`, show(p.reason)),
  'evolution.promoted': p => join(`promoted ${partnerName(show(p.desk_id))} to real money`, show(p.venue) ? `on ${venueLabel(p.venue)}` : ''),
  'lab.hypothesis': p => join(show(p.text), show(p.test_plan)),
  'lab.result': p => join(show(p.verdict), show(p.hypothesis_id)),
  'desk.watch': p => join(`${humanize(show(p.trigger))}: ${p.decision === 'wake' ? 'woke the desk' : p.decision === 'ignore' ? 'let it pass' : show(p.decision)}`, show(p.detail), show(p.reason)),
  'desk.forecast': p => join(`puts ${probabilityText(p.probability)} on ${show(p.market)}${p.side ? ` ${show(p.side)}` : ''}`, numeric(p.market_price) ? `market ${probabilityText(p.market_price)}` : '', show(p.reasoning)),
  'desk.exit_plan': p => join(`exit plan for ${instrumentLabel(p.instrument)}`, p.target_price ? `target ${priceText(show(p.target_price))}` : '', p.stop_price ? `stop ${priceText(show(p.stop_price))}` : '',
    p.time_stop_at ? `out by ${date(p.time_stop_at)}` : '', p.venue_native === true ? 'held at the venue' : Array.isArray(p.order_ids) && p.order_ids.length ? `${p.order_ids.length} exit order${p.order_ids.length === 1 ? '' : 's'} resting` : 'the floor enforces it'),
  'desk.code_run': p => join(`ran code${numeric(p.seconds) ? ` in ${p.seconds}s` : ''}${p.exit_code === 0 || p.exit_code === undefined ? '' : ` (exit ${show(p.exit_code)})`}`, show(p.purpose), truncate(show(p.stdout).split('\n')[0], 120).text),
  'lab.calibration': p => join(`${p.scope === 'desk' ? partnerName(show(p.desk_id)) : p.scope === 'family' ? `the ${show(p.family)} family` : 'the floor'} scored`, `${show(p.n)} forecast${show(p.n) === '1' ? '' : 's'}`, `Brier ${show(p.brier)}`),
  'lab.experiment': p => join(`${show(p.status)}: ${show(p.hypothesis)}`, p.variant_desk_id ? `as ${partnerName(show(p.variant_desk_id))}` : ''),
  'lab.verdict': p => join(`${show(p.status)} ${show(p.experiment_id)}`, show(p.reason)),
  'ops.alert': p => join(show(p.level), show(p.text)),
  'ops.budget': p => (p.mode
    ? join(`credit ${numeric(p.balance_usd) ? money(show(p.balance_usd), 0) : 'unread'}`, numeric(p.runway_days) ? `${Math.floor(Number(p.runway_days))} days of runway` : '', show(p.mode), p.spent_usd ? `${money(show(p.spent_usd), 2)} spent today` : '')
    : join(show(p.scope), p.spent_usd ? `${money(show(p.spent_usd), 2)} of ${money(show(p.cap_usd), 2)}` : '')),
};
// "buy 10 KXFED yes" reads as words: bought, sold; a sell of a YES contract stays a sale.
const fillVerb = side => (show(side) === 'buy' ? 'bought' : show(side) === 'sell' ? 'sold' : show(side));
const orderWords = p => `${show(p.side)} ${quantity(p.quantity)} ${instrumentLabel(p.instrument)}`;
function mutationWords(mutation) {
  if (typeof mutation === 'string') return mutation;  // the first generation wrote it as prose
  return mutationBadges(mutation).map(badge => badge.text).slice(0, 3).join(', ');
}
// The reason a desk sat down, in words. "cadence:13:30" is a slot; "watch:price_move" a wake.
export function triggerText(trigger, verb = 'sat down') {
  const value = show(trigger);
  if (!value) return verb === 'sat down' ? 'in session' : verb;
  if (value.startsWith('cadence:')) return `${verb} for the ${value.slice(8)} slot`;
  if (value === 'postmortem') return 'writing its post-mortem';
  if (value === 'event_resolution') return 'woke because a market resolved';
  if (value.startsWith('watch:')) return `woke on a ${humanize(value.slice(6))}`;
  return `${verb}: ${humanize(value)}`;
}
function summarizeArguments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return show(value);
  return Object.entries(value).slice(0, 4).map(([key, item]) => `${key}=${show(item) || (Array.isArray(item) ? `[${item.length}]` : '{…}')}`).join(' ');
}
function fallbackDetail(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return Object.entries(payload).slice(0, 4).map(([key, value]) => `${key}: ${show(value) || (Array.isArray(value) ? `${value.length} items` : '…')}`).join(' · ');
}
// One tape line per event. Pure: the same event always reads the same way.
export function tapeLine(event) {
  const kind = EVENT_KINDS[event?.kind] || { label: event?.kind || 'Event', tone: 'ops' };
  const payload = event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
  let detail = '';
  try { detail = DETAILS[event?.kind]?.(payload) || ''; } catch { detail = ''; }
  return {
    label: kind.label, tone: kind.tone, icon: TONE_ICONS[kind.tone] || '·', group: filterGroup(event?.kind),
    source: streamLabel(event?.stream), text: detail || fallbackDetail(payload), at: event?.at, stream: event?.stream,
  };
}

// A published mark series, read as points: a desk's own `ledger.mark`, or the floor's
// `floor.mark`, which carries the real account balance instead of the ledger's equity.
function markPoints(events, { kind = 'ledger.mark', field = 'equity' } = {}) {
  return (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === kind)
    .map(event => ({ at: Date.parse(event.at), equity: Number(event.payload?.[field]) }))
    .filter(point => Number.isFinite(point.at) && Number.isFinite(point.equity))
    .sort((left, right) => left.at - right.at);
}
// Equity from the desk's own marks. No interpolation, no generated points.
export function markSeries(events, selector) {
  const points = markPoints(events, selector);
  if (points.length < 2) return null;
  const values = points.map(point => point.equity);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= Math.abs(min) * 0.01 + 1; max += Math.abs(max) * 0.01 + 1; }
  const padding = (max - min) * 0.12;
  min -= padding;
  max += padding;
  const span = points.at(-1).at - points[0].at || 1;
  const x = at => 2 + (at - points[0].at) / span * 746;
  const y = value => 14 + (max - value) / (max - min) * 160;
  return {
    path: points.map((point, index) => `${index ? 'L' : 'M'}${x(point.at).toFixed(2)},${y(point.equity).toFixed(2)}`).join(' '),
    min, max, points, first: points[0], last: points.at(-1),
    ticks: [max, (max + min) / 2, min].map(value => ({ value, y: y(value) })),
  };
}
// The card line: the newest forty marks, scaled to their own range.
export function sparkline(events, { width = 148, height = 34, limit = SPARK_POINTS, selector } = {}) {
  const points = markPoints(events, selector).slice(-limit);
  if (points.length < 2) return null;
  const values = points.map(point => point.equity);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const span = points.at(-1).at - points[0].at || 1;
  const x = at => 1 + (at - points[0].at) / span * (width - 2);
  const y = value => height - 3 - (value - min) / (max - min) * (height - 6);
  return {
    width, height, points, first: points[0], last: points.at(-1),
    path: points.map((point, index) => `${index ? 'L' : 'M'}${x(point.at).toFixed(2)},${y(point.equity).toFixed(2)}`).join(' '),
    direction: points.at(-1).equity >= points[0].equity ? 'positive' : 'negative',
  };
}
// The newest playbook rewrite, with the diff the desk wrote for itself.
export function latestPlaybook(events) {
  const latest = (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === 'desk.playbook_updated')
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at)).at(-1);
  if (!latest) return null;
  return {
    at: latest.at, version: show(latest.payload?.version),
    reason: show(latest.payload?.reason), diff: latest.payload?.diff ?? null,
  };
}
// A unified diff, line by line, so the page can colour it without parsing markup.
export function diffLines(value, limit = 200) {
  const lines = Array.isArray(value) ? value.map(show) : show(value).split('\n');
  return lines.slice(0, limit).map(line => ({
    text: line,
    type: /^(?:\+\+\+|---|@@|diff |index )/.test(line) ? 'meta'
      : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'same',
  }));
}
export function lineage(events, id) {
  return (Array.isArray(events) ? events : [])
    .filter(event => typeof event?.kind === 'string' && event.kind.startsWith('evolution.')
      && (event.payload?.desk_id === id || event.payload?.parent_id === id))
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
    .map(event => ({
      at: event.at,
      kind: event.kind,
      label: EVENT_KINDS[event.kind]?.label || event.kind,
      text: event.payload?.desk_id === id ? tapeLine(event).text : `${show(event.payload?.desk_id)} spawned from this desk`,
    }));
}
export function bookRows(marks) {
  const latest = (Array.isArray(marks) ? marks : []).filter(event => event?.kind === 'ledger.mark').at(-1);
  const positions = Array.isArray(latest?.payload?.positions) ? latest.payload.positions : [];
  return positions.filter(position => position && typeof position === 'object' && !Array.isArray(position)).map(position => ({
    instrument: show(position.instrument) || show(position.symbol) || '—',
    quantity: quantity(position.quantity),
    price: show(position.price),
    value: show(position.market_value) || show(position.value),
  }));
}
export function fillRows(events, id = null) {
  const fills = (Array.isArray(events) ? events : []).filter(event => event?.kind === 'broker.fill');
  const attributed = fills.filter(event => event.payload?.desk_id === id);
  // Fills carry a desk id when the publisher records one; otherwise the floor blotter is shown.
  const selected = id === null || !fills.some(event => 'desk_id' in (event.payload || {})) ? fills : attributed;
  return selected.sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).map(event => ({
    at: event.at,
    venue: streamLabel(event.stream),
    instrument: show(event.payload?.instrument) || '—',
    side: show(event.payload?.side) || '—',
    quantity: quantity(event.payload?.quantity),
    price: show(event.payload?.price),
    fee: show(event.payload?.fee),
  }));
}
// Meriwether's allocation rounds, newest first, over the desks he has funded.
export function allocationSeries(events, limit = 12) {
  const rows = (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === 'committee.allocation'
      && event.payload?.allocations && typeof event.payload.allocations === 'object' && !Array.isArray(event.payload.allocations))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, limit)
    .map(event => ({ at: event.at, amounts: event.payload.allocations }));
  const desks = [...new Set(rows.flatMap(row => Object.keys(row.amounts)))].slice(0, 8);
  return { desks, rows };
}
export function streamUrl(streams, location) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const selection = Array.isArray(streams) && streams.length && !streams.includes('all') ? `?streams=${encodeURIComponent(streams.join(','))}` : '';
  return `${protocol}//${location.host}${API}/stream${selection}`;
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
  const data = await fetchJson(`${API}/events?${params}`);
  if (data?.schema_version !== 1 || !Array.isArray(data.events) || data.events.length > MAX_EVENT_LIMIT || !data.events.every(validPublicEvent)) throw new Error('Invalid tape.');
  return data;
}
async function loadCheckpoint() {
  const data = await fetchJson(`${API}/checkpoint`, MAX_CHECKPOINT_BYTES);
  if (!validCheckpoint(data)) throw new Error('Invalid checkpoint.');
  return data;
}
async function loadDesk(id) {
  const data = await fetchJson(`${API}/desks/${encodeURIComponent(id)}`, MAX_CHECKPOINT_BYTES);
  if (!validDesk(data, data?.updated_at) || data.id !== id) throw new Error('Invalid desk record.');
  return data;
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
      const selections = streams.includes('all') ? [null] : streams;
      const batches = await Promise.all(selections.map(stream => loadEvents({ stream, after: latest, limit: 100 })));
      const events = fresh(batches.flatMap(batch => batch.events).sort((left, right) => left.seq - right.seq));
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

function diffBlock(value) {
  const block = element('pre', null, 'diff');
  for (const line of diffLines(value)) block.append(element('span', line.text || ' ', `diff-line diff-${line.type}`));
  return block;
}
function tapeEntry(event, state) {
  const line = tapeLine(event);
  const entry = element('div', null, `tape-entry tone-${line.tone}`);
  entry.append(timeNode(line.at, 'clock'));
  const who = element('span', null, 'tape-who');
  const onDesk = typeof line.stream === 'string' && line.stream.startsWith('desk:');
  who.append(onDesk ? link(line.source, deskHref(line.stream.slice(5))) : element('span', line.source));
  const icon = element('span', line.icon, 'tape-icon');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', line.label);
  icon.setAttribute('title', line.label);
  const body = element('div', null, 'tape-body');
  const cut = truncate(line.text, TAPE_TEXT_LIMIT);
  if (cut.truncated && state) {
    const open = state.expanded.has(event.id);
    const button = element('button', open ? cut.full : cut.text, 'tape-text tape-expand');
    button.type = 'button';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.addEventListener('click', () => {
      if (state.expanded.has(event.id)) state.expanded.delete(event.id);
      else state.expanded.add(event.id);
      state.redraw();
    });
    body.append(button);
  } else body.append(element('span', cut.text, 'tape-text'));
  if (event?.kind === 'desk.playbook_updated' && event.payload?.diff) body.append(diffBlock(event.payload.diff));
  entry.append(who, icon, body);
  return entry;
}
// The default tape (desk and loop pages): what a visitor came for. Thoughts and the questions the
// partners ask their tools; the real desks' orders, fills, exits and outcomes. Shadow desks'
// quotes, tool answers and code runs are one toggle away, not on the first screen.
const QUIET_BY_DEFAULT = new Set(['desk.code_run', 'desk.tool_result']);
const MONEY_KINDS = new Set(['desk.intent', 'broker.order', 'broker.fill', 'desk.exit_plan', 'desk.outcome']);
export function tapeDefault(event, state) {
  // A tool call is the partner's research question, and research is what the visitor came to see.
  if (!(event?.kind === 'desk.tool_call' || isInteresting(event)) || !matchesFilters(event, state?.active)) return false;
  if (QUIET_BY_DEFAULT.has(event?.kind)) return false;
  if (MONEY_KINDS.has(event?.kind) && state?.liveIds instanceof Set && state.liveIds.size) {
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    if (payload.shadow === true) return false;
    const desk = typeof event.stream === 'string' && event.stream.startsWith('desk:') ? event.stream.slice(5) : show(payload.desk_id);
    if (desk && !state.liveIds.has(desk)) return false;
  }
  return true;
}
function renderTape(target, events, state) {
  const selected = [...events]
    .filter(event => !state || (state.everything ? true : tapeDefault(event, state)))
    .sort((left, right) => right.seq - left.seq)
    .slice(0, TAPE_LIMIT);
  const entries = selected.map(event => tapeEntry(event, state));
  target.replaceChildren(...(entries.length ? entries : [element('p', events.length ? 'Quiet. The next thought appears here.' : 'Nothing published yet.', 'empty-state')]));
  target.setAttribute('aria-busy', 'false');
}
function statusLine(target, mode, publishedAt) {
  const state = element('span', mode === 'live' ? 'Live · streaming' : mode === 'polling' ? 'Live · reconnecting' : 'Loading', mode === 'live' ? 'status-live' : 'status-polling');
  const published = element('span', 'Checkpoint ');
  if (publishedAt) published.append(timeNode(publishedAt));
  else published.textContent = 'Awaiting first checkpoint';
  target.replaceChildren(state, published);
}
function sparkFigure(marks) {
  const series = sparkline(marks);
  if (!series) return element('span', 'equity line starts at the second mark', 'spark-empty');
  const svg = svgElement('svg', {
    viewBox: `0 0 ${series.width} ${series.height}`, preserveAspectRatio: 'none', class: `spark spark-${series.direction}`,
    role: 'img', 'aria-label': `Equity over the desk's last ${series.points.length} marks.`,
  });
  svg.append(svgElement('path', { d: series.path, class: 'spark-line' }));
  return svg;
}

// Live carries a pulsing dot; shadow is muted and says so. The two never look alike.
export function modeBadge(desk) {
  const mode = deskMode(desk?.mode);
  const badge = element('span', null, `badge badge-${mode}`);
  if (mode === 'live') {
    const dot = element('span', null, 'badge-dot');
    dot.setAttribute('aria-hidden', 'true');
    badge.append(dot);
  }
  badge.append(element('span', mode));
  badge.setAttribute('title', mode === 'live'
    ? 'Trading real money on a live venue.'
    : 'Orders are scored against real prices and never sent. Competing for a live sleeve.');
  return badge;
}

// ------------------------------------------------- the accounts the money actually sits in
// `live_equity` is the ledger's number, and it is what attributes a gain to a desk. This is what
// Kalshi and Coinbase say the balance is, which is what the owner sees when they open the app.
export const accountEquity = floor => (numeric(floor?.account_equity) ? floor.account_equity : null);
// "kalshi" is what the runtime publishes; "Kalshi" is what the account is called.
export const venueLabel = value => { const name = show(value); return name ? name[0].toUpperCase() + name.slice(1) : ''; };
export function accountVenues(floor) {
  return (Array.isArray(floor?.venues) ? floor.venues : [])
    .filter(row => row && typeof row === 'object' && numeric(row.equity))
    .map(row => ({
      venue: show(row.venue), name: venueLabel(row.venue), equity: row.equity,
      cash: numeric(row.cash) ? row.cash : null, at: show(row.as_of), stale: row.stale === true,
    }));
}
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
// ------------------------------------------------------------------- the positions board
// Every open position the checkpoint carried, live desks first, largest first. A shadow desk's
// position is a scored position and is labelled so; the board never adds it to any money.
export function exitChips(position) {
  const chips = [];
  if (numeric(position?.target_price)) chips.push({ kind: 'target', text: `target ${priceText(position.target_price)}` });
  if (numeric(position?.stop_price)) chips.push({ kind: 'stop', text: `stop ${priceText(position.stop_price)}` });
  if (typeof position?.time_stop_at === 'string' && position.time_stop_at) chips.push({ kind: 'time_stop', text: `out by ${date(position.time_stop_at)}` });
  const resting = Array.isArray(position?.exit_orders) ? position.exit_orders.length : 0;
  if (resting) chips.push({ kind: 'resting', text: `${resting} resting` });
  else if (chips.length) chips.push({ kind: 'floor', text: 'floor enforces' });
  else chips.push({ kind: 'none', text: 'no exit plan' });
  return chips;
}
export function positionRows(checkpoint) {
  const desks = Array.isArray(checkpoint?.desks) ? checkpoint.desks : [];
  const rows = [];
  for (const desk of orderDesks(desks)) {
    for (const position of Array.isArray(desk?.positions) ? desk.positions : []) {
      if (!position || typeof position !== 'object') continue;
      rows.push({
        desk: show(desk.id), name: partnerName(show(desk.id)), live: isLive(desk),
        instrument: instrumentLabel(position.instrument) || '—', venue: venueLabel(position.instrument?.venue), side: show(position.side),
        quantity: quantity(position.quantity), entry: show(position.entry_price), mark: show(position.mark_price),
        value: show(position.market_value), pnl: show(position.unrealized_pnl), tone: signOf(show(position.unrealized_pnl)),
        openedAt: show(position.opened_at), thesis: show(position.thesis), chips: exitChips(position),
        intentId: show(position.intent_id), sessionId: show(position.session_id),
        story: position.intent_id ? storyHref(show(desk.id), show(position.intent_id)) : '',
      });
    }
  }
  const size = row => Math.abs(Number(row.value)) || 0;
  return rows.sort((left, right) => (Number(right.live) - Number(left.live)) || (size(right) - size(left)));
}
// "live now · cadence 13:30" while a session runs; nothing otherwise.
export function liveSessionText(desk) {
  const session = desk?.live_session;
  if (!session || typeof session !== 'object') return '';
  return join('live now', humanize(show(session.trigger)));
}
// ------------------------------------------------------------------------ the run clock
// How long the desks have been working, what that has cost, what it has made. The elapsed time
// is wall-clock since the run began; availability says how much of the last week it was up.
const elapsedText = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};
export function runClock(run, now = Date.now()) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return null;
  const started = Date.parse(run.started_at);
  const elapsed = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null;
  const perDollar = numeric(run.pnl_per_sail_dollar) ? run.pnl_per_sail_dollar : null;
  return {
    elapsed: elapsed === null ? '' : elapsedText(elapsed),
    since: Number.isFinite(started) ? date(run.started_at, 'day') : '',
    availability: numeric(run.availability_7d_pct) ? `${Number(run.availability_7d_pct).toFixed(1)}% of the last 7 days` : 'measuring',
    sessions: `${Number(run.sessions_total) || 0} (${Number(run.sessions_today) || 0} today)`,
    decisions: String(Number(run.decisions_total) || 0),
    spendToday: money(run.sail_model_spend_today_usd, 2),
    // The ledgers behind these two are folded differently; the total is never shown below today.
    spendTotal: money(String(Math.max(Number(run.sail_spend_total_usd) || 0, Number(run.sail_model_spend_today_usd) || 0).toFixed(2)), 2),
    spendNote: join(numeric(run.sail_model_spend_total_usd) ? `models ${money(run.sail_model_spend_total_usd, 2)}` : '',
      numeric(run.sail_infra_spend_total_usd) ? `box ${money(run.sail_infra_spend_total_usd, 2)}, about a cent an hour` : 'box about a cent an hour'),
    pnl: signedMoney(run.pnl_total_usd, 2), pnlTone: signOf(show(run.pnl_total_usd)),
    perDollar: perDollar === null ? 'not yet' : signedMoney(perDollar, 2), perDollarTone: perDollar === null ? '' : signOf(perDollar),
    models: Array.isArray(run.models_used) ? run.models_used.map(show).filter(Boolean).join(', ') : '',
  };
}

// ------------------------------------------------------------------------- the lineage
// Families as columns, generations as rows. A cell holds the desks of one generation.
export function lineageGrid(desks) {
  const list = orderDesks(desks).filter(desk => desk && typeof desk === 'object');
  const families = [...new Set(list.map(desk => show(desk.family)).filter(Boolean))];
  const generations = [...new Set(list.map(desk => desk.generation).filter(Number.isSafeInteger))].sort((left, right) => left - right);
  const rows = generations.map(generation => ({
    generation,
    cells: families.map(family => ({ family, desks: list.filter(desk => show(desk.family) === family && desk.generation === generation) })),
  }));
  return { families, generations, rows };
}
// How a bred desk differs from its parent, as badges. A founder has none.
export function mutationBadges(mutation) {
  if (!mutation || typeof mutation !== 'object') return [];
  const shift = Number(mutation.session_shift_minutes);
  const badges = [
    { key: 'model', text: profileName(mutation.model_profile), title: mutation.model_changed === true ? 'born on a different model from its parent' : 'same model as its parent', changed: mutation.model_changed === true },
    { key: 'effort', text: mutation.reasoning_effort ? `effort ${show(mutation.reasoning_effort)}` : '', title: 'reasoning effort' },
    { key: 'shift', text: Number.isFinite(shift) && shift !== 0 ? `${shift > 0 ? '+' : '−'}${Math.abs(shift)} min` : '', title: 'session times shifted from the parent' },
    { key: 'memory', text: Number.isSafeInteger(mutation.memory_limit) ? `memory ${mutation.memory_limit}` : '', title: 'memory entries read per session' },
    { key: 'trait', text: truncate(mutation.persona_trait, 60).text, title: show(mutation.persona_trait) },
  ];
  return badges.filter(badge => badge.text);
}
function badgeRow(badges, className = 'mutation') {
  const row = element('div', null, className);
  for (const badge of badges) {
    const chip = element('span', badge.text, `mutation-badge mutation-${badge.key}${badge.changed ? ' mutation-changed' : ''}`);
    if (badge.title) chip.setAttribute('title', badge.title);
    row.append(chip);
  }
  return row;
}
function lineageTree(checkpoint) {
  const grid = lineageGrid(checkpoint?.desks);
  if (!grid.rows.length) return null;
  const tree = element('div', null, 'lineage-tree');
  tree.style = `--families: ${grid.families.length}`;
  const head = element('div', null, 'lineage-row lineage-head');
  head.append(element('span', 'gen', 'lineage-gen'));
  for (const family of grid.families) head.append(element('span', `${family} family`, 'lineage-family'));
  tree.append(head);
  for (const row of grid.rows) {
    const line = element('div', null, 'lineage-row');
    line.append(element('span', String(row.generation), 'lineage-gen'));
    for (const cell of row.cells) {
      const box = element('span', null, 'lineage-cell');
      for (const desk of cell.desks) {
        const node = link('', deskHref(desk.id), isLive(desk) ? 'lineage-node lineage-live' : 'lineage-node');
        const name = element('span', null, 'lineage-name');
        name.append(element('b', partnerName(desk.id)), modeBadge(desk));
        node.append(name);
        const live = liveSessionText(desk);
        if (live) node.append(element('span', live, 'live-now'));
        const badges = mutationBadges(desk.mutation);
        if (badges.length) node.append(badgeRow(badges));
        box.append(node);
      }
      line.append(box);
    }
    tree.append(line);
  }
  return tree;
}

// ------------------------------------------------------------------------------ the lab
// The lab's experiments, newest first, each with its change spelled out.
export function changeSummary(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return '';
  const parts = [];
  for (const [key, value] of Object.entries(change).slice(0, 8)) {
    if (key === 'playbook_note') { parts.push('house view added'); continue; }
    const rendered = Array.isArray(value) ? value.map(show).filter(Boolean).join(', ')
      : value && typeof value === 'object' ? Object.entries(value).map(([k, v]) => `${humanize(k)} ${show(v)}`).join(', ') : show(value);
    parts.push(`${key.replace(/^model\./, '').replace(/^reasoning_/, '').replace(/[._:]+/g, ' ')} ${key.startsWith('model.profile') ? profileName(rendered) : rendered}`.trim());
  }
  return parts.join(' · ');
}
export function experimentRows(lab) {
  const list = Array.isArray(lab?.experiments) ? lab.experiments : [];
  return list.filter(experiment => experiment && typeof experiment === 'object')
    .map(experiment => ({
      id: show(experiment.experiment_id), hypothesis: show(experiment.hypothesis), status: show(experiment.status),
      family: show(experiment.family), parent: show(experiment.parent_id), variant: show(experiment.variant_desk_id),
      variantName: experiment.variant_desk_id ? partnerName(show(experiment.variant_desk_id)) : '',
      change: changeSummary(experiment.change), proposedAt: show(experiment.proposed_at), evaluateAfter: show(experiment.evaluate_after),
      verdict: show(experiment.verdict_reason),
    }))
    .sort((left, right) => Date.parse(right.proposedAt) - Date.parse(left.proposedAt));
}
const CURVE_METRICS = [
  { key: 'cost_adjusted_excess_pct', label: 'cost-adjusted excess', format: value => percent(value), better: 'higher' },
  { key: 'brier', label: 'Brier score', format: value => show(value), better: 'lower' },
  { key: 'pnl_per_inference_usd', label: 'P&L per inference $', format: value => signedMoney(value, 2), better: 'higher' },
];
// Three small multiples, one per metric, generation on the x axis. Pure geometry.
export function curveSeries(curve, { width = 240, height = 120 } = {}) {
  const rows = (Array.isArray(curve) ? curve : []).filter(row => row && Number.isSafeInteger(row.generation))
    .sort((left, right) => left.generation - right.generation);
  const generations = rows.map(row => row.generation);
  return CURVE_METRICS.map(metric => {
    const points = rows.map((row, index) => ({ generation: row.generation, index, value: numeric(row[metric.key]) ? Number(row[metric.key]) : null }))
      .filter(point => point.value !== null);
    if (!points.length) return { ...metric, generations, points: [], path: '', empty: true };
    let min = Math.min(...points.map(point => point.value));
    let max = Math.max(...points.map(point => point.value));
    if (min === max) { min -= Math.abs(min) * 0.1 + 0.5; max += Math.abs(max) * 0.1 + 0.5; }
    const step = generations.length > 1 ? (width - 24) / (generations.length - 1) : 0;
    const x = index => (generations.length > 1 ? 12 + index * step : width / 2);
    const y = value => 10 + (max - value) / (max - min) * (height - 24);
    const plotted = points.map(point => ({ ...point, x: x(point.index), y: y(point.value), text: metric.format(String(point.value)) }));
    return {
      ...metric, generations, points: plotted, min, max, width, height, empty: false,
      path: plotted.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '),
    };
  });
}
// One sentence a visitor can act on: is the newest generation better than the one before it?
export function curveReading(curve) {
  const rows = (Array.isArray(curve) ? curve : []).filter(row => row && Number.isSafeInteger(row.generation))
    .sort((left, right) => left.generation - right.generation);
  if (!rows.length) return 'The curve appears with the first generation’s results.';
  if (rows.length < 2) return `One generation so far (${rows[0].desks} desk${rows[0].desks === 1 ? '' : 's'}). The curve needs a second to say anything.`;
  if (rows.every(row => !(Number(row.decisions) > 0))) return `${rows.length} generations running, none with a scored decision yet. The curve means something after the first settled trades.`;
  const [before, after] = rows.slice(-2);
  const delta = Number(after.cost_adjusted_excess_pct) - Number(before.cost_adjusted_excess_pct);
  const verb = delta > 0 ? 'beats' : delta < 0 ? 'trails' : 'matches';
  const parts = [`Generation ${after.generation} ${verb} generation ${before.generation} on cost-adjusted return${delta ? ` by ${percent(delta.toFixed(4)).replace(/^[+−]/, '')}` : ''}`];
  if (numeric(after.brier) && numeric(before.brier)) {
    const change = Number(after.brier) - Number(before.brier);
    parts.push(change < 0 ? 'forecasts sharper' : change > 0 ? 'forecasts looser' : 'forecasts unchanged');
  }
  return `${parts.join('; ')}.`;
}
function curveFigure(lab) {
  const series = curveSeries(lab?.curve);
  const wrap = element('div', null, 'curve');
  if (series.every(metric => metric.empty)) {
    wrap.append(element('p', curveReading(lab?.curve), 'empty-state'));
    return wrap;
  }
  const grid = element('div', null, 'curve-grid');
  for (const metric of series) {
    const figure = element('figure', null, 'curve-metric');
    figure.append(element('figcaption', join(metric.label, metric.better === 'lower' ? 'lower is better' : 'higher is better')));
    if (metric.empty) { figure.append(element('p', 'not yet measured', 'empty-state')); grid.append(figure); continue; }
    const svg = svgElement('svg', { viewBox: `0 0 ${metric.width} ${metric.height}`, role: 'img', 'aria-label': `${metric.label} by generation`, class: 'curve-svg' });
    svg.append(svgElement('line', { x1: 12, x2: metric.width - 12, y1: metric.height - 14, y2: metric.height - 14, class: 'chart-grid' }));
    if (metric.points.length > 1) svg.append(svgElement('path', { d: metric.path, class: 'curve-line' }));
    for (const point of metric.points) {
      svg.append(svgElement('circle', { cx: point.x.toFixed(2), cy: point.y.toFixed(2), r: 3.5, class: 'curve-point' }));
      svg.append(svgElement('text', { x: point.x.toFixed(2), y: metric.height - 2, class: 'curve-label', 'text-anchor': 'middle' }, `g${point.generation}`));
      svg.append(svgElement('text', { x: point.x.toFixed(2), y: (point.y - 7).toFixed(2), class: 'curve-value', 'text-anchor': 'middle' }, point.text));
    }
    figure.append(svg);
    grid.append(figure);
  }
  wrap.append(grid, element('p', curveReading(lab?.curve), 'curve-reading'));
  return wrap;
}
function experimentsPanel(lab, { empty = 'The lab has not proposed an experiment yet. The first one appears with the first nightly review.' } = {}) {
  const rows = experimentRows(lab);
  if (!rows.length) return element('p', empty, 'empty-state');
  const list = element('div', null, 'experiments');
  for (const row of rows) {
    const item = element('article', null, `experiment experiment-${row.status}`);
    const head = element('div', null, 'experiment-head');
    head.append(element('span', row.status, `status status-${row.status}`));
    head.append(element('span', join(`${row.family} family`, row.variantName && `variant ${row.variantName}`), 'experiment-meta'));
    if (row.proposedAt) head.append(timeNode(row.proposedAt, 'day'));
    item.append(head, element('p', row.hypothesis, 'experiment-hypothesis'));
    if (row.change) item.append(element('p', row.change, 'experiment-change'));
    if (row.verdict) item.append(element('p', row.verdict, 'experiment-verdict'));
    list.append(item);
  }
  return list;
}

// -------------------------------------------------------------------- trade stories
// One story per order intent: thesis, the risk engine's answer, the order, its fills, the exit
// plan and the outcome, folded from events on four streams. Newest first.
export function tradeStories(events, deskIdFilter = null) {
  const list = Array.isArray(events) ? events.filter(event => event && typeof event === 'object') : [];
  const byKind = kind => list.filter(event => event.kind === kind);
  const intents = byKind('desk.intent').filter(event => deskIdFilter === null || event.payload?.desk_id === deskIdFilter || streamDeskOf(event.stream) === deskIdFilter);
  const decisions = byKind('risk.decision');
  const orders = byKind('broker.order');
  const fills = byKind('broker.fill');
  const exits = byKind('desk.exit_plan');
  const outcomes = byKind('desk.outcome');
  return intents.map(intent => {
    const id = show(intent.payload?.intent_id) || show(intent.id);
    const symbol = instrumentLabel(intent.payload?.instrument);
    const decision = decisions.find(event => event.payload?.intent_id === id) || null;
    const own = orders.filter(event => event.payload?.intent_id === id);
    const orderIds = new Set(own.map(event => show(event.payload?.order_id)).filter(Boolean));
    const ownFills = fills.filter(event => orderIds.has(show(event.payload?.order_id)));
    const exit = exits.find(event => event.payload?.intent_id === id) || null;
    const latestOrder = own.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0] || null;
    const traded = ownFills.length > 0 || ['filled', 'partially_filled'].includes(show(latestOrder?.payload?.status));
    // An outcome is matched by instrument, so only a story that actually traded can own one.
    const outcome = traded ? outcomes.find(event => Date.parse(event.at) >= Date.parse(intent.at)
      && (show(event.payload?.market_id) === symbol || show(event.payload?.instrument) === symbol || show(event.payload?.instrument).startsWith(`${symbol}`))) || null : null;
    const steps = [];
    const p = intent.payload || {};
    steps.push({ key: 'thesis', label: 'Thesis', at: intent.at, text: join(`${show(p.side)} ${quantity(p.quantity)} ${symbol}`.trim(), p.limit_price ? `limit ${priceText(show(p.limit_price))}` : show(p.order_type), show(p.rationale)) });
    if (decision) {
      const approved = decision.payload?.approved === true;
      steps.push({ key: 'risk', label: 'Risk engine', at: decision.at, tone: approved ? 'positive' : 'negative', text: join(approved ? 'approved' : 'blocked', Array.isArray(decision.payload?.reasons) ? decision.payload.reasons.map(show).filter(Boolean).join('; ') : '') });
    }
    if (latestOrder) {
      const o = latestOrder.payload || {};
      steps.push({ key: 'order', label: 'Order', at: latestOrder.at, text: join(show(o.status), o.filled_quantity !== undefined && o.filled_quantity !== null ? `filled ${quantity(o.filled_quantity)}` : '', numeric(o.average_price) ? `avg ${priceText(o.average_price)}` : '', o.shadow === true ? 'shadow, never sent' : '') });
    }
    for (const fill of ownFills.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))) {
      const f = fill.payload || {};
      steps.push({ key: 'fill', label: 'Fill', at: fill.at, text: join(`${show(f.side)} ${quantity(f.quantity)}`.trim(), numeric(f.price) ? `@ ${priceText(f.price)}` : '', numeric(f.fee) && Number(f.fee) ? `fee ${money(f.fee, 4)}` : '') });
    }
    if (exit) steps.push({ key: 'exit', label: 'Exit plan', at: exit.at, text: DETAILS['desk.exit_plan'](exit.payload || {}) });
    if (outcome) {
      const r = outcome.payload || {};
      steps.push({ key: 'outcome', label: 'Outcome', at: outcome.at, tone: signOf(show(r.pnl)), text: join(r.result ? `resolved ${show(r.result)}` : '', numeric(r.pnl) ? `P&L ${signedMoney(r.pnl, 2)}` : '', r.held_for_hours === undefined ? '' : `${show(r.held_for_hours)}h held`) });
    }
    const state = outcome ? 'closed' : traded ? 'open' : decision && decision.payload?.approved === false ? 'blocked' : latestOrder ? show(latestOrder.payload?.status) || 'sent' : 'proposed';
    return { id, at: intent.at, symbol, side: show(p.side), state, steps };
  }).sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}
const streamDeskOf = stream => (typeof stream === 'string' && stream.startsWith('desk:') ? stream.slice(5) : null);
// A story's anchor on the desk page, so the book can link a holding to the order behind it.
export const storyAnchor = intentId => `story-${show(intentId).replace(/[^A-Za-z0-9_-]+/g, '-')}`;
export const storyHref = (deskId, intentId) => `${deskHref(deskId)}#${storyAnchor(intentId)}`;
// The desk's own words for a holding: the rationale it filed with the order, and what the risk
// engine said about it. Read from the events the intent id names.
export function positionRationale(events, intentId) {
  const list = Array.isArray(events) ? events : [];
  const intent = list.find(event => event?.kind === 'desk.intent' && show(event.payload?.intent_id) === show(intentId)) || null;
  const decision = list.find(event => event?.kind === 'risk.decision' && show(event.payload?.intent_id) === show(intentId)) || null;
  if (!intent && !decision) return null;
  const reasons = Array.isArray(decision?.payload?.reasons) ? decision.payload.reasons.map(show).filter(Boolean) : [];
  return {
    rationale: show(intent?.payload?.rationale), at: intent?.at || decision?.at || null,
    decision: decision ? (decision.payload?.approved === true ? 'approved' : decision.payload?.approved === false ? 'blocked' : '') : '',
    reasons, text: join(decision ? `risk engine ${decision.payload?.approved === true ? 'approved' : 'blocked'}` : '', reasons.join('; ')),
  };
}
function storiesSection(events, id) {
  const stories = tradeStories(events, id);
  const block = section('Trade stories');
  if (!stories.length) { block.append(element('p', 'No order yet.', 'empty-state')); return block; }
  const list = element('div', null, 'stories');
  for (const story of stories.slice(0, 20)) {
    const item = element('article', null, `story story-${story.state}`);
    item.id = storyAnchor(story.id);
    const head = element('div', null, 'story-head');
    head.append(element('b', [story.side, story.symbol].filter(Boolean).join(' ')), element('span', story.state, `status status-${story.state}`), timeNode(story.at));
    item.append(head);
    const steps = element('ol', null, 'story-steps');
    for (const step of story.steps) {
      const line = element('li', null, `story-step story-${step.key}`);
      line.append(element('span', step.label, 'story-label'));
      line.append(element('span', truncate(step.text, 220).text, step.tone ? `story-text ${step.tone}` : 'story-text'));
      steps.append(line);
    }
    item.append(steps);
    list.append(item);
  }
  block.append(list);
  return block;
}

// ----------------------------------------------------------------------- calibration
// The newest calibration the lab published for a desk, a family, or the whole floor.
export function latestCalibration(events, { scope = 'desk', desk_id: id = null, family = null } = {}) {
  return (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === 'lab.calibration' && event.payload?.scope === scope
      && (scope !== 'desk' || event.payload.desk_id === id) && (scope !== 'family' || event.payload.family === family))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0]?.payload || null;
}
export function familyCalibrations(events) {
  const out = new Map();
  for (const event of (Array.isArray(events) ? events : []).filter(event => event?.kind === 'lab.calibration' && event.payload?.scope === 'family')) {
    const family = show(event.payload.family);
    const held = out.get(family);
    if (!held || Date.parse(event.at) > Date.parse(held.at)) out.set(family, { at: event.at, ...event.payload });
  }
  return [...out.values()].sort((left, right) => left.family.localeCompare(right.family));
}
// A reliability diagram: what the desk said (x) against what happened (y), one dot per bin,
// dot size by count, the diagonal as the line a perfect forecaster would sit on.
export function reliabilitySeries(reliability, { size = 200 } = {}) {
  const bins = (Array.isArray(reliability) ? reliability : []).filter(bin => bin && numeric(bin.forecast_mean) && numeric(bin.outcome_rate));
  const most = Math.max(1, ...bins.map(bin => Number(bin.n) || 0));
  const scale = value => 10 + Number(value) * (size - 20);
  return {
    size,
    points: bins.map(bin => ({
      bin: show(bin.bin), x: scale(bin.forecast_mean), y: size - scale(bin.outcome_rate), n: Number(bin.n) || 0,
      r: 3 + 6 * Math.sqrt((Number(bin.n) || 0) / most), forecast: probabilityText(bin.forecast_mean), outcome: probabilityText(bin.outcome_rate),
    })),
    diagonal: `M${scale(0).toFixed(1)},${(size - scale(0)).toFixed(1)} L${scale(1).toFixed(1)},${(size - scale(1)).toFixed(1)}`,
  };
}
function reliabilityFigure(calibration) {
  const series = reliabilitySeries(calibration?.reliability);
  if (!series.points.length) return element('p', 'The reliability chart appears once forecasts have resolved.', 'empty-state');
  const figure = element('figure', null, 'reliability');
  const svg = svgElement('svg', { viewBox: `0 0 ${series.size} ${series.size}`, role: 'img', class: 'reliability-svg', 'aria-label': 'Forecast probability against the rate at which those forecasts came true.' });
  svg.append(svgElement('path', { d: series.diagonal, class: 'reliability-diagonal' }));
  for (const point of series.points) {
    const dot = svgElement('circle', { cx: point.x.toFixed(1), cy: point.y.toFixed(1), r: point.r.toFixed(1), class: 'reliability-dot' });
    dot.append(svgElement('title', {}, `said ${point.forecast}, happened ${point.outcome}, ${point.n} forecasts`));
    svg.append(dot);
  }
  figure.append(svg, element('figcaption', 'said → happened. On the line is perfect; above it the desk is too shy, below it too sure.', 'chart-caption'));
  return figure;
}
function calibrationCard(desk, calibration) {
  const block = section('Calibration', 'said vs happened');
  const summary = desk?.calibration && typeof desk.calibration === 'object' ? desk.calibration : calibration;
  if (summary && Number.isSafeInteger(summary.n) && summary.n > 0) {
    block.append(facts([
      ['Forecasts scored', String(summary.n)],
      ['Brier score', numeric(summary.brier) ? `${summary.brier} · 0 is perfect, 0.25 is a coin` : 'pending'],
      ['Since', summary.since ? date(summary.since, 'day') : calibration?.since ? date(calibration.since, 'day') : '—'],
    ]));
  } else block.append(element('p', 'No forecast resolved yet.', 'empty-state'));
  block.append(reliabilityFigure(calibration));
  return block;
}
function liveNow(desk) {
  const text = liveSessionText(desk);
  if (!text) return null;
  const badge = element('span', null, 'live-now live-now-big');
  const dot = element('span', null, 'badge-dot');
  dot.setAttribute('aria-hidden', 'true');
  badge.append(dot, element('span', text));
  return badge;
}

// ============================================================================ the floor
// One screen: what this is, how it is doing, and the partners thinking live. Then the real money
// at work, what closed, and who is winning. Everything deeper is one link away.

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
// Generations read as numerals: the founder is I, its first child II.
export function roman(value) {
  let number = Number.isSafeInteger(value) && value > 0 ? value : 1;
  const table = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [size, glyph] of table) while (number >= size) { out += glyph; number -= size; }
  return out;
}
export const raceName = desk => {
  const generation = Number.isSafeInteger(desk?.generation) ? desk.generation : 1;
  return generation > 1 ? `${partnerOf(desk).surname} ${roman(generation)}` : partnerOf(desk).surname;
};
// "in 12 min", "in 2h 14m": when the next partner sits down.
export function untilText(value, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.round((at - now) / 1000);
  if (seconds <= 60) return 'now';
  if (seconds < 3600) return `in ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) { const hours = Math.floor(seconds / 3600); const minutes = Math.round((seconds % 3600) / 60); return `in ${hours}h${minutes ? ` ${minutes}m` : ''}`; }
  return `in ${Math.round(seconds / 86400)} d`;
}
// Between sessions: when the next partner sits down. The tape below keeps moving meanwhile.
export function quietLine(checkpoint, now = Date.now()) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  if (!desks.length) return 'The partners appear with the first checkpoint.';
  const soonest = desks.map(desk => ({ desk, at: Date.parse(desk.next_session_at) })).filter(row => Number.isFinite(row.at)).sort((left, right) => left.at - right.at)[0];
  if (!soonest) return 'No partner is in session. Their strategies keep quoting between sessions.';
  const when = untilText(soonest.desk.next_session_at, now);
  return `No partner is in session. ${partnerName(show(soonest.desk.id))} sits down ${when === 'now' ? 'now' : when}. Their strategies keep quoting meanwhile.`;
}

// ---- market names a stranger can read
// Kalshi tickers carry the whole contract in their segments: series, date (and hour), strike.
// Anything this does not recognise keeps its ticker, so a new series never reads wrong.
const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CITY_NAMES = {
  NY: 'NYC', NYC: 'NYC', CHI: 'Chicago', MIA: 'Miami', AUS: 'Austin', DEN: 'Denver', LAX: 'LA', PHIL: 'Philadelphia',
  PHL: 'Philadelphia', DC: 'Washington', SFO: 'San Francisco', SEA: 'Seattle', HOU: 'Houston', BOS: 'Boston',
};
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'];
const ECONOMIC_SERIES = { KXCPIYOY: 'CPI YoY', KXCPI: 'CPI MoM', KXCPICOREYOY: 'Core CPI YoY', KXCPICORE: 'Core CPI MoM', KXPAYROLLS: 'Payrolls', KXU3: 'Unemployment' };
// "26SEP16" is a day, "26SEP1614" a day and an Eastern hour, "26SEP" a month.
function tickerWhen(code) {
  const match = /^(\d{2})([A-Z]{3})(\d{2})?(\d{2})?$/.exec(typeof code === 'string' ? code : '');
  const month = match ? MONTH_CODES.indexOf(match[2]) : -1;
  if (month < 0) return null;
  const hour = match[4] === undefined ? null : Number(match[4]);
  if (hour !== null && hour > 23) return null;
  return {
    day: match[3] ? `${MONTH_NAMES[month]} ${Number(match[3])}` : MONTH_NAMES[month], hasDay: Boolean(match[3]),
    hour: hour === null ? '' : `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'} ET`,
  };
}
const withCommas = value => { const [whole, fraction] = String(value).split('.'); return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : ''); };
const stepFrom = (value, delta) => String(Math.round((Number(value) + delta) * 100) / 100);
export function marketTitle(value) {
  const ticker = (typeof value === 'string' ? value : instrumentLabel(value)).trim();
  if (!ticker) return '';
  const coin = /^([A-Z0-9]{2,10})-USDC?$/.exec(ticker);
  if (coin) return coin[1];
  const [series, dated, strike = '', ...rest] = ticker.split('-');
  const when = tickerWhen(dated);
  if (!series.startsWith('KX') || !when || rest.length) return ticker;
  const at = [when.day, when.hour].filter(Boolean).join(' ');
  const bucket = /^B(\d+(?:\.\d+)?)$/.exec(strike);
  const line = /^T(\d+(?:\.\d+)?)$/.exec(strike);
  const weather = /^KX(HIGH|LOW)(T?)([A-Z]{2,4})$/.exec(series);
  if (weather && when.hasDay && !when.hour) {
    const place = CITY_NAMES[weather[3]] || CITY_NAMES[`${weather[2]}${weather[3]}`] || `${weather[2]}${weather[3]}`;
    const word = weather[1].toLowerCase();
    if (bucket) return `${place} ${word} ${stepFrom(bucket[1], -0.5)}–${stepFrom(bucket[1], 0.5)}°F · ${at}`;
    if (line) return `${place} ${word} ${line[1]}°F line · ${at}`;
    return strike ? ticker : `${place} ${word} · ${at}`;
  }
  const crypto = /^KX([A-Z]{3,4}?)(D?)$/.exec(series);
  if (crypto && COINS.includes(crypto[1])) {
    if (bucket) return `${crypto[1]} $${withCommas(bucket[1])} bucket · ${at}`;
    if (line) return `${crypto[1]} above $${withCommas(line[1])} · ${at}`;
    return strike ? ticker : `${crypto[1]} price · ${at}`;
  }
  if (ECONOMIC_SERIES[series]) {
    if (line) return `${ECONOMIC_SERIES[series]} above ${line[1]}% · ${at}`;
    if (bucket) return `${ECONOMIC_SERIES[series]} ${bucket[1]}% · ${at}`;
    return strike ? ticker : `${ECONOMIC_SERIES[series]} · ${at}`;
  }
  if (series === 'KXFEDDECISION') {
    const move = /^([HC])(\d+)$/.exec(strike);
    if (move) return `Fed ${at} · ${Number(move[2]) === 0 ? 'hold' : `${move[1] === 'H' ? 'hike' : 'cut'} ${Number(move[2])}bp`}`;
    return strike ? ticker : `Fed decision · ${at}`;
  }
  if (series === 'KXFED' && line) return `Fed rate above ${line[1]}% · ${at}`;
  return ticker;
}
// A series ticker alone, "KXFEDDECISION" or "KXHIGHNY", as the thing its markets are about.
export function seriesTitle(value) {
  const series = show(value).trim();
  const weather = /^KX(HIGH|LOW)(T?)([A-Z]{2,4})$/.exec(series);
  if (weather) return `${CITY_NAMES[weather[3]] || CITY_NAMES[`${weather[2]}${weather[3]}`] || `${weather[2]}${weather[3]}`} ${weather[1].toLowerCase()} temperature`;
  const crypto = /^KX([A-Z]{3,4}?)(D?)$/.exec(series);
  if (crypto && COINS.includes(crypto[1])) return `${crypto[1]} price`;
  if (ECONOMIC_SERIES[series]) return ECONOMIC_SERIES[series];
  if (series === 'KXFEDDECISION') return 'Fed decision';
  if (series === 'KXFED') return 'Fed rate';
  return '';
}
// Runtime amounts sometimes carry more places than the page's decimal format allows
// ("-0.36030101621000"); eight places is more than any number on the page shows.
export const looseAmount = value => (typeof value === 'string' && /^-?\d{1,15}\.\d{9,}$/.test(value) ? Number(value).toFixed(8) : value);
// "crypto:AAVE-USD:coinbase" is how an outcome names what it closed.
const outcomeSymbol = payload => show(payload?.market_id) || instrumentLabel(payload?.instrument).replace(/^[a-z]+:([^:]+):[a-z0-9-]+$/, '$1');
// Sizes as a person writes them: 23, 4.69, 0.0878, 0.00000164.
export function quantityText(value) {
  const number = Number(value);
  if (!(typeof value === 'string' || typeof value === 'number') || !Number.isFinite(number)) return show(value);
  const size = Math.abs(number);
  const places = size >= 1 || size === 0 ? 2 : Math.min(8, 2 - Math.floor(Math.log10(size)));
  return number.toFixed(places).replace(/\.?0+$/, '');
}
// An event contract's price is a probability, and reads in cents: 43¢, 0.5¢.
export const centsText = value => (numeric(value) ? `${(Number(value) * 100).toFixed(1).replace(/\.0$/, '')}¢` : '—');
// Hours held: 38m, 4.3h, 3d.
export function heldText(value) {
  const hours = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(hours) || hours < 0) return '';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Number(hours.toFixed(1))}h`;
  return `${Math.round(hours / 24)}d`;
}
// The reason a desk gave, cut to its first sentence. A strategy's name becomes a tag.
export function thesisParts(value, max = 100) {
  const text = show(value).replace(/\s+/g, ' ').trim();
  const strategy = /^\[strategy ([A-Za-z0-9_]+)\]\s*/.exec(text);
  const full = (strategy ? text.slice(strategy[0].length) : text).replace(/^Floor exit of oi-[0-9a-f]+:\s*(\S)/i, (_, first) => `Floor exit: ${first}`);
  const sentence = (/^.+?[.!?](?=\s|$)/.exec(full) || [full])[0];
  const short = truncate(sentence, max).text;
  return { tag: strategy ? humanize(strategy[1]) : '', short, full, more: full.length > short.length };
}

// ---- the masthead: five numbers
// "23h 49m" of self-improvement, with the seconds that make it tick.
export function selfImprovingParts(seconds) {
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
export function mastheadNumbers(checkpoint, now = Date.now()) {
  const floor = checkpoint?.floor && typeof checkpoint.floor === 'object' ? checkpoint.floor : {};
  const run = checkpoint?.run && typeof checkpoint.run === 'object' ? checkpoint.run : null;
  const clock = runClock(run, now);
  const total = accountEquity(floor) ?? (numeric(floor.live_equity) ? floor.live_equity : null);
  const pnl = run && numeric(run.pnl_total_usd) ? run.pnl_total_usd : null;
  // Profit as a share of the money put in: the runtime's net deposits when it publishes them,
  // otherwise what the accounts hold less what was made.
  const deposits = numeric(floor.net_deposits) ? Number(floor.net_deposits) : total !== null && pnl !== null ? Number(total) - Number(pnl) : null;
  const share = pnl !== null && deposits !== null && deposits > 0 ? percent((Number(pnl) / deposits * 100).toFixed(4)) : '';
  const started = Date.parse(run?.started_at);
  const elapsed = Number.isFinite(started) ? selfImprovingParts(Math.max(0, (now - started) / 1000)) : { main: '—', tick: '' };
  return [
    { key: 'portfolio', label: 'Portfolio', value: total === null ? '—' : money(total, 2), tone: '' },
    { key: 'profit', label: 'Profit', value: pnl === null ? '—' : signedMoney(pnl, 2), tone: pnl === null ? '' : signOf(pnl), note: pnl === null ? '' : share },
    { key: 'clock', label: 'Self-improving', value: elapsed.main, tick: elapsed.tick, tone: '', startedAt: Number.isFinite(started) ? started : null },
    { key: 'spent', label: 'Sail spent', value: clock ? clock.spendTotal : '—', tone: '' },
    { key: 'per', label: 'Profit per Sail $', value: clock && clock.perDollar !== 'not yet' ? clock.perDollar : '—', tone: clock?.perDollarTone || '' },
  ];
}

// ---- live: thinking, researching, trading
// A tool call is shown when it is research, in the words a person would use for it. Orders, memos
// and playbook writes are left out: the trade itself shows, and the rest is bookkeeping.
const said = value => { const text = truncate(show(value), 70).text; return text ? `“${text}”` : ''; };
const TICKERISH = /^(?:KX[A-Z0-9]+-[A-Z0-9.-]+|[A-Z0-9]{2,10}-USDC?)$/;
const topic = value => {
  const text = show(value).trim();
  if (TICKERISH.test(text)) return marketTitle(text);
  const series = /^KX[A-Z0-9]+$/.test(text) ? seriesTitle(text) : '';
  return series ? `${series} markets` : said(text);
};
const argument = (args, ...keys) => {
  for (const key of keys) { const value = show(args?.[key]).trim(); if (value) return value; }
  return '';
};
const INTERVAL_WORDS = { '1m': 'one-minute', '5m': 'five-minute', '15m': '15-minute', '30m': '30-minute', '1h': 'hourly', '4h': 'four-hour', '6h': 'six-hour', '1d': 'daily' };
export const RESEARCH = {
  event_markets: args => { const query = argument(args, 'query', 'market_id', 'event_ticker', 'series_ticker', 'series', 'ticker'); return query ? `searching Kalshi for ${topic(query)}` : 'browsing Kalshi markets'; },
  news: args => { const query = argument(args, 'query', 'topic'); return query ? `reading news on ${said(query)}` : 'reading the news'; },
  weather_forecast: args => { const place = argument(args, 'city', 'location', 'station'); return place ? `reading the NWS forecast for ${place}` : 'reading the NWS forecast'; },
  calendar: args => { const query = argument(args, 'query', 'event', 'category'); return query ? `checking the economic calendar for ${said(query)}` : 'checking the economic calendar'; },
  memo_read: args => { const query = argument(args, 'title', 'query'); return query ? `rereading its memo ${said(query)}` : 'rereading its memos'; },
  memory_read: args => { const query = argument(args, 'query', 'symbol', 'tag'); return query ? `recalling what it learned about ${topic(query)}` : 'recalling what it has learned'; },
  outcomes: () => 'reviewing how its past trades turned out',
  positions: () => 'checking its open positions',
  run_code: args => { const purpose = argument(args, 'purpose'); return purpose ? `running code: ${purpose[0].toLowerCase()}${truncate(purpose.slice(1), 100).text}` : 'running code'; },
  strategy_report: args => { const name = argument(args, 'name', 'strategy'); return name ? `reading the report on its ${humanize(name)} strategy` : 'reading its strategy reports'; },
  quote: args => { const symbol = instrumentLabel(args?.instrument) || argument(args, 'symbol', 'market_id'); return symbol ? `checking the price of ${marketTitle(symbol)}` : 'checking a price'; },
  bars: args => {
    const symbol = instrumentLabel(args?.instrument) || argument(args, 'symbol');
    const count = Number.isSafeInteger(args?.limit) ? `${args.limit} ` : '';
    const interval = INTERVAL_WORDS[show(args?.interval)] ? `${INTERVAL_WORDS[show(args.interval)]} ` : '';
    return symbol ? `reading ${count}${interval}${marketTitle(symbol)} price bars` : 'reading price history';
  },
};
export const FEED_KINDS = ['desk.thought', 'desk.tool_call', 'broker.fill', 'desk.outcome'];
function fillWords(payload) {
  const instrument = payload.instrument && typeof payload.instrument === 'object' ? payload.instrument : { symbol: show(payload.instrument) };
  const symbol = show(instrument.market_id) || show(instrument.symbol);
  if (!symbol) return '';
  const size = quantityText(payload.quantity);
  if (show(instrument.asset_class) === 'event' || symbol.startsWith('KX')) {
    const right = (show(instrument.right) || 'yes').toUpperCase();
    return `${fillVerb(payload.side)} ${size} ${right} on ${marketTitle(symbol)}${numeric(payload.price) ? ` at ${centsText(payload.price)}` : ''}`;
  }
  return `${fillVerb(payload.side)} ${size} ${marketTitle(symbol)}${numeric(payload.price) ? ` at ${priceText(payload.price)}` : ''}`;
}
// A bred desk reads with its generation as a numeral, "mullins-4" as Mullins IV, like the race.
export function floorName(id) {
  const match = /^([a-z]+)-(\d{1,3})$/.exec(show(id));
  return match ? `${partnerOf(match[1]).surname} ${roman(Number(match[2]))}` : partnerName(show(id));
}
// A model's thought as prose: its markdown emphasis and code ticks are for a renderer the floor
// does not use.
export const plainThought = value => show(value).replace(/\*\*|__|`+/g, '').replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim();
// One live line, or null for everything the floor page does not show.
export function feedLine(event, liveIds = new Set()) {
  if (!event || !FEED_KINDS.includes(event.kind)) return null;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
  const desk = streamDeskOf(event.stream) || show(payload.desk_id);
  if (!deskId(desk) || desk === 'settlement') return null;
  const practice = payload.shadow === true || event.stream === 'broker:shadow' || !(liveIds instanceof Set && liveIds.has(desk));
  const base = { id: show(event.id), seq: Number(event.seq) || 0, at: show(event.at), desk, name: floorName(desk), practice, pnl: '', tone: '' };
  if (event.kind === 'desk.thought') {
    const text = plainThought(payload.text);
    return text ? { ...base, kind: 'thinking', text } : null;
  }
  if (event.kind === 'desk.tool_call') {
    const words = RESEARCH[show(payload.tool)];
    if (!words) return null;
    let text = '';
    try { text = words(payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {}); } catch { text = ''; }
    return text ? { ...base, kind: 'researching', text } : null;
  }
  if (event.kind === 'broker.fill') {
    // A settlement is the outcome's line; a reversal only undoes a mistaken record.
    if (payload.settlement === true || show(payload.note) || /reversal/.test(`${show(event.id)} ${show(payload.fill_id)}`)) return null;
    const text = fillWords(payload);
    return text ? { ...base, kind: 'trading', text } : null;
  }
  const symbol = outcomeSymbol(payload);
  if (!symbol) return null;
  const result = show(payload.result);
  const how = result === 'sold' ? 'sold' : result ? `settled ${result.toUpperCase()}` : '';
  const pnl = looseAmount(payload.pnl);
  return {
    ...base, kind: 'trading', text: `closed ${marketTitle(symbol)}${how ? `, ${how}` : ''}`,
    pnl: numeric(pnl) ? signedMoney(pnl, 2) : '', tone: numeric(pnl) ? signOf(pnl) : '',
  };
}
// Numbers and whitespace aside, is this the same line again?
const sameness = line => `${line.kind}|${line.text.toLowerCase().replace(/[−+$]?\d[\d.,]*[¢%]?/g, '#').replace(/\s+/g, ' ').trim()}`;
// The live feed, newest first. A desk repeating itself folds into one line with a count.
export function feedLines(events, liveIds = new Set(), { limit = 12, skip = [] } = {}) {
  const skipped = new Set((Array.isArray(skip) ? skip : [skip]).filter(Boolean));
  const ordered = [...(Array.isArray(events) ? events : [])].filter(event => event && typeof event === 'object')
    .sort((left, right) => ((Number(right.seq) || 0) - (Number(left.seq) || 0)) || (Date.parse(right.at) - Date.parse(left.at)));
  const lines = [];
  const lastByDesk = new Map();
  const seen = new Set();
  for (const event of ordered) {
    if (skipped.has(event.id) || seen.has(event.id)) continue;
    seen.add(event.id);
    const line = feedLine(event, liveIds);
    if (!line) continue;
    const key = sameness(line);
    const previous = lastByDesk.get(line.desk);
    if (previous && previous.key === key) { previous.count += 1; continue; }
    if (lines.length >= limit) break;
    const entry = { ...line, key, count: 1 };
    lines.push(entry);
    lastByDesk.set(line.desk, entry);
  }
  return lines.map(({ key, ...line }) => line);
}
// Who the page watches think: the newest thought, but a desk mid-session keeps the stage while
// it is still talking, so the text does not jump between desks every few seconds.
export function heroThought(events, currentDesk = null, { holdMs = 45000 } = {}) {
  const list = [...(Array.isArray(events) ? events : [])].filter(event => event && typeof event === 'object')
    .sort((left, right) => (Date.parse(right.at) - Date.parse(left.at)) || ((Number(right.seq) || 0) - (Number(left.seq) || 0)));
  const thoughts = list.filter(event => event.kind === 'desk.thought' && deskId(streamDeskOf(event.stream)) && show(event.payload?.text).trim());
  if (!thoughts.length) return null;
  let pick = thoughts[0];
  if (currentDesk) {
    const own = thoughts.find(event => streamDeskOf(event.stream) === currentDesk);
    const ended = own && list.some(event => event.kind === 'desk.session_ended' && streamDeskOf(event.stream) === currentDesk && Date.parse(event.at) >= Date.parse(own.at));
    if (own && !ended && Date.parse(thoughts[0].at) - Date.parse(own.at) <= holdMs) pick = own;
  }
  const desk = streamDeskOf(pick.stream);
  const session = show(pick.payload?.session_id);
  const research = list.map(event => (event.kind === 'desk.tool_call' && streamDeskOf(event.stream) === desk && Date.parse(event.at) >= Date.parse(pick.at) - 120000
    && (!session || !show(event.payload?.session_id) || show(event.payload.session_id) === session) ? feedLine(event) : null)).find(Boolean);
  return { id: show(pick.id), desk, at: show(pick.at), session, text: plainThought(pick.payload.text), research: research ? research.text : '', researchId: research ? research.id : '' };
}

// ---- the portfolio
// The balance history from the floor's own marks. A step of more than `flowShare` of the balance,
// or of one venue's balance, between two marks is money moving in or out rather than trading, so
// the line starts after the last one.
export function balanceSeries(events, { flowShare = 0.15, width = 1000, height = 120 } = {}) {
  const marks = (Array.isArray(events) ? events : []).filter(event => event?.kind === FLOOR_MARK.kind)
    .map(event => ({
      at: Date.parse(event.at), equity: Number(event.payload?.account_equity),
      venues: new Map((Array.isArray(event.payload?.venues) ? event.payload.venues : []).map(row => [show(row?.venue), Number(row?.equity)])),
    }))
    .filter(point => Number.isFinite(point.at) && Number.isFinite(point.equity))
    .sort((left, right) => left.at - right.at);
  const jump = (before, after) => Number.isFinite(before) && Number.isFinite(after) && before > 0 && Math.abs(after - before) / before > flowShare;
  let start = 0;
  for (let index = 1; index < marks.length; index += 1) {
    const [before, after] = [marks[index - 1], marks[index]];
    if (jump(before.equity, after.equity) || [...after.venues].some(([venue, equity]) => jump(before.venues.get(venue), equity))) start = index;
  }
  const all = marks.map(({ at, equity }) => ({ at, equity }));
  const points = all.slice(start);
  if (points.length < 2) return null;
  const values = points.map(point => point.equity);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1) { min -= 1; max += 1; }
  const span = points.at(-1).at - points[0].at || 1;
  const x = at => (at - points[0].at) / span * width;
  const y = value => 6 + (max - value) / (max - min) * (height - 12);
  const plotted = points.map(point => ({ ...point, x: x(point.at), y: y(point.equity) }));
  const path = plotted.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const change = points.at(-1).equity - points[0].equity;
  return {
    width, height, points: plotted, min, max, first: plotted[0], last: plotted.at(-1), path,
    area: `${path} L${width},${height} L0,${height} Z`, flowCut: start > 0,
    change, changeText: signedMoney(change.toFixed(2), 2), tone: change > 0 ? 'positive' : change < 0 ? 'negative' : '',
  };
}
// Real-money positions worth showing. Practice positions and dust are counted, not listed.
export function openPositionRows(checkpoint, { minValue = 0.5 } = {}) {
  const rows = [];
  let practice = 0;
  let dust = 0;
  for (const desk of orderDesks(checkpoint?.desks).filter(item => item && typeof item === 'object')) {
    for (const position of Array.isArray(desk.positions) ? desk.positions : []) {
      if (!position || typeof position !== 'object') continue;
      if (!isLive(desk)) { practice += 1; continue; }
      const value = Number(position.market_value);
      if (!(Math.abs(value) >= minValue)) { dust += 1; continue; }
      const unrealized = looseAmount(position.unrealized_pnl);
      const symbol = instrumentLabel(position.instrument);
      const event = show(position.instrument?.asset_class) === 'event' || symbol.startsWith('KX');
      const side = show(position.side);
      const pnl = numeric(unrealized) ? unrealized : '';
      rows.push({
        desk: show(desk.id), name: raceName(desk), symbol, market: marketTitle(symbol) || '—',
        side: event ? (side === 'no' || side === 'short' ? 'NO' : 'YES') : side, value, valueText: money(looseAmount(position.market_value), 2),
        pnlText: pnl ? signedMoney(pnl, 2) : '—', tone: pnl ? signOf(pnl) : '', ...thesisParts(position.thesis),
      });
    }
  }
  return { rows: rows.sort((left, right) => right.value - left.value), practice, dust };
}
// The one line under an empty book.
export function flatLine(checkpoint) {
  const total = accountEquity(checkpoint?.floor);
  const venues = accountVenues(checkpoint?.floor).map(row => row.name);
  return `No real-money position open.${total === null ? '' : ` ${money(total, 0)} in cash${venues.length ? ` across ${venues.join(' and ')}` : ''}.`}`;
}

// ---- past trades: every settled or exited trade, who took it and why
// The four partners the owner wrote; families the floor founded itself start in a shadow book.
const HUMAN_FOUNDERS = new Set(['mullins', 'scholes', 'haghani', 'hilibrand']);
function isFounded(desk) {
  return !HUMAN_FOUNDERS.has(show(desk.id));
}

export function closedRows(events, checkpoint, { limit = 40 } = {}) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const live = new Set(desks.filter(desk => isLive(desk)).map(desk => show(desk.id)));
  // The four founders traded real money from the first day; an outcome written before the
  // runtime recorded `real_money` is real when its desk is live now or is a founder, so a
  // later demotion does not turn a real loss into practice.
  const founders = new Set(desks.filter(desk => desk.parent_id === null && Number(desk.generation) === 1 && !isFounded(desk)).map(desk => show(desk.id)));
  return (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === 'desk.outcome' && typeof event.stream === 'string' && event.stream.startsWith('desk:'))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, limit)
    .map(event => {
      const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
      const desk = event.stream.slice(5);
      const pnl = numeric(looseAmount(p.pnl)) ? looseAmount(p.pnl) : '';
      const result = show(p.result);
      const reason = thesisParts(p.rationale_excerpt, 90);
      return {
        id: show(event.id), at: show(event.at), desk, name: floorName(desk),
        live: typeof p.real_money === 'boolean' ? p.real_money : live.has(desk) || founders.has(desk),
        instrument: show(p.market_id) || instrumentLabel(p.instrument) || '—', market: marketTitle(outcomeSymbol(p)) || '—', right: show(p.instrument?.right).toUpperCase(),
        result: humanize(result), outcome: result === 'sold' ? 'sold' : !pnl ? 'closed' : Number(pnl) > 0 ? 'won' : Number(pnl) < 0 ? 'lost' : 'even',
        settled: result && result !== 'sold' ? `settled ${result.toUpperCase()}` : '',
        pnl, pnlText: pnl ? signedMoney(pnl, 2) : '—', tone: pnl ? signOf(pnl) : '',
        held: p.held_for_hours === undefined || p.held_for_hours === null ? '' : `held ${show(p.held_for_hours)}h`, heldText: heldText(p.held_for_hours),
        entry: show(p.entry_price), exit: show(p.exit_price), quantity: quantity(p.quantity),
        why: truncate(show(p.rationale_excerpt).replace(/^\[strategy [a-z0-9_]+\]\s*/, ''), 240).text,
        strategy: (show(p.rationale_excerpt).match(/^\[strategy ([a-z0-9_]+)\]/) || [])[1] || '',
        tag: reason.tag, short: reason.short, full: reason.full, more: reason.more,
      };
    });
}
// The real record in one line: how many closed, how many won, what they made together.
export function closedRecord(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(row => row.live);
  if (!list.length) return '';
  const won = list.filter(row => Number(row.pnl) > 0).length;
  const total = list.reduce((sum, row) => sum + (Number(row.pnl) || 0), 0);
  return `${plural(list.length, 'real-money trade')} · ${won} won · ${signedMoney(total.toFixed(2), 2)}`;
}

// ---- who is winning, and whether the children beat their parents
const deskPnl = desk => (numeric(looseAmount(desk?.pnl_usd)) ? Number(desk.pnl_usd)
  : numeric(desk?.equity) && numeric(desk?.capital_usd) ? Number(desk.equity) - Number(desk.capital_usd) : null);
const generationOf = desk => (Number.isSafeInteger(desk?.generation) && desk.generation > 0 ? desk.generation : 1);
export function leaderboardRows(checkpoint) {
  const rows = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object').map(desk => {
    const pnl = deskPnl(desk);
    return {
      id: show(desk.id), name: raceName(desk), live: isLive(desk), inSession: Boolean(desk.live_session),
      pnl, pnlText: pnl === null ? '—' : signedMoney(pnl.toFixed(2), 2), pnlTone: pnl === null ? '' : signOf(pnl.toFixed(2)),
      returnText: numeric(desk.return_pct) ? percent(desk.return_pct) : '—', returnTone: numeric(desk.return_pct) ? signOf(desk.return_pct) : '',
      trades: Number.isSafeInteger(desk.orders) ? desk.orders : 0,
    };
  });
  const score = row => (row.pnl === null ? -Infinity : row.pnl);
  return rows.sort((left, right) => (score(right) - score(left)) || (Number(right.live) - Number(left.live)) || left.id.localeCompare(right.id))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
const FAMILY_WORDS = { weather: 'weather', crypto: 'crypto', kalshi: 'Fed & CPI', ranges: 'BTC & ETH ranges' };
const toneOf = value => (value === null || Math.abs(value) < 0.05 ? '' : value > 0 ? 'positive' : 'negative');
const returnCell = (pnl, capital) => (pnl !== null && capital > 0 ? pnl / capital * 100 : null);
const pctText = value => (value === null ? '—' : Math.abs(value) < 0.05 ? '0.0%' : `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`);
// Families as rows, generations as columns, return on capital in each cell: read left to right
// to see whether the bred children do better than the founder, and which one holds the money.
export function generationGrid(checkpoint) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  let generations = [...new Set(desks.map(generationOf))].sort((left, right) => left - right);
  if (generations.length > 6) generations = [generations[0], ...generations.slice(-5)];
  const families = [...new Set(desks.map(desk => show(desk.family) || show(desk.id)))];
  const cellOf = desk => {
    const pnl = deskPnl(desk);
    const value = numeric(desk.return_pct) ? Number(desk.return_pct) : returnCell(pnl, Number(desk.capital_usd));
    return { id: show(desk.id), name: raceName(desk), live: isLive(desk), value, text: pctText(value), tone: toneOf(value), leader: false };
  };
  const rows = families.map(family => {
    const members = desks.filter(desk => (show(desk.family) || show(desk.id)) === family);
    const founder = members.find(desk => generationOf(desk) === 1) || members[0];
    const cells = generations.map(generation => {
      const own = members.filter(desk => generationOf(desk) === generation).map(cellOf);
      return own.find(cell => cell.live) || own.sort((left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity))[0] || null;
    });
    const scored = cells.filter(cell => cell && cell.value !== null);
    const best = scored.length ? Math.max(...scored.map(cell => cell.value)) : null;
    const leaders = scored.filter(cell => cell.value === best);
    if (leaders.length === 1 && scored.length > 1) leaders[0].leader = true;
    const live = scored.find(cell => cell.live);
    return {
      family, name: partnerOf(founder).surname, word: FAMILY_WORDS[family] || humanize(family), cells,
      hasLive: Boolean(live), childAhead: Boolean(live && scored.some(cell => !cell.live && cell.value > live.value)),
    };
  });
  const all = generations.map(generation => {
    const members = desks.filter(desk => generationOf(desk) === generation);
    const pnl = members.reduce((sum, desk) => sum + (deskPnl(desk) ?? 0), 0);
    const capital = members.reduce((sum, desk) => sum + (numeric(desk.capital_usd) ? Number(desk.capital_usd) : 0), 0);
    const value = members.length ? returnCell(pnl, capital) : null;
    return { generation, value, text: pctText(value), tone: toneOf(value) };
  });
  const racing = rows.filter(row => row.hasLive && row.cells.filter(Boolean).length > 1);
  const ahead = racing.filter(row => row.childAhead).length;
  const reading = racing.length
    ? `${ahead === 0 ? 'No' : `${ahead} of ${racing.length}`} ${racing.length === 1 ? 'family has' : 'families have'} a practice child beating the partner that trades real money.`
    : '';
  return { generations, rows, all, reading };
}
// How much the loop has done: children bred, desks retired and promoted, experiments run. The
// event log is trimmed, so the checkpoint's own roster is a floor under each count.
export function loopCounts(events, checkpoint) {
  const list = Array.isArray(events) ? events : [];
  const count = kind => new Set(list.filter(event => event?.kind === kind).map(event => show(event.payload?.desk_id) || show(event.id))).size;
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const experiments = new Set([
    ...list.filter(event => event?.kind === 'lab.experiment').map(event => show(event.payload?.experiment_id)).filter(Boolean),
    ...(Array.isArray(checkpoint?.lab?.experiments) ? checkpoint.lab.experiments.map(item => show(item?.experiment_id)).filter(Boolean) : []),
  ]);
  return {
    bred: Math.max(count('evolution.spawned'), desks.filter(desk => generationOf(desk) > 1 || desk.parent_id).length),
    retired: Math.max(count('evolution.retired'), desks.filter(desk => desk.status === 'retired').length),
    promoted: count('evolution.promoted'), experiments: experiments.size,
  };
}
export const loopCountLine = counts => `bred ${counts.bred} · retired ${counts.retired} · promoted ${counts.promoted} · experiments ${counts.experiments}`;

// ---- the race (on the loop page): each family's live desk and its children, who leads
export function raceRows(checkpoint) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const families = [...new Set(desks.map(desk => show(desk.family)).filter(Boolean))];
  return families.map(family => {
    const members = desks.filter(desk => show(desk.family) === family)
      .map(desk => ({
        id: show(desk.id), name: raceName(desk), live: isLive(desk), inSession: Boolean(desk.live_session),
        generation: Number.isSafeInteger(desk.generation) ? desk.generation : 1,
        score: numeric(desk.return_pct) ? Number(desk.return_pct) : null,
        scoreText: numeric(desk.return_pct) ? percent(desk.return_pct) : '—', tone: numeric(desk.return_pct) ? signOf(desk.return_pct) : '',
        badges: mutationBadges(desk.mutation), leader: false,
      }))
      .sort((left, right) => left.generation - right.generation || left.id.localeCompare(right.id));
    const scored = members.filter(member => member.score !== null);
    const best = scored.length ? Math.max(...scored.map(member => member.score)) : null;
    const leaders = scored.filter(member => member.score === best);
    if (leaders.length === 1 && members.length > 1) leaders[0].leader = true;
    const live = members.find(member => member.live);
    return { family, label: venueLabel(family), live: live ? live.name : '', members };
  });
}
// "2 experiments running · generation II vs I: +0.90%", or what the race is waiting for.
export function raceLine(lab, rows = []) {
  const running = (Array.isArray(lab?.experiments) ? lab.experiments : []).filter(item => item?.status === 'running').length;
  const curve = (Array.isArray(lab?.curve) ? lab.curve : []).filter(row => row && Number.isSafeInteger(row.generation)).sort((left, right) => left.generation - right.generation);
  const parts = [];
  if (running) parts.push(`${running} experiment${running === 1 ? '' : 's'} running`);
  if (curve.length >= 2 && curve.some(row => Number(row.decisions) > 0)) {
    const [before, after] = curve.slice(-2);
    const delta = Number(after.cost_adjusted_excess_pct) - Number(before.cost_adjusted_excess_pct);
    parts.push(`generation ${roman(after.generation)} vs ${roman(before.generation)}: ${percent(delta.toFixed(4))}`);
  }
  if (!parts.length) {
    const children = rows.reduce((sum, row) => sum + row.members.filter(member => member.generation > 1).length, 0);
    return children ? 'Children are scored on real prices. The first to beat its parent on the published gate takes the sleeve.' : 'The race starts with the first bred variant.';
  }
  return parts.join(' · ');
}
function racePanel(checkpoint) {
  const rows = raceRows(checkpoint);
  if (!rows.length) return [element('p', 'The families appear with the first checkpoint.', 'empty-state')];
  const nodes = [];
  for (const row of rows) {
    const line = element('div', null, 'race-row');
    line.append(element('span', row.label, 'race-family'));
    const chips = element('span', null, 'race-chips');
    for (const member of row.members) {
      const chip = link('', deskHref(member.id), `race-chip${member.live ? ' race-live' : ''}${member.leader ? ' race-leader' : ''}`);
      if (member.live) { const dot = element('span', null, 'badge-dot'); dot.setAttribute('aria-hidden', 'true'); chip.append(dot); }
      chip.append(element('b', member.name));
      chip.append(element('span', member.scoreText, member.tone));
      if (member.leader) chip.append(element('i', '★ leads'));
      if (member.inSession) chip.append(element('i', 'thinking', 'race-thinking'));
      chip.setAttribute('title', join(member.live ? 'live: real money' : 'shadow: scored, never sent', ...member.badges.map(badge => badge.text)));
      chips.append(chip);
    }
    line.append(chips);
    nodes.push(line);
  }
  nodes.push(element('p', raceLine(checkpoint?.lab, rows), 'race-line'));
  const bred = rows.flatMap(row => row.members.filter(member => member.badges.length));
  if (bred.length) {
    const more = element('details', null, 'race-more');
    more.append(element('summary', 'how the children differ'));
    for (const member of bred) {
      const item = element('div', null, 'race-diff');
      item.append(element('b', member.name), badgeRow(member.badges));
      more.append(item);
    }
    more.append(link('the loop: experiments, verdicts, the curve ↗', '/capital/committee/', 'race-loop-link'));
    nodes.push(more);
  } else nodes.push(link('the loop ↗', '/capital/committee/', 'race-loop-link'));
  return nodes;
}

// ---- the floor page, drawn
const FEED_LINES = 12;
const TRADE_ROWS = 8;
const HERO_TEXT_LIMIT = 420;
const FEED_LABELS = { thinking: 'thinking', researching: 'researching', trading: 'trading' };
const tagNode = (text, kind) => element('span', text, `tag tag-${kind}`);
const modeTag = live => tagNode(live ? 'real money' : 'practice', live ? 'real' : 'practice');
function pulse(className = 'pulse') {
  const dot = element('span', null, className);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}
// CSSOM, not a style attribute: the page's policy allows the one and refuses the other.
function place(node, properties) {
  try { for (const [key, value] of Object.entries(properties)) node.style[key] = value; } catch { /* no layout here */ }
}
// Types a thought out at a readable pace, whatever its length, in about two seconds. Off when the
// visitor asked for less motion, and anywhere without a window, where the text simply lands.
const typers = new WeakMap();
function typeInto(node, text) {
  const previous = typers.get(node);
  if (previous) clearTimeout(previous);
  const canAnimate = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    const value = element('dd', null, item.tone || null);
    const main = element('span', item.value, 'number-value');
    value.append(main);
    if (item.key === 'clock') {
      const tick = element('span', item.tick, 'number-tick');
      value.append(tick);
      state.clock = item.startedAt === null ? null : { main, tick, startedAt: item.startedAt };
    }
    if (item.note) value.append(element('span', item.note, `number-note ${item.tone}`.trim()));
    row.append(element('dt', item.label), value);
    return row;
  });
}

function heroCard(desk, id) {
  const live = isLive(desk);
  const card = element('article', null, live ? 'now now-real' : 'now');
  const head = element('div', null, 'now-head');
  const why = element('span', '', 'now-why');
  const when = element('span', '', 'now-when');
  head.append(pulse('pulse now-pulse'), link(desk ? raceName(desk) : partnerName(id), deskHref(id), 'now-name'), modeTag(live), why, when);
  const thought = element('p', '', 'now-thought');
  const research = element('p', '', 'now-research');
  card.append(head, thought, research);
  return { card, why, when, thought, research };
}
function drawHeroInto(box, state) {
  const hero = heroThought(state.feed, state.hero?.desk || null);
  if (!hero) {
    box.replaceChildren(element('p', state.checkpoint ? quietLine(state.checkpoint) : 'Connecting to the floor…', 'empty-state now-empty'));
    state.hero = null;
    return;
  }
  const desk = state.desks.get(hero.desk) || null;
  if (!state.hero || state.hero.desk !== hero.desk) {
    state.hero = { desk: hero.desk, id: '', parts: heroCard(desk, hero.desk) };
    box.replaceChildren(state.hero.parts.card);
  }
  const { parts } = state.hero;
  state.hero.researchId = hero.researchId;
  const session = desk?.live_session && typeof desk.live_session === 'object' ? desk.live_session : null;
  const recent = Date.now() - Date.parse(hero.at) < 180000;
  parts.why.textContent = session ? triggerText(session.trigger) : '';
  parts.when.textContent = session || recent ? 'thinking now' : `last thought ${ago(hero.at)}`;
  parts.card.className = `${isLive(desk) ? 'now now-real' : 'now'}${session || recent ? '' : ' now-idle'}`;
  if (state.hero.id !== hero.id) {
    state.hero.id = hero.id;
    typeInto(parts.thought, truncate(hero.text, HERO_TEXT_LIMIT).text);
  }
  parts.research.replaceChildren(...(hero.research ? [element('span', 'researching', 'feed-kind kind-researching'), element('span', hero.research)] : []));
}

function feedItem(line, state, fresh) {
  const item = element('li', null, `feed-line line-${line.kind}${line.practice ? ' line-practice' : ''}${fresh ? ' line-new' : ''}`);
  item.append(timeNode(line.at, 'hm'));
  item.append(element('span', FEED_LABELS[line.kind], `feed-kind kind-${line.kind}`));
  const who = element('span', null, 'feed-who');
  who.append(link(line.name, deskHref(line.desk), 'feed-name'));
  if (line.practice) who.append(tagNode('practice', 'practice'));
  const open = state.expanded.has(line.id);
  const body = element(line.kind === 'thinking' ? 'button' : 'span', null, `feed-text${open ? ' feed-open' : ''}`);
  if (line.kind === 'thinking') {
    body.type = 'button';
    body.setAttribute('aria-expanded', open ? 'true' : 'false');
    body.addEventListener('click', () => {
      if (state.expanded.has(line.id)) state.expanded.delete(line.id); else state.expanded.add(line.id);
      state.drawFeed();
    });
  }
  body.append(element('span', line.text, 'feed-words'));
  if (line.pnl) body.append(element('b', line.pnl, `feed-pnl ${line.tone}`.trim()));
  if (line.count > 1) body.append(element('span', `×${line.count}`, 'feed-count'));
  item.append(who, body);
  return item;
}
function drawFeedInto(list, state) {
  const lines = feedLines(state.feed, state.liveIds, { limit: FEED_LINES, skip: [state.hero?.id, state.hero?.researchId] });
  const items = lines.map(line => feedItem(line, state, state.primed && !state.rendered.has(line.id)));
  state.rendered = new Set(lines.map(line => line.id));
  state.primed = true;
  list.replaceChildren(...(items.length ? items : [element('li', 'Quiet for now. Lines appear here as the partners think, research and trade.', 'empty-state')]));
}

function balanceChart(series) {
  const figure = element('figure', null, `balance balance-${series.tone || 'flat'}`);
  const { width, height } = series;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', class: 'balance-svg',
    role: 'img', 'aria-label': `Portfolio value, ${money(series.first.equity.toFixed(2), 2)} to ${money(series.last.equity.toFixed(2), 2)}.`,
  });
  svg.append(svgElement('line', { x1: 0, x2: width, y1: series.first.y.toFixed(1), y2: series.first.y.toFixed(1), class: 'balance-base' }));
  svg.append(svgElement('path', { d: series.area, class: 'balance-area' }), svgElement('path', { d: series.path, class: 'balance-line' }));
  const cross = svgElement('line', { x1: 0, x2: 0, y1: 0, y2: height, class: 'balance-cross', opacity: 0 });
  svg.append(cross);
  const plot = element('div', null, 'balance-plot');
  const end = element('span', null, 'balance-dot');
  place(end, { left: `${(series.last.x / width * 100).toFixed(2)}%`, top: `${(series.last.y / height * 100).toFixed(2)}%` });
  const readout = element('span', '', 'balance-readout');
  readout.hidden = true;
  plot.append(svg, end, element('span', money(series.max.toFixed(2), 0), 'balance-max'), element('span', money(series.min.toFixed(2), 0), 'balance-min'), readout);
  // Hover: a crosshair and the balance at the nearest mark.
  plot.addEventListener('pointermove', move => {
    try {
      const box = svg.getBoundingClientRect();
      const x = (move.clientX - box.left) / box.width * width;
      const nearest = series.points.reduce((best, point) => (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best), series.points[0]);
      cross.setAttribute('x1', nearest.x.toFixed(1));
      cross.setAttribute('x2', nearest.x.toFixed(1));
      cross.setAttribute('opacity', '1');
      readout.textContent = `${money(nearest.equity.toFixed(2), 2)} · ${date(new Date(nearest.at).toISOString())}`;
      readout.hidden = false;
      place(readout, { left: `${Math.min(80, Math.max(0, nearest.x / width * 100 - 10)).toFixed(2)}%` });
    } catch { /* no layout here */ }
  });
  plot.addEventListener('pointerleave', () => { readout.hidden = true; cross.setAttribute('opacity', '0'); });
  const caption = element('figcaption', null, 'balance-caption');
  const since = element('span', 'since ');
  since.append(timeNode(new Date(series.first.at).toISOString()));
  const now = element('span', null, 'balance-now');
  now.append(element('b', series.changeText, series.tone || null), element('span', ` · now ${money(series.last.equity.toFixed(2), 2)}`));
  caption.append(since, now);
  figure.append(plot, caption);
  return figure;
}
function portfolioPanel(checkpoint, marks) {
  const venues = accountVenues(checkpoint?.floor);
  const series = balanceSeries(marks);
  const line = element('p', null, 'venues');
  for (const row of venues) {
    const chip = element('span', null, row.stale ? 'venue venue-stale' : 'venue');
    chip.append(element('span', row.name, 'venue-name'), element('b', money(row.equity, 2)));
    if (row.stale) { chip.append(element('i', 'stale')); chip.setAttribute('title', `${row.name} did not answer the last balance request.`); }
    line.append(chip);
  }
  const nodes = venues.length || series ? [line] : [];
  if (series) nodes.push(balanceChart(series));
  return nodes;
}
function whyCell(parts, state, id) {
  const cell = element('td', null, parts.full ? 'col-why' : 'col-why why-empty');
  const tag = parts.tag ? element('span', parts.tag, 'strategy-tag') : null;
  if (!parts.more) { cell.append(...[tag, element('span', parts.short || '—', 'why-text')].filter(Boolean)); return cell; }
  const open = state.open.has(id);
  const words = element('span', open ? parts.full : parts.short, 'why-text');
  const button = element('button', null, 'why-toggle');
  button.type = 'button';
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  button.append(...[tag, words].filter(Boolean));
  button.addEventListener('click', () => {
    const next = !state.open.has(id);
    if (next) state.open.add(id); else state.open.delete(id);
    words.textContent = next ? parts.full : parts.short;
    button.setAttribute('aria-expanded', next ? 'true' : 'false');
  });
  cell.append(button);
  return cell;
}
function headRow(columns) {
  const head = element('thead');
  const row = element('tr');
  for (const [label, className] of columns) row.append(element('th', label, className));
  head.append(row);
  return head;
}
function agentCell(id, name, live, before = []) {
  const cell = element('td', null, 'col-agent');
  cell.append(...before, link(name, deskHref(id), 'agent-name'));
  if (live === false) cell.append(tagNode('practice', 'practice'));
  return cell;
}
function positionsPanel(checkpoint, state) {
  const { rows, practice } = openPositionRows(checkpoint);
  const nodes = [];
  if (!rows.length) nodes.push(element('p', flatLine(checkpoint), 'empty-state'));
  else {
    const table = element('table', null, 'rows rows-book');
    table.append(headRow([['Agent', 'col-agent'], ['Market', 'col-market'], ['Side', 'col-side'], ['Value', 'col-num'], ['P&L', 'col-num'], ['Why', 'col-why']]));
    const body = element('tbody');
    for (const row of rows) {
      const line = element('tr');
      line.append(agentCell(row.desk, row.name, true), element('td', row.market, 'col-market'), element('td', row.side, 'col-side'),
        element('td', row.valueText, 'col-num col-value'), element('td', row.pnlText, `col-num col-pnl ${row.tone}`.trim()), whyCell(row, state, `position:${row.desk}:${row.symbol}`));
      body.append(line);
    }
    table.append(body);
    nodes.push(table);
  }
  if (practice) {
    const quiet = element('p', null, 'quiet-line');
    quiet.append(link(`Shadow partners hold ${plural(practice, 'practice position')} (scored on real prices, no money) ↗`, '/capital/committee/'));
    nodes.push(quiet);
  }
  return nodes;
}
function closedPanel(state) {
  const rows = closedRows(state.outcomes, state.checkpoint, { limit: MAX_EVENT_LIMIT });
  const shown = state.practice ? rows : rows.filter(row => row.live);
  const nodes = [];
  const record = closedRecord(rows);
  if (record) nodes.push(element('p', record, 'record-line'));
  if (!shown.length) {
    nodes.push(element('p', rows.length ? 'No real-money trade has closed yet. Include practice to see the shadow partners’ trades.' : 'No trade has closed yet.', 'empty-state'));
    return nodes;
  }
  const table = element('table', null, 'rows rows-trades');
  table.append(headRow([['Agent', 'col-agent'], ['Market', 'col-market'], ['Result', 'col-result'], ['P&L', 'col-num'], ['Held', 'col-held'], ['Why', 'col-why']]));
  const body = element('tbody');
  for (const row of shown.slice(0, state.more ? MAX_EVENT_LIMIT : TRADE_ROWS)) {
    const line = element('tr', null, row.live ? '' : 'row-practice');
    const result = element('td', row.outcome, `col-result result-${row.outcome}`);
    if (row.settled) result.setAttribute('title', row.settled);
    line.append(agentCell(row.desk, row.name, row.live), element('td', row.market, 'col-market'), result,
      element('td', row.pnlText, `col-num col-pnl ${row.tone}`.trim()), element('td', row.heldText || '—', 'col-held'), whyCell(row, state, `trade:${row.id}`));
    body.append(line);
  }
  table.append(body);
  nodes.push(table);
  if (shown.length > TRADE_ROWS) {
    const more = element('button', state.more ? 'fewer' : `${shown.length - TRADE_ROWS} more`, 'chip more');
    more.type = 'button';
    more.setAttribute('aria-expanded', state.more ? 'true' : 'false');
    more.addEventListener('click', () => { state.more = !state.more; state.drawClosed(); });
    nodes.push(more);
  }
  return nodes;
}
function practiceToggle(state) {
  const button = element('button', 'include practice', state.practice ? 'chip chip-on' : 'chip');
  button.type = 'button';
  button.setAttribute('aria-pressed', state.practice ? 'true' : 'false');
  button.addEventListener('click', () => { state.practice = !state.practice; state.more = false; state.drawClosed(); });
  return button;
}
function leadersPanel(checkpoint) {
  const rows = leaderboardRows(checkpoint);
  if (!rows.length) return [element('p', 'The partners appear with the first checkpoint.', 'empty-state')];
  const table = element('table', null, 'rows rows-leaders');
  table.append(headRow([['#', 'col-rank'], ['Agent', 'col-agent'], ['P&L', 'col-num'], ['Return', 'col-num'], ['Trades', 'col-num']]));
  const body = element('tbody');
  for (const row of rows) {
    const line = element('tr', null, row.live ? 'row-real' : '');
    const extra = row.inSession ? [pulse('pulse pulse-inline')] : [];
    const agent = agentCell(row.id, row.name, null, extra);
    agent.append(modeTag(row.live));
    if (row.inSession) agent.setAttribute('title', `${row.name} is in a session now`);
    line.append(element('td', String(row.rank), 'col-rank'), agent, element('td', row.pnlText, `col-num ${row.pnlTone}`.trim()),
      element('td', row.returnText, `col-num ${row.returnTone}`.trim()), element('td', String(row.trades), 'col-num'));
    body.append(line);
  }
  table.append(body);
  return [table];
}
const heatClass = value => {
  if (value === null) return 'heat-none';
  const size = Math.abs(value);
  const level = size < 1 ? 0 : size < 5 ? 1 : size < 15 ? 2 : size < 35 ? 3 : 4;
  return level === 0 ? 'heat-0' : `heat-${value > 0 ? 'up' : 'down'}-${level}`;
};
function learningPanel(checkpoint, counts) {
  const grid = generationGrid(checkpoint);
  if (!grid.rows.length) return [element('p', 'The families appear with the first checkpoint.', 'empty-state')];
  const nodes = [];
  if (grid.reading) nodes.push(element('p', grid.reading, 'learning-reading'));
  const table = element('table', null, 'ladder');
  const head = element('thead');
  const headLine = element('tr');
  headLine.append(element('th', 'Generation', 'ladder-family'));
  for (const generation of grid.generations) {
    const cell = element('th', roman(generation), 'ladder-gen');
    if (generation === 1) cell.append(element('span', ' · founder', 'ladder-founder'));
    headLine.append(cell);
  }
  head.append(headLine);
  const body = element('tbody');
  for (const row of grid.rows) {
    const line = element('tr');
    const family = element('th', null, 'ladder-family');
    family.setAttribute('scope', 'row');
    family.append(element('b', row.name), element('span', row.word, 'ladder-word'));
    line.append(family);
    for (const cell of row.cells) {
      const box = element('td', null, `ladder-cell ${heatClass(cell ? cell.value : null)}${cell?.live ? ' ladder-live' : ''}${cell?.leader ? ' ladder-leader' : ''}`);
      if (cell) {
        const anchor = link('', deskHref(cell.id), 'ladder-link');
        anchor.setAttribute('title', `${cell.name}: ${cell.text} ${cell.live ? '· trades real money' : '· practice'}${cell.leader ? ' · best in family' : ''}`);
        if (cell.live) anchor.append(pulse('pulse pulse-inline'));
        anchor.append(element('span', cell.text, 'ladder-value'));
        if (cell.leader) anchor.append(element('span', '★', 'ladder-star'));
        box.append(anchor);
      }
      line.append(box);
    }
    body.append(line);
  }
  const foot = element('tr', null, 'ladder-all');
  const label = element('th', null, 'ladder-family');
  label.setAttribute('scope', 'row');
  label.append(element('b', 'All'), element('span', 'per generation', 'ladder-word'));
  foot.append(label);
  for (const cell of grid.all) {
    const box = element('td', null, `ladder-cell ${heatClass(cell.value)}`);
    box.append(element('span', cell.text, 'ladder-value'));
    foot.append(box);
  }
  body.append(foot);
  table.append(head, body);
  nodes.push(table);
  nodes.push(element('p', '● trades real money · ★ best in its family · return on capital', 'ladder-legend'));
  const loop = element('p', null, 'loop-line');
  loop.append(element('span', loopCountLine(counts)), link('The loop ↗', '/capital/committee/', 'loop-link'));
  nodes.push(loop);
  return nodes;
}

async function startFloor(root) {
  const find = id => root.querySelector(`#${id}`);
  const box = {
    numbers: find('floor-numbers'), status: find('floor-status'), now: find('floor-now'), feed: find('floor-feed'),
    portfolio: find('floor-portfolio'), positions: find('floor-positions'), closed: find('floor-closed'),
    toggle: find('closed-toggle'), leaders: find('floor-leaders'), learning: find('floor-learning'),
  };
  const state = {
    checkpoint: null, liveIds: new Set(), desks: new Map(), feed: [], outcomes: [], marks: [], loop: [], mode: 'loading',
    hero: null, rendered: new Set(), primed: false, expanded: new Set(), open: new Set(), practice: false, more: false, clock: null,
  };
  const ready = node => node && node.setAttribute('aria-busy', 'false');
  const drawn = (node, children) => { if (!node) return; node.replaceChildren(...children); ready(node); };
  const drawStatus = () => {
    if (!box.status) return;
    const working = state.checkpoint ? orderDesks(state.checkpoint.desks).filter(desk => desk?.live_session).length : 0;
    const words = state.mode === 'live' ? 'live' : state.mode === 'polling' ? 'live · polling' : 'connecting';
    const text = working ? `${words} · ${plural(working, 'partner')} in session` : words;
    box.status.className = `live-status live-${state.mode}`;
    // A status region re-announces whatever replaces it, so it changes only when the words do.
    if (state.statusText === text) return;
    state.statusText = text;
    box.status.replaceChildren(pulse(), element('span', text));
  };
  state.drawFeed = () => { if (box.feed) { drawFeedInto(box.feed, state); ready(box.feed); } };
  const drawLive = () => { if (box.now) { drawHeroInto(box.now, state); ready(box.now); } state.drawFeed(); };
  state.drawClosed = () => {
    if (!state.checkpoint) return;
    drawn(box.closed, closedPanel(state));
    if (box.toggle) box.toggle.replaceChildren(practiceToggle(state));
  };
  const drawPortfolio = () => { if (state.checkpoint) drawn(box.portfolio, portfolioPanel(state.checkpoint, state.marks)); };
  const drawLearning = () => { if (state.checkpoint) drawn(box.learning, learningPanel(state.checkpoint, loopCounts(state.loop, state.checkpoint))); };
  const keepFeed = events => {
    const byId = new Map([...state.feed, ...events].map(event => [event.id, event]));
    state.feed = [...byId.values()].sort((left, right) => (Number(right.seq) || 0) - (Number(left.seq) || 0)).slice(0, 400);
  };
  async function refresh() {
    try {
      state.checkpoint = await loadCheckpoint();
      const desks = orderDesks(state.checkpoint.desks).filter(desk => desk && typeof desk === 'object');
      state.desks = new Map(desks.map(desk => [show(desk.id), desk]));
      state.liveIds = new Set(desks.filter(isLive).map(desk => show(desk.id)));
      drawn(box.numbers, numbersPanel(state.checkpoint, state));
      drawPortfolio();
      drawn(box.positions, positionsPanel(state.checkpoint, state));
      drawn(box.leaders, leadersPanel(state.checkpoint));
      drawLearning();
      state.drawClosed();
      drawStatus();
      if (state.primed) drawLive();
    } catch {
      if (state.checkpoint) return;
      const notice = element('p', 'The floor checkpoint is unavailable. ', 'unavailable');
      notice.append(link('Read the runtime on GitHub.', REPOSITORY));
      drawn(box.numbers, [notice]);
      for (const node of [box.portfolio, box.positions, box.closed, box.leaders, box.learning]) drawn(node, []);
    }
  }
  await refresh();
  const loads = [
    { kind: 'desk.thought', limit: 60 }, { kind: 'desk.tool_call', limit: 100 }, { kind: 'broker.fill', limit: 60 },
    { kind: 'desk.session_ended', limit: 40 }, { kind: 'desk.outcome', limit: MAX_EVENT_LIMIT },
    { stream: 'ops', kind: 'floor.mark', limit: FLOOR_MARK_LIMIT }, { stream: 'evolution', limit: MAX_EVENT_LIMIT }, { kind: 'lab.experiment', limit: MAX_EVENT_LIMIT },
  ];
  const [thoughts, calls, fills, endings, outcomes, marks, evolution, experiments] = await Promise.all(loads.map(query => loadEvents(query).catch(() => ({ events: [] }))));
  keepFeed([...thoughts.events, ...calls.events, ...fills.events, ...endings.events, ...outcomes.events.slice(0, 40)]);
  state.outcomes = outcomes.events;
  state.marks = marks.events;
  state.loop = [...evolution.events, ...experiments.events];
  drawLive();
  drawPortfolio();
  state.drawClosed();
  drawLearning();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  // The self-improvement clock ticks in the browser between checkpoints.
  setInterval(() => {
    if (!state.clock) return;
    const parts = selfImprovingParts(Math.max(0, (Date.now() - state.clock.startedAt) / 1000));
    state.clock.main.textContent = parts.main;
    state.clock.tick.textContent = parts.tick;
  }, 1000);
  const loaded = [thoughts, calls, fills, endings, outcomes, marks, evolution, experiments].flatMap(batch => batch.events);
  const feed = startFeed({
    streams: ['all'],
    onStatus: mode => { state.mode = mode; drawStatus(); },
    onEvents: events => {
      const live = events.filter(event => FEED_KINDS.includes(event.kind) || event.kind === 'desk.session_ended');
      const closed = events.filter(event => event.kind === 'desk.outcome');
      const balance = events.filter(event => event.kind === FLOOR_MARK.kind);
      const loop = events.filter(event => event.kind.startsWith('evolution.') || event.kind === 'lab.experiment');
      if (live.length) { keepFeed(live); drawLive(); }
      if (closed.length) { state.outcomes = [...closed, ...state.outcomes].slice(0, MAX_EVENT_LIMIT); state.drawClosed(); }
      if (balance.length) { state.marks = [...state.marks, ...balance].slice(-FLOOR_MARK_LIMIT); drawPortfolio(); }
      if (loop.length) { state.loop = [...loop, ...state.loop]; drawLearning(); }
    },
  });
  feed.remember(loaded);
  feed.prime(loaded.reduce((most, event) => Math.max(most, Number(event.seq) || 0), 0));
  return feed;
}

function section(title, note) {
  const node = element('section', null, 'block');
  const heading = element('div', null, 'section-heading');
  heading.append(element('h2', title));
  if (note) heading.append(element('span', note));
  node.append(heading);
  return node;
}
function details(summaryText, body) {
  const node = element('details', null, 'panel');
  node.append(element('summary', summaryText));
  node.append(body);
  return node;
}
function setTitle(value) {
  try { if (typeof document !== 'undefined') document.title = value; } catch { /* The tab keeps its markup title. */ }
}

// ============================================================================ desk page
// "Watch it think": the desk's newest session as a stream of its own words, typed out as they
// arrive. Everything here is pure until thoughtStream, which is the one thing that owns timers.

// "just now", "14 min ago", "3 h ago", "2 d ago".
export function agoText(value, now = Date.now()) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return '';
  const seconds = Math.max(0, Math.round((now - stamp) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
// How a thought is typed: a readable pace, never longer than a few seconds however long the
// thought, in frames of `frameMs` that each reveal `chunk` characters.
export function typingSchedule(text, { charsPerSecond = 90, maxMs = 4000, frameMs = 32 } = {}) {
  const length = show(text).length;
  const totalMs = Math.min(maxMs, Math.ceil((length / charsPerSecond) * 1000));
  const frames = Math.max(1, Math.ceil(totalMs / frameMs));
  return { length, frames, frameMs, totalMs: frames * frameMs, chunk: Math.max(1, Math.ceil(length / frames)) };
}
// The desk's newest session, folded from its own stream: its thoughts and tool calls in
// order, when it opened, whether it has closed, and the memo it left.
export function sessionThoughts(events, deskId = null) {
  const list = (Array.isArray(events) ? events : []).filter(event => event && typeof event === 'object'
    && (deskId === null || event.stream === `desk:${deskId}`));
  const byTime = [...list].sort((left, right) => (Date.parse(left.at) - Date.parse(right.at)) || ((left.seq || 0) - (right.seq || 0)));
  const start = byTime.filter(event => event.kind === 'desk.session_started').at(-1) || null;
  const sessionId = show(start?.payload?.session_id) || show(byTime.filter(event => event.kind === 'desk.thought').at(-1)?.payload?.session_id);
  const inSession = event => {
    const own = show(event.payload?.session_id);
    if (own) return sessionId ? own === sessionId : true;
    return start ? Date.parse(event.at) >= Date.parse(start.at) : true;
  };
  const ended = byTime.filter(event => event.kind === 'desk.session_ended' && inSession(event)).at(-1) || null;
  const items = byTime.filter(event => (event.kind === 'desk.thought' || event.kind === 'desk.tool_call') && inSession(event)).map(event => ({
    id: event.id, at: event.at, kind: event.kind === 'desk.thought' ? 'thought' : 'call',
    text: event.kind === 'desk.thought' ? show(event.payload?.text) : join(show(event.payload?.tool), summarizeArguments(event.payload?.arguments)),
  }));
  const memo = byTime.filter(event => event.kind === 'desk.memo' && inSession(event)).at(-1) || null;
  return {
    sessionId, trigger: show(start?.payload?.trigger), startedAt: start?.at || null, endedAt: ended?.at || null,
    reason: show(ended?.payload?.reason), memo: show(memo?.payload?.title) || show(memo?.payload?.text),
    running: Boolean(start) && !ended, items,
  };
}
// The one line over the stream: thinking now, or when it stopped and what it decided.
const END_REASONS = {
  end_session: 'ended by the desk',
  no_tool_calls: 'the model stopped calling tools',
  provider_transport_timeout: 'the model provider timed out',
  provider_failed: 'the model provider failed',
  provider_cancelled: 'the model call was cancelled',
  budget_exceeded: 'budget exceeded',
  max_turns: 'used every turn',
};
export function endReason(reason) {
  const value = show(reason);
  if (!value) return 'ended';
  if (END_REASONS[value]) return END_REASONS[value];
  if (value.startsWith('incomplete:')) return `ran out of ${humanize(value.slice(11)) || 'room'}`;
  return humanize(value);
}
export function idleLine(session, now = Date.now(), liveSession = null) {
  // The checkpoint can know a session is running before its first thought reaches the tape.
  if (liveSession && typeof liveSession === 'object' && !session?.running) return join('thinking now', triggerText(liveSession.trigger));
  if (!session || !session.startedAt) {
    const last = Array.isArray(session?.items) ? session.items.at(-1) : null;
    return last ? `last thought ${agoText(last.at, now)}` : 'no session yet';
  }
  if (session.running) return join('thinking now', triggerText(session.trigger));
  const outcome = session.memo ? truncate(session.memo, 90).text : endReason(session.reason);
  return join(session.endedAt ? `ended ${agoText(session.endedAt, now)}` : 'ended', outcome);
}
// The stream itself. `load` draws a session (the last thought typed only while it runs);
// `push` types whatever arrives live, in order, tool calls as one short line each.
export function thoughtStream(container, { instant = false, schedule = typingSchedule, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const seen = new Set();
  const queue = [];
  let timer = null;
  let busy = false;
  const settle = () => { try { if ('scrollTop' in container && 'scrollHeight' in container) container.scrollTop = container.scrollHeight; } catch { /* not scrollable */ } };
  const entry = item => {
    const node = element('div', null, item.kind === 'call' ? 'thought thought-call' : 'thought');
    node.append(timeNode(item.at, 'clock'));
    const text = element('span', '', 'thought-text');
    node.append(text);
    return { node, text };
  };
  function next() {
    if (busy || !queue.length) return;
    const { item, animate } = queue.shift();
    const { node, text } = entry(item);
    const full = item.kind === 'call' ? `→ ${item.text}` : item.text;
    container.append(node);
    if (!animate || instant || item.kind === 'call') { text.textContent = full; settle(); next(); return; }
    const plan = schedule(full);
    let shown = 0;
    busy = true;
    const step = () => {
      shown = Math.min(full.length, shown + plan.chunk);
      text.textContent = full.slice(0, shown);
      settle();
      if (shown < full.length) timer = setTimer(step, plan.frameMs);
      else { timer = null; busy = false; next(); }
    };
    step();
  }
  function add(items, animate) {
    for (const item of items) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      queue.push({ item, animate });
    }
    next();
  }
  return {
    load(session) {
      if (timer) clearTimer(timer);
      timer = null; busy = false; queue.length = 0; seen.clear();
      container.replaceChildren();
      const items = Array.isArray(session?.items) ? session.items : [];
      if (!items.length) { container.append(element('p', 'Nothing said yet.', 'empty-state')); return; }
      add(items.slice(0, -1), false);
      add(items.slice(-1), Boolean(session?.running));
    },
    push(events, deskId = null) {
      const fresh = sessionThoughts(events, deskId).items;
      if (fresh.length && container.children?.length === 1 && container.children[0].className === 'empty-state') container.replaceChildren();
      add(fresh, true);
    },
    stop() { if (timer) clearTimer(timer); timer = null; busy = false; queue.length = 0; },
  };
}
// Every run of the desk's own code, newest first.
export function codeRuns(events) {
  return (Array.isArray(events) ? events : []).filter(event => event?.kind === 'desk.code_run')
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .map(event => ({
      at: event.at, purpose: show(event.payload?.purpose) || 'unnamed run', exit: Number(event.payload?.exit_code),
      seconds: show(event.payload?.seconds), hash: show(event.payload?.code_sha256).slice(0, 12), output: show(event.payload?.stdout),
      savedAs: show(event.payload?.saved_as),
    }));
}
// A desk's holdings with its own words beside each: the thesis it filed with the order, and
// what the risk engine said, read from the desk's stream rather than fetched on demand.
export function holdingRows(desk, events) {
  return positionRows({ desks: desk ? [desk] : [] }).map(row => {
    const found = row.intentId ? positionRationale(events, row.intentId) : null;
    return { ...row, rationale: found?.rationale && found.rationale !== row.thesis ? found.rationale : '', engine: found?.text || '' };
  });
}
// The header badges: generation, parent, and what changed at birth.
export function lineageBadges(desk) {
  if (!desk) return [];
  const badges = [];
  const generation = Number(desk.generation) || 1;
  badges.push({ text: generation === 1 ? 'founder' : `generation ${generation}`, changed: false });
  if (desk.parent_id) badges.push({ text: `from ${partnerName(show(desk.parent_id))}`, changed: false, href: deskHref(show(desk.parent_id)) });
  return [...badges, ...mutationBadges(desk.mutation)];
}

function deskHoldingsPanel(desk, events) {
  const block = section('Holdings');
  const rows = holdingRows(desk, events);
  if (!rows.length) {
    block.append(element('p', join('Flat', desk && numeric(desk.cash) ? `${money(desk.cash, 0)} cash` : ''), 'empty-state'));
    return block;
  }
  const list = element('div', null, 'holdings');
  for (const row of rows) {
    const item = element('article', null, 'holding');
    item.id = row.intentId ? `holding-${storyAnchor(row.intentId)}` : '';
    const head = element('div', null, 'holding-head');
    head.append(element('b', join(row.side, row.instrument)), element('span', row.venue, 'holding-venue'));
    head.append(element('span', signedMoney(row.pnl, 2), `holding-pnl ${row.tone}`));
    item.append(head);
    item.append(element('p', join(row.quantity, `in ${priceText(row.entry)}`, `now ${priceText(row.mark)}`, money(row.value, 2)), 'holding-numbers'));
    if (row.thesis) item.append(element('p', row.thesis, 'holding-thesis'));
    if (row.rationale) item.append(element('p', row.rationale, 'holding-rationale'));
    if (row.engine) item.append(element('p', row.engine, 'note'));
    const chips = element('div', null, 'exit-chips');
    for (const chip of row.chips) chips.append(element('span', chip.text, `exit-chip exit-${chip.kind}`));
    if (row.intentId) chips.append(link('story ↓', `#${storyAnchor(row.intentId)}`, 'exit-chip exit-link'));
    item.append(chips);
    list.append(item);
  }
  block.append(list);
  return block;
}
function cadenceText(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n % 3600 === 0) return `every ${n / 3600}h`;
  if (n % 60 === 0) return `every ${n / 60} min`;
  return `every ${n}s`;
}
// Working orders: what a desk is bidding and offering right now, and which strategy put it there.
export function workingRows(checkpoint) {
  const desks = Array.isArray(checkpoint?.desks) ? checkpoint.desks : [];
  const rows = [];
  for (const desk of orderDesks(desks)) {
    for (const order of Array.isArray(desk?.working) ? desk.working : []) {
      if (!order || typeof order !== 'object') continue;
      const leg = order.instrument?.right ? String(order.instrument.right).toUpperCase() : '';
      rows.push({
        desk: show(desk.id), name: partnerName(show(desk.id)), live: isLive(desk),
        instrument: instrumentLabel(order.instrument) || '—', venue: venueLabel(order.instrument?.venue),
        side: join(show(order.side), leg), quantity: quantity(order.quantity), price: order.limit_price === null ? 'market' : show(order.limit_price),
        purpose: show(order.purpose), strategy: order.strategy ? show(order.strategy) : 'session', submittedAt: show(order.submitted_at),
        story: order.intent_id ? storyHref(show(desk.id), show(order.intent_id)) : '',
      });
    }
  }
  return rows.sort((left, right) => (Number(right.live) - Number(left.live)) || String(right.submittedAt).localeCompare(String(left.submittedAt)));
}
export function workingPanel(desk) {
  const rows = workingRows({ desks: desk ? [desk] : [] });
  if (!rows.length) return null;
  const block = section('Working orders', 'resting on the book now');
  const list = element('div', null, 'working');
  for (const row of rows) {
    const item = element('article', null, 'working-order');
    const head = element('div', null, 'working-head');
    head.append(element('b', join(row.side, row.instrument)), element('span', row.venue, 'holding-venue'));
    if (row.submittedAt) head.append(timeNode(row.submittedAt, 'clock'));
    item.append(head);
    item.append(element('p', join(row.quantity, row.price === 'market' ? 'at market' : `at ${priceText(row.price)}`, row.purpose === 'exit' ? 'exit' : '', `by ${row.strategy}`), 'working-numbers'));
    if (row.story) item.append(link('story ↓', row.story, 'exit-chip exit-link'));
    list.append(item);
  }
  block.append(list);
  return block;
}
// Strategies: code the desk deployed to trade for it between sessions, with each one's record.
export function strategiesPanel(desk) {
  const rows = Array.isArray(desk?.strategies) ? desk.strategies : [];
  if (!rows.length) return null;
  const block = section('Strategies', 'code that trades for the desk between sessions');
  const list = element('div', null, 'strategies');
  for (const row of rows) {
    const item = element('article', null, 'strategy');
    const head = element('div', null, 'strategy-head');
    head.append(element('b', show(row.name)));
    if (row.house) head.append(element('span', 'house starter', 'strategy-badge'));
    head.append(element('span', cadenceText(row.cadence_seconds), 'strategy-cadence'));
    if (row.last_run_at) head.append(timeNode(row.last_run_at, 'clock'));
    item.append(head);
    const pnl = numeric(row.settled_pnl_usd) ? Number(row.settled_pnl_usd) : 0;
    const record = join(
      `${show(row.runs)} runs`,
      `${show(row.approved)} of ${show(row.intents)} orders approved`,
      `${show(row.fills)} fills`,
      row.settled > 0 ? `${show(row.wins)} of ${show(row.settled)} settled won, ${signedMoney(row.settled_pnl_usd, 2)}` : 'nothing settled yet',
      row.errors > 0 ? `${show(row.errors)} errors` : '',
    );
    item.append(element('p', record, `strategy-record ${row.settled > 0 ? (pnl >= 0 ? 'up' : 'down') : ''}`));
    // Why these settings: a promotion from a sibling, a lab experiment, or the house. Then the settings.
    if (row.note) item.append(element('p', show(row.note), 'strategy-note'));
    if (row.params && typeof row.params === 'object' && Object.keys(row.params).length) {
      item.append(element('p', Object.entries(row.params).map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(',') : show(value)}`).join(' · '), 'strategy-params'));
    }
    if (row.last_notes) item.append(element('p', row.last_notes, 'strategy-notes'));
    list.append(item);
  }
  block.append(list);
  return block;
}
function toolboxPanel(events) {
  const runs = codeRuns(events);
  if (!runs.length) return null;
  const block = section('Toolbox', 'code the desk wrote and ran');
  const list = element('div', null, 'runs');
  for (const run of runs.slice(0, 12)) {
    const item = element('div', null, run.exit === 0 ? 'run' : 'run run-failed');
    const head = element('div', null, 'run-head');
    head.append(element('b', run.purpose), element('span', join(run.exit === 0 ? 'ran' : `exit ${run.exit}`, run.seconds ? `${run.seconds}s` : '', run.savedAs ? `saved as ${run.savedAs}` : '', run.hash && `#${run.hash}`), 'run-meta'));
    head.append(timeNode(run.at, 'clock'));
    item.append(head);
    if (run.output) item.append(details('output', element('pre', run.output, 'run-output')));
    list.append(item);
  }
  // Code runs are the desk's workshop, not its shop window: one line, open on demand.
  block.append(details(`${runs.length} run${runs.length === 1 ? '' : 's'}, newest first`, list));
  return block;
}
function playbookPanel(events) {
  const rewrite = latestPlaybook(events);
  const body = element('div');
  if (rewrite) {
    const meta = element('p', null, 'playbook-meta');
    meta.append(element('span', rewrite.version ? `v${rewrite.version} · ` : ''));
    meta.append(timeNode(rewrite.at));
    body.append(meta);
    if (rewrite.reason) body.append(element('p', rewrite.reason, 'playbook-reason'));
    if (rewrite.diff) body.append(diffBlock(rewrite.diff));
  } else body.append(element('p', 'Not rewritten yet.', 'empty-state'));
  return details(rewrite ? `Playbook · rewritten ${agoText(rewrite.at)}` : 'Playbook', body);
}
function deskHeader(header, desk, partner, marks) {
  header.replaceChildren(element('h1', partnerName(partner.id)));
  header.append(element('p', partnerRole(partner) || (desk ? desk.family : partner.id), 'partner-role'));
  if (!desk) { header.append(element('p', 'No checkpoint row yet.', 'note')); return; }
  const live = isLive(desk);
  const mode = element('p', null, 'desk-mode');
  mode.append(modeBadge(desk), element('span', live ? 'Trading real money.' : 'Shadow: scored on real prices, never sent.'));
  const running = liveNow(desk);
  if (running) mode.append(running);
  header.append(mode);
  const badges = lineageBadges(desk);
  const row = element('div', null, 'mutation mutation-row');
  for (const badge of badges) row.append(badge.href ? link(badge.text, badge.href, badge.changed ? 'mutation-badge mutation-changed' : 'mutation-badge') : element('span', badge.text, badge.changed ? 'mutation-badge mutation-changed' : 'mutation-badge'));
  header.append(row);
  const shadow = live ? '' : ' (shadow)';
  const numbers = facts([
    [`Equity${shadow}`, money(desk.equity, 0)], ['Today', signedMoney(desk.daily_pnl, 2)], ['Return', percent(desk.return_pct)],
    ['Drawdown', percent(desk.max_drawdown_pct).replace('+', '−')], ['Days', String(desk.days_live)], ['Sail cost', money(desk.cost_usd, 2)],
    ['Gate', desk.gate ? `${desk.gate.name} · ${desk.gate.passed ? 'passed' : 'not met'}` : 'none yet'],
  ]);
  header.append(numbers);
  const spark = element('p', null, 'desk-spark');
  spark.append(sparkFigure(marks));
  header.append(spark);
  if (partner.mandate) header.append(details('Mandate', element('p', partner.mandate, 'mandate')));
}

async function startDesk(root) {
  const header = root.querySelector('#desk-header');
  const detail = root.querySelector('#desk-detail');
  const tape = root.querySelector('#desk-tape');
  const status = root.querySelector('#desk-status');
  const think = root.querySelector('#desk-think');
  const thinkState = root.querySelector('#think-state');
  const id = new URLSearchParams(window.location.search).get('id');
  if (!deskId(id)) {
    header.replaceChildren(element('h1', 'No such desk'), element('p', 'Open one from the floor.', 'note'));
    detail.replaceChildren();
    if (tape) tape.replaceChildren();
    return null;
  }
  statusLine(status, 'loading', null);
  let desk = null;
  try { desk = await loadDesk(id); } catch { /* The manifest facts stay blank until the next checkpoint. */ }
  const partner = partnerOf(desk || id);
  setTitle(`${partner.surname} · LTCM`);
  const [deskEvents, marks, fills, decisions, orders, labEvents] = await Promise.all([
    loadEvents({ stream: `desk:${id}`, limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
    loadEvents({ stream: `ledger:${id}`, kind: 'ledger.mark', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
    loadEvents({ kind: 'broker.fill', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
    loadEvents({ kind: 'risk.decision', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
    loadEvents({ kind: 'broker.order', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
    loadEvents({ stream: 'lab', kind: 'lab.calibration', limit: 100 }).catch(() => ({ events: [] })),
  ]);
  deskHeader(header, desk, partner, marks.events);
  // The hero: the newest session, typed. A page opened mid-session catches up instantly and
  // types only what arrives from here on.
  const stream = think ? thoughtStream(think, { instant: typeof requestAnimationFrame === 'undefined' }) : null;
  const session = sessionThoughts(deskEvents.events, id);
  if (stream) { stream.load(session); think.setAttribute('aria-busy', 'false'); }
  if (thinkState) thinkState.textContent = idleLine(session, Date.now(), desk?.live_session);
  const storyEvents = [...deskEvents.events, ...decisions.events, ...orders.events, ...fills.events];
  const panels = [
    deskHoldingsPanel(desk, storyEvents),
    storiesSection(storyEvents, id),
  ];
  const eventDesk = Array.isArray(desk?.venues) && desk.venues.includes('kalshi') || (desk?.calibration && typeof desk.calibration === 'object');
  if (eventDesk || latestCalibration(labEvents.events, { scope: 'desk', desk_id: id })) panels.push(calibrationCard(desk, latestCalibration(labEvents.events, { scope: 'desk', desk_id: id })));
  const working = workingPanel(desk);
  if (working) panels.splice(1, 0, working);  // right under the holdings: the book as it stands
  const strategies = strategiesPanel(desk);
  if (strategies) panels.push(strategies);
  const toolbox = toolboxPanel(deskEvents.events);
  if (toolbox) panels.push(toolbox);
  panels.push(playbookPanel(deskEvents.events));
  detail.replaceChildren(...panels);
  detail.setAttribute('aria-busy', 'false');
  const state = {
    events: deskEvents.events, expanded: new Set(), active: new Set(),
    redraw: () => { if (tape) renderTape(tape, state.events, state); },
  };
  state.redraw();
  const feed = startFeed({
    streams: [`desk:${id}`, `ledger:${id}`],
    onStatus: mode => statusLine(status, mode, desk?.updated_at || null),
    onEvents: events => {
      state.events = [...events, ...state.events].slice(0, TAPE_LIMIT * 2);
      state.redraw();
      const arrived = events.filter(event => event.stream === `desk:${id}`);
      if (!arrived.length) return;
      if (arrived.some(event => event.kind === 'desk.session_started')) {
        const opened = sessionThoughts(state.events, id);
        if (stream) stream.load(opened);
        if (thinkState) thinkState.textContent = idleLine(opened);
        return;
      }
      if (stream) stream.push(arrived, id);
      if (thinkState && arrived.some(event => event.kind === 'desk.session_ended' || event.kind === 'desk.memo')) thinkState.textContent = idleLine(sessionThoughts(state.events, id));
    },
  });
  const original = feed.stop;
  feed.stop = () => { if (stream) stream.stop(); original(); };
  feed.remember(state.events);
  feed.prime(state.events[0]?.seq || 0);
  return feed;
}

// ============================================================================ the loop page
// Each family's house genome: what the lab adopted, and what its children were born with.
export function genomeSummary(evolutionEvents, labEvents) {
  const families = new Map();
  const family = name => {
    if (!families.has(name)) families.set(name, { family: name, children: 0, models: new Set(), efforts: new Set(), adopted: [], rejected: 0, running: 0 });
    return families.get(name);
  };
  for (const event of (Array.isArray(evolutionEvents) ? evolutionEvents : []).filter(event => event?.kind === 'evolution.spawned')) {
    const row = family(show(event.payload?.family) || 'unknown');
    row.children += 1;
    const mutation = event.payload?.mutation && typeof event.payload.mutation === 'object' ? event.payload.mutation : {};
    if (mutation.model_profile) row.models.add(profileName(show(mutation.model_profile)));
    if (mutation.reasoning_effort) row.efforts.add(show(mutation.reasoning_effort));
  }
  const experiments = new Map();
  for (const event of (Array.isArray(labEvents) ? labEvents : []).filter(event => event?.kind === 'lab.experiment')) {
    const id = show(event.payload?.experiment_id);
    if (id) experiments.set(id, event.payload);
    if (event.payload?.status === 'running') family(show(event.payload?.family) || 'unknown').running += 1;
  }
  for (const event of (Array.isArray(labEvents) ? labEvents : []).filter(event => event?.kind === 'lab.verdict')) {
    const experiment = experiments.get(show(event.payload?.experiment_id));
    const row = family(show(experiment?.family) || 'unknown');
    if (event.payload?.status === 'adopted') row.adopted.push({ at: event.at, change: changeSummary(experiment?.change) || 'change adopted', hypothesis: show(experiment?.hypothesis) });
    else if (event.payload?.status === 'rejected') row.rejected += 1;
  }
  return [...families.values()].map(row => ({ ...row, models: [...row.models].sort(), efforts: [...row.efforts].sort() }))
    .filter(row => row.family !== 'unknown' || row.adopted.length)
    .sort((left, right) => left.family.localeCompare(right.family));
}
// The newest allocation with Meriwether's reason per desk, when the record carries one.
export function allocationReasons(events) {
  const latest = (Array.isArray(events) ? events : []).filter(event => event?.kind === 'committee.allocation'
    && event.payload?.allocations && typeof event.payload.allocations === 'object')
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
  if (!latest) return { at: null, rows: [] };
  const reasons = latest.payload.reasons && typeof latest.payload.reasons === 'object' ? latest.payload.reasons : {};
  const rows = Object.entries(latest.payload.allocations).map(([id, usd]) => ({ desk: id, name: partnerName(id), usd: show(usd), reason: show(reasons[id]) }))
    .sort((left, right) => (scaled(right.usd) > scaled(left.usd) ? 1 : -1));
  return { at: latest.at, rows };
}
function genomePanel(rows) {
  if (!rows.length) return element('p', 'Nothing bred yet.', 'empty-state');
  const list = element('div', null, 'genomes');
  for (const row of rows) {
    const card = element('article', null, 'genome');
    const head = element('div', null, 'genome-head');
    head.append(element('b', `${row.family} family`), element('span', join(`${row.children} ${row.children === 1 ? 'child' : 'children'}`, row.running ? `${row.running} running` : '', row.rejected ? `${row.rejected} rejected` : ''), 'genome-meta'));
    card.append(head);
    if (row.models.length || row.efforts.length) card.append(element('p', join(row.models.length ? `models ${row.models.join(', ')}` : '', row.efforts.length ? `effort ${row.efforts.join(', ')}` : ''), 'genome-born'));
    if (row.adopted.length) {
      const adopted = element('ul', null, 'genome-adopted');
      for (const change of row.adopted) {
        const item = element('li', change.change);
        item.append(element('span', join(change.hypothesis, agoText(change.at)), 'genome-why'));
        adopted.append(item);
      }
      card.append(adopted);
    } else card.append(element('p', 'No change adopted yet.', 'note'));
    list.append(card);
  }
  return list;
}

async function startCommittee(root) {
  const status = root.querySelector('#committee-status');
  const allocations = root.querySelector('#committee-allocations');
  const gates = root.querySelector('#committee-gates');
  const memos = root.querySelector('#committee-memos');
  const history = root.querySelector('#committee-evolution');
  const labBox = root.querySelector('#committee-lab');
  const calibrationBox = root.querySelector('#committee-calibration');
  const curveBox = root.querySelector('#loop-curve');
  const raceBox = root.querySelector('#loop-race');
  const genomeBox = root.querySelector('#loop-genome');
  statusLine(status, 'loading', null);
  let checkpoint = null;
  try { checkpoint = await loadCheckpoint(); } catch { /* The numbers wait for the first checkpoint. */ }
  if (checkpoint) statusLine(status, 'loading', checkpoint.published_at);
  const [committeeEvents, evolution, labEvents] = await Promise.all([
    loadEvents({ stream: 'committee', limit: 100 }).catch(() => ({ events: [] })),
    loadEvents({ stream: 'evolution', limit: 100 }).catch(() => ({ events: [] })),
    loadEvents({ stream: 'lab', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
  ]);
  if (curveBox) {
    curveBox.replaceChildren(curveFigure(checkpoint?.lab));
    curveBox.setAttribute('aria-busy', 'false');
  }
  if (raceBox) {
    // Each family's live desk and its shadow children, who leads, how the children differ.
    raceBox.replaceChildren(...(checkpoint ? racePanel(checkpoint) : [element('p', 'The race appears with the first checkpoint.', 'empty-state')]));
    raceBox.setAttribute('aria-busy', 'false');
  }
  if (labBox) {
    // The checkpoint's experiments carry their verdicts; the lab stream carries the record.
    const verdicts = labEvents.events.filter(event => event.kind === 'lab.verdict').sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
    labBox.replaceChildren(experimentsPanel(checkpoint?.lab, { empty: 'None yet. The lab proposes after its first nightly review.' }));
    if (verdicts.length) {
      labBox.append(table(['Time', 'Experiment', 'Verdict', 'Why'], verdicts.slice(0, 30).map(event => [
        date(event.at), show(event.payload?.experiment_id) || '—', show(event.payload?.status) || '—', truncate(show(event.payload?.reason), 120).text,
      ])));
    }
    labBox.setAttribute('aria-busy', 'false');
  }
  if (genomeBox) {
    genomeBox.replaceChildren(genomePanel(genomeSummary(evolution.events, labEvents.events)));
    genomeBox.setAttribute('aria-busy', 'false');
  }
  if (calibrationBox) {
    const families = familyCalibrations(labEvents.events);
    calibrationBox.replaceChildren(families.length
      ? table(['Family', 'Forecasts', 'Brier', 'As of'], families.map(row => [`${row.family} family`, String(row.n), show(row.brier), date(row.as_of, 'day')]))
      : element('p', 'Appears once a family’s forecasts resolve.', 'empty-state'));
    calibrationBox.setAttribute('aria-busy', 'false');
  }
  const memoEvents = committeeEvents.events.filter(event => event.kind === 'committee.memo')
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const memoList = element('div');
  for (const [index, event] of memoEvents.slice(0, 12).entries()) {
    const memo = element('div', null, index === 0 ? 'memo memo-latest' : 'memo');
    memo.append(element('h3', show(event.payload?.period) || 'Memo'));
    memo.append(timeNode(event.at));
    memo.append(element('p', show(event.payload?.text)));
    memoList.append(memo);
  }
  memos.replaceChildren(memoEvents.length ? memoList : element('p', 'None yet.', 'empty-state'));
  memos.setAttribute('aria-busy', 'false');
  const series = allocationSeries(committeeEvents.events);
  const reasons = allocationReasons(committeeEvents.events);
  const current = checkpoint ? Object.entries(checkpoint.committee.allocations) : [];
  const allocationBlock = element('div');
  if (current.length) {
    const list = element('div', null, 'allocation-current');
    const why = new Map(reasons.rows.map(row => [row.desk, row.reason]));
    for (const [id, usd] of current.sort((left, right) => (scaled(right[1]) > scaled(left[1]) ? 1 : -1))) {
      const row = element('div', null, 'allocation-row');
      const name = element('span');
      name.append(link(partnerName(id), deskHref(id)));
      if (why.get(id)) name.append(element('small', why.get(id), 'allocation-why'));
      row.append(name, element('span', money(usd, 0)));
      list.append(row);
    }
    allocationBlock.append(list);
  }
  if (series.rows.length) {
    allocationBlock.append(table(
      ['Time', ...series.desks.map(partnerName)],
      series.rows.map(row => [date(row.at), ...series.desks.map(id => money(show(row.amounts[id]), 0))]),
    ));
  }
  if (!current.length && !series.rows.length) allocationBlock.append(element('p', 'Nothing allocated yet.', 'empty-state'));
  if (checkpoint) allocationBlock.append(element('p', join(`Floor capital ${money(checkpoint.floor.capital_usd, 0)}`, checkpoint.committee.last_memo_at ? `memo ${agoText(checkpoint.committee.last_memo_at)}` : ''), 'note'));
  allocations.replaceChildren(allocationBlock);
  allocations.setAttribute('aria-busy', 'false');
  const gateEvents = committeeEvents.events.filter(event => event.kind === 'committee.gate');
  gates.replaceChildren(gateEvents.length
    ? table(['Time', 'Partner', 'Gate', 'Result'], gateEvents.slice(0, 40).map(event => [
      date(event.at), partnerName(show(event.payload?.desk_id)) || '—', show(event.payload?.gate) || '—', event.payload?.passed ? 'passed' : 'not met',
    ]))
    : element('p', 'No gate decided yet.', 'empty-state'));
  const evolutionEvents = evolution.events.filter(event => event.kind.startsWith('evolution.'));
  const state = {
    events: evolutionEvents, expanded: new Set(), active: new Set(),
    redraw: () => renderTape(history, state.events, state),
  };
  state.redraw();
  const feed = startFeed({
    streams: ['committee', 'evolution'],
    onStatus: mode => statusLine(status, mode, checkpoint?.published_at || null),
    onEvents: events => {
      state.events = [...events.filter(event => event.kind.startsWith('evolution.')), ...state.events].slice(0, TAPE_LIMIT);
      state.redraw();
    },
  });
  feed.remember(state.events);
  feed.prime(state.events[0]?.seq || 0);
  return feed;
}

export function startCapital(root = document.querySelector('[data-capital]')) {
  if (!root) return Promise.resolve(null);
  const page = root.dataset ? root.dataset.capital : root.getAttribute('data-capital');
  if (page === 'desk') return startDesk(root);
  if (page === 'committee') return startCommittee(root);
  return startFloor(root);
}
if (typeof document !== 'undefined' && document.querySelector('[data-capital]')) startCapital();
