/**
 * Lossless partition of a compact capsule source into capsule files.
 *
 * The file prologue (shebang, directives, triple-slash lines, file pragmas) is kept apart so it
 * stays first in the component file. Every top-level statement (with the comments and blank
 * lines in front of it) is assigned to
 * exactly one bucket: props types, state types, the controller hook, or the component file.
 * Imports always stay in the component file (and are copied into other files that need them).
 * A type or the controller moves out only when it references nothing local that stays behind,
 * so moving can never break a reference. Nothing is generated from scratch except stubs for
 * buckets the source does not have.
 */
import { parseBabel, langForPath, declaredNames } from './source-parse.js';
import { relativeSpecifiers, relocateText, unrelocatableSpecifiers } from './explode-relocate.js';
import { prologueEndOf } from './explode-prologue.js';

const IDENTIFIER_REGEX = /[A-Za-z_$][\w$]*/g;
const isTypeNode = (decl) => decl?.type === 'TSInterfaceDeclaration' || decl?.type === 'TSTypeAliasDeclaration';
const identifiersIn = (text) => new Set(text.match(IDENTIFIER_REGEX) || []);

const describeStatements = (content, program, start) => {
  let cursor = start;
  return program.body.map((node) => {
    const segment = content.slice(cursor, node.end).replace(/^\n+/, (lead) => (lead.length >= 2 ? '\n' : ''));
    cursor = node.end;
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : null;
    return {
      node,
      segment,
      relSpecs: relativeSpecifiers(node),
      text: content.slice(node.start, node.end),
      names: declaredNames(node),
      isImport: node.type === 'ImportDeclaration',
      isExportedType: isTypeNode(decl),
      typeName: isTypeNode(decl) ? decl.id.name : null,
      controllerName: decl?.type === 'VariableDeclaration' ? decl.declarations[0]?.id?.name : null
    };
  });
};

/**
 * A statement's text and segment with relative specifiers rewritten for a file in `sub`
 * (a directory relative to the original file's directory; '' means unmoved).
 *
 * @param {object} s Statement from planExplode.
 * @param {string} sub Destination directory.
 * @returns {{ text: string, segment: string }}
 */
export const relocated = (s, sub) => {
  const lead = s.segment.slice(0, s.segment.length - s.text.length);
  const text = relocateText(s.text, s.node.start, s.relSpecs, sub);
  return { text, segment: lead + text };
};

const localImports = (statements) => {
  const map = new Map();
  for (const s of statements.filter((st) => st.isImport)) {
    for (const spec of s.node.specifiers) map.set(spec.local.name, s);
  }
  return map;
};

const settleMovedTypes = (statements, localNames) => {
  const moved = new Set(statements.filter((s) => s.isExportedType).map((s) => s.typeName));
  let isChanging = true;
  while (isChanging) {
    isChanging = false;
    for (const s of statements.filter((st) => st.isExportedType && moved.has(st.typeName))) {
      const refs = [...identifiersIn(s.text)].filter((id) => id !== s.typeName && localNames.has(id));
      const isAnchored = refs.some((id) => !moved.has(id));
      if (isAnchored) { moved.delete(s.typeName); isChanging = true; }
    }
  }
  return moved;
};

const isControllerName = (name) => Boolean(name) && name.startsWith('use') && name.endsWith('Controller');

/**
 * @param {string} content Source of the compact capsule.
 * @param {string} filePath Its path (decides the parser).
 * @returns {{ statements: object[], prologue: string, directives: string[], unrelocatable: string[], buckets: Record<string, object[]>, imports: Map<string,object>, movedTypes: Set<string>, controllerName: string|null, declarations: string[] }}
 */
export const planExplode = (content, filePath) => {
  const lang = langForPath(filePath);
  if (!lang) throw new Error(`explode supports .ts/.tsx/.js/.jsx sources only (got ${filePath}); Vue/Svelte need SFC support (plan B).`);
  const file = parseBabel(content, lang);
  const program = file.program;
  const prologueEnd = prologueEndOf(file);
  const statements = describeStatements(content, program, prologueEnd);
  const localNames = new Set(statements.filter((s) => !s.isImport).flatMap((s) => s.names));
  const movedTypes = settleMovedTypes(statements, localNames);

  const controller = statements.find((s) => isControllerName(s.controllerName));
  const controllerRefs = controller ? [...identifiersIn(controller.text)].filter((id) => localNames.has(id) && id !== controller.controllerName) : [];
  const canMoveController = Boolean(controller) && controllerRefs.every((id) => movedTypes.has(id));

  const buckets = { props: [], state: [], controller: [], component: [] };
  for (const s of statements) {
    const isMovedType = s.isExportedType && movedTypes.has(s.typeName);
    const isPropsType = isMovedType && /Props|Emits/.test(s.typeName);
    const isMovedController = canMoveController && s === controller;
    if (isPropsType) buckets.props.push(s);
    else if (isMovedType) buckets.state.push(s);
    else if (isMovedController) buckets.controller.push(s);
    else buckets.component.push(s);
  }
  const tail = content.slice(program.body.length ? program.body[program.body.length - 1].end : prologueEnd);
  const lastComponent = buckets.component[buckets.component.length - 1];
  if (lastComponent) lastComponent.segment += tail.replace(/\s+$/, '');

  return {
    statements,
    prologue: content.slice(0, prologueEnd),
    directives: (program.directives || []).map((d) => d.value.value),
    unrelocatable: unrelocatableSpecifiers(program, content),
    buckets,
    imports: localImports(statements),
    movedTypes,
    controllerName: canMoveController ? controller.controllerName : null,
    declarations: [...localNames]
  };
};

/**
 * Header lines a bucket needs: copies of the original imports it references, plus type
 * imports for moved types that live in another file.
 *
 * @param {object[]} bucket Statements in the file.
 * @param {object} plan planExplode result.
 * @param {(name: string) => string|null} typeHome Module specifier for a moved type, or null when local.
 * @param {string} [sub] Directory of the file relative to the original, for relative specifiers.
 * @returns {string}
 */
export const importHeader = (bucket, plan, typeHome, sub = '') => {
  const refs = new Set(bucket.flatMap((s) => [...identifiersIn(s.text)]));
  const own = new Set(bucket.flatMap((s) => s.names));
  const present = new Set(bucket);
  const copiedStatements = new Set([...refs].filter((id) => plan.imports.has(id) && !own.has(id)).map((id) => plan.imports.get(id)).filter((st) => !present.has(st)));
  const copied = [...copiedStatements].map((st) => relocated(st, sub).text);
  const byModule = new Map();
  for (const id of [...refs].filter((r) => plan.movedTypes.has(r) && !own.has(r))) {
    const from = typeHome(id);
    if (!from) continue;
    byModule.set(from, [...(byModule.get(from) || []), id]);
  }
  const typeImports = [...byModule].map(([from, names]) => `import type { ${names.sort().join(', ')} } from '${from}';`);
  const lines = [...copied, ...typeImports];
  return lines.length > 0 ? `${lines.join('\n')}\n\n` : '';
};
