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

On **Crafts**, every recipe shows three costs: **Buy all** (buy every reagent), **Craft all** (craft every reagent you can, buy the rest) and **Best** (buy or craft each reagent, whichever is cheaper). Click a row to see the three options cheapest first, each with its full reagent tree, and press **Shopping list** on any of them for X crafts: what to buy and where (walking up the AH price levels), what comes from your bags and bank, the craft order, cash needed and expected profit. "Copy as text" puts the list on the clipboard.

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
npm test          # unit tests (engine, decoder, Blizzard client)
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

## Blizzard API (optional): prices without logging in

WoW Forever's auction houses are in Blizzard's Game Data API under the undocumented namespace `dynamic-forever-{region}`. Forever has rulesets instead of realms, so the paths are `/data/wow/ruleset/{id}/auctions/` (house list, trailing slash required), `/data/wow/ruleset/{id}/auctions/{houseId}` (items) and `.../{houseId}/commodities` (ore, bars, herbs).

1. Create a client at [develop.battle.net](https://develop.battle.net/access/clients). The ID and secret are stored only in your browser.
2. In **Settings**, enter them, click **Connect**, pick a house and click **Download and check this house**. Every ruleset lists the same 15 houses, so the app compares the house's prices with your last in-game scan to confirm which one is yours.
3. Click **Use this house**. After that, **Fetch prices from Blizzard** (Import page) or **↻ Fetch AH** (top bar) saves a new scan whenever Blizzard has published newer data (about hourly).

Bags, bank and professions still come from the in-game export.

## Layout

```
addon/FlipExport/    the WoW addon (Core.lua is pure and testable; FlipExport.lua talks to the game)
addon/tests/run.lua  runs the addon with a mocked WoW API
web/scripts/         wago.tools download + transform into public/data/*.json
web/src/engine.ts    cost engine: cheapest of AH / vendor / crafting, recursively
web/src/blizzard.ts  Forever auction-house client (dynamic-forever namespace, rulesets)
web/src/views/       Crafts, Inventory, Changes, Items, Import, Settings
.github/workflows/   build + deploy to GitHub Pages
```

LibDeflate is © Haoqian He, zlib license (see `addon/FlipExport/Libs/LibDeflate/LICENSE.txt`). LibStub is public domain.
