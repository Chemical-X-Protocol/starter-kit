/**
 * #6751 (K6): --root=<dir> and CHEMX_PROJECT_ROOT on every command. The pure pieces (extracting the
 * flag, choosing the root, inferring it from a path) run on temp dirs; the end-to-end block spawns the
 * real CLI from an unrelated cwd. Nothing real is read: every project is an fs.mkdtemp dir.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractRootFlag, resolveCliRoot, applyCliRoot, inferPathRoot, mentionsRootFlag, ROOT_ENV } from './cli-root.js';

const CLI = fileURLToPath(new URL('./index.js', import.meta.url));

const tempDir = (t, prefix = 'chemx-root-') => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const markedProject = (t, name) => {
  const dir = path.join(tempDir(t), name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.chemxrc'), '{}\n');
  fs.writeFileSync(path.join(dir, 'src', 'x.js'), 'export const x = 1;\n');
  return dir;
};

test('extractRootFlag: --root=<dir>, --root <dir> and --project-root leave every other word in order', () => {
  assert.deepEqual(extractRootFlag(['log', '--root=/a', '-n', '3']), { args: ['log', '-n', '3'], root: '/a', flag: '--root', command: 'log', error: null });
  assert.deepEqual(extractRootFlag(['q', '-g', 'x', '--root', '/a']).args, ['q', '-g', 'x']);
  assert.equal(extractRootFlag(['q', '-g', 'x', '--root', '/a']).root, '/a');
  assert.equal(extractRootFlag(['d', '--project-root=/b']).root, '/b');
  assert.equal(extractRootFlag(['d', '--project-root', '/b']).flag, '--project-root');
});

test('extractRootFlag: the flag may lead the command, and the last one wins', () => {
  const led = extractRootFlag(['--root=/a', 'log', '-n', '2']);
  assert.deepEqual([led.args, led.command, led.root], [['log', '-n', '2'], 'log', '/a']);
  assert.equal(extractRootFlag(['log', '--root=/a', '--root=/b']).root, '/b');
});

test('extractRootFlag: no flag changes nothing', () => {
  const same = extractRootFlag(['q', '-g', 'foo', '-n', '5']);
  assert.deepEqual([same.args, same.root, same.error], [['q', '-g', 'foo', '-n', '5'], null, null]);
});

test('extractRootFlag: words after -- and a build command\'s own words belong to the wrapped tool', () => {
  assert.deepEqual(extractRootFlag(['wrap', '--', 'vite', '--root=/a']).args, ['wrap', '--', 'vite', '--root=/a']);
  assert.equal(extractRootFlag(['wrap', '--', 'vite', '--root=/a']).root, null);
  const tail = extractRootFlag(['build', 'vite', 'build', '--root=src']);
  assert.deepEqual([tail.args, tail.root], [['build', 'vite', 'build', '--root=src'], null]);
  const head = extractRootFlag(['build', '--root=/a', 'vite']);
  assert.deepEqual([head.args, head.root], [['build', 'vite'], '/a']);
});

test('extractRootFlag: a search pattern or a flag value that spells the flag is data', () => {
  assert.deepEqual(extractRootFlag(['q', '-g', '--root']).args, ['q', '-g', '--root']);
  const withRoot = extractRootFlag(['q', '-g', '--root', '--root=/b']);
  assert.deepEqual([withRoot.args, withRoot.root], [['q', '-g', '--root'], '/b']);
  const valueFlagsOf = (command) => new Set(command === 'patch' ? ['--target'] : []);
  const patch = extractRootFlag(['patch', 'f.js', '--target', '--root=/x', '--root=/y'], { valueFlagsOf });
  assert.deepEqual([patch.args, patch.root], [['patch', 'f.js', '--target', '--root=/x'], '/y']);
});

test('extractRootFlag: free text that merely starts with the flag is data, a bare flag with no directory is an error', () => {
  const text = extractRootFlag(['team', 'task', 'comment', '1', '--root=<dir> done, see the ticket']);
  assert.deepEqual([text.args.length, text.root], [5, null]);
  assert.match(extractRootFlag(['log', '--root']).error, /--root needs a directory/);
  assert.match(extractRootFlag(['log', '--root', '--', 'x']).error, /--root needs a directory/);
  assert.match(extractRootFlag(['log', '--root=']).error, /--root needs a directory/);
});

test('resolveCliRoot: a relative --root resolves against the cwd and the flag is removed from the args', (t) => {
  const base = tempDir(t);
  fs.mkdirSync(path.join(base, 'proj'));
  const resolved = resolveCliRoot(['log', '--root=proj', '-n', '1'], { cwd: base, env: {} });
  assert.deepEqual([resolved.root, resolved.source, resolved.args, resolved.error], [path.join(base, 'proj'), 'flag', ['log', '-n', '1'], null]);
});

test('resolveCliRoot: a root that is missing or is a file is refused by name', (t) => {
  const base = tempDir(t);
  fs.writeFileSync(path.join(base, 'file.txt'), 'x');
  assert.match(resolveCliRoot(['log', '--root=nope'], { cwd: base, env: {} }).error, /--root=nope: .*nope is not a directory/);
  assert.match(resolveCliRoot(['log', '--root=file.txt'], { cwd: base, env: {} }).error, /file\.txt is not a directory/);
});

test('resolveCliRoot: CHEMX_PROJECT_ROOT is the default, the flag wins, an empty or missing one is ignored with a note', (t) => {
  const base = tempDir(t);
  const one = path.join(base, 'one');
  const two = path.join(base, 'two');
  fs.mkdirSync(one);
  fs.mkdirSync(two);
  const fromEnv = resolveCliRoot(['log'], { cwd: base, env: { [ROOT_ENV]: one } });
  assert.deepEqual([fromEnv.root, fromEnv.source], [one, 'env']);
  const flagged = resolveCliRoot(['log', `--root=${two}`], { cwd: base, env: { [ROOT_ENV]: one } });
  assert.deepEqual([flagged.root, flagged.source], [two, 'flag']);
  assert.equal(resolveCliRoot(['log'], { cwd: base, env: { [ROOT_ENV]: '' } }).root, null);
  const stale = resolveCliRoot(['log'], { cwd: base, env: { [ROOT_ENV]: path.join(base, 'gone') } });
  assert.equal(stale.root, null);
  assert.match(stale.note, /CHEMX_PROJECT_ROOT=.*gone is not a directory; using/);
});

test('resolveCliRoot: the MCP server, help and version keep the cwd but still lose the flag', (t) => {
  const base = tempDir(t);
  for (const command of ['mcp', 'server', 'hook', 'help', 'version', '--version']) {
    const resolved = resolveCliRoot([command, `--root=${base}`], { cwd: path.dirname(base), env: { [ROOT_ENV]: base } });
    assert.deepEqual([resolved.root, resolved.args], [null, [command]], command);
  }
});

test('resolveCliRoot: doctor, install-hooks and friction read --root themselves, so they get it as an absolute --root=<dir>', (t) => {
  const base = tempDir(t);
  fs.mkdirSync(path.join(base, 'p'));
  for (const command of ['doctor', 'install-hooks', 'friction']) {
    const resolved = resolveCliRoot([command, '--root', 'p', '--json'], { cwd: base, env: {} });
    assert.deepEqual(resolved.args, [command, `--root=${path.join(base, 'p')}`, '--json'], command);
    assert.equal(resolved.root, path.join(base, 'p'));
  }
});

test('inferPathRoot: an absolute path inside another chemx project selects that project, one inside the cwd project does not', (t) => {
  const here = markedProject(t, 'here');
  const there = markedProject(t, 'there');
  const bare = tempDir(t, 'chemx-bare-');
  fs.writeFileSync(path.join(bare, 'y.js'), 'export {};\n');
  const infer = (command, args) => inferPathRoot(command, args, here);
  assert.equal(infer('read', [path.join(there, 'src', 'x.js'), '--outline']), there);
  assert.equal(infer('read', [`${path.join(there, 'src', 'x.js')}:1-3`, '--bare']), there);
  assert.equal(infer('q', ['-g', 'needle', path.join(there, 'src')]), there);
  assert.equal(infer('q', ['needle', `--dir=${path.join(there, 'src')}`]), there);
  assert.equal(infer('read', [path.join(here, 'src', 'x.js')]), null);
  assert.equal(infer('read', ['src/x.js']), null, 'a relative path never changes the root');
  assert.equal(infer('read', [path.join(bare, 'y.js')]), null, 'a directory no chemx project owns is left to the usual refusal');
  assert.equal(infer('log', [path.join(there, 'src')]), null, 'only read and q look at paths');
});

test('resolveCliRoot: a path in another chemx project sets the root (source path) unless a flag or the env already did', (t) => {
  const here = markedProject(t, 'here');
  const there = markedProject(t, 'there');
  const file = path.join(there, 'src', 'x.js');
  const inferred = resolveCliRoot(['read', file, '--outline'], { cwd: here, env: {} });
  assert.deepEqual([inferred.root, inferred.source, inferred.args], [there, 'path', ['read', file, '--outline']]);
  assert.equal(resolveCliRoot(['read', file, `--root=${here}`], { cwd: here, env: {} }).root, here);
  assert.equal(resolveCliRoot(['read', file], { cwd: here, env: { [ROOT_ENV]: here } }).root, here);
});

const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

const gitProject = (t) => {
  const dir = tempDir(t, 'chemx-root-e2e-');
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { build: 'echo hi' } }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'hello.js'), 'export const greetingNeedle = () => 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first commit in the far project');
  return dir;
};

const chemx = (cwd, args, env = {}) => spawnSync(process.execPath, [CLI, ...args], {
  cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, NO_COLOR: '1', CHEMX_PROJECT_ROOT: '', ...env }
});

test('end to end: log, d, status, show, f, p, j, q and read all run in --root from an unrelated cwd', (t) => {
  const far = gitProject(t);
  const elsewhere = tempDir(t, 'chemx-elsewhere-');
  fs.appendFileSync(path.join(far, 'src', 'hello.js'), '// edited\n');
  const out = (args) => {
    const run = chemx(elsewhere, [...args, `--root=${far}`]);
    assert.equal(run.status, 0, `chemx ${args.join(' ')}: ${run.stderr}`);
    return run.stdout;
  };
  assert.match(out(['log', '-n', '3']), /first commit in the far project/);
  assert.match(out(['d']), /edited/);
  assert.match(out(['status']), /src\/hello\.js/);
  assert.match(out(['show']), /first commit in the far project/);
  assert.match(out(['f', 'hello']), /src\/hello\.js/);
  assert.match(out(['p', '-s']), /build/);
  assert.match(out(['j', 'package.json']), /"name"/);
  assert.match(out(['q', '-g', 'greetingNeedle']), /src\/hello\.js:1/);
  assert.match(out(['read', 'src/hello.js', '--outline']), /greetingNeedle/);
});

test('end to end: CHEMX_PROJECT_ROOT, a leading --root and the spaced form do the same', (t) => {
  const far = gitProject(t);
  const elsewhere = tempDir(t, 'chemx-elsewhere-');
  const viaEnv = chemx(elsewhere, ['log', '-n', '1'], { [ROOT_ENV]: far });
  assert.match(viaEnv.stdout, /first commit in the far project/);
  const leading = chemx(elsewhere, ['--root', far, 'log', '-n', '1']);
  assert.match(leading.stdout, /first commit in the far project/);
  const flagOverEnv = chemx(elsewhere, ['log', '-n', '1', `--root=${far}`], { [ROOT_ENV]: elsewhere });
  assert.match(flagOverEnv.stdout, /first commit in the far project/);
});

test('end to end: a bad --root exits 1 and names the path, nothing runs', (t) => {
  const elsewhere = tempDir(t, 'chemx-elsewhere-');
  const run = chemx(elsewhere, ['log', `--root=${path.join(elsewhere, 'missing')}`]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--root=.*missing: .*missing is not a directory/);
});

test('end to end: read and q take an absolute path inside another chemx project', (t) => {
  const here = markedProject(t, 'here');
  const there = markedProject(t, 'there');
  const file = path.join(there, 'src', 'x.js');
  const read = chemx(here, ['read', file, '--outline']);
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /export const x/);
  const search = chemx(here, ['q', '-g', 'export const x', path.join(there, 'src')]);
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /x\.js:1/);
});

test('end to end: chemx do runs an item in its own --root and returns to the batch root', (t) => {
  const far = gitProject(t);
  const elsewhere = tempDir(t, 'chemx-elsewhere-');
  const run = chemx(elsewhere, ['do', `log -n 1 --root=${far}`, 'f hello']);
  assert.match(run.stdout, /first commit in the far project/);
  assert.doesNotMatch(run.stdout, /src\/hello\.js/, 'the second item ran in the batch cwd, not the first item\'s root');
});

test('applyCliRoot: moves into the root once, replaces an exported CHEMX_PROJECT_ROOT, and does nothing on an error or the same directory', (t) => {
  const base = tempDir(t);
  const proj = path.join(base, 'proj');
  fs.mkdirSync(proj);
  const moves = [];
  const chdir = (dir) => moves.push(dir);
  const env = { [ROOT_ENV]: base };
  const moved = applyCliRoot(['log', `--root=${proj}`], { cwd: base, env, chdir });
  assert.deepEqual([moves, env[ROOT_ENV], moved.args], [[proj], proj, ['log']]);
  applyCliRoot(['log', `--root=${base}`], { cwd: base, env: {}, chdir });
  applyCliRoot(['log', '--root=missing'], { cwd: base, env: {}, chdir });
  assert.equal(moves.length, 1, 'the same directory and a refused root never move the process');
  const envOnly = { [ROOT_ENV]: proj };
  applyCliRoot(['log'], { cwd: base, env: envOnly, chdir });
  assert.deepEqual([moves.length, envOnly[ROOT_ENV]], [2, proj], 'the env root moves the process and is left as it was');
  assert.equal(mentionsRootFlag(['log', '--project-root=/a']), true);
  assert.equal(mentionsRootFlag(['log', '--rootless']), false);
});

test('end to end: conflicts and d --conflicts, answered before the CLI proper loads, take --root too', (t) => {
  const far = gitProject(t);
  const elsewhere = tempDir(t, 'chemx-elsewhere-');
  const here = chemx(elsewhere, ['conflicts', '--json']);
  assert.equal(JSON.parse(here.stdout).isRepo, false);
  const there = chemx(elsewhere, ['conflicts', '--json', `--root=${far}`]);
  assert.deepEqual([there.status, JSON.parse(there.stdout).isRepo], [0, true]);
  const diff = chemx(elsewhere, ['d', '--conflicts', `--root=${far}`]);
  assert.doesNotMatch(diff.stderr, /not a git repository/);
  const bad = chemx(elsewhere, ['conflicts', `--root=${path.join(elsewhere, 'missing')}`]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /is not a directory/);
});
