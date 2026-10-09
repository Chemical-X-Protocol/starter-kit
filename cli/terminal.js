import readline from "node:readline";
import { spawnSync } from "node:child_process";

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

// Node leaves isTTY undefined (not false) on pipes and files, so test for truthiness.
// Every other module asks these helpers; cli/tty-policy.spec.js enforces it.
export const isStdoutTty = () => Boolean(process.stdout && process.stdout.isTTY);
export const isStdinTty = () => Boolean(process.stdin && process.stdin.isTTY);
export const isStderrTty = () => Boolean(process.stderr && process.stderr.isTTY);
export const isInteractive = () => isStdinTty() && isStdoutTty() && !process.env.CI;

export const hasGum = () => {
  if (!isInteractive()) return false;
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

export const stripAnsi = (text) => {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");
};

export const isColorSupported = () => {
  const hasNoColorArg = Boolean(process.argv && process.argv.some((arg) => arg === "--no-color" || arg === "--color=false"));
  const hasNoColorEnv = Boolean(process.env.NO_COLOR);
  const isDumbTerminal = process.env.TERM === "dumb";
  const isPipedStdout = Boolean(process.stdout && !process.stdout.isTTY);
  const shouldDisableColor = hasNoColorArg || hasNoColorEnv || isDumbTerminal || isPipedStdout;
  return !shouldDisableColor;
};

export const sanitizeOutputStreams = () => {
  if (isColorSupported()) return;

  const wrapStream = (stream) => {
    if (!stream || !stream.write) return;
    const origWrite = stream.write.bind(stream);
    stream.write = (chunk, encoding, callback) => {
      if (typeof chunk === "string") {
        return origWrite(stripAnsi(chunk), encoding, callback);
      }
      return origWrite(chunk, encoding, callback);
    };
  };

  wrapStream(process.stdout);
  wrapStream(process.stderr);
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

// `chemx <cmd> | head` closes stdout early. A closed pipe is the reader's choice, not a
// crash, so EPIPE ends the process quietly instead of reaching the error catcher.
// Any other stream error is rethrown and still reported.
export const exitQuietlyOnClosedPipe = () => {
  const onStreamError = (streamError) => {
    const isClosedPipe = streamError?.code === 'EPIPE';
    if (!isClosedPipe) throw streamError;
    process.exit(process.exitCode ?? 0);
  };
  process.stdout.on('error', onStreamError);
  process.stderr.on('error', onStreamError);
};
