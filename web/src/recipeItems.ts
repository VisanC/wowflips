// Recipe items ("Schematic: Moonsight Rifle", "Plans: …") found by name. A recipe with no such
// item is most likely taught by a trainer.

import type { GameData } from './gamedata';
import type { Recipe } from './types';

const PREFIXES = ['Schematic', 'Plans', 'Pattern', 'Recipe', 'Formula', 'Manual', 'Design'];
const PREFIX_RE = new RegExp(`^(${PREFIXES.join('|')}): `, 'i');

const indexes = new WeakMap<GameData, Map<string, number>>();

function index(data: GameData): Map<string, number> {
  let idx = indexes.get(data);
  if (!idx) {
    idx = new Map();
    for (const it of data.items.values()) if (PREFIX_RE.test(it.name)) idx.set(it.name.toLowerCase(), it.id);
    indexes.set(data, idx);
  }
  return idx;
}

/** The item that teaches this recipe, if one exists. */
export function recipeItemFor(data: GameData, r: Recipe): number | undefined {
  const idx = index(data);
  const names = new Set([r.name, data.items.get(r.out)?.name].filter((n): n is string => !!n));
  for (const name of names) {
    for (const p of PREFIXES) {
      const id = idx.get(`${p}: ${name}`.toLowerCase());
      if (id) return id;
    }
  }
  return undefined;
}
