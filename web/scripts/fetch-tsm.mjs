// Downloads TradeSkillMaster's public WoW Forever data (prices are copper; public, no key):
//  - region: sold per day, sale rate, average sale price, market value (all rulesets and both
//    factions together; TSM updates it daily)
//      https://public-data.tradeskillmaster.com/forever/{region}/region/items.csv
//      -> public/data/tsm-forever-{region}.json
//  - each auction house (ruleset and faction, e.g. pvp-alliance): lowest buyout, recent value,
//    market value, historical price (TSM updates these about every 3 hours)
//      https://public-data.tradeskillmaster.com/forever/{region}/realm/{house}/items.csv
//      -> public/data/tsm-forever-{region}-{house}.json
// This never fails the build: if TSM is unreachable the site simply shows no TSM numbers.
//
// Usage: node scripts/fetch-tsm.mjs            (OUT_DIR, TSM_BASE and TSM_REGIONS can override)

import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const OUT_DIR = process.env.OUT_DIR ?? 'public/data';
const BASE = process.env.TSM_BASE ?? 'https://public-data.tradeskillmaster.com/forever';
const REGIONS = (process.env.TSM_REGIONS ?? 'eu,us,kr,tw').split(',');
// Forever's auction houses on TSM: one per ruleset and faction (tradeskillmaster.com's realm list).
const RULESETS = { eu: ['normal', 'pvp', 'roleplay', 'roleplay-pvp'], us: ['normal', 'pvp', 'roleplay', 'roleplay-pvp'], kr: ['normal', 'pvp'], tw: ['normal', 'pvp'] };
export const houseSlugs = (region) => (RULESETS[region] ?? []).flatMap((r) => [`${r}-alliance`, `${r}-horde`]);

/** Splits one CSV line, honouring quotes ("a, b" and "" escapes). */
function splitLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const toUnix = (v) => {
  if (!v) return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
};

/**
 * TSM CSV -> { updatedAt, columns, items: [[itemId, marketValue, historical, avgSalePrice, saleRate, soldPerDay, name]] }
 * (the name fills in items the game data from wago.tools doesn't have)
 * Columns are found by name, so a reordered file still works; unknown extra columns are ignored.
 */
export function parseTsmCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { updatedAt: 0, columns: [], items: [] };
  const header = splitLine(lines[0]).map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const idx = {
    id: col('itemId'),
    name: col('name'),
    marketValue: col('marketValue'),
    historical: col('historical'),
    avgSalePrice: col('avgSalePrice'),
    saleRate: col('saleRate'),
    soldPerDay: col('soldPerDay'),
    updatedAt: col('updatedAt'),
  };
  if (idx.id < 0) throw new Error(`TSM CSV has no itemId column (header: ${header.join(',')})`);
  const num = (cells, i) => (i < 0 ? 0 : Number(cells[i]) || 0);
  let updatedAt = 0;
  const items = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const id = Number(cells[idx.id]);
    if (!Number.isInteger(id) || id <= 0) continue;
    updatedAt = Math.max(updatedAt, toUnix(idx.updatedAt < 0 ? '' : cells[idx.updatedAt]));
    items.push([
      id,
      num(cells, idx.marketValue),
      num(cells, idx.historical),
      num(cells, idx.avgSalePrice),
      Math.round(num(cells, idx.saleRate) * 10000) / 10000,
      Math.round(num(cells, idx.soldPerDay) * 100) / 100,
      idx.name < 0 ? '' : (cells[idx.name] ?? '').trim(),
    ]);
  }
  items.sort((a, b) => a[0] - b[0]);
  return { updatedAt, columns: header, items };
}

/** Auction house CSV -> { updatedAt, items: [[itemId, minBuyout, recent, marketValue, historical]] } */
export function parseTsmRealmCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { updatedAt: 0, items: [] };
  const header = splitLine(lines[0]).map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const idx = { id: col('itemId'), minBuyout: col('minBuyout'), recent: col('recent'), marketValue: col('marketValue'), historical: col('historical'), updatedAt: col('updatedAt') };
  if (idx.id < 0) throw new Error(`TSM CSV has no itemId column (header: ${header.join(',')})`);
  const num = (cells, i) => (i < 0 ? 0 : Math.round(Number(cells[i]) || 0));
  let updatedAt = 0;
  const items = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const id = Number(cells[idx.id]);
    if (!Number.isInteger(id) || id <= 0) continue;
    updatedAt = Math.max(updatedAt, toUnix(idx.updatedAt < 0 ? '' : cells[idx.updatedAt]));
    items.push([id, num(cells, idx.minBuyout), num(cells, idx.recent), num(cells, idx.marketValue), num(cells, idx.historical)]);
  }
  items.sort((a, b) => a[0] - b[0]);
  return { updatedAt, items };
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'forever-flips (github.com/VisanC/wowflips)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const iso = (t) => (t ? new Date(t * 1000).toISOString() : 'unknown');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const region of REGIONS) {
    const url = `${BASE}/${region}/region/items.csv`;
    try {
      const parsed = parseTsmCsv(await download(url));
      const out = { source: url, fetchedAt: Math.floor(Date.now() / 1000), updatedAt: parsed.updatedAt, items: parsed.items };
      await writeFile(`${OUT_DIR}/tsm-forever-${region}.json`, JSON.stringify(out));
      console.log(`TSM ${region}: ${parsed.items.length} items, updated ${iso(parsed.updatedAt)}`);
    } catch (e) {
      console.warn(`TSM ${region}: skipped (${e.message})`);
    }
    for (const house of houseSlugs(region)) {
      const houseUrl = `${BASE}/${region}/realm/${house}/items.csv`;
      try {
        const parsed = parseTsmRealmCsv(await download(houseUrl));
        const out = { source: houseUrl, fetchedAt: Math.floor(Date.now() / 1000), updatedAt: parsed.updatedAt, items: parsed.items };
        await writeFile(`${OUT_DIR}/tsm-forever-${region}-${house}.json`, JSON.stringify(out));
        console.log(`TSM ${region} ${house}: ${parsed.items.length} items, updated ${iso(parsed.updatedAt)}`);
      } catch (e) {
        console.warn(`TSM ${region} ${house}: skipped (${e.message})`);
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
