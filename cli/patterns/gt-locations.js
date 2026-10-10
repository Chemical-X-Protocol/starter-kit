// Ground-truth item table for the Forge detector eval. Source: docs/superpowers/reviews/2026-10-09-forge-groundtruth.md.
// Each anchor is a repo location (file + line range at labeling time). `gt-build.js` turns this table into verbatim
// excerpt fixtures (fixtures/gt/<ID>.txt) and labels.json. The scorer matches on excerpt CONTENT, never on these
// line numbers, so labels survive line shifts; the lines are provenance only.
//   class A = true duplicate, B = false positive the detector must not report, C = borderline
//   related = ids whose anchors may overlap this item's without counting as foreign sites
//   subsumedBy = scored as found when that item is found (A23 inside A21)
//   lean = for C items, the labeler's leaning (for, against)
// Healed code (#4486): anchors whose text is gone carry `retired: { commit, reason }` in labels.json (A4.7, A6.*, A7.1-3/5,
// A15.7-16, C7.1); their specs below are labeling-time provenance only. Do not rerun gt-build.js blindly: it reads by these
// recorded lines, which have drifted, and would drop the retired markers.
const at = (file, ...ranges) => ranges.map((range) => `${file}:${range}`);
const many = (pairs) => pairs.flatMap(([file, ...ranges]) => at(file, ...ranges));

const TEAM_FLAG_PAIRS = ['41-46', '48-53', '55-60', '62-67', '75-80', '82-87', '89-98', '109-114', '116-121', '126-131', '133-138', '143-148', '181-186'];
const UI = 'src/ui/molecules';
const SWARM = 'src/ui/composables';

