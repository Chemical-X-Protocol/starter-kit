/**
 * Path coverage for shallow-catch escalation (truth spec 4.2): whether running a node always
 * writes a binding, so that a write one branch alone may skip still counts as a default when
 * the if, conditional, switch or immediately invoked function around it writes on every path
 * (if (c) v = 1; else v = 2). writeNodes holds the binding's defaulting writes (=, ??=, ||=);
 * a statement that may break, continue, return or throw before a write leaves a path unwritten.
 */
import * as t from '@babel/types';
import { EXIT_TYPES } from './shallow-catch-reads.js';

const FUNCTION_EXPRESSION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression']);

// A plain function expression or arrow called where it is written runs its body there, as
// (() => { v = d; })() does. An async or generator body may pause or never start.
const isImmediatelyInvoked = (fnNode, parent) => {
  const isCallee = t.isCallExpression(parent) && parent.callee === fnNode;
  const runsAtOnce = FUNCTION_EXPRESSION_TYPES.has(fnNode.type) && !fnNode.async && !fnNode.generator;
  return isCallee && runsAtOnce;
};

const containsExit = (node) => {
  let hasExit = false;
  t.traverseFast(node, (inner) => {
    hasExit = hasExit || EXIT_TYPES.has(inner.type);
  });
  return hasExit;
};

// How a statement list ends for the binding: 'writes' at a statement that always writes it,
// 'exits' at one that may break, continue, return or throw first, and 'falls' off its end.
const readListOutcome = (statements, writeNodes) => {
  for (const statement of statements) {
    const doesWrite = writesOnEveryPath(statement, writeNodes);
    if (doesWrite) return 'writes';
    const mayExit = containsExit(statement);
    if (mayExit) return 'exits';
  }
  return 'falls';
};

const writesOnBothBranches = (node, writeNodes) => writesOnEveryPath(node.consequent, writeNodes) && writesOnEveryPath(node.alternate, writeNodes);

// A switch writes on every path when it has a default and each case writes, or falls through to
// a case that does. A case that may break first, or a last case that runs off its end, does not.
const writesOnEveryCase = (node, writeNodes) => {
  const hasDefault = node.cases.some((switchCase) => !switchCase.test);
  if (!hasDefault) return false;
  let fallsIntoWrite = false;
  for (let index = node.cases.length - 1; index >= 0; index -= 1) {
    const outcome = readListOutcome(node.cases[index].consequent, writeNodes);
    fallsIntoWrite = outcome === 'writes' || (outcome === 'falls' && fallsIntoWrite);
    if (!fallsIntoWrite) return false;
  }
  return true;
};

const writesThroughCall = (node, writeNodes) => isImmediatelyInvoked(node.callee, node) && writesOnEveryPath(node.callee.body, writeNodes);

// Node types that can write the binding on every path through them (see writesOnEveryPath).
const PATH_WRITERS = Object.freeze({
  ExpressionStatement: (node, writeNodes) => writesOnEveryPath(node.expression, writeNodes),
  SequenceExpression: (node, writeNodes) => node.expressions.some((part) => writesOnEveryPath(part, writeNodes)),
  BlockStatement: (node, writeNodes) => readListOutcome(node.body, writeNodes) === 'writes',
  IfStatement: writesOnBothBranches,
  ConditionalExpression: writesOnBothBranches,
  SwitchStatement: writesOnEveryCase,
  CallExpression: writesThroughCall
});

/**
 * Whether running node always writes the binding (one of writeNodes): the write itself, an
 * expression statement, sequence or block holding one before anything that may leave it, an if
 * or a conditional whose branches both do, a switch whose every case does, or an immediately
 * invoked function whose body does.
 */
export const writesOnEveryPath = (node, writeNodes) => {
  if (!node) return false;
  if (writeNodes.has(node)) return true;
  const writer = Object.hasOwn(PATH_WRITERS, node.type) ? PATH_WRITERS[node.type] : null;
  return writer ? writer(node, writeNodes) : false;
};
