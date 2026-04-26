/* ============================================================================
   BANKER BOTTOM SHEET - Mobile-friendly per-hole input
   ============================================================================

   Additive UI layer on top of the existing Banker module. When enabled:
     - Hides the per-hole input cells via CSS (`.banker-sheet-active`)
     - Tapping a banker table row opens a full-width bottom sheet (mobile)
       or a centered modal (>= 720px viewports)
     - The sheet drives the existing inputs/selects/buttons by setting
       .value and dispatching input/change/click events, so existing
       save/compute pipelines run unchanged.

   Features:
     - Banker picker as big player pills
     - Max Bet inline stepper (-/+ buttons + numeric input)
     - Per-opponent card with bet input + 2×/3× toggle + stroke indicator
     - Banker 2×/3× toggle prominently at top
    - Preselect banker from previous-hole low net (always on)
     - "Repeat last hole" shortcut (banker rotation + prior bets)
     - Max Bet default remembers last-used value
     - Live result preview

   To REVERSE:
     - `window.BANKER_BOTTOM_SHEET = false` before this script loads, OR
     - Remove the `<script src="js/banker-sheet.js">` tag from index.html, OR
     - Delete this file and the CSS block in main.css
     - Runtime: `BankerSheet.disable()`

   ============================================================================
 */
