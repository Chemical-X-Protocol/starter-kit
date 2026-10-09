// Single-use const alias inlining on canonical blocks (engine doc section 2), applied to a fixpoint.
// `const k = e;` is inlined into the immediately next statement only when:
//   - k has exactly one reference in the whole block, and that reference is in the next statement;
//   - no statement sits in between (adjacency), so nothing can write in between;
//   - the reference is the first-evaluated operand of that statement, or e is inert and nothing that
//     could run code completes inside the statement before the reference is evaluated.
// Inert (#2586): literals, non-global identifiers (plus undefined/NaN/Infinity) and !, typeof, void,
// ===, &&, ||, ??, ?: over inert operands. An inert e cannot throw and runs no user code, so it may move
// into a conditional or try slot (`u && n` keeps a crashing `u.name` out of the guard). Member reads,
// arithmetic, ==, templates and spreads are not inert: getters, valueOf and iterators run code.
// "Could run code" is everything but a short whitelist of node kinds (see SAFE_TYPES): `a = b, b = t`
// must keep t, and so must `o.y + k` (a getter) or `[...it, k]` (an iterator).
// Extra soundness guards: the reference may not sit inside a nested function, a class field
// initializer, a loop body/test or a destructuring pattern (defaults run conditionally, after the
// init), an alias of global eval is never inlined, a file with a direct eval or `with` is left alone,
// a const declared in a switch case is never inlined (its scope is the whole switch), and a member
// initializer is never moved into callee position (that would change `this`). Short-circuit order is
// never touched here. Child slots are visited in Babel VISITOR_KEYS order, which is evaluation order
// for every slot this pass can reach (loops, functions and patterns are boundaries).
import { evaluateRules } from '../rules.js';

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod',
  'ClassPrivateMethod'
]);
const LOOP_ONCE_SLOTS = { ForStatement: 'init', ForInStatement: 'right', ForOfStatement: 'right' };
const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const MEMBER_TYPES = new Set(['MemberExpression', 'OptionalMemberExpression']);
const CLASS_FIELD_TYPES = new Set(['ClassProperty', 'ClassPrivateProperty', 'ClassAccessorProperty']);
const PATTERN_TYPES = new Set(['ObjectPattern', 'ArrayPattern', 'AssignmentPattern', 'RestElement']);
const CALL_SLOTS = new Set(['callee', 'tag']);
const INERT_GLOBALS = new Set(['undefined', 'NaN', 'Infinity']);
const INERT_UNARY = new Set(['operator:! prefix', 'operator:typeof prefix', 'operator:void prefix']);
const INERT_COMPOUND = new Set(['LogicalExpression', 'ConditionalExpression']);
// Node kinds whose own evaluation runs no user code (operands are judged separately, in post-order).
const SAFE_TYPES = new Set([
  'PropName', 'KeyName', 'TemplateElement', 'ArrayExpression', 'ObjectExpression', 'ExpressionStatement',
  'BlockStatement', 'IfStatement', 'ReturnStatement', 'VariableDeclaration', 'EmptyStatement',
  'FunctionExpression', 'ArrowFunctionExpression', 'LogicalExpression', 'ConditionalExpression'
]);
const HEAD_SLOT = {
  ExpressionStatement: 'expression',
  IfStatement: 'test',
  ReturnStatement: 'argument',
  ThrowStatement: 'argument',
  SwitchStatement: 'discriminant',
  ForOfStatement: 'right',
  ForInStatement: 'right',
  VariableDeclaration: 'declarations',
  VariableDeclarator: 'init',
  UnaryExpression: 'argument',
  AwaitExpression: 'argument',
  BinaryExpression: 'left',
  LogicalExpression: 'left',
  ConditionalExpression: 'test',
  MemberExpression: 'object',
  OptionalMemberExpression: 'object',
  CallExpression: 'callee',
  OptionalCallExpression: 'callee',
  NewExpression: 'callee',
  TaggedTemplateExpression: 'tag',
  SequenceExpression: 'expressions',
  TemplateLiteral: 'expressions',
  ArrayExpression: 'elements',
  SpreadElement: 'argument'
};
// SwitchCase is left out on purpose: a const declared in one case is in scope in every case (#2586).
const BLOCK_LISTS = { BlockStatement: 'body', Program: 'body', StaticBlock: 'body' };

const childList = (value) => (Array.isArray(value) ? value : [value]);

