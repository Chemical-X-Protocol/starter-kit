/**
 * Path coverage for shallow-catch escalation (truth spec 4.2): whether running a node always
 * writes a binding before any path out of it can reach the read, so that a write one branch alone
 * may skip still counts as a default when the if, conditional, switch or immediately invoked
 * function around it writes on every other path (if (c) v = 1; else v = 2) or leaves there
 * instead (if (c) v = 1; else return). writeNodes holds the binding's defaulting writes (=, ??=,
 * ||=). readUnwrittenPaths says how a node can be left with the binding unwritten: by running off
 * its end, or by a return, throw, break or continue; exitsPastAnchor says whether such an exit
 * skips the read, so the read is reachable only through a write. A loop that always runs its
 * body (while (true), for (;;), do-while), a try with its catch and finally, and a labeled
 * statement are followed too, and a throw in an invoked function leaves through its call.
 */
import * as t from '@babel/types';
import { EXIT_TYPES, isWithinNode } from './shallow-catch-reads.js';

const FUNCTION_EXPRESSION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression']);
const JUMP_TYPES = new Set(['BreakStatement', 'ContinueStatement']);
const WRITTEN = Object.freeze({ falls: false, exits: [] });
const FALLS = Object.freeze({ falls: true, exits: [] });
const OUTSIDE_TARGETS = Object.freeze({ loops: 0, breakables: 0, labels: [] });

// A plain function expression or arrow called where it is written runs its body there, as
// (() => { v = d; })() does. An async or generator body may pause or never start.
const isImmediatelyInvoked = (fnNode, parent) => {
  const isCallee = t.isCallExpression(parent) && parent.callee === fnNode;
  const runsAtOnce = FUNCTION_EXPRESSION_TYPES.has(fnNode.type) && !fnNode.async && !fnNode.generator;
  return isCallee && runsAtOnce;
};

const listChildNodes = (node) => (t.VISITOR_KEYS[node.type] ?? [])
  .flatMap((key) => [node[key]].flat())
  .filter((child) => Boolean(child?.type));

// Whether a break or continue lands on a loop, switch or label inside the node being read.
const isAimedInside = (jump, inside) => {
  if (jump.label) return inside.labels.includes(jump.label.name);
  const targets = t.isBreakStatement(jump) ? inside.breakables : inside.loops;
  return targets > 0;
};

// The return, throw, break and continue statements in node that leave it: none in a nested
// function, and no break or continue that lands on a loop, switch or label inside node.
const collectEscapingExits = (node, inside = OUTSIDE_TARGETS) => {
  if (t.isFunction(node)) return [];
  const isJump = JUMP_TYPES.has(node.type);
  if (isJump) return isAimedInside(node, inside) ? [] : [node];
  if (EXIT_TYPES.has(node.type)) return [node];
  const isLoop = t.isLoop(node);
  const isBreakable = isLoop || t.isSwitchStatement(node);
  const nested = {
    loops: inside.loops + Number(isLoop),
    breakables: inside.breakables + Number(isBreakable),
    labels: t.isLabeledStatement(node) ? [...inside.labels, node.label.name] : inside.labels
  };
  return listChildNodes(node).flatMap((child) => collectEscapingExits(child, nested));
};

const joinPaths = (outcomes) => ({
  falls: outcomes.some((paths) => paths.falls),
  exits: outcomes.flatMap((paths) => paths.exits)
});

// A statement list or sequence runs each part in turn: it collects the exits of every part that
// runs before one no unwritten path gets past, and runs off its end when every part may.
const readListPaths = (parts, writeNodes) => {
  const exits = [];
  for (const part of parts) {
    const paths = readUnwrittenPaths(part, writeNodes);
    exits.push(...paths.exits);
    if (!paths.falls) return { falls: false, exits };
  }
  return { falls: true, exits };
};

const readBranchPaths = (node, writeNodes) => joinPaths([node.consequent, node.alternate].map((branch) => readUnwrittenPaths(branch, writeNodes)));

const isOwnBreak = (exit) => t.isBreakStatement(exit) && !exit.label;
const isOwnJump = (exit) => JUMP_TYPES.has(exit.type) && !exit.label;

// A loop test that always holds: none (for (;;)), true, or a number other than 0.
const isAlwaysTrue = (test) => {
  const isTrueLiteral = t.isBooleanLiteral(test, { value: true });
  const isNonZeroNumber = t.isNumericLiteral(test) && test.value !== 0;
  return !test || isTrueLiteral || isNonZeroNumber;
};

