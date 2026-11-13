// Shapes shared across the app. Prices are always in copper.

/** Static game data from wago.tools (see scripts/gamedata-transform.mjs). */
export interface Item {
  id: number;
  name: string;
  quality: number;
  sell: number; // what a vendor pays you
  buy: number; // what a vendor charges, for `vstack` units
  vstack: number;
  stack: number;
  partial?: boolean; // known only by name (from TSM): not in the game data from wago.tools
}

export interface Recipe {
  spell: number;
  name: string;
  skill: number;
  yellow: number; // skill where it turns yellow
  grey: number; // skill where it turns grey
  learn?: number; // skill needed to learn it (orange from here to yellow), undefined when unknown
  learnBase?: number; // what the game data knows (recipe item's required skill)
  teachItem?: number; // recipe item that teaches it ("Schematic: …")
  trainerCost?: number; // copper, when your trainer sells it (seen by the addon)
  trainerSeen?: boolean; // learn level comes from your trainer's list
  green?: number; // skill where it turns green (when known; else halfway from yellow to grey)
  /** From Recipe Master: taught by a trainer, sold by a vendor (copper, or another currency). */
  rm?: { trainer: boolean; vendorCost?: number; vendorPrice?: string; faction?: string; spec?: number };
  /** Game-data values, kept so Recipe Master's can be taken off again. */
  base?: { yellow: number; grey: number; teachItem?: number };
  out: number; // crafted item id
  qty: number; // items per craft
  reagents: [item: number, count: number][];
  gather?: boolean; // not a real recipe: a gathered item (ore, herb, fish, leather)
}

/** The decoded addon export (FLIPX1 string). */
export interface ExportPayload {
  v: number;
  t: number;
  build?: string;
  char: { n: string; r: string; f?: string; c?: string; l?: number; g?: number };
  ah?: { t: number; n: number; i: AhExportRow[] };
  bags: [number, number][];
  bank?: { t: number; i: [number, number][] };
  profs: { n: string; r: number; m: number; t: number; s: number[] }[];
  /** Every skill line: [name, rank, max]. Added in addon 0.2.0; older exports lack it. */
  skills?: [string, number, number][];
  vend: [item: number, unitCopper: number, seenAt: number][];
  /** Your AH mails, listings and crafts (addon 0.3.0+). Lua writes an empty list as {} or []. */
  ledger?: { m?: LedgerMailRow[]; a?: OwnAuctionRow[]; c?: CraftRow[] };
  /** Profession trainers' recipe lists: [profession, seenAt, [name, skillNeeded, cost, 'available'|'unavailable'|'used', itemMade]] */
  train?: [string, number, TrainerService[]][];
  /** Auctionator's price database (addon 0.3.0+). Days count from d0 (unix), today = t. */
  atr?: { d0: number; t: number; i?: AtrRow[]; p?: AtrPost[] };
}

export type TrainerService = [name: string, rank: number, cost: number, category: string, item: number];

export type MailKind = 'sold' | 'won' | 'expired' | 'cancelled';
export type LedgerMailRow = [key: string, kind: MailKind, name: string, item: number, count: number, price: number, cut: number, deposit: number, t: number];
export type OwnAuctionRow = [auctionId: number, item: number, qty: number, buyout: number, status: number, first: number, last: number];
export type CraftRow = [spell: number, hour: number, count: number];
export type AtrRow = [item: number, price: number, avail: number, lastDay: number, hist: [day: number, high: number, low: number, avail: number][]];
export type AtrPost = [item: number, unitPrice: number, qty: number, t: number];

/** One AH mail: a sale, a purchase, or an auction that expired or was cancelled. */
export interface MailRecord {
  id: string; // char|key, unique
  char: string;
  kind: MailKind;
  name: string;
  item: number; // 0 when the addon couldn't tell; resolved by name
  count: number;
  price: number; // total paid (sale or purchase)
  cut: number; // AH cut on a sale
  deposit: number;
  t: number;
}

export interface ListingRecord {
  id: string; // char|auctionId
  char: string;
  item: number;
  qty: number;
  buyout: number;
  status: number; // 0 active, 1 sold
  first: number;
  last: number;
}

export interface CraftRecord {
  id: string; // char|spell|hour
  char: string;
  spell: number;
  hour: number;
  count: number;
}

export interface PostRecord {
  id: string;
  char: string;
  item: number;
  unit: number;
  qty: number;
  t: number;
}

/** A day of Auctionator's price history for one item on your auction house. */
export interface HistoryRecord {
  id: string; // item|day
  item: number;
  day: number; // unix seconds at the start of the day
  low: number;
  high: number;
  avail: number;
}

/** [itemId, minUnitPrice, totalQuantity, [[price, qty], ...cheapest levels]] */
export type AhExportRow = [number, number, number, [number, number][]];

export interface Snapshot {
  id?: number;
  takenAt: number; // unix seconds, from the scan
  importedAt: number;
  charKey: string;
  realm: string;
  faction?: string;
  source: 'paste' | 'api' | 'auctionator';
  /** Covers only some items (e.g. a few Auctionator searches): laid over the last full scan. */
  partial?: boolean;
  auctions: number;
  rows: AhExportRow[];
}

export interface Character {
  key: string; // "Name-Realm"
  name: string;
  realm: string;
  faction?: string;
  cls?: string;
  level?: number;
  gold?: number;
  updatedAt: number;
  bags: [number, number][];
  bank?: { t: number; i: [number, number][] };
  profs: { n: string; r: number; m: number; t: number; s: number[] }[];
  skills?: [string, number, number][];
  trainers?: { prof: string; t: number; list: TrainerService[] }[];
}

export interface VendorPrice {
  item: number;
  unit: number;
  seenAt: number;
}

export interface AhRow {
  min: number; // lowest unit price listed
  qty: number;
  levels: [number, number][]; // cheapest price levels [unit price, quantity]
  /** What one costs to buy or sells for: the average of the cheapest few on sale (Settings), so one bait listing can't set it. */
  price: number;
}
