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
  tapeLine, markSeries, sparkline, nowLine, latestPlaybook, diffLines, allocationSeries, orderDesks,
  partnerOf, partnerName, partnerRole, filterGroup, matchesFilters, truncate, lineage, fillRows, bookRows,
  money, percent, signedMoney, streamUrl, streamLabel, startCapital, PARTNERS, PARTNER_ORDER, TAPE_FILTERS,
  floorCounts, floorEquity, floorDaily, deskCountLine, infraRows, uptimeText, boxShort, cardNumbers, modeBadge, creditLine,
  accountEquity, accountVenues, portfolioLabel, venueLabel, venueChipText, floorBalanceSeries, sinceStart,
  agoText, typingSchedule, sessionThoughts, idleLine, thoughtStream, codeRuns, holdingRows, lineageBadges, genomeSummary, allocationReasons,
  positionRows, exitChips, liveSessionText, watchLine, lineageGrid, mutationBadges, experimentRows, changeSummary,
  curveSeries, curveReading, tradeStories, latestCalibration, familyCalibrations, reliabilitySeries, probabilityText,
  instrumentLabel, profileName, LOOPS, runClock, portfolioLine, positionRationale, storyAnchor, storyHref,
  runStrip, ago, roman, raceName, triggerText, isInteresting, INTERESTING_KINDS, deskRecord, idleRecordLine, nowRows, nightLine, flatLine, raceRows, raceLine,
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
  assert.match(fill.text, /bought 20 MSFT · at \$500\.25 · fee \$0\.01/);
  assert.equal(fill.group, 'trades');
  assert.match(tapeLine({ stream: 'risk', kind: 'risk.decision', at: event().at, payload: { intent_id: 'i1', desk_id: 'rosenfeld', approved: false, reasons: ['position cap'] } }).text, /blocked Rosenfeld's order · position cap/);
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
  const titles = { 'index.html': 'Long Term Capital Management', 'desk/index.html': 'Desk · LTCM', 'committee/index.html': 'The loop · LTCM' };
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
  assert.match(floorHtml, /Six AI partners trading real money on Kalshi and Coinbase, breeding better versions of themselves, in public\./);
  assert.match(floorHtml, /Named after the fund that blew up in 1998, as a warning\. No affiliation\./);
  for (const id of ['floor-run', 'floor-more', 'floor-more-body', 'floor-now', 'floor-positions', 'floor-race', 'tape-toggle', 'floor-tape']) assert.match(floorHtml, new RegExp(`id="${id}"`));
  for (const gone of ['floor-numbers', 'floor-history', 'floor-partners', 'tape-filters', 'floor-status', 'floor-infra', 'floor-lineage', 'floor-lab']) assert.doesNotMatch(floorHtml, new RegExp(`id="${gone}"`), `${gone} folded into the new panels`);
  // The explainer is the three loops, in reading order, and one line of what cannot change.
  for (const loop of LOOPS) assert.match(floorHtml, new RegExp(`<h3>${loop.label}</h3>`));
  assert.ok(floorHtml.indexOf('<h3>Trade</h3>') < floorHtml.indexOf('<h3>Desk</h3>') && floorHtml.indexOf('<h3>Desk</h3>') < floorHtml.indexOf('<h3>Floor</h3>'));
  assert.match(floorHtml, /What cannot change: the risk engine, the critic, the order caps, the keys, the reserve, the kill switch\./);
  assert.ok(floorHtml.indexOf('id="floor-run"') < floorHtml.indexOf('id="floor-now"') && floorHtml.indexOf('id="floor-now"') < floorHtml.indexOf('id="floor-positions"')
    && floorHtml.indexOf('id="floor-positions"') < floorHtml.indexOf('id="floor-race"') && floorHtml.indexOf('id="floor-race"') < floorHtml.indexOf('id="floor-tape"'), 'the brief\u2019s order: clock, now, holdings, race, tape');
  // The word budget: under 120 static words above the tape, so the live things carry the page.
  const aboveTape = floorHtml.slice(floorHtml.indexOf('<main'), floorHtml.indexOf('id="floor-tape"')).replace(/<[^>]+>/g, ' ');
  assert.ok(aboveTape.split(/\s+/).filter(Boolean).length < 120, 'static words above the tape');
  for (const id of ['committee-lab', 'committee-calibration']) assert.match(await readFile(new URL('../capital/committee/index.html', import.meta.url), 'utf8'), new RegExp(`id="${id}"`));
  const committeeHtml = await readFile(new URL('../capital/committee/index.html', import.meta.url), 'utf8');
  assert.match(committeeHtml, /<h1 id="committee-title">The loop<\/h1>/);
  assert.ok(committeeHtml.indexOf('id="loop-curve"') < committeeHtml.indexOf('id="committee-lab"'), 'the improvement curve leads the loop page');
  assert.ok(committeeHtml.indexOf('id="committee-calibration"') < committeeHtml.indexOf('id="committee-memos"'), 'the memo sits behind a chevron at the end');
  assert.match(committeeHtml, /<details class="panel">\s*<summary>Meriwether’s memo<\/summary>/);
  const deskHtml = await readFile(new URL('../capital/desk/index.html', import.meta.url), 'utf8');
  for (const id of ['desk-header', 'desk-status', 'desk-think', 'think-state', 'desk-detail', 'desk-tape']) assert.match(deskHtml, new RegExp(`id="${id}"`), id);
  assert.ok(deskHtml.indexOf('id="desk-think"') < deskHtml.indexOf('id="desk-detail"'), 'watch it think is the hero');
  assert.match(deskHtml, /<summary>Everything it published<\/summary>/);
  // Fewer words: what a visitor reads before anything loads.
  const staticWords = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  assert.ok(staticWords(deskHtml) < 60, `desk page static words: ${staticWords(deskHtml)}`);
  assert.ok(staticWords(committeeHtml) < 100, `loop page static words: ${staticWords(committeeHtml)}`);

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

test('the floor page mounts the run strip, the now cards, the holdings, the race and a tape with one toggle', async () => {
  const root = stubPage('floor', ['floor-run', 'floor-more-body', 'floor-now', 'floor-positions', 'floor-race', 'tape-toggle', 'floor-tape']);
  const board = [
    desk('merton', { name: 'Merton', family: 'merton', mode: 'live', equity: '90000', return_pct: '9', gate: null, live_session: { session_id: 'merton:s', trigger: 'cadence:09:45', started_at: '2026-09-15T13:45:00.000Z' } }),
    desk('rosenfeld'),
  ];
  const longThought = published(3, { id: 'desk.rosenfeld.thought.3', payload: { session_id: 's', text: 'word '.repeat(60).trim() } });
  const tape = [longThought, { ...published(2), seq: 2 }, { ...markEvent('merton', 2), seq: 1 }];
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint({ desks: board, run: run(), infra: infra() });
    if (path.includes('after=')) return { schema_version: 1, latest_seq: 3, events: [] };
    if (path.includes('desk%3Amerton')) {
      return { schema_version: 1, latest_seq: 3, events: [
        published(1, { id: 'desk.merton.thought.1', stream: 'desk:merton', payload: { session_id: 's', text: 'Filing lands at four.' } }),
        published(4, { id: 'desk.merton.tool.4', stream: 'desk:merton', kind: 'desk.tool_call', at: '2026-09-15T14:02:30.000Z', payload: { session_id: 's', tool: 'filing', arguments: { symbol: 'MSFT' } } }),
      ] };
    }
    if (path.includes('desk%3Arosenfeld')) {
      return { schema_version: 1, latest_seq: 3, events: [
        published(5, { id: 'desk.rosenfeld.memo.5', kind: 'desk.memo', payload: { session_id: 's', title: 'No trade', text: 'Priced fairly.' } }),
        published(6, { id: 'desk.rosenfeld.end.6', kind: 'desk.session_ended', at: '2026-09-15T14:03:00.000Z', payload: { session_id: 's', reason: 'end_session', requests: 3, cost_usd: '0.02' } }),
      ] };
    }
    if (path.includes('stream=')) return { schema_version: 1, latest_seq: 3, events: [] };
    return { schema_version: 1, latest_seq: 3, events: tape };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const strip = root.querySelector('#floor-run');
    assert.equal(strip.getAttribute('aria-busy'), 'false');
    assert.match(strip.textContent, /running \d+d \d+h since Sep 12, 2026 \$41\.97 of Sail credit spent profit \+\$63\.40 \+\$1\.51 per Sail dollar 412 sessions \$4\.21 \/ \$25 today/);
    assert.equal(strip.withClass('run-item')[1].className, 'run-item positive', 'profit is toned');
    assert.match(root.querySelector('#floor-more-body').textContent, /running on a Sail cloud VM.*box 9f2c1ad4.*118.*keys never leave Cloudflare/s, 'the box facts sit behind the chevron');

    const now = root.querySelector('#floor-now');
    assert.equal(now.getAttribute('aria-busy'), 'false');
    const cards = now.withClass('now-card');
    assert.equal(cards.length, 1, 'one card per desk in session');
    assert.match(cards[0].textContent, /Merton sat down for the 09:45 slot/);
    assert.match(cards[0].textContent, /Filing lands at four\./, 'the newest thought');
    assert.match(cards[0].textContent, /using filing/, 'the last tool it asked');
    const idle = now.withClass('now-idle');
    assert.equal(idle.length, 1);
    assert.match(idle[0].textContent, /Rosenfeld.*shadow.*last session .* ago · No trade/s);
    assert.deepEqual(now.find('a').map(node => node.href), ['/capital/desk/?id=merton', '/capital/desk/?id=rosenfeld']);

    const race = root.querySelector('#floor-race');
    assert.equal(race.getAttribute('aria-busy'), 'false');
    assert.deepEqual(race.withClass('race-chip').map(chip => chip.href), ['/capital/desk/?id=merton', '/capital/desk/?id=rosenfeld']);
    assert.match(race.withClass('race-chip')[0].textContent, /Merton.*\+9\.00%.*thinking/s);

    const toggle = () => root.querySelector('#tape-toggle').find('button')[0];
    assert.equal(toggle().textContent, 'everything');
    assert.equal(toggle().getAttribute('aria-pressed'), 'false');
    const lines = () => root.querySelector('#floor-tape').withClass('tape-entry');
    assert.equal(lines().length, 2, 'a mark is plumbing; thoughts show by default');
    toggle().click();
    assert.equal(toggle().getAttribute('aria-pressed'), 'true');
    assert.equal(lines().length, 3, 'everything shows the mark too');
    toggle().click();
    assert.equal(lines().length, 2);

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

test('a desk page leads with its thinking, then holdings, stories and the playbook behind a chevron', async () => {
  const root = stubPage('desk', ['desk-header', 'desk-status', 'desk-think', 'think-state', 'desk-detail', 'desk-tape']);
  const marks = [0, 1, 2].map(index => markEvent('merton', index));
  const deskEvents = [
    { seq: 1, id: 'desk.merton.session.1', stream: 'desk:merton', kind: 'desk.session_started', at: '2026-09-15T13:30:00.000Z', digest: 'a'.repeat(64), payload: { session_id: 'merton:s1', trigger: 'cadence:09:30' } },
    published(2, { id: 'desk.merton.thought.1', stream: 'desk:merton', at: '2026-09-15T13:30:05.000Z', payload: { session_id: 'merton:s1', text: 'Margins widened for a third quarter.' } }),
    { seq: 3, id: 'desk.merton.call.1', stream: 'desk:merton', kind: 'desk.tool_call', at: '2026-09-15T13:30:06.000Z', digest: 'b'.repeat(64), payload: { session_id: 'merton:s1', call_id: 'c1', tool: 'filing', arguments: { symbol: 'MSFT', form: '10-Q' } } },
    { seq: 4, id: 'desk.merton.memo.1', stream: 'desk:merton', kind: 'desk.memo', at: '2026-09-15T13:31:00.000Z', digest: 'c'.repeat(64), payload: { session_id: 'merton:s1', title: 'No trade: priced fairly', text: 'The filing says what the price says.' } },
    { seq: 5, id: 'desk.merton.session.1.end', stream: 'desk:merton', kind: 'desk.session_ended', at: '2026-09-15T13:31:10.000Z', digest: 'd'.repeat(64), payload: { session_id: 'merton:s1', requests: 3, cost_usd: '0.02', reason: 'end_session' } },
    {
      seq: 60, id: 'desk.merton.playbook.5', stream: 'desk:merton', kind: 'desk.playbook_updated', at: '2026-09-15T02:00:00.000Z',
      digest: 'e'.repeat(64), payload: { version: 5, reason: 'The drift stopped paying after day three.', diff: '@@ sizing @@\n-hold 5 days\n+hold 3 days' },
    },
  ];
  await withBrowser('?id=merton', path => {
    if (path.startsWith('/api/capital/desks/')) return desk('merton', { name: 'Merton', family: 'merton', mode: 'live', cash: '12000' });
    if (path.includes('ledger%3Amerton')) return { schema_version: 1, latest_seq: 60, events: marks.slice().reverse() };
    if (path.includes('desk%3Amerton')) return { schema_version: 1, latest_seq: 60, events: deskEvents };
    return { schema_version: 1, latest_seq: 60, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    assert.equal(globalThis.document.title, 'Merton · LTCM');
    const header = root.querySelector('#desk-header');
    assert.match(header.textContent, /Merton/);
    assert.match(header.textContent, /Robert · filings, long horizon · Alpaca/);
    assert.match(header.textContent, /Trading real money\./);
    assert.match(header.textContent, /founder/, 'the lineage badge');
    assert.match(header.textContent, /Reads filings and holds for quarters/, 'the mandate');
    assert.equal(header.find('details').length, 1, 'the mandate sits behind a chevron');
    assert.equal(header.find('svg').length, 1, 'the equity sparkline sits in the header');
    // The hero: the session's words, in order, tool calls as one short line each.
    const think = root.querySelector('#desk-think');
    assert.equal(think.getAttribute('aria-busy'), 'false');
    assert.equal(think.withClass('thought').length, 2);
    assert.match(think.withClass('thought')[0].textContent, /Margins widened for a third quarter\./);
    assert.match(think.withClass('thought-call')[0].textContent, /→ filing · symbol=MSFT form=10-Q/);
    assert.match(root.querySelector('#think-state').textContent, /^ended .* · No trade: priced fairly$/);
    const detail = root.querySelector('#desk-detail');
    const text = detail.textContent;
    assert.match(text, /Holdings.*Flat · \$12,000 cash/s);
    assert.match(text, /Trade stories.*No order yet/s);
    assert.match(text, /Playbook · rewritten/);
    assert.match(text, /The drift stopped paying after day three\./, 'the playbook reason');
    const [diff] = detail.find('pre');
    assert.deepEqual(diff.children.map(line => line.className), ['diff-line diff-meta', 'diff-line diff-remove', 'diff-line diff-add']);
    assert.equal(detail.getAttribute('aria-busy'), 'false');
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

test('a desk may say when it next sits down, or that it never does', () => {
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('rosenfeld', { next_session_at: '2026-09-15T19:30:00.000Z' })] })), true);
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('rosenfeld', { next_session_at: null })] })), true);
  assert.equal(validCheckpoint(checkpoint({ desks: [desk('rosenfeld', { next_session_at: 'soon' })] })), false);
});

