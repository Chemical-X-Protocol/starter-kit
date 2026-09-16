export interface PreflightResult {
  readonly targetDir: string;
  readonly fast: boolean;
  readonly fileList: readonly string[] | null;
}

export interface PreflightOptions {
  readonly customDir?: string | null;
  readonly defaultDir?: string;
  readonly cwd?: string;
}

export declare function detectCandidateDirectories(cwd?: string): string[];
export declare function resolveGitAuditScope(cwd?: string): { ok: boolean; files: string[] };
export declare function getGitChangedFiles(cwd?: string): string[];
export declare function runAuditPreflight(rawArgs: readonly string[], options?: PreflightOptions): Promise<PreflightResult>;
