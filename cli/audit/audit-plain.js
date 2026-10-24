// Plain-text audit card for pipes, CI logs and agents: the facts of the dashboard banner
// without ASCII art, borders or color. Input is buildAuditSummary() output.

const formatGate = (gate) => {
  const isUnknown = gate.passing === null;
  if (isUnknown) return 'gate: not evaluated';
  const verdict = gate.passing ? 'pass' : 'fail';
  const basis = gate.basis ? ` (${gate.basis})` : '';
  const note = gate.note ? `: ${gate.note}` : '';
  return `gate: ${verdict}${basis}${note}`;
};

// One line per language, only when more than one language was scanned.
const formatLanguageLines = (coverage) => {
  const entries = Object.entries(coverage?.byLanguage ?? {});
  const isMultiLanguage = entries.length > 1;
  if (!isMultiLanguage) return [];
  return entries.map(([language, c]) => `  ${language}: ${c.files} files, ${c.ast} ast, ${c.textOnly} text-only, ${c.parseErrors} parse errors`);
};

export const formatPlainAuditSummary = (summary) => {
  const { critical, highMedium, low } = summary.hazards;
  const total = critical + highMedium + low;
  const lines = [
    `chemx audit ${summary.scope}: grade ${summary.health.grade} (${summary.health.score}/100), ${total} hazards: ${critical} critical, ${highMedium} high/medium, ${low} low`,
    `${summary.files} files, ${summary.loc.toLocaleString('en-US')} LOC, ~${summary.tokens.estimate.toLocaleString('en-US')} tokens`,
    formatGate(summary.gate)
  ];
  for (const { rule, baseline, current } of summary.gate.regressions ?? []) {
    lines.push(`  regression: ${rule} ${baseline} -> ${current}`);
  }
  lines.push(...formatLanguageLines(summary.coverage));
  lines.push('detail: chemx audit --json | chemx audit --unroll | chemx q --hazards');
  return `${lines.join('\n')}\n`;
};
