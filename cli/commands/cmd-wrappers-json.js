// cx p (package.json inspector) and cx j (JSON peeker). Missing files and keys are failures.
import fs from 'node:fs';
import path from 'node:path';
import { emitWrapperResult } from './cmd-wrappers-git.js';

const VERBATIM_JSON_BYTES = 2048;
const MAX_FIELDS = 15;
const MAX_SCALAR_CHARS = 60;
const MAX_INLINE_ARRAY = 5;

const fail = (error, isCli) => emitWrapperResult({ output: '', code: 1, error }, isCli);

const readJson = (fullPath) => {
  const raw = fs.readFileSync(fullPath, 'utf-8');
  return { raw, parsed: JSON.parse(raw) };
};

// An empty section is said out loud, never printed as nothing.
const listOrNone = (lines, what) => (lines.length > 0 ? lines.join('') : `(no ${what} in package.json)\n`);

const formatPkgQuery = (pkg, query) => {
  const scripts = pkg.scripts || {};
  const deps = pkg.dependencies || {};
  const devDeps = pkg.devDependencies || {};
  if (!query) {
    const scriptKeys = Object.keys(scripts);
    const scriptLine = scriptKeys.length ? `Scripts (${scriptKeys.length}): ${scriptKeys.join(', ')}\n` : '';
    return `Package: ${pkg.name || 'unnamed'}@${pkg.version || '0.0.0'}\n${scriptLine}`;
  }
  if (query === '-s' || query === '--scripts') return listOrNone(Object.entries(scripts).map(([k, v]) => `${k}: ${v}\n`), 'scripts');
  if (query === '-d' || query === '--deps') {
    return listOrNone([...Object.entries(deps).map(([k, v]) => `${k}: ${v}\n`), ...Object.entries(devDeps).map(([k, v]) => `[dev] ${k}: ${v}\n`)], 'dependencies');
  }
  if (Object.hasOwn(scripts, query)) return `${query}: ${scripts[query]}\n`;
  const version = deps[query] || devDeps[query];
  return version ? `${query}: ${version}\n` : null;
};

export const runPkg = async (rawArgs = [], isCli = true, cwd = process.cwd()) => {
  const query = rawArgs.filter((a) => a !== 'p' && a !== 'pkg')[0];
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return fail(`No package.json found in ${cwd}.`, isCli);
  let pkg;
  try {
    pkg = readJson(pkgPath).parsed;
  } catch (err) {
    return fail(`Invalid package.json: ${err.message}`, isCli);
  }
  const output = formatPkgQuery(pkg, query);
  if (output === null) return fail(`Key "${query}" not found in scripts or dependencies of ${pkgPath}.`, isCli);
  return emitWrapperResult({ output, code: 0 }, isCli);
};

const formatScalar = (value) => {
  const text = JSON.stringify(value);
  return text.length > MAX_SCALAR_CHARS ? `${text.slice(0, MAX_SCALAR_CHARS)}..." (${String(value).length} chars)` : text;
};

const isScalar = (value) => value === null || typeof value !== 'object';

// Shape with values: scalars keep their value, containers are summarised past depth 2.
export const describeJson = (value, depth = 0) => {
  if (isScalar(value)) return formatScalar(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const isShortScalarList = value.length <= MAX_INLINE_ARRAY && value.every(isScalar);
    if (isShortScalarList) return `[${value.map(formatScalar).join(', ')}]`;
    return `${depth > 2 ? 'array' : `[${describeJson(value[0], depth + 1)}, ...]`} (${value.length} items)`;
  }
  if (depth > 2) return `{ ... ${Object.keys(value).length} keys }`;
  const indent = '  '.repeat(depth + 1);
  const keys = Object.keys(value);
  const fields = keys.slice(0, MAX_FIELDS).map((k) => `${indent}${k}: ${describeJson(value[k], depth + 1)}`);
  const extra = keys.length > MAX_FIELDS ? [`${indent}... ${keys.length - MAX_FIELDS} more fields`] : [];
  return `{\n${[...fields, ...extra].join(',\n')}\n${'  '.repeat(depth)}}`;
};

export const runJsonShape = async (rawArgs = [], isCli = true, cwd = process.cwd()) => {
  const targetFile = rawArgs.filter((a) => a !== 'j' && a !== 'json')[0];
  if (!targetFile) return fail('Usage: cx j <path-to-json-file>', isCli);
  const fullPath = path.resolve(cwd, targetFile);
  if (!fs.existsSync(fullPath)) return fail(`File not found: ${fullPath}`, isCli);
  let json;
  try {
    json = readJson(fullPath);
  } catch (err) {
    return fail(`Invalid JSON in ${targetFile}: ${err.message}`, isCli);
  }
  const header = `// JSON: ${path.relative(cwd, fullPath)} (${json.raw.length} bytes, ~${Math.round(json.raw.length / 4)} tokens raw)`;
  const isSmall = json.raw.length <= VERBATIM_JSON_BYTES;
  const body = isSmall ? json.raw.trimEnd() : describeJson(json.parsed);
  return emitWrapperResult({ output: `${header}${isSmall ? ' verbatim' : ' shape with values'}\n${body}\n`, code: 0 }, isCli);
};
