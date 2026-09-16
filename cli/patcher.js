import fs from 'node:fs';
import path from 'node:path';
import { ANSI } from './theme.js';

/**
 * Surgically applies a search-and-replace block to a file.
 *
 * @param {string} targetPath File path to patch.
 * @param {object} params Patch parameters.
 * @param {string} params.targetContent Exact string to replace.
 * @param {string} params.replacementContent Replacement string.
 * @param {boolean} [params.allowMultiple=false] Whether multiple matches are allowed.
 * @returns {object} Compact patch result summary.
 */
export const patchFile = (targetPath, params = {}) => {
  const { targetContent, replacementContent, allowMultiple = false } = params;

  if (targetContent === undefined || targetContent === null) {
    throw new Error('targetContent is required for patching');
  }

  if (replacementContent === undefined || replacementContent === null) {
    throw new Error('replacementContent is required for patching');
  }

  const resolvedPath = path.resolve(process.cwd(), targetPath);
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

  return {
    file: targetPath,
    status: 'ok',
    replaced: allowMultiple ? 'all' : 1,
    originalLines,
    newLines,
    lineDelta: newLines - originalLines,
  };
};

/**
 * CLI command runner for chemx patch / chemx edit.
 *
 * @param {string[]} args CLI arguments.
 * @param {boolean} isCli Whether invoked directly from CLI.
 */
export const runPatcherCli = (args, isCli = false) => {
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
