# Changelog

All notable changes to the Chemical X Starter Kit repository will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [2026-09-08]

### Added
- Initial private starter-kit repository architecture.
- Table-of-Contents view blueprint (`blueprints/view-template.tsx`).
- Molecule capsule blueprint (`blueprints/molecule-capsule/`).
- Core hook library:
  - `toResult`: functional result tuple pattern
  - `useAsyncData`: 3-state async pipeline
  - `useSelfCleaningTimer`: unmount-safe interval and timeout utilities
- Interactive CLI capsule generator (`cli/index.js`).

## [2026-09-11]

### Added
- Standardized the Chemical X color palette across the starter kit to match the official Hall of the Gods Chemical X Vol. 1 Comic Book cover:
  - Created centralized palette module (`cli/theme.js`, `cli/theme.d.ts`) codifying Blossom Pink (`#f43f85`), Power Purple (`#a855f7`), Bubbles Cyan (`#38bdf8`), Chemical Mint (`#2dd4bf`), Buttercup Lime (`#a3e635`), Vibe Gold (`#fbbf24`), Golden Ribbon (`#f59e0b`), and Midnight Violet armor (`#181126`).
  - Updated 24-bit TrueColor ASCII art banner (`getChemicalXAsciiBanner` in `cli/audit/reporter-banner.js`) with 3-phase gradient (Blossom Pink -> Bubbles Cyan -> Buttercup Lime) and golden ribbon motto styling (`The Secret Sauce to Vibe Coding!`).
  - Upgraded terminal banner renderer (`renderBanner` in `cli/terminal.js`) with TrueColor gradient border and title formatting.
  - Enhanced Verified Chemical X Footer Badge SVG asset generator (`generateSvgBadgeSnippet` in `cli/badge.js`) with embedded `<linearGradient id="chemx-comic">` border and updated HTML snippet.
  - Aligned `m-chemx-badge` blueprint capsule styles (`_m-chemx-badge.scss`) with the official comic palette for hover glow and grade badges.
