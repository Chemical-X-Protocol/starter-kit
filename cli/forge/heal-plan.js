// Plans a heal in memory (engine doc, Heal: SAFETY SEQUENCE 1 and 3): checks that the blueprint can be
// applied, re-locates the members, matches each one to the piece, and renders every file's new text with
// the span ops of heal-ops.js. Nothing touches disk here; heal-apply.js writes the plan.
import { findEntry } from '../library/registry.js';
import { HealError, parseModuleText, spliceAll } from './heal-text.js';
import { locateSites } from './heal-locate.js';
import { pieceCoreOf, matchSite, renderCall, alwaysReturns } from './heal-match.js';
import { hoistComments, replaceRange, addImport, dropUnusedImports, createModule, insertExport } from './heal-ops.js';

const HEALABLE_KINDS = new Set(['extract-function', 'reuse']);

const openHolesOf = (blueprint, fills) => blueprint.holes.filter((hole) => hole.default === null && !fills.has(hole.id));

const libraryStatusOf = (fromPiece) => {
  const isLibrary = typeof fromPiece === 'string';
  if (!isLibrary) return null;
  const [id, version] = fromPiece.split('@');
  const item = findEntry(id);
  const isKnown = Boolean(item?.entry);
  return isKnown ? { status: item.entry.status, version: item.entry.version, wanted: version } : { status: 'missing', version: null, wanted: version };
};

const libraryProblemOf = (library) => {
  const isAbsent = library === null;
  if (isAbsent) return null;
  const problems = [
    [library.status === 'missing', ['PIECE_MISSING', 'the library piece is not in this kit']],
    [library.status === 'quarantined', ['PIECE_QUARANTINED', 'the library piece is quarantined under the current ruleset (chemx library verify)']],
    [library.version !== library.wanted, ['PIECE_VERSION', `the blueprint wants piece version ${library.wanted}, the kit has ${library.version}`]]
  ];
  return problems.find(([isProblem]) => isProblem)?.[1] ?? null;
};

/** The first reason the blueprint cannot be healed as it is, as [code, message], or null. */
export const refusalOf = (blueprint, fills) => {
  const open = openHolesOf(blueprint, fills);
  const isDesign = open.some((hole) => hole.kind === 'design');
  const hasBody = typeof blueprint.piece.body === 'string' || Boolean(blueprint.piece.existing);
  const problems = [
    [!HEALABLE_KINDS.has(blueprint.kind), ['HEAL_KIND_UNSUPPORTED', `a ${blueprint.kind} blueprint has no heal yet (extract-function and reuse do)`]],
    [isDesign, ['HEAL_DESIGN_HOLE', 'a design hole is open; it takes a decision, not a fill']],
    [open.length > 0, ['BLUEPRINT_OPEN_HOLES', `fill ${open.map((hole) => hole.id).join(', ')} first (chemx blueprint fill ${blueprint.id} <hole>=<value> --as=@you)`]],
    [blueprint.behaviorDelta.length > 0, ['BLUEPRINT_BEHAVIOR_DELTA', 'the members differ in behavior; a behaviorDelta blueprint is not healed automatically']],
    [!hasBody, ['BLUEPRINT_NO_PIECE_BODY', 'the piece has no body yet (piece synthesis for non-library groups is open, #4497)']],
    [!blueprint.piece.module, ['BLUEPRINT_NO_PLACEMENT', 'the piece has no module']]
  ];
  return problems.find(([isProblem]) => isProblem)?.[1] ?? libraryProblemOf(libraryStatusOf(blueprint.piece.fromPiece));
};

const identifierSplices = (node, from, to, splices = []) => {
  const isTarget = node.type === 'Identifier' && node.name === from;
  if (isTarget) splices.push({ start: node.start, end: node.end, text: to });
  for (const [key, value] of Object.entries(node)) {
    const isChild = key !== 'loc' && Boolean(value) && typeof value === 'object';
    if (!isChild) continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      const isChildNode = Boolean(child) && typeof child.type === 'string';
      if (isChildNode) identifierSplices(child, from, to, splices);
    }
  }
  return splices;
};

/** The piece text with the name and doc fills applied. */
export const renderPiece = (blueprint, fills) => {
  const piece = blueprint.piece;
  const name = fills.get('name') ?? piece.name;
  const isRenamed = name !== piece.name;
  const renamed = isRenamed ? spliceAll(piece.body, identifierSplices(parseModuleText(piece.body, piece.module).program, piece.name, name)) : piece.body;
  const docHole = blueprint.holes.find((hole) => hole.id === 'doc');
  const doc = fills.get('doc');
  const isDocFilled = Boolean(doc) && Boolean(docHole?.default) && renamed.includes(docHole.default);
  return { name, text: isDocFilled ? renamed.replace(docHole.default, doc) : renamed };
};

