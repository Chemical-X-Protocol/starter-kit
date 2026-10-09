/**
 * Index metadata from an SFC (finding vue-sfc-extraction-gaps): props from
 * defineProps (type and runtime forms, withDefaults) and the Options API `props`
 * option, the component symbol, `<script src>` links, and template component tags.
 */
import path from 'node:path';
import * as t from '@babel/types';
import { collectComponentTags, walkBabel } from './template-walk.js';
import { toComponentKey, toComponentSpecifier } from './component-resolver.js';

const keyName = (key) => {
  if (t.isIdentifier(key)) return key.name;
  if (t.isStringLiteral(key)) return key.value;
  return '';
};

const typeLabel = (node) => (node?.typeAnnotation?.typeAnnotation?.type || 'ts').replace(/^TS|Keyword$/g, '').toLowerCase();

const membersOfType = (typeNode, program) => {
  if (t.isTSTypeLiteral(typeNode)) return typeNode.members;
  const refName = t.isTSTypeReference(typeNode) && t.isIdentifier(typeNode.typeName) ? typeNode.typeName.name : '';
  if (!refName) return [];
  for (const stmt of program.body) {
    const decl = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
    const isInterface = t.isTSInterfaceDeclaration(decl) && decl.id.name === refName;
    if (isInterface) return decl.body.body;
    const isAlias = t.isTSTypeAliasDeclaration(decl) && decl.id.name === refName;
    if (isAlias) return membersOfType(decl.typeAnnotation, program);
  }
  return [];
};

const propsFromRuntime = (arg) => {
  if (t.isArrayExpression(arg)) return arg.elements.filter(t.isStringLiteral).map((el) => ({ name: el.value, type: 'runtime' }));
  if (t.isObjectExpression(arg)) return arg.properties.filter(t.isObjectProperty).map((p) => ({ name: keyName(p.key), type: 'runtime' }));
  return [];
};

const propsFromDefineProps = (call, program) => {
  const typeArg = call.typeParameters?.params?.[0];
  if (typeArg) {
    return membersOfType(typeArg, program)
      .filter((m) => t.isTSPropertySignature(m))
      .map((m) => ({ name: keyName(m.key), type: typeLabel(m) }));
  }
  return propsFromRuntime(call.arguments[0]);
};

const isCallTo = (node, name) => t.isCallExpression(node) && t.isIdentifier(node.callee, { name });

// withDefaults(defineProps<T>(), ...) is covered: the walk reaches the inner call.
const findDefinePropsCall = (node) => (isCallTo(node, 'defineProps') ? node : null);

const optionsObjectOf = (stmt) => {
  if (!t.isExportDefaultDeclaration(stmt)) return null;
  const decl = stmt.declaration;
  if (t.isObjectExpression(decl)) return decl;
  const isDefineComponent = isCallTo(decl, 'defineComponent') && t.isObjectExpression(decl.arguments[0]);
  return isDefineComponent ? decl.arguments[0] : null;
};

/** Props declared by the component, from every script block. */
export const extractSfcProps = (program) => {
  const props = [];
  for (const stmt of program.body) {
    const options = optionsObjectOf(stmt);
    const propsOption = options?.properties.find((p) => t.isObjectProperty(p) && keyName(p.key) === 'props');
    if (propsOption) props.push(...propsFromRuntime(propsOption.value));
    walkBabel(stmt, (node) => {
      const call = findDefinePropsCall(node);
      if (call) props.push(...propsFromDefineProps(call, program));
    });
  }
  return props.filter((p) => p.name);
};

/** Template component tags that have no local import, as `#component:<tag>` import rows. */
export const extractTemplateComponentImports = (sfc, localImportNames) => {
  const localKeys = new Set([...localImportNames].map(toComponentKey));
  const seen = new Set();
  const rows = [];
  for (const { tag, line } of collectComponentTags(sfc.template?.ast)) {
    const key = toComponentKey(tag);
    const isLocal = localKeys.has(key);
    if (isLocal || seen.has(key)) continue;
    seen.add(key);
    rows.push({ importedSymbol: tag, sourceModule: toComponentSpecifier(tag), line });
  }
  return rows;
};

/** `<script src="./x.controller.ts">` links as import rows. */
export const extractScriptSrcImports = (sfc) => sfc.scripts
  .filter((s) => s.src)
  .map((s) => ({ importedSymbol: '*', sourceModule: s.src, line: s.startLine }));

export const componentNameFromPath = (filePath) => {
  const base = path.basename(filePath, path.extname(filePath));
  return base.split(/[-_.]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('');
};
