import { ANSI } from './theme.js';
import { readTokenOptimized } from './reader.js';

/**
 * CLI command runner for chemx read / chemx view.
 *
 * @param {string[]} args CLI arguments.
 * @param {boolean} isCli Whether invoked directly from CLI.
 */
export const runReaderCli = (args, isCli = false) => {
  if (args.includes('--help') || args.includes('-h') || args.includes('help')) {
    const isJson = args.includes('--json');
    if (isJson) {
      process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    } else {
      process.stdout.write([
        `${ANSI.BOLD}USAGE${ANSI.RESET}`,
        `  chemx read <file> [options]`,
        '',
        `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
        `  --outline                AST structure outline only (80%+ token savings)`,
        `  --logic, -l              AST logic skeleton (control flow, state, mutations)`,
        `  --template, -t           Extract template markup only (Vue/Svelte/JSX)`,
        `  --enrich                 Append compacted logic skeleton after outline (free-lunch overlay)`,
        `  --trace=<name>           Forward call trace card appended inline (requires --enrich)`,
        `  --backtrace=<name>       Reverse caller chain card appended inline (requires --enrich)`,
        `  --symbol=<name>          Extract specific function/hook/interface declaration`,
        `  --start=<N>              Start line number (1-indexed)`,
        `  --end=<N>                End line number (1-indexed)`,
        `  --strip-comments         Remove comments to minimize tokens`,
        `  --compact                Collapse empty whitespace lines`,
        `  --json                   Output result as minified JSON`,
        `  -h, --help               Show this help message`,
        '',
        `${ANSI.BOLD}EXAMPLES${ANSI.RESET}`,
        `  chemx read src/store.ts --outline`,
        `  chemx read src/controller.ts --outline --enrich`,
        `  chemx read src/card.vue --outline --enrich --trace=handleSubmit`,
        `  chemx read src/controller.ts --logic`,
        `  chemx read api.ts --symbol=login --connections`,
        ''
      ].join('\n'));
    }
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const nonFlagArgs = args.filter((a) => !a.startsWith('-'));
  let filePath = nonFlagArgs[0];

  if (!filePath) {
    process.stderr.write(`${ANSI.RED}✕ Missing file path. Usage: chemx r <file[:start-end]> [-o] [-l] [-s name]${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }

  let startLine;
  let endLine;

  const colonMatch = filePath.match(/^([^:]+):(\d+)(?:[-:](\d+))?$/);
  if (colonMatch) {
    filePath = colonMatch[1];
    startLine = parseInt(colonMatch[2], 10);
    if (colonMatch[3]) endLine = parseInt(colonMatch[3], 10);
  }

  const isJson = args.includes('--json') || args.includes('-j');
  const isOutline = args.includes('--outline') || args.includes('-o');
  const isLogic = args.includes('--logic') || args.includes('-l');
  const isTemplate = args.includes('--template') || args.includes('-t');
  const isCompact = args.includes('--compact') || args.includes('-c');
  const isStripComments = args.includes('--strip-comments') || args.includes('--no-comments') || args.includes('-sc');
  const isEnrich = args.includes('--enrich');

  const traceFlag = args.find((a) => a.startsWith('--trace='));
  const traceSymbol = traceFlag ? traceFlag.split('=')[1] : null;

  const backtraceFlag = args.find((a) => a.startsWith('--backtrace='));
  const backtraceSymbol = backtraceFlag ? backtraceFlag.split('=')[1] : null;

  let symbol = null;
  const symEqFlag = args.find((a) => a.startsWith('--symbol=') || a.startsWith('-sym='));
  if (symEqFlag) {
    symbol = symEqFlag.split('=')[1];
  } else {
    const sIndex = args.findIndex((a) => a === '-s' || a === '--symbol');
    if (sIndex !== -1 && args[sIndex + 1] && !args[sIndex + 1].startsWith('-')) {
      symbol = args[sIndex + 1];
    } else {
      const sFlag = args.find((a) => a.startsWith('-s='));
      if (sFlag) {
        const val = sFlag.split('=')[1];
        if (/^\d+$/.test(val)) {
          if (startLine === undefined) startLine = parseInt(val, 10);
        } else {
          symbol = val;
        }
      }
    }
  }

  if (startLine === undefined) {
    const startFlag = args.find((a) => a.startsWith('--start='));
    if (startFlag) startLine = parseInt(startFlag.split('=')[1], 10);
  }

  if (endLine === undefined) {
    const endFlag = args.find((a) => a.startsWith('--end=') || a.startsWith('-e='));
    if (endFlag) endLine = parseInt(endFlag.split('=')[1], 10);
  }

  try {
    const res = readTokenOptimized(filePath, {
      outline: isOutline,
      logic: isLogic,
      template: isTemplate,
      compact: isCompact,
      stripComments: isStripComments,
      enrich: isEnrich,
      traceSymbol,
      backtraceSymbol,
      symbol,
      startLine,
      endLine,
    });

    if (isJson) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    } else {
      const enrichSuffix = res.tokensEnriched > 0 ? ` +${res.tokensEnriched} enriched` : '';
      process.stdout.write(`${ANSI.BOLD}${ANSI.CYAN}--- ${res.file} (${res.lineCount || res.totalLines} lines, ~${res.tokensEst} tokens${enrichSuffix}) ---${ANSI.RESET}\n`);
      process.stdout.write(res.content + '\n');
      if (res.enriched) {
        process.stdout.write(res.enriched + '\n');
      }
    }

    if (isCli) process.exit(0);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${ANSI.RED}✕ ${msg}${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }
};
