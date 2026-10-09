import fs from 'node:fs';
import path from 'node:path';

const QUOTE = '"';
const BACKSLASH = '\\';

// Length of the // or /* */ comment opening at index, or 0 when none opens there.
const measureComment = (text, index) => {
  const opener = text.slice(index, index + 2);
  const isBlockComment = opener === '/*';
  const isComment = isBlockComment || opener === '//';
  if (!isComment) return 0;
  // A line comment stops before its newline, so the line break itself is kept.
  const closer = isBlockComment ? '*/' : '\n';
  const closeAt = text.indexOf(closer, index + 2);
  const consumedCloser = isBlockComment ? closer.length : 0;
  const end = closeAt === -1 ? text.length : closeAt + consumedCloser;
  return end - index;
};

// Length of the double-quoted string opening at index; a backslash always escapes the next character.
const measureString = (text, index) => {
  let cursor = index + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    cursor += char === BACKSLASH ? 2 : 1;
    if (char === QUOTE) break;
  }
  return Math.min(cursor, text.length) - index;
};

// Comments become a space only outside strings, so globs such as "src/**/*.ts" survive intact.
export const stripJsonComments = (content) => {
  let output = '';
  let index = 0;
  while (index < content.length) {
    const isStringStart = content[index] === QUOTE;
    const stringLength = isStringStart ? measureString(content, index) : 0;
    const commentLength = isStringStart ? 0 : measureComment(content, index);
    const step = Math.max(stringLength, commentLength, 1);
    output += commentLength > 0 ? ' ' : content.slice(index, index + step);
    index += step;
  }
  return output;
};

export const parseJsonSafe = (raw) => {
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch {
    return null;
  }
};

const warnedConfigFiles = new Set();

/** A config file that exists but does not parse is reported once on stderr, never ignored silently. */
const warnUnparseableConfig = (filePath) => {
  const isAlreadyWarned = warnedConfigFiles.has(filePath);
  if (isAlreadyWarned) return;
  warnedConfigFiles.add(filePath);
  process.stderr.write(`chemx: ignoring ${filePath}: not valid JSON (using profile defaults)\n`);
};

const normalizeRuleKeys = (rules = {}) => {
  const normalized = {};
  const KEY_MAP = {
    'component-max-complexity': 'maxCyclomaticComplexity',
    'max-cyclomatic-complexity': 'maxCyclomaticComplexity',
    'max-hook-density': 'maxHookDensity',
    'max-render-depth': 'maxRenderDepth',
    'max-prop-count': 'maxPropCount',
    'prefer-design-tokens': 'preferDesignTokens',
    'enforce-file-length': 'enforceFileLength',
    'enforce-colocated-tests': 'enforceColocatedTests',
    'rule-of-three-abstractions': 'ruleOfThreeAbstractions',
    'ai-slop-detection': 'aiSlopDetection',
    'max-line-count-warning': 'maxLineCountWarning'
  };

  for (const [key, value] of Object.entries(rules)) {
    const targetKey = KEY_MAP[key] || key;
    normalized[targetKey] = value;
  }
  return normalized;
};

export const findAndLoadConfigFile = (cwd = process.cwd()) => {
  const candidates = [
    path.resolve(cwd, '.chemxrc'),
    path.resolve(cwd, '.chemxrc.json'),
    path.resolve(cwd, '.chemx', 'config.json')
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseJsonSafe(content);
      const isObject = parsed !== null && typeof parsed === 'object';
      if (!isObject) warnUnparseableConfig(filePath);
      if (isObject) {
        return {
          source: filePath,
          profile: parsed.profile,
          rules: normalizeRuleKeys(parsed.rules || {}),
          overrides: parsed.overrides || [],
          tiers: parsed.tiers || null,
          raw: parsed
        };
      }
    }
  }

  const pkgPath = path.resolve(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const rawPkg = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = parseJsonSafe(rawPkg);
    const hasChemxField = Boolean(pkg?.chemx);
    const isChemxObject = typeof pkg?.chemx === 'object';
    const isValidChemxConfig = hasChemxField && isChemxObject;
    if (isValidChemxConfig) {
      return {
        source: pkgPath,
        profile: pkg.chemx.profile,
        rules: normalizeRuleKeys(pkg.chemx.rules || {}),
        overrides: pkg.chemx.overrides || [],
        raw: pkg.chemx
      };
    }
  }

  return { source: null, profile: null, rules: {}, overrides: [], raw: {} };
};
