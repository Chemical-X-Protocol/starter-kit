import type { BuildAuditReport, BuildOptions } from './build/types.js';

export function runBuildAudit(
  rawArgs?: readonly string[],
  isCli?: boolean
): Promise<BuildAuditReport>;

export {
  BuildDiagnostic,
  BuildDiagnosticCategory,
  BuildDiagnosticSeverity,
  BuildSummaryCounts,
  BuildAuditReport,
  BuildOptions,
  BuildExecutionResult
} from './build/types.js';
