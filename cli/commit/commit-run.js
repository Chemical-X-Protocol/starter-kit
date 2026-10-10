/**
 * Chemical X Protocol: `chemx commit <files...> -m <msg>` (#2564).
 * Guarantees: only the listed files are committed (path-limited); the repository's pre-commit hook
 * runs (never --no-verify); another handle's live lease, a missing task id, -a/--all and unrelated
 * paths each refuse before anything is staged. Paths other handles staged are left alone (the commit
 * is path-limited, `git commit --only` semantics) and listed in a warning. When the commit fails, the
 * index entries of the listed files are put back as they were, so a retry starts clean. Not
 * guaranteed: that restore can itself fail (the failure text says so); leases are checked, not
 * enforced by git, so a lease taken after the check is not seen; recording on the task is best effort.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseCommitArgs } from './commit-args.js';
import { buildCommitMessage } from './commit-message.js';
import { collectRefusals } from './commit-validate.js';
import { gatherFacts } from './commit-facts.js';
import { recordCommit, releaseLeases } from './commit-record.js';
import { snapshotIndex, restoreIndex } from './commit-index.js';
import {
  gitRoot, stagedAmong, shortSha, hasPreCommitHook, gitWithRetry, compactFailure
} from './commit-git.js';

const NOT_A_REPO = 'Refused: not inside a git repository.';

const refused = (reasons, parsed) => ({ ok: false, exitCode: 1, refusals: reasons, json: parsed.json, lines: reasons });

const failed = (lines, parsed, extra = {}) => ({ ok: false, exitCode: 1, refusals: [], json: parsed.json, lines, ...extra });

const lockedOutLines = (outcome) => {
  const holder = outcome.lockHolder ? `pid ${outcome.lockHolder}` : 'holder pid not found';
  return [`Failed: .git/index.lock stayed held after ${outcome.attempts} attempt(s) (${holder}). Nothing was committed. Rerun when the other git process ends.`];
};

const gateFailureLines = (outcome) => [
  'Failed: git commit did not complete (pre-commit gate or git error). Nothing was committed. Findings:',
  ...compactFailure(outcome.output)
];

const failureLines = (outcome) => (outcome.lockedOut ? lockedOutLines(outcome) : gateFailureLines(outcome));

const RESTORE_FAILED = 'warning: could not restore the index; the listed files may still be staged (git restore --staged -- <files>).';

// Puts the listed files' index entries back after a failure; the extra line is empty when that worked.
const restoreLines = (root, rel, snapshot) => (restoreIndex(root, rel, snapshot) ? [] : [RESTORE_FAILED]);

// Stages the listed files; returns the reasons it cannot (empty when staged and something changed).
const addFailureLines = (added) => (added.lockedOut ? lockedOutLines(added) : ['Failed: git add did not complete. Nothing was committed. Findings:', ...compactFailure(added.output)]);

const stageFiles = async (root, rel, retry) => {
  const added = await gitWithRetry(root, ['add', '--', ...rel], retry);
  const isAddFailed = added.status !== 0;
  if (isAddFailed) return { reasons: addFailureLines(added), isFailure: true, added };
  const hasChanges = stagedAmong(root, rel).length > 0;
  const reasons = hasChanges ? [] : ['Refused: nothing to commit in the listed files (no changes).'];
  return { reasons, isFailure: false, added };
};

const commitArgsFor = (message, rel) => [
  'commit', '-m', message.subject, ...message.paragraphs.flatMap((paragraph) => ['-m', paragraph]), '--', ...rel
];

const peerStagedLines = (paths) => (paths.length ? [`warning: left alone, staged by others: ${paths.join(', ')}`] : []);

// Everything that happens after git accepted the commit.
const afterCommit = (root, cwd, facts, message, hasHook) => {
  const sha = shortSha(root);
  const { db, committer, taskId, boardTaskId, rel, parsed } = facts;
  const recorded = recordCommit(db, { committer, taskId: boardTaskId, noTask: parsed.noTask, sha, subject: message.subject, files: rel });
  const released = parsed.release ? releaseLeases(db, committer, parsed.files, cwd) : [];
  const gate = hasHook ? 'pre-commit hook passed' : 'no pre-commit hook is installed in this repository';
  return { sha, subject: message.subject, files: rel, gate, task: taskId ? `#${taskId}` : `none (${parsed.noTask})`, recorded, released, warnings: facts.leaseWarnings, peerLines: peerStagedLines(facts.unrelatedStaged) };
};

export const formatSuccessLines = (data, isReleaseAsked) => {
  const recordLine = data.recorded ? 'recorded: activity event posted' : 'recorded: no (team db unavailable)';
  const releaseLine = isReleaseAsked ? [`leases released: ${data.released.length ? data.released.join(', ') : 'none held'}`] : [];
  const warnLines = data.warnings.map((warning) => `warning: your lease on ${warning.file} had expired before this commit`);
  return [`sha: ${data.sha}`, `subject: ${data.subject}`, `files: ${data.files.join(', ')}`, `gate: ${data.gate}`, `task: ${data.task}`, recordLine, ...releaseLine, ...warnLines, ...data.peerLines];
};

const isDirectory = (dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory();

// The git repo that owns a path (a submodule counts as its own repo); null when none does.
const ownerOf = (cwd, file) => {
  const resolved = path.resolve(cwd, file);
  // A submodule's own root belongs to the parent repo (a pointer bump), so look from its parent.
  const own = isDirectory(resolved) ? gitRoot(resolved) : null;
  const isRepoRoot = own !== null && fs.realpathSync(own) === fs.realpathSync(resolved);
  let dir = isRepoRoot ? path.dirname(resolved) : resolved;
  while (!isDirectory(dir) && dir !== path.dirname(dir)) dir = path.dirname(dir);
  const root = gitRoot(dir);
  const abs = root ? path.join(fs.realpathSync(dir), path.relative(dir, resolved)) : resolved;
  return { root, abs };
};

const groupLines = (groups) => [...groups].map(([root, files]) => `  ${root}: ${files.join(', ')}`);

// Sends the listed files to the one repo that owns them; refuses when they span several.
const routeToOwner = (parsed, cwd) => {
  const groups = new Map();
  const absFiles = [];
  const orphans = [];
  for (const file of parsed.files) {
    const { root, abs } = ownerOf(cwd, file);
    absFiles.push(abs);
    if (root) groups.set(root, [...(groups.get(root) ?? []), file]);
    else orphans.push(file);
  }
  const isMixedWithOrphans = orphans.length > 0 && groups.size > 0;
  if (isMixedWithOrphans) return { refusal: ['Refused: these files are not inside any git repository. Nothing was staged.', ...orphans.map((file) => `  ${file}`)] };
  const isSplit = groups.size > 1;
  if (isSplit) return { refusal: ['Refused: the listed files belong to more than one git repository. Commit each group separately. Nothing was staged. Groups:', ...groupLines(groups)] };
  const [owner] = groups.keys();
  const isMoved = owner !== undefined && owner !== gitRoot(cwd);
  return { cwd: isMoved ? owner : cwd, files: isMoved ? absFiles : parsed.files };
};

/**
 * Paths inside a submodule are committed in that submodule (its own index, hook and task trailer);
 * paths that span several repositories are refused with the grouping. Not guaranteed: a submodule
 * pointer bump in the superproject is a separate commit.
 * @param {string[]} args Everything after `chemx commit`.
 * @param {{ cwd?: string, env?: object, sleep?: Function, delaysMs?: number[] }} [options]
 * @returns {Promise<{ ok: boolean, exitCode: number, lines: string[], refusals: string[], json: boolean, data?: object }>}
 */
