# Forever Flips MCP

Lets Claude read your WoW: Forever crafting and auction data and decide what to craft: the
Forever Flips addon's saved data (scans, listing checks, queue, bags, bank, AH mail), Auctionator's
price database and the TSM app's AuctionDB data, worked out with the addon's own logic (its
`Logic/*.lua`, loaded from your installed addon and run in Lua 5.4 through wasmoon). Read-only.

## Install (Claude Desktop)

1. Download `forever-flips.mcpb` and double-click it (or Settings → Extensions → Install).
2. Check the WoW: Forever folder it asks for (default `C:\Program Files (x86)\World of Warcraft\_forever_`).
3. Needs the Forever Flips addon 0.7.5 or later (it saves your bags and gold on /reload).

Ask things like "what should I craft right now?", "plan 20 Fire Goggles", "cheapest way to 225
Engineering". The data is what the game last saved: `/reload` in game (after a Scan AH) to update it.

## Tools

| Tool | What |
|------|------|
| `status` | Character, professions, how fresh each data source is |
| `best_crafts` | Crafts ranked by profit (or margin, sales speed), with region sales, competition, skill colour, what you can make now; `scope: learnable` for recipes worth learning |
| `craft_plan` | One recipe x N: parts (buy or craft, and why), steps and shopping list after your bags and bank |
| `item` | An item's prices from every source, your stock, recipes that make or use it |
| `deals` | Vendor flips and listings under the usual price |
| `leveling` | Cheapest path to a skill level |
| `queue` | The in-game craft queue, expanded |
| `sales` | Your auction income and best sellers |

## Develop

    npm install
    npm test                       # made-up WoW folder: CBOR, TSM base 32, every tool
    WOW_DIR=... node server/index.js   # stdio MCP server
    npm run pack                   # dist/forever-flips.mcpb

`WOW_DIR` is the `_forever_` folder; `FLIPS_ADDON_DIR` overrides where the addon's Lua is read
from; `FLIPS_CHARACTER` picks a character (default: the one played last).
