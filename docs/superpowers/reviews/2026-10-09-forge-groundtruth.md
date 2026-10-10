TRUE DUPLICATES (A)

A1 Team flag parsing: inline `--x=` and `--x <next>` blocks, one block per flag - high
- Locations: cli/team/team-flags.js
  - Pairs that accept both forms: :41-46 as, :48-53 to, :55-60 since, :62-67 limit, :75-80 thread, :82-87 task, :89-98 parent, :109-114 agent, :116-121 target, :126-131 rule, :133-138 prio/priority, :143-148 pid, :181-186 needs.
  - Flags that accept only `=`: :69-73, :100-104, :123-124, :140-141, :150-166, :168-195, :197-205.
  - Booleans: :15-28, :35-39 (re-checks :17 and :19 a second time), :106-107.
- Same: an equals-or-next-arg read that assigns to `flags.<key>`.
- Differs, and these become parameters:
  - flag names and aliases (prio/priority :133; per-agent/max-tasks-per-agent :72; desc/description :169)
  - target key
  - coercion: string, parseInt, parseFloat (:163), parseParentFlagValue (:6-12), CSV-of-ints (:173), JSON (:197-205)
  - whether the spaced form is allowed
- Latent bugs that show the copies have drifted:
  - `arg.split('=')[1]` truncates values that contain "=" at :42, :49, :101, :104, :110, :117, :124, :127, :141 and :166. `valueAfterEquals` at :168 does not.
  - `--type`, `--status`, `--tier`, `--purpose` and `--model` silently ignore the spaced form.
- Extraction: a declarative spec table, e.g. `TEAM_FLAG_SPEC = { as: { names: ['--as'], parse: String }, ... }`, fed to the existing `parseCliArgs(rawArgs, schema)` (cli/cli-args.js:30-77) or `parseValueFlags(args, spec)` (cli/mutation-args.js:41-51), with coercion applied afterwards. This is a JS module in cli/team/team-flags.js, not a new hook.

A2 Ad-hoc flag value readers that re-implement `readFlagValue` (cli/mutation-args.js:18-32) - high
- Locations:
  - cli/friction/friction-cli.js:15 and cli/hooks/install-hooks-cli.js:16: identical `flagValue(args,name)` with `.slice(name.length + 3)`.
  - cli/hooks/install-hooks-cli.js:26: hand-written `--host` next-arg fallback.
  - cli/license.js:91-96: `--license` next-arg only.
  - cli/config/index.js:23-30: `--profile`, both forms.
- Differs: flag name, whether the spaced form is accepted, post-processing (trim/lowercase).
- Extraction: call the existing `readFlagValue(args, ['--x'])` from cli/cli-args.js, which re-exports mutation-args.

A3 Resolve the project root via `git rev-parse --show-toplevel` with a cwd fallback - high
- Locations: cli/friction/friction-cli.js:18-23, cli/hooks/install-hooks-cli.js:18-23. Both are explicit flag, else git toplevel, else cwd.
- Differs: install-hooks also rejects empty stdout (:21).
- Extraction: `resolveGitRoot(cwd, explicit?) -> string` in a cli/ JS module (e.g. cli/git-root.js).
- Related, but not the same: cli/test-changes.js:29 needs the error. cli/audit/social-git.js:146 uses safeSpawnSync.

A4 "Is the path inside the root" check (`path.relative` + `..` + `isAbsolute`) - high
- Locations:
  - cli/hooks/guard-paths.js:16-20 `isInsideDirectory`
  - cli/mcp/context.js:21-24 `isInsideDir` (argument order swapped)
  - cli/path-scope.js:39-40, :47-48, :59-60 (three inline copies)
  - cli/edit-locks.js:72 and cli/team/lease-renew.js:34 (inline `isInside`, excludes '')
  - cli/hooks/native-tool-policy.js:99 (excludes '')
  - cli/mcp/installer-report.js:31
  - cli/team/team-dispatch-batches.js:38 and cli/typecheck-command.js:42: these omit the `isAbsolute` check, so they are wrong for paths on another Windows drive.
