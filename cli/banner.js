import { spawnSync } from "node:child_process";
import { formatChemicalXGradient, ANSI } from "./theme.js";
import { hasGum, isStdoutTty } from "./terminal.js";

// Presentation layer (studio side of the core/studio seam): import only when a human
// terminal will see the output. Piped and --json runs never load it (seam.spec.js).

const SUBTITLE = "The Secret Sauce to Vibe Coding";
const RULE = "=====================================================";

export const renderBanner = (title = "Chemical X Protocol: Molecular Architecture") => {
  const isHumanTerminal = isStdoutTty();
  if (!isHumanTerminal) return;

  if (hasGum()) {
    spawnSync(
      "gum",
      [
        "style",
        "--border=normal",
        "--margin=1",
        "--padding=1 2",
        "--border-foreground=45",
        "--foreground=81",
        "--bold",
        `  ${title}\n  ${SUBTITLE} | Zero-Context-Rot Directives`
      ],
      { stdio: "inherit" }
    );
    return;
  }

  process.stdout.write(`\n${formatChemicalXGradient(RULE)}\n`);
  process.stdout.write(`  ${formatChemicalXGradient(title)}\n`);
  process.stdout.write(`  ${ANSI.BOLD}${ANSI.GOLD}${SUBTITLE}!${ANSI.RESET} ${ANSI.DIM}| Zero-Context-Rot Directives${ANSI.RESET}\n`);
  process.stdout.write(`${formatChemicalXGradient(RULE)}\n\n`);
};