- Expanded AST static analysis engine with Pillars 8 to 11 (`cli/audit/extended-visitors.js`): added automated rules and visitors for Accessibility & Semantic Integrity (`A11Y_CLICKABLE_NON_SEMANTIC`, `A11Y_IMAGE_MISSING_ALT`), Security & Content Safety (`SECURITY_RAW_HTML_INJECTION`, `SECURITY_HARDCODED_SECRET`), Testing Discipline (`TEST_FAKE_GREEN`, `TEST_MISSING_COLOCATED`), and Naming Conventions (`NAMING_BARE_BOOLEAN`, `NAMING_HANDLER_PREFIX`).
- Implemented nested bullet tree path-chain formatter (`formatGroupedPromptViolations` in `cli/audit/prompts.js` and `renderGroupedViolationsTerminal` in `cli/audit/reporter-grouping.js`), clustering violations by rule and rendering folder hierarchy steps as indented bullet chains with `📁` folder emojis and ANSI severity colors (`📁 app/` -> `📁 components/` -> `📁 molecules/` -> leaf files with line hits) to eliminate boilerplate repetitions and slash AI prompt token consumption by up to 85%.
- Consolidated monolith refactoring action directives across `buildHotspotsPrompt`, `buildGradeFPrompt`, `buildGradeDPrompt`, and `buildGradeCPrompt`, stating action requirements once per section.
- Added `{ excludeAiSlop }` filter options to grade prompt builders to prevent duplicate slop violation listings in `buildMasterPrompt`.
- Added `{ includePrompt: false }` flag to `formatHotspotsSection` and `formatAiSlopSection` when rendered within full terminal report (`cli/audit/reporter.js`), preventing mid-report prompt box duplication before the master prompt.
- Added AI Agent refactoring prompt generator for AI Slop & Authenticity (`buildAiSlopPrompt` in `cli/audit/prompts.js`), generating surgical instructions to eliminate conversational residue, lazy placeholders, echo comments, shallow catch blocks, and reinvented utilities.
- Added AI Agent refactoring prompt generator for Top Refactoring Hotspots (`buildHotspotsPrompt` in `cli/audit/prompts.js`), providing phased decomposition plans for files exceeding line budgets.
- Integrated AI Slop and Hotspots prompt boxes into report sections (`formatAiSlopSection`, `formatHotspotsSection` in `cli/audit/reporter-sections.js`), composite master prompt (`buildMasterPrompt`), and interactive navigator inspection views (`cli/navigator-actions.js`, `cli/navigator.js`, `cli/navigator-menu.js`).
- Appended Section 8 (Accessibility & Semantic Integrity), Section 9 (Security & Content Safety), Section 10 (Testing Discipline), and Section 11 (Naming Conventions) to Chemical X Molecular Architecture Directives (`AGENTS.md`).
- Interactive `[  Re-Run   ]` dashboard action positioned directly below `[Full Report]` in the Audit Navigator (`cli/navigator.js`, `cli/navigator-actions.js`, `cli/navigator-menu.js`), enabling developers to rescan their codebase and dynamically refresh the Gamer HUD scorecard and grade drill-downs without restarting the CLI.
- Compact directory and rule-based problem grouping engine (`cli/audit/reporter-grouping.js`, `cli/audit/reporter-grouping-markdown.js`, `cli/audit/reporter-grouping.d.ts`), clustering violations by directory and rule type to eliminate repetitive multi-line output bloat in audit reports.
- `HAZARD DISTRIBUTION BY DIRECTORY` terminal scorecard (`formatDirectoryDistributionSection`) and Markdown directory rollup table (`formatDirectoryRollupMarkdown`) displaying total hazard density and severity breakdown per directory.
- Compact location formatter (`formatCompactLocations`) clustering affected files and line numbers under folder badges.
- Pure deterministic AI Slop Index (ASI) and code authenticity engine (`cli/audit/ai-slop-detector.js`) detecting LLM conversational preambles, leaked markdown fences, lazy truncation placeholders, shallow catch paranoia wrappers, redundant passthrough assignments, inline utility reinventions, and trivial echo comments.
- Registered AI slop rules (`AI_SLOP_CONVERSATIONAL_ARTIFACT`, `AI_SLOP_LAZY_PLACEHOLDER`, `AI_SLOP_SHALLOW_CATCH`, `AI_SLOP_UTILITY_REINVENTION`, `AI_SLOP_ECHO_COMMENT`, `AI_SLOP_LAZY_ANY`, `AI_SLOP_REDUNDANT_PASSTHROUGH`) in `RULE_REGISTRY` (`cli/audit/rules-registry.js`).
- Added `calculateAiSlopScore` to compute dedicated 0 to 100 authenticity score and letter grades (`A+` to `F`), isolating slop penalties from architectural Molecular Health Index (`cli/audit/metrics.js`).
- Integrated AI Slop Index (ASI) metrics and dedicated audit section into full terminal report (`formatAiSlopSection` in `cli/audit/reporter.js`) and Markdown audit report (`cli/audit/reporter-markdown.js`).
- Added Shields.io AI Slop badge and Before vs. After delta progression rows to GitHub Discussions shared social cards (`cli/audit/social.js`).
- Added AI Slop score indicator to Gamer HUD banner (`cli/navigator-banner.js`), active grade navigator actions (`cli/navigator-actions.js`), and grade resolution helpers (`cli/navigator-grades.js`, `cli/navigator.js`).
- Interactive Molecular Capsule Generator wizard for `npx chemx generate` (and aliases `capsule`, `add`), supporting Gum and ANSI fallbacks (`cli/generator.js`, `cli/generator.d.ts`).
- Multi-framework scaffolding support for React 19 (`.tsx`), Vue 3.4+ (`.vue`), and Svelte 5 (`.svelte`) with scoped SCSS, controllers, and discriminated union types (`cli/generator-templates.js`).
- CLI flags for non-interactive and fast capsule generation (`--tier`, `--framework`, `--dir`, `--lean`, `-y` / `--yes`).
- Verified Chemical X Footer Badge command and generator (`npx chemx badge` / `cli/badge.js`), providing copyable snippets for Vue 3 SFC, React 19 TSX, Svelte 5, HTML/CSS, Markdown Shields, and SVG asset export.
- Integrated `[   Badge   ]` action into the interactive Audit Navigator dashboard (`cli/navigator-actions.js`, `cli/navigator.js`, `cli/navigator-menu.js`).
- Added `m-chemx-badge` blueprint capsule with Vue 3, React 19, SCSS, and TypeScript declarations (`blueprints/molecule-capsule/m-chemx-badge/`).

- Added co-located unit test suite for `m-chemx-badge` capsule (`blueprints/molecule-capsule/m-chemx-badge/m-chemx-badge.spec.ts`) covering grade classification tiers and component markup attributes.
- Added co-located unit test suite for `m-sample-card` capsule (`blueprints/molecule-capsule/m-sample-card.spec.ts`) covering badge descriptor resolution, formatting, and interactive action handling.

