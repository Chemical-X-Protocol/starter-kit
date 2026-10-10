// Script units of one canonical Program (engine doc section 1):
//   fn    bodies of function declarations/expressions, arrows, class and object methods, hashed together
//         with a signature node (#2586): arrow or function, async, generator, accessor kind and every
//         param's canonical pattern (defaults, destructuring, rest), so param binders are numbered
//         first and `(a, b)` never equals `(b, a)`. paramNames and signature { kind, fp1 } are kept as
//         meta; decl_name comes from the id, the VariableDeclarator, the property or method key, or an
//         assignment target.
//   stmt  every canonical statement of every BlockStatement, with blockId and ordinal (a try is one
//         unit). Program-level statements are not stmt units, and neither is the `{ return e }` made
//         from an expression-bodied arrow (it is exactly the arrow's fn unit).
//   expr  a logical, conditional, call or new expression that is a whole initializer, return argument,
//         call argument or expression statement (never a sub-operand), kept only when E >= 18,
//         mass >= 8 and it has at least 2 non-ubiquitous anchors; at most 200 per file. Two readings
//         of "whole": an if test counts too, because alias inlining moves named initializers there
//         (`const isOutside = e; if (isOutside)` becomes `if (e)`), and leading `!`s are looked
//         through, because De Morgan turns `!x && !y` into `!(x || y)`. Each expr unit records its
//         slot (init, test, argument, expression or arguments) for the store floor.
// One preorder pass lists the unit tops; unit-hash.js then fingerprints all of them from one walk of
// the Program (#2554), so a node is hashed once per file however many units contain it.
import { createUnitHasher } from './unit-hash.js';
import { anchorWeight, countNonUbiquitous, evidence } from './anchors.js';

export const EXPR_GATE = Object.freeze({ minEvidence: 18, minMass: 8, minAnchors: 2, maxPerFile: 200 });

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod',
  'ClassPrivateMethod'
]);
const EXPR_TYPES = new Set([
  'LogicalNary', 'LogicalExpression', 'ConditionalExpression', 'CallExpression', 'OptionalCallExpression',
  'NewExpression'
]);
const EXPR_SLOTS = {
  VariableDeclarator: 'init',
  IfStatement: 'test',
  ReturnStatement: 'argument',
  ExpressionStatement: 'expression',
  CallExpression: 'arguments',
  OptionalCallExpression: 'arguments',
  NewExpression: 'arguments'
};
const NAMED_SLOTS = {
  VariableDeclarator: { slot: 'init', from: (parent) => parent.kids.id },
  ObjectProperty: { slot: 'value', from: (parent) => parent.kids.key },
  ClassProperty: { slot: 'value', from: (parent) => parent.kids.key },
  AssignmentExpression: { slot: 'right', from: (parent) => parent.kids.left?.kids?.property ?? parent.kids.left }
};

const childList = (value) => (Array.isArray(value) ? value : [value]);

const nameFrom = (node) => {
  const isNamed = node?.type === 'Identifier' || node?.type === 'KeyName' || node?.type === 'PropName';
  return isNamed ? node.label : null;
};

const declNameOf = (fn, parent, key) => {
  const ownName = nameFrom(fn.kids.id) ?? nameFrom(fn.kids.key);
  if (ownName) return ownName;
  const naming = NAMED_SLOTS[parent?.type];
  const isNamedSlot = naming?.slot === key;
  return isNamedSlot ? nameFrom(naming.from(parent)) : null;
};

const paramNameOf = (param) => {
  const isAssignment = param.type === 'AssignmentPattern';
  const target = isAssignment ? param.kids.left : param;
  const isRest = target.type === 'RestElement';
  const inner = isRest ? target.kids.argument : target;
  const name = nameFrom(inner) ?? `<${inner.type}>`;
  return isRest ? `...${name}` : name;
};

