// Open edges of the dependency graph: loads it cannot pin to a file. A computed import(name) /
// require(name), or an import specifier that is neither relative, a builtin, nor an installed
// or declared package ('@/b.js', '#lib/b.js', '~/x' without a resolver), may load ANY file, so
// selection treats such a file as a dependent of every change (test-select.js). Unsure means
// more specs, never fewer. Text on a whole comment line or inside a string opened on the same
// line is prose or fixture data, not a load (a regex literal holding an unbalanced quote before
// a load on the same line could hide that load; accepted, it is rare).
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const LOAD_CALL = /(?<![.\w$])(import|require)\s*\(\s*(?=[^\s)])/g;
const TEMPLATE_AT = /^`([^`]*)`/;
const BUILTINS = new Set(builtinModules);
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const QUOTES = new Set(["'", '"', '`']);
const OPEN_EXPR = '${';

// True when `index` sits on a comment line, after // on its line, or inside a string literal
// opened earlier on its line (template ${...} expressions count as code).
export const isProseAt = (text, index) => {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const line = text.slice(lineStart, index);
  if (COMMENT_LINE.test(line)) return true;
  const stack = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const top = stack.at(-1);
    const isInString = Boolean(top) && top !== '{';
    if (isInString && ch === '\\') {
      i++;
      continue;
    }
    if (top === '`' && line.startsWith(OPEN_EXPR, i)) {
      stack.push('{');
      i++;
      continue;
    }
    if (top === '{' && ch === '}') {
      stack.pop();
      continue;
    }
    if (!isInString && ch === '/' && line[i + 1] === '/') return true;
    if (!isInString && QUOTES.has(ch)) stack.push(ch);
    else if (isInString && ch === top) stack.pop();
  }
  const top = stack.at(-1);
  return Boolean(top) && top !== '{';
};

// Shape of a module id; prose like ', ' or '{{ imp.source }}' never is one.
export const looksLikeModuleId = (specifier) => /^[^\s,{}()'"`<>|;]+$/.test(specifier);

// The first computed load in `text` as 'import(<expr>)', or null.
export const findComputedLoad = (text) => {
  for (const match of text.matchAll(LOAD_CALL)) {
    if (isProseAt(text, match.index)) continue;
    const at = match.index + match[0].length;
    const rest = text.slice(at, at + 60);
    const isPlainString = rest[0] === "'" || rest[0] === '"';
    if (isPlainString) continue;
    const template = rest.match(TEMPLATE_AT)?.[1];
    const isRelativeTemplate = template !== undefined && (!template.includes(OPEN_EXPR) || /^\.\.?\//.test(template));
    if (isRelativeTemplate) continue;
    return `${match[1]}(${rest.split(/[)\n]/)[0].trim()})`;
  }
  return null;
};

const packageName = (specifier) => {
  const [first, second] = specifier.split('/');
  const isScoped = first.startsWith('@');
  if (!isScoped) return first;
  const isValidScope = first.length > 1 && Boolean(second);
  return isValidScope ? `${first}/${second}` : null;
};

const readDeclared = (root) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
    return new Set([pkg.name, ...Object.keys(deps)].filter(Boolean));
  } catch {
    return new Set();
  }
};

const isInstalled = (root, name) => {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const hasEntry = Boolean(fs.lstatSync(path.join(dir, 'node_modules', name), { throwIfNoEntry: false }));
    if (hasEntry) return true;
    if (dir === path.dirname(dir)) return false;
  }
};

// Returns isExternal(specifier): true for builtins, URL-like ids (node:, virtual:) and packages
// that are installed or declared. Templates are left to findComputedLoad.
export const externalSpecifierCheck = (root) => {
  const declared = readDeclared(root);
  const cache = new Map();
  return (specifier) => {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
    const isNotAnImport = isRelative || specifier.includes(OPEN_EXPR) || /^[\w.+-]+:/.test(specifier);
    if (isNotAnImport) return true;
    const name = packageName(specifier);
    if (!name) return false;
    if (!cache.has(name)) cache.set(name, BUILTINS.has(name) || declared.has(name) || isInstalled(root, name));
    return cache.get(name);
  };
};

// file -> why it may load any file: its first computed load, or its first import specifier that
// is not external and was not resolved. With a fresh index (index != null) the index is the
// authority for static imports of the files it covers; the text scan adds import()/require()
// literals and every import of files the index does not cover.
export const findOpenFiles = ({ root, texts, bare, index, indexNote }) => {
  const open = new Map();
  for (const [file, text] of texts) {
    const load = findComputedLoad(text);
    if (load) open.set(file, `loads modules by a computed path: ${load}`);
  }
  const isExternal = externalSpecifierCheck(root);
  const unresolvedBy = index ? 'not resolved by the index' : `static scan only: ${indexNote}`;
  const mark = (file, specifier) => {
    const isOpen = open.has(file) || !looksLikeModuleId(specifier) || isExternal(specifier);
    if (!isOpen) open.set(file, `cannot resolve '${specifier}' (${unresolvedBy})`);
  };
  for (const entry of index?.unresolved || []) if (texts.has(entry.file)) mark(entry.file, entry.specifier);
  for (const { file, specifier, isCall, at } of bare) {
    const isIndexAuthority = Boolean(index) && index.indexed.has(file) && !isCall;
    const isSkipped = isIndexAuthority || index?.resolved.has(`${file}\0${specifier}`) || isProseAt(texts.get(file), at);
    if (!isSkipped) mark(file, specifier);
  }
  return open;
};
