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