const ACCESSOR_KINDS = new Set(['kind:get', 'kind:set', 'kind:constructor']);
const METHOD_TYPES = new Set(['ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);
const BASE_KINDS = { ArrowFunctionExpression: 'arrow' };

/**
 * 'arrow', 'method' (no [[Construct]], no .prototype) or 'function', then async, generator, an accessor
 * kind when present, and 'sloppy' for code of a non-strict script (#2594: `this`, arguments and
 * undeclared writes behave differently there).
 */
const signatureKind = (fn, isSloppy = false) => {
  const flags = new Set(fn.label.split(' '));
  const accessor = [...flags].find((flag) => ACCESSOR_KINDS.has(flag)) ?? null;
  const base = BASE_KINDS[fn.type] ?? (METHOD_TYPES.has(fn.type) ? 'method' : 'function');
  const modifiers = ['async', 'generator'].filter((flag) => flags.has(flag));
  return [base, ...modifiers, accessor, isSloppy ? 'sloppy' : null].filter(Boolean).join(' ');
};

/** Leaf hashed ahead of stmt and expr units of a sloppy script, so they never meet strict code. */
const SLOPPY_MARK = Object.freeze({ type: 'SloppyScript', label: '', kids: {}, isExpr: false, loc: null, ident: null, lit: null });

const windowOf = (nodes) => ({ type: 'Window', label: '', kids: { body: nodes }, isExpr: false, loc: null, ident: null, lit: null });

const signatureNode = (fn, isSloppy) => ({
  type: 'FnSignature',
  label: signatureKind(fn, isSloppy),
  kids: { params: fn.kids.params ?? [] },
  isExpr: false,
  loc: null,
  ident: null,
  lit: null
});

/**
 * A unit row: kind, the node's span, the kind's meta (in its key order), then the hasher's fields.
 * Built key by key instead of from object spreads: this runs once per unit of every file (#5911).
 */
const unitOf = (kind, node, meta, hashed) => {
  const loc = node.loc;
  const unit = { kind, start: loc?.start ?? null, end: loc?.end ?? null, startOffset: loc?.startOffset ?? null, endOffset: loc?.endOffset ?? null };
  for (const key in meta) unit[key] = meta[key];
  for (const key in hashed) unit[key] = hashed[key];
  return unit;
};

const isNegation = (node) => node.type === 'UnaryExpression' && node.label === 'operator:! prefix';

/** The expr-unit candidate at this slot: the node itself, or what its leading `!`s negate. */
const exprCandidateOf = (node, parent, key) => {
  const isExprSlot = EXPR_SLOTS[parent?.type] === key;
  if (!isExprSlot) return null;
  let candidate = node;
  while (isNegation(candidate)) candidate = candidate.kids.argument;
  return EXPR_TYPES.has(candidate.type) ? candidate : null;
};

const passesExprGate = (hashed, ubiquitous) => {
  const weight = anchorWeight(hashed.anchors, ubiquitous);
  const isHeavy = evidence(hashed.mass, weight) >= EXPR_GATE.minEvidence;
  const isMassive = hashed.mass >= EXPR_GATE.minMass;
  const isAnchored = countNonUbiquitous(hashed.anchors, ubiquitous) >= EXPR_GATE.minAnchors;
  return isHeavy && isMassive && isAnchored;
};

/**
 * The unit tops of a Program in preorder (source order): { requests, wanted }. A request is
 * { kind: 'fn', node, parent, key }, { kind: 'stmt', node, blockId, ordinal } or
 * { kind: 'expr', node, slot }; wanted holds every node the hasher must keep a record of.
 */
const unitRequestsOf = (program) => {
  const requests = [];
  const wanted = new Set();
  let blockCount = 0;

  const requestFn = (node, parent, key) => {
    requests.push({ kind: 'fn', node, parent, key });
    wanted.add(node).add(node.kids.body);
    for (const param of node.kids.params ?? []) param && wanted.add(param);
  };

  const requestBlock = (node) => {
    blockCount += 1;
    const blockId = blockCount;
    node.kids.body.forEach((statement, ordinal) => {
      requests.push({ kind: 'stmt', node: statement, blockId, ordinal });
      wanted.add(statement);
    });
  };

  const requestExpr = (candidate, slot) => {
    requests.push({ kind: 'expr', node: candidate, slot });
    wanted.add(candidate);
  };

  const visit = (node, parent, key) => {
    const { kids } = node;
    const isFunction = FUNCTION_TYPES.has(node.type) && kids.body?.type === 'BlockStatement';
    if (isFunction) requestFn(node, parent, key);
    const isUnitBlock = node.type === 'BlockStatement' && !node.isArrowBody;
    if (isUnitBlock) requestBlock(node);
    const candidate = exprCandidateOf(node, parent, key);
    if (candidate) requestExpr(candidate, key);
    for (const childKey in kids) {
      const value = kids[childKey];
      const isList = Array.isArray(value);
      if (isList) for (const child of value) child && visit(child, node, childKey);
      else if (value) visit(value, node, childKey);
    }
  };

  visit(program, null, null);
  return { requests, wanted };
};

/**
 * Collects fn, stmt and expr units from a canonical Program (canonicalize.js).
 * options.ubiquitous: Set of facet-ubiquitous anchors (weight 0) for the expr gate. options.isSloppy:
 * the program is a non-strict script (see isSloppyProgram). options.createHasher(program, wanted):
 * the fingerprinting strategy, { sizeOf(node), hashTop(top, scopeNode) }; default unit-hash.js
 * (unit-hash.equivalence.spec.js passes one built on hash.js).
 * Returns { units, isExprCapped }; units are in preorder, which is source order.
 */
export const collectScriptUnits = (program, { ubiquitous = new Set(), isSloppy = false, createHasher = createUnitHasher } = {}) => {
  const { requests, wanted } = unitRequestsOf(program);
  const hasher = createHasher(program, wanted);
  const hashCode = (node) => hasher.hashTop(isSloppy ? windowOf([SLOPPY_MARK, node]) : node, node);
  const units = [];
  let exprCount = 0;
  let isExprCapped = false;

  const addFn = ({ node, parent, key }) => {
    const params = node.kids.params ?? [];
    const signature = signatureNode(node, isSloppy);
    const hashed = hasher.hashTop(windowOf([signature, node.kids.body]), node);
    const signatureMeta = { kind: signature.label, fp1: hasher.hashTop(signature, node).fp1 };
    const named = { declName: declNameOf(node, parent, key), paramNames: params.map(paramNameOf), signature: signatureMeta };
    units.push(unitOf('fn', node, named, hashed));
  };

  const addStmt = ({ node, blockId, ordinal }) => {
    units.push(unitOf('stmt', node, { blockId, ordinal }, hashCode(node)));
  };

  // A candidate under EXPR_GATE.minMass canonical nodes cannot pass the gate, so it is not hashed.
  const addExpr = ({ node, slot }) => {
    const isLightweight = hasher.sizeOf(node) < EXPR_GATE.minMass;
    if (isLightweight) return;
    const hashed = hashCode(node);
    const isKept = passesExprGate(hashed, ubiquitous);
    const hasRoom = exprCount < EXPR_GATE.maxPerFile;
    isExprCapped = isExprCapped || (isKept && !hasRoom);
    const shouldStore = isKept && hasRoom;
    if (shouldStore) units.push(unitOf('expr', node, { slot }, hashed));
    exprCount += shouldStore ? 1 : 0;
  };

  const adders = { fn: addFn, stmt: addStmt, expr: addExpr };
  for (const request of requests) adders[request.kind](request);
  return { units, isExprCapped };
};

const ALWAYS_STRICT = /\.(mjs|mts|vue)$/;
const ALWAYS_SCRIPT = /\.(cjs|cts)$/;
const MODULE_SYNTAX = new Set(['ImportDeclaration', 'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportAllDeclaration']);

const COMMONJS_GLOBALS = new Set(['require', 'module', 'exports', '__dirname', '__filename']);

const usesCommonJsGlobal = (node) => {
  const isGlobalName = node.type === 'Identifier' && node.ident?.origin === 'global' && COMMONJS_GLOBALS.has(node.label);
  if (isGlobalName) return true;
  return Object.values(node.kids).some((value) => childList(value).some((child) => child && usesCommonJsGlobal(child)));
};

/**
 * True when a canonical Program runs as sloppy-mode CommonJS code (#2594): a .cjs/.cts file, or a script
 * with no import/export that reads require, module, exports, __dirname or __filename, unless it opens
 * with 'use strict'. .mjs, .mts and .vue are modules. Residual: a classic browser script with none of
 * those reads as strict (a modern project's .js without imports is far more often an ES module).
 */
export const isSloppyProgram = (program, relativePath = '') => {
  const isModuleFile = ALWAYS_STRICT.test(relativePath);
  if (isModuleFile) return false;
  const directives = program?.kids?.directives ?? [];
  const isStrictDirective = directives.some((directive) => directive.kids?.value?.label === 'use strict');
  if (isStrictDirective) return false;
  const isScriptFile = ALWAYS_SCRIPT.test(relativePath);
  if (isScriptFile) return true;
  const hasModuleSyntax = (program?.kids?.body ?? []).some((node) => MODULE_SYNTAX.has(node.type));
  return !hasModuleSyntax && usesCommonJsGlobal(program);
};
