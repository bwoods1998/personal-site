import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, cp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Capital, MAX_EVENTS_KEPT, allowedOrigin } from '../lib/capital.mjs';
import {
  validEvent, validEventBatch, validCheckpoint, validDesk, validStream, socketMatches, parseStreamTags, sourceUrl, EVENT_KINDS, MAX_BATCH_BYTES,
} from '../capital/schema.js';
import { tapeLine, sortDesks, markSeries, lineage, fillRows, bookRows, money, percent, streamUrl, streamLabel, startCapital, LEADERBOARD_COLUMNS } from '../capital/capital.js';

const token = 'woods-capital-test-publication-token-01';
const NOW = Date.parse('2026-09-15T15:00:00.000Z');

function event(n = 1, overrides = {}) {
  return {
    id: `desk.earnings-01.thought.${n}`,
    stream: 'desk:earnings-01',
    kind: 'desk.thought',
    at: `2026-09-15T14:${String(n % 60).padStart(2, '0')}:00.000Z`,
    payload: { session_id: 'sess-2026-09-15', text: 'Margins widened for a third quarter. Waiting for the filing to confirm.' },
    digest: n.toString(16).padStart(64, '0'),
    ...overrides,
  };
}
const batch = (...events) => ({ schema_version: 1, events });
function desk(id = 'earnings-01', overrides = {}) {
  return {
    id, name: 'Earnings Drift', family: 'earnings', generation: 1, parent_id: null, mode: 'paper',
    venues: ['alpaca'], capital_usd: '50000', equity: '50250.25', cash: '10000', daily_pnl: '-125.50',
    return_pct: '0.5', max_drawdown_pct: '1.25', days_live: 12, orders: 34, cost_usd: '4.21',
    status: 'active', gate: { name: 'Sixty forward days', passed: false, evidence: { days: 12, sharpe: '0.8' } },
    updated_at: '2026-09-15T14:00:00.000Z', ...overrides,
  };
}
function checkpoint(overrides = {}) {
  return {
    schema_version: 1, published_at: '2026-09-15T14:05:00.000Z',
    floor: { equity: '100500', cash: '40000', daily_pnl: '-250.25', capital_usd: '100000', since_inception_pct: '0.5', benchmark: { name: 'S&P 500 Total Return', return_pct: '0.31' } },
    desks: [desk()],
    committee: { last_memo_at: '2026-09-14T21:00:00.000Z', allocations: { 'earnings-01': '50000' } },
    budget: { spent_today_usd: '4.21', cap_usd: '25' },
    ...overrides,
  };
}
// A stand-in for the Durable Object's synchronous SQLite surface and its socket registry.
function floor() {
  const database = new DatabaseSync(':memory:');
  const sockets = [];
  const ctx = {
    storage: {
      sql: { exec: (query, ...params) => { const rows = database.prepare(query).all(...params); return { toArray: () => rows }; } },
      transactionSync(work) {
        database.exec('BEGIN');
        try { const value = work(); database.exec('COMMIT'); return value; }
        catch (error) { database.exec('ROLLBACK'); throw error; }
      },
    },
    acceptWebSocket(socket, tags) { socket.tags = tags; sockets.push(socket); },
    getWebSockets: () => sockets,
    getTags: socket => socket.tags || [],
  };
  const capital = new Capital(ctx, { CAPITAL_PUBLISH_TOKEN: token }, () => NOW);
  const listen = tags => { const socket = { tags, received: [], send(message) { this.received.push(JSON.parse(message)); }, close() { this.closed = true; } }; sockets.push(socket); return socket; };
  return { capital, sockets, listen };
}
const request = (method, path, body, { auth = token, headers = {} } = {}) => new Request('https://blakewoods.us' + path, {
  method,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}`, ...headers },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const post = (capital, path, body, options) => capital.fetch(request('POST', path, body, options));
const get = (capital, path, headers = {}) => capital.fetch(request('GET', path, undefined, { headers }));

test('the publisher projection is the only event shape the floor stores', async () => {
  const { capital } = floor();
  assert.equal(validEvent(event()), true);
  // Event.to_public() may be posted verbatim: the publisher's own seq is accepted and ignored.
  assert.equal(validEvent({ ...event(), seq: 41 }), true);
  assert.equal(Object.hasOwn(EVENT_KINDS, 'provider.request'), false);
  const rejected = [
    ['private key', e => { e.payload._prompt = 'system prompt'; }],
    ['nested private key', e => { e.payload.detail = { _raw: 'model output' }; }],
    ['api credential', e => { e.payload.text = 'exported sk-live-9aa1 for the run'; }],
    ['bearer credential', e => { e.payload.text = 'sent Bearer abc123 to the venue'; }],
    ['broker credential', e => { e.payload.text = 'header APCA-API-KEY-ID rotated'; }],
    ['markup', e => { e.payload.text = 'the filing said <b>growth</b>'; }],
    ['offsite url', e => { e.payload.text = 'source https://example.com/report'; }],
    ['insecure url', e => { e.payload.text = 'source http://www.sec.gov/x'; }],
    ['private model traffic', e => { e.kind = 'provider.request'; }],
    ['kind outside its stream', e => { e.stream = 'risk'; }],
    ['uppercase stream', e => { e.stream = 'desk:Earnings-01'; }],
    ['unknown stream family', e => { e.stream = 'vault:earnings-01'; }],
    ['timestamp without milliseconds', e => { e.at = '2026-09-15T14:01:00Z'; }],
    ['impossible timestamp', e => { e.at = '2026-09-31T14:01:00.000Z'; }],
    ['short digest', e => { e.digest = 'abc123'; }],
    ['uppercase digest', e => { e.digest = 'A'.repeat(64); }],
    ['spaced id', e => { e.id = 'desk earnings 01'; }],
    ['array payload', e => { e.payload = ['text']; }],
    ['unknown field', e => { e.received_at = 1; }],
    ['long string', e => { e.payload.text = 'a'.repeat(8001); }],
    ['oversized payload', e => { e.payload.notes = Array.from({ length: 6 }, () => 'a'.repeat(7000)); }],
  ];
  for (const [label, mutate] of rejected) {
    const candidate = event();
    mutate(candidate);
    assert.equal(validEvent(candidate), false, label);
    assert.equal((await post(capital, '/api/capital/events', batch(candidate))).status, 400, label);
  }
  const cited = event(2);
  cited.payload.text = 'Filing https://www.sec.gov/Archives/edgar/data/1/2/3-index.html confirms the number.';
  assert.equal(validEvent(cited), true);
  assert.equal(sourceUrl('https://efts.sec.gov/LATEST/search-index?q=x'), 'https://efts.sec.gov/LATEST/search-index?q=x');
  assert.equal(sourceUrl('https://www.sec.gov:8443/x'), null, 'no alternate ports');
  assert.equal(sourceUrl('https://user:key@www.sec.gov/x'), null, 'no credentials in a citation');
  assert.equal(sourceUrl('https://finance.yahoo.com/quote/MSFT'), 'https://finance.yahoo.com/quote/MSFT');
  assert.equal(validStream('broker:kalshi'), true);
  assert.equal(validEventBatch({ schema_version: 2, events: [event()] }), false);
  assert.equal(validEventBatch({ schema_version: 1, events: [] }), false);
});

test('batches are idempotent by id and a conflicting digest rejects the whole batch', async () => {
  const { capital } = floor();
  assert.equal((await post(capital, '/api/capital/events', batch(event()), { auth: 'wrong-token-but-long-enough-to-compare' })).status, 401);
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(event(1), event(2)))).json(), { stored: 2, replayed: 0 });
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(event(1), event(2)))).json(), { stored: 0, replayed: 2 });
  const rewritten = event(1, { payload: { session_id: 'sess-2026-09-15', text: 'Rewritten history.' }, digest: 'f'.repeat(64) });
  assert.equal((await post(capital, '/api/capital/events', batch(event(3), rewritten))).status, 409);
  const stored = await (await get(capital, '/api/capital/events')).json();
  assert.deepEqual(stored.events.map(e => e.seq), [2, 1], 'the conflicting batch stored nothing');
  assert.equal(stored.latest_seq, 2);
  assert.deepEqual(stored.events[1], { ...event(1), seq: 1 });
  assert.equal((await post(capital, '/api/capital/events', batch(event(4), event(4)))).status, 400);
  assert.equal((await post(capital, '/api/capital/events', batch(...Array.from({ length: 101 }, (_, i) => event(i + 10))))).status, 400);
  assert.equal((await post(capital, '/api/capital/events', `{"schema_version":1,"padding":"${'x'.repeat(MAX_BATCH_BYTES)}"}`)).status, 413);
  assert.equal((await post(capital, '/api/capital/events', '{"schema_version":1,')).status, 400);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/events', { method: 'DELETE' }))).status, 405);
  assert.equal(MAX_EVENTS_KEPT > 1000, true);
});

test('checkpoints publish forward only and the desk roster follows them', async () => {
  const { capital } = floor();
  assert.equal(validCheckpoint(checkpoint()), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint(), { auth: 'short' })).status, 401);
  assert.equal((await get(capital, '/api/capital/checkpoint')).status, 404);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint())).status, 200);
  const read = await get(capital, '/api/capital/checkpoint');
  assert.deepEqual(await read.json(), checkpoint());
  assert.equal((await get(capital, '/api/capital/checkpoint', { 'If-None-Match': read.headers.get('ETag') })).status, 304);
  assert.match(read.headers.get('Cache-Control'), /max-age=5.*no-transform/);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint())).status, 200, 'an identical replay is a no-op');
  const older = checkpoint({ published_at: '2026-09-15T13:00:00.000Z', desks: [desk('earnings-01', { updated_at: '2026-09-15T12:00:00.000Z' })] });
  assert.equal((await post(capital, '/api/capital/checkpoint', older)).status, 409);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint({ published_at: '2026-09-15T15:02:00.000Z' }))).status, 400, 'more than a minute ahead');
  for (const invalid of [
    checkpoint({ desks: [desk('earnings-01', { mode: 'margin' })] }),
    checkpoint({ desks: [desk('earnings-01', { status: 'trading' })] }),
    checkpoint({ desks: [desk('earnings-01', { equity: 50250.25 })] }),
    checkpoint({ desks: [desk('earnings-01', { updated_at: '2026-09-15T14:06:00.000Z' })] }),
    checkpoint({ desks: [desk('earnings-01'), desk('earnings-01')] }),
    checkpoint({ floor: { ...checkpoint().floor, benchmark: { name: 'S&P 500', return_pct: '0.31', source: 'vendor' } } }),
    checkpoint({ committee: { last_memo_at: '2026-09-15T14:06:00.000Z', allocations: {} } }),
    checkpoint({ budget: { spent_today_usd: '-1', cap_usd: '25' } }),
    checkpoint({ secret_notes: 'private' }),
  ]) {
    assert.equal(validCheckpoint(invalid), false);
    assert.equal((await post(capital, '/api/capital/checkpoint', invalid)).status, 400);
  }
  const desks = await (await get(capital, '/api/capital/desks')).json();
  assert.deepEqual(desks, { schema_version: 1, desks: [desk()] });
  assert.deepEqual(await (await get(capital, '/api/capital/desks/earnings-01')).json(), desk());
  assert.equal((await get(capital, '/api/capital/desks/unknown-desk')).status, 404);
  assert.equal((await get(capital, '/api/capital/desks/..%2Fadmin')).status, 404);
  const next = checkpoint({ published_at: '2026-09-15T14:30:00.000Z', desks: [desk('macro-02', { name: 'Macro Carry', family: 'macro', parent_id: 'earnings-01', gate: null })] });
  assert.equal((await post(capital, '/api/capital/checkpoint', next)).status, 200);
  assert.deepEqual((await (await get(capital, '/api/capital/desks')).json()).desks.map(row => row.id), ['macro-02']);
  assert.equal((await get(capital, '/api/capital/desks/earnings-01')).status, 404, 'a retired roster row leaves with its checkpoint');
  assert.equal(validDesk(desk('macro-02', { parent_id: 'macro-02' }), '2026-09-15T14:30:00.000Z'), false);
});

test('public reads page newest first and follow a cursor forward', async () => {
  const { capital } = floor();
  const events = [
    ...Array.from({ length: 6 }, (_, i) => event(i + 1)),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `ledger.earnings-01.mark.${i}`, stream: 'ledger:earnings-01', kind: 'ledger.mark',
      at: `2026-09-15T13:0${i}:00.000Z`, digest: (100 + i).toString(16).padStart(64, '0'),
      payload: { equity: String(50000 + i * 25), cash: '10000', daily_pnl: '25', as_of: `2026-09-15T13:0${i}:00.000Z`, positions: [{ instrument: 'MSFT', quantity: '20', price: '500', market_value: '10000' }] },
    })),
  ];
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(...events))).json(), { stored: 10, replayed: 0 });
  const newest = await (await get(capital, '/api/capital/events')).json();
  assert.deepEqual(newest.events.map(e => e.seq), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?limit=3')).json()).events.map(e => e.seq), [10, 9, 8]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?after=6&limit=2')).json()).events.map(e => e.seq), [7, 8]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?stream=ledger%3Aearnings-01')).json()).events.map(e => e.seq), [10, 9, 8, 7]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?kind=desk.thought&limit=2')).json()).events.map(e => e.seq), [6, 5]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?stream=risk')).json()).events, []);
  for (const query of ['?limit=201', '?limit=0', '?after=-1', '?after=abc', '?stream=Desk:X', '?kind=provider.request', '?cursor=1', '?limit=1&limit=2']) {
    assert.equal((await get(capital, '/api/capital/events' + query)).status, 400, query);
  }
  const page = await get(capital, '/api/capital/events?limit=3');
  assert.match(page.headers.get('Cache-Control'), /max-age=3.*no-transform/);
  assert.equal((await get(capital, '/api/capital/events?limit=3', { 'If-None-Match': page.headers.get('ETag') })).status, 304);
  assert.equal((await capital.fetch(request('POST', '/api/capital/desks', {}))).status, 405);
  assert.equal((await get(capital, '/api/capital/unknown')).status, 404);
});

test('the live tape fans out to matching subscribers only', async () => {
  assert.equal(socketMatches(['all'], 'desk:earnings-01'), true);
  assert.equal(socketMatches(['desk:earnings-01'], 'desk:earnings-01'), true);
  assert.equal(socketMatches(['desk:earnings-01'], 'desk:macro-02'), false);
  assert.equal(socketMatches(['desk:earnings-01', 'risk'], 'risk'), true);
  assert.equal(socketMatches([], 'risk'), false);
  assert.equal(socketMatches('all', 'risk'), false);
  assert.deepEqual(parseStreamTags('desk:earnings-01,risk'), ['desk:earnings-01', 'risk']);
  assert.deepEqual(parseStreamTags(null), ['all']);
  assert.deepEqual(parseStreamTags('all,risk'), ['all']);
  assert.deepEqual(parseStreamTags('desk:earnings-01, desk:earnings-01 '), ['desk:earnings-01']);
  assert.equal(parseStreamTags('desk:earnings-01,not a stream'), null);
  assert.equal(parseStreamTags(Array.from({ length: 9 }, (_, i) => `desk:d${i}`).join(',')), null);
  assert.equal(allowedOrigin('https://blakewoods.us'), true);
  assert.equal(allowedOrigin('http://localhost:4173'), true);
  assert.equal(allowedOrigin('https://blakewoods.us.evil.example'), false);

  const { capital, listen } = floor();
  const deskSocket = listen(['desk:earnings-01']);
  const riskSocket = listen(['risk']);
  const everything = listen(['all']);
  await post(capital, '/api/capital/events', batch(event(1), { ...event(2), stream: 'risk', kind: 'risk.breaker', payload: { scope: 'floor', rule: 'daily-loss', detail: 'stop', action: 'halt' } }));
  assert.deepEqual(deskSocket.received.map(e => e.stream), ['desk:earnings-01']);
  assert.deepEqual(riskSocket.received.map(e => e.kind), ['risk.breaker']);
  assert.equal(everything.received.length, 2);
  assert.equal(everything.received[0].seq, 1);
  await post(capital, '/api/capital/events', batch(event(1)));
  assert.equal(everything.received.length, 2, 'a replay is not rebroadcast');

  const upgrade = await capital.fetch(new Request('https://blakewoods.us/api/capital/stream', { headers: { Origin: 'https://blakewoods.us' } }));
  assert.equal(upgrade.status, 426);
  const websocket = { Upgrade: 'websocket' };
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream', { headers: { ...websocket, Origin: 'https://elsewhere.example' } }))).status, 403);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream', { headers: { ...websocket } }))).status, 403);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream?streams=nope', { headers: { ...websocket, Origin: 'https://blakewoods.us' } }))).status, 400);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream?limit=1', { headers: { ...websocket, Origin: 'https://blakewoods.us' } }))).status, 400);
  for (let index = 0; index < 200; index++) listen(['all']);
  assert.equal((await capital.fetch(new Request('https://blakewoods.us/api/capital/stream', { headers: { ...websocket, Origin: 'https://www.blakewoods.us' } }))).status, 503);

  const { capital: quiet } = floor();
  const socket = { tags: ['all'], received: [], send() { throw new Error('gone'); }, close(code) { this.closed = code; } };
  quiet.ctx.getWebSockets = () => [socket];
  await post(quiet, '/api/capital/events', batch(event(1)));
  assert.equal(socket.closed, 1011, 'a broken socket is closed, not retried');
  quiet.webSocketMessage({ send() { throw new Error('unexpected'); }, close(code) { this.closed = code; } }, 'x'.repeat(2000));
  const keepalive = { sent: [], send(message) { this.sent.push(message); }, close() {} };
  quiet.webSocketMessage(keepalive, 'ping');
  assert.match(keepalive.sent[0], /"type":"pong"/);
  quiet.webSocketMessage(keepalive, 'publish something');
  assert.equal(keepalive.sent.length, 1, 'the tape is one way');
});

test('the floor pages project events and desks without touching markup', () => {
  const thought = tapeLine(event());
  assert.equal(thought.label, 'Thought');
  assert.equal(thought.tone, 'thought');
  assert.equal(thought.source, 'earnings-01');
  assert.match(thought.text, /Margins widened/);
  const fill = tapeLine({ stream: 'broker:alpaca', kind: 'broker.fill', at: event().at, payload: { fill_id: 'f1', order_id: 'o1', instrument: 'MSFT', side: 'buy', quantity: '20', price: '500.25', fee: '0.01' } });
  assert.equal(fill.tone, 'fill');
  assert.match(fill.text, /buy 20 MSFT · @ \$500\.2500/);
  assert.equal(fill.source, 'alpaca broker');
  assert.equal(streamLabel('committee'), 'Helm');
  assert.match(tapeLine({ stream: 'risk', kind: 'risk.decision', at: event().at, payload: { intent_id: 'i1', desk_id: 'earnings-01', approved: false, reasons: ['position cap'] } }).text, /Blocked · earnings-01 · position cap/);
  assert.match(tapeLine({ stream: 'ops', kind: 'ops.alert', at: event().at, payload: { level: 'warning', text: 'Venue slow' } }).text, /warning · Venue slow/);
  assert.equal(tapeLine({ stream: 'lab', kind: 'lab.result', at: event().at, payload: {} }).text, '');
  assert.equal(tapeLine({ stream: 'ops', kind: 'ops.alert', at: event().at, payload: null }).text, '');

  const desks = [desk('a-1', { name: 'Alpha', equity: '1000', return_pct: '-2', gate: null }), desk('b-2', { name: 'Beta', equity: '3000', return_pct: '5.5' }), desk('c-3', { name: 'Gamma', equity: '2000', return_pct: '0', gate: { name: 'g', passed: true, evidence: {} } })];
  assert.deepEqual(sortDesks(desks, 'equity', 'desc').map(d => d.name), ['Beta', 'Gamma', 'Alpha']);
  assert.deepEqual(sortDesks(desks, 'equity', 'asc').map(d => d.name), ['Alpha', 'Gamma', 'Beta']);
  assert.deepEqual(sortDesks(desks, 'return_pct', 'desc').map(d => d.name), ['Beta', 'Gamma', 'Alpha']);
  assert.deepEqual(sortDesks(desks, 'name', 'asc').map(d => d.name), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(sortDesks(desks, 'gate', 'desc').map(d => d.name), ['Gamma', 'Beta', 'Alpha']);
  assert.deepEqual(sortDesks(desks, 'orders', 'desc').map(d => d.name), ['Alpha', 'Beta', 'Gamma'], 'ties keep publication order');
  assert.equal(LEADERBOARD_COLUMNS.length, 11);

  const marks = [0, 1, 2].map(i => ({ kind: 'ledger.mark', at: `2026-09-15T13:0${i}:00.000Z`, payload: { equity: String(50000 + i * 100) } }));
  assert.equal(markSeries(marks.slice(0, 1)), null);
  const series = markSeries(marks);
  assert.equal(series.points.length, 3);
  assert.match(series.path, /^M2\.00,/);
  assert.equal(series.path.split('L').length, 3);
  assert.equal(markSeries([...marks, { kind: 'desk.thought', at: marks[0].at, payload: { text: 'x' } }]).points.length, 3);

  const evolution = [
    { kind: 'evolution.spawned', at: '2026-09-01T00:00:00.000Z', payload: { desk_id: 'macro-02', family: 'macro', parent_id: 'earnings-01', generation: 2, mutation: 'wider stop' } },
    { kind: 'evolution.promoted', at: '2026-09-10T00:00:00.000Z', payload: { desk_id: 'macro-02', from: 'paper', to: 'live' } },
    { kind: 'evolution.retired', at: '2026-09-12T00:00:00.000Z', payload: { desk_id: 'other-09', reason: 'drawdown' } },
  ];
  assert.deepEqual(lineage(evolution, 'macro-02').map(e => e.kind), ['evolution.spawned', 'evolution.promoted']);
  assert.match(lineage(evolution, 'earnings-01')[0].text, /macro-02 spawned from this desk/);

  const fills = [
    { kind: 'broker.fill', stream: 'broker:alpaca', at: '2026-09-15T14:00:00.000Z', payload: { desk_id: 'earnings-01', instrument: 'MSFT', side: 'buy', quantity: '20', price: '500', fee: '0' } },
    { kind: 'broker.fill', stream: 'broker:kalshi', at: '2026-09-15T14:05:00.000Z', payload: { desk_id: 'macro-02', instrument: 'CPI', side: 'sell', quantity: '5', price: '0.44', fee: '0' } },
  ];
  assert.deepEqual(fillRows(fills, 'earnings-01').map(row => row.instrument), ['MSFT']);
  assert.deepEqual(fillRows(fills).map(row => row.venue), ['kalshi broker', 'alpaca broker'], 'newest first');
  assert.equal(fillRows([{ kind: 'broker.fill', stream: 'broker:alpaca', at: fills[0].at, payload: { instrument: 'MSFT' } }], 'earnings-01').length, 1, 'unattributed fills stay visible');
  assert.deepEqual(bookRows([{ kind: 'ledger.mark', at: fills[0].at, payload: { positions: [{ instrument: 'MSFT', quantity: '20', price: '500', market_value: '10000' }] } }]), [{ instrument: 'MSFT', quantity: '20', price: '500', value: '10000' }]);

  assert.equal(money('1234567.891'), '$1,234,567.89');
  assert.equal(money('50000', 0), '$50,000');
  assert.equal(money('49999.6', 0), '$50,000');
  assert.equal(money('0.12345', 4), '$0.1235');
  assert.equal(money('-0.005'), '−$0.01');
  assert.equal(money(null), '—');
  assert.equal(money('1e6'), '—');
  assert.equal(percent('-2.5'), '−2.50%');
  assert.equal(percent('0'), '0.00%');
  assert.equal(streamUrl(['all'], { protocol: 'https:', host: 'blakewoods.us' }), 'wss://blakewoods.us/api/capital/stream');
  assert.equal(streamUrl(['desk:earnings-01', 'ledger:earnings-01'], { protocol: 'http:', host: 'localhost:4173' }), 'ws://localhost:4173/api/capital/stream?streams=desk%3Aearnings-01%2Cledger%3Aearnings-01');
});

test('floor pages carry the disclosure and render through text nodes only', async () => {
  const source = await readFile(new URL('../capital/capital.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|localStorage|sessionStorage|sendBeacon|document\.write/);
  const disclosure = 'Blake Woods owns every position shown. Nothing here is investment advice. Orders publish after they fill.';
  for (const page of ['index.html', 'desk/index.html', 'committee/index.html']) {
    const html = await readFile(new URL('../capital/' + page, import.meta.url), 'utf8');
    assert.match(html, new RegExp(disclosure.replace(/\./g, '\\.')), page);
    assert.match(html, /own fills and account-level marks, never live quotes/, page);
    assert.doesNotMatch(html, /http:\/\/|<script(?![^>]*type="module" *>)[^>]*>(?!\s*<\/script>)/, page);
    assert.match(html, /data-capital="(?:floor|desk|committee)"/, page);
  }
  const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(home, /Woods Capital Management[\s\S]{0,400}A public floor of autonomous AI portfolio managers\./);
  assert.match(home, /href="\/capital\/"/);
  assert.match(home, /href="\/portfolio\/"/, 'the Portfolio Agent link stays');
});

test('the build publishes the floor with hashed, self-hosted assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'woods-capital-build-'));
  try {
    for (const name of ['build.mjs', 'package.json', 'index.html', 'styles.css', 'app.js', 'chart.js', 'favicon.svg', 'admin', 'portfolio', 'capital']) {
      await cp(new URL('../' + name, import.meta.url), join(root, name), { recursive: true });
    }
    assert.equal(spawnSync(process.execPath, ['build.mjs'], { cwd: root, encoding: 'utf8' }).status, 0);
    assert.deepEqual((await readdir(join(root, 'dist/capital'))).sort(), ['committee', 'desk', 'index.html']);
    const floorHtml = await readFile(join(root, 'dist/capital/index.html'), 'utf8');
    assert.match(floorHtml, /\.\.\/assets\/capital\.[a-f0-9]{12}\.css/);
    assert.match(floorHtml, /\.\.\/assets\/capital\.[a-f0-9]{12}\.js/);
    const deskHtml = await readFile(join(root, 'dist/capital/desk/index.html'), 'utf8');
    assert.match(deskHtml, /\.\.\/\.\.\/assets\/capital\.[a-f0-9]{12}\.js/);
    for (const page of ['dist/capital/index.html', 'dist/capital/desk/index.html', 'dist/capital/committee/index.html']) {
      const html = await readFile(join(root, page), 'utf8');
      const directory = join(root, page.slice(0, page.lastIndexOf('/')));
      for (const reference of html.matchAll(/(?:src|href)="((?:\.\.\/)+assets\/[^"]+)"/g)) assert(await readFile(join(directory, reference[1])));
      assert.doesNotMatch(html, /src="https?:/, 'no external scripts');
    }
    const bundle = await readFile(join(root, 'dist/assets/' + (await readdir(join(root, 'dist/assets'))).find(name => /^capital\.[a-f0-9]{12}\.js$/.test(name))), 'utf8');
    assert.match(bundle, /from '\.\/schema\.[a-f0-9]{12}\.js'/);
    assert.doesNotMatch(bundle, /from '\.\/schema\.js'/);
    const headers = await readFile(join(root, 'dist/_headers'), 'utf8');
    for (const path of ['/capital/', '/capital/desk/', '/capital/committee/']) {
      assert.match(headers, new RegExp(`${path}\\n  Cache-Control: public, max-age=0, must-revalidate, no-transform`));
    }
    assert.match(headers, /connect-src 'self' wss:\/\/blakewoods\.us wss:\/\/www\.blakewoods\.us/);
    // The portfolio pages keep their own build output untouched.
    assert.deepEqual((await readdir(join(root, 'dist/portfolio'))).sort(), ['index.html', 'research', 'runtime.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

class StubElement {
  constructor(tag) {
    this.tag = tag; this.children = []; this._text = ''; this.attributes = {};
    this.className = ''; this.dataset = {}; this.listeners = new Map(); this.id = '';
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(' '); }
  append(...nodes) { for (const node of nodes) if (node) this.children.push(node); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes.filter(Boolean); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, handler) { this.listeners.set(name, [...(this.listeners.get(name) || []), handler]); }
  click() { for (const handler of this.listeners.get('click') || []) handler(); }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector) { return this.descendants().find(node => node.id === selector.slice(1)) || null; }
  querySelectorAll() { return []; }
  find(tag) { return this.descendants().filter(node => node.tag === tag); }
}
function floorPage() {
  const root = new StubElement('main');
  root.dataset.capital = 'floor';
  for (const id of ['floor-status', 'floor-summary', 'floor-leaderboard', 'floor-cards', 'floor-tape']) {
    const node = new StubElement('div');
    node.id = id;
    root.append(node);
  }
  return root;
}

test('the floor page mounts a checkpoint, a sortable board and a tape without markup', async () => {
  const root = floorPage();
  const saved = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch, interval: globalThis.setInterval, socket: globalThis.WebSocket };
  const board = [desk('earnings-01'), desk('macro-02', { name: 'Alpha Carry', equity: '90000', return_pct: '9', gate: null, mode: 'live' })];
  const tape = [{ ...event(2), seq: 2 }, { ...event(1), seq: 1 }];
  globalThis.document = {
    createElement: tag => new StubElement(tag),
    createElementNS: (_namespace, tag) => new StubElement(tag),
    querySelector: () => null,
    visibilityState: 'visible',
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.window = { location: { protocol: 'https:', host: 'blakewoods.us', search: '' } };
  globalThis.setInterval = () => 0;
  globalThis.WebSocket = undefined;
  globalThis.fetch = async path => {
    const body = path.startsWith('/api/capital/checkpoint')
      ? checkpoint({ desks: board })
      : { schema_version: 1, latest_seq: 2, events: path.includes('after=') ? [] : tape };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ETag: `"${path}"` } });
  };
  try {
    const feed = await startCapital(root);
    feed.stop();
    const text = root.textContent;
    assert.match(text, /Earnings Drift/);
    assert.match(text, /Alpha Carry/);
    assert.match(text, /\$100,500/, 'floor equity');
    assert.match(text, /Model budget \$4\.21 spent of \$25\.00/);
    assert.match(text, /Margins widened/, 'the tape rendered');
    assert.equal(root.querySelector('#floor-summary').getAttribute('aria-busy'), 'false');
    const rows = () => root.querySelector('#floor-leaderboard').find('tbody')[0].children.map(row => row.children[0].textContent);
    assert.deepEqual(rows(), ['Alpha Carry', 'Earnings Drift'], 'equity sorts descending by default');
    const columns = root.querySelector('#floor-leaderboard').find('button');
    assert.equal(columns.length, LEADERBOARD_COLUMNS.length);
    columns[0].click();
    assert.deepEqual(rows(), ['Earnings Drift', 'Alpha Carry'], 'the desk column sorts by name');
    root.querySelector('#floor-leaderboard').find('button')[0].click();
    assert.deepEqual(rows(), ['Alpha Carry', 'Earnings Drift'], 'a second click reverses it');
    const links = root.find('a').map(node => node.href);
    assert(links.includes('/capital/desk/?id=macro-02'));
    assert(links.every(href => href.startsWith('/') || href.startsWith('https://')), 'no insecure link');
    await Promise.resolve();
  } finally {
    globalThis.document = saved.document; globalThis.window = saved.window;
    globalThis.fetch = saved.fetch; globalThis.setInterval = saved.interval; globalThis.WebSocket = saved.socket;
  }
});

function stubPage(kind, ids) {
  const root = new StubElement('main');
  root.dataset.capital = kind;
  for (const id of ids) { const node = new StubElement('div'); node.id = id; root.append(node); }
  return root;
}
function withBrowser(search, routes, work) {
  const saved = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch, interval: globalThis.setInterval, socket: globalThis.WebSocket };
  globalThis.document = {
    createElement: tag => new StubElement(tag),
    createElementNS: (_namespace, tag) => new StubElement(tag),
    querySelector: () => null, visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
  };
  globalThis.window = { location: { protocol: 'https:', host: 'blakewoods.us', search } };
  globalThis.setInterval = () => 0;
  globalThis.WebSocket = undefined;
  globalThis.fetch = async path => {
    const body = routes(path);
    if (body === null) return new Response('{"error":"Not found."}', { status: 404 });
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ETag: `"${path}"` } });
  };
  return Promise.resolve(work()).finally(() => {
    globalThis.document = saved.document; globalThis.window = saved.window;
    globalThis.fetch = saved.fetch; globalThis.setInterval = saved.interval; globalThis.WebSocket = saved.socket;
  });
}

test('a desk page mounts its manifest, equity line, book, blotter, gate and lineage', async () => {
  const root = stubPage('desk', ['desk-header', 'desk-detail', 'desk-tape', 'desk-status']);
  const marks = [0, 1, 2].map(i => ({
    seq: 20 + i, id: `ledger.earnings-01.mark.${i}`, stream: 'ledger:earnings-01', kind: 'ledger.mark',
    at: `2026-09-15T13:0${i}:00.000Z`, digest: (200 + i).toString(16).padStart(64, '0'),
    payload: { equity: String(50000 + i * 100), cash: '10000', daily_pnl: '100', as_of: `2026-09-15T13:0${i}:00.000Z`, positions: [{ instrument: 'MSFT', quantity: '20', price: '500', market_value: '10000' }] },
  }));
  const fills = [{
    seq: 30, id: 'broker.alpaca.fill.1', stream: 'broker:alpaca', kind: 'broker.fill', at: '2026-09-15T13:30:00.000Z',
    digest: 'a'.repeat(64), payload: { fill_id: 'f1', order_id: 'o1', desk_id: 'earnings-01', instrument: 'MSFT', side: 'buy', quantity: '20', price: '500.25', fee: '0' },
  }];
  const spawned = [{
    seq: 40, id: 'evolution.spawn.1', stream: 'evolution', kind: 'evolution.spawned', at: '2026-09-01T00:00:00.000Z',
    digest: 'b'.repeat(64), payload: { desk_id: 'earnings-01', family: 'earnings', parent_id: null, generation: 1, mutation: 'seeded from the filings bank' },
  }];
  await withBrowser('?id=earnings-01', path => {
    if (path.startsWith('/api/capital/desks/')) return desk();
    if (path.includes('ledger%3Aearnings-01')) return { schema_version: 1, latest_seq: 40, events: marks.slice().reverse() };
    if (path.includes('kind=broker.fill')) return { schema_version: 1, latest_seq: 40, events: fills };
    if (path.includes('stream=evolution')) return { schema_version: 1, latest_seq: 40, events: spawned };
    if (path.includes('desk%3Aearnings-01')) return { schema_version: 1, latest_seq: 40, events: [{ ...event(1), seq: 1 }] };
    return { schema_version: 1, latest_seq: 40, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const text = root.textContent;
    assert.match(text, /Earnings Drift/);
    assert.match(text, /Sixty forward days · not met/);
    assert.match(text, /MSFT/);
    assert.match(text, /Margins widened/);
    assert.match(text, /seeded from the filings bank/);
    assert.equal(root.querySelector('#desk-detail').getAttribute('aria-busy'), 'false');
    const [chart] = root.find('svg');
    assert.equal(chart.find('path').length, 1, 'one equity line drawn from the marks');
    assert.match(chart.find('path')[0].attributes.d, /^M2\.00,/);
  });
});

test('the committee page mounts allocations, gates, memos and the evolution record', async () => {
  const root = stubPage('committee', ['committee-status', 'committee-allocations', 'committee-gates', 'committee-memos', 'committee-evolution']);
  const committee = [
    { seq: 50, id: 'committee.memo.1', stream: 'committee', kind: 'committee.memo', at: '2026-09-14T21:00:00.000Z', digest: 'c'.repeat(64), payload: { period: '2026-W37', text: 'Capital moves to the desks with forward evidence.' } },
    { seq: 51, id: 'committee.gate.1', stream: 'committee', kind: 'committee.gate', at: '2026-09-14T21:05:00.000Z', digest: 'd'.repeat(64), payload: { desk_id: 'earnings-01', gate: 'Sixty forward days', passed: false, evidence: { days: 12 } } },
  ];
  const evolution = [{ seq: 52, id: 'evolution.retired.1', stream: 'evolution', kind: 'evolution.retired', at: '2026-09-14T22:00:00.000Z', digest: 'e'.repeat(64), payload: { desk_id: 'macro-09', reason: 'drawdown breach', score: { forward: '-3.2' } } }];
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint();
    if (path.includes('stream=committee')) return { schema_version: 1, latest_seq: 52, events: committee };
    if (path.includes('stream=evolution')) return { schema_version: 1, latest_seq: 52, events: evolution };
    return { schema_version: 1, latest_seq: 52, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const text = root.textContent;
    assert.match(text, /Earnings Drift/, 'allocations name the desk');
    assert.match(text, /\$50,000/);
    assert.match(text, /Capital moves to the desks with forward evidence\./);
    assert.match(text, /Sixty forward days/);
    assert.match(text, /drawdown breach/);
    assert.equal(root.querySelector('#committee-allocations').getAttribute('aria-busy'), 'false');
  });
});
