// `chemx heal --undo <run>` (engine doc, Heal: ROLLBACK AFTER COMMIT): restores an applied heal while every
// file it wrote still has the bytes the heal left (its after-hash); otherwise it refuses and names the
// file. A committed heal is undone with `git revert` instead. Leases follow the heal rule: all or none.
import fs from 'node:fs';
import path from 'node:path';
import { applyEdits, EditRefusedError } from '../apply-edits.js';
import { ensureFresh } from '../index-freshness.js';
import { fingerprintFile } from './fingerprint-file.js';
import { HealError, fileHashOf } from './heal-text.js';
import { acquireAll, releaseTaken } from './heal-leases.js';
import { readHealRun, setHealOutcome, setBlueprintStatus } from './heal-store.js';
import { isRestored } from './heal-apply.js';

const currentHashOf = (root, file) => {
  const absolute = path.join(root, file);
  return fs.existsSync(absolute) ? fileHashOf(fs.readFileSync(absolute, 'utf-8')) : null;
};

const driftedFiles = (root, files) => files.filter((file) => currentHashOf(root, file.file) !== file.afterSha).map((file) => file.file);

const restoreEdits = (files) => files.map((file) => (file.created ? { path: file.file, delete: true } : { path: file.file, content: file.before, allowRemoved: true }));

const resync = (root, files) => {
  for (const file of files) {
    const absolute = path.join(root, file.file);
    try {
      ensureFresh(root, { paths: [absolute], scope: false });
    } catch {
      // chemx-allow: best-effort the search index is a cache; the next chemx q re-syncs a stale file
    }
    fingerprintFile(absolute, root);
  }
};

const undoProblemOf = (found, root) => {
  const isMissing = Boolean(found.error);
  if (isMissing) return ['HEAL_RUN_UNKNOWN', found.error];
  const isApplied = found.run.outcome === 'applied';
  if (!isApplied) return ['HEAL_NOT_APPLIED', `run ${found.run.id} is ${found.run.outcome}; only an applied heal can be undone`];
  const drifted = driftedFiles(root, found.run.files);
  const hasDrift = drifted.length > 0;
  return hasDrift ? ['HEAL_UNDO_DRIFT', `changed since the heal (commit or edit): ${drifted.join(', ')}; nothing was restored (use git revert for a committed heal)`] : null;
};

/**
 * Undoes one applied heal run. options: { root, db, agentId }. Returns { outcome: 'undone', runId, files }
 * or { outcome: 'refused', code, message }.
 */
export const undoHeal = (runId, { root, db, agentId }) => {
  const found = readHealRun(db, runId);
  const problem = undoProblemOf(found, root);
  if (problem) return { outcome: 'refused', code: problem[0], message: problem[1] };
  const { run } = found;
  try {
    const leases = acquireAll(root, run.files.map((file) => file.file), { agentId, purpose: `undo ${run.id}` });
    applyEdits(restoreEdits(run.files), { cwd: root, agentId });
    releaseTaken(root, leases.taken, agentId);
  } catch (error) {
    const isKnown = error instanceof HealError || error instanceof EditRefusedError;
    if (!isKnown) throw error;
    return { outcome: 'refused', code: error.code ?? 'HEAL_EDIT_REFUSED', message: error.message };
  }
  const isIdentical = isRestored(root, run.files);
  resync(root, run.files);
  setHealOutcome(db, run.id, isIdentical ? 'undone' : 'undo_failed', null, isIdentical ? 'restored byte-identical' : 'files differ from their before state after the restore');
  setBlueprintStatus(db, run.blueprintId, isIdentical ? 'planned' : 'rejected');
  return { outcome: isIdentical ? 'undone' : 'undo_failed', runId: run.id, files: run.files.map((file) => file.file) };
};
