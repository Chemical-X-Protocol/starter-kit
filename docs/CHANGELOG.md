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
