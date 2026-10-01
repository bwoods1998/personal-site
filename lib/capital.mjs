import { createHash, timingSafeEqual } from 'node:crypto';
import {
  MAX_BATCH_BYTES, MAX_CHECKPOINT_BYTES, MAX_EVENT_LIMIT, DEFAULT_EVENT_LIMIT, MAX_SOCKETS, SCHEMA_VERSION,
  validEventBatch, validCheckpoint, validStream, validKind, parseStreamTags, socketMatches, agentId, tapeName, displayNameFor,
  AGENT_SOURCES, legacyCompute, legacyPosition, legacyStructure, scorePoint,
} from '../capital/schema.js';

// One singleton SQLite Durable Object holds the whole public record: the append-only tape the
// House publishes, the Brokerage Account's balance history, the latest checkpoint, and the agent
// roster derived from it. The roster's table keeps its first name (`desks`) so the stored object,
// its reset and its migrations stay one table set.
export const CAPITAL_OBJECT = 'capital-v1';
// A test tape is the same class under another name: its own log, checkpoint and listeners.
export const TAPE_PREFIX = '/api/capital/t';
export const tapeObject = tape => `capital-tape-${tape}`;
// Which object answers a path, and the path that object is shown. `/api/capital/t/<tape>/<rest>`
// is `/api/capital/<rest>` on the tape's own object; everything else is the real floor, unchanged.
// Null is a tape address that names no tape on the list (schema.js TAPES), which is nobody's to
// answer: the worker replies 404 itself, so an unlisted name never creates an object.
export function capitalRoute(pathname) {
  if (pathname !== TAPE_PREFIX && !pathname.startsWith(`${TAPE_PREFIX}/`)) return { tape: null, object: CAPITAL_OBJECT, path: pathname };
  const [tape, ...rest] = pathname.slice(TAPE_PREFIX.length + 1).split('/');
  if (!tapeName(tape) || !rest.length) return null;
  return { tape, object: tapeObject(tape), path: `/api/capital/${rest.join('/')}` };
}
// The Brokerage Account's balance mark: the one kind the Worker also archives as the balance history.
export const MARK = 'account.mark';
// Retention keeps the public tape bounded. Nothing stored is ever edited.
export const MAX_EVENTS_KEPT = 20000;
export const MAX_HISTORY_POINTS = 2048;
// The score archive (Oct 1, 2026): Profit, costs and Net at five-minute buckets, the newest 30,000 buckets (about 104
// days) of them. Every read and write touches only the rows it needs: retention deletes by key range, and a read samples by
// key (the first bucket at or after each step), so neither steps through the whole table.
export const SCORE_BUCKET_MS = 5 * 60 * 1000;
export const MAX_SCORE_POINTS = 30000;
// The newest known Profit and Net are looked for this far back (the page shows a last-known value up to four days old).
const SCORE_LAST_BUCKETS = Math.ceil(4 * 86400000 / SCORE_BUCKET_MS);
// The archive changes once per bucket at most: an edge cache this long misses nothing.
const SCORE_MAX_AGE = 300;
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
  'CREATE TABLE IF NOT EXISTS agent_names (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE)',
  // One agent's tape (`?agent=`): its own stream, and the swarm's news about it.
  "CREATE INDEX IF NOT EXISTS events_news_agent ON events (json_extract(payload, '$.agent'), seq) WHERE kind = 'swarm.news'",
  // `basis`: the Profit basis (`performance.start_at`) the point was measured on.
  'CREATE TABLE IF NOT EXISTS score_history (bucket INTEGER PRIMARY KEY, at TEXT NOT NULL, profit_usd TEXT, costs_usd TEXT, net_usd TEXT, basis TEXT)',
];
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
const reply = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
const sha = body => createHash('sha256').update(body).digest('hex');
// Old open pages enforce the original schema-2 agent keys. New pages explicitly opt
// into progress; reject unknown/duplicate parameters rather than adding more variants.
const validAgentRead = url => !url.search || (url.searchParams.size === 1 && url.searchParams.get('progress') === '1');
// The positions ledger (Sept 28, 2026) is one more opt-in, on the checkpoint only and in exactly this
// spelling: pages already open validate the exact checkpoint keys they knew, so they never receive it.
export const POSITIONS_READ = '?progress=1&positions=1';
// The page of Sept 30, 2026 opts into the rest, in exactly this spelling: the practice league, Claude as its own
// compute part, and the incubator route on positions and structures. Every older read gets the shapes it validates:
// no practice block, Claude back inside `other_usd`, an incubator row as its agent's and a structure without its route.
export const CURRENT_READ = '?progress=1&positions=1&practice=1';
// The swarm window (Oct 1, 2026): everything CURRENT_READ carries, plus `levels` and `rationale`. Every other read is
// byte for byte what it was, so pages already open keep the exact keys they validate.
export const WINDOW_READ = '?progress=1&positions=1&practice=1&window=1';
const validCheckpointRead = url => validAgentRead(url) || [POSITIONS_READ, CURRENT_READ, WINDOW_READ].includes(url.search);

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
    this.sql.exec(`INSERT OR IGNORE INTO floor_history (id, at, payload, digest) SELECT id, at, payload, digest FROM events WHERE kind = '${MARK}'`);
    this.latest = Number(this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').toArray()[0].seq);
    // One-time adoption of the existing public record. Retention never removes a name, so a clipped
    // or retired family cannot steal another family's identity when it reappears.
    if (!this.sql.exec('SELECT id FROM agent_names LIMIT 1').toArray().length) {
      this.transaction(() => {
        const agents = this.sql.exec('SELECT body FROM desks ORDER BY id').toArray().map(row => JSON.parse(row.body));
        agents.sort((a, b) => String(a.born_at || '').localeCompare(String(b.born_at || '')) || a.id.localeCompare(b.id));
        for (const agent of agents) this.ensureName(agent.id);
        for (const row of this.sql.exec('SELECT stream, kind, payload FROM events ORDER BY seq').toArray()) {
          this.ensureName(this.eventAgent({ ...row, payload: JSON.parse(row.payload) }));
        }
      });
    }
  }

  // Durable Object SQL is synchronous, so a batch either commits whole or not at all.
  transaction(work) {
    return typeof this.ctx.storage.transactionSync === 'function' ? this.ctx.storage.transactionSync(work) : work();
  }

  eventAgent(event) {
    return event.stream?.startsWith('agent:') ? event.stream.slice(6) : event.kind === 'swarm.news' ? event.payload?.agent : null;
  }

  ensureName(id) {
    if (!agentId(id)) return;
    this.sql.exec('INSERT OR IGNORE INTO agent_names (id, ordinal) SELECT ?, COALESCE(MAX(ordinal), 0) + 1 FROM agent_names', id);
  }

  nameOf(id) {
    const row = this.sql.exec('SELECT ordinal FROM agent_names WHERE id = ?', id).toArray()[0];
    return row ? displayNameFor(Number(row.ordinal)) : null;
  }

  namedAgent(agent) {
    const name = this.nameOf(agent.id);
    return name ? { ...agent, display_name: name } : agent;
  }

  publicAgent(request, agent) {
    const named = this.namedAgent(agent);
    if (new URL(request.url).searchParams.get('progress') === '1') return named;
    const { progress: _progress, ...legacy } = named;
    return legacy;
  }

  // A position is named like its agent: the House's calibration round trips have no agent and no alias.
  namedPosition(row) {
    const name = AGENT_SOURCES.includes(row.source) ? this.nameOf(row.agent) : null;
    return name ? { ...row, display_name: name } : row;
  }

  // A practice league row is always an agent's.
  namedPractice(row) {
    const name = this.nameOf(row.agent);
    return name ? { ...row, display_name: name } : row;
  }

  namedEvent(event) {
    const id = this.eventAgent(event);
    const name = id ? this.nameOf(id) : null;
    return name ? { ...event, display_name: name } : event;
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
          this.ensureName(this.eventAgent(event));
          if (event.kind === MARK) this.archiveMark(event);
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
    if (previous && previous.body === body) return reply({ published_at: checkpoint.published_at, agents: checkpoint.agents.length });
    if (previous && checkpoint.published_at <= previous.published_at) return reply({ error: 'A newer checkpoint is already published.' }, 409);
    this.transaction(() => {
      this.sql.exec('INSERT INTO checkpoint (key, body, published_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, published_at = excluded.published_at',
        'floor', body, checkpoint.published_at);
      const keep = new Set();
      for (const agent of checkpoint.agents) {
        this.ensureName(agent.id);
        keep.add(agent.id);
        this.sql.exec('INSERT INTO desks (id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at',
          agent.id, JSON.stringify(agent), checkpoint.published_at);
      }
      // An agent whose position outlives its place on the roster keeps a name all the same (after the roster,
      // so a new roster names its agents in its own order).
      for (const row of checkpoint.positions?.rows || []) if (AGENT_SOURCES.includes(row.source)) this.ensureName(row.agent);
      for (const row of checkpoint.practice?.rows || []) this.ensureName(row.agent);
      for (const row of this.sql.exec('SELECT id FROM desks').toArray()) {
        if (!keep.has(row.id)) this.sql.exec('DELETE FROM desks WHERE id = ?', row.id);
      }
      this.archiveScore(checkpoint);
    });
    return reply({ published_at: checkpoint.published_at, agents: checkpoint.agents.length });
  }

  // The owner's reset: the record starts over, so the published tape, the balance history, the
  // checkpoint and the agent roster all go, and the page reads as a House that has not started
  // (Sept 19, 2026; again for the options swarm, Sept 26, 2026). Guarded by the publish token and an
  // explicit confirmation.
  resetAll() {
    const counts = {};
    this.transaction(() => {
      for (const table of ['events', 'floor_history', 'checkpoint', 'desks', 'agent_names', 'score_history']) {
        counts[table] = Number(this.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0].n);
        this.sql.exec(`DELETE FROM ${table}`);
      }
    });
    this.latest = 0;
    return reply({ reset: true, cleared: counts });
  }

  readCheckpoint(request) {
    const saved = this.sql.exec('SELECT body FROM checkpoint WHERE key = ?', 'floor').toArray()[0];
    if (!saved) return reply({ error: 'No published checkpoint.' }, 404);
    // Every block an older page does not know is taken out here, so no read carries it unless it asked (C7).
    const { positions, practice, levels, rationale, ...checkpoint } = JSON.parse(saved.body);
    const search = new URL(request.url).search;
    const windowRead = search === WINDOW_READ;
    const current = search === CURRENT_READ || windowRead;
    const body = { ...checkpoint, agents: checkpoint.agents.map(agent => this.publicAgent(request, agent)) };
    if (!current) {
      body.compute = legacyCompute(checkpoint.compute);
      body.structures = checkpoint.structures.map(legacyStructure);
    }
    if ((current || search === POSITIONS_READ) && positions !== undefined) {
      body.positions = positions && { ...positions, rows: positions.rows.map(row => this.namedPosition(current ? row : legacyPosition(row))) };
    }
    if (current && practice !== undefined) body.practice = practice && { ...practice, rows: practice.rows.map(row => this.namedPractice(row)) };
    // Every id in the window's blocks is on the roster, and the roster is named: no annotation is needed.
    if (windowRead && levels !== undefined) body.levels = levels;
    if (windowRead && rationale !== undefined) body.rationale = rationale;
    return conditional(request, body, 5);
  }

  // One point per five minutes of every accepted, changed checkpoint, the latest in its bucket; buckets more than
  // MAX_SCORE_POINTS older than the newest go. A new Profit basis (a re-based record) starts the archive over, so no line
  // mixes two bases. Written in the checkpoint's own transaction.
  archiveScore(checkpoint) {
    const point = scorePoint(checkpoint);
    const bucket = Math.floor(Date.parse(point.at) / SCORE_BUCKET_MS);
    if (!Number.isSafeInteger(bucket)) return;
    const basis = typeof checkpoint.performance?.start_at === 'string' ? checkpoint.performance.start_at : null;
    const newest = this.sql.exec('SELECT basis FROM score_history ORDER BY bucket DESC LIMIT 1').toArray()[0];
    if (basis && newest?.basis && newest.basis !== basis) this.sql.exec('DELETE FROM score_history');
    this.sql.exec(`INSERT INTO score_history (bucket, at, profit_usd, costs_usd, net_usd, basis) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket) DO UPDATE SET at = excluded.at, profit_usd = excluded.profit_usd, costs_usd = excluded.costs_usd, net_usd = excluded.net_usd,
      basis = excluded.basis WHERE excluded.at >= score_history.at`, bucket, point.at, point.profit_usd, point.costs_usd, point.net_usd, basis ?? newest?.basis ?? null);
    this.sql.exec('DELETE FROM score_history WHERE bucket <= (SELECT MAX(bucket) FROM score_history) - ?', MAX_SCORE_POINTS);
  }

  // Performance over time: the archived points, every one while they span at most 2,048 buckets, else the first bucket at or
  // after each step of `step_ms` (and the newest), and the newest known Profit and Net within four days. Each read is a few
  // key lookups per point, never a pass over the table.
  readScore(request) {
    const edge = order => this.sql.exec(`SELECT bucket FROM score_history ORDER BY bucket ${order} LIMIT 1`).toArray()[0]?.bucket ?? null;
    const low = edge('ASC');
    const high = edge('DESC');
    const stride = low === null ? 1 : Math.max(1, Math.ceil((high - low) / (MAX_HISTORY_POINTS - 1)));
    const columns = 'h.at AS at, h.profit_usd AS profit_usd, h.costs_usd AS costs_usd, h.net_usd AS net_usd';
    const rows = low === null ? [] : stride === 1
      ? this.sql.exec(`SELECT ${columns} FROM score_history h ORDER BY h.bucket`).toArray()
      : this.sql.exec(`WITH RECURSIVE steps(target) AS (SELECT ? UNION ALL SELECT target + ? FROM steps WHERE target + ? < ?),
          targets(target) AS (SELECT target FROM steps UNION SELECT ?),
          picked(bucket) AS (SELECT DISTINCT (SELECT bucket FROM score_history WHERE bucket >= target ORDER BY bucket LIMIT 1) FROM targets)
        SELECT ${columns} FROM picked JOIN score_history h ON h.bucket = picked.bucket ORDER BY h.bucket`, low, stride, stride, high, high).toArray();
    const points = rows.map(row => ({ at: row.at, profit_usd: row.profit_usd ?? null, costs_usd: row.costs_usd ?? null, net_usd: row.net_usd ?? null }));
    const last = column => (high === null ? undefined : this.sql.exec(`SELECT at, ${column} AS value FROM score_history
      WHERE bucket > ? AND ${column} IS NOT NULL ORDER BY bucket DESC LIMIT 1`, high - SCORE_LAST_BUCKETS).toArray()[0]);
    const profit = last('profit_usd');
    const net = last('net_usd');
    return conditional(request, {
      schema_version: SCHEMA_VERSION, sampled: stride > 1, step_ms: stride * SCORE_BUCKET_MS, points,
      last_profit: profit ? { at: profit.at, profit_usd: profit.value } : null, last_net: net ? { at: net.at, net_usd: net.value } : null,
    }, SCORE_MAX_AGE);
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
    if (!validEventBatch(batch) || batch.events.some(event => event.kind !== MARK)) return reply({ error: 'Invalid balance history.' }, 400);
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
    const total = Number(this.sql.exec('SELECT COUNT(*) AS total FROM floor_history').toArray()[0].total);
    const stride = Math.max(1, Math.ceil((total - 1) / (MAX_HISTORY_POINTS - 1)));
    // Bound response size without dropping the beginning of the run. Only recorded points,
    // including the first and last, are returned; no fabricated/interpolated balances.
    const points = this.sql.exec(`WITH ordered AS (
      SELECT at, payload, ROW_NUMBER() OVER (ORDER BY at, id) AS rn FROM floor_history
    ) SELECT at, json_extract(payload, '$.equity') AS equity FROM ordered
      WHERE (rn - 1) % ? = 0 OR rn = ? ORDER BY rn`, stride, total).toArray();
    return conditional(request, { schema_version: SCHEMA_VERSION, total, sampled: stride > 1, points }, 5);
  }

  readEvents(request, url) {
    const allowed = ['stream', 'agent', 'kind', 'after', 'limit'];
    if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length > 1)) {
      return reply({ error: 'Unknown query parameter.' }, 400);
    }
    const stream = url.searchParams.get('stream');
    const agent = url.searchParams.get('agent');
    const kind = url.searchParams.get('kind');
    const after = url.searchParams.get('after');
    const limitValue = url.searchParams.get('limit');
    if (stream !== null && !validStream(stream)) return reply({ error: 'Invalid stream.' }, 400);
    if (agent !== null && (!agentId(agent) || stream !== null)) return reply({ error: 'Invalid agent.' }, 400);
    if (kind !== null && !validKind(kind)) return reply({ error: 'Invalid kind.' }, 400);
    if (after !== null && !/^\d{1,15}$/.test(after)) return reply({ error: 'Invalid cursor.' }, 400);
    if (limitValue !== null && !/^\d{1,3}$/.test(limitValue)) return reply({ error: 'Invalid limit.' }, 400);
    const limit = limitValue === null ? DEFAULT_EVENT_LIMIT : Number(limitValue);
    if (limit < 1 || limit > MAX_EVENT_LIMIT) return reply({ error: 'Invalid limit.' }, 400);
    const clauses = [];
    const params = [];
    if (stream !== null) { clauses.push('stream = ?'); params.push(stream); }
    // One agent: its notes and trades, and the swarm's news about it (its birth, band moves and retirement).
    if (agent !== null) { clauses.push("(stream = ? OR (kind = 'swarm.news' AND json_extract(payload, '$.agent') = ?))"); params.push(`agent:${agent}`, agent); }
    if (kind !== null) { clauses.push('kind = ?'); params.push(kind); }
    if (after !== null) { clauses.push('seq > ?'); params.push(Number(after)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    // Without a cursor the tape reads newest first; following a cursor reads forward in order.
    const order = after === null ? 'DESC' : 'ASC';
    const rows = this.sql.exec(`SELECT seq, id, stream, kind, at, payload, digest FROM events ${where} ORDER BY seq ${order} LIMIT ?`, ...params, limit).toArray();
    return conditional(request, { schema_version: SCHEMA_VERSION, latest_seq: this.latest, events: rows.map(row => this.namedEvent(rowEvent(row))) }, 3);
  }

  readAgents(request) {
    const rows = this.sql.exec('SELECT body FROM desks ORDER BY id').toArray();
    return conditional(request, { schema_version: SCHEMA_VERSION, agents: rows.map(row => this.publicAgent(request, JSON.parse(row.body))) }, 5);
  }

  readAgent(request, id) {
    if (!agentId(id)) return reply({ error: 'Not found.' }, 404);
    const row = this.sql.exec('SELECT body FROM desks WHERE id = ?', id).toArray()[0];
    if (!row) return reply({ error: 'Not found.' }, 404);
    return conditional(request, this.publicAgent(request, JSON.parse(row.body)), 5);
  }

  openStream(request, url) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return reply({ error: 'WebSocket upgrade required.' }, 426, { Upgrade: 'websocket' });
    }
    if (!allowedOrigin(request.headers.get('Origin'))) return reply({ error: 'This record accepts its own pages only.' }, 403);
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
    const named = events.map(event => this.namedEvent(event));
    for (const socket of this.ctx.getWebSockets()) {
      let tags = [];
      try { tags = this.ctx.getTags(socket); } catch { tags = []; }
      for (const event of named) {
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
    if (path === '/api/capital/score') {
      if (!read) return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' });
      if (url.search) return reply({ error: 'Invalid destination.' }, 400);
      return this.readScore(request);
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
      if (read) return validCheckpointRead(url) ? this.readCheckpoint(request) : reply({ error: 'Not found.' }, 404);
      if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD, POST' });
      if (!authorized(request, this.env.CAPITAL_PUBLISH_TOKEN)) return reply({ error: 'Unauthorized.' }, 401);
      if (url.search) return reply({ error: 'Invalid destination.' }, 400);
      const body = await readBody(request, MAX_CHECKPOINT_BYTES);
      return body.error ?? this.publishCheckpoint(body.value);
    }
    if (path === '/api/capital/reset') {
      if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
      if (!authorized(request, this.env.CAPITAL_PUBLISH_TOKEN)) return reply({ error: 'Unauthorized.' }, 401);
      if (url.searchParams.get('confirm') !== 'erase-everything') return reply({ error: 'Add ?confirm=erase-everything to erase the published record.' }, 400);
      return this.resetAll();
    }
    if (path === '/api/capital/agents' || path.startsWith('/api/capital/agents/')) {
      if (!read) return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' });
      if (!validAgentRead(url)) return reply({ error: 'Not found.' }, 404);
      return path === '/api/capital/agents' ? this.readAgents(request) : this.readAgent(request, path.slice('/api/capital/agents/'.length));
    }
    return reply({ error: 'Not found.' }, 404);
  }
}
