// Request-flow rules for WordPress PHP (design spec 4): SECURITY_WP_UNSANITIZED_INPUT (sink variant,
// superglobal sources), SECURITY_WP_SSRF and SECURITY_WP_OPEN_REDIRECT. A pass is (ctx) => void and
// reports only through ctx.report. Dark until the language flip registers .php.
//
// Guarantees: a flow is seen only inside one function scope (php-taint.js), plus one hop through a
// callee that ctx.index resolves: a call whose argument can choose a URL host is reported when that
// callee's matching parameter reaches a URL sink in its own body. Not seen: flows through a second
// call, through properties or references, through callees the index cannot resolve, and URL sinks
// reached with a request value that is only a path or query part.
import path from 'node:path';
import { walk, scopeOf, walkScope, callName, literalString, nodeLine, linkParents } from './php-walk.js';
import { createScopeIndex, isRequestDerived, isRequestObjectSource, hostTaint } from './php-taint.js';

const INPUT = 'SECURITY_WP_UNSANITIZED_INPUT';
const SSRF = 'SECURITY_WP_SSRF';
const REDIRECT = 'SECURITY_WP_OPEN_REDIRECT';

// Section 2.6. Corpus figures are the labelled hits of the 2026-10-24 u2 run (8 URL-sink hits, 9 input hits,
// one input hit a known false positive); weights are in wp-request-flow.precision.spec.js. A rerun of this
// pass over the corpus on the same day reported 6 URL-sink findings (all judged true) and 10 input findings:
// the 9 labelled ones plus magic-wand-admin.php:346, which is unlabelled and not counted.
// Held-out figures (task #6673, 2026-10-24) are hand-labelled hits of this pass run file by file, without the
// project index (so the hop through a callee was not exercised), over H1 = the card vault plugin at HEAD
// (26 files, 0 hits) and H2 = 30 git-ignored third-party plugins under wp-content/plugins, vendor/ excluded
// (57 input, 3 SSRF and 4 redirect hits). 31 input hits were labelled by reading the code (7 true: unescaped
// $_REQUEST echoes, an unsanitized option write, a request-chosen method name, SQL built from a request
// host; 24 false: values already passed through a sanitizer the pass does not know, an allowlist or a
// same-site redirect). All 3 SSRF and all 4 redirect hits were labelled (1 and 3 true). One redirect hit,
// WooCommerce's OAuth return_url, is counted false because the arbitrary return URL is by design; counted
// true it would read 4/4. The samples are small and labelled by one reader.
// A rule ships on only when both corpus and held-out precision are 80% or better: none does, so all three
// default to off.
export const RULE_DEFAULTS = {
  [INPUT]: { defaultOn: false, corpus: '8/9', heldOut: '7/31', measured: '2026-10-24' },
  [SSRF]: { defaultOn: false, corpus: '8/8', heldOut: '1/3', measured: '2026-10-24' },
  [REDIRECT]: { defaultOn: false, corpus: '8/8', heldOut: '3/4', measured: '2026-10-24' },
};

// ---- sink tables -------------------------------------------------------------------------

/** Function name (lower case) to the rule its first argument can trigger. wp_safe_* forms are absent on purpose. */
const URL_SINKS = new Map([
  ['wp_remote_get', SSRF], ['wp_remote_post', SSRF], ['wp_remote_request', SSRF], ['wp_remote_head', SSRF],
  ['download_url', SSRF], ['file_get_contents', SSRF], ['fopen', SSRF], ['curl_init', SSRF],
  ['media_sideload_image', SSRF], ['getimagesize', SSRF], ['wp_redirect', REDIRECT],
]);

/** Function name to the argument positions that are sinks for a superglobal value. Object ids are never listed. */
const FUNCTION_SINK_ARGS = new Map([
  ['update_option', [1]], ['add_option', [1]], ['update_site_option', [1]], ['update_network_option', [1]],
  ['update_metadata', [3]], ['add_metadata', [3]],
  ['header', [0]], ['setcookie', [1]], ['file_put_contents', [0, 1]], ['unserialize', [0]], ['extract', [0]],
  ['call_user_func', [0]], ['call_user_func_array', [0]],
]);
for (const type of ['post', 'user', 'term', 'comment']) {
  FUNCTION_SINK_ARGS.set(`add_${type}_meta`, [2]);
  FUNCTION_SINK_ARGS.set(`update_${type}_meta`, [2]);
}

const POST_WRITERS = new Set(['wp_insert_post', 'wp_update_post']);
// $wpdb insert, update, replace and delete bind their values, so only the SQL-text methods are sinks.
const WPDB_TEXT_METHODS = new Set(['query', 'get_results', 'get_var', 'get_row', 'get_col']);

