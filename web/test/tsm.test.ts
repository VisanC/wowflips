import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script without types
import { parseTsmCsv } from '../scripts/fetch-tsm.mjs';
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
