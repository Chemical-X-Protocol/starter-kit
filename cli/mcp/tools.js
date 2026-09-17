import fs from 'node:fs';
import path from 'node:path';
import { runAudit as executeAstAudit, auditFile } from '../audit.js';
import {
  buildMasterPrompt,
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildAiSlopPrompt,
  buildHotspotsPrompt
} from '../audit/prompts.js';
import { createCapsuleFiles } from '../generator.js';
import { runBuildAudit } from '../build.js';
import { runAutofix } from '../audit/autofix.js';
import { syncSearchIndex } from '../search.js';
import { openIndexDb, queryIndex } from '../search-db.js';
import { readTokenOptimized } from '../reader.js';
import { patchFile, writeFile } from '../patcher.js';
import { toColumnar } from '../columnar.js';
import { handleCheckCommand } from '../search-commands.js';
import { MCP_TOOLS } from './manifests.js';

export { MCP_TOOLS };


const handleQueryPatterns = (args = {}, cwd = process.cwd()) => {
  const targetDir = args.dir || (fs.existsSync(path.resolve(cwd, 'src')) ? 'src' : '.');
  const report = executeAstAudit(targetDir, {});
  const rawPatterns = report.patterns || [];
  const filterType = args.type || 'ALL';
  const minOccurrences = typeof args.minOccurrences === 'number' ? args.minOccurrences : 2;
  const isCompact = args.compact !== false;

  const matchesType = (p) => filterType === 'ALL' || p.type === filterType;
  const matchesCount = (p) => p.fileCount >= minOccurrences;

  const candidates = rawPatterns
    .filter((p) => matchesType(p) && matchesCount(p))
    .map((p) => {
      const base = {
        id: p.id,
        type: p.type,
        label: p.label,
        detail: p.detail,
        suggestedCapsule: p.suggestedCapsule,
        recommendation: p.recommendation,
        fileCount: p.fileCount,
        totalHits: p.totalHits,
        impactScore: p.impactScore
      };

      if (isCompact) {
        const sampleOccurrences = [];
        const seenSampleFiles = new Set();
        for (const occ of (p.occurrences || [])) {
          if (!seenSampleFiles.has(occ.filePath)) {
            seenSampleFiles.add(occ.filePath);
            sampleOccurrences.push({
              file: occ.filePath,
              line: occ.line
            });
            if (sampleOccurrences.length >= 3) break;
          }
        }

        return {
          ...base,
          files: p.uniqueFiles || Array.from(new Set((p.occurrences || []).map((o) => o.filePath))),
          sampleOccurrences
        };
      }

      return {
        ...base,
        occurrences: p.occurrences
      };
    });

  return {
    scannedDir: targetDir,
    totalCandidates: candidates.length,
    compact: isCompact,
    candidates
  };
};

const handleAudit = (args = {}, cwd = process.cwd()) => {
  const rawTarget = args.path || (fs.existsSync(path.resolve(cwd, 'src')) ? 'src' : '.');
  const resolvedTarget = path.resolve(cwd, rawTarget);
  const isFile = fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isFile();

  if (isFile) {
    const relPath = path.relative(cwd, resolvedTarget);
    const violations = auditFile(resolvedTarget, relPath);
    return {
      type: 'file',
      target: relPath,
      violationCount: violations.length,
      violations
    };
  }

  const options = {
    model: args.model || 'blended'
  };

  const report = executeAstAudit(rawTarget, options);
  const isSevereViolation = (v) => {
    const isCritical = v.severity === 'CRITICAL';
    const isHigh = v.severity === 'HIGH';
    return isCritical || isHigh;
  };

  const hasCriticalOrHigh = report.violations.some(isSevereViolation);
  const hasViolations = report.violations.length > 0;
  const isStrictFail = Boolean(args.strict) && hasViolations;
  const hasMinScore = typeof args.minScore === 'number';
  const isScoreFail = hasMinScore && report.health.score < args.minScore;

  const hasFailingCondition = isStrictFail || isScoreFail || hasCriticalOrHigh;
  const isPassing = !hasFailingCondition;

  return {
    type: 'directory',
    target: rawTarget,
    health: report.health,
    metrics: report.metrics,
    aiSlop: report.aiSlop,
    hotspots: report.hotspots,
    totalViolations: report.totalViolations,
    violations: report.violations,
    contextAnalysis: report.contextAnalysis,
    isPassing
  };
};

