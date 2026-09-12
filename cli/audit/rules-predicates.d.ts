import type * as babelTypes from '@babel/types';

export declare function isComponentPath(path: string): boolean;
export declare function isCodeLine(line: string): boolean;
export declare function isConsoleCallStatement(stmt: unknown, t: typeof babelTypes): boolean;
export declare function isShallowCatchBody(body: readonly unknown[], t: typeof babelTypes): boolean;
export declare function hasAnyTypeAnnotation(param: unknown, t: typeof babelTypes): boolean;
export declare function isRedundantPassthroughReturn(curr: unknown, next: unknown, t: typeof babelTypes): boolean;
export declare function isHookIdentifier(idNode: unknown): boolean;
export declare function isCustomHookFunction(astPath: unknown): boolean;
export declare function resolveStartLine(primaryNode?: unknown, fallbackNode?: unknown, defaultLine?: number): number;
export declare function isZeroDelayTimeout(callee: unknown, delayArg: unknown, t: typeof babelTypes): boolean;
export declare function isUnguardedConsoleCall(callee: unknown, t: typeof babelTypes): boolean;
export declare function matchesDiscussionTitle(titleLower: string, targetLower: string): boolean;
export declare function isGradeBelowMinimum(currentGrade: string, minGrade?: string | null): boolean;
export declare function evaluateAuditFailure(conditions?: readonly boolean[]): boolean;
export declare function isNonInteractiveSession(rawArgs: readonly string[], env?: Record<string, string | undefined>): boolean;
