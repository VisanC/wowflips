// Skill-up planner: the cheapest way from one profession skill to another.
//
// A recipe can be used from its learn level. Below its yellow level (orange) every craft gives a
// point; from yellow to grey the chance falls in a straight line to zero:
// chance = (grey - skill) / (grey - yellow), the usual formula for classic professions.
// For each skill point we pick the recipe with the lowest expected net cost per point
// (cost of a craft minus what you get back for the product, divided by the chance).

import type { Recipe } from './types';

export type Color = 'locked' | 'orange' | 'yellow' | 'green' | 'grey';

export function learnLevel(r: Recipe): number {
  return r.learn ?? Math.min(r.yellow, r.grey);
}

export function skillUpChance(r: Recipe, skill: number): number {
  if (skill < learnLevel(r) || skill >= r.grey) return 0;
  if (skill < r.yellow) return 1;
  const span = r.grey - r.yellow;
  return span > 0 ? (r.grey - skill) / span : 0;
}

export function colorAt(r: Recipe, skill: number): Color {
  if (skill < learnLevel(r)) return 'locked';
  if (skill >= r.grey) return 'grey';
  if (skill < r.yellow) return 'orange';
  return skill < (r.yellow + r.grey) / 2 ? 'yellow' : 'green';
}

export interface LevelStep {
  recipe: Recipe;
  from: number; // skill at the start of this step
  to: number; // skill reached at its end
  crafts: number; // expected crafts (can be fractional)
  netEach: number; // cost of one craft minus what the product brings back
  total: number; // expected net cost of the step
  colorAtStart: Color;
}

export interface LevelPlan {
  steps: LevelStep[];
  total: number;
  crafts: number;
  reached: number; // = to, unless no recipe helps at some point
  stuckAt?: number;
}

/**
 * @param netCost  net copper per craft (cost minus resale), or undefined when it can't be priced
 */
export function planLeveling(recipes: Recipe[], from: number, to: number, netCost: (r: Recipe) => number | undefined): LevelPlan {
  const steps: LevelStep[] = [];
  const nets = new Map<number, number | undefined>();
  const net = (r: Recipe) => {
    if (!nets.has(r.spell)) nets.set(r.spell, netCost(r));
    return nets.get(r.spell);
  };
  let skill = from;
  for (; skill < to; skill++) {
    let best: { r: Recipe; chance: number; n: number; score: number } | undefined;
    for (const r of recipes) {
      const chance = skillUpChance(r, skill);
      if (!chance) continue;
      const n = net(r);
      if (n === undefined || !Number.isFinite(n)) continue;
      // A craft that makes money is worth doing however often it fails, but a recipe that
      // makes more per craft should still win, so profitable crafts score by profit alone.
      const score = n >= 0 ? n / chance : n;
      if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && chance > best.chance)) best = { r, chance, n, score };
    }
    if (!best) break;
    const crafts = 1 / best.chance;
    const last = steps[steps.length - 1];
    if (last && last.recipe.spell === best.r.spell) {
      last.to = skill + 1;
      last.crafts += crafts;
      last.total += best.n * crafts;
    } else {
      steps.push({ recipe: best.r, from: skill, to: skill + 1, crafts, netEach: best.n, total: best.n * crafts, colorAtStart: colorAt(best.r, skill) });
    }
  }
  return {
    steps,
    total: steps.reduce((s, x) => s + x.total, 0),
    crafts: steps.reduce((s, x) => s + x.crafts, 0),
    reached: skill,
    stuckAt: skill < to ? skill : undefined,
  };
}
