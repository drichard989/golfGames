/* ============================================================================
   SKINS GAME MODULE
   ============================================================================
   
   Classic skins competition where players compete hole-by-hole for individual
   "skins" (prize money). Lowest net score wins each hole.
   
   GAME RULES:
   • Each hole has a skin worth $[buy-in] ÷ 18
   • Lowest net score wins the skin for that hole
   • Ties: skin carries over to next hole (pot accumulates)
   • Multiple ties: pot keeps growing until someone wins outright
   • Final carry-over distributed evenly among all players
   
   SCORING OPTIONS:
   • NET: Uses net scores with NDB cap (default)
   • GROSS: Uses raw scores without handicap adjustment
   
   HANDICAP MODES:
   • Standard: Full stroke allocation (1.0 strokes per HCP point)
   • Half-pops: Half stroke allocation (0.5 strokes per HCP point)
   
   FEATURES:
   • Dynamic player support (automatically adjusts for 1-99 players)
   • Buy-in calculator ($/skin and total pot)
   • Hole-by-hole breakdown with carry-over tracking
   • Summary display showing each player's winnings
   • Responsive table layout with color-coded winners
   
   Exposed as: window.Skins
   API: {init, refreshForPlayerChange, update, compute, render}
   
   ============================================================================
*/

(() => {
  'use strict';

  let skinsListenersBound = false;
  let skinsInitialized = false;
  let lastSkinsPlayerCount = 0;
  const SHARED_TIMING = window.GolfApp?.constants?.TIMING;
  const SKINS_INPUT_DEBOUNCE_MS = SHARED_TIMING?.GAME_RECALC_DEBOUNCE_MS || 160;

  function getFixedPlayerRows() {
    const rows = window.GolfApp?.utils?.getFixedPlayerRowsCached?.();
    return Array.isArray(rows) ? rows : Array.from(document.querySelectorAll('#scorecard .player-row'));
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================

  /**
   * Get adjusted handicaps from main scorecard (play-off-low)
   * @returns {number[]} Array of adjusted handicaps
   */
  function getAdjustedCHs() {
    try {
      const playerRows = getFixedPlayerRows();
      const chs = [];
      playerRows.forEach(row => {
        const chInput = row.querySelector('.ch-input');
        const val = chInput?.value || '';
        chs.push(val === '' ? null : (typeof window.getActualHandicapValue === 'function' ? window.getActualHandicapValue(chInput) : parseFloat(val)));
      });
      const validCHs = chs.filter(ch => ch !== null);
      if (validCHs.length === 0) return chs.map(() => 0);
      const minCH = Math.min(...validCHs);
      return chs.map(ch => ch !== null ? ch - minCH : 0);
    } catch (error) {
      console.error('[Skins] Error getting adjusted CHs:', error);
      return [];
    }
  }

  /**
   * Get raw (full) handicaps from main scorecard
   * @returns {number[]} Array of raw handicaps
   */
  function getRawCHs() {
    try {
      const playerRows = getFixedPlayerRows();
      return Array.from(playerRows).map(row => {
        const chInput = row.querySelector('.ch-input');
        const v = typeof window.getActualHandicapValue === 'function'
          ? window.getActualHandicapValue(chInput)
          : parseFloat(chInput?.value);
        return Number.isFinite(v) ? v : 0;
      });
    } catch (error) {
      console.error('[Skins] Error getting raw CHs:', error);
      return [];
    }
  }

  /**
   * Get player count from scorecard
   * @returns {number}
   */
  function getPlayerCount() {
    try {
      return getFixedPlayerRows().length;
    } catch (error) {
      console.error('[Skins] Error getting player count:', error);
      return 0;
    }
  }

  /**
   * Get hole count (always 18)
   * @returns {number}
   */
  function getHoleCount() {
    return 18;
  }

  /**
   * Get par for a hole
   * @param {number} holeIdx - Zero-based hole index
   * @returns {number}
   */
  function getPar(holeIdx) {
    try {
      const parRow = document.getElementById('parRow');
      if (!parRow) {
        console.error('[Skins] Par row not found - scorecard not initialized!');
        return 4; // Fallback only if DOM missing
      }
      const inputs = parRow.querySelectorAll('input[type="number"]');
      const value = Number(inputs[holeIdx]?.value);
      if (!value || !Number.isFinite(value)) {
        console.error(`[Skins] Par value missing for hole ${holeIdx + 1}`);
        return 4; // Fallback only if value missing
      }
      return value;
    } catch (error) {
      console.error('[Skins] Error getting par:', error);
      return 4;
    }
  }

  /**
   * Get pars array
   * @returns {number[]}
   */
  function getPars() {
    const pars = [];
    for (let i = 0; i < 18; i++) {
      pars.push(getPar(i));
    }
    return pars;
  }

  /**
   * Get HCP index for a hole
   * @param {number} holeIdx - Zero-based hole index
   * @returns {number}
   */
  function getHCPIndex(holeIdx) {
    // Use global HCPMEN array (set by Config in index.js)
    const HCPMEN = window.HCPMEN;
    if (!HCPMEN || !Array.isArray(HCPMEN)) {
      console.error('[Skins] HCPMEN not loaded - course data missing!');
      return 1; // Fallback only if array completely missing
    }
    return HCPMEN[holeIdx] || 1;
  }

  /**
   * Get gross score for a player on a hole
   * @param {number} playerIdx - Zero-based player index
   * @param {number} holeIdx - Zero-based hole index
   * @returns {number}
   */
  function getGross(playerIdx, holeIdx) {
    const input = document.querySelector(
      `.score-input[data-player="${playerIdx}"][data-hole="${holeIdx + 1}"]`
    );
    return Number(input?.value) || 0;
  }

  /**
   * Calculate strokes on a hole with half-pops awareness
   * @param {number} adjCH - Adjusted course handicap
   * @param {number} holeIdx - Zero-based hole index
   * @param {boolean} half - Whether half-pops mode is enabled
   * @returns {number} Strokes received (or given if negative)
   */
  function strokesOnHoleHalfAware(adjCH, holeIdx, half) {
    const holeHcp = getHCPIndex(holeIdx);
    
    // Handle plus handicaps (negative adjCH means player gives strokes)
    if (adjCH < 0) {
      const absAdj = Math.abs(adjCH);
      const base = Math.floor(absAdj / 18);
      const rem = absAdj % 18;
      const fullStrokes = base + (holeHcp <= rem ? 1 : 0);
      // Half pops: give 0.5 strokes instead of 1
      return half ? -(fullStrokes * 0.5) : -fullStrokes;
    }
    
    if (adjCH === 0) return 0;
    
    // Calculate full strokes normally
    const base = Math.floor(adjCH / 18);
    const rem = adjCH % 18;
    const fullStrokes = base + (holeHcp <= rem ? 1 : 0);
    
    // Half pops: get 0.5 strokes instead of 1
    return half ? (fullStrokes * 0.5) : fullStrokes;
  }

  /**
   * Get player names for display
   * @returns {string[]}
   */
  function getPlayerNames() {
    const names = [];
    const playerRows = getFixedPlayerRows();
    playerRows.forEach((row, idx) => {
      const nameInput = row.querySelector('.name-edit');
      const name = nameInput?.value?.trim() || 
                   nameInput?.placeholder || 
                   nameInput?.dataset.default || 
                   `P${idx + 1}`;
      names.push(name);
    });
    return names;
  }

  // =============================================================================
  // SKINS MODULE
  // =============================================================================

  const Skins = {
    /**
     * Compute skins outcome for all holes and players
     * @param {{carry:boolean, half:boolean, buyIn:number, useNet:boolean}} opts
     * @returns {{totals:number[], holesWon:string[][], carryoverHoles:Map[], winnings:number[], totalSkins:number}}
     */
    compute(opts) {
      const { carry, half, buyIn, useNet } = opts;
      const playerCount = getPlayerCount();
      const HOLES = getHoleCount();
      const totals = Array(playerCount).fill(0);
      const holesWon = Array(playerCount).fill(null).map(() => []);
      const carryoverHoles = Array(playerCount).fill(null).map(() => new Map());
      const winnings = Array(playerCount).fill(0);
      let pot = 1;
      let carryoverFromHoles = []; // Track which holes contribute to current pot

       const grossByPlayer = Array.from({ length: playerCount }, () => Array(HOLES).fill(0));
       for (let p = 0; p < playerCount; p++) {
         for (let h = 0; h < HOLES; h++) {
           grossByPlayer[p][h] = getGross(p, h);
         }
       }

       const pars = useNet ? getPars() : [];
       const handicapByPlayer = useNet
         ? (opts.netHcpMode === 'rawHandicap' ? getRawCHs() : getAdjustedCHs())
         : [];

      for (let h = 0; h < HOLES; h++) {
        // Use gross or net scores based on mode
        const scores = Array.from({ length: playerCount }, (_, p) => 
          useNet
            ? (() => {
                const gross = grossByPlayer[p][h];
                if (!gross) return 0;
                const adj = handicapByPlayer[p] || 0;
                const sr = strokesOnHoleHalfAware(adj, h, half);
                const ndb = (pars[h] || 4) + 2 + sr;
                const capped = Math.min(gross, ndb);
                return capped - sr;
              })()
            : grossByPlayer[p][h]
        );
        const filled = scores.map((n, p) => ({ n, p })).filter(x => x.n > 0);
        if (filled.length < 2) {
          if (carry) {
            pot++;
            carryoverFromHoles.push(h + 1); // Add this hole to carryover list
          }
          continue;
        }
        const min = Math.min(...filled.map(x => x.n));
        const winners = filled.filter(x => x.n === min).map(x => x.p);
        if (winners.length !== 1) {
          if (carry) {
            pot++;
            carryoverFromHoles.push(h + 1); // Add this hole to carryover list
          }
          continue;
        }
        const w = winners[0];
        totals[w] += pot;
        holesWon[w].push(String(h + 1));
        // buyIn is the amount EACH player risks per hole.
        // Carryover keeps pot as hole-count units, so stake per player is pot * buyIn.
        const stakePerPlayer = pot * buyIn;
        if (playerCount > 1 && stakePerPlayer !== 0) {
          for (let p = 0; p < playerCount; p++) {
            if (p === w) continue;
            winnings[p] -= stakePerPlayer;
          }
          winnings[w] += stakePerPlayer * (playerCount - 1);
        }
        // Track which holes were carried over to this winning hole
        if (carryoverFromHoles.length > 0) {
          carryoverHoles[w].set(String(h + 1), [...carryoverFromHoles]);
        }
        pot = 1;
        carryoverFromHoles = []; // Reset carryover list
      }

      const totalSkins = totals.reduce((sum, t) => sum + t, 0);

      return { totals, holesWon, carryoverHoles, winnings, totalSkins };
    },

    /**
     * Render computed skins results into the DOM
     * @param {{totals:number[], holesWon:string[][], carryoverHoles:Map[], winnings:number[]}} data
     */
    render(data) {
      const { totals, holesWon, carryoverHoles, winnings } = data;
      const playerCount = totals.length;
      for (let p = 0; p < playerCount; p++) {
        const holesCell = document.getElementById('skinsHoles' + p);
        const totCell = document.getElementById('skinsTotal' + p);
        const winCell = document.getElementById('skinsWinnings' + p);
        
        // Format holes with carryover holes in curly braces
        if (holesCell && holesWon[p]) {
          const carryoverMap = carryoverHoles[p] || new Map();
          const formattedHoles = holesWon[p].map(hole => {
            const carriedFrom = carryoverMap.get(hole);
            if (carriedFrom && carriedFrom.length > 0) {
              return `${hole} {${carriedFrom.join(',')}}`;
            }
            return hole;
          });
          holesCell.textContent = formattedHoles.join(', ');
        }
        
        if (totCell) totCell.textContent = String(totals[p] || 0);
        if (winCell) {
          const amount = winnings[p] || 0;
          if (amount > 0) {
            winCell.textContent = `Collects $${amount.toFixed(2)}`;
            winCell.style.color = 'var(--accent)'; // Green for profit
            winCell.style.fontWeight = '600';
          } else if (amount < 0) {
            winCell.textContent = `Owes $${Math.abs(amount).toFixed(2)}`;
            winCell.style.color = 'var(--danger)'; // Red for loss
            winCell.style.fontWeight = '600';
          } else {
            winCell.textContent = 'Even';
            winCell.style.color = 'var(--muted)'; // Gray for break-even
            winCell.style.fontWeight = '400';
          }
        }
      }
    }
  };

  // =============================================================================
  // TABLE BUILDING & UPDATES
  // =============================================================================

  /**
   * Build the Skins table based on current player count
   */
  function buildSkinsTable() {
    const body = document.getElementById('skinsBody');
    if (!body) return;
    
    // Always rebuild to match current player count
    body.innerHTML = '';
    body.dataset.simple = '';
    
    const playerCount = getPlayerCount();
    for (let p = 0; p < playerCount; p++) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.id = 'skinsName' + p;
      th.textContent = 'P' + (p + 1);
      
      const tdH = document.createElement('td');
      tdH.id = 'skinsHoles' + p;
      
      const tdT = document.createElement('td');
      tdT.id = 'skinsTotal' + p;
      tdT.textContent = '0';
      
      const tdW = document.createElement('td');
      tdW.id = 'skinsWinnings' + p;
      tdW.textContent = '—';
      
      tr.append(th, tdH, tdT, tdW);
      body.appendChild(tr);
    }
    body.dataset.simple = '1';
  }

  function ensureSkinsTableBuilt(force = false) {
    const body = document.getElementById('skinsBody');
    if (!body) return false;

    const playerCount = getPlayerCount();
    const existingRows = body.querySelectorAll('tr').length;
    const needsRebuild = force || !skinsInitialized || playerCount !== lastSkinsPlayerCount || existingRows !== playerCount;

    if (!needsRebuild) return false;

    buildSkinsTable();
    lastSkinsPlayerCount = playerCount;
    return true;
  }

  /**
   * Refresh player names in Skins table header
   */
  function refreshSkinsHeaderNames() {
    const names = getPlayerNames();
    names.forEach((name, idx) => {
      const el = document.getElementById('skinsName' + idx);
      if (el) el.textContent = name;
    });
  }

  /**
   * Update Skins calculations and render
   */
  function updateSkins() {
    ensureSkinsTableBuilt();
    refreshSkinsHeaderNames();

    const activeBtn = document.querySelector('#skinsHcpModeGroup .hcp-mode-btn[data-active="true"]');
    const mode = activeBtn?.dataset.value || 'gross';
    const useNet = mode !== 'gross';
    const netHcpMode = mode === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
    const carry = document.getElementById('skinsCarry')?.checked ?? true;
    const half = document.getElementById('skinsHalf')?.checked ?? false;
    const buyIn = Math.max(0, Number(document.getElementById('skinsBuyIn')?.value) || 0);
    const data = Skins.compute({ carry, half, buyIn, useNet, netHcpMode });
    Skins.render(data);
  }

  /**
   * Refresh Skins table when player count changes
   */
  function refreshSkinsForPlayerChange() {
    const skinsSection = document.getElementById('skinsSection');
    if (skinsSection && skinsSection.classList.contains('open')) {
      ensureSkinsTableBuilt(true);
      refreshSkinsHeaderNames();
      updateSkins();
    }
  }

  /**
   * Initialize Skins game
   */
  function initSkins() {
    ensureSkinsTableBuilt();
    refreshSkinsHeaderNames();
    
    // Sync half-pop disabled state with current mode
    const syncHalfPopState = () => {
      const activeBtn = document.querySelector('#skinsHcpModeGroup .hcp-mode-btn[data-active="true"]');
      const isNet = (activeBtn?.dataset.value || 'gross') !== 'gross';
      const halfEl = document.getElementById('skinsHalf');
      if (halfEl) halfEl.disabled = !isNet;
    };
    syncHalfPopState();
    
    updateSkins();
    skinsInitialized = true;

    if (!skinsListenersBound) {
      skinsListenersBound = true;

      document.getElementById('skinsHcpModeGroup')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.hcp-mode-btn');
        if (!btn) return;
        // Update active state
        document.querySelectorAll('#skinsHcpModeGroup .hcp-mode-btn').forEach((b) => {
          const isActive = b === btn;
          b.dataset.active = isActive ? 'true' : 'false';
          b.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });
        const isNet = btn.dataset.value !== 'gross';
        const halfEl = document.getElementById('skinsHalf');
        if (halfEl) {
          halfEl.disabled = !isNet;
          if (!isNet) halfEl.checked = false;
        }
        updateSkins();
        if (typeof window.saveDebounced === 'function') window.saveDebounced();
      });
      
      // Recompute on option change
      document.getElementById('skinsCarry')?.addEventListener('change', () => {
        updateSkins();
        if (typeof window.saveDebounced === 'function') window.saveDebounced();
      });
      document.getElementById('skinsHalf')?.addEventListener('change', () => {
        updateSkins();
        if (typeof window.saveDebounced === 'function') window.saveDebounced();
      });
      document.getElementById('skinsBuyIn')?.addEventListener('input', () => {
        updateSkins();
        if (typeof window.saveDebounced === 'function') window.saveDebounced();
      });

      // Recompute on any score/par/ch input (debounced to avoid stutter on every keypress)
      let _skinsScoreInputTimer = null;
      document.addEventListener('input', (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        if (t.classList?.contains('name-edit')) {
          refreshSkinsHeaderNames();
          return;
        }
        if (t.classList?.contains('score-input') || 
            t.classList?.contains('ch-input') || 
            t.closest('#scorecard')) {
          clearTimeout(_skinsScoreInputTimer);
          _skinsScoreInputTimer = setTimeout(() => updateSkins(), SKINS_INPUT_DEBOUNCE_MS);
        }
      }, { passive: true });
    }
  }

  // =============================================================================
  // EXPOSE TO GLOBAL SCOPE
  // =============================================================================

  window.Skins = {
    init: initSkins,
    refreshForPlayerChange: refreshSkinsForPlayerChange,
    update: updateSkins,
    compute: Skins.compute,
    render: Skins.render
  };

})();
