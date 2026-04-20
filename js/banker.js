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
        const ch = Number(chInput?.value) || 0;
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
   * Calculate strokes on a hole based on adjusted handicap
   */
  function strokesOnHole(adjCH, holeIdx) {
    if (adjCH === 0) return 0;
    
    const holeHcp = getHCPIndex(holeIdx);
    const base = Math.floor(Math.abs(adjCH) / 18);
    const rem = Math.abs(adjCH) % 18;
    const strokes = base + (holeHcp <= rem ? 1 : 0);
    
    // Return negative if this is a plus handicap (they give strokes)
    return adjCH < 0 ? -strokes : strokes;
  }

  /**
   * Calculate net score for a player on a hole
   */
  function getNetScore(playerIdx, holeIdx) {
    const gross = getGross(playerIdx, holeIdx);
    if (gross === 0) return 0;
    
    const adjCHs = getAdjustedCHs();
    const strokes = strokesOnHole(adjCHs[playerIdx], holeIdx);
    
    // Net = gross - strokes (if + handicap, strokes are negative so they add)
    return gross - strokes;
  }

  // =============================================================================
  // BANKER MODULE
  // =============================================================================

  const Banker = {
    /**
     * Compute Banker results for all holes
     * @returns {Object} Banker game results
     */
    compute() {
      const playerCount = getPlayerCount();
      const holes = 18;
      
      const holeResults = [];
      const playerTotals = Array(playerCount).fill(0);
      
      for (let h = 0; h < holes; h++) {
        const holeNum = h + 1;
        
        // Get banker for this hole
        const bankerSelect = document.getElementById(`banker_h${holeNum}`);
        const bankerIdx = bankerSelect ? Number(bankerSelect.value) : -1;
        
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
        
        // Get max bet
        const maxBetInput = document.getElementById(`banker_maxbet_h${holeNum}`);
        const maxBet = maxBetInput ? Number(maxBetInput.value) || 0 : 0;
        
        // Get banker double
        const bankerDoubleCheck = document.getElementById(`banker_double_h${holeNum}`);
        const bankerDouble = bankerDoubleCheck?.checked || false;
        
        // Get net scores for all players
        const netScores = [];
        let allScoresEntered = true;
        
        for (let p = 0; p < playerCount; p++) {
          const net = getNetScore(p, h);
          netScores.push(net);
          if (net === 0) allScoresEntered = false;
        }
        
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
        
        // Process bets for each player (except banker)
        const bets = [];
        const bankerNet = netScores[bankerIdx];
        
        for (let p = 0; p < playerCount; p++) {
          if (p === bankerIdx) continue;
          
          const betInput = document.getElementById(`banker_bet_p${p}_h${holeNum}`);
          const betAmount = betInput ? Number(betInput.value) || 0 : 0;
          
          if (betAmount === 0) continue;
          
          const playerDoubleCheck = document.getElementById(`banker_pdouble_p${p}_h${holeNum}`);
          const playerDouble = playerDoubleCheck?.checked || false;
          
          const playerNet = netScores[p];
          
          // Calculate payout
          let multiplier = 1;
          if (playerDouble) multiplier *= 2;
          if (bankerDouble) multiplier *= 2;
          
          const basePayout = betAmount * multiplier;
          
          let winner = null;
          let payout = 0;
          
          if (playerNet < bankerNet) {
            // Player wins
            winner = p;
            payout = basePayout;
            playerTotals[p] += payout;
            playerTotals[bankerIdx] -= payout;
          } else if (playerNet > bankerNet) {
            // Banker wins
            winner = bankerIdx;
            payout = -basePayout;
            playerTotals[p] -= basePayout;
            playerTotals[bankerIdx] += basePayout;
          }
          // If tied, no payout
          
          bets.push({
            player: p,
            betAmount: betAmount,
            playerDouble: playerDouble,
            playerNet: playerNet,
            bankerNet: bankerNet,
            winner: winner,
            payout: payout,
            multiplier: multiplier
          });
        }
        
        holeResults.push({
          hole: holeNum,
          banker: bankerIdx,
          maxBet: maxBet,
          bankerDouble: bankerDouble,
          bets: bets
        });
      }
      
      return { holeResults, playerTotals };
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
        const totalCell = document.getElementById(`banker_total_p${p}`);
        if (totalCell) {
          const total = playerTotals[p] || 0;
          totalCell.textContent = total >= 0 ? `+$${total.toFixed(2)}` : `-$${Math.abs(total).toFixed(2)}`;
          
          // Color code
          if (total > 0) {
            totalCell.style.color = 'var(--accent)';
          } else if (total < 0) {
            totalCell.style.color = 'var(--danger)';
          } else {
            totalCell.style.color = '';
          }
        }
      }
      
      // Update hole results
      holeResults.forEach(hole => {
        const resultCell = document.getElementById(`banker_result_h${hole.hole}`);
        if (!resultCell) return;
        
        if (hole.error) {
          resultCell.textContent = hole.error;
          resultCell.style.fontSize = '11px';
          return;
        }
        
        if (hole.bets.length === 0) {
          resultCell.textContent = 'No bets';
          resultCell.style.fontSize = '11px';
          return;
        }
        
        // Show results per bet
        const results = hole.bets.map(bet => {
          const playerName = names[bet.player]?.substring(0, 8) || `P${bet.player + 1}`;
          const sign = bet.payout >= 0 ? '+' : '';
          return `${playerName}: ${sign}$${bet.payout.toFixed(0)}`;
        }).join(', ');
        
        resultCell.textContent = results;
        resultCell.style.fontSize = '10px';
      });
    },

    /**
     * Build the Banker table
     */
    buildTable() {
      const tbody = document.getElementById('bankerBody');
      if (!tbody) return;
      
      tbody.innerHTML = '';
      const playerCount = getPlayerCount();
      const names = getPlayerNames();
      
      for (let h = 1; h <= 18; h++) {
        const tr = document.createElement('tr');
        
        // Hole number
        const holeTd = document.createElement('td');
        holeTd.textContent = h;
        tr.appendChild(holeTd);
        
        // Banker select
        const bankerTd = document.createElement('td');
        const bankerSelect = document.createElement('select');
        bankerSelect.id = `banker_h${h}`;
        bankerSelect.className = 'banker-select';
        bankerSelect.style.cssText = 'width: 100%; padding: 4px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 4px;';
        
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
          this.updateBetInputs();
          this.update();
          if (typeof window.saveDebounced === 'function') {
            window.saveDebounced();
          }
        });
        
        bankerTd.appendChild(bankerSelect);
        tr.appendChild(bankerTd);
        
        // Max Bet
        const maxBetTd = document.createElement('td');
        const maxBetInput = document.createElement('input');
        maxBetInput.id = `banker_maxbet_h${h}`;
        maxBetInput.type = 'number';
        maxBetInput.min = '0';
        maxBetInput.step = '1';
        maxBetInput.value = '10';
        maxBetInput.style.cssText = 'width: 60px; padding: 4px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 4px; text-align: center;';
        maxBetInput.addEventListener('input', () => {
          this.update();
          if (typeof window.saveDebounced === 'function') {
            window.saveDebounced();
          }
        });
        maxBetTd.appendChild(maxBetInput);
        tr.appendChild(maxBetTd);
        
        // Bets column (will be populated dynamically)
        const betsTd = document.createElement('td');
        betsTd.id = `banker_bets_h${h}`;
        betsTd.style.cssText = 'padding: 4px; font-size: 11px;';
        tr.appendChild(betsTd);
        
        // Banker Double checkbox
        const bankerDoubleTd = document.createElement('td');
        const bankerDoubleCheck = document.createElement('input');
        bankerDoubleCheck.id = `banker_double_h${h}`;
        bankerDoubleCheck.type = 'checkbox';
        bankerDoubleCheck.style.cssText = 'cursor: pointer;';
        bankerDoubleCheck.addEventListener('change', () => {
          this.update();
          if (typeof window.saveDebounced === 'function') {
            window.saveDebounced();
          }
        });
        bankerDoubleTd.appendChild(bankerDoubleCheck);
        tr.appendChild(bankerDoubleTd);
        
        // Result column
        const resultTd = document.createElement('td');
        resultTd.id = `banker_result_h${h}`;
        resultTd.style.cssText = 'font-size: 11px; padding: 4px;';
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
      
      for (let h = 1; h <= 18; h++) {
        const betsTd = document.getElementById(`banker_bets_h${h}`);
        if (!betsTd) continue;
        
        const bankerSelect = document.getElementById(`banker_h${h}`);
        const bankerIdx = bankerSelect ? Number(bankerSelect.value) : -1;
        
        if (bankerIdx < 0 || bankerIdx >= playerCount) {
          betsTd.innerHTML = '<span style="color: var(--muted); font-size: 10px;">Select banker</span>';
          continue;
        }
        
        // Create bet inputs for each non-banker player
        const betInputs = [];
        
        for (let p = 0; p < playerCount; p++) {
          if (p === bankerIdx) continue;
          
          const playerName = (names[p] || `P${p + 1}`).substring(0, 6);
          
          const container = document.createElement('div');
          container.style.cssText = 'display: flex; gap: 4px; align-items: center; margin-bottom: 2px;';
          
          const label = document.createElement('span');
          label.textContent = `${playerName}:`;
          label.style.cssText = 'min-width: 45px; font-size: 10px;';
          
          const betInput = document.createElement('input');
          betInput.id = `banker_bet_p${p}_h${h}`;
          betInput.type = 'number';
          betInput.min = '0';
          betInput.step = '1';
          betInput.value = '0';
          betInput.style.cssText = 'width: 45px; padding: 2px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 3px; text-align: center; font-size: 11px;';
          betInput.addEventListener('input', () => {
            this.update();
            if (typeof window.saveDebounced === 'function') {
              window.saveDebounced();
            }
          });
          
          const doubleCheck = document.createElement('input');
          doubleCheck.id = `banker_pdouble_p${p}_h${h}`;
          doubleCheck.type = 'checkbox';
          doubleCheck.title = 'Player doubles';
          doubleCheck.style.cssText = 'cursor: pointer;';
          doubleCheck.addEventListener('change', () => {
            this.update();
            if (typeof window.saveDebounced === 'function') {
              window.saveDebounced();
            }
          });
          
          const doubleLabel = document.createElement('span');
          doubleLabel.textContent = '2×';
          doubleLabel.style.cssText = 'font-size: 9px; color: var(--muted);';
          
          container.appendChild(label);
          container.appendChild(betInput);
          container.appendChild(doubleCheck);
          container.appendChild(doubleLabel);
          
          betInputs.push(container);
        }
        
        betsTd.innerHTML = '';
        betInputs.forEach(input => betsTd.appendChild(input));
      }
    },

    /**
     * Refresh player names in headers
     */
    refreshPlayerNames() {
      const names = getPlayerNames();
      const playerCount = getPlayerCount();
      
      // Update footer header
      for (let p = 0; p < playerCount; p++) {
        const headerCell = document.getElementById(`banker_name_p${p}`);
        if (headerCell) {
          headerCell.textContent = names[p] || `P${p + 1}`;
        }
      }
    },

    /**
     * Rebuild footer to match current player count
     */
    rebuildFooter() {
      const tfoot = document.querySelector('#bankerTable tfoot');
      if (!tfoot) return;
      
      tfoot.innerHTML = '';
      const playerCount = getPlayerCount();
      const names = getPlayerNames();
      
      const totalsRow = document.createElement('tr');
      
      const labelTd = document.createElement('td');
      labelTd.innerHTML = '<strong>Totals</strong>';
      labelTd.colSpan = 5;
      totalsRow.appendChild(labelTd);
      
      tfoot.appendChild(totalsRow);
      
      // Player totals row
      const playerTotalsRow = document.createElement('tr');
      
      const playerLabelTd = document.createElement('td');
      playerLabelTd.textContent = 'Player';
      playerLabelTd.style.cssText = 'text-align: left; padding-left: 8px;';
      playerTotalsRow.appendChild(playerLabelTd);
      
      for (let p = 0; p < playerCount; p++) {
        const nameTd = document.createElement('td');
        nameTd.id = `banker_name_p${p}`;
        nameTd.textContent = names[p] || `P${p + 1}`;
        nameTd.style.cssText = 'font-size: 11px; font-weight: 600;';
        playerTotalsRow.appendChild(nameTd);
      }
      
      tfoot.appendChild(playerTotalsRow);
      
      // Totals row
      const amountsRow = document.createElement('tr');
      
      const amountLabelTd = document.createElement('td');
      amountLabelTd.textContent = 'Net';
      amountLabelTd.style.cssText = 'text-align: left; padding-left: 8px;';
      amountsRow.appendChild(amountLabelTd);
      
      for (let p = 0; p < playerCount; p++) {
        const totalTd = document.createElement('td');
        totalTd.id = `banker_total_p${p}`;
        totalTd.textContent = '$0.00';
        totalTd.style.cssText = 'font-weight: 700; font-size: 13px;';
        amountsRow.appendChild(totalTd);
      }
      
      tfoot.appendChild(amountsRow);
    },

    /**
     * Initialize Banker game
     */
    init() {
      this.buildTable();
      this.rebuildFooter();
      this.updateBetInputs();
      this.refreshPlayerNames();
      this.update();
      
      // Listen for score/name changes
      document.addEventListener('input', (e) => {
        const t = e.target;
        if (t.classList?.contains('score-input') || 
            t.classList?.contains('ch-input') ||
            t.classList?.contains('name-edit')) {
          if (t.classList.contains('name-edit')) {
            this.refreshPlayerNames();
          }
          this.update();
        }
      }, { passive: true });
    },

    /**
     * Update calculations
     */
    update() {
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
        this.rebuildFooter();
        this.updateBetInputs();
        this.refreshPlayerNames();
        this.update();
      }
    }
  };

  window.Banker = Banker;
})();
