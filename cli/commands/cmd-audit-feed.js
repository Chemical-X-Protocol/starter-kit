// `chemx audit --feed[=history|pillars|scopes]`: prints audit feed rows from .chemx history and
// status. Read-only: it never runs an audit. --json prints every matching row as a bare array
// (dashboard-ready); the plain table shows the newest rows and says how many it left out.
import { readAuditFeed, FEED_VIEWS } from '../audit/feed.js';

const TABLE_ROW_CAP = 20;

const flagValue = (args, name) => {
  const prefix = `--${name}=`;
  const hit = args.find((arg) => arg.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
};

const toLimit = (raw) => {
  const parsed = Number(raw);
  const isPositiveInteger = Number.isInteger(parsed) && parsed > 0;
  return isPositiveInteger ? parsed : null;
};

export const parseFeedArgs = (args) => ({
  view: flagValue(args, 'feed') || 'history',
  scope: flagValue(args, 'scope'),
  since: flagValue(args, 'since'),
  fullOnly: args.includes('--full-only'),
  isJson: args.includes('--json'),
  limit: toLimit(flagValue(args, 'limit'))
});

const day = (iso) => (typeof iso === 'string' ? iso.slice(0, 16).replace('T', ' ') : '');
const show = (value) => (value === null || value === undefined ? '-' : String(value));
const gateWord = (isPassing) => {
  const isPass = isPassing === true;
  const isFail = isPassing === false;
  if (isPass) return 'pass';
  if (isFail) return 'fail';
  return '-';
};

const TABLE_COLUMNS = {
  history: [['time', (r) => day(r.timestamp)], ['scope', (r) => show(r.scope)], ['partial', (r) => (r.isPartial ? 'yes' : '')], ['score', (r) => show(r.healthScore)], ['grade', (r) => show(r.grade)], ['files', (r) => show(r.files)], ['violations', (r) => show(r.violations)], ['critical', (r) => show(r.critical)]],
  pillars: [['time', (r) => day(r.timestamp)], ['scope', (r) => show(r.scope)], ['pillar', (r) => r.pillar], ['status', (r) => show(r.status)], ['violations', (r) => show(r.violations)], ['critical', (r) => show(r.critical)]],
  scopes: [['scope', (r) => r.scope], ['runs', (r) => show(r.runs)], ['score', (r) => show(r.healthScore)], ['grade', (r) => show(r.grade)], ['gate', (r) => gateWord(r.gatePassing)], ['violations', (r) => show(r.violations)], ['critical', (r) => show(r.critical)], ['last full run', (r) => day(r.lastFullRunAt)]]
};

export const formatFeedTable = (rows, view, cap = TABLE_ROW_CAP) => {
  const hasRows = rows.length > 0;
  if (!hasRows) return 'No audit runs recorded yet. Run `chemx audit` first.\n';
  const shown = rows.slice(-cap);
  const columns = TABLE_COLUMNS[view];
  const cells = shown.map((row) => columns.map(([, read]) => read(row)));
  const widths = columns.map(([title], i) => Math.max(title.length, ...cells.map((line) => line[i].length)));
  const render = (line) => line.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  const lines = [render(columns.map(([title]) => title)), ...cells.map(render)];
  const omitted = rows.length - shown.length;
  const hasOmitted = omitted > 0;
  if (hasOmitted) lines.push(`${omitted} older rows not shown; use --limit=<n> or --json for all.`);
  return `${lines.join('\n')}\n`;
};

const defaultIo = {
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text)
};

export const runAuditFeedCommand = (args, { cwd = process.cwd(), ...io } = {}) => {
  const { write, writeError } = { ...defaultIo, ...io };
  const options = parseFeedArgs(args);
  const isKnownView = FEED_VIEWS.includes(options.view);
  if (!isKnownView) {
    writeError(`Unknown audit feed view "${options.view}". Use one of: ${FEED_VIEWS.join(', ')}.\n`);
    return { code: 2 };
  }
  const rows = readAuditFeed(options.view, { cwd, scope: options.scope, since: options.since, fullOnly: options.fullOnly });
  const limited = options.limit ? rows.slice(-options.limit) : rows;
  const output = options.isJson ? `${JSON.stringify(limited)}\n` : formatFeedTable(limited, options.view);
  write(output);
  return { code: 0 };
};
