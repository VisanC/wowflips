// Price engine: what an item really costs you, and what a craft really earns.
//
// An item's cost is the cheapest of:
//   - buying it on the AH (lowest unit price in the latest scan)
//   - buying it from a vendor (known vendor reagents, or prices the addon saw)
//   - crafting it, where each reagent is costed the same way (recursively)
// Crafting is only considered through recipes allowed by the options
// (your known recipes by default), and never loops back into itself.
//
// Strategies for sub-components (the top recipe itself is always crafted):
//   best  - cheapest of buying or crafting, decided per item (the default)
//   buy   - buy every reagent, never craft sub-components
//   craft - craft every reagent you can, buy only what can't be crafted

import type { GameData } from './gamedata';
import type { AhRow, Recipe } from './types';

export type CraftMode = 'known' | 'all' | 'none';
/** Costs this close (in copper) count as equal. */
const TIE = 0.5;

export type Strategy = 'best' | 'buy' | 'craft';

export const STRATEGY_LABEL: Record<Strategy, string> = {
  best: 'Best mix',
  buy: 'Buy everything',
  craft: 'Craft everything',
};

export interface Market {
  ah: Map<number, AhRow>;
  vendor: Map<number, number>; // unit price in copper
}

export interface EngineOptions {
  cut: number; // AH cut, e.g. 0.05
  craftMode: CraftMode; // which recipes may be used for sub-components
  known: Set<number>; // spell ids you know
  strategy?: Strategy; // default 'best'
  /** Per-item choices that override the strategy (the user flipped a part to buy or craft). */
  overrides?: Map<number, 'buy' | 'craft'>;
}

export type Source =
  | { kind: 'ah'; unit: number }
  | { kind: 'vendor'; unit: number }
  | { kind: 'craft'; unit: number; recipe: Recipe; parts: Part[] }
  | { kind: 'none'; unit: number };

export type CraftSource = Extract<Source, { kind: 'craft' }>;

/** Why an item is bought or crafted. saving = per unit, the other way minus the chosen way (negative: the plan costs more). */
export interface Choice {
  buy: Source;
  craft?: CraftSource;
  pick: 'buy' | 'craft' | 'none';
  reason: 'cheaper' | 'tie-craft' | 'tie-buy' | 'plan' | 'no-recipe' | 'not-sold' | 'no-price';
  saving: number;
}

export interface Part {
  item: number;
  count: number;
  source: Source;
}

export interface CraftEval {
  recipe: Recipe;
  cost: number; // per craft
  parts: Part[];
  complete: boolean; // every reagent has a price
  ahUnit?: number; // lowest AH unit price of the product
  ahQty: number;
  vendorUnit: number; // vendor sell price of the product
  revenue: number; // per craft, best of AH (after cut) or vendor
  channel: 'ah' | 'vendor';
  profit: number; // per craft
  margin: number; // profit / cost
  craftableNow: number; // from your bags + bank, direct reagents only
}

const NONE: Source = { kind: 'none', unit: Infinity };

export class Engine {
  private memo = new Map<number, Source>();

  constructor(
    private data: GameData,
    private market: Market,
    private opts: EngineOptions,
  ) {}

  private recipeAllowed(r: Recipe): boolean {
    if (this.opts.craftMode === 'none') return false;
    if (this.opts.craftMode === 'all') return true;
    return this.opts.known.has(r.spell);
  }

  get strategy(): Strategy {
    return this.opts.strategy ?? 'best';
  }

  /** Cheapest way to buy one unit of `item` (AH or vendor), ignoring crafting. */
  marketSource(item: number): Source {
    let best: Source = NONE;
    const ah = this.market.ah.get(item);
    if (ah && ah.min > 0) best = { kind: 'ah', unit: ah.min };
    const vendor = this.market.vendor.get(item);
    if (vendor !== undefined && vendor < best.unit) best = { kind: 'vendor', unit: vendor };
    return best;
  }

  /** Cheapest way to craft one unit, with reagents got this engine's way; undefined if no usable recipe has prices. */
  craftSource(item: number, path: Set<number> = new Set()): CraftSource | undefined {
    let crafted: CraftSource | undefined;
    for (const r of this.data.recipesByOutput.get(item) ?? []) {
      if (!this.recipeAllowed(r) || path.has(r.spell)) continue;
      const next = new Set(path).add(r.spell);
      const { cost, parts, complete } = this.reagentCost(r, next);
      if (!complete) continue;
      const unit = cost / r.qty;
      if (!crafted || unit < crafted.unit) crafted = { kind: 'craft', unit, recipe: r, parts };
    }
    return crafted;
  }

