/**
 * Precondition for the CONTROL_FLOW_INLINE_BOOLEAN remedy line (Forge engine doc, Library: THE CONFLICT
 * RESOLUTION). An `if` that compares a `let` binding or a member to null or undefined and then uses it in
 * the consequent is the shape an agent is tempted to "name" through a const alias, which TIMER_DISCIPLINE
 * and TypeScript narrowing both punish. Detection of the rule is unchanged; only the hazard text gains the
 * pointer to the resolution entry.
 */
import * as t from '@babel/types';
import { toSourceKey } from './lifecycle-predicates.js';

export const MUTABLE_REF_REMEDY = 'Canonical: chemx library show vue-ts/nullable-timer-handle (act on the handle directly; an alias of the test breaks narrowing and handle tracking).';

const NULLISH_COMPARISONS = new Set(['===', '!==', '==', '!=']);
const MUTABLE_BINDING_KINDS = new Set(['let', 'var']);

const isNullish = (node) => t.isNullLiteral(node) || t.isIdentifier(node, { name: 'undefined' });

// The operand compared to null/undefined, or null when the test is not such a comparison.
const comparedOperand = (test) => {
  const isComparison = t.isBinaryExpression(test) && NULLISH_COMPARISONS.has(test.operator);
  if (!isComparison) return null;
  if (isNullish(test.right)) return test.left;
  return isNullish(test.left) ? test.right : null;
};

const isMutableOperand = (operand, scope) => {
  const isMember = t.isMemberExpression(operand) || t.isOptionalMemberExpression(operand);
  if (isMember) return true;
  const binding = t.isIdentifier(operand) ? scope.getBinding(operand.name) : null;
  return Boolean(binding) && MUTABLE_BINDING_KINDS.has(binding.kind);
};

const isUsedIn = (consequentPath, key) => {
  let isUsed = false;
  consequentPath.traverse({
    enter(innerPath) {
      const isSameRef = toSourceKey(innerPath.node) === key;
      if (isSameRef) {
        isUsed = true;
        innerPath.stop();
      }
    }
  });
  const isDirect = toSourceKey(consequentPath.node) === key;
  return isUsed || isDirect;
};

/** True when `testPath` compares a let binding or member to null/undefined and `consequentPath` uses it. */
export const narrowsMutableRef = (testPath, consequentPath) => {
  const operand = comparedOperand(testPath.node);
  const key = toSourceKey(operand);
  const isNarrowable = Boolean(key) && isMutableOperand(operand, testPath.scope);
  return isNarrowable && isUsedIn(consequentPath, key);
};
