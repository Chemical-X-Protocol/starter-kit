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
import { runTypecheckAudit, runTestAudit, runProjectVerify } from '../verify.js';
import { syncSearchIndex, syncViolationsIndex, recordAuditSnapshot } from '../search.js';
import { MCP_TOOLS, ALL_MCP_TOOLS } from './manifests.js';
import {
  resolveTargetCwd,
  handleChemxQ,
  handleChemxRead,
  handleChemxPatch,
  handleChemxCheck,
  handleChemxWrite
} from './tools-search.js';
import {
  handleChemxTeamStatus,
  handleChemxTeamFeed,
  handleChemxTeamPost,
  handleChemxTeamTask,
  handleChemxTeamLock,
  handleChemxReportIssue
} from './tools-team.js';

export {
  MCP_TOOLS,
  ALL_MCP_TOOLS,
  handleChemxQ,
  handleChemxRead,
  handleChemxPatch,
  handleChemxCheck,
  handleChemxWrite,
  handleChemxTeamStatus,
  handleChemxTeamFeed,
  handleChemxTeamPost,
  handleChemxTeamTask,
  handleChemxTeamLock,
  handleChemxReportIssue
};

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
    model: args.model || 'blended',
    outputFile: null
  };

  const report = executeAstAudit(rawTarget, options);

  // Sync AST audit results to SQLite index database
  try {
    const syncRes = syncSearchIndex(rawTarget, cwd);
    if (syncRes?.db) {
      syncViolationsIndex(syncRes.db, report.violations);
      recordAuditSnapshot(syncRes.db, report);
    }
  } catch {
    // Continue if SQLite synchronization fails
  }

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

const handleAuditBuild = async (args = {}, cwd = process.cwd()) => {
  const targetCwd = args.dir ? path.resolve(cwd, args.dir) : cwd;
  const rawArgs = ['--json'];
  if (args.command) {
    rawArgs.push('--', args.command);
  }
  return runBuildAudit(rawArgs, false, { print: false, cwd: targetCwd });
};

const handleAutofix = (args = {}, cwd = process.cwd()) => {
  return runAutofix(args.path, {
    dryRun: Boolean(args.dryRun),
    rules: args.rules,
    cwd
  });
};

const handleChemxTypecheck = async (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  const targetCwd = args.dir ? path.resolve(baseCwd, args.dir) : baseCwd;
  return runTypecheckAudit([], false, {
    json: true,
    command: args.command,
    print: false,
    cwd: targetCwd
  });
};

const handleChemxTest = async (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  const targetCwd = args.dir ? path.resolve(baseCwd, args.dir) : baseCwd;
  return runTestAudit([], false, {
    json: true,
    command: args.command,
    print: false,
    cwd: targetCwd
  });
};

const handleChemxVerify = async (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  return runProjectVerify([], false, {
    json: true,
    targetDir: args.dir,
    includeBuild: Boolean(args.includeBuild),
    print: false,
    cwd: baseCwd
  });
};

const handleChemx = async (args = {}, cwd = process.cwd()) => {
  let action = args.action;
  let params = args.params || {};

  if (args.command && typeof args.command === 'string') {
    const parts = args.command.trim().split(/\s+/);
    const subCmd = parts[0];
    if (subCmd === 'audit') {
      action = 'audit';
      params = { path: parts[1] || 'src', ...params };
    } else if (subCmd === 'build') {
      action = 'build';
      params = { dir: parts[1] || '.', ...params };
    } else if (subCmd === 'verify') {
      action = 'verify';
    } else if (subCmd === 'typecheck') {
      action = 'typecheck';
    } else if (subCmd === 'test') {
      action = 'test';
    } else if (subCmd === 'check') {
      action = 'check';
      params = { path: parts[1] || 'src', ...params };
    } else if (subCmd === 'read') {
      action = 'read';
      const hasOutline = args.command.includes('--outline');
      const symbolMatch = args.command.match(/--symbol=([^\s]+)/);
      params = {
        path: parts[1],
        outline: hasOutline,
        symbol: symbolMatch ? symbolMatch[1] : undefined,
        ...params
      };
    } else if (subCmd === 'q' || subCmd === 'search') {
      action = 'q';
      params = { query: parts.slice(1).join(' '), ...params };
    } else if (subCmd === 'team') {
      const teamAction = parts[1] || 'status';
      if (teamAction === 'status') action = 'team_status';
      else if (teamAction === 'feed') action = 'team_feed';
      else if (teamAction === 'task') action = 'team_task';
      else if (teamAction === 'lock') action = 'team_lock';
      else action = 'team_task';
    } else if (subCmd === 'autofix') {
      action = 'autofix';
      params = { path: parts[1] || 'src', ...params };
    }
  }

  const DISPATCHER = {
    audit: handleAudit,
    build: handleAuditBuild,
    verify: handleChemxVerify,
    typecheck: handleChemxTypecheck,
    test: handleChemxTest,
    check: handleChemxCheck,
    patch: handleChemxPatch,
    write: handleChemxWrite,
    read: handleChemxRead,
    team: handleChemxTeamTask,
    team_status: handleChemxTeamStatus,
    team_feed: handleChemxTeamFeed,
    team_post: handleChemxTeamPost,
    team_task: handleChemxTeamTask,
    team_lock: handleChemxTeamLock,
    q: handleChemxQ,
    search: handleChemxQ,
    autofix: handleAutofix,
    generate: handleGenerateCapsule,
    patterns: handleQueryPatterns,
    issue: handleChemxReportIssue
  };

  const handler = Object.prototype.hasOwnProperty.call(DISPATCHER, action)
    ? DISPATCHER[action]
    : Tools[`chemx_${action}`];

  if (!handler) {
    throw new Error(`Unknown Chemical X action: "${action}". Valid actions: ${Object.keys(DISPATCHER).join(', ')}`);
  }

  return handler(params, cwd);
};

export const Tools = {
  chemx: handleChemx,
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
  chemx_check: handleChemxCheck,
  chemx_typecheck: handleChemxTypecheck,
  chemx_test: handleChemxTest,
  chemx_verify: handleChemxVerify,
  chemx_team_status: handleChemxTeamStatus,
  chemx_team_feed: handleChemxTeamFeed,
  chemx_team_post: handleChemxTeamPost,
  chemx_team_task: handleChemxTeamTask,
  chemx_team_lock: handleChemxTeamLock,
  chemx_report_issue: handleChemxReportIssue
};

export const executeMcpTool = async (name, args = {}, cwd = process.cwd()) => {
  const toolName = name === 'chemx_master' ? 'chemx' : name;
  const handle = Object.prototype.hasOwnProperty.call(Tools, toolName) ? Tools[toolName] : null;
  if (!handle) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handle(args, cwd);
};