const TRUE_ITEMS = [
  { id: 'A1', title: 'Team flag parsing: inline --x= and --x <next> blocks', confidence: 'high', anchors: at('cli/team/team-flags.js', ...TEAM_FLAG_PAIRS) },
  { id: 'A2', title: 'Ad-hoc flag value readers re-implementing readFlagValue', confidence: 'high', anchors: many([['cli/friction/friction-cli.js', '15'], ['cli/hooks/install-hooks-cli.js', '16', '26'], ['cli/license.js', '91-96'], ['cli/config/index.js', '23-30']]) },
  { id: 'A3', title: 'Resolve project root via git rev-parse with cwd fallback', confidence: 'high', anchors: many([['cli/friction/friction-cli.js', '18-23'], ['cli/hooks/install-hooks-cli.js', '18-23']]) },
  { id: 'A4', title: 'Is the path inside the root check', confidence: 'high', related: ['A5', 'A6', 'B11'], anchors: many([['cli/hooks/guard-paths.js', '16-20'], ['cli/mcp/context.js', '21-24'], ['cli/path-scope.js', '39-40', '47-48', '59-60'], ['cli/team/lease-roots.js', '28'], ['cli/team/lease-renew.js', '34'], ['cli/hooks/native-tool-policy.js', '99'], ['cli/mcp/installer-report.js', '31'], ['cli/team/team-dispatch-batches.js', '38'], ['cli/typecheck-command.js', '42']]) },
  { id: 'A5', title: 'Show a path relative to a base when inside, absolute otherwise', confidence: 'high', related: ['A4'], anchors: many([['cli/hooks/native-tool-policy.js', '97-101'], ['cli/mcp/installer-report.js', '29-33'], ['cli/typecheck-command.js', '40-44'], ['cli/team/team-dispatch-batches.js', '33-40']]) },
  { id: 'A6', title: 'leaseKeys copied verbatim', confidence: 'high', anchors: many([['cli/edit-locks.js', '70-74'], ['cli/team/lease-renew.js', '32-36']]) },
  { id: 'A7', title: 'Read a JSON file, return a fallback on any error', confidence: 'high', related: ['A8'], anchors: many([['cli/doctor/check-host.js', '15-21'], ['cli/hooks/project-status.js', '11-17'], ['cli/doctor/kit-locate.js', '9-16'], ['cli/build/detector.js', '24-32'], ['cli/project-detector.js', '4-13'], ['cli/audit/status-file.js', '27-33'], ['cli/config/index.js', '11-17'], ['cli/sfc/module-aliases.js', '41-47']]) },
  { id: 'A8', title: 'Read one field from package.json with a default', confidence: 'high', related: ['A7'], anchors: many([['cli/hooks/launcher.js', '12-18'], ['cli/mcp/server-info.js', '10-16'], ['cli/db-project-stamp.js', '17-23'], ['cli/audit/project-figures.js', '6-16']]) },
  { id: 'A9', title: 'ANSI color constants re-declared although theme.ANSI exists', confidence: 'high', anchors: many([['cli/audit/history.js', '11-17'], ['cli/team/task-completion-output.js', '7-10'], ['cli/navigator-guide.js', '5-13'], ['cli/audit/reporter-utils.js', '9-21']]) },
  { id: 'A10', title: 'stripAnsi duplicated', confidence: 'high', anchors: many([['cli/terminal.js', '73-79'], ['cli/verify-helpers.js', '36']]) },
  { id: 'A11', title: 'isPlainObject re-declared', confidence: 'high', related: ['C6'], anchors: many([['cli/hooks/mcp-json-merge.js', '13'], ['cli/mcp/installer-package.js', '11'], ['cli/mcp/installer-write.js', '17']]) },
  { id: 'A12', title: 'Agent handle normalization (prefix @)', confidence: 'high', related: ['C4'], anchors: many([['cli/team/team-db-mailbox.js', '7-10'], ['cli/team/team-db-task-helpers.js', '3-6'], ['cli/team/team-db-feed.js', '6-12'], ['cli/team/agent-identity.js', '16-20']]) },
  { id: 'A13', title: 'DB row JSON-column hydration', confidence: 'high', related: ['A14'], anchors: many([['cli/team/team-db-feed.js', '44', '51'], ['cli/team/team-db-mailbox.js', '36'], ['cli/team/team-db-agents.js', '12-16', '80-84'], ['cli/ui-forum-data.js', '22-25', '92'], ['cli/team/team-db-task-helpers.js', '10-13']]) },
  { id: 'A14', title: 'Insert into agent_feed then re-select by lastInsertRowid', confidence: 'high', related: ['A13'], anchors: many([['cli/team/team-db-feed.js', '23-44'], ['cli/team/team-db-mailbox.js', '19-36']]) },
  { id: 'A15', title: 'Emit JSON or human text from a CLI handler', confidence: 'medium-high', related: ['C7'], anchors: many([['cli/team/team-commands-vds.js', '14', '46', '57', '67'], ['cli/team/team-commands-lock.js', '87', '117'], ['cli/team/team-commands.js', '85', '96', '114', '134', '173', '199', '228', '253', '333', '343'], ['cli/commands/cmd-project.js', '33', '43', '64', '74', '98'], ['cli/conflicts-cli.js', '45'], ['cli/patcher-cli.js', '95']]) },
  { id: 'A16', title: 'Spec setup with an in-memory team DB', confidence: 'high', anchors: many([['cli/team/team-db-feed-latest.spec.js', '28-32'], ['cli/team/team-projects-coordinator.spec.js', '14-19'], ['cli/team/team-adversarial-locks.spec.js', '23-25'], ['cli/team/team-vds.spec.js', '20-21'], ['cli/team/team-release-train.spec.js', '15-16'], ['cli/team/team-needs.spec.js', '25-30'], ['cli/ui-kanban.spec.js', '23-31'], ['cli/ui-vbulletin.spec.js', '22-30']]) },
  { id: 'A17', title: 'Spec temp project', confidence: 'medium-high', anchors: many([['cli/friction-fixes.spec.js', '13-17'], ['cli/mcp/tools-project.spec.js', '14-18'], ['cli/team/team-db-feed-latest.spec.js', '21-26'], ['cli/team/team-task-add-flags.spec.js', '8'], ['cli/team/team-unknown-task.spec.js', '8']] ) },
  { id: 'A18', title: 'Inline MCP text item bypassing textItem', confidence: 'medium', anchors: at('cli/mcp/tools.js', '230', '235-237') },
  { id: 'A19', title: 'gh discussion create retried per fallback category', confidence: 'high', anchors: at('cli/audit/social-gh.js', '10-14', '24-28', '37-41', '50-54') },
  { id: 'A20', title: 'Swarm composables: GET /api/swarm/... and assign fields', confidence: 'high', related: ['C5'], anchors: many([[`${SWARM}/useSwarmTasks.ts`, '9-26'], [`${SWARM}/useSwarmFeed.ts`, '10-28'], [`${SWARM}/useSwarmLocks.ts`, '9-25'], [`${SWARM}/useSwarmCodebase.ts`, '10-29']]) },
  { id: 'A21', title: 'Swarm composables: POST JSON then refetch', confidence: 'high', related: ['A23'], anchors: many([[`${SWARM}/useSwarmLocks.ts`, '27-40', '42-55'], [`${SWARM}/useSwarmTasks.ts`, '28-41', '43-56', '58-71'], [`${SWARM}/useSwarmFeed.ts`, '39-52'], [`${SWARM}/useSwarmState.ts`, '61-74'], [`${SWARM}/useSwarmAttention.ts`, '49-71']]) },
  { id: 'A22', title: 'Visibility-aware poller', confidence: 'high', anchors: many([[`${SWARM}/useSwarmAttention.ts`, '39-47'], [`${SWARM}/useSwarmFeed.ts`, '30-37'], [`${SWARM}/useSwarmState.ts`, '52-59']]) },
  { id: 'A23', title: 'Swarm composables: error normalization', confidence: 'medium', subsumedBy: 'A21', related: ['A20', 'A21'], anchors: many([[`${SWARM}/useSwarmTasks.ts`, '22', '39', '54', '69'], [`${SWARM}/useSwarmLocks.ts`, '23', '38', '53'], [`${SWARM}/useSwarmFeed.ts`, '23', '50'], [`${SWARM}/useSwarmCodebase.ts`, '25'], [`${SWARM}/useSwarmState.ts`, '45', '72']]) },
  { id: 'A24', title: 'Vue stat tile: caption label over title value', confidence: 'high', related: ['B2', 'B10'], anchors: many([[`${UI}/m-savings-modal/m-savings-modal.vue`, '26-29', '30-33', '34-37', '38-41'], ['src/ui/organisms/o-codebase-catalog/o-codebase-catalog.vue', '27-30', '31-34', '35-38'], ['src/ui/organisms/o-db-studio/o-db-studio.vue', '20-23', '24-27', '28-31', '32-35']]) },
  { id: 'A25', title: 'Settings action card repeated with literal content', confidence: 'medium-high', anchors: at('src/ui/organisms/o-settings-panel/o-settings-panel.vue', '32-39', '41-48', '50-57', '59-66') },
  { id: 'A26', title: 'Lease time remaining', confidence: 'medium', anchors: many([[`${UI}/m-lock-row/m-lock-row.controller.ts`, '6-13'], [`${UI}/m-lock-chip/m-lock-chip.controller.ts`, '15-30']]) }
];

