import { openIndexDb } from './search-schema.js';
import { ANSI } from './theme.js';

const TICKS = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export const renderSparkline = (values) => {
  if (!Array.isArray(values) || values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values.map((val) => {
    if (span === 0) return TICKS[4];
    const normalized = (val - min) / span;
    const bucket = Math.min(TICKS.length - 1, Math.floor(normalized * TICKS.length));
    return TICKS[bucket];
  }).join('');
};

export const fetchScoreTrends = (db, limit = 10) => {
  if (!db) return [];
  const stmt = db.prepare(`
    SELECT id, timestamp, score, grade, critical_count, high_med_count, low_count, scanned_files
    FROM audit_snapshots
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit);
  return rows.reverse();
};

export const formatTrendReport = (snapshots) => {
  if (!snapshots || snapshots.length === 0) {
    return `${ANSI.DIM}No audit snapshots found in index.db. Run 'chemx audit' to record snapshots.${ANSI.RESET}\n`;
  }
  const scores = snapshots.map((s) => s.score);
  const sparkline = renderSparkline(scores);
  const latest = snapshots[snapshots.length - 1];
  const earliest = snapshots[0];
  const delta = latest.score - earliest.score;
  const deltaPrefix = delta > 0 ? '+' : '';
  const resolveDeltaColor = (d) => {
    if (d > 0) return ANSI.LIME;
    if (d < 0) return ANSI.RED;
    return ANSI.DIM;
  };
  const deltaColor = resolveDeltaColor(delta);

  const header = `${ANSI.BOLD}${ANSI.CYAN}Score Trend (${snapshots.length} snapshots)${ANSI.RESET}\n`;
  const sparkRow = `  Sparkline: [${ANSI.PINK}${sparkline}${ANSI.RESET}]  Latest: ${ANSI.BOLD}${latest.score}${ANSI.RESET} (Grade: ${latest.grade})\n`;
  const deltaRow = `  Drift:     ${deltaColor}${deltaPrefix}${delta} pts${ANSI.RESET} from earliest snapshot (${earliest.score})\n`;

  const details = snapshots.map((s) => {
    const timeStr = new Date(s.timestamp).toLocaleTimeString();
    return `   ${ANSI.DIM}${timeStr}${ANSI.RESET} -> Score: ${s.score.toString().padStart(3)} | Grade: ${s.grade.padEnd(2)} | Hazards: ${s.critical_count} crit, ${s.high_med_count} med`;
  }).join('\n');

  return `${header}${sparkRow}${deltaRow}\n${details}\n`;
};

export const runTrend = (rawArgs = [], cwd = process.cwd()) => {
  const isJson = rawArgs.includes('--json');
  const limitArg = rawArgs.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10;

  const db = openIndexDb(cwd);
  const snapshots = fetchScoreTrends(db, limit);

  if (isJson) {
    const scores = snapshots.map((s) => s.score);
    const payload = {
      count: snapshots.length,
      sparkline: renderSparkline(scores),
      latestScore: snapshots.length ? snapshots[snapshots.length - 1].score : null,
      delta: snapshots.length >= 2 ? snapshots[snapshots.length - 1].score - snapshots[0].score : 0,
      snapshots
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return payload;
  }

  const report = formatTrendReport(snapshots);
  process.stdout.write(report);
  return { snapshots, text: report };
};
