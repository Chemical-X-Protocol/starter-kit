// SECURITY_WP_UNBOUNDED_REQUEST_ARRAY (task #6717): a REST callback with a write verb that loops, doing per-item work,
// over an array read from the request, or passes one to a callee that does, when nothing in that function limits the
// array's size. A name and shape match, not a proof of an exploitable route.
//
// Guarantees: the callback must be declared in the audited file. The array comes from the request by
// wp-request-array.js (one function scope; an element read such as $params['items'] or get_param( 'items' ), or the
// whole body handed to a callee that loops over an element of it). A size limit is any array_slice(), array_splice(),
// array_chunk() or array_diff/array_intersect(_key) call, or a count()/sizeof() call compared with <, <=, > or >=,
// whose first argument is that same kind of array. Not seen: a limit set elsewhere (a web server body size; a route
// args schema is only recognised as the string 'maxItems' anywhere in the file), a limit applied to a copy built from
// other calls, callees the project index cannot resolve, a loop whose body is only in-memory, and flows through
// properties or a second callee. A caller's permission is not checked: authenticated routes are reported too.
import { resolveRestRoutes, indexPathOf } from './wp-rest-endpoints.js';
import { walk, walkScope, callName, literalString, nodeLine, linkParents } from './php-walk.js';
import { createScopeIndex } from './php-taint.js';
import { isRequestArray, hasItemWork } from './wp-request-array.js';

const RULE = 'SECURITY_WP_UNBOUNDED_REQUEST_ARRAY';
const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Slices, and allowlist filters: a request array cut down to a known set of names is bounded by that set.
const SLICERS = new Set(['array_slice', 'array_splice', 'array_chunk', 'array_diff', 'array_diff_key', 'array_intersect', 'array_intersect_key']);
const COUNTERS = new Set(['count', 'sizeof']);
const COMPARISONS = new Set(['<', '<=', '>', '>=']);
const CALL_KINDS = new Set(['function', 'method', 'static']);

// Figures: cli/php/wp-route-bounds.precision.spec.js. Labelled by one reader: a hit is true when a write route loops,
// with per-item writes or requests, over a request array that nothing in the function bounds.
// Corpus (674 files): 12 hits, 12 true. Held-out: card vault a708d6a 5 hits, 5 true (includes /collector/collection/sync
// and /intake/submit); third-party plugins 11 hits, 8 true (jetpack my-jetpack product slugs activate, deactivate and
// install counted false: slugs are checked against a known product list); 16 hits, 13 true (81%). Not measured:
// forminator, hustle, wp-defender, wpmu-dev-seo and wp-smush-pro (scan not finished). Both figures clear 80% but the
// held-out margin is one hit and one reader, so the rule ships default-off.
export const RULE_DEFAULTS = {
  [RULE]: { defaultOn: false, corpus: '12/12', heldOut: '13/16', measured: '2026-10-25' },
};

const hasWriteVerb = (endpoint) => endpoint.methods.verbs.some((v) => WRITE_VERBS.has(v));
const isDeclaration = (node) => node.kind === 'method' || node.kind === 'function';
const nameOf = (node) => (node && typeof node.name === 'object' && node.name ? node.name.name : node && node.name);

function declarationAt(ast, line, name) {
  const state = { found: null };
  walk(ast, (node) => {
    const isNamed = name === undefined || nameOf(node) === name;
    const isNew = isDeclaration(node) && nodeLine(node) === line && isNamed && !state.found;
    if (isNew) state.found = node;
    return !state.found;
  });
  return state.found;
}

const callNameOf = (node) => {
  const info = node && node.kind === 'call' ? callName(node) : null;
  return info && info.kind === 'function' ? info.name.toLowerCase() : null;
};

function capsOf(node) {
  const found = [];
  const isSlicer = SLICERS.has(callNameOf(node));
  const isBound = node.kind === 'bin' && COMPARISONS.has(node.type);
  const sides = isBound ? [node.left, node.right] : [];
  const counted = sides.filter((side) => COUNTERS.has(callNameOf(side)));
  if (isSlicer) found.push(node.arguments[0]);
  for (const side of counted) found.push(side.arguments[0]);
  return found.filter(Boolean);
}

/** The first argument of every call that limits an array's size in this function: slices, and counts compared with a bound. */
function capArguments(fn) {
  const found = [];
  walkScope(fn, (node) => {
    found.push(...capsOf(node));
  });
  return found;
}

const paramNames = (fn) => (fn.arguments || []).map((p) => nameOf(p));

/**
 * True when the function loops, doing per-item work, over the parameter `name` (or an element or copy of it) and no
 * size limit applies to it. With `needElement` the parameter holds a whole request body, so only an element of it counts.
 */
