/**
 * Path coverage for shallow-catch escalation (truth spec 4.2): whether running a node always
 * writes a binding before any path out of it can reach the read, so that a write one branch alone
 * may skip still counts as a default when the if, conditional, switch or immediately invoked
 * function around it writes on every other path (if (c) v = 1; else v = 2) or leaves there
 * instead (if (c) v = 1; else return). context.writeNodes holds the binding's defaulting writes
 * (=, ??=, ||=). readUnwrittenPaths says how a node can be left with the binding unwritten: by
 * running off its end, by a return, throw, break or continue, or paused at an await;
 * exitsPastAnchor says whether such an exit skips the read, so the read is reachable only through
 * a write. A loop that always runs its body (for (;;), a do-while, or a test Babel evaluates to a
 * truthy constant: while (true), while (!0)), a try with its catch and finally, and a labeled
 * statement are followed too, and a throw in a synchronous invoked function leaves through its
 * call. An await pauses an invoked async function, whose call then ends unwritten
 * (shallow-catch-invocation.js).
 */
import * as t from '@babel/types';
import { EXIT_TYPES, isWithinNode } from './shallow-catch-reads.js';
import { findInvokedFunction, isPause, isRunAtOnce } from './shallow-catch-invocation.js';

const JUMP_TYPES = new Set(['BreakStatement', 'ContinueStatement']);
const WRITTEN = Object.freeze({ falls: false, exits: [] });
const FALLS = Object.freeze({ falls: true, exits: [] });
const OUTSIDE_TARGETS = Object.freeze({ loops: 0, breakables: 0, labels: [] });

const listChildNodes = (node) => (t.VISITOR_KEYS[node.type] ?? [])
  .flatMap((key) => [node[key]].flat())
  .filter((child) => Boolean(child?.type));

// Whether a break or continue lands on a loop, switch or label inside the node being read.
const isAimedInside = (jump, inside) => {
  if (jump.label) return inside.labels.includes(jump.label.name);
  const targets = t.isBreakStatement(jump) ? inside.breakables : inside.loops;
  return targets > 0;
};

// The return, throw, break and continue statements in node that leave it, and the awaits that
// pause it: none in a nested function, and no break or continue that lands on a loop, switch or
// label inside node. A for await loop pauses at its head.
const collectEscapingExits = (node, inside = OUTSIDE_TARGETS) => {
  if (t.isFunction(node)) return [];
  const isJump = JUMP_TYPES.has(node.type);
  if (isJump) return isAimedInside(node, inside) ? [] : [node];
  const isLeaf = EXIT_TYPES.has(node.type) || t.isAwaitExpression(node);
  if (isLeaf) return [node];
  const isLoop = t.isLoop(node);
  const isBreakable = isLoop || t.isSwitchStatement(node);
  const nested = {
    loops: inside.loops + Number(isLoop),
    breakables: inside.breakables + Number(isBreakable),
    labels: t.isLabeledStatement(node) ? [...inside.labels, node.label.name] : inside.labels
  };
  const exits = listChildNodes(node).flatMap((child) => collectEscapingExits(child, nested));
  return isPause(node) ? [node, ...exits] : exits;
};

// Any node readUnwrittenPaths does not follow may run off its end, or leave through its exits.
const readOtherPaths = (node) => ({ falls: true, exits: collectEscapingExits(node) });

const joinPaths = (outcomes) => ({
  falls: outcomes.some((paths) => paths.falls),
  exits: outcomes.flatMap((paths) => paths.exits)
});

// Awaits in the parts that run first (an if test, a switch discriminant, a call's arguments)
// pause an async function before anything the node writes.
const withHeadPauses = (headPaths, paths) => {
  const pauses = headPaths.flatMap((headPath) => collectEscapingExits(headPath.node));
  return pauses.length > 0 ? { falls: paths.falls, exits: [...pauses, ...paths.exits] } : paths;
};

// A write that awaits (v = await g()) pauses before it writes.
const readWritePaths = (node) => {
  const pauses = collectEscapingExits(node);
  return pauses.length > 0 ? { falls: false, exits: pauses } : WRITTEN;
};

