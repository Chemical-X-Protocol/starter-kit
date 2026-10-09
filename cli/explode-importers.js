/**
 * Project-level guards for explode. Turning `x.ts` into `x/` keeps importers resolving only
 * when they use extensionless specifiers and a TypeScript-aware resolver (the barrel is
 * `x/index.ts`). explode refuses rather than leave importers broken:
 *   - .mjs/.cjs sources (explicit module formats always import with extensions);
 *   - .js/.jsx sources without a tsconfig.json above them (the capsule is TypeScript);
 *   - .js sources in a "type": "module" package (Node ESM needs explicit extensions);
 *   - any project file importing the target with an explicit extension (`./x.js`, `./x.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.chemx', '.claude', '.next', '.nuxt', '.turbo', '.output', '.cache']);
const SOURCE_FILE_REGEX = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const SPECIFIER_REGEX = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+|\bmock\s*\(\s*)(["'])(\.{1,2}\/[^"'\n]+)\1/g;
const MAX_SCANNED_FILES = 20000;

const findUp = (startDir, name) => {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, name);
    const isFound = fs.existsSync(candidate);
    if (isFound) return candidate;
    const parent = path.dirname(dir);
    const isRoot = parent === dir;
    if (isRoot) return null;
    dir = parent;
  }
};

const isModulePackage = (dir) => {
  const pkg = findUp(dir, 'package.json');
  if (!pkg) return false;
  try {
    return JSON.parse(fs.readFileSync(pkg, 'utf-8')).type === 'module';
  } catch {
    return false;
  }
};

const sourceFiles = (root) => {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const isDir = entry.isDirectory() && !SKIPPED_DIRS.has(entry.name);
      if (isDir) stack.push(path.join(dir, entry.name));
      const isSource = entry.isFile() && SOURCE_FILE_REGEX.test(entry.name);
      if (isSource) files.push(path.join(dir, entry.name));
    }
    const isTooMany = files.length > MAX_SCANNED_FILES;
    if (isTooMany) throw new Error(`Explode refused: more than ${MAX_SCANNED_FILES} source files to check for importers. Nothing was changed.`);
  }
  return files;
};

const stripExt = (file) => file.replace(/\.[^./\\]+$/, '');

/**
 * Files that import `absPath` with an explicit extension (including `./x.js` for `x.ts`).
 *
 * @param {string} absPath The file being exploded.
 * @param {string} root Directory to scan.
 * @returns {string[]} `file: 'specifier'` entries, relative to root.
 */
export const explicitExtensionImporters = (absPath, root) => {
  const targetStem = stripExt(absPath);
  const hits = [];
  for (const file of sourceFiles(root).filter((f) => f !== absPath)) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const match of text.matchAll(SPECIFIER_REGEX)) {
      const resolved = path.resolve(path.dirname(file), match[2]);
      const hasExtension = path.extname(match[2]) !== '';
      const isTarget = hasExtension && (resolved === absPath || stripExt(resolved) === targetStem);
      if (isTarget) hits.push(`${path.relative(root, file)}: '${match[2]}'`);
    }
  }
  return hits;
};

/**
 * @param {string} absPath The file being exploded.
 * @param {string} root Workspace root (scan boundary).
 * @throws {Error} When explode would leave an importer or the module format broken.
 */
export const assertImportersSurvive = (absPath, root) => {
  const ext = path.extname(absPath).toLowerCase();
  const dir = path.dirname(absPath);
  const isExplicitFormat = ext === '.mjs' || ext === '.cjs';
  if (isExplicitFormat) throw new Error(`Explode refused: ${ext} modules are imported with explicit extensions, which a directory capsule cannot keep. Nothing was changed.`);
  const isJsSource = ext === '.js' || ext === '.jsx';
  const hasTsconfig = Boolean(findUp(dir, 'tsconfig.json'));
  if (isJsSource && !hasTsconfig) throw new Error(`Explode refused: the capsule is TypeScript (index.ts, types/*.d.ts) but no tsconfig.json covers ${path.basename(absPath)}. Nothing was changed.`);
  const isNodeEsmJs = ext === '.js' && isModulePackage(dir);
  if (isNodeEsmJs) throw new Error('Explode refused: a .js file in a "type": "module" package is imported with an explicit extension, which a directory capsule cannot keep. Nothing was changed.');
  const importers = explicitExtensionImporters(absPath, root);
  const hasExplicitImporters = importers.length > 0;
  if (hasExplicitImporters) throw new Error(`Explode refused: these importers name the file with its extension and would break: ${importers.join('; ')}. Nothing was changed.`);
};
