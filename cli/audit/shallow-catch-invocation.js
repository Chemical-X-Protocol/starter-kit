/**
 * Functions that do not run before a read, for shallow-catch escalation (truth spec 4.2): a write
 * inside one gives the binding no value for a read in the try's own function. A function nothing
 * calls never runs: a function declaration directly in a function body or the module, or a
 * function a variable is initialised to, that is not exported and is referenced only from inside
 * itself. A callback passed straight to a timer or listener API runs only after the code around
 * it: setTimeout, setInterval, setImmediate, queueMicrotask and requestAnimationFrame (also on
 * window, globalThis, self or global), process.nextTick, and an addEventListener, on or once
 * listener. A promise's then, catch or finally is none of them, since an await on the promise
 * runs the callback before going on. shallow-catch-writes.js says where a deferred one is proven
 * not to have run yet.
 */
import * as t from '@babel/types';
import { isWithinNode } from './shallow-catch-reads.js';

const TIMER_NAMES = new Set(['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'requestAnimationFrame']);
const GLOBAL_NAMES = new Set(['window', 'globalThis', 'self', 'global']);
const LISTENER_METHODS = new Set(['addEventListener', 'on', 'once']);

const isMemberNode = (node) => t.isMemberExpression(node) || t.isOptionalMemberExpression(node);

// The name a member reads: el.on, or el['on'].
const readMemberName = (member) => {
  if (!member.computed) return t.isIdentifier(member.property) ? member.property.name : null;
  return t.isStringLiteral(member.property) ? member.property.value : null;
};

const isGlobalTimer = (member, name) => TIMER_NAMES.has(name) && t.isIdentifier(member.object) && GLOBAL_NAMES.has(member.object.name);
const isNextTick = (member, name) => name === 'nextTick' && t.isIdentifier(member.object, { name: 'process' });

/** Whether a call hands the functions passed to it to an API that runs them later. */
export const isDeferringCall = (node) => {
  const isCall = t.isCallExpression(node) || t.isOptionalCallExpression(node);
  if (!isCall) return false;
  const callee = node.callee;
  if (t.isIdentifier(callee)) return TIMER_NAMES.has(callee.name);
  if (!isMemberNode(callee)) return false;
  const name = readMemberName(callee);
  return LISTENER_METHODS.has(name) || isGlobalTimer(callee, name) || isNextTick(callee, name);
};

// The global a timer or nextTick call goes through (setTimeout, window of window.setTimeout,
// process), which a binding of the same name in the code (const setTimeout = (fn) => fn())
// replaces. A listener method may sit on any object.
const readGlobalRoot = (callee) => {
  if (t.isIdentifier(callee)) return callee;
  const isListenerMethod = LISTENER_METHODS.has(readMemberName(callee));
  return isListenerMethod ? null : callee.object;
};

const isUnshadowed = (callPath) => {
  const root = readGlobalRoot(callPath.node.callee);
  return !root || !callPath.scope.getBinding(root.name);
};

// The functions around a path, innermost first, below the function (or program) of fnScope.
const listEnclosingFunctions = (path, fnScope) => {
  const functions = [];
  for (let fnPath = path.getFunctionParent(); fnPath && fnPath.scope !== fnScope; fnPath = fnPath.getFunctionParent()) {
    functions.push(fnPath);
  }
  return functions;
};

const isExported = (statementPath) => Boolean(statementPath.parentPath?.isExportDeclaration());

// Whether a function declaration stands directly in a function body or the module (an exported one
// stands in its export). One declared in an inner block or a case also belongs to the enclosing
// function in sloppy code (Annex B), so a call after the block may run it.
const isBodyDeclaration = (fnPath) => {
  const parentPath = fnPath.parentPath;
  return parentPath.isProgram() || (parentPath.isBlockStatement() && parentPath.parentPath.isFunction());
};

// The binding a function can be called through: a declaration's own name, or the variable it
// initialises. Null for an exported, anonymous or block-level one, or any other function.
const readNameBinding = (fnPath) => {
  if (fnPath.isFunctionDeclaration()) {
    const isLocalName = Boolean(fnPath.node.id) && isBodyDeclaration(fnPath);
    return isLocalName ? fnPath.parentPath.scope.getBinding(fnPath.node.id.name) : null;
  }
  const declarator = fnPath.parentPath;
  const isInit = declarator.isVariableDeclarator() && fnPath.key === 'init' && t.isIdentifier(declarator.node.id);
  const isLocalInit = isInit && !isExported(declarator.parentPath);
  return isLocalInit ? declarator.scope.getBinding(declarator.node.id.name) : null;
};

// A function nothing calls: its name is referenced only from inside its own body.
const isUncalled = (fnPath) => {
  const binding = readNameBinding(fnPath);
  const isOwnBinding = Boolean(binding) && (binding.path.node === fnPath.node || binding.path.node === fnPath.parent);
  return isOwnBinding && binding.referencePaths.every((ref) => isWithinNode(ref.node, fnPath.node));
};

/** Whether a path sits in a function that nothing calls, below the function of fnScope. */
export const isInUncalledFunction = (path, fnScope) => listEnclosingFunctions(path, fnScope).some(isUncalled);

/**
 * The deferring call that the outermost function around a write, below the function of fnScope,
 * is passed to as an argument (setTimeout(() => { v = d; })), as a path, or null.
 */
export const findDeferringCall = (writePath, fnScope) => {
  const outermost = listEnclosingFunctions(writePath, fnScope).at(-1);
  const callPath = outermost?.parentPath;
  const isArgument = Boolean(callPath) && outermost.listKey === 'arguments';
  const isDeferredArgument = isArgument && isDeferringCall(callPath.node) && isUnshadowed(callPath);
  return isDeferredArgument ? callPath : null;
};
