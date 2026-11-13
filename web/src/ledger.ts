// Your own auction house history, from the AH mails the addon reads at the mailbox
// (sales, purchases, expired and cancelled auctions), Auctionator's posting history,
// and the crafts the addon counts.

import type { GameData } from './gamedata';
import type { CraftRecord, MailRecord, PostRecord } from './types';

export interface SalePoint {
  t: number;
  unit: number; // price paid per unit
  count: number;
}

export interface ItemLedger {
  key: string; // item id as text, or "n:<name>" when the id is unknown
  item: number; // 0 if unknown
  name: string;
  soldUnits: number;
  soldAuctions: number;
  gross: number; // what buyers paid
  net: number; // after the AH cut
  expired: number; // auctions
  cancelled: number;
  boughtUnits: number;
  spent: number;
  postedUnits: number; // from Auctionator's posting history
  crafted: number; // units made
  lastSale?: number;
  sales: SalePoint[];
}

export interface DayTotals {
  day: number; // unix seconds, local midnight
  income: number; // sales after the cut
  spend: number; // AH purchases
}

export interface LedgerSummary {
  items: ItemLedger[];
  days: DayTotals[]; // the last `days` days, oldest first, zeros included
  income7: number;
  income30: number;
  spend30: number;
  sellThrough30: number; // sold auctions / (sold + expired + cancelled), NaN without data
  mails: number;
}

const names = new WeakMap<GameData, Map<string, number>>();

/** Item id by (lower-case) name, for mails that only carry a name. */
export function idByName(data: GameData, name: string): number {
  let idx = names.get(data);
  if (!idx) {
    idx = new Map();
    for (const it of data.items.values()) {
      const k = it.name.toLowerCase();
      if (!idx.has(k)) idx.set(k, it.id);
    }
    names.set(data, idx);
  }
  return idx.get(name.toLowerCase()) ?? 0;
}

export function localDay(t: number): number {
  const d = new Date(t * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function summarizeLedger(
  data: GameData,
  mail: MailRecord[],
  crafts: CraftRecord[],
  posts: PostRecord[],
  opts: { now?: number; days?: number } = {},
): LedgerSummary {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const span = opts.days ?? 30;
  const items = new Map<string, ItemLedger>();
  const get = (item: number, name: string) => {
    const id = item || idByName(data, name);
    const key = id ? String(id) : `n:${name}`;
    let e = items.get(key);
    if (!e) {
      e = { key, item: id, name: data.items.get(id)?.name || name || `Item ${id}`, soldUnits: 0, soldAuctions: 0, gross: 0, net: 0, expired: 0, cancelled: 0, boughtUnits: 0, spent: 0, postedUnits: 0, crafted: 0, sales: [] };
      items.set(key, e);
    }
    return e;
  };

  const today = localDay(now);
  const byDay = new Map<number, DayTotals>();
  for (let i = span - 1; i >= 0; i--) {
    const day = localDay(today - i * 86400 + 43200); // noon avoids daylight-saving edges
    byDay.set(day, { day, income: 0, spend: 0 });
  }

  let income7 = 0;
  let income30 = 0;
  let spend30 = 0;
  let sold30 = 0;
  let unsold30 = 0;
  for (const m of mail) {
    const e = get(m.item, m.name);
    const recent30 = m.t >= now - 30 * 86400;
    const d = byDay.get(localDay(m.t));
    if (m.kind === 'sold') {
      const net = m.price - m.cut;
      e.soldUnits += m.count;
      e.soldAuctions++;
      e.gross += m.price;
      e.net += net;
      e.lastSale = Math.max(e.lastSale ?? 0, m.t);
      e.sales.push({ t: m.t, unit: m.price / Math.max(1, m.count), count: m.count });
      if (d) d.income += net;
      if (recent30) { income30 += net; sold30++; }
      if (m.t >= now - 7 * 86400) income7 += net;
    } else if (m.kind === 'won') {
      e.boughtUnits += m.count;
      e.spent += m.price;
      if (d) d.spend += m.price;
      if (recent30) spend30 += m.price;
    } else {
      if (m.kind === 'expired') e.expired++;
      else e.cancelled++;
      if (recent30) unsold30++;
    }
  }
  for (const c of crafts) {
    const r = data.recipesBySpell.get(c.spell);
    if (r) get(r.out, data.items.get(r.out)?.name ?? '').crafted += c.count * r.qty;
  }
  for (const p of posts) get(p.item, data.items.get(p.item)?.name ?? '').postedUnits += p.qty;
  for (const e of items.values()) e.sales.sort((a, b) => a.t - b.t);

  return {
    items: [...items.values()],
    days: [...byDay.values()],
    income7,
    income30,
    spend30,
    sellThrough30: sold30 + unsold30 ? sold30 / (sold30 + unsold30) : NaN,
    mails: mail.length,
  };
}
