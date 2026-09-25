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
