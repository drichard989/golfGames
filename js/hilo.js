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

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================

  function getPlayerCount() {
    try {
      return document.querySelectorAll('#scorecard .player-row').length;
    } catch (error) {
      console.error('[HiLo] Error getting player count:', error);
      return 0;
    }
  }

  function getPlayerNames() {
    try {
      const names = [];
      const playerRows = document.querySelectorAll('#scorecard .player-row');
      playerRows.forEach((row, idx) => {
        const nameInput = row.querySelector('.name-edit');
        const name = nameInput?.value?.trim() || `Player ${idx + 1}`;
        names.push(name);
      });
      return names;
    } catch (error) {
      console.error('[HiLo] Error getting player names:', error);
      return [];
    }
  }

  function getPlayerInitial(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '?';

    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';

    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase();
    }

    return parts
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('');
  }

  function formatTeamLabel(team, names) {
    const full = `${names[team[0]]} + ${names[team[1]]}`;
    const short = `${getPlayerInitial(names[team[0]])} + ${getPlayerInitial(names[team[1]])}`;
    return { full, short };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderResponsiveTeamLabel(label) {
    return `<span class="hilo-team-label-full">${escapeHtml(label.full)}</span><span class="hilo-team-label-short">${escapeHtml(label.short)}</span>`;
  }

  function getHandicaps() {
    try {
      const handicaps = [];
      const playerRows = document.querySelectorAll('#scorecard .player-row');
      playerRows.forEach(row => {
        const chInput = row.querySelector('.ch-input');
        const ch = (typeof window.getActualHandicapValue === 'function' ? window.getActualHandicapValue(chInput) : Number(chInput?.value)) || 0;
        handicaps.push(ch);
      });
      return handicaps;
    } catch (error) {
      console.error('[HiLo] Error getting handicaps:', error);
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
      console.error('[HiLo] Error getting gross score:', error);
      return 0;
    }
  }

  function getPar(holeIdx) {
    try {
      const parRow = document.getElementById('parRow');
      if (!parRow) {
        console.error('[HiLo] Par row not found - scorecard not initialized!');
        return 4; // Fallback only if DOM missing
      }
      const inputs = parRow.querySelectorAll('input[type="number"]');
      const value = Number(inputs[holeIdx]?.value);
      if (!value || !Number.isFinite(value)) {
        console.error(`[HiLo] Par value missing for hole ${holeIdx + 1}`);
        return 4; // Fallback only if value missing
      }
      return value;
    } catch (error) {
      console.error('[HiLo] Error getting par:', error);
      return 4;
    }
  }

  function getHCPIndex(holeIdx) {
    try {
      const HCPMEN = window.HCPMEN;
      if (!HCPMEN || !Array.isArray(HCPMEN)) {
        console.error('[HiLo] HCPMEN not loaded - course data missing!');
        return 1; // Fallback only if array completely missing
      }
      return HCPMEN[holeIdx] || 1;
    } catch (error) {
      console.error('[HiLo] Error getting HCP index:', error);
      return 1;
    }
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
    // Deterministic tie-breaker by original player index when handicaps match.
    indexed.sort((a, b) => (a.ch - b.ch) || (a.idx - b.idx));
    
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
      // Strokes go TO the team with LOWER combined handicap (applied to their worst player)
      if (teamAStrokes < teamBStrokes) {
        // Team A has lower total, so Team A's worst player gets strokes
        strokePlayer = handicaps[teamA[0]] > handicaps[teamA[1]] ? teamA[0] : teamA[1];
      } else {
        // Team B has lower total, so Team B's worst player gets strokes
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

  function renderHiloResultsCard(data, teamALabelResponsive, teamBLabelResponsive) {
    const card = document.getElementById('hiloResultsBottom');
    if (!card) return;

    if (!data || data.error) {
      const placeholder = '<table class="live-results-table hilo-results-table" aria-label="Hi-Lo results"><tbody><tr class="live-results-data-row"><td colspan="4" style="text-align:center;padding:10px;">Requires 4 players</td></tr></tbody></table>';
      if (card.dataset.renderCache !== placeholder) {
        card.innerHTML = placeholder;
        card.dataset.renderCache = placeholder;
      }
      return;
    }

    const { front9, back9, full18 } = data;
    let rowsHtml = '';
    let totalUnitsA = 0, totalUnitsB = 0;

    front9.presses.forEach((press, idx) => {
      const gameName = idx === 0 ? 'Front 9 (1 unit)' : `Press ${idx} (Holes ${press.start}-9)`;
      let winner = '', tone = '';
      if (press.teamA > press.teamB) { winner = teamALabelResponsive; totalUnitsA += 1; tone = 'banker-total-positive'; }
      else if (press.teamB > press.teamA) { winner = teamBLabelResponsive; totalUnitsB += 1; tone = 'banker-total-negative'; }
      else { winner = press.teamA === 0 && press.teamB === 0 ? '—' : 'Push'; }
      rowsHtml += `<tr class="live-results-data-row"><td class="live-results-label">${gameName}</td><td>${press.teamA}</td><td>${press.teamB}</td><td class="${tone}">${winner}</td></tr>`;
    });

    back9.presses.forEach((press, idx) => {
      const gameName = idx === 0 ? 'Back 9 (1 unit)' : `Press ${idx} (Holes ${press.start}-18)`;
      let winner = '', tone = '';
      if (press.teamA > press.teamB) { winner = teamALabelResponsive; totalUnitsA += 1; tone = 'banker-total-positive'; }
      else if (press.teamB > press.teamA) { winner = teamBLabelResponsive; totalUnitsB += 1; tone = 'banker-total-negative'; }
      else { winner = press.teamA === 0 && press.teamB === 0 ? '—' : 'Push'; }
      rowsHtml += `<tr class="live-results-data-row"><td class="live-results-label">${gameName}</td><td>${press.teamA}</td><td>${press.teamB}</td><td class="${tone}">${winner}</td></tr>`;
    });

    let full18Winner = '', full18Tone = '';
    if (full18.teamA > full18.teamB) { full18Winner = teamALabelResponsive; totalUnitsA += 2; full18Tone = 'banker-total-positive'; }
    else if (full18.teamB > full18.teamA) { full18Winner = teamBLabelResponsive; totalUnitsB += 2; full18Tone = 'banker-total-negative'; }
    else { full18Winner = full18.teamA === 0 ? '—' : 'Push'; }
    rowsHtml += `<tr class="live-results-data-row"><td class="live-results-label">Full 18 (2 units)</td><td>${full18.teamA}</td><td>${full18.teamB}</td><td class="${full18Tone}">${full18Winner}</td></tr>`;

    const netTone = totalUnitsA > totalUnitsB ? 'banker-total-positive' : totalUnitsB > totalUnitsA ? 'banker-total-negative' : '';
    rowsHtml += `<tr class="live-results-data-row" style="font-weight:bold;"><td class="live-results-label">Net</td><td class="${netTone}">${totalUnitsA}</td><td class="${netTone === 'banker-total-positive' ? 'banker-total-negative' : netTone === 'banker-total-negative' ? 'banker-total-positive' : ''}">${totalUnitsB}</td><td>—</td></tr>`;

    const html = `<table class="live-results-table hilo-results-table" aria-label="Hi-Lo results">
      <colgroup><col class="lr-col-label"><col><col><col></colgroup>
      <thead><tr class="live-results-title-row"><th colspan="4">Hi-Lo Results</th></tr>
      <tr class="live-results-data-row"><th class="live-results-label">Game</th><th id="hiloColA">Team A</th><th id="hiloColB">Team B</th><th>Winner</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

    if (card.dataset.renderCache !== html) {
      card.innerHTML = html;
      card.dataset.renderCache = html;
    }
  }

  function render(data) {
    const names = getPlayerNames();
    const { teamA, teamB, strokePlayer, strokesGiven, holeResults, front9, back9, full18, error } = data;
    
    // Update team display
    const teamAEl = document.getElementById('hiloTeamA');
    const teamBEl = document.getElementById('hiloTeamB');
    
    if (error) {
      if (teamAEl) teamAEl.textContent = error;
      if (teamBEl) teamBEl.textContent = '';
      renderHiloResultsCard(data, 'Team A', 'Team B');
      return;
    }
    
    const teamALabelObj = formatTeamLabel(teamA, names);
    const teamBLabelObj = formatTeamLabel(teamB, names);
    const teamALabel = teamALabelObj.full;
    const teamBLabel = teamBLabelObj.full;
    const teamALabelResponsive = renderResponsiveTeamLabel(teamALabelObj);
    const teamBLabelResponsive = renderResponsiveTeamLabel(teamBLabelObj);
    const strokeInfo = strokePlayer >= 0 ? ` (${names[strokePlayer]} gets ${strokesGiven} strokes)` : '';
    
    if (teamAEl) {
      teamAEl.textContent = `Team A: ${teamALabel}`;
    }
    if (teamBEl) {
      teamBEl.textContent = `Team B: ${teamBLabel}${strokeInfo}`;
    }

    renderHiloResultsCard(data, teamALabelResponsive, teamBLabelResponsive);

    // Update column headers in the card after it rendered
    const colAEl = document.getElementById('hiloColA');
    const colBEl = document.getElementById('hiloColB');
    if (colAEl) colAEl.innerHTML = teamALabelResponsive;
    if (colBEl) colBEl.innerHTML = teamBLabelResponsive;
    
    // Render hole-by-hole results
    const holeBody = document.getElementById('hiloHoleBody');
    if (holeBody && holeResults) {
      let holeHtml = '';
      holeResults.forEach(hole => {
        if (hole.teamALow === 0) return; // Skip holes with no scores
        
        const lowWinnerText = hole.lowWinner === 'A' ? teamALabelResponsive : hole.lowWinner === 'B' ? teamBLabelResponsive : 'Tie';
        const highWinnerText = hole.highWinner === 'A' ? teamALabelResponsive : hole.highWinner === 'B' ? teamBLabelResponsive : 'Tie';
        
        holeHtml += `
          <tr>
            <td>${hole.hole}</td>
            <td>${hole.teamALow} vs ${hole.teamBLow} → ${lowWinnerText}</td>
            <td>${hole.teamAHigh} vs ${hole.teamBHigh} → ${highWinnerText}</td>
            <td>${teamALabelResponsive}: ${hole.teamAPoints}, ${teamBLabelResponsive}: ${hole.teamBPoints}</td>
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
      this.update();
    },
    
    update() {
      const data = compute();
      render(data);
    }
  };

  // Expose to global scope
  window.HiLo = HiLo;

})();
