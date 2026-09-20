export interface TemplateOptions {
  readonly atomsPackage?: string | null;
  readonly hasController?: boolean;
}

export interface ArchetypeDefinition {
  readonly id: string;
  readonly name: string;
  readonly keywords: readonly string[];
  readonly destructure?: string;
  readonly buildState?: (name: string, pascal: string) => string;
  readonly buildProps?: (name: string, pascal: string) => string;
  readonly buildController?: (name: string, pascal: string) => string;
  readonly buildReactBody?: (name: string, pascal: string) => string;
}

export declare const ALL_ARCHETYPES: readonly ArchetypeDefinition[];
export declare function resolveArchetype(slug?: string): ArchetypeDefinition;

export declare function toPascalCase(str: string): string;
export declare function toCamelCase(str: string): string;

export declare function buildReactComponent(name: string, pascalName: string, options?: TemplateOptions): string;
export declare function buildVueComponent(name: string, pascalName: string, options?: TemplateOptions): string;
export declare function buildSvelteComponent(name: string, pascalName: string, options?: TemplateOptions): string;

export declare function buildController(name: string, pascalName: string): string;
export declare function buildComponentSpec(name: string, pascalName: string, hasController?: boolean): string;
export declare function buildIndex(name: string, pascalName: string, ext: string, hasController?: boolean): string;

export declare function buildPropsType(name: string, pascalName: string): string;
export declare function buildStateType(name: string, pascalName: string): string;
export declare function buildTypesIndex(fileNames?: string[]): string;
export declare function buildTypes(name: string, pascalName: string): string;

export declare function buildScss(name: string): string;

export declare function buildHook(name: string, camelName: string, pascalName: string): string;
export declare function buildHookOptionsType(pascalName: string): string;
export declare function buildHookReturnType(pascalName: string): string;
export declare function buildHookIndex(name: string, camelName: string): string;
export declare function buildHookSpec(name: string, camelName: string): string;

export declare function buildReactView(name: string, pascalName: string): string;
export declare function buildVueView(name: string, pascalName: string): string;
export declare function buildSvelteView(name: string, pascalName: string): string;
export declare function buildViewParamsType(pascalName: string): string;
export declare function buildViewIndex(name: string, pascalName: string, ext: string): string;
export declare function buildViewSpec(name: string, pascalName: string): string;