### Changed
- Exported `resolveGradeClass` from `m-chemx-badge` entrypoints for isolated testing and external consumption.
- Exported `resolveBadgeDescriptor` and co-located `SampleCardBadgeDescriptor` type declaration in `blueprints/molecule-capsule/` capsule.
- Decomposed warning monolith `cli/audit/reporter.js` (513 lines to 125 lines) to eliminate Grade C medium severity technical debt, extracting single-purpose modules `cli/audit/reporter-banner.js` (75 lines), `cli/audit/reporter-sections.js` (238 lines), and `cli/audit/reporter-summary.js` (143 lines).
- Co-located granular TypeScript declaration capsules (`cli/audit/reporter.d.ts`, `cli/audit/reporter-banner.d.ts`, `cli/audit/reporter-sections.d.ts`, `cli/audit/reporter-summary.d.ts`) all under 20 lines, updating `cli/audit/types.d.ts` to re-export domain capsules.
- Extracted anonymous inline callbacks into named predicates and iterator handlers across terminal section formatters.
- Preserved 100% backward-compatible re-exports in `cli/audit/reporter.js` for seamless consumption across CLI actions and tools.
- Streamlined terminal reports (`formatTerminalReport`, `formatCriticalSection`, `formatHighMediumSection`, `formatLowSection`, `formatFailuresSection` in `cli/audit/reporter.js`) and grade drill-down views (`formatGradeFSection`, `formatGradeDSection`, `formatGradeCSection`, `formatGradeBSection` in `cli/audit/reporter-grades.js`) to display deduplicated rule descriptions and directives once with grouped directory location paths.
- Streamlined Markdown audit report (`cli/audit/reporter-markdown.js`) Section 4 to group problems by directory and rule with concise location links, eliminating hundreds of repetitive table rows.
- Conditioned `[  Prompt   ] 📋 Copy AI Prompt Fix to Clipboard` dashboard action to hide when the codebase earns a pristine Grade A+ with no pending refactoring prompt (`cli/navigator.js`, `cli/navigator-actions.js`).
- Added early-return guard clause to `handleCopyPromptAction` preventing empty clipboard copy operations on pristine Grade A+ audits (`cli/navigator-actions.js`).

### Fixed
- Remediated 22 AI Slop hazards across `cli/` and `cli/audit/` to restore AI Slop Index (ASI) from 31/100 (Grade F) to 100/100 (Grade A+):
  - Fixed self-matching regex detection patterns in `cli/audit/ai-slop-detector.js` (`AI_SLOP_CONVERSATIONAL_ARTIFACT`) by assembling detection patterns from string token arrays.
  - Replaced 10 shallow catch blocks in `cli/audit/social-git.js` with functional Result Tuple helpers (`safeSpawnSync` and `safeReadJson`) per Chemical X Section 2.C.
  - Eliminated 10 shallow catch paranoia wrappers with normalized error diagnostics and explicit fallback returns across `cli/audit/history.js`, `cli/index.js`, `cli/license.js`, `cli/navigator-banner.js`, `cli/navigator-share.js`, and `cli/terminal.js`.
- Fixed pre-commit hook installer failure (`ENOTDIR`) in git submodules and worktrees where `.git` is a pointer file rather than a directory by introducing `resolveGitHooksDir` to resolve `gitdir:` targets (`cli/installer.js`, `cli/installer.d.ts`).
- Fixed missing `spawnSync` import from `node:child_process` in evaluation check prompt causing runtime reference error (`cli/license.js`).
- Fixed typographical artifact (`and p`) in the interactive audit publication confirmation prompt across navigator and terminal handlers (`cli/navigator.js`, `cli/terminal.js`).
- Eliminated trivial echo comments (`AI_SLOP_ECHO_COMMENT`) in `cli/audit/social-git.js` that redundantly repeated self-documenting git commands.
- Eliminated self-matching AI truncation placeholder hazard in `cli/audit/prompts.js` (`AI_SLOP_LAZY_PLACEHOLDER`) to prevent self-audit false positive.
- Eliminated self-matching `A11Y_IMAGE_MISSING_ALT` hazard on `cli/audit/extended-visitors.js` by assembling tokenized template regexes and scoping template tag checks to template files.
- Replaced shallow catch paranoia wrapper (`AI_SLOP_SHALLOW_CATCH`) in `cli/audit/extended-visitors.js` with `toResultSync` Result Tuple pattern and 2-stage atomic boolean composition per Chemical X Section 2.C and 3.A.
- Exported shared `toResultSync` synchronous Result Tuple helper from `cli/audit/rules-helpers.js`.


## [2026-09-10]

### Changed
- Decomposed warning monolith `cli/navigator.js` (515 lines to 123 lines) by extracting single-responsibility capsules: `cli/navigator-banner.js` (84 lines: Gamer HUD terminal rendering), `cli/navigator-menu.js` (115 lines: button tags, menu assembly, selection matching), and `cli/navigator-actions.js` (165 lines: grade drill-downs and dashboard actions), preserving all public exports and type declarations.
- Extracted anonymous inline callbacks into named functions across navigator modules adhering to Chemical X code syntax standards.
- Replaced all abbreviated `LOC` acronym references across dashboard banners, reports, Markdown exports, and refactoring prompts with fully spelled-out `lines of code` (`cli/navigator.js`, `cli/audit/reporter.js`, `cli/audit/reporter-grades.js`, `cli/audit/reporter-utils.js`, `cli/audit/reporter-markdown.js`, `cli/audit/prompts.js`, `cli/audit/social.js`, `cli/audit/history.js`, `cli/help.js`).
- Reordered interactive Audit Navigator dashboard menu (`cli/navigator.js`) into four distinct operational sections separated by clean dividers: top actions (`[  Install  ]`, `[  Upgrade  ]`, `[Full Report]`), grade drill-downs (`[ Grade: A  ]`), community and metrics actions (`[   Share   ]`, `[ Progress  ]`, `[  Export   ]`), and footer actions (`[  Prompt   ]`, `[   Exit    ]`).
- Conditioned `[  Install  ]` action to display only when git pre-commit hooks and GitHub Actions CI workflow are not already installed (`areGuardrailsInstalled` in `cli/installer.js`, `cli/navigator.js`).
- Centered button bracket text across all dashboard actions and grade tags for uniform 13-character button width and column alignment (`formatButtonTag` in `cli/navigator.js`, `resolveGradeBadge` in `cli/navigator-grades.js`).
- Renamed prompt copy menu item to `[  Prompt   ] 📋 Copy AI Prompt Fix to Clipboard` (`cli/navigator.js`).
- Renamed full report menu button to `[Full Report]` and share option label to plug website and post to GitHub Discussions (`cli/navigator.js`).
- Aligned terminal output columns across `METRIC COMPARISON TABLE` and `7-PILLAR PROGRESSION` in `formatTransformationTerminal` (`cli/audit/history.js`), expanding pillar and metric padding to 40 characters with uniform divider widths.

