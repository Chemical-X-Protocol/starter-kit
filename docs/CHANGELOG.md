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

### Changed
- Updated default API endpoint in CLI (`cli/index.js`) to production custom domain `https://chemicalx.xophz.com`.
- Expanded `AGENTS.md` blueprint in CLI (`cli/index.js`) to include all 7 Quantum Engineering Architecture pillars.
- Configured npm package distribution for `@chemx/starter-kit` with `create-chemx`, `chemx`, `chem-x`, and `chemical-x` binary aliases.
- Added public publish configuration for `@chemx` scope and multi-target distribution (`create-chemx`, `@chemx/starter-kit`, `@chem-x/starter-kit`, `@chemx/create-chemx`, `@chem-x/create-chemx`, `chemx`, `chem-x`).
- Integrated Charm `gum` terminal UI styling with zero-dependency ANSI fallback across all interactive CLI workflows.
- Added cross-platform browser checkout launcher for `mycompassconsulting.com/buy/chemical-x/standard` and `master`.
- Unlocked `npx chemx audit` command as 100% free, unauthenticated, and ungated public utility with conversion CTAs.
- Added dual project scaffolder (`npm create chemx` / `create-chemx`) and in-repo capsule drop-in (`init`).

### Fixed
- Removed embedded offline blueprint fallbacks and preview bypass keys from CLI executable (`cli/index.js`).
- Restricted npm package distribution via `files` whitelist and `.npmignore` to prevent leaking private blueprints and hooks in public tarballs.

