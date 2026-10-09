import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCliAsync, localModules } from './spec-support/run-cli.js';

// Pass 2 section 5.4: the core/studio seam. Under a pipe or with --json, the presentation
// layer (banners, ASCII grade art, navigator TUI, tesseract HUD) is never imported.
const PRESENTATION_MODULE = /^cli\/(navigator[^/]*|tesseract[^/]*|banner|audit\/reporter(-banner|-ascii|-grades|-sections|-summary)?)\.js$/;

const makeProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-seam-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'seamfx', version: '1.0.0', type: 'module', scripts: { test: 'node --test', typecheck: 'node -e 0' } }));
  fs.writeFileSync(path.join(dir, 'src', 'add.js'), 'export const add = (a, b) => a + b;\n');
  return dir;
};

const SEAM_RUNS = [
  ['help'],
  ['q', 'add'],
  ['q', 'add', '--json'],
  ['read', 'src/add.js'],
  ['p', '-s'],
  ['audit'],
  ['audit', '--json'],
  ['verify', '--json'],
  ['test', '--json'],
  ['typecheck', '--json']
];

test('seam: piped and --json runs never import presentation modules', async () => {
  const project = makeProject();
  const runs = await Promise.all(SEAM_RUNS.map((args) => runCliAsync(args, { cwd: project })));
  fs.rmSync(project, { recursive: true, force: true });

  for (const run of runs) {
    const label = `chemx ${run.args.join(' ')}`;
    assert.strictEqual(run.signal, null, `${label} was killed`);
    const presentation = localModules(run.modules).filter((mod) => PRESENTATION_MODULE.test(mod));
    assert.deepStrictEqual(presentation, [], `${label} imported presentation modules`);
    assert.doesNotMatch(run.stdout + run.stderr, /\x1b\[/, `${label} wrote ANSI escapes to a pipe`);
  }
});

test('seam: piped audit prints a plain card, not the dashboard banner', async () => {
  const project = makeProject();
  const run = await runCliAsync(['audit'], { cwd: project });
  fs.rmSync(project, { recursive: true, force: true });

  assert.strictEqual(run.status, 0, run.stderr);
  assert.match(run.stdout, /^chemx audit \.: grade [A-F][+-]? \(\d+\/100\), \d+ hazards/m);
  assert.match(run.stdout, /^gate: pass/m);
  assert.doesNotMatch(run.stdout, /[█╭╰│]/, 'no ASCII art or box borders under a pipe');
  assert.ok(Buffer.byteLength(run.stdout) < 600, `plain card is ${Buffer.byteLength(run.stdout)} bytes`);
});
