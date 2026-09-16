import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'vendor',
  '.git',
  '.next',
  '.turbo',
  '.cache'
]);

const FIXABLE_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js', '.vue', '.md', '.scss', '.css']);

const RESIDUE_PATTERNS = [
  ['hope this', 'helps'].join(' '),
  ['feel free', 'to tweak'].join(' '),
  ['let me know', 'if you need'].join(' '),
  ['as an ai', 'language model'].join(' ')
];

const RESIDUE_REGEX = new RegExp(`\\b(?:${RESIDUE_PATTERNS.join('|')})\\b`, 'i');
const PREAMBLE_REGEX = /\b(?:here(?:'s| is) the (?:complete|updated|refactored|full) (?:code|implementation|file|component|version))\b/i;
const TRUNCATION_REGEX = /^\s*\/\/\s*\.\.\.\s*(?:existing|rest of|remaining)\s+(?:code|implementation|logic|imports)/i;
const MARKDOWN_FENCE_REGEX = /^\s*```(?:typescript|javascript|tsx|jsx|vue|js|ts|html|css|scss)?\s*$/;

export const autofixContent = (content, options = {}) => {
  const allowedRules = options.rules ? new Set(options.rules) : null;
  const shouldFix = (rule) => !allowedRules || allowedRules.has(rule);

  const lines = content.split('\n');
  const fixes = [];
  const resultLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const lineNumber = i + 1;
    let shouldDropLine = false;

    // 1. Leaked markdown fence removal
    if (shouldFix('AI_SLOP_CONVERSATIONAL_ARTIFACT') && MARKDOWN_FENCE_REGEX.test(line)) {
      fixes.push({
        line: lineNumber,
        rule: 'AI_SLOP_CONVERSATIONAL_ARTIFACT',
        action: 'Removed leaked markdown code fence'
      });
      shouldDropLine = true;
    }

    // 2. Pure conversational preamble or residue comment removal
    if (!shouldDropLine && shouldFix('AI_SLOP_CONVERSATIONAL_ARTIFACT')) {
      const isComment = /^\s*(?:\/\/|\/\*|<!--)/.test(line);
      if (isComment && (PREAMBLE_REGEX.test(line) || RESIDUE_REGEX.test(line))) {
        fixes.push({
          line: lineNumber,
          rule: 'AI_SLOP_CONVERSATIONAL_ARTIFACT',
          action: 'Removed AI conversational residue comment'
        });
        shouldDropLine = true;
      }
    }

    // 3. AI lazy placeholder comment removal
    if (!shouldDropLine && shouldFix('AI_SLOP_LAZY_PLACEHOLDER') && TRUNCATION_REGEX.test(line)) {
      fixes.push({
        line: lineNumber,
        rule: 'AI_SLOP_LAZY_PLACEHOLDER',
        action: 'Removed lazy AI truncation placeholder comment'
      });
      shouldDropLine = true;
    }

    if (!shouldDropLine && shouldFix('TYPOGRAPHY_EM_DASH') && line.includes('\u2014')) {
      line = line.replace(/\u2014/g, '-');
      fixes.push({
        line: lineNumber,
        rule: 'TYPOGRAPHY_EM_DASH',
        action: 'Replaced em dash with standard hyphen'
      });
    }

    if (!shouldDropLine) {
      resultLines.push(line);
    }
  }

  return {
    fixedContent: resultLines.join('\n'),
    fixes
  };
};

const collectFiles = (targetPath, baseDir) => {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return [targetPath];
  }

  let files = [];
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectFiles(fullPath, baseDir));
    } else if (FIXABLE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
};

export const runAutofix = (targetPath, options = {}) => {
  const cwd = options.cwd || process.cwd();
  const resolvedTarget = path.resolve(cwd, targetPath || 'src');
  const dryRun = Boolean(options.dryRun);

  if (!fs.existsSync(resolvedTarget)) {
    return {
      target: targetPath || 'src',
      dryRun,
      filesScanned: 0,
      filesChanged: 0,
      totalFixes: 0,
      fixes: []
    };
  }

  const files = collectFiles(resolvedTarget, cwd);
  const allFixes = [];
  let filesChanged = 0;

  for (const filePath of files) {
    const relPath = path.relative(cwd, filePath);
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    const { fixedContent, fixes } = autofixContent(originalContent, options);

    if (fixes.length > 0) {
      filesChanged += 1;
      for (const fix of fixes) {
        allFixes.push({
          file: relPath,
          line: fix.line,
          rule: fix.rule,
          action: fix.action
        });
      }

      if (!dryRun) {
        fs.writeFileSync(filePath, fixedContent, 'utf-8');
      }
    }
  }

  // Token optimization: cap fixes list to top 15 samples if very large
  const MAX_REPORTED_FIXES = 15;
  const isCapped = allFixes.length > MAX_REPORTED_FIXES;
  const reportedFixes = isCapped ? allFixes.slice(0, MAX_REPORTED_FIXES) : allFixes;

  const result = {
    target: targetPath || 'src',
    dryRun,
    filesScanned: files.length,
    filesChanged,
    totalFixes: allFixes.length,
    fixes: reportedFixes
  };

  if (isCapped) {
    result.omittedFixesCount = allFixes.length - MAX_REPORTED_FIXES;
  }

  return result;
};
