import type { AhExportRow } from './types';

export interface Listing {
  item: number;
  unit: number; // copper per unit
  qty: number;
}

/** Same aggregation as the addon: lowest unit price, total quantity, cheapest price levels. */
export function aggregate(listings: Listing[], maxLevels = 3): AhExportRow[] {
  const byItem = new Map<number, { min: number; qty: number; levels: Map<number, number> }>();
  for (const { item, unit, qty } of listings) {
    if (!item || !(unit > 0) || !(qty > 0)) continue;
    let e = byItem.get(item);
    if (!e) {
      e = { min: unit, qty: 0, levels: new Map() };
      byItem.set(item, e);
    }
    if (unit < e.min) e.min = unit;
    e.qty += qty;
    e.levels.set(unit, (e.levels.get(unit) ?? 0) + qty);
  }
  const rows: AhExportRow[] = [];
  for (const [item, e] of byItem) {
    const levels = [...e.levels.entries()].sort((a, b) => a[0] - b[0]).slice(0, maxLevels);
    rows.push([item, e.min, e.qty, levels]);
  }
  return rows.sort((a, b) => a[0] - b[0]);
}

/** How well two scans agree: share of common items whose lowest price is within 10%. */
export function agreement(a: AhExportRow[], b: AhExportRow[]): { common: number; close: number } {
  const other = new Map(b.map((r) => [r[0], r[1]]));
  let common = 0;
  let close = 0;
  for (const [id, min] of a) {
    const m = other.get(id);
    if (m === undefined) continue;
    common++;
    if (Math.abs(m - min) <= 0.1 * Math.max(m, min)) close++;
  }
  return { common, close };
}
