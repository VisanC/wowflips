// Shopping list: turn "craft X of this recipe" into what to buy, what to take
// from your bags/bank and which crafts to do, following an Engine's strategy.

import type { Engine, Market } from './engine';
import type { GameData } from './gamedata';
import type { Recipe } from './types';

export interface BuyLine {
  item: number;
  qty: number;
  source: 'ah' | 'vendor' | 'none';
  total: number; // copper, walking up the AH price levels where known
  avgUnit: number;
  listed?: number; // AH quantity available
  estimated: boolean; // needed more than the known cheap price levels
}

export interface StockLine {
  item: number;
  qty: number;
  value: number; // at the cheapest market price
}

export interface CraftStep {
  recipe: Recipe;
  crafts: number;
  makes: number;
  depth: number; // 0 = the item you asked for; higher = done earlier
}

export interface ShoppingList {
  recipe: Recipe;
  crafts: number;
  buy: BuyLine[];
  fromStock: StockLine[];
  steps: CraftStep[]; // in the order to do them
  cashNeeded: number;
  stockValue: number;
  revenue: number; // selling everything made at today's price
  profit: number; // revenue - cash - value of your own items used
  missing: number[]; // items with no price and no recipe
}

/** Cost of buying `qty` from the AH, using the listed price levels (cheapest first). */
export function ahBuyCost(market: Market, item: number, qty: number): { total: number; estimated: boolean } {
  const row = market.ah.get(item);
  if (!row) return { total: Infinity, estimated: true };
  let left = qty;
  let total = 0;
  let last = row.min;
  for (const [price, available] of row.levels) {
    const take = Math.min(left, available);
    total += take * price;
    left -= take;
    last = price;
    if (left <= 0) break;
  }
  // Beyond the levels we know, assume the last known price (optimistic).
  if (left > 0) total += left * last;
  return { total, estimated: left > 0 };
}

export function buildShoppingList(
  data: GameData,
  market: Market,
  engine: Engine,
  recipe: Recipe,
  crafts: number,
  opts: { inventory?: Map<number, number>; cut: number },
): ShoppingList {
  const stock = new Map(opts.inventory ?? []);
  const used = new Map<number, number>();
  const toBuy = new Map<number, number>();
  const steps = new Map<number, CraftStep>();

  const addCraft = (r: Recipe, n: number, depth: number, path: Set<number>) => {
    const step = steps.get(r.spell) ?? { recipe: r, crafts: 0, makes: 0, depth };
    step.crafts += n;
    step.makes = step.crafts * r.qty;
    step.depth = Math.max(step.depth, depth);
    steps.set(r.spell, step);
    for (const [item, count] of r.reagents) need(item, n * count, depth + 1, path);
  };

  const need = (item: number, qty: number, depth: number, path: Set<number>) => {
    const have = stock.get(item) ?? 0;
    const take = Math.min(have, qty);
    if (take > 0) {
      stock.set(item, have - take);
      used.set(item, (used.get(item) ?? 0) + take);
      qty -= take;
    }
    if (qty <= 0) return;
    const src = engine.unitCost(item, path);
    if (src.kind === 'craft') {
      addCraft(src.recipe, Math.ceil(qty / src.recipe.qty), depth, new Set(path).add(src.recipe.spell));
    } else {
      toBuy.set(item, (toBuy.get(item) ?? 0) + qty);
    }
  };

  addCraft(recipe, crafts, 0, new Set([recipe.spell]));

  const missing: number[] = [];
  const buy: BuyLine[] = [...toBuy.entries()].map(([item, qty]) => {
    const src = engine.marketSource(item);
    if (src.kind === 'vendor') {
      return { item, qty, source: 'vendor', total: src.unit * qty, avgUnit: src.unit, estimated: false };
    }
    if (src.kind === 'ah') {
      const { total, estimated } = ahBuyCost(market, item, qty);
      return { item, qty, source: 'ah', total, avgUnit: total / qty, listed: market.ah.get(item)?.qty, estimated };
    }
    missing.push(item);
    return { item, qty, source: 'none', total: 0, avgUnit: 0, estimated: true };
  });
  buy.sort((a, b) => b.total - a.total);

  const fromStock: StockLine[] = [...used.entries()].map(([item, qty]) => {
    const unit = engine.marketSource(item).unit;
    return { item, qty, value: Number.isFinite(unit) ? unit * qty : 0 };
  });

  const ordered = [...steps.values()].sort((a, b) => b.depth - a.depth);
  const cashNeeded = buy.reduce((s, b) => s + b.total, 0);
  const stockValue = fromStock.reduce((s, x) => s + x.value, 0);
  const product = data.items.get(recipe.out);
  const ah = market.ah.get(recipe.out);
  const unitRevenue = Math.max(ah ? ah.min * (1 - opts.cut) : 0, product?.sell ?? 0);
  const revenue = unitRevenue * recipe.qty * crafts;

  return {
    recipe,
    crafts,
    buy,
    fromStock,
    steps: ordered,
    cashNeeded,
    stockValue,
    revenue,
    profit: revenue - cashNeeded - stockValue,
    missing,
  };
}

/** Plain-text version for pasting anywhere (Discord, notes, Auctionator search). */
export function shoppingListText(list: ShoppingList, data: GameData, label: string, money: (c: number) => string): string {
  const name = (id: number) => data.items.get(id)?.name ?? `Item ${id}`;
  const lines = [`${label}: ${list.crafts} × ${list.recipe.name}`, ''];
  if (list.buy.length) {
    lines.push('Buy:');
    for (const b of list.buy) {
      const where = b.source === 'vendor' ? 'vendor' : b.source === 'ah' ? 'AH' : 'no price!';
      lines.push(`  ${b.qty} × ${name(b.item)} (${where}${b.source !== 'none' ? `, ~${money(b.total)}` : ''})`);
    }
  }
  if (list.fromStock.length) {
    lines.push('From bags/bank:');
    for (const s of list.fromStock) lines.push(`  ${s.qty} × ${name(s.item)}`);
  }
  lines.push('Craft, in this order:');
  for (const s of list.steps) lines.push(`  ${s.crafts} × ${s.recipe.name}${s.recipe.qty > 1 ? ` (makes ${s.makes})` : ''}`);
  lines.push('', `Cash needed: ~${money(list.cashNeeded)}`, `Expected sale: ~${money(list.revenue)}`, `Profit: ~${money(list.profit)}${list.cashNeeded + list.stockValue > 0 ? ` (${list.profit >= 0 ? '+' : ''}${Math.round((list.profit / (list.cashNeeded + list.stockValue)) * 100)}%)` : ''}`);
  return lines.join('\n');
}
