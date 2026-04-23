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
     - Auto-rotate banker (opt-in, persisted)
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
  let prefs = loadPrefs();

  function loadPrefs(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { autoRotate: false, lastMaxBet: 10 };
      const p = JSON.parse(raw);
      return {
        autoRotate: !!p.autoRotate,
        lastMaxBet: Number.isFinite(Number(p.lastMaxBet)) ? Number(p.lastMaxBet) : 10
      };
    } catch(_) {
      return { autoRotate: false, lastMaxBet: 10 };
    }
  }
  function savePrefs(){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch(_){}
  }

  function getPlayerCount(){
    try { if (typeof window.getPlayerCount === 'function') return window.getPlayerCount(); } catch(_){}
    const rows = document.querySelectorAll('#scorecardFixed .player-row');
    return rows.length || 0;
  }
  function getPlayerNames(){
    const n = getPlayerCount();
    const names = [];
    const rows = document.querySelectorAll('#scorecardFixed .player-row');
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
  function setBankerIdx(h, idx){
    const sel = document.getElementById(DOM_IDS.bankerSelect(h));
    if (!sel) return;
    sel.value = String(idx);
    fireChange(sel);
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
  function getResultText(h){
    const cell = document.getElementById(DOM_IDS.resultCell(h));
    return cell ? (cell.textContent || '—').trim() : '—';
  }
  function getStrokeIndicatorFor(p, h){
    // The existing banker.js renders a .banker-inline-stroke-pill inside
    // .banker-stroke-slot[data-player][data-hole] when net handicap is active.
    const slot = document.querySelector(`.banker-stroke-slot[data-player="${p}"][data-hole="${h}"]`);
    if (!slot) return null;
    const pill = slot.querySelector('.banker-inline-stroke-pill');
    if (!pill) return null;
    return { text: pill.textContent || '', title: pill.title || '' };
  }

  function ensureSheet(){
    if (sheetEl) return;
    backdropEl = document.createElement('div');
    backdropEl.className = 'banker-sheet-backdrop';
    backdropEl.addEventListener('click', closeSheet);

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
        <label class="banker-sheet-autorotate">
          <input type="checkbox" class="banker-sheet-autorotate-cb" />
          <span>Auto-rotate banker</span>
        </label>
        <div class="banker-sheet-footer-actions">
          <button type="button" class="btn banker-sheet-done">Done</button>
        </div>
      </div>
    `;

    sheetEl.querySelector('.banker-sheet-close').addEventListener('click', closeSheet);
    sheetEl.querySelector('.banker-sheet-done').addEventListener('click', closeSheet);
    sheetEl.querySelector('[data-nav="prev"]').addEventListener('click', () => navigateHole(-1));
    sheetEl.querySelector('[data-nav="next"]').addEventListener('click', () => navigateHole(1));

    const autoCb = sheetEl.querySelector('.banker-sheet-autorotate-cb');
    autoCb.checked = !!prefs.autoRotate;
    autoCb.addEventListener('change', () => {
      prefs.autoRotate = !!autoCb.checked;
      savePrefs();
    });

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

    const par = getHolePar(hole);
    const playerCount = getPlayerCount();
    const names = getPlayerNames();
    const bankerIdx = getBankerIdx(hole);
    const maxBet = getMaxBet(hole);

    // If this hole has no banker yet and the max bet is still 0 or default,
    // seed it with the remembered default.
    const maxBetEl = document.getElementById(DOM_IDS.maxBet(hole));
    if (maxBetEl && bankerIdx < 0) {
      const currentVal = Number(maxBetEl.value);
      if (!Number.isFinite(currentVal) || currentVal <= 0 || currentVal === 10) {
        // Only replace the default "10" if user hasn't customized this hole yet
        if (prefs.lastMaxBet && prefs.lastMaxBet !== currentVal) {
          setMaxBet(hole, prefs.lastMaxBet);
        }
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
    const bankerPills = document.createElement('div');
    bankerPills.className = 'banker-sheet-pills';
    for (let p = 0; p < playerCount; p++){
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'banker-sheet-pill banker-sheet-player-pill';
      pill.dataset.active = (p === bankerIdx) ? 'true' : 'false';
      pill.textContent = names[p];
      pill.addEventListener('click', () => {
        setBankerIdx(hole, p);
        renderSheet(hole); // rebuild to show bets
      });
      bankerPills.appendChild(pill);
    }
    bankerBlock.appendChild(bankerPills);

    // Suggestions: "Same as last" only (rotate removed per product decision)
    const suggestions = document.createElement('div');
    suggestions.className = 'banker-sheet-suggestions';
    if (hole > 1) {
      const prevBanker = getBankerIdx(hole - 1);
      if (prevBanker >= 0 && playerCount > 0) {
        if (prevBanker !== bankerIdx) {
          const sameBtn = document.createElement('button');
          sameBtn.type = 'button';
          sameBtn.className = 'banker-sheet-suggestion';
          sameBtn.textContent = `Same as last · ${names[prevBanker]}`;
          sameBtn.addEventListener('click', () => {
            setBankerIdx(hole, prevBanker);
            renderSheet(hole);
          });
          suggestions.appendChild(sameBtn);
        }
      }
    }
    if (suggestions.children.length) bankerBlock.appendChild(suggestions);
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
          amountInput.value = String(prevMax);
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
        amountInput.value = String(v);
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
      toggleBankerDouble(hole);
      bankerDblBtn.dataset.active = isBankerDoubled(hole) ? 'true' : 'false';
    });
    bankerDblBlock.appendChild(bankerDblBtn);
    // NOTE: appended later, after betsBlock

    // ---- Per-opponent cards ----
    const betsBlock = document.createElement('section');
    betsBlock.className = 'banker-sheet-block';
    betsBlock.innerHTML = `<div class="banker-sheet-block-title">Bets</div>`;

    const repeatRow = document.createElement('div');
    repeatRow.className = 'banker-sheet-suggestions';
    // Repeat last hole's bets
    if (hole > 1) {
      const repeatBtn = document.createElement('button');
      repeatBtn.type = 'button';
      repeatBtn.className = 'banker-sheet-suggestion';
      repeatBtn.textContent = 'Repeat last hole\'s bets';
      repeatBtn.addEventListener('click', () => {
        for (let p = 0; p < playerCount; p++){
          if (p === bankerIdx) continue;
          const prev = getBet(p, hole - 1);
          if (prev > 0) setBet(p, hole, prev);
        }
        renderSheet(hole);
      });
      repeatRow.appendChild(repeatBtn);
    }
    if (repeatRow.children.length) betsBlock.appendChild(repeatRow);

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
      card.innerHTML = `
        <div class="banker-sheet-bet-head">
          <span class="banker-sheet-bet-name">${names[p]}</span>
          ${stroke ? `<span class="banker-sheet-bet-stroke" title="${stroke.title}">${stroke.text}</span>` : ''}
        </div>
        <div class="banker-sheet-bet-controls">
          <button type="button" class="banker-sheet-stepbtn banker-sheet-stepbtn-sm" data-step="-1">−</button>
          <div class="banker-sheet-amount banker-sheet-amount-sm">
            <span class="banker-sheet-dollar">$</span>
            <input type="number" inputmode="numeric" min="0" step="1" class="banker-sheet-bet-input" />
          </div>
          <button type="button" class="banker-sheet-stepbtn banker-sheet-stepbtn-sm" data-step="1">+</button>
          <button type="button" class="banker-sheet-mult-toggle" data-active="${doubled ? 'true' : 'false'}">${multText}</button>
        </div>
        <div class="banker-sheet-bet-quickchips">
          <button type="button" class="banker-sheet-bet-chip" data-quick="5">$5</button>
          <button type="button" class="banker-sheet-bet-chip" data-quick="10">$10</button>
          <button type="button" class="banker-sheet-bet-chip" data-quick="20">$20</button>
        </div>
        <div class="banker-sheet-bet-cap"></div>
      `;

      const betInput = card.querySelector('.banker-sheet-bet-input');
      betInput.value = bet > 0 ? String(bet) : '';
      betInput.addEventListener('input', () => {
        const v = Math.max(0, Math.round(Number(betInput.value) || 0));
        setBet(p, hole, v);
        updateCardCap(card, p, hole);
        updateLiveResult();
      });
      card.querySelector('[data-step="-1"]').addEventListener('click', () => {
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
        togglePlayerDouble(p, hole);
        multBtn.dataset.active = isPlayerDoubled(p, hole) ? 'true' : 'false';
        updateLiveResult();
      });

      // Quick-bet chips: $5 / $10 / $20 (tap to set exact value, capped to max)
      card.querySelectorAll('.banker-sheet-bet-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const v = Number(chip.dataset.quick) || 0;
          const m = getMaxBet(hole);
          const next = m > 0 ? Math.min(m, v) : v;
          betInput.value = String(next);
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
    const resultBlock = document.createElement('section');
    resultBlock.className = 'banker-sheet-block banker-sheet-result-block';
    resultBlock.innerHTML = `
      <div class="banker-sheet-block-title">Result</div>
      <div class="banker-sheet-result-text" aria-live="polite">${escapeHtml(getResultText(hole))}</div>
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
      if (txt) txt.textContent = getResultText(hole);
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

    // Auto-rotate: if this hole has no banker yet and auto-rotate is on,
    // pre-select the rotated banker from the previous hole.
    if (prefs.autoRotate && getBankerIdx(hole) < 0 && hole > 1) {
      const prev = getBankerIdx(hole - 1);
      const pc = getPlayerCount();
      if (prev >= 0 && pc > 0) {
        setBankerIdx(hole, (prev + 1) % pc);
        renderSheet(hole);
      }
    }

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
    if (!document.body.classList.contains('banker-sheet-active')) return;
    const tbody = e.target.closest('#bankerBody');
    if (!tbody) return;
    // Clicks on form controls inside shouldn't propagate because the cells
    // are CSS-hidden, but guard anyway.
    if (e.target.closest('input, button, select, textarea, a')) return;
    const tr = e.target.closest('tr');
    if (!tr) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const idx = rows.indexOf(tr);
    if (idx < 0) return;
    openSheet(idx + 1);
  }

  function buildSummaryRows(){
    // After activating, render a compact desktop-like readout inside the
    // row (banker, max bet, each opponent's bet + 2× state, banker 2×,
    // result) so the hole state is visible at a glance. Tapping the row
    // opens the full bottom sheet for editing.
    const tbody = document.getElementById('bankerBody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const names = getPlayerNames();
    const pc = getPlayerCount();
    rows.forEach((tr, i) => {
      const h = i + 1;
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
        const strokeHtml = stroke
          ? `<span class="bss-bet-stroke" title="${escapeHtml(stroke.title)}">${escapeHtml(stroke.text)}</span>`
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
            <span class="bss-bet-name">${nm}</span>
            <span class="bss-bet-amt">${amt}</span>
            <span class="bss-bet-mult-slot">${multHtml}</span>
          </div>
        `);
      }

      // Result: reuse the existing result cell's HTML when present so we get
      // the same rich markup (player rows, ±$ styling, banker total).
      const resultCellEl = document.getElementById(DOM_IDS.resultCell(h));
      const resultHtml = resultCellEl ? resultCellEl.innerHTML.trim() : '';
      const resultBlock = resultHtml
        ? `<div class="bss-result-block">${resultHtml}</div>`
        : `<div class="bss-result-block bss-result-empty">—</div>`;

      summary.innerHTML = `
        <div class="bss-grid">
          <div class="bss-col bss-col-banker">
            <div class="bss-col-label">Banker</div>
            <div class="bss-banker-name">🏦 ${bankerName}</div>
            <div class="bss-max-inline">Max $${maxBet || 0}</div>
          </div>
          <div class="bss-col bss-col-max">
            <div class="bss-col-label">Max</div>
            <div class="bss-max-val">$${maxBet || 0}</div>
          </div>
          <div class="bss-col bss-col-bets">
            <div class="bss-col-label">Bets</div>
            <div class="bss-bet-list">${betItems.join('') || '<span class="bss-bet-empty">—</span>'}</div>
          </div>
          <div class="bss-col bss-col-bdbl">
            <div class="bss-col-label">BX</div>
            <div class="bss-bdbl-val${bankerDbl?' is-on':''}">${bankerDbl ? multLabel : '—'}</div>
          </div>
          <div class="bss-col bss-col-result">
            <div class="bss-col-label">Result</div>
            ${resultBlock}
          </div>
        </div>
      `;
    });
  }

  // Re-render summaries whenever banker state could have changed.
  function scheduleSummaryUpdate(){
    if (scheduleSummaryUpdate._t) cancelAnimationFrame(scheduleSummaryUpdate._t);
    scheduleSummaryUpdate._t = requestAnimationFrame(buildSummaryRows);
  }

  let _active = false;
  let _listenersBound = false;
  let _tbodyObserver = null;

  function activate(){
    if (_active) return;
    _active = true;
    document.body.classList.add('banker-sheet-active');

    if (!_listenersBound) {
      _listenersBound = true;
      // Bind row click delegation (guarded by banker-sheet-active in handler)
      document.addEventListener('click', onTableClick);

      // Also update on any save event the app fires
      document.addEventListener('input', (e) => {
        if (!_active) return;
        if (!e.target || !e.target.id) return;
        if (e.target.id.startsWith('banker_')) scheduleSummaryUpdate();
      }, { passive: true });
      document.addEventListener('change', (e) => {
        if (!_active) return;
        if (!e.target || !e.target.id) return;
        if (e.target.id.startsWith('banker_')) scheduleSummaryUpdate();
      }, { passive: true });
    }

    // When the banker module rebuilds its table (name change, player count change),
    // the tbody innerHTML is replaced. Use a MutationObserver to re-apply summaries.
    const tbody = document.getElementById('bankerBody');
    if (tbody && !_tbodyObserver) {
      _tbodyObserver = new MutationObserver(() => {
        if (_active) scheduleSummaryUpdate();
      });
      _tbodyObserver.observe(tbody, { childList: true, subtree: true });
    }

    // Initial render (banker table may not exist yet; MutationObserver handles it)
    scheduleSummaryUpdate();
  }

  function deactivate(){
    if (!_active) return;
    _active = false;
    document.body.classList.remove('banker-sheet-active');
    // Close any open sheet
    try { closeSheet(); } catch(_) {}
    // Remove summary cells so the original banker inputs are fully visible again
    document.querySelectorAll('#bankerBody .banker-sheet-summary-cell').forEach(td => td.remove());
    document.querySelectorAll('#bankerBody tr.banker-sheet-row-empty').forEach(tr => tr.classList.remove('banker-sheet-row-empty'));
  }

  // Desktop (>=900px) uses the original inline banker table with full bet/result
  // columns. Mobile/tablet portrait (<900px) uses the bottom sheet.
  const DESKTOP_MQ = window.matchMedia('(min-width: 900px)');
  function applyViewportMode(){
    if (DESKTOP_MQ.matches) {
      deactivate();
    } else {
      activate();
    }
  }
  try {
    DESKTOP_MQ.addEventListener('change', applyViewportMode);
  } catch(_) {
    // Safari < 14 fallback
    DESKTOP_MQ.addListener(applyViewportMode);
  }

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
