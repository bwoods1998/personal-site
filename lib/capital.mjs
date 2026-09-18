import { createHash, timingSafeEqual } from 'node:crypto';
import {
  MAX_BATCH_BYTES, MAX_CHECKPOINT_BYTES, MAX_EVENT_LIMIT, DEFAULT_EVENT_LIMIT, MAX_SOCKETS, SCHEMA_VERSION,
  validEventBatch, validCheckpoint, validStream, validKind, parseStreamTags, socketMatches, deskId,
} from '../capital/schema.js';

// One singleton SQLite Durable Object holds the whole public floor: the append-only event
// log the desks write to, the latest published checkpoint, and the desk roster derived from it.
export const CAPITAL_OBJECT = 'capital-v1';
// Retention keeps the public tape bounded. Nothing stored is ever edited.
export const MAX_EVENTS_KEPT = 20000;
export const MAX_HISTORY_POINTS = 2048;
export const MAX_SOCKET_MESSAGE = 1024;
const ALLOWED_ORIGINS = ['https://blakewoods.us', 'https://www.blakewoods.us'];
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, stream TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, received_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS events_stream ON events (stream, seq)',
  'CREATE INDEX IF NOT EXISTS events_kind ON events (kind, seq)',
  'CREATE TABLE IF NOT EXISTS floor_history (id TEXT PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS floor_history_at ON floor_history (at, id)',
  'CREATE TABLE IF NOT EXISTS checkpoint (key TEXT PRIMARY KEY, body TEXT NOT NULL, published_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS desks (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL)',
];
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
const reply = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
const sha = body => createHash('sha256').update(body).digest('hex');

export function allowedOrigin(origin) {
  return typeof origin === 'string' && (ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin));
}
export function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const actual = Buffer.from(request.headers.get('Authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
// A published event keeps the publisher's identity and digest; only seq is ours.
export function rowEvent(row) {
  return { seq: Number(row.seq), id: row.id, stream: row.stream, kind: row.kind, at: row.at, payload: JSON.parse(row.payload), digest: row.digest };
}
function conditional(request, value, seconds) {
  const body = JSON.stringify(value);
  const etag = '"' + sha(body) + '"';
  const extra = { ETag: etag, 'Cache-Control': `public, max-age=${seconds}, must-revalidate, no-transform` };
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: extra });
  return new Response(request.method === 'HEAD' ? null : body, { headers: { ...headers, ...extra } });
}
async function readBody(request, limit) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return { error: reply({ error: 'JSON required.' }, 415) };
  if (Number(request.headers.get('Content-Length') || 0) > limit) return { error: reply({ error: 'Payload too large.' }, 413) };
  const reader = request.body?.getReader();
  if (!reader) return { error: reply({ error: 'A JSON body is required.' }, 400) };
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return { error: reply({ error: 'Payload too large.' }, 413) }; }
    chunks.push(value);
  }
  try { return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }; }
  catch { return { error: reply({ error: 'Invalid JSON.' }, 400) }; }
}
class Conflict extends Error {
  constructor(message) { super(message); this.name = 'Conflict'; }
}

