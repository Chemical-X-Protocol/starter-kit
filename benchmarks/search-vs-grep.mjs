#!/usr/bin/env node
// Head-to-head: chemx lookups vs the grep commands an agent would otherwise run.
// Measures what the agent actually receives: stdout bytes of each command, wall time (median of 3,
// warm index), and hit-set agreement for the search tasks (recall and precision against grep).
//
// Usage: node benchmarks/search-vs-grep.mjs --root <repo> --symbol <name> --text <literal> --file <path>
// Prints a markdown report to stdout. It writes no files.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const root = path.resolve(args.get('root') || process.cwd());
const symbol = args.get('symbol');
const text = args.get('text');
const file = args.get('file');
if (!symbol || !text || !file) {
  process.stderr.write('usage: --root <repo> --symbol <name> --text <literal> --file <path>\n');
  process.exit(2);
}

const GREP_EXCLUDES = ['--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=.chemx', '--exclude-dir=dist'];
const CHEMX = process.env.CHEMX_BIN || 'chemx';

const run = (cmd, cmdArgs) => {
  const started = process.hrtime.bigint();
  const res = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 256 * 1024 * 1024 });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { stdout: res.stdout || '', stderr: res.stderr || '', ms, status: res.status };
};

const medianWarm = (cmd, cmdArgs) => {
  run(cmd, cmdArgs); // warm-up: index sync and page cache
  const samples = [0, 1, 2].map(() => run(cmd, cmdArgs).ms).sort((a, b) => a - b);
  return samples[1];
};

// Keep only "path:line" from record output so the two sides can be compared as hit sets.
const hitSet = (stdout) => {
  const hits = new Set();
  for (const line of stdout.split('\n')) {
    const match = line.match(/^(?:\.\/)?([^:]+):(\d+):/);
    if (match) hits.add(`${match[1]}:${match[2]}`);
  }
  return hits;
};

const compareSets = (grepSet, chemxSet) => {
  const shared = [...grepSet].filter((hit) => chemxSet.has(hit)).length;
  const recall = grepSet.size ? shared / grepSet.size : 1;
  const precision = chemxSet.size ? shared / chemxSet.size : 1;
  return { recall: (recall * 100).toFixed(1), precision: (precision * 100).toFixed(1) };
};

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const rows = [];

// 1. Find every use of a name.
{
  const grep = run('grep', ['-rnw', ...GREP_EXCLUDES, '--', symbol, '.']);
  const chemx = run(CHEMX, ['q', symbol, '--uses', '--limit', '1000']);
  const grepHits = hitSet(grep.stdout);
  const chemxHits = hitSet(chemx.stdout);
  rows.push({
    task: `uses of \`${symbol}\``,
    grepBytes: bytes(grep.stdout), chemxBytes: bytes(chemx.stdout),
    grepMs: medianWarm('grep', ['-rnw', ...GREP_EXCLUDES, '--', symbol, '.']),
    chemxMs: medianWarm(CHEMX, ['q', symbol, '--uses', '--limit', '1000']),
    ...compareSets(grepHits, chemxHits),
    notes: `grep ${grepHits.size} hits, chemx ${chemxHits.size} hits`
  });
}

// 2. Literal text search.
{
  const grep = run('grep', ['-rnF', ...GREP_EXCLUDES, '--', text, '.']);
  const chemx = run(CHEMX, ['q', '-g', text, '--bare', '--limit', '1000']);
  const grepHits = hitSet(grep.stdout);
  const chemxHits = hitSet(chemx.stdout);
  rows.push({
    task: `literal \`${text}\``,
    grepBytes: bytes(grep.stdout), chemxBytes: bytes(chemx.stdout),
    grepMs: medianWarm('grep', ['-rnF', ...GREP_EXCLUDES, '--', text, '.']),
    chemxMs: medianWarm(CHEMX, ['q', '-g', text, '--bare', '--limit', '1000']),
    ...compareSets(grepHits, chemxHits),
    notes: `grep ${grepHits.size} hits, chemx ${chemxHits.size} hits`
  });
}

// 3. File structure (informational: the two outputs answer the same question differently sized).
{
  const grep = run('grep', ['-n', '^export', '--', file]);
  const chemx = run(CHEMX, ['read', file, '--outline']);
  rows.push({
    task: `outline of \`${file}\``,
    grepBytes: bytes(grep.stdout), chemxBytes: bytes(chemx.stdout),
    grepMs: medianWarm('grep', ['-n', '^export', '--', file]),
    chemxMs: medianWarm(CHEMX, ['read', file, '--outline']),
    recall: 'n/a', precision: 'n/a',
    notes: 'grep lists exports only; chemx outlines every declaration'
  });
}

const fmtMs = (ms) => `${ms.toFixed(0)} ms`;
const out = [];
out.push(`# chemx vs grep (${root})`, '');
out.push('| Task | grep bytes | chemx bytes | grep time | chemx time | recall | precision | notes |');
out.push('| :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |');
const pct = (value) => (value === 'n/a' ? 'n/a' : `${value}%`);
for (const r of rows) {
  out.push(`| ${r.task} | ${r.grepBytes} | ${r.chemxBytes} | ${fmtMs(r.grepMs)} | ${fmtMs(r.chemxMs)} | ${pct(r.recall)} | ${pct(r.precision)} | ${r.notes} |`);
}
out.push('', 'Recall: share of grep hits that chemx also returns. Precision: share of chemx hits that grep also returns.');
out.push('Bytes are stdout only; stderr summaries are excluded. Times are the median of 3 warm runs.');
process.stdout.write(out.join('\n') + '\n');
