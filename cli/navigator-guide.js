import { ANSI } from './theme.js';
import { describeLineBudgetPolicy } from './config/profiles.js';

export const formatSystemGuide = () => {
  const CYAN = '\x1b[36m';
  const BOLD = '\x1b[1m';
  const GREEN = '\x1b[32m';
  const GOLD = '\x1b[38;5;220m';
  const PINK = '\x1b[38;2;244;114;182m';
  const LIME = '\x1b[38;2;74;222;128m';
  const SKY = '\x1b[38;2;56;189;248m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';

  const lines = [
    `${BOLD}${SKY}╔════════════════════════════════════════════════════════════════════════════════════╗${RESET}`,
    `${BOLD}${SKY}║        ⚡ CHEMICAL X: MOLECULAR ARCHITECTURE & AI AGENT GUIDE ⚡                    ║${RESET}`,
    `${BOLD}${SKY}║               "Clean, literate code that reads like poetry"                        ║${RESET}`,
    `${BOLD}${SKY}╚════════════════════════════════════════════════════════════════════════════════════╝${RESET}`,
    '',
    `${BOLD}${GOLD}1. WHY CHEMICAL X? (THE CORE VISION)${RESET}`,
    `  ${DIM}──────────────────────────────────────────────────────────────────────────────────${RESET}`,
    `  Traditional monoliths fail in the AI era. A 1,000-line file degrades LLM reasoning,`,
    `  triggers hallucinated imports, costs thousands of wasted context tokens per edit, and`,
    `  leads to fragile, tangled state.`,
    '',
    `  Chemical X enforces ${BOLD}Crystalline Molecular Capsules${RESET} (${describeLineBudgetPolicy()}):`,
    `    • ${LIME}Atom [a-]${RESET}      Single, raw HTML foundation (only tier allowed raw DOM like <button>)`,
    `    • ${CYAN}Molecule [m-]${RESET}  Composed blocks (mixin-only styles, zero raw DOM tags)`,
    `    • ${PINK}Organism [o-]${RESET}  Feature-level domain orchestration assembled from molecules`,
    `    • ${GOLD}View [v-]${RESET}      10-to-20 line declarative Table of Contents assembling components`,
    '',
    `${BOLD}${GOLD}2. THE 4 SYSTEM SUPERPOWERS (BEYOND A LINTER)${RESET}`,
    `  ${DIM}──────────────────────────────────────────────────────────────────────────────────${RESET}`,
    `  ${BOLD}${LIME}⚡ Smaller Reads (26–97% per read in the 2026-10-09 benchmark)${RESET}`,
    `     AI agents read AST outlines instead of dumping whole files into context; run`,
    `     pnpm bench for the measured savings on this kit.`,
    '',
    `  ${BOLD}${SKY}🧠 Codebase SQLite Index Database (.chemx/index.db)${RESET}`,
    `     Powered by SQLite WAL mode and FTS5 token search. Indexes every symbol, prop, hook,`,
    `     and architecture tier. Agents query with ${CYAN}chemx q <symbol>${RESET} from the index without scanning files (a CLI call took 0.7-0.9s on 2026-10-09, mostly process start).`,
    '',
    `  ${BOLD}${PINK}🛡️ 25-Year Senior Coding Guardrails${RESET}`,
    `     Flags traps that ordinary linters often miss:`,
    `     • ${BOLD}Security${RESET}: Unsanitized HTML injection (v-html / dangerouslySetInnerHTML), secret leaks`,
    `     • ${BOLD}Timers${RESET}: Render-hack setTimeout(0) race conditions and unscoped setInterval leaks`,
    `     • ${BOLD}Control Flow${RESET}: Nested ternaries in templates and multi-clause boolean soup`,
    `     • ${BOLD}Integrity${RESET}: Synthetic mock data (john@gmail.com) and fake green test assertions`,
    `     • ${BOLD}Architecture${RESET}: Raw DOM in molecules and files over the profile line budget`,
    '',
    `  ${BOLD}${CYAN}🎯 Surgical Micro-Patcher & Continuous Re-Indexing${RESET}`,
    `     Exact hunk-based patching (chemx_patch) eliminates line drift. Automatically`,
    `     re-indexes the SQLite symbol database in 2ms upon write, giving real-time compliance.`,
    '',
    `${BOLD}${GOLD}3. YOUR 4-STEP QUICKSTART ROADMAP${RESET}`,
    `  ${DIM}──────────────────────────────────────────────────────────────────────────────────${RESET}`,
    `  ${BOLD}${GREEN}Step 1. Install Pre-Commit & CI Hooks${RESET}  ${DIM}(Option [Guardrails] under Setup)${RESET}`,
    `          Enforce AGENTS.md architecture rules and block critical hazards before commits.`,
    '',
    `  ${BOLD}${GREEN}Step 2. Equip AI Agents with Query Tool${RESET} ${DIM}(Option [Query Index] under Setup)${RESET}`,
    `          Adds a "chemx" package script so agents run "chemx q", and primes the SQLite`,
    `          query index. Setup rows disappear from the menu once installed.`,
    '',
    `  ${BOLD}${GREEN}Step 3. Run the Self-Healing Roadmap${RESET}    ${DIM}(Option [Roadmap] in menu)${RESET}`,
    `          Generates optimal remediation order and one-click refactoring prompts for`,
    `          Cursor, Windsurf, or Claude to slice monoliths into crystalline molecules.`,
    '',
    `  ${BOLD}${GREEN}Step 4. Connect Model Context Protocol${RESET}  ${DIM}(Run: npx chemx mcp)${RESET}`,
    `          Give AI agents direct tool calls (chemx_q, chemx_read, chemx_patch, chemx_check)`,
    `          to query, inspect, and safely patch your codebase end-to-end.`,
    ''
  ];

  return lines.join('\n');
};
