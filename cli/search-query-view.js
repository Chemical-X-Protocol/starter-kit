// Output for the default `chemx q <query>`: ranked hits as `path:line`, the definition marked,
// and an explicit "showing N of M" whenever the page is truncated.
import { ANSI } from './theme.js';
import { toColumnar } from './columnar.js';
import { withIndex, formatIndexLine } from './search-output.js';

const TIER_COLORS = {
  atom: ANSI.LIME, molecule: ANSI.CYAN, organism: ANSI.PURPLE, template: ANSI.GOLD,
  view: ANSI.PINK, hook: ANSI.MINT, type: ANSI.DIM
};

const formatTierBadge = (tier) => `${TIER_COLORS[tier] || ANSI.DIM}[${tier}]${ANSI.RESET}`;

const formatMatch = (r) => {
  const match = r.match || {};
  const hasLine = Boolean(match.line);
  const location = hasLine ? `${r.path}:${match.line}` : r.path;
  const isDefinition = match.type === 'definition';
  const label = isDefinition ? `${ANSI.LIME}definition${ANSI.RESET}` : `${ANSI.DIM}${match.type || 'match'}${ANSI.RESET}`;
  const name = match.name ? ` ${ANSI.CYAN}${match.name}${ANSI.RESET}` : '';
  return `  ${formatTierBadge(r.tier)} ${ANSI.BOLD}${location}${ANSI.RESET} ${label}${name} ${ANSI.DIM}(${r.lines} lines)${ANSI.RESET}`;
};

const formatInspect = (r) => {
  const lines = [`\n  ${formatTierBadge(r.tier)} ${ANSI.BOLD}${r.path}${ANSI.RESET} ${ANSI.DIM}(${r.lines} lines, ${r.chars} chars)${ANSI.RESET}`];
  const hasSymbols = r.symbols.length > 0;
  if (hasSymbols) lines.push(`    ${ANSI.MINT}Symbols:${ANSI.RESET} ${r.symbols.map((s) => `${s.name}${s.isExport ? '*' : ''}`).join(', ')}`);
  const hasProps = r.props.length > 0;
  if (hasProps) lines.push(`    ${ANSI.GOLD}Props:${ANSI.RESET} ${r.props.map((p) => p.name).join(', ')}`);
  const hasHooks = r.hooks.length > 0;
  if (hasHooks) lines.push(`    ${ANSI.PURPLE}Hooks:${ANSI.RESET} ${r.hooks.join(', ')}`);
  return lines.join('\n');
};

export const buildQueryPayload = (page, { query, tier, durationMs, isColumnar, index }) => {
  const base = { query, tier, count: page.results.length, total: page.total, truncated: page.truncated, limit: page.limit, durationMs };
  if (isColumnar) {
    const columnar = toColumnar(page.results, ['path', 'line', 'match', 'name', 'tier', 'lines'], {
      line: (r) => r.match?.line ?? null,
      match: (r) => r.match?.type ?? null,
      name: (r) => r.match?.name ?? null
    });
    return withIndex({ ...base, format: 'columnar', cols: columnar.cols, rows: columnar.rows }, index);
  }
  const suggestion = page.total === 0 ? `chemx q -g "${query}"` : undefined;
  return withIndex({ ...base, suggestion, results: page.results }, index);
};

export const printQueryPage = (page, { query, durationMs, isInspect, index }) => {
  const out = [];
  const shown = page.results.length;
  const countText = page.truncated ? `showing ${shown} of ${page.total}` : `${page.total} results`;
  out.push(`\n${ANSI.BOLD}${ANSI.CYAN}Chemical X Query:${ANSI.RESET} "${query}" ${ANSI.DIM}(${countText} in ${durationMs}ms)${ANSI.RESET}`);
  out.push(`  ${ANSI.DIM}${formatIndexLine(index)}${ANSI.RESET}`);
  const hasNoResults = shown === 0;
  if (hasNoResults) {
    out.push(`  ${ANSI.DIM}No matching capsules, symbols, or files in this scope for "${query}".${ANSI.RESET}`);
    out.push(`  ${ANSI.CYAN}Try literal search across the repo: chemx q -g "${query}"${ANSI.RESET}\n`);
    process.stdout.write(out.join('\n') + '\n');
    return;
  }
  for (const r of page.results) out.push(isInspect ? formatInspect(r) : formatMatch(r));
  if (page.truncated) out.push(`\n  ${ANSI.GOLD}Truncated: ${page.total - shown} more. Use -n <num> to see more.${ANSI.RESET}`);
  out.push(`\n  ${ANSI.DIM}Tip: --inspect for props/hooks, --json for agents.${ANSI.RESET}\n`);
  process.stdout.write(out.join('\n') + '\n');
};
