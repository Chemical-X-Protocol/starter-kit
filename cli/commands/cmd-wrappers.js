import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.mjs', '.cjs']);
const MAX_DIFF_LINES = 80;
// Output formats that are already summaries: never "compact" them to --stat.
const SUMMARY_FORMAT_FLAGS = new Set(['--stat', '--shortstat', '--numstat', '--dirstat', '--name-only', '--name-status', '--summary', '--compact-summary']);

/**
 * Opportunistically syncs modified files to SQLite index.
 * Strictly bounded: max 5 files, silent error catching. Only runs when the project
 * already has an index, and loads the AST stack lazily, so `chemx d` stays cheap.
 */
const tryMicroSyncModifiedFiles = async (cwd = process.cwd()) => {
  const hasIndexDb = fs.existsSync(path.join(cwd, '.chemx', 'index.db'));
  if (!hasIndexDb) return { synced: 0 };
  try {
    const statusOut = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500
    });
    const lines = statusOut.split('\n').filter(Boolean);
    const modifiedFiles = [];

    for (const line of lines) {
      const filePath = line.slice(3).trim();
      if (!filePath) continue;
      const ext = path.extname(filePath);
      if (SOURCE_EXTENSIONS.has(ext)) {
        modifiedFiles.push(filePath);
      }
    }

    if (modifiedFiles.length > 0 && modifiedFiles.length <= 5) {
      const { syncSingleFileIndex } = await import('../search.js');
      for (const file of modifiedFiles) {
        try {
          syncSingleFileIndex(file, cwd);
        } catch {
          // Micro-sync failure is non-fatal
        }
      }
    }
  } catch {
    // Non-git or execution error is non-fatal
  }
};

/**
 * chemx d / chemx diff: Enforced token-lean git diff.
 * Defaults to -U0 and --no-color. Compresses to --stat if > 80 lines.
 */
