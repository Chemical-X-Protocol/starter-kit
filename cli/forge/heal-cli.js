// `chemx heal <bp-id|group-id> | --item=<A7> [--dry-run] [--fill=<hole>=<value> ...] [--json] --as=@handle`
// and `chemx heal --undo=<run> --as=@handle` (engine doc, Heal: ENTRY POINTS). Heal applies one blueprint
// under leases, verifies it and rolls back on any failure; it never commits.
import { openIndexDb } from '../search-schema.js';
import { resolveIndexRoot } from '../search-root.js';
import { resolveBlueprint, fillContextOf } from './blueprint-cli.js';
import { readFills, validateFill, saveFill } from './blueprint-store.js';
import { runHeal } from './heal-apply.js';
import { undoHeal } from './heal-undo.js';

const USAGE = [
  'usage: chemx heal <bp-id|group-id> | --item=<A7> [--dry-run] [--fill=<hole>=<value>] [--json] --as=@handle',
  '       chemx heal --undo=<run-id> --as=@handle'
];

const flagValue = (args, name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

const write = (lines) => process.stdout.write(`${lines.join('\n')}\n`);

const VALUE_FLAGS = new Set(['--undo', '--as']);
const DEFAULT_SPEC_DEPTH = 2;

/** { target, item, dryRun, json, agent, fills: [[hole, value]], undo, specDepth } from argv. */
export const parseHealArgs = (args) => {
  const undoIndex = args.indexOf('--undo');
  const undo = flagValue(args, 'undo') ?? (undoIndex === -1 ? null : args[undoIndex + 1] ?? '');
  const positional = args.filter((arg, index) => !arg.startsWith('-') && !VALUE_FLAGS.has(args[index - 1]));
  const fills = args.filter((arg) => arg.startsWith('--fill=')).map((arg) => arg.slice('--fill='.length)).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]);
  const depth = Number(flagValue(args, 'spec-depth') ?? DEFAULT_SPEC_DEPTH);
  return {
    target: positional[0] ?? null, item: flagValue(args, 'item'), dryRun: args.includes('--dry-run'), json: args.includes('--json'),
    agent: flagValue(args, 'as') ?? process.env.CHEMX_AGENT_ID ?? '', fills, undo, specDepth: Number.isInteger(depth) && depth >= 0 ? depth : DEFAULT_SPEC_DEPTH
  };
};

const recordFills = (db, cwd, blueprint, options) => {
  const context = fillContextOf(db, cwd, blueprint);
  const refused = [];
  for (const [holeId, value] of options.fills) {
    const verdict = validateFill(blueprint, holeId, value, context);
    const isValid = verdict.ok;
    if (isValid) saveFill(db, blueprint.id, holeId, value, `human:${options.agent}`);
    else refused.push(`${holeId}: ${verdict.reason}`);
  }
  return refused;
};

const siteLines = (plan) => plan.sites.map((site) => `    ${site.file}:${site.line}${site.moved ? ' (moved)' : ''}  ${site.call}${site.comments.length > 0 ? `  [${site.comments.length} comment(s) hoisted]` : ''}`);

const droppedLines = (plan) => plan.files.filter((file) => file.dropped.length > 0).map((file) => `    ${file.file}: dropped unused import ${file.dropped.join(', ')}`);

const headLines = (blueprint, plan) => [
  `heal ${blueprint.id} ${plan.name} -> ${plan.module}${blueprint.piece.moduleIsNew ? ' (new)' : ''} | ${plan.sites.length} sites in ${new Set(plan.sites.map((site) => site.file)).size} files`,
  '  sites:', ...siteLines(plan), ...droppedLines(plan)
];

const stageLines = (verify) => verify.stages.map((stage) => `    ${stage.ok ? 'ok  ' : 'FAIL'} ${stage.stage}: ${stage.detail}`);

