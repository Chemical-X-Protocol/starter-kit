// The closed set of serializable heal span ops (engine doc, Heal: DETERMINISTIC PART): replaceRange,
// hoistComments, addImport (merge forms), dropUnusedImports, createModule and insertExport. Each takes
// text and returns text or splices over the original; side-effect imports are never touched.
import { traverse } from '../babel-lazy.js';
import { HealError, bodyHashOf, parseModuleText, indentAt, lineStartOf, lineEndAfter, spliceAll } from './heal-text.js';

const importsOf = (ast) => ast.program.body.filter((node) => node.type === 'ImportDeclaration');

const isSpecifierType = (type) => (specifier) => specifier.type === type;
const isNamed = isSpecifierType('ImportSpecifier');
const isDefault = isSpecifierType('ImportDefaultSpecifier');
const isNamespace = isSpecifierType('ImportNamespaceSpecifier');

const importedNameOf = (specifier) => specifier.imported?.name ?? specifier.imported?.value ?? null;

/** Comments fully inside [start, end), as their source text in source order. */
export const hoistComments = (text, ast, start, end) => (ast.comments ?? [])
  .filter((comment) => comment.start >= start && comment.end <= end)
  .sort((a, b) => a.start - b.start)
  .map((comment) => text.slice(comment.start, comment.end));

/**
 * One splice for a member site. replacement is written at indent 0; its later lines are re-based to the
 * site's indent. expectHash (bodyHashOf of the span) refuses with BLUEPRINT_STALE when the body changed.
 */
export const replaceRange = (text, { start, end, expectHash = null, text: replacement }) => {
  const isStale = expectHash !== null && bodyHashOf(text.slice(start, end)) !== expectHash;
  if (isStale) throw new HealError('BLUEPRINT_STALE', `the member at offset ${start} changed since the blueprint was built`);
  const indent = indentAt(text, start);
  const rebased = replacement.split('\n').map((line, index) => (index === 0 || line === '' ? line : `${indent}${line}`)).join('\n');
  return { start, end, text: rebased };
};

const quoteOf = (imports) => {
  const raw = imports.length > 0 ? imports[0].source.extra?.raw : null;
  return raw ? raw[0] : "'";
};

const semicolonOf = (text, imports) => {
  const last = imports[imports.length - 1];
  const hasSemicolon = !last || text[last.end - 1] === ';';
  return hasSemicolon ? ';' : '';
};

const declarationText = (names, from, imports, text) => `import { ${names.join(', ')} } from ${quoteOf(imports)}${from}${quoteOf(imports)}${semicolonOf(text, imports)}`;

const mergeSplice = (text, declaration, names) => {
  const named = declaration.specifiers.filter(isNamed);
  const hasNamed = named.length > 0;
  if (!hasNamed) {
    const defaultSpecifier = declaration.specifiers.find(isDefault);
    return { start: defaultSpecifier.end, end: defaultSpecifier.end, text: `, { ${names.join(', ')} }` };
  }
  const last = named[named.length - 1];
  const isMultiline = text.slice(named[0].start, last.end).includes('\n') || text.slice(declaration.start, named[0].start).includes('\n');
  const separator = isMultiline ? `,\n${indentAt(text, last.start)}` : ', ';
  return { start: last.end, end: last.end, text: `${separator}${names.join(separator)}` };
};

const newDeclarationSplice = (text, ast, imports, line) => {
  const last = imports[imports.length - 1];
  if (last) {
    const at = lineEndAfter(text, last.end);
    const needsNewline = at === text.length && !text.endsWith('\n');
    return { start: at, end: at, text: `${needsNewline ? '\n' : ''}${line}\n` };
  }
  const first = ast.program.body[0];
  const at = first ? lineStartOf(text, first.start) : text.length;
  return { start: at, end: at, text: `${line}\n\n` };
};

/**
 * Adds `import { names } from 'from'`. It merges into an existing import of the same module (`{ a }`,
 * `x`, and `x, { a }` forms); a namespace import or a side-effect import is left alone and a new
 * declaration goes after the last import. A name the file already imports from there is skipped; a
 * name bound to something else refuses with HEAL_NAME_TAKEN.
 */
export const addImport = (text, file, { from, names }) => {
  const ast = parseModuleText(text, file);
  const imports = importsOf(ast);
  const same = imports.filter((declaration) => declaration.source.value === from && declaration.importKind !== 'type');
  const present = new Set(same.flatMap((declaration) => declaration.specifiers.filter(isNamed).filter((specifier) => specifier.local.name === importedNameOf(specifier)).map((specifier) => specifier.local.name)));
  const bound = new Set(imports.flatMap((declaration) => declaration.specifiers.map((specifier) => specifier.local.name)));
  const missing = names.filter((name) => !present.has(name));
  const taken = missing.filter((name) => bound.has(name));
  const isTaken = taken.length > 0;
  if (isTaken) throw new HealError('HEAL_NAME_TAKEN', `${file} already imports ${taken.join(', ')} from another module`);
  const isComplete = missing.length === 0;
  if (isComplete) return text;
  const mergeable = same.find((declaration) => declaration.specifiers.length > 0 && !declaration.specifiers.some(isNamespace));
  const splice = mergeable ? mergeSplice(text, mergeable, missing) : newDeclarationSplice(text, ast, imports, declarationText(missing, from, imports, text));
  return spliceAll(text, [splice]);
};

/** Reference counts of every import binding: Map localName -> references. */
export const importReferenceCounts = (text, file) => {
  const ast = parseModuleText(text, file);
  const counts = new Map();
  traverse(ast, {
    Program(path) {
      for (const declaration of importsOf(ast)) {
        for (const specifier of declaration.specifiers) counts.set(specifier.local.name, path.scope.getBinding(specifier.local.name)?.referencePaths.length ?? 0);
      }
      path.stop();
    }
  });
  return { ast, counts };
};

