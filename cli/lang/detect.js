/**
 * Language detection (design spec 4.3). languageForPath tries, in order: the exact extension
 * (lowercase), the exact basename, path globs (the config map, then record `files.paths`), the
 * shebang of an extensionless file, then content markers and the project tie-break for an
 * ambiguous extension. An extension nothing settles is no language with reason
 * `ambiguous-extension`. Content is the first 8 KB: `options.content`, or read under `options.root`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getLanguage, languageTable } from './registry.js';
import { compileGlob } from './static-table.js';

const HEAD_BYTES = 8192;
const markerCache = new Map();

const found = (id, via, candidates) => ({ id, record: getLanguage(id), via, reason: null, candidates });
const notFound = (reason, candidates = []) => ({ id: null, record: null, via: null, reason, candidates });

const toPosix = (relPath) => relPath.replace(/\\/g, '/').replace(/^\.\//, '');

const markerRe = (source) => {
  const cached = markerCache.get(source) ?? new RegExp(source, 'm');
  markerCache.set(source, cached);
  return cached;
};

const readHead = (root, rel) => {
  let fd = null;
  try {
    fd = fs.openSync(path.join(root, rel), 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const bytes = fs.readSync(fd, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytes).toString('utf-8');
  } catch {
    return null;
  } finally {
    const isOpen = fd !== null;
    if (isOpen) fs.closeSync(fd);
  }
};

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

/** The file's directory, then each parent up to and including the root. */
const ancestorDirs = (dir, root) => {
  const dirs = [dir];
  let at = dir;
  const isInsideRoot = dir === root || dir.startsWith(root + path.sep);
  while (isInsideRoot && at !== root && path.dirname(at) !== at) {
    at = path.dirname(at);
    dirs.push(at);
  }
  return dirs;
};

/** Per-call facts, read lazily: the file head and the directory listings the tie-break needs. */
const createContext = (rel, options) => {
  const root = options.root ? path.resolve(options.root) : null;
  const abs = root ? path.join(root, rel) : null;
  let head;
  const readContent = () => {
    const hasContent = typeof options.content === 'string';
    if (hasContent) return options.content.slice(0, HEAD_BYTES);
    return root ? readHead(root, rel) : null;
  };
  return {
    rel, root, abs, base: path.posix.basename(rel),
    head: () => {
      const isUnread = head === undefined;
      if (isUnread) head = readContent();
      return head;
    }
  };
};

const mappedLanguage = (rel, map = {}) => {
  const hit = Object.entries(map).find(([glob, id]) => getLanguage(id) && compileGlob(glob).test(rel));
  return hit ? hit[1] : null;
};

const pathLanguage = (rel, options) => mappedLanguage(rel, options.map)
  ?? languageTable().paths.find((entry) => entry.re.test(rel))?.id
  ?? null;

/** The interpreter named by a `#!` line, with `/usr/bin/env` and its flags unwrapped. */
const shebangName = (head) => {
  const hasShebang = typeof head === 'string' && head.startsWith('#!');
  if (!hasShebang) return null;
  const words = head.slice(2).split('\n', 1)[0].trim().split(/\s+/).filter(Boolean);
  const isEnv = path.posix.basename(words[0] ?? '') === 'env';
  const command = isEnv ? words.slice(1).find((w) => !w.startsWith('-') && !w.includes('=')) : words[0];
  return command ? path.posix.basename(command) : null;
};

const shebangLanguages = (name) => {
  const { shebangs } = languageTable();
  return shebangs.get(name) ?? shebangs.get(name.replace(/[\d.]+$/, '')) ?? [];
};

const scoreMarkers = (rule, head) => rule.markers
  .filter((marker) => markerRe(marker.re).test(head))
  .reduce((sum, marker) => sum + marker.weight, 0);

