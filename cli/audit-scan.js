// Core audit engine: file discovery and per-file rule evaluation. No presentation imports.
import fs from 'node:fs';
import path from 'node:path';
import { isSourceFile as isPolyglotSourceFile } from './languages.js';
import { auditCode } from './audit/rules.js';
import { ANY_DEPTH_IGNORED_DIRS } from './search-scan.js';
import { loadProjectConfig } from './config/index.js';
import { countLines, getLineBudgets, resolveFileTier } from './audit/line-budgets.js';
import { listGitFiles } from './git-file-listing.js';
import { conflictHunksOf, describeConflicts } from './conflicts.js';

// One CRITICAL finding instead of a parse error: an unmerged file is never clean.
const conflictViolation = (relativePath, hunks) => ({
  rule: 'UNMERGED_CONFLICT',
  severity: 'CRITICAL',
  pillar: 'integrity',
  line: hunks[0].start,
  hazard: describeConflicts(relativePath, hunks),
  directive: 'Resolve the merge (chemx conflicts, chemx d --conflicts) before static analysis'
});

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
  const fileHunks = conflictHunksOf(content);
  const hasConflictHunks = fileHunks.length > 0;
  if (hasConflictHunks) return [conflictViolation(relativePath || filePath, fileHunks)];
  const config = options.config || resolveAuditConfig(options.cwd || process.cwd());
  return auditCode(content, filePath, relativePath, { config, coverage: options.coverage });
};

const auditFileEntry = (fullPath, relPath, scanOptions) => {
  const content = fs.readFileSync(fullPath, 'utf-8');
  const hunks = conflictHunksOf(content);
  const isConflicted = hunks.length > 0;
  if (isConflicted) return { skipped: { path: relPath, hunks } };
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
  // Forge ledger: a collector for a changed file, null (options.fingerprint=false) for an unchanged one.
  const fingerprint = scanOptions.forge ? scanOptions.forge.beginFile(fullPath, content) : null;
  const fileViolations = auditCode(content, fullPath, relPath, {
    patternRegistry: scanOptions.patternRegistry,
    hookRegistry: scanOptions.hookRegistry,
    fast: scanOptions.fast,
    config: scanOptions.config,
    coverage: scanOptions.coverage,
    fingerprint
  });
  if (fingerprint) scanOptions.forge.commitFile(fingerprint);

  return { fileStat, hookCount, fileViolations };
};

const hasIgnoredSegment = (relPath) => relPath.split('/').some((segment) => IGNORED_DIRS.has(segment));

const walkSourceFiles = (dir, includeTests, out) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const isWalkable = entry.isDirectory() && !IGNORED_DIRS.has(entry.name);
    const isWantedFile = !entry.isDirectory() && isSourceFile(entry.name, { includeTests });
    if (isWalkable) walkSourceFiles(fullPath, includeTests, out);
    if (isWantedFile) out.push(fullPath);
  }
};

// A target whose every file is git-ignored lists empty under --exclude-standard. The caller named
// that directory explicitly, so it is audited by a plain walk instead of a silent false green.
const isTargetIgnored = (targetDir) => {
  const everything = listGitFiles(targetDir, { includeIgnored: true });
  return Array.isArray(everything) && everything.length > 0;
};

// One git listing per scan (.gitignore honoured); a plain walk when the dir is not in a repo.
// IGNORED_DIRS still applies on top so worktree copies and package stores never score.
export const discoverSourceFiles = (targetDir, includeTests) => {
  const gitFiles = listGitFiles(targetDir);
  const isGitRepo = Array.isArray(gitFiles);
  const found = [];
  const isListingEmpty = isGitRepo && gitFiles.length === 0;
  const shouldWalk = !isGitRepo || (isListingEmpty && isTargetIgnored(targetDir));
  if (shouldWalk) {
    walkSourceFiles(targetDir, includeTests, found);
    return found;
  }
  for (const rel of gitFiles.sort()) {
    const isSkipped = hasIgnoredSegment(rel) || !isSourceFile(path.basename(rel), { includeTests });
    const fullPath = path.join(targetDir, rel);
    const isPresentSource = !isSkipped && fs.existsSync(fullPath);
    if (isPresentSource) found.push(fullPath);
  }
  return found;
};

export const scanTree = (targetDir, baseDir, scanOptions = {}) => {
  let violations = [];
  let fileStats = [];
  let totalHooks = 0;
  let skippedConflicts = [];
  const take = (result) => {
    const hasSkipped = Boolean(result.skipped);
    if (hasSkipped) {
      skippedConflicts.push(result.skipped);
      return;
    }
    violations = violations.concat(result.fileViolations);
    fileStats.push(result.fileStat);
    totalHooks += result.hookCount;
  };

  const targetRel = path.relative(baseDir, targetDir);
  const isTargetingTests = /(?:^|[\\/])(?:tests?|specs?)(?:[\\/]|$)/i.test(targetRel) ||
    /(?:^|[\\/])(?:tests?|specs?)(?:[\\/]|$)/i.test(targetDir);
  const includeTests = Boolean(scanOptions.includeTests || isTargetingTests);
  const effectiveScanOptions = { ...scanOptions, includeTests };

  const hasFileList = Boolean(scanOptions.fileList && scanOptions.fileList.length > 0);
  if (hasFileList) {
    for (const item of scanOptions.fileList) {
      const fullPath = path.isAbsolute(item) ? item : path.resolve(baseDir, item);
      const relPath = path.relative(baseDir, fullPath);
      const isListedSource = fs.existsSync(fullPath) && isSourceFile(path.basename(fullPath), { includeTests: true });
      if (isListedSource) {
        take(auditFileEntry(fullPath, relPath, effectiveScanOptions));
      }
    }
    return { violations, fileStats, totalHooks, skippedConflicts };
  }

  const isMissingTarget = !fs.existsSync(targetDir);
  if (isMissingTarget) {
    return { violations, fileStats, totalHooks, skippedConflicts };
  }

  for (const fullPath of discoverSourceFiles(targetDir, includeTests)) {
    take(auditFileEntry(fullPath, path.relative(baseDir, fullPath), effectiveScanOptions));
  }

  return { violations, fileStats, totalHooks, skippedConflicts };
};

export const scanDirectory = (targetDir, baseDir) => {
  const { violations } = scanTree(targetDir, baseDir);
  return violations;
};