const pieceSourceOf = (blueprint, fills, readFile) => {
  const existing = blueprint.piece.existing;
  const isReuse = Boolean(existing);
  if (!isReuse) return { ...renderPiece(blueprint, fills), module: blueprint.piece.module, isNew: blueprint.piece.moduleIsNew };
  const [module, name] = existing.split('#');
  return { name, text: readFile(module) ?? '', module, isNew: false, isExisting: true };
};

const siteSplice = (located, piece, name) => {
  const match = matchSite(piece, located.node, located.text);
  const isMismatch = !match.ok;
  if (isMismatch) throw new HealError('HEAL_SITE_MISMATCH', `${located.file}:${located.line} does not match the piece: ${match.reason}`, { file: located.file });
  const call = renderCall(name, match.args, { kind: piece.core.kind, negated: Boolean(located.site.negated) });
  const comments = hoistComments(located.text, located.ast, located.start, located.end);
  const text = [...comments, call].join('\n');
  return { splice: replaceRange(located.text, { start: located.start, end: located.end, expectHash: located.site.bodyHash ?? null, text }), call, comments };
};

const rewriteFile = (file, before, entries) => {
  const spliced = spliceAll(before, entries.map((entry) => entry.splice));
  const imported = entries.reduce((text, entry) => (entry.addImport ? addImport(text, file, entry.addImport) : text), spliced);
  const { text, dropped } = dropUnusedImports(before, imported, file);
  return { text, dropped };
};

const groupByFile = (entries) => {
  const byFile = new Map();
  for (const entry of entries) byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry]);
  return byFile;
};

const moduleEdit = (source, after, readFile) => {
  const current = after.get(source.module)?.text ?? readFile(source.module);
  const isPresent = typeof current === 'string';
  const isUnexpected = source.isNew && isPresent;
  if (isUnexpected) throw new HealError('BLUEPRINT_STALE', `${source.module} exists now but the blueprint plans it as a new module; run chemx blueprint again`, { file: source.module });
  const isMissingHost = !source.isNew && !isPresent;
  if (isMissingHost) throw new HealError('BLUEPRINT_STALE', `host module ${source.module} is gone; run chemx blueprint again`, { file: source.module });
  return source.isNew ? createModule({ path: source.module, content: source.text }).content : insertExport(current, source.module, { content: source.text });
};

/**
 * The full in-memory plan: { name, module, pieceText, files: [{ file, before, after, created, dropped }],
 * sites: [{ file, line, moved, call, comments }] }. Throws HealError (BLUEPRINT_STALE, HEAL_SITE_MISMATCH,
 * HEAL_PIECE_SHAPE, HEAL_NAME_TAKEN, ...) before anything is written.
 */
export const planHeal = (blueprint, { fills = new Map(), readFile }) => {
  const refusal = refusalOf(blueprint, fills);
  if (refusal) throw new HealError(refusal[0], refusal[1]);
  const source = pieceSourceOf(blueprint, fills, readFile);
  const piece = pieceCoreOf(source.text, source.name, source.module);
  const isReturning = piece.core.kind === 'expr' || alwaysReturns(piece.core.node);
  if (!isReturning) throw new HealError('HEAL_PIECE_SHAPE', `${source.name} is a statement piece that does not return on every path; a call cannot stand in for it`);
  const located = locateSites(blueprint.callSites, readFile);
  const entries = located.map((site) => ({ file: site.file, line: site.line, moved: site.moved, addImport: site.site.addImport, ...siteSplice(site, piece, source.name) }));
  const after = new Map();
  for (const [file, fileEntries] of groupByFile(entries)) after.set(file, { before: fileEntries.length > 0 ? located.find((site) => site.file === file).text : '', ...rewriteFile(file, located.find((site) => site.file === file).text, fileEntries) });
  const hasModuleEdit = !source.isExisting;
  const moduleText = hasModuleEdit ? moduleEdit(source, after, readFile) : null;
  const isSiteModule = after.has(source.module);
  if (hasModuleEdit) after.set(source.module, { before: isSiteModule ? after.get(source.module).before : readFile(source.module), text: moduleText, dropped: after.get(source.module)?.dropped ?? [] });
  const files = [...after.entries()].map(([file, entry]) => ({ file, before: entry.before ?? null, after: entry.text, created: entry.before === null || entry.before === undefined, dropped: entry.dropped }));
  return {
    name: source.name, module: source.module, pieceText: source.text,
    files: files.sort((a, b) => Number(a.file > b.file) - Number(a.file < b.file)),
    sites: entries.map((entry) => ({ file: entry.file, line: entry.line, moved: entry.moved, call: entry.call, comments: entry.comments }))
  };
};
