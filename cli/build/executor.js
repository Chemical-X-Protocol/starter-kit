import { spawn } from 'node:child_process';

export const executeBuild = (command, cwd = process.cwd(), options = {}) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const isRawStream = Boolean(options.raw);

    const child = spawn(command, {
      shell: true,
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutBuffer += text;
      if (isRawStream) {
        process.stdout.write(text);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;
      if (isRawStream) {
        process.stderr.write(text);
      }
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime;
      stderrBuffer += `\nProcess error: ${err.message}\n`;
      resolve({
        exitCode: 1,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        durationMs,
        command
      });
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      const normalizedCode = code === null ? 1 : code;
      resolve({
        exitCode: normalizedCode,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        durationMs,
        command
      });
    });
  });
};
