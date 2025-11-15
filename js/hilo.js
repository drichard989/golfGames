/* ============================================================================
   HI-LO GAME MODULE
   ============================================================================
   
   Hi-Lo Game Rules:
   - Requires exactly 4 players
   - Teams: Lowest + Highest handicap vs. Middle two handicaps
   - Handicap adjustment: Difference in team strokes applied to worst player
   - 3 Games: Front 9 (1 unit), Back 9 (1 unit), All 18 (2 units) = 4 units total
   
   Scoring per hole:
   - Compare low scores between teams → 1 point to lower
   - Compare high scores between teams → 1 point to lower
   - Ties = no points
   - Win both points (2-0) → Press: new game starts on next hole
   
   ============================================================================
*/

(() => {
  'use strict';
  console.log('[HiLo] Module loaded');

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================

  function getPlayerCount() {
    return document.querySelectorAll('.player-row').length;
  }

  function getPlayerNames() {
    const names = [];
    const playerRows = document.querySelectorAll('.player-row');
    playerRows.forEach((row, idx) => {
      const nameInput = row.querySelector('.name-edit');
      const name = nameInput?.value?.trim() || `Player ${idx + 1}`;
      names.push(name);
    });
    return names;
  }

  function getHandicaps() {
    const handicaps = [];
    const playerRows = document.querySelectorAll('.player-row');
    playerRows.forEach(row => {
      const chInput = row.querySelector('.ch-input');
      const ch = Number(chInput?.value) || 0;
      handicaps.push(ch);
    });
    return handicaps;
  }

  function getGross(playerIdx, holeIdx) {
    const input = document.querySelector(
      `.score-input[data-player="${playerIdx}"][data-hole="${holeIdx + 1}"]`
    );
    return Number(input?.value) || 0;
  }

  function getPar(holeIdx) {
    const parRow = document.getElementById('parRow');
    if (!parRow) return 4;
    const inputs = parRow.querySelectorAll('input[type="number"]');
    return Number(inputs[holeIdx]?.value) || 4;
  }

  function getHCPIndex(holeIdx) {
    const HCPMEN = window.HCPMEN;
    if (!HCPMEN || !Array.isArray(HCPMEN)) {
      console.error('[HiLo] HCPMEN not loaded - course data missing!');
      return 1; // Fallback only if array completely missing
    }
    return HCPMEN[holeIdx] || 1;
  }

  // =============================================================================
  // TEAM FORMATION & HANDICAP CALCULATION
  // =============================================================================

  /**
   * Form teams based on handicaps
   * @returns {{teamA: number[], teamB: number[], teamAStrokes: number, teamBStrokes: number, strokePlayer: number, strokesGiven: number}}
   */
  function formTeams() {
    const handicaps = getHandicaps();
    
    // Sort players by handicap with their original indices
    const indexed = handicaps.map((ch, idx) => ({ ch, idx }));
    indexed.sort((a, b) => a.ch - b.ch);
    
    // Team A: lowest + highest handicap
    const teamA = [indexed[0].idx, indexed[3].idx];
    // Team B: middle two
    const teamB = [indexed[1].idx, indexed[2].idx];
    
    // Calculate team strokes (sum of handicaps)
    const teamAStrokes = handicaps[teamA[0]] + handicaps[teamA[1]];
    const teamBStrokes = handicaps[teamB[0]] + handicaps[teamB[1]];
    
    // Determine stroke allocation
    const diff = Math.abs(teamAStrokes - teamBStrokes);
    let strokePlayer = -1;
    let strokesGiven = diff;
    
    if (diff > 0) {
      // Find worst player on team with more strokes
      if (teamAStrokes > teamBStrokes) {
        strokePlayer = handicaps[teamA[0]] > handicaps[teamA[1]] ? teamA[0] : teamA[1];
      } else {
        strokePlayer = handicaps[teamB[0]] > handicaps[teamB[1]] ? teamB[0] : teamB[1];
      }
    }
    
    return { teamA, teamB, teamAStrokes, teamBStrokes, strokePlayer, strokesGiven };
  }

  /**
   * Calculate net score for a player on a hole
   */
  function getNetScore(playerIdx, holeIdx, strokePlayer, strokesGiven) {
    const gross = getGross(playerIdx, holeIdx);
    if (gross === 0) return 0;
    
    // Only apply strokes to the designated stroke player
    if (playerIdx !== strokePlayer) return gross;
    
    // Calculate strokes on this hole
    const holeHcp = getHCPIndex(holeIdx);
    const base = Math.floor(strokesGiven / 18);
    const rem = strokesGiven % 18;
    const strokes = base + (holeHcp <= rem ? 1 : 0);
    
    return gross - strokes;
  }

  // =============================================================================
  // SCORING LOGIC
  // =============================================================================

  /**
   * Compute Hi-Lo results
   * @returns {Object} Game results with points and presses
   */
  function compute() {
    const playerCount = getPlayerCount();
    
    if (playerCount !== 4) {
      return {
        error: 'Hi-Lo requires exactly 4 players',
        teamA: [],
        teamB: [],
        holeResults: [],
        front9: { teamA: 0, teamB: 0, presses: [] },
        back9: { teamA: 0, teamB: 0, presses: [] },
        full18: { teamA: 0, teamB: 0, presses: [] }
      };
    }
    
    const { teamA, teamB, strokePlayer, strokesGiven } = formTeams();
    
    // Track games
    const front9 = { teamA: 0, teamB: 0, presses: [{ start: 1, teamA: 0, teamB: 0 }] };
    const back9 = { teamA: 0, teamB: 0, presses: [{ start: 10, teamA: 0, teamB: 0 }] };
    const full18 = { teamA: 0, teamB: 0 };
    const holeResults = [];
    
    // Process each hole
    for (let h = 0; h < 18; h++) {
      const holeNum = h + 1;
      
      // Get net scores for all players
      const scores = [0, 1, 2, 3].map(p => getNetScore(p, h, strokePlayer, strokesGiven));
      
      // Skip if not all scores entered
      if (scores.some(s => s === 0)) {
        holeResults.push({
          hole: holeNum,
          teamALow: 0,
          teamAHigh: 0,
          teamBLow: 0,
          teamBHigh: 0,
          lowWinner: null,
          highWinner: null,
          teamAPoints: 0,
          teamBPoints: 0
        });
        continue;
      }
      
      // Get team scores
      const teamAScores = [scores[teamA[0]], scores[teamA[1]]].sort((a, b) => a - b);
      const teamBScores = [scores[teamB[0]], scores[teamB[1]]].sort((a, b) => a - b);
      
      let holePointsA = 0;
      let holePointsB = 0;
      let lowWinner = null;
      let highWinner = null;
      
      // Compare low scores
      if (teamAScores[0] < teamBScores[0]) {
        holePointsA++;
        lowWinner = 'A';
      } else if (teamBScores[0] < teamAScores[0]) {
        holePointsB++;
        lowWinner = 'B';
      } else {
        lowWinner = 'Tie';
      }
      
      // Compare high scores
      if (teamAScores[1] < teamBScores[1]) {
        holePointsA++;
        highWinner = 'A';
      } else if (teamBScores[1] < teamAScores[1]) {
        holePointsB++;
        highWinner = 'B';
      } else {
        highWinner = 'Tie';
      }
      
      holeResults.push({
        hole: holeNum,
        teamALow: teamAScores[0],
        teamAHigh: teamAScores[1],
        teamBLow: teamBScores[0],
        teamBHigh: teamBScores[1],
        lowWinner,
        highWinner,
        teamAPoints: holePointsA,
        teamBPoints: holePointsB
      });
      
      // Add to appropriate games
      if (holeNum <= 9) {
        // Front 9 - add to all active presses for front 9
        front9.presses.forEach(press => {
          press.teamA += holePointsA;
          press.teamB += holePointsB;
        });
        front9.teamA += holePointsA;
        front9.teamB += holePointsB;
        
        // Check for auto press (2-0 hole win) - press runs to hole 9
        if ((holePointsA === 2 || holePointsB === 2) && holeNum < 9) {
          front9.presses.push({ start: holeNum + 1, teamA: 0, teamB: 0 });
        }
      } else {
        // Back 9 - add to all active presses for back 9
        back9.presses.forEach(press => {
          press.teamA += holePointsA;
          press.teamB += holePointsB;
        });
        back9.teamA += holePointsA;
        back9.teamB += holePointsB;
        
        // Check for auto press (2-0 hole win) - press runs to hole 18
        if ((holePointsA === 2 || holePointsB === 2) && holeNum < 18) {
          back9.presses.push({ start: holeNum + 1, teamA: 0, teamB: 0 });
        }
      }
      
      // Full 18 (no presses, just cumulative)
      full18.teamA += holePointsA;
      full18.teamB += holePointsB;
    }
    
    return { teamA, teamB, strokePlayer, strokesGiven, holeResults, front9, back9, full18 };
  }

  // =============================================================================
  // RENDERING
  // =============================================================================

  function render(data) {
    const names = getPlayerNames();
    const { teamA, teamB, strokePlayer, strokesGiven, holeResults, front9, back9, full18, error } = data;
    
    // Update team display
    const teamAEl = document.getElementById('hiloTeamA');
    const teamBEl = document.getElementById('hiloTeamB');
    
    if (error) {
      if (teamAEl) teamAEl.textContent = error;
      if (teamBEl) teamBEl.textContent = '';
      document.getElementById('hiloResultsBody').innerHTML = '';
      return;
    }
    
    const strokeInfo = strokePlayer >= 0 ? ` (${names[strokePlayer]} gets ${strokesGiven} strokes)` : '';
    
    if (teamAEl) {
      teamAEl.textContent = `Team A: ${names[teamA[0]]} + ${names[teamA[1]]}`;
    }
    if (teamBEl) {
      teamBEl.textContent = `Team B: ${names[teamB[0]]} + ${names[teamB[1]]}${strokeInfo}`;
    }
    
    // Build table with all games and presses
    let tableHtml = '';
    let totalUnitsA = 0, totalUnitsB = 0;
    
    // Front 9 games (main + presses) - all presses go to hole 9
    front9.presses.forEach((press, idx) => {
      const isMain = idx === 0;
      
      let gameName = isMain 
        ? 'Front 9 (1 unit)' 
        : `Press ${idx} (Holes ${press.start}-9)`;
      
      let winner = '';
      
      if (press.teamA > press.teamB) {
        winner = 'Team A';
        totalUnitsA += 1;
      } else if (press.teamB > press.teamA) {
        winner = 'Team B';
        totalUnitsB += 1;
      } else {
        winner = press.teamA === 0 && press.teamB === 0 ? '—' : 'Push';
      }
      
      tableHtml += `
        <tr>
          <td>${gameName}</td>
          <td>${press.teamA}</td>
          <td>${press.teamB}</td>
          <td>${winner}</td>
        </tr>
      `;
    });
    
    // Back 9 games (main + presses) - all presses go to hole 18
    back9.presses.forEach((press, idx) => {
      const isMain = idx === 0;
      
      let gameName = isMain 
        ? 'Back 9 (1 unit)' 
        : `Press ${idx} (Holes ${press.start}-18)`;
      
      let winner = '';
      
      if (press.teamA > press.teamB) {
        winner = 'Team A';
        totalUnitsA += 1;
      } else if (press.teamB > press.teamA) {
        winner = 'Team B';
        totalUnitsB += 1;
      } else {
        winner = press.teamA === 0 && press.teamB === 0 ? '—' : 'Push';
      }
      
      tableHtml += `
        <tr>
          <td>${gameName}</td>
          <td>${press.teamA}</td>
          <td>${press.teamB}</td>
          <td>${winner}</td>
        </tr>
      `;
    });
    
    // Full 18 (no presses, just main game worth 2 units)
    let full18Winner = '';
    if (full18.teamA > full18.teamB) {
      full18Winner = 'Team A';
      totalUnitsA += 2;
    } else if (full18.teamB > full18.teamA) {
      full18Winner = 'Team B';
      totalUnitsB += 2;
    } else {
      full18Winner = full18.teamA === 0 ? '—' : 'Push';
    }
    
    tableHtml += `
      <tr>
        <td>Full 18 (2 units)</td>
        <td>${full18.teamA}</td>
        <td>${full18.teamB}</td>
        <td>${full18Winner}</td>
      </tr>
    `;
    
    // Add total row
    tableHtml += `
      <tr style="border-top: 2px solid var(--line); font-weight: bold;">
        <td>Total Units</td>
        <td>${totalUnitsA}</td>
        <td>${totalUnitsB}</td>
        <td>—</td>
      </tr>
    `;
    
    document.getElementById('hiloResultsBody').innerHTML = tableHtml;
    
    // Render hole-by-hole results
    const holeBody = document.getElementById('hiloHoleBody');
    if (holeBody && holeResults) {
      let holeHtml = '';
      holeResults.forEach(hole => {
        if (hole.teamALow === 0) return; // Skip holes with no scores
        
        const lowWinnerText = hole.lowWinner === 'A' ? 'Team A' : hole.lowWinner === 'B' ? 'Team B' : 'Tie';
        const highWinnerText = hole.highWinner === 'A' ? 'Team A' : hole.highWinner === 'B' ? 'Team B' : 'Tie';
        
        holeHtml += `
          <tr>
            <td>${hole.hole}</td>
            <td>${hole.teamALow} vs ${hole.teamBLow} → ${lowWinnerText}</td>
            <td>${hole.teamAHigh} vs ${hole.teamBHigh} → ${highWinnerText}</td>
            <td>A: ${hole.teamAPoints}, B: ${hole.teamBPoints}</td>
          </tr>
        `;
      });
      holeBody.innerHTML = holeHtml || '<tr><td colspan="4" style="text-align: center;">No scores entered yet</td></tr>';
    }
  }

  // =============================================================================
  // PUBLIC API
  // =============================================================================

  const HiLo = {
    init() {
      console.log('[HiLo] Initializing...');
      this.update();
    },
    
    update() {
      const data = compute();
      render(data);
    }
  };

  // Expose to global scope
  window.HiLo = HiLo;
  
  console.log('[HiLo] Module initialized');

})();
