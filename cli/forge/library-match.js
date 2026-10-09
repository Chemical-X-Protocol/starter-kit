// Library match path (engine doc, Library: a group whose shape is a verified piece's gives a reuse of it).
// A piece is matched on its anchors, not its fingerprints: a site is a statement or expression inside a
// function while the piece is the whole function, so their fps differ even when the code is the same. The
// non-literal anchors (called names and the modules or globals they use) must be equal as sets, with at
// least MIN_ANCHORS of them, so a group that is only a fragment of a piece (A4 against is-path-inside) is
// left to the host-module rule.
import fs from 'node:fs';
import path from 'node:path';
import { loadLibrary, readPiece, LIBRARY_ROOT } from '../library/registry.js';
import { unitsOfText } from '../library/entry-fp.js';
import { sharedAnchors, byCodePoint } from './group-shape.js';
import { langOfKey, runtimeOfKey } from './placement.js';

const MIN_ANCHORS = 3;
const LIBRARY_RUNTIMES = { none: 'plain', node: 'plain', vue: 'vue', react: 'react', svelte: 'svelte' };
const RETIRED = new Set(['retired', 'orphaned']);

/** Anchors without literals, with an imported name and the global of the same name made one: call:parse, mod:fs. */
export const shapeAnchorsOf = (anchors) => {
  const names = anchors.flatMap((anchor) => {
    const match = /^(call|global|import):([^#]+)/.exec(anchor);
    if (!match) return [];
    return [`${match[1] === 'call' ? 'call' : 'mod'}:${match[2]}`];
  });
  return [...new Set(names)].sort(byCodePoint);
};

const importLinesOf = (text) => text.split('\n').filter((line) => line.startsWith('import '));

const pieceFnOf = (item, text) => {
  const { units } = unitsOfText(item.entry.defaultModule, text);
  return units.find((unit) => unit.kind === 'fn' && unit.declName === item.entry.exportName) ?? null;
};

/** Library entries with the shape anchors of their piece function: [{ item, anchors, text }] in id order. */
export const loadMatchableEntries = (root = LIBRARY_ROOT) => loadLibrary(root)
  .filter((item) => item.entry && item.problems.length === 0 && item.pieceFile && !RETIRED.has(item.entry.status))
  .flatMap((item) => {
    const text = readPiece(item);
    const unit = pieceFnOf(item, text);
    return unit ? [{ item, anchors: shapeAnchorsOf(unit.anchors), text }] : [];
  });

const isSameFacet = (entry, facetKey) => {
  const runtime = LIBRARY_RUNTIMES[entry.facet.framework ?? 'none'] ?? 'plain';
  return entry.facet.lang === langOfKey(facetKey) && runtime === runtimeOfKey(facetKey);
};

const sameSet = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The library entry a group is the shape of, or null. Returns { id, version, exportName, defaultModule,
 * signature, params, holes, status, text, imports } of the first entry in id order that matches.
 */
export const matchLibrary = (group, entries) => {
  const groupAnchors = shapeAnchorsOf(sharedAnchors(group.instances));
  const hasEvidence = groupAnchors.length >= MIN_ANCHORS;
  if (!hasEvidence) return null;
  const hit = entries.find(({ item, anchors }) => isSameFacet(item.entry, group.facetKey) && sameSet(anchors, groupAnchors));
  if (!hit) return null;
  const { entry } = hit.item;
  return {
    id: entry.id, version: entry.version, exportName: entry.exportName, defaultModule: entry.defaultModule, signature: entry.signature,
    params: entry.params, holes: entry.holes, status: entry.status, text: hit.text, imports: importLinesOf(hit.text)
  };
};

/** True when the project already has the piece's module with the export (the blueprint is then a reuse). */
export const pieceExistsIn = (root, match) => {
  const file = path.join(root, match.defaultModule);
  const isPresent = fs.existsSync(file);
  if (!isPresent) return false;
  return new RegExp(`\\bexport\\b[^\\n]*\\b${match.exportName}\\b`).test(fs.readFileSync(file, 'utf-8'));
};
