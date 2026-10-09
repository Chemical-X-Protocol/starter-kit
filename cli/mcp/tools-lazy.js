// Lazy MCP tool handlers. `initialize` must not wait on the audit, parser and
// generator stack, so each handler module loads on the first call that needs it.
// Every handler returns a promise; callers already await executeMcpTool.

const lazyHandler = (loadModule, exportName) => async (...args) => (await loadModule())[exportName](...args);

const loadAudit = () => import('./tools-audit.js');
const loadPatterns = () => import('./tools-patterns.js');
const loadVerify = () => import('./tools-verify.js');
const loadGenerate = () => import('./tools-generate.js');
const loadSearch = () => import('./tools-search.js');
const loadTeam = () => import('./tools-team.js');
const loadProject = () => import('./tools-project.js');

export const handleAudit = lazyHandler(loadAudit, 'handleAudit');
export const handleGetRefactorPrompt = lazyHandler(loadAudit, 'handleGetRefactorPrompt');
export const handleQueryPatterns = lazyHandler(loadPatterns, 'handleQueryPatterns');
export const handleAutofix = lazyHandler(loadPatterns, 'handleAutofix');
export const handleAuditBuild = lazyHandler(loadVerify, 'handleAuditBuild');
export const handleChemxTypecheck = lazyHandler(loadVerify, 'handleChemxTypecheck');
export const handleChemxTest = lazyHandler(loadVerify, 'handleChemxTest');
export const handleChemxVerify = lazyHandler(loadVerify, 'handleChemxVerify');
export const handleGenerateCapsule = lazyHandler(loadGenerate, 'handleGenerateCapsule');
export const handleChemxTrend = lazyHandler(loadGenerate, 'handleChemxTrend');
export const handleChemxQ = lazyHandler(loadSearch, 'handleChemxQ');
export const handleChemxRead = lazyHandler(loadSearch, 'handleChemxRead');
export const handleChemxPatch = lazyHandler(loadSearch, 'handleChemxPatch');
export const handleChemxCheck = lazyHandler(loadSearch, 'handleChemxCheck');
export const handleChemxWrite = lazyHandler(loadSearch, 'handleChemxWrite');
export const handleChemxTeam = lazyHandler(loadTeam, 'handleChemxTeam');
export const handleChemxTeamStatus = lazyHandler(loadTeam, 'handleChemxTeamStatus');
export const handleChemxTeamFeed = lazyHandler(loadTeam, 'handleChemxTeamFeed');
export const handleChemxTeamPost = lazyHandler(loadTeam, 'handleChemxTeamPost');
export const handleChemxTeamTask = lazyHandler(loadTeam, 'handleChemxTeamTask');
export const handleChemxTeamLock = lazyHandler(loadTeam, 'handleChemxTeamLock');
export const handleChemxTeamInbox = lazyHandler(loadTeam, 'handleChemxTeamInbox');
export const handleChemxTeamDm = lazyHandler(loadTeam, 'handleChemxTeamDm');
export const handleChemxReportIssue = lazyHandler(loadTeam, 'handleChemxReportIssue');
export const handleChemxProject = lazyHandler(loadProject, 'handleChemxProject');
