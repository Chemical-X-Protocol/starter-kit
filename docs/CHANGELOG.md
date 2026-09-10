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

## [2026-09-10]

### Added
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

### Changed
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
- Updated CLI dashboard upgrade action label and conversion menu to `💎 Unlock Full Molecular Rules & Scaffolding (Chemical X: Power Puff Edition)` with synchronized Power Puff Edition tier options ($47).
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


