// Reverse dependency graph for affected-spec selection. The AST index supplies its resolved
// import rows when it is fresh; a static scan of every source file adds what the index does not
// record: dynamic import() (template specifiers fan out to every matching file), require(),
// re-exports, and files a module starts as a process or worker by name (a spec spawning
// 'index.js' depends on every index.js, conservatively). Paths are root-relative posix.
import fs from 'node:fs';
import path from 'node:path';
import { scanScope } from './search-scan.js';
import { syncSearchIndex } from './search-sync.js';
import { resolveIndexRoot } from './search-root.js';
import { moduleKeysFor } from './search-resolve.js';

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"`])([^'"`\n]+)\1/g;
const FILE_LITERAL = /['"`]([^'"`\n]*?\b([\w.-]+\.(?:[cm]?[jt]sx?|vue|svelte)))['"`]/g;
const STARTS_PROCESS = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(|process\.execPath|new\s+Worker\s*\(/;
const EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.jsx', '.vue', '.svelte'];
const JS_EXT = /\.([cm]?)js$/;

const candidatesFor = (base) => {
  const swapped = JS_EXT.test(base) ? [base.replace(JS_EXT, '.$1ts'), base.replace(JS_EXT, '.tsx')] : [];
  return [...EXTENSIONS.map((ext) => base + ext), ...swapped, ...EXTENSIONS.slice(1).map((ext) => `${base}/index${ext}`)];
};

// Relative specifiers only; bare and aliased ones are the index's job.
const resolveSpecifier = (fromFile, specifier, files) => {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isRelative) return [];
  const templateAt = specifier.indexOf('${');
  if (templateAt >= 0) {
    const prefix = path.posix.join(path.posix.dirname(fromFile), specifier.slice(0, templateAt));
    const dirPrefix = specifier.slice(0, templateAt).endsWith('/') ? `${prefix}/` : prefix;
    return [...files].filter((file) => file.startsWith(dirPrefix));
  }
  const base = path.posix.join(path.posix.dirname(fromFile), specifier);
  const hit = candidatesFor(base).find((candidate) => files.has(candidate));
  return hit ? [hit] : [];
};

const addEdge = (importers, from, to) => {
  const isSelfEdge = from === to;
  if (isSelfEdge) return false;
  if (!importers.has(to)) importers.set(to, new Set());
  importers.get(to).add(from);
  return true;
};

// [text, error]: an unreadable file is reported in graph.unreadable, never skipped silently.
const readText = (file) => {
  try {
    return [fs.readFileSync(file, 'utf8'), null];
  } catch (error) {
    return [null, error];
  }
};

const byBasename = (files) => {
  const map = new Map();
  for (const file of files) {
    const name = path.posix.basename(file);
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(file);
  }
  return map;
};

const scanStatically = (root, files, importers, texts, unreadable) => {
  const named = byBasename(files);
  for (const file of files) {
    const [text, error] = readText(path.join(root, file));
    if (error) {
      unreadable.push(`${file} (${error.code || error.message})`);
      continue;
    }
    texts.set(file, text);
    for (const match of text.matchAll(SPECIFIER)) {
      for (const target of resolveSpecifier(file, match[2], files)) addEdge(importers, file, target);
    }
    const startsProcesses = STARTS_PROCESS.test(text);
    if (!startsProcesses) continue;
    for (const match of text.matchAll(FILE_LITERAL)) {
      for (const target of named.get(match[2]) || []) addEdge(importers, file, target);
    }
  }
};

// Index rows store resolved_path as a module key (path, path without extension, or the dir of
// an index file); map each key back to its file.
const mergeIndexEdges = (db, files, importers) => {
  const keyToFile = new Map();
  for (const file of files) for (const key of moduleKeysFor(file)) if (!keyToFile.has(key)) keyToFile.set(key, file);
  const rows = db.prepare("SELECT importer_path, resolved_path FROM imports WHERE resolved_path != ''").all();
  for (const row of rows) {
    const target = keyToFile.get(row.resolved_path);
    const isKnown = Boolean(target) && files.has(row.importer_path);
    if (isKnown) addEdge(importers, row.importer_path, target);
  }
};

const readIndex = (root, files, importers) => {
  const isOwnIndex = path.resolve(resolveIndexRoot(root)) === path.resolve(root);
  if (!isOwnIndex) return `the nearest index belongs to ${resolveIndexRoot(root)}, not ${root}`;
  try {
    const sync = syncSearchIndex('.', root, {});
    if (!sync) return 'no index database';
    if (sync.status !== 'fresh') return `index ${sync.status}: ${sync.staleReason}`;
    mergeIndexEdges(sync.db, files, importers);
    return null;
  } catch (error) {
    return `index unreadable: ${error.message}`;
  }
};

// Returns { files: Set, importers: Map<file, Set<importer>>, texts: Map, source, note, isFile,
// unreadable }. A file that could not be read has no outgoing edges, so selection treats any
// unreadable file as unprovable.
export const buildDependencyGraph = (root, { useIndex = true } = {}) => {
  const files = new Set(scanScope(root, ['.']).files.map((f) => f.relPath));
  const importers = new Map();
  const texts = new Map();
  const unreadable = [];
  scanStatically(root, files, importers, texts, unreadable);
  const indexNote = useIndex ? readIndex(root, files, importers) : 'index not used';
  const source = indexNote ? 'static' : 'index+static';
  const isFile = (rel) => Boolean(fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile());
  return { files, importers, texts, source, note: indexNote, isFile, unreadable };
};

// Breadth-first walk from a changed file to everything that depends on it.
// Returns Map<dependent, chain> where chain reads 'changed <- a <- dependent'.
export const walkDependents = (graph, seed) => {
  const chains = new Map([[seed, seed]]);
  let frontier = [seed];
  while (frontier.length > 0) {
    const next = [];
    for (const node of frontier) {
      for (const importer of graph.importers.get(node) || []) {
        if (chains.has(importer)) continue;
        chains.set(importer, `${chains.get(node)} <- ${importer}`);
        next.push(importer);
      }
    }
    frontier = next;
  }
  chains.delete(seed);
  return chains;
};
