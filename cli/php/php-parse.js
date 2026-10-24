// Lazy PHP parser for the audit (design spec 3.2). Loads php-parser on first use,
// keeps one Engine, caches trees by content hash in a size-capped LRU.
// Guarantees: parsePhp never throws. Columns are php-parser's own (0-based).
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);

/** Newest PHP version php-parser 3.7.0 accepts; analysis always parses at it. */
export const PHP_PARSE_VERSION = '8.5';

const MINIFIED_MIN_BYTES = 64 * 1024;
const MINIFIED_MEAN_LINE = 200;
const CACHE_MAX_BYTES = 2 * 1024 * 1024;
const CACHE_MAX_FILE_BYTES = 1024 * 1024;

let engines = null;
const cache = new Map(); // hash -> { size, result }; Map order = LRU order
let cacheBytes = 0;

const defaultLoader = () => require('php-parser');
let loader = defaultLoader;

/** Test seam: replaces how the module is resolved. Pass null to restore. */
export function setPhpParserLoader(fn) {
  loader = fn || defaultLoader;
  engines = null;
}

export function isPhpPath(path) {
  return typeof path === 'string' && /\.php$/i.test(path);
}

function getEngines() {
  if (engines) return engines;
  let mod;
  try {
    mod = loader();
  } catch {
    return null; // not memoized: a later install is picked up
  }
  const Engine = mod && (mod.Engine || (mod.default && mod.default.Engine));
  const hasEngine = typeof Engine === 'function';
  if (!hasEngine) return null;
  const make = (suppressErrors) =>
    new Engine({
      parser: { extractDoc: true, suppressErrors, version: PHP_PARSE_VERSION },
      ast: { withPositions: true },
    });
  engines = { strict: make(false), lenient: make(true) };
  return engines;
}

export function isMinified(content) {
  const isSmall = content.length <= MINIFIED_MIN_BYTES;
  const lineCount = isSmall ? 1 : content.split('\n').length;
  const hasLongLines = content.length / lineCount > MINIFIED_MEAN_LINE;
  return !isSmall && hasLongLines;
}

function toError(err) {
  const raw = String((err && err.message) || err);
  return {
    line: Number((err && err.lineNumber) || 1),
    column: Number((err && err.columnNumber) || 0),
    message: raw.replace(/\s+on line \d+\s*$/, ''),
  };
}

function cacheGet(key) {
  const hit = cache.get(key);
  const missed = !hit;
  if (missed) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit.result;
}

function cachePut(key, size, result) {
  const tooBigToCache = size > CACHE_MAX_FILE_BYTES;
  if (tooBigToCache) return;
  cache.set(key, { size, result });
  cacheBytes += size;
  for (const [k, v] of cache) {
    const withinBudget = cacheBytes <= CACHE_MAX_BYTES;
    if (withinBudget) break;
    cache.delete(k);
    cacheBytes -= v.size;
  }
}

export function clearPhpParseCache() {
  cache.clear();
  cacheBytes = 0;
}

/**
 * @returns {{ast, comments} | {error:{line,column,message}} | {unavailable:true} | {skipped:'minified'}}
 */
export function parsePhp(content, { filePath = 'file.php', suppressErrors = false } = {}) {
  const text = typeof content === 'string' ? content : String(content ?? '');
  const minified = isMinified(text);
  if (minified) return { skipped: 'minified' };
  const key = `${suppressErrors ? 'l' : 's'}:${createHash('sha1').update(text).digest('hex')}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const eng = getEngines();
  const missing = !eng;
  if (missing) return { unavailable: true };
  let result;
  try {
    const ast = (suppressErrors ? eng.lenient : eng.strict).parseCode(text, filePath);
    result = { ast, comments: ast.comments || [] };
  } catch (err) {
    result = { error: toError(err) };
  }
  cachePut(key, text.length, result);
  return result;
}
