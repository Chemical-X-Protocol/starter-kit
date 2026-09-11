export interface GeneratorOptions {
  readonly name?: string;
  readonly tier?: 'm' | 'a' | 'o' | 't';
  readonly framework?: 'react' | 'vue' | 'svelte';
  readonly dir?: string;
  readonly isLean?: boolean;
}

export declare function runGenerateWizard(rawArgs?: string[]): Promise<void>;
export declare function runGenerateCapsule(capsuleName: string): Promise<void>;
