// Entry points of the dependency graph (task #6774). A file that loads modules by a computed path
// (`import(modulePath)`), or imports an alias the graph cannot resolve, "may load any changed file",
// so every spec that depends on it rides along on every change (test-select.js). That is right for
// an unknown loader and wasteful for a known one: run-hook.js loads three hook modules it names, a
// spec loads a temp file it just wrote. A file declared open-ok stops widening the run and instead
// depends on what it can be shown to load:
//   - the files its text names in quotes ('./session-start.js', 'cli/index.js'), found like a spawned script;
//   - the directories it declares in `loads` (recursively), for a loader that takes any module from them.
// A change to one of those then selects the file's dependents like any import. Declare it with
// `// chemx: open-ok` in the first 30 lines (a block comment or <!-- --> works too; add
// `loads=./hooks,../lib` for directories relative to the file), or with a rule
// { glob, why, loads? } under "openImports" in test-lanes.json (`loads` relative to the project root).
// The declaration is a promise that the loads are covered: a loader that really reaches anywhere
// must stay undeclared. A relative template in a call, `import(`./hooks/${name}.js`)`, needs no
// declaration: the graph already fans it out to every file under ./hooks (test-graph.js).
import path from 'node:path';
import { addEdge, addNamedFiles } from './test-graph-names.js';

const MARKER = /^\s*(?:\/\/|\/\*+|\*|<!--)\s*chemx:\s*open-ok(?![\w-])(.*)$/;
const MARKER_LINES = 30;
const MODULE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;
const MARKER_LOADS = /\bloads=([^\s:;]+)/;

const markerLine = (text = '') => text.split('\n', MARKER_LINES).map((line) => line.match(MARKER)).find(Boolean);

export const hasOpenOkMarker = (text = '') => Boolean(markerLine(text));

const cleanDirs = (dirs) => dirs.filter((dir) => typeof dir === 'string' && dir.length > 0).map((dir) => path.posix.normalize(dir).replace(/\/+$/, '') || '.');
const ruleDirs = (rule) => (Array.isArray(rule?.loads) ? cleanDirs(rule.loads) : []);
const markerDirs = (file, line) => cleanDirs((line[1].match(MARKER_LOADS)?.[1] || '').split(',')).map((dir) => path.posix.join(path.posix.dirname(file), dir));

// texts: Map<file, source> (the graph's). rules: the manifest's openImports. Returns
// Map<file, { source, loads }>: source is 'marker' or the rule's why, loads the directories declared.
export const findOpenOk = (texts, rules = []) => {
  const found = new Map();
  for (const [file, text] of texts) {
    const rule = rules.find((candidate) => path.matchesGlob(file, candidate.glob));
    const line = markerLine(text);
    const isDeclared = Boolean(rule) || Boolean(line);
    if (!isDeclared) continue;
    const loads = [...ruleDirs(rule), ...(line ? markerDirs(file, line) : [])];
    found.set(file, { source: line ? 'marker' : String(rule.why || 'openImports rule'), loads });
  }
  return found;
};

const modulesUnder = (files, dir) => [...files].filter((file) => (dir === '.' || file.startsWith(`${dir}/`)) && MODULE_FILE.test(file));

// Draws the edges an open-ok file's loads stand for. named: the graph's basename index.
export const pinEntryLoads = ({ openOk, texts, files, importers, named }) => {
  for (const [file, { loads }] of openOk) {
    addNamedFiles(importers, file, texts.get(file) || '', named);
    for (const dir of loads) for (const target of modulesUnder(files, dir)) addEdge(importers, file, target);
  }
};
