import { requestFileLock, releaseFileLock } from './team-db.js';
import { formatLockHelpCard } from './team-format.js';

export const handleLockCommand = (db, nonFlagPositional, flags, isCli) => {
  const isLockHelp = flags.help || nonFlagPositional.includes('--help') || nonFlagPositional.includes('-h') || nonFlagPositional.includes('help');
  if (isLockHelp) {
    if (isCli) process.stdout.write(formatLockHelpCard());
    return { help: true, actions: ['acquire', 'release'] };
  }

  let action = 'acquire';
  let file = nonFlagPositional[0];
  if (file === 'acquire') {
    action = 'acquire';
    file = nonFlagPositional[1];
  } else if (file === 'release' || file === 'unlock') {
    action = 'release';
    file = nonFlagPositional[1];
  }

  if (!file) {
    if (isCli) process.stderr.write('\x1b[31m✕ File path required: chemx team lock [acquire|release] <filePath>\x1b[0m\n');
    return { error: 'filePath required' };
  }

  if (action === 'release') {
    return handleUnlockCommand(db, [file], flags, isCli);
  }

  const res = requestFileLock(db, file, flags.as || '@agent', {
    purpose: flags.purpose,
    priority: flags.priority,
    pid: flags.pid ? Number(flags.pid) : 0
  });

  if (isCli) {
    if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else if (res.granted) process.stdout.write(`\x1b[32m✔\x1b[0m Acquired lock on ${file}\n`);
    else process.stdout.write(`\x1b[33m⏳\x1b[0m Enqueued in FIFO lock queue at position ${res.position} (held by ${res.currentHolder})\n`);
  }
  return res;
};

export const handleUnlockCommand = (db, nonFlagPositional, flags, isCli) => {
  const isUnlockHelp = flags.help || nonFlagPositional.includes('--help') || nonFlagPositional.includes('-h') || nonFlagPositional.includes('help');
  if (isUnlockHelp) {
    if (isCli) process.stdout.write(formatLockHelpCard());
    return { help: true, actions: ['release'] };
  }

  const file = nonFlagPositional[0];
  if (!file) {
    if (isCli) process.stderr.write('\x1b[31m✕ File path required: chemx team unlock <filePath>\x1b[0m\n');
    return { error: 'filePath required' };
  }

  const res = releaseFileLock(db, file, flags.as || '@agent');
  if (isCli) {
    if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else if (res.success) process.stdout.write(`\x1b[32m✔\x1b[0m Released lock on ${file}\n`);
    else process.stderr.write(`\x1b[31m✕ Unlock failed: ${res.reason}\x1b[0m\n`);
  }
  return res;
};
