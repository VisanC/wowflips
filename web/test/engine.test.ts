import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeExport } from '../src/decode';
import { Engine, ahMap, compareScans, vendorPrices, type EngineOptions } from '../src/engine';
import { buildGameData } from '../src/gamedata';

// Real Forever item ids and recipes (from wago.tools build 1.60.1.70938).
const data = buildGameData(
  { build: 'test', generatedAt: '' },
  [
    [3858, 'Mithril Ore', 1, 250, 1000, 1, 20],
    [3860, 'Mithril Bar', 1, 400, 1600, 1, 20],
    [2840, 'Copper Bar', 1, 10, 40, 1, 20],
    [3576, 'Tin Bar', 1, 25, 100, 1, 20],
    [2841, 'Bronze Bar', 1, 50, 200, 1, 20],
    [2880, 'Weak Flux', 1, 25, 100, 1, 10],
    [2592, 'Wool Cloth', 1, 33, 135, 1, 20],
    [4371, 'Bronze Tube', 1, 100, 400, 1, 10],
    [4375, 'Whirring Bronze Gizmo', 1, 100, 400, 1, 10],
    [4400, 'Heavy Stock', 1, 500, 2000, 1, 10],
    [1705, 'Lesser Moonstone', 2, 400, 1600, 1, 20],
    [4383, 'Moonsight Rifle', 2, 3183, 15915, 1, 1],
  ],
  [
    [10097, 'Smelt Mithril', 186, 175, 175, 3860, 1, [[3858, 1]]],
    [2659, 'Smelt Bronze', 186, 65, 115, 2841, 2, [[2840, 1], [3576, 1]]],
    [3938, 'Bronze Tube', 202, 105, 155, 4371, 1, [[2841, 2], [2880, 1]]],
    [3942, 'Whirring Bronze Gizmo', 202, 125, 150, 4375, 1, [[2841, 2], [2592, 1]]],
    [3954, 'Moonsight Rifle', 202, 170, 195, 4383, 1, [[4371, 3], [4375, 3], [4400, 1], [1705, 2]]],
  ],
  { 186: 'Mining', 202: 'Engineering' },
);

const vendor = vendorPrices(data, [2880, 4400], []);
const opts = (known: number[], craftMode: EngineOptions['craftMode'] = 'known'): EngineOptions => ({
  cut: 0.05,
  craftMode,
  known: new Set(known),
});

describe('Engine.unitCost', () => {
  it('prefers smelting when ore is cheaper than bars', () => {
    const market = { ah: ahMap([[3858, 840, 2717, []], [3860, 1199, 208, []]]), vendor };
    const src = new Engine(data, market, opts([10097])).unitCost(3860);
    expect(src.kind).toBe('craft');
    expect(src.unit).toBe(840);
  });

  it('ignores recipes you do not know in "known" mode', () => {
    const market = { ah: ahMap([[3858, 840, 2717, []], [3860, 1199, 208, []]]), vendor };
    expect(new Engine(data, market, opts([])).unitCost(3860)).toEqual({ kind: 'ah', unit: 1199 });
  });

  it('uses vendor prices for vendor reagents and divides by yield', () => {
    // Bronze bars: copper 164 + tin 150 = 314 for 2 bars = 157 each; flux from vendor 100.
    const market = { ah: ahMap([[2840, 164, 100, []], [3576, 150, 100, []], [2841, 175, 100, []]]), vendor };
    const e = new Engine(data, market, opts([2659, 3938]));
    expect(e.unitCost(2841).unit).toBe(157);
    const tube = e.unitCost(4371);
    expect(tube.kind).toBe('craft');
    expect(tube.unit).toBe(157 * 2 + 100);
  });

  it('returns none when nothing is available', () => {
    const e = new Engine(data, { ah: new Map(), vendor: new Map() }, opts([]));
    expect(e.unitCost(1705).kind).toBe('none');
  });
});