- Differs: whether the root itself ('') counts as inside, and argument order.
- Extraction: `isPathInside(root, target, { allowSelf = true }) -> boolean` in cli/path-scope.js. One of the two exported copies becomes a re-export.

A5 Show a path relative to a base when it is inside, absolute otherwise - high
- Locations: cli/hooks/native-tool-policy.js:97-101 `displayPath`, cli/mcp/installer-report.js:29-33 `projectPath`, cli/typecheck-command.js:40-44 `toRunnable`, cli/team/team-dispatch-batches.js:33-40 (adds slash normalization).
- Extraction: `relativeIfInside(base, file) -> string`, built on A4, in cli/path-scope.js.

A6 `leaseKeys` copied verbatim - high
- Locations: cli/edit-locks.js:70-74, cli/team/lease-renew.js:32-36.
- Differs only in Set dedupe (edit-locks :73).
- Extraction: export one `leaseKeys(lockRoot, absPath, root)` from cli/team/lease-key.js (that module already exists).

A7 Read a JSON file, return a fallback on any error - high
- Locations:
  - cli/doctor/check-host.js:15-21 (fallback `{}`)
  - cli/hooks/project-status.js:11-17 (fallback `null`)
  - cli/doctor/kit-locate.js:9-16 (`null`)
  - cli/build/detector.js:24-32 (`null`, existsSync first)
  - cli/project-detector.js:4-13 `loadProjectConfig` (`{}`)
  - cli/audit/status-file.js:27-33 (`null`, then a shape check)
  - cli/config/index.js:11-17 (`null`, then a field)
  - cli/sfc/module-aliases.js:41-47 (JSONC variant: strip comments first)
- Differs: path, fallback value, optional post-validator.
- Extraction: `readJsonOr(file, fallback, { parse = JSON.parse } = {})` in a cli/ JS module (e.g. cli/fs-json.js).

A8 Read one field from package.json with a default - high
- Locations:
  - cli/hooks/launcher.js:12-18 (version → 'unknown')
  - cli/mcp/server-info.js:10-16 (version → 'unknown', plus a stderr note)
  - cli/db-project-stamp.js:17-23 (name → '')
  - cli/audit/project-figures.js:6-16 (name → basename(cwd))
- Extraction: `readPackageField(dir, field, fallback)`, built on A7.

A9 ANSI color constants re-declared even though `ANSI` is exported from cli/theme.js:29-42 - high
- Locations: cli/audit/history.js:11-17, cli/team/task-completion-output.js:7-10, cli/navigator-guide.js:5-13, cli/audit/reporter-utils.js:9-21 (exports its own set). Inline `\x1b[32m✔\x1b[0m` literals also appear in about 38 lines, e.g. cli/team/team-commands-vds.js:16/47/58, team-commands-lock.js:88/118, team-commands.js:135,229,256.
- Note: theme.ANSI.YELLOW and RED are RGB values while the local copies use 33/31, so extraction changes the tint.
- Extraction: import `ANSI` from theme.js, plus `ok(text)`, `warn(text)`, `fail(text)` glyph helpers. task-completion-output.js:33-35 already has the shape for these.

A10 `stripAnsi` duplicated - high
- Locations: cli/terminal.js:73-79 (CSI + OSC), cli/verify-helpers.js:36 (CSI only, no `?`, so it misses OSC links).
- Extraction: verify-helpers re-exports terminal.stripAnsi.

A11 `isPlainObject` re-declared - high
- Locations: cli/hooks/mcp-json-merge.js:13, cli/mcp/installer-package.js:11, cli/mcp/installer-write.js:17 (all three identical). Weaker inline copies: cli/mcp/envelope.js:12 and cli/agent-json.js:28; arrays are handled earlier there, so they are not identical.
- Extraction: `isPlainObject(value)` in a shared cli/ JS util.

