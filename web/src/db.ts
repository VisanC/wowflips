import Dexie, { type Table } from 'dexie';
import type { Character, ExportPayload, Snapshot, VendorPrice } from './types';

class FlipDB extends Dexie {
  snapshots!: Table<Snapshot, number>;
  characters!: Table<Character, string>;
  vendor!: Table<VendorPrice, number>;

  constructor() {
    super('forever-flips');
    this.version(1).stores({
      snapshots: '++id, takenAt, charKey',
      characters: 'key, updatedAt',
      vendor: 'item',
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
}

export async function importPayload(p: ExportPayload): Promise<ImportResult> {
  const key = `${p.char.n}-${p.char.r}`;
  const now = Math.floor(Date.now() / 1000);

  return db.transaction('rw', db.characters, db.snapshots, db.vendor, async () => {
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

    return {
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

/** Latest scans first, without the (large) row data. */
export async function listSnapshots() {
  const all = await db.snapshots.orderBy('takenAt').reverse().toArray();
  return all.map(({ rows, ...meta }) => ({ ...meta, items: rows.length }));
}

export async function latestSnapshots(n = 2): Promise<Snapshot[]> {
  return db.snapshots.orderBy('takenAt').reverse().limit(n).toArray();
}

export async function exportBackup(): Promise<Blob> {
  const backup = {
    app: 'forever-flips',
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshots: await db.snapshots.toArray(),
    characters: await db.characters.toArray(),
    vendor: await db.vendor.toArray(),
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export async function importBackup(file: File) {
  const backup = JSON.parse(await file.text());
  if (backup.app !== 'forever-flips') throw new Error('This is not a Forever Flips backup file.');
  await db.transaction('rw', db.snapshots, db.characters, db.vendor, async () => {
    await db.snapshots.bulkPut(backup.snapshots);
    await db.characters.bulkPut(backup.characters);
    await db.vendor.bulkPut(backup.vendor);
  });
  return { snapshots: backup.snapshots.length, characters: backup.characters.length };
}

export async function wipeAll() {
  await Promise.all([db.snapshots.clear(), db.characters.clear(), db.vendor.clear()]);
}
