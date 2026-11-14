/**
 * Index metadata from a parsed JS/TS module (or SFC script overlay): exported
 * symbols (including classes, `export { a }`, destructured and re-exported names),
 * import edges (static, dynamic `import()`, `export * from`, `export { x } from`),
 * Props interfaces and the hooks the module defines or calls (not merely imports).
 */
import path from 'node:path';
import { lazyTypes as t } from './babel-lazy.js';
import { walkBabel } from './sfc/template-walk.js';

const DECLARATION_KINDS = {
  FunctionDeclaration: 'function',
  ClassDeclaration: 'class',
  TSTypeAliasDeclaration: 'type',
  TSInterfaceDeclaration: 'interface',
  TSEnumDeclaration: 'enum'
};

const bindingNames = (pattern) => {
  if (t.isIdentifier(pattern)) return [pattern.name];
  if (t.isObjectPattern(pattern)) return pattern.properties.flatMap((p) => bindingNames(t.isRestElement(p) ? p.argument : p.value));
  if (t.isArrayPattern(pattern)) return pattern.elements.flatMap((el) => (el ? bindingNames(t.isRestElement(el) ? el.argument : el) : []));
  if (t.isAssignmentPattern(pattern)) return bindingNames(pattern.left);
  return [];
};

const exportedName = (spec) => (t.isIdentifier(spec.exported) ? spec.exported.name : spec.exported?.value || '');

const propsFromInterface = (decl) => {
  const isPropsInterface = t.isTSInterfaceDeclaration(decl) && /props?/i.test(decl.id.name);
  if (!isPropsInterface) return [];
  return decl.body.body
    .filter((m) => t.isTSPropertySignature(m) && t.isIdentifier(m.key))
    .map((m) => ({ name: m.key.name, type: 'ts' }));
};

const importRowsOf = (node, line) => {
  const sourceModule = node.source?.value || '';
  return (node.specifiers || []).map((spec) => {
    if (t.isImportDefaultSpecifier(spec)) return { importedSymbol: 'default', sourceModule, line };
    if (t.isImportNamespaceSpecifier(spec)) return { importedSymbol: '*', sourceModule, line };
    return { importedSymbol: spec.imported?.name || spec.imported?.value || spec.local?.name, sourceModule, line };
  });
};

const declarationSymbols = (decl, lineInfo) => {
  const kind = DECLARATION_KINDS[decl.type];
  const hasNamedDeclaration = Boolean(kind && decl.id);
  if (hasNamedDeclaration) return [{ name: decl.id.name, kind, ...lineInfo(decl) }];
  if (!t.isVariableDeclaration(decl)) return [];
  return decl.declarations.flatMap((v) => bindingNames(v.id).map((name) => ({ name, kind: 'const', ...lineInfo(v) })));
};

const collectExportNamed = (node, lineInfo, out) => {
  const line = node.loc?.start.line || 1;
  const hasDeclaration = Boolean(node.declaration);
  if (hasDeclaration) {
    out.symbols.push(...declarationSymbols(node.declaration, lineInfo).map((s) => ({ ...s, isExport: true })));
    out.props.push(...propsFromInterface(node.declaration));
    return;
  }
  const sourceModule = node.source?.value || '';
  for (const spec of node.specifiers || []) {
    const name = exportedName(spec);
    out.symbols.push({ name, kind: sourceModule ? 're-export' : 'export', isExport: true, ...lineInfo(node) });
    if (sourceModule) out.imports.push({ importedSymbol: spec.local?.name || name, sourceModule, line });
  }
};

const collectTopLevel = (node, lineInfo, filePath, out) => {
  const line = node.loc?.start.line || 1;
  if (t.isImportDeclaration(node)) out.imports.push(...importRowsOf(node, line));
  if (t.isExportNamedDeclaration(node)) collectExportNamed(node, lineInfo, out);
  if (t.isExportAllDeclaration(node)) out.imports.push({ importedSymbol: '*', sourceModule: node.source.value, line });
  if (t.isExportDefaultDeclaration(node)) {
    const name = node.declaration?.id?.name || path.basename(filePath, path.extname(filePath));
    out.symbols.push({ name, kind: 'default', isExport: true, ...lineInfo(node) });
  }
  out.props.push(...propsFromInterface(node));
};

const isDynamicImport = (node) => t.isCallExpression(node) && node.callee?.type === 'Import' && t.isStringLiteral(node.arguments[0]);

// An identifier that names a property, not a binding or a value: `a.b` (b), `{ b: 1 }` (b), `<X b="" />` (b).
// Shorthand `{ b }` is a real reference, so it is kept.
const isNonReferenceName = (node, parent) => {
  if (!parent) return false;
  const isMemberProperty = (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === node && !parent.computed;
  const isObjectKey = (t.isObjectProperty(parent) || t.isObjectMethod(parent) || t.isClassProperty(parent) || t.isClassMethod(parent))
    && parent.key === node && !parent.computed && !parent.shorthand;
  const isJsxAttributeName = t.isJSXAttribute(parent) && parent.name === node;
  const isTypeMemberKey = (t.isTSPropertySignature(parent) || t.isTSMethodSignature(parent)) && parent.key === node && !parent.computed;
  const isQualifiedRight = t.isTSQualifiedName(parent) && parent.right === node;
  const isJsxMemberProperty = t.isJSXMemberExpression(parent) && parent.property === node;
  return isMemberProperty || isObjectKey || isJsxAttributeName || isTypeMemberKey || isQualifiedRight || isJsxMemberProperty;
};

const isNameNode = (node) => t.isIdentifier(node) || t.isJSXIdentifier(node);

/** Extracts { symbols, props, hooks, imports, occurrences } from a Babel File AST. */
export const extractModuleMetadata = (ast, contentLines, filePath) => {
  const signatureAt = (lineNo) => (contentLines[lineNo - 1] || '').trim();
  const lineInfo = (node) => {
    const startLine = node.loc?.start.line || 1;
    return { startLine, endLine: node.loc?.end.line || startLine, signature: signatureAt(startLine) };
  };
  const out = { symbols: [], props: [], imports: [], hooks: new Set() };
  const occurrenceKeys = new Set();
  for (const node of ast.program.body) collectTopLevel(node, lineInfo, filePath, out);
  walkBabel(ast.program, (node, parent) => {
    if (isDynamicImport(node)) out.imports.push({ importedSymbol: 'default', sourceModule: node.arguments[0].value, line: node.loc?.start.line || 1 });
    const isHookCall = t.isCallExpression(node) && t.isIdentifier(node.callee) && /^use[A-Z0-9]/.test(node.callee.name);
    if (isHookCall) out.hooks.add(node.callee.name);
    const isUse = isNameNode(node) && !isNonReferenceName(node, parent);
    if (isUse) occurrenceKeys.add(`${node.name}\u0000${node.loc?.start.line || 1}`);
  });
  for (const sym of out.symbols) {
    const isHookDefinition = /^use[A-Z0-9]/.test(sym.name);
    if (isHookDefinition) out.hooks.add(sym.name);
  }
  const occurrences = [...occurrenceKeys].map((key) => {
    const [name, line] = key.split('\u0000');
    return { name, line: Number(line) };
  });
  return { symbols: out.symbols, props: out.props, imports: out.imports, hooks: [...out.hooks], occurrences };
};
