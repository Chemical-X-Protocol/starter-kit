import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import {
  isComponentPath,
  isCodeLine,
  isShallowCatchClause,
  parseBestEffortAllowance,
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

// A line-based scan cannot tell a comment from a string that quotes one. Walk the line
// up to the match and track quote state: if a quote is still open at that offset, the
// match sits inside a string literal and is describing the pattern, not committing it.
// Lines that are wholly a comment short-circuit, so apostrophes in prose cannot open a
// phantom string and suppress a real finding.
const COMMENT_LINE_START = /^\s*(?:\/\/|#|\*|--)/;

const isInsideStringLiteral = (lineText, matchIndex) => {
  if (matchIndex <= 0) return false;
  if (COMMENT_LINE_START.test(lineText)) return false;

  let quote = null;
  for (let i = 0; i < matchIndex; i += 1) {
    const ch = lineText[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    }
  }
  return quote !== null;
};

export const checkSlopTextPatterns = (content, lines, relativePath, violations) => {
  lines.forEach((lineText, idx) => {
    for (const pat of CONVERSATIONAL_PATTERNS) {
      const hit = pat.regex.exec(lineText);
      if (hit && !isInsideStringLiteral(lineText, hit.index)) {
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

const SWALLOWABLE_KINDS = new Set(['let', 'var']);
const DEFAULTING_OPERATORS = new Set(['??', '||']);
const DEFAULTING_ASSIGNMENTS = new Set(['=', '??=', '||=']);
const MISSING_REASON_NOTE = 'the chemx-allow: best-effort annotation needs a reason (reason is mandatory)';

const isOnLines = (comment, span) => {
  const startsBeforeSpanEnd = comment.loc.start.line <= span.end;
  return startsBeforeSpanEnd && comment.loc.end.line >= span.start;
};

// Lines held by a try nested inside this try block belong to the inner catch, so an
// annotation written there must never exempt the outer catch as well.
const listNestedTrySpans = (tryPath) => {
  const spans = [];
  tryPath.get('block').traverse({
    TryStatement(p) {
      spans.push({ start: p.node.loc.start.line, end: p.node.loc.end.line });
    }
  });
  return spans;
};

const isAloneOnItsLine = (comment, source) => {
  const lineStart = comment.start - comment.loc.start.column;
  return source.slice(lineStart, comment.start).trim() === '';
};

// A comment that starts on the catch's own lines always counts. One that starts above them
// counts only when nothing precedes it on its line, because a trailing comment there belongs
// to the previous statement (or a previous one-line try) and must not exempt this catch.
const isInCatchWindow = (comment, window, source) => {
  if (!isOnLines(comment, window)) return false;
  const startsAboveCatch = comment.loc.start.line < window.catchLine;
  return !startsAboveCatch || isAloneOnItsLine(comment, source);
};

// Parser comments only, so annotation text quoted inside a string literal never counts. The
// window runs from the line above the catch keyword to the closing brace of its body.
const findCatchAllowance = (comments, catchPath, source) => {
  const catchStart = catchPath.node.loc?.start.line || 1;
  const window = { start: catchStart - 1, catchLine: catchStart, end: catchPath.node.loc?.end.line || catchStart };
  const annotated = comments
    .filter((comment) => isInCatchWindow(comment, window, source))
    .map((comment) => ({ comment, allowance: parseBestEffortAllowance(comment.value) }))
    .filter((entry) => entry.allowance.isAnnotated);
  if (annotated.length === 0) return null;

  const nestedSpans = listNestedTrySpans(catchPath.parentPath);
  const owned = annotated
    .filter((entry) => !nestedSpans.some((span) => isOnLines(entry.comment, span)))
    .map((entry) => entry.allowance);
  return owned.find((allowance) => allowance.hasReason) || owned[0] || null;
};

const resolveFunctionScope = (scope) => scope.getFunctionParent() || scope.getProgramParent();

const isUndefinedValue = (node) => {
  const isUndefinedId = t.isIdentifier(node, { name: 'undefined' });
  return isUndefinedId || t.isUnaryExpression(node, { operator: 'void' });
};

// Names written directly in the try block. Writes inside callbacks are skipped, and `var`
// initialisers count because a var binding outlives the block it is declared in.
const collectTryWrites = (blockPath) => {
  const writes = [];
  const record = (p) => {
    for (const name of Object.keys(p.getBindingIdentifiers())) writes.push({ name, scope: p.scope });
  };
  blockPath.traverse({
    Function(p) {
      p.skip();
    },
    AssignmentExpression(p) {
      if (p.node.operator === '=') record(p);
    },
    VariableDeclarator(p) {
      const isVarInit = p.parent.kind === 'var' && Boolean(p.node.init);
      if (isVarInit) record(p);
    }
  });
  return writes;
};

// Offset from which a write guarantees the binding a value, so reads nested inside the write
// (v = normalize(v)) are still unguarded. Compound and update writes (v += x, v++) read the
// old value first and never stand in for a default, so they guard nothing.
const resolveGuardedFrom = (writePath) => {
  const node = writePath.node;
  if (writePath.isUpdateExpression()) return Infinity;
  if (writePath.isForXStatement()) return node.body.start;
  if (!writePath.isAssignmentExpression()) return node.end;
  return DEFAULTING_ASSIGNMENTS.has(node.operator) ? node.end : Infinity;
};

const isWithinNode = (inner, outer) => {
  const startsInside = inner.start >= outer.start;
  return startsInside && inner.end <= outer.end;
};

// A write inside the block of another try whose catch is shallow may never have run, so it
// cannot count as a default. A try that also encloses this one does not qualify: reaching
// this try means the statements before it in that shared block already ran.
const isInOtherShallowTry = (writePath, tryNode) => {
  const swallowingTry = writePath.findParent((p) => {
    if (!p.isTryStatement()) return false;
    if (!isShallowCatchClause(p.node.handler, t)) return false;
    if (isWithinNode(tryNode, p.node)) return false;
    return isWithinNode(writePath.node, p.node.block);
  });
  return Boolean(swallowingTry);
};

const hasRealInit = (declaratorPath) => {
  const init = declaratorPath.node.init;
  return Boolean(init) && !isUndefinedValue(init);
};

// A bare `var v;` redeclaration is recorded as a constant violation but assigns nothing.
const isValueWrite = (writePath) => !writePath.isVariableDeclarator() || hasRealInit(writePath);

// Every write that gives the binding a value: each reassignment, plus a declared initialiser
// that is not undefined, or a for-in/for-of head that assigns it.
const listValueWrites = (binding, tryNode) => {
  const writePaths = binding.constantViolations.filter(isValueWrite);
  const isLoopHead = Boolean(binding.path.parentPath?.parentPath?.isForXStatement());
  if (hasRealInit(binding.path) || isLoopHead) writePaths.push(binding.path);
  return writePaths
    .filter((writePath) => !isInOtherShallowTry(writePath, tryNode))
    .map((writePath) => ({ start: writePath.node.start, guardedFrom: resolveGuardedFrom(writePath) }));
};

const isOptionalChainLink = (path) => {
  const parent = path.parent;
  const isChainObject = t.isOptionalMemberExpression(parent) && parent.object === path.node;
  const isChainCallee = t.isOptionalCallExpression(parent) && parent.callee === path.node;
  return isChainObject || isChainCallee;
};

// Climb an optional chain that starts at the read: in data?.name ?? 'anon' the default also
// covers data, because the chain short-circuits to undefined when data is unset. A plain
// member access (data.name) throws first, so it is never climbed.
const climbOptionalChain = (refPath) => {
  let chain = refPath;
  while (isOptionalChainLink(chain)) chain = chain.parentPath;
  return chain;
};

// Babel lists the bare head of for (v of xs) among the references, but it is the write.
const isLoopHeadTarget = (refPath) => refPath.parentPath.isForXStatement() && refPath.key === 'left';

const isDefaultedRead = (refPath) => {
  const chain = climbOptionalChain(refPath);
  const parent = chain.parent;
  const isDefaultingLogical = t.isLogicalExpression(parent) && DEFAULTING_OPERATORS.has(parent.operator);
  return isDefaultingLogical && parent.left === chain.node;
};

const isReadUnsetAfterTry = (binding, tryNode, fnScope) => {
  if (!binding) return false;
  if (!SWALLOWABLE_KINDS.has(binding.kind)) return false;
  if (!binding.path.isVariableDeclarator()) return false;
  if (resolveFunctionScope(binding.scope) !== fnScope) return false;

  const writes = listValueWrites(binding, tryNode);
  if (writes.some((write) => write.start < tryNode.start)) return false;
  const laterWrites = writes.filter((write) => write.start > tryNode.end);
  const guardedFrom = Math.min(Infinity, ...laterWrites.map((write) => write.guardedFrom));

  return binding.referencePaths.some((ref) => {
    if (isLoopHeadTarget(ref)) return false;
    const isAfterTry = ref.node.start > tryNode.end;
    const isBeforeGuard = ref.node.start < guardedFrom;
    const isUnguardedWindow = isAfterTry && isBeforeGuard;
    return isUnguardedWindow && !isDefaultedRead(ref);
  });
};

// Truth spec 4.2: escalate only when a let/var assigned in the try is read after it while it
// may still be undefined, because that is where a swallowed error silently propagates.
const findSwallowedBinding = (catchPath) => {
  const tryPath = catchPath.parentPath;
  const fnScope = resolveFunctionScope(tryPath.scope);
  const writes = collectTryWrites(tryPath.get('block'));
  const swallowed = writes.find(({ name, scope }) => {
    return isReadUnsetAfterTry(scope.getBinding(name), tryPath.node, fnScope);
  });
  return swallowed?.name || null;
};

const describeShallowCatch = (swallowed, isMissingReason) => {
  const parts = [];
  if (swallowed) {
    parts.push(`Shallow catch leaves "${swallowed}" unset; it is read after the try (silent undefined propagation)`);
  } else {
    parts.push('Shallow catch paranoia wrapper (silent suppression without handling)');
  }
  if (isMissingReason) parts.push(MISSING_REASON_NOTE);
  return parts.join('; ');
};

const reportShallowCatch = (astPath, { relativePath, violations, comments, source }) => {
  const allowance = findCatchAllowance(comments, astPath, source);
  if (allowance?.hasReason) return;

  const swallowed = findSwallowedBinding(astPath);
  const meta = RULE_REGISTRY.AI_SLOP_SHALLOW_CATCH;
  violations.push({
    filePath: relativePath,
    line: astPath.node.loc?.start.line || 1,
    column: astPath.node.loc?.start.column || 1,
    hazard: describeShallowCatch(swallowed, Boolean(allowance)),
    rule: 'AI_SLOP_SHALLOW_CATCH',
    severity: swallowed ? 'HIGH' : meta.severity,
    pillar: meta.pillar,
    directive: meta.directive,
    isAiSlop: true
  });
};

export const createAiSlopVisitors = ({ relativePath, violations, comments = [], source = '' }) => {
  const isComponentFile = isComponentPath(relativePath);

  return {
    CatchClause(astPath) {
      if (isShallowCatchClause(astPath.node, t)) {
        reportShallowCatch(astPath, { relativePath, violations, comments, source });
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
