import { readFile, writeFile, rename, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validEvaluations } from '../portfolio/evaluations.js';

function required(value, message) { if (!value) throw new TypeError(message); }
function rows(value, label) { required(Array.isArray(value), `Missing ${label}`); return value; }
function cost(value) {
  required(value && typeof value.cost_complete === 'boolean' && value.cost_complete === (value.unknown_cost_runs === 0), 'Inconsistent cost state');
  return { estimated_known_usd: value.estimated_known_usd, unknown_cost_runs: value.unknown_cost_runs };
}

export function projectEvaluations(report, publishedAt = new Date().toISOString()) {
  required(report?.schema_version === 1, 'Unknown evaluation schema');
  const campaigns = rows(report.campaigns, 'campaigns').map(campaign => {
    required(campaign?.schema_version === 1, 'Unknown campaign schema');
    const conditions = rows(campaign.conditions, 'conditions');
    const comparisons = rows(campaign.comparisons, 'comparisons');
    required(conditions.every(row => ['baseline', 'critic'].includes(row.condition)), 'Unknown condition');
    const fixtures = new Set(rows(campaign.cases, 'cases').map(row => {
      required(typeof row.case === 'string' && /^[a-z0-9_-]{1,100}$/.test(row.case), 'Invalid case identity');
      return row.case;
    }));
    const baseline = conditions.filter(row => row.condition === 'baseline').map(row => {
      required(row.executor_model === row.model, 'Baseline executor mismatch');
      return { model: row.model, trials: row.metrics?.cases, finalized: row.finalized_cases, passed: row.metrics?.passed, ...cost(row.cost) };
    });
    const paired = comparisons.map(row => {
      const critic = conditions.filter(item => item.condition === 'critic' && item.model === row.model && item.executor_model === row.critic_model);
      required(critic.length === 1 && critic[0].metrics?.cases === row.scheduled_pairs && critic[0].finalized_cases >= row.finalized_pairs && row.before?.cases === row.finalized_pairs && row.after?.cases === row.finalized_pairs, 'Inconsistent paired comparison');
      const costs = cost(row.extra_cost);
      return { model: row.model, critic_model: row.critic_model, scheduled_pairs: row.scheduled_pairs, finalized_pairs: row.finalized_pairs, before_passed: row.before.passed, after_passed: row.after.passed, extra_estimated_known_usd: costs.estimated_known_usd, unknown_cost_runs: costs.unknown_cost_runs };
    });
    required(conditions.filter(row => row.condition === 'critic').length === paired.length, 'Unpaired critic condition');
    return { id: campaign.campaign, created_at: campaign.created_at, finished: campaign.finished, planned_calls: campaign.planned_calls, fixture_count: fixtures.size, cases_sha256: campaign.benchmark?.cases_sha256, prompts_sha256: campaign.benchmark?.prompts_sha256, baseline, paired };
  });
  const result = { schema_version: 1, published_at: publishedAt, campaigns };
  required(validEvaluations(result), 'Invalid public evaluation projection');
  return result;
}

async function main() {
  const [sourceArg, destinationArg] = process.argv.slice(2);
  if (!sourceArg || process.argv.length > 4) throw new TypeError('Usage: node scripts/publish-evaluations.mjs SOURCE_JSON [OUTPUT_JSON]');
  const source = path.resolve(sourceArg);
  const destination = path.resolve(destinationArg || fileURLToPath(new URL('../portfolio/evaluations.json', import.meta.url)));
  if (source === destination) throw new TypeError('Source and output must differ');
  const stat = await lstat(source);
  if (!stat.isFile() || stat.size > 5000000) throw new TypeError('Expected a bounded evaluation report file');
  try { if ((await lstat(destination)).isSymbolicLink()) throw new TypeError('Output must not be a symlink'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = projectEvaluations(JSON.parse(await readFile(source, 'utf8')));
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, destination);
  console.log(`Published ${result.campaigns.length} evaluation campaigns.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
