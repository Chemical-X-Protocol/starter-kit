import {
  hasGum,
  gumChoose,
  promptQuestion,
  stripAnsi,
  isStdoutTty
} from './terminal.js';
import { copyToClipboard } from './audit.js';

const PROMPT_MARKER = 'Copy and paste the block below directly into Cursor / Claude / Windsurf:';

export const extractPromptFromContent = (content) => {
  const hasPromptMarker = Boolean(content?.includes(PROMPT_MARKER));
  if (!hasPromptMarker) return null;
  const clean = stripAnsi(content);
  const markerIdx = clean.indexOf(PROMPT_MARKER);
  const isMarkerMissing = markerIdx === -1;
  if (isMarkerMissing) return null;

  const afterMarker = clean.slice(markerIdx + PROMPT_MARKER.length);
  const borderStartIdx = afterMarker.indexOf('├');
  const sliceFrom = borderStartIdx !== -1 ? afterMarker.slice(borderStartIdx) : afterMarker;

  const lines = sliceFrom.split('\n');
  const promptLines = [];
  let recording = false;

  for (const line of lines) {
    const isPromptStart = line.includes('├');
    if (isPromptStart) {
      recording = true;
      continue;
    }
    const isPromptEnd = line.includes('└');
    if (isPromptEnd) break;
    if (recording) {
      promptLines.push(line.replace(/^\s*│\s?/, ''));
    }
  }

  const result = promptLines.join('\n').trim();
  return result.length > 0 ? result : null;
};

export const showPagedContent = async (content, promptText = null) => {
  if (isStdoutTty()) console.clear();
  process.stdout.write(content + '\n\n');

  const effectivePrompt = (promptText && promptText.trim().length > 0)
    ? promptText.trim()
    : extractPromptFromContent(content);

  if (!effectivePrompt) {
    if (hasGum()) gumChoose(['<-- Back to Audit Dashboard']);
    else await promptQuestion('Press Enter to return to menu...');
    return;
  }

  while (true) {
    if (hasGum()) {
      const choice = gumChoose(['1. 📋 Copy AI Agent Prompt to Clipboard', '2. <-- Back to Audit Dashboard']);
      const isCopyChoice = Boolean(choice?.startsWith('1.'));
      if (isCopyChoice) {
        const success = copyToClipboard(effectivePrompt);
        if (success) {
          process.stdout.write('\n\x1b[1m\x1b[32m✔ AI Agent refactoring prompt copied to clipboard!\x1b[0m\n');
          process.stdout.write('\x1b[36mPaste directly into Cursor, Claude, or Windsurf to begin automated refactoring.\x1b[0m\n\n');
        } else {
          process.stdout.write('\n\x1b[33m⚠ Could not access system clipboard.\x1b[0m\n\n');
        }
        gumChoose(['<-- Back to Audit Dashboard']);
        break;
      }
      break;
    }

    process.stdout.write('\n\x1b[1mOptions:\x1b[0m\n  [c] 📋 Copy AI Agent Prompt to Clipboard\n  [Enter] <-- Back to Audit Dashboard\n');
    const input = await promptQuestion('Select option [Enter]: ');
    const isCopyTyped = input.trim().toLowerCase() === 'c';
    if (isCopyTyped) {
      const success = copyToClipboard(effectivePrompt);
      if (success) {
        process.stdout.write('\n\x1b[1m\x1b[32m✔ AI Agent refactoring prompt copied to clipboard!\x1b[0m\n');
        process.stdout.write('\x1b[36mPaste directly into Cursor, Claude, or Windsurf to begin automated refactoring.\x1b[0m\n\n');
      } else {
        process.stdout.write('\n\x1b[33m⚠ Could not access system clipboard.\x1b[0m\n\n');
      }
      await promptQuestion('Press Enter to return to Audit Dashboard...');
      break;
    }
    break;
  }
};
