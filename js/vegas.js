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

  // Helper functions to access globals
  const getPlayers = () => {
    // Count name inputs that have actual values (trim and check length)
    const nameInputs = Array.from(document.querySelectorAll('.name-edit'));
    const validPlayers = nameInputs.filter(input => {
      const val = input?.value?.trim();
      return val && val.length > 0;
    }).length;
    return validPlayers > 0 ? validPlayers : nameInputs.length;
  };
  const getHoles = () => 18;
  const getPar = (h) => {
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
  };
  const getPars = () => {
    const pars = [];
    for (let i = 0; i < 18; i++) {
      pars.push(getPar(i));
    }
    return pars;
  };

  const getGross = (p, h) => {
    const input = document.querySelector(`.score-input[data-player="${p}"][data-hole="${h + 1}"]`);
    return Number(input?.value) || 0;
  };

  const getNetNDB = (p, h) => {
    // Get adjusted handicaps
    const playerRows = document.querySelectorAll('.player-row');
    const chs = [];
    playerRows.forEach(row => {
      const chInput = row.querySelector('.ch-input');
      const val = chInput?.value || '';
      chs.push(val === '' ? null : parseFloat(val));
    });
    const validCHs = chs.filter(ch => ch !== null);
    if (validCHs.length === 0) return getGross(p, h);
    const minCH = Math.min(...validCHs);
    const adjustedCHs = chs.map(ch => ch !== null ? ch - minCH : 0);
    
    const gross = getGross(p, h);
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
    const par = getPar(h);
    const ndb = par + NDB_BUFFER + sr;
    const adjGross = Math.min(gross, ndb);
    return adjGross - sr;
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Get IDs
  const ids = {
    vegasTeams: '#vegasTeams',
    vegasTeamWarning: '#vegasTeamWarning',
    vegasTotalA: '#vegasTotalA',
    vegasTotalB: '#vegasTotalB',
    vegasPtsA: '#vegasPtsA',
    vegasPtsB: '#vegasPtsB',
    vegasDollarA: '#vegasDollarA',
    vegasDollarB: '#vegasDollarB',
    optUseNet: '#optUseNet',
    optDoubleBirdie: '#optDoubleBirdie',
    optTripleEagle: '#optTripleEagle',
    vegasPointValue: '#vegasPointValue'
  };

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
  compute(teams, opts){
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
        
        const pairA = this._teamPair(teamsThisHole.A,h,opts.useNet);
        const pairB = this._teamPair(teamsThisHole.B,h,opts.useNet);
        if(!pairA || !pairB){
          perHole.push({vaStr:'—', vbStr:'—', mult:'—', holePtsA:0, ghostPartner: playerWithGhost});
          continue;
        }

        const aBE = this._teamHasBirdieOrEagle(teamsThisHole.A,h,opts.useNet);
        const bBE = this._teamHasBirdieOrEagle(teamsThisHole.B,h,opts.useNet);

        const effA = (bBE.birdie || bBE.eagle) ? [pairA[1],pairA[0]] : pairA;
        const effB = (aBE.birdie || aBE.eagle) ? [pairB[1],pairB[0]] : pairB;

        const vaStr=this._pairToString(effA), vbStr=this._pairToString(effB);
        const va=Number(vaStr), vb=Number(vbStr);

        let winner='A', diff=vb-va;
        if(diff<0){ winner='B'; diff=-diff; }
        const mult=this._multiplierForWinner(teamsThisHole[winner],h,opts.useNet,opts);
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
            s+=getGross(p,h)||0; 
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
      const pairA = this._teamPair(teams.A,h,opts.useNet);
      const pairB = this._teamPair(teams.B,h,opts.useNet);
      if(!pairA || !pairB){
        perHole.push({vaStr:'—', vbStr:'—', mult:'—', holePtsA:0});
        continue;
      }

      const aBE = this._teamHasBirdieOrEagle(teams.A,h,opts.useNet);
      const bBE = this._teamHasBirdieOrEagle(teams.B,h,opts.useNet);

      const effA = (bBE.birdie || bBE.eagle) ? [pairA[1],pairA[0]] : pairA;
      const effB = (aBE.birdie || aBE.eagle) ? [pairB[1],pairB[0]] : pairB;

      const vaStr=this._pairToString(effA), vbStr=this._pairToString(effB);
      const va=Number(vaStr), vb=Number(vbStr);

      let winner='A', diff=vb-va;
      if(diff<0){ winner='B'; diff=-diff; }
      const mult=this._multiplierForWinner(teams[winner],h,opts.useNet,opts);
      const holePtsA = winner==='A' ? diff*mult : -diff*mult;

      perHole.push({vaStr, vbStr, mult, holePtsA});
      ptsA += holePtsA;
    }

    const teamSum = team => { 
      let s=0; 
      for(let h=0;h<getHoles();h++){ 
        team.forEach(p=>{ 
          // Only count real players, not ghosts
          if(p < getPlayers()) {
            s+=getGross(p,h)||0; 
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
      const da = $(ids.vegasDollarA);
      const db = $(ids.vegasDollarB);
      if(da) da.textContent = '—';
      if(db) db.textContent = '—';
      return;
    }
    if(warn) warn.hidden=true;

    // Get player names from scorecard - get all name inputs like Junk/Skins do
    const nameInputs = Array.from(document.querySelectorAll('.name-edit'));
    const names = nameInputs.map((input, i) => {
      const v = input?.value?.trim();
      return v || `Player ${i+1}`;
    });
    
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
      const ptsB = -ptsA;
      if(pb) pb.textContent=ptsB? (ptsB>0?`+${ptsB}`:`${ptsB}`) : "—";
    });

    // Show individual player points in rotation mode
    if(data.rotation && data.playerPoints){
      const names = Array.from(document.querySelectorAll('.name-edit')).map((input, i) => {
        const v = input?.value?.trim();
        return v || `Player ${i+1}`;
      });
      const playerLines = data.playerPoints.map((pts, i) => {
        const sign = pts === 0 ? "" : (pts > 0 ? "+" : "");
        return `${names[i]}: ${sign}${pts}`;
      }).join(" | ");
      
      const pa = $(ids.vegasPtsA);
      const pb = $(ids.vegasPtsB);
      if(pa) pa.textContent = playerLines;
      if(pb) pb.textContent = "—";
    } else {
      const ptsA = data.ptsA;
      const pa = $(ids.vegasPtsA);
      if(pa) pa.textContent = ptsA===0? "0" : (ptsA>0? `+${ptsA}`:`${ptsA}`);
      const ptsB = data.ptsB;
      const pb = $(ids.vegasPtsB);
      if(pb) pb.textContent = ptsB===0? "0" : (ptsB>0? `+${ptsB}`:`${ptsB}`);
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
      const names = Array.from(document.querySelectorAll('.name-edit')).map((input, i) => {
        const v = input?.value?.trim();
        return v || `Player ${i+1}`;
      });
      const netLines = data.playerPoints.map((pts, i) => {
        const dollars = pts * per;
        return `${names[i]}: ${fmt(dollars)}`;
      }).join(" | ");
      
      const da = $(ids.vegasDollarA);
      const db = $(ids.vegasDollarB);
      if(da) da.textContent = netLines;
      if(db) db.textContent = "—";
      
      // Show game breakdown
      const breakdownRow = document.getElementById('vegasGameBreakdown');
      const breakdownData = document.getElementById('vegasGameBreakdownData');
      if(breakdownRow && breakdownData && data.gameResults){
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
      
      // Hide game breakdown in non-rotation mode
      const breakdownRow = document.getElementById('vegasGameBreakdown');
      if(breakdownRow) breakdownRow.style.display = 'none';
    }

    const ta = $(ids.vegasTotalA);
    const tb = $(ids.vegasTotalB);
    if(ta) ta.textContent=data.totalA||"—";
    if(tb) tb.textContent=data.totalB||"—";
  },
  // Internal helpers
  _teamPair(players, holeIdx, useNet) {
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
      return useNet ? getNetNDB(p, holeIdx) : getGross(p, holeIdx);
    }).filter(v => Number.isFinite(v) && v > 0);
    if (vals.length < 2) return null;
    vals.sort((a,b)=>a-b);
    return [vals[0], vals[1]];
  },
  _pairToString(pair){ return `${pair[0]}${pair[1]}`; },
  _teamHasBirdieOrEagle(players,h,useNet){
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
      return (useNet?getNetNDB(p,h):getGross(p,h))||Infinity;
    }));
    if(!Number.isFinite(best)) return {birdie:false,eagle:false};
    const par = getPar(h);
    const toPar=best-par;
    return {birdie:toPar<=-1, eagle:toPar<=-2};
  },
  _multiplierForWinner(winnerPlayers,h,useNet,opts){
    const {birdie,eagle}=this._teamHasBirdieOrEagle(winnerPlayers,h,useNet); let m=1;
    if(opts.tripleEagle && eagle) m=Math.max(m,3);
    if(opts.doubleBirdie && birdie) m=Math.max(m,2);
    return m;
  }
};

