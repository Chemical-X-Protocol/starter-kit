// PHP branch of the audit rule runner (design spec 3.4 and 3.5).
// Parses with php-parser (loaded lazily by php-parse.js), runs the registered PHP passes and
// finalizes their reports. Reached only from collectRawViolations for .php files.
import { parsePhp } from './php-parse.js';
import { linkParents } from './php-walk.js';
import { buildPhpCommentRegions, phpHeaderEndLine } from './php-comments.js';
import { RULE_REGISTRY } from '../audit/rules-registry.js';
import { resolveRuleSettings } from '../audit/rule-overrides.js';

/**
 * AI_SLOP_ECHO_COMMENT matched 7 of 12 labelled PHP hits (58% precision, spec section 2.4),
 * under the 80% default-on bar, so its findings are dropped for .php files.
 */
export const PHP_DROPPED_TEXT_RULES = Object.freeze(['AI_SLOP_ECHO_COMMENT']);

/** Rules that are off for PHP until a setting names them (empty until a rule family needs it). */
export const PHP_DEFAULT_OFF = new Set();

/**
 * The PHP passes, run in order on every parsed .php file. A pass is
 * { name, rules: [ids it can emit], isWordPress?: true, run(ctx) }; empty until T15b registers them.
 */
export const PASSES = [];

const DEFAULT_PHP_TARGET = '8.3';
const FALLBACK_SEVERITY = 'MEDIUM';

const isRuleOff = (rule, settings) => {
  const setting = settings[rule];
  const isNamed = Boolean(setting);
  if (isNamed) return setting === 'off';
  return RULE_REGISTRY[rule]?.isDefaultOff === true || PHP_DEFAULT_OFF.has(rule);
};

const isPassSkipped = (pass, settings, wp) => {
  const isWordPressOnly = pass.isWordPress === true;
  const isMissingWordPress = isWordPressOnly && !wp?.isWordPress;
  if (isMissingWordPress) return true;
  const rules = pass.rules ?? [];
  const areAllRulesOff = rules.every((rule) => isRuleOff(rule, settings));
  return rules.length > 0 && areAllRulesOff;
};

const finalize = (record, relativePath) => {
  const meta = RULE_REGISTRY[record.rule];
  return {
    ...record,
    filePath: relativePath,
    severity: record.severity ?? meta?.severity ?? FALLBACK_SEVERITY,
    ...(meta ? { pillar: meta.pillar, directive: meta.directive } : {})
  };
};

const syntaxErrorRecord = (relativePath, error) => finalize({
  rule: 'SYNTAX_PARSE_ERROR',
  line: error.line,
  column: error.column,
  hazard: `Parse error: ${error.message}`
}, relativePath);

const createReporter = (violations, relativePath) => (rule, nodeOrLine, hazard, extra = {}) => {
  const isLine = typeof nodeOrLine === 'number';
  const start = isLine ? null : nodeOrLine?.loc?.start;
  const line = isLine ? nodeOrLine : (start?.line ?? 1);
  const column = start ? start.column : 0;
  violations.push(finalize({ rule, line, column, hazard, ...extra }, relativePath));
};

const dropTextRules = (violations) => {
  for (let i = violations.length - 1; i >= 0; i -= 1) {
    const isDropped = PHP_DROPPED_TEXT_RULES.includes(violations[i].rule);
    if (isDropped) violations.splice(i, 1);
  }
};

const textOnly = (reason) => ({ kind: 'text-only', reason, commentRegions: null, fileHeaderEndLine: 0 });

// A file with a syntax error still gets comment regions from the lenient parse, so chemx-allow works.
const regionsForBrokenFile = (content, filePath, lines) => {
  const lenient = parsePhp(content, { filePath, suppressErrors: true });
  if (!lenient.ast) return { commentRegions: null, fileHeaderEndLine: 0 };
  return {
    commentRegions: buildPhpCommentRegions(lenient.comments, lines),
    fileHeaderEndLine: phpHeaderEndLine(lenient.ast, lenient.comments, lines)
  };
};

const runPasses = (ctx, settings) => {
  for (const pass of PASSES) {
    if (!isPassSkipped(pass, settings, ctx.wp)) pass.run(ctx);
  }
};

/**
 * Analyzes one PHP file. Pushes findings onto `violations` and returns
 * { kind, reason, commentRegions, fileHeaderEndLine }: the coverage kind ('ast', 'parse-error' or
 * 'text-only') with its reason, and the comment data for applyAuditPostFilters. Guarantees only what
 * ran: with options.fast, an unavailable parser or a minified file no pass runs (text-only), and
 * comment regions are null so the line scanner is used.
 */
export function analyzePhp({ content, filePath, relativePath, options = {}, config = {}, violations }) {
  dropTextRules(violations);
  if (options.fast) return textOnly('fast');
  const parsed = parsePhp(content, { filePath });
  if (parsed.unavailable) return textOnly('parser-unavailable');
  if (parsed.skipped) return textOnly(parsed.skipped);
  const lines = content.split('\n');
  if (parsed.error) {
    violations.push(syntaxErrorRecord(relativePath, parsed.error));
    return { kind: 'parse-error', reason: parsed.error.message, ...regionsForBrokenFile(content, filePath, lines) };
  }
  linkParents(parsed.ast);
  const settings = resolveRuleSettings(relativePath, config);
  const ctx = {
    ast: parsed.ast,
    content,
    lines,
    filePath,
    relativePath,
    config,
    settings,
    phpTarget: config.php?.version || DEFAULT_PHP_TARGET,
    wp: null,
    index: null,
    crossFile: options.crossFile !== false,
    report: createReporter(violations, relativePath)
  };
  runPasses(ctx, settings);
  return {
    kind: 'ast',
    reason: null,
    commentRegions: buildPhpCommentRegions(parsed.comments, lines),
    fileHeaderEndLine: phpHeaderEndLine(parsed.ast, parsed.comments, lines)
  };
}