(function(){
  'use strict';

  if (window.BANKER_BOTTOM_SHEET === false) return;

  const STORAGE_KEY = 'banker_sheet_prefs_v1';
  const BANKER_PRESELECT_META_KEY = 'banker_preselect_meta_v1';
  const OPEN_TO_BACKDROP_GUARD_MS = 500;

  const DOM_IDS = {
    bankerSelect: (h) => `banker_h${h}`,
    maxBet: (h) => `banker_maxbet_h${h}`,
    bankerDouble: (h) => `banker_double_h${h}`,
    betsCell: (h) => `banker_bets_h${h}`,
    resultCell: (h) => `banker_result_h${h}`,
    betInput: (p, h) => `banker_bet_p${p}_h${h}`,
    playerDouble: (p, h) => `banker_pdouble_p${p}_h${h}`
  };

  let sheetEl = null;
  let backdropEl = null;
  let currentHole = null;
  let lastOpenedAt = 0;
  let prefs = loadPrefs();

  function onBackdropClick(){
    const elapsed = Date.now() - lastOpenedAt;
    if (elapsed >= 0 && elapsed < OPEN_TO_BACKDROP_GUARD_MS) return;
    closeSheet();
  }

  function loadPrefs(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return {
          lastMaxBet: 10,
          bankerManualOverrideByHole: {},
          bankerAutoSelectedFromPrevHole: {}
        };
      }
      const p = JSON.parse(raw);
      return {
        lastMaxBet: Number.isFinite(Number(p.lastMaxBet)) ? Number(p.lastMaxBet) : 10,
        bankerManualOverrideByHole: (p && typeof p.bankerManualOverrideByHole === 'object' && p.bankerManualOverrideByHole)
          ? p.bankerManualOverrideByHole
          : {},
        bankerAutoSelectedFromPrevHole: (p && typeof p.bankerAutoSelectedFromPrevHole === 'object' && p.bankerAutoSelectedFromPrevHole)
          ? p.bankerAutoSelectedFromPrevHole
          : {}
      };
    } catch(_) {
      return {
        lastMaxBet: 10,
        bankerManualOverrideByHole: {},
        bankerAutoSelectedFromPrevHole: {}
      };
    }
  }
  function savePrefs(){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch(_){}
  }

  function loadBankerPreselectMeta(){
    try {
      const raw = localStorage.getItem(BANKER_PRESELECT_META_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        lockedHoles: parsed && typeof parsed.lockedHoles === 'object' && parsed.lockedHoles
          ? parsed.lockedHoles
          : {}
      };
    } catch(_) {
      return { lockedHoles: {} };
    }
  }

  function saveBankerPreselectMeta(meta){
    try {
      localStorage.setItem(BANKER_PRESELECT_META_KEY, JSON.stringify({
        lockedHoles: meta && typeof meta.lockedHoles === 'object' ? meta.lockedHoles : {}
      }));
    } catch(_){}
  }

  function isBankerHoleLocked(hole){
    const meta = loadBankerPreselectMeta();
    return !!meta.lockedHoles[String(Number(hole))];
  }

  function lockBankerHole(hole){
    const key = String(Number(hole));
    const meta = loadBankerPreselectMeta();
    meta.lockedHoles[key] = true;
    saveBankerPreselectMeta(meta);
  }

  function consumeBankerHole(hole){
    lockBankerHole(hole);
  }

  function getPlayerCount(){
    try { if (typeof window.getPlayerCount === 'function') return window.getPlayerCount(); } catch(_){}
    const rows = document.querySelectorAll('#scorecard .player-row');
    return rows.length || 0;
  }
  function getPlayerNames(){
    const n = getPlayerCount();
    const names = [];
    const rows = document.querySelectorAll('#scorecard .player-row');
    for (let i = 0; i < n; i++){
      const nameInput = rows[i]?.querySelector('.name-edit');
      names.push(nameInput?.value?.trim() || `Player ${i+1}`);
    }
    return names;
  }

  function fireInput(el){ if (el) el.dispatchEvent(new Event('input', { bubbles: true })); }
  function fireChange(el){ if (el) el.dispatchEvent(new Event('change', { bubbles: true })); }
  function fireClick(el){ if (el) el.click(); }

  function getBankerIdx(h){
    const sel = document.getElementById(DOM_IDS.bankerSelect(h));
    const v = sel ? Number(sel.value) : -1;
    return Number.isFinite(v) ? v : -1;
  }
  function setBankerIdx(h, idx, options = {}){
    const sel = document.getElementById(DOM_IDS.bankerSelect(h));
    if (!sel) return;
    sel.value = String(idx);
    if (options.dispatch !== false) fireChange(sel);
  }
  function getMaxBet(h){
    const el = document.getElementById(DOM_IDS.maxBet(h));
    const v = el ? Number(el.value) : NaN;
    return Number.isFinite(v) ? v : 0;
  }
  function setMaxBet(h, value){
    const el = document.getElementById(DOM_IDS.maxBet(h));
    if (!el) return;
    el.value = String(Math.max(0, Math.round(Number(value) || 0)));
    fireInput(el);
  }
  function getBet(p, h){
    const el = document.getElementById(DOM_IDS.betInput(p, h));
    if (!el) return 0;
    const v = Number(el.value);
    return Number.isFinite(v) ? v : 0;
  }
  function setBet(p, h, value){
    const el = document.getElementById(DOM_IDS.betInput(p, h));
    if (!el) return;
    el.value = String(Math.max(0, Math.round(Number(value) || 0)));
    fireInput(el);
  }
  function isPlayerDoubled(p, h){
    const btn = document.getElementById(DOM_IDS.playerDouble(p, h));
    return !!(btn && btn.dataset.active === 'true');
  }
  function togglePlayerDouble(p, h){
    const btn = document.getElementById(DOM_IDS.playerDouble(p, h));
    if (btn) fireClick(btn);
  }
  function isBankerDoubled(h){
    const btn = document.getElementById(DOM_IDS.bankerDouble(h));
    return !!(btn && btn.dataset.active === 'true');
  }
  function toggleBankerDouble(h){
    const btn = document.getElementById(DOM_IDS.bankerDouble(h));
    if (btn) fireClick(btn);
  }
  function getHolePar(h){
    const el = document.querySelector(`#parRow input[data-hole="${h}"]`);
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : null;
  }
  function getHoleGross(p, h){
    const el = document.querySelector(`.score-input[data-player="${p}"][data-hole="${h}"]`);
    const v = el ? Number(el.value) : NaN;
    return Number.isFinite(v) ? v : 0;
  }
  function getResultText(h){
    const cell = document.getElementById(DOM_IDS.resultCell(h));
    return cell ? (cell.textContent || '—').trim() : '—';
  }

  function getHcpMode(){
    const activeBtn = document.querySelector('#bankerHcpModeGroup .hcp-mode-btn[data-active="true"]');
    return activeBtn?.dataset.value || 'rawHandicap';
  }

  function getCourseHandicapByPlayer(){
    const playerCount = getPlayerCount();
    const rows = document.querySelectorAll('#scorecard .player-row');
    const handicaps = [];
    for (let p = 0; p < playerCount; p++) {
      const chInput = rows[p]?.querySelector('.ch-input');
      const ch = (typeof window.getActualHandicapValue === 'function'
        ? window.getActualHandicapValue(chInput)
        : Number(chInput?.value)) || 0;
      handicaps.push(ch);
    }
    return handicaps;
  }

  function getAdjustedHandicapByPlayer(){
    const handicaps = getCourseHandicapByPlayer();
    if (!handicaps.length) return handicaps;
    const minCH = Math.min(...handicaps);
    return handicaps.map((ch) => ch - minCH);
  }

  function getHoleHcpIndex(holeOneBased){
    const arr = window.HCPMEN;
    if (!Array.isArray(arr)) return 1;
    const v = Number(arr[holeOneBased - 1]);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  function strokesOnHoleRawCH(rawCH, holeOneBased){
    if (!rawCH) return 0;

    const holeHcp = getHoleHcpIndex(holeOneBased);
    if (!holeHcp) return 0;

    if (rawCH < 0) {
      const absCH = Math.abs(rawCH);
      const base = Math.floor(absCH / 18);
      const rem = absCH % 18;
      const strokes = base + (holeHcp >= (19 - rem) ? 1 : 0);
      return -strokes;
    }

    const base = Math.floor(rawCH / 18);
    const rem = rawCH % 18;
    return base + (holeHcp <= rem ? 1 : 0);
  }

  function getStrokeIndicatorFor(p, h){
    const mode = getHcpMode();
    if (mode === 'gross') return null;

    const playerCount = getPlayerCount();
    if (p < 0 || p >= playerCount) return null;

    const rawByPlayer = mode === 'playOffLow'
      ? getAdjustedHandicapByPlayer()
      : getCourseHandicapByPlayer();

    const rawCH = Number(rawByPlayer[p]) || 0;
    if (rawCH === 0) return null;

    const strokes = strokesOnHoleRawCH(rawCH, h);
    if (strokes === 0) return null;

    if (strokes > 0) {
      return {
        text: `-${strokes}`,
        title: `Receives ${strokes} stroke${strokes > 1 ? 's' : ''} on this hole`
      };
    }

    const give = Math.abs(strokes);
    return {
      text: `+${give}`,
      title: `Gives ${give} stroke${give > 1 ? 's' : ''} on this hole (plus handicap)`
    };
  }

  function markBankerManualOverride(hole){
    if (!Number.isFinite(Number(hole))) return;
    const key = String(Number(hole));
    if (!prefs.bankerManualOverrideByHole || typeof prefs.bankerManualOverrideByHole !== 'object') {
      prefs.bankerManualOverrideByHole = {};
    }
    if (!prefs.bankerAutoSelectedFromPrevHole || typeof prefs.bankerAutoSelectedFromPrevHole !== 'object') {
      prefs.bankerAutoSelectedFromPrevHole = {};
    }
    prefs.bankerManualOverrideByHole[key] = true;
    delete prefs.bankerAutoSelectedFromPrevHole[key];
    lockBankerHole(hole);
    savePrefs();
  }

  function hasBankerManualOverride(hole){
    const key = String(Number(hole));
    return !!(prefs.bankerManualOverrideByHole && prefs.bankerManualOverrideByHole[key]);
  }

  function setAutoSelectedFromPrevHole(hole, fromHole){
    if (!prefs.bankerAutoSelectedFromPrevHole || typeof prefs.bankerAutoSelectedFromPrevHole !== 'object') {
      prefs.bankerAutoSelectedFromPrevHole = {};
    }
    prefs.bankerAutoSelectedFromPrevHole[String(Number(hole))] = Number(fromHole);
  }

  function clearAutoSelectedFromPrevHole(hole){
    if (!prefs.bankerAutoSelectedFromPrevHole || typeof prefs.bankerAutoSelectedFromPrevHole !== 'object') {
      prefs.bankerAutoSelectedFromPrevHole = {};
      return;
    }
    delete prefs.bankerAutoSelectedFromPrevHole[String(Number(hole))];
  }

  function getBankerSelectionWarning(hole, bankerIdx, names){
    const leaders = hole > 1 ? getPrevHoleLowNetLeaders(hole) : [];
    if (leaders.length > 1) {
      const tieNames = leaders.map((idx) => names[idx] || `Player ${idx + 1}`);
      return `Tie on Hole ${hole - 1} low net (${tieNames.join(', ')}). Select who holed out first.`;
    }
    if (leaders.length === 1) {
      return `Scorecard says Hole ${hole - 1} low net makes ${names[leaders[0]] || `Player ${leaders[0] + 1}`} banker.`;
    }
    return '';
  }

  function getNetScoreForAuto(p, h){
    const gross = getHoleGross(p, h);
    if (!gross) return null;

    const activeMode = getHcpMode();
    const useMode = activeMode === 'playOffLow' ? 'playOffLow' : 'rawHandicap';
    const rawByPlayer = useMode === 'playOffLow'
      ? getAdjustedHandicapByPlayer()
      : getCourseHandicapByPlayer();

    const rawCH = Number(rawByPlayer[p]) || 0;
    const strokes = strokesOnHoleRawCH(rawCH, h);
    return gross - strokes;
  }

  function getPrevHoleLowNetLeaders(nextHole){
    const hole = Number(nextHole);
    if (!Number.isFinite(hole) || hole <= 1) return [];

    const prevHole = hole - 1;
    const playerCount = getPlayerCount();
    let lowNet = null;
    const leaders = [];

    for (let p = 0; p < playerCount; p++) {
      const net = getNetScoreForAuto(p, prevHole);
      if (net == null) continue;
      if (lowNet == null || net < lowNet) {
        lowNet = net;
        leaders.length = 0;
        leaders.push(p);
      } else if (net === lowNet) {
        leaders.push(p);
      }
    }

    return leaders;
  }

  function maybePreselectBankerFromPrevLowNet(hole){
    const h = Number(hole);
    if (!Number.isFinite(h) || h <= 1) return;
    if (!prefs.bankerAutoSelectedFromPrevHole || typeof prefs.bankerAutoSelectedFromPrevHole !== 'object') {
      prefs.bankerAutoSelectedFromPrevHole = {};
    }
    if (hasBankerManualOverride(h)) return;
    if (isBankerHoleLocked(h)) return;
    if (getBankerIdx(h) >= 0) return;

    const leaders = getPrevHoleLowNetLeaders(h);
    if (leaders.length === 1) {
      setBankerIdx(h, leaders[0], { dispatch: false });
      window.Banker?.updateBetInputs?.();
      window.Banker?.update?.();
      setAutoSelectedFromPrevHole(h, h - 1);
      savePrefs();
    } else if (getBankerIdx(h) < 0) {
      clearAutoSelectedFromPrevHole(h);
      savePrefs();
    }
  }

  function pulseAmountShell(inputEl){
    if (!inputEl) return;
    const amountShell = inputEl.closest('.banker-sheet-amount');
    if (!amountShell) return;
    amountShell.classList.remove('banker-sheet-amount-chip-hit');
    // Restart animation reliably on repeated taps.
    void amountShell.offsetWidth;
    amountShell.classList.add('banker-sheet-amount-chip-hit');
    setTimeout(() => {
      amountShell.classList.remove('banker-sheet-amount-chip-hit');
    }, 260);
  }

  function ensureSheet(){
    if (sheetEl) return;
    backdropEl = document.createElement('div');
    backdropEl.className = 'banker-sheet-backdrop';
    backdropEl.addEventListener('click', onBackdropClick);

    sheetEl = document.createElement('div');
    sheetEl.className = 'banker-sheet';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'bankerSheetTitle');
    sheetEl.innerHTML = `
      <div class="banker-sheet-header">
        <div class="banker-sheet-nav">
          <button type="button" class="banker-sheet-navbtn" data-nav="prev" aria-label="Previous hole">‹</button>
          <h3 id="bankerSheetTitle" class="banker-sheet-title">Hole —</h3>
          <button type="button" class="banker-sheet-navbtn" data-nav="next" aria-label="Next hole">›</button>
        </div>
        <button type="button" class="banker-sheet-close" aria-label="Close">✕</button>
      </div>
      <div class="banker-sheet-body"></div>
      <div class="banker-sheet-footer">
        <div class="banker-sheet-footer-actions">
          <button type="button" class="btn banker-sheet-done">Done</button>
        </div>
      </div>
    `;

    sheetEl.querySelector('.banker-sheet-close').addEventListener('click', closeSheet);
    sheetEl.querySelector('.banker-sheet-done').addEventListener('click', closeSheet);
    sheetEl.querySelector('[data-nav="prev"]').addEventListener('click', () => navigateHole(-1));
    sheetEl.querySelector('[data-nav="next"]').addEventListener('click', () => navigateHole(1));

    document.body.appendChild(backdropEl);
    document.body.appendChild(sheetEl);

    document.addEventListener('keydown', (e) => {
      if (!sheetEl.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeSheet();
      else if (e.key === 'ArrowLeft') navigateHole(-1);
      else if (e.key === 'ArrowRight') navigateHole(1);
    });
  }

  function navigateHole(delta){
    if (currentHole == null) return;
    const next = currentHole + delta;
    if (next < 1 || next > 18) return;
    renderSheet(next);
  }

  function renderSheet(hole){
    ensureSheet();
    currentHole = hole;

    // One-time banker preselection for this hole: previous-hole low net winner.
    // Skips if this hole was ever manually overridden.
    maybePreselectBankerFromPrevLowNet(hole);

    const par = getHolePar(hole);
    const playerCount = getPlayerCount();
    const names = getPlayerNames();
    const bankerIdx = getBankerIdx(hole);
    const maxBet = getMaxBet(hole);

    // Ensure each hole starts with a usable max bet so opponent bets can
    // auto-populate. This now runs regardless of banker selection state.
    const maxBetEl = document.getElementById(DOM_IDS.maxBet(hole));
    if (maxBetEl) {
      const currentVal = Number(maxBetEl.value);
      if (!Number.isFinite(currentVal) || currentVal <= 0) {
        const remembered = Number(prefs.lastMaxBet);
        const seed = Number.isFinite(remembered) && remembered > 0 ? remembered : 10;
        setMaxBet(hole, seed);
      }
    }

    const isPar3 = par === 3;
    const multText = isPar3 ? '3×' : '2×';

    sheetEl.querySelector('.banker-sheet-title').textContent =
      `Hole ${hole}${par != null ? ` · Par ${par}` : ''}`;

    const prevBtn = sheetEl.querySelector('[data-nav="prev"]');
    const nextBtn = sheetEl.querySelector('[data-nav="next"]');
    prevBtn.disabled = hole <= 1;
    nextBtn.disabled = hole >= 18;

    const body = sheetEl.querySelector('.banker-sheet-body');
    body.innerHTML = '';

    // ---- Banker picker ----
    const bankerBlock = document.createElement('section');
    bankerBlock.className = 'banker-sheet-block';
    bankerBlock.innerHTML = `<div class="banker-sheet-block-title">Banker</div>`;

    const autoFromPrev = Number(prefs.bankerAutoSelectedFromPrevHole?.[String(hole)]);
    if (
      bankerIdx >= 0 &&
      !isBankerHoleLocked(hole) &&
      !hasBankerManualOverride(hole) &&
      Number.isFinite(autoFromPrev)
    ) {
      const autoLabel = document.createElement('div');
      autoLabel.className = 'banker-sheet-auto-label';
      autoLabel.textContent = `Auto-selected from Hole ${autoFromPrev} low net`;
      bankerBlock.appendChild(autoLabel);
    }

    const warningText = getBankerSelectionWarning(hole, bankerIdx, names);

    const bankerPills = document.createElement('div');
    bankerPills.className = 'banker-sheet-pills';
    for (let p = 0; p < playerCount; p++){
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'banker-sheet-pill banker-sheet-player-pill';
      pill.dataset.active = (p === bankerIdx) ? 'true' : 'false';
      // Tint the pill if this player strokes on this hole and show the
      // stroke pill right next to their name so it is visible whether or
      // not they are currently the banker.
      const pillStroke = getStrokeIndicatorFor(p, hole);
      if (pillStroke && pillStroke.text) {
        const strokeDirClass = pillStroke.text.startsWith('-')
          ? 'is-stroke-down'
          : (pillStroke.text.startsWith('+') ? 'is-stroke-up' : '');
        pill.innerHTML = `<span class="banker-sheet-bet-stroke banker-sheet-pill-stroke ${strokeDirClass}" title="${escapeHtml(pillStroke.title)}">${escapeHtml(pillStroke.text)}</span><span class="banker-sheet-pill-name">${escapeHtml(names[p])}</span>`;
      } else {
        pill.textContent = names[p];
      }
      pill.addEventListener('click', () => {
        setBankerIdx(hole, p);
        markBankerManualOverride(hole);
        renderSheet(hole); // rebuild to show bets
      });
      bankerPills.appendChild(pill);
    }
    bankerBlock.appendChild(bankerPills);

    if (warningText) {
      const warningNote = document.createElement('div');
      warningNote.className = 'banker-sheet-selection-note';
      warningNote.textContent = warningText;
      bankerBlock.appendChild(warningNote);
    }

    body.appendChild(bankerBlock);

    if (bankerIdx < 0) {
      const hint = document.createElement('div');
      hint.className = 'banker-sheet-hint';
      hint.textContent = 'Pick a banker to enter bets.';
      body.appendChild(hint);
      return;
    }

    // ---- Max bet ----
    const maxBlock = document.createElement('section');
    maxBlock.className = 'banker-sheet-block';
    maxBlock.innerHTML = `<div class="banker-sheet-block-title">Max Bet</div>`;
    const maxRow = document.createElement('div');
    maxRow.className = 'banker-sheet-stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'banker-sheet-stepbtn';
    minus.textContent = '−';
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'banker-sheet-stepbtn';
    plus.textContent = '+';
    const amount = document.createElement('div');
    amount.className = 'banker-sheet-amount';
    amount.innerHTML = `<span class="banker-sheet-dollar">$</span><input type="number" inputmode="numeric" min="0" step="1" class="banker-sheet-amount-input" />`;
    const amountInput = amount.querySelector('input');
    amountInput.value = String(maxBet || 0);
    const stepBy = (d) => {
      consumeBankerHole(hole);
      const cur = Number(amountInput.value) || 0;
      // Fixed $5 increments (user can still type any exact value)
      const step = 5;
      // Snap down to nearest multiple of 5 before stepping, so +5 from $7 goes to $10 (not $12)
      const base = d > 0 ? Math.floor(cur / step) * step : Math.ceil(cur / step) * step;
      const next = Math.max(0, base + d * step);
      amountInput.value = String(next);
      setMaxBet(hole, next);
      prefs.lastMaxBet = next;
      savePrefs();
      renderBetCaps();
    };
    minus.addEventListener('click', () => stepBy(-1));
    plus.addEventListener('click', () => stepBy(1));
    amountInput.addEventListener('input', () => {
      consumeBankerHole(hole);
      const v = Math.max(0, Math.round(Number(amountInput.value) || 0));
      setMaxBet(hole, v);
      prefs.lastMaxBet = v;
      savePrefs();
      // live-update cap hints on bets
      renderBetCaps();
    });
    maxRow.appendChild(minus);
    maxRow.appendChild(amount);
    maxRow.appendChild(plus);
    maxBlock.appendChild(maxRow);

    // Max bet quick-chips
    const maxChips = document.createElement('div');
    maxChips.className = 'banker-sheet-suggestions';
    if (hole > 1) {
      const prevMax = getMaxBet(hole - 1);
      if (prevMax > 0 && prevMax !== maxBet) {
        const sameMax = document.createElement('button');
        sameMax.type = 'button';
        sameMax.className = 'banker-sheet-suggestion';
        sameMax.textContent = `Same as last · $${prevMax}`;
        sameMax.addEventListener('click', () => {
          consumeBankerHole(hole);
          amountInput.value = String(prevMax);
          pulseAmountShell(amountInput);
          setMaxBet(hole, prevMax);
          prefs.lastMaxBet = prevMax;
          savePrefs();
          renderBetCaps();
        });
        maxChips.appendChild(sameMax);
      }
    }
    [5, 10, 20, 50].forEach(v => {
      if (v === (Number(amountInput.value)||0)) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'banker-sheet-suggestion banker-sheet-suggestion-muted';
      chip.textContent = `$${v}`;
      chip.addEventListener('click', () => {
        consumeBankerHole(hole);
        amountInput.value = String(v);
        pulseAmountShell(amountInput);
        setMaxBet(hole, v);
        prefs.lastMaxBet = v;
        savePrefs();
        renderBetCaps();
      });
      maxChips.appendChild(chip);
    });
    if (maxChips.children.length) maxBlock.appendChild(maxChips);
    body.appendChild(maxBlock);

    // ---- Banker 2× / 3× ----
    // (Appended AFTER the bets block below so it sits visually under the
    // per-player bet cards, per product decision.)
    const bankerDblBlock = document.createElement('section');
    bankerDblBlock.className = 'banker-sheet-block';
    const bankerDblBtn = document.createElement('button');
    bankerDblBtn.type = 'button';
    bankerDblBtn.className = 'banker-sheet-dblbtn';
    bankerDblBtn.dataset.active = isBankerDoubled(hole) ? 'true' : 'false';
    bankerDblBtn.innerHTML = `<span class="banker-sheet-dblbtn-mult">${multText}</span> <span class="banker-sheet-dblbtn-label">Banker doubles all bets</span>`;
    bankerDblBtn.addEventListener('click', () => {
      consumeBankerHole(hole);
      toggleBankerDouble(hole);
      bankerDblBtn.dataset.active = isBankerDoubled(hole) ? 'true' : 'false';
      updateLiveResult();
    });
    bankerDblBlock.appendChild(bankerDblBtn);
    // NOTE: appended later, after betsBlock

    // ---- Per-opponent cards ----
    const betsBlock = document.createElement('section');
    betsBlock.className = 'banker-sheet-block';
    betsBlock.innerHTML = `<div class="banker-sheet-block-title">Bets</div>`;

    // Default each opponent's bet to the banker's max when empty — do this
    // once on open so players can adjust down instead of up from zero.
    {
      const m = getMaxBet(hole);
      if (m > 0) {
        for (let p = 0; p < playerCount; p++){
          if (p === bankerIdx) continue;
          if (getBet(p, hole) === 0) setBet(p, hole, m);
        }
      }
    }

    const cards = document.createElement('div');
    cards.className = 'banker-sheet-bet-cards';

    for (let p = 0; p < playerCount; p++){
      if (p === bankerIdx) continue;
      const stroke = getStrokeIndicatorFor(p, hole);
      const bet = getBet(p, hole);
      const doubled = isPlayerDoubled(p, hole);

      const card = document.createElement('div');
      card.className = 'banker-sheet-bet-card';
      // Tint the card when the player strokes — green (receives), red (gives).
      if (stroke && stroke.text) {
        if (stroke.text.startsWith('-')) card.classList.add('banker-sheet-bet-card-stroke-down');
        else if (stroke.text.startsWith('+')) card.classList.add('banker-sheet-bet-card-stroke-up');
      }
      card.innerHTML = `
        <div class="banker-sheet-bet-head">
          ${stroke ? `<span class="banker-sheet-bet-stroke" title="${stroke.title}">${stroke.text}</span>` : ''}
          <span class="banker-sheet-bet-name">${names[p]}</span>
        </div>
        <div class="banker-sheet-bet-controls">
          <button type="button" class="banker-sheet-stepbtn banker-sheet-stepbtn-sm" data-step="-1">−</button>
          <div class="banker-sheet-amount banker-sheet-amount-sm">
            <span class="banker-sheet-dollar">$</span>
            <input type="number" inputmode="numeric" min="0" step="1" class="banker-sheet-bet-input" />
          </div>
          <button type="button" class="banker-sheet-stepbtn banker-sheet-stepbtn-sm" data-step="1">+</button>
        </div>
        <div class="banker-sheet-bet-quickchips">
          <button type="button" class="banker-sheet-bet-chip" data-quick="5">$5</button>
          <button type="button" class="banker-sheet-bet-chip" data-quick="10">$10</button>
          <button type="button" class="banker-sheet-bet-chip" data-quick="20">$20</button>
        </div>
        <button type="button" class="banker-sheet-mult-toggle" data-active="${doubled ? 'true' : 'false'}">${multText}</button>
        <div class="banker-sheet-bet-cap"></div>
      `;

      const betInput = card.querySelector('.banker-sheet-bet-input');
      betInput.value = bet > 0 ? String(bet) : '';
      betInput.addEventListener('input', () => {
        consumeBankerHole(hole);
        const v = Math.max(0, Math.round(Number(betInput.value) || 0));
        setBet(p, hole, v);
        updateCardCap(card, p, hole);
        updateLiveResult();
      });
      card.querySelector('[data-step="-1"]').addEventListener('click', () => {
        consumeBankerHole(hole);
        const cur = Number(betInput.value) || 0;
        const step = 5;
        // Snap up to nearest $5 first so -5 from $7 goes to $5 (not $2)
        const base = Math.ceil(cur / step) * step;
        const next = Math.max(0, base - step);
        betInput.value = next > 0 ? String(next) : '';
        setBet(p, hole, next);
        updateCardCap(card, p, hole);
        updateLiveResult();
      });
      card.querySelector('[data-step="1"]').addEventListener('click', () => {
        consumeBankerHole(hole);
        const cur = Number(betInput.value) || 0;
        const m = getMaxBet(hole);
        const step = 5;
        // Snap down to nearest $5 first so +5 from $7 goes to $10 (not $12)
        const base = Math.floor(cur / step) * step;
        const raw = base + step;
        const next = m > 0 ? Math.min(m, raw) : raw;
        betInput.value = String(next);
        setBet(p, hole, next);
        updateCardCap(card, p, hole);
        updateLiveResult();
      });
      const multBtn = card.querySelector('.banker-sheet-mult-toggle');
      multBtn.addEventListener('click', () => {
        consumeBankerHole(hole);
        togglePlayerDouble(p, hole);
        multBtn.dataset.active = isPlayerDoubled(p, hole) ? 'true' : 'false';
        updateLiveResult();
      });

      // Quick-bet chips: $5 / $10 / $20 (tap to set exact value, capped to max)
      card.querySelectorAll('.banker-sheet-bet-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          consumeBankerHole(hole);
          const v = Number(chip.dataset.quick) || 0;
          const m = getMaxBet(hole);
          const next = m > 0 ? Math.min(m, v) : v;
          betInput.value = String(next);
          pulseAmountShell(betInput);
          setBet(p, hole, next);
          updateCardCap(card, p, hole);
          updateLiveResult();
        });
      });

      updateCardCap(card, p, hole);
      cards.appendChild(card);
    }

    betsBlock.appendChild(cards);
    body.appendChild(betsBlock);

    // Banker 2×/3× now sits BELOW the bets (created earlier, appended here)
    body.appendChild(bankerDblBlock);

    // ---- Live result ----
    // Use the same rich markup as the inline summary so styles match
    // (colored player rows, ±$ payout, banker total).
    const resultBlock = document.createElement('section');
    resultBlock.className = 'banker-sheet-block banker-sheet-result-block bss-result-block';
    const liveResultCell = document.getElementById(DOM_IDS.resultCell(hole));
    const liveResultHtml = liveResultCell ? liveResultCell.innerHTML.trim() : '';
    resultBlock.innerHTML = `
      <div class="banker-sheet-block-title">Result</div>
      <div class="banker-sheet-result-text" aria-live="polite">${liveResultHtml || '—'}</div>
    `;
    body.appendChild(resultBlock);

    // Helper closures
    function renderBetCaps(){
      const cardEls = body.querySelectorAll('.banker-sheet-bet-card');
      let idx = 0;
      for (let p = 0; p < playerCount; p++){
        if (p === bankerIdx) continue;
        const el = cardEls[idx++];
        if (el) updateCardCap(el, p, hole);
      }
    }
    function updateLiveResult(){
      const txt = resultBlock.querySelector('.banker-sheet-result-text');
      if (!txt) return;
      // Render compact rows with our own classnames (no legacy CSS conflicts).
      const cell = document.getElementById(DOM_IDS.resultCell(hole));
      if (!cell) { txt.innerHTML = '—'; return; }
      const rowEls = cell.querySelectorAll('.banker-result-row');
      const summaryEl = cell.querySelector('.banker-result-summary');
      const noBetsEl = cell.querySelector('.banker-result-muted');
      const parts = [];
      rowEls.forEach(row => {
        let outcomeCls = 'bsr-tie';
        if (row.classList.contains('is-player-win')) outcomeCls = 'bsr-player-win';
        else if (row.classList.contains('is-banker-win')) outcomeCls = 'bsr-banker-win';
        const nameTxt = (row.querySelector('.banker-result-name')?.textContent || '').trim();
        const scoreTxt = (row.querySelector('.banker-result-score')?.textContent || '').trim();
        const payoutEl = row.querySelector('.banker-result-payout');
        const payoutTxt = (payoutEl?.textContent || '').trim();
        let payoutCls = 'bsr-push';
        if (payoutEl?.classList.contains('banker-payout-positive')) payoutCls = 'bsr-pos';
        else if (payoutEl?.classList.contains('banker-payout-negative')) payoutCls = 'bsr-neg';
        const multTxt = (row.querySelector('.banker-result-mult')?.textContent || '').trim();
        parts.push(
          `<div class="bsr-row ${outcomeCls}">` +
            `<span class="bsr-name">${escapeHtml(nameTxt)}</span>` +
            `<span class="bsr-info">` +
              `<span class="bsr-score">${escapeHtml(scoreTxt)}</span> ` +
              `<span class="bsr-payout ${payoutCls}">${escapeHtml(payoutTxt)}</span>` +
              (multTxt ? ` <span class="bsr-mult">${escapeHtml(multTxt)}</span>` : '') +
            `</span>` +
          `</div>`
        );
      });
      if (summaryEl) {
        let summCls = 'bsr-summ-push';
        if (summaryEl.classList.contains('banker-result-summary-positive')) summCls = 'bsr-summ-pos';
        else if (summaryEl.classList.contains('banker-result-summary-negative')) summCls = 'bsr-summ-neg';
        parts.push(
          `<div class="bsr-summary ${summCls}">${escapeHtml((summaryEl.textContent || '').trim())}</div>`
        );
      }
      if (noBetsEl && parts.length === 0) {
        parts.push(`<div class="bsr-empty">${escapeHtml((noBetsEl.textContent || 'No bets').trim())}</div>`);
      }
      txt.innerHTML = parts.length ? parts.join('') : escapeHtml(getResultText(hole));
    }
  }

  function updateCardCap(card, p, hole){
    const m = getMaxBet(hole);
    const bet = getBet(p, hole);
    const cap = card.querySelector('.banker-sheet-bet-cap');
    if (!cap) return;
    if (m > 0 && bet > m) {
      cap.textContent = `Over max — capped at $${m}`;
      cap.classList.add('is-invalid');
    } else if (m > 0) {
      cap.textContent = `Max $${m}`;
      cap.classList.remove('is-invalid');
    } else {
      cap.textContent = 'No max set';
      cap.classList.remove('is-invalid');
    }
  }

  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function openSheet(hole){
    renderSheet(hole);
    lastOpenedAt = Date.now();

    document.body.classList.add('banker-sheet-open');
    backdropEl.classList.add('is-open');
    sheetEl.classList.add('is-open');
  }

  function closeSheet(){
    if (!sheetEl) return;
    sheetEl.classList.remove('is-open');
    backdropEl.classList.remove('is-open');
    document.body.classList.remove('banker-sheet-open');
    currentHole = null;
  }

  function onTableClick(e){
    // Only intercept rows when the sheet is the active input mode.
    if (!document.body.classList.contains('banker-sheet-active')) {
      if (typeof shouldUseCompactMode === 'function' && shouldUseCompactMode()) {
        activate();
      } else {
        return;
      }
    }
    const targetEl = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!targetEl) return;

    const tbody = targetEl.closest('#bankerBody');
    if (!tbody) return;
    let tr = null;
    let node = targetEl;
    while (node && node !== tbody) {
      if (node.tagName === 'TR' && node.parentElement === tbody) {
        tr = node;
        break;
      }
      node = node.parentElement;
    }
    if (!tr) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const idx = rows.indexOf(tr);
    if (idx < 0) return;
    openSheet(idx + 1);
  }

  function buildSummaryRows(){
    // Bail when compact sheet mode is not active. Also strip any stale
    // summary cells that might have been queued by a prior rAF.
    if (!_active || !document.body.classList.contains('banker-sheet-active')) {
      document.querySelectorAll('#bankerBody .banker-sheet-summary-cell').forEach(td => td.remove());
      document.querySelectorAll('#bankerBody tr.banker-sheet-row-empty').forEach(tr => tr.classList.remove('banker-sheet-row-empty'));
      return;
    }

    // After activating, render a compact desktop-like readout inside the
    // row (banker, max bet, each opponent's bet + 2× state, banker 2×,
    // result) so the hole state is visible at a glance. Tapping the row
    // opens the full bottom sheet for editing.
    const tbody = document.getElementById('bankerBody');
    if (!tbody) return;

    // Disconnect both observers before mutating summary DOM to avoid feedback loops.
    _tableStructureObserver?.disconnect();
    _tbodyObserver?.disconnect();

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const names = getPlayerNames();
    const pc = getPlayerCount();
    rows.forEach((tr, i) => {
      const h = i + 1;

      // Bind directly on each summary row so opening works reliably even when
      // nested rich markup changes inside the cell.
      tr.onclick = (evt) => {
        if (!_active || !document.body.classList.contains('banker-sheet-active')) return;
        const target = evt?.target;
        const interactive = target instanceof Element
          ? target.closest('button, input, select, textarea, a, label')
          : null;
        if (interactive) return;
        openSheet(h);
      };

      let summary = tr.querySelector('.banker-sheet-summary-cell');
      if (!summary) {
        summary = document.createElement('td');
        summary.className = 'banker-sheet-summary-cell';
        summary.colSpan = 5; // covers Banker, Max Bet, Bets, Banker 2×, Result
        tr.appendChild(summary);
      }
      const bankerIdx = getBankerIdx(h);
      const maxBet = getMaxBet(h);
      const bankerDbl = isBankerDoubled(h);
      const par = getHolePar(h);
      const isPar3 = par === 3;
      const multLabel = isPar3 ? '3×' : '2×';

      if (bankerIdx < 0) {
        summary.innerHTML = `<span class="banker-sheet-summary-empty">Tap to set up hole</span>`;
        tr.classList.add('banker-sheet-row-empty');
        return;
      }

      tr.classList.remove('banker-sheet-row-empty');
      const bankerName = escapeHtml(names[bankerIdx] || `P${bankerIdx+1}`);
      let activeBetCount = 0;
      let totalBetAmount = 0;
      let doubledBetCount = 0;
      // Banker's own stroke status (green tint when receiving, red when giving)
      const bankerStroke = getStrokeIndicatorFor(bankerIdx, h);
      const showTabletStrokeIndicator = window.matchMedia('(min-width: 481px)').matches;
      let bankerStrokeCls = '';
      let bankerStrokeChipCls = '';
      let bankerStrokeInlineHtml = '';
      if (bankerStroke && bankerStroke.text) {
        if (bankerStroke.text.startsWith('-')) {
          bankerStrokeCls = ' bss-bet-stroke-down';
          bankerStrokeChipCls = ' is-stroke-down';
        } else if (bankerStroke.text.startsWith('+')) {
          bankerStrokeCls = ' bss-bet-stroke-up';
          bankerStrokeChipCls = ' is-stroke-up';
        }
        if (showTabletStrokeIndicator) {
          bankerStrokeInlineHtml = ` <span class="bss-bet-stroke bss-bet-stroke-inline${bankerStrokeChipCls}" title="${escapeHtml(bankerStroke.title)}">${escapeHtml(bankerStroke.text)}</span>`;
        }
      }

      // Per-opponent bets table (aligned 4-column grid: name | stroke | amount | 2x).
      // Each row uses `display: contents` so columns align across all rows.
      const betItems = [];
      for (let p = 0; p < pc; p++){
        if (p === bankerIdx) continue;
        const b = getBet(p, h);
        const dbl = isPlayerDoubled(p, h);
        const stroke = getStrokeIndicatorFor(p, h);
        const nm = escapeHtml(names[p] || `P${p+1}`);
        const amt = b > 0 ? `$${b}` : '—';
        if (b > 0) {
          activeBetCount += 1;
          totalBetAmount += b;
        }
        if (dbl) doubledBetCount += 1;
        const strokeHtml = '';
        let strokeChipCls = '';
        if (stroke && stroke.text) {
          if (stroke.text.startsWith('-')) strokeChipCls = ' is-stroke-down';
          else if (stroke.text.startsWith('+')) strokeChipCls = ' is-stroke-up';
        }
        const strokeInlineHtml = (showTabletStrokeIndicator && stroke)
          ? ` <span class="bss-bet-stroke bss-bet-stroke-inline${strokeChipCls}" title="${escapeHtml(stroke.title)}">${escapeHtml(stroke.text)}</span>`
          : '';
        const multHtml = dbl ? `<span class="bss-bet-mult">${multLabel}</span>` : '';
        // Derive stroke direction so we can tint the whole row on tablet
        // widths (green = receiving a stroke, red = giving a stroke).
        let strokeCls = '';
        if (stroke && stroke.text) {
          if (stroke.text.startsWith('-')) strokeCls = ' bss-bet-stroke-down';
          else if (stroke.text.startsWith('+')) strokeCls = ' bss-bet-stroke-up';
        }
        betItems.push(`
          <div class="bss-bet-line${b>0?'':' bss-bet-empty'}${dbl?' bss-bet-dbl':''}${strokeCls}">
            <span class="bss-bet-stroke-slot">${strokeHtml}</span>
            <span class="bss-bet-name">${nm}${strokeInlineHtml}</span>
            <span class="bss-bet-amt">${amt}</span>
            <span class="bss-bet-mult-slot">${multHtml}</span>
          </div>
        `);
      }

      // Result: parse the existing result cell's DOM and re-render with our
      // OWN compact classnames (.bsr-row / .bsr-name / .bsr-info / .bsr-summary)
      // so no legacy CSS can interfere with the layout. Each row is a single
      // line spanning the full cell width with name + result on one line.
      const resultCellEl = document.getElementById(DOM_IDS.resultCell(h));
      let resultBlock;
      if (resultCellEl) {
        const rowEls = resultCellEl.querySelectorAll('.banker-result-row');
        const summaryEl = resultCellEl.querySelector('.banker-result-summary');
        const noBetsEl = resultCellEl.querySelector('.banker-result-muted');
        const parts = [];
        rowEls.forEach(row => {
          // Determine outcome class for color
          let outcomeCls = 'bsr-tie';
          if (row.classList.contains('is-player-win')) outcomeCls = 'bsr-player-win';
          else if (row.classList.contains('is-banker-win')) outcomeCls = 'bsr-banker-win';
          const nameTxt = (row.querySelector('.banker-result-name')?.textContent || '').trim();
          const scoreTxt = (row.querySelector('.banker-result-score')?.textContent || '').trim();
          const payoutEl = row.querySelector('.banker-result-payout');
          const payoutTxt = (payoutEl?.textContent || '').trim();
          let payoutCls = 'bsr-push';
          if (payoutEl?.classList.contains('banker-payout-positive')) payoutCls = 'bsr-pos';
          else if (payoutEl?.classList.contains('banker-payout-negative')) payoutCls = 'bsr-neg';
          const multTxt = (row.querySelector('.banker-result-mult')?.textContent || '').trim();
          // Force layout via inline styles so no legacy CSS can shrink the
          // bar. The colored bar must always span the cell width.
          // Negative horizontal margin absorbs the .bss-col-result/.bss-grid
          // padding so the bar literally touches the table cell border.
          const rowStyle = 'display:flex;flex-wrap:nowrap;align-items:baseline;justify-content:space-between;width:auto;box-sizing:border-box;padding:4px 10px;margin:0 -8px 3px;gap:8px;border-radius:0;border-left:4px solid;white-space:nowrap;overflow:hidden;min-height:24px;';
          const nameStyle = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;';
          const infoStyle = 'flex:0 0 auto;text-align:right;white-space:nowrap;margin-left:auto;';
          parts.push(
            `<div class="bsr-row ${outcomeCls}" style="${rowStyle}">` +
              `<span class="bsr-name" style="${nameStyle}">${escapeHtml(nameTxt)}</span>` +
              `<span class="bsr-info" style="${infoStyle}">` +
                `<span class="bsr-score">${escapeHtml(scoreTxt)}</span> ` +
                `<span class="bsr-payout ${payoutCls}">${escapeHtml(payoutTxt)}</span>` +
                (multTxt ? ` <span class="bsr-mult">${escapeHtml(multTxt)}</span>` : '') +
              `</span>` +
            `</div>`
          );
        });
        if (summaryEl) {
          let summCls = 'bsr-summ-push';
          if (summaryEl.classList.contains('banker-result-summary-positive')) summCls = 'bsr-summ-pos';
          else if (summaryEl.classList.contains('banker-result-summary-negative')) summCls = 'bsr-summ-neg';
          const summStyle = 'display:block;width:100%;box-sizing:border-box;padding:4px 8px;margin-top:4px;font-weight:700;font-size:13px;border-top:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          parts.push(
            `<div class="bsr-summary ${summCls}" style="${summStyle}">${escapeHtml((summaryEl.textContent || '').trim())}</div>`
          );
        }
        if (noBetsEl && parts.length === 0) {
          parts.push(`<div class="bsr-empty">${escapeHtml((noBetsEl.textContent || 'No bets').trim())}</div>`);
        }
        const blockStyle = 'display:block;width:100%;max-width:100%;box-sizing:border-box;';
        resultBlock = parts.length
          ? `<div class="bss-result-block" style="${blockStyle}">${parts.join('')}</div>`
          : `<div class="bss-result-block bss-result-empty" style="${blockStyle}">—</div>`;
      } else {
        resultBlock = `<div class="bss-result-block bss-result-empty">—</div>`;
      }

      summary.innerHTML = `
        <div class="bss-grid">
          <div class="bss-col bss-col-banker${bankerStrokeCls}">
            <div class="bss-col-label">Banker</div>
            <div class="bss-banker-name">🏦 ${bankerName}${bankerStrokeInlineHtml}</div>
            <div class="bss-max-inline">Max $${maxBet || 0}</div>
          </div>
          <div class="bss-col bss-col-max">
            <div class="bss-col-label">Max</div>
            <div class="bss-max-val">$${maxBet || 0}</div>
          </div>
          <div class="bss-col bss-col-bets">
            <div class="bss-col-label">Bets</div>
            <div class="bss-bet-p2x-label">P2X</div>
            <div class="bss-bet-list">${betItems.join('') || '<span class="bss-bet-empty">—</span>'}</div>
          </div>
          <div class="bss-col bss-col-bdbl">
            <div class="bss-col-label">B2X</div>
            <div class="bss-bdbl-val${bankerDbl?' is-on':''}">${bankerDbl ? multLabel : '—'}</div>
          </div>
          <div class="bss-col bss-col-result" style="grid-column:1 / -1;width:100%;max-width:100%;box-sizing:border-box;padding-left:0;padding-right:0;">
            <div class="bss-col-label">Result</div>
            ${resultBlock}
          </div>
        </div>
      `;

      // PHONE OVERRIDE: at phone widths the grid layout was leaving the
      // result block stuck at intrinsic width even with width:100% all the
      // way down. Bypass the grid entirely and emit the result block as
      // the only child of the td so it stretches naturally.
      const phone = window.matchMedia('(max-width: 480px)').matches;
      if (phone) {
        if (pc >= 5) {
          const summaryText = (resultCellEl?.querySelector('.banker-result-summary')?.textContent || '').trim();
          const compactResult = summaryText || (activeBetCount > 0 ? `${activeBetCount} active bet${activeBetCount === 1 ? '' : 's'}` : 'No bets');
          const compactB2x = bankerDbl ? multLabel : '—';
          summary.style.padding = '4px 0';
          summary.innerHTML = `
            <div class="bss-phone-compact" role="note" aria-label="Banker hole summary">
              <span class="bss-phone-chip bss-phone-chip-banker" title="Banker">🏦 ${bankerName}</span>
              <span class="bss-phone-chip" title="Max bet">Max $${maxBet || 0}</span>
              <span class="bss-phone-chip" title="Total bets">Bets ${activeBetCount}/${Math.max(0, pc - 1)} · $${totalBetAmount}</span>
              <span class="bss-phone-chip" title="Opponent doubles">P2X ${doubledBetCount}</span>
              <span class="bss-phone-chip" title="Banker double">B2X ${compactB2x}</span>
            </div>
            <div class="bss-phone-compact-result">${escapeHtml(compactResult)}</div>
          `;
          return;
        }

        summary.style.padding = '4px 0';
        summary.innerHTML = resultBlock || '<span class="banker-sheet-summary-empty">—</span>';
        // Force the result block to fill the td content area
        const direct = summary.firstElementChild;
        if (direct) {
          direct.style.cssText =
            'display:block;' +
            'width:100%;' +
            'max-width:100%;' +
            'box-sizing:border-box;' +
            'padding:0;' +
            'margin:0;';
          // Also force every direct child (.bsr-row / .bsr-summary) to fill
          Array.from(direct.children).forEach(child => {
            if (child.classList.contains('bsr-row')) {
              child.style.width = '100%';
              child.style.margin = '0 0 3px 0';
              child.style.boxSizing = 'border-box';
            } else if (child.classList.contains('bsr-summary')) {
              child.style.width = '100%';
              child.style.margin = '4px 0 0 0';
              child.style.boxSizing = 'border-box';
            }
          });
        }
      }
    });

    // Reconnect both observers after all DOM mutations are complete.
    const bankerTableEl = document.getElementById('bankerTable');
    if (_tableStructureObserver && bankerTableEl) {
      _tableStructureObserver.observe(bankerTableEl, { childList: true, subtree: true });
    }
    if (_tbodyObserver) {
      _tbodyObserver.observe(tbody, { childList: true, subtree: true });
    }
  }

  // Re-render summaries whenever banker state could have changed.
  function scheduleSummaryUpdate(){
    if (scheduleSummaryUpdate._t) cancelAnimationFrame(scheduleSummaryUpdate._t);
    scheduleSummaryUpdate._t = requestAnimationFrame(buildSummaryRows);
  }

  function refreshOpenSheetForScorecardChange(){
    scheduleSummaryUpdate();
    if (currentHole != null) renderSheet(currentHole);
  }

  let _active = false;
  let _listenersBound = false;
  let _tbodyObserver = null;
  let _tbodyAttachObserver = null;
  let _tableStructureObserver = null;
  let _startupSummaryTimers = [];

  function scheduleStartupSummaryPasses(){
    _startupSummaryTimers.forEach((t) => clearTimeout(t));
    _startupSummaryTimers = [];

    const run = () => {
      if (!_active) return;
      ensureTbodyObserverAndSummaries();
      buildSummaryRows();
    };

    _startupSummaryTimers.push(setTimeout(run, 0));
    _startupSummaryTimers.push(setTimeout(run, 120));
    _startupSummaryTimers.push(setTimeout(run, 320));
  }

  function ensureTbodyObserverAndSummaries(){
    const table = document.getElementById('bankerTable');
    if (table && !_tableStructureObserver) {
      _tableStructureObserver = new MutationObserver(() => {
        if (!_active) return;
        ensureTbodyObserverAndSummaries();
      });
      _tableStructureObserver.observe(table, { childList: true, subtree: true });
    }

    const tbody = document.getElementById('bankerBody');

    if (!tbody) {
      if (!_tbodyAttachObserver && document.body) {
        _tbodyAttachObserver = new MutationObserver(() => {
          if (!_active) return;
          ensureTbodyObserverAndSummaries();
        });
        _tbodyAttachObserver.observe(document.body, { childList: true, subtree: true });
      }
      return false;
    }

    if (_tbodyAttachObserver) {
      _tbodyAttachObserver.disconnect();
      _tbodyAttachObserver = null;
    }

    const observedTbody = _tbodyObserver?._tbody || null;
    if (!_tbodyObserver || observedTbody !== tbody) {
      _tbodyObserver?.disconnect();
      _tbodyObserver = new MutationObserver(() => {
        if (_active) scheduleSummaryUpdate();
      });
      _tbodyObserver.observe(tbody, { childList: true, subtree: true });
      _tbodyObserver._tbody = tbody;
    }

    scheduleSummaryUpdate();
    return true;
  }

  function activate(){
    if (_active) return;
    _active = true;
    document.body.classList.add('banker-sheet-active');

    if (!_listenersBound) {
      _listenersBound = true;
      // Bind row click delegation (guarded by banker-sheet-active in handler)
      document.addEventListener('click', onTableClick);
      document.addEventListener('pointerup', onTableClick, true);

      // Also update on any save event the app fires
      document.addEventListener('input', (e) => {
        if (!_active) return;
        const target = e.target;
        if (!target) return;
        if (target.id && target.id.startsWith('banker_')) {
          scheduleSummaryUpdate();
          return;
        }
        if (target.classList?.contains('score-input') ||
            target.classList?.contains('ch-input') ||
            target.classList?.contains('name-edit')) {
          refreshOpenSheetForScorecardChange();
        }
      }, { passive: true });
      document.addEventListener('change', (e) => {
        if (!_active) return;
        const target = e.target;
        if (!target) return;
        if (target.id && target.id.startsWith('banker_')) {
          scheduleSummaryUpdate();
          return;
        }
        if (target.classList?.contains('score-input') ||
            target.classList?.contains('ch-input') ||
            target.classList?.contains('name-edit')) {
          refreshOpenSheetForScorecardChange();
        }
      }, { passive: true });
    }

    // Ensure summaries initialize even if banker tbody is created after activation.
    ensureTbodyObserverAndSummaries();
    scheduleStartupSummaryPasses();
  }

  function deactivate(){
    if (!_active) return;
    _active = false;
    _startupSummaryTimers.forEach((t) => clearTimeout(t));
    _startupSummaryTimers = [];
    if (scheduleSummaryUpdate._t) {
      cancelAnimationFrame(scheduleSummaryUpdate._t);
      scheduleSummaryUpdate._t = null;
    }
    document.body.classList.remove('banker-sheet-active');
    _tbodyObserver?.disconnect();
    _tbodyObserver = null;
    _tableStructureObserver?.disconnect();
    _tableStructureObserver = null;
    if (_tbodyAttachObserver) {
      _tbodyAttachObserver.disconnect();
      _tbodyAttachObserver = null;
    }
    // Close any open sheet
    try { closeSheet(); } catch(_) {}
    // Remove summary cells so the original banker inputs are fully visible again
    document.querySelectorAll('#bankerBody .banker-sheet-summary-cell').forEach(td => td.remove());
    document.querySelectorAll('#bankerBody tr.banker-sheet-row-empty').forEach(tr => tr.classList.remove('banker-sheet-row-empty'));
  }

  // Compact mode should activate for true tablet/phone widths OR whenever
  // the banker table cannot fully fit its container (desktop but cramped).
  const COMPACT_MQ = window.matchMedia('(max-width: 1023px)');

  function isBankerTableCramped(){
    const table = document.getElementById('bankerTable');
    const wrap = table ? table.closest('.banker-wrap') : null;
    if (!table || !wrap) return false;
    return table.scrollWidth > (wrap.clientWidth + 1);
  }

  function shouldUseCompactMode(){
    return COMPACT_MQ.matches || isBankerTableCramped();
  }

  function applyViewportMode(){
    if (shouldUseCompactMode()) {
      activate();
    } else {
      deactivate();
    }
  }

  try {
    COMPACT_MQ.addEventListener('change', applyViewportMode);
  } catch(_) {
    // Safari < 14 fallback
    COMPACT_MQ.addListener(applyViewportMode);
  }

  // Some browsers/devtools resize paths can skip firing MediaQueryList
  // "change" consistently when crossing breakpoints. Re-run mode sync on
  // resize/orientation to guarantee cleanup when returning to desktop width.
  window.addEventListener('resize', applyViewportMode, { passive: true });
  window.addEventListener('orientationchange', applyViewportMode, { passive: true });
  document.addEventListener('golf:game-tab-changed', (e) => {
    if (!_active) return;
    if (e?.detail?.game !== 'banker') return;
    scheduleStartupSummaryPasses();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyViewportMode, { once: true });
  } else {
    applyViewportMode();
  }

  window.BankerSheet = {
    open: openSheet,
    close: closeSheet,
    enable: activate,
    disable: deactivate,
    refreshSummaries: buildSummaryRows
  };
})();
