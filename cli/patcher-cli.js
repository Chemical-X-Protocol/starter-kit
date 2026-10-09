/**
 * CLI runners for `chemx patch` and `chemx write`. Both preview with --dry-run (printing the
 * full unified diff) and refuse rather than guess: a missing --content never becomes '' and an
 * unknown flag refuses instead of being ignored.
 */
import fs from 'node:fs';
import { ANSI } from './theme.js';
import { isStdinTty } from './terminal.js';
import { parseValueFlags, hasFlag, splitList, hasPreviewFlag, findUnknownFlags, unknownFlagsMessage } from './cli-args.js';
import { patchFile } from './patcher.js';
import { writeOrAppend } from './write-append.js';
import { parseSearchReplaceBlocks } from './search-replace-blocks.js';

const PATCH_HELP = [
  'USAGE',
  "  chemx patch <file> [options] <<'EOF'",
  '  <<<<<<< SEARCH',
  '  exact old text (any number of lines; quotes, $ and backticks are literal)',
  '  =======',
  '  new text (empty deletes the SEARCH lines)',
  '  >>>>>>> REPLACE',
  '  EOF',
  '  chemx patch <file> --target="text" --replacement="new" [options]',
  '',
  '  Markers sit at column 0 inside the heredoc; repeat the block for more edits. Blocks apply',
  '  in order and all-or-nothing: one unmatched block fails the call and writes nothing.',
  '',
  'OPTIONS',
  '  --target=<text>          Exact text to replace (literal; never empty)',
  '  --replacement=<new>      Replacement text (literal; `$` is not special)',
  '  --target-file=<path>     Read the target from a file',
  '  --replacement-file=<p>   Read the replacement from a file',
  '  --multiple               Replace every occurrence',
  '  --allow-remove=<a,b>     Top-level declarations the patch may remove',
  '  --as=<agent>             Agent id for team lock checks (default $CHEMX_AGENT_ID, else unique to this process)',
  '  -n, --dry-run            Print the unified diff without writing (--dryRun, --dry-run=<any> too)',
  '  --json                   Output result as JSON',
  '  -h, --help               Show this help message',
  ''
];

const WRITE_HELP = [
  'USAGE',
  "  chemx write <file> - [options] <<'EOF'",
  '  whole file content',
  '  EOF',
  '  chemx write <file> --content="text" [options]',
  '',
  'OPTIONS',
  '  -, --stdin               Read content from stdin (heredoc)',
  '  --content=<text>         File content (also: --content <text>)',
  '  --content-file=<path>    Read content from a file',
  '  --overwrite              Allow replacing an existing file',
  '  --append                 Add the content to the end of the file (created if missing); same checks as a write; not with --overwrite',
  '  --allow-remove=<a,b>     Top-level declarations an overwrite may remove',
  '  --as=<agent>             Agent id for team lock checks',
  '  -n, --dry-run            Print the unified diff without writing (--dryRun, --dry-run=<any> too)',
  '  --json                   Output result as JSON',
  '  -h, --help               Show this help message',
  ''
];

const isHelpRequest = (args) => hasFlag(args, ['--help', '-h', 'help']);

const showHelp = (args, lines, isCli) => {
  const isJson = args.includes('--json');
  process.stdout.write(isJson ? `${JSON.stringify({ help: true, success: true })}\n` : lines.join('\n'));
  if (isCli) process.exit(0);
  return { help: true, success: true };
};

const fail = (message, isCli) => {
  process.stderr.write(`${ANSI.RED}✕ ${message}${ANSI.RESET}\n`);
  if (isCli) process.exit(1);
  return null;
};

const fromFileOr = (inline, filePath) => (filePath ? fs.readFileSync(filePath, 'utf-8') : inline);

const printDeclarations = (res) => {
  const removed = res.declarations?.removed || [];
  const added = res.declarations?.added || [];
  const hasDeclarationChange = removed.length > 0 || added.length > 0;
  if (hasDeclarationChange) {
    process.stdout.write(`  Declarations: removed [${removed.join(', ')}], added [${added.join(', ')}]\n`);
  }
};

const printParseNote = (res) => {
  const note = res.parse?.note;
  const hasNote = Boolean(note);
  if (hasNote) process.stdout.write(`  ${ANSI.GOLD}⚠ Parse: ${note}${ANSI.RESET}\n`);
};

const printOutcome = (res, verb, isJson) => {
  if (isJson) {
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return;
  }
  const isPreview = Boolean(res.dryRun);
  if (isPreview) {
    process.stdout.write(`${ANSI.GOLD}[DRY RUN] Would ${verb} ${res.file}. No changes were written to disk.${ANSI.RESET}\n`);
    process.stdout.write(`${res.diff || '(no change)'}\n`);
    printDeclarations(res);
    printParseNote(res);
    return;
  }
  const range = res.changedLines ? `L${res.changedLines.start}-${res.changedLines.end}` : '';
  const isMultiBlock = res.blocks > 1;
  const where = isMultiBlock ? ` (${res.blocks} blocks, first at ${range})` : (range && `:${range}`);
  const writeVerb = res.created ? 'Created' : 'Updated';
  const doneVerb = verb === 'patch' ? 'Patched' : writeVerb;
  process.stdout.write(`${ANSI.GREEN}✔ ${doneVerb} ${res.file}${where}${res.backup ? ` (backup: ${res.backup})` : ''}${ANSI.RESET}\n`);
  (res.leaseNotes ?? []).forEach((note) => process.stdout.write(`  ${ANSI.GOLD}⚠ ${note}${ANSI.RESET}\n`));
  const isOverBudget = Boolean(res.lineBudget) && !res.lineBudget.passed;
  if (isOverBudget) {
    process.stdout.write(`  ${ANSI.RED}⚠ Line Budget: ${res.lineBudget.lines}L exceeds ${res.lineBudget.limit}L limit (Directive 1.A)${ANSI.RESET}\n`);
  }
  printDeclarations(res);
  printParseNote(res);
  const introduced = res.introducedViolations || [];
  const preExisting = res.preExistingViolations || [];
  const hasIntroduced = introduced.length > 0;
  if (hasIntroduced) {
    process.stdout.write(`  ${ANSI.RED}⚠ ${introduced.length} introduced architecture hazard(s):${ANSI.RESET}\n`);
    for (const h of introduced) {
      process.stdout.write(`    [${h.severity}] line ${h.line}: ${h.hazard}\n`);
    }
  }
  const hasPreExisting = preExisting.length > 0;
  if (hasPreExisting) {
    process.stdout.write(`  ${ANSI.DIM}  (${preExisting.length} pre-existing hazard(s))${ANSI.RESET}\n`);
  }
  const hasNoIntroduced = introduced.length === 0;
  const hasNoPreExisting = preExisting.length === 0;
  const hasNeither = hasNoIntroduced && hasNoPreExisting;
  if (hasNeither) {
    const hasViolations = res.violationsCount > 0;
    if (hasViolations) {
      process.stdout.write(`  ${ANSI.GOLD}⚠ ${res.violationsCount} architecture hazard(s) detected (Run chemx check ${res.file})${ANSI.RESET}\n`);
    }
  }
};