// A loop whose test always holds leaves only through a break of its own: running off the body's
// end or a continue of its own runs the body again. A do-while runs its body once, then its own
// continue or the end of the body reaches a test that may end it. Any other loop may not run its
// body at all. A for loop runs its init first.
const readLoopPaths = (node, writeNodes) => {
  const runsForever = isAlwaysTrue(node.test);
  const runsBody = runsForever || t.isDoWhileStatement(node);
  if (!runsBody) return { falls: true, exits: collectEscapingExits(node) };
  const init = readUnwrittenPaths(node.init, writeNodes);
  if (!init.falls) return init;
  const body = readUnwrittenPaths(node.body, writeNodes);
  const endsUnwritten = runsForever ? body.exits.some(isOwnBreak) : body.falls || body.exits.some(isOwnJump);
  return { falls: endsUnwritten, exits: [...init.exits, ...body.exits.filter((exit) => !isOwnJump(exit))] };
};

// A try may throw anywhere in its block, so its catch may start before any write there: a throw
// in the block lands in the catch, and the try leaves as the block or the catch does. A finally
// runs on every way out, so one that never runs off its end unwritten decides alone.
const readTryPaths = (node, writeNodes) => {
  const block = readUnwrittenPaths(node.block, writeNodes);
  const uncaught = { falls: block.falls, exits: block.exits.filter((exit) => !t.isThrowStatement(exit)) };
  const tried = node.handler ? joinPaths([uncaught, readUnwrittenPaths(node.handler.body, writeNodes)]) : block;
  if (!node.finalizer) return tried;
  const final = readUnwrittenPaths(node.finalizer, writeNodes);
  return final.falls ? { falls: tried.falls, exits: [...tried.exits, ...final.exits] } : final;
};

// A labeled statement runs its body; a break or continue to its label may end it unwritten.
const readLabeledPaths = (node, writeNodes) => {
  const paths = readUnwrittenPaths(node.body, writeNodes);
  const isToLabel = (exit) => exit.label?.name === node.label.name;
  return { falls: paths.falls || paths.exits.some(isToLabel), exits: paths.exits.filter((exit) => !isToLabel(exit)) };
};

// Entering a switch at a case runs it and falls through the cases after it. With no default a
// value may match no case, and a break of the switch's own ends it unwritten.
const readSwitchPaths = (node, writeNodes) => {
  const hasDefault = node.cases.some((switchCase) => !switchCase.test);
  const entries = node.cases.map((_, index) => readListPaths(node.cases.slice(index).flatMap((switchCase) => switchCase.consequent), writeNodes));
  const paths = joinPaths(hasDefault ? entries : [...entries, FALLS]);
  return { falls: paths.falls || paths.exits.some(isOwnBreak), exits: paths.exits.filter((exit) => !isOwnBreak(exit)) };
};

// An invoked function runs its body at the call: a return there ends the call unwritten, and
// only a throw leaves past it.
const readCallPaths = (node, writeNodes) => {
  const isInvoked = isImmediatelyInvoked(node.callee, node);
  if (!isInvoked) return FALLS;
  const paths = readUnwrittenPaths(node.callee.body, writeNodes);
  const hasReturn = paths.exits.some((exit) => t.isReturnStatement(exit));
  return { falls: paths.falls || hasReturn, exits: paths.exits.filter((exit) => !t.isReturnStatement(exit)) };
};

// Node types whose paths readUnwrittenPaths follows; any other node may run off its end unwritten.
const PATH_READERS = Object.freeze({
  ExpressionStatement: (node, writeNodes) => readUnwrittenPaths(node.expression, writeNodes),
  SequenceExpression: (node, writeNodes) => readListPaths(node.expressions, writeNodes),
  BlockStatement: (node, writeNodes) => readListPaths(node.body, writeNodes),
  IfStatement: readBranchPaths,
  ConditionalExpression: readBranchPaths,
  SwitchStatement: readSwitchPaths,
  CallExpression: readCallPaths,
  WhileStatement: readLoopPaths,
  ForStatement: readLoopPaths,
  DoWhileStatement: readLoopPaths,
  TryStatement: readTryPaths,
  LabeledStatement: readLabeledPaths
});

