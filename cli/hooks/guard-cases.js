// Guard decision cases: [command, expected]. Ported from docs/superpowers/reviews/2026-10-08-guard-cases.mjs
// and extended with the misfires logged as tasks #1673 and #1718 and in the planner's transcript review.
// Consumed by claude-pre-tool.spec.js.

export const PORTED_CASES = [
  ['pnpm vitest run x', 'deny'], ['npx vue-tsc --noEmit', 'deny'], ['eslint src', 'deny'], ['pnpm build', 'deny'],
  ['grep -rn foo src', 'allow'], ['rg foo', 'allow'], ['git diff', 'deny'], ['git diff --quiet', 'allow'],
  ['git log -3', 'deny'], ['cat src/routes/router.ts', 'deny'], ["cat > /tmp/x.mjs <<'EOF'", 'allow'],
  ['cat <<EOF > /tmp/out.js', 'allow'], ["pgrep -af 'cli/index.js mcp'", 'allow'], ['tail -5 build.log', 'allow'],
  ['sed -n 1,5p src/app.vue', 'deny'], ['chemx test', 'allow'], ['git status', 'allow'],
  ['pnpm vitest run # chemx-bypass: kitchen config', 'allow'],
  ['node probe.mjs src/a.js | tail -8', 'allow'], ['wc -l src/a.js src/b.ts | sort | head', 'allow'],
  ['grep -n foo src/a.js | head', 'allow'], ['cat src/a.ts | wc -l', 'deny'],
  ["printf '%s\\n' \"- chemx test picked vitest; git log too\" >> /tmp/notes.md", 'allow'],
  ['git commit -m "run vitest and git diff later"', 'allow'],
  ["cat >> /tmp/notes.md <<'EOF'\nuse pnpm vitest run and git log here\nEOF", 'allow'],
  ["node a.mjs <<'EOF'\nprose\nEOF\npnpm vitest run", 'deny'],
];

// #1673: chemx's own suggested forms and runner names outside command position.
export const CHEMX_OWNED_CASES = [
  ['node /kit/cli/index.js build --json -- npm run build', 'allow'],
  ['chemx build -- vite build', 'allow'],
  ['npx --yes chemx@26.10.8 audit --min-grade=B', 'allow'],
  ['pnpm chemx test', 'allow'],
  ['CHEMX_PROJECT_ROOT=/repo node cli/index.js test --json', 'allow'],
  ['readlink $R/vitest $R/happy-dom', 'allow'],
  ['for p in vitest happy-dom eslint; do readlink "node_modules/$p"; done', 'allow'],
  ['ls node_modules/.bin | grep -c vitest', 'allow'],
  ['echo "pnpm vitest run"', 'allow'],
];

// #1718: read-only shell on data, temp files and paths outside the repo.
export const NON_SOURCE_READ_CASES = [
  ['cat /tmp/claude-1000/chemx-review/repro-team.mjs', 'allow'],
  ['for f in $(git diff --cached --name-only); do wc -l "$f"; done', 'allow'],
  ['head -c 400 .chemx/last-audit.json', 'allow'],
  ['head -c 200 package.json', 'allow'],
  ['tail -n 20 /var/log/syslog', 'allow'],
  ['cat node_modules/vitest/package.json', 'allow'],
  ['cat src/a.ts > /tmp/copy.ts', 'allow'],
  ["printf '' > empty.txt && cat empty.txt", 'allow'],
];

// Real shell structure: wrappers, subshells, substitutions, nested scripts.
export const STRUCTURE_CASES = [
  ['timeout 120 pnpm vitest run', 'deny'],
  ['timeout -k 5 60 npx tsc --noEmit', 'deny'],
  ['env NODE_ENV=test npx jest', 'deny'],
  ['X=1 Y=2 pnpm test', 'deny'],
  ['(cd apps/x && npm run lint)', 'deny'],
  ['echo "$(git log -3)"', 'deny'],
  ["bash -c 'npm run typecheck'", 'deny'],
  ['git -C apps/x diff --stat', 'deny'],
  ['git diff --name-only HEAD~1', 'allow'],
  ['git log -1 --format=%H', 'allow'],
  ['pnpm install && pnpm --filter x build:youmeos', 'deny'],
  ['npm t', 'deny'],
  ['./node_modules/.bin/vitest run', 'deny'],
  ['node --test cli/hooks/*.spec.js # chemx-bypass: runner-detection-wrong-runner', 'allow'],
  ["git commit -m \"$(cat <<'EOF'\nfix vitest and git log handling\nEOF\n)\"", 'allow'],
  ['head -50 src/app.vue', 'deny'],
  ['cat "$CLAUDE_PROJECT_DIR/src/app.vue"', 'deny'],
  ['less src/a.svelte', 'deny'],
];

// #2490: the effective directory follows cd, pushd and ( ) subshells; an unresolvable target fails open.
export const CD_TRACKING_CASES = [
  ['cd /tmp/rv/repo && printf x > .mcp.json', 'allow'],
  ['cd /tmp/rv/repo; printf x > pkg.json', 'allow'],
  ['cd -P /tmp/rv/repo && printf x > pkg.json', 'allow'],
  ['cd -- /tmp/rv/repo && printf x > pkg.json', 'allow'],
  ['pushd /tmp/rv/repo && printf x > pkg.json', 'allow'],
  ['( cd /tmp/rv/repo && printf x > pkg.json )', 'allow'],
  ['{ cd /tmp/rv/repo; printf x > pkg.json; }', 'allow'],
  ['cd /tmp/rv/repo\nprintf x > pkg.json', 'allow'],
  ['cd /tmp/rv/repo && cat src/a.ts', 'allow'],
  ['echo $(cd /tmp/rv/repo && printf x > pkg.json)', 'allow'],
  ['(cd /tmp/rv/repo); printf x > pkg.json', 'deny'],
  ['cd /tmp/rv/repo && cd /repo && printf x > pkg.json', 'deny'],
  ['cd /tmp/rv/repo | printf x > pkg.json', 'deny'],
  ['printf x > pkg.json; cd /tmp/rv/repo', 'deny'],
  ['cd apps/x && cat src/a.ts', 'deny'],
  ['cd /tmp/rv/repo && cd .. && cd /repo/src && cat a.ts', 'deny'],
  // Unresolvable targets: relative paths after them fail open, absolute repo paths still count.
  ['cd $DIR && printf x > pkg.json', 'allow'],
  ['cd "$(mktemp -d)" && printf x > pkg.json', 'allow'],
  ['cd - && printf x > pkg.json', 'allow'],
  ['false || cd /tmp/rv/repo; printf x > pkg.json', 'allow'],
  ['cd $DIR; cat /repo/src/a.ts', 'deny'],
  ['(cd $DIR); printf x > pkg.json', 'deny'],
];

export const ALL_BASH_CASES = [...PORTED_CASES, ...CHEMX_OWNED_CASES, ...NON_SOURCE_READ_CASES, ...STRUCTURE_CASES, ...CD_TRACKING_CASES];
