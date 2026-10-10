// Registry of fuzz construct classes (#2596): name -> generate(choices) -> pair (pair-check.js).
// fixedCount: the class is enumerated (choice index 0..fixedCount-1) instead of sampled.
import { compareClass, logicClass, templateLiteralClass } from './gen-logic.js';
import { asyncClass, blocksClass, functionsClass, strictClass, tryClass } from './gen-control.js';
import { modulesClass, typescriptClass } from './gen-modules.js';
import { jsxScriptClass, templatesClass } from './gen-templates.js';
import { mixedClass } from './gen-mixed.js';
import { aliasClass } from './gen-alias.js';
import { SEEDS, seedClass } from './seeds.js';
import { accessorsClass, classMembersClass, keysClass, optionalClass, protoClass, spreadClass } from './gen-objects.js';
import { destructuringClass, holesClass, namesClass, switchClass, tdzClass, varClass } from './gen-scope.js';

export const CLASSES = Object.freeze([
  { name: 'logic', generate: logicClass },
  { name: 'compare', generate: compareClass },
  { name: 'template-literal', generate: templateLiteralClass },
  { name: 'holes', generate: holesClass },
  { name: 'tdz', generate: tdzClass },
  { name: 'var', generate: varClass },
  { name: 'switch', generate: switchClass },
  { name: 'destructuring', generate: destructuringClass },
  { name: 'names', generate: namesClass },
  { name: 'accessors', generate: accessorsClass },
  { name: 'proto', generate: protoClass },
  { name: 'class-members', generate: classMembersClass },
  { name: 'spread', generate: spreadClass },
  { name: 'optional', generate: optionalClass },
  { name: 'try', generate: tryClass },
  { name: 'async', generate: asyncClass },
  { name: 'functions', generate: functionsClass },
  { name: 'blocks', generate: blocksClass },
  { name: 'strict', generate: strictClass },
  { name: 'modules', generate: modulesClass },
  { name: 'typescript', generate: typescriptClass },
  { name: 'templates', generate: templatesClass },
  { name: 'jsx-in-function', generate: jsxScriptClass },
  { name: 'keys', generate: keysClass },
  { name: 'mixed', generate: mixedClass },
  { name: 'alias', generate: aliasClass },
  { name: 'seeds', generate: seedClass, fixedCount: SEEDS.length }
]);