/** Slots whose code runs later than the statement itself (function bodies, class field values). */
const isDeferredSlot = (node, key) => {
  const isFunction = FUNCTION_TYPES.has(node.type);
  const isFieldValue = CLASS_FIELD_TYPES.has(node.type) && key === 'value';
  return isFunction || isFieldValue;
};

const entersBoundary = (node, key) => {
  const isRepeatedLoopSlot = LOOP_TYPES.has(node.type) && LOOP_ONCE_SLOTS[node.type] !== key;
  return isDeferredSlot(node, key) || isRepeatedLoopSlot || PATTERN_TYPES.has(node.type);
};

const isDelete = (node) => node.type === 'UnaryExpression' && node.label.startsWith('operator:delete');
const isLiteral = (node) => node.lit !== null && node.lit !== undefined;

/** An identifier read that cannot throw or run code: a file binding, or undefined/NaN/Infinity. */
const isInertIdentifier = (node) => {
  const isGlobal = node.ident.origin === 'global';
  return !isGlobal || INERT_GLOBALS.has(node.label);
};

/** True when evaluating this node itself (not its operands) can run user code or write state. */
const mayRunCode = (node) => {
  const isValue = isLiteral(node);
  if (isValue) return false;
  const isIdentifier = node.type === 'Identifier';
  if (isIdentifier) return !isInertIdentifier(node);
  const isInertUnary = node.type === 'UnaryExpression' && INERT_UNARY.has(node.label);
  const isStrictEquality = node.type === 'BinaryExpression' && node.label === 'operator:===';
  const isPlainProperty = node.type === 'ObjectProperty' && !node.label.includes('computed');
  const isPlainDeclarator = node.type === 'VariableDeclarator' && node.kids.id?.type === 'Identifier';
  const isSafe = SAFE_TYPES.has(node.type) || isInertUnary || isStrictEquality || isPlainProperty || isPlainDeclarator;
  return !isSafe;
};

/**
 * True when anything that could run code completes before `target` reaches `refNode`. Post-order walk in
 * evaluation order: a node's own effect (a call, a write, a getter) is recorded only after its operands,
 * so ancestors of the reference never count, while earlier siblings (`a = b` in `a = b, b = t`) do.
 * Deferred code is skipped. Patterns are boundaries for the reference, so id-before-init order in a
 * declarator never hides an effect.
 */
export const hasEffectBefore = (target, refNode) => {
  let seenEffect = false;
  const visit = (node) => {
    const isReference = node === refNode;
    if (isReference) return true;
    for (const [key, value] of Object.entries(node.kids)) {
      const isSkipped = isDeferredSlot(node, key);
      const reached = !isSkipped && childList(value).some((child) => child && visit(child));
      if (reached) return true;
    }
    seenEffect = seenEffect || mayRunCode(node);
    return false;
  };
  visit(target);
  return seenEffect;
};

/** Every Identifier reference (not declaration) to bindingId under root, with its parent slot. */
export const findReferences = (root, bindingId) => {
  const found = [];
  const visit = (node, parent, key, crossesBoundary) => {
    const isMatch = node.type === 'Identifier' && node.ident.bindingId === bindingId && !node.ident.isDecl;
    if (isMatch) found.push({ node, parent, key, crossesBoundary });
    for (const [childKey, value] of Object.entries(node.kids)) {
      const isInside = crossesBoundary || entersBoundary(node, childKey);
      for (const child of childList(value)) child && visit(child, node, childKey, isInside);
    }
  };
  visit(root, null, null, false);
  return found;
};

const headSlotOf = (node) => {
  const isPlainAssign = node.type === 'AssignmentExpression' && node.label === 'operator:=';
  const assignsIdentifier = isPlainAssign && node.kids.left?.type === 'Identifier';
  if (assignsIdentifier) return 'right';
  if (isDelete(node)) return null;
  return HEAD_SLOT[node.type] ?? null;
};

/** The leaf reached by always descending into the operand that is evaluated first. */
export const firstEvaluated = (statement) => {
  let current = statement;
  let slot = headSlotOf(current);
  while (slot) {
    const next = childList(current.kids[slot])[0];
    if (!next) return null;
    current = next;
    slot = headSlotOf(current);
  }
  return current;
};

/** Inert: cannot throw and runs no user code, so it may move past or into any non-boundary slot. */
export const isInert = (node) => {
  const isInertNode = isLiteral(node) || INERT_COMPOUND.has(node.type) || !mayRunCode(node);
  const isOperatorNode = isInertNode && (node.type === 'Identifier' || isLiteral(node) || node.isExpr);
  if (!isOperatorNode) return false;
  return Object.values(node.kids).every((value) => childList(value).every((child) => !child || isInert(child)));
};

