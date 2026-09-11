import type { MolecularHealthScore, CodebaseMetrics, PillarStatus, ContextTokenAnalysis, AuditReport } from './types';

export interface AuditSnapshot {
  readonly id: string;
  readonly timestamp: string;
  readonly health: MolecularHealthScore;
  readonly metrics: CodebaseMetrics;
  readonly violations: {
    readonly total: number;
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
  readonly monoliths: {
    readonly total: number;
    readonly extreme: number;
    readonly severe: number;
    readonly warning: number;
  };
  readonly tokens: ContextTokenAnalysis;
  readonly pillars: Record<string, {
    readonly status: PillarStatus;
    readonly violations: number;
    readonly critical: number;
  }>;
}

export interface PillarDelta {
  readonly beforeStatus: PillarStatus;
  readonly afterStatus: PillarStatus;
  readonly beforeViolations: number;
  readonly afterViolations: number;
  readonly improved: boolean;
}

export interface TransformationDelta {
  readonly scoreDelta: number;
  readonly critDelta: number;
  readonly totalDelta: number;
  readonly monolithDelta: number;
  readonly tokensDelta: number;
  readonly costPassBefore?: number;
  readonly costPassAfter?: number;
  readonly costPassDelta?: number;
  readonly monthlyTaxBefore?: number;
  readonly monthlyTaxAfter?: number;
  readonly monthlyTaxDelta?: number;
  readonly pillarDeltas: Record<string, PillarDelta>;
  readonly isImproved: boolean;
}

export interface SaveSnapshotResult {
  readonly snapshot: AuditSnapshot;
  readonly history: readonly AuditSnapshot[];
  readonly baseline: AuditSnapshot | null;
  readonly isNewBaseline: boolean;
  readonly totalAudits: number;
}

export declare function ensureChemxDir(cwd?: string): string;
export declare function createSnapshotFromReport(report: AuditReport): AuditSnapshot;
export declare function getAuditHistory(cwd?: string): AuditSnapshot[];
export declare function getAuditBaseline(cwd?: string): AuditSnapshot | null;
export declare function setAuditBaseline(snapshot: AuditSnapshot, cwd?: string): AuditSnapshot;
export declare function saveAuditSnapshot(report: AuditReport, cwd?: string): SaveSnapshotResult;
export declare function calculateTransformationDelta(beforeSnapshot: AuditSnapshot, afterSnapshot: AuditSnapshot): TransformationDelta;
export declare function formatTransformationTerminal(beforeSnapshot: AuditSnapshot, afterSnapshot: AuditSnapshot): string;
export declare function formatHistoryTimelineTerminal(history: readonly AuditSnapshot[]): string;
