/**
 * AST outline for JS/TS modules and SFC script overlays (finding
 * outline-incomplete-sfc-ts-scss): classes and their members, enums, re-exports,
 * `export { a }`, destructured bindings, typed signatures sliced from source,
 * defineProps/defineEmits/defineExpose, and one level into defineStore,
 * defineComponent and `export default {}` objects.
 */
import * as t from '@babel/types';
import { resolveDeclarationKind } from '../reader-logic.js';
import { describeVueMacro, describeComponentOptions, describeStore } from './vue-outline.js';

const sliceSource = (code, nodes) => {
  const list = nodes.filter(Boolean);
  if (list.length === 0) return '';
  return code.slice(list[0].start, list[list.length - 1].end).replace(/\s+/g, ' ');
};

const signatureOf = (code, fn) => `(${sliceSource(code, fn.params)})`;

const bindingNames = (pattern) => {
  if (t.isIdentifier(pattern)) return [pattern.name];
  if (t.isObjectPattern(pattern)) return pattern.properties.flatMap((p) => bindingNames(t.isRestElement(p) ? p.argument : p.value));
  if (t.isArrayPattern(pattern)) return pattern.elements.flatMap((el) => (el ? bindingNames(t.isRestElement(el) ? el.argument : el) : []));
  if (t.isAssignmentPattern(pattern)) return bindingNames(pattern.left);
  return [];
};

const isFunctionInit = (init) => t.isArrowFunctionExpression(init) || t.isFunctionExpression(init);

const describeVariable = (code, declarator, prefix) => {
  const init = declarator.init;
  const isSimpleName = t.isIdentifier(declarator.id);
  if (isSimpleName && isFunctionInit(init)) return [`${prefix}function ${declarator.id.name}${signatureOf(code, init)}`];
  const macro = describeVueMacro(code, init);
  if (macro) return [isSimpleName ? `${prefix}const ${declarator.id.name} = ${macro}` : macro];
  const store = describeStore(code, init);
  const kind = isSimpleName ? resolveDeclarationKind(declarator) : 'const';
  const head = bindingNames(declarator.id).map((name) => `${prefix}${kind} ${name}`);
  return store ? [...head, ...store] : head;
};

const describeClass = (code, cls, prefix) => {
  const lines = [`${prefix}class ${cls.id?.name ?? '(anonymous)'}`];
  for (const member of cls.body.body) {
    const name = t.isIdentifier(member.key) ? member.key.name : member.key?.name ?? '[computed]';
    const isMethod = t.isClassMethod(member) || t.isClassPrivateMethod(member);
    if (isMethod) lines.push(`  ${member.kind === 'constructor' ? 'constructor' : `method ${name}`}${signatureOf(code, member)}`);
    const isProperty = t.isClassProperty(member) || t.isClassPrivateProperty(member);
    if (isProperty) lines.push(`  property ${name}`);
  }
  return lines;
};

const describeDeclaration = (code, decl, prefix) => {
  if (t.isFunctionDeclaration(decl) && decl.id) return [`${prefix}function ${decl.id.name}${signatureOf(code, decl)}`];
  if (t.isClassDeclaration(decl)) return describeClass(code, decl, prefix);
  if (t.isVariableDeclaration(decl)) return decl.declarations.flatMap((d) => describeVariable(code, d, prefix));
  if (t.isTSTypeAliasDeclaration(decl)) return [`${prefix}type ${decl.id.name}`];
  if (t.isTSInterfaceDeclaration(decl)) return [`${prefix}interface ${decl.id.name}`];
  if (t.isTSEnumDeclaration(decl)) return [`${prefix}enum ${decl.id.name}`];
  return [];
};

const describeStatement = (code, node) => {
  if (t.isExportNamedDeclaration(node)) {
    if (node.declaration) return describeDeclaration(code, node.declaration, 'export ');
    const typePrefix = node.exportKind === 'type' ? 'type ' : '';
    const from = node.source ? ` from '${node.source.value}'` : '';
    return [`export ${typePrefix}{ ${sliceSource(code, node.specifiers)} }${from}`];
  }
  if (t.isExportAllDeclaration(node)) return [`export * from '${node.source.value}'`];
  if (t.isExportDefaultDeclaration(node)) {
    const decl = node.declaration;
    const isNamedDecl = (t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) && decl.id;
    const head = isNamedDecl ? describeDeclaration(code, decl, 'export default ') : ['export default'];
    return [...head, ...describeComponentOptions(code, decl)];
  }
  const isMacroStatement = t.isExpressionStatement(node);
  if (isMacroStatement) {
    const macro = describeVueMacro(code, node.expression);
    return macro ? [macro] : [];
  }
  return describeDeclaration(code, node, '');
};

const countOmittedFunctions = (program) => {
  let count = 0;
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    const isNestedFunction = (t.isFunctionDeclaration(node) && !t.isProgram(parent) && !t.isExportNamedDeclaration(parent)) ||
      ((t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) && !t.isVariableDeclarator(parent));
    if (isNestedFunction) count += 1;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key.endsWith('Comments')) continue;
      for (const child of Array.isArray(value) ? value : [value]) visit(child, node);
    }
  };
  visit(program, null);
  return count;
};

/** Outline lines for a parsed module. `code` is the exact string that was parsed. */
export const outlineModuleAst = (ast, code) => {
  const lines = ast.program.body.flatMap((node) => describeStatement(code, node));
  const omitted = countOmittedFunctions(ast.program);
  if (omitted > 0) lines.push(`// [Notice: ${omitted} internal/unexported function(s) omitted. Use cx read --symbol=<name> to inspect]`);
  return lines;
};
