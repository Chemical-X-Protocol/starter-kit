import { createRequire } from 'node:module';

// Babel costs about 650ms of CPU to load. Modules that only sometimes parse (read, search)
// call these instead of importing @babel at the top, so a plain line-range read or a
// cached query never pays for it. The packages are CommonJS, so require() stays synchronous.
const requireBabel = createRequire(import.meta.url);

let parserModule = null;
let traverseFn = null;

export const parse = (code, options) => {
  parserModule = parserModule ?? requireBabel('@babel/parser');
  return parserModule.parse(code, options);
};

const loadTraverse = () => {
  const traverseModule = requireBabel('@babel/traverse');
  return traverseModule.default ?? traverseModule;
};

export const traverse = (ast, visitors, ...rest) => {
  traverseFn = traverseFn ?? loadTraverse();
  return traverseFn(ast, visitors, ...rest);
};

let typesModule = null;
const loadTypes = () => {
  typesModule = typesModule ?? requireBabel('@babel/types');
  return typesModule;
};

// `import { lazyTypes as t } from './babel-lazy.js'` reads like `import * as t from '@babel/types'`
// but loads the package on the first t.isX() call, never at import time.
export const lazyTypes = new Proxy({}, { get: (_target, key) => loadTypes()[key] });
