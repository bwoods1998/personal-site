import {
  EVENT_KINDS, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT, deskId, validCheckpoint, validDesk, validPublicEvent, socketMatches,
} from './schema.js';

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
const MAX_CARDS = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 100000000n;
const REPOSITORY = 'https://github.com/bwoods1998/portfolio-agent';
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
  thoughts: ['desk.session_started', 'desk.thought', 'desk.tool_call', 'desk.tool_result', 'desk.memo', 'desk.postmortem', 'desk.session_ended'],
  trades: ['desk.intent', 'broker.order', 'broker.fill', 'broker.reconciled', 'ledger.mark', 'desk.outcome'],
  risk: ['risk.decision', 'risk.review', 'risk.breaker', 'ops.alert', 'ops.budget'],
  committee: ['committee.allocation', 'committee.memo', 'committee.gate'],
  evolution: ['evolution.spawned', 'evolution.retired', 'evolution.promoted', 'desk.playbook_updated', 'lab.hypothesis', 'lab.result'],
};
const GROUP_OF_KIND = Object.fromEntries(Object.entries(FILTER_GROUPS).flatMap(([group, kinds]) => kinds.map(kind => [kind, group])));
// A glyph per tone, so a line reads at a glance without another typeface or an image request.
const TONE_ICONS = {
  thought: '~', tool: '>', memo: '¶', order: '→', fill: '●', mark: '=', risk: '!',
  committee: '§', evolution: '*', lab: '?', ops: '·', session: '○', playbook: '¶',
};

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
  if (!known) return { id, surname: name || id, first: '', role: '', via: '', mandate: '', variant: '' };
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
  'desk.session_started': p => join('Session open', show(p.trigger)),
  'desk.thought': p => show(p.text),
  'desk.tool_call': p => join(show(p.tool), summarizeArguments(p.arguments)),
  'desk.tool_result': p => join(show(p.tool), show(p.summary)),
  'desk.memo': p => join(show(p.title), show(p.text)),
  'desk.intent': p => join(`${show(p.side)} ${quantity(p.quantity)} ${show(p.instrument)}`.trim(), show(p.order_type), p.limit_price ? `limit ${money(show(p.limit_price), 4)}` : '', show(p.rationale)),
  'desk.playbook_updated': p => join(p.version ? `v${show(p.version)}` : '', show(p.reason)),
  'desk.postmortem': p => join(show(p.period), show(p.text)),
  // outcome · <market> · result · P&L
  'desk.outcome': p => join('outcome', show(p.market_id || p.instrument), p.result ? `resolved ${show(p.result)}` : '', p.pnl ? `P&L ${money(show(p.pnl))}` : '', p.held_for_hours === undefined ? '' : `${show(p.held_for_hours)}h held`),
  'desk.session_ended': p => join(show(p.reason), p.requests === undefined ? '' : `${show(p.requests)} requests`, p.cost_usd ? money(show(p.cost_usd), 4) : ''),
  'risk.decision': p => join(p.approved === true ? 'Approved' : p.approved === false ? 'Blocked' : '', show(p.desk_id), Array.isArray(p.reasons) ? p.reasons.map(show).filter(Boolean).join('; ') : ''),
  // review · <desk> · approve/block · reason
  'risk.review': p => join('review', partnerName(show(p.desk_id)), show(p.verdict), show(p.reason)),
  'risk.breaker': p => join(show(p.scope), show(p.rule), show(p.action), show(p.detail)),
  'broker.order': p => join(show(p.status), p.filled_quantity === undefined ? '' : `filled ${quantity(p.filled_quantity)}`, p.average_price ? `avg ${money(show(p.average_price), 4)}` : ''),
  'broker.fill': p => join(`${show(p.side)} ${quantity(p.quantity)} ${show(p.instrument)}`.trim(), p.price ? `@ ${money(show(p.price), 4)}` : '', p.fee ? `fee ${money(show(p.fee), 4)}` : ''),
  'broker.reconciled': p => join(show(p.venue), p.matches === undefined ? '' : `${show(p.matches)} matched`, Array.isArray(p.mismatches) ? `${p.mismatches.length} mismatched` : ''),
  'ledger.mark': p => join(p.equity ? `Equity ${money(show(p.equity))}` : '', p.cash ? `Cash ${money(show(p.cash))}` : '', p.daily_pnl ? `Day ${money(show(p.daily_pnl))}` : '', Array.isArray(p.positions) ? `${p.positions.length} positions` : ''),
  'committee.allocation': p => {
    const allocations = p.allocations && typeof p.allocations === 'object' ? Object.entries(p.allocations) : [];
    return join(`${allocations.length} desks funded`, allocations.slice(0, 3).map(([id, usd]) => `${partnerName(id)} ${money(show(usd), 0)}`).join(', '));
  },
  'committee.memo': p => join(show(p.period), show(p.text)),
  'committee.gate': p => join(show(p.desk_id), show(p.gate), p.passed === true ? 'passed' : p.passed === false ? 'not met' : ''),
  'evolution.spawned': p => join(show(p.desk_id), show(p.family), p.generation === undefined ? '' : `generation ${show(p.generation)}`, p.parent_id ? `from ${show(p.parent_id)}` : '', show(p.mutation)),
  'evolution.retired': p => join(show(p.desk_id), show(p.reason)),
  'evolution.promoted': p => join(show(p.desk_id), show(p.from) && show(p.to) ? `${show(p.from)} → ${show(p.to)}` : ''),
  'lab.hypothesis': p => join(show(p.text), show(p.test_plan)),
  'lab.result': p => join(show(p.verdict), show(p.hypothesis_id)),
  'ops.alert': p => join(show(p.level), show(p.text)),
  'ops.budget': p => join(show(p.scope), p.spent_usd ? `${money(show(p.spent_usd), 2)} of ${money(show(p.cap_usd), 2)}` : ''),
};
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