// A statement list or sequence runs each part in turn: it collects the exits of every part that
// runs before one no unwritten path gets past, and runs off its end when every part may.
const readListPaths = (parts, context) => {
  const exits = [];
  for (const part of parts) {
    const paths = readUnwrittenPaths(part, context);
    exits.push(...paths.exits);
    if (!paths.falls) return { falls: false, exits };
  }
  return { falls: true, exits };
};

const readBranchPaths = (path, context) => {
  const branches = joinPaths([path.get('consequent'), path.get('alternate')].map((branch) => readUnwrittenPaths(branch, context)));
  return withHeadPauses([path.get('test')], branches);
};

const isOwnBreak = (exit) => t.isBreakStatement(exit) && !exit.label;
const isOwnJump = (exit) => JUMP_TYPES.has(exit.type) && !exit.label;

// A loop test that always holds: none (for (;;)), or one Babel evaluates, confidently, to a
// truthy value (true, 1, !0, -1, 'x'). while (0) and while (k) may not run the body.
const isAlwaysTrue = (loopPath) => {
  if (!loopPath.node.test) return true;
  const { confident, value } = loopPath.get('test').evaluate();
  return confident && Boolean(value);
};

// A loop whose test always holds leaves only through a break of its own: running off the body's
// end or a continue of its own runs the body again. A do-while runs its body once, then its own
// continue or the end of the body reaches a test that may end it. Any other loop may not run its
// body at all. A for loop runs its init first.
const readLoopPaths = (path, context) => {
  const runsForever = isAlwaysTrue(path);
  const runsBody = runsForever || path.isDoWhileStatement();
  if (!runsBody) return readOtherPaths(path.node);
  const init = readUnwrittenPaths(path.get('init'), context);
  if (!init.falls) return init;
  const body = readUnwrittenPaths(path.get('body'), context);
  const endsUnwritten = runsForever ? body.exits.some(isOwnBreak) : body.falls || body.exits.some(isOwnJump);
  return { falls: endsUnwritten, exits: [...init.exits, ...body.exits.filter((exit) => !isOwnJump(exit))] };
};

// A try may throw anywhere in its block, so its catch may start before any write there: a throw
// in the block lands in the catch, and the try leaves as the block or the catch does. A finally
// runs on every way out, so one that never runs off its end unwritten decides alone.
const readTryPaths = (path, context) => {
  const block = readUnwrittenPaths(path.get('block'), context);
  const uncaught = { falls: block.falls, exits: block.exits.filter((exit) => !t.isThrowStatement(exit)) };
  const tried = path.node.handler ? joinPaths([uncaught, readUnwrittenPaths(path.get('handler.body'), context)]) : block;
  if (!path.node.finalizer) return tried;
  const final = readUnwrittenPaths(path.get('finalizer'), context);
  return final.falls ? { falls: tried.falls, exits: [...tried.exits, ...final.exits] } : final;
};

// A labeled statement runs its body; a break or continue to its label may end it unwritten.
const readLabeledPaths = (path, context) => {
  const paths = readUnwrittenPaths(path.get('body'), context);
  const isToLabel = (exit) => exit.label?.name === path.node.label.name;
  return { falls: paths.falls || paths.exits.some(isToLabel), exits: paths.exits.filter((exit) => !isToLabel(exit)) };
};

// Entering a switch at a case runs it and falls through the cases after it. With no default a
// value may match no case, and a break of the switch's own ends it unwritten.
const readSwitchPaths = (path, context) => {
  const cases = path.get('cases');
  const hasDefault = cases.some((casePath) => !casePath.node.test);
  const entries = cases.map((_, index) => readListPaths(cases.slice(index).flatMap((casePath) => casePath.get('consequent')), context));
  const paths = joinPaths(hasDefault ? entries : [...entries, FALLS]);
  const ended = { falls: paths.falls || paths.exits.some(isOwnBreak), exits: paths.exits.filter((exit) => !isOwnBreak(exit)) };
  return withHeadPauses([path.get('discriminant')], ended);
};

