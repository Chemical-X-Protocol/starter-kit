import { renderBanner } from './terminal.js';

export const printGenerateHelp = () => {
  renderBanner('Chemical X: Capsule Generator Usage');
  const BOLD = '\x1b[1m';
  const CYAN = '\x1b[36m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';

  const out = [
    `${BOLD}USAGE${RESET}`,
    `  ${CYAN}npx chemx generate${RESET} <name> [options]`,
    `  ${CYAN}npx chemx generate${RESET} <tier> <name> [options]`,
    '',
    `${BOLD}TIERS${RESET}`,
    `  ${CYAN}atom${RESET} (a-)       Foundational UI elements (raw HTML permitted)`,
    `  ${CYAN}molecule${RESET} (m-)   Groups of atoms (no raw HTML, co-located controller)`,
    `  ${CYAN}organism${RESET} (o-)   Complex feature modules`,
    `  ${CYAN}hook${RESET} (use-)     Domain state / headless composables (< 5 return properties)`,
    `  ${CYAN}view${RESET} (v-)       Declarative Table-of-Contents views`,
    '',
    `${BOLD}OPTIONS${RESET}`,
    `  ${CYAN}--tier=<tier>${RESET}                    Specify component tier`,
    `  ${CYAN}--framework=<react|vue|svelte>${RESET}  Framework flavor (default: auto-detected or react)`,
    `  ${CYAN}--dir=<path>${RESET}                     Target directory (default: src/components/<tier>s)`,
    `  ${CYAN}--desc="<text>"${RESET}                  Describe functionality to tailor archetype and state`,
    `  ${CYAN}--dry-run${RESET}                        Preview planned files and lines without touching disk`,
    `  ${CYAN}--lean${RESET}                           Generate minimal capsule without controller/spec`,
    `  ${CYAN}--json${RESET}                           Output result as minified JSON`,
    `  ${CYAN}-y, --yes${RESET}                        Non-interactive mode with defaults`,
    `  ${CYAN}-h, --help${RESET}                       Show this help message`,
    '',
    `${BOLD}EXAMPLES${RESET}`,
    `  ${CYAN}npx chemx generate m-task-list --framework=react${RESET}`,
    `  ${CYAN}npx chemx generate m-task-list --desc="add, toggle, remove items"${RESET}`,
    `  ${CYAN}npx chemx generate m-task-list --dry-run${RESET}`,
    `  ${CYAN}npx chemx generate hook use-task-filter${RESET}`,
    `  ${CYAN}npx chemx generate view v-user-profile${RESET}`,
    '',
    `${BOLD}LINE LIMITS${RESET}`,
    `  ${DIM}Molecule capsule template:  < 100 lines (outer bound)${RESET}`,
    `  ${DIM}Co-located controller hook: < 100 lines (pure reactive state)${RESET}`,
    `  ${DIM}Table of Contents view:     10-20 lines (declarative slot assembly)${RESET}`,
    ''
  ];

  process.stdout.write(`${out.join('\n')}\n`);
};