test('the runway spend policy is accepted, rendered, and refused when it is not arithmetic', () => {
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

  // The headline says what the owner wants to know: how much credit, how long it lasts, no cap.
  assert.deepEqual(creditLine(runway), { label: 'Sail credit', value: '$280', note: '385d runway · no cap · $0.10 today', mode: 'open' });
  assert.equal(creditLine({ ...runway, mode: 'throttled', cap_usd: '2' }).note, '385d runway · throttled to $2 a day');
  assert.equal(creditLine({ ...runway, mode: 'stopped', balance_usd: '9.80' }).note, 'stopped · waiting for credit');
  assert.equal(creditLine({ spent_today_usd: '4.21', cap_usd: '25' }).value, '$4.21 / $25', 'the capped policy keeps its old line');
  const rows = new Map(infraRows(checkpoint({ budget: runway, infra: infra() })));
  assert.equal(rows.get('Sail spend today'), '$4.21 · no cap · 385 days of runway');
});

test('the race badges live against shadow, and the box facts sit behind the chevron', async () => {
  const root = stubPage('floor', ['floor-run', 'floor-more-body', 'floor-now', 'floor-positions', 'floor-race', 'tape-toggle', 'floor-tape']);
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
    const more = root.querySelector('#floor-more-body');
    assert.match(more.textContent, /running on a Sail cloud VM/);
    assert.match(more.textContent, /box 9f2c1ad4/);
    assert.match(more.textContent, /1d 2h/);
    assert.match(more.textContent, /118/);
    assert.match(more.textContent, /\$4\.21 of \$25/);
    assert.match(more.textContent, /37/, 'Sail requests today');
    assert.match(more.textContent, /The desks think on Sail\. Their keys never leave Cloudflare\. Every order passes a risk engine and a critic\./);
    assert.doesNotMatch(root.querySelector('#floor-run').textContent, /\$2,000/, 'a notional book never reaches the headline');

    // The founding order decides the row order, so Merton (shadow) leads and Mullins (live) follows.
    const chips = root.querySelector('#floor-race').withClass('race-chip');
    assert.deepEqual(chips.map(chip => chip.className), ['race-chip', 'race-chip race-live']);
    assert.equal(chips[1].withClass('badge-dot').length, 1, 'live pulses');
    assert.equal(chips[0].withClass('badge-dot').length, 0, 'shadow does not');
    assert.match(chips[0].getAttribute('title'), /shadow: scored, never sent/);
    assert.match(chips[1].getAttribute('title'), /live: real money/);
    assert.match(chips[1].textContent, /Mullins.*\+5\.20%/s);
    assert.match(chips[0].textContent, /Merton.*\+3\.50%/s);
    assert.equal(root.querySelector('#floor-race').withClass('race-leader').length, 0, 'a family of one has no leader');
    assert.match(root.querySelector('#floor-race').textContent, /The race starts with the first bred variant\./);
  });
});

