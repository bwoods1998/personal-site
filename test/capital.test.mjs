import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, cp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Capital, MAX_EVENTS_KEPT, allowedOrigin } from '../lib/capital.mjs';
import { retiredRoute, RETIRED_TARGET } from '../lib/retired.mjs';
import { createServer } from '../server.mjs';
import {
  validEvent, validEventBatch, validCheckpoint, validDesk, validInfra, validStream, validKindPayload,
  validVenues, validVenueBalance, socketMatches, parseStreamTags, sourceUrl, deskMode, isLive,
  EVENT_KINDS, KIND_STREAMS, MAX_BATCH_BYTES,
} from '../capital/schema.js';
import {
  tapeLine, markSeries, sparkline, nowLine, latestPlaybook, diffLines, allocationSeries, orderDesks,
  partnerOf, partnerName, partnerRole, filterGroup, matchesFilters, truncate, lineage, fillRows, bookRows,
  money, percent, signedMoney, streamUrl, streamLabel, startCapital, PARTNERS, PARTNER_ORDER, TAPE_FILTERS,
  floorCounts, floorEquity, floorDaily, deskCountLine, infraRows, uptimeText, boxShort, cardNumbers, modeBadge,
  accountEquity, accountVenues, portfolioLabel, venueLabel, venueChipText, floorBalanceSeries, sinceStart,
} from '../capital/capital.js';

const token = 'woods-capital-test-publication-token-01';
const NOW = Date.parse('2026-09-15T15:00:00.000Z');

function event(n = 1, overrides = {}) {
  return {
    id: `desk.rosenfeld.thought.${n}`,
    stream: 'desk:rosenfeld',
    kind: 'desk.thought',
    at: `2026-09-15T14:${String(n % 60).padStart(2, '0')}:00.000Z`,
    payload: { session_id: 'sess-2026-09-15', text: 'Margins widened for a third quarter. Waiting for the filing to confirm.' },
    digest: n.toString(16).padStart(64, '0'),
    ...overrides,
  };
}
const batch = (...events) => ({ schema_version: 1, events });
function desk(id = 'rosenfeld', overrides = {}) {
  return {
    id, name: 'Rosenfeld', family: 'rosenfeld', generation: 1, parent_id: null, mode: 'paper',
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
    committee: { last_memo_at: '2026-09-14T21:00:00.000Z', allocations: { rosenfeld: '50000' } },
    budget: { spent_today_usd: '4.21', cap_usd: '25' },
    ...overrides,
  };
}
const infra = (overrides = {}) => ({
  host: 'sailbox', box_id: 'box-9f2c1ad4', checkpoint_count: 118, spend_usd: '4.21',
  uptime_seconds: 93784, region: 'us-east', requests_today: 37, ...overrides,
});
const review = (overrides = {}) => ({
  id: 'risk.review.1', stream: 'risk', kind: 'risk.review', at: '2026-09-15T14:02:00.000Z',
  digest: 'a'.repeat(64),
  payload: { intent_id: 'intent-2026-09-15-01', desk_id: 'merton', verdict: 'approve', reason: 'Inside the position cap and the mandate.', model: 'deterministic-rules-v4' },
  ...overrides,
});
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
    ['uppercase stream', e => { e.stream = 'desk:Rosenfeld'; }],
    ['unknown stream family', e => { e.stream = 'vault:rosenfeld'; }],
    ['timestamp without milliseconds', e => { e.at = '2026-09-15T14:01:00Z'; }],
    ['impossible timestamp', e => { e.at = '2026-09-31T14:01:00.000Z'; }],
    ['short digest', e => { e.digest = 'abc123'; }],
    ['uppercase digest', e => { e.digest = 'A'.repeat(64); }],
    ['spaced id', e => { e.id = 'desk rosenfeld 01'; }],
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

test('risk.review is publishable and carries one fixed payload shape', async () => {
  const { capital } = floor();
  assert.equal(EVENT_KINDS['risk.review'].tone, 'risk');
  assert.equal(validEvent(review()), true);
  assert.equal(validEvent(review({ payload: { ...review().payload, verdict: 'block', reason: 'Order exceeds the daily loss budget.' } })), true);
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(review()))).json(), { stored: 1, replayed: 0 });
  assert.deepEqual((await (await get(capital, '/api/capital/events?kind=risk.review')).json()).events.map(e => e.payload.verdict), ['approve']);
  const rejected = [
    ['unknown verdict', { verdict: 'maybe' }],
    ['missing model', { model: undefined }],
    ['empty reason', { reason: '   ' }],
    ['uppercase desk id', { desk_id: 'Merton' }],
    ['numeric intent', { intent_id: 7 }],
    ['extra field', { severity: 'high' }],
  ];
  for (const [label, patch] of rejected) {
    const payload = { ...review().payload, ...patch };
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete payload[key];
    const candidate = review({ id: `risk.review.${label.replace(/\W/g, '')}`, payload });
    assert.equal(validKindPayload('risk.review', payload), false, label);
    assert.equal(validEvent(candidate), false, label);
    assert.equal((await post(capital, '/api/capital/events', batch(candidate))).status, 400, label);
  }
  // Only the listed kinds are shape-checked; everything else keeps its free-form payload.
  assert.equal(validKindPayload('desk.thought', { anything: 'goes' }), true);
  // review · <desk> · approve/block · reason
  const line = tapeLine(review());
  assert.equal(line.tone, 'risk');
  assert.equal(line.text, 'review · Merton · approve · Inside the position cap and the mandate.');
  assert.equal(line.source, 'Risk engine');
  assert.equal(filterGroup('risk.review'), 'risk');
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
  const older = checkpoint({ published_at: '2026-09-15T13:00:00.000Z', desks: [desk('rosenfeld', { updated_at: '2026-09-15T12:00:00.000Z' })] });
  assert.equal((await post(capital, '/api/capital/checkpoint', older)).status, 409);
  assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint({ published_at: '2026-09-15T15:02:00.000Z' }))).status, 400, 'more than a minute ahead');
  for (const invalid of [
    checkpoint({ desks: [desk('rosenfeld', { mode: 'margin' })] }),
    checkpoint({ desks: [desk('rosenfeld', { status: 'trading' })] }),
    checkpoint({ desks: [desk('rosenfeld', { equity: 50250.25 })] }),
    checkpoint({ desks: [desk('rosenfeld', { updated_at: '2026-09-15T14:06:00.000Z' })] }),
    checkpoint({ desks: [desk('rosenfeld'), desk('rosenfeld')] }),
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
  assert.deepEqual(await (await get(capital, '/api/capital/desks/rosenfeld')).json(), desk());
  assert.equal((await get(capital, '/api/capital/desks/unknown-desk')).status, 404);
  assert.equal((await get(capital, '/api/capital/desks/..%2Fadmin')).status, 404);
  const next = checkpoint({ published_at: '2026-09-15T14:30:00.000Z', desks: [desk('mullins', { name: 'Mullins', family: 'mullins', parent_id: 'rosenfeld', gate: null })] });
  assert.equal((await post(capital, '/api/capital/checkpoint', next)).status, 200);
  assert.deepEqual((await (await get(capital, '/api/capital/desks')).json()).desks.map(row => row.id), ['mullins']);
  assert.equal((await get(capital, '/api/capital/desks/rosenfeld')).status, 404, 'a retired roster row leaves with its checkpoint');
  assert.equal(validDesk(desk('mullins', { parent_id: 'mullins' }), '2026-09-15T14:30:00.000Z'), false);
});

