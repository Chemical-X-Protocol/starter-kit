import fs from 'node:fs';
import path from 'node:path';
import { ANSI } from './theme.js';
import { withIndex } from './search-output.js';
import { STATUS, toExitCode } from './result-status.js';
import { debugNote } from './search-debug.js';
import { auditFile } from './audit-engine.js';
import {
  findSymbolDefinition,
  findSymbolReferences,
  findFileDependencies,
  findFileDependents,
  queryViolations,
  inspectIndexedFile,
  queryIndex,
  getAuditProgression,
  queryFilesByHealth
} from './search-db.js';

// `chemx def` snippet window (a read cap, not a line budget).
const DEF_SNIPPET_CAP = 40;

export const handleDefCommand = (db, targetSymbol, { index = null, isJson = false, isCli = true, isFull = false, root = process.cwd() } = {}) => {
  const def = findSymbolDefinition(db, targetSymbol);
  const isNotFound = !def;
  if (isNotFound) {
    const errorMsg = `Symbol "${targetSymbol}" not found in index${index ? ` scope ${index.scope}` : ''}.`;
    const notFound = withIndex({ status: STATUS.INCONCLUSIVE, reason: errorMsg, error: errorMsg, symbol: targetSymbol }, index);
    if (isCli) process.exitCode = toExitCode(notFound.status);
    if (isJson) {
      process.stdout.write(JSON.stringify(notFound) + '\n');
    } else {
      process.stdout.write(`  ${ANSI.GOLD}? Inconclusive: ${errorMsg}${ANSI.RESET}\n\n`);
    }
    if (isCli) process.exit();
    return null;
  }

  let snippet = '';
  const bodyLines = Math.max(1, def.endLine - def.startLine + 1);
  const isTruncated = !isFull && bodyLines > DEF_SNIPPET_CAP;
  const shownLines = isTruncated ? DEF_SNIPPET_CAP : bodyLines;
  try {
    const absPath = path.resolve(root, def.filePath);
    if (fs.existsSync(absPath)) {
      const fileLines = fs.readFileSync(absPath, 'utf-8').split('\n');
      const start = Math.max(1, def.startLine) - 1;
      const end = Math.min(fileLines.length, start + shownLines);
      snippet = fileLines.slice(start, end).join('\n');
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    snippet = `// Error reading file: ${error.message}`;
    debugNote.warn(`def snippet ${def.filePath}`, error);
  }

  const payload = {
    symbol: def.name,
    kind: def.kind,
    isExport: def.isExport,
    filePath: def.filePath,
    startLine: def.startLine,
    endLine: def.endLine,
    tier: def.tier,
    signature: def.signature,
    bodyLines,
    shownLines,
    truncated: isTruncated,
    snippet
  };
  const truncationNote = `[truncated: showing ${shownLines} of ${bodyLines} lines; use --full or chemx read ${def.filePath} --symbol=${def.name}]`;
  if (isTruncated) payload.note = truncationNote;

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
    if (isCli) process.exit();
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Definition:${ANSI.RESET} ${ANSI.BOLD}${def.name}${ANSI.RESET} ${ANSI.DIM}(${def.filePath}:${def.startLine}-${def.endLine})${ANSI.RESET}\n`);
  process.stdout.write(`  ${ANSI.MINT}Kind:${ANSI.RESET} ${def.kind} | ${ANSI.GOLD}Tier:${ANSI.RESET} ${def.tier} | ${ANSI.PINK}Export:${ANSI.RESET} ${def.isExport}\n\n`);

  const snippetLines = snippet.split('\n');
  snippetLines.forEach((line, idx) => {
    const lineNum = String(def.startLine + idx).padStart(4, ' ');
    process.stdout.write(`${ANSI.DIM}${lineNum} |${ANSI.RESET} ${line}\n`);
  });
  if (isTruncated) process.stdout.write(`${ANSI.GOLD}${truncationNote}${ANSI.RESET}\n`);
  process.stdout.write('\n');

  if (isCli) process.exit();
  return payload;
};

export const handleRefsCommand = (db, targetSymbol, { index = null, isJson = false, isCli = true } = {}) => {
  const refs = findSymbolReferences(db, targetSymbol);
  const payload = {
    symbol: targetSymbol,
    count: refs.length,
    references: refs
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
    if (isCli) process.exit();
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}References for "${targetSymbol}":${ANSI.RESET} ${ANSI.DIM}(${refs.length} found)${ANSI.RESET}\n`);
  if (refs.length === 0) {
    process.stdout.write(`  ${ANSI.DIM}No files import "${targetSymbol}".${ANSI.RESET}\n\n`);
    if (isCli) process.exit();
    return payload;
  }

  for (const ref of refs) {
    process.stdout.write(`  ${ANSI.BOLD}${ref.importerPath}:${ref.line}${ANSI.RESET} ${ANSI.DIM}from '${ref.sourceModule}'${ANSI.RESET}\n`);
  }
  process.stdout.write('\n');

  if (isCli) process.exit();
  return payload;
};

