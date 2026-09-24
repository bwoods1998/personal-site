import { MAX_EVENT_LIMIT, REAL_BANDS, bandName, deskId, isLive, validCheckpoint, validPublicEvent, socketMatches, tapeName } from './schema.js';

// Long-Term Capital Management's own record, rendered from text nodes only. Prices are the floor's
// fills and marks; the page never contacts a quote vendor and never starts work on a desk.
const API = '/api/capital';
// A test tape: /capital/?tape=test reads the separate floor a publisher filled under
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
const TAPE_TEXT_LIMIT = 140;
// Durable all-time balance history, separate from the bounded live activity tape.
const FLOOR_MARK = { kind: 'floor.mark', field: 'account_equity' };
const FLOOR_HISTORY_LIMIT = 2048;
// The account baseline, reset with the rebuild (Sept 19, 2026): the runtime's
// `account_performance.start_at`, where it read $1,021.9251 across the venues. The first run's
// boundary was 2026-09-16T04:58:42.508Z. Fixed provenance boundary, never a drawdown filter.
export const PERFORMANCE_START_AT = '2026-09-19T04:56:53.000Z';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 100000000n;
const responseCache = new Map();
// The status follows the data, never a switch in this file: the runtime publishes a checkpoint
// every minute, so the floor is running while the newest one the page holds is younger than this.
// Starting the runtime turns the word to "live"; stopping it turns the word to "stopped".
export const FLOOR_STALE_MS = 15 * 60 * 1000;
// The window runs both ways. The worker refuses a checkpoint stamped more than a minute ahead, so
// a `published_at` in the future is a publisher or a reader whose clock is off, not a floor that
// stopped; one further ahead than the window is not a time this page can read.
export function floorRunning(checkpoint, now = Date.now()) {
  const at = typeof checkpoint?.published_at === 'string' ? Date.parse(checkpoint.published_at) : NaN;
  return Number.isFinite(at) && Number.isFinite(now) && Math.abs(now - at) <= FLOOR_STALE_MS;
}

// The twelve desks the runtime publishes, each a partner of the firm the project is named after,
// with the human behind the surname. Page copy only: the numbers, the thinking and the orders all
// come from the published checkpoint and event log.
export const PARTNERS = {
  meriwether: {
    surname: 'Meriwether', first: 'John', role: 'sports results', via: 'Kalshi',
    mandate: 'Winners, spreads and totals in every league Kalshi lists: the firm\'s largest book, and the one the calendar moves most.',
  },
  hilibrand: {
    surname: 'Hilibrand', first: 'Lawrence', role: 'crypto strikes', via: 'Kalshi',
    mandate: 'Hourly and daily strike ladders on bitcoin and ether, where the firm\'s one measured edge lives: resting bids on heavy favourites.',
  },
  scholes: {
    surname: 'Scholes', first: 'Myron', role: 'index and sector ETFs', via: 'Alpaca',
    mandate: 'SPY, QQQ and the sector funds, trading the published anomalies: overnight drift, two-day pullbacks, cross-asset momentum.',
  },
  rosenfeld: {
    surname: 'Rosenfeld', first: 'Eric', role: 'bitcoin and ether', via: 'Alpaca',
    mandate: 'Spot BTC and ETH around the clock, long only, where a 0.3% round trip means few trades and larger moves.',
  },
  haghani: {
    surname: 'Haghani', first: 'Victor', role: 'alternative coins', via: 'Alpaca',
    mandate: 'The liquid coins beyond BTC and ETH, with two to three times the range and wider spreads: a patient maker\'s book.',
  },
  mullins: {
    surname: 'Mullins', first: 'David', role: 'daily weather', via: 'Kalshi',
    mandate: 'City temperature and rain contracts, the best-measured favourites group the firm has traded, and no forecasting of its own.',
  },
  mcentee: {
    surname: 'McEntee', first: 'James', role: 'large single stocks', via: 'Alpaca',
    mandate: 'The dozen most traded US stocks, which move two to three times the index and gap on news.',
  },
  krasker: {
    surname: 'Krasker', first: 'William', role: 'listed options', via: 'Alpaca',
    mandate: 'Long calls and puts on sixteen underlyings, premium only: the most a position can lose is what was paid for it.',
  },
  hawkins: {
    surname: 'Hawkins', first: 'Greg', role: 'slow published numbers', via: 'Kalshi',
    mandate: 'Gasoline, diesel, oil, gold and currency ladders, where the number moves slowly and most of the ladder is settled before it pays.',
  },
  hufschmid: {
    surname: 'Hufschmid', first: 'Hans', role: 'player props', via: 'Kalshi',
    mandate: 'Thousands of thin player markets, where the spread is widest and a wrong price hurts most.',
  },
  huang: {
    surname: 'Huang', first: 'Chi-fu', role: 'fifteen-minute crypto', via: 'Kalshi',
    mandate: 'Up-or-down in the next quarter hour: ninety-six results a day a coin, the fastest feedback in the firm.',
  },
  leahy: {
    surname: 'Leahy', first: 'Dick', role: 'counts and ratings', via: 'Kalshi',
    mandate: 'Numbers that accumulate toward a deadline: review scores, approval averages, weekly counts, entered only once they are nearly final.',
  },
};
export const PARTNER_ORDER = ['meriwether', 'hilibrand', 'scholes', 'rosenfeld', 'haghani', 'mullins',
  'mcentee', 'krasker', 'hawkins', 'hufschmid', 'huang', 'leahy'];
// Merton is not a desk: he is the frontier model that writes the code, audits every candidate for
// real money and opens the pull requests. The firm's deepest theorist, doing the firm's thinking.
export const MERTON = { surname: 'Merton', first: 'Robert', role: 'architect, auditor, teacher' };
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// "crypto-reversion-2" reads as "Crypto Reversion 2".
export const titleCase = slug => show(slug).split('-').filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');

// "price_move" reads as "price move"; the runtime's ids are for the log, not the page.
const humanize = value => (typeof value === 'string' ? value.replace(/[_:]+/g, ' ').trim() : '');
// An instrument is published as {symbol, asset_class, venue}; older events carried a string.
export function instrumentLabel(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) return typeof value.symbol === 'string' ? value.symbol : '';
  return '';
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
function timeNode(value, style) {
  const node = element('time', date(value, style));
  node.dateTime = value;
  return node;
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

// Page copy for a published desk. An unknown or bred desk keeps the name the runtime gave it.
//
// A number on the end of an id always reads as a NUMERAL, whatever the name in front of it is:
// Meriwether III, Favorites Maker II, Rosenfeld II. The firm's desks number their own agents
// (`meriwether-3`), and nothing on this page should show two ways of saying the same thing.
const NUMBERED = /^(.*?)-0*([1-9]\d{0,2})$/;
export function partnerOf(desk) {
  const id = typeof desk === 'string' ? desk : show(desk?.id);
  const family = typeof desk === 'string' ? '' : show(desk?.family);
  const known = PARTNERS[id] || PARTNERS[family] || PARTNERS[id.split('-')[0]] || null;
  const name = typeof desk === 'string' ? '' : show(desk?.name);
  const parts = NUMBERED.exec(id);
  const variant = parts ? roman(Number(parts[2])) : '';
  if (known) return { id, ...known, variant };
  // An agent of the rebuilt runtime that no desk claims: the name it was given when that is
  // written for a reader, otherwise its slug in title case, with any number as a numeral.
  const base = parts ? parts[1] : id;
  const written = name && !SLUG.test(name) ? name.replace(/\s+[IVXLCDM]+$/, '') : '';
  return { id, surname: written || titleCase(base) || id, first: '', role: '', via: '', mandate: '', variant };
}
export const partnerName = id => { const partner = partnerOf(id); return partner.variant ? `${partner.surname} ${partner.variant}` : partner.surname; };
// The twelve desks lead in the owner's order; anything bred within one follows it.
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
export function truncate(value, max = TAPE_TEXT_LIMIT) {
  const full = show(value).replace(/\s+/g, ' ').trim();
  if (full.length <= max) return { text: full, full, truncated: false };
  return { text: full.slice(0, max).replace(/\s+\S*$/, '') + '…', full, truncated: true };
}

// "buy 10 KXFED yes" reads as words: bought, sold; a sell of a YES contract stays a sale.
const fillVerb = side => (show(side) === 'buy' ? 'bought' : show(side) === 'sell' ? 'sold' : show(side));
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
  if (data?.schema_version !== 1 || !Array.isArray(data.events) || data.events.length > MAX_EVENT_LIMIT || !data.events.every(validPublicEvent)) throw new Error('Invalid tape.');
  return data;
}
async function loadCheckpoint() {
  const data = await fetchJson(`${apiBase(pageSearch())}/checkpoint`, MAX_CHECKPOINT_BYTES);
  if (!validCheckpoint(data)) throw new Error('Invalid checkpoint.');
  return data;
}
async function loadHistory() {
  const data = await fetchJson(`${apiBase(pageSearch())}/history`);
  if (data?.schema_version !== 1 || !Array.isArray(data.points) || data.points.length > FLOOR_HISTORY_LIMIT
      || !data.points.every(point => typeof point.at === 'string' && Number.isFinite(Date.parse(point.at))
        && typeof point.account_equity === 'string' && numeric(point.account_equity) && Number(point.account_equity) >= 0)) throw new Error('Invalid balance history.');
  return data.points.map(point => ({ id: `history:${point.at}`, kind: FLOOR_MARK.kind, at: point.at, payload: { account_equity: point.account_equity } }));
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

// ------------------------------------------------- the accounts the money actually sits in
// `live_equity` is the ledger's number, and it is what attributes a gain to a desk. This is what
// the venues say the balance is, which is what the owner sees when they open the apps.
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
const streamDeskOf = stream => (typeof stream === 'string' && stream.startsWith('desk:') ? stream.slice(5) : null);

// ---- words for times and names
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
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [size, glyph] of table) while (number >= size) { out += glyph; number -= size; }
  return out;
}
// A desk's agents are told apart by the number in their id, never by their generation: a child of
// Meriwether III is the next free number on that desk, not "Meriwether IV". One name, everywhere.
export const raceName = desk => partnerName(desk);
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
  const coin = /^([A-Z0-9]{2,10})[-/]USDC?$/.exec(ticker);
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

