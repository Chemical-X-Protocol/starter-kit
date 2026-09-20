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

export const buildHookSpec = (name, camelName, runner = 'node:test') => {
  if (runner === 'vitest') {
    return `import { describe, it, expect } from 'vitest';
import { ${camelName} } from './${name}';

describe('${camelName} Hook Composable', () => {
  it('is defined as a hook function', () => {
    expect(typeof ${camelName}).toBe('function');
  });
});
`;
  }
  if (runner === 'jest') {
    return `import { describe, it, expect } from '@jest/globals';
import { ${camelName} } from './${name}';

describe('${camelName} Hook Composable', () => {
  it('is defined as a hook function', () => {
    expect(typeof ${camelName}).toBe('function');
  });
});
`;
  }
  return `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ${camelName} } from './${name}';

describe('${camelName} Hook Composable', () => {
  it('is defined as a hook function', () => {
    assert.equal(typeof ${camelName}, 'function');
  });
});
`;
};
