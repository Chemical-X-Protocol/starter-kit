// The AST Architecture step of `chemx verify`, shared by the package pipeline (verify.js) and the
// harness-repo pipeline (verify-harness.js): one place decides what the audit gate is.
import { loadProjectConfig } from './config/index.js';
import { runAudit as executeAstAudit } from './audit-engine.js';
import { computeGateVerdict, evaluateDeltaVerdict } from './audit/gate-verdict.js';
import { evaluateBaseDelta, summarizeBaseDelta } from './audit/base-delta.js';
import { STATUS } from './result-status.js';
import { stepLine } from './verify-report.js';
import { changedAuditOptions, formatDeltaFailure } from './verify-changed.js';

const EMPTY_AUDIT = { violations: [], totalViolations: 0, health: { grade: 'A', score: 100 } };

// scope: resolveAuditScope's result; changes: resolveVerifyChanges' result (or null for a full audit);
// base: the --base revision (or null). Prints the step line through `progress`. Returns { status, section }.
export const runAuditStep = ({ cwd, scope, changes, base, rawArgs, config, progress }) => {
  progress.start('AST Architecture', { announceOnPipe: true });
  const projectConfig = config || loadProjectConfig(cwd, rawArgs);
  const hasNoChangedSource = Boolean(changes) && changes.files.length === 0;
  const auditOptions = changes ? changedAuditOptions(cwd, changes) : {};
  const auditReport = hasNoChangedSource ? EMPTY_AUDIT : executeAstAudit(scope.dir, { cwd, config: projectConfig, ...auditOptions });
  // --changed with an explicit --base gates on the change itself: each rule's count against the base, at any severity (#6091).
  const baseDelta = changes && base ? evaluateBaseDelta(cwd, changes.base, rawArgs, { config: projectConfig }) : null;
  const gate = baseDelta ? evaluateDeltaVerdict(baseDelta) : computeGateVerdict({ projectRoot: cwd, scope: scope.relDir, violations: auditReport.violations, isPartialScan: Boolean(changes) });
  const status = gate.isPassing ? STATUS.PASS : STATUS.FAIL;
  const auditText = `${auditReport.health.grade} (${auditReport.health.score}/100, ${auditReport.totalViolations} violations)`;
  const excludedNote = scope.excluded ? `, ${scope.excluded.length} package/submodule dir(s) not audited (--all-packages runs their own audits)` : '';
  const auditScope = changes ? `${changes.files.length} changed file(s) vs ${changes.base}` : `${scope.relDir}/${excludedNote}`;
  const gateNote = baseDelta ? `${changes.files.length} changed file(s), delta gate vs ${changes.base}` : `${auditScope}, ${gate.basis} gate`;
  const deltaFailure = baseDelta && !gate.isPassing ? formatDeltaFailure(baseDelta) : '';
  progress.finish(stepLine(status, 'AST Architecture', auditText, gateNote) + deltaFailure);

  const section = {
    status,
    score: auditReport.health.score,
    grade: auditReport.health.grade,
    violationsCount: auditReport.totalViolations,
    criticalCount: auditReport.violations.filter((v) => v.severity === 'CRITICAL').length,
    passing: gate.isPassing,
    basis: gate.basis,
    regressions: gate.regressions.slice(0, 10),
    note: gate.note,
    ...(baseDelta ? { delta: summarizeBaseDelta(baseDelta) } : {})
  };
  return { status, section };
};
