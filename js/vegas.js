/* ============================================================================
   VEGAS GAME MODULE
   ============================================================================
   
   Team-based golf game where pairs compete by combining scores into 2-digit numbers.
   
   GAME MECHANICS:
   • Standard Mode (4 players): 2v2 teams, fixed partnerships
   • Rotation Mode (3 players): Each player partners with "ghost" (par) for 6 holes
   • Ghost Mode (2 players): Each player partners with ghost on all holes
   
   SCORING:
   • Scores combined lowest-to-highest (e.g., 4+5 = "45", not "54")
   • Lower combined number wins the hole
   • Points = (higher - lower) × multiplier
   • Winner gets the points (loser gets negative)
   
   MULTIPLIERS:
   • Default: 1×
   • Birdie by winner: 2× (if "Double on Birdie" enabled)
   • Eagle by winner: 3× (if "Triple on Eagle" enabled)
   • Digit flip: If opponent makes birdie+, winning team's digits reverse
     Example: Team A has 45, Team B has 67 and makes birdie → 45 becomes 54
   
   NET SCORING:
   • Uses Net Double Bogey (NDB) cap from main scorecard
   • Strokes allocated via "play off low" system
   • Each player's net score used if "Use Net (NDB)" enabled
   
   DOLLAR CALCULATION:
   • Points × $/point = total won/lost
   • Displayed per team with proper +/- formatting
   
   Exposed as: window.Vegas
   API: {compute, render, renderTeamControls, recalc, renderTable,
         getTeamAssignments, setTeamAssignments, getOptions, setOptions}
   
   ============================================================================
*/

