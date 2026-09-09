export interface HazardViolation {
  filePath: string;
  line: number;
  hazard: string;
  rule: string;
  directive: string;
}

export interface AuditReport {
  scannedFiles: number;
  totalViolations: number;
  violations: HazardViolation[];
}

export declare function auditFile(filePath: string, relativePath: string): HazardViolation[];
export declare function scanDirectory(targetDir: string, baseDir: string): HazardViolation[];
export declare function runAudit(targetDir?: string): AuditReport;

declare const _default: {
  auditFile: typeof auditFile;
  scanDirectory: typeof scanDirectory;
  runAudit: typeof runAudit;
};

export default _default;