const handleGenerateCapsule = (args = {}, cwd = process.cwd()) => {
  const { name, framework, tier = 'm', targetDir = null, lean = false } = args;

  const hasName = Boolean(name && name.trim());
  const hasValidFramework = Boolean(framework && ['react', 'vue', 'svelte'].includes(framework.toLowerCase()));
  const canGenerate = hasName && hasValidFramework;

  if (!canGenerate) {
    throw new Error('chemx_generate_capsule requires "name" and "framework" (react, vue, svelte).');
  }

  const result = createCapsuleFiles({
    name: name.trim(),
    framework: framework.toLowerCase(),
    tier: tier.toLowerCase(),
    targetParent: targetDir,
    isLean: Boolean(lean),
    cwd
  });

  return {
    success: true,
    capsuleName: result.capsuleName,
    pascalName: result.pascalName,
    framework: result.framework,
    tier: result.tier,
    targetDir: result.targetDir,
    relativeDir: result.relativeDir,
    filesCreated: result.filesCreated
  };
};

const handleGetRefactorPrompt = (args = {}, cwd = process.cwd()) => {
  const targetDir = args.dir || (fs.existsSync(path.resolve(cwd, 'src')) ? 'src' : '.');
  const scope = args.scope || 'master';
  const report = executeAstAudit(targetDir, {});

  const PROMPT_BUILDERS = {
    'grade-f': buildGradeFPrompt,
    'grade-d': buildGradeDPrompt,
    'grade-c': buildGradeCPrompt,
    'grade-b': buildGradeBPrompt,
    'ai-slop': buildAiSlopPrompt,
    'hotspots': buildHotspotsPrompt,
    'master': buildMasterPrompt
  };

  const builder = Object.prototype.hasOwnProperty.call(PROMPT_BUILDERS, scope)
    ? PROMPT_BUILDERS[scope]
    : buildMasterPrompt;
  const prompt = builder(report);

  return {
    targetDir,
    scope,
    prompt: prompt || 'No violations found for the requested scope.'
  };
};

const handleAuditBuild = async (args = {}) => {
  const rawArgs = ['--json'];
  if (args.command) {
    rawArgs.push('--', args.command);
  }
  return runBuildAudit(rawArgs, false, { print: false });
};

const handleAutofix = (args = {}, cwd = process.cwd()) => {
  return runAutofix(args.path, {
    dryRun: Boolean(args.dryRun),
    rules: args.rules,
    cwd
  });
};

const handleChemxQ = (args = {}, cwd = process.cwd()) => {
  const query = args.query;
  if (!query) {
    throw new Error('chemx_q requires "query" argument.');
  }
  const db = openIndexDb(cwd);
  if (!db) {
    syncSearchIndex('src', cwd);
  }
  const activeDb = openIndexDb(cwd);
  if (!activeDb) {
    throw new Error('Unable to initialize Chemical X AST search index database.');
  }

  const limit = typeof args.limit === 'number' ? args.limit : 20;
  const results = queryIndex(activeDb, {
    query,
    tier: args.tier || 'all',
    limit
  });

  if (args.columnar) {
    return toColumnar(results, ['path', 'tier', 'lines', 'symbols', 'props', 'hooks'], {
      symbols: (r) => (r.symbols || []).map((s) => s.name),
      props: (r) => (r.props || []).map((p) => p.name),
      hooks: (r) => r.hooks || []
    });
  }

  if (args.inspect) {
    return results.map((r) => ({
      path: r.path,
      tier: r.tier,
      lines: r.lines,
      symbols: (r.symbols || []).map((s) => s.name),
      props: (r.props || []).map((p) => p.name),
      hooks: r.hooks || []
    }));
  }

  const lines = results.map((r) => {
    const mainSym = (r.symbols || []).find((s) => s.isExport)?.name || '';
    const symPart = mainSym ? ` (${mainSym})` : '';
    const hookPart = (r.hooks && r.hooks.length > 0) ? ` [${r.hooks.slice(0, 2).join(',')}]` : '';
    return `[${r.tier.toUpperCase()}] ${r.path}:${r.lines}L${symPart}${hookPart}`;
  });

  return lines.length > 0 ? lines.join('\n') : `No matching capsules or symbols for "${query}"`;
};

