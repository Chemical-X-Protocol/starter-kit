/**
 * Chemical X C# / .NET Structural Analyzer
 * Evaluates .NET Clean Architecture, MediatR handlers, EF Core usage,
 * cyclomatic complexity, control flow nesting depth, and AI slop.
 */
import { RULE_REGISTRY } from './rules-registry.js';
import { resolveCSharpCatchAllowance } from './shallow-catch-csharp.js';

const IN_MEMORY_DB_PATTERN = /\bUseInMemoryDatabase\s*\(/;
const SQLITE_PROVIDER_PATTERN = /\b(?:UseSqlite|SqliteConnection|DataSource\s*=\s*:memory:)\b/;
const SIMULATED_DELAY_PATTERN = /\bTask\.Delay\s*\(\s*\d+\s*\)/;
const HARDCODED_LIST_MOCK_PATTERN = /new\s+List<[A-Za-z0-9_]+>\s*\{\s*new\s+[A-Za-z0-9_]+\s*\{/;
const MISSING_REASON_NOTE = 'the chemx-allow: best-effort annotation needs a reason (reason is mandatory)';
const SIMULATION_SWITCH_PATTERN = /(?:public|private|protected|internal)?\s*(?:static\s+)?(?:readonly\s+)?(?:const\s+)?bool\s+(?:Simulate|UseSimulation|Mock|Fake|Stub)[A-Za-z0-9_]*\s*(?:\{\s*get;\s*(?:set|init)?;\s*\}\s*)?=\s*true\b/i;

const isVerbatimStringPrefix = (code, i) => {
  const ch = code[i];
  const next = code[i + 1];
  const isVerbatim = ch === '@' && next === '"';
  const isInterpVerbatim = (ch === '$' && next === '@') || (ch === '@' && next === '$');
  const hasQuote = code[i + 2] === '"';
  return isVerbatim || (isInterpVerbatim && hasQuote);
};

export const maskCommentsAndStrings = (code) => {
  let out = '';
  let i = 0;
  const len = code.length;
  while (i < len) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === '/' && next === '/') {
      out += '  ';
      i += 2;
      while (i < len && code[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < len) {
        out += '  ';
        i += 2;
      }
    } else if (isVerbatimStringPrefix(code, i)) {
      const isVerbatim = ch === '@' && next === '"';
      const skip = isVerbatim ? 2 : 3;
      out += ' '.repeat(skip);
      i += skip;
      while (i < len) {
        if (code[i] === '"' && code[i + 1] === '"') {
          out += '  ';
          i += 2;
        } else if (code[i] === '"') {
          out += ' ';
          i++;
          break;
        } else {
          out += code[i] === '\n' ? '\n' : ' ';
          i++;
        }
      }
    } else if (ch === '"') {
      out += ' ';
      i++;
      while (i < len && code[i] !== '"' && code[i] !== '\n') {
        if (code[i] === '\\') {
          out += '  ';
          i += 2;
        } else {
          out += ' ';
          i++;
        }
      }
      if (i < len && code[i] === '"') {
        out += ' ';
        i++;
      }
    } else if (ch === "'") {
      out += ' ';
      i++;
      while (i < len && code[i] !== "'" && code[i] !== '\n') {
        if (code[i] === '\\') {
          out += '  ';
          i += 2;
        } else {
          out += ' ';
          i++;
        }
      }
      if (i < len && code[i] === "'") {
        out += ' ';
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
};

const extractMethods = (maskedContent) => {
  const methods = [];
  const methodRegex = /(?:public|internal|protected|private|static|async|override|virtual|sealed|partial)\s+[\w<>\[\],\s?]+?\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:where[^{]+)?\s*\{/g;
  let match;

  while ((match = methodRegex.exec(maskedContent)) !== null) {
    const methodName = match[1];
    const signature = match[0];
    const startIdx = match.index + signature.length - 1;
    let depth = 0;
    let endIdx = -1;

    for (let i = startIdx; i < maskedContent.length; i++) {
      if (maskedContent[i] === '{') depth++;
      else if (maskedContent[i] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }

    if (endIdx !== -1) {
      const startLine = maskedContent.slice(0, match.index).split('\n').length;
      methods.push({
        name: methodName,
        startLine,
        body: maskedContent.slice(startIdx, endIdx + 1),
        startIdx,
        endIdx
      });
    }
  }

  return methods;
};

const evaluateMethodComplexityAndNesting = (method, relativePath, violations, config = {}) => {
  const maxComplexity = config.maxCyclomaticComplexity || 12;
  const maxNestingLimit = 4;
  const body = method.body;

  let cyclomaticComplexity = 1;
  const ifMatches = body.match(/\bif\s*\(/g);
  if (ifMatches) cyclomaticComplexity += ifMatches.length;
  const caseMatches = body.match(/\bcase\b[^:]+:/g);
  if (caseMatches) cyclomaticComplexity += caseMatches.length;
  const whileMatches = body.match(/\bwhile\s*\(/g);
  if (whileMatches) cyclomaticComplexity += whileMatches.length;
  const forMatches = body.match(/\bfor\s*\(/g);
  if (forMatches) cyclomaticComplexity += forMatches.length;
  const foreachMatches = body.match(/\bforeach\s*\(/g);
  if (foreachMatches) cyclomaticComplexity += foreachMatches.length;
  const catchMatches = body.match(/\bcatch\b/g);
  if (catchMatches) cyclomaticComplexity += catchMatches.length;
  const andMatches = body.match(/&&/g);
  if (andMatches) cyclomaticComplexity += andMatches.length;
  const orMatches = body.match(/\|\|/g);
  if (orMatches) cyclomaticComplexity += orMatches.length;
  const nullCoalMatches = body.match(/\?\?/g);
  if (nullCoalMatches) cyclomaticComplexity += nullCoalMatches.length;

  if (cyclomaticComplexity > maxComplexity) {
    const meta = RULE_REGISTRY.COMPLEXITY_CYCLOMATIC_HIGH;
    violations.push({
      filePath: relativePath,
      line: method.startLine,
      column: 1,
      hazard: `High cyclomatic complexity in method ${method.name} (${cyclomaticComplexity} > ${maxComplexity} threshold)`,
      rule: 'COMPLEXITY_CYCLOMATIC_HIGH',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
  }

  let braceLevel = 0;
  const controlStack = [];
  let maxControlDepth = 0;
  let maxDepthLine = method.startLine;
  const bodyTokens = body.split(/(\bif\s*\(|\belse\s*if\s*\(|\belse\b|\bwhile\s*\(|\bfor\s*\(|\bforeach\s*\(|\bswitch\s*\(|\bcatch\b|\{|\})/g);
  let curLine = method.startLine;
  let pendingControl = null;

  for (const token of bodyTokens) {
    curLine += (token.match(/\n/g) || []).length;
    if (/\b(?:if|else|while|for|foreach|switch|catch)\b/.test(token)) {
      pendingControl = { line: curLine };
    } else if (token === '{') {
      braceLevel++;
      if (pendingControl) {
        controlStack.push({ braceLevel, line: pendingControl.line });
        pendingControl = null;
        if (controlStack.length > maxControlDepth) {
          maxControlDepth = controlStack.length;
          maxDepthLine = curLine;
        }
      }
    } else if (token === '}') {
      if (controlStack.length > 0 && controlStack[controlStack.length - 1].braceLevel === braceLevel) {
        controlStack.pop();
      }
      braceLevel--;
    }
  }

  if (maxControlDepth >= maxNestingLimit) {
    const meta = RULE_REGISTRY.STRUCTURAL_WEIGHT_EXCEEDED;
    violations.push({
      filePath: relativePath,
      line: maxDepthLine,
      column: 1,
      hazard: `Excessive control flow nesting depth (${maxControlDepth} levels >= ${maxNestingLimit}) in method ${method.name}`,
      rule: 'STRUCTURAL_WEIGHT_EXCEEDED',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: 'Flatten control flow using early-return guard clauses or decomposed methods'
    });
  }

  const condRegex = /\b(?:if|while)\s*\(([\s\S]*?)\)/g;
  let condMatch;
  while ((condMatch = condRegex.exec(body)) !== null) {
    const expr = condMatch[1];
    const logicOps = (expr.match(/&&|\|\|/g) || []).length;
    if (logicOps >= 3) {
      const lineNum = method.startLine + body.slice(0, condMatch.index).split('\n').length - 1;
      const meta = RULE_REGISTRY.CONTROL_FLOW_INLINE_BOOLEAN;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: `Complex inline boolean condition detected in method ${method.name} (${logicOps} logical operators)`,
        rule: 'CONTROL_FLOW_INLINE_BOOLEAN',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
      break;
    }
  }
};

const checkCleanArchitectureAndCoupling = (content, relativePath, violations) => {
  const isController =
    relativePath.includes('/Controllers/') ||
    relativePath.endsWith('Controller.cs') ||
    /:\s*(?:ControllerBase|Controller)\b/.test(content) ||
    /\[ApiController\]/.test(content);

  if (!isController) return;

  const ctorRegex = /(?:public|internal)\s+(?:class\s+)?([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?::\s*(?:base|this)\s*\([^)]*\)\s*)?\{/g;
  let ctorMatch;

  while ((ctorMatch = ctorRegex.exec(content)) !== null) {
    const paramsText = ctorMatch[2].trim();
    if (!paramsText) continue;

    const lineNum = content.slice(0, ctorMatch.index).split('\n').length;
    const rawParams = paramsText.split(',').map((p) => p.trim()).filter(Boolean);

    if (rawParams.length > 5) {
      const meta = RULE_REGISTRY.COUPLING_EXCESSIVE_INJECTION;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: `Excessive constructor dependency injection (${rawParams.length} dependencies > 5 threshold) in controller`,
        rule: 'COUPLING_EXCESSIVE_INJECTION',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
    }

    const hasDbContext = rawParams.some((p) => {
      const isDb = /\b(?:[A-Za-z0-9_]*DbContext|DbContext|[A-Za-z0-9_]*Context)\b/.test(p);
      const isHttp = /\b(?:HttpContext|ActionContext|ControllerContext)\b/.test(p);
      return isDb && !isHttp;
    });

    const hasService = rawParams.some((p) => /\b(?:[A-Za-z0-9_]*Service|[A-Za-z0-9_]*Repository)\b/.test(p));

    if (hasDbContext) {
      const meta = RULE_REGISTRY.LAYER_VIOLATION_CONTROLLER;
      const hazardDesc = hasService
        ? 'Clean Architecture layer violation: Controller directly injects DbContext and service dependencies, bypassing MediatR CQRS'
        : 'Clean Architecture layer violation: Controller directly injects DbContext, bypassing application/MediatR layer';

      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: hazardDesc,
        rule: 'LAYER_VIOLATION_CONTROLLER',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
    }
  }

  const fromServicesDbMatches = content.matchAll(/\[FromServices\]\s*(?:[A-Za-z0-9_]*DbContext|DbContext|[A-Za-z0-9_]*Context)\b/g);
  for (const m of fromServicesDbMatches) {
    const lineNum = content.slice(0, m.index).split('\n').length;
    const meta = RULE_REGISTRY.LAYER_VIOLATION_CONTROLLER;
    violations.push({
      filePath: relativePath,
      line: lineNum,
      column: 1,
      hazard: 'Clean Architecture layer violation: Action method directly injects DbContext via [FromServices]',
      rule: 'LAYER_VIOLATION_CONTROLLER',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
  }
};

export const analyzeCSharpCode = (content, relativePath, violations, config = {}) => {
  const lines = content.split('\n');
  const maskedContent = maskCommentsAndStrings(content);

  const catchMatches = content.matchAll(/catch\s*(?:\([^)]*\))?\s*\{(?:\s*|\s*\/\/[^\n]*\s*)\}/g);
  for (const m of catchMatches) {
    const lineNum = content.slice(0, m.index).split('\n').length;
    const allowance = resolveCSharpCatchAllowance(m, { content, lines, maskedContent }, lineNum);
    if (allowance.isExempt) continue;
    const hazardParts = ['Empty or shallow catch block detected in C# handler/service'];
    if (allowance.isAnnotated) hazardParts.push(MISSING_REASON_NOTE);
    const meta = RULE_REGISTRY.AI_SLOP_SHALLOW_CATCH;
    violations.push({
      filePath: relativePath,
      line: lineNum,
      column: 1,
      hazard: hazardParts.join('; '),
      rule: 'AI_SLOP_SHALLOW_CATCH',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive,
      isAiSlop: true
    });
  }

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;

    if (SIMULATION_SWITCH_PATTERN.test(lineText)) {
      const meta = RULE_REGISTRY.AI_SLOP_LAZY_PLACEHOLDER;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: `Global simulation switch detected: "${lineText.trim()}" (unverified synthetic component mode)`,
        rule: 'AI_SLOP_LAZY_PLACEHOLDER',
        severity: 'CRITICAL',
        pillar: meta.pillar,
        directive: meta.directive,
        isAiSlop: true
      });
    }

    if (IN_MEMORY_DB_PATTERN.test(lineText)) {
      const meta = RULE_REGISTRY.SYNTHETIC_MOCK_DATA;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'UseInMemoryDatabase mock provider detected (unverified live persistence)',
        rule: 'SYNTHETIC_MOCK_DATA',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
    }

    if (SQLITE_PROVIDER_PATTERN.test(lineText)) {
      const meta = RULE_REGISTRY.SYNTHETIC_MOCK_DATA;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'SQLite provider detected in configuration or test setup (potential production database parity mismatch)',
        rule: 'SYNTHETIC_MOCK_DATA',
        severity: 'HIGH',
        pillar: meta.pillar,
        directive: 'Use Testcontainers or production-identical database engine for integration tests'
      });
    }

    if (SIMULATED_DELAY_PATTERN.test(lineText)) {
      const meta = RULE_REGISTRY.AI_SLOP_LAZY_PLACEHOLDER;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'Simulated Task.Delay detected (artificial asynchronous latency stub)',
        rule: 'AI_SLOP_LAZY_PLACEHOLDER',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive,
        isAiSlop: true
      });
    }

    if (HARDCODED_LIST_MOCK_PATTERN.test(lineText)) {
      const meta = RULE_REGISTRY.SYNTHETIC_MOCK_DATA;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'Hardcoded synthetic entity collection detected in C# service',
        rule: 'SYNTHETIC_MOCK_DATA',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
    }
  });

  const methods = extractMethods(maskedContent);
  for (const method of methods) {
    evaluateMethodComplexityAndNesting(method, relativePath, violations, config);
  }

  checkCleanArchitectureAndCoupling(content, relativePath, violations);

  return violations;
};
