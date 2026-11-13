import { describe, expect, it } from 'vitest';
import { underMarket, vendorFlips } from '../src/deals';
import { ahMap, vendorPrices } from '../src/engine';
import { buildGameData } from '../src/gamedata';
import { colorAt, planLeveling, skillUpChance } from '../src/leveling';
import { recipeItemFor } from '../src/recipeItems';
import { parseTsmFile } from '../src/tsm';
import type { Recipe } from '../src/types';

const data = buildGameData(
  { build: 'test', generatedAt: '' },
  [
    [3858, 'Mithril Ore', 1, 250, 1000, 1, 20],
    [4383, 'Moonsight Rifle', 2, 3183, 15915, 1, 1],
    [10000, 'Schematic: Moonsight Rifle', 2, 500, 2000, 1, 1],
    [2841, 'Bronze Bar', 1, 50, 200, 1, 20],
  ],
  [
    [3954, 'Moonsight Rifle', 202, 170, 195, 4383, 1, [[2841, 3]], 160],
    [2659, 'Smelt Bronze', 186, 65, 115, 2841, 2, [[2841, 1]]],
  ],
  { 186: 'Mining', 202: 'Engineering' },
);

describe('deals', () => {
  it('finds vendor flips with units and profit from the cheap levels', () => {
    const market = { ah: ahMap([[3858, 200, 50, [[200, 5], [240, 10], [300, 35]]], [2841, 60, 10, [[60, 10]]]]), vendor: vendorPrices(data, [], []) };
    const flips = vendorFlips(data, market);
    expect(flips).toEqual([{ item: 3858, price: 200, vendor: 250, units: 15, profit: 5 * 50 + 10 * 10, more: false }]);
  });

  it('finds listings under the TSM price for items that sell, with resale after the cut', () => {
    const market = { ah: ahMap([[3858, 500, 100, [[500, 20], [600, 30], [900, 50]]], [2841, 100, 5, [[100, 5]]]]), vendor: vendorPrices(data, [], []) };
    const tsm = parseTsmFile('eu', { items: [[3858, 1000, 1000, 1000, 0.5, 300], [2841, 200, 200, 200, 0.5, 0.2]] });
    const deals = underMarket(market, tsm, { maxPct: 0.7, minSold: 1, minProfit: 0, cut: 0.05 });
    expect(deals).toHaveLength(1); // bronze bar sells too slowly
    expect(deals[0]).toMatchObject({ item: 3858, price: 500, reference: 1000, units: 50, profitEach: 450, more: false });
    expect(deals[0].profit).toBeCloseTo(20 * 450 + 30 * 350);
    expect(underMarket(market, tsm, { maxPct: 0.4, minSold: 1, minProfit: 0, cut: 0.05 })).toHaveLength(0);
  });
});

describe('recipe items', () => {
  it('finds the schematic that teaches a recipe by name', () => {
    expect(recipeItemFor(data, data.recipesBySpell.get(3954)!)).toBe(10000);
    expect(recipeItemFor(data, data.recipesBySpell.get(2659)!)).toBeUndefined();
  });
});

describe('leveling', () => {
  const r = (spell: number, learn: number, yellow: number, grey: number): Recipe => ({ spell, name: `R${spell}`, skill: 202, learn, yellow, grey, out: 1, qty: 1, reagents: [] });

  it('uses the classic skill-up chances and colors', () => {
    const x = r(1, 100, 120, 160);
    expect(skillUpChance(x, 99)).toBe(0);
    expect(skillUpChance(x, 110)).toBe(1);
    expect(skillUpChance(x, 140)).toBe(0.5);
    expect(skillUpChance(x, 160)).toBe(0);
    expect([99, 110, 125, 145, 160].map((s) => colorAt(x, s))).toEqual(['locked', 'orange', 'yellow', 'green', 'grey']);
  });

  it('picks the cheapest expected cost per point and merges steps', () => {
    const cheapGreen = r(1, 100, 100, 130); // 10c, but its chance falls off
    const pricyOrange = r(2, 100, 140, 160); // 25c, always a point until 140
    const plan = planLeveling([cheapGreen, pricyOrange], 100, 130, (x) => (x.spell === 1 ? 10 : 25));
    // cheapGreen while 10/chance < 25, i.e. chance > 0.4 -> skill < 118; at 118 it is a tie and the sure point wins
    expect(plan.steps.map((s) => [s.recipe.spell, s.from, s.to])).toEqual([[1, 100, 118], [2, 118, 130]]);
    expect(plan.reached).toBe(130);
    expect(plan.stuckAt).toBeUndefined();
    expect(plan.total).toBeCloseTo(plan.steps.reduce((t, s) => t + s.total, 0));
  });

  it('stops where no recipe gives skill', () => {
    const plan = planLeveling([r(1, 1, 10, 20)], 5, 30, () => 5);
    expect(plan.reached).toBe(20);
    expect(plan.stuckAt).toBe(20);
  });

  it('learn level from the game data, or yellow when missing', () => {
    expect(data.recipesBySpell.get(3954)!.learn).toBe(160);
    expect(data.recipesBySpell.get(2659)!.learn).toBe(65);
  });
});
