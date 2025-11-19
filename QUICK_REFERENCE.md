# Golf Scorecard App - Quick Reference

**Version:** 2.1.0 | **Updated:** November 18, 2025

---

## 🚀 Quick Start API

### Unified Namespace
```javascript
// Everything is now available under window.GolfApp
GolfApp.version           // "2.1.0"
GolfApp.config           // Configuration module
GolfApp.utils            // Utility functions
GolfApp.scorecard        // Scorecard operations
GolfApp.storage          // State persistence
GolfApp.errorHandler     // Error notifications
GolfApp.games            // Game modules (vegas, skins, junk, hilo)
GolfApp.api              // Core API functions
GolfApp.constants        // All constants
GolfApp.debug            // Debug utilities
```

---

## 🎮 Core API Functions

```javascript
// Save/Load
GolfApp.api.save()                    // Save current state
GolfApp.api.load()                    // Load saved state

// Players
GolfApp.api.addPlayer()               // Add new player
GolfApp.api.removePlayer()            // Remove last player

// Calculations
GolfApp.api.recalculateEverything()   // Refresh all games

// Export
GolfApp.api.export()                  // Download CSV
GolfApp.api.email()                   // Email scorecard
```

---

## 💡 Utility Functions

```javascript
// DOM Queries
GolfApp.utils.$('#id')                        // Query single element
GolfApp.utils.$$('.class')                    // Query all elements
GolfApp.utils.safeQuery('#id', doc, 'ctx')   // Safe query with logging

// Validation
GolfApp.utils.validate(value, 'score')        // Validate score (1-20)
GolfApp.utils.validate(value, 'handicap')     // Validate CH (-50 to +60)
GolfApp.utils.validate(value, 'name')         // Sanitize name (max 50)

// Timing
GolfApp.utils.debounce(fn, 300)               // Debounce function
GolfApp.utils.throttle(fn, 100)               // Throttle function

// Math
GolfApp.utils.sum([1,2,3])                    // Sum array
GolfApp.utils.clampInt(val, min, max)         // Clamp integer
GolfApp.utils.fmt(123.456)                    // Format currency
```

---

## 🔔 Notifications

```javascript
// Show error notification
GolfApp.errorHandler.show(
  'User friendly message',
  'Technical details (optional)',
  5000  // Duration in ms (optional)
);

// Show success notification
GolfApp.errorHandler.success(
  'Operation successful!',
  3000  // Duration in ms (optional)
);
```

---

## 🎯 Constants

```javascript
// Core Constants
GolfApp.constants.HOLES              // 18
GolfApp.constants.PLAYERS            // Current player count
GolfApp.constants.MIN_PLAYERS        // 1
GolfApp.constants.MAX_PLAYERS        // 99

// Limits
GolfApp.constants.LIMITS = {
  MIN_HANDICAP: -50,
  MAX_HANDICAP: 60,
  MIN_SCORE: 1,
  MAX_SCORE: 20
}

// Timing
GolfApp.constants.TIMING = {
  FOCUS_DELAY_MS: 50,
  RECALC_DEBOUNCE_MS: 300,
  INIT_RETRY_DELAY_MS: 150,
  RESIZE_DEBOUNCE_MS: 150
}

// Game Constants
GolfApp.constants.GAME_CONSTANTS = {
  JUNK: {
    POINTS: { EAGLE: 4, BIRDIE: 2, PAR: 1, BOGEY: 0 },
    ACHIEVEMENTS: { HOGAN: 5, SANDY: 3, SADAAM: 2, PULLEY: 1, TRIPLE: 10 }
  },
  VEGAS: {
    MULTIPLIERS: { DEFAULT: 1, BIRDIE: 2, EAGLE: 3 }
  },
  SKINS: { DEFAULT_BUYIN: 10 }
}
```

---

## 🎮 Game Modules

```javascript
// Access game modules
GolfApp.games.vegas         // Vegas game
GolfApp.games.skins         // Skins game
GolfApp.games.junk          // Junk (Dots) game
GolfApp.games.hilo          // Hi-Lo game
GolfApp.games.banker        // Banker game (stub)
GolfApp.games.bankerVegas   // Banker-Vegas game (stub)

// Vegas API Example
GolfApp.games.vegas.compute()
GolfApp.games.vegas.render()
GolfApp.games.vegas.recalc()
GolfApp.games.vegas.getTeamAssignments()
GolfApp.games.vegas.setTeamAssignments(teams)
```