export const handleDepsCommand = (db, targetFile, { index = null, isJson = false, isCli = true } = {}) => {
  const dependencies = findFileDependencies(db, targetFile);
  const dependents = findFileDependents(db, targetFile);
  const payload = {
    target: targetFile,
    dependencyCount: dependencies.length,
    dependentCount: dependents.length,
    dependencies,
    dependents
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
    if (isCli) process.exit();
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Dependency Graph:${ANSI.RESET} ${ANSI.BOLD}${targetFile}${ANSI.RESET}\n`);
  process.stdout.write(`  ${ANSI.MINT}Upstream Dependencies (${dependencies.length}):${ANSI.RESET}\n`);
  if (dependencies.length === 0) {
    process.stdout.write(`    ${ANSI.DIM}None${ANSI.RESET}\n`);
  } else {
    for (const d of dependencies) {
      process.stdout.write(`    ${ANSI.DIM}import { ${d.importedSymbol} } from '${d.sourceModule}' (line ${d.line})${ANSI.RESET}\n`);
    }
  }

  process.stdout.write(`  ${ANSI.GOLD}Downstream Consumers (${dependents.length}):${ANSI.RESET}\n`);
  if (dependents.length === 0) {
    process.stdout.write(`    ${ANSI.DIM}None${ANSI.RESET}\n`);
  } else {
    for (const dep of dependents) {
      process.stdout.write(`    ${ANSI.BOLD}${dep.importerPath}${ANSI.RESET} ${ANSI.DIM}imports ${dep.importedSymbol} (line ${dep.line})${ANSI.RESET}\n`);
    }
  }
  process.stdout.write('\n');

  if (isCli) process.exit();
  return payload;
};

export const handlePackCommand = (db, target, { index = null, isJson = false, isCli = true } = {}) => {
  let file = inspectIndexedFile(db, target);
  if (!file) {
    const matches = queryIndex(db, { query: target, limit: 1 });
    if (matches.length > 0) file = matches[0];
  }

  if (!file) {
    const errorMsg = `Capsule or file "${target}" not found.`;
    if (isJson) {
      process.stdout.write(JSON.stringify({ error: errorMsg, target }) + '\n');
    } else {
      process.stdout.write(`  ${ANSI.DIM}${errorMsg}${ANSI.RESET}\n\n`);
    }
    if (isCli) process.exit();
    return null;
  }

  const dependencies = findFileDependencies(db, file.path);
  const dependents = findFileDependents(db, file.path);
  const hazards = queryViolations(db, { filePath: file.path });

  const pack = {
    file: {
      path: file.path,
      tier: file.tier,
      lines: file.lines,
      chars: file.chars,
      symbols: file.symbols,
      props: file.props,
      hooks: file.hooks
    },
    dependencies,
    dependents,
    hazards
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(pack, index)) + '\n');
    if (isCli) process.exit();
    return pack;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}AI Context Pack:${ANSI.RESET} ${ANSI.BOLD}${file.path}${ANSI.RESET} ${ANSI.DIM}[${file.tier}] (${file.lines} lines)${ANSI.RESET}\n`);
  process.stdout.write(`  ${ANSI.MINT}Symbols:${ANSI.RESET} ${file.symbols.map((s) => s.name).join(', ') || 'none'}\n`);
  process.stdout.write(`  ${ANSI.GOLD}Dependencies:${ANSI.RESET} ${dependencies.length} upstream imports\n`);
  process.stdout.write(`  ${ANSI.PINK}Dependents:${ANSI.RESET} ${dependents.length} downstream consumers\n`);
  process.stdout.write(`  ${ANSI.RED}Open Hazards:${ANSI.RESET} ${hazards.length}\n\n`);

  if (isCli) process.exit();
  return pack;
};