describe('Engine.evaluate', () => {
  it('prices the Moonsight Rifle from today\'s numbers', () => {
    const market = {
      ah: ahMap([
        [4371, 399, 478, []],
        [4375, 410, 457, []],
        [4400, 1888, 24, []],
        [1705, 600, 216, []],
        [4383, 10890, 15, []],
      ]),
      vendor,
    };
    const r = data.recipesBySpell.get(3954)!;
    const inv = new Map([[4371, 6], [4375, 6], [4400, 2], [1705, 4]]);
    const ev = new Engine(data, market, opts([3954])).evaluate(r, inv);
    // 3*399 + 3*410 + 1888 + 2*600 = 5515
    expect(ev.cost).toBe(5515);
    expect(ev.channel).toBe('ah');
    expect(ev.revenue).toBeCloseTo(10890 * 0.95);
    expect(ev.profit).toBeCloseTo(10890 * 0.95 - 5515);
    expect(ev.craftableNow).toBe(2);
  });

  it('falls back to the vendor when the AH pays less', () => {
    const market = { ah: ahMap([[4383, 2000, 3, []], [4371, 1, 1, []], [4375, 1, 1, []], [1705, 1, 1, []]]), vendor };
    const ev = new Engine(data, market, opts([3954])).evaluate(data.recipesBySpell.get(3954)!);
    expect(ev.channel).toBe('vendor');
    expect(ev.revenue).toBe(3183);
  });

  it('survives recipe cycles', () => {
    const cyclic = buildGameData(
      { build: 't', generatedAt: '' },
      [[1, 'A', 1, 1, 1, 1, 1], [2, 'B', 1, 1, 1, 1, 1]],
      [[100, 'A from B', 1, 0, 0, 1, 1, [[2, 1]]], [200, 'B from A', 1, 0, 0, 2, 1, [[1, 1]]]],
      {},
    );
    const e = new Engine(cyclic, { ah: ahMap([[1, 50, 1, []]]), vendor: new Map() }, opts([], 'all'));
    expect(e.unitCost(2).unit).toBe(50);
    expect(e.unitCost(1).unit).toBe(50);
  });
});

describe('compareScans', () => {
  it('flags this morning\'s Mithril Bar buyout', () => {
    const before = ahMap([[3860, 950, 1406, []], [3858, 890, 3534, []]]);
    const after = ahMap([[3860, 1199, 208, []], [3858, 840, 2717, []]]);
    const { boughtOut, crashed } = compareScans(before, after);
    expect(boughtOut.map((c) => c.item)).toEqual([3860]);
    expect(crashed).toEqual([]);
  });
});

describe('decodeExport', () => {
  it('decodes a string produced by the Lua addon', async () => {
    const text = readFileSync(new URL('./fixtures/export-small.txt', import.meta.url), 'utf8');
    const d = await decodeExport(text);
    expect(d.v).toBe(1);
    expect(d.char.n).toBe('Tudor');
    expect(d.ah?.i.length).toBeGreaterThan(50);
    expect(d.profs[0].s).toEqual([3938, 3954, 3962]);
    expect(d.vend).toEqual(expect.arrayContaining([[2880, 100, expect.any(Number)], [3371, 4, expect.any(Number)]]));
  });

  it('accepts line breaks from copy-paste and rejects junk', async () => {
    const text = readFileSync(new URL('./fixtures/export-small.txt', import.meta.url), 'utf8');
    const wrapped = text.replace(/(.{76})/g, '$1\n');
    await expect(decodeExport(wrapped)).resolves.toBeTruthy();
    await expect(decodeExport('hello')).rejects.toThrow(/FLIPX1/);
    await expect(decodeExport('FLIPX1:AAAA')).rejects.toThrow(/damaged/);
  });
});

import { ahBuyCost, buildShoppingList } from '../src/shopping';

