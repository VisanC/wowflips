// Recipe Master (an addon) ships a database of every Forever recipe: the skill needed to learn it,
// its skill-up levels, and whether a trainer teaches it or a vendor sells it. The site reads that
// database from your own copy of the addon, in the browser; it is stored here and never uploaded.

import { db } from './db';
import { isTable, luaAssignments, luaList, type LuaTable, type LuaValue } from './luaTable';

export interface RmRecipe {
  spell: number;
  skill: number;
  learn: number;
  /** Skill where it turns orange, yellow, green, grey. */
  colors?: [number, number, number, number];
  /** The item Recipe Master files it under: the recipe item for taught-by-item recipes, else the crafted item (or the spell). */
  key: number;
  isSpell?: boolean;
  trainer?: boolean;
  /** Cheapest vendor price in copper, when a vendor sells it for gold. */
  vendorCost?: number;
  /** Vendor price in another currency ("180 Merchant's Favor"), when it has no gold price. */
  vendorPrice?: string;
  faction?: 'Alliance' | 'Horde';
  spec?: number;
}

export interface RmData {
  version?: string;
  loadedAt: number;
  files: number;
  recipes: RmRecipe[];
}

const CURRENCIES: Record<string, string> = {
  tur: 'Tarnished Undermine Real',
  mfv: "Merchant's Favor",
  cct: 'Carved Centaur Totem',
  men: 'Malleable Essence of Nature',
};

/** "12svr63cpr" → 1263 copper; "180mfv" → 180 Merchant's Favor. */
export function parseCost(cost: string): { copper?: number; other?: string } {
  let copper = 0;
  let hasMoney = false;
  const other: string[] = [];
  for (const [, n, unit] of cost.matchAll(/(\d+)([a-z]{3})/g)) {
    const v = Number(n);
    if (unit === 'gld') copper += v * 10000;
    else if (unit === 'svr') copper += v * 100;
    else if (unit === 'cpr') copper += v;
    else {
      other.push(`${v} ${CURRENCIES[unit] ?? unit}`);
      continue;
    }
    hasMoney = true;
  }
  return { copper: hasMoney ? copper : undefined, other: other.length ? other.join(' + ') : undefined };
}

const num = (v: LuaValue | undefined): number | undefined => (typeof v === 'number' ? v : undefined);

export interface RmFile {
  path: string;
  text: string;
}

/** Which files of the addon folder to read. */
export function isRecipeMasterFile(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return /Database\/(Sources\/)?Recipes\/[^/]+\.lua$/i.test(p) || /RecipeMaster[^/]*\.toc$/i.test(p);
}

export function parseRecipeMaster(files: RmFile[]): RmData {
  const recipes = new Map<string, RmRecipe>(); // skill|key
  const sources = new Map<string, LuaTable>();
  let version: string | undefined;
  let used = 0;
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    if (/\.toc$/i.test(path)) {
      version ??= /^## Version:\s*(.+?)\s*$/m.exec(f.text)?.[1];
      continue;
    }
    let found = false;
    for (const { match, value } of luaAssignments(f.text, /rm\.recipeDB\[(\d+)\]/)) {
      found = true;
      const skill = Number(match[1]);
      if (!isTable(value)) continue;
      for (const [k, e] of Object.entries(value)) {
        if (!isTable(e)) continue;
        const spell = num(e.teaches);
        const learn = num(e.requiredSkill);
        if (spell === undefined || learn === undefined || e.isSpecialization) continue;
        const d = luaList(e.difficulty).map(num);
        const r: RmRecipe = { spell, skill, learn, key: Number(k) };
        if (d.length === 4 && d.every((x) => x !== undefined)) r.colors = d as [number, number, number, number];
        if (e.isSpell === true) r.isSpell = true;
        if (e.faction === 'Alliance' || e.faction === 'Horde') r.faction = e.faction;
        if (num(e.specialization)) r.spec = num(e.specialization);
        recipes.set(`${skill}|${k}`, r);
      }
    }
    for (const { match, value } of luaAssignments(f.text, /rm\.recipeSourceDB\[(\d+)\]/)) {
      found = true;
      if (!isTable(value)) continue;
      for (const [k, s] of Object.entries(value)) if (isTable(s)) sources.set(`${match[1]}|${k}`, s);
    }
    if (found) used++;
  }

  for (const [id, r] of recipes) {
    const s = sources.get(id);
    if (!s) continue;
    if (isTable(s.trainer) && Object.keys(s.trainer).length) r.trainer = true;
    if (isTable(s.vendor)) {
      for (const v of Object.values(s.vendor)) {
        if (!isTable(v) || typeof v.cost !== 'string') continue;
        const c = parseCost(v.cost);
        if (c.copper !== undefined && (r.vendorCost === undefined || c.copper < r.vendorCost)) r.vendorCost = c.copper;
        else if (c.copper === undefined && c.other) r.vendorPrice ??= c.other;
      }
      if (r.vendorCost !== undefined) r.vendorPrice = undefined;
    }
  }
  if (!recipes.size) throw new Error('No Recipe Master recipes found. Pick the RecipeMaster folder inside Interface\\AddOns.');
  return { version, loadedAt: Math.floor(Date.now() / 1000), files: used, recipes: [...recipes.values()] };
}

const KEY = 'recipemaster';

export async function loadRecipeMaster(): Promise<RmData | undefined> {
  try {
    return (await db.refdata.get(KEY))?.value as RmData | undefined;
  } catch {
    return undefined;
  }
}

export async function saveRecipeMaster(data: RmData): Promise<void> {
  await db.refdata.put({ key: KEY, value: data });
}

export async function clearRecipeMaster(): Promise<void> {
  await db.refdata.delete(KEY);
}

/** Read the chosen files (a folder pick) and keep only Recipe Master's database. */
export async function readRecipeMasterFiles(list: FileList | File[]): Promise<RmData> {
  const files: RmFile[] = [];
  for (const f of Array.from(list)) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (isRecipeMasterFile(path)) files.push({ path, text: await f.text() });
  }
  if (!files.length) throw new Error('That folder has no Recipe Master database. Pick World of Warcraft\\_forever_\\Interface\\AddOns\\RecipeMaster.');
  return parseRecipeMaster(files);
}

export const SPECIALIZATIONS: Record<number, string> = {
  20219: 'Gnomish',
  20222: 'Goblin',
  9787: 'Weaponsmith',
  9788: 'Armorsmith',
  17039: 'Swordsmith',
  17040: 'Hammersmith',
  17041: 'Axesmith',
  10656: 'Dragonscale',
  10658: 'Elemental',
  10660: 'Tribal',
};
