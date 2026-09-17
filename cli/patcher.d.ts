export interface PatchOptions {
  readonly targetContent: string;
  readonly replacementContent: string;
  readonly allowMultiple?: boolean;
  readonly cwd?: string;
  readonly skipIndex?: boolean;
  readonly skipCheck?: boolean;
}

export interface LineBudgetResult {
  readonly lines: number;
  readonly limit: number;
  readonly passed: boolean;
  readonly warning: string | null;
}

export interface PatchResult {
  readonly file: string;
  readonly status: 'ok';
  readonly replaced: number | 'all';
  readonly originalLines: number;
  readonly newLines: number;
  readonly lineDelta: number;
  readonly indexed: boolean;
  readonly lineBudget: LineBudgetResult;
  readonly isClean: boolean;
  readonly violationsCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly violations: readonly any[];
}

export declare function patchFile(
  targetPath: string,
  params: PatchOptions
): PatchResult;

export declare function runPatcherCli(
  args: readonly string[],
  isCli?: boolean
): PatchResult | null;

export interface WriteOptions {
  readonly content: string;
  readonly cwd?: string;
  readonly skipIndex?: boolean;
  readonly skipCheck?: boolean;
}

export interface WriteResult {
  readonly file: string;
  readonly status: 'ok';
  readonly created: boolean;
  readonly lines: number;
  readonly indexed: boolean;
  readonly lineBudget: LineBudgetResult;
  readonly isClean: boolean;
  readonly violationsCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly violations: readonly any[];
}

export declare function writeFile(
  targetPath: string,
  params: WriteOptions
): WriteResult;

export declare function runWriterCli(
  args: readonly string[],
  isCli?: boolean
): WriteResult | null;

