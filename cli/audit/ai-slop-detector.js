import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import {
  isComponentPath,
  isCodeLine,
  isShallowCatchBody,
  hasAnyTypeAnnotation,
  isRedundantPassthroughReturn
} from './rules-predicates.js';

const RESIDUE_PATTERNS = [
  ['hope this', 'helps'].join(' '),
  ['feel free', 'to tweak'].join(' '),
  ['let me know', 'if you need'].join(' '),
  ['as', 'requested'].join(' '),
  ['as an ai', 'language model'].join(' ')
];

const PLACEHOLDER_PATTERNS = [
  ['replace with', 'your own'].join(' '),
  ['replace this with', 'actual'].join(' '),
  ['insert your', 'logic here'].join(' ')
];

const CONVERSATIONAL_PATTERNS = [
  {
    regex: /\b(?:here(?:'s| is) the (?:complete|updated|refactored|full) (?:code|implementation|file|component|version))\b/i,
    rule: 'AI_SLOP_CONVERSATIONAL_ARTIFACT',
    hazard: 'LLM conversational preamble detected in source'
  },
  {
    regex: new RegExp(`\\b(?:${RESIDUE_PATTERNS.join('|')})\\b`, 'i'),
    rule: 'AI_SLOP_CONVERSATIONAL_ARTIFACT',
    hazard: 'LLM assistant conversational residue detected in source'
  },
  {
    regex: new RegExp(`\\b(?:${PLACEHOLDER_PATTERNS.join('|')})\\b`, 'i'),
    rule: 'AI_SLOP_CONVERSATIONAL_ARTIFACT',
    hazard: 'Generic AI boilerplate instruction placeholder detected'
  },
  {
    regex: /\/\/\s*\.\.\.\s*(?:existing|rest of|remaining)\s+(?:code|implementation|logic|imports)/i,
    rule: 'AI_SLOP_LAZY_PLACEHOLDER',
    hazard: 'AI truncation placeholder detected (lazy incomplete implementation)'
  },
  {
    regex: /```(?:typescript|javascript|tsx|jsx|vue|js|ts|html|css)?\s*$/m,
    rule: 'AI_SLOP_CONVERSATIONAL_ARTIFACT',
    hazard: 'Leaked markdown code block fence detected in source'
  }
];

const REINVENTED_UTILS = new Set([
  'clamp',
  'slugify',
  'debounce',
  'throttle',
  'deepclone',
  'deepmerge',
  'capitalize'
]);

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'to', 'if', 'and', 'of', 'for', 'in', 'is', 'it',
  'this', 'that', 'with', 'from', 'as', 'on', 'function', 'const', 'let', 'var'
]);

const normalizeWords = (text) => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
};

export const checkSlopTextPatterns = (content, lines, relativePath, violations) => {
  lines.forEach((lineText, idx) => {
    for (const pat of CONVERSATIONAL_PATTERNS) {
      if (pat.regex.test(lineText)) {
        const meta = RULE_REGISTRY[pat.rule];
        violations.push({
          filePath: relativePath,
          line: idx + 1,
          column: 1,
          hazard: pat.hazard,
          rule: pat.rule,
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive,
          isAiSlop: true
        });
        break;
      }
    }

    const trimmed = lineText.trim();
    if (trimmed.startsWith('//') && !trimmed.startsWith('///')) {
      const commentBody = trimmed.replace(/^\/\/\s*/, '');
      const commentWords = normalizeWords(commentBody);

      if (commentWords.length >= 2 && commentWords.length <= 6) {
        let nextIdx = idx + 1;
        while (nextIdx < lines.length) {
          const nextTrim = lines[nextIdx].trim();
          if (isCodeLine(nextTrim)) {
            const nextWords = new Set(normalizeWords(nextTrim));
            let matchCount = 0;
            for (const cw of commentWords) {
              if (nextWords.has(cw)) matchCount += 1;
            }
            const matchRatio = matchCount / commentWords.length;
            if (matchRatio >= 0.75) {
              const meta = RULE_REGISTRY.AI_SLOP_ECHO_COMMENT;
              violations.push({
                filePath: relativePath,
                line: idx + 1,
                column: 1,
                hazard: `Trivial echo comment detected: "${commentBody.slice(0, 40)}" repeats adjacent code`,
                rule: 'AI_SLOP_ECHO_COMMENT',
                severity: meta.severity,
                pillar: meta.pillar,
                directive: meta.directive,
                isAiSlop: true
              });
            }
            break;
          }
          nextIdx += 1;
        }
      }
    }
  });
};

export const createAiSlopVisitors = ({ relativePath, violations }) => {
  const isComponentFile = isComponentPath(relativePath);

  return {
    CatchClause(astPath) {
      const body = astPath.node.body?.body || [];
      const isShallowCatch = isShallowCatchBody(body, t);

      if (isShallowCatch) {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.AI_SLOP_SHALLOW_CATCH;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: 'Shallow catch paranoia wrapper (silent suppression without handling)',
          rule: 'AI_SLOP_SHALLOW_CATCH',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive,
          isAiSlop: true
        });
      }

      if (hasAnyTypeAnnotation(astPath.node.param, t)) {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.AI_SLOP_LAZY_ANY;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: 'Lazy any catch parameter widening detected',
          rule: 'AI_SLOP_LAZY_ANY',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive,
          isAiSlop: true
        });
      }
    },

    BlockStatement(astPath) {
      const stmts = astPath.node.body;
      if (stmts.length >= 2) {
        for (let i = 0; i < stmts.length - 1; i++) {
          const curr = stmts[i];
          const next = stmts[i + 1];
          if (isRedundantPassthroughReturn(curr, next, t)) {
            const varName = curr.declarations[0].id.name;
            const line = curr.loc?.start.line || 1;
            const meta = RULE_REGISTRY.AI_SLOP_REDUNDANT_PASSTHROUGH;
            violations.push({
              filePath: relativePath,
              line,
              column: curr.loc?.start.column || 1,
              hazard: `Redundant single-use passthrough assignment "${varName}" before return`,
              rule: 'AI_SLOP_REDUNDANT_PASSTHROUGH',
              severity: meta.severity,
              pillar: meta.pillar,
              directive: meta.directive,
              isAiSlop: true
            });
          }
        }
      }
    },

    FunctionDeclaration(astPath) {
      if (!isComponentFile) return;
      const fnName = astPath.node.id?.name?.toLowerCase();
      if (fnName && REINVENTED_UTILS.has(fnName)) {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.AI_SLOP_UTILITY_REINVENTION;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: `Inline utility reinvention "${astPath.node.id.name}" in component capsule`,
          rule: 'AI_SLOP_UTILITY_REINVENTION',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive,
          isAiSlop: true
        });
      }
    },

    VariableDeclarator(astPath) {
      if (!isComponentFile) return;
      const idName = astPath.node.id?.name?.toLowerCase();
      if (!idName || !REINVENTED_UTILS.has(idName)) return;

      const initNode = astPath.node.init;
      const isFunction = t.isArrowFunctionExpression(initNode) || t.isFunctionExpression(initNode);
      if (!isFunction) return;

      const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.AI_SLOP_UTILITY_REINVENTION;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: `Inline utility reinvention "${astPath.node.id.name}" in component capsule`,
          rule: 'AI_SLOP_UTILITY_REINVENTION',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive,
          isAiSlop: true
        });
    }
  };
};
