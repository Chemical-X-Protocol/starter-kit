import { PILLARS, RULE_REGISTRY } from './rules-registry.js';
import { checkTypographyEmDash, checkMockDataPatterns } from './rules-helpers.js';
import { checkSlopTextPatterns } from './ai-slop-detector.js';
import { checkExtendedTextPatterns } from './extended-visitors.js';
import { recordTemplatePatterns } from './pattern-detector.js';
import { createHookShapeRegistry } from './hook-shape-validator.js';
import { isBabelParsable, getLanguageForFile } from '../languages.js';
import { analyzeCSharpCode } from './csharp-analyzer.js';
import { applyAuditPostFilters } from './suppressions.js';
import { applyRuleOverrides } from './rule-overrides.js';
import { withTaxonomy } from './rule-pillars.js';
import { checkLineBudgets } from './budget-rules.js';
import { auditTemplate } from './template-rules.js';
import { checkTemplateRenderDepth } from './render-depth.js';
import { parseSfc, isSfcFile } from '../sfc/sfc-parse.js';
import { COVERAGE_KINDS, recordFileCoverage } from './coverage.js';
import { parseScriptAsts, runAstPasses } from './ast-passes.js';
import { runTailwindUnscannedPass } from './tailwind-unscanned.js';
import { isPhpPath } from '../php/php-parse.js';
import { analyzePhp } from '../php/php-analyzer.js';
import { detectMinifiedSource } from './minified-detector.js';

export { PILLARS, RULE_REGISTRY, createHookShapeRegistry };

const FULL_CONFIG_KEYS = ['rules', 'overrides', 'wordpress', 'php'];

/**
 * Accepts either a loaded project config (an object with any of rules, overrides, wordpress, php)
 * or a bare rules object. A full config keeps its other keys; rules and overrides default to empty.
 */
const normalizeConfig = (config) => {
  const isObject = Boolean(config) && typeof config === 'object';
  const isFullConfig = isObject && FULL_CONFIG_KEYS.some((key) => key in config);
  return isFullConfig ? { ...config, rules: config.rules ?? {}, overrides: config.overrides ?? [] } : { rules: config || {}, overrides: [] };
};

const parseErrorViolation = (relativePath, line, message) => {
  const meta = RULE_REGISTRY.SYNTAX_PARSE_ERROR;
  return {
    filePath: relativePath,
    line,
    column: 1,
    hazard: `Parse error: ${message}`,
    rule: 'SYNTAX_PARSE_ERROR',
    severity: meta.severity,
    pillar: meta.pillar,
    directive: meta.directive
  };
};

const MEGA_LINE_CHAR_THRESHOLD = 4000;

const maskMegaLines = (lines) => {
  const hasMegaLine = lines.some((line) => line.length > MEGA_LINE_CHAR_THRESHOLD);
  if (!hasMegaLine) return lines;
  return lines.map((line) => (line.length > MEGA_LINE_CHAR_THRESHOLD ? '' : line));
};

const runTextPasses = (content, lines, filePath, relativePath, ruleConfig, violations) => {
  const textLines = maskMegaLines(lines);
  checkTypographyEmDash(content, lines, relativePath, violations);
  checkMockDataPatterns(content, textLines, relativePath, violations);
  checkSlopTextPatterns(content, textLines, relativePath, violations);
  checkExtendedTextPatterns(content, textLines, relativePath, filePath, violations, ruleConfig);
  const isCSharp = getLanguageForFile(filePath)?.id === 'csharp';
  if (isCSharp) analyzeCSharpCode(content, relativePath, violations, ruleConfig);
};

const minifiedBundleViolation = (relativePath, minified) => {
  const meta = RULE_REGISTRY.BUNDLED_MINIFIED_SOURCE;
  const kb = (minified.longLineChars / 1024).toFixed(1);
  return {
    filePath: relativePath,
    line: minified.firstLongLine || 1,
    column: 1,
    hazard: `Minified or bundled script detected (${minified.longLineCount} long line(s), ${kb} KB, max ${minified.maxLineLength} chars)`,
    rule: 'BUNDLED_MINIFIED_SOURCE',
    severity: meta.severity,
    pillar: meta.pillar,
    directive: meta.directive
  };
};

const runSfcTemplatePasses = (sfc, relativePath, options, ruleConfig, violations) => {
  for (const error of sfc.errors) violations.push(parseErrorViolation(relativePath, error.line, `SFC: ${error.message}`));
  const isTemplateMissing = !sfc.template;
  if (isTemplateMissing) return;
  violations.push(...auditTemplate(sfc.template, relativePath));
  violations.push(...checkTemplateRenderDepth(sfc.template, relativePath, ruleConfig));
  const fingerprint = options.fingerprint || null;
  if (fingerprint) fingerprint.addVueTemplate(sfc.template);
  const hasPatternRegistry = Boolean(options.patternRegistry);
  if (hasPatternRegistry) {
    recordTemplatePatterns(options.patternRegistry, sfc.template.content, relativePath, sfc.template.startLine - 1);
  }
};

const describeSfcCoverage = (sfc) => (sfc ? {
  scriptBlocks: sfc.scripts.length,
  hasTemplate: Boolean(sfc.template),
  isTemplateParsed: Boolean(sfc.template?.isParsed)
} : null);

