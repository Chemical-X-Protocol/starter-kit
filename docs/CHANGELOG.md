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
- Integrated interactive Gum CTA action buttons at the conclusion of public audit for instant checkout launch ($49 Standard / $99 Master) and key-gated scaffolding for license holders.

### Fixed
- Removed embedded offline blueprint fallbacks and preview bypass keys from CLI executable (`cli/index.js`).
- Restricted npm package distribution via `files` whitelist and `.npmignore` to prevent leaking private blueprints and hooks in public tarballs.
- Added explicit `--tag` support and automatic default fallback for prerelease/CalVer versions in multi-target publisher (`scripts/publish-both.mjs`).