const BOTH_SOURCES = { sources: ['superglobal', 'request'], mode: 'union' };
const INPUT_OPTIONS = { sources: ['superglobal'], mode: 'last' };
// A stand-in for `$_GET['x']`, planted as a parameter's definition to ask whether the parameter reaches a sink.
const SEED = Object.freeze({
  kind: 'offsetlookup',
  what: Object.freeze({ kind: 'variable', name: '_GET' }),
  offset: Object.freeze({ kind: 'string', value: 'x' }),
});

const HAZARDS = {
  input: (label) => `A superglobal value reaches ${label} with no sanitizer on the way. Sanitize it first, for example sanitize_text_field( wp_unslash( ... ) ) or an absint cast, or validate it against a fixed list (Directive 9.D).`,
  [SSRF]: (sink) => `A request value can choose the host of the URL passed to ${sink}(). Validate it with wp_http_validate_url(), build the URL from a fixed base, or use wp_safe_remote_*() (Directive 9.D).`,
  [REDIRECT]: (sink) => `A request value can choose the host of the URL passed to ${sink}(). Validate it with wp_validate_redirect() or use wp_safe_redirect() (Directive 9.D).`,
};

// ---- input sinks ---------------------------------------------------------------------------

function isWpdbReceiver(inner) {
  const isNode = Boolean(inner) && typeof inner === 'object';
  if (!isNode) return false;
  const direct = inner.kind === 'variable' && inner.name === 'wpdb';
  const prop = inner.kind === 'propertylookup' && inner.offset ? inner.offset.name : null;
  return direct || prop === 'wpdb' || prop === 'db';
}

function postContentArgs(node) {
  const first = node.arguments[0];
  const items = first && first.kind === 'array' ? first.items || [] : [];
  const entries = items.filter((item) => item && item.kind === 'entry' && literalString(item.key) === 'post_content');
  return entries.map((item) => item.value);
}

function wpdbSink(node, info) {
  const name = info.name.toLowerCase();
  const isText = WPDB_TEXT_METHODS.has(name) && isWpdbReceiver(node.what.what);
  return isText ? { label: `$wpdb->${name}()`, args: node.arguments.slice(0, 1) } : null;
}

function functionSink(node, name) {
  const positions = FUNCTION_SINK_ARGS.get(name);
  if (POST_WRITERS.has(name)) return { label: `${name}() content`, args: postContentArgs(node) };
  const args = positions ? positions.map((i) => node.arguments[i]).filter(Boolean) : [];
  return positions ? { label: `${name}()`, args } : null;
}

function callSink(node) {
  const info = callName(node);
  if (!info) return null;
  const byKind = {
    method: () => wpdbSink(node, info),
    function: () => functionSink(node, info.name.toLowerCase()),
  };
  const sinkOf = byKind[info.kind];
  return sinkOf ? sinkOf() : null;
}

const INPUT_SINKS = {
  call: callSink,
  echo: (node) => ({ label: 'echo', args: node.expressions || [] }),
  print: (node) => ({ label: 'print', args: [node.expression] }),
  include: (node) => ({ label: 'include or require', args: [node.target] }),
};

// ---- per-scope data ------------------------------------------------------------------------

const isTmpName = (node) => Boolean(node) && node.kind === 'offsetlookup' && literalString(node.offset) === 'tmp_name';

/** Variables assigned from a ['tmp_name'] lookup: an uploaded file path on disk, not a URL. */
function uploadTempVariables(scope) {
  const names = new Set();
  walkScope(scope, (node) => {
    const isAssign = node.kind === 'assign' && node.left && node.left.kind === 'variable';
    const isTmpAssign = isAssign && isTmpName(node.right);
    if (isTmpAssign) names.add(node.left.name);
  });
  return names;
}

function isUploadTemp(arg, data) {
  const isVariable = Boolean(arg) && arg.kind === 'variable';
  return isTmpName(arg) || (isVariable && data.tmpVars.has(arg.name));
}

// ---- taint filters -------------------------------------------------------------------------
// php-taint.js carries a value through any call whose arguments are derived. For URL hosts that is too
// loud (a catalog lookup keyed by a sanitized request id is not a request-chosen host), so URL checks
// use an index in which a definition built by a call this file does not know is clean. For superglobal
// input, only a wp_json_encode result is treated as clean (the encoder escapes markup characters).

// Calls that return their first argument's URL host unchanged. Anything else is an unknown call.
const PASS_THROUGH = /^(esc_url_raw|esc_url|sanitize_url|trim|ltrim|rtrim|sanitize_text_field|urldecode|rawurldecode|untrailingslashit|trailingslashit|set_url_scheme|wp_unslash|stripslashes|strval|html_entity_decode|htmlspecialchars_decode|wp_specialchars_decode|strtolower|wp_sanitize_redirect|parse_url|wp_parse_url)$/;

