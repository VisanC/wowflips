#!/usr/bin/env node
// Forever Flips MCP server: what to craft and flip on WoW: Forever, worked out from your saved
// game data with the Forever Flips addon's own logic. Read-only.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Flips } from './flips.js';

const flips = new Flips();

const INSTRUCTIONS = `Forever Flips: the player's WoW: Forever (classic-era) crafting and auction house data, worked out with the same logic as the Forever Flips addon's in-game window.

Data is what the game last saved: it updates when the player types /reload in game (or logs out). Check status first: the AH scan time, Auctionator's newest price, the TSM download time. If the data is hours old, say so and suggest a Scan AH + /reload before acting on it.

Money is in gold (0.0523 gold = 5 silver 23 copper); give players gold/silver/copper (5s 23c). Prices on the AH are the newest of the addon's scan, Auctionator and the TSM app's realm data; "price_g" averages the cheapest 3 units when the listings are known (one bait listing can't set it). Sales numbers (region_sold_per_day, region_sale_rate_pct, region_avg_sale_g) come from TSM and cover the whole EU region of WoW: Forever, not just this realm, so a realm sells a fraction of that.

To pick the best craft: use best_crafts (scope "known", then "learnable" for recipes worth learning), weigh profit per craft against how fast it sells (region_sold_per_day, sale rate), how many are already listed (on_ah, competition), the skill colour (orange/yellow still give skill points), and what the player already has (can_make_now). Then craft_plan for the top picks: the parts, buy or craft for each and why, and the shopping list after the player's bags and bank. Don't recommend a craft whose output barely sells or is flooded on the AH. Be concrete: how many to make, what to buy, what it costs, expected profit.

All tools only read. The player queues crafts in game (Crafts tab, right-click a craft).`;

const server = new McpServer({ name: 'forever-flips', version: '0.1.0' }, { instructions: INSTRUCTIONS });

function tool(name, description, shape, run) {
  server.registerTool(name, { description, inputSchema: shape, annotations: { readOnlyHint: true } }, async (args) => {
    try {
      const result = await flips.call(run || name, args || {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: String(e && e.message ? e.message : e) }] };
    }
  });
}

const strategy = z.enum(['best', 'buy', 'craft']).optional().describe('Parts: "best" buys or crafts each, whichever is cheaper (default); "buy" buys every part; "craft" crafts every part it can');
const parts = z.enum(['known', 'profession', 'none']).optional().describe('Which recipes may make the parts (bars, tubes...): "known" ones you know (default), "profession" any in your professions, "none" always buy');

tool('status',
  "Start here. The character, professions and skill, and how fresh each data source is (AH scan, Auctionator, TSM app, bags/bank, the in-game save). Times are unix seconds; 'now' is the current time.",
  {});

tool('best_crafts',
  'Crafts ranked by profit per craft (or another sort), with cost, sell price, margin, region sales per day and sale rate, how many are on the AH, how many you can make from your bags and bank, and the skill colour at your rank. Unknown recipes include how to learn them.',
  {
    profession: z.string().optional().describe('e.g. "Engineering"; default all of yours'),
    scope: z.enum(['known', 'learnable', 'profession', 'all']).optional().describe('"known" recipes you know (default), "learnable" ones in your professions you could learn at your skill, "profession" every recipe of your professions, "all" every recipe'),
    sort: z.enum(['profit', 'margin', 'sold_per_day', 'profit_x_sold']).optional().describe('"profit" per craft (default); "profit_x_sold" profit times region sales per day (capped at 20), a rough "what earns most over time"'),
    min_sold_per_day: z.number().optional().describe('Only items selling at least this many a day in the region'),
    include_unprofitable: z.boolean().optional(),
    strategy, parts,
    limit: z.number().int().optional().describe('Rows to return (default 25)'),
  });

tool('craft_plan',
  'One recipe in detail for a number of crafts: cost, revenue and profit per craft and in total; every part with buy or craft and why (and what the other way would cost); then, after your bags and bank, the crafting steps (parts first) and the shopping list with AH cost walking the listings.',
  {
    recipe: z.string().describe('Recipe name, the item it makes, or spell id'),
    count: z.number().int().optional().describe('How many crafts (default 1)'),
    strategy, parts,
  });

tool('item',
  "An item's prices: AH (price, cheapest listings, source, when seen), Auctionator's two-week median, TSM market/historical and region sales, vendor prices, how many you have, and which recipes make or use it.",
  { item: z.string().describe('Item name (or part of it) or item id') });

tool('deals',
  'Buy-to-resell deals: "vendor" = AH listings cheaper than what a vendor pays (guaranteed profit); "market" = listings well below the usual price (TSM region sale average, else Auctionator median) for items that sell.',
  {
    mode: z.enum(['vendor', 'market']).optional(),
    max_pct: z.number().optional().describe('Market mode: at most this % of the usual price (default 70)'),
    min_profit_g: z.number().optional().describe('Least total profit in gold'),
    limit: z.number().int().optional(),
  });

tool('leveling',
  'The cheapest way to level a profession from your skill to a target: which recipe at each skill range, how many crafts, net cost (negative = makes money), and learning costs.',
  {
    profession: z.string().describe('e.g. "Engineering"'),
    target: z.number().int().optional().describe('Target skill (default your cap)'),
    pool: z.enum(['known', 'trainer', 'all']).optional().describe('Recipes to use: known only, plus trainer recipes (default), or also ones bought on the AH or from vendors'),
  });

tool('queue',
  "The player's in-game craft queue, expanded: crafting steps (parts first) and the shopping list after their bags and bank.",
  {});

tool('sales',
  "The player's auction history from AH mail: income over 7 and 30 days, sell-through, and the best-earning items.",
  { limit: z.number().int().optional() });

server.connect(new StdioServerTransport()).catch((e) => {
  console.error(e);
  process.exit(1);
});
