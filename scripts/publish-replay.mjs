import { readFile, writeFile, rename, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validReplay } from '../portfolio/replay.js';
const fields = ['cash_proxy', 'cash_proxy_change', 'commitment_outlook', 'capex_driver', 'ai_return'];
function requireValue(test, message) { if (!test) throw new TypeError(message); }
function array(value, name) { requireValue(Array.isArray(value), `Missing ${name}`); return value; }
function cost(value) { requireValue(value && value.unknown_usage_runs >= 0, 'Missing measured cost'); return { known_estimated_usd: value.known_estimated_usd, unknown_usage_runs: value.unknown_usage_runs }; }
function view(value, expected = false) {
  if (value === null) return null;
  requireValue(value && typeof value === 'object', 'Missing typed state');
  const result = {};
  for (const field of fields) {
    result[field] = field === 'cash_proxy' ? { value: expected ? value.values?.cash_proxy : value.cash_proxy?.value, unit: expected ? value.unit : value.cash_proxy?.unit, period: expected ? value.period : value.cash_proxy?.period } : expected ? value.values?.[field] : value[field]?.value;
  }
  return result;
}

export function projectReplay(source, publishedAt = new Date().toISOString()) {
  requireValue(source?.schema_version === 1 && source.synthetic === true, 'Expected synthetic replay report');
  const report = {
    protocol_sha256: source.protocol_sha256, finished: source.finished, recovery: source.recovery?.state,
    gates: { admitted: source.gates?.admitted, blocked: source.gates?.blocked_or_duplicate, paid_for_blocked: source.gates?.paid_requests_for_blocked_events,
      executed_admitted: source.gates?.executed_per_path_counts?.admitted || 0,
      executed_blocked: ['duplicate', 'future', 'unapproved'].reduce((sum, kind) => sum + (source.gates?.executed_per_path_counts?.[kind] || 0), 0) },
    cost: cost(source.cost),
    conditions: array(source.conditions, 'conditions').map(c => ({ model: c.model, policy: c.policy, planned: c.planned_steps, finalized: c.finalized_steps, passed: c.passed_steps, input_bytes: c.admitted_request_payload_bytes, cost: cost(c.cost) })),
    scenarios: array(source.trajectories, 'trajectories').map(s => ({ id: s.id,
      events: array(s.events, 'events').map((e, index) => {
        requireValue(e.event_index === index, 'Event order mismatch');
        return { at: e.at, document_id: e.document_id, decision: e.decision, kind: e.kind, period: e.period, supersedes: e.supersedes };
      }),
      runs: array(source.conditions, 'conditions').map(c => ({ model: c.model, policy: c.policy,
        steps: array(source.steps, 'steps').filter(step => step.trajectory === s.id && step.model === c.model && step.policy === c.policy).map((step, index) => {
          requireValue(step.step === index && step.as_of === s.events[step.expected?.event_index]?.at, 'Step order mismatch');
          let checks = null;
          if (step.grade !== null) {
            requireValue(step.grade && step.grade.fields, 'Missing typed grade');
            checks = { format: step.grade.format_correct, passed: step.grade.passed };
            for (const field of fields) checks[field] = step.grade.fields[field]?.passed;
          }
          return { event_index: step.expected?.event_index, state: step.state, expected: view(step.expected, true), observed: view(step.observed), checks };
        }) })) })),
  };
  requireValue(array(source.steps, 'steps').length === report.scenarios.reduce((sum, scenario) => sum + scenario.runs.reduce((n, run) => n + run.steps.length, 0), 0), 'Unrecognized replay path');
  const result = { schema_version: 1, synthetic: true, published_at: publishedAt, report };
  requireValue(validReplay(result), 'Invalid replay publication projection');
  return result;
}

async function main() {
  const [sourceArg, destinationArg] = process.argv.slice(2);
  if (!sourceArg || process.argv.length > 4) throw new TypeError('Usage: node scripts/publish-replay.mjs SOURCE_JSON [OUTPUT_JSON]');
  const source = path.resolve(sourceArg); const destination = path.resolve(destinationArg || fileURLToPath(new URL('../portfolio/replay.json', import.meta.url)));
  if (source === destination) throw new TypeError('Source and output must differ');
  const stat = await lstat(source); if (!stat.isFile() || stat.size > 5000000) throw new TypeError('Expected a bounded replay report file');
  try { if ((await lstat(destination)).isSymbolicLink()) throw new TypeError('Output must not be a symlink'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = projectReplay(JSON.parse(await readFile(source, 'utf8')));
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, destination);
  console.log(`Published ${result.report.scenarios.length} synthetic replay scenarios.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
