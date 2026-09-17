/**
 * Chemical X UI Server CSS Styles
 * Glassmorphic dark cyberpunk theme with responsive grid
 */
export const UI_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #050811; color: #f8fafc; font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; height: 100vh; overflow: hidden; }
.t-social-layout { display: flex; flex-direction: column; height: 100vh; }
.t-header { height: 56px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(98, 201, 255, 0.2); background: rgba(11, 19, 41, 0.85); backdrop-filter: blur(12px); z-index: 50; }
.t-header__left, .t-header__right { display: flex; align-items: center; gap: 12px; }
.t-body { flex: 1; display: grid; grid-template-columns: 300px 1fr 360px; gap: 16px; padding: 16px; overflow: hidden; }
.t-body--full { flex: 1; display: flex; flex-direction: column; padding: 16px; overflow-y: auto; gap: 16px; }
.t-panel { background: rgba(11, 19, 41, 0.75); border: 1px solid rgba(98, 201, 255, 0.18); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.a-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 500; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(15, 23, 42, 0.6); color: #e2e8f0; cursor: pointer; }
.a-chip--active { background: rgba(98, 201, 255, 0.2); border-color: #62c9ff; color: #62c9ff; }
.a-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
.badge-primary { background: rgba(98, 201, 255, 0.15); color: #62c9ff; }
.badge-lime { background: rgba(16, 185, 129, 0.15); color: #34d399; }
.badge-warning { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
.badge-pink { background: rgba(244, 63, 94, 0.15); color: #f43f5e; }
.m-card { background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(98, 201, 255, 0.2); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.a-btn { background: rgba(98, 201, 255, 0.2); border: 1px solid #62c9ff; color: #62c9ff; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
.a-btn:hover { background: #62c9ff; color: #050811; }
.a-btn--sec { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.2); color: #e2e8f0; }
.a-btn--sec:hover { background: rgba(255, 255, 255, 0.2); }
.a-input { background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(98, 201, 255, 0.3); border-radius: 6px; color: #f8fafc; padding: 8px 12px; font-size: 13px; outline: none; width: 100%; }
.o-drawer { position: fixed; top: 56px; left: 0; bottom: 0; width: 260px; background: rgba(11, 19, 41, 0.95); backdrop-filter: blur(16px); border-right: 1px solid rgba(98, 201, 255, 0.2); z-index: 100; display: flex; flex-direction: column; padding: 16px 12px; gap: 8px; }
.o-drawer__link { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 8px; cursor: pointer; color: #cbd5e1; text-decoration: none; font-size: 13px; font-weight: 500; }
.o-drawer__link:hover, .o-drawer__link--active { background: rgba(98, 201, 255, 0.15); color: #62c9ff; }
.kanban-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; flex: 1; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
.modal-box { background: #0b1329; border: 1px solid #62c9ff; border-radius: 14px; width: 100%; max-width: 580px; padding: 20px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 0 35px rgba(98, 201, 255, 0.25); }
.modal-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
`;
