/**
 * tesseract.js: Chemical X Tesseract Cognitive Bridge CLI.
 * Single responsibility: Orchestrate live state, HUD, and Jarvis directives.
 */

import { ANSI } from './theme.js';
import { renderHudHeader, renderMetricPill } from './tesseract-hud.js';
import { renderManifesto } from './tesseract-manifesto.js';
import { buildLatticePayload, runLatticeJson } from './lattice-payload.js';
import { formatIndexLine } from './search-output.js';

const formatTierSummary = (tiers) => {
  const tierEntries = Object.entries(tiers);
  const hasTiers = tierEntries.length > 0;
  if (!hasTiers) return `${ANSI.DIM}No indexed architectural tiers detected.${ANSI.RESET}`;
  return tierEntries
    .map(([tier, count]) => renderMetricPill(tier.toUpperCase(), count, ANSI.PINK))
    .join(' ');
};

const formatHudTelemetry = (state) => {
  const { stats, tiers, swarm } = state;
  const B = ANSI.BOLD;
  const C = ANSI.CYAN;
  const G = ANSI.GOLD;
  const R = ANSI.RESET;
  const D = ANSI.DIM;

  const filesPill = renderMetricPill('FILES', stats.totalFiles, ANSI.CYAN);
  const symsPill = renderMetricPill('SYMBOLS', stats.totalSymbols, ANSI.CYAN);
  const propsPill = renderMetricPill('PROPS', stats.totalProps, ANSI.MINT);
  const hooksPill = renderMetricPill('HOOKS', stats.totalHooks, ANSI.MINT);
  const hazardsPill = renderMetricPill('HAZARDS', stats.totalViolations, stats.totalViolations > 0 ? ANSI.RED : ANSI.LIME);

  const swarmDesc = swarm
    ? `Agents: ${swarm.agents.total} (${swarm.agents.busy} active) | Tasks: ${swarm.tasks.queued} queued, ${swarm.tasks.in_progress} running, ${swarm.tasks.done} done | Locks: ${swarm.locks.active}`
    : 'Swarm database idle (.chemx/index.db)';

  return [
    `${B}${C}AST COGNITIVE LATTICE METRICS:${R}`,
    `  ${filesPill} ${symsPill} ${propsPill} ${hooksPill} ${hazardsPill}`,
    '',
    `${B}${C}ARCHITECTURAL TIER DISTRIBUTION:${R}`,
    `  ${formatTierSummary(tiers)}`,
    '',
    `${B}${G}SWARM CONSCIOUSNESS & TELEMETRY:${R}`,
    `  ${D}${swarmDesc}${R}`,
    ''
  ].join('\n');
};

export const runTesseract = async (args = [], isCli = false, cwd = process.cwd()) => {
  const isJson = args.includes('--json');
  if (isJson) return runLatticeJson(isCli, cwd);

  const payload = buildLatticePayload(cwd);
  const hud = renderHudHeader();
  const telemetry = formatHudTelemetry(payload.state);
  const manifesto = renderManifesto();
  const indexLine = payload.state?.index ? `# ${formatIndexLine(payload.state.index)}` : '';
  const fullOutput = [hud, telemetry, manifesto, indexLine, ''].join('\n');

  if (isCli) {
    process.stdout.write(fullOutput);
  }

  return { payload, text: fullOutput };
};
