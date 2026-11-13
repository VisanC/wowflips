// Throughput: how many of an item actually sell, estimated from consecutive Blizzard snapshots.
//
// Every auction in the API has an id and a time-left bucket. Between two hourly snapshots:
//   - an auction whose quantity went down was partly bought (commodities): certain sale;
//   - an auction that vanished was bought, cancelled or expired. We count it as sold only when
//       (a) its time-left bucket guarantees it could not have expired within the gap, and
//       (b) for commodities, no cheaper auction from the earlier snapshot is still listed
//           (commodity buyers always get the cheapest units first, so while a cheaper auction
//           still has units left, nobody bought the pricier one: it was cancelled);
//   - an auction that is new was listed in between.
// Gear and other non-commodities can't use rule (b), so their numbers include some cancellations.

/** SHORT < 30 min, MEDIUM 30 min–2 h, LONG 2–12 h, VERY_LONG 12–48 h. */
export const TIME_LEFT: Record<string, number> = { SHORT: 1, MEDIUM: 2, LONG: 3, VERY_LONG: 4 };
/** Seconds an auction in each bucket is guaranteed to still have (index = TIME_LEFT code; 0 = unknown). */
const MIN_LEFT = [0, 0, 30 * 60, 2 * 3600, 12 * 3600];
/** Snapshots further apart than this are not compared: too much happens unseen in between. */
export const MAX_GAP = 3 * 3600;
/** Sales older than this are deleted. */
export const KEEP_DAYS = 14;
/** Rates are averaged over this window. */
export const WINDOW_DAYS = 7;

/** One kind of auction list (items or commodities) at one moment. Parallel typed arrays keep it small. */
export interface AuctionList {
  at: number; // unix seconds (Last-Modified)
  id: Float64Array;
  item: Uint32Array;
  qty: Uint32Array;
  unit: Float64Array; // copper per unit
  tl: Uint8Array; // TIME_LEFT code
}

/** The latest auctions of one house, kept to compare with the next fetch. */
export interface AuctionState {
  house: string;
  items: AuctionList;
  commodities: AuctionList;
}

/** What happened between two snapshots of one house. Only items with any activity are stored. */
export interface SalesRecord {
  id?: number;
  house: string;
  at: number; // time of the later snapshot
  hoursItems: number; // 0 when the item lists could not be compared
  hoursCommodities: number;
  item: Uint32Array;
  sold: Uint32Array;
  value: Float64Array; // copper paid for the sold units
  listed: Uint32Array; // new units listed
  gone: Uint32Array; // vanished but not counted as sold (cancelled or expired)
  commodity: Uint8Array;
}

export interface RawAuction {
  id?: number;
  item?: { id?: number };
  quantity?: number;
  unit_price?: number;
  buyout?: number;
  time_left?: string;
}

export function houseKey(region: string, ruleset: number, house: number): string {
  return `${region}-${ruleset}-${house}`;
}

/** Packs raw API auctions into typed arrays. Auctions without a buyout (bid only) are skipped. */
export function packAuctions(raw: RawAuction[] | undefined, at: number): AuctionList {
  const list = (raw ?? []).filter((a) => a.id !== undefined && a.item?.id && (a.unit_price || a.buyout));
  const n = list.length;
  const out: AuctionList = { at, id: new Float64Array(n), item: new Uint32Array(n), qty: new Uint32Array(n), unit: new Float64Array(n), tl: new Uint8Array(n) };
  list.forEach((a, i) => {
    const qty = Math.max(1, a.quantity ?? 1);
    out.id[i] = a.id!;
    out.item[i] = a.item!.id!;
    out.qty[i] = qty;
    out.unit[i] = a.unit_price ?? a.buyout! / qty;
    out.tl[i] = TIME_LEFT[a.time_left ?? ''] ?? 0;
  });
  return out;
}

interface Acc {
  sold: number;
  value: number;
  listed: number;
  gone: number;
  commodity: boolean;
}

