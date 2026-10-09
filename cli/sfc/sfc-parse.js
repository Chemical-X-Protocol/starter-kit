/**
 * The one shared Vue SFC parse layer (Decision 1: @vue/compiler-sfc is a core
 * dependency). Audit, index, outline, blast radius and generators read SFCs through
 * here instead of regex-matching the first <script> block.
 *
 * parseSfc returns every script block (classic and setup, with lang and src), the
 * template AST from @vue/compiler-dom (expressions already parsed by Babel), styles,
 * and a script overlay: one Babel-parsable string with the same line and column
 * geometry as the SFC, so AST locations are file locations.
 */
import { createRequire } from 'node:module';
import { parseSvelteSfc } from './svelte-parse.js';

const requireCjs = createRequire(import.meta.url);
let compilerSfc = null;

const loadCompilerSfc = () => {
  compilerSfc = compilerSfc || requireCjs('@vue/compiler-sfc');
  return compilerSfc;
};

const LINE_BREAKS = new Set(['\n', '\r']);
const cache = new Map();
const CACHE_LIMIT = 64;

const toScriptBlock = (block) => ({
  content: block.content,
  lang: block.lang || 'js',
  isSetup: Boolean(block.setup),
  src: block.src || null,
  startOffset: block.loc.start.offset,
  endOffset: block.loc.end.offset,
  startLine: block.loc.start.line,
  endLine: block.loc.end.line
});

const toTemplateBlock = (block) => ({
  ast: block.ast || null,
  content: block.content,
  lang: block.lang || 'html',
  src: block.src || null,
  startLine: block.loc.start.line,
  endLine: block.loc.end.line,
  isParsed: Boolean(block.ast) && !block.lang
});

const formatError = (err) => {
  const message = err instanceof Error ? err.message : String(err);
  const errorLoc = err?.loc;
  const line = errorLoc?.start?.line ?? 1;
  return { message, line };
};

/** Blanks everything outside the given blocks while keeping every line break. */
export const buildScriptOverlay = (content, blocks) => {
  const chars = content.split('').map((ch) => (LINE_BREAKS.has(ch) ? ch : ' '));
  for (const block of blocks) {
    for (let i = block.startOffset; i < block.endOffset; i += 1) chars[i] = content[i];
  }
  return chars.join('');
};

const parseUncached = (content, filename) => {
  const isSvelte = filename.endsWith('.svelte');
  if (isSvelte) return parseSvelteSfc(content, buildScriptOverlay);
  const { parse } = loadCompilerSfc();
  const { descriptor, errors } = parse(content, { filename, sourceMap: false, ignoreEmpty: false });
  const scripts = [descriptor.script, descriptor.scriptSetup]
    .filter(Boolean)
    .map(toScriptBlock)
    .sort((a, b) => a.startOffset - b.startOffset);
  const inlineScripts = scripts.filter((s) => !s.src);
  return {
    errors: errors.map(formatError),
    scripts,
    template: descriptor.template ? toTemplateBlock(descriptor.template) : null,
    styles: descriptor.styles.map((s) => ({ lang: s.lang || 'css', startLine: s.loc.start.line, content: s.content })),
    scriptOverlay: inlineScripts.length > 0 ? buildScriptOverlay(content, inlineScripts) : ''
  };
};

/** Parses an SFC once per (filename, content); never throws. */
export const parseSfc = (content, filename = 'component.vue') => {
  const key = `${filename}\u0000${content}`;
  const hit = cache.get(key);
  const isCached = Boolean(hit);
  if (isCached) return hit;
  let result;
  try {
    result = parseUncached(content, filename);
  } catch (err) {
    result = { errors: [formatError(err)], scripts: [], template: null, styles: [], scriptOverlay: '' };
  }
  const isCacheFull = cache.size >= CACHE_LIMIT;
  if (isCacheFull) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
};

/** True when the file should go through the SFC layer (Vue and Svelte components). */
export const isSfcFile = (filePath = '') => filePath.endsWith('.vue') || filePath.endsWith('.svelte');
