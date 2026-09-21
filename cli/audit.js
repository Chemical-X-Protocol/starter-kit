import fs from 'node:fs';
import path from 'node:path';
import { auditCode, PILLARS, RULE_REGISTRY, createHookShapeRegistry } from './audit/rules.js';
import { createPatternRegistry } from './audit/pattern-detector.js';
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

const EXCLUDED_NAME_PATTERNS = ['.test.', '.spec.', '.min.'];

const isSourceFile = (name) => {
  const isExtensionValid = /\.(tsx|ts|jsx|js|vue)$/.test(name);
  if (!isExtensionValid) return false;
  if (name.endsWith('.d.ts')) return false;
  const isExcluded = EXCLUDED_NAME_PATTERNS.some((pat) => name.includes(pat));
  return !isExcluded;
};

export const auditFile = (filePath, relativePath) => {
  if (!isSourceFile(path.basename(filePath))) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  return auditCode(content, filePath, relativePath);
};

const auditFileEntry = (fullPath, relPath, scanOptions) => {
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');
  const baseName = path.basename(fullPath);
  const isMolecule = relPath.includes('molecules') || relPath.includes('/m-') || baseName.startsWith('m-');

  const fileStat = {
    fullPath,
    relativePath: relPath,
    lineCount: lines.length,
    charCount: content.length,
    isMolecule
  };

  const hookMatches = content.match(/\buse[A-Z0-9]\w*\b/g);
  const hookCount = hookMatches ? hookMatches.length : 0;
  const fileViolations = auditCode(content, fullPath, relPath, {
    patternRegistry: scanOptions.patternRegistry,
    hookRegistry: scanOptions.hookRegistry,
    fast: scanOptions.fast
  });

  return { fileStat, hookCount, fileViolations };
};

export const scanTree = (targetDir, baseDir, scanOptions = {}) => {
  let violations = [];
  let fileStats = [];
  let totalHooks = 0;

  if (scanOptions.fileList && scanOptions.fileList.length > 0) {
    for (const item of scanOptions.fileList) {
      const fullPath = path.isAbsolute(item) ? item : path.resolve(baseDir, item);
      const relPath = path.relative(baseDir, fullPath);
      if (fs.existsSync(fullPath) && isSourceFile(path.basename(fullPath))) {
        const result = auditFileEntry(fullPath, relPath, scanOptions);
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
        const sub = scanTree(fullPath, baseDir, scanOptions);
        violations = violations.concat(sub.violations);
        fileStats = fileStats.concat(sub.fileStats);
        totalHooks += sub.totalHooks;
      }
    } else if (isSourceFile(entry.name)) {
      const result = auditFileEntry(fullPath, relPath, scanOptions);
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
  const { violations, fileStats, totalHooks } = scanTree(absoluteTarget, cwd, {
    patternRegistry,
    hookRegistry,
    fast: Boolean(options.fast),
    fileList: options.fileList || null
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
      if (f.lineCount <= 100) {
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
  const patterns = patternRegistry.resolveHarmonizationCandidates(hotspots);
  const roadmap = buildRemediationRoadmap({ hotspots, violations, patterns });

  const stage = options.stage || (options.relax ? 'draft' : 'strict');

  const report = {
    targetDir,
    stage,
    options,
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