### Added
- Integrated real-time Token Estimate (`-TOKEN EST-`) and Currency Cost (`-CURRENCY-`) metrics into Gamer HUD (`cli/navigator-banner.js`, `cli/navigator.js`).
- Embedded project name in top rounded border and project working directory (`pwd`) in bottom rounded border of Gamer HUD (`cli/navigator-banner.js`).
- Swapped Gamer HUD column positions in `renderDashboardBanner` (`cli/navigator-banner.js`): `-FILES-` and `-LINES OF CODE-` on the left column, and `-HEALTH-` and `-HAZARDS-` on the right column.
- Hazard emojis (💥 for Critical, 🔥 for High/Med, 💣 for Low) in `-HAZARDS-` HUD status row (`cli/navigator-banner.js`) and interactive grade drilldown actions (`cli/navigator-actions.js`).
- Gamer HUD with 2-column layout in `renderDashboardBanner` (`cli/navigator.js`) grouping `-HEALTH-` and `-HAZARDS-` on the left and `-FILES-` and `-LINES OF CODE-` on the right, removing HUD title banner and quote text.
- Heart emoji container display (`❤️❤️❤️❤️❤️` to `🖤🖤🖤🖤🖤`) in `resolveHealthHearts` (`cli/navigator-grades.js`).
- Compact `X = [Grade]` ASCII art banner in `getChemicalXAsciiBanner` (`cli/audit/reporter.js`, `cli/audit/reporter-ascii.js`) removing the redundant `GRADE` text and linking Chemical X with bold ASCII `=` and dynamic letter grade typography (`A+`, `A`, `B`, etc.).
- Four-line compact block `REPORT CARD` ASCII art banner (`REPORT_CARD_ASCII` in `cli/audit/reporter-ascii.js`) added to the top of all grade report card sections (`formatGradeASection`, `formatGradeBSection`, `formatGradeCSection`, `formatGradeDSection`, `formatGradeFSection`) and the audit scorecard overview (`formatScorecardSection`).
- Free, standalone POSIX git pre-commit hook script (`scripts/pre-commit.sh`) enforcing 500-line file budgets, 100-line molecule capsule limits, and configurable minimum grade/score thresholds with automatic AI refactoring prompt clipboard copying.
- Production GitHub Actions CI workflow blueprint (`blueprints/workflows/chemx-audit.yml`) executing architectural audits with configurable grade thresholds and artifact uploads.
- Modular CLI installer capsule (`cli/installer.js`, `cli/installer.d.ts`) enabling interactive Gum and ANSI installation of pre-commit hooks, GitHub workflows, and `.chemx/config.json` project configurations.
- Dedicated `[Install  ] 🪝 Install Pre-Commit Hook & GitHub CI Workflow` action in the interactive Audit Navigator dashboard (`cli/navigator.js`).
- Standalone CLI subcommands `hook`, `hooks`, `install-hooks`, and `setup-ci` in `cli/index.js` for direct non-interactive setup.
- Token financial telemetry engine in `cli/audit/metrics.js` translating context bloat into real-world dollar waste per AI prompt turn, weekly developer waste, and monthly team context tax based on configurable model baselines (`--model=claude|gpt4o|blended` or custom rate).
- Financial metrics reporting in terminal reports (`formatContextAnalysisSection` in `cli/audit/reporter.js`), Markdown reports (`cli/audit/reporter-markdown.js`), and published GitHub Discussion reports (`generateDiscussionContent` and `generateTransformationDiscussionContent` in `cli/audit/social.js`).
- Flexible audit threshold flags: `--min-grade`, `--min-score`, `--prompt-on-fail`, and `--copy-prompt`.
- Hybrid GitHub Sponsors licensing CTAs in `cli/navigator-conversion.js` and `cli/license.js` spotlighting $9/mo solo and $49/mo team unlimited sponsorship.
- Robust 7-pillar Quantum Engineering Architecture static analysis rule engine (`cli/audit/rules.js`) covering line budgets, control flow booleans, nested ternaries, hook saturation and return budgets, timer disposal, render-hack timeouts, type co-location, type monoliths, mock data patterns, inline styles, icon SVG leaks, and typography hygiene.
- Full architectural metrics and scoring engine (`cli/audit/metrics.js`) computing Quantum Health Index (QHI: 0 to 100 score with A+ to F letter grades), codebase LOC distribution, molecule capsule compliance rate, and context token burn risk.
- Multi-format audit reporter (`cli/audit/reporter.js`) supporting rich ANSI terminal scorecards, GitHub-flavored Markdown reports (`--markdown`), and structured JSON (`--json`).
- Severity-grouped hazard categorization (`groupViolationsBySeverity`) isolating Critical Hazards (immediate action required), High & Medium Hazards (architecture debts), and Low Hygiene Issues (typography & logging).
- Interactive Gum Audit Dashboard Navigator (`cli/index.js`) providing a zero-scroll terminal interface with drill-down line items into scorecards, critical hazards, high/medium debts, hygiene issues, 7 pillars, hotspots, and token analytics.
- Integrated `gum pager` for terminal scrolling of full unrolled reports.
- Sliding scale monolith detection system (`cli/audit/rules.js`) classifying files into three calibrated tiers: Warning / Medium (500 to 999 lines), Severe / High (1,000 to 1,999 lines), and Extreme / Critical (2,000+ lines), providing fair and balanced health scoring for existing codebases.
- Priority-ranked refactoring hotspot leaderboard ranking files by hazard density and line budget overflow.
- Vibrant 24-bit RGB gradient ASCII art banner (`getChemicalXAsciiBanner` in `cli/audit/reporter.js`) featuring "Chemical X" slant lettering styled with Pink -> Magenta -> Lavender color transitions, accompanied by the motto "The Secret Sauce to Vibe Coding" and the directive "Strict Quantum Engineering Standards for AI Agents to follow."
- Social audit sharing module (`cli/audit/social.js`) enabling developers to publish audit reports to GitHub Discussions under the `npx chemx audit` category (`https://github.com/orgs/Chemical-X-Protocol/discussions`), with automated GitHub CLI (`gh`) publishing and cross-platform clipboard/browser fallback.
- Local audit persistence and telemetry history module (`cli/audit/history.js`), persisting up to 50 audit snapshots to `.chemx/history.json` and establishing/tracking `.chemx/baseline.json`.
- Automatic `.chemx/` directory provisioning and `.gitignore` registration to prevent accidental commit of local audit history.
- Architectural delta calculation engine (`calculateTransformationDelta`) computing MHI score deltas, critical hazard reductions, monolith decompositions, token burn savings, and 7-pillar status progressions between baseline and refactored states.
- Terminal transformation formatters (`formatTransformationTerminal` and `formatHistoryTimelineTerminal`) rendering side-by-side Before & After delta tables and audit timeline records.
- Dedicated `[Progress ] 📈 View Before & After Transformation Progress` interactive dashboard action in `cli/navigator.js`.
- Dual discussion sharing mode in `handleShareToDiscussions`: prompts developers to post either a Before & After Transformation Showcase (`generateTransformationDiscussionContent`) or a Single Audit Scorecard (`generateDiscussionContent`).
- Privacy-safe GitHub Discussion publishing: all discussion templates strictly omit private file paths and repository code, displaying aggregate metrics, monolith counts, and 7-pillar progression badges (`🟢 RESOLVED`, `⚪ UNCHANGED`, `🔴 DEGRADED`).
- CLI flags `--markdown`, `--md`, `--output=<file>`, `--unroll`, `--share`, and `--strict` for `npx chemx audit`.
- Local `"audit"` script in `package.json` for running audits directly via `npm run audit`.
- Automated AI Agent refactoring prompt generator module (`cli/audit/prompts.js`) synthesizing tailored, copy-pasteable prompts for each audit section and grade tier (Grade F Critical, Grade D Debts, Grade C Style/Handlers, Grade B Hygiene, Master Phased Prompt), embedded directly into terminal views, Markdown reports, and GitHub Discussions.
- 1-Click Clipboard prompt copying in interactive report views: added automatic prompt detection and extraction (`extractPromptFromContent`) with a dedicated `📋 Copy AI Agent Prompt to Clipboard` action in `showPagedContent` for Gum and standard terminal environments.
- Automatic git repository and owner detection (`detectGitRepoInfo`, `parseGitRemoteUrl` in `cli/audit/social.js`), resolving `owner/repo` (e.g. `Chemical-X-Protocol/starter-kit`) for discussion post titles, headers, and canonical repository URLs, while keeping auditor username detection strictly bound to the developer's personal GitHub account.
- Pre-menu Gum confirmation button (`gumConfirm` and `confirmAction` in `cli/terminal.js` and `cli/navigator.js`) defaulting to asking whether developers would like to publish their audit report to GitHub Discussions immediately following report and ASCII banner presentation, prior to presenting the dashboard navigation menu.
- Persistent discussion topic reuse and comment archival engine (`cli/audit/discussion-store.js` and `publishOrUpdateDiscussion` in `cli/audit/social-publisher.js`): tracks active discussion topics per project in `.chemx/discussion.json`; when posting an updated report, archives the prior report by posting it as a snapshot comment to the discussion thread and updates the primary discussion topic with the latest report.
- Live deployment and project website URL publishing (`cli/navigator-share.js`, `cli/audit/social.js`): prompts developers for an optional project/website URL (auto-detected from `package.json` homepage or cached `.chemx/discussion.json`) and embeds it as a normalized, clickable markdown hyperlink (`[https://...](https://...)`) into published GitHub Discussion audit reports and transformation showcases.
- Non-blocking evaluation mode ("nagware" reminder) for molecule capsule generation and scaffolding commands (`checkOrPromptEvaluation` in `cli/license.js` and `cli/scaffold.js`): provides an instant default-Enter bypass for unlicensed developers to evaluate code generation while displaying reminder banners to purchase a license.
- Comprehensive CLI help and usage manual capsule (`cli/help.js`): provides an exhaustive `--help` reference covering all commands (`audit`, `generate`, `init`, `create`), all audit options (`--dir`, `--json`, `--markdown`, `--output`, `--unroll`, `--share`, `--strict`, `--license`), environment variables (`GH_TOKEN`, `CHEMICAL_X_API_URL`), and copy-pasteable examples.

