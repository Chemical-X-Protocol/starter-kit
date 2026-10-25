// The one line `chemx lint` shows when the lint command itself failed (no diagnostics to parse).
// ESLint opens every fatal with "Oops! Something went wrong! :(" and its version; neither says what
// went wrong, so both are dropped and the first line that does is shown (K12, #6757).
import path from 'node:path';
import { stripAnsi } from './terminal.js';

const BANNER = /^Oops! Something went wrong/i;
const VERSION_LINE = /^ESLint:\s*v?(\d+)\.(\d+)\.(\d+)/i;
const LOOKS_LIKE_THE_ERROR = /error|not found|failed|couldn't|cannot|no such/i;
const LONG_LINE = 80;
const MAX_LINE = 200;
const FLAT_CONFIG_MIN_MAJOR = 9;

const cutLine = (line) => {
  const isLong = line.length > LONG_LINE;
  const firstSentence = isLong ? /^(.+?\.)\s/.exec(line)?.[1] : null;
  return (firstSentence ?? line).slice(0, MAX_LINE);
};

/**
 * options.flatConfig: the eslint.config.* file the project has; ESLint 6 to 8 cannot read it, and its
 * "no config file" message would send the reader looking for a missing file that exists.
 * options.exitCode: shown when the output holds nothing but the banner.
 */
export const lintFailureLine = (stdout = '', stderr = '', { flatConfig = null, exitCode = null } = {}) => {
  const lines = `${stderr}\n${stdout}`.split(/\r?\n/).map((raw) => stripAnsi(raw).trim()).filter(Boolean);
  const versionMatch = lines.map((line) => VERSION_LINE.exec(line)).find(Boolean);
  const major = versionMatch ? Number(versionMatch[1]) : null;
  const isTooOldForFlat = Boolean(flatConfig) && major !== null && major < FLAT_CONFIG_MIN_MAJOR;
  if (isTooOldForFlat) {
    return `${path.basename(flatConfig)} needs ESLint ${FLAT_CONFIG_MIN_MAJOR} or newer, but npx resolved ESLint ${versionMatch.slice(1, 4).join('.')} (install eslint@${FLAT_CONFIG_MIN_MAJOR} in this project)`;
  }
  const meaningful = lines.filter((line) => !BANNER.test(line) && !VERSION_LINE.test(line));
  const picked = meaningful.find((line) => LOOKS_LIKE_THE_ERROR.test(line)) ?? meaningful[0];
  return picked ? cutLine(picked) : `Command exited with code ${exitCode}`;
};
