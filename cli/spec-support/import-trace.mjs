// Spec support: records every resolved module URL, plus the user CPU time at
// exit, to $CHEMX_IMPORT_TRACE. Loaded with `node --import <this file>`;
// never imported by runtime code.
import { registerHooks } from 'node:module';
import fs from 'node:fs';

const traceFile = process.env.CHEMX_IMPORT_TRACE;
const hasTraceFile = Boolean(traceFile);

if (hasTraceFile) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      fs.appendFileSync(traceFile, `${resolved.url}\n`);
      return resolved;
    }
  });
  process.on('exit', () => {
    const userCpuMs = Math.round(process.cpuUsage().user / 1000);
    fs.appendFileSync(traceFile, `cpu-user-ms:${userCpuMs}\n`);
  });
}
