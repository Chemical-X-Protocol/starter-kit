import type { AuditReport } from './types';
import type { AuditSnapshot } from './history';

export interface DiscussionContent {
  readonly title: string;
  readonly category: string;
  readonly categorySlug: string;
  readonly body: string;
}

export interface GitRepoInfo {
  readonly owner: string;
  readonly repo: string;
  readonly nameWithOwner: string;
  readonly url: string;
}

export declare const DISCUSSION_CATEGORY: string;
export declare const DISCUSSION_CATEGORY_SLUG: string;
export declare const ORG_DISCUSSIONS_URL: string;
export declare const DEFAULT_DISCUSSION_REPO: string;

export declare function parseGitRemoteUrl(url: string): GitRepoInfo | null;
export declare function detectGitRepoInfo(cwd?: string): GitRepoInfo;
export declare function detectGitHubUser(preferredUser?: string): string;
export declare function copyToClipboard(text: string): boolean;
export declare function resolveBadgeColor(score: number): string;
export declare function resolveHotspotTierText(lineCount: number): string;
export declare function resolvePillarProgressionBadge(isImproved: boolean, beforeStatus: string, afterStatus: string): string;
export declare function formatWebUrl(url: string): string;
export declare function resolveExcessCostPerPass(tokensObj?: any, fallbackCostPerMillion?: number): number;
export declare function resolveMonthlyWastePerDev(tokensObj?: any, fallbackCostPerMillion?: number): number;
export declare function resolveWeeklyWastePerDev(tokensObj?: any, fallbackCostPerMillion?: number): number;
export declare function generateDiscussionContent(report: AuditReport, username: string, projectName?: string, repoUrl?: string, liveUrl?: string): DiscussionContent;
export declare function generateTransformationDiscussionContent(beforeSnapshot: AuditSnapshot, afterSnapshot: AuditSnapshot, username: string, projectName?: string, repoUrl?: string, liveUrl?: string): DiscussionContent;
export declare function publishDiscussionViaGh(repo: string, title: string, body: string, category?: string): { success: boolean; url: string | null; error?: string | null };
export declare function publishDiscussionViaHttp(token: string, repo: string, title: string, body: string, categoryName?: string): Promise<{ success: boolean; url: string | null; error?: string | null }>;
export declare function publishDiscussion(repo: string, title: string, body: string, category?: string): Promise<{ success: boolean; url: string | null; error?: string | null }>;

export interface StoredDiscussion {
  readonly repo: string;
  readonly number: number | null;
  readonly discussionId?: string | null;
  readonly url: string;
  readonly projectName?: string;
  readonly website?: string;
  readonly title: string;
  readonly lastPublishedAt: string;
}

export interface DiscussionPublishResult {
  readonly success: boolean;
  readonly url: string | null;
  readonly updated?: boolean;
  readonly discussionNumber?: number | null;
  readonly error?: string | null;
}

export declare function getStoredDiscussion(cwd?: string): StoredDiscussion | null;
export declare function saveStoredDiscussion(data: StoredDiscussion, cwd?: string): boolean;
export declare function clearStoredDiscussion(cwd?: string): boolean;
export declare function formatArchiveComment(previousTitle: string, previousBody: string): string;
export declare function publishOrUpdateDiscussion(
  repo?: string,
  title?: string,
  body?: string,
  category?: string,
  options?: { readonly projectName?: string; readonly website?: string }
): Promise<DiscussionPublishResult>;
