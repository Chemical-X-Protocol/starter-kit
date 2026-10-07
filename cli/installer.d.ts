export interface InstallOptions {
  minGrade?: string;
  minScore?: number;
  maxLines?: number;
  maxMoleculeLines?: number;
}

export interface ProjectConfig {
  minGrade: string;
  minScore: number;
  maxLineCount: number;
  /**
   * @deprecated Legacy fixed molecule budget. Nothing reads it any more: the pre-commit
   * hook derives the molecule budget from the project profile, and the installer drops it.
   */
  maxMoleculeLineCount?: number;
}

export declare function resolveGitHooksDir(targetDir?: string): string | null;
export declare function buildPreCommitHookScript(minGrade?: string, minScore?: number): string;
export declare function buildGitHubWorkflowScript(minGrade?: string, minScore?: number): string;
export declare function installPreCommitHook(targetDir?: string, options?: InstallOptions): boolean;
export declare function installGitHubWorkflow(targetDir?: string, options?: InstallOptions): boolean;
export declare function buildInstallerProjectConfig(
  opts?: InstallOptions,
  existing?: Record<string, unknown>
): Record<string, unknown> & Omit<ProjectConfig, 'maxMoleculeLineCount'>;
export declare function saveProjectConfig(targetDir?: string, config?: Partial<ProjectConfig>): void;
export declare function areGuardrailsInstalled(targetDir?: string): boolean;
export declare function ensurePackageScripts(targetDir?: string): boolean;
export declare function installAgentSearchConfig(targetDir?: string): Promise<boolean>;
export declare function runInstallWizard(targetDir?: string): Promise<void>;

