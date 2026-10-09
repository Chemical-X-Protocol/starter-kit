/**
 * The file prologue explode must keep at the very top of the component file: a shebang,
 * directives ('use client', 'use strict'), triple-slash directives and file-level pragmas
 * (@ts-nocheck, @jsxImportSource, eslint-disable). Left in the first statement's segment they
 * would land below the generated imports, where 'use client' is an inert expression statement.
 */
import { relocateSpecifier } from './explode-relocate.js';
import { isRelative } from './explode-path-args.js';

const PRAGMA_REGEX = /@(?:ts-nocheck|ts-check|jsx|jsxImportSource|jsxRuntime|jsxFrag|flow)\b|eslint-disable(?!-next-line|-line)/;
const REFERENCE_PATH_REGEX = /(\/\/\/\s*<reference\s+path\s*=\s*)(["'])([^"']*)\2/g;

const isPinnedComment = (comment) => {
  const isTripleSlash = comment.type === 'CommentLine' && comment.value.startsWith('/');
  return isTripleSlash || PRAGMA_REGEX.test(comment.value);
};

/**
 * @param {object} file Babel File node (with `comments` and `program`).
 * @returns {number} Offset where the prologue ends (0 when there is none).
 */
export const prologueEndOf = (file) => {
  const program = file.program;
  const firstStart = program.body[0]?.start ?? Infinity;
  const ends = [
    program.interpreter?.end ?? 0,
    ...(program.directives || []).map((d) => d.end),
    ...(file.comments || []).filter((c) => c.end <= firstStart && isPinnedComment(c)).map((c) => c.end)
  ];
  return Math.max(0, ...ends);
};

/**
 * Rewrites `/// <reference path="..."/>` for a component file that moves into `sub`.
 *
 * @param {string} prologue Prologue text.
 * @param {string} sub Destination directory relative to the original one.
 * @returns {string}
 */
export const relocatePrologue = (prologue, sub) => prologue.replace(REFERENCE_PATH_REGEX, (whole, lead, quote, value) => {
  const isRelativePath = isRelative(value) || !/^[/\\]|^[A-Za-z]:/.test(value);
  return isRelativePath ? `${lead}${quote}${relocateSpecifier(value, sub)}${quote}` : whole;
});
