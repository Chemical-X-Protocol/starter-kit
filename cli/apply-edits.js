/**
 * applyEdits: the single mutation gate for write, patch, autofix, explode and add:*.
 *
 * Every edit is validated before anything touches disk:
 *   - the path stays inside the workspace (realpath containment, symlinked parents included);
 *   - the new text parses (Babel / SFC script blocks / JSON) unless the old text was already broken;
 *   - no top-level declaration disappears unless the caller named it in allowRemoved;
 *   - no other agent holds a team lock on the file.
 * A dry run returns the same result (with an uncapped unified diff) and writes nothing.
 * A real run writes each file atomically with a backup and rolls back the batch on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath } from './path-scope.js';
import { parseSource } from './source-parse.js';
import { buildUnifiedDiff } from './edit-diff.js';
import { writeAtomic, removeWithBackup, restoreFromBackup } from './edit-atomic.js';
import { findForeignLease } from './edit-locks.js';

export class EditRefusedError extends Error {
  constructor(issues) {
    super(issues.map((i) => `${i.file}: ${i.reason}`).join('\n'));
    this.name = 'EditRefusedError';
    this.issues = issues;
  }
}

/**
 * Declaration delta between two parses. A 1-for-1 swap (a rename) is allowed; a net loss of
 * top-level declarations is not, unless every lost name is listed in allowRemoved.
 */
const declarationDelta = (beforeParse, afterParse, allowRemoved) => {
  const isComparable = beforeParse.ok && afterParse.ok && beforeParse.kind === 'babel';
  if (!isComparable) return { removed: [], added: [], blocked: [] };
  const beforeSet = new Set(beforeParse.declarations);
  const afterSet = new Set(afterParse.declarations);
  const removed = beforeParse.declarations.filter((name) => !afterSet.has(name));
  const added = afterParse.declarations.filter((name) => !beforeSet.has(name));
  const isAllAllowed = allowRemoved === true;
  const allowed = new Set(Array.isArray(allowRemoved) ? allowRemoved : []);
  const unallowed = isAllAllowed ? [] : removed.filter((name) => !allowed.has(name));
  const isNetLoss = unallowed.length > added.length;
  return { removed, added, blocked: isNetLoss ? unallowed : [] };
};

const planEdit = (edit, root, options) => {
  const absPath = resolveSafePath(edit.path, root);
  const file = path.relative(root, absPath);
  const isExisting = fs.existsSync(absPath);
  const isDirectory = isExisting && fs.statSync(absPath).isDirectory();
  if (isDirectory) return { file, absPath, issue: 'path is a directory' };

  const before = isExisting ? fs.readFileSync(absPath, 'utf-8') : null;
  const isDelete = Boolean(edit.delete);
  const plan = { file, absPath, before, isDelete, created: !isExisting, deleted: isDelete };
  if (isDelete && !isExisting) return { ...plan, issue: 'cannot delete a file that does not exist' };
  const isMissingContent = !isDelete && typeof edit.content !== 'string';
  if (isMissingContent) return { ...plan, issue: 'no content given' };

  const after = isDelete ? '' : edit.content;
  const lease = findForeignLease(root, absPath, options.agentId);
  if (lease) return { ...plan, issue: `locked by ${lease.lockedBy}${lease.purpose ? ` (${lease.purpose})` : ''}; wait for release or pass the holder's agent id` };
  if (isDelete) return { ...plan, after, parse: { kind: 'n/a', ok: true }, declarations: { removed: [], added: [] } };

  const afterParse = parseSource(after, absPath);
  const beforeParse = before === null ? null : parseSource(before, absPath);
  const wasBroken = Boolean(beforeParse) && !beforeParse.ok;
  const isNewlyBroken = !afterParse.ok && !wasBroken;
  if (isNewlyBroken) return { ...plan, after, issue: `result does not parse (${afterParse.error}); nothing was written` };

  const delta = beforeParse ? declarationDelta(beforeParse, afterParse, edit.allowRemoved) : { removed: [], added: [], blocked: [] };
  const hasBlockedRemovals = delta.blocked.length > 0;
  if (hasBlockedRemovals) {
    const addedNote = delta.added.length > 0 ? ` (added only ${delta.added.join(', ')})` : '';
    return { ...plan, after, issue: `would remove top-level declaration(s) ${delta.blocked.join(', ')}${addedNote}; name them in allowRemoved (CLI: --allow-remove=${delta.blocked.join(',')}) if intended` };
  }

  const parse = { kind: afterParse.kind, ok: afterParse.ok, ...(wasBroken ? { note: 'file did not parse before this edit either' } : {}) };
  return { ...plan, after, parse, declarations: { removed: delta.removed, added: delta.added } };
};

const commitPlans = (plans, root) => {
  const done = [];
  try {
    for (const plan of plans) {
      const isUnchanged = !plan.isDelete && plan.before === plan.after;
      if (isUnchanged) continue;
      const { backup } = plan.isDelete ? removeWithBackup(plan.absPath, root) : writeAtomic(plan.absPath, plan.after, root);
      plan.backup = backup;
      done.push(plan);
    }
  } catch (err) {
    for (const plan of done.reverse()) restoreFromBackup(plan.absPath, plan.backup);
    throw err;
  }
};

/**
 * @param {Array<{ path: string, content?: string, delete?: boolean, allowRemoved?: string[]|true }>} edits
 * @param {object} [options] { cwd, dryRun, agentId }
 * @returns {{ dryRun: boolean, files: object[], diff: string }}
 * @throws {EditRefusedError} When any edit is refused (nothing is written).
 */
export const applyEdits = (edits, options = {}) => {
  const rawRoot = options.cwd || process.cwd();
  const root = fs.existsSync(rawRoot) ? fs.realpathSync(rawRoot) : path.resolve(rawRoot);
  const dryRun = Boolean(options.dryRun);
  const plans = edits.map((edit) => planEdit(edit, root, options));
  const issues = plans.filter((p) => p.issue).map((p) => ({ file: p.file, reason: p.issue }));
  const hasIssues = issues.length > 0;
  if (hasIssues) throw new EditRefusedError(issues);

  if (!dryRun) commitPlans(plans, root);

  const files = plans.map((p) => ({
    file: p.file,
    absPath: p.absPath,
    created: p.created,
    deleted: p.deleted,
    changed: p.isDelete || p.before !== p.after,
    originalLines: p.before === null ? 0 : p.before.split('\n').length,
    newLines: p.isDelete ? 0 : p.after.split('\n').length,
    parse: p.parse,
    declarations: p.declarations,
    backup: p.backup ? path.relative(root, p.backup) : null,
    diff: buildUnifiedDiff(p.before ?? '', p.after, { path: p.file, isNew: p.created, isDeleted: p.isDelete })
  }));
  return { dryRun, files, diff: files.map((f) => f.diff).filter(Boolean).join('\n') };
};
