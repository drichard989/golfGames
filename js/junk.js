/* ============================================================================
   JUNK (DOTS) GAME MODULE
   ============================================================================
   
   Points-based game rewarding good scoring relative to par.
   Players accumulate "dots" based on their performance on each hole.
   
   BASE SCORING:
   • Eagle or better: 4 dots
   • Birdie: 2 dots
   • Par: 1 dot
   • Bogey or worse: 0 dots
   
   SCORING OPTIONS:
   • GROSS: Uses raw scores vs par
   • NET: Uses net scores with NDB cap (more equitable for mixed handicaps)
   
   ACHIEVEMENTS (Bonus Points):
   • Hogan (5 pts):   Birdie or better on all par 3s
   • Sandy (3 pts):   Up and down from bunker (par or better after bunker)
   • Sadaam (2 pts):  Out of bunker in one shot
   • Pulley (1 pt):   Make par after going OB or penalty
   • Triple (10 pts): Three or more consecutive birdies
   
   ACHIEVEMENT TRACKING:
   • Manual checkboxes per player per achievement
   • Achievements multiply by occurrence (e.g., 2 Sandys = 6 pts)
   • Bonus points added to base dots for total score
   • Weighted system encourages aggressive play
   
   FEATURES:
   • Dynamic player support (1-99 players)
   • Per-hole breakdown showing dots earned
   • Total dots + achievement bonuses = final score
   • Color-coded display (eagles, birdies, pars)
   • Achievement badges with counts
   
   Exposed as: window.Junk
   API: {init, initAchievements, refreshForPlayerChange, update}
   
   ============================================================================
 */
