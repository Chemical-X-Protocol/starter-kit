export const formatButtonTag = (label, color = "", width = 11) => {
  const totalPadding = Math.max(0, width - label.length);
  const leftPad = Math.floor(totalPadding / 2);
  const rightPad = totalPadding - leftPad;
  const inner = `${" ".repeat(leftPad)}${label}${" ".repeat(rightPad)}`;
  return color ? `${color}[${inner}]\x1b[0m` : `[${inner}]`;
};

const isNonEmptyGroup = (group) => group.length > 0;

export const buildNavigatorMenu = (topActions, activeGrades, midActions, bottomActions) => {
  const groups = [topActions, activeGrades, midActions, bottomActions].filter(isNonEmptyGroup);
  const menuItems = groups.flat();
  const menuOptions = [];
  let currentIndex = 1;
  const divider = "──────────────────────────────────────────────────────────────────────";

  groups.forEach((group, idx) => {
    for (const item of group) {
      item.index = currentIndex;
      const pad = String(currentIndex).padStart(2, " ");
      menuOptions.push(` ${pad}. ${item.tag} ${item.label}`);
      currentIndex++;
    }
    if (idx < groups.length - 1) {
      menuOptions.push(divider);
    }
  });

  return { menuItems, menuOptions };
};

const ROADMAP_KEYWORDS = ['Roadmap', 'Healing', 'Self-Healing'];
const RERUN_KEYWORDS = ['Re-Run', 'Rerun', 'Re-run', 'Re-Audit'];
const SHARE_KEYWORDS = ['Share', 'Discussions', 'Plug your'];

const isAnyKeywordPresent = (text, keywords) => keywords.some((kw) => text.includes(kw));

const isChoiceMatchingItem = (cleanChoice) => (item) => {
  const prefix = `${item.index}.`;
  if (cleanChoice.startsWith(prefix) || cleanChoice === String(item.index)) return true;
  if (
    item.key === "guide" &&
    (cleanChoice.includes("Why Chemical X") ||
      cleanChoice.includes("Guide") ||
      cleanChoice.includes("Quickstart") ||
      cleanChoice.includes("Token Gains"))
  ) {
    return true;
  }
  if (
    item.key === "exit" &&
    (cleanChoice.includes("Exit") || cleanChoice.toLowerCase() === "exit")
  ) {
    return true;
  }
  if (
    item.key === "prompt" &&
    (cleanChoice.includes("Prompt") || cleanChoice.includes("Clipboard"))
  ) {
    return true;
  }
  if (
    item.key === "report" &&
    (cleanChoice.includes("Report") || cleanChoice.includes("Full Report"))
  ) {
    return true;
  }
  if (item.key === "roadmap" && isAnyKeywordPresent(cleanChoice, ROADMAP_KEYWORDS)) {
    return true;
  }
  if (item.key === "rerun" && isAnyKeywordPresent(cleanChoice, RERUN_KEYWORDS)) {
    return true;
  }
  if (
    item.key === "hotspots" &&
    (cleanChoice.includes("Hotspots") || cleanChoice.includes("Monoliths"))
  ) {
    return true;
  }
  if (item.key === "progress" && cleanChoice.includes("Progress")) return true;
  if (item.key === "share" && isAnyKeywordPresent(cleanChoice, SHARE_KEYWORDS)) {
    return true;
  }
  if (item.key === "export" && cleanChoice.includes("Export")) return true;
  if (
    item.key === "badge" &&
    (cleanChoice.includes("Badge") || cleanChoice.includes("Footer Badge"))
  ) {
    return true;
  }
  if (
    item.key === "install" &&
    (cleanChoice.includes("Install") ||
      cleanChoice.includes("Pre-Commit") ||
      cleanChoice.includes("Workflow"))
  ) {
    return true;
  }
  if (
    item.key === "install_search" &&
    (cleanChoice.includes("Query Machine") ||
      cleanChoice.includes("pnpm q") ||
      cleanChoice.includes("Agent Query Tool"))
  ) {
    return true;
  }
  if (
    item.key === "upgrade" &&
    (cleanChoice.includes("Upgrade") ||
      cleanChoice.includes("Power Puff") ||
      cleanChoice.includes("Team Power Puff") ||
      cleanChoice.includes("Molecular Rules"))
  ) {
    return true;
  }
  if (
    item.key === "grade_slop" &&
    (cleanChoice.includes("Slop") || cleanChoice.includes("Authenticity") || cleanChoice.includes("ASI"))
  ) {
    return true;
  }
  if (item.name && cleanChoice.toLowerCase().includes(item.name.toLowerCase())) {
    return true;
  }
  if (item.shortName && cleanChoice.toLowerCase().includes(item.shortName.toLowerCase())) {
    return true;
  }
  if (
    item.grade &&
    (cleanChoice.toLowerCase().includes(`grade ${item.grade}`) ||
      cleanChoice.toLowerCase().includes(`grade: ${item.grade}`))
  ) {
    return true;
  }
  return false;
};

export const matchGumChoice = (cleanChoice, menuItems) => {
  const matcher = isChoiceMatchingItem(cleanChoice);
  return menuItems.find(matcher);
};

const isEffectiveMatchingItem = (effective, exitIndex) => (item) => {
  if (effective === String(item.index)) return true;
  if (
    item.key === "guide" &&
    (effective === "guide" ||
      effective === "quickstart" ||
      effective === "help" ||
      effective === "g" ||
      effective === "w" ||
      effective === "why")
  ) {
    return true;
  }
  if (item.key === "exit" && (effective === "exit" || effective === String(exitIndex))) {
    return true;
  }
  if (
    item.key === "prompt" &&
    (effective === "prompt" ||
      effective === "copy" ||
      effective === "c" ||
      effective === "clipboard")
  ) {
    return true;
  }
  if (
    item.key === "report" &&
    (effective === "report" || effective === "full report" || effective === "full")
  ) {
    return true;
  }
  if (
    item.key === "rerun" &&
    (effective === "rerun" ||
      effective === "re-run" ||
      effective === "r" ||
      effective === "reaudit")
  ) {
    return true;
  }
  if (item.key === "share" && (effective === "share" || effective === "post")) return true;
  if (
    item.key === "hotspots" &&
    (effective === "hotspots" || effective === "hotspot" || effective === "h" || effective === "monoliths")
  ) {
    return true;
  }
  if (
    item.key === "grade_slop" &&
    (effective === "slop" || effective === "asi" || effective === "authenticity")
  ) {
    return true;
  }
  if (item.key === "install_search" && (effective === "q" || effective === "query" || effective === "search")) {
    return true;
  }
  if (item.name && effective === item.name.toLowerCase()) return true;
  if (item.shortName && effective === item.shortName.toLowerCase()) return true;
  if (item.key && (effective === item.key.toLowerCase() || effective === item.key.replace(/^pillar_/, '').toLowerCase())) return true;
  if (item.key === effective) return true;
  if (item.grade && (effective === item.grade || effective === `grade ${item.grade}`)) {
    return true;
  }
  return false;
};

export const matchFallbackChoice = (effective, menuItems, exitIndex) => {
  const matcher = isEffectiveMatchingItem(effective, exitIndex);
  return menuItems.find(matcher);
};