test('public reads page newest first and follow a cursor forward', async () => {
  const { capital } = floor();
  const events = [
    ...Array.from({ length: 6 }, (_, i) => event(i + 1)),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `ledger.rosenfeld.mark.${i}`, stream: 'ledger:rosenfeld', kind: 'ledger.mark',
      at: `2026-09-15T13:0${i}:00.000Z`, digest: (100 + i).toString(16).padStart(64, '0'),
      payload: { equity: String(50000 + i * 25), cash: '10000', daily_pnl: '25', as_of: `2026-09-15T13:0${i}:00.000Z`, positions: [{ instrument: 'MSFT', quantity: '20', price: '500', market_value: '10000' }] },
    })),
  ];
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(...events))).json(), { stored: 10, replayed: 0 });
  const newest = await (await get(capital, '/api/capital/events')).json();
  assert.deepEqual(newest.events.map(e => e.seq), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?limit=3')).json()).events.map(e => e.seq), [10, 9, 8]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?after=6&limit=2')).json()).events.map(e => e.seq), [7, 8]);
  assert.deepEqual((await (await get(capital, '/api/capital/events?stream=ledger%3Arosenfeld')).json()).events.map(e => e.seq), [10, 9, 8, 7]);
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
  assert.equal(socketMatches(['all'], 'desk:rosenfeld'), true);
  assert.equal(socketMatches(['desk:rosenfeld'], 'desk:rosenfeld'), true);
  assert.equal(socketMatches(['desk:rosenfeld'], 'desk:mullins'), false);
  assert.equal(socketMatches(['desk:rosenfeld', 'risk'], 'risk'), true);
  assert.equal(socketMatches([], 'risk'), false);
  assert.equal(socketMatches('all', 'risk'), false);
  assert.deepEqual(parseStreamTags('desk:rosenfeld,risk'), ['desk:rosenfeld', 'risk']);
  assert.deepEqual(parseStreamTags(null), ['all']);
  assert.deepEqual(parseStreamTags('all,risk'), ['all']);
  assert.deepEqual(parseStreamTags('desk:rosenfeld, desk:rosenfeld '), ['desk:rosenfeld']);
  assert.equal(parseStreamTags('desk:rosenfeld,not a stream'), null);
  assert.equal(parseStreamTags(Array.from({ length: 9 }, (_, i) => `desk:d${i}`).join(',')), null);
  assert.equal(allowedOrigin('https://blakewoods.us'), true);
  assert.equal(allowedOrigin('http://localhost:4173'), true);
  assert.equal(allowedOrigin('https://blakewoods.us.evil.example'), false);

  const { capital, listen } = floor();
  const deskSocket = listen(['desk:rosenfeld']);
  const riskSocket = listen(['risk']);
  const everything = listen(['all']);
  await post(capital, '/api/capital/events', batch(event(1), review()));
  assert.deepEqual(deskSocket.received.map(e => e.stream), ['desk:rosenfeld']);
  assert.deepEqual(riskSocket.received.map(e => e.kind), ['risk.review']);
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

