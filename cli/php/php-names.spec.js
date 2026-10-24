import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhp } from './php-parse.js';
import { createNameResolver } from './php-names.js';

const SRC = `<?php
namespace App\\Admin;

use Vendor\\Lib\\Base as Core;
use Vendor\\Lib\\Util;
use function Vendor\\Lib\\helper;
use function Vendor\\Lib\\{bulk, other as renamed};
use const Vendor\\Lib\\LIMIT;
use Vendor\\Group\\{First, Second as Two};

class Page {}
`;

function resolverFor(src) {
  const parsed = parsePhp(src);
  assert.ok(parsed.ast, 'parses');
  const resolver = createNameResolver(parsed.ast);
  const first = parsed.ast.children[0];
  const anchor = first.kind === 'namespace' ? first.children.at(-1) : parsed.ast;
  return { ast: parsed.ast, ctx: resolver.contextFor(anchor) };
}

test('class names resolve through aliases, imports, the namespace and rooted forms', () => {
  const { ctx } = resolverFor(SRC);
  assert.equal(ctx.namespace, 'App\\Admin');
  assert.equal(ctx.resolveClass('Core'), 'Vendor\\Lib\\Base');
  assert.equal(ctx.resolveClass('core'), 'Vendor\\Lib\\Base', 'class aliases ignore case');
  assert.equal(ctx.resolveClass('Util\\Deep'), 'Vendor\\Lib\\Util\\Deep', 'first segment of a qualified name is the alias');
  assert.equal(ctx.resolveClass('Local'), 'App\\Admin\\Local');
  assert.equal(ctx.resolveClass('Sub\\Local'), 'App\\Admin\\Sub\\Local');
  assert.equal(ctx.resolveClass('\\Other\\Thing'), 'Other\\Thing');
  assert.equal(ctx.resolveClass('namespace\\Rel'), 'App\\Admin\\Rel');
  assert.equal(ctx.qualify('Page'), 'App\\Admin\\Page');
});

test('self, static and parent are returned as keywords', () => {
  const { ctx } = resolverFor(SRC);
  assert.equal(ctx.resolveClass('self'), 'self');
  assert.equal(ctx.resolveClass('Static'), 'static');
  assert.equal(ctx.resolveClass('PARENT'), 'parent');
});

test('grouped use statements expand with the group prefix and honour aliases', () => {
  const { ctx } = resolverFor(SRC);
  assert.equal(ctx.resolveClass('First'), 'Vendor\\Group\\First');
  assert.equal(ctx.resolveClass('Two'), 'Vendor\\Group\\Second');
  assert.equal(ctx.resolveFunction('bulk').name, 'Vendor\\Lib\\bulk');
  assert.equal(ctx.resolveFunction('renamed').name, 'Vendor\\Lib\\other');
});

test('functions and constants: imports win, otherwise namespaced name with global fallback', () => {
  const { ctx } = resolverFor(SRC);
  assert.deepEqual(ctx.resolveFunction('helper'), { name: 'Vendor\\Lib\\helper', fallback: null });
  assert.deepEqual(ctx.resolveFunction('strlen'), { name: 'App\\Admin\\strlen', fallback: 'strlen' });
  assert.deepEqual(ctx.resolveFunction('\\strlen'), { name: 'strlen', fallback: null });
  assert.deepEqual(ctx.resolveConst('LIMIT'), { name: 'Vendor\\Lib\\LIMIT', fallback: null });
  assert.deepEqual(ctx.resolveConst('PHP_EOL'), { name: 'App\\Admin\\PHP_EOL', fallback: 'PHP_EOL' });
});

test('global files have no namespace, no fallback, and still read their imports', () => {
  const { ctx } = resolverFor('<?php\nuse Vendor\\Lib\\Base;\nclass K {}\n');
  assert.equal(ctx.namespace, '');
  assert.equal(ctx.resolveClass('Base'), 'Vendor\\Lib\\Base');
  assert.equal(ctx.resolveClass('Other'), 'Other');
  assert.deepEqual(ctx.resolveFunction('strlen'), { name: 'strlen', fallback: null });
});

test('bracketed namespace blocks keep separate imports', () => {
  const src = '<?php\nnamespace One { use X\\A; class K1 {} }\nnamespace Two { use Y\\A; class K2 {} }\n';
  const parsed = parsePhp(src);
  const resolver = createNameResolver(parsed.ast);
  const [one, two] = parsed.ast.children;
  assert.equal(resolver.contextFor(one.children.at(-1)).resolveClass('A'), 'X\\A');
  assert.equal(resolver.contextFor(two.children.at(-1)).resolveClass('A'), 'Y\\A');
  assert.equal(resolver.contextFor(two.children.at(-1)).namespace, 'Two');
});
