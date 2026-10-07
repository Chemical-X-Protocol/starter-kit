import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadProjectConfig } from './config/index.js';
import { getMcpPrompt, MCP_PROMPTS } from './mcp/prompts.js';
import { createMcpHandler } from './mcp/server.js';
import { ALL_MCP_TOOLS } from './mcp/manifests.js';
import { COMMANDS_SCHEMA } from './commands-schema.js';
import { printGenerateHelp, formatStandardsSummary } from './generator-help.js';
import { runGenerateWizard } from './generator.js';
import { buildDirectives, DIRECTIVES, renderManifesto } from './tesseract-manifesto.js';
import { runTesseract } from './tesseract.js';
import { formatSystemGuide } from './navigator-guide.js';
import { formatTargetFileBudget } from './navigator-conversion.js';

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text) => String(text).replace(ANSI_PATTERN, '');
const FIXED_100_CLAIM = /<\s*100\s*(lines|LOC)/;
const MOLECULE_SOURCE = Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i};`).join('\n');

const tmpRoots = [];
const createProject = (rcContent) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-budget-text-'));
  tmpRoots.push(root);
  if (rcContent) fs.writeFileSync(path.join(root, '.chemxrc'), rcContent);
  fs.mkdirSync(path.join(root, 'src', 'molecules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'molecules', 'm-card.ts'), MOLECULE_SOURCE);
  return root;
};

after(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
});

const strictRoot = createProject('{"profile":"atomic-strict"}');
const pragmaticRoot = createProject(null);
const STRICT_CONFIG = loadProjectConfig(strictRoot);
const PRAGMATIC_CONFIG = loadProjectConfig(pragmaticRoot);

// Lines may still cite 100 lines when they name atomic-strict as the reason.
const assertNoUnqualified100Claim = (text) => {
  for (const line of stripAnsi(text).split('\n')) {
    const isFixedClaim = FIXED_100_CLAIM.test(line);
    const isQualified = line.includes('atomic-strict');
    assert.ok(!isFixedClaim || isQualified, `unqualified 100-line claim: ${line}`);
  }
};

const captureStdout = async (fn) => {
  const originalWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += String(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return stripAnsi(captured);
};

const promptText = (result) => result.messages[0].content.text;

describe('static manifests describe the molecule budget without a fixed number', () => {
  it('MCP prompt list, generate tool schema and command schema', () => {
    const remediate = MCP_PROMPTS.find((p) => p.name === 'chemx_remediate_hotspot');
    assert.doesNotMatch(remediate.description, FIXED_100_CLAIM);
    assert.ok(remediate.description.includes('active profile line budget'));

    const tierDescriptions = ALL_MCP_TOOLS
      .map((tool) => tool.inputSchema?.properties?.tier?.description)
      .filter(Boolean);
    assert.ok(tierDescriptions.length > 0, 'expected a tool with a tier description');
    for (const description of tierDescriptions) {
      assert.doesNotMatch(description, FIXED_100_CLAIM);
    }

    const generate = COMMANDS_SCHEMA.find((c) => c.name === 'generate');
    assert.ok(generate.summary.length > 0);
    assert.doesNotMatch(generate.summary, FIXED_100_CLAIM);
  });
});

describe('MCP chemx_remediate_hotspot prompt reads the project profile', () => {
  it('uses the atomic-strict limit from the cwd option', async () => {
    const result = await getMcpPrompt('chemx_remediate_hotspot', { filePath: 'src/molecules/m-card.ts' }, { cwd: strictRoot });
    const text = promptText(result);
    assert.ok(text.includes('Target File: `src/molecules/m-card.ts`'), text);
    assert.ok(text.includes('Molecular limit: 100L, atomic-strict profile'), text);
    assert.ok(text.includes('Maximum 100 lines per molecule capsule file (active profile)'), text);
    assert.doesNotMatch(text, FIXED_100_CLAIM);
  });

  it('uses the pragmatic 250-line limit when the project has no config', async () => {
    const result = await getMcpPrompt('chemx_remediate_hotspot', { filePath: 'src/molecules/m-card.ts' }, { cwd: pragmaticRoot });
    const text = promptText(result);
    assert.ok(text.includes('Molecular limit: 250L, pragmatic profile'), text);
    assert.ok(text.includes('Maximum 250 lines per molecule capsule file (active profile)'), text);
    assert.doesNotMatch(text, FIXED_100_CLAIM);
  });

  it('is resolved against the root the MCP server was started for', async () => {
    const handler = createMcpHandler({ cwd: strictRoot });
    const res = await handler.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'prompts/get',
      params: { name: 'chemx_remediate_hotspot', arguments: { filePath: 'src/molecules/m-card.ts' } }
    });
    const text = promptText(res.result);
    assert.ok(text.includes('Molecular limit: 100L, atomic-strict profile'), text);
  });
});

describe('generator text reads the project profile', () => {
  it('printGenerateHelp shows the derived molecule limit', async () => {
    const strictHelp = await captureStdout(() => printGenerateHelp(STRICT_CONFIG));
    assert.ok(strictHelp.includes('Molecule capsule template:  <= 100 lines (outer bound, atomic-strict profile)'), strictHelp);
    assertNoUnqualified100Claim(strictHelp);

    const pragmaticHelp = await captureStdout(() => printGenerateHelp(PRAGMATIC_CONFIG));
    assert.ok(pragmaticHelp.includes('Molecule capsule template:  <= 250 lines (outer bound, pragmatic profile)'), pragmaticHelp);
    assert.ok(pragmaticHelp.includes('Table of Contents view:     10-20 lines'));
    assertNoUnqualified100Claim(pragmaticHelp);
  });

  it('generate --help forwards the --profile flag to the help text', async () => {
    const output = await captureStdout(() => runGenerateWizard(['--help', '--profile=atomic-strict']));
    assert.ok(output.includes('<= 100 lines (outer bound, atomic-strict profile)'), output);
  });

  it('formatStandardsSummary reports the largest file against the molecule budget', () => {
    const previews = [{ file: 'a.ts', lines: 41 }, { file: 'b.ts', lines: 72 }];
    const strictSummary = formatStandardsSummary({ previews, config: STRICT_CONFIG, traits: 'Result tuples' });
    assert.strictEqual(strictSummary, 'Chemical X Standards: largest generated file 72 lines (molecule budget 100, atomic-strict profile), Result tuples.');
    const pragmaticSummary = formatStandardsSummary({ previews: [], config: PRAGMATIC_CONFIG, traits: 'co-located spec tests' });
    assert.strictEqual(pragmaticSummary, 'Chemical X Standards: largest generated file 0 lines (molecule budget 250, pragmatic profile), co-located spec tests.');
  });
});

describe('tesseract directives read the project profile', () => {
  it('buildDirectives names the molecule budget and profile', () => {
    assert.ok(buildDirectives({ moleculeLineLimit: 250, profile: 'pragmatic' })[0].desc.includes('250-line molecule budget (pragmatic profile)'));
    assert.ok(DIRECTIVES[0].desc.includes('250-line molecule budget (pragmatic profile)'));
    const manifesto = renderManifesto(buildDirectives({ moleculeLineLimit: 100, profile: 'atomic-strict' }));
    assert.ok(stripAnsi(manifesto).includes('100-line molecule budget (atomic-strict profile)'));
  });

  it('runTesseract loads the profile from its cwd', async () => {
    const payload = await runTesseract(['--json'], false, strictRoot);
    assert.ok(payload.directives[0].desc.includes('100-line molecule budget (atomic-strict profile)'), payload.directives[0].desc);
    const { text } = await runTesseract([], false, pragmaticRoot);
    assert.ok(stripAnsi(text).includes('250-line molecule budget (pragmatic profile)'));
  });
});

describe('navigator text reads the project profile', () => {
  it('formatSystemGuide prints the derived limit', () => {
    const pragmaticGuide = stripAnsi(formatSystemGuide(PRAGMATIC_CONFIG));
    assert.ok(pragmaticGuide.includes('Crystalline Molecular Capsules (<= 250 lines, pragmatic profile)'), pragmaticGuide);
    assert.ok(pragmaticGuide.includes('Composed blocks (<= 250 lines,'));
    assert.ok(pragmaticGuide.includes('files exceeding the active line budget'));
    assertNoUnqualified100Claim(pragmaticGuide);

    const strictGuide = stripAnsi(formatSystemGuide(STRICT_CONFIG));
    assert.ok(strictGuide.includes('Crystalline Molecular Capsules (<= 100 lines, atomic-strict profile)'), strictGuide);
  });

  it('formatTargetFileBudget prints the derived limit', () => {
    assert.strictEqual(formatTargetFileBudget(PRAGMATIC_CONFIG), 'Target File Budget: Max 500 lines/file (<= 250 lines/molecule)');
    assert.strictEqual(formatTargetFileBudget(STRICT_CONFIG), 'Target File Budget: Max 500 lines/file (<= 100 lines/molecule)');
  });
});

describe('source comments do not restate a fixed 100-line budget', () => {
  const files = [
    'cli/generator-jig.js',
    'cli/embeddings/vectorizer.js',
    'cli/generator-help.js',
    'cli/generator-jig-cli.js',
    'cli/generator.js',
    'cli/navigator-conversion.js',
    'cli/mcp/prompts.js'
  ];
  for (const file of files) {
    it(file, () => {
      assertNoUnqualified100Claim(fs.readFileSync(path.resolve(file), 'utf8'));
    });
  }
});