function unwrap(node) {
  const isCast = Boolean(node) && (node.kind === 'cast' || node.kind === 'silent');
  const info = node && node.kind === 'call' ? callName(node) : null;
  const passes = Boolean(info) && info.kind === 'function' && PASS_THROUGH.test(info.name.toLowerCase());
  const byKind = { cast: node && node.expr, silent: node && node.expr };
  return isCast ? byKind[node.kind] : (passes && node.arguments[0]) || null;
}

/** The expression under casts and pass-through wrappers. */
function coreOf(node) {
  const inner = unwrap(node);
  return inner ? coreOf(inner) : node;
}

function isUnknownCall(node) {
  const core = coreOf(node);
  const isCall = Boolean(core) && (core.kind === 'call' || core.kind === 'new');
  const info = isCall ? callName(core) : null;
  const isQueryArg = Boolean(info) && info.kind === 'function' && info.name.toLowerCase() === 'add_query_arg';
  return isCall && !isQueryArg && !isRequestObjectSource(core);
}

function isJsonEncode(node) {
  const info = node && node.kind === 'call' ? callName(node) : null;
  return Boolean(info) && info.kind === 'function' && info.name.toLowerCase() === 'wp_json_encode';
}

function cleanDefinitions(idx, isClean) {
  const all = [...idx.defs.values()].flat();
  for (const def of all.filter((d) => d.expr && isClean(d.expr))) def.expr = null;
  return idx;
}

const urlIndexOf = (scope) => cleanDefinitions(createScopeIndex(scope), isUnknownCall);
const inputIndexOf = (scope) => cleanDefinitions(createScopeIndex(scope), isJsonEncode);

function concatParts(node) {
  const isConcat = Boolean(node) && node.kind === 'bin' && node.type === '.';
  return isConcat ? [...concatParts(node.left), ...concatParts(node.right)] : [node];
}

/** True when the URL argument can have a request-chosen host and is neither an upload path nor an unknown call's result. */
function urlFlows(arg, data) {
  const skipped = !arg || isUploadTemp(arg, data) || isUnknownCall(arg);
  return !skipped && hostTaint(arg, data.url(), BOTH_SOURCES);
}

function createState(ctx) {
  const scopes = new Map();
  const dataFor = (node) => {
    const scope = scopeOf(node);
    if (!scopes.has(scope)) {
      let input = null;
      let url = null;
      scopes.set(scope, {
        tmpVars: uploadTempVariables(scope),
        input: () => (input = input || inputIndexOf(scope)),
        url: () => (url = url || urlIndexOf(scope)),
      });
    }
    return scopes.get(scope);
  };
  return { dataFor, resolver: ctx.index ? createResolver(ctx) : null };
}

// ---- call resolution through the project index ---------------------------------------------

/** The file's path as the project index names it: relative to the WordPress root when known. */
function indexPathOf(ctx) {
  const root = ctx.wp && ctx.wp.root;
  const isMeasurable = Boolean(root) && path.isAbsolute(ctx.filePath);
  return isMeasurable ? path.relative(root, ctx.filePath).split(path.sep).join('/') : ctx.relativePath;
}

const CALLEE_KINDS = new Set(['function', 'method', 'static']);

function createResolver(ctx) {
  const rel = indexPathOf(ctx);
  let calls = null;
  const callFacts = () => {
    if (calls) return calls;
    const facts = ctx.index.facts(rel);
    calls = new Map();
    for (const fn of facts ? facts.functions : []) {
      for (const call of fn.calls) calls.set(`${call.line}|${String(call.name).toLowerCase()}`, call);
    }
    return calls;
  };
  const resolve = (node, info) => {
    const fact = callFacts().get(`${nodeLine(node)}|${info.name.toLowerCase()}`);
    return fact ? ctx.index.resolveCallable(fact, rel) : null;
  };
  return { rel, resolve };
}

// ---- parameter-to-sink summaries -----------------------------------------------------------

const linked = new WeakSet();
const summaries = new WeakMap();

const idName = (node) => (node && typeof node === 'object' ? node.name : node);

function paramName(param) {
  const raw = idName(param.name);
  return typeof raw === 'string' ? raw : null;
}

function urlSinksIn(fn) {
  const sinks = [];
  walkScope(fn, (node) => {
    const info = node.kind === 'call' ? callName(node) : null;
    const rule = info && info.kind === 'function' ? URL_SINKS.get(info.name.toLowerCase()) : null;
    const arg = rule ? node.arguments[0] : null;
    if (arg) sinks.push({ rule, name: info.name, line: nodeLine(node), arg });
  });
  return sinks;
}

const reachesHost = (sink, idx) => hostTaint(sink.arg, idx, BOTH_SOURCES);