function loopsUnbounded(fn, name, needElement) {
  const idx = createScopeIndex(fn);
  const isParam = (node) => node.kind === 'variable' && node.name === name;
  const fromParam = (node) => isRequestArray(node, idx, isParam, needElement);
  const state = { loops: false };
  walkScope(fn, (node) => {
    const isLoop = node.kind === 'foreach' && fromParam(node.source) && hasItemWork(node);
    state.loops = state.loops || isLoop;
  });
  return state.loops && !capArguments(fn).some(fromParam);
}

function createResolver(ctx) {
  const rel = indexPathOf(ctx);
  const facts = ctx.index.facts(rel);
  const calls = new Map();
  for (const fn of facts ? facts.functions : []) {
    for (const call of fn.calls) calls.set(`${call.line}|${String(call.name).toLowerCase()}`, call);
  }
  return (node, info) => {
    const fact = calls.get(`${nodeLine(node)}|${info.name.toLowerCase()}`);
    return fact ? ctx.index.resolveCallable(fact, rel) : null;
  };
}

function calleeLoop(ctx, resolve, node, idx) {
  const info = callName(node);
  const isCallable = Boolean(info) && CALL_KINDS.has(info.kind);
  const tainted = isCallable ? node.arguments.map((arg, i) => (isRequestArray(arg, idx) ? i : -1)).filter((i) => i >= 0) : [];
  const isWhole = (i) => !isRequestArray(node.arguments[i], idx, undefined, true);
  const hit = tainted.length > 0 ? resolve(node, info) : null;
  const ast = hit ? ctx.index.loadAst(hit.file) : null;
  if (!ast) return null;
  linkParents(ast);
  const callee = declarationAt(ast, hit.line, hit.fact.name);
  const names = callee ? paramNames(callee) : [];
  const position = tainted.find((i) => names[i] && loopsUnbounded(callee, names[i], isWhole(i)));
  return position === undefined ? null : { callee: info.name, file: hit.file, line: nodeLine(node) };
}

function findingsIn(ctx, fn, resolve) {
  const idx = createScopeIndex(fn);
  const isCapped = capArguments(fn).some((arg) => isRequestArray(arg, idx));
  const found = [];
  if (isCapped) return found;
  walkScope(fn, (node) => {
    const isLoop = node.kind === 'foreach' && isRequestArray(node.source, idx, undefined, true) && hasItemWork(node);
    if (isLoop) found.push({ line: nodeLine(node), what: 'loops over it' });
    const hop = node.kind === 'call' && resolve ? calleeLoop(ctx, resolve, node, idx) : null;
    if (hop) found.push({ line: hop.line, what: `passes it to ${hop.callee}(), which loops over it (${hop.file})` });
  });
  return found;
}

const hasMaxItems = (ctx) => {
  const state = { seen: false };
  walk(ctx.ast, (node) => {
    state.seen = state.seen || literalString(node) === 'maxItems';
    return !state.seen;
  });
  return state.seen;
};

function checkEndpoint(ctx, rel, resolve, route, endpoint) {
  const target = endpoint.callback.target;
  const isCandidate = Boolean(target) && target.file === rel && hasWriteVerb(endpoint);
  const fn = isCandidate ? declarationAt(ctx.ast, target.line) : null;
  const [first] = fn ? findingsIn(ctx, fn, resolve) : [];
  if (!first) return;
  const hazard = `REST route ${route.route || 'a route'} accepts ${endpoint.methods.verbs.join(', ')} and its callback ${target.id} reads a request array and ${first.what} at line ${first.line} with no count cap or array_slice found in that function (a name match, not a proof). Reject a request array above a fixed size before looping, or declare maxItems in the route args schema.`;
  ctx.report(RULE, first.line, hazard, { evidence: `callback ${target.id} at ${target.file}:${target.line}` });
}

export function wpUnboundedRequestArrayPass(ctx) {
  const isReady = Boolean(ctx.wp) && ctx.wp.isWordPress === true;
  const isSkipped = !isReady || hasMaxItems(ctx);
  if (isSkipped) return;
  const rel = indexPathOf(ctx);
  const resolve = ctx.index ? createResolver(ctx) : null;
  const seen = new Set();
  for (const route of resolveRestRoutes(ctx)) {
    for (const endpoint of route.endpoints) {
      const target = endpoint.callback.target;
      const isRepeat = Boolean(target) && seen.has(target.id);
      if (target) seen.add(target.id);
      if (!isRepeat) checkEndpoint(ctx, rel, resolve, route, endpoint);
    }
  }
}

export const wpUnboundedRequestArrayRegistration = { name: 'wp-unbounded-request-array', rules: [RULE], isWordPress: true, run: wpUnboundedRequestArrayPass };
