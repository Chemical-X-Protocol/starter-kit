import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLiteralSearch, isRipgrepAvailable } from './search-literal.js';
import { handleLiteralSearchCommand } from './search-commands.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(CLI_DIR, '..');
const ENGINES = isRipgrepAvailable() ? ['js', 'rg'] : ['js'];

const git = (cwd, args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'ignore' });

const makeRepo = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-literal-'));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('.gitignore', 'ignored/\n');
  write('src/styles/_mixins.scss', '@mixin glass { --x-glass: 1; }\n');
  write('docs/guide.md', `Use isTTY checks. ${'x'.repeat(200)} END\n`);
  write('package.json', '{ "scripts": { "build": "node --max-old-space-size=8192 build.js" } }\n');
  write('plugin/main.php', "<?php register_rest_route('x', '/y');\n");
  write('src/dot.ts', 'const axb = 1;\nconst a_b = 2;\n');
  write('ignored/secret.ts', 'register_rest_route\n');
  git(root, ['init', '-q']);
  const sub = path.join(root, 'vendored-sub');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'lib.php'), "<?php register_rest_route('sub', '/z');\n");
  git(sub, ['init', '-q']);
  git(sub, ['add', '.']);
  git(sub, ['commit', '-q', '-m', 'sub']);
  git(root, ['submodule', 'add', '-q', './vendored-sub', 'vendored-sub']);
  return root;
};

for (const engine of ENGINES) {
  test(`literal search (${engine}): finds handleChemxTest and isTTY in the kit, including cli/ and package.json`, () => {
    const handler = runLiteralSearch({ root: KIT_ROOT, pattern: 'handleChemxTest', limit: 200, engine });
    assert.ok(handler.matches.some((m) => m.path.startsWith('cli/mcp/')), 'handleChemxTest found under cli/mcp');
    const tty = runLiteralSearch({ root: KIT_ROOT, pattern: 'isTTY', limit: 500, engine });
    assert.ok(tty.matches.some((m) => m.path === 'cli/terminal.js'), 'isTTY found in cli/terminal.js');
    const pkg = runLiteralSearch({ root: KIT_ROOT, pattern: '"@chemx/x-atoms": "', limit: 1000, engine });
    assert.ok(pkg.matches.some((m) => m.path === 'package.json'), 'non-code files are searched');
  });

  test(`literal search (${engine}): fixed strings, full lines, every text type, submodules, .gitignore`, () => {
    const root = makeRepo();
    try {
      const fixed = runLiteralSearch({ root, pattern: 'a.b', engine });
      assert.equal(fixed.totalMatches, 0, '"." is literal by default');
      const regex = runLiteralSearch({ root, pattern: 'a.b', isRegex: true, engine });
      assert.equal(regex.totalMatches, 2, '--regex opts into regex semantics');

      const route = runLiteralSearch({ root, pattern: 'register_rest_route', engine });
      assert.deepEqual(route.matches.map((m) => m.path).sort(), ['plugin/main.php', 'vendored-sub/lib.php'], 'php + submodule found, gitignored skipped');

      const doc = runLiteralSearch({ root, pattern: 'isTTY', engine });
      assert.match(doc.matches[0].text, / END$/, 'full line, not a 60-char snippet');
      assert.equal(runLiteralSearch({ root, pattern: 'max-old-space-size', engine }).matches[0].path, 'package.json');
      assert.equal(runLiteralSearch({ root, pattern: '@mixin', engine }).matches[0].path, 'src/styles/_mixins.scss');
      assert.ok(route.filesSearched >= 5, 'the searched file count is reported');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test(`literal search (${engine}): a zero-match search still reports every file it searched`, () => {
    const root = makeRepo();
    try {
      const none = runLiteralSearch({ root, pattern: 'zzzNoSuchStringXyz', engine });
      assert.equal(none.totalMatches, 0);
      assert.ok(none.filesSearched >= 5, `files searched counted without matches (got ${none.filesSearched})`);
      const few = runLiteralSearch({ root, pattern: '@mixin', engine });
      assert.ok(few.filesSearched >= 5, `count is not limited to matching files (got ${few.filesSearched})`);
      const cmd = handleLiteralSearchCommand(null, 'zzzNoSuchStringXyz', { isJson: false, isCli: false, isQuiet: true, cwd: root, engine });
      assert.equal(cmd.status, 'pass', 'a searched scope with no match is a truthful negative');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('literal search: the rg engine is exercised when ripgrep is on PATH', { skip: isRipgrepAvailable() ? false : 'ripgrep not on PATH; run with rg on PATH to cover the rg engine' }, () => {
  assert.ok(ENGINES.includes('rg'));
});

test('literal search command: truncation is explicit and line-only drops text', () => {
  const res = handleLiteralSearchCommand(null, 'import', { limit: 3, isJson: false, isCli: false, cwd: KIT_ROOT, isLineOnly: true });
  assert.equal(res.count, 3);
  assert.equal(res.truncated, true);
  assert.ok(res.totalMatches > 3);
  assert.equal(res.matches[0].text, undefined);
});

test('chemx q -g treats a dash-prefixed pattern as the pattern, not a flag value', async () => {
  const root = makeRepo();
  try {
    const stdout = await new Promise((resolve) => {
      execFile(process.execPath, ['--no-warnings', path.join(CLI_DIR, 'index.js'), 'q', '-g', '--x-glass', '-n', '5', '--json'], { cwd: root }, (err, out) => resolve(out));
    });
    const payload = JSON.parse(stdout.trim().split('\n').pop());
    assert.equal(payload.query, '--x-glass');
    assert.equal(payload.totalMatches, 1);
    assert.equal(payload.matches[0].path, 'src/styles/_mixins.scss');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