/** The one candidate whose markers reach minScore with the highest score, or null on a tie or no match. */
const byContent = (ext, ids, head) => {
  const scored = ids
    .map((id) => ({ id, rule: getLanguage(id).files.ambiguous?.[ext] }))
    .filter(({ rule }) => rule)
    .map(({ id, rule }) => ({ id, score: scoreMarkers(rule, head), minScore: rule.minScore }))
    .filter(({ score, minScore }) => score >= minScore);
  const top = Math.max(...scored.map((s) => s.score));
  const leaders = scored.filter((s) => s.score === top);
  return leaders.length === 1 ? leaders[0].id : null;
};

const holds = (when, ctx) => {
  const dir = path.dirname(ctx.abs);
  const sibling = when.sibling ? compileGlob(when.sibling) : null;
  const ancestor = when.ancestor ? compileGlob(when.ancestor) : null;
  const hasSibling = !sibling || listDir(dir).some((name) => name !== ctx.base && sibling.test(name));
  const hasAncestor = !ancestor || ancestorDirs(dir, ctx.root).some((d) => listDir(d).some((n) => ancestor.test(n)));
  return hasSibling && hasAncestor;
};

const byTieBreak = (ext, ids, ctx) => {
  const rules = ids.flatMap((id) => getLanguage(id).files.ambiguous?.[ext]?.tieBreak ?? []);
  const hit = ctx.root ? rules.find((rule) => ids.includes(rule.pick) && holds(rule.when, ctx)) : null;
  return hit ? hit.pick : null;
};

const extensionOf = (base) => path.posix.extname(base).toLowerCase();

const isAmbiguousExtension = (ext, ids) => ids.length > 1 || ids.some((id) => getLanguage(id).files.ambiguous?.[ext]);

/**
 * @param {string} relPath path relative to `options.root` (forward or back slashes)
 * @param {{ content?: string, root?: string, map?: Record<string, string> }} [options]
 * @returns {{ id: string|null, record: object|null, via: 'extension'|'filename'|'path'|'shebang'|'content'|'tie-break'|null,
 *   reason: null|'ambiguous-extension'|'unknown', candidates: string[] }}
 */
export const languageForPath = (relPath, options = {}) => {
  const ctx = createContext(toPosix(relPath), options);
  const ext = extensionOf(ctx.base);
  const table = languageTable();
  const ids = ext ? table.byExtension.get(ext) ?? [] : [];
  const isAmbiguous = isAmbiguousExtension(ext, ids);
  const isUniqueExtension = ids.length > 0 && !isAmbiguous;
  if (isUniqueExtension) return found(ids[0], 'extension', ids);
  const named = table.byFilename.get(ctx.base) ?? [];
  const isNamedFile = named.length > 0;
  if (isNamedFile) return found(named[0], 'filename', named);
  const byPath = pathLanguage(ctx.rel, options);
  if (byPath) return found(byPath, 'path', [byPath]);
  const interpreter = ext ? null : shebangName(ctx.head());
  const byShebang = interpreter ? shebangLanguages(interpreter) : [];
  const hasShebangLanguage = byShebang.length > 0;
  if (hasShebangLanguage) return found(byShebang[0], 'shebang', byShebang);
  if (!isAmbiguous) return notFound('unknown');
  const head = ctx.head();
  const contentPick = head === null ? null : byContent(ext, ids, head);
  if (contentPick) return found(contentPick, 'content', ids);
  const tiePick = byTieBreak(ext, ids, ctx);
  return tiePick ? found(tiePick, 'tie-break', ids) : notFound('ambiguous-extension', ids);
};

/**
 * Content-free candidates for the guard (spec 4.3): every claimant of the extension, else the
 * basename's, else the path glob's language. An ambiguous extension yields all of its candidates.
 */
export const languageCandidates = (relPath, options = {}) => {
  const rel = toPosix(relPath);
  const base = path.posix.basename(rel);
  const ext = extensionOf(base);
  const table = languageTable();
  const ids = ext ? table.byExtension.get(ext) ?? [] : [];
  const hasExtensionClaimants = ids.length > 0;
  if (hasExtensionClaimants) return [...ids];
  const named = table.byFilename.get(base) ?? [];
  const isNamedFile = named.length > 0;
  if (isNamedFile) return [...named];
  const byPath = pathLanguage(rel, options);
  return byPath ? [byPath] : [];
};
