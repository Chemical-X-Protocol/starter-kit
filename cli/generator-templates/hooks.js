export const buildHook = (name, camelName, pascalName) => `import { useState, useCallback, useEffect } from 'react';
import type { ${pascalName}HookOptions, ${pascalName}HookReturn } from './types';

export const ${camelName} = (options: ${pascalName}HookOptions = {}): ${pascalName}HookReturn => {
  const [data, setData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData('ready');
      options.onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  useEffect(() => {
    if (options.immediate) {
      execute();
    }
  }, [options.immediate, execute]);

  return { data, isLoading, error, execute };
};
`;

export const buildHookOptionsType = (pascalName) => `export interface ${pascalName}HookOptions {
  readonly immediate?: boolean;
  readonly onSuccess?: () => void;
}
`;

export const buildHookReturnType = (pascalName) => `export interface ${pascalName}HookReturn {
  readonly data: string | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly execute: () => Promise<void>;
}
`;

export const buildHookIndex = (name, camelName) => `export { ${camelName} } from './${name}';
export type * from './types';
`;

export const buildHookSpec = (name, camelName) => `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ${camelName} } from './${name}.ts';

describe('${camelName} Hook Composable', () => {
  it('exports pure hook function', () => {
    assert.equal(typeof ${camelName}, 'function');
  });
});
`;
