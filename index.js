/* ============================================================================
   GOLF SCORECARD APPLICATION
   ============================================================================
   
   A Progressive Web App (PWA) for tracking golf scores with multiple side games.
   Supports 1-99 players with flexible course selection and comprehensive scoring.
   
   FEATURES:
   • Dynamic scorecard with auto-advance input
   • Course handicap support (including negative handicaps)
   • Net scoring with Net Double Bogey (NDB) cap
   • "Play off low" handicap system for fair competition
   • Multiple simultaneous side games (Vegas, Skins, Junk, Banker)
   • CSV import/export for easy score entry
   • Offline support with service worker caching
   • Dark/light theme toggle
   • Responsive design for mobile/tablet/desktop
   
   ============================================================================
   ARCHITECTURE
   ============================================================================
   
   CORE (index.js) - 1,474 lines
   ├─ Config         - Course database, constants, active course state
   ├─ Utils          - DOM helpers ($, $$), math utilities (sum, clamp)
   ├─ AppManager     - Coordinates recalculations across all game modes
   ├─ Storage        - localStorage save/load with versioning (v5)
   ├─ Scorecard      - Table building, calculations, player/course management
   │  ├─ build       - Header, par/HCP rows, player rows, totals row
   │  ├─ calc        - Adjusted handicaps, stroke allocation, NDB capping
   │  ├─ player      - Add/remove players, overlay sync, count display
   │  └─ course      - Course switching, par/HCP updates, badge display
   ├─ Games UI       - Toggle sections (open/close/toggle)
   ├─ CSV            - Import/export scorecard data
   ├─ Players        - Add/remove player management
   └─ Init           - Event wiring, state restoration
   
   GAME MODULES (external .js files)
   🔗 js/vegas.js         (568 lines) - Vegas team game
      • 2v2 teams or 3-player rotation with ghost
      • Scores combined into 2-digit numbers (low wins)
      • Multipliers for birdies/eagles (2x, 3x)
      • Digit flipping on opponent birdie+
      • NET scoring support with NDB cap
      • Dollar calculations based on point value
      Exposed: window.Vegas {compute, render, renderTeamControls, recalc, renderTable,
               getTeamAssignments, setTeamAssignments, getOptions, setOptions}
   
   🔗 js/skins.js         (377 lines) - Skins competition
      • Lowest net score wins each hole
      • Carry-over on ties (pot accumulates)
      • Half-pops mode (0.5 stroke increments)
      • Buy-in and payout calculations
      • Dynamic player support (1-99)
      Exposed: window.Skins {init, refreshForPlayerChange, update, compute, render}
   
   🔗 js/junk.js          (487 lines) - Junk (Dots) game
      • Eagle: 4 dots, Birdie: 2 dots, Par: 1 dot
      • NET scoring option with NDB cap
      • Achievements system (Hogan, Sandy, Sadaam, Pulley, Triple)
      • Weighted bonus points for achievements
      Exposed: window.Junk {init, initAchievements, refreshForPlayerChange, update}
   
   🔗 js/banker.js        (38 lines) - Banker game [STUB]
      • Points-per-match with rotation or until-beaten modes
      • To be implemented
      Exposed: window.Banker {init}
   
   🔗 js/banker-vegas.js  (37 lines) - Banker-Vegas combination [STUB]
      • Combines Banker and Vegas mechanics
      • To be implemented
      Exposed: window.BankerVegas {init}
   
   🔗 js/hilo.js          (~400 lines) - Hi-Lo team game
      • 4 players: Low+High handicap vs Middle two
      • Team stroke differential applied to worst player on high team
      • 3 games: Front 9 (1 unit), Back 9 (1 unit), Full 18 (2 units)
      • Per-hole scoring: Low vs Low, High vs High (1 point each)
      • Auto-press: 2-0 hole win creates new game for remaining holes
      • Press games worth 1 unit each (2 units for Full 18 presses)
      • Hole-by-hole breakdown with comparison results
      Exposed: window.HiLo {init, update, compute, render}
   
   ============================================================================
   FILE STRUCTURE
   ============================================================================
   
   /
   ├── index.html          - Main HTML structure, styles, game sections
   ├── index.js            - Core scorecard logic (this file)
   ├── sw.js               - Service worker for PWA caching (v1.3.7)
   ├── manifest.json       - PWA manifest
   ├── js/
   │   ├── vegas.js        - Vegas game module
   │   ├── skins.js        - Skins game module
   │   ├── junk.js         - Junk game module
   │   ├── hilo.js         - Hi-Lo game module
   │   ├── banker.js       - Banker game stub
   │   └── banker-vegas.js - Banker-Vegas stub
   ├── images/             - Icons and assets
   └── stylesheet/         - CSS files
   
   ============================================================================
*/

