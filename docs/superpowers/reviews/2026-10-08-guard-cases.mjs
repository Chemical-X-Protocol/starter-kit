// Pipe-test cases for .claude/hooks/chemx-guard.mjs: [command, expected decision]
import { spawnSync } from 'node:child_process';

const GUARD = '/home/xopher/www/x/Xophz-COMPASS/.claude/hooks/chemx-guard.mjs';
const CASES = [
  ['pnpm vitest run x', 'deny'], ['npx vue-tsc --noEmit', 'deny'], ['eslint src', 'deny'], ['pnpm build', 'deny'],
  ['grep -rn foo src', 'allow'], ['rg foo', 'allow'], ['git diff', 'deny'], ['git diff --quiet', 'allow'],
  ['git log -3', 'deny'], ['cat src/routes/router.ts', 'deny'], ["cat > /tmp/x.mjs <<'EOF'", 'allow'],
  ['cat <<EOF > out.js', 'allow'], ["pgrep -af 'cli/index.js mcp'", 'allow'], ['tail -5 build.log', 'allow'],
  ['sed -n 1,5p src/app.vue', 'deny'], ['chemx test', 'allow'], ['git status', 'allow'],
  ['pnpm vitest run # chemx-bypass: kitchen config', 'allow'],
  ['node probe.mjs src/a.js | tail -8', 'allow'], ['wc -l src/a.js src/b.ts | sort | head', 'allow'],
  ['grep -n foo src/a.js | head', 'allow'], ['cat src/a.ts | wc -l', 'deny'],
  ["printf '%s\\n' \"- chemx test picked vitest; git log too\" >> notes.md", 'allow'],
  ['git commit -m "run vitest and git diff later"', 'allow'],
  ["cat >> notes.md <<'EOF'\nuse pnpm vitest run and git log here\nEOF", 'allow'],
  ["node a.mjs <<'EOF'\nprose\nEOF\npnpm vitest run", 'deny'],
];
const decide = (input, env = {}) => {
  const r = spawnSync('node', [GUARD], { input: JSON.stringify(input), env: { ...process.env, ...env }, encoding: 'utf-8' });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
};
let failures = 0;
for (const [command, expected] of CASES) {
  const got = decide({ tool_name: 'Bash', tool_input: { command } });
  if (got !== expected) failures++;
  console.log(`${got === expected ? 'ok  ' : 'FAIL'} ${got.padEnd(5)} ${command}`);
}
const grepTool = decide({ tool_name: 'Grep', tool_input: { pattern: 'x' } });
const enforced = decide({ tool_name: 'Bash', tool_input: { command: 'grep -rn x src' } }, { CHEMX_GUARD_SEARCH: '1' });
console.log(`${grepTool === 'allow' ? 'ok  ' : 'FAIL'} ${grepTool.padEnd(5)} Grep tool (search not enforced yet)`);
console.log(`${enforced === 'deny' ? 'ok  ' : 'FAIL'} ${enforced.padEnd(5)} grep -rn with CHEMX_GUARD_SEARCH=1`);
process.exit(failures + (grepTool !== 'allow') + (enforced !== 'deny'));
