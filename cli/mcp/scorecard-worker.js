// Worker entry for chemx://scorecard: runs the synchronous AST audit off the server's event loop.
import { parentPort, workerData } from 'node:worker_threads';
import { runAudit } from '../audit.js';
import { buildScorecard } from './scorecard.js';

const report = runAudit(workerData.targetDir, { cwd: workerData.cwd });
parentPort.postMessage(buildScorecard(report));
