import type { AuditReport } from './audit/types';

export declare function resolveGradeColor(grade: string): string;
export declare function resolveGradeBadge(grade: string, width?: number): string;
export declare function resolveHealthHearts(grade: string, score?: number, isAnsi?: boolean): string;
export declare function resolveCriticalGrade(count: number): string;
export declare function resolveHighMedGrade(count: number): string;
export declare function resolveLowGrade(count: number): string;
export declare function resolvePillarGrade(pillars: Record<string, unknown>): string;
export declare function resolveIndividualPillarGrade(pillarData: unknown): string;
export declare function resolvePillarRiskWeight(pillarData: unknown): number;
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
  ...sections: readonly (readonly NavigatorMenuItem[])[]
): { menuItems: NavigatorMenuItem[]; menuOptions: string[] };

export type NavigatorSectionId = 'fix' | 'grades' | 'setup' | 'track' | 'general';
export interface NavigatorSection {
  readonly id: NavigatorSectionId;
  readonly items: NavigatorMenuItem[];
}
export interface NavigatorSectionInput {
  readonly actions: Record<string, unknown>;
  readonly grades?: readonly (NavigatorMenuItem & { readonly name?: string; readonly violations?: number })[];
  readonly guardrailsInstalled?: boolean;
  readonly queryIndexInstalled?: boolean;
}
export declare function planNavigatorSections(input: NavigatorSectionInput): NavigatorSection[];

export declare function extractPromptFromContent(content: string): string | null;
export declare function showPagedContent(content: string, promptText?: string | null): Promise<void>;
export declare function showConversionMenu(onScaffold?: (() => Promise<void>) | null): Promise<void>;
export interface ShareOptions {
  readonly isYes?: boolean;
  readonly isInteractive?: boolean;
}
export interface ShareResult {
  readonly status: 'pass' | 'fail' | 'inconclusive';
  readonly posted: boolean;
  readonly reason: string | null;
  readonly url?: string | null;
}
export declare function handleShareToDiscussions(report: AuditReport, options?: ShareOptions): Promise<ShareResult>;
export interface DashboardBannerOptions {
  readonly clear?: boolean;
  readonly interactive?: boolean;
}

export declare function renderDashboardBanner(
  health: AuditReport['health'],
  metrics: AuditReport['metrics'],
  violations: AuditReport['violations'],
  critical: readonly unknown[],
  highMediumCount: number,
  low: readonly unknown[],
  contextAnalysis?: AuditReport['contextAnalysis'] | null,
  aiSlop?: AuditReport['aiSlop'] | null,
  options?: DashboardBannerOptions
): void;
export declare function runInteractiveAuditNavigator(
  report: AuditReport,
  onScaffold?: (() => Promise<void>) | null,
  onReAudit?: (() => Promise<AuditReport> | AuditReport) | null
): Promise<void>;
