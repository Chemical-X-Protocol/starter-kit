// Path and quoting helpers for scoped test runs.
import fs from 'node:fs';
import path from 'node:path';

const SAFE_TOKEN = /^[\w@%+=:,./-]+$/;
const DOUBLE_QUOTE_SAFE = /^[^"$`\\!]*$/;

// Quotes a filter for `sh -c`: double quotes when that is safe, otherwise single quotes
// with embedded ' escaped, so a test name can never inject shell syntax.
export const quoteFilter = (value) => {
  const text = String(value);
  const isDoubleQuoteSafe = DOUBLE_QUOTE_SAFE.test(text);
  if (isDoubleQuoteSafe) return `"${text}"`;
  return `'${text.replace(/'/g, `'\\''`)}'`;
};

// Quotes a path argument: plain paths stay bare, anything else goes through quoteFilter.
export const shellQuote = (value) => {
  const text = String(value);
  return SAFE_TOKEN.test(text) ? text : quoteFilter(text);
};

// Walks up from an existing target to the nearest directory below `root` that declares its own
// test runner (`ownsRun`). A bare package.json is not enough: a package with no runner of its own
// is tested by the root runner. Returns null for targets that are not paths on disk.
const findOwnerOf = (root, target, ownsRun) => {
  const absolute = path.resolve(root, target);
  const exists = fs.existsSync(absolute);
  if (!exists) return null;
  let dir = fs.statSync(absolute).isDirectory() ? absolute : path.dirname(absolute);
  while (dir.startsWith(root + path.sep)) {
    const isRunOwner = Boolean(ownsRun(dir));
    if (isRunOwner) return dir;
    dir = path.dirname(dir);
  }
  return root;
};

// When every path target lives in the same runner-owning sub-package, the run moves there and
// targets are rewritten relative to it, so that package's own runner and config apply.
export const findOwningPackageDir = (cwd, targets = [], ownsRun = () => false) => {
  const root = path.resolve(cwd);
  const owners = targets.map((target) => findOwnerOf(root, target, ownsRun));
  const pathOwners = owners.filter(Boolean);
  const sharedOwner = pathOwners.length === targets.length && pathOwners.length > 0 && pathOwners.every((dir) => dir === pathOwners[0])
    ? pathOwners[0]
    : root;
  const isSubPackage = sharedOwner !== root;
  if (!isSubPackage) return { dir: root, targets };
  return { dir: sharedOwner, targets: targets.map((t) => path.relative(sharedOwner, path.resolve(root, t))) };
};