// The Durable Object class itself. It keeps the plain (ctx, env) shape rather than extending
// the Workers base class so `node --test` can exercise the same code against node:sqlite;
// it needs no RPC method, and the Hibernation callbacks are read off the instance either way.
export class Capital {
  constructor(ctx, env, now = () => Date.now()) {
    this.ctx = ctx;
    this.env = env;
    this.now = now;
    this.sql = ctx.storage.sql;
    for (const statement of SCHEMA) this.sql.exec(statement);
    // Chart history outlives the bounded activity tape. Migrate any retained marks as well.
    this.sql.exec("INSERT OR IGNORE INTO floor_history (id, at, payload, digest) SELECT id, at, payload, digest FROM events WHERE kind = 'floor.mark'");
    this.latest = Number(this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').toArray()[0].seq);
  }

  // Durable Object SQL is synchronous, so a batch either commits whole or not at all.
  transaction(work) {
    return typeof this.ctx.storage.transactionSync === 'function' ? this.ctx.storage.transactionSync(work) : work();
  }

  publishEvents(batch) {
    if (!validEventBatch(batch)) return reply({ error: 'Invalid event batch.' }, 400);
    let result;
    try {
      result = this.transaction(() => {
        let seq = this.latest;
        let stored = 0;
        let replayed = 0;
        const accepted = [];
        for (const event of batch.events) {
          if (event.kind === 'floor.mark') this.archiveMark(event);
          const existing = this.sql.exec('SELECT digest FROM events WHERE id = ?', event.id).toArray()[0];
          if (existing) {
            // Same identity with different content would rewrite public history.
            if (existing.digest !== event.digest) throw new Conflict(event.id);
            replayed++;
            continue;
          }
          seq++;
          const payload = JSON.stringify(event.payload);
          this.sql.exec('INSERT INTO events (seq, id, stream, kind, at, payload, digest, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            seq, event.id, event.stream, event.kind, event.at, payload, event.digest, this.now());
          accepted.push({ seq, id: event.id, stream: event.stream, kind: event.kind, at: event.at, payload: event.payload, digest: event.digest });
          stored++;
        }
        if (stored) {
          this.sql.exec('DELETE FROM events WHERE seq <= ?', seq - MAX_EVENTS_KEPT);
          this.latest = seq;
        }
        return { stored, replayed, accepted };
      });
    } catch (error) {
      if (error instanceof Conflict) return reply({ error: 'A different event is already published under this id.', id: error.message }, 409);
      throw error;
    }
    this.broadcast(result.accepted);
    return reply({ stored: result.stored, replayed: result.replayed });
  }

  publishCheckpoint(checkpoint) {
    if (!validCheckpoint(checkpoint)) return reply({ error: 'Invalid checkpoint.' }, 400);
    if (Date.parse(checkpoint.published_at) > this.now() + 60000) return reply({ error: 'Checkpoint is dated in the future.' }, 400);
    const body = JSON.stringify(checkpoint);
    const previous = this.sql.exec('SELECT body, published_at FROM checkpoint WHERE key = ?', 'floor').toArray()[0];
    if (previous && previous.body === body) return reply({ published_at: checkpoint.published_at, desks: checkpoint.desks.length });
    if (previous && checkpoint.published_at <= previous.published_at) return reply({ error: 'A newer checkpoint is already published.' }, 409);
    this.transaction(() => {
      this.sql.exec('INSERT INTO checkpoint (key, body, published_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, published_at = excluded.published_at',
        'floor', body, checkpoint.published_at);
      const keep = new Set();
      for (const desk of checkpoint.desks) {
        keep.add(desk.id);
        this.sql.exec('INSERT INTO desks (id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at',
          desk.id, JSON.stringify(desk), desk.updated_at);
      }
      for (const row of this.sql.exec('SELECT id FROM desks').toArray()) {
        if (!keep.has(row.id)) this.sql.exec('DELETE FROM desks WHERE id = ?', row.id);
      }
    });
    return reply({ published_at: checkpoint.published_at, desks: checkpoint.desks.length });
  }

  readCheckpoint(request) {
    const saved = this.sql.exec('SELECT body FROM checkpoint WHERE key = ?', 'floor').toArray()[0];
    if (!saved) return reply({ error: 'No published checkpoint.' }, 404);
    return conditional(request, JSON.parse(saved.body), 5);
  }

  archiveMark(event) {
    const previous = this.sql.exec('SELECT digest FROM floor_history WHERE id = ?', event.id).toArray()[0];
    if (previous) {
      if (previous.digest !== event.digest) throw new Conflict(event.id);
      return false;
    }
    this.sql.exec('INSERT INTO floor_history (id, at, payload, digest) VALUES (?, ?, ?, ?)',
      event.id, event.at, JSON.stringify(event.payload), event.digest);
    return true;
  }

  publishHistory(batch) {
    if (!validEventBatch(batch) || batch.events.some(event => event.kind !== 'floor.mark')) return reply({ error: 'Invalid balance history.' }, 400);
    try {
      const stored = this.transaction(() => batch.events.reduce((count, event) => count + Number(this.archiveMark(event)), 0));
      // Backfills never rebroadcast historical activity or advance the live tape cursor.
      return reply({ stored, replayed: batch.events.length - stored });
    } catch (error) {
      if (error instanceof Conflict) return reply({ error: 'A different mark is already archived under this id.', id: error.message }, 409);
      throw error;
    }
  }

  readHistory(request) {
    // A mark the floor later found wrong (a venue read that missed a wallet, a balance taken
    // before the audited opening) is never rewritten: a later mark names it in `voids`, and
    // the chart leaves it out. Both stay archived; the record shows what was corrected.
    const voided = `SELECT j.value AS id FROM floor_history h, json_each(h.payload, '$.voids') j
      WHERE json_type(h.payload, '$.voids') = 'array'`;
    const total = Number(this.sql.exec(`SELECT COUNT(*) AS total FROM floor_history WHERE id NOT IN (${voided})`).toArray()[0].total);
    const stride = Math.max(1, Math.ceil((total - 1) / (MAX_HISTORY_POINTS - 1)));
    // Bound response size without dropping the beginning of the run. Only recorded points,
    // including the first and last, are returned; no fabricated/interpolated prices.
    const points = this.sql.exec(`WITH ordered AS (
      SELECT at, payload, ROW_NUMBER() OVER (ORDER BY at, id) AS rn FROM floor_history
      WHERE id NOT IN (${voided})
    ) SELECT at, json_extract(payload, '$.account_equity') AS account_equity FROM ordered
      WHERE (rn - 1) % ? = 0 OR rn = ? ORDER BY rn`, stride, total).toArray();
    const corrected = Number(this.sql.exec(`SELECT COUNT(*) AS n FROM floor_history WHERE id IN (${voided})`).toArray()[0].n);
    return conditional(request, { schema_version: SCHEMA_VERSION, total, sampled: stride > 1, corrected, points }, 5);
  }

  readEvents(request, url) {
    const allowed = ['stream', 'kind', 'after', 'limit'];
    if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length > 1)) {
      return reply({ error: 'Unknown query parameter.' }, 400);
    }
    const stream = url.searchParams.get('stream');
    const kind = url.searchParams.get('kind');
    const after = url.searchParams.get('after');
    const limitValue = url.searchParams.get('limit');
    if (stream !== null && !validStream(stream)) return reply({ error: 'Invalid stream.' }, 400);
    if (kind !== null && !validKind(kind)) return reply({ error: 'Invalid kind.' }, 400);
    if (after !== null && !/^\d{1,15}$/.test(after)) return reply({ error: 'Invalid cursor.' }, 400);
    if (limitValue !== null && !/^\d{1,3}$/.test(limitValue)) return reply({ error: 'Invalid limit.' }, 400);
    const limit = limitValue === null ? DEFAULT_EVENT_LIMIT : Number(limitValue);
    if (limit < 1 || limit > MAX_EVENT_LIMIT) return reply({ error: 'Invalid limit.' }, 400);
    const clauses = [];
    const params = [];
    if (stream !== null) { clauses.push('stream = ?'); params.push(stream); }
    if (kind !== null) { clauses.push('kind = ?'); params.push(kind); }
    if (after !== null) { clauses.push('seq > ?'); params.push(Number(after)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    // Without a cursor the tape reads newest first; following a cursor reads forward in order.
    const order = after === null ? 'DESC' : 'ASC';
    const rows = this.sql.exec(`SELECT seq, id, stream, kind, at, payload, digest FROM events ${where} ORDER BY seq ${order} LIMIT ?`, ...params, limit).toArray();
    return conditional(request, { schema_version: SCHEMA_VERSION, latest_seq: this.latest, events: rows.map(rowEvent) }, 3);
  }

  readDesks(request) {
    const rows = this.sql.exec('SELECT body FROM desks ORDER BY id').toArray();
    return conditional(request, { schema_version: SCHEMA_VERSION, desks: rows.map(row => JSON.parse(row.body)) }, 5);
  }

  readDesk(request, id) {
    if (!deskId(id)) return reply({ error: 'Not found.' }, 404);
    const row = this.sql.exec('SELECT body FROM desks WHERE id = ?', id).toArray()[0];
    if (!row) return reply({ error: 'Not found.' }, 404);
    return conditional(request, JSON.parse(row.body), 5);
  }

  openStream(request, url) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return reply({ error: 'WebSocket upgrade required.' }, 426, { Upgrade: 'websocket' });
    }
    if (!allowedOrigin(request.headers.get('Origin'))) return reply({ error: 'This floor accepts its own pages only.' }, 403);
    if ([...url.searchParams.keys()].some(key => key !== 'streams')) return reply({ error: 'Unknown query parameter.' }, 400);
    const tags = parseStreamTags(url.searchParams.get('streams'));
    if (!tags) return reply({ error: 'Invalid stream selection.' }, 400);
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return reply({ error: 'Too many listeners. Please retry shortly.' }, 503, { 'Retry-After': '30' });
    const pair = new WebSocketPair();
    // Hibernation: the object may sleep between events without dropping listeners.
    this.ctx.acceptWebSocket(pair[1], tags);
    try { pair[1].send(JSON.stringify({ type: 'hello', latest_seq: this.latest })); } catch { /* The listener left before the greeting. */ }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  broadcast(events) {
    if (!events.length) return;
    for (const socket of this.ctx.getWebSockets()) {
      let tags = [];
      try { tags = this.ctx.getTags(socket); } catch { tags = []; }
      for (const event of events) {
        if (!socketMatches(tags, event.stream)) continue;
        try { socket.send(JSON.stringify(event)); }
        catch { try { socket.close(1011, 'Send failed'); } catch { /* Already gone. */ } break; }
      }
    }
  }

  webSocketMessage(socket, message) {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_SOCKET_MESSAGE) { socket.close(1009, 'Message too large'); return; }
    // The tape is one-way. A keepalive is the only accepted message.
    if (message === 'ping') socket.send(JSON.stringify({ type: 'pong', latest_seq: this.latest }));
  }

