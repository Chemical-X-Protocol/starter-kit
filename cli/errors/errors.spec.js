import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  maskSensitiveTokens,
  normalizeHomePath,
  sanitizeText,
  sanitizeStackTrace
} from './sanitizer.js';
import {
  buildIssueTitle,
  buildIssueBody,
  buildIssueWebUrl,
  formatIssueContent
} from './formatter.js';
import {
  handleError,
  resolveTargetIssuesRepo,
  saveIssueArtifact
} from './catcher.js';
import { withErrorCatcher } from './index.js';

describe('Universal Error Catcher: Sanitizer', () => {
  it('masks GitHub personal access tokens and npm tokens', () => {
    const input = 'Failed with token ghp_123456789012345678901234567890123456 and npm_abcdefghijklmnopqrstuvwxyz012345';
    const sanitized = maskSensitiveTokens(input);
    assert.ok(!sanitized.includes('ghp_1234567890'));
    assert.ok(!sanitized.includes('npm_abcdefgh'));
    assert.ok(sanitized.includes('[REDACTED_SECRET]'));
  });

  it('masks Bearer tokens and api-key parameters', () => {
    const input = 'Authorization: Bearer mySecretToken123456789\napiKey="superSecretApiKey123"';
    const sanitized = maskSensitiveTokens(input);
    assert.ok(!sanitized.includes('mySecretToken123456789'));
    assert.ok(!sanitized.includes('superSecretApiKey123'));
    assert.ok(sanitized.includes('Bearer [REDACTED]'));
  });

  it('normalizes home directory paths', () => {
    const home = os.homedir();
    const input = `Error reading file in ${home}/my-project/index.ts`;
    const normalized = normalizeHomePath(input);
    assert.ok(!normalized.includes(home));
    assert.ok(normalized.includes('~/my-project/index.ts'));
  });

  it('sanitizes full stack traces', () => {
    const home = os.homedir();
    const stack = `Error: crash\n    at test (${home}/apps/test.js:10:5)\n    token: ghp_123456789012345678901234567890`;
    const sanitized = sanitizeStackTrace(stack);
    assert.ok(!sanitized.includes(home));
    assert.ok(!sanitized.includes('ghp_1234567890'));
    assert.ok(sanitized.includes('~/apps/test.js'));
  });
});

describe('Universal Error Catcher: Formatter', () => {
  const sampleReport = {
    message: 'TypeError: Cannot read properties of undefined',
    name: 'TypeError',
    stack: 'TypeError: Cannot read properties of undefined\n    at run (/src/app.ts:1:1)',
    command: 'chemx build --production',
    cwd: '/workspace',
    exitCode: 1,
    timestamp: '2026-09-17T12:00:00.000Z',
    nodeVersion: 'v22.20.0',
    platform: 'linux-x64',
    chemxVersion: '26.9.17'
  };

  it('builds concise issue title', () => {
    const title = buildIssueTitle(sampleReport);
    assert.ok(title.startsWith('[ChemX Failure] chemx:'));
    assert.ok(title.includes('TypeError: Cannot read properties'));
  });

  it('builds detailed markdown issue body with environment and details', () => {
    const body = buildIssueBody(sampleReport);
    assert.ok(body.includes('Execution Context'));
    assert.ok(body.includes('`chemx build --production`'));
    assert.ok(body.includes('v22.20.0'));
    assert.ok(body.includes('Diagnostic Stack Trace'));
    assert.ok(body.includes('<details open>'));
  });

  it('constructs valid GitHub new issue web url', () => {
    const url = buildIssueWebUrl('org/repo', 'Issue Title', 'Issue Body', ['bug', 'build-failure']);
    assert.ok(url.startsWith('https://github.com/org/repo/issues/new?'));
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('title'), 'Issue Title');
    assert.equal(parsed.searchParams.get('labels'), 'bug,build-failure');
  });

  it('formats full issue content object', () => {
    const content = formatIssueContent(sampleReport, 'my-org/my-repo', ['critical-error']);
    assert.equal(content.targetRepo, 'my-org/my-repo');
    assert.deepEqual(content.labels, ['critical-error']);
    assert.ok(content.webUrl.includes('my-org/my-repo/issues/new'));
  });
});

describe('Universal Error Catcher: Catcher & Orchestration', () => {
  it('resolves explicit repo option over defaults', () => {
    const repo = resolveTargetIssuesRepo({ repo: 'custom/repo' }, '/tmp');
    assert.equal(repo, 'custom/repo');
  });

  it('saves issue markdown artifact to .chemx/issues directory', () => {
    const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-err-test-'));
    try {
      const issue = {
        title: 'Test Error',
        body: '# Test Error Markdown Body',
        labels: ['test'],
        webUrl: 'https://github.com/test/repo/issues/new',
        targetRepo: 'test/repo'
      };
      const savedPath = saveIssueArtifact(tempCwd, issue);
      assert.ok(savedPath && fs.existsSync(savedPath));
      const content = fs.readFileSync(savedPath, 'utf-8');
      assert.equal(content, issue.body);

      const lastPath = path.join(tempCwd, '.chemx', 'issues', 'last-error-issue.md');
      assert.ok(fs.existsSync(lastPath));
    } finally {
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
  });

  it('withErrorCatcher returns function result on success', async () => {
    const result = await withErrorCatcher(async () => 42, { exitOnError: false });
    assert.equal(result, 42);
  });

  it('withErrorCatcher catches error, prepares issue, and returns error result without crashing', async () => {
    const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-catcher-test-'));
    try {
      const res = await withErrorCatcher(
        async () => {
          throw new Error('Simulated build pipeline failure');
        },
        {
          cwd: tempCwd,
          silent: true,
          exitOnError: false,
          repo: 'test-org/test-repo'
        }
      );

      assert.ok(res.report);
      assert.equal(res.report.message, 'Simulated build pipeline failure');
      assert.ok(res.issue);
      assert.equal(res.issue.targetRepo, 'test-org/test-repo');
      assert.ok(res.savedPath);
      assert.ok(fs.existsSync(res.savedPath));
    } finally {
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
  });
});
