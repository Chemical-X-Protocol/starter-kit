// Single-use const alias inlining on canonical blocks (engine doc section 2), applied to a fixpoint.
// `const k = e;` is inlined into the immediately next statement only when:
//   - k has exactly one reference in the whole block, and that reference is in the next statement;
//   - no statement sits in between (adjacency), so nothing can write in between;
//   - the reference is the first-evaluated operand of that statement, or e is pure (identifiers,
//     member reads, literals, operators, typeof).
// Extra soundness guards: the reference may not sit inside a nested function or a loop body/test
// (that would change how often e runs), and a member initializer is never moved into callee position
// (that would change `this`). Short-circuit order is never touched here.
import { evaluateRules } from '../rules.js';

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod',
  'ClassPrivateMethod'
]);
const LOOP_ONCE_SLOTS = { ForStatement: 'init', ForInStatement: 'right', ForOfStatement: 'right' };
const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const MEMBER_TYPES = new Set(['MemberExpression', 'OptionalMemberExpression']);
const CALL_SLOTS = new Set(['callee', 'tag']);
const PURE_TYPES = new Set([
  'Identifier', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral',
  'RegExpLiteral', 'MemberExpression', 'OptionalMemberExpression', 'PropName', 'UnaryExpression',
  'BinaryExpression', 'LogicalExpression', 'ConditionalExpression', 'TemplateLiteral', 'TemplateElement'
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
const BLOCK_LISTS = { BlockStatement: 'body', Program: 'body', StaticBlock: 'body', SwitchCase: 'consequent' };

const childList = (value) => (Array.isArray(value) ? value : [value]);

const entersBoundary = (node, key) => {
  const isFunction = FUNCTION_TYPES.has(node.type);
  const isRepeatedLoopSlot = LOOP_TYPES.has(node.type) && LOOP_ONCE_SLOTS[node.type] !== key;
  return isFunction || isRepeatedLoopSlot;
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
  const isDelete = node.type === 'UnaryExpression' && node.label.startsWith('operator:delete');
  const isPlainAssign = node.type === 'AssignmentExpression' && node.label === 'operator:=';
  const assignsIdentifier = isPlainAssign && node.kids.left?.type === 'Identifier';
  if (assignsIdentifier) return 'right';
  if (isDelete) return null;
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

/** Pure in the doc's sense: identifiers, member reads, literals, operators and typeof only. */
export const isPure = (node) => {
  const isDelete = node.type === 'UnaryExpression' && node.label.startsWith('operator:delete');
  const isPureType = PURE_TYPES.has(node.type) && !isDelete;
  if (!isPureType) return false;
  return Object.values(node.kids).every((value) => childList(value).every((child) => !child || isPure(child)));
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
    movesImpureWork: () => firstEvaluated(target) !== ref.node && !isPure(alias.init),
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

/** Applies inlining to every statement list in the canonical tree, innermost blocks first. */
export const inlineAliases = (node) => {
  for (const value of Object.values(node.kids)) {
    for (const child of childList(value)) child && inlineAliases(child);
  }
  const listKey = BLOCK_LISTS[node.type];
  if (listKey) node.kids[listKey] = inlineStatements(node.kids[listKey]);
  return node;
};
