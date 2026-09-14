import test from 'node:test';
import assert from 'node:assert';
import {
  copyViaOsc52,
  copyToClipboard,
  parseGitRemoteUrl
} from './social-git.js';

test('copyViaOsc52: edge cases and input validation', () => {
  assert.strictEqual(copyViaOsc52(''), false);
  assert.strictEqual(copyViaOsc52(null), false);
  assert.strictEqual(copyViaOsc52(undefined), false);
  assert.strictEqual(copyViaOsc52(123), false);
});

test('copyViaOsc52: generates OSC 52 sequence without throwing', () => {
  const originalWrite = process.stdout.write;
  let written = '';
  process.stdout.write = (chunk) => {
    written += chunk;
    return true;
  };

  try {
    const isTty = process.stdout.isTTY;
    process.stdout.isTTY = true;
    const res = copyViaOsc52('Hello Chemical X');
    assert.strictEqual(res, true);
    assert.ok(written.includes('\x1b]52;c;'));
    assert.ok(written.includes(Buffer.from('Hello Chemical X').toString('base64')));
    process.stdout.isTTY = isTty;
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('copyToClipboard: handles invalid and empty inputs gracefully', () => {
  assert.strictEqual(copyToClipboard(''), false);
  assert.strictEqual(copyToClipboard(null), false);
  assert.strictEqual(copyToClipboard(undefined), false);
});

test('copyToClipboard: executes without hanging and respects timeout boundaries', () => {
  const startTime = Date.now();
  const res = copyToClipboard('Test refactoring prompt content');
  const elapsed = Date.now() - startTime;

  assert.ok(elapsed < 1000, `Expected elapsed time < 1000ms, got ${elapsed}ms`);
  assert.strictEqual(typeof res, 'boolean');
});

test('parseGitRemoteUrl: handles SSH and HTTPS URLs correctly', () => {
  const ssh = parseGitRemoteUrl('git@github.com:Chemical-X-Protocol/starter-kit.git');
  assert.deepStrictEqual(ssh, {
    owner: 'Chemical-X-Protocol',
    repo: 'starter-kit',
    nameWithOwner: 'Chemical-X-Protocol/starter-kit',
    url: 'https://github.com/Chemical-X-Protocol/starter-kit'
  });

  const https = parseGitRemoteUrl('https://github.com/Chemical-X-Protocol/starter-kit.git');
  assert.deepStrictEqual(https, {
    owner: 'Chemical-X-Protocol',
    repo: 'starter-kit',
    nameWithOwner: 'Chemical-X-Protocol/starter-kit',
    url: 'https://github.com/Chemical-X-Protocol/starter-kit'
  });

  assert.strictEqual(parseGitRemoteUrl(''), null);
  assert.strictEqual(parseGitRemoteUrl(null), null);
});
