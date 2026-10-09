import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import {
  isComponentPath,
  isCodeLine,
  isShallowCatchBody,
  hasAnyTypeAnnotation,
  isRedundantPassthroughReturn
} from './rules-predicates.js';
import { resolveCatchEscalation, resolveCatchSpan } from './shallow-catch-escalation.js';

const RESIDUE_PATTERNS = [
  ['hope this', 'helps'].join(' '),
  ['feel free', 'to tweak'].join(' '),
  ['let me know', 'if you need'].join(' '),
  // Assistant framing only (the phrase followed by a pause and "here"/"I"/"below",
  // or addressed to "you"). The bare phrase in a sentence about an API client is
  // ordinary engineering prose.
  ['as you', 'requested'].join(' '),
  ['as', 'requested[,.!:]\\s*(?:here|i\\b|below)'].join(' '),
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

// A line-based scan cannot tell a comment from a string that quotes one. Walk the line
// up to the match and track quote state: if a quote is still open at that offset, the
// match sits inside a string literal and is describing the pattern, not committing it.
// Lines that are wholly a comment short-circuit, so apostrophes in prose cannot open a
// phantom string and suppress a real finding.
const COMMENT_LINE_START = /^\s*(?:\/\/|#|\*|--)/;

const isInsideStringLiteral = (lineText, matchIndex) => {
  const isAtLineStart = matchIndex <= 0;
  if (isAtLineStart) return false;
  const isCommentLine = COMMENT_LINE_START.test(lineText);
  if (isCommentLine) return false;

  let quote = null;
  for (let i = 0; i < matchIndex; i += 1) {
    const ch = lineText[i];
    const isEscape = ch === '\\';
    if (isEscape) {
      i += 1;
      continue;
    }
    const closesQuote = ch === quote;
    const opensQuote = ch === '"' || ch === "'" || ch === '`';
    if (quote) {
      if (closesQuote) quote = null;
    } else if (opensQuote) {
      quote = ch;
    }
  }
  return quote !== null;
};

export const checkSlopTextPatterns = (content, lines, relativePath, violations) => {
  lines.forEach((lineText, idx) => {
    for (const pat of CONVERSATIONAL_PATTERNS) {
      const hit = pat.regex.exec(lineText);
      const isRealHit = Boolean(hit && !isInsideStringLiteral(lineText, hit.index));
      if (isRealHit) {
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
    const isLineComment = trimmed.startsWith('//') && !trimmed.startsWith('///');
    if (isLineComment) {
      const commentBody = trimmed.replace(/^\/\/\s*/, '');
      const commentWords = normalizeWords(commentBody);

      const isShortComment = commentWords.length >= 2 && commentWords.length <= 6;
      if (isShortComment) {
        let nextIdx = idx + 1;
        while (nextIdx < lines.length) {
          const nextTrim = lines[nextIdx].trim();
          if (isCodeLine(nextTrim)) {
            const nextWords = new Set(normalizeWords(nextTrim));
            let matchCount = 0;
            for (const cw of commentWords) {
              const isEchoedWord = nextWords.has(cw);
              if (isEchoedWord) matchCount += 1;
            }
            const matchRatio = matchCount / commentWords.length;
            const isEcho = matchRatio >= 0.75;
            if (isEcho) {
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
        const meta = RULE_REGISTRY.AI_SLOP_SHALLOW_CATCH;
        const { severity, binding } = resolveCatchEscalation(astPath);
        violations.push({
          filePath: relativePath,
          ...resolveCatchSpan(astPath),
          hazard: binding
            ? `Shallow catch leaves "${binding}" unset; it is read after the try (silent undefined propagation)`
            : 'Shallow catch paranoia wrapper (silent suppression without handling)',
          rule: 'AI_SLOP_SHALLOW_CATCH',
          severity,
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
      const hasMultipleStatements = stmts.length >= 2;
      if (hasMultipleStatements) {
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
      const isReinventedFn = Boolean(fnName && REINVENTED_UTILS.has(fnName));
      if (isReinventedFn) {
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
      const isReinventedName = Boolean(idName && REINVENTED_UTILS.has(idName));
      if (!isReinventedName) return;

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
