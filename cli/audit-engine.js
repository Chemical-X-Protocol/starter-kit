// Core audit engine: runs the scan and computes the report. Presentation (terminal report,
// banners, navigator) lives behind cli/audit.js and is never imported from here.
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectConfig } from './config/index.js';
import { createHookShapeRegistry } from './audit/rules.js';
import { createPatternRegistry } from './audit/pattern-detector.js';
import { buildRemediationRoadmap } from './audit/roadmap.js';
import {
  calculateMolecularHealthScore,
  calculatePillarBreakdown,
  calculateTokenBurnAnalytics,
  calculateHotspots,
  calculateAiSlopScore
} from './audit/metrics.js';
import { generateMarkdownReport } from './audit/reporter-markdown.js';
import { scanTree } from './audit-scan.js';
import { createCoverageCollector, summarizeCoverage } from './audit/coverage.js';
import { SCORE_MODEL } from './audit/metrics.js';
import { RULESET_VERSION } from './audit/rule-revisions.js';
import { getLineBudgets } from './audit/line-budgets.js';
import { openAuditForge, finishAuditForge } from './forge/audit-forge.js';

export { auditFile, resolveAuditConfig, scanTree, scanDirectory } from './audit-scan.js';

export const runAudit = (targetDir = 'src', options = {}) => {
  const cwd = options.cwd || process.cwd();
  const absoluteTarget = path.isAbsolute(targetDir) ? targetDir : path.resolve(cwd, targetDir);
  const patternRegistry = createPatternRegistry();
  const hookRegistry = createHookShapeRegistry();
  const config = options.config || loadProjectConfig(cwd);
  const includeTests = Boolean(options.includeTests);
  const coverageCollector = createCoverageCollector();
  const forge = openAuditForge(cwd, options);
  const { violations, fileStats, totalHooks, skippedConflicts = [] } = scanTree(absoluteTarget, cwd, {
    patternRegistry,
    hookRegistry,
    fast: Boolean(options.fast),
    fileList: options.fileList || null,
    includeTests,
    config,
    coverage: coverageCollector,
    forge
  });
  const fingerprint = forge ? finishAuditForge(forge, { absoluteTarget, isPartial: Boolean(options.fileList) }) : null;

  const crossHookViolations = hookRegistry.validateCrossHookConsistency();
  violations.push(...crossHookViolations);

  const scannedFiles = fileStats.length;
  const totalLoc = fileStats.reduce((acc, f) => acc + f.lineCount, 0);
  const avgLoc = scannedFiles > 0 ? Math.round(totalLoc / scannedFiles) : 0;

  let largestFile = { filePath: '', lineCount: 0 };
  let moleculeCount = 0;
  let moleculeCompliantCount = 0;

  for (const f of fileStats) {
    const isLargerFile = f.lineCount > largestFile.lineCount;
    if (isLargerFile) {
      largestFile = { filePath: f.relativePath, lineCount: f.lineCount };
    }
    if (f.isMolecule) {
      moleculeCount += 1;
      const isWithinBudget = f.lineCount <= f.lineBudget;
      if (isWithinBudget) {
        moleculeCompliantCount += 1;
      }
    }
  }

  const moleculeCompliantPct = moleculeCount > 0
    ? Math.round((moleculeCompliantCount / moleculeCount) * 100)
    : 100;

  const metrics = {
    scannedFiles,
    totalLoc,
    avgLoc,
    largestFile,
    moleculeCount,
    moleculeCompliantCount,
    moleculeCompliantPct,
    moleculeLineLimit: getLineBudgets(config?.rules).molecule,
    hookCount: totalHooks
  };

  const health = calculateMolecularHealthScore(violations, scannedFiles);
  const pillars = calculatePillarBreakdown(violations);
  const contextAnalysis = calculateTokenBurnAnalytics(fileStats, options);
  const hotspots = calculateHotspots(violations, fileStats, 5);
  const aiSlop = calculateAiSlopScore(violations, scannedFiles);
  const patterns = patternRegistry.resolveHarmonizationCandidates(hotspots, { ruleOfThree: config?.rules?.ruleOfThreeAbstractions ?? config?.ruleOfThreeAbstractions ?? true });
  const roadmap = buildRemediationRoadmap({ hotspots, violations, patterns });

  const stage = options.stage || (options.relax ? 'draft' : 'strict');

  const report = {
    targetDir,
    stage,
    options,
    ruleset: RULESET_VERSION,
    scoreModel: SCORE_MODEL,
    coverage: summarizeCoverage(coverageCollector),
    scannedFiles,
    totalViolations: violations.length,
    metrics,
    health,
    aiSlop,
    pillars,
    contextAnalysis,
    hotspots,
    patterns,
    roadmap,
    violations,
    skippedConflicts,
    fingerprint
  };

  const hasOutputFile = Boolean(options.outputFile);
  if (hasOutputFile) {
    const outPath = path.resolve(cwd, options.outputFile);
    const mdContent = generateMarkdownReport(report);
    fs.writeFileSync(outPath, mdContent, 'utf-8');
  }

  return report;
};
