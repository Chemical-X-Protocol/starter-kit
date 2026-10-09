// Ported from ce36c80: config comments are stripped only outside JSON strings.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProjectConfig } from './index.js';
import { stripJsonComments, parseJsonSafe } from './loader.js';

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

describe('config comment stripping leaves strings alone', () => {
  for (const relPath of ['.chemxrc', '.chemx/config.json']) {
    it(`keeps /* and */ inside glob strings in ${relPath}`, () => {
      const cfg = loadConfigFile(relPath, GLOB_CONFIG);
      assert.equal(cfg.profile, 'atomic-strict');
      assert.deepEqual(cfg.overrides, [{ files: ['src/**/*.spec.ts'] }]);
      assert.equal(cfg.raw.include, 'app/**/x');
    });
  }

  it('keeps a glob pair that would otherwise swallow the profile key between them', () => {
    const cfg = loadConfigFile('.chemxrc', '{"include":["src/*"],"profile":"atomic-strict","exclude":["*/dist"]}');
    assert.equal(cfg.profile, 'atomic-strict');
    assert.deepEqual(cfg.raw.exclude, ['*/dist']);
  });

  it('strips line and block comments outside strings, including trailing ones', () => {
    const text = '// team\n{\n  /* strict */ "profile": "atomic-strict", // trailing\n  "url": "https://x.dev/a//b"\n}\n';
    assert.deepEqual(parseJsonSafe(text), { profile: 'atomic-strict', url: 'https://x.dev/a//b' });
  });

  it('honours backslash escapes, so an escaped quote does not end the string early', () => {
    const text = '{"note":"a \\"/*\\" b","profile":"atomic-strict","x":"*/"}';
    assert.deepEqual(parseJsonSafe(text), { note: 'a "/*" b', profile: 'atomic-strict', x: '*/' });
  });

  it('keeps an escaped backslash before the closing quote from hiding the next comment', () => {
    const text = '{"dir":"C:\\\\"/* gone */,"profile":"atomic-strict"}';
    assert.deepEqual(parseJsonSafe(text), { dir: 'C:\\', profile: 'atomic-strict' });
  });

  it('strips a line comment that ends the text without a newline', () => {
    assert.deepEqual(parseJsonSafe('{"profile":"atomic-strict"} // end'), { profile: 'atomic-strict' });
  });

  it('strips an unterminated block comment to the end of the text', () => {
    assert.equal(stripJsonComments('{"a":1}/* open').trim(), '{"a":1}');
  });
});