export const runCommit = async (args, options = {}) => {
  const parsed = parseCommitArgs(args);
  const startCwd = options.cwd ?? process.cwd();
  const routed = parsed.files.length ? routeToOwner(parsed, startCwd) : { cwd: startCwd, files: parsed.files };
  const isRefused = Boolean(routed.refusal);
  if (isRefused) return refused(routed.refusal, parsed);
  return commitInRepo({ ...parsed, files: routed.files }, routed.cwd, options);
};

const commitInRepo = async (parsed, cwd, options) => {
  const env = options.env ?? process.env;
  const root = gitRoot(cwd);
  const facts = root ? gatherFacts(parsed, cwd, root, env) : null;
  const preflight = facts ? collectRefusals(facts) : [NOT_A_REPO];
  // The hook runs as the committer, so its lease check sees the same handle as this command.
  const gitEnv = facts?.committer ? { ...env, CHEMX_AGENT_ID: facts.committer } : env;
  const retry = { sleep: options.sleep, delaysMs: options.delaysMs, env: gitEnv };
  const isPreflightClean = preflight.length === 0;
  const snapshot = isPreflightClean ? snapshotIndex(root, facts.rel) : [];
  const staging = isPreflightClean ? await stageFiles(root, facts.rel, retry) : { reasons: [], isFailure: false };
  if (staging.isFailure) return failed(staging.reasons, parsed, { attempts: staging.added.attempts, lockHolder: staging.added.lockHolder });
  const reasons = [...preflight, ...staging.reasons];
  const isRefused = reasons.length > 0;
  if (isRefused) return refused([...reasons, ...(isPreflightClean ? restoreLines(root, facts.rel, snapshot) : [])], parsed);
  const message = buildCommitMessage({ messages: parsed.messages, taskId: facts.taskId, noTask: parsed.noTask, config: facts.config, env });
  const hasHook = hasPreCommitHook(root);
  const outcome = await gitWithRetry(root, commitArgsFor(message, facts.rel), retry);
  const isCommitFailed = outcome.status !== 0;
  if (isCommitFailed) return failed([...failureLines(outcome), ...restoreLines(root, facts.rel, snapshot)], parsed, { attempts: outcome.attempts, lockHolder: outcome.lockHolder });
  const data = afterCommit(root, cwd, facts, message, hasHook);
  return { ok: true, exitCode: 0, refusals: [], json: parsed.json, lines: formatSuccessLines(data, parsed.release), data };
};
