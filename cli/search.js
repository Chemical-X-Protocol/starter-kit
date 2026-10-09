import path from 'node:path';
import { queryIndexPage } from './search-db.js';
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
  handleCallTraceCommand,
  handleBacktraceCommand,
  handleSemanticCommand,
  handleHybridCommand,
  handleLiteralSearchCommand
} from './search-commands.js';
import { runGenerateWizard } from './generator.js';
import { runMutatorCli } from './mutators.js';
import { resolveTargetDir } from './path-scope.js';
import { printSearchHelp } from './help.js';
import { syncSearchIndex, syncSingleFileIndex } from './search-sync.js';
import { parseSearchArgs, hasAnyFlag, readIntValue } from './search-args.js';
import { resolveIndexRoot, resolveDefaultScopeDir } from './search-root.js';
import { describeIndexFromSync, applyExitStatus, indexStatusOf } from './search-output.js';
import { buildQueryPayload, printQueryPage } from './search-query-view.js';
import { STATUS } from './result-status.js';

export { toColumnar, fromColumnar } from './columnar.js';
export {
  openIndexDb, upsertFileIndex, getIndexStats,
  findSymbolDefinition, findSymbolReferences,
  findFileDependencies, findFileDependents,
  calculateBlastRadius, querySemanticIndex, queryHybridIndex,
  syncViolationsIndex, queryViolations,
  recordAuditSnapshot, getAuditProgression, queryFilesByHealth
} from './search-db.js';
export {
  handleCheckCommand, handleBlastRadiusCommand,
  handleSemanticCommand, handleHybridCommand,
  handleLiteralSearchCommand
} from './search-commands.js';
export { syncSearchIndex, syncSingleFileIndex, resolveTargetDir, printSearchHelp };

const SQLITE_MISSING = 'SQLite engine not available. Please ensure Node.js >= 22.5 is installed.';

const failNoSqlite = (isJson, isCli) => {
  const message = `✕ ${SQLITE_MISSING}`;
  if (isJson) process.stdout.write(JSON.stringify({ status: STATUS.INCONCLUSIVE, error: message, results: [] }) + '\n');
  else process.stderr.write(`${message}\n`);
  applyExitStatus(STATUS.INCONCLUSIVE, isCli);
  if (isCli) process.exit();
  return [];
};

// --dir is relative to where chemx was started; the default scope is the project's own.
const resolveScopeTarget = (parsed, cwd, root) => {
  const hasDirFlag = parsed.values.dir !== undefined;
  if (hasDirFlag) return parsed.values.dir === '' ? cwd : parsed.values.dir;
  return path.resolve(root, resolveDefaultScopeDir(root));
};

const reportArgProblems = (parsed, isJson) => {
  const problems = [
    ...parsed.unknownFlags.map((f) => `ignored unknown flag ${f}`),
    ...parsed.missingValues.map((f) => `missing value for ${f}`)
  ];
  const hasProblems = problems.length > 0;
  if (hasProblems && !isJson) process.stderr.write(`chemx q: ${problems.join('; ')}\n`);
  return problems;
};

const MODE_HANDLERS = {
  def: (ctx) => handleDefCommand(ctx.db, ctx.second, { ...ctx.opts, isFull: ctx.parsed.flags.has('--full') }),
  refs: (ctx) => handleRefsCommand(ctx.db, ctx.second, ctx.opts),
  deps: (ctx) => handleDepsCommand(ctx.db, ctx.second, ctx.opts),
  blast: (ctx) => handleBlastRadiusCommand(ctx.db, ctx.target, { ...ctx.opts, maxDepth: readIntValue(ctx.parsed, 'maxDepth', 5) }),
  trace: (ctx) => handleCallTraceCommand(ctx.db, ctx.target, { ...ctx.opts, maxDepth: readIntValue(ctx.parsed, 'maxDepth', 3) }),
  backtrace: (ctx) => handleBacktraceCommand(ctx.db, ctx.target, { ...ctx.opts, maxDepth: readIntValue(ctx.parsed, 'maxDepth', 5) }),
  semantic: (ctx) => handleSemanticCommand(ctx.db, ctx.target, { ...ctx.opts, tier: ctx.parsed.values.tier || null, limit: ctx.limit }),
  hybrid: (ctx) => handleHybridCommand(ctx.db, ctx.target, { ...ctx.opts, tier: ctx.parsed.values.tier || null, limit: ctx.limit }),
  hazards: (ctx) => handleHazardsCommand(ctx.db, {
    rule: ctx.parsed.values.rule || null,
    severity: ctx.parsed.flags.has('--critical') ? 'CRITICAL' : null,
    filePath: ctx.second || null,
    root: ctx.root
  }, ctx.opts),
  pack: (ctx) => handlePackCommand(ctx.db, ctx.second, ctx.opts),
  progression: (ctx) => handleProgressionCommand(ctx.db, ctx.opts),
  failing: (ctx) => handleHealthFilterCommand(ctx.db, 'failing', ctx.opts),
  crystalline: (ctx) => handleHealthFilterCommand(ctx.db, 'crystalline', ctx.opts)
};

