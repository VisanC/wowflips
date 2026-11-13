// Downloads the WoW Forever DB2 tables from wago.tools and writes compact JSON
// into public/data/. Runs on your machine (`npm run data`) and in the GitHub
// Actions build. The browser never talks to wago.tools directly (it blocks CORS).
//
// Env overrides: WAGO_BRANCH (default wowf), WAGO_BUILD (default: latest), OUT_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, transform, TABLES } from './gamedata-transform.mjs';

const BRANCH = process.env.WAGO_BRANCH ?? 'wowf';
const OUT_DIR = process.env.OUT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const WAGO = process.env.WAGO_BASE ?? 'https://wago.tools';
const HEADERS = { 'User-Agent': 'forever-flips (personal AH tool; github pages build)' };

async function get(url, attempt = 1) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return get(url, attempt + 1);
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  return res;
}

const build = process.env.WAGO_BUILD ?? (await (await get(`${WAGO}/api/builds/${BRANCH}/latest`)).json()).version;
console.log(`wago.tools branch ${BRANCH}, build ${build}`);

const tables = {};
for (const name of TABLES) {
  const text = await (await get(`${WAGO}/db2/${name}/csv?build=${build}`)).text();
  tables[name] = parseCSV(text);
  console.log(`  ${name}: ${tables[name].length} rows`);
}

const data = transform(tables, build);
await mkdir(OUT_DIR, { recursive: true });
for (const [file, value] of Object.entries(data)) {
  await writeFile(join(OUT_DIR, `${file}.json`), JSON.stringify(value));
}
console.log(`wrote ${data.items.length} items, ${data.recipes.length} recipes, ${Object.keys(data.skills).length} professions to ${OUT_DIR}`);
console.log(`recipes with a learn level in the tables: ${data.recipes.filter((r) => r[8] > 0).length}, taught by an item: ${data.recipes.filter((r) => r[9] > 0).length}, of ${data.recipes.length}`);
