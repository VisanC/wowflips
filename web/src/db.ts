import Dexie, { type Table } from 'dexie';
import type { HouseSnapshot } from './blizzard';
import { diffStates, KEEP_DAYS, summarize, WINDOW_DAYS, type AuctionState, type SalesRecord, type Throughput } from './throughput';
import type { AhExportRow, Character, CraftRecord, ExportPayload, HistoryRecord, ListingRecord, MailRecord, PostRecord, Snapshot, VendorPrice } from './types';

class FlipDB extends Dexie {
  snapshots!: Table<Snapshot, number>;
  characters!: Table<Character, string>;
  vendor!: Table<VendorPrice, number>;
  auctionState!: Table<AuctionState, string>;
  sales!: Table<SalesRecord, number>;
  mail!: Table<MailRecord, string>;
  listings!: Table<ListingRecord, string>;
  crafts!: Table<CraftRecord, string>;
  posts!: Table<PostRecord, string>;
  history!: Table<HistoryRecord, string>;

  constructor() {
    super('forever-flips');
    this.version(1).stores({
      snapshots: '++id, takenAt, charKey',
      characters: 'key, updatedAt',
      vendor: 'item',
    });
    this.version(2).stores({
      snapshots: '++id, takenAt, charKey',
      characters: 'key, updatedAt',
      vendor: 'item',
      auctionState: 'house',
      sales: '++id, house, at',
    });
    this.version(3).stores({
      snapshots: '++id, takenAt, charKey',
      characters: 'key, updatedAt',
      vendor: 'item',
      auctionState: 'house',
      sales: '++id, house, at',
      mail: 'id, char, item, t',
      listings: 'id, char, item',
      crafts: 'id, char, spell',
      posts: 'id, item, t',
      history: 'id, item, day',
    });
  }
}

export const db = new FlipDB();

export interface ImportResult {
  charKey: string;
  snapshotAdded: boolean;
  snapshotItems: number;
  auctions: number;
  scanAge?: number;
  profs: string[];
  vendorItems: number;
  bags: number;
  bankAge?: number;
  mails: number; // new AH mails (sales, purchases, expired, cancelled)
  atrItems: number; // Auctionator prices seen today
  atrHistory: number; // days of Auctionator price history stored
}

/** Lua writes an empty list as {} or []: always get an array. */
const arr = <T>(x: T[] | Record<string, never> | undefined): T[] => (Array.isArray(x) ? x : []);

export async function importPayload(p: ExportPayload): Promise<ImportResult> {
  const key = `${p.char.n}-${p.char.r}`;
  const now = Math.floor(Date.now() / 1000);

  return db.transaction('rw', [db.characters, db.snapshots, db.vendor, db.mail, db.listings, db.crafts, db.posts, db.history], async () => {
    const prev = await db.characters.get(key);
    const profs = new Map((prev?.profs ?? []).map((x) => [x.n, x]));
    for (const prof of p.profs) {
      const old = profs.get(prof.n);
      if (!old || old.t <= prof.t) profs.set(prof.n, prof);
    }
    const bank = !prev?.bank || (p.bank && p.bank.t >= prev.bank.t) ? (p.bank ?? prev?.bank) : prev.bank;
    await db.characters.put({
      key,
      name: p.char.n,
      realm: p.char.r,
      faction: p.char.f,
      cls: p.char.c,
      level: p.char.l,
      gold: p.char.g,
      updatedAt: p.t,
      bags: p.bags,
      bank,
      profs: [...profs.values()],
      skills: p.skills?.length ? p.skills : prev?.skills,
    });

    for (const [item, unit, seenAt] of p.vend) {
      const old = await db.vendor.get(item);
      if (!old || old.seenAt <= seenAt) await db.vendor.put({ item, unit, seenAt });
    }

    let snapshotAdded = false;
    if (p.ah && p.ah.i.length) {
      const dupe = await db.snapshots.where('takenAt').equals(p.ah.t).first();
      if (!dupe) {
        await db.snapshots.add({
          takenAt: p.ah.t,
          importedAt: now,
          charKey: key,
          realm: p.char.r,
          faction: p.char.f,
          source: 'paste',
          auctions: p.ah.n,
          rows: p.ah.i,
        });
        snapshotAdded = true;
      }
    }

    // Ledger: your AH mails, listings and crafts (keys make re-imports harmless)
    let mails = 0;
    for (const [mk, kind, name, item, count, price, cut, deposit, t] of arr(p.ledger?.m)) {
      const id = `${key}|${mk}`;
      if (!(await db.mail.get(id))) mails++;
      await db.mail.put({ id, char: key, kind, name, item, count, price, cut, deposit, t });
    }
    for (const [auctionId, item, qty, buyout, status, first, last] of arr(p.ledger?.a)) {
      const id = `${key}|${auctionId}`;
      const old = await db.listings.get(id);
      await db.listings.put({ id, char: key, item, qty, buyout, status, first: Math.min(first, old?.first ?? first), last: Math.max(last, old?.last ?? last) });
    }
    for (const [spell, hour, count] of arr(p.ledger?.c)) {
      const id = `${key}|${spell}|${hour}`;
      const old = await db.crafts.get(id);
      await db.crafts.put({ id, char: key, spell, hour, count: Math.max(count, old?.count ?? 0) });
    }

    // Auctionator: today's prices become a scan; its daily history is kept per item and day
    let atrItems = 0;
    let atrHistory = 0;
    if (p.atr) {
      const { d0, t: today } = p.atr;
      const rows: AhExportRow[] = [];
      const history: HistoryRecord[] = [];
      for (const [item, price, avail, lastDay, hist] of arr(p.atr.i)) {
        if (lastDay === today && price > 0) rows.push([item, price, avail, []]);
        for (const [day, high, low, a] of arr(hist)) history.push({ id: `${item}|${day}`, item, day: d0 + day * 86400, high, low: low || high, avail: a });
      }
      await db.history.bulkPut(history);
      atrHistory = history.length;
      rows.sort((a, b) => a[0] - b[0]);
      atrItems = rows.length;
      if (rows.length) {
        const dupe = await db.snapshots.where('takenAt').equals(p.t).filter((s) => s.source === 'auctionator').first();
        if (!dupe) {
          await db.snapshots.add({
            takenAt: p.t,
            importedAt: now,
            charKey: key,
            realm: `Auctionator (${p.char.r})`,
            faction: p.char.f,
            source: 'auctionator',
            partial: rows.length < 500,
            auctions: rows.reduce((n, r) => n + r[2], 0),
            rows,
          });
        }
      }
      for (const [item, unit, qty, t] of arr(p.atr.p)) {
        await db.posts.put({ id: `${key}|${item}|${t}|${unit}|${qty}`, char: key, item, unit, qty, t });
      }
    }

    return {
      mails,
      atrItems,
      atrHistory,
      charKey: key,
      snapshotAdded,
      snapshotItems: p.ah?.i.length ?? 0,
      auctions: p.ah?.n ?? 0,
      scanAge: p.ah ? now - p.ah.t : undefined,
      profs: p.profs.map((x) => `${x.n} ${x.r}/${x.m} (${x.s.length} recipes)`),
      vendorItems: p.vend.length,
      bags: p.bags.length,
      bankAge: p.bank ? now - p.bank.t : undefined,
    };
  });
}

