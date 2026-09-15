import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit as executeAstAudit } from '../audit.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const starterKitRoot = path.resolve(currentDir, '..', '..');

export const MCP_RESOURCES = [
  {
    uri: 'chemx://directives',
    name: 'Chemical X Architecture Directives',
    description: 'Mandatory Chemical X Molecular Architecture directives and standards (AGENTS.md).',
    mimeType: 'text/markdown'
  },
  {
    uri: 'chemx://blueprints/view-template',
    name: 'Declarative View Template Blueprint',
    description: 'Reference 10-20 line declarative Table-of-Contents view template assembling molecules via named slots.',
    mimeType: 'text/plain'
  },
  {
    uri: 'chemx://blueprints/molecule',
    name: 'Crystalline Molecule Blueprint',
    description: 'Reference self-contained molecule capsule blueprint with controller, types, SCSS, and component.',
    mimeType: 'text/plain'
  },
  {
    uri: 'chemx://scorecard',
    name: 'Current Project Molecular Health Scorecard',
    description: 'Live Molecular Health Index (MHI) grade, score, metrics, and active architectural hazards.',
    mimeType: 'application/json'
  }
];

const readLocalFileSafely = (filePath) => {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return '';
};

export const readMcpResource = async (uri, cwd = process.cwd()) => {
  switch (uri) {
    case 'chemx://directives': {
      const projectAgents = path.resolve(cwd, 'AGENTS.md');
      const rootAgents = path.resolve(starterKitRoot, 'AGENTS.md');
      const content = readLocalFileSafely(projectAgents) || readLocalFileSafely(rootAgents);
      return {
        uri,
        mimeType: 'text/markdown',
        text: content || '# Chemical X Molecular Architecture Directives\nNo AGENTS.md found.'
      };
    }

    case 'chemx://blueprints/view-template': {
      const blueprintPath = path.resolve(starterKitRoot, 'blueprints', 'view-template.tsx');
      const content = readLocalFileSafely(blueprintPath);
      return {
        uri,
        mimeType: 'text/plain',
        text: content || '// view-template.tsx blueprint not found'
      };
    }

    case 'chemx://blueprints/molecule': {
      const sampleVue = path.resolve(starterKitRoot, 'blueprints', 'molecule-capsule', 'm-tab-button', 'm-tab-button.vue');
      const sampleTsx = path.resolve(starterKitRoot, 'blueprints', 'molecule-capsule', 'm-sample-card.tsx');
      const content = readLocalFileSafely(sampleVue) || readLocalFileSafely(sampleTsx);
      return {
        uri,
        mimeType: 'text/plain',
        text: content || '// molecule blueprint not found'
      };
    }

    case 'chemx://scorecard': {
      const targetDir = fs.existsSync(path.resolve(cwd, 'src')) ? 'src' : '.';
      const report = executeAstAudit(targetDir, {});
      const severityRollup = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
      for (const v of report.violations || []) {
        if (severityRollup[v.severity] !== undefined) {
          severityRollup[v.severity]++;
        }
      }
      const topHotspots = (report.hotspots || []).slice(0, 3).map((h) => ({
        file: h.filePath,
        lines: h.lineCount,
        violations: h.violationsCount
      }));

      const scorecard = {
        grade: report.health?.grade || 'N/A',
        score: report.health?.score ?? 100,
        status: report.health?.isPassing ? 'PASS' : 'FAIL',
        scannedFiles: report.metrics?.scannedFiles || 0,
        totalLoc: report.metrics?.totalLoc || 0,
        moleculeCompliantPct: report.metrics?.moleculeCompliantPct ?? 100,
        severityRollup,
        totalViolations: report.totalViolations || 0,
        topHotspots,
        patternCandidatesCount: (report.patterns || []).length
      };
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(scorecard, null, 2)
      };
    }

    default:
      throw new Error(`Resource not found: ${uri}`);
  }
};