/**
 * For each parameter of `fn` (a function or method node), the URL sinks in its own body whose URL host
 * that parameter can choose: [{ param, rule, name, line }]. Sinks a request source already reaches
 * without the parameter are left out (the direct check reports those). One level only.
 */
export function summarizeParamSinks(fn) {
  const sinks = urlSinksIn(fn);
  const idx = urlIndexOf(fn);
  const direct = new Set(sinks.filter((sink) => reachesHost(sink, idx)));
  const found = [];
  (fn.arguments || []).forEach((param, position) => {
    const def = (idx.defs.get(paramName(param)) || []).find((d) => d.kind === 'param');
    if (!def) return;
    def.expr = SEED;
    idx.caches.clear();
    for (const sink of sinks.filter((s) => !direct.has(s) && reachesHost(s, idx))) {
      found.push({ param: position, rule: sink.rule, name: sink.name, line: sink.line });
    }
    def.expr = null;
    idx.caches.clear();
  });
  return found;
}

function findDeclaration(ast, hit) {
  let found = null;
  walk(ast, (node) => {
    const isCandidate = node.kind === 'function' || node.kind === 'method';
    const matches = isCandidate && nodeLine(node) === hit.line && idName(node.name) === hit.fact.name;
    found = matches && !found ? node : found;
    return !found;
  });
  return found;
}

function summaryFor(index, hit) {
  const ast = index.loadAst(hit.file);
  if (!ast) return [];
  if (!linked.has(ast)) {
    linkParents(ast);
    linked.add(ast);
  }
  const fn = findDeclaration(ast, hit);
  if (!fn) return [];
  if (!summaries.has(fn)) summaries.set(fn, summarizeParamSinks(fn));
  return summaries.get(fn);
}

// ---- checks --------------------------------------------------------------------------------

function checkInput(ctx, state, node) {
  const resolve = INPUT_SINKS[node.kind];
  const sink = resolve ? resolve(node) : null;
  const hasArgs = Boolean(sink) && sink.args.length > 0;
  if (!hasArgs) return;
  const data = state.dataFor(node);
  const parts = sink.args.flatMap(concatParts).filter((part) => !isJsonEncode(part));
  const tainted = parts.some((part) => isRequestDerived(part, data.input(), INPUT_OPTIONS));
  if (tainted) ctx.report(INPUT, node, HAZARDS.input(sink.label));
}

function checkDirect(ctx, state, node, rule, name) {
  const flows = urlFlows(node.arguments[0], state.dataFor(node));
  if (flows) ctx.report(rule, node, HAZARDS[rule](name));
}

function reportHop(ctx, rel, node, info, hit, entry) {
  const isCross = hit.file !== rel;
  const isSuppressed = isCross && ctx.crossFile === false;
  if (isSuppressed) return;
  const where = `${hit.file}:${entry.line}`;
  const hazard = `A request value passed to ${info.name}() can choose the host of the URL that ${entry.name}() requests at ${where}. ${HAZARDS[entry.rule](entry.name)}`;
  ctx.report(entry.rule, node, hazard, { crossFile: isCross, evidence: `${where} ${entry.name}()` });
}

function checkHop(ctx, state, node, info) {
  const resolver = state.resolver;
  const eligible = Boolean(resolver) && Boolean(info) && CALLEE_KINDS.has(info.kind);
  if (!eligible) return;
  const data = state.dataFor(node);
  const tainted = node.arguments.map((arg, i) => (urlFlows(arg, data) ? i : -1)).filter((i) => i >= 0);
  const hit = tainted.length > 0 ? resolver.resolve(node, info) : null;
  const entry = hit ? summaryFor(ctx.index, hit).find((s) => tainted.includes(s.param)) : null;
  if (entry) reportHop(ctx, resolver.rel, node, info, hit, entry);
}

function checkUrl(ctx, state, node) {
  const info = node.kind === 'call' ? callName(node) : null;
  const rule = info && info.kind === 'function' ? URL_SINKS.get(info.name.toLowerCase()) : null;
  if (rule) return checkDirect(ctx, state, node, rule, info.name);
  return checkHop(ctx, state, node, info);
}

/** Pass entry. Silent outside WordPress. Without ctx.index only the direct checks run. */
export function wpRequestFlowPass(ctx) {
  const isReady = Boolean(ctx.wp) && ctx.wp.isWordPress === true;
  if (!isReady) return;
  const state = createState(ctx);
  walk(ctx.ast, (node) => {
    checkInput(ctx, state, node);
    checkUrl(ctx, state, node);
  });
}

/** The entry the language flip adds to PASSES. */
export const wpRequestFlowRegistration = { name: 'wp-request-flow', rules: [INPUT, SSRF, REDIRECT], isWordPress: true, run: wpRequestFlowPass };
