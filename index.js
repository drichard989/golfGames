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
*/

(() => {
  'use strict';

  const DEBUG_LAYOUT_TRACE = (() => {
    try {
      return /[?&]debug=1\b/.test(window.location.search) || localStorage.getItem('debug') === '1';
    } catch {
      return false;
    }
  })();

  function isLayoutDebugTraceEnabled() {
    try {
      if (window.__debugLayoutDisabled) return false;
      if (localStorage.getItem('debug') === '0') return false; // user explicitly disabled
      return /[?&]debug=1\b/.test(window.location.search) || localStorage.getItem('debug') === '1';
    } catch {
      return false;
    }
  }

  function hideLayoutDebugReadouts() {
    let didMutate = false;

    const footerPanel = document.getElementById('footerDebugReadout');
    if (footerPanel) {
      footerPanel.remove();
      didMutate = true;
    }

    const scoreHeaderPanel = document.getElementById('scorecardHeaderDebugReadout');
    if (scoreHeaderPanel) {
      scoreHeaderPanel.remove();
      didMutate = true;
    }

    // Debug panels change scorecard vertical geometry; force a re-measure.
    if (didMutate) {
      schedulePanelHeightSync();
    }
  }

  // =============================================================================
  // CONFIG MODULE - Course Database & Constants
  // =============================================================================

  const Config = {
    HOLES: 18,
    MIN_PLAYERS: 1,
    MAX_PLAYERS: 99,
    DEFAULT_PLAYERS: 4,
    LEADING_FIXED_COLS: 2,
    NDB_BUFFER: 2,
    STORAGE_KEY: 'golf_scorecard_v5',
    ADVANCE_DIRECTION: 'down',
    FONT_SIZE: 'medium',
    STROKE_INDICATOR_MODE: 'both',

    COURSES: {
      manito: {
        name: 'Manito Country Club',
        pars: [4, 4, 4, 5, 3, 4, 4, 3, 4, 4, 4, 3, 5, 5, 4, 4, 3, 4],
        hcpMen: [7, 13, 11, 15, 17, 1, 5, 9, 3, 10, 2, 12, 14, 18, 4, 6, 16, 8]
      },
      indian_canyon: {
        name: 'Indian Canyon Golf Course',
        pars: [4, 5, 4, 3, 4, 4, 4, 3, 4, 4, 3, 5, 3, 4, 4, 4, 4, 5],
        hcpMen: [4, 18, 10, 14, 2, 12, 16, 6, 8, 3, 17, 11, 9, 1, 7, 5, 15, 13]
      },
      dove: {
        name: 'Dove Canyon Country Club',
        pars: [5, 4, 4, 3, 4, 4, 3, 4, 5, 3, 5, 4, 3, 5, 4, 4, 3, 4],
        hcpMen: [11, 7, 3, 15, 1, 13, 17, 9, 5, 14, 4, 12, 16, 2, 6, 10, 18, 8]
      },
      hangman_creek: {
        name: 'Hangman Creek',
        pars: [4, 4, 4, 4, 5, 4, 3, 5, 3, 5, 3, 4, 4, 4, 4, 5, 3, 4],
        hcpMen: [4, 18, 16, 2, 10, 12, 6, 14, 8, 9, 15, 5, 1, 7, 17, 13, 3, 11]
      },
      creek_at_qualchan: {
        name: 'The Creek at Qualchan',
        pars: [4, 4, 5, 3, 5, 4, 3, 4, 4, 4, 3, 4, 4, 3, 4, 5, 4, 5],
        hcpMen: [15, 1, 7, 9, 3, 13, 17, 5, 11, 8, 4, 2, 14, 18, 16, 12, 10, 6]
      },
      meadowwood: {
        name: 'MeadowWood',
        pars: [4, 5, 4, 4, 4, 3, 5, 3, 4, 4, 3, 5, 4, 4, 4, 5, 3, 4],
        hcpMen: [6, 8, 14, 4, 12, 18, 10, 16, 2, 7, 9, 11, 15, 13, 3, 1, 17, 5]
      },
      liberty_lake_golf_course: {
        name: 'Liberty Lake Golf Course',
        pars: [4, 4, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 4, 4],
        hcpMen: [13, 5, 7, 17, 1, 11, 15, 9, 3, 14, 12, 10, 4, 6, 8, 18, 2, 16]
      },
      bandon_dunes: {
        name: 'Bandon Dunes',
        pars: [4, 3, 5, 4, 4, 3, 4, 4, 5, 4, 4, 3, 5, 4, 3, 4, 4, 5],
        hcpMen: [13, 15, 3, 5, 1, 17, 7, 11, 9, 8, 2, 18, 6, 16, 14, 10, 12, 4]
      },
      pacific_dune: {
        name: 'Pacific Dunes',
        pars: [4, 4, 5, 4, 3, 4, 4, 4, 4, 3, 3, 5, 4, 3, 5, 4, 3, 5],
        hcpMen: [9, 11, 7, 3, 17, 14, 1, 5, 15, 14, 18, 6, 2, 16, 10, 12, 8, 4]
      },
      old_macdonald: {
        name: 'Old Macdonald',
        pars: [4, 3, 4, 4, 3, 5, 4, 3, 4, 4, 4, 3, 4, 4, 5, 4, 5, 4],
        hcpMen: [11, 15, 9, 1, 17, 3, 5, 13, 7, 6, 4, 16, 18, 14, 12, 2, 10, 8]
      },
      sheep_ranch: {
        name: 'Sheep Ranch',
        pars: [5, 4, 3, 4, 3, 4, 3, 4, 4, 4, 5, 4, 5, 4, 4, 3, 4, 5],
        hcpMen: [5, 13, 17, 3, 11, 1, 15, 7, 9, 6, 4, 2, 10, 8, 14, 16, 12, 18]
      },
      bandon_trails: {
        name: 'Bandon Trails',
        pars: [4, 3, 5, 4, 3, 4, 4, 4, 5, 4, 4, 3, 4, 4, 4, 5, 3, 4],
        hcpMen: [13, 17, 3, 5, 15, 9, 7, 11, 1, 10, 4, 18, 12, 14, 8, 2, 16, 6]
      },
      palouse_ridge: {
        name: 'Palouse Ridge',
        pars: [4, 4, 4, 3, 5, 3, 4, 4, 5, 5, 3, 4, 3, 4, 4, 3, 5, 5],
        hcpMen: [3, 17, 5, 9, 1, 7, 15, 11, 13, 8, 10, 4, 2, 14, 18, 16, 12, 6]
      },
      gamble_sands: {
        name: 'Gamble Sands',
        pars: [4, 4, 5, 3, 4, 3, 5, 4, 4, 3, 4, 4, 5, 4, 4, 3, 4, 5],
        hcpMen: [7, 11, 1, 15, 5, 13, 3, 17, 9, 14, 6, 18, 12, 2, 8, 10, 4, 16]
      },
      scarecrow: {
        name: 'Scarecrow',
        pars: [4, 3, 5, 3, 4, 5, 4, 4, 3, 4, 3, 5, 4, 4, 5, 3, 4, 4],
        hcpMen: [3, 9, 11, 15, 17, 15, 1, 7, 13, 4, 18, 16, 8, 2, 10, 12, 6, 14]
      }
    },

    activeCourse: 'manito',
    pars: null,
    hcpMen: null,

    init() {
      this.pars = [...this.COURSES.manito.pars];
      this.hcpMen = [...this.COURSES.manito.hcpMen];
      window.PARS = this.pars;
      window.HCPMEN = this.hcpMen;
    },

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

  Config.init();

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

  Object.defineProperty(window, 'PLAYERS', {
    get() { return PLAYERS; },
    set(value) { PLAYERS = value; }
  });

  window.COURSES = COURSES;
  Object.defineProperty(window, 'ACTIVE_COURSE', {
    get() { return ACTIVE_COURSE; },
    set(value) { ACTIVE_COURSE = value; }
  });

  const TIMING = {
    FOCUS_DELAY_MS: 50,
    RECALC_DEBOUNCE_MS: 300,
    GAME_RECALC_DEBOUNCE_MS: 150,
    SAVE_DEBOUNCE_MS: 900,
    NAME_INPUT_SYNC_MS: 120,
    INIT_RETRY_DELAY_MS: 150,
    RESIZE_DEBOUNCE_MS: 150
  };

  const LIMITS = {
    MIN_HANDICAP: -50,
    MAX_HANDICAP: 60,
    MIN_SCORE: 1,
    MAX_SCORE: 20
  };

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
        MOOCHY: 1,
        GOOCHY: 1,
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

  const BANKER_SHEET_PREFS_KEY = 'banker_sheet_prefs_v1';
  const BANKER_PRESELECT_META_KEY = 'banker_preselect_meta_v1';

  window.GAME_CONSTANTS = GAME_CONSTANTS;

  // =============================================================================
  // UTILS MODULE - DOM Helpers & Math Utilities
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
    
    /** Get player rows from the single scorecard table */
    getPlayerRows: () => ({
      scrollable: Array.from(document.querySelectorAll('#scorecard .player-row')),
      fixed: Array.from(document.querySelectorAll('#scorecard .player-row'))
    }),

    _queryCache: new Map(),
    _queryCacheResetQueued: false,

    getCachedQueryAll(selector, cacheKey = selector) {
      if (Utils._queryCache.has(cacheKey)) {
        return Utils._queryCache.get(cacheKey);
      }

      const rows = Array.from(document.querySelectorAll(selector));
      Utils._queryCache.set(cacheKey, rows);

      if (!Utils._queryCacheResetQueued) {
        Utils._queryCacheResetQueued = true;
        queueMicrotask(() => {
          Utils._queryCache.clear();
          Utils._queryCacheResetQueued = false;
        });
      }

      return rows;
    },

    getFixedPlayerRowsCached() {
      return Utils.getCachedQueryAll('#scorecard .player-row', 'scorecardRows');
    },
    
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

  function parseDisplayedHandicap(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    const normalized = raw.replace(/\s+/g, '');
    if (normalized === '+' || normalized === '-') return null;

    const isPlusDisplay = normalized.startsWith('+');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;

    const actual = isPlusDisplay ? -Math.abs(parsed) : Math.trunc(parsed);
    return clampInt(actual, LIMITS.MIN_HANDICAP, LIMITS.MAX_HANDICAP);
  }

  function formatDisplayedHandicap(value) {
    const actual = typeof value === 'number' ? value : parseDisplayedHandicap(value);
    if (actual === null || !Number.isFinite(actual)) return '';
    if (actual < 0) return `+${Math.abs(actual)}`;
    return String(actual);
  }

  function getActualHandicapValue(chInput) {
    if (!chInput) return 0;

    const dataValue = chInput.dataset.actualValue;
    if (dataValue !== undefined && dataValue !== '') {
      const parsedData = Number(dataValue);
      if (Number.isFinite(parsedData)) return parsedData;
    }

    const parsed = parseDisplayedHandicap(chInput.value);
    return parsed === null ? 0 : parsed;
  }

  function setHandicapInputValue(chInput, value) {
    if (!chInput) return;

    if (value === '' || value === null || value === undefined) {
      chInput.value = '';
      chInput.dataset.actualValue = '';
      return;
    }

    const actual = parseDisplayedHandicap(value);
    if (actual === null) {
      chInput.value = '';
      chInput.dataset.actualValue = '';
      return;
    }

    chInput.dataset.actualValue = String(actual);
    chInput.value = formatDisplayedHandicap(actual);
  }

  function syncHandicapInput(chInput, options = {}) {
    if (!chInput) return false;
    const normalizeDisplay = !!options.normalizeDisplay;

    const raw = String(chInput.value ?? '').trim();
    if (raw === '' || raw === '+' || raw === '-') {
      chInput.dataset.actualValue = '';
      return false;
    }

    const actual = parseDisplayedHandicap(raw);
    if (actual === null) {
      chInput.dataset.actualValue = '';
      return false;
    }

    chInput.dataset.actualValue = String(actual);
    if (normalizeDisplay) {
      chInput.value = formatDisplayedHandicap(actual);
    }
    return true;
  }

  window.getActualHandicapValue = getActualHandicapValue;
  window.setHandicapInputValue = setHandicapInputValue;
  
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
   * Ensures Vegas, Skins, Junk, Hi-Lo, and Banker stay in sync when scores change
   */
  const AppManager = {
    _isSectionOpen(sectionId) {
      const section = document.getElementById(sectionId);
      return !!section?.classList.contains('open');
    },
    /**
     * Trigger a recalculation on all active game modules.
     * Each call is guarded so a missing or uninitialized module never
     * prevents the rest from updating.
     */
    recalcGames(force = true) {
      if (force) {
        markGamesDirty();
      }
      GAME_TAB_ORDER.forEach((gameKey) => {
        const sectionId = GAME_SECTION_BY_KEY[gameKey];
        if (!sectionId || !AppManager._isSectionOpen(sectionId)) return;
        if (!force && !isGameDirty(gameKey)) return;

        ensureGameInitialized(gameKey);
        try {
          runGameUpdate(gameKey);
          clearGameDirty(gameKey);
        } catch (error) {
          console.warn(`[AppManager] ${gameKey} update failed`, error);
        }
      });
      scheduleIdleDirtyGameFlush();
    },
    flushGame(gameKey, force = false) {
      if (!GAME_TAB_ORDER.includes(gameKey)) return;
      if (!force && !isGameDirty(gameKey)) return;
      ensureGameInitialized(gameKey);
      runGameUpdate(gameKey);
      clearGameDirty(gameKey);
      scheduleIdleDirtyGameFlush();
    },
    // Debounced version for score inputs — coalesces rapid keystrokes before running all game calcs
    recalcGamesDebounced: (() => {
      return function() {
        markGamesDirty();
        clearTimeout(GAME_RUNTIME_STATE.recalcTimer);
        GAME_RUNTIME_STATE.recalcTimer = setTimeout(() => {
          GAME_RUNTIME_STATE.recalcTimer = null;
          AppManager.recalcGames(false);
        }, TIMING.GAME_RECALC_DEBOUNCE_MS);
      };
    })()
  };
  try { window.AppManager = AppManager; } catch {}

  const ids = {
    holesHeader:"#holesHeader",parRow:"#parRow",hcpRow:"#hcpRow",totalsRow:"#totalsRow",
    table:"#scorecard",
    resetBtn:"#resetBtn",clearAllBtn:"#clearAllBtn",clearEverythingBtn:"#clearEverythingBtn",saveBtn:"#saveBtn",saveStatus:"#saveStatus",

    // Games toggles
    toggleVegas:"#toggleVegas", toggleBanker:"#toggleBanker", toggleSkins:"#toggleSkins", toggleHilo:"#toggleHilo", toggleWolf:"#toggleWolf",
    vegasSection:"#vegasSection", bankerSection:"#bankerSection", skinsSection:"#skinsSection", hiloSection:"#hiloSection", junkSection:"#junkSection", wolfSection:"#wolfSection",

    // Vegas
    vegasTeams:"#vegasTeams", vegasTeamWarning:"#vegasTeamWarning",
    vegasTableBody:"#vegasBody", vegasTotalA:"#vegasTotalA", vegasTotalB:"#vegasTotalB", vegasPtsA:"#vegasPtsA", vegasPtsB:"#vegasPtsB",
    optDoubleBirdie:"#optDoubleBirdie", optTripleEagle:"#optTripleEagle",
    vegasPointValue:"#vegasPointValue", vegasDollarA:"#vegasDollarA", vegasDollarB:"#vegasDollarB",

    // Skins
    skinsCarry:"#skinsCarry", skinsHalf:"#skinsHalf",
    skinsBody:"#skinsBody",
    skinsSummary:"#skinsSummary",
    fontSizeSmall:"#fontSizeSmall", fontSizeMedium:"#fontSizeMedium", fontSizeLarge:"#fontSizeLarge",
  };

  const GAME_TAB_ORDER = ['junk', 'skins', 'vegas', 'hilo', 'banker', 'wolf'];
  const DEFAULT_GAME_TAB = GAME_TAB_ORDER[0];
  const GAME_LAUNCHER_COMPACT_QUERY = '(max-width: 1024px)';
  const GAME_LAUNCHER_DEFAULT_PINS = ['junk', 'skins'];
  const GAME_SECTION_BY_KEY = {
    junk: 'junkSection',
    skins: 'skinsSection',
    vegas: 'vegasSection',
    hilo: 'hiloSection',
    banker: 'bankerSection',
    wolf: 'wolfSection'
  };
  const GAME_LAUNCHER_STATE = {
    collapsed: true,
    pins: GAME_TAB_ORDER.reduce((acc, gameKey) => {
      acc[gameKey] = GAME_LAUNCHER_DEFAULT_PINS.includes(gameKey);
      return acc;
    }, {})
  };
  const TAB_FLIP_BURST_MS = 420;
  const IDLE_HIDDEN_FLUSH_DELAY_MS = 220;
  const PLAYER_ENTRY_MODAL_QUERY = '(max-width: 1024px)';
  const GAME_INIT_FLAGS = {
    junkAchievementsRestored: false,
    initialized: {
      junk: false,
      skins: false,
      vegas: false,
      hilo: false,
      banker: false,
      wolf: false
    },
    warmedAfterLoad: false
  };
  const GAME_RUNTIME_STATE = {
    dirty: {
      junk: true,
      skins: true,
      vegas: true,
      hilo: true,
      banker: true,
      wolf: true
    },
    burstUntil: 0,
    deferredSaveTimer: null,
    recalcTimer: null,
    idleCallbackId: null,
    idleFallbackTimer: null,
    tabSwitchFlushTimer: null,
    pendingTabFlushGame: null
  };

  let playerEntryModalBackdrop = null;
  let playerEntryModalSheet = null;
  let playerEntryModalList = null;
  let playerEntryModalFocusTarget = null;
  let playerEntryModalClosedAt = 0;

  function isRemoteViewerSession() {
    const session = window.CloudSync?.getSession?.();
    return !!(session && session.role === 'viewer');
  }

  function markGamesDirty(gameKeys = GAME_TAB_ORDER) {
    gameKeys.forEach((gameKey) => {
      if (Object.prototype.hasOwnProperty.call(GAME_RUNTIME_STATE.dirty, gameKey)) {
        GAME_RUNTIME_STATE.dirty[gameKey] = true;
      }
    });
    scheduleIdleDirtyGameFlush();
  }

  function clearGameDirty(gameKey) {
    if (!Object.prototype.hasOwnProperty.call(GAME_RUNTIME_STATE.dirty, gameKey)) return;
    GAME_RUNTIME_STATE.dirty[gameKey] = false;
  }

  function isGameDirty(gameKey) {
    return !!GAME_RUNTIME_STATE.dirty[gameKey];
  }

  function beginTabFlipBurst() {
    GAME_RUNTIME_STATE.burstUntil = Date.now() + TAB_FLIP_BURST_MS;
  }

  function inTabFlipBurstWindow() {
    return Date.now() < GAME_RUNTIME_STATE.burstUntil;
  }

  function scheduleSaveAfterFlipBurst() {
    const now = Date.now();
    const remaining = Math.max(0, GAME_RUNTIME_STATE.burstUntil - now);
    clearTimeout(GAME_RUNTIME_STATE.deferredSaveTimer);
    GAME_RUNTIME_STATE.deferredSaveTimer = setTimeout(() => {
      GAME_RUNTIME_STATE.deferredSaveTimer = null;
      saveDebounced();
    }, remaining + 24);
  }

  function runGameUpdate(gameKey) {
    switch (gameKey) {
      case 'vegas':
        window.Vegas?.recalc?.();
        break;
      case 'skins':
        window.Skins?.update?.();
        break;
      case 'junk':
        window.Junk?.update?.();
        break;
      case 'hilo':
        window.HiLo?.update?.();
        break;
      case 'banker':
        window.Banker?.update?.();
        break;
      case 'wolf':
        window.Wolf?.update?.();
        break;
      default:
        break;
    }
  }

  function clearIdleDirtyGameFlushHandles() {
    if (GAME_RUNTIME_STATE.idleCallbackId != null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(GAME_RUNTIME_STATE.idleCallbackId);
    }
    if (GAME_RUNTIME_STATE.idleFallbackTimer != null) {
      clearTimeout(GAME_RUNTIME_STATE.idleFallbackTimer);
    }
    GAME_RUNTIME_STATE.idleCallbackId = null;
    GAME_RUNTIME_STATE.idleFallbackTimer = null;
  }

  function flushDirtyHiddenGamesInIdle(deadline = null) {
    clearIdleDirtyGameFlushHandles();

    // In cloud viewer mode, avoid background churn on hidden games.
    // Hidden tabs will flush on demand when the user opens them.
    if (isRemoteViewerSession()) {
      return;
    }

    if (inTabFlipBurstWindow()) {
      scheduleIdleDirtyGameFlush();
      return;
    }

    const activeGame = getActiveGameTab();
    let hasPending = false;
    for (const gameKey of GAME_TAB_ORDER) {
      if (!isGameDirty(gameKey)) continue;
      if (gameKey === activeGame) continue;

      if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 2) {
        hasPending = true;
        break;
      }

      try {
        ensureGameInitialized(gameKey);
        runGameUpdate(gameKey);
        clearGameDirty(gameKey);
      } catch (error) {
        console.warn(`[IdleFlush] ${gameKey} update failed`, error);
        hasPending = true;
      }
    }

    if (!hasPending) {
      hasPending = GAME_TAB_ORDER.some((gameKey) => {
        if (!isGameDirty(gameKey)) return false;
        return gameKey !== activeGame;
      });
    }

    if (hasPending) {
      scheduleIdleDirtyGameFlush();
    }
  }

  function scheduleIdleDirtyGameFlush() {
    if (!GAME_TAB_ORDER.some((gameKey) => isGameDirty(gameKey))) return;
    if (isRemoteViewerSession()) return;
    clearIdleDirtyGameFlushHandles();

    if (typeof window.requestIdleCallback === 'function') {
      GAME_RUNTIME_STATE.idleCallbackId = window.requestIdleCallback(
        (deadline) => flushDirtyHiddenGamesInIdle(deadline),
        { timeout: 1500 }
      );
      return;
    }

    GAME_RUNTIME_STATE.idleFallbackTimer = setTimeout(() => {
      flushDirtyHiddenGamesInIdle(null);
    }, IDLE_HIDDEN_FLUSH_DELAY_MS);
  }

  function scheduleGameTabFlush(gameKey) {
    if (!GAME_TAB_ORDER.includes(gameKey)) return;

    const runFlush = () => {
      GAME_RUNTIME_STATE.tabSwitchFlushTimer = null;
      const targetGame = GAME_RUNTIME_STATE.pendingTabFlushGame || gameKey;
      GAME_RUNTIME_STATE.pendingTabFlushGame = null;
      requestAnimationFrame(() => {
        AppManager.flushGame(targetGame, false);
        if (isRemoteViewerSession()) {
          // Resume deferred cloud applies once tab render + game flush have settled.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.CloudSync?.resumeRemoteApplies?.();
            });
          });
        }
      });
    };

    if (isRemoteViewerSession()) {
      GAME_RUNTIME_STATE.pendingTabFlushGame = gameKey;
      clearTimeout(GAME_RUNTIME_STATE.tabSwitchFlushTimer);
      GAME_RUNTIME_STATE.tabSwitchFlushTimer = setTimeout(runFlush, 90);
      return;
    }

    runFlush();
  }
  let headerVisible = true;             // Header is always shown.

  function applyHeaderVisibility() {
    headerVisible = true;
    const appHeader = document.querySelector('header');
    appHeader?.classList.remove('header-collapsed');
    window.CloudSync?.refreshHeaderBadgeButtons?.();
  }

  function syncHeaderCollapseBtn() {
    const btn = document.getElementById('headerCollapseBtn');
    if (!btn) return;
    const compact = window.matchMedia?.('(max-width: 600px)')?.matches;
    btn.textContent = compact
      ? (headerVisible ? '▲' : '▼')
      : (headerVisible ? '▲ Hide' : '▼ Show');
    btn.setAttribute('aria-label', headerVisible ? 'Hide header' : 'Show header');
    btn.setAttribute('aria-expanded', headerVisible ? 'true' : 'false');
  }

  function syncHeaderBadgeButtonLabels() {
    const compact = window.matchMedia?.('(max-width: 600px)')?.matches;
    const labels = [
      { id: 'cloudCreateBadgeBtn', full: 'Go live', compact: 'Live' },
      { id: 'cloudQrBadgeBtn', full: 'Share QR', compact: 'QR' },
      { id: 'cloudEditCodeBadgeBtn', full: 'Scorekeeping QR', compact: 'Score QR' },
      { id: 'cloudViewCodeBadgeBtn', full: 'View code', compact: 'View' }
    ];

    labels.forEach(({ id, full, compact: short }) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.textContent = compact ? short : full;
    });

    updateHeaderCloudScrollHint();
    syncHeaderCollapseBtn();
  }

  function ensureHeaderCloudScrollIndicator() {
    const bar = document.querySelector('.header-collapse-bar');
    if (!bar) return null;
    // Append to bar's parent (sticky-nav-bar) so it is outside the overflow-x
    // scroll container and does not move with the scrolled content.
    const container = bar.parentElement || bar;
    let indicator = container.querySelector('.header-cloud-scroll-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'header-cloud-scroll-indicator';
      const thumb = document.createElement('div');
      thumb.className = 'header-cloud-scroll-indicator__thumb';
      indicator.appendChild(thumb);
      container.appendChild(indicator);
    }
    return indicator;
  }

  function updateHeaderCloudScrollHint() {
    const bar = document.querySelector('.header-collapse-bar');
    if (!bar) return;
    const indicator = ensureHeaderCloudScrollIndicator();
    if (!indicator) return;

    const overflow = bar.scrollWidth - bar.clientWidth > 4;
    bar.classList.toggle('has-cloud-scroll-overflow', overflow);

    const thumb = indicator.firstElementChild;
    if (!thumb) return;
    if (!overflow) {
      thumb.style.width = '0%';
      thumb.style.left = '0%';
      return;
    }

    const ratio = bar.clientWidth / bar.scrollWidth;
    const thumbW = Math.max(ratio * 100, 12);
    const maxScroll = bar.scrollWidth - bar.clientWidth;
    const pos = maxScroll > 0 ? (bar.scrollLeft / maxScroll) * (100 - thumbW) : 0;
    thumb.style.width = thumbW + '%';
    thumb.style.left = pos + '%';
  }

  function bindHeaderCloudScrollIndicator() {
    const bar = document.querySelector('.header-collapse-bar');
    const group = document.querySelector('.header-cloud-status-group');
    if (!bar) return;

    ensureHeaderCloudScrollIndicator();
    bar.addEventListener('scroll', updateHeaderCloudScrollHint, { passive: true });
    window.addEventListener('resize', updateHeaderCloudScrollHint, { passive: true });

    requestAnimationFrame(updateHeaderCloudScrollHint);
    setTimeout(updateHeaderCloudScrollHint, 250);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateHeaderCloudScrollHint());
      ro.observe(bar);
      if (group) ro.observe(group);
    }

    if (typeof MutationObserver !== 'undefined' && group) {
      const mo = new MutationObserver(() => updateHeaderCloudScrollHint());
      mo.observe(group, { childList: true, subtree: true, attributes: true });
    }
  }

  const PRIMARY_TAB_SCROLL_POSITIONS = { score: 0, games: 0 };
  const GAME_TAB_SCROLL_POSITIONS = {
    junk: 0,
    skins: 0,
    vegas: 0,
    hilo: 0,
    banker: 0
  };
  let syncRowHeightsFrame = null;

  function resolveTargetElement(target) {
    return typeof target === 'string'
      ? document.getElementById(target.replace('#', ''))
      : $(target);
  }

  function getGameConfig(which) {
    return {
      vegas: {
        section: ids.vegasSection,
        toggle: ids.toggleVegas,
        init: () => {
          window.Vegas?.recalc?.();
        }
      },
      banker: { section: ids.bankerSection, toggle: ids.toggleBanker, init: () => window.Banker?.init?.() },
      skins: { section: ids.skinsSection, toggle: ids.toggleSkins, init: () => window.Skins?.init?.() },
      junk: {
        section: ids.junkSection,
        toggle: 'toggleJunk',
        init: () => {
          window.Junk?.init?.();

          if (GAME_INIT_FLAGS.junkAchievementsRestored) return;
          GAME_INIT_FLAGS.junkAchievementsRestored = true;

          const savedState = localStorage.getItem(Storage.KEY);
          if (!savedState) return;

          try {
            const parsed = JSON.parse(savedState);
            if (!parsed?.junk?.achievements) return;

            setTimeout(() => {
              if (window.Junk && typeof window.Junk.setAchievementState === 'function') {
                window.Junk.setAchievementState(parsed.junk.achievements);
              }
            }, 100);
          } catch (error) {
            console.error('[Junk] Failed to restore achievements:', error);
          }
        }
      },
      hilo: { section: ids.hiloSection, toggle: ids.toggleHilo, init: () => window.HiLo?.init?.() },
      wolf: { section: ids.wolfSection, toggle: ids.toggleWolf, init: () => window.Wolf?.init?.() }
    }[which] || null;
  }

  function ensureGameInitialized(which) {
    if (!GAME_TAB_ORDER.includes(which)) return false;
    if (GAME_INIT_FLAGS.initialized[which]) return true;

    const config = getGameConfig(which);
    if (!config?.init) {
      GAME_INIT_FLAGS.initialized[which] = true;
      return true;
    }

    try {
      config.init();
      GAME_INIT_FLAGS.initialized[which] = true;
      return true;
    } catch (error) {
      console.error(`[Games] Error initializing ${which}:`, error);
      ErrorHandler.show(`Error opening ${which}`, error.message);
      return false;
    }
  }

  function warmAllGamesAfterLoad() {
    if (GAME_INIT_FLAGS.warmedAfterLoad) return;
    GAME_INIT_FLAGS.warmedAfterLoad = true;

    const warm = () => {
      GAME_TAB_ORDER.forEach((gameKey) => {
        ensureGameInitialized(gameKey);
      });

      // Prime render/cache paths up front so active tab flipping is fast.
      GAME_TAB_ORDER.forEach((gameKey) => {
        try {
          runGameUpdate(gameKey);
          clearGameDirty(gameKey);
        } catch (_) {
          markGamesDirty([gameKey]);
        }
      });
      scheduleIdleDirtyGameFlush();
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(warm, { timeout: 1200 });
    } else {
      setTimeout(warm, 250);
    }
  }

  function getActiveGameTab() {
    return GAME_TAB_ORDER.find((gameKey) => resolveTargetElement(getGameConfig(gameKey)?.section)?.classList.contains('open')) || null;
  }

  function getPrimaryTab() {
    return document.getElementById('gamesEntryPanel')?.hidden ? 'score' : 'games';
  }

  function getGamesScrollContainer() {
    return document.getElementById('gamesEntryPanel');
  }

  let panelSyncRaf = 0;
  let lastGamesPanelHeightPx = -1;
  let lastScorePanelHeightPx = -1;
  let lastScorecardHeightPx = -1;
  let lastFooterBottomOffsetPx = -1;
  let scorecardLayoutObserverBound = false;
  let scorecardLayoutResyncRaf = 0;
  let scorecardSettleBurstToken = 0;
  const pinnedResultResizeObservers = new WeakMap();

  function triggerScorecardSettleBurst(reason = 'unknown') {
    const token = ++scorecardSettleBurstToken;

    const runPass = () => {
      if (token !== scorecardSettleBurstToken) return;
      schedulePanelHeightSync();
      if (getPrimaryTab() === 'score') {
        if (window.Scorecard?.build?.syncRowHeights) {
          window.Scorecard.build.syncRowHeights(true);
        }
        normalizeScorecardTopRowsLayout();
      }
    };

    // Immediate + staggered follow-ups catch late Android/iOS viewport and
    // sticky-header settling that can happen after initial layout.
    runPass();
    [60, 160, 320, 620, 980, 1400, 2100].forEach((ms) => {
      setTimeout(runPass, ms);
    });

    if (isLayoutDebugTraceEnabled()) {
      debugScorecardTrace(`settle-burst:${reason}`);
    }
  }

  function ensurePinnedResultResizeSync(resultCard) {
    if (!(resultCard instanceof HTMLElement)) return;
    if (typeof ResizeObserver === 'undefined') return;
    if (pinnedResultResizeObservers.has(resultCard)) return;

    const ro = new ResizeObserver(() => {
      schedulePanelHeightSync();
    });
    ro.observe(resultCard);
    pinnedResultResizeObservers.set(resultCard, ro);
  }

  function setupScorecardLayoutAutoResync() {
    if (scorecardLayoutObserverBound) return;
    scorecardLayoutObserverBound = true;

    const runResync = () => {
      if (scorecardLayoutResyncRaf) return;
      scorecardLayoutResyncRaf = requestAnimationFrame(() => {
        scorecardLayoutResyncRaf = 0;
        triggerScorecardSettleBurst('layout-observer');
      });
    };

    const settleResync = () => {
      runResync();
      setTimeout(runResync, 80);
      setTimeout(runResync, 220);
    };

    const scorePanel = document.getElementById('scoreEntryPanel');
    const scorecardPane = document.getElementById('main-scorecard');
    const scoreTable = document.getElementById('scorecard');
    const footerShell = document.querySelector('.scorecard-controls-shell');

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => settleResync());
      if (scorePanel) ro.observe(scorePanel);
      if (scorecardPane) ro.observe(scorecardPane);
      if (scoreTable) ro.observe(scoreTable);
      if (footerShell) ro.observe(footerShell);
    }

    if (typeof MutationObserver !== 'undefined' && scorePanel) {
      const mo = new MutationObserver(() => settleResync());
      mo.observe(scorePanel, { childList: true });
    }

    if (scoreTable) {
      scoreTable.addEventListener('input', () => triggerScorecardSettleBurst('score-input'), { passive: true });
      scoreTable.addEventListener('change', () => triggerScorecardSettleBurst('score-change'), { passive: true });
    }

    document.fonts?.ready?.then(() => settleResync()).catch(() => {});

    window.addEventListener('load', settleResync, { once: true });
    window.addEventListener('pageshow', settleResync, { passive: true });
    window.addEventListener('orientationchange', settleResync, { passive: true });
  }

  function schedulePanelHeightSync() {
    if (panelSyncRaf) return;
    panelSyncRaf = requestAnimationFrame(() => {
      panelSyncRaf = 0;
      syncRuntimeModeClasses();
      syncDynamicViewportHeight();
      syncSafeTopInset();
      syncSafeBottomInset();
      syncFixedFooterBottomOffset();
      syncGamesPanelHeight();
      syncScorePanelHeight();
      if (window.Scorecard?.build?.syncRowHeights) {
        window.Scorecard.build.syncRowHeights(true);
      }
      normalizeScorecardTopRowsLayout();
      syncGamesFooterHeightVar();
      syncActiveGamePinnedResultsLayout();
      window._iosStickyRefresh?.();
      window._iosGamesStickyRefresh?.();
    });
  }

  let lastGamesFooterHeightPx = -1;
  function syncGamesFooterHeightVar() {
    const shell = document.querySelector('.games-controls-shell');
    if (!shell) return;
    const h = shell.offsetHeight || 0;
    if (h !== lastGamesFooterHeightPx) {
      document.documentElement.style.setProperty('--games-footer-h', `${h}px`);
      lastGamesFooterHeightPx = h;
    }
  }

  const PINNED_GAME_RESULTS_SELECTOR = {
    banker: '#bankerFooterTotals',
    vegas: '#vegasResultsBottom',
    hilo: '#hiloResultsBottom',
    junk: '#junkResultsBottom',
    wolf: '#wolfResultsBottom'
  };

  const PANEL_SCROLL_LOCK_GAMES = new Set(['banker', 'vegas', 'hilo', 'junk', 'wolf']);

  function syncActiveGamePinnedResultsLayout() {
    const panel = getGamesScrollContainer();
    if (!panel) return;

    // Default behavior: panel can scroll unless an active game explicitly locks it.
    if (panel.style.overflowY !== 'auto') {
      panel.style.overflowY = 'auto';
    }

    if (getPrimaryTab() !== 'games') return;
    if (!window.matchMedia('(max-width: 1023px)').matches) return;

    const activeGame = getActiveGameTab();
    if (!activeGame) return;

    if (PANEL_SCROLL_LOCK_GAMES.has(activeGame)) {
      if (panel.scrollTop !== 0) {
        panel.scrollTop = 0;
      }
      if (panel.style.overflowY !== 'hidden') {
        panel.style.overflowY = 'hidden';
      }
    }

    const sectionId = GAME_SECTION_BY_KEY[activeGame];
    const section = sectionId ? document.getElementById(sectionId) : null;
    if (!section || section.getAttribute('aria-hidden') === 'true') return;

    const wrap = section.querySelector('.vegas-wrap, .banker-wrap');
    if (!wrap) return;

    const sectionHeader = section.querySelector('.game-section-header');

    const resultSelector = PINNED_GAME_RESULTS_SELECTOR[activeGame];
    if (!resultSelector) return;

    const resultCard = section.querySelector(resultSelector);
    if (!resultCard) return;

    ensurePinnedResultResizeSync(resultCard);

    if (getComputedStyle(resultCard).position !== 'fixed') return;

    const wrapRect = wrap.getBoundingClientRect();
    const headerRect = sectionHeader?.getBoundingClientRect();
    const resultRect = resultCard.getBoundingClientRect();
    const topAnchor = headerRect ? Math.max(wrapRect.top, headerRect.bottom + 4) : wrapRect.top;
    const available = Math.floor(resultRect.top - topAnchor - 8);
    if (Number.isFinite(available) && available > 24) {
      // Always cap table viewport to stay above pinned results, even on
      // shorter devices where previous 160px threshold could leave overlap.
      wrap.style.maxHeight = `${available}px`;
    }

    const resultHeight = Math.ceil(resultRect.height || resultCard.offsetHeight || 0);
    if (resultHeight > 0) {
      const pinnedSafetyPad = activeGame === 'junk' ? 56 : 18;
      wrap.style.paddingBottom = `${Math.max(14, resultHeight + pinnedSafetyPad)}px`;
    }
  }

  function getGamesScrollTop() {
    const container = getGamesScrollContainer();
    if (!container) return 0;
    return container.scrollTop || 0;
  }

  function setGamesScrollTop(top) {
    const safeTop = Number(top) || 0;
    const container = getGamesScrollContainer();
    if (!container) return;

    // Direct assignment is most reliable on iOS for element scroll restoration.
    container.scrollTop = safeTop;
    try {
      container.scrollTo({ top: safeTop, left: 0, behavior: 'auto' });
    } catch {}
  }

  function syncGamesPanelHeight() {
    const panel = getGamesScrollContainer();
    if (!panel) return;

    const viewportHeight = getStableViewportHeight();
    const navBar = document.querySelector('.sticky-nav-bar');
    const footerShell = document.querySelector('.games-controls-shell');
    const navBarRect = navBar?.getBoundingClientRect();
    const footerHeight = footerShell ? footerShell.offsetHeight : 0;

    // Measure from the bottom of the sticky nav bar to the bottom of the viewport.
    // This is reliable regardless of what's above (header shown/hidden, transitions).
    const topBoundary = navBarRect ? navBarRect.bottom + 4 : 120;
    // Reserve space for the fixed games footer so the last hole row is never
    // hidden behind it when scrolling within game tables.
    const available = Math.max(220, Math.floor(viewportHeight - topBoundary - footerHeight - 8));
    if (available !== lastGamesPanelHeightPx) {
      panel.style.height = `${available}px`;
      panel.style.maxHeight = `${available}px`;
      lastGamesPanelHeightPx = available;
    }
  }

  function syncScorePanelHeight() {
    const panel = document.getElementById('scoreEntryPanel');
    const scorecard = document.getElementById('main-scorecard');
    const footerShell = document.querySelector('.scorecard-controls-shell');
    if (!panel) return;

    const viewportHeight = getStableViewportHeight();
    const navBar = document.querySelector('.sticky-nav-bar');
    const navBarRect = navBar?.getBoundingClientRect();

    // Keep score panel strictly below the sticky nav so top controls stay visible.
    const topBoundary = navBarRect ? navBarRect.bottom + 4 : 120;
    const available = Math.max(260, Math.floor(viewportHeight - topBoundary));
    if (available !== lastScorePanelHeightPx) {
      panel.style.height = `${available}px`;
      panel.style.maxHeight = `${available}px`;
      lastScorePanelHeightPx = available;
    }
    if (scorecard) {
      // Use getBoundingClientRect so the footer's CSS bottom (including
      // env(safe-area-inset-bottom)) is already baked into the position.
      const footerRect = footerShell ? footerShell.getBoundingClientRect() : null;
      const footerTop = footerRect ? footerRect.top : (viewportHeight - (footerShell ? footerShell.offsetHeight : 0));
      // Use the scorecard's actual rendered top so any element inserted above
      // it (e.g. debug strip) is automatically accounted for.
      const scorecardActualTop = scorecard.getBoundingClientRect().top;
      const scorecardTop = Math.max(topBoundary, scorecardActualTop);
      let scorecardHeight = Math.max(180, footerTop - scorecardTop);

      if (scorecardHeight !== lastScorecardHeightPx) {
        scorecard.style.height = `${scorecardHeight}px`;
        scorecard.style.maxHeight = `${scorecardHeight}px`;
        lastScorecardHeightPx = scorecardHeight;
      }

      // Race-condition guard: if a late DOM shift (e.g. debug strip insert,
      // sticky recompute, viewport settle) still leaves the scorecard under
      // the fixed footer, clamp immediately using live geometry.
      const liveScoreRect = scorecard.getBoundingClientRect();
      const overlapPx = Math.ceil(liveScoreRect.bottom - footerTop);
      if (overlapPx > 0) {
        scorecardHeight = Math.max(180, scorecardHeight - overlapPx);
        if (scorecardHeight !== lastScorecardHeightPx) {
          scorecard.style.height = `${scorecardHeight}px`;
          scorecard.style.maxHeight = `${scorecardHeight}px`;
          lastScorecardHeightPx = scorecardHeight;
        }
      }
    }
  }

  /**
   * Keep the first player row visually anchored directly under the HCP row.
   * On some mobile viewport transitions, scorecard scrollTop can drift slightly,
   * which creates an artificial gap and can clip the first player row.
   */
  function normalizeScorecardTopRowsLayout() {
    if (getPrimaryTab() !== 'score') return;

    const pane = document.getElementById('main-scorecard');
    const hcpRow = document.getElementById('hcpRow');
    const firstPlayerRow = document.querySelector('#scorecard .player-row');
    if (!pane || !hcpRow || !firstPlayerRow) return;

    const currentTop = Math.max(0, Number(pane.scrollTop) || 0);
    // Only normalize near the top; don't interfere with intentional scrolling.
    if (currentTop > 140) return;

    const hcpBottom = hcpRow.getBoundingClientRect().bottom;
    const firstTop = firstPlayerRow.getBoundingClientRect().top;
    const gapPx = Math.round(firstTop - hcpBottom);

    if (Math.abs(gapPx) <= 2) return;

    const maxTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
    const nextTop = Math.max(0, Math.min(maxTop, currentTop + gapPx));

    // Guard against large jumps; only correct small/medium drift.
    if (Math.abs(nextTop - currentTop) > 120) return;

    pane.scrollTop = nextTop;
  }

  function syncDynamicViewportHeight() {
    const root = document.documentElement;
    if (!root) return;

    const rawViewportHeight = getStableViewportHeight();
    const viewportHeight = Math.max(0, Math.round(rawViewportHeight));
    if (!viewportHeight) return;

    const nextValue = `${viewportHeight}px`;
    if (root.style.getPropertyValue('--app-dvh') !== nextValue) {
      root.style.setProperty('--app-dvh', nextValue);
    }
  }

  function getActiveFooterShell() {
    return getPrimaryTab() === 'games'
      ? document.querySelector('.games-controls-shell')
      : document.querySelector('.scorecard-controls-shell');
  }

  function getDisplayModeState() {
    const standaloneMq = window.matchMedia?.('(display-mode: standalone)')?.matches;
    const fullscreenMq = window.matchMedia?.('(display-mode: fullscreen)')?.matches;
    const minimalUiMq = window.matchMedia?.('(display-mode: minimal-ui)')?.matches;
    const browserMq = window.matchMedia?.('(display-mode: browser)')?.matches;
    const iosStandalone = window.navigator.standalone === true;

    let mode = 'unknown';
    if (standaloneMq) mode = 'standalone';
    else if (fullscreenMq) mode = 'fullscreen';
    else if (minimalUiMq) mode = 'minimal-ui';
    else if (browserMq) mode = 'browser';

    return {
      mode,
      standaloneMq: !!standaloneMq,
      fullscreenMq: !!fullscreenMq,
      minimalUiMq: !!minimalUiMq,
      browserMq: !!browserMq,
      iosStandalone,
      isStandaloneApp: !!(standaloneMq || fullscreenMq || iosStandalone)
    };
  }

  function isIOSPlatform() {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isIosPwaMode() {
    const displayMode = getDisplayModeState();
    return isIOSPlatform() && displayMode.isStandaloneApp;
  }

  function syncRuntimeModeClasses() {
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle('ios-pwa-mode', isIosPwaMode());
  }

  function getIosStandaloneViewportFloor() {
    if (!isIosPwaMode()) return 0;

    const screenObj = window.screen;
    if (!screenObj) return 0;

    const rawWidth = Math.round(screenObj.width || 0);
    const rawHeight = Math.round(screenObj.height || 0);
    const availWidth = Math.round(screenObj.availWidth || 0);
    const availHeight = Math.round(screenObj.availHeight || 0);
    const longestEdge = Math.max(rawWidth, rawHeight);
    const shortestEdge = Math.min(rawWidth || Infinity, rawHeight || Infinity);
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const portrait = viewportHeight >= viewportWidth;

    if (!portrait || !Number.isFinite(shortestEdge) || shortestEdge > 430 || longestEdge <= 0) {
      return 0;
    }

    const hasHomeIndicatorPhone = longestEdge >= 812;
    const safeTopGuess = hasHomeIndicatorPhone ? 44 : 20;
    const safeBottomGuess = hasHomeIndicatorPhone ? 34 : 0;
    const usableFromRaw = Math.max(0, longestEdge - safeTopGuess - safeBottomGuess);
    const availLongest = Math.max(availWidth, availHeight);
    const usableFromAvail = availLongest > 0 && availLongest < longestEdge ? availLongest : 0;

    return usableFromAvail || usableFromRaw;
  }

  function getStableViewportHeight() {
    const vv = window.visualViewport;
    const layoutViewportHeight = window.innerHeight || 0;
    const clientHeight = document.documentElement?.clientHeight || 0;
    const visualHeight = vv ? (vv.height + vv.offsetTop) : 0;
    const standalone = isIosPwaMode();
    const iosStandaloneFloor = getIosStandaloneViewportFloor();
    const activeEl = document.activeElement;
    const isEditableFocused = !!activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      activeEl.isContentEditable
    );

    if (standalone && !isEditableFocused) {
      return Math.max(layoutViewportHeight, clientHeight, visualHeight, iosStandaloneFloor, 0);
    }

    return vv?.height || layoutViewportHeight || clientHeight || 0;
  }

  function ensureFooterDebugReadout() {
    if (!isLayoutDebugTraceEnabled()) return null;

    let panel = document.getElementById('footerDebugReadout');
    if (panel) return panel;

    if (!document.getElementById('footerDebugReadoutStyle')) {
      const style = document.createElement('style');
      style.id = 'footerDebugReadoutStyle';
      style.textContent =
        '#footerDebugReadout{' +
          'position:fixed;' +
          'top:8px;' +
          'right:8px;' +
          'z-index:9999;' +
          'max-width:min(92vw,420px);' +
          'padding:8px 10px;' +
          'border:2px solid #00e5ff;' +
          'border-radius:8px;' +
          'background:rgba(9,12,18,0.9);' +
          'color:#d9f7ff;' +
          'font:12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;' +
          'white-space:pre-wrap;' +
          'pointer-events:none;' +
          'backdrop-filter:blur(2px);' +
        '}';
      document.head.appendChild(style);
    }

    panel = document.createElement('div');
    panel.id = 'footerDebugReadout';
    panel.textContent = 'footer debug pending...';
    document.body.appendChild(panel);
    return panel;
  }

  function renderFooterDebugReadout(reason, extra = {}) {
    if (!isLayoutDebugTraceEnabled()) {
      hideLayoutDebugReadouts();
      return;
    }
    const panel = ensureFooterDebugReadout();
    if (!panel) return;

    const vv = window.visualViewport;
    const activeTab = getPrimaryTab();
    const scoreShell = document.querySelector('.scorecard-controls-shell');
    const gamesShell = document.querySelector('.games-controls-shell');
    const activeShell = activeTab === 'games' ? gamesShell : scoreShell;
    const rect = activeShell?.getBoundingClientRect();
    const appDvh = getComputedStyle(document.documentElement).getPropertyValue('--app-dvh').trim();
    const bottomOffset = getComputedStyle(document.documentElement).getPropertyValue('--footer-bottom-offset').trim();
    const activeName = activeShell === gamesShell ? 'games' : (activeShell === scoreShell ? 'score' : 'none');
    const displayMode = getDisplayModeState();
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);

    panel.textContent = [
      `footer-debug ${ts}`,
      `reason=${reason}`,
      `tab=${activeTab} shell=${activeName}`,
      `mode=${displayMode.mode} standaloneApp=${displayMode.isStandaloneApp} iosStandalone=${displayMode.iosStandalone}`,
      `mq standalone=${displayMode.standaloneMq} fullscreen=${displayMode.fullscreenMq} minimal-ui=${displayMode.minimalUiMq} browser=${displayMode.browserMq}`,
      `vv.h=${vv ? Math.round(vv.height) : 'na'} vv.top=${vv ? Math.round(vv.offsetTop) : 'na'}`,
      `innerH=${window.innerHeight} clientH=${document.documentElement.clientHeight}`,
      `appDvh=${appDvh} bottomOffset=${bottomOffset}`,
      `shell.top=${rect ? Math.round(rect.top) : 'na'} shell.bottom=${rect ? Math.round(rect.bottom) : 'na'} shell.h=${rect ? Math.round(rect.height) : 'na'}`,
      `extra=${JSON.stringify(extra)}`
    ].join('\n');
  }

  function debugFooterTrace(reason, extra = {}) {
    if (!isLayoutDebugTraceEnabled()) {
      hideLayoutDebugReadouts();
      return;
    }

    renderFooterDebugReadout(reason, extra);

    const viewport = window.visualViewport;
    const footerShell = document.querySelector('.games-controls-shell');
    const footerRect = footerShell?.getBoundingClientRect();
    const activeGame = getActiveGameTab();
    const pinnedSelector = activeGame ? PINNED_GAME_RESULTS_SELECTOR[activeGame] : null;
    const pinnedEl = pinnedSelector ? document.querySelector(pinnedSelector) : null;
    const pinnedRect = pinnedEl?.getBoundingClientRect();
    const displayMode = getDisplayModeState();

    console.log('[footer-debug]', {
      reason,
      primaryTab: getPrimaryTab(),
      activeGame,
      displayMode,
      innerHeight: window.innerHeight,
      clientHeight: document.documentElement.clientHeight,
      visualViewport: viewport ? {
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        offsetTop: Math.round(viewport.offsetTop),
        offsetLeft: Math.round(viewport.offsetLeft),
        pageTop: Math.round(viewport.pageTop)
      } : null,
      vars: {
        footerBottomOffset: getComputedStyle(document.documentElement).getPropertyValue('--footer-bottom-offset').trim(),
        gamesFooterHeight: getComputedStyle(document.documentElement).getPropertyValue('--games-footer-h').trim(),
        appDvh: getComputedStyle(document.documentElement).getPropertyValue('--app-dvh').trim()
      },
      footer: footerShell ? {
        display: getComputedStyle(footerShell).display,
        visibility: getComputedStyle(footerShell).visibility,
        bottom: getComputedStyle(footerShell).bottom,
        zIndex: getComputedStyle(footerShell).zIndex,
        top: Math.round(footerRect.top),
        bottomPx: Math.round(footerRect.bottom),
        height: Math.round(footerRect.height)
      } : null,
      pinned: pinnedEl ? {
        selector: pinnedSelector,
        position: getComputedStyle(pinnedEl).position,
        bottom: getComputedStyle(pinnedEl).bottom,
        zIndex: getComputedStyle(pinnedEl).zIndex,
        top: Math.round(pinnedRect.top),
        bottomPx: Math.round(pinnedRect.bottom),
        height: Math.round(pinnedRect.height)
      } : null,
      extra
    });
  }

  function collectScorecardClipMetrics(reason, extra = {}) {
    const viewport = window.visualViewport;
    const scorePanel = document.getElementById('scoreEntryPanel');
    const scorecard = document.getElementById('main-scorecard');
    const scoreFooter = document.querySelector('.scorecard-controls-shell');
    const scoreFooterCard = document.querySelector('.scorecard-card-footer');
    const scoreFooterControls = document.getElementById('scorecardFooterControls');
    const scoreFooterSwitcher = document.querySelector('.scorecard-controls-shell .footer-entry-switcher');
    const scoreOptionsPanel = document.getElementById('scorecardOptionsPanel');
    const stickyNav = document.querySelector('.sticky-nav-bar');
    const totalsRow = document.getElementById('totalsRow');
    const hcpRow = document.getElementById('hcpRow');
    const firstPlayerRow = document.querySelector('#scorecard .player-row');

    const panelRect = scorePanel?.getBoundingClientRect();
    const scorecardRect = scorecard?.getBoundingClientRect();
    const footerRect = scoreFooter?.getBoundingClientRect();
    const footerCardRect = scoreFooterCard?.getBoundingClientRect();
    const footerControlsRect = scoreFooterControls?.getBoundingClientRect();
    const footerSwitcherRect = scoreFooterSwitcher?.getBoundingClientRect();
    const navRect = stickyNav?.getBoundingClientRect();
    const totalsRect = totalsRow?.getBoundingClientRect();
    const hcpRect = hcpRow?.getBoundingClientRect();
    const firstPlayerRect = firstPlayerRow?.getBoundingClientRect();

    const footerTop = footerRect ? Math.round(footerRect.top) : null;
    const scorecardBottom = scorecardRect ? Math.round(scorecardRect.bottom) : null;
    const overlapWithFooterPx =
      footerTop != null && scorecardBottom != null ? Math.max(0, scorecardBottom - footerTop) : null;
    const topRowGapPx =
      hcpRect && firstPlayerRect ? Math.round(firstPlayerRect.top - hcpRect.bottom) : null;

    return {
      reason,
      primaryTab: getPrimaryTab(),
      innerHeight: window.innerHeight,
      clientHeight: document.documentElement.clientHeight,
      visualViewport: viewport ? {
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        offsetTop: Math.round(viewport.offsetTop),
        offsetLeft: Math.round(viewport.offsetLeft),
        pageTop: Math.round(viewport.pageTop)
      } : null,
      vars: {
        appDvh: getComputedStyle(document.documentElement).getPropertyValue('--app-dvh').trim(),
        footerBottomOffset: getComputedStyle(document.documentElement).getPropertyValue('--footer-bottom-offset').trim(),
        safeTopInset: getComputedStyle(document.documentElement).getPropertyValue('--safe-top-inset').trim()
      },
      panel: scorePanel ? {
        hidden: !!scorePanel.hidden,
        heightStyle: scorePanel.style.height || null,
        maxHeightStyle: scorePanel.style.maxHeight || null,
        top: Math.round(panelRect.top),
        bottom: Math.round(panelRect.bottom),
        height: Math.round(panelRect.height),
        scrollTop: Math.round(scorePanel.scrollTop || 0),
        scrollHeight: Math.round(scorePanel.scrollHeight || 0),
        clientHeight: Math.round(scorePanel.clientHeight || 0)
      } : null,
      scorecard: scorecard ? {
        heightStyle: scorecard.style.height || null,
        maxHeightStyle: scorecard.style.maxHeight || null,
        top: Math.round(scorecardRect.top),
        bottom: Math.round(scorecardRect.bottom),
        height: Math.round(scorecardRect.height),
        scrollTop: Math.round(scorecard.scrollTop || 0),
        scrollHeight: Math.round(scorecard.scrollHeight || 0),
        clientHeight: Math.round(scorecard.clientHeight || 0)
      } : null,
      footer: scoreFooter ? {
        bottomCss: getComputedStyle(scoreFooter).bottom,
        top: Math.round(footerRect.top),
        bottom: Math.round(footerRect.bottom),
        height: Math.round(footerRect.height)
      } : null,
      footerInternals: {
        card: scoreFooterCard ? {
          top: Math.round(footerCardRect.top),
          bottom: Math.round(footerCardRect.bottom),
          height: Math.round(footerCardRect.height)
        } : null,
        controls: scoreFooterControls ? {
          top: Math.round(footerControlsRect.top),
          bottom: Math.round(footerControlsRect.bottom),
          height: Math.round(footerControlsRect.height)
        } : null,
        switcher: scoreFooterSwitcher ? {
          top: Math.round(footerSwitcherRect.top),
          bottom: Math.round(footerSwitcherRect.bottom),
          height: Math.round(footerSwitcherRect.height)
        } : null,
        optionsOpen: !!scoreOptionsPanel && !scoreOptionsPanel.hidden
      },
      stickyNav: stickyNav ? {
        top: Math.round(navRect.top),
        bottom: Math.round(navRect.bottom),
        height: Math.round(navRect.height)
      } : null,
      totalsRow: totalsRow ? {
        top: Math.round(totalsRect.top),
        bottom: Math.round(totalsRect.bottom),
        height: Math.round(totalsRect.height)
      } : null,
      topRows: {
        hcpBottom: hcpRect ? Math.round(hcpRect.bottom) : null,
        firstPlayerTop: firstPlayerRect ? Math.round(firstPlayerRect.top) : null,
        gapPx: topRowGapPx
      },
      overlapWithFooterPx,
      extra
    };
  }

  function ensureScorecardHeaderDebugReadout() {
    if (!isLayoutDebugTraceEnabled()) return null;

    let panel = document.getElementById('scorecardHeaderDebugReadout');
    if (panel) return panel;

    const scorePanel = document.getElementById('scoreEntryPanel');
    const scorecard = document.getElementById('main-scorecard');
    if (!scorePanel || !scorecard) return null;

    panel = document.createElement('div');
    panel.id = 'scorecardHeaderDebugReadout';
    panel.className = 'scorecard-header-debug-readout';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML =
      '<span class="scorecard-header-debug-title">Score Header Debug</span>' +
      '<span id="scorecardHeaderDebugContent">Waiting for trace...</span>';
    scorePanel.insertBefore(panel, scorecard);

    // Inserting this debug strip shifts #main-scorecard downward. Re-sync panel
    // and scorecard heights so the scorecard bottom stays attached to footer top.
    schedulePanelHeightSync();

    return panel;
  }

  function renderScorecardHeaderDebugReadout(payload) {
    if (!payload) return;
    if (!isLayoutDebugTraceEnabled()) {
      hideLayoutDebugReadouts();
      return;
    }

    const panel = ensureScorecardHeaderDebugReadout();
    const content = document.getElementById('scorecardHeaderDebugContent');
    if (!panel || !content) return;

    const scoreTabActive = getPrimaryTab() === 'score';
    panel.hidden = !scoreTabActive;
    if (!scoreTabActive) return;

    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    const gap = payload.topRows?.gapPx;
    const overlap = payload.overlapWithFooterPx;
    const headTop = payload.stickyNav?.bottom;
    const hcpBottom = payload.topRows?.hcpBottom;
    const firstTop = payload.topRows?.firstPlayerTop;
    const panelTop = payload.panel?.top;
    const panelScroll = payload.panel ? `${payload.panel.scrollTop}/${payload.panel.scrollHeight}` : 'na';

    // Live-sample footer shell so we see its actual rendered position, not just
    // the cached payload value (which may be from a prior frame).
    const footerShell = document.querySelector('.scorecard-controls-shell');
    const footerRect = footerShell?.getBoundingClientRect();
    const footerCssBottom = footerShell ? getComputedStyle(footerShell).bottom : 'na';
    const footerCssPosition = footerShell ? getComputedStyle(footerShell).position : 'na';
    const footerTop = footerRect ? Math.round(footerRect.top) : 'na';
    const footerBottom = footerRect ? Math.round(footerRect.bottom) : 'na';
    const footerH = footerRect ? Math.round(footerRect.height) : 'na';
    const innerH = window.innerHeight;
    const vvH = window.visualViewport ? Math.round(window.visualViewport.height) : 'na';
    const rootStyle = getComputedStyle(document.documentElement);
    const appDvh = rootStyle.getPropertyValue('--app-dvh').trim() || 'na';
    const footerBottomOffset = getComputedStyle(document.documentElement)
      .getPropertyValue('--footer-bottom-offset').trim() || '0px';
    const safeBottomInset = rootStyle.getPropertyValue('--safe-bottom-inset').trim() || '0px';
    const footerRowBottomClearance = rootStyle.getPropertyValue('--footer-row-bottom-clearance').trim() || '0px';
    const screenObj = window.screen;
    const screenW = screenObj ? Math.round(screenObj.width || 0) : 'na';
    const screenH = screenObj ? Math.round(screenObj.height || 0) : 'na';
    const screenAvailW = screenObj ? Math.round(screenObj.availWidth || 0) : 'na';
    const screenAvailH = screenObj ? Math.round(screenObj.availHeight || 0) : 'na';
    const iosViewportFloor = Math.round(getIosStandaloneViewportFloor() || 0);
    // Gap between the bottom of the footer and the screen bottom (should be 0)
    const footerScreenGap = footerRect ? Math.round(innerH - footerRect.bottom) : 'na';
    // Actual scorecard top in viewport
    const scorecardEl = document.getElementById('main-scorecard');
    const scorecardActualTop = scorecardEl ? Math.round(scorecardEl.getBoundingClientRect().top) : 'na';
    const scorecardActualH = scorecardEl ? Math.round(scorecardEl.getBoundingClientRect().height) : 'na';
    const scorecardBottom = scorecardEl ? Math.round(scorecardEl.getBoundingClientRect().bottom) : 'na';
    const footerScorecardGap = (typeof footerTop === 'number' && typeof scorecardBottom === 'number')
      ? footerTop - scorecardBottom : 'na';

    // Sticky row positions and their CSS top variables
    const stickyHeadTop  = rootStyle.getPropertyValue('--score-sticky-head-top').trim()  || '?';
    const stickyParTop   = rootStyle.getPropertyValue('--score-sticky-par-top').trim()   || '?';
    const stickyHcpTop   = rootStyle.getPropertyValue('--score-sticky-hcp-top').trim()   || '?';
    const scorecardEl2   = document.getElementById('main-scorecard');
    const theadEl        = scorecardEl2?.querySelector('thead tr');
    const parRowEl       = document.getElementById('parRow');
    const hcpRowEl       = document.getElementById('hcpRow');
    const firstPlayerEl  = document.querySelector('#scorecard .player-row');
    const px = (el) => el ? Math.round(el.getBoundingClientRect().top) : 'na';
    const ph = (el) => el ? Math.round(el.getBoundingClientRect().height) : 'na';
    const theadTop  = px(theadEl);  const theadH  = ph(theadEl);
    const parTop    = px(parRowEl); const parH    = ph(parRowEl);
    const hcpTop2   = px(hcpRowEl); const hcpH    = ph(hcpRowEl);
    const fp        = px(firstPlayerEl);
    const hcpBot    = hcpRowEl ? Math.round(hcpRowEl.getBoundingClientRect().bottom) : 'na';
    const rowGap    = (typeof hcpBot === 'number' && typeof fp === 'number') ? fp - hcpBot : 'na';
    const footerCardTop = payload.footerInternals?.card?.top ?? 'na';
    const footerCardH = payload.footerInternals?.card?.height ?? 'na';
    const footerControlsTop = payload.footerInternals?.controls?.top ?? 'na';
    const footerControlsH = payload.footerInternals?.controls?.height ?? 'na';
    const footerSwitcherTop = payload.footerInternals?.switcher?.top ?? 'na';
    const footerSwitcherBottom = payload.footerInternals?.switcher?.bottom ?? 'na';
    const footerSwitcherH = payload.footerInternals?.switcher?.height ?? 'na';
    const switcherScreenGap = footerRect && typeof footerSwitcherBottom === 'number'
      ? Math.round(innerH - footerSwitcherBottom) : 'na';
    const displayMode = getDisplayModeState();

    content.textContent = [
      `${ts}  reason=${payload.reason}`,
      `── Mode ──  iosPwa=${isIosPwaMode()}  mode=${displayMode.mode}  standaloneApp=${displayMode.isStandaloneApp}`,
      `── Sticky vars ──  --head-top=${stickyHeadTop}  --par-top=${stickyParTop}  --hcp-top=${stickyHcpTop}`,
      `── Row tops ──  thead=${theadTop}(h${theadH})  par=${parTop}(h${parH})  hcp=${hcpTop2}(h${hcpH})  firstPlayer=${fp}  gap=${rowGap}px`,
      `── Panel ──   panelTop=${panelTop == null ? 'na' : `${panelTop}px`}  panelScroll=${panelScroll}  overlap=${overlap == null ? 'na' : `${overlap}px`}`,
      `── Scorecard ──  actualTop=${scorecardActualTop}px  h=${scorecardActualH}px  bottom=${scorecardBottom}px`,
      `── Footer ──  pos=${footerCssPosition}  cssBottom=${footerCssBottom}  --offset=${footerBottomOffset}  --safeBottom=${safeBottomInset}  --rowClear=${footerRowBottomClearance}  top=${footerTop}px  h=${footerH}px`,
      `── Footer Rows ──  cardTop=${footerCardTop}(h${footerCardH})  controlsTop=${footerControlsTop}(h${footerControlsH})  switcherTop=${footerSwitcherTop}(h${footerSwitcherH})  switcherGap=${switcherScreenGap}px  optionsOpen=${payload.footerInternals?.optionsOpen}`,
      `── Viewport ──  innerH=${innerH}px  vvH=${vvH}px  appDvh=${appDvh}  floor=${iosViewportFloor}px`,
      `── Screen ──  screen=${screenW}x${screenH}  avail=${screenAvailW}x${screenAvailH}`,
      `── Gaps ──  footerScreenGap=${footerScreenGap}px ← 0=ok  footerScorecardGap=${footerScorecardGap}px ← 0=ok`
    ].join('\n');
  }

  function debugScorecardTrace(reason, extra = {}) {
    if (!isLayoutDebugTraceEnabled()) {
      hideLayoutDebugReadouts();
      return null;
    }
    const payload = collectScorecardClipMetrics(reason, extra);
    renderScorecardHeaderDebugReadout(payload);
    return payload;
  }

  function setupScorecardDebugTrace() {
    if (window.__scorecardDebugTraceBound) return;
    window.__scorecardDebugTraceBound = true;

    const scorePanel = document.getElementById('scoreEntryPanel');
    const scorecard = document.getElementById('main-scorecard');
    const trace = (reason, extra = {}) => debugScorecardTrace(reason, extra);

    window.addEventListener('resize', () => trace('window:resize'), { passive: true });
    window.addEventListener('scroll', () => trace('window:scroll'), { passive: true });
    window.visualViewport?.addEventListener('resize', () => trace('visualViewport:resize'), { passive: true });
    window.visualViewport?.addEventListener('scroll', () => trace('visualViewport:scroll'), { passive: true });
    scorePanel?.addEventListener('scroll', () => trace('scorePanel:scroll'), { passive: true });
    scorecard?.addEventListener('scroll', () => trace('scorecard:scroll'), { passive: true });
    document.addEventListener('golf:game-tab-changed', (e) => trace('golf:game-tab-changed', { detail: e.detail || null }));
    document.addEventListener('golf:debug-mode-changed', (e) => {
      const enabled = !!e.detail?.enabled;
      if (!enabled) {
        hideLayoutDebugReadouts();
        return;
      }
      trace('debug:enabled');
    });

    setTimeout(() => trace('scorecard-debug:init+120ms'), 120);
    setTimeout(() => trace('scorecard-debug:init+500ms'), 500);
  }

  function refreshFooterShellPresentation(shell = getActiveFooterShell()) {
    if (!(shell instanceof HTMLElement)) return;

    shell.style.willChange = 'transform';
    shell.style.transform = 'translateZ(0)';
    void shell.offsetHeight;

    requestAnimationFrame(() => {
      shell.style.transform = '';
      shell.style.willChange = '';
    });
  }

  function refreshActiveFooterShellPresentation() {
    refreshFooterShellPresentation(getActiveFooterShell());
  }

  function syncFixedFooterBottomOffset() {
    const root = document.documentElement;
    if (!root) return;

    const standalone = isIosPwaMode();
    const activeEl = document.activeElement;
    const isEditableFocused = !!activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      activeEl.isContentEditable
    );

    // In standalone/PWA mode with no keyboard active, skip all viewport math
    // entirely. The visualViewport/layout-viewport mismatch during iOS
    // transitions can produce a phantom positive inset that floats the footer.
    // Just pin to 0 immediately and return — no calculation needed.
    if (standalone && !isEditableFocused) {
      if (lastFooterBottomOffsetPx !== 0) {
        root.style.setProperty('--footer-bottom-offset', '0px');
        lastFooterBottomOffsetPx = 0;
        debugFooterTrace('syncFixedFooterBottomOffset:standalone-pinned', {
          clampedInset: 0,
          standalone,
          isEditableFocused
        });
      }
      return;
    }

    const vv = window.visualViewport;
    const layoutViewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const visualBottom = vv ? (vv.offsetTop + vv.height) : layoutViewportHeight;
    const rawInset = Math.round(layoutViewportHeight - visualBottom);

    // Not standalone or keyboard is active — compute and apply the real inset.
    const clampedInset = Math.max(0, Math.min(160, rawInset));

    if (clampedInset !== lastFooterBottomOffsetPx) {
      root.style.setProperty('--footer-bottom-offset', `${clampedInset}px`);
      lastFooterBottomOffsetPx = clampedInset;
      debugFooterTrace('syncFixedFooterBottomOffset', {
        clampedInset,
        rawInset,
        standalone,
        isEditableFocused
      });
    }
  }

  function syncSafeTopInset() {
    const root = document.documentElement;
    if (!root) return;

    const vv = window.visualViewport;
    // visualViewport.offsetTop reflects keyboard/zoom offset, not status bar — don't use for bar height.
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const standalone = isIosPwaMode();
    const portrait = (window.innerHeight || 0) >= (window.innerWidth || 0);

    // Read what CSS env() resolved to; non-zero means the platform already handled it.
    // We inject a temporary element to sample the computed value without a stored var.
    let envTop = 0;
    try {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
      document.documentElement.appendChild(probe);
      envTop = Math.round(parseFloat(getComputedStyle(probe).top) || 0);
      probe.remove();
    } catch (_) {}

    // Platform fallbacks when env(safe-area-inset-top) is 0 in standalone mode.
    // iOS portrait: pick a conservative value based on screen class.
    // Android: 24px minimum status bar; modern Android Chrome returns correct env() so fallback rarely fires.
    let fallbackTop = 0;
    if (standalone && envTop === 0) {
      if (isIOS && portrait) {
        const longestEdge = Math.max(window.screen?.height || 0, window.screen?.width || 0);
        // Notch/Dynamic-Island iPhones are typically >= 812pt in portrait.
        fallbackTop = longestEdge >= 812 ? 44 : 20;
      }
      else if (isAndroid) fallbackTop = 24;
    }

    const safeTop = Math.max(envTop, fallbackTop);
    root.style.setProperty('--safe-top-dynamic', `${safeTop}px`);
  }

  function syncSafeBottomInset() {
    const root = document.documentElement;
    if (!root) return;

    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = isIosPwaMode();
    const activeEl = document.activeElement;
    const isEditableFocused = !!activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      activeEl.isContentEditable
    );

    let envBottom = 0;
    let envBottomMax = 0;
    try {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
      document.documentElement.appendChild(probe);
      envBottom = Math.round(parseFloat(getComputedStyle(probe).bottom) || 0);
      probe.remove();
    } catch (_) {}

    try {
      const probeMax = document.createElement('div');
      probeMax.style.cssText = 'position:fixed;bottom:env(safe-area-max-inset-bottom,0px);visibility:hidden;pointer-events:none';
      document.documentElement.appendChild(probeMax);
      envBottomMax = Math.round(parseFloat(getComputedStyle(probeMax).bottom) || 0);
      probeMax.remove();
    } catch (_) {}

    let safeBottom = envBottom;
    if (standalone && !isEditableFocused && isIOS) {
      const longestEdge = Math.max(window.screen?.height || 0, window.screen?.width || 0);
      const shortestEdge = Math.min(window.screen?.height || 0, window.screen?.width || 0);
      const isPhoneLikeViewport = shortestEdge > 0 && shortestEdge <= 430;
      const hasHomeIndicatorPhone = isPhoneLikeViewport && longestEdge >= 812;

      // Cold-open iOS PWA bottom inset reporting is still inconsistent. Use a
      // deterministic conservative inset for home-indicator phones so the
      // footer lands in one place every time instead of oscillating high/low.
      if (hasHomeIndicatorPhone) {
        safeBottom = 24;
      } else {
        safeBottom = Math.max(envBottom, envBottomMax, 0);
        safeBottom = Math.max(0, Math.min(20, safeBottom));
      }
    }

    root.style.setProperty('--safe-bottom-inset', `${safeBottom}px`);
  }

  function rememberPrimaryTabScroll(which = getPrimaryTab()) {
    if (which !== 'score' && which !== 'games') return;
    // Primary tabs use internal panel scrolling; preserving window scroll
    // introduces layout drift on mobile/PWA when switching tabs.
    PRIMARY_TAB_SCROLL_POSITIONS[which] = 0;
  }

  function rememberGameTabScroll(which = getActiveGameTab()) {
    if (!GAME_TAB_ORDER.includes(which)) return;
    GAME_TAB_SCROLL_POSITIONS[which] = getGamesScrollTop();
  }

  function restorePrimaryTabScroll(which) {
    if (which !== 'score' && which !== 'games') return;
    // Always pin the document viewport to top for primary tabs. Their content
    // is scrolled inside dedicated panels, not at window level.
    const top = 0;
    const applyScroll = () => {
      window.scrollTo({ top, left: 0, behavior: 'auto' });
    };

    requestAnimationFrame(applyScroll);
    setTimeout(applyScroll, 120);
    setTimeout(applyScroll, 260);
  }

  function restoreGameTabScroll(which) {
    if (!GAME_TAB_ORDER.includes(which)) return;
    const top = Number(GAME_TAB_SCROLL_POSITIONS[which]) || 0;
    const applyScroll = () => {
      setGamesScrollTop(top);
    };

    requestAnimationFrame(applyScroll);
    setTimeout(applyScroll, 120);
    setTimeout(applyScroll, 260);
  }

  function syncPrimaryTabUi(activeTab) {
    const scoreBtn = document.getElementById('entrySwitcherScoreBtn');
    const gamesBtn = document.getElementById('entrySwitcherGamesBtn');
    const scorePanel = document.getElementById('scoreEntryPanel');
    const gamesPanel = document.getElementById('gamesEntryPanel');
    const gamesFooterShell = document.querySelector('.games-controls-shell');
    if (!scoreBtn || !gamesBtn || !scorePanel || !gamesPanel) return;

    const isScore = activeTab === 'score';
    document.body?.classList.toggle('mode-score', isScore);
    document.body?.classList.toggle('mode-games', !isScore);
    scoreBtn.classList.toggle('active', isScore);
    gamesBtn.classList.toggle('active', !isScore);
    scoreBtn.setAttribute('aria-selected', isScore ? 'true' : 'false');
    gamesBtn.setAttribute('aria-selected', !isScore ? 'true' : 'false');

    const gamesFooterScoreBtn = document.getElementById('gamesFooterScoreBtn');
    const gamesFooterGamesBtn = document.getElementById('gamesFooterGamesBtn');
    if (gamesFooterScoreBtn) {
      gamesFooterScoreBtn.classList.toggle('active', isScore);
      gamesFooterScoreBtn.setAttribute('aria-selected', isScore ? 'true' : 'false');
    }
    if (gamesFooterGamesBtn) {
      gamesFooterGamesBtn.classList.toggle('active', !isScore);
      gamesFooterGamesBtn.setAttribute('aria-selected', !isScore ? 'true' : 'false');
    }

    const incoming = isScore ? scorePanel : gamesPanel;
    const outgoing  = isScore ? gamesPanel : scorePanel;

    // Keep tab switches instant to avoid visible flashing on mobile.
    incoming.classList.remove('panel-entering');
    outgoing.classList.remove('panel-entering');
    scorePanel.hidden = !isScore;
    gamesPanel.hidden = isScore;

    if (gamesFooterShell) {
      gamesFooterShell.hidden = isScore;
    }
  }

  function syncGameTabUi(activeGame) {
    GAME_TAB_ORDER.forEach((gameKey) => {
      const config = getGameConfig(gameKey);
      const toggleBtn = resolveTargetElement(config?.toggle);
      if (!toggleBtn) return;

      const isActive = activeGame === gameKey;
      const wasActive = toggleBtn.classList.contains('active');
      toggleBtn.classList.toggle('active', isActive);
      toggleBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      toggleBtn.setAttribute('tabindex', isActive ? '0' : '-1');

      // Pop animation on newly activated tab
      if (isActive && !wasActive) {
        toggleBtn.classList.remove('tab-activating');
        void toggleBtn.offsetWidth; // force reflow to restart animation
        toggleBtn.classList.add('tab-activating');
        toggleBtn.addEventListener('animationend', () => toggleBtn.classList.remove('tab-activating'), { once: true });
      }
    });

    // Slide pill indicator to active button (touch/mobile only)
    requestAnimationFrame(() => {
      const gamesbar = document.getElementById('gamesLauncher');
      if (!gamesbar) return;

      // Remove any leftover pill from previous implementation
      gamesbar.querySelector('.gamesbar-pill')?.remove();
    });

    syncGamesLauncherUi(activeGame);
  }

  function isCompactGamesLauncherViewport() {
    return window.matchMedia?.(GAME_LAUNCHER_COMPACT_QUERY)?.matches
      ?? (window.innerWidth <= 1024);
  }

  function getNormalizedGameLauncherPins(rawPins) {
    const normalized = {};
    GAME_TAB_ORDER.forEach((gameKey) => {
      normalized[gameKey] = !!rawPins?.[gameKey];
    });
    return normalized;
  }

  function applyLoadedGamesLauncherUi(localUi = null) {
    const persisted = localUi?.gamesLauncher;
    if (!persisted || typeof persisted !== 'object') return;

    GAME_LAUNCHER_STATE.collapsed = persisted.collapsed !== false;
    GAME_LAUNCHER_STATE.pins = getNormalizedGameLauncherPins(persisted.pins);
  }

  function syncGamesLauncherUi(activeGame = getActiveGameTab()) {
    const shell = document.getElementById('gamesLauncherShell');
    const bar = document.getElementById('gamesLauncher');
    if (!shell || !bar) return;

    const compact = isCompactGamesLauncherViewport();
    shell.classList.toggle('is-compact', compact);
    shell.classList.add('is-collapsed');

    GAME_TAB_ORDER.forEach((gameKey) => {
      const item = bar.querySelector(`.game-toggle-item[data-game-key="${gameKey}"]`);
      if (!item) return;
      item.hidden = false;
      item.dataset.pinned = 'true';
    });
  }

  function bindGamesLauncherControls() {
    // Pre-create the scroll indicator so its height is reserved on first
    // render — prevents the games footer from bouncing 7px when overflow is
    // detected later.
    ensureGamesScrollIndicator();

    window.addEventListener('resize', () => {
      syncGamesLauncherUi();
      updateGamesbarScrollHint();
    }, { passive: true });

    const bar = document.getElementById('gamesLauncher');
    if (bar) {
      bar.addEventListener('scroll', updateGamesbarScrollHint, { passive: true });
      // Recompute after layout settles (fonts, images, etc.)
      requestAnimationFrame(updateGamesbarScrollHint);
      setTimeout(updateGamesbarScrollHint, 250);
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => updateGamesbarScrollHint());
        ro.observe(bar);
      }
    }

    syncGamesLauncherUi(getActiveGameTab());
  }

  function ensureGamesScrollIndicator() {
    const shell = document.getElementById('gamesLauncherShell');
    if (!shell) return null;
    let indicator = shell.querySelector('.gamesbar-scroll-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'gamesbar-scroll-indicator';
      const thumb = document.createElement('div');
      thumb.className = 'gamesbar-scroll-indicator__thumb';
      indicator.appendChild(thumb);
      shell.appendChild(indicator);
    }
    return indicator;
  }

  function updateGamesbarScrollHint() {
    const shell = document.getElementById('gamesLauncherShell');
    const bar = document.getElementById('gamesLauncher');
    if (!shell || !bar) return;
    const indicator = ensureGamesScrollIndicator();
    const overflow = bar.scrollWidth - bar.clientWidth > 4;
    shell.classList.toggle('has-scroll-overflow', overflow);
    if (!indicator) return;
    const thumb = indicator.firstElementChild;
    if (!thumb) return;
    if (!overflow) {
      thumb.style.width = '0%';
      thumb.style.left = '0%';
      return;
    }
    const ratio = bar.clientWidth / bar.scrollWidth;
    const thumbW = Math.max(ratio * 100, 12);
    const maxScroll = bar.scrollWidth - bar.clientWidth;
    const pos = maxScroll > 0 ? (bar.scrollLeft / maxScroll) * (100 - thumbW) : 0;
    thumb.style.width = thumbW + '%';
    thumb.style.left = pos + '%';
  }

  function setPrimaryTab(which, { save = true } = {}) {
    if (which !== 'score' && which !== 'games') return;

    beginTabFlipBurst();

    const currentTab = getPrimaryTab();
    if (currentTab === 'games') {
      rememberGameTabScroll(getActiveGameTab());
    }
    rememberPrimaryTabScroll(currentTab);

    // Collapse the header when on Games tab to maximise panel real estate.
    // Must happen before syncPrimaryTabUi so the new maxHeight calculation
    // already sees the header as gone.
    const appHeader = document.querySelector('header');
    const parBadge = document.getElementById('parBadge');
    // No auto-hide on tab switch — user controls visibility via Hide/Show button.
    syncHeaderCollapseBtn();

    syncPrimaryTabUi(which);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    debugFooterTrace('setPrimaryTab:after-ui', { which });
    if (which === 'games') {
      // Delay one frame so layout settles before measuring.
      requestAnimationFrame(() => {
        refreshActiveFooterShellPresentation();
        schedulePanelHeightSync();
        debugFooterTrace('setPrimaryTab:games-raf', { which });
        setTimeout(refreshActiveFooterShellPresentation, 60);
        setTimeout(schedulePanelHeightSync, 60);
        // Run again after transitions finish (header/options panels).
        setTimeout(refreshActiveFooterShellPresentation, 300);
        setTimeout(schedulePanelHeightSync, 300);
        setTimeout(schedulePanelHeightSync, 700);
        setTimeout(schedulePanelHeightSync, 1200);
        const activeGame = getActiveGameTab();
        if (activeGame) {
          AppManager.flushGame(activeGame, false);
          restoreGameTabScroll(activeGame);
        } else {
          restorePrimaryTabScroll(which);
        }
      });
    } else {
      requestAnimationFrame(() => {
        refreshActiveFooterShellPresentation();
        schedulePanelHeightSync();
        triggerScorecardSettleBurst('setPrimaryTab:score');
        debugFooterTrace('setPrimaryTab:score-raf', { which });
        setTimeout(refreshActiveFooterShellPresentation, 60);
        setTimeout(schedulePanelHeightSync, 60);
        setTimeout(schedulePanelHeightSync, 300);
        setTimeout(schedulePanelHeightSync, 700);
        setTimeout(schedulePanelHeightSync, 1200);
      });
      restorePrimaryTabScroll(which);
    }

    if (save) scheduleSaveAfterFlipBurst();
  }

  function setupScorecardScrollSync() {
    // Single-table scorecard uses native scrolling in one pane.
  }

  /**
   * iOS edge guard for score panes.
   * Keep scroll fixed to pane content and suppress edge rubber-band.
   */
  function setupIOSScorecardOverscrollGuard() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return;

    const scrollPane = document.querySelector('.scorecard-container');
    if (!scrollPane) return;

    const installGuard = (pane) => {
      let startX = 0;
      let startY = 0;
      let lastY = 0;

      pane.addEventListener('touchstart', (e) => {
        const t = e.touches && e.touches[0];
        if (!t) return;
        startX = t.clientX;
        startY = t.clientY;
        lastY = t.clientY;
      }, { passive: true });

      pane.addEventListener('touchmove', (e) => {
        const t = e.touches && e.touches[0];
        if (!t) return;

        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        const dyStep = t.clientY - lastY;
        const mostlyVertical = Math.abs(dy) > Math.abs(dx);
        if (!mostlyVertical) {
          lastY = t.clientY;
          return;
        }

        const maxTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
        // If pane has no vertical overflow yet, don't intercept gesture.
        if (maxTop < 2) {
          lastY = t.clientY;
          return;
        }

        const atTop = pane.scrollTop <= 0;
        const atBottom = pane.scrollTop >= maxTop - 1;
        const draggingPastTop = atTop && dyStep > 0;
        const draggingPastBottom = atBottom && dyStep < 0;

        // At pane edges, always suppress rubber-band and do not hand off
        // movement to page scroll (fixed-score mode on iOS).
        if (draggingPastTop || draggingPastBottom) {
          e.preventDefault();
        }

        lastY = t.clientY;
      }, { passive: false });
    };

    installGuard(scrollPane);
  }

  function setupIOSGamesTableOverscrollGuard() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return;

    const installGuard = (pane) => {
      if (!(pane instanceof HTMLElement) || pane.dataset.iosOverscrollGuard === 'true') return;
      pane.dataset.iosOverscrollGuard = 'true';

      let startX = 0;
      let startY = 0;
      let lastY = 0;

      pane.addEventListener('touchstart', (e) => {
        const t = e.touches && e.touches[0];
        if (!t) return;
        startX = t.clientX;
        startY = t.clientY;
        lastY = t.clientY;
      }, { passive: true });

      pane.addEventListener('touchmove', (e) => {
        const t = e.touches && e.touches[0];
        if (!t) return;

        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        const dyStep = t.clientY - lastY;
        const mostlyVertical = Math.abs(dy) > Math.abs(dx);
        if (!mostlyVertical) {
          lastY = t.clientY;
          return;
        }

        const maxTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
        if (maxTop < 2) {
          lastY = t.clientY;
          return;
        }

        const atTop = pane.scrollTop <= 0;
        const atBottom = pane.scrollTop >= maxTop - 1;
        const draggingPastTop = atTop && dyStep > 0;
        const draggingPastBottom = atBottom && dyStep < 0;

        if (draggingPastTop || draggingPastBottom) {
          e.preventDefault();
        }

        lastY = t.clientY;
      }, { passive: false });
    };

    document.querySelectorAll('.vegas-wrap, .banker-wrap').forEach(installGuard);
  }

  function setupDesktopGamesTablePointerScroll() {
    // Native browser scrolling is the most reliable behavior on desktop.
    // Keep this hook as a no-op so existing init wiring remains stable.
    return;
  }

  /**
   * iOS Safari ignores position:sticky on th/td inside overflow:scroll containers.
   * Work around with translateY(scrollTop) applied via rAF on each scroll event.
   * Refreshes its cell cache whenever the scorecard is rebuilt (syncRowHeights calls
   * window._iosStickyRefresh if present).
   */
  function setupIOSStickyHeaders() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return;

    const scrollPane = document.querySelector('.scorecard-container');
    if (!scrollPane) return;

    let stickyEls = [];
    let fallbackEnabled = false;
    let listenersBound = false;

    function refreshCells() {
      stickyEls = [
        ...scrollPane.querySelectorAll('thead th'),
        ...scrollPane.querySelectorAll('#parRow td, #parRow th'),
        ...scrollPane.querySelectorAll('#hcpRow td, #hcpRow th'),
      ];
      stickyEls.forEach((el) => {
        el.style.willChange = fallbackEnabled ? 'transform' : 'auto';
        if (!fallbackEnabled) {
          el.style.transform = '';
        }
      });
    }

    let rafId = null;
    function applyTranslate() {
      rafId = null;
      if (!fallbackEnabled) return;
      const st = scrollPane.scrollTop;
      stickyEls.forEach(el => { el.style.transform = `translateY(${st}px)`; });
    }

    function onScroll() {
      if (!fallbackEnabled) return;
      if (rafId) return;
      rafId = requestAnimationFrame(applyTranslate);
    }

    function detectNativeStickyWorks() {
      const probe = scrollPane.querySelector('thead th');
      if (!probe) return true;

      const maxScroll = Math.max(0, scrollPane.scrollHeight - scrollPane.clientHeight);
      if (maxScroll < 12) return true;

      const startTop = scrollPane.scrollTop;
      const targetTop = Math.min(maxScroll, startTop + 16);
      const beforeTop = probe.getBoundingClientRect().top;

      scrollPane.scrollTop = targetTop;
      const afterTop = probe.getBoundingClientRect().top;

      scrollPane.scrollTop = startTop;

      return Math.abs(afterTop - beforeTop) <= 1.5;
    }

    function ensureFallbackMode() {
      const nativeStickyWorks = detectNativeStickyWorks();
      fallbackEnabled = !nativeStickyWorks;
      refreshCells();

      if (fallbackEnabled && !listenersBound) {
        listenersBound = true;
        scrollPane.addEventListener('scroll', onScroll, { passive: true });
      }

      if (fallbackEnabled) {
        applyTranslate();
      }
    }

    refreshCells();
    ensureFallbackMode();
    setTimeout(ensureFallbackMode, 200);
    setTimeout(ensureFallbackMode, 700);

    // Expose so syncRowHeights() can call after DOM rebuilds / player count changes.
    // This re-checks whether native sticky works at the current layout size.
    window._iosStickyRefresh = () => {
      ensureFallbackMode();
    };
  }

  function setupIOSGamesStickyHeaders() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return;

    const paneState = new WeakMap();

    const ensurePane = (scrollPane) => {
      if (!(scrollPane instanceof HTMLElement)) return null;
      if (paneState.has(scrollPane)) return paneState.get(scrollPane);

      let stickyEls = [];
      let fallbackEnabled = false;
      let listenersBound = false;
      let rafId = null;

      function refreshCells() {
        stickyEls = [...scrollPane.querySelectorAll('thead th')];
        stickyEls.forEach((el) => {
          el.style.willChange = fallbackEnabled ? 'transform' : 'auto';
          if (!fallbackEnabled) {
            el.style.transform = '';
          }
        });
      }

      function applyTranslate() {
        rafId = null;
        if (!fallbackEnabled) return;
        const st = scrollPane.scrollTop;
        stickyEls.forEach((el) => {
          el.style.transform = `translateY(${st}px)`;
        });
      }

      function onScroll() {
        if (!fallbackEnabled) return;
        if (rafId) return;
        rafId = requestAnimationFrame(applyTranslate);
      }

      function detectNativeStickyWorks() {
        const probe = scrollPane.querySelector('thead th');
        if (!probe) return true;

        const maxScroll = Math.max(0, scrollPane.scrollHeight - scrollPane.clientHeight);
        if (maxScroll < 12) return true;

        const startTop = scrollPane.scrollTop;
        const targetTop = Math.min(maxScroll, startTop + 16);
        const beforeTop = probe.getBoundingClientRect().top;

        scrollPane.scrollTop = targetTop;
        const afterTop = probe.getBoundingClientRect().top;
        scrollPane.scrollTop = startTop;

        return Math.abs(afterTop - beforeTop) <= 1.5;
      }

      function ensureFallbackMode() {
        const nativeStickyWorks = detectNativeStickyWorks();
        fallbackEnabled = !nativeStickyWorks;
        refreshCells();

        if (fallbackEnabled && !listenersBound) {
          listenersBound = true;
          scrollPane.addEventListener('scroll', onScroll, { passive: true });
        }

        if (fallbackEnabled) {
          applyTranslate();
        }
      }

      const state = { refresh: ensureFallbackMode };
      paneState.set(scrollPane, state);
      refreshCells();
      ensureFallbackMode();
      setTimeout(ensureFallbackMode, 200);
      setTimeout(ensureFallbackMode, 700);
      return state;
    };

    window._iosGamesStickyRefresh = () => {
      document.querySelectorAll('.vegas-wrap, .banker-wrap').forEach((pane) => {
        const state = ensurePane(pane);
        state?.refresh?.();
      });
    };

    window._iosGamesStickyRefresh();
  }

  function setupGamesPanelScrollSync() {
    const panel = getGamesScrollContainer();
    if (!panel) return;

    const syncLayout = () => {
      syncDynamicViewportHeight();
      syncSafeTopInset();
      syncSafeBottomInset();
      syncFixedFooterBottomOffset();
      syncGamesPanelHeight();
      syncScorePanelHeight();
      syncGamesFooterHeightVar();
      syncActiveGamePinnedResultsLayout();
    };

    // Debounced resize: collapse rapid-fire visualViewport/window resize events
    // (mobile browser chrome show/hide) into a single RAF to prevent idle CPU burn.
    let resizeSyncScheduled = false;
    const syncLayoutDebounced = () => {
      if (resizeSyncScheduled) return;
      resizeSyncScheduled = true;
      requestAnimationFrame(() => {
        resizeSyncScheduled = false;
        syncLayout();
      });
    };

    let scrollSyncScheduled = false;
    const syncOnScroll = () => {
      if (scrollSyncScheduled) return;
      scrollSyncScheduled = true;
      requestAnimationFrame(() => {
        scrollSyncScheduled = false;
        // Safe-area inset is layout/device driven and handled by resize/pageshow.
        syncFixedFooterBottomOffset();
        syncGamesPanelHeight();
        syncScorePanelHeight();
        syncGamesFooterHeightVar();
        syncActiveGamePinnedResultsLayout();
      });
    };

    syncLayout();
    window.addEventListener('resize', syncLayoutDebounced, { passive: true });
    window.addEventListener('orientationchange', syncLayout, { passive: true });
    window.addEventListener('scroll', syncOnScroll, { passive: true });
    window.addEventListener('focus', syncLayoutDebounced, { passive: true });
    window.visualViewport?.addEventListener('resize', syncLayoutDebounced, { passive: true });
    window.visualViewport?.addEventListener('scroll', syncOnScroll, { passive: true });

    const syncLayoutWithFollowUps = () => {
      syncLayout();
      setTimeout(syncLayout, 120);
      setTimeout(syncLayout, 320);
    };

    // iOS standalone can report transient viewport values after initial paint
    // and after app resume. Run a late settle pass and force another sync if
    // footer is not physically attached to the bottom edge.
    const runFooterAttachmentSettlePass = () => {
      const shells = [
        document.querySelector('.scorecard-controls-shell'),
        document.querySelector('.games-controls-shell')
      ].filter((shell) => shell instanceof HTMLElement);
      shells.forEach((shell) => refreshFooterShellPresentation(shell));

      const shell = getActiveFooterShell();
      if (!(shell instanceof HTMLElement)) {
        syncLayout();
        return;
      }

      const rect = shell.getBoundingClientRect();
      const innerH = window.innerHeight || document.documentElement.clientHeight || 0;
      const gap = Math.round(innerH - rect.bottom);

      if (gap > 0) {
        // If a stale positive offset slipped through, clear it and re-sync.
        document.documentElement.style.setProperty('--footer-bottom-offset', '0px');
        lastFooterBottomOffsetPx = 0;
      }

      syncLayout();
      shells.forEach((shell) => {
        setTimeout(() => refreshFooterShellPresentation(shell), 0);
        setTimeout(() => refreshFooterShellPresentation(shell), 90);
      });
    };

    const runFinalLayoutSettleChecks = () => {
      syncLayoutWithFollowUps();
      setTimeout(runFooterAttachmentSettlePass, 650);
      setTimeout(runFooterAttachmentSettlePass, 1100);
    };

    // Re-measure once all resources are loaded and again on lifecycle resumes.
    // iOS standalone can settle viewport/safe-area metrics after first paint.
    window.addEventListener('load', runFinalLayoutSettleChecks, { once: true });
    window.addEventListener('pageshow', runFinalLayoutSettleChecks, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        runFinalLayoutSettleChecks();
      }
    });
  }

  function setGameTab(which, { save = true, activatePrimary = true } = {}) {
    if (!GAME_TAB_ORDER.includes(which)) return;

    navigator.vibrate?.(6);

    if (isRemoteViewerSession()) {
      window.CloudSync?.suspendRemoteApplies?.(900);
    }

    beginTabFlipBurst();

    const previousGame = getActiveGameTab();
    if (previousGame) {
      rememberGameTabScroll(previousGame);
    }

    if (previousGame && previousGame !== which) {
      games_close(previousGame);
    }

    // Defensive cleanup for stale multi-open state (should be rare).
    GAME_TAB_ORDER.forEach((gameKey) => {
      if (gameKey === which || gameKey === previousGame) return;
      const sectionId = GAME_SECTION_BY_KEY[gameKey];
      if (sectionId && AppManager._isSectionOpen(sectionId)) {
        games_close(gameKey);
      }
    });

    games_open(which);

    // Defer/coalesce heavy game calculation so tab visuals open first.
    scheduleGameTabFlush(which);

    syncGameTabUi(which);
    debugFooterTrace('setGameTab:after-ui', { which, activatePrimary });
    requestAnimationFrame(() => {
      refreshActiveFooterShellPresentation();
      schedulePanelHeightSync();
      debugFooterTrace('setGameTab:raf', { which, activatePrimary });
      setTimeout(refreshActiveFooterShellPresentation, 60);
      setTimeout(schedulePanelHeightSync, 60);
      setTimeout(refreshActiveFooterShellPresentation, 300);
      setTimeout(schedulePanelHeightSync, 300);
      setTimeout(schedulePanelHeightSync, 700);
    });
    schedulePanelHeightSync();

    if (activatePrimary) {
      syncPrimaryTabUi('games');
    }

    if (activatePrimary || getPrimaryTab() === 'games') {
      restoreGameTabScroll(which);
    }

    document.dispatchEvent(new CustomEvent('golf:game-tab-changed', {
      detail: { game: which, previousGame }
    }));

    if (save) scheduleSaveAfterFlipBurst();
  }

  let scoreInputRecalcFrame = null;
  const pendingScoreInputRows = new Set();
  let nameInputSyncTimer = null;

  function scheduleScoreInputRecalc(rowEl) {
    if (!(rowEl instanceof HTMLElement)) return;

    pendingScoreInputRows.add(rowEl);
    if (scoreInputRecalcFrame) return;

    scoreInputRecalcFrame = requestAnimationFrame(() => {
      scoreInputRecalcFrame = null;

      pendingScoreInputRows.forEach((row) => {
        Scorecard.calc.recalcRow(row);
      });
      pendingScoreInputRows.clear();

      Scorecard.calc.recalcTotalsRow();
      AppManager.recalcGamesDebounced();
    });
  }

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
        if (!header) return;
        const thPlayer = document.createElement("th");
        thPlayer.textContent = "Player";
        thPlayer.className = "align-left";
        header.appendChild(thPlayer);

        const thCh = document.createElement("th");
        thCh.textContent = "CH";
        header.appendChild(thCh);

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
        if (!parRow || !hcpRow) return;

        const parLabel = document.createElement("td");
        parLabel.className = "align-left";
        parLabel.innerHTML = "<strong>Par</strong>";
        parRow.appendChild(parLabel);
        parRow.appendChild(document.createElement("td"));

        const hcpLabel = document.createElement("td");
        hcpLabel.className = "align-left";
        hcpLabel.innerHTML = "<strong>HCP Index</strong>";
        hcpRow.appendChild(hcpLabel);
        hcpRow.appendChild(document.createElement("td"));

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
        if (!tbody) return;
        
        for(let p=0;p<PLAYERS;p++){
          // Create row for single table (name + CH + scores)
          const tr=document.createElement("tr"); 
          tr.className="player-row"; 
          tr.dataset.player=String(p);

          // Name input
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
            const currentIndex = Number(tr.dataset.player);
            Scorecard.player.removeByIndex(currentIndex);
          });
          
          const nameInput=document.createElement("input"); 
          nameInput.type="text"; 
          nameInput.className="name-edit"; 
          nameInput.placeholder=`Player ${p+1}`; 
          nameInput.autocomplete="off";
          nameInput.addEventListener("input",()=>{ 
            Scorecard.player.syncOverlay();
            window.Vegas?.refreshTeamNames?.();
            clearTimeout(nameInputSyncTimer);
            nameInputSyncTimer = setTimeout(() => {
              AppManager.recalcGamesDebounced();
            }, TIMING.NAME_INPUT_SYNC_MS);
            Storage.saveDebounced(); 
          });
          
          nameCellContainer.appendChild(deleteBtn);
          nameCellContainer.appendChild(nameInput);
          nameTd.appendChild(nameCellContainer); 
          tr.appendChild(nameTd);

          // Course Handicap input
          const chTd=document.createElement("td");
          
          const chInput=document.createElement("input"); 
          chInput.type="text"; 
          chInput.inputMode="text"; 
          chInput.className="ch-input"; 
          chInput.value="0"; 
          chInput.pattern="[+\\-]?[0-9]*";
          chInput.autocomplete="off";
          
          chInput.addEventListener("input", () => { 
            const raw = String(chInput.value ?? '').trim();
            if (!syncHandicapInput(chInput)) {
              if (raw === '') {
                Scorecard.calc.recalcAll(); 
                AppManager.recalcGamesDebounced();
                if (!Storage._isLoading) {
                  Scorecard.calc.applyStrokeHighlighting();
                }
                Storage.saveDebounced(); 
              }
              return;
            }
            Scorecard.calc.recalcAll(); 
            AppManager.recalcGamesDebounced();
            // Only apply highlighting if not currently loading from storage
            if (!Storage._isLoading) {
              Scorecard.calc.applyStrokeHighlighting();
            }
            Storage.saveDebounced(); 
          });
          chInput.addEventListener('blur', () => {
            syncHandicapInput(chInput, { normalizeDisplay: true });
          });
          chTd.appendChild(chInput); 
          tr.appendChild(chTd);

          // Score inputs for each hole
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
                
                if(inp.value.length >= 1 && Config.ADVANCE_DIRECTION !== 'disabled') {
                  let nextInput = null;
                  
                  if(Config.ADVANCE_DIRECTION === 'down') {
                    // Move to next player on same hole
                    if(currentPlayer < PLAYERS - 1) {
                      nextInput = document.querySelector(
                        `.score-input[data-player="${currentPlayer+1}"][data-hole="${currentHole}"]`
                      );
                    }
                  } else if(Config.ADVANCE_DIRECTION === 'right') {
                    // Move to next hole for same player
                    if(currentHole < HOLES - 1) {
                      nextInput = document.querySelector(
                        `.score-input[data-player="${currentPlayer}"][data-hole="${currentHole+1}"]`
                      );
                    }
                  }
                  
                  if(nextInput) {
                    setTimeout(() => {
                      nextInput.focus();
                      nextInput.select();
                    }, TIMING.FOCUS_DELAY_MS);
                  }
                }
              } else {
                inp.classList.remove("invalid");
              }
              scheduleScoreInputRecalc(tr);
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
        }
      },

      /**
       * Build totals row showing sum of all player scores per hole
       */
      totalsRow(){
        const totalsRow=$(ids.totalsRow);
        if(!totalsRow) return;
        const label = document.createElement("td");
        label.className = "subtle align-left";
        label.textContent = "Totals";
        totalsRow.appendChild(label);
        totalsRow.appendChild(document.createElement("td"));
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
       * Update sticky row offsets for single-table scorecard.
       */
      syncRowHeights(skipHighlighting = false) {
        const scrollTable = $(ids.table);
        if (!scrollTable) return;

        if (syncRowHeightsFrame) {
          cancelAnimationFrame(syncRowHeightsFrame);
        }

        syncRowHeightsFrame = requestAnimationFrame(() => {
          syncRowHeightsFrame = null;

          // Keep sticky par/hcp offsets aligned to current live row heights.
          // Uses only the single score table in unified mode.
          const scorePanel = document.getElementById('scoreEntryPanel');
          const panelVisible = !!scorePanel && !scorePanel.hidden && scorePanel.getBoundingClientRect().height > 0;
          const headerRowScroll = scrollTable.querySelector('thead tr');
          const parRowScroll = document.getElementById('parRow');
          const measuredHeaderHeight = headerRowScroll?.getBoundingClientRect().height || 0;
          const measuredParHeight = parRowScroll?.getBoundingClientRect().height || 0;

          // Guard: during tab flips / hidden states Android can transiently
          // report 0-height rows. Do not overwrite sticky vars with fallback
          // constants (which causes header row separation) until measurements
          // are trustworthy.
          const validMeasurements =
            panelVisible && measuredHeaderHeight >= 20 && measuredParHeight >= 20;
          if (!validMeasurements) {
            return;
          }

          const headerHeight = Math.ceil(measuredHeaderHeight);
          const parHeight = Math.ceil(measuredParHeight);
          const rootStyle = document.documentElement?.style;
          if (rootStyle) {
            rootStyle.setProperty('--score-sticky-par-top', `${headerHeight}px`);
            rootStyle.setProperty('--score-sticky-hcp-top', `${headerHeight + parHeight}px`);
          }

          // Refresh iOS sticky-by-transform cache after DOM rebuild.
          window._iosStickyRefresh?.();

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
        const fixedRows = $$("#scorecard .player-row");
        const chs = fixedRows.map(r => { 
          const chInput = $(".ch-input", r);
          const v = getActualHandicapValue(chInput);
          return Number.isFinite(v) ? v : 0; 
        });
        
        // Check current handicap mode
        const modeBtn = document.querySelector('#handicapModeGroup .hcp-mode-btn[data-active="true"]');
        const mode = modeBtn ? modeBtn.dataset.value : 'rawHandicap';
        
        // Mode 1: GROSS - no adjustments (return all zeros)
        if (mode === 'gross') {
          return chs.map(() => 0);
        }
        
        // Mode 3: FULL HANDICAP - return raw CHs (no play off low)
        if (mode === 'rawHandicap') {
          return chs; // Each player uses their full raw CH
        }
        
        // Mode 2: PLAY OFF LOW (default)
        const minCH = Math.min(...chs);
        return chs.map(ch => ch - minCH); // play off low
      },

      /**
       * Calculate strokes received on a specific hole
       * @param {number} adjCH - Adjusted course handicap (can be negative for plus handicaps in full mode)
       * @param {number} holeIdx - Zero-based hole index
       * @returns {number} Number of strokes on this hole (negative for plus handicaps)
       */
      strokesOnHole(adjCH, holeIdx){
        // Defensive check: ensure Config.hcpMen is initialized
        if(!Config.hcpMen || !Array.isArray(Config.hcpMen) || Config.hcpMen.length === 0) {
          console.error('[strokesOnHole] Config.hcpMen not initialized!', Config.hcpMen);
          return 0;
        }
        
        const holeHcp = Config.hcpMen[holeIdx];
        
        // Defensive check: ensure holeHcp is a valid number
        if(typeof holeHcp !== 'number' || !Number.isFinite(holeHcp)) {
          console.error(`[strokesOnHole] Invalid holeHcp at index ${holeIdx}:`, holeHcp, 'Config.hcpMen:', Config.hcpMen);
          return 0;
        }
        
        // Handle plus handicaps (negative adjCH) - player gives strokes back
        if(adjCH < 0) {
          const absCH = Math.abs(adjCH);
          const base = Math.floor(absCH / 18);
          const rem = absCH % 18;
          const givesStroke = holeHcp >= (19 - rem);
          return -(base + (givesStroke ? 1 : 0)); // Return negative strokes
        }
        
        // Handle zero or positive handicap
        if(adjCH <= 0) return 0;
        
        const base = Math.floor(adjCH / 18);
        const rem = adjCH % 18;
        return base + (holeHcp <= rem ? 1 : 0);
      },

      /**
       * Apply stroke-based visual state to an input element
       * @param {HTMLInputElement} input
       * @param {number} sr - Strokes received (negative for gives)
       */
      applyStrokeVisualState(input, sr) {
        if(!input) return;

        const indicatorMode = Config.STROKE_INDICATOR_MODE || 'both';
        const showHighlight = indicatorMode === 'highlight' || indicatorMode === 'both';
        const showSymbols = indicatorMode === 'symbols' || indicatorMode === 'both';
        const cell = input.closest('td');

        const clearSymbol = () => {
          if (!cell) return;
          if (cell.hasAttribute('data-stroke-symbol')) cell.removeAttribute('data-stroke-symbol');
          if (cell.hasAttribute('data-stroke-dots')) cell.removeAttribute('data-stroke-dots');
        };

        const setSymbol = (symbol, count = 1) => {
          if (!cell) return;
          cell.setAttribute('data-stroke-symbol', symbol);
          if (symbol === 'dot') {
            const dotCount = Math.max(1, Math.min(4, Number(count) || 1));
            cell.setAttribute('data-stroke-dots', String(dotCount));
          } else if (cell.hasAttribute('data-stroke-dots')) {
            cell.removeAttribute('data-stroke-dots');
          }
        };

        if(sr > 0) {
          if (showHighlight) {
            if (!input.classList.contains("receives-stroke")) input.classList.add("receives-stroke");
            if (input.classList.contains("gives-stroke")) input.classList.remove("gives-stroke");
          } else {
            input.classList.remove("receives-stroke", "gives-stroke");
          }

          if (showSymbols) {
            setSymbol('dot', sr);
          } else {
            clearSymbol();
          }

          const nextStrokes = String(sr);
          if (input.dataset.strokes !== nextStrokes) input.dataset.strokes = nextStrokes;
          const nextTitle = `Receives ${sr} stroke${sr > 1 ? 's' : ''}`;
          if (input.title !== nextTitle) input.title = nextTitle;
          return;
        }

        if(sr < 0) {
          if (showHighlight) {
            if (!input.classList.contains("gives-stroke")) input.classList.add("gives-stroke");
            if (input.classList.contains("receives-stroke")) input.classList.remove("receives-stroke");
          } else {
            input.classList.remove("receives-stroke", "gives-stroke");
          }

          if (showSymbols) {
            setSymbol('plus');
          } else {
            clearSymbol();
          }

          const nextStrokes = String(Math.abs(sr));
          if (input.dataset.strokes !== nextStrokes) input.dataset.strokes = nextStrokes;
          const nextTitle = `Gives ${Math.abs(sr)} stroke${Math.abs(sr) > 1 ? 's' : ''}`;
          if (input.title !== nextTitle) input.title = nextTitle;
          return;
        }

        if (input.classList.contains("receives-stroke") || input.classList.contains("gives-stroke")) {
          input.classList.remove("receives-stroke", "gives-stroke");
        }
        clearSymbol();
        if (input.hasAttribute("data-strokes")) input.removeAttribute("data-strokes");
        if (input.hasAttribute("title")) input.removeAttribute("title");
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
          Scorecard.calc.applyStrokeVisualState(input, sr);
        }
        
        const netEl = $(".net", rowEl);
        if(netEl) netEl.textContent = netTotal ? String(netTotal) : "—";
      },

      /**
       * Recalculate totals row showing sum of all player scores per hole
       */
      recalcTotalsRow(){
        const totalsRowEl = $(ids.totalsRow);
        if(!totalsRowEl) return;

        const playerRows = $$("#scorecard .player-row");
        const holeTotals = Array(HOLES).fill(0);
        let OUT = 0;
        let INN = 0;
        let TOT = 0;

        playerRows.forEach((row) => {
          const scoreInputs = $$('input.score-input', row);
          for (let h = 0; h < HOLES; h++) {
            holeTotals[h] += Number(scoreInputs[h]?.value) || 0;
          }

          const splitCells = row.querySelectorAll('td.split');
          OUT += Number(splitCells[0]?.textContent) || 0;
          INN += Number(splitCells[1]?.textContent) || 0;
          TOT += Number($(".total", row)?.textContent) || 0;
        });

        for(let h=1;h<=HOLES;h++){
          const t = holeTotals[h - 1] || 0;
          const holeTotalEl = $(`[data-hole-total="${h}"]`);
          if(holeTotalEl) {
            holeTotalEl.textContent = t? String(t) : "—";
          }
        }
        const tds=totalsRowEl.querySelectorAll("td"), base=LEADING_FIXED_COLS+HOLES;
        if(tds[base+0]) tds[base+0].textContent=OUT||"—"; 
        if(tds[base+1]) tds[base+1].textContent=INN||"—"; 
        if(tds[base+2]) tds[base+2].textContent=TOT||"—";

      },

      /**
       * Recalculate all player rows and totals row
       */
      recalcAll(force = false){ 
        // Throttle to prevent rapid repeated calls
        const now = Date.now();
        if(!force && this._lastRecalcAll && (now - this._lastRecalcAll) < 100) {
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
            const sr = Scorecard.calc.strokesOnHole(playerAdjCH, h);
            const input = scoreInputs[h];
            if(!input) continue;
            Scorecard.calc.applyStrokeVisualState(input, sr);
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
        const playerRows = document.querySelectorAll('#scorecard .player-row');
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

        // Keep header course controls synced with current course.
        const courseSearch = $('#courseSearch');
        if (courseSearch) {
          courseSearch.value = COURSES[courseId].name;
          courseSearch.dataset.selectedCourseId = courseId;
        }
        
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
        
        // Re-apply stroke highlighting after course handicap indexes change.
        Scorecard.calc.applyStrokeHighlighting();
        
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
    SYNC_SCHEMA_VERSION: 1,
    saveTimer: null,
    _isLoading: false,

    getNowTs() {
      return Date.now();
    },

    getPlayerId(existingState, idx) {
      const fromLegacy = existingState?.players?.[idx]?.id;
      if (fromLegacy) return fromLegacy;
      const fromSync = existingState?.sync?.game?.scorecard?.players?.[idx]?.id;
      if (fromSync) return fromSync;
      return `player-${idx + 1}`;
    },

    buildPlayers(scoreRows, fixedRows, existingState) {
      return scoreRows.map((row, idx) => {
        const fixedRow = fixedRows[idx];
        const scoreInputs = $$("input.score-input", row);
        const scores = scoreInputs.map(i => i.value || "");
        return {
          id: this.getPlayerId(existingState, idx),
          name: fixedRow ? $(".name-edit", fixedRow).value || "" : "",
          ch: fixedRow ? $(".ch-input", fixedRow).value || "" : "",
          scores
        };
      });
    },

    buildSharedSyncGame(players, existingState) {
      const now = this.getNowTs();
      const createdAt = existingState?.sync?.game?.meta?.createdAt || now;
      const priorRevision = Number(existingState?.sync?.game?.meta?.revision) || 0;

      return {
        meta: {
          schemaVersion: this.SYNC_SCHEMA_VERSION,
          createdAt,
          updatedAt: now,
          updatedBy: 'local-client',
          revision: priorRevision + 1
        },
        scorecard: {
          course: ACTIVE_COURSE,
          handicapMode: document.querySelector('#handicapModeGroup .hcp-mode-btn[data-active="true"]')?.dataset.value || 'rawHandicap',
          strokeIndicatorMode: Config.STROKE_INDICATOR_MODE || 'both',
          players: players.map((p) => ({
            id: p.id,
            name: p.name,
            ch: p.ch,
            scores: Array.isArray(p.scores) ? p.scores : []
          }))
        },
        games: {
          vegas: {
            teams: window.Vegas?.getTeamAssignments() || null,
            opts: window.Vegas?.getOptions() || {}
          },
          banker: {
            mode: (() => {
              const btn = document.querySelector('#bankerHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return (btn?.dataset.value || 'rawHandicap') === 'gross' ? 'gross' : 'net';
            })(),
            netHcpMode: (() => {
              const btn = document.querySelector('#bankerHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return btn?.dataset.value === 'playOffLow' ? 'playOffLow' : 'rawHandicap';
            })(),
            state: (typeof window.Banker?.getState === 'function')
              ? (window.Banker.getState() ?? existingState?.banker?.state ?? null)
              : (existingState?.banker?.state ?? null)
          },
          skins: {
            mode: (() => {
              const btn = document.querySelector('#skinsHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return (btn?.dataset.value || 'gross') === 'gross' ? 'gross' : 'net';
            })(),
            netHcpMode: (() => {
              const btn = document.querySelector('#skinsHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return btn?.dataset.value === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
            })(),
            buyIn: Number(document.getElementById('skinsBuyIn')?.value) || 10,
            carry: document.getElementById('skinsCarry')?.checked ?? true,
            half: document.getElementById('skinsHalf')?.checked ?? false
          },
          junk: {
            mode: (() => {
              const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
              const v = activeBtn?.dataset.value || 'gross';
              return v === 'gross' ? 'gross' : 'net';
            })(),
            useNet: (() => {
              const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return (activeBtn?.dataset.value || 'gross') !== 'gross';
            })(),
            netHcpMode: (() => {
              const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return activeBtn?.dataset.value === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
            })(),
            achievements: (() => {
              if (typeof window.Junk?.getAchievementState === 'function') {
                return window.Junk.getAchievementState();
              }
              return existingState?.junk?.achievements ?? [];
            })(),
            skinsDots: {
              mode: (() => {
                const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
                return activeBtn?.dataset.value || 'gross';
              })(),
              netHcpMode: (() => {
                const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
                return activeBtn?.dataset.value === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
              })(),
              carry: document.getElementById('junkSkinsCarry')?.checked ?? true,
              half: document.getElementById('junkSkinsHalf')?.checked ?? false,
              buyIn: Number(document.getElementById('junkSkinsBuyIn')?.value) || 1
            }
          },
          hilo: {
            unitValue: Number(document.getElementById('hiloUnitValue')?.value) || 10
          },
          wolf: {
            mode: (() => {
              const btn = document.querySelector('#wolfHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return (btn?.dataset.value || 'gross') === 'gross' ? 'gross' : 'net';
            })(),
            netHcpMode: (() => {
              const btn = document.querySelector('#wolfHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return btn?.dataset.value === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
            })(),
            state: (typeof window.Wolf?.getState === 'function')
              ? (window.Wolf.getState() ?? existingState?.wolf?.state ?? null)
              : (existingState?.wolf?.state ?? null)
          }
        }
      };
    },

    buildLocalUiState() {
      return {
        sections: {
          vegas: $(ids.vegasSection)?.classList.contains("open") || false,
          banker: $(ids.bankerSection)?.classList.contains("open") || false,
          skins: $(ids.skinsSection)?.classList.contains("open") || false,
          junk: $(ids.junkSection)?.classList.contains("open") || false,
          hilo: $(ids.hiloSection)?.classList.contains("open") || false,
          wolf: $(ids.wolfSection)?.classList.contains("open") || false
        },
        optionsPanels: (() => {
          const state = {};
          document.querySelectorAll('.game-options-toggle[data-target]').forEach((toggleBtn) => {
            const targetId = toggleBtn.getAttribute('data-target');
            if (!targetId) return;
            const panel = document.getElementById(targetId);
            if (!panel) return;
            state[targetId] = !panel.hidden;
          });
          return state;
        })(),
        primaryTab: getPrimaryTab(),
        activeGame: getActiveGameTab(),
        gamesLauncher: {
          collapsed: !!GAME_LAUNCHER_STATE.collapsed,
          pins: getNormalizedGameLauncherPins(GAME_LAUNCHER_STATE.pins)
        },
        fontSize: Config.FONT_SIZE || 'medium',
        advanceDirection: Config.ADVANCE_DIRECTION || 'down',
        strokeIndicatorMode: Config.STROKE_INDICATOR_MODE || 'both'
      };
    },

    normalizeLoadedState(rawState) {
      // Migration: legacy 'fullHandicap' token was renamed to 'rawHandicap' in v3.
      // Rewrite recursively so cloud snapshots, localStorage dumps, and nested
      // options (e.g. junk.skinsDots.netHcpMode) all get upgraded in place.
      (function migrateNetHcpMode(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(migrateNetHcpMode); return; }
        if (node.netHcpMode === 'fullHandicap') node.netHcpMode = 'rawHandicap';
        for (const key of Object.keys(node)) {
          const v = node[key];
          if (v && typeof v === 'object') migrateNetHcpMode(v);
        }
      })(rawState);

      if (!rawState || !rawState.sync?.game) {
        return rawState;
      }

      const syncGame = rawState.sync.game;
      const scorecard = syncGame.scorecard || {};
      const games = syncGame.games || {};
      const localUi = rawState.localUi || {};

      const normalizedPlayers = Array.isArray(scorecard.players)
        ? scorecard.players.map((p, idx) => ({
            id: p?.id || `player-${idx + 1}`,
            name: p?.name || '',
            ch: p?.ch || '',
            scores: Array.isArray(p?.scores) ? p.scores : []
          }))
        : (rawState.players || []);

      return {
        ...rawState,
        course: scorecard.course || rawState.course,
        handicapMode: scorecard.handicapMode || rawState.handicapMode,
        strokeIndicatorMode: scorecard.strokeIndicatorMode || localUi.strokeIndicatorMode || rawState.strokeIndicatorMode || 'both',
        players: normalizedPlayers,
        advanceDirection: localUi.advanceDirection || rawState.advanceDirection,
        fontSize: localUi.fontSize || rawState.fontSize,
        vegas: {
          ...(rawState.vegas || {}),
          teams: games.vegas?.teams ?? rawState.vegas?.teams,
          opts: games.vegas?.opts ?? rawState.vegas?.opts,
          open: localUi.sections?.vegas ?? rawState.vegas?.open
        },
        banker: {
          ...(rawState.banker || {}),
          mode: games.banker?.mode ?? rawState.banker?.mode ?? 'net',
          netHcpMode: games.banker?.netHcpMode ?? rawState.banker?.netHcpMode ?? 'rawHandicap',
          state: games.banker?.state ?? rawState.banker?.state,
          open: localUi.sections?.banker ?? rawState.banker?.open
        },
        skins: {
          ...(rawState.skins || {}),
          mode: games.skins?.mode ?? rawState.skins?.mode,
          netHcpMode: games.skins?.netHcpMode ?? rawState.skins?.netHcpMode ?? 'playOffLow',
          buyIn: games.skins?.buyIn ?? rawState.skins?.buyIn,
          carry: games.skins?.carry ?? rawState.skins?.carry,
          half: games.skins?.half ?? rawState.skins?.half,
          open: localUi.sections?.skins ?? rawState.skins?.open
        },
        junk: {
          ...(rawState.junk || {}),
          mode: games.junk?.mode
            ?? rawState.junk?.mode
            ?? ((games.junk?.useNet ?? rawState.junk?.useNet) ? 'net' : 'gross'),
          useNet: games.junk?.useNet
            ?? rawState.junk?.useNet
            ?? ((games.junk?.mode ?? rawState.junk?.mode) === 'net'),
          netHcpMode: games.junk?.netHcpMode ?? rawState.junk?.netHcpMode ?? 'playOffLow',
          achievements: games.junk?.achievements ?? rawState.junk?.achievements,
          skinsDots: games.junk?.skinsDots ?? rawState.junk?.skinsDots ?? {
            mode: 'gross',
            netHcpMode: 'playOffLow',
            carry: true,
            half: false,
            buyIn: 1
          },
          open: localUi.sections?.junk ?? rawState.junk?.open
        },
        hilo: {
          ...(rawState.hilo || {}),
          unitValue: games.hilo?.unitValue ?? rawState.hilo?.unitValue,
          open: localUi.sections?.hilo ?? rawState.hilo?.open
        },
        wolf: {
          ...(rawState.wolf || {}),
          mode: games.wolf?.mode ?? rawState.wolf?.mode ?? 'gross',
          netHcpMode: games.wolf?.netHcpMode ?? rawState.wolf?.netHcpMode ?? 'playOffLow',
          state: games.wolf?.state ?? rawState.wolf?.state ?? null,
          open: localUi.sections?.wolf ?? rawState.wolf?.open
        }
      };
    },
    
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
        const fixedRows = $$("#scorecard .player-row");
        
        if (scoreRows.length === 0 || fixedRows.length === 0) {
          console.warn('[Storage] No player rows found, skipping save');
          return false;
        }

        let existingState = null;
        try {
          const existingRaw = localStorage.getItem(this.KEY);
          existingState = existingRaw ? JSON.parse(existingRaw) : null;
        } catch {
          existingState = null;
        }
        
        const players = this.buildPlayers(scoreRows, fixedRows, existingState);
        const syncGame = this.buildSharedSyncGame(players, existingState);
        const localUiState = this.buildLocalUiState();

        const state = {
          version: this.CURRENT_VERSION,
        course: ACTIVE_COURSE,
        advanceDirection: Config.ADVANCE_DIRECTION,
        handicapMode: document.querySelector('#handicapModeGroup .hcp-mode-btn[data-active="true"]')?.dataset.value || 'rawHandicap',
        strokeIndicatorMode: Config.STROKE_INDICATOR_MODE || 'both',
        players: players,
        vegas: { 
          teams: window.Vegas?.getTeamAssignments(), 
          opts: window.Vegas?.getOptions(), 
          open: $(ids.vegasSection).classList.contains("open") 
        },
        banker: { 
          open: $(ids.bankerSection).classList.contains("open"),
          mode: (() => {
            const btn = document.querySelector('#bankerHcpModeGroup .hcp-mode-btn[data-active="true"]');
            return (btn?.dataset.value || 'rawHandicap') === 'gross' ? 'gross' : 'net';
          })(),
          netHcpMode: (() => {
            const btn = document.querySelector('#bankerHcpModeGroup .hcp-mode-btn[data-active="true"]');
            return btn?.dataset.value === 'playOffLow' ? 'playOffLow' : 'rawHandicap';
          })(),
          state: (() => {
            const current = (typeof window.Banker?.getState === 'function') ? window.Banker.getState() : null;
            return current ?? existingState?.banker?.state ?? null;
          })()
        },
        skins: { 
          mode: (() => {
            const btn = document.querySelector('#skinsHcpModeGroup .hcp-mode-btn[data-active="true"]');
            return (btn?.dataset.value || 'gross') === 'gross' ? 'gross' : 'net';
          })(),
          netHcpMode: (() => {
            const btn = document.querySelector('#skinsHcpModeGroup .hcp-mode-btn[data-active="true"]');
            return btn?.dataset.value === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
          })(),
          buyIn: Number(document.getElementById('skinsBuyIn')?.value) || 10,
          carry: document.getElementById('skinsCarry')?.checked ?? true,
          half: document.getElementById('skinsHalf')?.checked ?? false,
          open: $(ids.skinsSection)?.classList.contains("open") 
        },
        junk: {
          mode: (() => {
            const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
            const v = activeBtn?.dataset.value || 'gross';
            return v === 'gross' ? 'gross' : 'net';
          })(),
          useNet: (() => {
            const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
            return (activeBtn?.dataset.value || 'gross') !== 'gross';
          })(),
          netHcpMode: (() => {
            const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
            return activeBtn?.dataset.value === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
          })(),
          open: $(ids.junkSection)?.classList.contains("open"),
          achievements: (() => {
            if (typeof window.Junk?.getAchievementState === 'function') {
              return window.Junk.getAchievementState();
            }
            return existingState?.junk?.achievements ?? [];
          })(),
          skinsDots: {
            mode: (() => {
              const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return activeBtn?.dataset.value || 'gross';
            })(),
            netHcpMode: (() => {
              const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
              return activeBtn?.dataset.value === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
            })(),
            carry: document.getElementById('junkSkinsCarry')?.checked ?? true,
            half: document.getElementById('junkSkinsHalf')?.checked ?? false,
            buyIn: Number(document.getElementById('junkSkinsBuyIn')?.value) || 1
          }
        },
        hilo: {
          unitValue: Number(document.getElementById('hiloUnitValue')?.value) || 10,
          open: $(ids.hiloSection)?.classList.contains("open")
        },
        wolf: {
          open: $(ids.wolfSection)?.classList.contains("open"),
          mode: (() => {
            const btn = document.querySelector('#wolfHcpModeGroup .hcp-mode-btn[data-active="true"]');
            return (btn?.dataset.value || 'gross') === 'gross' ? 'gross' : 'net';
          })(),
          netHcpMode: (() => {
            const btn = document.querySelector('#wolfHcpModeGroup .hcp-mode-btn[data-active="true"]');
            return btn?.dataset.value === 'rawHandicap' ? 'rawHandicap' : 'playOffLow';
          })(),
          state: (() => {
            const current = (typeof window.Wolf?.getState === 'function') ? window.Wolf.getState() : null;
            return current ?? existingState?.wolf?.state ?? null;
          })()
        },
        sync: {
          schemaVersion: this.SYNC_SCHEMA_VERSION,
          game: syncGame
        },
        localUi: localUiState,
        fontSize: Config.FONT_SIZE || 'medium',
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
     * Debounced save - waits for input burst to settle before writing localStorage
     */
    saveDebounced() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), TIMING.SAVE_DEBOUNCE_MS);
    },

    /**
     * Get current canonical sync game state from local storage.
     * Ensures latest local edits are materialized first.
     * @returns {Object|null}
     */
    getSyncGameState() {
      try {
        this.save();
        const raw = localStorage.getItem(this.KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed?.sync?.game || null;
      } catch (error) {
        console.error('[Storage] getSyncGameState failed:', error);
        return null;
      }
    },

    syncPlayerRowCount(targetCount) {
      const clampedTarget = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Number(targetCount) || MIN_PLAYERS));

      let scoreRows = $$("#scorecard .player-row");
      let fixedRows = $$("#scorecard .player-row");

      while (scoreRows.length > clampedTarget && fixedRows.length > clampedTarget) {
        scoreRows[scoreRows.length - 1]?.remove();
        fixedRows[fixedRows.length - 1]?.remove();
        scoreRows = $$("#scorecard .player-row");
        fixedRows = $$("#scorecard .player-row");
      }

      while (scoreRows.length < clampedTarget && PLAYERS < MAX_PLAYERS) {
        addPlayer();
        scoreRows = $$("#scorecard .player-row");
        fixedRows = $$("#scorecard .player-row");
      }

      PLAYERS = scoreRows.length;

      scoreRows.forEach((row, idx) => {
        row.dataset.player = String(idx);
        const scoreInputs = $$("input.score-input", row);
        scoreInputs.forEach((input) => {
          input.dataset.player = String(idx);
        });
      });

      fixedRows.forEach((row, idx) => {
        row.dataset.player = String(idx);
        const nameInput = $(".name-edit", row);
        if (nameInput && !String(nameInput.value || '').trim()) {
          nameInput.placeholder = `Player ${idx + 1}`;
        }
      });

      Scorecard.player.updateCountDisplay();
      Scorecard.player.syncOverlay();
    },

    prepareForIncomingSyncState(targetPlayerCount = MIN_PLAYERS, options = {}) {
      const { resetSharedGames = true } = options || {};
      this.syncPlayerRowCount(targetPlayerCount);

      const fixedRows = $$("#scorecard .player-row");
      fixedRows.forEach((row, idx) => {
        const nameInput = $(".name-edit", row);
        const chInput = $(".ch-input", row);
        if (nameInput) {
          nameInput.value = '';
          nameInput.placeholder = `Player ${idx + 1}`;
        }
        if (chInput) {
          setHandicapInputValue(chInput, '0');
        }
      });

      const scoreRows = $$("#scorecard .player-row");
      scoreRows.forEach((row) => {
        $$("input.score-input", row).forEach((input) => {
          input.value = '';
          input.classList.remove('invalid');
          input.classList.remove('receives-stroke');
          input.removeAttribute('data-strokes');
          input.removeAttribute('title');
        });
      });

      if (resetSharedGames) {
        setSkinsModeBtn('skinsHcpModeGross');
        const skinsBuyIn = document.getElementById('skinsBuyIn');
        const skinsCarry = document.getElementById('skinsCarry');
        const skinsHalf = document.getElementById('skinsHalf');
        if (skinsBuyIn) skinsBuyIn.value = '10';
        if (skinsCarry) skinsCarry.checked = true;
        if (skinsHalf) { skinsHalf.checked = false; }

        setJunkModeBtnState('junkHcpModeGross');
        document.querySelectorAll('#junkTable input.junk-ach').forEach((checkbox) => {
          checkbox.checked = false;
        });

        const hiloUnitValue = document.getElementById('hiloUnitValue');
        if (hiloUnitValue) hiloUnitValue.value = '10';

        window.Vegas?.setTeamAssignments?.({ A: [], B: [] });
        window.Vegas?.setOptions?.({
          useNet: false,
          netHcpMode: 'playOffLow',
          doubleBirdie: false,
          tripleEagle: false,
          pointValue: 0
        });
        window.Banker?.setState?.({ holes: [] });
      }

      Scorecard.calc.recalcAll(true);
      Scorecard.player.syncOverlay();
      recalculateEverything();
    },

    /**
     * Apply a canonical sync game state from cloud into local storage + UI.
     * Keeps local UI preferences while replacing shared game data.
     * @param {Object} syncGame
     * @param {string} source - optional source marker for logging
     * @returns {boolean}
     */
    applySyncGameState(syncGame, source = 'remote') {
      try {
        if (!syncGame || typeof syncGame !== 'object') return false;

        const getComparableSyncHash = (game) => {
          try {
            return JSON.stringify({
              scorecard: game?.scorecard || {},
              games: game?.games || {}
            });
          } catch {
            return '';
          }
        };

        let existing = {};
        try {
          const raw = localStorage.getItem(this.KEY);
          existing = raw ? JSON.parse(raw) : {};
        } catch {
          existing = {};
        }

        if (source === 'remote') {
          const currentHash = getComparableSyncHash(existing?.sync?.game);
          const incomingHash = getComparableSyncHash(syncGame);
          if (currentHash && incomingHash && currentHash === incomingHash) {
            return true;
          }
        }

        const merged = {
          ...existing,
          version: this.CURRENT_VERSION,
          sync: {
            schemaVersion: this.SYNC_SCHEMA_VERSION,
            game: syncGame
          },
          savedAt: Date.now()
        };

        const normalized = this.normalizeLoadedState(merged);
        localStorage.setItem(this.KEY, JSON.stringify(normalized));
        this.load({
          applyLocalUi: false,
          announceRestore: false,
          resetBeforeApply: false,
          source
        });
        return true;
      } catch (error) {
        console.error('[Storage] applySyncGameState failed:', error);
        return false;
      }
    },
    
    /**
     * Load saved game state from localStorage
     * @returns {boolean} Success status
     */
    load(options = {}) {
      this._isLoading = true;

      const {
        applyLocalUi = true,
        announceRestore = true,
        resetBeforeApply = true,
        source = 'local'
      } = options || {};
      
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
        const s = this.normalizeLoadedState(JSON.parse(raw));

        const targetPlayers = Array.isArray(s.players) ? s.players.length : MIN_PLAYERS;
        if (resetBeforeApply) {
          this.prepareForIncomingSyncState(targetPlayers);
        } else {
          this.syncPlayerRowCount(targetPlayers);
        }
        
        // Restore course selection
        if(s.course && COURSES[s.course]){
          const courseSearch = $('#courseSearch');
          if(courseSearch) {
            courseSearch.value = COURSES[s.course].name;
            courseSearch.dataset.selectedCourseId = s.course;
          }
          if(s.course !== ACTIVE_COURSE){
            Scorecard.course.switch(s.course);
          }
        }
        
        // Restore advance direction
        if(applyLocalUi && s.advanceDirection) {
          Config.ADVANCE_DIRECTION = s.advanceDirection;
          const label = document.getElementById('advanceLabel');
          if(label) {
            if (Config.ADVANCE_DIRECTION === 'down') {
              label.textContent = 'Advance: ↓ Down';
            } else if (Config.ADVANCE_DIRECTION === 'right') {
              label.textContent = 'Advance: → Right';
            } else if (Config.ADVANCE_DIRECTION === 'disabled') {
              label.textContent = 'Advance: ✕ Disabled';
            }
          }
        }
        
        // Restore handicap mode
        if(s.handicapMode) {
          const modeId = 'handicapMode' + s.handicapMode.charAt(0).toUpperCase() + s.handicapMode.slice(1);
          setHandicapModeButtonState(modeId);
        }

        // Restore stroke indicator mode
        {
          const mode = ['highlight', 'symbols', 'both'].includes(s.strokeIndicatorMode)
            ? s.strokeIndicatorMode
            : 'both';
          const modeId = 'strokeIndicator' + mode.charAt(0).toUpperCase() + mode.slice(1);
          setStrokeIndicatorModeButtonState(modeId);
        }

        // Restore font size
        if (applyLocalUi && s.fontSize && s.fontSize !== Config.FONT_SIZE) {
          applyFontSize(s.fontSize);
        }
        
        // CRITICAL: Explicitly query each table to avoid ambiguity
        const scoreRows = $$("#scorecard .player-row");  // Scrollable table with scores
        const fixedRows = $$("#scorecard .player-row");  // Fixed table with names/CH
        
        s.players?.forEach((p, i) => { 
          const r = scoreRows[i]; 
          const fixedR = fixedRows[i];
          if(!r || !fixedR) return;
          
          $(".name-edit", fixedR).value = p.name || "";
          setHandicapInputValue($(".ch-input", fixedR), (p.ch !== undefined && p.ch !== null && p.ch !== "") ? p.ch : "0");
          
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
        
        // Restore Banker state
        if(s.banker?.state && typeof window.Banker?.setState === 'function') {
          window.Banker.setState(s.banker.state);

          // Belt-and-suspenders: if Banker was already initialized when setState
          // ran it applied directly to the DOM, but scores may not have been
          // written to the DOM yet (they go through a setTimeout(0) for
          // highlighting).  Re-apply after a short delay so compute() sees
          // the final score values.
          const bankerStateSnapshot = s.banker.state;
          setTimeout(() => {
            if (window.Banker?._initialized && bankerStateSnapshot) {
              window.Banker.setState(bankerStateSnapshot);
            }
          }, 160);
        };
        
        // Restore Banker button state (mode and netHcpMode)
        if (s.banker?.mode != null) {
          const bMode = s.banker.mode;
          const bHcpMode = s.banker?.netHcpMode || 'rawHandicap';
          const bankerBtnId = bMode !== 'net' ? 'bankerHcpModeGross'
            : bHcpMode === 'rawHandicap' ? 'bankerHcpModeRawHandicap'
            : 'bankerHcpModePlayOffLow';
          setBankerModeBtn(bankerBtnId);
        }

        // Restore Skins options
        if (s.skins?.mode != null) {
          const sMode = s.skins.mode;
          const sHcpMode = s.skins?.netHcpMode || 'playOffLow';
          const skinsBtnId = sMode !== 'net' ? 'skinsHcpModeGross'
            : sHcpMode === 'rawHandicap' ? 'skinsHcpModeRawHandicap'
            : 'skinsHcpModePlayOffLow';
          setSkinsModeBtn(skinsBtnId);
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
        const junkMode = s.junk?.mode || (s.junk?.useNet ? 'net' : 'gross');
        const junkNetHcpMode = s.junk?.netHcpMode || 'playOffLow';
        const junkBtnId = junkMode !== 'net' ? 'junkHcpModeGross'
          : junkNetHcpMode === 'rawHandicap' ? 'junkHcpModeRawHandicap'
          : 'junkHcpModePlayOffLow';
        setJunkModeBtnState(junkBtnId);
        const junkSkinsCarryEl = document.getElementById('junkSkinsCarry');
        if (junkSkinsCarryEl) junkSkinsCarryEl.checked = s.junk?.skinsDots?.carry ?? true;
        const junkSkinsHalfEl = document.getElementById('junkSkinsHalf');
        if (junkSkinsHalfEl) junkSkinsHalfEl.checked = s.junk?.skinsDots?.half ?? false;
        const junkSkinsBuyInEl = document.getElementById('junkSkinsBuyIn');
        if (junkSkinsBuyInEl) junkSkinsBuyInEl.value = String(s.junk?.skinsDots?.buyIn ?? 1);
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

        // Restore Wolf options
        if (s.wolf?.mode != null) {
          const wMode = s.wolf.mode;
          const wHcpMode = s.wolf?.netHcpMode || 'playOffLow';
          const wolfBtnId = wMode !== 'net' ? 'wolfHcpModeGross'
            : wHcpMode === 'rawHandicap' ? 'wolfHcpModeRawHandicap'
            : 'wolfHcpModePlayOffLow';
          setWolfModeBtn(wolfBtnId);
        }
        if (s.wolf?.state && typeof window.Wolf?.setState === 'function') {
          const wolfStateSnapshot = s.wolf.state;
          setTimeout(() => {
            window.Wolf?.setState?.(wolfStateSnapshot);
          }, 160);
        }

        if (applyLocalUi) {
          applyLoadedGamesLauncherUi(s.localUi);

          const savedOpenGame = GAME_TAB_ORDER.find((gameKey) => !!s[gameKey]?.open) || null;
          const preferredGame = GAME_TAB_ORDER.includes(s.localUi?.activeGame)
            ? s.localUi.activeGame
            : savedOpenGame;
          const preferredPrimaryTab = 'score';

          GAME_TAB_ORDER.forEach((gameKey) => games_close(gameKey));
          syncGameTabUi(null);

          if (preferredGame) {
            setGameTab(preferredGame, { save: false, activatePrimary: false });
          } else if (preferredPrimaryTab === 'games') {
            setGameTab(DEFAULT_GAME_TAB, { save: false, activatePrimary: false });
          }

          syncPrimaryTabUi(preferredPrimaryTab);
          syncGamesLauncherUi(getActiveGameTab());

          // Always start game option panels collapsed on reload, including
          // live-results popouts, regardless of last saved UI state.
          document.querySelectorAll('.game-options-toggle[data-target]').forEach((toggleBtn) => {
            const targetId = toggleBtn.getAttribute('data-target');
            if (!targetId) return;
            const panel = document.getElementById(targetId);
            if (!panel) return;
            panel.hidden = true;
            toggleBtn.classList.remove('is-open');
            toggleBtn.setAttribute('aria-expanded', 'false');
          });
        }

        // Recalculate all games with restored data
        AppManager.recalcGames();

        // Run once more on the next frame so row summaries (Out/In/Total/To Par/Net)
        // are populated after any restore-time DOM churn from game/UI modules.
        requestAnimationFrame(() => Scorecard.calc.recalcAll(true));

        // Sync row heights after data is restored (names/scores change cell sizes)
        requestAnimationFrame(() => Scorecard.build.syncRowHeights(true));
        
        if (announceRestore) {
          const savedDate = new Date(s.savedAt || Date.now()).toLocaleString();
          const prefix = source === 'remote' ? 'Synced live card' : 'Restored saved card';
          Utils.announce(`${prefix} (${savedDate}).`);
        }
      } catch(err) {
        console.error('[Storage] Load failed:', err);
        this._isLoading = false;
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
      // Clear names and handicaps from fixed table
      const fixedRows = $$("#scorecard .player-row");
      fixedRows.forEach(r => {
        const nameInput = $(".name-edit", r);
        const chInput = $(".ch-input", r);
        if (nameInput) nameInput.value = "";
        if (chInput) setHandicapInputValue(chInput, "0");
      });
      
      // Clear scores from scrollable table
      const scoreRows = $$("#scorecard .player-row");
      scoreRows.forEach(r => {
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
      
      // Update stroke highlights after clearing.
      Scorecard.calc.applyStrokeHighlighting();
      
      Utils.announce("All fields cleared.");
    },

    clearGameData(gameKey = 'all', announceResult = true) {
      const key = String(gameKey || 'all').toLowerCase();

      const resetVegas = () => {
        window.Vegas?.setTeamAssignments?.({ A: [], B: [] });
        window.Vegas?.setOptions?.({
          useNet: false,
          netHcpMode: 'playOffLow',
          doubleBirdie: false,
          tripleEagle: false,
          pointValue: 0
        });
        window.Vegas?.renderTeamControls?.();
      };

      const resetBanker = () => {
        setBankerModeBtn('bankerHcpModeRawHandicap');
        window.Banker?.setState?.({ holes: [] });
        try {
          localStorage.removeItem(BANKER_SHEET_PREFS_KEY);
          localStorage.removeItem(BANKER_PRESELECT_META_KEY);
        } catch (error) {
          console.warn('[Storage] Failed to clear Banker metadata:', error);
        }
      };

      const resetSkins = () => {
        setSkinsModeBtn('skinsHcpModeGross');
        const skinsBuyIn = document.getElementById('skinsBuyIn');
        const skinsCarry = document.getElementById('skinsCarry');
        const skinsHalf = document.getElementById('skinsHalf');
        if (skinsBuyIn) skinsBuyIn.value = '10';
        if (skinsCarry) skinsCarry.checked = true;
        if (skinsHalf) { skinsHalf.checked = false; }
      };

      const resetJunk = () => {
        setJunkModeBtnState('junkHcpModeGross');
        const junkSkinsCarry = document.getElementById('junkSkinsCarry');
        const junkSkinsHalf = document.getElementById('junkSkinsHalf');
        const junkSkinsBuyIn = document.getElementById('junkSkinsBuyIn');
        if (junkSkinsCarry) junkSkinsCarry.checked = true;
        if (junkSkinsHalf) junkSkinsHalf.checked = false;
        if (junkSkinsBuyIn) junkSkinsBuyIn.value = '1';
        window.Junk?.clearAllAchievements?.();
      };

      const resetHilo = () => {
        const hiloUnitValue = document.getElementById('hiloUnitValue');
        if (hiloUnitValue) hiloUnitValue.value = '10';
        window.HiLo?.update?.();
      };

      const resetWolf = () => {
        setWolfModeBtn('wolfHcpModeGross');
        window.Wolf?.clearState?.();
      };

      if (key === 'all' || key === 'vegas') resetVegas();
      if (key === 'all' || key === 'banker') resetBanker();
      if (key === 'all' || key === 'skins') resetSkins();
      if (key === 'all' || key === 'junk') resetJunk();
      if (key === 'all' || key === 'hilo') resetHilo();
      if (key === 'all' || key === 'wolf') resetWolf();

      AppManager.recalcGames();
      this.save();

      if (announceResult) {
        const label = key === 'all' ? 'All game data cleared.' : `${key.toUpperCase()} data cleared.`;
        Utils.announce(label);
      }
    },

    clearGamesData() {
      this.clearGameData('all', false);
      Utils.announce('All game data cleared.');
    },

    /**
     * Clear all scorecard + game data and reset game options to defaults.
     */
    clearEverything() {
      this.clearAll();

      // Reset primary scorecard options
      setHandicapModeButtonState('handicapModeRawHandicap');
      setStrokeIndicatorModeButtonState('strokeIndicatorBoth');

      Config.ADVANCE_DIRECTION = 'down';
      const advanceLabel = document.getElementById('advanceLabel');
      if (advanceLabel) advanceLabel.textContent = 'Advance: ↓ Down';

      // Reset game options to defaults
      this.clearGameData('all', false);

      GAME_TAB_ORDER.forEach((gameKey) => games_close(gameKey));
      syncGameTabUi(null);
      syncPrimaryTabUi('score');

      Scorecard.calc.recalcAll();
      this.save();
      Utils.announce('All scorecard and game data cleared.');
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

  /**
   * Apply app font size mode and keep utility buttons in sync.
   * @param {'small'|'medium'|'large'} size
   */
  function applyFontSize(size = 'medium') {
    const validSizes = ['small', 'medium', 'large'];
    const resolvedSize = validSizes.includes(size) ? size : 'medium';

    Config.FONT_SIZE = resolvedSize;
    document.documentElement.setAttribute('data-font-size', resolvedSize);

    const buttons = {
      small: document.getElementById('fontSizeSmall'),
      medium: document.getElementById('fontSizeMedium'),
      large: document.getElementById('fontSizeLarge')
    };

    validSizes.forEach((key) => {
      const btn = buttons[key];
      if (!btn) return;
      const active = key === resolvedSize;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Banker bet rows use computed inline layout widths; rebuild after font changes
    try {
      if (window.Banker?.updateBetInputs) {
        window.Banker.updateBetInputs();
      }
      if (window.Banker?.update) {
        window.Banker.update();
      }
    } catch (error) {
      console.warn('[FontSize] banker refresh failed:', error);
    }

    // Font size changes alter row heights; re-sync fixed/scroll tables
    requestAnimationFrame(() => {
      try {
        Scorecard.build.syncRowHeights(true);
      } catch (error) {
        console.warn('[FontSize] syncRowHeights failed:', error);
      }
    });

    // Second pass after layout settles (mobile browsers can lag one frame)
    setTimeout(() => {
      try {
        if (window.Banker?.updateBetInputs) {
          window.Banker.updateBetInputs();
        }
        if (window.Banker?.update) {
          window.Banker.update();
        }
        Scorecard.build.syncRowHeights(true);
      } catch (error) {
        console.warn('[FontSize] delayed syncRowHeights failed:', error);
      }
    }, 120);
  }

  /**
   * Set active button in the Junk scoring mode button group.
   * @param {string} activeId - Target button id
   */
  function setJunkModeBtnState(activeId) {
    const buttons = document.querySelectorAll('#junkHcpModeGroup .hcp-mode-btn');
    if (!buttons.length) return;
    let matched = false;
    buttons.forEach((btn) => {
      const isActive = btn.id === activeId;
      if (isActive) matched = true;
      btn.dataset.active = isActive ? 'true' : 'false';
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    if (!matched) {
      const fallback = document.getElementById('junkHcpModeGross');
      if (fallback) { fallback.dataset.active = 'true'; fallback.setAttribute('aria-checked', 'true'); }
    }

    const activeBtn = document.querySelector('#junkHcpModeGroup .hcp-mode-btn[data-active="true"]');
    const isNet = (activeBtn?.dataset.value || 'gross') !== 'gross';
    const halfEl = document.getElementById('junkSkinsHalf');
    if (halfEl) {
      halfEl.disabled = !isNet;
      if (!isNet) halfEl.checked = false;
    }
  }

  /**
   * Set active button in the Skins scoring mode button group.
   * @param {string} activeId - Target button id
   */
  function setSkinsModeBtn(activeId) {
    const buttons = document.querySelectorAll('#skinsHcpModeGroup .hcp-mode-btn');
    if (!buttons.length) return;
    let matched = false;
    buttons.forEach((btn) => {
      const isActive = btn.id === activeId;
      if (isActive) matched = true;
      btn.dataset.active = isActive ? 'true' : 'false';
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    if (!matched) {
      const fallback = document.getElementById('skinsHcpModeGross');
      if (fallback) { fallback.dataset.active = 'true'; fallback.setAttribute('aria-checked', 'true'); }
    }
    // Sync half-pop disabled state
    const activeBtn = document.querySelector('#skinsHcpModeGroup .hcp-mode-btn[data-active="true"]');
    const isNet = (activeBtn?.dataset.value || 'gross') !== 'gross';
    const halfEl = document.getElementById('skinsHalf');
    if (halfEl) halfEl.disabled = !isNet;
  }

  /**
   * Set active button in the Vegas scoring mode button group.
   * @param {string} activeId - Target button id
   */
  function setVegasHcpModeBtnState(activeId) {
    const buttons = document.querySelectorAll('#vegasHcpModeGroup .hcp-mode-btn');
    if (!buttons.length) return;
    let matched = false;
    buttons.forEach((btn) => {
      const isActive = btn.id === activeId;
      if (isActive) matched = true;
      btn.dataset.active = isActive ? 'true' : 'false';
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    if (!matched) {
      const fallback = document.getElementById('vegasHcpModeGross');
      if (fallback) { fallback.dataset.active = 'true'; fallback.setAttribute('aria-checked', 'true'); }
    }
  }

  /**
   * Set active button in the Banker scoring mode button group.
   * @param {string} activeId - Target button id
   */
  function setBankerModeBtn(activeId) {
    const buttons = document.querySelectorAll('#bankerHcpModeGroup .hcp-mode-btn');
    if (!buttons.length) return;
    let matched = false;
    buttons.forEach((btn) => {
      const isActive = btn.id === activeId;
      if (isActive) matched = true;
      btn.dataset.active = isActive ? 'true' : 'false';
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    if (!matched) {
      const fallback = document.getElementById('bankerHcpModeRawHandicap');
      if (fallback) { fallback.dataset.active = 'true'; fallback.setAttribute('aria-checked', 'true'); }
    }
  }

  /**
   * Set active button in the Wolf scoring mode button group.
   * @param {string} activeId - Target button id
   */
  function setWolfModeBtn(activeId) {
    const buttons = document.querySelectorAll('#wolfHcpModeGroup .hcp-mode-btn');
    if (!buttons.length) return;
    let matched = false;
    buttons.forEach((btn) => {
      const isActive = btn.id === activeId;
      if (isActive) matched = true;
      btn.dataset.active = isActive ? 'true' : 'false';
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    if (!matched) {
      const fallback = document.getElementById('wolfHcpModeGross');
      if (fallback) { fallback.dataset.active = 'true'; fallback.setAttribute('aria-checked', 'true'); }
    }
  }

  /**
   * Set active handicap mode button in the scorecard control group.
   * @param {string} activeId - Target button id
   */
  function setHandicapModeButtonState(activeId) {
    const buttons = document.querySelectorAll('#handicapModeGroup .hcp-mode-btn');
    if (!buttons.length) return;

    let matched = false;
    buttons.forEach((btn) => {
      const isActive = btn.id === activeId;
      if (isActive) matched = true;
      btn.dataset.active = isActive ? 'true' : 'false';
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });

    if (!matched) {
      const fallbackBtn = document.getElementById('handicapModeRawHandicap');
      if (fallbackBtn) {
        fallbackBtn.dataset.active = 'true';
        fallbackBtn.setAttribute('aria-checked', 'true');
      }
    }
  }

  /**
   * Set active stroke indicator mode button in the scorecard control group.
   * @param {string} activeId - Target button id
   */
  function setStrokeIndicatorModeButtonState(activeId) {
    const buttons = document.querySelectorAll('#strokeIndicatorModeGroup .hcp-mode-btn');
    if (!buttons.length) return;

    let matched = false;
    buttons.forEach((btn) => {
      const isActive = btn.id === activeId;
      if (isActive) matched = true;
      btn.dataset.active = isActive ? 'true' : 'false';
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });

    if (!matched) {
      const fallback = document.getElementById('strokeIndicatorBoth');
      if (fallback) {
        fallback.dataset.active = 'true';
        fallback.setAttribute('aria-checked', 'true');
      }
    }

    const activeBtn = document.querySelector('#strokeIndicatorModeGroup .hcp-mode-btn[data-active="true"]');
    const activeValue = activeBtn?.dataset?.value;
    Config.STROKE_INDICATOR_MODE = ['highlight', 'symbols', 'both'].includes(activeValue)
      ? activeValue
      : 'both';
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
      const config = getGameConfig(which);
      if (!config) {
        console.error(`[Games] Unknown game: ${which}`);
        return;
      }

      const section = resolveTargetElement(config.section);
      const toggleBtn = resolveTargetElement(config.toggle);
      
      if (!section) {
        ErrorHandler.show(`Cannot open ${which} game`, 'Game section not found in DOM');
        return;
      }
      
      section.classList.add('open');
      section.setAttribute('aria-hidden', 'false');
      if (toggleBtn) toggleBtn.classList.add('active');
      
      ensureGameInitialized(which);
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
      const config = getGameConfig(which);
      if (!config) return;

      const section = resolveTargetElement(config.section);
      const toggleBtn = resolveTargetElement(config.toggle);
      
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
    setGameTab(which);
  }

  // Theme toggle
(function(){
  const btn = document.getElementById('themeToggle');
  if(!btn) return;

  // Footer theme button is icon-only; aria-label/title carry the action text.
  const updateButtonText = (isLight) => {
    btn.textContent = isLight ? '🌙' : '☀️';
    btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
    btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  };

  // Restore persisted theme, or detect device preference
  const saved = localStorage.getItem('theme');
  if(saved === 'light'){
    document.documentElement.setAttribute('data-theme','light');
    updateButtonText(true);
  } else if(!saved) {
    // No saved preference — check device preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    if(prefersLight){
      document.documentElement.setAttribute('data-theme','light');
      updateButtonText(true);
    } else if(prefersDark){
      document.documentElement.removeAttribute('data-theme');
      updateButtonText(false);
    }
    // If neither matches (rare), default to dark (current behavior)
  }

  btn.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if(isLight){
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('theme');
      updateButtonText(false);
    }else{
      document.documentElement.setAttribute('data-theme','light');
      localStorage.setItem('theme','light');
      updateButtonText(true);
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

// Debug tools toggle (eruda) from Utilities menu
(function(){
  let btn = document.getElementById('toggleDebugToolsBtn');
  if(!btn) {
    const actionsRow = document.querySelector('#utilitiesSection .utilities-row-actions');
    if (actionsRow) {
      btn = document.createElement('button');
      btn.id = 'toggleDebugToolsBtn';
      btn.className = 'btn';
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = '🧪 Debug Tools: Off';
      actionsRow.appendChild(btn);
    }
  }
  if(!btn) return;

  const isEnabled = () => !window.__debugLayoutDisabled &&
    localStorage.getItem('debug') !== '0' &&
    (/[?&]debug=1\b/.test(window.location.search) || localStorage.getItem('debug') === '1');

  const emitDebugModeChanged = (enabled) => {
    document.dispatchEvent(new CustomEvent('golf:debug-mode-changed', {
      detail: { enabled: !!enabled }
    }));
  };

  const syncState = () => {
    const enabled = isEnabled();
    btn.textContent = enabled ? '🧪 Debug Tools: On' : '🧪 Debug Tools: Off';
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.title = enabled ? 'Disable debug tools' : 'Enable debug tools';
  };

  const removeDebugOutlines = () => {
    const st = document.getElementById('golfDebugOutlines');
    if (st) st.remove();
  };

  syncState();

  btn.addEventListener('click', async () => {
    const enable = !isEnabled();
    if (enable) {
      window.__debugLayoutDisabled = false;
      localStorage.removeItem('debug'); // clear explicit-off sentinel first
      localStorage.setItem('debug', '1');
      syncState();
      emitDebugModeChanged(true);
      try {
        if (typeof window.loadGolfDebugTools === 'function') {
          await window.loadGolfDebugTools();
        }
      } catch (e) {
        console.error('[debug] Failed to load debug tools:', e);
      }
      return;
    }

    window.__debugLayoutDisabled = true;
    localStorage.setItem('debug', '0'); // explicit-off sentinel, survives URL param
    syncState();
    emitDebugModeChanged(false);
    removeDebugOutlines();
    hideLayoutDebugReadouts();
    try {
      if (window.eruda && typeof window.eruda.destroy === 'function') {
        window.eruda.destroy();
      }
    } catch (_) {}
    window.eruda = undefined;
    window.__golfDebugToolsPromise = undefined;
  });
})();

// Utilities section toggle
(function(){
  const section = document.getElementById('utilitiesSection');
  const toggleBtn = document.getElementById('utilitiesToggle');
  
  if(!section || !toggleBtn) return;

  const LABEL_CLOSED = '⚙️ Utilities';
  const LABEL_OPEN = '⚙️ Utilities';

  const syncUtilitiesToggleState = () => {
    const isOpen = section.classList.contains('open');
    section.hidden = !isOpen;
    toggleBtn.classList.toggle('is-open', isOpen);
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggleBtn.textContent = isOpen ? LABEL_OPEN : LABEL_CLOSED;
  };

  syncUtilitiesToggleState();
  
  toggleBtn.addEventListener('click', () => {
    section.classList.toggle('open');
    syncUtilitiesToggleState();
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

    // Separate player data from Banker data
    // Banker data appears after a blank line and comment: "# Banker Game Data"
    const playerRows = [];
    const bankerRows = [];
    let inBankerSection = false;
    
    data.slice(1).forEach(r => {
      // Check if we're entering the Banker section
      const firstCell = String(r[0] || '').trim();
      
      // Skip blank rows and comment rows
      if (!firstCell || firstCell.startsWith('#')) {
        if (firstCell.toLowerCase().includes('banker')) {
          inBankerSection = true;
        }
        return;
      }
      
      // Check if this is the Banker header row
      if (firstCell.toLowerCase() === 'hole' && r[1] && String(r[1]).toLowerCase().includes('banker')) {
        inBankerSection = true;
        return;
      }
      
      // If we're in the Banker section and this row has a numeric hole number
      if (inBankerSection && /^\d+$/.test(firstCell)) {
        bankerRows.push(r);
      } else if (r.some(x => x && x !== "")) {
        // Regular player row
        playerRows.push(r);
      }
    });
    
    const rows = playerRows.slice(0, 99);
    if (!rows.length) { alert("No data rows found under the header."); return; }
    
    // Debug: Log what we found
    console.log(`[CSV Import] Found ${playerRows.length} player rows and ${bankerRows.length} banker rows`);

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
    const fixedTable = document.querySelector("#scorecard");
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
          if (chInput) setHandicapInputValue(chInput, (obj.ch === 0 || Number.isFinite(obj.ch)) ? String(obj.ch) : "");
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
          if (chInput) setHandicapInputValue(chInput, "");
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
          if (chInput) setHandicapInputValue(chInput, (obj.ch === 0 || Number.isFinite(obj.ch)) ? String(obj.ch) : "");
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
    
    // Update stroke highlights with new handicaps.
    Scorecard.calc.applyStrokeHighlighting();
    
    // Import Banker data if present
    if (bankerRows.length > 0 && window.Banker && typeof window.Banker.setState === 'function') {
      try {
        const bankerState = { holes: [] };
        
        // Initialize all 18 holes with default values
        for (let h = 0; h < 18; h++) {
          bankerState.holes.push({
            banker: -1,
            maxBet: 10,
            bankerDouble: false,
            bets: []
          });
        }
        
        // Get player names for matching
        const fixedPlayerRows = fixedTable?.querySelectorAll('.player-row');
        const playerNames = Array.from(fixedPlayerRows || []).map(row => {
          const nameInput = row.querySelector('.name-edit');
          return (nameInput?.value || '').trim().toLowerCase();
        });
        
        // Helper to find player index by name
        const findPlayerIndex = (name) => {
          const searchName = name.trim().toLowerCase();
          // Try exact match first
          let idx = playerNames.indexOf(searchName);
          if (idx >= 0) return idx;
          
          // Try matching "PlayerN" format
          const match = searchName.match(/^player(\d+)$/);
          if (match) {
            const num = Number(match[1]) - 1;
            if (num >= 0 && num < playerNames.length) return num;
          }
          
          // Try as number (for backward compatibility with old format)
          const asNum = Number(name);
          if (Number.isFinite(asNum) && asNum >= 0 && asNum < playerNames.length) {
            return asNum;
          }
          
          return -1;
        };
        
        // Parse Banker rows and populate state
        // New format: Hole,BankerPlayer,MaxBet,BankerDoubled,PlayerBets
        // PlayerBets format: PlayerName:$Amount:Yes/No|...
        bankerRows.forEach(row => {
          const hole = Number(row[0]) - 1; // Convert to 0-based index
          if (hole >= 0 && hole < 18) {
            // Parse banker (can be name or index for backward compatibility)
            const bankerValue = row[1] || '';
            bankerState.holes[hole].banker = findPlayerIndex(bankerValue);
            
            // Parse max bet (remove $ if present)
            const maxBetStr = String(row[2] || '10').replace(/[^0-9.]/g, '');
            bankerState.holes[hole].maxBet = Number(maxBetStr) || 10;
            
            // Parse banker double (Yes/No or 1/0 for backward compatibility)
            const bankerDoubleStr = String(row[3] || 'No').toLowerCase();
            bankerState.holes[hole].bankerDouble = bankerDoubleStr === 'yes' || bankerDoubleStr === '1' || bankerDoubleStr === 'true';
            
            // Parse player bets
            // New format: PlayerName:$Amount:Yes/No
            // Old format: playerIndex:amount:1/0 (for backward compatibility)
            if (row[4]) {
              const betStrings = row[4].split('|');
              betStrings.forEach(betStr => {
                const parts = betStr.split(':');
                if (parts.length >= 3) {
                  const playerValue = parts[0];
                  const amountStr = parts[1].replace(/[^0-9.]/g, '');
                  const doubledStr = parts[2].toLowerCase();
                  
                  const playerIdx = findPlayerIndex(playerValue);
                  if (playerIdx >= 0) {
                    bankerState.holes[hole].bets.push({
                      player: playerIdx,
                      amount: Number(amountStr) || 0,
                      doubled: doubledStr === 'yes' || doubledStr === '1' || doubledStr === 'true'
                    });
                  }
                }
              });
            }
          }
        });
        
        // Ensure Banker section is initialized
        if (typeof window.Banker.init === 'function') {
          window.Banker.init();
        }
        
        // Set the state after a short delay to ensure DOM is ready
        setTimeout(() => {
          window.Banker.setState(bankerState);
          console.log('[CSV Import] Banker data restored:', bankerState);
        }, 200);
      } catch (error) {
        console.error('[CSV Import] Failed to restore Banker data:', error);
      }
    }
    
    // Force recalculate all games
    window.Vegas?.renderTeamControls();
    setTimeout(() => {
      AppManager.recalcGames();
      window.Skins?.refreshForPlayerChange();
      window.Junk?.refreshForPlayerChange();
      window.HiLo?.update();
      window.Banker?.refreshForPlayerChange();
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

  // =============================================================================
  // PLAYER MANAGEMENT (ADD/REMOVE)
  // =============================================================================

  function isPlayerEntryModalViewport() {
    try {
      return !!window.matchMedia?.(PLAYER_ENTRY_MODAL_QUERY)?.matches;
    } catch {
      return false;
    }
  }

  function getPlayerIdentityControls(playerIdx) {
    const row = document.querySelector(`#scorecard .player-row[data-player="${playerIdx}"]`);
    if (!row) return { row: null, nameInput: null, chInput: null };
    return {
      row,
      nameInput: row.querySelector('.name-edit'),
      chInput: row.querySelector('.ch-input')
    };
  }

  function setModalHandicapValue(chInput, actualValue) {
    if (!chInput) return;
    const safeActual = clampInt(actualValue, LIMITS.MIN_HANDICAP, LIMITS.MAX_HANDICAP);
    chInput.dataset.actualValue = String(safeActual);
    // Keep zero as a placeholder so it is visible but visually de-emphasized.
    chInput.value = safeActual === 0 ? '' : formatDisplayedHandicap(safeActual);
  }

  function applyPlayerNameFromModal(playerIdx, nextName) {
    const { nameInput } = getPlayerIdentityControls(playerIdx);
    if (!nameInput) return;
    nameInput.value = String(nextName ?? '');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyPlayerHandicapFromModal(playerIdx, actualValue) {
    const { chInput } = getPlayerIdentityControls(playerIdx);
    if (!chInput) return;
    const safeActual = clampInt(actualValue, LIMITS.MIN_HANDICAP, LIMITS.MAX_HANDICAP);
    setHandicapInputValue(chInput, String(safeActual));
    chInput.dispatchEvent(new Event('input', { bubbles: true }));
    chInput.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function closePlayerEntryModal() {
    playerEntryModalClosedAt = Date.now();
    playerEntryModalFocusTarget = null;
    // Blur active element so focus doesn't return to a scorecard input and re-trigger the modal
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    if (!playerEntryModalSheet) return;
    // Play exit animation then hide
    playerEntryModalSheet.style.animation = 'playerEntryModalOut 0.18s cubic-bezier(0.4, 0, 1, 1) forwards';
    if (playerEntryModalBackdrop) {
      playerEntryModalBackdrop.style.animation = 'fadeOut 0.18s ease forwards';
    }
    const sheet = playerEntryModalSheet;
    const backdrop = playerEntryModalBackdrop;
    setTimeout(() => {
      sheet.hidden = true;
      sheet.style.animation = '';
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.style.animation = '';
      }
      document.body.classList.remove('player-entry-modal-open');
    }, 185);
  }

  function syncPlayerEntryModalPosition() {
    if (!playerEntryModalSheet) return;

    const rootStyles = getComputedStyle(document.documentElement);
    const safeTop = parseFloat(rootStyles.getPropertyValue('--safe-top-dynamic')) || 0;
    const entrySwitcher = document.querySelector('.entry-switcher');
    const headerEl = document.querySelector('header');

    const switcherBottom = entrySwitcher
      ? Math.round(entrySwitcher.getBoundingClientRect().bottom)
      : Math.round(safeTop + 64);

    // Hidden mode: keep modal just below Score/Games switcher.
    const hiddenModeTop = Math.max(Math.round(safeTop + 12), switcherBottom + 8);
    // Expanded mode: stay near hidden-mode position instead of dropping far down page.
    const expandedModeTargetTop = Math.round(safeTop + 80);
    const isHeaderCollapsed = !!headerEl?.classList?.contains('header-collapsed');
    const modalTop = isHeaderCollapsed
      ? hiddenModeTop
      : Math.min(hiddenModeTop, expandedModeTargetTop);

    playerEntryModalSheet.style.setProperty('--player-entry-modal-top', `${modalTop}px`);
  }

  function emitPlayersChanged(reason = 'updated') {
    try {
      document.dispatchEvent(new CustomEvent('players:changed', {
        detail: { reason, count: PLAYERS }
      }));
    } catch {}
  }

  function focusPlayerEntryModalTarget() {
    if (!playerEntryModalSheet || !playerEntryModalFocusTarget) return;
    // Don't auto-focus on touch devices — keyboard would appear and cause layout shifts
    // that make the Done/X buttons unreliable to tap
    if (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) return;
    const { playerIdx, field } = playerEntryModalFocusTarget;
    const selector = field === 'handicap'
      ? `.player-entry-handicap-input[data-player="${playerIdx}"]`
      : `.player-entry-name-input[data-player="${playerIdx}"]`;
    const el = playerEntryModalSheet.querySelector(selector);
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      if (typeof el.select === 'function') el.select();
    });
  }

  function renderPlayerEntryModalRows() {
    if (!playerEntryModalList) return;
    playerEntryModalList.innerHTML = '';

    const rows = $$('#scorecard .player-row');
    rows.forEach((row, idx) => {
      const { nameInput, chInput } = getPlayerIdentityControls(idx);
      if (!nameInput || !chInput) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'player-entry-row';

      const title = document.createElement('div');
      title.className = 'player-entry-row-title';
      title.textContent = `Player ${idx + 1}`;

      const nameLabel = document.createElement('label');
      nameLabel.className = 'player-entry-field';
      nameLabel.textContent = 'Name';

      const nameEditor = document.createElement('input');
      nameEditor.type = 'text';
      nameEditor.className = 'player-entry-name-input';
      nameEditor.dataset.player = String(idx);
      nameEditor.placeholder = `Player ${idx + 1}`;
      nameEditor.autocomplete = 'off';
      nameEditor.value = nameInput.value || '';
      nameEditor.addEventListener('input', () => {
        applyPlayerNameFromModal(idx, nameEditor.value);
      });

      const handicapLabel = document.createElement('label');
      handicapLabel.className = 'player-entry-field';
      handicapLabel.textContent = 'Handicap';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn player-entry-remove-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.disabled = PLAYERS <= MIN_PLAYERS;
      removeBtn.setAttribute('aria-label', `Remove player ${idx + 1}`);

      const handicapControl = document.createElement('div');
      handicapControl.className = 'player-entry-handicap-control';

      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'player-entry-step-btn';
      minusBtn.textContent = '-';
      minusBtn.setAttribute('aria-label', `Decrease handicap for player ${idx + 1}`);

      const handicapEditor = document.createElement('input');
      handicapEditor.type = 'text';
      handicapEditor.className = 'player-entry-handicap-input';
      handicapEditor.dataset.player = String(idx);
      handicapEditor.placeholder = '0';
      handicapEditor.inputMode = 'text';
      handicapEditor.pattern = '[+\\-]?[0-9]*';
      handicapEditor.autocomplete = 'off';

      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'player-entry-step-btn';
      plusBtn.textContent = '+';
      plusBtn.setAttribute('aria-label', `Increase handicap for player ${idx + 1}`);

      const readActual = () => {
        const fromDataset = Number(handicapEditor.dataset.actualValue);
        if (Number.isFinite(fromDataset)) return fromDataset;
        const parsed = parseDisplayedHandicap(handicapEditor.value);
        return parsed === null ? 0 : parsed;
      };

      const applyActual = (actual) => {
        const safeActual = clampInt(actual, LIMITS.MIN_HANDICAP, LIMITS.MAX_HANDICAP);
        setModalHandicapValue(handicapEditor, safeActual);
        applyPlayerHandicapFromModal(idx, safeActual);
      };

      setModalHandicapValue(handicapEditor, getActualHandicapValue(chInput));

      minusBtn.addEventListener('click', () => {
        applyActual(readActual() - 1);
      });

      plusBtn.addEventListener('click', () => {
        applyActual(readActual() + 1);
      });

      handicapEditor.addEventListener('input', () => {
        const raw = String(handicapEditor.value ?? '').trim();
        if (raw === '' || raw === '+' || raw === '-') {
          handicapEditor.dataset.actualValue = '0';
          applyPlayerHandicapFromModal(idx, 0);
          return;
        }
        const parsed = parseDisplayedHandicap(raw);
        if (parsed === null) return;
        handicapEditor.dataset.actualValue = String(parsed);
        applyPlayerHandicapFromModal(idx, parsed);
      });

      handicapEditor.addEventListener('blur', () => {
        const parsed = parseDisplayedHandicap(handicapEditor.value);
        const actual = parsed === null ? 0 : parsed;
        setModalHandicapValue(handicapEditor, actual);
      });

      removeBtn.addEventListener('click', () => {
        if (PLAYERS <= MIN_PLAYERS) return;
        // Reuse existing confirmation/delete flow so behavior is consistent.
        Scorecard.player.removeByIndex(idx);
      });

      handicapControl.append(minusBtn, handicapEditor, plusBtn, removeBtn);
      nameLabel.appendChild(nameEditor);
      handicapLabel.appendChild(handicapControl);
      wrapper.append(title, nameLabel, handicapLabel);
      playerEntryModalList.appendChild(wrapper);
    });

    focusPlayerEntryModalTarget();
  }

  function ensurePlayerEntryModal() {
    if (playerEntryModalBackdrop && playerEntryModalSheet && playerEntryModalList) return;

    playerEntryModalBackdrop = document.createElement('div');
    playerEntryModalBackdrop.className = 'player-entry-modal-backdrop';
    playerEntryModalBackdrop.hidden = true;
    playerEntryModalBackdrop.addEventListener('click', closePlayerEntryModal);

    playerEntryModalSheet = document.createElement('div');
    playerEntryModalSheet.className = 'player-entry-modal';
    playerEntryModalSheet.hidden = true;
    playerEntryModalSheet.setAttribute('role', 'dialog');
    playerEntryModalSheet.setAttribute('aria-modal', 'true');
    playerEntryModalSheet.setAttribute('aria-labelledby', 'playerEntryModalTitle');
    playerEntryModalSheet.innerHTML = `
      <div class="player-entry-modal-header">
        <h3 id="playerEntryModalTitle">Players</h3>
        <button type="button" class="player-entry-close-btn" aria-label="Close player editor">x</button>
      </div>
      <p class="player-entry-modal-note">Leave handicap empty to keep it at 0. Use − to go below 0 (displayed as + index).</p>
      <div class="player-entry-modal-list" id="playerEntryModalList"></div>
      <div class="player-entry-modal-footer">
        <button type="button" class="btn" id="playerEntryAddBtn">+ Add Player</button>
        <button type="button" class="btn" id="playerEntryDoneBtn">Done</button>
      </div>
    `;

    playerEntryModalList = playerEntryModalSheet.querySelector('#playerEntryModalList');

    // Use a single delegated handler on the sheet so buttons always work even after
    // content re-renders, and use touchend as the primary trigger on mobile so that
    // keyboard-dismiss layout shifts can't cause a missed click.
    const handleSheetButton = (e) => {
      const target = e.target.closest('.player-entry-close-btn, #playerEntryDoneBtn, #playerEntryAddBtn');
      if (!target) return;
      e.preventDefault();
      if (target.id === 'playerEntryAddBtn') {
        addPlayer();
        renderPlayerEntryModalRows();
        playerEntryModalFocusTarget = { playerIdx: Math.max(0, PLAYERS - 1), field: 'name' };
        focusPlayerEntryModalTarget();
      } else {
        closePlayerEntryModal();
      }
    };
    // touchend fires first on mobile; preventDefault stops the subsequent ghost click
    // so closePlayerEntryModal won't be called twice. Click handles desktop.
    playerEntryModalSheet.addEventListener('touchend', handleSheetButton);
    playerEntryModalSheet.addEventListener('click', handleSheetButton);

    document.addEventListener('keydown', (e) => {
      if (!playerEntryModalSheet || playerEntryModalSheet.hidden) return;
      if (e.key === 'Escape') closePlayerEntryModal();
    });

    document.addEventListener('players:changed', () => {
      if (!playerEntryModalSheet || playerEntryModalSheet.hidden) return;
      renderPlayerEntryModalRows();
    });

    window.addEventListener('resize', () => {
      if (!playerEntryModalSheet || playerEntryModalSheet.hidden) return;
      syncPlayerEntryModalPosition();
    });

    window.addEventListener('scroll', () => {
      if (!playerEntryModalSheet || playerEntryModalSheet.hidden) return;
      syncPlayerEntryModalPosition();
    }, { passive: true });

    const headerCollapseBtn = document.getElementById('headerCollapseBtn');
    if (headerCollapseBtn) {
      headerCollapseBtn.addEventListener('click', () => {
        if (!playerEntryModalSheet || playerEntryModalSheet.hidden) return;
        requestAnimationFrame(syncPlayerEntryModalPosition);
        setTimeout(syncPlayerEntryModalPosition, 240);
      });
    }

    document.body.appendChild(playerEntryModalBackdrop);
    document.body.appendChild(playerEntryModalSheet);
  }

  function openPlayerEntryModal(options = {}) {
    ensurePlayerEntryModal();
    const playerIdx = Number(options.playerIdx);
    playerEntryModalFocusTarget = {
      playerIdx: Number.isFinite(playerIdx) ? Math.max(0, playerIdx) : 0,
      field: options.field === 'handicap' ? 'handicap' : 'name'
    };

    renderPlayerEntryModalRows();
    syncPlayerEntryModalPosition();
    if (playerEntryModalBackdrop) {
      playerEntryModalBackdrop.style.animation = '';
      playerEntryModalBackdrop.hidden = false;
    }
    if (playerEntryModalSheet) {
      playerEntryModalSheet.style.animation = '';
      playerEntryModalSheet.hidden = false;
    }
    document.body.classList.add('player-entry-modal-open');
    requestAnimationFrame(syncPlayerEntryModalPosition);
    setTimeout(syncPlayerEntryModalPosition, 240);
  }

  function bindPlayerEntryModalTriggers() {
    const table = document.getElementById('scorecard');
    if (!table) return;

    const handleInteractiveTarget = (target) => {
      if (!target || !isPlayerEntryModalViewport()) return false;
      // Ignore for a brief window after the modal was closed to prevent focus-return re-opening it
      if (Date.now() - playerEntryModalClosedAt < 500) return false;
      const isName = target.classList?.contains('name-edit');
      const isHcp = target.classList?.contains('ch-input');
      if (!isName && !isHcp) return false;
      const row = target.closest('.player-row');
      if (!row) return false;

      const playerIdx = Number(row.dataset.player || 0);
      openPlayerEntryModal({
        playerIdx: Number.isFinite(playerIdx) ? playerIdx : 0,
        field: isHcp ? 'handicap' : 'name'
      });
      return true;
    };

    table.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (!handleInteractiveTarget(target)) return;
      e.preventDefault();
      target.blur();
    });

    table.addEventListener('focusin', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (!handleInteractiveTarget(target)) return;
      target.blur();
    });
  }
  
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
    
    // Create new player row for unified table
    const tr = document.createElement("tr");
    tr.className = "player-row";
    tr.dataset.player = String(p);

    // Name input
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
      const currentIndex = Number(tr.dataset.player);
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
    tr.appendChild(nameTd);
    
    // Course Handicap input
    const chTd = document.createElement("td");
    const chInput = document.createElement("input");
    chInput.type = "text";
    chInput.inputMode = "text";
    chInput.className = "ch-input";
    chInput.value = "0";
    chInput.pattern = "[+\\-]?[0-9]*";
    chInput.autocomplete = "off";
    chInput.addEventListener("input", () => {
      const raw = String(chInput.value ?? '').trim();
      if (!syncHandicapInput(chInput)) {
        if (raw === '') {
          Scorecard.calc.recalcAll();
          AppManager.recalcGames();
          Storage.saveDebounced();
        }
        return;
      }
      Scorecard.calc.recalcAll();
      AppManager.recalcGames();
      Storage.saveDebounced();
    });
    chInput.addEventListener('blur', () => {
      syncHandicapInput(chInput, { normalizeDisplay: true });
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
          
          // Auto-advance based on configured direction
          const currentPlayer = Number(inp.dataset.player);
          const currentHole = Number(inp.dataset.hole);
          
          if(inp.value.length >= 1 && Config.ADVANCE_DIRECTION !== 'disabled') {
            let nextInput = null;
            
            if(Config.ADVANCE_DIRECTION === 'down') {
              // Move to next player on same hole
              if(currentPlayer < PLAYERS - 1) {
                nextInput = document.querySelector(
                  `.score-input[data-player="${currentPlayer + 1}"][data-hole="${currentHole}"]`
                );
              }
            } else if(Config.ADVANCE_DIRECTION === 'right') {
              // Move to next hole for same player
              if(currentHole < HOLES - 1) {
                nextInput = document.querySelector(
                  `.score-input[data-player="${currentPlayer}"][data-hole="${currentHole + 1}"]`
                );
              }
            }
            
            if(nextInput) {
              setTimeout(() => {
                nextInput.focus();
                nextInput.select();
              }, TIMING.FOCUS_DELAY_MS);
            }
          }
        } else {
          inp.classList.remove("invalid");
        }
        scheduleScoreInputRecalc(tr);
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
    
      // Update display and recalculate after DOM settles
      requestAnimationFrame(() => {
        Scorecard.player.updateCountDisplay();
        Scorecard.player.syncOverlay();
        recalculateEverything();
        // CRITICAL: Reapply stroke highlighting since adjusted handicaps changed
        Scorecard.calc.applyStrokeHighlighting();
        Scorecard.build.syncRowHeights();
      });    Storage.saveDebounced();
    emitPlayersChanged('added');
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
      z-index: 10060;
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
      animation: slideUpFull 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
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
      container.style.animation = 'slideDownFull 0.18s cubic-bezier(0.4, 0, 1, 1) forwards';
      modal.style.animation = 'fadeOut 0.18s ease forwards';
      setTimeout(() => {
        modal.remove();
        callback(result);
      }, 185);
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
    const targetRow = rows[playerIndex];

    if(!targetRow) {
      Utils.announce('Player not found.');
      return;
    }
    
    // Get player name for confirmation
    const nameInput = $('.name-edit', targetRow);
    const playerName = nameInput?.value || `Player ${playerIndex + 1}`;
    
    // Show custom confirmation modal
    showDeleteConfirmModal(playerName, (confirmed) => {
      if (!confirmed) return;
      
      // Remove the row
      targetRow.remove();
      PLAYERS--;
      
      // Update remaining player indices
      const updatedRows = $$('#scorecard .player-row');
      
      updatedRows.forEach((row, idx) => {
        row.dataset.player = String(idx);
        const scoreInputs = $$('input.score-input', row);
        scoreInputs.forEach(inp => {
          inp.dataset.player = String(idx);
        });
      });
      
      updatedRows.forEach((row, idx) => {
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
      emitPlayersChanged('removed');
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
    const lastRow = rows[rows.length - 1];

    if(lastRow) {
      // First, clear all data in the row
      const nameInput = $(".name-edit", lastRow);
      const chInput = $(".ch-input", lastRow);
      const scoreInputs = $$("input.score-input", lastRow);
      
      if(nameInput) nameInput.value = '';
      if(chInput) setHandicapInputValue(chInput, '');
      scoreInputs.forEach(inp => inp.value = '');
      
      // Recalculate to update totals without this player's data
      Scorecard.calc.recalcRow(lastRow);
      Scorecard.calc.recalcTotalsRow();
      AppManager.recalcGames();
      
      // Now remove the row
      lastRow.remove();
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
  function recalcScorecardPhase() {
    Scorecard.calc.recalcTotalsRow();
  }

  function recalcGameStructurePhase() {
    window.Vegas?.renderTeamControls();
    window.Skins?.refreshForPlayerChange();
    window.Junk?.refreshForPlayerChange();
    window.Banker?.refreshForPlayerChange();
    window.Wolf?.refreshForPlayerChange?.();
  }

  function recalcGamesPhase() {
    AppManager.recalcGames();
  }

  function recalculateEverything() {
    recalcScorecardPhase();
    recalcGameStructurePhase();
    // Defer game recalcs by one microtask so Vegas team-control DOM changes
    // from renderTeamControls() are fully applied before we read them.
    setTimeout(() => {
      recalcGamesPhase();
    }, 0);
  }

  function isElementMostlyVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, viewportH);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const elementHeight = Math.max(1, rect.height || 1);
    return (visibleHeight / elementHeight) > 0.2;
  }

  function getFirstPlayerNextEmptyInput() {
    const playerRow = document.querySelector('#scorecard .player-row[data-player="0"]') || document.querySelector('#scorecard .player-row');
    if (!playerRow) return null;

    const inputs = Array.from(playerRow.querySelectorAll('input.score-input'));
    if (!inputs.length) return null;

    const firstEmpty = inputs.find((input) => String(input.value || '').trim() === '');
    return firstEmpty || null;
  }

  function jumpToNextEmptyScore() {
    const firstEmptyInput = getFirstPlayerNextEmptyInput();
    const fallbackInput = document.querySelector('#scorecard .score-input[data-player="0"][data-hole="1"]');
    const targetInput = firstEmptyInput || fallbackInput;

    const scorecard = document.getElementById('main-scorecard');
    if (scorecard) {
      scorecard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (!targetInput) {
      announce('Opened scorecard.');
      return;
    }

    const hole = Number(targetInput.dataset.hole) || 1;
    setTimeout(() => {
      targetInput.focus();
      targetInput.select?.();
      targetInput.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      if (firstEmptyInput) {
        announce(`Jumped to Player 1, Hole ${hole}.`);
      } else {
        announce('Player 1 has all holes filled.');
      }
    }, 140);
  }

  function jumpToGamesLauncher() {
    const gamesBar = document.getElementById('gamesLauncher') || document.querySelector('.gamesbar');
    if (!gamesBar) return;
    gamesBar.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setupEntryTabs() {
    const scoreBtn = document.getElementById('entrySwitcherScoreBtn');
    const gamesBtn = document.getElementById('entrySwitcherGamesBtn');
    if (!scoreBtn || !gamesBtn) return;

    scoreBtn.addEventListener('click', () => {
      setPrimaryTab('score');
    });

    gamesBtn.addEventListener('click', () => {
      setPrimaryTab('games');
    });

    const gamesFooterScoreBtn = document.getElementById('gamesFooterScoreBtn');
    const gamesFooterGamesBtn = document.getElementById('gamesFooterGamesBtn');
    if (gamesFooterScoreBtn) gamesFooterScoreBtn.addEventListener('click', () => setPrimaryTab('score'));
    if (gamesFooterGamesBtn) gamesFooterGamesBtn.addEventListener('click', () => setPrimaryTab('games'));

    syncPrimaryTabUi(getPrimaryTab());
    syncGameTabUi(getActiveGameTab());
  }

  // =============================================================================
  // INITIALIZATION & EVENT WIRING
  // =============================================================================

  async function syncDisplayedAppVersion() {
    const APP_NAME = 'Golf Games';
    const setTitle = (version) => {
      const titleText = version ? `${APP_NAME} ${version}` : APP_NAME;
      document.title = titleText;
      const heading = document.querySelector('header .header-title-row h1');
      if (heading) heading.textContent = titleText;
    };
    try {
      const assetVersion = (() => {
        try {
          const indexScript = document.querySelector('script[src^="index.js"]');
          if (!indexScript) return '';
          const src = indexScript.getAttribute('src') || '';
          const parsed = new URL(src, window.location.href);
          return parsed.searchParams.get('v') || '';
        } catch (_) {
          return '';
        }
      })();
      const swUrl = assetVersion
        ? `sw.js?v=${encodeURIComponent(assetVersion)}`
        : 'sw.js';
      const response = await fetch(swUrl, { cache: 'no-store' });
      if (!response.ok) return;

      const swSource = await response.text();
      const match = swSource.match(/CACHE_VERSION\s*=\s*['"]v?([0-9]+\.[0-9]+\.[0-9]+)['"]/i);
      if (!match) return;

      const semantic = match[1];
      const version = `v${semantic}`;
      window.APP_VERSION = { semantic, display: version, cache: `golf-${version}` };
      setTitle(version);
    } catch (_) {
      // If sw.js cannot be fetched (for example on restricted file:// contexts), keep static title.
    }
  }
  
  /**
   * Initialize the application:
   * - Build scorecard structure
   * - Wire up all event listeners
   * - Load saved state from localStorage
   */
  function init(){
    syncDisplayedAppVersion();
    Scorecard.build.header(); Scorecard.build.parAndHcpRows(); Scorecard.build.playerRows(); Scorecard.build.totalsRow(); Scorecard.course.updateParBadge();
    Scorecard.player.syncOverlay();
    // Unified table mode no longer requires dual-pane scroll synchronization.
    setupIOSStickyHeaders();
    setupIOSGamesStickyHeaders();
    setupIOSGamesTableOverscrollGuard();
    setupDesktopGamesTablePointerScroll();
    setupGamesPanelScrollSync();
    setupScorecardLayoutAutoResync();
    setupScorecardDebugTrace();
    // On load, hide debug panels immediately if debug is disabled so stale DOM
    // from a previous session never stays visible.
    if (!isLayoutDebugTraceEnabled()) {
      hideLayoutDebugReadouts();
    }
    bindHeaderCloudScrollIndicator();
    syncHeaderBadgeButtonLabels();
    window.addEventListener('resize', syncHeaderBadgeButtonLabels, { passive: true });
    
    // Sync row heights after tables are built (skip highlighting on init - will be applied after data loads)
    requestAnimationFrame(() => {
      Scorecard.build.syncRowHeights(true);
    });
    // iOS/PWA can complete layout after first rAF; run follow-up passes so
    // sticky header/par/hcp offsets are always locked to actual row heights.
    setTimeout(() => Scorecard.build.syncRowHeights(true), 120);
    setTimeout(() => Scorecard.build.syncRowHeights(true), 320);
    triggerScorecardSettleBurst('init');

  $(ids.resetBtn).addEventListener("click", async () => {
    const cloudSession = window.CloudSync?.getSession?.();
    if (cloudSession) {
      // Block cloud pushes immediately so the cloud keeps its last good state.
      window.CloudSync?.suspendPushes?.();
      const dialog = document.createElement('div');
      dialog.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;`;
      const box = document.createElement('div');
      box.style.cssText = `background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px;max-width:400px;box-shadow:0 10px 40px rgba(0,0,0,0.3);`;
      const title = document.createElement('h3');
      title.textContent = 'Reset Scores & Leave Cloud Session?';
      title.style.cssText = 'margin:0 0 12px 0;color:var(--ink);';
      const msg = document.createElement('p');
      msg.textContent = 'Resetting scores will disconnect you from the live cloud session. Anyone watching the live link will no longer see updates. You will need to create and share a new code to go live again.';
      msg.style.cssText = 'margin:0 0 20px 0;color:var(--muted);';
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:12px;';
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Reset & Leave';
      confirmBtn.className = 'btn';
      confirmBtn.style.cssText = 'flex:1;background:var(--danger);color:white;';
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'btn';
      cancelBtn.style.cssText = 'flex:1;';
      btns.append(confirmBtn, cancelBtn);
      box.append(title, msg, btns);
      dialog.appendChild(box);
      document.body.appendChild(dialog);
      const confirmed = await new Promise((resolve) => {
        confirmBtn.onclick = () => { dialog.remove(); resolve(true); };
        cancelBtn.onclick = () => { dialog.remove(); resolve(false); };
      });
      if (!confirmed) {
        window.CloudSync?.resumePushes?.();
        return;
      }
      await window.CloudSync.leaveSession?.();
    }
    Storage.clearScoresOnly();
  });
  $(ids.clearAllBtn).addEventListener("click", async () => {
    // Block cloud pushes immediately so the cloud keeps its last good state.
    window.CloudSync?.suspendPushes?.();
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
    const cloudSession = window.CloudSync?.getSession?.();
    title.textContent = cloudSession ? 'Clear All & Leave Cloud Session?' : 'Clear All Names & Scores?';
    title.style.cssText = 'margin: 0 0 12px 0; color: var(--ink);';
    
    const message = document.createElement('p');
    message.textContent = cloudSession
      ? 'This will clear all player names, handicaps, and scores, and disconnect you from the live cloud session. Anyone watching the live link will no longer see updates. You will need to create and share a new code to go live again.'
      : 'This will clear all player names, handicaps, and scores. This action cannot be undone.';
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
      if (window.CloudSync?.getSession?.()) {
        await window.CloudSync.leaveSession?.();
      }
      Storage.clearAll();
    } else {
      window.CloudSync?.resumePushes?.();
    }
  });

  $(ids.clearEverythingBtn).addEventListener("click", async () => {
    // Block cloud pushes immediately so the cloud keeps its last good state.
    window.CloudSync?.suspendPushes?.();
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
      max-width: 440px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    `;

    const title = document.createElement('h3');
    const cloudSession = window.CloudSync?.getSession?.();
    title.textContent = cloudSession ? 'Clear Everything & Leave Cloud Session?' : 'Clear Everything?';
    title.style.cssText = 'margin: 0 0 12px 0; color: var(--ink);';

    const message = document.createElement('p');
    message.textContent = cloudSession
      ? 'This will clear all scorecard and game data, reset game options to defaults, and disconnect you from the live cloud session. You will need to create and share a new code to go live again.'
      : 'This will clear all scorecard and game data and reset game options to defaults. This action cannot be undone.';
    message.style.cssText = 'margin: 0 0 20px 0; color: var(--muted);';

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 12px;';

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Everything';
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

    const confirmed = await new Promise((resolve) => {
      clearBtn.onclick = () => { dialog.remove(); resolve(true); };
      cancelBtn.onclick = () => { dialog.remove(); resolve(false); };
    });

    if (!confirmed) {
      window.CloudSync?.resumePushes?.();
      return;
    }

    if (window.CloudSync?.getSession?.()) {
      await window.CloudSync.leaveSession?.();
    }
    Storage.clearEverything();
  });

  const clearEverythingScoreOptionsBtn = document.getElementById('clearEverythingScoreOptionsBtn');
  if (clearEverythingScoreOptionsBtn) {
    clearEverythingScoreOptionsBtn.addEventListener('click', () => {
      $(ids.clearEverythingBtn)?.click();
    });
  }

    const clearGamesDataBtn = document.getElementById('clearGamesDataBtn');
    if (clearGamesDataBtn) {
      clearGamesDataBtn.addEventListener('click', async () => {
        const cloudSession = window.CloudSync?.getSession?.();
        const confirmed = window.confirm(
          cloudSession
            ? 'Clear all games data and leave the live cloud session? You will need a new code to go live again.'
            : 'Clear all games data and reset game options to defaults?'
        );
        if (!confirmed) return;

        window.CloudSync?.suspendPushes?.();
        if (cloudSession) {
          await window.CloudSync.leaveSession?.();
        }
        Storage.clearGamesData();
      });
    }

  const wireGameClearButton = (buttonId, gameKey, label) => {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const cloudSession = window.CloudSync?.getSession?.();
      const confirmed = window.confirm(
        cloudSession
          ? `Clear ${label} data and leave the live cloud session? You will need a new code to go live again.`
          : `Clear ${label} data?`
      );
      if (!confirmed) return;

      window.CloudSync?.suspendPushes?.();
      if (cloudSession) {
        await window.CloudSync.leaveSession?.();
      }
      Storage.clearGameData(gameKey);
    });
  };

  wireGameClearButton('clearSkinsDataBtn', 'skins', 'Skins');
  wireGameClearButton('clearVegasDataBtn', 'vegas', 'Vegas');
  wireGameClearButton('clearBankerDataBtn', 'banker', 'Banker');
  wireGameClearButton('clearHiloDataBtn', 'hilo', 'Hi-Lo');
  wireGameClearButton('clearJunkDataBtn', 'junk', 'Junk');
  wireGameClearButton('clearWolfDataBtn', 'wolf', 'Wolf');

  $(ids.saveBtn).addEventListener("click", () => { Storage.save(); });
  
  // Auto-advance direction toggle
  // Junk scoring mode button group
  document.getElementById('junkHcpModeGroup')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hcp-mode-btn');
    if (!btn) return;
    setJunkModeBtnState(btn.id);
    window.Junk?.update?.();
    Storage.saveDebounced();
  });

  // Handicap mode button group
  document.getElementById('handicapModeGroup')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hcp-mode-btn');
    if (!btn) return;
    setHandicapModeButtonState(btn.id);
    Scorecard.calc.recalcAll();
    Storage.saveDebounced();
  });

  // Stroke indicator display mode button group
  document.getElementById('strokeIndicatorModeGroup')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hcp-mode-btn');
    if (!btn) return;
    setStrokeIndicatorModeButtonState(btn.id);
    Scorecard.calc.applyStrokeHighlighting();
    Storage.saveDebounced();
  });

  document.getElementById('advanceToggle')?.addEventListener("click", () => {
    if (Config.ADVANCE_DIRECTION === 'down') {
      Config.ADVANCE_DIRECTION = 'right';
    } else if (Config.ADVANCE_DIRECTION === 'right') {
      Config.ADVANCE_DIRECTION = 'disabled';
    } else {
      Config.ADVANCE_DIRECTION = 'down';
    }
    
    const label = document.getElementById('advanceLabel');
    if(label) {
      if (Config.ADVANCE_DIRECTION === 'down') {
        label.textContent = 'Advance: ↓ Down';
      } else if (Config.ADVANCE_DIRECTION === 'right') {
        label.textContent = 'Advance: → Right';
      } else {
        label.textContent = 'Advance: ✕ Disabled';
      }
    }
    Storage.saveDebounced();
  });
  
  // Refresh All button - recalculates everything
  document.getElementById('refreshAllBtn')?.addEventListener("click", () => {
    recalculateEverything();
    announce('All games refreshed');
  });

  // Course selector - custom searchable dropdown
    const courseSearch = $('#courseSearch');
    const coursePickerToggle = $('#coursePickerToggle');
    const courseDropdown = $('#courseDropdown');
    const courseOptionsList = $('#courseOptionsList');
    const courseNoResults = $('#courseNoResults');
    const coursePicker = $('#coursePicker');
    if(courseSearch && coursePickerToggle && courseDropdown && courseOptionsList && courseNoResults && coursePicker){
      const courseIds = Object.keys(COURSES).sort((a, b) =>
        COURSES[a].name.localeCompare(COURSES[b].name, undefined, { sensitivity: 'base' })
      );
      let isDropdownOpen = false;

      const setDropdownOpen = (isOpen) => {
        isDropdownOpen = isOpen;
        courseDropdown.hidden = !isOpen;
        courseSearch.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        coursePickerToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      };

      const getSelectedCourseId = () => {
        const stored = courseSearch.dataset.selectedCourseId;
        return stored && COURSES[stored] ? stored : ACTIVE_COURSE;
      };

      const renderCourseOptions = (searchValue = '', preferredId = ACTIVE_COURSE) => {
        const normalized = String(searchValue || '').trim().toLowerCase();
        const matched = courseIds.filter((id) => COURSES[id].name.toLowerCase().includes(normalized));

        const visible = matched.slice();
        // Keep selected course pinned only when browsing the full list.
        if (!normalized && preferredId && COURSES[preferredId] && !visible.includes(preferredId)) {
          visible.unshift(preferredId);
        }

        courseOptionsList.innerHTML = '';
        visible.forEach((id) => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'course-option';
          option.dataset.courseId = id;
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', id === preferredId ? 'true' : 'false');
          option.classList.toggle('is-selected', id === preferredId);
          option.textContent = COURSES[id].name;
          courseOptionsList.appendChild(option);
        });

        courseNoResults.hidden = visible.length > 0;
        return visible;
      };

      const applySelectedCourse = (selectedId) => {
        if (!selectedId || !COURSES[selectedId]) return;

        courseSearch.dataset.selectedCourseId = selectedId;
        courseSearch.value = COURSES[selectedId].name;
        renderCourseOptions('', selectedId);
        setDropdownOpen(false);
        if (selectedId !== ACTIVE_COURSE) {
          Scorecard.course.switch(selectedId);
        }
      };

      const syncCoursePickerWithActiveCourse = () => {
        const selectedId = getSelectedCourseId();
        courseSearch.value = COURSES[selectedId].name;
        courseSearch.dataset.selectedCourseId = selectedId;
        renderCourseOptions('', selectedId);
      };

      courseSearch.value = COURSES[ACTIVE_COURSE].name;
      courseSearch.dataset.selectedCourseId = ACTIVE_COURSE;
      renderCourseOptions('', ACTIVE_COURSE);
      setDropdownOpen(false);

      courseSearch.addEventListener('focus', () => {
        const selectedId = getSelectedCourseId();
        renderCourseOptions('', selectedId);
        setDropdownOpen(true);
      });

      courseSearch.addEventListener('click', () => {
        const selectedId = getSelectedCourseId();
        renderCourseOptions('', selectedId);
        setDropdownOpen(true);
      });

      courseSearch.addEventListener('input', () => {
        renderCourseOptions(courseSearch.value, getSelectedCourseId());
        setDropdownOpen(true);
      });

      courseSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const visibleIds = Array.from(courseOptionsList.querySelectorAll('.course-option')).map((option) => option.dataset.courseId);
          if (visibleIds.length === 1) {
            applySelectedCourse(visibleIds[0]);
            return;
          }

          const raw = String(courseSearch.value || '').trim().toLowerCase();
          const exact = courseIds.find((id) => COURSES[id].name.toLowerCase() === raw);
          if (exact) {
            applySelectedCourse(exact);
          }
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          syncCoursePickerWithActiveCourse();
          setDropdownOpen(false);
          courseSearch.blur();
        }
      });

      coursePickerToggle.addEventListener('click', (e) => {
        e.preventDefault();
        if (isDropdownOpen) {
          syncCoursePickerWithActiveCourse();
          setDropdownOpen(false);
          return;
        }

        const selectedId = getSelectedCourseId();
        renderCourseOptions('', selectedId);
        setDropdownOpen(true);
        courseSearch.focus();
      });

      courseOptionsList.addEventListener('click', (e) => {
        const option = e.target.closest('.course-option');
        if (!option) return;
        applySelectedCourse(option.dataset.courseId);
      });

      document.addEventListener('click', (e) => {
        if (coursePicker.contains(e.target)) return;
        if (!isDropdownOpen) return;
        syncCoursePickerWithActiveCourse();
        setDropdownOpen(false);
      });

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !isDropdownOpen) return;
        syncCoursePickerWithActiveCourse();
        setDropdownOpen(false);
      });
    }

    // Games: select tabs
    $(ids.toggleVegas).addEventListener("click", ()=>setGameTab("vegas"));
    $(ids.toggleBanker).addEventListener("click", ()=>setGameTab("banker"));
    $(ids.toggleHilo).addEventListener("click", ()=>setGameTab("hilo"));
    $(ids.toggleSkins).addEventListener("click", ()=>setGameTab("skins"));
    document.getElementById('toggleJunk')?.addEventListener('click', () => setGameTab('junk'));
    document.getElementById('toggleWolf')?.addEventListener('click', () => setGameTab('wolf'));

    const bindGameOptionsToggles = () => {
      const toggles = document.querySelectorAll('.game-options-toggle[data-target]');
      toggles.forEach((toggleBtn) => {
        const targetId = toggleBtn.getAttribute('data-target');
        if (!targetId) return;

        const panel = document.getElementById(targetId);
        if (!panel) return;

        const syncState = (isOpen) => {
          panel.hidden = !isOpen;
          toggleBtn.classList.toggle('is-open', isOpen);
          toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

          // Panel height changes affect visible games area; re-measure and rerender.
          schedulePanelHeightSync();
          AppManager.recalcGamesDebounced?.();
        };

        syncState(!panel.hidden);
        toggleBtn.addEventListener('click', () => {
          syncState(panel.hidden);
          Storage.saveDebounced();
        });
      });

      document.addEventListener('golf:game-tab-changed', () => {
        schedulePanelHeightSync();
        AppManager.recalcGamesDebounced?.();
      });
    };
    bindGameOptionsToggles();

    const bindStandingsVisibilityToggles = () => {
      const STORAGE_KEY = 'golf_standings_visibility_v1';
      let visibilityState = {};
      try {
        visibilityState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
      } catch (_) {
        visibilityState = {};
      }

      document.querySelectorAll('.standings-toggle-btn[data-target]').forEach((toggleBtn) => {
        const targetId = toggleBtn.getAttribute('data-target');
        if (!targetId) return;

        const gameKey = toggleBtn.getAttribute('data-game-key') || targetId;
        const targetCard = document.getElementById(targetId);
        if (!targetCard) return;

        const applyState = (isVisible) => {
          targetCard.hidden = !isVisible;
          toggleBtn.classList.toggle('is-collapsed', !isVisible);
          toggleBtn.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
          toggleBtn.setAttribute('aria-label', isVisible ? 'Hide standings' : 'Show standings');
          toggleBtn.setAttribute('title', isVisible ? 'Hide standings' : 'Show standings');
          toggleBtn.textContent = isVisible ? '👁' : '📉';
          schedulePanelHeightSync();
        };

        const initialVisible = visibilityState[gameKey] !== false;
        applyState(initialVisible);

        toggleBtn.addEventListener('click', () => {
          const nextVisible = targetCard.hidden;
          visibilityState[gameKey] = nextVisible;
          applyState(nextVisible);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(visibilityState));
          } catch (_) {
            // Ignore storage failures; UI still updates in-memory.
          }
        });
      });
    };
    bindStandingsVisibilityToggles();

    const footerMainOptionsToggle = document.getElementById('footerMainOptionsToggle');
    const headerOptionsPanel = document.getElementById('headerOptionsPanel');
    if (footerMainOptionsToggle && headerOptionsPanel) {
      const scorecardControlsShell = document.querySelector('.scorecard-controls-shell');
      const scorecardOptionsPanel = document.getElementById('scorecardOptionsPanel');
      const originalHeaderOptionsParent = headerOptionsPanel.parentElement;
      const originalHeaderOptionsNextSibling = headerOptionsPanel.nextElementSibling;

      const mountHeaderOptionsInFooter = () => {
        if (!scorecardControlsShell) return;
        if (headerOptionsPanel.parentElement !== scorecardControlsShell) {
          scorecardControlsShell.insertBefore(headerOptionsPanel, scorecardOptionsPanel || null);
        }
        scorecardControlsShell.classList.add('has-main-options-open');
        headerOptionsPanel.classList.add('footer-mounted-options');
      };

      const restoreHeaderOptionsToHeader = () => {
        if (!originalHeaderOptionsParent) return;
        if (headerOptionsPanel.parentElement !== originalHeaderOptionsParent) {
          if (originalHeaderOptionsNextSibling && originalHeaderOptionsNextSibling.parentElement === originalHeaderOptionsParent) {
            originalHeaderOptionsParent.insertBefore(headerOptionsPanel, originalHeaderOptionsNextSibling);
          } else {
            originalHeaderOptionsParent.appendChild(headerOptionsPanel);
          }
        }
        if (scorecardControlsShell) {
          scorecardControlsShell.classList.remove('has-main-options-open');
        }
        headerOptionsPanel.classList.remove('footer-mounted-options');
      };

      const syncFooterMainOptionsToggleState = (isOpen) => {
        footerMainOptionsToggle.classList.toggle('is-open', isOpen);
        footerMainOptionsToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      };

      syncFooterMainOptionsToggleState(!headerOptionsPanel.hidden);

      footerMainOptionsToggle.addEventListener('click', () => {
        const willOpen = headerOptionsPanel.hidden;
        if (willOpen) {
          mountHeaderOptionsInFooter();
          headerOptionsPanel.hidden = false;
        } else {
          headerOptionsPanel.hidden = true;
          restoreHeaderOptionsToHeader();
        }

        syncFooterMainOptionsToggleState(willOpen);
      });
    }

    requestAnimationFrame(() => {
      syncScorePanelHeight();
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
  document.getElementById('vegasHcpModeGroup')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hcp-mode-btn');
    if (!btn) return;
    setVegasHcpModeBtnState(btn.id);
    window.Vegas?.recalc?.();
    saveDebounced();
  });
  $(ids.optDoubleBirdie).addEventListener("change", ()=>{ window.Vegas?.recalc?.(); saveDebounced(); });
  $(ids.optTripleEagle).addEventListener("change", ()=>{ window.Vegas?.recalc?.(); saveDebounced(); });
  $(ids.vegasPointValue)?.addEventListener("input", ()=>{ window.Vegas?.recalc?.(); saveDebounced(); });
  document.getElementById('vegasGhostRotationOrder')?.addEventListener('change', () => {
    window.Vegas?.recalc?.();
    saveDebounced();
  });

    // Banker: no UI wiring (stub only)

    // Archived tools: CSV import/export, email, QR scan import
    {
      const csvInput = document.getElementById('csvInput');
      if (csvInput) csvInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) handleCSVFile(f);
        e.target.value = '';
      });

      const dlBtn = document.getElementById('dlTemplateBtn');
      if (dlBtn) dlBtn.addEventListener('click', downloadCSVTemplate);

      const exportBtn = document.getElementById('exportCSVBtn');
      if (exportBtn) exportBtn.addEventListener('click', () => window.Export?.exportCurrentScorecard());

      const emailBtn = document.getElementById('emailCSVBtn');
      if (emailBtn) emailBtn.addEventListener('click', () => window.Export?.emailCurrentScorecard());

      const archivedToolsToggle = document.getElementById('archivedToolsToggle');
      const archivedToolsSection = document.getElementById('archivedToolsSection');
      if (archivedToolsToggle && archivedToolsSection) {
        archivedToolsToggle.addEventListener('click', () => {
          const isOpen = archivedToolsSection.style.display !== 'none';
          archivedToolsSection.style.display = isOpen ? 'none' : '';
        });
      }
    }

    function chooseLiveQrMode() {
      return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.style.cssText = `
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 16px;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 22px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        `;

        const title = document.createElement('h3');
        title.textContent = 'Choose QR Type';
        title.style.cssText = 'margin: 0 0 10px 0; color: var(--ink);';

        const msg = document.createElement('p');
        msg.textContent = 'Choose whether this QR opens view-only mode or edit mode.';
        msg.style.cssText = 'margin: 0 0 16px 0; color: var(--muted);';

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap;';

        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn';
        viewBtn.textContent = 'View Only QR';
        viewBtn.style.cssText = 'flex: 1 1 120px;';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn';
        editBtn.textContent = 'Scorekeeping QR';
        editBtn.style.cssText = 'flex: 1 1 120px; background: var(--warn); color: #111;';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'flex: 1 1 120px;';

        const close = (choice) => {
          dialog.remove();
          resolve(choice);
        };

        viewBtn.addEventListener('click', () => close('view'));
        editBtn.addEventListener('click', () => close('edit'));
        cancelBtn.addEventListener('click', () => close(null));
        dialog.addEventListener('click', (e) => {
          if (e.target === dialog) close(null);
        });

        row.append(viewBtn, editBtn, cancelBtn);
        box.append(title, msg, row);
        dialog.appendChild(box);
        document.body.appendChild(dialog);
      });
    }

    // QR Code buttons
    const generateQRBtn = document.getElementById('generateQRBtn');
    if (generateQRBtn) {
      generateQRBtn.addEventListener('click', async () => {
        try {
          if (!window.CloudSync?.generateLiveViewQrCode || !window.CloudSync?.generateLiveEditQrCode) {
            announce('Cloud QR share is not ready yet.');
            return;
          }

          const mode = await chooseLiveQrMode();
          if (!mode) return;

          if (mode === 'edit') {
            await window.CloudSync.generateLiveEditQrCode();
          } else {
            await window.CloudSync.generateLiveViewQrCode();
          }
        } catch (error) {
          console.error('[Share QR] Failed to generate live QR:', error);
          announce(error?.message || 'Unable to generate live QR.');
        }
      });
    }

    // Player management buttons
    const addPlayerBtn = document.getElementById('addPlayerBtn');
    const removePlayerBtn = document.getElementById('removePlayerBtn');
    if (addPlayerBtn) addPlayerBtn.addEventListener("click", addPlayer);
    if (removePlayerBtn) removePlayerBtn.addEventListener("click", removePlayer);
    bindPlayerEntryModalTriggers();

    // Re-measure whenever the header finishes its CSS transition.
    // Wrap in rAF so the sticky nav has been composited before we measure its position.
    document.querySelector('header')?.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'max-height' || e.propertyName === 'grid-template-rows') {
        schedulePanelHeightSync();
      }
    });
    applyHeaderVisibility();
    syncHeaderCollapseBtn();
    schedulePanelHeightSync();
    setTimeout(schedulePanelHeightSync, 240);
    setTimeout(schedulePanelHeightSync, 400);

    // Ensure font size controls exist (fallback for stale cached HTML)
    if (!document.getElementById('fontSizeSmall') || !document.getElementById('fontSizeMedium') || !document.getElementById('fontSizeLarge')) {
      const utilitiesControls = document.querySelector('#utilitiesSection .controls');
      if (utilitiesControls) {
        const control = document.createElement('div');
        control.className = 'control';
        control.style.gap = '8px';
        control.style.alignItems = 'center';
        control.innerHTML = `
          <label style="margin-right: 4px;">Font Size</label>
          <button id="fontSizeSmall" class="btn font-size-btn" type="button" aria-pressed="false">Small</button>
          <button id="fontSizeMedium" class="btn font-size-btn" type="button" aria-pressed="true">Medium</button>
          <button id="fontSizeLarge" class="btn font-size-btn" type="button" aria-pressed="false">Large</button>
        `;
        const csvControl = utilitiesControls.querySelector('.control');
        if (csvControl && csvControl.parentNode === utilitiesControls) {
          utilitiesControls.insertBefore(control, csvControl.nextSibling);
        } else {
          utilitiesControls.prepend(control);
        }
      }

      if (isLayoutDebugTraceEnabled() && getPrimaryTab() === 'score') {
        debugScorecardTrace('syncScorePanelHeight');
      }
    }

    document.getElementById('fontSizeSmall')?.addEventListener('click', () => {
      applyFontSize('small');
      Storage.saveDebounced();
    });
    document.getElementById('fontSizeMedium')?.addEventListener('click', () => {
      applyFontSize('medium');
      Storage.saveDebounced();
    });
    document.getElementById('fontSizeLarge')?.addEventListener('click', () => {
      applyFontSize('large');
      Storage.saveDebounced();
    });
    applyFontSize(Config.FONT_SIZE);
    setupEntryTabs();
    bindGamesLauncherControls();
    
    Scorecard.player.updateCountDisplay();

    // Load saved state first, then recalc (loading will trigger its own recalcAll)
    Storage.load();

    // Warm game modules once after load so frequent score<->games flipping stays snappy.
    warmAllGamesAfterLoad();
    
    // If no saved state was loaded, do initial calculation
    if(!localStorage.getItem(Storage.KEY)) {
      Scorecard.calc.recalcAll(); 
      AppManager.recalcGames();
    }
    
    // Force save before page unload to prevent data loss
    const flushSave = () => {
      // Clear any pending debounced save and save immediately
      clearTimeout(Storage.saveTimer);
      Storage.save();
    };

    window.addEventListener('beforeunload', flushSave);

    // More reliable on mobile Safari / PWA lifecycle transitions
    window.addEventListener('pagehide', flushSave);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushSave();
      } else {
        scheduleIdleDirtyGameFlush();
      }
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

    handicap: {
      getActualValue: getActualHandicapValue,
      setDisplayedValue: setHandicapInputValue,
      parseDisplayedValue: parseDisplayedHandicap,
      formatDisplayedValue: formatDisplayedHandicap
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
      scorecardClip: (reason = 'manual') => debugScorecardTrace(reason, { manual: true }),
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

    // Final sync after resize completes
    resizeTimeout = setTimeout(() => {
      const delayedSync = window.GolfApp?.scorecard?.build?.syncRowHeights;
      if (typeof delayedSync === 'function') {
        resizeAnimationFrame = requestAnimationFrame(() => delayedSync());
      }
    }, window.GolfApp?.constants?.TIMING?.RESIZE_DEBOUNCE_MS || 150);
  });

  window.addEventListener('load', () => {
    const syncRowHeights = window.GolfApp?.scorecard?.build?.syncRowHeights;
    if (typeof syncRowHeights === 'function') {
      requestAnimationFrame(() => syncRowHeights());
      setTimeout(() => {
        const delayedSync = window.GolfApp?.scorecard?.build?.syncRowHeights;
        if (typeof delayedSync === 'function') delayedSync();
      }, 120);
    }
  });
