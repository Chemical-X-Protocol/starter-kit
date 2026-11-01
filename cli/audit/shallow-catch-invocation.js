/**
 * Immediately invoked functions for shallow-catch path coverage (truth spec 4.2): a function
 * expression or arrow run where it is written, called directly ((() => { ... })(), or with ?.()),
 * through .call, .apply or a bound copy ((function () { ... }).call(this), fn.bind(this)()), or
 * constructed (new (function () { ... })()).
 * A synchronous one runs its whole body at the call, so a throw in it leaves through the call. An
 * async one runs only up to its first await, and a return or throw in it settles its promise, so
 * the code after the call goes on from there (shallow-catch-writes.js). A generator body runs only
 * when iterated, and new constructs only a plain function expression, so neither counts.
 */
import * as t from '@babel/types';

const FUNCTION_EXPRESSION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression']);
const CALLING_METHODS = new Set(['call', 'apply']);
// The farthest invocation sits three levels above its function: fn.bind(x)().
const INVOCATION_DEPTH = 3;

// The name a member reads: fn.call, or fn['call'].
const readMemberName = (member) => {
  if (!member.computed) return t.isIdentifier(member.property) ? member.property.name : null;
  return t.isStringLiteral(member.property) ? member.property.value : null;
};

const isCallable = (fnNode) => FUNCTION_EXPRESSION_TYPES.has(fnNode?.type) && !fnNode.generator;
const isConstructible = (fnNode) => t.isFunctionExpression(fnNode) && !fnNode.async && !fnNode.generator;
const isMember = (path) => path.isMemberExpression() || path.isOptionalMemberExpression();
const isCall = (path) => path.isCallExpression() || path.isOptionalCallExpression();

// The part of a callee that a call runs: fn itself, the fn of fn.call or fn.apply, or the fn of
// fn.bind(x), whose bound copy runs the same body.
const unwrapCallee = (calleePath) => {
  const isMethod = isMember(calleePath) && CALLING_METHODS.has(readMemberName(calleePath.node));
  if (isMethod) return calleePath.get('object');
  const isBound = isCall(calleePath) && isMember(calleePath.get('callee')) && readMemberName(calleePath.node.callee) === 'bind';
  return isBound ? calleePath.get('callee.object') : calleePath;
};

/** The function a call or new expression runs where it is written, as a path, or null. */
export const findInvokedFunction = (invocationPath) => {
  const isNew = invocationPath.isNewExpression();
  const isInvocation = isNew || isCall(invocationPath);
  if (!isInvocation) return null;
  const calleePath = invocationPath.get('callee');
  if (isNew) return isConstructible(calleePath.node) ? calleePath : null;
  const fnPath = unwrapCallee(calleePath);
  return isCallable(fnPath.node) ? fnPath : null;
};

/** Whether fnPath's function runs to the end of its body where it is written, so a throw in it leaves through the call. */
export const isRunAtOnce = (fnPath) => {
  if (fnPath.node.async) return false;
  let candidatePath = fnPath.parentPath;
  for (let depth = 0; depth < INVOCATION_DEPTH && candidatePath; depth += 1) {
    const isInvoker = findInvokedFunction(candidatePath)?.node === fnPath.node;
    if (isInvoker) return true;
    candidatePath = candidatePath.parentPath;
  }
  return false;
};

/** Whether an exit is an await or a for await loop, which pauses an async function there. */
export const isPause = (exit) => t.isAwaitExpression(exit) || t.isForOfStatement(exit, { await: true });
