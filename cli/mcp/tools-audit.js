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
import { autoGenerateTasksFromAudit } from '../team/team-triage.js';
import { resolveTargetCwd } from './tools-search.js';

export const handleAudit = (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  const rawTarget = args.path || args.dir || (fs.existsSync(path.resolve(baseCwd, 'src')) ? 'src' : '.');
  const resolvedTarget = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(baseCwd, rawTarget);
  const isFile = fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isFile();

  if (isFile) {
    const relPath = path.relative(baseCwd, resolvedTarget);
    const violations = auditFile(resolvedTarget, relPath);
    return {
      type: 'file',
      target: relPath,
      violationCount: violations.length,
      violations
    };
  }

  const options = {
    cwd: baseCwd,
    model: args.model || 'blended',
    outputFile: null
  };

  const report = executeAstAudit(resolvedTarget, options);

  try {
    const syncRes = syncSearchIndex(resolvedTarget, baseCwd);
    if (syncRes?.db) {
      syncViolationsIndex(syncRes.db, report.violations);
      recordAuditSnapshot(syncRes.db, report);
      autoGenerateTasksFromAudit(syncRes.db, { cwd: baseCwd, targetDir: resolvedTarget });
    }
  } catch (syncError) {
    process.stderr.write(`[chemx] Search index sync bypassed: ${syncError?.message || String(syncError)}\n`);
  }

  const isSevereViolation = (v) => v.severity === 'CRITICAL' || v.severity === 'HIGH';
  const hasCriticalOrHigh = report.violations.some(isSevereViolation);
  const isStrictFail = Boolean(args.strict) && report.violations.length > 0;
  const isScoreFail = typeof args.minScore === 'number' && report.health.score < args.minScore;
  const isPassing = !isStrictFail && !isScoreFail && !hasCriticalOrHigh;

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
    isPassing
  };
};

export const handleGetRefactorPrompt = (args = {}, cwd = process.cwd()) => {
  const targetDir = args.dir || (fs.existsSync(path.resolve(cwd, 'src')) ? 'src' : '.');
  const scope = args.scope || 'master';
  const report = executeAstAudit(targetDir, {});

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