(() => {
  'use strict';
  console.log('[golfGames] index.js loaded');
  
  // =============================================================================
  // 📦 CONFIG MODULE - Course Database & Constants
  // =============================================================================
  
  const Config = {
    // Scorecard configuration
    HOLES: 18,
    MIN_PLAYERS: 1,
    MAX_PLAYERS: 99,
    DEFAULT_PLAYERS: 4,
    LEADING_FIXED_COLS: 2,
    NDB_BUFFER: 2, // Net Double Bogey: max penalty is par + buffer + strokes
    STORAGE_KEY: 'golf_scorecard_v5',
    
    // Course database
    // ★ TO ADD A NEW COURSE:
    // 1. Add entry with unique ID (lowercase, no spaces)
    // 2. Provide course name (displayed in dropdown)
    // 3. Add pars array for holes 1-18 (exactly 18 values)
    // 4. Add handicap index (HCP) array for holes 1-18 (values 1-18)
    //    • HCP 1 = hardest hole, HCP 18 = easiest hole
    COURSES: {
      'manito': {
        name: 'Manito Country Club',
        pars: [4,4,4,5,3,4,4,3,4, 4,4,3,5,5,4,4,3,4],
        hcpMen: [7,13,11,15,17,1,5,9,3, 10,2,12,14,18,4,6,16,8]
      },    
      'dove': {
        name: 'Dove Canyon Country Club',
        pars: [5,4,4,3,4,4,3,4,5, 3,5,4,3,5,4,4,3,4],
        hcpMen: [11,7,3,15,1,13,17,9,5,14,4,12,16,2,6,10,18,8]
      }
    },
    
    // Active course state (mutable)
    activeCourse: 'manito',
    pars: null,
    hcpMen: null,
    
    // Initialize with default course
    init() {
      this.pars = [...this.COURSES.manito.pars];
      this.hcpMen = [...this.COURSES.manito.hcpMen];
      // Expose globally for backward compatibility
      window.PARS = this.pars;
      window.HCPMEN = this.hcpMen;
    },
    
    // Switch active course
    switchCourse(courseId) {
      if (!this.COURSES[courseId]) {
        console.error(`[Config] Unknown course: ${courseId}`);
        return false;
      }
      this.activeCourse = courseId;
      this.pars = [...this.COURSES[courseId].pars];
      this.hcpMen = [...this.COURSES[courseId].hcpMen];
      window.PARS = this.pars;
      window.HCPMEN = this.hcpMen;
      return true;
    }
  };
  
  // Initialize config
  Config.init();
  
  // Legacy global constants for backward compatibility
  const HOLES = Config.HOLES;
  let PLAYERS = Config.DEFAULT_PLAYERS;
  const MIN_PLAYERS = Config.MIN_PLAYERS;
  const MAX_PLAYERS = Config.MAX_PLAYERS;
  const DEFAULT_PLAYERS = Config.DEFAULT_PLAYERS;
  const LEADING_FIXED_COLS = Config.LEADING_FIXED_COLS;
  const NDB_BUFFER = Config.NDB_BUFFER;
  const COURSES = Config.COURSES;
  let PARS = Config.pars;
  let HCPMEN = Config.hcpMen;
  let ACTIVE_COURSE = Config.activeCourse;
  
  // Expose PLAYERS globally for game modules
  Object.defineProperty(window, 'PLAYERS', {
    get() { return PLAYERS; },
    set(val) { PLAYERS = val; }
  });

  // =============================================================================
  // 📦 UTILS MODULE - DOM Helpers & Math Utilities
  // =============================================================================
  
  const Utils = {
    /** Query selector shorthand - returns single element */
    $: (s, el=document) => el.querySelector(s),
    
    /** Query selector all shorthand - returns array of elements */
    $$: (s, el=document) => Array.from(el.querySelectorAll(s)),
    
    /** Sum an array of values, treating non-numbers as 0 */
    sum: (a) => a.reduce((x,y) => x + (Number(y) || 0), 0),
    
    /** Clamp an integer value between min and max bounds */
    clampInt: (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(+v) ? Math.trunc(+v) : min)),
    
    /** Format currency value */
    fmt: (v) => v.toFixed(2),
    
    /** Announce message to screen readers */
    announce: (msg) => {
      const el = document.getElementById('announcer');
      if (el) el.textContent = msg;
    }
  };
  
  // Legacy globals for backward compatibility
  const $ = Utils.$;
  const $$ = Utils.$$;
  const sum = Utils.sum;
  const clampInt = Utils.clampInt;

  // =============================================================================
  // APP MANAGER - Central coordination for game recalculations
  // =============================================================================

  
  /**
   * Central manager to coordinate recalculations across all game modes
   * Ensures Vegas, Skins, and Junk stay in sync when scores change
   */
  const AppManager = {
    recalcGames(){
      try{ window.Vegas?.recalc(); }catch(e){ console.warn('vegas_recalc failed', e); }
      try{ window.Skins?.update(); }catch(e){ /* skins may not be open yet */ }
      try{ window.Junk?.update(); }catch(e){ /* junk may not be open yet */ }
      try{ window.HiLo?.update(); }catch(e){ /* hilo may not be open yet */ }
    }
  };
  try{ window.AppManager = AppManager; }catch{}

  const ids = {
    holesHeader:"#holesHeader",parRow:"#parRow",hcpRow:"#hcpRow",totalsRow:"#totalsRow",
    table:"#scorecard",
    resetBtn:"#resetBtn",clearAllBtn:"#clearAllBtn",saveBtn:"#saveBtn",saveStatus:"#saveStatus",

    // Games toggles
    toggleVegas:"#toggleVegas", toggleBanker:"#toggleBanker", toggleSkins:"#toggleSkins", toggleBankerVegas:"#toggleBankerVegas", toggleHilo:"#toggleHilo",
    vegasSection:"#vegasSection", bankerSection:"#bankerSection", skinsSection:"#skinsSection", bankerVegasSection:"#bankerVegasSection", hiloSection:"#hiloSection",

    // Vegas
  vegasTeams:"#vegasTeams", vegasTeamWarning:"#vegasTeamWarning",
  vegasTableBody:"#vegasBody", vegasTotalA:"#vegasTotalA", vegasTotalB:"#vegasTotalB", vegasPtsA:"#vegasPtsA", vegasPtsB:"#vegasPtsB",
  optUseNet:"#optUseNet", optDoubleBirdie:"#optDoubleBirdie", optTripleEagle:"#optTripleEagle",
  vegasPointValue:"#vegasPointValue", vegasDollarA:"#vegasDollarA", vegasDollarB:"#vegasDollarB",

    // Skins
    skinsCarry:"#skinsCarry", skinsHalf:"#skinsHalf",
    skinsBody:"#skinsBody", skinsPotTot:"#skinsPotTot",
    skinsTotP1:"#skinsTotP1", skinsTotP2:"#skinsTotP2", skinsTotP3:"#skinsTotP3", skinsTotP4:"#skinsTotP4",
    skinsP1:"#skinsP1", skinsP2:"#skinsP2", skinsP3:"#skinsP3", skinsP4:"#skinsP4",
    skinsSummary:"#skinsSummary",
// CSV
    csvInput:"#csvInput", dlTemplateBtn:"#dlTemplateBtn",
  };

  // =============================================================================
  // SCORECARD MODULE - Table building, calculations, and player management
  // =============================================================================
  /**
   * Scorecard handles all scorecard UI and calculation logic
   * - build: Table building methods (header, par/hcp rows, player rows, totals)
   * - calc: Calculation methods (handicaps, scoring, row/totals recalculation)
   * - player: Player management (add/remove, count display, sync overlay)
   * - course: Course switching and par badge updates
   */
  const Scorecard = {
    // ========== BUILD METHODS ==========
    build: {
      /**
       * Build header row with hole numbers (1-18) and summary columns
       */
      header(){
        const header=$(ids.holesHeader);
        for(let h=1;h<=HOLES;h++){ 
          const th=document.createElement("th"); 
          th.textContent=h; 
          header.appendChild(th); 
        }
        ["Out","In","Total","To Par","Net"].forEach(label=>{ 
          const th=document.createElement("th"); 
          th.textContent=label; 
          header.appendChild(th); 
        });
      },

      /**
       * Build and populate Par and Handicap rows (read-only)
       * Par row shows course par for each hole plus front/back/total
       * HCP row shows stroke index (1-18) for each hole
       */
      parAndHcpRows(){
        const parRow=$(ids.parRow), hcpRow=$(ids.hcpRow);
        for(let h=1;h<=HOLES;h++){
          const tdp=document.createElement("td"), ip=document.createElement("input"); 
          ip.type="number"; ip.inputMode="numeric"; ip.value=PARS[h-1]; 
          ip.readOnly=true; ip.tabIndex=-1; tdp.appendChild(ip); 
          if(h === 18) tdp.classList.add('hole-18'); // Add class for styling divider
          parRow.appendChild(tdp);
          
          const tdh=document.createElement("td"), ih=document.createElement("input"); 
          ih.type="number"; ih.inputMode="numeric"; ih.value=HCPMEN[h-1]; 
          ih.readOnly=true; ih.tabIndex=-1; tdh.appendChild(ih); 
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
      },

      /**
       * Build interactive player rows with name, handicap, and score inputs
       * Includes auto-advance functionality and real-time calculation
       * 
       * IMPORTANT: Event listeners trigger recalculations:
       * - nameInput: syncPlayerNamesOverlay, renderTeamControls, recalcGames, saveDebounced
       * - chInput: recalcAll, recalcGames, saveDebounced
       * - scoreInput: recalcRow, recalcTotalsRow, recalcGames, saveDebounced
       */
      playerRows(){
        const tbody=$(ids.table).tBodies[0];
        for(let p=0;p<PLAYERS;p++){
          const tr=document.createElement("tr"); 
          tr.className="player-row"; 
          tr.dataset.player=String(p);

          // Name input
          const nameTd=document.createElement("td");
          const nameInput=document.createElement("input"); 
          nameInput.type="text"; 
          nameInput.className="name-edit"; 
          nameInput.placeholder=`Player ${p+1}`; 
          nameInput.autocomplete="off";
          nameInput.addEventListener("input",()=>{ 
            Scorecard.player.syncOverlay(); 
            window.Vegas?.renderTeamControls(); 
            AppManager.recalcGames(); 
            Storage.saveDebounced(); 
          });
          nameTd.appendChild(nameInput); 
          tr.appendChild(nameTd);

          // Course Handicap input
          const chTd=document.createElement("td");
          const MIN_HANDICAP = -50;
          const MAX_HANDICAP = 60;
          
          const chInput=document.createElement("input"); 
          chInput.type="number"; 
          chInput.inputMode="numeric"; 
          chInput.className="ch-input"; 
          chInput.value="0"; 
          chInput.min="-20"; 
          chInput.max="54"; 
          chInput.step="1"; 
          chInput.autocomplete="off";
          
          chInput.addEventListener("input", () => { 
            if(chInput.value !== "") {
              chInput.value = clampInt(chInput.value, MIN_HANDICAP, MAX_HANDICAP);
            }
            Scorecard.calc.recalcAll(); 
            AppManager.recalcGames(); 
            Storage.saveDebounced(); 
          });
          chTd.appendChild(chInput); 
          tr.appendChild(chTd);

          // Score inputs for each hole
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
                
                // Auto-advance: move to next player on same hole
                const currentPlayer = Number(inp.dataset.player);
                const currentHole = Number(inp.dataset.hole);
                
                if(inp.value.length >= 1 && currentPlayer < PLAYERS - 1) {
                  // Move to next player, same hole
                  const nextInput = document.querySelector(
                    `.score-input[data-player="${currentPlayer+1}"][data-hole="${currentHole}"]`
                  );
                  
                  if(nextInput) {
                    setTimeout(() => nextInput.focus(), 50);
                  }
                }
              } else {
                inp.classList.remove("invalid");
              }
              Scorecard.calc.recalcRow(tr); 
              Scorecard.calc.recalcTotalsRow(); 
              AppManager.recalcGames(); 
              Storage.saveDebounced(); 
            });
            td.appendChild(inp); 
            tr.appendChild(td);
          }

          // Summary cells: Out, In, Total, To Par, Net
          const outTd=document.createElement("td"); outTd.className="split";
          const inTd=document.createElement("td"); inTd.className="split";
          const totalTd=document.createElement("td"); totalTd.className="total";
          const toParTd=document.createElement("td"); toParTd.className="to-par";
          const netTd=document.createElement("td"); netTd.className="net";
          tr.append(outTd,inTd,totalTd,toParTd,netTd);

          tbody.appendChild(tr);
        }
      },

      /**
       * Build totals row showing sum of all player scores per hole
       */
      totalsRow(){
        const totalsRow=$(ids.totalsRow);
        for(let h=1;h<=HOLES;h++){
          const td=document.createElement("td"); 
          td.className="subtle"; 
          td.dataset.holeTotal=String(h); 
          td.textContent="—"; 
          if(h === 18) td.classList.add('hole-18'); // Add class for styling divider
          totalsRow.appendChild(td);
        }
        const out=document.createElement("td"), inn=document.createElement("td"), 
              total=document.createElement("td"), blank1=document.createElement("td"), 
              blank2=document.createElement("td");
        out.className="subtle"; inn.className="subtle"; total.className="subtle"; 
        totalsRow.append(out,inn,total,blank1,blank2);
      }
    },

    // ========== CALCULATION METHODS ==========
    calc: {
      /**
       * Calculate adjusted handicaps using "play off low" system
       * The lowest handicap player gets 0, others get the difference
       * @returns {number[]} Array of adjusted handicaps (minimum is always 0)
       */
      adjustedCHs(){
        const chs=$$(".player-row").map(r=>{ 
          const v=Number($(".ch-input",r)?.value); 
          return Number.isFinite(v)?v:0; 
        });
        const minCH=Math.min(...chs);
        return chs.map(ch=>ch-minCH); // play off low
      },

      /**
       * Calculate strokes received on a specific hole
       * @param {number} adjCH - Adjusted course handicap
       * @param {number} holeIdx - Zero-based hole index
       * @returns {number} Number of strokes on this hole
       */
      strokesOnHole(adjCH, holeIdx){
        if(adjCH<=0) return 0;
        const base=Math.floor(adjCH/18), rem=adjCH%18, holeHcp=HCPMEN[holeIdx];
        return base+(holeHcp<=rem?1:0);
      },

      /**
       * Get gross score for a player on a hole
       * @param {number} playerIdx - Zero-based player index
       * @param {number} holeIdx - Zero-based hole index
       * @returns {number} Gross score or 0 if not entered
       */
      getGross(playerIdx, holeIdx){
        return Number($(`input.score-input[data-player="${playerIdx}"][data-hole="${holeIdx+1}"]`)?.value)||0;
      },

      /**
       * Calculate net score with Net Double Bogey (NDB) cap applied
       * @param {number} playerIdx - Zero-based player index
       * @param {number} holeIdx - Zero-based hole index
       * @returns {number} Net score with NDB cap
       */
      getNetNDB(playerIdx, holeIdx){
        const adjCH=Scorecard.calc.adjustedCHs()[playerIdx], 
              gross=Scorecard.calc.getGross(playerIdx,holeIdx);
        if(!gross) return 0;
        const sr=Scorecard.calc.strokesOnHole(adjCH,holeIdx), 
              ndb=PARS[holeIdx]+NDB_BUFFER+sr, 
              adjGross=Math.min(gross,ndb);
        return adjGross - sr;
      },

      /**
       * Get all hole values for a player row
       * @param {HTMLElement} rowEl - Player row element
       * @returns {number[]} Array of 18 scores (0 for empty)
       */
      getPlayerHoleValues(rowEl){ 
        return $$("input.score-input", rowEl).map(i => Number(i.value) || 0); 
      },

      /**
       * Recalculate totals and net score for a single player row
       * @param {HTMLElement} rowEl - Player row element
       */
      recalcRow(rowEl){
        const s = Scorecard.calc.getPlayerHoleValues(rowEl);
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
          
          const sr = Scorecard.calc.strokesOnHole(Scorecard.calc.adjustedCHs()[pIdx], h);
          const ndb = PARS[h] + NDB_BUFFER + sr;
          const adjGross = Math.min(gross, ndb);
          netTotal += adjGross - sr;
        }
        
        $(".net", rowEl).textContent = netTotal ? String(netTotal) : "—";
      },

      /**
       * Recalculate totals row showing sum of all player scores per hole
       */
      recalcTotalsRow(){
        for(let h=1;h<=HOLES;h++){
          const ph=$$(`input.score-input[data-hole="${h}"]`).map(i=>Number(i.value)||0), t=sum(ph);
          $(`[data-hole-total="${h}"]`).textContent = t? String(t) : "—";
        }
        const tds=$(ids.totalsRow).querySelectorAll("td"), base=LEADING_FIXED_COLS+HOLES;
        const OUT=$$(".player-row").map(r=>{ 
          const s=r.querySelectorAll("td.split"); 
          return Number(s[0]?.textContent)||0; 
        }).reduce((a,b)=>a+b,0);
        const INN=$$(".player-row").map(r=>{ 
          const s=r.querySelectorAll("td.split"); 
          return Number(s[1]?.textContent)||0; 
        }).reduce((a,b)=>a+b,0);
        const TOT=$$(".player-row").map(r=>Number($(".total",r)?.textContent)||0).reduce((a,b)=>a+b,0);
        tds[base+0].textContent=OUT||"—"; 
        tds[base+1].textContent=INN||"—"; 
        tds[base+2].textContent=TOT||"—";
      },

      /**
       * Recalculate all player rows and totals row
       */
      recalcAll(){ 
        $$(".player-row").forEach(Scorecard.calc.recalcRow); 
        Scorecard.calc.recalcTotalsRow(); 
      }
    },

    // ========== PLAYER MANAGEMENT ==========
    player: {
      /**
       * Sync the fixed player names overlay with the main scorecard table
       */
      syncOverlay() {
        const playerNamesBody = document.getElementById('playerNamesBody');
        if (!playerNamesBody) return;
        
        // Clear existing
        playerNamesBody.innerHTML = '';
        
        // Add Par row
        const parRow = document.createElement('tr');
        const parTd = document.createElement('td');
        parTd.innerHTML = '<strong>Par</strong> <span class="subtle">(from card)</span>';
        parRow.appendChild(parTd);
        playerNamesBody.appendChild(parRow);
        
        // Add HCP row
        const hcpRow = document.createElement('tr');
        const hcpTd = document.createElement('td');
        hcpTd.innerHTML = '<strong>HCP Index</strong> <span class="subtle">(from card)</span>';
        hcpRow.appendChild(hcpTd);
        playerNamesBody.appendChild(hcpRow);
        
        // Add player rows - sync with actual player inputs
        const playerRows = document.querySelectorAll('.player-row');
        playerRows.forEach((row, idx) => {
          const nameInput = row.querySelector('.name-edit');
          const overlayRow = document.createElement('tr');
          const overlayTd = document.createElement('td');
          overlayTd.textContent = nameInput?.value || `Player ${idx + 1}`;
          overlayRow.appendChild(overlayTd);
          playerNamesBody.appendChild(overlayRow);
        });
      },

      /**
       * Update the player count display text
       */
      updateCountDisplay() {
        const display = document.getElementById('playerCountDisplay');
        if(display) {
          display.textContent = `${PLAYERS} player${PLAYERS === 1 ? '' : 's'}`;
        }
      }
    },

    // ========== COURSE MANAGEMENT ==========
    course: {
      /**
       * Switch to a different golf course
       * Updates pars, handicaps, and triggers recalculation of all scores
       * @param {string} courseId - Course ID from COURSES database
       */
      switch(courseId){
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
        Scorecard.course.updateParAndHcpRows();
        
        // Recalculate all player scores and net values (uses new PARS and HCPMEN for stroke allocation)
        Scorecard.calc.recalcAll();
        
        // Recalculate all game modes (Vegas, Skins, Junk) with new stroke allocations
        AppManager.recalcGames();
        
        // Force refresh of any game-specific UI that might be open
        const skinsSection = document.getElementById('skinsSection');
        if(skinsSection?.classList.contains('open')){
          // Trigger skins recalc if it's open
          window.Skins?.update();
        }
        
        const junkSection = document.getElementById('junkSection');
        if(junkSection?.classList.contains('open')){
          // Trigger junk recalc if it's open
          window.Junk?.update();
        }
        
        // Update stroke highlighting with new HCPMEN
        if(typeof window.updateStrokeHighlights === 'function'){
          window.updateStrokeHighlights();
        }
        
        Storage.saveDebounced();
      },

      /**
       * Update existing par and handicap row inputs when course changes
       */
      updateParAndHcpRows(){
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
        
        Scorecard.course.updateParBadge();
      },

      /**
       * Update the par badge display with current course totals
       */
      updateParBadge(){
        const el = document.getElementById('parBadge'); if(!el) return;
        const parFront = PARS.slice(0,9).reduce((a,b)=>a+b,0);
        const parBack  = PARS.slice(9,18).reduce((a,b)=>a+b,0);
        const parTot = parFront + parBack;
        el.textContent = `Par — Out ${parFront} • In ${parBack} • Total ${parTot}`;
      }
    }
  };

  // =============================================================================
  // 📦 STORAGE MODULE - State Persistence
  // =============================================================================
  
  const Storage = {
    KEY: Config.STORAGE_KEY,
    saveTimer: null,
    
    /**
     * Save current game state to localStorage
     */
    save() {
      const state = {
        course: ACTIVE_COURSE,
        players: $$(".player-row").map(row => ({
          name: $(".name-edit", row).value || "",
          ch: $(".ch-input", row).value || "",
          scores: $$("input.score-input", row).map(i => i.value)
        })),
        vegas: { 
          teams: window.Vegas?.getTeamAssignments(), 
          opts: window.Vegas?.getOptions(), 
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
        localStorage.setItem(this.KEY, JSON.stringify(state));
        Utils.announce("Saved.");
        // Also use legacy announce for save button feedback
        if(typeof announce === 'function') announce("Saved!");
      } catch(err) {
        console.error('[Storage] Save failed:', err);
        Utils.announce("Save failed!");
        if(typeof announce === 'function') announce("Save failed!");
      }
    },
    
    /**
     * Debounced save - waits 300ms after last change before saving
     */
    saveDebounced() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), 300);
    },
    
    /**
     * Load saved game state from localStorage
     */
    load() {
      const raw = localStorage.getItem(this.KEY); 
      if(!raw) return;
      
      try{
        const s = JSON.parse(raw);
        
        // Restore course selection
        if(s.course && COURSES[s.course]){
          const courseSelect = $('#courseSelect');
          if(courseSelect) courseSelect.value = s.course;
          if(s.course !== ACTIVE_COURSE){
            Scorecard.course.switch(s.course);
          }
        }
        
        const rows = $$(".player-row");
        s.players?.forEach((p, i) => { 
          const r = rows[i]; 
          if(!r) return;
          
          $(".name-edit", r).value = p.name || "";
          $(".ch-input", r).value = (p.ch !== undefined && p.ch !== null && p.ch !== "") ? p.ch : "0";
          
          const ins = $$("input.score-input", r);
          p.scores?.forEach((v, j) => { 
            if(ins[j]) ins[j].value = v; 
          });
        });
        Scorecard.calc.recalcAll();
        Scorecard.player.syncOverlay();

        // Restore game states
        window.Vegas?.renderTeamControls();
        if(s.vegas?.teams) window.Vegas?.setTeamAssignments(s.vegas.teams);
        if(s.vegas?.opts) window.Vegas?.setOptions(s.vegas.opts);
        if(s.vegas?.open) games_open("vegas");

        if(s.banker?.open) games_open("banker");

        if(s.skins?.buyIn != null) {
          const buyInEl = document.getElementById('skinsBuyIn');
          if(buyInEl) buyInEl.value = s.skins.buyIn;
        }
        if(s.skins?.open) games_open("skins");

        window.Vegas?.recalc();
        
        const savedDate = new Date(s.savedAt || Date.now()).toLocaleString();
        Utils.announce(`Restored saved card (${savedDate}).`);
      } catch(err) {
        console.error('[Storage] Load failed:', err);
        Utils.announce("Load failed!");
      }
    },
    
    /**
     * Clear all score inputs only (keep names and handicaps)
     */
    clearScoresOnly() { 
      $$("input.score-input").forEach(i => {
        i.value = "";
        i.classList.remove("invalid");
      }); 
      Scorecard.calc.recalcAll(); 
      AppManager.recalcGames(); 
      Utils.announce("Scores cleared."); 
    },
    
    /**
     * Clear all fields (names, handicaps, and scores)
     */
    clearAll() {
      $$(".player-row").forEach(r => { 
        $(".name-edit", r).value = "";
        $(".ch-input", r).value = "0";
        $$("input.score-input", r).forEach(i => {
          i.value = "";
          i.classList.remove("invalid");
          i.classList.remove("receives-stroke");
          i.removeAttribute("data-strokes");
          i.removeAttribute("title");
        });
      });
      Scorecard.calc.recalcAll(); 
      window.Vegas?.renderTeamControls(); 
      window.Vegas?.recalc(); 
      
      // Update stroke highlights after clearing
      if(typeof updateStrokeHighlights === 'function') {
        updateStrokeHighlights();
      }
      
      Utils.announce("All fields cleared.");
    }
  };
  
  // Expose Storage methods globally for external modules
  window.saveDebounced = () => Storage.saveDebounced();
  
  /**
   * Display a temporary status message to the user
   * @param {string} t - Message text to display
   */
  function announce(t){ 
    const el = $(ids.saveStatus); 
    if(!el) {
      console.log('[announce]', t);
      return;
    }
    el.textContent = t; 
    el.style.opacity = "1"; 
    setTimeout(() => {
      el.style.opacity = "0.75";
    }, 1200); 
  }
  
  // Use Storage's announce which uses Utils.announce
  // Legacy alias maintained here for backward compatibility

  // =============================================================================
  // GAMES UI - Toggle game sections (Vegas, Banker, Skins, Junk)
  // =============================================================================
  
  /**
   * Open a game section and make it visible
   * @param {string} which - Game section: 'vegas', 'banker', 'skins', 'bankervegas', or 'hilo'
   */
  function games_open(which){
    if(which==="vegas"){ $(ids.vegasSection).classList.add("open"); $(ids.vegasSection).setAttribute("aria-hidden","false"); $(ids.toggleVegas).classList.add("active"); }
    if(which==="banker"){ 
      $(ids.bankerSection).classList.add("open"); 
      $(ids.bankerSection).setAttribute("aria-hidden","false"); 
      $(ids.toggleBanker).classList.add("active");
      setTimeout(() => { window.Banker?.init(); }, 0);
    }
    if(which==="skins"){ $(ids.skinsSection).classList.add("open"); $(ids.skinsSection).setAttribute("aria-hidden","false"); $(ids.toggleSkins).classList.add("active"); }
    if(which==="bankervegas"){ 
      $(ids.bankerVegasSection).classList.add("open"); 
      $(ids.bankerVegasSection).setAttribute("aria-hidden","false"); 
      $(ids.toggleBankerVegas).classList.add("active");
      setTimeout(() => { window.BankerVegas?.init(); }, 0);
    }
    if(which==="hilo"){ 
      $(ids.hiloSection).classList.add("open"); 
      $(ids.hiloSection).setAttribute("aria-hidden","false"); 
      $(ids.toggleHilo).classList.add("active");
      setTimeout(() => { window.HiLo?.init(); }, 0);
    }
  }
  function games_close(which){
    if(which==="vegas"){ $(ids.vegasSection).classList.remove("open"); $(ids.vegasSection).setAttribute("aria-hidden","true"); $(ids.toggleVegas).classList.remove("active"); }
    if(which==="banker"){ $(ids.bankerSection).classList.remove("open"); $(ids.bankerSection).setAttribute("aria-hidden","true"); $(ids.toggleBanker).classList.remove("active"); }
    if(which==="skins"){ $(ids.skinsSection).classList.remove("open"); $(ids.skinsSection).setAttribute("aria-hidden","true"); $(ids.toggleSkins).classList.remove("active"); }
    if(which==="bankervegas"){ $(ids.bankerVegasSection).classList.remove("open"); $(ids.bankerVegasSection).setAttribute("aria-hidden","true"); $(ids.toggleBankerVegas).classList.remove("active"); }
    if(which==="hilo"){ $(ids.hiloSection).classList.remove("open"); $(ids.hiloSection).setAttribute("aria-hidden","true"); $(ids.toggleHilo).classList.remove("active"); }
  }
  function games_toggle(which){
    let sec;
    if(which==="vegas") sec = $(ids.vegasSection);
    else if(which==="banker") sec = $(ids.bankerSection);
    else if(which==="skins") sec = $(ids.skinsSection);
    else if(which==="bankervegas") sec = $(ids.bankerVegasSection);
    else if(which==="hilo") sec = $(ids.hiloSection);
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

    Scorecard.calc.recalcAll(); AppManager.recalcGames(); Storage.save();
    announce("CSV imported.");
  }
  function downloadCSVTemplate() {
    const headers = ["player","ch", ...Array.from({length:18},(_,i)=>`h${i+1}`)];
    const rows = [
      ["Daniel",-1,4,3,4,3,2,4,4,2,4, 4,3,2,5,4,4,3,2,4],
      ["Rob",2,   5,4,5,2,3,5,4,3,5, 5,4,3,5,6,2,4,3,5],
      ["John",4,  4,5,6,5,4,6,5,4,5, 4,5,4,6,3,2,5,4,5],
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
   * Uses same structure and event listeners as Scorecard.build.playerRows()
   */
  function addPlayer() {
    if(PLAYERS >= MAX_PLAYERS) {
      Utils.announce(`Maximum ${MAX_PLAYERS} players allowed.`);
      return;
    }
    
    const tbody = $('#scorecard').tBodies[0];
    const p = PLAYERS; // Current player index
    
    // Create new player row (same structure as Scorecard.build.playerRows)
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
      Scorecard.player.syncOverlay();
      window.Vegas?.renderTeamControls();
      AppManager.recalcGames();
      Storage.saveDebounced();
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
    chInput.value = "0";
    chInput.min = "-20";
    chInput.max = "54";
    chInput.step = "1";
    chInput.autocomplete = "off";
    chInput.addEventListener("input", () => {
      if(chInput.value !== "") {
        chInput.value = clampInt(chInput.value, MIN_HANDICAP, MAX_HANDICAP);
      }
      Scorecard.calc.recalcAll();
      AppManager.recalcGames();
      Storage.saveDebounced();
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
          
          // Auto-advance: move to next player on same hole
          const currentPlayer = Number(inp.dataset.player);
          const currentHole = Number(inp.dataset.hole);
          
          if(inp.value.length >= 1 && currentPlayer < PLAYERS - 1) {
            // Move to next player, same hole
            const nextInput = document.querySelector(
              `.score-input[data-player="${currentPlayer + 1}"][data-hole="${currentHole}"]`
            );
            if(nextInput) {
              setTimeout(() => nextInput.focus(), 50);
            }
          }
        } else {
          inp.classList.remove("invalid");
        }
        Scorecard.calc.recalcRow(tr);
        Scorecard.calc.recalcTotalsRow();
        AppManager.recalcGames();
        Storage.saveDebounced();
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
    Scorecard.player.updateCountDisplay();
    
    // Recalculate everything immediately and again after DOM update
    recalculateEverything();
    Scorecard.player.syncOverlay();
    setTimeout(() => {
      recalculateEverything();
      Scorecard.player.updateCountDisplay();
      Scorecard.player.syncOverlay();
    }, 100);
    
    Storage.saveDebounced();
    Utils.announce(`Player ${PLAYERS} added.`);
  }
  
  /**
   * Remove the last player row from the scorecard
   * First clears all data, then removes the row
   */
  function removePlayer() {
    if(PLAYERS <= MIN_PLAYERS) {
      Utils.announce(`Minimum ${MIN_PLAYERS} player required.`);
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
      Scorecard.calc.recalcRow(lastRow);
      Scorecard.calc.recalcTotalsRow();
      AppManager.recalcGames();
      
      // Now remove the row
      lastRow.remove();
      PLAYERS--;
      
      console.log('[removePlayer] PLAYERS after decrement:', PLAYERS);
      
      // Update display immediately
      Scorecard.player.updateCountDisplay();
      
      // Recalculate everything immediately and again after DOM update
      recalculateEverything();
      Scorecard.player.syncOverlay();
      setTimeout(() => {
        recalculateEverything();
        Scorecard.player.updateCountDisplay();
        Scorecard.player.syncOverlay();
      }, 100);
      
      Storage.saveDebounced();
      Utils.announce(`Player removed. ${PLAYERS} player${PLAYERS === 1 ? '' : 's'} remaining.`);
    }
  }

  /**
   * Recalculate everything - all totals, games, and UI
   */
  function recalculateEverything() {
    Scorecard.calc.recalcTotalsRow();
    window.Vegas?.renderTeamControls();
    // Small delay to ensure Vegas team controls are rendered before recalc
    setTimeout(() => {
      AppManager.recalcGames();
      window.Skins?.refreshForPlayerChange();
      window.Junk?.refreshForPlayerChange();
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
    Scorecard.build.header(); Scorecard.build.parAndHcpRows(); Scorecard.build.playerRows(); Scorecard.build.totalsRow(); Scorecard.course.updateParBadge();
    Scorecard.player.syncOverlay();

  $(ids.resetBtn).addEventListener("click", () => { console.log('[golfGames] Reset clicked'); Storage.clearScoresOnly(); });
  $(ids.clearAllBtn).addEventListener("click", () => { console.log('[golfGames] Clear all clicked'); Storage.clearAll(); });
  $(ids.saveBtn).addEventListener("click", () => { console.log('[golfGames] Save clicked'); Storage.save(); });
  
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
        Scorecard.course.switch(e.target.value);
      });
    }

    // Games: open/close
    $(ids.toggleVegas).addEventListener("click", ()=>games_toggle("vegas"));
    $(ids.toggleBanker).addEventListener("click", ()=>games_toggle("banker"));
    $(ids.toggleBankerVegas).addEventListener("click", ()=>games_toggle("bankervegas"));
    $(ids.toggleHilo).addEventListener("click", ()=>games_toggle("hilo"));
    
    // Skins: toggle and initialize
    $(ids.toggleSkins)?.addEventListener("click", () => {
      const sec = $(ids.skinsSection);
      const open = !sec.classList.contains('open');
      sec.classList.toggle('open', open);
      sec.setAttribute('aria-hidden', open ? 'false' : 'true');
      $(ids.toggleSkins)?.classList.toggle('active', open);
      if(open) {
        setTimeout(() => { window.Skins?.init(); }, 0);
      }
    });
    
    // Junk: toggle and initialize
    document.getElementById('toggleJunk')?.addEventListener('click', () => {
      const sec = document.getElementById('junkSection');
      const open = !sec.classList.contains('open');
      sec.classList.toggle('open', open);
      sec.setAttribute('aria-hidden', open ? 'false' : 'true');
      document.getElementById('toggleJunk')?.classList.toggle('active', open);
      if(open) {
        setTimeout(() => { window.Junk?.init(); }, 0);
      }
    });

    // Vegas UI + wiring
    window.Vegas?.renderTeamControls();
    window.Vegas?.renderTable();
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
    
    Scorecard.player.updateCountDisplay();

    Scorecard.calc.recalcAll(); AppManager.recalcGames(); Storage.load();
  }

  document.addEventListener("DOMContentLoaded", init);

})();

// =============================================================================
// BANKER GAME MODE - Moved to js/banker.js
// =============================================================================
// Banker game now in separate file (stub/placeholder)
// See js/banker.js for implementation

// =============================================================================
// BANKER-VEGAS GAME MODE - Moved to js/banker-vegas.js
// =============================================================================
// Banker-Vegas game now in separate file (stub/placeholder)
// See js/banker-vegas.js for implementation

// =============================================================================
// SKINS GAME MODE - Moved to js/skins.js
// =============================================================================
// Skins game now in separate file for better modularity
// See js/skins.js for implementation

// =============================================================================
// JUNK (DOTS) GAME MODE - Moved to js/junk.js
// =============================================================================
// Junk game now in separate file for better modularity
// See js/junk.js for implementation

  // =============================================================================
  // VEGAS GAME MODE - Moved to js/vegas.js
  // =============================================================================
  // Vegas game now in separate file for better modularity
  // See js/vegas.js for implementation

