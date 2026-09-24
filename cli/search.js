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
  isSqliteAvailable,
  findSymbolDefinition,
  findSymbolReferences,
  findFileDependencies,
  findFileDependents,
  syncViolationsIndex,
  queryViolations
} from './search-db.js';
import { resolveArchitectureTier, extractAstMetadata } from './search-ast.js';
import {
  handleDefCommand,
  handleRefsCommand,
  handleDepsCommand,
  handleHazardsCommand,
  handlePackCommand,
  handleProgressionCommand,
  handleHealthFilterCommand,
  handleCheckCommand,
  handleBlastRadiusCommand,
  handleSemanticCommand,
  handleHybridCommand
} from './search-commands.js';
import { runGenerateWizard } from './generator.js';
import { runMutatorCli } from './mutators.js';
import { toColumnar } from './columnar.js';
import { ANSI } from './theme.js';

export { toColumnar, fromColumnar } from './columnar.js';

export {
  openIndexDb,
  upsertFileIndex,
  getIndexStats,
  findSymbolDefinition,
  findSymbolReferences,
  findFileDependencies,
  findFileDependents,
  calculateBlastRadius,
  querySemanticIndex,
  queryHybridIndex,
  syncViolationsIndex,
  queryViolations,
  recordAuditSnapshot,
  getAuditProgression,
  queryFilesByHealth
} from './search-db.js';
export {
  handleCheckCommand,
  handleBlastRadiusCommand,
  handleSemanticCommand,
  handleHybridCommand
} from './search-commands.js';

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

  const isWritable = () => { try { fs.accessSync(path.join(cwd, '.chemx'), fs.constants.W_OK); return true; } catch { return false; } };
  const shouldSkipSync = !isWritable() && !options.reindex;
  if (shouldSkipSync) return { db, updatedCount: 0 };

  const targetDirs = Array.isArray(targetDir) ? targetDir : [targetDir];
  if (targetDir === 'src' && fs.existsSync(path.resolve(cwd, 'cli'))) {
    targetDirs.push('cli');
  }

  const scanned = targetDirs.flatMap((d) => {
    const abs = path.resolve(cwd, d);
    return fs.existsSync(abs) ? scanFilesRecursively(abs, cwd) : [];
  });
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
      const { symbols, props, hooks, imports } = extractAstMetadata(content, fullPath);

      upsertFileIndex(db, {
        path: relPath,
        mtime,
        size,
        tier,
        lines,
        chars,
        symbols,
        props,
        hooks,
        imports
      });
      updatedCount += 1;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (process.env.CHEMX_DEBUG) {
        process.stderr.write(`[search-index] Skipped ${relPath}: ${error.message}\n`);
      }
    }
  }

  removeDeletedFiles(db, currentPaths);
  return { db, updatedCount, totalFiles: scanned.length };
};

