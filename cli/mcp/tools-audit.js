import fs from 'node:fs';
import path from 'node:path';
import { runAudit as executeAstAudit, auditFile } from '../audit.js';
import {
  buildMasterPrompt,
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildAiSlopPrompt,
  buildHotspotsPrompt
} from '../audit/prompts.js';
import { syncSearchIndex, syncViolationsIndex, recordAuditSnapshot } from '../search.js';
import { triageFromIndex } from '../team/team-commands-triage.js';
import { resolveTargetCwd } from './tools-search.js';
import { resolveAuditScope } from '../audit-scope.js';
import { computeGateVerdict } from '../audit/gate-verdict.js';
import { buildAuditSummary } from '../audit/audit-summary.js';
import { loadProjectConfig } from '../config/index.js';
import { loadTaskRules } from '../team/team-task-rules.js';

export const handleAudit = (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  const explicitTarget = args.path || args.dir || null;
  const explicitResolved = explicitTarget ? path.resolve(baseCwd, explicitTarget) : null;
  const isFile = Boolean(explicitResolved) && fs.existsSync(explicitResolved) && fs.statSync(explicitResolved).isFile();

  if (isFile) {
    const relPath = path.relative(baseCwd, explicitResolved);
    const violations = auditFile(explicitResolved, relPath);
    return {
      type: 'file',
      target: relPath,
      violationCount: violations.length,
      violations
    };
  }

  const scope = resolveAuditScope({ projectRoot: baseCwd, explicitDir: explicitTarget });
  const isScopeInvalid = !scope.ok;
  if (isScopeInvalid) return { type: 'refusal', success: false, error: scope.message, candidates: scope.candidates };
  const resolvedTarget = scope.dir;
  const rawTarget = scope.relDir;

  const options = {
    cwd: baseCwd,
    config: loadProjectConfig(baseCwd, []),
    model: args.model || 'blended',
    outputFile: null,
    fingerprint: true
  };

  const report = executeAstAudit(resolvedTarget, options);

  try {
    const syncRes = syncSearchIndex(resolvedTarget, baseCwd);
    const hasSearchDb = Boolean(syncRes?.db);
    if (hasSearchDb) {
      syncViolationsIndex(syncRes.db, report.violations, { scope: syncRes.scope });
      recordAuditSnapshot(syncRes.db, report);
      const shouldTriage = args.triage === true;
      if (shouldTriage) triageFromIndex(syncRes.db, { cwd: baseCwd, targetDir: resolvedTarget });
    }
  } catch (syncError) {
    process.stderr.write(`[chemx] Search index sync bypassed: ${syncError?.message || String(syncError)}\n`);
  }

  const gate = computeGateVerdict({ projectRoot: baseCwd, scope: scope.relDir, violations: report.violations });
  const isStrictFail = Boolean(args.strict) && report.violations.length > 0;
  const isScoreFail = typeof args.minScore === 'number' && report.health.score < args.minScore;
  const isPassing = !isStrictFail && !isScoreFail && gate.isPassing;

  const shouldReturnSummary = args.full !== true;
  if (shouldReturnSummary) return buildAuditSummary({ ...report, gate: { ...gate, isPassing } }, { projectRoot: baseCwd, scope: rawTarget });

  return {
    type: 'directory',
    target: rawTarget,
    health: report.health,
    metrics: report.metrics,
    aiSlop: report.aiSlop,
    hotspots: report.hotspots,
    totalViolations: report.totalViolations,
    violations: report.violations,
    contextAnalysis: report.contextAnalysis,
    gate,
    isPassing
  };
};

export const handleGetRefactorPrompt = (args = {}, cwd = process.cwd()) => {
  const auditScope = resolveAuditScope({ projectRoot: resolveTargetCwd(cwd), explicitDir: args.dir || null });
  const isAuditScopeInvalid = !auditScope.ok;
  if (isAuditScopeInvalid) return { success: false, error: auditScope.message, candidates: auditScope.candidates };
  const targetDir = auditScope.relDir;
  const scope = args.scope || 'master';
  const report = executeAstAudit(auditScope.dir, { cwd: resolveTargetCwd(cwd) });
  report.taskRules = loadTaskRules(resolveTargetCwd(cwd));

  const PROMPT_BUILDERS = {
    'grade-f': buildGradeFPrompt,
    'grade-d': buildGradeDPrompt,
    'grade-c': buildGradeCPrompt,
    'grade-b': buildGradeBPrompt,
    'ai-slop': buildAiSlopPrompt,
    'hotspots': buildHotspotsPrompt,
    'master': buildMasterPrompt
  };

  const builder = Object.prototype.hasOwnProperty.call(PROMPT_BUILDERS, scope)
    ? PROMPT_BUILDERS[scope]
    : buildMasterPrompt;

  return {
    targetDir,
    scope,
    prompt: builder(report) || 'No violations found for the requested scope.'
  };
};