const handleChemxRead = (args = {}, cwd = process.cwd()) => {
  if (!args.path) {
    throw new Error('chemx_read requires "path" argument.');
  }
  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  const res = readTokenOptimized(targetPath, {
    outline: args.outline,
    symbol: args.symbol,
    stripComments: args.stripComments,
    compact: args.compact,
    startLine: args.startLine,
    endLine: args.endLine
  });

  const header = `// ${res.file} (${res.lineCount || res.totalLines} lines, ~${res.tokensEst} tokens)\n`;
  return header + res.content;
};

const isSevereViolation = (v) => {
  const isCritical = v.severity === 'CRITICAL';
  const isHigh = v.severity === 'HIGH';
  return isCritical || isHigh;
};

const formatPatchWarnings = (result) => {
  const warnings = [];

  // Stage 1: Atomic Concept Declarations
  const hasLineBudget = Boolean(result.lineBudget);
  const isBudgetExceeded = hasLineBudget && !result.lineBudget.passed;

  // Stage 2: Clean Conditionals
  if (isBudgetExceeded) {
    warnings.push(`[Directive 1.A] ${result.lineBudget.warning}`);
  }

  const violations = result.violations || [];
  for (const v of violations) {
    const isSevere = isSevereViolation(v);
    if (isSevere) {
      warnings.push(`[${v.severity} - ${v.rule}] Line ${v.line}: ${v.hazard} -> ${v.directive || ''}`);
    }
  }

  const hasWarnings = warnings.length > 0;
  return hasWarnings ? warnings : undefined;
};

const handleChemxPatch = (args = {}, cwd = process.cwd()) => {
  // Stage 1: Atomic Concept Declarations
  const hasPath = Boolean(args.path);
  const hasTargetContent = args.targetContent !== undefined;
  const hasReplacementContent = args.replacementContent !== undefined;

  // Stage 2: Unified Decision Variable
  const hasRequiredArgs = hasPath && hasTargetContent && hasReplacementContent;

  // Stage 3: Early-Return Guard Clause
  if (!hasRequiredArgs) {
    throw new Error('chemx_patch requires "path", "targetContent", and "replacementContent" arguments.');
  }

  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  const result = patchFile(targetPath, {
    targetContent: args.targetContent,
    replacementContent: args.replacementContent,
    allowMultiple: Boolean(args.allowMultiple),
    cwd
  });

  return {
    ...result,
    warnings: formatPatchWarnings(result)
  };
};

const handleChemxCheck = (args = {}, cwd = process.cwd()) => {
  if (!args.path) {
    throw new Error('chemx_check requires "path" argument.');
  }
  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  return handleCheckCommand(targetPath, { isJson: true, isCli: false });
};

const handleChemxWrite = (args = {}, cwd = process.cwd()) => {
  // Stage 1: Atomic Concept Declarations
  const hasPath = Boolean(args.path);
  const hasContent = args.content !== undefined;

  // Stage 2: Unified Decision Variable
  const hasRequiredArgs = hasPath && hasContent;

  // Stage 3: Early-Return Guard Clause
  if (!hasRequiredArgs) {
    throw new Error('chemx_write requires "path" and "content" arguments.');
  }

  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  const result = writeFile(targetPath, {
    content: args.content,
    cwd
  });

  return {
    ...result,
    warnings: formatPatchWarnings(result)
  };
};

export const Tools = {
  chemx_query_patterns: handleQueryPatterns,
  chemx_audit: handleAudit,
  chemx_generate_capsule: handleGenerateCapsule,
  chemx_get_refactor_prompt: handleGetRefactorPrompt,
  chemx_audit_build: handleAuditBuild,
  chemx_autofix: handleAutofix,
  chemx_q: handleChemxQ,
  chemx_read: handleChemxRead,
  chemx_patch: handleChemxPatch,
  chemx_write: handleChemxWrite,
  chemx_check: handleChemxCheck
};

export const executeMcpTool = async (name, args = {}, cwd = process.cwd()) => {
  const handle = Object.prototype.hasOwnProperty.call(Tools, name) ? Tools[name] : null;
  if (!handle) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handle(args, cwd);
};

