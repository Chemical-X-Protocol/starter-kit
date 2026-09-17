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
import { patchFile } from '../patcher.js';
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
  const hasCriticalOrHigh = report.violations.some((v) => v.severity === 'CRITICAL' || v.severity === 'HIGH');
  const isStrictFail = Boolean(args.strict) && report.violations.length > 0;
  const isScoreFail = typeof args.minScore === 'number' && report.health.score < args.minScore;

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
    isPassing: !isStrictFail && !isScoreFail && !hasCriticalOrHigh
  };
};

const handleGenerateCapsule = (args = {}, cwd = process.cwd()) => {
  const { name, framework, tier = 'm', targetDir = null, lean = false } = args;

  const hasName = Boolean(name && name.trim());
  const hasFramework = Boolean(framework && ['react', 'vue', 'svelte'].includes(framework.toLowerCase()));

  if (!hasName || !hasFramework) {
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

  let prompt = '';
  switch (scope) {
    case 'grade-f':
      prompt = buildGradeFPrompt(report);
      break;
    case 'grade-d':
      prompt = buildGradeDPrompt(report);
      break;
    case 'grade-c':
      prompt = buildGradeCPrompt(report);
      break;
    case 'grade-b':
      prompt = buildGradeBPrompt(report);
      break;
    case 'ai-slop':
      prompt = buildAiSlopPrompt(report);
      break;
    case 'hotspots':
      prompt = buildHotspotsPrompt(report);
      break;
    case 'master':
    default:
      prompt = buildMasterPrompt(report);
      break;
  }

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

const handleChemxPatch = (args = {}, cwd = process.cwd()) => {
  if (!args.path || args.targetContent === undefined || args.replacementContent === undefined) {
    throw new Error('chemx_patch requires "path", "targetContent", and "replacementContent" arguments.');
  }
  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  return patchFile(targetPath, {
    targetContent: args.targetContent,
    replacementContent: args.replacementContent,
    allowMultiple: Boolean(args.allowMultiple)
  });
};

const handleChemxCheck = (args = {}, cwd = process.cwd()) => {
  if (!args.path) {
    throw new Error('chemx_check requires "path" argument.');
  }
  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  return handleCheckCommand(targetPath, { isJson: true, isCli: false });
};

export const executeMcpTool = async (name, args = {}, cwd = process.cwd()) => {
  switch (name) {
    case 'chemx_query_patterns':
      return handleQueryPatterns(args, cwd);
    case 'chemx_audit':
      return handleAudit(args, cwd);
    case 'chemx_generate_capsule':
      return handleGenerateCapsule(args, cwd);
    case 'chemx_get_refactor_prompt':
      return handleGetRefactorPrompt(args, cwd);
    case 'chemx_audit_build':
      return handleAuditBuild(args);
    case 'chemx_autofix':
      return handleAutofix(args, cwd);
    case 'chemx_q':
      return handleChemxQ(args, cwd);
    case 'chemx_read':
      return handleChemxRead(args, cwd);
    case 'chemx_patch':
      return handleChemxPatch(args, cwd);
    case 'chemx_check':
      return handleChemxCheck(args, cwd);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};