export const runDiff = async (rawArgs = [], isCli = true) => {
  const cwd = process.cwd();
  const subArgs = rawArgs.filter((a) => a !== 'd' && a !== 'diff');
  const isFull = subArgs.includes('--full');
  const gitArgs = subArgs.filter((a) => a !== '--full');

  // Trigger opportunistic background micro-sync
  await tryMicroSyncModifiedFiles(cwd);

  try {
    const res = spawnSync('git', ['diff', '-U0', '--no-color', ...gitArgs], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (res.error) {
      if (isCli) process.stderr.write(`git error: ${res.error.message}\n`);
      return { output: '', code: 1 };
    }

    const output = res.stdout || '';
    const lineCount = output.split('\n').length;
    const isSummaryFormat = gitArgs.some((a) => SUMMARY_FORMAT_FLAGS.has(a.split('=')[0]));
    const isCompactionCandidate = !isFull && !isSummaryFormat && lineCount > MAX_DIFF_LINES;

    if (isCompactionCandidate) {
      const statRes = spawnSync('git', ['diff', '--stat', '--no-color', ...gitArgs], {
        cwd,
        encoding: 'utf-8'
      });
      const statOut = (statRes.stdout || '').trim();
      const isStatShorter = statOut.length > 0 && statOut.split('\n').length < lineCount;
      if (isStatShorter) {
        const compacted = `${statOut}\n// [Diff compacted to --stat (${lineCount} lines). Use chemx d --full for uncompressed output]\n`;
        if (isCli) process.stdout.write(compacted);
        return { output: compacted, code: res.status ?? 0, compacted: true };
      }
    }

    if (isCli) process.stdout.write(output);
    return { output, code: res.status ?? 0 };
  } catch (err) {
    if (isCli) process.stderr.write(`Failed to run git diff: ${err.message}\n`);
    return { output: '', code: 1 };
  }
};

/**
 * chemx log: Compact git commit history.
 * Enforces --oneline and caps at limit (default 10).
 */
export const runLog = async (rawArgs = [], isCli = true) => {
  const cwd = process.cwd();
  const subArgs = rawArgs.filter((a) => a !== 'log');
  let limit = 10;

  const filteredArgs = [];
  for (let i = 0; i < subArgs.length; i++) {
    const arg = subArgs[i];
    if (arg === '-n' && subArgs[i + 1]) {
      limit = parseInt(subArgs[i + 1], 10) || 10;
      i++;
    } else if (arg.startsWith('-n')) {
      limit = parseInt(arg.slice(2), 10) || 10;
    } else if (/^\d+$/.test(arg)) {
      limit = parseInt(arg, 10);
    } else {
      filteredArgs.push(arg);
    }
  }

  try {
    const res = spawnSync('git', ['log', '--oneline', `--max-count=${limit}`, '--no-color', ...filteredArgs], {
      cwd,
      encoding: 'utf-8'
    });

    if (res.error) {
      if (isCli) process.stderr.write(`git error: ${res.error.message}\n`);
      return { output: '', code: 1 };
    }

    const output = res.stdout || '';
    if (isCli) process.stdout.write(output);
    return { output, code: res.status ?? 0 };
  } catch (err) {
    if (isCli) process.stderr.write(`Failed to run git log: ${err.message}\n`);
    return { output: '', code: 1 };
  }
};

/**
 * chemx p / chemx pkg: Targeted package.json inspector.
 * Eliminates full file dumps when querying scripts or dependency versions.
 */
export const runPkg = async (rawArgs = [], isCli = true) => {
  const cwd = process.cwd();
  const subArgs = rawArgs.filter((a) => a !== 'p' && a !== 'pkg');
  const pkgPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    const err = 'No package.json found in current directory.\n';
    if (isCli) process.stderr.write(err);
    return { output: '', code: 1 };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (err) {
    const msg = `Invalid package.json: ${err.message}\n`;
    if (isCli) process.stderr.write(msg);
    return { output: '', code: 1 };
  }

  const scripts = pkg.scripts || {};
  const deps = pkg.dependencies || {};
  const devDeps = pkg.devDependencies || {};
  const query = subArgs[0];

  let output = '';

  if (!query) {
    const scriptKeys = Object.keys(scripts);
    output = `Package: ${pkg.name || 'unnamed'}@${pkg.version || '0.0.0'}\n`;
    if (scriptKeys.length) {
      output += `Scripts (${scriptKeys.length}): ${scriptKeys.join(', ')}\n`;
    }
  } else if (query === '-s' || query === '--scripts') {
    output = Object.entries(scripts)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') + '\n';
  } else if (query === '-d' || query === '--deps') {
    const depLines = Object.entries(deps).map(([k, v]) => `${k}: ${v}`);
    const devLines = Object.entries(devDeps).map(([k, v]) => `[dev] ${k}: ${v}`);
    output = [...depLines, ...devLines].join('\n') + '\n';
  } else if (scripts[query]) {
    output = `${query}: ${scripts[query]}\n`;
  } else if (deps[query] || devDeps[query]) {
    output = `${query}: ${deps[query] || devDeps[query]}\n`;
  } else {
    output = `Key "${query}" not found in scripts or dependencies.\n`;
  }

  if (isCli) process.stdout.write(output);
  return { output, code: 0 };
};

/**
 * chemx f / chemx ls: Filtered path finder respecting .gitignore and ignored dirs.
 */
export const runFiles = async (rawArgs = [], isCli = true) => {
  const cwd = process.cwd();
  const subArgs = rawArgs.filter((a) => a !== 'f' && a !== 'ls');
  const filter = subArgs[0] || null;

  try {
    const res = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (res.error || res.status !== 0) {
      // Fallback if not git repository
      const entries = fs.readdirSync(cwd, { withFileTypes: true });
      const files = entries.filter((e) => !e.name.startsWith('.')).map((e) => e.name);
      const out = files.join('\n') + '\n';
      if (isCli) process.stdout.write(out);
      return { output: out, code: 0 };
    }

    let files = res.stdout.split('\n').filter(Boolean);

    if (filter) {
      const lower = filter.toLowerCase();
      files = files.filter((f) => f.toLowerCase().includes(lower));
    }

    const output = files.slice(0, 100).join('\n') + '\n';
    if (files.length > 100) {
      const overflow = `// [${files.length - 100} additional files omitted. Refine filter with chemx f <pattern>]\n`;
      if (isCli) process.stdout.write(output + overflow);
      return { output: output + overflow, code: 0 };
    }

    if (isCli) process.stdout.write(output);
    return { output, code: 0 };
  } catch (err) {
    if (isCli) process.stderr.write(`Failed to list files: ${err.message}\n`);
    return { output: '', code: 1 };
  }
};

const inferJsonType = (value, depth = 0) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]';
    const sample = inferJsonType(value[0], depth + 1);
    return depth > 2 ? `${sample}[]` : `${sample}[] (${value.length} items)`;
  }
  if (typeof value === 'object') {
    if (depth > 2) return '{ ... }';
    const indent = '  '.repeat(depth + 1);
    const closingIndent = '  '.repeat(depth);
    const entries = Object.entries(value).slice(0, 15);
    const fields = entries.map(([k, v]) => `${indent}${k}: ${inferJsonType(v, depth + 1)}`);
    if (Object.keys(value).length > 15) {
      fields.push(`${indent}... ${Object.keys(value).length - 15} more fields`);
    }
    return `{\n${fields.join(',\n')}\n${closingIndent}}`;
  }
  return typeof value;
};

