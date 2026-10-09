import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { profileSpecs, formatProfile, PROFILE_METHOD } from './test-profile.js';

const PASSING = (body) => `import test from 'node:test';\ntest('t', async () => { ${body} });\n`;

const makeProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-profile-'));
  fs.writeFileSync(path.join(dir, 'quick.spec.js'), PASSING(''));
  fs.writeFileSync(path.join(dir, 'napper.spec.js'), PASSING('await new Promise((resolve) => setTimeout(resolve, 600));'));
  fs.writeFileSync(path.join(dir, 'broken.spec.js'), PASSING('throw new Error("boom");'));
  return dir;
};

const profileOf = (dir) => profileSpecs(['quick.spec.js', 'napper.spec.js', 'broken.spec.js'], dir, {
  env: { CHEMX_TEST_CONCURRENCY: '2' },
  slotsDir: path.join(dir, '.slots')
});

test('test-profile: reports every file with wall time and test count, slowest first, and flags a failing file', async () => {
  const dir = makeProject();
  try {
    const profile = await profileOf(dir);
    assert.equal(profile.specCount, 3);
    assert.equal(profile.testCount, 3);
    assert.equal(profile.files[0].spec, 'napper.spec.js', 'the file that sleeps 600ms is the slowest');
    assert.ok(profile.files[0].ms >= 600);
    const times = profile.files.map((file) => file.ms);
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.deepEqual(profile.files.filter((file) => !file.ok).map((file) => file.spec), ['broken.spec.js']);
    assert.equal(profile.failedSpecs, 1);
    assert.equal(profile.workers, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-profile: the text report names the method, the totals and marks failing files; --top limits the rows', async () => {
  const dir = makeProject();
  try {
    const profile = await profileOf(dir);
    const text = formatProfile(profile, 2);
    assert.ok(text.includes(PROFILE_METHOD));
    assert.match(text, /Profile of 3 spec files \(3 tests\), 2 at a time/);
    assert.match(text, /sum of file times .*1 spec file\(s\) failed or timed out/);
    assert.match(text, /\.\.\.1 faster file\(s\) not shown/);
    assert.equal(text.split('\n').filter((line) => line.includes('.spec.js')).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
