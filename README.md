# PBscrape - PokéBonk Offline Archive & Scraper

Complete offline mirror, reverse-engineered client-side bundle, scraper, and local offline backend emulator for [PokéBonk](https://pokebonk.com).

## Features

- **100% Offline Gameplay**: Play the full game locally without any connection to `api.pokebonk.com`.
- **Offline Backend Emulator (`offline-api.js`)**:
  - Intercepts and handles all backend API routes (`/auth/*`, `/profile/*`, `/lab/*`, `/shop/*`, `/runs/*`, `/quests/*`, `/tasks/*`, etc.).
  - Bypasses Cloudflare Turnstile bot checks cleanly.
  - Automatically persists saves to local disk (`save/profile.json`) and browser `localStorage`.
  - **In-game Offline Toolbox (`F9`)**: Press **`F9`** anytime in-game to toggle an offline toolbox with quick unlocks (All 151 Pokémon, maps, Oak's Lab, skins), currencies (+10k Stardust, +25 Bonkoins), and save export/import.
- **Local Server (`server.mjs`)**:
  - Zero-dependency Node.js HTTP static server on `http://localhost:3000`.
  - Syncs save state with local disk storage.
- **Complete Asset Library**:
  - All 88 3D `.glb` environment models, props, shrines, and altars in `assets/models/`.
  - All 11 biomes in `assets/env/` (`forest`, `coast`, `desert`, `glacier`, `volcano`, `tower`, etc.).
  - 8-directional PMD SpriteCollab sprite sheets in `assets/pmd/` and `assets/pmd-shiny/`.
  - All item icons, UI icons, and audio (`.ogg` music tracks and cries).
- **One-Click Updaters**:
  - Automatically re-scrapes updated bundles, hashes, databases, and assets when the live game receives an update.

---

## Quick Start (Playing Offline)

### Windows
Double-click `play.bat` or run:
```powershell
node server.mjs
```
Then open [http://localhost:3000](http://localhost:3000) in any modern browser (Chrome, Edge, Brave, Firefox).

Press **`F9`** in-game at any point to open the Offline Toolbox.

---

## Updating the Game

If PokéBonk receives an update in the future, you can update your local files with one command or click:

### Windows
Double-click `update.bat` or run:
```powershell
node scripts/update_game.mjs
```
To also check/download the entire Pokédex (Gens 1–9, Pokémon #1–1025):
```powershell
node scripts/update_game.mjs --all-dex
```

---

## Directory Overview

```text
├── assets/                  # 3D models (.glb), PMD sprites, biomes, music, JS/CSS bundles
├── data/                    # pokemon.json, sprites.json, moves.json, items.json, i18n
├── scripts/
│   ├── download_assets.mjs  # Asset scraper with concurrency & retry handling
│   └── update_game.mjs      # Full game version & hash updater
├── offline-api.js           # Local offline backend replacement & F9 toolbox
├── server.mjs               # Node.js HTTP server + disk save sync
├── play.bat                 # One-click game launcher
└── update.bat               # One-click update script
```