const FALSE_ITEMS = [
  { id: 'B1', title: 'Three-clause && predicates are unrelated', anchors: many([['cli/agent-json.js', '10-11'], ['cli/build.js', '79'], ['cli/cli-args.js', '103']]) },
  { id: 'B2', title: 'UI trio: three different roles', related: ['A24'], anchors: many([[`${UI}/m-attention-card/m-attention-card.vue`, '26-29'], [`${UI}/m-lock-row/m-lock-row.vue`, '18-21'], [`${UI}/m-savings-modal/m-savings-modal.vue`, '26-29']]) },
  { id: 'B3', title: 'Blueprint templates mirrored per framework', anchors: many([['blueprints/molecule-capsule/m-sample-card.vue', '40-60'], ['blueprints/molecule-capsule/m-sample-card.tsx', '45-65'], ['blueprints/molecule-capsule/m-sample-card.svelte', '40-60']]) },
  { id: 'B4', title: 'Same name, different framework', related: ['C2'], anchors: many([['hooks/useSelfCleaningTimer.ts', '18-31'], [`${SWARM}/useSelfCleaningTimeout.ts`, '3-38']]) },
  { id: 'B5', title: 'Timestamp formatting with different outputs', anchors: many([[`${UI}/m-attention-card/m-attention-card.controller.ts`, '16-21'], [`${UI}/m-feed-post/m-feed-post.controller.ts`, '20-29']]) },
  { id: 'B6', title: 'Thin views composed by design', anchors: many([['src/ui/views/v-swarm-locks.vue', '14-18'], ['src/ui/views/v-swarm-tasks.vue', '14-18']]) },
  { id: 'B7', title: 'Controllers that return computeds and handlers', anchors: many([[`${UI}/m-lock-row/m-lock-row.controller.ts`, '19-23'], [`${UI}/m-attention-card/m-attention-card.controller.ts`, '31-36'], [`${UI}/m-token-stat/m-token-stat.controller.ts`, '27-32']]) },
  { id: 'B8', title: 'JSON readers whose error contracts differ from A7', anchors: many([['cli/audit/ratchet.js', '37-48'], ['cli/doctor/check-mcp.js', '14-21'], ['cli/workspace.js', '10-16'], ['cli/commands/cmd-wrappers-json.js', '13-16']]) },
  { id: 'B9', title: 'Truncation from different ends', anchors: many([['cli/navigator-banner-helpers.js', '14-18'], ['cli/team/task-list-view.js', '10-14'], ['cli/errors/formatter.js', '7']]) },
  { id: 'B10', title: 'm-token-stat vs the A24 stat tile', related: ['A24'], anchors: many([[`${UI}/m-token-stat/m-token-stat.vue`, '22-53'], [`${UI}/m-savings-modal/m-savings-modal.vue`, '26-29']]) },
  { id: 'B11', title: 'Same 3-clause && count as A4, different meaning', related: ['A4'], anchors: many([['cli/terminal.js', '29'], ['cli/team/lease-roots.js', '28']]) }
];

