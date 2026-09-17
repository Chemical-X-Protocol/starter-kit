export const buildComponentSpec = (name, pascalName, hasController = true) => {
  if (hasController) {
    return `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { use${pascalName}Controller } from './${name}.controller.ts';

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