function markPoints(events) {
  return (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === 'ledger.mark')
    .map(event => ({ at: Date.parse(event.at), equity: Number(event.payload?.equity) }))
    .filter(point => Number.isFinite(point.at) && Number.isFinite(point.equity))
    .sort((left, right) => left.at - right.at);
}
// Equity from the desk's own marks. No interpolation, no generated points.
export function markSeries(events) {
  const points = markPoints(events);
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
export function sparkline(events, { width = 148, height = 34, limit = SPARK_POINTS } = {}) {
  const points = markPoints(events).slice(-limit);
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
    .filter(event => !state || matchesFilters(event, state.active))
    .sort((left, right) => right.seq - left.seq)
    .slice(0, TAPE_LIMIT);
  const entries = selected.map(event => tapeEntry(event, state));
  target.replaceChildren(...(entries.length ? entries : [element('p', events.length ? 'Nothing on the tape under these filters.' : 'No events published yet.', 'empty-state')]));
  target.setAttribute('aria-busy', 'false');
}
function filterChips(state, onChange) {
  const chips = element('div', null, 'chips');
  for (const filter of TAPE_FILTERS) {
    const on = state.active.has(filter.key);
    const chip = element('button', filter.label, on ? 'chip chip-on' : 'chip');
    chip.type = 'button';
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    chip.addEventListener('click', () => {
      if (state.active.has(filter.key)) state.active.delete(filter.key);
      else state.active.add(filter.key);
      onChange();
    });
    chips.append(chip);
  }
  return chips;
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

function partnerCard(desk, record) {
  const partner = partnerOf(desk);
  const card = link('', deskHref(desk.id), 'partner');
  const head = element('span', null, 'partner-head');
  head.append(element('span', partner.surname, 'partner-surname'));
  if (partner.variant) head.append(element('span', partner.variant, 'partner-variant'));
  head.append(element('span', desk.mode, `badge badge-${desk.mode}`));
  card.append(head);
  card.append(element('span', partnerRole(partner) || desk.family, 'partner-role'));
  const numbers = element('span', null, 'partner-numbers');
  for (const [value, label, tone] of [
    [money(desk.equity, 0), 'equity', ''],
    [percent(desk.return_pct), 'since inception', signOf(desk.return_pct)],
  ]) {
    const cell = element('span');
    cell.append(element('b', value, tone), element('i', label));
    numbers.append(cell);
  }
  card.append(numbers);
  card.append(sparkFigure(record?.marks || []));
  const now = record?.now || '';
  const line = element('span', null, 'partner-now');
  line.append(element('i', 'now'), element('span', now || 'quiet — nothing published since the last session'));
  card.append(line);
  return card;
}
function partnerGrid(desks, records) {
  const grid = element('div', null, 'partners');
  for (const desk of orderDesks(desks).slice(0, MAX_CARDS)) grid.append(partnerCard(desk, records.get(desk.id)));
  return grid;
}
function headlineNumbers(checkpoint) {
  const floor = checkpoint.floor;
  const numbers = element('dl', null, 'headline');
  numbers.append(
    metric('Floor equity', money(floor.equity, 0)),
    metric('Today', signedMoney(floor.daily_pnl, 0), signOf(floor.daily_pnl)),
    metric('Inference today', `${money(checkpoint.budget.spent_today_usd, 2)} / ${money(checkpoint.budget.cap_usd, 0)}`, '', 'spent of the daily cap'),
  );
  return numbers;
}

async function startFloor(root) {
  const status = root.querySelector('#floor-status');
  const numbers = root.querySelector('#floor-numbers');
  const partners = root.querySelector('#floor-partners');
  const filters = root.querySelector('#tape-filters');
  const tape = root.querySelector('#floor-tape');
  const state = {
    checkpoint: null, events: [], mode: 'loading', records: new Map(),
    active: new Set(TAPE_FILTERS.map(filter => filter.key)), expanded: new Set(),
    redraw: () => renderTape(tape, state.events, state),
  };
  const drawChips = () => filters.replaceChildren(filterChips(state, () => { drawChips(); state.redraw(); }));
  statusLine(status, state.mode, null);
  const drawPartners = () => {
    if (!state.checkpoint) return;
    partners.replaceChildren(state.checkpoint.desks.length
      ? partnerGrid(state.checkpoint.desks, state.records)
      : element('p', 'The partners appear with the first published checkpoint.', 'empty-state'));
    partners.setAttribute('aria-busy', 'false');
  };
  async function refresh() {
    try {
      state.checkpoint = await loadCheckpoint();
      numbers.replaceChildren(headlineNumbers(state.checkpoint));
      numbers.setAttribute('aria-busy', 'false');
      drawPartners();
      statusLine(status, state.mode, state.checkpoint.published_at);
    } catch {
      if (state.checkpoint) return;
      const notice = element('p', 'The floor checkpoint is unavailable. ', 'unavailable');
      notice.append(link('Read the runtime on GitHub.', REPOSITORY));
      numbers.replaceChildren(notice);
      numbers.setAttribute('aria-busy', 'false');
      partners.setAttribute('aria-busy', 'false');
    }
  }
  await refresh();
  // Each card carries its own equity line and its own latest thought.
  if (state.checkpoint) {
    await Promise.all(orderDesks(state.checkpoint.desks).slice(0, MAX_CARDS).map(async desk => {
      const [marks, recent] = await Promise.all([
        loadEvents({ stream: `ledger:${desk.id}`, kind: 'ledger.mark', limit: SPARK_POINTS }).catch(() => ({ events: [] })),
        loadEvents({ stream: `desk:${desk.id}`, limit: 10 }).catch(() => ({ events: [] })),
      ]);
      state.records.set(desk.id, { marks: marks.events, now: nowLine(recent.events) });
    }));
    drawPartners();
  }
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  let tapeReady = true;
  try {
    const history = await loadEvents({ limit: DEFAULT_EVENT_LIMIT });
    state.events = history.events;
  } catch {
    tapeReady = false;
    tape.replaceChildren(element('p', 'The tape is unavailable. It resumes when the floor publishes again.', 'unavailable'));
    tape.setAttribute('aria-busy', 'false');
  }
  drawChips();
  if (tapeReady) state.redraw();
  const feed = startFeed({
    streams: ['all'],
    onStatus: mode => { state.mode = mode; statusLine(status, mode, state.checkpoint?.published_at || null); },
    onEvents: events => {
      state.events = [...events, ...state.events].slice(0, TAPE_LIMIT * 2);
      let cards = false;
      for (const event of events) {
        const id = typeof event.stream === 'string' && event.stream.includes(':') ? event.stream.slice(event.stream.indexOf(':') + 1) : null;
        const record = id ? state.records.get(id) : null;
        if (!record) continue;
        if (event.kind === 'ledger.mark') { record.marks = [...record.marks, event].slice(-CARD_MARKS); cards = true; }
        if (event.kind === 'desk.thought' || event.kind === 'desk.memo') { record.now = nowLine([event]); cards = true; }
      }
      if (cards) drawPartners();
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

async function startDesk(root) {
  const header = root.querySelector('#desk-header');
  const detail = root.querySelector('#desk-detail');
  const tape = root.querySelector('#desk-tape');
  const status = root.querySelector('#desk-status');
  const id = new URLSearchParams(window.location.search).get('id');
  if (!deskId(id)) {
    header.replaceChildren(element('h1', 'Partner not found'), element('p', 'Open a partner from the floor.', 'note'));
    detail.replaceChildren();
    tape.replaceChildren();
    return null;
  }
  statusLine(status, 'loading', null);
  let desk = null;
  try { desk = await loadDesk(id); } catch { /* The manifest facts stay blank until the next checkpoint. */ }
  const partner = partnerOf(desk || id);
  setTitle(`${partner.surname} · LTCM`);
  header.replaceChildren(element('h1', partnerName(partner.id)));
  header.append(element('p', partnerRole(partner) || (desk ? desk.family : id), 'partner-role'));
  if (desk) {
    if (partner.mandate) header.append(details('Mandate', element('p', partner.mandate, 'mandate')));
    header.append(facts([
      ['Desk', desk.id], ['Family', desk.family], ['Generation', String(desk.generation)],
      ['Parent', desk.parent_id || 'Founding partner'], ['Mode', desk.mode], ['Venues', desk.venues.join(', ') || 'None'],
      ['Capital', money(desk.capital_usd, 0)], ['Equity', money(desk.equity, 0)], ['Cash', money(desk.cash, 0)],
      ['Today', signedMoney(desk.daily_pnl, 2)], ['Return', percent(desk.return_pct)], ['Max drawdown', percent(desk.max_drawdown_pct).replace('+', '−')],
      ['Days live', String(desk.days_live)], ['Orders', String(desk.orders)], ['Inference cost', money(desk.cost_usd, 2)],
      ['Status', desk.status], ['Gate', desk.gate ? `${desk.gate.name} · ${desk.gate.passed ? 'passed' : 'not met'}` : 'None recorded'],
      ['Updated', date(desk.updated_at)],
    ]));
  } else header.append(element('p', 'This partner has no published checkpoint row yet.', 'note'));
  const [deskEvents, marks, fills, evolution] = await Promise.all([
    loadEvents({ stream: `desk:${id}`, limit: 60 }).catch(() => ({ events: [] })),
    loadEvents({ stream: `ledger:${id}`, kind: 'ledger.mark', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
    loadEvents({ kind: 'broker.fill', limit: 60 }).catch(() => ({ events: [] })),
    loadEvents({ stream: 'evolution', limit: 100 }).catch(() => ({ events: [] })),
  ]);
  const performance = section('Equity', 'This partner’s own marks');
  performance.append(equityChart(marks.events));
  const playbook = section('Playbook', 'Rewritten by the desk itself');
  const rewrite = latestPlaybook(deskEvents.events);
  if (rewrite) {
    const meta = element('p', null, 'playbook-meta');
    meta.append(element('span', rewrite.version ? `v${rewrite.version} · ` : ''));
    meta.append(timeNode(rewrite.at));
    playbook.append(meta);
    if (rewrite.reason) playbook.append(element('p', rewrite.reason, 'playbook-reason'));
    if (rewrite.diff) playbook.append(diffBlock(rewrite.diff));
  } else playbook.append(element('p', 'No playbook rewrite published yet.', 'empty-state'));
  const book = section('Book', 'Latest published mark');
  const rows = bookRows(marks.events);
  book.append(rows.length
    ? table(['Instrument', 'Quantity', 'Price', 'Value'], rows.map(row => [row.instrument, row.quantity, money(row.price, 4), money(row.value, 2)]))
    : element('p', 'No positions in the latest mark.', 'empty-state'));
  const blotter = section('Blotter', 'Fills publish after execution');
  const fillsForDesk = fillRows(fills.events, id);
  blotter.append(fillsForDesk.length
    ? table(['Time', 'Venue', 'Instrument', 'Side', 'Quantity', 'Price', 'Fee'], fillsForDesk.slice(0, 30).map(row => [date(row.at), row.venue, row.instrument, row.side, row.quantity, money(row.price, 4), money(row.fee, 4)]))
    : element('p', 'No fills published yet.', 'empty-state'));
  const gate = section('Gate', 'Paper to live money, on evidence');
  if (desk?.gate) {
    gate.append(element('p', `${desk.gate.name} · ${desk.gate.passed ? 'passed' : 'not met'}`, desk.gate.passed ? 'gate-pass' : 'gate-fail'));
    gate.append(facts(Object.entries(desk.gate.evidence).slice(0, 12).map(([key, value]) => [key, show(value) || '…'])));
  } else gate.append(element('p', 'No gate recorded for this partner.', 'empty-state'));
  const family = section('Lineage', 'Evolution record');
  const history = lineage(evolution.events, id);
  if (history.length) {
    const list = element('ul', null, 'lineage');
    for (const entry of history) {
      const item = element('li', entry.text);
      const meta = element('span', `${entry.label} · `);
      meta.append(timeNode(entry.at));
      item.append(meta);
      list.append(item);
    }
    family.append(list);
  } else family.append(element('p', desk?.parent_id ? `Spawned from ${desk.parent_id}.` : 'No evolution events for this partner.', 'empty-state'));
  detail.replaceChildren(performance, playbook, book, blotter, gate, family);
  detail.setAttribute('aria-busy', 'false');
  const state = {
    events: deskEvents.events, expanded: new Set(), active: new Set(),
    redraw: () => renderTape(tape, state.events, state),
  };
  state.redraw();
  const feed = startFeed({
    streams: [`desk:${id}`, `ledger:${id}`],
    onStatus: mode => statusLine(status, mode, desk?.updated_at || null),
    onEvents: events => { state.events = [...events, ...state.events].slice(0, TAPE_LIMIT * 2); state.redraw(); },
  });
  feed.remember(state.events);
  feed.prime(state.events[0]?.seq || 0);
  return feed;
}

async function startCommittee(root) {
  const status = root.querySelector('#committee-status');
  const allocations = root.querySelector('#committee-allocations');
  const gates = root.querySelector('#committee-gates');
  const memos = root.querySelector('#committee-memos');
  const history = root.querySelector('#committee-evolution');
  statusLine(status, 'loading', null);
  let checkpoint = null;
  try { checkpoint = await loadCheckpoint(); } catch { /* Allocations wait for the first checkpoint. */ }
  if (checkpoint) statusLine(status, 'loading', checkpoint.published_at);
  const [committeeEvents, evolution] = await Promise.all([
    loadEvents({ stream: 'committee', limit: 100 }).catch(() => ({ events: [] })),
    loadEvents({ stream: 'evolution', limit: 100 }).catch(() => ({ events: [] })),
  ]);
  // Meriwether's latest memo leads the page; the numbers follow it.
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
  memos.replaceChildren(memoEvents.length ? memoList : element('p', 'No memo published yet.', 'empty-state'));
  memos.setAttribute('aria-busy', 'false');
  const series = allocationSeries(committeeEvents.events);
  const current = checkpoint ? Object.entries(checkpoint.committee.allocations) : [];
  const allocationBlock = element('div');
  if (current.length) {
    const list = element('div', null, 'allocation-current');
    for (const [id, usd] of current.sort((left, right) => (scaled(right[1]) > scaled(left[1]) ? 1 : -1))) {
      const row = element('div', null, 'allocation-row');
      const name = element('span');
      name.append(link(partnerName(id), deskHref(id)));
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
  if (!current.length && !series.rows.length) allocationBlock.append(element('p', 'Meriwether has not allocated capital yet.', 'empty-state'));
  if (checkpoint) allocationBlock.append(element('p', `Floor capital ${money(checkpoint.floor.capital_usd, 0)} · last memo ${checkpoint.committee.last_memo_at ? date(checkpoint.committee.last_memo_at) : 'none'}`, 'note'));
  allocations.replaceChildren(allocationBlock);
  allocations.setAttribute('aria-busy', 'false');
  const gateEvents = committeeEvents.events.filter(event => event.kind === 'committee.gate');
  gates.replaceChildren(gateEvents.length
    ? table(['Time', 'Partner', 'Gate', 'Result'], gateEvents.slice(0, 40).map(event => [
      date(event.at), partnerName(show(event.payload?.desk_id)) || '—', show(event.payload?.gate) || '—', event.payload?.passed ? 'passed' : 'not met',
    ]))
    : element('p', 'No gate decisions published yet.', 'empty-state'));
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
