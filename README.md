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

On **Crafts**, every recipe shows three costs, each with its profit % underneath: **Buy all** (buy every reagent), **Craft all** (craft every reagent you can, buy the rest) and **Best** (buy or craft each reagent, whichever is cheaper; on a tie it crafts from the raw material, e.g. smelts ore rather than buying bars). Click a row to open its plan: one table with every part down to the raw materials, each showing **Buy each** and **Craft each** side by side (the cheaper one underlined in green) and a **Buy / Craft** switch. Pick a preset (cheapest mix, buy all, craft all) or flip any part yourself: crafting a part opens its own parts underneath, and the totals follow. **Shopping list** then gives, for X crafts of that plan: what to buy and where (walking up the AH price levels), what comes from your bags and bank, the craft order, cash needed, expected profit and roughly how many days it takes to sell at the current rate. "Copy as text" puts the list on the clipboard.

Gathering professions (Mining, Herbalism, Skinning, Fishing) are listed too, as "gathered" rows: what one ore, herb, leather or fish sells for, how fast it sells, how many you hold, and whether processing it first (smelting, for example) pays more. Gems, stone and some herbs are marked "bonus": they only drop while gathering something else. Tick **hide gathered** to leave them out. Fishing, Herbalism and Skinning levels need addon 0.2.0 or newer, the Sales tab and Auctionator prices 0.3.0 (download the zip again from the Import page).

### Deals, Learn and Leveling

- **Deals**: *vendor flips* (listings cheaper than a vendor pays: buy and vendor them) and listings *under market price* (well below TradeSkillMaster's region price for items that sell at least N a day), with profit after the AH cut. Set your own limits; tick the box to get a browser notification when new deals turn up after an hourly fetch.
- **Learn levels**: Forever's game tables give every recipe a learn level of 1. If you use the [Recipe Master](https://www.curseforge.com/wow/addons/recipe-master) addon, pick its folder once on the Import page (`World of Warcraft\_forever_\Interface\AddOns\RecipeMaster`): the site reads its recipe database in your browser and keeps it there (nothing is uploaded, and none of it is in this repo). That gives every recipe's real learn level, its skill-up levels (orange, yellow, green, grey) and its vendor price. Without it, the site uses the recipe item's required skill, or your trainer's list if the addon saw it; other trainer recipes show "≈" with their yellow level as a guess.
- **Learn**: recipes you don't know yet in your professions, with profit per craft at today's prices, the skill needed, its skill-up levels, the cheapest way to learn it (trainer, vendor, or the recipe on the AH) and how many crafts it takes to pay that back. Click one for its full buy-or-craft plan.
- **Leveling**: every recipe that can give a point at your current skill (with its chance and cost per point), and the cheapest way from your skill to a target. For every skill point it picks the recipe with the lowest expected cost per point (orange always gives a point; from yellow to grey the chance falls to zero), counting what the products sell back for (vendor, AH, or nothing). Shows the steps, expected crafts, cost, and the materials for the whole plan.

### Your sales, and Auctionator

- **Auctionator**: if you have it, `/flip export` includes its price database: today's lowest price and quantity listed for every item it has seen (its *summary scan* covers the whole AH without Blizzard's 15-minute full-scan limit, and every search you make adds to it) plus up to 21 days of daily price history. You don't need `/flip scan` at all; use Auctionator's own scan buttons. Its posting history comes along too.
- **Sales** tab: the addon reads your AH mails when you open the mailbox (sales, purchases, expired and cancelled auctions), so open it **before** taking the gold, then export. It also counts your crafts. The tab shows what you earned and spent (last 7 and 30 days), gold per day, sell-through, and per item: units sold, average price, earnings, expired and cancelled auctions, units crafted, today's crafting cost and your profit per unit. Click an item for its price history on your AH (from Auctionator) with your own sales on top; the Items page shows the same chart.

### Sales per day

Two sources, shown side by side:

- **TradeSkillMaster** publishes free region data for WoW Forever (sold per day, share of listings that sell, average sale price) as [public CSV files](https://tradeskillmaster.com/public-data). The site downloads the EU and US files every time it builds (every 6 hours), so **Sold/day** in Crafts, the sales line on each item and the **Sells fastest** list on the Changes page work right away. These numbers cover the whole region (all rulesets and both factions) and come from TSM users' sales. Prices from TradeSkillMaster.
- **Your own auction house**: with the Blizzard API set up, the site fetches your house as soon as Blizzard publishes a new snapshot (about once an hour) while it is open, and compares each snapshot with the previous one. Auctions that were partly bought, or vanished while they still had time left and no cheaper one was still listed, count as sold. These numbers are specific to your ruleset and faction but need a day or so of hourly data, and for gear they can include cancelled auctions.

## Where the numbers come from

Each question has one source that counts; nothing is averaged across sources.

- **What's on the AH now (prices to buy and sell at):** the newest full scan of your auction house: your in-game scan (addon) or a Blizzard API fetch, whichever is newer. Newer partial data then replaces it item by item, oldest first: a few Auctionator searches, and TSM's scan of your auction house (about every 3 hours; uses TSM's "recent" value as the price). The price is the average of the cheapest 3 on sale (Settings).
- **How much sells:** TSM's region numbers (sold per day, sale rate, average sale price; all rulesets and both factions, daily) and the site's own count from consecutive hourly Blizzard fetches (your auction house only). Both are shown side by side.
- **What you actually earned:** your AH mail, read by the addon (the Sales tab).
- **Recipes:** game data from wago.tools; learn levels and skill-up levels from Recipe Master if loaded, else the trainer lists the addon saw, else the recipe item's required skill.
- **Vendor prices:** game data, plus prices the addon saw at vendors.

The site rebuilds every 30 minutes to pick up new TSM files.

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
