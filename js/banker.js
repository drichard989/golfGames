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
    _initialized: false,
    
    /**
     * Get current banker game state for saving
     * @returns {Object} Complete banker game state
     */
    getState() {
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
      const bankerSelect = document.getElementById(`banker_h${h}`);
      if (bankerSelect) {
          holeState.banker = Number(bankerSelect.value);
        }
        
        // Get max bet
        const maxBetInput = document.getElementById(`banker_maxbet_h${h}`);
        if (maxBetInput) {
          holeState.maxBet = Number(maxBetInput.value) || 10;
        }
        
        // Get banker double
      const bankerDoubleBtn = document.getElementById(`banker_double_h${h}`);
      if (bankerDoubleBtn) {
          holeState.bankerDouble = bankerDoubleBtn.dataset.active === 'true';
        }
        
        // Get player bets
        const playerCount = getPlayerCount();
        for (let p = 0; p < playerCount; p++) {
          const betInput = document.getElementById(`banker_bet_p${p}_h${h}`);
          const doubleBtn = document.getElementById(`banker_pdouble_p${p}_h${h}`);
          
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
      
      // Delay to ensure DOM is ready
      setTimeout(() => {
        state.holes.forEach((holeState, idx) => {
          const h = idx + 1;
          
          // Set banker selection
          const bankerSelect = document.getElementById(`banker_select_h${h}`);
          if (bankerSelect && holeState.banker !== undefined) {
            bankerSelect.value = String(holeState.banker);
            // Trigger change event to update bet inputs
            bankerSelect.dispatchEvent(new Event('change'));
          }
          
          // Set max bet
          const maxBetInput = document.getElementById(`banker_maxbet_h${h}`);
          if (maxBetInput && holeState.maxBet !== undefined) {
            maxBetInput.value = String(holeState.maxBet);
          }
          
          // Set banker double
      const bankerDoubleBtn = document.getElementById(`banker_double_h${h}`);
            bankerDoubleBtn.dataset.active = 'true';
            bankerDoubleBtn.style.background = 'var(--accent)';
            bankerDoubleBtn.style.color = 'var(--bg)';
            bankerDoubleBtn.style.borderColor = 'var(--accent)';
          } else if (bankerDoubleBtn) {
            bankerDoubleBtn.dataset.active = 'false';
            bankerDoubleBtn.style.background = 'var(--panel)';
            bankerDoubleBtn.style.color = 'var(--muted)';
            bankerDoubleBtn.style.borderColor = 'var(--line)';
          }
          
          // Set player bets
          if (holeState.bets && Array.isArray(holeState.bets)) {
            holeState.bets.forEach(bet => {
              const betInput = document.getElementById(`banker_bet_p${bet.player}_h${h}`);
              if (betInput) {
                betInput.value = String(bet.amount || 0);
              }
              
              const doubleBtn = document.getElementById(`banker_pdouble_p${bet.player}_h${h}`);
              if (doubleBtn) {
                if (bet.doubled) {
                  doubleBtn.dataset.active = 'true';
                  doubleBtn.style.background = 'var(--accent)';
                  doubleBtn.style.color = 'var(--bg)';
                  doubleBtn.style.borderColor = 'var(--accent)';
                } else {
                  doubleBtn.dataset.active = 'false';
                  doubleBtn.style.background = 'var(--panel)';
                  doubleBtn.style.color = 'var(--muted)';
                  doubleBtn.style.borderColor = 'var(--line)';
                }
              }
            });
          }
        });
        
        // Update calculations after state is restored
        this.update();
      }, 150);
    },
    
    /**
     * Clear all banker game data
     */
    clearAll() {
      if (!confirm('Clear all Banker game data? This cannot be undone.')) {
        return;
      }
      
      for (let h = 1; h <= 18; h++) {
        // Reset banker selection
        const bankerSelect = document.getElementById(`banker_h${h}`);
        if (bankerSelect) {
          bankerSelect.value = '-1';
          bankerSelect.dispatchEvent(new Event('change'));
        }
        
        // Reset max bet
        const maxBetInput = document.getElementById(`banker_maxbet_h${h}`);
        if (maxBetInput) {
          maxBetInput.value = '10';
        }
        
        // Reset banker double
const bankerDoubleBtn = document.getElementById(`banker_double_h${h}`);
        if (bankerDoubleBtn) {
          bankerDoubleBtn.dataset.active = 'false';
          bankerDoubleBtn.style.background = 'var(--panel)';
          bankerDoubleBtn.style.color = 'var(--muted)';
          bankerDoubleBtn.style.borderColor = 'var(--line)';
        }
        
        // Reset all player bets
        const playerCount = getPlayerCount();
        for (let p = 0; p < playerCount; p++) {
          const betInput = document.getElementById(`banker_bet_p${p}_h${h}`);
          if (betInput) {
            betInput.value = '0';
          }
          
          const doubleBtn = document.getElementById(`banker_pdouble_p${p}_h${h}`);
          if (doubleBtn) {
            doubleBtn.dataset.active = 'false';
            doubleBtn.style.background = 'var(--panel)';
            doubleBtn.style.color = 'var(--muted)';
            doubleBtn.style.borderColor = 'var(--line)';
          }
        }
      }
      
      this.update();
      
      if (typeof window.saveDebounced === 'function') {
        window.saveDebounced();
      }
      
      if (typeof window.announce === 'function') {
        window.announce('Banker game cleared.');
      }
    },
    
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
        
        // Get banker double/triple button
        const bankerDoubleBtn = document.getElementById(`banker_double_h${holeNum}`);
        const bankerDouble = bankerDoubleBtn?.dataset.active === 'true';
        
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
          
          const playerDoubleBtn = document.getElementById(`banker_pdouble_p${p}_h${holeNum}`);
          const playerDouble = playerDoubleBtn?.dataset.active === 'true';
          
          const playerNet = netScores[p];
          
          // Calculate payout - use 3× on par 3s, 2× otherwise
          const holePar = getPar(h);
          const isPar3 = holePar === 3;
          const baseMultiplier = isPar3 ? 3 : 2;
          
          let multiplier = 1;
          if (playerDouble) multiplier *= baseMultiplier;
          if (bankerDouble) multiplier *= baseMultiplier;
          
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
          resultCell.innerHTML = `<span style="color: var(--muted); font-size: 12px;">${hole.error}</span>`;
          return;
        }
        
        if (hole.bets.length === 0) {
          resultCell.innerHTML = '<span style="color: var(--muted); font-size: 12px;">No bets</span>';
          return;
        }
        
        // Show detailed results per bet
        const bankerName = names[hole.banker]?.substring(0, 8) || `P${hole.banker + 1}`;
        
        const results = hole.bets.map(bet => {
          const playerName = names[bet.player]?.substring(0, 8) || `P${bet.player + 1}`;
          
          const resultContainer = document.createElement('div');
          resultContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; margin-bottom: 2px; border-radius: 3px; font-size: 12px;';
          
          // Color code based on outcome
          if (bet.winner === bet.player) {
            // Player won
            resultContainer.style.background = 'rgba(104, 211, 145, 0.15)';
            resultContainer.style.borderLeft = '2px solid var(--accent)';
          } else if (bet.winner === hole.banker) {
            // Banker won
            resultContainer.style.background = 'rgba(255, 107, 107, 0.15)';
            resultContainer.style.borderLeft = '2px solid var(--danger)';
          } else {
            // Tie
            resultContainer.style.background = 'rgba(255, 180, 84, 0.1)';
            resultContainer.style.borderLeft = '2px solid var(--warn)';
          }
          
          const playerInfo = document.createElement('span');
          playerInfo.style.cssText = 'font-weight: 500; font-size: 14px;';
          playerInfo.textContent = playerName;
          
          const scoreInfo = document.createElement('span');
          scoreInfo.style.cssText = 'font-size: 11px; color: var(--muted);';
          scoreInfo.textContent = `${bet.playerNet} v ${bet.bankerNet}`;
          
          const payoutInfo = document.createElement('span');
          payoutInfo.style.cssText = 'font-weight: 600; font-size: 13px;';
          
          if (bet.payout > 0) {
            payoutInfo.style.color = 'var(--accent)';
            payoutInfo.textContent = `+$${bet.payout.toFixed(0)}`;
          } else if (bet.payout < 0) {
            payoutInfo.style.color = 'var(--danger)';
            payoutInfo.textContent = `-$${Math.abs(bet.payout).toFixed(0)}`;
          } else {
            payoutInfo.style.color = 'var(--warn)';
            payoutInfo.textContent = 'PUSH';
          }
          
          const multiplierInfo = document.createElement('span');
          multiplierInfo.style.cssText = 'font-size: 10px; color: var(--muted); margin-left: 2px;';
          if (bet.multiplier > 1) {
            multiplierInfo.textContent = `(${bet.multiplier}×)`;
          }
          
          resultContainer.appendChild(playerInfo);
          
          const rightSide = document.createElement('div');
          rightSide.style.cssText = 'display: flex; gap: 4px; align-items: center;';
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
        if (bankerTotal !== 0) {
          const bankerSummary = document.createElement('div');
          bankerSummary.style.cssText = 'margin-top: 3px; padding-top: 3px; border-top: 1px solid var(--line); font-size: 15px; font-weight: 600;';
          
          if (bankerTotal > 0) {
            bankerSummary.style.color = 'var(--accent)';
            bankerSummary.innerHTML = `${bankerName} wins: <span style="font-size: 13px;">+$${bankerTotal.toFixed(0)}</span>`;
          } else {
            bankerSummary.style.color = 'var(--danger)';
            bankerSummary.innerHTML = `${bankerName}: <span style="font-size: 13px;">-$${Math.abs(bankerTotal).toFixed(0)}</span>`;
          }
          
          resultCell.appendChild(bankerSummary);
        }
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
        
        // Create container with label like player bets
        const maxBetContainer = document.createElement('div');
    maxBetContainer.style.cssText = 'display: flex; gap: 4px; align-items: center; padding: 2px; background: rgba(255,255,255,0.03); border-radius: 4px;';
        const dollarSign = document.createElement('span');
        dollarSign.textContent = '$';
        dollarSign.style.cssText = 'font-size: 11px; color: var(--accent);';
        
        const maxBetInput = document.createElement('input');
        maxBetInput.id = `banker_maxbet_h${h}`;
        maxBetInput.type = 'number';
        maxBetInput.min = '0';
        maxBetInput.step = '1';
        maxBetInput.value = '10';
        maxBetInput.style.cssText = 'width: 55px; padding: 4px; background: var(--bg); color: var(--ink); border: 1px solid var(--accent); border-radius: 4px; text-align: center; font-size: 12px; font-weight: 600;';
        maxBetInput.addEventListener('input', () => {
          // Re-validate all player bets for this hole when max bet changes
          const maxBet = Number(maxBetInput.value) || 0;
          const betsTd = document.getElementById(`banker_bets_h${h}`);
          if (betsTd) {
            const betInputs = betsTd.querySelectorAll('input[type="number"]');
            betInputs.forEach(betInput => {
              const playerBet = Number(betInput.value) || 0;
              if (playerBet > maxBet && maxBet > 0) {
                betInput.style.borderColor = 'var(--danger)';
                betInput.style.borderWidth = '2px';
                betInput.title = `Bet exceeds max of $${maxBet}`;
              } else {
                betInput.style.borderColor = 'var(--accent)';
                betInput.style.borderWidth = '1px';
                betInput.title = '';
              }
            });
          }
          
          this.update();
          if (typeof window.saveDebounced === 'function') {
            window.saveDebounced();
          }
        });
        
        maxBetContainer.appendChild(dollarSign);
        maxBetContainer.appendChild(maxBetInput);
        maxBetTd.appendChild(maxBetContainer);
        tr.appendChild(maxBetTd);
        
        // Bets column (will be populated dynamically)
        const betsTd = document.createElement('td');
        betsTd.id = `banker_bets_h${h}`;
        betsTd.style.cssText = 'padding: 4px; font-size: 11px;';
        tr.appendChild(betsTd);
        
        // Banker Double/Triple button
        const bankerDoubleTd = document.createElement('td');
        const bankerDoubleBtn = document.createElement('button');
        bankerDoubleBtn.id = `banker_double_h${h}`;
        bankerDoubleBtn.type = 'button';
        bankerDoubleBtn.dataset.active = 'false';
        
        // Set text and title based on par
        const holePar = getPar(h - 1);
        const isPar3 = holePar === 3;
        const multiplierText = isPar3 ? '3×' : '2×';
        bankerDoubleBtn.textContent = multiplierText;
        bankerDoubleBtn.title = isPar3 ? 'Banker triples all bets (Par 3)' : 'Banker doubles all bets';
        bankerDoubleBtn.style.cssText = 'padding: 8px 12px; min-width: 44px; min-height: 44px; border: 2px solid var(--line); background: var(--panel); color: var(--muted); border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.2s;';
        
        bankerDoubleBtn.addEventListener('click', () => {
          const isActive = bankerDoubleBtn.dataset.active === 'true';
          bankerDoubleBtn.dataset.active = isActive ? 'false' : 'true';
          
          if (bankerDoubleBtn.dataset.active === 'true') {
            bankerDoubleBtn.style.background = 'var(--accent)';
            bankerDoubleBtn.style.color = 'var(--bg)';
            bankerDoubleBtn.style.borderColor = 'var(--accent)';
          } else {
            bankerDoubleBtn.style.background = 'var(--panel)';
            bankerDoubleBtn.style.color = 'var(--muted)';
            bankerDoubleBtn.style.borderColor = 'var(--line)';
          }
          
          this.update();
          if (typeof window.saveDebounced === 'function') {
            window.saveDebounced();
          }
        });
        bankerDoubleTd.appendChild(bankerDoubleBtn);
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
        
        // Check if this is a par 3 hole
        const holePar = getPar(h - 1);
        const isPar3 = holePar === 3;
        const multiplierText = isPar3 ? '3×' : '2×';
        const checkboxTitle = isPar3 ? 'Player triples their bet (Par 3)' : 'Player doubles their bet';
        
        for (let p = 0; p < playerCount; p++) {
          if (p === bankerIdx) continue;
          
          const playerName = (names[p] || `P${p + 1}`).substring(0, 8);
          
          const container = document.createElement('div');
      container.style.cssText = 'display: flex; gap: 4px; align-items: center; margin-bottom: 2px; padding: 2px; background: rgba(255,255,255,0.03); border-radius: 4px;';
          const label = document.createElement('span');
          label.textContent = `${playerName}:`;
          label.style.cssText = 'min-width: 55px; font-size: 14px; font-weight: 500;';
          
          const dollarSign = document.createElement('span');
          dollarSign.textContent = '$';
          dollarSign.style.cssText = 'font-size: 11px; color: var(--accent);';
          
          const betInput = document.createElement('input');
          betInput.id = `banker_bet_p${p}_h${h}`;
          betInput.type = 'number';
          betInput.min = '0';
          betInput.step = '1';
          betInput.value = '0';
          betInput.placeholder = '0';
          betInput.style.cssText = 'width: 55px; padding: 4px; background: var(--bg); color: var(--ink); border: 1px solid var(--accent); border-radius: 4px; text-align: center; font-size: 12px; font-weight: 600;';
          betInput.addEventListener('input', () => {
            // Validate bet against max bet
            const maxBetInput = document.getElementById(`banker_maxbet_h${h}`);
            const maxBet = maxBetInput ? Number(maxBetInput.value) : 0;
            const playerBet = Number(betInput.value) || 0;
            
            if (playerBet > maxBet && maxBet > 0) {
              betInput.style.borderColor = 'var(--danger)';
              betInput.style.borderWidth = '2px';
              betInput.title = `Bet exceeds max of $${maxBet}`;
            } else {
              betInput.style.borderColor = 'var(--accent)';
              betInput.style.borderWidth = '1px';
              betInput.title = '';
            }
            
            this.update();
            if (typeof window.saveDebounced === 'function') {
              window.saveDebounced();
            }
          });
          
          const doubleBtn = document.createElement('button');
          doubleBtn.id = `banker_pdouble_p${p}_h${h}`;
          doubleBtn.type = 'button';
          doubleBtn.textContent = multiplierText;
          doubleBtn.title = checkboxTitle;
          doubleBtn.dataset.active = 'false';
          doubleBtn.style.cssText = 'padding: 4px 8px; min-width: 40px; min-height: 44px; border: 2px solid var(--line); background: var(--panel); color: var(--muted); border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.2s;';
          
          doubleBtn.addEventListener('click', () => {
            const isActive = doubleBtn.dataset.active === 'true';
            doubleBtn.dataset.active = isActive ? 'false' : 'true';
            
            if (doubleBtn.dataset.active === 'true') {
              doubleBtn.style.background = 'var(--accent)';
              doubleBtn.style.color = 'var(--bg)';
              doubleBtn.style.borderColor = 'var(--accent)';
            } else {
              doubleBtn.style.background = 'var(--panel)';
              doubleBtn.style.color = 'var(--muted)';
              doubleBtn.style.borderColor = 'var(--line)';
            }
            
            this.update();
            if (typeof window.saveDebounced === 'function') {
              window.saveDebounced();
            }
          });
          
          container.appendChild(label);
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
      // Only do full init once
      if (!this._initialized) {
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
        
        this._initialized = true;
        
        // After initial build, restore saved state if available
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
        }, 200);
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
