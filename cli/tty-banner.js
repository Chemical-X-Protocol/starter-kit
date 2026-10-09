import { isStdoutTty } from './terminal.js';

// The core/studio seam (plan 5.4): banner.js (and gum) load only for a human terminal.
// Piped and --json runs never import it. Returns whether a banner was drawn.
export const renderTtyBanner = async (title) => {
  const isHumanTerminal = isStdoutTty();
  if (!isHumanTerminal) return false;
  const { renderBanner } = await import('./banner.js');
  renderBanner(title);
  return true;
};
