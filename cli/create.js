#!/usr/bin/env node

import { runScaffold } from './scaffold.js';
import { runAudit } from './index.js';
import { sanitizeOutputStreams } from './terminal.js';
import { installGlobalErrorCatcher } from './errors/index.js';

sanitizeOutputStreams();
installGlobalErrorCatcher();

const rawArgs = process.argv.slice(2);
const nonFlagArgs = rawArgs.filter((arg) => !arg.startsWith('-'));
const dirArg = (nonFlagArgs[0] === 'create' || nonFlagArgs[0] === 'init' || nonFlagArgs[0] === 'scaffold')
  ? nonFlagArgs[1]
  : nonFlagArgs[0];

await runScaffold(dirArg, rawArgs, runAudit);
