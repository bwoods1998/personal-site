import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPortfolioNotifier, emailErrorDiagnostic, STALE_MS, CONFIG_RETRY_MS, CONFIG_WAIT_MS } from '../lib/portfolio-notify.mjs';
import { createPortfolioState } from '../lib/portfolio-state.mjs';

const initial = JSON.parse(await readFile(new URL('../portfolio/runtime.json', import.meta.url)));
const secret = 'test-only-notification-secret-at-least32';
const base = Date.parse('2026-09-14T01:00:00Z');
const timestamp = at => new Date(at).toISOString();

function fixture({ configured = true } = {}) {
  const map = new Map(); const sent = []; let clock = base; let alarm = null;
  const storage = {
    async get(key) { return structuredClone(map.get(key)); },
    async put(key, value) { map.set(key, structuredClone(value)); },
    async setAlarm(at) { alarm = at; },
    async deleteAlarm() { alarm = null; },
  };
  const env = configured ? { NOTIFICATION_EMAIL: 'private-test@example.com', EMAIL: { async send(message) {
    sent.push(message); return { messageId: 'test-message-' + sent.length };
  } } } : {};
  const now = () => clock;
  const notifier = createPortfolioNotifier(storage, env, now);
  const api = createPortfolioState(storage, secret, now, notifier);
  const state = (status = 'running', offset = 0) => ({ ...structuredClone(initial), published_at: timestamp(clock + offset),
    research: { ...initial.research, status, updated_at: timestamp(clock + offset), question: 'PRIVATE PROSE NEVER EMAILED', next: 'Do not copy this.' },
    sail: { status, started_at: timestamp(base), ends_at: timestamp(base + 5 * 60 * 60_000), known_cost_usd: '1.25', unsettled_requests: 0,
      activity: { heartbeat_at: timestamp(clock + offset), completed_requests: 12, total_requests: 15,
        companies_researched: 4, universe_size: 503, reserved_cost_usd: '2.50', tasks: [] } } });
  const request = (path = '/api/portfolio/state', method = 'GET', value, token = secret) => new Request('https://blakewoods.us' + path, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  return { map, storage, env, sent, notifier, api, now, state, request,
    advance(ms) { clock += ms; }, alarm: () => alarm,
    publish: value => api(request('/api/portfolio/state', 'POST', value)) };
}

test('terminal checkpoint creates one persisted intent and one fixed email on its alarm', async () => {
  const f = fixture(); const state = f.state('complete');
  assert.equal((await f.publish(state)).status, 200); assert.equal(f.sent.length, 0);
  assert.ok(f.alarm() > f.now());
  await f.notifier.alarm(); await f.notifier.alarm(); await f.publish(state); await f.notifier.alarm();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].from, 'agent@blakewoods.us'); assert.equal(f.sent[0].to, 'private-test@example.com');
  assert.match(f.sent[0].text, /12\/15/); assert.match(f.sent[0].text, /\$1\.25/);
  assert.match(f.sent[0].text, /github\.com\/bwoods1998\/portfolio-agent/);
  assert.doesNotMatch(f.sent[0].text, /PRIVATE PROSE|Do not copy this/);
  const status = await f.notifier.status(); assert.equal(status.events[0].state, 'accepted');
  assert.doesNotMatch(JSON.stringify(status), /private-test|test-message/);
  assert.equal(f.alarm(), null);
});

test('stale heartbeat triggers once and completion later is a distinct notice', async () => {
  const f = fixture(); await f.publish(f.state());
  assert.equal(f.alarm(), f.now() + STALE_MS);
  f.advance(STALE_MS - 1); await f.notifier.alarm(); assert.equal(f.sent.length, 0);
  f.advance(1); await f.notifier.alarm(); await f.notifier.alarm(); assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /Completion is unconfirmed/);
  f.advance(1000); await f.publish(f.state('complete')); await f.notifier.alarm();
  assert.equal(f.sent.length, 2); assert.match(f.sent[1].subject, /complete after delayed updates/);
  assert.deepEqual((await f.notifier.status()).events.map(e => e.kind), ['stalled', 'late_complete']);
});

