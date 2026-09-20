/**
 * Chemical X UI Server CSS Styles
 * Early-2000s vBulletin 3.x / phpBB 2.x retro forum aesthetic & phpMyAdmin 2.x
 */
export const UI_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0c1524; color: #e2e8f0; font-family: Tahoma, Verdana, Arial, sans-serif; height: 100vh; overflow: hidden; font-size: 11px; }
.t-social-layout { display: flex; flex-direction: column; height: 100vh; }
.t-header { height: 48px; padding: 0 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1e385b; background: linear-gradient(180deg, #294e79 0%, #1e385b 100%); z-index: 50; box-shadow: inset 0 1px 0 #3b6b9d; }
.t-header__left, .t-header__right { display: flex; align-items: center; gap: 8px; }
.t-body { flex: 1; display: grid; grid-template-columns: 280px 1fr 300px; gap: 10px; padding: 10px; overflow: hidden; }
.t-body--full { flex: 1; display: flex; flex-direction: column; padding: 10px; overflow-y: auto; gap: 10px; }
.t-panel { background: #132034; border: 1px outset #294e79; padding: 10px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
.a-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; font-size: 11px; font-weight: 500; border: 1px outset #294e79; background: #162438; color: #e2e8f0; cursor: pointer; }
.a-chip--active { background: #1e385b; border-color: #3b6b9d; color: #62c9ff; }
.a-badge { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 2px; font-size: 10px; font-weight: 600; border: 1px solid rgba(255,255,255,0.1); }
.badge-primary { background: #1e385b; color: #62c9ff; border-color: #294e79; }
.badge-lime { background: #064e3b; color: #34d399; border-color: #059669; }
.badge-warning { background: #78350f; color: #fbbf24; border-color: #d97706; }
.badge-pink { background: #881337; color: #fb7185; border-color: #e11d48; }
.m-card { background: #162438; border: 1px inset #0c1524; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.a-btn { background: linear-gradient(180deg, #294e79 0%, #1e385b 100%); border: 1px outset #3b6b9d; color: #ffffff; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; text-shadow: 1px 1px 0 #000; }
.a-btn:hover { background: #3b6b9d; color: #ffffff; }
.a-btn:active { border-style: inset; }
.a-btn--sec { background: #1a2c42; border: 1px outset #294e79; color: #cbd5e1; }
.a-btn--sec:hover { background: #223a57; }
.a-input { background: #0b1420; border: 1px inset #1e385b; color: #f8fafc; padding: 6px 8px; font-size: 11px; outline: none; width: 100%; font-family: inherit; }
.o-drawer { position: fixed; top: 48px; left: 0; bottom: 0; width: 230px; background: #101c2e; border-right: 1px outset #294e79; z-index: 100; display: flex; flex-direction: column; padding: 10px 6px; gap: 4px; box-shadow: 2px 0 8px rgba(0,0,0,0.5); }
.o-drawer__link { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; cursor: pointer; color: #cbd5e1; text-decoration: none; font-size: 11px; border: 1px solid transparent; }
.o-drawer__link:hover, .o-drawer__link--active { background: #1e385b; border-color: #3b6b9d; color: #62c9ff; }
.kanban-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; flex: 1; }
.kanban-5col { display: grid; grid-template-columns: repeat(5, minmax(180px, 1fr)); gap: 8px; flex: 1; overflow-x: auto; }
.kanban-col { background: #132034; border: 1px outset #294e79; padding: 6px; display: flex; flex-direction: column; gap: 6px; min-width: 170px; }
.kanban-header { background: linear-gradient(180deg, #294e79 0%, #1e385b 100%); color: #ffffff; font-weight: bold; padding: 4px 8px; border: 1px outset #3b6b9d; display: flex; justify-content: space-between; align-items: center; text-shadow: 1px 1px 0 #000; font-size: 11px; }
.col-queued { background: #111a2e; } .col-progress { background: #0e2238; } .col-review { background: #1c1d2e; } .col-completed { background: #0d2820; } .col-blocked { background: #28141e; }
.badge-status-queued { background: #334155; color: #cbd5e1; } .badge-status-progress { background: #0284c7; color: #ffffff; } .badge-status-review { background: #7c3aed; color: #f5f3ff; } .badge-status-completed { background: #059669; color: #ffffff; } .badge-status-blocked { background: #dc2626; color: #ffffff; }
.kanban-card { background: #162438; border: 1px outset #294e79; padding: 6px; display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
.kanban-card:hover { border-color: #3b6b9d; background: #1a2f4c; }
.kanban-select { background: #0b1420; border: 1px inset #1e385b; color: #f8fafc; font-size: 10px; padding: 2px 4px; font-family: inherit; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 14px; }
.modal-box { background: #101c2e; border: 2px outset #294e79; width: 100%; max-width: 580px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); }
.modal-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.vb-table { width: 100%; border-collapse: separate; border-spacing: 1px; background: #0c1524; border: 1px outset #294e79; font-size: 11px; }
.vb-thead { background: linear-gradient(180deg, #294e79 0%, #1e385b 100%); color: #ffffff; font-weight: bold; padding: 6px 10px; border-top: 1px solid #4a74a5; border-bottom: 1px solid #0f1e31; text-shadow: 1px 1px 0 #0b1420; }
.vb-cat-header { background: linear-gradient(180deg, #1e385b 0%, #13243a 100%); color: #93c5fd; font-weight: bold; padding: 5px 10px; font-size: 11px; border-left: 3px solid #38bdf8; }
.vb-row-alt1 { background: #162438; } .vb-row-alt2 { background: #101c2e; }
.vb-cell { padding: 6px 8px; border: 1px inset #0c1524; color: #cbd5e1; vertical-align: middle; }
.vb-postbit { display: flex; border: 1px outset #294e79; margin-bottom: 8px; background: #162438; }
.vb-postbit__author { width: 160px; min-width: 160px; max-width: 160px; background: #101c2e; border-right: 1px inset #0c1524; padding: 8px; font-size: 10px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.vb-avatar { width: 50px; height: 50px; border: 1px inset #294e79; background: #1a2c42; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #62c9ff; margin-bottom: 2px; }
.vb-title-flair { font-size: 10px; color: #94a3b8; font-style: italic; } .vb-rank-stars { color: #f59e0b; font-size: 9px; letter-spacing: 2px; }
.vb-model-badge { font-size: 9px; font-weight: bold; background: #1e385b; color: #62c9ff; border: 1px outset #3b6b9d; border-radius: 2px; padding: 1px 4px; }
.vb-postbit__body { flex: 1; padding: 8px 12px; display: flex; flex-direction: column; justify-content: space-between; min-height: 100px; font-size: 11px; color: #e2e8f0; line-height: 1.4; }
.vb-token-stamp { font-family: monospace; font-size: 10px; color: #38bdf8; background: #0b1420; padding: 2px 5px; border: 1px inset #1e385b; border-radius: 2px; align-self: flex-start; margin-bottom: 5px; }
.vb-sig-divider { border-top: 1px dashed #294e79; margin: 8px 0 4px 0; }
.vb-signature { font-size: 10px; color: #94a3b8; font-style: italic; max-height: 44px; overflow: hidden; }
.vb-beacon { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 4px; border: 1px solid rgba(0,0,0,0.4); }
.beacon-idle { background: #34d399; box-shadow: 0 0 3px #34d399; } .beacon-busy { background: #f59e0b; box-shadow: 0 0 3px #f59e0b; } .beacon-offline { background: #64748b; }
.vb-agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.vb-agent-card { background: #162438; border: 1px outset #294e79; padding: 8px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: background 0.1s; }
.vb-agent-card:hover { background: #1e3350; border-color: #3b6b9d; }
.filetree-container { background: #101c2e; border: 1px outset #294e79; }
.filetree-folder { display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; user-select: none; border-radius: 2px; }
.filetree-folder:hover { background: #162842; }
.filetree-file { display: flex; align-items: center; gap: 6px; padding: 3px 6px; cursor: pointer; border-radius: 2px; border: 1px solid transparent; }
.filetree-file:hover { background: #1a2f4c; border-color: #294e79; }
.filetree-file--selected { background: #1e385b; border-color: #62c9ff; color: #ffffff; }
.inspector-panel { background: #132034; border: 1px outset #294e79; }
.badge-hazard { background: #7f1d1d; color: #fca5a5; border: 1px solid #ef4444; border-radius: 2px; padding: 1px 5px; font-weight: bold; }
.pma-container { display: flex; gap: 8px; flex: 1; height: 100%; overflow: hidden; }
.pma-sidebar { width: 220px; min-width: 220px; background: #0e1a2b; border: 1px outset #294e79; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.pma-sidebar-header { font-weight: bold; padding: 4px 6px; background: #162438; border: 1px inset #0c1524; color: #93c5fd; }
.pma-table-item { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; cursor: pointer; border-bottom: 1px solid rgba(41,78,121,0.3); font-size: 11px; }
.pma-table-item:hover, .pma-table-item--active { background: #1e385b; color: #62c9ff; }
.pma-table-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pma-main { flex: 1; display: flex; flex-direction: column; gap: 8px; overflow: hidden; background: #101c2e; border: 1px outset #294e79; padding: 8px; }
.pma-nav { display: flex; gap: 4px; border-bottom: 2px solid #294e79; padding-bottom: 4px; flex-wrap: wrap; }
.pma-tab { padding: 4px 10px; cursor: pointer; background: #162438; border: 1px outset #294e79; font-weight: bold; font-size: 11px; color: #cbd5e1; }
.pma-tab:hover { background: #1e385b; color: #ffffff; }
.pma-tab--active { background: #294e79; color: #ffffff; border-style: inset; }
.pma-table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: Tahoma, monospace; }
.pma-table th { background: #1e385b; color: #93c5fd; padding: 5px 8px; border: 1px inset #0c1524; text-align: left; }
.pma-table td { padding: 4px 8px; border: 1px inset #0c1524; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pma-row-odd { background: #132034; } .pma-row-even { background: #162438; }
.pma-sql-console { width: 100%; height: 90px; font-family: monospace; font-size: 12px; background: #0b1420; color: #38bdf8; border: 1px inset #1e385b; padding: 8px; outline: none; }
.workbench-textarea { width: 100%; flex: 1; min-height: 380px; font-family: monospace; font-size: 11px; background: #0b1420; color: #e2e8f0; border: 1px inset #1e385b; padding: 10px; line-height: 1.5; resize: none; outline: none; }
`;
