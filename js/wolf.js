/* ============================================================================
   WOLF GAME MODULE
   ============================================================================
   
   A strategic golf game where one player (the Wolf) chooses partners or goes alone.
   
   GAME MECHANICS:
   • Rotating Wolf: Each player is Wolf for a set of holes (rotates in order)
   • After all tee shots, Wolf decides:
     - Pick a partner (2v2)
     - Go "Lone Wolf" (1v3)
   
   SCORING:
   • 2v2: Winners get points split between partners, losers get 0
   • Lone Wolf Win: Wolf gets 3× points, others get 0
   • Lone Wolf Loss: Wolf gets 0, others split points
   
   POINTS PER HOLE:
   • Low ball wins (gross or net based on settings)
   • Standard: 1 point per hole
   • Optional: Points can increase with birdies/eagles
   
   STRATEGY:
   • Wolf picks partner based on tee shots
   • Going Lone Wolf = high risk, high reward
   • Order rotates so everyone is Wolf equal times
   
   Exposed as: window.Wolf
   API: {init, compute, render, recalc, getOptions, setOptions}
   
   ============================================================================
*/

(() => {
  'use strict';

  // Helper functions to access scorecard data
  const getPlayers = () => {
    try {
      const nameInputs = Array.from(document.querySelectorAll('.name-edit'));
      const validPlayers = nameInputs.filter(input => {
        const val = input?.value?.trim();
        return val && val.length > 0;
      }).length;
      return validPlayers > 0 ? validPlayers : nameInputs.length;
    } catch (error) {
      console.error('[Wolf] Error getting player count:', error);
      return 0;
    }
  };
  
  const getPlayerName = (p) => {
    try {
      const fixedTable = document.getElementById('scorecardFixed');
      const rows = fixedTable?.querySelectorAll('.player-row');
      const nameInput = rows[p]?.querySelector('.name-edit');
      return nameInput?.value?.trim() || `Player ${p + 1}`;
    } catch (error) {
      return `Player ${p + 1}`;
    }
  };
  
  const getHoles = () => 18;
  
  const getPar = (h) => {
    try {
      const parRow = document.getElementById('parRow');
      const inputs = parRow.querySelectorAll('input[type="number"]');
      return Number(inputs[h]?.value) || 4;
    } catch (error) {
      return 4;
    }
  };
  
  const getGross = (p, h) => {
    try {
      const input = document.querySelector(`.score-input[data-player="${p}"][data-hole="${h + 1}"]`);
      const val = Number(input?.value);
      return (val && Number.isFinite(val)) ? val : null;
    } catch (error) {
      return null;
    }
  };
  
  const getNet = (p, h) => {
    try {
      const input = document.querySelector(`.score-input[data-player="${p}"][data-hole="${h + 1}"]`);
      const netAttr = input?.getAttribute('data-net-ndb');
      const val = Number(netAttr);
      return (val && Number.isFinite(val)) ? val : null;
    } catch (error) {
      return null;
    }
  };

  // Game state
  let options = {
    useNet: false,
    pointValue: 1,
    doubleBirdie: false
  };
  
  // Store Wolf selections per hole
  // wolfSelections[hole] = { wolf: playerIndex, partner: playerIndex or null (lone wolf) }
  let wolfSelections = {};

  const Wolf = {
    init() {
      console.log('[Wolf] Initialized');
      this.render();
    },

    compute() {
      const players = getPlayers();
      const holes = getHoles();
      
      if (players < 3) {
        return { error: 'Wolf requires at least 3 players' };
      }

      const scores = Array(players).fill(0);
      const holeResults = [];

      for (let h = 0; h < holes; h++) {
        const selection = wolfSelections[h];
        
        if (!selection) continue;
        
        const wolf = selection.wolf;
        const partner = selection.partner;
        const par = getPar(h);
        
        // Get scores for all players
        const playerScores = [];
        for (let p = 0; p < players; p++) {
          const gross = getGross(p, h);
          const net = getNet(p, h);
          const score = options.useNet ? net : gross;
          playerScores.push({ player: p, score, gross, net });
        }
        
        // Filter out players with no score
        const validScores = playerScores.filter(ps => ps.score !== null);
        
        if (validScores.length === 0) continue;
        
        // Find low score
        const sortedScores = [...validScores].sort((a, b) => a.score - b.score);
        const lowScore = sortedScores[0].score;
        const winners = sortedScores.filter(ps => ps.score === lowScore).map(ps => ps.player);
        
        let points = options.pointValue;
        
        // Apply birdie multiplier if enabled
        if (options.doubleBirdie && lowScore < par) {
          points *= 2;
        }
        
        // Determine points distribution
        if (partner === null) {
          // Lone Wolf
          if (winners.includes(wolf)) {
            // Wolf wins alone - gets 3x points
            scores[wolf] += points * 3;
            holeResults.push({ hole: h + 1, wolf, partner: null, winners: [wolf], points: points * 3 });
          } else {
            // Wolf loses - others split points
            const pointsEach = points / (players - 1);
            for (let p = 0; p < players; p++) {
              if (p !== wolf) {
                scores[p] += pointsEach;
              }
            }
            holeResults.push({ hole: h + 1, wolf, partner: null, winners, points: pointsEach });
          }
        } else {
          // Team play (Wolf + Partner vs Others)
          const wolfTeam = [wolf, partner];
          const wolfTeamWins = winners.some(w => wolfTeam.includes(w));
          
          if (wolfTeamWins) {
            // Wolf team wins - split points
            scores[wolf] += points / 2;
            scores[partner] += points / 2;
            holeResults.push({ hole: h + 1, wolf, partner, winners: wolfTeam, points: points / 2 });
          } else {
            // Others win - split points among non-wolf-team players
            const others = [];
            for (let p = 0; p < players; p++) {
              if (!wolfTeam.includes(p)) others.push(p);
            }
            const pointsEach = points / others.length;
            others.forEach(p => scores[p] += pointsEach);
            holeResults.push({ hole: h + 1, wolf, partner, winners: others, points: pointsEach });
          }
        }
      }

      return { scores, holeResults, players };
    },

    render() {
      const section = document.getElementById('wolfSection');
      if (!section) return;

      const result = this.compute();
      
      if (result.error) {
        section.innerHTML = `
          <div class="game-header">
            <h3>🐺 Wolf</h3>
          </div>
          <div class="game-content">
            <p style="color: var(--muted); text-align: center; padding: 24px;">
              ${result.error}
            </p>
          </div>
        `;
        return;
      }

      const players = result.players;
      const holes = getHoles();

      let html = `
        <div class="game-header">
          <h3>🐺 Wolf</h3>
        </div>
        <div class="game-content">
          <div class="game-options" style="margin-bottom: 16px;">
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="wolfUseNet" ${options.useNet ? 'checked' : ''}>
              <span>Use Net (NDB)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
              <span>Point Value:</span>
              <input type="number" id="wolfPointValue" value="${options.pointValue}" 
                     min="1" max="10" step="0.5" style="width: 70px;">
            </label>
            <label style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
              <input type="checkbox" id="wolfDoubleBirdie" ${options.doubleBirdie ? 'checked' : ''}>
              <span>Double Points on Birdie</span>
            </label>
          </div>
          
          <div style="margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0;">Wolf Selection by Hole</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
      `;

      // Create selection controls for each hole
      for (let h = 0; h < holes; h++) {
        const selection = wolfSelections[h] || { wolf: h % players, partner: 0 };
        
        html += `
          <div style="border: 1px solid var(--line); padding: 12px; border-radius: 8px;">
            <strong>Hole ${h + 1}</strong>
            <div style="margin-top: 8px;">
              <label style="font-size: 12px; color: var(--muted);">Wolf:</label>
              <select class="wolf-select" data-hole="${h}" style="width: 100%; margin-top: 4px;">
                ${Array.from({length: players}, (_, i) => 
                  `<option value="${i}" ${selection.wolf === i ? 'selected' : ''}>${getPlayerName(i)}</option>`
                ).join('')}
              </select>
            </div>
            <div style="margin-top: 8px;">
              <label style="font-size: 12px; color: var(--muted);">Partner:</label>
              <select class="partner-select" data-hole="${h}" style="width: 100%; margin-top: 4px;">
                <option value="">Lone Wolf</option>
                ${Array.from({length: players}, (_, i) => 
                  i !== selection.wolf ? `<option value="${i}" ${selection.partner === i ? 'selected' : ''}>${getPlayerName(i)}</option>` : ''
                ).join('')}
              </select>
            </div>
          </div>
        `;
      }

      html += `
            </div>
          </div>
          
          <h4 style="margin: 24px 0 12px 0;">Scores</h4>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 2px solid var(--line);">
                <th style="text-align: left; padding: 8px;">Player</th>
                <th style="text-align: right; padding: 8px;">Points</th>
              </tr>
            </thead>
            <tbody>
      `;

      result.scores.forEach((score, p) => {
        html += `
          <tr style="border-bottom: 1px solid var(--line);">
            <td style="padding: 8px;">${getPlayerName(p)}</td>
            <td style="text-align: right; padding: 8px; font-weight: bold;">
              ${score.toFixed(1)}
            </td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>
        </div>
      `;

      section.innerHTML = html;
      
      // Attach event listeners
      this.attachListeners();
    },

    attachListeners() {
      // Options listeners
      document.getElementById('wolfUseNet')?.addEventListener('change', (e) => {
        options.useNet = e.target.checked;
        this.recalc();
      });
      
      document.getElementById('wolfPointValue')?.addEventListener('input', (e) => {
        options.pointValue = Number(e.target.value) || 1;
        this.recalc();
      });
      
      document.getElementById('wolfDoubleBirdie')?.addEventListener('change', (e) => {
        options.doubleBirdie = e.target.checked;
        this.recalc();
      });

      // Wolf selection listeners
      document.querySelectorAll('.wolf-select').forEach(select => {
        select.addEventListener('change', (e) => {
          const hole = Number(e.target.dataset.hole);
          const wolf = Number(e.target.value);
          
          if (!wolfSelections[hole]) wolfSelections[hole] = {};
          wolfSelections[hole].wolf = wolf;
          
          // Reset partner if it's the same as wolf
          if (wolfSelections[hole].partner === wolf) {
            wolfSelections[hole].partner = null;
          }
          
          this.render();
        });
      });

      document.querySelectorAll('.partner-select').forEach(select => {
        select.addEventListener('change', (e) => {
          const hole = Number(e.target.dataset.hole);
          const partner = e.target.value === '' ? null : Number(e.target.value);
          
          if (!wolfSelections[hole]) wolfSelections[hole] = { wolf: hole % getPlayers() };
          wolfSelections[hole].partner = partner;
          
          this.recalc();
        });
      });
    },

    recalc() {
      this.render();
    },

    getOptions() {
      return { ...options, wolfSelections };
    },

    setOptions(opts) {
      if (opts.useNet !== undefined) options.useNet = opts.useNet;
      if (opts.pointValue !== undefined) options.pointValue = opts.pointValue;
      if (opts.doubleBirdie !== undefined) options.doubleBirdie = opts.doubleBirdie;
      if (opts.wolfSelections !== undefined) wolfSelections = opts.wolfSelections;
    }
  };

  // Expose to window
  window.Wolf = Wolf;

  console.log('[Wolf] Module loaded');
})();
