/**
 * Module-scope teardown tracking for TIMER_DISCIPLINE and LIFECYCLE_ORPHANED_LISTENER.
 * Vue and React register a timer or listener in one closure (onMounted, an effect)
 * and dispose it in a sibling (onBeforeUnmount, onUnmounted, onScopeDispose, the
 * effect's returned function), so cleanup is matched across the whole program by
 * handle (timers) or by event plus handler (listeners).
 */
import * as t from '@babel/types';

const CLEAR_CALLS = new Set(['clearTimeout', 'clearInterval', 'cancelAnimationFrame', 'cancelIdleCallback']);

const memberKey = (node) => {
  const objectKey = toSourceKey(node.object);
  const isNamed = !node.computed && t.isIdentifier(node.property);
  const propertyKey = isNamed ? node.property.name : `[${toSourceKey(node.property)}]`;
  const isResolvable = Boolean(objectKey) && propertyKey !== '[]';
  return isResolvable ? `${objectKey}.${propertyKey}` : '';
};

/** A stable key for identifiers, member paths and literals; '' for anything else. */
export const toSourceKey = (node) => {
  if (!node) return '';
  if (t.isIdentifier(node)) return node.name;
  if (t.isThisExpression(node)) return 'this';
  const isMember = t.isMemberExpression(node) || t.isOptionalMemberExpression(node);
  if (isMember) return memberKey(node);
  if (t.isStringLiteral(node)) return JSON.stringify(node.value);
  const isStaticTemplate = t.isTemplateLiteral(node) && node.expressions.length === 0;
  if (isStaticTemplate) return JSON.stringify(node.quasis[0].value.cooked);
  return '';
};

const lastSegment = (key) => key.split('.').pop() || key;

const resolveCalleeName = (callee) => {
  if (t.isIdentifier(callee)) return callee.name;
  const isMember = t.isMemberExpression(callee) && t.isIdentifier(callee.property);
  return isMember ? callee.property.name : '';
};

/** Collects every disposal in the program: cleared timer handles and removed listeners. */
export const collectTeardowns = (programPath) => {
  const clearedHandles = new Set();
  const removedListeners = [];
  programPath.traverse({
    CallExpression(callPath) {
      const name = resolveCalleeName(callPath.node.callee);
      const [first, second] = callPath.node.arguments;
      if (CLEAR_CALLS.has(name)) {
        const key = toSourceKey(first);
        clearedHandles.add(key);
        clearedHandles.add(lastSegment(key));
      }
      if (name === 'removeEventListener') {
        removedListeners.push({ event: toSourceKey(first), handler: toSourceKey(second) });
      }
    }
  });
  return { clearedHandles, removedListeners };
};

const resolveTimerHandleKey = (callPath) => {
  const parent = callPath.parent;
  if (t.isAssignmentExpression(parent)) return toSourceKey(parent.left);
  const isDeclaratorInit = t.isVariableDeclarator(parent) && parent.init === callPath.node;
  return isDeclaratorInit ? toSourceKey(parent.id) : '';
};

const isReturnedToCaller = (callPath) => t.isReturnStatement(callPath.parent);

/** 'cleared' | 'delegated' | 'held' (handle kept, never cleared) | 'unheld' (no handle). */
export const classifyTimerDisposal = (callPath, teardowns) => {
  if (isReturnedToCaller(callPath)) return 'delegated';
  const handleKey = resolveTimerHandleKey(callPath);
  if (!handleKey) return 'unheld';
  const isCleared = teardowns.clearedHandles.has(handleKey) || teardowns.clearedHandles.has(lastSegment(handleKey));
  return isCleared ? 'cleared' : 'held';
};

const hasSignalOrOnceOption = (optionsNode) => {
  if (!t.isObjectExpression(optionsNode)) return false;
  return optionsNode.properties.some((prop) => {
    const keyName = t.isObjectProperty(prop) && t.isIdentifier(prop.key) ? prop.key.name : '';
    const isOnce = keyName === 'once' && t.isBooleanLiteral(prop.value, { value: true });
    return keyName === 'signal' || isOnce;
  });
};

const isListenerFactory = (callPath) => {
  const fnParent = callPath.getFunctionParent();
  return fnParent?.node.id?.name === 'listen';
};

/** True when addEventListener has a matching disposal anywhere in the program. */
export const isListenerDisposed = (callPath, teardowns) => {
  const [eventArg, handlerArg, optionsArg] = callPath.node.arguments;
  if (hasSignalOrOnceOption(optionsArg)) return true;
  if (isListenerFactory(callPath)) return true;
  const eventKey = toSourceKey(eventArg);
  const handlerKey = toSourceKey(handlerArg);
  const isKeyed = Boolean(eventKey) && Boolean(handlerKey);
  if (!isKeyed) return false;
  return teardowns.removedListeners.some((removed) => removed.event === eventKey && removed.handler === handlerKey);
};
