import { createJigFiles, normalizeJigKind, JIG_KINDS } from './generator-jig.js';

export const handleJigCli = ({ rawArgs, positional, rawName, dirArg, descArg, isDryRun, isJson }) => {
  const jigFlag = (rawArgs.find((a) => a.startsWith('--jig=')) || '').split('=')[1];
  const kindFlag = (rawArgs.find((a) => a.startsWith('--kind=')) || '').split('=')[1];

  let resolvedKind = jigFlag || kindFlag;
  let resolvedName = rawName;

  if (!resolvedKind && positional[0] && JIG_KINDS.has(positional[0].toLowerCase())) {
    resolvedKind = positional[0].toLowerCase();
    resolvedName = positional[1] || rawName;
  } else if (positional[0] && positional[0].toLowerCase() === 'jig') {
    resolvedKind = positional[1];
    resolvedName = positional[2] || rawName;
  }
  resolvedKind = normalizeJigKind(resolvedKind || 'service');

  const methodsArg = (rawArgs.find((a) => a.startsWith('--methods=')) || '').replace(/^--methods=/, '');
  const stateArg = (rawArgs.find((a) => a.startsWith('--state=')) || '').replace(/^--state=/, '');
  const routesArg = (rawArgs.find((a) => a.startsWith('--routes=')) || '').replace(/^--routes=/, '');
  const presetArg = (rawArgs.find((a) => a.startsWith('--preset=')) || '').replace(/^--preset=/, '');
  const schemaArg = (rawArgs.find((a) => a.startsWith('--schema=')) || '').replace(/^--schema=/, '');

  let schemaData = {};
  if (schemaArg) {
    try {
      schemaData = JSON.parse(schemaArg);
    } catch {
      // ignore JSON parse error
    }
  }

  const jigRes = createJigFiles({
    kind: schemaData.kind || resolvedKind,
    name: schemaData.name || resolvedName || `sample-${resolvedKind}`,
    dir: dirArg,
    preset: presetArg,
    methods: schemaData.methods || methodsArg,
    state: schemaData.state || stateArg,
    routes: schemaData.routes || routesArg,
    desc: descArg || schemaData.desc,
    dryRun: isDryRun,
    cwd: process.cwd()
  });

  if (isJson) {
    process.stdout.write(JSON.stringify(jigRes) + '\n');
    return jigRes;
  }

  if (jigRes.dryRun) {
    process.stdout.write(`\n\x1b[1m\x1b[33m[DRY RUN]\x1b[0m Would generate programmatic jig (${jigRes.kind}) at \x1b[36m${jigRes.relativeDir}/\x1b[0m:\n`);
    for (const f of jigRes.previews || []) {
      process.stdout.write(`  \x1b[33m•\x1b[0m ${f.file} (${f.lines} lines)\n`);
    }
    process.stdout.write('\n\x1b[2mDry run complete. No files were written to disk.\x1b[0m\n\n');
    return jigRes;
  }

  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully generated programmatic jig (${jigRes.kind}):\x1b[0m \x1b[36m${jigRes.relativeDir}/\x1b[0m\n`);
  for (const f of jigRes.filesCreated) {
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${f}\n`);
  }
  process.stdout.write('\n\x1b[2mChemical X Standards verified: < 100 lines per file, Result tuples, co-located spec tests.\x1b[0m\n\n');
  return jigRes;
};
