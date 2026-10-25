// Pieces the three team help cards (team, team task, team lock) share. Assembled by cli/team/team-format.js.
export const RULE = `\x1b[90m${'─'.repeat(58)}\x1b[0m`;

/** The last element of a card: the closing rule and the blank line after it. */
export const END_OF_CARD = `${RULE}\n`;

export const sectionTitle = (name) => `  \x1b[1m${name}:\x1b[0m`;