(() => {
  'use strict';

  const SHARED_TIMING = window.GolfApp?.constants?.TIMING;
  const VEGAS_CONTROL_RECALC_MS = SHARED_TIMING?.NAME_INPUT_SYNC_MS || 120;

  const getFixedPlayerRows = () => {
    const rows = window.GolfApp?.utils?.getFixedPlayerRowsCached?.();
    return Array.isArray(rows) ? rows : Array.from(document.querySelectorAll('#scorecardFixed .player-row'));
  };

  // Access game constants with fallbacks
  const getMultipliers = () => window.GAME_CONSTANTS?.VEGAS?.MULTIPLIERS || { DEFAULT: 1, BIRDIE: 2, EAGLE: 3 };

  // Helper functions to access globals with error handling
  const getPlayers = () => {
    try {
      // Player count should follow scorecard rows, not whether names are filled.
      const rows = getFixedPlayerRows();
      return rows.length;
    } catch (error) {
      console.error('[Vegas] Error getting player count:', error);
      return 0;
    }
  };

  const getVegasPlayerNames = () => {
    try {
      return getFixedPlayerRows().map((row, i) => {
        const input = row.querySelector('.name-edit');
        const v = input?.value?.trim() || input?.placeholder?.trim();
        return v || `Player ${i + 1}`;
      });
    } catch (error) {
      console.error('[Vegas] Error getting player names:', error);
      const players = getPlayers();
      return Array.from({ length: players }, (_, i) => `Player ${i + 1}`);
    }
  };
  
  const getHoles = () => 18;
  
  const getPar = (h) => {
    try {
      const parRow = document.getElementById('parRow');
      if (!parRow) {
        console.error('[Vegas] Par row not found - scorecard not initialized!');
        return 4; // Fallback only if DOM missing
      }
      const inputs = parRow.querySelectorAll('input[type="number"]');
      const value = Number(inputs[h]?.value);
      if (!value || !Number.isFinite(value)) {
        console.error(`[Vegas] Par value missing for hole ${h + 1}`);
        return 4; // Fallback only if value missing
      }
      return value;
    } catch (error) {
      console.error('[Vegas] Error getting par:', error);
      return 4;
    }
  };
  
  const getPars = () => {
    const pars = [];
    for (let i = 0; i < 18; i++) {
      pars.push(getPar(i));
    }
    return pars;
  };

  const getGross = (p, h, computeCtx = null) => {
    if (computeCtx?.grossByPlayer?.[p]) {
      return Number(computeCtx.grossByPlayer[p][h]) || 0;
    }
    try {
      const input = document.querySelector(`.score-input[data-player="${p}"][data-hole="${h + 1}"]`);
      return Number(input?.value) || 0;
    } catch (error) {
      console.error('[Vegas] Error getting gross score:', error);
      return 0;
    }
  };

  const getActualHandicaps = () => {
    return getFixedPlayerRows().map((row) => {
      const chInput = row.querySelector('.ch-input');
      const val = chInput?.value || '';
      return val === ''
        ? null
        : (typeof window.getActualHandicapValue === 'function'
            ? window.getActualHandicapValue(chInput)
            : parseFloat(val));
    });
  };

  const getAdjustedCHs = (netHcpMode = 'playOffLow', computeCtx = null) => {
    if (computeCtx?.adjustedByMode?.[netHcpMode]) {
      return computeCtx.adjustedByMode[netHcpMode];
    }

    const chs = getActualHandicaps();
    const validCHs = chs.filter((ch) => ch !== null && Number.isFinite(ch));
    if (validCHs.length === 0) return chs.map(() => 0);

    if (netHcpMode === 'rawHandicap') {
      return chs.map((ch) => (ch !== null && Number.isFinite(ch) ? ch : 0));
    }

    const minCH = Math.min(...validCHs);
    return chs.map((ch) => (ch !== null && Number.isFinite(ch) ? ch - minCH : 0));
  };

  const getNetNDB = (p, h, netHcpMode = 'playOffLow', computeCtx = null) => {
    const adjustedCHs = getAdjustedCHs(netHcpMode, computeCtx);
    
    const gross = getGross(p, h, computeCtx);
    if (!gross) return 0;
    
    const adj = adjustedCHs[p];
    // Use global HCPMEN (updated when course changes)
    const HCPMEN = window.HCPMEN;
    if (!HCPMEN || !Array.isArray(HCPMEN)) {
      console.error('[Vegas] HCPMEN not loaded - course data missing!');
      return gross; // Fallback to gross if no handicap data
    }
    
    const holeHcp = HCPMEN[h];
    const base = Math.floor(adj / 18);
    const rem = adj % 18;
    const sr = base + (holeHcp <= rem ? 1 : 0);
    const NDB_BUFFER = 2;
    const par = computeCtx?.pars?.[h] || getPar(h);
    const ndb = par + NDB_BUFFER + sr;
    const adjGross = Math.min(gross, ndb);
    return adjGross - sr;
  };

  function createVegasComputeContext(opts) {
    const players = getPlayers();
    const holes = getHoles();
    const grossByPlayer = Array.from({ length: players }, () => Array(holes).fill(0));

    for (let p = 0; p < players; p++) {
      for (let h = 0; h < holes; h++) {
        grossByPlayer[p][h] = getGross(p, h);
      }
    }

    const pars = getPars();
    const adjustedByMode = {
      playOffLow: getAdjustedCHs('playOffLow'),
      rawHandicap: getAdjustedCHs('rawHandicap')
    };

    return {
      opts,
      players,
      holes,
      grossByPlayer,
      pars,
      adjustedByMode
    };
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Get IDs
  const ids = {
    vegasTeams: '#vegasTeams',
    vegasTeamWarning: '#vegasTeamWarning',
    vegasColA: '#vegasColA',
    vegasColB: '#vegasColB',
    vegasTotalA: '#vegasTotalA',
    vegasTotalB: '#vegasTotalB',
    vegasPtsA: '#vegasPtsA',
    vegasPtsB: '#vegasPtsB',
    vegasDollarA: '#vegasDollarA',
    vegasDollarB: '#vegasDollarB',
    optUseNet: '#optUseNet',
    vegasNetHcpMode: '#vegasHcpModeGroup',
    optDoubleBirdie: '#optDoubleBirdie',
    optTripleEagle: '#optTripleEagle',
    vegasPointValue: '#vegasPointValue'
  };

  function applyVegasTone(el, value) {
    if (!el) return;
    el.classList.remove('vegas-tone-positive', 'vegas-tone-negative', 'vegas-tone-neutral');
    if (!Number.isFinite(value)) return;
    if (value > 0) el.classList.add('vegas-tone-positive');
    else if (value < 0) el.classList.add('vegas-tone-negative');
    else el.classList.add('vegas-tone-neutral');
  }

  const isVegasCompactWidth = () => {
    try {
      return window.matchMedia('(max-width: 900px)').matches;
    } catch (_) {
      return false;
    }
  };

  const formatVegasTeamLabel = (team, names, compact) => {
    const initialOf = (idx) => {
      const nm = (names[idx] || '').trim();
      if (nm) return nm.charAt(0).toUpperCase();
      return `${idx + 1}`;
    };

    if (compact) {
      return `${initialOf(team[0])}${initialOf(team[1])}`;
    }

    return `${names[team[0]] || `P${team[0] + 1}`} + ${names[team[1]] || `P${team[1] + 1}`}`;
  };

  function renderTeamColumnLabels(data) {
    const colA = $(ids.vegasColA);
    const colB = $(ids.vegasColB);
    const ptsColA = document.getElementById('vegasPtsColA');
    const ptsColB = document.getElementById('vegasPtsColB');
    if (!colA || !colB) return;

    const setLabels = (a, b) => {
      colA.textContent = a;
      colB.textContent = b;
      if (ptsColA) ptsColA.textContent = `Pts (${a.replace(/^Team\s+/, '')})`;
      if (ptsColB) ptsColB.textContent = `Pts (${b.replace(/^Team\s+/, '')})`;
    };

    // Only swap labels to names in standard 4-player mode
    if (data?.rotation || getPlayers() !== 4) {
      setLabels('Team A', 'Team B');
      return;
    }

    const names = getVegasPlayerNames();
    const teams = vegas_getTeamAssignments();
    const compact = isVegasCompactWidth();
    if (!teams || teams.A.length !== 2 || teams.B.length !== 2) {
      const fallbackA = formatVegasTeamLabel([0, 1], names, compact);
      const fallbackB = formatVegasTeamLabel([2, 3], names, compact);
      setLabels(fallbackA, fallbackB);
      return;
    }

    setLabels(
      formatVegasTeamLabel(teams.A, names, compact),
      formatVegasTeamLabel(teams.B, names, compact)
    );
  }

  function renderVegasLiveResults(data) {
    const containers = [
      document.getElementById('vegasLiveResults'),
      document.getElementById('vegasResultsBottom')
    ].filter(Boolean);
    if (!containers.length) return;

    let teamAName = document.getElementById('vegasColA')?.textContent?.trim() || 'Team A';
    let teamBName = document.getElementById('vegasColB')?.textContent?.trim() || 'Team B';

    // In the results cards, prefer full player names when standard 4-player
    // teams are in use, even if table headers are compact initials.
    if (!data?.rotation && getPlayers() === 4) {
      const names = getVegasPlayerNames();
      const teams = vegas_getTeamAssignments();
      const teamA = teams?.A?.length === 2 ? teams.A : [0, 1];
      const teamB = teams?.B?.length === 2 ? teams.B : [2, 3];
      teamAName = formatVegasTeamLabel(teamA, names, false);
      teamBName = formatVegasTeamLabel(teamB, names, false);
    }
    const fmtMoney = (v) => {
      const n = Number(v) || 0;
      const abs = Math.abs(n).toFixed(2);
      if (n > 0) return `+$${abs}`;
      if (n < 0) return `-$${abs}`;
      return '$0.00';
    };
    const fmtPts = (v) => {
      const n = Number(v) || 0;
      if (n > 0) return `+${n}`;
      if (n < 0) return `${n}`;
      return '0';
    };

    if (!data?.valid) {
      containers.forEach(c => {
        if (!c.innerHTML) return;
        c.innerHTML = '';
      });
      return;
    }

    const html = `
      <table class="live-results-table vegas-results-table" aria-label="Live Vegas results">
        <tbody>
          <tr class="live-results-title-row"><th colspan="3">Totals</th></tr>
          <tr class="live-results-data-row"><td class="live-results-label">Team</td><td>${teamAName}</td><td>${teamBName}</td></tr>
          <tr class="live-results-data-row"><td class="live-results-label">Score</td><td>${data.totalA ?? '—'}</td><td>${data.totalB ?? '—'}</td></tr>
          <tr class="live-results-data-row"><td class="live-results-label">Points</td><td class="${(Number(data.ptsA) || 0) > 0 ? 'banker-total-positive' : (Number(data.ptsA) || 0) < 0 ? 'banker-total-negative' : ''}">${fmtPts(data.ptsA)}</td><td class="${(Number(data.ptsB) || 0) > 0 ? 'banker-total-positive' : (Number(data.ptsB) || 0) < 0 ? 'banker-total-negative' : ''}">${fmtPts(data.ptsB)}</td></tr>
          <tr class="live-results-data-row"><td class="live-results-label">Dollars</td><td class="${(Number(data.dollarsA) || 0) > 0 ? 'banker-total-positive' : (Number(data.dollarsA) || 0) < 0 ? 'banker-total-negative' : ''}">${fmtMoney(data.dollarsA)}</td><td class="${(Number(data.dollarsB) || 0) > 0 ? 'banker-total-positive' : (Number(data.dollarsB) || 0) < 0 ? 'banker-total-negative' : ''}">${fmtMoney(data.dollarsB)}</td></tr>
        </tbody>
      </table>
    `;
    containers.forEach(c => {
      if (c.dataset.renderCache === html) return;
      c.innerHTML = html;
      c.dataset.renderCache = html;
    });
  }

  // =============================================================================
  // VEGAS GAME LOGIC
  // =============================================================================

const Vegas = {
  /**
   * Compute per-hole and total Vegas results.
   * @param {{A:number[], B:number[]}} teams
   * @param {{useNet:boolean, doubleBirdie:boolean, tripleEagle:boolean, pointValue:number}} opts
   * @returns {{perHole:object[], ptsA:number, ptsB:number, totalA:number, totalB:number, dollarsA:number, dollarsB:number, valid:boolean, rotation:boolean}}
   */
  compute(teams, opts, computeCtx = null){
    // Check if we're in rotation mode (3 players with ghost)
    const realPlayers = getPlayers();
    const useRotation = realPlayers === 3;
    
    if(useRotation){
      // Rotation mode: each player rotates playing with ghost (position 3)
      const perHole=[];
      let ptsA=0;
      const ghostPos = 3;
      
      for(let h=0;h<getHoles();h++){
        // Rotate every 6 holes: Player 0 (holes 0-5), Player 1 (holes 6-11), Player 2 (holes 12-17)
        const playerWithGhost = Math.floor(h / 6) % 3;
        const otherPlayers = [0,1,2].filter(p => p !== playerWithGhost);
        
        const teamsThisHole = {
          A: [playerWithGhost, ghostPos],
          B: otherPlayers
        };
        
        const pairA = this._teamPair(teamsThisHole.A,h,opts.useNet,opts.netHcpMode, computeCtx);
        const pairB = this._teamPair(teamsThisHole.B,h,opts.useNet,opts.netHcpMode, computeCtx);
        if(!pairA || !pairB){
          perHole.push({vaStr:'—', vbStr:'—', mult:'—', holePtsA:0, ghostPartner: playerWithGhost});
          continue;
        }

        const aBE = this._teamHasBirdieOrEagle(teamsThisHole.A,h,opts.useNet,opts.netHcpMode, computeCtx);
        const bBE = this._teamHasBirdieOrEagle(teamsThisHole.B,h,opts.useNet,opts.netHcpMode, computeCtx);

        const effA = (bBE.birdie || bBE.eagle) ? [pairA[1],pairA[0]] : pairA;
        const effB = (aBE.birdie || aBE.eagle) ? [pairB[1],pairB[0]] : pairB;

        const vaStr=this._pairToString(effA), vbStr=this._pairToString(effB);
        const va=Number(vaStr), vb=Number(vbStr);

        let winner='A', diff=vb-va;
        if(diff<0){ winner='B'; diff=-diff; }
        const mult=this._multiplierForWinner(teamsThisHole[winner],h,opts.useNet,opts, computeCtx);
        const holePtsA = winner==='A' ? diff*mult : -diff*mult;

        perHole.push({vaStr, vbStr, mult, holePtsA, ghostPartner: playerWithGhost});
        ptsA += holePtsA;
      }
      
      // Calculate individual player points in rotation and game breakdowns
      const playerPoints = [0, 0, 0];
      const gameResults = [
        {player: 0, holes: '1-6', points: 0},
        {player: 1, holes: '7-12', points: 0},
        {player: 2, holes: '13-18', points: 0}
      ];
      
      perHole.forEach((hole, h) => {
        if(hole.ghostPartner !== undefined){
          playerPoints[hole.ghostPartner] += hole.holePtsA;
          // Calculate which game this belongs to (0-5: game 0, 6-11: game 1, 12-17: game 2)
          const gameIdx = Math.floor(h / 6);
          gameResults[gameIdx].points += hole.holePtsA;
        }
      });
      
      const teamSum = () => { 
        let s=0; 
        for(let h=0;h<getHoles();h++){ 
          for(let p=0; p<realPlayers; p++){
            s+=getGross(p,h, computeCtx)||0; 
          }
        } 
        return s; 
      };
      const totalA=teamSum();

      const per = Math.max(0, opts.pointValue || 0);
      const dollarsA = ptsA * per;
      const dollarsB = -dollarsA;
      const ptsB = -ptsA;

      return {perHole, ptsA, ptsB, totalA, totalB:0, dollarsA, dollarsB, valid:true, rotation:true, playerPoints, gameResults};
    }
    
    // Standard mode: fixed teams
    // Each team needs exactly 2 positions (players or ghosts)
    if(!(teams.A.length===2 && teams.B.length===2)){
      return {perHole:[], ptsA:0, ptsB:0, totalA:0, totalB:0, dollarsA:0, dollarsB:0, valid:false, rotation:false};
    }

    const perHole=[];
    let ptsA=0;

    for(let h=0;h<getHoles();h++){
      const pairA = this._teamPair(teams.A,h,opts.useNet,opts.netHcpMode, computeCtx);
      const pairB = this._teamPair(teams.B,h,opts.useNet,opts.netHcpMode, computeCtx);
      if(!pairA || !pairB){
        perHole.push({vaStr:'—', vbStr:'—', mult:'—', holePtsA:0});
        continue;
      }

      // Convert pairs to numbers (initially sorted low-high)
      let va = Number(this._pairToString(pairA));
      let vb = Number(this._pairToString(pairB));

      // Determine initial winner
      let winner = va < vb ? 'A' : 'B';
      let loser = winner === 'A' ? 'B' : 'A';

      // Check if LOSER made birdie/eagle
      const loserTeam = teams[loser];
      const loserBE = this._teamHasBirdieOrEagle(loserTeam, h, opts.useNet, opts.netHcpMode, computeCtx);

      // If loser made birdie+, flip WINNER's digits
      if(loserBE.birdie || loserBE.eagle) {
        if(winner === 'A') {
          va = Number(`${pairA[1]}${pairA[0]}`);
        } else {
          vb = Number(`${pairB[1]}${pairB[0]}`);
        }
        // Re-determine winner after flip
        winner = va < vb ? 'A' : 'B';
      }

      // Calculate points with correct winner
      const diff = Math.abs(va - vb);
      const mult = this._multiplierForWinner(teams[winner], h, opts.useNet, opts, computeCtx);
      const holePtsA = winner==='A' ? diff*mult : -diff*mult;

      // Store display strings
      const vaStr = String(va);
      const vbStr = String(vb);

      perHole.push({vaStr, vbStr, mult, holePtsA});
      ptsA += holePtsA;
    }

    const teamSum = team => { 
      let s=0; 
      for(let h=0;h<getHoles();h++){ 
        team.forEach(p=>{ 
          // Only count real players, not ghosts
          if(p < getPlayers()) {
            s+=getGross(p,h, computeCtx)||0; 
          }
        }); 
      } 
      return s; 
    };
    const totalA=teamSum(teams.A), totalB=teamSum(teams.B);

    const per = Math.max(0, opts.pointValue || 0);
    const dollarsA = ptsA * per;
    const dollarsB = -dollarsA;
    const ptsB = -ptsA;

    return {perHole, ptsA, ptsB, totalA, totalB, dollarsA, dollarsB, valid:true, rotation:false};
  },
  /**
   * Render Vegas results into the DOM.
   */
  render(data){
    const warn=$(ids.vegasTeamWarning);
    renderTeamColumnLabels(data);
    
    if(!data.valid){
      if(warn) warn.hidden=false;
      for(let h=0;h<getHoles();h++){
        const a = $(`[data-vegas-a="${h}"]`);
        const b = $(`[data-vegas-b="${h}"]`);
        const m = $(`[data-vegas-m="${h}"]`);
        const p = $(`[data-vegas-p="${h}"]`);
        const pb = $(`[data-vegas-pb="${h}"]`);
        if(a) a.textContent="—";
        if(b) b.textContent="—";
        if(m) m.textContent="—";
        if(p) p.textContent="—";
        if(pb) pb.textContent="—";
      }
      const ta = $(ids.vegasTotalA);
      const tb = $(ids.vegasTotalB);
      const pa = $(ids.vegasPtsA);
      const pb = $(ids.vegasPtsB);
      if(ta) ta.textContent="—";
      if(tb) tb.textContent="—";
      if(pa) pa.textContent="—";
      if(pb) pb.textContent="—";
      applyVegasTone(pa, NaN);
      applyVegasTone(pb, NaN);
      const da = $(ids.vegasDollarA);
      const db = $(ids.vegasDollarB);
      if(da) da.textContent = '—';
      if(db) db.textContent = '—';
      applyVegasTone(da, NaN);
      applyVegasTone(db, NaN);
      renderVegasLiveResults({ valid: false });
      return;
    }
    if(warn) warn.hidden=true;

    // Get player names from scorecard - get all name inputs like Junk/Skins do
    const names = getVegasPlayerNames();
    
    data.perHole.forEach((hole,h)=>{
      // In rotation mode, show which player is with ghost
      let vaStr = hole.vaStr;
      if(data.rotation && hole.ghostPartner !== undefined){
        const partnerName = names[hole.ghostPartner] || `P${hole.ghostPartner+1}`;
        vaStr = `${hole.vaStr} (${partnerName}+👻)`;
      }
      
      const a = $(`[data-vegas-a="${h}"]`);
      const b = $(`[data-vegas-b="${h}"]`);
      const m = $(`[data-vegas-m="${h}"]`);
      const p = $(`[data-vegas-p="${h}"]`);
      const pb = $(`[data-vegas-pb="${h}"]`);
      
      if(a) a.textContent=vaStr;
      if(b) b.textContent=hole.vbStr;
      if(m) m.textContent=(hole.mult==='—')?'—':String(hole.mult);
      const ptsA = hole.holePtsA;
      if(p) p.textContent=ptsA? (ptsA>0?`+${ptsA}`:`${ptsA}`) : "—";
      applyVegasTone(p, Number(ptsA) || 0);
      const ptsB = -ptsA;
      if(pb) pb.textContent=ptsB? (ptsB>0?`+${ptsB}`:`${ptsB}`) : "—";
      applyVegasTone(pb, Number(ptsB) || 0);
    });

    // Show individual player points in rotation mode
    if(data.rotation && data.playerPoints){
      const names = getVegasPlayerNames();
      const playerLines = data.playerPoints.map((pts, i) => {
        const sign = pts === 0 ? "" : (pts > 0 ? "+" : "");
        return `${names[i]}: ${sign}${pts}`;
      }).join(" | ");
      
      const pa = $(ids.vegasPtsA);
      const pb = $(ids.vegasPtsB);
      if(pa) pa.textContent = playerLines;
      if(pb) pb.textContent = "—";
      applyVegasTone(pa, NaN);
      applyVegasTone(pb, NaN);
    } else {
      const ptsA = data.ptsA;
      const pa = $(ids.vegasPtsA);
      if(pa) pa.textContent = ptsA===0? "0" : (ptsA>0? `+${ptsA}`:`${ptsA}`);
      applyVegasTone(pa, Number(ptsA) || 0);
      const ptsB = data.ptsB;
      const pb = $(ids.vegasPtsB);
      if(pb) pb.textContent = ptsB===0? "0" : (ptsB>0? `+${ptsB}`:`${ptsB}`);
      applyVegasTone(pb, Number(ptsB) || 0);
    }

    const fmt = v => {
      const abs = Math.abs(v);
      const s = `$${abs.toFixed(2)}`;
      if(v > 0) return `+${s}`;
      if(v < 0) return `-${s}`;
      return s;
    };
    
    // Show netted out total in rotation mode
    if(data.rotation){
      const per = Math.max(0, Number($(ids.vegasPointValue)?.value)||0);
      const names = getVegasPlayerNames();
      const netLines = data.playerPoints.map((pts, i) => {
        const dollars = pts * per;
        return `${names[i]}: ${fmt(dollars)}`;
      }).join(" | ");
      
      const da = $(ids.vegasDollarA);
      const db = $(ids.vegasDollarB);
      if(da) da.textContent = netLines;
      if(db) db.textContent = "—";
      applyVegasTone(da, NaN);
      applyVegasTone(db, NaN);
      
      // Show game breakdown
      const breakdownRow = document.getElementById('vegasGameBreakdown');
      const breakdownData = document.getElementById('vegasGameBreakdownData');
      if(breakdownRow && breakdownData && data.gameResults){
        breakdownRow.hidden = false;
        breakdownRow.style.display = '';
        const gameLines = data.gameResults.map((game, i) => {
          const playerName = names[game.player] || `P${game.player+1}`;
          const pts = game.points;
          const sign = pts === 0 ? "" : (pts > 0 ? "+" : "");
          const dollars = pts * per;
          return `<strong>Game ${i+1}</strong> (${playerName}+👻, Holes ${game.holes}): ${sign}${pts} pts (${fmt(dollars)})`;
        }).join(' • ');
        breakdownData.innerHTML = gameLines;
      }
    } else {
      const da = $(ids.vegasDollarA);
      const db = $(ids.vegasDollarB);
      if(da) da.textContent = fmt(data.dollarsA);
      if(db) db.textContent = fmt(data.dollarsB);
      applyVegasTone(da, Number(data.dollarsA) || 0);
      applyVegasTone(db, Number(data.dollarsB) || 0);
      
      // Hide game breakdown in non-rotation mode
      const breakdownRow = document.getElementById('vegasGameBreakdown');
      if(breakdownRow) { breakdownRow.hidden = true; breakdownRow.style.display = 'none'; }
    }

    const ta = $(ids.vegasTotalA);
    const tb = $(ids.vegasTotalB);
    if(ta) ta.textContent=data.totalA||"—";
    if(tb) tb.textContent=data.totalB||"—";

    renderVegasLiveResults(data);
  },
  // Internal helpers
  _teamPair(players, holeIdx, useNet, netHcpMode = 'playOffLow', computeCtx = null) {
    const vals = players.map(p => {
      // Check if this is a ghost (position >= getPlayers())
      if(p >= getPlayers()) {
        // In rotation mode (3 players), ghost is always active
        if(getPlayers() === 3) {
          return getPar(holeIdx); // Ghost shoots par
        }
        // Otherwise check if checkbox is enabled
        const ghostCheck = document.getElementById(`vegasGhost_${p}`);
        if(ghostCheck && ghostCheck.checked) {
          return getPar(holeIdx); // Ghost shoots par
        }
        return null;
      }
      return useNet ? getNetNDB(p, holeIdx, netHcpMode, computeCtx) : getGross(p, holeIdx, computeCtx);
    }).filter(v => Number.isFinite(v) && v > 0);
    if (vals.length < 2) return null;
    vals.sort((a,b)=>a-b);
    return [vals[0], vals[1]];
  },
  _pairToString(pair){ return `${pair[0]}${pair[1]}`; },
  _teamHasBirdieOrEagle(players,h,useNet,netHcpMode = 'playOffLow', computeCtx = null){
    const best=Math.min(...players.map(p=>{
      // Check if this is a ghost
      if(p >= getPlayers()) {
        // In rotation mode (3 players), ghost is always active
        if(getPlayers() === 3) {
          return getPar(h); // Ghost shoots par (never birdie/eagle)
        }
        const ghostCheck = document.getElementById(`vegasGhost_${p}`);
        if(ghostCheck && ghostCheck.checked) {
          return getPar(h); // Ghost shoots par (never birdie/eagle)
        }
        return Infinity;
      }
      return (useNet ? getNetNDB(p, h, netHcpMode, computeCtx) : getGross(p, h, computeCtx)) || Infinity;
    }));
    if(!Number.isFinite(best)) return {birdie:false,eagle:false};
    const par = computeCtx?.pars?.[h] || getPar(h);
    const toPar=best-par;
    return {birdie:toPar<=-1, eagle:toPar<=-2};
  },
  _multiplierForWinner(winnerPlayers,h,useNet,opts, computeCtx = null){
    const {birdie,eagle}=this._teamHasBirdieOrEagle(winnerPlayers,h,useNet,opts.netHcpMode, computeCtx); let m=1;
    if(opts.tripleEagle && eagle) m=Math.max(m,3);
    if(opts.doubleBirdie && birdie) m=Math.max(m,2);
    return m;
  }
};

function vegas_refreshTeamNames(){
  const vegasSection = document.getElementById('vegasSection');
  if (!vegasSection?.classList.contains('open')) return;

  const box=$(ids.vegasTeams);
  if(!box) return;

  const names = getVegasPlayerNames();
  const maxPositions = Math.min(getPlayers(), 4);

  for(let i=0; i<maxPositions; i++){
    const row = box.querySelector(`input[name="vegasTeam_${i}"]`)?.closest('.vegas-team-row');
    const label = row?.querySelector('.vegas-team-name');
    if(label) {
      const next = names[i] || `Player ${i+1}`;
      if (label.textContent !== next) label.textContent = next;
    }
  }

  const teams = vegas_getTeamAssignments();
  const opts = vegas_getOptions();
  const data = Vegas.compute(teams, opts, createVegasComputeContext(opts));
  renderTeamColumnLabels(data);
  vegas_syncColumnLabelsHard();
}

let vegasControlRecalcTimer = null;
function scheduleVegasControlRecalc() {
  clearTimeout(vegasControlRecalcTimer);
  vegasControlRecalcTimer = setTimeout(() => vegas_recalc(), VEGAS_CONTROL_RECALC_MS);
}

function vegas_renderTeamControls(){
  const box=$(ids.vegasTeams); if(!box) return;

  // Preserve existing selections so a re-render (triggered by name edits,
  // cascades, or cloud sync) does NOT reset the user's team picks.
  const prevAssignments = (() => {
    try { return vegas_getTeamAssignments(); } catch { return { A: [], B: [] }; }
  })();
  const prevGhosts = [];
  for (let i = 0; i < 4; i++) {
    const g = document.getElementById(`vegasGhost_${i}`);
    prevGhosts.push(!!(g && g.checked));
  }
  const hadPrev = (prevAssignments.A?.length || 0) + (prevAssignments.B?.length || 0) > 0;

  box.innerHTML="";
  const names = getVegasPlayerNames();
  
  // Vegas supports exactly 4 positions (players or ghosts)
  const maxPositions = 4;
  const realPlayers = Math.min(getPlayers(), maxPositions);
  const needsGhosts = getPlayers() < maxPositions;
  const useRotation = getPlayers() === 3;
  
  // In rotation mode, show info message instead of team controls
  if(useRotation){
    const info = document.createElement("div");
    info.style.gridColumn = "1 / -1";
    info.style.padding = "12px";
    info.style.background = "rgba(100,100,255,0.1)";
    info.style.borderRadius = "8px";
    info.style.marginBottom = "12px";
    info.innerHTML = `<strong>🔄 Rotation Mode (3 Players)</strong><br>Each player plays 6 holes with a ghost partner (shoots par):<br>• ${names[0]}: Holes 1-6<br>• ${names[1]}: Holes 7-12<br>• ${names[2]}: Holes 13-18`;
    box.appendChild(info);
    vegas_recalc();
    return;
  }
  
  for(let i=0; i<realPlayers; i++){
    const row=document.createElement("div"); row.className="vegas-team-row";
    const label=document.createElement("div"); label.className="vegas-team-name"; label.textContent=names[i];
    const choices=document.createElement("div"); choices.className="vegas-team-choice-group";
    const aWrap=document.createElement("label"); aWrap.className="vegas-choice-btn vegas-choice-radio";
    const a=document.createElement("input"); a.type="radio"; a.name=`vegasTeam_${i}`; a.value="A"; a.addEventListener("change",()=>{scheduleVegasControlRecalc();saveDebounced();});
    aWrap.appendChild(a); aWrap.appendChild(document.createTextNode("Team A"));
    const bWrap=document.createElement("label"); bWrap.className="vegas-choice-btn vegas-choice-radio";
    const b=document.createElement("input"); b.type="radio"; b.name=`vegasTeam_${i}`; b.value="B"; b.addEventListener("change",()=>{scheduleVegasControlRecalc();saveDebounced();});
    bWrap.appendChild(b); bWrap.appendChild(document.createTextNode("Team B"));
    choices.append(aWrap,bWrap);
    row.append(label,choices); box.appendChild(row);
  }
  
  // Add ghost positions if needed
  if(needsGhosts){
    for(let i=realPlayers; i<maxPositions; i++){
      const row=document.createElement("div"); row.className="vegas-team-row";
      const label=document.createElement("div"); label.className="vegas-team-name";
      const choices=document.createElement("div"); choices.className="vegas-team-choice-group";
      
      const ghostCheckWrap = document.createElement("label"); 
      ghostCheckWrap.className = "vegas-choice-btn vegas-choice-ghost";
      const ghostCheck = document.createElement("input"); 
      ghostCheck.type="checkbox"; 
      ghostCheck.id=`vegasGhost_${i}`;
      ghostCheck.addEventListener("change",()=>{scheduleVegasControlRecalc();saveDebounced();});
      ghostCheckWrap.appendChild(ghostCheck);
      ghostCheckWrap.appendChild(document.createTextNode(`Ghost ${i+1} (par)`));
      
      label.appendChild(ghostCheckWrap);
      
      const aWrap=document.createElement("label"); aWrap.className="vegas-choice-btn vegas-choice-radio";
      const a=document.createElement("input"); a.type="radio"; a.name=`vegasTeam_${i}`; a.value="A"; a.addEventListener("change",()=>{scheduleVegasControlRecalc();saveDebounced();});
      aWrap.appendChild(a); aWrap.appendChild(document.createTextNode("Team A"));
      const bWrap=document.createElement("label"); bWrap.className="vegas-choice-btn vegas-choice-radio";
      const b=document.createElement("input"); b.type="radio"; b.name=`vegasTeam_${i}`; b.value="B"; b.addEventListener("change",()=>{scheduleVegasControlRecalc();saveDebounced();});
      bWrap.appendChild(b); bWrap.appendChild(document.createTextNode("Team B"));
      choices.append(aWrap,bWrap);
      row.append(label,choices); box.appendChild(row);
    }
  }
  
  if (hadPrev) {
    // Restore the user's prior selections after the destructive rebuild.
    vegas_setTeamAssignments(prevAssignments);
    for (let i = realPlayers; i < maxPositions; i++) {
      const g = document.getElementById(`vegasGhost_${i}`);
      if (g) g.checked = prevGhosts[i];
    }
  } else {
    // First render: apply sensible defaults (P0+P1 = A, P2+P3 = B)
    const a0 = $(`input[name="vegasTeam_0"][value="A"]`); if (a0) a0.checked = true;
    const a1 = $(`input[name="vegasTeam_1"][value="A"]`); if (a1) a1.checked = true;
    if (realPlayers >= 3 || needsGhosts) {
      const b2 = $(`input[name="vegasTeam_2"][value="B"]`); if (b2) b2.checked = true;
    }
    if (realPlayers >= 4 || needsGhosts) {
      const b3 = $(`input[name="vegasTeam_3"][value="B"]`); if (b3) b3.checked = true;
    }
  }
}
function vegas_getTeamAssignments(){
  const teams={A:[],B:[]}; 
  const maxPositions = 4; // Vegas always uses 4 positions
  for(let i=0; i<maxPositions; i++){ 
    // Check if this position should be included
    if(i >= getPlayers()) {
      // This is a ghost position - only include if checkbox is checked
      const ghostCheck = document.getElementById(`vegasGhost_${i}`);
      if(!ghostCheck || !ghostCheck.checked) continue;
    }
    const a=$(`input[name="vegasTeam_${i}"][value="A"]`)?.checked; 
    (a?teams.A:teams.B).push(i); 
  } 
  return teams;
}
function vegas_setTeamAssignments(t){
  const maxPositions = 4;
  for(let i=0; i<maxPositions; i++){ 
    const a=$(`input[name="vegasTeam_${i}"][value="A"]`), b=$(`input[name="vegasTeam_${i}"][value="B"]`); 
    if(!a||!b) continue; 
    a.checked=false; b.checked=false; 

    // Reset ghost checkbox state; it will be re-enabled if this position is in saved teams
    const ghostCheck = document.getElementById(`vegasGhost_${i}`);
    if(ghostCheck) ghostCheck.checked = false;
  }
  t.A?.forEach(i=>{
    const r=$(`input[name="vegasTeam_${i}"][value="A"]`);
    if(r) r.checked=true;
    const ghostCheck = document.getElementById(`vegasGhost_${i}`);
    if(ghostCheck) ghostCheck.checked = true;
  });
  t.B?.forEach(i=>{
    const r=$(`input[name="vegasTeam_${i}"][value="B"]`);
    if(r) r.checked=true;
    const ghostCheck = document.getElementById(`vegasGhost_${i}`);
    if(ghostCheck) ghostCheck.checked = true;
  });
}
function vegas_getOptions() {
  const activeBtn = document.querySelector('#vegasHcpModeGroup .hcp-mode-btn[data-active="true"]');
  const mode = activeBtn?.dataset.value || 'gross';
  return {
    useNet: mode !== 'gross',
    netHcpMode: mode === 'rawHandicap' ? 'rawHandicap' : 'playOffLow',
    doubleBirdie: $(ids.optDoubleBirdie)?.checked || false,
    tripleEagle: $(ids.optTripleEagle)?.checked || false,
    pointValue: Math.max(0, Number($(ids.vegasPointValue)?.value) || 0)
  };
}
function vegas_setOptions(o) {
  if ('useNet' in o || 'netHcpMode' in o) {
    const mode = o.netHcpMode === 'rawHandicap' ? 'rawHandicap'
      : (o.useNet || o.netHcpMode === 'playOffLow') && o.useNet ? 'playOffLow'
      : 'gross';
    // Resolve: if useNet=false → gross; if useNet=true + netHcpMode=rawHandicap → rawHandicap; else → playOffLow
    const resolved = !o.useNet ? 'gross'
      : o.netHcpMode === 'rawHandicap' ? 'rawHandicap'
      : 'playOffLow';
    const btnId = resolved === 'rawHandicap' ? 'vegasHcpModeRawHandicap'
      : resolved === 'playOffLow' ? 'vegasHcpModePlayOffLow'
      : 'vegasHcpModeGross';
    document.querySelectorAll('#vegasHcpModeGroup .hcp-mode-btn').forEach((btn) => {
      const isActive = btn.id === btnId;
      btn.dataset.active = isActive ? 'true' : 'false';
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }
  if ('doubleBirdie' in o) $(ids.optDoubleBirdie).checked = !!o.doubleBirdie;
  if ('tripleEagle' in o) $(ids.optTripleEagle).checked = !!o.tripleEagle;
  if ('pointValue' in o && $(ids.vegasPointValue)) $(ids.vegasPointValue).value = o.pointValue;
}

function vegas_syncColumnLabelsHard() {
  const colA = $(ids.vegasColA);
  const colB = $(ids.vegasColB);
  const ptsColA = document.getElementById('vegasPtsColA');
  const ptsColB = document.getElementById('vegasPtsColB');
  if (!colA || !colB) return;
  if (getPlayers() !== 4) return;

  const aText = (colA.textContent || '').trim();
  const bText = (colB.textContent || '').trim();
  const stillGeneric = /^Team\s*A$/i.test(aText) && /^Team\s*B$/i.test(bText);
  if (!stillGeneric) return;

  const names = getVegasPlayerNames();
  const teams = vegas_getTeamAssignments();
  const teamA = teams?.A?.length === 2 ? teams.A : [0, 1];
  const teamB = teams?.B?.length === 2 ? teams.B : [2, 3];
  const compact = isVegasCompactWidth();
  const fmt = (team) => formatVegasTeamLabel(team, names, compact);

  const labelA = fmt(teamA);
  const labelB = fmt(teamB);
  colA.textContent = labelA;
  colB.textContent = labelB;
  if (ptsColA) ptsColA.textContent = `Pts (${labelA})`;
  if (ptsColB) ptsColB.textContent = `Pts (${labelB})`;
}

function vegas_recalc(){
  const teams=vegas_getTeamAssignments(), opts=vegas_getOptions();
  const data = Vegas.compute(teams, opts, createVegasComputeContext(opts));
  Vegas.render(data);
  vegas_syncColumnLabelsHard();
  try{ window._vegasUpdateDollars?.(); }catch{}
}

function vegas_renderTable(){
  const vegasTableBody = document.querySelector('#vegasBody');
  if(!vegasTableBody) return;
  vegasTableBody.innerHTML = '';
  const HOLES = getHoles();
  for(let h = 0; h < HOLES; h++){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${h+1}</td><td data-vegas-a="${h}">—</td><td data-vegas-b="${h}">—</td><td data-vegas-m="${h}">—</td><td data-vegas-p="${h}">—</td><td data-vegas-pb="${h}">—</td>`;
    vegasTableBody.appendChild(tr);
  }
}

// ======================================================================


  // =============================================================================
  // EXPOSE TO GLOBAL SCOPE
  // =============================================================================

  window.Vegas = {
    compute: Vegas.compute,
    render: Vegas.render,
    renderTeamControls: vegas_renderTeamControls,
    refreshTeamNames: vegas_refreshTeamNames,
    getTeamAssignments: vegas_getTeamAssignments,
    setTeamAssignments: vegas_setTeamAssignments,
    getOptions: vegas_getOptions,
    setOptions: vegas_setOptions,
    recalc: vegas_recalc,
    renderTable: vegas_renderTable
  };

  // Re-render team labels (full names <-> initials) when crossing the
  // desktop/mobile breakpoint so the column headers stay correct.
  try {
    const desktopMQ = window.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');
    const onChange = () => {
      try {
        if (document.getElementById('vegasSection')?.classList.contains('open')) {
          vegas_recalc();
        }
      } catch(_) {}
    };
    if (desktopMQ.addEventListener) desktopMQ.addEventListener('change', onChange);
    else if (desktopMQ.addListener) desktopMQ.addListener(onChange);
  } catch(_) {}

})();
