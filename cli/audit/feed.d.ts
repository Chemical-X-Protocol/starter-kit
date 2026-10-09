import type { AuditSnapshot } from './history';

export type AuditFeedView = 'history' | 'pillars' | 'scopes';

export interface AuditFeedFilters {
  /** Exact scope, or a parent: 'apps' matches 'apps' and 'apps/x' but not 'appsx'. */
  readonly scope?: string;
  /** ISO date or timestamp; keeps runs at or after it. */
  readonly since?: string;
  /** Drop --fast/--git runs, which check only part of a scope. */
  readonly fullOnly?: boolean;
}

interface RunIdentity {
  readonly runId: string | null;
  readonly timestamp: string | null;
  readonly scope: string | null;
  readonly isPartial: boolean;
  readonly ruleset: number | null;
}

export interface AuditHistoryRow extends RunIdentity {
  readonly scoreModel: number | null;
  readonly healthScore: number | null;
  readonly grade: string | null;
  readonly aiSlopScore: number | null;
  readonly aiSlopGrade: string | null;
  readonly files: number | null;
  readonly loc: number | null;
  readonly violations: number | null;
  readonly critical: number | null;
  readonly high: number | null;
  readonly medium: number | null;
  readonly low: number | null;
  readonly monoliths: number | null;
}

export interface AuditPillarRow extends RunIdentity {
  readonly pillar: string;
  readonly status: string | null;
  readonly violations: number | null;
  readonly critical: number | null;
}

export interface AuditScopeRow {
  readonly scope: string;
  readonly runs: number;
  readonly runId: string | null;
  readonly lastFullRunAt: string | null;
  readonly ruleset: number | null;
  readonly scoreModel: number | null;
  readonly healthScore: number | null;
  readonly grade: string | null;
  readonly aiSlopScore: number | null;
  readonly files: number | null;
  readonly loc: number | null;
  readonly violations: number | null;
  readonly critical: number | null;
  readonly high: number | null;
  readonly medium: number | null;
  readonly low: number | null;
  readonly monoliths: number | null;
  readonly gatePassing: boolean | null;
  readonly gateBasis: string | null;
  readonly gateRegressions: number | null;
  readonly coverageAstPct: number | null;
  readonly statusUpdatedAt: string | null;
  readonly statusIsPartial: boolean;
}

export declare const FEED_VIEWS: readonly AuditFeedView[];
export declare function historyRows(history?: readonly AuditSnapshot[], filters?: AuditFeedFilters): AuditHistoryRow[];
export declare function pillarRows(history?: readonly AuditSnapshot[], filters?: AuditFeedFilters): AuditPillarRow[];
export declare function scopeRows(history?: readonly AuditSnapshot[], status?: unknown, filters?: AuditFeedFilters): AuditScopeRow[];
export declare function readAuditFeed(view: 'history', options?: AuditFeedFilters & { cwd?: string }): AuditHistoryRow[];
export declare function readAuditFeed(view: 'pillars', options?: AuditFeedFilters & { cwd?: string }): AuditPillarRow[];
export declare function readAuditFeed(view: 'scopes', options?: AuditFeedFilters & { cwd?: string }): AuditScopeRow[];