const PRINTERS = {
  refused: (blueprint, result) => [`heal ${blueprint.id}: refused ${result.code}: ${result.message}`, `  run ${result.runId}`],
  dry_run: (blueprint, result) => [
    ...headLines(blueprint, result.plan), 'dry run: nothing was written or leased', result.diff.trimEnd(),
    `  audit (in memory): ${result.audit.detail}`,
    `  post-condition (in memory): member fp occurs ${result.post.count} time(s) after the heal (limit ${result.post.limit})`,
    `  leases: ${result.foreignLeases.length === 0 ? 'no foreign lease on any path' : result.foreignLeases.map((entry) => `${entry.file} leased by ${entry.lease.lockedBy}`).join('; ')}`,
    `  run ${result.runId}; next: chemx heal ${blueprint.id} --as=@you`
  ],
  applied: (blueprint, result) => [
    ...headLines(blueprint, result.plan), `applied (run ${result.runId}); verify:`, ...stageLines(result.verify),
    `  next: chemx commit ${result.plan.files.map((file) => file.file).join(' ')} -m "refactor(patterns): ${result.plan.name} from ${result.plan.sites.length} sites [${blueprint.id}]" --release`,
    `  undo before committing: chemx heal --undo=${result.runId} --as=@you`
  ],
  rolled_back: (blueprint, result) => [
    ...headLines(blueprint, result.plan), `rolled back at stage ${result.stage} (run ${result.runId}); every file is byte-identical to before. verify:`, ...stageLines(result.verify),
    ...(result.output ? ['  output:', ...result.output.split('\n').map((line) => `    ${line}`)] : [])
  ],
  rollback_failed: (blueprint, result) => [`heal ${blueprint.id}: ROLLBACK FAILED at stage ${result.stage} (run ${result.runId}); check the files with chemx d`, result.output]
};

const printResult = (blueprint, result, options) => {
  const isJson = options.json;
  if (isJson) {
    const { plan, ...rest } = result;
    write([JSON.stringify({ blueprint: blueprint.id, ...rest, sites: plan?.sites ?? [], files: plan?.files.map((file) => file.file) ?? [] })]);
    return;
  }
  write(PRINTERS[result.outcome](blueprint, result));
};

const runUndo = (db, cwd, options) => {
  const result = undoHeal(options.undo, { root: resolveIndexRoot(cwd), db, agentId: options.agent });
  const isUndone = result.outcome === 'undone';
  write([isUndone ? `undone ${result.runId}: restored ${result.files.join(', ')} byte-identical` : `heal --undo: ${result.outcome} ${result.code ?? ''}: ${result.message ?? 'files differ after the restore'}`]);
  return { ok: isUndone, code: isUndone ? 0 : 1, ...result };
};

const OK_OUTCOMES = new Set(['dry_run', 'applied']);

/** Runs the command; prints and returns { ok, code, outcome, ... }. */
export const runHealCli = async (args, cwd = process.cwd(), runOptions = {}) => {
  const options = parseHealArgs(args);
  const db = openIndexDb(cwd);
  const hasDb = Boolean(db);
  if (!hasDb) {
    write(['heal: no index db here (run chemx q once to create it)']);
    return { ok: false, code: 1, error: 'no index db' };
  }
  const isUndo = options.undo !== null;
  if (isUndo) return runUndo(db, cwd, options);
  const hasTarget = Boolean(options.target) || Boolean(options.item);
  if (!hasTarget) {
    write(USAGE);
    return { ok: false, code: 1, error: 'no target' };
  }
  const resolved = resolveBlueprint(db, cwd, options);
  const isUnresolved = Boolean(resolved.error);
  if (isUnresolved) {
    write([`heal: ${resolved.error}`]);
    return { ok: false, code: 1, error: resolved.error };
  }
  const { blueprint } = resolved;
  const refusedFills = recordFills(db, cwd, blueprint, options);
  const hasRefusedFills = refusedFills.length > 0;
  if (hasRefusedFills) {
    write([`heal ${blueprint.id}: fill refused, nothing was healed`, ...refusedFills.map((line) => `  ${line}`)]);
    return { ok: false, code: 1, error: 'fill refused' };
  }
  const result = await runHeal(blueprint, { root: resolveIndexRoot(cwd), db, agentId: options.agent, fills: readFills(db, blueprint.id), dryRun: options.dryRun, specDepth: options.specDepth, ...runOptions });
  printResult(blueprint, result, options);
  const isOk = OK_OUTCOMES.has(result.outcome);
  return { ok: isOk, code: isOk ? 0 : 1, ...result };
};
