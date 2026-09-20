export const buildComponentSpec = (name, pascalName, hasController = true, runner = 'node:test') => {
  if (runner === 'vitest') {
    if (hasController) {
      return `import { describe, it, expect } from 'vitest';
import { use${pascalName}Controller } from './${name}.controller';

describe('${pascalName} Capsule Controller', () => {
  it('exports pure controller hook', () => {
    expect(typeof use${pascalName}Controller).toBe('function');
  });
});
`;
    }

    return `import { describe, it, expect } from 'vitest';

describe('${pascalName} Atom Foundation', () => {
  it('defines foundational UI atom contract', () => {
    expect(true).toBe(true);
  });
});
`;
  }

  if (runner === 'jest') {
    if (hasController) {
      return `import { describe, it, expect } from '@jest/globals';
import { use${pascalName}Controller } from './${name}.controller';

describe('${pascalName} Capsule Controller', () => {
  it('exports pure controller hook', () => {
    expect(typeof use${pascalName}Controller).toBe('function');
  });
});
`;
    }

    return `import { describe, it, expect } from '@jest/globals';

describe('${pascalName} Atom Foundation', () => {
  it('defines foundational UI atom contract', () => {
    expect(true).toBe(true);
  });
});
`;
  }

  if (hasController) {
    return `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { use${pascalName}Controller } from './${name}.controller';

describe('${pascalName} Capsule Controller', () => {
  it('exports pure controller hook', () => {
    assert.equal(typeof use${pascalName}Controller, 'function');
  });
});
`;
  }

  return `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('${pascalName} Atom Foundation', () => {
  it('defines foundational UI atom contract', () => {
    assert.ok(true);
  });
});
`;
};

export const buildIndex = (name, pascalName, ext, hasController = true) => {
  const compExport = ext === 'vue' || ext === 'svelte'
    ? `export { default as ${pascalName} } from './${name}.${ext}';`
    : `export { ${pascalName} } from './${name}';`;

  const controllerExport = hasController
    ? `export { use${pascalName}Controller } from './${name}.controller';\n`
    : '';

  return `${compExport}
${controllerExport}export type * from './types';
`;
};
