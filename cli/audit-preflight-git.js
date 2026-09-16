import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const SOURCE_FILE_PATTERN = /\.(tsx|ts|jsx|js|vue|svelte)$/;
const EXCLUDED_PATTERNS = ['.test.', '.spec.', '.min.', '.d.ts'];

export const isSourceFilePath = (filePath) => {
  const isExtensionValid = SOURCE_FILE_PATTERN.test(filePath);
  if (!isExtensionValid) return false;
  const isExcluded = EXCLUDED_PATTERNS.some((pat) => filePath.includes(pat));
  return !isExcluded;
};

export const parseGitStatusOutput = (output) => {
  const lines = output.split('\n');
  const files = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const cleanPath = trimmed.replace(/^[MADRCU?! ]+\s+/, '').trim().replace(/^"|"$/g, '');
    if (cleanPath) {
      files.push(cleanPath);
    }
  }

  return files;
};

export const getGitChangedFiles = (cwd = process.cwd()) => {
  try {
    const result = spawnSync('git', ['status', '--porcelain', '-u'], { cwd, encoding: 'utf-8' });
    const isSuccess = result.status === 0;
    if (!isSuccess || !result.stdout) return [];
    return parseGitStatusOutput(result.stdout);
  } catch {
    return [];
  }
};

export const resolveGitAuditScope = (cwd = process.cwd()) => {
  const rawFiles = getGitChangedFiles(cwd);
  const existingSourceFiles = rawFiles.filter((relPath) => {
    const isSource = isSourceFilePath(relPath);
    const exists = fs.existsSync(relPath);
    return isSource && exists;
  });

  const hasChangedFiles = existingSourceFiles.length > 0;
  return {
    ok: hasChangedFiles,
    files: existingSourceFiles
  };
};
