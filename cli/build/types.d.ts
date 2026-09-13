export type BuildDiagnosticCategory =
  | 'TYPE_ERROR'
  | 'RESOLVE_ERROR'
  | 'SYNTAX_ERROR'
  | 'STYLE_ERROR'
  | 'BUDGET_WARNING'
  | 'COMPILER_WARNING'
  | 'RUNTIME_ERROR'
  | 'UNKNOWN';

export type BuildDiagnosticSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface BuildDiagnostic {
  readonly category: BuildDiagnosticCategory;
  readonly severity: BuildDiagnosticSeverity;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly code?: string;
  readonly message: string;
  readonly suggestion?: string;
  readonly rawSnippet?: string;
}

export interface BuildSummaryCounts {
  readonly total: number;
  readonly errors: number;
  readonly warnings: number;
  readonly files: number;
}

export interface BuildAuditReport {
  readonly success: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly command: string;
  readonly counts: BuildSummaryCounts;
  readonly categories: Record<string, number>;
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly rawTail: readonly string[];
}

export interface BuildOptions {
  readonly command?: string;
  readonly silent?: boolean;
  readonly json?: boolean;
  readonly summary?: boolean;
  readonly raw?: boolean;
  readonly cwd?: string;
}

export interface BuildExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly command: string;
}
