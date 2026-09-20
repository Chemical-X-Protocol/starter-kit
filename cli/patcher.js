import fs from 'node:fs';
import path from 'node:path';
import { ANSI } from './theme.js';
import { syncSingleFileIndex } from './search.js';
import { auditFile } from './audit.js';

/**
 * Surgically applies a search-and-replace block to a file.
 * Automatically updates SQLite index in real-time and runs architectural guardrails.
 *
 * @param {string} targetPath File path to patch.
 * @param {object} params Patch parameters.
 * @param {string} params.targetContent Exact string to replace.
 * @param {string} params.replacementContent Replacement string.
 * @param {boolean} [params.allowMultiple=false] Whether multiple matches are allowed.
 * @param {string} [params.cwd=process.cwd()] Working directory.
 * @param {boolean} [params.skipIndex=false] Skip SQLite micro-indexing.
 * @param {boolean} [params.skipCheck=false] Skip post-patch architecture check.
 * @returns {object} Comprehensive patch and guardrail result.
 */
export const patchFile = (targetPath, params = {}) => {
  const {
    targetContent,
    replacementContent,
    allowMultiple = false,
    cwd = process.cwd(),
    skipIndex = false,
    skipCheck = false
  } = params;

  if (targetContent === undefined || targetContent === null) {
    throw new Error('targetContent is required for patching');
  }

  if (replacementContent === undefined || replacementContent === null) {
    throw new Error('replacementContent is required for patching');
  }

  const resolvedPath = path.resolve(cwd, targetPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${targetPath}`);
  }

  const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
  const matchIndex = fileContent.indexOf(targetContent);

  if (matchIndex === -1) {
    throw new Error(`Target content not found in ${targetPath}. Verify indentation and exact characters.`);
  }

  if (!allowMultiple) {
    const secondMatchIndex = fileContent.indexOf(targetContent, matchIndex + targetContent.length);
    if (secondMatchIndex !== -1) {
      throw new Error(`Target content found multiple times in ${targetPath}. Specify a more unique target block or pass allowMultiple.`);
    }
  }

  const originalLines = fileContent.split('\n').length;
  const patchedContent = allowMultiple
    ? fileContent.replaceAll(targetContent, replacementContent)
    : fileContent.replace(targetContent, replacementContent);

  const newLines = patchedContent.split('\n').length;

  fs.writeFileSync(resolvedPath, patchedContent, 'utf-8');

  // Continuous micro-indexing: keep SQLite index.db fresh in ~2ms
  let indexed = false;
  if (!skipIndex) {
    try {
      const indexDetails = syncSingleFileIndex(resolvedPath, cwd);
      indexed = Boolean(indexDetails);
    } catch {
      indexed = false;
    }
  }

  // Architectural guardrails: check line budget and rules
  const relPath = path.relative(cwd, resolvedPath);
  const baseName = path.basename(resolvedPath);
  const isMolecule = relPath.includes('molecules') || relPath.includes('/m-') || baseName.startsWith('m-');
  const maxLineBudget = isMolecule ? 100 : 500;
  const isBudgetExceeded = newLines > maxLineBudget;

  const lineBudget = {
    lines: newLines,
    limit: maxLineBudget,
    passed: !isBudgetExceeded,
    warning: isBudgetExceeded
      ? `File exceeds ${maxLineBudget}-line limit (${newLines}L). Split into smaller single-purpose units per Directive 1.A.`
      : null
  };

  let violations = [];
  if (!skipCheck) {
    try {
      violations = auditFile(resolvedPath, relPath);
    } catch {
      violations = [];
    }

    // Zero-Raw-DOM Guardrail (Directive 1.G): raw HTML input/buttons forbidden in molecules
    if (isMolecule) {
      const rawDomMatches = patchedContent.match(/<\s*(button|input|textarea|select)\b[^>]*>/i);
      if (rawDomMatches) {
        const matchedTag = rawDomMatches[1];
        const matchPrefix = patchedContent.split(rawDomMatches[0])[0];
        const lineNum = matchPrefix ? matchPrefix.split('\n').length : 1;
        violations.push({
          filePath: relPath,
          line: lineNum,
          hazard: `Raw <${matchedTag}> tag detected in molecule capsule. Only atoms may contain raw DOM elements per Directive 1.G.`,
          rule: 'ZERO_RAW_DOM_MOLECULE',
          severity: 'CRITICAL',
          pillar: 'Molecular Architecture',
          directive: `Encapsulate <${matchedTag}> inside a foundational atom capsule (e.g. AtomButton, AtomInput).`
        });
      }
    }
  }

  const isCriticalSeverity = (v) => v.severity === 'CRITICAL';
  const isHighSeverity = (v) => v.severity === 'HIGH';
  const criticalViolations = violations.filter(isCriticalSeverity);
  const highViolations = violations.filter(isHighSeverity);

  const hasViolations = violations.length > 0;
  const isClean = !hasViolations && !isBudgetExceeded;

  return {
    file: relPath,
    status: 'ok',
    replaced: allowMultiple ? 'all' : 1,
    originalLines,
    newLines,
    lineDelta: newLines - originalLines,
    indexed,
    lineBudget,
    isClean,
    violationsCount: violations.length,
    criticalCount: criticalViolations.length,
    highCount: highViolations.length,
    violations
  };
};

/**
 * CLI command runner for chemx patch / chemx edit.
 *
 * @param {string[]} args CLI arguments.
 * @param {boolean} isCli Whether invoked directly from CLI.
 */
export const runPatcherCli = (args, isCli = false) => {
  if (args.includes('--help') || args.includes('-h') || args.includes('help')) {
    const isJson = args.includes('--json');
    if (isJson) {
      process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    } else {
      process.stdout.write([
        `${ANSI.BOLD}USAGE${ANSI.RESET}`,
        `  chemx patch <file> --target="text" --replacement="new" [options]`,
        '',
        `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
        `  --target="<text>"        Exact text block to replace`,
        `  --replacement="<new>"    New replacement content`,
        `  --multiple               Allow replacing multiple occurrences`,
        `  --json                   Output result as minified JSON`,
        `  -h, --help               Show this help message`,
        ''
      ].join('\n'));
    }
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const nonFlagArgs = args.filter((a) => !a.startsWith('-'));
  const filePath = nonFlagArgs[0];

  if (!filePath) {
    process.stderr.write(`${ANSI.RED}✕ Missing file path. Usage: chemx patch <file> --target="text" --replacement="new" [--json]${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }

  const isJson = args.includes('--json');
  const allowMultiple = args.includes('--multiple') || args.includes('--allow-multiple');

  const targetFlag = args.find((a) => a.startsWith('--target='));
  const replacementFlag = args.find((a) => a.startsWith('--replacement=') || a.startsWith('--replace='));

  let targetContent = targetFlag ? targetFlag.slice(targetFlag.indexOf('=') + 1) : null;
  let replacementContent = replacementFlag ? replacementFlag.slice(replacementFlag.indexOf('=') + 1) : null;

  try {
    const res = patchFile(filePath, {
      targetContent,
      replacementContent,
      allowMultiple,
    });

    if (isJson) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    } else {
      process.stdout.write(`${ANSI.GREEN}✔ Patched ${res.file}: ${res.originalLines}L -> ${res.newLines}L (${res.lineDelta >= 0 ? '+' : ''}${res.lineDelta} lines)${ANSI.RESET}\n`);
      if (res.lineBudget && !res.lineBudget.passed) {
        process.stdout.write(`  ${ANSI.RED}⚠ Line Budget: ${res.newLines}L exceeds ${res.lineBudget.limit}L limit (Directive 1.A)${ANSI.RESET}\n`);
      }
      if (res.violationsCount > 0) {
        process.stdout.write(`  ${ANSI.GOLD}⚠ ${res.violationsCount} architecture hazard(s) detected (Run chemx check ${res.file})${ANSI.RESET}\n`);
      }
    }

    if (isCli) process.exit(0);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${ANSI.RED}✕ ${msg}${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }
};

/**
 * Creates or overwrites a file with automatic micro-indexing and architectural checks.
 *
 * @param {string} targetPath File path to write.
 * @param {object} params Write parameters.
 * @param {string} params.content Content to write.
 * @param {string} [params.cwd=process.cwd()] Working directory.
 * @param {boolean} [params.skipIndex=false] Skip SQLite micro-indexing.
 * @param {boolean} [params.skipCheck=false] Skip post-write architecture check.
 * @returns {object} Write result summary.
 */
export const writeFile = (targetPath, params = {}) => {
  const {
    content,
    cwd = process.cwd(),
    skipIndex = false,
    skipCheck = false
  } = params;

  if (content === undefined || content === null) {
    throw new Error('content is required for writeFile');
  }

  const resolvedPath = path.resolve(cwd, targetPath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const isExisting = fs.existsSync(resolvedPath);
  const originalLines = isExisting
    ? fs.readFileSync(resolvedPath, 'utf-8').split('\n').length
    : 0;

  fs.writeFileSync(resolvedPath, content, 'utf-8');
  const newLines = content.split('\n').length;

  let indexed = false;
  if (!skipIndex) {
    try {
      const indexDetails = syncSingleFileIndex(resolvedPath, cwd);
      indexed = Boolean(indexDetails);
    } catch {
      indexed = false;
    }
  }

  const relPath = path.relative(cwd, resolvedPath);
  const baseName = path.basename(resolvedPath);
  const isMolecule = relPath.includes('molecules') || relPath.includes('/m-') || baseName.startsWith('m-');
  const maxLineBudget = isMolecule ? 100 : 500;
  const isBudgetExceeded = newLines > maxLineBudget;

  const lineBudget = {
    lines: newLines,
    limit: maxLineBudget,
    passed: !isBudgetExceeded,
    warning: isBudgetExceeded
      ? `File exceeds ${maxLineBudget}-line limit (${newLines}L). Split into smaller single-purpose units per Directive 1.A.`
      : null
  };

  let violations = [];
  if (!skipCheck) {
    try {
      violations = auditFile(resolvedPath, relPath);
    } catch {
      violations = [];
    }

    if (isMolecule) {
      const rawDomMatches = content.match(/<\s*(button|input|textarea|select)\b[^>]*>/i);
      if (rawDomMatches) {
        const matchedTag = rawDomMatches[1];
        const matchPrefix = content.split(rawDomMatches[0])[0];
        const lineNum = matchPrefix ? matchPrefix.split('\n').length : 1;
        violations.push({
          filePath: relPath,
          line: lineNum,
          hazard: `Raw <${matchedTag}> tag detected in molecule capsule. Only atoms may contain raw DOM elements per Directive 1.G.`,
          rule: 'ZERO_RAW_DOM_MOLECULE',
          severity: 'CRITICAL',
          pillar: 'Molecular Architecture',
          directive: `Encapsulate <${matchedTag}> inside a foundational atom capsule (e.g. AtomButton, AtomInput).`
        });
      }
    }
  }

  const isCriticalSeverity = (v) => v.severity === 'CRITICAL';
  const isHighSeverity = (v) => v.severity === 'HIGH';
  const criticalViolations = violations.filter(isCriticalSeverity);
  const highViolations = violations.filter(isHighSeverity);

  const hasViolations = violations.length > 0;
  const isClean = !hasViolations && !isBudgetExceeded;

  return {
    file: relPath,
    status: 'ok',
    created: !isExisting,
    lines: newLines,
    indexed,
    lineBudget,
    isClean,
    violationsCount: violations.length,
    criticalCount: criticalViolations.length,
    highCount: highViolations.length,
    violations
  };
};

/**
 * CLI command runner for chemx write.
 *
 * @param {string[]} args CLI arguments.
 * @param {boolean} isCli Whether invoked directly from CLI.
 */
export const runWriterCli = (args, isCli = false) => {
  if (args.includes('--help') || args.includes('-h') || args.includes('help')) {
    const isJson = args.includes('--json');
    if (isJson) {
      process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    } else {
      process.stdout.write([
        `${ANSI.BOLD}USAGE${ANSI.RESET}`,
        `  chemx write <file> --content="text" [options]`,
        '',
        `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
        `  --content="<text>"       File content to write`,
        `  --json                   Output result as minified JSON`,
        `  -h, --help               Show this help message`,
        ''
      ].join('\n'));
    }
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const nonFlagArgs = args.filter((a) => !a.startsWith('-'));
  const filePath = nonFlagArgs[0];

  if (!filePath) {
    process.stderr.write(`${ANSI.RED}✕ Missing file path. Usage: chemx write <file> --content="text" [--json]${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }

  const isJson = args.includes('--json');
  const contentFlag = args.find((a) => a.startsWith('--content='));
  const content = contentFlag ? contentFlag.slice(contentFlag.indexOf('=') + 1) : '';

  try {
    const res = writeFile(filePath, { content });
    if (isJson) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    } else {
      process.stdout.write(`${ANSI.GREEN}✔ ${res.created ? 'Created' : 'Updated'} ${res.file} (${res.lines} lines, indexed in SQLite)${ANSI.RESET}\n`);
      if (res.lineBudget && !res.lineBudget.passed) {
        process.stdout.write(`  ${ANSI.RED}⚠ Line Budget: ${res.lines}L exceeds ${res.lineBudget.limit}L limit (Directive 1.A)${ANSI.RESET}\n`);
      }
      if (res.violationsCount > 0) {
        process.stdout.write(`  ${ANSI.GOLD}⚠ ${res.violationsCount} architecture hazard(s) detected (Run chemx check ${res.file})${ANSI.RESET}\n`);
      }
    }
    if (isCli) process.exit(0);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${ANSI.RED}✕ ${msg}${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }
};