/** Constant: inert and reads no binding, so no write before the reference can change its value. */
const isConstant = (node) => {
  const isGlobalValue = node.type === 'Identifier' && node.ident.origin === 'global';
  const isLeafConstant = isLiteral(node) || (isGlobalValue && INERT_GLOBALS.has(node.label));
  const isLeaf = Object.keys(node.kids).length === 0;
  if (isLeaf) return isLeafConstant;
  return isInert(node) && Object.values(node.kids).every((value) => childList(value).every((child) => !child || isConstant(child)));
};

const isGlobalEval = (node) => node.type === 'Identifier' && node.ident.origin === 'global' && node.label === 'eval';

/** A direct eval or a with statement can read any local by name: inlining would be visible. */
const hasDynamicScope = (node) => {
  const isDirectEval = node.type === 'CallExpression' && isGlobalEval(node.kids.callee);
  const isDynamic = isDirectEval || node.type === 'WithStatement';
  if (isDynamic) return true;
  return Object.values(node.kids).some((value) => childList(value).some((child) => child && hasDynamicScope(child)));
};

const aliasOf = (statement) => {
  const isConst = statement.type === 'VariableDeclaration' && statement.label === 'kind:const';
  const declarators = isConst ? statement.kids.declarations : [];
  const isSingle = declarators.length === 1;
  const declarator = isSingle ? declarators[0] : null;
  const id = declarator?.kids.id;
  const init = declarator?.kids.init;
  const hasBinding = id?.type === 'Identifier' && typeof id.ident.bindingId === 'number';
  const isAlias = hasBinding && Boolean(init);
  return isAlias ? { bindingId: id.ident.bindingId, init } : null;
};

const isUsedOutside = (statements, index, bindingId) =>
  statements.some((statement, i) => i !== index && i !== index + 1 && findReferences(statement, bindingId).length > 0);

const planInline = (statements, index) => {
  const alias = aliasOf(statements[index]);
  if (!alias) return null;
  const target = statements[index + 1];
  const refs = findReferences(target, alias.bindingId);
  const ref = refs[0];
  const verdict = evaluateRules({
    notSingleUse: () => refs.length !== 1 || isUsedOutside(statements, index, alias.bindingId),
    crossesBoundary: () => ref.crossesBoundary,
    aliasesEval: () => isGlobalEval(alias.init),
    movesImpureWork: () => firstEvaluated(target) !== ref.node && !isInert(alias.init),
    effectRunsFirst: () => firstEvaluated(target) !== ref.node && !isConstant(alias.init) && hasEffectBefore(target, ref.node),
    rebindsThis: () => CALL_SLOTS.has(ref.key) && MEMBER_TYPES.has(alias.init.type)
  }, { failFast: true });
  return verdict.ok ? { ref, alias } : null;
};

const replaceChild = (parent, key, from, to) => {
  const value = parent.kids[key];
  const isList = Array.isArray(value);
  parent.kids[key] = isList ? value.map((item) => (item === from ? to : item)) : to;
};

const mergedLoc = (declaration, target) => {
  const hasBoth = Boolean(declaration.loc && target.loc);
  if (!hasBoth) return target.loc;
  return { ...target.loc, start: declaration.loc.start, startOffset: declaration.loc.startOffset };
};

/** Inlines eligible aliases in one statement list (mutates the canonical nodes, returns a new list). */
export const inlineStatements = (statements) => {
  const out = [...statements];
  let index = 0;
  while (index + 1 < out.length) {
    const plan = planInline(out, index);
    const step = plan ? -1 : 1;
    if (plan) {
      const target = out[index + 1];
      replaceChild(plan.ref.parent, plan.ref.key, plan.ref.node, plan.alias.init);
      target.loc = mergedLoc(out[index], target);
      out.splice(index, 1);
    }
    index = Math.max(0, index + step);
  }
  return out;
};

const inlineTree = (node) => {
  for (const value of Object.values(node.kids)) {
    for (const child of childList(value)) child && inlineTree(child);
  }
  const listKey = BLOCK_LISTS[node.type];
  if (listKey) node.kids[listKey] = inlineStatements(node.kids[listKey]);
  return node;
};

/**
 * Applies inlining to every statement list in the canonical tree, innermost blocks first. A tree with a
 * direct eval or `with` is returned as is.
 */
export const inlineAliases = (node) => (hasDynamicScope(node) ? node : inlineTree(node));
