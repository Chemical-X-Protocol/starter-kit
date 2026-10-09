// Import specifier -> root-relative module path. Relative specifiers, configured aliases
// (tsconfig/jsconfig paths, .chemxrc aliases, the conventional '@/' -> src/) and template
// component specifiers resolve; bare package imports stay '' so graph queries never match them by name.
import fs from 'node:fs';
import path from 'node:path';
import { resolveAliasBase } from './sfc/module-aliases.js';
import { isComponentSpecifier, resolveComponentSpecifier } from './sfc/component-resolver.js';

const FILE_EXTENSIONS = ['', '.ts', '.js', '.vue', '.tsx', '.jsx', '.d.ts', '.mjs', '.cjs', '.mts', '.cts'];
const INDEX_EXTENSIONS = ['.ts', '.js', '.vue', '.tsx', '.jsx', '.d.ts', '.mjs'];

const toPosix = (p) => p.split(path.sep).join('/');

const isExistingFile = (candidate) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

export const resolveModulePath = (importerPath, sourceModule, root = process.cwd()) => {
  const isUsableSpecifier = Boolean(sourceModule) && typeof sourceModule === 'string';
  if (!isUsableSpecifier) return '';
  if (isComponentSpecifier(sourceModule)) return resolveComponentSpecifier(sourceModule, root, importerPath);
  const isRelative = sourceModule.startsWith('.') || sourceModule.startsWith('/');
  const aliasBase = isRelative ? null : resolveAliasBase(sourceModule, root);
  const isResolvable = isRelative || Boolean(aliasBase);
  if (!isResolvable) return '';

  const basePath = aliasBase || path.resolve(root, path.dirname(importerPath), sourceModule);

  const directHit = FILE_EXTENSIONS.map((ext) => basePath + ext).find(isExistingFile);
  if (directHit) return toPosix(path.relative(root, directHit));

  const indexHit = INDEX_EXTENSIONS.map((ext) => path.join(basePath, `index${ext}`)).find(isExistingFile);
  if (indexHit) return toPosix(path.relative(root, indexHit));

  // Not on disk (virtual or deleted module): keep the normalised specifier path, extensionless.
  return toPosix(path.relative(root, basePath));
};

// Every resolved_path value that denotes `filePath`: itself, itself without extension, and
// its directory when it is an index module. Used to match unresolved (extensionless) rows exactly.
export const moduleKeysFor = (filePath) => {
  const keys = new Set([filePath]);
  const withoutExt = filePath.replace(/\.(d\.ts|[cm]?[jt]sx?|vue|svelte)$/, '');
  keys.add(withoutExt);
  const isIndexModule = path.posix.basename(withoutExt) === 'index';
  if (isIndexModule) keys.add(path.posix.dirname(withoutExt));
  return Array.from(keys);
};