  /** How to get one unit of `item` under this engine's strategy. */
  unitCost(item: number, path: Set<number> = new Set()): Source {
    const cached = this.memo.get(item);
    if (cached) return cached;

    const bought = this.marketSource(item);
    const mode = this.opts.overrides?.get(item) ?? this.strategy;
    let best: Source = bought;
    // Buying wins in "buy" mode, unless nobody sells it.
    if (mode !== 'buy' || !Number.isFinite(bought.unit)) {
      const crafted = this.craftSource(item, path);
      // On a tie (within half a copper) craft from the cheaper raw material, e.g. smelt ore rather than buy bars.
      if (crafted && (mode === 'craft' || crafted.unit <= bought.unit + TIE)) best = crafted;
    }

    // Only memoize results computed outside a crafting chain; inside one,
    // the result can depend on which recipes are excluded by `path`.
    if (path.size === 0) this.memo.set(item, best);
    return best;
  }

  /** Both ways to get one unit, which one this strategy picks, and why. */
  explain(item: number, chosen: Source = this.unitCost(item)): Choice {
    const buy = this.marketSource(item);
    const craft = chosen.kind === 'craft' ? chosen : this.craftSource(item);
    const canBuy = Number.isFinite(buy.unit);
    const pick: Choice['pick'] = chosen.kind === 'craft' ? 'craft' : canBuy ? 'buy' : 'none';
    let reason: Choice['reason'];
    if (pick === 'none') reason = 'no-price';
    else if (!craft) reason = 'no-recipe';
    else if (!canBuy) reason = 'not-sold';
    else if (Math.abs(craft.unit - buy.unit) <= TIE) reason = pick === 'craft' ? 'tie-craft' : 'tie-buy';
    else if (pick === 'craft') reason = craft.unit < buy.unit ? 'cheaper' : 'plan';
    else reason = buy.unit < craft.unit ? 'cheaper' : 'plan';
    const other = pick === 'craft' ? buy.unit : craft?.unit;
    return { buy, craft, pick, reason, saving: other !== undefined && Number.isFinite(other) ? other - chosen.unit : 0 };
  }

  private reagentCost(r: Recipe, path: Set<number>) {
    let cost = 0;
    let complete = true;
    const parts: Part[] = [];
    for (const [item, count] of r.reagents) {
      const source = this.unitCost(item, path);
      if (!Number.isFinite(source.unit)) complete = false;
      else cost += source.unit * count;
      parts.push({ item, count, source });
    }
    return { cost, parts, complete };
  }

  evaluate(r: Recipe, inventory: Map<number, number> = new Map()): CraftEval {
    const { cost, parts, complete } = this.reagentCost(r, new Set([r.spell]));
    const ah = this.market.ah.get(r.out);
    const item = this.data.items.get(r.out);
    const vendorUnit = item?.sell ?? 0;
    const ahNet = ah ? ah.min * (1 - this.opts.cut) : 0;
    const channel: 'ah' | 'vendor' = ahNet >= vendorUnit && ah ? 'ah' : 'vendor';
    const revenue = Math.max(ahNet, vendorUnit) * r.qty;
    const profit = revenue - cost;
    let craftableNow = Infinity;
    for (const [reagent, count] of r.reagents) {
      craftableNow = Math.min(craftableNow, Math.floor((inventory.get(reagent) ?? 0) / count));
    }
    return {
      recipe: r,
      cost,
      parts,
      complete,
      ahUnit: ah?.min,
      ahQty: ah?.qty ?? 0,
      vendorUnit,
      revenue,
      channel,
      profit,
      margin: cost > 0 ? profit / cost : 0,
      craftableNow: Number.isFinite(craftableNow) ? craftableNow : 0,
    };
  }
}

/** Unit vendor prices: known vendor reagents from game data, overridden by prices the addon saw. */
export function vendorPrices(data: GameData, curated: number[], learned: { item: number; unit: number }[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const id of curated) {
    const item = data.items.get(id);
    if (item && item.buy > 0) map.set(id, item.buy / Math.max(1, item.vstack));
  }
  for (const v of learned) map.set(v.item, v.unit);
  return map;
}

export function ahMap(rows: [number, number, number, [number, number][]][]): Map<number, AhRow> {
  return new Map(rows.map(([id, min, qty, levels]) => [id, { min, qty, levels }]));
}

/** Price/quantity changes between two scans: buyouts and crashes. */
export interface Change {
  item: number;
  before: AhRow;
  after: AhRow;
  priceRatio: number;
  qtyRatio: number;
}

export function compareScans(before: Map<number, AhRow>, after: Map<number, AhRow>) {
  const boughtOut: Change[] = [];
  const crashed: Change[] = [];
  const gone: number[] = [];
  for (const [item, b] of before) {
    const a = after.get(item);
    if (!a) {
      if (b.qty >= 5) gone.push(item);
      continue;
    }
    const change = { item, before: b, after: a, priceRatio: a.min / b.min, qtyRatio: a.qty / b.qty };
    if (change.qtyRatio <= 0.5 && change.priceRatio >= 1.1) boughtOut.push(change);
    else if (change.priceRatio <= 0.7) crashed.push(change);
  }
  boughtOut.sort((x, y) => y.priceRatio - x.priceRatio);
  crashed.sort((x, y) => x.priceRatio - y.priceRatio);
  return { boughtOut, crashed, gone };
}
