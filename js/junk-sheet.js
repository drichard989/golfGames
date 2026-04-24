/* ============================================================================
   JUNK BOTTOM SHEET - Mobile-friendly per-hole award input
   ============================================================================

   Additive UI layer on top of the existing Junk module. When enabled:
     - Hides the per-cell <details> "Dots" dropdowns (CSS-only, state preserved)
     - Tapping a junk table row opens a full-width bottom sheet
     - The sheet shows each player with big tappable chip buttons for each award
     - Toggling a chip dispatches a change event on the hidden junk-ach checkbox
       so all existing save/compute pipelines run unchanged.

   To REVERSE this feature:
     - Set `window.JUNK_BOTTOM_SHEET = false` before this script loads, OR
     - Remove the <script src="js/junk-sheet.js"> tag from index.html, OR
     - Delete this file and the `.junk-sheet-active` CSS block in main.css.

   The original `<details>`-based UI is never modified and is restored
   immediately when the feature flag is disabled.
   ============================================================================
 */
(function(){
  'use strict';

  if (window.JUNK_BOTTOM_SHEET === false) return;

  const ACH = [
    { id: 'sandy',   label: 'Sandy',   pts: 1,   emoji: '🏖️' },
    { id: 'sadaam',  label: 'Sadaam',  pts: 2,   emoji: '💥' },
    { id: 'kp',      label: 'KP',      pts: 1,   emoji: '🎯' },
    { id: 'hoover',  label: 'Hoover',  pts: 10,  emoji: '🧹' },
    { id: 'skin',    label: 'Skin',    pts: 1,   emoji: '�', auto: true },
    { id: 'pulley',  label: 'Pully',   pts: 1,   emoji: '🪢' },
    { id: 'gcbc',    label: 'GCBBC',    pts: 3,   emoji: '🍆' },
    { id: 'dod',     label: 'DOD',     pts: 1,   emoji: '💀', imageUrl: 'images/dod.png' },
    { id: 'hogan',   label: 'Hogan',   pts: 1,   emoji: '🎩' },
    { id: 'woodie',  label: 'Woodie',  pts: 1,   emoji: '🌲' },
    { id: 'chippy',  label: 'Chippy',  pts: 1,   emoji: '🐿️' },
    { id: 'holein1', label: 'Hole-in-1', pts: 100, emoji: '🕳️' },
  ];

  let sheetEl = null;
  let backdropEl = null;
  let currentHole = null;

  function getPlayerCount(){
    try {
      if (typeof window.getPlayerCount === 'function') return window.getPlayerCount();
    } catch(_){}
    return document.querySelectorAll('#scorecardFixed .player-row').length;
  }

  function getPlayerNames(){
    try {
      if (typeof window.getPlayerNames === 'function') return window.getPlayerNames();
    } catch(_){}
    const rows = Array.from(document.querySelectorAll('#scorecardFixed .player-row'));
    return rows.map((row, i) => {
      const nameInput = row.querySelector('.name-edit');
      const v = nameInput?.value?.trim();
      return v || `P${i+1}`;
    });
  }

  function getParFor(hole){
    const el = document.querySelector(`#parRow input[data-hole="${hole}"]`);
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : null;
  }

  function getScoreFor(hole, playerIdx){
    const el = document.querySelector(`.score-input[data-player="${playerIdx}"][data-hole="${hole}"]`);
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : null;
  }

  function getCellDot(hole, playerIdx){
    const td = document.getElementById(`junk_h${hole}_p${playerIdx+1}`);
    if (!td) return '—';
    const span = td.querySelector('.junk-dot');
    return (span && span.textContent) ? span.textContent : (td.textContent || '—');
  }

  function findAchInput(hole, playerIdx, key){
    return document.querySelector(
      `input.junk-ach[data-player="${playerIdx}"][data-hole="${hole}"][data-key="${key}"]`
    );
  }

  function getSkinCountFor(hole, playerIdx){
    const td = document.getElementById(`junk_h${hole}_p${playerIdx+1}`);
    if (!td) return 0;
    const v = Number(td.dataset.skinCount || 0);
    return Number.isFinite(v) ? v : 0;
  }

  function ensureSheet(){
    if (sheetEl) return;
    backdropEl = document.createElement('div');
    backdropEl.className = 'junk-sheet-backdrop';
    backdropEl.addEventListener('click', closeSheet);

    sheetEl = document.createElement('div');
    sheetEl.className = 'junk-sheet';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'junkSheetTitle');
    sheetEl.innerHTML = `
      <div class="junk-sheet-header">
        <h3 id="junkSheetTitle" class="junk-sheet-title">Hole —</h3>
        <button type="button" class="junk-sheet-close" aria-label="Close">✕</button>
      </div>
      <div class="junk-sheet-body"></div>
      <div class="junk-sheet-footer">
        <button type="button" class="btn junk-sheet-done">Done</button>
      </div>
    `;
    sheetEl.querySelector('.junk-sheet-close').addEventListener('click', closeSheet);
    sheetEl.querySelector('.junk-sheet-done').addEventListener('click', closeSheet);

    document.body.appendChild(backdropEl);
    document.body.appendChild(sheetEl);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheetEl.classList.contains('is-open')) closeSheet();
    });
  }

  function renderSheet(hole){
    ensureSheet();
    currentHole = hole;
    const par = getParFor(hole);
    const names = getPlayerNames();
    const playerCount = getPlayerCount();

    sheetEl.querySelector('.junk-sheet-title').textContent =
      `Hole ${hole}${par != null ? ` · Par ${par}` : ''}`;

    const body = sheetEl.querySelector('.junk-sheet-body');
    body.innerHTML = '';

    for (let p = 0; p < playerCount; p++){
      const section = document.createElement('section');
      section.className = 'junk-sheet-player';

      const score = getScoreFor(hole, p);
      const dot = getCellDot(hole, p);

      const header = document.createElement('div');
      header.className = 'junk-sheet-player-header';
      header.innerHTML = `
        <div class="junk-sheet-player-name">${names[p] || `P${p+1}`}</div>
        <div class="junk-sheet-player-meta">
          <span class="junk-sheet-chip-meta">Score ${score != null ? score : '—'}</span>
          <span class="junk-sheet-chip-meta">Dots ${dot}</span>
        </div>
      `;
      section.appendChild(header);

      const chips = document.createElement('div');
      chips.className = 'junk-sheet-chips';

      ACH.forEach((a) => {
        const input = findAchInput(hole, p, a.id);
        const isOn = !!(input && input.checked);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'junk-sheet-chip';
        btn.dataset.player = String(p);
        btn.dataset.hole = String(hole);
        btn.dataset.key = a.id;
        btn.dataset.active = isOn ? 'true' : 'false';
        btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');

        if (a.auto) {
          const count = getSkinCountFor(hole, p);
          btn.disabled = true;
          btn.classList.add('is-auto');
          const emojiHtml = a.imageUrl 
            ? `<img src="${a.imageUrl}" alt="${a.label}" style="height:1em;width:1em;object-fit:contain;"/>`
            : a.emoji;
          btn.innerHTML = `
            <span class="junk-sheet-chip-emoji">${emojiHtml}</span>
            <span class="junk-sheet-chip-label">${a.label}${count > 0 ? ` ×${count}` : ''}</span>
            <span class="junk-sheet-chip-pts">Auto</span>
          `;
        } else {
          const emojiHtml = a.imageUrl 
            ? `<img src="${a.imageUrl}" alt="${a.label}" style="height:1em;width:1em;object-fit:contain;"/>`
            : a.emoji;
          btn.innerHTML = `
            <span class="junk-sheet-chip-emoji">${emojiHtml}</span>
            <span class="junk-sheet-chip-label">${a.label}</span>
            <span class="junk-sheet-chip-pts">+${a.pts}</span>
          `;
          btn.addEventListener('click', () => {
            const cb = findAchInput(hole, p, a.id);
            if (!cb) return;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            const nowOn = cb.checked;
            btn.dataset.active = nowOn ? 'true' : 'false';
            btn.setAttribute('aria-pressed', nowOn ? 'true' : 'false');
            // Refresh meta dots count (async-safe tiny delay)
            requestAnimationFrame(() => {
              const dotSpan = header.querySelectorAll('.junk-sheet-chip-meta')[1];
              if (dotSpan) dotSpan.textContent = `Dots ${getCellDot(hole, p)}`;
            });
          });
        }
        chips.appendChild(btn);
      });

      section.appendChild(chips);
      body.appendChild(section);
    }
  }

  function openSheet(hole){
    renderSheet(hole);
    document.body.classList.add('junk-sheet-open');
    backdropEl.classList.add('is-open');
    sheetEl.classList.add('is-open');
  }

  function closeSheet(){
    if (!sheetEl) return;
    sheetEl.classList.remove('is-open');
    backdropEl.classList.remove('is-open');
    document.body.classList.remove('junk-sheet-open');
    currentHole = null;
  }

  function activate(){
    document.body.classList.add('junk-sheet-active');

    // Row click delegation on the junk tbody
    document.addEventListener('click', (e) => {
      const tbody = e.target.closest('#junkBody');
      if (!tbody) return;
      // Ignore clicks on form controls inside (shouldn't exist when active, but just in case)
      if (e.target.closest('input, button, select, textarea, details, summary, a')) return;
      const tr = e.target.closest('tr');
      if (!tr) return;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const idx = rows.indexOf(tr);
      if (idx < 0) return;
      openSheet(idx + 1);
    });

    // Mobile 2-column summary layout (hole | all players' dots) — driven by
    // the `.junk-mobile-summary-active` body class. We toggle it based on a
    // media query and rebuild the per-row summary cell.
    const MQ = window.matchMedia('(max-width: 600px)');
    const applyMobile = () => {
      if (MQ.matches) {
        document.body.classList.add('junk-mobile-summary-active');
        buildJunkSummaryRows();
      } else {
        document.body.classList.remove('junk-mobile-summary-active');
        clearJunkSummaryRows();
      }
    };
    try { MQ.addEventListener('change', applyMobile); }
    catch(_) { MQ.addListener(applyMobile); }
    applyMobile();

    // Rebuild summaries when junk data changes or tbody is regenerated.
    const tbody = document.getElementById('junkBody');
    if (tbody) {
      const obs = new MutationObserver(() => {
        if (document.body.classList.contains('junk-mobile-summary-active')) {
          scheduleJunkSummaryUpdate();
        }
      });
      obs.observe(tbody, { childList: true, subtree: true, characterData: true });
    }
    document.addEventListener('input', (e) => {
      if (!document.body.classList.contains('junk-mobile-summary-active')) return;
      if (!e.target) return;
      // Score changes and achievement toggles can affect dots
      if (e.target.classList && (e.target.classList.contains('score-input') || e.target.classList.contains('junk-ach'))) {
        scheduleJunkSummaryUpdate();
      }
    }, { passive: true });
  }

  function scheduleJunkSummaryUpdate(){
    if (scheduleJunkSummaryUpdate._t) cancelAnimationFrame(scheduleJunkSummaryUpdate._t);
    scheduleJunkSummaryUpdate._t = requestAnimationFrame(buildJunkSummaryRows);
  }

  function buildJunkSummaryRows(){
    const tbody = document.getElementById('junkBody');
    if (!tbody) return;
    const names = getPlayerNames();
    const pc = names.length;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.forEach((tr, i) => {
      const h = i + 1;
      let cell = tr.querySelector('.junk-mobile-summary-cell');
      if (!cell) {
        cell = document.createElement('td');
        cell.className = 'junk-mobile-summary-cell';
        tr.appendChild(cell);
      }
      const lines = [];
      for (let p = 0; p < pc; p++){
        const td = document.getElementById(`junk_h${h}_p${p+1}`);
        const dot = td ? (td.querySelector('.junk-dot')?.textContent || td.textContent || '').trim() : '';
        const hasDot = dot && dot !== '—' && dot !== '';
        const nm = escapeHtmlLocal(names[p] || `P${p+1}`);

        // Collect emojis for checked achievements for this player+hole
        const emojis = ACH
          .filter(a => {
            const inp = findAchInput(h, p, a.id);
            return inp && inp.checked;
          })
          .map(a => a.emoji)
          .join('');

        const emojiHtml = emojis
          ? `<span class="junk-mini-emojis">${escapeHtmlLocal(emojis)}</span>`
          : '';

        lines.push(`
          <div class="junk-mini-row${hasDot?'':' is-empty'}">
            <span class="junk-mini-name">${nm}</span>
            <span class="junk-mini-right">${emojiHtml}<span class="junk-mini-dot">${hasDot ? escapeHtmlLocal(dot) : '—'}</span></span>
          </div>
        `);
      }
      cell.innerHTML = lines.join('') || `<span class="junk-mini-empty">Tap to score</span>`;
    });
  }

  function clearJunkSummaryRows(){
    document.querySelectorAll('#junkBody .junk-mobile-summary-cell').forEach(c => c.remove());
  }

  function escapeHtmlLocal(s){
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activate, { once: true });
  } else {
    activate();
  }

  // Expose a tiny API for debugging / manual disable
  window.JunkSheet = {
    open: openSheet,
    close: closeSheet,
    disable() {
      document.body.classList.remove('junk-sheet-active');
    },
    enable() {
      document.body.classList.add('junk-sheet-active');
    }
  };
})();
