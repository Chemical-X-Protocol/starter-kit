import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

// C4 where two try statements meet on a line: which catch owns each chemx-allow annotation.
const CATCH_FAMILY = new Set(['ERROR_SWALLOWED_EXCEPTION', 'AI_SLOP_SHALLOW_CATCH']);
const REASON = 'best-effort warm cache is optional';
const catchColumns = (code, rel = 'src/x.ts') => auditCode(code, rel, rel)
  .filter((v) => CATCH_FAMILY.has(v.rule))
  .map((v) => [v.line, v.catchColumn])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const vueSetup = (code) => `<template>\n  <p />\n</template>\n<script setup>\n${code}\n</script>\n`;
const csharp = (statement) => `class S\n{\n    void M()\n    {\n        ${statement}\n    }\n}\n`;
const catchAt = (code, line, nth) => {
  const text = code.split('\n')[line - 1];
  const columns = [...text.matchAll(/catch/g)].map((match) => match.index);
  return [line, columns.at(nth)];
};

test('a try with no catch neither claims an annotation nor ends another catch\'s window (C4)', () => {
  const above = `// chemx-allow: ${REASON}\ntry { a(); } finally {} try { b(); } catch {}\n`;
  assert.deepEqual(catchColumns(above), []);
  assert.deepEqual(catchColumns(vueSetup(above), 'src/C.vue'), []);
  const csharpAbove = `class S\n{\n    void M()\n    {\n        // chemx-allow: ${REASON}\n        try { A(); } finally { } try { B(); } catch { }\n    }\n}\n`;
  assert.deepEqual(catchColumns(csharpAbove, 'src/Svc.cs'), []);
  assert.deepEqual(catchColumns(`try { a(); } catch {} try { b(); } finally {} // chemx-allow: ${REASON}\n`), []);
  assert.deepEqual(catchColumns(csharp(`try { A(); } catch { } try { B(); } finally { } // chemx-allow: ${REASON}`), 'src/Svc.cs'), []);
  const between = `try { a(); } catch {} try { b(); } finally {} /* chemx-allow: ${REASON} */ try { c(); } catch {}\n`;
  assert.deepEqual(catchColumns(between), [catchAt(between, 1, -1)]);
  const csharpBetween = csharp(`try { A(); } catch { } try { B(); } finally { } /* chemx-allow: ${REASON} */ try { C(); } catch { }`);
  assert.deepEqual(catchColumns(csharpBetween, 'src/Svc.cs'), [catchAt(csharpBetween, 5, -1)]);
  for (const [file, code] of [
    ['src/x.ts', `try { try { a(); } catch {} } finally {} /* chemx-allow: ${REASON} */ try { b(); } catch {}\n`],
    ['src/x.ts', `try { a(); } finally { try { b(); } catch {} } /* chemx-allow: ${REASON} */ try { c(); } catch {}\n`],
    ['src/Svc.cs', csharp(`try { try { A(); } catch { } } finally { } /* chemx-allow: ${REASON} */ try { B(); } catch { }`)],
    ['src/Svc.cs', csharp(`try { A(); } finally { try { B(); } catch { } } /* chemx-allow: ${REASON} */ try { C(); } catch { }`)]
  ]) {
    const line = file === 'src/x.ts' ? 1 : 5;
    assert.deepEqual(catchColumns(code, file), [catchAt(code, line, -1)], code);
  }
});

// One annotation exempts one catch: a comment after the whole statement is the statement's own
// catch's, as with `try { a(); } catch {} finally { done(); } // ...`, so the catch of the try
// nested in its finally is the one finding, like the inner catch of a try nested in a try block.
test('a try nested in an earlier statement leaves that statement\'s catch the annotation after it (C4)', () => {
  const annotation = `// chemx-allow: ${REASON}`;
  const nested = `try { a(); } catch {} finally { try { b(); } catch {} } ${annotation}\n`;
  assert.deepEqual(catchColumns(nested), [catchAt(nested, 1, -1)]);
  assert.deepEqual(catchColumns(vueSetup(nested), 'src/C.vue'), [catchAt(vueSetup(nested), 5, -1)]);
  const callback = `try { a(); } catch {} finally { run(() => { try { b(); } catch {} }); } ${annotation}\n`;
  assert.deepEqual(catchColumns(callback), [catchAt(callback, 1, -1)]);
  const csharpNested = csharp(`try { A(); } catch { } finally { try { B(); } catch { } } ${annotation}`);
  assert.deepEqual(catchColumns(csharpNested, 'src/Svc.cs'), [catchAt(csharpNested, 5, -1)]);
  const csharpClause = csharp(`try { A(); } catch (E1) { } catch (E2) { try { B(); } catch { } } ${annotation}`);
  assert.deepEqual(catchColumns(csharpClause, 'src/Svc.cs'), [catchAt(csharpClause, 5, -1)]);
  const laterTry = `try { a(); } catch {} finally { try { b(); } catch {} } try { c(); } catch {} ${annotation}\n`;
  assert.deepEqual(catchColumns(laterTry), [catchAt(laterTry, 1, 0), catchAt(laterTry, 1, 1)]);
  const afterStatement = `try { a(); } catch {} finally { try { b(); } catch {} } /* chemx-allow: ${REASON} */ try { c(); } catch {}\n`;
  assert.deepEqual(catchColumns(afterStatement), [catchAt(afterStatement, 1, 1), catchAt(afterStatement, 1, 2)]);
  const inFinally = `try { a(); } catch {} finally { try { b(); } catch {} /* chemx-allow: ${REASON} */ }\n`;
  assert.deepEqual(catchColumns(inFinally), [catchAt(inFinally, 1, 0)]);
  const csharpInFinally = csharp(`try { A(); } catch { } finally { try { B(); } catch { } /* chemx-allow: ${REASON} */ }`);
  assert.deepEqual(catchColumns(csharpInFinally, 'src/Svc.cs'), [catchAt(csharpInFinally, 5, 0)]);
  const beforeFinally = `try { a(); } catch {} /* chemx-allow: ${REASON} */ finally { try { b(); } catch {} }\n`;
  assert.deepEqual(catchColumns(beforeFinally), [catchAt(beforeFinally, 1, -1)]);
});

// The generic line scanner reads `"//"` or `"/*"` in a hole's string as a comment opener, so
// where tries share a C# line the annotation's comment comes from the C# masker instead.
test('where C# tries share a line, the masker places the annotation, not the line scanner (C4)', () => {
  const hole = 'var s = $"{(c ? "//" : "/*")}";';
  const leading = csharp(`${hole} /* chemx-allow: ${REASON} */ try { A(); } catch { } try { B(); } catch { }`);
  assert.deepEqual(catchColumns(leading, 'src/Svc.cs'), [catchAt(leading, 5, -1)]);
  const trailing = csharp(`${hole} try { A(); } catch { } try { B(); } catch { } // chemx-allow: ${REASON}`);
  assert.deepEqual(catchColumns(trailing, 'src/Svc.cs'), [catchAt(trailing, 5, 0)]);
  const plain = csharp(`var s = 1; try { A(); } catch { } try { B(); } catch { } // chemx-allow: ${REASON}`);
  assert.deepEqual(catchColumns(plain, 'src/Svc.cs'), [catchAt(plain, 5, 0)]);
});