### Changed
- Codified the Anti-Tailwind-Soup Directive into Pillar 5 across agent directives (`AGENTS.md`) and static audit rules registry (`cli/audit/rules-registry.js`): restricts inline utility chains to 4-5 classes maximum, prohibiting monolithic Tailwind class soup in templates and mandating visual decoupling into Level 1 atom props, Level 2 mixins, or Level 3 scoped classes utilizing `@apply`.
- Updated ASCII banner subtitle in `cli/audit/reporter.js` to "Architectural guardrails to eliminate token burn and AI hallucinations" with dynamic column centering.
- Updated default GitHub Discussions category to `npx chemx audit` in `cli/audit/social.js` with expanded case-insensitive and fallback resolution.
- Modularized starter kit audit engine under `cli/audit/` while maintaining 100% backward compatibility with `cli/audit.js` and `./audit` subpath export.
- Enhanced TypeScript type definitions in `cli/audit.d.ts` and `cli/audit/types.d.ts` for full typing across all metrics, pillars, and options.
- Refactored internal audit code to eliminate nested ternaries in compliance with Quantum Engineering standards.
- Streamlined interactive Gum Audit Navigator into consolidated Pass, Fail, and Full Report options (`Show Full Report`, `View Failed & Degraded Checks`, `View Passed & Compliant Checks`, and `View Scorecard`), eliminating the need to click through 7 separate sub-menus.
- Reorganized audit navigator menu into an action-first and grade-tiered layout (Report, Share, Export, Upgrade, Grade F to A, Exit) with dynamic grade links that only appear if corresponding checks/hazards exist in the codebase.
- Added dedicated grade section formatters (`formatGradeFSection`, `formatGradeDSection`, `formatGradeCSection`, `formatGradeBSection`, `formatGradeASection`) in `cli/audit/reporter.js` with individual exports and type definitions.
- Rebranded terminology across the starter kit CLI, metrics, reporter, types, prompts, and social publisher from "Quantum Engineering" to "Chemical X Molecular Architecture Standards", replacing ambiguous buzzwords with grounded atomic and molecular architectural definitions.
- Renamed `calculateQuantumHealthScore` to `calculateMolecularHealthScore` (Molecular Health Index / MHI) with backward-compatible aliases.
- Updated ASCII art banner in `cli/audit/reporter.js` to block font lettering with 24-bit TrueColor gradient and centered alignment.
- Updated CLI dashboard upgrade action label and conversion menu to `💎 Unlock Full Molecular Rules & Scaffolding (Chemical X: Team Power Puff)` with streamlined Single Developer License ($27) and Team Power Puff 100 seats Team Honor System licensing ($47: `Power Puff Team 💯`).
- Refined terminal report color hierarchy: Critical hazards render in RED, High and Medium debts in ORANGE, and Low hygiene issues in YELLOW; top analytical overview, matrix, and hotspot sections dynamically illuminate in GREEN when 100% compliant and zero hazards remain.
- Integrated codebase health grade directly into ASCII banner art: dynamically appends `= Grade <tier>` (e.g. `X = Grade A+`) at the center intersection of the ASCII `X` above the audit dashboard menu and within full terminal reports.
### Fixed
- Fixed discussion category recognition error by setting `DEFAULT_DISCUSSION_REPO` to `Chemical-X-Protocol/.github` and using category slug `npx-chemx-audit` in browser URLs.
- Resolved `unable to read stdin` crash during report inspection by removing piped child process pager calls and directly streaming styled report output with interactive back-to-dashboard navigation.
- Added automatic terminal screen clearing (`console.clear()`) between menu navigations and report inspections, eliminating duplicate banners and artifact stacking.
- Executed phased Chemical X Molecular Architecture refactoring eliminating Grade F, Grade D, and Grade C hazards:
  - Surgically refactored `blueprints/molecule-capsule/m-sample-card.tsx` to eliminate nested ternaries via `resolveBadgeDescriptor` computed descriptor and removed all 8 raw inline styles in favor of scoped BEM stylesheet `_m-sample-card.scss`.
  - Refactored `blueprints/view-template.tsx` to eliminate raw inline styles via `_view-template.scss` while preserving a 21-line declarative Table-of-Contents template.
  - Decomposed 1,070-line severe monolith `cli/index.js` into isolated single-responsibility domain capsules: `cli/terminal.js` (77 LOC), `cli/license.js` (188 LOC), `cli/scaffold.js` (167 LOC), `cli/navigator.js` (379 LOC), and lean orchestrator `cli/index.js` (134 LOC), preserving all public exports without breaking changes.
  - Decomposed warning monolith `cli/audit/reporter.js` (831 LOC to 352 LOC) by extracting `cli/audit/reporter-utils.js` (88 LOC), `cli/audit/reporter-markdown.js` (122 LOC), and `cli/audit/reporter-grades.js` (243 LOC) with 100% backward-compatible re-exports.
  - Decomposed warning monolith `cli/audit/rules.js` (554 LOC to 118 LOC) by extracting `cli/audit/rules-registry.js` (102 LOC), `cli/audit/rules-helpers.js` (109 LOC), and `cli/audit/ast-visitors.js` (230 LOC).
  - Enhanced published and exported audit reports in `cli/audit/social.js` and `cli/audit/reporter-markdown.js`: added pillar icons and colored status/hazard emojis (`🟢`, `🟡`, `🔴`) to the 7-Pillar Architectural Matrix, replaced `#1`/`#2` priority tags with number emojis (`1️⃣`, `2️⃣`, `3️⃣`, etc.) to prevent GitHub Discussions auto-linking conflicts, and styled monolith tiers with severity indicator circles.
  - Fixed Grade F critical AST nested ternary violations in `cli/audit/history.js` (`resolvePillarDeltaArrow` and `resolveScoreGradeColor`) and `cli/audit/social.js` (`resolvePillarProgressionBadge`).
  - Decomposed warning monolith `cli/audit/social.js` (572 LOC to 221 LOC) by extracting `cli/audit/social-git.js` (214 LOC) and `cli/audit/social-publisher.js` (188 LOC) while preserving all public exports.
  - Decomposed warning monolith `cli/navigator.js` (666 LOC to 343 LOC) by extracting focused sub-100 LOC capsules: `cli/navigator-grades.js` (70 LOC), `cli/navigator-paged.js` (86 LOC), `cli/navigator-conversion.js` (87 LOC), and `cli/navigator-share.js` (98 LOC) with full backward compatibility.
  - Extracted anonymous inline callbacks into named functions across audit persistence and dashboard navigator modules.
  - Co-located granular TypeScript definitions in `cli/audit/history.d.ts`, `cli/audit/social.d.ts`, and `cli/navigator.d.ts`, eliminating monolithic type hazards.

