import fs from 'node:fs';
import path from 'node:path';
import { isSourceFile as isPolyglotSourceFile } from './languages.js';
import { loadProjectConfig } from './config/index.js';
import { auditCode, PILLARS, RULE_REGISTRY, createHookShapeRegistry } from './audit/rules.js';
import { createPatternRegistry } from './audit/pattern-detector.js';
import { countLines, getLineBudgets, resolveFileTier } from './audit/line-budgets.js';
import { createCoverageCollector, summarizeCoverage } from './audit/coverage.js';
import { SCORE_MODEL } from './audit/metrics.js';
import { RULESET_VERSION } from './audit/rule-revisions.js';
import {
  buildRemediationRoadmap,
  formatRoadmapSection,
  formatRoadmapMarkdown,
  buildSelfHealingRoadmapPrompt
} from './audit/roadmap.js';
import {
  calculateMolecularHealthScore,
  calculateQuantumHealthScore,
  calculatePillarBreakdown,
  calculateTokenBurnAnalytics,
  calculateHotspots,
  calculateAiSlopScore
} from './audit/metrics.js';
import {
  formatTerminalReport,
  generateMarkdownReport,
  groupViolationsBySeverity,
  groupViolationsByDirectory,
  groupViolationsByRule,
  formatDirectoryDistributionSection,
  formatDirectoryRollupMarkdown,
  renderGroupedViolationsMarkdown,
  resolveTopSectionColor,
  formatScorecardSection,
  formatAiSlopSection,
  formatCriticalSection,
  formatHighMediumSection,
  formatLowSection,
  formatPillarsSection,
  formatSinglePillarSection,
  formatHotspotsSection,
  formatContextAnalysisSection,
  formatFailuresSection,
  formatPassesSection,
  formatGradeFSection,
  formatGradeDSection,
  formatGradeCSection,
  formatGradeBSection,
  formatGradeASection,
  getChemicalXAsciiBanner,
  getAsciiGradeLines,
  formatAsciiGrade,
  getReportCardAsciiLines,
  REPORT_CARD_ASCII,
  formatPillarReactionBadgesTerminal,
  formatPillarReactionBadgesMarkdown,
  formatPillarShieldBadges,
  resolveBadgeColor,
  PILLAR_EMOJIS,
  PILLAR_SHORT_NAMES
} from './audit/reporter.js';
import {
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildAiSlopPrompt,
  buildHotspotsPrompt,
  buildPillarPrompt,
  buildMasterPrompt,
  deduplicateRolePreambles,
  formatPromptBox,
  formatGroupedPromptViolations
} from './audit/prompts.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'vendor',
  '.git',
  '.next',
  '.turbo',
  '.output',
  '.nuxt',
  '.cache',
  'out'
]);

const isSourceFile = (name, options = {}) => {
  return isPolyglotSourceFile(name, { includeTests: false, ...options });
};

const configCache = new Map();

/** Project config for single-file audits (check, patch, task gates, MCP), loaded once per root. */
export const resolveAuditConfig = (cwd = process.cwd()) => {
  const cached = configCache.get(cwd);
  if (cached) return cached;
  const config = loadProjectConfig(cwd);
  configCache.set(cwd, config);
  return config;
};

/**
 * Audits one file with the project config (.chemxrc profile, per-rule settings,
 * overrides). options: { config, cwd } to override the config or its root.
 */
export const auditFile = (filePath, relativePath, options = {}) => {
  if (!isSourceFile(path.basename(filePath), { includeTests: true })) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const config = options.config || resolveAuditConfig(options.cwd || process.cwd());
  return auditCode(content, filePath, relativePath, { config, coverage: options.coverage });
};

