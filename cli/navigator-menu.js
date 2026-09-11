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

const isChoiceMatchingItem = (cleanChoice) => (item) => {
  const prefix = `${item.index}.`;
  if (cleanChoice.startsWith(prefix) || cleanChoice === String(item.index)) return true;
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
  if (item.key === "progress" && cleanChoice.includes("Progress")) return true;
  if (
    item.key === "share" &&
    (cleanChoice.includes("Share") ||
      cleanChoice.includes("Discussions") ||
      cleanChoice.includes("Plug your"))
  ) {
    return true;
  }
  if (item.key === "export" && cleanChoice.includes("Export")) return true;
  if (
    item.key === "install" &&
    (cleanChoice.includes("Install") ||
      cleanChoice.includes("Pre-Commit") ||
      cleanChoice.includes("Workflow"))
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
  if (item.key === "share" && (effective === "share" || effective === "post")) return true;
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
