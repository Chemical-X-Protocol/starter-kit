// PHP branch of the audit rule runner (design spec 3.4 and 3.5).
// Parses with php-parser (loaded lazily by php-parse.js), runs the PHP passes and finalizes their
// reports. Reached only from collectRawViolations for .php files.
import os from 'node:os';
import path from 'node:path';
import { parsePhp } from './php-parse.js';
import { linkParents } from './php-walk.js';
import { buildPhpCommentRegions, phpHeaderEndLine } from './php-comments.js';
import { RULE_REGISTRY } from '../audit/rules-registry.js';
import { resolveRuleSettings } from '../audit/rule-overrides.js';
import { detectWordPress } from './wp-detect.js';
import { getProjectIndex } from './wp-project-index.js';
import { indexPathOf } from './wp-rest-endpoints.js';
import { metricsPass, RULE_DEFAULTS as METRICS_DEFAULTS } from './php-metrics.js';
import { controlFlowPass, RULE_DEFAULTS as CONTROL_FLOW_DEFAULTS } from './php-control-flow.js';
import { catchPass, RULE_DEFAULTS as CATCH_DEFAULTS } from './php-catch.js';
import { loggingPass, RULE_DEFAULTS as LOGGING_DEFAULTS } from './php-logging.js';
import { runDangerousPass, RULE_DEFAULTS as DANGEROUS_DEFAULTS } from './php-dangerous.js';
import { wpRouteRegistrations, RULE_DEFAULTS as ROUTE_DEFAULTS } from './wp-route-rules.js';
import { wpNonceRegistration, RULE_DEFAULTS as NONCE_DEFAULTS } from './wp-nonce.js';
import { wpSqlRegistration, RULE_DEFAULTS as SQL_DEFAULTS } from './wp-sql.js';
import { wpRequestFlowRegistration, RULE_DEFAULTS as REQUEST_FLOW_DEFAULTS } from './wp-request-flow.js';
import { wpOutputRegistration, RULE_DEFAULTS as OUTPUT_DEFAULTS } from './wp-output.js';
import { wpAuthFiltersRegistration, RULE_DEFAULTS as AUTH_FILTER_DEFAULTS } from './wp-auth-filters.js';
import { wpRegistrationRegistration, RULE_DEFAULTS as REGISTRATION_DEFAULTS } from './wp-registration.js';

/**
 * AI_SLOP_ECHO_COMMENT matched 7 of 12 labelled PHP hits (58% precision, spec section 2.4),
 * under the 80% default-on bar, so its findings are dropped for .php files.
 */
export const PHP_DROPPED_TEXT_RULES = Object.freeze(['AI_SLOP_ECHO_COMMENT']);

/** Every PHP rule family's measured default (spec 3.3): { RULE_ID: { defaultOn, corpus, heldOut, measured } }. */
export const PHP_RULE_DEFAULTS = Object.freeze({
  ...METRICS_DEFAULTS, ...CONTROL_FLOW_DEFAULTS, ...CATCH_DEFAULTS, ...LOGGING_DEFAULTS, ...DANGEROUS_DEFAULTS,
  ...ROUTE_DEFAULTS, ...NONCE_DEFAULTS, ...SQL_DEFAULTS, ...REQUEST_FLOW_DEFAULTS, ...OUTPUT_DEFAULTS, ...AUTH_FILTER_DEFAULTS, ...REGISTRATION_DEFAULTS,
});

const isOffForPhpOnly = ([rule, measured]) => measured.defaultOn === false && RULE_REGISTRY[rule]?.isDefaultOff !== true;

/**
 * Reused rule ids that are off for PHP findings until a setting names them: the ids whose PHP family
 * measured them under the bar while the registry keeps them on for other languages. New PHP ids carry
 * isDefaultOff in the registry instead. Applies to what the PHP passes report, not to text-pass findings.
 */
export const PHP_DEFAULT_OFF = new Set(Object.entries(PHP_RULE_DEFAULTS).filter(isOffForPhpOnly).map(([rule]) => rule));

const rulesOf = (defaults) => Object.keys(defaults);

/** Passes that run on every parsed .php file. */
const GENERIC_PASSES = [
  { name: 'php-metrics', rules: rulesOf(METRICS_DEFAULTS), run: metricsPass },
  { name: 'php-control-flow', rules: rulesOf(CONTROL_FLOW_DEFAULTS), run: controlFlowPass },
  { name: 'php-catch', rules: rulesOf(CATCH_DEFAULTS), run: catchPass },
  { name: 'php-logging', rules: rulesOf(LOGGING_DEFAULTS), run: loggingPass },
  { name: 'php-dangerous', rules: rulesOf(DANGEROUS_DEFAULTS), run: runDangerousPass },
];

/** Passes that run only when ctx.wp.isWordPress (each registration sets isWordPress: true). */
const WORDPRESS_PASSES = [
  ...wpRouteRegistrations, wpNonceRegistration, wpSqlRegistration, wpRequestFlowRegistration, wpOutputRegistration,
  wpAuthFiltersRegistration, wpRegistrationRegistration,
];

/** The shipped pass list, in run order. A pass is { name, rules: [ids it can emit], isWordPress?: true, run(ctx) }. */
export const DEFAULT_PASSES = Object.freeze([...GENERIC_PASSES, ...WORDPRESS_PASSES]);