const BORDERLINE_ITEMS = [
  { id: 'C1', title: 'Deep ANSI stripping walk', lean: 'against', anchors: many([['cli/mcp/envelope.js', '8-15'], ['cli/agent-json.js', '23-35']]) },
  { id: 'C2', title: 'useSelfCleaningInterval vs useSelfCleaningTimeout', lean: 'against', related: ['B4'], anchors: at('hooks/useSelfCleaningTimer.ts', '3-16', '18-31') },
  { id: 'C3', title: 'Splitting off the command after --', lean: 'against', anchors: many([['cli/verify-helpers.js', '12-17'], ['cli/mcp/call-args.js', '40-46'], ['cli/cli-args.js', '37-42']]) },
  { id: 'C4', title: 'normalizeHandle with trim vs without', lean: 'for', related: ['A12'], anchors: many([['cli/team/agent-identity.js', '17'], ['cli/team/team-db-mailbox.js', '9']]) },
  { id: 'C5', title: 'useSwarmAttention fetch as a weak A20 member', lean: 'for', related: ['A20', 'A21'], anchors: at(`${SWARM}/useSwarmAttention.ts`, '12-37') },
  { id: 'C6', title: 'isPlainObject variants that do not exclude arrays', lean: 'for', related: ['A11'], anchors: many([['cli/mcp/envelope.js', '12'], ['cli/agent-json.js', '28']]) },
  { id: 'C7', title: 'The isCli && isJson branches in team-commands.js', lean: 'for', related: ['A15'], anchors: at('cli/team/team-commands.js', '85-99') }
];

export const GT_ITEMS = [
  ...TRUE_ITEMS.map((item) => ({ ...item, class: 'A' })),
  ...FALSE_ITEMS.map((item) => ({ ...item, class: 'B' })),
  ...BORDERLINE_ITEMS.map((item) => ({ ...item, class: 'C' }))
];
