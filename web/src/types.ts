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
}

export interface Recipe {
  spell: number;
  name: string;
  skill: number;
  yellow: number; // skill where it turns yellow
  grey: number; // skill where it turns grey
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
  source: 'paste' | 'api';
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
}

export interface VendorPrice {
  item: number;
  unit: number;
  seenAt: number;
}

export interface AhRow {
  min: number;
  qty: number;
  levels: [number, number][];
}
