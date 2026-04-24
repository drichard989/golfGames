/* ============================================================================
   SCORECARD BOTTOM SHEET - Mobile-friendly score entry
   ============================================================================

   Additive UI layer over existing score inputs. On mobile, tapping a score cell
   opens a bottom sheet editor with large controls.

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
  const MOBILE_QUERY = '(max-width: 768px)';

  let isMobileMode = false;
  let currentInput = null;
  let draftValue = '';

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
    const input = document.querySelector(`#parRow input[data-hole="${holeOneBased}"]`);
    const val = Number(input?.value);
    return Number.isFinite(val) && val > 0 ? val : null;
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

  function triggerRecalcAndSave() {
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
        <h3 id="scoreSheetTitle" class="score-sheet-title">Score Entry</h3>
        <button type="button" class="score-sheet-navbtn" data-nav="next" aria-label="Next hole">&gt;</button>
        <button type="button" class="score-sheet-close" aria-label="Close">x</button>
      </div>

      <div class="score-sheet-body">
        <div class="score-sheet-meta">
          <div class="score-sheet-meta-item"><span class="score-sheet-meta-label">Player</span><span id="scoreSheetPlayer" class="score-sheet-meta-value">-</span></div>
          <div class="score-sheet-meta-item"><span class="score-sheet-meta-label">Hole</span><span id="scoreSheetHole" class="score-sheet-meta-value">-</span></div>
          <div class="score-sheet-meta-item"><span class="score-sheet-meta-label">Par</span><span id="scoreSheetPar" class="score-sheet-meta-value">-</span></div>
        </div>

        <div id="scoreSheetStrokeWrap" class="score-sheet-stroke" hidden>
          <span id="scoreSheetStroke" class="score-sheet-stroke-pill">-</span>
        </div>

        <div class="score-sheet-editor">
          <button type="button" class="score-sheet-stepbtn" data-step="-1">-</button>
          <input id="scoreSheetValue" type="number" inputmode="numeric" min="1" max="20" placeholder="-" />
          <button type="button" class="score-sheet-stepbtn" data-step="1">+</button>
        </div>

        <div class="score-sheet-quick" id="scoreSheetQuick"></div>
      </div>

      <div class="score-sheet-footer">
        <button type="button" class="btn" id="scoreSheetClearBtn">Clear</button>
        <button type="button" class="btn" id="scoreSheetSaveBtn">Save</button>
        <button type="button" class="btn" id="scoreSheetSaveNextBtn">Save and Next</button>
      </div>
    `;

    sheetEl.querySelector('.score-sheet-close')?.addEventListener('click', closeSheet);
    sheetEl.querySelector('[data-nav="prev"]')?.addEventListener('click', () => navigateHole(-1));
    sheetEl.querySelector('[data-nav="next"]')?.addEventListener('click', () => navigateHole(1));

    sheetEl.querySelector('[data-step="-1"]')?.addEventListener('click', () => nudgeDraft(-1));
    sheetEl.querySelector('[data-step="1"]')?.addEventListener('click', () => nudgeDraft(1));

    const valueInput = sheetEl.querySelector('#scoreSheetValue');
    valueInput?.addEventListener('input', () => {
      draftValue = String(valueInput.value || '').trim();
    });

    sheetEl.querySelector('#scoreSheetClearBtn')?.addEventListener('click', () => {
      draftValue = '';
      renderSheet();
    });

    sheetEl.querySelector('#scoreSheetSaveBtn')?.addEventListener('click', () => {
      commitDraft(false);
    });

    sheetEl.querySelector('#scoreSheetSaveNextBtn')?.addEventListener('click', () => {
      commitDraft(true);
    });

    document.addEventListener('keydown', (e) => {
      if (!sheetEl?.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeSheet();
    });

    document.body.appendChild(backdropEl);
    document.body.appendChild(sheetEl);
  }

  function getCurrentLocation() {
    if (!currentInput) return null;
    const playerIdx = Number(currentInput.dataset.player);
    const holeOneBased = Number(currentInput.dataset.hole);
    if (!Number.isFinite(playerIdx) || !Number.isFinite(holeOneBased)) return null;
    return { playerIdx, holeOneBased };
  }

  function openForInput(inputEl) {
    if (!isMobileMode || !inputEl) return;
    if (inputEl.disabled || inputEl.readOnly) return;

    ensureSheet();
    currentInput = inputEl;
    draftValue = String(inputEl.value || '').trim();

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
    currentInput = null;
    draftValue = '';
  }

  function nudgeDraft(delta) {
    const current = toScoreOrNull(draftValue);
    if (current == null) {
      draftValue = String(delta > 0 ? MIN_SCORE : MAX_SCORE);
    } else {
      draftValue = String(Math.max(MIN_SCORE, Math.min(MAX_SCORE, current + delta)));
    }
    renderSheet();
  }

  function buildQuickButtons() {
    const quick = sheetEl?.querySelector('#scoreSheetQuick');
    if (!quick) return;
    quick.innerHTML = '';

    [3, 4, 5, 6, 7, 8, 9, 10].forEach((score) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'score-sheet-quick-btn';
      btn.textContent = String(score);
      if (String(score) === String(draftValue)) {
        btn.dataset.active = 'true';
      }
      btn.addEventListener('click', () => {
        draftValue = String(score);
        renderSheet();
      });
      quick.appendChild(btn);
    });
  }

  function getStrokeIndicator(inputEl) {
    if (!inputEl) return null;
    const strokes = Number(inputEl.dataset.strokes || 0);
    if (!Number.isFinite(strokes) || strokes <= 0) return null;

    if (inputEl.classList.contains('receives-stroke')) {
      return {
        tone: 'down',
        text: `Receives ${strokes} stroke${strokes > 1 ? 's' : ''}`
      };
    }

    if (inputEl.classList.contains('gives-stroke')) {
      return {
        tone: 'up',
        text: `Gives ${strokes} stroke${strokes > 1 ? 's' : ''}`
      };
    }

    return null;
  }

  function renderSheet() {
    if (!sheetEl || !currentInput) return;

    if (!document.contains(currentInput)) {
      closeSheet();
      return;
    }

    const loc = getCurrentLocation();
    if (!loc) {
      closeSheet();
      return;
    }

    const { playerIdx, holeOneBased } = loc;
    const playerName = getPlayerName(playerIdx);
    const par = getPar(holeOneBased);

    const title = sheetEl.querySelector('#scoreSheetTitle');
    const playerEl = sheetEl.querySelector('#scoreSheetPlayer');
    const holeEl = sheetEl.querySelector('#scoreSheetHole');
    const parEl = sheetEl.querySelector('#scoreSheetPar');
    const valueEl = sheetEl.querySelector('#scoreSheetValue');
    const strokeWrapEl = sheetEl.querySelector('#scoreSheetStrokeWrap');
    const strokeEl = sheetEl.querySelector('#scoreSheetStroke');

    if (title) title.textContent = `Score - ${playerName}`;
    if (playerEl) playerEl.textContent = playerName;
    if (holeEl) holeEl.textContent = String(holeOneBased);
    if (parEl) parEl.textContent = par == null ? '-' : String(par);
    if (valueEl) valueEl.value = draftValue;

    if (strokeWrapEl && strokeEl) {
      const stroke = getStrokeIndicator(currentInput);
      strokeWrapEl.hidden = !stroke;
      strokeEl.classList.remove('is-down', 'is-up');
      if (stroke) {
        strokeEl.textContent = stroke.text;
        strokeEl.classList.add(stroke.tone === 'down' ? 'is-down' : 'is-up');
      }
    }

    const prevHoleInput = getScoreInput(playerIdx, holeOneBased - 1);
    const nextHoleInput = getScoreInput(playerIdx, holeOneBased + 1);

    const prevBtn = sheetEl.querySelector('[data-nav="prev"]');
    const nextBtn = sheetEl.querySelector('[data-nav="next"]');
    if (prevBtn) prevBtn.disabled = !prevHoleInput;
    if (nextBtn) nextBtn.disabled = !nextHoleInput;

    buildQuickButtons();
  }

  function navigateHole(delta) {
    const loc = getCurrentLocation();
    if (!loc) return;
    const target = getScoreInput(loc.playerIdx, loc.holeOneBased + delta);
    if (!target) return;
    currentInput = target;
    draftValue = String(target.value || '').trim();
    renderSheet();
  }

  function getAdvanceTarget(inputEl) {
    if (!inputEl) return null;

    const player = Number(inputEl.dataset.player);
    const hole = Number(inputEl.dataset.hole);
    if (!Number.isFinite(player) || !Number.isFinite(hole)) return null;

    const direction = window.GolfApp?.config?.ADVANCE_DIRECTION || 'down';
    if (direction === 'disabled') return null;

    if (direction === 'right') {
      if (hole >= HOLES) return null;
      return getScoreInput(player, hole + 1);
    }

    const playerCount = getPlayerCount();
    if (player + 1 >= playerCount) return null;
    return getScoreInput(player + 1, hole);
  }

  function commitDraft(goNext) {
    if (!currentInput) return;

    const targetInput = currentInput;
    const score = toScoreOrNull(draftValue);
    targetInput.value = score == null ? '' : String(score);
    targetInput.classList.remove('invalid');

    triggerRecalcAndSave();

    if (!goNext) {
      closeSheet();
      return;
    }

    const nextInput = getAdvanceTarget(targetInput);
    if (!nextInput) {
      closeSheet();
      return;
    }

    currentInput = nextInput;
    draftValue = String(nextInput.value || '').trim();
    renderSheet();
  }

  function onScoreInputPointerDown(e) {
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

    const input = e.target.closest('#scorecard .score-input');
    if (!(input instanceof HTMLInputElement)) return;
    if (input.disabled || input.readOnly) return;

    input.blur();
    openForInput(input);
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
    const onMqChange = () => applyMode(mq.matches);

    try { mq.addEventListener('change', onMqChange); }
    catch (_) { mq.addListener(onMqChange); }

    applyMode(mq.matches);

    document.addEventListener('pointerdown', onScoreInputPointerDown, true);
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