/** Saves a scan fetched from Blizzard's API. Returns false if that exact snapshot is already stored. */
export async function saveApiSnapshot(snap: HouseSnapshot): Promise<boolean> {
  await recordSales(snap.state);
  const dupe = await db.snapshots.where('takenAt').equals(snap.takenAt).filter((s) => s.source === 'api').first();
  if (dupe) return false;
  await db.snapshots.add({
    takenAt: snap.takenAt,
    importedAt: Math.floor(Date.now() / 1000),
    charKey: 'Blizzard API',
    realm: snap.rulesetName ? `${snap.houseName} (${snap.rulesetName})` : snap.houseName,
    source: 'api',
    auctions: snap.itemAuctions + snap.commodityAuctions,
    rows: snap.rows,
  });
  return true;
}

/** Compares the new auctions with the house's previous ones and stores what sold. */
export async function recordSales(state: AuctionState): Promise<SalesRecord | undefined> {
  return db.transaction('rw', db.auctionState, db.sales, async () => {
    const prev = await db.auctionState.get(state.house);
    if (prev && prev.items.at >= state.items.at && prev.commodities.at >= state.commodities.at) return undefined; // nothing newer
    const rec = prev ? diffStates(prev, state) : undefined;
    if (rec) await db.sales.add(rec);
    await db.auctionState.put(state);
    await db.sales.where('at').below(state.items.at - KEEP_DAYS * 86400).delete();
    return rec;
  });
}

/** Sales rates for one house over the last WINDOW_DAYS. */
export async function loadThroughput(house: string): Promise<Throughput> {
  const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;
  const records = await db.sales.where('house').equals(house).filter((r) => r.at >= since).toArray();
  return summarize(records);
}

/** Latest scans first, without the (large) row data. */
export async function listSnapshots() {
  const all = await db.snapshots.orderBy('takenAt').reverse().toArray();
  return all.map(({ rows, ...meta }) => ({ ...meta, items: rows.length }));
}

/** The latest full scans (partial ones, like a few Auctionator searches, are left out). */
export async function latestSnapshots(n = 2): Promise<Snapshot[]> {
  return db.snapshots.orderBy('takenAt').reverse().filter((s) => !s.partial).limit(n).toArray();
}

/** Partial scans newer than a time, oldest first, to lay over the latest full scan. */
export async function partialSnapshotsSince(t: number): Promise<Snapshot[]> {
  return db.snapshots.where('takenAt').above(t).filter((s) => !!s.partial).sortBy('takenAt');
}

export async function exportBackup(): Promise<Blob> {
  const backup = {
    app: 'forever-flips',
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshots: await db.snapshots.toArray(),
    characters: await db.characters.toArray(),
    vendor: await db.vendor.toArray(),
    mail: await db.mail.toArray(),
    listings: await db.listings.toArray(),
    crafts: await db.crafts.toArray(),
    posts: await db.posts.toArray(),
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export async function importBackup(file: File) {
  const backup = JSON.parse(await file.text());
  if (backup.app !== 'forever-flips') throw new Error('This is not a Forever Flips backup file.');
  await db.transaction('rw', [db.snapshots, db.characters, db.vendor, db.mail, db.listings, db.crafts, db.posts], async () => {
    await db.snapshots.bulkPut(backup.snapshots);
    await db.characters.bulkPut(backup.characters);
    await db.vendor.bulkPut(backup.vendor);
    if (backup.mail) await db.mail.bulkPut(backup.mail);
    if (backup.listings) await db.listings.bulkPut(backup.listings);
    if (backup.crafts) await db.crafts.bulkPut(backup.crafts);
    if (backup.posts) await db.posts.bulkPut(backup.posts);
  });
  return { snapshots: backup.snapshots.length, characters: backup.characters.length };
}

export async function wipeAll() {
  await Promise.all([db.snapshots.clear(), db.characters.clear(), db.vendor.clear(), db.auctionState.clear(), db.sales.clear(), db.mail.clear(), db.listings.clear(), db.crafts.clear(), db.posts.clear(), db.history.clear()]);
}
