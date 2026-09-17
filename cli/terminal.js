import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { formatChemicalXGradient, ANSI } from "./theme.js";

export const openBrowser = (url) => {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      spawnSync("open", [url], { stdio: "ignore", timeout: 3000 });
    } else if (platform === "win32") {
      spawnSync("cmd.exe", ["/c", "start", '""', url], { stdio: "ignore", timeout: 3000 });
    } else {
      spawnSync("xdg-open", [url], { stdio: "ignore", timeout: 3000 });
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(`Failed to open browser: ${error.message}\n`);
  }
};

export const hasGum = () => {
  if (process.stdout && process.stdout.isTTY === false) return false;
  if (process.stdin && process.stdin.isTTY === false) return false;
  if (process.argv && process.argv.some((arg) => arg === '--headless' || arg === '--ci' || arg === '--non-interactive' || arg === '--no-interactive' || arg === '--yes' || arg === '-y')) return false;
  try {
    return spawnSync("which", ["gum"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
};

export const gumChoose = (options, header = "") => {
  const args = ["choose"];
  if (header) {
    args.push(`--header=${header}`, "--header.foreground=81");
  }
  const headerPadding = header ? 3 : 1;
  const listHeight = options.length + headerPadding;
  args.push("--cursor.foreground=81", `--height=${listHeight}`, ...options);
  const res = spawnSync("gum", args, { encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"] });
  return (res.stdout || "").trim();
};

export const gumInput = (promptText, placeholder = "", isPassword = false) => {
  const args = ["input", `--prompt=${promptText} `, `--placeholder=${placeholder}`];
  if (isPassword) {
    args.push("--password");
  }
  const res = spawnSync("gum", args, { encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"] });
  return (res.stdout || "").trim();
};

export const promptQuestion = (query) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

export const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

export const renderBanner = (title = "Chemical X Protocol: Molecular Architecture") => {
  if (hasGum()) {
    spawnSync(
      "gum",
      [
        "style",
        "--border=normal",
        "--margin=1",
        "--padding=1 2",
        "--border-foreground=45",
        "--foreground=81",
        "--bold",
        `  ${title}\n  The Secret Sauce to Vibe Coding | Zero-Context-Rot Directives`
      ],
      { stdio: "inherit" }
    );
  } else {
    process.stdout.write(
      `\n${formatChemicalXGradient("=====================================================")}\n`
    );
    process.stdout.write(`  ${formatChemicalXGradient(title)}\n`);
    process.stdout.write(`  ${ANSI.BOLD}${ANSI.GOLD}The Secret Sauce to Vibe Coding!${ANSI.RESET} ${ANSI.DIM}| Zero-Context-Rot Directives${ANSI.RESET}\n`);
    process.stdout.write(
      `${formatChemicalXGradient("=====================================================")}\n\n`
    );
  }
};

export const gumConfirm = (
  promptText = "Publish audit report and promote your project to our GitHub Discussions Audits Forum?",
  affirmative = "Publish Report",
  negative = "Skip to Menu",
  defaultVal = true
) => {
  const args = [
    "confirm",
    promptText,
    `--default=${defaultVal}`,
    `--affirmative=${affirmative}`,
    `--negative=${negative}`,
    "--prompt.foreground=81",
    "--selected.background=81",
    "--selected.foreground=0"
  ];
  const res = spawnSync("gum", args, { stdio: "inherit" });
  return res.status === 0;
};

export const promptConfirm = async (
  query = "Publish audit report and promote your project to our GitHub Discussions Audits Forum?",
  defaultVal = true
) => {
  const suffix = defaultVal ? " [Y/n]: " : " [y/N]: ";
  const answer = await promptQuestion(`${query}${suffix}`);
  if (!answer) return defaultVal;
  return /^(y|yes)$/i.test(answer);
};

export const confirmAction = async (
  promptText = "Publish audit report and promote your project to our GitHub Discussions Audits Forum?",
  affirmative = "Publish Report",
  negative = "Skip to Menu",
  defaultVal = true
) => {
  if (hasGum()) {
    return gumConfirm(promptText, affirmative, negative, defaultVal);
  }
  return promptConfirm(promptText, defaultVal);
};
