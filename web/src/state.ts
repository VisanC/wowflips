import { db, latestSnapshots } from './db';
import { ahMap, vendorPrices, type CraftMode, type EngineOptions, type Market } from './engine';
import type { GameData } from './gamedata';
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
}

const SETTINGS_KEY = 'forever-flips:settings';
const DEFAULTS: Settings = { cut: 0.05, craftMode: 'known', recipeScope: 'known', blizzRegion: 'eu', blizzId: '', blizzSecret: '' };

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
  return { data, settings, chars, char, latest, previous, market };
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
