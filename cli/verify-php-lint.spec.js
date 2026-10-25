// `php -l` for chemx verify in a repo with its own tests/run-tests.mjs runner (task #6770):
// which PHP files it reads, how it reads php's answer, and the section it hands to verify.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listPhpFiles, changedPhpFiles, parseLintOutput, lintPhp, PHP_NOT_FOUND } from './verify-php-lint.js';
import { SKIPPED } from './verify-steps.js';
import { withHarnessRepo, commitAll, PHP_CLEAN, PHP_BROKEN } from './fixtures/project-runner/harness-repo.js';

const HAS_PHP = spawnSync('php', ['-v']).status === 0;
const NEEDS_PHP = HAS_PHP ? false : 'php is not on PATH';

const write = (repo, name, content) => {
  const file = path.join(repo, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

test('parseLintOutput: reads file, line and message from a displayed parse error', () => {
  const output = '\nParse error: syntax error, unexpected token "{" in /plugins/x/includes/broken.php on line 2\nErrors parsing /plugins/x/includes/broken.php\n';
  assert.deepEqual(parseLintOutput(output), { file: '/plugins/x/includes/broken.php', line: 2, message: 'syntax error, unexpected token "{"' });
});

test('parseLintOutput: the logged form (PHP Parse error) reads the same, and a fatal error counts too', () => {
  const logged = 'PHP Parse error:  syntax error, unexpected end of file in /a/b.php on line 9\n';
  assert.deepEqual(parseLintOutput(logged), { file: '/a/b.php', line: 9, message: 'syntax error, unexpected end of file' });
  assert.equal(parseLintOutput('PHP Fatal error:  Cannot redeclare f() in /a/c.php on line 4').line, 4);
});

test('parseLintOutput: output with no php error is null', () => {
  assert.equal(parseLintOutput('No syntax errors detected in x.php\n'), null);
  assert.equal(parseLintOutput(''), null);
});

test('listPhpFiles: every .php file below the root, sorted, root-relative; vendor, node_modules, dot dirs and nested repos stay out', async () => {
  await withHarnessRepo(({ repo }) => {
    write(repo, 'plugin.php', PHP_CLEAN);
    write(repo, 'includes/a.php', PHP_CLEAN);
    write(repo, 'includes/readme.txt', 'x');
    write(repo, 'vendor/lib/v.php', PHP_BROKEN);
    write(repo, 'node_modules/pkg/n.php', PHP_BROKEN);
    write(repo, '.chemx/scratch.php', PHP_BROKEN);
    write(repo, 'sub-repo/.git', 'gitdir: ../.git/modules/sub-repo\n');
    write(repo, 'sub-repo/s.php', PHP_BROKEN);
    assert.deepEqual(listPhpFiles(repo), ['includes/a.php', 'plugin.php']);
  });
});

test('changedPhpFiles: only .php files that changed since HEAD, new ones included, deleted and vendored ones left out', async () => {
  await withHarnessRepo(({ repo }) => {
    const git = commitAll(repo);
    write(repo, 'includes/kept.php', PHP_CLEAN);
    write(repo, 'includes/gone.php', PHP_CLEAN);
    git('add', '-A');
    git('commit', '-q', '-m', 'two files');
    write(repo, 'includes/kept.php', `${PHP_CLEAN}// edited\n`);
    fs.rmSync(path.join(repo, 'includes/gone.php'));
    write(repo, 'includes/new.php', PHP_CLEAN);
    write(repo, 'tests/notes.txt', 'not php');
    write(repo, 'vendor/lib/v.php', PHP_BROKEN);
    write(repo, 'node_modules/pkg/n.php', PHP_BROKEN);
    const listing = changedPhpFiles(repo, null);
    assert.equal(listing.ok, true);
    assert.deepEqual(listing.files, ['includes/kept.php', 'includes/new.php']);
  });
});

test('changedPhpFiles: --base lists the files changed since that revision', async () => {
  await withHarnessRepo(({ repo }) => {
    const git = commitAll(repo);
    write(repo, 'includes/later.php', PHP_CLEAN);
    git('add', '-A');
    git('commit', '-q', '-m', 'later');
    assert.deepEqual(changedPhpFiles(repo, null).files, []);
    assert.deepEqual(changedPhpFiles(repo, 'HEAD~1').files, ['includes/later.php']);
  });
});

test('changedPhpFiles: outside a git repository it says so instead of guessing', async () => {
  await withHarnessRepo(({ repo }) => {
    const listing = changedPhpFiles(repo, null);
    assert.equal(listing.ok, false);
    assert.match(listing.error, /not a git repository/);
  });
});

test('lintPhp: a clean changed file passes and the section says what was checked', { skip: NEEDS_PHP }, async () => {
  await withHarnessRepo(({ repo }) => {
    commitAll(repo);
    write(repo, 'includes/clean.php', PHP_CLEAN);
    const section = lintPhp(repo, {});
    assert.equal(section.status, 'pass');
    assert.equal(section.success, true);
    assert.equal(section.checked, 1);
    assert.equal(section.failed, 0);
    assert.equal(section.scope, 'changed vs HEAD');
  });
});

test('lintPhp: a syntax error fails with its file, line and message', { skip: NEEDS_PHP }, async () => {
  await withHarnessRepo(({ repo }) => {
    commitAll(repo);
    write(repo, 'includes/broken.php', PHP_BROKEN);
    const section = lintPhp(repo, {});
    assert.equal(section.status, 'fail');
    assert.equal(section.success, false);
    assert.equal(section.failed, 1);
    assert.equal(section.errors[0].file, 'includes/broken.php');
    assert.equal(section.errors[0].line, 2);
    assert.match(section.errors[0].message, /syntax error/);
  });
});

test('lintPhp: no changed PHP file is a pass that says so, not a skip', { skip: NEEDS_PHP }, async () => {
  await withHarnessRepo(({ repo }) => {
    commitAll(repo);
    const section = lintPhp(repo, {});
    assert.equal(section.status, 'pass');
    assert.equal(section.checked, 0);
  });
});

test('lintPhp: --all reads every PHP file, committed or not', { skip: NEEDS_PHP }, async () => {
  await withHarnessRepo(({ repo }) => {
    write(repo, 'includes/clean.php', PHP_CLEAN);
    write(repo, 'includes/broken.php', PHP_BROKEN);
    commitAll(repo);
    assert.equal(lintPhp(repo, {}).status, 'pass', 'nothing changed since HEAD');
    const all = lintPhp(repo, { all: true });
    assert.equal(all.status, 'fail');
    assert.equal(all.checked, 2);
    assert.equal(all.scope, 'all PHP files');
    assert.deepEqual(all.errors.map((error) => error.file), ['includes/broken.php']);
  });
});

test('lintPhp: outside git it reads every PHP file and names the reason', { skip: NEEDS_PHP }, async () => {
  await withHarnessRepo(({ repo }) => {
    write(repo, 'includes/clean.php', PHP_CLEAN);
    const section = lintPhp(repo, {});
    assert.equal(section.status, 'pass');
    assert.equal(section.checked, 1);
    assert.match(section.note, /not a git repository/);
    assert.equal(section.scope, 'all PHP files');
  });
});

test('lintPhp: more than five errors keep the count and list five', { skip: NEEDS_PHP }, async () => {
  await withHarnessRepo(({ repo }) => {
    for (let index = 0; index < 7; index += 1) write(repo, `includes/b${index}.php`, PHP_BROKEN);
    const section = lintPhp(repo, { all: true });
    assert.equal(section.failed, 7);
    assert.equal(section.errors.length, 5);
  });
});

test('lintPhp: php not on PATH is skipped with the reason, never a pass or a failure', async () => {
  await withHarnessRepo(({ repo }) => {
    write(repo, 'includes/broken.php', PHP_BROKEN);
    const section = lintPhp(repo, { all: true, php: 'chemx-no-such-php-binary' });
    assert.equal(section.status, SKIPPED);
    assert.equal(section.reason, PHP_NOT_FOUND);
    assert.equal(section.checked, 0);
    assert.match(section.note, /php is not on PATH/);
  });
});
