import { MAX_EVENT_LIMIT, deskId, isLive, validCheckpoint, validPublicEvent, socketMatches, tapeName } from './schema.js';

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
  const table = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
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
// One live line, or null for everything the floor page does not show.
export function feedLine(event, liveIds = new Set()) {
  if (!event || !FEED_KINDS.includes(event.kind)) return null;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
  if (event.kind === 'lab.progress') {
    const text = plainThought(payload.message);
    const execution = payload.component === 'execution';
    // The rebuilt runtime's research loop speaks as the League; the first run's spoke as the
    // Foundry, and its execution heartbeat as Execution. Testing or learning is said by `stage`.
    const league = payload.component === 'league';
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
const FEED_LABELS = { thinking: 'thinking', researching: 'researching', trading: 'trading', testing: 'testing', learning: 'learning', monitoring: 'monitoring' };
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
function practiceSwitch(state) {
  if (!state.practice && !practiceCount(state.checkpoint, state.outcomes)) return [];
  const button = element('button', state.practice ? 'hide practice trades' : 'show practice trades', state.practice ? 'chip chip-on' : 'chip');
  button.type = 'button';
  button.setAttribute('aria-pressed', state.practice ? 'true' : 'false');
  button.setAttribute('aria-controls', 'floor-positions floor-closed');
  button.addEventListener('click', () => { state.practice = !state.practice; state.more = false; state.drawPositions(); state.drawClosed(); state.focusSwitch(); });
  return [button];
}
export const GAME_RUNGS = [
  { rung: 3, name: 'Scaled', note: 'More real capital' },
  { rung: 2, name: 'Live', note: 'Real money' },
  { rung: 1, name: 'Paper', note: 'Simulated trades' },
  { rung: 0, name: 'Replay', note: 'Historical tests' },
];
const rungNumber = value => Number.isInteger(value) && value >= 0 && value <= 3;
const rungName = rung => GAME_RUNGS.find(row => row.rung === rung)?.name || 'Unranked';
// The current publisher's lifecycle record is league_news(), not a strategy's prose. Only its
// exact, anchored templates qualify. Never infer a promotion from P&L, mode or a missing desk.
export function ladderMove(event) {
  if (event?.kind !== 'lab.progress' || event.payload?.component !== 'league' || !Number.isFinite(Date.parse(event.at))) return null;
  const text = event.payload.message;
  if (typeof text !== 'string') return null;
  const moved = /^([a-z0-9-]{1,40}) (climbs|drops) from rung ([0-3]) to rung ([0-3]): (.+)$/s.exec(text);
  const born = /^([a-z0-9-]{1,40}) is born \((.+)\)\.(?: .*)?$/s.exec(text);
  const died = /^([a-z0-9-]{1,40}) died of ([^.]+)\.(?: .*)?$/s.exec(text);
  const match = moved || born || died;
  if (!match || !deskId(match[1])) return null;
  if (moved && (moved[2] === 'climbs' ? Number(moved[4]) <= Number(moved[3]) : Number(moved[4]) >= Number(moved[3]))) return null;
  return { id: event.id, agent: match[1], at: event.at, seq: event.seq || 0,
    kind: moved ? (moved[2] === 'climbs' ? 'up' : 'down') : born ? 'born' : 'out',
    from: moved ? Number(moved[3]) : null, to: moved ? Number(moved[4]) : null,
    reason: moved ? moved[5] : died ? text.slice(text.indexOf(' died of ') + 9) : text.slice(text.indexOf(' is born ') + 9),
  };
}
export function ladderSnapshot(checkpoint, events = [], now = Date.now()) {
  const desks = orderDesks(checkpoint?.desks).filter(desk => desk && deskId(desk.id));
  const recorded = [];
  for (const desk of desks) {
    const life = desk.gate?.evidence?.lifecycle;
    if (!life) continue;
    const move = life.last_move;
    if (move && rungNumber(move.from_rung) && rungNumber(move.to_rung)
      && (move.decision === 'promote' ? move.to_rung > move.from_rung : move.decision === 'demote' && move.to_rung < move.from_rung)) {
      recorded.push({ id: move.id, agent: desk.id, at: move.at, kind: move.decision === 'promote' ? 'up' : 'down', from: move.from_rung, to: move.to_rung, reason: show(move.reason), seq: 0 });
    }
    if (life.born_at) recorded.push({ id: `born:${desk.id}`, agent: desk.id, at: life.born_at, kind: 'born', from: null, to: null, reason: desk.parent_id ? `Child of ${floorName(desk.parent_id)}` : 'Founding agent', seq: 0 });
    if (life.died_at && desk.status === 'retired') recorded.push({ id: `died:${desk.id}`, agent: desk.id, at: life.died_at, kind: 'out', from: null, to: null, reason: show(life.cause), seq: 0 });
  }
  const moves = [...new Map([...recorded, ...events.map(ladderMove).filter(Boolean)].filter(move => move.id && Number.isFinite(Date.parse(move.at))).map(move => [move.id, move])).values()]
    .filter(move => Date.parse(move.at) <= now + 60000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.seq - a.seq);
  const agents = desks.map(desk => {
    const rung = rungNumber(desk.gate?.evidence?.rung) ? desk.gate.evidence.rung : null;
    const retired = desk.status === 'retired';
    const move = moves.find(move => move.agent === desk.id);
    // A tape message can precede its checkpoint. Do not move the dot until the roster agrees.
    const recent = move && now - Date.parse(move.at) <= 3600000
      && (move.kind === 'out' ? retired : move.kind === 'born' ? !retired : !retired && move.to === rung) ? move : null;
    const accountingIssue = desk.gate?.evidence?.accounting_ok === false;
    const pnl = !accountingIssue && rung !== null && rung > 0 ? deskPnl(desk) : null;
    return { id: desk.id, name: floorName(desk.id), desk, rung, retired, move, recent, pnl, accountingIssue,
      tone: pnl === null || Math.abs(pnl) < 0.005 ? 'flat' : pnl > 0 ? 'positive' : 'negative' };
  });
  const living = agents.filter(agent => !agent.retired);
  return { living: living.length, rungs: GAME_RUNGS.map(row => ({ ...row, agents: living.filter(agent => agent.rung === row.rung) })),
    unranked: living.filter(agent => agent.rung === null), retired: agents.filter(agent => agent.retired), moves: moves.slice(0, 5),
    publishedAt: checkpoint?.published_at || null, stale: !floorRunning(checkpoint, now),
  };
}
const MOVE_MARK = { up: '↑', down: '↓', born: '✦', out: '×' };
const MOVE_LABEL = { up: 'promoted', down: 'demoted', born: 'born', out: 'retired' };
function ladderPanel(checkpoint, state) {
  const model = ladderSnapshot(checkpoint, state.ladderEvents);
  if (!checkpoint) return [element('p', 'Waiting for the agent roster.', 'empty-state')];
  const panel = element('div', null, 'game-ladder');
  const caption = element('div', null, 'game-caption');
  caption.append(element('span', `${model.living} competing · one dot each`), element('span', model.stale ? 'Last known positions · data stale' : 'Updates live', model.stale ? 'negative' : ''));
  panel.append(caption);
  const detail = element('p', null, 'game-detail');
  detail.setAttribute('role', 'status');
  detail.setAttribute('aria-live', 'polite');
  const hint = 'Each dot is an agent. Tap or hover for its record.';
  detail.textContent = hint;
  const buttons = [];
  function select(agent, button) {
    state.ladderSelected = agent.id;
    for (const item of buttons) item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
    const where = agent.retired ? 'Retired' : rungName(agent.rung);
    const result = agent.accountingIssue ? 'Accounting under review' : agent.pnl === null ? '' : `${signedMoney(agent.pnl.toFixed(2), 2)} ${isLive(agent.desk) ? 'live' : 'paper'} P&L`;
    const credits = agent.desk.gate?.evidence?.credits_usd;
    const budget = numeric(credits) ? `${money(credits, 2)} compute credits` : '';
    detail.replaceChildren(element('strong', agent.name), element('span', join(where, result, budget)),
      ...(agent.move ? [element('span', `${MOVE_MARK[agent.move.kind]} ${MOVE_LABEL[agent.move.kind]} · ${truncate(agent.move.reason, 220).text}`, 'game-detail-reason')] : []));
  }
  function tokens(agents, retired = false) {
    const cluster = element('div', null, 'game-agents');
    for (const agent of agents) {
      const move = agent.recent?.kind;
      const glyph = retired ? '×' : move ? MOVE_MARK[move] : agent.tone === 'positive' ? '+' : agent.tone === 'negative' ? '−' : '·';
      const arriving = move && !state.ladderAnimated.has(agent.recent.id);
      if (move) state.ladderAnimated.add(agent.recent.id);
      const button = element('button', null, `game-agent ${retired ? 'game-retired' : agent.tone}${move ? ` game-move-${move}` : ''}${arriving ? ' game-arriving' : ''}`);
      button.type = 'button';
      button.setAttribute('data-agent', agent.id);
      button.setAttribute('aria-pressed', 'false');
      const label = `${agent.name} · ${retired ? 'retired' : rungName(agent.rung)}${agent.accountingIssue ? ' · accounting under review' : agent.pnl === null ? '' : ` · ${signedMoney(agent.pnl.toFixed(2), 2)} ${isLive(agent.desk) ? 'live' : 'paper'} P&L`}${move ? ` · recently ${MOVE_LABEL[move]}` : ''}`;
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      const mark = element('span', glyph, 'game-agent-mark');
      mark.setAttribute('aria-hidden', 'true');
      button.append(mark, element('span', agent.name, 'game-agent-name'));
      button.addEventListener('click', () => select(agent, button));
      button.addEventListener('mouseenter', () => select(agent, button));
      button.addEventListener('focus', () => select(agent, button));
      buttons.push(button);
      if (state.ladderSelected === agent.id) select(agent, button);
      cluster.append(button);
    }
    return cluster;
  }
  for (const row of model.rungs) {
    const band = element('div', null, `game-rung game-rung-${row.rung}`);
    const label = element('div', null, 'game-rung-label');
    const heading = element('div', null, 'game-rung-title');
    heading.append(element('span', row.name), element('span', String(row.agents.length), 'game-count'));
    label.append(heading, element('span', row.note, 'game-rung-note'));
    band.append(element('span', String(row.rung), 'game-step'), label,
      row.agents.length ? tokens(row.agents) : element('span', 'No agents yet', 'game-vacant'));
    panel.append(band);
  }
  if (model.unranked.length) {
    const pending = element('div', null, 'game-exits');
    pending.append(element('span', 'Rank unreported', 'game-rung-note'), tokens(model.unranked));
    panel.append(pending);
  }
  const legend = element('div', null, 'game-legend');
  legend.append(element('span', '+ Profit', 'positive'), element('span', '− Loss', 'negative'), element('span', '· Unscored / flat'), element('span', '↑ Promoted'), element('span', '↓ Demoted'), element('span', '✦ New'), element('span', 'P&L within each tier', 'game-legend-note'));
  panel.append(legend);
  if (model.retired.length) {
    const exits = element('div', null, 'game-exits');
    const label = element('div', null, 'game-rung-label');
    label.append(element('span', 'Retired'), element('span', `${model.retired.length} recent exits`, 'game-rung-note'));
    exits.append(label, tokens(model.retired, true));
    panel.append(exits);
  }
  panel.append(detail);
  if (model.moves.length) {
    const trail = element('ol', null, 'game-moves');
    trail.setAttribute('aria-label', 'Latest ladder changes, newest first');
    for (const move of model.moves.slice(0, 3)) {
      const line = element('li', null, `game-change game-change-${move.kind}`);
      line.setAttribute('title', move.reason);
      const description = move.from === null ? MOVE_LABEL[move.kind] : `${rungName(move.from)} → ${rungName(move.to)}`;
      line.append(element('span', MOVE_MARK[move.kind], 'game-change-mark'), element('span', `${floorName(move.agent)} · ${description}`), element('time', ago(move.at), 'game-change-time'));
      trail.append(line);
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
    ladderEvents: [], ladderSelected: null, ladderAnimated: new Set(),
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
  const drawLadder = () => {
    const focused = document.activeElement?.getAttribute('data-agent');
    drawn(box.improvement, ladderPanel(state.checkpoint, state));
    // A polling redraw must not strand a keyboard user on the document body.
    if (deskId(focused)) box.improvement?.querySelector(`[data-agent="${focused}"]`)?.focus({ preventScroll: true });
  };
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
      if (closed.length) { state.outcomes = [...closed, ...state.outcomes].slice(0, MAX_EVENT_LIMIT); state.drawClosed(); }
      if (balance.length) { state.marks = [...state.marks, ...balance]; drawPortfolio(); }
      if (changes.length) { keepLadder(changes); drawLadder(); refresh(); }
    },
  });
  feed.remember(loaded);
  feed.prime(loaded.reduce((most, event) => Math.max(most, Number(event.seq) || 0), 0));
  return feed;
}

export function startCapital(root = document.querySelector('[data-capital]')) {
  if (!root) return Promise.resolve(null);
  return startFloor(root);
}
if (typeof document !== 'undefined' && document.querySelector('[data-capital]')) startCapital();