const auditFileEntry = (fullPath, relPath, scanOptions) => {
  const content = fs.readFileSync(fullPath, 'utf-8');
  const ruleConfig = scanOptions.config?.rules || {};
  const budgets = getLineBudgets(ruleConfig);
  const isMolecule = resolveFileTier(relPath, ruleConfig) === 'molecule';

  const fileStat = {
    fullPath,
    relativePath: relPath,
    lineCount: countLines(content),
    charCount: content.length,
    isMolecule,
    lineBudget: isMolecule ? budgets.molecule : budgets.file.warn
  };

  const hookMatches = content.match(/\buse[A-Z0-9]\w*\b/g);
  const hookCount = hookMatches ? hookMatches.length : 0;
  const fileViolations = auditCode(content, fullPath, relPath, {
    patternRegistry: scanOptions.patternRegistry,
    hookRegistry: scanOptions.hookRegistry,
    fast: scanOptions.fast,
    config: scanOptions.config,
    coverage: scanOptions.coverage
  });

  return { fileStat, hookCount, fileViolations };
};

export const scanTree = (targetDir, baseDir, scanOptions = {}) => {
  let violations = [];
  let fileStats = [];
  let totalHooks = 0;

  const targetRel = path.relative(baseDir, targetDir);
  const isTargetingTests = /(?:^|[\\/])(?:tests?|specs?)(?:[\\/]|$)/i.test(targetRel) ||
    /(?:^|[\\/])(?:tests?|specs?)(?:[\\/]|$)/i.test(targetDir);
  const includeTests = Boolean(scanOptions.includeTests || isTargetingTests);
  const effectiveScanOptions = { ...scanOptions, includeTests };

  if (scanOptions.fileList && scanOptions.fileList.length > 0) {
    for (const item of scanOptions.fileList) {
      const fullPath = path.isAbsolute(item) ? item : path.resolve(baseDir, item);
      const relPath = path.relative(baseDir, fullPath);
      if (fs.existsSync(fullPath) && isSourceFile(path.basename(fullPath), { includeTests: true })) {
        const result = auditFileEntry(fullPath, relPath, effectiveScanOptions);
        violations = violations.concat(result.fileViolations);
        fileStats.push(result.fileStat);
        totalHooks += result.hookCount;
      }
    }
    return { violations, fileStats, totalHooks };
  }

  if (!fs.existsSync(targetDir)) {
    return { violations, fileStats, totalHooks };
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        const sub = scanTree(fullPath, baseDir, effectiveScanOptions);
        violations = violations.concat(sub.violations);
        fileStats = fileStats.concat(sub.fileStats);
        totalHooks += sub.totalHooks;
      }
    } else if (isSourceFile(entry.name, { includeTests })) {
      const result = auditFileEntry(fullPath, relPath, effectiveScanOptions);
      violations = violations.concat(result.fileViolations);
      fileStats.push(result.fileStat);
      totalHooks += result.hookCount;
    }
  }

  return { violations, fileStats, totalHooks };
};

export const scanDirectory = (targetDir, baseDir) => {
  const { violations } = scanTree(targetDir, baseDir);
  return violations;
};

