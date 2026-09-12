import type { AuditReport } from './audit/types';

export declare function resolveGradeColor(grade: string): string;
export declare function resolveGradeBadge(grade: string, width?: number): string;
export declare function resolveHealthHearts(grade: string, score?: number, isAnsi?: boolean): string;
export declare function resolveCriticalGrade(count: number): string;
export declare function resolveHighMedGrade(count: number): string;
export declare function resolveLowGrade(count: number): string;
export declare function resolvePillarGrade(pillars: Record<string, unknown>): string;
export declare function resolveHotspotGrade(hotspots: readonly { readonly lineCount: number }[]): string;
export declare function resolveContextGrade(riskTier: string): string;

export interface NavigatorMenuItem {
  key?: string;
  grade?: string;
  tag: string;
  label: string;
  index?: number;
  action: () => Promise<void>;
}

export declare function formatButtonTag(label: string, color?: string, width?: number): string;
export declare function buildNavigatorMenu(
  topActions: readonly NavigatorMenuItem[],
  activeGrades: readonly NavigatorMenuItem[],
  midActions: readonly NavigatorMenuItem[],
  bottomActions: readonly NavigatorMenuItem[]
): { menuItems: NavigatorMenuItem[]; menuOptions: string[] };

export declare function extractPromptFromContent(content: string): string | null;
export declare function showPagedContent(content: string, promptText?: string | null): Promise<void>;
export declare function showConversionMenu(onScaffold?: (() => Promise<void>) | null): Promise<void>;
export declare function handleShareToDiscussions(report: AuditReport): Promise<void>;
export declare function renderDashboardBanner(
  health: AuditReport['health'],
  metrics: AuditReport['metrics'],
  violations: AuditReport['violations'],
  critical: readonly unknown[],
  highMediumCount: number,
  low: readonly unknown[],
  contextAnalysis?: AuditReport['contextAnalysis'] | null
): void;
export declare function runInteractiveAuditNavigator(
  report: AuditReport,
  onScaffold?: (() => Promise<void>) | null,
  onReAudit?: (() => Promise<AuditReport> | AuditReport) | null
): Promise<void>;
