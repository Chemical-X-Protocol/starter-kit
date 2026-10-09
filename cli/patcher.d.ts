export interface MutationSafetyOptions {
  readonly cwd?: string;
  readonly skipIndex?: boolean;
  readonly skipCheck?: boolean;
  /** Validate and diff without writing. */
  readonly dryRun?: boolean;
  /** Top-level declarations this edit may remove (a net loss is otherwise refused). */
  readonly allowRemoved?: readonly string[];
  /** Caller identity for team lock checks (default $CHEMX_AGENT_ID, else '@agent'). */
  readonly agentId?: string;
}

export interface PatchOptions extends MutationSafetyOptions {
  readonly targetContent: string;
  readonly replacementContent: string;
  readonly allowMultiple?: boolean;
}

export interface LineBudgetResult {
  readonly lines: number;
  readonly limit: number;
  readonly passed: boolean;
  readonly warning: string | null;
}

export interface DeclarationDelta {
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

export interface GuardrailResult {
  readonly lineBudget: LineBudgetResult;
  readonly isClean: boolean;
  readonly violationsCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly violations: readonly any[];
}

export interface PatchResult extends GuardrailResult {
  readonly file: string;
  readonly status: 'ok';
  readonly dryRun: boolean;
  readonly replaced: number;
  readonly matchLines: readonly number[];
  readonly changedLines: { readonly start: number; readonly end: number };
  readonly eol: 'as-is' | 'crlf-normalized';
  readonly originalLines: number;
  readonly newLines: number;
  readonly lineDelta: number;
  readonly indexed: boolean;
  readonly backup: string | null;
  readonly declarations: DeclarationDelta;
  /** Uncapped unified diff of the change. */
  readonly diff: string;
}

export declare function patchFile(
  targetPath: string,
  params: PatchOptions
): PatchResult;

export declare function runPatcherCli(
  args: readonly string[],
  isCli?: boolean
): PatchResult | null;

export interface WriteOptions extends MutationSafetyOptions {
  readonly content: string;
  /** Required to replace an existing file. */
  readonly overwrite?: boolean;
}

export interface WriteResult extends GuardrailResult {
  readonly file: string;
  readonly status: 'ok';
  readonly dryRun: boolean;
  readonly created: boolean;
  readonly lines: number;
  readonly indexed: boolean;
  readonly backup: string | null;
  readonly declarations: DeclarationDelta;
  readonly diff: string;
}

export declare function writeFile(
  targetPath: string,
  params: WriteOptions
): WriteResult;

export declare function runWriterCli(
  args: readonly string[],
  isCli?: boolean
): WriteResult | null;
