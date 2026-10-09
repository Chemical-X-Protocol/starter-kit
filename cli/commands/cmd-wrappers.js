// Token-lean CLI wrappers. Each wrapper takes (rawArgs, isCli, cwd) and returns
// { output, code, error? }; a non-zero code always comes with a visible error.
export { runDiff, runLog } from './cmd-wrappers-git.js';
export { runShow } from './cmd-show.js';
export { runFiles, globToRegExp, createPathMatcher } from './cmd-wrappers-files.js';
export { runPkg, runJsonShape, describeJson } from './cmd-wrappers-json.js';
export { runBatch } from './cmd-batch.js';
