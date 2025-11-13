/* Golf Scorecard — 4 players / 18 holes + Vegas & Banker (toggleable)
   - Course Handicap input per player (supports negatives)
   - Net totals with NDB; strokes allocated off the lowest CH (play-off-low)
   - Vegas: teams, multipliers, and opponent-digit flip on birdie+
   - Banker: points-per-match, rotate or until-beaten, multipliers
   - CSV upload (player, ch, h1..h18) + client-side template download
*/

(() => {
  console.log('[golfGames] index.js loaded');
  
  // =============================================================================
  // CONFIGURATION CONSTANTS
  // =============================================================================
  
  // Scorecard configuration
  const HOLES = 18;
  let PLAYERS = 4; // Dynamic: unlimited players
  const MIN_PLAYERS = 1;
  const MAX_PLAYERS = 99; // Effectively unlimited
  const DEFAULT_PLAYERS = 4;
  const LEADING_FIXED_COLS = 2; // Fixed columns: Player Name + Course Handicap
  const NDB_BUFFER = 2; // Net Double Bogey: max penalty is par + buffer + strokes

  // =============================================================================
  // COURSE DATABASE
  // =============================================================================
  // 
  // ★ TO ADD A NEW COURSE:
  // 1. Add an entry with a unique ID (lowercase, no spaces)
  // 2. Provide the course name (displayed in dropdown selector)
  // 3. Add pars array for holes 1-18 (must be exactly 18 values)
  // 4. Add handicap index array (HCP) for holes 1-18 (values 1-18)
  //    • HCP 1 = hardest hole (most strokes given)
  //    • HCP 18 = easiest hole (fewest strokes given)
  // 
  // The course will automatically appear in the dropdown selector.
  const COURSES = {
    'manito': {
      name: 'Manito Country Club',
      pars: [4,4,4,5,3,4,4,3,4, 4,4,3,5,5,4,4,3,4],
      hcpMen: [7,13,11,15,17,1,5,9,3, 10,2,12,14,18,4,6,16,8]
    },    
    'dove': {
      name: 'Dove Canyon Country Club',
      pars: [5,4,4,3,4,4,3,4,5, 3,5,4,3,5,4,4,3,4],
      hcpMen: [11,7,3,15,1,13,17,9,5,14,4,12,16,2,6,10,18,8]
      
    },
    // Add more courses here:
    // 'courseid': {
    //   name: 'Course Name',
    //   pars: [4,4,4,5,3,4,4,3,4, 4,4,3,5,5,4,4,3,4],
    //   hcpMen: [1,2,3,4,5,6,7,8,9, 10,11,12,13,14,15,16,17,18]
    // }
  };

  // Active course data (loaded from selected course)
  let PARS = [...COURSES.manito.pars];
  let HCPMEN = [...COURSES.manito.hcpMen];
  let ACTIVE_COURSE = 'manito';

  // Make PARS and HCPMEN available globally for Skins/Junk modules
  window.PARS = PARS;
  window.HCPMEN = HCPMEN;

  // =============================================================================
  // DOM HELPERS & UTILITIES
  // =============================================================================
  
  /** Query selector shorthand - returns single element */
  const $  = (s, el=document) => el.querySelector(s);
  
  /** Query selector all shorthand - returns array of elements */
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
  
  /** Sum an array of values, treating non-numbers as 0 */
  const sum = a => a.reduce((x,y) => x + (Number(y) || 0), 0);
  
  /** Clamp an integer value between min and max bounds */
  const clampInt = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(+v) ? Math.trunc(+v) : min));

  // =============================================================================
  // SHARED GAME HELPERS
  // =============================================================================
  
  /**
   * Get par value for a specific hole
   * @param {number} hole - Hole number (1-based index)
   * @returns {number} Par value or NaN if not found
   */
  function getParForHole(hole){
    let el = document.querySelector(`#parRow input[data-hole="${hole}"]`);
    if(!el){
      const inputs = document.querySelectorAll('#parRow input');
      el = inputs[hole-1];
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : NaN;
  }

  /**
   * Get score for a player on a specific hole
   * @param {number} playerIdx - Player index (0-based)
   * @param {number} hole - Hole number (1-based)
   * @returns {number} Score value or NaN if not found
   */
  function getScoreForPlayer(playerIdx, hole){
    let el = document.querySelector(`.score-input[data-player="${playerIdx}"][data-hole="${hole}"]`);
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

  /**
   * Get player names from name inputs
   * @returns {string[]} Array of 4 player names (or default "Player N")
   */
  function getPlayerNames(){
    const nameInputs = Array.from(document.querySelectorAll('.name-edit'));
    return [0,1,2,3].map((i)=>{
      const v = nameInputs[i]?.value?.trim();
      return v || `Player ${i+1}`;
    });
  }

  // =============================================================================
  // APP MANAGER - Central coordination for game recalculations
  // =============================================================================
  
  /**
   * Central manager to coordinate recalculations across all game modes
   * Ensures Vegas, Skins, and Junk stay in sync when scores change
   */
  const AppManager = {
    recalcGames(){
      try{ vegas_recalc(); }catch(e){ console.warn('vegas_recalc failed', e); }
      try{ updateSkins?.(); }catch(e){ /* skins may not be open yet */ }
      try{ updateJunk?.(); }catch(e){ /* junk may not be open yet */ }
      try{ window._vegasUpdateDollars?.(); }catch{}
    }
  };
  try{ window.AppManager = AppManager; }catch{}

  const ids = {
    holesHeader:"#holesHeader",parRow:"#parRow",hcpRow:"#hcpRow",totalsRow:"#totalsRow",
    table:"#scorecard",
    resetBtn:"#resetBtn",clearAllBtn:"#clearAllBtn",saveBtn:"#saveBtn",saveStatus:"#saveStatus",

    // Games toggles
    toggleVegas:"#toggleVegas", toggleBanker:"#toggleBanker", toggleSkins:"#toggleSkins", toggleBankerVegas:"#toggleBankerVegas",
    vegasSection:"#vegasSection", bankerSection:"#bankerSection", skinsSection:"#skinsSection", bankerVegasSection:"#bankerVegasSection",

    // Vegas
  vegasTeams:"#vegasTeams", vegasTeamWarning:"#vegasTeamWarning",
  vegasTableBody:"#vegasBody", vegasTotalA:"#vegasTotalA", vegasTotalB:"#vegasTotalB", vegasPtsA:"#vegasPtsA", vegasPtsB:"#vegasPtsB",
  optUseNet:"#optUseNet", optDoubleBirdie:"#optDoubleBirdie", optTripleEagle:"#optTripleEagle",
  vegasPointValue:"#vegasPointValue", vegasDollarA:"#vegasDollarA", vegasDollarB:"#vegasDollarB",

    // Banker (stub only)

    
    // Skins
    skinsCarry:"#skinsCarry", skinsHalf:"#skinsHalf",
    skinsBody:"#skinsBody", skinsPotTot:"#skinsPotTot",
    skinsTotP1:"#skinsTotP1", skinsTotP2:"#skinsTotP2", skinsTotP3:"#skinsTotP3", skinsTotP4:"#skinsTotP4",
    skinsP1:"#skinsP1", skinsP2:"#skinsP2", skinsP3:"#skinsP3", skinsP4:"#skinsP4",
    skinsSummary:"#skinsSummary",
// CSV
    csvInput:"#csvInput", dlTemplateBtn:"#dlTemplateBtn",
  };

  // ---------- Header ----------
  function buildHeader(){
    const header=$(ids.holesHeader);
    for(let h=1;h<=HOLES;h++){ const th=document.createElement("th"); th.textContent=h; header.appendChild(th); }
    ["Out","In","Total","To Par","Net"].forEach(label=>{ const th=document.createElement("th"); th.textContent=label; header.appendChild(th); });
  }

  // =============================================================================
  // COURSE SWITCHING
  // =============================================================================
  
  /**
   * Switch to a different golf course
   * Updates pars, handicaps, and triggers recalculation of all scores
   * @param {string} courseId - Course ID from COURSES database
   */
  function switchCourse(courseId){
    if(!COURSES[courseId]) {
      console.error(`Course ${courseId} not found`);
      return;
    }
    
    ACTIVE_COURSE = courseId;
    PARS = [...COURSES[courseId].pars];
    HCPMEN = [...COURSES[courseId].hcpMen];
    
    // Update global references (for Skins/Junk modules)
    window.PARS = PARS;
    window.HCPMEN = HCPMEN;
    
    // Rebuild par and HCP rows with new values
    updateParAndHcpRows();
    
    // Recalculate all player scores and net values (uses new PARS and HCPMEN for stroke allocation)
    recalcAll();
    
    // Recalculate all game modes (Vegas, Skins, Junk) with new stroke allocations
    AppManager.recalcGames();
    
    // Force refresh of any game-specific UI that might be open
    const skinsSection = document.getElementById('skinsSection');
    if(skinsSection?.classList.contains('open')){
      // Trigger skins recalc if it's open
      if(typeof updateSkins === 'function') updateSkins();
    }
    
    const junkSection = document.getElementById('junkSection');
    if(junkSection?.classList.contains('open')){
      // Trigger junk recalc if it's open
      if(typeof updateJunk === 'function') updateJunk();
    }
    
    // Update stroke highlighting with new HCPMEN
    if(typeof window.updateStrokeHighlights === 'function'){
      window.updateStrokeHighlights();
    }
    
    saveDebounced();
  }

  function updateParAndHcpRows(){
    // Update existing par inputs
    const parInputs = $$('#parRow input');
    const hcpInputs = $$('#hcpRow input');
    
    for(let h=0; h<HOLES && h<parInputs.length; h++){
      parInputs[h].value = PARS[h];
    }
    for(let h=0; h<HOLES && h<hcpInputs.length; h++){
      hcpInputs[h].value = HCPMEN[h];
    }
    
    // Update Out/In/Total for par row
    const parRow = $('#parRow');
    const parCells = Array.from(parRow.cells);
    const parFront = PARS.slice(0,9).reduce((a,b)=>a+b,0);
    const parBack  = PARS.slice(9,18).reduce((a,b)=>a+b,0);
    const parTot = parFront + parBack;
    
    // Out/In/Total are at positions: 2 (name) + 18 holes = 20, 21, 22
    if(parCells[20]) parCells[20].textContent = String(parFront);
    if(parCells[21]) parCells[21].textContent = String(parBack);
    if(parCells[22]) parCells[22].textContent = String(parTot);
    
    updateParBadge();
  }

  // =============================================================================
  // SCORECARD: PAR & HANDICAP ROWS
  // =============================================================================
  
  /**
   * Build and populate Par and Handicap rows (read-only)
   * Par row shows course par for each hole plus front/back/total
   * HCP row shows stroke index (1-18) for each hole
   */
  function buildParAndHcpRows(){
    const parRow=$(ids.parRow), hcpRow=$(ids.hcpRow);
    for(let h=1;h<=HOLES;h++){
      const tdp=document.createElement("td"), ip=document.createElement("input"); ip.type="number"; ip.inputMode="numeric"; ip.value=PARS[h-1]; ip.readOnly=true; ip.tabIndex=-1; tdp.appendChild(ip); 
      if(h === 18) tdp.classList.add('hole-18'); // Add class for styling divider
      parRow.appendChild(tdp);
      const tdh=document.createElement("td"), ih=document.createElement("input"); ih.type="number"; ih.inputMode="numeric"; ih.value=HCPMEN[h-1]; ih.readOnly=true; ih.tabIndex=-1; tdh.appendChild(ih); 
      if(h === 18) tdh.classList.add('hole-18'); // Add class for styling divider
      hcpRow.appendChild(tdh);
    }
    // Append Out / In / Total for course par, then placeholders for To Par / Net
    // Standard golf: Out = front 9, In = back 9
    const parFront = PARS.slice(0,9).reduce((a,b)=>a+b,0);
    const parBack  = PARS.slice(9,18).reduce((a,b)=>a+b,0);
    const parTot = parFront + parBack;
    const outTd=document.createElement("td"); outTd.textContent=String(parFront);
    const inTd =document.createElement("td"); inTd.textContent =String(parBack);
    const totTd=document.createElement("td"); totTd.textContent=String(parTot);
    parRow.append(outTd,inTd,totTd,document.createElement("td"),document.createElement("td"));

    // Keep HCP row aligned with blank cells
    for(let i=0;i<5;i++){ hcpRow.appendChild(document.createElement("td")); }
  }

  // =============================================================================
  // SCORECARD: PLAYER ROWS
  // =============================================================================
  
  /**
   * Build interactive player rows with name, handicap, and score inputs
   * Includes auto-advance functionality and real-time calculation
   */
  function buildPlayerRows(){
    const tbody=$(ids.table).tBodies[0];
    for(let p=0;p<PLAYERS;p++){
      const tr=document.createElement("tr"); tr.className="player-row"; tr.dataset.player=String(p);

      const nameTd=document.createElement("td");
      const nameInput=document.createElement("input"); nameInput.type="text"; nameInput.className="name-edit"; nameInput.placeholder=`Player ${p+1}`; nameInput.autocomplete="off";
      nameInput.addEventListener("input",()=>{ vegas_renderTeamControls(); saveDebounced(); });
      nameTd.appendChild(nameInput); tr.appendChild(nameTd);

      const chTd=document.createElement("td");
      const MIN_HANDICAP = -50;
      const MAX_HANDICAP = 60;
      
      const chInput=document.createElement("input"); 
      chInput.type="number"; 
      chInput.inputMode="numeric"; 
      chInput.className="ch-input"; 
      chInput.placeholder="0"; 
      chInput.min="-20"; 
      chInput.max="54"; 
      chInput.step="1"; 
      chInput.autocomplete="off";
      
      chInput.addEventListener("input", () => { 
        if(chInput.value !== "") {
          chInput.value = clampInt(chInput.value, MIN_HANDICAP, MAX_HANDICAP);
        }
        recalcAll(); 
        AppManager.recalcGames(); 
        saveDebounced(); 
      });
      chTd.appendChild(chInput); tr.appendChild(chTd);

      const MIN_SCORE = 1;
      const MAX_SCORE = 20;
      
      for(let h=1; h<=HOLES; h++){
        const td=document.createElement("td"), inp=document.createElement("input");
        inp.type="number"; 
        inp.inputMode="numeric"; 
        inp.min=String(MIN_SCORE); 
        inp.max=String(MAX_SCORE); 
        inp.className="score-input"; 
        inp.dataset.player=String(p); 
        inp.dataset.hole=String(h); 
        inp.placeholder="—";
        if(h === 18) td.classList.add('hole-18'); // Add class for styling divider
        
        inp.addEventListener("input", () => { 
          if(inp.value !== ""){
            const v = clampInt(inp.value, MIN_SCORE, MAX_SCORE); 
            if(String(v) !== inp.value) {
              inp.classList.add("invalid"); 
            } else {
              inp.classList.remove("invalid"); 
            }
            inp.value = v;
            // Auto-advance: move to next input after score entry
            const currentPlayer = Number(inp.dataset.player);
            const currentHole = Number(inp.dataset.hole);
            
            if(inp.value.length >= 1) {
              let nextInput;
              
              if(currentPlayer < PLAYERS - 1) {
                // Move to next player, same hole
                nextInput = document.querySelector(
                  `.score-input[data-player="${currentPlayer+1}"][data-hole="${currentHole}"]`
                );
              } else if(currentHole < HOLES) {
                // Last player: move to first player, next hole
                nextInput = document.querySelector(
                  `.score-input[data-player="0"][data-hole="${currentHole+1}"]`
                );
              }
              
              if(nextInput) {
                setTimeout(() => nextInput.focus(), 50);
              }
            }
          } else {
            inp.classList.remove("invalid");
          }
          recalcRow(tr); recalcTotalsRow(); AppManager.recalcGames(); saveDebounced(); });
        td.appendChild(inp); tr.appendChild(td);
      }

      const outTd=document.createElement("td"); outTd.className="split";
      const inTd=document.createElement("td"); inTd.className="split";
      const totalTd=document.createElement("td"); totalTd.className="total";
      const toParTd=document.createElement("td"); toParTd.className="to-par";
      const netTd=document.createElement("td"); netTd.className="net";
      tr.append(outTd,inTd,totalTd,toParTd,netTd);

      tbody.appendChild(tr);
    }
  }

  // =============================================================================
  // SCORECARD: TOTALS ROW
  // =============================================================================
  
  /**
   * Build totals row showing sum of all player scores per hole
   */
  function buildTotalsRow(){
    const totalsRow=$(ids.totalsRow);
    for(let h=1;h<=HOLES;h++){
      const td=document.createElement("td"); td.className="subtle"; td.dataset.holeTotal=String(h); td.textContent="—"; 
      if(h === 18) td.classList.add('hole-18'); // Add class for styling divider
      totalsRow.appendChild(td);
    }
    const out=document.createElement("td"), inn=document.createElement("td"), total=document.createElement("td"), blank1=document.createElement("td"), blank2=document.createElement("td");
    out.className="subtle"; inn.className="subtle"; total.className="subtle"; totalsRow.append(out,inn,total,blank1,blank2);
  }

  function updateParBadge(){
    const el = document.getElementById('parBadge'); if(!el) return;
    const parFront = PARS.slice(0,9).reduce((a,b)=>a+b,0);
    const parBack  = PARS.slice(9,18).reduce((a,b)=>a+b,0);
    const parTot = parFront + parBack;
    el.textContent = `Par — Out ${parFront} • In ${parBack} • Total ${parTot}`;
  }

  // =============================================================================
  // HANDICAP & SCORING LOGIC
  // =============================================================================
  // Uses "play off low" system: all handicaps adjusted relative to lowest player
  
  /**
   * Calculate adjusted handicaps using "play off low" system
   * The lowest handicap player gets 0, others get the difference
   * @returns {number[]} Array of 4 adjusted handicaps (minimum is always 0)
   */
  function adjustedCHs(){
    const chs=$$(".player-row").map(r=>{ const v=Number($(".ch-input",r)?.value); return Number.isFinite(v)?v:0; });
    const minCH=Math.min(...chs);
    return chs.map(ch=>ch-minCH); // play off low
  }

  /**
   * Calculate strokes received on a specific hole.
   * @param {number} adjCH - Adjusted course handicap
   * @param {number} holeIdx - Zero-based hole index
   * @returns {number} Number of strokes on this hole
   */
  function strokesOnHole(adjCH, holeIdx){
    if(adjCH<=0) return 0;
    const base=Math.floor(adjCH/18), rem=adjCH%18, holeHcp=HCPMEN[holeIdx];
    return base+(holeHcp<=rem?1:0);
  }

  /**
   * Get gross score for a player on a hole.
   * @param {number} playerIdx - Zero-based player index
   * @param {number} holeIdx - Zero-based hole index
   * @returns {number} Gross score or 0 if not entered
   */
  function getGross(playerIdx, holeIdx){
    return Number($(`input.score-input[data-player="${playerIdx}"][data-hole="${holeIdx+1}"]`)?.value)||0;
  }

  /**
   * Calculate net score with Net Double Bogey (NDB) cap applied.
   * @param {number} playerIdx - Zero-based player index
   * @param {number} holeIdx - Zero-based hole index
   * @returns {number} Net score with NDB cap
   */
  function getNetNDB(playerIdx, holeIdx){
    const adjCH=adjustedCHs()[playerIdx], gross=getGross(playerIdx,holeIdx);
    if(!gross) return 0;
    const sr=strokesOnHole(adjCH,holeIdx), ndb=PARS[holeIdx]+NDB_BUFFER+sr, adjGross=Math.min(gross,ndb);
    return adjGross - sr;
  }

  // =============================================================================
  // ROW CALCULATIONS
  // =============================================================================
  
  /**
   * Get all hole values for a player row
   * @param {HTMLElement} rowEl - Player row element
   * @returns {number[]} Array of 18 scores (0 for empty)
   */
  function getPlayerHoleValues(rowEl){ 
    return $$("input.score-input", rowEl).map(i => Number(i.value) || 0); 
  }

  /**
   * Recalculate totals and net score for a single player row
   * @param {HTMLElement} rowEl - Player row element
   */
  function recalcRow(rowEl){
    const s = getPlayerHoleValues(rowEl);
    // Standard golf: Out = front 9, In = back 9
    const out=sum(s.slice(0,9)), inn=sum(s.slice(9,18)), total=out+inn;
    const splits = rowEl.querySelectorAll("td.split");
    if(splits[0]) splits[0].textContent = out ? String(out) : "—";
    if(splits[1]) splits[1].textContent = inn ? String(inn) : "—";
    $(".total",rowEl)?.replaceChildren(document.createTextNode(total||"—"));

    const parTotal = sum(PARS);
    const delta = (total && parTotal) ? total - parTotal : 0;
    const el = $(".to-par", rowEl);
    
    if(!total){ 
      el.textContent = "—"; 
      el.dataset.sign = ""; 
    } else { 
      const sign = delta === 0 ? "0" : delta > 0 ? "+" : "-"; 
      el.dataset.sign = sign; 
      el.textContent = (delta > 0 ? "+" : "") + delta; 
    }

    // Calculate net score with NDB (Net Double Bogey) cap
    const pIdx = Number(rowEl.dataset.player);
    let netTotal = 0;
    
    for(let h=0; h<HOLES; h++){
      const gross = s[h] || 0; 
      if(!gross) continue;
      
      const sr = strokesOnHole(adjustedCHs()[pIdx], h);
      const ndb = PARS[h] + NDB_BUFFER + sr;
      const adjGross = Math.min(gross, ndb);
      netTotal += adjGross - sr;
    }
    
    $(".net", rowEl).textContent = netTotal ? String(netTotal) : "—";
  }

  function recalcTotalsRow(){
    for(let h=1;h<=HOLES;h++){
      const ph=$$(`input.score-input[data-hole="${h}"]`).map(i=>Number(i.value)||0), t=sum(ph);
      $(`[data-hole-total="${h}"]`).textContent = t? String(t) : "—";
    }
    const tds=$(ids.totalsRow).querySelectorAll("td"), base=LEADING_FIXED_COLS+HOLES;
    const OUT=$$(".player-row").map(r=>{ const s=r.querySelectorAll("td.split"); return Number(s[0]?.textContent)||0; }).reduce((a,b)=>a+b,0);
    const INN=$$(".player-row").map(r=>{ const s=r.querySelectorAll("td.split"); return Number(s[1]?.textContent)||0; }).reduce((a,b)=>a+b,0);
    const TOT=$$(".player-row").map(r=>Number($(".total",r)?.textContent)||0).reduce((a,b)=>a+b,0);
    tds[base+0].textContent=OUT||"—"; tds[base+1].textContent=INN||"—"; tds[base+2].textContent=TOT||"—";
  }
  function recalcAll(){ $$(".player-row").forEach(recalcRow); recalcTotalsRow(); }

  // =============================================================================
  // PERSISTENCE - LocalStorage save/load
  // =============================================================================
  
  const STORAGE_KEY = "golf_scorecard_v5";
  
  /**
   * Save current game state to localStorage
   */
  function saveState(){
    const state = {
      course: ACTIVE_COURSE,
      players: $$(".player-row").map(row => ({
        name: $(".name-edit", row).value || "",
        ch: $(".ch-input", row).value || "",
        scores: $$("input.score-input", row).map(i => i.value)
      })),
      vegas: { 
        teams: vegas_getTeamAssignments(), 
        opts: vegas_getOptions(), 
        open: $(ids.vegasSection).classList.contains("open") 
      },
      banker: { 
        open: $(ids.bankerSection).classList.contains("open") 
      },
      skins: { 
        buyIn: Number(document.getElementById('skinsBuyIn')?.value) || 10, 
        open: $(ids.skinsSection)?.classList.contains("open") 
      },
      savedAt: Date.now(),
    };
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      announce("Saved.");
    } catch(err) {
      console.error('[golfGames] Failed to save state:', err);
      announce("Save failed!");
    }
  }
  let saveTimer = null;
  
  /**
   * Debounced save - waits 300ms after last change before saving
   */
  function saveDebounced(){ 
    clearTimeout(saveTimer); 
    saveTimer = setTimeout(saveState, 300); 
  }
  
  /**
   * Load saved game state from localStorage
   */
  function loadState(){
    const raw = localStorage.getItem(STORAGE_KEY); 
    if(!raw) return;
    
    try{
      const s=JSON.parse(raw);
      
      // Restore course selection
      if(s.course && COURSES[s.course]){
        const courseSelect = $('#courseSelect');
        if(courseSelect) courseSelect.value = s.course;
        if(s.course !== ACTIVE_COURSE){
          switchCourse(s.course);
        }
      }
      
      const rows = $$(".player-row");
      s.players?.forEach((p, i) => { 
        const r = rows[i]; 
        if(!r) return;
        
        $(".name-edit", r).value = p.name || "";
        $(".ch-input", r).value = p.ch ?? "";
        
        const ins = $$("input.score-input", r);
        p.scores?.forEach((v, j) => { 
          if(ins[j]) ins[j].value = v; 
        });
      });
      recalcAll();

      // Restore game states
      vegas_renderTeamControls();
      if(s.vegas?.teams) vegas_setTeamAssignments(s.vegas.teams);
      if(s.vegas?.opts) vegas_setOptions(s.vegas.opts);
      if(s.vegas?.open) games_open("vegas");

      if(s.banker?.open) games_open("banker");

      if(s.skins?.buyIn != null) {
        const buyInEl = document.getElementById('skinsBuyIn');
        if(buyInEl) buyInEl.value = s.skins.buyIn;
      }
      if(s.skins?.open) games_open("skins");

      vegas_recalc();
      
      const savedDate = new Date(s.savedAt || Date.now()).toLocaleString();
      announce(`Restored saved card (${savedDate}).`);
    } catch(err) {
      console.error('[golfGames] Failed to load state:', err);
      announce("Load failed!");
    }
  }

  /**
   * Clear all score inputs only (keep names and handicaps)
   */
  function clearScoresOnly(){ 
    $$("input.score-input").forEach(i => {
      i.value = "";
      i.classList.remove("invalid");
    }); 
    recalcAll(); 
    AppManager.recalcGames(); 
    announce("Scores cleared."); 
  }
  
  /**
   * Clear all fields (names, handicaps, and scores)
   */
  function clearAll(){
    $$(".player-row").forEach(r => { 
      $(".name-edit", r).value = "";
      $(".ch-input", r).value = "";
      $$("input.score-input", r).forEach(i => {
        i.value = "";
        i.classList.remove("invalid");
      });
    });
    recalcAll(); 
    vegas_renderTeamControls(); 
    vegas_recalc(); 
    announce("All fields cleared.");
  }
  
  /**
   * Display a temporary status message to the user
   * @param {string} t - Message text to display
   */
  function announce(t){ 
    const el = $(ids.saveStatus); 
    el.textContent = t; 
    el.style.opacity = "1"; 
    setTimeout(() => {
      el.style.opacity = "0.75";
    }, 1200); 
  }

  // =============================================================================
  // GAMES UI - Toggle game sections (Vegas, Banker, Skins, Junk)
  // =============================================================================
  
  /**
   * Open a game section and make it visible
   * @param {string} which - Game section: 'vegas', 'banker', 'skins', or 'bankervegas'
   */
  function games_open(which){
    if(which==="vegas"){ $(ids.vegasSection).classList.add("open"); $(ids.vegasSection).setAttribute("aria-hidden","false"); $(ids.toggleVegas).classList.add("active"); }
    if(which==="banker"){ $(ids.bankerSection).classList.add("open"); $(ids.bankerSection).setAttribute("aria-hidden","false"); $(ids.toggleBanker).classList.add("active"); }
    if(which==="skins"){ $(ids.skinsSection).classList.add("open"); $(ids.skinsSection).setAttribute("aria-hidden","false"); $(ids.toggleSkins).classList.add("active"); }
    if(which==="bankervegas"){ $(ids.bankerVegasSection).classList.add("open"); $(ids.bankerVegasSection).setAttribute("aria-hidden","false"); $(ids.toggleBankerVegas).classList.add("active"); }
  }
  function games_close(which){
    if(which==="vegas"){ $(ids.vegasSection).classList.remove("open"); $(ids.vegasSection).setAttribute("aria-hidden","true"); $(ids.toggleVegas).classList.remove("active"); }
    if(which==="banker"){ $(ids.bankerSection).classList.remove("open"); $(ids.bankerSection).setAttribute("aria-hidden","true"); $(ids.toggleBanker).classList.remove("active"); }
    if(which==="skins"){ $(ids.skinsSection).classList.remove("open"); $(ids.skinsSection).setAttribute("aria-hidden","true"); $(ids.toggleSkins).classList.remove("active"); }
    if(which==="bankervegas"){ $(ids.bankerVegasSection).classList.remove("open"); $(ids.bankerVegasSection).setAttribute("aria-hidden","true"); $(ids.toggleBankerVegas).classList.remove("active"); }
  }
  function games_toggle(which){
    let sec;
    if(which==="vegas") sec = $(ids.vegasSection);
    else if(which==="banker") sec = $(ids.bankerSection);
    else if(which==="skins") sec = $(ids.skinsSection);
    else if(which==="bankervegas") sec = $(ids.bankerVegasSection);
    const open = sec?.classList.contains("open");
    open? games_close(which) : games_open(which);
    saveDebounced();
  }

  // Theme toggle
(function(){
  const btn = document.getElementById('themeToggle');
  if(!btn) return;

  // Restore persisted theme
  const saved = localStorage.getItem('theme');
  if(saved === 'light'){
    document.documentElement.setAttribute('data-theme','light');
    btn.textContent = '🌙 Dark Mode';
  }

  btn.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if(isLight){
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('theme');
      btn.textContent = '☀️ Light Mode';
    }else{
      document.documentElement.setAttribute('data-theme','light');
      localStorage.setItem('theme','light');
      btn.textContent = '🌙 Dark Mode';
    }
  });
})();

