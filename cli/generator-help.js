import { describeLineBudgetPolicy } from './config/profiles.js';
import { isStdoutTty } from './terminal.js';
import { renderTtyBanner } from './tty-banner.js';

const TTY_STYLES = { BOLD: '\x1b[1m', CYAN: '\x1b[36m', DIM: '\x1b[2m', RESET: '\x1b[0m' };
const PLAIN_STYLES = { BOLD: '', CYAN: '', DIM: '', RESET: '' };

// The banner and colors exist only for a human terminal (plan 5.4 seam).
export const printGenerateHelp = async () => {
  await renderTtyBanner('Chemical X: Capsule Generator Usage');
  const { BOLD, CYAN, DIM, RESET } = isStdoutTty() ? TTY_STYLES : PLAIN_STYLES;

  const out = [
    `${BOLD}USAGE${RESET}`,
    `  ${CYAN}npx chemx generate${RESET} <name> [options]`,
    `  ${CYAN}npx chemx generate${RESET} <tier> <name> [options]`,
    '',
    `${BOLD}TIERS & JIG KINDS${RESET}`,
    `  ${CYAN}molecule${RESET} (m-)   Groups of atoms (no raw HTML, co-located controller)`,
    `  ${CYAN}atom${RESET} (a-)       Foundational UI elements (raw HTML permitted)`,
    `  ${CYAN}organism${RESET} (o-)   Complex feature modules`,
    `  ${CYAN}hook${RESET} (use-)     Domain state / headless composables (< 5 return properties)`,
    `  ${CYAN}view${RESET} (v-)       Declarative Table-of-Contents views`,
    `  ${CYAN}service${RESET}        Domain service / API client with Result tuples and spec`,
    `  ${CYAN}route${RESET}          HTTP API route handler with schema validation and test`,
    `  ${CYAN}store${RESET}          State store / reactive machine with discriminated unions`,
    `  ${CYAN}repo${RESET}           Database repository with CRUD methods and Result tuples`,
    `  ${CYAN}util${RESET}           Pure stateless utility functions with test spec`,
    `  ${CYAN}spec${RESET}           Isolated unit test spec for an existing target`,
    '',
    `${BOLD}OPTIONS${RESET}`,
    `  ${CYAN}--tier=<tier>${RESET}                    Specify component tier (atom, molecule, organism, hook, view)`,
    `  ${CYAN}--jig=<kind>${RESET}                     Specify programmatic file kind (service, route, store, repo, util, spec)`,
    `  ${CYAN}--framework=<react|vue|svelte>${RESET}  Framework flavor (default: auto-detected or react)`,
    `  ${CYAN}--dir=<path>${RESET}                     Target directory (default: src/components/<tier>s or src/<kind>s)`,
    `  ${CYAN}--desc="<text>"${RESET}                  Describe functionality to tailor archetype and state`,
    `  ${CYAN}--methods="<m1,m2>"${RESET}              Method names or signatures for service/repo/store`,
    `  ${CYAN}--state="<s1,s2>"${RESET}                State property definitions for store or controller`,
    `  ${CYAN}--routes="<r1,r2>"${RESET}               Route definitions for API route jig (e.g. GET /items, POST /items)`,
    `  ${CYAN}--schema="<json>"${RESET}                Structured JSON schema definition payload`,
    `  ${CYAN}--dry-run${RESET}                        Preview planned files and lines without touching disk`,
    `  ${CYAN}--lean${RESET}                           Generate minimal capsule without controller/spec`,
    `  ${CYAN}--json${RESET}                           Output result as minified JSON`,
    `  ${CYAN}-y, --yes${RESET}                        Non-interactive mode with defaults`,
    `  ${CYAN}-h, --help${RESET}                       Show this help message`,
    '',
    `${BOLD}EXAMPLES${RESET}`,
    `  ${CYAN}npx chemx generate m-task-list --framework=react${RESET}`,
    `  ${CYAN}npx chemx generate --jig=service payment-gateway --methods="processCharge,refund"${RESET}`,
    `  ${CYAN}npx chemx jig route api-orders --routes="GET /orders, POST /orders"${RESET}`,
    `  ${CYAN}npx chemx jig store session-machine --desc="user authentication lifecycle"${RESET}`,
    `  ${CYAN}npx chemx generate hook use-task-filter${RESET}`,
    `  ${CYAN}npx chemx generate view v-user-profile${RESET}`,
    '',
    `${BOLD}TOKEN ECONOMICS & AGENT JIG${RESET}`,
    `  ${DIM}Idea:          A short parameter payload to chemx generate / jig stands in for writing${RESET}`,
    `  ${DIM}               repetitive TypeScript, SCSS, and spec boilerplate by hand. The saving is${RESET}`,
    `  ${DIM}               not benchmarked.${RESET}`,
    `  ${DIM}Templates:     Result tuples, 2-stage booleans, no synthetic data,${RESET}`,
    `  ${DIM}               and co-located unit test specs, stamped from fixed templates.${RESET}`,
    '',
    `${BOLD}LINE LIMITS${RESET}`,
    `  ${DIM}${describeLineBudgetPolicy()}${RESET}`,
    `  ${DIM}Table of Contents view:     10-20 lines (declarative slot assembly)${RESET}`,
    ''
  ];

  process.stdout.write(`${out.join('\n')}\n`);
};
