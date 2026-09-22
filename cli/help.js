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
