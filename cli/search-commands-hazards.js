// `chemx q hazards`: violations recorded by the last audit. Without an audit, or when files
// changed after it, the answer is inconclusive, never "healthy".
import fs from 'node:fs';
import path from 'node:path';
import { ANSI } from './theme.js';
import { queryViolations } from './search-queries.js';
import { STATUS, combineStatuses, toExitCode } from './result-status.js';
import { withIndex } from './search-output.js';
import { readIndexMeta } from './search-index-meta.js';
import { isPathInScope, parseScopeKey, toRootRelative } from './search-root.js';

const formatAge = (ms) => {
  const minutes = Math.round(ms / 60000);
  const isUnderHour = minutes < 60;
  if (isUnderHour) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

// Latest of: an audit_snapshots row, or the last time an audit wrote violations.
const latestAuditTimestamp = (db) => {
  const row = db.prepare('SELECT MAX(timestamp) AS ts FROM audit_snapshots').get();
  const hasSnapshot = row && row.ts !== null && row.ts !== undefined;
  const violationsAt = Number(readIndexMeta(db).violationsSyncedAt);
  const stamps = [hasSnapshot ? Number(row.ts) : NaN, violationsAt].filter(Number.isFinite);
  return stamps.length > 0 ? Math.max(...stamps) : null;
};

// A file argument is relative to where chemx was started, falling back to the project root.
const resolveTargetFile = (filePath, cwd, root) => [path.resolve(cwd, filePath), path.resolve(root, filePath)].find((abs) => fs.existsSync(abs)) || null;

// A file answer is only as good as the audit that covered it: the file must exist and sit
// inside the scope the last audit recorded. Returns { relPath, reason } (reason null when covered).
const checkFileCoverage = (filePath, auditScope, root, cwd) => {
  const abs = resolveTargetFile(filePath, cwd, root);
  const isMissing = abs === null;
  if (isMissing) return { abs: null, relPath: null, reason: `file not found: ${filePath}` };
  const relPath = toRootRelative(abs, root);
  const hasKnownScope = Boolean(auditScope);
  if (!hasKnownScope) return { abs, relPath, reason: 'the last audit was partial or did not record its scope; run chemx audit' };
  const isAudited = isPathInScope(relPath, parseScopeKey(auditScope));
  const reason = isAudited ? null : `${relPath} is outside the last audit scope (${auditScope}); run chemx audit on it`;
  return { abs, relPath, reason };
};

const countFilesChangedSince = (db, timestamp, abs) => {
  const hasFileTarget = Boolean(abs);
  if (hasFileTarget) return fs.statSync(abs).mtimeMs > timestamp ? 1 : 0;
  return Number(db.prepare('SELECT COUNT(*) AS c FROM files WHERE mtime > ?').get(timestamp)?.c || 0);
};

export const assessAuditFreshness = (db, { filePath = null, root = process.cwd(), cwd = process.cwd(), now = Date.now() } = {}) => {
  const lastAuditAt = latestAuditTimestamp(db);
  const auditScope = readIndexMeta(db).violationsScope || null;
  const base = { lastAuditAt, auditScope, auditAge: null, relPath: null };
  const hasNoAudit = lastAuditAt === null;
  if (hasNoAudit) return { ...base, status: STATUS.INCONCLUSIVE, reason: 'no audit data (run chemx audit)' };
  const auditAge = formatAge(now - lastAuditAt);
  const hasFileTarget = Boolean(filePath);
  const coverage = hasFileTarget ? checkFileCoverage(filePath, auditScope, root, cwd) : { abs: null, relPath: null, reason: null };
  const isUncovered = Boolean(coverage.reason);
  if (isUncovered) return { ...base, auditAge, relPath: coverage.relPath, status: STATUS.INCONCLUSIVE, reason: coverage.reason };
  const changedCount = countFilesChangedSince(db, lastAuditAt, coverage.abs);
  const isStale = changedCount > 0;
  const reason = isStale ? `${changedCount} file(s) changed after the last audit (${auditAge} ago); run chemx audit` : null;
  return { ...base, auditAge, relPath: coverage.relPath, status: isStale ? STATUS.INCONCLUSIVE : STATUS.PASS, reason };
};

export const handleHazardsCommand = (db, options = {}, { index = null, isJson = false, isCli = true, root = process.cwd() } = {}) => {
  const freshness = assessAuditFreshness(db, { filePath: options.filePath, root: options.root || root });
  const hazards = queryViolations(db, { ...options, filePath: freshness.relPath || options.filePath });
  const status = combineStatuses([freshness.status, index ? index.status : STATUS.PASS]);
  const payload = {
    status, reason: freshness.reason, lastAuditAt: freshness.lastAuditAt, auditAge: freshness.auditAge,
    auditScope: freshness.auditScope, count: hazards.length, hazards
  };
  if (isCli) process.exitCode = toExitCode(status);

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
    if (isCli) process.exit();
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Architectural Hazards:${ANSI.RESET} ${ANSI.DIM}(${hazards.length} recorded)${ANSI.RESET}\n`);
  const isInconclusive = freshness.status === STATUS.INCONCLUSIVE;
  if (isInconclusive) process.stdout.write(`  ${ANSI.GOLD}? Inconclusive: ${freshness.reason}${ANSI.RESET}\n`);
  const hasNoHazards = hazards.length === 0;
  if (hasNoHazards) {
    const message = isInconclusive ? 'No hazards recorded, but the audit data cannot vouch for the current code.' : `Zero hazards recorded by the audit of ${freshness.auditScope || 'an unrecorded scope'} ${freshness.auditAge} ago.`;
    process.stdout.write(`  ${ANSI.DIM}${message}${ANSI.RESET}\n\n`);
    if (isCli) process.exit();
    return payload;
  }

  for (const h of hazards) {
    const color = h.severity === 'CRITICAL' ? ANSI.RED : ANSI.GOLD;
    process.stdout.write(`  ${color}[${h.severity}]${ANSI.RESET} ${ANSI.BOLD}${h.filePath}:${h.line}${ANSI.RESET} ${ANSI.DIM}(${h.rule})${ANSI.RESET}\n`);
    process.stdout.write(`    ${ANSI.DIM}Hazard:${ANSI.RESET} ${h.hazard}\n`);
    process.stdout.write(`    ${ANSI.CYAN}Directive:${ANSI.RESET} ${h.directive}\n`);
  }
  process.stdout.write('\n');
  if (isCli) process.exit();
  return payload;
};
