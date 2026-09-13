// Private Cloudflare alarm/outbox; no inference, arbitrary messages or public data.
// https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
import { createHash } from 'node:crypto';

export const STALE_MS = 10 * 60_000;
export const CONFIG_RETRY_MS = 5 * 60_000;
export const CONFIG_WAIT_MS = 24 * 60 * 60_000;
const PREFIX = 'portfolio-notify:v1:';
const META = PREFIX + 'meta';
const FROM = 'agent@blakewoods.us';
const SITE = 'https://blakewoods.us/portfolio/';
const REPO = 'https://github.com/bwoods1998/portfolio-agent';
// Exact production rejection observed on 2026-09-13, before sending-domain setup.
const DOMAIN_CONFIG_MISSING = 'could not find account config of sending domain';
const DOMAIN_RECLASSIFICATION = 'sending-domain-config-v1';
// These explicit rejections occur before delivery. All other errors are ambiguous.
const CONFIG_ERRORS = new Set(['E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_RECIPIENT_NOT_VERIFIED', 'E_RECIPIENT_NOT_ALLOWED']);
const ERROR_CODES = new Set([...CONFIG_ERRORS, 'E_VALIDATION_ERROR', 'E_FIELD_MISSING',
  'E_TOO_MANY_RECIPIENTS', 'E_TOO_MANY_ATTACHMENTS', 'E_RECIPIENT_SUPPRESSED',
  'E_CONTENT_TOO_LARGE', 'E_DELIVERY_FAILED', 'E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED',
  'E_INTERNAL_SERVER_ERROR', 'E_HEADER_NOT_ALLOWED', 'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID', 'E_HEADER_VALUE_TOO_LONG', 'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE', 'E_HEADERS_TOO_MANY']);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = at => new Date(at).toISOString();
const record = id => PREFIX + id;
const empty = () => ({ schema_version: 1, active: null, pending: [] });
const recipientValid = value => typeof value === 'string' && value.length <= 254
  && /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);

