import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseScriptAsts } from './script-asts.js';

const parses = (code, path) => parseScriptAsts(code, null, code, path).error === null;

describe('parseScriptAsts parse options (#4563)', () => {
  it('accepts decorators before and after export', () => {
    assert.equal(parses('@d export class A {}', 'a.ts'), true);
    assert.equal(parses('export @d class A {}', 'a.ts'), true);
  });
  it('accepts angle-bracket casts in .ts but not .js', () => {
    assert.equal(parses('const a = <any>b;', 'a.ts'), true);
    assert.equal(parses('const a = <any>b;', 'a.js'), false);
  });
  it('accepts the accessor keyword', () => {
    assert.equal(parses('class A { accessor x = 1; }', 'a.ts'), true);
  });
});