test('the retired Portfolio Agent redirects its pages and refuses its API', async () => {
  for (const path of ['/portfolio', '/portfolio/', '/portfolio/research/', '/portfolio/runtime.json']) {
    assert.deepEqual(retiredRoute(path), { status: 301, headers: { Location: RETIRED_TARGET, 'Cache-Control': 'public, max-age=3600' }, body: '' }, path);
  }
  for (const path of ['/api/portfolio', '/api/portfolio/state', '/api/portfolio/research/abc', '/api/portfolio/notifications/test']) {
    const route = retiredRoute(path);
    assert.equal(route.status, 410, path);
    assert.match(JSON.parse(route.body).error, /retired/);
  }
  for (const path of ['/capital/', '/api/capital/events', '/', '/api/exchange', '/portfoliox', '/api/portfoliox']) {
    assert.equal(retiredRoute(path), null, path);
  }

  const server = createServer(() => { throw new Error('No exchange calls expected'); }, { origin: 'http://localhost' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/portfolio', '/portfolio/', '/portfolio/research/', '/portfolio/runtime.js']) {
      const response = await fetch(origin + path, { redirect: 'manual' });
      assert.equal(response.status, 301, path);
      assert.equal(response.headers.get('location'), '/capital/', path);
    }
    for (const path of ['/api/portfolio/state', '/api/portfolio/research']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 410, path);
      assert.match((await response.json()).error, /Long Term Capital Management publishes to \/api\/capital\//);
    }
    // The floor's own pages and modules are still the only public files.
    for (const path of ['/', '/capital/', '/capital/desk/', '/capital/committee/', '/capital/capital.js', '/capital/capital.css', '/capital/schema.js']) {
      assert.equal((await fetch(origin + path)).status, 200, path);
    }
    for (const path of ['/capital/runtime.json', '/capital/desk/capital.js', '/capital/private.json', '/.env', '/.data/credentials.json']) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the floor projects partners, tape lines and filters without touching markup', () => {
  assert.deepEqual(Object.keys(PARTNERS), PARTNER_ORDER);
  assert.deepEqual(PARTNER_ORDER, ['merton', 'rosenfeld', 'hawkins', 'krasker', 'mullins', 'hilibrand']);
  assert.equal(partnerRole(partnerOf('merton')), 'Robert · filings, long horizon · Alpaca');
  assert.equal(partnerRole(partnerOf('rosenfeld')), 'Eric · earnings drift · DeepSeek');
  assert.equal(partnerRole(partnerOf('hawkins')), 'Greg · earnings drift · Kimi');
  assert.equal(partnerRole(partnerOf('krasker')), 'William · earnings drift · GLM');
  assert.equal(partnerRole(partnerOf('mullins')), 'David · Fed & economic events · Kalshi');
  assert.equal(partnerRole(partnerOf('hilibrand')), 'Lawrence · BTC and ETH · Coinbase');
  assert.equal(partnerOf(desk('rosenfeld-02', { family: 'rosenfeld' })).surname, 'Rosenfeld', 'a bred desk keeps the partner name');
  assert.equal(partnerName('rosenfeld-02'), 'Rosenfeld 02');
  assert.equal(partnerName('unknown-desk'), 'unknown-desk');
  assert.equal(partnerOf(desk('lab-07', { name: 'Lab Seven', family: 'lab' })).surname, 'Lab Seven');
  assert.deepEqual(orderDesks([desk('hilibrand'), desk('merton'), desk('mullins')]).map(d => d.id), ['merton', 'mullins', 'hilibrand']);
  assert.equal(streamLabel('desk:merton'), 'Merton');
  assert.equal(streamLabel('committee'), 'Meriwether');
  assert.equal(streamLabel('broker:alpaca'), 'alpaca broker');

  const thought = tapeLine(event());
  assert.equal(thought.label, 'Thought');
  assert.equal(thought.tone, 'thought');
  assert.equal(thought.source, 'Rosenfeld');
  assert.equal(thought.icon, '~');
  assert.equal(thought.group, 'thoughts');
  assert.match(thought.text, /Margins widened/);
  const fill = tapeLine({ stream: 'broker:alpaca', kind: 'broker.fill', at: event().at, payload: { fill_id: 'f1', order_id: 'o1', instrument: 'MSFT', side: 'buy', quantity: '20', price: '500.25', fee: '0.01' } });
  assert.equal(fill.tone, 'fill');
  assert.match(fill.text, /buy 20 MSFT · @ \$500\.2500/);
  assert.equal(fill.group, 'trades');
  assert.match(tapeLine({ stream: 'risk', kind: 'risk.decision', at: event().at, payload: { intent_id: 'i1', desk_id: 'rosenfeld', approved: false, reasons: ['position cap'] } }).text, /Blocked · rosenfeld · position cap/);
  assert.equal(tapeLine({ stream: 'lab', kind: 'lab.result', at: event().at, payload: {} }).text, '');
  assert.equal(tapeLine({ stream: 'ops', kind: 'ops.alert', at: event().at, payload: null }).text, '');
  // Every published kind belongs to exactly one chip.
  for (const kind of Object.keys(EVENT_KINDS)) assert.ok(TAPE_FILTERS.some(filter => filter.key === filterGroup(kind)), kind);
  const active = new Set(['trades', 'risk']);
  assert.equal(matchesFilters(event(), active), false);
  assert.equal(matchesFilters(review(), active), true);
  assert.equal(matchesFilters(event(), new Set()), true, 'no chip selected reads as no filter');
  assert.equal(matchesFilters({ kind: 'unknown.kind' }, active), true);

  const long = truncate('word '.repeat(60), 140);
  assert.equal(long.truncated, true);
  assert.ok(long.text.length <= 141 && long.text.endsWith('…'));
  assert.equal(long.full.length, 299);
  assert.deepEqual(truncate('short thought'), { text: 'short thought', full: 'short thought', truncated: false });

  assert.equal(money('1234567.891'), '$1,234,567.89');
  assert.equal(money('50000', 0), '$50,000');
  assert.equal(money('-0.005'), '−$0.01');
  assert.equal(money(null), '—');
  assert.equal(signedMoney('250.25', 0), '+$250');
  assert.equal(signedMoney('-250.25', 0), '−$250');
  assert.equal(signedMoney('0', 0), '$0');
  assert.equal(percent('-2.5'), '−2.50%');
  assert.equal(streamUrl(['all'], { protocol: 'https:', host: 'blakewoods.us' }), 'wss://blakewoods.us/api/capital/stream');
  assert.equal(streamUrl(['desk:merton', 'ledger:merton'], { protocol: 'http:', host: 'localhost:4173' }), 'ws://localhost:4173/api/capital/stream?streams=desk%3Amerton%2Cledger%3Amerton');
});

test('card sparklines, now lines, playbooks and allocations project from published events only', () => {
  const marks = Array.from({ length: 50 }, (_, i) => ({
    kind: 'ledger.mark', stream: 'ledger:merton', at: new Date(Date.UTC(2026, 8, 15, 10, i)).toISOString(),
    payload: { equity: String(50000 + i * 10) },
  }));
  assert.equal(sparkline(marks.slice(0, 1)), null, 'one mark is not a line');
  const spark = sparkline(marks);
  assert.equal(spark.points.length, 40, 'the newest forty marks only');
  assert.equal(spark.first.equity, 50100, 'the oldest ten are dropped');
  assert.equal(spark.direction, 'positive');
  assert.equal(spark.path.split('L').length, 40);
  assert.match(spark.path, /^M1\.00,/);
  assert.equal(sparkline([...marks].reverse()).path, spark.path, 'order in does not matter');
  const falling = sparkline(marks.map((mark, i) => ({ ...mark, payload: { equity: String(50000 - i * 10) } })));
  assert.equal(falling.direction, 'negative');
  assert.equal(sparkline([...marks, { kind: 'desk.thought', at: marks[0].at, payload: { text: 'x' } }]).points.length, 40);
  const flat = sparkline(marks.slice(0, 3).map(mark => ({ ...mark, payload: { equity: '50000' } })));
  assert.ok(flat.path.split(' ').every(point => Number.isFinite(Number(point.replace(/^[ML]/, '').split(',')[1]))), 'a flat book still draws');

  const recent = [
    { kind: 'desk.thought', at: '2026-09-15T13:00:00.000Z', payload: { text: 'Reading the 10-Q.' } },
    { kind: 'desk.memo', at: '2026-09-15T13:30:00.000Z', payload: { title: 'Why I am holding MSFT', text: 'Long body text.' } },
    { kind: 'desk.tool_call', at: '2026-09-15T14:00:00.000Z', payload: { tool: 'edgar' } },
  ];
  assert.equal(nowLine(recent), 'Why I am holding MSFT', 'a memo shows its title');
  assert.equal(nowLine(recent.slice(0, 1)), 'Reading the 10-Q.');
  assert.equal(nowLine([]), '');
  assert.equal(nowLine([{ kind: 'desk.thought', at: '2026-09-15T13:00:00.000Z', payload: { text: 'word '.repeat(60) } }]).endsWith('…'), true);

  const rewrites = [
    { kind: 'desk.playbook_updated', at: '2026-09-13T02:00:00.000Z', payload: { version: 4, reason: 'Older rewrite.' } },
    { kind: 'desk.playbook_updated', at: '2026-09-15T02:00:00.000Z', payload: { version: 5, reason: 'Stopped paying after day three.', diff: '@@ sizing @@\n-hold 5 days\n+hold 3 days\n context' } },
  ];
  const playbook = latestPlaybook(rewrites);
  assert.equal(playbook.version, '5');
  assert.equal(playbook.reason, 'Stopped paying after day three.');
  assert.equal(latestPlaybook([]), null);
  assert.deepEqual(diffLines(playbook.diff).map(line => line.type), ['meta', 'remove', 'add', 'same']);
  assert.deepEqual(diffLines(['+added', '-dropped']).map(line => line.type), ['add', 'remove']);
  assert.equal(diffLines('--- a/playbook.md')[0].type, 'meta');

  const rounds = [
    { kind: 'committee.allocation', at: '2026-09-08T21:00:00.000Z', payload: { allocations: { merton: '40000', rosenfeld: '30000' } } },
    { kind: 'committee.allocation', at: '2026-09-15T21:00:00.000Z', payload: { allocations: { merton: '50000', rosenfeld: '20000' } } },
    { kind: 'committee.memo', at: '2026-09-15T21:05:00.000Z', payload: { period: '2026-W38', text: 'Memo.' } },
  ];
  const series = allocationSeries(rounds);
  assert.deepEqual(series.desks, ['merton', 'rosenfeld']);
  assert.deepEqual(series.rows.map(row => row.at), ['2026-09-15T21:00:00.000Z', '2026-09-08T21:00:00.000Z'], 'newest round first');
  assert.equal(series.rows[0].amounts.merton, '50000');
  assert.deepEqual(allocationSeries([]).rows, []);

  const chart = markSeries(marks.slice(0, 3));
  assert.equal(chart.points.length, 3);
  assert.match(chart.path, /^M2\.00,/);
  const evolution = [
    { kind: 'evolution.spawned', at: '2026-09-01T00:00:00.000Z', payload: { desk_id: 'rosenfeld-02', family: 'rosenfeld', parent_id: 'rosenfeld', generation: 2, mutation: 'wider stop' } },
    { kind: 'evolution.promoted', at: '2026-09-10T00:00:00.000Z', payload: { desk_id: 'rosenfeld-02', from: 'paper', to: 'live' } },
  ];
  assert.deepEqual(lineage(evolution, 'rosenfeld-02').map(e => e.kind), ['evolution.spawned', 'evolution.promoted']);
  assert.match(lineage(evolution, 'rosenfeld')[0].text, /rosenfeld-02 spawned from this desk/);
  const fills = [
    { kind: 'broker.fill', stream: 'broker:alpaca', at: '2026-09-15T14:00:00.000Z', payload: { desk_id: 'merton', instrument: 'MSFT', side: 'buy', quantity: '20', price: '500', fee: '0' } },
    { kind: 'broker.fill', stream: 'broker:kalshi', at: '2026-09-15T14:05:00.000Z', payload: { desk_id: 'mullins', instrument: 'CPI', side: 'sell', quantity: '5', price: '0.44', fee: '0' } },
  ];
  assert.deepEqual(fillRows(fills, 'merton').map(row => row.instrument), ['MSFT']);
  assert.deepEqual(fillRows(fills).map(row => row.venue), ['kalshi broker', 'alpaca broker'], 'newest first');
  assert.deepEqual(bookRows([{ kind: 'ledger.mark', at: fills[0].at, payload: { positions: [{ instrument: 'MSFT', quantity: '20', price: '500', market_value: '10000' }] } }]),
    [{ instrument: 'MSFT', quantity: '20', price: '500', value: '10000' }]);
});

test('the pages carry the masthead, the disclosure and no external script', async () => {
  const source = await readFile(new URL('../capital/capital.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|localStorage|sessionStorage|sendBeacon|document\.write/);
  const disclosure = 'Blake Woods owns every position shown. Nothing here is investment advice. Orders publish after they fill.';
  const titles = { 'index.html': 'Long Term Capital Management', 'desk/index.html': 'Desk · LTCM', 'committee/index.html': 'Committee · LTCM' };
  for (const [page, title] of Object.entries(titles)) {
    const html = await readFile(new URL('../capital/' + page, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`<title>${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</title>`), page);
    assert.match(html, new RegExp(disclosure.replace(/\./g, '\\.')), page);
    assert.match(html, /own fills and account-level marks, never live quotes/, page);
    assert.doesNotMatch(html, /http:\/\/|<script(?![^>]*type="module" *>)[^>]*>(?!\s*<\/script>)/, page);
    assert.doesNotMatch(html, /\/portfolio\//, page);
    assert.match(html, /data-capital="(?:floor|desk|committee)"/, page);
  }
  const floorHtml = await readFile(new URL('../capital/index.html', import.meta.url), 'utf8');
  assert.match(floorHtml, /Six AI portfolio managers\. Real money\. Every thought public\./);
  assert.match(floorHtml, /Named after the fund that blew up in 1998, as a warning\. No affiliation\./);
  for (const id of ['floor-numbers', 'floor-history', 'floor-partners', 'tape-filters', 'floor-tape', 'floor-status']) assert.match(floorHtml, new RegExp(`id="${id}"`));
  for (const tile of ['Think', 'Check', 'Fund', 'Evolve']) assert.match(floorHtml, new RegExp(`<h3>${tile}</h3>`));
  assert.match(floorHtml, /Read more about the loop/);
  const committeeHtml = await readFile(new URL('../capital/committee/index.html', import.meta.url), 'utf8');
  assert.match(committeeHtml, /<h1 id="committee-title">Meriwether<\/h1>/);
  assert.ok(committeeHtml.indexOf('id="committee-memos"') < committeeHtml.indexOf('id="committee-allocations"'), 'the memo leads the committee page');

  const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(home, /Long Term Capital Management[\s\S]{0,400}Six AI portfolio managers trading real money in public\./);
  assert.match(home, /href="\/capital\/"/);
  assert.doesNotMatch(home, /href="\/portfolio\/"|Portfolio Agent|Woods Capital/, 'the retired project leaves the home page');
});

test('the build publishes the floor with hashed, self-hosted assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ltcm-build-'));
  try {
    for (const name of ['build.mjs', 'package.json', 'index.html', 'styles.css', 'app.js', 'chart.js', 'favicon.svg', 'admin', 'capital']) {
      await cp(new URL('../' + name, import.meta.url), join(root, name), { recursive: true });
    }
    const build = () => spawnSync(process.execPath, ['build.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(build().status, 0);
    assert.deepEqual((await readdir(join(root, 'dist'))).sort(), ['_headers', 'admin', 'assets', 'capital', 'index.html']);
    assert.deepEqual((await readdir(join(root, 'dist/capital'))).sort(), ['committee', 'desk', 'index.html']);
    const floorHtml = await readFile(join(root, 'dist/capital/index.html'), 'utf8');
    assert.match(floorHtml, /\.\.\/assets\/capital\.[a-f0-9]{12}\.css/);
    assert.match(floorHtml, /\.\.\/assets\/capital\.[a-f0-9]{12}\.js/);
    assert.match(await readFile(join(root, 'dist/capital/desk/index.html'), 'utf8'), /\.\.\/\.\.\/assets\/capital\.[a-f0-9]{12}\.js/);
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
    assert.doesNotMatch(headers, /\/portfolio/, 'the retired pages leave the header table');
    // A second build leaves no retired output behind.
    assert.equal(build().status, 0);
    assert.deepEqual((await readdir(join(root, 'dist'))).sort(), ['_headers', 'admin', 'assets', 'capital', 'index.html']);
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
  withClass(name) { return this.descendants().filter(node => String(node.className).split(' ').includes(name)); }
}
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
    querySelector: () => null, visibilityState: 'visible', title: '', addEventListener() {}, removeEventListener() {},
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
const published = (n, overrides) => ({ ...event(n, overrides), seq: n });
function markEvent(id, index) {
  return {
    seq: 100 + index, id: `ledger.${id}.mark.${index}`, stream: `ledger:${id}`, kind: 'ledger.mark',
    at: `2026-09-15T13:0${index}:00.000Z`, digest: (200 + index).toString(16).padStart(64, '0'),
    payload: { equity: String(50000 + index * 100), cash: '10000', daily_pnl: '100', as_of: `2026-09-15T13:0${index}:00.000Z`, positions: [{ instrument: 'MSFT', quantity: '20', price: '500', market_value: '10000' }] },
  };
}

test('the floor page mounts the headline numbers, partner cards and a filterable tape', async () => {
  const root = stubPage('floor', ['floor-status', 'floor-numbers', 'floor-partners', 'tape-filters', 'floor-tape']);
  const board = [desk('merton', { name: 'Merton', family: 'merton', mode: 'live', equity: '90000', return_pct: '9', gate: null }), desk('rosenfeld')];
  const marks = [0, 1, 2].map(index => markEvent('merton', index));
  const longThought = published(3, { id: 'desk.rosenfeld.thought.3', payload: { session_id: 's', text: 'word '.repeat(60).trim() } });
  const tape = [longThought, { ...published(2), seq: 2 }, { ...markEvent('merton', 2), seq: 1 }];
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint({ desks: board });
    if (path.includes('after=')) return { schema_version: 1, latest_seq: 3, events: [] };
    if (path.includes('ledger%3Amerton')) return { schema_version: 1, latest_seq: 3, events: marks };
    if (path.includes('desk%3Amerton')) return { schema_version: 1, latest_seq: 3, events: [published(1, { id: 'desk.merton.thought.1', stream: 'desk:merton', payload: { session_id: 's', text: 'Filing lands at four.' } })] };
    if (path.includes('stream=')) return { schema_version: 1, latest_seq: 3, events: [] };
    return { schema_version: 1, latest_seq: 3, events: tape };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const text = root.textContent;
    assert.match(text, /\$100,500/, 'floor equity');
    assert.match(text, /−\$250/, 'today, signed');
    assert.match(text, /\$4\.21 \/ \$25/, 'inference spent against the cap');
    assert.equal(root.querySelector('#floor-numbers').getAttribute('aria-busy'), 'false');
    const today = root.querySelector('#floor-numbers').find('dd')[1];
    assert.equal(today.className, 'negative', 'a losing day is coloured');

    const cards = root.querySelector('#floor-partners').find('a');
    assert.equal(cards.length, 2);
    assert.deepEqual(cards.map(card => card.href), ['/capital/desk/?id=merton', '/capital/desk/?id=rosenfeld']);
    assert.match(cards[0].textContent, /Merton/);
    assert.match(cards[0].textContent, /Robert · filings, long horizon · Alpaca/);
    assert.match(cards[0].textContent, /live/, 'the mode badge');
    assert.match(cards[0].textContent, /\$90,000/);
    assert.match(cards[0].textContent, /\+9\.00%/);
    assert.match(cards[0].textContent, /Filing lands at four\./, 'the now line');
    assert.match(cards[1].textContent, /Eric · earnings drift · DeepSeek/);
    const [spark] = cards[0].find('svg');
    assert.equal(spark.find('path').length, 1, 'one equity line per card');
    assert.match(spark.find('path')[0].attributes.d, /^M1\.00,/);
    assert.equal(cards[1].find('svg').length, 0, 'a desk with no marks shows no line');

    const chips = () => root.querySelector('#tape-filters').find('button');
    assert.deepEqual(chips().map(chip => chip.textContent), ['thoughts', 'trades', 'risk', 'committee', 'evolution']);
    assert.equal(chips()[0].getAttribute('aria-pressed'), 'true');
    const lines = () => root.querySelector('#floor-tape').withClass('tape-entry');
    assert.equal(lines().length, 3);
    chips()[0].click();
    assert.equal(chips()[0].getAttribute('aria-pressed'), 'false');
    assert.equal(lines().length, 1, 'turning thoughts off leaves the mark');
    assert.doesNotMatch(root.querySelector('#floor-tape').textContent, /Margins widened/);
    chips()[0].click();
    assert.equal(lines().length, 3);

    const expand = root.querySelector('#floor-tape').find('button')[0];
    assert.equal(expand.getAttribute('aria-expanded'), 'false');
    assert.ok(expand.textContent.endsWith('…'), 'a long thought is cut to roughly 140 characters');
    assert.ok(expand.textContent.length <= 141);
    expand.click();
    const reopened = root.querySelector('#floor-tape').find('button')[0];
    assert.equal(reopened.getAttribute('aria-expanded'), 'true');
    assert.equal(reopened.textContent, 'word '.repeat(60).trim());
    const links = root.find('a').map(node => node.href);
    assert(links.every(href => href.startsWith('/') || href.startsWith('https://')), 'no insecure link');
  });
});

test('a desk page mounts its mandate, equity line, playbook diff, book, blotter, gate and lineage', async () => {
  const root = stubPage('desk', ['desk-header', 'desk-detail', 'desk-tape', 'desk-status']);
  const marks = [0, 1, 2].map(index => markEvent('merton', index));
  const deskEvents = [
    published(1, { id: 'desk.merton.thought.1', stream: 'desk:merton', payload: { session_id: 's', text: 'Margins widened for a third quarter.' } }),
    {
      seq: 60, id: 'desk.merton.playbook.5', stream: 'desk:merton', kind: 'desk.playbook_updated', at: '2026-09-15T02:00:00.000Z',
      digest: 'c'.repeat(64), payload: { version: 5, reason: 'The drift stopped paying after day three.', diff: '@@ sizing @@\n-hold 5 days\n+hold 3 days' },
    },
  ];
  const fills = [{
    seq: 30, id: 'broker.alpaca.fill.1', stream: 'broker:alpaca', kind: 'broker.fill', at: '2026-09-15T13:30:00.000Z',
    digest: 'a'.repeat(64), payload: { fill_id: 'f1', order_id: 'o1', desk_id: 'merton', instrument: 'MSFT', side: 'buy', quantity: '20', price: '500.25', fee: '0' },
  }];
  const spawned = [{
    seq: 40, id: 'evolution.spawn.1', stream: 'evolution', kind: 'evolution.spawned', at: '2026-09-01T00:00:00.000Z',
    digest: 'b'.repeat(64), payload: { desk_id: 'merton', family: 'merton', parent_id: null, generation: 1, mutation: 'seeded from the filings bank' },
  }];
  await withBrowser('?id=merton', path => {
    if (path.startsWith('/api/capital/desks/')) return desk('merton', { name: 'Merton', family: 'merton' });
    if (path.includes('ledger%3Amerton')) return { schema_version: 1, latest_seq: 60, events: marks.slice().reverse() };
    if (path.includes('kind=broker.fill')) return { schema_version: 1, latest_seq: 60, events: fills };
    if (path.includes('stream=evolution')) return { schema_version: 1, latest_seq: 60, events: spawned };
    if (path.includes('desk%3Amerton')) return { schema_version: 1, latest_seq: 60, events: deskEvents };
    return { schema_version: 1, latest_seq: 60, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    assert.equal(globalThis.document.title, 'Merton · LTCM');
    const header = root.querySelector('#desk-header').textContent;
    assert.match(header, /Merton/);
    assert.match(header, /Robert · filings, long horizon · Alpaca/);
    assert.match(header, /Reads filings and holds for quarters/, 'the mandate');
    assert.equal(root.querySelector('#desk-header').find('details').length, 1, 'the mandate sits in a details block');
    const detail = root.querySelector('#desk-detail');
    const text = detail.textContent;
    assert.match(text, /Sixty forward days · not met/);
    assert.match(text, /MSFT/);
    assert.match(text, /seeded from the filings bank/);
    assert.match(text, /The drift stopped paying after day three\./, 'the playbook reason');
    assert.equal(detail.getAttribute('aria-busy'), 'false');
    const [chart] = detail.find('svg');
    assert.equal(chart.find('path').length, 1, 'one equity line drawn from the marks');
    assert.match(chart.find('path')[0].attributes.d, /^M2\.00,/);
    const [diff] = detail.find('pre');
    assert.deepEqual(diff.children.map(line => line.className), ['diff-line diff-meta', 'diff-line diff-remove', 'diff-line diff-add']);
    assert.match(root.querySelector('#desk-tape').textContent, /Margins widened/);
  });
});

test('the committee page leads with the memo, then allocations over time, gates and retirements', async () => {
  const root = stubPage('committee', ['committee-status', 'committee-allocations', 'committee-gates', 'committee-memos', 'committee-evolution']);
  const committee = [
    { seq: 50, id: 'committee.memo.1', stream: 'committee', kind: 'committee.memo', at: '2026-09-14T21:00:00.000Z', digest: 'c'.repeat(64), payload: { period: '2026-W37', text: 'Capital moves to the desks with forward evidence.' } },
    { seq: 51, id: 'committee.gate.1', stream: 'committee', kind: 'committee.gate', at: '2026-09-14T21:05:00.000Z', digest: 'd'.repeat(64), payload: { desk_id: 'rosenfeld', gate: 'Sixty forward days', passed: false, evidence: { days: 12 } } },
    { seq: 53, id: 'committee.allocation.1', stream: 'committee', kind: 'committee.allocation', at: '2026-09-14T21:10:00.000Z', digest: 'f'.repeat(64), payload: { allocations: { rosenfeld: '50000', merton: '30000' } } },
  ];
  const evolution = [{ seq: 52, id: 'evolution.retired.1', stream: 'evolution', kind: 'evolution.retired', at: '2026-09-14T22:00:00.000Z', digest: 'e'.repeat(64), payload: { desk_id: 'macro-09', reason: 'drawdown breach', score: { forward: '-3.2' } } }];
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint();
    if (path.includes('stream=committee')) return { schema_version: 1, latest_seq: 53, events: committee };
    if (path.includes('stream=evolution')) return { schema_version: 1, latest_seq: 53, events: evolution };
    return { schema_version: 1, latest_seq: 53, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const memos = root.querySelector('#committee-memos');
    assert.match(memos.textContent, /Capital moves to the desks with forward evidence\./);
    assert.equal(memos.withClass('memo-latest').length, 1, 'the newest memo leads');
    const allocations = root.querySelector('#committee-allocations');
    assert.match(allocations.textContent, /Rosenfeld/, 'allocations name the partner');
    assert.match(allocations.textContent, /\$50,000/);
    assert.deepEqual(allocations.find('th').map(cell => cell.textContent), ['Time', 'Rosenfeld', 'Merton'], 'allocations over time');
    assert.equal(allocations.getAttribute('aria-busy'), 'false');
    assert.match(root.querySelector('#committee-gates').textContent, /Sixty forward days/);
    assert.match(root.querySelector('#committee-evolution').textContent, /drawdown breach/);
  });
});


test('a shadow desk is published, validated and rendered as hypothetical', async () => {
  const { capital } = floor();
  // The runtime's own vocabulary, and the one it used before the rename.
  assert.equal(validDesk(desk('merton', { mode: 'shadow' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { mode: 'paper' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { mode: 'margin' }), '2026-09-15T14:05:00.000Z'), false);
  assert.equal(deskMode('paper'), 'shadow');
  assert.equal(deskMode('live'), 'live');
  assert.equal(isLive({ mode: 'shadow' }), false);
  assert.equal(isLive({ mode: 'paper' }), false);
  assert.equal(isLive({ mode: 'live' }), true);

  // `shadow: true` is ordinary payload data on an order, a fill and a mark.
  const shadowed = kind => event(9, {
    id: `broker.shadow.${kind}`, stream: 'broker:shadow', kind: `broker.${kind}`,
    payload: { order_id: 'o1', intent_id: 'i1', status: 'filled', filled_quantity: '2', shadow: true },
  });
  for (const kind of ['order', 'fill']) assert.equal(validEvent(shadowed(kind)), true);
  const mark = event(10, {
    id: 'ledger.merton.mark.1', stream: 'ledger:merton', kind: 'ledger.mark',
    payload: { equity: '2000', cash: '2000', daily_pnl: '0', positions: [], as_of: '2026-09-15T14:00:00.000Z', shadow: true },
  });
  assert.equal(validEvent(mark), true);
  assert.equal((await post(capital, '/api/capital/events', batch(shadowed('order'), mark))).status, 200);

  // A shadow card leads with the score and names it; a live card leads with the money.
  const shadow = desk('merton', { mode: 'shadow', equity: '2000', return_pct: '3.5' });
  assert.deepEqual(cardNumbers(shadow).map(row => row[1]), ['shadow · hypothetical', 'notional book']);
  assert.equal(cardNumbers(shadow)[0][0], '+3.50%');
  assert.deepEqual(cardNumbers(desk('merton', { mode: 'live' })).map(row => row[1]), ['equity', 'since inception']);
});

test('the floor block separates real equity from the desks competing for it', async () => {
  const { capital } = floor();
  const board = [
    desk('mullins', { mode: 'live', equity: '210.55', return_pct: '5.2' }),
    desk('merton', { mode: 'shadow', equity: '2000', return_pct: '3.5' }),
    desk('krasker', { mode: 'shadow', equity: '1000', return_pct: '-1' }),
  ];
  const body = checkpoint({
    desks: board,
    floor: {
      ...checkpoint().floor, equity: '210.55', daily_pnl: '-1.25',
      live_equity: '210.55', live_daily_pnl: '-1.25', live_desks: 1, shadow_desks: 2,
    },
  });
  assert.equal(validCheckpoint(body), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', body)).status, 200);
  assert.equal(floorEquity(body.floor), '210.55');
  assert.equal(floorDaily(body.floor), '-1.25');
  assert.deepEqual(floorCounts(body), { live: 1, shadow: 2 });
  assert.equal(deskCountLine(body), '1 live desk · 2 shadow desks competing for capital');

  // The counts are optional: an older checkpoint is counted from its own roster.
  const bare = checkpoint({ desks: board });
  assert.equal(validCheckpoint(bare), true);
  assert.deepEqual(floorCounts(bare), { live: 1, shadow: 2 });
  assert.equal(floorEquity(bare.floor), bare.floor.equity, 'no live_equity falls back to the floor');
  assert.equal(deskCountLine(checkpoint({ desks: [board[0]] })), '1 live desk · 0 shadow desks competing for capital');

  for (const invalid of [
    checkpoint({ floor: { ...checkpoint().floor, live_equity: -5 } }),
    checkpoint({ floor: { ...checkpoint().floor, live_equity: '-5' } }),
    checkpoint({ floor: { ...checkpoint().floor, live_daily_pnl: 1.25 } }),
    checkpoint({ floor: { ...checkpoint().floor, shadow_desks: '2' } }),
    checkpoint({ floor: { ...checkpoint().floor, shadow_desks: -1 } }),
    checkpoint({ floor: { ...checkpoint().floor, live_notes: 'private' } }),
  ]) {
    assert.equal(validCheckpoint(invalid), false);
    assert.equal((await post(capital, '/api/capital/checkpoint', invalid)).status, 400);
  }
});

test('the infrastructure block is optional, typed, and rendered from what it carries', async () => {
  const { capital } = floor();
  assert.equal(validCheckpoint(checkpoint()), true, 'a checkpoint without infra still publishes');
  const body = checkpoint({ infra: infra() });
  assert.equal(validCheckpoint(body), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', body)).status, 200);
  assert.deepEqual(await (await get(capital, '/api/capital/checkpoint')).json(), body);
  assert.equal(validInfra({ host: 'local' }), true, 'host alone is enough');
  assert.equal(validInfra({ host: 'local', box_id: null, region: null, spend_usd: null, checkpoint_count: null }), true);

  for (const bad of [
    {}, { box_id: 'b' }, { host: '' }, { host: 'local', hostname: 'blake-macbook' },
    { host: 'local', checkpoint_count: '4' }, { host: 'local', checkpoint_count: -1 },
    { host: 'local', uptime_seconds: 1.5 }, { host: 'local', spend_usd: 4.21 },
    { host: 'local', spend_usd: '-1' }, { host: 'local', region: 'a'.repeat(200) },
  ]) {
    assert.equal(validInfra(bad), false, JSON.stringify(bad));
    assert.equal((await post(capital, '/api/capital/checkpoint', checkpoint({ infra: bad, published_at: '2026-09-15T14:30:00.000Z' }))).status, 400);
  }

  assert.equal(uptimeText(93784), '1d 2h');
  assert.equal(uptimeText(7260), '2h 1m');
  assert.equal(uptimeText(90), '1m');
  assert.equal(uptimeText(null), '');
  assert.equal(boxShort('box-9f2c1ad4e7b6'), '9f2c1ad4');
  assert.equal(boxShort(null), '');

  const rows = new Map(infraRows(body));
  assert.match(rows.get('Host'), /running on a Sail cloud VM/);
  assert.match(rows.get('Host'), /box 9f2c1ad4/);
  assert.match(rows.get('Host'), /us-east/);
  assert.equal(rows.get('Uptime'), '1d 2h');
  assert.equal(rows.get('Checkpoints'), '118');
  assert.equal(rows.get('Sail spend today'), '$4.21 of $25');
  assert.equal(rows.get('Sail requests today'), '37');
  assert.ok(rows.get('Last checkpoint'));
  // Absent facts are left out rather than guessed at, and no infra means no strip.
  const quiet = new Map(infraRows(checkpoint({ infra: { host: 'local' } })));
  assert.equal(quiet.get('Host'), 'running on the owner’s own machine');
  assert.equal(quiet.has('Uptime'), false);
  assert.equal(quiet.has('Sail requests today'), false);
  assert.equal(quiet.get('Sail spend today'), '$4.21 of $25', 'the budget block answers when infra does not');
  assert.deepEqual(infraRows(checkpoint()), []);
});

test('the floor page badges live against shadow and mounts the infrastructure strip', async () => {
  const root = stubPage('floor', ['floor-status', 'floor-numbers', 'floor-infra', 'floor-partners', 'tape-filters', 'floor-tape']);
  const board = [
    desk('mullins', { name: 'Mullins', family: 'mullins', mode: 'live', equity: '210.55', return_pct: '5.2', gate: null }),
    desk('merton', { name: 'Merton', family: 'merton', mode: 'shadow', equity: '2000', return_pct: '3.5', gate: null }),
  ];
  const body = checkpoint({
    desks: board,
    floor: {
      ...checkpoint().floor, equity: '210.55', daily_pnl: '-1.25',
      live_equity: '210.55', live_daily_pnl: '-1.25', live_desks: 1, shadow_desks: 1,
    },
    infra: infra(),
  });
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return body;
    return { schema_version: 1, latest_seq: 1, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const numbers = root.querySelector('#floor-numbers');
    assert.match(numbers.textContent, /\$211/, 'the masthead is the live sleeve, not the shadow books');
    assert.doesNotMatch(numbers.textContent, /\$2,000/, 'a notional book never reaches the floor number');
    assert.match(numbers.textContent, /live desks only/);
    assert.match(numbers.textContent, /1 live desk · 1 shadow desk competing for capital/);

    const strip = root.querySelector('#floor-infra');
    assert.equal(strip.getAttribute('aria-busy'), 'false');
    assert.match(strip.textContent, /running on a Sail cloud VM/);
    assert.match(strip.textContent, /box 9f2c1ad4/);
    assert.match(strip.textContent, /1d 2h/);
    assert.match(strip.textContent, /118/);
    assert.match(strip.textContent, /\$4\.21 of \$25/);
    assert.match(strip.textContent, /37/, 'Sail requests today');
    assert.match(strip.textContent, /The desks think on Sail; their keys never leave Cloudflare; every order passes a risk engine and a critic\./);

    // The founding order decides the grid, so Merton (shadow) leads and Mullins (live) follows.
    const cards = root.querySelector('#floor-partners').find('a');
    const [shadowCard, liveCard] = cards;
    const badges = cards.map(card => card.withClass('badge')[0]);
    assert.deepEqual(badges.map(badge => badge.className), ['badge badge-shadow', 'badge badge-live']);
    assert.equal(badges[1].withClass('badge-dot').length, 1, 'live pulses');
    assert.equal(badges[0].withClass('badge-dot').length, 0, 'shadow does not');
    assert.match(badges[0].getAttribute('title'), /never sent/);
    assert.match(badges[1].getAttribute('title'), /real money/);
    assert.match(liveCard.textContent, /\$211/);
    assert.match(liveCard.textContent, /equity/);
    assert.match(shadowCard.textContent, /shadow · hypothetical/);
    assert.match(shadowCard.textContent, /\+3\.50%/);
    assert.match(shadowCard.textContent, /notional book/);
  });
});

test('a shadow desk page says nothing on it was ever sent', async () => {
  const root = stubPage('desk', ['desk-header', 'desk-detail', 'desk-tape', 'desk-status']);
  await withBrowser('?id=merton', path => {
    if (path.startsWith('/api/capital/desks/')) return desk('merton', { name: 'Merton', family: 'merton', mode: 'shadow' });
    return { schema_version: 1, latest_seq: 1, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const header = root.querySelector('#desk-header').textContent;
    assert.match(header, /shadow/);
    assert.match(header, /Nothing below was sent/);
    assert.match(header, /Notional budget/);
    assert.match(header, /Equity \(hypothetical\)/);
    assert.match(header, /Return \(hypothetical\)/);
    assert.match(root.querySelector('#desk-detail').textContent, /Shadow to live money, on evidence/);
  });
});

test('the pages say shadow, never paper', async () => {
  for (const page of ['index.html', 'desk/index.html', 'committee/index.html']) {
    const html = await readFile(new URL('../capital/' + page, import.meta.url), 'utf8');
    // The one permitted mention is the sentence that rules paper trading out.
    const mentions = (html.match(/paper/gi) || []).length;
    const ruledOut = (html.match(/There is no paper trading here/g) || []).length;
    assert.equal(mentions, ruledOut, `${page} still says paper`);
  }
  const floorHtml = await readFile(new URL('../capital/index.html', import.meta.url), 'utf8');
  assert.match(floorHtml, /id="floor-infra"/);
  assert.match(floorHtml, /What a shadow desk is/);
  // The runtime repository was renamed; every link on the pages follows it.
  const REPO = 'https://github.com/bwoods1998/long-term-capital-management';
  for (const page of ['index.html', 'desk/index.html', 'committee/index.html']) {
    const html = await readFile(new URL('../capital/' + page, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /github\.com\/bwoods1998\/portfolio-agent/, page);
    assert.ok(html.includes(REPO), `${page} links the runtime repository`);
  }
  const script = await readFile(new URL('../capital/capital.js', import.meta.url), 'utf8');
  assert.ok(script.includes(`'${REPO}'`), 'the unavailable-checkpoint notice links the runtime');
  assert.doesNotMatch(script, /portfolio-agent/);
  const css = await readFile(new URL('../capital/capital.css', import.meta.url), 'utf8');
  assert.match(css, /\.badge-shadow/);
  assert.match(css, /prefers-reduced-motion[\s\S]{0,80}badge-dot/);
});

// ---------------------------------------------------------------- the owner's real balances
const venueRow = (name = 'kalshi', overrides = {}) => ({
  venue: name, equity: '492.29', cash: '492.29', as_of: '2026-09-15T14:00:00.000Z', ...overrides,
});
const COINBASE = { equity: '487.40', cash: '12.60' };
const accountFloor = (overrides = {}) => ({
  ...checkpoint().floor, account_equity: '979.69', account_cash: '504.89',
  venues: [venueRow(), venueRow('coinbase', COINBASE)], ...overrides,
});
function floorMark(index = 0, equity = '979.69', overrides = {}) {
  const at = `2026-09-15T13:0${index}:00.000Z`;
  return {
    seq: 300 + index, id: `ops.floor.mark.${index}`, stream: 'ops', kind: 'floor.mark', at,
    digest: (300 + index).toString(16).padStart(64, '0'),
    payload: {
      account_equity: equity, account_cash: '504.89', as_of: at,
      venues: [venueRow('kalshi', { as_of: at }), venueRow('coinbase', { ...COINBASE, as_of: at })],
    },
    ...overrides,
  };
}

test('the floor publishes its real venue balances, and only in one exact shape', async () => {
  const { capital } = floor();
  // floor.mark is the one kind whose name does not name its stream: it is the whole floor's.
  assert.equal(KIND_STREAMS['floor.mark'], 'ops');
  assert.equal(validEvent(floorMark()), true);
  assert.equal((await post(capital, '/api/capital/events', batch(floorMark()))).status, 200);
  const stale = floorMark(1, '979.69');
  stale.payload.venues[0].stale = true;
  assert.equal(validEvent(stale), true, 'a venue that stopped answering still publishes its last row');
  assert.equal((await post(capital, '/api/capital/events', batch(stale))).status, 200);

  assert.equal(validVenueBalance(venueRow()), true);
  assert.equal(validVenues([venueRow(), venueRow('coinbase', COINBASE)]), true);
  assert.equal(validVenues([]), false, 'no venue means no block, never an empty one');
  assert.equal(validVenues([venueRow(), venueRow()]), false, 'one row per venue');

  const broken = [
    ['off its stream', e => { e.stream = 'ledger:mullins'; }],
    ['on a desk stream', e => { e.stream = 'desk:mullins'; }],
    ['missing a field', e => { delete e.payload.account_cash; }],
    ['an extra field', e => { e.payload.note = 'read at noon'; }],
    ['a signed total', e => { e.payload.account_equity = '-1.00'; }],
    ['a numeric total', e => { e.payload.account_equity = 979.69; }],
    ['a stamp without milliseconds', e => { e.payload.as_of = '2026-09-15T13:00:00Z'; }],
    ['no venues at all', e => { e.payload.venues = []; }],
    ['a venue row missing its stamp', e => { delete e.payload.venues[0].as_of; }],
    ['an unnamed venue', e => { e.payload.venues[0].venue = 'Kalshi'; }],
    ['a signed venue balance', e => { e.payload.venues[0].equity = '-1'; }],
    ['a stale flag that is not a flag', e => { e.payload.venues[0].stale = 'yes'; }],
    ['an unknown venue field', e => { e.payload.venues[0].token = 'secret'; }],
    ['more venues than the floor can hold', e => { e.payload.venues = Array.from({ length: 9 }, (_, i) => venueRow(`venue-${i}`)); }],
  ];
  for (const [why, damage] of broken) {
    const event = floorMark(2);
    damage(event);
    assert.equal(validEvent(event), false, why);
    assert.equal((await post(capital, '/api/capital/events', batch(event))).status, 400, why);
  }
  // The exception is floor.mark's alone: every other kind still has to match its stream.
  assert.equal(validEvent({ ...event(), stream: 'ops', kind: 'ledger.mark' }), false);
});

test('the checkpoint carries the account balances beside the ledger, or not at all', async () => {
  const { capital } = floor();
  const body = checkpoint({ floor: accountFloor() });
  assert.equal(validCheckpoint(body), true);
  assert.equal((await post(capital, '/api/capital/checkpoint', body)).status, 200);
  assert.equal(accountEquity(body.floor), '979.69');
  assert.equal(portfolioLabel(body.floor), 'Portfolio · Kalshi + Coinbase');
  assert.deepEqual(accountVenues(body.floor).map(venueChipText), ['Kalshi $492.29', 'Coinbase $487.40']);
  assert.equal(venueLabel('coinbase'), 'Coinbase');
  // A checkpoint from a box with no live venue says nothing about an account, and the page
  // falls back to the ledger's own number rather than showing a zero balance.
  assert.equal(accountEquity(checkpoint().floor), null);
  assert.deepEqual(accountVenues(checkpoint().floor), []);
  assert.equal(portfolioLabel(checkpoint().floor), 'Portfolio');

  for (const invalid of [
    checkpoint({ floor: { ...checkpoint().floor, account_equity: '979.69' } }),
    checkpoint({ floor: accountFloor({ account_cash: undefined }) }),
    checkpoint({ floor: accountFloor({ account_equity: '-1' }) }),
    checkpoint({ floor: accountFloor({ venues: [] }) }),
    checkpoint({ floor: accountFloor({ venues: [venueRow('kalshi', { as_of: '2026-09-15T23:00:00.000Z' })] }) }),
    checkpoint({ floor: accountFloor({ venues: [venueRow('kalshi', { balance: '1' })] }) }),
  ]) {
    assert.equal(validCheckpoint(invalid), false);
    assert.equal((await post(capital, '/api/capital/checkpoint', invalid)).status, 400);
  }
});

test('the floor page leads with the portfolio, its venue chips and the real balance line', async () => {
  const marks = [floorMark(0, '950.00'), floorMark(1, '965.00'), floorMark(2, '979.69')];
  assert.equal(floorBalanceSeries([marks[0]]), null, 'a line needs a second mark');
  assert.equal(sinceStart(marks).amount, '+$29.69');
  assert.equal(sinceStart([]), null);

  const line = tapeLine(floorMark());
  assert.equal(line.label, 'Floor balance');
  assert.equal(line.group, 'trades', 'the balance belongs with the money, not with the alerts');
  assert.match(line.text, /Balance \$979\.69/);
  assert.match(line.text, /Kalshi \$492\.29, Coinbase \$487\.40/);

  const board = [desk('mullins', { name: 'Mullins', family: 'mullins', mode: 'live', equity: '210.55', gate: null })];
  const routes = (body, events) => path => {
    if (path.startsWith('/api/capital/checkpoint')) return body;
    if (path.includes('kind=floor.mark')) return { schema_version: 1, latest_seq: 302, events };
    return { schema_version: 1, latest_seq: 302, events: [] };
  };
  const root = stubPage('floor', ['floor-status', 'floor-numbers', 'floor-history', 'floor-partners', 'tape-filters', 'floor-tape']);
  await withBrowser('', routes(checkpoint({ desks: board, floor: accountFloor() }), marks), async () => {
    const feed = await startCapital(root);
    feed.stop();
    const numbers = root.querySelector('#floor-numbers').textContent;
    assert.match(numbers, /Portfolio · Kalshi \+ Coinbase/, 'the headline names the accounts it added up');
    assert.match(numbers, /\$979\.69/, 'the real balance, not the ledger equity');
    assert.match(numbers, /real account balances/);
    assert.match(numbers, /Kalshi \$492\.29 · Coinbase \$487\.40/, 'one chip per account');
    assert.match(numbers, /−\$250/, "today's P&L still comes from the ledger");

    const history = root.querySelector('#floor-history');
    assert.equal(history.getAttribute('aria-busy'), 'false');
    const [chart] = history.find('svg');
    assert.equal(chart.find('path').length, 1, 'one real-balance line');
    assert.match(history.textContent, /\$950\.00 → \$979\.69/);
    assert.match(history.textContent, /since start \+\$29\.69/);
  });

  // A venue that stopped answering keeps its last balance on the chip and says it is stale.
  const stale = stubPage('floor', ['floor-status', 'floor-numbers', 'floor-history', 'floor-partners', 'tape-filters', 'floor-tape']);
  const outage = accountFloor({ venues: [venueRow('kalshi', { stale: true }), venueRow('coinbase', COINBASE)] });
  await withBrowser('', routes(checkpoint({ desks: board, floor: outage }), []), async () => {
    const feed = await startCapital(stale);
    feed.stop();
    const numbers = stale.querySelector('#floor-numbers');
    assert.match(numbers.textContent, /Kalshi \$492\.29 stale/, 'the stale account is still counted, and labelled');
    const [chip] = numbers.withClass('venue-chip-stale');
    assert.match(chip.getAttribute('title'), /Kalshi did not answer the last balance request/);
    assert.match(stale.querySelector('#floor-history').textContent, /appears with the floor’s first published mark/);
  });
});
