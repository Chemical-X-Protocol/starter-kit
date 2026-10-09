import './spec-isolated-home.js';
import test from 'node:test';
import assert from 'node:assert';
import { renderSharePreview, confirmShare, shareExitCode, hasYesFlag } from './share-consent.js';
import { handleShareToDiscussions } from './navigator-share.js';
import { STATUS } from './result-status.js';

const silence = async (fn) => {
  const saved = { out: process.stdout.write, err: process.stderr.write, fetch: globalThis.fetch };
  const output = [];
  const fetchCalls = [];
  process.stdout.write = (chunk) => { output.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { output.push(String(chunk)); return true; };
  globalThis.fetch = async (url) => { fetchCalls.push(String(url)); return new Response('{}', { status: 500 }); };
  try {
    return await fn({ output, fetchCalls });
  } finally {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    globalThis.fetch = saved.fetch;
  }
};

test('preview: shows the target repo, category, exact title and exact body', () => {
  const body = '## Score\n\nGrade **A** with `code` and $pecial chars';
  const preview = renderSharePreview({ repo: 'Org/repo', category: 'Audits', title: 'My Title', body, existingNumber: 42 });
  assert.match(preview, /Repo: {5}https:\/\/github\.com\/Org\/repo/);
  assert.match(preview, /Category: Audits/);
  assert.match(preview, /Title: My Title/);
  assert.ok(preview.includes(body), 'body is printed verbatim');
  assert.match(preview, /update discussion #42/);
});

test('consent: interactive prompt defaults to no and only an explicit yes posts', async () => {
  const asked = [];
  const confirm = async (text, yesLabel, noLabel, defaultVal) => { asked.push(defaultVal); return false; };
  const declined = await confirmShare({ repo: 'Org/repo', canPrompt: true, confirm });
  assert.deepStrictEqual(asked, [false], 'the prompt default is no');
  assert.strictEqual(declined.confirmed, false);
  assert.strictEqual(declined.declined, true);
  const accepted = await confirmShare({ repo: 'Org/repo', canPrompt: true, confirm: async () => true });
  assert.strictEqual(accepted.confirmed, true);
});

test('consent: non-interactive refuses unless --yes', async () => {
  const refused = await confirmShare({ repo: 'Org/repo', canPrompt: false });
  assert.strictEqual(refused.confirmed, false);
  assert.match(refused.reason, /--yes/);
  const forced = await confirmShare({ repo: 'Org/repo', canPrompt: false, isYes: true });
  assert.strictEqual(forced.confirmed, true);
});

test('share: a non-interactive share without --yes posts nothing and fails', async () => {
  await silence(async ({ fetchCalls }) => {
    const result = await handleShareToDiscussions({ health: { score: 90 }, violations: { total: 0 } }, { isInteractive: false, isYes: false });
    assert.strictEqual(result.posted, false);
    assert.strictEqual(result.status, STATUS.FAIL);
    assert.strictEqual(fetchCalls.length, 0);
    assert.strictEqual(shareExitCode(result), 1);
  });
});

test('share: offline mode posts nothing and says so', async () => {
  process.env.CHEMX_OFFLINE = '1';
  try {
    await silence(async ({ output, fetchCalls }) => {
      const result = await handleShareToDiscussions({}, { isInteractive: true, isYes: true });
      assert.strictEqual(result.posted, false);
      assert.strictEqual(fetchCalls.length, 0);
      assert.match(output.join(''), /Offline mode \(CHEMX_OFFLINE=1\)/);
    });
  } finally {
    delete process.env.CHEMX_OFFLINE;
  }
});

test('shareExitCode: a user decline is not an error exit', () => {
  assert.strictEqual(shareExitCode({ status: STATUS.INCONCLUSIVE, declined: true }), 0);
  assert.strictEqual(hasYesFlag(['audit', '--share', '-y']), true);
});
