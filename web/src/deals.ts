// Deals on the current auction house scan:
//  - vendor flips: listings cheaper than what a vendor pays for the item (guaranteed profit);
//  - under market: listings well below TradeSkillMaster's region price for items that sell.
// Only the cheapest few price levels of each item are known (the scan keeps 3), so unit
// counts are "at least"; `more` marks items where cheap listings may go on past those levels.

import type { Market } from './engine';
import type { GameData } from './gamedata';
import type { TsmData } from './tsm';

export interface VendorFlip {
  item: number;
  price: number; // cheapest listing
  vendor: number; // what a vendor pays per unit
  units: number; // units listed below the vendor price (in the known levels)
  profit: number; // buying them all and selling to a vendor
  more: boolean;
}

export interface DealOptions {
  maxPct: number; // listing at most this share of the market price, e.g. 0.7
  minSold: number; // TSM sold per day at least this
  minProfit: number; // copper, total for the cheap units
  cut: number; // AH cut when reselling
}

export interface MarketDeal {
  item: number;
  price: number;
  reference: number; // TSM average sale price (or market value when it has no sales)
  pct: number; // price / reference
  profitEach: number; // reference after the AH cut, minus the price
  units: number;
  profit: number;
  soldPerDay: number;
  saleRate: number;
  more: boolean;
}

const levelsOf = (ah: { min: number; qty: number; levels: [number, number][] }) => (ah.levels.length ? ah.levels : ([[ah.min, ah.qty]] as [number, number][]));

export function vendorFlips(data: GameData, market: Market): VendorFlip[] {
  const out: VendorFlip[] = [];
  for (const [item, ah] of market.ah) {
    const vendor = data.items.get(item)?.sell ?? 0;
    if (!vendor || !(ah.min > 0) || ah.min >= vendor) continue;
    let units = 0;
    let profit = 0;
    const levels = levelsOf(ah);
    for (const [price, qty] of levels) {
      if (price >= vendor) break;
      units += qty;
      profit += (vendor - price) * qty;
    }
    const more = levels.length >= 3 && levels.every(([p]) => p < vendor) && ah.qty > units;
    out.push({ item, price: ah.min, vendor, units, profit, more });
  }
  return out.sort((a, b) => b.profit - a.profit);
}

export function underMarket(market: Market, tsm: TsmData | undefined, opts: DealOptions): MarketDeal[] {
  if (!tsm) return [];
  const out: MarketDeal[] = [];
  for (const [item, ah] of market.ah) {
    const t = tsm.items.get(item);
    if (!t || !(ah.min > 0) || t.soldPerDay < opts.minSold) continue;
    const reference = t.avgSalePrice > 0 ? t.avgSalePrice : t.marketValue;
    if (!(reference > 0)) continue;
    const limit = reference * opts.maxPct;
    if (ah.min > limit) continue;
    const net = reference * (1 - opts.cut);
    let units = 0;
    let profit = 0;
    const levels = levelsOf(ah);
    for (const [price, qty] of levels) {
      if (price > limit) break;
      units += qty;
      profit += (net - price) * qty;
    }
    if (profit < opts.minProfit) continue;
    const more = levels.length >= 3 && levels.every(([p]) => p <= limit) && ah.qty > units;
    out.push({ item, price: ah.min, reference, pct: ah.min / reference, profitEach: net - ah.min, units, profit, soldPerDay: t.soldPerDay, saleRate: t.saleRate, more });
  }
  return out.sort((a, b) => b.profit - a.profit);
}
