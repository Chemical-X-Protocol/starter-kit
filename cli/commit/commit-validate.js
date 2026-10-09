/**
 * Chemical X Protocol: every reason `chemx commit` refuses, in one rule tree (#2564).
 * All rules are evaluated (not fail-fast) so one run names every problem. The facts come from the
 * caller (git, the lease tables, the team db); this module only decides.
 */
import { ruleTree } from '../rules.js';

const formatLease = (refusal) => {
  const purpose = refusal.purpose ? ` (${refusal.purpose})` : '';
  return `${refusal.file}: leased by ${refusal.holder}${purpose}`;
};

// Rule key -> message. A rule fails when its test in buildRules returns true.
const MESSAGES = {
  'args.all': () => 'Refused: -a/--all commits everything. List the files to commit.',
  'args.skipVerify': () => 'Refused: --no-verify/-n would skip the pre-commit gate; chemx commit always runs it.',
  'args.unknownFlags': (ctx) => `Refused: unknown option(s) ${ctx.parsed.unknown.join(', ')}.`,
  'args.missingValue': (ctx) => `Refused: ${ctx.parsed.missingValue.join(', ')} needs a value.`,
  'args.noFiles': () => 'Refused: no files listed. Usage: chemx commit <files...> -m <message> [--task=<id>]',
  'args.noMessage': () => 'Refused: a message is required (-m <message>).',
  'args.bothTaskForms': () => 'Refused: give --task or --no-task, not both.',
  'task.missing': () => 'Refused: no task id. Put #<id> in the message, pass --task=<id>, or pass --no-task=<reason>.',
  'task.emptyReason': () => 'Refused: --no-task needs a non-empty reason.',
  'task.unknown': (ctx) => `Refused: task #${ctx.taskId} was not found in the team db.`,
  'files.unknown': (ctx) => `Refused: not tracked and not on disk: ${ctx.unknownFiles.join(', ')}.`,
  'files.outsideRepo': (ctx) => `Refused: outside this repository: ${ctx.outsideFiles.join(', ')}.`,
  'leases.foreign': (ctx) => `Refused: leased by another handle: ${ctx.leaseRefusals.map(formatLease).join('; ')}.`
};

const buildRules = (ctx) => {
  const { parsed } = ctx;
  const hasTask = Boolean(ctx.taskId);
  const hasNoTask = parsed.noTask !== null;
  const isTaskUnchecked = !ctx.isTaskChecked;
  return {
    args: {
      all: parsed.all,
      skipVerify: parsed.skipVerify,
      unknownFlags: parsed.unknown.length > 0,
      missingValue: parsed.missingValue.length > 0,
      noFiles: parsed.files.length === 0,
      noMessage: parsed.messages.length === 0 || parsed.messages[0].trim() === '',
      bothTaskForms: hasNoTask && parsed.taskId !== null
    },
    task: {
      missing: !hasTask && !hasNoTask,
      emptyReason: hasNoTask && parsed.noTask.trim() === '',
      unknown: hasTask && !isTaskUnchecked && !ctx.taskFound
    },
    files: {
      unknown: ctx.unknownFiles.length > 0,
      outsideRepo: ctx.outsideFiles.length > 0
    },
    leases: { foreign: ctx.leaseRefusals.length > 0 }
  };
};

/** @returns {string[]} one message per failed rule; empty when the commit may proceed. */
export const collectRefusals = (ctx) => {
  const result = ruleTree(buildRules(ctx));
  return result.violations.map((key) => MESSAGES[key](ctx));
};
