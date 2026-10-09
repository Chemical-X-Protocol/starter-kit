/**
 * Relative module specifiers for explode: find them in a statement, rewrite them for a file that
 * moves one or more directories deeper, and check that every specifier in the generated capsule
 * still resolves to the module it named before.
 */
import path from 'node:path';

import { relativeSpecifiers, unrelocatableSpecifiers } from './explode-path-args.js';

export { relativeSpecifiers, unrelocatableSpecifiers };

const posix = path.posix;
const ROOT = '/__capsule_root__';
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

/**
 * @param {string} value Specifier relative to the original file's directory.
 * @param {string} sub Directory of the new file, relative to the original file's directory.
 * @returns {string}
 */
export const relocateSpecifier = (value, sub) => {
  const isUnmoved = !sub;
  if (isUnmoved) return value;
  let next = posix.relative(posix.join(ROOT, sub), posix.join(ROOT, value));
  const isBare = !next.startsWith('.');
  if (isBare) next = `./${next}`;
  const keepsSlash = value.endsWith('/') && !next.endsWith('/');
  return keepsSlash ? `${next}/` : next;
};

/**
 * Rewrite the relative specifiers inside a text slice.
 *
 * @param {string} text The slice.
 * @param {number} offset Absolute offset of the slice's first character.
 * @param {{ start: number, end: number, value: string }[]} specs Specifiers inside the slice.
 * @param {string} sub Destination directory relative to the original one.
 * @returns {string}
 */
export const relocateText = (text, offset, specs, sub) => {
  let out = '';
  let cursor = 0;
  for (const spec of specs) {
    const from = spec.start - offset;
    const quote = text[from];
    out += text.slice(cursor, from) + quote + (spec.prefix || '') + relocateSpecifier(spec.value, sub) + quote;
    cursor = spec.end - offset;
  }
  return out + text.slice(cursor);
};

/**
 * Specifiers in the generated files that no longer point at the module they named.
 *
 * @param {Record<string, object[]>} programsByFile Parsed programs per generated file (path relative to the original's directory).
 * @param {string[]} originalValues Relative specifiers of the original source.
 * @returns {string[]} Descriptions of broken specifiers.
 */
export const brokenSpecifiers = (programsByFile, originalValues) => {
  const originals = new Set(originalValues.map((v) => posix.join(ROOT, v)));
  const generated = new Set(Object.keys(programsByFile).map((f) => posix.join(ROOT, f)));
  const broken = [];
  for (const [file, programs] of Object.entries(programsByFile)) {
    for (const spec of programs.flatMap((p) => relativeSpecifiers(p))) {
      const target = posix.join(ROOT, posix.dirname(file), spec.value);
      const isOriginalTarget = originals.has(target);
      const isGeneratedTarget = RESOLVE_SUFFIXES.some((suffix) => generated.has(`${target}${suffix}`));
      const isResolved = isOriginalTarget || isGeneratedTarget;
      if (!isResolved) broken.push(`${file}: '${spec.value}'`);
    }
  }
  return broken;
};