/**
 * chemx j / chemx json: Structural schema peeker for JSON files.
 * Extracts shape without dumping full payload.
 */
export const runJsonShape = async (rawArgs = [], isCli = true) => {
  const cwd = process.cwd();
  const subArgs = rawArgs.filter((a) => a !== 'j' && a !== 'json');
  const targetFile = subArgs[0];

  if (!targetFile) {
    const msg = 'Usage: chemx j <path-to-json-file>\n';
    if (isCli) process.stderr.write(msg);
    return { output: '', code: 1 };
  }

  const fullPath = path.isAbsolute(targetFile) ? targetFile : path.resolve(cwd, targetFile);
  if (!fs.existsSync(fullPath)) {
    const msg = `File not found: ${targetFile}\n`;
    if (isCli) process.stderr.write(msg);
    return { output: '', code: 1 };
  }

  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const shape = inferJsonType(parsed);
    const out = `// JSON Shape: ${path.relative(cwd, fullPath)} (${raw.length} bytes, ~${Math.round(raw.length / 4)} tokens raw)\n${shape}\n`;
    if (isCli) process.stdout.write(out);
    return { output: out, code: 0 };
  } catch (err) {
    const msg = `Invalid JSON in ${targetFile}: ${err.message}\n`;
    if (isCli) process.stderr.write(msg);
    return { output: '', code: 1 };
  }
};

/**
 * chemx do / chemx batch: Executes multiple commands sequentially in one warm Node process.
 */
export const runBatch = async (rawArgs = [], isCli = true, dispatchFn) => {
  const subArgs = rawArgs.filter((a) => a !== 'do' && a !== 'batch');
  if (subArgs.length === 0) {
    if (isCli) process.stdout.write('Usage: chemx do "<command 1>" "<command 2>" ...\n');
    return { output: '', code: 0 };
  }

  for (const cmdStr of subArgs) {
    const tokens = cmdStr.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const cleanTokens = tokens[0] === 'cx' || tokens[0] === 'chemx' ? tokens.slice(1) : tokens;
    if (isCli) process.stdout.write(`\n--- chemx ${cleanTokens.join(' ')} ---\n`);
    try {
      if (dispatchFn) {
        await dispatchFn(cleanTokens[0], cleanTokens);
      }
    } catch (err) {
      if (isCli) process.stderr.write(`Error in command "${cmdStr}": ${err.message}\n`);
    }
  }
  return { code: 0 };
};

