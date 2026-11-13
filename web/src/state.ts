import { db, latestSnapshots, loadThroughput, partialSnapshotsSince } from './db';
import { ahMap, vendorPrices, type CraftMode, type EngineOptions, type Market } from './engine';
import type { GameData } from './gamedata';
import { emptyFlow, houseKey, type Flow, type Throughput } from './throughput';
import { loadTsm, type TsmData, type TsmRow } from './tsm';
import type { AhRow, Character, Snapshot } from './types';
import { VENDOR_REAGENTS } from './vendor';

export interface Settings {
  cut: number; // AH cut, 0.05
  craftMode: CraftMode; // sub-components: known recipes / all / buy only
  recipeScope: 'known' | 'profession' | 'all';
  charKey?: string;
  blizzRegion: string;
  blizzId: string;
  blizzSecret: string;
  blizzRuleset?: number;
  blizzHouse?: number;
  blizzHouseLabel?: string;
  autoFetch: boolean; // fetch Blizzard prices every hour while the page is open
  hideGathered: boolean; // Crafts: leave out gathered items (ore, herbs, fish…)
  dealMaxPct: number; // Deals: listing at most this share of the market price
  dealMinSold: number; // Deals: TSM sold per day at least
  dealMinProfit: number; // Deals: copper
  dealAlerts: boolean; // browser notification when new deals appear after an auto-fetch
  dealStackOnly: boolean; // Deals: only stackable goods (TSM's gear prices mix every version of an item)
}

const SETTINGS_KEY = 'forever-flips:settings';
const DEFAULTS: Settings = { cut: 0.05, craftMode: 'known', recipeScope: 'known', blizzRegion: 'eu', blizzId: '', blizzSecret: '', autoFetch: true, hideGathered: false, dealMaxPct: 0.7, dealMinSold: 1, dealMinProfit: 1000, dealAlerts: false, dealStackOnly: false };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode): settings just won't persist */
  }
}

export interface AppState {
  data: GameData;
  settings: Settings;
  chars: Character[];
  char?: Character;
  latest?: Snapshot;
  previous?: Snapshot;
  market: Market;
  /** Sales rates from hourly Blizzard snapshots (undefined until the API is set up). */
  flow?: Throughput;
  /** TradeSkillMaster's region data (sold per day, sale rate), if the site build fetched it. */
  tsm?: TsmData;
}

export async function loadState(data: GameData, settings: Settings): Promise<AppState> {
  const chars = await db.characters.orderBy('updatedAt').reverse().toArray();
  const char = chars.find((c) => c.key === settings.charKey) ?? chars[0];
  const [latest, previous] = await latestSnapshots(2);
  const learned = await db.vendor.toArray();
  const market: Market = {
    ah: latest ? ahMap(latest.rows) : new Map<number, AhRow>(),
    vendor: vendorPrices(data, VENDOR_REAGENTS, learned),
  };
  // Newer partial prices (a few Auctionator searches) replace the full scan's price for those items.
  for (const p of await partialSnapshotsSince(latest?.takenAt ?? 0)) {
    for (const [id, min, qty, levels] of p.rows) {
      const base = market.ah.get(id);
      market.ah.set(id, { min, qty: qty || base?.qty || 0, levels: levels.length ? levels : [[min, qty || base?.qty || 0]] });
    }
  }
  const house = currentHouse(settings);
  const flow = house ? await loadThroughput(house) : undefined;
  const tsm = await loadTsm(settings.blizzRegion || 'eu');
  // Items the game data lacks (some Forever items aren't in wago's tables): at least show their name.
  if (tsm) {
    for (const [id, name] of tsm.names) {
      if (!data.items.has(id)) data.items.set(id, { id, name, quality: 1, sell: 0, buy: 0, vstack: 1, stack: 1, partial: true });
    }
  }
  return { data, settings, chars, char, latest, previous, market, flow, tsm };
}

export function currentHouse(s: Settings): string | undefined {
  return s.blizzRuleset && s.blizzHouse ? houseKey(s.blizzRegion, s.blizzRuleset, s.blizzHouse) : undefined;
}

/** TSM's region numbers for one item. */
export function tsmFor(state: AppState, item: number): TsmRow | undefined {
  return state.tsm?.items.get(item);
}

/** Sales rate of one item, or undefined when there is no comparable data yet. */
export function flowFor(state: AppState, item: number): Flow | undefined {
  const t = state.flow;
  if (!t) return undefined;
  const f = t.flows.get(item);
  if (f) return f;
  // Never seen moving: zero sales over the hours we watched its kind of auction.
  const commodity = (state.data.items.get(item)?.stack ?? 1) > 1;
  const hours = commodity ? t.hoursCommodities : t.hoursItems;
  return hours > 0 ? emptyFlow(hours) : undefined;
}

export function blizzardReady(s: Settings): boolean {
  return !!(s.blizzId && s.blizzSecret && s.blizzRuleset && s.blizzHouse);
}

export function knownSpells(char?: Character): Set<number> {
  return new Set((char?.profs ?? []).flatMap((p) => p.s));
}

export function engineOptions(state: AppState): EngineOptions {
  return { cut: state.settings.cut, craftMode: state.settings.craftMode, known: knownSpells(state.char) };
}

export function inventory(char?: Character): { total: Map<number, number>; bags: Map<number, number>; bank: Map<number, number> } {
  const bags = new Map(char?.bags ?? []);
  const bank = new Map(char?.bank?.i ?? []);
  const total = new Map(bags);
  for (const [id, n] of bank) total.set(id, (total.get(id) ?? 0) + n);
  return { total, bags, bank };
}
