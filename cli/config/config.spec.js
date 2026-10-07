import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PROFILE, getProfileDefaults, loadProjectConfig } from './index.js';
import { stripJsonComments, parseJsonSafe } from './loader.js';

describe('Chemical X Configuration & Profiles', () => {
  it('defines pragmatic as the default profile with greybeard staff thresholds', () => {
    assert.strictEqual(DEFAULT_PROFILE, 'pragmatic');
    const defaults = getProfileDefaults('pragmatic');
    assert.strictEqual(defaults.profile, 'pragmatic');
    assert.strictEqual(defaults.enforceFileLength, false);
    assert.strictEqual(defaults.ruleOfThreeAbstractions, true);
    assert.strictEqual(defaults.maxCyclomaticComplexity, 12);
    assert.strictEqual(defaults.maxHookDensity, 4);
    assert.strictEqual(defaults.preferDesignTokens, 'warning');
  });

  it('defines atomic-strict profile with strict 100-line capsule limit', () => {
    const strict = getProfileDefaults('atomic-strict');
    assert.strictEqual(strict.profile, 'atomic-strict');
    assert.strictEqual(strict.enforceFileLength, true);
    assert.strictEqual(strict.ruleOfThreeAbstractions, false);
    assert.strictEqual(strict.maxLineCountWarning, 100);
    assert.strictEqual(strict.preferDesignTokens, 'error');
  });

  it('defines loose profile with permissive thresholds', () => {
    const loose = getProfileDefaults('loose');
    assert.strictEqual(loose.profile, 'loose');
    assert.strictEqual(loose.enforceFileLength, false);
    assert.strictEqual(loose.maxCyclomaticComplexity, 25);
    assert.strictEqual(loose.preferDesignTokens, 'off');
  });

  it('falls back to default profile for unknown profile names', () => {
    const fallback = getProfileDefaults('unknown-profile');
    assert.strictEqual(fallback.profile, 'pragmatic');
  });

  it('parses --profile CLI argument and overrides file config', () => {
    const cfg = loadProjectConfig(process.cwd(), ['--profile=atomic-strict']);
    assert.strictEqual(cfg.profile, 'atomic-strict');
    assert.strictEqual(cfg.rules.enforceFileLength, true);
  });

  it('defaults to pragmatic profile when no flags or config files specify otherwise', () => {
    const cfg = loadProjectConfig('/tmp/non-existent-dir-for-chemx-test');
    assert.strictEqual(cfg.profile, 'pragmatic');
    assert.strictEqual(cfg.rules.enforceFileLength, false);
    assert.strictEqual(cfg.rules.maxCyclomaticComplexity, 12);
  });
});

// Writes one config file into a fresh project root, loads it, then removes the root again.
const loadConfigFile = (relPath, content) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-config-file-'));
  try {
    fs.mkdirSync(path.dirname(path.join(root, relPath)), { recursive: true });
    fs.writeFileSync(path.join(root, relPath), content);
    return loadProjectConfig(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const GLOB_CONFIG = '{"profile":"atomic-strict","overrides":[{"files":["src/**/*.spec.ts"]}],"include":"app/**/x"}';

describe('Chemical X Configuration: comment stripping leaves strings alone', () => {
  for (const relPath of ['.chemxrc', '.chemx/config.json']) {
    it(`keeps /* and */ inside glob strings in ${relPath}`, () => {
      const cfg = loadConfigFile(relPath, GLOB_CONFIG);
      assert.strictEqual(cfg.profile, 'atomic-strict');
      assert.deepStrictEqual(cfg.overrides, [{ files: ['src/**/*.spec.ts'] }]);
      assert.strictEqual(cfg.raw.include, 'app/**/x');
    });
  }

  it('keeps a glob pair that would otherwise swallow the profile key between them', () => {
    const cfg = loadConfigFile('.chemxrc', '{"include":["src/*"],"profile":"atomic-strict","exclude":["*/dist"]}');
    assert.strictEqual(cfg.profile, 'atomic-strict');
    assert.deepStrictEqual(cfg.raw.exclude, ['*/dist']);
  });

  it('strips line and block comments outside strings, including trailing ones', () => {
    const text = '// team\n{\n  /* strict */ "profile": "atomic-strict", // trailing\n  "url": "https://x.dev/a//b"\n}\n';
    assert.deepStrictEqual(parseJsonSafe(text), { profile: 'atomic-strict', url: 'https://x.dev/a//b' });
  });

  it('honours backslash escapes, so an escaped quote does not end the string early', () => {
    const text = '{"note":"a \\"/*\\" b","profile":"atomic-strict","x":"*/"}';
    assert.deepStrictEqual(parseJsonSafe(text), { note: 'a "/*" b', profile: 'atomic-strict', x: '*/' });
  });

  it('keeps an escaped backslash before the closing quote from hiding the next comment', () => {
    const text = '{"dir":"C:\\\\"/* gone */,"profile":"atomic-strict"}';
    assert.deepStrictEqual(parseJsonSafe(text), { dir: 'C:\\', profile: 'atomic-strict' });
  });

  it('strips a line comment that ends the text without a newline', () => {
    assert.deepStrictEqual(parseJsonSafe('{"profile":"atomic-strict"} // end'), { profile: 'atomic-strict' });
  });

  it('strips an unterminated block comment to the end of the text', () => {
    assert.strictEqual(stripJsonComments('{"a":1}/* open').trim(), '{"a":1}');
  });
});
