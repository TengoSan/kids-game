# CLAUDE.md

## Project Overview

Kids Game (キッズゲーム) is a collection of educational mini-games for Japanese-speaking young children. It is a static PWA site with zero dependencies — pure HTML, CSS, and vanilla JavaScript. Each game lives in its own directory and is fully self-contained.

**Live site:** Deployed to GitHub Pages via `.github/workflows/pages.yml` on push to `main`.

## Repository Structure

```
/
├── index.html              # Hub page linking to all games
├── .github/workflows/      # GitHub Pages deployment
├── bubble/                  # かずのバブル (Counting Bubbles) — number recognition
├── clock/                   # とけいゲーム (Clock Game) — time reading
├── money/                   # おかねゲーム (Money Game) — Japanese yen currency
├── reading/                 # ことばフラッシュ (Word Flash) — word recognition
├── yomimiru/                # よんでみよう (Reading Practice) — hiragana/katakana
├── math-battle/             # たしざんひきざんバトル (Math Battle) — addition/subtraction RPG
└── seikatsu/                # せいかつリズム (Lifestyle Rhythm) — daily routine habits
```

Each game directory contains:
- `index.html` — the entire game (HTML + CSS + JS in one file)
- `manifest.json` — PWA manifest
- `sw.js` — service worker for offline caching
- Icon files (`icon-192.png`, `icon-512.png`, etc.)

## Tech Stack

- **No build step, no package manager, no dependencies**
- HTML5, CSS3, vanilla ES6+ JavaScript
- Web Audio API for procedural sound effects (no audio files)
- Canvas API (clock game)
- Service Workers for offline support
- localStorage for progress/achievements

## Development

### Running locally

Serve the repo root with any static HTTP server:

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000` to see the hub page.

### Testing

No automated tests. Test manually in a mobile browser or with devtools mobile emulation. Key things to verify:
- Touch interactions and tap target sizes
- Responsive layout on various screen sizes
- Service worker caching (test offline mode)
- Sound effects via Web Audio API
- localStorage persistence across sessions

### Deployment

Push to `main` triggers GitHub Actions → GitHub Pages. No build step — files are uploaded as-is.

## Code Conventions

### Architecture Pattern

Every game follows the same structure:
1. **Single HTML file** containing all markup, styles, and scripts
2. **Screen-based navigation** — screens are `<div>` elements toggled via a `.active` CSS class and a `showScreen(id)` function
3. **Standard game flow:** Title → Level/Mode Select → Gameplay → Results
4. **Collection/achievement system** stored in localStorage

### JavaScript

- `camelCase` for functions and variables (`setupLevels`, `nextQuestion`, `playCorrect`)
- `UPPER_CASE` for constants (`LEVELS`, `TOTAL_Q`, `PATTERNS`)
- DOM access via `document.getElementById()` and `querySelector()`
- Module-level state variables (no classes or modules)
- Event handling via `onclick` attributes and `.addEventListener()`

### CSS

- `kebab-case` for class names (`.btn-answer`, `.bubble-area`, `.question-text`)
- Mobile-first responsive design
- `env(safe-area-inset-*)` for notched devices
- Touch optimizations: `touch-action: manipulation`, `-webkit-tap-highlight-color: transparent`
- Viewport locked: `maximum-scale=1.0, user-scalable=no`

### UI/UX

- All user-facing text is in Japanese (hiragana for young children, some kanji)
- Colorful gradients, large buttons (min 44-60px), encouraging feedback
- Procedural audio via Web Audio API — use `playTone()`, `playSweep()`, `playNoise()` patterns
- Font: `'Rounded Mplus 1c', sans-serif`

## Adding a New Game

1. Create a new directory (kebab-case name)
2. Add `index.html` with the full game (follow existing games as templates)
3. Add `manifest.json` with unique `name`, `short_name`, `start_url`, and icons
4. Add `sw.js` with a unique cache name (`'your-game-v1'`) listing all files to cache
5. Add icon files (`icon-192.png`, `icon-512.png`)
6. Add a link to the hub page (`/index.html`) with a color-coded `.game-link` button

## Important Notes

- Keep games self-contained — no shared libraries or cross-game dependencies
- All audio is procedurally generated; do not add audio files
- Service worker cache names must be unique per game and versioned
- The hub page (`/index.html`) must be updated when adding or removing games
- Commit messages are written in Japanese, following the existing style