const describeTextOnlyReason = (options) => (options.fast ? 'fast mode: AST rules skipped' : 'no AST parser for this language');

/** PHP never reaches the Babel, SFC or Tailwind passes; analyzePhp owns parsing and its passes. */
const collectPhpViolations = (content, filePath, relativePath, options, config, violations) => {
  const analysis = analyzePhp({ content, filePath, relativePath, options, config, violations });
  const hasHighComplexity = violations.some((v) => v.rule === 'COMPLEXITY_CYCLOMATIC_HIGH');
  violations.push(...checkLineBudgets({ content, relativePath, config: config.rules, sfc: null, hasHighComplexity }));
  const record = { relativePath, kind: analysis.kind, sfc: null, language: 'php', reason: analysis.reason };
  recordFileCoverage(options.coverage, record);
  return {
    violations,
    coverage: { kind: record.kind, language: record.language, reason: record.reason },
    commentRegions: analysis.commentRegions,
    fileHeaderEndLine: analysis.fileHeaderEndLine
  };
};

const collectRawViolations = (content, filePath, relativePath, options, config) => {
  const ruleConfig = config.rules;
  const violations = [];
  let coverageReason = null;
  const lines = content.split('\n');
  runTextPasses(content, lines, filePath, relativePath, ruleConfig, violations);
  const isPhp = isPhpPath(filePath);
  if (isPhp) return collectPhpViolations(content, filePath, relativePath, options, config, violations);

  const sfc = isSfcFile(filePath) ? parseSfc(content, filePath) : null;
  const isAstEligible = !options.fast && isBabelParsable(filePath);
  let coverageKind = isAstEligible ? COVERAGE_KINDS.AST : COVERAGE_KINDS.TEXT_ONLY;
  if (!isAstEligible) coverageReason = describeTextOnlyReason(options);

  const shouldRunSfcPasses = Boolean(isAstEligible && sfc);
  if (shouldRunSfcPasses) runSfcTemplatePasses(sfc, relativePath, options, ruleConfig, violations);
  const code = sfc ? sfc.scriptOverlay : content;
  const hasCode = isAstEligible && code.trim().length > 0;
  const isEmptyScript = isAstEligible && !hasCode && !sfc?.template;
  if (isEmptyScript) coverageKind = COVERAGE_KINDS.EMPTY;

  const minified = hasCode ? detectMinifiedSource(code) : null;
  const isMinifiedBundle = Boolean(minified && minified.isMinified);
  const shouldParseAst = hasCode && !isMinifiedBundle;
  if (isMinifiedBundle) {
    violations.push(minifiedBundleViolation(relativePath, minified));
    coverageKind = COVERAGE_KINDS.TEXT_ONLY;
    coverageReason = 'minified or bundled script skipped for AST passes';
  }
  if (shouldParseAst) {
    const parsed = parseScriptAsts(code, sfc, content, relativePath);
    const hasParseError = Boolean(parsed.error);
    if (hasParseError) {
      violations.push(parseErrorViolation(relativePath, parsed.error.line, parsed.error.message));
      coverageKind = COVERAGE_KINDS.PARSE_ERROR;
      coverageReason = parsed.error.message;
    } else {
      runAstPasses(parsed.asts, { relativePath, violations, ruleConfig, options, code });
      runTailwindUnscannedPass(parsed.asts, { filePath, relativePath, violations, options });
    }
  }

  const hasHighComplexity = violations.some((v) => v.rule === 'COMPLEXITY_CYCLOMATIC_HIGH');
  violations.push(...checkLineBudgets({ content, relativePath, config: ruleConfig, sfc, hasHighComplexity }));
  const record = { relativePath, kind: coverageKind, sfc: describeSfcCoverage(sfc), language: getLanguageForFile(filePath)?.id ?? null, reason: coverageReason };
  recordFileCoverage(options.coverage, record);
  return { violations, coverage: { kind: record.kind, language: record.language, reason: record.reason } };
};

/**
 * Audits one file. options: { config, fast, patternRegistry, hookRegistry, coverage, fingerprint, cwd, tailwindContent }
 * (fingerprint: a Forge collector from cli/forge/fingerprint-visitors.js, or null to skip Forge;
 * cwd: the project root for the Tailwind content probe; tailwindContent: content globs overriding
 * tailwind.config, or null to silence TAILWIND_UNSCANNED_CLASS_STRING).
 * Violations pass through chemx-allow annotations, dedup and per-rule config.
 */
export const auditCode = (content, filePath, relativePath, options = {}) =>
  auditCodeDetailed(content, filePath, relativePath, options).violations;

/**
 * Like auditCode, but also returns this file's coverage record: { violations, coverage: { kind, language, reason } }.
 * The record is built per call, so it does not depend on options.coverage.
 */
export function auditCodeDetailed(content, filePath, relativePath, options = {}) {
  const config = normalizeConfig(options.config);
  const { violations: raw, coverage, commentRegions = null, fileHeaderEndLine = 0 } = collectRawViolations(content, filePath, relativePath, options, config);
  const filtered = applyAuditPostFilters(raw, content.split('\n'), { commentRegions, fileHeaderEndLine });
  const violations = applyRuleOverrides(filtered, relativePath, config).map(withTaxonomy);
  return { violations, coverage };
}
