import type { Item, Recipe } from './types';

export interface GameData {
  build: string;
  generatedAt: string;
  items: Map<number, Item>;
  recipes: Recipe[];
  recipesBySpell: Map<number, Recipe>;
  recipesByOutput: Map<number, Recipe[]>;
  skills: Map<number, string>;
}

type RawItem = [number, string, number, number, number, number, number];
type RawRecipe = [number, string, number, number, number, number, number, [number, number][], number?, number?, number?];

export function buildGameData(
  meta: { build: string; generatedAt: string },
  rawItems: RawItem[],
  rawRecipes: RawRecipe[],
  rawSkills: Record<string, string>,
): GameData {
  const items = new Map<number, Item>();
  for (const [id, name, quality, sell, buy, vstack, stack] of rawItems) {
    items.set(id, { id, name, quality, sell, buy, vstack, stack });
  }
  const recipes: Recipe[] = rawRecipes.map(([spell, name, skill, yellow, grey, out, qty, reagents, learnMin, teachItem, teachRank]) => {
    // Known learn level: the recipe item's required skill, or a real value from the tables.
    const learnBase = (teachItem && teachRank) || learnMin || undefined;
    return { spell, name, skill, yellow, grey, out, qty, reagents, learnBase, learn: learnBase, teachItem: teachItem || undefined };
  });
  const recipesBySpell = new Map(recipes.map((r) => [r.spell, r]));
  const recipesByOutput = new Map<number, Recipe[]>();
  for (const r of recipes) {
    const list = recipesByOutput.get(r.out) ?? [];
    list.push(r);
    recipesByOutput.set(r.out, list);
  }
  const skills = new Map(Object.entries(rawSkills).map(([k, v]) => [Number(k), v]));
  return { build: meta.build, generatedAt: meta.generatedAt, items, recipes, recipesBySpell, recipesByOutput, skills };
}

export async function loadGameData(base = import.meta.env.BASE_URL): Promise<GameData> {
  const get = async <T>(file: string): Promise<T> => {
    const res = await fetch(`${base}data/${file}.json`);
    if (!res.ok) throw new Error(`Missing game data (${file}.json). Run "npm run data" first.`);
    return res.json() as Promise<T>;
  };
  const [meta, items, recipes, skills] = await Promise.all([
    get<{ build: string; generatedAt: string }>('meta'),
    get<RawItem[]>('items'),
    get<RawRecipe[]>('recipes'),
    get<Record<string, string>>('skills'),
  ]);
  return buildGameData(meta, items, recipes, skills);
}
