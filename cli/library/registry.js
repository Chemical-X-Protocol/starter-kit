// The library registry (engine doc, Library: ONE REGISTRY): loads library/<facet>/<id>/ directories of the
// kit, or of any root with the same layout, in id order. It reads and validates; verification is verify.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEntry } from './entry-schema.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LIBRARY_ROOT = path.join(KIT_ROOT, 'library');
export const KIT_ROOT_DIR = KIT_ROOT;

// library/<facet>/ directories that hold something other than entries.
const NON_FACET_DIRS = new Set(['exemplars']);
const PIECE_FILE = /^piece\.(js|ts|vue)$/;
const SPEC_FILE = /^piece\.spec\.(js|ts)$/;

const sortedNames = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name)
  .sort((a, b) => Number(a > b) - Number(a < b));

const findFile = (dir, pattern) => fs.readdirSync(dir).sort().find((name) => pattern.test(name)) ?? null;

const readEntryFile = (entryPath) => {
  try {
    return { entry: JSON.parse(fs.readFileSync(entryPath, 'utf-8')), parseError: null };
  } catch (err) {
    return { entry: null, parseError: err instanceof Error ? err.message : String(err) };
  }
};

const loadOne = (root, facetName, name) => {
  const dir = path.join(root, facetName, name);
  const entryPath = path.join(dir, 'entry.json');
  const { entry, parseError } = fs.existsSync(entryPath) ? readEntryFile(entryPath) : { entry: null, parseError: 'entry.json is missing' };
  const id = `${facetName}/${name}`;
  const problems = parseError ? [parseError] : validateEntry(entry);
  const isIdMismatch = Boolean(entry) && entry.id !== id;
  if (isIdMismatch) problems.push(`entry.id "${entry.id}" does not match its directory "${id}"`);
  return { id, dir, entryPath, entry, problems, pieceFile: findFile(dir, PIECE_FILE), specFile: findFile(dir, SPEC_FILE) };
};

/** Every entry under root, in id order: { id, dir, entryPath, entry, problems, pieceFile, specFile }. */
export const loadLibrary = (root = LIBRARY_ROOT) => {
  const hasRoot = fs.existsSync(root);
  if (!hasRoot) return [];
  const items = [];
  for (const facetName of sortedNames(root).filter((name) => !NON_FACET_DIRS.has(name))) {
    for (const name of sortedNames(path.join(root, facetName))) items.push(loadOne(root, facetName, name));
  }
  return items;
};

export const findEntry = (id, root = LIBRARY_ROOT) => loadLibrary(root).find((item) => item.id === id) ?? null;

export const readPiece = (item) => fs.readFileSync(path.join(item.dir, item.pieceFile), 'utf-8');
