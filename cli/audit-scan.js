// Core audit engine: file discovery and per-file rule evaluation. No presentation imports.
import fs from 'node:fs';
import path from 'node:path';
import { isSourceFile as isPolyglotSourceFile } from './languages.js';
import { auditCode } from './audit/rules.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'vendor',
  '.git',
  '.next',
  '.turbo',
  '.output',
  '.nuxt',
  '.cache',
  'out'
]);

const isSourceFile = (name, options = {}) => {
  return isPolyglotSourceFile(name, { includeTests: false, ...options });
};

export const auditFile = (filePath, relativePath) => {
  if (!isSourceFile(path.basename(filePath), { includeTests: true })) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  return auditCode(content, filePath, relativePath);
};

const auditFileEntry = (fullPath, relPath, scanOptions) => {
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');
  const baseName = path.basename(fullPath);
  const isMolecule = relPath.includes('molecules') || relPath.includes('/m-') || baseName.startsWith('m-');

  const fileStat = {
    fullPath,
    relativePath: relPath,
    lineCount: lines.length,
    charCount: content.length,
    isMolecule
  };

  const hookMatches = content.match(/\buse[A-Z0-9]\w*\b/g);
  const hookCount = hookMatches ? hookMatches.length : 0;
  const fileViolations = auditCode(content, fullPath, relPath, {
    patternRegistry: scanOptions.patternRegistry,
    hookRegistry: scanOptions.hookRegistry,
    fast: scanOptions.fast,
    config: scanOptions.config
  });

  return { fileStat, hookCount, fileViolations };
};

export const scanTree = (targetDir, baseDir, scanOptions = {}) => {
  let violations = [];
  let fileStats = [];
  let totalHooks = 0;

  const targetRel = path.relative(baseDir, targetDir);
  const isTargetingTests = /(?:^|[\\/])(?:tests?|specs?)(?:[\\/]|$)/i.test(targetRel) ||
    /(?:^|[\\/])(?:tests?|specs?)(?:[\\/]|$)/i.test(targetDir);
  const includeTests = Boolean(scanOptions.includeTests || isTargetingTests);
  const effectiveScanOptions = { ...scanOptions, includeTests };

  if (scanOptions.fileList && scanOptions.fileList.length > 0) {
    for (const item of scanOptions.fileList) {
      const fullPath = path.isAbsolute(item) ? item : path.resolve(baseDir, item);
      const relPath = path.relative(baseDir, fullPath);
      if (fs.existsSync(fullPath) && isSourceFile(path.basename(fullPath), { includeTests: true })) {
        const result = auditFileEntry(fullPath, relPath, effectiveScanOptions);
        violations = violations.concat(result.fileViolations);
        fileStats.push(result.fileStat);
        totalHooks += result.hookCount;
      }
    }
    return { violations, fileStats, totalHooks };
  }

  if (!fs.existsSync(targetDir)) {
    return { violations, fileStats, totalHooks };
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        const sub = scanTree(fullPath, baseDir, effectiveScanOptions);
        violations = violations.concat(sub.violations);
        fileStats = fileStats.concat(sub.fileStats);
        totalHooks += sub.totalHooks;
      }
    } else if (isSourceFile(entry.name, { includeTests })) {
      const result = auditFileEntry(fullPath, relPath, effectiveScanOptions);
      violations = violations.concat(result.fileViolations);
      fileStats.push(result.fileStat);
      totalHooks += result.hookCount;
    }
  }

  return { violations, fileStats, totalHooks };
};

export const scanDirectory = (targetDir, baseDir) => {
  const { violations } = scanTree(targetDir, baseDir);
  return violations;
};
