import {
  EVENT_KINDS, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT, deskId, deskMode, isLive,
  validCheckpoint, validDesk, validPublicEvent, socketMatches,
} from './schema.js';
// The three loops the floor turns, in the order a visitor should read them.
export const LOOPS = [
  { key: 'trade', label: 'Trade', pace: 'minutes to hours', text: 'see, decide, act, outcome' },
  { key: 'desk', label: 'Desk', pace: 'days', text: 'post-mortem, playbook, tools' },
  { key: 'floor', label: 'Floor', pace: 'weeks', text: 'variants, evidence, capital' },
];

// Long Term Capital Management's own record, rendered from text nodes only. Prices are the floor's
// fills and marks; the page never contacts a quote vendor and never starts work on a desk.
const API = '/api/capital';
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 512 * 1024;
const MAX_SOCKET_MESSAGE = 64 * 1024;
const TAPE_LIMIT = 120;
const TAPE_TEXT_LIMIT = 140;
const NOW_TEXT_LIMIT = 90;
const SPARK_POINTS = 40;
const CARD_MARKS = 60;
// The floor's own balance marks: kind, payload field, and how many of them the page holds.
const FLOOR_MARK = { kind: 'floor.mark', field: 'account_equity' };
const FLOOR_MARK_LIMIT = 200;
const MAX_CARDS = 12;
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
//: What the floor page shows by default: what the partners think, look up and trade.
export const LIVE_GROUPS = ['thoughts', 'trades'];
const FILTER_GROUPS = {
  thoughts: ['desk.session_started', 'desk.thought', 'desk.tool_call', 'desk.tool_result', 'desk.memo', 'desk.postmortem', 'desk.session_ended',
    'desk.watch', 'desk.forecast', 'desk.code_run'],
  trades: ['desk.intent', 'broker.order', 'broker.fill', 'broker.reconciled', 'ledger.mark', 'floor.mark', 'desk.outcome', 'desk.exit_plan'],
  risk: ['risk.decision', 'risk.review', 'risk.breaker', 'ops.alert', 'ops.budget'],
  committee: ['committee.allocation', 'committee.memo', 'committee.gate'],
  evolution: ['evolution.spawned', 'evolution.retired', 'evolution.promoted', 'desk.playbook_updated', 'lab.hypothesis', 'lab.result',
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
// What the desk is doing right now: its latest thought, or the title of its latest memo.
export function nowLine(events, max = NOW_TEXT_LIMIT) {
  const latest = (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === 'desk.thought' || event?.kind === 'desk.memo')
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at)).at(-1);
  if (!latest) return '';
  const text = latest.kind === 'desk.memo'
    ? show(latest.payload?.title) || show(latest.payload?.text)
    : show(latest.payload?.text);
  return truncate(text, max).text;
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
function renderTape(target, events, state) {
  const selected = [...events]
    .filter(event => !state || (state.everything ? true : (isInteresting(event) && matchesFilters(event, state.active))))
    .sort((left, right) => right.seq - left.seq)
    .slice(0, TAPE_LIMIT);
  const entries = selected.map(event => tapeEntry(event, state));
  target.replaceChildren(...(entries.length ? entries : [element('p', events.length ? 'Quiet. The next thought appears here.' : 'Nothing published yet.', 'empty-state')]));
  target.setAttribute('aria-busy', 'false');
}
// One toggle: the interesting parts (default) or everything the floor writes.
function tapeToggle(state, onChange) {
  const toggle = element('button', 'everything', state.everything ? 'chip chip-on tape-toggle' : 'chip tape-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', state.everything ? 'true' : 'false');
  toggle.setAttribute('title', 'Show every event, including tool calls, marks and budgets');
  toggle.addEventListener('click', () => { state.everything = !state.everything; onChange(); });
  return toggle;
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
// A live card leads with the money it holds. A shadow card leads with the score, labelled.
export function cardNumbers(desk) {
  if (isLive(desk)) {
    return [
      [money(desk.equity, 0), 'equity', ''],
      [percent(desk.return_pct), 'since inception', signOf(desk.return_pct)],
    ];
  }
  return [
    [percent(desk.return_pct), 'shadow · hypothetical', signOf(desk.return_pct)],
    [money(desk.equity, 0), 'notional book', ''],
  ];
}
// The masthead is real money. A shadow desk's book is a score, and the floor never adds it in.
export const floorEquity = floor => (numeric(floor?.live_equity) ? floor.live_equity : floor?.equity);
export const floorDaily = floor => (numeric(floor?.live_daily_pnl) ? floor.live_daily_pnl : floor?.daily_pnl);

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
// The headline's label, built from the accounts the checkpoint actually carried.
export function portfolioLabel(floor) {
  const names = accountVenues(floor).map(row => row.name).filter(Boolean);
  return names.length ? `Portfolio · ${names.join(' + ')}` : 'Portfolio';
}
export const venueChipText = row => `${row.name} ${money(row.equity, 2)}`;
// The real balance history, folded from the floor's own `floor.mark` records.
export const floorBalancePoints = events => markPoints(events, FLOOR_MARK);
export const floorBalanceSeries = events => markSeries(events, FLOOR_MARK);
// What the portfolio has done since the floor's first published balance.
export function sinceStart(events) {
  const points = floorBalancePoints(events);
  if (!points.length) return null;
  const first = points[0];
  const last = points.at(-1);
  const change = last.equity - first.equity;
  return {
    first, last, change, amount: signedMoney(String(change.toFixed(2)), 2),
    text: `since start ${signedMoney(String(change.toFixed(2)), 2)}`,
    tone: change > 0 ? 'positive' : change < 0 ? 'negative' : '',
  };
}
export function floorCounts(checkpoint) {
  const floor = checkpoint?.floor || {};
  const desks = Array.isArray(checkpoint?.desks) ? checkpoint.desks : [];
  const given = field => (Number.isSafeInteger(floor[field]) ? floor[field] : null);
  return {
    live: given('live_desks') ?? desks.filter(isLive).length,
    shadow: given('shadow_desks') ?? desks.filter(desk => !isLive(desk)).length,
  };
}
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
export function deskCountLine(checkpoint) {
  const { live, shadow } = floorCounts(checkpoint);
  return `${plural(live, 'live desk')} · ${plural(shadow, 'shadow desk')} competing for capital`;
}
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
// The night desk's day in one line, or null when the checkpoint carried no watch block.
export function watchLine(checkpoint) {
  const watch = checkpoint?.watch;
  if (!watch || typeof watch !== 'object') return null;
  const last = typeof watch.last_trigger_at === 'string' && watch.last_trigger_at ? `last ${date(watch.last_trigger_at, 'clock')}` : 'quiet so far';
  return join(`${plural(Number(watch.triggers_today) || 0, 'look')} today`, `${Number(watch.wakes_today) || 0} woke a desk`, last, numeric(watch.cost_today_usd) ? `${money(watch.cost_today_usd, 2)} spent` : '');
}
// The accounts the money sits in, as the first line of the book: the total, then each venue.
export function portfolioLine(floor) {
  const total = accountEquity(floor);
  const venues = accountVenues(floor);
  if (total === null && !venues.length) return '';
  return join(total === null ? '' : `Portfolio ${money(total, 2)}`, ...venues.map(row => `${venueChipText(row)}${row.stale ? ' (stale)' : ''}`));
}
// Why the desk holds it, on demand: the rationale it filed and the risk engine's answer, read
// from the desk's own events and cached per desk so a second click costs nothing.
const rationaleCache = new Map();
async function loadRationale(deskId) {
  if (!rationaleCache.has(deskId)) {
    rationaleCache.set(deskId, Promise.all([
      loadEvents({ stream: `desk:${deskId}`, kind: 'desk.intent', limit: 100 }).catch(() => ({ events: [] })),
      loadEvents({ kind: 'risk.decision', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
    ]).then(([intents, decisions]) => [...intents.events, ...decisions.events]));
  }
  return rationaleCache.get(deskId);
}
function rationaleControl(row) {
  const box = element('div', null, 'position-why');
  const button = element('button', 'why', 'chip chip-why');
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  const body = element('div', null, 'position-why-body');
  body.hidden = true;
  button.addEventListener('click', async () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', open ? 'false' : 'true');
    body.hidden = open;
    if (open || body.children.length) return;
    body.replaceChildren(element('p', 'Reading the desk\u2019s own words\u2026', 'note'));
    const found = positionRationale(await loadRationale(row.desk), row.intentId);
    const parts = [];
    if (found?.rationale) parts.push(element('p', found.rationale, 'position-rationale'));
    if (found?.text) parts.push(element('p', found.text, found.decision === 'blocked' ? 'note negative' : 'note'));
    if (!parts.length) parts.push(element('p', 'The order behind this holding is not on the public tape yet.', 'note'));
    parts.push(link('the trade story ↗', row.story, 'position-story'));
    body.replaceChildren(...parts);
  });
  box.append(button, body);
  return box;
}
function positionsBoard(checkpoint, { line = true } = {}) {
  const rows = positionRows(checkpoint);
  const board = element('div', null, 'positions');
  const summary = line ? portfolioLine(checkpoint?.floor) : '';
  if (summary) board.append(element('p', summary, 'portfolio-line'));
  if (!rows.length) {
    board.append(element('p', flatLine(checkpoint), 'empty-state'));
    return board;
  }
  for (const row of rows) {
    const line = element('article', null, row.live ? 'position' : 'position position-shadow');
    const head = element('div', null, 'position-head');
    head.append(link(row.name, deskHref(row.desk), 'position-desk'));
    head.append(element('span', row.live ? 'live' : 'shadow', row.live ? 'badge badge-live' : 'badge badge-shadow'));
    head.append(element('span', join(row.side, row.instrument, row.venue), 'position-what'));
    line.append(head);
    const numbers = element('div', null, 'position-numbers');
    for (const [label, value, tone] of [
      ['size', row.quantity, ''], ['entry', priceText(row.entry), ''], ['mark', priceText(row.mark), ''],
      ['value', money(row.value, 2), ''], ['P&L', signedMoney(row.pnl, 2), row.tone],
    ]) {
      const cell = element('span');
      cell.append(element('b', value, tone), element('i', label));
      numbers.append(cell);
    }
    line.append(numbers);
    line.append(element('p', row.thesis || 'No thesis filed.', row.thesis ? 'position-thesis' : 'position-thesis note'));
    const chips = element('div', null, 'exit-chips');
    for (const chip of row.chips) chips.append(element('span', chip.text, `exit-chip exit-${chip.kind}`));
    line.append(chips);
    if (row.intentId) line.append(rationaleControl(row));
    board.append(line);
  }
  return board;
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
function watchStrip(checkpoint) {
  const text = watchLine(checkpoint);
  if (!text) return null;
  const strip = element('p', null, 'watch-strip');
  strip.append(element('b', 'Night desk'), element('span', text));
  return strip;
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

// The third headline number. Under the runway policy it is the Sail credit and how long it
// lasts at the current burn; under the older capped policy it is today's spend against the cap.
export function creditLine(budget) {
  if (!budget || typeof budget !== 'object') return null;
  if (!budget.mode) return { label: 'Inference today', value: `${money(budget.spent_today_usd, 2)} / ${money(budget.cap_usd, 0)}`, note: 'spent of the daily cap' };
  const runway = numeric(budget.runway_days) ? `${Math.floor(Number(budget.runway_days))}d runway` : '';
  const note = {
    open: join(runway, 'no cap', `${money(budget.spent_today_usd, 2)} today`),
    throttled: join(runway, `throttled to ${money(budget.cap_usd, 0)} a day`),
    stopped: 'stopped · waiting for credit',
    unknown: join('balance unread', `${money(budget.spent_today_usd, 2)} today`),
  }[budget.mode] || '';
  const value = numeric(budget.balance_usd) ? money(budget.balance_usd, 0) : `${money(budget.spent_today_usd, 2)} today`;
  return { label: 'Sail credit', value, note, mode: budget.mode };
}
// ---------------------------------------------------------------- the box the floor runs on
const HOST_COPY = { sailbox: 'running on a Sail cloud VM', local: 'running on the owner’s own machine' };
export const boxShort = value => (typeof value === 'string' && value ? value.replace(/^(?:box|sb)[-_]/i, '').slice(0, 8) : '');
export function uptimeText(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return '';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
// One row per fact the checkpoint actually carried. Nothing is guessed and nothing is padded.
export function infraRows(checkpoint) {
  const infra = checkpoint?.infra;
  const budget = checkpoint?.budget || {};
  if (!infra || typeof infra !== 'object' || Array.isArray(infra)) return [];
  const host = show(infra.host);
  const box = boxShort(infra.box_id);
  const rows = [['Host', join(HOST_COPY[host] || host, box && `box ${box}`, show(infra.region))]];
  const uptime = uptimeText(infra.uptime_seconds);
  if (uptime) rows.push(['Uptime', uptime]);
  if (Number.isSafeInteger(infra.checkpoint_count)) rows.push(['Checkpoints', String(infra.checkpoint_count)]);
  const spent = numeric(infra.spend_usd) ? infra.spend_usd : budget.spent_today_usd;
  if (numeric(spent)) rows.push(['Sail spend today', budget.mode ? spendLine(spent, budget) : `${money(spent, 2)} of ${money(show(budget.cap_usd), 0)}`]);
  if (checkpoint?.published_at) rows.push(['Last checkpoint', date(checkpoint.published_at)]);
  if (Number.isSafeInteger(infra.requests_today)) rows.push(['Sail requests today', String(infra.requests_today)]);
  return rows;
}
// "Spend today" under the runway policy: what was spent, and what governs it.
function spendLine(spent, budget) {
  const runway = numeric(budget.runway_days) ? `${Math.floor(Number(budget.runway_days))} days of runway` : '';
  if (budget.mode === 'open') return join(money(spent, 2), 'no cap', runway);
  if (budget.mode === 'throttled') return join(money(spent, 2), `throttled to ${money(show(budget.cap_usd), 0)} a day`, runway);
  if (budget.mode === 'stopped') return join(money(spent, 2), 'stopped: waiting for Sail credit');
  return money(spent, 2);
}
// ============================================================================ the floor
// One screen answers three questions: what is this, is it alive, is it working. Everything
// below the masthead is live things with as few words around them as the numbers allow.

// "14 min ago", "2 h ago", "3 d ago": relative time for the now cards and the idle lines.
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

// ---- the run strip: running 2h 14m · $0.19 spent · profit $0.00 · $0.00 per Sail dollar · credit
export function runStrip(run, budget, now = Date.now()) {
  const clock = runClock(run, now);
  const credit = creditLine(budget);
  const perDollar = clock ? (clock.perDollar === 'not yet' ? 'profit per Sail dollar: not yet' : `${clock.perDollar} per Sail dollar`) : '';
  const total = Number(run?.sessions_total) || 0;
  return {
    elapsed: clock?.elapsed ? `running ${clock.elapsed}` : 'starting up',
    since: clock?.since ? `since ${clock.since}` : '',
    spend: clock ? `${clock.spendTotal} of Sail credit spent` : '',
    profit: clock ? `profit ${clock.pnl}` : '', profitTone: clock?.pnlTone || '',
    perDollar, perDollarTone: clock?.perDollarTone || '',
    sessions: clock ? `${total} session${total === 1 ? '' : 's'}` : '',
    credit: credit ? (credit.mode ? `${credit.value} credit · ${credit.mode}` : `${credit.value} today`) : '', mode: credit?.mode || '',
  };
}
function runStripPanel(checkpoint, state) {
  const strip = runStrip(checkpoint?.run, checkpoint?.budget);
  const line = element('p', null, 'run-strip');
  const elapsed = element('b', strip.elapsed, 'run-elapsed-text');
  line.append(elapsed);
  if (strip.since) line.append(element('span', strip.since, 'run-since'));
  for (const [text, tone] of [[strip.spend, ''], [strip.profit, strip.profitTone], [strip.perDollar, strip.perDollarTone], [strip.sessions, '']]) {
    if (text) line.append(element('span', text, tone ? `run-item ${tone}` : 'run-item'));
  }
  if (strip.credit) line.append(element('span', strip.credit, `credit-pill credit-${strip.mode || 'none'}`));
  const status = element('span', state.mode === 'live' ? 'live' : state.mode === 'polling' ? 'reconnecting' : 'loading', `run-status run-status-${state.mode}`);
  status.setAttribute('title', checkpoint?.published_at ? `Checkpoint ${date(checkpoint.published_at)}` : 'Awaiting the first checkpoint');
  line.append(status);
  // The clock ticks in the browser between checkpoints, so a page left open stays alive.
  if (state.ticker) clearInterval(state.ticker);
  const started = Date.parse(checkpoint?.run?.started_at);
  if (Number.isFinite(started)) {
    state.ticker = setInterval(() => { elapsed.textContent = `running ${elapsedText(Math.max(0, Math.floor((Date.now() - started) / 1000)))}`; }, 1000);
  }
  state.statusNode = status;
  return line;
}
// Behind the chevron: where it runs and what the box has done. Nothing a first look needs.
function mastheadMore(checkpoint) {
  const rows = infraRows(checkpoint);
  const box = element('div', null, 'masthead-more-body');
  if (rows.length) box.append(facts(rows));
  box.append(element('p', 'The desks think on Sail. Their keys never leave Cloudflare. Every order passes a risk engine and a critic.', 'note'));
  return box;
}

// ---- now: who is thinking, about what
// What the page remembers per desk from its own stream: the newest thought, the last tool it
// asked, its last memo and when its last session ended. Folded from events, updated live.
export function deskRecord(events, previous = null) {
  const record = { thought: '', thoughtAt: '', tool: '', memo: '', memoAt: '', endedAt: '', ...(previous || {}) };
  const list = [...(Array.isArray(events) ? events : [])].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  for (const event of list) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    if (event.kind === 'desk.thought' && show(payload.text)) { record.thought = show(payload.text); record.thoughtAt = event.at; }
    else if (event.kind === 'desk.tool_call') record.tool = humanize(show(payload.tool));
    else if (event.kind === 'desk.memo') { record.memo = show(payload.title) || truncate(show(payload.text), 80).text; record.memoAt = event.at; }
    else if (event.kind === 'desk.session_ended') { record.endedAt = event.at; record.tool = ''; }
    else if (event.kind === 'desk.session_started') { record.thought = ''; record.tool = ''; }
  }
  return record;
}
// An idle desk in one line: when it last worked, and the last thing it concluded.
export function untilText(value, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.round((at - now) / 1000);
  if (seconds <= 60) return 'now';
  if (seconds < 3600) return `in ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) { const hours = Math.floor(seconds / 3600); const minutes = Math.round((seconds % 3600) / 60); return `in ${hours}h${minutes ? ` ${minutes}m` : ''}`; }
  return `in ${Math.round(seconds / 86400)} d`;
}
export function idleRecordLine(record, now = Date.now(), nextAt = null) {
  const when = record?.endedAt ? `last session ${ago(record.endedAt, now)}` : record?.memoAt ? `last memo ${ago(record.memoAt, now)}` : 'no session yet';
  const next = untilText(nextAt, now);
  return join(when, record?.memo || '', next ? `next ${next}` : '');
}
export function nowRows(checkpoint, records = new Map(), now = Date.now()) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  return desks.map(desk => {
    const record = records.get(desk.id) || null;
    const session = desk.live_session && typeof desk.live_session === 'object' ? desk.live_session : null;
    return {
      id: show(desk.id), name: raceName(desk), live: isLive(desk), inSession: Boolean(session),
      trigger: session ? triggerText(session.trigger) : '', since: session?.started_at ? ago(session.started_at, now) : '',
      thought: record?.thought || '', tool: record?.tool || '', idle: session ? '' : idleRecordLine(record, now, desk.next_session_at || null),
    };
  }).sort((left, right) => Number(right.inSession) - Number(left.inSession));
}
// The night desk in one line, or nothing when the checkpoint carried no watch block.
export function nightLine(checkpoint) {
  const watch = checkpoint?.watch;
  if (!watch || typeof watch !== 'object') return '';
  const looks = Number(watch.triggers_today) || 0;
  const wakes = Number(watch.wakes_today) || 0;
  return `night desk: ${looks} look${looks === 1 ? '' : 's'}, ${wakes} wake${wakes === 1 ? '' : 's'} today`;
}
// Types a thought out at a readable pace. Off when the visitor asked for less motion, and in
// any place without a window, where the text simply lands.
const typers = new WeakMap();
function typeInto(node, text) {
  const previous = typers.get(node);
  if (previous) clearTimeout(previous);
  const canAnimate = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!canAnimate || !text) { node.textContent = text; return; }
  let shown = 0;
  const step = () => {
    shown = Math.min(text.length, shown + 2);
    node.textContent = text.slice(0, shown);
    if (shown < text.length) typers.set(node, setTimeout(step, 24));
  };
  step();
}
function nowPanel(checkpoint, records, { idle = true } = {}) {
  const rows = nowRows(checkpoint, records);
  const nodes = [];
  for (const row of rows.filter(item => item.inSession)) {
    const card = element('article', null, row.live ? 'now-card' : 'now-card now-card-shadow');
    const head = element('div', null, 'now-head');
    head.append(link(row.name, deskHref(row.id), 'now-name'), element('span', row.trigger, 'now-trigger'));
    if (row.since) head.append(element('span', `started ${row.since}`, 'now-since'));
    if (!row.live) head.append(element('span', 'shadow', 'badge badge-shadow'));
    card.append(head);
    const thought = element('p', null, 'now-thought');
    if (row.thought) typeInto(thought, truncate(row.thought, 420).text);
    else thought.textContent = 'thinking…';
    card.append(thought);
    if (row.tool) card.append(element('span', `using ${row.tool}`, 'now-tool'));
    nodes.push(card);
  }
  const idleRows = idle ? rows.filter(item => !item.inSession) : [];
  if (idleRows.length) {
    const list = element('div', null, 'now-idle-list');
    for (const row of idleRows) {
      const line = element('p', null, 'now-idle');
      line.append(link(row.name, deskHref(row.id), 'now-idle-name'));
      if (!row.live) line.append(element('span', 'shadow', 'badge badge-shadow'));
      line.append(element('span', row.idle, 'now-idle-text'));
      list.append(line);
    }
    nodes.push(list);
  }
  const night = idle ? nightLine(checkpoint) : '';
  if (night) nodes.push(element('p', night, 'now-night'));
  if (!nodes.length) nodes.push(element('p', idle ? 'The desks appear with the first checkpoint.' : quietLine(checkpoint), 'empty-state'));
  return nodes;
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

// ---- holdings: the accounts, the balance line, every position with its reason
export function flatLine(checkpoint) {
  const total = accountEquity(checkpoint?.floor);
  const accounts = accountVenues(checkpoint?.floor).length;
  const today = Number(checkpoint?.run?.sessions_today) || 0;
  return [
    'Flat.',
    total === null ? '' : `${money(total, 0)} in cash${accounts ? ` across ${accounts} account${accounts === 1 ? '' : 's'}` : ''}.`,
    today ? `${today} session${today === 1 ? '' : 's'} today, no trade taken.` : 'No trade taken yet.',
  ].filter(Boolean).join(' ');
}
function holdingsPanel(checkpoint, floorMarks) {
  const nodes = [];
  const floor = checkpoint?.floor;
  const total = accountEquity(floor);
  const venues = accountVenues(floor);
  if (total !== null || venues.length) {
    const line = element('p', null, 'holdings-line');
    if (total !== null) line.append(element('b', money(total, 2), 'holdings-total'));
    for (const row of venues) {
      const chip = element('span', null, row.stale ? 'venue-chip venue-chip-stale' : 'venue-chip');
      chip.append(element('b', row.name), element('span', money(row.equity, 2)));
      if (row.stale) { chip.append(element('i', 'stale')); chip.setAttribute('title', `${row.name} did not answer the last balance request.`); }
      line.append(chip);
    }
    const series = sparkline(floorMarks, { selector: FLOOR_MARK });
    if (series) {
      const svg = svgElement('svg', { viewBox: `0 0 ${series.width} ${series.height}`, preserveAspectRatio: 'none', class: `spark spark-${series.direction} holdings-spark`, role: 'img', 'aria-label': 'The real balance over the floor’s last marks.' });
      svg.append(svgElement('path', { d: series.path, class: 'spark-line' }));
      line.append(svg);
    }
    const change = sinceStart(floorMarks);
    if (change) line.append(element('span', change.text, `holdings-since ${change.tone}`));
    nodes.push(line);
  }
  const rows = positionRows(checkpoint);
  if (!rows.length) { nodes.push(element('p', flatLine(checkpoint), 'empty-state holdings-flat')); return nodes; }
  nodes.push(positionsBoard(checkpoint, { line: false }));
  const working = workingBoard(checkpoint);
  if (working) nodes.push(working);
  return nodes;
}
// The book as it stands across every desk: each resting bid and offer, who placed it and why.
export function workingBoard(checkpoint) {
  const rows = workingRows(checkpoint);
  if (!rows.length) return null;
  const board = element('div', null, 'working working-board');
  board.append(element('p', `${plural(rows.length, 'order')} resting on the book`, 'working-line'));
  for (const row of rows) {
    const item = element('article', null, row.live ? 'working-order' : 'working-order working-shadow');
    const head = element('div', null, 'working-head');
    head.append(link(row.name, deskHref(row.desk), 'position-desk'));
    head.append(element('span', row.live ? 'live' : 'shadow', row.live ? 'badge badge-live' : 'badge badge-shadow'));
    head.append(element('span', join(row.side, row.instrument, row.venue), 'position-what'));
    if (row.submittedAt) head.append(timeNode(row.submittedAt, 'clock'));
    item.append(head);
    item.append(element('p', join(row.quantity, `at ${priceText(row.price)}`, row.purpose === 'exit' ? 'exit' : '', `by ${row.strategy}`), 'working-numbers'));
    board.append(item);
  }
  return board;
}

// ---- closed: every settled or exited trade, who took it and why
export function closedRows(events, checkpoint, { limit = 40 } = {}) {
  const live = new Set(orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object' && isLive(desk)).map(desk => show(desk.id)));
  return (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === 'desk.outcome' && typeof event.stream === 'string' && event.stream.startsWith('desk:'))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, limit)
    .map(event => {
      const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
      const desk = event.stream.slice(5);
      const pnl = show(p.pnl);
      return {
        id: show(event.id), at: show(event.at), desk, name: partnerName(desk), live: live.has(desk),
        instrument: show(p.market_id) || instrumentLabel(p.instrument) || '—', right: show(p.instrument?.right).toUpperCase(),
        result: humanize(show(p.result)), pnl, pnlText: pnl ? signedMoney(pnl, 2) : '—', tone: pnl ? signOf(pnl) : '',
        held: p.held_for_hours === undefined || p.held_for_hours === null ? '' : `held ${show(p.held_for_hours)}h`,
        entry: show(p.entry_price), exit: show(p.exit_price), quantity: quantity(p.quantity),
        why: truncate(show(p.rationale_excerpt).replace(/^\[strategy [a-z0-9_]+\]\s*/, ''), 240).text,
        strategy: (show(p.rationale_excerpt).match(/^\[strategy ([a-z0-9_]+)\]/) || [])[1] || '',
      };
    });
}
function closedRow(row) {
  const item = element('article', null, row.live ? 'closed-row' : 'closed-row closed-shadow');
  const head = element('div', null, 'closed-head');
  head.append(timeNode(row.at, 'clock'), link(row.name, deskHref(row.desk), 'position-desk'));
  head.append(element('span', row.live ? 'live' : 'shadow', row.live ? 'badge badge-live' : 'badge badge-shadow'));
  head.append(element('span', join(row.right, row.instrument), 'position-what'));
  if (row.result) head.append(element('span', row.result, 'closed-result'));
  head.append(element('b', row.pnlText, `closed-pnl ${row.tone}`));
  item.append(head);
  const numbers = join(row.quantity ? `${row.quantity}` : '', row.entry ? `in ${priceText(row.entry)}` : '', row.exit ? `out ${priceText(row.exit)}` : '', row.held, row.strategy ? `by ${row.strategy}` : '');
  if (numbers) item.append(element('p', numbers, 'closed-numbers'));
  if (row.why) item.append(element('p', row.why, 'closed-why'));
  return item;
}
export function closedBoard(events, checkpoint) {
  const rows = closedRows(events, checkpoint);
  if (!rows.length) return [element('p', 'No trade has closed yet. The first settled contract lands here with its reason and its result.', 'empty-state')];
  const live = rows.filter(row => row.live);
  const shadow = rows.filter(row => !row.live);
  const nodes = [];
  if (live.length) {
    const won = live.filter(row => Number(row.pnl) > 0).length;
    const total = live.reduce((sum, row) => sum + (Number(row.pnl) || 0), 0);
    nodes.push(element('p', `${plural(live.length, 'real trade')} closed, ${won} won, ${signedMoney(total.toFixed(2), 2)} together`, 'closed-line'));
    const list = element('div', null, 'closed');
    for (const row of live) list.append(closedRow(row));
    nodes.push(list);
  }
  if (shadow.length) {
    const box = element('details', null, 'closed-more');
    const summary = element('summary', `${plural(shadow.length, 'shadow trade')} closed on the same prices, no money`, 'closed-summary');
    box.append(summary);
    const list = element('div', null, 'closed');
    for (const row of shadow) list.append(closedRow(row));
    box.append(list);
    if (!live.length) box.open = true;
    nodes.push(box);
  }
  return nodes;
}

// ---- the partners: who is earning their compute, and whether the generations improve
export function partnerRows(checkpoint) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const rows = desks.map(desk => {
    const equity = numeric(desk.equity) ? Number(desk.equity) : null;
    const capital = numeric(desk.capital_usd) ? Number(desk.capital_usd) : null;
    const cost = numeric(desk.cost_usd) ? Number(desk.cost_usd) : null;
    const pnl = equity !== null && capital !== null ? equity - capital : null;
    const perDollar = pnl !== null && cost !== null && cost > 0 ? pnl / cost : null;
    return {
      id: show(desk.id), name: raceName(desk), live: isLive(desk), inSession: Boolean(desk.live_session),
      family: humanize(show(desk.family)), generation: Number.isSafeInteger(desk.generation) ? desk.generation : 1,
      returnText: numeric(desk.return_pct) ? percent(desk.return_pct) : '—', returnTone: numeric(desk.return_pct) ? signOf(desk.return_pct) : '',
      pnl, pnlText: pnl === null ? '—' : signedMoney(pnl.toFixed(2), 2), pnlTone: pnl === null ? '' : signOf(pnl.toFixed(2)),
      costText: cost === null ? '—' : money(cost.toFixed(2), 2),
      perDollar, perDollarText: perDollar === null ? '—' : signedMoney(perDollar.toFixed(2), 2), perDollarTone: perDollar === null ? '' : signOf(perDollar.toFixed(2)),
      days: Number(desk.days_live) || 0, strategies: Array.isArray(desk.strategies) ? desk.strategies.length : 0,
      budget: numeric(desk.budget_factor) ? Number(desk.budget_factor) : null,
    };
  });
  const key = row => (row.perDollar === null ? -Infinity : row.perDollar);
  return rows.sort((left, right) => Number(right.live) - Number(left.live) || key(right) - key(left) || left.id.localeCompare(right.id));
}
// One sentence on the loop itself: how long it has run, how many decisions, and whether the
// newest generation beats the one before it.
export function learningLine(checkpoint, now = Date.now()) {
  const run = checkpoint?.run && typeof checkpoint.run === 'object' ? checkpoint.run : null;
  const parts = [];
  if (run) {
    const clock = runClock(run, now);
    if (clock?.elapsed) parts.push(`${clock.elapsed} of self-improvement`);
    if (Number(run.sessions_total)) parts.push(`${plural(Number(run.sessions_total), 'session')}`);
    if (Number(run.decisions_total)) parts.push(`${plural(Number(run.decisions_total), 'decision')}`);
  }
  const curve = (Array.isArray(checkpoint?.lab?.curve) ? checkpoint.lab.curve : []).filter(row => row && Number.isSafeInteger(row.generation));
  if (curve.length >= 2 && curve.some(row => Number(row.decisions) > 0)) parts.push(curveReading(curve).replace(/\.$/, ''));
  return parts.join(' · ');
}
export function partnersBoard(checkpoint) {
  const rows = partnerRows(checkpoint);
  if (!rows.length) return [element('p', 'The partners appear with the first checkpoint.', 'empty-state')];
  const nodes = [];
  const reading = learningLine(checkpoint);
  if (reading) nodes.push(element('p', reading, 'partners-line'));
  const table = element('div', null, 'partners');
  const head = element('div', null, 'partner partner-head');
  for (const label of ['partner', 'return', 'P&L', 'Sail spent', 'per Sail $', 'days']) head.append(element('span', label));
  table.append(head);
  for (const row of rows) {
    const line = element('div', null, row.live ? 'partner' : 'partner partner-shadow');
    const who = element('span', null, 'partner-who');
    who.append(link(row.name, deskHref(row.id), 'partner-name'));
    who.append(element('span', row.live ? 'live' : 'shadow', row.live ? 'badge badge-live' : 'badge badge-shadow'));
    if (row.inSession) who.append(element('span', 'thinking', 'badge badge-thinking'));
    if (row.family) who.append(element('i', row.family, 'partner-family'));
    if (row.budget !== null && Math.abs(row.budget - 1) >= 0.005) who.append(element('i', `compute ×${row.budget.toFixed(2).replace(/\.?0+$/, '')}`, 'partner-budget'));
    line.append(who);
    line.append(element('span', row.returnText, `partner-num ${row.returnTone}`));
    line.append(element('span', row.pnlText, `partner-num ${row.pnlTone}`));
    line.append(element('span', row.costText, 'partner-num'));
    line.append(element('span', row.perDollarText, `partner-num ${row.perDollarTone}`));
    line.append(element('span', String(row.days), 'partner-num'));
    table.append(line);
  }
  nodes.push(table);
  return nodes;
}

// ---- the race: each family's live desk and its children, who leads, what is being tried
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

async function startFloor(root) {
  const strip = root.querySelector('#floor-run');
  const moreBody = root.querySelector('#floor-more-body');
  const now = root.querySelector('#floor-now');
  const holdings = root.querySelector('#floor-positions');
  const closed = root.querySelector('#floor-closed');
  const partners = root.querySelector('#floor-partners');
  const toggle = root.querySelector('#tape-toggle');
  const tape = root.querySelector('#floor-tape');
  const state = {
    checkpoint: null, events: [], mode: 'loading', records: new Map(), floorMarks: [], outcomes: [],
    everything: false, active: new Set(LIVE_GROUPS), expanded: new Set(), ticker: null, statusNode: null,
    redraw: () => { if (tape) renderTape(tape, state.events, state); },
  };
  const ready = node => node && node.setAttribute('aria-busy', 'false');
  const drawStrip = () => { if (!strip || !state.checkpoint) return; strip.replaceChildren(runStripPanel(state.checkpoint, state)); ready(strip); };
  const drawMore = () => { if (moreBody && state.checkpoint) moreBody.replaceChildren(mastheadMore(state.checkpoint)); };
  const drawNow = () => { if (!now || !state.checkpoint) return; now.replaceChildren(...nowPanel(state.checkpoint, state.records, { idle: false })); ready(now); };
  const drawHoldings = () => { if (!holdings || !state.checkpoint) return; holdings.replaceChildren(...holdingsPanel(state.checkpoint, state.floorMarks)); ready(holdings); };
  const drawClosed = () => { if (!closed || !state.checkpoint) return; closed.replaceChildren(...closedBoard(state.outcomes, state.checkpoint)); ready(closed); };
  const drawPartners = () => { if (!partners || !state.checkpoint) return; partners.replaceChildren(...partnersBoard(state.checkpoint)); ready(partners); };
  const drawToggle = () => { if (toggle) toggle.replaceChildren(tapeToggle(state, () => { drawToggle(); state.redraw(); })); };
  const setStatus = () => {
    if (!state.statusNode) return;
    state.statusNode.textContent = state.mode === 'live' ? 'live' : state.mode === 'polling' ? 'reconnecting' : 'loading';
    state.statusNode.className = `run-status run-status-${state.mode}`;
  };
  async function refresh() {
    try {
      state.checkpoint = await loadCheckpoint();
      drawStrip(); drawMore(); drawNow(); drawHoldings(); drawClosed(); drawPartners();
    } catch {
      if (state.checkpoint) return;
      const notice = element('p', 'The floor checkpoint is unavailable. ', 'unavailable');
      notice.append(link('Read the runtime on GitHub.', REPOSITORY));
      if (strip) { strip.replaceChildren(notice); ready(strip); }
      for (const box of [now, holdings, closed, partners]) if (box) { box.replaceChildren(); ready(box); }
    }
  }
  await refresh();
  // The real balance history: the floor's own marks of the venue accounts.
  if (holdings) {
    const marks = await loadEvents({ stream: 'ops', kind: 'floor.mark', limit: FLOOR_MARK_LIMIT }).catch(() => ({ events: [] }));
    state.floorMarks = marks.events;
    drawHoldings();
  }
  // Every closed trade the desks have published, real and shadow.
  if (closed) {
    const outcomes = await loadEvents({ kind: 'desk.outcome', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] }));
    state.outcomes = outcomes.events;
    drawClosed();
  }
  // What each desk is thinking now, from its own stream.
  if (state.checkpoint && now) {
    await Promise.all(orderDesks(state.checkpoint.desks).slice(0, MAX_CARDS).map(async desk => {
      const recent = await loadEvents({ stream: `desk:${desk.id}`, limit: 40 }).catch(() => ({ events: [] }));
      state.records.set(desk.id, deskRecord(recent.events));
    }));
    drawNow();
  }
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  let tapeReady = true;
  try {
    const history = await loadEvents({ limit: DEFAULT_EVENT_LIMIT });
    state.events = history.events;
  } catch {
    tapeReady = false;
    if (tape) { tape.replaceChildren(element('p', 'The tape is unavailable. It resumes when the floor publishes again.', 'unavailable')); ready(tape); }
  }
  drawToggle();
  if (tapeReady) state.redraw();
  const feed = startFeed({
    streams: ['all'],
    onStatus: mode => { state.mode = mode; setStatus(); },
    onEvents: events => {
      state.events = [...events, ...state.events].slice(0, TAPE_LIMIT * 2);
      let cards = false;
      let balance = false;
      let outcomes = false;
      for (const event of events) {
        if (event.kind === 'desk.outcome') { state.outcomes = [event, ...state.outcomes].slice(0, MAX_EVENT_LIMIT); outcomes = true; }
        if (event.kind === FLOOR_MARK.kind) {
          state.floorMarks = [...state.floorMarks, event].slice(-FLOOR_MARK_LIMIT);
          balance = true;
          continue;
        }
        if (typeof event.stream !== 'string' || !event.stream.startsWith('desk:')) continue;
        const id = event.stream.slice(5);
        state.records.set(id, deskRecord([event], state.records.get(id)));
        cards = true;
      }
      if (cards) drawNow();
      if (balance) drawHoldings();
      if (outcomes) drawClosed();
      state.redraw();
    },
  });
  feed.remember(state.events);
  feed.prime(state.events[0]?.seq || 0);
  return feed;
}

function equityChart(marks) {
  const series = markSeries(marks);
  if (!series) return element('p', 'A performance line appears after the second published mark.', 'empty-state');
  const figure = element('figure', null, 'pnl-chart');
  const svg = svgElement('svg', { viewBox: '0 0 760 190', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Desk equity from its own published marks.' });
  for (const tick of series.ticks) svg.append(svgElement('line', { x1: 2, x2: 748, y1: tick.y, y2: tick.y, class: 'chart-grid' }));
  svg.append(svgElement('path', { d: series.path, class: 'chart-equity' }));
  figure.append(svg);
  const caption = element('figcaption', null, 'chart-caption');
  caption.append(element('span', `${money(String(series.first.equity.toFixed(2)), 0)} → ${money(String(series.last.equity.toFixed(2)), 0)}`));
  caption.append(element('span', `${date(new Date(series.first.at).toISOString())} – ${date(new Date(series.last.at).toISOString())}`));
  figure.append(caption);
  return figure;
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
    item.append(element('p', join(row.quantity, `at ${priceText(row.price)}`, row.purpose === 'exit' ? 'exit' : '', `by ${row.strategy}`), 'working-numbers'));
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
