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

/** TSM's scans of one auction house (ruleset and faction), updated about every 3 hours. */
export interface TsmHouseRow {
  minBuyout: number;
  recent: number; // TSM's value from its latest scan (its lowest-priced auctions, outliers left out)
  marketValue: number; // about the last two weeks
  historical: number; // about the last 60 days
}

export interface TsmHouse {
  region: string;
  house: string; // e.g. pvp-alliance
  updatedAt: number; // when TSM scanned it, unix seconds
  fetchedAt: number;
  items: Map<number, TsmHouseRow>;
}

type RawHouseFile = { updatedAt?: number; fetchedAt?: number; items: [number, number, number, number, number][] };

export function parseTsmHouseFile(region: string, house: string, raw: RawHouseFile): TsmHouse {
  const items = new Map<number, TsmHouseRow>();
  for (const [id, minBuyout, recent, marketValue, historical] of raw.items ?? []) items.set(id, { minBuyout, recent, marketValue, historical });
  return { region, house, updatedAt: raw.updatedAt ?? 0, fetchedAt: raw.fetchedAt ?? 0, items };
}

/**
 * TSM's name for your auction house: ruleset and faction, e.g. "pvp-alliance". Forever realm
 * names end in their ruleset ("CAMWOW EU4 Realm 8 PvP"); the Blizzard ruleset setting is the fallback.
 */
export function tsmHouseSlug(realm: string | undefined, faction: string | undefined, blizzRuleset?: number): string | undefined {
  const f = faction?.toLowerCase();
  if (f !== 'alliance' && f !== 'horde') return undefined;
  const r = (realm ?? '').toLowerCase().trim();
  const ruleset = /roleplay[\s-]*pvp$/.test(r)
    ? 'roleplay-pvp'
    : /roleplay$/.test(r)
      ? 'roleplay'
      : /pvp$/.test(r)
        ? 'pvp'
        : /normal$/.test(r)
          ? 'normal'
          : ({ 1: 'pvp', 2: 'normal', 3: 'roleplay', 15: 'roleplay-pvp' } as Record<number, string>)[blizzRuleset ?? 0];
  return ruleset ? `${ruleset}-${f}` : undefined;
}

const houseCache = new Map<string, Promise<TsmHouse | undefined>>();

export function loadTsmHouse(region: string, house: string, base = import.meta.env.BASE_URL): Promise<TsmHouse | undefined> {
  const key = `${region}-${house}`;
  let p = houseCache.get(key);
  if (!p) {
    p = fetch(`${base}data/tsm-forever-${key}.json`)
      .then(async (res) => (res.ok ? parseTsmHouseFile(region, house, (await res.json()) as RawHouseFile) : undefined))
      .catch(() => undefined);
    houseCache.set(key, p);
  }
  return p;
}