describe('strategies', () => {
  // Bronze bars are cheaper to smelt (157 each) than to buy (175); tubes are cheaper to buy (399) than to craft (414).
  const market = {
    ah: ahMap([
      [2840, 164, 100, []], [3576, 150, 100, []], [2841, 175, 3451, [[175, 40], [180, 100]]],
      [4371, 399, 478, [[399, 5], [420, 20], [450, 100]]], [4375, 410, 457, []], [4400, 1888, 24, []],
      [1705, 600, 216, []], [2592, 138, 4084, []], [4383, 10890, 15, []],
    ]),
    vendor,
  };
  const known = [2659, 3938, 3942, 3954];
  const rifle = data.recipesBySpell.get(3954)!;
  const engine = (strategy: 'best' | 'buy' | 'craft') => new Engine(data, market, { ...opts(known), strategy });

  it('buy everything never crafts sub-components', () => {
    expect(engine('buy').unitCost(4371)).toEqual({ kind: 'ah', unit: 399 });
    expect(engine('buy').evaluate(rifle).cost).toBe(3 * 399 + 3 * 410 + 1888 + 2 * 600);
  });

  it('craft everything crafts even when buying is cheaper', () => {
    const tube = engine('craft').unitCost(4371);
    expect(tube.kind).toBe('craft');
    expect(tube.unit).toBe(157 * 2 + 100); // smelted bronze + vendor flux
  });

  it('best mix picks per item and is never worse than the other two', () => {
    const e = engine('best');
    expect(e.unitCost(4371).kind).toBe('ah'); // 399 < 414
    expect(e.unitCost(4375).kind).toBe('ah'); // 410 < 2*157+138 = 452
    const costs = (['best', 'buy', 'craft'] as const).map((s) => engine(s).evaluate(rifle).cost);
    expect(costs[0]).toBeLessThanOrEqual(costs[1]);
    expect(costs[0]).toBeLessThanOrEqual(costs[2]);
  });

  it('prices AH purchases along the listed levels', () => {
    expect(ahBuyCost(market, 4371, 3)).toEqual({ total: 3 * 399, estimated: false });
    expect(ahBuyCost(market, 4371, 15)).toEqual({ total: 5 * 399 + 10 * 420, estimated: false });
    expect(ahBuyCost(market, 4371, 200)).toEqual({ total: 5 * 399 + 20 * 420 + 175 * 450, estimated: true });
  });

  it('builds a craft-everything shopping list using bags/bank first', () => {
    const inventory = new Map([[4371, 6], [2840, 10]]); // 6 tubes, 10 copper bars
    const list = buildShoppingList(data, market, engine('craft'), rifle, 5, { inventory, cut: 0.05 });
    // 5 rifles need 15 tubes: 6 from bank, craft 9 -> 18 bronze bars; 15 gizmos -> 30 bronze bars.
    // 48 bronze bars = 24 smelts -> 24 copper (10 from bags, buy 14) + 24 tin.
    const steps = Object.fromEntries(list.steps.map((s) => [s.recipe.name, s.crafts]));
    expect(steps).toEqual({ 'Smelt Bronze': 24, 'Bronze Tube': 9, 'Whirring Bronze Gizmo': 15, 'Moonsight Rifle': 5 });
    expect(list.steps[0].recipe.name).toBe('Smelt Bronze'); // deepest first
    expect(list.steps.at(-1)!.recipe.name).toBe('Moonsight Rifle');
    const buy = Object.fromEntries(list.buy.map((b) => [b.item, [b.qty, b.source]]));
    expect(buy).toEqual({ 2840: [14, 'ah'], 3576: [24, 'ah'], 2880: [9, 'vendor'], 2592: [15, 'ah'], 4400: [5, 'ah'], 1705: [10, 'ah'] });
    expect(Object.fromEntries(list.fromStock.map((s) => [s.item, s.qty]))).toEqual({ 4371: 6, 2840: 10 });
    expect(list.revenue).toBeCloseTo(5 * 10890 * 0.95);
  });

  it('buy-everything list just buys the direct reagents', () => {
    const list = buildShoppingList(data, market, engine('buy'), rifle, 2, { cut: 0.05 });
    expect(list.steps.map((s) => s.recipe.name)).toEqual(['Moonsight Rifle']);
    expect(Object.fromEntries(list.buy.map((b) => [b.item, b.qty]))).toEqual({ 4371: 6, 4375: 6, 4400: 2, 1705: 4 });
    expect(list.cashNeeded).toBe(5 * 399 + 1 * 420 + 6 * 410 + 2 * 1888 + 4 * 600);
  });
});

describe('ties', () => {
  it('smelts when ore and bar cost the same (prefers the raw material)', () => {
    const market = { ah: ahMap([[3858, 900, 100, [[900, 100]]], [3860, 900, 100, [[900, 100]]]]), vendor };
    const best = new Engine(data, market, { ...opts([10097]), strategy: 'best' }).unitCost(3860);
    expect(best.kind).toBe('craft');
    expect(best.unit).toBe(900);
  });
  it('still buys the bar when it is cheaper by a copper', () => {
    const market = { ah: ahMap([[3858, 900, 100, [[900, 100]]], [3860, 899, 100, [[899, 100]]]]), vendor };
    expect(new Engine(data, market, { ...opts([10097]), strategy: 'best' }).unitCost(3860).kind).toBe('ah');
  });
});
