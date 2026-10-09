/**
 * Compact (single-file) capsule generation for `chemx generate --compact|--flat`.
 * Split from generator.js; the write goes through generator-writes.js so team locks are honoured.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveArchetype, buildCompactCapsule } from './generator-templates.js';
import { detectInstalledFamily } from './project-detector.js';
import { writeGeneratedFiles } from './generator-writes.js';

export const createCompactCapsule = ({ capsuleName, pascalName, capsuleDesc, explicitTemplate, selectedFramework, selectedTier, resolvedParent, cwd, dryRun, agentId }) => {
  const compFile = `${capsuleName}.${selectedFramework.ext}`;
  const targetFilePath = path.resolve(resolvedParent, compFile);

  const isTaken = !dryRun && fs.existsSync(targetFilePath);
  if (isTaken) {
    throw new Error(`File ${compFile} already exists at ${targetFilePath}.`);
  }

  const archetype = resolveArchetype(capsuleName, capsuleDesc, explicitTemplate);
  const installedFamily = detectInstalledFamily(cwd);
  const compactContent = buildCompactCapsule({
    capsuleName,
    pascalName,
    framework: selectedFramework.id,
    archetype,
    atomsPackage: installedFamily.atomsPackage
  });

  const filesCreated = [compFile];
  const previews = [{ file: compFile, lines: compactContent.split('\n').length }];

  const isWrite = !dryRun;
  if (isWrite) {
    writeGeneratedFiles({ dirs: [resolvedParent], files: [{ absPath: targetFilePath, content: compactContent }], cwd, agentId });
  }

  const relTargetDir = path.relative(cwd, targetFilePath);

  return {
    success: true,
    compact: true,
    dryRun: Boolean(dryRun),
    capsuleName,
    pascalName,
    framework: selectedFramework.id,
    tier: selectedTier.tier,
    targetDir: targetFilePath,
    relativeDir: relTargetDir,
    directory: relTargetDir,
    files: filesCreated,
    filesCreated,
    previews
  };
};
