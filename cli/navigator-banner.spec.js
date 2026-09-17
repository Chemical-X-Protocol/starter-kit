import test from "node:test";
import assert from "node:assert";
import { visualWidth, truncatePath, resolveProjectName } from "./navigator-banner-helpers.js";
import { renderDashboardBanner } from "./navigator-banner.js";

test("visualWidth: calculates visual width ignoring ANSI codes", () => {
  const plain = "Hello";
  const colored = "\x1b[31mHello\x1b[0m";
  assert.strictEqual(visualWidth(plain), 5);
  assert.strictEqual(visualWidth(colored), 5);
});

test("truncatePath: truncates path exceeding maxLen", () => {
  const shortPath = "src/app.js";
  assert.strictEqual(truncatePath(shortPath, 20), shortPath);
  const longPath = "/really/deep/nested/folder/project/file.js";
  const truncated = truncatePath(longPath, 15);
  assert.strictEqual(truncated.length <= 15, true);
  assert.strictEqual(truncated.startsWith("…"), true);
});

test("resolveProjectName: returns non-empty project name", () => {
  const name = resolveProjectName();
  assert.strictEqual(typeof name, "string");
  assert.strictEqual(name.length > 0, true);
});

test("renderDashboardBanner: executes without ReferenceError", () => {
  const health = { grade: "A+", score: 98, label: "Healthy" };
  const metrics = { scannedFiles: 10, totalLoc: 500 };
  const violations = [];
  const critical = [];
  const highMediumCount = 0;
  const low = [];
  const contextAnalysis = {
    estimatedTokens: 1200,
    potentialSavingsPct: 15,
    excessCostPerPass: 0.002,
    monthlyWastePerDev: 0.8
  };
  const aiSlop = { score: 95, grade: "A" };

  let output = "";
  const originalWrite = process.stdout.write;
  try {
    process.stdout.write = (chunk) => {
      output += String(chunk);
      return true;
    };
    renderDashboardBanner(
      health,
      metrics,
      violations,
      critical,
      highMediumCount,
      low,
      contextAnalysis,
      aiSlop,
      { clear: false }
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.strictEqual(output.includes("FILES"), true);
  assert.strictEqual(output.includes("HEALTH"), true);
  assert.strictEqual(output.includes("Grade: A+"), true);
});
