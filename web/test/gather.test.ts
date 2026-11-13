import { describe, expect, it } from 'vitest';
import { Engine, ahMap, vendorPrices } from '../src/engine';
import { buildGameData } from '../src/gamedata';
import { gatherRecipes, gathersFor, skillName, skillRank } from '../src/gather';
import type { Character } from '../src/types';

const data = buildGameData(
  { build: 'test', generatedAt: '' },
  [
    [2770, 'Copper Ore', 1, 5, 20, 1, 20],
    [2771, 'Not Tin Ore', 1, 5, 20, 1, 20], // wrong name for the id: must be skipped
    [3858, 'Mithril Ore', 1, 250, 1000, 1, 20],
    [10620, 'Thorium Ore', 1, 250, 1000, 1, 20],
    [6291, 'Raw Brilliant Smallfish', 1, 1, 4, 1, 20],
    [2447, 'Peacebloom', 1, 10, 40, 1, 20],
  ],
  [],
  { 186: 'Mining' },
);

const char = (profs: [string, number][], skills?: [string, number, number][]): Character => ({
  key: 'T-R', name: 'T', realm: 'R', updatedAt: 0, bags: [],
  profs: profs.map(([n, r]) => ({ n, r, m: 225, t: 0, s: [] })),
  skills,
});

describe('gathering', () => {
  it('builds zero-cost recipes only for ids whose names match the game data', () => {
    const names = gatherRecipes(data).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['Mining: Copper Ore', 'Mining: Mithril Ore', 'Fishing: Raw Brilliant Smallfish', 'Herbalism: Peacebloom']));
    expect(names.some((n) => n.includes('Tin'))).toBe(false);
    const mithril = gatherRecipes(data).find((r) => r.out === 3858)!;
    expect(mithril).toMatchObject({ gather: true, reagents: [], skill: 186, yellow: 175, spell: -3858 });
  });

  it('filters by skill: known = within your skill, profession = any of your gathering professions', () => {
    const c = char([['Mining', 177]], [['Fishing', 120, 150]]);
    const known = gathersFor(data, c, 'known').map((r) => r.out);
    expect(known).toEqual(expect.arrayContaining([2770, 3858, 6291]));
    expect(known).not.toContain(10620); // thorium needs 245
    expect(known).not.toContain(2447); // no herbalism
    expect(gathersFor(data, c, 'profession').map((r) => r.out)).toContain(10620);
    expect(gathersFor(data, c, 'all').map((r) => r.out)).toContain(2447);
  });

  it('reads skill from the profession window or the skill list, whichever is higher', () => {
    expect(skillRank(char([['Mining', 170]], [['Mining', 177, 225]]), 'Mining')).toBe(177);
    expect(skillRank(char([]), 'Fishing')).toBeUndefined();
    expect(skillName(data, 356)).toBe('Fishing');
  });

  it('values a gather at its sale price, with nothing to pay', () => {
    const market = { ah: ahMap([[3858, 840, 100, [[840, 100]]]]), vendor: vendorPrices(data, [], []) };
    const e = new Engine(data, market, { cut: 0.05, craftMode: 'known', known: new Set() }).evaluate(gatherRecipes(data).find((r) => r.out === 3858)!);
    expect(e.cost).toBe(0);
    expect(e.complete).toBe(true);
    expect(e.profit).toBeCloseTo(840 * 0.95);
  });
});
