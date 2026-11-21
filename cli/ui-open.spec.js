import test from 'node:test';
import assert from 'node:assert/strict';
import { skipOpenReason, openInBrowser } from './ui-open.js';

const desktop = { argv: [], env: { DISPLAY: ':0' }, isTty: true, platform: 'linux' };

test('ui-open: opens on a terminal with a display, and says why it would not', () => {
  assert.equal(skipOpenReason(desktop), '');
  assert.equal(skipOpenReason({ ...desktop, argv: ['ui', '--no-open'] }), '--no-open');
  assert.equal(skipOpenReason({ ...desktop, env: { DISPLAY: ':0', CHEMX_UI_NO_OPEN: '1' } }), 'CHEMX_UI_NO_OPEN=1');
  assert.equal(skipOpenReason({ ...desktop, env: { DISPLAY: ':0', CI: 'true' } }), 'CI');
  assert.equal(skipOpenReason({ ...desktop, isTty: false }), 'not a terminal');
  assert.equal(skipOpenReason({ ...desktop, env: {} }), 'no display');
});

test('ui-open: spawns the platform opener with the URL, detached', () => {
  const calls = [];
  const fake = (cmd, args, opts) => { calls.push([cmd, args, opts.detached]); return { on() {}, unref() {} }; };
  assert.deepEqual(openInBrowser('http://127.0.0.1:4173/?token=t', { ...desktop, spawn: fake }), { opened: true, reason: '' });
  assert.deepEqual(calls, [['xdg-open', ['http://127.0.0.1:4173/?token=t'], true]]);
  assert.equal(openInBrowser('u', { ...desktop, isTty: false, spawn: fake }).opened, false);
});
