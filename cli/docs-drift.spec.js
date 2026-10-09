import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeLineBudgetPolicy } from './config/profiles.js';
import { MCP_TOOLS } from './mcp/manifests.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(KIT_ROOT, rel), 'utf8');

// Everything a person or agent reads as guidance: docs, shims, help, footers and hints.
const GUIDANCE_FILES = [
  'README.md', 'AGENTS.md', 'STANDARDS.md', 'llms.txt', 'CLAUDE.md',
  'cli/commands-schema-search.js', 'cli/commands-schema-edit.js', 'cli/commands-schema-verify.js',
  'cli/commands-schema-wrappers.js', 'cli/commands-schema-ops.js',
  'cli/help.js', 'cli/host-shims.js', 'cli/generator-help.js', 'cli/generator.js',
  'cli/navigator-guide.js', 'cli/navigator-conversion.js', 'cli/tesseract-manifesto.js',
  'cli/commands/cmd-wrappers.js', 'cli/reader.js', 'cli/search.js',
  'cli/generator-jig-cli.js', 'cli/generator-jig.js', 'cli/audit/roadmap.js', 'cli/mcp/manifests.js', 'cli/embeddings/vectorizer.js'
];
// Not scanned yet: audit/prompts.js, audit/social.js and mcp/prompts.js (prompt prose, deferred), and the audit
// reporters and rules-helpers, whose "100 lines" labels describe the threshold metrics.js actually computes.

const scan = (pattern, { allow = () => false } = {}) => GUIDANCE_FILES.flatMap((rel) =>
  read(rel).split('\n').flatMap((line, index) => {
    const isHit = pattern.test(line) && !allow(line);
    return isHit ? [`${rel}:${index + 1}: ${line.trim().slice(0, 120)}`] : [];
  }));

test('docs drift: guidance names the published chemx binary, never cx or cmx', () => {
  const pkg = JSON.parse(read('package.json'));
  const publishScript = read('scripts/publish-both.mjs');
  const isAliasPublished = (alias) => Boolean(pkg.bin?.[alias]) && publishScript.includes(`${alias}:`);
  const unpublished = ['cx', 'cmx'].filter((alias) => !isAliasPublished(alias));
  const aliasPattern = new RegExp(`(^|[\\s\`'"(])(${unpublished.join('|')}) [a-z-]`);
  assert.deepStrictEqual(scan(aliasPattern), []);
});

test('docs drift: line budgets state the canonical AGENTS.md policy, not a flat 100-line cap', () => {
  const flatCap = /(<\s*100\s*(lines?|LOC|L\b)|under 100 lines|100 lines is an outer bound|100-line budget|max(imum)? 100 lines)/i;
  const hits = scan(flatCap, { allow: (line) => /atomic-strict/.test(line) });
  assert.deepStrictEqual(hits, []);
  const policy = describeLineBudgetPolicy();
  assert.match(policy, /250 lines/);
  for (const rel of ['README.md', 'STANDARDS.md']) {
    assert.ok(read(rel).includes(policy), `${rel} states the canonical line-budget sentence`);
  }
});

test('docs drift: --version names the chemx binary it runs as', () => {
  const run = spawnSync(process.execPath, [path.join(KIT_ROOT, 'cli', 'index.js'), '--version'], { encoding: 'utf8' });
  const { version } = JSON.parse(read('package.json'));
  assert.strictEqual(run.stdout, `chemx v${version}\n`);
});

test('docs drift: README documents the single chemx MCP tool and every action it accepts', () => {
  const readme = read('README.md');
  const start = readme.indexOf('### The `chemx` MCP Tool');
  assert.ok(start > 0, 'README has a "The `chemx` MCP Tool" section');
  const section = readme.slice(start, readme.indexOf('\n### ', start + 5));
  assert.doesNotMatch(readme, /\(\d+ Tools\)/, 'README must not advertise a tool count');
  assert.strictEqual(MCP_TOOLS.length, 1);
  const actions = MCP_TOOLS[0].inputSchema.properties.action.enum;
  const missing = actions.filter((action) => !section.includes(`\`${action}\``));
  assert.deepStrictEqual(missing, [], 'every MCP action appears in the README table');
});