const runGuarded = (action, verb, isJson, isCli) => {
  try {
    const res = action();
    printOutcome(res, verb, isJson);
    if (isCli) process.exit(0);
    return res;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), isCli);
  }
};

const PATCH_FLAGS = {
  target: ['--target'], replacement: ['--replacement', '--replace'],
  targetFile: ['--target-file'], replacementFile: ['--replacement-file'],
  allowRemove: ['--allow-remove'], as: ['--as']
};
const PATCH_SWITCHES = ['--multiple', '--allow-multiple'];
const NO_PATCH_INPUT = `chemx patch needs SEARCH/REPLACE blocks on stdin (chemx patch <file> <<'EOF' ... EOF) or --target/--replacement. Nothing was changed.`;

// An interactive terminal never counts as input: refusing beats blocking on, or writing, nothing.
const readStdin = () => (isStdinTty() ? null : fs.readFileSync(0, 'utf-8'));

const readStdinBlocks = () => {
  const text = readStdin() ?? '';
  const isEmpty = text.trim() === '';
  if (isEmpty) throw new Error(NO_PATCH_INPUT);
  return parseSearchReplaceBlocks(text);
};

export const runPatcherCli = (args, isCli = false) => {
  if (isHelpRequest(args)) return showHelp(args, PATCH_HELP, isCli);
  const unknown = findUnknownFlags(args, [...Object.values(PATCH_FLAGS).flat(), ...PATCH_SWITCHES]);
  const hasUnknownFlags = unknown.length > 0;
  if (hasUnknownFlags) return fail(unknownFlagsMessage('patch', unknown), isCli);
  const { values, positionals } = parseValueFlags(args, PATCH_FLAGS);
  const filePath = positionals[0];
  const hasFilePath = Boolean(filePath);
  if (!hasFilePath) return fail('Missing file path. Usage: chemx patch <file> --target="text" --replacement="new" [--json]', isCli);

  const hasInlineTarget = values.target !== undefined || values.targetFile !== undefined;
  return runGuarded(() => patchFile(filePath, {
    blocks: hasInlineTarget ? undefined : readStdinBlocks(),
    targetContent: fromFileOr(values.target ?? null, values.targetFile),
    replacementContent: fromFileOr(values.replacement ?? null, values.replacementFile),
    allowMultiple: hasFlag(args, PATCH_SWITCHES),
    dryRun: hasPreviewFlag(args),
    allowRemoved: splitList(values.allowRemove),
    agentId: values.as
  }), 'patch', args.includes('--json'), isCli);
};

const WRITE_FLAGS = { content: ['--content'], contentFile: ['--content-file'], allowRemove: ['--allow-remove'], as: ['--as'] };
const WRITE_SWITCHES = ['--stdin', '--overwrite', '--append'];
const MISSING_CONTENT = 'chemx write needs --content=<text>, --content-file=<path> or --stdin (a value starting with "-" needs the --content=<text> form). Refusing to write.';

const readWriteContent = (args, values) => {
  const isStdin = args.includes('--stdin') || args.includes('-');
  const content = isStdin ? readStdin() : fromFileOr(values.content, values.contentFile);
  const isMissingContent = typeof content !== 'string';
  if (isMissingContent) throw new Error(MISSING_CONTENT);
  return content;
};

export const runWriterCli = (args, isCli = false) => {
  if (isHelpRequest(args)) return showHelp(args, WRITE_HELP, isCli);
  const unknown = findUnknownFlags(args, [...Object.values(WRITE_FLAGS).flat(), ...WRITE_SWITCHES]);
  const hasUnknownFlags = unknown.length > 0;
  if (hasUnknownFlags) return fail(unknownFlagsMessage('write', unknown), isCli);
  const { values, positionals } = parseValueFlags(args, WRITE_FLAGS);
  const filePath = positionals[0];
  const hasFilePath = Boolean(filePath);
  if (!hasFilePath) return fail('Missing file path. Usage: chemx write <file> --content="text" [--json]', isCli);

  return runGuarded(() => writeOrAppend(filePath, {
    content: readWriteContent(args, values),
    overwrite: args.includes('--overwrite'),
    append: args.includes('--append'),
    dryRun: hasPreviewFlag(args),
    allowRemoved: splitList(values.allowRemove),
    agentId: values.as
  }), 'write', args.includes('--json'), isCli);
};
