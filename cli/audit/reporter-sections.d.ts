import type { AuditReport } from './types';

export declare function formatScorecardSection(report: AuditReport, themeColor?: string | null): string;
export declare function formatCriticalSection(report: AuditReport): string;
export declare function formatHighMediumSection(report: AuditReport): string;
export declare function formatLowSection(report: AuditReport): string;
export declare function formatPillarsSection(report: AuditReport, themeColor?: string | null): string;
export declare function formatSinglePillarSection(report: AuditReport, pillarName: string, themeColor?: string | null): string;
export declare function formatHotspotsSection(report: AuditReport, themeColor?: string | null): string;
export declare function formatContextAnalysisSection(report: AuditReport, themeColor?: string | null): string;
export declare function formatAiSlopSection(report: AuditReport, themeColor?: string | null): string;
