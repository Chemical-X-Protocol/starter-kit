import { spawnSync } from 'node:child_process';
import {
  hasGum,
  gumChoose,
  promptQuestion,
  openBrowser
} from './terminal.js';
import {
  URL_LEARN,
  URL_SPONSOR,
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
        '1. Sponsor on GitHub: $9/mo Solo / $49/mo Team Unlimited -> Launch Sponsors',
        '2. Buy Standard Vault: Single Dev License ($27) -> Launch Checkout',
        '3. Buy Team Power Puff: Unlimited Lifetime ($97) -> Launch Checkout',
        '4. Enter License Key to Scaffold (Sponsors & License Holders)',
        '5. Visit chemicalx.xophz.com to learn more',
        '6. Back to Navigator'
      ], 'Unlock Chemical X: Team Power Puff & Scaffolding:');

      if (choice.startsWith('1.')) {
        process.stdout.write(`\n\x1b[36mOpening GitHub Sponsors in browser:\x1b[0m ${URL_SPONSOR}\n\n`);
        openBrowser(URL_SPONSOR);
        continue;
      }
      if (choice.startsWith('2.')) {
        process.stdout.write(`\n\x1b[36mOpening Standard Vault checkout (Single Dev License):\x1b[0m ${URL_STANDARD}\n\n`);
        openBrowser(URL_STANDARD);
        continue;
      }
      if (choice.startsWith('3.')) {
        process.stdout.write(`\n\x1b[36mOpening Team Power Puff checkout (Unlimited Lifetime):\x1b[0m ${URL_MASTER}\n\n`);
        openBrowser(URL_MASTER);
        continue;
      }
      if (choice.startsWith('4.')) {
        if (onScaffold) await onScaffold();
        break;
      }
      if (choice.startsWith('5.')) {
        process.stdout.write(`\n\x1b[36mOpening Chemical X Portal in browser:\x1b[0m ${URL_LEARN}\n\n`);
        openBrowser(URL_LEARN);
        continue;
      }
      break;
    }

    process.stdout.write(
      '\n\x1b[1m\x1b[38;2;98;201;255mChemical X: The Secret Sauce to Vibe Coding\x1b[0m\n' +
      'Stop letting AI agents scour 2,000-line monoliths and hallucinate breaking changes.\n' +
      '25+ Years XP | Codified by Principal Systems Architect Xopher Pollard\n' +
      'Target File Budget: Max 500 lines/file (<100 lines per molecule capsule).\n\n'
    );
    process.stdout.write(`  [1] Sponsor on GitHub ($9/mo Solo / $49/mo Team Unlimited) - ${URL_SPONSOR}\n      Includes: Instant GitHub org access to private starter-kit, continuous model prompt updates\n`);
    process.stdout.write(`  [2] Buy Standard Vault: Single Dev License ($27) - ${URL_STANDARD}\n      Includes: Kindle/Print PDF eBook, 7 Molecular Architecture Chapters, Universal AGENTS.md\n`);
    process.stdout.write(`  [3] Buy Team Power Puff: Unlimited Lifetime ($97) - ${URL_MASTER}\n      Includes: Unlimited Team Seats, Private Starter-Kit Repo, Pre-Commit Line Budget Hooks, VIP Discord\n`);
    process.stdout.write('  [4] Enter License Key to Scaffold (Sponsors & License Holders)\n');
    process.stdout.write(`  [5] Visit chemicalx.xophz.com to learn more - ${URL_LEARN}\n`);
    process.stdout.write('  [6] Back to Navigator\n\n');

    const selection = await promptQuestion('Select option [1-6] (default: 6): ');
    const effectiveSelection = selection.trim() || '6';
    if (effectiveSelection === '1') {
      process.stdout.write(`\nOpening: ${URL_SPONSOR}\n\n`);
      openBrowser(URL_SPONSOR);
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
    if (effectiveSelection === '5') {
      process.stdout.write(`\nOpening: ${URL_LEARN}\n\n`);
      openBrowser(URL_LEARN);
      continue;
    }
    break;
  }
};