test('deadline alone never implies completion and fresh heartbeats defer the alarm', async () => {
  const f = fixture(); await f.publish(f.state()); f.advance(STALE_MS / 2);
  await f.publish(f.state()); assert.equal(f.alarm(), f.now() + STALE_MS);
  f.advance(6 * 60 * 60_000); await f.notifier.alarm();
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].subject, /updates stopped/);
  assert.equal((await f.notifier.status()).events.some(e => e.kind === 'complete'), false);
});

test('attention transition does not create a recurring immediate alarm', async () => {
  const f = fixture(); const state = f.state(); state.research.status = 'needs_attention';
  await f.publish(state); await f.notifier.alarm();
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].subject, /needs attention/);
  assert.equal(f.alarm(), null);
});

test('missing configuration remains pending with bounded retry then can send once configured', async () => {
  const f = fixture({ configured: false }); await f.publish(f.state('complete')); await f.notifier.alarm();
  assert.equal(f.alarm(), f.now() + CONFIG_RETRY_MS); assert.equal((await f.notifier.status()).events[0].state, 'pending');
  f.env.NOTIFICATION_EMAIL = 'later@example.com'; f.env.EMAIL = { async send(message) { f.sent.push(message); return { messageId: 'accepted' }; } };
  f.advance(CONFIG_RETRY_MS); await f.notifier.alarm(); assert.equal(f.sent.length, 1);
  assert.equal((await f.notifier.status()).events[0].state, 'accepted');
});

test('configuration retry expires after24h without a send or alarm loop', async () => {
  const f = fixture({ configured: false }); await f.publish(f.state('complete'));
  f.advance(CONFIG_WAIT_MS); await f.notifier.alarm();
  assert.equal((await f.notifier.status()).events[0].state, 'expired'); assert.equal(f.alarm(), null);
  f.env.EMAIL = { async send(message) { f.sent.push(message); } }; f.env.NOTIFICATION_EMAIL = 'later@example.com';
  await f.notifier.alarm(); assert.equal(f.sent.length, 0);
});

test('definite verification rejection retries at5m, survives restart, and retains attempt history', async () => {
  for (const code of ['E_SENDER_NOT_VERIFIED', 'E_RECIPIENT_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_RECIPIENT_NOT_ALLOWED']) {
    const f = fixture(); let calls = 0;
    f.env.EMAIL.send = async message => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('private setup detail'), { code });
      f.sent.push(message); return { messageId: 'accepted-after-verification' };
    };
    await f.publish(f.state('complete')); await f.notifier.alarm();
    let status = await f.notifier.status();
    assert.equal(status.events[0].state, 'pending'); assert.equal(status.events[0].configuration_error, code);
    assert.equal(f.alarm(), f.now() + CONFIG_RETRY_MS);
    const restarted = createPortfolioNotifier(f.storage, f.env, f.now);
    await restarted.alarm(); await f.publish(f.state('complete')); assert.equal(calls, 1);
    f.advance(CONFIG_RETRY_MS); await restarted.alarm(); await restarted.alarm();
    assert.equal(calls, 2); assert.equal(f.sent.length, 1);
    status = await restarted.status(); assert.equal(status.events[0].state, 'accepted');
    const event = [...f.map.values()].find(value => value.kind === 'complete');
    assert.deepEqual(event.attempts.map(a => a.outcome), ['rejected_configuration', 'accepted']);
    assert.doesNotMatch(JSON.stringify([...f.map]), /"stack"/);
  }
});

test('verification retry remains bounded by original expiry and unknown codes are not retried', async () => {
  const f = fixture(); let calls = 0;
  f.env.EMAIL.send = async () => { calls++; throw Object.assign(new Error('private'), { code: 'E_SENDER_NOT_VERIFIED' }); };
  await f.publish(f.state('complete')); await f.notifier.alarm();
  f.advance(CONFIG_WAIT_MS); await f.notifier.alarm();
  assert.equal(calls, 1); assert.equal((await f.notifier.status()).events[0].state, 'expired'); assert.equal(f.alarm(), null);
  const g = fixture(); let unknownCalls = 0;
  g.env.EMAIL.send = async () => { unknownCalls++; throw Object.assign(new Error('private'), { code: 'E_INTERNAL_SERVER_ERROR' }); };
  await g.publish(g.state('complete')); await g.notifier.alarm(); g.advance(CONFIG_RETRY_MS); await g.notifier.alarm();
  assert.equal(unknownCalls, 1); assert.equal((await g.notifier.status()).events[0].state, 'unconfirmed');
});

