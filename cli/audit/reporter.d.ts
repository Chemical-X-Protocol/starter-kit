import type { AuditReport } from './types';

export * from './reporter-ascii';
export * from './reporter-banner';
export * from './reporter-sections';
export * from './reporter-summary';
export * from './reporter-grouping';

export declare function formatTerminalReport(report: AuditReport): string;
export declare function generateMarkdownReport(report: AuditReport): string;
export declare function resolveTopSectionColor(report: AuditReport): string;
export declare function formatGradeFSection(report: AuditReport): string;
export declare function formatGradeDSection(report: AuditReport): string;
export declare function formatGradeCSection(report: AuditReport): string;
export declare function formatGradeBSection(report: AuditReport): string;
export declare function formatGradeASection(report: AuditReport): string;
