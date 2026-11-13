import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ahMap, vendorPrices } from '../src/engine';
import { buildGameData } from '../src/gamedata';
import { canLearn, isTrainerRecipe, knownSpecs, learnCost } from '../src/learnCost';
import { colorAt, learnLevel } from '../src/leveling';
import { LuaReader, luaAssignments, luaList } from '../src/luaTable';
import { isRecipeMasterFile, parseCost, parseRecipeMaster } from '../src/recipeMaster';
import { applyLearnData } from '../src/state';
import type { Character } from '../src/types';

const FIXTURE = join(__dirname, 'fixtures', 'recipemaster');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}
const files = walk(FIXTURE)
  .map((p) => ({ path: relative(FIXTURE, p), text: readFileSync(p, 'utf8') }))
  .filter((f) => isRecipeMasterFile(f.path));

describe('lua table reader', () => {
  it('reads tables, keys, lists, strings, comments', () => {
    const r = new LuaReader(`{ [1] = "a\\"b", key = 2, list = { 3, 4.5, -6 }, -- comment
      ['x y'] = true, n = nil, --[[ long
      comment ]] s = [[long
string]], }`);
    const t = r.value() as Record<string, unknown>;
    expect(t).toMatchObject({ 1: 'a"b', key: 2, 'x y': true, n: null, s: 'long\nstring' });
    expect(luaList(t.list as never)).toEqual([3, 4.5, -6]);
  });

  it('finds assignments to a table', () => {
    const found = luaAssignments('local _, rm = ...\nrm.db[7] = { a = 1 }\nrm.db[8] = {}\n', /rm\.db\[(\d+)\]/);
    expect(found.map((f) => [f.match[1], f.value])).toEqual([['7', { a: 1 }], ['8', {}]]);
  });
});

describe('recipe master', () => {
  it('parses prices', () => {
    expect(parseCost('12svr63cpr')).toEqual({ copper: 1263, other: undefined });
    expect(parseCost('1gld50svr')).toEqual({ copper: 15000, other: undefined });
    expect(parseCost('180mfv')).toEqual({ copper: undefined, other: "180 Merchant's Favor" });
  });

  it('reads learn levels, skill-up levels, trainers and vendor prices', () => {
    expect(files.map((f) => f.path.replace(/\\/g, '/')).sort()).toEqual([
      'RecipeMaster/RecipeMaster_Forever.toc',
      'RecipeMaster/Source/Database/Recipes/Engineering.lua',
      'RecipeMaster/Source/Database/Recipes/Mining.lua',
      'RecipeMaster/Source/Database/Sources/Recipes/Engineering.lua',
      'RecipeMaster/Source/Database/Sources/Recipes/Mining.lua',
    ]);
    const rm = parseRecipeMaster(files);
    expect(rm.version).toBe('9.9.9-test');
    expect(rm.files).toBe(4);
    const by = new Map(rm.recipes.map((r) => [r.spell, r]));
    expect(rm.recipes).toHaveLength(7); // the Journeyman rank and the specialization are not recipes
    expect(by.get(3938)).toEqual({ spell: 3938, skill: 202, learn: 105, key: 4371, colors: [105, 105, 130, 155], trainer: true });
    expect(by.get(3954)).toMatchObject({ learn: 145, key: 10000, vendorCost: 15000 });
    expect(by.get(3971)).toMatchObject({ spec: 20219, vendorPrice: "180 Merchant's Favor" });
    expect(by.get(3961)).toMatchObject({ faction: 'Horde', trainer: true });
    expect(by.get(3308)).toMatchObject({ skill: 186, learn: 155, trainer: true });
  });

  it('fails on a folder without the database', () => {
    expect(() => parseRecipeMaster([{ path: 'x.toc', text: '## Version: 1' }])).toThrow(/No Recipe Master recipes/);
  });
});