test('removing a binding after a verification rejection keeps the five-minute retry pace', async () => {
  const f = fixture();
  f.env.EMAIL.send = async () => { throw Object.assign(new Error('private'), { code: 'E_SENDER_NOT_VERIFIED' }); };
  await f.publish(f.state('complete')); await f.notifier.alarm();
  delete f.env.EMAIL; f.advance(CONFIG_RETRY_MS); await f.notifier.alarm();
  assert.equal(f.alarm(), f.now() + CONFIG_RETRY_MS);
});

test('send exception or ambiguous return is unconfirmed and never blindly retried', async () => {
  for (const send of [async () => { throw new Error('private error recipient@example.com'); }, async () => undefined]) {
    const f = fixture(); let calls = 0; f.env.EMAIL.send = (...args) => { calls++; return send(...args); };
    await f.publish(f.state('complete')); await f.notifier.alarm();
    const restarted = createPortfolioNotifier(f.storage, f.env, f.now);
    await restarted.alarm(); await restarted.alarm(); assert.equal(calls, 1);
    const status = await restarted.status(); assert.equal(status.events[0].state, 'unconfirmed');
    assert.doesNotMatch(JSON.stringify([...f.map]), /recipient@example/);
  }
});

test('safe diagnostic distinguishes void resolution from a thrown binding error', async () => {
  for (const [send, outcome] of [[async () => undefined, 'resolved_without_message_id'],
    [async () => { throw new TypeError('secret-address@example.com hidden text'); }, 'threw']]) {
    const f = fixture(); f.env.EMAIL.send = send;
    await f.publish(f.state('complete')); await f.notifier.alarm();
    const status = await f.notifier.status();
    assert.equal(status.events[0].diagnostic.outcome, outcome);
    if (outcome === 'resolved_without_message_id') assert.equal(status.events[0].diagnostic.result_shape, 'undefined');
    assert.doesNotMatch(JSON.stringify([...f.map]), /secret-address@example/);
  }
});

test('exact leading provider code is classified without retaining addresses or matching embedded prose', async () => {
  const f = fixture(); let calls = 0;
  f.env.EMAIL.send = async () => { calls++; throw new Error('E_RECIPIENT_NOT_VERIFIED: private@example.com'); };
  await f.publish(f.state('complete')); await f.notifier.alarm();
  const event = (await f.notifier.status()).events[0];
  assert.equal(event.state, 'pending'); assert.equal(event.diagnostic.code_origin, 'message_prefix');
  assert.equal(event.configuration_error, 'E_RECIPIENT_NOT_VERIFIED');
  assert.doesNotMatch(JSON.stringify([...f.map]), /private@example/);
  assert.equal(emailErrorDiagnostic(new Error('Timeout while handling E_SENDER_NOT_VERIFIED')).error_code, null);
  assert.equal(emailErrorDiagnostic(new Error('E_PRIVATE_ADDRESS_CODE: sensitive')).error_code, null);
  assert.equal(emailErrorDiagnostic(new TypeError("Failed to execute 'send' on 'SendEmail': parameter 1 is not of type 'EmailMessage'.")).outcome, 'email_message_type_rejected');
  await f.notifier.alarm(); assert.equal(calls, 1);
});

test('crash after send before acceptance journal keeps intent and does not repeat delivery', async () => {
  const f = fixture(); const originalPut = f.storage.put.bind(f.storage);
  f.storage.put = async (key, value) => { if (value.state === 'accepted') throw new Error('simulated write failure'); return originalPut(key, value); };
  await f.publish(f.state('complete')); await assert.rejects(f.notifier.alarm());
  assert.equal(f.sent.length, 1);
  f.storage.put = originalPut;
  const restarted = createPortfolioNotifier(f.storage, f.env, f.now); await restarted.alarm();
  assert.equal(f.sent.length, 1); assert.equal((await restarted.status()).events[0].state, 'unconfirmed');
});

test('concurrent checkpoints and alarms do not create duplicate sends', async () => {
  const f = fixture(); const state = f.state('complete');
  await Promise.all([f.publish(state), f.publish(state)]);
  await Promise.all([f.notifier.alarm(), f.notifier.alarm(), f.notifier.alarm()]);
  assert.equal(f.sent.length, 1);
});

