/**
 * Styles for the A2UI renderer.
 *
 * Everything is prefixed `.a2ui-` and every colour comes from a
 * `--dsw-alias-*` theme token (or `currentColor`), so light/dark switching and
 * future token renames degrade gracefully. The categorical chart palette is the
 * one intentional exception: a data series needs distinguishable hues that are
 * legible on both backgrounds and no theme token provides a palette.
 */
export const CSS = `
.a2ui-root{--a2ui-radius:10px;--a2ui-gap:10px;--a2ui-c1:#4c8dff;--a2ui-c2:#2fb37a;--a2ui-c3:#e8a33d;--a2ui-c4:#d96a8b;--a2ui-c5:#8c7bf0;--a2ui-c6:#2ab6c6;--a2ui-c7:#e0684b;--a2ui-c8:#7d8fa8;
  display:block;min-width:0;width:100%;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;box-sizing:border-box}
.a2ui-root *,.a2ui-root *::before,.a2ui-root *::after{box-sizing:border-box}
.a2ui-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:14px;overflow:hidden;min-width:0;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.a2ui-card-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}
.a2ui-card-spark{display:inline-flex;flex:none;width:14px;height:14px;color:var(--dsw-alias-brand-primary)}
.a2ui-card-spark svg{width:100%;height:100%}
.a2ui-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);letter-spacing:.005em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.a2ui-card-body{padding:14px;min-width:0}
.a2ui-surface{display:flex;flex-direction:column;gap:var(--a2ui-gap);min-width:0}
.a2ui-stack{display:flex;flex-direction:column;gap:var(--a2ui-gap);min-width:0}
.a2ui-row{display:flex;flex-direction:row;gap:var(--a2ui-gap);min-width:0;flex-wrap:wrap}
.a2ui-list{display:flex;gap:8px;min-width:0}
.a2ui-text{margin:0;min-width:0;overflow-wrap:anywhere}
.a2ui-text-caption{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.a2ui-text code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--dsw-alias-markdown-inline-code);border-radius:4px;padding:1px 4px}
.a2ui-text strong{font-weight:600}
.a2ui-card-inner{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:var(--a2ui-radius);padding:12px;min-width:0}
.a2ui-divider{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:2px 0;width:100%}
.a2ui-divider-v{border-left:1px solid var(--dsw-alias-border-l1);align-self:stretch;min-height:18px;width:0}
.a2ui-btn{appearance:none;font:inherit;font-size:13px;line-height:1.4;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:8px;padding:6px 13px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);cursor:pointer;min-height:32px;max-width:100%;transition:background .14s ease,border-color .14s ease,color .14s ease}
.a2ui-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.a2ui-btn:disabled{opacity:.55;cursor:not-allowed}
.a2ui-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.a2ui-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.a2ui-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.a2ui-btn-borderless{border-color:transparent;background:transparent;color:var(--dsw-alias-brand-primary);padding-left:4px;padding-right:4px}
.a2ui-btn-borderless:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.a2ui-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.a2ui-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.a2ui-input,.a2ui-textarea,.a2ui-select{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;min-height:32px;width:100%;min-width:0}
.a2ui-textarea{min-height:74px;resize:vertical;line-height:1.5}
.a2ui-input:focus-visible,.a2ui-textarea:focus-visible,.a2ui-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.a2ui-input::placeholder,.a2ui-textarea::placeholder{color:var(--dsw-alias-label-secondary);opacity:.7}
.a2ui-check{display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer;font-size:13px}
.a2ui-check input{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary);margin:0;flex:none;cursor:pointer}
.a2ui-choice{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.a2ui-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:999px;padding:4px 11px;font-size:12.5px;cursor:pointer;min-height:28px}
.a2ui-chip[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);background:color-mix(in oklab, var(--dsw-alias-brand-primary) 16%, transparent);color:var(--dsw-alias-label-primary);font-weight:500}
.a2ui-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.a2ui-slider{display:flex;flex-direction:column;gap:4px;min-width:0}
.a2ui-slider-row{display:flex;align-items:center;gap:10px;min-width:0}
.a2ui-slider input[type=range]{flex:1;min-width:0;accent-color:var(--dsw-alias-brand-primary);height:22px}
.a2ui-slider-value{font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--dsw-alias-label-secondary);min-width:44px;text-align:right}
.a2ui-error{color:var(--dsw-alias-state-error-primary);font-size:11.5px}
.a2ui-notice{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0}
.a2ui-notice-error{border-color:color-mix(in oklab, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l1))}
.a2ui-notice-title{font-weight:600;color:var(--dsw-alias-label-primary);font-size:12px}
.a2ui-notice-body{white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.5;max-height:180px;overflow:auto}
.a2ui-tabs{display:flex;flex-direction:column;gap:8px;min-width:0}
.a2ui-tabbar{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;scrollbar-width:thin}
.a2ui-tab{appearance:none;font:inherit;font-size:12.5px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 10px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.a2ui-tab[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:500}
.a2ui-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.a2ui-modal-trigger{display:inline-flex}
.a2ui-modal-backdrop{position:fixed;inset:0;background:color-mix(in oklab, #000 42%, transparent);display:flex;align-items:center;justify-content:center;padding:24px;z-index:60}
.a2ui-modal{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;max-width:min(560px,100%);max-height:80vh;overflow:auto;padding:16px;box-shadow:0 16px 48px rgba(0,0,0,.28);min-width:0}
.a2ui-modal-close{display:flex;justify-content:flex-end;margin-bottom:6px}
.a2ui-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--a2ui-radius);min-width:0;max-width:100%}
.a2ui-table{border-collapse:collapse;width:100%;font-size:12.5px}
.a2ui-table th,.a2ui-table td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.a2ui-table th{font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);position:sticky;top:0;z-index:1;font-size:11.5px;padding:0}
.a2ui-th-sort{appearance:none;font:inherit;font-size:11.5px;font-weight:600;color:inherit;background:none;border:0;padding:6px 10px;width:100%;text-align:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.a2ui-th-sort:hover{color:var(--dsw-alias-label-primary)}
.a2ui-th-sort:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.a2ui-th-arrow{font-size:8px;opacity:.85}
.a2ui-table tbody tr:hover td{background:color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent)}
.a2ui-table tbody tr:nth-child(even) td{background:color-mix(in oklab, var(--dsw-alias-label-primary) 3%, transparent)}
.a2ui-table tbody tr:nth-child(even):hover td{background:color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent)}
.a2ui-table .a2ui-num{text-align:right;font-variant-numeric:tabular-nums}
.a2ui-caption{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:0}
.a2ui-chart{display:block;width:100%;overflow:visible}
.a2ui-chart-wrap{display:flex;flex-direction:column;gap:6px;min-width:0}
.a2ui-chart-note{font-size:11px;color:var(--dsw-alias-label-secondary);margin:0}
.a2ui-chart-svg{width:100%;height:auto;display:block;overflow:visible}
.a2ui-bar-plot{position:relative;min-width:0}
.a2ui-bar-tip{position:absolute;left:0;top:0;z-index:1;visibility:hidden;pointer-events:none;width:max-content;max-width:min(280px,calc(100% - 8px));max-height:calc(100% - 8px);overflow:hidden;overflow-wrap:anywhere;white-space:pre-wrap;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2,Canvas));color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.4}
.a2ui-axis text{fill:var(--dsw-alias-label-secondary);font-size:10px}
.a2ui-grid line{stroke:var(--dsw-alias-border-l1);stroke-width:1}
.a2ui-legend{display:flex;flex-wrap:wrap;gap:4px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.a2ui-legend-more{align-self:center;padding:0 2px;opacity:.7}
.a2ui-legend-item{appearance:none;font:inherit;font-size:11.5px;color:inherit;background:none;border:0;border-radius:6px;padding:2px 6px;display:inline-flex;align-items:center;gap:5px;cursor:pointer}
.a2ui-legend-item:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.a2ui-legend-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.a2ui-legend-off{opacity:.45;text-decoration:line-through}
.a2ui-legend-swatch{width:8px;height:8px;border-radius:2px;flex:none}
.a2ui-stat{display:flex;flex-direction:column;gap:3px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:var(--a2ui-radius);padding:11px 13px;min-width:0}
.a2ui-stat-label{font-size:11.5px;color:var(--dsw-alias-label-secondary);font-weight:500}
.a2ui-stat-value{font-size:22px;font-weight:600;line-height:1.2;letter-spacing:-.01em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.a2ui-stat-unit{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-secondary);margin-left:3px}
.a2ui-stat-delta{font-size:11.5px;font-weight:600}
.a2ui-delta-up{color:var(--dsw-alias-state-success-primary)}
.a2ui-delta-down{color:var(--dsw-alias-state-error-primary)}
.a2ui-delta-flat{color:var(--dsw-alias-label-secondary)}
.a2ui-progress{display:flex;flex-direction:column;gap:5px;min-width:0}
.a2ui-progress-track{height:7px;border-radius:999px;background:var(--dsw-alias-fill-l2);overflow:hidden}
.a2ui-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.a2ui-progress-fill.a2ui-tone-success{background:var(--dsw-alias-state-success-primary)}
.a2ui-progress-fill.a2ui-tone-warning{background:var(--dsw-alias-state-warn-primary)}
.a2ui-progress-fill.a2ui-tone-danger{background:var(--dsw-alias-state-error-primary)}
.a2ui-progress-head{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.a2ui-player{display:flex;flex-direction:column;gap:8px;min-width:0}
.a2ui-player-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.a2ui-player-note{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-left:auto;font-variant-numeric:tabular-nums}
.a2ui-bars{display:flex;align-items:flex-end;gap:6px;min-height:120px;border-bottom:1px solid var(--dsw-alias-border-l1);padding:4px 2px 0}
.a2ui-bar{flex:1;min-width:6px;border-radius:4px 4px 0 0;background:var(--dsw-alias-state-idle-primary);transition:height .16s ease,background .16s ease;position:relative}
.a2ui-bar.a2ui-state-active{background:var(--dsw-alias-brand-primary)}
.a2ui-bar.a2ui-state-compare{background:var(--dsw-alias-state-warn-primary)}
.a2ui-bar.a2ui-state-sorted,.a2ui-bar.a2ui-state-done{background:var(--dsw-alias-state-success-primary)}
.a2ui-bar-value{position:absolute;top:-15px;left:0;right:0;text-align:center;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.a2ui-frame-list{display:flex;flex-wrap:wrap;gap:5px}
.a2ui-cell{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:2px 8px;font-size:12px;font-variant-numeric:tabular-nums;background:var(--dsw-alias-bg-layer-1)}
.a2ui-cell.a2ui-state-active{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);border-color:transparent}
.a2ui-cell.a2ui-state-compare{background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary-inverted);border-color:transparent}
.a2ui-cell.a2ui-state-sorted,.a2ui-cell.a2ui-state-done{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-inverted);border-color:transparent}
.a2ui-image{max-width:100%;height:auto;border-radius:8px;display:block}
.a2ui-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}
.a2ui-icon svg{width:100%;height:100%}
.a2ui-fallback{font-size:11.5px;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;padding:5px 8px;display:inline-block}
.a2ui-pointer{display:flex;align-items:center;gap:8px;min-width:0;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:7px 11px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.a2ui-pointer-icon{display:inline-flex;flex:none;width:13px;height:13px;color:var(--dsw-alias-brand-primary)}
.a2ui-pointer-icon svg{width:100%;height:100%}
.a2ui-pointer-text{color:var(--dsw-alias-label-primary);font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.a2ui-pointer-meta{margin-left:auto;flex:none;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.a2ui-tail{display:flex;flex-direction:column;gap:10px;min-width:0;margin:6px 0 2px}
.a2ui-card-streaming{border-style:dashed}
.a2ui-card-state{margin-left:auto;flex:none;font-size:11px;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-brand-primary);opacity:.85}
.a2ui-card-streaming .a2ui-card-body{pointer-events:none}
.a2ui-skel{display:flex;flex-direction:column;gap:8px;min-width:0}
.a2ui-skel-line,.a2ui-skel-block{display:block;border-radius:6px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-3) 0%,var(--dsw-alias-interactive-bg-hover-solid) 45%,var(--dsw-alias-bg-layer-3) 90%);background-size:220% 100%;animation:a2ui-shimmer 1.25s ease-in-out infinite}
.a2ui-skel-line{height:9px}
.a2ui-skel-block{height:52px;border-radius:8px;animation-delay:.12s}
.a2ui-skel-w70{width:70%}
.a2ui-skel-w92{width:92%}
.a2ui-skel-w60{width:60%}
.a2ui-skel-inline{width:96px;height:10px;vertical-align:middle}
@keyframes a2ui-shimmer{0%{background-position:120% 0}100%{background-position:-40% 0}}
.a2ui-hidden{display:none !important}
@media (prefers-reduced-motion: reduce){.a2ui-root *{transition:none !important;animation:none !important}}
`
