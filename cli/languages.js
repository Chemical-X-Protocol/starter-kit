/**
 * Chemical X Language Registry facade (design spec 4.2).
 * The same exports and LANGUAGE_DEFINITIONS keys as before the registry, derived from the
 * language records: one definition per legacy id (`jvm` and `cpp` group java/kotlin and c/c++
 * until P4-1), source languages only. LANGUAGE_DEFINITIONS stays a mutable plain object; it is
 * rebuilt in place when a spec uses the registerTestLanguage seam in cli/lang/registry.js.
 */
import path from 'node:path';
import { allLanguages, languageTable, onRegistryChange } from './lang/registry.js';

export const LANGUAGE_DEFINITIONS = {};

const EXCLUDED_NAME_PATTERNS = ['.min.'];
const BABEL_ENGINES = new Set(['babel', 'sfc']);

let derivedKeys = [];
let ALL_EXTENSIONS = new Set();

/** Today's parser ids: 'babel' for the JS family, 'php' for php-parser, else the legacy id. */
const facadeParser = (key, record) => {
  const engine = record.engines.index;
  const isBabel = BABEL_ENGINES.has(engine);
  if (isBabel) return 'babel';
  return engine === 'php-parser' ? 'php' : key;
};

const toDefinition = (key, records) => {
  const [first] = records;
  const block = first.syntax.blockComment[0] ?? first.syntax.docString?.[0];
  return {
    id: key,
    name: records.map((r) => r.name).join(' / '),
    extensions: new Set(records.flatMap((r) => r.files.extensions)),
    parser: facadeParser(key, first),
    commentPrefix: first.syntax.lineComment[0],
    blockComment: { start: block?.open, end: block?.close }
  };
};

/** Rebuilds the registry-derived definitions; keys a caller assigned by hand are left alone. */
const syncDefinitions = () => {
  derivedKeys.forEach((key) => delete LANGUAGE_DEFINITIONS[key]);
  const groups = new Map();
  for (const record of allLanguages()) {
    const isSource = (record.stages.source ?? 'off') !== 'off';
    const key = record.legacyId ?? record.id;
    if (isSource) groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  for (const [key, records] of groups) LANGUAGE_DEFINITIONS[key] = toDefinition(key, records);
  derivedKeys = [...groups.keys()];
  ALL_EXTENSIONS = new Set([...groups.values()].flat().flatMap((r) => r.files.extensions));
};

syncDefinitions();
onRegistryChange(syncDefinitions);

export const getLanguageByExtension = (ext) => {
  const normalized = ext.toLowerCase();
  for (const lang of Object.values(LANGUAGE_DEFINITIONS)) {
    const hasExtension = lang.extensions.has(normalized);
    if (hasExtension) return lang;
  }
  return null;
};

export const getLanguageForFile = (filePath) => {
  const ext = path.extname(filePath);
  return getLanguageByExtension(ext);
};

export const isSourceFile = (name, options = {}) => {
  const { includeTests = true } = options;
  const ext = path.extname(name).toLowerCase();
  const isKnownExtension = ALL_EXTENSIONS.has(ext);
  if (!isKnownExtension) return false;
  const isDeclarationFile = languageTable().isDeclarationName(name);
  if (isDeclarationFile) return false;

  const isExcludedName = EXCLUDED_NAME_PATTERNS.some((pat) => name.includes(pat));
  if (isExcludedName) {
    return false;
  }

  // Today's test-name rule, kept verbatim for the facade; P1-10 moves callers to record test globs.
  if (!includeTests) {
    const isTest = name.includes('.test.') || name.includes('.spec.') || name.endsWith('Test.cs') || name.endsWith('Tests.cs');
    if (isTest) return false;
  }

  return true;
};

export const isBabelParsable = (filePath) => {
  const lang = getLanguageForFile(filePath);
  return lang?.parser === 'babel';
};
