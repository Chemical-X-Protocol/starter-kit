// Error-report hygiene: license keys never reach a report, an opt-in post shows what it sends,
// and an offline or failed post tells the user where the local report is instead of going silent.
import '../spec-isolated-home.js';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeText } from './sanitizer.js';
import { formatIssueContent } from './formatter.js';
import { handleError } from './index.js';

const KEY = 'CX-ABCD-EFGH-IJKL';
const KEY_BODY = 'ABCD-EFGH-IJKL';

const captureOutput = async (fn) => {
  const chunks = [];
  const original = { out: process.stdout.write, err: process.stderr.write };
  const record = (chunk) => { chunks.push(String(chunk)); return true; };
  process.stdout.write = record;
  process.stderr.write = record;
  try {
    const result = await fn(chunks);
    return { result, output: chunks.join('') };
  } finally {
    process.stdout.write = original.out;
    process.stderr.write = original.err;
  }
};

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const [name, value] of Object.entries(vars)) {
    saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

const tmpProject = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-report-'));

test('sanitizeText masks license keys in flags, env assignments and bare text', () => {
  const samples = [
    `create app --license ${KEY}`,
    `create app --license=${KEY}`,
    `create app --license ${KEY.toLowerCase()}`,
    `CHEMX_LICENSE_KEY=${KEY} chemx create app`,
    `license verify failed for ${KEY}`,
    'create app --license some-other-format-key'
  ];
  for (const sample of samples) {
    const out = sanitizeText(sample);
    assert.doesNotMatch(out, /ABCD-EFGH-IJKL/i, `key leaked: ${out}`);
    assert.doesNotMatch(out, /some-other-format-key/, `key leaked: ${out}`);
  }
  assert.strictEqual(sanitizeText('create app --license --yes'), 'create app --license --yes');
  assert.strictEqual(sanitizeText('chemx create --license-file ./k'), 'chemx create --license-file ./k');
});

test('issue title, body and prefilled web URL never contain the license key', () => {
  const report = {
    message: `create failed: --license ${KEY}`,
    stack: `Error: Build command failed: chemx create app --license ${KEY}\n    at x (file.js:1:1)`,
    command: `create app --license ${KEY}`,
    cwd: '/tmp/project'
  };
  const issue = formatIssueContent(report, 'owner/repo');
  assert.ok(!issue.title.includes(KEY_BODY), issue.title);
  assert.ok(!issue.body.includes(KEY_BODY), issue.body);
  assert.ok(!decodeURIComponent(issue.webUrl).includes(KEY_BODY));
});

test('offline auto-post says why nothing was posted and where the local report is', async () => {
  const cwd = tmpProject();
  const calls = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}', { status: 201 }); };
  try {
    const { result, output } = await withEnv({ CHEMX_OFFLINE: '1', CHEMX_AUTO_POST_ISSUES: 'true', GH_TOKEN: 'fake' }, () =>
      captureOutput(() => handleError(new Error('boom'), { cwd, repo: 'owner/repo', createTask: false })));
    assert.deepStrictEqual(calls, []);
    assert.match(output, /Command Failed: boom/);
    assert.match(output, /Offline mode \(CHEMX_OFFLINE=1\)/);
    assert.ok(result.savedPath && output.includes(result.savedPath), `local report path missing from: ${output}`);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('an opt-in auto-post previews repo, title and exact body before the request, with the key masked', async () => {
  const cwd = tmpProject();
  const events = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    events.push({ kind: 'fetch', url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ html_url: 'https://github.com/owner/repo/issues/7', number: 7 }), { status: 201 });
  };
  try {
    const { output } = await withEnv({ CHEMX_OFFLINE: undefined, DO_NOT_TRACK: undefined, GH_TOKEN: 'fake' }, () =>
      captureOutput(async (chunks) => {
        const origFetch = globalThis.fetch;
        globalThis.fetch = async (url, init) => { events.push({ kind: 'printed-before', text: chunks.join('') }); return origFetch(url, init); };
        try {
          return await handleError(new Error('boom'), { cwd, repo: 'owner/repo', autoPost: true, createTask: false, command: `create app --license ${KEY}` });
        } finally {
          globalThis.fetch = origFetch;
        }
      }));
    const before = events.find((e) => e.kind === 'printed-before');
    const posted = events.find((e) => e.kind === 'fetch');
    assert.ok(before && posted, 'the post must happen');
    assert.match(before.text, /owner\/repo/);
    assert.ok(before.text.includes(posted.body.title), 'title must be shown before posting');
    assert.ok(before.text.includes(posted.body.body), 'exact body must be shown before posting');
    assert.ok(!JSON.stringify(posted.body).includes(KEY_BODY), 'key must not be posted');
    assert.ok(!output.includes(KEY_BODY), 'key must not be printed');
  } finally {
    globalThis.fetch = savedFetch;
  }
});