const resolveGradeColor = (score) => {
  if (score >= 90) return ANSI.LIME;
  if (score >= 80) return ANSI.CYAN;
  return ANSI.GOLD;
};

const resolveHealthScoreColor = (score) => {
  if (score >= 90) return ANSI.LIME;
  if (score >= 70) return ANSI.GOLD;
  return ANSI.RED;
};

export const handleProgressionCommand = (db, { index = null, isJson = false, isCli = true } = {}) => {
  const history = getAuditProgression(db, 15);
  const payload = {
    count: history.length,
    progression: history
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
    if (isCli) process.exit();
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Chemical X Health Progression:${ANSI.RESET} ${ANSI.DIM}(${history.length} snapshots in SQLite)${ANSI.RESET}\n`);
  if (history.length === 0) {
    process.stdout.write(`  ${ANSI.DIM}No audit snapshots recorded yet. Run an audit to log your baseline.${ANSI.RESET}\n\n`);
    if (isCli) process.exit();
    return payload;
  }

  for (const s of history) {
    const dateStr = new Date(s.timestamp).toLocaleTimeString();
    const gradeColor = resolveGradeColor(s.score);
    process.stdout.write(`  ${ANSI.DIM}[${dateStr}]${ANSI.RESET} ${gradeColor}${s.score}/100 [Grade: ${s.grade}]${ANSI.RESET} | ${ANSI.MINT}ASI: ${s.asi}/100${ANSI.RESET} | ${ANSI.RED}${s.criticalCount} Crit${ANSI.RESET} | ${ANSI.GOLD}${s.highMedCount} Med${ANSI.RESET} | ${ANSI.DIM}${s.totalLoc}L (${s.scannedFiles} files)${ANSI.RESET}\n`);
  }
  process.stdout.write('\n');

  if (isCli) process.exit();
  return payload;
};

export const handleHealthFilterCommand = (db, status, { index = null, isJson = false, isCli = true } = {}) => {
  const files = queryFilesByHealth(db, { status, limit: 100 });
  const payload = {
    filter: status,
    count: files.length,
    files
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
    if (isCli) process.exit();
    return payload;
  }

  const title = status === 'failing' ? 'Degraded Files Requiring Attention' : 'Crystalline Verified Components (Grade A+)';
  const headerColor = status === 'failing' ? ANSI.GOLD : ANSI.LIME;

  process.stdout.write(`\n${ANSI.BOLD}${headerColor}${title}:${ANSI.RESET} ${ANSI.DIM}(${files.length} files)${ANSI.RESET}\n`);
  if (files.length === 0) {
    const emptyMsg = status === 'failing'
      ? 'Outstanding! Zero degraded files found. All files are crystalline.'
      : 'No crystalline files recorded.';
    process.stdout.write(`  ${ANSI.LIME}✔ ${emptyMsg}${ANSI.RESET}\n\n`);
    if (isCli) process.exit();
    return payload;
  }

  for (const f of files) {
    const scoreColor = resolveHealthScoreColor(f.healthScore);
    const hazardBadge = f.hazardCount > 0 ? `${ANSI.RED}[${f.hazardCount} hazards]${ANSI.RESET} ` : `${ANSI.LIME}[clean]${ANSI.RESET} `;
    process.stdout.write(`  ${scoreColor}${String(f.healthScore).padStart(3, ' ')}/100${ANSI.RESET} ${hazardBadge}${ANSI.BOLD}${f.path}${ANSI.RESET} ${ANSI.DIM}(${f.lines} lines, ${f.tier})${ANSI.RESET}\n`);
  }
  process.stdout.write('\n');

  if (isCli) process.exit();
  return payload;
};

/** options.config: a loaded project config (e.g. with --profile applied); defaults to the cwd's config. */
export const handleCheckCommand = (targetFile, { index = null, isJson = false, isCli = true, config = null } = {}) => {
  const startTime = Date.now();
  if (!targetFile) {
    const errorMsg = 'Please specify a target file to check. Example: chemx check src/components/m-card.vue';
    if (isJson && isCli) {
      process.stdout.write(JSON.stringify({ error: errorMsg, success: false }) + '\n');
    } else if (isCli) {
      process.stderr.write(`\x1b[31m✕ ${errorMsg}\x1b[0m\n`);
    }
    if (isCli) process.exit(1);
    return { error: errorMsg, success: false };
  }

  const absPath = path.resolve(process.cwd(), targetFile);
  if (!fs.existsSync(absPath)) {
    const errorMsg = `File not found: ${targetFile}`;
    if (isJson && isCli) {
      process.stdout.write(JSON.stringify({ error: errorMsg, success: false }) + '\n');
    } else if (isCli) {
      process.stderr.write(`\x1b[31m✕ ${errorMsg}\x1b[0m\n`);
    }
    if (isCli) process.exit(1);
    return { error: errorMsg, success: false };
  }

  const relPath = path.relative(process.cwd(), absPath);
  const violations = auditFile(absPath, relPath, config ? { config } : {});
  const durationMs = Date.now() - startTime;

  const criticalCount = violations.filter((v) => v.severity === 'CRITICAL').length;
  const highMedCount = violations.filter((v) => ['HIGH', 'MEDIUM'].includes(v.severity)).length;
  const isClean = violations.length === 0;

  const payload = {
    file: relPath,
    isClean,
    durationMs,
    violationsCount: violations.length,
    criticalCount,
    highMedCount,
    violations
  };

  if (isJson) {
    if (isCli) {
      process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
      process.exit(isClean ? 0 : 1);
    }
    return payload;
  }

  if (isClean) {
    process.stdout.write(`\n${ANSI.BOLD}${ANSI.LIME}✔ Crystalline:${ANSI.RESET} ${relPath} ${ANSI.DIM}(0 hazards, ${durationMs}ms)${ANSI.RESET}\n\n`);
    if (isCli) process.exit();
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.GOLD}Chemical X Micro-Check:${ANSI.RESET} ${ANSI.BOLD}${relPath}${ANSI.RESET} ${ANSI.DIM}(${durationMs}ms)${ANSI.RESET}\n`);
  process.stdout.write(`  ${ANSI.RED}💥 ${criticalCount} Critical${ANSI.RESET} | ${ANSI.GOLD}🔥 ${highMedCount} High/Med${ANSI.RESET}\n\n`);

  for (const v of violations) {
    const color = v.severity === 'CRITICAL' ? ANSI.RED : ANSI.GOLD;
    process.stdout.write(`  ${color}[${v.severity}]${ANSI.RESET} Line ${v.line}: ${v.rule}\n`);
    process.stdout.write(`    ${ANSI.DIM}Hazard: ${v.hazard}${ANSI.RESET}\n`);
    if (v.directive) {
      process.stdout.write(`    ${ANSI.CYAN}Directive: ${v.directive}${ANSI.RESET}\n`);
    }
  }
  process.stdout.write('\n');

  if (isCli) process.exit(1);
  return payload;
};

export {
  handleBlastRadiusCommand,
  handleCallTraceCommand,
  handleBacktraceCommand,
  runTraceCli,
  runBacktraceCli
} from './search-commands-graph.js';
export { handleSemanticCommand, handleHybridCommand } from './search-commands-semantic.js';
export { handleHazardsCommand } from './search-commands-hazards.js';
export { handleLiteralSearchCommand } from './search-commands-literal.js';