(function(){
  'use strict';
  
  const HOLES = 18;
  
  // =============================================================================
  // HELPERS - Read data from main scorecard
  // =============================================================================
  
  function getPar(hole){
    let el = document.querySelector(`#parRow input[data-hole="${hole}"]`);
    if(!el){
      const inputs = document.querySelectorAll('#parRow input');
      el = inputs[hole-1];
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    if (!Number.isFinite(v)) {
      console.error(`[Junk] Par value missing for hole ${hole}`);
    }
    return Number.isFinite(v) ? v : NaN;
  }

  function getScore(playerIdx, hole){
    let sel = `.score-input[data-player="${playerIdx}"][data-hole="${hole}"]`;
    let el = document.querySelector(sel);
    if(!el){
      const row = document.querySelector(`tr[data-player="${playerIdx}"]`) || document.querySelectorAll('tbody tr')[2 + playerIdx];
      if(row){
        const inputs = row.querySelectorAll('.score-input');
        el = inputs[hole-1];
      }
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : NaN;
  }

  function getPlayerNames(){
    const nameInputs = Array.from(document.querySelectorAll('.name-edit'));
    return nameInputs.map((input, i)=>{
      const v = input?.value?.trim();
      return v || `Player ${i+1}`;
    });
  }
  
  function getPlayerCount(){
    return document.querySelectorAll('.name-edit').length;
  }

  function dotsFor(score, par){
    if(!Number.isFinite(score) || !Number.isFinite(par)) return 0;
    const diff = score - par;
    if(diff <= -2) return 4; // eagle or better
    if(diff === -1) return 2; // birdie
    if(diff === 0)  return 1; // par
    return 0; // bogey or worse
  }

  // =============================================================================
  // JUNK2 CORE MODULE
  // =============================================================================
  
  const Junk = {
    /**
     * Compute base dots per hole and totals for players.
     * @returns {{perHole:number[][], totals:number[]}}
     */
    compute(){
      const playerCount = getPlayerCount();
      const perHole = Array.from({length: HOLES}, ()=> Array(playerCount).fill(0));
      const totals = Array(playerCount).fill(0);
      const useNet = document.getElementById('junkUseNet')?.checked || false;
      
      // Calculate adjusted handicaps inline if using NET
      let adjCHs = Array(playerCount).fill(0);
      if(useNet){
        const playerRows = Array.from(document.querySelectorAll('.player-row'));
        const chs = playerRows.map(r => {
          const chInput = r.querySelector('.ch-input');
          const v = Number(chInput?.value);
          return Number.isFinite(v) ? v : 0;
        });
        const minCH = Math.min(...chs);
        adjCHs = chs.map(ch => ch - minCH); // play off low
      }
      
      // Get HCPMEN from global scope (defined in index.js)
      const HCPMEN = window.HCPMEN || Array(18).fill(0);
      
      for(let h=1; h<=HOLES; h++){
        const par = getPar(h);
        const holeHcp = HCPMEN[h-1];
        for(let p=0; p<playerCount; p++){
          const score = getScore(p, h);
          // Calculate net score if using NET scoring
          let strokes = 0;
          if(useNet && adjCHs[p] > 0){
            const fullStrokes = Math.floor(adjCHs[p] / 18);
            const remainingStrokes = adjCHs[p] % 18;
            const getsStroke = remainingStrokes >= holeHcp;
            strokes = fullStrokes + (getsStroke ? 1 : 0);
          }
          const netScore = Number.isFinite(score) ? score - strokes : score;
          const d = dotsFor(netScore, par);
          perHole[h-1][p] = Number.isFinite(d) ? d : 0;
          totals[p] += Number.isFinite(d) ? d : 0;
        }
      }
      return { perHole, totals };
    },
    
    /**
     * Render per-hole dots and totals into the DOM.
     * Note: Achievements enhancement may overlay this view.
     * @param {{perHole:number[][], totals:number[]}} data
     */
    render(data){
      const { perHole, totals } = data;
      const playerCount = totals.length;
      
      // Update per-hole cells
      for(let h=1; h<=HOLES; h++){
        for(let p=0; p<playerCount; p++){
          const cell = document.getElementById(`junk_h${h}_p${p+1}`);
          if(!cell) continue;
          const dot = cell.querySelector('.junk-dot');
          const val = Number.isFinite(perHole[h-1][p]) ? perHole[h-1][p] : '—';
          if(dot){
            dot.textContent = String(val);
          }else{
            cell.textContent = String(val);
          }
        }
      }
      
      // Update base totals
      for(let p=0; p<playerCount; p++){
        const el = document.getElementById(`junkTotP${p+1}`);
        if(el) el.textContent = Number.isFinite(totals[p]) ? totals[p] : '—';
      }
    }
  };

  // =============================================================================
  // TABLE BUILDING
  // =============================================================================
  
  function buildJunkTable(){
    const tbody = document.getElementById('junkBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    const playerCount = getPlayerCount();
    
    for(let h=1; h<=HOLES; h++){
      const tr = document.createElement('tr');
      const th = document.createElement('td');
      th.textContent = h;
      tr.appendChild(th);
      
      for(let p=0; p<playerCount; p++){
        const td = document.createElement('td');
        td.id = `junk_h${h}_p${p+1}`;
        td.textContent = '—';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function refreshJunkHeaderNames(){
    const names = getPlayerNames();
    const playerCount = getPlayerCount();
    for(let i=0; i<playerCount; i++){
      const el = document.getElementById(`junkP${i+1}`);
      if(el) el.textContent = names[i] || `P${i+1}`;
    }
  }

  function updateJunk(){
    const tbody = document.getElementById('junkBody');
    if(!tbody) return;
    
    // Check if achievements are active (cells are enhanced)
    const hasEnhancedCells = tbody.querySelector('.junk-cell') !== null;
    
    if(hasEnhancedCells) {
      // Use weighted update which handles achievements and labels
      updateJunkTotalsWeighted();
    } else {
      // Use simple render for basic mode
      const data = Junk.compute();
      Junk.render(data);
    }
  }

  function rebuildJunkTableHeader(){
    const thead = document.querySelector('#junkTable thead tr');
    if(thead){
      // Clear existing headers except first (Hole)
      while(thead.children.length > 1) {
        thead.removeChild(thead.lastChild);
      }
      
      // Add player headers
      const playerCount = getPlayerCount();
      for(let p=0; p<playerCount; p++){
        const th = document.createElement('th');
        th.id = `junkP${p+1}`;
        th.textContent = `P${p+1}`;
        thead.appendChild(th);
      }
    }
    
    // Rebuild footer (totals rows)
    const tfoot = document.querySelector('#junkTable tfoot');
    if(tfoot){
      tfoot.innerHTML = '';
      const playerCount = getPlayerCount();
      
      // Totals row
      const totalsRow = document.createElement('tr');
      const totalLabel = document.createElement('td');
      totalLabel.innerHTML = '<strong>Totals</strong>';
      totalsRow.appendChild(totalLabel);
      for(let p=0; p<playerCount; p++){
        const td = document.createElement('td');
        td.id = `junkTotP${p+1}`;
        td.textContent = '—';
        totalsRow.appendChild(td);
      }
      tfoot.appendChild(totalsRow);
    }
  }

  // =============================================================================
  // ACHIEVEMENTS SYSTEM
  // =============================================================================
  
  const ACH = [
    { id: "sandy",  label: "Sandy",  pts: 1 },
    { id: "sadaam", label: "Sadaam", pts: 2 },
    { id: "kp",     label: "KP",     pts: 1 },
    { id: "hoover", label: "Hoover", pts: 10 },
    { id: "skin",   label: "Skin",   pts: 1 },
    { id: "pulley", label: "Pully",  pts: 1 },
    { id: "gcbc",   label: "GCBC",   pts: 3 },
    { id: "dod",    label: "DOD",    pts: 1 },
    { id: "hogan",  label: "Hogan",  pts: 1 },
    { id: "woodie", label: "Woodie", pts: 1 },
    { id: "chippy", label: "Chippy", pts: 1 },
    { id: "holein1", label: "Hole in 1", pts: 100 },
  ];

  function enhanceJunkCells(){
    const tbody = document.querySelector('#junkBody');
    if(!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const players = getPlayerCount();
    
    rows.forEach((tr, holeIdx)=>{
      for(let p=0; p<players; p++){
        const td = tr.children[p+1]; // skip first col (hole)
        if(!td) continue;
        if(td.querySelector('.junk-cell')) continue; // already enhanced
        
        const currentText = (td.textContent || '').trim();
        td.textContent = '';

        const wrap = document.createElement('div');
        wrap.className = 'junk-cell';

        const dotSpan = document.createElement('span');
        dotSpan.className = 'junk-dot';
        dotSpan.dataset.player = String(p);
        dotSpan.dataset.hole = String(holeIdx+1);
        dotSpan.textContent = currentText || '—';

        const achLabels = document.createElement('div');
        achLabels.className = 'junk-ach-labels';
        achLabels.dataset.player = String(p);
        achLabels.dataset.hole = String(holeIdx+1);

        const details = document.createElement('details');
        details.className = 'junk-dd';
        details.dataset.player = String(p);
        details.dataset.hole = String(holeIdx+1);

        const summary = document.createElement('summary');
        summary.textContent = 'Dots';

        const menu = document.createElement('div');
        menu.className = 'menu';

        // Build weighted options
        ACH.forEach(({id,label,pts})=>{
          const lab = document.createElement('label');
          const cb  = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'junk-ach';
          cb.dataset.player = String(p);
          cb.dataset.hole   = String(holeIdx+1);
          cb.dataset.key    = id;
          cb.dataset.pts    = String(pts);
          // restore if previously stored on the TD
          cb.checked = td.dataset[id] === '1';
          cb.addEventListener('change', ()=>{
            td.dataset[id] = cb.checked ? '1' : '';
            updateAchievementLabels(p, holeIdx+1);
            updateJunkTotalsWeighted();
          });
          lab.appendChild(cb);
          lab.append(` ${label} (+${pts})`);
          menu.appendChild(lab);
        });

        details.appendChild(summary);
        details.appendChild(menu);
        wrap.appendChild(dotSpan);
        wrap.appendChild(achLabels);
        wrap.appendChild(details);
        td.appendChild(wrap);
        
        // Initialize achievement labels for any pre-checked achievements
        updateAchievementLabels(p, holeIdx+1);
      }
    });
  }

  function achPoints(p, h){
    const box = document.querySelector(`details.junk-dd[data-player="${p}"][data-hole="${h}"]`);
    if(!box) return 0;
    let total = 0;
    box.querySelectorAll('input.junk-ach:checked').forEach(cb=>{
      const w = Number(cb.dataset.pts) || 1;
      total += w;
    });
    return total;
  }

  function updateAchievementLabels(p, h){
    const labelsDiv = document.querySelector(`.junk-ach-labels[data-player="${p}"][data-hole="${h}"]`);
    if(!labelsDiv) return;
    
    const box = document.querySelector(`details.junk-dd[data-player="${p}"][data-hole="${h}"]`);
    if(!box) return;
    
    const labels = [];
    
    // Add score relative to par (only if earning junk points)
    const score = getScore(p, h);
    const par = getPar(h);
    const useNet = document.getElementById('junkUseNet')?.checked || false;
    
    if(score > 0 && par > 0) {
      let displayScore = score;
      
      // If NET mode, calculate net score
      if(useNet) {
        const playerRows = Array.from(document.querySelectorAll('.player-row'));
        const chs = playerRows.map(r => {
          const chInput = r.querySelector('.ch-input');
          const v = Number(chInput?.value);
          return Number.isFinite(v) ? v : 0;
        });
        const minCH = Math.min(...chs);
        const adjCH = chs[p] - minCH;
        const HCPMEN = window.HCPMEN || Array(18).fill(0);
        const holeHcp = HCPMEN[h-1] || 1;
        
        // Calculate strokes on this hole
        const base = Math.floor(adjCH / 18);
        const rem = adjCH % 18;
        const strokes = base + (holeHcp <= rem ? 1 : 0);
        displayScore = score - strokes;
      }
      
      const diff = displayScore - par;
      
      // Only show results that earn junk points
      if(diff <= -2) labels.push(useNet ? 'Net Eagle' : 'Eagle');
      else if(diff === -1) labels.push(useNet ? 'Net Birdie' : 'Birdie');
      else if(diff === 0) labels.push(useNet ? 'Net Par' : 'Par');
      // Don't show Bogey or worse since they don't earn junk points
    }
    
    // Add achievements
    box.querySelectorAll('input.junk-ach:checked').forEach(cb=>{
      const achId = cb.dataset.key;
      const ach = ACH.find(a => a.id === achId);
      if(ach) labels.push(ach.label);
    });
    
    // Join with line breaks after every 2 items
    const chunks = [];
    for(let i = 0; i < labels.length; i += 2) {
      chunks.push(labels.slice(i, i + 2).join(', '));
    }
    labelsDiv.innerHTML = chunks.join('<br>');
  }

  function updateJunkTotalsWeighted(){
    const tbody = document.querySelector('#junkBody');
    const players = getPlayerCount();
    if(!tbody) return;
    
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const totals = Array(players).fill(0);
    
    rows.forEach((tr, holeIdx)=>{
      const h = holeIdx+1;
      const par = getPar(h);
      for(let p=0; p<players; p++){
        const score = getScore(p, h);
        const base  = dotsFor(score, par);
        const bonus = achPoints(p, h);
        const total = base + bonus;
        totals[p] += total;
        const span = tr.querySelector(`.junk-dot[data-player="${p}"][data-hole="${h}"]`);
        if(span) span.textContent = Number.isFinite(total) ? String(total) : '—';
        
        // Update achievement labels (includes score type)
        updateAchievementLabels(p, h);
      }
    });
    
    // Update totals
    for(let i=0; i<players; i++){
      const el = document.getElementById(`junkTotP${i+1}`);
      if(el) el.textContent = totals[i];
    }
  }

  function initJunkAchievements(){
    const junkTable = document.getElementById('junkTable');
    if(!junkTable) return;
    enhanceJunkCells();
    updateJunkTotalsWeighted();

    // Update totals on score/par/name changes
    document.addEventListener('input', (e)=>{
      const t = e.target;
      if(t.classList?.contains('score-input') || t.closest('#parRow') || t.classList?.contains('name-edit') || t.classList?.contains('junk-ach')){
        updateJunkTotalsWeighted();
      }
    }, { passive: true });

    document.addEventListener('change', (e)=>{
      const t = e.target;
      if(t.classList?.contains('junk-ach')){
        updateJunkTotalsWeighted();
      }
    });
  }

  // =============================================================================
  // PLAYER CHANGE REFRESH
  // =============================================================================
  
  function refreshJunkForPlayerChange(){
    const junkSection = document.getElementById('junkSection');
    if(junkSection && junkSection.classList.contains('open')){
      rebuildJunkTableHeader();
      buildJunkTable();
      refreshJunkHeaderNames();
      updateJunk();
      setTimeout(() => initJunkAchievements(), 0);
    }
  }

  // =============================================================================
  // INITIALIZATION
  // =============================================================================
  
  function initJunk(){
    rebuildJunkTableHeader();
    buildJunkTable();
    
    // Add event listener for NET scoring toggle
    const junkUseNet = document.getElementById('junkUseNet');
    if(junkUseNet){
      junkUseNet.addEventListener('change', ()=> {
        updateJunk();
      });
    }
    
    refreshJunkHeaderNames();
    updateJunk();
    
    // Initialize achievements UI after table is built
    setTimeout(() => initJunkAchievements(), 0);

    // Listen for score/par/name changes
    document.addEventListener('input', (e)=>{
      const t = e.target;
      if(t.classList?.contains('score-input') || t.closest('#parRow') || t.classList?.contains('name-edit')){
        if(t.classList?.contains('name-edit')) refreshJunkHeaderNames();
        updateJunk();
      }
    }, { passive: true });
  }

  // =============================================================================
  // TOGGLE HANDLER
  // =============================================================================
  
  function toggleGame(sectionId, toggleBtn){
    const sections = ['vegasSection','bankerSection','junkSection','junkSection','skinsSection'];
    sections.forEach(id=>{
      const sec = document.getElementById(id);
      if(!sec) return;
      const open = (id === sectionId) ? !sec.classList.contains('open') : false;
      sec.classList.toggle('open', open);
      sec.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
    const buttons = ['toggleVegas','toggleBanker','toggleJunk','toggleJunk','toggleSkins'];
    buttons.forEach(bid=>{
      const b = document.getElementById(bid);
      b && b.classList.toggle('active', bid === toggleBtn && document.getElementById(sectionId)?.classList.contains('open'));
    });
  }

  document.getElementById('toggleJunk')?.addEventListener('click', ()=>{
    initJunk();
    toggleGame('junkSection','toggleJunk');
  });

  // =============================================================================
  // EXPOSE TO GLOBAL SCOPE
  // =============================================================================
  
  window.Junk = {
    init: initJunk,
    initAchievements: initJunkAchievements,
    refreshForPlayerChange: refreshJunkForPlayerChange,
    update: updateJunk,
    compute: Junk.compute,
    render: Junk.render
  };

})();