test('private status and fixed daily test require bearer auth and forbid recipient or body input', async () => {
  const f = fixture(); const path = '/api/portfolio/notifications';
  assert.equal((await f.api(f.request(path, 'GET', undefined, 'wrong'))).status, 401);
  assert.equal((await f.api(f.request(path + '/test', 'POST', { to: 'elsewhere@example.com' }))).status, 400);
  assert.equal((await f.api(f.request(path + '/test', 'GET'))).status, 405);
  assert.equal((await f.api(f.request(path + '?to=elsewhere', 'GET'))).status, 404);
  assert.equal((await f.api(f.request(path + '/test', 'POST'))).status, 202);
  await f.notifier.alarm(); await f.api(f.request(path + '/test', 'POST')); await f.notifier.alarm();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].subject, 'Portfolio notification connection test 2');
  const result = await (await f.api(f.request(path))).json(); assert.equal(result.events[0].state, 'accepted');
  assert.doesNotMatch(JSON.stringify(result), /private-test@example/);
});

test('diagnostic test v2 retains the old uncertain test and does not resend it', async () => {
  const f = fixture(); const day = timestamp(f.now()).slice(0, 10);
  const old = { schema_version: 1, id: 'test:' + day, kind: 'test', state: 'unconfirmed', created_at: timestamp(f.now()),
    attempted_at: timestamp(f.now()), accepted_at: null };
  f.map.set('portfolio-notify:v1:test:' + day, structuredClone(old));
  await f.notifier.test(); await f.notifier.alarm(); await f.notifier.test(); await f.notifier.alarm();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].subject, 'Portfolio notification connection test 2');
  assert.deepEqual(f.map.get('portfolio-notify:v1:test:' + day), old);
  assert.deepEqual((await f.notifier.status()).events.map(e => e.state), ['unconfirmed', 'accepted']);
});

async function measuredLegacyDomainFailure(f) {
  await f.notifier.test();
  const key = 'portfolio-notify:v1:test-v2:' + timestamp(f.now()).slice(0, 10);
  const event = f.map.get(key);
  const diagnostic = { outcome: 'threw', error_name: 'Error', error_code: null, code_origin: null,
    configuration_hint: null, sanitized_detail: 'could not find account config of sending domain' };
  Object.assign(event, { state: 'unconfirmed', attempted_at: timestamp(f.now()), envelope_sha256: 'a'.repeat(64), diagnostic,
    attempts: [{ at: timestamp(f.now()), envelope_sha256: 'a'.repeat(64), outcome: 'unconfirmed', configuration_error: null, diagnostic: structuredClone(diagnostic) }] });
  f.map.set(key, event);
  return { key, original: structuredClone(event) };
}

