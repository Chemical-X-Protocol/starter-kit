import fs from 'node:fs';
import path from 'node:path';
import {
  openIndexDb,
  getAllIndexedFiles,
  removeDeletedFiles,
  upsertFileIndex,
  queryIndex,
  inspectIndexedFile,
  getIndexStats,
  isSqliteAvailable
} from './search-db.js';
import { resolveArchitectureTier, extractAstMetadata } from './search-ast.js';
import { ANSI } from './theme.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'vendor',
  '.git',
  '.next',
  '.turbo',
  '.output',
  '.nuxt',
  '.cache',
  'out'
]);

const EXCLUDED_NAME_PATTERNS = ['.test.', '.spec.', '.min.'];

const isSourceFile = (name) => {
  const isExtensionValid = /\.(tsx|ts|jsx|js|vue|svelte)$/.test(name);
  if (!isExtensionValid) return false;
  return !EXCLUDED_NAME_PATTERNS.some((pat) => name.includes(pat));
};

const scanFilesRecursively = (dir, baseDir, fileList = []) => {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        scanFilesRecursively(fullPath, baseDir, fileList);
      }
    } else if (isSourceFile(entry.name)) {
      fileList.push({ fullPath, relPath });
    }
  }
  return fileList;
};

export const syncSearchIndex = (targetDir = 'src', cwd = process.cwd(), options = {}) => {
  const db = openIndexDb(cwd);
  if (!db) return null;

  const absoluteTarget = path.resolve(cwd, targetDir);
  const scanned = scanFilesRecursively(absoluteTarget, cwd);
  const currentPaths = scanned.map((s) => s.relPath);

  const indexedMap = options.reindex ? new Map() : getAllIndexedFiles(db);
  let updatedCount = 0;

  for (const { fullPath, relPath } of scanned) {
    try {
      const stat = fs.statSync(fullPath);
      const mtime = Math.floor(stat.mtimeMs);
      const size = stat.size;

      const cached = indexedMap.get(relPath);
      const isUnchanged = cached && cached.mtime === mtime && cached.size === size;

      if (isUnchanged && !options.reindex) {
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').length;
      const chars = content.length;
      const tier = resolveArchitectureTier(relPath);
      const { symbols, props, hooks } = extractAstMetadata(content, fullPath);

      upsertFileIndex(db, {
        path: relPath,
        mtime,
        size,
        tier,
        lines,
        chars,
        symbols,
        props,
        hooks
      });
      updatedCount += 1;
    } catch {
      // Skip unreadable files safely
    }
  }

  removeDeletedFiles(db, currentPaths);
  return { db, updatedCount, totalFiles: scanned.length };
};

const formatTierBadge = (tier) => {
  const map = {
    atom: `${ANSI.LIME}[atom]${ANSI.RESET}`,
    molecule: `${ANSI.CYAN}[molecule]${ANSI.RESET}`,
    organism: `${ANSI.PURPLE}[organism]${ANSI.RESET}`,
    template: `${ANSI.GOLD}[template]${ANSI.RESET}`,
    view: `${ANSI.PINK}[view]${ANSI.RESET}`,
    hook: `${ANSI.MINT}[hook]${ANSI.RESET}`,
    type: `${ANSI.DIM}[type]${ANSI.RESET}`
  };
  return map[tier] || `${ANSI.DIM}[${tier}]${ANSI.RESET}`;
};

export const resolveTargetDir = (customOrFlag = null, dirFlag = null) => {
  const isCustomPath = Boolean(customOrFlag && !customOrFlag.startsWith('--dir='));
  if (isCustomPath) {
    return customOrFlag;
  }

  const effectiveFlag = dirFlag || (customOrFlag?.startsWith('--dir=') ? customOrFlag : null);
  if (effectiveFlag) {
    const [, flagValue] = effectiveFlag.split('=');
    if (flagValue !== undefined) {
      return flagValue;
    }
  }

  const hasSrcDirectory = fs.existsSync('src');
  if (hasSrcDirectory) {
    return 'src';
  }

  return '.';
};

export const runSearch = async (rawArgs = [], isCli = true) => {
  const isJson = rawArgs.includes('--json');
  const isInspect = rawArgs.includes('--inspect') || rawArgs.includes('-i');
  const isReindex = rawArgs.includes('--reindex');
  const tierFlag = rawArgs.find((a) => a.startsWith('--tier='));
  const tier = tierFlag ? tierFlag.split('=')[1] : null;
  const dirFlag = rawArgs.find((a) => a.startsWith('--dir='));
  const targetDir = resolveTargetDir(dirFlag);

  const queryArg = rawArgs.find((a) => !a.startsWith('-')) || '';
  const cleanQuery = queryArg.trim();

  const startTime = Date.now();
  const syncRes = syncSearchIndex(targetDir, process.cwd(), { reindex: isReindex });
  const db = syncRes?.db;

  if (!db) {
    const errorMsg = '✕ SQLite engine not available. Please ensure Node.js >= 22.5 is installed.';
    if (isJson) {
      process.stdout.write(JSON.stringify({ error: errorMsg, results: [] }) + '\n');
    } else {
      process.stderr.write(`\x1b[31m${errorMsg}\x1b[0m\n`);
    }
    if (isCli) process.exit(1);
    return [];
  }

  const results = queryIndex(db, { query: cleanQuery, tier, limit: 50 });
  const durationMs = Date.now() - startTime;

  if (isJson) {
    const payload = {
      query: cleanQuery,
      tier,
      count: results.length,
      durationMs,
      results
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
    if (isCli) process.exit(0);
    return results;
  }

  // CLI output formatting
  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Chemical X Query Machine${ANSI.RESET} ${ANSI.DIM}(${results.length} results in ${durationMs}ms)${ANSI.RESET}\n`);

  if (results.length === 0) {
    process.stdout.write(`  ${ANSI.DIM}No matching capsules, symbols, or files found for "${cleanQuery}".${ANSI.RESET}\n\n`);
    if (isCli) process.exit(0);
    return results;
  }

  if (isInspect) {
    for (const r of results) {
      process.stdout.write(`\n  ${formatTierBadge(r.tier)} ${ANSI.BOLD}${r.path}${ANSI.RESET} ${ANSI.DIM}(${r.lines} lines, ${r.chars} chars)${ANSI.RESET}\n`);
      if (r.symbols.length > 0) {
        const symList = r.symbols.map((s) => `${s.name}${s.isExport ? '*' : ''}`).join(', ');
        process.stdout.write(`    ${ANSI.MINT}Symbols:${ANSI.RESET} ${symList}\n`);
      }
      if (r.props.length > 0) {
        const propList = r.props.map((p) => p.name).join(', ');
        process.stdout.write(`    ${ANSI.GOLD}Props:${ANSI.RESET} ${propList}\n`);
      }
      if (r.hooks.length > 0) {
        process.stdout.write(`    ${ANSI.PURPLE}Hooks:${ANSI.RESET} ${r.hooks.join(', ')}\n`);
      }
    }
  } else {
    for (const r of results) {
      const mainSymbol = r.symbols.find((s) => s.isExport)?.name;
      const symSummary = mainSymbol ? ` (${mainSymbol})` : '';
      const hookSummary = r.hooks.length > 0 ? ` [${r.hooks.slice(0, 3).join(', ')}]` : '';
      process.stdout.write(`  ${formatTierBadge(r.tier)} ${ANSI.BOLD}${r.path}${ANSI.RESET}${ANSI.DIM}:${r.lines}L${ANSI.RESET}${ANSI.CYAN}${symSummary}${ANSI.RESET}${ANSI.DIM}${hookSummary}${ANSI.RESET}\n`);
    }
  }

  process.stdout.write(`\n  ${ANSI.DIM}Tip: Run with --inspect for props/hooks breakdown or --json for AI agent queries.${ANSI.RESET}\n\n`);
  if (isCli) process.exit(0);
  return results;
};