const SUBCOMMAND_MODES = {
  def: 'def', refs: 'refs', deps: 'deps', dependencies: 'deps', blast: 'blast', impact: 'blast',
  trace: 'trace', backtrace: 'backtrace', semantic: 'semantic', hybrid: 'hybrid', hazards: 'hazards',
  pack: 'pack', context: 'pack', progression: 'progression', history: 'progression',
  failing: 'failing', degraded: 'failing', crystalline: 'crystalline', clean: 'crystalline'
};

const FLAG_MODES = [
  [['--blast-radius', '--blast', '--impact'], 'blast'], [['--trace'], 'trace'], [['--backtrace'], 'backtrace'],
  [['--semantic'], 'semantic'], [['--hybrid'], 'hybrid'], [['--progression'], 'progression'],
  [['--failing', '--degraded'], 'failing'], [['--crystalline', '--clean'], 'crystalline']
];

const resolveMode = (parsed, first) => {
  const subcommandMode = SUBCOMMAND_MODES[first];
  if (subcommandMode) return { mode: subcommandMode, isSubcommand: true };
  const flagMode = FLAG_MODES.find(([flags]) => hasAnyFlag(parsed, flags));
  return { mode: flagMode ? flagMode[1] : 'query', isSubcommand: false };
};

const runPassthroughCommand = (parsed, rawArgs, first, second, isJson, isCli) => {
  const isCheckCommand = first === 'check' || first === 'verify';
  if (isCheckCommand) return { handled: true, value: handleCheckCommand(second, { isJson, isCli }) };
  const isMutatorAction = first === 'fix' || first.startsWith('add:') || (first === 'add' && ['prop', 'state', 'action'].includes(second));
  if (isMutatorAction) return { handled: true, value: runMutatorCli(rawArgs, isCli) };
  const isGenerateCommand = ['gen', 'g', 'generate'].includes(first);
  if (isGenerateCommand) return { handled: true, value: runGenerateWizard(rawArgs.slice(1)) };
  return { handled: false };
};

export const runSearch = async (rawArgs = [], isCli = true) => {
  const parsed = parseSearchArgs(rawArgs);
  const isHelpRequested = hasAnyFlag(parsed, ['--help', '-h']) || parsed.positionals[0] === 'help';
  if (isHelpRequested) {
    printSearchHelp();
    if (isCli) process.exit(0);
    return [];
  }

  const isRawJson = hasAnyFlag(parsed, ['--raw-json', '--no-columnar']);
  const isJson = hasAnyFlag(parsed, ['--json', '-j', '--columnar']);
  const isColumnar = isJson && !isRawJson;
  const isLiteral = hasAnyFlag(parsed, ['-g', '--literal']);
  const argProblems = reportArgProblems(parsed, isJson);
  const first = parsed.positionals[0] || '';
  const second = parsed.positionals[1] || '';
  const cwd = process.cwd();

  const passthrough = isLiteral ? { handled: false } : runPassthroughCommand(parsed, rawArgs, first, second, isJson, isCli);
  if (passthrough.handled) return passthrough.value;

  const startTime = Date.now();
  const root = resolveIndexRoot(cwd);
  const syncRes = syncSearchIndex(resolveScopeTarget(parsed, cwd, root), cwd, {
    reindex: parsed.flags.has('--reindex'),
    includeInternal: parsed.flags.has('--include-internal')
  });
  if (!syncRes?.db) return failNoSqlite(isJson, isCli);
  const db = syncRes.db;
  const index = { ...describeIndexFromSync(syncRes), argProblems: argProblems.length > 0 ? argProblems : undefined };
  applyExitStatus(indexStatusOf(index), isCli);

  if (isLiteral) {
    const query = parsed.pattern ?? first;
    return handleLiteralSearchCommand(db, query, {
      isCaseInsensitive: hasAnyFlag(parsed, ['-i', '--ignore-case']),
      isLineOnly: hasAnyFlag(parsed, ['-l', '--lines']),
      limit: readIntValue(parsed, 'limit', 20), isJson, isCli, cwd
    });
  }

  const { mode, isSubcommand } = resolveMode(parsed, first);
  const limit = readIntValue(parsed, 'limit', mode === 'query' ? 50 : 20);
  const opts = { index, isJson, isCli, isColumnar, root };
  const ctx = { db, parsed, first, second, root, limit, opts, target: isSubcommand ? second : first };
  const handler = MODE_HANDLERS[mode];
  if (handler) return handler(ctx);

  const query = first.trim();
  const page = queryIndexPage(db, { query, tier: parsed.values.tier || null, limit });
  const durationMs = Date.now() - startTime;
  if (isJson) {
    const payload = buildQueryPayload(page, { query, tier: parsed.values.tier || null, durationMs, isColumnar, index });
    process.stdout.write(JSON.stringify(payload) + '\n');
    if (isCli) process.exit();
    return isColumnar ? payload : page.results;
  }
  const isInspect = hasAnyFlag(parsed, ['--inspect', '-i']);
  printQueryPage(page, { query, durationMs, isInspect, index });
  if (isCli) process.exit();
  return page.results;
};