/**
 * How running node can leave the binding unwritten: { falls, exits }. falls is true when a path
 * may run off its end before any write in writeNodes; exits lists the return, throw, break and
 * continue statements that may leave it before one. The write itself, a statement list holding one
 * before anything that may leave it, an if or a conditional, a switch through its cases, an
 * immediately invoked function, a loop, a try and a labeled statement are followed; any other
 * node may run off its end, with the exits inside it that leave it.
 */
export const readUnwrittenPaths = (node, writeNodes) => {
  if (!node) return FALLS;
  if (writeNodes.has(node)) return WRITTEN;
  const isExit = EXIT_TYPES.has(node.type);
  if (isExit) return { falls: false, exits: [node] };
  const reader = Object.hasOwn(PATH_READERS, node.type) ? PATH_READERS[node.type] : null;
  return reader ? reader(node, writeNodes) : { falls: true, exits: collectEscapingExits(node) };
};

// A throw leaves an immediately invoked function for the code around its call, unless that
// function holds the anchor, whose rest it then skips.
const isThrowTarget = (p, anchor) => {
  const isPassedThrough = p.isFunction() && isImmediatelyInvoked(p.node, p.parent) && !isWithinNode(anchor, p.node);
  return p.isProgram() || (p.isFunction() && !isPassedThrough);
};

// The statement an exit leaves, above coverPath: the function (or the program) for a return, and
// for a throw the first one it does not leave through a call, the body of its label for a labeled
// break or continue, otherwise the nearest loop, or for a break the nearest loop or switch.
const findExitTarget = (exit, coverPath, anchor) => {
  const label = exit.label?.name;
  if (label) {
    const labeled = coverPath.findParent((p) => p.isLabeledStatement() && p.node.label.name === label);
    return labeled ? labeled.get('body') : null;
  }
  if (t.isThrowStatement(exit)) return coverPath.findParent((p) => isThrowTarget(p, anchor));
  const isJump = JUMP_TYPES.has(exit.type);
  if (!isJump) return coverPath.findParent((p) => p.isFunction() || p.isProgram());
  const isBreak = t.isBreakStatement(exit);
  return coverPath.findParent((p) => p.isLoop() || (isBreak && p.isSwitchStatement()));
};

// A try between an exit and its target catches a throw from its block, and on the way out runs its
// finally, which reads the binding unwritten when it holds the anchor.
const isStoppedByTry = (tryPath, exit, coverNode, anchor) => {
  const { block, handler, finalizer } = tryPath.node;
  const isCaught = t.isThrowStatement(exit) && Boolean(handler) && isWithinNode(coverNode, block);
  const runsReadingFinally = Boolean(finalizer) && !isWithinNode(coverNode, finalizer) && isWithinNode(anchor, finalizer);
  return isCaught || runsReadingFinally;
};

/**
 * Whether an exit that leaves coverPath's node unwritten also skips anchor (the read, or for an
 * earlier write the try): its target holds the anchor, so the exit leaves the rest of the target
 * with it, no try on the way catches it or reads the anchor in a finally, and it is not a continue
 * into a do-while, whose test runs after the body.
 */
export const exitsPastAnchor = (exit, coverPath, anchor) => {
  const target = findExitTarget(exit, coverPath, anchor);
  const skipsAnchor = Boolean(target) && isWithinNode(anchor, target.node);
  if (!skipsAnchor) return false;
  const isDoWhileContinue = t.isContinueStatement(exit) && target.isDoWhileStatement();
  if (isDoWhileContinue) return false;
  for (let p = coverPath.parentPath; p && p.node !== target.node; p = p.parentPath) {
    const isStopped = p.isTryStatement() && isStoppedByTry(p, exit, coverPath.node, anchor);
    if (isStopped) return false;
  }
  return true;
};

/**
 * Whether every path through coverPath's node that can still reach anchor writes the binding
 * first: none runs off its end unwritten, and each exit that leaves it unwritten skips anchor.
 * context holds the binding's writeNodes and paths, a cache of readUnwrittenPaths per node.
 */
export const writesOnEveryPath = (coverPath, anchor, context) => {
  const isKnown = context.paths.has(coverPath.node);
  if (!isKnown) context.paths.set(coverPath.node, readUnwrittenPaths(coverPath.node, context.writeNodes));
  const { falls, exits } = context.paths.get(coverPath.node);
  return !falls && exits.every((exit) => exitsPastAnchor(exit, coverPath, anchor));
};