## [2026-09-09]

### Added
- Edge-authenticated single-device project scaffolding command (`npx chemical-x init`) with machine fingerprinting and Cloudflare KV validation.
- AST hazard line budget audit command (`npx chemical-x audit`) scanning project trees for > 500 line monolith hazards.
- AST Context Hazard Audit engine module (`cli/audit.js`, `cli/audit.d.ts`) supporting 5 AST rules: line budget, hook saturation, control flow complexity, timer discipline, and type co-location.
- `./audit` subpath export in `package.json` for programmatic consumption by test suites and benchmarks.
- CLI flags `--json` and `--dir=<path>` for `npx chemx audit`.
- Automated NPM publish GitHub Actions workflow (`.github/workflows/publish.yml`) chained to `Auto Version` completion via `workflow_run`.

### Changed
- Upgraded `runAudit` in `cli/index.js` from basic line counting to full Babel AST static analysis engine.
- Updated default API endpoint in CLI (`cli/index.js`) to production custom domain `https://chemicalx.xophz.com`.
- Expanded `AGENTS.md` blueprint in CLI (`cli/index.js`) to include all 7 Quantum Engineering Architecture pillars.
- Configured npm package distribution for `@chemx/starter-kit` with `create-chemx`, `chemx`, `chem-x`, and `chemical-x` binary aliases.
- Added public publish configuration for `@chemx` scope and multi-target distribution (`create-chemx`, `@chemx/starter-kit`, `@chem-x/starter-kit`, `@chemx/create-chemx`, `@chem-x/create-chemx`, `chemx`, `chem-x`).
- Integrated Charm `gum` terminal UI styling with zero-dependency ANSI fallback across all interactive CLI workflows.
- Added cross-platform browser checkout launcher for `mycompassconsulting.com/buy/chemical-x/standard` and `master`.
- Unlocked `npx chemx audit` command as 100% free, unauthenticated, and ungated public utility with conversion CTAs.
- Added dual project scaffolder (`npm create chemx` / `create-chemx`) and in-repo capsule drop-in (`init`).
- Gated `runScaffold` (`npm create chemx`) with upfront license validation prior to project directory name prompt.
- Integrated interactive Gum CTA action buttons at the conclusion of public audit for default portal browsing (`chemicalx.xophz.com`), instant checkout launch ($27 eBook w/ AGENTS.md / $47 Master Bundle), and key-gated scaffolding for license holders.