// An invoked function runs its body at the call, once the callee and the arguments ran. In a
// synchronous body a return ends the call unwritten and a throw leaves past it. An async body
// ends the call at a return, a throw or an await (its promise settles or waits), so the code
// after the call goes on unwritten. Any other call may run off its end.
const readInvocationPaths = (path, context) => {
  const fnPath = findInvokedFunction(path);
  if (!fnPath) return readOtherPaths(path.node);
  const body = readUnwrittenPaths(fnPath.get('body'), context);
  const isAsync = fnPath.node.async;
  const endsCall = (exit) => isAsync || t.isReturnStatement(exit);
  const called = { falls: body.falls || body.exits.some(endsCall), exits: body.exits.filter((exit) => !endsCall(exit)) };
  return withHeadPauses([path.get('callee'), ...path.get('arguments')], called);
};

// await runs its argument, then pauses: a path that reaches it unwritten may end an invoked async
// function's call there.
const readAwaitPaths = (path, context) => {
  const argument = readUnwrittenPaths(path.get('argument'), context);
  return argument.falls ? { falls: true, exits: [...argument.exits, path.node] } : argument;
};

// Node types whose paths readUnwrittenPaths follows; any other node may run off its end unwritten.
const PATH_READERS = Object.freeze({
  ExpressionStatement: (path, context) => readUnwrittenPaths(path.get('expression'), context),
  SequenceExpression: (path, context) => readListPaths(path.get('expressions'), context),
  BlockStatement: (path, context) => readListPaths(path.get('body'), context),
  IfStatement: readBranchPaths,
  ConditionalExpression: readBranchPaths,
  SwitchStatement: readSwitchPaths,
  CallExpression: readInvocationPaths,
  OptionalCallExpression: readInvocationPaths,
  NewExpression: readInvocationPaths,
  AwaitExpression: readAwaitPaths,
  WhileStatement: readLoopPaths,
  ForStatement: readLoopPaths,
  DoWhileStatement: readLoopPaths,
  TryStatement: readTryPaths,
  LabeledStatement: readLabeledPaths
});

const readNodePaths = (path, context) => {
  const node = path.node;
  if (context.writeNodes.has(node)) return readWritePaths(node);
  const isExit = EXIT_TYPES.has(node.type);
  if (isExit) return { falls: false, exits: [node] };
  const reader = Object.hasOwn(PATH_READERS, node.type) ? PATH_READERS[node.type] : null;
  return reader ? reader(path, context) : readOtherPaths(node);
};

/**
 * How running path's node can leave the binding unwritten: { falls, exits }. falls is true when a
 * path may run off its end before any write in context.writeNodes; exits lists the return, throw,
 * break and continue statements that may leave it before one, and the awaits that may pause it.
 * The write itself, a statement list holding one before anything that may leave it, an if or a
 * conditional, a switch through its cases, an invoked function, an await, a loop, a try and a
 * labeled statement are followed; any other node may run off its end, with the exits inside it
 * that leave it. context.paths caches the answer per node for the binding.
 */
export const readUnwrittenPaths = (path, context) => {
  const node = path?.node;
  if (!node) return FALLS;
  const isKnown = context.paths.has(node);
  if (!isKnown) context.paths.set(node, readNodePaths(path, context));
  return context.paths.get(node);
};

/** Whether running path's node may run off its end, whatever it writes: catch { return; } never does. */
export const mayRunOffEnd = (path) => readUnwrittenPaths(path, { writeNodes: new Set(), paths: new Map() }).falls;

// A throw leaves a synchronous invoked function for the code around its call, unless that
// function holds the anchor, whose rest it then skips.
const isThrowTarget = (p, anchor) => {
  const isPassedThrough = p.isFunction() && isRunAtOnce(p) && !isWithinNode(anchor, p.node);
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
 * An await pauses only an invoked async function's call (readInvocationPaths); anywhere else the
 * code goes on after it. context holds the binding's writeNodes and paths, a cache of
 * readUnwrittenPaths per node.
 */
export const writesOnEveryPath = (coverPath, anchor, context) => {
  const { falls, exits } = readUnwrittenPaths(coverPath, context);
  const leaves = exits.filter((exit) => !isPause(exit));
  return !falls && leaves.every((exit) => exitsPastAnchor(exit, coverPath, anchor));
};
