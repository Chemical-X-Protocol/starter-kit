// Module resolution model of the fuzz oracle (#2596): the TS "bundler" model the canonicalizer assumes
// (bindings.js normalizeImportSource). A relative specifier tries the exact file, then the TS/JS
// extensions, then a written .js/.jsx/.mjs/.cjs mapped to its TS source, then an index file. A
// builtin resolves to one stub per module, whether written with `node:` or not, except the builtins
// that exist only with the prefix (node:test). Any other bare specifier is a package stub of its own.
// Assumption (not modelled): a project never holds two sources of one stem (x.js next to x.ts).
import { builtinModules } from 'node:module';
import path from 'node:path';

const UNPREFIXED = new Set(builtinModules.filter((name) => !name.startsWith('node:')));
const PROBE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.json'];
const TS_SOURCE_OF = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

const candidatesOf = (base) => {
  const extension = path.posix.extname(base);
  const stem = base.slice(0, base.length - extension.length);
  const mapped = (TS_SOURCE_OF[extension] ?? []).map((ext) => `${stem}${ext}`);
  const indexes = ['/index.ts', '/index.tsx', '/index.js'].map((suffix) => `${base}${suffix}`);
  return [...PROBE_EXTENSIONS.map((ext) => `${base}${ext}`), ...mapped, ...indexes];
};

/** Resolves `spec` from file `from` against the side's files: a file path, 'stub:<id>' or null. */
export const resolveSpecifier = (from, spec, files) => {
  const isPrefixed = spec.startsWith('node:');
  const name = isPrefixed ? spec.slice(5) : spec;
  const isBuiltin = isPrefixed || UNPREFIXED.has(spec);
  if (isBuiltin) return UNPREFIXED.has(name) ? `stub:builtin:${name}` : `stub:builtin:node:${name}`;
  const isRelative = spec.startsWith('./') || spec.startsWith('../');
  if (!isRelative) return `stub:package:${spec}`;
  const base = path.posix.join(path.posix.dirname(from), spec);
  return candidatesOf(base).find((candidate) => Object.hasOwn(files, candidate)) ?? null;
};
