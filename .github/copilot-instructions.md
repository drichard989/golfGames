# Golf Scorecard PWA - AI Coding Agent Instructions

## Project Overview

Progressive Web App for tracking golf scores with multiple simultaneous side games. Vanilla JavaScript, no build tools, optimized for mobile.

**Version:** 2.1.0 | **Architecture:** Modular vanilla JS with unified `window.GolfApp` namespace

## Core Architecture

### Module Structure (No Build System)

All code runs directly in browser. Files loaded via `<script>` tags in [index.html](../index.html).

**Core Module ([index.js](../index.js) - 2,963 lines):**
- `Config` - Course database, constants (`COURSES`, `HOLES`, `MIN_PLAYERS`)
- `Utils` - DOM helpers (`$`, `$$`), validation, debounce/throttle
- `AppManager` - Coordinates recalculations across all game modules
- `Scorecard` - Table building, handicap calculations, NDB (Net Double Bogey) capping
- `Storage` - localStorage with versioning (`golf_scorecard_v5`)

**Game Modules ([js/](../js/))** - Each exposes `window.GameName`:
- [vegas.js](../js/vegas.js) - Team game (2v2/3-player rotation/ghost), digit flipping, multipliers
- [skins.js](../js/skins.js) - Hole-by-hole competition with carry-over
- [junk.js](../js/junk.js) - Dots system (eagles/birdies/pars) + achievements
- [hilo.js](../js/hilo.js) - Hi/Lo team game with auto-press
- [export.js](../js/export.js) - CSV/email export functionality

### Critical Pattern: Unified Namespace

**ALWAYS use `window.GolfApp` API** (introduced v2.1.0):
```javascript
GolfApp.api.save()                    // Save state
GolfApp.api.recalculateEverything()   // Trigger all game updates
GolfApp.errorHandler.show(msg, tech)  // User-friendly errors
GolfApp.utils.validate(val, 'score')  // Input validation
GolfApp.constants.GAME_CONSTANTS      // All game rules
```

Legacy globals exist for backward compatibility but prefer namespace.

## Key Development Patterns

### 1. Game Module Lifecycle

All games follow this pattern:
```javascript
window.GameName = {
  init() {},           // Setup UI, wire events (called on page load)
  update() {},         // Recalculate when scores change
  compute() {},        // Pure calculation logic (returns data)
  render(data) {}      // Update DOM with computed data
};
```

**When modifying games:** Call `AppManager.recalcAll()` to cascade updates to all games.

### 2. Error Handling (v2.1.0+)

**NEVER** access DOM without null checks:
```javascript
// ❌ WRONG
$('#vegasSection').classList.add('open');

// ✅ CORRECT
const section = $('#vegasSection');
if (section) {
  section.classList.add('open');
} else {
  GolfApp.errorHandler.show('Cannot open game', 'Section not found');
}
```

All public functions have try-catch blocks with `ErrorHandler`.

### 3. Scorecard Calculations

**Net Double Bogey (NDB) System:**
- Max penalty per hole = `par + 2 + strokesReceived`
- "Play off low" handicap allocation (stroke indexes determine where strokes apply)
- Implemented in `Scorecard.calcNDB()` - used by ALL game modules

**When adding score features:** Reuse existing NDB logic from main scorecard.

### 4. State Persistence

Storage uses versioned schema (`v5`):
```javascript
{
  version: 5,
  playerNames: [...],
  handicaps: [...],
  scores: [[...], ...],
  gameOptions: { vegas: {...}, skins: {...} }
}
```

**Migration:** See [MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md). Bump `STORAGE_KEY` and add migration logic in `Storage.load()`.

### 5. PWA Service Worker

[sw.js](../sw.js) uses **network-first** for HTML/JS (aggressive cache busting):
```javascript
// Always update CACHE_VERSION when deploying
const CACHE_VERSION = 'v2.2.0';
```

HTML/JS bypass cache for fresh updates; CSS/images use cache-first.

## Common Tasks

### Adding a New Course

Edit `Config.COURSES` in [index.js](../index.js#L131-L146):
```javascript
COURSES: {
  'course-id': {
    name: 'Display Name',
    pars: [4,4,4,...],      // 18 values
    hcpMen: [7,13,11,...]   // 1-18 (1=hardest)
  }
}
```

### Adding a New Game Module

1. Create `js/newgame.js` with standard API (`init`, `update`, `compute`, `render`)
2. Add `<script src="js/newgame.js">` to [index.html](../index.html)
3. Add section to HTML (use existing games as template)
4. Wire into `AppManager.recalcAll()` in [index.js](../index.js#L483-L530)
5. Add to `GolfApp.games` export

### Modifying Game Logic

Example from [vegas.js](../js/vegas.js):
- `compute()` does pure calculations (team assignments → point spreads)
- `render()` updates DOM (never does calculations)
- Options stored in `localStorage` via `setOptions()`/`getOptions()`

## Testing & Debugging

**No test framework** - manual testing via:
```javascript
GolfApp.debug.getState()        // Dump current state
GolfApp.debug.clearStorage()    // Reset to defaults
GolfApp.debug.testError()       // Test error notifications
```

**Local server required** (for service worker):
```bash
python -m http.server 8000
# or
npx http-server
```

**Browser DevTools:** Service worker updates require hard refresh (Cmd+Shift+R) or "Update on reload" in Application tab.

## Critical Constraints

- **No NPM/build tools** - All code must run directly in browser
- **Vanilla JS only** - No frameworks, no transpiling
- **Mobile-first** - Touch events, responsive tables (dual-table split layout)
- **Offline-capable** - All features work without network
- **1-99 players** - Dynamic table generation, no hardcoded player counts

## Documentation References

- [QUICK_REFERENCE.md](../QUICK_REFERENCE.md) - Complete API reference
- [IMPROVEMENTS.md](../IMPROVEMENTS.md) - v2.1.0 migration details
- [MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md) - Storage schema changes

## Code Style

- **Constants:** UPPER_SNAKE_CASE at module level
- **Functions:** camelCase, verb-first (`calcNetScore`, `renderTable`)
- **Modules:** PascalCase namespaces (`window.Vegas`, `window.Skins`)
- **JSDoc:** Required for all public APIs (added v2.1.0)
- **Error messages:** User-friendly primary, technical secondary