describe('learn data', () => {
  const data = () =>
    buildGameData(
      { build: 'test', generatedAt: '' },
      [
        [4371, 'Bronze Tube', 1, 100, 400, 1, 10],
        [4382, 'Bronze Framework', 1, 300, 1200, 1, 20],
        [4383, 'Moonsight Rifle', 2, 3183, 15915, 1, 1],
        [10000, 'Schematic: Moonsight Rifle', 2, 500, 2000, 1, 1],
        [4389, 'Gyrochronatom', 1, 400, 1600, 1, 20],
        [4397, 'Gnomish Cloaking Device', 3, 5000, 20000, 1, 1],
      ],
      [
        [3938, 'Bronze Tube', 202, 105, 155, 4371, 1, [[2841, 2]]],
        [3953, 'Bronze Framework', 202, 145, 170, 4382, 1, [[2841, 2]]],
        [3954, 'Moonsight Rifle', 202, 170, 195, 4383, 1, [[4371, 3]], 0, 10000, 160],
        [3961, 'Gyrochronatom', 202, 170, 190, 4389, 1, [[3575, 1]]],
        [3971, 'Gnomish Cloaking Device', 202, 220, 240, 4397, 1, [[4389, 4]]],
      ],
      { 202: 'Engineering' },
    );
  const market = (ah: [number, number][] = []) => ({ ah: ahMap(ah.map(([id, p]) => [id, p, 1, [[p, 1]]])), vendor: vendorPrices(data(), [], []) });
  const char = (trainers?: Character['trainers']): Character => ({ key: 'A-B', name: 'A', realm: 'B', faction: 'Alliance', updatedAt: 0, bags: [], profs: [], trainers });

  it('without Recipe Master: recipe items, then the trainer list, then a guess', () => {
    const d = data();
    applyLearnData(d, char([{ prof: 'Engineering', t: 1, list: [['Bronze Tube', 100, 600, 'available', 4371]] }]));
    const [tube, frame, rifle] = [3938, 3953, 3954].map((s) => d.recipesBySpell.get(s)!);
    expect([tube.learn, tube.trainerCost]).toEqual([100, 600]);
    expect([frame.learn, learnLevel(frame)]).toEqual([undefined, 145]); // guess: yellow
    expect(rifle.learn).toBe(160);
    expect(learnCost(d, market(), frame)).toMatchObject({ how: 'trainer', guess: true });
    expect(learnCost(d, market([[10000, 9000]]), rifle)).toEqual({ how: 'ah', cost: 9000, item: 10000 });
  });

  it('Recipe Master wins, and can be taken off again', () => {
    const d = data();
    const rm = parseRecipeMaster(files);
    applyLearnData(d, char([{ prof: 'Engineering', t: 1, list: [['Bronze Tube', 100, 600, 'available', 4371]] }]), rm);
    const [tube, frame, rifle, gyro, cloak] = [3938, 3953, 3954, 3961, 3971].map((s) => d.recipesBySpell.get(s)!);
    expect([tube.learn, tube.trainerCost]).toEqual([105, 600]); // level from Recipe Master, price from your trainer
    expect([frame.learn, frame.yellow, frame.green, frame.grey]).toEqual([140, 145, 158, 170]);
    expect(colorAt(frame, 157)).toBe('yellow');
    expect(colorAt(frame, 158)).toBe('green');
    expect(rifle.learn).toBe(145);
    expect(isTrainerRecipe(d, rifle)).toBe(false);
    // vendor 1g50s beats the AH at 2g, the AH beats it at 1g
    expect(learnCost(d, market([[10000, 20000]]), rifle)).toEqual({ how: 'vendor', cost: 15000 });
    expect(learnCost(d, market([[10000, 10000]]), rifle)).toEqual({ how: 'ah', cost: 10000, item: 10000 });
    expect(learnCost(d, market(), frame)).toEqual({ how: 'trainer', cost: undefined, guess: false });
    expect(learnCost(d, market(), cloak)).toEqual({ how: 'vendor', text: "180 Merchant's Favor" });
    // the other faction's recipes and a specialization you don't have
    const specs = knownSpecs(d, new Set([3938]));
    expect(canLearn(gyro, char(), specs)).toBe(false);
    expect(canLearn(cloak, char(), specs)).toBe(false);
    expect(canLearn(cloak, char(), knownSpecs(d, new Set([3971])))).toBe(true);
    expect(canLearn(tube, char(), specs)).toBe(true);

    applyLearnData(d, char());
    expect([frame.learn, frame.yellow, frame.green, frame.grey, frame.rm]).toEqual([undefined, 145, undefined, 170, undefined]);
    expect([rifle.learn, rifle.teachItem]).toEqual([160, 10000]);
  });
});
