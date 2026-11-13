// TradeSkillMaster's public region data for WoW Forever, downloaded when the site is built
// (scripts/fetch-tsm.mjs). Region-wide: all rulesets and both factions together.

export interface TsmRow {
  marketValue: number;
  historical: number;
  avgSalePrice: number; // 0 when TSM saw no sales
  saleRate: number; // share of posted auctions that sell (0..1)
  soldPerDay: number;
}

export interface TsmData {
  region: string;
  updatedAt: number; // unix seconds, from TSM's file
  fetchedAt: number;
  items: Map<number, TsmRow>;
  names: Map<number, string>;
}

type RawFile = { updatedAt?: number; fetchedAt?: number; items: [number, number, number, number, number, number, string?][] };

export function parseTsmFile(region: string, raw: RawFile): TsmData {
  const items = new Map<number, TsmRow>();
  const names = new Map<number, string>();
  for (const [id, marketValue, historical, avgSalePrice, saleRate, soldPerDay, name] of raw.items ?? []) {
    items.set(id, { marketValue, historical, avgSalePrice, saleRate, soldPerDay });
    if (name) names.set(id, name);
  }
  return { region, updatedAt: raw.updatedAt ?? 0, fetchedAt: raw.fetchedAt ?? 0, items, names };
}

const cache = new Map<string, Promise<TsmData | undefined>>();

/** Loads the region's TSM file once per page load; undefined if the build had none. */
export function loadTsm(region: string, base = import.meta.env.BASE_URL): Promise<TsmData | undefined> {
  let p = cache.get(region);
  if (!p) {
    p = fetch(`${base}data/tsm-forever-${region}.json`)
      .then(async (res) => (res.ok ? parseTsmFile(region, (await res.json()) as RawFile) : undefined))
      .catch(() => undefined);
    cache.set(region, p);
  }
  return p;
}

export const TSM_CREDIT_URL = 'https://www.tradeskillmaster.com';
