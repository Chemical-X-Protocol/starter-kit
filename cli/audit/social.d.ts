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
export declare function generateDiscussionContent(report: AuditReport, username: string, projectName?: string, repoUrl?: string): DiscussionContent;
export declare function generateTransformationDiscussionContent(beforeSnapshot: AuditSnapshot, afterSnapshot: AuditSnapshot, username: string, projectName?: string, repoUrl?: string): DiscussionContent;
export declare function publishDiscussionViaGh(repo: string, title: string, body: string, category?: string): { success: boolean; url: string | null; error?: string | null };
export declare function publishDiscussionViaHttp(token: string, repo: string, title: string, body: string, categoryName?: string): Promise<{ success: boolean; url: string | null; error?: string | null }>;
export declare function publishDiscussion(repo: string, title: string, body: string, category?: string): Promise<{ success: boolean; url: string | null; error?: string | null }>;
