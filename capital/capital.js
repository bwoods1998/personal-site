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
const TAPE_TEXT_LIMIT = 140;
// Durable all-time balance history, separate from the bounded live activity tape.
const FLOOR_MARK = { kind: 'floor.mark', field: 'account_equity' };
const FLOOR_HISTORY_LIMIT = 2048;
// First complete account mark after the Sept 16 Kalshi equity fix: earlier readings
// reported positions without cash. Fixed provenance boundary, never a drawdown filter.
export const PERFORMANCE_START_AT = '2026-09-16T04:58:42.508Z';
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
    'lab.calibration', 'lab.experiment', 'lab.verdict', 'lab.progress'],
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
    : style === 'time' ? { hour: 'numeric', minute: '2-digit' }
    : style === 'md' ? { month: 'short', day: 'numeric' }
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
function svgElement(tag, attributes, content) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content) node.textContent = content;
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
  // A demotion is published as a promotion "to" a shadow book; it never reads as a promotion.
  'evolution.promoted': p => (isDemotion(p)
    ? join(`moved ${floorName(show(p.desk_id))} back to a shadow book`, reasonText(p.reason))
    : join(`promoted ${floorName(show(p.desk_id))} to real money`, show(p.venue) ? `on ${venueLabel(p.venue)}` : '', reasonText(p.reason))),
  'evolution.founded': p => join(`founded ${show(p.name) || floorName(show(p.desk_id))}, a new ${humanize(show(p.family)) || 'family'} family`, show(p.universe)),
  'lab.hypothesis': p => join(show(p.text), show(p.test_plan)),
  'lab.result': p => join(show(p.verdict), show(p.hypothesis_id)),
  'lab.progress': p => show(p.message),
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
      label: event.kind === 'evolution.promoted' && isDemotion(event.payload) ? 'Desk demoted' : EVENT_KINDS[event.kind]?.label || event.kind,
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
async function loadHistory() {
  const data = await fetchJson(`${API}/history`);
  if (data?.schema_version !== 1 || !Array.isArray(data.points) || data.points.length > FLOOR_HISTORY_LIMIT
      || !data.points.every(point => typeof point.at === 'string' && Number.isFinite(Date.parse(point.at))
        && typeof point.account_equity === 'string' && numeric(point.account_equity) && Number(point.account_equity) >= 0)) throw new Error('Invalid balance history.');
  return data.points.map(point => ({ id: `history:${point.at}`, kind: FLOOR_MARK.kind, at: point.at, payload: { account_equity: point.account_equity } }));
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
const streamDeskOf = stream => (typeof stream === 'string' && stream.startsWith('desk:') ? stream.slice(5) : null);
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
export function mastheadNumbers(checkpoint, now = Date.now(), marks = []) {
  const floor = checkpoint?.floor && typeof checkpoint.floor === 'object' ? checkpoint.floor : {};
  const run = checkpoint?.run && typeof checkpoint.run === 'object' ? checkpoint.run : null;
  const clock = runClock(run, now);
  const performance = portfolioPerformance(checkpoint, marks);
  const total = performance.series ? performance.series.last.equity.toFixed(8) : accountEquity(floor) ?? (numeric(floor.live_equity) ? floor.live_equity : null);
  const pnl = performance.profit;
  const share = pnl !== null && performance.netFlows === 0 ? percent((pnl / performance.series.first.equity * 100).toFixed(4)) : '';
  const spent = run && numeric(run.sail_spend_total_usd) ? Number(run.sail_spend_total_usd) : null;
  const per = pnl !== null && spent > 0 ? pnl / spent : null;
  const started = Date.parse(run?.started_at);
  const elapsed = Number.isFinite(started) ? selfImprovingParts(Math.max(0, (now - started) / 1000)) : { main: '—', tick: '' };
  return [
    { key: 'portfolio', label: 'Portfolio', value: total === null ? '—' : money(total, 2), tone: '' },
    { key: 'profit', label: 'Tracked profit', value: pnl === null ? '—' : signedMoney(pnl.toFixed(2), 2), tone: pnl === null ? '' : signOf(pnl.toFixed(2)), note: share },
    { key: 'clock', label: 'Self-improving', value: elapsed.main, tick: elapsed.tick, tone: '', startedAt: Number.isFinite(started) ? started : null },
    { key: 'spent', label: 'Sail spent', value: clock ? clock.spendTotal : '—', tone: '' },
    { key: 'per', label: 'Tracked profit per Sail $', value: per === null ? '—' : signedMoney(per.toFixed(2), 2), tone: per === null ? '' : signOf(per.toFixed(2)) },
  ];
}

export function economicsText(checkpoint, marks = []) {
  const performance = portfolioPerformance(checkpoint, marks);
  const spend = checkpoint?.run?.sail_spend_total_usd;
  const net = performance.profit !== null && numeric(spend)
    ? `Tracked profit less all Sail spending: ${signedMoney((performance.profit - Number(spend)).toFixed(2), 2)}. ` : '';
  return `${net}Profit uses the chart’s starting balance and endpoint, less net deposits since that start. Includes open-position gains/losses and exchange fees; excludes earlier performance and Sail costs. Research backtests are simulated.`;
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
export const FEED_KINDS = ['desk.thought', 'desk.tool_call', 'broker.fill', 'desk.outcome', 'lab.progress'];
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
  if (event.kind === 'lab.progress') {
    const text = plainThought(payload.message);
    const execution = payload.component === 'execution';
    return text ? { id: show(event.id), seq: Number(event.seq) || 0, at: show(event.at), desk: execution ? 'arena' : 'foundry', name: execution ? 'Execution' : 'Foundry',
      practice: false, pnl: '', tone: '', kind: execution ? 'monitoring' : payload.stage === 'learn' ? 'learning' : 'testing', text } : null;
  }
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
// All recorded portfolio values, never reset on a guessed deposit or a large trading loss.
// Balance changes include external cash flows; they are not investment returns.
export function balanceSeries(events, { width = 1000, height = 120 } = {}) {
  const marks = (Array.isArray(events) ? events : []).filter(event => event?.kind === FLOOR_MARK.kind && numeric(event.payload?.account_equity))
    .map(event => ({
      at: Date.parse(event.at), equity: Number(event.payload?.account_equity),
    }))
    .filter(point => Number.isFinite(point.at) && Number.isFinite(point.equity))
    .sort((left, right) => left.at - right.at);
  const points = [...new Map(marks.map(({ at, equity }) => [at, { at, equity }])).values()];
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
    area: `${path} L${width},${height} L0,${height} Z`, flowCut: false,
    change, changeText: signedMoney(change.toFixed(2), 2), tone: change > 0 ? 'positive' : change < 0 ? 'negative' : '',
  };
}
// Keep the audited chart start identical for archive loads, live updates and tape fallback.
export function performanceSeries(events, checkpoint = null) {
  const start = Date.parse(PERFORMANCE_START_AT);
  const end = checkpoint ? Date.parse(checkpoint.published_at) : Infinity;
  const marks = (Array.isArray(events) ? events : []).filter(event => Date.parse(event?.at) >= start && Date.parse(event?.at) <= end);
  const basis = checkpoint?.floor?.performance;
  // This is the original observed mark, preserved by the runtime even if archive sampling
  // omits it. It is not an inferred deposit or a reset after a loss.
  if (basis?.start_at === PERFORMANCE_START_AT && numeric(basis.start_equity)) {
    marks.push({ kind: FLOOR_MARK.kind, at: basis.start_at, payload: { account_equity: basis.start_equity } });
  }
  if (end >= start && completeAccounts(checkpoint?.floor) && numeric(checkpoint.floor.account_equity)) {
    marks.push({ kind: FLOOR_MARK.kind, at: checkpoint.published_at, payload: { account_equity: checkpoint.floor.account_equity } });
  }
  return balanceSeries(marks);
}
function completeAccounts(floor) {
  return Array.isArray(floor?.venues) && floor.venues.length === 2
    && ['kalshi', 'coinbase'].every(venue => floor.venues.some(row => row.venue === venue && !row.stale));
}
export function portfolioPerformance(checkpoint, marks = []) {
  const series = performanceSeries(marks, checkpoint);
  const basis = checkpoint?.floor?.performance;
  const fresh = basis?.verified_at && Math.abs(Date.parse(checkpoint.published_at) - Date.parse(basis.verified_at)) <= 600000;
  const valid = series && basis?.start_at === PERFORMANCE_START_AT && series.first.at === Date.parse(basis.start_at)
    && series.first.equity === Number(basis.start_equity) && numeric(basis.net_flows) && fresh && completeAccounts(checkpoint.floor)
    && series.last.at === Date.parse(checkpoint.published_at);
  const netFlows = valid ? Number(basis.net_flows) : null;
  return { series, netFlows, verifiedAt: valid ? basis.verified_at : null, profit: valid ? series.change - netFlows : null };
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
      const row = positionRow(desk, position);
      if (!(Math.abs(row.value) >= minValue)) { dust += 1; continue; }
      rows.push(row);
    }
  }
  return { rows: rows.sort((left, right) => right.value - left.value), practice, dust };
}
// One holding as the tables show it: the market in words, the side, value, P&L and the reason.
function positionRow(desk, position) {
  const unrealized = looseAmount(position.unrealized_pnl);
  const symbol = instrumentLabel(position.instrument);
  const event = show(position.instrument?.asset_class) === 'event' || symbol.startsWith('KX');
  const side = show(position.side);
  const pnl = numeric(unrealized) ? unrealized : '';
  return {
    desk: show(desk.id), name: raceName(desk), symbol, market: marketTitle(symbol) || '—',
    side: event ? (side === 'no' || side === 'short' ? 'NO' : 'YES') : side, value: Number(position.market_value), valueText: money(looseAmount(position.market_value), 2),
    pnlText: pnl ? signedMoney(pnl, 2) : '—', tone: pnl ? signOf(pnl) : '', ...thesisParts(position.thesis),
  };
}
// One desk's own book, real or practice, largest first; dust is counted, not listed.
export function deskPositionRows(desk, { minValue = 0.5 } = {}) {
  const rows = [];
  let dust = 0;
  for (const position of Array.isArray(desk?.positions) ? desk.positions : []) {
    if (!position || typeof position !== 'object') continue;
    const row = positionRow(desk, position);
    if (!(Math.abs(row.value) >= minValue)) { dust += 1; continue; }
    rows.push(row);
  }
  return { rows: rows.sort((left, right) => right.value - left.value), dust };
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
// A family's first desk that no person wrote: the floor founded it. The retired partners of the
// first build (Merton and the drift desks) were written by hand too.
const familyRoot = id => show(id).replace(/-\d+$/, '');
export function floorFounded(desk, foundedIds = new Set()) {
  const root = familyRoot(desk?.id);
  if (foundedIds.has(root)) return true;
  return generationOf(desk) === 1 && !desk?.parent_id && Boolean(root) && !HUMAN_FOUNDERS.has(root) && !PARTNERS[root];
}
export const isDemotion = payload => show(payload?.to) === 'shadow';
// "drawdown 0.676875 >= 0.15" reads as "drawdown 67.7%, past the 15% limit".
const shareText = value => `${Number((Number(value) * 100).toFixed(1))}%`;
export function reasonText(value) {
  return show(value).replace(/\b(drawdown|daily loss)\s+(\d+(?:\.\d+)?)\s*>=?\s*(\d+(?:\.\d+)?)/gi,
    (_, what, actual, limit) => `${what} ${shareText(actual)}, past the ${shareText(limit)} limit`).replace(/\s+/g, ' ').trim();
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
// Scored decisions, as the gate counts them; the order count when the gate has not reported.
const deskDecisions = desk => (Number.isSafeInteger(desk?.gate?.evidence?.decisions) ? desk.gate.evidence.decisions : Number.isSafeInteger(desk?.orders) ? desk.orders : null);
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
    return {
      id: show(desk.id), name: raceName(desk), generation: generationOf(desk), live: isLive(desk), value, text: pctText(value), tone: toneOf(value), leader: false,
      pnlText: pnl === null ? '—' : signedMoney(pnl.toFixed(2), 2), pnlTone: pnl === null ? '' : signOf(pnl.toFixed(2)), decisions: deskDecisions(desk),
    };
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
  const count = (kind, test = () => true) => new Set(list.filter(event => event?.kind === kind && test(event.payload))
    .map(event => show(event.payload?.desk_id) || show(event.id))).size;
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const experiments = new Set([
    ...list.filter(event => event?.kind === 'lab.experiment').map(event => show(event.payload?.experiment_id)).filter(Boolean),
    ...(Array.isArray(checkpoint?.lab?.experiments) ? checkpoint.lab.experiments.map(item => show(item?.experiment_id)).filter(Boolean) : []),
  ]);
  return {
    bred: Math.max(count('evolution.spawned'), desks.filter(desk => generationOf(desk) > 1 || desk.parent_id).length),
    retired: Math.max(count('evolution.retired'), desks.filter(desk => desk.status === 'retired').length),
    // A move back to a shadow book is published as `evolution.promoted` with `to: "shadow"`.
    promoted: count('evolution.promoted', payload => !isDemotion(payload)), demoted: count('evolution.promoted', isDemotion),
    founded: Math.max(count('evolution.founded'), desks.filter(desk => floorFounded(desk)).length),
    experiments: experiments.size,
  };
}
export const loopCountLine = counts => `bred ${counts.bred} · retired ${counts.retired} · promoted ${counts.promoted}${counts.demoted ? ` · demoted ${counts.demoted}` : ''} · experiments ${counts.experiments}`;

// ---- the race (on the loop page): each family's live desk and its children, who leads
// Each family's real-money partner and its challengers: return, the leader, how far each is
// through its gate, and whether the floor founded the family or moved a partner back to shadow.
export function raceRows(checkpoint, events = []) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const families = [...new Set(desks.map(desk => show(desk.family)).filter(Boolean))];
  const list = Array.isArray(events) ? events : [];
  const foundedIds = new Set(list.filter(event => event?.kind === 'evolution.founded').map(event => show(event.payload?.desk_id)));
  const lastMove = new Map();
  for (const event of list.filter(item => item?.kind === 'evolution.promoted').sort((left, right) => Date.parse(left.at) - Date.parse(right.at))) {
    lastMove.set(show(event.payload?.desk_id), event.payload);
  }
  return families.map(family => {
    const members = desks.filter(desk => show(desk.family) === family)
      .map(desk => ({
        id: show(desk.id), name: raceName(desk), live: isLive(desk), inSession: Boolean(desk.live_session),
        generation: Number.isSafeInteger(desk.generation) ? desk.generation : 1,
        score: numeric(desk.return_pct) ? Number(desk.return_pct) : null,
        scoreText: numeric(desk.return_pct) ? percent(desk.return_pct) : '—', tone: numeric(desk.return_pct) ? signOf(desk.return_pct) : '',
        badges: mutationBadges(desk.mutation), leader: false, gate: gateProgress(desk.gate),
        demoted: !isLive(desk) && isDemotion(lastMove.get(show(desk.id))),
      }))
      .sort((left, right) => left.generation - right.generation || left.id.localeCompare(right.id));
    const scored = members.filter(member => member.score !== null);
    const best = scored.length ? Math.max(...scored.map(member => member.score)) : null;
    const leaders = scored.filter(member => member.score === best);
    if (leaders.length === 1 && members.length > 1) leaders[0].leader = true;
    const live = members.find(member => member.live);
    const founder = desks.find(desk => show(desk.family) === family && generationOf(desk) === 1) || desks.find(desk => show(desk.family) === family);
    return {
      family, label: venueLabel(family), name: partnerOf(founder).surname, word: FAMILY_WORDS[family] || humanize(family),
      founded: floorFounded(founder, foundedIds), live: live ? live.name : '', members, closest: closestCandidate(members),
    };
  });
}
// The gate a desk faces next, as checks met. `failed` names the checks the evidence did not clear.
const GATE_CHECKS = { days_live: 'days live', decisions: 'decisions', cost_adjusted_return: 'return after costs', drawdown: 'drawdown', breakers: 'breakers', reconciliation: 'clean books' };
export function gateProgress(gate) {
  if (!gate || typeof gate !== 'object') return null;
  const evidence = gate.evidence && typeof gate.evidence === 'object' ? gate.evidence : {};
  const raw = Array.isArray(gate.failed) ? gate.failed : evidence.failed;
  const failed = (Array.isArray(raw) ? raw.map(show) : show(raw).split(',')).map(item => item.trim()).filter(Boolean);
  if (gate.passed !== true && !failed.length) return null;
  const total = new Set([...Object.keys(GATE_CHECKS), ...failed]).size;
  const shown = key => {
    const value = evidence[key === 'drawdown' ? 'max_drawdown_pct' : key === 'cost_adjusted_return' ? 'cost_adjusted_excess_pct' : key];
    if (key === 'days_live' || key === 'decisions' || key === 'breakers') return Number.isSafeInteger(value) ? ` (${value})` : '';
    if (key === 'drawdown') return numeric(show(value)) ? ` (${shareText(value)})` : '';
    if (key === 'cost_adjusted_return') return numeric(show(value)) ? ` (${percent(show(value))})` : '';
    return '';
  };
  return {
    name: show(gate.name), passed: gate.passed === true, total, met: gate.passed === true ? total : total - failed.length,
    missing: gate.passed === true ? [] : failed.map(key => `${GATE_CHECKS[key] || humanize(key)}${shown(key)}`),
  };
}
// The challenger nearest its gate: most checks met, then the better return.
function closestCandidate(members) {
  return members.filter(member => !member.live && member.gate)
    .sort((left, right) => (right.gate.met - left.gate.met) || ((right.score ?? -Infinity) - (left.score ?? -Infinity)))[0] || null;
}
export function gateLine(member) {
  if (!member?.gate) return '';
  const gate = member.gate;
  const head = `${member.name}, gate ${gate.name}: ${gate.met} of ${gate.total} met`;
  return gate.passed ? `${head}, passed` : `${head}${gate.missing.length ? `; short on ${gate.missing.join(', ')}` : ''}`;
}
// ---- the floor page, drawn
const FEED_LINES = 12;
const TRADE_ROWS = 8;
const HERO_TEXT_LIMIT = 420;
const FEED_LABELS = { thinking: 'thinking', researching: 'researching', trading: 'trading', testing: 'testing', learning: 'learning' };
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
  return mastheadNumbers(checkpoint, Date.now(), state.marks).map(item => {
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
  who.append(['foundry', 'arena'].includes(line.desk) ? element('span', line.name, 'feed-name') : link(line.name, deskHref(line.desk), 'feed-name'));
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

function balanceChart(series, performance) {
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
  const since = element('span', 'All tracked history · since ');
  since.append(timeNode(new Date(series.first.at).toISOString()));
  const now = element('span', null, 'balance-now');
  now.append(element('b', series.changeText, series.tone || null), element('span', ` balance change · now ${money(series.last.equity.toFixed(2), 2)}`));
  caption.append(since, now);
  const reconciliation = performance.profit === null ? 'Profit unavailable until both balances and funding history are verified.'
    : `${series.changeText} balance change − ${signedMoney(performance.netFlows.toFixed(2), 2)} net deposits = ${signedMoney(performance.profit.toFixed(2), 2)} tracked profit.`;
  const verified = performance.verifiedAt ? ` Funding checked ${date(performance.verifiedAt)}.` : '';
  figure.append(plot, caption, element('p', `${reconciliation}${verified} Starts at the first complete account reading, not the original deposits; earlier performance is excluded.`, 'floor-economics'));
  return figure;
}
function portfolioPanel(checkpoint, marks) {
  const venues = accountVenues(checkpoint?.floor);
  const performance = portfolioPerformance(checkpoint, marks);
  const series = performance.series;
  const line = element('p', null, 'venues');
  for (const row of venues) {
    const chip = element('span', null, row.stale ? 'venue venue-stale' : 'venue');
    chip.append(element('span', row.name, 'venue-name'), element('b', money(row.equity, 2)));
    if (row.stale) { chip.append(element('i', 'stale')); chip.setAttribute('title', `${row.name} did not answer the last balance request.`); }
    line.append(chip);
  }
  const nodes = venues.length || series ? [line] : [];
  if (series) nodes.push(balanceChart(series, performance));
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
function arenaPanel(checkpoint) {
  const arena = arenaRows(checkpoint);
  if (!arena.rows.length) return [element('p', 'The strategies appear with the first checkpoint.', 'empty-state')];
  const nodes = [element('p', arenaLine(arena), 'record-line')];
  const table = element('table', null, 'rows rows-arena');
  table.append(headRow([['Strategy', 'col-strategy'], ['Book', 'col-agent'], ['Every', 'col-num'], ['Fills', 'col-num'], ['Settled', 'col-num'], ['P&L', 'col-num']]));
  const body = element('tbody');
  for (const row of arena.rows) {
    const line = element('tr', null, row.enabled ? '' : 'row-practice');
    const name = element('td', null, 'col-strategy');
    name.append(element('span', row.name, 'strategy-name'), tagNode(row.origin, row.origin === 'foundry' ? 'foundry' : 'note'));
    if (row.proven) name.append(tagNode('proven', 'real'));
    if (row.family) name.append(element('span', row.family, 'strategy-family'));
    const book = agentCell(row.desk, row.deskName, true);
    if (row.bookRole === 'explorers') book.append(tagNode('explorers book', 'foundry'));
    line.append(name, book, element('td', row.every, 'col-num col-every'), element('td', String(row.fills), 'col-num'),
      element('td', row.settledText, 'col-num'), element('td', row.pnlText, `col-num col-pnl ${row.tone}`.trim()));
    body.append(line);
  }
  table.append(body);
  nodes.push(table);
  nodes.push(element('p', 'Every row trades real money at learning size until its own settled record, or the family’s pooled one, passes the evidence gate; then its size ramps. A Foundry row is code the research loop wrote and backtested; a losing record retires it. An explorers book carries only Foundry rows, so the research loop’s bets never spend the proven code’s cash.', 'quiet-line'));
  return nodes;
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
    toggle: find('closed-toggle'), leaders: find('floor-leaders'), learning: find('floor-learning'), arena: find('floor-arena'),
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
  const drawPortfolio = () => {
    if (!state.checkpoint) return;
    drawn(box.portfolio, portfolioPanel(state.checkpoint, state.marks));
    drawn(box.numbers, numbersPanel(state.checkpoint, state));
    const economics = find('floor-economics');
    if (economics) economics.textContent = economicsText(state.checkpoint, state.marks);
  };
  const drawLearning = () => { if (state.checkpoint) drawn(box.learning, learningPanel(state.checkpoint, loopCounts(state.loop, state.checkpoint))); };
  const keepFeed = events => {
    const byId = new Map([...state.feed, ...events].map(event => [event.id, event]));
    state.feed = [...byId.values()].sort((left, right) => (Number(right.seq) || 0) - (Number(left.seq) || 0)).slice(0, 400);
  };
  async function refresh() {
    try {
      state.checkpoint = await loadCheckpoint();
      try { state.marks = await loadHistory(); } catch { /* Keep the last verified history during an outage. */ }
      const desks = orderDesks(state.checkpoint.desks).filter(desk => desk && typeof desk === 'object');
      state.desks = new Map(desks.map(desk => [show(desk.id), desk]));
      state.liveIds = new Set(desks.filter(isLive).map(desk => show(desk.id)));
      drawPortfolio();
      drawn(box.positions, positionsPanel(state.checkpoint, state));
      drawn(box.arena, arenaPanel(state.checkpoint));
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
      for (const node of [box.portfolio, box.positions, box.closed, box.leaders, box.learning, box.arena]) drawn(node, []);
    }
  }
  await refresh();
  const loads = [
    { kind: 'desk.thought', limit: 60 }, { kind: 'desk.tool_call', limit: 100 }, { kind: 'broker.fill', limit: 60 },
    { kind: 'desk.session_ended', limit: 40 }, { kind: 'desk.outcome', limit: MAX_EVENT_LIMIT },
    { stream: 'ops', kind: 'floor.mark', limit: MAX_EVENT_LIMIT }, { stream: 'evolution', limit: MAX_EVENT_LIMIT }, { kind: 'lab.experiment', limit: MAX_EVENT_LIMIT },
    { kind: 'lab.progress', limit: 60 },
  ];
  const [thoughts, calls, fills, endings, outcomes, marks, evolution, experiments, progress] = await Promise.all(loads.map(query => loadEvents(query).catch(() => ({ events: [] }))));
  keepFeed([...thoughts.events, ...calls.events, ...fills.events, ...endings.events, ...outcomes.events.slice(0, 40), ...progress.events]);
  state.outcomes = outcomes.events;
  if (!state.marks.length) state.marks = marks.events;
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
  const loaded = [thoughts, calls, fills, endings, outcomes, marks, evolution, experiments, progress].flatMap(batch => batch.events);
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
      if (balance.length) { state.marks = [...state.marks, ...balance]; drawPortfolio(); }
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
  if (note) heading.append(typeof note === 'string' ? element('span', note) : note);
  node.append(heading);
  return node;
}
function details(summaryText, body, className = 'panel') {
  const node = element('details', null, className);
  node.append(element('summary', summaryText));
  node.append(body);
  return node;
}
function setTitle(value) {
  try { if (typeof document !== 'undefined') document.title = value; } catch { /* The tab keeps its markup title. */ }
}
function numberCell(item) {
  const row = element('div', null, `number number-${item.key}`);
  const value = element('dd', null, item.tone || null);
  value.append(element('span', item.value, 'number-value'));
  if (item.note) value.append(element('span', item.note, `number-note ${item.noteTone || ''}`.trim()));
  row.append(element('dt', item.label), value);
  if (item.title) row.setAttribute('title', item.title);
  return row;
}
// A "more" chip under a list that shows its first rows.
function moreChip(open, hidden, toggle) {
  const button = element('button', open ? 'fewer' : `${hidden} more`, 'chip more');
  button.type = 'button';
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  button.addEventListener('click', toggle);
  return button;
}
// "3:20 PM" today, "Sep 15" on an earlier day, both Eastern.
export function whenText(value, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const day = stamp => date(new Date(stamp).toISOString(), 'day');
  return day(at) === day(now) ? date(value, 'time') : date(value, 'md');
}
function whenNode(value) {
  const node = element('time', whenText(value));
  node.dateTime = value;
  node.setAttribute('title', date(value));
  return node;
}

// ============================================================================ desk page
// Who this partner is, how it is doing, what it is thinking now, what it holds and why, what it
// has traded, and what it has learned. Pure helpers first; the renderers and startDesk follow.

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
// A thought as prose that keeps its paragraphs: the model's markdown marks are for a renderer the
// page does not use.
export const thoughtText = value => show(value).replace(/\*\*|__|`+/g, '').replace(/^#{1,6}\s+/gm, '')
  .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
// Tool calls in the words a person would use: the floor's research lines, and what a desk does
// with its hands. A tool with no words here (reading a result, ending the session) stays out.
const cents = (value, event) => (numeric(show(value)) ? (event && Number(value) < 1 ? centsText(show(value)) : priceText(show(value))) : '');
export const ACTIONS = {
  ...RESEARCH,
  propose_order: args => {
    const instrument = args?.instrument && typeof args.instrument === 'object' ? args.instrument : { symbol: show(args?.instrument) };
    const symbol = show(instrument.market_id) || show(instrument.symbol) || show(args?.market_id);
    const event = show(instrument.asset_class) === 'event' || symbol.startsWith('KX');
    const right = event ? ` ${(show(instrument.right) || 'yes').toUpperCase()} on` : '';
    const price = cents(args?.limit_price, event);
    const side = show(args?.side);
    return `proposing ${side ? `to ${side}` : 'an order for'} ${quantityText(args?.quantity)}${right} ${marketTitle(symbol) || 'a market'}${price ? ` at ${price}` : show(args?.order_type) === 'market' ? ' at market' : ''}`;
  },
  record_forecast: args => {
    const market = marketTitle(show(args?.market)) || 'a market';
    const price = numeric(show(args?.market_price)) ? `, market at ${centsText(show(args.market_price))}` : '';
    return `putting ${probabilityText(show(args?.probability))} on ${market}${price}`;
  },
  memo: args => { const title = argument(args, 'title'); return title ? `writing a memo: ${said(title)}` : 'writing a memo'; },
  memory_write: args => (show(args?.kind) === 'lesson' ? 'writing down a lesson' : 'taking a note'),
  playbook_read: () => 'rereading its playbook',
  playbook_write: () => 'rewriting its playbook',
  deploy_strategy: args => { const name = argument(args, 'name'); return name ? `deploying its ${humanize(name)} strategy` : 'deploying a strategy'; },
  undeploy_strategy: args => { const name = argument(args, 'name'); return name ? `switching off its ${humanize(name)} strategy` : 'switching off a strategy'; },
  cancel_order: () => 'cancelling an order',
};
export function actionWords(payload) {
  const words = ACTIONS[show(payload?.tool)];
  if (!words) return '';
  try { return words(payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {}); } catch { return ''; }
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
    text: event.kind === 'desk.thought' ? thoughtText(event.payload?.text) : actionWords(event.payload),
    ...(event.kind === 'desk.tool_call' ? { tool: show(event.payload?.tool) } : {}),
  })).filter(item => item.text);
  const memo = byTime.filter(event => event.kind === 'desk.memo' && inSession(event)).at(-1) || null;
  return {
    sessionId, trigger: show(start?.payload?.trigger), startedAt: start?.at || null, endedAt: ended?.at || null,
    reason: show(ended?.payload?.reason), memo: show(memo?.payload?.title) || show(memo?.payload?.text),
    running: Boolean(start) && !ended, items,
  };
}
// Every session the desk's stream still holds, newest first: why it sat down, what it thought and
// did, and how it closed. A trimmed start still has its trigger, in the session id.
const sessionTrigger = id => { const parts = show(id).split(':'); return parts.length > 2 ? parts.slice(2).join(':') : ''; };
export function deskSessions(events, deskId = null) {
  const list = (Array.isArray(events) ? events : []).filter(event => event && typeof event === 'object'
    && (deskId === null || event.stream === `desk:${deskId}`))
    .sort((left, right) => (Date.parse(left.at) - Date.parse(right.at)) || ((left.seq || 0) - (right.seq || 0)));
  const sessions = new Map();
  const seen = new Set();
  for (const event of list) {
    const key = show(event.payload?.session_id);
    if (!key || seen.has(event.id)) continue;
    seen.add(event.id);
    if (!sessions.has(key)) sessions.set(key, { sessionId: key, trigger: sessionTrigger(key), startedAt: null, endedAt: null, reason: '', memo: '', summary: '', items: [], first: event.at });
    const row = sessions.get(key);
    const payload = event.payload;
    if (event.kind === 'desk.session_started') { row.startedAt = event.at; row.trigger = show(payload.trigger) || row.trigger; }
    else if (event.kind === 'desk.session_ended') { row.endedAt = event.at; row.reason = show(payload.reason); }
    else if (event.kind === 'desk.memo') row.memo = show(payload.title) || truncate(thoughtText(payload.text), 90).text;
    else if (event.kind === 'desk.thought') { const text = thoughtText(payload.text); if (text) row.items.push({ id: event.id, at: event.at, kind: 'thought', text }); }
    else if (event.kind === 'desk.tool_call') {
      if (show(payload.tool) === 'end_session') { row.summary = thoughtText(payload.arguments?.summary); continue; }
      const text = actionWords(payload);
      if (text) row.items.push({ id: event.id, at: event.at, kind: 'call', tool: show(payload.tool), text });
    }
  }
  return [...sessions.values()].filter(row => row.items.length || row.startedAt)
    .map(({ first, ...row }) => ({ ...row, at: row.startedAt || first, running: Boolean(row.startedAt) && !row.endedAt }))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}
// The newest few thoughts of a session and what the desk did between them. The same action twice
// in a row reads once with a count; a run of one tool (six forecasts, four quotes) reads as its
// first call and how many more followed.
export function recentItems(items, { thoughts = 6, max = 14 } = {}) {
  const list = [];
  for (const item of Array.isArray(items) ? items : []) {
    const last = list.at(-1);
    if (last && item.kind === 'call' && last.kind === 'call') {
      if (last.text === item.text && !last.more) { list[list.length - 1] = { ...last, count: (last.count || 1) + 1 }; continue; }
      if (item.tool && last.tool === item.tool) { list[list.length - 1] = { ...last, more: (last.more || 0) + (last.count || 1), count: 1 }; continue; }
    }
    list.push(item);
  }
  let count = 0;
  let from = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index].kind === 'thought') count += 1;
    if (count === thoughts) { from = index; break; }
  }
  return list.slice(from).slice(-max);
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
// One line of a session: the time, then a thought (clamped, opens in place) or what it did.
function thoughtRow(item, typed = false) {
  const node = element('div', null, item.kind === 'call' ? 'thought thought-call' : 'thought');
  node.append(timeNode(item.at, 'hm'));
  const text = element(item.kind === 'thought' ? 'button' : 'span', typed ? '' : item.text, 'thought-text');
  if (item.kind === 'thought') {
    text.type = 'button';
    text.setAttribute('aria-expanded', 'false');
    text.addEventListener('click', () => {
      const open = text.getAttribute('aria-expanded') !== 'true';
      text.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  node.append(text);
  if (item.count > 1) node.append(element('span', `×${item.count}`, 'feed-count'));
  else if (item.more > 0) node.append(element('span', `+${item.more} more`, 'feed-count'));
  return { node, text };
}
// The stream itself. `load` draws a session (the last thought typed only while it runs);
// `push` types whatever arrives live, in order, tool calls as one short line each.
export function thoughtStream(container, { instant = false, schedule = typingSchedule, setTimer = setTimeout, clearTimer = clearTimeout, keep = 18 } = {}) {
  const seen = new Set();
  const queue = [];
  let timer = null;
  let busy = false;
  const trim = () => { try { while (container.children.length > keep) container.children[0].remove(); } catch { /* nothing to trim */ } };
  function next() {
    if (busy || !queue.length) return;
    const { item, animate } = queue.shift();
    const { node, text } = thoughtRow(item, true);
    const full = item.text;
    container.append(node);
    trim();
    if (!animate || instant || item.kind === 'call') { text.textContent = full; next(); return; }
    const plan = schedule(full);
    let shown = 0;
    busy = true;
    const step = () => {
      shown = Math.min(full.length, shown + plan.chunk);
      text.textContent = full.slice(0, shown);
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
// One sentence per founding partner, from the manifests the owner wrote. A bred desk inherits
// its founder's; a family the floor founded is described by the universe it chose.
const FOUNDER_MANDATES = {
  mullins: 'Prices Fed decisions, economic releases and other public events on Kalshi from base rates, and bets only the edge it can argue for.',
  hilibrand: 'Trades the major coins on Coinbase around the clock on written setups, each with an invalidation and a time stop.',
  haghani: 'Prices Kalshi’s daily temperature markets from the National Weather Service forecast and trades only the buckets the market has mispriced.',
  scholes: 'Prices a distribution, not a direction: turns realized volatility into a probability for each BTC, ETH and index bucket Kalshi lists.',
};
export function deskIdentity(desk, events = [], id = show(desk?.id)) {
  const list = (Array.isArray(events) ? events : []).filter(event => event && typeof event === 'object');
  const root = familyRoot(id);
  const family = show(desk?.family);
  const newest = (kind, test) => list.filter(event => event.kind === kind && test(event.payload || {}))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0] || null;
  const founding = newest('evolution.founded', payload => show(payload.desk_id) === root || (Boolean(family) && show(payload.family) === family));
  const move = newest('evolution.promoted', payload => show(payload.desk_id) === id);
  const round = newest('committee.allocation', payload => payload.allocations && typeof payload.allocations === 'object' && Object.hasOwn(payload.allocations, id));
  const live = isLive(desk);
  const sleeve = live && round ? looseAmount(show(round.payload.allocations[id])) : '';
  const generation = generationOf(desk);
  const parent = show(desk?.parent_id);
  const mutation = desk?.mutation && typeof desk.mutation === 'object' ? desk.mutation : null;
  const word = FAMILY_WORDS[family] || humanize(family);
  return {
    id, name: desk ? raceName(desk) : floorName(id), live, family,
    lineage: join(family ? `${word} family` : '', generation > 1 ? `generation ${roman(generation)}` : 'founder'),
    parent: parent ? { id: parent, name: floorName(parent) } : null,
    founded: Boolean(founding) || (desk ? floorFounded(desk) : false), rationale: show(founding?.payload?.rationale),
    mandate: FOUNDER_MANDATES[root] || PARTNERS[root]?.mandate || show(founding?.payload?.universe),
    demoted: move && isDemotion(move.payload) && !live ? { at: move.at, reason: reasonText(move.payload.reason) } : null,
    promoted: move && !isDemotion(move.payload) && live ? { at: move.at } : null,
    born: mutation ? join(profileName(mutation.model_profile), mutation.reasoning_effort ? `effort ${show(mutation.reasoning_effort)}` : '') : '',
    trait: show(mutation?.persona_trait), inSession: Boolean(desk?.live_session),
    // A real-money partner's sleeve, and Meriwether's latest word on it.
    sleeve: numeric(sleeve) ? { usd: money(sleeve, 2), empty: scaled(sleeve) === 0n, reason: reasonText(round.payload.reasons?.[id]) } : null,
  };
}
// Five numbers: what the book is worth, what it has made, its return, how often it trades, and
// the share of compute the committee gives it.
export function deskNumbers(desk) {
  const pnl = desk ? deskPnl(desk) : null;
  const live = isLive(desk);
  const factor = numeric(show(desk?.budget_factor)) ? Number(desk.budget_factor) : null;
  return [
    { key: 'equity', label: 'Equity', value: numeric(looseAmount(desk?.equity)) ? money(looseAmount(desk.equity), 2) : '—', note: desk && !live ? 'practice' : '' },
    { key: 'pnl', label: 'Lifetime P&L', value: pnl === null ? '—' : signedMoney(pnl.toFixed(2), 2), tone: pnl === null ? '' : signOf(pnl.toFixed(2)) },
    { key: 'return', label: 'Return', value: numeric(desk?.return_pct) ? percent(desk.return_pct) : '—', tone: numeric(desk?.return_pct) ? signOf(desk.return_pct) : '' },
    { key: 'trades', label: 'Trades', value: Number.isSafeInteger(desk?.orders) ? String(desk.orders) : '—' },
    { key: 'compute', label: 'Compute', value: factor === null ? '—' : `${factor}×`, title: 'The share of the base model budget the committee gives this partner.' },
  ];
}
// The record in one line: how many closed, how many won, what they made together.
export function deskRecordLine(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const won = list.filter(row => Number(row.pnl) > 0).length;
  const total = list.reduce((sum, row) => sum + (Number(row.pnl) || 0), 0);
  const real = list.filter(row => row.live).length;
  const word = real === list.length ? 'real-money trade' : real === 0 ? 'practice trade' : 'trade';
  return join(plural(list.length, word), `${won} won`, signedMoney(total.toFixed(2), 2), real && real < list.length ? `${real} with real money` : '');
}
function cadenceText(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n % 3600 === 0) return `${n / 3600}h`;
  if (n % 60 === 0) return `${n / 60} min`;
  return `${n}s`;
}
// The family's pooled record of this code: every desk of the family, real money and shadow,
// and whether that record passes the evidence gate that sizes the live desks.
export function familyEvidenceText(family) {
  if (!family || typeof family !== 'object') return '';
  const settled = Number(family.settled) || 0;
  if (!settled) return '';
  const real = Number(family.real_settled) || 0;
  const desks = Number(family.desks) || 0;
  const pnl = numeric(show(family.settled_pnl_usd)) ? signedMoney(show(family.settled_pnl_usd), 2) : '';
  const verdict = family.passes ? 'passes the evidence gate' : 'not yet proven';
  return join(`family record ${settled} settled${real ? ` (${real} real)` : ''}${desks ? ` on ${plural(desks, 'desk')}` : ''}`, pnl, verdict);
}
// Strategies: code the desk deployed to trade for it between sessions, one row each.
export function strategyRows(desk) {
  return (Array.isArray(desk?.strategies) ? desk.strategies : []).filter(row => row && typeof row === 'object').map(row => {
    const settled = Number(row.settled) || 0;
    const pnl = numeric(show(row.settled_pnl_usd)) ? show(row.settled_pnl_usd) : '';
    const params = row.params && typeof row.params === 'object' && !Array.isArray(row.params) ? row.params : {};
    return {
      name: humanize(show(row.name)), every: row.enabled === false ? 'Paused' : cadenceText(row.cadence_seconds) || '—', runs: Number(row.runs) || 0,
      approved: `${Number(row.approved) || 0} of ${Number(row.intents) || 0}`, fills: Number(row.fills) || 0,
      settled: settled ? `${Number(row.wins) || 0} of ${settled} won` : '—', pnlText: settled && pnl ? signedMoney(pnl, 2) : '—', tone: settled && pnl ? signOf(pnl) : '',
      note: show(row.note), errors: Number(row.errors) || 0, lastNotes: show(row.last_notes),
      family: familyEvidenceText(row.family),
      settings: Object.entries(params).map(([key, value]) => `${humanize(key)} ${Array.isArray(value) ? value.map(show).join(', ') : show(value)}`).join(' · '),
    };
  });
}
// The arena: every strategy trading real money on a live book, one row each, with its own
// record and the family's pooled one; shadow desks' variants are counted, not listed. The floor
// sizes each row on its record, so this table is where the money follows the evidence.
export function arenaRows(checkpoint) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const rows = [];
  let variants = 0;
  for (const desk of desks) {
    const strategies = Array.isArray(desk.strategies) ? desk.strategies.filter(row => row && typeof row === 'object') : [];
    if (!isLive(desk)) { variants += strategies.filter(row => row.enabled !== false).length; continue; }
    for (const row of strategies) {
      const settled = Number(row.settled) || 0;
      const pnl = numeric(show(row.settled_pnl_usd)) ? show(row.settled_pnl_usd) : '';
      const name = show(row.name);
      const foundry = /_f\d+(?:_\d+)?$/.test(name);
      rows.push({
        desk: show(desk.id), deskName: raceName(desk), name: humanize(name), origin: foundry ? 'foundry' : row.house ? 'house' : 'desk',
        enabled: row.enabled !== false, every: row.enabled === false ? 'paused' : cadenceText(row.cadence_seconds) || '—',
        runs: Number(row.runs) || 0, fills: Number(row.fills) || 0, settled, wins: Number(row.wins) || 0,
        settledText: settled ? `${Number(row.wins) || 0} of ${settled}` : '—',
        pnl: settled && pnl ? Number(pnl) : null, pnlText: settled && pnl ? signedMoney(pnl, 2) : '—', tone: settled && pnl ? signOf(pnl) : '',
        family: familyEvidenceText(row.family), proven: Boolean(row.family && typeof row.family === 'object' && row.family.passes), note: show(row.note),
      });
    }
  }
  // A book whose every active row is Foundry code is an explorers book: the research loop's
  // own real-money sleeve, kept apart from the house strategies' cash.
  const explorerBooks = new Set();
  for (const desk of desks.filter(isLive)) {
    const active = rows.filter(row => row.desk === show(desk.id) && row.enabled);
    if (active.length && active.every(row => row.origin === 'foundry')) explorerBooks.add(show(desk.id));
  }
  for (const row of rows) row.bookRole = explorerBooks.has(row.desk) ? 'explorers' : 'house';
  rows.sort((left, right) => Number(right.enabled) - Number(left.enabled) || Number(right.proven) - Number(left.proven) || right.settled - left.settled || (right.pnl ?? -Infinity) - (left.pnl ?? -Infinity) || left.name.localeCompare(right.name));
  return { rows, variants, books: desks.filter(isLive).length, explorerBooks: [...explorerBooks] };
}
export const arenaLine = ({ rows, variants, books }) => {
  const active = rows.filter(row => row.enabled).length;
  return `${active} ${active === 1 ? 'strategy' : 'strategies'} on ${plural(books, 'real-money book')} · ${plural(variants, 'variant')} testing in practice`;
};

// What the desk wrote down to remember, newest first: its lessons, as `memory_write` calls.
export function deskLessons(events, limit = 3) {
  return (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === 'desk.tool_call' && show(event.payload?.tool) === 'memory_write'
      && show(event.payload?.arguments?.kind) === 'lesson' && show(event.payload?.arguments?.text))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, limit)
    .map(event => ({ id: show(event.id), at: show(event.at), text: thoughtText(event.payload.arguments.text).replace(/^\d{4}-\d{2}-\d{2}(?:[ T]~?\d{2}:\d{2}Z?)?:?\s*/, '') }));
}
// A memo or post-mortem split into the paragraph a visitor reads and the rest behind a click.
export function leadParagraph(value) {
  const paragraphs = thoughtText(value).split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const index = paragraphs.findIndex(part => part.split(/\s+/).length > 6);
  const at = index === -1 ? 0 : index;
  return { lead: paragraphs[at] || '', rest: paragraphs.filter((_, n) => n !== at).join('\n\n') };
}

function deskHeaderInto(box, identity) {
  const nodes = [element('h1', identity.name)];
  const tags = element('p', null, 'desk-tags');
  tags.append(modeTag(identity.live));
  if (identity.demoted) tags.append(tagNode('demoted', 'demoted'));
  if (identity.founded) tags.append(tagNode('founded by the floor', 'founded'));
  const lineage = element('span', null, 'desk-lineage');
  lineage.append(element('span', identity.lineage));
  if (identity.parent) lineage.append(element('span', ' · bred from '), link(identity.parent.name, deskHref(identity.parent.id)));
  tags.append(lineage);
  nodes.push(tags);
  if (identity.mandate) nodes.push(element('p', identity.mandate, 'lede desk-mandate'));
  const born = join(identity.born && `born on ${identity.born}`, identity.trait && `“${identity.trait}”`);
  if (born) nodes.push(element('p', born, 'desk-born'));
  if (identity.sleeve) nodes.push(element('p', `Sleeve ${identity.sleeve.usd}${identity.sleeve.reason ? `: ${identity.sleeve.reason}` : ''}.`, identity.sleeve.empty ? 'desk-note' : 'desk-born'));
  if (identity.demoted) nodes.push(element('p', `Moved back to a shadow book ${agoText(identity.demoted.at)}${identity.demoted.reason ? `: ${identity.demoted.reason}` : ''}.`, 'desk-note'));
  if (identity.rationale) nodes.push(details('why the floor founded it', element('p', identity.rationale), 'more-panel desk-why'));
  box.replaceChildren(...nodes);
}
function deskHoldingsPanel(desk, state) {
  const { rows, dust } = deskPositionRows(desk);
  if (!rows.length) return null;
  const block = section('Holdings', isLive(desk) ? 'real money' : 'practice');
  const table = element('table', null, 'rows rows-book rows-desk');
  table.append(headRow([['Market', 'col-market'], ['Side', 'col-side'], ['Value', 'col-num'], ['P&L', 'col-num'], ['Why', 'col-why']]));
  const body = element('tbody');
  for (const row of rows.slice(0, state.moreHoldings ? rows.length : TRADE_ROWS)) {
    const line = element('tr');
    line.append(element('td', row.market, 'col-market'), element('td', row.side, 'col-side'), element('td', row.valueText, 'col-num col-value'),
      element('td', row.pnlText, `col-num col-pnl ${row.tone}`.trim()), whyCell(row, state, `holding:${row.symbol}:${row.side}`));
    body.append(line);
  }
  table.append(body);
  block.append(table);
  if (rows.length > TRADE_ROWS) block.append(moreChip(state.moreHoldings, rows.length - TRADE_ROWS, () => { state.moreHoldings = !state.moreHoldings; state.drawDetail(); }));
  if (dust) block.append(element('p', `${plural(dust, 'position')} under 50¢ not shown.`, 'quiet-line'));
  return block;
}
function deskRecordPanel(state) {
  const rows = closedRows(state.outcomes, { desks: state.desk ? [state.desk] : [] }, { limit: MAX_EVENT_LIMIT });
  if (!rows.length) return null;
  const block = section('Record', deskRecordLine(rows));
  const table = element('table', null, 'rows rows-trades rows-desk');
  table.append(headRow([['Market', 'col-market'], ['Result', 'col-result'], ['P&L', 'col-num'], ['Held', 'col-held'], ['Why', 'col-why']]));
  const body = element('tbody');
  for (const row of rows.slice(0, state.more ? MAX_EVENT_LIMIT : TRADE_ROWS)) {
    const line = element('tr');
    const result = element('td', row.outcome, `col-result result-${row.outcome}`);
    if (row.settled) result.setAttribute('title', row.settled);
    line.append(element('td', row.market, 'col-market'), result, element('td', row.pnlText, `col-num col-pnl ${row.tone}`.trim()),
      element('td', row.heldText || '—', 'col-held'), whyCell(row, state, `trade:${row.id}`));
    body.append(line);
  }
  table.append(body);
  block.append(table);
  if (rows.length > TRADE_ROWS) block.append(moreChip(state.more, rows.length - TRADE_ROWS, () => { state.more = !state.more; state.drawDetail(); }));
  return block;
}
// Code that trades for the desk between sessions, and the code it ran while thinking.
function deskStrategiesPanel(desk, events) {
  const rows = strategyRows(desk);
  const runs = codeRuns(events);
  if (!rows.length && !runs.length) return null;
  const block = section(rows.length ? 'Strategies' : 'Toolbox', rows.length ? 'code that trades between sessions' : '');
  if (rows.length) block.append(...strategyTable(rows));
  if (runs.length) {
    const list = element('ul', null, 'runs');
    for (const run of runs.slice(0, 20)) {
      const item = element('li', null, run.exit === 0 ? 'run' : 'run run-failed');
      item.append(whenNode(run.at), element('span', run.purpose, 'run-purpose'), element('span', join(run.exit === 0 ? '' : `exit ${run.exit}`, run.seconds ? `${Number(run.seconds).toFixed(1)}s` : ''), 'run-meta'));
      list.append(item);
    }
    block.append(details(`code it ran · ${plural(runs.length, 'run')}`, list, 'more-panel'));
  }
  return block;
}
function strategyTable(rows) {
  const nodes = [];
  const table = element('table', null, 'rows rows-strategies');
  table.append(headRow([['Strategy', 'col-strategy'], ['Every', 'col-num'], ['Runs', 'col-num'], ['Approved', 'col-num'], ['Fills', 'col-num'], ['Settled', 'col-num'], ['P&L', 'col-num']]));
  const body = element('tbody');
  for (const row of rows) {
    const line = element('tr');
    const name = element('td', null, 'col-strategy');
    name.append(element('span', row.name, 'strategy-name'));
    if (row.note) name.append(tagNode(row.note, 'note'));
    if (row.family) name.append(tagNode(row.family, 'family'));
    if (row.errors) name.append(tagNode(plural(row.errors, 'error'), 'error'));
    line.append(name, element('td', row.every, 'col-num col-every'), element('td', String(row.runs), 'col-num col-runs'), element('td', row.approved, 'col-num col-approved'),
      element('td', String(row.fills), 'col-num col-fills'), element('td', row.settled, 'col-num col-settled'), element('td', row.pnlText, `col-num col-pnl ${row.tone}`.trim()));
    body.append(line);
  }
  table.append(body);
  nodes.push(table);
  const settings = rows.filter(row => row.settings || row.lastNotes);
  if (settings.length) {
    const list = element('div', null, 'strategy-settings');
    for (const row of settings) {
      const item = element('p');
      item.append(element('b', row.name), element('span', join(row.settings, row.lastNotes && `last run: ${truncate(row.lastNotes, 160).text}`)));
      list.append(item);
    }
    nodes.push(details('settings and last runs', list, 'more-panel'));
  }
  return nodes;
}
function deskLearnedPanel(state) {
  const lessons = deskLessons(state.events);
  const rewrite = latestPlaybook(state.events);
  const postmortem = state.events.filter(event => event.kind === 'desk.postmortem' && show(event.payload?.text))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0] || null;
  if (!lessons.length && !rewrite && !postmortem) return null;
  const block = section('What it learned');
  if (postmortem) {
    const parts = leadParagraph(postmortem.payload.text);
    const item = element('div', null, 'learned');
    const head = element('p', null, 'learned-head');
    head.append(element('span', 'post-mortem', 'learned-kind'), whenNode(postmortem.at));
    item.append(head, element('p', parts.lead, 'learned-text'));
    if (parts.rest) item.append(details('the whole post-mortem', element('p', parts.rest, 'learned-rest'), 'more-panel'));
    block.append(item);
  }
  if (rewrite) {
    const item = element('div', null, 'learned');
    const head = element('p', null, 'learned-head');
    head.append(element('span', rewrite.version ? `playbook v${rewrite.version}` : 'playbook', 'learned-kind'), whenNode(rewrite.at));
    item.append(head, element('p', rewrite.reason || 'Rewrote its playbook.', 'learned-text'));
    if (rewrite.diff) item.append(details('what changed', diffBlock(rewrite.diff), 'more-panel'));
    block.append(item);
  }
  if (lessons.length) {
    const list = element('ul', null, 'lessons');
    for (const lesson of lessons) {
      const item = element('li', null, 'lesson');
      const text = element('button', lesson.text, 'lesson-text');
      text.type = 'button';
      text.setAttribute('aria-expanded', 'false');
      text.addEventListener('click', () => text.setAttribute('aria-expanded', text.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'));
      item.append(whenNode(lesson.at), text);
      list.append(item);
    }
    block.append(list);
  }
  return block;
}
function calibrationPanel(desk, calibration) {
  const summary = desk?.calibration && typeof desk.calibration === 'object' ? desk.calibration : calibration;
  const scored = summary && Number.isSafeInteger(summary.n) && summary.n > 0;
  const bins = reliabilitySeries(calibration?.reliability).points.length;
  if (!scored && !bins) return null;
  const block = section('Calibration', 'said vs happened');
  if (scored) block.append(element('p', join(plural(summary.n, 'forecast') + ' scored', numeric(summary.brier) ? `Brier ${summary.brier} (0 is perfect, 0.25 a coin flip)` : ''), 'record-line'));
  if (bins) block.append(reliabilityFigure(calibration));
  return block;
}

async function startDesk(root) {
  const find = name => root.querySelector(`#${name}`);
  const box = { header: find('desk-header'), numbers: find('desk-numbers'), state: find('desk-state'), now: find('desk-now'), detail: find('desk-detail') };
  const ready = node => node && node.setAttribute('aria-busy', 'false');
  const id = new URLSearchParams(window.location.search).get('id');
  if (!deskId(id)) {
    box.header?.replaceChildren(element('h1', 'No such desk'), element('p', 'Open one from the floor.', 'note'));
    for (const node of [box.numbers, box.now, box.detail]) { node?.replaceChildren(); ready(node); }
    return null;
  }
  const state = { id, desk: null, events: [], outcomes: [], evolution: [], lab: [], mode: 'loading', open: new Set(), more: false, moreHoldings: false, sessionId: '' };
  try { state.desk = await loadDesk(id); } catch { /* The desk's own record fills in at the next refresh. */ }
  setTitle(`${state.desk ? raceName(state.desk) : floorName(id)} · LTCM`);
  const own = (kind, limit) => loadEvents({ stream: `desk:${id}`, kind, limit }).catch(() => ({ events: [] }));
  const [thoughts, calls, starts, ends, memos, outcomes, playbooks, postmortems, runs, evolution, lab, allocation] = await Promise.all([
    own('desk.thought', 80), own('desk.tool_call', 160), own('desk.session_started', 30), own('desk.session_ended', 30), own('desk.memo', 30),
    own('desk.outcome', MAX_EVENT_LIMIT), own('desk.playbook_updated', 10), own('desk.postmortem', 5), own('desk.code_run', 40),
    loadEvents({ stream: 'evolution', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
    loadEvents({ stream: 'lab', kind: 'lab.calibration', limit: 100 }).catch(() => ({ events: [] })),
    loadEvents({ kind: 'committee.allocation', limit: 1 }).catch(() => ({ events: [] })),
  ]);
  state.events = [thoughts, calls, starts, ends, memos, playbooks, postmortems, runs].flatMap(batch => batch.events);
  state.outcomes = outcomes.events;
  state.evolution = [...evolution.events, ...allocation.events];
  state.lab = lab.events;

  const drawHeader = () => { if (box.header) deskHeaderInto(box.header, deskIdentity(state.desk, state.evolution, id)); };
  const drawNumbers = () => { if (box.numbers) { box.numbers.replaceChildren(...deskNumbers(state.desk).map(numberCell)); ready(box.numbers); } };
  const stage = element('div', null, 'thoughts');
  const summary = element('p', '', 'now-summary');
  // The sessions as the page reads them: an ended session has ended whatever the last checkpoint
  // said, and otherwise the checkpoint's live session is the one running.
  const liveSession = () => {
    const session = state.desk?.live_session && typeof state.desk.live_session === 'object' ? state.desk.live_session : null;
    const ended = session && deskSessions(state.events, id).some(row => row.sessionId === show(session.session_id) && row.endedAt);
    return ended ? null : session;
  };
  const sessions = () => {
    const liveId = show(liveSession()?.session_id);
    return deskSessions(state.events, id).map((session, index) => ({ ...session, running: session.running && (liveId ? session.sessionId === liveId : index === 0) }));
  };
  const drawState = () => {
    if (!box.state) return;
    const [current] = sessions();
    const thinking = Boolean(current?.running || liveSession());
    const next = !thinking && state.desk?.next_session_at ? untilText(state.desk.next_session_at) : '';
    summary.textContent = current && !current.running ? current.summary : '';
    stage.className = thinking ? 'thoughts' : 'thoughts thoughts-idle';
    const text = join(idleLine(current || null, Date.now(), liveSession()), next && next !== 'now' ? `next session ${next}` : '');
    box.state.className = `live-status ${thinking ? 'live-live' : 'live-idle'}`;
    box.state.replaceChildren(pulse(), element('span', text));
  };
  const earlier = element('div', null, 'sessions-box');
  const stream = thoughtStream(stage, { instant: typeof requestAnimationFrame === 'undefined' });
  const drawEarlier = list => {
    if (!list.length) { earlier.replaceChildren(); return; }
    const items = element('div', null, 'sessions');
    for (const session of list.slice(0, 12)) {
      const item = element('div', null, 'session');
      const head = element('button', null, 'session-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', 'false');
      head.append(whenNode(session.at), element('span', triggerText(session.trigger), 'session-why'),
        element('span', truncate(session.memo || session.summary || session.items.at(-1)?.text || endReason(session.reason), 140).text, 'session-text'));
      const body = element('div', null, 'session-body');
      body.hidden = true;
      head.addEventListener('click', () => {
        const open = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && !body.children.length) body.append(...session.items.map(entry => thoughtRow(entry).node), ...(session.summary ? [element('p', session.summary, 'now-summary')] : []));
        body.hidden = !open;
      });
      item.append(head, body);
      items.append(item);
    }
    earlier.replaceChildren(details(`earlier sessions · ${list.length}`, items, 'more-panel'));
  };
  const drawNow = () => {
    const list = sessions();
    const [current] = list;
    state.sessionId = current?.sessionId || '';
    stream.load(current ? { ...current, items: recentItems(current.items) } : null);
    drawEarlier(list.slice(1));
    drawState();
  };
  if (box.now) {
    box.now.replaceChildren(stage, summary, earlier);
    drawNow();
    ready(box.now);
  }
  state.drawDetail = () => {
    if (!box.detail) return;
    const calibration = latestCalibration(state.lab, { scope: 'desk', desk_id: id });
    box.detail.replaceChildren(...[
      deskHoldingsPanel(state.desk, state), deskRecordPanel(state), deskStrategiesPanel(state.desk, state.events), deskLearnedPanel(state), calibrationPanel(state.desk, calibration),
    ].filter(Boolean));
    ready(box.detail);
  };
  drawHeader();
  drawNumbers();
  state.drawDetail();
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try { state.desk = await loadDesk(id); } catch { return; }
    drawHeader(); drawNumbers(); drawState(); state.drawDetail();
  }, 60000);
  const feed = startFeed({
    streams: [`desk:${id}`],
    onStatus: mode => { state.mode = mode; drawState(); },
    onEvents: events => {
      const arrived = events.filter(event => event.stream === `desk:${id}`);
      if (!arrived.length) return;
      const closed = arrived.filter(event => event.kind === 'desk.outcome');
      state.events = [...state.events, ...arrived.filter(event => event.kind !== 'desk.outcome')].slice(-1500);
      if (closed.length) state.outcomes = [...closed, ...state.outcomes].slice(0, MAX_EVENT_LIMIT);
      const [current] = sessions();
      if ((current?.sessionId || '') !== state.sessionId) drawNow();
      else {
        stream.push(arrived, id);
        drawState();
      }
      if (closed.length || arrived.some(event => ['desk.playbook_updated', 'desk.postmortem', 'desk.code_run'].includes(event.kind)
        || (event.kind === 'desk.tool_call' && event.payload?.tool === 'memory_write'))) state.drawDetail();
    },
  });
  const loaded = [...state.events, ...state.outcomes];
  const original = feed.stop;
  feed.stop = () => { stream.stop(); original(); };
  feed.remember(loaded);
  feed.prime(loaded.reduce((most, event) => Math.max(most, Number(event.seq) || 0), 0));
  return feed;
}

// ============================================================================ the loop page
// How the floor improves itself and who is winning: the loop's numbers and its nightly clock,
// results by generation, the race for each real-money sleeve, what changed, the live sleeves, and
// Meriwether's memo when he has written one.

// The nightly jobs, America/New_York, as the runtime's config schedules them.
export const LOOP_JOBS = [
  { key: 'committee', at: '18:00' }, { key: 'evolution', at: '19:00' }, { key: 'lab', at: '20:00' }, { key: 'founding', at: '21:30' },
];
const jobMinutes = job => { const [hour, minute] = job.at.split(':').map(Number); return hour * 60 + minute; };
export function loopSchedule(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const part = type => Number(parts.find(item => item.type === type)?.value);
  const current = (part('hour') % 24) * 60 + part('minute');
  const upcoming = LOOP_JOBS.find(job => jobMinutes(job) > current) || LOOP_JOBS[0];
  return LOOP_JOBS.map(job => {
    const [hour, minute] = job.at.split(':').map(Number);
    const wait = ((jobMinutes(job) - current) % 1440 + 1440) % 1440 || 1440;
    return {
      key: job.key, time: `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`, next: job === upcoming,
      until: job === upcoming ? (wait < 60 ? `in ${wait} min` : `in ${Math.floor(wait / 60)}h${wait % 60 ? ` ${wait % 60}m` : ''}`) : '',
    };
  });
}
// The loop in eight numbers.
export function loopStatus(events, checkpoint) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const counts = loopCounts(events, checkpoint);
  const running = (Array.isArray(checkpoint?.lab?.experiments) ? checkpoint.lab.experiments : []).filter(item => item?.status === 'running').length;
  const live = desks.filter(isLive).length;
  return [
    { key: 'families', label: 'Families', value: String(new Set(desks.map(desk => show(desk.family) || show(desk.id))).size) },
    { key: 'partners', label: 'Partners', value: String(desks.length), note: `${live} real money` },
    { key: 'bred', label: 'Bred', value: String(counts.bred) },
    { key: 'promoted', label: 'Promoted', value: String(counts.promoted) },
    { key: 'demoted', label: 'Demoted', value: String(counts.demoted) },
    { key: 'retired', label: 'Retired', value: String(counts.retired) },
    { key: 'founded', label: 'Founded', value: String(counts.founded) },
    { key: 'experiments', label: 'Experiments', value: String(counts.experiments), note: running ? `${running} running` : '' },
  ];
}
// What changed, newest first, in plain sentences: desks bred, founded, promoted, moved back and
// retired; the lab's experiments and verdicts; a real-money sleeve resized; a playbook rewritten.
export function loopChanges(events, checkpoint) {
  const list = (Array.isArray(events) ? events : []).filter(event => event && typeof event === 'object' && typeof event.kind === 'string');
  const live = new Map(orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object').map(desk => [show(desk.id), isLive(desk)]));
  const experiments = new Map([
    ...(Array.isArray(checkpoint?.lab?.experiments) ? checkpoint.lab.experiments : []).map(item => [show(item?.experiment_id), item]),
    ...list.filter(event => event.kind === 'lab.experiment').map(event => [show(event.payload?.experiment_id), event.payload]),
  ]);
  const items = [];
  const add = (event, kind, desk, text, detail = '') => items.push({ id: show(event.id), at: show(event.at), kind, desk, name: desk ? floorName(desk) : '', text, detail: truncate(detail, 220).text });
  for (const event of list) {
    const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const desk = show(p.desk_id);
    if (event.kind === 'evolution.spawned') {
      const mutation = p.mutation && typeof p.mutation === 'object' ? p.mutation : {};
      add(event, 'bred', desk, `Bred ${floorName(desk)}${p.parent_id ? ` from ${floorName(show(p.parent_id))}` : ''}`,
        typeof p.mutation === 'string' ? p.mutation : join(profileName(mutation.model_profile), mutation.reasoning_effort ? `effort ${show(mutation.reasoning_effort)}` : '', show(mutation.persona_trait)));
    } else if (event.kind === 'evolution.founded') {
      add(event, 'founded', desk, `Founded ${show(p.name) || floorName(desk)}, a new ${humanize(show(p.family)) || ''} family`.replace('  ', ' '), show(p.universe));
    } else if (event.kind === 'evolution.promoted') {
      if (isDemotion(p)) add(event, 'demoted', desk, `Moved ${floorName(desk)} back to a shadow book`, reasonText(p.reason));
      else add(event, 'promoted', desk, `Promoted ${floorName(desk)} to real money`, reasonText(p.reason));
    } else if (event.kind === 'evolution.retired') {
      add(event, 'retired', desk, `Retired ${floorName(desk)}`, reasonText(p.reason));
    } else if (event.kind === 'lab.experiment') {
      const variant = show(p.variant_desk_id);
      add(event, 'lab', variant, `The lab ${show(p.status) === 'running' || !show(p.status) ? 'started testing' : show(p.status)} ${variant ? floorName(variant) : `the ${humanize(show(p.family))} family`}`,
        join(show(p.hypothesis), changeSummary(p.change)));
    } else if (event.kind === 'lab.verdict') {
      const experiment = experiments.get(show(p.experiment_id));
      const variant = show(experiment?.variant_desk_id);
      add(event, 'lab', variant, `The lab ${show(p.status) || 'judged'} ${experiment?.hypothesis ? `“${truncate(experiment.hypothesis, 80).text}”` : 'an experiment'}`, show(p.reason));
    } else if (event.kind === 'desk.playbook_updated') {
      const reason = show(p.reason);
      const who = streamDeskOf(event.stream);
      if (!who || /^bred from /.test(reason)) continue;  // a child's first playbook is its birth, already a line
      add(event, 'playbook', who, `${floorName(who)} rewrote its playbook`, reason);
    }
  }
  // A real-money sleeve resized: compare each allocation with the one before it.
  const rounds = list.filter(event => event.kind === 'committee.allocation' && event.payload?.allocations && typeof event.payload.allocations === 'object')
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  for (let index = 1; index < rounds.length; index += 1) {
    const [before, after] = [rounds[index - 1].payload, rounds[index].payload];
    const shadow = after.shadow && typeof after.shadow === 'object' ? after.shadow : null;
    for (const [desk, value] of Object.entries(after.allocations)) {
      const isReal = shadow ? shadow[desk] !== true : live.get(desk) === true;
      const now = looseAmount(show(value));
      const was = looseAmount(show(before.allocations[desk]));
      if (!isReal || !numeric(now) || !numeric(was) || scaled(now) === scaled(was)) continue;
      add(rounds[index], 'capital', desk, `Meriwether moved ${floorName(desk)} ${money(was, 0)} → ${money(now, 0)}`, reasonText(after.reasons?.[desk]));
    }
  }
  const seen = new Set();
  return items.filter(item => item.id && !seen.has(`${item.id}|${item.desk}`) && seen.add(`${item.id}|${item.desk}`))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}
// The real-money sleeves as they stand, with Meriwether's latest reason for each.
export function liveSleeves(checkpoint, events = []) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const allocations = checkpoint?.committee?.allocations && typeof checkpoint.committee.allocations === 'object' ? checkpoint.committee.allocations : {};
  const latest = (Array.isArray(events) ? events : []).filter(event => event?.kind === 'committee.allocation' && event.payload?.reasons && typeof event.payload.reasons === 'object')
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
  const reasons = latest ? latest.payload.reasons : {};
  const rows = desks.filter(isLive).map(desk => {
    const id = show(desk.id);
    const usd = looseAmount(show(allocations[id] ?? desk.capital_usd));
    const pnl = deskPnl(desk);
    return {
      id, name: raceName(desk), usd: numeric(usd) ? Number(usd) : 0, usdText: numeric(usd) ? money(usd, 2) : '—',
      pnlText: pnl === null ? '—' : signedMoney(pnl.toFixed(2), 2), tone: pnl === null ? '' : signOf(pnl.toFixed(2)), reason: reasonText(reasons[id]),
    };
  }).sort((left, right) => right.usd - left.usd);
  const total = rows.reduce((sum, row) => sum + row.usd, 0);
  return { rows, total, totalText: money(total.toFixed(2), 2), shadow: desks.length - rows.length };
}

function loopScheduleInto(box) {
  const nodes = [element('span', 'Nightly', 'loop-next-label')];
  for (const job of loopSchedule()) {
    const item = element('span', null, job.next ? 'loop-job loop-job-next' : 'loop-job');
    if (job.next) item.append(pulse('pulse pulse-inline'));
    item.append(element('b', job.key), element('span', ` ${job.time}`));
    if (job.until) item.append(element('i', ` ${job.until}`));
    nodes.push(item);
  }
  nodes.push(element('span', 'ET', 'loop-next-zone'));
  box.replaceChildren(...nodes);
}
// Results by generation: the floor's grid, larger, with each cell's P&L and decisions a hover or a
// tap away. A tap selects; a second tap on the same cell opens the desk.
function betterPanel(checkpoint, state) {
  const grid = generationGrid(checkpoint);
  if (!grid.rows.length) return [element('p', 'The families appear with the first checkpoint.', 'empty-state')];
  const cells = grid.rows.flatMap(row => row.cells.filter(Boolean));
  const best = cells.filter(cell => !cell.live && cell.value !== null).sort((left, right) => right.value - left.value)[0] || cells[0];
  const readout = element('p', null, 'ladder-readout');
  readout.setAttribute('aria-live', 'polite');
  const read = (cell, lead = '') => {
    if (!cell) return;
    const words = element('span', join(`${lead}${cell.name}`, cell.live ? 'real money' : 'practice', cell.text, cell.pnlText, Number.isSafeInteger(cell.decisions) ? plural(cell.decisions, 'decision') : ''));
    readout.replaceChildren(words, link('open ↗', deskHref(cell.id), 'ladder-open'));
  };
  const table = element('table', null, 'ladder ladder-loop');
  const head = element('thead');
  const headLine = element('tr');
  headLine.append(element('th', 'Family', 'ladder-family'));
  for (const generation of grid.generations) headLine.append(element('th', roman(generation), 'ladder-gen'));
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
        anchor.setAttribute('aria-label', join(cell.name, cell.live ? 'real money' : 'practice', cell.text, cell.pnlText));
        if (cell.live) anchor.append(pulse('pulse pulse-inline'));
        anchor.append(element('span', cell.text, 'ladder-value'));
        if (cell.leader) anchor.append(element('span', '★', 'ladder-star'));
        anchor.append(element('span', cell.pnlText, `ladder-pnl ${cell.pnlTone}`.trim()));
        anchor.addEventListener('pointerdown', down => { state.pointer = down.pointerType || 'mouse'; });
        anchor.addEventListener('pointerenter', enter => { if (enter.pointerType !== 'touch') read(cell); });
        anchor.addEventListener('focus', () => read(cell));
        anchor.addEventListener('click', click => {
          if (state.pointer === 'touch' && state.selected !== cell.id) { click.preventDefault(); state.selected = cell.id; read(cell); }
        });
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
  read(best, best && !best.live ? 'best child: ' : '');
  const nodes = [];
  if (grid.reading) nodes.push(element('p', grid.reading, 'learning-reading'));
  nodes.push(table, readout);
  const calibration = checkpoint?.lab?.calibration;
  nodes.push(element('p', join('● real money · ★ best in its family · return on capital',
    calibration && Number.isSafeInteger(calibration.n) && calibration.n > 0 && numeric(show(calibration.brier)) ? `${calibration.n} forecasts scored, Brier ${Number(calibration.brier).toFixed(3)} (0 is perfect, 0.25 a coin flip)` : ''), 'ladder-legend'));
  return nodes;
}
function gateMeter(gate) {
  const meter = element('span', null, 'gate-meter');
  meter.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < gate.total; index += 1) meter.append(element('i', null, index < gate.met ? 'gate-on' : ''));
  return meter;
}
function loopRacePanel(checkpoint, events) {
  const rows = raceRows(checkpoint, events);
  if (!rows.length) return [element('p', 'The families appear with the first checkpoint.', 'empty-state')];
  const nodes = [];
  const candidates = rows.map(row => row.closest).filter(Boolean)
    .sort((left, right) => (right.gate.met - left.gate.met) || ((right.score ?? -Infinity) - (left.score ?? -Infinity)));
  if (candidates.length) nodes.push(element('p', `Closest to promotion: ${gateLine(candidates[0])}.`, 'learning-reading'));
  for (const row of rows) {
    const line = element('div', null, 'race-row');
    const family = element('div', null, 'race-family');
    family.append(element('b', row.name), element('span', row.word, 'race-word'));
    if (row.founded) family.append(tagNode('founded by the floor', 'founded'));
    const chips = element('div', null, 'race-chips');
    const members = [...row.members].sort((left, right) => (Number(right.live) - Number(left.live)) || (left.generation - right.generation));
    for (const member of members) {
      const chip = link('', deskHref(member.id), `race-chip${member.live ? ' race-live' : ''}${member.leader ? ' race-leader' : ''}`);
      if (member.live) chip.append(pulse('pulse pulse-inline'));
      chip.append(element('b', member.name), element('span', member.scoreText, member.tone || 'race-flat'));
      if (member.leader) chip.append(element('i', '★', 'race-star'));
      if (member.demoted) chip.append(tagNode('demoted', 'demoted'));
      if (member.inSession) chip.append(element('i', 'thinking', 'race-thinking'));
      if (!member.live && member.gate) chip.append(gateMeter(member.gate));
      chip.setAttribute('title', join(member.live ? 'real money' : 'practice, scored on real prices', gateLine(member), ...member.badges.map(badge => badge.text)));
      chips.append(chip);
    }
    line.append(family, chips);
    nodes.push(line);
  }
  nodes.push(element('p', '● real money · ★ best return in the family · bars: gate checks met', 'ladder-legend'));
  const evidence = rows.flatMap(row => row.members).filter(member => member.gate)
    .sort((left, right) => (Number(left.live) - Number(right.live)) || (right.gate.met - left.gate.met));
  if (evidence.length) {
    const list = element('ul', null, 'gate-list');
    for (const member of evidence) {
      const item = element('li');
      item.append(link(member.name, deskHref(member.id), 'agent-name'), element('span', `gate ${member.gate.name} · ${member.gate.met}/${member.gate.total}`, 'gate-score'),
        element('span', member.gate.passed ? 'passed' : member.gate.missing.join(', '), 'gate-missing'));
      list.append(item);
    }
    const as = orderDesks(checkpoint?.desks).map(desk => show(desk?.gate?.evidence?.as_of)).find(Boolean);
    nodes.push(details(`gate evidence${as ? ` · as of ${date(as, 'time')}` : ''}`, list, 'more-panel'));
  }
  if (rows.some(row => row.members.some(member => member.badges.length))) {
    const list = element('div', null, 'race-diffs');
    for (const member of rows.flatMap(row => row.members).filter(item => item.badges.length)) {
      const item = element('div', null, 'race-diff');
      item.append(element('b', member.name), badgeRow(member.badges));
      list.append(item);
    }
    nodes.push(details('how the children differ', list, 'more-panel'));
  }
  return nodes;
}
const CHANGE_LIMIT = 15;
const CHANGE_WORDS = { bred: 'bred', founded: 'founded', promoted: 'promoted', demoted: 'demoted', retired: 'retired', lab: 'lab', capital: 'capital', playbook: 'playbook' };
function changesInto(list, state) {
  const items = loopChanges(state.events, state.checkpoint);
  const shown = items.slice(0, state.more ? items.length : CHANGE_LIMIT);
  const nodes = shown.map(item => {
    const line = element('li', null, `change change-${item.kind}`);
    const text = element('p', null, 'change-text');
    text.append(item.desk ? link(item.text, deskHref(item.desk), 'change-what') : element('span', item.text, 'change-what'));
    if (item.detail) text.append(element('span', item.detail, 'change-why'));
    line.append(whenNode(item.at), element('span', CHANGE_WORDS[item.kind] || item.kind, `feed-kind change-kind kind-${item.kind}`), text);
    return line;
  });
  list.replaceChildren(...(nodes.length ? nodes : [element('li', 'Nothing has changed since the log was trimmed. The next committee, evolution and lab runs write here.', 'empty-state')]));
  if (items.length > CHANGE_LIMIT) {
    const item = element('li', null, 'change-more');
    item.append(moreChip(state.more, items.length - CHANGE_LIMIT, () => { state.more = !state.more; changesInto(list, state); }));
    list.append(item);
  }
}
function capitalPanel(checkpoint, events) {
  const sleeves = liveSleeves(checkpoint, events);
  const nodes = [];
  if (sleeves.rows.length) {
    const table = element('table', null, 'rows rows-capital');
    table.append(headRow([['Partner', 'col-agent'], ['Sleeve', 'col-num'], ['P&L', 'col-num'], ['Why', 'col-why']]));
    const body = element('tbody');
    for (const row of sleeves.rows) {
      const line = element('tr', null, 'row-real');
      line.append(agentCell(row.id, row.name, null, [pulse('pulse pulse-inline')]), element('td', row.usdText, 'col-num col-sleeve'),
        element('td', row.pnlText, `col-num col-pnl ${row.tone}`.trim()), element('td', row.reason || '—', 'col-why col-reason'));
      body.append(line);
    }
    table.append(body);
    nodes.push(table);
  } else nodes.push(element('p', 'No partner trades real money right now.', 'empty-state'));
  nodes.push(element('p', join(sleeves.rows.length ? `${sleeves.totalText} of real money in ${plural(sleeves.rows.length, 'sleeve')}` : '',
    sleeves.shadow ? `${plural(sleeves.shadow, 'shadow partner')} ${sleeves.shadow === 1 ? 'scores' : 'score'} against notional books` : ''), 'quiet-line'));
  return nodes;
}
function memoPanel(event) {
  const block = section('Meriwether’s memo', whenNode(event.at));
  const parts = leadParagraph(event.payload?.text);
  block.append(element('p', parts.lead, 'memo-lead'));
  if (parts.rest) block.append(details('read the memo', element('p', parts.rest, 'memo-rest'), 'more-panel'));
  return block;
}
function familyCalibrationPanel(rows) {
  const block = section('Calibration', 'by family');
  const list = element('ul', null, 'gate-list');
  for (const row of rows) {
    const item = element('li');
    item.append(element('b', `${humanize(row.family)} family`), element('span', `${plural(Number(row.n) || 0, 'forecast')}`, 'gate-score'), element('span', `Brier ${show(row.brier)}`, 'gate-missing'));
    list.append(item);
  }
  block.append(list);
  return block;
}

