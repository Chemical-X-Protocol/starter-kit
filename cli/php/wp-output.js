// SECURITY_WP_UNESCAPED_OUTPUT (design spec 4): echo, <?= and print of a value that is not a literal, a
// constant, a numeric cast or an escaper result. Ships default-off: with the rule on, MEDIUM, and HIGH
// when a request value reaches the output in the same function (php-taint.js). A pass is (ctx) => void
// and reports only through ctx.report. Dark until the language flip registers .php.
//
// Not covered in v1: printf and _e, output through functions that echo for the caller, and escaping
// done earlier in another function. A function that sends a non-HTML Content-Type header is skipped.
import { walk, scopeOf, walkScope, callName, literalString } from './php-walk.js';
import { createScopeIndex, isRequestDerived } from './php-taint.js';

const RULE = 'SECURITY_WP_UNESCAPED_OUTPUT';

// Section 2.6: corpus 8/10 labelled sample; held-out not measured. Below the bar, so the rule ships off.
export const RULE_DEFAULTS = {
  [RULE]: { defaultOn: false, corpus: '8/10', heldOut: '0/0', measured: '2026-10-24' },
};

const ESCAPERS = new Set([
  'esc_html', 'esc_attr', 'esc_url', 'esc_textarea', 'esc_js', 'esc_xml', 'esc_html__', 'esc_attr__', 'esc_html_x', 'esc_attr_x',
  'esc_url_raw', 'wp_kses', 'wp_kses_post', 'wp_kses_data', 'wp_kses_one_attr', 'absint', 'intval', 'floatval', 'boolval',
  'number_format', 'number_format_i18n', 'wp_json_encode', 'count', 'sanitize_html_class', 'tag_escape', 'checked', 'selected',
  'disabled', 'readonly', 'wp_readonly', 'get_avatar', 'wp_nonce_field', 'submit_button', 'get_submit_button', 'paginate_links',
  'wp_dropdown_categories', 'wp_dropdown_pages', 'wp_dropdown_users', 'wp_editor', 'do_shortcode', 'get_the_password_form',
  'wp_login_form', 'wp_generate_password', 'wp_create_nonce', 'date', 'gmdate', 'current_time', 'wp_date', 'date_i18n',
  'get_the_id', 'get_current_user_id', 'mysql2date',
]);

const LITERAL_KINDS = new Set(['string', 'nowdoc', 'number', 'boolean', 'nullkeyword', 'magic', 'name', 'unary', 'isset', 'empty']);
const NUMERIC_CASTS = new Set(['int', 'float', 'bool', 'double', 'integer', 'boolean']);
const SAFE_OPERATORS = new Set(['+', '-', '*', '/', '%', '<', '>', '==', '===', '!=', '!==', '&&', '||', '<=', '>=', '<=>']);
const ID_PROPERTIES = new Set(['ID', 'id', 'term_id', 'count', 'post_count']);
const NON_HTML_TYPE = /content-type:\s*(text\/plain|application\/(json|xml|rss\+xml|javascript)|image\/svg|text\/(xml|css|csv|javascript))/i;

const HAZARD = 'This output is not escaped. Wrap it in esc_html(), esc_attr(), esc_url() or wp_kses_post() at the point of output (Directive 9.D).';

// Each handler pushes the sub-expressions that reach the output unescaped.
function collectEncapsed(node, out) {
  for (const part of node.value || []) collectUnescaped(part.expression, out);
}

function collectBinary(node, out) {
  if (SAFE_OPERATORS.has(node.type)) return;
  collectUnescaped(node.left, out);
  collectUnescaped(node.right, out);
}

function collectTernary(node, out) {
  collectUnescaped(node.trueExpr || node.test, out);
  collectUnescaped(node.falseExpr, out);
}

function collectCast(node, out) {
  if (!NUMERIC_CASTS.has(node.type)) collectUnescaped(node.expr, out);
}

function collectCall(node, out) {
  const info = callName(node);
  const isEscaper = Boolean(info) && info.kind === 'function' && ESCAPERS.has(info.name.toLowerCase());
  if (!isEscaper) out.push(node);
}

function collectProperty(node, out) {
  const isIdentifier = Boolean(node.offset) && node.offset.kind === 'identifier';
  const isIdProperty = isIdentifier && ID_PROPERTIES.has(node.offset.name);
  if (!isIdProperty) out.push(node);
}

function collectStatic(node, out) {
  const isClassConstant = Boolean(node.offset) && node.offset.kind === 'identifier';
  if (!isClassConstant) out.push(node);
}

const COLLECTORS = {
  encapsed: collectEncapsed,
  bin: collectBinary,
  retif: collectTernary,
  cast: collectCast,
  call: collectCall,
  propertylookup: collectProperty,
  nullsafepropertylookup: collectProperty,
  staticlookup: collectStatic,
};

function collectUnescaped(node, out) {
  const isSafe = !node || LITERAL_KINDS.has(node.kind);
  if (isSafe) return;
  const collect = COLLECTORS[node.kind] || ((leaf, parts) => parts.push(leaf));
  collect(node, out);
}

// ---- guards --------------------------------------------------------------------------------

/** True when the function sends a non-HTML Content-Type header, so its echoes are not markup. */
function sendsNonHtml(scope) {
  let found = false;
  walkScope(scope, (node) => {
    const info = node.kind === 'call' ? callName(node) : null;
    const isHeader = Boolean(info) && info.kind === 'function' && info.name.toLowerCase() === 'header';
    const text = isHeader ? literalString(node.arguments[0]) : null;
    found = found || (text !== null && NON_HTML_TYPE.test(text));
  });
  return found;
}

function outputExpressions(node) {
  const byKind = { echo: () => node.expressions || [], print: () => [node.expression] };
  const list = byKind[node.kind];
  return list ? list() : null;
}

function scopeDataOf(cache, node) {
  const scope = scopeOf(node);
  if (!cache.has(scope)) cache.set(scope, { idx: createScopeIndex(scope), nonHtml: sendsNonHtml(scope) });
  return cache.get(scope);
}

function checkOutput(ctx, cache, node) {
  const expressions = outputExpressions(node);
  if (!expressions) return;
  const unescaped = [];
  for (const expression of expressions) collectUnescaped(expression, unescaped);
  const data = unescaped.length > 0 ? scopeDataOf(cache, node) : null;
  const isReportable = Boolean(data) && !data.nonHtml;
  if (!isReportable) return;
  const fromRequest = unescaped.some((part) => isRequestDerived(part, data.idx, { mode: 'last' }));
  ctx.report(RULE, node, HAZARD, { severity: fromRequest ? 'HIGH' : 'MEDIUM' });
}

/** Pass entry. Silent outside WordPress; one finding per echo or print statement. */
export function wpOutputPass(ctx) {
  const isReady = Boolean(ctx.wp) && ctx.wp.isWordPress === true;
  if (!isReady) return;
  const cache = new Map();
  walk(ctx.ast, (node) => checkOutput(ctx, cache, node));
}

/** The entry the language flip adds to PASSES. */
export const wpOutputRegistration = { name: 'wp-output', rules: [RULE], isWordPress: true, run: wpOutputPass };
