// Edges the import graph draws from the file names a text mentions: a file that starts a process
// or worker names the script it runs, and an entry point declared open-ok names the modules it
// loads by path (test-open-ok.js). Shared by the graph builder and the open-ok pinning.
// Paths are root-relative posix.
import path from 'node:path';

export const FILE_LITERAL = /['"`]([^'"`\n]*?\b([\w.-]+\.(?:[cm]?[jt]sx?|vue|svelte)))['"`]/g;
export const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
export const LISTS_DIRECTORY = /\b(?:readdirSync|readdir|opendirSync|globSync)\s*\(/;

const isAncestorDir = (dir, file) => dir === '.' || file.startsWith(`${dir}/`);

export const addEdge = (importers, from, to) => {
  const isSelfEdge = from === to;
  if (isSelfEdge) return false;
  const hasImporters = importers.has(to);
  if (!hasImporters) importers.set(to, new Set());
  importers.get(to).add(from);
  return true;
};

export const byBasename = (files) => {
  const map = new Map();
  for (const file of files) {
    const name = path.posix.basename(file);
    const hasEntry = map.has(name);
    if (!hasEntry) map.set(name, []);
    map.get(name).push(file);
  }
  return map;
};

// A name in a process-starting file ('index.js', '../index.js', `${dir}/team-db.js`) is meant
// relative to that file, so files with that name in its own directory or an ancestor win
// (path.join(here, '..', 'index.js') is never cli/team/index.js from cli/). With none there,
// every file of that name is a candidate: unsure means more specs, never fewer.
export const spawnedTargets = (fromFile, literal, sameName) => {
  const isPlainPath = literal.includes('/') && !literal.includes('${');
  const fromDir = path.posix.dirname(fromFile);
  const exact = isPlainPath ? sameName.filter((f) => f === path.posix.join(fromDir, literal) || f === path.posix.normalize(literal)) : [];
  const hasExact = exact.length > 0;
  if (hasExact) return exact;
  const nearby = sameName.filter((f) => isAncestorDir(path.posix.dirname(f), fromFile));
  return nearby.length > 0 ? nearby : sameName;
};

// Draws an edge from `file` to every file whose name a quoted literal in `text` mentions.
// Returns how many distinct files it named.
export const addNamedFiles = (importers, file, text, named) => {
  const hits = new Set();
  for (const match of text.matchAll(FILE_LITERAL)) {
    for (const target of spawnedTargets(file, match[1], named.get(match[2]) || [])) {
      const wasAdded = addEdge(importers, file, target);
      if (wasAdded) hits.add(target);
    }
  }
  return hits.size;
};
