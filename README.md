# Forever Flips

Find profitable crafts and auction-house flips in **WoW: Forever**.

- **`addon/FlipExport`**: a small in-game addon. It scans the Auction House and remembers your bags, bank, known recipes and vendor prices, then exports everything as one copy-paste string.
- **`web/`**: a static web app (Vite + TypeScript). Paste the string and it shows what every craft costs and earns, including chains like ore → bar → tube → rifle, vendor-bought reagents, what you can craft from your bags and bank, buyouts between scans, and price history.

Game data (items, recipes, vendor prices) comes from the WoW Forever client tables on [wago.tools](https://wago.tools) (branch `wowf`). It is downloaded when the site is built, never by your browser. Your scans stay in your browser (IndexedDB) and are never uploaded anywhere.

## Use it

1. Download `FlipExport.zip` from the site's Import page and unzip it into your WoW Forever `Interface/AddOns` folder.
2. In game:
   - Open your bank and each profession window once (the addon remembers them).
   - At the Auction House type `/flip scan`. Blizzard allows one full scan per 15 minutes.
   - Type `/flip export`, press Ctrl+C.
   - `/flip status` shows what has been captured.
3. On the site, go to **Import** and paste.

## Host it on GitHub Pages (free)

1. Create a **public** repository on GitHub, for example `wow-flips`. (Pages from private repos needs a paid plan.)
2. Push this folder to it:
   ```sh
   git init -b main
   git add .
   git commit -m "Forever Flips"
   git remote add origin https://github.com/<you>/wow-flips.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Go to the **Actions** tab. The "Build and deploy" run takes about a minute (re-run it if it started before step 3). The site is then at `https://<you>.github.io/wow-flips/`.

The workflow runs on every push and once a day, so new Forever builds on wago.tools are picked up automatically. GitHub pauses scheduled workflows in repos with no activity for 60 days; re-enable it in the Actions tab if that happens.

## Develop locally

```sh
cd web
npm install
npm run data      # download game data into public/data (needs internet)
npm run dev       # http://localhost:5173
npm test          # unit tests (engine, decoder)
```

To test the addon's export outside the game (needs Lua 5.1):

```sh
lua5.1 addon/tests/run.lua 60000 12000 > export.txt   # mocked WoW API, 60k fake auctions
```

## Things to verify in game (first run)

The addon was tested against a mocked WoW API, not the real Forever client. If something is off, `/flip status` will usually show it:

- **AH scan:** `/flip scan` uses `C_AuctionHouse.ReplicateItems`. Check that ores and bars (stackable items) show up in the scan, not only gear.
- **Professions:** after opening a profession window, `/flip status` should list it with a recipe count.
- **Bank:** after opening the bank, `/flip status` should show "bank: 0 min ago".
- **Export window:** the string is roughly 100–300 KB, so Ctrl+A / Ctrl+C can take a second.

## Blizzard API (optional)

Settings has a probe that checks whether Blizzard's Game Data API publishes Forever's auction house. Create a client at [develop.battle.net](https://develop.battle.net/access/clients); the ID and secret are stored only in your browser. If a Forever namespace answers, an hourly GitHub Action could fetch prices while you're offline (not built yet).

## Layout

```
addon/FlipExport/    the WoW addon (Core.lua is pure and testable; FlipExport.lua talks to the game)
addon/tests/run.lua  runs the addon with a mocked WoW API
web/scripts/         wago.tools download + transform into public/data/*.json
web/src/engine.ts    cost engine: cheapest of AH / vendor / crafting, recursively
web/src/views/       Crafts, Inventory, Changes, Items, Import, Settings
.github/workflows/   build + deploy to GitHub Pages
```

LibDeflate is © Haoqian He, zlib license (see `addon/FlipExport/Libs/LibDeflate/LICENSE.txt`). LibStub is public domain.
