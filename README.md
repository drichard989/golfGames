# Golf Games

Current web app version: v3.1.46

Golf Games is a mobile-first progressive web app for live golf scoring with multiple side games and optional cloud live sharing.

## Highlights

- Dual-pane scorecard with pinned player and CH columns
- Handicap modes: Gross, Play Off Low, and Raw Handicap
- Net Double Bogey capping integrated across game calculations
- Simultaneous side games: Junk, Skins, Vegas, Hi-Lo, Banker, Wolf
- Mobile score-entry bottom sheet and game-specific mobile sheets
- Cloud live sharing with edit/view codes, QR share, and QR join
- Snapshot review/restore workflow for live cloud sessions
- Offline-friendly PWA behavior with service worker cache management

## Current Game Modules

- Junk: dots plus achievements, standings, and per-hole breakdown
- Skins: gross/net modes, carryover, half-pop support
- Vegas: team scoring modes, multipliers, and rotations
- Hi-Lo: team winner tracking and hole-by-hole summaries
- Banker: per-hole banker assignment and betting settlement
- Wolf: full 4-player Wolf flow with partner/lone/blind decisions

## Live Sharing

Cloud sharing supports:

- Create live session
- Join by edit/view code
- Join by QR scan
- Share edit/view links and QR
- Viewer lock mode for read-only sessions
- Live snapshots with review and restore to current

Setup details are in [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).

## Architecture

No build step. Vanilla JavaScript modules loaded directly from [index.html](./index.html).

- Core app state and scorecard logic: [index.js](./index.js)
- Game modules: [js](./js)
- Styling: [stylesheet](./stylesheet)
- Service worker: [sw.js](./sw.js)

Primary public namespace is window.GolfApp, including:

- `GolfApp.api` for common app actions
- `GolfApp.scorecard` for scorecard build and calculation internals
- `GolfApp.appManager` for cross-game recalculation orchestration

## Project Layout

```text
golfGames/
  index.html
  index.js
  sw.js
  manifest.json
  js/
    cloudsync.js
    score-sheet.js
    junk.js
    junk-sheet.js
    skins.js
    vegas.js
    hilo.js
    banker.js
    banker-sheet.js
    wolf.js
    wolf-sheet.js
    export.js
    firebase-config.js
    qrcode.js
  stylesheet/
    main.css
    junk.css
    banker.css
    score-sheet.css
    wolf.css
```

## Quick Start

1. Clone this repository.
2. Run a local web server from repo root.
3. Open the app in a browser.

Example:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/index.html
```

## Development Notes

- Service worker version and cache key are managed in [sw.js](./sw.js).
- CSS asset query versions in [index.html](./index.html) are used for cache busting.
- The app is optimized for touch/mobile first, then desktop.

### Cache Versioning Policy (Strict)

- Do not manually edit CACHE_VERSION or ?v= query tokens.
- Pre-commit hook auto-bumps versions and stages [sw.js](./sw.js) + [index.html](./index.html).
- Pre-commit and pre-push both run a strict sync check and fail if versions drift.
- Ensure hooks are installed with: `npm run hooks:install`.

## Documentation

- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
- [IMPROVEMENTS.md](./IMPROVEMENTS.md)
- [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
- [FIREBASE_SETUP.md](./FIREBASE_SETUP.md)
- [PWA_SETUP.md](./PWA_SETUP.md)
- [TEST_README.md](./TEST_README.md)

## Contributing

This repository is proprietary. See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution and IP terms.

## License

This project is proprietary and distributed under an All Rights Reserved license.

See [LICENSE](./LICENSE) for full terms.

- **Total Lines**: ~3,018 across all modules
- **Core**: 1,474 lines
- **Vegas**: 568 lines
- **Junk**: 487 lines
- **Skins**: 377 lines
- **Stubs**: 75 lines
- **Service Worker**: v1.3.7

---

Built with ⛳ for golfers who love side games
