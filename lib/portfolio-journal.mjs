import { createHash, timingSafeEqual } from 'node:crypto';
import { validEntry, recordId, summary } from '../portfolio/research/schema.js';

export const MAX_JOURNAL_BYTES = 262144;
export const PAGE_SIZE = 12;
const PREFIX = 'portfolio-journal:v1:';
const ENTRY = PREFIX + 'entry:';
const ID = PREFIX + 'id:';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
const sha = body => createHash('sha256').update(body).digest('hex');
const key = e => String(Date.parse(e.completed_at)).padStart(15, '0') + ':' + e.id;
const cursorValid = value => typeof value === 'string' && /^\d{15}:[a-f0-9]{64}$/.test(value);
const reply = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
function auth(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const actual = Buffer.from(request.headers.get('Authorization') || ''), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function response(request, value) {
  const body = JSON.stringify(value), etag = '"' + sha(body) + '"';
  const extra = { ETag: etag, 'Cache-Control': 'public, max-age=30, must-revalidate' };
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: extra });
  return new Response(request.method === 'HEAD' ? null : body, { headers: { ...headers, ...extra } });
}
// Recursively canonicalize nested records; reordered JSON keys are the same entry.
const normalized = value => Array.isArray(value) ? value.map(normalized) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, normalized(value[k])])) : value;

export function createPortfolioJournal(storage, secret, now = () => Date.now()) {
  let tail = Promise.resolve();
  return async request => {
    const url = new URL(request.url), base = '/api/portfolio/research';
    const id = url.pathname.startsWith(base + '/') ? url.pathname.slice(base.length + 1) : null;
    if (url.pathname !== base && !recordId(id)) return reply({ error: 'Not found.' }, 404);
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (id) {
        if (url.search) return reply({ error: 'Not found.' }, 404);
        const index = await storage.get(ID + id);
        if (!index) return reply({ error: 'Research entry unavailable.' }, 404);
        return response(request, (await storage.get(ENTRY + index.key)).entry);
      }
      const cursor = url.searchParams.get('cursor');
      if ([...url.searchParams.keys()].some(k => k !== 'cursor') || url.searchParams.getAll('cursor').length > 1 || (cursor !== null && !cursorValid(cursor))) return reply({ error: 'Invalid page.' }, 400);
      const records = [...(await storage.list({ prefix: ENTRY, ...(cursor ? { end: ENTRY + cursor } : {}), reverse: true, limit: PAGE_SIZE + 1 })).values()];
      const selected = records.slice(0, PAGE_SIZE);
      return response(request, { schema_version: 1, entries: selected.map(r => summary(r.entry)), next_cursor: records.length > PAGE_SIZE ? key(selected.at(-1).entry) : null });
    }
    if (request.method !== 'POST' || id) return reply({ error: 'Method not allowed.' }, 405);
    if (!auth(request, secret)) return reply({ error: 'Unauthorized.' }, 401);
    if (url.search) return reply({ error: 'Invalid destination.' }, 400);
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return reply({ error: 'JSON required.' }, 415);
    if (Number(request.headers.get('Content-Length') || 0) > MAX_JOURNAL_BYTES) return reply({ error: 'Payload too large.' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'Invalid journal.' }, 400);
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_JOURNAL_BYTES) { await reader.cancel(); return reply({ error: 'Payload too large.' }, 413); }
      chunks.push(value);
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply({ error: 'Invalid JSON.' }, 400); }
    if (!data || Object.keys(data).sort().join(',') !== 'entries,schema_version' || data.schema_version !== 1 || !Array.isArray(data.entries) || data.entries.length < 1 || data.entries.length > 20
      || new Set(data.entries.map(e => e?.id)).size !== data.entries.length || !data.entries.every(e => validEntry(e) && Date.parse(e.completed_at) <= now() + 60000 && Buffer.byteLength(JSON.stringify(e)) <= 20000)) return reply({ error: 'Invalid research record.' }, 400);
    const operation = tail.then(() => storage.transaction(async tx => {
      const writes = {}; let inserted = 0;
      for (const raw of data.entries) {
        const entry = normalized(raw), digest = sha(JSON.stringify(entry));
        const old = await tx.get(ID + entry.id);
        if (old && old.sha256 !== digest) return reply({ error: 'Published research is immutable.' }, 409);
        if (!old) {
          writes[ID + entry.id] = { key: key(entry), sha256: digest };
          writes[ENTRY + key(entry)] = { entry };
          inserted++;
        }
      }
      if (inserted) await tx.put(writes);
      return reply({ accepted: data.entries.length, inserted });
    }));
    tail = operation.catch(() => {});
    return operation;
  };
}
