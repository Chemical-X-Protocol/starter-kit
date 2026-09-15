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