---

## 🐛 Debug Utilities

```javascript
// Get current app state
const state = GolfApp.debug.getState();
// Returns: { players, course, pars, hcpMen }

// Clear localStorage
GolfApp.debug.clearStorage();

// Test notifications
GolfApp.debug.testError();     // Show test error
GolfApp.debug.testSuccess();   // Show test success

// Check version
console.log(GolfApp.version);  // "2.1.0"
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save scorecard |
| `Ctrl/Cmd + N` | Add new player |
| `Ctrl/Cmd + R` | Refresh all calculations |
| `Escape` | Close notifications |

---

## 📦 Storage System

```javascript
// Manual save/load
GolfApp.storage.save()              // Returns boolean
GolfApp.storage.load()              // Returns boolean

// Debounced save (recommended)
GolfApp.storage.saveDebounced()     // Auto-saves after 300ms

// Storage key
GolfApp.storage.KEY                 // "golf_scorecard_v5"

// Current version
GolfApp.storage.CURRENT_VERSION     // 5

// Migration system
GolfApp.storage.migrations.v4_to_v5(oldData)
GolfApp.storage.attemptMigration()
```

---

## 🎨 Scorecard Operations

```javascript
// Build operations
GolfApp.scorecard.build.header()
GolfApp.scorecard.build.parAndHcpRows()
GolfApp.scorecard.build.playerRows()
GolfApp.scorecard.build.totalsRow()
GolfApp.scorecard.build.syncRowHeights()

// Calculation operations
GolfApp.scorecard.calc.adjustedCHs()         // Get adjusted handicaps
GolfApp.scorecard.calc.strokesOnHole(ch, h)  // Strokes on specific hole
GolfApp.scorecard.calc.getGross(p, h)        // Gross score
GolfApp.scorecard.calc.getNetNDB(p, h)       // Net with NDB cap
GolfApp.scorecard.calc.recalcRow(row)        // Recalc single row
GolfApp.scorecard.calc.recalcAll()           // Recalc everything
GolfApp.scorecard.calc.applyStrokeHighlighting()

// Player operations
GolfApp.scorecard.player.add()               // Add player
GolfApp.scorecard.player.remove()            // Remove player
GolfApp.scorecard.player.syncOverlay()       // Sync names overlay
GolfApp.scorecard.player.updateCountDisplay()

// Course operations
GolfApp.scorecard.course.switch(courseId)    // Switch course
GolfApp.scorecard.course.updateParBadge()    // Update par display
```

---

## 🏗️ Configuration

```javascript
// Access configuration
GolfApp.config.HOLES              // 18
GolfApp.config.MIN_PLAYERS        // 1
GolfApp.config.MAX_PLAYERS        // 99
GolfApp.config.NDB_BUFFER         // 2

// Current course
GolfApp.config.activeCourse       // "manito" or "dove"
GolfApp.config.pars               // Array of 18 pars
GolfApp.config.hcpMen             // Array of 18 handicap indices

// Available courses
GolfApp.config.COURSES = {
  'manito': { name, pars, hcpMen },
  'dove': { name, pars, hcpMen }
}

// Switch course
GolfApp.config.switchCourse('dove')
```

---

## 🎭 Error Handling Pattern

```javascript
// Recommended pattern for all operations
try {
  const element = GolfApp.utils.safeQuery('#myElement', document, 'MyFeature');
  if (!element) {
    GolfApp.errorHandler.show('Element not found', 'Check if DOM is ready');
    return;
  }
  
  // Validate input
  const validScore = GolfApp.utils.validate(userInput, 'score');
  if (validScore === null) {
    GolfApp.errorHandler.show('Invalid score', 'Must be between 1-20');
    return;
  }
  
  // Perform operation
  element.value = validScore;
  GolfApp.errorHandler.success('Score updated!');
  
} catch (error) {
  console.error('[MyFeature] Error:', error);
  GolfApp.errorHandler.show('Operation failed', error.message);
}
```

---

## 📱 Responsive Breakpoints

```css
/* Mobile */
@media (max-width: 400px) { }

