import { renderBanner } from './terminal.js';
import { COMMANDS_SCHEMA } from './commands-schema.js';

export const printHelp = () => {
  renderBanner('Chemical X Protocol: CLI Usage & Reference');

  const BOLD = '\x1b[1m';
  const CYAN = '\x1b[36m';
  const DIM = '\x1b[2m';
  const YELLOW = '\x1b[33m';
  const GREEN = '\x1b[32m';
  const RESET = '\x1b[0m';

  const lines = [
    `${BOLD}USAGE${RESET}`,
    `  ${CYAN}npx chemx${RESET} <command> [options]`,
    `  ${CYAN}npm create chemx${RESET} [directory]`,
    '',
    `${BOLD}COMMANDS${RESET}`
  ];

  for (const cmd of COMMANDS_SCHEMA) {
    const aliasStr = cmd.aliases && cmd.aliases.length > 0
      ? `  ${DIM}(aliases: ${cmd.aliases.join(', ')})${RESET}`
      : '';
    const argsUsage = cmd.usage.replace(/^npx chemx \w+/, '').trim();
    lines.push(`  ${CYAN}${cmd.name}${RESET}${argsUsage ? ' ' + argsUsage : ''}${aliasStr}`);
    lines.push(`      ${cmd.summary}`);
    if (cmd.description && cmd.description !== cmd.summary) {
      lines.push(`      ${cmd.description}`);
    }
    if (cmd.flags && cmd.flags.length > 0) {
      const flagStr = cmd.flags.map((f) => `${CYAN}${f.flag}${RESET} (${f.desc})`).join(', ');
      lines.push(`      Flags: ${flagStr}`);
    }
    if (cmd.examples && cmd.examples.length > 0) {
      const egStr = cmd.examples.map((eg) => `${CYAN}${eg}${RESET}`).join(' or ');
      lines.push(`      Examples: ${egStr}`);
    }
    lines.push('');
  }

  lines.push(
    `${BOLD}REACTIVE COMPOSABLE RULES${RESET}`,
    `  ${YELLOW}1.${RESET} Return plain objects with individual ref/computed. Never raw reactive().`,
    `  ${YELLOW}2.${RESET} Structure returns into flat State, Status, and verb Actions (HOOK_SHAPE_CONTRACT).`,
    `  ${YELLOW}3.${RESET} Clean up side-effects automatically onScopeDispose().`,
    '',
    `${BOLD}COMMUNITY & SUPPORT${RESET}`,
    `  Documentation:  ${CYAN}https://github.com/Chemical-X-Protocol/chemical-x${RESET}`,
    `  Sponsor & Pro:  ${GREEN}https://github.com/sponsors/Chemical-X-Protocol${RESET}`,
    ''
  );

  process.stdout.write(lines.join('\n'));
};

export const printInitHelp = () => {
  renderBanner('Chemical X: In-Repo Capsule Drop-in (chemx init)');

  const BOLD = '\x1b[1m';
  const CYAN = '\x1b[36m';
  const RESET = '\x1b[0m';

  const lines = [
    `${BOLD}USAGE${RESET}`,
    `  ${CYAN}npx chemx init${RESET} [directory] [options]`,
    '',
    `${BOLD}DESCRIPTION${RESET}`,
    '  Unpack Chemical X blueprints and molecular architecture drop-in files',
    '  into an existing codebase (defaults to src/chemical-x).',
    '',
    `${BOLD}OPTIONS${RESET}`,
    `  ${CYAN}-h, --help${RESET}           Show this help message`,
    `  ${CYAN}--license=<key>${RESET}     Provide commercial license key for enterprise starter kit assets`,
    '',
    `${BOLD}EXAMPLES${RESET}`,
    `  ${CYAN}npx chemx init${RESET}`,
    `  ${CYAN}npx chemx init src/chemical-x${RESET}`,
    `  ${CYAN}npx chemx init packages/ui/src/modules${RESET}`,
    ''
  ];

  process.stdout.write(lines.join('\n'));
};

export const printScaffoldHelp = () => {
  renderBanner('Chemical X: Project Scaffolder (npm create chemx)');

  const BOLD = '\x1b[1m';
  const CYAN = '\x1b[36m';
  const RESET = '\x1b[0m';

  const lines = [
    `${BOLD}USAGE${RESET}`,
    `  ${CYAN}npm create chemx${RESET} [directory] [options]`,
    `  ${CYAN}npx create-chemx${RESET} [directory] [options]`,
    `  ${CYAN}npx chemx create${RESET} [directory] [options]`,
    '',
    `${BOLD}DESCRIPTION${RESET}`,
    '  Scaffold a complete new Chemical X Molecular Architecture application.',
    '',
    `${BOLD}OPTIONS${RESET}`,
    `  ${CYAN}--framework=<id>${RESET}   Framework flavor: react (default), vue, svelte`,
    `  ${CYAN}--install${RESET}          Auto-install dependencies after scaffolding`,
    `  ${CYAN}--skip-install${RESET}     Skip installing dependencies`,
    `  ${CYAN}--yes, -y${RESET}          Skip interactive prompts and scaffold Community Edition immediately`,
    `  ${CYAN}--headless${RESET}         Run in headless mode for CI/CD and AI agent automation`,
    `  ${CYAN}-h, --help${RESET}         Show this help message`,
    `  ${CYAN}-v, --version${RESET}      Show version number`,
    '',
    `${BOLD}EXAMPLES${RESET}`,
    `  ${CYAN}npm create chemx my-molecular-app --framework=react${RESET}`,
    `  ${CYAN}npx create-chemx my-vue-app --framework=vue --yes${RESET}`,
    `  ${CYAN}npx chemx create my-app --framework=svelte --install${RESET}`,
    ''
  ];

  process.stdout.write(lines.join('\n'));
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
    `${BOLD}LITERAL SEARCH (grep -rn replacement)${RESET}`,
    `  ${CYAN}-g, --literal <pattern>${RESET}  Fixed-string search of every text file .gitignore allows`,
    `      (submodules, docs, styles, json). Prints path:line:text. ${CYAN}--regex${RESET}, ${CYAN}-i${RESET}, ${CYAN}-l${RESET}, ${CYAN}--hidden${RESET}.`,
    `      Pattern starting with '-': ${DIM}chemx q -g -- --x-glass${RESET}\n`,
    `${BOLD}SCOPE & TRUTH${RESET}`,
    `  AST answers cover the printed index scope only (${CYAN}--dir=<path>${RESET} to change it).`,
    `  ${CYAN}-n <N>${RESET} limits results and the output says when it truncated.`,
    `  Exit 3 / status "inconclusive": stale or out-of-scope index, or no audit data.\n`,
    `${BOLD}DISCOVERY & IMPACT MODES${RESET}`,
    `  ${CYAN}--blast-radius, --blast, --impact${RESET}`,
    `      Calculate direct and transitive dependent blast radius across architectural tiers.`,
    `      Optional: ${CYAN}--max-depth=<N>${RESET} (traversal depth, default: 5)`,
    `      Example: ${DIM}pnpm chemx q a-button --blast-radius --json${RESET}\n`,
    `  ${CYAN}--semantic${RESET}`,
    `      Feature-hash similarity of names and trigrams (lexical fuzz, not a learned embedding).`,
    `      Example: ${DIM}pnpm chemx q "button click handler state" --semantic --json${RESET}\n`,
    `  ${CYAN}--hybrid${RESET}`,
    `      BM25 keyword ranking fused with feature-hash similarity via Reciprocal Rank Fusion (RRF).`,
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
