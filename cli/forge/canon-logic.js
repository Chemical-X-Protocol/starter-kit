// Boolean-logic canonicalization (engine doc section 2), run after alias inlining:
//   - `Boolean(x)` in test position becomes `x` (test position: if/loop/conditional tests, the operand of
//     `!`, and the operands or branches of a logical/conditional that is itself in test position);
//   - `&&` / `||` chains flatten into n-ary LogicalNary nodes; operand order is never sorted;
//   - De Morgan folds every maximal run of 2+ negated operands: `!a && !b` -> `!(a || b)` and
//     `!a || !b` -> `!(a && b)`. Evaluation and short-circuit order stay exactly as written.

import { makeNode } from './canon-nodes.js';

const FLATTENED_OPERATORS = { 'operator:&&': '&&', 'operator:||': '||' };
const DUAL = { '&&': '||', '||': '&&' };
const TEST_SLOTS = {
  IfStatement: 'test',
  WhileStatement: 'test',
  DoWhileStatement: 'test',
  ForStatement: 'test',
  ConditionalExpression: 'test'
};
const NOT_LABEL = 'operator:! prefix';


const isNot = (node) => node?.type === 'UnaryExpression' && node.label === NOT_LABEL;

const isGlobalBooleanCall = (node) => {
  const isCall = node.type === 'CallExpression';
  const callee = isCall ? node.kids.callee : null;
  const args = isCall ? node.kids.arguments : [];
  const isGlobalBoolean = callee?.type === 'Identifier' && callee.label === 'Boolean' && callee.ident.origin === 'global';
  const hasPlainSingleArg = args.length === 1 && args[0].type !== 'SpreadElement';
  return isGlobalBoolean && hasPlainSingleArg;
};

const operatorOf = (node) => {
  const isLogical = node.type === 'LogicalExpression';
  if (isLogical) return FLATTENED_OPERATORS[node.label] ?? null;
  const isNary = node.type === 'LogicalNary';
  return isNary ? node.label : null;
};

const operandsOf = (node) => (node.type === 'LogicalNary' ? node.kids.operands : [node.kids.left, node.kids.right]);

const nary = (operator, operands, from) => {
  const flat = operands.flatMap((operand) => (operatorOf(operand) === operator ? operandsOf(operand) : [operand]));
  const isSingle = flat.length === 1;
  if (isSingle) return flat[0];
  return makeNode('LogicalNary', operator, { operands: flat }, null, { isExpr: true, loc: from.loc });
};

const negate = (argument, from) => makeNode('UnaryExpression', NOT_LABEL, { argument }, null, { isExpr: true, loc: from.loc });

/** Folds maximal runs of negated operands; returns the rewritten operand list. */
const foldNegatedRuns = (operator, operands, from) => {
  const out = [];
  let run = [];
  const flush = () => {
    const isFoldable = run.length >= 2;
    const folded = isFoldable ? [negate(nary(DUAL[operator], run.map((item) => item.kids.argument), from), from)] : run;
    out.push(...folded);
    run = [];
  };
  for (const operand of operands) {
    const isNegated = isNot(operand);
    if (isNegated) run.push(operand);
    if (!isNegated) {
      flush();
      out.push(operand);
    }
  }
  flush();
  return out;
};

const normalizeLogical = (node, operator) => {
  const flat = nary(operator, operandsOf(node), node);
  const isStillNary = flat.type === 'LogicalNary';
  if (!isStillNary) return flat;
  return nary(operator, foldNegatedRuns(operator, flat.kids.operands, node), node);
};

const isTestSlot = (node, key, inTest) => {
  const isOwnTest = TEST_SLOTS[node.type] === key;
  const isNotArgument = isNot(node) && key === 'argument';
  const isLogicalOperand = operatorOf(node) !== null && inTest;
  const isBranchInTest = node.type === 'ConditionalExpression' && key !== 'test' && inTest;
  return isOwnTest || isNotArgument || isLogicalOperand || isBranchInTest;
};

/**
 * Rewrites one canonical subtree bottom-up. inTest marks that only the truthiness of node matters.
 * Each kid slot is rewritten in place (a list gets a new array), with no per-slot entry or wrapper
 * arrays: this runs once per canonical node of every file (#5911).
 */
export const normalizeLogic = (node, inTest = false) => {
  const isStrippable = inTest && isGlobalBooleanCall(node);
  if (isStrippable) return normalizeLogic(node.kids.arguments[0], true);
  const { kids } = node;
  for (const key in kids) {
    const value = kids[key];
    const childInTest = isTestSlot(node, key, inTest);
    const isList = Array.isArray(value);
    if (isList) kids[key] = value.map((child) => child && normalizeLogic(child, childInTest));
    else kids[key] = value && normalizeLogic(value, childInTest);
  }
  const operator = operatorOf(node);
  return operator ? normalizeLogical(node, operator) : node;
};
