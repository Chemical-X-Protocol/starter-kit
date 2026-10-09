// Secrets never leave through the report's side doors: caller context, the failure summary,
// the report fields the swarm task reuses, or a silent (--json/--silent) auto-post without a preview.
import '../spec-isolated-home.js';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatIssueContent } from './formatter.js';
import { printFailureSummary } from './report-output.js';
import { handleError } from './index.js';

const KEY = 'CX-ABCD-EFGH-IJKL';
const KEY_BODY = 'ABCD-EFGH-IJKL';
const GH = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaa';

const capture = async (fn) => {
  const chunks = [];
  const original = { out: process.stdout.write, err: process.stderr.write };
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  process.stderr.write = (c) => { chunks.push(String(c)); return true; };
  try {
    return { result: await fn(chunks), output: chunks.join('') };
  } finally {
    process.stdout.write = original.out;
    process.stderr.write = original.err;
  }
};

const withFetch = async (onFetch, fn) => {
  const saved = { fetch: globalThis.fetch, token: process.env.GH_TOKEN, offline: process.env.CHEMX_OFFLINE, dnt: process.env.DO_NOT_TRACK };
  process.env.GH_TOKEN = 'fake';
  delete process.env.CHEMX_OFFLINE;
  delete process.env.DO_NOT_TRACK;
  globalThis.fetch = async (url, init) => {
    onFetch(url, init);
    return new Response(JSON.stringify({ html_url: 'https://github.com/owner/repo/issues/9', number: 9 }), { status: 201 });
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [['GH_TOKEN', saved.token], ['CHEMX_OFFLINE', saved.offline], ['DO_NOT_TRACK', saved.dnt]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

test('caller context in the issue body is sanitized and stays valid JSON', () => {
  const context = { argv: `create --license ${KEY}`, tok: GH, licenseKey: 'plain-secret-value', nested: { list: [`key ${KEY}`] }, totalErrors: 3 };
  const issue = formatIssueContent({ message: 'm', command: 'x', context }, 'o/r');
  for (const text of [issue.body, decodeURIComponent(issue.webUrl)]) {
    assert.ok(!text.includes(KEY_BODY), 'license key leaked');
    assert.ok(!text.includes('ghp_aaa'), 'GitHub token leaked');
    assert.ok(!text.includes('plain-secret-value'), 'value of a secret-named key leaked');
  }
  const json = issue.body.split('```json\n')[1].split('\n```')[0];
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.totalErrors, 3);
});

test('the failure summary masks the key in the error message', async () => {
  const { output } = await capture(() => printFailureSummary({ message: `Build failed: chemx create --license ${KEY}` }, { webUrl: 'u' }, null));
  assert.match(output, /Command Failed/);
  assert.ok(!output.includes(KEY_BODY), output);
});

test('report message and stack (reused by the swarm task) are masked at source', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-leak-'));
  const { result, output } = await capture(() =>
    handleError(new Error(`Build command failed with exit code 1: npm run build --license ${KEY}`), { cwd, repo: 'o/r', createTask: false }));
  assert.ok(!result.report.message.includes(KEY_BODY), result.report.message);
  assert.ok(!result.report.stack.includes(KEY_BODY), 'stack leaked');
  assert.ok(!output.includes(KEY_BODY), 'printed output leaked');
});

test('a silent CLI auto-post (--json/--silent --post-issue) still previews on stderr before the request', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-leak-'));
  const stderr = [];
  let printedBeforeFetch = null;
  const savedErr = process.stderr.write;
  process.stderr.write = (c) => { stderr.push(String(c)); return true; };
  try {
    await withFetch(() => { printedBeforeFetch = stderr.join(''); }, () =>
      handleError(new Error('boom'), { cwd, repo: 'owner/repo', autoPost: true, silent: true, createTask: false }));
  } finally {
    process.stderr.write = savedErr;
  }
  assert.ok(printedBeforeFetch !== null, 'the post must happen');
  assert.match(printedBeforeFetch, /owner\/repo/);
  assert.match(printedBeforeFetch, /Title: \[ChemX Failure\]/);
});

test('preview: false (the MCP tool, which returns the issue to the agent) posts without printing', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-leak-'));
  let posted = false;
  const { output } = await capture(() => withFetch(() => { posted = true; }, () =>
    handleError(new Error('boom'), { cwd, repo: 'owner/repo', autoPost: true, silent: true, preview: false, createTask: false })));
  assert.ok(posted);
  assert.strictEqual(output, '');
});

test('context with shared and circular references renders without throwing', () => {
  const shared = { n: 1 };
  const context = { a: shared, b: shared };
  context.self = context;
  const issue = formatIssueContent({ message: 'm', command: 'x', context }, 'o/r');
  const parsed = JSON.parse(issue.body.split('```json\n')[1].split('\n```')[0]);
  assert.deepStrictEqual(parsed, { a: { n: 1 }, b: { n: 1 }, self: '[Circular]' });
});

test('Additional Metadata (report.context) goes through the body sanitizer: keys, tokens, home paths and emails', () => {
  const home = os.homedir();
  const EMAIL = 'jane.doe+ci@example.co.uk';
  const context = {
    argv: `chemx create --license ${KEY}`,
    configPath: path.join(home, 'work', 'app', '.chemxrc'),
    author: EMAIL,
    remote: `https://x-access-token:${GH}@github.com/o/r.git`,
    nested: { owners: [`${EMAIL} (maintainer)`], cwd: home }
  };
  const issue = formatIssueContent({ message: `push rejected for ${EMAIL}`, stack: `Error: as ${EMAIL}\n    at ${home}/a.js:1:1`, command: 'x', context }, 'o/r');
  const json = issue.body.split('```json\n')[1].split('\n```')[0];
  const parsed = JSON.parse(json);
  for (const text of [issue.title, issue.body, decodeURIComponent(issue.webUrl)]) {
    assert.ok(!text.includes(KEY_BODY), 'license key leaked');
    assert.ok(!text.includes('ghp_aaa'), 'GitHub token leaked');
    assert.ok(!text.includes(home), 'home path leaked');
    assert.ok(!text.includes('jane.doe'), `email leaked: ${text.slice(0, 400)}`);
  }
  assert.match(parsed.configPath, /^~/);
  assert.strictEqual(typeof parsed.nested.owners[0], 'string');
});
