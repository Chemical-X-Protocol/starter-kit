/**
 * Import alias resolution for the index and blast radius (finding
 * blast-radius-recall-vue): tsconfig/jsconfig `compilerOptions.paths` (following
 * relative `extends`), `.chemxrc` `aliases`, and the conventional `@/` -> `src/`.
 */
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILES = ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json'];
const MAX_EXTENDS_DEPTH = 4;
const cache = new Map();

/** Removes // and /* *\/ comments outside strings, then trailing commas. */
const stripJsonc = (raw) => {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    const pair = raw.slice(i, i + 2);
    if (ch === '"') {
      const end = raw.indexOf('"', i + 1);
      let close = end;
      while (close > 0 && raw[close - 1] === '\\') close = raw.indexOf('"', close + 1);
      const stop = close === -1 ? raw.length : close + 1;
      out += raw.slice(i, stop);
      i = stop;
    } else if (pair === '//') {
      const nl = raw.indexOf('\n', i);
      i = nl === -1 ? raw.length : nl;
    } else if (pair === '/*') {
      const end = raw.indexOf('*/', i + 2);
      i = end === -1 ? raw.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
};

const readJsonc = (file) => {
  try {
    return JSON.parse(stripJsonc(fs.readFileSync(file, 'utf-8')));
  } catch {
    return null;
  }
};

const collectTsPaths = (configFile, depth = 0) => {
  const json = readJsonc(configFile);
  if (!json) return [];
  const dir = path.dirname(configFile);
  const isRelativeExtends = typeof json.extends === 'string' && json.extends.startsWith('.');
  const canFollow = isRelativeExtends && depth < MAX_EXTENDS_DEPTH;
  const inherited = canFollow ? collectTsPaths(path.resolve(dir, json.extends), depth + 1) : [];
  const options = json.compilerOptions || {};
  const baseDir = path.resolve(dir, options.baseUrl || '.');
  const own = Object.entries(options.paths || {}).map(([pattern, targets]) => ({
    pattern,
    target: path.resolve(baseDir, String((Array.isArray(targets) ? targets[0] : targets) || ''))
  }));
  return [...own, ...inherited];
};

const readChemxAliases = (cwd) => {
  const rc = readJsonc(path.join(cwd, '.chemxrc')) || {};
  return Object.entries(rc.aliases || {}).map(([prefix, target]) => ({
    pattern: prefix.endsWith('/*') ? prefix : `${prefix}/*`,
    target: path.resolve(cwd, String(target), '*')
  }));
};

/** Ordered alias list for a project root: [{ prefix, targetDir, isExact }]. */
export const loadAliasMap = (cwd) => {
  const cached = cache.get(cwd);
  if (cached) return cached;
  const configFile = CONFIG_FILES.map((name) => path.join(cwd, name)).find((file) => fs.existsSync(file));
  const raw = [...readChemxAliases(cwd), ...(configFile ? collectTsPaths(configFile) : []), { pattern: '@/*', target: path.join(cwd, 'src', '*') }];
  const aliases = raw.map(({ pattern, target }) => {
    const isWildcard = pattern.endsWith('/*');
    return {
      prefix: isWildcard ? pattern.slice(0, -1) : pattern,
      targetDir: isWildcard ? target.replace(/[\\/]\*$/, '') : target,
      isExact: !isWildcard
    };
  }).sort((a, b) => b.prefix.length - a.prefix.length);
  cache.set(cwd, aliases);
  return aliases;
};

/** Absolute base path for an aliased specifier, or null when no alias matches. */
export const resolveAliasBase = (sourceModule, cwd) => {
  for (const alias of loadAliasMap(cwd)) {
    const isExactMatch = alias.isExact && sourceModule === alias.prefix;
    if (isExactMatch) return alias.targetDir;
    const isPrefixMatch = !alias.isExact && sourceModule.startsWith(alias.prefix);
    if (isPrefixMatch) return path.join(alias.targetDir, sourceModule.slice(alias.prefix.length));
  }
  return null;
};

export const clearAliasCache = () => cache.clear();