/** The pass list analyzePhp runs. Starts as DEFAULT_PASSES; specs may swap entries and restore them. */
export const PASSES = [...DEFAULT_PASSES];

const DEFAULT_PHP_TARGET = '8.3';
const FALLBACK_SEVERITY = 'MEDIUM';
const NO_ROOT_DIR = path.join(os.tmpdir(), '__chemx_no_wp_root__');
const INDEX_CAPPED = 'wp-index-capped';

const unregisteredDrops = new Map();

/** Reports dropped because their rule id is not in RULE_REGISTRY, per id, since the last reset. */
export function unregisteredRuleDrops() {
  return Object.fromEntries(unregisteredDrops);
}

/** Clears the unregistered-id counts (tests). */
export function resetUnregisteredRuleDrops() {
  unregisteredDrops.clear();
}

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

const SPANNING_RULES = new Set(['ERROR_SWALLOWED_EXCEPTION', 'AI_SLOP_SHALLOW_CATCH']);

const countUnregistered = (rule) => unregisteredDrops.set(rule, (unregisteredDrops.get(rule) ?? 0) + 1);

// An unregistered id is dropped and counted, never thrown; a rule that is off for this file is dropped.
// Only a catch finding spans its node (endLine), so chemx-allow inside the catch applies (spec 3.6); other rules anchor to their start line.
const createReporter = (violations, relativePath, settings) => (rule, nodeOrLine, hazard, extra = {}) => {
  const isRegistered = Boolean(RULE_REGISTRY[rule]);
  if (!isRegistered) {
    countUnregistered(rule);
    return;
  }
  if (isRuleOff(rule, settings)) return;
  const isLine = typeof nodeOrLine === 'number';
  const loc = isLine ? null : nodeOrLine?.loc;
  const line = isLine ? nodeOrLine : (loc?.start?.line ?? 1);
  const column = loc?.start ? loc.start.column : 0;
  const span = SPANNING_RULES.has(rule) && loc?.end ? { endLine: loc.end.line } : {};
  violations.push(finalize({ rule, line, column, ...span, hazard, ...extra }, relativePath));
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

/**
 * ctx.wp: the detectWordPress result when it says WordPress, else null. With `wordpress: true` the
 * detector names no root, so the on-disk detection is asked for one; a file off disk keeps root null.
 */
function wordPressContext(filePath, config, ast, scanRoot) {
  const wp = detectWordPress(filePath, { scanRoot, config, ast });
  if (!wp.isWordPress) return null;
  const isForcedWithoutRoot = !wp.root && config.wordpress === true;
  const found = isForcedWithoutRoot ? detectWordPress(filePath, { scanRoot, ast }) : null;
  return found?.root ? { isWordPress: true, root: found.root, kind: found.kind } : wp;
}

/**
 * The per-plugin index for a WordPress file when cross-file analysis is on. The root is the WordPress
 * root, or the scan root when detection found none. The overlay is options.overlay when given (the
 * task-done gate pins its target at HEAD), else the audited content under the path the passes use.
 */
function projectIndexFor(ctx, overlay) {
  const isIndexed = Boolean(ctx.wp) && ctx.crossFile;
  if (!isIndexed) return null;
  const audited = { relativePath: indexPathOf(ctx), content: ctx.content };
  // No detected root: the index holds the audited file only, never a listing of the working directory.
  return getProjectIndex(ctx.wp.root || NO_ROOT_DIR, { overlay: overlay ?? audited });
}

const runPasses = (ctx, settings) => {
  for (const pass of PASSES) {
    if (!isPassSkipped(pass, settings, ctx.wp)) pass.run(ctx);
  }
};

/**
 * Analyzes one PHP file. Pushes findings onto `violations` and returns
 * { kind, reason, commentRegions, fileHeaderEndLine }: the coverage kind ('ast', 'parse-error' or
 * 'text-only') with its reason, and the comment data for applyAuditPostFilters. options.overlay
 * ({ relativePath, content }) reaches passes as ctx.overlay and replaces that file in the project
 * index: the task-done gate uses it to audit a dependent with its target at HEAD. options.cwd is the
 * scan root for WordPress detection (default process.cwd()). Guarantees only what ran: with
 * options.fast, an unavailable parser or a minified file no pass runs (text-only), and comment regions
 * are null so the line scanner is used. WordPress passes run only when ctx.wp is set; with
 * options.crossFile false ctx.index is null and passes that need it stay silent. Coverage reason
 * 'wp-index-capped' means the index held only the audited file.
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
  const scanRoot = path.resolve(options.cwd || process.cwd());
  const ctx = {
    ast: parsed.ast,
    content,
    lines,
    filePath,
    relativePath,
    config,
    settings,
    phpTarget: config.php?.version || DEFAULT_PHP_TARGET,
    wp: wordPressContext(filePath, config, parsed.ast, scanRoot),
    index: null,
    crossFile: options.crossFile !== false,
    overlay: options.overlay ?? null,
    report: createReporter(violations, relativePath, settings)
  };
  ctx.index = projectIndexFor(ctx, options.overlay);
  runPasses(ctx, settings);
  return {
    kind: 'ast',
    reason: ctx.index?.capped ? INDEX_CAPPED : null,
    commentRegions: buildPhpCommentRegions(parsed.comments, lines),
    fileHeaderEndLine: phpHeaderEndLine(parsed.ast, parsed.comments, lines)
  };
}
