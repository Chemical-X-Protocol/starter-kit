export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type PillarStatus = 'PASSED' | 'WARN' | 'FAILED';
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH';

export interface HazardViolation {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly hazard: string;
  readonly rule: string;
  readonly severity: SeverityLevel;
  readonly pillar: string;
  readonly directive: string;
}

export interface FileStat {
  readonly fullPath: string;
  readonly relativePath: string;
  readonly lineCount: number;
  readonly charCount: number;
  readonly isMolecule: boolean;
}

export interface CodebaseMetrics {
  readonly scannedFiles: number;
  readonly totalLoc: number;
  readonly avgLoc: number;
  readonly largestFile: {
    readonly filePath: string;
    readonly lineCount: number;
  };
  readonly moleculeCount: number;
  readonly moleculeCompliantCount: number;
  readonly moleculeCompliantPct: number;
  readonly hookCount: number;
}

export interface MolecularHealthScore {
  readonly score: number;
  readonly grade: string;
  readonly label: string;
}

export type QuantumHealthScore = MolecularHealthScore;

export interface PillarData {
  readonly pillarKey: string;
  violations: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  status: PillarStatus;
}

export interface ContextTokenAnalysis {
  readonly estimatedTokens: number;
  readonly estimatedExcessTokens: number;
  readonly potentialSavingsPct: number;
  readonly riskLevel: RiskLevel;
}

export interface HotspotFile {
  readonly filePath: string;
  readonly violationCount: number;
  readonly lineCount: number;
  readonly isMonolith: boolean;
  readonly monolithTier?: 'CRITICAL' | 'SEVERE' | 'WARNING' | null;
}

export interface AuditReport {
  readonly scannedFiles: number;
  readonly totalViolations: number;
  readonly metrics: CodebaseMetrics;
  readonly health: MolecularHealthScore;
  readonly pillars: Record<string, PillarData>;
  readonly contextAnalysis: ContextTokenAnalysis;
  readonly hotspots: readonly HotspotFile[];
  readonly violations: readonly HazardViolation[];
}

export interface AuditOptions {
  readonly dir?: string;
  readonly json?: boolean;
  readonly markdown?: boolean;
  readonly outputFile?: string;
  readonly strict?: boolean;
}

export interface SeverityGroupedViolations {
  readonly critical: readonly HazardViolation[];
  readonly high: readonly HazardViolation[];
  readonly medium: readonly HazardViolation[];
  readonly low: readonly HazardViolation[];
}

export declare function groupViolationsBySeverity(violations: readonly HazardViolation[]): SeverityGroupedViolations;
export declare function auditCode(content: string, filePath: string, relativePath: string): HazardViolation[];
export declare function auditFile(filePath: string, relativePath: string): HazardViolation[];
export declare function scanDirectory(targetDir: string, baseDir: string): HazardViolation[];
export declare function runAudit(targetDir?: string, options?: AuditOptions): AuditReport;
export declare function formatTerminalReport(report: AuditReport): string;
export declare function generateMarkdownReport(report: AuditReport): string;
export declare function formatScorecardSection(report: AuditReport): string;
export declare function formatCriticalSection(report: AuditReport): string;
export declare function formatHighMediumSection(report: AuditReport): string;
export declare function formatLowSection(report: AuditReport): string;
export declare function formatPillarsSection(report: AuditReport): string;
export declare function formatHotspotsSection(report: AuditReport): string;
export declare function formatContextAnalysisSection(report: AuditReport): string;
export declare function formatFailuresSection(report: AuditReport): string;
export declare function formatPassesSection(report: AuditReport): string;
export declare function formatGradeFSection(report: AuditReport): string;
export declare function formatGradeDSection(report: AuditReport): string;
export declare function formatGradeCSection(report: AuditReport): string;
export declare function formatGradeBSection(report: AuditReport): string;
export declare function formatGradeASection(report: AuditReport): string;
export declare function getChemicalXAsciiBanner(): string;

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
export declare function generateDiscussionContent(report: AuditReport, username: string, projectName?: string, repoUrl?: string): DiscussionContent;
export declare function publishDiscussionViaGh(repo: string, title: string, body: string, category?: string): { success: boolean; url: string | null; error?: string | null };
export declare function publishDiscussionViaHttp(token: string, repo: string, title: string, body: string, categoryName?: string): Promise<{ success: boolean; url: string | null; error?: string | null }>;
export declare function publishDiscussion(repo: string, title: string, body: string, category?: string): Promise<{ success: boolean; url: string | null; error?: string | null }>;

export declare function buildGradeFPrompt(report: AuditReport): string;
export declare function buildGradeDPrompt(report: AuditReport): string;
export declare function buildGradeCPrompt(report: AuditReport): string;
export declare function buildGradeBPrompt(report: AuditReport): string;
export declare function buildMasterPrompt(report: AuditReport): string;
export declare function formatPromptBox(title: string, promptText: string): string;

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
export declare function generateTransformationDiscussionContent(beforeSnapshot: AuditSnapshot, afterSnapshot: AuditSnapshot, username: string, projectName?: string, repoUrl?: string): DiscussionContent;