### Fixed
- Removed embedded offline blueprint fallbacks and preview bypass keys from CLI executable (`cli/index.js`).
- Restricted npm package distribution via `files` whitelist and `.npmignore` to prevent leaking private blueprints and hooks in public tarballs.
- Added explicit `--tag` support and automatic default fallback for prerelease/CalVer versions in multi-target publisher (`scripts/publish-both.mjs`).
- Removed unscoped `chem-x` target from publisher script due to npm registry similarity protection with `chemx`.
- Excluded 3rd-party `vendor` and `build` directories, as well as minified bundles (`*.min.*`), from the AST context hazard audit to eliminate false positives on bundled external libraries.
- Fixed argument ordering in `gumChoose` to pass `--header` and styling flags to the `choose` subcommand rather than prepending to the parent binary.

## [2026-09-12]

### Added
- Pre-Split Pattern Discovery & Harmonization Protocol added to `AGENTS.md` (Section 1.F): mandates cross-file pattern discovery, design-system foundation mapping, and canonical extraction prior to code splitting monoliths.
- Updated AST audit refactoring prompt generators (`buildGradeFPrompt` and `buildHotspotsPrompt` in `cli/audit/prompts.js`) to enforce Pre-Split Pattern Discovery in generated AI directives.
- Structural Pattern Harmonization Detector module (`cli/audit/pattern-detector.js`): single-pass AST fingerprinting to detect cross-file clones (shared state machine unions, composite JSX layouts, multi-clause boolean predicates, parallel hook return signatures) without quadratic diffing overhead.
- Self-Healing Remediation Roadmap engine (`cli/audit/roadmap.js`): calculates optimal 5-phase refactoring sequence (Pattern Harvesting -> Domain Foundations -> Monolith Slicing -> Component Hygiene -> Automated Gatekeeping) so early canonical extractions compound and self-sustain subsequent monolith slicing.
- Integrated dedicated grade report card sections (`formatGradeASection`, `formatGradeBSection`, `formatGradeCSection`, `formatGradeDSection`, and `formatGradeFSection`) into the full terminal audit report (`formatTerminalReport` in `cli/audit/reporter.js`) with `{ includePrompt: false }` option.
- Permanent grade accessibility in Audit Navigator menu (`cli/navigator-actions.js`): eliminated `hasGradeItems` filtering so all grade tiers (Grade A, AI Slop, Grade B, Grade C, Grade D, and Grade F) remain visible and navigable at all times, matching the full report.
- Synchronized hazard counts in `buildActiveGrades` (`cli/navigator-actions.js`): included failed and warned pillars in Grade F and Grade D totals to match the grade report card totals.
- Automatic baseline floor calculation in `cli/audit/history.js`: resolved audit baseline to the lowest historical MHI score in `history.json`, ensuring before and after deltas accurately measure total debt reduction.
- Dual-delta progress display in `cli/navigator-actions.js` and `cli/audit/history.js`: `[ Progress ]` action shows cumulative transformation delta against baseline floor and incremental step delta against immediately preceding audit snapshot.
- Discussion thread living showcase architecture in `cli/audit/social-publisher.js` and `cli/navigator-share.js`: primary topic stays as the living showcase dashboard while subsequent audits post as checkpoint comments in the thread.
- 7-Pillar emoji reaction badges strip in terminal audit reports (`formatPillarReactionBadgesTerminal` in `cli/audit/reporter-utils.js` and `formatPillarsSection` in `cli/audit/reporter-sections.js`), prepending `[ <icon> ]` to matrix rows and rendering colored compact status reaction badges (`PASS`, `WARN`, `FAIL`).
- Markdown compliance matrix and GitHub Discussions integration (`formatPillarReactionBadgesMarkdown` in `cli/audit/reporter-utils.js`, `generateMarkdownReport` in `cli/audit/reporter-markdown.js`, `generateDiscussionContent` and `generateTransformationDiscussionContent` in `cli/audit/social.js`), embedding formatted reaction badge strips above compliance and progression tables in exports and checkpoint comments.
- Public API exports and typings for `formatPillarReactionBadgesTerminal` and `formatPillarReactionBadgesMarkdown` in `cli/audit/reporter.js`, `cli/audit/reporter.d.ts`, and `cli/audit.js`.
- Git Branching & Pull Request Workflow added to self-healing remediation roadmap (`buildRemediationRoadmap` and `buildSelfHealingRoadmapPrompt` in `cli/audit/roadmap.js`), hotspots refactoring prompt execution rules (`cli/audit/prompts.js`), and `AGENTS.md` (Section 1.G): instructs developers and agents to change to a dedicated branch prefixed with `chem-x/NAMEOFIMPROVEMENT` before modifying code, commit changes atomically on the branch, and create a Pull Request to `main`.
