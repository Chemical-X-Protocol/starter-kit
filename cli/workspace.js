// Workspace (monorepo) model: the packages a pnpm-workspace.yaml or package.json `workspaces`
// declares, which package owns a path, and which packages depend on which. Commands use it to
// run per owning package instead of over the whole monorepo.
import fs from 'node:fs';
import path from 'node:path';

const toPosix = (p) => p.split(path.sep).join('/');
const unquote = (text) => text.trim().replace(/^(['"])(.*)\1$/, '$2');

const readJson = (file) => {
  try {
    return [JSON.parse(fs.readFileSync(file, 'utf8')), null];
  } catch (error) {
    return [null, error];
  }
};

// The `packages:` list of pnpm-workspace.yaml (block or inline form); other keys are ignored.
const parsePnpmPackages = (text) => {
  const globs = [];
  let isInPackages = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    const header = line.match(/^packages\s*:\s*(.*)$/);
    if (header) {
      const inline = header[1].match(/^\[(.*)\]$/);
      if (inline) globs.push(...inline[1].split(',').map(unquote).filter(Boolean));
      isInPackages = !inline;
      continue;
    }
    const item = isInPackages ? line.match(/^\s+-\s*(.+?)\s*$/) : null;
    if (item) globs.push(unquote(item[1]));
    else if (/^\S/.test(line)) isInPackages = false;
  }
  return globs;
};

// Package globs declared by `dir` itself, or null when dir is not a workspace root.
export const readWorkspaceGlobs = (dir) => {
  const pnpmFile = path.join(dir, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmFile)) return parsePnpmPackages(fs.readFileSync(pnpmFile, 'utf8'));
  const [pkg] = readJson(path.join(dir, 'package.json'));
  const workspaces = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  return Array.isArray(workspaces) ? workspaces.map(String) : null;
};

const SKIPPED_DIRS = new Set(['node_modules', '.git', '.chemx', '.claude']);

const childDirs = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !SKIPPED_DIRS.has(entry.name))
  .map((entry) => path.join(dir, entry.name));

const descendantDirs = (dir, depth = 0) => (depth > 6 ? [dir] : [dir, ...childDirs(dir).flatMap((child) => descendantDirs(child, depth + 1))]);

// Expands one positive glob to directories, segment by segment ('*' one level, '**' any depth).
const expandGlob = (root, glob) => {
  let dirs = [root];
  for (const segment of glob.replace(/\/+$/, '').split('/').filter((s) => s && s !== '.')) {
    const isWild = /[*?[{]/.test(segment);
    const next = [];
    for (const dir of dirs) {
      if (!isWild) {
        next.push(path.join(dir, segment));
        continue;
      }
      if (segment === '**') {
        next.push(...descendantDirs(dir));
        continue;
      }
      for (const child of childDirs(dir)) if (path.matchesGlob(path.basename(child), segment)) next.push(child);
    }
    dirs = next.filter((d) => fs.existsSync(d));
  }
  return dirs;
};

// [{ name, dir (absolute), rel (posix, root-relative), pkg }] sorted by rel. Empty when root
// is not a workspace root.
export const listWorkspacePackages = (root, globs = readWorkspaceGlobs(root)) => {
  if (!globs) return [];
  const negated = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
  const found = new Map();
  for (const glob of globs.filter((g) => !g.startsWith('!'))) {
    for (const dir of expandGlob(root, glob)) {
      const rel = toPosix(path.relative(root, dir));
      const isNegated = negated.some((pattern) => path.matchesGlob(rel, pattern.replace(/\/+$/, '')));
      const [pkg] = readJson(path.join(dir, 'package.json'));
      const isPackage = Boolean(pkg) && rel !== '' && !isNegated;
      if (isPackage) found.set(rel, { name: pkg.name || rel, dir, rel, pkg });
    }
  }
  return [...found.values()].sort((a, b) => a.rel.localeCompare(b.rel));
};

// The deepest package containing absPath, or null (the path belongs to the root itself).
export const owningPackage = (packages, absPath) => {
  const target = path.resolve(absPath);
  const owners = packages.filter((p) => target === p.dir || target.startsWith(p.dir + path.sep));
  return owners.sort((a, b) => b.dir.length - a.dir.length)[0] || null;
};

// Packages that (transitively) depend on any of `changedNames`, excluding those names.
export const workspaceDependents = (packages, changedNames) => {
  const result = new Map();
  let frontier = new Set(changedNames);
  while (frontier.size > 0) {
    const next = new Set();
    for (const pkg of packages) {
      const deps = { ...pkg.pkg.dependencies, ...pkg.pkg.devDependencies, ...pkg.pkg.peerDependencies };
      const via = Object.keys(deps).find((name) => frontier.has(name));
      const isNew = Boolean(via) && !changedNames.includes(pkg.name) && !result.has(pkg.name);
      if (isNew) {
        result.set(pkg.name, { package: pkg.name, dir: pkg.rel, via });
        next.add(pkg.name);
      }
    }
    frontier = next;
  }
  return [...result.values()];
};

const memberCache = new Map();

// True when `dir` is a package of a workspace declared by one of its ancestors. Such a package
// keeps its own .chemx index instead of sharing the monorepo root's.
export const isWorkspacePackageDir = (dir) => {
  const key = path.resolve(dir);
  if (memberCache.has(key)) return memberCache.get(key);
  let isMember = false;
  const hasManifest = fs.existsSync(path.join(key, 'package.json'));
  for (let current = path.dirname(key); hasManifest && current !== path.dirname(current); current = path.dirname(current)) {
    const globs = readWorkspaceGlobs(current);
    if (!globs) continue;
    const rel = toPosix(path.relative(current, key));
    const matches = (pattern) => path.matchesGlob(rel, pattern.replace(/\/+$/, ''));
    isMember = globs.some((g) => !g.startsWith('!') && matches(g)) && !globs.some((g) => g.startsWith('!') && matches(g.slice(1)));
    break;
  }
  memberCache.set(key, isMember);
  return isMember;
};
