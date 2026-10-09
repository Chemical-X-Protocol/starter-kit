import test from "node:test";
import assert from "node:assert";
import { planNavigatorSections } from "./navigator-sections.js";
import { buildNavigatorMenu, matchGumChoice, matchFallbackChoice } from "./navigator-menu.js";
import { buildDashboardActionGroups } from "./navigator-actions.js";

const noop = async () => {};
const row = (key) => ({ key, tag: `[${key}]`, label: key, action: noop });

const fakeActions = (overrides = {}) => ({
  guideAction: row("guide"),
  installAction: row("install"),
  installSearchAction: row("install_search"),
  roadmapAction: row("roadmap"),
  upgradeAction: row("upgrade"),
  reportAction: row("report"),
  rerunAction: row("rerun"),
  shareAction: row("share"),
  progressAction: row("progress"),
  exportAction: row("export"),
  badgeAction: row("badge"),
  hotspotsAction: row("hotspots"),
  copyPromptAction: row("prompt"),
  exitAction: row("exit"),
  hasHotspots: false,
  shouldShowPromptAction: false,
  ...overrides
});

const grade = (name, violations) => ({ ...row(`pillar_${name}`), name, violations, grade: violations > 0 ? "C" : "A+" });

const sectionKeys = (sections, id) => sections.find((s) => s.id === id).items.map((item) => item.key);

test("navigator sections: setup is empty when guardrails and the query index are installed", () => {
  const sections = planNavigatorSections({ actions: fakeActions(), grades: [], guardrailsInstalled: true, queryIndexInstalled: true });
  assert.deepStrictEqual(sectionKeys(sections, "setup"), []);
});

test("navigator sections: setup lists only the missing installs", () => {
  const onlyQuery = planNavigatorSections({ actions: fakeActions(), guardrailsInstalled: true, queryIndexInstalled: false });
  assert.deepStrictEqual(sectionKeys(onlyQuery, "setup"), ["install_search"]);
  const onlyGuardrails = planNavigatorSections({ actions: fakeActions(), guardrailsInstalled: false, queryIndexInstalled: true });
  assert.deepStrictEqual(sectionKeys(onlyGuardrails, "setup"), ["install"]);
  const both = planNavigatorSections({ actions: fakeActions() });
  assert.deepStrictEqual(sectionKeys(both, "setup"), ["install", "install_search"]);
});

test("navigator sections: sections run Fix, Grades, Setup, Track, then general", () => {
  const sections = planNavigatorSections({ actions: fakeActions() });
  assert.deepStrictEqual(sections.map((s) => s.id), ["fix", "grades", "setup", "track", "general"]);
  assert.deepStrictEqual(sectionKeys(sections, "track"), ["progress", "export", "badge", "share"]);
  assert.deepStrictEqual(sectionKeys(sections, "general"), ["guide", "upgrade", "rerun", "exit"]);
});

test("navigator sections: every pillar keeps its own row, clean ones included, in the given order", () => {
  const grades = [grade("Tiers", 4), grade("Views", 0), grade("Budgets", 1), grade("Contracts", 0)];
  const sections = planNavigatorSections({ actions: fakeActions(), grades });
  assert.deepStrictEqual(sectionKeys(sections, "grades"), ["pillar_Tiers", "pillar_Views", "pillar_Budgets", "pillar_Contracts"]);
});

test("navigator sections: Copy Prompt and Hotspots appear in Fix only when available", () => {
  const without = planNavigatorSections({ actions: fakeActions() });
  assert.deepStrictEqual(sectionKeys(without, "fix"), ["roadmap", "report"]);
  const withBoth = planNavigatorSections({ actions: fakeActions({ shouldShowPromptAction: true, hasHotspots: true }) });
  assert.deepStrictEqual(sectionKeys(withBoth, "fix"), ["roadmap", "prompt", "hotspots", "report"]);
});

test("navigator menu: empty sections leave no stray separators and rows number from 1", () => {
  const sections = planNavigatorSections({ actions: fakeActions(), grades: [], guardrailsInstalled: true, queryIndexInstalled: true });
  const { menuItems, menuOptions } = buildNavigatorMenu(...sections.map((s) => s.items));
  const dividers = menuOptions.filter((line) => line.includes("───"));
  assert.strictEqual(dividers.length, 2, "fix, track and general remain: two dividers");
  assert.ok(!menuOptions[0].includes("───"));
  assert.ok(!menuOptions[menuOptions.length - 1].includes("───"));
  assert.deepStrictEqual(menuItems.map((item) => item.index), menuItems.map((_, i) => i + 1));
});

test("navigator actions: no menu label uses Step numbering or the old pnpm q command", () => {
  const report = { health: { grade: "B", score: 80 }, metrics: {}, pillars: {}, violations: [], hotspots: [] };
  const actions = buildDashboardActionGroups({ report });
  const sections = planNavigatorSections({ actions, grades: [] });
  const labels = sections.flatMap((s) => s.items.map((item) => item.label));
  assert.ok(labels.length > 0);
  for (const label of labels) {
    assert.ok(!/Step\s*\d/.test(label), `label uses Step numbering: ${label}`);
    assert.ok(!label.includes("pnpm q"), `label names pnpm q: ${label}`);
  }
  assert.ok(actions.installSearchAction.label.includes("chemx q"));
});

test("navigator menu: a selected row number wins over another row's keyword", () => {
  const report = { ...row("report"), label: "Show Full Report" };
  const exportRow = { ...row("export"), label: "Export Markdown Report to File" };
  const { menuItems } = buildNavigatorMenu([report], [exportRow]);
  assert.strictEqual(matchGumChoice("2. [export] Export Markdown Report to File", menuItems).key, "export");
  assert.strictEqual(matchGumChoice("Full Report", menuItems).key, "report");
  assert.strictEqual(matchFallbackChoice("2", menuItems, 2).key, "export");
  assert.strictEqual(matchFallbackChoice("report", menuItems, 2).key, "report");
});