export const syncSingleFileIndex = (targetPath, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return null;

  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
  const relPath = path.relative(cwd, fullPath);

  if (!fs.existsSync(fullPath)) {
    db.prepare('DELETE FROM files WHERE path = ?').run(relPath);
    db.prepare('DELETE FROM fts_index WHERE file_path = ?').run(relPath);
    db.prepare('DELETE FROM imports WHERE importer_path = ?').run(relPath);
    return { db, status: 'deleted', path: relPath };
  }

  const stat = fs.statSync(fullPath);
  const mtime = Math.floor(stat.mtimeMs);
  const size = stat.size;
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n').length;
  const chars = content.length;
  const tier = resolveArchitectureTier(relPath);
  const { symbols, props, hooks, imports } = extractAstMetadata(content, fullPath);

  upsertFileIndex(db, {
    path: relPath,
    mtime,
    size,
    tier,
    lines,
    chars,
    symbols,
    props,
    hooks,
    imports
  });

  return {
    db,
    status: 'indexed',
    path: relPath,
    tier,
    lines,
    symbolsCount: symbols.length,
    propsCount: props.length,
    hooksCount: hooks.length
  };
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

export const printSearchHelp = () => {
  const BOLD = '\x1b[1m';
  const CYAN = '\x1b[36m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';

  const help = [
    `\n${BOLD}${CYAN}Chemical X Query Machine: Codebase & AST Search${RESET}`,
    `Architecture-aware AST indexer powered by SQLite (.chemx/index.db).\n`,
    `${BOLD}USAGE${RESET}`,
    `  ${CYAN}npx chemx q${RESET} <query|symbol|file> [options]`,
    `  ${CYAN}pnpm chemx search${RESET} <query> [options]\n`,
    `${BOLD}DISCOVERY & IMPACT MODES${RESET}`,
    `  ${CYAN}--blast-radius, --blast, --impact${RESET}`,
    `      Calculate direct and transitive dependent blast radius across architectural tiers.`,
    `      Optional: ${CYAN}--max-depth=<N>${RESET} (traversal depth, default: 5)`,
    `      Example: ${DIM}pnpm chemx q a-button --blast-radius --json${RESET}\n`,
    `  ${CYAN}--semantic${RESET}`,
    `      Concept search via vector cosine similarity.`,
    `      Example: ${DIM}pnpm chemx q "button click handler state" --semantic --json${RESET}\n`,
    `  ${CYAN}--hybrid${RESET}`,
    `      Blended keyword (BM25) and vector cosine ranking via Reciprocal Rank Fusion (RRF).`,
    `      Example: ${DIM}pnpm chemx q "useAttentionCardController" --hybrid --json${RESET}\n`,
    `  ${CYAN}refs <symbol>${RESET} / ${CYAN}deps <symbol|file>${RESET}`,
    `      Inspect caller references or imported dependencies for a given symbol or file.\n`,
    `  ${CYAN}--hazards${RESET}`,
    `      Query unresolved architectural rule violations.`,
    `      Optional: ${CYAN}--rule=<id>${RESET}, ${CYAN}--critical${RESET}\n`,
    `  ${CYAN}--pack, context <target>${RESET}`,
    `      Bundle token-optimized context payload for target capsule and consumers.\n`,
    `${BOLD}OUTPUT & FILTER FLAGS${RESET}`,
    `  ${CYAN}--json${RESET}                 Structured JSON output for AI agent workflows`,
    `  ${CYAN}--columnar${RESET}             Token-compact columnar format (cols/rows)`,
    `  ${CYAN}-i, --inspect${RESET}          Inspect props, exported symbols, and hooks breakdown`,
    `  ${CYAN}--tier=<tier>${RESET}          Filter by tier (atom, molecule, organism, view, hook)`,
    `  ${CYAN}--reindex${RESET}              Force re-index before executing query`,
    `  ${CYAN}--failing, --clean${RESET}     Filter capsules by architectural health status\n`
  ];
  process.stdout.write(help.join('\n'));
};

export const runSearch = async (rawArgs = [], isCli = true) => {
  const hasHelpFlag = rawArgs.includes('--help') || rawArgs.includes('-h');
  const isHelpAlias = rawArgs[0] === 'help';
  const isHelpRequested = hasHelpFlag || isHelpAlias;
  if (isHelpRequested) {
    printSearchHelp();
    if (isCli) process.exit(0);
    return [];
  }

  const isRawJson = rawArgs.includes('--raw-json') || rawArgs.includes('--no-columnar');
  const isExplicitColumnar = rawArgs.includes('--columnar');
  const isJson = rawArgs.includes('--json') || isExplicitColumnar;
  const isColumnar = isJson && !isRawJson;
  const isInspect = rawArgs.includes('--inspect') || rawArgs.includes('-i');
  const isReindex = rawArgs.includes('--reindex');
  const tierFlag = rawArgs.find((a) => a.startsWith('--tier='));
  const tier = tierFlag ? tierFlag.split('=')[1] : null;
  const dirFlag = rawArgs.find((a) => a.startsWith('--dir='));
  const targetDir = resolveTargetDir(dirFlag);

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

  const nonFlagArgs = rawArgs.filter((a) => !a.startsWith('-'));
  const firstArg = nonFlagArgs[0] || '';
  const secondArg = nonFlagArgs[1] || '';

  const isCheckCommand = firstArg === 'check' || firstArg === 'verify';
  if (isCheckCommand) {
    return handleCheckCommand(secondArg, { isJson, isCli });
  }

  const isFixCommand = firstArg === 'fix';
  const isAddPrefix = firstArg.startsWith('add:');
  const isAddTarget = firstArg === 'add' && ['prop', 'state', 'action'].includes(secondArg);
  const isMutatorAction = isFixCommand || isAddPrefix || isAddTarget;
  if (isMutatorAction) {
    return runMutatorCli(rawArgs, isCli);
  }

  const isGenerateCommand = ['gen', 'g', 'generate'].includes(firstArg);
  if (isGenerateCommand) {
    return runGenerateWizard(rawArgs.slice(1));
  }

  const isDefCommand = firstArg === 'def';
  if (isDefCommand) {
    return handleDefCommand(db, secondArg, { isJson, isCli });
  }

  const isRefsCommand = firstArg === 'refs';
  if (isRefsCommand) {
    return handleRefsCommand(db, secondArg, { isJson, isCli });
  }

  const isDepsCommand = firstArg === 'deps' || firstArg === 'dependencies';
  if (isDepsCommand) {
    return handleDepsCommand(db, secondArg, { isJson, isCli });
  }

  const isBlastRadiusCommand = firstArg === 'blast' || firstArg === 'impact' ||
    rawArgs.includes('--blast-radius') || rawArgs.includes('--blast') || rawArgs.includes('--impact');
  if (isBlastRadiusCommand) {
    const target = (firstArg === 'blast' || firstArg === 'impact') ? secondArg : firstArg;
    const maxDepthFlag = rawArgs.find((a) => a.startsWith('--max-depth='));
    const maxDepth = maxDepthFlag ? parseInt(maxDepthFlag.split('=')[1], 10) : 5;
    return handleBlastRadiusCommand(db, target, { isJson, isCli, isColumnar, maxDepth });
  }

  const isSemanticCommand = firstArg === 'semantic' || rawArgs.includes('--semantic');
  if (isSemanticCommand) {
    const query = firstArg === 'semantic' ? secondArg : firstArg;
    return handleSemanticCommand(db, query, { isJson, isCli, isColumnar, tier, limit: 20 });
  }

  const isHybridCommand = firstArg === 'hybrid' || rawArgs.includes('--hybrid');
  if (isHybridCommand) {
    const query = firstArg === 'hybrid' ? secondArg : firstArg;
    return handleHybridCommand(db, query, { isJson, isCli, isColumnar, tier, limit: 20 });
  }

  const isHazardsCommand = firstArg === 'hazards';
  if (isHazardsCommand) {
    const ruleFlag = rawArgs.find((a) => a.startsWith('--rule='));
    const rule = ruleFlag ? ruleFlag.split('=')[1] : null;
    const isCritical = rawArgs.includes('--critical');
    const severity = isCritical ? 'CRITICAL' : null;
    return handleHazardsCommand(db, { rule, severity, filePath: secondArg || null }, { isJson, isCli });
  }

  const isPackCommand = firstArg === 'pack' || firstArg === 'context';
  if (isPackCommand) {
    return handlePackCommand(db, secondArg, { isJson, isCli });
  }

  const hasProgressionFlag = rawArgs.includes('--progression');
  const isProgressionAlias = firstArg === 'progression' || firstArg === 'history';
  const isProgressionCommand = isProgressionAlias || hasProgressionFlag;
  if (isProgressionCommand) {
    return handleProgressionCommand(db, { isJson, isCli });
  }

  const hasFailingFlag = rawArgs.includes('--failing') || rawArgs.includes('--degraded');
  const isFailingAlias = firstArg === 'failing' || firstArg === 'degraded';
  const isFailingCommand = isFailingAlias || hasFailingFlag;
  if (isFailingCommand) {
    return handleHealthFilterCommand(db, 'failing', { isJson, isCli });
  }

  const hasCleanFlag = rawArgs.includes('--crystalline') || rawArgs.includes('--clean');
  const isCleanAlias = firstArg === 'crystalline' || firstArg === 'clean';
  const isCleanCommand = isCleanAlias || hasCleanFlag;
  if (isCleanCommand) {
    return handleHealthFilterCommand(db, 'crystalline', { isJson, isCli });
  }

  const cleanQuery = firstArg.trim();
  const results = queryIndex(db, { query: cleanQuery, tier, limit: 50 });
  const durationMs = Date.now() - startTime;

  if (isJson) {
    if (isColumnar) {
      const columnarData = toColumnar(results, ['path', 'tier', 'lines', 'symbols', 'props', 'hooks'], {
        symbols: (r) => (r.symbols || []).map((s) => s.name),
        props: (r) => (r.props || []).map((p) => p.name),
        hooks: (r) => r.hooks || []
      });
      const payload = {
        query: cleanQuery,
        tier,
        count: results.length,
        durationMs,
        format: 'columnar',
        cols: columnarData.cols,
        rows: columnarData.rows
      };
      process.stdout.write(JSON.stringify(payload) + '\n');
      if (isCli) process.exit(0);
      return payload;
    }

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