// ---- the masthead: two numbers
// "23h 49m" of running, with the seconds that make it tick.
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
// Total profit is the tracked profit since inception, a dash until the funding basis is verified.
export function mastheadNumbers(checkpoint, now = Date.now(), marks = []) {
  const run = checkpoint?.run && typeof checkpoint.run === 'object' ? checkpoint.run : null;
  const performance = portfolioPerformance(checkpoint, marks);
  const pnl = performance.profit;
  const share = pnl !== null && performance.netFlows === 0 ? percent((pnl / performance.series.first.equity * 100).toFixed(4)) : '';
  const started = Date.parse(run?.started_at);
  const elapsed = Number.isFinite(started) ? selfImprovingParts(Math.max(0, (now - started) / 1000)) : { main: '—', tick: '' };
  return [
    { key: 'profit', label: 'Total profit', value: pnl === null ? '—' : signedMoney(pnl.toFixed(2), 2), tone: pnl === null ? '' : signOf(pnl.toFixed(2)), note: share },
    { key: 'clock', label: 'Running', value: elapsed.main, tick: elapsed.tick, tone: '', startedAt: Number.isFinite(started) ? started : null },
  ];
}

// ---- live: thinking, researching, trading
// A tool call is shown when it is research, in the words a person would use for it. Orders, memos
// and playbook writes are left out: the trade itself shows, and the rest is bookkeeping.
const said = value => { const text = truncate(show(value), 70).text; return text ? `“${text}”` : ''; };
const TICKERISH = /^(?:KX[A-Z0-9]+-[A-Z0-9.-]+|[A-Z0-9]{2,10}[-/]USDC?)$/;
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
  // The rebuilt runtime's research tools (Sept 19, 2026). A write-up for the shared library is
  // research the other agents read, so it shows; a request to the architect is how a tool is born.
  web_search: args => { const query = argument(args, 'query'); return query ? `searching the web for ${said(query)}` : 'searching the web'; },
  library_search: args => { const query = argument(args, 'query'); return query ? `searching the research library for ${said(query)}` : 'searching the research library'; },
  library_read: args => { const title = argument(args, 'title'); return title ? `reading ${said(title)} in the research library` : 'reading the research library'; },
  library_write: args => { const title = argument(args, 'title'); return title ? `writing up ${said(title)} for the library` : 'writing up its research for the library'; },
  replay: args => { const purpose = argument(args, 'purpose'); return purpose ? `replaying ${said(purpose)} against history` : 'replaying a strategy against history'; },
  request_tool: args => { const name = argument(args, 'name'); return name ? `asking the architect for a tool: ${truncate(humanize(name), 60).text}` : 'asking the architect for a tool'; },
  playbook_read: () => 'reading the graveyard playbook',
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
// Every name on the page comes from one place, so a numbered agent reads the same everywhere.
export const floorName = id => partnerName(show(id));
// A model's thought as prose: its markdown emphasis and code ticks are for a renderer the floor
// does not use.
export const plainThought = value => show(value).replace(/\*\*|__|`+/g, '').replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim();
// The League speaks the House's words; the page speaks in levels. A move on the ladder reads as the
// ladder tells it, and every other league line has the House's band words swapped for the page's.
const HOUSE_WORDS = [
  [/\b(passed|failed) (?:deep )?replay\b/gi, (match, verb) => `${verb} its history test`],
  [/\breplay-passing\b/gi, () => 'history-tested'],
  [/\breplay\b/gi, () => 'history test'],
  [/\bbunt\b/gi, () => 'Level 2'],
  [/\bprobe\b/gi, () => 'Level 2'],
  [/\bswing\b/gi, () => 'Level 3'],
  [/\bstar\b/gi, () => 'top 3'],
  [/\bpaper\b/gi, () => 'practice'],
  [/\brung 0\b/gi, () => 'the history test'],
  [/\brung ([1-3])\b/gi, (match, rung) => `Level ${rung}`],
  [/\brungs?\b/gi, match => (match.length > 4 ? 'levels' : 'level')],
  [/\bE (?=[\d<>=≥≤])/g, () => 'evidence '],
];
export function houseWords(value) {
  let text = show(value);
  for (const [pattern, swap] of HOUSE_WORDS) {
    text = text.replace(pattern, (match, ...rest) => {
      const words = swap(match, ...rest.slice(0, -2));
      const [offset, whole] = rest.slice(-2);
      // A sentence that began with a House word still begins with a capital.
      return /(?:^|[.!?]\s+)$/.test(whole.slice(0, offset)) ? capitalized(words) : words;
    });
  }
  return text;
}
export function leagueWords(event) {
  const move = ladderMove(event);
  if (!move) return houseWords(plainThought(event?.payload?.message));
  const name = floorName(move.agent);
  const from = levelOf(move.fromBand);
  const to = levelOf(move.toBand);
  const said = move.kind === 'born' ? `${name} is born`
    : move.kind === 'out' ? `${name} retired`
      : move.kind === 'size' ? `${name}'s real stake is now ${money(move.stake, 0)}`
        : to !== null && from === to ? (move.toBand === 'star' ? `${name} joins the top 3` : move.fromBand === 'star' ? `${name} leaves the top 3` : `${name} starts practice`)
          : move.kind === 'up' ? `${name} climbs to Level ${to}${numeric(move.stake) ? ` with ${money(move.stake, 0)} real` : ''}`
            : `${name} drops to Level ${to}`;
  const reason = reasonWords(move);
  return reason ? `${said}: ${reason}` : said;
}
// One live line, or null for everything the floor page does not show.
export function feedLine(event, liveIds = new Set()) {
  if (!event || !FEED_KINDS.includes(event.kind)) return null;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
  if (event.kind === 'lab.progress') {
    const execution = payload.component === 'execution';
    // The rebuilt runtime's research loop speaks as the League; the first run's spoke as the
    // Foundry, and its execution heartbeat as Execution. Testing or learning is said by `stage`.
    const league = payload.component === 'league';
    const text = league ? leagueWords(event) : plainThought(payload.message);
    return text ? { id: show(event.id), seq: Number(event.seq) || 0, at: show(event.at), desk: execution ? 'arena' : league ? 'league' : 'foundry',
      name: execution ? 'Execution' : league ? 'League' : 'Foundry',
      practice: false, pnl: '', tone: '', kind: execution ? 'monitoring' : payload.stage === 'learn' ? 'learning' : 'testing', text } : null;
  }
  const desk = streamDeskOf(event.stream) || show(payload.desk_id);
  if (!deskId(desk) || desk === 'settlement') return null;
  // A fill or an outcome that records `real_money` is believed over the desk's mode today, as in
  // the closed table: a practice fill stays practice after its agent is promoted.
  const recorded = typeof payload.real_money === 'boolean' ? !payload.real_money : null;
  const practice = payload.shadow === true || event.stream === 'broker:shadow' || (recorded ?? !(liveIds instanceof Set && liveIds.has(desk)));
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
// Every account the floor trades has to be answering before a profit figure means anything. The
// floor names them in the checkpoint, so adding a venue (Alpaca, Sept 19, 2026) does not need an
// edit here; a floor that publishes no venue at all is never complete.
function completeAccounts(floor) {
  const venues = Array.isArray(floor?.venues) ? floor.venues : [];
  return venues.length > 0 && venues.every(row => row && !row.stale && numeric(row.equity));
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

// Positions worth showing: real money first, then the practice books, each by value. The rebuilt
// runtime keeps an agent on a practice book for its first weeks, so those are listed too, tagged
// as the closed table tags a practice trade. Dust is counted, not listed, on either book.
export function openPositionRows(checkpoint, { minValue = 0.5 } = {}) {
  const real = [];
  const practice = [];
  let dust = 0;
  for (const desk of orderDesks(checkpoint?.desks).filter(item => item && typeof item === 'object')) {
    for (const position of Array.isArray(desk.positions) ? desk.positions : []) {
      if (!position || typeof position !== 'object') continue;
      const row = positionRow(desk, position);
      if (!(Math.abs(row.value) >= minValue)) { dust += 1; continue; }
      (row.live ? real : practice).push(row);
    }
  }
  const byValue = (left, right) => right.value - left.value;
  return { rows: [...real.sort(byValue), ...practice.sort(byValue)], real: real.length, practice: practice.length, dust };
}
// "2 real · 5 practice" over a mixed book. A book of one kind needs no count: real rows are
// untagged, and an all-practice book is announced by the flat line above it.
export function positionCounts(book) {
  return book?.real > 0 && book?.practice > 0 ? `${book.real} real · ${book.practice} practice` : '';
}
// One holding as the tables show it: the market in words, the side, value, P&L and the reason.
function positionRow(desk, position) {
  const unrealized = looseAmount(position.unrealized_pnl);
  const symbol = instrumentLabel(position.instrument);
  const event = show(position.instrument?.asset_class) === 'event' || symbol.startsWith('KX');
  const side = show(position.side);
  const pnl = numeric(unrealized) ? unrealized : '';
  return {
    desk: show(desk.id), name: raceName(desk), live: isLive(desk), symbol, market: marketTitle(symbol) || '—',
    side: event ? (side === 'no' || side === 'short' ? 'NO' : 'YES') : side, value: Number(position.market_value), valueText: money(looseAmount(position.market_value), 2),
    pnlText: pnl ? signedMoney(pnl, 2) : '—', tone: pnl ? signOf(pnl) : '', ...thesisParts(position.thesis),
  };
}
// The one line over a book with no real-money position: what the real accounts hold, and how
// many practice positions are listed under it.
export function flatLine(checkpoint, practice = 0) {
  const total = accountEquity(checkpoint?.floor);
  const venues = accountVenues(checkpoint?.floor).map(row => row.name);
  const across = venues.length < 2 ? venues.join('')
    : `${venues.slice(0, -1).join(', ')} and ${venues[venues.length - 1]}`;
  const below = practice > 0 ? ` ${plural(practice, 'practice position')} below.` : '';
  return `No real-money position open.${total === null ? '' : ` ${money(total, 0)} in cash${across ? ` across ${across}` : ''}.`}${below}`;
}

// ---- past trades: every settled or exited trade, who took it and why
export function closedRows(events, checkpoint, { limit = 40 } = {}) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && typeof desk === 'object');
  const live = new Set(desks.filter(desk => isLive(desk)).map(desk => show(desk.id)));
  // The four founders traded real money from the first day; an outcome written before the
  // runtime recorded `real_money` is real when its desk is live now or is a founder, so a
  // later demotion does not turn a real loss into practice.
  // The owner's own founders: the runtime says so itself, with no parent and the first generation.
  const founders = new Set(desks.filter(desk => desk.parent_id === null && Number(desk.generation) === 1).map(desk => show(desk.id)));
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

// Reported trading P&L, separate from the game's earned promotion record.
const deskPnl = desk => (numeric(looseAmount(desk?.pnl_usd)) ? Number(desk.pnl_usd)
  : numeric(desk?.equity) && numeric(desk?.capital_usd) ? Number(desk.equity) - Number(desk.capital_usd) : null);

// ---- the floor page, drawn
const FEED_LINES = 12;
const TRADE_ROWS = 8;
const HERO_TEXT_LIMIT = 420;
const PING_KINDS = { 'desk.thought': 'thought', 'desk.tool_call': 'tool', 'broker.fill': 'fill' };
const FEED_LABELS = { thinking: 'thinking', researching: 'researching', trading: 'trading', testing: 'testing', learning: 'learning', monitoring: 'monitoring' };
const tagNode = (text, kind) => element('span', text, `tag tag-${kind}`);
const modeTag = live => tagNode(live ? 'real money' : 'practice', live ? 'real' : 'practice');
function pulse(className = 'pulse') {
  const dot = element('span', null, className);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}
// CSSOM, not a style attribute: the page's policy allows the one and refuses the other. A custom
// property ("--p") is set by name.
function place(node, properties) {
  try {
    for (const [key, value] of Object.entries(properties)) {
      if (key.startsWith('--')) node.style.setProperty(key, value); else node.style[key] = value;
    }
  } catch { /* no layout here */ }
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
  head.append(pulse('pulse now-pulse'), element('span', desk ? raceName(desk) : partnerName(id), 'now-name'), modeTag(live), why, when);
  const thought = element('p', '', 'now-thought');
  const research = element('p', '', 'now-research');
  card.append(head, thought, research);
  return { card, why, when, thought, research };
}
function drawHeroInto(box, state) {
  const hero = heroThought(state.feed, state.hero?.desk || null);
  if (!hero) {
    box.replaceChildren(element('p', state.checkpoint ? quietLine(state.checkpoint) : state.asked ? 'Nothing is running right now.' : 'Connecting to the floor…', 'empty-state now-empty'));
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
  who.append(element('span', line.name, 'feed-name'));
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
  // The chart first, each account's balance under it.
  const nodes = series ? [balanceChart(series, performance)] : [];
  if (venues.length) nodes.push(line);
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
function agentCell(name, live) {
  const cell = element('td', null, 'col-agent');
  cell.append(element('span', name, 'agent-name'));
  if (live === false) cell.append(tagNode('practice', 'practice'));
  return cell;
}
// Practice rows are listed only while the Positions switch is on (the owner, Sept 23, 2026: the
// agents now explore on the practice books at scale, and real money is the story).
function positionsPanel(checkpoint, state) {
  const book = openPositionRows(checkpoint);
  const practice = Boolean(state?.practice);
  const rows = practice ? book.rows : book.rows.filter(row => row.live);
  const nodes = [];
  if (!book.real) nodes.push(element('p', flatLine(checkpoint, practice ? book.practice : 0), 'empty-state'));
  const counts = practice ? positionCounts(book) : '';
  if (counts) nodes.push(element('p', counts, 'record-line'));
  if (rows.length) {
    const table = element('table', null, 'rows rows-book');
    table.append(headRow([['Agent', 'col-agent'], ['Market', 'col-market'], ['Side', 'col-side'], ['Value', 'col-num'], ['P&L', 'col-num'], ['Why', 'col-why']]));
    const body = element('tbody');
    for (const row of rows) {
      // Real money is unmarked; a practice row carries the closed table's own tag and tone.
      const line = element('tr', null, row.live ? '' : 'row-practice');
      line.append(agentCell(row.name, row.live), element('td', row.market, 'col-market'), element('td', row.side, 'col-side'),
        element('td', row.valueText, 'col-num col-value'), element('td', row.pnlText, `col-num col-pnl ${row.tone}`.trim()), whyCell(row, state, `position:${row.desk}:${row.symbol}`));
      body.append(line);
    }
    table.append(body);
    nodes.push(table);
  }
  return nodes;
}
// Real-money trades, and the practice ones too while the Positions switch is on.
function closedPanel(state) {
  const rows = closedRows(state.outcomes, state.checkpoint, { limit: MAX_EVENT_LIMIT });
  const real = rows.filter(row => row.live);
  const shown = state.practice ? rows : real;
  const nodes = [];
  const record = closedRecord(rows);
  if (record) nodes.push(element('p', record, 'record-line'));
  if (!real.length) nodes.push(element('p', rows.length ? 'No real-money trade has closed yet.' : 'No trade has closed yet.', 'empty-state'));
  if (!shown.length) return nodes;
  const table = element('table', null, 'rows rows-trades');
  table.append(headRow([['Agent', 'col-agent'], ['Market', 'col-market'], ['Result', 'col-result'], ['P&L', 'col-num'], ['Held', 'col-held'], ['Why', 'col-why']]));
  const body = element('tbody');
  for (const row of shown.slice(0, state.more ? MAX_EVENT_LIMIT : TRADE_ROWS)) {
    const line = element('tr', null, row.live ? '' : 'row-practice');
    const result = element('td', row.outcome, `col-result result-${row.outcome}`);
    if (row.settled) result.setAttribute('title', row.settled);
    line.append(agentCell(row.name, row.live), element('td', row.market, 'col-market'), result,
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
// One switch over both tables, open and closed, off on every visit: practice positions and trades
// are there to be looked at, not to crowd the real ones. Nothing practice to show, no switch.
export function practiceCount(checkpoint, outcomes = []) {
  const open = openPositionRows(checkpoint).practice;
  const closed = closedRows(outcomes, checkpoint, { limit: MAX_EVENT_LIMIT }).filter(row => !row.live).length;
  return open + closed;
}
// The ladder does not follow it: every agent is always a dot there.
function practiceSwitch(state) {
  if (!state.practice && !practiceCount(state.checkpoint, state.outcomes)) return [];
  const button = element('button', state.practice ? 'hide practice trades' : 'show practice trades', state.practice ? 'chip chip-on' : 'chip');
  button.type = 'button';
  button.setAttribute('aria-pressed', state.practice ? 'true' : 'false');
  button.setAttribute('aria-controls', 'floor-positions floor-closed');
  button.addEventListener('click', () => { state.practice = !state.practice; state.more = false; state.drawPositions(); state.drawClosed(); state.focusSwitch(); });
  return [button];
}
// ---- the ladder: three levels, one dot per agent (the owner, Sept 23, 2026)
// The House ranks its agents in five bands; the page shows three levels and never names a band.
// Level 1 is practice (an agent still being tested on history is a faint ring there), Level 2 is
// live trading with a real stake, and Level 3 is increased capital, where the top three earners
// wear a medal. The House calls the practice band "paper", and the page never does.
export const LEVELS = [
  { level: 3, word: 'Increased capital', bands: ['star', 'swing'], real: true },
  { level: 2, word: 'Live trading', bands: ['bunt', 'probe'], real: true },
  { level: 1, word: 'Practice', bands: ['paper', 'replay'], real: false },
];
const BAND_LEVEL = { replay: 1, paper: 1, probe: 2, bunt: 2, swing: 3, star: 3 };
export const levelOf = band => BAND_LEVEL[band] ?? null;
// A probe and a bunt share Level 2; a probe's family proving its edge moves it up to a bunt's stake.
const BAND_RANK = { replay: 0, paper: 1, probe: 2, bunt: 2.5, swing: 3, star: 4 };
// The House's own words for its bands, as its league lines print them. Only the tape parser reads
// these; the page's words are the levels above, so a band move still parses whatever the page says.
const HOUSE_BAND_WORDS = { Replay: 'replay', Practice: 'paper', Probe: 'probe', Bunt: 'bunt', Swing: 'swing', Star: 'star' };
// Before the allocator a desk published only its rung: 0 replay, 1 practice, 2 and 3 real money.
const RUNG_BANDS = ['replay', 'paper', 'bunt', 'swing'];
export const bandLabel = band => (levelOf(band) ? `Level ${levelOf(band)}` : 'Level unknown');
const rungNumber = value => Number.isInteger(value) && value >= 0 && value <= 3;
// The band a desk sits in: the allocator's own word when published, else the one its rung implies.
export function deskBand(desk) {
  if (bandName(desk?.band)) return desk.band;
  const rung = desk?.gate?.evidence?.rung;
  return rungNumber(rung) ? RUNG_BANDS[rung] : null;
}
const bandUp = (from, to) => (bandName(from) ? BAND_RANK[to] > BAND_RANK[from] : true);

// What the House's allocator asks before it moves an agent up (league/constitution.py): practice
// to live trading at evidence E of 1.01 or more over five closed trades; live trading to increased
// capital at 1.5 or more over eight real trades, with real results at or above even. Its other
// routes (Kalshi's three settlements, the evaluator's screen) are not published, so a closed ring
// is a floor, never a promise: the page says "ready", not "next".
export const NEXT_LEVEL = {
  paper: { level: 2, evidence: 1.01, trades: 5, count: 'trades' },
  bunt: { level: 3, evidence: 1.5, trades: 8, count: 'real_trades', belowEven: 0.95 },
  probe: { level: 3, evidence: 1.5, trades: 8, count: 'real_trades', belowEven: 0.95 },
};
const clamp01 = value => Math.min(1, Math.max(0, value));
// How far an agent has come toward the next level, 0 to 1, or null when the page cannot honestly say.
export function levelProgress(agent, enabled) {
  const rule = NEXT_LEVEL[agent?.band];
  const evidence = agent?.evidence;
  if (enabled !== true || !rule || !evidence || agent.retired || agent.accountingIssue || !numeric(evidence.E)) return null;
  const count = Number.isSafeInteger(evidence[rule.count]) ? evidence[rule.count] : 0;
  let progress = Math.min(clamp01(count / rule.trades), clamp01((Number(evidence.E) - 1) / (rule.evidence - 1)));
  if (rule.belowEven && !(numeric(evidence.W_real) && Number(evidence.W_real) >= 1)) progress = Math.min(progress, rule.belowEven);
  return Math.round(progress * 10000) / 10000;
}
// A dot's arc shows from 2% on; below that it is noise.
const ARC_MIN = 0.02;
// A real stake is a gold coin, its area in proportion to the dollars: $10 is 19px, $25 is 30px,
// $56 is 45px, and nothing is wider than 56px, so a phone never scrolls sideways.
export const coinSize = stake => (Number.isFinite(stake) && stake > 0 ? Math.min(56, Math.max(18, Math.round(6 * Math.sqrt(stake)))) : 18);

// The current publisher's lifecycle record is league_news(), not a strategy's prose. Only its
// exact, anchored templates qualify. Never infer a promotion from P&L, mode or a missing desk.
const BAND_WORD = `(${Object.keys(HOUSE_BAND_WORDS).join('|')})`;
const AMOUNT = '(\\d[\\d,]*(?:\\.\\d+)?)';
const BAND_MOVED = new RegExp(`^([a-z0-9-]{1,40}) (climbs|drops) from ${BAND_WORD} to ${BAND_WORD}(?: with a \\$${AMOUNT} real stake)?: (.+)$`, 's');
const RESIZED = new RegExp(`^([a-z0-9-]{1,40})'s real stake is now \\$${AMOUNT}(?: \\((Probe|Bunt|Swing|Star)\\))?: (.+)$`, 's');
export function ladderMove(event) {
  if (event?.kind !== 'lab.progress' || event.payload?.component !== 'league' || !Number.isFinite(Date.parse(event.at))) return null;
  const text = event.payload.message;
  if (typeof text !== 'string') return null;
  const moved = /^([a-z0-9-]{1,40}) (climbs|drops) from rung ([0-3]) to rung ([0-3]): (.+)$/s.exec(text);
  const banded = BAND_MOVED.exec(text);
  const resized = RESIZED.exec(text);
  const born = /^([a-z0-9-]{1,40}) is born \((.+)\)\.(?: .*)?$/s.exec(text);
  const died = /^([a-z0-9-]{1,40}) died of ([^.]+)\.(?: .*)?$/s.exec(text);
  const match = moved || banded || resized || born || died;
  if (!match || !deskId(match[1])) return null;
  const base = { id: event.id, agent: match[1], at: event.at, seq: event.seq || 0, from: null, to: null, fromBand: null, toBand: null, stake: null };
  if (moved) {
    const from = Number(moved[3]);
    const to = Number(moved[4]);
    if (moved[2] === 'climbs' ? to <= from : to >= from) return null;
    return { ...base, kind: moved[2] === 'climbs' ? 'up' : 'down', from, to, fromBand: RUNG_BANDS[from], toBand: RUNG_BANDS[to], reason: moved[5] };
  }
  if (banded) {
    const fromBand = HOUSE_BAND_WORDS[banded[3]];
    const toBand = HOUSE_BAND_WORDS[banded[4]];
    if ((banded[2] === 'climbs') !== (BAND_RANK[toBand] > BAND_RANK[fromBand]) || fromBand === toBand) return null;
    return { ...base, kind: banded[2] === 'climbs' ? 'up' : 'down', fromBand, toBand, stake: banded[5] ? banded[5].replace(/,/g, '') : null, reason: banded[6] };
  }
  if (resized) return { ...base, kind: 'size', toBand: resized[3] ? HOUSE_BAND_WORDS[resized[3]] : null, stake: resized[2].replace(/,/g, ''), reason: resized[4] };
  if (born) {
    const parent = /^a child of ([a-z0-9-]{1,40})\b/.exec(born[2])?.[1] || null;
    return { ...base, kind: 'born', parent: deskId(parent) ? parent : null, founder: /^a founding seed\b/.test(born[2]), reason: text.slice(text.indexOf(' is born ') + 9) };
  }
  return { ...base, kind: 'out', reason: text.slice(text.indexOf(' died of ') + 9) };
}
// One move told three ways (the board's trail, the desk's own record, the tape) is one move: the
// same id, or the same agent making the same kind of move to the same band within two minutes.
function distinctMoves(moves) {
  const kept = [];
  const ids = new Set();
  const recent = new Map();
  for (const move of moves) {
    if (!move?.id || !deskId(move.agent) || !Number.isFinite(Date.parse(move.at)) || ids.has(move.id)) continue;
    const key = `${move.agent}|${move.kind}|${move.toBand || ''}`;
    const at = Date.parse(move.at);
    if ((recent.get(key) || []).some(other => Math.abs(other - at) <= 120000)) continue;
    ids.add(move.id);
    recent.set(key, [...(recent.get(key) || []), at]);
    kept.push(move);
  }
  return kept;
}
// A move within one level (a new agent passing its history test and starting practice) is no
// crossing: it has no line in the moves list and no arrow over its dot.
const sameLevel = move => (move.kind === 'up' || move.kind === 'down') && levelOf(move.fromBand) === 1 && levelOf(move.toBand) === 1;

// Why a move happened, in the page's words, from a fixed set of the House's phrasings. Anything
// else says nothing: the House's own text is never shown.
const REASONS = [
  [/E (\d+\.\d+) is at or above [\d.]+ on (\d+) closed trades?/, match => `evidence ${Number(match[1]).toFixed(3)} on ${plural(Number(match[2]), 'trade')}`],
  [/cleared the screen/, () => 'passed the practice screen'],
  [/audit.*vetoed/i, () => 'the audit vetoed it'],
  [/E (\d+\.\d+) fell below/, match => `evidence fell to ${Number(match[1]).toFixed(3)}`],
  [/lost (\d+)% of its real/, match => `lost ${match[1]}% of its real stake`],
  [/passed (?:deep )?replay/, () => 'passed its history test'],
];
export function reasonWords(move) {
  if (!move) return '';
  if (move.kind === 'born') return move.parent ? `child of ${floorName(move.parent)}` : move.founder ? 'founding agent' : '';
  const text = show(move.reason);
  for (const [pattern, words] of REASONS) {
    const match = pattern.exec(text);
    if (match) return words(match);
  }
  return '';
}
// "Level 1 → 2", "born", "stake $56": what a move did, in the words of the moves list.
function moveStep(move) {
  if (move.kind === 'born') return 'born';
  if (move.kind === 'out') return 'retired';
  // A restake whose amount the checkpoint does not bear out keeps no amount (see settleStakes).
  if (move.kind === 'size') return numeric(move.stake) ? `stake ${money(move.stake, 0)}` : 'restaked';
  const from = levelOf(move.fromBand);
  const to = levelOf(move.toBand);
  if (to === null) return move.kind === 'up' ? 'promoted' : 'demoted';
  if (from === to) return move.toBand === 'star' ? 'joined the top 3' : move.fromBand === 'star' ? 'left the top 3' : 'started practice';
  return from === null ? `→ Level ${to}` : `Level ${from} → ${to}`;
}
export function moveWords(move) {
  const crossed = (move.kind === 'up' || move.kind === 'down') && levelOf(move.toBand) !== levelOf(move.fromBand);
  const stake = crossed && numeric(move.stake) && REAL_BANDS.includes(move.toBand) ? ` · ${money(move.stake, 0)}` : '';
  return `${floorName(move.agent)} · ${moveStep(move)}${stake}`;
}
const capitalized = text => (text ? text[0].toUpperCase() + text.slice(1) : text);

const moneyNumber = value => (numeric(value) ? Number(value) : null);
// Off real money the stake is null; before the allocator published one, the capital a real desk holds stands in.
const deskStake = desk => (REAL_BANDS.includes(deskBand(desk)) ? moneyNumber(desk.stake_usd) ?? moneyNumber(desk.capital_usd) : null);
// A restake that changed nothing is no move, and an agent's restakes are one line, its newest. The
// tape's amount can disagree with the checkpoint's stake, the one its coin is drawn at: that line
// then keeps no amount ("restaked"), so the page never states two stakes for one coin. `moves` is
// newest first; `stakes` maps an agent to its published stake.
export function settleStakes(moves, stakes = new Map()) {
  const last = new Map();
  const changed = new Set();
  for (const move of [...moves].reverse()) {
    if (move.kind === 'size') {
      const stake = moneyNumber(move.stake);
      const before = last.get(move.agent);
      if (stake !== null && before !== undefined && before !== null && Math.abs(before - stake) < 0.005) continue;
      changed.add(move);
      if (stake !== null) last.set(move.agent, stake);
    } else if (move.kind === 'up' || move.kind === 'down') {
      last.set(move.agent, REAL_BANDS.includes(move.toBand) ? moneyNumber(move.stake) : null);
    } else if (move.kind === 'out') last.delete(move.agent);
  }
  const sized = new Set();
  return moves.filter(move => {
    if (move.kind !== 'size') return true;
    if (!changed.has(move) || sized.has(move.agent)) return false;
    sized.add(move.agent);
    return true;
  }).map(move => {
    if (move.kind !== 'size') return move;
    const now = stakes.get(move.agent);
    const stake = moneyNumber(move.stake);
    return stake !== null && now !== undefined && now !== null && Math.abs(now - stake) > 0.01 ? { ...move, stake: null } : move;
  });
}
export function boardSnapshot(checkpoint, events = [], now = Date.now()) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && deskId(desk.id));
  const board = checkpoint?.board && typeof checkpoint.board === 'object' && !Array.isArray(checkpoint.board) ? checkpoint.board : null;
  const enabled = board?.enabled === true;
  // The board's own trail first (it names the venue and the stake), then each desk's record, then the tape.
  const recorded = [];
  for (const move of Array.isArray(board?.moves) ? board.moves : []) {
    if (!move || !bandName(move.to_band)) continue;
    const from = bandName(move.from_band) ? move.from_band : null;
    recorded.push({ id: move.id, agent: move.agent, at: move.at, seq: 0, from: null, to: null, fromBand: from, toBand: move.to_band,
      kind: from === move.to_band ? 'size' : bandUp(from, move.to_band) ? 'up' : 'down', stake: numeric(move.stake_usd) ? move.stake_usd : null,
      venue: show(move.venue), reason: show(move.reason) });
  }
  for (const desk of desks) {
    const last = desk.last_move;
    if (last && bandName(last.to_band) && last.from_band !== last.to_band) {
      recorded.push({ id: `move:${desk.id}:${last.at}`, agent: desk.id, at: last.at, seq: 0, from: null, to: null,
        fromBand: bandName(last.from_band) ? last.from_band : null, toBand: last.to_band, kind: bandUp(last.from_band, last.to_band) ? 'up' : 'down', stake: null, reason: show(last.reason) });
    }
    const life = desk.gate?.evidence?.lifecycle;
    if (!life) continue;
    const move = life.last_move;
    if (move && rungNumber(move.from_rung) && rungNumber(move.to_rung)
      && (move.decision === 'promote' ? move.to_rung > move.from_rung : move.decision === 'demote' && move.to_rung < move.from_rung)) {
      recorded.push({ id: move.id, agent: desk.id, at: move.at, kind: move.decision === 'promote' ? 'up' : 'down', from: move.from_rung, to: move.to_rung,
        fromBand: RUNG_BANDS[move.from_rung], toBand: RUNG_BANDS[move.to_rung], stake: null, reason: show(move.reason), seq: 0 });
    }
    const parent = deskId(desk.parent_id) ? desk.parent_id : null;
    if (life.born_at) recorded.push({ id: `born:${desk.id}`, agent: desk.id, at: life.born_at, kind: 'born', from: null, to: null, fromBand: null, toBand: null, stake: null, parent, founder: !desk.parent_id, reason: '', seq: 0 });
    if (life.died_at && desk.status === 'retired') recorded.push({ id: `died:${desk.id}`, agent: desk.id, at: life.died_at, kind: 'out', from: null, to: null, fromBand: null, toBand: null, stake: null, reason: show(life.cause), seq: 0 });
  }
  const moves = settleStakes(distinctMoves([...recorded, ...(Array.isArray(events) ? events : []).map(ladderMove).filter(Boolean)])
    .filter(move => Date.parse(move.at) <= now + 60000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.seq - a.seq), new Map(desks.map(desk => [desk.id, deskStake(desk)])));
  const agents = desks.map(desk => {
    const band = deskBand(desk);
    const retired = desk.status === 'retired';
    const real = REAL_BANDS.includes(band);
    const accountingIssue = desk.gate?.evidence?.accounting_ok === false;
    const evidence = desk.evidence && typeof desk.evidence === 'object' && numeric(desk.evidence.E) ? desk.evidence : null;
    const growth = evidence && numeric(evidence.W_paper) ? Number(evidence.W_paper) : null;
    const stake = deskStake(desk);
    const pnl = !accountingIssue && band !== null && band !== 'replay' ? deskPnl(desk) : null;
    const move = moves.find(item => item.agent === desk.id) || null;
    // A tape message can precede its checkpoint. Do not move the dot until the roster agrees.
    const recent = move && now - Date.parse(move.at) <= 3600000
      && (move.kind === 'out' ? retired : move.kind === 'born' ? !retired : !retired && (move.toBand === null || move.toBand === band)) ? move : null;
    const byGrowth = !real && growth !== null;
    const tone = accountingIssue ? 'flat' : byGrowth ? (growth > 1.0005 ? 'positive' : growth < 0.9995 ? 'negative' : 'flat')
      : pnl === null || Math.abs(pnl) < 0.005 ? 'flat' : pnl > 0 ? 'positive' : 'negative';
    const family = show(desk.family);
    const agent = {
      id: desk.id, name: floorName(desk.id), desk, band, level: levelOf(band), rung: rungNumber(desk.gate?.evidence?.rung) ? desk.gate.evidence.rung : null,
      retired, real, live: isLive(desk), stake, evidence, growth, pnl, tone, move, recent, accountingIssue,
      // No closed trade yet: its colour is only the drift of open positions.
      untraded: band === 'paper' && evidence !== null && Number(evidence.trades) === 0,
      venue: venueLabel(Array.isArray(desk.venues) ? show(desk.venues[0]) : ''),
      // The strategy it runs, as a small tag: what tells five agents called Huang apart.
      tag: family && !PARTNERS[family] && family !== desk.id ? humanize(family.replace(/-/g, ' ')) : '',
      progress: null,
    };
    agent.progress = levelProgress(agent, enabled);
    return agent;
  });
  const living = agents.filter(agent => !agent.retired);
  // Per band across the venues: the board's own count and capital when published, else the roster's.
  const summary = {};
  for (const bands of Object.values(board?.bands && typeof board.bands === 'object' ? board.bands : {})) {
    for (const [band, row] of Object.entries(bands && typeof bands === 'object' ? bands : {})) {
      if (!bandName(band) || !Number.isSafeInteger(row?.count)) continue;
      const entry = summary[band] || (summary[band] = { count: 0, capital: 0 });
      entry.count += row.count;
      entry.capital += moneyNumber(row.capital_usd) || 0;
    }
  }
  // Practice reads like text: the agents nearest Level 2 top left under the gate, the untested
  // middle, the losers sinking, and the newest (still on history) last. Rounding keeps a refresh
  // from reshuffling the dots over a thousandth.
  const evidenceOf = agent => (agent.evidence ? Number(agent.evidence.E) : 1);
  const practiceOrder = (a, b) => (a.band === 'replay') - (b.band === 'replay')
    || Math.round((b.progress ?? 0) * 20) - Math.round((a.progress ?? 0) * 20)
    || Math.round(evidenceOf(b) * 1000) - Math.round(evidenceOf(a) * 1000)
    || (b.growth ?? 1) - (a.growth ?? 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const realOrder = (a, b) => (b.band === 'star') - (a.band === 'star') || (b.stake ?? 0) - (a.stake ?? 0)
    || (b.progress ?? 0) - (a.progress ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const levels = LEVELS.map(row => {
    const members = living.filter(agent => row.bands.includes(agent.band)).sort(row.real ? realOrder : practiceOrder);
    const capital = row.bands.reduce((sum, band) => sum + (summary[band] ? summary[band].capital
      : members.filter(agent => agent.band === band).reduce((total, agent) => total + (agent.stake || 0), 0)), 0);
    return { ...row, agents: members, capital: row.real ? capital : null };
  });
  const throttle = board?.throttle && typeof board.throttle === 'object' && typeof board.throttle.active === 'boolean' ? board.throttle : null;
  const alive = new Map(living.map(agent => [agent.id, agent]));
  // The newest climb of the last day whose agent still sits where it arrived: what the ladder
  // shows a visitor the first time it comes into view.
  const latestClimb = moves.find(move => {
    const to = levelOf(move.toBand);
    const from = levelOf(move.fromBand);
    return move.kind === 'up' && to !== null && to >= 2 && (from === null || from < to) && now - Date.parse(move.at) <= 86400000
      && alive.get(move.agent)?.level === to;
  }) || null;
  const practice = levels.find(row => row.level === 1).agents;
  return {
    living: living.length, real: living.filter(agent => agent.real).length, levels, agents,
    unknown: living.filter(agent => agent.band === null), retired: agents.filter(agent => agent.retired),
    moves: moves.filter(move => !sameLevel(move)).slice(0, 5), throttle, enabled, latestClimb,
    ready: living.filter(agent => agent.progress !== null && agent.progress >= 1).sort((a, b) => b.level - a.level)[0] || null,
    closest: practice.reduce((best, agent) => (agent.progress !== null && agent.progress >= ARC_MIN && (!best || agent.progress > best.progress) ? agent : best), null),
    publishedAt: checkpoint?.published_at || null, stale: !floorRunning(checkpoint, now),
  };
}

const MOVE_MARK = { up: '↑', down: '↓', born: '✦', out: '×', size: '±' };
const MOVE_LABEL = { up: 'promoted', down: 'demoted', born: 'born', out: 'retired', size: 'restaked' };
// "+1.2%", "−0.16%": practice growth, the number that colours the dot.
const growthText = value => {
  const change = (value - 1) * 100;
  const size = Math.abs(change);
  return `${change > 0 ? '+' : change < 0 ? '−' : ''}${size >= 0.1 || size === 0 ? size.toFixed(1) : size.toFixed(2)}%`;
};
// Where an agent stands, as parts: [text, tone]. The readout colours the money; a label reads it.
function standing(agent) {
  const pnl = agent.pnl === null ? null : signedMoney(agent.pnl.toFixed(2), 2);
  const tone = agent.pnl === null ? '' : signOf(agent.pnl.toFixed(2));
  const book = agent.real || (agent.band === null && agent.live) ? 'real' : 'practice';
  const result = agent.accountingIssue ? [['accounting under review', '']] : pnl ? [[`${pnl} ${book}`, tone]] : [];
  const evidence = agent.evidence;
  if (agent.retired || agent.band === null) return result;
  if (agent.band === 'replay') return [['new', ''], ['tested on history, not trading yet', '']];
  if (agent.real) {
    return [...(agent.stake === null ? [] : [[`${money(agent.stake.toFixed(2), 2)} stake`, '']]), ...result,
      ...(evidence && Number.isSafeInteger(evidence.real_trades) ? [[plural(evidence.real_trades, 'real trade'), '']] : [])];
  }
  if (!evidence) return result;
  // Practice reads by its growth, the number that colours the dot; under review, it reads by nothing.
  const growth = agent.growth === null || agent.accountingIssue || (agent.untraded && agent.growth === 1) ? []
    : [[`practice ${growthText(agent.growth)}`, agent.tone === 'flat' ? '' : agent.tone]];
  const review = agent.accountingIssue ? result : [];
  if (agent.untraded) return [['no closed trades yet', ''], ...growth, ...review];
  return [...growth, ...(Number.isSafeInteger(evidence.trades) ? [[plural(evidence.trades, 'trade'), '']] : []), ...review];
}
const nextLevel = agent => NEXT_LEVEL[agent.band]?.level ?? null;
const progressShort = agent => (agent.progress === null ? '' : agent.progress >= 1 ? `ready for Level ${nextLevel(agent)}` : `${Math.floor(agent.progress * 100)}% to Level ${nextLevel(agent)}`);
// "62% to Level 2 · evidence 1.006 of 1.01 · 4 of 5 trades": the readout's line under its bar.
export function progressWords(agent) {
  if (agent?.progress === null || agent?.progress === undefined) return '';
  const rule = NEXT_LEVEL[agent.band];
  const count = Number.isSafeInteger(agent.evidence[rule.count]) ? agent.evidence[rule.count] : 0;
  const unit = rule.count === 'real_trades' ? 'real trade' : 'trade';
  const trades = count >= rule.trades ? plural(count, unit) : `${count} of ${rule.trades} ${unit}s`;
  const below = rule.belowEven && !(numeric(agent.evidence.W_real) && Number(agent.evidence.W_real) >= 1) ? ' · real results below even' : '';
  return `${capitalized(progressShort(agent))} · evidence ${Number(agent.evidence.E).toFixed(3)} of ${rule.evidence} · ${trades}${below}`;
}
// The record behind one dot, in one line: where it sits, its venue, its money, how near the next level.
export function agentWords(agent) {
  const parts = [agent.retired ? 'Retired' : bandLabel(agent.band)];
  if (!agent.retired && agent.band === 'star') parts.push('top 3 earner');
  if (agent.venue) parts.push(agent.venue);
  parts.push(...standing(agent).map(([text]) => text), progressShort(agent));
  return join(...parts);
}
// The line a move leaves in the readout: "↑ Level 1 → 2 · 28 min ago · evidence 1.016 on 7 trades".
function moveRecord(move) {
  const reason = reasonWords(move);
  return `${MOVE_MARK[move.kind]} ${capitalized(moveStep(move))} · ${ago(move.at)}${reason ? ` · ${reason}` : ''}`;
}
// A readout line that breaks only between its phrases, never inside "of 1.01", "4 of 5 trades" or "2 h ago".
function phrases(text, className = null) {
  const line = element('span', null, className);
  text.split(' · ').forEach((part, index) => line.append(...(index ? [element('span', ' · ')] : []), element('span', part, 'board-phrase')));
  return line;
}
function recordNodes(agent) {
  const head = element('span', null, 'board-detail-head');
  head.append(element('strong', agent.name), ...(agent.venue ? [element('span', agent.venue)] : []), ...(agent.tag ? [element('span', agent.tag, 'strategy-tag')] : []));
  const line = element('span', null, 'board-detail-line');
  const parts = [[agent.retired ? 'Retired' : bandLabel(agent.band), ''], ...(!agent.retired && agent.band === 'star' ? [['top 3 earner', '']] : []), ...standing(agent)];
  parts.forEach(([text, tone], index) => line.append(...(index ? [element('span', ' · ')] : []), element('span', text, tone ? `${tone} board-phrase` : 'board-phrase')));
  const nodes = [head, line];
  if (agent.progress !== null) {
    const progress = element('span', null, 'board-detail-progress');
    const bar = element('span', null, 'board-xp');
    bar.setAttribute('aria-hidden', 'true');
    place(bar, { '--p': String(agent.progress) });
    progress.append(bar, phrases(progressWords(agent)));
    nodes.push(progress);
  }
  if (agent.move) nodes.push(phrases(moveRecord(agent.move), `board-detail-move board-detail-${agent.move.kind}`));
  return nodes;
}
function hintText(model) {
  if (!model.living) return 'No agent is competing yet.';
  if (model.ready) return `Tap any dot. Ready for Level ${nextLevel(model.ready)}: ${model.ready.name}.`;
  if (model.closest) return `Tap any dot. Closest to Level 2: ${model.closest.name}.`;
  return 'Tap any dot to see its agent.';
}
// The legend names only what the board is showing.
function legendNode(model) {
  const all = model.levels.flatMap(row => row.agents);
  const keys = [
    [all.some(agent => agent.tone === 'positive'), 'up', 'Up'],
    [all.some(agent => agent.tone === 'negative'), 'down', 'Down'],
    // A grey disc (or coin) is an agent that has traded and stands level, or whose accounts are under review.
    [all.some(agent => agent.tone === 'flat' && agent.band !== 'replay' && !agent.untraded), 'flat', 'Flat'],
    [all.some(agent => agent.untraded), 'open', 'No trades yet'],
    [all.some(agent => agent.progress !== null && agent.progress >= ARC_MIN), 'arc', 'Toward next level'],
    [all.some(agent => agent.band === 'star'), 'medal', 'Top 3'],
  ].filter(([shown]) => shown);
  if (!keys.length) return null;
  const legend = element('div', null, 'board-legend');
  for (const [, kind, text] of keys) {
    const key = element('span', null, 'board-key');
    const swatch = element('i', null, `board-swatch board-swatch-${kind}`);
    swatch.setAttribute('aria-hidden', 'true');
    key.append(swatch, element('span', text));
    legend.append(key);
  }
  return legend;
}
// Arrow keys walk a floor: left and right one dot, Home and End to its ends, up and down a row of
// `cols`. An answer below 0 leaves for the floor above; one at `count` or more for the floor below.
export function nextIndex(key, index, count, cols = 1) {
  const last = count - 1;
  const step = Math.max(1, Math.round(cols) || 1);
  if (key === 'ArrowLeft') return Math.max(0, index - 1);
  if (key === 'ArrowRight') return Math.min(last, index + 1);
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (key === 'ArrowUp') return index - step >= 0 ? index - step : -1;
  if (key === 'ArrowDown') {
    if (index + step <= last) return index + step;
    return Math.floor(index / step) < Math.floor(last / step) ? last : count;
  }
  return index;
}

const reducedMotion = () => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
const EASE = 'cubic-bezier(.2, .7, .2, 1)';
const centre = box => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
// A colour token as the Web Animations API needs it: resolved, not a var().
const token = (node, name) => { try { return getComputedStyle(node).getPropertyValue(name).trim() || 'currentColor'; } catch { return 'currentColor'; } };
// Where every dot stood before a redraw, and how big it looked, so a move can glide.
function barPlaces(container) {
  const places = new Map();
  try {
    for (const node of container?.querySelectorAll?.('[data-agent]') || []) {
      places.set(node.getAttribute('data-agent'), { ...centre(node.getBoundingClientRect()), size: Number(node.getAttribute('data-size')) || 12 });
    }
  } catch { /* no layout here */ }
  return places;
}
// A crossing: from where the dot stood, through the gate between the floors, growing (or
// shrinking) into what it is now; then a ripple, the gate's flash and, for a coin, its rim sweeping shut.
function travel(node, from, gate, up, { fade = false } = {}) {
  const box = node.getBoundingClientRect();
  const to = centre(box);
  const size = Number(node.getAttribute('data-size')) || 12;
  const door = gate ? centre(gate.getBoundingClientRect()) : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const start = (from.size || size) / size;
  const middle = (start + 1) / 2;
  const at = (point, scale) => `translate(${(point.x - to.x).toFixed(1)}px, ${(point.y - to.y).toFixed(1)}px) scale(${scale.toFixed(3)})`;
  const duration = fade ? 1300 : 1100;
  const through = fade ? 0.5 : 0.45;
  node.animate([
    { offset: 0, transform: at(from, start), opacity: fade ? 0 : 1, zIndex: 3 },
    ...(fade ? [{ offset: 0.15, transform: at(from, start), opacity: 1, zIndex: 3 }] : []),
    { offset: through, transform: at(door, middle), opacity: 1, zIndex: 3 },
    { offset: 1, transform: 'none', opacity: 1, zIndex: 3 },
  ], { duration, easing: EASE });
  if (up && node.className.includes('board-coin')) {
    node.animate([{ '--rim': '0' }, { offset: duration / (duration + 400), '--rim': '0' }, { '--rim': '1' }], { duration: duration + 400 });
  }
  // The ripple and the gate's flash are animations, not classes: each press plays them again, and
  // nothing is held once they end (a held ripple would hide the selection ring and the medal).
  node.animate([{ boxShadow: `0 0 0 0 ${token(node, up ? '--accent' : '--negative')}` }, { boxShadow: '0 0 0 14px transparent' }],
    { duration: 1200, delay: duration, easing: 'ease-out' });
  if (gate && typeof gate.animate === 'function') {
    const rest = { color: token(gate, '--real-line'), transform: 'translateX(-50%) scale(1)' };
    gate.animate([rest, { offset: 0.25, color: token(gate, '--accent'), transform: 'translateX(-50%) scale(1.7)' }, rest],
      { duration: 600, delay: Math.max(0, Math.round(duration * through) - 150), easing: 'ease-out' });
  }
}
// Every dot glides from where it stood to where the new roster puts it; a dot that changed level
// travels through the gate, and a ring that grew fills in.
function glide(container, before, seen, model) {
  if (!model || reducedMotion()) return;
  try {
    const agents = new Map(model.agents.map(agent => [agent.id, agent]));
    const gates = new Map([...container.querySelectorAll('[data-gate]')].map(gate => [gate.getAttribute('data-gate'), gate]));
    for (const node of container.querySelectorAll('[data-agent]')) {
      if (typeof node.animate !== 'function') continue;
      const id = node.getAttribute('data-agent');
      const agent = agents.get(id);
      const was = seen.get(id);
      const old = before.get(id);
      if (was && agent && was.progress !== null && agent.progress !== null && Math.abs(was.progress - agent.progress) > 0.001) {
        node.animate([{ '--p': String(was.progress) }, { '--p': String(agent.progress) }], { duration: 800, easing: 'ease-out' });
      }
      if (!old) continue;
      if (was && agent && !was.retired && !agent.retired && was.level !== null && agent.level !== null && was.level !== agent.level) {
        travel(node, old, gates.get(String(Math.max(was.level, agent.level))), agent.level > was.level);
        continue;
      }
      const to = centre(node.getBoundingClientRect());
      const scale = old.size / (Number(node.getAttribute('data-size')) || 12);
      const dx = old.x - to.x;
      const dy = old.y - to.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.02) continue;
      node.animate([{ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(3)})` }, { transform: 'none' }],
        { duration: Math.abs(dy) > 60 ? 700 : 450, easing: EASE });
    }
  } catch { /* no layout here */ }
}
// Only a level crossing replays, and only while its agent still sits on the level it reached: a
// restake, a birth or an exit has no floor to come from, and must never be drawn as a drop.
export function replayable(move, agent) {
  if (!move || !agent || agent.retired || (move.kind !== 'up' && move.kind !== 'down')) return false;
  const to = levelOf(move.toBand);
  return to !== null && to === agent.level && levelOf(move.fromBand) !== to;
}
// Replays one crossing: the dot appears in the top row of the floor it left and climbs (or drops)
// through the gate to where it sits now. For the first view of the ladder and a pressed move.
function replayMove(container, move) {
  if (reducedMotion() || !move || !deskId(move.agent) || (move.kind !== 'up' && move.kind !== 'down')) return false;
  try {
    const node = container.querySelector(`[data-agent="${move.agent}"]`);
    const to = levelOf(move.toBand);
    const from = levelOf(move.fromBand) ?? (move.kind === 'up' ? to - 1 : to + 1);
    const floor = container.querySelector(`.board-level-${from} .board-dots`);
    if (!node || !floor || typeof node.animate !== 'function' || !to || from === to) return false;
    const box = floor.getBoundingClientRect();
    travel(node, { x: box.left + box.width / 2, y: box.top + 12, size: 12 }, container.querySelector(`[data-gate="${Math.max(from, to)}"]`), to > from, { fade: true });
    return true;
  } catch { return false; }
}

function boardPanel(checkpoint, state) {
  if (!checkpoint) return [element('p', 'Waiting for the agent roster.', 'empty-state')];
  const model = boardSnapshot(checkpoint, state.ladderEvents);
  state.ladderModel = model;
  const seen = state.ladderSeen || new Map();
  const panel = element('div', null, 'board');
  const caption = element('div', null, 'board-caption');
  caption.append(element('span', `${model.living} competing · ${model.real} on real money`), element('span', model.stale ? 'Last known positions · data stale' : 'Updates live', model.stale ? 'negative' : ''));
  panel.append(caption);
  const legend = legendNode(model);
  if (legend) panel.append(legend);
  if (model.throttle?.active) {
    panel.append(element('p', `Throttle on: every real stake is halved while the floor is ${signedMoney(model.throttle.floor_pnl_usd, 2)} on ${money(model.throttle.envelope_usd, 0)}.`, 'board-throttle negative'));
  }
  const detail = element('p', null, 'board-detail');
  detail.setAttribute('role', 'status');
  detail.setAttribute('aria-live', 'polite');
  const dots = new Map();
  const groups = [];
  // One tab stop per floor: the selected dot when it is on that floor, else the first.
  const rove = (group, button) => { for (const item of group.buttons) item.setAttribute('tabindex', item === button ? '0' : '-1'); };
  function select(agent, note = '') {
    state.ladderSelected = agent.id;
    const entry = dots.get(agent.id);
    for (const item of dots.values()) item.button.setAttribute('aria-pressed', item === entry ? 'true' : 'false');
    if (entry) rove(entry.group, entry.button);
    detail.replaceChildren(...(note ? [phrases(note, 'board-detail-line')] : recordNodes(agent)));
  }
  function clear() {
    state.ladderSelected = null;
    state.ladderNote = null;
    for (const item of dots.values()) item.button.setAttribute('aria-pressed', 'false');
    detail.replaceChildren(element('span', hintText(model), 'board-detail-hint'));
  }
  // The first view's replay labels its readout for a few seconds, across redraws; a visitor's own
  // choice ends it at once.
  state.ladderSelect = (id, note) => {
    const entry = dots.get(id);
    if (!entry) return;
    state.ladderNote = { id, note, until: Date.now() + 12000 };
    select(entry.agent, note);
  };
  const choose = agent => { state.ladderNote = null; select(agent); };
  // The first sight of a move marks it once: a rise for a birth, a fade for an exit, a solid ring
  // for a new agent starting practice, a ripple for a crossing. Live crossings travel instead (glide).
  function motion(agent) {
    const was = seen.get(agent.id);
    if (was) {
      if (!was.retired && agent.retired) return ' board-dying';
      return was.band === 'replay' && agent.band === 'paper' ? ' board-settling' : '';
    }
    if (seen.size) return agent.retired ? '' : ' board-born';
    const move = agent.recent;
    if (!move || state.ladderAnimated.has(move.id)) return '';
    state.ladderAnimated.add(move.id);
    if (move.kind === 'born') return ' board-born';
    if (move.kind === 'out') return ' board-dying';
    if (sameLevel(move)) return ' board-settling';
    return move.kind === 'down' ? ' board-arriving-down' : ' board-arriving';
  }
  function dotFor(agent, kind, group) {
    const coin = kind === 'coin';
    const classes = [coin ? 'board-coin' : 'board-dot'];
    if (kind === 'retired') classes.push('board-dot-retired', agent.pnl !== null && agent.pnl <= -0.005 ? 'negative' : 'flat');
    else if (kind === 'unknown') classes.push('board-dot-unknown', 'flat');
    else {
      classes.push(agent.tone);
      if (agent.band === 'replay') classes.push('board-dot-new');
      else if (agent.untraded) classes.push('board-dot-untraded');
      if (agent.band === 'star') classes.push('board-coin-star');
      if (agent.progress !== null && agent.progress >= ARC_MIN) classes.push('board-arc');
    }
    const recent = agent.recent && !sameLevel(agent.recent) ? agent.recent : null;
    const marked = recent && recent.kind !== 'out' && kind !== 'retired';
    if (marked) classes.push(`board-move-${recent.kind}`);
    const button = element('button', null, classes.join(' ') + motion(agent));
    button.type = 'button';
    button.setAttribute('data-agent', agent.id);
    button.setAttribute('aria-pressed', 'false');
    const label = `${agent.name} · ${agentWords(agent)}${recent ? ` · recently ${MOVE_LABEL[recent.kind]}` : ''}`;
    // No title: hover already fills the readout, and a tooltip would cover the neighbouring dots.
    button.setAttribute('aria-label', label);
    const size = coin ? coinSize(agent.stake) : kind === 'retired' ? 8 : 12;
    button.setAttribute('data-size', String(size));
    const style = agent.progress === null ? {} : { '--p': String(agent.progress) };
    if (coin) Object.assign(style, { width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(11, Math.round(size * 0.42))}px` });
    place(button, style);
    if (coin) {
      const glyph = element('span', agent.tone === 'positive' ? '+' : agent.tone === 'negative' ? '−' : '·', 'board-glyph');
      glyph.setAttribute('aria-hidden', 'true');
      button.append(glyph);
    }
    button.append(element('span', agent.name, 'board-name'));
    if (marked) {
      const mark = element('span', MOVE_MARK[recent.kind], `board-mark board-mark-${recent.kind}`);
      mark.setAttribute('aria-hidden', 'true');
      button.append(mark);
    }
    button.addEventListener('click', () => choose(agent));
    // A redraw puts focus back where it was; that is not a visitor choosing, so it selects nothing.
    button.addEventListener('focus', () => {
      if (state.ladderRefocusing) { rove(group, button); return; }
      if (state.ladderSelected !== agent.id || !state.ladderNote) choose(agent);
    });
    button.addEventListener('mouseenter', () => { if (finePointer()) choose(agent); });
    dots.set(agent.id, { agent, button, group });
    return button;
  }
  // How many dots the floor's first row holds, from the layout; 1 where there is none.
  function columns(group) {
    try {
      const row = centre(group.buttons[0].getBoundingClientRect()).y;
      let count = 0;
      for (const button of group.buttons) { if (Math.abs(centre(button.getBoundingClientRect()).y - row) > 2) break; count += 1; }
      return count || 1;
    } catch { return 1; }
  }
  function nearest(list, from, index) {
    try {
      const origin = centre(from.getBoundingClientRect());
      let best = null;
      let distance = Infinity;
      for (const button of list) {
        const point = centre(button.getBoundingClientRect());
        const gap = Math.hypot(point.x - origin.x, point.y - origin.y);
        if (gap < distance) { best = button; distance = gap; }
      }
      if (best) return best;
    } catch { /* no layout here */ }
    return list[Math.min(index, list.length - 1)];
  }
  function keyed(event, group) {
    if (event.key === 'Escape') { clear(); return; }
    const index = group.buttons.indexOf(event.target);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault?.();
    const next = nextIndex(event.key, index, group.buttons.length, columns(group));
    const other = next < 0 ? groups[groups.indexOf(group) - 1] : next >= group.buttons.length ? groups[groups.indexOf(group) + 1] : group;
    if (!other) return;
    const target = other === group ? group.buttons[next] : nearest(other.buttons, event.target, index);
    target?.focus?.();
  }
  function groupNode(members, kind, label) {
    const node = element('div', null, `board-dots board-dots-${kind}`);
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', label);
    const group = { node, buttons: [] };
    for (const agent of members) {
      const button = dotFor(agent, kind, group);
      group.buttons.push(button);
      node.append(button);
    }
    if (!members.length) node.append(element('span', 'No one yet', 'board-vacant'));
    else {
      groups.push(group);
      rove(group, group.buttons[0]);
      node.addEventListener('keydown', event => keyed(event, group));
    }
    return node;
  }
  const floors = element('div', null, 'board-floors');
  for (const row of model.levels) {
    const lane = element('div', null, `board-lane board-level-${row.level}${row.real ? ' board-lane-real' : ''}`);
    // The gate on a floor's top edge is the way up into the next level.
    if (row.level < 3) {
      // A notch in the floor line, not a circle: it marks the way up and is not a control.
      const gate = element('span', '▲', 'board-gate');
      gate.setAttribute('aria-hidden', 'true');
      gate.setAttribute('data-gate', String(row.level + 1));
      lane.append(gate);
    }
    const count = row.agents.length;
    const capital = row.real && row.capital > 0 ? money(row.capital.toFixed(2), 0) : '';
    const head = element('div', null, 'board-lane-head');
    head.append(element('span', `Level ${row.level}`, 'board-level-name'), element('span', row.word, 'board-level-word'),
      element('span', capital ? `${count} · ${capital} real` : String(count), 'board-level-sum'));
    lane.append(head, groupNode(row.agents, row.real ? 'coin' : 'dot', `Level ${row.level}, ${row.word}: ${plural(count, 'agent')}${capital ? `, ${capital} real` : ''}`));
    floors.append(lane);
  }
  for (const [members, name, kind] of [[model.retired, 'Retired', 'retired'], [model.unknown, 'Level unknown', 'unknown']]) {
    if (!members.length) continue;
    const strip = element('div', null, `board-lane board-exits board-exits-${kind}`);
    const head = element('div', null, 'board-lane-head');
    head.append(element('span', name, 'board-level-name'), element('span', String(members.length), 'board-level-sum'));
    strip.append(head, groupNode(members, kind, `${name}: ${plural(members.length, 'agent')}`));
    floors.append(strip);
  }
  panel.append(floors, detail);
  const chosen = dots.get(state.ladderSelected);
  const note = state.ladderNote && state.ladderNote.id === state.ladderSelected && Date.now() < state.ladderNote.until ? state.ladderNote.note : '';
  if (chosen) select(chosen.agent, note); else clear();
  if (model.moves.length) {
    const trail = element('ol', null, 'board-moves');
    trail.setAttribute('aria-label', 'Latest moves, newest first');
    for (const move of model.moves) {
      const target = dots.get(move.agent);
      const change = element(target ? 'button' : 'div', null, `board-change board-change-${move.kind}`);
      const mark = element('span', MOVE_MARK[move.kind], 'board-change-mark');
      mark.setAttribute('aria-hidden', 'true');
      const when = element('time', ago(move.at), 'board-change-time');
      when.dateTime = move.at;
      change.append(mark, element('span', moveWords(move), 'board-change-text'), when);
      if (target) {
        change.type = 'button';
        change.setAttribute('data-move', move.id);
        change.setAttribute('aria-label', `Show ${moveWords(move)}, ${ago(move.at)}`);
        // Pressing a move shows its agent, and a crossing that still stands plays again.
        change.addEventListener('click', () => {
          choose(target.agent);
          if (replayable(move, target.agent)) state.replayMove?.(move);
        });
      }
      const item = element('li');
      item.append(change);
      trail.append(item);
    }
    panel.append(trail);
  }
  return [panel];
}

async function startFloor(root) {
  const find = id => root.querySelector(`#${id}`);
  const box = {
    numbers: find('floor-numbers'), status: find('floor-status'), now: find('floor-now'), feed: find('floor-feed'),
    portfolio: find('floor-portfolio'), practiceSwitch: find('floor-practice'), positions: find('floor-positions'), closed: find('floor-closed'),
    improvement: find('floor-improvement'),
  };
  const state = {
    checkpoint: null, liveIds: new Set(), desks: new Map(), feed: [], outcomes: [], marks: [], mode: 'loading',
    hero: null, rendered: new Set(), primed: false, expanded: new Set(), open: new Set(), practice: false, more: false, clock: null,
    ladderEvents: [], ladderSelected: null, ladderAnimated: new Set(), ladderSeen: new Map(), ladderModel: null,
    ladderRatio: 0, ladderIntro: false, ladderPings: new Map(), ladderPinging: 0,
  };
  const ready = node => node && node.setAttribute('aria-busy', 'false');
  const drawn = (node, children) => { if (!node) return; node.replaceChildren(...children); ready(node); };
  const drawStatus = () => {
    if (!box.status) return;
    // One word beside one dot: green and pulsing when the floor is live, red when it is stopped.
    const live = state.mode === 'live' || state.mode === 'polling';
    // Stopped is what the checkpoints say, on the real floor and on a test tape alike: none yet,
    // or none lately. While they keep arriving the dot follows the transport.
    const stopped = !floorRunning(state.checkpoint);
    const text = stopped ? 'stopped' : live ? 'live' : 'connecting';
    box.status.className = `live-status ${stopped ? 'live-stopped' : live ? 'live-live' : 'live-idle'}`;
    // A status region re-announces whatever replaces it, so it changes only when the words do.
    if (state.statusText === text) return;
    state.statusText = text;
    box.status.replaceChildren(pulse(), element('span', text));
  };
  state.drawFeed = () => { if (box.feed) { drawFeedInto(box.feed, state); ready(box.feed); } };
  const drawLive = () => { if (box.now) { drawHeroInto(box.now, state); ready(box.now); } state.drawFeed(); };
  // The switch counts what both tables hold, so it is drawn again with either of them.
  const drawSwitch = () => {
    const node = box.practiceSwitch;
    if (!node || !state.checkpoint) return;
    const focused = Boolean(document.activeElement && node.contains?.(document.activeElement));
    drawn(node, practiceSwitch(state));
    if (focused) state.focusSwitch();
  };
  // A keyboard user who pressed the switch keeps their place on it after both tables redraw.
  state.focusSwitch = () => { try { box.practiceSwitch?.querySelector?.('button')?.focus?.({ preventScroll: true }); } catch { /* no focus here */ } };
  state.drawPositions = () => { if (state.checkpoint) { drawn(box.positions, positionsPanel(state.checkpoint, state)); drawSwitch(); } };
  state.drawClosed = () => { if (state.checkpoint) { drawn(box.closed, closedPanel(state)); drawSwitch(); } };
  const drawPortfolio = () => {
    if (!state.checkpoint) return;
    drawn(box.portfolio, portfolioPanel(state.checkpoint, state.marks));
    drawn(box.numbers, numbersPanel(state.checkpoint, state));
  };
  const keepFeed = events => {
    const byId = new Map([...state.feed, ...events].map(event => [event.id, event]));
    state.feed = [...byId.values()].sort((left, right) => (Number(right.seq) || 0) - (Number(left.seq) || 0)).slice(0, 400);
  };
  const keepLadder = events => {
    const byId = new Map([...state.ladderEvents, ...events.filter(event => ladderMove(event))].map(event => [event.id, event]));
    state.ladderEvents = [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (b.seq || 0) - (a.seq || 0)).slice(0, MAX_EVENT_LIMIT);
  };
  // Once a visit, when the ladder first comes into view, its newest climb plays again, labelled as
  // a replay so it never reads as something happening now.
  const introduce = () => {
    const model = state.ladderModel;
    if (state.ladderIntro || !state.ladderReady || !model || state.ladderRatio < 0.4 || document.visibilityState === 'hidden') return;
    state.ladderIntro = true;
    // A visitor who already chose an agent keeps it: the replay never takes a selection away.
    if (state.ladderSelected) return;
    const move = model.latestClimb;
    if (model.stale || !move || !replayMove(box.improvement, move)) return;
    state.ladderSelect?.(move.agent, `Latest climb · ${moveWords(move)} · ${ago(move.at)}`);
  };
  const drawLadder = state.drawLadder = () => {
    const active = document.activeElement;
    const focused = active?.getAttribute?.('data-agent');
    const pressed = active?.getAttribute?.('data-move');
    // Every dot glides from where it stood to where the new roster puts it.
    const before = barPlaces(box.improvement);
    const seen = state.ladderSeen;
    drawn(box.improvement, boardPanel(state.checkpoint, state));
    glide(box.improvement, before, seen, state.ladderModel);
    if (state.checkpoint && state.ladderModel) {
      state.ladderSeen = new Map(state.ladderModel.agents.map(agent => [agent.id, { band: agent.band, level: agent.level, retired: agent.retired, progress: agent.progress }]));
    }
    // A polling redraw must not strand a keyboard user on the document body, nor change what they chose.
    state.ladderRefocusing = true;
    try {
      if (deskId(focused)) box.improvement?.querySelector(`[data-agent="${focused}"]`)?.focus({ preventScroll: true });
      else if (pressed) [...(box.improvement?.querySelectorAll?.('[data-move]') || [])].find(node => node.getAttribute('data-move') === pressed)?.focus({ preventScroll: true });
    } catch { /* no focus here */ } finally { state.ladderRefocusing = false; }
    introduce();
  };
  state.replayMove = move => replayMove(box.improvement, move);
  // A thought, a research call or a fill sends one faint ring out from its agent's dot: at most one
  // per agent every eight seconds and four at once, and none while the ladder is out of sight.
  state.pingAgent = (id, kind) => {
    const now = Date.now();
    if (!deskId(id) || state.ladderRatio <= 0 || document.hidden || reducedMotion() || state.ladderModel?.stale !== false) return;
    if (now - (state.ladderPings.get(id) || 0) < 8000 || state.ladderPinging >= 4) return;
    const node = box.improvement?.querySelector?.(`[data-agent="${id}"]`);
    if (!node || node.className.includes('board-dot-retired')) return;
    state.ladderPings.set(id, now);
    state.ladderPinging += 1;
    const ring = element('span', null, `board-ping board-ping-${kind}`);
    ring.setAttribute('aria-hidden', 'true');
    node.append(ring);
    setTimeout(() => { ring.remove?.(); state.ladderPinging -= 1; }, 750);
  };
  if (typeof IntersectionObserver === 'function' && box.improvement) {
    try {
      const watcher = new IntersectionObserver(entries => {
        for (const entry of entries) state.ladderRatio = entry.isIntersecting ? entry.intersectionRatio : 0;
        introduce();
      }, { threshold: [0, 0.4] });
      watcher.observe(box.improvement);
      state.unwatch = () => watcher.disconnect();
    } catch { /* no observer here */ }
  }
  async function refresh() {
    try {
      state.checkpoint = await loadCheckpoint();
      try { state.marks = await loadHistory(); } catch { /* Keep the last verified history during an outage. */ }
      const desks = orderDesks(state.checkpoint.desks).filter(desk => desk && typeof desk === 'object');
      state.desks = new Map(desks.map(desk => [show(desk.id), desk]));
      state.liveIds = new Set(desks.filter(isLive).map(desk => show(desk.id)));
      drawPortfolio();
      state.drawPositions();
      drawLadder();
      state.drawClosed();
      if (state.primed) drawLive();
    } catch {
      if (state.checkpoint) return;
      // Nothing published yet, or the floor cannot be reached: the two numbers keep their dashes
      // and every section says plainly that it is empty.
      ready(box.numbers);
      drawn(box.portfolio, [element('p', 'No balance has been published yet.', 'empty-state')]);
      drawn(box.positions, [element('p', 'No position is open.', 'empty-state')]);
      drawn(box.closed, [element('p', 'No trade has closed yet.', 'empty-state')]);
      drawn(box.improvement, [element('p', 'Waiting for the agent roster.', 'empty-state')]);
    } finally {
      state.asked = true;
      // Every refresh re-reads the status, the ones that fail too: a fresh checkpoint turns the
      // word to live, and the last one held turns it to stopped once it is older than the window.
      drawStatus();
    }
  }
  await refresh();
  const loads = [
    { kind: 'desk.thought', limit: 60 }, { kind: 'desk.tool_call', limit: 100 }, { kind: 'broker.fill', limit: 60 },
    { kind: 'desk.session_ended', limit: 40 }, { kind: 'desk.outcome', limit: MAX_EVENT_LIMIT },
    { stream: 'ops', kind: 'floor.mark', limit: MAX_EVENT_LIMIT }, { kind: 'lab.progress', limit: MAX_EVENT_LIMIT },
  ];
  const [thoughts, calls, fills, endings, outcomes, marks, progress] = await Promise.all(loads.map(query => loadEvents(query).catch(() => ({ events: [] }))));
  keepFeed([...thoughts.events, ...calls.events, ...fills.events, ...endings.events, ...outcomes.events.slice(0, 40), ...progress.events]);
  state.outcomes = outcomes.events;
  keepLadder(progress.events);
  drawLadder();
  if (!state.marks.length) state.marks = marks.events;
  drawLive();
  drawPortfolio();
  state.drawClosed();
  // The sections above the ladder have filled in; once the layout has settled, the ladder's first
  // view can be told apart from a page that was briefly short while it loaded.
  state.ladderSettle = setTimeout(() => { state.ladderReady = true; introduce(); }, 1200);
  state.ladderSettle?.unref?.();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  // A tab that was hidden asked for nothing meanwhile: it asks the moment it is looked at again,
  // so the status is never read off a checkpoint that is only old because the page was away.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  // The running clock ticks in the browser between checkpoints.
  setInterval(() => {
    if (!state.clock) return;
    const parts = selfImprovingParts(Math.max(0, (Date.now() - state.clock.startedAt) / 1000));
    state.clock.main.textContent = parts.main;
    state.clock.tick.textContent = parts.tick;
  }, 1000);
  const loaded = [thoughts, calls, fills, endings, outcomes, marks, progress].flatMap(batch => batch.events);
  const feed = startFeed({
    streams: ['all'],
    onStatus: mode => { state.mode = mode; drawStatus(); },
    onEvents: events => {
      const live = events.filter(event => FEED_KINDS.includes(event.kind) || event.kind === 'desk.session_ended');
      const closed = events.filter(event => event.kind === 'desk.outcome');
      const balance = events.filter(event => event.kind === FLOOR_MARK.kind);
      const changes = events.filter(event => ladderMove(event));
      if (live.length) { keepFeed(live); drawLive(); }
      for (const event of events) {
        const kind = PING_KINDS[event.kind];
        if (kind) state.pingAgent(streamDeskOf(event.stream) || show(event.payload?.desk_id), kind);
      }
      if (closed.length) { state.outcomes = [...closed, ...state.outcomes].slice(0, MAX_EVENT_LIMIT); state.drawClosed(); }
      if (balance.length) { state.marks = [...state.marks, ...balance]; drawPortfolio(); }
      if (changes.length) {
        keepLadder(changes);
        drawLadder();
        refresh();
        // The House posts the checkpoint just after the events that announce it, so ask again once
        // it has landed: the bar crosses lanes within seconds of the move, not at the next poll.
        clearTimeout(state.followUp);
        state.followUp = setTimeout(() => { refresh().catch(() => {}); }, 6000);
        state.followUp?.unref?.();
      }
    },
  });
  feed.remember(loaded);
  feed.prime(loaded.reduce((most, event) => Math.max(most, Number(event.seq) || 0), 0));
  return { ...feed, stop() { clearTimeout(state.followUp); clearTimeout(state.ladderSettle); state.unwatch?.(); feed.stop(); } };
}

export function startCapital(root = document.querySelector('[data-capital]')) {
  if (!root) return Promise.resolve(null);
  return startFloor(root);
}
if (typeof document !== 'undefined' && document.querySelector('[data-capital]')) startCapital();
