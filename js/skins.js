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
  console.log('[Skins] Module loaded');

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================

  /**
   * Get adjusted handicaps from main scorecard
   * @returns {number[]} Array of adjusted handicaps
   */
  function getAdjustedCHs() {
    const playerRows = document.querySelectorAll('.player-row');
    const chs = [];
    playerRows.forEach(row => {
      const chInput = row.querySelector('.ch-input');
      const val = chInput?.value || '';
      chs.push(val === '' ? null : parseFloat(val));
    });
    const validCHs = chs.filter(ch => ch !== null);
    if (validCHs.length === 0) return chs.map(() => 0);
    const minCH = Math.min(...validCHs);
    return chs.map(ch => ch !== null ? ch - minCH : 0);
  }

  /**
   * Get player count from scorecard
   * @returns {number}
   */
  function getPlayerCount() {
    return document.querySelectorAll('.player-row').length;
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
   * Calculate net score for Skins game with optional half-pops
   * @param {number} playerIdx - Zero-based player index
   * @param {number} holeIdx - Zero-based hole index
   * @param {boolean} half - Whether half-pops mode is enabled
   * @returns {number} Net score with NDB cap
   */
  function getNetForSkins(playerIdx, holeIdx, half) {
    const adjCHs = getAdjustedCHs();
    const gross = getGross(playerIdx, holeIdx);
    if (!gross) return 0;
    
    const adj = adjCHs[playerIdx];
    const sr = strokesOnHoleHalfAware(adj, holeIdx, half);
    const NDB_BUFFER = 2;
    const par = getPar(holeIdx);
    const ndb = par + NDB_BUFFER + sr;
    const adjGross = Math.min(gross, ndb);
    return adjGross - sr;
  }

  /**
   * Get player names for display
   * @returns {string[]}
   */
  function getPlayerNames() {
    const names = [];
    const playerRows = document.querySelectorAll('.player-row');
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
     * @param {{carry:boolean, half:boolean, buyIn:number}} opts
     * @returns {{totals:number[], holesWon:string[][], winnings:number[], pot:number, totalSkins:number, activePlayers:number}}
     */
    compute(opts) {
      const { carry, half, buyIn } = opts;
      const playerCount = getPlayerCount();
      const HOLES = getHoleCount();
      const totals = Array(playerCount).fill(0);
      const holesWon = Array(playerCount).fill(null).map(() => []);
      let pot = 1;

      for (let h = 0; h < HOLES; h++) {
        const nets = Array.from({ length: playerCount }, (_, p) => 
          getNetForSkins(p, h, half)
        );
        
        const filled = nets.map((n, p) => ({ n, p })).filter(x => x.n > 0);
        if (filled.length < 2) {
          if (carry) pot++;
          continue;
        }
        const min = Math.min(...filled.map(x => x.n));
        const winners = filled.filter(x => x.n === min).map(x => x.p);
        if (winners.length !== 1) {
          if (carry) pot++;
          continue;
        }
        const w = winners[0];
        totals[w] += pot;
        holesWon[w].push(String(h + 1));
        pot = 1;
      }

      // Count active players (those with at least one score)
      const activePlayers = Array.from({ length: playerCount }, (_, p) => p)
        .filter(p => {
          for (let h = 0; h < HOLES; h++) {
            if (getGross(p, h) > 0) return true;
          }
          return false;
        }).length;

      // Calculate dollar winnings
      const totalSkins = totals.reduce((sum, t) => sum + t, 0);
      const moneyPot = buyIn * activePlayers;
      const winnings = totals.map(skinCount => {
        if (totalSkins === 0) return 0;
        return (skinCount / totalSkins) * moneyPot;
      });

      return { totals, holesWon, winnings, pot: moneyPot, totalSkins, activePlayers };
    },

    /**
     * Render computed skins results into the DOM
     * @param {{totals:number[], holesWon:string[][], winnings:number[]}} data
     */
    render(data) {
      const { totals, holesWon, winnings } = data;
      const playerCount = totals.length;
      for (let p = 0; p < playerCount; p++) {
        const holesCell = document.getElementById('skinsHoles' + p);
        const totCell = document.getElementById('skinsTotal' + p);
        const winCell = document.getElementById('skinsWinnings' + p);
        if (holesCell) holesCell.textContent = (holesWon[p] || []).join(', ');
        if (totCell) totCell.textContent = String(totals[p] || 0);
        if (winCell) {
          const amount = winnings[p] || 0;
          winCell.textContent = amount > 0 ? `$${amount.toFixed(2)}` : '—';
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
    const carry = document.getElementById('skinsCarry')?.checked ?? true;
    const half = document.getElementById('skinsHalf')?.checked ?? false;
    const buyIn = Math.max(0, Number(document.getElementById('skinsBuyIn')?.value) || 0);
    const data = Skins.compute({ carry, half, buyIn });
    Skins.render(data);
  }

  /**
   * Refresh Skins table when player count changes
   */
  function refreshSkinsForPlayerChange() {
    const skinsSection = document.getElementById('skinsSection');
    if (skinsSection && skinsSection.classList.contains('open')) {
      buildSkinsTable();
      refreshSkinsHeaderNames();
      updateSkins();
    }
  }

  /**
   * Initialize Skins game
   */
  function initSkins() {
    buildSkinsTable();
    refreshSkinsHeaderNames();
    updateSkins();

    // Recompute on option change
    document.getElementById('skinsCarry')?.addEventListener('change', updateSkins);
    document.getElementById('skinsHalf')?.addEventListener('change', updateSkins);
    document.getElementById('skinsBuyIn')?.addEventListener('input', () => {
      updateSkins();
      // Call saveDebounced if available
      if (typeof window.saveDebounced === 'function') {
        window.saveDebounced();
      }
    });

    // Recompute on any score/par/ch input
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.classList?.contains('score-input') || 
          t.classList?.contains('ch-input') || 
          t.closest('#scorecard')) {
        updateSkins();
      }
      if (t.classList?.contains('name-edit')) {
        refreshSkinsHeaderNames();
      }
    }, { passive: true });
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

  console.log('[Skins] Module initialized, exposed as window.Skins');

})();
