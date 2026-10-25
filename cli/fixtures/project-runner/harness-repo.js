// A throwaway copy of the WordPress plugin layout that tests/run-tests.mjs repos use (task #6754):
//   <tmp>/plugins/xophz-compass/tests/harness/test-framework.mjs   the shared zero-dependency harness
//   <tmp>/plugins/my-plugin/                                       the repo: .git, tests/run-tests.mjs, tests/*.test.mjs
// The harness is a small copy of the real one (describe/it/harness.run), enough to run and fail
// real tests through the real runner shape.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HARNESS = `import assert from 'node:assert';
class TestHarness {
  constructor() { this.suites = []; this.current = null; }
  describe(name, fn) {
    const suite = { name, tests: [] };
    this.suites.push(suite);
    const previous = this.current;
    this.current = suite;
    fn();
    this.current = previous;
  }
  it(name, fn) { this.current.tests.push({ name, fn }); }
  async run() {
    const results = { passed: 0, failed: 0, failures: [] };
    for (const suite of this.suites) {
      for (const test of suite.tests) {
        try {
          await test.fn();
          results.passed += 1;
        } catch (error) {
          results.failed += 1;
          results.failures.push({ suiteName: suite.name, testName: test.name, error: String(error.stack || error) });
        }
      }
    }
    return results;
  }
}
export const harness = new TestHarness();
export const describe = harness.describe.bind(harness);
export const it = harness.it.bind(harness);
export { assert };
`;

export const RUNNER = `/**
 * Fixture Submodule Test Runner
 */

import { harness } from '../../xophz-compass/tests/harness/test-framework.mjs';
import './alpha.test.mjs';
import './beta.test.mjs';
import './sub/gamma.test.mjs';

const results = await harness.run();
if (results.failed > 0) {
  for (const f of results.failures) {
    console.error(\`FAIL \${f.suiteName} > \${f.testName}\\n\${f.error.split('\\n').slice(0, 3).join('\\n')}\`);
  }
  console.error(\`Fixture Tests FAILED: \${results.failed} failed, \${results.passed} passed.\`);
  process.exit(1);
} else {
  console.log(\`Fixture Tests PASSED: \${results.passed} passed.\`);
  process.exit(0);
}
`;

const FRAMEWORK = 'xophz-compass/tests/harness/test-framework.mjs';

// One test file: `count` passing tests, plus one failing test when `failing`. `depth` is how many
// directories below tests/ it sits (the harness import climbs out of the repo).
const suiteOf = (name, count, { failing = false, depth = 0 } = {}) => {
  const up = '../'.repeat(2 + depth);
  const passing = Array.from({ length: count }, (_, index) => `  it('${name} case ${index + 1}', () => { assert.equal(1 + 1, 2); });`);
  const breaking = failing ? [`  it('${name} breaks', () => { assert.equal(1, 2); });`] : [];
  return [`import { describe, it, assert } from '${up}${FRAMEWORK}';`, '', `describe('${name}', () => {`, ...passing, ...breaking, '});', ''].join('\n');
};

const FILES = {
  'tests/run-tests.mjs': RUNNER,
  'tests/alpha.test.mjs': suiteOf('alpha', 2),
  'tests/beta.test.mjs': suiteOf('beta', 3, { failing: true }),
  'tests/sub/gamma.test.mjs': suiteOf('gamma', 1, { depth: 1 })
};

// Builds the tree and runs `body({ plugins, repo, tests })`; the tree goes away after. `extra` adds or
// replaces repo files ({ 'package.json': '{}' }); a null value removes one.
export const withHarnessRepo = async (body, extra = {}) => {
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-harness-'));
  const repo = path.join(plugins, 'my-plugin');
  try {
    fs.mkdirSync(path.join(plugins, 'xophz-compass', 'tests', 'harness'), { recursive: true });
    fs.writeFileSync(path.join(plugins, 'xophz-compass', 'tests', 'harness', 'test-framework.mjs'), HARNESS);
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    for (const [name, content] of Object.entries({ ...FILES, ...extra })) {
      const file = path.join(repo, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const isRemoved = content === null;
      if (isRemoved) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, content);
    }
    return await body({ plugins, repo, tests: path.join(repo, 'tests') });
  } finally {
    fs.rmSync(plugins, { recursive: true, force: true });
  }
};
