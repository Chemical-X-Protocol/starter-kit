export const formatButtonTag = (label, color = "", width = 11) => {
  const totalPadding = Math.max(0, width - label.length);
  const leftPad = Math.floor(totalPadding / 2);
  const rightPad = totalPadding - leftPad;
  const inner = `${" ".repeat(leftPad)}${label}${" ".repeat(rightPad)}`;
  return color ? `${color}[${inner}]\x1b[0m` : `[${inner}]`;
};

const isNonEmptyGroup = (group) => group.length > 0;

/**
 * Numbers every row 1..N across the given sections and puts one divider between sections.
 * Empty sections are dropped first, so a hidden section leaves no stray divider.
 */
export const buildNavigatorMenu = (...sections) => {
  const groups = sections.filter(isNonEmptyGroup);
  const menuItems = groups.flat();
  const menuOptions = [];
  let currentIndex = 1;
  const divider = "──────────────────────────────────────────────────────────────────────";
  const lastGroupIndex = groups.length - 1;

  groups.forEach((group, idx) => {
    for (const item of group) {
      item.index = currentIndex;
      const pad = String(currentIndex).padStart(2, " ");
      menuOptions.push(` ${pad}. ${item.tag} ${item.label}`);
      currentIndex++;
    }
    const hasGroupBelow = idx < lastGroupIndex;
    if (hasGroupBelow) {
      menuOptions.push(divider);
    }
  });

  return { menuItems, menuOptions };
};

const ROADMAP_KEYWORDS = ['Roadmap', 'Healing', 'Self-Healing'];
const RERUN_KEYWORDS = ['Re-Run', 'Rerun', 'Re-run', 'Re-Audit'];
const SHARE_KEYWORDS = ['Share', 'Discussions', 'Plug your'];

// Text a gum selection may contain that points at an action, by action key.
const GUM_KEYWORDS_BY_KEY = {
  guide: ['Why Chemical X', 'Guide', 'Quickstart', 'Token Gains'],
  exit: ['Exit'],
  prompt: ['Prompt', 'Clipboard'],
  report: ['Report', 'Full Report'],
  roadmap: ROADMAP_KEYWORDS,
  rerun: RERUN_KEYWORDS,
  hotspots: ['Hotspots', 'Monoliths'],
  progress: ['Progress'],
  share: SHARE_KEYWORDS,
  export: ['Export'],
  badge: ['Badge', 'Footer Badge'],
  install: ['Install', 'Guardrails', 'Pre-Commit', 'Workflow'],
  install_search: ['Query Index', 'Query Machine', 'chemx q', 'Agent Query Tool'],
  upgrade: ['Upgrade', 'Power Puff', 'Team Power Puff', 'Molecular Rules'],
  grade_slop: ['Slop', 'Authenticity', 'ASI']
};

// Words typed at the plain-terminal prompt that select an action, by action key.
const TYPED_ALIASES_BY_KEY = {
  guide: ['guide', 'quickstart', 'help', 'g', 'w', 'why'],
  exit: ['exit'],
  prompt: ['prompt', 'copy', 'c', 'clipboard'],
  report: ['report', 'full report', 'full'],
  rerun: ['rerun', 're-run', 'r', 'reaudit'],
  share: ['share', 'post'],
  hotspots: ['hotspots', 'hotspot', 'h', 'monoliths'],
  grade_slop: ['slop', 'asi', 'authenticity'],
  install_search: ['q', 'query', 'search']
};

const lookupByKey = (table, key) => (Object.hasOwn(table, key ?? '') ? table[key] : []);

const isAnyKeywordPresent = (text, keywords) => keywords.some((kw) => text.includes(kw));

const isGumIndexChoice = (cleanChoice) => (item) =>
  cleanChoice.startsWith(`${item.index}.`) || cleanChoice === String(item.index);

const isChoiceMatchingItem = (cleanChoice) => (item) => {
  const lowerChoice = cleanChoice.toLowerCase();
  const isKeywordMatch = isAnyKeywordPresent(cleanChoice, lookupByKey(GUM_KEYWORDS_BY_KEY, item.key));
  if (isKeywordMatch) return true;
  const isTypedExit = item.key === "exit" && lowerChoice === "exit";
  if (isTypedExit) return true;
  const isNameMatch = Boolean(item.name && lowerChoice.includes(item.name.toLowerCase()));
  if (isNameMatch) return true;
  const isShortNameMatch = Boolean(item.shortName && lowerChoice.includes(item.shortName.toLowerCase()));
  if (isShortNameMatch) return true;
  return Boolean(
    item.grade &&
      (lowerChoice.includes(`grade ${item.grade}`) || lowerChoice.includes(`grade: ${item.grade}`))
  );
};

/** A row's own number wins over keywords, so "5. Export ... Report" opens Export, not Full Report. */
export const matchGumChoice = (cleanChoice, menuItems) => {
  const indexMatch = menuItems.find(isGumIndexChoice(cleanChoice));
  return indexMatch || menuItems.find(isChoiceMatchingItem(cleanChoice));
};

const isTypedIndexChoice = (effective) => (item) => effective === String(item.index);

const isEffectiveMatchingItem = (effective, exitIndex) => (item) => {
  const isAliasMatch = lookupByKey(TYPED_ALIASES_BY_KEY, item.key).includes(effective);
  if (isAliasMatch) return true;
  const isDefaultExit = item.key === "exit" && effective === String(exitIndex);
  if (isDefaultExit) return true;
  const isNameMatch = Boolean(item.name && effective === item.name.toLowerCase());
  if (isNameMatch) return true;
  const isShortNameMatch = Boolean(item.shortName && effective === item.shortName.toLowerCase());
  if (isShortNameMatch) return true;
  const isKeyMatch = Boolean(
    item.key &&
      (effective === item.key.toLowerCase() || effective === item.key.replace(/^pillar_/, '').toLowerCase())
  );
  if (isKeyMatch) return true;
  return Boolean(item.grade && (effective === item.grade || effective === `grade ${item.grade}`));
};

/** A typed row number wins over aliases; aliases and names are tried only when no row has that number. */
export const matchFallbackChoice = (effective, menuItems, exitIndex) => {
  const indexMatch = menuItems.find(isTypedIndexChoice(effective));
  return indexMatch || menuItems.find(isEffectiveMatchingItem(effective, exitIndex));
};
