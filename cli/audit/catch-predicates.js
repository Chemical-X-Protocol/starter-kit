/**
 * Catch-clause handling predicates for ERROR_SWALLOWED_EXCEPTION (Directive 2.H).
 * A catch is handled when it throws, returns a value, calls anything (logger,
 * notifier, handler), or assigns state that outlives the catch (error state,
 * a fallback value, a member of an outer object).
 */
import * as t from '@babel/types';

const isMeaningfulStatement = (stmt) => !t.isEmptyStatement(stmt);

export const isEmptyCatchBody = (catchNode) => {
  const body = catchNode.body?.body || [];
  return !body.some(isMeaningfulStatement);
};

const isOuterBindingTarget = (left, catchPath) => {
  const isMember = t.isMemberExpression(left) || t.isOptionalMemberExpression(left);
  if (isMember) return true;
  if (!t.isIdentifier(left)) return false;
  const binding = catchPath.scope.getBinding(left.name);
  if (!binding) return true;
  const isDeclaredInsideCatch = Boolean(binding.path.findParent((p) => p === catchPath));
  return !isDeclaredInsideCatch;
};

/** True when the catch body neither propagates, reports, nor records the failure. */
export const isSwallowedCatch = (astPath) => {
  if (isEmptyCatchBody(astPath.node)) return true;

  let hasActiveHandling = false;
  const markHandled = () => { hasActiveHandling = true; };
  astPath.traverse({
    ThrowStatement: markHandled,
    CallExpression: markHandled,
    OptionalCallExpression: markHandled,
    NewExpression: markHandled,
    ReturnStatement(retPath) {
      const hasValue = retPath.node.argument !== null;
      if (hasValue) markHandled();
    },
    AssignmentExpression(assignPath) {
      const isOuterTarget = isOuterBindingTarget(assignPath.node.left, astPath);
      if (isOuterTarget) markHandled();
    },
    Function(fnPath) {
      fnPath.skip();
    }
  });

  return !hasActiveHandling;
};

/** Empty catches are HIGH; a non-empty body that still discards the error is MEDIUM. */
export const resolveSwallowedCatchSeverity = (catchNode) => (isEmptyCatchBody(catchNode) ? 'HIGH' : 'MEDIUM');
