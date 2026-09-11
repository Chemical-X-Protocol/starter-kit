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
export declare function resolveTopSectionColor(report: AuditReport): string;
export declare function formatScorecardSection(report: AuditReport, themeColor?: string | null): string;
export declare function formatCriticalSection(report: AuditReport): string;
export declare function formatHighMediumSection(report: AuditReport): string;
export declare function formatLowSection(report: AuditReport): string;
export declare function formatPillarsSection(report: AuditReport, themeColor?: string | null): string;
export declare function formatHotspotsSection(report: AuditReport, themeColor?: string | null): string;
export declare function formatContextAnalysisSection(report: AuditReport, themeColor?: string | null): string;
export declare function formatFailuresSection(report: AuditReport): string;
export declare function formatPassesSection(report: AuditReport): string;
export declare function formatGradeFSection(report: AuditReport): string;
export declare function formatGradeDSection(report: AuditReport): string;
export declare function formatGradeCSection(report: AuditReport): string;
export declare function formatGradeBSection(report: AuditReport): string;
export declare function formatGradeASection(report: AuditReport): string;
export declare function getChemicalXAsciiBanner(gradeOrReport?: string | AuditReport | null): string;

export * from './social';

export declare function buildGradeFPrompt(report: AuditReport): string;
export declare function buildGradeDPrompt(report: AuditReport): string;
export declare function buildGradeCPrompt(report: AuditReport): string;
export declare function buildGradeBPrompt(report: AuditReport): string;
export declare function buildMasterPrompt(report: AuditReport): string;
export declare function formatPromptBox(title: string, promptText: string): string;

export * from './history';

