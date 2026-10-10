// Failure extraction for test runner output (vitest, jest, node --test TAP/spec).
// Input lines are already ANSI-stripped. Fatal crashes are only looked for on stderr, so a test
// named after one cannot fake it. Each failure keeps the test name, the first
// assertion/error message and the source location, so an agent never needs the raw log.

const MAX_BLOCK_LINES = 40;
const MAX_DETAILS = 6;

const ERROR_LINE = /^(?:expect\(|[A-Z][\w.]*(?:Error|Exception)\b|Error\b|AssertionError\b|expected\b)/;
const LOCATION_LINE = /(\/?(?:[\w.@~+-]+\/)*[\w.@~+-]+\.(?:c|m)?[jt]sx?|[\w./-]+\.vue):(\d+)(?::(\d+))?/;
const NOISE_LINE = /^(?:-{3}|\.{3}|duration_ms:|type:|failureType:|code:|operator:|stack:|ℹ|✔|✓|\d*\|)|ExperimentalWarning|^[⎯─]+(?:\[\d+\/\d+\][⎯─]*)?$|^[-+] (?:Expected|Received)$/;

// Jest also prints `FAIL <file>` per file, so its `●` test headers must win over the vitest mode.
const HEADER_MODES = [
  { name: 'jest', match: (t) => t.match(/^●\s+(.+?)\s*$/) },
  { name: 'vitest', match: (t) => t.match(/^FAIL\s+(.+?)\s*$/) },
  { name: 'tap', match: (t, raw) => raw.match(/^\s*not ok \d+ - (.+?)\s*(?:#.*)?$/) },
  { name: 'marker', match: (t) => t.match(/^(?:✖|×|✗|✕)\s+(.+?)\s*$/) }
];

const pickHeaderMode = (lines) => HEADER_MODES.find((mode) => lines.some((raw) => mode.match(raw.trim(), raw)));

const collectBlocks = (lines, mode) => {
  const blocks = [];
  let current = null;
  for (const raw of lines) {
    const headerMatch = mode.match(raw.trim(), raw);
    if (headerMatch) {
      const isTodo = /#\s*TODO\b/i.test(raw);
      current = { name: headerMatch[1].replace(/\s*#\s*TODO\b.*$/i, '').replace(/\s+\(?\d+(?:\.\d+)?m?s\)?$/, ''), body: [], isTodo };
      blocks.push(current);
      continue;
    }
    const hasRoom = current && current.body.length < MAX_BLOCK_LINES;
    if (hasRoom) current.body.push(raw);
  }
  return blocks;
};

const tapErrorMessage = (body) => {
  const errorIndex = body.findIndex((l) => /^\s*error:/.test(l));
  const hasErrorKey = errorIndex !== -1;
  if (!hasErrorKey) return null;
  const inline = body[errorIndex].replace(/^\s*error:\s*/, '').replace(/^['"]|['"]$/g, '');
  const isBlockScalar = inline === '|-' || inline === '|' || inline === '';
  if (!isBlockScalar) return inline;
  return body.slice(errorIndex + 1).map((l) => l.trim()).find(Boolean) || null;
};

const isSuiteRollup = (body) => body.some((l) => /failureType:\s*'subtestsFailed'/.test(l));

const toFailure = (block, mode) => {
  const trimmed = block.body.map((l) => l.trim()).filter(Boolean);
  const message = (mode.name === 'tap' ? tapErrorMessage(block.body) : null) ||
    trimmed.find((l) => ERROR_LINE.test(l)) || null;
  const locationSource = trimmed.find((l) => /^location:/.test(l)) || trimmed.find((l) => LOCATION_LINE.test(l) && !ERROR_LINE.test(l));
  const locationMatch = locationSource ? locationSource.match(LOCATION_LINE) : null;
  const location = locationMatch ? locationMatch[0] : null;
  const rest = trimmed.filter((l) => l !== message && l !== locationSource && !NOISE_LINE.test(l) && !/^location:|^error:/.test(l));
  const details = [message, location, ...rest].filter(Boolean).slice(0, MAX_DETAILS);
  return { kind: 'assertion', name: block.name, message, location, details };
};

// Failing `todo` tests: the names of todo tests that node reports as not ok. They are not failures.
export const findFailingTodos = (lines) => {
  const mode = pickHeaderMode(lines);
  if (!mode) return [];
  return [...new Set(collectBlocks(lines, mode).filter((b) => b.isTodo).map((b) => b.name))];
};

export const extractAssertionFailures = (lines) => {
  const mode = pickHeaderMode(lines);
  if (!mode) return [];
  // A spec-reporter run lists a failing test twice: a bare line in the tree, then again under
  // "failing tests:" with the error body. Keep the first position but the fullest block.
  const byName = new Map();
  for (const block of collectBlocks(lines, mode)) {
    const isSummaryHeader = /^failing tests:?$/i.test(block.name);
    const isRollup = mode.name === 'tap' && isSuiteRollup(block.body);
    // node --test exits 0 for a failing `todo` test, so it is reported as todo, never as a failure.
    const shouldSkip = isSummaryHeader || isRollup || block.isTodo;
    if (shouldSkip) continue;
    const previous = byName.get(block.name);
    const isFuller = !previous || block.body.length > previous.body.length;
    if (isFuller) byName.set(block.name, block);
  }
  return [...byName.values()].map((block) => toFailure(block, mode));
};

// Vitest prints unhandled errors in their own section; tests can all pass while the run fails.
// A "Startup Error" section means the runner never got as far as collecting tests (broken config).
const SECTION_HEADER = /^⎯+\s*(Uncaught Exception|Unhandled Rejection|Unhandled Error|Startup Error)\s*⎯+$/;

const describeSection = (title, window) => {
  const message = window.find((l) => ERROR_LINE.test(l)) || window.find(Boolean) || title;
  const originLine = window.find((l) => /This error originated in "/.test(l));
  const origin = originLine ? originLine.match(/originated in "([^"]+)"/)[1] : null;
  const locationLine = window.find((l) => l.startsWith('❯') && LOCATION_LINE.test(l));
  const location = locationLine ? locationLine.match(LOCATION_LINE)[0] : null;
  const isStartup = title === 'Startup Error';
  const kind = isStartup ? 'startup-error' : 'unhandled-error';
  const label = isStartup ? 'Startup error' : 'Unhandled error';
  const name = origin ? `${label} (${origin})` : label;
  return { kind, name, message, location, details: [message, location, origin && `originated in ${origin}`].filter(Boolean) };
};

// esbuild (vite/vitest config and transforms) reports `✘ [ERROR] <message>` followed by `file:line:col:`.
const ESBUILD_ERROR = /^✘\s+\[ERROR\]\s+(.+)$/;

const describeEsbuildError = (message, window) => {
  const locationLine = window.find((l) => LOCATION_LINE.test(l));
  const location = locationLine ? locationLine.match(LOCATION_LINE)[0] : null;
  return { kind: 'startup-error', name: 'Build error', message, location, details: [message, location].filter(Boolean) };
};

export const extractUnhandledErrors = (lines) => {
  const trimmed = lines.map((l) => l.trim());
  const errors = [];
  trimmed.forEach((line, index) => {
    const window = trimmed.slice(index + 1, index + MAX_BLOCK_LINES);
    const section = line.match(SECTION_HEADER);
    if (section) errors.push(describeSection(section[1], window));
    const esbuild = line.match(ESBUILD_ERROR);
    if (esbuild) errors.push(describeEsbuildError(esbuild[1], window.slice(0, 4)));
  });
  return errors;
};

const FATAL_LINE = /FATAL ERROR|JavaScript heap out of memory|Process killed by SIG\w+|Segmentation fault|^Killed$/;

export const findFatalLine = (lines) => lines.map((l) => l.trim()).find((l) => FATAL_LINE.test(l)) || null;

const NO_TESTS_LINE = /No test files found|No tests found|Could not find '[^']+'/i;
// No `test` script (or npm's placeholder) means no runner at all. That only reads as "nothing to
// run" for an unscoped run; asking for specific tests and getting no runner is a failure.
const NO_RUNNER_LINE = /no test specified|Missing script:?\s*"?test\b/i;

export const findNoTestsLine = (lines, { scoped = false } = {}) => {
  const patterns = scoped ? [NO_TESTS_LINE] : [NO_TESTS_LINE, NO_RUNNER_LINE];
  return lines.map((l) => l.trim()).find((l) => patterns.some((pattern) => pattern.test(l))) || null;
};

const ERROR_HINT = /error|not found|cannot|failed/i;

// The first line that reads like an error, for a run that died before reporting any test.
export const findFirstErrorLine = (lines) => {
  const meaningful = lines.map((l) => l.trim()).filter((l) => l.length > 0 && !NOISE_LINE.test(l));
  return meaningful.find((l) => ERROR_HINT.test(l)) || meaningful[meaningful.length - 1] || null;
};

export const tailLines = (lines, count = 10) => lines
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !NOISE_LINE.test(l))
  .slice(-count);