test('a shadow desk page says nothing on it was ever sent', async () => {
  const root = stubPage('desk', ['desk-header', 'desk-status', 'desk-think', 'think-state', 'desk-detail', 'desk-tape']);
  await withBrowser('?id=merton', path => {
    if (path.startsWith('/api/capital/desks/')) return desk('merton', { name: 'Merton', family: 'merton', mode: 'shadow' });
    return { schema_version: 1, latest_seq: 1, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const header = root.querySelector('#desk-header').textContent;
    assert.match(header, /shadow/);
    assert.match(header, /Shadow: scored on real prices, never sent\./);
    assert.match(header, /Equity \(shadow\)/);
    assert.doesNotMatch(header, /hypothetical/);
    assert.match(root.querySelector('#think-state').textContent, /no session yet/);
    assert.match(root.querySelector('#desk-think').textContent, /Nothing said yet\./);
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
  assert.match(floorHtml, /id="floor-more"/);
  assert.match(floorHtml, /Shadow desks are scored on the same prices and never send an order\./);
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

test('the holdings lead with the accounts, the balance line and what has changed since the start', async () => {
  const marks = [floorMark(0, '950.00'), floorMark(1, '965.00'), floorMark(2, '979.69')];
  assert.equal(floorBalanceSeries([marks[0]]), null, 'a line needs a second mark');
  assert.equal(sinceStart(marks).amount, '+$29.69');
  assert.equal(sinceStart([]), null);

  const line = tapeLine(floorMark());
  assert.equal(line.label, 'Floor balance');
  assert.equal(line.group, 'trades', 'the balance belongs with the money, not with the alerts');
  assert.match(line.text, /balance \$979\.69/);
  assert.match(line.text, /Kalshi \$492\.29, Coinbase \$487\.40/);

  const board = [desk('mullins', { name: 'Mullins', family: 'mullins', mode: 'live', equity: '210.55', gate: null })];
  const routes = (body, events) => path => {
    if (path.startsWith('/api/capital/checkpoint')) return body;
    if (path.includes('kind=floor.mark')) return { schema_version: 1, latest_seq: 302, events };
    return { schema_version: 1, latest_seq: 302, events: [] };
  };
  const ids = ['floor-run', 'floor-now', 'floor-positions', 'floor-race', 'tape-toggle', 'floor-tape'];
  const root = stubPage('floor', ids);
  await withBrowser('', routes(checkpoint({ desks: board, floor: accountFloor(), run: run({ sessions_today: 7 }) }), marks), async () => {
    const feed = await startCapital(root);
    feed.stop();
    const holdings = root.querySelector('#floor-positions');
    assert.equal(holdings.getAttribute('aria-busy'), 'false');
    const accounts = holdings.withClass('holdings-line')[0];
    assert.match(accounts.textContent, /^\$979\.69 Kalshi \$492\.29 Coinbase \$487\.40/, 'the real balance, then each account');
    assert.equal(accounts.find('svg').length, 1, 'the balance line rides with the accounts');
    assert.match(accounts.textContent, /since start \+\$29\.69/);
    assert.match(holdings.textContent, /Flat\. \$980 in cash across 2 accounts\. 7 sessions today, no trade taken\./);
  });

  // A venue that stopped answering keeps its last balance on the chip and says it is stale.
  const stale = stubPage('floor', ids);
  const outage = accountFloor({ venues: [venueRow('kalshi', { stale: true }), venueRow('coinbase', COINBASE)] });
  await withBrowser('', routes(checkpoint({ desks: board, floor: outage }), []), async () => {
    const feed = await startCapital(stale);
    feed.stop();
    const accounts = stale.querySelector('#floor-positions').withClass('holdings-line')[0];
    assert.match(accounts.textContent, /Kalshi \$492\.29 stale/, 'the stale account is still counted, and labelled');
    const [chip] = accounts.withClass('venue-chip-stale');
    assert.match(chip.getAttribute('title'), /Kalshi did not answer the last balance request/);
    assert.equal(accounts.find('svg').length, 0, 'no marks, no line');
    assert.match(stale.querySelector('#floor-positions').textContent, /Flat\. \$980 in cash across 2 accounts\. No trade taken yet\./);
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

test('the book, the lineage and the lab project from the checkpoint', () => {
  const board = checkpoint({
    desks: [
      desk('mullins-2', { name: 'Mullins II', family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', venues: ['kalshi'], mutation: mutation({ model_profile: 'kimi_flex', model_changed: true, session_shift_minutes: -45 }),
        positions: [position({ instrument: { symbol: 'KXFED-26SEP-T3.75', asset_class: 'event', venue: 'kalshi' }, side: 'yes', quantity: '10', entry_price: '0.89', mark_price: '0.91', market_value: '9.10', unrealized_pnl: '0.20', thesis: 'A hike is 93% likely.', target_price: null, stop_price: null, time_stop_at: null, exit_orders: [] })] }),
      desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', venues: ['coinbase'], positions: [position()], live_session: liveSession() }),
      desk('mullins', { name: 'Mullins', family: 'kalshi', mode: 'live', venues: ['kalshi'], positions: [] }),
    ],
    lab: lab(), watch: watch(),
  });
  const rows = positionRows(board);
  assert.deepEqual(rows.map(row => [row.desk, row.live, row.instrument, row.side]), [['hilibrand', true, 'BTC-USD', 'long'], ['mullins-2', false, 'KXFED-26SEP-T3.75', 'yes']], 'live first');
  assert.equal(rows[0].pnl, '4.10');
  assert.equal(rows[0].tone, 'positive');
  assert.equal(rows[0].venue, 'Coinbase');
  assert.deepEqual(rows[0].chips.map(chip => chip.kind), ['target', 'stop', 'time_stop', 'resting']);
  assert.deepEqual(rows[1].chips.map(chip => chip.text), ['no exit plan']);
  assert.deepEqual(exitChips(position({ exit_orders: [] })).map(chip => chip.kind), ['target', 'stop', 'time_stop', 'floor']);
  assert.equal(exitChips(position()).find(chip => chip.kind === 'stop').text, 'stop $75,500.00');
  assert.equal(exitChips(position({ stop_price: '0.4', exit_orders: [] }))[1].text, 'stop $0.4000', 'contract prices keep four places');
  assert.deepEqual(positionRows(checkpoint()), []);
  assert.equal(liveSessionText(board.desks[1]), 'live now · cadence 14 00');
  assert.equal(liveSessionText(board.desks[2]), '');
  assert.match(watchLine(board), /^12 looks today · 3 woke a desk · last \d\d:\d\d:\d\d · \$0\.31 spent$/);
  assert.equal(watchLine(checkpoint()), null);
  assert.match(watchLine(checkpoint({ watch: watch({ triggers_today: 0, wakes_today: 0, last_trigger_at: null }) })), /0 looks today · 0 woke a desk · quiet so far/);

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

  const experiments = experimentRows(board.lab);
  assert.equal(experiments.length, 1);
  assert.equal(experiments[0].variantName, 'Mullins 4');
  assert.equal(experiments[0].change, 'cadence sessions 08:10, 13:30, 16:30 · effort high');
  assert.equal(changeSummary({ 'model.profile': 'kimi_flex', limits: { max_position_pct: '0.2' }, playbook_note: 'x' }), 'profile Kimi K2.6 · limits max position pct 0.2 · house view added');
  const series = curveSeries(board.lab.curve);
  assert.deepEqual(series.map(metric => metric.key), ['cost_adjusted_excess_pct', 'brier', 'pnl_per_inference_usd']);
  assert.equal(series[0].points.length, 2);
  assert.match(series[0].path, /^M12\.00,\d+\.\d\d L228\.00,10\.00$/, 'the better generation sits at the top');
  assert.equal(series[0].points[1].text, '+2.10%');
  assert.equal(curveSeries([{ generation: 1, desks: 1, decisions: 0, cost_usd: '0', pnl_usd: '0', cost_adjusted_excess_pct: '0', brier: null, pnl_per_inference_usd: '0' }])[1].empty, true);
  assert.equal(curveReading(board.lab.curve), 'Generation 2 beats generation 1 on cost-adjusted return by 0.90%; forecasts sharper.');
  assert.equal(curveReading([curveRow(1)]), 'One generation so far (2 desks). The curve needs a second to say anything.');
  assert.match(curveReading([]), /appears with the first generation/);
  assert.equal(curveReading([curveRow(1), curveRow(2, { cost_adjusted_excess_pct: '0.5', brier: null })]), 'Generation 2 trails generation 1 on cost-adjusted return by 0.70%.');
  assert.equal(probabilityText('0.93'), '93%');
  assert.equal(probabilityText('1'), '100%');
  assert.equal(probabilityText('93'), '—');
  assert.equal(instrumentLabel({ symbol: 'ETH-USD', asset_class: 'crypto', venue: 'coinbase' }), 'ETH-USD');
  assert.equal(instrumentLabel('MSFT'), 'MSFT');
});

test('trade stories fold intent, risk, order, fills, exit plan and outcome; calibration and tape lines read the lab', () => {
  const instrument = { symbol: 'BTC-USD', asset_class: 'crypto', venue: 'coinbase' };
  const events = [
    { seq: 1, id: 'intent:oi-abc123', stream: 'desk:hilibrand', kind: 'desk.intent', at: '2026-09-15T18:31:00.000Z', payload: { intent_id: 'oi-abc123', desk_id: 'hilibrand', instrument, side: 'buy', quantity: '0.01', order_type: 'limit', limit_price: '76800', rationale: 'Trend continuation on the daily bars.' } },
    { seq: 2, id: 'risk:oi-abc123:1', stream: 'risk', kind: 'risk.decision', at: '2026-09-15T18:31:01.000Z', payload: { intent_id: 'oi-abc123', desk_id: 'hilibrand', approved: true, reasons: [] } },
    { seq: 3, id: 'order:ord-1:filled', stream: 'broker:coinbase', kind: 'broker.order', at: '2026-09-15T18:31:05.000Z', payload: { order_id: 'ord-1', intent_id: 'oi-abc123', desk_id: 'hilibrand', status: 'filled', filled_quantity: '0.01', average_price: '76800.5' } },
    { seq: 4, id: 'fill:coinbase:f1', stream: 'broker:coinbase', kind: 'broker.fill', at: '2026-09-15T18:31:06.000Z', payload: { fill_id: 'f1', order_id: 'ord-1', desk_id: 'hilibrand', instrument, side: 'buy', quantity: '0.01', price: '76800.5', fee: '1.92' } },
    exitPlan({ seq: 5 }),
    { seq: 6, id: 'outcome:hilibrand:BTC-USD', stream: 'desk:hilibrand', kind: 'desk.outcome', at: '2026-09-17T10:00:00.000Z', payload: { instrument: 'BTC-USD', market_id: null, result: 'target', entry_price: '76800.5', exit_price: '80000', quantity: '0.01', pnl: '31.99', held_for_hours: 40 } },
    { seq: 7, id: 'intent:oi-blocked', stream: 'desk:hilibrand', kind: 'desk.intent', at: '2026-09-15T19:00:00.000Z', payload: { intent_id: 'oi-blocked', desk_id: 'hilibrand', instrument, side: 'buy', quantity: '1', order_type: 'market', limit_price: null, rationale: 'Too big.' } },
    { seq: 8, id: 'risk:oi-blocked:1', stream: 'risk', kind: 'risk.decision', at: '2026-09-15T19:00:01.000Z', payload: { intent_id: 'oi-blocked', desk_id: 'hilibrand', approved: false, reasons: ['order notional above the desk limit'] } },
    { seq: 9, id: 'intent:other', stream: 'desk:mullins', kind: 'desk.intent', at: '2026-09-15T19:30:00.000Z', payload: { intent_id: 'oi-other', desk_id: 'mullins', instrument: { symbol: 'KXFED', asset_class: 'event', venue: 'kalshi' }, side: 'buy', quantity: '5', order_type: 'limit', limit_price: '0.9', rationale: 'Edge.' } },
  ];
  const stories = tradeStories(events, 'hilibrand');
  assert.deepEqual(stories.map(story => [story.id, story.state]), [['oi-blocked', 'blocked'], ['oi-abc123', 'closed']], 'newest first, another desk left out');
  const closed = stories[1];
  assert.deepEqual(closed.steps.map(step => step.key), ['thesis', 'risk', 'order', 'fill', 'exit', 'outcome']);
  assert.match(closed.steps[0].text, /^buy 0\.01 BTC-USD · limit \$76,800\.00 · Trend continuation/);
  assert.equal(closed.steps[1].text, 'approved');
  assert.equal(closed.steps[1].tone, 'positive');
  assert.equal(closed.steps[2].text, 'filled · filled 0.01 · avg $76,800.50');
  assert.equal(closed.steps[3].text, 'buy 0.01 · @ $76,800.50 · fee $1.9200');
  assert.match(closed.steps[4].text, /^exit plan for BTC-USD · target \$80,000\.00 · stop \$75,500\.00 · out by .+ · held at the venue$/);
  assert.equal(closed.steps[5].text, 'resolved target · P&L +$31.99 · 40h held');
  assert.equal(closed.steps[5].tone, 'positive');
  assert.equal(stories[0].steps[1].text, 'blocked · order notional above the desk limit');
  assert.equal(tradeStories(events).length, 3, 'no filter keeps every desk');
  assert.deepEqual(tradeStories([]), []);

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

test('the floor page mounts the holdings with their reasons, the now cards, the night desk and the race', async () => {
  const ids = ['floor-run', 'floor-now', 'floor-positions', 'floor-race', 'tape-toggle', 'floor-tape'];
  const root = stubPage('floor', ids);
  const board = checkpoint({
    desks: [
      desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', venues: ['coinbase'], return_pct: '1.2', positions: [position()], live_session: liveSession() }),
      desk('hilibrand-2', { name: 'Hilibrand II', family: 'crypto', generation: 2, parent_id: 'hilibrand', mode: 'shadow', venues: ['coinbase'], return_pct: '0.4', mutation: mutation(), positions: [position({ thesis: 'Shadow copy of the same setup.', exit_orders: [] })] }),
    ],
    lab: lab(), watch: watch(),
  });
  await withBrowser('', path => (path.startsWith('/api/capital/checkpoint') ? board : { schema_version: 1, latest_seq: 3, events: [] }), async () => {
    const feed = await startCapital(root);
    feed.stop();
    const positions = root.querySelector('#floor-positions');
    assert.equal(positions.getAttribute('aria-busy'), 'false');
    const cards = positions.withClass('position');
    assert.equal(cards.length, 2);
    assert.match(cards[0].textContent, /Hilibrand.*live.*long · BTC-USD · Coinbase/s);
    assert.match(cards[0].textContent, /\+\$4\.10/);
    assert.match(cards[0].textContent, /Trend continuation on the daily bars/, 'the desk’s own reason, inline');
    assert.match(cards[0].textContent, /target \$80,000\.00.*stop \$75,500\.00.*out by.*2 resting/s);
    assert.match(cards[1].textContent, /shadow/);
    assert.match(cards[1].textContent, /floor enforces/);
    assert.ok(cards[1].className.includes('position-shadow'));
    assert.deepEqual(positions.find('a').map(node => node.href), ['/capital/desk/?id=hilibrand', '/capital/desk/?id=hilibrand-2']);

    const now = root.querySelector('#floor-now');
    const live = now.withClass('now-card');
    assert.equal(live.length, 1);
    assert.match(live[0].textContent, /Hilibrand sat down for the 14:00 slot/);
    assert.match(live[0].textContent, /thinking…/, 'no thought published yet');
    assert.match(now.withClass('now-idle')[0].textContent, /Hilibrand II.*shadow.*no session yet/s);
    assert.match(now.withClass('now-night')[0].textContent, /^night desk: 12 looks, 3 wakes today$/);

    const race = root.querySelector('#floor-race');
    const rows = race.withClass('race-row');
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent, /^Crypto/);
    const chips = rows[0].withClass('race-chip');
    assert.deepEqual(chips.map(chip => chip.textContent.trim().split(/\s+/).slice(0, 2).join(' ')), ['Hilibrand +1.20%', 'Hilibrand II']);
    assert.ok(chips[0].className.includes('race-leader'), 'the higher score leads');
    assert.match(chips[0].textContent, /★ leads.*thinking/s);
    assert.match(chips[1].getAttribute('title'), /shadow: scored, never sent · DeepSeek V4 Pro · effort high · \+45 min/);
    assert.match(race.withClass('race-line')[0].textContent, /^1 experiment running · generation II vs I: \+0\.90%$/);
    const differ = race.find('details')[0];
    assert.match(differ.textContent, /how the children differ.*Hilibrand II.*DeepSeek V4 Pro.*effort high.*\+45 min.*the loop/s);
  });
  // A floor with nothing open says so, and a founder alone is still a race.
  const quiet = stubPage('floor', ids);
  await withBrowser('', path => (path.startsWith('/api/capital/checkpoint') ? checkpoint() : { schema_version: 1, latest_seq: 3, events: [] }), async () => {
    const feed = await startCapital(quiet);
    feed.stop();
    assert.match(quiet.querySelector('#floor-positions').textContent, /Flat\. No trade taken yet\./);
    assert.equal(quiet.querySelector('#floor-now').withClass('now-card').length, 0);
    assert.match(quiet.querySelector('#floor-now').textContent, /Rosenfeld.*no session yet/s);
    assert.equal(quiet.querySelector('#floor-now').withClass('now-night').length, 0, 'no watch block, no night line');
    assert.equal(quiet.querySelector('#floor-race').withClass('race-chip').length, 1, 'a founder alone is still a race');
    assert.match(quiet.querySelector('#floor-race').textContent, /The race starts with the first bred variant\./);
  });
});

test('a desk page tells its trade stories, shows its calibration and mutation, and says when it is live now', async () => {
  const root = stubPage('desk', ['desk-header', 'desk-status', 'desk-think', 'think-state', 'desk-detail', 'desk-tape']);
  const instrument = { symbol: 'KXFED-26SEP-T3.75', asset_class: 'event', venue: 'kalshi' };
  const deskEvents = [
    { seq: 1, id: 'intent:oi-fed', stream: 'desk:mullins-2', kind: 'desk.intent', at: '2026-09-15T13:31:00.000Z', digest: 'a'.repeat(64), payload: { intent_id: 'oi-fed', desk_id: 'mullins-2', instrument, side: 'buy', quantity: '10', order_type: 'limit', limit_price: '0.89', rationale: 'A hike is 93% likely; the market says 89.' } },
    forecast({ seq: 2, id: 'mullins-2:forecast:1', stream: 'desk:mullins-2' }),
  ];
  const decisions = [{ seq: 3, id: 'risk:oi-fed:1', stream: 'risk', kind: 'risk.decision', at: '2026-09-15T13:31:01.000Z', digest: 'b'.repeat(64), payload: { intent_id: 'oi-fed', desk_id: 'mullins-2', approved: true, reasons: [] } }];
  const orders = [{ seq: 4, id: 'order:sh-1:filled', stream: 'broker:shadow', kind: 'broker.order', at: '2026-09-15T13:31:02.000Z', digest: 'c'.repeat(64), payload: { order_id: 'sh-1', intent_id: 'oi-fed', desk_id: 'mullins-2', status: 'filled', filled_quantity: '10', average_price: '0.89', shadow: true } }];
  const labEvents = [calibration({ seq: 5, id: 'lab:cal:mullins-2', payload: { ...calibration().payload, desk_id: 'mullins-2', generation: 2 } })];
  await withBrowser('?id=mullins-2', path => {
    if (path.startsWith('/api/capital/desks/')) return desk('mullins-2', { name: 'Mullins II', family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', venues: ['kalshi'], mutation: mutation({ model_profile: 'kimi_flex', model_changed: true }), live_session: liveSession({ trigger: 'event_resolution', started_at: '2026-09-15T13:50:00.000Z' }), calibration: { n: 12, brier: '0.18', since: '2026-09-10T00:00:00.000Z' } });
    if (path.includes('kind=risk.decision')) return { schema_version: 1, latest_seq: 9, events: decisions };
    if (path.includes('kind=broker.order')) return { schema_version: 1, latest_seq: 9, events: orders };
    if (path.includes('stream=lab')) return { schema_version: 1, latest_seq: 9, events: labEvents };
    if (path.includes('desk%3Amullins-2')) return { schema_version: 1, latest_seq: 9, events: deskEvents };
    return { schema_version: 1, latest_seq: 9, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const header = root.querySelector('#desk-header').textContent;
    assert.match(header, /live now · event resolution/);
    assert.match(header, /Kimi K2\.6.*effort high.*\+45 min.*memory 80/s);
    const detail = root.querySelector('#desk-detail');
    const text = detail.textContent;
    assert.match(text, /Trade stories.*buy KXFED-26SEP-T3\.75.*open.*Thesis.*A hike is 93% likely.*Risk engine.*approved.*Order.*filled · filled 10 · avg \$0\.8900 · shadow, never sent/s);
    assert.match(text, /Calibration.*Forecasts scored.*12.*Brier score.*0\.18 · 0 is perfect, 0\.25 is a coin/s);
    assert.match(text, /said → happened/);
    assert.equal(detail.find('circle').length, 2, 'one dot per reliability bin');
    assert.ok(text.indexOf('Holdings') < text.indexOf('Trade stories') && text.indexOf('Trade stories') < text.indexOf('Calibration'), 'holdings, then stories, then calibration');
    assert.match(root.querySelector('#think-state').textContent, /thinking now · event resolution/, 'the checkpoint says it is in session before a thought arrives');
    assert.match(root.querySelector('#desk-tape').textContent, /puts 93% on KXFEDDECISION-26SEP-H25 yes · market 89%/);
  });
});

test('the committee page lists experiments, verdicts and calibration by family', async () => {
  const root = stubPage('committee', ['committee-status', 'committee-memos', 'committee-allocations', 'committee-gates', 'committee-lab', 'committee-calibration', 'committee-evolution']);
  const labEvents = [
    { seq: 1, id: 'lab:exp:1', stream: 'lab', kind: 'lab.experiment', at: '2026-09-15T02:00:00.000Z', digest: 'a'.repeat(64), payload: experiment() },
    { seq: 2, id: 'lab:verdict:1', stream: 'lab', kind: 'lab.verdict', at: '2026-09-15T03:00:00.000Z', digest: 'b'.repeat(64), payload: { experiment_id: 'exp-0123456789ab', status: 'adopted', evidence: {}, reason: 'Beat its parent on cost-adjusted return for four days.', as_of: '2026-09-15T03:00:00.000Z' } },
    calibration({ seq: 3, id: 'lab:cal:kalshi', payload: { ...calibration().payload, scope: 'family', desk_id: null, family: 'kalshi', n: 20, brier: '0.2' } }),
  ];
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint({ lab: lab({ experiments: [experiment({ status: 'adopted', verdict_reason: 'Beat its parent on cost-adjusted return for four days.' })] }) });
    if (path.includes('stream=lab')) return { schema_version: 1, latest_seq: 3, events: labEvents };
    return { schema_version: 1, latest_seq: 3, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const labBox = root.querySelector('#committee-lab');
    assert.match(labBox.textContent, /adopted.*kalshi family · variant Mullins 4.*Mullins trades better.*Beat its parent/s);
    assert.equal(labBox.find('table').length, 1, 'the verdict record');
    assert.match(labBox.find('table')[0].textContent, /exp-0123456789ab.*adopted/s);
    assert.match(root.querySelector('#committee-calibration').textContent, /kalshi family.*20.*0\.2/s);
    assert.equal(root.querySelector('#committee-calibration').getAttribute('aria-busy'), 'false');
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

test('the portfolio leads with the accounts and each holding carries the desk’s own reason and a link to its story', async () => {
  const floorBlock = { equity: '979.60', cash: '979.60', daily_pnl: '0', capital_usd: '979', since_inception_pct: '0', benchmark: null,
    account_equity: '979.60', account_cash: '979.60', venues: [{ venue: 'kalshi', equity: '492.29', cash: '492.29', as_of: '2026-09-15T14:00:00.000Z' }, { venue: 'coinbase', equity: '487.31', cash: '487.31', as_of: '2026-09-15T14:00:00.000Z' }] };
  assert.equal(portfolioLine(floorBlock), 'Portfolio $979.60 · Kalshi $492.29 · Coinbase $487.31');
  assert.equal(portfolioLine({ equity: '1' }), '');
  const held = position({ intent_id: 'oi-abc123', session_id: 'hilibrand:20260915-1830:cadence:18:30' });
  assert.equal(validPosition(held, '2026-09-15T14:05:00.000Z'), true);
  assert.equal(validPosition(position({ intent_id: 'x'.repeat(121) }), '2026-09-15T14:05:00.000Z'), false);
  const board = checkpoint({ floor: floorBlock, desks: [
    desk('hilibrand-2', { name: 'Hilibrand II', family: 'crypto', generation: 2, parent_id: 'hilibrand', mode: 'shadow', venues: ['coinbase'], positions: [position({ market_value: '5000', intent_id: 'oi-shadow' })] }),
    desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', venues: ['coinbase'], positions: [held, position({ instrument: { symbol: 'ETH-USD', asset_class: 'crypto', venue: 'coinbase' }, market_value: '900', intent_id: 'oi-eth' })] }),
  ], run: run() });
  const rows = positionRows(board);
  assert.deepEqual(rows.map(row => [row.desk, row.instrument]), [['hilibrand', 'ETH-USD'], ['hilibrand', 'BTC-USD'], ['hilibrand-2', 'BTC-USD']], 'live sleeves first, then by market value');
  assert.equal(rows[1].story, '/capital/desk/?id=hilibrand#story-oi-abc123');
  assert.equal(rows[1].thesis, 'Trend continuation on the daily bars; invalid under 75,500.');
  assert.equal(storyAnchor('intent:oi/abc'), 'story-intent-oi-abc');
  assert.equal(storyHref('mullins', 'oi-1'), '/capital/desk/?id=mullins#story-oi-1');
  const intent = { kind: 'desk.intent', at: '2026-09-15T13:31:00.000Z', payload: { intent_id: 'oi-abc123', rationale: 'Daily close above the 20-day; invalidation 75,500; out by Friday.' } };
  const decision = { kind: 'risk.decision', at: '2026-09-15T13:31:01.000Z', payload: { intent_id: 'oi-abc123', approved: true, reasons: ['inside the position cap'] } };
  assert.deepEqual(positionRationale([intent, decision], 'oi-abc123'), {
    rationale: 'Daily close above the 20-day; invalidation 75,500; out by Friday.', at: '2026-09-15T13:31:00.000Z', decision: 'approved',
    reasons: ['inside the position cap'], text: 'risk engine approved · inside the position cap',
  });
  assert.equal(positionRationale([intent], 'oi-nope'), null);

  const ids = ['floor-status', 'floor-numbers', 'floor-run', 'floor-positions', 'floor-watch', 'floor-partners', 'floor-lineage', 'floor-lab', 'tape-filters', 'floor-tape'];
  const root = stubPage('floor', ids);
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return board;
    if (path.includes('kind=desk.intent')) return { schema_version: 1, latest_seq: 9, events: [published(1, { id: 'intent:oi-abc123', stream: 'desk:hilibrand', kind: 'desk.intent', payload: intent.payload })] };
    if (path.includes('kind=risk.decision')) return { schema_version: 1, latest_seq: 9, events: [published(2, { id: 'risk:oi-abc123:1', stream: 'risk', kind: 'risk.decision', payload: decision.payload })] };
    return { schema_version: 1, latest_seq: 9, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const clock = root.querySelector('#floor-run');
    assert.equal(clock.getAttribute('aria-busy'), 'false');
    assert.match(clock.textContent, /^running \d+d \d+h since Sep 12, 2026 \$41\.97 of Sail credit spent profit \+\$63\.40 \+\$1\.51 per Sail dollar 412 sessions \$4\.21 \/ \$25 today (loading|reconnecting)$/);
    const strip = runStrip(run(), { spent_today_usd: '0.10', cap_usd: '269.82', mode: 'open', balance_usd: '279.82', runway_days: '385.4' }, Date.parse('2026-09-15T14:05:00.000Z'));
    assert.equal(strip.elapsed, 'running 3d 4h');
    assert.equal(strip.credit, '$280 credit · open');
    assert.equal(strip.mode, 'open');
    assert.equal(strip.perDollar, '+$1.51 per Sail dollar');
    assert.equal(runStrip(run({ pnl_per_sail_dollar: null }), null).perDollar, 'profit per Sail dollar: not yet');
    assert.equal(runStrip(null, null).elapsed, 'starting up');
    const positions = root.querySelector('#floor-positions');
    assert.match(positions.withClass('holdings-line')[0].textContent, /^\$979\.60 Kalshi \$492\.29 Coinbase \$487\.31/);
    const cards = positions.withClass('position');
    assert.equal(cards.length, 3);
    assert.match(cards[2].textContent, /shadow/);
    assert.match(cards[2].withClass('badge')[0].getAttribute('title') || '', /never sent|Competing for a live sleeve|^$/);
    const why = cards[1].find('button')[0];
    assert.equal(why.textContent, 'why');
    assert.equal(why.getAttribute('aria-expanded'), 'false');
    why.click();
    for (let i = 0; i < 20; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(why.getAttribute('aria-expanded'), 'true');
    const body = cards[1].withClass('position-why-body')[0];
    assert.match(body.textContent, /Daily close above the 20-day; invalidation 75,500; out by Friday\./);
    assert.match(body.textContent, /risk engine approved · inside the position cap/);
    assert.deepEqual(body.find('a').map(node => node.href), ['/capital/desk/?id=hilibrand#story-oi-abc123']);
    why.click();
    assert.equal(why.getAttribute('aria-expanded'), 'false');
  });
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
  assert.deepEqual(running.items.map(item => [item.kind, item.text]), [['thought', 'The Fed decides tomorrow.'], ['call', 'event_markets · query=fed'], ['thought', 'No edge at 89 cents.']]);
  assert.equal(idleLine(running, now), 'thinking now · cadence 13 30');
  const memo = { seq: 6, id: 'm1', stream: 'desk:mullins', kind: 'desk.memo', at: '2026-09-15T13:31:00.000Z', payload: { session_id: 'm:1', title: 'No trade: FOMC priced efficiently', text: '…' } };
  const ended = { seq: 7, id: 'e1', stream: 'desk:mullins', kind: 'desk.session_ended', at: '2026-09-15T13:46:00.000Z', payload: { session_id: 'm:1', reason: 'end_session', requests: 6, cost_usd: '0.03' } };
  const done = sessionThoughts([session, thought, call, later, memo, ended], 'mullins');
  assert.equal(done.running, false);
  assert.equal(done.memo, 'No trade: FOMC priced efficiently');
  assert.equal(idleLine(done, now), 'ended 14 min ago · No trade: FOMC priced efficiently');
  assert.equal(idleLine(sessionThoughts([session, thought, { ...ended, payload: { session_id: 'm:1', reason: 'budget_exceeded' } }], 'mullins'), now), 'ended 14 min ago · budget exceeded');
  assert.equal(idleLine(sessionThoughts([], 'mullins'), now), 'no session yet');
  assert.equal(idleLine(sessionThoughts([stale], 'mullins'), now), 'last thought 6 h ago');
  assert.equal(idleLine(done, now, { trigger: 'watch:price_move' }), 'thinking now · watch price move');

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

test('the desk page projects its holdings with reasons, its code runs and its lineage badges from published records', () => {
  const instrument = { symbol: 'BTC-USD', asset_class: 'crypto', venue: 'coinbase' };
  const position = { instrument, side: 'long', quantity: '0.01', entry_price: '76000', mark_price: '76500', market_value: '765', unrealized_pnl: '5', opened_at: '2026-09-15T13:00:00.000Z', thesis: 'Trend continuation after a three-day base.', target_price: '80000', stop_price: '75000', time_stop_at: '2026-09-18T13:00:00.000Z', exit_orders: [{ id: 'tp', kind: 'target', price: '80000' }], intent_id: 'oi-1', session_id: 'h:1' };
  const held = desk('hilibrand', { name: 'Hilibrand', family: 'crypto', mode: 'live', venues: ['coinbase'], positions: [position] });
  const events = [
    { seq: 1, id: 'i1', stream: 'desk:hilibrand', kind: 'desk.intent', at: '2026-09-15T13:00:00.000Z', payload: { intent_id: 'oi-1', desk_id: 'hilibrand', instrument, side: 'buy', quantity: '0.01', order_type: 'limit', limit_price: '76000', rationale: 'Trend continuation after a three-day base. Invalidation below 75000; out by Friday.' } },
    { seq: 2, id: 'r1', stream: 'risk', kind: 'risk.decision', at: '2026-09-15T13:00:01.000Z', payload: { intent_id: 'oi-1', desk_id: 'hilibrand', approved: true, reasons: [] } },
  ];
  const [row] = holdingRows(held, events);
  assert.equal(row.instrument, 'BTC-USD');
  assert.equal(row.rationale, 'Trend continuation after a three-day base. Invalidation below 75000; out by Friday.');
  assert.equal(row.engine, 'risk engine approved');
  assert.deepEqual(row.chips.map(chip => chip.kind), ['target', 'stop', 'time_stop', 'resting']);
  assert.deepEqual(holdingRows(desk('mullins', { positions: [] }), []), []);
  assert.deepEqual(holdingRows(null, []), []);

  const runs = codeRuns([
    { id: 'c1', kind: 'desk.code_run', at: '2026-09-15T13:10:00.000Z', payload: { session_id: 'h:1', code_sha256: 'ab'.repeat(32), language: 'python', stdout: 'vol 2.1%\n', exit_code: 0, seconds: '1.5', sandbox: 'sb_1', purpose: 'realized vol', saved_as: 'vol' } },
    { id: 'c2', kind: 'desk.code_run', at: '2026-09-15T13:12:00.000Z', payload: { session_id: 'h:1', code_sha256: 'cd'.repeat(32), language: 'python', stdout: 'Traceback', exit_code: 1, seconds: '0.4', sandbox: 'sb_1', purpose: 'bad idea' } },
    { id: 't1', kind: 'desk.thought', at: '2026-09-15T13:13:00.000Z', payload: { text: 'not a run' } },
  ]);
  assert.deepEqual(runs.map(run => [run.purpose, run.exit, run.hash, run.savedAs]), [['bad idea', 1, 'cdcdcdcdcdcd', ''], ['realized vol', 0, 'abababababab', 'vol']]);

  assert.deepEqual(lineageBadges(desk('mullins', { generation: 1, parent_id: null })).map(badge => badge.text), ['founder']);
  const child = lineageBadges(desk('mullins-2', { generation: 2, parent_id: 'mullins', mutation: mutation({ model_profile: 'kimi_flex', model_changed: true }) }));
  assert.equal(child[0].text, 'generation 2');
  assert.equal(child[1].text, 'from Mullins');
  assert.equal(child[1].href, '/capital/desk/?id=mullins');
  assert.ok(child.some(badge => badge.changed && /Kimi K2\.6/.test(badge.text)), 'a changed model is highlighted');
  assert.deepEqual(lineageBadges(null), []);
});

test('the loop page leads with the curve, then experiments, the house genome, capital with reasons, and the memo behind a chevron', async () => {
  const spawned = [
    { seq: 1, id: 'evolution.spawn.2', stream: 'evolution', kind: 'evolution.spawned', at: '2026-09-15T19:16:00.000Z', digest: 'a'.repeat(64), payload: { desk_id: 'mullins-2', family: 'kalshi', parent_id: 'mullins', generation: 2, mutation: mutation({ model_profile: 'pro_flex', reasoning_effort: 'low' }) } },
    { seq: 2, id: 'evolution.spawn.3', stream: 'evolution', kind: 'evolution.spawned', at: '2026-09-15T20:16:00.000Z', digest: 'b'.repeat(64), payload: { desk_id: 'mullins-3', family: 'kalshi', parent_id: 'mullins', generation: 3, mutation: mutation({ model_profile: 'oss_asap', reasoning_effort: 'low', model_changed: true }) } },
  ];
  const labEvents = [
    { seq: 3, id: 'lab:exp:1', stream: 'lab', kind: 'lab.experiment', at: '2026-09-15T02:00:00.000Z', digest: 'c'.repeat(64), payload: experiment() },
    { seq: 4, id: 'lab:verdict:1', stream: 'lab', kind: 'lab.verdict', at: '2026-09-15T03:00:00.000Z', digest: 'd'.repeat(64), payload: { experiment_id: 'exp-0123456789ab', status: 'adopted', evidence: {}, reason: 'Beat its parent for four days.', as_of: '2026-09-15T03:00:00.000Z' } },
  ];
  const genome = genomeSummary(spawned, labEvents);
  assert.equal(genome.length, 1);
  assert.equal(genome[0].family, 'kalshi');
  assert.equal(genome[0].children, 2);
  assert.deepEqual(genome[0].models, ['DeepSeek V4 Pro', 'gpt-oss-120b']);
  assert.deepEqual(genome[0].efforts, ['low']);
  assert.equal(genome[0].adopted.length, 1);
  assert.match(genome[0].adopted[0].change, /cadence sessions 08:10, 13:30, 16:30 · effort high/);
  assert.deepEqual(genomeSummary([], []), []);

  const allocation = { seq: 5, id: 'committee.allocation.9', stream: 'committee', kind: 'committee.allocation', at: '2026-09-14T21:10:00.000Z', digest: 'e'.repeat(64), payload: { allocations: { mullins: '492', hilibrand: '487' }, reasons: { mullins: 'bandit draw +1.2% on 14 decisions', hilibrand: 'bandit draw +0.4% on 9 decisions' } } };
  const reasons = allocationReasons([allocation]);
  assert.deepEqual(reasons.rows.map(row => [row.name, row.usd, row.reason]), [['Mullins', '492', 'bandit draw +1.2% on 14 decisions'], ['Hilibrand', '487', 'bandit draw +0.4% on 9 decisions']]);
  assert.deepEqual(allocationReasons([]).rows, []);

  const root = stubPage('committee', ['committee-status', 'loop-curve', 'committee-lab', 'loop-genome', 'committee-allocations', 'committee-gates', 'committee-evolution', 'committee-calibration', 'committee-memos']);
  const memo = { seq: 6, id: 'committee.memo.1', stream: 'committee', kind: 'committee.memo', at: '2026-09-14T21:00:00.000Z', digest: 'f'.repeat(64), payload: { period: '2026-09-14', text: 'Capital stays where the evidence is.' } };
  await withBrowser('', path => {
    if (path.startsWith('/api/capital/checkpoint')) return checkpoint({ committee: { last_memo_at: '2026-09-14T21:00:00.000Z', allocations: { mullins: '492', hilibrand: '487' } }, lab: lab() });
    if (path.includes('stream=committee')) return { schema_version: 1, latest_seq: 6, events: [allocation, memo] };
    if (path.includes('stream=evolution')) return { schema_version: 1, latest_seq: 6, events: spawned };
    if (path.includes('stream=lab')) return { schema_version: 1, latest_seq: 6, events: labEvents };
    return { schema_version: 1, latest_seq: 6, events: [] };
  }, async () => {
    const feed = await startCapital(root);
    feed.stop();
    const curve = root.querySelector('#loop-curve');
    assert.match(curve.textContent, /Generation 2 beats generation 1 on cost-adjusted return by 0\.90%; forecasts sharper\./);
    assert.equal(curve.find('svg').length, 3, 'three small multiples');
    assert.equal(curve.getAttribute('aria-busy'), 'false');
    const genomeBox = root.querySelector('#loop-genome');
    assert.match(genomeBox.textContent, /kalshi family.*2 children.*models DeepSeek V4 Pro, gpt-oss-120b.*cadence sessions 08:10, 13:30, 16:30/s);
    const allocations = root.querySelector('#committee-allocations');
    assert.match(allocations.textContent, /Mullins.*bandit draw \+1\.2% on 14 decisions.*\$492/s);
    assert.match(allocations.textContent, /memo .* ago/);
    assert.match(root.querySelector('#committee-lab').textContent, /Mullins trades better with a slot before the close\./);
    assert.match(root.querySelector('#committee-memos').textContent, /Capital stays where the evidence is\./);
    assert.equal(root.querySelector('#committee-memos').withClass('memo-latest').length, 1);
  });
});

test('the floor’s new helpers read as words: the strip, the now lines, the flat line, the race', () => {
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
  assert.equal(isInteresting({ kind: 'desk.thought' }), true);
  assert.equal(isInteresting({ kind: 'desk.tool_call' }), false);
  assert.equal(isInteresting({ kind: 'ledger.mark' }), false);
  assert.equal(isInteresting({ kind: 'desk.watch', payload: { decision: 'wake' } }), true);
  assert.equal(isInteresting({ kind: 'desk.watch', payload: { decision: 'ignore' } }), false, 'a pass is plumbing');
  for (const kind of INTERESTING_KINDS) assert.ok(Object.hasOwn(EVENT_KINDS, kind), kind);

  const record = deskRecord([
    { kind: 'desk.session_started', at: '2026-09-15T14:00:00.000Z', payload: { trigger: 'cadence:14:00' } },
    { kind: 'desk.thought', at: '2026-09-15T14:00:10.000Z', payload: { text: 'Let me look at the book.' } },
    { kind: 'desk.tool_call', at: '2026-09-15T14:00:12.000Z', payload: { tool: 'event_markets' } },
    { kind: 'desk.thought', at: '2026-09-15T14:00:40.000Z', payload: { text: 'No edge here.' } },
  ]);
  assert.equal(record.thought, 'No edge here.');
  assert.equal(record.tool, 'event markets');
  const ended = deskRecord([
    { kind: 'desk.memo', at: '2026-09-15T14:01:00.000Z', payload: { title: 'No trade', text: 'x' } },
    { kind: 'desk.session_ended', at: '2026-09-15T14:02:00.000Z', payload: { reason: 'end_session' } },
  ], record);
  assert.equal(ended.tool, '', 'a session that ended is not using a tool');
  assert.equal(idleRecordLine(ended, Date.parse('2026-09-15T14:16:00.000Z')), 'last session 14 min ago · No trade');
  assert.equal(idleRecordLine(null), 'no session yet');
  const rows = nowRows(checkpoint({ desks: [desk('mullins', { family: 'kalshi', live_session: liveSession({ trigger: 'watch:headline' }) }), desk('rosenfeld')] }), new Map([['rosenfeld', ended]]), Date.parse('2026-09-15T14:16:00.000Z'));
  assert.deepEqual(rows.map(row => [row.name, row.inSession, row.trigger || row.idle]), [['Mullins', true, 'woke on a headline'], ['Rosenfeld', false, 'last session 14 min ago · No trade']]);
  assert.equal(nightLine(checkpoint({ watch: watch({ triggers_today: 1, wakes_today: 1 }) })), 'night desk: 1 look, 1 wake today');
  assert.equal(nightLine(checkpoint()), '');

  assert.equal(flatLine(checkpoint({ run: run({ sessions_today: 1 }) })), 'Flat. 1 session today, no trade taken.');
  assert.equal(flatLine(checkpoint({ floor: accountFloor(), run: run({ sessions_today: 3 }) })), 'Flat. $980 in cash across 2 accounts. 3 sessions today, no trade taken.');

  const race = raceRows(checkpoint({ desks: [
    desk('mullins-3', { family: 'kalshi', generation: 3, parent_id: 'mullins', mode: 'shadow', return_pct: '2.5', mutation: mutation({ model_profile: 'oss_asap', model_changed: true }) }),
    desk('mullins', { family: 'kalshi', mode: 'live', return_pct: '1.0' }),
    desk('mullins-2', { family: 'kalshi', generation: 2, parent_id: 'mullins', mode: 'shadow', return_pct: '2.5' }),
    desk('hilibrand', { family: 'crypto', mode: 'live', return_pct: '0' }),
  ] }));
  assert.deepEqual(race.map(row => [row.label, row.live, row.members.map(member => member.name)]), [['Kalshi', 'Mullins', ['Mullins', 'Mullins II', 'Mullins III']], ['Crypto', 'Hilibrand', ['Hilibrand']]]);
  assert.deepEqual(race[0].members.map(member => member.leader), [false, false, false], 'a tie has no leader');
  assert.equal(race[0].members[2].badges[0].text, 'gpt-oss-120b');
  assert.equal(raceLine(lab(), race), '1 experiment running · generation II vs I: +0.90%');
  assert.equal(raceLine({ experiments: [experiment({ status: 'adopted' })], curve: [curveRow(1)] }, race), 'Children are scored on real prices. The first to beat its parent on the published gate takes the sleeve.');
  assert.equal(raceLine(null, raceRows(checkpoint())), 'The race starts with the first bred variant.');
});
