/**
 * Chemical X Protocol: Interactive Pillars Selection Wizard
 * Conscious opt-in for architectural standards and agent steering configuration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderBanner, hasGum, gumChoose, promptQuestion } from './terminal.js';
import { PILLARS, PILLAR_PRESETS, buildCustomAgentsMd, buildCustomCursorRules } from './pillars-schema.js';

export const runPillarsWizard = async (rawArgs = [], cwd = process.cwd()) => {
  const isJson = rawArgs.includes('--json');
  const isYes = rawArgs.includes('-y') || rawArgs.includes('--yes') || !process.stdin.isTTY;
  const isDryRun = rawArgs.includes('--dry-run') || rawArgs.includes('-n');

  if (!isJson) {
    renderBanner('Chemical X: Architectural Pillars Wizard');
  }

  const presetFlag = (rawArgs.find((a) => a.startsWith('--preset=')) || '').split('=')[1];
  let selectedPresetKey = presetFlag ? presetFlag.toLowerCase() : null;
  let selectedPillarIds = [];

  const useGum = hasGum();

  if (selectedPresetKey && PILLAR_PRESETS[selectedPresetKey]) {
    selectedPillarIds = [...PILLAR_PRESETS[selectedPresetKey].pillars];
  } else if (isYes) {
    selectedPresetKey = 'recommended';
    selectedPillarIds = [...PILLAR_PRESETS.recommended.pillars];
  } else {
    const choices = [
      '1. Recommended / Balanced (Line budgets, Tiers, TOC views, Composables, AST query)',
      '2. Strict Chemical X (All 7 Pillars + Verification-First)',
      '3. Custom Pillar Selection (Review & toggle each pillar)',
      '4. Minimal (Line budgets only, no agent steering)',
      '5. None (Skip - do not install AGENTS.md or .cursorrules)'
    ];

    const pick = useGum
      ? gumChoose(choices, 'Select Architectural Pillars Configuration')
      : await promptQuestion('Select Pillars: [1=Recommended, 2=Strict, 3=Custom, 4=Minimal, 5=None] (default: 1): ');

    if (pick && (pick.startsWith('2.') || pick === '2')) {
      selectedPresetKey = 'strict';
      selectedPillarIds = [...PILLAR_PRESETS.strict.pillars];
    } else if (pick && (pick.startsWith('3.') || pick === '3')) {
      selectedPresetKey = 'custom';
      for (const pillar of PILLARS) {
        const defaultChoice = PILLAR_PRESETS.recommended.pillars.includes(pillar.id) ? 'Y/n' : 'y/N';
        const isDefaultYes = defaultChoice === 'Y/n';
        const answer = await promptQuestion(`Enable ${pillar.title}? (${defaultChoice}): `);
        const isYesAnswer = answer ? answer.trim().toLowerCase().startsWith('y') : isDefaultYes;
        if (isYesAnswer) {
          selectedPillarIds.push(pillar.id);
        }
      }
    } else if (pick && (pick.startsWith('4.') || pick === '4')) {
      selectedPresetKey = 'minimal';
      selectedPillarIds = [...PILLAR_PRESETS.minimal.pillars];
    } else if (pick && (pick.startsWith('5.') || pick === '5')) {
      selectedPresetKey = 'none';
      selectedPillarIds = [];
    } else {
      selectedPresetKey = 'recommended';
      selectedPillarIds = [...PILLAR_PRESETS.recommended.pillars];
    }
  }

  // Build config object
  const pillarsConfig = {};
  for (const pillar of PILLARS) {
    pillarsConfig[pillar.key] = selectedPillarIds.includes(pillar.id);
  }

  const chemxDir = path.resolve(cwd, '.chemx');
  const configFile = path.join(chemxDir, 'config.json');
  let existingConfig = {};

  if (fs.existsSync(configFile)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    } catch {
      existingConfig = {};
    }
  }

  const updatedConfig = {
    ...existingConfig,
    pillars: pillarsConfig
  };

  const filesWritten = [];

  if (!isDryRun) {
    if (!fs.existsSync(chemxDir)) {
      fs.mkdirSync(chemxDir, { recursive: true });
    }
    fs.writeFileSync(configFile, JSON.stringify(updatedConfig, null, 2) + '\n', 'utf-8');
    filesWritten.push('.chemx/config.json');
  }

  // Generate AGENTS.md and .cursorrules if pillars selected
  if (selectedPillarIds.length > 0) {
    const agentsPath = path.resolve(cwd, 'AGENTS.md');
    const cursorRulesPath = path.resolve(cwd, '.cursorrules');

    const agentsMdContent = buildCustomAgentsMd(selectedPillarIds, {
      projectName: path.basename(path.resolve(cwd))
    });
    const cursorRulesContent = buildCustomCursorRules(selectedPillarIds);

    if (!isDryRun) {
      fs.writeFileSync(agentsPath, agentsMdContent, 'utf-8');
      fs.writeFileSync(cursorRulesPath, cursorRulesContent, 'utf-8');
      filesWritten.push('AGENTS.md', '.cursorrules');
    }
  }

  const result = {
    success: true,
    dryRun: isDryRun,
    preset: selectedPresetKey,
    selectedPillarIds,
    filesWritten,
    pillarsConfig
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }

  if (isDryRun) {
    process.stdout.write(`\n\x1b[1m\x1b[33m[DRY RUN]\x1b[0m Planned architectural pillars configuration (${selectedPresetKey}):\n`);
    for (const p of PILLARS) {
      const isEnabled = selectedPillarIds.includes(p.id);
      const icon = isEnabled ? '\x1b[32m✔\x1b[0m' : '\x1b[2m○\x1b[0m';
      process.stdout.write(`  ${icon} ${p.title}\n`);
    }
    process.stdout.write('\nNo changes were written to disk.\n\n');
    return result;
  }

  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Chemical X Architectural Pillars Configured (${selectedPresetKey}):\x1b[0m\n`);
  for (const p of PILLARS) {
    const isEnabled = selectedPillarIds.includes(p.id);
    const icon = isEnabled ? '\x1b[32m✔\x1b[0m' : '\x1b[2m○\x1b[0m';
    process.stdout.write(`  ${icon} ${p.title}\n`);
  }
  process.stdout.write('\nFiles updated:\n');
  for (const f of filesWritten) {
    process.stdout.write(`  \x1b[32m•\x1b[0m ${f}\n`);
  }
  process.stdout.write('\n\x1b[2mReview AGENTS.md and customize any directives to fit your team.\x1b[0m\n\n');

  return result;
};
