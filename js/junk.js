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
  let junkCoreListenersBound = false;
  let junkAchievementListenersBound = false;
  let persistedAchievementState = [];
  
  // Access game constants with fallbacks
  const getJunkConstants = () => {
    if (window.GAME_CONSTANTS?.JUNK) {
      return window.GAME_CONSTANTS.JUNK;
    }
    // Fallback constants if not loaded
    return {
      POINTS: { EAGLE: 4, BIRDIE: 2, PAR: 1, BOGEY: 0 },
      ACHIEVEMENTS: { HOGAN: 5, SANDY: 3, SADAAM: 2, PULLEY: 1, TRIPLE: 10 }
    };
  };
  
  // =============================================================================
  // HELPERS - Read data from main scorecard
  // =============================================================================
  
  function getPar(hole){
    try {
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
    } catch (error) {
      console.error('[Junk] Error getting par:', error);
      return NaN;
    }
  }

  function getScore(playerIdx, hole){
    try {
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
    } catch (error) {
      console.error('[Junk] Error getting score:', error);
      return NaN;
    }
  }

  function getPlayerNames(){
    try {
      const rows = getFixedPlayerRows();
      return rows.map((row, i) => {
        const input = row.querySelector('.name-edit');
        const v = input?.value?.trim();
        return v || `Player ${i+1}`;
      });
    } catch (error) {
      console.error('[Junk] Error getting player names:', error);
      return [];
    }
  }
  
  function getPlayerCount(){
    try {
      return getFixedPlayerRows().length;
    } catch (error) {
      console.error('[Junk] Error getting player count:', error);
      return 0;
    }
  }

  function getFixedPlayerRows() {
    return Array.from(document.querySelectorAll('#scorecardFixed .player-row'));
  }

  function getAdjustedCHs() {
    const chs = getFixedPlayerRows().map((row) => {
      const chInput = row.querySelector('.ch-input');
      const v = typeof window.getActualHandicapValue === 'function'
        ? window.getActualHandicapValue(chInput)
        : Number(chInput?.value);
      return Number.isFinite(v) ? v : 0;
    });

    if (!chs.length) return [];
    const minCH = Math.min(...chs);
    return chs.map((ch) => ch - minCH);
  }

  function getRawCHs() {
    return getFixedPlayerRows().map((row) => {
      const chInput = row.querySelector('.ch-input');
      const v = typeof window.getActualHandicapValue === 'function'
        ? window.getActualHandicapValue(chInput)
        : Number(chInput?.value);
      return Number.isFinite(v) ? v : 0;
    });
  }

  function getJunkScoringConfig() {
    const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
    const mode = activeBtn?.dataset.value || 'gross';
    const useNet = mode !== 'gross';
    const netHcpMode = mode === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
    return { useNet, netHcpMode };
  }

  function getJunkSkinsDotsConfig() {
    const baseConfig = getJunkScoringConfig();
    const useNet = baseConfig.useNet;
    const netHcpMode = baseConfig.netHcpMode;
    const carry = document.getElementById('junkSkinsCarry')?.checked ?? true;
    const half = useNet ? (document.getElementById('junkSkinsHalf')?.checked ?? false) : false;
    const buyIn = Math.max(0, Number(document.getElementById('junkSkinsBuyIn')?.value) || 0);
    return { useNet, netHcpMode, carry, half, buyIn };
  }

  function syncJunkSkinsHalfState() {
    const isNet = getJunkScoringConfig().useNet;
    const halfEl = document.getElementById('junkSkinsHalf');
    if (halfEl) {
      halfEl.disabled = !isNet;
      if (!isNet) halfEl.checked = false;
    }
  }

  function calcStrokesFromHandicap(handicap, holeHcp) {
    const h = Number(handicap) || 0;
    if (h === 0) return 0;

    const abs = Math.abs(h);
    const base = Math.floor(abs / 18);
    const rem = abs % 18;
    const extra = holeHcp <= rem ? 1 : 0;
    const magnitude = base + extra;
    return h >= 0 ? magnitude : -magnitude;
  }

  function strokesOnHoleHalfAware(adjCH, holeIdx, half, HCPMEN) {
    const holeHcp = (HCPMEN || window.HCPMEN || Array(18).fill(1))[holeIdx - 1] || 1;

    if (adjCH < 0) {
      const absAdj = Math.abs(adjCH);
      const base = Math.floor(absAdj / 18);
      const rem = absAdj % 18;
      const fullStrokes = base + (holeHcp <= rem ? 1 : 0);
      return half ? -(fullStrokes * 0.5) : -fullStrokes;
    }

    if (adjCH === 0) return 0;

    const base = Math.floor(adjCH / 18);
    const rem = adjCH % 18;
    const fullStrokes = base + (holeHcp <= rem ? 1 : 0);
    return half ? (fullStrokes * 0.5) : fullStrokes;
  }

  function getJunkScoreForHole(playerIdx, hole, config, cache = {}) {
    const gross = getScore(playerIdx, hole);
    if (!Number.isFinite(gross) || !config.useNet) return gross;

    const holeHcp = (cache.HCPMEN || window.HCPMEN || Array(18).fill(1))[hole - 1] || 1;
    const handicap = config.netHcpMode === 'rawHandicap'
      ? ((cache.rawCHs || getRawCHs())[playerIdx] || 0)
      : ((cache.adjustedCHs || getAdjustedCHs())[playerIdx] || 0);

    const strokes = calcStrokesFromHandicap(handicap, holeHcp);
    return gross - strokes;
  }

  function getJunkSkinsScoreForHole(playerIdx, hole, config, cache = {}) {
    const gross = getScore(playerIdx, hole);
    if (!Number.isFinite(gross) || !config.useNet) return gross;

    const handicap = config.netHcpMode === 'rawHandicap'
      ? ((cache.rawCHs || getRawCHs())[playerIdx] || 0)
      : ((cache.adjustedCHs || getAdjustedCHs())[playerIdx] || 0);
    const strokesReceived = strokesOnHoleHalfAware(handicap, hole, config.half, cache.HCPMEN);
    const par = getPar(hole);
    const ndb = Number.isFinite(par) ? (par + 2 + strokesReceived) : gross;
    const cappedGross = Math.min(gross, ndb);
    return cappedGross - strokesReceived;
  }

  function computeJunkSkinAwards(config) {
    const playerCount = getPlayerCount();
    const awards = Array.from({ length: HOLES }, () => Array(playerCount).fill(0));
    let pot = 1;

    const cache = {
      HCPMEN: window.HCPMEN || Array(18).fill(1),
      adjustedCHs: config.useNet && config.netHcpMode !== 'rawHandicap' ? getAdjustedCHs() : [],
      rawCHs: config.useNet && config.netHcpMode === 'rawHandicap' ? getRawCHs() : []
    };

    for (let h = 1; h <= HOLES; h++) {
      const scores = Array.from({ length: playerCount }, (_, p) =>
        getJunkSkinsScoreForHole(p, h, config, cache)
      );
      const filled = scores.map((n, p) => ({ n, p })).filter((x) => Number.isFinite(x.n) && x.n > 0);

      if (filled.length < 2) {
        if (config.carry) pot += 1;
        continue;
      }

      const min = Math.min(...filled.map((x) => x.n));
      const winners = filled.filter((x) => x.n === min).map((x) => x.p);
      if (winners.length !== 1) {
        if (config.carry) pot += 1;
        continue;
      }

      const winner = winners[0];
      awards[h - 1][winner] = pot;
      pot = 1;
    }

    return awards;
  }

  function applyAutoSkinAwards(awards, config) {
    const players = getPlayerCount();
    const valuePerSkin = Number(config.buyIn) || 0;

    for (let h = 1; h <= HOLES; h++) {
      for (let p = 0; p < players; p++) {
        const td = document.getElementById(`junk_h${h}_p${p+1}`);
        const checkbox = document.querySelector(`#junkTable input.junk-ach[data-player="${p}"][data-hole="${h}"][data-key="skin"]`);
        if (!td || !checkbox) continue;

        const skinsWon = awards[h - 1]?.[p] || 0;
        const skinPoints = skinsWon > 0 ? (skinsWon * valuePerSkin) : 0;
        const hasSkin = skinPoints > 0;

        td.dataset.skin = hasSkin ? '1' : '';
        td.dataset.skinCount = hasSkin ? String(skinPoints) : '';
        checkbox.dataset.count = hasSkin ? String(skinPoints) : '0';
        checkbox.checked = hasSkin;
        checkbox.disabled = true;
      }
    }
  }

  function syncJunkNetModeVisibility() {
    // No-op: mode is now a single button group, no secondary panel to show/hide.
  }

  function dotsFor(score, par){
    if(!Number.isFinite(score) || !Number.isFinite(par)) return 0;
    const POINTS = getJunkConstants().POINTS;
    const diff = score - par;
    if(diff <= -2) return POINTS.EAGLE; // eagle or better
    if(diff === -1) return POINTS.BIRDIE; // birdie
    if(diff === 0)  return POINTS.PAR; // par
    return POINTS.BOGEY; // bogey or worse
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
      const config = getJunkScoringConfig();
      const cache = {
        HCPMEN: window.HCPMEN || Array(18).fill(1),
        adjustedCHs: config.useNet && config.netHcpMode !== 'rawHandicap' ? getAdjustedCHs() : [],
        rawCHs: config.useNet && config.netHcpMode === 'rawHandicap' ? getRawCHs() : []
      };
      
      for(let h=1; h<=HOLES; h++){
        const par = getPar(h);
        for(let p=0; p<playerCount; p++){
          const scoreForDots = getJunkScoreForHole(p, h, config, cache);
          const d = dotsFor(scoreForDots, par);
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

      renderJunkLiveResults(totals);
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

  function renderJunkLiveResults(totals = []) {
    const containers = [
      document.getElementById('junkLiveResults'),
      document.getElementById('junkResultsBottom')
    ].filter(Boolean);
    if (!containers.length) return;

    const names = getPlayerNames();
    const playerCount = getPlayerCount();
    if (!playerCount) {
      containers.forEach(c => { c.innerHTML = ''; });
      return;
    }

    const headerCells = Array.from({ length: playerCount }, (_, p) => `<td>${names[p] || `P${p+1}`}</td>`).join('');
    const totalCells = Array.from({ length: playerCount }, (_, p) => `<td>${Number.isFinite(totals[p]) ? totals[p] : '—'}</td>`).join('');

    const html = `
      <table class="live-results-table" aria-label="Live Junk results">
        <tbody>
          <tr class="live-results-title-row"><th colspan="${playerCount + 1}">Totals</th></tr>
          <tr class="live-results-data-row"><td class="live-results-label">Player</td>${headerCells}</tr>
          <tr class="live-results-data-row"><td class="live-results-label">Net</td>${totalCells}</tr>
        </tbody>
      </table>
    `;
    containers.forEach(c => { c.innerHTML = html; });
  }

  function updateJunk(){
    const tbody = document.getElementById('junkBody');
    if(!tbody) return;

    // Detect player-count drift: if the table was last built for a different
    // number of players (e.g. someone tapped the − button on a player row),
    // rebuild header/body/footer here so the table stays in sync. Other
    // callers (player-add, course-switch, name-edit) all funnel through
    // AppManager.recalcGames() -> Junk.update(), so this is the single
    // chokepoint that keeps junk's view of the roster honest.
    const playerCount = getPlayerCount();
    const thead = document.querySelector('#junkTable thead tr');
    const headerPlayerCells = thead ? Math.max(0, thead.children.length - 1) : 0;
    if (playerCount !== headerPlayerCells) {
      rebuildJunkTableHeader();
      buildJunkTable();
      refreshJunkHeaderNames();
      // Re-init achievements UI for the new column set on the next tick.
      setTimeout(() => { try { initJunkAchievements(); } catch (e) {} }, 0);
    }

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
    { id: "gcbc",   label: "GCBBC",   pts: 3 },
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
          if (id === 'skin') {
            cb.disabled = true;
            cb.title = 'Skin dots are auto-awarded from Junk Skins Dots settings';
            cb.dataset.count = td.dataset.skinCount || '0';
          }
          // restore if previously stored on the TD
          cb.checked = td.dataset[id] === '1';
          cb.addEventListener('change', ()=>{
            if (id === 'skin') {
              return;
            }
            td.dataset[id] = cb.checked ? '1' : '';
            updateAchievementLabels(p, holeIdx+1);
            updateJunkTotalsWeighted();
            // Save state when achievements change
            if (typeof window.saveDebounced === 'function') {
              window.saveDebounced();
            }
          });
          lab.appendChild(cb);
          lab.append(` ${label} (+${pts})`);
          if (id === 'skin') {
            const autoBadge = document.createElement('span');
            autoBadge.className = 'junk-ach-auto-badge';
            autoBadge.textContent = 'Auto';
            lab.appendChild(autoBadge);
          }
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
      if (cb.dataset.key === 'skin') {
        const skinCount = Number(cb.dataset.count || 0);
        total += w * (Number.isFinite(skinCount) ? skinCount : 0);
      } else {
        total += w;
      }
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
    const config = getJunkScoringConfig();
    const score = getJunkScoreForHole(p, h, config, {
      HCPMEN: window.HCPMEN || Array(18).fill(1),
      adjustedCHs: config.useNet && config.netHcpMode !== 'rawHandicap' ? getAdjustedCHs() : [],
      rawCHs: config.useNet && config.netHcpMode === 'rawHandicap' ? getRawCHs() : []
    });
    const par = getPar(h);
    
    if(score > 0 && par > 0) {
      const diff = score - par;
      
      // Only show results that earn junk points
      if(diff <= -2) labels.push(config.useNet ? 'Net Eagle' : 'Eagle');
      else if(diff === -1) labels.push(config.useNet ? 'Net Birdie' : 'Birdie');
      else if(diff === 0) labels.push(config.useNet ? 'Net Par' : 'Par');
      // Don't show Bogey or worse since they don't earn junk points
    }
    
    // Collect achievements with emojis
    const achievements = [];
    box.querySelectorAll('input.junk-ach:checked').forEach(cb=>{
      const achId = cb.dataset.key;
      const ach = ACH.find(a => a.id === achId);
      if (ach) {
        let label = ach.label;
        if (achId === 'skin') {
          const skinCount = Number(cb.dataset.count || 0);
          label = skinCount > 1 ? `${ach.label} x${skinCount}` : ach.label;
        }
        achievements.push({ emoji: ach.emoji, label });
      }
    });
    
    // Build HTML: emoji + label pairs stacked
    let html = '';
    
    // First add text labels (Eagle, Birdie, Par)
    if (labels.length > 0) {
      const chunks = [];
      for(let i = 0; i < labels.length; i += 2) {
        chunks.push(labels.slice(i, i + 2).join(', '));
      }
      html += `<div class="junk-text-labels">${chunks.join('<br>')}</div>`;
    }
    
    // Then add achievement badges (emoji + label stacked)
    if (achievements.length > 0) {
      const badges = achievements.map(a => `
        <div class="junk-ach-badge">
          <div class="junk-ach-emoji">${a.emoji}</div>
          <div class="junk-ach-label-small">${a.label}</div>
        </div>
      `).join('');
      html += `<div class="junk-ach-badges">${badges}</div>`;
    }
    
    labelsDiv.innerHTML = html;
  }

  function updateJunkTotalsWeighted(){
    const tbody = document.querySelector('#junkBody');
    const players = getPlayerCount();
    if(!tbody) return;

    syncJunkSkinsHalfState();

    const config = getJunkScoringConfig();
    const cache = {
      HCPMEN: window.HCPMEN || Array(18).fill(1),
      adjustedCHs: config.useNet && config.netHcpMode !== 'rawHandicap' ? getAdjustedCHs() : [],
      rawCHs: config.useNet && config.netHcpMode === 'rawHandicap' ? getRawCHs() : []
    };

    const skinsConfig = getJunkSkinsDotsConfig();
    const skinsAwards = computeJunkSkinAwards(skinsConfig);
    applyAutoSkinAwards(skinsAwards, skinsConfig);
    
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const totals = Array(players).fill(0);
    
    rows.forEach((tr, holeIdx)=>{
      const h = holeIdx+1;
      const par = getPar(h);
      for(let p=0; p<players; p++){
        const score = getJunkScoreForHole(p, h, config, cache);
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

    renderJunkLiveResults(totals);
  }

  function initJunkAchievements(){
    const junkTable = document.getElementById('junkTable');
    if(!junkTable) return;
    enhanceJunkCells();
    updateJunkTotalsWeighted();

    if (junkAchievementListenersBound) return;
    junkAchievementListenersBound = true;

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
    
    refreshJunkHeaderNames();
    updateJunk();
    syncJunkNetModeVisibility();
    
    // Initialize achievements UI after table is built
    setTimeout(() => initJunkAchievements(), 0);

    if (!junkCoreListenersBound) {
      junkCoreListenersBound = true;

      document.getElementById('junkHcpModeGroup')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.hcp-mode-btn');
        if (!btn) return;
        updateJunk();
        if (typeof window.saveDebounced === 'function') {
          window.saveDebounced();
        }
      });

      // Listen for score/par/name changes
      document.addEventListener('input', (e)=>{
        const t = e.target;
        if(t.classList?.contains('score-input') || t.closest('#parRow') || t.classList?.contains('name-edit')){
          if(t.classList?.contains('name-edit')) refreshJunkHeaderNames();
          updateJunk();
        }
      }, { passive: true });

      document.getElementById('junkSkinsCarry')?.addEventListener('change', () => {
        updateJunk();
        if (typeof window.saveDebounced === 'function') window.saveDebounced();
      });
      document.getElementById('junkSkinsHalf')?.addEventListener('change', () => {
        updateJunk();
        if (typeof window.saveDebounced === 'function') window.saveDebounced();
      });
      document.getElementById('junkSkinsBuyIn')?.addEventListener('input', () => {
        updateJunk();
        if (typeof window.saveDebounced === 'function') window.saveDebounced();
      });
    }
  }

  // =============================================================================
  // TOGGLE HANDLER
  // =============================================================================
  
  /**
   * Get current achievement state for saving
   * Returns array of checked achievements: [{player, hole, key}]
   */
  function getAchievementState() {
    const achievements = [];
    const checkboxes = document.querySelectorAll('#junkTable input.junk-ach:checked');
    if (checkboxes.length === 0) {
      return Array.isArray(persistedAchievementState)
        ? persistedAchievementState.map((achievement) => ({ ...achievement }))
        : [];
    }

    checkboxes.forEach(cb => {
      const count = cb.dataset.key === 'skin' ? (Number(cb.dataset.count) || 1) : undefined;
      achievements.push({
        player: parseInt(cb.dataset.player),
        hole: parseInt(cb.dataset.hole),
        key: cb.dataset.key,
        count
      });
    });

    persistedAchievementState = achievements.map((achievement) => ({ ...achievement }));
    return achievements;
  }

  /**
   * Restore achievement state from saved data
   * @param {Array} achievements - Array of {player, hole, key}
   */
  function setAchievementState(achievements) {
    const players = getPlayerCount();
    persistedAchievementState = Array.isArray(achievements)
      ? achievements
          .map((achievement) => ({ ...achievement }))
          .filter((achievement) => {
            const player = Number(achievement?.player);
            const hole = Number(achievement?.hole);
            const key = String(achievement?.key || '');
            if (!Number.isInteger(player) || player < 0 || player >= players) return false;
            if (!Number.isInteger(hole) || hole < 1 || hole > HOLES) return false;
            return ACH.some((a) => a.id === key);
          })
      : [];
    
    // First, ensure the table is built and enhanced
    const tbody = document.querySelector('#junkBody');
    if(!tbody || !tbody.querySelector('.junk-cell')) {
      return;
    }

    tbody.querySelectorAll('input.junk-ach').forEach((checkbox) => {
      if (checkbox.checked) {
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    persistedAchievementState.forEach(({player, hole, key, count}) => {
      const checkbox = document.querySelector(
        `#junkTable input.junk-ach[data-player="${player}"][data-hole="${hole}"][data-key="${key}"]`
      );
      if(checkbox) {
        if (key === 'skin') {
          checkbox.dataset.count = String(Number(count) || 1);
          const td = document.getElementById(`junk_h${Number(hole)}_p${Number(player)+1}`);
          if (td) {
            td.dataset.skin = '1';
            td.dataset.skinCount = checkbox.dataset.count;
          }
          checkbox.checked = true;
        } else if (!checkbox.checked) {
          checkbox.checked = true;
          // Trigger change event to update labels and totals
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });

    updateJunkTotalsWeighted();
  }

  /**
   * Clear all achievements (checkboxes) for all players on all holes
   */
  function clearAllAchievements() {
    persistedAchievementState = [];

    // Find all achievement checkboxes in the Junk table
    const checkboxes = document.querySelectorAll('#junkTable input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      if(checkbox.checked) {
        checkbox.checked = false;
        // Trigger change event to update the cell
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    // Update the table to recalculate totals
    if (document.getElementById('junkBody')) {
      updateJunk();
    }
    
    // Save the cleared state
    if (typeof window.saveDebounced === 'function') {
      window.saveDebounced();
    }
  }

  function toggleGame(sectionId,toggleBtn){
    const sections = ['vegasSection','bankerSection','junkSection','skinsSection'];
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

  // Note: toggleJunk click handler is in index.js to avoid duplicate listeners

  // =============================================================================
  // EXPOSE TO GLOBAL SCOPE
  // =============================================================================
  
  window.Junk = {
    init: initJunk,
    initAchievements: initJunkAchievements,
    refreshForPlayerChange: refreshJunkForPlayerChange,
    update: updateJunk,
    compute: Junk.compute,
    render: Junk.render,
    clearAllAchievements: clearAllAchievements,
    getAchievementState: getAchievementState,
    setAchievementState: setAchievementState
  };

})();
