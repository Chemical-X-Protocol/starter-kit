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

export { PILLARS, RULE_REGISTRY, createHookShapeRegistry };

/** Accepts either a loaded project config ({ rules, overrides }) or a bare rules object. */
const normalizeConfig = (config) => {
  const isFullConfig = Boolean(config?.rules) && typeof config.rules === 'object';
  return isFullConfig ? config : { rules: config || {}, overrides: [] };
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

const runTextPasses = (content, lines, filePath, relativePath, ruleConfig, violations) => {
  checkTypographyEmDash(content, lines, relativePath, violations);
  checkMockDataPatterns(content, lines, relativePath, violations);
  checkSlopTextPatterns(content, lines, relativePath, violations);
  checkExtendedTextPatterns(content, lines, relativePath, filePath, violations, ruleConfig);
  const isCSharp = getLanguageForFile(filePath)?.id === 'csharp';
  if (isCSharp) analyzeCSharpCode(content, relativePath, violations, ruleConfig);
};

const runSfcTemplatePasses = (sfc, relativePath, options, ruleConfig, violations) => {
  for (const error of sfc.errors) violations.push(parseErrorViolation(relativePath, error.line, `SFC: ${error.message}`));
  const isTemplateMissing = !sfc.template;
  if (isTemplateMissing) return;
  violations.push(...auditTemplate(sfc.template, relativePath));
  violations.push(...checkTemplateRenderDepth(sfc.template, relativePath, ruleConfig));
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

const collectRawViolations = (content, filePath, relativePath, options, ruleConfig) => {
  const violations = [];
  const lines = content.split('\n');
  runTextPasses(content, lines, filePath, relativePath, ruleConfig, violations);

  const sfc = isSfcFile(filePath) ? parseSfc(content, filePath) : null;
  const isAstEligible = !options.fast && isBabelParsable(filePath);
  let coverageKind = isAstEligible ? COVERAGE_KINDS.AST : COVERAGE_KINDS.TEXT_ONLY;

  const shouldRunSfcPasses = Boolean(isAstEligible && sfc);
  if (shouldRunSfcPasses) runSfcTemplatePasses(sfc, relativePath, options, ruleConfig, violations);
  const code = sfc ? sfc.scriptOverlay : content;
  const hasCode = isAstEligible && code.trim().length > 0;
  const isEmptyScript = isAstEligible && !hasCode && !sfc?.template;
  if (isEmptyScript) coverageKind = COVERAGE_KINDS.EMPTY;

  if (hasCode) {
    const parsed = parseScriptAsts(code, sfc, content);
    const hasParseError = Boolean(parsed.error);
    if (hasParseError) {
      violations.push(parseErrorViolation(relativePath, parsed.error.line, parsed.error.message));
      coverageKind = COVERAGE_KINDS.PARSE_ERROR;
    } else {
      runAstPasses(parsed.asts, { relativePath, violations, ruleConfig, options });
    }
  }

  const hasHighComplexity = violations.some((v) => v.rule === 'COMPLEXITY_CYCLOMATIC_HIGH');
  violations.push(...checkLineBudgets({ content, relativePath, config: ruleConfig, sfc, hasHighComplexity }));
  recordFileCoverage(options.coverage, { relativePath, kind: coverageKind, sfc: describeSfcCoverage(sfc) });
  return violations;
};

/**
 * Audits one file. options: { config, fast, patternRegistry, hookRegistry, coverage }.
 * Violations pass through chemx-allow annotations, dedup and per-rule config.
 */
export const auditCode = (content, filePath, relativePath, options = {}) => {
  const config = normalizeConfig(options.config);
  const raw = collectRawViolations(content, filePath, relativePath, options, config.rules);
  const filtered = applyAuditPostFilters(raw, content.split('\n'));
  return applyRuleOverrides(filtered, relativePath, config).map(withTaxonomy);
};
