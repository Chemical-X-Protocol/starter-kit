// Core audit engine: file discovery and per-file rule evaluation. No presentation imports.
import fs from 'node:fs';
import path from 'node:path';
import { isSourceFile as isPolyglotSourceFile } from './languages.js';
import { auditCode } from './audit/rules.js';
import { ANY_DEPTH_IGNORED_DIRS } from './search-scan.js';
import { loadProjectConfig } from './config/index.js';
import { countLines, getLineBudgets, resolveFileTier } from './audit/line-budgets.js';

// Shares search's skip list (package stores, agent worktree copies, the chemx index) so the
// audit never scores code that isn't the project's; build output is skipped at any depth here.
const IGNORED_DIRS = new Set([...ANY_DEPTH_IGNORED_DIRS, 'build', 'out']);

const isSourceFile = (name, options = {}) => {
  return isPolyglotSourceFile(name, { includeTests: false, ...options });
};

const configCache = new Map();

/** Project config for single-file audits (check, patch, task gates, MCP), loaded once per root. */
export const resolveAuditConfig = (cwd = process.cwd()) => {
  const cached = configCache.get(cwd);
  if (cached) return cached;
  const config = loadProjectConfig(cwd);
  configCache.set(cwd, config);
  return config;
};

/**
 * Audits one file with the project config (.chemxrc profile, per-rule settings,
 * overrides). options: { config, cwd } to override the config or its root.
 */
export const auditFile = (filePath, relativePath, options = {}) => {
  if (!isSourceFile(path.basename(filePath), { includeTests: true })) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const config = options.config || resolveAuditConfig(options.cwd || process.cwd());
  return auditCode(content, filePath, relativePath, { config, coverage: options.coverage });
};

const auditFileEntry = (fullPath, relPath, scanOptions) => {
  const content = fs.readFileSync(fullPath, 'utf-8');
  const ruleConfig = scanOptions.config?.rules || {};
  const budgets = getLineBudgets(ruleConfig);
  const isMolecule = resolveFileTier(relPath, ruleConfig) === 'molecule';

  const fileStat = {
    fullPath,
    relativePath: relPath,
    lineCount: countLines(content),
    charCount: content.length,
    isMolecule,
    lineBudget: isMolecule ? budgets.molecule : budgets.file.warn
  };

  const hookMatches = content.match(/\buse[A-Z0-9]\w*\b/g);
  const hookCount = hookMatches ? hookMatches.length : 0;
  const fileViolations = auditCode(content, fullPath, relPath, {
    patternRegistry: scanOptions.patternRegistry,
    hookRegistry: scanOptions.hookRegistry,
    fast: scanOptions.fast,
    config: scanOptions.config,
    coverage: scanOptions.coverage
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
