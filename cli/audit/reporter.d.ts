import type { AuditReport } from './types';

export * from './reporter-ascii';
export * from './reporter-banner';
export * from './reporter-sections';
export * from './reporter-summary';
export * from './reporter-grouping';

export interface FormatGradeOptions {
  readonly includePrompt?: boolean;
}

export declare function formatTerminalReport(report: AuditReport): string;
export declare function generateMarkdownReport(report: AuditReport): string;
export declare function resolveTopSectionColor(report: AuditReport): string;
export declare function formatGradeFSection(report: AuditReport, options?: FormatGradeOptions): string;
export declare function formatGradeDSection(report: AuditReport, options?: FormatGradeOptions): string;
export declare function formatGradeCSection(report: AuditReport, options?: FormatGradeOptions): string;
export declare function formatGradeBSection(report: AuditReport, options?: FormatGradeOptions): string;
export declare function formatGradeASection(report: AuditReport): string;
export declare function formatPillarReactionBadgesTerminal(pillars?: Record<string, unknown>): string;
export declare function formatPillarReactionBadgesMarkdown(pillars?: Record<string, unknown>): string;
export declare const PILLAR_SHORT_NAMES: Record<string, string>;
export declare function resolveBadgeColor(score: number): string;
export declare function formatPillarShieldBadges(pillars?: Record<string, unknown>): string;