A12 Agent handle normalization (prefix "@") - high
- Locations:
  - cli/team/team-db-mailbox.js:7-10 `normalizeHandle`
  - cli/team/team-db-task-helpers.js:3-6 `normalizeAgentId` (identical to the line above)
  - cli/team/team-db-feed.js:6-12 `formatHandle(handle, fallback)`
  - cli/team/agent-identity.js:16-20 `toHandle` (trims)
  - inline at cli/team/team-db-agents.js:9, :22, :47 and cli/ui-forum-data.js:89
- Differs: fallback value and trim.
- Extraction: `toHandle(raw, fallback = null)` exported from cli/team/agent-identity.js.

A13 DB row JSON-column hydration - high
- Locations:
  - cli/team/team-db-feed.js:44 and :51 (`parseRow`)
  - cli/team/team-db-mailbox.js:36
  - cli/team/team-db-agents.js:12-16 and :80-84 (capabilities `[]`, metadata `{}`)
  - cli/ui-forum-data.js:22-25 (`parseMeta`) and :92
  - cli/team/team-db-task-helpers.js:10-13 (local `parseJson(val, fallback)`)
- Differs: column names and per-column fallbacks.
- Extraction: `parseJsonColumns(row, { metadata: {}, capabilities: [] })` in cli/team/team-db-task-helpers.js or a new team-db-rows.js. Export `parseFeedRow` and `parseAgentRow` on top of it.

A14 Insert into `agent_feed`, then re-select by `lastInsertRowid` - high
- Locations: cli/team/team-db-feed.js:23-44 (`postFeedEvent`), cli/team/team-db-mailbox.js:19-36 (`sendDirectMessage`). They use the same INSERT column list and the same tail.
- Differs: event_type (param vs the literal 'dm'), file_path (param vs NULL), message default.
- Extraction: `sendDirectMessage` calls a shared `insertFeedRow(db, row)` exported from team-db-feed.js.

A15 Emit JSON or human text from a CLI handler - medium-high
- Locations:
  - `process.stdout.write(\`${JSON.stringify(x,null,2)}\n\`)` appears in 31 lines, including cli/team/team-commands-vds.js:14/46/57/67, team-commands-lock.js:87/117, team-commands.js:85/96/114/134/173/199/228/253/333/343, cmd-project.js:33/43/64/74/98, conflicts-cli.js:45, patcher-cli.js:95.
  - Two local helpers already exist: cli/team/team-commands-lock-views.js:21 `writeJson(res)` and cli/team/team-commands-profile.js:9-11 `writeJson(isCli, value)`. Their signatures differ.
- Same: `if (isCli) { if (isJson) json else human }`.
- Extraction: `emitResult(result, { isCli, isJson, human: (r) => string, stream })` in cli/team/team-format.js or cli/terminal.js.

A16 Spec setup with an in-memory team DB - high
- Locations: `new DatabaseSync(':memory:')` + `initTeamSchema(db)` in about 25 specs, e.g. cli/team/team-db-feed-latest.spec.js:28-32 and cli/team/team-projects-coordinator.spec.js:14-19 (adds initProjectSession). Also team-adversarial-locks.spec.js:23-25, team-vds.spec.js:20-21, team-release-train.spec.js:15-16, team-needs.spec.js:25-30, ui-kanban.spec.js:23-31, ui-vbulletin.spec.js:22-30.
- Extraction: `createTeamTestDb({ seed } = {})` in a shared spec-support JS module (e.g. cli/team/test-db.js; none exists yet).

A17 Spec temp project - medium-high
- Locations:
  - cli/friction-fixes.spec.js:13-17 (prefix + package.json)
  - cli/mcp/tools-project.spec.js:14-18 (t.after cleanup)
  - cli/team/team-db-feed-latest.spec.js:21-26 (.chemx dir + cleanup)
  - cli/team/team-task-add-flags.spec.js:8 and cli/team/team-unknown-task.spec.js:8 (bare, no cleanup)
  - Paired with `delete process.env.CHEMX_PROJECT_ROOT` in 7 specs: hooks/session-identity.spec.js:10, mcp/tools-project.spec.js:11, search-index-meta.spec.js:41, team/team-brief.spec.js:13, team-db-feed-latest.spec.js:19, team-profile.spec.js:17, workspace.spec.js:42.
