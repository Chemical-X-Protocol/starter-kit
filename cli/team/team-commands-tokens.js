/**
 * Chemical X Protocol: `chemx team tokens --run=<wf_id|dir> [--json] [--import] [--alt=<family>] [--top=<n>]`.
 * Measures a Claude Code workflow run from its transcripts (see usage-reader.js). Without --run the
 * older swarm token breakdown runs instead. --projects=<dir> overrides ~/.claude/projects for lookup.
 */
import { readRun } from './usage-reader.js';
import { priceRun } from './usage-compute.js';
import { loadPricing } from './usage-pricing.js';
import { importPricedRun } from './usage-store.js';
import { renderRunCard } from './usage-render.js';

const TOKENS_USAGE = 'Usage: chemx team tokens --run=<wf_id|run dir> [--json] [--import] [--alt=opus|sonnet|haiku|fable] [--top=<n>]';

export const optionOf = (args, name) => {
  const prefix = `--${name}=`;
  const equals = args.find((a) => a.startsWith(prefix));
  if (equals) return equals.slice(prefix.length);
  const at = args.indexOf(`--${name}`);
  const next = args[at + 1];
  const hasValue = at !== -1 && Boolean(next) && !next.startsWith('-');
  return hasValue ? next : undefined;
};

/** Parse the run options out of the args after `tokens`; returns null when --run is absent. */
export const parseRunArgs = (args = []) => {
  const run = optionOf(args, 'run');
  if (!run) return null;
  const top = Number(optionOf(args, 'top'));
  const hasTop = Number.isFinite(top) && top > 0;
  return {
    run,
    alt: optionOf(args, 'alt') || 'opus',
    top: hasTop ? top : undefined,
    projects: optionOf(args, 'projects'),
    doImport: args.includes('--import')
  };
};

const fail = (message, isCli) => {
  if (isCli) process.stderr.write(`x ${message}\n${TOKENS_USAGE}\n`);
  return { error: message };
};

export const handleRunTokens = (db, opts, isJson, isCli, cwd = process.cwd()) => {
  const run = readRun(opts.run, opts.projects);
  if (!run) return fail(`Run not found: ${opts.run} (looked for a directory, then ~/.claude/projects/*/*/subagents/workflows/<id>)`, isCli);
  const priced = priceRun(run, loadPricing(cwd), opts.alt);
  const stored = opts.doImport ? importPricedRun(db, priced) : null;
  const result = { ...priced, imported: stored };
  if (isJson) {
    if (isCli) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  const importLine = stored ? `\nImported ${stored.imported} rows into task_usage (${stored.mapped} mapped to a task; unmapped rows keep task_id NULL).` : '\nNot stored. Add --import to write these rows to task_usage.';
  if (isCli) process.stdout.write(`${renderRunCard(priced, { top: opts.top })}${importLine}\n`);
  return result;
};
