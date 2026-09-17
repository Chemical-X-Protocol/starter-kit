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

const FALLBACK_VIEW_TEMPLATE = `import React from 'react';

export interface ViewTemplateProps {
  readonly title: string;
  readonly children: React.ReactNode;
}

export const ViewTemplate: React.FC<ViewTemplateProps> = ({ title, children }) => {
  return (
    <main className="view-template">
      <header className="view-template__header">
        <h1 className="view-template__title">{title}</h1>
      </header>
      <div className="view-template__content">
        {children}
      </div>
    </main>
  );
};

export default ViewTemplate;
`;

const FALLBACK_MOLECULE_TEMPLATE = `import React from 'react';
import { AtomSurface, AtomText, AtomBadge, AtomButton } from '../../atoms';
import type { MSampleCardProps, SampleCardBadgeDescriptor } from './types';

export const resolveBadgeDescriptor = (
  status: 'active' | 'archived',
  isHighValue: boolean
): SampleCardBadgeDescriptor => {
  if (status !== 'active') {
    return {
      text: status,
      className: 'm-sample-card__badge m-sample-card__badge--archived'
    };
  }

  if (isHighValue) {
    return {
      text: status,
      className: 'm-sample-card__badge m-sample-card__badge--high-value'
    };
  }

  return {
    text: status,
    className: 'm-sample-card__badge m-sample-card__badge--standard'
  };
};

export const MSampleCard: React.FC<MSampleCardProps> = ({
  title,
  subtitle,
  value,
  status = 'active',
  onAction
}) => {
  const isHighValue = value > 1000;
  const badge = resolveBadgeDescriptor(status, isHighValue);

  const handleActionClick = () => {
    if (!onAction) return;
    onAction();
  };

  return (
    <AtomSurface className="m-sample-card">
      <AtomSurface className="m-sample-card__header">
        <AtomSurface className="m-sample-card__title-group">
          <AtomText as="h3" className="m-sample-card__title">{title}</AtomText>
          {subtitle && <AtomText as="p" className="m-sample-card__subtitle">{subtitle}</AtomText>}
        </AtomSurface>
        <AtomBadge className={badge.className}>
          {badge.text}
        </AtomBadge>
      </AtomSurface>
      <AtomSurface className="m-sample-card__body">
        <AtomText className="m-sample-card__value">
          \${value.toLocaleString()}
        </AtomText>
        {onAction && (
          <AtomButton
            type="button"
            className="m-sample-card__action"
            onClick={handleActionClick}
          >
            Action
          </AtomButton>
        )}
      </AtomSurface>
    </AtomSurface>
  );
};

export default MSampleCard;
`;

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
      const candidatePaths = [
        path.resolve(cwd, '.chemx', 'blueprints', 'view-template.tsx'),
        path.resolve(cwd, 'blueprints', 'view-template.tsx'),
        path.resolve(starterKitRoot, 'blueprints', 'view-template.tsx')
      ];
      const foundPath = candidatePaths.find((p) => fs.existsSync(p));
      const content = foundPath ? fs.readFileSync(foundPath, 'utf-8') : FALLBACK_VIEW_TEMPLATE;
      return {
        uri,
        mimeType: 'text/plain',
        text: content
      };
    }

    case 'chemx://blueprints/molecule': {
      const candidatePaths = [
        path.resolve(cwd, '.chemx', 'blueprints', 'molecule-capsule', 'm-tab-button', 'm-tab-button.vue'),
        path.resolve(cwd, '.chemx', 'blueprints', 'molecule-capsule', 'm-sample-card.tsx'),
        path.resolve(cwd, 'blueprints', 'molecule-capsule', 'm-tab-button', 'm-tab-button.vue'),
        path.resolve(cwd, 'blueprints', 'molecule-capsule', 'm-sample-card.tsx')
      ];
      const foundPath = candidatePaths.find((p) => fs.existsSync(p));
      const content = foundPath ? fs.readFileSync(foundPath, 'utf-8') : FALLBACK_MOLECULE_TEMPLATE;
      return {
        uri,
        mimeType: 'text/plain',
        text: content
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