/** Compares one kind of list; adds to acc and returns the hours covered (0 if not comparable). */
function diffList(prev: AuctionList, now: AuctionList, commodity: boolean, acc: Map<number, Acc>): number {
  const gap = now.at - prev.at;
  if (gap <= 0 || gap > MAX_GAP) return 0;
  const get = (item: number) => {
    let a = acc.get(item);
    if (!a) acc.set(item, (a = { sold: 0, value: 0, listed: 0, gone: 0, commodity }));
    return a;
  };
  const nowIdx = new Map<number, number>();
  for (let j = 0; j < now.id.length; j++) nowIdx.set(now.id[j], j);

  // Cheapest auction per commodity that is still listed (even if partly bought): no purchase went above it.
  const floor = new Map<number, number>();
  if (commodity) {
    for (let i = 0; i < prev.id.length; i++) {
      if (nowIdx.has(prev.id[i]) && prev.unit[i] < (floor.get(prev.item[i]) ?? Infinity)) floor.set(prev.item[i], prev.unit[i]);
    }
  }

  const prevIds = new Set<number>();
  for (let i = 0; i < prev.id.length; i++) {
    prevIds.add(prev.id[i]);
    const j = nowIdx.get(prev.id[i]);
    const a = get(prev.item[i]);
    if (j !== undefined) {
      const bought = prev.qty[i] - now.qty[j];
      if (bought > 0) {
        a.sold += bought;
        a.value += bought * prev.unit[i];
      }
      continue;
    }
    const couldExpire = MIN_LEFT[prev.tl[i]] <= gap;
    const cheaperSurvived = commodity && prev.unit[i] > (floor.get(prev.item[i]) ?? Infinity);
    if (couldExpire || cheaperSurvived) a.gone += prev.qty[i];
    else {
      a.sold += prev.qty[i];
      a.value += prev.qty[i] * prev.unit[i];
    }
  }
  for (let j = 0; j < now.id.length; j++) if (!prevIds.has(now.id[j])) get(now.item[j]).listed += now.qty[j];
  return gap / 3600;
}

/** Sales between two states of the same house, or undefined if neither list is comparable. */
export function diffStates(prev: AuctionState, now: AuctionState): SalesRecord | undefined {
  const acc = new Map<number, Acc>();
  const hoursItems = diffList(prev.items, now.items, false, acc);
  const hoursCommodities = diffList(prev.commodities, now.commodities, true, acc);
  if (!hoursItems && !hoursCommodities) return undefined;
  const rows = [...acc].filter(([, a]) => a.sold || a.listed || a.gone);
  const n = rows.length;
  const rec: SalesRecord = {
    house: now.house,
    at: Math.max(now.items.at, now.commodities.at),
    hoursItems,
    hoursCommodities,
    item: new Uint32Array(n),
    sold: new Uint32Array(n),
    value: new Float64Array(n),
    listed: new Uint32Array(n),
    gone: new Uint32Array(n),
    commodity: new Uint8Array(n),
  };
  rows.forEach(([item, a], i) => {
    rec.item[i] = item;
    rec.sold[i] = a.sold;
    rec.value[i] = a.value;
    rec.listed[i] = a.listed;
    rec.gone[i] = a.gone;
    rec.commodity[i] = a.commodity ? 1 : 0;
  });
  return rec;
}

export interface Flow {
  sold: number;
  value: number;
  listed: number;
  gone: number;
  hours: number; // hours of comparable data behind these numbers
  perDay: number; // units sold per day
  listedPerDay: number;
  avg: number; // average price paid per unit (NaN if nothing sold)
}

export interface Throughput {
  flows: Map<number, Flow>;
  hoursItems: number;
  hoursCommodities: number;
  records: number;
}

export function emptyFlow(hours: number): Flow {
  return { sold: 0, value: 0, listed: 0, gone: 0, hours, perDay: 0, listedPerDay: 0, avg: NaN };
}

/** Adds up sales records into per-item rates. */
export function summarize(records: SalesRecord[]): Throughput {
  let hoursItems = 0;
  let hoursCommodities = 0;
  const sums = new Map<number, { sold: number; value: number; listed: number; gone: number; commodity: boolean }>();
  for (const r of records) {
    hoursItems += r.hoursItems;
    hoursCommodities += r.hoursCommodities;
    for (let i = 0; i < r.item.length; i++) {
      let s = sums.get(r.item[i]);
      if (!s) sums.set(r.item[i], (s = { sold: 0, value: 0, listed: 0, gone: 0, commodity: r.commodity[i] === 1 }));
      s.sold += r.sold[i];
      s.value += r.value[i];
      s.listed += r.listed[i];
      s.gone += r.gone[i];
    }
  }
  const flows = new Map<number, Flow>();
  for (const [item, s] of sums) {
    const hours = s.commodity ? hoursCommodities : hoursItems;
    if (!hours) continue;
    flows.set(item, {
      ...s,
      hours,
      perDay: (s.sold / hours) * 24,
      listedPerDay: (s.listed / hours) * 24,
      avg: s.sold ? s.value / s.sold : NaN,
    });
  }
  return { flows, hoursItems, hoursCommodities, records: records.length };
}