function vegas_renderTeamControls(){
  const box=$(ids.vegasTeams); box.innerHTML="";
  const names = Array.from(document.querySelectorAll('.name-edit')).map((input, i) => {
    const v = input?.value?.trim();
    return v || `Player ${i+1}`;
  });
  
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
    const row=document.createElement("div"); row.style.display="contents";
    const label=document.createElement("div"); label.textContent=names[i];
    const aWrap=document.createElement("label"); aWrap.className="radio";
    const a=document.createElement("input"); a.type="radio"; a.name=`vegasTeam_${i}`; a.value="A"; a.addEventListener("change",()=>{vegas_recalc();saveDebounced();});
    aWrap.appendChild(a); aWrap.appendChild(document.createTextNode("Team A"));
    const bWrap=document.createElement("label"); bWrap.className="radio";
    const b=document.createElement("input"); b.type="radio"; b.name=`vegasTeam_${i}`; b.value="B"; b.addEventListener("change",()=>{vegas_recalc();saveDebounced();});
    bWrap.appendChild(b); bWrap.appendChild(document.createTextNode("Team B"));
    row.append(label,aWrap,bWrap); box.appendChild(row);
  }
  
  // Add ghost positions if needed
  if(needsGhosts){
    for(let i=realPlayers; i<maxPositions; i++){
      const row=document.createElement("div"); row.style.display="contents";
      const label=document.createElement("div"); 
      
      const ghostCheckWrap = document.createElement("label"); 
      ghostCheckWrap.style.display = "flex";
      ghostCheckWrap.style.alignItems = "center";
      ghostCheckWrap.style.gap = "4px";
      const ghostCheck = document.createElement("input"); 
      ghostCheck.type="checkbox"; 
      ghostCheck.id=`vegasGhost_${i}`;
      ghostCheck.addEventListener("change",()=>{vegas_recalc();saveDebounced();});
      ghostCheckWrap.appendChild(ghostCheck);
      ghostCheckWrap.appendChild(document.createTextNode(`Ghost ${i+1} (par)`));
      
      label.appendChild(ghostCheckWrap);
      
      const aWrap=document.createElement("label"); aWrap.className="radio";
      const a=document.createElement("input"); a.type="radio"; a.name=`vegasTeam_${i}`; a.value="A"; a.addEventListener("change",()=>{vegas_recalc();saveDebounced();});
      aWrap.appendChild(a); aWrap.appendChild(document.createTextNode("Team A"));
      const bWrap=document.createElement("label"); bWrap.className="radio";
      const b=document.createElement("input"); b.type="radio"; b.name=`vegasTeam_${i}`; b.value="B"; b.addEventListener("change",()=>{vegas_recalc();saveDebounced();});
      bWrap.appendChild(b); bWrap.appendChild(document.createTextNode("Team B"));
      row.append(label,aWrap,bWrap); box.appendChild(row);
    }
  }
  
  // Set default team assignments
  $(`input[name="vegasTeam_0"][value="A"]`).checked ||= true;
  $(`input[name="vegasTeam_1"][value="A"]`).checked ||= true;
  if(realPlayers >= 3 || needsGhosts) $(`input[name="vegasTeam_2"][value="B"]`).checked ||= true;
  if(realPlayers >= 4 || needsGhosts) $(`input[name="vegasTeam_3"][value="B"]`).checked ||= true;
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
  }
  t.A?.forEach(i=>{ const r=$(`input[name="vegasTeam_${i}"][value="A"]`); if(r) r.checked=true; });
  t.B?.forEach(i=>{ const r=$(`input[name="vegasTeam_${i}"][value="B"]`); if(r) r.checked=true; });
}
function vegas_getOptions(){ return { useNet:$(ids.optUseNet)?.checked||false, doubleBirdie:$(ids.optDoubleBirdie)?.checked||false, tripleEagle:$(ids.optTripleEagle)?.checked||false, pointValue: Math.max(0, Number($(ids.vegasPointValue)?.value)||0) }; }
function vegas_setOptions(o){ if('useNet'in o) $(ids.optUseNet).checked=!!o.useNet; if('doubleBirdie'in o) $(ids.optDoubleBirdie).checked=!!o.doubleBirdie; if('tripleEagle'in o) $(ids.optTripleEagle).checked=!!o.tripleEagle; if('pointValue' in o && $(ids.vegasPointValue)) $(ids.vegasPointValue).value = o.pointValue; }

function vegas_recalc(){
  const teams=vegas_getTeamAssignments(), opts=vegas_getOptions();
  const data = Vegas.compute(teams, opts);
  Vegas.render(data);
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
    getTeamAssignments: vegas_getTeamAssignments,
    setTeamAssignments: vegas_setTeamAssignments,
    getOptions: vegas_getOptions,
    setOptions: vegas_setOptions,
    recalc: vegas_recalc,
    renderTable: vegas_renderTable
  };

})();
