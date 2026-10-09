// Sandbox typecheck only: the piece imports 'vue', which the temp sandbox cannot resolve.
declare module 'vue' {
  export function onScopeDispose(fn: () => void): void;
  export function getCurrentScope(): object | undefined;
}