test('exact measured v2 domain rejection receives an additive receipt then retries once after setup', async () => {
  const f = fixture(); const { key, original } = await measuredLegacyDomainFailure(f);
  await f.notifier.test(); await f.notifier.test();
  const corrected = f.map.get(key);
  assert.equal(corrected.state, 'pending'); assert.equal(corrected.configuration_error, 'sending_domain_config_missing');
  assert.equal(corrected.reclassifications.length, 1);
  assert.equal(corrected.reclassifications[0].policy, 'sending-domain-config-v1');
  assert.match(corrected.reclassifications[0].prior_event_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(corrected.attempts, original.attempts); assert.deepEqual(corrected.diagnostic, original.diagnostic);
  assert.equal(f.alarm(), f.now() + CONFIG_RETRY_MS);
  const restarted = createPortfolioNotifier(f.storage, f.env, f.now);
  await restarted.alarm(); assert.equal(f.sent.length, 0);
  f.advance(CONFIG_RETRY_MS); await restarted.alarm(); await restarted.alarm();
  assert.equal(f.sent.length, 1); assert.equal(f.map.get(key).state, 'accepted');
  assert.deepEqual(f.map.get(key).attempts[0], original.attempts[0]);
  assert.equal(f.map.get(key).attempts.length, 2); assert.equal(f.map.get(key).reclassifications.length, 1);
});

test('historical unknown outcomes and near matches are never reclassified or replayed', async () => {
  const mutations = [
    e => { e.kind = 'test'; },
    e => { e.diagnostic.sanitized_detail += ' after a timeout'; },
    e => { e.diagnostic.outcome = 'resolved_without_message_id'; },
    e => { e.diagnostic.error_name = 'TypeError'; },
    e => { e.diagnostic.error_code = 'E_INTERNAL_SERVER_ERROR'; },
    e => { e.diagnostic = null; },
    e => { e.attempts[0].diagnostic = null; },
    e => { e.attempts.push(structuredClone(e.attempts[0])); },
    e => { e.expires_at = timestamp(base - 1); },
    e => { e.message_id = 'possible-accepted-id'; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); const { key } = await measuredLegacyDomainFailure(f);
    const event = f.map.get(key); mutate(event); f.map.set(key, event); const prior = structuredClone(event);
    await f.notifier.test(); await f.notifier.alarm();
    assert.equal(f.sent.length, 0); assert.deepEqual(f.map.get(key), prior);
  }
});

test('future exact sending-domain rejections are pending while merely similar prose stays unknown', async () => {
  for (const [message, expected] of [['could not find account config of sending domain', 'pending'],
    ['could not find account config of sending domain after unknown network failure', 'unconfirmed']]) {
    const f = fixture(); f.env.EMAIL.send = async () => { throw new Error(message); };
    await f.notifier.test(); await f.notifier.alarm();
    const event = (await f.notifier.status()).events[0];
    assert.equal(event.state, expected);
    if (expected === 'pending') {
      assert.equal(event.diagnostic.rejection_basis, 'observed_exact_pre_send_message');
      assert.equal(event.configuration_error, 'sending_domain_config_missing');
    }
  }
});

test('private diagnostic is bounded and strips addresses, URLs and long tokens', () => {
  const diagnostic = emailErrorDiagnostic(new Error('Email Routing is not enabled for user@example.com https://private.example/token ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789 ' + 'x'.repeat(500)));
  assert.equal(diagnostic.configuration_hint, 'routing_configuration');
  assert.ok(diagnostic.sanitized_detail.length <= 300);
  assert.doesNotMatch(JSON.stringify(diagnostic), /user@example|private.example|ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
  assert.match(diagnostic.sanitized_detail, /\[email\]/);
});

test('test endpoint accepts the actual empty POST stream shape but rejects even one byte', async () => {
  const f = fixture(); const url = 'https://blakewoods.us/api/portfolio/notifications/test';
  const empty = new Request(url, { method: 'POST', body: '', headers: { Authorization: `Bearer ${secret}`, 'Content-Length': '0' } });
  assert.notEqual(empty.body, null);
  assert.equal((await f.api(empty)).status, 202);
  const byte = new Request(url, { method: 'POST', body: ' ', headers: { Authorization: `Bearer ${secret}` } });
  assert.equal((await f.api(byte)).status, 400);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(0)); controller.close(); } });
  const streamed = new Request(url, { method: 'POST', body: stream, duplex: 'half', headers: { Authorization: `Bearer ${secret}` } });
  assert.equal((await f.api(streamed)).status, 202);
  await f.notifier.alarm(); assert.equal(f.sent.length, 1);
});

test('notification storage failure never rejects a valid public checkpoint', async () => {
  const f = fixture(); f.storage.setAlarm = async () => { throw new Error('notification alarm unavailable'); };
  const state = f.state('complete'); assert.equal((await f.publish(state)).status, 200);
  assert.deepEqual(await (await f.api(f.request())).json(), state);
});

test('a distinct frozen run window receives its own completion notification', async () => {
  const f = fixture(); await f.publish(f.state('complete')); await f.notifier.alarm();
  f.advance(6 * 60 * 60_000); const next = f.state('complete');
  next.sail.started_at = timestamp(f.now() - 5 * 60 * 60_000); next.sail.ends_at = timestamp(f.now());
  await f.publish(next); await f.notifier.alarm(); assert.equal(f.sent.length, 2);
});

test('persistent service leaves per-epoch and stale notices to its independent supervisor', async () => {
  const f = fixture(); await f.publish(f.state());
  f.advance(1000);
  const state = f.state('complete');
  state.service = { id: 'test-week', status: 'waiting', next_wake_at: timestamp(f.now() + 3600000), heartbeat_at: state.published_at, week_ends_at: '2026-09-18T22:00:00Z', reason_code: 'scheduled_wait' };
  assert.equal((await f.publish(state)).status, 200);
  f.advance(STALE_MS * 3); await f.notifier.alarm();
  assert.equal(f.sent.length, 0); assert.equal(f.alarm(), null);
});