- Differs: prefix, whether package.json is seeded, whether .chemx/ is created, cleanup.
- Extraction: `makeTempProject(t, { prefix, packageJson, chemxDir })`, which also isolates the env.

A18 Inline MCP text item that bypasses `textItem` from cli/mcp/envelope.js:6 and :62 - medium
- Locations: cli/mcp/tools.js:228 and :233-235 build `{ content: [{ type:'text', text }] }` by hand.
- Extraction: use `textItem` and `toEnvelope`.

A19 `gh discussion create` retried for each fallback category - high (repeats inside one function)
- Locations: cli/audit/social-gh.js:10-14, :24-28, :37-41, :50-54. Each copy has the same success tail at :15-18, :29-32, :42-45 and :55-58.
- Differs: the category value only.
- Extraction: a loop over `[category, SLUG, 'Audits', 'General']` (deduped), plus `runGh(args)`, in the same file.

A20 Swarm composables: GET `/api/swarm/...` and assign fields - high
- Locations: src/ui/composables/useSwarmTasks.ts:9-26, useSwarmFeed.ts:10-28, useSwarmLocks.ts:9-25, useSwarmCodebase.ts:10-29.
- Differs:
  - URL
  - which data fields go into which refs
  - whether `isLoading` is tracked
- Three of them fetch the same `/api/swarm/status` (Tasks :14, Feed :15, Locks :13), and so does useSwarmState.ts:40. v-swarm-locks.vue:9-11 mounts three of these at once.
- Extraction: TS composable `useSwarmEndpoint<T>(url, { onData, poll? })`, or better, one shared status store consumed by all four.

