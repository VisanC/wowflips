// What it costs to learn a recipe you don't know yet, and whether you can learn it at all.

import type { Market } from './engine';
import type { GameData } from './gamedata';
import { recipeItemFor } from './recipeItems';
import type { Character, Recipe } from './types';

export interface LearnCost {
  how: 'trainer' | 'vendor' | 'ah' | 'item' | 'unknown';
  cost?: number; // copper, when known
  text?: string; // a price in another currency
  item?: number; // the recipe item
  guess?: boolean; // trainer assumed: no recipe data says so
}

/** Taught by a trainer: Recipe Master says so, or the addon saw it at your trainer, or (a guess) no recipe item teaches it. */
export function isTrainerRecipe(data: GameData, r: Recipe): boolean {
  if (r.rm) return r.rm.trainer;
  return !!r.trainerSeen || !recipeItemFor(data, r);
}

/** The cheapest known way to learn it. A trainer comes first when its price isn't known: trainers are cheap. */
export function learnCost(data: GameData, market: Market, r: Recipe): LearnCost {
  const opts: LearnCost[] = [];
  if (isTrainerRecipe(data, r)) opts.push({ how: 'trainer', cost: r.trainerCost, guess: !r.rm && !r.trainerSeen });
  if (r.rm?.vendorCost !== undefined) opts.push({ how: 'vendor', cost: r.rm.vendorCost });
  const item = recipeItemFor(data, r);
  const ah = item ? market.ah.get(item)?.price : undefined;
  if (item && ah !== undefined) opts.push({ how: 'ah', cost: ah, item });
  const trainer = opts.find((o) => o.how === 'trainer');
  if (trainer && trainer.cost === undefined) return trainer;
  const priced = opts.filter((o) => o.cost !== undefined).sort((a, b) => a.cost! - b.cost!);
  if (priced.length) return priced[0];
  if (r.rm?.vendorPrice) return { how: 'vendor', text: r.rm.vendorPrice };
  if (item) return { how: 'item', item };
  return { how: 'unknown' };
}

/** Specializations (Goblin, Armorsmith…) you have, judged by the recipes you know. */
export function knownSpecs(data: GameData, known: Set<number>): Set<number> {
  const out = new Set<number>();
  for (const spell of known) {
    const spec = data.recipesBySpell.get(spell)?.rm?.spec;
    if (spec) out.add(spec);
  }
  return out;
}

/** False for the other faction's recipes and for a specialization you don't have. */
export function canLearn(r: Recipe, char: Character | undefined, specs: Set<number>): boolean {
  if (r.rm?.faction && char?.faction && r.rm.faction !== char.faction) return false;
  if (r.rm?.spec && !specs.has(r.rm.spec)) return false;
  return true;
}
