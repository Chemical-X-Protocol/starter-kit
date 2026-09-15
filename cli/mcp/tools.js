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

export const MCP_TOOLS = [
  {
    name: 'chemx_query_patterns',
    description: 'Execute single-pass AST fingerprinting across candidate files or directory to discover cross-file clones, duplicated predicates, shared state machines, and parallel controller returns before decomposing monoliths (Chemical X Directive 1.F Pre-Split Pattern Discovery).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Target directory or path to scan (defaults to "src" or current working directory).'
        },
        type: {
          type: 'string',
          enum: ['ALL', 'STATE_UNION', 'UI_STRUCTURE', 'PREDICATE_LOGIC', 'HOOK_SIGNATURE'],
          description: 'Filter pattern types: STATE_UNION (shared state machines), UI_STRUCTURE (cloned JSX layouts), PREDICATE_LOGIC (duplicated booleans), HOOK_SIGNATURE (parallel hooks).'
        },
        minOccurrences: {
          type: 'number',
          description: 'Minimum file occurrences required to qualify as a candidate (default: 2).'
        },
        compact: {
          type: 'boolean',
          description: 'Enable token-conserving compact output (unique files and top 3 samples only, defaults to true).'
        }
      }
    }
  },
  {
    name: 'chemx_autofix',
    description: 'Execute deterministic remediation of safe code violations (typography em dashes, leaked markdown fences, conversational residue comments, and lazy truncation placeholders) with token-compact summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Target file or directory path to autofix (defaults to "src").'
        },
        dryRun: {
          type: 'boolean',
          description: 'Simulate changes without writing files to disk (defaults to false).'
        },
        rules: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional rule filters (TYPOGRAPHY_EM_DASH, AI_SLOP_CONVERSATIONAL_ARTIFACT, AI_SLOP_LAZY_PLACEHOLDER).'
        }
      }
    }
  },
  {
    name: 'chemx_audit',
    description: 'Run the 7-Pillar Chemical X static AST audit on a file or directory. Analyzes line budgets, 2-stage booleans, hook saturation, self-cleaning timers, anti-Tailwind soup, AI slop, and token burn metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Target file or directory path to audit (defaults to "src").'
        },
        strict: {
          type: 'boolean',
          description: 'Strict mode: fail on any violation including low-severity hygiene issues.'
        },
        minGrade: {
          type: 'string',
          description: 'Minimum acceptable health grade tier (A+, A, B, C, D).'
        },
        minScore: {
          type: 'number',
          description: 'Minimum acceptable score out of 100.'
        },
        model: {
          type: 'string',
          description: 'Pricing baseline for token context burn analysis (claude, gpt4o, blended).'
        }
      }
    }
  },
  {
    name: 'chemx_generate_capsule',
    description: 'Deterministically generate a compliant Chemical X crystalline capsule directory (component, controller hook, mixin-only SCSS, co-located types, barrel index) for React 19, Vue 3.4+, or Svelte 5.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Capsule feature name (e.g. "m-spark-kpi", "a-action-button", "user-avatar").'
        },
        framework: {
          type: 'string',
          enum: ['react', 'vue', 'svelte'],
          description: 'Target framework flavor: React 19 (TSX), Vue 3.4+ (SFC script setup), or Svelte 5 (Runes).'
        },
        tier: {
          type: 'string',
          enum: ['m', 'a', 'o', 't'],
          description: 'Architectural tier: m (molecule < 100 lines), a (atom), o (organism), t (template).'
        },
        targetDir: {
          type: 'string',
          description: 'Destination parent directory. Defaults to detected components directory.'
        },
        lean: {
          type: 'boolean',
          description: 'When true, skip generating controller and SCSS files (useful for minimal UI atoms).'
        }
      },
      required: ['name', 'framework']
    }
  },
  {
    name: 'chemx_get_refactor_prompt',
    description: 'Synthesize targeted Chemical X AI refactoring prompts for Grade F critical hazards, Grade D high debts, Grade C medium debts, AI slop artifacts, or monolithic hotspots.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Target directory to analyze (defaults to "src").'
        },
        scope: {
          type: 'string',
          enum: ['master', 'grade-f', 'grade-d', 'grade-c', 'grade-b', 'ai-slop', 'hotspots'],
          description: 'Prompt scope to generate (default: "master").'
        }
      }
    }
  },
  {
    name: 'chemx_audit_build',
    description: 'Wrap and audit a build command with token-conserving silent execution. Suppresses compiler noise and catalogs diagnostics into structured categories (TypeScript, Vite/Rollup, Style, Budget).',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Build command to run (defaults to project build script e.g. "npm run build").'
        }
      }
    }
  }
];

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
        return {
          ...base,
          files: p.uniqueFiles || Array.from(new Set((p.occurrences || []).map((o) => o.filePath))),
          sampleOccurrences: (p.occurrences || []).slice(0, 3).map((o) => ({
            file: o.filePath,
            line: o.line
          }))
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
  return runBuildAudit(rawArgs, false);
};

const handleAutofix = (args = {}, cwd = process.cwd()) => {
  return runAutofix(args.path, {
    dryRun: Boolean(args.dryRun),
    rules: args.rules,
    cwd
  });
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};
