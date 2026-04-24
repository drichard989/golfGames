/* ============================================================================
   SCORECARD BOTTOM SHEET - Mobile-friendly score entry
   ============================================================================

   Additive UI layer over existing score inputs. On mobile, tapping a score cell
   opens a per-hole bottom sheet that shows all players in a responsive grid.

   Revert options:
     - Set `window.SCORE_BOTTOM_SHEET = false` before this script loads, OR
     - Remove `<script src="js/score-sheet.js">` from index.html, OR
     - Remove `stylesheet/score-sheet.css` + this file.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SCORE_BOTTOM_SHEET === false) return;

  const HOLES = 18;
  const MIN_SCORE = 1;
  const MAX_SCORE = 20;
  const MOBILE_QUERY = '(max-width: 1024px)';
  const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

  let isMobileMode = false;
  let currentHole = null;
  let focusPlayerIdx = 0;
  let draftScoresByPlayer = {};
  let syncFrame = null;

  let backdropEl = null;
  let sheetEl = null;

  function getPlayerCount() {
    return document.querySelectorAll('#scorecardFixed .player-row').length;
  }

  function getPlayerName(playerIdx) {
    const row = document.querySelector(`#scorecardFixed .player-row[data-player="${playerIdx}"]`);
    const name = row?.querySelector('.name-edit')?.value?.trim();
    return name || `Player ${playerIdx + 1}`;
  }

  function getPar(holeOneBased) {
    if (!Number.isFinite(holeOneBased) || holeOneBased < 1 || holeOneBased > HOLES) return null;

    // Prefer canonical course data over DOM scraping.
    const parsFromConfig = window.GolfApp?.config?.pars;
    const configPar = Number(parsFromConfig?.[holeOneBased - 1]);
    if (Number.isFinite(configPar) && configPar > 0) return configPar;

    const globalPar = Number(window.PARS?.[holeOneBased - 1]);
    if (Number.isFinite(globalPar) && globalPar > 0) return globalPar;

    const parRow = document.querySelector('#parRow');
    const parCell = parRow?.children?.[holeOneBased - 1] || null;
    const parInput = parCell?.querySelector?.('input');
    const domPar = Number(parInput?.value || parCell?.textContent);
    return Number.isFinite(domPar) && domPar > 0 ? domPar : null;
  }

  function getHoleHcp(holeOneBased) {
    if (!Number.isFinite(holeOneBased) || holeOneBased < 1 || holeOneBased > HOLES) return null;

    const hcpFromConfig = window.GolfApp?.config?.hcpMen;
    const configHcp = Number(hcpFromConfig?.[holeOneBased - 1]);
    if (Number.isFinite(configHcp) && configHcp > 0) return configHcp;

    const globalHcp = Number(window.HCPMEN?.[holeOneBased - 1]);
    if (Number.isFinite(globalHcp) && globalHcp > 0) return globalHcp;

    const hcpRow = document.querySelector('#hcpRow');
    const hcpCell = hcpRow?.children?.[holeOneBased - 1] || null;
    const hcpInput = hcpCell?.querySelector?.('input');
    const domHcp = Number(hcpInput?.value || hcpCell?.textContent);
    return Number.isFinite(domHcp) && domHcp > 0 ? domHcp : null;
  }

  function getScoreInput(playerIdx, holeOneBased) {
    return document.querySelector(`.score-input[data-player="${playerIdx}"][data-hole="${holeOneBased}"]`);
  }

  function toScoreOrNull(value) {
    if (value == null) return null;
    const str = String(value).trim();
    if (!str) return null;
    const n = Number(str);
    if (!Number.isFinite(n)) return null;
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(n)));
  }

  function getGrossResultLabel(score, par) {
    if (!Number.isFinite(score)) return 'Gross -';
    if (!Number.isFinite(par) || par <= 0) return `Gross ${score}`;

    const diff = score - par;
    let result;
    if (diff <= -3) result = 'Double Eagle';
    else if (diff === -2) result = 'Eagle';
    else if (diff === -1) result = 'Birdie';
    else if (diff === 0) result = 'Par';
    else if (diff === 1) result = 'Bogey';
    else if (diff === 2) result = 'Double Bogey';
    else if (diff === 3) result = 'Triple Bogey';
    else if (diff === 4) result = 'Quadruple Bogey';
    else result = 'Beyond Quad';

    return `Gross ${score} - ${result}`;
  }

  function updateGrossLabel(playerIdx, rawValue) {
    if (!sheetEl || !Number.isFinite(currentHole)) return;
    const labelEl = sheetEl.querySelector(`.score-sheet-gross-label[data-player="${playerIdx}"]`);
    if (!labelEl) return;

    const par = getPar(currentHole);
    const gross = toScoreOrNull(rawValue);
    labelEl.textContent = getGrossResultLabel(gross, par);
  }

  function queueRecalcAndSave() {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => {
      syncFrame = null;
      try {
        window.GolfApp?.scorecard?.calc?.recalcAll?.(true);
      } catch (_) {}
      try {
        window.GolfApp?.appManager?.recalcGames?.();
      } catch (_) {}
      try {
        window.GolfApp?.scorecard?.build?.syncRowHeights?.(true);
      } catch (_) {}
      try {
        window.saveDebounced?.();
      } catch (_) {}
    });
  }

  function getStrokeIndicator(inputEl) {
    if (!inputEl) return null;
    const strokes = Number(inputEl.dataset.strokes || 0);
    if (!Number.isFinite(strokes) || strokes <= 0) return null;

    if (inputEl.classList.contains('receives-stroke')) {
      return {
        tone: 'down',
        text: `-${strokes}`,
        title: `Receives ${strokes} stroke${strokes > 1 ? 's' : ''}`
      };
    }

    if (inputEl.classList.contains('gives-stroke')) {
      return {
        tone: 'up',
        text: `+${strokes}`,
        title: `Gives ${strokes} stroke${strokes > 1 ? 's' : ''}`
      };
    }

    return null;
  }

  function ensureSheet() {
    if (sheetEl && backdropEl) return;

    backdropEl = document.createElement('div');
    backdropEl.className = 'score-sheet-backdrop';
    backdropEl.addEventListener('click', closeSheet);

    sheetEl = document.createElement('div');
    sheetEl.className = 'score-sheet';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'scoreSheetTitle');
    sheetEl.innerHTML = `
      <div class="score-sheet-header">
        <button type="button" class="score-sheet-navbtn" data-nav="prev" aria-label="Previous hole">&lt;</button>
        <h3 id="scoreSheetTitle" class="score-sheet-title">Hole Scores</h3>
        <button type="button" class="score-sheet-navbtn" data-nav="next" aria-label="Next hole">&gt;</button>
        <button type="button" class="score-sheet-close" aria-label="Close">x</button>
      </div>

      <div class="score-sheet-body">
        <div class="score-sheet-hole-card" role="status" aria-live="polite">
          <div class="score-sheet-hole-stat"><span class="score-sheet-meta-label">Hole</span><span id="scoreSheetHole" class="score-sheet-meta-value">-</span></div>
          <div class="score-sheet-hole-stat"><span class="score-sheet-meta-label">Par</span><span id="scoreSheetPar" class="score-sheet-meta-value">-</span></div>
          <div class="score-sheet-hole-stat"><span class="score-sheet-meta-label">HCP</span><span id="scoreSheetHcp" class="score-sheet-meta-value">-</span></div>
        </div>

        <div id="scoreSheetGrid" class="score-sheet-grid"></div>
      </div>

      <div class="score-sheet-footer">
        <button type="button" class="btn" id="scoreSheetCloseBtn">Done</button>
      </div>
    `;

    sheetEl.querySelector('.score-sheet-close')?.addEventListener('click', closeSheet);
    sheetEl.querySelector('#scoreSheetCloseBtn')?.addEventListener('click', closeSheet);
    sheetEl.querySelector('[data-nav="prev"]')?.addEventListener('click', () => navigateHole(-1));
    sheetEl.querySelector('[data-nav="next"]')?.addEventListener('click', () => navigateHole(1));

    sheetEl.addEventListener('click', onSheetClick);
    sheetEl.addEventListener('input', onSheetInput);
    sheetEl.addEventListener('keydown', onSheetKeydown);

    document.addEventListener('keydown', (e) => {
      if (!sheetEl?.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeSheet();
    });

    document.body.appendChild(backdropEl);
    document.body.appendChild(sheetEl);
  }

  function openForInput(inputEl) {
    if (!isMobileMode || !inputEl) return;
    if (inputEl.disabled || inputEl.readOnly) return;

    const hole = Number(inputEl.dataset.hole);
    const player = Number(inputEl.dataset.player);
    if (!Number.isFinite(hole) || !Number.isFinite(player)) return;

    ensureSheet();
    currentHole = hole;
    focusPlayerIdx = player;
    loadDraftForHole(currentHole);
    renderSheet();

    document.body.classList.add('score-sheet-open');
    backdropEl.classList.add('is-open');
    sheetEl.classList.add('is-open');
  }

  function closeSheet() {
    if (!sheetEl || !backdropEl) return;
    sheetEl.classList.remove('is-open');
    backdropEl.classList.remove('is-open');
    document.body.classList.remove('score-sheet-open');
    currentHole = null;
    draftScoresByPlayer = {};
  }

  function loadDraftForHole(holeOneBased) {
    draftScoresByPlayer = {};
    const par = getPar(holeOneBased);
    const fallback = par == null ? '' : String(par);
    const playerCount = getPlayerCount();

    for (let p = 0; p < playerCount; p++) {
      const input = getScoreInput(p, holeOneBased);
      const raw = String(input?.value || '').trim();
      draftScoresByPlayer[p] = raw || fallback;
    }
  }

  function applyPlayerScore(playerIdx) {
    if (!Number.isFinite(currentHole)) return;
    const input = getScoreInput(playerIdx, currentHole);
    if (!input) return;

    const score = toScoreOrNull(draftScoresByPlayer[playerIdx]);
    input.value = score == null ? '' : String(score);
    input.classList.remove('invalid');

    queueRecalcAndSave();
  }

  function updatePlayerDraft(playerIdx, nextValue, applyNow = true) {
    draftScoresByPlayer[playerIdx] = String(nextValue == null ? '' : nextValue).trim();
    if (applyNow) applyPlayerScore(playerIdx);
  }

  function nudgePlayer(playerIdx, delta) {
    const current = toScoreOrNull(draftScoresByPlayer[playerIdx]);
    let next;
    if (current == null) {
      next = delta > 0 ? MIN_SCORE : MAX_SCORE;
    } else {
      next = Math.max(MIN_SCORE, Math.min(MAX_SCORE, current + delta));
    }

    updatePlayerDraft(playerIdx, next, true);
    renderSheet();
  }

  function renderGrid(holeOneBased) {
    const grid = sheetEl?.querySelector('#scoreSheetGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const par = getPar(holeOneBased);
    const playerCount = getPlayerCount();
    for (let p = 0; p < playerCount; p++) {
      const input = getScoreInput(p, holeOneBased);
      const stroke = getStrokeIndicator(input);
      const val = draftScoresByPlayer[p] == null ? '' : String(draftScoresByPlayer[p]);

      const card = document.createElement('section');
      card.className = 'score-sheet-player-card';
      if (p === focusPlayerIdx) card.classList.add('is-focus-player');

      let strokeHtml = '';
      if (stroke) {
        const cls = stroke.tone === 'down' ? 'is-down' : 'is-up';
        strokeHtml = `<span class="score-sheet-card-stroke ${cls}" title="${stroke.title}">${stroke.text}</span>`;
      }

      const gross = toScoreOrNull(val);
      const grossLabel = getGrossResultLabel(gross, par);

      card.innerHTML = `
        <div class="score-sheet-card-head">
          <span class="score-sheet-card-name">${getPlayerName(p)}</span>
          ${strokeHtml}
        </div>
        <div class="score-sheet-card-controls">
          <button type="button" class="score-sheet-stepbtn score-sheet-stepbtn-sm" data-player="${p}" data-step="-1">-</button>
          <div class="score-sheet-score-col">
            <div class="score-sheet-gross-label" data-player="${p}">${grossLabel}</div>
            <input class="score-sheet-player-input" data-player="${p}" type="number" inputmode="numeric" min="${MIN_SCORE}" max="${MAX_SCORE}" value="${val}" />
          </div>
          <button type="button" class="score-sheet-stepbtn score-sheet-stepbtn-sm" data-player="${p}" data-step="1">+</button>
        </div>
      `;

      grid.appendChild(card);
    }
  }

  function renderSheet() {
    if (!sheetEl || !Number.isFinite(currentHole)) return;

    const par = getPar(currentHole);
    const holeHcp = getHoleHcp(currentHole);
    const title = sheetEl.querySelector('#scoreSheetTitle');
    const holeEl = sheetEl.querySelector('#scoreSheetHole');
    const parEl = sheetEl.querySelector('#scoreSheetPar');
    const hcpEl = sheetEl.querySelector('#scoreSheetHcp');

    if (title) title.textContent = `Hole ${currentHole} Scores`;
    if (holeEl) holeEl.textContent = String(currentHole);
    if (parEl) parEl.textContent = par == null ? '-' : String(par);
    if (hcpEl) hcpEl.textContent = holeHcp == null ? '-' : String(holeHcp);

    const prevBtn = sheetEl.querySelector('[data-nav="prev"]');
    const nextBtn = sheetEl.querySelector('[data-nav="next"]');
    if (prevBtn) prevBtn.disabled = currentHole <= 1;
    if (nextBtn) nextBtn.disabled = currentHole >= HOLES;

    renderGrid(currentHole);
  }

  function focusPlayerInput(playerIdx) {
    if (!sheetEl || !Number.isFinite(playerIdx)) return;
    const input = sheetEl.querySelector(`.score-sheet-player-input[data-player="${playerIdx}"]`);
    if (!(input instanceof HTMLInputElement)) return;
    input.focus();
    try { input.select(); } catch (_) {}
  }

  function navigateHole(delta, playerToFocus) {
    if (!Number.isFinite(currentHole)) return;
    const nextHole = currentHole + delta;
    if (nextHole < 1 || nextHole > HOLES) return;
    currentHole = nextHole;
    loadDraftForHole(currentHole);
    renderSheet();

    if (Number.isFinite(playerToFocus)) {
      requestAnimationFrame(() => {
        focusPlayerInput(playerToFocus);
      });
    }
  }

  function onSheetClick(e) {
    const stepBtn = e.target.closest('.score-sheet-stepbtn[data-player]');
    if (stepBtn) {
      const player = Number(stepBtn.dataset.player);
      const step = Number(stepBtn.dataset.step);
      if (!Number.isFinite(player) || !Number.isFinite(step)) return;
      nudgePlayer(player, step);
      return;
    }
  }

  function onSheetInput(e) {
    const input = e.target.closest('.score-sheet-player-input');
    if (!(input instanceof HTMLInputElement)) return;
    const player = Number(input.dataset.player);
    if (!Number.isFinite(player)) return;

    focusPlayerIdx = player;
    updatePlayerDraft(player, input.value, true);
    updateGrossLabel(player, input.value);
  }

  function onSheetKeydown(e) {
    if (e.key !== 'Enter') return;

    const input = e.target.closest('.score-sheet-player-input');
    if (!(input instanceof HTMLInputElement)) return;

    const player = Number(input.dataset.player);
    if (!Number.isFinite(player)) return;

    e.preventDefault();
    focusPlayerIdx = player;
    updatePlayerDraft(player, input.value, true);

    if (currentHole >= HOLES) return;
    navigateHole(1, player);
  }

  function onScoreInputClick(e) {
    if (!isMobileMode) return;

    const input = e.target.closest('#scorecard .score-input');
    if (!(input instanceof HTMLInputElement)) return;
    if (input.disabled || input.readOnly) return;

    e.preventDefault();
    e.stopPropagation();
    input.blur();
    openForInput(input);
  }

  function onScoreInputFocusIn(e) {
    if (!isMobileMode) return;
    // Keep native focus behavior during drag/scroll; modal opens from deliberate tap.
  }

  function applyMode(isMobile) {
    isMobileMode = !!isMobile;
    document.body.classList.toggle('score-sheet-active', isMobileMode);
    if (!isMobileMode) {
      closeSheet();
    }
  }

  function activate() {
    ensureSheet();

    const mq = window.matchMedia(MOBILE_QUERY);
    const touchMq = window.matchMedia(TOUCH_QUERY);
    const onMqChange = () => applyMode(mq.matches || touchMq.matches);

    try { mq.addEventListener('change', onMqChange); }
    catch (_) { mq.addListener(onMqChange); }
    try { touchMq.addEventListener('change', onMqChange); }
    catch (_) { touchMq.addListener(onMqChange); }

    applyMode(mq.matches || touchMq.matches);

    document.addEventListener('click', onScoreInputClick, true);
    document.addEventListener('focusin', onScoreInputFocusIn, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activate, { once: true });
  } else {
    activate();
  }

  window.ScoreSheet = {
    openForInput,
    close: closeSheet
  };
})();
