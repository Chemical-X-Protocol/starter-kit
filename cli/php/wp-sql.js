// SECURITY_WP_UNPREPARED_SQL (design spec 4): a $wpdb read or query method whose SQL is not prepared and
// holds a value not known to be safe; a prepare() whose query string holds one; esc_like() without
// prepare; a LIKE wildcard built from an unsafe value without esc_like. A pass is (ctx) => void and
// reports only through ctx.report, at the sink call. Guarantees: a hit names the first reasons the
// classifier gave (wp-sql-classify.js). Not guaranteed: a silent query is safe, or a hit is exploitable.
// Dark until the language flip registers .php.
import { walk, scopeOf } from './php-walk.js';
import { isRequestDerived } from './php-taint.js';
import { createClassifier } from './wp-sql-classify.js';
import { methodOf, isWpdbCall, isPrepareCall, prepareQuery } from './wp-sql-lookup.js';

const RULE = 'SECURITY_WP_UNPREPARED_SQL';
const SINK_METHODS = new Set(['query', 'get_results', 'get_var', 'get_row', 'get_col']);
const ESC_LIKE_REASON = 'esc_like-without-prepare';
const FIX = 'Pass the query through $wpdb->prepare() with placeholders, and cast or allowlist table and column names (Directive 9.D).';

export const RULE_DEFAULTS = {
  // Figures and labels: cli/php/wp-sql.precision.spec.js and the task comments of #6479.
  [RULE]: { defaultOn: false, corpus: '8/9', heldOut: '19/70', measured: '2026-10-24' },
};

const shown = (why) => why.slice(0, 3).join('; ');

function unpreparedHazard(method, why) {
  const onlyEscLike = why.every((w) => w === ESC_LIKE_REASON);
  if (onlyEscLike) return `$wpdb->${method}() runs SQL built around esc_like() without prepare(). esc_like() escapes % and _ only, not quotes. ${FIX}`;
  return `$wpdb->${method}() runs SQL that is not passed through prepare() and holds a value not known to be safe (${shown(why)}). ${FIX}`;
}

function interpolationHazard(why) {
  return `prepare() receives a query string that holds a value not known to be safe (${shown(why)}); placeholders only protect values passed as arguments. ${FIX}`;
}

const LIKE_HAZARD = 'A LIKE pattern is built from a value not known to be safe and is not wrapped in $wpdb->esc_like(), so % and _ in the value act as wildcards (Directive 9.D).';

function stringsIn(node) {
  const parts = [];
  walk(node, (n) => {
    const isText = n.kind === 'string' && typeof n.value === 'string';
    if (isText) parts.push(n.value);
  });
  return parts;
}

function callsEscLike(node) {
  let found = false;
  walk(node, (n) => {
    found = found || (n.kind === 'call' && methodOf(n) === 'esc_like');
  });
  return found;
}

/** Arguments after the query that add a % wildcard around a value not known to be safe, with no esc_like. */
function wildcardArguments(call, classifier) {
  const query = prepareQuery(call);
  const isLike = Boolean(query) && /\bLIKE\b/i.test(stringsIn(query).join(' '));
  const rest = isLike ? call.arguments.slice(1) : [];
  return rest.filter((arg) => stringsIn(arg).some((s) => s.includes('%')) && !callsEscLike(arg) && classifier.reasons(arg).length > 0);
}

function severityFor(expr, node, classifier) {
  const scope = scopeOf(node);
  const idx = scope ? classifier.scopeIndex(scope) : null;
  return idx && isRequestDerived(expr, idx) ? 'CRITICAL' : 'HIGH';
}

function checkSink(ctx, node, classifier) {
  const query = node.arguments[0];
  const why = query ? classifier.reasons(query) : [];
  const isClean = why.length === 0;
  if (isClean) return;
  ctx.report(RULE, node, unpreparedHazard(methodOf(node), why), { severity: severityFor(query, node, classifier), evidence: shown(why) });
}

function checkPrepare(ctx, node, classifier) {
  const query = prepareQuery(node);
  const why = query ? classifier.reasons(query) : [];
  const isUnsafe = why.length > 0;
  if (isUnsafe) {
    ctx.report(RULE, node, interpolationHazard(why), { severity: severityFor(query, node, classifier), evidence: shown(why) });
    return;
  }
  const wild = wildcardArguments(node, classifier);
  const hasWildcard = wild.length > 0;
  if (hasWildcard) ctx.report(RULE, node, LIKE_HAZARD, { severity: severityFor(wild[0], node, classifier), evidence: 'LIKE argument with a % wildcard and no esc_like' });
}

function checkCall(ctx, node, classifier) {
  const isSink = SINK_METHODS.has(methodOf(node)) && isWpdbCall(node);
  const isPrepare = isPrepareCall(node);
  if (isSink) checkSink(ctx, node, classifier);
  if (isPrepare) checkPrepare(ctx, node, classifier);
}

/** Pass entry. At most one finding per sink or prepare call; silent on files with no $wpdb call. */
export function wpSqlPass(ctx) {
  const classifier = createClassifier(ctx);
  walk(ctx.ast, (node) => {
    const isCall = node.kind === 'call';
    if (isCall) checkCall(ctx, node, classifier);
  });
}

/** The entry the language flip adds to PASSES. */
export const wpSqlRegistration = { name: 'wp-sql', rules: [RULE], isWordPress: true, run: wpSqlPass };
