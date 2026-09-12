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
  readonly isAiSlop?: boolean;
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
  readonly pricingModel?: string;
  readonly costPerMillion?: number;
  readonly excessCostPerPass?: number;
  readonly weeklyWastePerDev?: number;
  readonly monthlyWastePerDev?: number;
}

export interface HotspotFile {
  readonly filePath: string;
  readonly violationCount: number;
  readonly lineCount: number;
  readonly isMonolith: boolean;
  readonly monolithTier?: 'CRITICAL' | 'SEVERE' | 'WARNING' | null;
}

export interface AiSlopScore {
  readonly score: number;
  readonly grade: string;
  readonly label: string;
  readonly violationsCount: number;
  readonly breakdown: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
}

export interface AuditReport {
  readonly scannedFiles: number;
  readonly totalViolations: number;
  readonly metrics: CodebaseMetrics;
  readonly health: MolecularHealthScore;
  readonly aiSlop?: AiSlopScore;
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
export declare function calculateAiSlopScore(violations: readonly HazardViolation[], totalFiles: number): AiSlopScore;
export * from './reporter';
export * from './social';

export declare function buildGradeFPrompt(report: AuditReport): string;
export declare function buildGradeDPrompt(report: AuditReport): string;
export declare function buildGradeCPrompt(report: AuditReport): string;
export declare function buildGradeBPrompt(report: AuditReport): string;
export declare function buildMasterPrompt(report: AuditReport): string;
export declare function formatPromptBox(title: string, promptText: string): string;

export * from './history';

