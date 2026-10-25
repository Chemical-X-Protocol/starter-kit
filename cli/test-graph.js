// Reverse dependency graph for affected-spec selection. The AST index supplies its resolved
// import rows when it is fresh; a static scan of every source file adds what the index does not
// record: dynamic import() (template specifiers fan out to every matching file), require(),
// re-exports, and files a module starts as a process or worker by name (a spec spawning
// 'index.js' depends on every index.js, conservatively). Loads neither can pin to a file
// (computed paths, unresolvable specifiers) make the file "open" (test-graph-open.js).
// Paths are root-relative posix.
import fs from 'node:fs';
import path from 'node:path';
import { scanScope } from './search-scan.js';
import { ensureFresh } from './index-freshness.js';
import { resolveIndexRoot } from './search-root.js';
import { moduleKeysFor } from './search-resolve.js';
import { findOpenFiles, isProseAt } from './test-graph-open.js';
import { addEdge, addNamedFiles, byBasename } from './test-graph-names.js';
import { findOpenOk, pinEntryLoads } from './test-open-ok.js';

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"`])([^'"`\n]+)\1/g;
const STARTS_PROCESS = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(|process\.execPath|new\s+Worker\s*\(/;
const EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.jsx', '.vue', '.svelte'];
const JS_EXT = /\.([cm]?)js$/;

const candidatesFor = (base) => {
  const swapped = JS_EXT.test(base) ? [base.replace(JS_EXT, '.$1ts'), base.replace(JS_EXT, '.tsx')] : [];
  return [...EXTENSIONS.map((ext) => base + ext), ...swapped, ...EXTENSIONS.slice(1).map((ext) => `${base}/index${ext}`)];
};

// Relative specifiers only; bare and aliased ones are the index's job. A template specifier fans
// out to every file under its static prefix when it is real code (templateIsReal: an import() or
// require() call, not on a comment line or inside a string). One after `from` or a bare `import`,
// or quoted in prose, is a code generator's output text or documentation, so it pins nothing.
const resolveSpecifier = (fromFile, specifier, files, templateIsReal) => {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isRelative) return [];
  const templateAt = specifier.indexOf('${');
  const hasTemplate = templateAt >= 0;
  const isGeneratedText = hasTemplate && !templateIsReal;
  if (isGeneratedText) return [];
  if (hasTemplate) {
    const staticPart = specifier.slice(0, templateAt);
    const joined = path.posix.join(path.posix.dirname(fromFile), staticPart);
    const needsSlash = staticPart.endsWith('/') && !joined.endsWith('/');
    const prefix = needsSlash ? `${joined}/` : joined;
    return [...files].filter((file) => file.startsWith(prefix));
  }
  const base = path.posix.join(path.posix.dirname(fromFile), specifier);
  const hit = candidatesFor(base).find((candidate) => files.has(candidate));
  return hit ? [hit] : [];
};

// [text, error]: an unreadable file is reported in graph.unreadable, never skipped silently.
const readText = (file) => {
  try {
    return [fs.readFileSync(file, 'utf8'), null];
  } catch (error) {
    return [null, error];
  }
};

const scanStatically = (root, files, named, importers, texts, unreadable, bare) => {
  for (const file of files) {
    const [text, error] = readText(path.join(root, file));
    if (error) {
      unreadable.push(`${file} (${error.code || error.message})`);
      continue;
    }
    texts.set(file, text);
    for (const match of text.matchAll(SPECIFIER)) {
      const isCall = /^(?:import|require)\s*\(/.test(match[0]);
      const templateIsReal = isCall && match[2].includes('${') && !isProseAt(text, match.index);
      for (const target of resolveSpecifier(file, match[2], files, templateIsReal)) addEdge(importers, file, target);
      const isBare = !match[2].startsWith('.');
      if (isBare) bare.push({ file, specifier: match[2], isCall, at: match.index });
    }
    const startsProcesses = STARTS_PROCESS.test(text);
    if (!startsProcesses) continue;
    addNamedFiles(importers, file, text, named);
  }
};

// Index rows store resolved_path as a module key (path, path without extension, or the dir of
// an index file); map each key back to its file. Unresolved rows and the indexed file list feed
// the open-file check (test-graph-open.js).
const mergeIndexEdges = (db, files, importers, index) => {
  const keyToFile = new Map();
  for (const file of files) {
    for (const key of moduleKeysFor(file)) {
      const isUnclaimed = !keyToFile.has(key);
      if (isUnclaimed) keyToFile.set(key, file);
    }
  }
  for (const row of db.prepare('SELECT path FROM files').all()) index.indexed.add(row.path);
  for (const row of db.prepare('SELECT DISTINCT importer_path, source_module, resolved_path FROM imports').all()) {
    const isUnresolved = row.resolved_path === '';
    if (isUnresolved) {
      index.unresolved.push({ file: row.importer_path, specifier: row.source_module });
      continue;
    }
    index.resolved.add(`${row.importer_path}\0${row.source_module}`);
    const target = keyToFile.get(row.resolved_path);
    const isKnown = Boolean(target) && files.has(row.importer_path);
    if (isKnown) addEdge(importers, row.importer_path, target);
  }
};

const readIndex = (root, files, importers, index) => {
  const isOwnIndex = path.resolve(resolveIndexRoot(root)) === path.resolve(root);
  if (!isOwnIndex) return `the nearest index belongs to ${resolveIndexRoot(root)}, not ${root}`;
  try {
    const session = ensureFresh(root, { scope: '.' });
    const hasDb = Boolean(session.db);
    if (!hasDb) return 'no index database';
    const isStale = session.index.status !== 'pass';
    if (isStale) return `index ${session.index.status}: ${session.index.reason}`;
    mergeIndexEdges(session.db, files, importers, index);
    return null;
  } catch (error) {
    return `index unreadable: ${error.message}`;
  }
};

// Returns { files: Set, importers: Map<file, Set<importer>>, texts: Map, open: Map<file, why>,
// openOk: Map<file, { source, loads }>, source, note, isFile, unreadable }. open lists every file
// whose loads cannot be pinned; openOk those of them (or any file) declared entry points, whose
// loads test-open-ok.js drew as edges. openRules are the manifest's openImports rules. A file that
// could not be read has no outgoing edges, so selection treats any unreadable file as unprovable.
export const buildDependencyGraph = (root, { useIndex = true, openRules = [] } = {}) => {
  const files = new Set(scanScope(root, ['.']).files.map((f) => f.relPath));
  const importers = new Map();
  const texts = new Map();
  const unreadable = [];
  const bare = [];
  const index = { indexed: new Set(), resolved: new Set(), unresolved: [] };
  const named = byBasename(files);
  scanStatically(root, files, named, importers, texts, unreadable, bare);
  const indexNote = useIndex ? readIndex(root, files, importers, index) : 'index not used';
  const source = indexNote ? 'static' : 'index+static';
  const open = findOpenFiles({ root, texts, bare, index: indexNote ? null : index, indexNote });
  const openOk = findOpenOk(texts, openRules);
  pinEntryLoads({ openOk, texts, files, importers, named });
  const isFile = (rel) => Boolean(fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile());
  return { files, importers, texts, open, openOk, source, note: indexNote, isFile, unreadable };
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
        const isChained = chains.has(importer);
        if (isChained) continue;
        chains.set(importer, `${chains.get(node)} <- ${importer}`);
        next.push(importer);
      }
    }
    frontier = next;
  }
  chains.delete(seed);
  return chains;
};
