/**
 * The one extension table (design spec 4.13). It imports only the records, so the guard can
 * load it without the registry, a parser or any engine. `buildTable(records)` derives the
 * lookups; `STATIC_TABLE` is the table over the shipped records. Later phases add the guard,
 * preflight, micro-sync and vendor sets here, derived the same way.
 */
import { LANGUAGE_RECORDS } from './records/index.js';

const escapeText = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Glob token -> RegExp source, tried in order at the head of the remaining glob.
const GLOB_TOKENS = [
  [/^\*\*\//, () => '(?:.*/)?'],
  [/^\*\*/, () => '.*'],
  [/^\*/, () => '[^/]*'],
  [/^\?/, () => '[^/]'],
  [/^\[[^\]]+\]/, (m) => m.replace(/^\[!/, '[^')],
  [/^\{[^}]*\}/, (m) => `(?:${m.slice(1, -1).split(',').map(escapeText).join('|')})`],
  [/^\\./, (m) => escapeText(m[1])],
  [/^./, (m) => escapeText(m)]
];

/** An anchored RegExp for a glob over a forward-slash path: `*` and `?` stay inside one segment. */
export const compileGlob = (glob) => {
  let source = '';
  let rest = glob;
  while (rest) {
    const [pattern, render] = GLOB_TOKENS.find(([re]) => re.test(rest));
    const token = rest.match(pattern)[0];
    source += render(token);
    rest = rest.slice(token.length);
  }
  return new RegExp(`^${source}$`);
};

const pushTo = (map, key, id) => {
  const ids = map.get(key) ?? [];
  if (!ids.includes(id)) ids.push(id);
  map.set(key, ids);
};

/** Lookups derived from `records`; every id list keeps registration order. */
export const buildTable = (records) => {
  const byExtension = new Map();
  const byFilename = new Map();
  const shebangs = new Map();
  const paths = [];
  const extensions = new Set();
  const sourceExtensions = new Set();
  const declarations = [];
  for (const { id, files, stages } of records) {
    const isSource = (stages.source ?? 'off') !== 'off';
    for (const ext of files.extensions) {
      pushTo(byExtension, ext, id);
      extensions.add(ext);
      if (isSource) sourceExtensions.add(ext);
    }
    (files.filenames ?? []).forEach((name) => pushTo(byFilename, name, id));
    (files.shebangs ?? []).forEach((name) => pushTo(shebangs, name, id));
    (files.paths ?? []).forEach((glob) => paths.push({ glob, re: compileGlob(glob), id }));
    (files.declaration ?? []).forEach((glob) => declarations.push(compileGlob(glob)));
  }
  /** True for a declaration file such as `*.d.ts`, matched on the basename. */
  const isDeclarationName = (name) => {
    const base = name.split(/[\\/]/).pop();
    return declarations.some((re) => re.test(base));
  };
  return { byExtension, byFilename, shebangs, paths, extensions, sourceExtensions, isDeclarationName };
};

export const STATIC_TABLE = buildTable(LANGUAGE_RECORDS);
