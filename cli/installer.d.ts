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
  maxMoleculeLineCount: number;
}

export declare function resolveGitHooksDir(targetDir?: string): string | null;
export declare function buildPreCommitHookScript(minGrade?: string, minScore?: number): string;
export declare function buildGitHubWorkflowScript(minGrade?: string, minScore?: number): string;
export declare function installPreCommitHook(targetDir?: string, options?: InstallOptions): boolean;
export declare function installGitHubWorkflow(targetDir?: string, options?: InstallOptions): boolean;
export declare function saveProjectConfig(targetDir?: string, config?: Partial<ProjectConfig>): void;
export declare function areGuardrailsInstalled(targetDir?: string): boolean;
export declare function ensurePackageScripts(targetDir?: string): boolean;
export declare function installAgentSearchConfig(targetDir?: string): Promise<boolean>;
export declare function runInstallWizard(targetDir?: string): Promise<void>;

