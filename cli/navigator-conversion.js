import { spawnSync } from 'node:child_process';
import {
  hasGum,
  gumChoose,
  promptQuestion,
  openBrowser
} from './terminal.js';
import {
  URL_LEARN,
  URL_STANDARD,
  URL_MASTER
} from './license.js';

export const showConversionMenu = async (onScaffold = null) => {
  while (true) {
    if (hasGum()) {
      spawnSync('gum', [
        'style', '--border=rounded', '--border-foreground=81', '--padding=0 1', '--bold',
        'Chemical X: The Secret Sauce to Vibe Coding\nStop letting AI agents scour 2,000-line monoliths and hallucinate.\n25+ Years XP | Codified by Principal Systems Architect Xopher Pollard\nTarget File Budget: Max 500 lines/file (<100 lines/molecule) | 85% Token Burn Cut'
      ], { stdio: 'inherit' });

      const choice = gumChoose([
        '1. Visit chemicalx.xophz.com to learn more',
        '2. Buy eBook w/ AGENTS.md Rule Book ($27) -> Launch Checkout',
        '3. Buy Power Puff Edition ($47) -> Launch Checkout',
        '4. Enter License Key to Scaffold (Power Puff License Holders)',
        '5. Back to Navigator'
      ], 'Unlock Chemical X: Power Puff Edition & Scaffolding:');

      if (choice.startsWith('1.')) {
        process.stdout.write(`\n\x1b[36mOpening Chemical X Portal in browser:\x1b[0m ${URL_LEARN}\n\n`);
        openBrowser(URL_LEARN);
        continue;
      }
      if (choice.startsWith('2.')) {
        process.stdout.write(`\n\x1b[36mOpening Standard Vault checkout (eBook + AGENTS.md):\x1b[0m ${URL_STANDARD}\n\n`);
        openBrowser(URL_STANDARD);
        continue;
      }
      if (choice.startsWith('3.')) {
        process.stdout.write(`\n\x1b[36mOpening Power Puff Edition checkout (Repo + Hooks + Prompts):\x1b[0m ${URL_MASTER}\n\n`);
        openBrowser(URL_MASTER);
        continue;
      }
      if (choice.startsWith('4.')) {
        if (onScaffold) await onScaffold();
        break;
      }
      break;
    }

    process.stdout.write(
      '\n\x1b[1m\x1b[38;2;98;201;255mChemical X: The Secret Sauce to Vibe Coding\x1b[0m\n' +
      'Stop letting AI agents scour 2,000-line monoliths and hallucinate breaking changes.\n' +
      '25+ Years XP | Codified by Principal Systems Architect Xopher Pollard\n' +
      'Target File Budget: Max 500 lines/file (<100 lines per molecule capsule).\n\n'
    );
    process.stdout.write(`  [1] Visit chemicalx.xophz.com to learn more\n`);
    process.stdout.write(`  [2] Buy eBook w/ AGENTS.md Rule Book ($27) - ${URL_STANDARD}\n      Includes: Kindle/Print PDF eBook, 7 Molecular Architecture Chapters, Universal AGENTS.md & .cursorrules\n`);
    process.stdout.write(`  [3] Buy Power Puff Edition ($47) - ${URL_MASTER}\n      Includes: Private Starter-Kit Repo, Pre-Commit Line Budget Hooks, 10x Prompts, VIP Discord\n`);
    process.stdout.write('  [4] Enter License Key to Scaffold (Power Puff License Holders)\n');
    process.stdout.write('  [5] Back to Navigator\n\n');

    const selection = await promptQuestion('Select option [1-5] (default: 5): ');
    const effectiveSelection = selection.trim() || '5';
    if (effectiveSelection === '1') {
      process.stdout.write(`\nOpening: ${URL_LEARN}\n\n`);
      openBrowser(URL_LEARN);
      continue;
    }
    if (effectiveSelection === '2') {
      process.stdout.write(`\nOpening: ${URL_STANDARD}\n\n`);
      openBrowser(URL_STANDARD);
      continue;
    }
    if (effectiveSelection === '3') {
      process.stdout.write(`\nOpening: ${URL_MASTER}\n\n`);
      openBrowser(URL_MASTER);
      continue;
    }
    if (effectiveSelection === '4') {
      if (onScaffold) await onScaffold();
      break;
    }
    break;
  }
};
