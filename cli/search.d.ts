export interface SymbolRecord {
  readonly name: string;
  readonly kind: string;
  readonly isExport: boolean;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly signature?: string;
}

export interface PropRecord {
  readonly name: string;
  readonly type?: string;
}

export interface ImportRecord {
  readonly importedSymbol: string;
  readonly sourceModule: string;
  readonly line: number;
}

export interface FileIndexRecord {
  readonly path: string;
  readonly tier: 'atom' | 'molecule' | 'organism' | 'template' | 'view' | 'hook' | 'type' | 'utility';
  readonly lines: number;
  readonly chars: number;
  readonly mtime: number;
  readonly size: number;
  readonly symbols: readonly SymbolRecord[];
  readonly props: readonly PropRecord[];
  readonly hooks: readonly string[];
  readonly imports?: readonly ImportRecord[];
  readonly healthScore?: number;
  readonly hazardCount?: number;
}

export interface ViolationRecord {
  readonly filePath: string;
  readonly rule: string;
  readonly severity: string;
  readonly pillar: string;
  readonly line: number;
  readonly hazard: string;
  readonly directive: string;
}

export interface SymbolDefinition {
  readonly name: string;
  readonly kind: string;
  readonly isExport: boolean;
  readonly startLine: number;
  readonly endLine: number;
  readonly signature: string;
  readonly filePath: string;
  readonly tier: string;
  readonly totalLines: number;
}

export interface ReferenceRecord {
  readonly importerPath: string;
  readonly importedSymbol: string;
  readonly sourceModule: string;
  readonly line: number;
  readonly tier: string;
}

export interface ContextPack {
  readonly file: Partial<FileIndexRecord>;
  readonly dependencies: readonly ImportRecord[];
  readonly dependents: readonly ReferenceRecord[];
  readonly hazards: readonly ViolationRecord[];
}

export interface SearchOptions {
  readonly query?: string;
  readonly tier?: string | null;
  readonly limit?: number;
  readonly isJson?: boolean;
  readonly isInspect?: boolean;
  readonly isReindex?: boolean;
  readonly targetDir?: string;
}

export interface SearchResultPayload {
  readonly query: string;
  readonly tier: string | null;
  readonly count: number;
  readonly durationMs: number;
  readonly results: readonly FileIndexRecord[];
}

export declare function syncSearchIndex(
  targetDir?: string,
  cwd?: string,
  options?: { reindex?: boolean }
): { db: any; updatedCount: number; totalFiles: number } | null;

export declare function runSearch(
  rawArgs?: string[],
  isCli?: boolean
): Promise<any>;

export declare function resolveTargetDir(
  customOrFlag?: string | null,
  dirFlag?: string | null
): string;

export declare function findSymbolDefinition(
  db: any,
  symbolName: string
): SymbolDefinition | null;

export declare function findSymbolReferences(
  db: any,
  symbolName: string
): readonly ReferenceRecord[];

export declare function findFileDependencies(
  db: any,
  filePath: string
): readonly ImportRecord[];

export declare function findFileDependents(
  db: any,
  filePath: string
): readonly ReferenceRecord[];

export declare function syncViolationsIndex(
  db: any,
  violations?: readonly any[]
): number;

export declare function queryViolations(
  db: any,
  options?: {
    rule?: string | null;
    severity?: string | null;
    filePath?: string | null;
    limit?: number;
  }
): readonly ViolationRecord[];

export interface AuditSnapshotRecord {
  readonly timestamp: number;
  readonly score: number;
  readonly grade: string;
  readonly asi: number;
  readonly totalLoc: number;
  readonly scannedFiles: number;
  readonly criticalCount: number;
  readonly highMedCount: number;
  readonly lowCount: number;
}

export declare function recordAuditSnapshot(
  db: any,
  report: any
): { timestamp: number; score: number; grade: string; asi: number } | null;

export declare function getAuditProgression(
  db: any,
  limit?: number
): readonly AuditSnapshotRecord[];

export declare function queryFilesByHealth(
  db: any,
  options?: {
    status?: string;
    limit?: number;
  }
): readonly any[];

export interface SingleFileIndexResult {
  readonly db: any;
  readonly status: 'indexed' | 'deleted';
  readonly path: string;
  readonly tier?: string;
  readonly lines?: number;
  readonly symbolsCount?: number;
  readonly propsCount?: number;
  readonly hooksCount?: number;
}

export declare function syncSingleFileIndex(
  targetPath: string,
  cwd?: string
): SingleFileIndexResult | null;

