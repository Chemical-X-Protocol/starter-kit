#!/usr/bin/env node
// Fast entry for Claude Code hooks: `node <kit>/cli/hooks/entry.js <hook>`. Same behaviour as
// `chemx hook <hook>` but skips the full CLI boot, since PreToolUse runs before every Bash call.

import { runHookCli } from './run-hook.js';

process.exitCode = await runHookCli(process.argv.slice(2));
