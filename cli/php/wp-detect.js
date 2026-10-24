import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { walk, callName } from './php-walk.js';

const HEADER_BYTES = 8192;
const PLUGIN_HEADER = /^[ \t/*#@]*Plugin Name:/m;
const THEME_HEADER = /^[ \t/*#@]*Theme Name:/m;
const SEGMENT = /[\\/]wp-content[\\/](plugins|mu-plugins|themes)[\\/]([^\\/]+)(?=[\\/])/;
const SIGNAL_CALLS = new Set(['add_action', 'add_filter', 'register_rest_route']);
const SIGNAL_NAMES = new Set(['ABSPATH', 'WP_REST_Request']);
const NOT_WORDPRESS = { isWordPress: false, root: null, kind: null };
const FORCED_WORDPRESS = { isWordPress: true, root: null, kind: null };
const SEGMENT_KINDS = { plugins: 'plugin', 'mu-plugins': 'plugin', themes: 'theme' };

/** Per-directory cache: dir -> { dirMtime, deps: [[path, mtime]], kind }. */
const dirCache = new Map();

function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

function readHead(fd) {
  const buf = Buffer.alloc(HEADER_BYTES);
  try {
    const n = readSync(fd, buf, 0, HEADER_BYTES, 0);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

function head(path) {
  try {
    return readHead(openSync(path, 'r'));
  } catch {
    return '';
  }
}

function listPhp(dir) {
  try {
    return readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.php'));
  } catch {
    return [];
  }
}

function hasPluginHeader(dir, deps) {
  return listPhp(dir).some((name) => {
    const path = join(dir, name);
    deps.push([path, mtimeOf(path)]);
    return PLUGIN_HEADER.test(head(path));
  });
}

function hasThemeHeader(dir, deps) {
  const path = join(dir, 'style.css');
  const mtime = mtimeOf(path);
  deps.push([path, mtime]);
  return mtime !== -1 && THEME_HEADER.test(head(path));
}

function hasCoreMarker(dir, deps) {
  const markers = [join(dir, 'wp-config.php'), join(dir, 'wp-includes', 'version.php')];
  const stamped = markers.map((path) => [path, mtimeOf(path)]);
  deps.push(...stamped);
  return stamped.some(([, mtime]) => mtime !== -1);
}

function kindOfDirectory(dir, deps) {
  const checks = [
    ['plugin', hasPluginHeader],
    ['theme', hasThemeHeader],
    ['core', hasCoreMarker],
  ];
  const hit = checks.find(([, check]) => check(dir, deps));
  return hit ? hit[0] : null;
}

function scanDirectory(dir) {
  const deps = [];
  const kind = kindOfDirectory(dir, deps);
  return { dirMtime: mtimeOf(dir), deps, kind };
}

function stillFresh(entry, dir) {
  const sameDir = entry.dirMtime === mtimeOf(dir);
  return sameDir && entry.deps.every(([path, mtime]) => mtimeOf(path) === mtime);
}

function directoryKind(dir) {
  const cached = dirCache.get(dir);
  const fresh = Boolean(cached) && stillFresh(cached, dir);
  const entry = fresh ? cached : scanDirectory(dir);
  dirCache.set(dir, entry);
  return entry.kind;
}

function segmentRoot(filePath) {
  const match = SEGMENT.exec(filePath);
  const root = match ? filePath.slice(0, match.index + match[0].length) : null;
  return match ? { root, kind: SEGMENT_KINDS[match[1]] } : null;
}

function isUnder(path, dir) {
  return path === dir || path.startsWith(dir + sep);
}

/** A core marker only counts for files below that directory's wp-content. */
function acceptedHit(dir, kind, filePath) {
  const coreApplies = kind === 'core' && isUnder(filePath, join(dir, 'wp-content'));
  const accepted = kind !== null && (kind !== 'core' || coreApplies);
  return accepted ? { isWordPress: true, root: dir, kind } : null;
}

function hitAt(dir, filePath, segment) {
  const onDisk = acceptedHit(dir, directoryKind(dir), filePath);
  const atSegment = segment && dir === segment.root ? { isWordPress: true, ...segment } : null;
  return onDisk || atSegment;
}

/** The path segment proves WordPress even when scanRoot sits below the segment root. */
function aboveScanRoot(segment, scanRoot) {
  const proven = Boolean(segment) && isUnder(scanRoot, segment.root) && scanRoot !== segment.root;
  return proven ? { isWordPress: true, ...segment } : NOT_WORDPRESS;
}

function walkUp(filePath, scanRoot) {
  const segment = segmentRoot(filePath);
  let dir = dirname(filePath);
  for (;;) {
    const hit = hitAt(dir, filePath, segment);
    const parent = dirname(dir);
    const atTop = dir === scanRoot || parent === dir;
    const settled = Boolean(hit) || atTop;
    if (settled) return hit || aboveScanRoot(segment, scanRoot);
    dir = parent;
  }
}

function isSignalCall(node) {
  const callee = callName(node);
  return Boolean(callee) && callee.kind === 'function' && SIGNAL_CALLS.has(callee.name);
}

const SIGNAL_TESTS = {
  variable: (node) => node.name === 'wpdb',
  name: (node) => SIGNAL_NAMES.has(node.name),
  call: isSignalCall,
};

function nodeSignals(node) {
  const test = SIGNAL_TESTS[node.kind];
  return Boolean(test) && test(node);
}

function hasSignals(ast) {
  let found = false;
  walk(ast, (node) => {
    found = found || nodeSignals(node);
    return !found;
  });
  return found;
}

function detectOffDisk(ast) {
  const signalled = Boolean(ast) && hasSignals(ast);
  return signalled ? { isWordPress: true, root: null, kind: 'signals' } : NOT_WORDPRESS;
}

function detectAuto(filePath, scanRoot, ast) {
  const root = resolve(scanRoot);
  const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  return existsSync(absolute) ? walkUp(absolute, root) : detectOffDisk(ast);
}

/**
 * Decides whether a PHP file belongs to a WordPress project.
 * config.wordpress: true forces yes (root and kind null), false forces no, anything else is 'auto'.
 * Auto looks at files on disk (plugin header, style.css Theme Name, wp-config.php, a wp-content
 * path segment) between the file and scanRoot; only a file that is not on disk falls back to AST
 * signals. Not guaranteed: a plugin without a header outside wp-content is not detected.
 */
export function detectWordPress(filePath, { scanRoot = process.cwd(), config = null, ast = null } = {}) {
  const setting = config ? config.wordpress : undefined;
  const forced = { true: FORCED_WORDPRESS, false: NOT_WORDPRESS }[String(setting)];
  return forced || detectAuto(filePath, scanRoot, ast);
}

/** Clears the per-directory cache (tests). */
export function resetWordPressCache() {
  dirCache.clear();
}
