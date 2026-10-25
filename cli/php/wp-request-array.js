// Request arrays and per-item work, for SECURITY_WP_UNBOUNDED_REQUEST_ARRAY (task #6717).
//
// Guarantees: isRequestArray() is true for a value that IS a request value or an element, copy or filtered form of
// one (assignments, ternaries, ??, array casts, element reads, array_values/array_filter/array_unique/array_map and
// json_decode), in one function scope. An array literal that merely holds a request value is not one, and neither is
// a value built by a loop or an unknown call. hasItemWork() is a name match: a call named like a write, outbound
// request or save/insert/update step, found anywhere inside the loop body.
import { walk, callName } from './php-walk.js';
import { isRequestObjectSource, isSuperglobalSource } from './php-taint.js';
import { labelCall } from './php-facts-vocab.js';

const MAX_DEPTH = 8;
const PASS_FUNCTIONS = new Set(['array_values', 'array_keys', 'array_filter', 'array_unique', 'array_reverse', 'wp_unslash', 'stripslashes_deep', 'json_decode']);
const ITEM_STEP = /^(insert|update|delete|replace|query|save|store|create|add|remove|import|sync|send|set|put|write|enqueue|process|register|upsert)(_|$)/i;
const WPDB_METHODS = new Set(['insert', 'update', 'delete', 'replace', 'query']);

const nameOf = (node) => (node && typeof node.name === 'string' ? node.name : null);
const isNode = (node) => Boolean(node) && typeof node === 'object';
const isRequestSource = (node) => isRequestObjectSource(node) || isSuperglobalSource(node);

function functionArray(node, evaluate) {
  const info = callName(node);
  const name = info && info.kind === 'function' ? info.name.toLowerCase() : '';
  const isMap = name === 'array_map';
  const isPass = PASS_FUNCTIONS.has(name);
  const subject = isMap ? node.arguments[1] : node.arguments[0];
  return (isMap || isPass) && evaluate(subject);
}

function variableArray(node, idx, evaluate) {
  const defs = idx.defs.get(nameOf(node)) || [];
  const reaching = defs.filter((d) => d.kind === 'assign' && d.plain && d.expr && d.pos < node.loc.start.offset);
  return reaching.some((d) => evaluate(d.expr));
}

/** A read of one named element: $request['k'], $_POST['k'] or get_param( 'k' ), as opposed to the whole body. */
function isElementRead(node) {
  const info = node.kind === 'call' ? callName(node) : null;
  const isParamCall = Boolean(info) && info.kind === 'method' && info.name.toLowerCase() === 'get_param';
  return node.kind === 'offsetlookup' || isParamCall;
}

/**
 * True when `node` is a source, or an element, copy or filtered form of one. `isSource` decides what a source is:
 * by default a request value; the callee check passes a test for the parameter it follows. With `needElement`
 * the whole request body (get_json_params(), $_POST) does not count, only an element read from it.
 */
export function isRequestArray(node, idx, isSource = isRequestSource, needElement = false, depth = 0) {
  const isUsable = isNode(node) && depth <= MAX_DEPTH;
  if (!isUsable) return false;
  const evaluate = (next) => isRequestArray(next, idx, isSource, needElement, depth + 1);
  const isSourceNode = isSource(node);
  if (isSourceNode) return !needElement || isElementRead(node);
  const byKind = {
    offsetlookup: () => isRequestArray(node.what, idx, isSource, false, depth + 1),
    variable: () => variableArray(node, idx, evaluate),
    retif: () => evaluate(node.trueExpr || node.test) || evaluate(node.falseExpr),
    bin: () => node.type === '??' && (evaluate(node.left) || evaluate(node.right)),
    cast: () => node.type === 'array' && evaluate(node.expr),
    silent: () => evaluate(node.expr),
    call: () => functionArray(node, evaluate),
  };
  const check = byKind[node.kind];
  return check ? check() : false;
}

function isItemStep(node) {
  const info = node.kind === 'call' ? callName(node) : null;
  const lower = info ? info.name.toLowerCase() : '';
  const label = info ? labelCall({ kind: info.kind === 'function' ? 'func' : info.kind, name: lower, wpdb: false }) : null;
  const isFunctionStep = Boolean(label) && info.kind === 'function' && (label.write || label.outbound);
  const isMethodStep = Boolean(info) && info.kind !== 'function' && (WPDB_METHODS.has(lower) || ITEM_STEP.test(lower));
  return isFunctionStep || isMethodStep;
}

/** True when the loop body holds a call named like a write, an outbound request or a save step. */
export function hasItemWork(loop) {
  const state = { found: false };
  walk(loop.body, (node) => {
    state.found = state.found || isItemStep(node);
    return !state.found;
  });
  return state.found;
}