// Force refresh button for PWA
(function(){
  const btn = document.getElementById('forceRefresh');
  if(!btn) return;
  btn.addEventListener('click', async () => {
    // Clear all caches
    if('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
    }
    // Clear service worker cache if available
    if('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({type: 'CLEAR_CACHE'});
    }
    // Force reload with cache bypass using unique URL parameter
    const url = new URL(window.location.href);
    url.searchParams.set('nocache', Date.now());
    window.location.href = url.toString();
  });
})();

// Utilities section toggle
(function(){
  const section = document.getElementById('utilitiesSection');
  const toggleBtn = document.getElementById('utilitiesToggle');
  
  if(!section || !toggleBtn) return;
  
  toggleBtn.addEventListener('click', () => {
    section.classList.toggle('open');
  });
})();

  // =============================================================================
  // VEGAS GAME MODE
  // =============================================================================
  // Team-based golf game: pairs of players form two teams
  // Scores combined into 2-digit numbers (e.g., 4+5 = "45")
  // Lower combined score wins, with multipliers for birdies/eagles
  // Opponent's digits flip on birdie+ (e.g., 45 becomes 54)
  
  /**
   * Vegas game logic module - separates computation from rendering
   */
  const Vegas = {
    /**
     * Compute per-hole and total Vegas results.
     * @param {{A:number[], B:number[]}} teams
     * @param {{useNet:boolean, doubleBirdie:boolean, tripleEagle:boolean, pointValue:number}} opts
     * @returns {{perHole:object[], ptsA:number, ptsB:number, totalA:number, totalB:number, dollarsA:number, dollarsB:number, valid:boolean, rotation:boolean}}
     */
    compute(teams, opts){
      // Check if we're in rotation mode (3 players with ghost)
      const realPlayers = PLAYERS;
      const useRotation = realPlayers === 3;
      
      if(useRotation){
        // Rotation mode: each player rotates playing with ghost (position 3)
        const perHole=[];
        let ptsA=0;
        const ghostPos = 3;
        
        for(let h=0;h<HOLES;h++){
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
          for(let h=0;h<HOLES;h++){ 
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

      for(let h=0;h<HOLES;h++){
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
        for(let h=0;h<HOLES;h++){ 
          team.forEach(p=>{ 
            // Only count real players, not ghosts
            if(p < PLAYERS) {
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
        warn.hidden=false;
        for(let h=0;h<HOLES;h++){
          $(`[data-vegas-a="${h}"]`).textContent="—";
          $(`[data-vegas-b="${h}"]`).textContent="—";
          $(`[data-vegas-m="${h}"]`).textContent="—";
          $(`[data-vegas-p="${h}"]`).textContent="—";
          $(`[data-vegas-pb="${h}"]`).textContent="—";
        }
        $(ids.vegasTotalA).textContent="—"; $(ids.vegasTotalB).textContent="—"; $(ids.vegasPtsA).textContent="—"; $(ids.vegasPtsB).textContent="—";
        if($(ids.vegasDollarA)) $(ids.vegasDollarA).textContent = '—';
        if($(ids.vegasDollarB)) $(ids.vegasDollarB).textContent = '—';
        return;
      }
      warn.hidden=true;

      data.perHole.forEach((hole,h)=>{
        const names=$$(".player-row").map((r,i)=> $(".name-edit",r).value||`Player ${i+1}`);
        
        // In rotation mode, show which player is with ghost
        let vaStr = hole.vaStr;
        if(data.rotation && hole.ghostPartner !== undefined){
          const partnerName = names[hole.ghostPartner] || `P${hole.ghostPartner+1}`;
          vaStr = `${hole.vaStr} (${partnerName}+👻)`;
        }
        
        $(`[data-vegas-a="${h}"]`).textContent=vaStr;
        $(`[data-vegas-b="${h}"]`).textContent=hole.vbStr;
        $(`[data-vegas-m="${h}"]`).textContent=(hole.mult==='—')?'—':String(hole.mult);
        const ptsA = hole.holePtsA;
        $(`[data-vegas-p="${h}"]`).textContent=ptsA? (ptsA>0?`+${ptsA}`:`${ptsA}`) : "—";
        const ptsB = -ptsA;
        $(`[data-vegas-pb="${h}"]`).textContent=ptsB? (ptsB>0?`+${ptsB}`:`${ptsB}`) : "—";
      });

      // Show individual player points in rotation mode
      if(data.rotation && data.playerPoints){
        const names=$$(".player-row").map((r,i)=> $(".name-edit",r).value||`Player ${i+1}`);
        const playerLines = data.playerPoints.map((pts, i) => {
          const sign = pts === 0 ? "" : (pts > 0 ? "+" : "");
          return `${names[i]}: ${sign}${pts}`;
        }).join(" | ");
        
        $(ids.vegasPtsA).textContent = playerLines;
        $(ids.vegasPtsB).textContent = "—";
      } else {
        const ptsA = data.ptsA;
        $(ids.vegasPtsA).textContent = ptsA===0? "0" : (ptsA>0? `+${ptsA}`:`${ptsA}`);
        const ptsB = data.ptsB;
        $(ids.vegasPtsB).textContent = ptsB===0? "0" : (ptsB>0? `+${ptsB}`:`${ptsB}`);
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
        const netLines = data.playerPoints.map((pts, i) => {
          const names=$$(".player-row").map((r,i)=> $(".name-edit",r).value||`Player ${i+1}`);
          const dollars = pts * per;
          return `${names[i]}: ${fmt(dollars)}`;
        }).join(" | ");
        
        $(ids.vegasDollarA).textContent = netLines;
        $(ids.vegasDollarB).textContent = "—";
        
        // Show game breakdown
        const breakdownRow = document.getElementById('vegasGameBreakdown');
        const breakdownData = document.getElementById('vegasGameBreakdownData');
        if(breakdownRow && breakdownData && data.gameResults){
          breakdownRow.style.display = '';
          const names=$$(".player-row").map((r,i)=> $(".name-edit",r).value||`Player ${i+1}`);
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
        if($(ids.vegasDollarA)) $(ids.vegasDollarA).textContent = fmt(data.dollarsA);
        if($(ids.vegasDollarB)) $(ids.vegasDollarB).textContent = fmt(data.dollarsB);
        
        // Hide game breakdown in non-rotation mode
        const breakdownRow = document.getElementById('vegasGameBreakdown');
        if(breakdownRow) breakdownRow.style.display = 'none';
      }

      $(ids.vegasTotalA).textContent=data.totalA||"—";
      $(ids.vegasTotalB).textContent=data.totalB||"—";
    },
    // Internal helpers
    _teamPair(players, holeIdx, useNet) {
      const vals = players.map(p => {
        // Check if this is a ghost (position >= PLAYERS)
        if(p >= PLAYERS) {
          // In rotation mode (3 players), ghost is always active
          if(PLAYERS === 3) {
            return PARS[holeIdx]; // Ghost shoots par
          }
          // Otherwise check if checkbox is enabled
          const ghostCheck = document.getElementById(`vegasGhost_${p}`);
          if(ghostCheck && ghostCheck.checked) {
            return PARS[holeIdx]; // Ghost shoots par
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
        if(p >= PLAYERS) {
          // In rotation mode (3 players), ghost is always active
          if(PLAYERS === 3) {
            return PARS[h]; // Ghost shoots par (never birdie/eagle)
          }
          const ghostCheck = document.getElementById(`vegasGhost_${p}`);
          if(ghostCheck && ghostCheck.checked) {
            return PARS[h]; // Ghost shoots par (never birdie/eagle)
          }
          return Infinity;
        }
        return (useNet?getNetNDB(p,h):getGross(p,h))||Infinity;
      }));
      if(!Number.isFinite(best)) return {birdie:false,eagle:false};
      const toPar=best-PARS[h]; return {birdie:toPar<=-1, eagle:toPar<=-2};
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
    const names=$$(".player-row").map((r,i)=> $(".name-edit",r).value||`Player ${i+1}`);
    
    // Vegas supports exactly 4 positions (players or ghosts)
    const maxPositions = 4;
    const realPlayers = Math.min(PLAYERS, maxPositions);
    const needsGhosts = PLAYERS < maxPositions;
    const useRotation = PLAYERS === 3;
    
    console.log('[Vegas] renderTeamControls - PLAYERS:', PLAYERS, 'useRotation:', useRotation);
    
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
      if(i >= PLAYERS) {
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

  // ======================================================================
  // =============================== BANKER (removed/stubbed) ===============================
  // ======================================================================
  // Lightweight module to separate Banker compute from render
  // All Banker logic removed; section remains as empty stub.

  // =============================================================================
  // CSV IMPORT/EXPORT
  // =============================================================================
  // Import scorecard data from CSV files
  // Export template CSV for easy data entry
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field.trim()); field = ""; }
        else if (c === '\n' || c === '\r') {
          if (field.length || row.length) { row.push(field.trim()); rows.push(row); row = []; field = ""; }
          if (c === '\r' && text[i + 1] === '\n') i++;
        } else field += c;
      }
    }
    if (field.length || row.length) { row.push(field.trim()); rows.push(row); }
    return rows.filter(r => r.length && r.some(x => x !== ""));
  }
  function normalizeHeader(h) { return (h || "").toLowerCase().replace(/\s+/g, ""); }
  function rowToPlayerObj(headerMap, row) {
    const get = (name) => { const idx = headerMap[name]; if (idx == null) return undefined; return row[idx]; };
    const obj = { player: get("player") || "", ch: get("ch") != null && get("ch") !== "" ? Number(get("ch")) : "", holes: [] };
    for (let i = 1; i <= 18; i++) {
      const key = `h${i}`; const val = get(key);
      obj.holes.push(val != null && val !== "" ? Number(val) : "");
    }
    return obj;
  }
  async function handleCSVFile(file) {
    const text = await file.text();
    const data = parseCSV(text);
    if (!data.length) { alert("CSV appears empty."); return; }

    const header = data[0].map(normalizeHeader);
    const hmap = {}; header.forEach((h,i)=>{ hmap[h]=i; });

    const required = ["player","ch", ...Array.from({length:18},(_,i)=>`h${i+1}`)];
    const missing = required.filter(k => !(k in hmap));
    if (missing.length) { alert("CSV is missing columns: " + missing.join(", ")); return; }

    const rows = data.slice(1).filter(r => r.some(x => x && x !== "")).slice(0, 4);
    if (!rows.length) { alert("No data rows found under the header."); return; }

    const playerRows = document.querySelectorAll(".player-row");
    rows.forEach((r, idx) => {
      const obj = rowToPlayerObj(hmap, r);
      const rowEl = playerRows[idx]; if (!rowEl) return;
      const nameInput = rowEl.querySelector(".name-edit"); nameInput.value = obj.player || `Player ${idx+1}`;
      const chInput = rowEl.querySelector(".ch-input"); chInput.value = (obj.ch === 0 || Number.isFinite(obj.ch)) ? String(obj.ch) : "";
      const inputs = rowEl.querySelectorAll("input.score-input");
      for (let i = 0; i < 18; i++) { const v = obj.holes[i];
        inputs[i].value = (v === "" || isNaN(v)) ? "" : String(Math.max(1, Math.min(20, Math.trunc(v))));
        inputs[i].classList.remove("invalid");
      }
    });
    for (let i = rows.length; i < 4; i++) {
      const rowEl = playerRows[i]; if (!rowEl) continue;
      rowEl.querySelector(".name-edit").value = "";
      rowEl.querySelector(".ch-input").value = "";
      rowEl.querySelectorAll("input.score-input").forEach(inp => { inp.value = ""; inp.classList.remove("invalid"); });
    }

    recalcAll(); AppManager.recalcGames(); saveState();
    announce("CSV imported.");
  }
  function downloadCSVTemplate() {
    const headers = ["player","ch", ...Array.from({length:18},(_,i)=>`h${i+1}`)];
    const rows = [
      ["Daniel",-1,4,3,4,3,2,4,4,2,4, 4,3,2,5,4,4,3,2,4],
      ["Rob",2,   5,4,5,4,3,5,4,3,5, 5,4,3,5,6,5,4,3,5],
      ["John",4,  4,5,6,5,4,6,5,4,5, 4,5,4,6,7,5,5,4,5],
      ["Alex",7,  3,4,4,5,3,5,4,3,4, 3,4,3,4,5,4,4,3,4],
    ];
    let csv = headers.join(",") + "\n" + rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "scorecard_template.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }

  // =============================================================================
  // PLAYER MANAGEMENT (ADD/REMOVE)
  // =============================================================================
  
  /**
   * Add a new player row to the scorecard
   */
  function addPlayer() {
    if(PLAYERS >= MAX_PLAYERS) {
      announce(`Maximum ${MAX_PLAYERS} players allowed.`);
      return;
    }
    
    const tbody = $('#scorecard').tBodies[0];
    const p = PLAYERS; // Current player index
    
    // Create new player row (same structure as buildPlayerRows)
    const tr = document.createElement("tr");
    tr.className = "player-row";
    tr.dataset.player = String(p);
    
    // Name input
    const nameTd = document.createElement("td");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "name-edit";
    nameInput.placeholder = `Player ${p+1}`;
    nameInput.autocomplete = "off";
    nameInput.addEventListener("input", () => {
      vegas_renderTeamControls();
      saveDebounced();
    });
    nameTd.appendChild(nameInput);
    tr.appendChild(nameTd);
    
    // Course Handicap input
    const chTd = document.createElement("td");
    const MIN_HANDICAP = -50;
    const MAX_HANDICAP = 60;
    const chInput = document.createElement("input");
    chInput.type = "number";
    chInput.inputMode = "numeric";
    chInput.className = "ch-input";
    chInput.placeholder = "0";
    chInput.min = "-20";
    chInput.max = "54";
    chInput.step = "1";
    chInput.autocomplete = "off";
    chInput.addEventListener("input", () => {
      if(chInput.value !== "") {
        chInput.value = clampInt(chInput.value, MIN_HANDICAP, MAX_HANDICAP);
      }
      recalcAll();
      AppManager.recalcGames();
      saveDebounced();
    });
    chTd.appendChild(chInput);
    tr.appendChild(chTd);
    
    // Score inputs for each hole
    const MIN_SCORE = 1;
    const MAX_SCORE = 20;
    for(let h=1; h<=HOLES; h++) {
      const td = document.createElement("td");
      const inp = document.createElement("input");
      inp.type = "number";
      inp.inputMode = "numeric";
      inp.min = String(MIN_SCORE);
      inp.max = String(MAX_SCORE);
      inp.className = "score-input";
      inp.dataset.player = String(p);
      inp.dataset.hole = String(h);
      inp.placeholder = "—";
      if(h === 18) td.classList.add('hole-18');
      
      inp.addEventListener("input", () => {
        if(inp.value !== "") {
          const v = clampInt(inp.value, MIN_SCORE, MAX_SCORE);
          if(String(v) !== inp.value) {
            inp.classList.add("invalid");
          } else {
            inp.classList.remove("invalid");
          }
          inp.value = v;
          
          // Auto-advance logic
          const currentPlayer = Number(inp.dataset.player);
          const currentHole = Number(inp.dataset.hole);
          
          if(inp.value.length >= 1) {
            let nextInput;
            if(currentPlayer < PLAYERS - 1) {
              nextInput = document.querySelector(
                `.score-input[data-player="${currentPlayer + 1}"][data-hole="${currentHole}"]`
              );
            } else if(currentHole < HOLES) {
              nextInput = document.querySelector(
                `.score-input[data-player="0"][data-hole="${currentHole + 1}"]`
              );
            }
            if(nextInput) {
              setTimeout(() => nextInput.focus(), 50);
            }
          }
        } else {
          inp.classList.remove("invalid");
        }
        recalcRow(tr);
        recalcTotalsRow();
        AppManager.recalcGames();
        saveDebounced();
      });
      
      td.appendChild(inp);
      tr.appendChild(td);
    }
    
    // Summary cells: Out, In, Total, To Par, Net
    const outTd = document.createElement("td");
    outTd.className = "split";
    const inTd = document.createElement("td");
    inTd.className = "split";
    const totalTd = document.createElement("td");
    totalTd.className = "total";
    const toParTd = document.createElement("td");
    toParTd.className = "to-par";
    const netTd = document.createElement("td");
    netTd.className = "net";
    tr.append(outTd, inTd, totalTd, toParTd, netTd);
    
    tbody.appendChild(tr);
    
    // Increment player count
    PLAYERS++;
    
    console.log('[addPlayer] PLAYERS after increment:', PLAYERS);
    
    // Update display immediately
    updatePlayerCountDisplay();
    
    // Recalculate everything immediately and again after DOM update
    recalculateEverything();
    setTimeout(() => {
      recalculateEverything();
      updatePlayerCountDisplay();
    }, 100);
    
    saveDebounced();
    announce(`Player ${PLAYERS} added.`);
  }
  
  /**
   * Remove the last player row from the scorecard
   * First clears all data, then removes the row
   */
  function removePlayer() {
    if(PLAYERS <= MIN_PLAYERS) {
      announce(`Minimum ${MIN_PLAYERS} player required.`);
      return;
    }
    
    const rows = $$(".player-row");
    const lastRow = rows[rows.length - 1];
    
    if(lastRow) {
      // First, clear all data in the row
      const nameInput = $(".name-edit", lastRow);
      const chInput = $(".ch-input", lastRow);
      const scoreInputs = $$("input.score-input", lastRow);
      
      if(nameInput) nameInput.value = '';
      if(chInput) chInput.value = '';
      scoreInputs.forEach(inp => inp.value = '');
      
      // Recalculate to update totals without this player's data
      recalcRow(lastRow);
      recalcTotalsRow();
      AppManager.recalcGames();
      
      // Now remove the row
      lastRow.remove();
      PLAYERS--;
      
      console.log('[removePlayer] PLAYERS after decrement:', PLAYERS);
      
      // Update display immediately
      updatePlayerCountDisplay();
      
      // Recalculate everything immediately and again after DOM update
      recalculateEverything();
      setTimeout(() => {
        recalculateEverything();
        updatePlayerCountDisplay();
      }, 100);
      
      saveDebounced();
      announce(`Player removed. ${PLAYERS} player${PLAYERS === 1 ? '' : 's'} remaining.`);
    }
  }
  
  /**
   * Update the player count display text
   */
  function updatePlayerCountDisplay() {
    const display = document.getElementById('playerCountDisplay');
    if(display) {
      display.textContent = `${PLAYERS} player${PLAYERS === 1 ? '' : 's'}`;
    }
  }

  /**
   * Recalculate everything - all totals, games, and UI
   */
  function recalculateEverything() {
    recalcTotalsRow();
    vegas_renderTeamControls();
    // Small delay to ensure Vegas team controls are rendered before recalc
    setTimeout(() => {
      AppManager.recalcGames();
      if(typeof refreshSkinsForPlayerChange === 'function') refreshSkinsForPlayerChange();
      if(window.refreshJunkForPlayerChange) window.refreshJunkForPlayerChange();
    }, 0);
  }

  // =============================================================================
  // INITIALIZATION & EVENT WIRING
  // =============================================================================
  
  /**
   * Initialize the application:
   * - Build scorecard structure
   * - Wire up all event listeners
   * - Load saved state from localStorage
   */
  function init(){
    console.log('[golfGames] init start');
    buildHeader(); buildParAndHcpRows(); buildPlayerRows(); buildTotalsRow(); updateParBadge();

  $(ids.resetBtn).addEventListener("click", () => { console.log('[golfGames] Reset clicked'); clearScoresOnly(); });
  $(ids.clearAllBtn).addEventListener("click", () => { console.log('[golfGames] Clear all clicked'); clearAll(); });
  $(ids.saveBtn).addEventListener("click", () => { console.log('[golfGames] Save clicked'); saveState(); });
  
  // Refresh All button - recalculates everything
  document.getElementById('refreshAllBtn')?.addEventListener("click", () => {
    console.log('[golfGames] Refresh All clicked');
    recalculateEverything();
    announce('All games refreshed');
  });

  // Course selector - populate options and wire up
    const courseSelect = $('#courseSelect');
    if(courseSelect){
      // Clear existing options and populate from COURSES
      courseSelect.innerHTML = '';
      Object.keys(COURSES).forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = COURSES[id].name;
        if(id === ACTIVE_COURSE) option.selected = true;
        courseSelect.appendChild(option);
      });
      
      courseSelect.addEventListener("change", (e) => {
        switchCourse(e.target.value);
      });
    }

    // Games: open/close
    $(ids.toggleVegas).addEventListener("click", ()=>games_toggle("vegas"));
    $(ids.toggleBanker).addEventListener("click", ()=>games_toggle("banker"));
    $(ids.toggleBankerVegas).addEventListener("click", ()=>games_toggle("bankervegas"));

    // Vegas UI + wiring
    vegas_renderTeamControls();
    vegas_renderTable();
  $(ids.optUseNet).addEventListener("change", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  $(ids.optDoubleBirdie).addEventListener("change", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  $(ids.optTripleEagle).addEventListener("change", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  $(ids.vegasPointValue)?.addEventListener("input", ()=>{ AppManager.recalcGames(); saveDebounced(); });

    // Banker: no UI wiring (stub only)

    // CSV upload & template
    const csvInput = $(ids.csvInput);
    if (csvInput) csvInput.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleCSVFile(f);
      e.target.value = ""; // allow re-upload same file
    });
    const dlBtn = $(ids.dlTemplateBtn);
    if (dlBtn) dlBtn.addEventListener("click", downloadCSVTemplate);

    // Player management buttons
    const addPlayerBtn = document.getElementById('addPlayerBtn');
    const removePlayerBtn = document.getElementById('removePlayerBtn');
    if (addPlayerBtn) addPlayerBtn.addEventListener("click", addPlayer);
    if (removePlayerBtn) removePlayerBtn.addEventListener("click", removePlayer);
    
    updatePlayerCountDisplay();

    recalcAll(); AppManager.recalcGames(); loadState();
  }

  function vegas_renderTable(){ const body=$(ids.vegasTableBody); body.innerHTML=""; for(let h=0;h<HOLES;h++){ const tr=document.createElement("tr"); tr.innerHTML=`<td>${h+1}</td><td data-vegas-a="${h}">—</td><td data-vegas-b="${h}">—</td><td data-vegas-m="${h}">—</td><td data-vegas-p="${h}">—</td><td data-vegas-pb="${h}">—</td>`; body.appendChild(tr);} }

  document.addEventListener("DOMContentLoaded", init);


// =============================================================================
// SKINS GAME MODE
// =============================================================================
// Net-score competition: lowest net score on each hole wins a "skin"
// Tied holes carry forward (pot increases)
// Supports half-pops mode (0.5 strokes instead of 1)
// 
// Lightweight module to separate computation from rendering for maintainability.
const Skins = {
  /**
   * Compute skins outcome for all holes and players.
   * @param {{carry:boolean, half:boolean, buyIn:number}} opts
   * @returns {{totals:number[], holesWon:string[][], winnings:number[], pot:number, totalSkins:number, activePlayers:number}}
   */
  compute(opts){
    const { carry, half, buyIn } = opts;
    const playerCount = PLAYERS;
    const totals = Array(playerCount).fill(0);
    const holesWon = Array(playerCount).fill(null).map(() => []);
    let pot=1;

    for(let h=0; h<HOLES; h++){
      const nets = Array.from({length: playerCount}, (_, p) => getNetForSkins(p, h, half));
      const filled = nets.map((n,p)=>({n,p})).filter(x=>x.n>0);
      if(filled.length<2){ if(carry) pot++; continue; }
      const min = Math.min(...filled.map(x=>x.n));
      const winners = filled.filter(x=>x.n===min).map(x=>x.p);
      if(winners.length!==1){ if(carry) pot++; continue; }
      const w = winners[0];
      totals[w] += pot;
      holesWon[w].push(String(h+1));
      pot = 1;
    }

    // Count active players (those with at least one score)
    const activePlayers = Array.from({length: playerCount}, (_, p) => p).filter(p => {
      for(let h=0; h<HOLES; h++){
        if(getGross(p,h) > 0) return true;
      }
      return false;
    }).length;

    // Calculate dollar winnings
    const totalSkins = totals.reduce((sum, t) => sum + t, 0);
    const moneyPot = buyIn * activePlayers;
    const winnings = totals.map(skinCount => {
      if(totalSkins === 0) return 0;
      return (skinCount / totalSkins) * moneyPot;
    });

    return { totals, holesWon, winnings, pot: moneyPot, totalSkins, activePlayers };
  },
  /**
   * Render computed skins results into the DOM.
   * @param {{totals:number[], holesWon:string[][], winnings:number[]}} data
   */
  render(data){
    const { totals, holesWon, winnings } = data;
    const playerCount = totals.length;
    for(let p=0; p<playerCount; p++){
      const holesCell = document.getElementById('skinsHoles'+p);
      const totCell   = document.getElementById('skinsTotal'+p);
      const winCell   = document.getElementById('skinsWinnings'+p);
      if(holesCell) holesCell.textContent = (holesWon[p]||[]).join(', ');
      if(totCell)   totCell.textContent = String(totals[p]||0);
      if(winCell) {
        const amount = winnings[p] || 0;
        winCell.textContent = amount > 0 ? `$${amount.toFixed(2)}` : '—';
      }
    }
  }
};
function strokesOnHoleHalfAware(adjCH, i, half){
  const holeHcp=HCPMEN[i];
  
  // Handle plus handicaps (negative adjCH means player gives strokes)
  if(adjCH < 0) {
    const absAdj = Math.abs(adjCH);
    const base=Math.floor(absAdj/18), rem=absAdj%18;
    const fullStrokes = base+(holeHcp<=rem?1:0);
    // Half pops: give 0.5 strokes instead of 1
    return half ? -(fullStrokes * 0.5) : -fullStrokes;
  }
  
  if(adjCH === 0) return 0;
  
  // Calculate full strokes normally
  const base=Math.floor(adjCH/18), rem=adjCH%18;
  const fullStrokes = base+(holeHcp<=rem?1:0);
  
  // Half pops: get 0.5 strokes instead of 1
  return half ? (fullStrokes * 0.5) : fullStrokes;
}
/**
 * Calculate net score for Skins game with optional half-pops.
 * @param {number} playerIdx - Zero-based player index
 * @param {number} holeIdx - Zero-based hole index
 * @param {boolean} half - Whether half-pops mode is enabled
 * @returns {number} Net score with NDB cap
 */
function getNetForSkins(playerIdx, holeIdx, half){
  const adjCHsArr = adjustedCHs();
  const gross = getGross(playerIdx, holeIdx);
  if(!gross) return 0;
  const adj = adjCHsArr[playerIdx];
  // For plus handicaps (negative adj), player gives strokes
  // In half pops, they should still give the same strokes (no half logic for plus)
  const sr = strokesOnHoleHalfAware(adj, holeIdx, half);
  const ndb = PARS[holeIdx] + NDB_BUFFER + sr;
  const adjGross = Math.min(gross, ndb);
  return adjGross - sr;
}


function buildSkinsTable(){
  const body = document.getElementById('skinsBody');
  if(!body) return;
  // Always rebuild to match current player count
  body.innerHTML = '';
  body.dataset.simple = '';
  
  const playerCount = PLAYERS;
  for(let p=0; p<playerCount; p++){
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.id = 'skinsName'+p; th.textContent = 'P'+(p+1);
    const tdH = document.createElement('td'); tdH.id = 'skinsHoles'+p;
    const tdT = document.createElement('td'); tdT.id = 'skinsTotal'+p; tdT.textContent='0';
    const tdW = document.createElement('td'); tdW.id = 'skinsWinnings'+p; tdW.textContent='—';
    tr.append(th, tdH, tdT, tdW);
    body.appendChild(tr);
  }
  body.dataset.simple = '1';
}

/**
 * Refresh Skins table when player count changes
 */
function refreshSkinsForPlayerChange(){
  const skinsSection = document.getElementById('skinsSection');
  if(skinsSection && skinsSection.classList.contains('open')){
    buildSkinsTable();
    refreshSkinsHeaderNames();
    updateSkins();
  }
}
function refreshSkinsHeaderNames(){
  const names = Array.from(document.querySelectorAll('.player-row .name-edit'))
    .map((i,idx)=> i.value.trim()||i.placeholder||i.dataset.default||`P${idx+1}`);
  names.forEach((n,idx)=>{ const el=document.getElementById('skinsName'+idx); if(el) el.textContent=n; });
}
function updateSkins(){
  const carry = document.getElementById('skinsCarry')?.checked ?? true;
  const half  = document.getElementById('skinsHalf')?.checked ?? false;
  const buyIn = Math.max(0, Number(document.getElementById('skinsBuyIn')?.value) || 0);
  const data = Skins.compute({carry, half, buyIn});
  Skins.render(data);
}
function initSkins(){
  buildSkinsTable();
  refreshSkinsHeaderNames();
  updateSkins();

  // Recompute on option change
  document.getElementById('skinsCarry')?.addEventListener('change', updateSkins);
  document.getElementById('skinsHalf')?.addEventListener('change', updateSkins);
  document.getElementById('skinsBuyIn')?.addEventListener('input', ()=>{ updateSkins(); saveDebounced(); });

  // Recompute on any score/par/ch input
  document.addEventListener('input', (e)=>{
  const t=e.target; if(!(t instanceof HTMLElement)) return;
  if(t.classList?.contains('score-input') || t.classList?.contains('ch-input') || t.closest('#scorecard')){
    updateSkins();
  }
  if(t.classList?.contains('name-edit')){ refreshSkinsHeaderNames(); }
}, {passive:true});
}

// Open/close: when Skins tab is toggled, ensure table exists and render now
document.getElementById('toggleSkins')?.addEventListener('click', ()=> { const sec = document.getElementById('skinsSection'); const open = !sec.classList.contains('open'); sec.classList.toggle('open', open); sec.setAttribute('aria-hidden', open ? 'false' : 'true'); document.getElementById('toggleSkins')?.classList.toggle('active', open); if(open){
  setTimeout(()=>{ initSkins(); }, 0);}
});

document.addEventListener('DOMContentLoaded', ()=>{
  // Initialize if section already visible (e.g., state restored)
  if(document.getElementById('skinsSection')?.classList.contains('open')){
    initSkins();
  }
});

})();


// =============================================================================
// JUNK (DOTS) GAME MODE
// =============================================================================
// Points-based game: earn dots for good scores
// • Eagle or better: 4 dots
// • Birdie: 2 dots
// • Par: 1 dot
// • Bogey or worse: 0 dots
// 
// Includes achievements system (Hogan, Sandy, Sadaam, Pulley, Triple)
(function(){
  const HOLES = 18; // adjust if you support 9/27/etc.

  // --- Helpers to read from the existing scorecard ---
  function getPar(hole){
    let el = document.querySelector(`#parRow input[data-hole="${hole}"]`);
    if(!el){
      const inputs = document.querySelectorAll('#parRow input');
      el = inputs[hole-1];
    }
    const v = el ? parseInt(el.value, 10) : NaN;
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

  function dotsFor(score, par){
    if(!Number.isFinite(score) || !Number.isFinite(par)) return 0;
    const diff = score - par;
    if(diff <= -2) return 4; // eagle or better
    if(diff === -1) return 2; // birdie
    if(diff === 0)  return 1; // par
    return 0; // bogey or worse
  }

  // Lightweight module to separate compute from render for Junk (Dots)
  const Junk = {
    /**
     * Compute base dots per hole and totals for 4 players.
     * @returns {{perHole:number[][], totals:number[]}}
     */
    compute(){
      const playerCount = document.querySelectorAll('.name-edit').length;
      const perHole = Array.from({length: HOLES}, ()=> Array(playerCount).fill(0));
      const totals = Array(playerCount).fill(0);
      for(let h=1; h<=HOLES; h++){
        const par = getPar(h);
        for(let p=0; p<playerCount; p++){
          const score = getScore(p, h);
          const d = dotsFor(score, par);
          perHole[h-1][p] = Number.isFinite(d) ? d : 0;
          totals[p] += Number.isFinite(d) ? d : 0;
        }
      }
      return { perHole, totals };
    },
    /**
     * Render per-hole dots and totals into the DOM.
     * Note: Achievements enhancement (weighted dots) may overlay this view.
     * @param {{perHole:number[][], totals:number[]}} data
     */
    render(data){
      const { perHole, totals } = data;
      const playerCount = totals.length;
      // Cells: if Achievements UI present, only update the inner .junk-dot to avoid destroying wrappers.
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
      // Totals: if achievements are active, let that system own totals (base + bonuses), otherwise render base totals.
      const achActive = !!document.querySelector('details.junk-dd');
      if(!achActive){
        for(let p=0; p<playerCount; p++){
          const el = document.getElementById(`junkTotP${p+1}`);
          if(el) el.textContent = Number.isFinite(totals[p]) ? totals[p] : '—';
        }
      }
    }
  };

  function buildJunkTable(){
    const tbody = document.getElementById('junkBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    const playerCount = document.querySelectorAll('.name-edit').length;
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
    const playerCount = document.querySelectorAll('.name-edit').length;
    for(let i=0; i<playerCount; i++){
      const el = document.getElementById(`junkP${i+1}`);
      if(el) el.textContent = names[i] || `P${i+1}`;
    }
  }

  function updateJunk(){
    const tbody = document.getElementById('junkBody');
    if(!tbody) return;
    const data = Junk.compute();
    Junk.render(data);
  }

  /**
   * Rebuild Junk table header and footer with current player count
   */
  function rebuildJunkTableHeader(){
    const thead = document.querySelector('#junkTable thead tr');
    if(thead){
      // Clear existing headers except first (Hole)
      while(thead.children.length > 1) {
        thead.removeChild(thead.lastChild);
      }
      
      // Add player headers
      const playerCount = document.querySelectorAll('.name-edit').length;
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
      const playerCount = document.querySelectorAll('.name-edit').length;
      
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
      
      // Net Totals row
      const netRow = document.createElement('tr');
      const netLabel = document.createElement('td');
      netLabel.innerHTML = '<strong>Net Totals</strong>';
      netRow.appendChild(netLabel);
      for(let p=0; p<playerCount; p++){
        const td = document.createElement('td');
        td.id = `junkNetP${p+1}`;
        td.textContent = '—';
        netRow.appendChild(td);
      }
      tfoot.appendChild(netRow);
    }
  }

  /**
   * Refresh Junk table when player count changes
   */
  function refreshJunkForPlayerChange(){
    const junkSection = document.getElementById('junkSection');
    if(junkSection && junkSection.classList.contains('open')){
      rebuildJunkTableHeader();
      buildJunkTable();
      refreshJunkHeaderNames();
      updateJunk();
      // Reinitialize achievements UI after rebuilding table
      if(window.initJunkAchievements){
        setTimeout(() => window.initJunkAchievements(), 0);
      }
    }
  }
  
  // Expose to global scope so it can be called from player management
  window.refreshJunkForPlayerChange = refreshJunkForPlayerChange;

  function toggleGame(sectionId, toggleBtn){
    const sections = ['vegasSection','bankerSection','junkSection','skinsSection'];
    sections.forEach(id=>{
      const sec = document.getElementById(id);
      if(!sec) return;
      const open = (id === sectionId) ? !sec.classList.contains('open') : false;
      sec.classList.toggle('open', open);
      sec.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
    const buttons = ['toggleVegas','toggleBanker','toggleJunk','toggleSkins'];
    buttons.forEach(bid=>{
      const b = document.getElementById(bid);
      b && b.classList.toggle('active', bid === toggleBtn && document.getElementById(sectionId)?.classList.contains('open'));
    });
  }

  function initJunk(){
    rebuildJunkTableHeader();
    buildJunkTable();
    refreshJunkHeaderNames();
    updateJunk();

    document.addEventListener('input', (e)=>{
      const t = e.target;
      if(t.classList?.contains('score-input') || t.closest('#parRow') || t.classList?.contains('name-edit')){
        if(t.classList?.contains('name-edit')) refreshJunkHeaderNames();
        updateJunk();
      }
    }, { passive: true });
  }

  
  document.getElementById('toggleSkins')?.addEventListener('click', ()=>{
    initSkins();
    toggleGame('skinsSection','toggleSkins');
  });
document.getElementById('toggleJunk')?.addEventListener('click', ()=>{
    initJunk();
    toggleGame('junkSection','toggleJunk');
  });




})();


// =============================================================================
// JUNK ACHIEVEMENTS ENHANCEMENT
// =============================================================================
// Weighted bonus achievements:
// • Hogan: +1 point
// • Sandy: +1 point
// • Sadaam: +1 point
// • Pulley: +1 point
// • Triple: +3 points
// 
// Each hole can have multiple achievements for bonus scoring
(function(){
  // Each achievement has an id, label, and point value.
  // You can change pts to 2 for any of these if needed.
  const ACH = [
    { id: "hogan",  label: "Hogan",  pts: 1 },
    { id: "sandy",  label: "Sandy",  pts: 1 },
    { id: "sadaam", label: "Sadaam", pts: 1 },
    { id: "pulley", label: "Pulley", pts: 1 },
    { id: "triple", label: "Triple", pts: 3 }, // NEW: 3-point dot
  ];

  // Try to detect number of players from Junk header
  function getPlayerCount(){
    const head = document.querySelector('#junkTable thead tr');
    if(!head) return 4;
    return Math.max(0, head.children.length - 1); // minus "Hole"
  }

  // Base dots logic
  function getPar(hole){
    let el = document.querySelector(`#parRow input[data-hole="${hole}"]`);
    if(!el){
      const inputs = document.querySelectorAll('#parRow input');
      el = inputs[hole-1];
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : NaN;
  }
  
  function getScore(playerIdx, hole){
    let el = document.querySelector(`.score-input[data-player="${playerIdx}"][data-hole="${hole}"]`);
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
  
  /** Calculate base dots for a score relative to par */
  function baseDots(score, par){
    if(!Number.isFinite(score) || !Number.isFinite(par)) return 0;
    const diff = score - par;
    if(diff <= -2) return 4; // Eagle or better
    if(diff === -1) return 2; // Birdie
    if(diff === 0)  return 1; // Par
    return 0; // Bogey or worse
  }

  // Enhance existing Junk cells: wrap number + add <details> menu with weighted items
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
          cb.dataset.pts    = String(pts); // <= weight used in totals
          // restore if previously stored on the TD
          cb.checked = td.dataset[id] === '1';
          cb.addEventListener('change', ()=>{
            td.dataset[id] = cb.checked ? '1' : '';
            updateJunkTotalsWeighted();
          });
          lab.appendChild(cb);
          lab.append(` ${label} (+${pts})`);
          menu.appendChild(lab);
        });

        details.appendChild(summary);
        details.appendChild(menu);
        wrap.appendChild(dotSpan);
        wrap.appendChild(details);
        td.appendChild(wrap);
      }
    });
  }

  // Sum weighted achievements for a player/hole
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
        const base  = baseDots(score, par);
        const bonus = achPoints(p, h); // weighted (+1/+2/+3)
        const total = base + bonus;
        totals[p] += total;
        const span = tr.querySelector(`.junk-dot[data-player="${p}"][data-hole="${h}"]`);
        if(span) span.textContent = Number.isFinite(total) ? String(total) : '—';
      }
    });
    
    // Update totals dynamically based on player count
    for(let i=0; i<players; i++){
      const el = document.getElementById(`junkTotP${i+1}`);
      if(el) el.textContent = totals[i];
    }

    // Calculate net totals (each player's position relative to average)
    const totalDots = totals.reduce((sum, t) => sum + t, 0);
    const avgDots = totalDots / players;
    for(let i=0; i<players; i++){
      const el = document.getElementById(`junkNetP${i+1}`);
      if(!el) continue;
      const netPos = totals[i] - avgDots;
      if(netPos === 0) {
        el.textContent = '0';
      } else if(netPos > 0) {
        el.textContent = `+${netPos.toFixed(1)}`;
      } else {
        el.textContent = netPos.toFixed(1);
      }
    }
  }

  function initJunkAchievements(){
    const junkTable = document.getElementById('junkTable');
    if(!junkTable) return;
    enhanceJunkCells();
    updateJunkTotalsWeighted();

    // Update totals on any score/par/name or achievement toggle
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
  
  // Expose to global scope for player management
  window.initJunkAchievements = initJunkAchievements;

  // Initialize when Junk tab opens (and once at load)
  document.getElementById('toggleJunk')?.addEventListener('click', ()=> {
    setTimeout(initJunkAchievements, 0);
  });
  document.addEventListener('DOMContentLoaded', initJunkAchievements);
})();


// =============================================================================
// VEGAS TEAM B TOTALS & DOLLAR CALCULATIONS
// =============================================================================
// Automatically mirror Team A totals to show Team B (negative)
// Calculate dollar amounts based on point value
(function(){
  function findVegasATotalEl(){
    const cands = ['vegasPtsA','vegasTotalA','vegasSumA'];
    for(const id of cands){
      const el = document.getElementById(id);
      if(el) return el;
    }
    // fallback: try a data-id
    const el = document.querySelector('#vegasSection [data-role="vegas-total-a"]');
    return el || null;
  }
  function vegasUpdateDollars(){
    const ptsEl = document.getElementById('vegasPtsA');
    const perEl = document.getElementById('vegasPointValue');
    const aEl = document.getElementById('vegasDollarA');
    const bEl = document.getElementById('vegasDollarB');
    if(!ptsEl || !perEl || !aEl || !bEl) return;
    const pts = parseSignedInt(ptsEl.textContent);
    let per = Number.parseFloat((perEl.value||'').trim());
    if(!Number.isFinite(per) || per < 0) per = 0;
    if(pts===null){ aEl.textContent='—'; bEl.textContent='—'; return; }
    const dollarsA = pts * per;
    const dollarsB = -dollarsA;
    const fmt = v => {
      const abs = Math.abs(v);
      const s = `$${abs.toFixed(2)}`;
      if(v>0) return `+${s}`; if(v<0) return `-${s}`; return s;
    };
    aEl.textContent = fmt(dollarsA);
    bEl.textContent = fmt(dollarsB);
  }
  // expose for recalc callers
  try{ window._vegasUpdateDollars = vegasUpdateDollars; }catch{}
  function ensureVegasBTotalsUI(){
    const sec = document.getElementById('vegasSection');
    if(!sec) return null;
    // look for an existing B total slot
    let b = sec.querySelector('#vegasPtsB, [data-role="vegas-total-b"]');
    if(b) return b;
    // Try to append near A total
    const a = findVegasATotalEl();
    if(a && a.parentElement){
      b = document.createElement('span');
      b.id = 'vegasPtsB';
      b.style.marginLeft = '12px';
      b.title = "Team B total (mirror of A)";
      a.insertAdjacentElement('afterend', b);
      return b;
    }
    return null;
  }
  function parseSignedInt(txt){
    if(!txt) return null;
    const m = String(txt).match(/[-+]?\d+/);
    return m ? parseInt(m[0], 10) : null;
  }
  function mirrorVegasTotals(){
    const a = findVegasATotalEl();
    const b = ensureVegasBTotalsUI();
    if(!a || !b) return;
    const aVal = parseSignedInt(a.textContent);
    if(aVal===null) { b.textContent = ''; return; }
    // Team B is the opposite
    const bVal = -aVal;
    b.textContent = (bVal>0? `+${bVal}` : String(bVal));
  }

  // Observe changes to A total and mirror to B automatically
  function observeA(){
    const a = findVegasATotalEl();
    if(!a) return;
    const mo = new MutationObserver(mirrorVegasTotals);
    mo.observe(a, { childList: true, characterData: true, subtree: true });
    mirrorVegasTotals();
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    observeA();
    // Update dollars when points or $/point change
    const pts = document.getElementById('vegasPtsA');
    if(pts){ const mo2 = new MutationObserver(vegasUpdateDollars); mo2.observe(pts, {childList:true, characterData:true, subtree:true}); }
    document.getElementById('vegasPointValue')?.addEventListener('input', vegasUpdateDollars);
    vegasUpdateDollars();
    // also try when Vegas tab is opened
    document.getElementById('toggleVegas')?.addEventListener('click', ()=> {
      setTimeout(()=>{ observeA(); vegasUpdateDollars(); }, 0);
    });
  });
})();

