import type { HazardViolation, SeverityLevel, AuditReport } from './types';

export interface DirectoryHazardSummary {
  readonly directory: string;
  readonly total: number;
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly violations: readonly HazardViolation[];
  readonly topRules: readonly { readonly rule: string; readonly count: number }[];
}

export interface RuleDirectoryOccurrence {
  readonly directory: string;
  readonly count: number;
  readonly violations: readonly HazardViolation[];
}

export interface RuleHazardSummary {
  readonly rule: string;
  readonly severity: SeverityLevel;
  readonly pillar: string;
  readonly directive: string;
  readonly hazard: string;
  readonly isAiSlop: boolean;
  readonly total: number;
  readonly violations: readonly HazardViolation[];
  readonly directories: readonly RuleDirectoryOccurrence[];
}

export declare function resolveDirectory(filePath?: string): string;
export declare function groupViolationsByDirectory(violations?: readonly HazardViolation[]): readonly DirectoryHazardSummary[];
export declare function groupViolationsByRule(violations?: readonly HazardViolation[]): readonly RuleHazardSummary[];
export declare function formatCompactLocations(violations: readonly HazardViolation[], maxShown?: number): string;
export declare function renderGroupedViolationsTerminal(violations: readonly HazardViolation[]): string;
export declare function formatDirectoryDistributionSection(report: AuditReport, themeColor?: string | null): string;
export declare function formatDirectoryRollupMarkdown(violations?: readonly HazardViolation[]): string;
export declare function renderGroupedViolationsMarkdown(
  violations?: readonly HazardViolation[],
  options?: { readonly showSeverity?: boolean }
): string;
