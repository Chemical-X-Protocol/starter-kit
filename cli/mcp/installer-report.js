/** Status predicates and console reporting for the MCP config installer. */
import path from 'node:path';

export const isRefusedEntry = (result) => result.status === 'refused';
export const isSkippedEntry = (result) => result.status === 'skipped';
export const isWrittenEntry = (result) => result.status === 'written';
export const isAppliedEntry = (result) => Boolean(result) && !isRefusedEntry(result) && !isSkippedEntry(result);

const displayPath = (file) => path.basename(path.dirname(file)) + '/' + path.basename(file);

export const reportEntry = (result, label, isSilent) => {
  if (isSilent) return;
  const rel = displayPath(result.file);
  const isNotApplied = isRefusedEntry(result) || isSkippedEntry(result);
  if (isNotApplied) { process.stderr.write(`  \x1b[33m⚠\x1b[0m Skipped ${label} (${rel}): ${result.reason}\n`); return; }
  const verb = result.status === 'unchanged' ? 'Already configured' : 'Configured';
  process.stdout.write(`  \x1b[32m✔\x1b[0m ${verb} ${label} MCP server in: ${rel}\n`);
};

export const reportPackageScripts = (result, isSilent) => {
  const isWritten = isWrittenEntry(result);
  const shouldAnnounce = isWritten && !isSilent;
  if (shouldAnnounce) process.stdout.write('  \x1b[32m✔\x1b[0m Added chemx verification & MCP scripts to package.json\n');
  const shouldWarn = isRefusedEntry(result) && !isSilent;
  if (shouldWarn) process.stderr.write(`  \x1b[33m⚠\x1b[0m Skipped package.json scripts: ${result.reason}\n`);
};

/** Path relative to the project, or absolute for files outside it (the home directory). */
const projectPath = (base, file) => {
  const rel = path.relative(base, file);
  const isOutsideProject = rel.startsWith('..') || path.isAbsolute(rel);
  return isOutsideProject ? file : rel;
};

export const summarizeInstall = (base, { refused, skipped, written }) => {
  const hasRefusals = refused.length > 0;
  const hasPartialApply = hasRefusals && written.length > 0;
  if (hasPartialApply) {
    const wrote = written.map((file) => projectPath(base, file)).join(', ');
    const left = refused.map((r) => projectPath(base, r.file)).join(', ');
    return `\x1b[33m⚠ Partial apply: wrote ${wrote}; refused ${left} (see above).\x1b[0m`;
  }
  if (hasRefusals) return '\x1b[33m⚠ Chemical X MCP server not configured in refused files (see above).\x1b[0m';
  const hasSkips = skipped.length > 0;
  if (hasSkips) return '\x1b[33m⚠ Chemical X MCP server configured, but some requested targets were skipped (see above).\x1b[0m';
  return '\x1b[1m\x1b[32m✔ Chemical X MCP server configured.\x1b[0m';
};
