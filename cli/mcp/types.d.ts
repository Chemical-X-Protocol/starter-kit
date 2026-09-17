/**
 * Chemical X Protocol: Model Context Protocol (MCP) Server Types
 * Conforms to JSON-RPC 2.0 and MCP 2024-11-05 specifications.
 */

export interface JsonRpcRequest<T = any> {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: T;
}

export interface JsonRpcResponse<T = any> {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: T;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, unknown>;
    readonly required?: string[];
  };
}

export interface McpResourceDefinition {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpPromptDefinition {
  readonly name: string;
  readonly description: string;
  readonly arguments?: Array<{
    readonly name: string;
    readonly description: string;
    readonly required?: boolean;
  }>;
}

export interface QueryPatternsArgs {
  readonly dir?: string;
  readonly type?: 'ALL' | 'STATE_UNION' | 'UI_STRUCTURE' | 'PREDICATE_LOGIC' | 'HOOK_SIGNATURE';
  readonly minOccurrences?: number;
  readonly compact?: boolean;
}

export interface AutofixArgs {
  readonly path?: string;
  readonly dryRun?: boolean;
  readonly rules?: string[];
}

export interface AuditArgs {
  readonly path?: string;
  readonly strict?: boolean;
  readonly minGrade?: string;
  readonly minScore?: number;
  readonly model?: string;
}

export interface GenerateCapsuleArgs {
  readonly name: string;
  readonly framework: 'react' | 'vue' | 'svelte';
  readonly tier?: 'm' | 'a' | 'o' | 't';
  readonly targetDir?: string;
  readonly lean?: boolean;
}

export interface GetRefactorPromptArgs {
  readonly dir?: string;
  readonly scope?: 'master' | 'grade-f' | 'grade-d' | 'grade-c' | 'grade-b' | 'ai-slop' | 'hotspots';
}

export interface AuditBuildArgs {
  readonly command?: string;
  readonly raw?: boolean;
}

export interface ChemxQArgs {
  readonly query: string;
  readonly tier?: 'atom' | 'molecule' | 'organism' | 'template' | 'view' | 'hook' | 'all';
  readonly inspect?: boolean;
  readonly limit?: number;
}

export interface ChemxReadArgs {
  readonly path: string;
  readonly outline?: boolean;
  readonly symbol?: string;
  readonly stripComments?: boolean;
  readonly compact?: boolean;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface ChemxPatchArgs {
  readonly path: string;
  readonly targetContent: string;
  readonly replacementContent: string;
  readonly allowMultiple?: boolean;
}

export interface ChemxCheckArgs {
  readonly path: string;
}

export type McpToolHandler = (args?: any, cwd?: string) => Promise<any> | any;

export type McpToolMap = Record<string, McpToolHandler>;

export declare const Tools: McpToolMap;

export declare function executeMcpTool(name: string, args?: Record<string, any>, cwd?: string): Promise<any>;

