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
  validVenues, validVenueBalance, validBudget, socketMatches, parseStreamTags, sourceUrl, deskMode, isLive,
  validPosition, validMutation, validLiveSession, validExperiment, validCurveRow, validLab, validWatch, validCalibration, validRun,
  EVENT_KINDS, KIND_STREAMS, MAX_BATCH_BYTES,
} from '../capital/schema.js';
import {
  tapeLine, markSeries, latestPlaybook, diffLines, orderDesks,
  partnerOf, partnerName, partnerRole, filterGroup, truncate, lineage, fillRows, bookRows,
  money, percent, signedMoney, streamUrl, streamLabel, startCapital, PARTNERS, PARTNER_ORDER, TAPE_FILTERS,
  modeBadge, accountEquity, accountVenues, venueLabel,
  agoText, typingSchedule, sessionThoughts, idleLine, endReason, thoughtStream, codeRuns,
  liveSessionText, lineageGrid, mutationBadges, changeSummary,
  latestCalibration, familyCalibrations, reliabilitySeries, probabilityText,
  instrumentLabel, profileName, runClock,
  ago, roman, raceName, triggerText, flatLine, raceRows,
  deskSessions, recentItems, actionWords, thoughtText, deskIdentity, deskNumbers, deskRecordLine, strategyRows, deskLessons, leadParagraph, deskPositionRows,
  loopSchedule, loopStatus, loopChanges, liveSleeves, gateProgress, gateLine, reasonText, isDemotion, floorFounded, whenText,
  marketTitle, seriesTitle, quantityText, centsText, heldText, thesisParts, selfImprovingParts, mastheadNumbers,
  RESEARCH, FEED_KINDS, floorName, plainThought, feedLine, feedLines, heroThought, balanceSeries, openPositionRows,
  closedRecord, leaderboardRows, generationGrid, loopCounts, loopCountLine,
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
    ['script uri', e => { e.payload.text = 'then javascript:alert(1) runs'; }],
    ['data uri', e => { e.payload.text = 'see data:text/plain;base64,QQ== for the table'; }],
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
  // Hilibrand's first live thought was refused for the words "from the data:" before a
  // line break. A scheme needs something after its colon; prose does not.
  const prose = event(3);
  prose.payload.text = 'The dates near the end are clearly from the data:\n\nLooking at the last bar, the file: is closed.';
  assert.equal(validEvent(prose), true, 'a colon followed by whitespace is punctuation, not a scheme');
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
  assert.equal(line.text, "cleared Merton's order · Inside the position cap and the mandate.");
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
  assert.equal(partnerName('unknown-desk'), 'Unknown-desk');
  // Desks the partner table does not know still get a name: Scholes, Scholes II, Haghani II once, not twice.
  assert.equal(partnerName('scholes'), 'Scholes');
  assert.equal(partnerName('scholes-2'), 'Scholes II');
  assert.equal(streamLabel('desk:haghani-2'), 'Haghani II');
  assert.equal(raceName(desk('haghani-2', { name: 'Haghani II', family: 'weather', generation: 2 })), 'Haghani II');
  assert.equal(raceName(desk('scholes', { name: 'Scholes', family: 'ranges' })), 'Scholes');
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
  assert.match(fill.text, /bought 20 MSFT · at \$500\.25 · fee \$0\.01/);
  assert.equal(fill.group, 'trades');
  assert.match(tapeLine({ stream: 'risk', kind: 'risk.decision', at: event().at, payload: { intent_id: 'i1', desk_id: 'rosenfeld', approved: false, reasons: ['position cap'] } }).text, /blocked Rosenfeld's order · position cap/);
  assert.equal(tapeLine({ stream: 'lab', kind: 'lab.result', at: event().at, payload: {} }).text, '');
  assert.equal(tapeLine({ stream: 'ops', kind: 'ops.alert', at: event().at, payload: null }).text, '');
  // Every published kind belongs to exactly one chip.
  for (const kind of Object.keys(EVENT_KINDS)) assert.ok(TAPE_FILTERS.some(filter => filter.key === filterGroup(kind)), kind);

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

test('playbooks, marks, lineage and fills project from published events only', () => {
  const marks = Array.from({ length: 50 }, (_, i) => ({
    kind: 'ledger.mark', stream: 'ledger:merton', at: new Date(Date.UTC(2026, 8, 15, 10, i)).toISOString(),
    payload: { equity: String(50000 + i * 10) },
  }));

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
  const titles = { 'index.html': 'Long Term Capital Management', 'desk/index.html': 'Desk · LTCM', 'committee/index.html': 'The loop · LTCM' };
  for (const [page, title] of Object.entries(titles)) {
    const html = await readFile(new URL('../capital/' + page, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`<title>${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</title>`), page);
    // The floor says it in six words; the deep pages keep the long form.
    if (page === 'index.html') assert.match(html, /Blake Woods owns every position\. Not investment advice\./, page);
    else {
      assert.match(html, new RegExp(disclosure.replace(/\./g, '\\.')), page);
      assert.match(html, /own fills and account-level marks, never live quotes/, page);
    }
    assert.doesNotMatch(html, /http:\/\/|<script(?![^>]*type="module" *>)[^>]*>(?!\s*<\/script>)/, page);
    assert.doesNotMatch(html, /\/portfolio\//, page);
    assert.match(html, /data-capital="(?:floor|desk|committee)"/, page);
  }
  const floorHtml = await readFile(new URL('../capital/index.html', import.meta.url), 'utf8');
  assert.match(floorHtml, /AI traders run real money on Kalshi and Coinbase and rewrite themselves from every result\. Watch them think\./);
  assert.match(floorHtml, /A trade becomes a lesson, a lesson a variant, a variant that earns it takes real money\./);
  const floorIds = ['floor-numbers', 'floor-status', 'floor-now', 'floor-feed', 'floor-portfolio', 'floor-positions', 'closed-toggle', 'floor-closed', 'floor-leaders', 'floor-learning'];
  for (const id of floorIds) assert.match(floorHtml, new RegExp(`id="${id}"`), id);
  for (const gone of ['floor-run', 'floor-tape', 'tape-toggle', 'floor-partners', 'floor-more', 'floor-infra', 'floor-race', 'floor-lab']) assert.doesNotMatch(floorHtml, new RegExp(`id="${gone}"`), `${gone} is gone from the floor`);
  // The brief's order: the numbers, live thinking and trades, the portfolio, past trades, who is winning.
  const order = floorIds.map(id => floorHtml.indexOf(`id="${id}"`));
  assert.ok(order.every((index, n) => index > 0 && (n === 0 || index > order[n - 1])), 'numbers, live, portfolio, past trades, partners');
  for (const label of ['Portfolio', 'Profit', 'Self-improving', 'Sail spent', 'Profit per Sail \\$']) assert.match(floorHtml, new RegExp(`<dt>${label}</dt>`), label);
  assert.match(floorHtml, /href="\/capital\/committee\/">Everything ↗/, 'the full record is one link away');
  // The word budget: at most 60 static words above the live feed.
  const aboveFeed = floorHtml.slice(floorHtml.indexOf('<body'), floorHtml.indexOf('id="floor-feed"')).replace(/<[^>]+>/g, ' ').replace(/[—…↗$]/g, ' ');
  const words = aboveFeed.split(/\s+/).filter(word => /[A-Za-z]/.test(word));
  assert.ok(words.length <= 60, `static words above the feed: ${words.length}`);
  const committeeHtml = await readFile(new URL('../capital/committee/index.html', import.meta.url), 'utf8');
  assert.match(committeeHtml, /<h1 id="committee-title">The loop<\/h1>/);
  assert.match(committeeHtml, /Every night the floor breeds variants, scores them on real prices, promotes the ones that earn it and retires the rest\./);
  const loopIds = ['loop-numbers', 'loop-next', 'loop-better', 'loop-race', 'loop-changes', 'loop-capital', 'loop-more'];
  const loopOrder = loopIds.map(id => committeeHtml.indexOf(`id="${id}"`));
  assert.ok(loopOrder.every((index, n) => index > 0 && (n === 0 || index > loopOrder[n - 1])), 'numbers, better, race, what changed, capital, then the memo');
  for (const gone of ['loop-curve', 'committee-lab', 'loop-genome', 'committee-allocations', 'committee-gates', 'committee-evolution', 'committee-memos', 'committee-status']) assert.doesNotMatch(committeeHtml, new RegExp(`id="${gone}"`), gone);
  const deskHtml = await readFile(new URL('../capital/desk/index.html', import.meta.url), 'utf8');
  const deskIds = ['desk-header', 'desk-numbers', 'desk-state', 'desk-now', 'desk-detail'];
  const deskOrder = deskIds.map(id => deskHtml.indexOf(`id="${id}"`));
  assert.ok(deskOrder.every((index, n) => index > 0 && (n === 0 || index > deskOrder[n - 1])), 'who it is, its numbers, now, then the detail');
  for (const gone of ['desk-think', 'desk-tape', 'desk-status', 'think-state']) assert.doesNotMatch(deskHtml, new RegExp(`id="${gone}"`), gone);
  // Fewer words: what a visitor reads before anything loads.
  const staticWords = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  assert.ok(staticWords(deskHtml) < 60, `desk page static words: ${staticWords(deskHtml)}`);
  assert.ok(staticWords(committeeHtml) < 100, `loop page static words: ${staticWords(committeeHtml)}`);

  const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(home, /Long Term Capital Management[\s\S]{0,400}AI partners trading real money in public, rewriting themselves from the results\./);
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
const words = node => node.textContent.replace(/\s+/g, ' ').trim();
const FLOOR_IDS = ['floor-numbers', 'floor-status', 'floor-now', 'floor-feed', 'floor-portfolio', 'floor-positions', 'closed-toggle', 'floor-closed', 'floor-leaders', 'floor-learning'];
const DESK_IDS = ['desk-header', 'desk-numbers', 'desk-state', 'desk-now', 'desk-detail'];
const LOOP_IDS = ['loop-numbers', 'loop-next', 'loop-better', 'loop-race', 'loop-status', 'loop-changes', 'loop-capital', 'loop-more'];
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

test('the floor page mounts the five numbers, the partner thinking now, and a live feed of thinking, research and trades', async () => {
  const root = stubPage('floor', FLOOR_IDS);
  const board = [
    desk('mullins', { name: 'Mullins', family: 'kalshi', mode: 'live', venues: ['kalshi'], gate: null, live_session: liveSession({ session_id: 'mullins:s', trigger: 'cadence:14:00' }) }),
    desk('mullins-2', { name: 'Mullins II', family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', venues: ['kalshi'], gate: null }),
  ];
  const at = minute => `2026-09-15T14:${String(minute).padStart(2, '0')}:00.000Z`;
  const on = (seq, stream, kind, minute, payload) => ({ seq, id: `${stream}:${kind}:${seq}`, stream, kind, at: at(minute), digest: seq.toString(16).padStart(64, '0'), payload });
  const fed = { asset_class: 'event', symbol: 'KXFEDDECISION-26SEP-H25', market_id: 'KXFEDDECISION-26SEP-H25', venue: 'kalshi', right: 'yes' };
  const routes = {
    'desk.thought': [
      on(10, 'desk:mullins', 'desk.thought', 10, { session_id: 'mullins:s', text: '**Hold** the hike: CPI ran `hot`.' }),
      on(3, 'desk:mullins-2', 'desk.thought', 3, { session_id: 'mullins-2:s', text: 'word '.repeat(60).trim() }),
    ],
    'desk.tool_call': [
      on(12, 'desk:mullins', 'desk.tool_call', 12, { session_id: 'mullins:s', tool: 'propose_order', arguments: { side: 'buy', quantity: '10' } }),
      on(11, 'desk:mullins', 'desk.tool_call', 11, { session_id: 'mullins:s', tool: 'news', arguments: { query: 'FOMC', limit: 8 } }),
      on(9, 'desk:mullins-2', 'desk.tool_call', 9, { session_id: 'mullins-2:s', tool: 'event_markets', arguments: { query: 'KXFEDDECISION' } }),
      on(8, 'desk:mullins-2', 'desk.tool_call', 8, { session_id: 'mullins-2:s', tool: 'event_markets', arguments: { query: 'KXFEDDECISION' } }),
    ],
    'broker.fill': [
      on(13, 'broker:kalshi', 'broker.fill', 13, { desk_id: 'mullins', instrument: fed, side: 'buy', quantity: '10.00', price: '0.8800', fee: '0' }),
      on(6, 'broker:kalshi', 'broker.fill', 6, { desk_id: 'mullins-2', instrument: fed, side: 'sell', quantity: '10', price: '1', settlement: true, result: 'yes' }),
      on(5, 'broker:shadow', 'broker.fill', 5, { desk_id: 'mullins-2', instrument: { ...fed, symbol: 'KXBTC-26SEP1614-B75750', market_id: 'KXBTC-26SEP1614-B75750' }, side: 'buy', quantity: '58', price: '0.14', shadow: true }),
    ],
    'desk.outcome': [on(4, 'desk:mullins', 'desk.outcome', 4, { market_id: 'KXFEDDECISION-26SEP-H25', result: 'yes', pnl: '1.32', held_for_hours: '5.4', rationale_excerpt: 'Hike priced below the evidence.' })],
  };
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint({ desks: board, floor: accountFloor(), run: run(), infra: infra() });
    const kind = Object.keys(routes).find(name => path.includes(`kind=${name}&`));
    return { schema_version: 1, latest_seq: 13, events: kind ? routes[kind] : [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const numbers = root.querySelector('#floor-numbers');
    assert.equal(numbers.getAttribute('aria-busy'), 'false');
    assert.equal(numbers.withClass('number').length, 5);
    assert.match(numbers.textContent, /Portfolio \$979\.69/);
    assert.match(numbers.textContent, /Profit \+\$63\.40 \+6\.92%/, 'profit, and its share of what was put in');
    assert.match(numbers.textContent, /Self-improving (?:\d+d \d+h|\d+h \d\dm \d\ds)/);
    assert.match(numbers.textContent, /Sail spent \$41\.97/);
    assert.match(numbers.textContent, /Profit per Sail \$ \+\$1\.51/);
    assert.equal(numbers.withClass('number-profit')[0].find('dd')[0].className, 'positive');

    const now = root.querySelector('#floor-now');
    assert.equal(now.getAttribute('aria-busy'), 'false');
    const hero = now.withClass('now-thought')[0];
    assert.equal(hero.textContent, 'Hold the hike: CPI ran hot.', 'the newest thought, as prose');
    assert.match(now.textContent, /Mullins real money sat down for the 14:00 slot thinking now/);
    assert.match(now.withClass('now-research')[0].textContent, /researching reading news on “FOMC”/);
    assert.deepEqual(now.find('a').map(node => node.href), ['/capital/desk/?id=mullins']);

    const list = root.querySelector('#floor-feed');
    const lines = () => list.withClass('feed-line');
    assert.deepEqual(lines().map(line => line.withClass('feed-kind')[0].textContent), ['trading', 'researching', 'trading', 'trading', 'thinking']);
    assert.match(lines()[0].textContent, /Mullins bought 10 YES on Fed Sep · hike 25bp at 88¢/);
    assert.ok(!lines()[0].className.includes('line-practice'), 'real money is unmarked');
    assert.match(lines()[1].textContent, /Mullins II practice searching Kalshi for Fed decision markets ×2/, 'a desk repeating itself folds into one line');
    assert.match(lines()[2].textContent, /bought 58 YES on BTC \$75,750 bucket · Sep 16 2pm ET at 14¢/);
    assert.ok(lines()[2].className.includes('line-practice'));
    assert.match(lines()[3].textContent, /closed Fed Sep · hike 25bp, settled YES \+\$1\.32/);
    assert.equal(lines()[3].withClass('feed-pnl')[0].className, 'feed-pnl positive');
    assert.doesNotMatch(list.textContent, /propose|settlement|Hold the hike|FOMC/, 'orders, settlements and the hero’s own lines stay out of the feed');
    const thought = lines()[4].find('button')[0];
    assert.equal(thought.getAttribute('aria-expanded'), 'false');
    thought.click();
    assert.equal(lines()[4].find('button')[0].getAttribute('aria-expanded'), 'true', 'a long thought opens in place');
    assert.match(root.querySelector('#floor-status').textContent, /live · polling · 1 partner in session/);
    assert(root.find('a').every(node => node.href.startsWith('/') || node.href.startsWith('https://')), 'no insecure link');
  });

  // Nothing yet: the numbers wait, the live panel says when the next partner sits down.
  const quiet = stubPage('floor', FLOOR_IDS);
  await withBrowser('', path => (path.startsWith('/api/capital/checkpoint') ? checkpoint() : { schema_version: 1, latest_seq: 1, events: [] }), async () => {
    const feed = await startCapital(quiet);
    feed.stop();
    assert.match(words(quiet.querySelector('#floor-numbers')), /Portfolio — Profit — Self-improving — Sail spent — Profit per Sail \$ —/);
    assert.match(quiet.querySelector('#floor-now').textContent, /No partner is in session\./);
    assert.match(quiet.querySelector('#floor-feed').textContent, /Quiet for now\./);
    assert.match(quiet.querySelector('#floor-positions').textContent, /No real-money position open\./);
    assert.match(quiet.querySelector('#floor-closed').textContent, /No trade has closed yet\./);
  });
});

test('a desk page leads with who it is and five numbers, then what it is thinking now, its book, record, strategies and lessons', async () => {
  const root = stubPage('desk', DESK_IDS);
  const at = (minute, second = 0) => `2026-09-15T13:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
  const on = (seq, kind, minute, payload) => ({ seq, id: `desk.mullins.${seq}`, stream: 'desk:mullins', kind, at: at(minute, seq), digest: seq.toString(16).padStart(64, '0'), payload });
  const [s0, s1] = ['mullins:20260915-0810:cadence:08:10', 'mullins:20260915-0930:cadence:09:30'];
  const fed = { asset_class: 'event', symbol: 'KXFEDDECISION-26SEP-H25', market_id: 'KXFEDDECISION-26SEP-H25', venue: 'kalshi', right: 'yes' };
  const routes = {
    'desk.session_started': [on(1, 'desk.session_started', 10, { session_id: s0, trigger: 'cadence:08:10' }), on(10, 'desk.session_started', 30, { session_id: s1, trigger: 'cadence:09:30' })],
    'desk.thought': [
      on(2, 'desk.thought', 10, { session_id: s0, text: 'Morning look: nothing moved.' }),
      on(11, 'desk.thought', 30, { session_id: s1, text: '**Margins** widened for a `third` quarter.' }),
      on(14, 'desk.thought', 31, { session_id: s1, text: 'The hike is priced at 88 cents.' }),
    ],
    'desk.tool_call': [
      on(3, 'desk.tool_call', 10, { session_id: s0, call_id: 'c0', tool: 'end_session', arguments: { summary: 'Nothing to do this morning.' } }),
      on(12, 'desk.tool_call', 30, { session_id: s1, call_id: 'c1', tool: 'news', arguments: { query: 'FOMC' } }),
      on(13, 'desk.tool_call', 30, { session_id: s1, call_id: 'c2', tool: 'news', arguments: { query: 'FOMC' } }),
      on(15, 'desk.tool_call', 31, { session_id: s1, call_id: 'c3', tool: 'propose_order', arguments: { instrument: fed, side: 'buy', quantity: '10', limit_price: '0.88', order_type: 'limit' } }),
      on(16, 'desk.tool_call', 31, { session_id: s1, call_id: 'c4', tool: 'memory_write', arguments: { kind: 'lesson', text: '2026-09-15 13:31Z: a priced hike pays nothing; size down.' } }),
      on(17, 'desk.tool_call', 31, { session_id: s1, call_id: 'c5', tool: 'end_session', arguments: { summary: 'Bought ten hike contracts at 88 cents.' } }),
    ],
    'desk.session_ended': [on(4, 'desk.session_ended', 11, { session_id: s0, reason: 'end_session' }), on(18, 'desk.session_ended', 32, { session_id: s1, reason: 'end_session' })],
    'desk.memo': [on(19, 'desk.memo', 32, { session_id: s1, title: 'Bought the hike', text: 'Priced.' })],
    'desk.outcome': [
      on(21, 'desk.outcome', 41, { market_id: 'KXCPIYOY-26SEP-T2.9', result: 'no', pnl: '-2.00', held_for_hours: '30', rationale_excerpt: '[strategy kalshi_favorites] CPI under the line.' }),
      on(20, 'desk.outcome', 40, { market_id: 'KXFEDDECISION-26SEP-H25', result: 'yes', pnl: '1.32', held_for_hours: '5.4', rationale_excerpt: 'Hike priced below the evidence.' }),
    ],
    'desk.playbook_updated': [on(50, 'desk.playbook_updated', 50, { version: 5, reason: 'The drift stopped paying after day three.', diff: '@@ sizing @@\n-hold 5 days\n+hold 3 days' })],
  };
  const favorites = { name: 'kalshi_favorites', house: true, note: 'house starter', cadence_seconds: 900, runs: 3, intents: 9, approved: 9, errors: 0, fills: 9, settled: 2, wins: 1, settled_pnl_usd: '-0.68', last_run_at: '2026-09-15T13:00:00.000Z', last_notes: '110 favorites in band', params: { yes_max: 0.08, maker: false } };
  await withBrowser('?id=mullins', path => {
    if (path.startsWith('/api/capital/desks/')) {
      return desk('mullins', {
        name: 'Mullins', family: 'kalshi', mode: 'live', venues: ['kalshi'], pnl_usd: '-0.68', return_pct: '-0.23', orders: 12, budget_factor: '0.25', gate: null, strategies: [favorites],
        live_session: liveSession({ session_id: s1, trigger: 'cadence:09:30', started_at: '2026-09-15T13:30:00.000Z' }),
        positions: [position({ instrument: { symbol: 'KXFEDDECISION-26SEP-H25', asset_class: 'event', venue: 'kalshi' }, side: 'yes', quantity: '10', market_value: '8.80', unrealized_pnl: '0.30', thesis: 'The hike is priced below the evidence. More words follow.' }), position({ market_value: '0.10' })],
      });
    }
    const kind = Object.keys(routes).find(name => path.includes(`kind=${name}&`));
    if (kind && path.includes('desk%3Amullins')) return { schema_version: 1, latest_seq: 60, events: routes[kind] };
    return { schema_version: 1, latest_seq: 60, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    assert.equal(globalThis.document.title, 'Mullins · LTCM');
    const header = root.querySelector('#desk-header');
    assert.equal(header.find('h1')[0].textContent, 'Mullins');
    assert.match(words(header), /real money Fed & CPI family · founder/);
    assert.match(header.textContent, /Prices Fed decisions, economic releases/, 'the mandate in one sentence');
    assert.equal(header.find('details').length, 0, 'nothing behind a chevron for a founder');
    const numbers = root.querySelector('#desk-numbers');
    assert.equal(numbers.getAttribute('aria-busy'), 'false');
    assert.equal(numbers.withClass('number').length, 5);
    assert.equal(words(numbers), 'Equity $50,250.25 Lifetime P&L −$0.68 Return −0.23% Trades 12 Compute 0.25×');

    const now = root.querySelector('#desk-now');
    assert.equal(now.getAttribute('aria-busy'), 'false');
    const lines = now.withClass('thoughts')[0].withClass('thought');
    assert.deepEqual(lines.map(line => words(line).replace(/^\d\d:\d\d /, '')), [
      'Margins widened for a third quarter.', 'reading news on “FOMC” ×2', 'The hike is priced at 88 cents.',
      'proposing to buy 10 YES on Fed Sep · hike 25bp at 88¢', 'writing down a lesson',
    ], 'the newest session in order, tool calls in plain words, a repeat folded');
    assert.equal(now.withClass('now-summary')[0].textContent, 'Bought ten hike contracts at 88 cents.', 'the desk’s own summary closes the session');
    const earlier = now.find('details')[0];
    assert.match(earlier.textContent, /earlier sessions · 1/);
    const head = earlier.withClass('session-head')[0];
    assert.match(words(head), /sat down for the 08:10 slot Nothing to do this morning\./);
    head.click();
    assert.equal(head.getAttribute('aria-expanded'), 'true');
    assert.match(earlier.withClass('session-body')[0].textContent, /Morning look: nothing moved\./, 'an earlier session opens in place');
    assert.match(words(root.querySelector('#desk-state')), /^ended .* · Bought the hike$/, 'a session the log has closed is over, whatever the last checkpoint said');

    const detail = root.querySelector('#desk-detail');
    assert.equal(detail.getAttribute('aria-busy'), 'false');
    assert.deepEqual(detail.find('h2').map(node => node.textContent), ['Holdings', 'Record', 'Strategies', 'What it learned']);
    const [holdings, record, strategies, learned] = detail.find('section');
    assert.deepEqual(holdings.find('tbody')[0].find('tr').map(row => row.find('td').slice(0, 4).map(words)), [['Fed Sep · hike 25bp', 'YES', '$8.80', '+$0.30']]);
    assert.match(holdings.withClass('quiet-line')[0].textContent, /1 position under 50¢ not shown\./);
    assert.match(words(record), /Record 2 real-money trades · 1 won · −\$0\.68/);
    assert.deepEqual(record.find('tbody')[0].find('tr').map(row => row.find('td').slice(0, 4).map(words)), [
      ['CPI YoY above 2.9% · Sep', 'lost', '−$2.00', '30h'], ['Fed Sep · hike 25bp', 'won', '+$1.32', '5.4h'],
    ]);
    assert.deepEqual(strategies.find('tbody')[0].find('td').map(words), ['kalshi favorites house starter', '15 min', '3', '9 of 9', '9', '1 of 2 won', '−$0.68']);
    assert.match(strategies.find('details')[0].textContent, /yes max 0\.08 · maker false · last run: 110 favorites in band/, 'settings behind a chevron');
    assert.match(learned.textContent, /playbook v5 .* The drift stopped paying after day three\./);
    const [diff] = learned.find('pre');
    assert.deepEqual(diff.children.map(line => line.className), ['diff-line diff-meta', 'diff-line diff-remove', 'diff-line diff-add']);
    assert.match(learned.withClass('lesson-text')[0].textContent, /^a priced hike pays nothing; size down\.$/, 'a lesson without its date stamp');
    assert.doesNotMatch(detail.textContent, /Calibration|Toolbox|Working orders|Trade stories/, 'no section without data');
  });
});

test('the loop page counts the loop, grids results by generation, runs the race, lists what changed, and shows only the real-money sleeves', async () => {
  const root = stubPage('committee', LOOP_IDS);
  const gate = (failed, evidence = {}) => ({ name: 'A', passed: false, evidence: { days_live: 1, decisions: 3, failed, ...evidence } });
  const board = checkpoint({
    desks: [
      desk('mullins', { name: 'Mullins', family: 'kalshi', mode: 'live', return_pct: '-0.12', pnl_usd: '-0.35', capital_usd: '350', orders: 10, gate: { name: 'B', passed: false, evidence: { failed: 'days_live' } } }),
      desk('mullins-2', { name: 'Mullins II', family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', return_pct: '0.14', pnl_usd: '0.67', capital_usd: '492', mutation: mutation(), gate: gate('days_live, decisions') }),
      desk('scholes', { name: 'Scholes', family: 'ranges', mode: 'shadow', return_pct: '-62.17', pnl_usd: '-53.93', capital_usd: '142', gate: gate('breakers, cost_adjusted_return, days_live, drawdown, reconciliation') }),
      desk('leahy', { name: 'Leahy', family: 'sports-arb', mode: 'shadow', return_pct: '0', pnl_usd: '0', capital_usd: '150', gate: gate('cost_adjusted_return, days_live, decisions, reconciliation') }),
    ],
    committee: { last_memo_at: '2026-09-14T22:00:00.000Z', allocations: { mullins: '350', 'mullins-2': '500', scholes: '142', leahy: '150' } },
    lab: lab({ experiments: [], calibration: { n: 134, brier: '0.1241' } }),
  });
  const ev = (seq, stream, kind, at, payload) => ({ seq, id: `${kind}:${seq}`, stream, kind, at, digest: seq.toString(16).padStart(64, '0'), payload });
  const reasons = { mullins: 'bandit draw +1.2% on 14 decisions', 'mullins-2': 'shadow sleeve: notional scoring budget at manifest capital', scholes: 'shadow sleeve: notional scoring budget at manifest capital', leahy: 'shadow sleeve: notional scoring budget at manifest capital' };
  const committee = [
    ev(1, 'committee', 'committee.allocation', '2026-09-15T18:00:00.000Z', { allocations: { mullins: '300', 'mullins-2': '492', scholes: '142' }, reasons, shadow: { 'mullins-2': true } }),
    ev(5, 'committee', 'committee.allocation', '2026-09-15T20:00:00.000Z', { allocations: { mullins: '350', 'mullins-2': '500', scholes: '142', leahy: '150' }, reasons, shadow: { 'mullins-2': true, scholes: true, leahy: true } }),
  ];
  const memo = ev(6, 'committee', 'committee.memo', '2026-09-15T22:00:00.000Z', { period: '2026-09-15', text: '## Summary\n\nCapital stays where the evidence is: Mullins keeps its sleeve.\n\nScholes went back to a shadow book on drawdown.' });
  const evolution = [
    ev(2, 'evolution', 'evolution.promoted', '2026-09-15T18:39:15.000Z', { desk_id: 'scholes', family: 'ranges', from: 'live', to: 'shadow', reason: 'mandate breach: drawdown 0.676875 >= 0.15' }),
    ev(3, 'evolution', 'evolution.founded', '2026-09-15T18:54:00.000Z', { desk_id: 'leahy', family: 'sports-arb', name: 'Leahy', rationale: 'Sports is Kalshi’s largest category.', universe: 'Kalshi same-game sports totals.', venues: ['kalshi'] }),
    ev(4, 'evolution', 'evolution.spawned', '2026-09-15T19:10:00.000Z', { desk_id: 'mullins-2', family: 'kalshi', parent_id: 'mullins', generation: 2, mutation: mutation({ model_profile: 'glm_asap' }) }),
  ];
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return board;
    if (path.includes('stream=evolution')) return { schema_version: 1, latest_seq: 6, events: evolution };
    if (path.includes('kind=committee.allocation')) return { schema_version: 1, latest_seq: 6, events: committee };
    if (path.includes('kind=committee.memo')) return { schema_version: 1, latest_seq: 6, events: [memo] };
    return { schema_version: 1, latest_seq: 6, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const numbers = root.querySelector('#loop-numbers');
    assert.equal(numbers.getAttribute('aria-busy'), 'false');
    assert.equal(words(numbers), 'Families 3 Partners 4 1 real money Bred 1 Promoted 0 Demoted 1 Retired 0 Founded 1 Experiments 0');
    assert.match(words(root.querySelector('#loop-next')), /^Nightly .*committee 6:00 PM.* evolution 7:00 PM.* lab 8:00 PM.* founding 9:30 PM.* ET$/);

    const better = root.querySelector('#loop-better');
    assert.match(better.withClass('learning-reading')[0].textContent, /^1 of 1 family has a practice child beating the partner that trades real money\.$/);
    assert.deepEqual(better.find('tbody')[0].find('tr')[0].withClass('ladder-cell').map(words), ['−0.1% −$0.35', '+0.1% ★ +$0.67']);
    assert.match(words(better.withClass('ladder-readout')[0]), /^best child: Mullins II · practice · \+0\.1% · \+\$0\.67 · 3 decisions open ↗$/);
    assert.match(better.textContent, /134 forecasts scored, Brier 0\.124/);

    const race = root.querySelector('#loop-race');
    assert.match(race.withClass('learning-reading')[0].textContent, /^Closest to promotion: Mullins II, gate A: 4 of 6 met; short on days live \(1\), decisions \(3\)\.$/);
    const rows = race.withClass('race-row');
    assert.deepEqual(rows.map(row => row.withClass('race-family')[0].find('b')[0].textContent), ['Mullins', 'Scholes', 'Leahy']);
    assert.match(words(rows[1]), /Scholes −62\.17% demoted/, 'a partner moved back to shadow says so');
    assert.match(words(rows[2]), /Leahy sports-arb founded by the floor/);
    assert.equal(rows[0].withClass('race-chip')[1].withClass('gate-on').length, 4, 'the gate meter fills with checks met');

    const changes = root.querySelector('#loop-changes');
    assert.equal(changes.getAttribute('aria-busy'), 'false');
    const items = changes.withClass('change').map(item => words(item.withClass('change-text')[0]));
    assert.deepEqual(items, [
      'Meriwether moved Mullins $300 → $350 bandit draw +1.2% on 14 decisions',
      'Bred Mullins II from Mullins GLM-5.3 · effort high · Prefers fewer, larger decisions and says so when the evidence is thin.',
      'Founded Leahy, a new sports-arb family Kalshi same-game sports totals.',
      'Moved Scholes back to a shadow book mandate breach: drawdown 67.7%, past the 15% limit',
    ], 'newest first; a shadow book resized is not a change; a demotion never reads as a promotion');
    assert.doesNotMatch(changes.textContent, /promoted Scholes|Scholes to real money/i);

    const capital = root.querySelector('#loop-capital');
    assert.deepEqual(capital.find('tbody')[0].find('tr').map(row => row.find('td').map(words)), [['Mullins', '$350.00', '−$0.35', 'bandit draw +1.2% on 14 decisions']]);
    assert.equal(capital.withClass('quiet-line')[0].textContent, '$350.00 of real money in 1 sleeve · 3 shadow partners score against notional books');
    assert.doesNotMatch(capital.textContent, /notional scoring budget/, 'the shadow sleeves are one line, not seventeen');

    const more = root.querySelector('#loop-more');
    assert.match(words(more), /^Meriwether’s memo .+ Capital stays where the evidence is: Mullins keeps its sleeve\. read the memo /);
    assert.match(more.find('details')[0].textContent, /Scholes went back to a shadow book on drawdown\./);
    assert.doesNotMatch(more.textContent, /Calibration/, 'no calibration section without a family scored');
  });
});


test('a shadow desk is published and validated, strategies and working orders included', async () => {
  const { capital } = floor();
  // The runtime's own vocabulary, and the one it used before the rename.
  assert.equal(validDesk(desk('merton', { mode: 'shadow' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { mode: 'paper' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { mode: 'margin' }), '2026-09-15T14:05:00.000Z'), false);
  // Strategies: code the desk deployed to trade for it, with each one's record. Optional.
  const strategy = {
    name: 'hourly_ranges', house: true, cadence_seconds: 300, runs: 12, intents: 5, approved: 4, errors: 0,
    fills: 3, settled: 2, wins: 1, settled_pnl_usd: '-1.25', last_run_at: '2026-09-15T14:00:00.000Z', last_notes: '3 buckets with edge',
  };
  assert.equal(validDesk(desk('merton', { strategies: [strategy] }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { strategies: [] }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { strategies: [{ ...strategy, last_run_at: null, last_notes: '' }] }), '2026-09-15T14:05:00.000Z'), true);
  for (const [label, bad] of Object.entries({
    'a name that is not a module name': { ...strategy, name: 'Hourly Ranges' },
    'a note with markup': { ...strategy, last_notes: '<b>edge</b>' },
    'a run from the future': { ...strategy, last_run_at: '2026-09-15T15:05:00.000Z' },
    'a negative count': { ...strategy, fills: -1 },
    'an extra field': { ...strategy, extra: 'x' },
    'a missing field': Object.fromEntries(Object.entries(strategy).filter(([k]) => k !== 'wins')),
  })) assert.equal(validDesk(desk('merton', { strategies: [bad] }), '2026-09-15T14:05:00.000Z'), false, label);
  assert.equal(validDesk(desk('merton', { strategies: [strategy, strategy] }), '2026-09-15T14:05:00.000Z'), false, 'duplicate names');
  assert.equal(validDesk(desk('merton', { strategies: [{ ...strategy, note: 'promoted from merton-2: 14 settled, +0.120 per $', params: { min_edge: 0.01, window: '5m', symbols: ['BTC-USD'] } }] }), '2026-09-15T14:05:00.000Z'), true, 'a note and params ride along');
  assert.equal(validDesk(desk('merton', { strategies: [{ ...strategy, note: 'x'.repeat(201) }] }), '2026-09-15T14:05:00.000Z'), false, 'a note is 200 characters at most');
  assert.equal(validDesk(desk('merton', { strategies: [{ ...strategy, params: { note: '<b>' } }] }), '2026-09-15T14:05:00.000Z'), false, 'params are a safe payload');
  // Working orders: what the desk is bidding and offering now. Optional.
  const working = {
    order_id: 'ord-abc', instrument: { symbol: 'KXBTC-26SEP1602-B75750', asset_class: 'event', venue: 'kalshi', market_id: 'KXBTC-26SEP1602-B75750', right: 'no' },
    side: 'buy', quantity: '13', limit_price: '0.75', submitted_at: '2026-09-15T14:00:00.000Z', purpose: 'entry', strategy: 'hourly_quotes', intent_id: 'oi-1',
  };
  assert.equal(validDesk(desk('merton', { working: [working], budget_factor: '1.50' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { working: [{ ...working, limit_price: null, strategy: null, intent_id: null, submitted_at: null }] }), '2026-09-15T14:05:00.000Z'), true);
  for (const [label, bad] of Object.entries({
    'a side that is not buy or sell': { ...working, side: 'hold' },
    'a strategy name with spaces': { ...working, strategy: 'Hourly Quotes' },
    'an order from the future': { ...working, submitted_at: '2026-09-15T15:05:00.000Z' },
    'an extra field': { ...working, note: 'x' },
  })) assert.equal(validDesk(desk('merton', { working: [bad] }), '2026-09-15T14:05:00.000Z'), false, label);
  assert.equal(validDesk(desk('merton', { working: [working, working] }), '2026-09-15T14:05:00.000Z'), false, 'duplicate order ids');
  assert.equal(validDesk(desk('merton', { budget_factor: '0' }), '2026-09-15T14:05:00.000Z'), false, 'a zero budget factor');
  assert.equal(validDesk(desk('merton', { budget_factor: '11' }), '2026-09-15T14:05:00.000Z'), false, 'an absurd budget factor');
  assert.equal(validDesk(desk('merton', { strategies: Array.from({ length: 9 }, (_, i) => ({ ...strategy, name: `s${i}` })) }), '2026-09-15T14:05:00.000Z'), false, 'too many');
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
  // The counts are optional: an older checkpoint still publishes.
  assert.equal(validCheckpoint(checkpoint({ desks: board })), true);
  // The masthead's portfolio is real money: the live ledger when no account balance was read.
  assert.equal(mastheadNumbers(body)[0].value, '$210.55');
  assert.doesNotMatch(mastheadNumbers(body).map(item => item.value).join(' '), /2,000|1,000/, 'a notional book never reaches the headline');

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

test('the infrastructure block is optional and typed', async () => {
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
});

test('a desk may say when it next sits down, or that it never does', () => {
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('rosenfeld', { next_session_at: '2026-09-15T19:30:00.000Z' })] })), true);
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('rosenfeld', { next_session_at: null })] })), true);
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('rosenfeld', { next_session_at: 'soon' })] })), false);
});

test('a calibration record may be scored by generation, the curve\'s own unit', () => {
  const record = event(11, { stream: 'lab', kind: 'lab.calibration', payload: {
    scope: 'generation', desk_id: null, family: 'kalshi', generation: 1, n: 3, brier: '0.0825',
    reliability: [{ bin: '0.9-1.0', forecast_mean: '0.9300', outcome_rate: '1.0000', n: 1 }],
    as_of: '2026-09-15T23:59:59.999Z', since: '2026-09-15T20:00:00.000Z',
  } });
  assert.equal(validEvent(record), true);
  assert.equal(validEvent({ ...record, payload: { ...record.payload, scope: 'decade' } }), false);
});

test('positions and exit plans validate in the shapes the floor really publishes', () => {
  // A holding the floor could not tie to an intent carries null ids; a desk-initiated market
  // exit carries kind "desk" and no price yet; an instrument carries its venue fields.
  const holding = {
    instrument: { symbol: 'KXBTCD-26SEP15-T76000', asset_class: 'event', venue: 'kalshi' }, side: 'yes', quantity: '20',
    entry_price: '0.56', mark_price: '0.6', market_value: '12.0', unrealized_pnl: '0.8', opened_at: '2026-09-15T22:00:00.000Z',
    thesis: '', intent_id: null, session_id: null, target_price: null, stop_price: null, time_stop_at: null,
    exit_orders: [{ id: 'ord-2', kind: 'desk', price: null }, { id: 'ord-1', kind: 'target', price: '0.95' }],
  };
  assert.equal(validPosition(holding, '2026-09-15T23:00:00.000Z'), true);
  assert.equal(validPosition({ ...holding, exit_orders: [{ id: 'x', kind: 'panic', price: null }] }, '2026-09-15T23:00:00.000Z'), false);
  assert.equal(validPosition({ ...holding, intent_id: 7 }, '2026-09-15T23:00:00.000Z'), false);
  const plan = event(9, { kind: 'desk.exit_plan', payload: {
    intent_id: 'oi-abc', instrument: { asset_class: 'event', symbol: 'KXBTCD-26SEP15-T76000', venue: 'kalshi', multiplier: '1', expiry: null, strike: null, right: 'yes', market_id: 'KXBTCD-26SEP15-T76000', currency: 'USD' },
    target_price: '0.95', stop_price: '0.40', time_stop_at: '2026-09-17T23:00:00.000Z', venue_native: false, order_ids: [], entry_side: 'buy', quantity: '20',
  } });
  assert.equal(validEvent(plan), true);
  assert.equal(validEvent({ ...plan, payload: { ...plan.payload, entry_side: 'hold' } }), false);
  assert.equal(validEvent({ ...plan, payload: { ...plan.payload, instrument: { ...plan.payload.instrument, colour: 'red' } } }), false);
});

test('the runway spend policy is accepted, and refused when it is not arithmetic', () => {
  const runway = {
    spent_today_usd: '0.10', cap_usd: '269.82', mode: 'open', balance_usd: '279.82', spendable_usd: '269.82',
    runway_days: '385.4', burn_usd_per_day: '0.70', reserve_usd: '10', desk_fuse_usd: '67.45',
  };
  assert.equal(validBudget(runway), true);
  assert.equal(validCheckpoint(checkpoint({ budget: runway })), true);
  assert.equal(validBudget({ spent_today_usd: '4.21', cap_usd: '25' }), true, 'the capped policy still publishes');
  assert.equal(validBudget({ ...runway, mode: 'panic' }), false);
  assert.equal(validBudget({ ...runway, runway_days: 'soon' }), false);
  assert.equal(validBudget({ ...runway, balance_usd: null, runway_days: null, mode: 'unknown' }), true, 'an unread balance is null, not zero');
  assert.equal(validBudget({ ...runway, extra: '1' }), false);
});

test('a shadow desk page says practice, and a page with nothing published yet says so without empty sections', async () => {
  const root = stubPage('desk', DESK_IDS);
  await withBrowser('?id=merton', path => {
    if (path.startsWith('/api/capital/desks/')) return desk('merton', { name: 'Merton', family: 'merton', mode: 'shadow' });
    return { schema_version: 1, latest_seq: 1, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    assert.match(words(root.querySelector('#desk-header')), /^Merton practice merton family · founder Reads filings/);
    assert.match(words(root.querySelector('#desk-numbers')), /^Equity \$50,250\.25 practice /);
    assert.match(root.querySelector('#desk-state').textContent, /no session yet/);
    assert.match(root.querySelector('#desk-now').textContent, /Nothing said yet\./);
    assert.equal(root.querySelector('#desk-detail').children.length, 0, 'no header over an empty section');
  });
  const lost = stubPage('desk', DESK_IDS);
  await withBrowser('?id=Not A Desk', () => null, async () => {
    assert.equal(await startCapital(lost), null);
    assert.match(lost.querySelector('#desk-header').textContent, /No such desk/);
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
  assert.deepEqual(accountVenues(body.floor).map(row => `${row.name} ${money(row.equity, 2)}`), ['Kalshi $492.29', 'Coinbase $487.40']);
  assert.equal(venueLabel('coinbase'), 'Coinbase');
  // A checkpoint from a box with no live venue says nothing about an account, and the page
  // falls back to the ledger's own number rather than showing a zero balance.
  assert.equal(accountEquity(checkpoint().floor), null);
  assert.deepEqual(accountVenues(checkpoint().floor), []);

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

test('the portfolio leads with the accounts and the balance line, cut after money moved in or out', async () => {
  const marks = [floorMark(0, '950.00'), floorMark(1, '965.00'), floorMark(2, '979.69')];
  assert.equal(balanceSeries([marks[0]]), null, 'a line needs a second mark');
  const series = balanceSeries(marks);
  assert.equal(series.points.length, 3);
  assert.equal(series.changeText, '+$29.69');
  assert.equal(series.tone, 'positive');
  assert.equal(series.flowCut, false);
  assert.match(series.path, /^M0\.0,/);
  assert.ok(series.area.endsWith('Z'));
  // A deposit is not a gain: a step of more than 15% of the balance starts the line again.
  const deposit = [floorMark(0, '497.21'), floorMark(1, '976.11'), floorMark(2, '960.15')];
  const afterDeposit = balanceSeries(deposit);
  assert.equal(afterDeposit.flowCut, true);
  assert.equal(afterDeposit.first.equity, 976.11);
  assert.equal(afterDeposit.changeText, '−$15.96');
  // So is money leaving one venue, even when the total moves less.
  const venueMoved = (index, total, kalshi, coinbase) => floorMark(index, total, { payload: { account_equity: total, account_cash: '1', as_of: floorMark(index).at,
    venues: [venueRow('kalshi', { equity: kalshi, cash: kalshi, as_of: floorMark(index).at }), venueRow('coinbase', { equity: coinbase, cash: coinbase, as_of: floorMark(index).at })] } });
  const transfer = balanceSeries([venueMoved(0, '1000', '500', '500'), venueMoved(1, '900', '500', '400'), venueMoved(2, '905', '505', '400')]);
  assert.equal(transfer.points.length, 2, 'a venue losing a fifth in one mark is a transfer');
  assert.equal(balanceSeries([]), null);

  const line = tapeLine(floorMark());
  assert.equal(line.label, 'Floor balance');
  assert.match(line.text, /Kalshi \$492\.29, Coinbase \$487\.40/);

  const board = [desk('mullins', { name: 'Mullins', family: 'mullins', mode: 'live', equity: '210.55', gate: null })];
  const routes = (body, events) => path => {
    if (path.startsWith('/api/capital/checkpoint')) return body;
    if (path.includes('kind=floor.mark')) return { schema_version: 1, latest_seq: 302, events };
    return { schema_version: 1, latest_seq: 302, events: [] };
  };
  const root = stubPage('floor', FLOOR_IDS);
  await withBrowser('', routes(checkpoint({ desks: board, floor: accountFloor(), run: run({ sessions_today: 7 }) }), marks), async () => {
    const feed = await startCapital(root);
    feed.stop();
    const portfolio = root.querySelector('#floor-portfolio');
    assert.equal(portfolio.getAttribute('aria-busy'), 'false');
    assert.match(portfolio.withClass('venues')[0].textContent, /^Kalshi \$492\.29 Coinbase \$487\.40/, 'each account');
    assert.equal(portfolio.find('svg').length, 1, 'the balance line');
    assert.match(words(portfolio.withClass('balance-caption')[0]), /since .*\+\$29\.69 · now \$979\.69/);
    assert.match(root.querySelector('#floor-positions').textContent, /No real-money position open\. \$980 in cash across Kalshi and Coinbase\./);
    assert.match(root.querySelector('#floor-numbers').textContent, /Portfolio \$979\.69/);
  });

  // A venue that stopped answering keeps its last balance and says it is stale.
  const stale = stubPage('floor', FLOOR_IDS);
  const outage = accountFloor({ venues: [venueRow('kalshi', { stale: true }), venueRow('coinbase', COINBASE)] });
  await withBrowser('', routes(checkpoint({ desks: board, floor: outage }), []), async () => {
    const feed = await startCapital(stale);
    feed.stop();
    const accounts = stale.querySelector('#floor-portfolio').withClass('venues')[0];
    assert.match(accounts.textContent, /Kalshi \$492\.29 stale/, 'the stale account is still shown, and labelled');
    const [chip] = accounts.withClass('venue-stale');
    assert.match(chip.getAttribute('title'), /Kalshi did not answer the last balance request/);
    assert.equal(stale.querySelector('#floor-portfolio').find('svg').length, 0, 'no marks, no line');
  });
});

// ------------------------------------------------------------------ contract v2: the leap
const position = (overrides = {}) => ({
  instrument: { symbol: 'BTC-USD', asset_class: 'crypto', venue: 'coinbase' }, side: 'long', quantity: '0.0100',
  entry_price: '76800.00', mark_price: '77210.50', market_value: '772.10', unrealized_pnl: '4.10', opened_at: '2026-09-15T13:00:00.000Z',
  thesis: 'Trend continuation on the daily bars; invalid under 75,500.', target_price: '80000', stop_price: '75500',
  time_stop_at: '2026-09-18T13:00:00.000Z', exit_orders: [{ id: 'o-tp', kind: 'target', price: '80000' }, { id: 'o-sl', kind: 'stop', price: '75500' }],
  ...overrides,
});
const mutation = (overrides = {}) => ({
  model_profile: 'pro_flex', reasoning_effort: 'high', session_shift_minutes: 45, memory_limit: 80,
  persona_trait: 'Prefers fewer, larger decisions and says so when the evidence is thin.', model_changed: false, ...overrides,
});
const liveSession = (overrides = {}) => ({ session_id: 'hilibrand:20260915-1400:cadence:14:00', trigger: 'cadence:14:00', started_at: '2026-09-15T14:00:00.000Z', ...overrides });
const experiment = (overrides = {}) => ({
  experiment_id: 'exp-0123456789ab', hypothesis: 'Mullins trades better with a slot before the close.', family: 'kalshi', parent_id: 'mullins',
  change: { 'cadence.sessions': ['08:10', '13:30', '16:30'], 'model.reasoning_effort': 'high' }, variant_desk_id: 'mullins-4', status: 'running',
  proposed_at: '2026-09-15T02:00:00.000Z', evaluate_after: '2026-09-18T02:00:00.000Z', ...overrides,
});
const curveRow = (generation, overrides = {}) => ({
  generation, desks: 2, decisions: 14, cost_usd: '1.20', pnl_usd: '12.50', cost_adjusted_excess_pct: '1.2', brier: '0.21', pnl_per_inference_usd: '10.4', ...overrides,
});
const lab = (overrides = {}) => ({ experiments: [experiment()], curve: [curveRow(1), curveRow(2, { cost_adjusted_excess_pct: '2.1', brier: '0.18' })], calibration: { n: 12, brier: '0.18' }, ...overrides });
const watch = (overrides = {}) => ({ triggers_today: 12, wakes_today: 3, last_trigger_at: '2026-09-15T14:02:00.000Z', cost_today_usd: '0.31', ...overrides });
const forecast = (overrides = {}) => ({
  id: 'mullins:20260915-1829:cadence:13:30:e0020', stream: 'desk:mullins', kind: 'desk.forecast', at: '2026-09-15T18:32:00.000Z', digest: 'd'.repeat(64),
  payload: { session_id: 'mullins:20260915-1829:cadence:13:30', market: 'KXFEDDECISION-26SEP-H25', venue: 'kalshi', probability: '0.93', market_price: '0.89', side: 'yes', resolves_at: '2026-09-16T18:00:00.000Z', reasoning: 'Reuters poll and a hot CPI; the market is a few cents shy of the evidence.' },
  ...overrides,
});
const exitPlan = (overrides = {}) => ({
  id: 'hilibrand:20260915-1830:cadence:18:30:e0030', stream: 'desk:hilibrand', kind: 'desk.exit_plan', at: '2026-09-15T18:40:00.000Z', digest: 'e'.repeat(64),
  payload: { intent_id: 'oi-abc123', instrument: { symbol: 'BTC-USD', asset_class: 'crypto', venue: 'coinbase' }, target_price: '80000', stop_price: '75500', time_stop_at: '2026-09-18T13:00:00.000Z', venue_native: true, order_ids: ['tp-1', 'sl-1'] },
  ...overrides,
});
const calibration = (overrides = {}) => ({
  id: 'lab:calibration:mullins:2026-09-15', stream: 'lab', kind: 'lab.calibration', at: '2026-09-15T21:00:00.000Z', digest: 'f'.repeat(64),
  payload: { scope: 'desk', desk_id: 'mullins', family: 'kalshi', generation: 1, n: 12, brier: '0.18',
    reliability: [{ bin: '0.8-0.9', forecast_mean: '0.86', outcome_rate: '0.83', n: 6 }, { bin: '0.9-1.0', forecast_mean: '0.93', outcome_rate: '1', n: 6 }],
    as_of: '2026-09-15T21:00:00.000Z', since: '2026-09-10T00:00:00.000Z' },
  ...overrides,
});

test('contract v2: forecasts, exit plans and calibration carry fixed shapes; the other new kinds publish free-form', async () => {
  const { capital } = floor();
  for (const kind of ['desk.watch', 'desk.forecast', 'desk.exit_plan', 'desk.code_run', 'lab.calibration', 'lab.experiment', 'lab.verdict']) {
    assert.ok(EVENT_KINDS[kind], kind);
  }
  assert.equal(validEvent(forecast()), true);
  assert.equal(validEvent(exitPlan()), true);
  assert.equal(validEvent(calibration()), true);
  assert.deepEqual(await (await post(capital, '/api/capital/events', batch(forecast(), exitPlan(), calibration()))).json(), { stored: 3, replayed: 0 });
  const refused = [
    ['a probability above one', forecast({ payload: { ...forecast().payload, probability: '1.2' } })],
    ['an unknown side', forecast({ payload: { ...forecast().payload, side: 'maybe' } })],
    ['a forecast with an extra field', forecast({ payload: { ...forecast().payload, confidence: 'high' } })],
    ['an exit plan without an instrument venue', exitPlan({ payload: { ...exitPlan().payload, instrument: { symbol: 'BTC-USD', asset_class: 'crypto' } } })],
    ['an exit plan whose bracket flag is a string', exitPlan({ payload: { ...exitPlan().payload, venue_native: 'yes' } })],
    ['calibration outside its scopes', calibration({ payload: { ...calibration().payload, scope: 'universe' } })],
    ['calibration with a rate above one', calibration({ payload: { ...calibration().payload, reliability: [{ bin: 'x', forecast_mean: '0.5', outcome_rate: '1.5', n: 1 }] } })],
    ['a forecast on the wrong stream', forecast({ stream: 'lab' })],
  ];
  for (const [label, candidate] of refused) {
    assert.equal(validEvent(candidate), false, label);
    assert.equal((await post(capital, '/api/capital/events', batch({ ...candidate, id: `${candidate.id}:${label.replace(/\W/g, '')}` }))).status, 400, label);
  }
  // Free-form kinds keep the ordinary payload rules and nothing more.
  const watchEvent = published(7, { id: 'hilibrand:watch:1', stream: 'desk:hilibrand', kind: 'desk.watch', payload: { trigger: 'price_move', detail: 'BTC fell 2.1% in an hour', decision: 'wake', reason: 'A held thesis is under its invalidation.', cost_usd: '0.0007' } });
  assert.equal(validEvent(watchEvent), true);
  assert.equal(validEvent(published(8, { id: 'lab:exp:1', stream: 'lab', kind: 'lab.experiment', payload: experiment() })), true);
  assert.equal(validEvent(published(9, { id: 'lab:verdict:1', stream: 'lab', kind: 'lab.verdict', payload: { experiment_id: 'exp-0123456789ab', status: 'adopted', evidence: {}, reason: 'Beat its parent on cost-adjusted return for four days.', as_of: '2026-09-19T02:00:00.000Z' } })), true);
  assert.equal(validEvent(published(10, { id: 'lab:exp:bad', stream: 'desk:mullins', kind: 'lab.experiment', payload: experiment() })), false, 'a lab kind stays on the lab stream');
});

test('the checkpoint carries positions, mutations, live sessions, the lab and the watch, or nothing at all', () => {
  const rich = checkpoint({
    desks: [desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', venues: ['coinbase'], positions: [position()], live_session: liveSession(), calibration: { n: 3, brier: '0.12', since: '2026-09-10T00:00:00.000Z' } }),
      desk('hilibrand-2', { name: 'Hilibrand II', family: 'crypto', generation: 2, parent_id: 'hilibrand', mode: 'shadow', venues: ['coinbase'], positions: [], mutation: mutation() })],
    lab: lab(), watch: watch(),
  });
  assert.equal(validCheckpoint(rich), true);
  assert.equal(validCheckpoint(checkpoint()), true, 'an older floor publishes none of it');
  assert.equal(validPosition(position(), '2026-09-15T14:05:00.000Z'), true);
  const badPositions = [
    ['an unknown side', position({ side: 'flat' })],
    ['an extra field', position({ leverage: '2' })],
    ['too many exit orders', position({ exit_orders: Array.from({ length: 9 }, (_, index) => ({ id: `o${index}`, kind: 'target', price: '1' })) })],
    ['an exit order of an unknown kind', position({ exit_orders: [{ id: 'o', kind: 'hope', price: '1' }] })],
    ['a P&L that is not a number', position({ unrealized_pnl: 'up' })],
    ['a thesis with markup', position({ thesis: '<b>buy</b>' })],
    ['opened after the checkpoint', position({ opened_at: '2026-09-15T15:00:00.000Z' })],
  ];
  for (const [label, candidate] of badPositions) assert.equal(validPosition(candidate, '2026-09-15T14:05:00.000Z'), false, label);
  assert.equal(validPosition(position({ thesis: '', target_price: null, stop_price: null, time_stop_at: null, exit_orders: [] }), '2026-09-15T14:05:00.000Z'), true, 'a bare position is still a position');
  assert.equal(validMutation(mutation()), true);
  assert.equal(validMutation(mutation({ session_shift_minutes: 5000 })), false);
  assert.equal(validMutation(mutation({ model_changed: 'no' })), false);
  assert.equal(validLiveSession(liveSession(), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validLiveSession(liveSession({ started_at: '2026-09-15T14:06:00.000Z' }), '2026-09-15T14:05:00.000Z'), false, 'a session cannot start after the checkpoint that reports it');
  assert.equal(validExperiment(experiment()), true);
  assert.equal(validExperiment(experiment({ verdict_reason: 'Beat its parent.' })), true);
  assert.equal(validExperiment(experiment({ experiment_id: 'exp-1' })), false);
  assert.equal(validExperiment(experiment({ status: 'maybe' })), false);
  assert.equal(validExperiment(experiment({ change: { _secret: 1 } })), false, 'no private keys in a change');
  assert.equal(validCurveRow(curveRow(3)), true);
  assert.equal(validCurveRow(curveRow(3, { brier: null })), true);
  assert.equal(validCurveRow(curveRow(3, { pnl_usd: 'lots' })), false);
  assert.equal(validLab(lab()), true);
  assert.equal(validLab(lab({ curve: [curveRow(1), curveRow(1)] })), false, 'one row per generation');
  assert.equal(validLab(lab({ experiments: [experiment(), experiment()] })), false, 'one row per experiment');
  assert.equal(validWatch(watch(), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validWatch(watch({ wakes_today: 13 }), '2026-09-15T14:05:00.000Z'), false, 'a desk cannot be woken more often than it was looked at');
  assert.equal(validWatch(watch({ last_trigger_at: null }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validCheckpoint(checkpoint({ lab: { experiments: [], curve: [] } })), false, 'the lab block is exact');
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('x', { positions: [position({ side: 'flat' })] })] })), false);
  assert.equal(validCalibration(calibration().payload), true);
  assert.equal(validCalibration({ ...calibration().payload, since: '2026-09-16T00:00:00.000Z' }), false, 'since cannot follow as_of');
});

test('the lineage and the lab project from the checkpoint', () => {
  const board = checkpoint({
    desks: [
      desk('mullins-2', { name: 'Mullins II', family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', venues: ['kalshi'], mutation: mutation({ model_profile: 'kimi_flex', model_changed: true, session_shift_minutes: -45 }),
        positions: [position({ instrument: { symbol: 'KXFED-26SEP-T3.75', asset_class: 'event', venue: 'kalshi' }, side: 'yes', quantity: '10', entry_price: '0.89', mark_price: '0.91', market_value: '9.10', unrealized_pnl: '0.20', thesis: 'A hike is 93% likely.', target_price: null, stop_price: null, time_stop_at: null, exit_orders: [] })] }),
      desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', venues: ['coinbase'], positions: [position()], live_session: liveSession() }),
      desk('mullins', { name: 'Mullins', family: 'kalshi', mode: 'live', venues: ['kalshi'], positions: [] }),
    ],
    lab: lab(), watch: watch(),
  });
  assert.equal(liveSessionText(board.desks[1]), 'live now · cadence 14 00');
  assert.equal(liveSessionText(board.desks[2]), '');

  const grid = lineageGrid(board.desks);
  assert.deepEqual(grid.families, ['kalshi', 'crypto'], 'founders lead, in partner order');
  assert.deepEqual(grid.generations, [1, 2]);
  assert.deepEqual(grid.rows[0].cells.map(cell => cell.desks.map(d => d.id)), [['mullins'], ['hilibrand']]);
  assert.deepEqual(grid.rows[1].cells.map(cell => cell.desks.map(d => d.id)), [['mullins-2'], []]);
  const badges = mutationBadges(board.desks[0].mutation);
  assert.deepEqual(badges.map(badge => badge.text), ['Kimi K2.6', 'effort high', '−45 min', 'memory 80', 'Prefers fewer, larger decisions and says so when the…']);
  assert.equal(badges[0].changed, true);
  assert.deepEqual(mutationBadges(null), []);
  assert.equal(profileName('glm_flash_asap'), 'GLM-5.3 Flash');
  assert.equal(profileName('k3'), 'Kimi K3');
  assert.equal(profileName('mystery'), 'mystery');

  assert.equal(changeSummary({ 'model.profile': 'kimi_flex', limits: { max_position_pct: '0.2' }, playbook_note: 'x' }), 'profile Kimi K2.6 · limits max position pct 0.2 · house view added');
  assert.equal(probabilityText('0.93'), '93%');
  assert.equal(probabilityText('1'), '100%');
  assert.equal(probabilityText('93'), '—');
  assert.equal(instrumentLabel({ symbol: 'ETH-USD', asset_class: 'crypto', venue: 'coinbase' }), 'ETH-USD');
  assert.equal(instrumentLabel('MSFT'), 'MSFT');
});

test('calibration and tape lines read the lab', () => {
  assert.equal(latestCalibration([calibration()], { scope: 'desk', desk_id: 'mullins' }).n, 12);
  assert.equal(latestCalibration([calibration()], { scope: 'desk', desk_id: 'hilibrand' }), null);
  const families = familyCalibrations([
    calibration({ id: 'c1', payload: { ...calibration().payload, scope: 'family', desk_id: null, family: 'kalshi', n: 20, brier: '0.2' } }),
    calibration({ id: 'c2', at: '2026-09-16T21:00:00.000Z', payload: { ...calibration().payload, scope: 'family', desk_id: null, family: 'kalshi', n: 25, brier: '0.19', as_of: '2026-09-16T21:00:00.000Z' } }),
    calibration({ id: 'c3', payload: { ...calibration().payload, scope: 'family', desk_id: null, family: 'crypto', n: 2, brier: '0.3' } }),
  ]);
  assert.deepEqual(families.map(row => [row.family, row.n]), [['crypto', 2], ['kalshi', 25]], 'the newest per family');
  const reliability = reliabilitySeries(calibration().payload.reliability);
  assert.equal(reliability.points.length, 2);
  assert.deepEqual(reliability.points.map(point => point.forecast), ['86%', '93%']);
  assert.equal(reliability.points[1].y.toFixed(1), '10.0', 'a 100% outcome rate sits at the top');
  assert.equal(reliabilitySeries([]).points.length, 0);

  assert.equal(tapeLine({ kind: 'desk.watch', stream: 'desk:hilibrand', payload: { trigger: 'price_move', detail: 'BTC fell 2.1% in an hour', decision: 'wake', reason: 'A held thesis is under its invalidation.' } }).text,
    'price move: woke the desk · BTC fell 2.1% in an hour · A held thesis is under its invalidation.');
  assert.equal(tapeLine({ kind: 'desk.watch', stream: 'desk:hilibrand', payload: { trigger: 'headline', decision: 'ignore', reason: 'Old news.' } }).text, 'headline: let it pass · Old news.');
  assert.equal(tapeLine(forecast()).text, 'puts 93% on KXFEDDECISION-26SEP-H25 yes · market 89% · Reuters poll and a hot CPI; the market is a few cents shy of the evidence.');
  assert.match(tapeLine(exitPlan()).text, /^exit plan for BTC-USD · target \$80,000\.00 · stop \$75,500\.00 · out by .+ · held at the venue$/);
  assert.equal(tapeLine({ kind: 'desk.exit_plan', stream: 'desk:mullins', payload: { ...exitPlan().payload, venue_native: false, order_ids: ['a'] } }).text.split(' · ').at(-1), '1 exit order resting');
  assert.equal(tapeLine({ kind: 'desk.exit_plan', stream: 'desk:mullins', payload: { ...exitPlan().payload, venue_native: false, order_ids: [] } }).text.split(' · ').at(-1), 'the floor enforces it');
  assert.equal(tapeLine({ kind: 'desk.code_run', stream: 'desk:mullins', payload: { session_id: 's', code_sha256: 'x', language: 'python', stdout: 'brier 0.18\nn 12', exit_code: 0, seconds: '1.4', sandbox: null } }).text, 'ran code in 1.4s · brier 0.18');
  assert.equal(tapeLine(calibration()).text, 'Mullins scored · 12 forecasts · Brier 0.18');
  assert.equal(tapeLine({ kind: 'lab.experiment', stream: 'lab', payload: experiment() }).text, 'running: Mullins trades better with a slot before the close. · as Mullins 4');
  assert.equal(tapeLine({ kind: 'lab.verdict', stream: 'lab', payload: { experiment_id: 'exp-0123456789ab', status: 'adopted', reason: 'Beat its parent.' } }).text, 'adopted exp-0123456789ab · Beat its parent.');
  assert.equal(tapeLine({ kind: 'broker.order', stream: 'broker:coinbase', payload: { status: 'filled', purpose: 'exit', exit_reason: 'time_stop', filled_quantity: '0.01', average_price: '77000' } }).text, 'exit on time stop · filled · filled 0.01 · at $77,000.00');
  assert.equal(tapeLine({ kind: 'desk.forecast', stream: 'desk:mullins', payload: forecast().payload }).tone, 'forecast');
  assert.equal(tapeLine({ kind: 'desk.watch', stream: 'desk:mullins', payload: {} }).icon, '◉');
});

test('the floor lists real-money positions with their reasons, past trades behind a practice toggle, the leaderboard and the generations', async () => {
  const root = stubPage('floor', FLOOR_IDS);
  const austin = position({
    instrument: { symbol: 'KXHIGHAUS-26SEP16-B100.5', asset_class: 'event', venue: 'kalshi' }, side: 'no', quantity: '23.00', entry_price: '0.4300', mark_price: '0.4350',
    market_value: '10.005000', unrealized_pnl: '0.115000', thesis: '[strategy daily_temps] Austin forecast high 101F (sigma 2.5F) against the 100° to 101° market settling in 24h: p=0.305, shrunk to 0.440 against the market’s 0.57; NO at 0.43 has 0.110 of edge after fees. Holds to settlement.',
  });
  const board = checkpoint({
    floor: accountFloor(), run: run(),
    desks: [
      desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', venues: ['coinbase'], return_pct: '1.2', pnl_usd: '4.10', capital_usd: '341.67', orders: 30, positions: [position(), position({ market_value: '0.12', instrument: { symbol: 'ETH-USD', asset_class: 'crypto', venue: 'coinbase' } })], live_session: liveSession() }),
      desk('hilibrand-2', { name: 'Hilibrand II', family: 'crypto', generation: 2, parent_id: 'hilibrand', mode: 'shadow', venues: ['coinbase'], return_pct: '0.4', pnl_usd: '1.00', capital_usd: '250', mutation: mutation(), positions: [position({ thesis: 'Shadow copy.' })] }),
      desk('haghani', { name: 'Haghani', family: 'weather', mode: 'live', venues: ['kalshi'], return_pct: '-20.6', pnl_usd: '-21.63', capital_usd: '104.93', positions: [austin] }),
      desk('haghani-2', { name: 'Haghani II', family: 'weather', generation: 2, parent_id: 'haghani', mode: 'shadow', venues: ['kalshi'], return_pct: '-2.6', pnl_usd: '-3.95', capital_usd: '150', positions: [austin] }),
    ],
    lab: lab({ experiments: [] }),
  });
  const outcome = (seq, id, pnl) => ({ seq, id: `outcome:${id}:${seq}`, stream: `desk:${id}`, kind: 'desk.outcome', at: `2026-09-15T13:${String(seq).padStart(2, '0')}:00.000Z`, digest: seq.toString(16).padStart(64, '0'),
    payload: { market_id: 'KXHIGHNY-26SEP15-B81.5', result: 'no', pnl, held_for_hours: 20, rationale_excerpt: '[strategy daily_temps] NYC forecast high 79F against the 81° to 82° market.' } });
  const outcomes = [outcome(20, 'haghani-2', '5.00'), ...Array.from({ length: 9 }, (_, n) => outcome(10 + n, 'haghani', n % 2 ? '1.00' : '-2.00'))];
  const spawned = { seq: 2, id: 'spawned:haghani-2', stream: 'evolution', kind: 'evolution.spawned', at: '2026-09-15T12:00:00.000Z', digest: '2'.repeat(64), payload: { desk_id: 'haghani-2', parent_id: 'haghani', family: 'weather', generation: 2, mutation: mutation() } };
  const trial = { seq: 3, id: 'lab:exp-1', stream: 'lab', kind: 'lab.experiment', at: '2026-09-15T12:00:00.000Z', digest: '3'.repeat(64), payload: experiment({ experiment_id: 'exp-000000000001' }) };
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return board;
    if (path.includes('kind=desk.outcome')) return { schema_version: 1, latest_seq: 20, events: outcomes };
    if (path.includes('stream=evolution')) return { schema_version: 1, latest_seq: 20, events: [spawned] };
    if (path.includes('kind=lab.experiment')) return { schema_version: 1, latest_seq: 20, events: [trial] };
    return { schema_version: 1, latest_seq: 20, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const positions = root.querySelector('#floor-positions');
    const rows = positions.find('tbody')[0].find('tr');
    assert.equal(rows.length, 2, 'real money only, dust left out');
    assert.deepEqual(rows.map(row => row.find('td').slice(0, 5).map(words)), [
      ['Hilibrand', 'BTC', 'long', '$772.10', '+$4.10'],
      ['Haghani', 'Austin high 100–101°F · Sep 16', 'NO', '$10.01', '+$0.12'],
    ]);
    const why = rows[1].withClass('why-toggle')[0];
    assert.match(why.textContent, /^daily temps Austin forecast high 101F .*…$/);
    assert.equal(why.getAttribute('aria-expanded'), 'false');
    why.click();
    assert.equal(why.getAttribute('aria-expanded'), 'true');
    assert.match(why.textContent, /Holds to settlement\.$/, 'the whole thesis on demand');
    assert.deepEqual(positions.find('a').map(node => node.href), ['/capital/desk/?id=hilibrand', '/capital/desk/?id=haghani', '/capital/committee/']);
    assert.match(positions.withClass('quiet-line')[0].textContent, /Shadow partners hold 2 practice positions \(scored on real prices, no money\) ↗/);

    const closed = root.querySelector('#floor-closed');
    assert.match(closed.withClass('record-line')[0].textContent, /9 real-money trades · 4 won · −\$6\.00/);
    assert.equal(closed.find('tbody')[0].find('tr').length, 8, 'eight rows by default');
    assert.doesNotMatch(closed.textContent, /Haghani II/, 'practice waits behind the toggle');
    const more = closed.withClass('more')[0];
    assert.equal(more.textContent, '1 more');
    more.click();
    assert.equal(root.querySelector('#floor-closed').find('tbody')[0].find('tr').length, 9);
    const toggle = root.querySelector('#closed-toggle').find('button')[0];
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    toggle.click();
    assert.equal(root.querySelector('#closed-toggle').find('button')[0].getAttribute('aria-pressed'), 'true');
    const withPractice = root.querySelector('#floor-closed').find('tbody')[0].find('tr');
    assert.match(withPractice[0].textContent, /Haghani II practice NYC high 81–82°F · Sep 15 won \+\$5\.00 20h/);
    assert.equal(withPractice[0].className, 'row-practice');

    const leaders = root.querySelector('#floor-leaders').find('tbody')[0].find('tr');
    assert.deepEqual(leaders.map(row => row.find('td').map(words)), [
      ['1', 'Hilibrand real money', '+$4.10', '+1.20%', '30'],
      ['2', 'Hilibrand II practice', '+$1.00', '+0.40%', '34'],
      ['3', 'Haghani II practice', '−$3.95', '−2.60%', '34'],
      ['4', 'Haghani real money', '−$21.63', '−20.60%', '34'],
    ]);
    assert.equal(leaders[0].withClass('pulse').length, 1, 'a partner in session breathes');

    const learning = root.querySelector('#floor-learning');
    assert.match(learning.withClass('learning-reading')[0].textContent, /^1 of 2 families have a practice child beating the partner that trades real money\.$/);
    const cells = learning.withClass('ladder-cell').map(words);
    assert.deepEqual(cells, ['+1.2% ★', '+0.4%', '−20.6%', '−2.6% ★', '−3.9%', '−0.7%'], 'families by generation, then every desk of a generation together');
    assert.deepEqual(learning.withClass('ladder-live').length, 2);
    assert.match(words(learning.withClass('loop-line')[0]), /bred 2 · retired 0 · promoted 0 · experiments 1 The loop ↗/, 'the roster counts the children the trimmed log no longer shows');
  });
});

test('a bred desk page names its parent and what it was born with, shows its calibration, and says when it is thinking now', async () => {
  const root = stubPage('desk', DESK_IDS);
  const labEvents = [calibration({ seq: 5, id: 'lab:cal:mullins-2', payload: { ...calibration().payload, desk_id: 'mullins-2', generation: 2 } })];
  await withBrowser('?id=mullins-2', path => {
    if (path.startsWith('/api/capital/desks/')) return desk('mullins-2', { name: 'Mullins II', family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', venues: ['kalshi'], mutation: mutation({ model_profile: 'kimi_flex', model_changed: true }), live_session: liveSession({ trigger: 'event_resolution', started_at: '2026-09-15T13:50:00.000Z' }), calibration: { n: 12, brier: '0.18', since: '2026-09-10T00:00:00.000Z' } });
    if (path.includes('stream=lab')) return { schema_version: 1, latest_seq: 9, events: labEvents };
    return { schema_version: 1, latest_seq: 9, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const header = root.querySelector('#desk-header');
    assert.match(words(header), /^Mullins II practice Fed & CPI family · generation II · bred from Mullins /);
    assert.deepEqual(header.find('a').map(node => node.href), ['/capital/desk/?id=mullins']);
    assert.match(header.textContent, /born on Kimi K2\.6 · effort high · “Prefers fewer, larger decisions and says so when the evidence is thin\.”/);
    assert.match(root.querySelector('#desk-state').textContent, /thinking now · woke because a market resolved/, 'the checkpoint says it is in session before a thought arrives');
    const detail = root.querySelector('#desk-detail');
    assert.match(words(detail), /^Calibration said vs happened 12 forecasts scored · Brier 0\.18 \(0 is perfect, 0\.25 a coin flip\)/);
    assert.equal(detail.find('circle').length, 2, 'one dot per reliability bin');
  });
});

test('the loop page reads the lab’s experiments and verdicts as changes, and calibration by family when it exists', async () => {
  const root = stubPage('committee', LOOP_IDS);
  const labEvents = [
    { seq: 1, id: 'lab:exp:1', stream: 'lab', kind: 'lab.experiment', at: '2026-09-15T02:00:00.000Z', digest: 'a'.repeat(64), payload: experiment() },
    { seq: 2, id: 'lab:verdict:1', stream: 'lab', kind: 'lab.verdict', at: '2026-09-15T03:00:00.000Z', digest: 'b'.repeat(64), payload: { experiment_id: 'exp-0123456789ab', status: 'adopted', evidence: {}, reason: 'Beat its parent on cost-adjusted return for four days.', as_of: '2026-09-15T03:00:00.000Z' } },
    calibration({ seq: 3, id: 'lab:cal:kalshi', payload: { ...calibration().payload, scope: 'family', desk_id: null, family: 'kalshi', n: 20, brier: '0.2' } }),
  ];
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint({ lab: lab({ experiments: [experiment()] }) });
    if (path.includes('stream=lab')) return { schema_version: 1, latest_seq: 3, events: labEvents };
    return { schema_version: 1, latest_seq: 3, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    assert.match(words(root.querySelector('#loop-numbers')), /Experiments 1 1 running$/);
    const items = root.querySelector('#loop-changes').withClass('change');
    assert.deepEqual(items.map(item => item.withClass('change-kind')[0].textContent), ['lab', 'lab']);
    assert.equal(words(items[0].withClass('change-text')[0]), 'The lab adopted “Mullins trades better with a slot before the close.” Beat its parent on cost-adjusted return for four days.');
    assert.equal(words(items[1].withClass('change-text')[0]), 'The lab started testing Mullins IV Mullins trades better with a slot before the close. · cadence sessions 08:10, 13:30, 16:30 · effort high');
    assert.equal(items[1].find('a')[0].href, '/capital/desk/?id=mullins-4');
    assert.match(words(root.querySelector('#loop-more')), /^Calibration by family kalshi family 20 forecasts Brier 0\.2$/);
  });
});

const run = (overrides = {}) => ({
  started_at: '2026-09-12T10:00:00.000Z', uptime_seconds: 93784, availability_7d_pct: '99.2', sessions_total: 412, sessions_today: 18, decisions_total: 57,
  sail_model_spend_today_usd: '3.10', sail_model_spend_total_usd: '41.20', sail_infra_spend_total_usd: '0.77', sail_spend_total_usd: '41.97',
  pnl_total_usd: '63.40', pnl_per_sail_dollar: '1.51', models_used: ['DeepSeek V4 Pro', 'Kimi K2.6', 'GLM-5.3'], ...overrides,
});

test('the run clock validates like the rest of the checkpoint and reads as elapsed time, cost and profit per Sail dollar', () => {
  assert.equal(validRun(run(), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validCheckpoint(checkpoint({ run: run() })), true);
  assert.equal(runClock(run({ sail_model_spend_today_usd: '1.32', sail_spend_total_usd: '0.77' })).spendTotal, '$1.32', 'a total never reads below today');
  assert.equal(validCheckpoint(checkpoint()), true, 'an older floor publishes no run clock');
  const refused = [
    ['started after the checkpoint', run({ started_at: '2026-09-15T15:00:00.000Z' })],
    ['availability above 100', run({ availability_7d_pct: '101' })],
    ['more sessions today than ever', run({ sessions_today: 500 })],
    ['a P&L that is not a number', run({ pnl_total_usd: 'lots' })],
    ['too many models', run({ models_used: Array.from({ length: 9 }, (_, i) => `m${i}`) })],
    ['an extra field', run({ mood: 'good' })],
  ];
  for (const [label, candidate] of refused) assert.equal(validRun(candidate, '2026-09-15T14:05:00.000Z'), false, label);
  assert.equal(validRun(run({ availability_7d_pct: null, sail_infra_spend_total_usd: null, pnl_per_sail_dollar: null }), '2026-09-15T14:05:00.000Z'), true, 'unknowns are null, not guesses');

  const clock = runClock(run(), Date.parse('2026-09-15T14:05:00.000Z'));
  assert.equal(clock.elapsed, '3d 4h');
  assert.equal(clock.since, 'Sep 12, 2026');
  assert.equal(clock.availability, '99.2% of the last 7 days');
  assert.equal(clock.sessions, '412 (18 today)');
  assert.equal(clock.decisions, '57');
  assert.equal(clock.spendToday, '$3.10');
  assert.equal(clock.spendTotal, '$41.97');
  assert.equal(clock.spendNote, 'models $41.20 · box $0.77, about a cent an hour');
  assert.equal(clock.pnl, '+$63.40');
  assert.equal(clock.pnlTone, 'positive');
  assert.equal(clock.perDollar, '+$1.51');
  assert.equal(clock.perDollarTone, 'positive');
  assert.equal(clock.models, 'DeepSeek V4 Pro, Kimi K2.6, GLM-5.3');
  const early = runClock(run({ availability_7d_pct: null, sail_infra_spend_total_usd: null, pnl_per_sail_dollar: null, pnl_total_usd: '-4.20' }), Date.parse('2026-09-12T10:42:00.000Z'));
  assert.equal(early.elapsed, '42m');
  assert.equal(early.availability, 'measuring');
  assert.equal(early.perDollar, 'not yet');
  assert.equal(early.pnl, '−$4.20');
  assert.equal(early.pnlTone, 'negative');
  assert.equal(early.spendNote, 'models $41.20 · box about a cent an hour');
  assert.equal(runClock(null), null);
});

test('a desk’s holdings list its own book, real or practice, with the reason it gave and dust counted', () => {
  const held = position({ intent_id: 'oi-abc123', session_id: 'hilibrand:20260915-1830:cadence:18:30' });
  assert.equal(validPosition(held, '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validPosition(position({ intent_id: 'x'.repeat(121) }), '2026-09-15T14:05:00.000Z'), false);
  const shadow = desk('hilibrand-2', { mode: 'shadow', positions: [position({ market_value: '0.20' }), held, position({ market_value: '5000' })] });
  const book = deskPositionRows(shadow);
  assert.deepEqual(book.rows.map(row => [row.market, row.side, row.valueText, row.pnlText, row.tone]), [['BTC', 'long', '$5,000.00', '+$4.10', 'positive'], ['BTC', 'long', '$772.10', '+$4.10', 'positive']], 'largest first');
  assert.equal(book.dust, 1);
  const [weather] = deskPositionRows(desk('haghani', { positions: [position({ instrument: { symbol: 'KXHIGHNY-26SEP16-B77.5', asset_class: 'event', venue: 'kalshi' }, side: 'no', market_value: '7.98', unrealized_pnl: '-11.780000', thesis: '[strategy daily_temps] NYC forecast high 79F. The rest of the reason.' })] })).rows;
  assert.deepEqual([weather.market, weather.side, weather.pnlText, weather.tag, weather.short, weather.more], ['NYC high 77–78°F · Sep 16', 'NO', '−$11.78', 'daily temps', 'NYC forecast high 79F.', true]);
  assert.deepEqual(deskPositionRows(null), { rows: [], dust: 0 });
});

test('watch it think: sessions fold in order, the state line says when it stopped, and the stream types what arrives', async () => {
  const now = Date.parse('2026-09-15T14:00:00.000Z');
  assert.equal(agoText('2026-09-15T13:59:50.000Z', now), 'just now');
  assert.equal(agoText('2026-09-15T13:46:00.000Z', now), '14 min ago');
  assert.equal(agoText('2026-09-15T11:00:00.000Z', now), '3 h ago');
  assert.equal(agoText('2026-09-13T14:00:00.000Z', now), '2 d ago');
  assert.equal(agoText('not a time', now), '');
  // A readable pace that never drags: chunks cover the text, and the cap holds for a long thought.
  const short = typingSchedule('a'.repeat(90));
  assert.equal(short.totalMs, 1024);
  assert.ok(short.chunk * short.frames >= 90);
  const long = typingSchedule('a'.repeat(20000));
  assert.ok(long.totalMs <= 4000 + long.frameMs);
  assert.ok(long.chunk * long.frames >= 20000);
  assert.equal(typingSchedule('').chunk, 1);

  const session = { seq: 1, id: 's1', stream: 'desk:mullins', kind: 'desk.session_started', at: '2026-09-15T13:30:00.000Z', payload: { session_id: 'm:1', trigger: 'cadence:13:30' } };
  const thought = { seq: 2, id: 't1', stream: 'desk:mullins', kind: 'desk.thought', at: '2026-09-15T13:30:05.000Z', payload: { session_id: 'm:1', text: 'The Fed decides tomorrow.' } };
  const call = { seq: 3, id: 'c1', stream: 'desk:mullins', kind: 'desk.tool_call', at: '2026-09-15T13:30:06.000Z', payload: { session_id: 'm:1', call_id: 'c1', tool: 'event_markets', arguments: { query: 'fed' } } };
  const later = { seq: 4, id: 't2', stream: 'desk:mullins', kind: 'desk.thought', at: '2026-09-15T13:30:30.000Z', payload: { session_id: 'm:1', text: 'No edge at 89 cents.' } };
  const other = { seq: 5, id: 'x1', stream: 'desk:hilibrand', kind: 'desk.thought', at: '2026-09-15T13:30:31.000Z', payload: { session_id: 'h:1', text: 'BTC drifts.' } };
  const stale = { seq: 0, id: 't0', stream: 'desk:mullins', kind: 'desk.thought', at: '2026-09-15T08:10:05.000Z', payload: { session_id: 'm:0', text: 'Morning look.' } };
  const running = sessionThoughts([later, other, thought, session, call, stale], 'mullins');
  assert.equal(running.sessionId, 'm:1');
  assert.equal(running.trigger, 'cadence:13:30');
  assert.equal(running.running, true);
  assert.deepEqual(running.items.map(item => [item.kind, item.text]), [['thought', 'The Fed decides tomorrow.'], ['call', 'searching Kalshi for “fed”'], ['thought', 'No edge at 89 cents.']], 'a tool call in plain words');
  assert.equal(idleLine(running, now), 'thinking now · sat down for the 13:30 slot');
  const memo = { seq: 6, id: 'm1', stream: 'desk:mullins', kind: 'desk.memo', at: '2026-09-15T13:31:00.000Z', payload: { session_id: 'm:1', title: 'No trade: FOMC priced efficiently', text: '…' } };
  const ended = { seq: 7, id: 'e1', stream: 'desk:mullins', kind: 'desk.session_ended', at: '2026-09-15T13:46:00.000Z', payload: { session_id: 'm:1', reason: 'end_session', requests: 6, cost_usd: '0.03' } };
  const done = sessionThoughts([session, thought, call, later, memo, ended], 'mullins');
  assert.equal(done.running, false);
  assert.equal(done.memo, 'No trade: FOMC priced efficiently');
  assert.equal(idleLine(done, now), 'ended 14 min ago · No trade: FOMC priced efficiently');
  assert.equal(idleLine(sessionThoughts([session, thought, { ...ended, payload: { session_id: 'm:1', reason: 'budget_exceeded' } }], 'mullins'), now), 'ended 14 min ago · budget exceeded');
  assert.equal(idleLine(sessionThoughts([], 'mullins'), now), 'no session yet');
  assert.equal(idleLine(sessionThoughts([stale], 'mullins'), now), 'last thought 6 h ago');
  assert.equal(idleLine(done, now, { trigger: 'watch:price_move' }), 'thinking now · woke on a price move');
  // End reasons are words a visitor can read, never the runtime's codes.
  assert.equal(idleLine(sessionThoughts([session, thought, { ...ended, payload: { session_id: 'm:1', reason: 'provider_transport_timeout' } }], 'mullins'), now), 'ended 14 min ago · the model provider timed out');
  assert.equal(endReason('no_tool_calls'), 'the model stopped calling tools');
  assert.equal(endReason('incomplete:max_output_tokens'), 'ran out of max output tokens');

  // The stream: a finished session draws instantly; live arrivals type, in order, once each.
  await withBrowser('', () => ({ schema_version: 1, latest_seq: 0, events: [] }), () => {
  const box = new StubElement('div');
  const stream = thoughtStream(box, { instant: true });
  stream.load(sessionThoughts([], 'mullins'));
  assert.match(box.textContent, /Nothing said yet\./);
  stream.load(done);
  assert.equal(box.withClass('thought').length, 3);
  assert.match(box.withClass('thought')[2].textContent, /No edge at 89 cents\./);
  stream.push([later, { ...later, id: 't3', payload: { session_id: 'm:1', text: 'Second look.' } }], 'mullins');
  assert.equal(box.withClass('thought').length, 4, 'a repeated id is not typed twice');
  assert.match(box.withClass('thought')[3].textContent, /Second look\./);
  stream.push([other], 'mullins');
  assert.equal(box.withClass('thought').length, 4, 'another desk’s thought never enters this stream');
  stream.stop();

  // Typing without the instant flag reveals the text over frames and stays in order.
  const timers = [];
  const slow = new StubElement('div');
  const typed = thoughtStream(slow, { setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, schedule: () => ({ chunk: 5, frameMs: 32, frames: 4, totalMs: 128, length: 20 }) });
  typed.load({ running: true, items: [{ id: 'a', at: thought.at, kind: 'thought', text: 'Twenty characters!!!' }] });
  assert.equal(slow.withClass('thought-text')[0].textContent, 'Twent', 'the first frame shows one chunk');
  while (timers.length) timers.shift().fn();
  assert.equal(slow.withClass('thought-text')[0].textContent, 'Twenty characters!!!');
  typed.stop();
  });
});

test('the desk page reads who a partner is, its numbers, sessions, strategies and lessons from published records', () => {
  const evolution = [
    { kind: 'evolution.promoted', at: '2026-09-16T18:39:15.000Z', payload: { desk_id: 'scholes', from: 'live', to: 'shadow', reason: 'mandate breach: drawdown 0.676875 >= 0.15' } },
    { kind: 'evolution.founded', at: '2026-09-16T18:54:00.000Z', payload: { desk_id: 'leahy', family: 'sports-arb', name: 'Leahy', rationale: 'The floor has no sports business.', universe: 'Kalshi same-game sports totals.' } },
    { kind: 'evolution.promoted', at: '2026-09-16T19:00:00.000Z', payload: { desk_id: 'mullins-2', from: 'shadow', to: 'live' } },
  ];
  const scholes = deskIdentity(desk('scholes', { name: 'Scholes', family: 'ranges', mode: 'shadow' }), evolution);
  assert.deepEqual([scholes.name, scholes.live, scholes.lineage, scholes.founded], ['Scholes', false, 'BTC & ETH ranges family · founder', false]);
  assert.deepEqual(scholes.demoted, { at: '2026-09-16T18:39:15.000Z', reason: 'mandate breach: drawdown 67.7%, past the 15% limit' });
  assert.match(scholes.mandate, /^Prices a distribution, not a direction/);
  const leahy = deskIdentity(desk('leahy', { name: 'Leahy', family: 'sports-arb', mode: 'shadow' }), evolution);
  assert.deepEqual([leahy.founded, leahy.mandate, leahy.rationale, leahy.demoted], [true, 'Kalshi same-game sports totals.', 'The floor has no sports business.', null]);
  assert.equal(deskIdentity(desk('leahy-2', { family: 'sports-arb', generation: 2, parent_id: 'leahy', mode: 'shadow' }), evolution).founded, true, 'a founded family’s child is the floor’s too');
  const promoted = deskIdentity(desk('mullins-2', { family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'live', mutation: mutation() }), evolution);
  assert.deepEqual([promoted.name, promoted.lineage, promoted.parent, promoted.demoted, Boolean(promoted.promoted)], ['Mullins II', 'Fed & CPI family · generation II', { id: 'mullins', name: 'Mullins' }, null, true]);
  assert.equal(promoted.born, 'DeepSeek V4 Pro · effort high');
  assert.equal(deskIdentity(desk('haghani', { family: 'weather', mode: 'live' })).founded, false, 'a partner the owner wrote');
  const round = { kind: 'committee.allocation', at: '2026-09-16T19:20:00.000Z', payload: { allocations: { haghani: '0', 'haghani-2': '150.00' }, reasons: { haghani: 'mandate breach: drawdown 0.258702 >= 0.15; back to a shadow book once its real positions close', 'haghani-2': 'shadow sleeve' } } };
  assert.deepEqual(deskIdentity(desk('haghani', { family: 'weather', mode: 'live' }), [round]).sleeve, { usd: '$0.00', empty: true, reason: 'mandate breach: drawdown 25.9%, past the 15% limit; back to a shadow book once its real positions close' });
  assert.equal(deskIdentity(desk('haghani-2', { family: 'weather', generation: 2, parent_id: 'haghani', mode: 'shadow' }), [round]).sleeve, null, 'a shadow book has no sleeve to explain');
  assert.equal(deskIdentity(null, [], 'mullins-3').name, 'Mullins III');

  assert.deepEqual(deskNumbers(desk('scholes', { mode: 'shadow', equity: '88.067000', pnl_usd: '-53.933000', return_pct: '-62.1706', orders: 42, budget_factor: '0.25' })).map(item => [item.value, item.note || '', item.tone || '']),
    [['$88.07', 'practice', ''], ['−$53.93', '', 'negative'], ['−62.17%', '', 'negative'], ['42', '', ''], ['0.25×', '', '']]);
  assert.deepEqual(deskNumbers(null).map(item => item.value), ['—', '—', '—', '—', '—']);

  assert.deepEqual(strategyRows(desk('hilibrand', { strategies: [{ name: 'spot_quotes', house: true, note: 'house starter', cadence_seconds: 300, runs: 110, intents: 176, approved: 40, errors: 2, fills: 14, settled: 5, wins: 1, settled_pnl_usd: '-0.04', last_run_at: null, last_notes: '2 kept', params: { symbols: ['BTC-USD', 'ETH-USD'] } }] })),
    [{ name: 'spot quotes', every: '5 min', runs: 110, approved: '40 of 176', fills: 14, settled: '1 of 5 won', pnlText: '−$0.04', tone: 'negative', note: 'house starter', errors: 2, lastNotes: '2 kept', settings: 'symbols BTC-USD, ETH-USD' }]);
  assert.deepEqual(strategyRows(null), []);

  const lessons = deskLessons([
    { id: 'l1', kind: 'desk.tool_call', at: '2026-09-16T19:00:00.000Z', payload: { tool: 'memory_write', arguments: { kind: 'lesson', text: '2026-09-16 19:00Z: the watch quotes the leg the book marks in.' } } },
    { id: 'l2', kind: 'desk.tool_call', at: '2026-09-16T20:00:00.000Z', payload: { tool: 'memory_write', arguments: { kind: 'fact', text: 'FOMC at 2pm.' } } },
    { id: 'l3', kind: 'desk.tool_call', at: '2026-09-16T21:00:00.000Z', payload: { tool: 'memory_write', arguments: { kind: 'lesson', text: 'Size **down** into a priced event.' } } },
  ]);
  assert.deepEqual(lessons.map(lesson => lesson.text), ['Size down into a priced event.', 'the watch quotes the leg the book marks in.'], 'lessons only, newest first, no date stamp');
  assert.deepEqual(leadParagraph('## Trigger\n\nshort\n\nThe spike retraced to a thin book with no forecast change.\n\nHold.'), { lead: 'The spike retraced to a thin book with no forecast change.', rest: 'Trigger\n\nshort\n\nHold.' });
  assert.equal(deskRecordLine([{ live: true, pnl: '1.32' }, { live: true, pnl: '-2.00' }]), '2 real-money trades · 1 won · −$0.68');
  assert.equal(deskRecordLine([{ live: false, pnl: '0.50' }]), '1 practice trade · 1 won · +$0.50');
  assert.equal(deskRecordLine([{ live: true, pnl: '1' }, { live: false, pnl: '1' }]), '2 trades · 2 won · +$2.00 · 1 with real money');
  assert.equal(deskRecordLine([]), '');

  const runs = codeRuns([
    { id: 'c1', kind: 'desk.code_run', at: '2026-09-15T13:10:00.000Z', payload: { session_id: 'h:1', code_sha256: 'ab'.repeat(32), language: 'python', stdout: 'vol 2.1%\n', exit_code: 0, seconds: '1.5', sandbox: 'sb_1', purpose: 'realized vol', saved_as: 'vol' } },
    { id: 'c2', kind: 'desk.code_run', at: '2026-09-15T13:12:00.000Z', payload: { session_id: 'h:1', code_sha256: 'cd'.repeat(32), language: 'python', stdout: 'Traceback', exit_code: 1, seconds: '0.4', sandbox: 'sb_1', purpose: 'bad idea' } },
    { id: 't1', kind: 'desk.thought', at: '2026-09-15T13:13:00.000Z', payload: { text: 'not a run' } },
  ]);
  assert.deepEqual(runs.map(run => [run.purpose, run.exit, run.hash, run.savedAs]), [['bad idea', 1, 'cdcdcdcdcdcd', ''], ['realized vol', 0, 'abababababab', 'vol']]);

  // Sessions, newest first, with the trigger a trimmed start still carries in its id.
  const s = (seq, kind, session, payload = {}) => ({ seq, id: `e${seq}`, stream: 'desk:haghani', kind, at: `2026-09-16T19:${String(seq).padStart(2, '0')}:00.000Z`, payload: { session_id: session, ...payload } });
  const older = 'haghani:20260916-1841:watch:price_move';
  const newer = 'haghani:20260916-1942:cadence:15:45';
  const sessions = deskSessions([
    s(1, 'desk.thought', older, { text: 'Spike retraced.' }), s(2, 'desk.tool_call', older, { tool: 'end_session', arguments: { summary: 'Held the NO.' } }), s(3, 'desk.session_ended', older, { reason: 'end_session' }),
    s(10, 'desk.session_started', newer, { trigger: 'cadence:15:45' }), s(11, 'desk.thought', newer, { text: 'Look again.' }), s(11, 'desk.thought', newer, { text: 'Look again.' }),
    s(12, 'desk.tool_call', newer, { tool: 'tool_result_only' }), s(13, 'desk.tool_call', newer, { tool: 'record_forecast', arguments: { market: 'KXHIGHAUS-26SEP16-B100.5', probability: '0.30', market_price: '0.665' } }),
    { ...s(14, 'desk.thought', older), stream: 'desk:other', payload: { session_id: 'other:1', text: 'not mine' } },
  ], 'haghani');
  assert.deepEqual(sessions.map(row => [row.sessionId, row.trigger, row.running, row.summary]), [[newer, 'cadence:15:45', true, ''], [older, 'watch:price_move', false, 'Held the NO.']]);
  assert.deepEqual(sessions[0].items.map(item => item.text), ['Look again.', 'putting 30% on Austin high 100–101°F · Sep 16, market at 66.5¢'], 'one line per event id; a tool with no words stays out');
  const calls = ['quote', 'quote', 'quote', 'news', 'news'].map((tool, n) => ({ id: `c${n}`, kind: 'call', tool, text: tool === 'quote' ? `checking the price of ${['BTC', 'ETH', 'SOL'][n]}` : 'reading the news' }));
  assert.deepEqual(recentItems([{ id: 't0', kind: 'thought', text: 'a' }, ...calls, { id: 't1', kind: 'thought', text: 'b' }]).map(item => [item.text, item.count || 1, item.more || 0]),
    [['a', 1, 0], ['checking the price of BTC', 1, 2], ['reading the news', 2, 0], ['b', 1, 0]], 'a run of one tool folds; a repeat counts');
  const many = Array.from({ length: 9 }, (_, n) => ({ id: `t${n}`, kind: 'thought', text: `thought ${n}` }));
  assert.deepEqual(recentItems(many).map(item => item.text), ['thought 3', 'thought 4', 'thought 5', 'thought 6', 'thought 7', 'thought 8'], 'the newest six thoughts');
  assert.equal(thoughtText('## Plan\n\n**Buy**   the `dip`\n\n\n\nthen wait'), 'Plan\n\nBuy the dip\n\nthen wait');
  assert.equal(actionWords({ tool: 'undeploy_strategy', arguments: { name: 'hourly_ranges' } }), 'switching off its hourly ranges strategy');
  assert.equal(actionWords({ tool: 'propose_order', arguments: { instrument: { symbol: 'BTC-USD', asset_class: 'crypto' }, side: 'buy', quantity: '0.000132', limit_price: '76004.5' } }), 'proposing to buy 0.000132 BTC at $76,004.50');
  assert.equal(actionWords({ tool: 'end_session', arguments: {} }), '');
});

test('the loop reads as words: its clock, its numbers, what changed, the live sleeves and each desk’s gate; a demotion is never a promotion', () => {
  const at = value => Date.parse(value);
  assert.deepEqual(loopSchedule(at('2026-09-16T22:30:00.000Z')).map(job => [job.key, job.time, job.next, job.until]), [
    ['committee', '6:00 PM', false, ''], ['evolution', '7:00 PM', true, 'in 30 min'], ['lab', '8:00 PM', false, ''], ['founding', '9:30 PM', false, ''],
  ], '6:30 PM Eastern: evolution is next');
  assert.equal(loopSchedule(at('2026-09-16T20:00:00.000Z')).find(job => job.next).until, 'in 2h', '4 PM Eastern: the committee in two hours');
  assert.equal(loopSchedule(at('2026-09-17T02:00:00.000Z')).find(job => job.next).key, 'committee', 'after founding, tomorrow’s committee');
  assert.equal(loopSchedule(at('2026-09-17T02:00:00.000Z'))[0].until, 'in 20h');
  assert.equal(loopSchedule(at('2026-09-16T22:50:00.000Z')).find(job => job.next).until, 'in 10 min');

  assert.equal(isDemotion({ from: 'live', to: 'shadow' }), true);
  assert.equal(isDemotion({ from: 'shadow', to: 'live' }), false);
  assert.equal(isDemotion({}), false, 'an older promotion carried no direction');
  assert.equal(reasonText('mandate breach: drawdown 0.258702 >= 0.15; back to a shadow book once its real positions close'), 'mandate breach: drawdown 25.9%, past the 15% limit; back to a shadow book once its real positions close');
  assert.equal(reasonText('held between weekly resizes'), 'held between weekly resizes');
  const demotion = { id: 'demoted:scholes', kind: 'evolution.promoted', stream: 'evolution', at: '2026-09-16T18:39:15.000Z', payload: { desk_id: 'scholes', from: 'live', to: 'shadow', reason: 'mandate breach: drawdown 0.676875 >= 0.15' } };
  assert.equal(tapeLine(demotion).text, 'moved Scholes back to a shadow book · mandate breach: drawdown 67.7%, past the 15% limit');
  assert.equal(tapeLine({ ...demotion, payload: { desk_id: 'mullins-2', from: 'shadow', to: 'live' } }).text, 'promoted Mullins II to real money');
  assert.equal(tapeLine({ kind: 'evolution.founded', stream: 'evolution', payload: { desk_id: 'leahy', family: 'sports-arb', name: 'Leahy', universe: 'Sports totals.' } }).text, 'founded Leahy, a new sports-arb family · Sports totals.');
  assert.deepEqual(lineage([demotion], 'scholes').map(row => [row.label, row.text]), [['Desk demoted', 'moved Scholes back to a shadow book · mandate breach: drawdown 67.7%, past the 15% limit']]);

  const board = checkpoint({ desks: [
    desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', pnl_usd: '-0.78', capital_usd: '368.80' }),
    desk('haghani', { name: 'Haghani', family: 'weather', mode: 'live', pnl_usd: '-23.31', capital_usd: '0' }),
    desk('hilibrand-3', { name: 'Hilibrand III', family: 'crypto', generation: 3, parent_id: 'hilibrand', mode: 'shadow', return_pct: '0.11', gate: { name: 'A', passed: false, evidence: { days_live: 1, failed: 'days_live' } } }),
    desk('leahy', { name: 'Leahy', family: 'sports-arb', mode: 'shadow' }),
  ], committee: { last_memo_at: null, allocations: { hilibrand: '368.80', haghani: '0', 'hilibrand-3': '487.00', leahy: '150.00' } } });
  const counts = loopCounts([demotion, { kind: 'evolution.promoted', payload: { desk_id: 'mullins-2', to: 'live' } }], board);
  assert.deepEqual(counts, { bred: 1, retired: 0, promoted: 1, demoted: 1, founded: 1, experiments: 0 }, 'the founded family counts from the roster when the log is trimmed');
  assert.equal(loopCountLine(counts), 'bred 1 · retired 0 · promoted 1 · demoted 1 · experiments 0');
  assert.deepEqual(loopStatus([demotion], board).map(item => [item.label, item.value, item.note || '']), [
    ['Families', '3', ''], ['Partners', '4', '2 real money'], ['Bred', '1', ''], ['Promoted', '0', ''], ['Demoted', '1', ''], ['Retired', '0', ''], ['Founded', '1', ''], ['Experiments', '0', ''],
  ]);

  const allocation = (seq, at, allocations, shadow) => ({ id: `alloc-${seq}`, seq, kind: 'committee.allocation', stream: 'committee', at, payload: { allocations, shadow, reasons: { hilibrand: 'weekly resize: +1.2% on 14 decisions', haghani: 'mandate breach: drawdown 0.258702 >= 0.15' } } });
  const rounds = [
    allocation(1, '2026-09-16T18:00:00.000Z', { hilibrand: '487.00', haghani: '150', 'hilibrand-3': '487.00' }, { 'hilibrand-3': true }),
    allocation(2, '2026-09-16T19:00:00.000Z', { hilibrand: '368.80', haghani: '0', 'hilibrand-3': '400.00' }, { 'hilibrand-3': true }),
    allocation(3, '2026-09-16T20:00:00.000Z', { hilibrand: '368.80', haghani: '0', 'hilibrand-3': '400.00', leahy: '150.00' }, { 'hilibrand-3': true, leahy: true }),
  ];
  const playbooks = [
    { id: 'p1', kind: 'desk.playbook_updated', stream: 'desk:hilibrand-6', at: '2026-09-16T19:25:00.000Z', payload: { version: 2, reason: 'bred from hilibrand: rewritten from the parent’s playbook' } },
    { id: 'p2', kind: 'desk.playbook_updated', stream: 'desk:scholes-2', at: '2026-09-16T09:32:00.000Z', payload: { version: 3, reason: 'Codify a vol-window rule.' } },
  ];
  const changes = loopChanges([...rounds, demotion, ...playbooks], board);
  assert.deepEqual(changes.map(item => [item.kind, item.desk, item.text, item.detail]), [
    ['capital', 'hilibrand', 'Meriwether moved Hilibrand $487 → $369', 'weekly resize: +1.2% on 14 decisions'],
    ['capital', 'haghani', 'Meriwether moved Haghani $150 → $0', 'mandate breach: drawdown 25.9%, past the 15% limit'],
    ['demoted', 'scholes', 'Moved Scholes back to a shadow book', 'mandate breach: drawdown 67.7%, past the 15% limit'],
    ['playbook', 'scholes-2', 'Scholes II rewrote its playbook', 'Codify a vol-window rule.'],
  ], 'live sleeves only; a bred child’s first playbook is its birth, not a change');
  assert.deepEqual(loopChanges([], null), []);

  const sleeves = liveSleeves(board, rounds);
  assert.deepEqual(sleeves.rows.map(row => [row.name, row.usdText, row.pnlText, row.reason]), [
    ['Hilibrand', '$368.80', '−$0.78', 'weekly resize: +1.2% on 14 decisions'], ['Haghani', '$0.00', '−$23.31', 'mandate breach: drawdown 25.9%, past the 15% limit'],
  ]);
  assert.deepEqual([sleeves.totalText, sleeves.shadow], ['$368.80', 2]);

  assert.deepEqual(gateProgress({ name: 'A', passed: false, evidence: { days_live: 1, decisions: 6, max_drawdown_pct: '0.258702', cost_adjusted_excess_pct: '-0.4540', breakers: 26, failed: 'breakers, cost_adjusted_return, days_live, decisions, drawdown, reconciliation' } }),
    { name: 'A', passed: false, total: 6, met: 0, missing: ['breakers (26)', 'return after costs (−0.45%)', 'days live (1)', 'decisions (6)', 'drawdown (25.9%)', 'clean books'] });
  assert.deepEqual(gateProgress({ name: 'B', passed: true, evidence: {} }), { name: 'B', passed: true, total: 6, met: 6, missing: [] });
  assert.equal(gateProgress({ name: 'A', passed: false, evidence: {} }), null, 'a gate that names no failed check has no score');
  assert.equal(gateProgress({ gate: 'A', passed: false, failed: ['days_live'], evidence: {} }).met, 5, 'the committee.gate event carries failed as a list');
  assert.equal(gateLine({ name: 'Hilibrand III', gate: gateProgress(board.desks[2].gate) }), 'Hilibrand III, gate A: 5 of 6 met; short on days live (1)');
  assert.equal(floorFounded(desk('leahy', { generation: 1, parent_id: null })), true);
  assert.equal(floorFounded(desk('merton', { generation: 1, parent_id: null })), false, 'the first build’s partners were written by hand');
  assert.equal(whenText('2026-09-16T19:20:00.000Z', at('2026-09-16T21:00:00.000Z')), '3:20 PM');
  assert.equal(whenText('2026-09-15T19:20:00.000Z', at('2026-09-16T21:00:00.000Z')), 'Sep 15');
});

test('the floor’s helpers read as words: relative times, numerals, triggers, the flat line, the loop page’s race', () => {
  assert.equal(ago('2026-09-15T14:00:00.000Z', Date.parse('2026-09-15T14:00:30.000Z')), 'just now');
  assert.equal(ago('2026-09-15T14:00:00.000Z', Date.parse('2026-09-15T14:14:00.000Z')), '14 min ago');
  assert.equal(ago('2026-09-15T14:00:00.000Z', Date.parse('2026-09-15T16:30:00.000Z')), '2 h ago');
  assert.equal(ago('2026-09-12T14:00:00.000Z', Date.parse('2026-09-15T16:30:00.000Z')), '3 d ago');
  assert.equal(ago('nope'), '');
  assert.deepEqual([1, 2, 3, 4, 9].map(roman), ['I', 'II', 'III', 'IV', 'IX']);
  assert.equal(raceName(desk('mullins-2', { family: 'kalshi', generation: 2 })), 'Mullins II');
  assert.equal(raceName(desk('mullins', { family: 'kalshi' })), 'Mullins');

  assert.equal(triggerText('cadence:13:30'), 'sat down for the 13:30 slot');
  assert.equal(triggerText('watch:price_move'), 'woke on a price move');
  assert.equal(triggerText('event_resolution'), 'woke because a market resolved');
  assert.equal(triggerText('postmortem'), 'writing its post-mortem');
  assert.equal(triggerText(''), 'in session');
  assert.equal(tapeLine({ kind: 'desk.session_started', stream: 'desk:mullins', payload: { session_id: 's', trigger: 'cadence:08:10' } }).text, 'sat down for the 08:10 slot');
  assert.equal(tapeLine({ kind: 'desk.session_ended', stream: 'desk:mullins', payload: { session_id: 's', reason: 'end_session', requests: 6, cost_usd: '0.0306' } }).text, 'ended · 6 model calls · $0.03');
  assert.equal(tapeLine({ kind: 'desk.memo', stream: 'desk:mullins', payload: { session_id: 's', title: 'No trade', text: 'Priced.' } }).text, 'wrote "No trade" · Priced.');
  assert.equal(tapeLine({ kind: 'evolution.spawned', stream: 'evolution', payload: { desk_id: 'mullins-2', parent_id: 'mullins', family: 'kalshi', generation: 2, mutation: mutation({ session_shift_minutes: -45 }) } }).text, 'bred Mullins 2 from Mullins · DeepSeek V4 Pro, effort high, −45 min');
  assert.equal(tapeLine({ kind: 'ops.budget', stream: 'ops', payload: { scope: 'floor', mode: 'open', balance_usd: '279', runway_days: '539', spent_usd: '0.26' } }).text, 'credit $279 · 539 days of runway · open · $0.26 spent today');

  assert.equal(flatLine(checkpoint()), 'No real-money position open.');
  assert.equal(flatLine(checkpoint({ floor: accountFloor() })), 'No real-money position open. $980 in cash across Kalshi and Coinbase.');

  const race = raceRows(checkpoint({ desks: [
    desk('mullins-3', { family: 'kalshi', generation: 3, parent_id: 'mullins', mode: 'shadow', return_pct: '2.5', mutation: mutation({ model_profile: 'oss_asap', model_changed: true }) }),
    desk('mullins', { family: 'kalshi', mode: 'live', return_pct: '1.0' }),
    desk('mullins-2', { family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', return_pct: '2.5' }),
    desk('hilibrand', { family: 'crypto', mode: 'live', return_pct: '0' }),
  ] }));
  assert.deepEqual(race.map(row => [row.label, row.live, row.members.map(member => member.name)]), [['Kalshi', 'Mullins', ['Mullins', 'Mullins II', 'Mullins III']], ['Crypto', 'Hilibrand', ['Hilibrand']]]);
  assert.deepEqual(race[0].members.map(member => member.leader), [false, false, false], 'a tie has no leader');
  assert.equal(race[0].members[2].badges[0].text, 'gpt-oss-120b');
  assert.deepEqual(race.map(row => [row.name, row.word, row.founded]), [['Mullins', 'Fed & CPI', false], ['Hilibrand', 'crypto', false]]);
  assert.equal(race[0].closest, null, 'no challenger has published a gate');
  const moved = raceRows(checkpoint({ desks: [
    desk('scholes', { name: 'Scholes', family: 'ranges', mode: 'shadow', return_pct: '-62', gate: { name: 'A', passed: false, evidence: { failed: 'drawdown, days_live' } } }),
    desk('scholes-2', { name: 'Scholes II', family: 'ranges', generation: 2, parent_id: 'scholes', mode: 'shadow', return_pct: '-57', gate: { name: 'A', passed: false, evidence: { failed: 'days_live' } } }),
    desk('leahy', { name: 'Leahy', family: 'sports-arb', mode: 'shadow', return_pct: '0' }),
  ] }), [{ kind: 'evolution.promoted', at: '2026-09-16T18:39:15.000Z', payload: { desk_id: 'scholes', from: 'live', to: 'shadow' } }]);
  assert.deepEqual(moved[0].members.map(member => [member.name, member.demoted, member.gate.met]), [['Scholes', true, 4], ['Scholes II', false, 5]]);
  assert.equal(moved[0].closest.name, 'Scholes II');
  assert.deepEqual(moved.map(row => row.founded), [false, true], 'a family no person wrote was founded by the floor');
});

import { closedRows, quietLine } from '../capital/capital.js';

test('past trades name the desk, the market, the result and the reason; the leaderboard ranks lifetime P&L', () => {
  const checkpoint = { desks: [
    { id: 'scholes', family: 'ranges', mode: 'live', generation: 1, equity: '150.00', capital_usd: '142', cost_usd: '2.00', return_pct: '0.0563', days_live: 2, orders: 42, strategies: [{ name: 'a' }], budget_factor: '1.50', next_session_at: '2026-09-16T08:05:00.000Z' },
    { id: 'scholes-2', family: 'ranges', mode: 'shadow', generation: 2, parent_id: 'scholes', equity: '140.00', capital_usd: '142', cost_usd: '1.00', return_pct: '-0.0141', days_live: 1, orders: 12, strategies: [] },
    { id: 'haghani', family: 'weather', mode: 'live', generation: 1, equity: '150.00', capital_usd: '150', cost_usd: '0', return_pct: '0', days_live: 1, live_session: liveSession() },
  ] };
  const events = [
    { id: 'o1', stream: 'desk:scholes', kind: 'desk.outcome', at: '2026-09-16T06:02:28.000Z', payload: { instrument: { symbol: 'ETH-USD', asset_class: 'event', venue: 'kalshi', market_id: 'KXETH-26SEP1602-B2397', right: 'no' }, market_id: 'KXETH-26SEP1602-B2397', result: 'no', entry_price: '0.79', exit_price: '1', quantity: '12', pnl: '2.52', held_for_hours: 1, rationale_excerpt: '[strategy hourly_quotes] Quote: ETH-USD spot 2,400; resting NO bid at 0.79' } },
    { id: 'o2', stream: 'desk:scholes-2', kind: 'desk.outcome', at: '2026-09-16T06:02:30.000Z', payload: { market_id: 'KXBTC-26SEP1602-B75750', result: 'yes', pnl: '-9.86', quantity: '58', rationale_excerpt: 'shadow bet' } },
    { id: 'o3', stream: 'desk:scholes', kind: 'desk.outcome', at: '2026-09-16T05:00:00.000Z', payload: { market_id: 'AAVE-USD', instrument: 'crypto:AAVE-USD:coinbase', result: 'sold', pnl: '-0.36030101621000', held_for_hours: '4.3', rationale_excerpt: 'Floor exit of oi-a470af373c967ca109d1c8338bc5860b: the mark reached the stop at 114.81. The plan was stated by the desk with its entry.' } },
    { id: 'x', stream: 'desk:scholes', kind: 'desk.thought', at: '2026-09-16T06:03:00.000Z', payload: { text: 'not an outcome' } },
  ];
  const rows = closedRows(events, checkpoint);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].desk, 'scholes-2', 'newest first');
  assert.deepEqual([rows[1].name, rows[1].live, rows[1].instrument, rows[1].right, rows[1].pnlText, rows[1].tone, rows[1].strategy, rows[1].held], ['Scholes', true, 'KXETH-26SEP1602-B2397', 'NO', '+$2.52', 'positive', 'hourly_quotes', 'held 1h']);
  assert.equal(rows[1].why, 'Quote: ETH-USD spot 2,400; resting NO bid at 0.79', 'the strategy prefix is lifted into its own field');
  assert.deepEqual([rows[1].market, rows[1].outcome, rows[1].settled, rows[1].heldText, rows[1].tag, rows[1].short], ['ETH $2,397 bucket · Sep 16 2am ET', 'won', 'settled NO', '1h', 'hourly quotes', 'Quote: ETH-USD spot 2,400; resting NO bid at 0.79']);
  assert.deepEqual([rows[0].name, rows[0].live, rows[0].outcome, rows[0].market], ['Scholes II', false, 'lost', 'BTC $75,750 bucket · Sep 16 2am ET']);
  assert.deepEqual([rows[2].market, rows[2].outcome, rows[2].pnlText, rows[2].heldText], ['AAVE', 'sold', '−$0.36', '4.3h']);
  assert.equal(rows[2].short, 'Floor exit: the mark reached the stop at 114.81.', 'an intent id is not a reason');
  assert.equal(closedRecord(rows), '2 real-money trades · 1 won · +$2.16');
  assert.equal(closedRecord(rows.filter(row => !row.live)), '');
  // A founder demoted to a shadow book keeps its real trades real; an outcome that says so wins.
  const demoted = { desks: checkpoint.desks.map(desk => desk.id === 'scholes' ? { ...desk, mode: 'shadow', parent_id: null } : desk) };
  const after = closedRows(events, demoted);
  assert.equal(after[1].live, true, 'a legacy outcome of a human founder stays real money after its demotion');
  const flagged = closedRows([{ ...events[0], payload: { ...events[0].payload, real_money: false } }], checkpoint);
  assert.equal(flagged[0].live, false, 'the recorded flag decides when present');

  const leaders = leaderboardRows(checkpoint);
  assert.deepEqual(leaders.map(row => [row.rank, row.name, row.pnlText]), [[1, 'Scholes', '+$8.00'], [2, 'Haghani', '$0.00'], [3, 'Scholes II', '−$2.00']], 'ranked by lifetime P&L');
  assert.deepEqual([leaders[0].live, leaders[0].returnText, leaders[0].trades, leaders[1].inSession, leaders[2].live, leaders[2].pnlTone], [true, '+0.06%', 42, true, false, 'negative']);
  const exact = leaderboardRows({ desks: [{ ...checkpoint.desks[0], pnl_usd: '-51.25' }, checkpoint.desks[1]] });
  assert.deepEqual(exact.map(row => [row.id, row.pnlText]), [['scholes-2', '−$2.00'], ['scholes', '−$51.25']], 'the published lifetime P&L wins over equity minus allocation');
  assert.equal(validDesk(desk('merton', { pnl_usd: '-51.25' }), '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validDesk(desk('merton', { pnl_usd: 'lots' }), '2026-09-15T14:05:00.000Z'), false);

  const now = Date.parse('2026-09-16T07:35:00.000Z');
  assert.equal(quietLine(checkpoint, now), 'No partner is in session. Scholes sits down in 30 min. Their strategies keep quoting meanwhile.');
});

test('market tickers read as the thing they bet on, and anything unknown keeps its ticker', () => {
  const cases = [
    ['KXHIGHNY-26SEP16-B81.5', 'NYC high 81–82°F · Sep 16'],
    ['KXHIGHAUS-26SEP16-B100.5', 'Austin high 100–101°F · Sep 16'],
    ['KXHIGHCHI-26SEP16-B73.5', 'Chicago high 73–74°F · Sep 16'],
    ['KXHIGHMIA-26SEP17-B88.5', 'Miami high 88–89°F · Sep 17'],
    ['KXHIGHDEN-26SEP16-T86', 'Denver high 86°F line · Sep 16'],
    ['KXHIGHNY-26SEP16-T86', 'NYC high 86°F line · Sep 16'],
    ['KXHIGHLAX-26SEP16-B77.5', 'LA high 77–78°F · Sep 16'],
    ['KXHIGHPHIL-26SEP16-B70.5', 'Philadelphia high 70–71°F · Sep 16'],
    ['KXLOWTCHI-26SEP16-B55.5', 'Chicago low 55–56°F · Sep 16'],
    ['KXHIGHCHI-26SEP16', 'Chicago high · Sep 16'],
    ['KXHIGHXYZ-26SEP16-B70.5', 'XYZ high 70–71°F · Sep 16'],
    ['KXBTC-26SEP1600-B75950', 'BTC $75,950 bucket · Sep 16 12am ET'],
    ['KXBTC-26SEP1616-B75950', 'BTC $75,950 bucket · Sep 16 4pm ET'],
    ['KXETH-26SEP1601-B2397', 'ETH $2,397 bucket · Sep 16 1am ET'],
    ['KXBTCD-26SEP1617-T76000', 'BTC above $76,000 · Sep 16 5pm ET'],
    ['KXETHD-26SEP1612-T2400', 'ETH above $2,400 · Sep 16 12pm ET'],
    ['KXBTCD-26SEP15-T76000', 'BTC above $76,000 · Sep 15'],
    ['KXCPIYOY-26SEP-T3.5', 'CPI YoY above 3.5% · Sep'],
    ['KXFEDDECISION-26SEP-H25', 'Fed Sep · hike 25bp'],
    ['KXFEDDECISION-26SEP-C25', 'Fed Sep · cut 25bp'],
    ['KXFEDDECISION-26SEP-H0', 'Fed Sep · hold'],
    ['KXFEDDECISION-26SEP', 'Fed decision · Sep'],
    ['KXFED-26SEP-T3.75', 'Fed rate above 3.75% · Sep'],
    ['AAVE-USD', 'AAVE'],
    ['BTC-USD', 'BTC'],
    ['KXSOMETHING-26SEP16-Q1', 'KXSOMETHING-26SEP16-Q1'],
    ['KXBTC-26XYZ16-B1', 'KXBTC-26XYZ16-B1'],
    ['SPX', 'SPX'],
  ];
  for (const [ticker, title] of cases) assert.equal(marketTitle(ticker), title, ticker);
  assert.equal(marketTitle({ asset_class: 'event', symbol: 'KXHIGHAUS-26SEP16-B100.5', venue: 'kalshi' }), 'Austin high 100–101°F · Sep 16', 'an instrument object reads the same');
  assert.equal(marketTitle(null), '');
  assert.equal(seriesTitle('KXFEDDECISION'), 'Fed decision');
  assert.equal(seriesTitle('KXHIGHNY'), 'NYC high temperature');
  assert.equal(seriesTitle('KXBTCD'), 'BTC price');
  assert.equal(seriesTitle('KXNOPE'), '');

  assert.deepEqual(['23.00', '4.69', '0.087843', '0.00000164', '137.00', '0'].map(quantityText), ['23', '4.69', '0.0878', '0.00000164', '137', '0']);
  assert.deepEqual(['0.43', '0.005', '0.4350', '1'].map(centsText), ['43¢', '0.5¢', '43.5¢', '100¢']);
  assert.deepEqual([0.4, '4.3', 1, 30, 100, null, 'soon'].map(heldText), ['24m', '4.3h', '1h', '30h', '4d', '', '']);
  const thesis = thesisParts('[strategy daily_temps] Austin forecast high 101F (sigma 2.5F) against the 100° to 101° market settling in 24h: p=0.305, shrunk to 0.440. Holds to settlement.');
  assert.equal(thesis.tag, 'daily temps');
  assert.equal(thesis.short, 'Austin forecast high 101F (sigma 2.5F) against the 100° to 101° market settling in 24h: p=0.305,…');
  assert.ok(thesis.full.endsWith('Holds to settlement.') && thesis.more);
  assert.deepEqual(thesisParts('Short and done. Then more.'), { tag: '', short: 'Short and done.', full: 'Short and done. Then more.', more: true });
  assert.deepEqual(thesisParts(''), { tag: '', short: '', full: '', more: false });
  assert.equal(floorName('mullins-4'), 'Mullins IV', 'a known partner’s child reads with a numeral');
  assert.equal(floorName('haghani-2'), 'Haghani II');
  assert.equal(floorName('scholes'), 'Scholes');
  assert.equal(plainThought('**Hold** the `H25` line.\n\n## Next\nwait'), 'Hold the H25 line. Next wait');
});

test('the masthead reads five numbers, and the clock ticks in hours, minutes and seconds', () => {
  const now = Date.parse('2026-09-16T18:00:00.000Z');
  const body = checkpoint({ floor: accountFloor({ account_equity: '943.83' }), run: run({ started_at: '2026-09-15T18:11:00.000Z', pnl_total_usd: '-75.80', sail_spend_total_usd: '18.86', sail_model_spend_today_usd: '13.15', pnl_per_sail_dollar: '-4.01' }) });
  assert.deepEqual(mastheadNumbers(body, now).map(item => [item.label, item.value, item.tone, item.note || '', item.tick || '']), [
    ['Portfolio', '$943.83', '', '', ''],
    ['Profit', '−$75.80', 'negative', '−7.43%', ''],
    ['Self-improving', '23h 49m', '', '', '00s'],
    ['Sail spent', '$18.86', '', '', ''],
    ['Profit per Sail $', '−$4.01', 'negative', '', ''],
  ]);
  assert.equal(mastheadNumbers(body, now)[2].startedAt, Date.parse('2026-09-15T18:11:00.000Z'));
  const deposits = { ...body, floor: { ...body.floor, net_deposits: '1000' } };
  assert.equal(mastheadNumbers(deposits, now)[1].note, '−7.58%', 'the runtime’s own net deposits win when it publishes them');
  assert.deepEqual(mastheadNumbers(checkpoint(), now).map(item => item.value), ['—', '—', '—', '—', '—'], 'no run, no guesses');
  assert.equal(mastheadNumbers(checkpoint({ run: run({ pnl_per_sail_dollar: null }) }), now)[4].value, '—');
  assert.deepEqual(selfImprovingParts(42 * 60 + 5), { main: '42m', tick: '05s' });
  assert.deepEqual(selfImprovingParts(24 * 3600 + 12 * 60), { main: '24h 12m', tick: '00s' });
  assert.deepEqual(selfImprovingParts(5 * 86400), { main: '5d 0h', tick: '' });
  assert.deepEqual(selfImprovingParts(-1), { main: '—', tick: '' });
});

test('the live feed shows thinking, research and trades in plain words, folds repeats, and keeps the stage steady', () => {
  const live = new Set(['haghani', 'hilibrand']);
  let seq = 0;
  const ev = (kind, stream, payload, at = `2026-09-16T17:${String(10 + seq).padStart(2, '0')}:00.000Z`) => ({ seq: ++seq, id: `${kind}:${seq}`, kind, stream, at, payload });
  const call = (tool, args, desk = 'haghani-2') => feedLine(ev('desk.tool_call', `desk:${desk}`, { tool, arguments: args }), live);
  assert.equal(call('event_markets', { query: 'KXHIGHCHI-26SEP16-B73.5' }).text, 'searching Kalshi for Chicago high 73–74°F · Sep 16');
  assert.equal(call('event_markets', { query: 'Fed September' }).text, 'searching Kalshi for “Fed September”');
  assert.equal(call('event_markets', {}).text, 'browsing Kalshi markets');
  assert.equal(call('news', { query: 'Fed FOMC decision', limit: 8 }).text, 'reading news on “Fed FOMC decision”');
  assert.equal(call('weather_forecast', { city: 'Chicago' }).text, 'reading the NWS forecast for Chicago');
  assert.equal(call('calendar', {}).text, 'checking the economic calendar');
  assert.equal(call('memo_read', { title: 'FOMC day' }).text, 'rereading its memo “FOMC day”');
  assert.equal(call('memory_read', { query: 'KXFEDDECISION' }).text, 'recalling what it learned about Fed decision markets');
  assert.equal(call('outcomes', {}).text, 'reviewing how its past trades turned out');
  assert.equal(call('positions', {}).text, 'checking its open positions');
  assert.equal(call('run_code', { purpose: 'Compute bucket probability for Chicago high 73-74', code: 'print(1)' }).text, 'running code: compute bucket probability for Chicago high 73-74');
  assert.equal(call('strategy_report', { name: 'daily_temps' }).text, 'reading the report on its daily temps strategy');
  assert.equal(call('quote', { instrument: { asset_class: 'future', symbol: 'SPX' } }).text, 'checking the price of SPX');
  assert.equal(call('bars', { instrument: { asset_class: 'crypto', symbol: 'ETH-USD' }, interval: '1d', limit: 60 }).text, 'reading 60 daily ETH price bars');
  for (const tool of ['propose_order', 'cancel_order', 'memo', 'playbook_write', 'memory_write', 'record_forecast', 'end_session', 'mystery']) assert.equal(call(tool, { side: 'buy' }), null, tool);
  assert.equal(call('news', { query: 'x' }).practice, true, 'a shadow desk is practice');
  assert.equal(call('news', { query: 'x' }, 'haghani').practice, false);
  assert.equal(call('news', { query: 'x' }, 'haghani-2').name, 'Haghani II');

  const thought = feedLine(ev('desk.thought', 'desk:haghani', { text: '  **Buy** NO\n  here.  ' }), live);
  assert.deepEqual([thought.kind, thought.text, thought.name, thought.practice], ['thinking', 'Buy NO here.', 'Haghani', false]);
  assert.equal(feedLine(ev('desk.thought', 'desk:haghani', { text: '   ' }), live), null);

  const kalshi = { asset_class: 'event', market_id: 'KXHIGHAUS-26SEP16-B100.5', symbol: 'KXHIGHAUS-26SEP16-B100.5', venue: 'kalshi', right: 'no' };
  const fill = feedLine(ev('broker.fill', 'broker:kalshi', { desk_id: 'haghani', instrument: kalshi, side: 'buy', quantity: '23.00', price: '0.4300' }), live);
  assert.deepEqual([fill.kind, fill.text, fill.desk, fill.practice], ['trading', 'bought 23 NO on Austin high 100–101°F · Sep 16 at 43¢', 'haghani', false]);
  const coin = feedLine(ev('broker.fill', 'broker:shadow', { desk_id: 'hilibrand-2', instrument: { asset_class: 'crypto', symbol: 'AAVE-USD', venue: 'coinbase' }, side: 'buy', quantity: '0.087843', price: '113.62000000', shadow: true }), live);
  assert.deepEqual([coin.text, coin.practice], ['bought 0.0878 AAVE at $113.62', true]);
  assert.equal(feedLine(ev('broker.fill', 'broker:shadow', { desk_id: 'hilibrand', instrument: kalshi, side: 'buy', quantity: '1', price: '0.5', shadow: true }), live).practice, true, 'a shadow fill is practice whoever placed it');
  assert.equal(feedLine(ev('broker.fill', 'broker:shadow', { desk_id: 'settlement', instrument: kalshi, side: 'sell', quantity: '1', price: '0' }), live), null);
  assert.equal(feedLine(ev('broker.fill', 'broker:kalshi', { desk_id: 'scholes-4', instrument: kalshi, side: 'sell', quantity: '1', price: '0', settlement: true }), live), null);
  assert.equal(feedLine({ ...ev('broker.fill', 'broker:kalshi', { desk_id: 'haghani', instrument: kalshi, side: 'buy', quantity: '1', price: '0.48', note: 'reverses a fill recorded on the wrong side' }), id: 'fill:kalshi:x:reversal:3' }, live), null);
  const closed = feedLine(ev('desk.outcome', 'desk:hilibrand-4', { market_id: 'AAVE-USD', instrument: 'crypto:AAVE-USD:coinbase', result: 'sold', pnl: '-0.36030101621000' }), live);
  assert.deepEqual([closed.text, closed.pnl, closed.tone, closed.practice], ['closed AAVE, sold', '−$0.36', 'negative', true]);
  const settled = feedLine(ev('desk.outcome', 'desk:haghani', { market_id: 'KXHIGHAUS-26SEP16-B100.5', result: 'no', pnl: '4.12' }), live);
  assert.deepEqual([settled.text, settled.pnl, settled.tone], ['closed Austin high 100–101°F · Sep 16, settled NO', '+$4.12', 'positive']);
  for (const kind of ['desk.tool_result', 'ledger.mark', 'risk.decision', 'desk.code_run', 'ops.alert', 'ops.budget']) assert.equal(feedLine(ev(kind, 'desk:haghani', { text: 'x' }), live), null, kind);
  assert.deepEqual(FEED_KINDS, ['desk.thought', 'desk.tool_call', 'broker.fill', 'desk.outcome']);
  assert.ok(Object.keys(RESEARCH).every(tool => !['propose_order', 'cancel_order', 'memo', 'playbook_write'].includes(tool)));

  // Newest first; a desk repeating itself, numbers aside, folds into one line with a count.
  seq = 0;
  const events = [
    ev('desk.tool_call', 'desk:haghani-2', { tool: 'event_markets', arguments: { query: 'KXHIGHCHI-26SEP16-B71.5' } }),
    ev('desk.tool_call', 'desk:haghani-2', { tool: 'event_markets', arguments: { query: 'KXHIGHCHI-26SEP16-B73.5' } }),
    ev('desk.thought', 'desk:haghani', { text: 'Different desk in between.' }),
    ev('desk.tool_call', 'desk:haghani-2', { tool: 'event_markets', arguments: { query: 'KXHIGHCHI-26SEP16-B75.5' } }),
    ev('desk.tool_call', 'desk:haghani-2', { tool: 'propose_order', arguments: {} }),
    ev('desk.thought', 'desk:haghani-2', { text: 'Now propose orders.' }),
  ];
  const lines = feedLines([...events].reverse(), live);
  assert.deepEqual(lines.map(line => [line.name, line.kind, line.count]), [['Haghani II', 'thinking', 1], ['Haghani II', 'researching', 3], ['Haghani', 'thinking', 1]]);
  assert.equal(lines[1].text, 'searching Kalshi for Chicago high 75–76°F · Sep 16', 'the newest of the repeats is the one shown');
  assert.equal(feedLines(events, live, { limit: 2 }).length, 2);
  assert.deepEqual(feedLines(events, live, { skip: [events[5].id] }).map(line => line.kind), ['researching', 'thinking'], 'the thought on stage is not repeated below it');
  assert.deepEqual(feedLines([], live), []);

  // The stage: the newest thought, unless the desk already on it spoke within the hold.
  const think = (desk, minute, text, session = `${desk}:s`) => ({ seq: minute * 100, id: `${desk}:${minute}`, kind: 'desk.thought', stream: `desk:${desk}`, at: `2026-09-16T17:00:${String(minute).padStart(2, '0')}.000Z`, payload: { session_id: session, text } });
  const stage = [think('haghani-2', 10, 'first'), think('mullins', 30, 'newer'), { seq: 1100, id: 'r', kind: 'desk.tool_call', stream: 'desk:haghani-2', at: '2026-09-16T17:00:11.000Z', payload: { session_id: 'haghani-2:s', tool: 'weather_forecast', arguments: { city: 'Chicago' } } }];
  assert.deepEqual(pick(heroThought(stage)), ['mullins', 'newer', '']);
  assert.deepEqual(pick(heroThought(stage, 'haghani-2')), ['haghani-2', 'first', 'reading the NWS forecast for Chicago'], 'a desk mid-thought keeps the stage');
  assert.equal(heroThought(stage, 'haghani-2', { holdMs: 5000 }).desk, 'mullins', 'but not past the hold');
  const ended = [...stage, { seq: 1200, id: 'end', kind: 'desk.session_ended', stream: 'desk:haghani-2', at: '2026-09-16T17:00:12.000Z', payload: {} }];
  assert.equal(heroThought(ended, 'haghani-2').desk, 'mullins', 'a desk whose session ended gives up the stage');
  assert.equal(heroThought([]), null);
  function pick(hero) { return [hero.desk, hero.text, hero.research]; }
});

test('real-money positions skip dust and count practice; the generations show whether children beat the live partner', () => {
  const board = checkpoint({ desks: [
    desk('haghani', { name: 'Haghani', family: 'weather', mode: 'live', return_pct: '-20.6', pnl_usd: '-21.63', capital_usd: '104.93', positions: [
      position({ instrument: { symbol: 'KXHIGHNY-26SEP16-B77.5', asset_class: 'event', venue: 'kalshi' }, side: 'no', market_value: '7.98', unrealized_pnl: '-11.780000', thesis: '' }),
      position({ instrument: { symbol: 'KXHIGHMIA-26SEP16-B90.5', asset_class: 'event', venue: 'kalshi' }, side: 'long', market_value: '18.9', unrealized_pnl: '9.03' }),
      position({ market_value: '0.49' }),
    ] }),
    desk('haghani-2', { name: 'Haghani II', family: 'weather', generation: 2, parent_id: 'haghani', mode: 'shadow', return_pct: '-2.63', pnl_usd: '-3.94', capital_usd: '150', positions: [position(), position()] }),
    desk('haghani-3', { name: 'Haghani III', family: 'weather', generation: 3, parent_id: 'haghani', mode: 'shadow', return_pct: '-22.1', pnl_usd: '-33.19', capital_usd: '150' }),
    desk('mullins', { family: 'kalshi', mode: 'live', return_pct: '0', pnl_usd: '0', capital_usd: '300' }),
    desk('mullins-2', { family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', return_pct: '-0.0671', pnl_usd: '-0.33', capital_usd: '492', status: 'retired' }),
  ], lab: lab({ experiments: [experiment()] }) });
  const book = openPositionRows(board);
  assert.deepEqual(book.rows.map(row => [row.market, row.side, row.valueText, row.pnlText, row.tone]), [
    ['Miami high 90–91°F · Sep 16', 'YES', '$18.90', '+$9.03', 'positive'],
    ['NYC high 77–78°F · Sep 16', 'NO', '$7.98', '−$11.78', 'negative'],
  ]);
  assert.deepEqual([book.practice, book.dust], [2, 1]);
  assert.deepEqual(openPositionRows(checkpoint()), { rows: [], practice: 0, dust: 0 });

  const grid = generationGrid(board);
  assert.deepEqual(grid.generations, [1, 2, 3]);
  assert.deepEqual(grid.rows.map(row => [row.name, row.word, row.cells.map(cell => cell && `${cell.text}${cell.live ? ' live' : ''}${cell.leader ? ' ★' : ''}`)]), [
    ['Mullins', 'Fed & CPI', ['0.0% live ★', '−0.1%', null]],
    ['Haghani', 'weather', ['−20.6% live', '−2.6% ★', '−22.1%']],
  ]);
  assert.deepEqual(grid.all.map(cell => cell.text), ['−5.3%', '−0.7%', '−22.1%']);
  assert.equal(grid.reading, '1 of 2 families have a practice child beating the partner that trades real money.');
  assert.equal(generationGrid(checkpoint({ desks: [desk('mullins', { mode: 'live' })] })).reading, '', 'a founder alone is not a race');
  assert.equal(generationGrid(checkpoint({ desks: [] })).rows.length, 0);

  const counts = loopCounts([
    { kind: 'evolution.spawned', payload: { desk_id: 'haghani-2' } }, { kind: 'evolution.spawned', payload: { desk_id: 'haghani-2' } },
    { kind: 'evolution.promoted', payload: { desk_id: 'haghani-2' } },
    { kind: 'lab.experiment', payload: { experiment_id: 'exp-0123456789ab' } }, { kind: 'lab.experiment', payload: { experiment_id: 'exp-other' } },
  ], board);
  assert.deepEqual(counts, { bred: 3, retired: 1, promoted: 1, demoted: 0, founded: 0, experiments: 2 }, 'the roster is a floor under the trimmed log, and nothing counts twice');
  assert.equal(loopCountLine(counts), 'bred 3 · retired 1 · promoted 1 · experiments 2');
});