export const runAudit = (targetDir = 'src', options = {}) => {
  const cwd = options.cwd || process.cwd();
  const absoluteTarget = path.isAbsolute(targetDir) ? targetDir : path.resolve(cwd, targetDir);
  const patternRegistry = createPatternRegistry();
  const hookRegistry = createHookShapeRegistry();
  const config = options.config || loadProjectConfig(cwd);
  const includeTests = Boolean(options.includeTests);
  const coverageCollector = createCoverageCollector();
  const { violations, fileStats, totalHooks } = scanTree(absoluteTarget, cwd, {
    patternRegistry,
    hookRegistry,
    fast: Boolean(options.fast),
    fileList: options.fileList || null,
    includeTests,
    config,
    coverage: coverageCollector
  });

  const crossHookViolations = hookRegistry.validateCrossHookConsistency();
  violations.push(...crossHookViolations);

  const scannedFiles = fileStats.length;
  const totalLoc = fileStats.reduce((acc, f) => acc + f.lineCount, 0);
  const avgLoc = scannedFiles > 0 ? Math.round(totalLoc / scannedFiles) : 0;

  let largestFile = { filePath: '', lineCount: 0 };
  let moleculeCount = 0;
  let moleculeCompliantCount = 0;

  for (const f of fileStats) {
    if (f.lineCount > largestFile.lineCount) {
      largestFile = { filePath: f.relativePath, lineCount: f.lineCount };
    }
    if (f.isMolecule) {
      moleculeCount += 1;
      if (f.lineCount <= f.lineBudget) {
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
    violations
  };

  if (options.outputFile) {
    const outPath = path.resolve(cwd, options.outputFile);
    const mdContent = generateMarkdownReport(report);
    fs.writeFileSync(outPath, mdContent, 'utf-8');
  }

  return report;
};

export * from './audit/social.js';
export * from './audit/prompts.js';
export * from './audit/history.js';

export {
  calculateMolecularHealthScore,
  calculateQuantumHealthScore,
  calculateAiSlopScore,
  calculatePillarBreakdown,
  calculateTokenBurnAnalytics,
  calculateHotspots,
  PILLARS,
  RULE_REGISTRY,
  formatTerminalReport,
  generateMarkdownReport,
  groupViolationsBySeverity,
  groupViolationsByDirectory,
  groupViolationsByRule,
  formatDirectoryDistributionSection,
  formatDirectoryRollupMarkdown,
  renderGroupedViolationsMarkdown,
  resolveTopSectionColor,
  formatScorecardSection,
  formatAiSlopSection,
  formatCriticalSection,
  formatHighMediumSection,
  formatLowSection,
  formatPillarsSection,
  formatSinglePillarSection,
  formatHotspotsSection,
  formatContextAnalysisSection,
  formatFailuresSection,
  formatPassesSection,
  formatGradeFSection,
  formatGradeDSection,
  formatGradeCSection,
  formatGradeBSection,
  formatGradeASection,
  getChemicalXAsciiBanner,
  getAsciiGradeLines,
  formatAsciiGrade,
  getReportCardAsciiLines,
  REPORT_CARD_ASCII,
  formatPillarReactionBadgesTerminal,
  formatPillarReactionBadgesMarkdown,
  formatPillarShieldBadges,
  resolveBadgeColor,
  PILLAR_EMOJIS,
  PILLAR_SHORT_NAMES,
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildAiSlopPrompt,
  buildHotspotsPrompt,
  buildPillarPrompt,
  buildMasterPrompt,
  deduplicateRolePreambles,
  formatPromptBox,
  formatGroupedPromptViolations,
  createPatternRegistry,
  buildRemediationRoadmap,
  formatRoadmapSection,
  formatRoadmapMarkdown,
  buildSelfHealingRoadmapPrompt
};

export * from './audit/rules-predicates.js';

export default {
  auditFile,
  scanDirectory,
  runAudit,
  formatTerminalReport,
  generateMarkdownReport,
  groupViolationsBySeverity,
  groupViolationsByDirectory,
  groupViolationsByRule,
  formatDirectoryDistributionSection,
  formatDirectoryRollupMarkdown,
  renderGroupedViolationsMarkdown,
  resolveTopSectionColor,
  formatScorecardSection,
  formatAiSlopSection,
  formatCriticalSection,
  formatHighMediumSection,
  formatLowSection,
  formatPillarsSection,
  formatHotspotsSection,
  formatContextAnalysisSection,
  formatFailuresSection,
  formatPassesSection,
  formatGradeFSection,
  formatGradeDSection,
  formatGradeCSection,
  formatGradeBSection,
  formatGradeASection,
  getChemicalXAsciiBanner,
  getAsciiGradeLines,
  formatAsciiGrade,
  getReportCardAsciiLines,
  REPORT_CARD_ASCII,
  formatPillarReactionBadgesTerminal,
  formatPillarReactionBadgesMarkdown,
  formatPillarShieldBadges,
  resolveBadgeColor,
  PILLAR_SHORT_NAMES,
  PILLARS,
  RULE_REGISTRY,
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildAiSlopPrompt,
  buildHotspotsPrompt,
  buildPillarPrompt,
  buildMasterPrompt,
  deduplicateRolePreambles,
  formatPromptBox,
  formatGroupedPromptViolations,
  createPatternRegistry,
  buildRemediationRoadmap,
  formatRoadmapSection,
  formatRoadmapMarkdown,
  buildSelfHealingRoadmapPrompt
};
