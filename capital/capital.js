import {
  EVENT_KINDS, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT, deskId, validCheckpoint, validDesk, validPublicEvent, socketMatches,
} from './schema.js';

// The floor's own record, rendered from text nodes only. Prices are the floor's fills and
// marks; the page never contacts a quote vendor and never starts work on the desks.
const API = '/api/capital';
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 512 * 1024;
const MAX_SOCKET_MESSAGE = 64 * 1024;
const TAPE_LIMIT = 120;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 100000000n;
const REPOSITORY = 'https://github.com/bwoods1998/portfolio-agent';
const responseCache = new Map();
const STREAM_LABELS = { risk: 'Risk engine', committee: 'Helm', evolution: 'Evolution', lab: 'Lab', ops: 'Ops' };

export const LEADERBOARD_COLUMNS = [
  { key: 'name', label: 'Desk', type: 'text' },
  { key: 'mode', label: 'Mode', type: 'text' },
  { key: 'capital_usd', label: 'Capital', type: 'money' },
  { key: 'equity', label: 'Equity', type: 'money' },
  { key: 'return_pct', label: 'Return', type: 'percent' },
  { key: 'max_drawdown_pct', label: 'Drawdown', type: 'percent' },
  { key: 'days_live', label: 'Days live', type: 'count' },
  { key: 'orders', label: 'Orders', type: 'count' },
  { key: 'cost_usd', label: 'Cost', type: 'money' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'gate', label: 'Gate', type: 'gate' },
];

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
function metric(label, value, tone) {
  const row = element('div');
  row.append(element('dt', label));
  const result = element('dd', value);
  if (tone) result.className = tone;
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
export function streamLabel(stream) {
  if (typeof stream !== 'string') return '';
  if (!stream.includes(':')) return STREAM_LABELS[stream] || stream;
  const [family, id] = [stream.slice(0, stream.indexOf(':')), stream.slice(stream.indexOf(':') + 1)];
  return family === 'desk' ? id : `${id} ${family}`;
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
  'desk.session_ended': p => join(show(p.reason), p.requests === undefined ? '' : `${show(p.requests)} requests`, p.cost_usd ? money(show(p.cost_usd), 4) : ''),
  'risk.decision': p => join(p.approved === true ? 'Approved' : p.approved === false ? 'Blocked' : '', show(p.desk_id), Array.isArray(p.reasons) ? p.reasons.map(show).filter(Boolean).join('; ') : ''),
  'risk.breaker': p => join(show(p.scope), show(p.rule), show(p.action), show(p.detail)),
  'broker.order': p => join(show(p.status), p.filled_quantity === undefined ? '' : `filled ${quantity(p.filled_quantity)}`, p.average_price ? `avg ${money(show(p.average_price), 4)}` : ''),
  'broker.fill': p => join(`${show(p.side)} ${quantity(p.quantity)} ${show(p.instrument)}`.trim(), p.price ? `@ ${money(show(p.price), 4)}` : '', p.fee ? `fee ${money(show(p.fee), 4)}` : ''),
  'broker.reconciled': p => join(show(p.venue), p.matches === undefined ? '' : `${show(p.matches)} matched`, Array.isArray(p.mismatches) ? `${p.mismatches.length} mismatched` : ''),
  'ledger.mark': p => join(p.equity ? `Equity ${money(show(p.equity))}` : '', p.cash ? `Cash ${money(show(p.cash))}` : '', p.daily_pnl ? `Day ${money(show(p.daily_pnl))}` : '', Array.isArray(p.positions) ? `${p.positions.length} positions` : ''),
  'committee.allocation': p => {
    const allocations = p.allocations && typeof p.allocations === 'object' ? Object.entries(p.allocations) : [];
    return join(`${allocations.length} desks funded`, allocations.slice(0, 3).map(([id, usd]) => `${id} ${money(show(usd), 0)}`).join(', '));
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
  return { label: kind.label, tone: kind.tone, source: streamLabel(event?.stream), text: detail || fallbackDetail(payload), at: event?.at, stream: event?.stream };
}
export function sortDesks(desks, key, direction = 'desc') {
  const column = LEADERBOARD_COLUMNS.find(entry => entry.key === key) || LEADERBOARD_COLUMNS[0];
  const rank = desk => {
    if (column.type === 'money' || column.type === 'percent') return numeric(desk[column.key]) ? scaled(desk[column.key]) : -(2n ** 80n);
    if (column.type === 'count') return BigInt(Number.isSafeInteger(desk[column.key]) ? desk[column.key] : 0);
    if (column.type === 'gate') return BigInt(desk.gate === null || desk.gate === undefined ? 0 : desk.gate.passed ? 2 : 1);
    return String(desk[column.key] ?? '');
  };
  const order = direction === 'asc' ? 1 : -1;
  return [...desks].map((desk, index) => ({ desk, index })).sort((left, right) => {
    const a = rank(left.desk);
    const b = rank(right.desk);
    const compared = typeof a === 'string' ? a.localeCompare(b) : a === b ? 0 : a > b ? 1 : -1;
    return compared === 0 ? left.index - right.index : compared * order;
  }).map(entry => entry.desk);
}
// Equity from the desk's own marks. No interpolation, no generated points.
export function markSeries(events) {
  const points = (Array.isArray(events) ? events : [])
    .filter(event => event?.kind === 'ledger.mark')
    .map(event => ({ at: Date.parse(event.at), equity: Number(event.payload?.equity), raw: event.payload?.equity }))
    .filter(point => Number.isFinite(point.at) && Number.isFinite(point.equity))
    .sort((left, right) => left.at - right.at);
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

function tapeEntry(event) {
  const line = tapeLine(event);
  const entry = element('div', null, `tape-entry tone-${line.tone}`);
  entry.append(timeNode(line.at, 'clock'));
  const body = element('div', null, 'tape-body');
  const heading = element('span', null, 'tape-kind');
  heading.append(element('span', line.label));
  if (line.source) {
    const source = element('span', ` · `, 'tape-source');
    const deskStream = typeof line.stream === 'string' && line.stream.startsWith('desk:');
    source.append(deskStream ? link(line.source, `/capital/desk/?id=${encodeURIComponent(line.stream.slice(5))}`) : element('span', line.source));
    heading.append(source);
  }
  body.append(heading, element('span', line.text, 'tape-text'));
  entry.append(body);
  return entry;
}
function renderTape(target, events) {
  const entries = [...events].sort((left, right) => right.seq - left.seq).slice(0, TAPE_LIMIT).map(tapeEntry);
  target.replaceChildren(...(entries.length ? entries : [element('p', 'No events published yet.', 'empty-state')]));
  target.setAttribute('aria-busy', 'false');
}
function statusLine(target, mode, publishedAt) {
  const state = element('span', mode === 'live' ? 'Live · streaming' : mode === 'polling' ? 'Live · reconnecting' : 'Loading', mode === 'live' ? 'status-live' : 'status-polling');
  const published = element('span', 'Checkpoint ');
  if (publishedAt) published.append(timeNode(publishedAt));
  else published.textContent = 'Awaiting first checkpoint';
  target.replaceChildren(state, published);
}
function deskLink(desk) {
  return link(desk.name, `/capital/desk/?id=${encodeURIComponent(desk.id)}`);
}
function gateCell(desk) {
  if (!desk.gate) return element('td', '—');
  const cell = element('td', null);
  cell.append(element('span', `${desk.gate.name} ${desk.gate.passed ? 'passed' : 'not met'}`, desk.gate.passed ? 'gate-pass' : 'gate-fail'));
  return cell;
}
function leaderboard(desks, sort, onSort) {
  const node = element('table', null, 'leaderboard');
  const head = element('thead');
  const header = element('tr');
  for (const column of LEADERBOARD_COLUMNS) {
    const cell = element('th');
    if (sort.key === column.key) cell.setAttribute('aria-sort', sort.direction === 'asc' ? 'ascending' : 'descending');
    const button = element('button', `${column.label}${sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}`);
    button.type = 'button';
    button.addEventListener('click', () => onSort(column.key));
    cell.append(button);
    header.append(cell);
  }
  head.append(header);
  const body = element('tbody');
  for (const desk of sortDesks(desks, sort.key, sort.direction)) {
    const row = element('tr');
    const name = element('td');
    name.append(deskLink(desk));
    const status = element('td');
    status.append(element('span', desk.status, `desk-status desk-status-${desk.status}`));
    row.append(
      name,
      element('td', desk.mode),
      element('td', money(desk.capital_usd, 0)),
      element('td', money(desk.equity, 0)),
      element('td', percent(desk.return_pct)),
      element('td', percent(desk.max_drawdown_pct).replace('+', '−')),
      element('td', String(desk.days_live)),
      element('td', String(desk.orders)),
      element('td', money(desk.cost_usd, 2)),
      status,
      gateCell(desk),
    );
    body.append(row);
  }
  node.append(head, body);
  return node;
}
function deskCards(desks) {
  const cards = element('div', null, 'cards');
  for (const desk of desks) {
    const card = link('', `/capital/desk/?id=${encodeURIComponent(desk.id)}`, 'desk-card');
    card.append(element('span', desk.name, 'card-name'));
    const list = element('dl');
    for (const [label, value] of [
      ['Mode', desk.mode], ['Equity', money(desk.equity, 0)], ['Return', percent(desk.return_pct)],
      ['Days live', String(desk.days_live)], ['Status', desk.status],
    ]) list.append(element('dt', label), element('dd', value));
    card.append(list);
    cards.append(card);
  }
  return cards;
}
function floorMetrics(checkpoint) {
  const floor = checkpoint.floor;
  const metrics = element('dl', null, 'metrics');
  metrics.append(
    metric('Floor equity', money(floor.equity, 0)),
    metric('Cash', money(floor.cash, 0)),
    metric('Today', money(floor.daily_pnl, 0), signOf(floor.daily_pnl)),
    metric('Since inception', percent(floor.since_inception_pct), signOf(floor.since_inception_pct)),
    metric(floor.benchmark ? floor.benchmark.name : 'Benchmark', floor.benchmark ? percent(floor.benchmark.return_pct) : '—'),
    metric('Capital allocated', money(floor.capital_usd, 0)),
  );
  return metrics;
}

async function startFloor(root) {
  const status = root.querySelector('#floor-status');
  const summary = root.querySelector('#floor-summary');
  const board = root.querySelector('#floor-leaderboard');
  const cards = root.querySelector('#floor-cards');
  const tape = root.querySelector('#floor-tape');
  const state = { checkpoint: null, sort: { key: 'equity', direction: 'desc' }, events: [], mode: 'loading' };
  statusLine(status, state.mode, null);
  const drawBoard = () => {
    if (!state.checkpoint) return;
    board.replaceChildren(state.checkpoint.desks.length
      ? (() => { const scroll = element('div', null, 'table-scroll'); scroll.append(leaderboard(state.checkpoint.desks, state.sort, key => {
        state.sort = state.sort.key === key ? { key, direction: state.sort.direction === 'desc' ? 'asc' : 'desc' } : { key, direction: 'desc' };
        drawBoard();
      })); return scroll; })()
      : element('p', 'No desks are trading yet.', 'empty-state'));
  };
  async function refresh() {
    try {
      state.checkpoint = await loadCheckpoint();
      summary.replaceChildren(floorMetrics(state.checkpoint));
      summary.append(element('p', `Model budget ${money(state.checkpoint.budget.spent_today_usd, 2)} spent of ${money(state.checkpoint.budget.cap_usd, 2)} today · ${state.checkpoint.desks.length} desks`, 'note'));
      drawBoard();
      cards.replaceChildren(state.checkpoint.desks.length ? deskCards(state.checkpoint.desks) : element('p', 'Desk cards appear with the first published checkpoint.', 'empty-state'));
      statusLine(status, state.mode, state.checkpoint.published_at);
      summary.setAttribute('aria-busy', 'false');
    } catch {
      if (state.checkpoint) return;
      const notice = element('p', 'The floor checkpoint is unavailable. ', 'unavailable');
      notice.append(link('View the runtime on GitHub.', REPOSITORY));
      summary.replaceChildren(notice);
      summary.setAttribute('aria-busy', 'false');
    }
  }
  await refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  try {
    const history = await loadEvents({ limit: DEFAULT_EVENT_LIMIT });
    state.events = history.events;
    renderTape(tape, state.events);
  } catch {
    tape.replaceChildren(element('p', 'The tape is unavailable. It resumes when the floor publishes again.', 'unavailable'));
    tape.setAttribute('aria-busy', 'false');
  }
  const feed = startFeed({
    streams: ['all'],
    onStatus: mode => { state.mode = mode; statusLine(status, mode, state.checkpoint?.published_at || null); },
    onEvents: events => { state.events = [...events, ...state.events].slice(0, TAPE_LIMIT * 2); renderTape(tape, state.events); },
  });
  feed.remember(state.events);
  feed.prime(state.events[0]?.seq || 0);
  return feed;
}

function pnlChart(marks) {
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
async function startDesk(root) {
  const header = root.querySelector('#desk-header');
  const detail = root.querySelector('#desk-detail');
  const tape = root.querySelector('#desk-tape');
  const status = root.querySelector('#desk-status');
  const id = new URLSearchParams(window.location.search).get('id');
  if (!deskId(id)) {
    header.replaceChildren(element('h1', 'Desk not found'), element('p', 'Open a desk from the floor.', 'note'));
    detail.replaceChildren();
    tape.replaceChildren();
    return null;
  }
  statusLine(status, 'loading', null);
  let desk = null;
  try { desk = await loadDesk(id); } catch { /* The manifest facts stay blank until the next checkpoint. */ }
  header.replaceChildren(element('h1', desk ? desk.name : id));
  if (desk) {
    header.append(facts([
      ['Desk', desk.id], ['Family', desk.family], ['Generation', String(desk.generation)],
      ['Parent', desk.parent_id || 'Founding desk'], ['Mode', desk.mode], ['Venues', desk.venues.join(', ') || 'None'],
      ['Capital', money(desk.capital_usd, 0)], ['Equity', money(desk.equity, 0)], ['Cash', money(desk.cash, 0)],
      ['Today', money(desk.daily_pnl, 2)], ['Return', percent(desk.return_pct)], ['Max drawdown', percent(desk.max_drawdown_pct).replace('+', '−')],
      ['Days live', String(desk.days_live)], ['Orders', String(desk.orders)], ['Model cost', money(desk.cost_usd, 2)],
      ['Status', desk.status], ['Gate', desk.gate ? `${desk.gate.name} · ${desk.gate.passed ? 'passed' : 'not met'}` : 'None recorded'],
      ['Updated', date(desk.updated_at)],
    ]));
  } else header.append(element('p', 'This desk has no published checkpoint row yet.', 'note'));
  const [deskEvents, marks, fills, evolution] = await Promise.all([
    loadEvents({ stream: `desk:${id}`, limit: 60 }).catch(() => ({ events: [] })),
    loadEvents({ stream: `ledger:${id}`, kind: 'ledger.mark', limit: MAX_EVENT_LIMIT }).catch(() => ({ events: [] })),
    loadEvents({ kind: 'broker.fill', limit: 60 }).catch(() => ({ events: [] })),
    loadEvents({ stream: 'evolution', limit: 100 }).catch(() => ({ events: [] })),
  ]);
  const performance = section('Equity', 'Desk marks only');
  performance.append(pnlChart(marks.events));
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
  const gate = section('Gate', 'Promotion evidence');
  if (desk?.gate) {
    gate.append(element('p', `${desk.gate.name} · ${desk.gate.passed ? 'passed' : 'not met'}`, desk.gate.passed ? 'gate-pass' : 'gate-fail'));
    gate.append(facts(Object.entries(desk.gate.evidence).slice(0, 12).map(([key, value]) => [key, show(value) || '…'])));
  } else gate.append(element('p', 'No gate recorded for this desk.', 'empty-state'));
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
  } else family.append(element('p', desk?.parent_id ? `Spawned from ${desk.parent_id}.` : 'No evolution events for this desk.', 'empty-state'));
  detail.replaceChildren(performance, book, blotter, gate, family);
  detail.setAttribute('aria-busy', 'false');
  renderTape(tape, deskEvents.events);
  const state = { events: deskEvents.events };
  const feed = startFeed({
    streams: [`desk:${id}`, `ledger:${id}`],
    onStatus: mode => statusLine(status, mode, desk?.updated_at || null),
    onEvents: events => { state.events = [...events, ...state.events].slice(0, TAPE_LIMIT * 2); renderTape(tape, state.events); },
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
  const names = new Map((checkpoint?.desks || []).map(desk => [desk.id, desk.name]));
  if (checkpoint) {
    statusLine(status, 'loading', checkpoint.published_at);
    const entries = Object.entries(checkpoint.committee.allocations);
    const list = element('div');
    for (const [id, usd] of entries.sort((left, right) => (scaled(right[1]) > scaled(left[1]) ? 1 : -1))) {
      const row = element('div', null, 'allocation-row');
      const name = element('span');
      name.append(link(names.get(id) || id, `/capital/desk/?id=${encodeURIComponent(id)}`));
      row.append(name, element('span', money(usd, 0)));
      list.append(row);
    }
    allocations.replaceChildren(entries.length ? list : element('p', 'Helm has not allocated capital yet.', 'empty-state'));
    allocations.append(element('p', `Floor capital ${money(checkpoint.floor.capital_usd, 0)} · last memo ${checkpoint.committee.last_memo_at ? date(checkpoint.committee.last_memo_at) : 'none'}`, 'note'));
  } else allocations.replaceChildren(element('p', 'The committee checkpoint is unavailable.', 'unavailable'));
  allocations.setAttribute('aria-busy', 'false');
  const [committeeEvents, evolution] = await Promise.all([
    loadEvents({ stream: 'committee', limit: 100 }).catch(() => ({ events: [] })),
    loadEvents({ stream: 'evolution', limit: 100 }).catch(() => ({ events: [] })),
  ]);
  const gateEvents = committeeEvents.events.filter(event => event.kind === 'committee.gate');
  gates.replaceChildren(gateEvents.length
    ? table(['Time', 'Desk', 'Gate', 'Result'], gateEvents.slice(0, 40).map(event => [
      date(event.at), show(event.payload?.desk_id) || '—', show(event.payload?.gate) || '—', event.payload?.passed ? 'passed' : 'not met',
    ]))
    : element('p', 'No gate decisions published yet.', 'empty-state'));
  const memoEvents = committeeEvents.events.filter(event => event.kind === 'committee.memo');
  const memoList = element('div');
  for (const event of memoEvents.slice(0, 12)) {
    const memo = element('div', null, 'memo');
    memo.append(element('h3', show(event.payload?.period) || 'Committee memo'));
    memo.append(timeNode(event.at));
    memo.append(element('p', show(event.payload?.text)));
    memoList.append(memo);
  }
  memos.replaceChildren(memoEvents.length ? memoList : element('p', 'No committee memo published yet.', 'empty-state'));
  const evolutionEvents = evolution.events.filter(event => event.kind.startsWith('evolution.'));
  renderTape(history, evolutionEvents);
  const state = { events: evolutionEvents };
  const feed = startFeed({
    streams: ['committee', 'evolution'],
    onStatus: mode => statusLine(status, mode, checkpoint?.published_at || null),
    onEvents: events => {
      state.events = [...events.filter(event => event.kind.startsWith('evolution.')), ...state.events].slice(0, TAPE_LIMIT);
      renderTape(history, state.events);
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
