/**
 * Host shims: short generated pointers from each agent host's entry file to AGENTS.md.
 * AGENTS.md is hand-authored and canonical. Shims carry host invocation syntax only and
 * never restate a threshold, so they cannot contradict the rulebook.
 */

import { PILLARS } from './pillars-schema.js';
import { GENERATED_MARKERS } from './pillars-write-guard.js';

export const HOST_SHIM_FILES = ['CLAUDE.md', '.cursorrules', 'llms.txt'];
export const SHIM_TOKEN_BUDGET = 400;

const CANONICAL_NOTE = 'AGENTS.md is the canonical rulebook. Every architectural rule and threshold lives there; this generated file only points at it. Regenerate with `npx chemx pillars --write` instead of editing it.';

const activePillarLine = (selectedPillarIds) => {
  const titles = PILLARS
    .filter((p) => selectedPillarIds.includes(p.id) || selectedPillarIds.includes(p.key))
    .map((p) => p.title.replace(/^Pillar \d+:\s*/, ''));
  return `Active pillars: ${titles.join(', ')}.`;
};

const buildClaudeMd = (pillarLine) => [
  GENERATED_MARKERS.md,
  '# Claude Code: Chemical X',
  '',
  CANONICAL_NOTE,
  '',
  pillarLine,
  '',
  '## Invocation',
  "- Checks go through the `chemx` MCP tool (server `chemical-x`): `chemx({ action: 'verify' })`, `'test'`, `'typecheck'`. Never run raw `npm test` or `tsc --noEmit`.",
  "- Mutating calls (`write`, `patch`, `autofix`, `generate`, team claims and posts) need `params.projectRoot` set to the absolute repo path.",
  "- Fast token-bounded wrappers: `chemx d` (diff), `chemx log` (oneline), `chemx p` (package.json), `chemx j` (json schema), `chemx do` (batch).",
  "- Search before reading: `chemx({ action: 'q', params: { query } })` (AST) or `chemx q -g <pattern>` (literal search).",
  "- Read narrowly: `chemx({ action: 'read', params: { path, symbol } })` or `outline: true`. Use `enrich: true` on component capsules only; procedural modules gain little from it.",
  '- Without MCP: `chemx verify`, `chemx read <path> --outline`, `chemx d`.'
].join('\n') + '\n';

const buildCursorRules = (pillarLine) => [
  GENERATED_MARKERS.rules,
  '# Cursor: Chemical X',
  CANONICAL_NOTE,
  pillarLine,
  "Run checks through the chemx MCP tool (chemx({ action: 'verify' })) or `chemx verify`; never raw `npm test` or `tsc --noEmit`.",
  "Fast token-bounded wrappers: `chemx d` (diff), `chemx log` (oneline), `chemx p` (package.json), `chemx j` (json schema), `chemx do` (batch).",
  "Search: `chemx q <query>` (AST) or `chemx q -g <pattern>` (literal search).",
  'Pass params.projectRoot (absolute repo path) on mutating chemx MCP calls.',
  'Read with `chemx read <path> --outline` or `--symbol=<name>`; reserve `--enrich` for component capsules.'
].join('\n') + '\n';

const buildLlmsTxt = (pillarLine, projectName) => [
  `# ${projectName}`,
  '',
  '> Agent directives for this project, built on the Chemical X architecture toolkit.',
  '',
  CANONICAL_NOTE,
  '',
  pillarLine,
  '',
  '## Rules',
  '- [AGENTS.md](./AGENTS.md): canonical architecture rules and thresholds.',
  '',
  '## Invocation',
  "- MCP: one tool, `chemx({ action, params })`. Mutating actions need `params.projectRoot`.",
  '- CLI: `chemx verify`, `chemx audit --json`, `chemx q "<query>"` (AST), `chemx q -g "<pattern>"` (literal), `chemx d` (diff), `chemx read <path> --outline`.',
  '',
  GENERATED_MARKERS.md
].join('\n') + '\n';

export const buildHostShims = (selectedPillarIds = [], { projectName = 'Project' } = {}) => {
  const pillarLine = activePillarLine(selectedPillarIds);
  return {
    'CLAUDE.md': buildClaudeMd(pillarLine),
    '.cursorrules': buildCursorRules(pillarLine),
    'llms.txt': buildLlmsTxt(pillarLine, projectName)
  };
};
