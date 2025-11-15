/* ============================================================================
   EXPORT MODULE
   ============================================================================
   
   Handles CSV and email export functionality for the golf scorecard.
   
   FEATURES:
   • CSV Export: Download current scorecard as CSV file
   • Email Export: Generate formatted email with scorecard and game results
   • HTML Share: Export complete page as single-file HTML with inlined styles (mobile share or desktop download)
   • Includes all active game results (Vegas, Skins, Junk, Hi-Lo)
   • Shows game options and settings for each active game
   
   EXPORTS:
   • exportCurrentScorecard() - Download CSV file
   • emailCurrentScorecard() - Open email client with formatted scorecard
   • shareHtmlSnapshot() - Share or download self-contained HTML snapshot
   
   Exposed as: window.Export
   API: {exportCurrentScorecard, emailCurrentScorecard, shareHtmlSnapshot}
   
   ============================================================================
*/

(() => {
  'use strict';
  console.log('[Export] Module loaded');

  /* ============================================================================
     EMBEDDED CSS FOR HTML SNAPSHOT EXPORT
     ============================================================================
     
     This CSS is a copy of stylesheet/main.css and is used when exporting
     HTML snapshots to create a self-contained file.
     
     TO UPDATE: Copy the contents of stylesheet/main.css and paste below,
     replacing everything between the START and END markers.
     
     ============================================================================
  */
  
  // START EMBEDDED CSS - DO NOT REMOVE THIS LINE
  const EMBEDDED_CSS = `
/* CSS from stylesheet/main.css - Last synced: ${new Date().toISOString().split('T')[0]} */
` + String.raw`
/* =========================
   Manito Golf Games — Optimized CSS
   Version: 2.0
   Last Updated: November 13, 2025
   
   Features:
   - CSS custom properties for maintainability
   - Consolidated game table components
   - Simplified light theme
   - Responsive design with iOS optimizations
   ========================= */

/* ---- CSS Custom Properties ---- */
:root {
  /* Theme colors (dark default) */
  --bg: #0b0d10;
  --panel: #11151a;
  --panel-alt: #0f151b;
  --ink: #e8eef5;
  --muted: #a8b3bf;
  --accent: #68d391;
  --line: #1e242b;
  --warn: #ffb454;
  --danger: #ff6b6b;
  --shadow: rgba(0, 0, 0, .35);
  
  /* Spacing tokens */
  --space-xs: 6px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 20px;
  
  /* Border radius tokens */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 12px;
  --radius-2xl: 14px;
  --radius-3xl: 16px;
  
  /* Touch target sizes (iOS optimized) */
  --touch-min: 44px;
  --touch-comfortable: 48px;
  
  /* Z-index layers */
  --z-sticky-col: 2;
  --z-sticky-header: 3;
  --z-sticky-corner: 4;
  --z-sticky-first-col: 5;
  --z-shadow: 6;
  --z-dropdown: 10;
  
  /* Transitions */
  --transition-fast: 0.2s;
  --transition-normal: 0.25s;
  --transition-slow: 0.3s;
  
  /* Font sizes (responsive clamp) */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-md: 14px;
  --text-lg: 15px;
  --text-xl: 16px;
  --text-2xl: 18px;
  --text-3xl: clamp(18px, 3.5vw, 28px);
  
  /* Table dimensions */
  --table-cell-width: 48px;
  --table-input-width: 44px;
  --table-ch-width: 60px;
}

/* ---- Base / Resets ---- */
* {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
}

body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  background: linear-gradient(180deg, #0a0c10 0%, #0c1117 100%);
  background-color: var(--bg);
  color: var(--ink);
  color-scheme: dark;
  overscroll-behavior: none;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  -webkit-tap-highlight-color: transparent;
}

/* iOS/WebKit ensure dark behind safe-area */
@supports (-webkit-touch-callout: none) {
  html,
  body {
    background-color: var(--bg);
  }
}

/* ---- Header / Controls ---- */
header {
  padding: var(--space-xl) var(--space-lg) var(--space-md);
  display: grid;
  gap: var(--space-md);
}

h1 {
  margin: 0;
  font-size: var(--text-3xl);
  letter-spacing: .2px;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: center;
}

.control {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: var(--space-sm) var(--space-md);
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  min-height: var(--touch-min);
}

.control label {
  font-size: var(--text-base);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: .08em;
}

.control input[type="text"] {
  background: #0c1218;
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: var(--radius-md);
  padding: 10px var(--space-md);
  min-width: 120px;
  min-height: var(--touch-min);
  font-size: var(--text-xl);
}

.btn {
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--radius-lg);
  cursor: pointer;
  min-height: var(--touch-min);
  font-size: var(--text-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn:hover {
  filter: brightness(1.1);
}

.btn.accent {
  border-color: #224;
  background: #14202a;
}

.meta {
  font-size: var(--text-sm);
  color: var(--muted);
}

/* ---- Theme Toggle Button ---- */
.theme-toggle {
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: var(--space-md) var(--space-lg);
  font-size: var(--text-lg);
  cursor: pointer;
  transition: background var(--transition-normal), color var(--transition-normal), border-color var(--transition-normal);
  min-height: var(--touch-min);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.theme-toggle:hover {
  filter: brightness(1.08);
}

/* ---- Utilities Section ---- */
.utilities-section {
  display: none;
  margin-top: var(--space-md);
}

.utilities-section.open {
  display: block;
}

/* =========================
   Scorecard (Scrollable)
   ========================= */
.wrap {
  padding: var(--space-md) 0 24px;
  overflow-x: auto;
  overflow-y: visible !important;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
  overscroll-behavior-x: contain;
  position: relative;
  background: var(--panel);
  scroll-behavior: smooth;
}

.wrap::before,
.wrap::after {
  content: "";
  position: sticky;
  top: 0;
  width: 18px;
  height: 100%;
  pointer-events: none;
  z-index: var(--z-shadow);
}

.wrap::before {
  left: 0;
  box-shadow: inset 12px 0 12px -12px var(--shadow);
}

.wrap::after {
  right: 0;
  box-shadow: inset -12px 0 12px -12px var(--shadow);
}

table {
  width: 100%;
  min-width: 860px;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-2xl);
  overflow: hidden;
}

thead th {
  position: sticky;
  top: 0;
  background: var(--panel-alt);
  z-index: var(--z-sticky-header);
}

th,
td {
  border-bottom: 1px solid var(--line);
  text-align: center;
  font-variant-numeric: tabular-nums;
  vertical-align: middle;
  padding: var(--space-xs) 3px;
  white-space: nowrap;
}

th:first-child,
td:first-child {
  text-align: left;
  padding-left: 8px;
  min-width: 140px;
  position: sticky;
  left: 0;
  background-color: var(--panel);
  z-index: var(--z-sticky-col);
  border-right: 1px solid var(--line);
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
}

thead th:first-child {
  z-index: var(--z-sticky-first-col);
}

tr:last-child td {
  border-bottom: none;
}

/* Divider after CH column (before hole 1) */
th:nth-child(2),
td:nth-child(2) {
  border-right: 3px solid rgba(168, 179, 191, 0.4) !important;
}

/* Divider between front 9 and back 9 (after hole 9, before hole 10) */
th:nth-child(12),
td:nth-child(12) {
  border-left: 3px solid rgba(168, 179, 191, 0.4) !important;
}

.subtle {
  color: var(--muted);
  font-size: var(--text-sm);
}

/* Emphasize Par and Handicap rows */
.par-row th,
.par-row td {
  background: transparent;
  border-left: 1px solid rgba(255, 255, 255, 0.15);
  border-right: none;
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  border-bottom: none;
}

.hcp-row th,
.hcp-row td {
  background: transparent;
  border-left: 1px solid rgba(255, 255, 255, 0.15);
  border-right: none;
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
}

.par-row input,
.hcp-row input {
  width: var(--table-input-width);
  text-align: center;
  border-radius: 0;
  border: none;
  background: transparent;
  color: var(--ink);
  padding: 10px var(--space-xs);
  -moz-appearance: textfield;
  appearance: textfield;
  min-height: var(--touch-min);
  font-size: var(--text-xl);
  pointer-events: none;
  touch-action: manipulation;
}

.score-input,
.ch-input {
  width: var(--table-input-width);
  text-align: center;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: #0c1218;
  color: var(--ink);
  padding: 10px var(--space-xs);
  -moz-appearance: textfield;
  appearance: textfield;
  min-height: var(--touch-min);
  font-size: var(--text-xl);
  touch-action: manipulation;
}

/* Divider after hole 18 */
.hole-18 {
  border-right: 2px solid rgba(255, 255, 255, 0.4) !important;
}

/* Remove spinner buttons */
.par-row input::-webkit-outer-spin-button,
.par-row input::-webkit-inner-spin-button,
.hcp-row input::-webkit-outer-spin-button,
.hcp-row input::-webkit-inner-spin-button,
.score-input::-webkit-outer-spin-button,
.score-input::-webkit-inner-spin-button,
.ch-input::-webkit-outer-spin-button,
.ch-input::-webkit-inner-spin-button,
#skinsBuyIn::-webkit-outer-spin-button,
#skinsBuyIn::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.ch-input {
  width: var(--table-ch-width);
}

.score-input.invalid {
  border-color: var(--danger);
}

/* Stroke highlighting with progressive rings */
.score-input.receives-stroke {
  border: 2px solid var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.score-input.receives-stroke[data-strokes="2"] {
  border: 2px solid var(--accent);
  box-shadow: 0 0 0 6px var(--bg), 0 0 0 8px var(--accent);
}

.score-input.receives-stroke[data-strokes="3"] {
  border: 2px solid var(--accent);
  box-shadow: 0 0 0 6px var(--bg), 0 0 0 8px var(--accent), 0 0 0 12px var(--bg), 0 0 0 14px var(--accent);
}

.total,
.to-par,
.split,
.net {
  font-weight: 600;
}

.to-par[data-sign="+"] {
  color: var(--danger);
}

.to-par[data-sign="-"] {
  color: var(--accent);
}

.to-par[data-sign="0"] {
  color: var(--warn);
}

tfoot td {
  background: var(--panel-alt);
  font-weight: 600;
}

.note {
  margin: var(--space-sm) var(--space-md) var(--space-md);
  color: var(--muted);
  font-size: var(--text-sm);
}

.small {
  font-size: var(--text-xs);
  color: var(--muted);
  margin: 0 var(--space-md);
}

.name-edit {
  background: transparent;
  border: none;
  color: var(--ink);
  font-weight: 600;
  font-size: var(--text-md);
  width: 100%;
  padding: var(--space-xs) 10px;
  display: block;
}

.name-edit:focus {
  outline: 1px dashed var(--accent);
  border-radius: var(--radius-sm);
}

/* =========================
   Games Launcher / Sections
   ========================= */
.gamesbar {
  margin: var(--space-md) var(--space-lg) 0;
  display: flex;
  gap: var(--space-md);
  flex-wrap: wrap;
  align-items: center;
}

.game-toggle {
  cursor: pointer;
  border: 1px solid var(--line);
  background: var(--panel-alt);
  border-radius: var(--radius-3xl);
  padding: var(--space-md) 18px;
  min-height: var(--touch-comfortable);
  font-size: var(--text-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: rgba(104, 211, 145, 0.1);
}

.game-toggle.active {
  background: #14202a;
  border-color: #224;
}

.game-section {
  display: none;
  margin: var(--space-lg) var(--space-lg) 32px;
  padding: var(--space-lg);
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--panel-alt);
}

.game-section.open {
  display: block;
}

.game-section h2 {
  margin: 0 0 var(--space-sm);
  font-size: var(--text-2xl);
}

.pill {
  font-size: var(--text-sm);
  color: var(--muted);
}

/* =========================
   Game Controls (Shared)
   ========================= */
.banker-controls,
.vegas-controls {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin-bottom: 10px;
  background: var(--panel);
}

.control-box,
.team-box,
.opts-box {
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 10px;
  background: var(--panel);
}

.radio {
  display: inline-flex;
  gap: var(--space-xs);
  align-items: center;
}

.warn {
  color: var(--warn);
  font-size: var(--text-sm);
  margin-top: var(--space-xs);
}

/* =========================
   Game Tables (Consolidated Component)
   ========================= */
.vegas-wrap,
.banker-wrap {
  overflow-x: auto;
  overflow-y: visible !important;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  scroll-behavior: smooth;
}

.vegas-table,
.banker-table,
.skins-table,
.junk-table {
  width: max(100%, 720px);
  border-collapse: separate;
  border-spacing: 0;
}

.banker-table,
.skins-table,
.junk-table {
  width: max(100%, 820px);
}

.vegas-table th,
.vegas-table td,
.banker-table th,
.banker-table td,
.skins-table th,
.skins-table td,
.junk-table th,
.junk-table td {
  border-bottom: 1px solid var(--line);
  padding: var(--space-xs) var(--space-sm);
  text-align: center;
  white-space: nowrap;
}

.vegas-table thead th,
.banker-table thead th,
.skins-table thead th,
.junk-table thead th {
  position: sticky;
  top: 0;
  background: var(--panel-alt);
  z-index: var(--z-sticky-header);
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
}

.vegas-table thead th:first-child,
.banker-table thead th:first-child,
.skins-table thead th:first-child,
.junk-table thead th:first-child {
  z-index: var(--z-sticky-corner);
  background-color: var(--panel);
}

.vegas-table tfoot td,
.banker-table tfoot td,
.skins-table tfoot td,
.junk-table tfoot td {
  background: var(--panel-alt);
  font-weight: 700;
}

.vegas-table th:first-child,
.vegas-table td:first-child,
.banker-table th:first-child,
.banker-table td:first-child,
.skins-table th:first-child,
.skins-table td:first-child,
.junk-table th:first-child,
.junk-table td:first-child {
  width: 40px;
  min-width: 40px;
  padding-left: 4px;
  padding-right: 4px;
  position: sticky;
  left: 0;
  background-color: var(--panel);
  z-index: var(--z-sticky-col);
  border-right: 1px solid var(--line);
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
}

/* Hi-Lo hole-by-hole highlighting */
#hiloHoleTable td {
  font-size: 13px;
}

#hiloHoleTable td:nth-child(2),
#hiloHoleTable td:nth-child(3) {
  font-family: 'Courier New', monospace;
}

/* =========================
   Junk (Dots) — Table + Dropdown
   ========================= */
#junkTable {
  width: 100%;
  table-layout: auto;
}

#junkTable th:first-child,
#junkTable td:first-child {
  width: 40px;
  min-width: 40px;
  padding: 4px;
  position: sticky;
  left: 0;
  background-color: var(--panel);
  z-index: var(--z-sticky-col);
  border-right: 3px solid var(--line);
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
}

#junkTable th:not(:first-child),
#junkTable td:not(:first-child) {
  padding: 4px !important;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}

#junkTable tbody td {
  padding: 4px !important;
  vertical-align: middle;
  height: auto;
}

/* Light theme Junk table borders */
:root[data-theme="light"] #junkTable th:first-child,
:root[data-theme="light"] #junkTable td:first-child {
  border-right: 3px solid rgba(0, 0, 0, 0.15);
}

:root[data-theme="light"] #junkTable th:not(:first-child),
:root[data-theme="light"] #junkTable td:not(:first-child) {
  border-right: 1px solid rgba(0, 0, 0, 0.05);
}

.junk-cell {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  min-height: 0;
}

.junk-ach-labels {
  font-size: 9px;
  color: var(--muted);
  text-align: center;
  line-height: 1.1;
  max-width: 90px;
  word-wrap: break-word;
  margin: 0;
  padding: 0;
}

.junk-dot {
  display: inline-block;
  min-width: 18px;
  text-align: center;
  margin: 0;
  padding: 0;
  line-height: 1;
  font-size: 14px;
  font-weight: 600;
}

.junk-dd {
  display: inline-block;
  position: relative;
}

.junk-dd > summary {
  list-style: none;
  cursor: pointer;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.08);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  -webkit-tap-highlight-color: rgba(104, 211, 145, 0.1);
  margin-top: 2px;
  transition: background 0.15s ease;
}

.junk-dd > summary:hover {
  background: rgba(255, 255, 255, 0.12);
}

.junk-dd[open] > summary {
  filter: brightness(1.08);
}

.junk-dd .menu {
  position: absolute;
  z-index: var(--z-dropdown);
  margin-top: var(--space-xs);
  display: grid;
  gap: var(--space-xs);
  padding: var(--space-sm);
  min-width: 160px;
  border: 1px solid var(--line);
  background: var(--panel-alt);
  border-radius: var(--radius-lg);
  max-height: calc(3 * var(--touch-min) + 2 * var(--space-xs) + 2 * var(--space-sm));
  overflow-y: auto;
  overflow-x: hidden;
}

.junk-dd .menu label {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--text-md) var(--space-lg);
  border-radius: var(--radius-lg);
  cursor: pointer;
  border: 1px solid transparent;
  user-select: none;
  color: var(--ink);
  min-height: var(--touch-min);
  font-size: var(--text-lg);
}

.junk-dd .menu label input {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
}

.junk-dd .menu label:has(input:checked) {
  background: #14202a;
  border-color: #224;
}

.junk-dd .menu label:has(input:checked)::after {
  content: "✓";
  margin-left: auto;
  font-weight: 700;
}

/* Density tweaks for game tables */
#junkTable tbody td,
#junkTable tbody th,
#vegasTable tbody td,
#vegasTable tbody th {
  padding-top: var(--space-xs);
  padding-bottom: var(--space-xs);
}

/* Touch target sizing */
.gamesbar .game-toggle {
  min-height: var(--touch-comfortable);
}

input[type="number"],
input[type="text"] {
  padding: 10px var(--space-md);
  min-height: var(--touch-min);
  font-size: var(--text-xl);
}

/* =========================
   Responsive Design
   ========================= */

/* Desktop optimization (1400px and below) */
@media (max-width: 1400px) {
  th, td {
    padding: var(--space-sm) 5px;
  }

  .par-row input,
  .hcp-row input,
  .score-input {
    width: 46px;
    padding: 10px 4px;
  }

  .ch-input {
    width: 58px;
  }

  th:first-child,
  td:first-child {
    min-width: 150px;
  }

  table {
    min-width: 840px;
  }
}

/* Tablet landscape (1200px and below) */
@media (max-width: 1200px) {
  th, td {
    padding: var(--space-sm) 4px;
  }

  .par-row input,
  .hcp-row input,
  .score-input {
    width: 44px;
    padding: 10px 3px;
  }

  .ch-input {
    width: 56px;
  }

  th:first-child,
  td:first-child {
    min-width: 140px;
  }

  table {
    min-width: 820px;
  }
}

/* Tablet portrait (900px and below) */
@media (max-width: 900px) {
  th, td {
    padding: var(--space-sm) 5px;
  }

  .name-edit {
    font-size: var(--text-xl);
    padding: 10px var(--space-md);
    min-height: var(--touch-min);
  }

  th:first-child,
  td:first-child {
    min-width: 160px;
  }

  .par-row input,
  .hcp-row input,
  .score-input {
    width: var(--table-input-width);
    padding: 10px 4px;
  }

  .ch-input {
    width: var(--table-ch-width);
  }

  table {
    min-width: 880px;
  }
}

/* Mobile landscape / Small tablet (768px and below) */
@media (max-width: 768px) {
  .banker-table th,
  .banker-table td,
  .skins-table th,
  .skins-table td,
  .junk-table th,
  .junk-table td,
  .vegas-table th,
  .vegas-table td {
    padding: var(--space-xs) var(--space-sm);
  }

  #junkTable tbody td,
  #junkTable tbody th,
  #vegasTable tbody td,
  #vegasTable tbody th {
    padding-top: var(--space-sm);
    padding-bottom: var(--space-sm);
  }

  .gamesbar {
    gap: 10px;
    margin: var(--space-md) var(--space-md) 0;
  }

  .gamesbar .game-toggle {
    flex: 1 1 auto;
  }

  .game-section {
    margin: var(--text-md) var(--space-md) 28px;
    padding: var(--text-md);
  }

  h2 {
    font-size: 19px;
    margin: 10px 0;
  }

  #junkTable th:not(:first-child),
  #junkTable td:not(:first-child) {
    width: 68px;
    padding: var(--space-xs) 4px;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
  }

  .junk-dd > summary {
    padding: 10px var(--space-md);
  }
}

/* Mobile portrait (600px and below) */
@media (max-width: 600px) {
  header {
    padding: var(--space-lg) var(--space-md) 10px;
  }

  h1 {
    font-size: var(--text-xl);
  }

  .controls {
    gap: 10px;
  }

  .btn {
    padding: var(--space-md) var(--text-md);
    min-height: var(--touch-comfortable);
  }

  .control {
    min-height: var(--touch-comfortable);
  }

  .control input[type="text"] {
    min-height: var(--touch-comfortable);
    padding: var(--space-md) var(--text-md);
  }

  th:first-child,
  td:first-child {
    min-width: 140px;
    padding-left: var(--space-md);
  }

  .par-row input,
  .hcp-row input,
  .score-input {
    width: 44px;
    padding: 11px 3px;
    min-height: var(--touch-comfortable);
  }

  .ch-input {
    width: 56px;
    min-height: var(--touch-comfortable);
  }

  table {
    min-width: 820px;
  }

  .vegas-table th:first-child,
  .vegas-table td:first-child,
  .banker-table th:first-child,
  .banker-table td:first-child,
  .skins-table th:first-child,
  .skins-table td:first-child,
  .junk-table th:first-child,
  .junk-table td:first-child {
    width: 40px;
    min-width: 40px;
    padding-left: 4px;
    padding-right: 4px;
  }
}

/* Small mobile (420px and below) */
@media (max-width: 420px) {
  .junk-dd > summary {
    min-height: var(--touch-comfortable);
    padding: var(--space-md) var(--text-md);
    font-size: var(--text-lg);
  }

  input[type="number"],
  input[type="text"] {
    min-height: var(--touch-comfortable);
    padding: var(--space-md) var(--text-md);
    font-size: var(--text-xl);
  }

  .game-toggle {
    padding: var(--text-md) var(--space-lg);
    font-size: var(--text-xl);
  }

  .btn,
  .theme-toggle {
    min-height: var(--touch-comfortable);
    padding: var(--text-md) 18px;
    font-size: var(--text-xl);
  }
}

/* =========================
   Light Theme
   ========================= */
:root[data-theme="light"] {
  --bg: #f4f6f8;
  --panel: #ffffff;
  --panel-alt: #f8fafc;
  --ink: #1a1c1f;
  --muted: #5a5f66;
  --accent: #0090e0;
  --line: #d3d7dc;
  --shadow: rgba(0, 0, 0, .08);
}

:root[data-theme="light"] body {
  background: var(--bg);
  color: var(--ink);
}

/* Light theme table adjustments */
:root[data-theme="light"] .par-row th,
:root[data-theme="light"] .par-row td {
  border-left: 1px solid rgba(0, 0, 0, 0.15);
  border-top: 1px solid rgba(0, 0, 0, 0.3);
}

:root[data-theme="light"] .hcp-row th,
:root[data-theme="light"] .hcp-row td {
  border-left: 1px solid rgba(0, 0, 0, 0.15);
  border-top: 1px solid rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(0, 0, 0, 0.3);
}

:root[data-theme="light"] .hole-18 {
  border-right: 2px solid rgba(0, 0, 0, 0.4) !important;
}

/* Light theme stroke highlighting */
:root[data-theme="light"] .score-input.receives-stroke {
  border: 2px solid #dc3545;
  box-shadow: 0 0 0 1px #dc3545;
}

:root[data-theme="light"] .score-input.receives-stroke[data-strokes="2"] {
  border: 2px solid #dc3545;
  box-shadow: 0 0 0 6px #ffffff, 0 0 0 8px #dc3545;
}

:root[data-theme="light"] .score-input.receives-stroke[data-strokes="3"] {
  border: 2px solid #dc3545;
  box-shadow: 0 0 0 6px #ffffff, 0 0 0 8px #dc3545, 0 0 0 12px #ffffff, 0 0 0 14px #dc3545;
}

/* Light theme input fixes */
:root[data-theme="light"] .score-input,
:root[data-theme="light"] .ch-input {
  background: #ffffff;
  color: #1a1c1f;
  border: 1px solid #d3d7dc;
}

:root[data-theme="light"] .score-input:focus,
:root[data-theme="light"] .ch-input:focus {
  border-color: #0090e0;
  outline: none;
}

:root[data-theme="light"] .control input[type="text"] {
  background: #ffffff;
  color: #1a1c1f;
  border: 1px solid #d3d7dc;
}

/* Light theme button/toggle fixes */
:root[data-theme="light"] .game-toggle {
  background: #ffffff;
  border-color: #d3d7dc;
  color: #1a1c1f;
}

:root[data-theme="light"] .game-toggle.active {
  background: #e0f2ff;
  border-color: #0090e0;
  color: #1a1c1f;
}

:root[data-theme="light"] .game-section {
  background: #f8fafc;
  border-color: #d3d7dc;
}

:root[data-theme="light"] .control-box,
:root[data-theme="light"] .team-box,
:root[data-theme="light"] .opts-box {
  background: #ffffff;
  border-color: #d3d7dc;
}

/* Light theme table headers/footers */
:root[data-theme="light"] thead th,
:root[data-theme="light"] tfoot td {
  background: #f8fafc;
  color: #1a1c1f;
}

:root[data-theme="light"] .vegas-table thead th,
:root[data-theme="light"] .banker-table thead th,
:root[data-theme="light"] .skins-table thead th,
:root[data-theme="light"] .junk-table thead th,
:root[data-theme="light"] .vegas-table tfoot td,
:root[data-theme="light"] .banker-table tfoot td,
:root[data-theme="light"] .skins-table tfoot td,
:root[data-theme="light"] .junk-table tfoot td {
  background: #f8fafc;
  color: #1a1c1f;
}

/* Light theme dropdown menu */
:root[data-theme="light"] .junk-dd > summary {
  background: #ffffff;
  border-color: #d3d7dc;
  color: #1a1c1f;
}

:root[data-theme="light"] .junk-dd .menu {
  background: #ffffff;
  border-color: #d3d7dc;
}

:root[data-theme="light"] .junk-dd .menu label {
  color: #1a1c1f;
}

:root[data-theme="light"] .junk-dd .menu label:has(input:checked) {
  background: #e0f2ff;
  border-color: #0090e0;
}

/* Light theme buttons */
:root[data-theme="light"] .btn,
:root[data-theme="light"] .theme-toggle,
:root[data-theme="light"] button {
  background: #f3f5f8;
  border-color: #cfd3d8;
  color: #1a1c1f;
}

:root[data-theme="light"] .btn:hover,
:root[data-theme="light"] .theme-toggle:hover,
:root[data-theme="light"] button:hover {
  background: #e7eaed;
}

:root[data-theme="light"] .btn.accent {
  background: #e0f2ff;
  border-color: #0090e0;
  color: #1a1c1f;
}

/* Light theme Junk "Dots" button */
:root[data-theme="light"] .junk-cell summary,
:root[data-theme="light"] .junk-cell button {
  background: #f3f5f8;
  border: 1px solid #cfd3d8;
  color: #1a1c1f;
}

/* Light theme checkboxes and number inputs */
:root[data-theme="light"] input[type="checkbox"] {
  accent-color: #0090e0;
}

:root[data-theme="light"] input[type="number"] {
  background: #ffffff;
  color: #1a1c1f;
  border: 1px solid #d3d7dc;
}

:root[data-theme="light"] input[type="number"]:focus {
  border-color: #0090e0;
  outline: none;
}

:root[data-theme="light"] #skinsBuyIn {
  background: #ffffff !important;
  color: #1a1c1f !important;
  border: 1px solid #d3d7dc !important;
}
` + '`;\n  // END EMBEDDED CSS - DO NOT REMOVE THIS LINE\n';
console.log('[Export] Module loaded');

  /**
   * Export current scorecard as CSV file
   * Includes player names, handicaps, and all hole scores
   */
  function exportCurrentScorecard() {
    const headers = ["player","ch", ...Array.from({length:18},(_,i)=>`h${i+1}`)];
    const playerRows = document.querySelectorAll(".player-row");
    const rows = [];
    
    playerRows.forEach(row => {
      const nameInput = row.querySelector(".name-edit");
      const chInput = row.querySelector(".ch-input");
      const scoreInputs = row.querySelectorAll("input.score-input");
      
      const playerName = nameInput?.value || "";
      const ch = chInput?.value || "0";
      const scores = Array.from(scoreInputs).map(inp => inp.value || "");
      
      rows.push([playerName, ch, ...scores]);
    });
    
    // Build CSV with proper escaping for names with commas
    const escapeCsvValue = (val) => {
      const str = String(val);
      if(str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    
    let csv = headers.join(",") + "\n";
    csv += rows.map(row => row.map(escapeCsvValue).join(",")).join("\n");
    
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    
    // Generate filename with date
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Get course name from global COURSES object
    const ACTIVE_COURSE = window.ACTIVE_COURSE || 'manito';
    const COURSES = window.COURSES || {};
    const courseName = COURSES[ACTIVE_COURSE]?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'scorecard';
    a.download = `${courseName}_${dateStr}.csv`;
    
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    
    // Announce using global announce function if available
    if(typeof window.announce === 'function') {
      window.announce("Scorecard exported.");
    }
  }

  /**
   * Email current scorecard with game results
   * Generates formatted plain text email with:
   * - Scorecard table with all player scores
   * - Results from all active games (Vegas, Skins, Junk, Hi-Lo)
   * - Game options and settings for each active game
   */
  function emailCurrentScorecard() {
    console.log('[Export] emailCurrentScorecard called');
    const playerRows = document.querySelectorAll(".player-row");
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    
    // Get course name from globals
    const ACTIVE_COURSE = window.ACTIVE_COURSE || 'manito';
    const COURSES = window.COURSES || {};
    const courseName = COURSES[ACTIVE_COURSE]?.name || 'Golf Scorecard';
    
    // Helper function to pad strings for alignment
    const pad = (str, len) => String(str).padEnd(len, ' ');
    const padCenter = (str, len) => {
      const s = String(str);
      const totalPad = len - s.length;
      const leftPad = Math.floor(totalPad / 2);
      const rightPad = totalPad - leftPad;
      return ' '.repeat(leftPad) + s + ' '.repeat(rightPad);
    };
    
    // Build plain text table
    let textTable = `${courseName}\n`;
    textTable += `Date: ${dateStr}\n\n`;
    
    // Header row with dividers
    textTable += pad('Player', 15) + padCenter('CH', 4) + ' |';
    for(let h=1; h<=9; h++) {
      textTable += padCenter(String(h), 3);
    }
    textTable += '|';
    for(let h=10; h<=18; h++) {
      textTable += padCenter(String(h), 3);
    }
    textTable += '|' + padCenter('Out', 5) + '|' + padCenter('In', 5) + '|' + 'Total\n';
    
    // Separator line
    textTable += '-'.repeat(15 + 4 + 2 + (3*9) + 1 + (3*9) + 1 + 5 + 1 + 5 + 1 + 5) + '\n';
    
    // Player rows
    playerRows.forEach(row => {
      const nameInput = row.querySelector(".name-edit");
      const chInput = row.querySelector(".ch-input");
      const scoreInputs = row.querySelectorAll("input.score-input");
      
      const playerName = nameInput?.value || "Player";
      const ch = chInput?.value || "0";
      const scores = Array.from(scoreInputs).map(inp => inp.value || "-");
      
      // Calculate Out, In, Total
      const outScores = scores.slice(0, 9).map(s => s === "-" ? 0 : Number(s));
      const inScores = scores.slice(9, 18).map(s => s === "-" ? 0 : Number(s));
      const out = outScores.reduce((a, b) => a + b, 0) || 0;
      const inn = inScores.reduce((a, b) => a + b, 0) || 0;
      const total = out + inn || 0;
      
      textTable += pad(playerName.substring(0, 14), 15) + padCenter(ch, 4) + ' |';
      
      // Front 9
      for(let i=0; i<9; i++) {
        textTable += padCenter(scores[i], 3);
      }
      textTable += '|';
      
      // Back 9
      for(let i=9; i<18; i++) {
        textTable += padCenter(scores[i], 3);
      }
      
      textTable += '|' + padCenter(String(out || '-'), 5) + '|' + padCenter(String(inn || '-'), 5) + '|' + padCenter(String(total || '-'), 5) + '\n';
    });
    
    // Add game results sections
    let hasGames = false;
    console.log('[Export] Checking for active games...');
    
    // VEGAS RESULTS
    const vegasSection = document.getElementById('vegasSection');
    console.log('[Export] Vegas section:', vegasSection, 'Open:', vegasSection?.classList.contains('open'));
    if(vegasSection && vegasSection.classList.contains('open')) {
      hasGames = true;
      console.log('[Export] Adding Vegas results');
      textTable += '\n\n';
      textTable += '='.repeat(60) + '\n';
      textTable += 'VEGAS GAME RESULTS\n';
      textTable += '='.repeat(60) + '\n\n';
      
      // Vegas options
      const useNet = document.getElementById('optUseNet')?.checked;
      const doubleBirdie = document.getElementById('optDoubleBirdie')?.checked;
      const tripleEagle = document.getElementById('optTripleEagle')?.checked;
      const pointValue = Number(document.getElementById('vegasPointValue')?.value) || 1;
      
      textTable += 'Options:\n';
      textTable += `  • Use Net (NDB): ${useNet ? 'YES' : 'NO'}\n`;
      textTable += `  • Double on Birdie: ${doubleBirdie ? 'YES' : 'NO'}\n`;
      textTable += `  • Triple on Eagle: ${tripleEagle ? 'YES' : 'NO'}\n`;
      textTable += `  • Point Value: $${pointValue.toFixed(2)}\n\n`;
      
      // Vegas team assignments
      const vegasTeams = document.getElementById('vegasTeams');
      if(vegasTeams) {
        const teamInputs = vegasTeams.querySelectorAll('select');
        const teams = Array.from(teamInputs).map(sel => sel.value);
        textTable += 'Teams:\n';
        playerRows.forEach((row, idx) => {
          const name = row.querySelector('.name-edit')?.value || `Player ${idx+1}`;
          textTable += `  ${name}: Team ${teams[idx] || 'A'}\n`;
        });
        textTable += '\n';
      }
      
      // Vegas results
      const ptsA = document.getElementById('vegasPtsA')?.textContent || '0';
      const ptsB = document.getElementById('vegasPtsB')?.textContent || '0';
      const dollarA = document.getElementById('vegasDollarA')?.textContent || '$0.00';
      const dollarB = document.getElementById('vegasDollarB')?.textContent || '$0.00';
      
      textTable += 'Final Score:\n';
      textTable += `  Team A: ${ptsA} points (${dollarA})\n`;
      textTable += `  Team B: ${ptsB} points (${dollarB})\n`;
    }
    
    // SKINS RESULTS
    const skinsSection = document.getElementById('skinsSection');
    if(skinsSection && skinsSection.classList.contains('open')) {
      hasGames = true;
      textTable += '\n\n';
      textTable += '='.repeat(60) + '\n';
      textTable += 'SKINS GAME RESULTS\n';
      textTable += '='.repeat(60) + '\n\n';
      
      // Skins options
      const skinsCarry = document.getElementById('skinsCarry')?.checked ?? true;
      const skinsHalf = document.getElementById('skinsHalf')?.checked ?? false;
      const skinsBuyIn = Number(document.getElementById('skinsBuyIn')?.value) || 10;
      
      textTable += 'Options:\n';
      textTable += `  • Carry Over: ${skinsCarry ? 'YES' : 'NO'}\n`;
      textTable += `  • Half-Pops: ${skinsHalf ? 'YES' : 'NO'}\n`;
      textTable += `  • Buy-In: $${skinsBuyIn.toFixed(2)}\n\n`;
      
      // Calculate total pot
      const activePlayers = playerRows.length;
      const totalPot = skinsBuyIn * activePlayers;
      textTable += `Total Pot: $${totalPot.toFixed(2)}\n\n`;
      textTable += 'Player Winnings:\n';
      
      playerRows.forEach((row, idx) => {
        const name = row.querySelector('.name-edit')?.value || `Player ${idx+1}`;
        // Use 0-based index for skins IDs
        const count = document.getElementById(`skinsTotal${idx}`)?.textContent || '0';
        const winnings = document.getElementById(`skinsWinnings${idx}`)?.textContent || '—';
        textTable += `  ${pad(name, 20)} ${count} skins - ${winnings}\n`;
      });
    }
    
    // JUNK (DOTS) RESULTS
    const junkSection = document.getElementById('junkSection');
    if(junkSection && junkSection.classList.contains('open')) {
      hasGames = true;
      textTable += '\n\n';
      textTable += '='.repeat(60) + '\n';
      textTable += 'JUNK (DOTS) GAME RESULTS\n';
      textTable += '='.repeat(60) + '\n\n';
      
      // Junk options
      const junkUseNet = document.getElementById('junkUseNet')?.checked ?? false;
      
      textTable += 'Options:\n';
      textTable += `  • Use Net Scoring: ${junkUseNet ? 'YES' : 'NO'}\n\n`;
      
      textTable += 'Scoring:\n';
      textTable += '  • Eagle: 4 dots\n';
      textTable += '  • Birdie: 2 dots\n';
      textTable += '  • Par: 1 dot\n';
      textTable += '  • Achievements: Bonus points (Sandy, Hogan, etc.)\n\n';
      
      // Total Dots Summary
      textTable += 'TOTAL DOTS:\n';
      playerRows.forEach((row, idx) => {
        const name = row.querySelector('.name-edit')?.value || `Player ${idx+1}`;
        const totalDots = document.getElementById(`junkTotP${idx+1}`)?.textContent?.trim() || '0';
        textTable += `  ${pad(name, 20)} ${totalDots} dots\n`;
      });
      
      // Hole-by-Hole Breakdown
      textTable += '\n\nHOLE-BY-HOLE BREAKDOWN:\n';
      textTable += '-'.repeat(60) + '\n';
      
      playerRows.forEach((row, idx) => {
        const name = row.querySelector('.name-edit')?.value || `Player ${idx+1}`;
        textTable += `\n${name}:\n`;

        // Get hole-by-hole data from junkBody
        const junkBody = document.getElementById('junkBody');
        if(junkBody) {
          const holes = junkBody.querySelectorAll('tr');
          let holeData = [];

          holes.forEach((holeRow, holeIdx) => {
            const cell = holeRow.children[idx + 1]; // +1 to skip hole number column
            if(cell) {
              const dotSpan = cell.querySelector('.junk-dot');
              const achLabels = cell.querySelector('.junk-ach-labels');
              const dots = dotSpan?.textContent?.trim() || cell.textContent?.trim() || '—';

              // Get achievement labels if present
              let scoreType = '';
              let achievements = [];

              if(achLabels && achLabels.innerHTML) {
                // Extract text from the labels div, replacing <br> with commas
                const labelText = achLabels.innerHTML.replace(/<br\s*\/?\>/gi, ', ');
                const labels = labelText.split(',').map(l => l.trim()).filter(l => l);

                // First label is usually the score type (Eagle, Birdie, Par)
                const scoreTypes = ['Eagle', 'Net Eagle', 'Birdie', 'Net Birdie', 'Par', 'Net Par'];
                if(labels.length > 0 && scoreTypes.includes(labels[0])) {
                  scoreType = labels[0];
                  achievements = labels.slice(1);
                } else {
                  achievements = labels;
                }
              }

              // If no scoreType found, try to get it from the cell text (fallback)
              if (!scoreType) {
                // Try to find a score type in the cell text
                const cellText = cell.textContent || '';
                const scoreTypes = ['Eagle', 'Net Eagle', 'Birdie', 'Net Birdie', 'Par', 'Net Par'];
                for (const st of scoreTypes) {
                  if (cellText.includes(st)) {
                    scoreType = st;
                    break;
                  }
                }
              }

              if(dots !== '—' && dots !== '0') {
                holeData.push({
                  hole: holeIdx + 1,
                  dots: dots,
                  scoreType: scoreType,
                  achievements: achievements
                });
              }
            }
          });

          // Format output
          if(holeData.length === 0) {
            textTable += '  No dots scored\n';
          } else {
            holeData.forEach(data => {
              let line = `  Hole ${pad(String(data.hole), 2)}: ${data.dots} dot${data.dots === '1' ? '' : 's'}`;

              // Always show score type if available, otherwise show (Par) as fallback
              if(data.scoreType) {
                line += ` (${data.scoreType})`;
              } else {
                line += ' (Par)';
              }

              // Add achievements if any
              if(data.achievements.length > 0) {
                line += ` - ${data.achievements.join(', ')}`;
              }

              textTable += line + '\n';
            });
          }
        }
      });
    }
    
    // HI-LO RESULTS
    const hiloSection = document.getElementById('hiloSection');
    if(hiloSection && hiloSection.classList.contains('open')) {
      hasGames = true;
      textTable += '\n\n';
      textTable += '='.repeat(60) + '\n';
      textTable += 'HI-LO GAME RESULTS\n';
      textTable += '='.repeat(60) + '\n\n';

      // Hi-Lo options
      const hiloUnitValue = Number(document.getElementById('hiloUnitValue')?.value) || 10;

      textTable += 'Format:\n';
      textTable += '  • Front 9: 1 unit\n';
      textTable += '  • Back 9: 1 unit\n';
      textTable += '  • Full 18: 2 units\n';
      textTable += '  • Auto-press on 2-0 hole wins\n\n';

      // Hi-Lo teams
      const teamA = document.getElementById('hiloTeamA')?.textContent?.trim() || '';
      const teamB = document.getElementById('hiloTeamB')?.textContent?.trim() || '';
      if (teamA || teamB) {
        textTable += 'Teams:\n';
        if (teamA) textTable += `  ${teamA}\n`;
        if (teamB) textTable += `  ${teamB}\n`;
        textTable += '\n';
      }

      // Hi-Lo team results table
      const hiloResultsBody = document.getElementById('hiloResultsBody');
      if (hiloResultsBody) {
        textTable += 'Team Results:\n';
        // Get header row from hiloTable
        const hiloTable = document.getElementById('hiloTable');
        let totalUnitsA = 0, totalUnitsB = 0;
        if (hiloTable) {
          const headerCells = hiloTable.querySelectorAll('thead tr th');
          const headers = Array.from(headerCells).map(th => th.textContent.trim());
          textTable += '  ' + headers.join(' | ') + '\n';
        }
        // Get each row
        const rows = hiloResultsBody.querySelectorAll('tr');
        rows.forEach((tr, idx) => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
          textTable += '  ' + cells.join(' | ') + '\n';
          // Track total units from the Total Units row
          if (cells[0] && cells[0].toLowerCase().includes('total units')) {
            // Try to parse the numbers for A and B
            totalUnitsA = parseInt(cells[1], 10) || 0;
            totalUnitsB = parseInt(cells[2], 10) || 0;
          }
        });
        // Add a clear summary line for total units
        textTable += `\n  Total Units: Team A = ${totalUnitsA}, Team B = ${totalUnitsB}\n`;
        if (totalUnitsA > totalUnitsB) {
          textTable += `  Winner: Team A (+${totalUnitsA - totalUnitsB} units)\n`;
        } else if (totalUnitsB > totalUnitsA) {
          textTable += `  Winner: Team B (+${totalUnitsB - totalUnitsA} units)\n`;
        } else {
          textTable += '  Result: Tie\n';
        }
        textTable += '\n';
      }

      // Hi-Lo hole-by-hole results table
      const hiloHoleBody = document.getElementById('hiloHoleBody');
      if (hiloHoleBody) {
        textTable += 'Hole-by-Hole Results:\n';
        // Get header row from hiloHoleTable
        const hiloHoleTable = document.getElementById('hiloHoleTable');
        if (hiloHoleTable) {
          const headerCells = hiloHoleTable.querySelectorAll('thead tr th');
          const headers = Array.from(headerCells).map(th => th.textContent.trim());
          textTable += '  ' + headers.join(' | ') + '\n';
        }
        // Get each row
        const rows = hiloHoleBody.querySelectorAll('tr');
        rows.forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
          textTable += '  ' + cells.join(' | ') + '\n';
        });
        textTable += '\n';
      }
    }
    
    // Footer
    if(hasGames) {
      textTable += '\n' + '='.repeat(60) + '\n';
    }
    textTable += '\n---\nGenerated from Golf Scorecard App';
    
    // Create mailto link with plain text body
    const subject = encodeURIComponent(`${courseName} - ${dateStr}`);
    const body = encodeURIComponent(textTable);
    
    // Open email client with mailto link
    const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
    window.location.href = mailtoLink;
    
    // Announce using global announce function if available
    if(typeof window.announce === 'function') {
      window.announce("Opening email client...");
    }
  }

  /**
   * Share HTML snapshot using native share API (mobile-friendly)
   * Falls back to download if Web Share API is not available
   */
  async function shareHtmlSnapshot() {
    try {
      // Clone the entire document
      const docClone = document.cloneNode(true);
      
      // Use the embedded CSS from the module
      const allCSS = EMBEDDED_CSS;
      console.log('[Export] Using embedded CSS for share, length:', allCSS.length);
      
      // Get the cloned html element
      const htmlEl = docClone.documentElement;
      
      // Copy all input values from original to clone and make them read-only
      const originalInputs = document.querySelectorAll('input');
      const clonedInputs = htmlEl.querySelectorAll('input');
      originalInputs.forEach((input, idx) => {
        if (clonedInputs[idx]) {
          if (input.type === 'checkbox' || input.type === 'radio') {
            clonedInputs[idx].checked = input.checked;
            if (input.checked) {
              clonedInputs[idx].setAttribute('checked', 'checked');
            } else {
              clonedInputs[idx].removeAttribute('checked');
            }
            clonedInputs[idx].disabled = true;
            clonedInputs[idx].setAttribute('disabled', 'disabled');
          } else {
            clonedInputs[idx].value = input.value;
            clonedInputs[idx].setAttribute('value', input.value);
            clonedInputs[idx].readOnly = true;
            clonedInputs[idx].setAttribute('readonly', 'readonly');
          }
        }
      });
      
      // Copy all select values and disable them
      const originalSelects = document.querySelectorAll('select');
      const clonedSelects = htmlEl.querySelectorAll('select');
      originalSelects.forEach((select, idx) => {
        if (clonedSelects[idx]) {
          clonedSelects[idx].value = select.value;
          Array.from(clonedSelects[idx].options).forEach(option => {
            option.selected = option.value === select.value;
            if (option.selected) {
              option.setAttribute('selected', 'selected');
            } else {
              option.removeAttribute('selected');
            }
          });
          clonedSelects[idx].disabled = true;
          clonedSelects[idx].setAttribute('disabled', 'disabled');
        }
      });
      
      // Copy all textarea values and make them read-only
      const originalTextareas = document.querySelectorAll('textarea');
      const clonedTextareas = htmlEl.querySelectorAll('textarea');
      originalTextareas.forEach((textarea, idx) => {
        if (clonedTextareas[idx]) {
          clonedTextareas[idx].textContent = textarea.value;
          clonedTextareas[idx].readOnly = true;
          clonedTextareas[idx].setAttribute('readonly', 'readonly');
        }
      });
      
      // Remove stylesheet links since we're inlining the embedded CSS
      const links = htmlEl.querySelectorAll('link[rel="stylesheet"]');
      links.forEach(link => link.remove());
      console.log('[Export] Removed', links.length, 'stylesheet link(s)');
      
      // Remove all script tags
      const scripts = htmlEl.querySelectorAll('script');
      scripts.forEach(script => script.remove());
      
      // Remove service worker and manifest references
      const manifest = htmlEl.querySelector('link[rel="manifest"]');
      if (manifest) manifest.remove();
      
      const metaTags = htmlEl.querySelectorAll('meta[http-equiv]');
      metaTags.forEach(meta => meta.remove());
      
      // Add embedded CSS at the beginning of head
      const head = htmlEl.querySelector('head');
      if (head) {
        const styleEl = docClone.createElement('style');
        styleEl.setAttribute('data-export-inline', 'true');
        styleEl.textContent = allCSS;
        head.insertBefore(styleEl, head.firstChild);
        console.log('[Export] Added inline style element with', allCSS.length, 'characters');
      }
      
      // Add read-only notice banner at top of body WITH QR CODE
      const body = htmlEl.querySelector('body');
      if (body) {
        const exportDate = new Date();
        const exportTimestamp = exportDate.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        
        const notice = docClone.createElement('div');
        notice.style.cssText = 'background: #ff6b6b; color: white; padding: 20px; text-align: center; font-size: 20px; font-weight: bold; margin: 0; position: sticky; top: 0; z-index: 9999; border-bottom: 4px solid #c92a2a;';
        
        // Generate QR code data for import
        let qrCodeHTML = '';
        if (typeof QRCode !== 'undefined' && window.QRShare) {
          try {
            // Get the compressed data (same format used for QR generation)
            const players = Array.from(document.querySelectorAll('.player-row')).map(row => {
              const name = row.querySelector('.name-edit')?.value || '';
              const ch = row.querySelector('.ch-input')?.value || '0';
              const scores = Array.from(row.querySelectorAll('input.score-input')).map(inp => inp.value || '');
              return { n: name, c: ch, s: scores };
            });
            const course = window.ACTIVE_COURSE || 'manito';
            const qrData = JSON.stringify({ v: 1, c: course, p: players });
            
            // Create a temporary container for QR code generation
            const tempQR = document.createElement('div');
            document.body.appendChild(tempQR);
            
            // Generate QR code
            const qrcode = new QRCode(tempQR, {
              text: qrData,
              width: 200,
              height: 200,
              colorDark: "#000000",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.M
            });
            
            // Extract canvas/image and convert to data URL
            const qrCanvas = tempQR.querySelector('canvas');
            const qrImage = tempQR.querySelector('img');
            
            let qrDataUrl = null;
            
            if (qrCanvas) {
              // Convert canvas to data URL
              qrDataUrl = qrCanvas.toDataURL('image/png');
            } else if (qrImage && qrImage.src) {
              // Use the img src if canvas not available
              qrDataUrl = qrImage.src;
            }
            
            if (qrDataUrl) {
              qrCodeHTML = `<div style="margin-top: 20px; padding: 16px; background: white; display: inline-block; border-radius: 12px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
                <img id="qrCodeImage" src="${qrDataUrl}" style="display: block; width: 200px; height: 200px; margin: 0 auto; -webkit-touch-callout: default;" alt="QR Code for import" />
                <div style="color: #333; font-size: 14px; font-weight: normal; margin-top: 12px; text-align: center;">Scan or long-press image to save</div>
                <button onclick="copyQRToClipboard()" style="margin-top: 12px; padding: 10px 20px; background: #4a9eff; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer;">📋 Copy QR Code</button>
                <div id="copyStatus" style="margin-top: 8px; font-size: 12px; color: #68d391; min-height: 18px;"></div>
              </div>
              <script>
                async function copyQRToClipboard() {
                  const img = document.getElementById('qrCodeImage');
                  const status = document.getElementById('copyStatus');
                  
                  try {
                    // Try modern clipboard API first
                    const response = await fetch(img.src);
                    const blob = await response.blob();
                    
                    if (navigator.clipboard && navigator.clipboard.write) {
                      const item = new ClipboardItem({ 'image/png': blob });
                      await navigator.clipboard.write([item]);
                      status.textContent = '✓ QR code copied! Paste it in the app to import.';
                      status.style.color = '#68d391';
                    } else {
                      throw new Error('Clipboard API not available');
                    }
                  } catch (err) {
                    console.error('Copy failed:', err);
                    // iOS fallback: show instructions
                    status.innerHTML = '📱 iOS: Long-press the QR code image above, then tap "Save Image" or "Copy". Open the app and paste in the utilities section.';
                    status.style.color = '#4a9eff';
                    status.style.fontSize = '13px';
                  }
                  
                  setTimeout(() => status.textContent = '', 8000);
                }
              </script>`;
            }
            
            // Clean up temp container
            document.body.removeChild(tempQR);
          } catch (err) {
            console.error('[Export] Failed to generate QR code for export:', err);
          }
        }
        
        notice.innerHTML = `
          <div style="margin-bottom: 12px;">⚠️ This is a copy of the Manito Games scoring and is not editable ⚠️</div>
          <div style="font-size: 16px; font-weight: normal;">Exported: ${exportTimestamp}</div>
          ${qrCodeHTML}
        `;
        body.insertBefore(notice, body.firstChild);
      }
      
      // Add read-only notices to each game section
      const gameSections = htmlEl.querySelectorAll('.game-section');
      gameSections.forEach(section => {
        const exportDate = new Date();
        const exportTimestamp = exportDate.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        const sectionNotice = docClone.createElement('div');
        sectionNotice.style.cssText = 'background: #ffa94d; color: #000; padding: 12px; text-align: center; font-size: 16px; font-weight: bold; margin: 0 0 16px 0; border: 3px solid #fd7e14; border-radius: 8px;';
        sectionNotice.innerHTML = `📋 This is a copy of the Manito Games scoring and is not editable<br><span style="font-size: 14px; font-weight: normal; margin-top: 4px; display: inline-block;">Exported: ${exportTimestamp}</span>`;
        section.insertBefore(sectionNotice, section.firstChild.nextSibling);
      });
      
      // Create the HTML string
      const htmlContent = '<!DOCTYPE html>\n' + htmlEl.outerHTML;
      
      // Generate filename
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0];
      const ACTIVE_COURSE = window.ACTIVE_COURSE || 'manito';
      const COURSES = window.COURSES || {};
      const courseName = COURSES[ACTIVE_COURSE]?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'scorecard';
      const filename = `${courseName}_${dateStr}.html`;
      
      // Create blob and file
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      
      // Check if Web Share API is available
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: 'text/html' });
        
        // Check if we can share this file
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `Golf Scorecard - ${courseName}`,
            text: `Scorecard from ${dateStr}`,
            files: [file]
          });
          
          if (typeof window.announce === 'function') {
            window.announce('Scorecard shared!');
          }
          return;
        }
      }
      
      // Fallback to download if share is not available
      console.log('[Export] Web Share API not available, falling back to download');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      if (typeof window.announce === 'function') {
        window.announce('Share not available - downloaded instead.');
      }
    } catch (error) {
      console.error('[Export] Error sharing HTML snapshot:', error);
      if (typeof window.announce === 'function') {
        window.announce('Error sharing scorecard.');
      }
    }
  }

  // Expose module globally
  window.Export = {
    exportCurrentScorecard,
    emailCurrentScorecard,
    shareHtmlSnapshot
  };
  
  console.log('[Export] Module exposed to window.Export:', window.Export);

})();
