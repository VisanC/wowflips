import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script without types
import { houseSlugs, parseTsmCsv, parseTsmRealmCsv } from '../scripts/fetch-tsm.mjs';
import { parseTsmFile } from '../src/tsm';

// Same columns as public-data.tradeskillmaster.com/forever/{region}/region/items.csv
const CSV = [
  'itemId,name,marketValue,historical,avgSalePrice,saleRate,soldPerDay,updatedAt',
  '3858,Mithril Ore,840,910,820,0.4123,1532.5,2026-11-13T04:00:00Z',
  '4383,"Moonsight Rifle, Fine",10890,11500,0,0,0,2026-11-13T04:00:00Z',
  'oops,broken line,1,1,1,1,1,',
  '',
].join('\n');

describe('TSM public data', () => {
  it('parses the region CSV by column name, quotes included, skipping bad rows', () => {
    const r = parseTsmCsv(CSV);
    expect(r.items).toEqual([
      [3858, 840, 910, 820, 0.4123, 1532.5, 'Mithril Ore'],
      [4383, 10890, 11500, 0, 0, 0, 'Moonsight Rifle, Fine'],
    ]);
    expect(r.updatedAt).toBe(Date.parse('2026-11-13T04:00:00Z') / 1000);
  });

  it('copes with reordered columns and unix timestamps', () => {
    const r = parseTsmCsv('soldPerDay,itemId,updatedAt,marketValue\n12,2770,1794500000,100\n');
    expect(r.items).toEqual([[2770, 100, 0, 0, 0, 12, '']]);
    expect(r.updatedAt).toBe(1794500000);
  });

  it('turns the site file into a lookup map', () => {
    const t = parseTsmFile('eu', { updatedAt: 5, fetchedAt: 6, items: parseTsmCsv(CSV).items });
    expect(t.items.get(3858)).toEqual({ marketValue: 840, historical: 910, avgSalePrice: 820, saleRate: 0.4123, soldPerDay: 1532.5 });
    expect(t.region).toBe('eu');
    expect(t.names.get(4383)).toBe('Moonsight Rifle, Fine');
  });
});

describe('TSM auction house files', () => {
  it('reads the realm file by column name', async () => {
    const r = parseTsmRealmCsv('historical,itemId,minBuyout,name,recent,marketValue,updatedAt\n130,2770,95,"Copper Ore",110,120,2026-11-14T15:00:00Z\n0,abc,1,x,1,1,\n');
    expect(r.items).toEqual([[2770, 95, 110, 120, 130]]);
    expect(r.updatedAt).toBe(Date.parse('2026-11-14T15:00:00Z') / 1000);
    expect(houseSlugs('eu')).toContain('roleplay-pvp-alliance');
    expect(houseSlugs('kr')).toEqual(['normal-alliance', 'normal-horde', 'pvp-alliance', 'pvp-horde']);
  });

  it('finds your auction house from the realm name and faction', async () => {
    const { tsmHouseSlug } = await import('../src/tsm');
    expect(tsmHouseSlug('CAMWOW EU4 Realm 8 PvP', 'Alliance')).toBe('pvp-alliance');
    expect(tsmHouseSlug('Some Realm Roleplay PvP', 'Horde')).toBe('roleplay-pvp-horde');
    expect(tsmHouseSlug('Some Realm Roleplay', 'Horde')).toBe('roleplay-horde');
    expect(tsmHouseSlug('Some Realm Normal', 'Alliance')).toBe('normal-alliance');
    expect(tsmHouseSlug('Test Realm', 'Alliance', 15)).toBe('roleplay-pvp-alliance');
    expect(tsmHouseSlug('Test Realm', 'Alliance')).toBeUndefined();
    expect(tsmHouseSlug('X PvP', undefined)).toBeUndefined();
  });

  it("uses TSM's newer scan for prices, keeping the older scan's quantity", async () => {
    const { applyTsmHouse } = await import('../src/state');
    const { ahMap } = await import('../src/engine');
    const { parseTsmHouseFile } = await import('../src/tsm');
    const house = parseTsmHouseFile('eu', 'pvp-alliance', { updatedAt: 2000, items: [[2770, 95, 110, 120, 130], [2771, 0, 0, 50, 50]] });
    const market = { ah: ahMap([[2770, 200, 40, [[200, 40]]], [2771, 300, 5, [[300, 5]]]], 3), vendor: new Map<number, number>() };
    applyTsmHouse(market, house, 3);
    expect(market.ah.get(2770)).toMatchObject({ min: 95, qty: 40, price: 110, tsmAt: 2000 });
    expect(market.ah.get(2771)).toMatchObject({ min: 300, price: 300 }); // nothing listed on TSM: the older scan stays
    applyTsmHouse(market, house, 1);
    expect(market.ah.get(2770)).toMatchObject({ min: 95, price: 95 }); // "lowest listing" setting
  });
});
