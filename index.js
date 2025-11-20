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
   
   CORE (index.js) - ~1,300 lines
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
   
   🔗 js/hilo.js          (~400 lines) - Hi-Lo team game
      • 4 players: Low+High handicap vs Middle two
      • Team stroke differential applied to worst player on high team
      • 3 games: Front 9 (1 unit), Back 9 (1 unit), Full 18 (2 units)
      • Per-hole scoring: Low vs Low, High vs High (1 point each)
      • Auto-press: 2-0 hole win creates new game for remaining holes
      • Press games worth 1 unit each (2 units for Full 18 presses)
      • Hole-by-hole breakdown with comparison results
      Exposed: window.HiLo {init, update, compute, render}
   
   🔗 js/export.js        (~370 lines) - CSV and Email export
      • CSV Export: Download scorecard as CSV file
      • Email Export: Format scorecard + game results for email
      • Includes all active game results with options
      • Plain text formatting for email compatibility
      Exposed: window.Export {exportCurrentScorecard, emailCurrentScorecard}
   
   ============================================================================
   FILE STRUCTURE
   ============================================================================
   
   /
   ├── index.html          - Main HTML structure, styles, game sections
   ├── index.js            - Core scorecard logic (this file)
   ├── sw.js               - Service worker for PWA caching (v1.3.7)
   ├── manifest.json       - PWA manifest
   ├── js/
   │   ├── export.js       - CSV and Email export module
   │   ├── vegas.js        - Vegas game module
   │   ├── skins.js        - Skins game module
   │   ├── junk.js         - Junk game module
   │   ├── hilo.js         - Hi-Lo game module
   │   └── banker.js       - Banker game stub
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
  
  // Expose COURSES and ACTIVE_COURSE for export module
  window.COURSES = COURSES;
  Object.defineProperty(window, 'ACTIVE_COURSE', {
    get() { return ACTIVE_COURSE; },
    set(val) { ACTIVE_COURSE = val; }
  });

  // =============================================================================
  // 🔧 CONSTANTS - Magic numbers extracted for clarity
  // =============================================================================
  
  const TIMING = {
    FOCUS_DELAY_MS: 50,          // Delay before focusing next input (prevents race conditions)
    RECALC_DEBOUNCE_MS: 300,     // Debounce delay for auto-save
    INIT_RETRY_DELAY_MS: 150,    // Delay for game module initialization retries
    RESIZE_DEBOUNCE_MS: 150      // Debounce delay for window resize handler
  };
  
  const LIMITS = {
    MIN_HANDICAP: -50,
    MAX_HANDICAP: 60,
    MIN_SCORE: 1,
    MAX_SCORE: 20
  };
  
  // Game scoring constants
  const GAME_CONSTANTS = {
    JUNK: {
      POINTS: {
        EAGLE: 4,
        BIRDIE: 2,
        PAR: 1,
        BOGEY: 0
      },
      ACHIEVEMENTS: {
        HOGAN: 5,
        SANDY: 3,
        SADAAM: 2,
        PULLEY: 1,
        TRIPLE: 10
      }
    },
    VEGAS: {
      MULTIPLIERS: {
        DEFAULT: 1,
        BIRDIE: 2,
        EAGLE: 3
      }
    },
    SKINS: {
      DEFAULT_BUYIN: 10
    }
  };
  
  // Expose game constants globally for game modules
  window.GAME_CONSTANTS = GAME_CONSTANTS;

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
    },
    
    /** Get player rows from both tables (avoids duplicate queries) */
    getPlayerRows: () => ({
      scrollable: Array.from(document.querySelectorAll('#scorecard .player-row')),
      fixed: Array.from(document.querySelectorAll('#scorecardFixed .player-row'))
    }),
    
    /**
     * Debounce function execution
     * @param {Function} fn - Function to debounce
     * @param {number} delay - Delay in milliseconds
     * @returns {Function} Debounced function
     */
    debounce: (fn, delay) => {
      let timer = null;
      return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      };
    },
    
    /**
     * Throttle function execution
     * @param {Function} fn - Function to throttle
     * @param {number} limit - Time limit in milliseconds
     * @returns {Function} Throttled function
     */
    throttle: (fn, limit) => {
      let inThrottle = false;
      return function(...args) {
        if (!inThrottle) {
          fn.apply(this, args);
          inThrottle = true;
          setTimeout(() => inThrottle = false, limit);
        }
      };
    },
    
    /**
     * Safe DOM query with error handling
     * @param {string} selector - CSS selector
     * @param {Document|Element} parent - Parent element
     * @param {string} context - Context for error message
     * @returns {Element|null} Element or null if not found
     */
    safeQuery: (selector, parent = document, context = 'DOM') => {
      try {
        const el = parent.querySelector(selector);
        if (!el) {
          console.warn(`[${context}] Element not found: ${selector}`);
        }
        return el;
      } catch (error) {
        console.error(`[${context}] Query error for ${selector}:`, error);
        return null;
      }
    },
    
    /**
     * Validate and sanitize input value
     * @param {any} value - Value to validate
     * @param {string} type - Type of validation ('score', 'handicap', 'name')
     * @returns {any} Validated value
     */
    validate: (value, type) => {
      switch (type) {
        case 'score': {
          const num = Number(value);
          if (!Number.isFinite(num)) return null;
          return Math.max(LIMITS.MIN_SCORE, Math.min(LIMITS.MAX_SCORE, Math.floor(num)));
        }
        case 'handicap': {
          const num = Number(value);
          if (!Number.isFinite(num)) return null;
          return Math.max(LIMITS.MIN_HANDICAP, Math.min(LIMITS.MAX_HANDICAP, num));
        }
        case 'name': {
          return String(value || '').trim().substring(0, 50);
        }
        default:
          return value;
      }
    }
  };
  
  // Legacy globals for backward compatibility
  const $ = Utils.$;
  const $$ = Utils.$$;
  const sum = Utils.sum;
  const clampInt = Utils.clampInt;
  
  // =============================================================================
  // ERROR NOTIFICATION SYSTEM
  // =============================================================================
  
  /**
   * Error notification system for user-friendly error messages
   */
  const ErrorHandler = {
    /**
     * Show error toast notification
     * @param {string} message - User-friendly error message
     * @param {string|null} details - Technical details (optional)
     * @param {number} duration - Display duration in ms
     */
    show(message, details = null, duration = 5000) {
      const existingToast = document.querySelector('.error-toast');
      if (existingToast) existingToast.remove();
      
      const toast = document.createElement('div');
      toast.className = 'error-toast';
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'assertive');
      toast.innerHTML = `
        <div class="error-content">
          <div class="error-icon">⚠️</div>
          <div class="error-body">
            <div class="error-message">${this.escapeHtml(message)}</div>
            ${details ? `<div class="error-details">${this.escapeHtml(details)}</div>` : ''}
          </div>
          <button class="error-close" aria-label="Close">×</button>
        </div>
      `;
      
      const closeBtn = toast.querySelector('.error-close');
      closeBtn.addEventListener('click', () => toast.remove());
      
      document.body.appendChild(toast);
      
      // Animate in
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });
      
      // Auto-remove
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
      }, duration);
      
      // Log for debugging
      console.error('[App Error]', message, details || '');
    },
    
    /**
     * Show success notification
     * @param {string} message - Success message
     * @param {number} duration - Display duration in ms
     */
    success(message, duration = 3000) {
      const existingToast = document.querySelector('.success-toast');
      if (existingToast) existingToast.remove();
      
      const toast = document.createElement('div');
      toast.className = 'success-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = `
        <div class="success-content">
          <div class="success-icon">✓</div>
          <div class="success-message">${this.escapeHtml(message)}</div>
        </div>
      `;
      
      document.body.appendChild(toast);
      
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });
      
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },
    
    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  };
  
  // Expose globally
  window.ErrorHandler = ErrorHandler;

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
    holesHeaderFixed:"#holesHeaderFixed",parRowFixed:"#parRowFixed",hcpRowFixed:"#hcpRowFixed",totalsRowFixed:"#totalsRowFixed",
    table:"#scorecard",
    tableFixed:"#scorecardFixed",
    resetBtn:"#resetBtn",clearAllBtn:"#clearAllBtn",saveBtn:"#saveBtn",saveStatus:"#saveStatus",

    // Games toggles
    toggleVegas:"#toggleVegas", toggleBanker:"#toggleBanker", toggleSkins:"#toggleSkins", toggleHilo:"#toggleHilo",
    vegasSection:"#vegasSection", bankerSection:"#bankerSection", skinsSection:"#skinsSection", hiloSection:"#hiloSection", junkSection:"#junkSection",

    // Vegas
  vegasTeams:"#vegasTeams", vegasTeamWarning:"#vegasTeamWarning",
  vegasTableBody:"#vegasBody", vegasTotalA:"#vegasTotalA", vegasTotalB:"#vegasTotalB", vegasPtsA:"#vegasPtsA", vegasPtsB:"#vegasPtsB",
  optUseNet:"#optUseNet", optDoubleBirdie:"#optDoubleBirdie", optTripleEagle:"#optTripleEagle",
  vegasPointValue:"#vegasPointValue", vegasDollarA:"#vegasDollarA", vegasDollarB:"#vegasDollarB",

    // Skins
    skinsModeGross:"#skinsModeGross", skinsModeNet:"#skinsModeNet",
    skinsCarry:"#skinsCarry", skinsHalf:"#skinsHalf",
    skinsBody:"#skinsBody",
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
        const tbodyFixed=$(ids.tableFixed).tBodies[0];
        
        for(let p=0;p<PLAYERS;p++){
          // Create row for scrollable table (scores only)
          const tr=document.createElement("tr"); 
          tr.className="player-row"; 
          tr.dataset.player=String(p);
          
          // Create row for fixed table (name + CH only)
          const trFixed=document.createElement("tr"); 
          trFixed.className="player-row"; 
          trFixed.dataset.player=String(p);

          // Name input (in fixed table)
          const nameTd=document.createElement("td");
          
          // Create container for delete button and name input
          const nameCellContainer = document.createElement("div");
          nameCellContainer.className = "name-cell-container";
          
          // Delete button
          const deleteBtn = document.createElement("button");
          deleteBtn.className = "player-delete-btn";
          deleteBtn.textContent = "−";
          deleteBtn.title = "Remove player";
          deleteBtn.type = "button";
          deleteBtn.addEventListener("click", () => {
            // Get current index dynamically from the row's dataset
            const currentIndex = Number(trFixed.dataset.player);
            Scorecard.player.removeByIndex(currentIndex);
          });
          
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
          
          nameCellContainer.appendChild(deleteBtn);
          nameCellContainer.appendChild(nameInput);
          nameTd.appendChild(nameCellContainer); 
          trFixed.appendChild(nameTd);

          // Course Handicap input (in fixed table)
          const chTd=document.createElement("td");
          
          const chInput=document.createElement("input"); 
          chInput.type="number"; 
          chInput.inputMode="decimal"; 
          chInput.className="ch-input"; 
          chInput.value="0"; 
          chInput.min="-20"; 
          chInput.max="54"; 
          chInput.step="1"; 
          chInput.autocomplete="off";
          
          chInput.addEventListener("input", () => { 
            if(chInput.value !== "") {
              const clamped = clampInt(chInput.value, LIMITS.MIN_HANDICAP, LIMITS.MAX_HANDICAP);
              if(String(clamped) !== chInput.value) {
                chInput.value = clamped;
                return; // Let the new input event handle the recalc
              }
            }
            Scorecard.calc.recalcAll(); 
            AppManager.recalcGames();
            // Only apply highlighting if not currently loading from storage
            if (!Storage._isLoading) {
              Scorecard.calc.applyStrokeHighlighting();
            }
            Storage.saveDebounced(); 
          });
          chTd.appendChild(chInput); 
          trFixed.appendChild(chTd);

          // Score inputs for each hole (in scrollable table)
          for(let h=1; h<=HOLES; h++){
            const td=document.createElement("td"), inp=document.createElement("input");
            inp.type="number"; 
            inp.inputMode="numeric"; 
            inp.min=String(LIMITS.MIN_SCORE); 
            inp.max=String(LIMITS.MAX_SCORE); 
            inp.className="score-input"; 
            inp.dataset.player=String(p); 
            inp.dataset.hole=String(h); 
            inp.placeholder="—";
            inp.autocomplete="off";
            if(h === 18) td.classList.add('hole-18'); // Add class for styling divider
            
            inp.addEventListener("input", () => { 
              if(inp.value !== ""){
                const v = clampInt(inp.value, LIMITS.MIN_SCORE, LIMITS.MAX_SCORE); 
                if(String(v) !== inp.value) {
                  inp.classList.add("invalid"); 
                } else {
                  inp.classList.remove("invalid"); 
                }
                inp.value = v;
                
                // Auto-advance based on configured direction
                const currentPlayer = Number(inp.dataset.player);
                const currentHole = Number(inp.dataset.hole);
                
                if(inp.value.length >= 1) {
                  let nextInput = null;
                  
                  if(Config.ADVANCE_DIRECTION === 'down') {
                    // Move to next player on same hole
                    if(currentPlayer < PLAYERS - 1) {
                      nextInput = document.querySelector(
                        `.score-input[data-player="${currentPlayer+1}"][data-hole="${currentHole}"]`
                      );
                    }
                  } else {
                    // Move to next hole for same player
                    if(currentHole < HOLES - 1) {
                      nextInput = document.querySelector(
                        `.score-input[data-player="${currentPlayer}"][data-hole="${currentHole+1}"]`
                      );
                    }
                  }
                  
                  if(nextInput) {
                    setTimeout(() => nextInput.focus(), TIMING.FOCUS_DELAY_MS);
                  }
                }
              } else {
                inp.classList.remove("invalid");
              }
              Scorecard.calc.recalcRow(tr); 
              Scorecard.calc.recalcTotalsRow(); 
              AppManager.recalcGames();
              // Only apply highlighting if not currently loading from storage
              if (!Storage._isLoading) {
                Scorecard.calc.applyStrokeHighlighting();
              }
              Storage.saveDebounced(); 
            });
            td.appendChild(inp); 
            tr.appendChild(td);
          }

          // Summary cells: Out, In, Total, To Par, Net (in scrollable table)
          const outTd=document.createElement("td"); outTd.className="split";
          const inTd=document.createElement("td"); inTd.className="split";
          const totalTd=document.createElement("td"); totalTd.className="total";
          const toParTd=document.createElement("td"); toParTd.className="to-par";
          const netTd=document.createElement("td"); netTd.className="net";
          tr.append(outTd,inTd,totalTd,toParTd,netTd);

          tbody.appendChild(tr);
          tbodyFixed.appendChild(trFixed);
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
      },

      /**
       * Sync row heights between fixed and scrollable tables
       * This ensures perfect vertical alignment on all devices
       */
    syncRowHeights(skipHighlighting = false) {        const fixedTable = $(ids.tableFixed);
        const scrollTable = $(ids.table);
        
        if (!fixedTable || !scrollTable) return;
        
        const fixedRows = Array.from(fixedTable.querySelectorAll('tr'));
        const scrollRows = Array.from(scrollTable.querySelectorAll('tr'));
        
        // Reset heights to auto to allow natural sizing
        [...fixedRows, ...scrollRows].forEach(row => {
          row.style.height = 'auto';
        });
        
        // Force multiple layout recalculations
        void fixedTable.offsetHeight;
        void scrollTable.offsetHeight;
        
        // Small delay to ensure layout completes
        requestAnimationFrame(() => {
          // Sync each row pair
          const maxRows = Math.max(fixedRows.length, scrollRows.length);
          for (let i = 0; i < maxRows; i++) {
            const fixedRow = fixedRows[i];
            const scrollRow = scrollRows[i];
            
            if (fixedRow && scrollRow) {
              // Get fresh measurements
              const fixedHeight = fixedRow.getBoundingClientRect().height;
              const scrollHeight = scrollRow.getBoundingClientRect().height;
              const maxHeight = Math.max(fixedHeight, scrollHeight);
              
              // Apply explicit heights
              fixedRow.style.height = `${maxHeight}px`;
              scrollRow.style.height = `${maxHeight}px`;
            }
          }
        });
        
        // Note: Stroke highlighting is managed by recalcAll() with proper timing
        // Do not call applyStrokeHighlighting() here to avoid race conditions
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
        const fixedRows = $$("#scorecardFixed .player-row");
        const chs = fixedRows.map(r => { 
          const chInput = $(".ch-input", r);
          const v = Number(chInput?.value);
          return Number.isFinite(v) ? v : 0; 
        });
        const minCH = Math.min(...chs);
        return chs.map(ch => ch - minCH); // play off low
      },

      /**
       * Calculate strokes received on a specific hole
       * @param {number} adjCH - Adjusted course handicap
       * @param {number} holeIdx - Zero-based hole index
       * @returns {number} Number of strokes on this hole
       */
      strokesOnHole(adjCH, holeIdx){
        if(adjCH<=0) return 0;
        
        // Defensive check: ensure Config.hcpMen is initialized
        if(!Config.hcpMen || !Array.isArray(Config.hcpMen) || Config.hcpMen.length === 0) {
          console.error('[strokesOnHole] Config.hcpMen not initialized!', Config.hcpMen);
          return 0;
        }
        
        const base=Math.floor(adjCH/18), rem=adjCH%18;
        const holeHcp = Config.hcpMen[holeIdx];
        
        // Defensive check: ensure holeHcp is a valid number
        if(typeof holeHcp !== 'number' || !Number.isFinite(holeHcp)) {
          console.error(`[strokesOnHole] Invalid holeHcp at index ${holeIdx}:`, holeHcp, 'Config.hcpMen:', Config.hcpMen);
          return 0;
        }
        
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
       * @param {HTMLElement} rowEl - Player row element (from #scorecard)
       * @param {number} playerAdjCH - Optional pre-calculated adjusted CH for this player
       */
      recalcRow(rowEl, playerAdjCH){
        const s = Scorecard.calc.getPlayerHoleValues(rowEl);
        // Standard golf: Out = front 9, In = back 9
        const out=sum(s.slice(0,9)), inn=sum(s.slice(9,18)), total=out+inn;
        const splits = rowEl.querySelectorAll("td.split");
        if(splits[0]) splits[0].textContent = out ? String(out) : "—";
        if(splits[1]) splits[1].textContent = inn ? String(inn) : "—";
        const totalEl = $(".total",rowEl);
        if(totalEl) totalEl.replaceChildren(document.createTextNode(total||"—"));

        const parTotal = sum(PARS);
        const delta = (total && parTotal) ? total - parTotal : 0;
        const el = $(".to-par", rowEl);
        
        if(el) {
          if(!total){ 
            el.textContent = "—"; 
            el.dataset.sign = ""; 
          } else { 
            const sign = delta === 0 ? "0" : delta > 0 ? "+" : "-"; 
            el.dataset.sign = sign; 
            el.textContent = (delta > 0 ? "+" : "") + delta; 
          }
        }

        // Calculate net score with NDB (Net Double Bogey) cap and apply stroke highlighting
        const pIdx = Number(rowEl.dataset.player);
        
        // Use pre-calculated adjCH if provided, otherwise calculate it
        if(playerAdjCH === undefined) {
          const adjCHs = Scorecard.calc.adjustedCHs();
          playerAdjCH = adjCHs[pIdx];
        }
        
        let netTotal = 0;
        
        // Get all score inputs for this player to apply stroke highlighting
        const scoreInputs = $$("input.score-input", rowEl);
        
        for(let h=0; h<HOLES; h++){
          const gross = s[h] || 0;
          const sr = Scorecard.calc.strokesOnHole(playerAdjCH, h);
          const ndb = PARS[h] + NDB_BUFFER + sr;
          const adjGross = Math.min(gross, ndb);
          if(gross) netTotal += adjGross - sr;
          
          // Apply stroke highlighting to all holes (not just those with scores)
          const input = scoreInputs[h];
          if(!input) continue;
          
          if(sr > 0) {
            input.classList.add("receives-stroke");
            input.dataset.strokes = String(sr);
            input.title = `Receives ${sr} stroke${sr > 1 ? 's' : ''}`;
          } else {
            input.classList.remove("receives-stroke");
            input.removeAttribute("data-strokes");
            input.removeAttribute("title");
          }
        }
        
        const netEl = $(".net", rowEl);
        if(netEl) netEl.textContent = netTotal ? String(netTotal) : "—";
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
        const OUT=$$("#scorecard .player-row").map(r=>{ 
          const s=r.querySelectorAll("td.split"); 
          return Number(s[0]?.textContent)||0; 
        }).reduce((a,b)=>a+b,0);
        const INN=$$("#scorecard .player-row").map(r=>{ 
          const s=r.querySelectorAll("td.split"); 
          return Number(s[1]?.textContent)||0; 
        }).reduce((a,b)=>a+b,0);
        const TOT=$$("#scorecard .player-row").map(r=>Number($(".total",r)?.textContent)||0).reduce((a,b)=>a+b,0);
        tds[base+0].textContent=OUT||"—"; 
        tds[base+1].textContent=INN||"—"; 
        tds[base+2].textContent=TOT||"—";
      },

      /**
       * Recalculate all player rows and totals row
       */
      recalcAll(){ 
        // Throttle to prevent rapid repeated calls
        const now = Date.now();
        if(this._lastRecalcAll && (now - this._lastRecalcAll) < 100) {
          return;
        }
        this._lastRecalcAll = now;
        
        // Calculate adjusted CHs once for all players
        const adjCHs = Scorecard.calc.adjustedCHs();
        
        // Pass adjCHs to each recalcRow to avoid recalculating
        $$("#scorecard .player-row").forEach(row => {
          const pIdx = Number(row.dataset.player);
          Scorecard.calc.recalcRow(row, adjCHs[pIdx]);
        });
        
        Scorecard.calc.recalcTotalsRow();
        
        // NOTE: Highlighting is applied separately after page load completes
        // Do NOT call applyStrokeHighlighting() here during normal recalc
      },
      
      /**
       * Apply stroke highlighting to all score inputs based on adjusted handicaps
       * This is called after recalcAll and can be called independently after DOM operations
       */
      applyStrokeHighlighting() {
        const adjCHs = Scorecard.calc.adjustedCHs();
        
        $$("#scorecard .player-row").forEach(row => {
          const pIdx = Number(row.dataset.player);
          const playerAdjCH = adjCHs[pIdx];
          const scoreInputs = $$("input.score-input", row);
          
          for(let h=0; h<HOLES; h++){
            const holeHcp = Config.hcpMen[h];
            const sr = Scorecard.calc.strokesOnHole(playerAdjCH, h);
            const input = scoreInputs[h];
            if(!input) continue;
            
            if(sr > 0) {
              input.classList.add("receives-stroke");
              input.dataset.strokes = String(sr);
              input.title = `Receives ${sr} stroke${sr > 1 ? 's' : ''}`;
              
              // FORCE inline styles as backup (nuclear option for testing)
              if(sr === 1) {
                input.style.border = '2px solid var(--accent)';
                input.style.boxShadow = '0 0 0 1px var(--accent)';
              } else if(sr === 2) {
                input.style.border = '2px solid var(--accent)';
                input.style.boxShadow = '0 0 0 6px var(--bg), 0 0 0 8px var(--accent)';
              } else {
                input.style.border = '2px solid var(--accent)';
                input.style.boxShadow = '0 0 0 6px var(--bg), 0 0 0 8px var(--accent), 0 0 0 12px var(--bg), 0 0 0 14px var(--accent)';
              }
            } else {
              input.classList.remove("receives-stroke");
              input.removeAttribute("data-strokes");
              input.removeAttribute("title");
              input.style.border = '';
              input.style.boxShadow = '';
            }
          }
        });
      }
    },

    // ========== PLAYER MANAGEMENT ==========
    player: {
      /**
       * Add a new player row to both tables
       */
      add: addPlayer,
      
      /**
       * Remove the last player row from both tables
       */
      remove: removePlayer,
      
      /**
       * Remove a specific player by index with confirmation
       * @param {number} playerIndex - Zero-based player index to remove
       */
      removeByIndex: removePlayerByIndex,
      
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
        
        // Add player rows - sync with actual player inputs from fixed table
        const playerRows = document.querySelectorAll('#scorecardFixed .player-row');
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
        
        // Update Config object first (source of truth)
        Config.switchCourse(courseId);
        
        // Update module-level variables (for backward compatibility)
        ACTIVE_COURSE = courseId;
        PARS = Config.pars;
        HCPMEN = Config.hcpMen;
        
        // Update global references (for Skins/Junk/Vegas modules)
        window.PARS = PARS;
        window.HCPMEN = HCPMEN;
        window.ACTIVE_COURSE = ACTIVE_COURSE;
        
        // Rebuild par and HCP rows with new values
        Scorecard.course.updateParAndHcpRows();
        
        // Recalculate all player scores and net values (uses new PARS and HCPMEN for stroke allocation)
        Scorecard.calc.recalcAll();
        
        // Recalculate all game modes (Vegas, Skins, Junk) with new stroke allocations
        AppManager.recalcGames();
        
        // Force refresh Vegas if it's open (ensures multipliers recalculate with new HCPMEN)
        const vegasSection = document.getElementById('vegasSection');
        if(vegasSection?.classList.contains('open')){
          window.Vegas?.recalc();
        }
        
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
    CURRENT_VERSION: 5,
    saveTimer: null,
    _isLoading: false,
    
    /**
     * Migration functions for each version upgrade
     * Each function transforms data from version N to N+1
     */
    migrations: {
      /**
       * Migrate from v4 to v5
       * @param {Object} oldData - v4 data structure
       * @returns {Object} v5 data structure
       */
      v4_to_v5(oldData) {
        console.log('[Storage] Migrating v4 -> v5');
        return {
          ...oldData,
          // v5 added advance direction
          advanceDirection: oldData.advanceDirection || 'down',
          // v5 added Hi-Lo game
          hilo: oldData.hilo || { open: false, unitValue: 10 },
          // v5 added Junk achievements
          junk: {
            ...oldData.junk,
            achievements: oldData.junk?.achievements || []
          }
        };
      },
      
      /**
       * Template for future v5 to v6 migration
       * @param {Object} oldData - v5 data structure
       * @returns {Object} v6 data structure
       */
      v5_to_v6(oldData) {
        console.log('[Storage] Migrating v5 -> v6');
        // Add new fields for v6 here
        return {
          ...oldData,
          version: 6
        };
      }
    },
    
    /**
     * Attempt to migrate data from older versions
     * @returns {Object|null} Migrated data or null if no migration needed
     */
    attemptMigration() {
      try {
        // Try to load from v4
        const v4Data = localStorage.getItem('golf_scorecard_v4');
        if (v4Data) {
          console.log('[Storage] Found v4 data, attempting migration');
          const parsed = JSON.parse(v4Data);
          const migrated = this.migrations.v4_to_v5(parsed);
          
          // Save migrated data to v5
          localStorage.setItem(this.KEY, JSON.stringify(migrated));
          
          // Keep v4 data as backup
          localStorage.setItem('golf_scorecard_v4_backup', v4Data);
          
          ErrorHandler.success('Data migrated from previous version!');
          return migrated;
        }
        
        return null;
      } catch (error) {
        console.error('[Storage] Migration failed:', error);
        ErrorHandler.show('Failed to migrate old data', 'Starting with fresh scorecard');
        return null;
      }
    },
    
    /**
     * Save current game state to localStorage
     * @returns {boolean} Success status
     */
    save() {
      try {
        const scoreRows = $$("#scorecard .player-row");
        const fixedRows = $$("#scorecardFixed .player-row");
        
        if (scoreRows.length === 0 || fixedRows.length === 0) {
          console.warn('[Storage] No player rows found, skipping save');
          return false;
        }
        
        const state = {
          version: this.CURRENT_VERSION,
        course: ACTIVE_COURSE,
        advanceDirection: Config.ADVANCE_DIRECTION,
        players: scoreRows.map((row, idx) => {
          const fixedRow = fixedRows[idx];
          const scoreInputs = $$("input.score-input", row);
          const scores = scoreInputs.map(i => i.value);
          const playerData = {
            name: fixedRow ? $(".name-edit", fixedRow).value || "" : "",
            ch: fixedRow ? $(".ch-input", fixedRow).value || "" : "",
            scores: scores
          };
          console.log(`[Storage] Player ${idx}:`, playerData.name, 'CH:', playerData.ch, 'Scores:', scores);
          return playerData;
        }),
        vegas: { 
          teams: window.Vegas?.getTeamAssignments(), 
          opts: window.Vegas?.getOptions(), 
          open: $(ids.vegasSection).classList.contains("open") 
        },
        banker: { 
          open: $(ids.bankerSection).classList.contains("open") 
        },
        skins: { 
          mode: document.getElementById('skinsModeNet')?.checked ? 'net' : 'gross',
          buyIn: Number(document.getElementById('skinsBuyIn')?.value) || 10,
          carry: document.getElementById('skinsCarry')?.checked ?? true,
          half: document.getElementById('skinsHalf')?.checked ?? false,
          open: $(ids.skinsSection)?.classList.contains("open") 
        },
        junk: {
          useNet: document.getElementById('junkUseNet')?.checked ?? false,
          open: $(ids.junkSection)?.classList.contains("open"),
          achievements: (typeof window.Junk?.getAchievementState === 'function') ? window.Junk.getAchievementState() : []
        },
        hilo: {
          unitValue: Number(document.getElementById('hiloUnitValue')?.value) || 10,
          open: $(ids.hiloSection)?.classList.contains("open")
        },
          savedAt: Date.now(),
        };
        
        // Validate state before saving
        if (!state.course || !state.players) {
          throw new Error('Invalid state structure');
        }
        
        const serialized = JSON.stringify(state);
        
        // Check localStorage quota
        if (serialized.length > 5000000) { // 5MB limit
          throw new Error('State too large to save');
        }
        
        localStorage.setItem(this.KEY, serialized);
        Utils.announce("Saved.");
        if(typeof announce === 'function') announce("Saved!");
        return true;
        
      } catch(err) {
        console.error('[Storage] Save failed:', err);
        ErrorHandler.show('Failed to save scorecard', err.message);
        Utils.announce("Save failed!");
        if(typeof announce === 'function') announce("Save failed!");
        return false;
      }
    },
    
    /**
     * Debounced save - waits 300ms after last change before saving
     */
    saveDebounced() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), TIMING.RECALC_DEBOUNCE_MS);
    },
    
    /**
     * Load saved game state from localStorage
     * @returns {boolean} Success status
     */
    load() {
      this._isLoading = true;
      
      try {
        let raw = localStorage.getItem(this.KEY);
        
        // If no current version data, try migration
        if (!raw) {
          const migrated = this.attemptMigration();
          if (migrated) {
            raw = JSON.stringify(migrated);
          } else {
            this._isLoading = false;
            return false;
          }
        }
        
        if (!raw) {
          this._isLoading = false;
          return false;
        }
        const s = JSON.parse(raw);
        
        // Restore course selection
        if(s.course && COURSES[s.course]){
          const courseSelect = $('#courseSelect');
          if(courseSelect) courseSelect.value = s.course;
          if(s.course !== ACTIVE_COURSE){
            Scorecard.course.switch(s.course);
          }
        }
        
        // Restore advance direction
        if(s.advanceDirection) {
          Config.ADVANCE_DIRECTION = s.advanceDirection;
          const label = document.getElementById('advanceLabel');
          if(label) {
            label.textContent = Config.ADVANCE_DIRECTION === 'down' ? 'Advance: ↓ Down' : 'Advance: → Right';
          }
        }
        
        // CRITICAL: Explicitly query each table to avoid ambiguity
        let scoreRows = $$("#scorecard .player-row");  // Scrollable table with scores
        let fixedRows = $$("#scorecardFixed .player-row");  // Fixed table with names/CH
        
        // Add more players if saved data has more than current row count
        if (s.players && s.players.length > scoreRows.length) {
          const needed = s.players.length - scoreRows.length;
          for (let i = 0; i < needed && PLAYERS < MAX_PLAYERS; i++) {
            addPlayer();
          }
          // Refresh queries after adding rows
          scoreRows = $$("#scorecard .player-row");
          fixedRows = $$("#scorecardFixed .player-row");
        }
        
        s.players?.forEach((p, i) => { 
          const r = scoreRows[i]; 
          const fixedR = fixedRows[i];
          if(!r || !fixedR) return;
          
          $(".name-edit", fixedR).value = p.name || "";
          $(".ch-input", fixedR).value = (p.ch !== undefined && p.ch !== null && p.ch !== "") ? p.ch : "0";
          
          const ins = $$("input.score-input", r);
          p.scores?.forEach((v, j) => { 
            if(ins[j]) ins[j].value = v;
          });
        });
        
      Scorecard.calc.recalcAll();
      Scorecard.player.syncOverlay();
      
      // Use setTimeout to ensure highlighting runs after all event handlers settle
      // Keep _isLoading flag true until highlighting is complete to prevent race conditions
      setTimeout(() => {
        Scorecard.calc.applyStrokeHighlighting();
        // Clear loading flag AFTER highlighting is applied
        this._isLoading = false;
      }, 0);
      
        // Restore game states
        window.Vegas?.renderTeamControls();
        if(s.vegas?.teams) window.Vegas?.setTeamAssignments(s.vegas.teams);
        if(s.vegas?.opts) window.Vegas?.setOptions(s.vegas.opts);
        // Games default to closed - only open if previously saved as open
        // if(s.vegas?.open) games_open("vegas");
        // if(s.banker?.open) games_open("banker");

        // Restore Skins options
        if(s.skins?.mode != null) {
          const modeGrossEl = document.getElementById('skinsModeGross');
          const modeNetEl = document.getElementById('skinsModeNet');
          if(s.skins.mode === 'net') {
            if(modeNetEl) modeNetEl.checked = true;
          } else {
            if(modeGrossEl) modeGrossEl.checked = true;
          }
        }
        if(s.skins?.buyIn != null) {
          const buyInEl = document.getElementById('skinsBuyIn');
          if(buyInEl) buyInEl.value = s.skins.buyIn;
        }
        if(s.skins?.carry != null) {
          const carryEl = document.getElementById('skinsCarry');
          if(carryEl) carryEl.checked = s.skins.carry;
        }
        if(s.skins?.half != null) {
          const halfEl = document.getElementById('skinsHalf');
          if(halfEl) halfEl.checked = s.skins.half;
        }
        // if(s.skins?.open) games_open("skins");
        
        // Restore Junk options
        if(s.junk?.useNet != null) {
          const useNetEl = document.getElementById('junkUseNet');
          if(useNetEl) useNetEl.checked = s.junk.useNet;
        }
        // Restore achievements even if section is closed
        if(s.junk?.achievements) {
          setTimeout(() => {
            if(window.Junk && typeof window.Junk.setAchievementState === 'function') {
              window.Junk.setAchievementState(s.junk.achievements);
            }
          }, 150);
        }
        // if(s.junk?.open) games_open("junk");
        
        // Restore Hi-Lo options
        if(s.hilo?.unitValue != null) {
          const unitValueEl = document.getElementById('hiloUnitValue');
          if(unitValueEl) unitValueEl.value = s.hilo.unitValue;
        }
        // if(s.hilo?.open) games_open("hilo");

        // Recalculate all games with restored data
        AppManager.recalcGames();
        
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
      Scorecard.player.syncOverlay();
      window.Vegas?.renderTeamControls(); 
      AppManager.recalcGames();
      
      // Clear Junk achievements
      if(window.Junk && typeof window.Junk.clearAllAchievements === 'function') {
        window.Junk.clearAllAchievements();
      }
      
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
  
  // Expose announce globally for external modules
  window.announce = announce;
  
  // Use Storage's announce which uses Utils.announce
  // Legacy alias maintained here for backward compatibility

  // =============================================================================
  // GAMES UI - Toggle game sections (Vegas, Banker, Skins, Junk)
  // =============================================================================
  
  /**
   * Open a game section and make it visible
   * @param {string} which - Game section: 'vegas', 'banker', 'skins', 'junk', or 'hilo'
   * @throws {Error} If game section not found
   */
  function games_open(which){
    try {
      const gameConfig = {
        vegas: { section: ids.vegasSection, toggle: ids.toggleVegas, init: null },
        banker: { section: ids.bankerSection, toggle: ids.toggleBanker, init: () => window.Banker?.init() },
        skins: { section: ids.skinsSection, toggle: ids.toggleSkins, init: null },
        junk: { section: ids.junkSection, toggle: 'toggleJunk', init: () => window.Junk?.init() },
        hilo: { section: ids.hiloSection, toggle: ids.toggleHilo, init: () => window.HiLo?.init() }
      };
      
      const config = gameConfig[which];
      if (!config) {
        console.error(`[Games] Unknown game: ${which}`);
        return;
      }
      
      const section = typeof config.section === 'string' ? document.getElementById(config.section.replace('#', '')) : $(config.section);
      const toggleBtn = typeof config.toggle === 'string' ? document.getElementById(config.toggle) : $(config.toggle);
      
      if (!section) {
        ErrorHandler.show(`Cannot open ${which} game`, 'Game section not found in DOM');
        return;
      }
      
      section.classList.add('open');
      section.setAttribute('aria-hidden', 'false');
      if (toggleBtn) toggleBtn.classList.add('active');
      
      if (config.init) {
        try {
          config.init();
        } catch (error) {
          console.error(`[Games] Error initializing ${which}:`, error);
          ErrorHandler.show(`Error opening ${which}`, error.message);
        }
      }
    } catch (error) {
      console.error('[Games] Error in games_open:', error);
      ErrorHandler.show('Error opening game', error.message);
    }
  }
  /**
   * Close a game section
   * @param {string} which - Game section to close
   */
  function games_close(which){
    try {
      const gameConfig = {
        vegas: { section: ids.vegasSection, toggle: ids.toggleVegas },
        banker: { section: ids.bankerSection, toggle: ids.toggleBanker },
        skins: { section: ids.skinsSection, toggle: ids.toggleSkins },
        junk: { section: ids.junkSection, toggle: 'toggleJunk' },
        hilo: { section: ids.hiloSection, toggle: ids.toggleHilo }
      };
      
      const config = gameConfig[which];
      if (!config) return;
      
      const section = typeof config.section === 'string' ? document.getElementById(config.section.replace('#', '')) : $(config.section);
      const toggleBtn = typeof config.toggle === 'string' ? document.getElementById(config.toggle) : $(config.toggle);
      
      if (section) {
        section.classList.remove('open');
        section.setAttribute('aria-hidden', 'true');
      }
      if (toggleBtn) toggleBtn.classList.remove('active');
    } catch (error) {
      console.error('[Games] Error in games_close:', error);
    }
  }
  function games_toggle(which){
    let sec;
    if(which==="vegas") sec = $(ids.vegasSection);
    else if(which==="banker") sec = $(ids.bankerSection);
    else if(which==="skins") sec = $(ids.skinsSection);
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

    const rows = data.slice(1).filter(r => r.some(x => x && x !== "")).slice(0, 99);
    if (!rows.length) { alert("No data rows found under the header."); return; }

    // Create custom dialog for mode selection
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const dialogBox = document.createElement('div');
    dialogBox.style.cssText = `
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    `;
    
    const title = document.createElement('h3');
    title.textContent = 'Import CSV';
    title.style.cssText = 'margin: 0 0 12px 0; color: var(--ink);';
    
    const message = document.createElement('p');
    message.textContent = `Found ${rows.length} player(s) in CSV file.`;
    message.style.cssText = 'margin: 0 0 20px 0; color: var(--muted);';
    
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 12px;';
    
    const replaceBtn = document.createElement('button');
    replaceBtn.textContent = 'Replace Players';
    replaceBtn.className = 'btn';
    replaceBtn.style.cssText = 'flex: 1; background: var(--danger); color: white;';
    
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add Players';
    addBtn.className = 'btn';
    addBtn.style.cssText = 'flex: 1; background: var(--accent); color: var(--bg);';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn';
    cancelBtn.style.cssText = 'flex: 1;';
    
    btnContainer.append(replaceBtn, addBtn, cancelBtn);
    dialogBox.append(title, message, btnContainer);
    dialog.appendChild(dialogBox);
    document.body.appendChild(dialog);
    
    // Wait for user choice
    const mode = await new Promise((resolve) => {
      replaceBtn.onclick = () => { dialog.remove(); resolve('replace'); };
      addBtn.onclick = () => { dialog.remove(); resolve('add'); };
      cancelBtn.onclick = () => { dialog.remove(); resolve('cancel'); };
    });
    
    if (mode === 'cancel') return;

    // Get player rows from both tables
    const fixedTable = document.querySelector("#scorecardFixed");
    const scrollTable = document.querySelector("#scorecard");
    let fixedPlayerRows = fixedTable?.querySelectorAll(".player-row");
    let scrollPlayerRows = scrollTable?.querySelectorAll(".player-row");
    
    if (mode === 'replace') {
      // REPLACE MODE: Clear all and import from position 0
      // Ensure we have enough player slots
      const currentPlayerCount = fixedPlayerRows.length;
      const neededPlayers = rows.length;
      
      // Add more players if needed
      while (PLAYERS < neededPlayers) {
        addPlayer();
      }
      
      // Refresh player row references
      fixedPlayerRows = fixedTable?.querySelectorAll(".player-row");
      scrollPlayerRows = scrollTable?.querySelectorAll(".player-row");
      
      rows.forEach((r, idx) => {
        const obj = rowToPlayerObj(hmap, r);
        
        // Update name and CH in fixed table
        const fixedRow = fixedPlayerRows?.[idx];
        if (fixedRow) {
          const nameInput = fixedRow.querySelector(".name-edit");
          const chInput = fixedRow.querySelector(".ch-input");
          if (nameInput) nameInput.value = obj.player || `Player ${idx+1}`;
          if (chInput) chInput.value = (obj.ch === 0 || Number.isFinite(obj.ch)) ? String(obj.ch) : "";
        }
        
        // Update scores in scroll table (only first 18 inputs)
        const scrollRow = scrollPlayerRows?.[idx];
        if (scrollRow) {
          const inputs = scrollRow.querySelectorAll("input.score-input");
          for (let i = 0; i < 18; i++) {
            if (inputs[i]) {
              const v = obj.holes[i];
              inputs[i].value = (v === "" || isNaN(v)) ? "" : String(Math.max(1, Math.min(20, Math.trunc(v))));
              inputs[i].classList.remove("invalid");
            }
          }
        }
      });
      
      // Clear remaining players
      for (let i = rows.length; i < fixedPlayerRows.length; i++) {
        const fixedRow = fixedPlayerRows?.[i];
        const scrollRow = scrollPlayerRows?.[i];
        
        if (fixedRow) {
          const nameInput = fixedRow.querySelector(".name-edit");
          const chInput = fixedRow.querySelector(".ch-input");
          if (nameInput) nameInput.value = "";
          if (chInput) chInput.value = "";
        }
        
        if (scrollRow) {
          const inputs = scrollRow.querySelectorAll("input.score-input");
          // Only clear first 18 inputs
          for (let j = 0; j < Math.min(18, inputs.length); j++) {
            inputs[j].value = "";
            inputs[j].classList.remove("invalid");
          }
        }
      }
    } else {
      // ADD MODE: Find first empty player slot, add more slots if needed
      let startIdx = 0;
      for (let i = 0; i < fixedPlayerRows.length; i++) {
        const nameInput = fixedPlayerRows[i]?.querySelector(".name-edit");
        const hasName = nameInput?.value?.trim();
        if (!hasName) {
          startIdx = i;
          break;
        }
        if (i === fixedPlayerRows.length - 1) {
          // All slots full, start after last player
          startIdx = fixedPlayerRows.length;
          break;
        }
      }
      
      // Add more player slots if needed
      const availableSlots = fixedPlayerRows.length - startIdx;
      const neededSlots = rows.length - availableSlots;
      
      if (neededSlots > 0) {
        for (let i = 0; i < neededSlots; i++) {
          if (PLAYERS >= MAX_PLAYERS) break;
          addPlayer();
        }
      }
      
      // Refresh player row references
      fixedPlayerRows = fixedTable?.querySelectorAll(".player-row");
      scrollPlayerRows = scrollTable?.querySelectorAll(".player-row");
      
      // Add players starting from first empty slot
      rows.forEach((r, idx) => {
        const targetIdx = startIdx + idx;
        if (targetIdx >= fixedPlayerRows.length) return; // Skip if exceeds max
        
        const obj = rowToPlayerObj(hmap, r);
        
        const fixedRow = fixedPlayerRows?.[targetIdx];
        if (fixedRow) {
          const nameInput = fixedRow.querySelector(".name-edit");
          const chInput = fixedRow.querySelector(".ch-input");
          if (nameInput) nameInput.value = obj.player || `Player ${targetIdx+1}`;
          if (chInput) chInput.value = (obj.ch === 0 || Number.isFinite(obj.ch)) ? String(obj.ch) : "";
        }
        
        const scrollRow = scrollPlayerRows?.[targetIdx];
        if (scrollRow) {
          const inputs = scrollRow.querySelectorAll("input.score-input");
          for (let i = 0; i < 18; i++) {
            if (inputs[i]) {
              const v = obj.holes[i];
              inputs[i].value = (v === "" || isNaN(v)) ? "" : String(Math.max(1, Math.min(20, Math.trunc(v))));
              inputs[i].classList.remove("invalid");
            }
          }
        }
      });
    }

    Scorecard.calc.recalcAll();
    Scorecard.player.syncOverlay();
    
    // Update stroke highlights with new handicaps
    if(typeof window.updateStrokeHighlights === 'function') {
      window.updateStrokeHighlights();
    }
    
    // Force recalculate all games
    window.Vegas?.renderTeamControls();
    setTimeout(() => {
      AppManager.recalcGames();
      window.Skins?.refreshForPlayerChange();
      window.Junk?.refreshForPlayerChange();
      window.HiLo?.update();
    }, 100);
    
    Storage.save();
    announce("CSV imported and all calculations updated.");
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

  // Export functions moved to js/export.js module
  // These are wrapper functions that call the Export module
  function exportCurrentScorecard() {
    if(window.Export && typeof window.Export.exportCurrentScorecard === 'function') {
      window.Export.exportCurrentScorecard();
    } else {
      console.error('[Export] Export module not loaded or exportCurrentScorecard not found');
      announce('Export module not ready. Please refresh the page.');
    }
  }

  function emailCurrentScorecard() {
    if(window.Export && typeof window.Export.emailCurrentScorecard === 'function') {
      window.Export.emailCurrentScorecard();
    } else {
      console.error('[Export] Export module not loaded or emailCurrentScorecard not found');
      announce('Export module not ready. Please refresh the page.');
    }
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
    const tbodyFixed = $('#scorecardFixed').tBodies[0];
    const p = PLAYERS; // Current player index
    
    // Create new player row for scrollable table (scores only)
    const tr = document.createElement("tr");
    tr.className = "player-row";
    tr.dataset.player = String(p);
    
    // Create new player row for fixed table (name + CH only)
    const trFixed = document.createElement("tr");
    trFixed.className = "player-row";
    trFixed.dataset.player = String(p);
    
    // Name input (in fixed table)
    const nameTd = document.createElement("td");
    
    // Create container for delete button and name input
    const nameCellContainer = document.createElement("div");
    nameCellContainer.className = "name-cell-container";
    
    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "player-delete-btn";
    deleteBtn.textContent = "−";
    deleteBtn.title = "Remove player";
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", () => {
      // Get current index dynamically from the row's dataset
      const currentIndex = Number(trFixed.dataset.player);
      Scorecard.player.removeByIndex(currentIndex);
    });
    
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
    
    nameCellContainer.appendChild(deleteBtn);
    nameCellContainer.appendChild(nameInput);
    nameTd.appendChild(nameCellContainer);
    trFixed.appendChild(nameTd);
    
    // Course Handicap input (in fixed table)
    const chTd = document.createElement("td");
    const MIN_HANDICAP = -50;
    const MAX_HANDICAP = 60;
    const chInput = document.createElement("input");
    chInput.type = "number";
    chInput.inputMode = "decimal";
    chInput.className = "ch-input";
    chInput.value = "0";
    chInput.min = "-20";
    chInput.max = "54";
    chInput.step = "1";
    chInput.autocomplete = "off";
    chInput.addEventListener("input", () => {
      if(chInput.value !== "") {
        const clamped = clampInt(chInput.value, MIN_HANDICAP, MAX_HANDICAP);
        if(String(clamped) !== chInput.value) {
          chInput.value = clamped;
          return; // Let the new input event handle the recalc
        }
      }
      Scorecard.calc.recalcAll();
      AppManager.recalcGames();
      Storage.saveDebounced();
    });
    chTd.appendChild(chInput);
    trFixed.appendChild(chTd);
    
    // Score inputs for each hole (in scrollable table)
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
          
          // Auto-advance based on configured direction
          const currentPlayer = Number(inp.dataset.player);
          const currentHole = Number(inp.dataset.hole);
          
          if(inp.value.length >= 1) {
            let nextInput = null;
            
            if(Config.ADVANCE_DIRECTION === 'down') {
              // Move to next player on same hole
              if(currentPlayer < PLAYERS - 1) {
                nextInput = document.querySelector(
                  `.score-input[data-player="${currentPlayer + 1}"][data-hole="${currentHole}"]`
                );
              }
            } else {
              // Move to next hole for same player
              if(currentHole < HOLES - 1) {
                nextInput = document.querySelector(
                  `.score-input[data-player="${currentPlayer}"][data-hole="${currentHole + 1}"]`
                );
              }
            }
            
            if(nextInput) {
              setTimeout(() => nextInput.focus(), TIMING.FOCUS_DELAY_MS);
            }
          }
        } else {
          inp.classList.remove("invalid");
        }
        Scorecard.calc.recalcRow(tr);
        Scorecard.calc.recalcTotalsRow();
        AppManager.recalcGames();
        // Reapply highlighting after a brief delay to ensure it persists
        setTimeout(() => {
          Scorecard.calc.applyStrokeHighlighting();
        }, 150);
        Storage.saveDebounced();
      });
      
      td.appendChild(inp);
      tr.appendChild(td);
    }
    
    // Summary cells: Out, In, Total, To Par, Net (in scrollable table)
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
    tbodyFixed.appendChild(trFixed);
    
    // Increment player count
    PLAYERS++;
    
      // Update display and recalculate after DOM settles
      requestAnimationFrame(() => {
        Scorecard.player.updateCountDisplay();
        Scorecard.player.syncOverlay();
        recalculateEverything();
        // CRITICAL: Reapply stroke highlighting since adjusted handicaps changed
        Scorecard.calc.applyStrokeHighlighting();
        Scorecard.build.syncRowHeights();
      });    Storage.saveDebounced();
    Utils.announce(`Player ${PLAYERS} added.`);
  }
  
  /**
   * Show custom styled confirmation modal for player deletion
   * @param {string} playerName - Name of player to delete
   * @param {Function} callback - Callback function with boolean result
   */
  function showDeleteConfirmModal(playerName, callback) {
    const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';
    
    // Create modal backdrop
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: ${isLightTheme ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.85)'};
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.2s ease;
    `;
    
    // Create modal container
    const container = document.createElement('div');
    container.style.cssText = `
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      padding: var(--space-xl);
      max-width: 400px;
      width: 90%;
      box-shadow: ${isLightTheme ? '0 8px 32px rgba(0, 0, 0, 0.15)' : '0 8px 32px rgba(0, 0, 0, 0.4)'};
      animation: slideUp 0.3s ease;
    `;
    
    // Title
    const title = document.createElement('h3');
    title.textContent = 'Remove Player?';
    title.style.cssText = `
      margin: 0 0 var(--space-md) 0;
      color: var(--ink);
      font-size: var(--text-2xl);
    `;
    
    // Message
    const message = document.createElement('p');
    message.textContent = `Are you sure you want to remove ${playerName}? This action cannot be undone.`;
    message.style.cssText = `
      margin: 0 0 var(--space-xl) 0;
      color: var(--muted);
      font-size: var(--text-lg);
      line-height: 1.5;
    `;
    
    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      gap: var(--space-md);
      justify-content: flex-end;
    `;
    
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'delete-modal-cancel-btn';
    cancelBtn.style.cssText = `
      padding: var(--space-md) var(--space-xl);
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      border-radius: var(--radius-lg);
      font-size: var(--text-lg);
      cursor: pointer;
      min-height: var(--touch-min);
      transition: all 0.2s ease;
    `;
    
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Remove';
    deleteBtn.className = 'delete-modal-confirm-btn';
    deleteBtn.style.cssText = `
      padding: var(--space-md) var(--space-xl);
      border: 1px solid var(--danger);
      background: var(--danger);
      color: white;
      border-radius: var(--radius-lg);
      font-size: var(--text-lg);
      font-weight: 600;
      cursor: pointer;
      min-height: var(--touch-min);
      transition: all 0.2s ease;
    `;
    
    // Get computed colors for hover effects
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const dangerColor = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim();
    
    // Hover effects
    cancelBtn.onmouseover = () => {
      cancelBtn.style.background = accentColor;
      cancelBtn.style.color = isLightTheme ? '#ffffff' : '#000000';
      cancelBtn.style.borderColor = accentColor;
    };
    cancelBtn.onmouseout = () => {
      cancelBtn.style.background = 'var(--panel)';
      cancelBtn.style.color = 'var(--ink)';
      cancelBtn.style.borderColor = 'var(--line)';
    };
    
    deleteBtn.onmouseover = () => {
      deleteBtn.style.filter = 'brightness(1.1)';
      deleteBtn.style.transform = 'scale(1.02)';
    };
    deleteBtn.onmouseout = () => {
      deleteBtn.style.filter = 'brightness(1)';
      deleteBtn.style.transform = 'scale(1)';
    };
    
    // Close modal function
    const closeModal = (result) => {
      modal.style.animation = 'fadeOut 0.2s ease';
      setTimeout(() => {
        modal.remove();
        callback(result);
      }, 200);
    };
    
    // Event listeners
    cancelBtn.onclick = () => closeModal(false);
    deleteBtn.onclick = () => closeModal(true);
    modal.onclick = (e) => {
      if (e.target === modal) closeModal(false);
    };
    
    // Escape key to cancel
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeModal(false);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
    
    // Assemble and show
    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(deleteBtn);
    container.appendChild(title);
    container.appendChild(message);
    container.appendChild(buttonContainer);
    modal.appendChild(container);
    document.body.appendChild(modal);
    
    // Focus delete button for keyboard accessibility
    deleteBtn.focus();
  }
  
  /**
   * Remove a specific player by index with confirmation
   * @param {number} playerIndex - Zero-based player index to remove
   */
  function removePlayerByIndex(playerIndex) {
    if(PLAYERS <= MIN_PLAYERS) {
      Utils.announce(`Minimum ${MIN_PLAYERS} player required.`);
      return;
    }
    
    const rows = $$('#scorecard .player-row');
    const rowsFixed = $$('#scorecardFixed .player-row');
    const targetRow = rows[playerIndex];
    const targetRowFixed = rowsFixed[playerIndex];
    
    if(!targetRow || !targetRowFixed) {
      Utils.announce('Player not found.');
      return;
    }
    
    // Get player name for confirmation
    const nameInput = $('.name-edit', targetRowFixed);
    const playerName = nameInput?.value || `Player ${playerIndex + 1}`;
    
    // Show custom confirmation modal
    showDeleteConfirmModal(playerName, (confirmed) => {
      if (!confirmed) return;
      
      // Remove the rows
      targetRow.remove();
      targetRowFixed.remove();
      PLAYERS--;
      
      // Update remaining player indices
      const updatedRows = $$('#scorecard .player-row');
      const updatedRowsFixed = $$('#scorecardFixed .player-row');
      
      updatedRows.forEach((row, idx) => {
        row.dataset.player = String(idx);
        const scoreInputs = $$('input.score-input', row);
        scoreInputs.forEach(inp => {
          inp.dataset.player = String(idx);
        });
      });
      
      updatedRowsFixed.forEach((row, idx) => {
        row.dataset.player = String(idx);
        const nameInp = $('.name-edit', row);
        if(nameInp && !nameInp.value) {
          nameInp.placeholder = `Player ${idx + 1}`;
        }
      });
      
      // Update display and recalculate after DOM settles
      requestAnimationFrame(() => {
        Scorecard.player.updateCountDisplay();
        Scorecard.player.syncOverlay();
        recalculateEverything();
        // CRITICAL: Reapply stroke highlighting since adjusted handicaps changed
        Scorecard.calc.applyStrokeHighlighting();
        Scorecard.build.syncRowHeights();
      });
      
      Storage.saveDebounced();
      Utils.announce(`${playerName} removed. ${PLAYERS} player${PLAYERS === 1 ? '' : 's'} remaining.`);
    });
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
    
    const rows = $$('#scorecard .player-row');
    const rowsFixed = $$('#scorecardFixed .player-row');
    const lastRow = rows[rows.length - 1];
    const lastRowFixed = rowsFixed[rowsFixed.length - 1];
    
    if(lastRow && lastRowFixed) {
      // First, clear all data in both rows
      const nameInput = $(".name-edit", lastRowFixed);
      const chInput = $(".ch-input", lastRowFixed);
      const scoreInputs = $$("input.score-input", lastRow);
      
      if(nameInput) nameInput.value = '';
      if(chInput) chInput.value = '';
      scoreInputs.forEach(inp => inp.value = '');
      
      // Recalculate to update totals without this player's data
      Scorecard.calc.recalcRow(lastRow);
      Scorecard.calc.recalcTotalsRow();
      AppManager.recalcGames();
      
      // Now remove both rows
      lastRow.remove();
      lastRowFixed.remove();
      PLAYERS--;
      
      // Update display and recalculate after DOM settles
      requestAnimationFrame(() => {
        Scorecard.player.updateCountDisplay();
        Scorecard.player.syncOverlay();
        recalculateEverything();
        // CRITICAL: Reapply stroke highlighting since adjusted handicaps changed
        Scorecard.calc.applyStrokeHighlighting();
        Scorecard.build.syncRowHeights();
      });
      
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
    Scorecard.build.header(); Scorecard.build.parAndHcpRows(); Scorecard.build.playerRows(); Scorecard.build.totalsRow(); Scorecard.course.updateParBadge();
    Scorecard.player.syncOverlay();
    
    // Sync row heights after tables are built (skip highlighting on init - will be applied after data loads)
    requestAnimationFrame(() => {
      Scorecard.build.syncRowHeights(true);
    });

  $(ids.resetBtn).addEventListener("click", () => { Storage.clearScoresOnly(); });
  $(ids.clearAllBtn).addEventListener("click", async () => {
    // Create confirmation dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const dialogBox = document.createElement('div');
    dialogBox.style.cssText = `
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    `;
    
    const title = document.createElement('h3');
    title.textContent = 'Clear All Names & Scores?';
    title.style.cssText = 'margin: 0 0 12px 0; color: var(--ink);';
    
    const message = document.createElement('p');
    message.textContent = 'This will clear all player names, handicaps, and scores. This action cannot be undone.';
    message.style.cssText = 'margin: 0 0 20px 0; color: var(--muted);';
    
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 12px;';
    
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear All';
    clearBtn.className = 'btn';
    clearBtn.style.cssText = 'flex: 1; background: var(--danger); color: white;';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn';
    cancelBtn.style.cssText = 'flex: 1;';
    
    btnContainer.append(clearBtn, cancelBtn);
    dialogBox.append(title, message, btnContainer);
    dialog.appendChild(dialogBox);
    document.body.appendChild(dialog);
    
    // Wait for user choice
    const confirmed = await new Promise((resolve) => {
      clearBtn.onclick = () => { dialog.remove(); resolve(true); };
      cancelBtn.onclick = () => { dialog.remove(); resolve(false); };
    });
    
    if (confirmed) {
      Storage.clearAll();
    }
  });
  $(ids.saveBtn).addEventListener("click", () => { Storage.save(); });
  
  // Auto-advance direction toggle
  document.getElementById('advanceToggle')?.addEventListener("click", () => {
    Config.ADVANCE_DIRECTION = Config.ADVANCE_DIRECTION === 'down' ? 'right' : 'down';
    const label = document.getElementById('advanceLabel');
    if(label) {
      label.textContent = Config.ADVANCE_DIRECTION === 'down' ? 'Advance: ↓ Down' : 'Advance: → Right';
    }
    Storage.saveDebounced();
  });
  
  // Refresh All button - recalculates everything
  document.getElementById('refreshAllBtn')?.addEventListener("click", () => {
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
      Storage.saveDebounced();
    });
    
    // Junk: toggle and initialize
    document.getElementById('toggleJunk')?.addEventListener('click', () => {
      const sec = document.getElementById('junkSection');
      const open = !sec.classList.contains('open');
      sec.classList.toggle('open', open);
      sec.setAttribute('aria-hidden', open ? 'false' : 'true');
      document.getElementById('toggleJunk')?.classList.toggle('active', open);
      if(open) {
        setTimeout(() => { 
          window.Junk?.init();
          // Restore achievements from localStorage after table is built
          const savedState = localStorage.getItem(Storage.KEY);
          if(savedState) {
            try {
              const state = JSON.parse(savedState);
              if(state.junk?.achievements) {
                setTimeout(() => {
                  if(window.Junk && typeof window.Junk.setAchievementState === 'function') {
                    window.Junk.setAchievementState(state.junk.achievements);
                  }
                }, 100);
              }
            } catch(e) {
              console.error('[Junk] Failed to restore achievements:', e);
            }
          }
        }, 0);
      }
      Storage.saveDebounced();
    });
    
    // Clear Junk Achievements button
    document.getElementById('clearJunkAchievements')?.addEventListener('click', () => {
      if(confirm('Clear all Junk achievements? This cannot be undone.')) {
        window.Junk?.clearAllAchievements();
        Utils.announce('All achievements cleared.');
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
    
    const exportBtn = document.getElementById('exportCSVBtn');
    if (exportBtn) exportBtn.addEventListener("click", exportCurrentScorecard);
    
    const emailBtn = document.getElementById('emailCSVBtn');
    if (emailBtn) emailBtn.addEventListener("click", emailCurrentScorecard);
    
    const shareHtmlBtn = document.getElementById('shareHtmlBtn');
    if (shareHtmlBtn && window.Export && window.Export.shareHtmlSnapshot) {
      shareHtmlBtn.addEventListener("click", () => window.Export.shareHtmlSnapshot());
    }

    // QR Code buttons
    const generateQRBtn = document.getElementById('generateQRBtn');
    if (generateQRBtn && window.QRShare && window.QRShare.generate) {
      generateQRBtn.addEventListener("click", () => window.QRShare.generate());
    }
    
    const scanQRBtn = document.getElementById('scanQRBtn');
    if (scanQRBtn && window.QRShare && window.QRShare.scan) {
      scanQRBtn.addEventListener("click", () => window.QRShare.scan());
    }

    // Player management buttons
    const addPlayerBtn = document.getElementById('addPlayerBtn');
    const removePlayerBtn = document.getElementById('removePlayerBtn');
    if (addPlayerBtn) addPlayerBtn.addEventListener("click", addPlayer);
    if (removePlayerBtn) removePlayerBtn.addEventListener("click", removePlayer);
    
    Scorecard.player.updateCountDisplay();

    // Load saved state first, then recalc (loading will trigger its own recalcAll)
    Storage.load();
    
    // If no saved state was loaded, do initial calculation
    if(!localStorage.getItem(Storage.KEY)) {
      Scorecard.calc.recalcAll(); 
      AppManager.recalcGames();
    }
    
    // Force save before page unload to prevent data loss
    window.addEventListener('beforeunload', () => {
      // Clear any pending debounced save and save immediately
      clearTimeout(Storage.saveTimer);
      Storage.save();
    });
    
    // Log initialization complete
    console.log('[GolfApp] Initialization complete');
  }

  document.addEventListener("DOMContentLoaded", init);
  
  // =============================================================================
  // UNIFIED NAMESPACE - Expose organized API
  // =============================================================================
  
  /**
   * Unified namespace for the Golf Scorecard application
   * Provides organized access to all modules and utilities
   */
  window.GolfApp = {
    version: '2.1.0',
    
    // Core modules
    config: Config,
    utils: Utils,
    scorecard: Scorecard,
    storage: Storage,
    errorHandler: ErrorHandler,
    appManager: AppManager,
    
    // Game modules (populated by external scripts)
    games: {
      get vegas() { return window.Vegas; },
      get skins() { return window.Skins; },
      get junk() { return window.Junk; },
      get hilo() { return window.HiLo; },
      get banker() { return window.Banker; }
    },
    
    // Utility functions
    api: {
      save: () => Storage.save(),
      load: () => Storage.load(),
      export: () => window.Export?.exportCurrentScorecard(),
      email: () => window.Export?.emailCurrentScorecard(),
      addPlayer,
      removePlayer,
      recalculateEverything
    },
    
    // Constants
    constants: {
      HOLES,
      get PLAYERS() { return PLAYERS; },
      MIN_PLAYERS,
      MAX_PLAYERS,
      TIMING,
      LIMITS,
      GAME_CONSTANTS
    },
    
    // Debug utilities
    debug: {
      getState: () => ({
        players: PLAYERS,
        course: ACTIVE_COURSE,
        pars: PARS,
        hcpMen: HCPMEN
      }),
      clearStorage: () => {
        localStorage.removeItem(Storage.KEY);
        console.log('[Debug] Storage cleared');
      },
      testError: () => ErrorHandler.show('Test error', 'This is a test error notification'),
      testSuccess: () => ErrorHandler.success('Test success notification')
    }
  };
  
  // Log API availability
  console.log('[GolfApp] Unified API available at window.GolfApp');

})();

// =============================================================================
// BANKER GAME MODE - Moved to js/banker.js
// =============================================================================
// Banker game now in separate file (stub/placeholder)
// See js/banker.js for implementation

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

  // Sync row heights on window resize
  let resizeTimeout;
  let resizeAnimationFrame;
  
  window.addEventListener('resize', () => {
    // Cancel pending operations
    clearTimeout(resizeTimeout);
    if (resizeAnimationFrame) {
      cancelAnimationFrame(resizeAnimationFrame);
    }
    
    // Immediate sync during resize for responsiveness
    if(typeof Scorecard !== 'undefined' && Scorecard.build && typeof Scorecard.build.syncRowHeights === 'function') {
      resizeAnimationFrame = requestAnimationFrame(() => {
        Scorecard.build.syncRowHeights();
      });
    }
    
    // Final sync after resize completes
    resizeTimeout = setTimeout(() => {
      if(typeof Scorecard !== 'undefined' && Scorecard.build && typeof Scorecard.build.syncRowHeights === 'function') {
        requestAnimationFrame(() => Scorecard.build.syncRowHeights());
      }
    }, 150);
  });