/* Phones */
@media (min-width: 400px) and (max-width: 768px) { }

/* Tablets */
@media (min-width: 768px) and (max-width: 1024px) { }

/* Desktop */
@media (min-width: 1024px) { }
```

---

## 🎨 CSS Custom Properties

```css
/* Colors */
var(--bg)          /* Background */
var(--panel)       /* Panel background */
var(--ink)         /* Text color */
var(--muted)       /* Muted text */
var(--accent)      /* Accent color (green) */
var(--danger)      /* Error/danger (red) */
var(--warn)        /* Warning (orange) */
var(--line)        /* Border color */

/* Spacing */
var(--space-xs)    /* 6px */
var(--space-sm)    /* 8px */
var(--space-md)    /* 12px */
var(--space-lg)    /* 16px */
var(--space-xl)    /* 20px */

/* Border radius */
var(--radius-sm)   /* 6px */
var(--radius-md)   /* 8px */
var(--radius-lg)   /* 10px */
var(--radius-xl)   /* 12px */

/* Touch targets */
var(--touch-min)   /* 44px - iOS minimum */
var(--touch-comfortable) /* 48px */
```

---

## 🔄 Common Workflows

### Add New Course
```javascript
// 1. Add to Config.COURSES in index.js
COURSES: {
  'mynewcourse': {
    name: 'My New Course',
    pars: [4,4,4,5,3,4,4,3,4, 4,4,3,5,5,4,4,3,4],
    hcpMen: [7,13,11,15,17,1,5,9,3, 10,2,12,14,18,4,6,16,8]
  }
}

// 2. Course will auto-populate in dropdown
// 3. No other changes needed!
```

### Add New Game Mode
```javascript
// 1. Create js/mygame.js
window.MyGame = {
  init() { },
  update() { },
  compute() { },
  render() { }
};

// 2. Add section to index.html
<section class="game-section" id="myGameSection">...</section>

// 3. Add toggle button
<button id="toggleMyGame" class="game-toggle">🎮 My Game</button>

// 4. Wire up in init()
$('#toggleMyGame').addEventListener('click', () => games_toggle('mygame'));

// 5. Access via GolfApp.games.mygame
```

---

## 📊 Performance Tips

```javascript
// Use debounced saves
GolfApp.storage.saveDebounced();  // ✅ Good

// Batch DOM reads
const rows = GolfApp.utils.$$('.player-row');  // ✅ Query once
rows.forEach(row => { /* process */ });

// Use requestAnimationFrame for DOM updates
requestAnimationFrame(() => {
  GolfApp.scorecard.build.syncRowHeights();
});

// Throttle expensive operations
const throttledRecalc = GolfApp.utils.throttle(() => {
  GolfApp.api.recalculateEverything();
}, 100);
```

---

## 🔐 Security Best Practices

```javascript
// Always validate user input
const safe = GolfApp.utils.validate(userInput, 'score');

// Escape HTML in error messages (built-in)
GolfApp.errorHandler.show(userInput);  // ✅ Auto-escaped

// Use safe queries
const el = GolfApp.utils.safeQuery(selector);

// Check localStorage quota
if (serialized.length > 5000000) {
  throw new Error('State too large');
}
```

---

## 📝 Code Style

```javascript
// Use JSDoc for functions
/**
 * Brief description
 * @param {type} name - Description
 * @returns {type} Description
 */

// Use try-catch for operations that can fail
try {
  // Risky operation
} catch (error) {
  console.error('[Module] Error:', error);
  GolfApp.errorHandler.show('User message', error.message);
}

// Use early returns
if (!condition) return;

// Use descriptive variable names
const adjustedHandicaps = GolfApp.scorecard.calc.adjustedCHs();

// Use constants instead of magic numbers
const points = GolfApp.constants.GAME_CONSTANTS.JUNK.POINTS.EAGLE;
```

---

**For full documentation, see `IMPROVEMENTS.md`**