A21 Swarm composables: POST JSON, then refetch - high
- Locations:
  - useSwarmLocks.ts:27-40 and :42-55
  - useSwarmTasks.ts:28-41, :43-56, :58-71
  - useSwarmFeed.ts:39-52
  - useSwarmState.ts:61-74 (same body shape as Feed's sendPost)
  - useSwarmAttention.ts:49-71 (adds ok-check and tuple return)
- Differs: URL, body, which refetch runs.
- Extraction: TS helper `postJson(url, body)` plus `withRefetch(fn, refetch, errorRef)` in src/ui/composables/ (e.g. useSwarmApi.ts).

A22 Visibility-aware poller - high
- Locations: useSwarmAttention.ts:39-47 (3000ms), useSwarmFeed.ts:30-37 (3000ms), useSwarmState.ts:52-59 (2000ms).
- Differs: tick function and delay.
- Extraction: TS composable `useVisiblePoller(fn, delayMs)` wrapping useSelfCleaningTimeout, in src/ui/composables/.

A23 Swarm composables: error normalization - medium
- Locations: `err instanceof Error ? err : new Error(String(err))` at useSwarmTasks.ts:22/39/54/69, useSwarmLocks.ts:23/38/53, useSwarmFeed.ts:23/50, useSwarmCodebase.ts:25, useSwarmState.ts:45/72. A precedent exists in hooks/toResult.ts:10.
- Extraction: `toError(err)` util. This is subsumed by A21.

A24 Vue stat tile: caption label over title value - high
- Locations: src/ui/molecules/m-savings-modal/m-savings-modal.vue:26-29, :30-33, :34-37, :38-41; src/ui/organisms/o-codebase-catalog/o-codebase-catalog.vue:27-30, :31-34, :35-38; src/ui/organisms/o-db-studio/o-db-studio.vue:20-23, :24-27, :28-31, :32-35. That is 11 instances in 3 files.
- Same: `<ACard padding="none"><AText variant="caption" tone="muted" :text=label/><AText variant="title" :tone :text=value/></ACard>`.
- Differs: label, value, value tone, card variant (subtle vs glass) and class.
- Extraction: Vue SFC molecule `m-stat-tile` with props `{ label: string; value: string|number; tone?: TextTone; variant?: 'subtle'|'glass' }` in src/ui/molecules/m-stat-tile/. Callers can loop over a `stats` array from the controller.

A25 Settings action card repeated with literal content - medium-high
- Locations: src/ui/organisms/o-settings-panel/o-settings-panel.vue:32-39, :41-48, :50-57, :59-66, :68+.
- Differs: title, badge label and tone, description, button label and variant, action id.
- Extraction: either a `v-for` over an `ACTIONS` config array in o-settings-panel.controller.ts, or a molecule `m-action-card { title, badge, badgeTone, description, actionLabel, actionVariant } @run`. Prefer the in-file v-for: no other consumer exists.

A26 Lease time remaining - medium
- Locations: src/ui/molecules/m-lock-row/m-lock-row.controller.ts:6-13 ("TTL: 42s" / "Expired" / "Active Lease"); src/ui/molecules/m-lock-chip/m-lock-chip.controller.ts:15-30 ("0m 42s" / "Expired").
- Same: `expiresAt - Date.now()`, clamped and expired-aware.
- Differs: output format and the missing-expiry label.
- Extraction: `remainingSeconds(expiresAt, now)` plus `formatTtl(seconds, style)` exported next to formatShortPath in m-lock-chip.controller.ts or a shared src/ui util.

FALSE POSITIVES (B): the detector must not report these

B1 Three-clause `&&` predicates are unrelated
- cli/agent-json.js:10-11 is a type guard for a diagnostic row (object shape).
- cli/build.js:79 combines output-mode flags (shouldPrint, !json, !silent, !raw; that is 4 clauses).
- cli/cli-args.js:103 validates numeric input for a timeout.
- They share no data, domain or parameters, and a shared "predicate filter" would have no meaningful signature. The suggested target hooks/usePredicateFilter.ts:1 imports `useMemo` from 'react'; the cli/ code is plain Node ESM.

B2 UI trio: three different roles
- m-attention-card.vue:26-29 is a title over a body detail (content).
- m-lock-row.vue:18-21 is a title, then a caption of owner and TTL (row identity plus metadata).
- m-savings-modal.vue:26-29 is a caption label over a title value (a metric). The order is reversed, and only this one belongs to A24.
- The tag shape `ACard>(AText+AText)` matches any two texts. Clustering must look at variant order, the label-vs-value role and sibling repetition.

B3 Blueprint templates mirrored per framework
- blueprints/molecule-capsule/m-sample-card.vue:40-60, .tsx:45-65 and .svelte (also atoms/a-button.{vue,tsx,svelte} and view-template.{vue,tsx,svelte}).
- These are deliberately parallel generator outputs, one per target framework. They cannot share code across languages.

B4 Same name, different framework
- hooks/useSelfCleaningTimer.ts:18-31 is a React useEffect/useRef hook.
- src/ui/composables/useSelfCleaningTimeout.ts:3-38 is Vue with start/stop/onScopeDispose.
- They have the same name and intent but incompatible runtimes and APIs.

B5 Timestamp formatting with different outputs
- m-attention-card.controller.ts:16-21 shows wall-clock HH:MM.
- m-feed-post.controller.ts:20-29 shows relative "5m ago".

B6 Thin views composed by design
- src/ui/views/v-swarm-locks.vue:14-18 and v-swarm-tasks.vue:14-18 both use TSocialLayout with default and right slots.
- This is the mandated table-of-contents view pattern; their content differs.

B7 Controllers that return computeds and handlers ("Parallel State Controller Return")
- e.g. m-lock-row.controller.ts:19-23 {hasAgent, expiresAtText, handleRelease}, m-attention-card.controller.ts:31-36, m-token-stat.controller.ts:27-32.
- Every capsule controller has this shape by convention. Matching return shapes is not duplication.

B8 JSON readers whose error contracts differ from A7's
- cli/audit/ratchet.js:37-48 returns a tri-state {status, message}.
- cli/doctor/check-mcp.js:14-21 maps ENOENT to a message.
- cli/workspace.js:10-16 returns a [value, error] tuple.
- cli/commands/cmd-wrappers-json.js:13-16 throws and also returns raw.
- They must not be folded into `readJsonOr`, because callers rely on the error detail.

B9 Truncation from different ends
- cli/navigator-banner-helpers.js:14-18 keeps the tail ("…" prefix, for paths).
- cli/team/task-list-view.js:10-14 and cli/errors/formatter.js:7 keep the head ("..." suffix).

B10 m-token-stat vs the A24 stat tile
- src/ui/molecules/m-token-stat/m-token-stat.vue:22-53 is a chip/badge card with a compact-number formatter and a cost badge (header, default and footer slots).
- It is not the caption/value tile and should not absorb A24.

B11 Same 3-clause `&&` count as A4, different meaning
- cli/terminal.js:29 `isInteractive` (TTY checks and !CI) vs cli/edit-locks.js:72 `isInside`.
- This contrast case shows that clause count is not a signal.

BORDERLINE (C)

C1 Deep ANSI stripping walk: lean against
- cli/mcp/envelope.js:8-15 `stripDeep` vs cli/agent-json.js:23-35 `compactValue`.
- They recurse the same way, but compactValue also reformats diagnostic lists and drops nulls.
- At most, `mapDeep(value, leafFn)` could be shared. With only 2 sites and different policies, extracting it is not clearly clearer.

C2 useSelfCleaningInterval vs useSelfCleaningTimeout: lean no
- hooks/useSelfCleaningTimer.ts:3-16 vs :18-31 differ only in setInterval vs setTimeout.
- A `useSelfCleaningTimer(kind)` is possible, but two 14-line siblings in one file read fine as they are.

C3 Splitting off the command after `--`: lean no
- cli/verify-helpers.js:12-17 vs cli/mcp/call-args.js:40-46 vs cli/cli-args.js:37-42.
- They share the indexOf('--') split, but outputs differ (a joined shell string vs git words vs a schema result).
- Only verify-helpers could reuse parseCliArgs, by passing a schema with no flags.

C4 `normalizeHandle` with trim vs without
- Trim in agent-identity.js:17 vs none in team-db-mailbox.js:9.
- I put this in A12 because the difference is an option. Keeping both would let "@ x" and "@x" differ between modules, which is likely a bug rather than a design choice.

C5 useSwarmAttention fetch (src/ui/composables/useSwarmAttention.ts:12-37)
- It returns `[data, err]` tuples and sets errorMessage, while the others set an `error` ref.
- It fits A20 only if the shared composable supports both result styles. Include it as a weak member.

C6 isPlainObject variants that do not exclude arrays (envelope.js:12, agent-json.js:28)
- They are safe only because arrays are handled earlier.
- Folding them into the A11 helper is fine and slightly stricter. Low risk, low value.

C7 The `isCli && isJson` branches in team-commands.js:85-99
- These fit A15. The human renderer is always a separate format*Card function, so `emitResult(res, flags, formatX)` would read naturally there.
- Inline multi-branch human text such as team-commands-lock.js:88-90 would need a function argument. That is still fine, but the call site is less clean.

Healed and re-anchored items (#4486, 2026-10-09)
- The scorer re-finds anchors by content, so code that was fixed after labeling goes stale. Rules: an item with fewer than 2 live anchors is "healed" and leaves the recall denominator (A6: leaseKeys now exists once, in cli/team/lease-roots.js). It stays in labels.json.
- Re-anchored: A4.6 and B11.2 (the isInside check, same hash) now point at cli/team/lease-roots.js:28. Fixtures keep their original provenance header; gt-build.js was not rerun because it reads by recorded line numbers, which have drifted.
- Retired (text absent, `retired: {commit, reason}` in labels.json): A4.7, A6.1, A6.2 (fd61ca6, f779598); A7.1, A7.2, A7.3, A7.5 (97b7be0, readJsonOr); A15.7-A15.16 and C7.1 (a00d12e). Commits are the last to change the text's occurrence count in that file.
- A16 and A17 are spec items and score only with `--include-tests`: both credited, spec scope 2/2; A recall 19/25 = 76% overall (code 17/23).