function sanitizedDiagnostic(value) {
  if (typeof value !== 'string') return null;
  return value.slice(0, 4096)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[url]')
    .replace(/[A-Z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Z0-9.-]+/gi, '[email]')
    .replace(/\b(?:Bearer|token|secret|password|key)\s*[:=]?\s+[A-Za-z0-9._~+\/-]+/gi, '[credential]')
    .replace(/\b[A-Za-z0-9_+\/-]{24,}={0,2}\b/g, '[token]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);
}

export function emailErrorDiagnostic(error) {
  const name = ['Error', 'TypeError', 'RangeError', 'DOMException', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'Other';
  const prefix = typeof error?.message === 'string'
    ? /^(?:Error:\s*)?(E_[A-Z_]+)(?=:|\s|$)/.exec(error.message)?.[1] : null;
  const code = ERROR_CODES.has(error?.code) ? error.code : ERROR_CODES.has(prefix) ? prefix : null;
  const oldArgument = name === 'TypeError' && typeof error?.message === 'string'
    && /^Failed to execute ['"]send['"] on ['"]SendEmail['"]: parameter 1 is not of type ['"]EmailMessage['"]\.?$/.test(error.message);
  const detail = sanitizedDiagnostic(error?.message);
  const missingDomain = name === 'Error' && error?.code == null && error?.message === DOMAIN_CONFIG_MISSING;
  const hint = /\b(?:email )?routing\b.*\b(?:not enabled|disabled|not configured)\b/i.test(detail || '') ? 'routing_configuration'
    : /\brecipient\b.*\b(?:not verified|unverified|not allowed)\b/i.test(detail || '') ? 'recipient_configuration'
    : /\b(?:sender|domain)\b.*\b(?:not verified|unverified|not onboarded|not available)\b/i.test(detail || '') ? 'sender_configuration' : null;
  return { outcome: CONFIG_ERRORS.has(code) || missingDomain ? 'configuration_rejected' : oldArgument ? 'email_message_type_rejected' : 'threw',
    error_name: name, error_code: code, code_origin: code ? code === error?.code ? 'field' : 'message_prefix' : null,
    configuration_hint: missingDomain ? 'sending_domain_configuration' : hint, sanitized_detail: detail,
    ...(missingDomain ? { rejection_basis: 'observed_exact_pre_send_message' } : {}) };
}

function configurationRejection(diagnostic) {
  if (CONFIG_ERRORS.has(diagnostic.error_code)) return diagnostic.error_code;
  return diagnostic.rejection_basis === 'observed_exact_pre_send_message' ? 'sending_domain_config_missing' : null;
}

function reclassifyKnownTest(event, now) {
  const d = event?.diagnostic; const attempt = event?.attempts?.[0];
  // Narrow additive correction of the one measured v2 failure. No generic replay.
  if (!/^test-v2:\d{4}-\d{2}-\d{2}$/.test(event?.id || '') || event.kind !== 'test_v2'
    || event.state !== 'unconfirmed' || event.message_id !== null || event.accepted_at !== null
    || event.summary !== null || !Array.isArray(event.attempts) || event.attempts.length !== 1 || event.reclassifications?.length
    || !(Date.parse(event.created_at) <= Date.parse(event.attempted_at) && Date.parse(event.attempted_at) <= now
      && now < Date.parse(event.expires_at))
    || !/^[a-f0-9]{64}$/.test(event.envelope_sha256 || '')
    || !d || Object.keys(d).length !== 6 || d.outcome !== 'threw' || d.error_name !== 'Error'
    || d.error_code !== null || d.code_origin !== null || d.configuration_hint !== null
    || d.sanitized_detail !== DOMAIN_CONFIG_MISSING || attempt.outcome !== 'unconfirmed'
    || attempt.at !== event.attempted_at || attempt.envelope_sha256 !== event.envelope_sha256 || !attempt.diagnostic
    || sha(attempt.diagnostic) !== sha(d)) return false;
  const receipt = { policy: DOMAIN_RECLASSIFICATION, at: iso(now), prior_event_sha256: sha(event),
    prior_diagnostic_sha256: sha(d), previous_state: 'unconfirmed', new_state: 'pending',
    reason: 'observed_exact_pre_send_domain_configuration_rejection' };
  event.reclassifications = [receipt];
  event.state = 'pending'; event.configuration_error = 'sending_domain_config_missing';
  event.retry_at = iso(now + CONFIG_RETRY_MS);
  return true;
}

function resultDiagnostic(result) {
  const shape = result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result;
  return { outcome: 'resolved_without_message_id', result_shape: ['undefined', 'null', 'object', 'array', 'string', 'number', 'boolean'].includes(shape) ? shape : 'other' };
}

function snapshot(state) {
  const activity = state.sail.activity;
  return { checkpoint_at: state.published_at, status: state.sail.status,
    heartbeat_at: activity?.heartbeat_at || state.published_at,
    known_cost_usd: state.sail.known_cost_usd, unsettled_requests: state.sail.unsettled_requests,
    completed_requests: activity?.completed_requests ?? null,
    total_requests: activity?.total_requests ?? null,
    companies_researched: activity?.companies_researched ?? null };
}

function message(event, recipient) {
  const labels = { complete: 'Research run complete', late_complete: 'Research run complete after delayed updates',
    needs_attention: 'Research run needs attention', stalled: 'Research updates stopped', test: 'Portfolio notifications connected',
    test_v2: 'Portfolio notification connection test 2' };
  const summary = event.summary;
  const lines = [labels[event.kind] + '.', event.kind === 'stalled'
    ? 'No fresh research heartbeat for at least 10 minutes. Completion is unconfirmed.'
    : ['test', 'test_v2'].includes(event.kind) ? 'This fixed test confirms the notification connection.'
    : 'The research controller published this status; source checks are not investment approval.'];
  if (summary) {
    if (summary.completed_requests !== null) lines.push(`Requests complete: ${summary.completed_requests}/${summary.total_requests}.`);
    if (summary.companies_researched !== null) lines.push(`Companies researched: ${summary.companies_researched}.`);
    lines.push(`Known inference cost: $${summary.known_cost_usd}. Unsettled requests: ${summary.unsettled_requests}.`);
    lines.push(`Last checkpoint: ${summary.checkpoint_at}.`);
  }
  lines.push('', SITE, REPO);
  return { from: FROM, to: recipient, subject: event.kind === 'test_v2' ? labels.test_v2 : 'Portfolio Agent — ' + labels[event.kind], text: lines.join('\n') };
}

export function createPortfolioNotifier(storage, env, now = () => Date.now()) {
  let tail = Promise.resolve();
  const serial = callback => {
    const operation = tail.then(callback); tail = operation.catch(() => {}); return operation;
  };
  const configured = () => typeof env.EMAIL?.send === 'function' && recipientValid(env.NOTIFICATION_EMAIL);

  async function enqueue(meta, id, kind, summary) {
    const key = record(id);
    const existing = await storage.get(key);
    if (!existing) await storage.put(key, {
      schema_version: 1, id, kind, state: 'pending', created_at: iso(now()),
      expires_at: iso(now() + CONFIG_WAIT_MS), summary, attempted_at: null,
      accepted_at: null, message_id: null, envelope_sha256: null,
      retry_at: null, configuration_error: null, attempts: [],
      diagnostic: null,
    });
    else if (reclassifyKnownTest(existing, now())) await storage.put(key, existing);
    if (!meta.pending.includes(id)) meta.pending.push(id);
  }

  async function reconcile(meta) {
    const saved = await storage.get('state');
    if (!saved) return;
    const state = JSON.parse(saved.body);
    // Persistent-service health, funding and digests belong to the independent
    // supervisor. Epoch completion is routine, not a new owner notification.
    if (state.service) { meta.active = null; return; }
    if (state.sail.started_at === null || state.sail.status === 'not_started') return;
    const runId = sha([state.sail.started_at, state.sail.ends_at]);
    const key = record('run:' + runId);
    const run = await storage.get(key) || { schema_version: 1, id: runId,
      started_at: state.sail.started_at, ends_at: state.sail.ends_at, summary: null, event_ids: [] };
    run.summary = snapshot(state);
    run.monitoring = state.sail.status === 'running' && state.research.status !== 'needs_attention';
    let kind;
    if (state.sail.status === 'complete') {
      kind = run.event_ids.includes(runId + ':stalled') ? 'late_complete' : 'complete';
    } else if (state.sail.status === 'needs_attention' || state.research.status === 'needs_attention') kind = 'needs_attention';
    else if (state.sail.status === 'running' && now() - Date.parse(run.summary.heartbeat_at) >= STALE_MS) kind = 'stalled';
    if (kind) {
      const id = runId + ':' + (kind === 'late_complete' ? 'complete' : kind);
      await enqueue(meta, id, kind, run.summary);
      if (!run.event_ids.includes(id)) run.event_ids.push(id);
    }
    meta.active = runId;
    await storage.put(key, run);
  }

  async function schedule(meta) {
    const times = [];
    if (meta.active) {
      const run = await storage.get(record('run:' + meta.active));
      if (run?.monitoring && !run.event_ids.includes(run.id + ':stalled')) {
        times.push(Date.parse(run.summary.heartbeat_at) + STALE_MS);
      }
    }
    for (const id of meta.pending) {
      const event = await storage.get(record(id));
      if (event?.state === 'pending') times.push(Math.min(Date.parse(event.expires_at),
        Math.max(event.retry_at ? Date.parse(event.retry_at) : 0, now() + (configured() ? 1000 : CONFIG_RETRY_MS))));
    }
    if (times.length) await storage.setAlarm(Math.max(now() + 1000, Math.min(...times)));
    else await storage.deleteAlarm();
  }

  async function process(meta) {
    const pending = [];
    for (const id of meta.pending) {
      const key = record(id); const event = await storage.get(key);
      if (!event) throw new Error('Notification journal missing');
      // A crash after persisted intent may have happened after delivery. Never resend.
      if (event.state === 'sending') {
        event.state = 'unconfirmed';
        event.diagnostic = { outcome: 'interrupted_after_intent' };
        if (event.attempts?.at(-1)?.outcome === 'sending') event.attempts.at(-1).outcome = 'unconfirmed';
        await storage.put(key, event);
      }
      if (event.state !== 'pending') continue;
      if (now() >= Date.parse(event.expires_at)) {
        event.state = 'expired'; await storage.put(key, event); continue;
      }
      if (!configured() || (event.retry_at && now() < Date.parse(event.retry_at))) { pending.push(id); continue; }
      const envelope = message(event, env.NOTIFICATION_EMAIL);
      event.state = 'sending'; event.attempted_at = iso(now()); event.envelope_sha256 = sha(envelope);
      event.retry_at = null; event.configuration_error = null;
      event.attempts ||= [];
      const attempt = { at: event.attempted_at, envelope_sha256: event.envelope_sha256, outcome: 'sending', configuration_error: null, diagnostic: null };
      event.attempts.push(attempt);
      await storage.put(key, event); // Write-ahead intent, before the external effect.
      try {
        const response = await env.EMAIL.send(envelope);
        if (typeof response?.messageId !== 'string' || !response.messageId || response.messageId.length > 512) {
          event.state = 'unconfirmed';
          event.diagnostic = resultDiagnostic(response);
        } else {
          event.state = 'accepted'; event.accepted_at = iso(now()); event.message_id = response.messageId;
          event.diagnostic = { outcome: 'resolved_with_message_id' };
        }
      } catch (error) {
        event.diagnostic = emailErrorDiagnostic(error);
        const rejection = configurationRejection(event.diagnostic);
        if (rejection) {
          event.state = 'pending'; event.configuration_error = rejection;
          event.retry_at = iso(now() + CONFIG_RETRY_MS);
          attempt.configuration_error = rejection;
          pending.push(id);
        } else event.state = 'unconfirmed';
      }
      attempt.outcome = event.state === 'pending' ? 'rejected_configuration' : event.state;
      attempt.diagnostic = event.diagnostic;
      // Store only bounded/redacted diagnostics; no raw response bodies or stack traces.
      await storage.put(key, event);
    }
    meta.pending = pending;
  }

  async function cycle({ send = false, test = false } = {}) {
    // A crash during journal updates or sending leaves an alarm to reconcile intent.
    await storage.setAlarm(now() + 60_000);
    const meta = await storage.get(META) || empty();
    await reconcile(meta);
    // Explicit second setup test revision. Old unknown test identity is never reset.
    if (test) await enqueue(meta, 'test-v2:' + iso(now()).slice(0, 10), 'test_v2', null);
    await storage.put(META, meta);
    if (send) await process(meta);
    await storage.put(META, meta);
    await schedule(meta);
  }

  async function status() {
    const meta = await storage.get(META) || empty();
    const run = meta.active ? await storage.get(record('run:' + meta.active)) : null;
    const ids = new Set([...(run?.event_ids || []), ...meta.pending,
      'test:' + iso(now()).slice(0, 10), 'test-v2:' + iso(now()).slice(0, 10)]);
    const events = [];
    for (const id of ids) {
      const event = await storage.get(record(id));
      if (event) events.push({ kind: event.kind, state: event.state, created_at: event.created_at,
        attempted_at: event.attempted_at, accepted_at: event.accepted_at,
        retry_at: event.retry_at || null, configuration_error: event.configuration_error || null,
        diagnostic: event.diagnostic || { outcome: 'not_recorded' },
        reclassification_count: event.reclassifications?.length || 0 });
    }
    return { schema_version: 1, configured: configured(), stale_after_seconds: STALE_MS / 1000,
      last_checkpoint_at: run?.summary.checkpoint_at || null, events,
      delivery_semantics: 'Provider acceptance is not confirmed inbox delivery. Unknown delivery outcomes are never automatically retried.' };
  }

  return {
    checkpoint: () => serial(() => cycle()),
    alarm: () => serial(() => cycle({ send: true })),
    test: () => serial(async () => { await cycle({ test: true }); return status(); }),
    status: () => serial(status),
  };
}
