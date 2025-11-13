# Golf Scorecard PWA

A Progressive Web App for tracking golf scores with multiple simultaneous side games. Built with vanilla JavaScript, optimized for mobile and desktop use.

## 🏌️ Features

### Core Scorecard
- **Dynamic Player Management**: Support for 1-99 players with add/remove functionality
- **Course Handicap System**: Full support including negative handicaps
- **Net Scoring**: Net Double Bogey (NDB) capping with "play off low" stroke allocation
- **Multiple Courses**: Pre-configured courses (Manito, Dove Canyon) with easy addition of new courses
- **Auto-Advance Input**: Automatically focuses next input after score entry
- **CSV Import/Export**: Easy score entry and data portability

### Side Games (All Simultaneous)
- **Vegas**: Team game with multipliers and digit flipping
- **Skins**: Classic carry-over competition with half-pops mode
- **Junk (Dots)**: Points for eagles/birdies/pars with achievements
- **Banker**: Points-per-match (stub - to be implemented)
- **Banker-Vegas**: Combined game (stub - to be implemented)

### PWA Features
- **Offline Support**: Full functionality without internet connection
- **Service Worker Caching**: Fast load times and offline access
- **Auto-Updates**: Background updates with version management
- **Responsive Design**: Optimized for phone, tablet, and desktop
- **Dark/Light Theme**: Toggle between themes with persistence
- **Add to Home Screen**: Install as native-like app

## 📁 Project Structure

```
golfGames/
├── index.html              # Main HTML, styles, game sections
├── index.js                # Core scorecard logic (1,474 lines)
├── sw.js                   # Service worker (v1.3.7)
├── manifest.json           # PWA manifest
├── js/
│   ├── vegas.js           # Vegas game module (568 lines)
│   ├── skins.js           # Skins game module (377 lines)
│   ├── junk.js            # Junk game module (487 lines)
│   ├── banker.js          # Banker stub (38 lines)
│   └── banker-vegas.js    # Banker-Vegas stub (37 lines)
├── images/                 # Icons and assets
└── stylesheet/             # CSS files
```

## 🎮 Game Rules

### Vegas
Team-based game combining scores into 2-digit numbers.

**Modes:**
- **Standard (4 players)**: 2v2 fixed partnerships
- **Rotation (3 players)**: Each player partners with ghost (par) for 6 holes
- **Ghost (2 players)**: Both players partner with ghost

**Scoring:**
- Scores combined low-to-high (e.g., 4+5 = "45")
- Lower number wins: points = (higher - lower) × multiplier
- Birdie: 2× multiplier (optional)
- Eagle: 3× multiplier (optional)
- Digit flip on opponent birdie+ (45 → 54)

### Skins
Classic hole-by-hole competition.

**Rules:**
- Lowest net score wins each hole
- Ties carry forward (pot accumulates)
- Final carry distributed evenly

**Options:**
- Standard or half-pops handicapping
- NET or GROSS scoring
- Configurable buy-in

### Junk (Dots)
Points for good scoring.

**Base Points:**
- Eagle or better: 4 dots
- Birdie: 2 dots
- Par: 1 dot
- Bogey+: 0 dots

**Achievements (Bonus Points):**
- Hogan (5 pts): Birdie+ on all par 3s
- Sandy (3 pts): Up and down from bunker
- Sadaam (2 pts): Out of bunker in one
- Pulley (1 pt): Par after penalty
- Triple (10 pts): 3+ consecutive birdies

## 🏗️ Architecture

### Modular Design
The application uses a clean modular architecture with separation of concerns:

**Core (index.js)**
- `Config`: Course database, constants
- `Utils`: DOM helpers, math utilities
- `AppManager`: Coordinates game recalculations
- `Storage`: localStorage with versioning
- `Scorecard`: Table building, calculations, player/course management

**External Modules**
Each game is a self-contained module exposing a clean API via `window.[GameName]`:
- Independent calculation logic
- Own DOM manipulation
- State management (save/load)
- No cross-dependencies

### Key Design Patterns
- **IIFE Modules**: Encapsulation with controlled global exposure
- **Play Off Low**: Handicap system for fair competition
- **NDB Capping**: Prevents runaway bad holes
- **Debounced Saves**: Auto-save with 300ms debounce
- **Progressive Enhancement**: Works without JavaScript for basic HTML

## 🚀 Getting Started

### Installation
1. Clone the repository
2. Serve files with any HTTP server (required for service worker)
3. Access via browser

### Development
```bash
# Simple Python server
python -m http.server 8000

# Or Node.js
npx http-server
```

### Production
Deploy to any static hosting service:
- GitHub Pages
- Netlify
- Vercel
- CloudFlare Pages

## 🔧 Adding a New Course

Edit `index.js` in the `Config.COURSES` object:

```javascript
COURSES: {
  'yourcourse': {
    name: 'Your Course Name',
    pars: [4,4,4,5,3,4,4,3,4, 4,4,3,5,5,4,4,3,4],
    hcpMen: [7,13,11,15,17,1,5,9,3, 10,2,12,14,18,4,6,16,8]
  }
}
```

Where:
- `pars`: Par for holes 1-18 (exactly 18 values)
- `hcpMen`: Handicap index 1-18 (1=hardest, 18=easiest)

## 📱 Browser Support

**Recommended:**
- Chrome 90+
- Safari 14+
- Firefox 88+
- Edge 90+

**Required Features:**
- ES6+ JavaScript
- Service Workers
- localStorage
- CSS Grid
- Flexbox

## 🤝 Contributing

Contributions welcome! Areas for contribution:
- Implement Banker game logic
- Implement Banker-Vegas game logic
- Add new courses
- UI/UX improvements
- Additional game modes
- Bug fixes

## 🎯 Roadmap

- [ ] Implement Banker game
- [ ] Implement Banker-Vegas game
- [ ] Add stroke play leaderboard
- [ ] Match play head-to-head
- [ ] Statistics and history tracking
- [ ] Multi-round tournament support
- [ ] Shareable scorecards (QR/link)
- [ ] Real-time multiplayer sync

## 📊 Stats

- **Total Lines**: ~3,018 across all modules
- **Core**: 1,474 lines
- **Vegas**: 568 lines
- **Junk**: 487 lines
- **Skins**: 377 lines
- **Stubs**: 75 lines
- **Service Worker**: v1.3.7

---

Built with ⛳ for golfers who love side games
