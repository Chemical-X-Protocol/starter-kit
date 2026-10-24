// Source file discovery for the AST index.
// Generated and vendored dirs are skipped at any depth. Names that are also legitimate
// source folders (build, blueprints, scratch, out, temp, benchmarks) are skipped only at
// the project root, so src/components/blueprints or cli/build stay indexed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isSourceFile } from './languages.js';
import { debugNote } from './search-debug.js';
import { listGitFiles } from './git-file-listing.js';
import { findAndLoadConfigFile } from './config/loader.js';

export const ANY_DEPTH_IGNORED_DIRS = new Set([
  'node_modules', '.git', 'vendor', 'dist', 'coverage',
  '.chemx', '.claude', '.cursor', '.gemini', '.agents',
  '.next', '.turbo', '.output', '.nuxt', '.cache', '.svelte-kit',
  '.pnpm-store', '.yarn'
]);

export const ROOT_ONLY_IGNORED_DIRS = new Set([
  'build', 'out', 'temp', 'tmp', 'scratch', 'benchmarks', 'blueprints'
]);

const toPosix = (p) => p.split(path.sep).join('/');

export const isIgnoredDir = (name, parentRelPath) => {
  const isAnyDepthIgnored = ANY_DEPTH_IGNORED_DIRS.has(name);
  if (isAnyDepthIgnored) return true;
  const isAtProjectRoot = parentRelPath === '' || parentRelPath === '.';
  return isAtProjectRoot && ROOT_ONLY_IGNORED_DIRS.has(name);
};

const walk = (dir, root, fileList) => {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    fileList.unreadable.push({ path: toPosix(path.relative(root, dir)), reason: err?.code || 'unreadable' });
    debugNote.warn(`unreadable dir ${dir}`, err);
    return;
  }
  const parentRel = toPosix(path.relative(root, dir));
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const isDir = entry.isDirectory();
    if (isDir) {
      const isSkipped = isIgnoredDir(entry.name, parentRel);
      if (!isSkipped) walk(fullPath, root, fileList);
      continue;
    }
    const isIndexable = entry.isFile() && isSourceFile(entry.name);
    if (isIndexable) fileList.files.push({ fullPath, relPath: toPosix(path.relative(root, fullPath)) });
  }
};

// status 0: ignored; anything else (not ignored, no git, not a repo): treated as not ignored.
const isDirGitIgnored = (root, dir) => spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', dir], { stdio: 'ignore' }).status === 0;

// scopeDirs are root-relative posix dirs ('.' for the whole project). An explicitly requested
// dir is always walked, even when its own name is on the ignore list. Dirs that do not exist
// are listed in `missing` so callers can refuse to answer for them.
export const scanScope = (root, scopeDirs) => {
  const fileList = { files: [], unreadable: [], missing: [] };
  const seen = new Set();
  for (const scopeDir of scopeDirs) {
    const abs = path.resolve(root, scopeDir);
    const isMissing = !fs.existsSync(abs);
    if (isMissing) {
      fileList.missing.push(scopeDir);
      continue;
    }
    const isFileTarget = fs.statSync(abs).isFile();
    if (isFileTarget) {
      fileList.files.push({ fullPath: abs, relPath: toPosix(path.relative(root, abs)) });
      continue;
    }
    walk(abs, root, fileList);
  }
  const gitFiles = listGitFiles(root);
  const gitFilesSet = Array.isArray(gitFiles) ? new Set(gitFiles) : null;
  const config = findAndLoadConfigFile(root);
  const userExcludes = Array.isArray(config?.raw?.exclude) ? config.raw.exclude : [];

  const ignoredDirCache = new Map();
  const isTargetIgnored = (dir) => {
    if (!ignoredDirCache.has(dir)) ignoredDirCache.set(dir, isDirGitIgnored(root, dir));
    return ignoredDirCache.get(dir);
  };
  fileList.files = fileList.files.filter((f) => {
    const isDuplicate = seen.has(f.relPath);
    if (isDuplicate) return false;
    seen.add(f.relPath);

    const isExcludedByUser = userExcludes.some((pattern) => path.matchesGlob(f.relPath, pattern));
    if (isExcludedByUser) return false;

    const hasGitFilter = gitFilesSet !== null;
    if (hasGitFilter) {
      // An explicit dir keeps git-ignored files only when that dir is itself wholly ignored.
      const isExplicitTarget = scopeDirs.some((dir) => {
        const isCustomScope = dir !== '.' && dir !== 'src';
        const isUnderDir = f.relPath === dir || f.relPath.startsWith(`${dir}/`);
        return isCustomScope && isUnderDir && isTargetIgnored(dir);
      });
      const isAllowedByGit = gitFilesSet.has(f.relPath);
      const isKept = isAllowedByGit || isExplicitTarget;
      if (!isKept) return false;
    }

    return true;
  });
  return fileList;
};