const specifierText = (text, specifier) => text.slice(specifier.start, specifier.end);

const renderKept = (text, declaration, kept) => {
  const head = kept.filter((specifier) => !isNamed(specifier)).map((specifier) => specifierText(text, specifier));
  const named = kept.filter(isNamed);
  const firstNamed = declaration.specifiers.find(isNamed);
  const isMultiline = Boolean(firstNamed) && text.slice(declaration.start, declaration.source.start).includes('\n');
  const indent = firstNamed ? indentAt(text, firstNamed.start) : '';
  const namedText = isMultiline ? `{\n${named.map((specifier) => `${indent}${specifierText(text, specifier)}`).join(',\n')}\n}` : `{ ${named.map((specifier) => specifierText(text, specifier)).join(', ')} }`;
  const parts = [...head, ...(named.length > 0 ? [namedText] : [])];
  const tail = text.slice(declaration.source.start, declaration.end);
  return `import ${parts.join(', ')} from ${tail}`;
};

const ownLinesSpan = (text, declaration) => {
  const start = lineStartOf(text, declaration.start);
  const end = lineEndAfter(text, declaration.end);
  const isOwnLines = text.slice(start, declaration.start).trim() === '' && text.slice(declaration.end, end).trim() === '';
  return isOwnLines ? { start, end } : { start: declaration.start, end: declaration.end };
};

/**
 * Removes the import specifiers the edit made unused: referenced in beforeText, zero references in
 * afterText. Specifiers that were already unused, and side-effect imports, are kept as they are.
 * Returns { text, dropped: [localName] }.
 */
export const dropUnusedImports = (beforeText, afterText, file) => {
  const before = importReferenceCounts(beforeText, file).counts;
  const { ast, counts } = importReferenceCounts(afterText, file);
  const isDropped = (specifier) => (before.get(specifier.local.name) ?? 0) > 0 && counts.get(specifier.local.name) === 0;
  const splices = [];
  const dropped = [];
  for (const declaration of importsOf(ast)) {
    const gone = declaration.specifiers.filter(isDropped);
    const hasGone = gone.length > 0;
    if (!hasGone) continue;
    dropped.push(...gone.map((specifier) => specifier.local.name));
    const kept = declaration.specifiers.filter((specifier) => !isDropped(specifier));
    const isEmptied = kept.length === 0;
    splices.push(isEmptied ? { ...ownLinesSpan(afterText, declaration), text: '' } : { start: declaration.start, end: declaration.end, text: renderKept(afterText, declaration, kept) });
  }
  return { text: spliceAll(afterText, splices), dropped };
};

/** A new module holding the piece. */
export const createModule = ({ path, content }) => ({ path, content: content.endsWith('\n') ? content : `${content}\n`, created: true });

/** Splits a piece text into its import lines and the rest (the export). */
export const splitPieceImports = (pieceText, file) => {
  const ast = parseModuleText(pieceText, file);
  const imports = importsOf(ast);
  const last = imports[imports.length - 1];
  const bodyStart = last ? lineEndAfter(pieceText, last.end) : 0;
  const entries = imports.map((declaration) => ({ from: declaration.source.value, specifiers: declaration.specifiers, text: pieceText.slice(declaration.start, declaration.end) }));
  return { imports: entries, body: pieceText.slice(bodyStart).replace(/^\n+/, '') };
};

const localsOf = (specifiers) => specifiers.map((specifier) => specifier.local.name).sort().join(',');

// Named imports merge through addImport; any other form is copied verbatim unless the host already has
// the same declaration, and refuses (HEAL_IMPORT_FORM) when one of its names is bound to something else.
const mergePieceImport = (text, file, entry) => {
  const isNamedOnly = entry.specifiers.every(isNamed) && entry.specifiers.every((specifier) => specifier.local.name === importedNameOf(specifier));
  if (isNamedOnly) return addImport(text, file, { from: entry.from, names: entry.specifiers.map((specifier) => specifier.local.name) });
  const imports = importsOf(parseModuleText(text, file));
  const isPresent = imports.some((declaration) => declaration.source.value === entry.from && localsOf(declaration.specifiers) === localsOf(entry.specifiers));
  if (isPresent) return text;
  const bound = new Set(imports.flatMap((declaration) => declaration.specifiers.map((specifier) => specifier.local.name)));
  const isClash = entry.specifiers.some((specifier) => bound.has(specifier.local.name));
  if (isClash) throw new HealError('HEAL_IMPORT_FORM', `the piece imports ${entry.from} as ${localsOf(entry.specifiers)}, a name ${file} binds to another import; place the piece in a new module`);
  return spliceAll(text, [newDeclarationSplice(text, parseModuleText(text, file), imports, entry.text)]);
};

/**
 * Inserts the piece export into an existing host module, after its imports, and merges the piece's
 * imports into the host's (mergePieceImport).
 */
export const insertExport = (text, file, { content, pieceFile = file }) => {
  const piece = splitPieceImports(content, pieceFile);
  let result = text;
  for (const entry of piece.imports) result = mergePieceImport(result, file, entry);
  const ast = parseModuleText(result, file);
  const imports = importsOf(ast);
  const last = imports[imports.length - 1];
  const at = last ? lineEndAfter(result, last.end) : 0;
  const block = `\n${piece.body.trimEnd()}\n${last ? '' : '\n'}`;
  return spliceAll(result, [{ start: at, end: at, text: block }]);
};
