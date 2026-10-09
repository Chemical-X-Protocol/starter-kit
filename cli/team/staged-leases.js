/**
 * Chemical X Protocol: commit guard for file leases (#2492).
 * A lease keeps other agents out of a file while its holder works. Git does not know about leases, so
 * without this a commit could sweep in a file someone else is mid-edit on. checkStagedLeases reads
 * the lease tables read-only and reports:
 *   - refusals: a staged file with a LIVE lease held by a different handle (or, when the committer has
 *     no handle, by any agent);
 *   - warnings: a staged file whose lease the committer held and lost to expiry (the commit proceeds).
 * Limits: it sees only leases recorded in a .chemx/index.db at or above the root, and it cannot tell
 * whether the holder's edits to a file are finished, only that the holder still claims it.
 */
import path from 'node:path';
import { lockRoots, leaseKeys } from './lease-roots.js';
import { openTeamDbReadOnly, closeQuietly, safeAll } from './team-db-readonly.js';
import { describeLease } from './team-db-lock-promotion.js';
import { lapseFor } from './lease-reacquire.js';

const liveLeasesOf = (db, keys, now) => {
  const placeholders = keys.map(() => '?').join(', ');
  const rows = safeAll(db, `SELECT * FROM file_leases WHERE file_path IN (${placeholders})`, keys);
  return rows.map((row) => describeLease(row, now)).filter((lease) => lease.active);
};

// What one lock db says about one staged file, for the committer.
const inspectInRoot = (lockRoot, absPath, root, committer, now) => {
  const keys = leaseKeys(lockRoot, absPath, root);
  const db = keys.length > 0 ? openTeamDbReadOnly(lockRoot) : null;
  const hasDb = Boolean(db);
  if (!hasDb) return { refusal: null, warning: null };
  try {
    const foreign = liveLeasesOf(db, keys, now).find((lease) => lease.locked_by !== committer);
    if (foreign) return { refusal: foreign, warning: null };
    const lapse = committer ? lapseFor(db, keys[0], committer, now) : null;
    return { refusal: null, warning: lapse };
  } finally {
    closeQuietly(db);
  }
};

const inspectFile = (file, root, committer, now) => {
  const absPath = path.resolve(root, file);
  const found = lockRoots(root, absPath).map((lockRoot) => inspectInRoot(lockRoot, absPath, root, committer, now));
  const refusal = found.map((entry) => entry.refusal).find(Boolean);
  const warning = found.map((entry) => entry.warning).find(Boolean);
  return { file, refusal, warning };
};

/**
 * @param {string[]} stagedFiles Paths relative to root.
 * @param {string|null|undefined} committer The committing handle; falsy means a human with no handle.
 * @param {{ root?: string, now?: number }} [options]
 * @returns {{ ok: boolean, isHuman: boolean, refusals: object[], warnings: object[] }}
 */
export const checkStagedLeases = (stagedFiles, committer, options = {}) => {
  const root = options.root ?? process.cwd();
  const now = options.now ?? Date.now();
  const handle = committer || null;
  const inspected = stagedFiles.map((file) => inspectFile(file, root, handle, now));
  const refusals = inspected.filter((entry) => entry.refusal).map(({ file, refusal }) => ({
    file, holder: refusal.locked_by, purpose: refusal.purpose || '', expiresAt: Number(refusal.expires_at)
  }));
  const warnings = inspected.filter((entry) => entry.warning).map(({ file, warning }) => ({ file, lapsedAt: warning.expiredAt }));
  return { ok: refusals.length === 0, isHuman: !handle, refusals, warnings };
};
