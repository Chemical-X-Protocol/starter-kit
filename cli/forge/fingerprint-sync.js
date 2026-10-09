// Standalone ledger refresh (design doc, INCREMENTAL PATH step 3), behind `chemx patterns --sync`.
// It never runs rules or runAudit. It lists the audit's files, skips every file whose mtime and size
// match its stamp, hash-checks the rest and parses only files whose content (or the extractor) changed.
// Files gone from disk under the scope lose their rows.
import path from 'node:path';
import { discoverSourceFiles } from '../audit-scan.js';
import { resolveAuditScope } from '../audit-scope.js';
import { resolveIndexRoot } from '../search-root.js';
import { FORGE_EXTRACTOR_VERSION } from './store.js';
import { statOf } from './fingerprint-session.js';
import { openForgeSession, fingerprintInSession } from './fingerprint-file.js';
import { openIndexDb } from '../search-schema.js';

const SPEC_SPLIT_SQL = 'SELECT is_spec, count(*) AS n FROM pattern_units GROUP BY is_spec';

// Rows the grouping of this scope reads (spec-facet rows only with includeTests) and spec-facet rows in
// the ledger: ledgerRows counts every row, so spec rows an earlier --include-tests sync left would
// otherwise read as rows of the default scope (#2604).
const scopeCounts = (cwd, includeTests) => {
  const split = new Map((openIndexDb(cwd)?.prepare(SPEC_SPLIT_SQL).all() ?? []).map((row) => [row.is_spec, row.n]));
  const specRows = split.get(1) ?? 0;
  const plainRows = split.get(0) ?? 0;
  return { scopeRows: includeTests ? plainRows + specRows : plainRows, specRows };
};

const isStatCurrent = (stamp, stat) => {
  const isSameStat = stamp?.mtimeMs === stat.mtimeMs && stamp?.size === stat.size;
  return isSameStat && stamp.extractorVersion === FORGE_EXTRACTOR_VERSION;
};

const syncOne = (session, fullPath) => {
  const stat = statOf(fullPath);
  const stamp = session.stampOf(fullPath);
  const isPrefiltered = isStatCurrent(stamp, stat);
  if (isPrefiltered) {
    session.noteUnchanged(fullPath);
    return;
  }
  const status = fingerprintInSession(session, fullPath, stat);
  const isNewStat = status === 'unchanged';
  if (isNewStat) session.touch(fullPath, stat);
};

const resolveTarget = (cwd, root, targetDir) => {
  const isExplicit = Boolean(targetDir);
  if (isExplicit) return path.resolve(cwd, targetDir);
  const scope = resolveAuditScope({ projectRoot: root, explicitDir: null });
  return scope.ok ? scope.dir : root;
};

/**
 * Brings the ledger up to date for targetDir (default: the audit scope). options: { targetDir,
 * includeTests, log }. Returns { status, scope, files, parsed, unchanged, touched, removed, capped,
 * errors, refaceted, rows (written now), ledgerRows (stored in all), scopeRows (what grouping this scope reads),
 * specRows (spec-facet rows stored), dirty, ms }; status is 'unavailable' without a writable index db.
 * refaceted counts unchanged files moved to a new package-root facet.
 */
export const syncFingerprints = (cwd = process.cwd(), { targetDir = null, includeTests = false, log } = {}) => {
  const startedAt = performance.now();
  const session = openForgeSession(cwd, log ? { log } : {});
  if (!session) return { status: 'unavailable' };
  const root = resolveIndexRoot(cwd);
  const absoluteTarget = resolveTarget(cwd, root, targetDir);
  const files = discoverSourceFiles(absoluteTarget, includeTests);
  for (const fullPath of files) syncOne(session, fullPath);
  const scope = session.relativeOf(absoluteTarget) || '.';
  session.pruneMissing(scope);
  const summary = session.finish();
  return {
    status: 'ok', scope, files: files.length, parsed: summary.fingerprinted, unchanged: summary.unchanged,
    touched: summary.touched, removed: summary.removed, capped: summary.capped, errors: summary.errors, refaceted: summary.refaceted,
    rows: summary.rows, ledgerRows: summary.ledgerRows, ...scopeCounts(cwd, includeTests), dirty: summary.dirty, ms: Math.round(performance.now() - startedAt)
  };
};
