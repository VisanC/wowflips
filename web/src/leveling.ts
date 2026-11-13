// Skill-up planner: the cheapest way from one profession skill to another.
//
// A recipe can be used from its learn level. Below its yellow level (orange) every craft gives a
// point; from yellow to grey the chance falls in a straight line to zero:
// chance = (grey - skill) / (grey - yellow), the usual formula for classic professions.
// For each skill point we pick the recipe with the lowest expected net cost per point
// (cost of a craft minus what you get back for the product, divided by the chance).

import type { Recipe } from './types';

export type Color = 'locked' | 'orange' | 'yellow' | 'green' | 'grey';

/** Skill needed to learn a recipe. When unknown (no Recipe Master data, no recipe item), its yellow level as a careful guess. */
export function learnLevel(r: Recipe): number {
  return r.learn ?? r.yellow;
}

export function learnLevelKnown(r: Recipe): boolean {
  return r.learn !== undefined;
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
  return skill < (r.green ?? (r.yellow + r.grey) / 2) ? 'yellow' : 'green';
}

export interface LevelStep {
  recipe: Recipe;
  from: number; // skill at the start of this step
  to: number; // skill reached at its end
  crafts: number; // expected crafts (can be fractional)
  netEach: number; // cost of one craft minus what the product brings back
  total: number; // expected net cost of the step
  colorAtStart: Color;
  learnCost: number; // one-time cost to learn the recipe for this step (0 if known or free)
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
export function planLeveling(
  recipes: Recipe[],
  from: number,
  to: number,
  netCost: (r: Recipe) => number | undefined,
  opts: { learnCost?: (r: Recipe) => number } = {},
): LevelPlan {
  const steps: LevelStep[] = [];
  const learned = new Set<number>();
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
      const learnCost = learned.has(best.r.spell) ? 0 : (opts.learnCost?.(best.r) ?? 0);
      learned.add(best.r.spell);
      steps.push({ recipe: best.r, from: skill, to: skill + 1, crafts, netEach: best.n, total: best.n * crafts + learnCost, colorAtStart: colorAt(best.r, skill), learnCost });
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

export interface SkillUp {
  recipe: Recipe;
  chance: number;
  color: Color;
  net: number; // net cost of one craft
  perPoint: number; // expected net cost per skill point (profit per craft when it makes money)
}

/** Every recipe that can give a point at this skill, cheapest per point first. */
export function skillUpsAt(recipes: Recipe[], skill: number, netCost: (r: Recipe) => number | undefined): SkillUp[] {
  const out: SkillUp[] = [];
  for (const r of recipes) {
    const chance = skillUpChance(r, skill);
    if (!chance) continue;
    const n = netCost(r);
    if (n === undefined || !Number.isFinite(n)) continue;
    out.push({ recipe: r, chance, color: colorAt(r, skill), net: n, perPoint: n >= 0 ? n / chance : n });
  }
  return out.sort((a, b) => a.perPoint - b.perPoint || b.chance - a.chance);
}
