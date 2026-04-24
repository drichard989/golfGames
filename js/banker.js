/* ============================================================================
   BANKER GAME MODULE
   ============================================================================
   
   Hole-by-hole betting game where one player is the "banker" per hole.
   
   GAME MECHANICS:
   • One player is banker per hole (rotates or selected manually)
   • Banker sets Maximum Bet for the hole
   • Other players bet Minimum Bet to Maximum Bet
   • Players can "double" their bet after hitting (before banker hits)
   • Banker can "double" all outstanding bets after hitting
   • Scoring uses NET with handicap strokes (+ handicaps add strokes)
   • Lower net score wins; banker pays winners, collects from losers
   
   PAYOUT:
   • Each player's result = (bet amount) × (doubles) × (banker double)
   • Winner gets positive, loser pays
   • Banker settles with each player individually
   
   Exposed as: window.Banker
   API: {init, update, compute, render, refreshForPlayerChange}
   
   ============================================================================
*/

(() => {
  'use strict';

  const BANKER_PRESELECT_META_KEY = 'banker_preselect_meta_v1';
  const BANKER_SHEET_PREFS_KEY = 'banker_sheet_prefs_v1';

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================

  function getPlayerCount() {
    try {
      return document.querySelectorAll('#scorecardFixed .player-row').length;
    } catch (error) {
      console.error('[Banker] Error getting player count:', error);
      return 0;
    }
  }

  function loadBankerPreselectMeta() {
    try {
      const raw = localStorage.getItem(BANKER_PRESELECT_META_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        lockedHoles: parsed && typeof parsed.lockedHoles === 'object' && parsed.lockedHoles
          ? parsed.lockedHoles
          : {}
      };
    } catch (_) {
      return { lockedHoles: {} };
    }
  }

  function saveBankerPreselectMeta(meta) {
    try {
      localStorage.setItem(BANKER_PRESELECT_META_KEY, JSON.stringify({
        lockedHoles: meta && typeof meta.lockedHoles === 'object' ? meta.lockedHoles : {}
      }));
    } catch (_) {}
  }

  function isBankerHoleLocked(hole) {
    const meta = loadBankerPreselectMeta();
    return !!meta.lockedHoles[String(Number(hole))];
  }

  function lockBankerHole(hole) {
    const key = String(Number(hole));
    const meta = loadBankerPreselectMeta();
    meta.lockedHoles[key] = true;
    saveBankerPreselectMeta(meta);
  }

  function clearBankerHoleLocks() {
    saveBankerPreselectMeta({ lockedHoles: {} });
  }

  function clearBankerSheetPrefs() {
    try {
      localStorage.removeItem(BANKER_SHEET_PREFS_KEY);
    } catch (_) {}
  }

  function isHoleConsumed(hole) {
    return isBankerHoleLocked(hole);
  }

  function consumeBankerHole(hole) {
    lockBankerHole(hole);
  }

  function getBankerSelectionWarning(hole, bankerIdx, names) {
    const leaders = getPrevHoleLowNetLeaders(hole);
    if (leaders.length > 1) {
      const tieNames = leaders.map((idx) => names[idx] || `P${idx + 1}`);
      return `Tie on Hole ${hole - 1} low net (${tieNames.join(', ')}). Select who holed out first.`;
    }

    if (leaders.length === 1) {
      return `Scorecard says Hole ${hole - 1} low net makes ${names[leaders[0]] || `P${leaders[0] + 1}`} banker.`;
    }

    return '';
  }

  const DOM_IDS = {
    bankerSelect: (hole) => `banker_h${hole}`,
    bankerWarning: (hole) => `banker_warning_h${hole}`,
    maxBet: (hole) => `banker_maxbet_h${hole}`,
    bankerDouble: (hole) => `banker_double_h${hole}`,
    betsCell: (hole) => `banker_bets_h${hole}`,
    resultCell: (hole) => `banker_result_h${hole}`,
    bankerStroke: (hole) => `banker_strokes_h${hole}`,
    betInput: (player, hole) => `banker_bet_p${player}_h${hole}`,
    playerDouble: (player, hole) => `banker_pdouble_p${player}_h${hole}`,
    totalCell: (player) => `banker_total_p${player}`,
    footerName: (player) => `banker_name_p${player}`,
    headerTotalCell: (player) => `banker_header_total_p${player}`,
    headerName: (player) => `banker_header_name_p${player}`
  };

  function getPlayerNames() {
    try {
      const names = [];
      const playerRows = document.querySelectorAll('#scorecardFixed .player-row');
      playerRows.forEach((row, idx) => {
        const nameInput = row.querySelector('.name-edit');
        const name = nameInput?.value?.trim() || `Player ${idx + 1}`;
        names.push(name);
      });
      return names;
    } catch (error) {
      console.error('[Banker] Error getting player names:', error);
      return [];
    }
  }

  function getHandicaps() {
    try {
      const handicaps = [];
      const playerRows = document.querySelectorAll('#scorecardFixed .player-row');
      playerRows.forEach(row => {
        const chInput = row.querySelector('.ch-input');
        const ch = (typeof window.getActualHandicapValue === 'function' ? window.getActualHandicapValue(chInput) : Number(chInput?.value)) || 0;
        handicaps.push(ch);
      });
      return handicaps;
    } catch (error) {
      console.error('[Banker] Error getting handicaps:', error);
      return [];
    }
  }

  function getGross(playerIdx, holeIdx) {
    try {
      const input = document.querySelector(
        `.score-input[data-player="${playerIdx}"][data-hole="${holeIdx + 1}"]`
      );
      return Number(input?.value) || 0;
    } catch (error) {
      console.error('[Banker] Error getting gross score:', error);
      return 0;
    }
  }

  function getPar(holeIdx) {
    try {
      const parRow = document.getElementById('parRow');
      if (!parRow) return 4;
      const inputs = parRow.querySelectorAll('input[type="number"]');
      const value = Number(inputs[holeIdx]?.value);
      return value || 4;
    } catch (error) {
      console.error('[Banker] Error getting par:', error);
      return 4;
    }
  }

  function getHCPIndex(holeIdx) {
    try {
      const HCPMEN = window.HCPMEN;
      if (!HCPMEN || !Array.isArray(HCPMEN)) return 1;
      return HCPMEN[holeIdx] || 1;
    } catch (error) {
      console.error('[Banker] Error getting HCP index:', error);
      return 1;
    }
  }

  /**
   * Calculate adjusted handicaps (play off low)
   */
  function getAdjustedCHs() {
    const handicaps = getHandicaps();
    const validCHs = handicaps.filter(ch => Number.isFinite(ch));
    if (validCHs.length === 0) return handicaps.map(() => 0);
    const minCH = Math.min(...validCHs);
    return handicaps.map(ch => ch - minCH);
  }

  /**
   * Get raw handicaps (full handicap mode)
   */
  function getRawCHs() {
    return getHandicaps();
  }

  /**
   * Calculate strokes on a hole based on adjusted handicap
   */
  function strokesOnHole(adjCH, holeIdx) {
    if (adjCH === 0) return 0;
    
    const holeHcp = getHCPIndex(holeIdx);
    const absCH = Math.abs(adjCH);
    const base = Math.floor(absCH / 18);
    const rem = absCH % 18;

    if (adjCH < 0) {
      const strokes = base + (holeHcp >= (19 - rem) ? 1 : 0);
      return -strokes;
    }

    const strokes = base + (holeHcp <= rem ? 1 : 0);
    return strokes;
  }

  /**
   * Calculate strokes on a hole based on RAW course handicap (not play-off-low)
   * Used for Banker NET mode where each player uses their full handicap independently
   */
  function strokesOnHoleRawCH(rawCH, holeIdx) {
    if (rawCH === 0) return 0;
    
    const holeHcp = getHCPIndex(holeIdx);
    if (!holeHcp) return 0;
    
    // For plus handicaps (negative CH), calculate how many strokes they GIVE
    if (rawCH < 0) {
      const absCH = Math.abs(rawCH);
      const base = Math.floor(absCH / 18);
      const rem = absCH % 18;
      const strokes = base + (holeHcp >= (19 - rem) ? 1 : 0);
      return -strokes; // Negative = they give strokes (adds to their score)
    }
    
    // For regular handicaps, calculate strokes received
    const base = Math.floor(rawCH / 18);
    const rem = rawCH % 18;
    return base + (holeHcp <= rem ? 1 : 0);
  }

  /**
   * Calculate net score for a player on a hole using FULL handicap (not play-off-low)
   * This is used for Banker NET mode scoring
   */
  function getNetScore(playerIdx, holeIdx, netHcpMode = 'rawHandicap') {
    const gross = getGross(playerIdx, holeIdx);
    if (gross === 0) return 0;
    
    // Get player's handicap based on mode
    const playerRows = document.querySelectorAll('#scorecardFixed .player-row');
    if (playerIdx >= playerRows.length) return gross;
    
    let rawCH;
    if (netHcpMode === 'playOffLow') {
      // Use adjusted handicaps (play off low)
      const adjCHs = getAdjustedCHs();
      rawCH = adjCHs[playerIdx];
    } else {
      // Use raw handicaps (full handicap - default)
      const chInput = playerRows[playerIdx].querySelector('.ch-input');
      rawCH = (typeof window.getActualHandicapValue === 'function' ? window.getActualHandicapValue(chInput) : Number(chInput?.value)) || 0;
    }
    
    // Calculate strokes based on CH (adjusted or raw)
    const strokes = strokesOnHoleRawCH(rawCH, holeIdx);
    
    // Net = gross - strokes (if + handicap, strokes are negative so they add)
    return gross - strokes;
  }

  /**
   * Get stroke display data for a player on a hole in Banker NET mode.
   * Positive strokes mean the player receives strokes.
   * Negative strokes mean the player gives strokes as a plus handicap.
   * @param {number} playerIdx - Zero-based player index
   * @param {number} holeIdx - Zero-based hole index
   * @returns {{strokes:number, displayText:string, title:string}|null}
   */
  function getStrokeDisplayData(playerIdx, holeIdx, netHcpMode = 'rawHandicap') {
    const activeBtn = document.querySelector('#bankerHcpModeGroup .hcp-mode-btn[data-active="true"]');
    const mode = activeBtn?.dataset.value || 'rawHandicap';
    const useNet = mode !== 'gross';
    if (!useNet) return null;

    const playerRows = document.querySelectorAll('#scorecardFixed .player-row');
    if (playerIdx < 0 || playerIdx >= playerRows.length) return null;

    let rawCH;
    if (mode === 'playOffLow') {
      const adjCHs = getAdjustedCHs();
      rawCH = adjCHs[playerIdx];
    } else {
      // Full handicap
      const chInput = playerRows[playerIdx].querySelector('.ch-input');
      rawCH = (typeof window.getActualHandicapValue === 'function' ? window.getActualHandicapValue(chInput) : Number(chInput?.value)) || 0;
    }
    if (rawCH === 0) return null;

    const strokes = strokesOnHoleRawCH(rawCH, holeIdx);
    if (strokes === 0) return null;

    if (strokes > 0) {
      return {
        strokes,
        displayText: `-${strokes}`,
        title: `Receives ${strokes} stroke${strokes > 1 ? 's' : ''} on this hole`
      };
    }

    return {
      strokes,
      displayText: `+${Math.abs(strokes)}`,
      title: `Gives ${Math.abs(strokes)} stroke${Math.abs(strokes) > 1 ? 's' : ''} on this hole (plus handicap)`
    };
  }

  function getActiveBankerHcpMode() {
    const activeBtn = document.querySelector('#bankerHcpModeGroup .hcp-mode-btn[data-active="true"]');
    return activeBtn?.dataset.value || 'rawHandicap';
  }

  /**
   * Get previous-hole low-net leaders for desktop banker preselection.
   * @param {number} holeOneBased
   * @returns {number[]} zero-based player indexes tied for low score
   */
  function getPrevHoleLowNetLeaders(holeOneBased) {
    const hole = Number(holeOneBased);
    if (!Number.isFinite(hole) || hole <= 1) return [];

    const prevHoleIdx = hole - 2;
    const playerCount = getPlayerCount();
    const mode = getActiveBankerHcpMode();
    const useNet = mode !== 'gross';
    const netHcpMode = mode === 'playOffLow' ? 'playOffLow' : 'rawHandicap';

    let bestScore = null;
    const leaders = [];

    for (let p = 0; p < playerCount; p++) {
      const gross = getGross(p, prevHoleIdx);
      if (!Number.isFinite(gross) || gross <= 0) continue;

      const score = useNet ? getNetScore(p, prevHoleIdx, netHcpMode) : gross;
      if (!Number.isFinite(score) || score <= 0) continue;

      if (bestScore == null || score < bestScore) {
        bestScore = score;
        leaders.length = 0;
        leaders.push(p);
      } else if (score === bestScore) {
        leaders.push(p);
      }
    }

    return leaders;
  }

  /**
   * Persist state using app-level debounced saver if available.
   */
  function queueSave() {
    if (window.Banker?._isRestoringState) return;
    if (typeof window.saveDebounced === 'function') {
      window.saveDebounced();
    }
  }

  /**
   * Announce a user-visible status message if available.
   * @param {string} message
   */
  function announceStatus(message) {
    if (typeof window.announce === 'function') {
      window.announce(message);
    }
  }

  /**
   * Get active state from a toggle button.
   * @param {HTMLButtonElement|null} button
   * @returns {boolean}
   */
  function isToggleActive(button) {
    return button?.dataset.active === 'true';
  }

  /**
   * Apply visual and dataset state to a toggle-style button.
   * @param {HTMLButtonElement|null} button
   * @param {boolean} isActive
   */
  function setToggleButtonState(button, isActive) {
    if (!button) return;
    button.dataset.active = isActive ? 'true' : 'false';
    button.classList.toggle('is-active', !!isActive);
  }

  /**
   * Truncate display names for compact Banker table cells.
   * @param {string} name
   * @param {number} maxLen
   * @returns {string}
   */
  function truncateName(name, maxLen = 10) {
    return String(name || '').substring(0, maxLen);
  }

  /**
   * Compute responsive Banker bet-row layout values.
   * @returns {{isLargeFont:boolean,isMobile:boolean,nameMinWidth:number,strokeColWidth:number,inputColWidth:number,buttonColWidth:number,columnGap:string}}
   */
  function getBetRowLayoutConfig() {
    const fontSizeMode = document.documentElement.getAttribute('data-font-size') || 'medium';
    const isLargeFont = fontSizeMode === 'large';
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);

    const strokeColWidth = isLargeFont ? (isMobile ? 40 : 42) : (isMobile ? 34 : 36);
    const inputColWidth = isMobile ? (isAndroid ? 48 : 50) : 60;
    const buttonColWidth = isMobile ? (isIOS ? 52 : 48) : 52;
    const nameMinWidth = isMobile ? (isAndroid ? 94 : 90) : 92;
    const columnGap = isMobile ? '4px' : '6px';

    return {
      isLargeFont,
      isMobile,
      nameMinWidth,
      strokeColWidth,
      inputColWidth,
      buttonColWidth,
      columnGap
    };
  }

  function sanitizeBetState(bet, playerCount) {
    const player = Number(bet?.player);
    if (!Number.isFinite(player) || player < 0 || player >= playerCount) return null;

    return {
      player,
      amount: Math.max(0, Number(bet?.amount) || 0),
      doubled: !!bet?.doubled
    };
  }

  function sanitizeHoleState(hole, playerCount) {
    const banker = Number(hole?.banker);
    const maxBet = Math.max(0, Number(hole?.maxBet) || 10);
    const bankerDouble = !!hole?.bankerDouble;
    const sourceBets = Array.isArray(hole?.bets) ? hole.bets : [];
    const bets = sourceBets
      .map((bet) => sanitizeBetState(bet, playerCount))
      .filter(Boolean);

    return {
      banker: Number.isFinite(banker) ? banker : -1,
      maxBet,
      bankerDouble,
      bets
    };
  }

  function sanitizeBankerState(state, playerCount) {
    const safePlayerCount = Math.max(0, Number(playerCount) || 0);
    const sourceHoles = Array.isArray(state?.holes) ? state.holes : [];

    return {
      holes: Array.from({ length: 18 }, (_, idx) =>
        sanitizeHoleState(sourceHoles[idx], safePlayerCount)
      )
    };
  }

  function getStrokeTone(strokes) {
    // strokes > 0 => score is reduced (good): green sheen
    // strokes < 0 => score is increased (plus handicap gives strokes): red sheen
    return strokes > 0
      ? {
          color: '#0f7a49',
          borderColor: 'rgba(15, 122, 73, 0.72)',
          background: 'linear-gradient(135deg, rgba(15, 122, 73, 0.30), rgba(15, 122, 73, 0.12) 55%, rgba(15, 122, 73, 0.04))',
          boxShadow: 'inset 0 0 0 1px rgba(15, 122, 73, 0.34), 0 0 0 1px rgba(15, 122, 73, 0.18)'
        }
      : {
          color: '#ff6b6b',
          borderColor: 'rgba(255, 107, 107, 0.62)',
          background: 'linear-gradient(135deg, rgba(255, 107, 107, 0.30), rgba(255, 107, 107, 0.12) 55%, rgba(255, 107, 107, 0.03))',
          boxShadow: 'inset 0 0 0 1px rgba(255, 107, 107, 0.30), 0 0 0 1px rgba(255, 107, 107, 0.16)'
        };
  }

  function applyStrokeBadgeStyle(indicator, strokes) {
    if (!indicator || !strokes) return;
    const tone = getStrokeTone(strokes);
    indicator.style.color = tone.color;
    indicator.style.borderColor = tone.borderColor;
    indicator.style.background = tone.background;
    indicator.style.boxShadow = tone.boxShadow;
  }

  function setBetInputValidity(betInput, isInvalid, maxBet) {
    if (!betInput) return;
    betInput.classList.toggle('banker-bet-input-invalid', !!isInvalid);
    betInput.title = isInvalid ? `Bet exceeds max of $${maxBet}` : '';
  }

  // =============================================================================
  // PURE GAME ENGINE (no DOM access)
  // =============================================================================

  /**
   * Pure Banker game engine based on provided state and scorebook.
   * Does not read or write DOM.
   * @param {{playerCount:number, holes:Array<{banker:number,maxBet:number,bankerDouble:boolean,bets:Array<{player:number,amount:number,doubled:boolean}>}>}} state
   * @param {{grossByHole:number[][], netByHole:number[][], pars:number[]}} scorebook
   * @param {boolean} useNet
   * @returns {{holeResults:Array, playerTotals:number[]}}
   */
  function computeFromState(state, scorebook, useNet) {
    const playerCount = Number(state?.playerCount) || 0;
    const holes = Array.isArray(state?.holes) ? state.holes : [];
    const grossByHole = Array.isArray(scorebook?.grossByHole) ? scorebook.grossByHole : [];
    const netByHole = Array.isArray(scorebook?.netByHole) ? scorebook.netByHole : [];
    const pars = Array.isArray(scorebook?.pars) ? scorebook.pars : [];

    const holeResults = [];
    const playerTotals = Array(playerCount).fill(0);

    for (let h = 0; h < 18; h++) {
      const holeNum = h + 1;
      const holeState = holes[h] || { banker: -1, maxBet: 10, bankerDouble: false, bets: [] };
      const bankerIdx = Number(holeState.banker);

      if (bankerIdx < 0 || bankerIdx >= playerCount) {
        holeResults.push({
          hole: holeNum,
          banker: -1,
          bets: [],
          winner: null,
          error: 'No banker selected'
        });
        continue;
      }

      const grossScores = grossByHole[h] || [];
      const netScores = netByHole[h] || [];
      const scores = useNet ? netScores : grossScores;

      const allScoresEntered =
        scores.length >= playerCount && scores.slice(0, playerCount).every((s) => Number(s) > 0);

      if (!allScoresEntered) {
        holeResults.push({
          hole: holeNum,
          banker: bankerIdx,
          bets: [],
          winner: null,
          error: 'Not all scores entered'
        });
        continue;
      }

      const bankerScore = scores[bankerIdx];
      const bankerDouble = !!holeState.bankerDouble;
      const holePar = Number(pars[h]) || 4;
      const isPar3 = holePar === 3;
      const baseMultiplier = isPar3 ? 3 : 2;

      const resultBets = [];
      const sourceBets = Array.isArray(holeState.bets) ? holeState.bets : [];

      sourceBets.forEach((bet) => {
        const player = Number(bet?.player);
        const betAmount = Number(bet?.amount) || 0;
        const playerDouble = !!bet?.doubled;

        if (player === bankerIdx) return;
        if (player < 0 || player >= playerCount) return;
        if (betAmount <= 0) return;

        const playerScore = scores[player];
        const playerGross = grossScores[player];
        const playerNet = netScores[player];
        const bankerGross = grossScores[bankerIdx];
        const bankerNet = netScores[bankerIdx];

        let multiplier = 1;
        if (playerDouble) multiplier *= baseMultiplier;
        if (bankerDouble) multiplier *= baseMultiplier;

        const basePayout = betAmount * multiplier;

        let winner = null;
        let payout = 0;

        if (playerScore < bankerScore) {
          winner = player;
          payout = basePayout;
          playerTotals[player] += payout;
          playerTotals[bankerIdx] -= payout;
        } else if (playerScore > bankerScore) {
          winner = bankerIdx;
          payout = -basePayout;
          playerTotals[player] -= basePayout;
          playerTotals[bankerIdx] += basePayout;
        }

        resultBets.push({
          player,
          betAmount,
          playerDouble,
          playerScore,
          playerGross,
          playerNet,
          bankerScore,
          bankerGross,
          bankerNet,
          winner,
          payout,
          multiplier
        });
      });

      holeResults.push({
        hole: holeNum,
        banker: bankerIdx,
        maxBet: Number(holeState.maxBet) || 0,
        bankerDouble,
        bets: resultBets
      });
    }

    return { holeResults, playerTotals };
  }

  // =============================================================================
  // BANKER MODULE
  // =============================================================================

  const Banker = {
    _initialized: false,
    _pendingState: null,  // Store state for restoration after init
    _isRestoringState: false,

    /**
     * Refresh banker stroke badges for all holes.
     */
    updateBankerStrokeIndicators() {
      const playerCount = getPlayerCount();

      for (let h = 1; h <= 18; h++) {
        const indicator = document.getElementById(DOM_IDS.bankerStroke(h));
        const bankerSelect = document.getElementById(DOM_IDS.bankerSelect(h));
        if (!indicator || !bankerSelect) continue;

        const bankerIdx = Number(bankerSelect.value);
        if (bankerIdx < 0 || bankerIdx >= playerCount) {
          indicator.textContent = '';
          indicator.style.display = 'none';
          indicator.removeAttribute('title');
          continue;
        }

        const strokeData = getStrokeDisplayData(bankerIdx, h - 1);
        if (!strokeData) {
          indicator.textContent = '';
          indicator.style.display = 'none';
          indicator.removeAttribute('title');
          continue;
        }

        indicator.textContent = strokeData.displayText;
        indicator.title = strokeData.title;
        indicator.style.display = 'inline-flex';
        applyStrokeBadgeStyle(indicator, strokeData.strokes);
      }
    },
    
    /**
     * Get current banker game state for saving
     * @returns {Object} Complete banker game state
     */
    getState() {
      // If UI isn't built yet, return pending restored state (if any)
      // instead of overwriting saved data with empty defaults.
      if (!this._initialized) {
        return this._pendingState || null;
      }

      const testElement = document.getElementById(DOM_IDS.bankerSelect(1));
      if (!testElement) {
        return this._pendingState || null;
      }

      const state = {
        holes: []
      };
      
      for (let h = 1; h <= 18; h++) {
        const holeState = {
          banker: -1,
          maxBet: 10,
          bankerDouble: false,
          bets: []
        };
        
        // Get banker selection
        const bankerSelect = document.getElementById(DOM_IDS.bankerSelect(h));
        if (bankerSelect) {
          holeState.banker = Number(bankerSelect.value);
        }
        
        // Get max bet
        const maxBetInput = document.getElementById(DOM_IDS.maxBet(h));
        if (maxBetInput) {
          holeState.maxBet = Number(maxBetInput.value) || 10;
        }
        
        // Get banker double
        const bankerDoubleBtn = document.getElementById(DOM_IDS.bankerDouble(h));
        if (bankerDoubleBtn) {
          holeState.bankerDouble = bankerDoubleBtn.dataset.active === 'true';
        }
        
        // Get player bets
        const playerCount = getPlayerCount();
        for (let p = 0; p < playerCount; p++) {
          const betInput = document.getElementById(DOM_IDS.betInput(p, h));
          const doubleBtn = document.getElementById(DOM_IDS.playerDouble(p, h));
          
          if (betInput) {
            const betAmount = Number(betInput.value) || 0;
            const doubled = doubleBtn?.dataset.active === 'true';
            
            // Save all bets, even if 0, to maintain consistency
            holeState.bets.push({
              player: p,
              amount: betAmount,
              doubled: doubled
            });
          }
        }
        
        state.holes.push(holeState);
      }
      
      return state;
    },
    
    /**
     * Set banker game state from saved data
     * @param {Object} state - Saved banker game state
     */
    setState(state) {
      if (!state || !state.holes) return;

      const playerCount = getPlayerCount();
      const sanitizedState = sanitizeBankerState(state, playerCount);
      
      // Check if table is built (test if banker select exists)
      const testElement = document.getElementById(DOM_IDS.bankerSelect(1));
      if (!testElement) {
        // Table not built yet, store for later
        this._pendingState = sanitizedState;
        return;
      }

      this._isRestoringState = true;
      try {
        // Pass 1: apply per-hole selections and static controls without dispatching events.
        sanitizedState.holes.forEach((holeState, idx) => {
          const h = idx + 1;

          const bankerSelect = document.getElementById(DOM_IDS.bankerSelect(h));
          if (bankerSelect && holeState.banker !== undefined) {
            bankerSelect.value = String(holeState.banker);
          }

          const maxBetInput = document.getElementById(DOM_IDS.maxBet(h));
          if (maxBetInput && holeState.maxBet !== undefined) {
            maxBetInput.value = String(holeState.maxBet);
          }

          const bankerDoubleBtn = document.getElementById(DOM_IDS.bankerDouble(h));
          setToggleButtonState(bankerDoubleBtn, !!holeState.bankerDouble);
        });

        // Build per-player bet rows from banker selections once.
        this.updateBetInputs();

        // Pass 2: apply bet amounts and player doubles.
        sanitizedState.holes.forEach((holeState, idx) => {
          const h = idx + 1;
          if (!Array.isArray(holeState.bets)) return;

          holeState.bets.forEach((bet) => {
            const betInput = document.getElementById(DOM_IDS.betInput(bet.player, h));
            if (betInput) {
              betInput.value = String(bet.amount || 0);
            }

            const doubleBtn = document.getElementById(DOM_IDS.playerDouble(bet.player, h));
            setToggleButtonState(doubleBtn, !!bet.doubled);
          });
        });

        // Final single recalculation.
        this.update();
      } finally {
        this._isRestoringState = false;
      }
    },
    
    /**
     * Clear all banker game data
     */
    clearAll() {
      if (!confirm('Clear all Banker game data? This cannot be undone.')) {
        return;
      }

      clearBankerHoleLocks();
      clearBankerSheetPrefs();
      
      for (let h = 1; h <= 18; h++) {
        // Reset banker selection
        const bankerSelect = document.getElementById(DOM_IDS.bankerSelect(h));
        if (bankerSelect) {
          bankerSelect.value = '-1';
          bankerSelect.dispatchEvent(new Event('change'));
        }
        
        // Reset max bet
        const maxBetInput = document.getElementById(DOM_IDS.maxBet(h));
        if (maxBetInput) {
          maxBetInput.value = '10';
        }
        
        // Reset banker double
        const bankerDoubleBtn = document.getElementById(DOM_IDS.bankerDouble(h));
        if (bankerDoubleBtn) {
          setToggleButtonState(bankerDoubleBtn, false);
        }
        
        // Reset all player bets
        const playerCount = getPlayerCount();
        for (let p = 0; p < playerCount; p++) {
          const betInput = document.getElementById(DOM_IDS.betInput(p, h));
          if (betInput) {
            betInput.value = '0';
          }
          
          const doubleBtn = document.getElementById(DOM_IDS.playerDouble(p, h));
          if (doubleBtn) {
            setToggleButtonState(doubleBtn, false);
          }
        }
      }
      
      this.update();
      
      queueSave();
      announceStatus('Banker game cleared.');
    },
    
    /**
     * Compute Banker results for all holes
     * @returns {Object} Banker game results
     */
    compute() {
      const playerCount = getPlayerCount();
      const activeBtn = document.querySelector('#bankerHcpModeGroup .hcp-mode-btn[data-active="true"]');
      const mode = activeBtn?.dataset.value || 'rawHandicap';
      const useNet = mode !== 'gross';
      const netHcpMode = mode === 'rawHandicap' ? 'rawHandicap' : mode === 'playOffLow' ? 'playOffLow' : 'rawHandicap';

      const sourceState = sanitizeBankerState(this.getState() || { holes: [] }, playerCount);

      const grossByHole = [];
      const netByHole = [];
      const pars = [];

      for (let h = 0; h < 18; h++) {
        const grossScores = [];
        const netScores = [];
        for (let p = 0; p < playerCount; p++) {
          grossScores.push(getGross(p, h));
          netScores.push(getNetScore(p, h, netHcpMode));
        }
        grossByHole.push(grossScores);
        netByHole.push(netScores);
        pars.push(getPar(h));
      }

      return computeFromState(
        { playerCount, holes: sourceState.holes, netHcpMode },
        { grossByHole, netByHole, pars },
        useNet
      );
    },

    /**
     * Render Banker results into the DOM
     */
    render(data) {
      const { holeResults, playerTotals } = data;
      const playerCount = getPlayerCount();
      const names = getPlayerNames();
      
      // Update totals footer
      for (let p = 0; p < playerCount; p++) {
        const totalCell = document.getElementById(DOM_IDS.totalCell(p));
        const headerTotalCell = document.getElementById(DOM_IDS.headerTotalCell(p));
        const total = playerTotals[p] || 0;
        const totalText = total >= 0 ? `+$${total.toFixed(2)}` : `-$${Math.abs(total).toFixed(2)}`;

        if (totalCell) {
          totalCell.textContent = totalText;
          totalCell.classList.remove('banker-total-positive', 'banker-total-negative');
          if (total > 0) totalCell.classList.add('banker-total-positive');
          if (total < 0) totalCell.classList.add('banker-total-negative');
        }

        if (headerTotalCell) {
          headerTotalCell.textContent = totalText;
          headerTotalCell.classList.remove('banker-total-positive', 'banker-total-negative');
          if (total > 0) headerTotalCell.classList.add('banker-total-positive');
          if (total < 0) headerTotalCell.classList.add('banker-total-negative');
        }
      }
      
      // Update hole results
      holeResults.forEach(hole => {
        const resultCell = document.getElementById(DOM_IDS.resultCell(hole.hole));
        if (!resultCell) return;
        
        if (hole.error) {
          resultCell.innerHTML = '';
          const errorMsg = document.createElement('span');
          errorMsg.className = 'banker-result-muted';
          errorMsg.textContent = hole.error;
          resultCell.appendChild(errorMsg);
          return;
        }
        
        if (hole.bets.length === 0) {
          resultCell.innerHTML = '';
          const noBets = document.createElement('span');
          noBets.className = 'banker-result-muted';
          noBets.textContent = 'No bets';
          resultCell.appendChild(noBets);
          return;
        }
        
        // Show detailed results per bet
        const bankerName = truncateName(names[hole.banker], 10) || `P${hole.banker + 1}`;
        
        const results = hole.bets.map(bet => {
          const playerName = truncateName(names[bet.player], 10) || `P${bet.player + 1}`;
          
          const resultContainer = document.createElement('div');
          resultContainer.className = 'banker-result-row';
          
          // Color code based on outcome
          if (bet.winner === bet.player) {
            // Player won
            resultContainer.classList.add('is-player-win');
          } else if (bet.winner === hole.banker) {
            // Banker won
            resultContainer.classList.add('is-banker-win');
          } else {
            // Tie
            resultContainer.classList.add('is-tie');
          }
          
          const playerInfo = document.createElement('span');
          playerInfo.className = 'banker-result-name';
          playerInfo.textContent = `${playerName}: `;
          
          const scoreInfo = document.createElement('span');
          scoreInfo.className = 'banker-result-score';
          
          // Only show net details when net differs from gross
          const formatScoreWithNet = (gross, net) => gross === net ? `${gross}` : `${gross} (Net ${net})`;
          const playerScore = formatScoreWithNet(bet.playerGross, bet.playerNet);
          const bankerScore = formatScoreWithNet(bet.bankerGross, bet.bankerNet);
          scoreInfo.textContent = `${playerScore} v ${bankerScore}`;
          
          const payoutInfo = document.createElement('span');
          payoutInfo.className = 'banker-result-payout';
          payoutInfo.classList.remove('banker-payout-positive', 'banker-payout-negative', 'banker-payout-push');
          
          if (bet.payout > 0) {
            payoutInfo.classList.add('banker-payout-positive');
            payoutInfo.textContent = `+$${bet.payout.toFixed(0)}`;
          } else if (bet.payout < 0) {
            payoutInfo.classList.add('banker-payout-negative');
            payoutInfo.textContent = `-$${Math.abs(bet.payout).toFixed(0)}`;
          } else {
            payoutInfo.classList.add('banker-payout-push');
            payoutInfo.textContent = 'PUSH';
          }
          
          const multiplierInfo = document.createElement('span');
          multiplierInfo.className = 'banker-result-mult';
          if (bet.multiplier > 1) {
            multiplierInfo.textContent = `(${bet.multiplier}×)`;
          }
          
          resultContainer.appendChild(playerInfo);
          
          const rightSide = document.createElement('div');
          rightSide.className = 'banker-result-right';
          rightSide.appendChild(scoreInfo);
          rightSide.appendChild(payoutInfo);
          rightSide.appendChild(multiplierInfo);
          
          resultContainer.appendChild(rightSide);
          
          return resultContainer;
        });
        
        resultCell.innerHTML = '';
        results.forEach(result => resultCell.appendChild(result));
        
        // Add banker total for this hole
        const bankerTotal = hole.bets.reduce((sum, bet) => sum - bet.payout, 0);
        const bankerSummary = document.createElement('div');
        bankerSummary.className = 'banker-result-summary';

        bankerSummary.classList.remove(
          'banker-result-summary-positive',
          'banker-result-summary-negative',
          'banker-result-summary-push'
        );
        if (bankerTotal > 0) bankerSummary.classList.add('banker-result-summary-positive');
        if (bankerTotal < 0) bankerSummary.classList.add('banker-result-summary-negative');
        if (bankerTotal === 0) bankerSummary.classList.add('banker-result-summary-push');

        const summaryLabel = document.createElement('span');
        summaryLabel.textContent = `${bankerName}: `;

        const summaryValue = document.createElement('span');
        summaryValue.className = 'banker-summary-value';
        summaryValue.textContent =
          bankerTotal > 0
            ? `+$${bankerTotal.toFixed(0)}`
            : bankerTotal < 0
              ? `-$${Math.abs(bankerTotal).toFixed(0)}`
              : '$0';

        bankerSummary.appendChild(summaryLabel);
        bankerSummary.appendChild(summaryValue);

        resultCell.appendChild(bankerSummary);
      });
    },

    /**
     * Build the Banker table
     */
    buildTable() {
      const tbody = document.getElementById('bankerBody');
      if (!tbody) {
        console.error('[Banker] bankerBody tbody not found!');
        return;
      }
      
      tbody.innerHTML = '';
      const playerCount = getPlayerCount();
      const names = getPlayerNames();
      
      for (let h = 1; h <= 18; h++) {
        const tr = document.createElement('tr');
        
        // Hole number
        const holeTd = document.createElement('td');
        holeTd.className = 'banker-hole-cell';
        holeTd.textContent = h;
        tr.appendChild(holeTd);
        
        // Banker select
        const bankerTd = document.createElement('td');
        bankerTd.className = 'banker-cell-pad';

        const bankerCell = document.createElement('div');
        bankerCell.className = 'banker-select-cell';

        const bankerWrap = document.createElement('div');
        bankerWrap.className = 'banker-inline-wrap';

        const bankerSelect = document.createElement('select');
        bankerSelect.id = DOM_IDS.bankerSelect(h);
        bankerSelect.className = 'banker-select';
        
        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '-1';
        defaultOption.textContent = 'Select...';
        bankerSelect.appendChild(defaultOption);
        
        // Add player options
        for (let p = 0; p < playerCount; p++) {
          const option = document.createElement('option');
          option.value = p;
          option.textContent = names[p] || `Player ${p + 1}`;
          bankerSelect.appendChild(option);
        }
        
        bankerSelect.addEventListener('change', () => {
          if (Number(bankerSelect.value) >= 0) {
            consumeBankerHole(h);
          }
          this.updateBetInputs();
          this.update();
          queueSave();
        });
        
        const bankerStrokeIndicator = document.createElement('span');
        bankerStrokeIndicator.id = DOM_IDS.bankerStroke(h);
        bankerStrokeIndicator.className = 'banker-stroke-indicator';

        const bankerGuidance = document.createElement('div');
        bankerGuidance.className = 'banker-sheet-guidance banker-selection-guidance';
        bankerGuidance.hidden = true;

        const bankerGuidanceLabel = document.createElement('div');
        bankerGuidanceLabel.className = 'banker-sheet-guidance-label';
        bankerGuidanceLabel.textContent = 'Scorecard guidance';

        const bankerWarning = document.createElement('div');
        bankerWarning.id = DOM_IDS.bankerWarning(h);
        bankerWarning.className = 'banker-sheet-guidance-text banker-selection-warning banker-result-warning';

        bankerGuidance.appendChild(bankerGuidanceLabel);
        bankerGuidance.appendChild(bankerWarning);

        bankerWrap.appendChild(bankerSelect);
        bankerWrap.appendChild(bankerStrokeIndicator);
        bankerCell.appendChild(bankerWrap);
        bankerCell.appendChild(bankerGuidance);
        bankerTd.appendChild(bankerCell);
        tr.appendChild(bankerTd);
        
        // Max Bet
        const maxBetTd = document.createElement('td');
        
        // Create container with label like player bets
        const maxBetContainer = document.createElement('div');
        maxBetContainer.className = 'banker-money-box';
        const dollarSign = document.createElement('span');
        dollarSign.textContent = '$';
        dollarSign.className = 'banker-dollar';
        
        const maxBetInput = document.createElement('input');
        maxBetInput.id = DOM_IDS.maxBet(h);
        maxBetInput.type = 'number';
        maxBetInput.inputMode = 'numeric';
        maxBetInput.min = '0';
        maxBetInput.step = '1';
        maxBetInput.value = '10';
        maxBetInput.className = 'banker-number-input banker-maxbet-input';
        maxBetInput.addEventListener('input', () => {
          consumeBankerHole(h);
          // Re-validate all player bets for this hole when max bet changes
          const maxBet = Number(maxBetInput.value) || 0;
          const betsTd = document.getElementById(DOM_IDS.betsCell(h));
          if (betsTd) {
            const betInputs = betsTd.querySelectorAll('input[type="number"]');
            betInputs.forEach(betInput => {
              const playerBet = Number(betInput.value) || 0;
              if (playerBet > maxBet && maxBet > 0) {
                setBetInputValidity(betInput, true, maxBet);
              } else {
                setBetInputValidity(betInput, false, maxBet);
              }
            });
          }
          
          this.update();
          queueSave();
        });
        
        maxBetContainer.appendChild(dollarSign);
        maxBetContainer.appendChild(maxBetInput);
        maxBetTd.appendChild(maxBetContainer);
        tr.appendChild(maxBetTd);
        
        // Bets column (will be populated dynamically)
        const betsTd = document.createElement('td');
        betsTd.id = DOM_IDS.betsCell(h);
        betsTd.className = 'banker-bets-cell';
        tr.appendChild(betsTd);
        
        // Banker Double/Triple button
        const bankerDoubleTd = document.createElement('td');
        const bankerDoubleBtn = document.createElement('button');
        bankerDoubleBtn.id = DOM_IDS.bankerDouble(h);
        bankerDoubleBtn.type = 'button';
        bankerDoubleBtn.dataset.active = 'false';
        bankerDoubleBtn.className = 'banker-toggle-btn banker-hole-toggle';
        
        // Set text and title based on par
        const holePar = getPar(h - 1);
        const isPar3 = holePar === 3;
        const multiplierText = isPar3 ? '3×' : '2×';
        bankerDoubleBtn.textContent = multiplierText;
        bankerDoubleBtn.title = isPar3 ? 'Banker triples all bets (Par 3)' : 'Banker doubles all bets';
        
        bankerDoubleBtn.addEventListener('click', () => {
          consumeBankerHole(h);
          setToggleButtonState(bankerDoubleBtn, !isToggleActive(bankerDoubleBtn));
          
          this.update();
          queueSave();
        });
        bankerDoubleTd.appendChild(bankerDoubleBtn);
        tr.appendChild(bankerDoubleTd);
        
        // Result column
        const resultTd = document.createElement('td');
        resultTd.id = DOM_IDS.resultCell(h);
        resultTd.className = 'banker-result-cell';
        resultTd.textContent = '—';
        tr.appendChild(resultTd);
        
        tbody.appendChild(tr);
      }
    },

    /**
     * Update bet inputs for each hole based on banker selection
     */
    updateBetInputs() {
      const playerCount = getPlayerCount();
      const names = getPlayerNames();
      
      // Save current values before rebuilding inputs
      const savedValues = {};
      for (let h = 1; h <= 18; h++) {
        savedValues[h] = {};
        for (let p = 0; p < playerCount; p++) {
          const betInput = document.getElementById(DOM_IDS.betInput(p, h));
          const doubleBtn = document.getElementById(DOM_IDS.playerDouble(p, h));
          if (betInput) {
            savedValues[h][p] = {
              bet: betInput.value || '0',
              doubled: doubleBtn?.dataset.active === 'true'
            };
          }
        }
      }
      
      for (let h = 1; h <= 18; h++) {
        const betsTd = document.getElementById(DOM_IDS.betsCell(h));
        if (!betsTd) continue;
        
        const bankerSelect = document.getElementById(DOM_IDS.bankerSelect(h));
        let bankerIdx = bankerSelect ? Number(bankerSelect.value) : -1;

        // Desktop parity with bottom-sheet flow:
        // preselect this hole's banker from previous-hole low-net winner.
        if ((bankerIdx < 0 || bankerIdx >= playerCount) && bankerSelect && !isHoleConsumed(h)) {
          const leaders = getPrevHoleLowNetLeaders(h);
          if (leaders.length === 1) {
            bankerSelect.value = String(leaders[0]);
            bankerIdx = leaders[0];
          }
        }
        
        if (bankerIdx < 0 || bankerIdx >= playerCount) {
          betsTd.innerHTML = '';
          const selectMsg = document.createElement('span');
          const warningText = getBankerSelectionWarning(h, bankerIdx, names);
          const bankerWarning = document.getElementById(DOM_IDS.bankerWarning(h));
          if (bankerWarning) {
            bankerWarning.textContent = warningText;
            if (bankerWarning.parentElement) bankerWarning.parentElement.hidden = !warningText;
          }
          if (warningText) {
            continue;
          }
          selectMsg.className = 'banker-result-muted banker-result-muted-sm';
          selectMsg.textContent = 'Select banker';
          betsTd.appendChild(selectMsg);
          continue;
        }

        const bankerWarning = document.getElementById(DOM_IDS.bankerWarning(h));
        const warningText = getBankerSelectionWarning(h, bankerIdx, names);
        if (bankerWarning) {
          bankerWarning.textContent = warningText;
          if (bankerWarning.parentElement) bankerWarning.parentElement.hidden = !warningText;
        }
        
        // Create bet inputs for each non-banker player
        const betInputs = [];
        
        // Check if this is a par 3 hole
        const holePar = getPar(h - 1);
        const isPar3 = holePar === 3;
        const multiplierText = isPar3 ? '3×' : '2×';
        const checkboxTitle = isPar3 ? 'Player triples their bet (Par 3)' : 'Player doubles their bet';
        
        for (let p = 0; p < playerCount; p++) {
          if (p === bankerIdx) continue;

          const {
            nameMinWidth,
            strokeColWidth,
            inputColWidth,
            buttonColWidth,
            columnGap
          } = getBetRowLayoutConfig();
          
          const playerName = truncateName(names[p] || `P${p + 1}`, 10);
          
          const container = document.createElement('div');
          container.className = 'banker-player-bet-row';
          container.style.display = 'grid';
          container.style.gridTemplateColumns = `minmax(${nameMinWidth}px, 1fr) ${strokeColWidth}px 14px ${inputColWidth}px ${buttonColWidth}px`;
          container.style.columnGap = columnGap;

          // Player name column
          const nameSpan = document.createElement('span');
          nameSpan.textContent = `${playerName}:`;
          nameSpan.className = 'banker-player-name';
          
          // Add stroke indicator for NET mode - always create fixed-width container
          const strokeContainer = document.createElement('span');
          strokeContainer.className = 'banker-player-stroke-container banker-stroke-slot';
          strokeContainer.dataset.player = String(p);
          strokeContainer.dataset.hole = String(h);
          
          const useNet = document.getElementById('bankerModeNet')?.checked ?? true;
          
          if (useNet) {
            // Get player's raw CH from DOM
            const playerRows = document.querySelectorAll('#scorecardFixed .player-row');
            if (p < playerRows.length) {
              const chInput = playerRows[p].querySelector('.ch-input');
              const rawCH = (typeof window.getActualHandicapValue === 'function' ? window.getActualHandicapValue(chInput) : Number(chInput?.value)) || 0;
              
              if (rawCH !== 0) {
                // Calculate strokes for this hole (h is 1-18, function expects 0-17)
                const strokes = strokesOnHoleRawCH(rawCH, h - 1);
                
                if (strokes !== 0) {
                  const strokeIndicator = document.createElement('span');
                  
                  // Format display:
                  // Positive strokes = receiving strokes (subtract from gross, show as -1, -2, etc.)
                  // Negative strokes = giving strokes via plus handicap (add to gross, show as +1, +2, etc.)
                  const displayText = strokes > 0 ? `-${strokes}` : `+${Math.abs(strokes)}`;
                  
                  strokeIndicator.textContent = displayText;
                  strokeIndicator.className = 'banker-inline-stroke-pill';
                  applyStrokeBadgeStyle(strokeIndicator, strokes);
                  strokeIndicator.title = strokes > 0 
                    ? `Receives ${strokes} stroke${strokes > 1 ? 's' : ''} on this hole` 
                    : `Gives ${Math.abs(strokes)} stroke${Math.abs(strokes) > 1 ? 's' : ''} on this hole (plus handicap)`;
                  
                  strokeContainer.appendChild(strokeIndicator);
                }
              }
            }
          }
          
          const dollarSign = document.createElement('span');
          dollarSign.textContent = '$';
          dollarSign.className = 'banker-dollar';
          
          const betInput = document.createElement('input');
          betInput.id = DOM_IDS.betInput(p, h);
          betInput.type = 'number';
          betInput.inputMode = 'numeric';
          betInput.min = '0';
          betInput.step = '1';
          // Restore saved value or default to empty
          betInput.value = savedValues[h][p]?.bet || '';
          betInput.placeholder = '0';
          betInput.className = 'banker-number-input banker-bet-input';
          betInput.addEventListener('input', () => {
            consumeBankerHole(h);
            // Validate bet against max bet
            const maxBetInput = document.getElementById(DOM_IDS.maxBet(h));
            const maxBet = maxBetInput ? Number(maxBetInput.value) : 0;
            const playerBet = Number(betInput.value) || 0;
            
            if (playerBet > maxBet && maxBet > 0) {
              setBetInputValidity(betInput, true, maxBet);
            } else {
              setBetInputValidity(betInput, false, maxBet);
            }
            
            this.update();
            queueSave();
          });
          
          const doubleBtn = document.createElement('button');
          doubleBtn.id = DOM_IDS.playerDouble(p, h);
          doubleBtn.type = 'button';
          doubleBtn.textContent = multiplierText;
          doubleBtn.title = checkboxTitle;
          // Restore saved doubled state
          doubleBtn.dataset.active = savedValues[h][p]?.doubled ? 'true' : 'false';
          doubleBtn.className = 'banker-toggle-btn banker-player-toggle';
          
          // Apply saved doubled state styling immediately
          setToggleButtonState(doubleBtn, isToggleActive(doubleBtn));
          
          doubleBtn.addEventListener('click', () => {
            consumeBankerHole(h);
            setToggleButtonState(doubleBtn, !isToggleActive(doubleBtn));
            
            this.update();
            queueSave();
          });
          
          container.appendChild(nameSpan);
          container.appendChild(strokeContainer);
          container.appendChild(dollarSign);
          container.appendChild(betInput);
          container.appendChild(doubleBtn);
          
          betInputs.push(container);
        }
        
        betsTd.innerHTML = '';
        betInputs.forEach(input => betsTd.appendChild(input));
      }
    },

    /**
     * Refresh inline stroke indicators beside each player bet row.
     * This keeps badges accurate when CH or handicap mode changes.
     */
    refreshBetStrokeIndicators() {
      const containers = document.querySelectorAll('.banker-player-stroke-container');
      if (!containers.length) return;

      containers.forEach((container) => {
        const playerIdx = Number(container.dataset.player);
        const holeNum = Number(container.dataset.hole);
        if (!Number.isFinite(playerIdx) || !Number.isFinite(holeNum)) return;

        container.innerHTML = '';

        const strokeData = getStrokeDisplayData(playerIdx, holeNum - 1);
        if (!strokeData) return;

        const strokeIndicator = document.createElement('span');
        strokeIndicator.textContent = strokeData.displayText;
        strokeIndicator.className = 'banker-inline-stroke-pill';
        applyStrokeBadgeStyle(strokeIndicator, strokeData.strokes);
        strokeIndicator.title = strokeData.title;
        container.appendChild(strokeIndicator);
      });
    },

    /**
     * Refresh 2×/3× labels and tooltips for all hole buttons after course/par changes.
     */
    refreshMultiplierLabels() {
      const playerCount = getPlayerCount();

      for (let h = 1; h <= 18; h++) {
        const holePar = getPar(h - 1);
        const isPar3 = holePar === 3;
        const multiplierText = isPar3 ? '3×' : '2×';

        // Banker double/triple button
        const bankerDoubleBtn = document.getElementById(DOM_IDS.bankerDouble(h));
        if (bankerDoubleBtn) {
          bankerDoubleBtn.textContent = multiplierText;
          bankerDoubleBtn.title = isPar3 ? 'Banker triples all bets (Par 3)' : 'Banker doubles all bets';
        }

        // Player double/triple buttons already rendered in Bets column
        for (let p = 0; p < playerCount; p++) {
          const playerDoubleBtn = document.getElementById(DOM_IDS.playerDouble(p, h));
          if (playerDoubleBtn) {
            playerDoubleBtn.textContent = multiplierText;
            playerDoubleBtn.title = isPar3 ? 'Player triples their bet (Par 3)' : 'Player doubles their bet';
          }
        }
      }
    },

    /**
     * Refresh player names in headers
     */
    refreshPlayerNames() {
      const names = getPlayerNames();
      const playerCount = getPlayerCount();

      for (let h = 1; h <= 18; h++) {
        const bankerSelect = document.getElementById(DOM_IDS.bankerSelect(h));
        if (!bankerSelect) continue;

        for (let p = 0; p < playerCount; p++) {
          const option = bankerSelect.querySelector(`option[value="${p}"]`);
          if (option) {
            option.textContent = names[p] || `Player ${p + 1}`;
          }
        }
      }
      
      // Update footer header
      for (let p = 0; p < playerCount; p++) {
        const headerCell = document.getElementById(DOM_IDS.footerName(p));
        if (headerCell) {
          headerCell.textContent = names[p] || `P${p + 1}`;
        }

        const compactHeaderCell = document.getElementById(DOM_IDS.headerName(p));
        if (compactHeaderCell) {
          compactHeaderCell.textContent = names[p] || `P${p + 1}`;
        }
      }
    },

    /**
     * Rebuild compact totals block shown in Banker section header.
     */
    rebuildHeaderTotals() {
      const container = document.getElementById('bankerHeaderTotals');
      if (!container) return;

      container.innerHTML = '';
      const playerCount = getPlayerCount();
      const names = getPlayerNames();

      const table = document.createElement('table');
      table.className = 'banker-header-totals-table';

      const tbody = document.createElement('tbody');

      const totalsRow = document.createElement('tr');
      totalsRow.className = 'banker-header-title-row';
      const totalsCell = document.createElement('th');
      totalsCell.colSpan = playerCount + 1;
      totalsCell.textContent = 'Totals';
      totalsRow.appendChild(totalsCell);
      tbody.appendChild(totalsRow);

      const playerRow = document.createElement('tr');
      playerRow.className = 'banker-header-data-row';
      const playerLabel = document.createElement('td');
      playerLabel.textContent = 'Player';
      playerLabel.className = 'banker-footer-label';
      playerRow.appendChild(playerLabel);
      for (let p = 0; p < playerCount; p++) {
        const nameCell = document.createElement('td');
        nameCell.id = DOM_IDS.headerName(p);
        nameCell.textContent = names[p] || `P${p + 1}`;
        nameCell.className = 'banker-footer-player';
        playerRow.appendChild(nameCell);
      }
      tbody.appendChild(playerRow);

      const netRow = document.createElement('tr');
      netRow.className = 'banker-header-data-row';
      const netLabel = document.createElement('td');
      netLabel.textContent = 'Net';
      netLabel.className = 'banker-footer-label';
      netRow.appendChild(netLabel);
      for (let p = 0; p < playerCount; p++) {
        const totalCell = document.createElement('td');
        totalCell.id = DOM_IDS.headerTotalCell(p);
        totalCell.textContent = '$0.00';
        totalCell.className = 'banker-footer-total';
        netRow.appendChild(totalCell);
      }
      tbody.appendChild(netRow);

      table.appendChild(tbody);
      container.appendChild(table);
    },

    /**
     * Rebuild bottom totals card (same look as header totals card).
     * Populates #bankerFooterTotals using the existing footer cell IDs so
     * render() and refreshPlayerNames keep working unchanged.
     */
    rebuildFooter() {
      const container = document.getElementById('bankerFooterTotals');
      if (!container) return;

      container.innerHTML = '';
      const playerCount = getPlayerCount();
      const names = getPlayerNames();

      const table = document.createElement('table');
      table.className = 'banker-header-totals-table';

      const tbody = document.createElement('tbody');

      const titleRow = document.createElement('tr');
      titleRow.className = 'banker-header-title-row';
      const titleCell = document.createElement('th');
      titleCell.colSpan = playerCount + 1;
      titleCell.textContent = 'Totals';
      titleRow.appendChild(titleCell);
      tbody.appendChild(titleRow);

      const playerRow = document.createElement('tr');
      playerRow.className = 'banker-header-data-row';
      const playerLabel = document.createElement('td');
      playerLabel.textContent = 'Player';
      playerLabel.className = 'banker-footer-label';
      playerRow.appendChild(playerLabel);
      for (let p = 0; p < playerCount; p++) {
        const nameCell = document.createElement('td');
        nameCell.id = DOM_IDS.footerName(p);
        nameCell.textContent = names[p] || `P${p + 1}`;
        nameCell.className = 'banker-footer-player';
        playerRow.appendChild(nameCell);
      }
      tbody.appendChild(playerRow);

      const netRow = document.createElement('tr');
      netRow.className = 'banker-header-data-row';
      const netLabel = document.createElement('td');
      netLabel.textContent = 'Net';
      netLabel.className = 'banker-footer-label';
      netRow.appendChild(netLabel);
      for (let p = 0; p < playerCount; p++) {
        const totalCell = document.createElement('td');
        totalCell.id = DOM_IDS.totalCell(p);
        totalCell.textContent = '$0.00';
        totalCell.className = 'banker-footer-total';
        netRow.appendChild(totalCell);
      }
      tbody.appendChild(netRow);

      table.appendChild(tbody);
      container.appendChild(table);
    },

    /**
     * Initialize Banker game
     */
    init() {
      // Only do full init once
      if (!this._initialized) {
        this.buildTable();
        this.rebuildHeaderTotals();
        this.rebuildFooter();
        this.updateBetInputs();
        // Refresh names multiple times to ensure they're loaded from scorecard
        this.refreshPlayerNames();
        setTimeout(() => this.refreshPlayerNames(), 100);
        setTimeout(() => this.refreshPlayerNames(), 300);
        this.update();
        
        // Listen for score/name/CH changes - refresh names aggressively
          let _bankerScoreInputTimer = null;
          document.addEventListener('input', (e) => {
          const t = e.target;
          if (t.classList?.contains('name-edit')) {
            this.refreshPlayerNames();
            this.updateBetInputs();
            this.update();
            return;
          }

          if (t.classList?.contains('score-input') || 
              t.classList?.contains('ch-input')) {
            clearTimeout(_bankerScoreInputTimer);
            _bankerScoreInputTimer = setTimeout(() => {
              this.updateBetInputs();
              this.update();
            }, 160);
          }
        }, { passive: true });
        
        // Also listen for blur events to catch pasted values
        document.addEventListener('blur', (e) => {
          const t = e.target;
          if (t.classList?.contains('name-edit')) {
            this.refreshPlayerNames();
          }
        }, { passive: true });
        
        // Listen for scoring mode button group changes
        document.getElementById('bankerHcpModeGroup')?.addEventListener('click', (e) => {
          const btn = e.target.closest('.hcp-mode-btn');
          if (!btn) return;
          // Update active state
          document.querySelectorAll('#bankerHcpModeGroup .hcp-mode-btn').forEach((b) => {
            const isActive = b === btn;
            b.dataset.active = isActive ? 'true' : 'false';
            b.setAttribute('aria-checked', isActive ? 'true' : 'false');
          });
          this.updateBetInputs(); // Refresh to show/hide stroke indicators
          this.update();
          queueSave();
        });

        // Banker uses its own scoring mode (#bankerHcpModeGroup) and is
        // intentionally decoupled from the scorecard handicap mode selector.
        this._initialized = true;

        // Apply pending state synchronously — the table is already built at this
        // point so there is no need to defer.  A setTimeout here creates a race
        // where AppManager.recalcGames() fires first and renders empty results.
        if (this._pendingState) {
          this.setState(this._pendingState);
          this._pendingState = null;
        } else {
          // No pending state — try to load from localStorage as a safety net.
          // Use a short delay so that Storage.load() (which may still be in
          // progress when init() is called) has time to finish writing scores.
          setTimeout(() => {
            const savedState = localStorage.getItem('golf_scorecard_v5');
            if (savedState) {
              try {
                const state = JSON.parse(savedState);
                if (state.banker?.state) {
                  this.setState(state.banker.state);
                }
              } catch (e) {
                console.error('[Banker] Failed to restore state on init:', e);
              }
            }
          }, 80);
        }
      } else {
        // On subsequent opens, just refresh the UI without clearing data
        this.updateBetInputs();
        this.update();
      }
    },

    /**
     * Update calculations
     */
    update() {
      this.refreshMultiplierLabels();
      this.updateBankerStrokeIndicators();
      this.refreshBetStrokeIndicators();
      const data = this.compute();
      this.render(data);
    },

    /**
     * Refresh when player count changes
     */
    refreshForPlayerChange() {
      const bankerSection = document.getElementById('bankerSection');
      if (bankerSection && bankerSection.classList.contains('open')) {
        this.buildTable();
        this.rebuildHeaderTotals();
        this.rebuildFooter();
        this.updateBetInputs();
        this.refreshPlayerNames();
        this.update();
      }
    }
  };

  window.Banker = Banker;
})();
