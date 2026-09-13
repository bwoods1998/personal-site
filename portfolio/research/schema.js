// Shared browser/server boundary: public final answers and matched source facts only.
export const KINDS = { company: 'Company research', cache_control: 'Cache comparison', fresh_review: 'Fresh review', window_pair: 'Completion-window comparison', allocation: 'Portfolio proposal', portfolio_critic: 'Portfolio review', memory_review: 'Memory review' };
export const PROFILES = { pro_flex: 'DeepSeek V4 Pro · Flex', pro_asap: 'DeepSeek V4 Pro · ASAP', kimi_flex: 'Kimi K2.6 · Flex', kimi_asap: 'Kimi K2.6 · ASAP', kimi_balanced: 'Kimi K2.6 · Balanced', glm_flex: 'GLM 5.3 · Flex', glm_balanced: 'GLM 5.3 · Balanced', k3: 'Kimi K3', flash: 'DeepSeek V4 Flash' };
export const recordId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (v, fields) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const privateText = /https?:\/\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:bearer|password|api[ _-]?key|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|account[ _-]?(?:number|id))\b|\b(?:sk|sail)_[A-Za-z0-9_-]{12,}|<[^>]*>/i;
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) && !privateText.test(v);
const symbol = v => typeof v === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(v);
const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export const instant = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const numeric = v => typeof v === 'string' && /^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,14})?$/.test(v);
export function filingUrl(value) {
  return typeof value === 'string' && /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d{1,10}\/\d{18}\/\d{10}-\d{2}-\d{6}-index\.html$/.test(value);
}
export function validEntry(e) {
  try {
    if (!exact(e, ['schema_version', 'id', 'started_at', 'completed_at', 'symbol', 'kind', 'profile', 'outcome', 'title', 'case', 'questions', 'claims', 'decision', 'metrics']) || e.schema_version !== 1 || !recordId(e.id)
      || !instant(e.started_at) || !instant(e.completed_at) || Date.parse(e.completed_at) < Date.parse(e.started_at)
      || (e.symbol !== null && !symbol(e.symbol)) || !Object.hasOwn(KINDS, e.kind) || !Object.hasOwn(PROFILES, e.profile)
      || !['passed', 'unverified', 'failed'].includes(e.outcome) || !text(e.title, 180) || (e.case !== null && !text(e.case, 1600))
      || !Array.isArray(e.questions) || e.questions.length > 3 || !Array.isArray(e.claims) || e.claims.length > 6) return false;
    if (!e.questions.every(q => exact(q, ['symbol', 'question']) && symbol(q.symbol) && text(q.question, 240))) return false;
    if (!e.claims.every(c => exact(c, ['symbol', 'metric', 'tag', 'start', 'end', 'value', 'unit', 'source']) && symbol(c.symbol) && text(c.metric, 80) && text(c.tag, 120) && (c.start === null || day(c.start)) && day(c.end) && (c.start === null || c.start <= c.end) && numeric(c.value) && text(c.unit, 40) && exact(c.source, ['title', 'url']) && text(c.source.title, 120) && filingUrl(c.source.url))) return false;
    const d = e.decision, m = e.metrics;
    if (!exact(d, ['action', 'targets', 'abstain_reason']) || !['research', 'proposal', 'approve', 'revise', 'abstain'].includes(d.action)
      || (d.abstain_reason !== null && !text(d.abstain_reason, 500)) || !Array.isArray(d.targets) || d.targets.length > 100
      || new Set(d.targets.map(t => t.symbol)).size !== d.targets.length || !d.targets.every(t => exact(t, ['symbol', 'weight']) && symbol(t.symbol) && numeric(t.weight) && Number(t.weight) > 0 && Number(t.weight) <= .2)
      || d.targets.reduce((n, t) => n + Number(t.weight), 0) > 1 + 1e-12 || (d.action !== 'proposal' && d.targets.length)) return false;
    if (!exact(m, ['source_checks_passed', 'claims_checked', 'cost_usd', 'latency_seconds']) || typeof m.source_checks_passed !== 'boolean' || !Number.isInteger(m.claims_checked) || m.claims_checked < 0 || m.claims_checked > 50
      || (m.cost_usd !== null && (!numeric(m.cost_usd) || Number(m.cost_usd) < 0)) || !Number.isFinite(m.latency_seconds) || m.latency_seconds < 0 || m.latency_seconds > 86400 * 366) return false;
    if (e.outcome === 'passed') return m.source_checks_passed && m.claims_checked >= 3 && e.claims.length >= 3 && e.case !== null;
    return !m.source_checks_passed && e.case === null && !e.questions.length && !e.claims.length && d.action === 'research' && !d.targets.length && d.abstain_reason === null;
  } catch { return false; }
}
export function summary(e) {
  return Object.fromEntries(['id', 'completed_at', 'symbol', 'kind', 'outcome', 'title'].map(k => [k, e[k]]));
}
export function validSummary(e) {
  return exact(e, ['id', 'completed_at', 'symbol', 'kind', 'outcome', 'title']) && recordId(e.id) && instant(e.completed_at) && (e.symbol === null || symbol(e.symbol)) && Object.hasOwn(KINDS, e.kind) && ['passed', 'unverified', 'failed'].includes(e.outcome) && text(e.title, 180);
}
