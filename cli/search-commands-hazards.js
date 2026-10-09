// `chemx q hazards`: violations recorded by the last audit. Without an audit, or when files
// changed after it, the answer is inconclusive, never "healthy".
import fs from 'node:fs';
import path from 'node:path';
import { ANSI } from './theme.js';
import { queryViolations } from './search-queries.js';
import { STATUS, combineStatuses, toExitCode } from './result-status.js';
import { withIndex } from './search-output.js';

const formatAge = (ms) => {
  const minutes = Math.round(ms / 60000);
  const isUnderHour = minutes < 60;
  if (isUnderHour) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

const latestAuditTimestamp = (db) => {
  const row = db.prepare('SELECT MAX(timestamp) AS ts FROM audit_snapshots').get();
  const hasSnapshot = row && row.ts !== null && row.ts !== undefined;
  return hasSnapshot ? Number(row.ts) : null;
};

const countFilesChangedSince = (db, timestamp, filePath, root) => {
  const hasFileTarget = Boolean(filePath);
  if (hasFileTarget) {
    const abs = path.resolve(root, filePath);
    const isPresent = fs.existsSync(abs);
    return isPresent && fs.statSync(abs).mtimeMs > timestamp ? 1 : 0;
  }
  return Number(db.prepare('SELECT COUNT(*) AS c FROM files WHERE mtime > ?').get(timestamp)?.c || 0);
};

export const assessAuditFreshness = (db, { filePath = null, root = process.cwd(), now = Date.now() } = {}) => {
  const lastAuditAt = latestAuditTimestamp(db);
  const hasNoAudit = lastAuditAt === null;
  if (hasNoAudit) return { status: STATUS.INCONCLUSIVE, reason: 'no audit data (run chemx audit)', lastAuditAt: null, auditAge: null };
  const auditAge = formatAge(now - lastAuditAt);
  const changedCount = countFilesChangedSince(db, lastAuditAt, filePath, root);
  const isStale = changedCount > 0;
  const reason = isStale ? `${changedCount} file(s) changed after the last audit (${auditAge} ago); run chemx audit` : null;
  return { status: isStale ? STATUS.INCONCLUSIVE : STATUS.PASS, reason, lastAuditAt, auditAge };
};

export const handleHazardsCommand = (db, options = {}, { index = null, isJson = false, isCli = true, root = process.cwd() } = {}) => {
  const hazards = queryViolations(db, options);
  const freshness = assessAuditFreshness(db, { filePath: options.filePath, root: options.root || root });
  const status = combineStatuses([freshness.status, index ? index.status : STATUS.PASS]);
  const payload = { status, reason: freshness.reason, lastAuditAt: freshness.lastAuditAt, auditAge: freshness.auditAge, count: hazards.length, hazards };
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
    const message = isInconclusive ? 'No hazards recorded, but the audit data cannot vouch for the current code.' : `Zero hazards recorded by the audit ${freshness.auditAge} ago.`;
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
