export interface SymbolRecord {
  readonly name: string;
  readonly kind: string;
  readonly isExport: boolean;
}

export interface PropRecord {
  readonly name: string;
  readonly type?: string;
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
): Promise<readonly FileIndexRecord[]>;
