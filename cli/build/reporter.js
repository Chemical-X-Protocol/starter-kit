import { ANSI } from '../theme.js';

const formatDiagnosticItem = (item) => {
  const loc = item.file
    ? `${ANSI.CYAN}${item.file}${item.line ? `:${item.line}` : ''}${item.column ? `:${item.column}` : ''}${ANSI.RESET}`
    : `${ANSI.DIM}unknown location${ANSI.RESET}`;
  const codeTag = item.code ? ` ${ANSI.DIM}[${item.code}]${ANSI.RESET}` : '';
  const hint = item.suggestion ? `\n    ${ANSI.MINT}↳ Hint: ${item.suggestion}${ANSI.RESET}` : '';
  return `  • ${loc}${codeTag} ${item.message}${hint}`;
};

const formatCategoryGroup = (category, items) => {
  const title = `${ANSI.BOLD}${ANSI.PINK}[${category}]${ANSI.RESET} ${ANSI.DIM}(${items.length})${ANSI.RESET}`;
  const lines = items.map(formatDiagnosticItem);
  return `${title}\n${lines.join('\n')}`;
};

export const formatTerminalBuildReport = (report, options = {}) => {
  const isSilent = Boolean(options.silent);
  const durationSec = (report.durationMs / 1000).toFixed(2);

  if (report.success) {
    if (isSilent) return '';
    const successHeader = `${ANSI.BOLD}${ANSI.LIME}✔ Build Succeeded${ANSI.RESET} ${ANSI.DIM}(${durationSec}s)${ANSI.RESET}`;
    if (report.counts.warnings === 0) return `${successHeader}\n`;

    const warningLines = report.diagnostics
      .filter((d) => d.severity === 'WARNING')
      .map(formatDiagnosticItem)
      .join('\n');
    return `${successHeader}\n${ANSI.GOLD}Warnings (${report.counts.warnings}):${ANSI.RESET}\n${warningLines}\n`;
  }

  const out = [];
  out.push(`${ANSI.BOLD}\x1b[31m✕ Build Failed${ANSI.RESET} ${ANSI.DIM}(exit code ${report.exitCode}, ${durationSec}s)${ANSI.RESET}`);
  out.push(`${ANSI.DIM}Command: ${report.command}${ANSI.RESET}\n`);

  if (report.diagnostics.length > 0) {
    const grouped = {};
    for (const d of report.diagnostics) {
      if (!grouped[d.category]) grouped[d.category] = [];
      grouped[d.category].push(d);
    }
    for (const [cat, items] of Object.entries(grouped)) {
      out.push(formatCategoryGroup(cat, items));
      out.push('');
    }
  } else if (report.rawTail.length > 0) {
    out.push(`${ANSI.BOLD}${ANSI.GOLD}[UNCATALOGED BUILD OUTPUT]${ANSI.RESET}`);
    for (const line of report.rawTail) {
      out.push(`  ${ANSI.DIM}${line}${ANSI.RESET}`);
    }
    out.push('');
  }

  out.push(
    `${ANSI.BOLD}Audit Summary:${ANSI.RESET} ${report.counts.errors} error(s), ${report.counts.warnings} warning(s) across ${report.counts.files} file(s).`
  );
  out.push(`${ANSI.DIM}Tip: Run with --json to emit structured machine-readable diagnostics for AI agents.${ANSI.RESET}\n`);

  return out.join('\n');
};

export const formatJsonBuildReport = (report) => {
  return JSON.stringify(report, null, 2);
};
