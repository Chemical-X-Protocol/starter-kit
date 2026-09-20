# Original User Request

## Initial Request - 2026-09-20T04:40:15Z

Direct in-place update and upgrade of the current Chemical X (`chemx`) UI located in `src/ui/` and `cli/ui-*.js` into an authentic early-2000s community hub and interactive command center, styled after classic vBulletin 3.x and phpBB forums, featuring agent profile directories, visual Asana-style task boards, and deep financial token telemetry.

Working directory: /home/xopher/www/x/Xophz-COMPASS/apps/chemical-x/starter-kit
Integrity mode: benchmark

## Requirements

### R1. Authentic Early-2000s Forum & Community Hub Aesthetics
- Directly update the existing Chemical X UI in `src/ui/` and `cli/ui-*.js` to an authentic vBulletin 3.x / phpBB forum layout with beveled category headers, table grids, gradient borders, user title flair, member ranks, pixel indicators, and avatar signature strips.
- Maintain strict compliance with Chemical X Molecular Architecture directives (zero raw DOM elements outside foundational atoms, strict 100-line maximum per capsule file).
- Include standard forum categories: Announcements, Active Swarm Directives, War Room, Lock Registry, and General Chat.

### R2. Agent Profile Directory & Identity System
- Provide dedicated agent profile pages displaying swarm role, operational status (idle, busy, offline), model badge, current task assignment, file lock leases, post count, and customizable signature blocks.
- Render author info cards alongside all forum posts and task logs containing avatar, join date, member tier, and model architecture.

### R3. Interactive Command Center & Visual Task Board
- Build a visual Kanban task board integrated into the forum hub with columns: Queued, In Progress, Review, Completed, and Blocked.
- Allow full human-in-the-loop interactivity: creating new tasks, reassigning agents, changing task states, overriding file locks, and submitting forum broadcasts directly from the UI.
- Back all mutations directly through `.chemx/index.db` SQLite tables (`agent_tasks`, `agent_feed`, `file_lock_queue`).

### R4. Deep Financial Telemetry & Token Analytics Engine
- Provide a central token scoreboard displaying total prompt tokens, completion tokens, cached tokens, cache-hit ratios, and real-time USD expenditure.
- Display contextual token stamps on individual forum posts and task cards indicating the exact token burn and micro-USD cost incurred for that specific operation.
- Implement model-specific pricing rate cards for accurate cost derivation across frontier and local models.

### R5. Chemical X Master Tool & Agent Social Feed Integration
- Integrate all Chemical X agent tools (`audit`, `test`, `build`, `verify`, `patch`, `write`, `read`) with the swarm social feed so tool executions automatically log activity and token burn to `.chemx/index.db`.
- Provide live or periodic polling in the UI to stream agent feed updates, task state transitions, and file lock releases without requiring full page reloads.

## Follow-up - 2026-09-20T04:43:29Z

SCOPE EXPANSION FROM USER:
The user has added three critical feature requirements to the ongoing Chemical X Community Hub project:

1. Codebase File Tree Explorer (R6):
- Interactive file structure tree view displaying project hierarchy with collapsible folder nodes.
- Metadata badges on files (line count, architecture tier [atom/molecule/organism], health score, hazard tags).
- Selecting files views symbols, imports, and connections.

2. AI Refactoring Prompt Workbench (R7):
- Dedicated workbench view to test, preview, and generate AI refactoring prompts directly from audit violations.
- Scope selector (Master, Grade F, Grade D, Grade C, Grade B, AI Slop, Hotspots) backed by cli/audit/prompts.js.
- 1-click clipboard copy button and token preview for the generated refactoring prompts.

3. phpMyAdmin-Style Database Studio (R8):
- Retro phpMyAdmin 2.x style database studio interface for exploring .chemx/index.db.
- Left-hand sidebar listing all database tables (files, symbols, props, hooks, imports, violations, audit_snapshots, agent_tasks, agent_feed, file_lock_queue) with record counts.
- Top tab navigation: Browse, Structure, SQL, Search, Insert, Operations.
- Browse tab displaying paginated records with inline row action icons.
- SQL tab with query execution textarea allowing custom SELECT statements against SQLite.
