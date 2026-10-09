/**
 * Chemical X Protocol: `task done` / `task update` options and confirmations.
 * A plain status update echoes the status actually written; gate verification is only
 * described for a completion (a reopened task still carries its old completion payload).
 */

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const buildTokensOption = (flags) => {
  const hasTokens = Boolean(flags.tokens || flags.promptTokens || flags.completionTokens || flags.cost);
  if (!hasTokens) return undefined;
  return {
    prompt: flags.promptTokens || flags.tokens || 0,
    completion: flags.completionTokens || 0,
    cached: flags.cachedTokens || 0,
    cost_usd: flags.cost,
    model: flags.model
  };
};

export const buildCompletionOptions = (flags, cwd) => ({
  cwd,
  target: flags.target,
  force: flags.force,
  noTargetConfirm: flags.noTargetConfirm,
  tokens: buildTokensOption(flags),
  logPath: flags.log
});

const fail = (text) => ({ isError: true, text: `${RED}✕ ${text}${RESET}` });
const warn = (text) => ({ isError: false, text: `${YELLOW}⚠${RESET} ${text}` });
const pass = (text) => ({ isError: false, text: `${GREEN}✔${RESET} ${text}` });

export const describeCompletion = (res, taskId, lead) => {
  const hasResult = Boolean(res);
  if (!hasResult) return fail(`Task #${taskId} not found`);
  if (res.refused) {
    const hasOwnMessage = Boolean(res.noTarget || res.ownership);
    const hazardText = `Cannot complete task #${taskId}: ${res.hazardCount} hazard(s) remain in ${res.targetPath}. Fix the hazards or pass --force to complete anyway.`;
    return fail(hasOwnMessage ? res.message : hazardText);
  }
  const payload = res.result_payload || {};
  const remaining = payload.hazardCountAfter || 0;
  const target = res.target_path || 'target';
  const isUnverified = payload.verificationApplicable === false;
  if (isUnverified) return warn(`${lead} (Unverified: no target_path specified; completed with --no-target-confirm)`);
  if (payload.forced) return warn(`${lead} with --force ${YELLOW}(Note: ${remaining} hazard(s) still remain in ${target})${RESET}`);
  const isVerifiedClean = Boolean(payload.verified) && remaining === 0;
  if (isVerifiedClean) return pass(`${lead} (Verified clean: 0 hazards in ${target})`);
  if (payload.verified) return pass(`${lead} (Verified passing: ${remaining} non-blocking warning(s) remain in ${target})`);
  const hasRemaining = remaining > 0;
  if (hasRemaining) return pass(`${lead} ${YELLOW}(Note: ${remaining} hazard(s) still remain in ${target})${RESET}`);
  return pass(lead);
};

export const describeStatusUpdate = (res, taskId) => {
  const hasResult = Boolean(res);
  if (!hasResult) return fail(`Task #${taskId} not found`);
  return pass(`Updated task #${taskId} status to "${res.status}"`);
};

// Returns whether anything was written (only CLI calls print). A refusal or a missing
// task sets a non-zero exit code so scripts can tell it from a completion.
export const writeTaskResult = (res, flags, isCli, describe) => {
  if (!isCli) return false;
  const isFailure = !res || res.refused === true;
  if (isFailure) process.exitCode = 1;
  const outcome = flags.isJson ? { isError: false, text: JSON.stringify(res, null, 2) } : describe();
  const stream = outcome.isError ? process.stderr : process.stdout;
  stream.write(`${outcome.text}\n`);
  return true;
};
