/**
 * Chemical X UI Server CSS Styles
 * Chemical X brand: glassmorphism, ambient orbs, Space Grotesk + Inter
 */
export const UI_STYLES = `
:root {
  --xo-bg: #020617; --xo-surface: #0b1329;
  --xo-glass-bg: rgba(255,255,255,0.04); --xo-glass-border: rgba(255,255,255,0.08);
  --xo-cyan: #38bdf8; --xo-pink: #f472b6; --xo-lime: #a3e635; --xo-purple: #8b5cf6; --xo-amber: #fbbf24;
}
*, *::before, *::after { box-sizing: border-box; }
html, body, #app { height: 100%; background: var(--xo-bg) !important; font-family: 'Inter', system-ui, sans-serif !important; -webkit-font-smoothing: antialiased; }

.xo-orb { position: fixed; border-radius: 9999px; pointer-events: none; z-index: 0; }
.xo-orb--pink  { width: 560px; height: 560px; background: radial-gradient(circle, rgba(244,114,182,.14) 0%, rgba(244,114,182,.06) 40%, transparent 70%); top: -14%; left: -10%; animation: xo-drift 26s ease-in-out infinite; }
.xo-orb--blue  { width: 480px; height: 480px; background: radial-gradient(circle, rgba(56,189,248,.13) 0%, rgba(56,189,248,.05) 40%, transparent 70%); bottom: 2%; right: -8%; animation: xo-drift 32s ease-in-out infinite -10s; }
.xo-orb--lime  { width: 360px; height: 360px; background: radial-gradient(circle, rgba(163,230,53,.09) 0%, rgba(163,230,53,.04) 40%, transparent 70%); top: 50%; left: 50%; animation: xo-drift 38s ease-in-out infinite -18s; }
@keyframes xo-drift { 0%,100% { transform: translate(0,0) scale(1); } 25% { transform: translate(24px,-14px) scale(1.04); } 50% { transform: translate(-14px,20px) scale(.96); } 75% { transform: translate(12px,12px) scale(1.02); } }

.xo-glass { background: var(--xo-glass-bg) !important; backdrop-filter: blur(20px) !important; -webkit-backdrop-filter: blur(20px) !important; border: 1px solid var(--xo-glass-border) !important; }
.xo-glass-list { display: flex; flex-direction: column; gap: 8px; }
.xo-btn--pinned { color: var(--xo-cyan) !important; background: rgba(56,189,248,.12) !important; border: 1px solid rgba(56,189,248,.3) !important; }
.xo-display { font-family: 'Space Grotesk', sans-serif !important; font-weight: 600; }
.xo-mono    { font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important; font-size: 12px; }

.v-app-bar { background: rgba(2,6,23,.82) !important; backdrop-filter: blur(20px) !important; border-bottom: 1px solid rgba(255,255,255,.07) !important; }
.v-navigation-drawer { background: rgba(5,10,30,.94) !important; backdrop-filter: blur(20px) !important; border-right: 1px solid rgba(255,255,255,.06) !important; }
.v-main { background: transparent !important; }
.v-list-item--active, .v-list-item--active .v-list-item-title { color: var(--xo-cyan) !important; }
.v-list-item--active::before { background: rgba(56,189,248,.08) !important; }

.xo-kpi { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 14px 18px; display: flex; flex-direction: column; gap: 4px; }
.xo-kpi__value { font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 700; line-height: 1.1; }
.xo-kpi__label { font-size: 11px; color: rgba(255,255,255,.45); text-transform: uppercase; letter-spacing: .05em; }

.xo-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 12px 14px; }
.xo-card--hover { cursor: pointer; transition: border-color .2s, transform .2s; }
.xo-card--hover:hover { border-color: rgba(56,189,248,.35); transform: translateY(-1px); }

.xo-agent-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 10px 12px; cursor: pointer; transition: border-color .2s; }
.xo-agent-card--active { border-color: rgba(56,189,248,.4) !important; }
.xo-agent-card__name { font-size: 13px; font-weight: 500; }
.xo-agent-card__role { font-size: 11px; color: rgba(255,255,255,.45); }

.xo-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.xo-dot--active  { background: var(--xo-lime); box-shadow: 0 0 6px var(--xo-lime); }
.xo-dot--idle    { background: var(--xo-cyan); }
.xo-dot--offline { background: rgba(255,255,255,.25); }

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(56,189,248,.2); border-radius: 999px; }
::-webkit-scrollbar-thumb:hover { background: rgba(56,189,248,.4); }

.xo-post { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
.xo-post__author { font-size: 12px; font-weight: 600; color: var(--xo-cyan); }
.xo-post__body   { font-size: 13px; margin-top: 4px; line-height: 1.5; }
.xo-post__time   { font-size: 11px; color: rgba(255,255,255,.35); margin-top: 6px; }

.xo-savings-badge { display: inline-flex; align-items: center; gap: 8px; padding: 5px 14px; border-radius: 9999px; background: rgba(163,230,53,.10); border: 1px solid rgba(163,230,53,.22); cursor: pointer; transition: background .2s; font-size: 13px; color: var(--xo-lime); font-weight: 500; }
.xo-savings-badge:hover { background: rgba(163,230,53,.18); }

.tier-atom     { background: rgba(56,189,248,.15)!important;  color: #38bdf8!important; }
.tier-molecule { background: rgba(163,230,53,.15)!important;  color: #a3e635!important; }
.tier-organism { background: rgba(244,114,182,.15)!important; color: #f472b6!important; }
.tier-template { background: rgba(139,92,246,.15)!important;  color: #8b5cf6!important; }
.tier-view     { background: rgba(251,191,36,.15)!important;  color: #fbbf24!important; }
.tier-utility  { background: rgba(255,255,255,.12)!important; color: rgba(255,255,255,.7)!important; }
.tier-hook     { background: rgba(56,189,248,.12)!important;  color: #7dd3fc!important; }
.xo-hazard     { background: rgba(244,63,94,.15)!important;   color: #fb7185!important; }

.xo-panel { border-radius: 14px; height: 100%; overflow: hidden; display: flex; flex-direction: column; }
.xo-panel__inner { flex: 1; overflow-y: auto; }

.xo-vb-post { display: flex; gap: 0; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; overflow: hidden; margin-bottom: 10px; background: rgba(255,255,255,.04); }
.xo-vb-post__sidebar { width: 140px; min-width: 140px; background: rgba(255,255,255,.03); border-right: 1px solid rgba(255,255,255,.06); padding: 12px 10px; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; }
.xo-vb-post__avatar { width: 48px; height: 48px; border-radius: 8px; background: rgba(56,189,248,.12); border: 1px solid rgba(56,189,248,.25); display: flex; align-items: center; justify-content: center; font-size: 20px; }
.xo-vb-post__body { flex: 1; padding: 12px 14px; min-height: 90px; font-size: 13px; line-height: 1.5; }
.xo-vb-post__meta { font-size: 11px; color: rgba(255,255,255,.35); margin-bottom: 6px; }
.xo-vb-post__sig  { border-top: 1px solid rgba(255,255,255,.07); margin-top: 10px; padding-top: 8px; font-size: 11px; color: rgba(255,255,255,.35); font-style: italic; }

.xo-kanban { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; flex: 1; overflow: hidden; }
.xo-kanban-col { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; overflow: hidden; }
.xo-kanban-col--5 { grid-template-columns: repeat(5,1fr) !important; }
.xo-kanban-col__header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 13px; }
.xo-kanban-col__body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.xo-task-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 10px 12px; flex-shrink: 0; min-height: fit-content; display: flex; flex-direction: column; gap: 6px; }
.xo-task-card--done { border-left: 3px solid #a3e635 !important; }
.xo-task-card--in_progress { border-left: 3px solid #fbbf24 !important; }
.xo-task-card--queued { border-left: 3px solid #38bdf8 !important; }
.xo-task-card__title { font-size: 13px; font-weight: 500; }
.xo-task-card__meta  { font-size: 11px; color: rgba(255,255,255,.4); margin-top: 4px; }

.xo-filetree { background: rgba(255,255,255,.03); border-radius: 10px; overflow-y: auto; }
.xo-filetree__folder { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer; user-select: none; border-radius: 6px; font-size: 12px; }
.xo-filetree__folder:hover { background: rgba(56,189,248,.06); }
.xo-filetree__file { display: flex; align-items: center; gap: 6px; padding: 3px 8px; cursor: pointer; border-radius: 6px; font-size: 12px; border: 1px solid transparent; }
.xo-filetree__file:hover { background: rgba(56,189,248,.05); border-color: rgba(255,255,255,.06); }
.xo-filetree__file--selected { background: rgba(56,189,248,.10); border-color: rgba(56,189,248,.3); color: #fff; }

.xo-inspector { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; flex: 1; overflow-y: auto; padding: 14px; font-size: 12px; font-family: ui-monospace, monospace; line-height: 1.6; }

.xo-pma-sidebar { width: 200px; min-width: 200px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; overflow-y: auto; padding: 8px; }
.xo-pma-table-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; cursor: pointer; border-radius: 6px; font-size: 12px; }
.xo-pma-table-item:hover, .xo-pma-table-item--active { background: rgba(56,189,248,.08); color: var(--xo-cyan); }
.xo-pma-main { flex: 1; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
.xo-sql-input { width: 100%; min-height: 80px; font-family: ui-monospace, monospace; font-size: 12px; background: rgba(0,0,0,.3); color: var(--xo-cyan); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 10px; outline: none; resize: vertical; }
.xo-sql-input:focus { border-color: rgba(56,189,248,.4); }
.xo-data-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: ui-monospace, monospace; }
.xo-data-table th { background: rgba(56,189,248,.08); color: var(--xo-cyan); padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,.08); text-align: left; }
.xo-data-table td { padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,.05); color: rgba(255,255,255,.8); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xo-data-table tr:hover td { background: rgba(255,255,255,.03); }

.xo-workbench-textarea { width: 100%; flex: 1; min-height: 300px; font-family: ui-monospace, monospace; font-size: 12px; background: rgba(0,0,0,.3); color: rgba(255,255,255,.85); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 12px; line-height: 1.6; resize: none; outline: none; }
.xo-workbench-textarea:focus { border-color: rgba(56,189,248,.4); }

.xo-attention-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 14px; }
.xo-attention-card--urgent { border-color: rgba(244,63,94,.3); background: rgba(244,63,94,.05); }

/* ── Backward-compat aliases for existing ui-template-*.js files ── */
body { color: #f1f5f9; }
.t-social-layout { display: flex; flex-direction: column; height: 100vh; position: relative; z-index: 1; }
.t-header { height: 56px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; background: rgba(2,6,23,.82); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,.07); position: relative; z-index: 50; }
.t-header__left, .t-header__right { display: flex; align-items: center; gap: 10px; }
.t-body { flex: 1; display: grid; grid-template-columns: 280px 1fr 300px; gap: 12px; padding: 12px; overflow: hidden; position: relative; z-index: 1; }
.t-body--full { flex: 1; display: flex; flex-direction: column; padding: 12px; overflow-y: auto; gap: 10px; position: relative; z-index: 1; }
.t-panel { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
.a-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 500; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: #f1f5f9; cursor: pointer; }
.a-chip--active { background: rgba(56,189,248,.12); border-color: rgba(56,189,248,.4); color: #38bdf8; }
.a-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
.badge-primary { background: rgba(56,189,248,.15); color: #38bdf8; }
.badge-lime { background: rgba(163,230,53,.15); color: #a3e635; }
.badge-warning { background: rgba(251,191,36,.15); color: #fbbf24; }
.badge-pink { background: rgba(244,114,182,.15); color: #f472b6; }
.m-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.a-btn { background: rgba(56,189,248,.15); border: 1px solid rgba(56,189,248,.35); color: #38bdf8; padding: 6px 14px; font-size: 12px; font-weight: 500; cursor: pointer; border-radius: 8px; font-family: 'Space Grotesk', sans-serif; transition: background .2s; }
.a-btn:hover { background: rgba(56,189,248,.25); }
.a-btn--sec { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); color: rgba(255,255,255,.7); }
.a-btn--sec:hover { background: rgba(255,255,255,.09); }
.a-input { background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.1); color: #f1f5f9; padding: 7px 10px; font-size: 12px; outline: none; width: 100%; font-family: 'Inter', sans-serif; border-radius: 8px; }
.a-input:focus { border-color: rgba(56,189,248,.4); }
.o-drawer { position: fixed; top: 56px; left: 0; bottom: 0; width: 230px; background: rgba(5,10,30,.96); backdrop-filter: blur(20px); border-right: 1px solid rgba(255,255,255,.07); z-index: 100; display: flex; flex-direction: column; padding: 10px 8px; gap: 4px; }
.o-drawer__link { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: pointer; color: rgba(255,255,255,.6); font-size: 13px; border: 1px solid transparent; border-radius: 8px; }
.o-drawer__link:hover, .o-drawer__link--active { background: rgba(56,189,248,.08); border-color: rgba(56,189,248,.2); color: #38bdf8; }
.kanban-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; flex: 1; overflow: hidden; }
.kanban-5col { display: grid; grid-template-columns: repeat(5,minmax(180px,1fr)); gap: 10px; flex: 1; overflow-x: auto; }
.kanban-col { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.kanban-header { background: rgba(56,189,248,.08); color: #f1f5f9; font-weight: 600; padding: 6px 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-family: 'Space Grotesk', sans-serif; font-size: 13px; }
.col-queued { background: rgba(56,189,248,.04); } .col-progress { background: rgba(251,191,36,.04); } .col-review { background: rgba(139,92,246,.04); } .col-completed { background: rgba(163,230,53,.04); } .col-blocked { background: rgba(244,63,94,.04); }
.badge-status-queued { background: rgba(100,116,139,.2); color: #94a3b8; border-radius: 9999px; padding: 2px 7px; font-size: 10px; }
.badge-status-progress { background: rgba(251,191,36,.15); color: #fbbf24; border-radius: 9999px; padding: 2px 7px; font-size: 10px; }
.badge-status-review { background: rgba(139,92,246,.15); color: #8b5cf6; border-radius: 9999px; padding: 2px 7px; font-size: 10px; }
.badge-status-completed { background: rgba(163,230,53,.15); color: #a3e635; border-radius: 9999px; padding: 2px 7px; font-size: 10px; }
.badge-status-blocked { background: rgba(244,63,94,.15); color: #fb7185; border-radius: 9999px; padding: 2px 7px; font-size: 10px; }
.kanban-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; flex-shrink: 0; min-height: fit-content; }
.kanban-card:hover { border-color: rgba(56,189,248,.3); background: rgba(56,189,248,.05); }
.kanban-select { background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.1); color: #f1f5f9; font-size: 11px; padding: 3px 6px; border-radius: 6px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.75); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 16px; }
.modal-box { background: #0b1329; border: 1px solid rgba(56,189,248,.2); border-radius: 16px; width: 100%; max-width: 580px; padding: 20px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 8px 40px rgba(0,0,0,.6); }
.modal-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.vb-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.vb-thead { background: rgba(56,189,248,.08); color: #38bdf8; font-weight: 600; padding: 6px 10px; }
.vb-cat-header { background: rgba(56,189,248,.06); color: #7dd3fc; font-weight: 600; padding: 6px 10px; font-size: 12px; border-left: 3px solid #38bdf8; }
.vb-row-alt1 { background: rgba(255,255,255,.04); } .vb-row-alt2 { background: rgba(255,255,255,.02); }
.vb-cell { padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,.05); color: rgba(255,255,255,.75); vertical-align: middle; }
.vb-postbit { display: flex; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; overflow: hidden; margin-bottom: 10px; background: rgba(255,255,255,.04); }
.vb-postbit__author { width: 150px; min-width: 150px; background: rgba(255,255,255,.03); border-right: 1px solid rgba(255,255,255,.06); padding: 12px 10px; font-size: 11px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.vb-avatar { width: 52px; height: 52px; border-radius: 10px; border: 1px solid rgba(56,189,248,.25); background: rgba(56,189,248,.1); display: flex; align-items: center; justify-content: center; font-size: 20px; margin-bottom: 3px; }
.vb-title-flair { font-size: 10px; color: rgba(255,255,255,.4); font-style: italic; }
.vb-rank-stars { color: #fbbf24; font-size: 10px; letter-spacing: 2px; }
.vb-model-badge { font-size: 10px; font-weight: 600; background: rgba(56,189,248,.12); color: #38bdf8; border: 1px solid rgba(56,189,248,.25); border-radius: 4px; padding: 1px 6px; }
.vb-postbit__body { flex: 1; padding: 12px 14px; display: flex; flex-direction: column; min-height: 90px; font-size: 13px; color: rgba(255,255,255,.85); line-height: 1.5; }
.vb-token-stamp { font-family: ui-monospace, monospace; font-size: 10px; color: #38bdf8; background: rgba(56,189,248,.08); padding: 2px 6px; border: 1px solid rgba(56,189,248,.15); border-radius: 4px; align-self: flex-start; margin-bottom: 6px; }
.vb-sig-divider { border-top: 1px solid rgba(255,255,255,.07); margin: 8px 0 4px 0; }
.vb-signature { font-size: 11px; color: rgba(255,255,255,.35); font-style: italic; max-height: 44px; overflow: hidden; }
.vb-beacon { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; }
.beacon-idle { background: #a3e635; box-shadow: 0 0 5px #a3e635; } .beacon-busy { background: #fbbf24; box-shadow: 0 0 5px #fbbf24; } .beacon-offline { background: rgba(255,255,255,.25); }
.vb-agent-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(260px,1fr)); gap: 10px; }
.vb-agent-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 10px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: border-color .2s; }
.vb-agent-card:hover { border-color: rgba(56,189,248,.35); background: rgba(56,189,248,.05); }
.filetree-container { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; }
.filetree-folder { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; user-select: none; border-radius: 6px; font-size: 12px; }
.filetree-folder:hover { background: rgba(56,189,248,.07); }
.filetree-file { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer; border-radius: 6px; font-size: 12px; border: 1px solid transparent; }
.filetree-file:hover { background: rgba(56,189,248,.06); border-color: rgba(255,255,255,.07); }
.filetree-file--selected { background: rgba(56,189,248,.12); border-color: rgba(56,189,248,.3); color: #fff; }
.inspector-panel { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; }
.badge-hazard { background: rgba(244,63,94,.15); color: #fb7185; border: 1px solid rgba(244,63,94,.3); border-radius: 6px; padding: 1px 7px; font-size: 10px; font-weight: 600; }
.pma-container { display: flex; gap: 10px; flex: 1; height: 100%; overflow: hidden; }
.pma-sidebar { width: 210px; min-width: 210px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.pma-sidebar-header { font-weight: 600; padding: 5px 8px; background: rgba(56,189,248,.08); border-radius: 6px; color: #7dd3fc; font-size: 12px; margin-bottom: 4px; }
.pma-table-item { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,.05); font-size: 12px; border-radius: 4px; }
.pma-table-item:hover, .pma-table-item--active { background: rgba(56,189,248,.09); color: #38bdf8; }
.pma-table-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pma-main { flex: 1; display: flex; flex-direction: column; gap: 10px; overflow: hidden; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 12px; }
.pma-nav { display: flex; gap: 6px; border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: 6px; flex-wrap: wrap; }
.pma-tab { padding: 5px 12px; cursor: pointer; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 7px; font-weight: 500; font-size: 12px; color: rgba(255,255,255,.6); }
.pma-tab:hover { background: rgba(56,189,248,.08); color: #38bdf8; }
.pma-tab--active { background: rgba(56,189,248,.12); color: #38bdf8; border-color: rgba(56,189,248,.3); }
.pma-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: ui-monospace, monospace; }
.pma-table th { background: rgba(56,189,248,.08); color: #38bdf8; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,.08); text-align: left; }
.pma-table td { padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,.05); color: rgba(255,255,255,.75); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pma-row-odd { background: rgba(255,255,255,.04); } .pma-row-even { background: rgba(255,255,255,.02); }
.pma-sql-console { width: 100%; min-height: 80px; font-family: ui-monospace, monospace; font-size: 12px; background: rgba(0,0,0,.3); color: #38bdf8; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 10px; outline: none; }
.workbench-textarea { width: 100%; flex: 1; min-height: 360px; font-family: ui-monospace, monospace; font-size: 12px; background: rgba(0,0,0,.3); color: rgba(255,255,255,.85); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 12px; line-height: 1.6; resize: none; outline: none; }
.kanban-card--highlighted { border: 2px solid #38bdf8 !important; box-shadow: 0 0 16px rgba(56,189,248,.6) !important; background: rgba(56,189,248,.12) !important; }
.task-details-backdrop { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(4px); z-index: 999; }
.task-details-sheet { position: fixed; top: 0; right: 0; bottom: 0; width: min(650px, 92vw); background: #0b1329; border-left: 1px solid rgba(56,189,248,.3); box-shadow: -12px 0 36px rgba(0,0,0,0.85); z-index: 1000; display: flex; flex-direction: column; overflow: hidden; animation: xo-sheet-slide .2s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes xo-sheet-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
.task-details-header { padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.03); display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.task-details-body { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
.task-details-footer { padding: 12px 18px; border-top: 1px solid rgba(255,255,255,.08); background: rgba(2,6,23,.75); display: flex; gap: 8px; align-items: center; }
.task-event-card { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.task-event-author { font-size: 11px; font-weight: 600; color: #38bdf8; display: flex; align-items: center; gap: 6px; }
.task-event-time { font-size: 10px; color: rgba(255,255,255,.35); margin-left: auto; }
.task-event-msg { font-size: 12px; line-height: 1.4; color: #f8fafc; }
`;
