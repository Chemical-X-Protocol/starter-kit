import type { AuditReport } from './audit/types';

export declare function resolveGradeColor(grade: string): string;
export declare function resolveGradeBadge(grade: string): string;
export declare function resolveCriticalGrade(count: number): string;
export declare function resolveHighMedGrade(count: number): string;
export declare function resolveLowGrade(count: number): string;
export declare function resolvePillarGrade(pillars: Record<string, unknown>): string;
export declare function resolveHotspotGrade(hotspots: readonly { readonly lineCount: number }[]): string;
export declare function resolveContextGrade(riskTier: string): string;

export declare function extractPromptFromContent(content: string): string | null;
export declare function showPagedContent(content: string, promptText?: string | null): Promise<void>;
export declare function showConversionMenu(onScaffold?: (() => Promise<void>) | null): Promise<void>;
export declare function handleShareToDiscussions(report: AuditReport): Promise<void>;
export declare function runInteractiveAuditNavigator(report: AuditReport, onScaffold?: (() => Promise<void>) | null): Promise<void>;
