import { ANSI } from './theme.js';
import path from 'node:path';
import { readTokenOptimized } from './reader.js';
import { hasHelpFlag } from './help-args.js';
import { buildRequestedReadCards } from './reader-cards-gate.js';
import { formatReadHeader, formatReadBody } from './reader-format.js';

/**
 * CLI command runner for chemx read / chemx view.
 *
 * @param {string[]} args CLI arguments.
 * @param {boolean} isCli Whether invoked directly from CLI.
 */
export const runReaderCli = (args, isCli = false) => {
  const isLoneHelpWord = args.length === 1 && args[0] === 'help';
  const isHelpRequest = hasHelpFlag(args) || isLoneHelpWord;
  if (isHelpRequest) {
    const isJson = args.includes('--json');
    if (isJson) {
      process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    } else {
      process.stdout.write([
        `${ANSI.BOLD}USAGE${ANSI.RESET}`,
        `  chemx read <file> [options]`,
        '',
        `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
        `  --outline                AST structure outline only (smaller than the file; see benchmarks/README.md)`,
        `  --logic, -l              AST logic skeleton (control flow, state, mutations)`,
        `  --template, -t           Extract template markup only (Vue/Svelte/JSX)`,
        `  --enrich                 Append a logic skeleton (not verbatim source) after the outline`,
        `  --trace=<name>           Forward call trace card (uses the .chemx index)`,
        `  --backtrace=<name>       Reverse caller chain card (uses the .chemx index)`,
        `  --connections            References and blast radius card for the file or --symbol`,
        `  --symbol=<name>          Declaration by AST range (also Class.method, store.action)`,
        `  --lines=<range>          Line range a-b (alias of :a-b)`,
        `  --full                   Read the whole file without truncation`,
        `  --start=<N>              Start line number (1-indexed)`,
        `  --end=<N>                End line number (1-indexed)`,
        `  --strip-comments         Blank out comments (token based; line numbers stay true)`,
        `  --compact                Drop repeated blank lines (original numbers still shown)`,
        `  --bare, -b               Raw content without headers or line numbers`,
        `  --json                   Output result as minified JSON`,
        `  -h, --help               Show this help message`,
        '',
        `${ANSI.BOLD}EXAMPLES${ANSI.RESET}`,
        `  chemx read src/store.ts --outline`,
        `  chemx read src/store.ts --lines 10-50`,
        `  chemx read src/store.ts --full`,
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

  const skipIndices = new Set();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const isValFlag = a === '-s' || a === '--symbol' || a === '--lines';
    const nextArg = args[i + 1];
    const hasNextNonFlag = Boolean(nextArg) && !nextArg.startsWith('-');
    const shouldSkipNext = isValFlag && hasNextNonFlag;
    if (shouldSkipNext) {
      skipIndices.add(i + 1);
    }
  }

  const isNonFlagCandidate = (a, idx) => !a.startsWith('-') && !skipIndices.has(idx);
  const nonFlagArgs = args.filter(isNonFlagCandidate);
  let filePath = nonFlagArgs[0];

  if (!filePath) {
    process.stderr.write(`${ANSI.RED}✕ Missing file path. Usage: chemx r <file[:start-end]> [-o] [-l] [-s name]${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }

  let startLine;
  let endLine;

  let linesRange = null;
  const linesEq = args.find((a) => a.startsWith('--lines='));
  if (linesEq) {
    linesRange = linesEq.slice('--lines='.length);
  } else {
    const linesIdx = args.findIndex((a) => a === '--lines');
    const nextToken = linesIdx === -1 ? undefined : args[linesIdx + 1];
    const hasSpacedLines = Boolean(nextToken) && !nextToken.startsWith('-');
    if (hasSpacedLines) {
      linesRange = nextToken;
    }
  }

  const hasLinesRange = Boolean(linesRange);
  if (hasLinesRange) {
    const rangeMatch = linesRange.match(/^(\d+)(?:[-:](\d+))?$/);
    if (rangeMatch) {
      const isStartLineMissing = startLine === undefined;
      if (isStartLineMissing) startLine = parseInt(rangeMatch[1], 10);
      const hasEndInMatch = Boolean(rangeMatch[2]);
      const isEndLineMissing = endLine === undefined;
      const shouldSetEnd = isEndLineMissing && hasEndInMatch;
      if (shouldSetEnd) endLine = parseInt(rangeMatch[2], 10);
    }
  }

  const colonMatch = filePath.match(/^([^:]+):(\d+)(?:[-:](\d+))?$/);
  if (colonMatch) {
    filePath = colonMatch[1];
    const isStartLineMissing = startLine === undefined;
    if (isStartLineMissing) startLine = parseInt(colonMatch[2], 10);
    const hasEndLineSuffix = Boolean(colonMatch[3]);
    const isEndLineMissing = endLine === undefined;
    const shouldSetEnd = hasEndLineSuffix && isEndLineMissing;
    if (shouldSetEnd) endLine = parseInt(colonMatch[3], 10);
  }

  const isJson = args.includes('--json') || args.includes('-j');
  const isBare = args.includes('--bare') || args.includes('-b');
  const isFull = args.includes('--full');
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
    const spacedValue = sIndex === -1 ? undefined : args[sIndex + 1];
    const hasSpacedSymbol = Boolean(spacedValue) && !spacedValue.startsWith('-');
    if (hasSpacedSymbol) {
      symbol = args[sIndex + 1];
    } else {
      const sFlag = args.find((a) => a.startsWith('-s='));
      if (sFlag) {
        const val = sFlag.split('=')[1];
        const isNumericValue = /^\d+$/.test(val);
        if (isNumericValue) {
          const needsStartFromValue = startLine === undefined;
          if (needsStartFromValue) startLine = parseInt(val, 10);
        } else {
          symbol = val;
        }
      }
    }
  }

  const isStartLineMissing = startLine === undefined;
  if (isStartLineMissing) {
    const startFlag = args.find((a) => a.startsWith('--start='));
    if (startFlag) startLine = parseInt(startFlag.split('=')[1], 10);
  }

  const isEndLineMissing = endLine === undefined;
  if (isEndLineMissing) {
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
      full: isFull,
      bare: isBare,
      hintSyntax: 'cli',
    });

    const cards = buildRequestedReadCards(process.cwd(), path.resolve(filePath), {
      symbol,
      connections: args.includes('--connections'),
      traceSymbol,
      backtraceSymbol
    });
    const cardText = [cards.connection, cards.trace, cards.backtrace, cards.freshness].filter(Boolean).join('');
    if (cardText) res.cards = cardText.trim();

    if (isJson) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    } else if (isBare) {
      const output = res.trailer ? `${res.content || ''}\n${res.trailer}` : (res.content || '');
      process.stdout.write(output + '\n');
    } else {
      const hasConflict = Boolean(res.conflict);
      if (hasConflict) process.stdout.write(`${ANSI.GOLD}⚠ ${res.conflict}${ANSI.RESET}\n`);
      process.stdout.write(`${ANSI.BOLD}${ANSI.CYAN}--- ${formatReadHeader(res)} ---${ANSI.RESET}\n`);
      process.stdout.write(formatReadBody(res) + '\n');
      const hasEnriched = Boolean(res.enriched);
      if (hasEnriched) {
        process.stdout.write(res.enriched + '\n');
      }
      if (cardText) process.stdout.write(`${cardText.trim()}\n`);
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