async function startCommittee(root) {
  const find = name => root.querySelector(`#${name}`);
  const box = {
    numbers: find('loop-numbers'), next: find('loop-next'), better: find('loop-better'), race: find('loop-race'),
    status: find('loop-status'), changes: find('loop-changes'), capital: find('loop-capital'), more: find('loop-more'),
  };
  const state = { checkpoint: null, events: [], mode: 'loading', more: false, selected: null, pointer: 'mouse' };
  const ready = node => node && node.setAttribute('aria-busy', 'false');
  const drawn = (node, children) => { if (!node) return; node.replaceChildren(...children); ready(node); };
  const drawStatus = () => {
    if (!box.status) return;
    box.status.className = `live-status live-${state.mode}`;
    box.status.replaceChildren(pulse(), element('span', state.mode === 'live' ? 'live' : state.mode === 'polling' ? 'live · polling' : 'connecting'));
  };
  const drawChecked = () => {
    if (!state.checkpoint) return;
    drawn(box.numbers, loopStatus(state.events, state.checkpoint).map(numberCell));
    drawn(box.better, betterPanel(state.checkpoint, state));
    drawn(box.race, loopRacePanel(state.checkpoint, state.events));
    drawn(box.capital, capitalPanel(state.checkpoint, state.events));
  };
  const drawChanges = () => { if (box.changes) { changesInto(box.changes, state); ready(box.changes); } };
  const drawMore = () => {
    if (!box.more) return;
    const memo = state.events.filter(event => event.kind === 'committee.memo' && show(event.payload?.text))
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
    const families = familyCalibrations(state.events);
    drawn(box.more, [memo ? memoPanel(memo) : null, families.length ? familyCalibrationPanel(families) : null].filter(Boolean));
  };
  const keep = events => {
    const byId = new Map([...state.events, ...events].map(event => [event.id, event]));
    state.events = [...byId.values()];
  };
  if (box.next) loopScheduleInto(box.next);
  async function refresh() {
    try {
      state.checkpoint = await loadCheckpoint();
      drawChecked();
    } catch {
      if (state.checkpoint) return;
      const notice = element('p', 'The floor checkpoint is unavailable. ', 'unavailable');
      notice.append(link('Read the runtime on GitHub.', REPOSITORY));
      drawn(box.numbers, [notice]);
      for (const node of [box.better, box.race, box.capital]) drawn(node, []);
    }
  }
  await refresh();
  const batches = await Promise.all([
    { stream: 'evolution', limit: MAX_EVENT_LIMIT }, { stream: 'lab', limit: MAX_EVENT_LIMIT }, { kind: 'committee.allocation', limit: 60 },
    { kind: 'committee.memo', limit: 5 }, { kind: 'desk.playbook_updated', limit: 60 },
  ].map(query => loadEvents(query).catch(() => ({ events: [] }))));
  keep(batches.flatMap(batch => batch.events));
  drawChecked();
  drawChanges();
  drawMore();
  drawStatus();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
  setInterval(() => { if (box.next && document.visibilityState === 'visible') loopScheduleInto(box.next); }, 30000);
  const feed = startFeed({
    streams: ['committee', 'evolution', 'lab'],
    onStatus: mode => { state.mode = mode; drawStatus(); },
    onEvents: events => {
      const wanted = events.filter(event => ['evolution', 'lab'].includes(event.stream) || ['committee.allocation', 'committee.memo'].includes(event.kind));
      if (!wanted.length) return;
      keep(wanted);
      drawChanges();
      drawMore();
      if (state.checkpoint) drawn(box.numbers, loopStatus(state.events, state.checkpoint).map(numberCell));
    },
  });
  feed.remember(state.events);
  feed.prime(state.events.reduce((most, event) => Math.max(most, Number(event.seq) || 0), 0));
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