  webSocketClose(socket, code, reason) {
    try { socket.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason); }
    catch { /* The socket is already closed. */ }
  }

  webSocketError(socket) {
    try { socket.close(1011, 'Stream error'); } catch { /* The socket is already closed. */ }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const read = request.method === 'GET' || request.method === 'HEAD';
    if (path === '/api/capital/stream') {
      if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
      return this.openStream(request, url);
    }
    if (path === '/api/capital/events') {
      if (read) return this.readEvents(request, url);
      if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD, POST' });
      if (!authorized(request, this.env.CAPITAL_PUBLISH_TOKEN)) return reply({ error: 'Unauthorized.' }, 401);
      if (url.search) return reply({ error: 'Invalid destination.' }, 400);
      const body = await readBody(request, MAX_BATCH_BYTES);
      return body.error ?? this.publishEvents(body.value);
    }
    if (path === '/api/capital/history') {
      if (url.search) return reply({ error: 'Invalid destination.' }, 400);
      if (read) return this.readHistory(request);
      if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD, POST' });
      if (!authorized(request, this.env.CAPITAL_PUBLISH_TOKEN)) return reply({ error: 'Unauthorized.' }, 401);
      const body = await readBody(request, MAX_BATCH_BYTES);
      return body.error ?? this.publishHistory(body.value);
    }
    if (path === '/api/capital/checkpoint') {
      if (read) return url.search ? reply({ error: 'Not found.' }, 404) : this.readCheckpoint(request);
      if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD, POST' });
      if (!authorized(request, this.env.CAPITAL_PUBLISH_TOKEN)) return reply({ error: 'Unauthorized.' }, 401);
      if (url.search) return reply({ error: 'Invalid destination.' }, 400);
      const body = await readBody(request, MAX_CHECKPOINT_BYTES);
      return body.error ?? this.publishCheckpoint(body.value);
    }
    if (path === '/api/capital/desks' || path.startsWith('/api/capital/desks/')) {
      if (!read) return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' });
      if (url.search) return reply({ error: 'Not found.' }, 404);
      return path === '/api/capital/desks' ? this.readDesks(request) : this.readDesk(request, path.slice('/api/capital/desks/'.length));
    }
    return reply({ error: 'Not found.' }, 404);
  }
}
