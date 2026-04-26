/* ============================================================================
   WOLF BOTTOM SHEET - Mobile-friendly per-hole decision input
   ============================================================================

   Additive UI layer on top of the existing Wolf module. When enabled:
     - Hides row-level Wolf/Decision/Result columns on mobile via CSS
       (`.wolf-sheet-active`)
     - Tapping a Wolf row opens a bottom sheet for that hole
     - The sheet updates the existing select control and dispatches change
       events so save/recompute pipelines stay unchanged.

   To disable:
     - Set `window.WOLF_BOTTOM_SHEET = false` before this script loads, OR
     - Remove the <script src="js/wolf-sheet.js"> tag from index.html, OR
     - Remove stylesheet/wolf.css + this file.
   ============================================================================ */
(function(){
  'use strict';

  if (window.WOLF_BOTTOM_SHEET === false) return;

  const HOLES = 18;
  const MOBILE_QUERY = '(max-width: 720px)';
  const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';
  const OPEN_TO_BACKDROP_GUARD_MS = 900;
  const AUTO_CLOSE_LOCK_MS = 1600;

  let sheetEl = null;
  let backdropEl = null;
  let currentHole = null;
  let isMobileMode = false;
  let summaryObserver = null;
  let lastOpenedAt = 0;
  let viewportMq = null;
  let coarseTouchMq = null;

  function supportsTouchInput(){
    try {
      return (
        ('ontouchstart' in window) ||
        Number(navigator.maxTouchPoints || 0) > 0 ||
        Number(navigator.msMaxTouchPoints || 0) > 0
      );
    } catch (_) {
      return false;
    }
  }

  function shouldEnableSheetMode(){
    const byViewport = !!viewportMq?.matches;
    const byCoarsePointer = !!coarseTouchMq?.matches;
    const byTouchCapability = supportsTouchInput();
    const viewportWidth = Math.min(
      Number(window.innerWidth) || Number.POSITIVE_INFINITY,
      Number(window.visualViewport?.width) || Number.POSITIVE_INFINITY
    );

    // Keep the bottom-sheet interaction for true phone-sized layouts only.
    // Touch tablets should keep the full table columns visible.
    return viewportWidth <= 720 && (byViewport || byCoarsePointer || byTouchCapability);
  }

  function onBackdropClick(){
    const elapsed = Date.now() - lastOpenedAt;
    if (elapsed >= 0 && elapsed < OPEN_TO_BACKDROP_GUARD_MS) return;
    closeSheet('backdrop');
  }

  function getPlayerCount(){
    return document.querySelectorAll('#scorecard .player-row').length;
  }

  function getPlayerNames(){
    const rows = Array.from(document.querySelectorAll('#scorecard .player-row'));
    return rows.map((row, idx) => {
      const name = row.querySelector('.name-edit')?.value?.trim();
      return name || `Player ${idx + 1}`;
    });
  }

  function getWolfName(holeOneBased){
    const cell = document.getElementById(`wolfName_h${holeOneBased}`);
    const txt = (cell?.textContent || '').trim();
    return txt || '-';
  }

  function getDecisionSelect(holeOneBased){
    return document.querySelector(`.wolf-decision[data-hole="${holeOneBased - 1}"]`);
  }

  function getDecisionLabel(holeOneBased){
    const sel = getDecisionSelect(holeOneBased);
    if (!sel) return '-';
    const opt = sel.options[sel.selectedIndex];
    const txt = (opt?.textContent || '').trim();
    return txt && txt !== '-' ? txt : 'No decision';
  }

  function getResultLabel(holeOneBased){
    const cell = document.getElementById(`wolfResult_h${holeOneBased}`);
    const txt = (cell?.textContent || '').trim();
    return txt || '-';
  }

  function getHolePar(holeOneBased){
    const el = document.querySelector(`#parRow input[data-hole="${holeOneBased}"]`);
    const v = Number(el?.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function getHoleScore(playerIdx, holeOneBased){
    const el = document.querySelector(`.score-input[data-player="${playerIdx}"][data-hole="${holeOneBased}"]`);
    const v = Number(el?.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function fireChange(el){
    if (!el) return;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function escapeHtml(text){
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureSheet(){
    if (sheetEl) return;

    backdropEl = document.createElement('div');
    backdropEl.className = 'wolf-sheet-backdrop';
    backdropEl.addEventListener('click', onBackdropClick);

    sheetEl = document.createElement('div');
    sheetEl.className = 'wolf-sheet';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'wolfSheetTitle');
    sheetEl.innerHTML = `
      <div class="wolf-sheet-header">
        <div class="wolf-sheet-nav">
          <button type="button" class="wolf-sheet-navbtn" data-nav="prev" aria-label="Previous hole">&lt;</button>
          <h3 id="wolfSheetTitle" class="wolf-sheet-title">Hole -</h3>
          <button type="button" class="wolf-sheet-navbtn" data-nav="next" aria-label="Next hole">&gt;</button>
        </div>
        <button type="button" class="wolf-sheet-close" aria-label="Close">x</button>
      </div>
      <div class="wolf-sheet-body"></div>
      <div class="wolf-sheet-footer">
        <button type="button" class="btn wolf-sheet-done">Done</button>
      </div>
    `;

    sheetEl.querySelector('.wolf-sheet-close')?.addEventListener('click', () => closeSheet('explicit'));
    sheetEl.querySelector('.wolf-sheet-done')?.addEventListener('click', () => closeSheet('explicit'));
    sheetEl.querySelector('[data-nav="prev"]')?.addEventListener('click', () => navigateHole(-1));
    sheetEl.querySelector('[data-nav="next"]')?.addEventListener('click', () => navigateHole(1));

    document.body.appendChild(backdropEl);
    document.body.appendChild(sheetEl);

    document.addEventListener('keydown', (e) => {
      if (!sheetEl?.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeSheet('escape');
      else if (e.key === 'ArrowLeft') navigateHole(-1);
      else if (e.key === 'ArrowRight') navigateHole(1);
    });
  }

  function navigateHole(delta){
    if (currentHole == null) return;
    const next = currentHole + delta;
    if (next < 1 || next > HOLES) return;
    renderSheet(next);
  }

  function setDecision(holeOneBased, decisionValue){
    const sel = getDecisionSelect(holeOneBased);
    if (!sel || sel.disabled) return;
    sel.value = decisionValue;
    fireChange(sel);
  }

  function buildDecisionButtons(holeOneBased, container){
    const sel = getDecisionSelect(holeOneBased);
    if (!sel || sel.disabled) {
      const hint = document.createElement('div');
      hint.className = 'wolf-sheet-empty';
      hint.textContent = 'Wolf decisions require exactly 4 players.';
      container.appendChild(hint);
      return;
    }

    const group = document.createElement('div');
    group.className = 'wolf-sheet-decisions';

    Array.from(sel.options).forEach((opt) => {
      const val = String(opt.value || '');
      if (!val || val === 'none') return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wolf-sheet-decision-btn';
      btn.dataset.active = sel.value === val ? 'true' : 'false';
      btn.textContent = (opt.textContent || '').trim();
      btn.addEventListener('click', () => {
        setDecision(holeOneBased, val);
        renderSheet(holeOneBased);
      });
      group.appendChild(btn);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'wolf-sheet-clear-btn';
    clearBtn.textContent = 'Clear decision';
    clearBtn.disabled = sel.value === 'none';
    clearBtn.addEventListener('click', () => {
      setDecision(holeOneBased, 'none');
      renderSheet(holeOneBased);
    });

    container.appendChild(group);
    container.appendChild(clearBtn);
  }

  function buildScoresBlock(holeOneBased, container){
    const names = getPlayerNames();
    const playerCount = getPlayerCount();

    const block = document.createElement('section');
    block.className = 'wolf-sheet-block';
    block.innerHTML = '<div class="wolf-sheet-block-title">Hole Scores</div>';

    const list = document.createElement('div');
    list.className = 'wolf-sheet-scores';

    for (let p = 0; p < playerCount; p++) {
      const score = getHoleScore(p, holeOneBased);
      const row = document.createElement('div');
      row.className = 'wolf-sheet-score-row';
      row.innerHTML = `
        <span class="wolf-sheet-score-name">${escapeHtml(names[p] || `P${p + 1}`)}</span>
        <span class="wolf-sheet-score-val">${score == null ? '-' : score}</span>
      `;
      list.appendChild(row);
    }

    if (!playerCount) {
      const empty = document.createElement('div');
      empty.className = 'wolf-sheet-empty';
      empty.textContent = 'No players found.';
      list.appendChild(empty);
    }

    block.appendChild(list);
    container.appendChild(block);
  }

  function renderSheet(holeOneBased){
    ensureSheet();
    currentHole = holeOneBased;

    const par = getHolePar(holeOneBased);
    const title = `Hole ${holeOneBased}${par != null ? ` - Par ${par}` : ''}`;
    const wolfName = getWolfName(holeOneBased);
    const result = getResultLabel(holeOneBased);

    sheetEl.querySelector('.wolf-sheet-title').textContent = title;

    const prevBtn = sheetEl.querySelector('[data-nav="prev"]');
    const nextBtn = sheetEl.querySelector('[data-nav="next"]');
    if (prevBtn) prevBtn.disabled = holeOneBased <= 1;
    if (nextBtn) nextBtn.disabled = holeOneBased >= HOLES;

    const body = sheetEl.querySelector('.wolf-sheet-body');
    if (!body) return;
    body.innerHTML = '';

    const overview = document.createElement('section');
    overview.className = 'wolf-sheet-block';
    overview.innerHTML = `
      <div class="wolf-sheet-overview-grid">
        <div class="wolf-sheet-overview-item">
          <div class="wolf-sheet-overview-label">Who Is The Wolf</div>
          <div class="wolf-sheet-overview-value">${escapeHtml(wolfName)}</div>
        </div>
      </div>
    `;
    body.appendChild(overview);

    const decisionsBlock = document.createElement('section');
    decisionsBlock.className = 'wolf-sheet-block';
    decisionsBlock.innerHTML = '<div class="wolf-sheet-block-title">Set Decision</div>';
    buildDecisionButtons(holeOneBased, decisionsBlock);
    body.appendChild(decisionsBlock);

    const resultBlock = document.createElement('section');
    resultBlock.className = 'wolf-sheet-block';
    resultBlock.innerHTML = `
      <div class="wolf-sheet-overview-grid">
        <div class="wolf-sheet-overview-item">
          <div class="wolf-sheet-overview-label">Result</div>
          <div class="wolf-sheet-overview-value">${escapeHtml(result)}</div>
        </div>
      </div>
    `;
    body.appendChild(resultBlock);

    buildScoresBlock(holeOneBased, body);
  }

  function openSheet(holeOneBased){
    if (!isMobileMode) return;
    renderSheet(holeOneBased);
    lastOpenedAt = Date.now();
    document.body.classList.add('wolf-sheet-open');
    backdropEl.classList.add('is-open');
    sheetEl.classList.add('is-open');
  }

  function closeSheet(reason = 'unknown'){
    if (!sheetEl || !backdropEl) return;
    const elapsed = Date.now() - lastOpenedAt;
    const isExplicit = reason === 'explicit';
    if (!isExplicit && elapsed >= 0 && elapsed < AUTO_CLOSE_LOCK_MS) return;

    sheetEl.classList.remove('is-open');
    backdropEl.classList.remove('is-open');
    document.body.classList.remove('wolf-sheet-open');
    currentHole = null;
  }

  function buildSummaryRows(){
    const tbody = document.getElementById('wolfBody');
    if (!tbody) return;

    // Disconnect observer before mutating summary DOM to avoid feedback loops.
    summaryObserver?.disconnect();

    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.forEach((tr, idx) => {
      const hole = idx + 1;
      let summaryCell = tr.querySelector('.wolf-sheet-summary-cell');
      if (!summaryCell) {
        summaryCell = document.createElement('td');
        summaryCell.className = 'wolf-sheet-summary-cell';
        tr.appendChild(summaryCell);
      }

      const wolfName = getWolfName(hole);
      const decision = getDecisionLabel(hole);
      const result = getResultLabel(hole);

      summaryCell.innerHTML = `
        <div class="wolf-summary-grid">
          <div class="wolf-summary-line"><span class="wolf-summary-label">Wolf</span><span class="wolf-summary-value">${escapeHtml(wolfName)}</span></div>
          <div class="wolf-summary-line"><span class="wolf-summary-label">Decision</span><span class="wolf-summary-value">${escapeHtml(decision)}</span></div>
          <div class="wolf-summary-line"><span class="wolf-summary-label">Result</span><span class="wolf-summary-value">${escapeHtml(result)}</span></div>
        </div>
      `;
    });

    // Reconnect observer after mutations are complete.
    if (summaryObserver) {
      summaryObserver.observe(tbody, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  function scheduleSummaryBuild(){
    if (scheduleSummaryBuild._raf) cancelAnimationFrame(scheduleSummaryBuild._raf);
    scheduleSummaryBuild._raf = requestAnimationFrame(buildSummaryRows);
  }

  function onTableClick(e){
    if (!isMobileMode) return;
    const tbody = e.target.closest('#wolfBody');
    if (!tbody) return;
    if (e.target.closest('input, button, select, textarea, a')) return;

    const tr = e.target.closest('tr');
    if (!tr) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const idx = rows.indexOf(tr);
    if (idx < 0) return;

    openSheet(idx + 1);
  }

  function applyMode(){
    isMobileMode = shouldEnableSheetMode();
    document.body.classList.toggle('wolf-sheet-active', isMobileMode);

    if (!isMobileMode && !sheetEl?.classList.contains('is-open')) {
      closeSheet('mode-change');
      return;
    }

    buildSummaryRows();
  }

  function activate(){
    ensureSheet();

    viewportMq = window.matchMedia(MOBILE_QUERY);
    coarseTouchMq = window.matchMedia(TOUCH_QUERY);
    const onMq = () => applyMode();

    try { viewportMq.addEventListener('change', onMq); }
    catch (_) { viewportMq.addListener(onMq); }
    try { coarseTouchMq.addEventListener('change', onMq); }
    catch (_) { coarseTouchMq.addListener(onMq); }
    onMq();

    document.addEventListener('click', onTableClick);

    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.classList.contains('name-edit')
          || t.classList.contains('score-input')
          || t.classList.contains('ch-input')
          || t.closest('#parRow')) {
        scheduleSummaryBuild();
        if (currentHole != null && sheetEl?.classList.contains('is-open')) {
          renderSheet(currentHole);
        }
      }
    }, { passive: true });

    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.classList.contains('wolf-decision')) {
        scheduleSummaryBuild();
        if (currentHole != null && sheetEl?.classList.contains('is-open')) {
          renderSheet(currentHole);
        }
      }
    });

    const tbody = document.getElementById('wolfBody');
    if (tbody && !summaryObserver) {
      summaryObserver = new MutationObserver(() => {
        if (!isMobileMode) return;
        scheduleSummaryBuild();
      });
      summaryObserver.observe(tbody, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    scheduleSummaryBuild();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activate, { once: true });
  } else {
    activate();
  }

  window.WolfSheet = {
    refresh: scheduleSummaryBuild,
    open: openSheet,
    close: () => closeSheet('explicit')
  };
})();
