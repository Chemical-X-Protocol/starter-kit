// Everything a blueprint reads, built once per run from the ledger (never from the clock or the input
// order): rows in file and line order, the tree reader the near-miss search uses, enclosing and declared
// names, sibling specs and the matchable library entries.
import fs from 'node:fs';
import path from 'node:path';
import { createTreeReader } from './unit-trees.js';
import { createUbiquityIndex } from './gates.js';
import { byCodePoint } from './group-shape.js';

const byRowOrder = (a, b) => byCodePoint(a.file_path, b.file_path) || a.start_line - b.start_line || a.start - b.start || a.id - b.id;

const SPEC_SUFFIXES = ['spec', 'test'];

const siblingSpecsOf = (file) => {
  const extension = path.posix.extname(file);
  const stem = file.slice(0, file.length - extension.length);
  return SPEC_SUFFIXES.map((suffix) => `${stem}.${suffix}${extension}`);
};

/**
 * Context over a ledger ({ rows, contentHashes }). options: { root, readFile(relative) => text | null,
 * groups (the run's accepted groups, for drift reported on overlapping groups), entries (library-match.js loadMatchableEntries), fileExists, packageRootOfFile }.
 */
export const createBlueprintContext = ({ root, ledger, groups = [], readFile, entries = [], fileExists = (relative) => fs.existsSync(path.join(root, relative)), packageRootOfFile = () => '.' }) => {
  const rows = [...ledger.rows].sort(byRowOrder);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const treeReader = createTreeReader(readFile, rows, { contentHashes: ledger.contentHashes });
  const ubiquitousOf = createUbiquityIndex(rows);
  const fnsByFile = new Map();
  for (const row of rows.filter((candidate) => candidate.kind === 'fn' && candidate.decl_name)) {
    fnsByFile.set(row.file_path, [...(fnsByFile.get(row.file_path) ?? []), row]);
  }

  const enclosingNameOf = (instance) => {
    const row = rowsById.get(instance.unitIds[0]);
    const isNamedFunction = row?.kind === 'fn' && Boolean(row.decl_name);
    if (isNamedFunction) return row.decl_name;
    const around = (fnsByFile.get(instance.file) ?? []).filter((fn) => fn.start <= instance.start && fn.end >= instance.end);
    const innermost = around.sort((a, b) => (a.end - a.start) - (b.end - b.start) || a.id - b.id)[0];
    return innermost?.decl_name ?? null;
  };

  const declaredIn = (files) => new Set(files.flatMap((file) => (fnsByFile.get(file) ?? []).map((row) => row.decl_name)));

  const instancesByFile = new Map();
  for (const group of groups) {
    for (const instance of group.instances) instancesByFile.set(instance.file, [...(instancesByFile.get(instance.file) ?? []), { group, instance }]);
  }

  const isOverlapping = (a, b) => a.file === b.file && a.startLine <= b.endLine && a.endLine >= b.startLine;

  // Drift spans other accepted groups report over the same code (a window around an expression idiom
  // sees spans the expression group's own search cannot), minus spans inside the group itself.
  const relatedDriftOf = (group) => {
    const others = group.instances.flatMap((instance) => (instancesByFile.get(instance.file) ?? [])
      .filter((entry) => entry.group.id !== group.id && isOverlapping(entry.instance, instance))
      .map((entry) => entry.group));
    const spans = [...new Map(others.sort((a, b) => byCodePoint(a.id, b.id)).map((other) => [other.id, other])).values()]
      .flatMap((other) => (other.drift ?? []).map((span) => ({ ...span, reason: `reported by overlapping group ${other.id}` })));
    return spans.filter((span) => !group.instances.some((instance) => isOverlapping(span, instance)));
  };

  const coveringSpecsOf = (file) => siblingSpecsOf(file).filter(fileExists);

  return {
    root, rows, rowsById, contentHashes: ledger.contentHashes, entries, fileExists, packageRootOfFile, readFile,
    treeOf: treeReader.treeOf, ubiquitousOf, enclosingNameOf, declaredIn, coveringSpecsOf, relatedDriftOf
  };
};
