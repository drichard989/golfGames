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

    COURSES: {
      manito: {
        name: 'Manito Country Club',
        pars: [4, 4, 4, 5, 3, 4, 4, 3, 4, 4, 4, 3, 5, 5, 4, 4, 3, 4],
        hcpMen: [7, 13, 11, 15, 17, 1, 5, 9, 3, 10, 2, 12, 14, 18, 4, 6, 16, 8]
      },
      dove: {
        name: 'Dove Canyon Country Club',
        pars: [5, 4, 4, 3, 4, 4, 3, 4, 5, 3, 5, 4, 3, 5, 4, 4, 3, 4],
        hcpMen: [11, 7, 3, 15, 1, 13, 17, 9, 5, 14, 4, 12, 16, 2, 6, 10, 18, 8]
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

  function syncHandicapInput(chInput) {
    if (!chInput) return false;

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
    chInput.value = formatDisplayedHandicap(actual);
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
    /**
     * Trigger a recalculation on all active game modules.
     * Each call is guarded so a missing or uninitialized module never
     * prevents the rest from updating.
     */
    recalcGames() {
      try { window.Vegas?.recalc();  } catch (e) { console.warn('[AppManager] Vegas recalc failed', e); }
      try { window.Skins?.update();  } catch (e) { /* skins may not be initialized yet */ }
      try { window.Junk?.update();   } catch (e) { /* junk may not be initialized yet */ }
      try { window.HiLo?.update();   } catch (e) { /* hilo may not be initialized yet */ }
      try { window.Banker?.update(); } catch (e) { /* banker may not be initialized yet */ }
    }
  };
  try { window.AppManager = AppManager; } catch {}

  const ids = {
    holesHeader:"#holesHeader",parRow:"#parRow",hcpRow:"#hcpRow",totalsRow:"#totalsRow",
    holesHeaderFixed:"#holesHeaderFixed",parRowFixed:"#parRowFixed",hcpRowFixed:"#hcpRowFixed",totalsRowFixed:"#totalsRowFixed",
    table:"#scorecard",
    tableFixed:"#scorecardFixed",
    resetBtn:"#resetBtn",clearAllBtn:"#clearAllBtn",clearEverythingBtn:"#clearEverythingBtn",saveBtn:"#saveBtn",saveStatus:"#saveStatus",

    // Games toggles
    toggleVegas:"#toggleVegas", toggleBanker:"#toggleBanker", toggleSkins:"#toggleSkins", toggleHilo:"#toggleHilo",
    vegasSection:"#vegasSection", bankerSection:"#bankerSection", skinsSection:"#skinsSection", hiloSection:"#hiloSection", junkSection:"#junkSection",

    // Vegas
    vegasTeams:"#vegasTeams", vegasTeamWarning:"#vegasTeamWarning",
    vegasTableBody:"#vegasBody", vegasTotalA:"#vegasTotalA", vegasTotalB:"#vegasTotalB", vegasPtsA:"#vegasPtsA", vegasPtsB:"#vegasPtsB",
    optUseNet:"#optUseNet", optDoubleBirdie:"#optDoubleBirdie", optTripleEagle:"#optTripleEagle",
    vegasPointValue:"#vegasPointValue", vegasDollarA:"#vegasDollarA", vegasDollarB:"#vegasDollarB", vegasNetHcpMode:"#vegasNetHcpMode",

    // Skins
    skinsModeGross:"#skinsModeGross", skinsModeNet:"#skinsModeNet",
    skinsCarry:"#skinsCarry", skinsHalf:"#skinsHalf",
    skinsBody:"#skinsBody",
    skinsSummary:"#skinsSummary",
    // CSV
    csvInput:"#csvInput", dlTemplateBtn:"#dlTemplateBtn",
    fontSizeSmall:"#fontSizeSmall", fontSizeMedium:"#fontSizeMedium", fontSizeLarge:"#fontSizeLarge",
  };

  const GAME_TAB_ORDER = ['junk', 'skins', 'vegas', 'hilo', 'banker'];
  const DEFAULT_GAME_TAB = GAME_TAB_ORDER[0];
  let headerVisible = true;             // true = header shown
  let headerAutoHiddenByGamesTab = false; // true = games tab auto-hid it (not user-driven)

  function applyHeaderVisibility() {
    const appHeader = document.querySelector('header');
    appHeader?.classList.toggle('header-collapsed', !headerVisible);
  }

  function syncHeaderCollapseBtn() {
    const btn = document.getElementById('headerCollapseBtn');
    if (!btn) return;
    btn.textContent = headerVisible ? '▲ Hide' : '▼ Show';
    btn.setAttribute('aria-label', headerVisible ? 'Hide header' : 'Show header');
    btn.setAttribute('aria-expanded', headerVisible ? 'true' : 'false');
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
      vegas: { section: ids.vegasSection, toggle: ids.toggleVegas, init: null },
      banker: { section: ids.bankerSection, toggle: ids.toggleBanker, init: () => window.Banker?.init?.() },
      skins: { section: ids.skinsSection, toggle: ids.toggleSkins, init: () => window.Skins?.init?.() },
      junk: {
        section: ids.junkSection,
        toggle: 'toggleJunk',
        init: () => {
          window.Junk?.init?.();

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
      hilo: { section: ids.hiloSection, toggle: ids.toggleHilo, init: () => window.HiLo?.init?.() }
    }[which] || null;
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

    const viewportHeight = (window.visualViewport?.height) || window.innerHeight || document.documentElement.clientHeight || 0;
    const navBar = document.querySelector('.sticky-nav-bar');
    const navBarRect = navBar?.getBoundingClientRect();

    // Measure from the bottom of the sticky nav bar to the bottom of the viewport.
    // This is reliable regardless of what's above (header shown/hidden, transitions).
    const topBoundary = navBarRect ? navBarRect.bottom + 4 : 120;
    const available = Math.max(220, Math.floor(viewportHeight - topBoundary));
    panel.style.height = `${available}px`;
    panel.style.maxHeight = `${available}px`;
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
    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
      || window.matchMedia?.('(display-mode: fullscreen)')?.matches
      || window.navigator.standalone === true;
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
    // iOS portrait: 44px typical dynamic island / notch height.
    // Android: 24px minimum status bar; modern Android Chrome returns correct env() so fallback rarely fires.
    let fallbackTop = 0;
    if (standalone && envTop === 0) {
      if (isIOS && portrait) fallbackTop = 44;
      else if (isAndroid) fallbackTop = 24;
    }

    const safeTop = Math.max(envTop, fallbackTop);
    root.style.setProperty('--safe-top-dynamic', `${safeTop}px`);
  }

  function rememberPrimaryTabScroll(which = getPrimaryTab()) {
    if (which !== 'score' && which !== 'games') return;
    PRIMARY_TAB_SCROLL_POSITIONS[which] = window.scrollY || window.pageYOffset || 0;
  }

  function rememberGameTabScroll(which = getActiveGameTab()) {
    if (!GAME_TAB_ORDER.includes(which)) return;
    GAME_TAB_SCROLL_POSITIONS[which] = getGamesScrollTop();
  }

  function restorePrimaryTabScroll(which) {
    if (which !== 'score' && which !== 'games') return;
    const top = Number(PRIMARY_TAB_SCROLL_POSITIONS[which]) || 0;
    const applyScroll = () => {
      window.scrollTo({ top, left: 0, behavior: 'auto' });
      if (which === 'score') {
        const syncRowHeights = window.GolfApp?.scorecard?.build?.syncRowHeights;
        if (typeof syncRowHeights === 'function') {
          syncRowHeights(true);
        }
      }
    };

    requestAnimationFrame(applyScroll);
    setTimeout(applyScroll, 120);
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
    if (!scoreBtn || !gamesBtn || !scorePanel || !gamesPanel) return;

    const isScore = activeTab === 'score';
    document.body?.classList.toggle('mode-score', isScore);
    document.body?.classList.toggle('mode-games', !isScore);
    scoreBtn.classList.toggle('active', isScore);
    gamesBtn.classList.toggle('active', !isScore);
    scoreBtn.setAttribute('aria-selected', isScore ? 'true' : 'false');
    gamesBtn.setAttribute('aria-selected', !isScore ? 'true' : 'false');
    scorePanel.hidden = !isScore;
    gamesPanel.hidden = isScore;
    requestAnimationFrame(() => syncFrozenScorecardHeader());
  }

  function syncGameTabUi(activeGame) {
    GAME_TAB_ORDER.forEach((gameKey) => {
      const config = getGameConfig(gameKey);
      const toggleBtn = resolveTargetElement(config?.toggle);
      if (!toggleBtn) return;

      const isActive = activeGame === gameKey;
      toggleBtn.classList.toggle('active', isActive);
      toggleBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      toggleBtn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
  }

  function setPrimaryTab(which, { save = true } = {}) {
    if (which !== 'score' && which !== 'games') return;

    const currentTab = getPrimaryTab();
    if (currentTab === 'games') {
      rememberGameTabScroll(getActiveGameTab());
    }
    rememberPrimaryTabScroll(currentTab);

    if (which === 'games' && !getActiveGameTab()) {
      setGameTab(DEFAULT_GAME_TAB, { save: false, activatePrimary: false });
    }

    // Collapse the header when on Games tab to maximise panel real estate.
    // Must happen before syncPrimaryTabUi so the new maxHeight calculation
    // already sees the header as gone.
    const appHeader = document.querySelector('header');
    const parBadge = document.getElementById('parBadge');
    // No auto-hide on tab switch — user controls visibility via Hide/Show button.
    syncHeaderCollapseBtn();

    syncPrimaryTabUi(which);
    if (which === 'games') {
      // Delay one frame so layout settles before measuring.
      requestAnimationFrame(() => {
        syncGamesPanelHeight();
        // Run again after transitions finish (header/options panels).
        setTimeout(() => syncGamesPanelHeight(), 300);
        const activeGame = getActiveGameTab();
        if (activeGame) {
          restoreGameTabScroll(activeGame);
        } else {
          restorePrimaryTabScroll(which);
        }
      });
    } else {
      restorePrimaryTabScroll(which);
    }

    if (save) saveDebounced();
  }

  function setupScorecardScrollSync() {
    const fixedPane = document.querySelector('.scorecard-fixed');
    const scrollPane = document.querySelector('.scorecard-scroll');
    const frozenScroll = document.getElementById('scorecardFrozenScroll');
    if (!fixedPane || !scrollPane) return;

    let syncingVertical = false;
    let syncingHorizontal = false;

    const syncScrollTop = (source, target) => {
      if (syncingVertical) return;
      syncingVertical = true;
      target.scrollTop = source.scrollTop;
      requestAnimationFrame(() => {
        syncingVertical = false;
      });
    };

    scrollPane.addEventListener('scroll', () => {
      syncScrollTop(scrollPane, fixedPane);
      if (frozenScroll) {
        if (syncingHorizontal) return;
        syncingHorizontal = true;
        frozenScroll.scrollLeft = scrollPane.scrollLeft;
        syncingHorizontal = false;
      }
    }, { passive: true });

    fixedPane.addEventListener('scroll', () => syncScrollTop(fixedPane, scrollPane), { passive: true });
  }

  function syncScorecardLabelOverlay() {
    const overlayBand = document.getElementById('scorecardOverlayBand');
    if (!overlayBand) return;

    const parRow = document.getElementById('parRow');
    const hcpRow = document.getElementById('hcpRow');
    const firstPlayerRow = document.querySelector('#scorecard tbody tr.player-row');
    const measure = (el) => el ? el.getBoundingClientRect().height : 0;
    const frozenRows = Array.from(document.querySelectorAll('#scorecardFrozenTable tr'));
    const parHeight = measure(parRow) || measure(frozenRows[1]);
    const hcpHeight = measure(hcpRow) || measure(frozenRows[2]);
    const firstPlayerHeight = measure(firstPlayerRow);
    const overlayHeight = parHeight + hcpHeight + firstPlayerHeight;

    if (overlayHeight <= 0) {
      overlayBand.style.height = '0px';
      overlayBand.hidden = true;
      return;
    }

    overlayBand.style.height = `${overlayHeight}px`;
    overlayBand.hidden = false;
  }

  function syncFrozenScorecardHeader() {
    const body = document.body;
    const host = document.getElementById('scorecardFrozenHost');
    const fixedWrap = host?.querySelector('.scorecard-frozen-fixed');
    const scrollWrap = document.getElementById('scorecardFrozenScroll');
    const fixedTarget = document.getElementById('scorecardFrozenFixed');
    const scrollTarget = document.getElementById('scorecardFrozenTable');
    const scrollProxy = document.getElementById('scorecardFrozenScrollProxy');
    const scrollProxyTrack = document.getElementById('scorecardFrozenScrollProxyTrack');
    const fixedPane = document.querySelector('.scorecard-fixed');
    const scrollPane = document.querySelector('.scorecard-scroll');
    const fixedSource = document.getElementById('scorecardFixed');
    const scrollSource = document.getElementById('scorecard');
    if (!host || !fixedWrap || !scrollWrap || !fixedTarget || !scrollTarget || !fixedPane || !scrollPane || !fixedSource || !scrollSource) return;

    const isScore = body?.classList.contains('mode-score');
    host.hidden = !isScore;
    if (!isScore) {
      body?.classList.remove('frozen-ready');
      return;
    }

    // Keep originals visible while measuring, then hide them once clone is synced.
    body?.classList.remove('frozen-ready');

    const cloneRowsInto = (rows, targetTable) => {
      targetTable.innerHTML = '';
      const tbody = document.createElement('tbody');
      rows.forEach((sourceRow) => {
        if (!sourceRow) return;
        const clone = sourceRow.cloneNode(true);
        clone.removeAttribute('id');
        clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
        clone.querySelectorAll('input, select, textarea, button').forEach((el) => {
          el.setAttribute('tabindex', '-1');
          el.setAttribute('aria-hidden', 'true');
        });
        tbody.appendChild(clone);
      });
      targetTable.appendChild(tbody);
    };

    const fixedSourceRows = [
      fixedSource.querySelector('thead tr'),
      document.getElementById('parRowFixed'),
      document.getElementById('hcpRowFixed')
    ];
    const scrollSourceRows = [
      scrollSource.querySelector('thead tr'),
      document.getElementById('parRow'),
      document.getElementById('hcpRow')
    ];

    cloneRowsInto(fixedSourceRows, fixedTarget);
    cloneRowsInto(scrollSourceRows, scrollTarget);

    const fixedTargetRows = Array.from(fixedTarget.querySelectorAll('tr'));
    const scrollTargetRows = Array.from(scrollTarget.querySelectorAll('tr'));

    const applyCellMetrics = (sourceRow, targetRow, rowHeight, referenceCells = []) => {
      if (!sourceRow || !targetRow) return;
      const sourceCells = Array.from(sourceRow.children);
      const targetCells = Array.from(targetRow.children);
      targetRow.style.height = `${rowHeight}px`;

      sourceCells.forEach((sourceCell, cellIndex) => {
        const targetCell = targetCells[cellIndex];
        if (!targetCell) return;
        const referenceCell = referenceCells[cellIndex] || sourceCell;
        // Use exact fractional px — Math.ceil() accumulates rounding error across
        // 9+ cells, shifting divider columns visibly off by several pixels.
        const width = referenceCell.getBoundingClientRect().width;
        targetCell.style.width = `${width}px`;
        targetCell.style.minWidth = `${width}px`;
        targetCell.style.maxWidth = `${width}px`;
        targetCell.style.height = `${rowHeight}px`;
      });
    };

    const rowCount = Math.max(fixedSourceRows.length, scrollSourceRows.length);
    const sharedRowHeights = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const fixedSourceRow = fixedSourceRows[rowIndex];
      const scrollSourceRow = scrollSourceRows[rowIndex];
      const fixedHeight = fixedSourceRow?.getBoundingClientRect().height || 0;
      const scrollHeight = scrollSourceRow?.getBoundingClientRect().height || 0;
      sharedRowHeights[rowIndex] = Math.max(fixedHeight, scrollHeight, 1);
    }

    // Switch to final layout (source header rows hidden) before width sampling.
    // This prevents 1px-per-column drift caused by measuring against pre-hide auto layout.
    body?.classList.add('frozen-ready');

    // Use visible player rows as width references so frozen columns match the
    // live body grid exactly (header/par rows can be wider under auto layout).
    const fixedReferenceCells = Array.from(
      fixedSource.querySelector('tbody tr.player-row')?.children ||
      fixedSourceRows[0]?.children ||
      []
    );
    const scrollReferenceCells = Array.from(
      scrollSource.querySelector('tbody tr.player-row')?.children ||
      scrollSourceRows[0]?.children ||
      []
    );

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const fixedSourceRow = fixedSourceRows[rowIndex];
      const scrollSourceRow = scrollSourceRows[rowIndex];
      const fixedTargetRow = fixedTargetRows[rowIndex];
      const scrollTargetRow = scrollTargetRows[rowIndex];
      const sharedRowHeight = sharedRowHeights[rowIndex] || 1;

      applyCellMetrics(fixedSourceRow, fixedTargetRow, sharedRowHeight, fixedReferenceCells);
      applyCellMetrics(scrollSourceRow, scrollTargetRow, sharedRowHeight, scrollReferenceCells);
    }

    const fixedWidth = fixedPane.getBoundingClientRect().width;
    fixedWrap.style.width = `${fixedWidth}px`;
    fixedWrap.style.minWidth = `${fixedWidth}px`;
    fixedWrap.style.maxWidth = `${fixedWidth}px`;
    // Lock the fixed table element width so responsive min-width rules can't expand it
    fixedTarget.style.width = `${fixedWidth}px`;
    fixedTarget.style.minWidth = '0';

    // Use scrollWidth (full content width) not getBoundingClientRect (viewport-clipped)
    const scrollTableWidth = scrollSource.scrollWidth;
    scrollTarget.style.width = `${scrollTableWidth}px`;
    scrollTarget.style.minWidth = `${scrollTableWidth}px`;
    if (scrollProxyTrack) {
      scrollProxyTrack.style.width = `${scrollTableWidth}px`;
      scrollProxyTrack.style.minWidth = `${scrollTableWidth}px`;
    }

    scrollWrap.scrollLeft = scrollPane.scrollLeft;
    if (scrollProxy) {
      scrollProxy.scrollLeft = scrollPane.scrollLeft;
    }

    syncScorecardLabelOverlay();
  }

  function setupGamesPanelScrollSync() {
    const panel = getGamesScrollContainer();
    if (!panel) return;

    const syncLayout = () => {
      syncSafeTopInset();
      syncGamesPanelHeight();
      syncFrozenScorecardHeader();
    };

    const syncOnScroll = () => {
      syncSafeTopInset();
      syncGamesPanelHeight();
    };

    syncLayout();
    window.addEventListener('resize', syncLayout, { passive: true });
    window.addEventListener('orientationchange', syncLayout, { passive: true });
    window.addEventListener('scroll', syncOnScroll, { passive: true });
    window.visualViewport?.addEventListener('resize', syncLayout, { passive: true });
    window.visualViewport?.addEventListener('scroll', syncOnScroll, { passive: true });
    // Re-measure once all resources are loaded (env() is reliably resolved by then)
    // and again on pageshow so PWA home-screen launches always get the correct value.
    window.addEventListener('load', () => syncSafeTopInset(), { once: true });
    window.addEventListener('pageshow', () => syncSafeTopInset(), { passive: true });
  }

  function setGameTab(which, { save = true, activatePrimary = true } = {}) {
    if (!GAME_TAB_ORDER.includes(which)) return;

    const previousGame = getActiveGameTab();
    if (previousGame) {
      rememberGameTabScroll(previousGame);
    }

    GAME_TAB_ORDER.forEach((gameKey) => {
      if (gameKey === which) {
        games_open(gameKey);
      } else {
        games_close(gameKey);
      }
    });

    syncGameTabUi(which);

    if (activatePrimary) {
      syncPrimaryTabUi('games');
    }

    if (activatePrimary || getPrimaryTab() === 'games') {
      restoreGameTabScroll(which);
    }

    if (save) saveDebounced();
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
                AppManager.recalcGames();
                if (!Storage._isLoading) {
                  Scorecard.calc.applyStrokeHighlighting();
                }
                Storage.saveDebounced(); 
              }
              return;
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
        if(!totalsRow) return;
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
      syncRowHeights(skipHighlighting = false) {
        const fixedTable = $(ids.tableFixed);
        const scrollTable = $(ids.table);
        
        if (!fixedTable || !scrollTable) return;

        if (syncRowHeightsFrame) {
          cancelAnimationFrame(syncRowHeightsFrame);
        }

        syncRowHeightsFrame = requestAnimationFrame(() => {
          syncRowHeightsFrame = null;

          const fixedRows = Array.from(fixedTable.querySelectorAll('tr'));
          const scrollRows = Array.from(scrollTable.querySelectorAll('tr')).filter((row) => !row.classList.contains('scorecard-overlay-row'));
          const allRows = [...fixedRows, ...scrollRows];

          allRows.forEach((row) => {
            row.style.height = 'auto';
          });

          void fixedTable.offsetHeight;
          void scrollTable.offsetHeight;

          const maxRows = Math.max(fixedRows.length, scrollRows.length);
          for (let i = 0; i < maxRows; i++) {
            const fixedRow = fixedRows[i];
            const scrollRow = scrollRows[i];
            if (!fixedRow || !scrollRow) continue;

            const fixedHeight = Math.ceil(fixedRow.getBoundingClientRect().height);
            const scrollHeight = Math.ceil(scrollRow.getBoundingClientRect().height);
            const maxHeight = Math.max(fixedHeight, scrollHeight);
            const nextHeight = `${maxHeight}px`;

            if (fixedRow.style.height !== nextHeight) fixedRow.style.height = nextHeight;
            if (scrollRow.style.height !== nextHeight) scrollRow.style.height = nextHeight;
          }

          syncScorecardLabelOverlay();
        });

        syncFrozenScorecardHeader();
        
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
          const v = getActualHandicapValue(chInput);
          return Number.isFinite(v) ? v : 0; 
        });
        
        // Check current handicap mode
        const modeBtn = document.querySelector('#handicapModeGroup .hcp-mode-btn[data-active="true"]');
        const mode = modeBtn ? modeBtn.dataset.value : 'playOffLow';
        
        // Mode 1: GROSS - no adjustments (return all zeros)
        if (mode === 'gross') {
          return chs.map(() => 0);
        }
        
        // Mode 3: FULL HANDICAP - return raw CHs (no play off low)
        if (mode === 'fullHandicap') {
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
            input.classList.remove("gives-stroke");
            input.dataset.strokes = String(sr);
            input.title = `Receives ${sr} stroke${sr > 1 ? 's' : ''}`;
          } else if(sr < 0) {
            input.classList.add("gives-stroke");
            input.classList.remove("receives-stroke");
            input.dataset.strokes = String(Math.abs(sr));
            input.title = `Gives ${Math.abs(sr)} stroke${Math.abs(sr) > 1 ? 's' : ''}`;
          } else {
            input.classList.remove("receives-stroke", "gives-stroke");
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
        const totalsRowEl = $(ids.totalsRow);
        if(!totalsRowEl) return;

        for(let h=1;h<=HOLES;h++){
          const ph=$$(`input.score-input[data-hole="${h}"]`).map(i=>Number(i.value)||0), t=sum(ph);
          const holeTotalEl = $(`[data-hole-total="${h}"]`);
          if(holeTotalEl) {
            holeTotalEl.textContent = t? String(t) : "—";
          }
        }
        const tds=totalsRowEl.querySelectorAll("td"), base=LEADING_FIXED_COLS+HOLES;
        const OUT=$$("#scorecard .player-row").map(r=>{ 
          const s=r.querySelectorAll("td.split"); 
          return Number(s[0]?.textContent)||0; 
        }).reduce((a,b)=>a+b,0);
        const INN=$$("#scorecard .player-row").map(r=>{ 
          const s=r.querySelectorAll("td.split"); 
          return Number(s[1]?.textContent)||0; 
        }).reduce((a,b)=>a+b,0);
        const TOT=$$("#scorecard .player-row").map(r=>Number($(".total",r)?.textContent)||0).reduce((a,b)=>a+b,0);
        if(tds[base+0]) tds[base+0].textContent=OUT||"—"; 
        if(tds[base+1]) tds[base+1].textContent=INN||"—"; 
        if(tds[base+2]) tds[base+2].textContent=TOT||"—";

        requestAnimationFrame(() => syncFrozenScorecardHeader());
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
            
            if(sr > 0) {
              input.classList.add("receives-stroke");
              input.classList.remove("gives-stroke");
              input.dataset.strokes = String(sr);
              input.title = `Receives ${sr} stroke${sr > 1 ? 's' : ''}`;
            } else if(sr < 0) {
              input.classList.add("gives-stroke");
              input.classList.remove("receives-stroke");
              input.dataset.strokes = String(Math.abs(sr));
              input.title = `Gives ${Math.abs(sr)} stroke${Math.abs(sr) > 1 ? 's' : ''}`;
            } else {
              input.classList.remove("receives-stroke", "gives-stroke");
              input.removeAttribute("data-strokes");
              input.removeAttribute("title");
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
          handicapMode: document.querySelector('#handicapModeGroup .hcp-mode-btn[data-active="true"]')?.dataset.value || 'playOffLow',
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
            state: (typeof window.Banker?.getState === 'function')
              ? (window.Banker.getState() ?? existingState?.banker?.state ?? null)
              : (existingState?.banker?.state ?? null)
          },
          skins: {
            mode: document.getElementById('skinsModeNet')?.checked ? 'net' : 'gross',
            buyIn: Number(document.getElementById('skinsBuyIn')?.value) || 10,
            carry: document.getElementById('skinsCarry')?.checked ?? true,
            half: document.getElementById('skinsHalf')?.checked ?? false
          },
          junk: {
            mode: (() => {
              const selected = document.querySelector('input[name="junkScoreMode"]:checked')?.value;
              if (selected) return selected;
              return (document.getElementById('junkUseNet')?.checked ?? false) ? 'net' : 'gross';
            })(),
            useNet: (() => {
              const selected = document.querySelector('input[name="junkScoreMode"]:checked')?.value;
              if (selected) return selected === 'net';
              return document.getElementById('junkUseNet')?.checked ?? false;
            })(),
            netHcpMode: document.querySelector('input[name="junkNetHcpMode"]:checked')?.value || 'playOffLow',
            achievements: (() => {
              if (typeof window.Junk?.getAchievementState === 'function') {
                return window.Junk.getAchievementState();
              }
              return existingState?.junk?.achievements ?? [];
            })()
          },
          hilo: {
            unitValue: Number(document.getElementById('hiloUnitValue')?.value) || 10
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
          hilo: $(ids.hiloSection)?.classList.contains("open") || false
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
        fontSize: Config.FONT_SIZE || 'medium',
        advanceDirection: Config.ADVANCE_DIRECTION || 'down'
      };
    },

    normalizeLoadedState(rawState) {
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
          state: games.banker?.state ?? rawState.banker?.state,
          open: localUi.sections?.banker ?? rawState.banker?.open
        },
        skins: {
          ...(rawState.skins || {}),
          mode: games.skins?.mode ?? rawState.skins?.mode,
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
          open: localUi.sections?.junk ?? rawState.junk?.open
        },
        hilo: {
          ...(rawState.hilo || {}),
          unitValue: games.hilo?.unitValue ?? rawState.hilo?.unitValue,
          open: localUi.sections?.hilo ?? rawState.hilo?.open
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
        const fixedRows = $$("#scorecardFixed .player-row");
        
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
        handicapMode: document.querySelector('#handicapModeGroup .hcp-mode-btn[data-active="true"]')?.dataset.value || 'playOffLow',
        players: players,
        vegas: { 
          teams: window.Vegas?.getTeamAssignments(), 
          opts: window.Vegas?.getOptions(), 
          open: $(ids.vegasSection).classList.contains("open") 
        },
        banker: { 
          open: $(ids.bankerSection).classList.contains("open"),
          state: (() => {
            const current = (typeof window.Banker?.getState === 'function') ? window.Banker.getState() : null;
            return current ?? existingState?.banker?.state ?? null;
          })()
        },
        skins: { 
          mode: document.getElementById('skinsModeNet')?.checked ? 'net' : 'gross',
          buyIn: Number(document.getElementById('skinsBuyIn')?.value) || 10,
          carry: document.getElementById('skinsCarry')?.checked ?? true,
          half: document.getElementById('skinsHalf')?.checked ?? false,
          open: $(ids.skinsSection)?.classList.contains("open") 
        },
        junk: {
          mode: (() => {
            const selected = document.querySelector('input[name="junkScoreMode"]:checked')?.value;
            if (selected) return selected;
            return (document.getElementById('junkUseNet')?.checked ?? false) ? 'net' : 'gross';
          })(),
          useNet: (() => {
            const selected = document.querySelector('input[name="junkScoreMode"]:checked')?.value;
            if (selected) return selected === 'net';
            return document.getElementById('junkUseNet')?.checked ?? false;
          })(),
          netHcpMode: document.querySelector('input[name="junkNetHcpMode"]:checked')?.value || 'playOffLow',
          open: $(ids.junkSection)?.classList.contains("open"),
          achievements: (() => {
            if (typeof window.Junk?.getAchievementState === 'function') {
              return window.Junk.getAchievementState();
            }
            return existingState?.junk?.achievements ?? [];
          })()
        },
        hilo: {
          unitValue: Number(document.getElementById('hiloUnitValue')?.value) || 10,
          open: $(ids.hiloSection)?.classList.contains("open")
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
     * Debounced save - waits 300ms after last change before saving
     */
    saveDebounced() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), TIMING.RECALC_DEBOUNCE_MS);
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
      let fixedRows = $$("#scorecardFixed .player-row");

      while (scoreRows.length > clampedTarget && fixedRows.length > clampedTarget) {
        scoreRows[scoreRows.length - 1]?.remove();
        fixedRows[fixedRows.length - 1]?.remove();
        scoreRows = $$("#scorecard .player-row");
        fixedRows = $$("#scorecardFixed .player-row");
      }

      while (scoreRows.length < clampedTarget && PLAYERS < MAX_PLAYERS) {
        addPlayer();
        scoreRows = $$("#scorecard .player-row");
        fixedRows = $$("#scorecardFixed .player-row");
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

      const fixedRows = $$("#scorecardFixed .player-row");
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
        const skinsModeGross = document.getElementById('skinsModeGross');
        const skinsModeNet = document.getElementById('skinsModeNet');
        const skinsBuyIn = document.getElementById('skinsBuyIn');
        const skinsCarry = document.getElementById('skinsCarry');
        const skinsHalf = document.getElementById('skinsHalf');
        if (skinsModeGross) skinsModeGross.checked = true;
        if (skinsModeNet) skinsModeNet.checked = false;
        if (skinsBuyIn) skinsBuyIn.value = '10';
        if (skinsCarry) skinsCarry.checked = true;
        if (skinsHalf) skinsHalf.checked = false;

        const junkModeGross = document.getElementById('junkScoreModeGross');
        const junkModeNet = document.getElementById('junkScoreModeNet');
        const junkNetPlayOffLow = document.getElementById('junkNetHcpModePlayOffLow');
        const junkNetFullHandicap = document.getElementById('junkNetHcpModeFullHandicap');
        const junkNetWrap = document.getElementById('junkNetHcpModeWrap');
        if (junkModeGross) junkModeGross.checked = true;
        if (junkModeNet) junkModeNet.checked = false;
        if (junkNetPlayOffLow) junkNetPlayOffLow.checked = true;
        if (junkNetFullHandicap) junkNetFullHandicap.checked = false;
        if (junkNetWrap) junkNetWrap.style.display = 'none';
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

        let existing = {};
        try {
          const raw = localStorage.getItem(this.KEY);
          existing = raw ? JSON.parse(raw) : {};
        } catch {
          existing = {};
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
          const courseSelect = $('#courseSelect');
          if(courseSelect) courseSelect.value = s.course;
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

        // Restore font size
        if (applyLocalUi && s.fontSize && s.fontSize !== Config.FONT_SIZE) {
          applyFontSize(s.fontSize);
        }
        
        // CRITICAL: Explicitly query each table to avoid ambiguity
        const scoreRows = $$("#scorecard .player-row");  // Scrollable table with scores
        const fixedRows = $$("#scorecardFixed .player-row");  // Fixed table with names/CH
        
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
        const junkMode = s.junk?.mode || (s.junk?.useNet ? 'net' : 'gross');
        const junkNetHcpMode = s.junk?.netHcpMode || 'playOffLow';
        const junkModeGross = document.getElementById('junkScoreModeGross');
        const junkModeNet = document.getElementById('junkScoreModeNet');
        const junkNetPlayOffLow = document.getElementById('junkNetHcpModePlayOffLow');
        const junkNetFullHandicap = document.getElementById('junkNetHcpModeFullHandicap');
        const junkNetWrap = document.getElementById('junkNetHcpModeWrap');

        if (junkModeGross) junkModeGross.checked = junkMode !== 'net';
        if (junkModeNet) junkModeNet.checked = junkMode === 'net';
        if (junkNetPlayOffLow) junkNetPlayOffLow.checked = junkNetHcpMode !== 'fullHandicap';
        if (junkNetFullHandicap) junkNetFullHandicap.checked = junkNetHcpMode === 'fullHandicap';
        if (junkNetWrap) junkNetWrap.style.display = junkMode === 'net' ? 'flex' : 'none';
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

        if (applyLocalUi) {
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

          const optionsPanels = s.localUi?.optionsPanels;
          if (optionsPanels && typeof optionsPanels === 'object') {
            Object.entries(optionsPanels).forEach(([targetId, isOpen]) => {
              const panel = document.getElementById(targetId);
              const toggleBtn = document.querySelector(`.game-options-toggle[data-target="${targetId}"]`);
              if (!panel || !toggleBtn) return;

              const open = !!isOpen;
              panel.hidden = !open;
              toggleBtn.classList.toggle('is-open', open);
              toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
          }
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
      const fixedRows = $$("#scorecardFixed .player-row");
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
        window.Banker?.setState?.({ holes: [] });
      };

      const resetSkins = () => {
        const skinsModeGross = document.getElementById('skinsModeGross');
        const skinsModeNet = document.getElementById('skinsModeNet');
        const skinsBuyIn = document.getElementById('skinsBuyIn');
        const skinsCarry = document.getElementById('skinsCarry');
        const skinsHalf = document.getElementById('skinsHalf');
        if (skinsModeGross) skinsModeGross.checked = true;
        if (skinsModeNet) skinsModeNet.checked = false;
        if (skinsBuyIn) skinsBuyIn.value = '10';
        if (skinsCarry) skinsCarry.checked = true;
        if (skinsHalf) skinsHalf.checked = false;
      };

      const resetJunk = () => {
        const junkModeGross = document.getElementById('junkScoreModeGross');
        const junkModeNet = document.getElementById('junkScoreModeNet');
        const junkNetPlayOffLow = document.getElementById('junkNetHcpModePlayOffLow');
        const junkNetFullHandicap = document.getElementById('junkNetHcpModeFullHandicap');
        const junkNetWrap = document.getElementById('junkNetHcpModeWrap');
        if (junkModeGross) junkModeGross.checked = true;
        if (junkModeNet) junkModeNet.checked = false;
        if (junkNetPlayOffLow) junkNetPlayOffLow.checked = true;
        if (junkNetFullHandicap) junkNetFullHandicap.checked = false;
        if (junkNetWrap) junkNetWrap.style.display = 'none';
        window.Junk?.clearAllAchievements?.();
      };

      const resetHilo = () => {
        const hiloUnitValue = document.getElementById('hiloUnitValue');
        if (hiloUnitValue) hiloUnitValue.value = '10';
        window.HiLo?.update?.();
      };

      if (key === 'all' || key === 'vegas') resetVegas();
      if (key === 'all' || key === 'banker') resetBanker();
      if (key === 'all' || key === 'skins') resetSkins();
      if (key === 'all' || key === 'junk') resetJunk();
      if (key === 'all' || key === 'hilo') resetHilo();

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
      setHandicapModeButtonState('handicapModePlayOffLow');

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
      const fallbackBtn = document.getElementById('handicapModePlayOffLow');
      if (fallbackBtn) {
        fallbackBtn.dataset.active = 'true';
        fallbackBtn.setAttribute('aria-checked', 'true');
      }
    }
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
      if(chInput) setHandicapInputValue(chInput, '');
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
    // Defer game recalcs by one microtask so Vegas team-control DOM changes
    // from renderTeamControls() are fully applied before we read them.
    setTimeout(() => {
      AppManager.recalcGames();
      window.Skins?.refreshForPlayerChange();
      window.Junk?.refreshForPlayerChange();
      window.Banker?.refreshForPlayerChange();
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

    syncPrimaryTabUi(getPrimaryTab());
    syncGameTabUi(getActiveGameTab());
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
    setupScorecardScrollSync();
    setupGamesPanelScrollSync();
    
    // Sync row heights after tables are built (skip highlighting on init - will be applied after data loads)
    requestAnimationFrame(() => {
      Scorecard.build.syncRowHeights(true);
    });

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

  const clearGamesDataBtn = document.getElementById('clearGamesDataBtn');
  if (clearGamesDataBtn) {
    clearGamesDataBtn.addEventListener('click', async () => {
      const cloudSession = window.CloudSync?.getSession?.();
      const confirmed = window.confirm(
        cloudSession
          ? 'Clear all game data and leave the live cloud session? You will need a new code to go live again.'
          : 'Clear all game data and reset game options to defaults?'
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

  $(ids.saveBtn).addEventListener("click", () => { Storage.save(); });
  
  // Auto-advance direction toggle
  // Handicap mode button group
  document.getElementById('handicapModeGroup')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hcp-mode-btn');
    if (!btn) return;
    setHandicapModeButtonState(btn.id);
    Scorecard.calc.recalcAll();
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

    // Games: select tabs
    $(ids.toggleVegas).addEventListener("click", ()=>setGameTab("vegas"));
    $(ids.toggleBanker).addEventListener("click", ()=>setGameTab("banker"));
    $(ids.toggleHilo).addEventListener("click", ()=>setGameTab("hilo"));
    $(ids.toggleSkins).addEventListener("click", ()=>setGameTab("skins"));
    document.getElementById('toggleJunk')?.addEventListener('click', () => setGameTab('junk'));

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
        };

        syncState(!panel.hidden);
        toggleBtn.addEventListener('click', () => {
          syncState(panel.hidden);
          Storage.saveDebounced();
        });
      });
    };
    bindGameOptionsToggles();
    
    // Clear Junk Achievements button
    document.getElementById('clearJunkAchievements')?.addEventListener('click', () => {
      if(confirm('Clear all Junk achievements? This cannot be undone.')) {
        window.Junk?.clearAllAchievements();
        Utils.announce('All achievements cleared.');
      }
    });

    const updateVegasNetModeVisibility = () => {
      const wrap = document.getElementById('vegasNetHcpModeWrap');
      const useNet = document.getElementById('optUseNet')?.checked;
      if (!wrap) return;
      wrap.style.display = useNet ? 'flex' : 'none';
    };

    // Vegas UI + wiring
    window.Vegas?.renderTeamControls();
    window.Vegas?.renderTable();
  $(ids.optUseNet).addEventListener("change", ()=>{ updateVegasNetModeVisibility(); AppManager.recalcGames(); saveDebounced(); });
  $(ids.optDoubleBirdie).addEventListener("change", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  $(ids.optTripleEagle).addEventListener("change", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  $(ids.vegasPointValue)?.addEventListener("input", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  $(ids.vegasNetHcpMode)?.addEventListener("change", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  updateVegasNetModeVisibility();

    // Banker: no UI wiring (stub only)

    // Deprecated transfer/archive tools (kept for easy rollback)
    // Includes: CSV import/export, HTML snapshot share, and QR scan import.
    // Flip to true to restore old bindings instantly.
    const ENABLE_DEPRECATED_TRANSFER_TOOLS = false;
    if (ENABLE_DEPRECATED_TRANSFER_TOOLS) {
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

      const legacyShareBtn = document.getElementById('shareHtmlArchiveBtn');
      if (legacyShareBtn && window.Export && window.Export.shareHtmlSnapshot) {
        legacyShareBtn.addEventListener("click", () => window.Export.shareHtmlSnapshot());
      }
    }

    // New share flow: create/reuse cloud session and share a view-link URL.
    const shareLiveBtn = document.getElementById('shareHtmlBtn');
    if (shareLiveBtn) {
      shareLiveBtn.addEventListener('click', async () => {
        try {
          if (!window.CloudSync?.shareLiveViewLink) {
            announce('Cloud share is not ready yet.');
            return;
          }
          await window.CloudSync.shareLiveViewLink();
        } catch (error) {
          console.error('[Share] Failed to share live link:', error);
          announce(error?.message || 'Unable to share live link.');
        }
      });
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
        editBtn.textContent = 'Edit QR';
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
    
    if (ENABLE_DEPRECATED_TRANSFER_TOOLS) {
      const scanQRBtn = document.getElementById('scanQRBtn');
      if (scanQRBtn && window.QRShare && window.QRShare.scan) {
        scanQRBtn.addEventListener("click", () => window.QRShare.scan());
      }
    }

    // Player management buttons
    const addPlayerBtn = document.getElementById('addPlayerBtn');
    const removePlayerBtn = document.getElementById('removePlayerBtn');
    if (addPlayerBtn) addPlayerBtn.addEventListener("click", addPlayer);
    if (removePlayerBtn) removePlayerBtn.addEventListener("click", removePlayer);

    // Header collapse toggle
    document.getElementById('headerCollapseBtn')?.addEventListener('click', () => {
      headerVisible = !headerVisible;
      headerAutoHiddenByGamesTab = false; // user explicitly chose — override auto behaviour
      applyHeaderVisibility();
      syncHeaderCollapseBtn();
      // Re-measure at multiple points after the header transition (220ms) completes.
      requestAnimationFrame(() => syncGamesPanelHeight());
      setTimeout(() => syncGamesPanelHeight(), 240);
      setTimeout(() => syncGamesPanelHeight(), 400);
    });
    // Re-measure whenever the header finishes its CSS transition.
    // Wrap in rAF so the sticky nav has been composited before we measure its position.
    document.querySelector('header')?.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'max-height') {
        requestAnimationFrame(() => syncGamesPanelHeight());
      }
    });
    syncHeaderCollapseBtn();

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
    }

    // Archived tools section toggle
    const archivedToolsToggle = document.getElementById('archivedToolsToggle');
    const archivedToolsSection = document.getElementById('archivedToolsSection');
    if (archivedToolsToggle && archivedToolsSection) {
      archivedToolsToggle.addEventListener('click', () => {
        const isOpen = archivedToolsSection.style.display !== 'none';
        archivedToolsSection.style.display = isOpen ? 'none' : '';
      });
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
    
    Scorecard.player.updateCountDisplay();

    // Load saved state first, then recalc (loading will trigger its own recalcAll)
    Storage.load();
    
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
    const syncRowHeights = window.GolfApp?.scorecard?.build?.syncRowHeights;
    if (typeof syncRowHeights === 'function') {
      resizeAnimationFrame = requestAnimationFrame(() => {
        syncRowHeights();
      });
    }
    
    // Final sync after resize completes
    resizeTimeout = setTimeout(() => {
      const delayedSync = window.GolfApp?.scorecard?.build?.syncRowHeights;
      if (typeof delayedSync === 'function') {
        requestAnimationFrame(() => delayedSync());
      }
    }, 150);
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
