// Failure extraction for test runner output (vitest, jest, node --test TAP/spec).
// Input lines are already ANSI-stripped. Fatal crashes are only looked for on stderr, so a test
// named after one cannot fake it. Each failure keeps the test name, the first
// assertion/error message and the source location, so an agent never needs the raw log.

const MAX_BLOCK_LINES = 40;
const MAX_DETAILS = 6;

const ERROR_LINE = /^(?:expect\(|[A-Z][\w.]*(?:Error|Exception)\b|Error\b|AssertionError\b|expected\b)/;
const LOCATION_LINE = /(\/?(?:[\w.@~+-]+\/)*[\w.@~+-]+\.(?:c|m)?[jt]sx?|[\w./-]+\.vue):(\d+)(?::(\d+))?/;
const NOISE_LINE = /^(?:-{3}|\.{3}|duration_ms:|type:|failureType:|code:|operator:|stack:|ℹ|✔|✓|\d*\|)|ExperimentalWarning|^[⎯─]+$|^[-+] (?:Expected|Received)$/;

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
      current = { name: headerMatch[1].replace(/\s+\d+(?:\.\d+)?m?s$/, ''), body: [] };
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
  if (errorIndex === -1) return null;
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

export const extractAssertionFailures = (lines) => {
  const mode = pickHeaderMode(lines);
  if (!mode) return [];
  const seen = new Set();
  const failures = [];
  for (const block of collectBlocks(lines, mode)) {
    const isDuplicate = seen.has(block.name) || /^failing tests:?$/i.test(block.name);
    const isRollup = mode.name === 'tap' && isSuiteRollup(block.body);
    if (isDuplicate || isRollup) continue;
    seen.add(block.name);
    failures.push(toFailure(block, mode));
  }
  return failures;
};

// Vitest prints unhandled errors in their own section; tests can all pass while the run fails.
export const extractUnhandledErrors = (lines) => {
  const trimmed = lines.map((l) => l.trim());
  const errors = [];
  trimmed.forEach((line, index) => {
    const isSectionHeader = /^⎯+\s*(?:Uncaught Exception|Unhandled Rejection|Unhandled Error)\s*⎯+$/.test(line);
    if (!isSectionHeader) return;
    const window = trimmed.slice(index + 1, index + MAX_BLOCK_LINES);
    const message = window.find((l) => ERROR_LINE.test(l)) || window.find(Boolean) || 'Unhandled error';
    const originLine = window.find((l) => /This error originated in "/.test(l));
    const origin = originLine ? originLine.match(/originated in "([^"]+)"/)[1] : null;
    const locationLine = window.find((l) => l.startsWith('❯') && LOCATION_LINE.test(l));
    const location = locationLine ? locationLine.match(LOCATION_LINE)[0] : null;
    const name = origin ? `Unhandled error (${origin})` : 'Unhandled error';
    errors.push({ kind: 'unhandled-error', name, message, location, details: [message, location, origin && `originated in ${origin}`].filter(Boolean) });
  });
  return errors;
};

const FATAL_LINE = /FATAL ERROR|JavaScript heap out of memory|Process killed by SIG\w+|Segmentation fault|^Killed$/;

export const findFatalLine = (lines) => lines.map((l) => l.trim()).find((l) => FATAL_LINE.test(l)) || null;

const NO_TESTS_LINE = /No test files found|No tests found|Could not find '[^']+'|no test specified|Missing script:?\s*"?test\b/i;

export const findNoTestsLine = (lines) => lines.map((l) => l.trim()).find((l) => NO_TESTS_LINE.test(l)) || null;

export const tailLines = (lines, count = 10) => lines
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !NOISE_LINE.test(l))
  .slice(-count);
