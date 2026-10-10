// Heal span ops and the site matcher on small inline fixtures (phases doc, P6 deliverables): import
// merge forms including `import x, { y }`, side-effect imports, unused-import drops, comment hoisting,
// indentation re-basing, host-module insertion and the matcher's argument rules. No disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addImport, dropUnusedImports, hoistComments, replaceRange, insertExport } from './heal-ops.js';
import { pieceCoreOf, matchSite, alwaysReturns } from './heal-match.js';
import { parseModuleText, spliceAll, bodyHashOf } from './heal-text.js';

const FILE = 'cli/x.js';

test('addImport merges into { a }, x and x, { y } forms and keeps multi-line lists multi-line', () => {
  assert.equal(addImport("import { a } from './m.js';\nuse(a);\n", FILE, { from: './m.js', names: ['b'] }), "import { a, b } from './m.js';\nuse(a);\n");
  assert.equal(addImport("import x from './m.js';\n", FILE, { from: './m.js', names: ['b'] }), "import x, { b } from './m.js';\n");
  assert.equal(addImport("import x, { y } from './m.js';\n", FILE, { from: './m.js', names: ['b'] }), "import x, { y, b } from './m.js';\n");
  assert.equal(addImport("import {\n  a,\n  c,\n} from './m.js';\n", FILE, { from: './m.js', names: ['b'] }), "import {\n  a,\n  c,\n  b,\n} from './m.js';\n");
});

test('addImport never touches a side-effect or namespace import and adds a declaration after the last import', () => {
  const text = "import './side.js';\nimport * as ns from './m.js';\n\nns.go();\n";
  assert.equal(addImport(text, FILE, { from: './m.js', names: ['b'] }), "import './side.js';\nimport * as ns from './m.js';\nimport { b } from './m.js';\n\nns.go();\n");
  assert.equal(addImport('const a = 1;\n', FILE, { from: './m.js', names: ['b'] }), "import { b } from './m.js';\n\nconst a = 1;\n");
});

test('addImport is a no-op for a name already imported and refuses a name bound to another module', () => {
  const text = "import { b } from './m.js';\n";
  assert.equal(addImport(text, FILE, { from: './m.js', names: ['b'] }), text);
  assert.throws(() => addImport("import { b } from './other.js';\n", FILE, { from: './m.js', names: ['b'] }), /HEAL_NAME_TAKEN/);
});

test('dropUnusedImports drops only specifiers the edit made unused, in every import form', () => {
  const before = "import './side.js';\nimport x, { y } from './m.js';\nimport { idle } from './i.js';\nx(); y();\n";
  assert.equal(dropUnusedImports(before, before.replace('x(); ', ''), FILE).text, "import './side.js';\nimport { y } from './m.js';\nimport { idle } from './i.js';\ny();\n");
  assert.equal(dropUnusedImports(before, before.replace(' y();', ''), FILE).text, "import './side.js';\nimport x from './m.js';\nimport { idle } from './i.js';\nx();\n");
  const none = dropUnusedImports(before, before.replace('x(); y();', 'z();'), FILE);
  assert.equal(none.text, "import './side.js';\nimport { idle } from './i.js';\nz();\n");
  assert.deepEqual(none.dropped, ['x', 'y']);
});

test('hoistComments returns the comments inside a span in source order; replaceRange re-bases indentation', () => {
  const text = 'function f() {\n  try {\n    return 1; // one\n  } catch {\n    /* two */ return 2;\n  }\n}\n';
  const ast = parseModuleText(text, FILE);
  const tryNode = ast.program.body[0].body.body[0];
  assert.deepEqual(hoistComments(text, ast, tryNode.start, tryNode.end), ['// one', '/* two */']);
  const splice = replaceRange(text, { start: tryNode.start, end: tryNode.end, expectHash: bodyHashOf(text.slice(tryNode.start, tryNode.end)), text: '// one\nreturn g();' });
  assert.equal(spliceAll(text, [splice]), 'function f() {\n  // one\n  return g();\n}\n');
  assert.throws(() => replaceRange(text, { start: tryNode.start, end: tryNode.end, expectHash: 'deadbeefdeadbeef', text: 'x' }), /BLUEPRINT_STALE/);
});

test('insertExport puts the piece after the host imports and merges its imports', () => {
  const host = "import path from 'node:path';\n\nexport const a = () => path.sep;\n";
  const piece = "import path from 'node:path';\nimport { join } from 'node:path';\n\nexport const b = (p) => join(p, path.sep);\n";
  assert.equal(insertExport(host, 'cli/host.js', { content: piece }), "import path, { join } from 'node:path';\n\nexport const b = (p) => join(p, path.sep);\n\nexport const a = () => path.sep;\n");
});

const PIECE = "import fs from 'node:fs';\nexport const readJsonOr = (file, fallback) => {\n  try {\n    return JSON.parse(fs.readFileSync(file, 'utf-8'));\n  } catch (err) {\n    return fallback;\n  }\n};\n";

const siteOf = (body) => {
  const text = `const r = (p) => {\n  ${body}\n};\n`;
  const ast = parseModuleText(text, FILE);
  return { text, node: ast.program.body[0].declarations[0].init.body.body[0] };
};

test('matchSite binds parameters to verbatim slices, accepts utf8 for utf-8 and an absent unused catch binder', () => {
  const piece = pieceCoreOf(PIECE, 'readJsonOr', 'cli/fs-json.js');
  assert.equal(alwaysReturns(piece.core.node), true);
  const site = siteOf("try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { a: 1 }; }");
  assert.deepEqual(matchSite(piece, site.node, site.text), { ok: true, args: ['p', '{ a: 1 }'] });
});

test('matchSite refuses an impure argument, a different call and a catch that reads its error', () => {
  const piece = pieceCoreOf(PIECE, 'readJsonOr', 'cli/fs-json.js');
  const impure = siteOf("try { return JSON.parse(fs.readFileSync(next(), 'utf8')); } catch { return null; }");
  assert.match(matchSite(piece, impure.node, impure.text).reason, /not side-effect free/);
  const other = siteOf("try { return JSON.parse(fs.readFileSync(p, 'latin1')); } catch { return null; }");
  assert.equal(matchSite(piece, other.node, other.text).ok, false);
  const reads = siteOf("try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return e; }");
  assert.equal(matchSite(piece, reads.node, reads.text).ok, false);
});
