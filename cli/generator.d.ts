export interface GeneratorOptions {
  readonly name?: string;
  readonly tier?: 'm' | 'a' | 'o' | 't';
  readonly framework?: 'react' | 'vue' | 'svelte';
  readonly targetParent?: string | null;
  readonly isLean?: boolean;
  readonly cwd?: string;
}

export interface CapsuleResult {
  readonly capsuleName: string;
  readonly pascalName: string;
  readonly framework: string;
  readonly tier: string;
  readonly targetDir: string;
  readonly relativeDir: string;
  readonly filesCreated: string[];
}

export declare function detectBaseDir(cwd?: string): string;
export declare function createCapsuleFiles(options: GeneratorOptions): CapsuleResult;
export declare function printGenerateHelp(): void;
export declare function runGenerateWizard(rawArgs?: string[]): Promise<any>;
export declare function runGenerateCapsule(capsuleName: string): Promise<any>;
