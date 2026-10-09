# chemx: competitive map and go-to-market plan

*Prepared 2026-10-09. Competitor facts come from the research and fact-check passes run today. Items marked (secondary) come from aggregator or press sources and were not confirmed at the primary source. Every chemx number is self-measured by chemx and should be labeled that way in public.*

## The short version

Nobody else covers the spot chemx occupies. Coding agents from any vendor share one checkout. They work from one task board, hold file leases that renew while the agent is active, and pass one gate. A tool-level guard makes that protocol mandatory rather than advisory, and an audit after the run produces cost receipts.

Each competitor has one or two of these pieces:
- MCP Agent Mail has file leases but no task board.
- Beads has a task board but no file leases.
- Claude Code's own agent teams have tasks and messaging, but their docs say two teammates editing the same file overwrite each other, and tell users to split files by hand.

That documented gap is exactly what chemx solves, and chemx has a measured run to show it: 29 agents, 0 collisions, $5.65.

The obstacle is not the product. It is distribution and legibility. Every relevant competitor has 2k to 74k GitHub stars and a single sentence that sells it. chemx has tens of organic installs a day and a feature list.

---

## 1. Competitive map

| # | Product | Category | What it does | Traction (verified unless marked) | Overlap with chemx | chemx edge | Their edge |
|---|---|---|---|---|---|---|---|
| 1 | **Claude Code agent teams** [1] | First-party platform | Experimental, off by default (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Shared task list with states and dependencies; claiming uses file locks; per-agent JSON mailboxes; model chosen per teammate; `TeammateIdle`/`TaskCreated`/`TaskCompleted` hooks, where exit code 2 blocks the action. Tasks persist under `~/.claude/tasks/`. | Claude Code run-rate reported above $2.5B (secondary) [2] | Highest: tasks, messaging and model choice | **No file-level leases.** The docs say two teammates editing one file overwrite each other and advise splitting files. No tool-level guard. One team per session, no nesting. Claude Code only. Team config is not restored on `/resume`. | First-party, no install, huge distribution, and it will keep absorbing features. chemx relies on its hook surface. |
| 2 | **MCP Agent Mail** [3] | Coordination layer | Agent identities, inboxes, threads, and advisory file leases over MCP, Git and SQLite. An optional pre-commit guard blocks commits that conflict with an active exclusive reservation. | 2.2k stars, 228 forks. The Python version is no longer maintained; new installs go to the Rust rewrite. | Closest on DMs and leases | Leases enforced at the tool call, not only at commit; leases renew on activity with a fairness cap; built-in task board, gate, dispatch and audit. | Clear pitch ("gmail for your coding agents"), easy to adopt alone, active Rust rewrite, multi-vendor (Claude Code, Codex, Gemini CLI, Factory Droid, plus Cursor, Windsurf, Cline configs). |
| 3 | **Beads** [4] | Agent task tracker | Graph issue tracker on Dolt. Atomic task claiming, threaded messaging, hash IDs that avoid merge collisions, server mode with several concurrent writers. `bd setup claude` and `bd hooks install`; setup commands for Codex, Droid and Cursor. | 27.8k stars, 1.9k forks, MIT. The repo now lives under `gastownhall`. | Tasks in a db instead of markdown; multi-agent tasks | No file leases appear on the page; it is unclear whether its hooks enforce anything. chemx adds leases, a guard, a gate and audit. | Large mindshare, well-known author, versioned and mergeable data through Dolt, richer dependency graph. Agent Mail's own docs point users to Beads for tasks. |
| 4 | **Ruflo (formerly claude-flow)** [5] | Swarm meta-harness | Multi-agent swarms for Claude Code and Codex. Claims 27 hooks, mesh, hierarchical and adaptive topologies, "intelligent routing (89% accuracy)", and failover across 5 providers. | 74.2k stars, 8.8k forks, MIT. 12.52M ecosystem downloads per a self-reported README badge. | "Run many agents"; model routing | No file locks mentioned on its page. chemx has measured, auditable results; Ruflo's capability claims have no published method. | Huge visibility, breadth that reads as "does everything", cross-vendor, has routing. |
| 5 | **Vibe Kanban** [6] | Kanban plus agent workspaces | Board that runs 10+ agents (Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor, and others), each workspace with its own branch, terminal and dev server. | 28.3k stars, 3.0k forks, Apache-2.0. **README says "Vibe Kanban is sunsetting."** | Task board plus parallel agents | Still being built; agents use the db directly; file leases instead of branch-per-task. | Visual board that humans understand at a glance. |
| 6 | **Taskmaster** [7] | Task planning | Turns PRDs into tasks for agents in Cursor, Windsurf, Roo and others, via MCP or CLI. | 28.2k stars, 2.6k forks. MIT with Commons Clause. | Task breakdown for agents | Multi-agent leases, handoff, guard, gate, audit. Taskmaster is mostly single-agent planning. | Familiar starting point (PRD to tasks), large installed base. |
| 7 | **Claude Squad** [8] | Worktree runner | Runs Claude Code, Codex, Gemini, Aider (plus OpenCode and Amp per the repo description) in tmux sessions and git worktrees. | 8.6k stars, 625 forks, AGPL-3.0 | Running agents in parallel | Coordinates in one shared checkout, so no worktree drift or merge pain. Adds a task db and audit. | Isolation is simple, familiar and needs no hooks. |
| 8 | **Cursor Agents Window** [9] | IDE platform | Cursor 3 (2026-04-02) runs up to 8 parallel agents across local worktrees, cloud VMs and SSH. | Series D $2.3B at $29.3B (Nov 2025) (secondary) | Running agents in parallel | One db shared by Cursor and other vendors' agents; leases instead of worktrees; swarm audit. | Polished UI, cloud VMs, its own models, a paying user base. |
| 9 | **OpenAI Codex** [10] | Agent platform | CLI, desktop app and cloud with built-in worktrees and delegation to multiple agents. | 5M+ weekly users per OpenAI, early June 2026 (secondary) | Its parallel usage is the coordination problem chemx solves | Neutral lease and handoff layer across vendors, plus guard and audit. | Distribution, first-party models, cloud sandboxes. |
| 10 | **TDD Guard / Probity** [11] | Hook guard | Claude Code hook that blocks edits skipping tests or over-implementing, and enforces refactors against lint rules. Probity is the multi-vendor successor (Claude Code, Codex, Copilot CLI). | 2.4k stars, 188 forks, MIT | Same mechanism: hooks that block agent actions | Much wider scope: all native file tools and shell writes, plus leases, gate and audit. | One sharp rule you can explain in one sentence; simple install. |
| 11 | **ccusage** [12] | Cost telemetry | Token and cost reports from local logs for 18 agents (Claude Code, Codex, OpenCode, Amp, Droid, Goose, Copilot CLI, Gemini CLI, Antigravity, and others), including `ccusage blocks`. | 18.9k stars, 870 forks, MIT | `chemx report savings` and `team tokens` | Measures savings against a native-tool baseline and charges cost to each task and agent. ccusage only reports what was spent. | Run with `npx`, nothing to set up; passively covers every session, not only those routed through chemx. |
| 12 | **Serena** [13] | Code intelligence (MCP) | Language-server-backed reads and edits for symbols across 40+ languages. | About 30.1k stars | chemx `read` outline and symbol modes, `patch` | Coordination, guard, gate, audit; Serena is built for one agent. | Real language-server semantics (references, rename), wide language support, a JetBrains plugin. |
| 13 | **codebase-memory-mcp** [14] | Code intelligence (MCP) | Local knowledge-graph index with call-path tracing and impact analysis; claims 158+ languages. | About 46.2k stars, MIT | `q --blast-radius`, `trace`, `backtrace` | Freshness stamp on every answer; the index drives enforcement and coordination. | Language breadth and a graph query language. |
| 14 | **CodeRabbit** [15] | PR review SaaS | AI review comments on every pull request. | Series C $143M at $1.5B (Aug 2026) (secondary) | "Trust layer for AI code" | Acts before code lands (guard, leases, gate), not after. | Distribution, funding, judges logic, nothing to set up per repo. |

**Not in the table:** Conductor's funding comes from one unverified source. Sculptor and Crystal were not researched.

---

## 2. Positioning

**One sentence.** chemx is the local control plane for coding-agent swarms. Agents from any vendor share one SQLite db where they claim tasks, lease the files they touch and pass one gate. A guard makes the protocol mandatory, and every run ends with an audit and a cost receipt. It is for developers and small teams who run several agents in parallel on one checkout, especially in a monorepo, and who want to use cheaper models without losing control.

**Five things no single competitor combines.** Each was checked against the fact-check corrections.

1. **File leases plus a task board, in one db.** Leases renew while the agent is active and have a fairness cap. Agent Mail has leases but no board. Beads has a board but no leases on its page. Claude Code teams have a board but tell users to split files by hand.
2. **A guard at the tool call, not at commit time.** PreToolUse hooks block native file tools and shell writes on repo files, and send agents to chemx read/patch/write, which validate the change. Competitors enforce elsewhere:
   - Agent Mail at commit time;
   - Claude Code hooks at task lifecycle events;
   - TDD Guard on a single rule.
3. **One gate rule everywhere.** The same rule and a hazard ratchet run at pre-commit, `verify` and `task done`, so an agent cannot mark work done while it is red.
4. **An audit of the finished swarm.** `team audit-run` grades lapses, bypasses, protocol gaps, hijacks and cost. Nothing in the research grades a finished multi-agent run.
5. **Savings measured against a baseline, tied to routing.** `report savings` compares chemx output to the native-tool equivalent, and `team dispatch` routes by tier (light/standard/deep). Ruflo also routes, and ccusage also reports cost. Neither proves the delta against a native baseline.

**Do not claim** that "cross-vendor" is unique: Agent Mail, Beads, Ruflo, Vibe Kanban, ccusage and Claude Squad all support several vendors. Say "one db for all of them" instead. Do not claim plain "enforcement" either; say "a tool-level guard plus file leases".

**Where not to compete head-on:**
- **Code search and semantic intelligence** (Serena, codebase-memory-mcp). Their language breadth and star counts win. Present chemx's index as plumbing for the guard, not as the product.
- **Codemods and structural rewrite** (OpenRewrite/Moderne, ast-grep). Do not lead with Forge until blueprints and heal ship and recall rises above 65%.
- **PR review** (CodeRabbit, Qodo). Present chemx as working upstream of review, not instead of it.
- **Being the agent or the IDE** (Cursor, Codex, Devin). chemx is the layer under all of them.
- **Visual boards and worktree runners** (Vibe Kanban, Claude Squad). Do not build a GUI to match them yet.
- **LLM gateways and observability** (Langfuse, LiteLLM). Present chemx as complementary to these.

---

## 3. Honest gaps competitors exploit today

| Gap | Who exploits it | Fix |
|---|---|---|
| **No one-sentence pitch.** chemx reads as a list of 15 features. | Context7, TDD Guard and Agent Mail each sell one promise. | Lead with "file leases for agent swarms, with receipts". Rewrite the README's opening around one sentence and one receipt. New task: "README hero: one-liner plus the 29-agent receipt". |
| **Adoption is hard.** Hooks, conventions and a db all arrive at once. | ccusage (`npx`), Repomix, Claude Squad | A warn-only guard mode that logs bypasses without blocking, and a single `chemx init` that installs hooks and runs one demo task. Confirm whether these exist; otherwise file both as tasks. |
| **The numbers come from one operator, with no published method.** | Anyone, once you post them | Publish a public benchmark repo with raw logs and audit output (see section 4). |
| **The index and conventions are tuned to the author's stack** (Vue, TS, PHP, WordPress). | Serena, codebase-memory-mcp | Run the demo swarm on two well-known outside repos (one Python, one Go or Rust) before launch, and file any friction found. |
| **The MCP and CLI paths don't match.** The `d`, `log`, `p`, `f` and `j` MCP wrappers read the server's working directory instead of `projectRoot`. | First-time MCP users who hit wrong results | Finish the `projectRoot` work that #2551 started, for all of these wrappers. |
| **Kit commits carry `[skip ci]`**, so the public repo shows no green CI. | Any skeptical evaluator | Land #1948, then add CI and npm badges. |
| **No hosted or visual view.** | Vibe Kanban, Cursor, Conductor | Not now. A read-only `chemx team status --html` export that renders a run receipt is enough for launch. |
| **One maintainer.** | Vibe Kanban's README says it is sunsetting; Roo Code was reportedly archived (secondary). | State the license and roadmap plainly, open "good first issue" tasks, and add a sponsor link. |
| **Download counts are misleading.** About 58k a month, mostly registry mirrors. | Critics who check | Never cite them. Track the real metrics in section 4. |

---

## 4. 30-day go-to-market plan

Rule for every public claim: it must come from a measured number, link to the receipt, and say "self-measured" until someone outside reproduces it.

### Days 1-7: launch assets, in this order
1. **Public benchmark repo (`chemx-bench`).** Run one fixed task set on a real open-source monorepo, three ways:
   - native Claude Code agent teams;
   - worktree isolation;
   - chemx leases.

   Publish the `audit-run` output, `report savings`, `team tokens`, raw transcripts and a `METHOD.md` explaining exactly how baselines and prices were computed. Include the 171/172 haiku run and the 29-agent run if the logs can be published.
2. **Run receipts.** Render the 29-agent, 11-task audit as a one-page HTML or markdown receipt: agents, tasks, collisions, lapsed leases, unleased edits, cost by tier. This one image is the main launch asset.
3. **Two-minute demo.**
   - 0:00-0:20: two agents try to edit the same file, and the guard blocks one with a lease message.
   - 0:20-1:20: `chemx team dispatch` renders a swarm, the agents run, and `team status` shows leases changing hands.
   - 1:20-2:00: `audit-run` prints the receipt with the dollar figure.

   Make no claims in the video that are not visible on screen.

### Days 8-14: channels, in this order
1. **Claude Code plugin marketplace.** chemx already ships hooks, so package the guard and MCP server as a plugin. This is the lowest-friction route to the users who have the problem.
2. **MCP registries.** The official MCP registry, plus Smithery, Glama, PulseMCP and mcp.so.
3. **Awesome lists.** Open PRs to awesome-claude-code and awesome-mcp-servers, plus multi-agent and agentic-coding lists. Each entry is one line plus the receipt link.
4. **Show HN** on a Tuesday to Thursday morning, US time. Title: "Show HN: chemx – file leases and a guard so parallel coding agents don't collide". The first comment covers the method, the self-measured caveat, and an open invitation to break the benchmark.
5. **X and Bluesky.** A thread built on the receipt image. Tag it as complementary to ccusage, Beads and Agent Mail rather than attacking them.
6. **Reddit:** r/ClaudeAI, r/ClaudeCode, r/cursor and r/ChatGPTCoding. Post the demo and the receipt, not a link dump.
7. **Discords:** Claude Code, Cursor and Antigravity communities. Answer "how do I stop agents overwriting each other" threads with the specific fix.
8. **YouTube:** the 2-minute demo, plus one 10-minute deep dive on the monorepo swarm.

### Days 10-25: integrations and partnerships
- **Claude Code agent teams.** The highest-leverage integration. Write a guide called "chemx leases for agent teams" that fills the same-file overwrite gap their docs describe. Use their `TaskCreated` and `TaskCompleted` hooks to mirror tasks into chemx.
- **Beads and Agent Mail.** Offer import/export or a bridge for Beads tasks. Frame it as "keep your tracker, add leases and a guard" rather than "switch".
- **ccusage.** Position chemx alongside it: "ccusage shows what you spent; chemx cuts it and proves the delta." Contact the maintainer about cross-linking.
- **Vibe Kanban users.** Its README says it is sunsetting. Publish a short migration note, without making claims about its shutdown date.
- **Codex, Cursor and Antigravity.** Ship tested setup docs for each host the guard supports, with a screenshot of the guard working in each.

### Days 15-30: content
- **Case study: "A 29-agent swarm in a WordPress/Vue monorepo for $5.65."** Cover the setup, the dispatch script, the lease timeline, the audit receipt, what went wrong (from the audit's lapses and gaps) and what it would have cost at Opus prices.
- Weekly short posts, one receipt each, covering a new outside-repo run or an audit finding.

### Metrics to track (report weekly; no vanity numbers)
| Metric | How | Why |
|---|---|---|
| **Real installs** | Opt-in ping on `chemx init` (anonymous install id), counted separately from npm download totals | npm totals are mostly mirrors |
| **Weekly active coordination dbs** | Opt-in weekly ping: one row per db with any task or lease activity | This is the true adoption number |
| **Activation** | Share of new installs that complete one task with a lease within 24 hours | Shows whether onboarding works |
| **7- and 28-day retention** of active dbs | Same opt-in ping | Shows whether the product sticks |
| **Outside receipts** | Count of `audit-run` receipts shared by people other than the author | Turns self-measured claims into evidence |
| Stars, Show HN rank, marketplace installs, issues and PRs from people other than the author | GitHub, marketplace | Signs of visibility and community |

---

## 5. Three headline claims chemx can make today

Each is self-measured by chemx and should be stated that way until the benchmark repo is public.

1. **"29 agents, 11 tasks, one checkout: 0 file collisions, 0 lapsed leases, 0 unleased edits, for $5.65."**
   Source: chemx `team audit-run` on a dispatched swarm, 2026-10-09.
2. **"A haiku swarm fixed 171 of 172 files. Two runs cost $3.48; the same work priced at Opus rates is $77.84, about 22x more."**
   Source: chemx `team tokens` and tier routing on two measured runs.
3. **"chemx returns test summaries 19x smaller and file reads 3.3x smaller than native tools, a net 385k tokens saved."**
   Source: chemx `report savings`, measured against native-tool equivalents.

---

### Sources
1. Claude Code agent teams docs: https://code.claude.com/docs/en/agent-teams
2. Claude Code revenue (secondary): https://www.getpanto.ai/blog/anthropic-ai-statistics ; https://aiweekly.co/alerts/anthropic-hits-30b-run-rate-leads-cnbc-disruptor-50
3. MCP Agent Mail: https://github.com/Dicklesworthstone/mcp_agent_mail
4. Beads: https://github.com/steveyegge/beads
5. Ruflo / claude-flow: https://github.com/ruvnet/claude-flow
6. Vibe Kanban: https://github.com/BloopAI/vibe-kanban
7. Taskmaster: https://github.com/eyaltoledano/claude-task-master
8. Claude Squad: https://github.com/smtg-ai/claude-squad
9. Cursor 3 and funding (secondary): https://medium.com/@tentenco/cursor-3-ships-an-agent-first-interface-heres-what-it-actually-changes-1f2bf8f383e2 ; https://agentmarketcap.ai/blog/2026/04/05/cursor-29b-valuation-ai-coding-tool-platform-transition
10. Codex usage (secondary): https://www.getpanto.ai/blog/codex-ai-statistics
11. TDD Guard: https://github.com/nizos/tdd-guard
12. ccusage: https://github.com/ryoppippi/ccusage
13. Serena: https://github.com/oraios/serena
14. codebase-memory-mcp: https://github.com/DeusData/codebase-memory-mcp
15. CodeRabbit funding (secondary): https://hyrax.dev/blog/coderabbit-series-c-review-layer-market ; https://sacra.com/c/coderabbit/