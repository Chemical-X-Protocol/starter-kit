import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_PROFILE, getProfileDefaults, loadProjectConfig } from './index.js';

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
