import { describe, expect, it } from 'vitest';
import { buildGameData } from '../src/gamedata';
import { localDay, summarizeLedger } from '../src/ledger';
import type { MailRecord } from '../src/types';

const data = buildGameData(
  { build: 'test', generatedAt: '' },
  [
    [3858, 'Mithril Ore', 1, 250, 1000, 1, 20],
    [3860, 'Mithril Bar', 1, 400, 1600, 1, 20],
    [4383, 'Moonsight Rifle', 2, 3183, 15915, 1, 1],
  ],
  [[10097, 'Smelt Mithril', 186, 175, 175, 3860, 1, [[3858, 1]]]],
  { 186: 'Mining' },
);
const NOW = 1794582760;
const mail = (kind: MailRecord['kind'], name: string, item: number, count: number, price: number, cut: number, ago: number): MailRecord =>
  ({ id: `${kind}${ago}${name}`, char: 'T-R', kind, name, item, count, price, cut, deposit: 0, t: NOW - ago });

describe('ledger', () => {
  const s = summarizeLedger(
    data,
    [
      mail('sold', 'Moonsight Rifle', 4383, 1, 105000, 5250, 3600),
      mail('sold', 'Mithril Bar', 0, 20, 24000, 1200, 2 * 86400), // id unknown: found by name
      mail('sold', 'Mithril Bar', 3860, 20, 26000, 1300, 40 * 86400), // older than 30 days
      mail('expired', 'Moonsight Rifle', 4383, 1, 0, 0, 86400),
      mail('cancelled', 'Mithril Bar', 3860, 20, 0, 0, 86400),
      mail('won', 'Mithril Ore', 3858, 20, 16800, 0, 2 * 86400),
      mail('sold', 'Strange Thing', 0, 1, 500, 25, 100), // unknown item
    ],
    [{ id: 'c1', char: 'T-R', spell: 10097, hour: NOW - 7200, count: 20 }],
    [{ id: 'p1', char: 'T-R', item: 3860, unit: 1250, qty: 40, t: NOW - 86400 }],
    { now: NOW, days: 7 },
  );
  const by = (key: string) => s.items.find((i) => i.key === key)!;

  it('adds up sales, purchases, expired and cancelled per item', () => {
    expect(by('4383')).toMatchObject({ soldUnits: 1, soldAuctions: 1, gross: 105000, net: 99750, expired: 1 });
    expect(by('3860')).toMatchObject({ soldUnits: 40, soldAuctions: 2, net: 22800 + 24700, cancelled: 1, crafted: 20, postedUnits: 40 });
    expect(by('3860').sales.map((x) => x.unit)).toEqual([1300, 1200]);
    expect(by('3858')).toMatchObject({ boughtUnits: 20, spent: 16800 });
    expect(by('n:Strange Thing')).toMatchObject({ item: 0, net: 475 });
  });

  it('totals the last 7 and 30 days and the sell-through', () => {
    expect(s.income7).toBe(99750 + 22800 + 475);
    expect(s.income30).toBe(99750 + 22800 + 475);
    expect(s.spend30).toBe(16800);
    expect(s.sellThrough30).toBeCloseTo(3 / 5); // 3 sales, 1 expired, 1 cancelled in 30 days
  });

  it('lists every one of the last days, oldest first, with zeros', () => {
    expect(s.days).toHaveLength(7);
    expect(s.days[6].day).toBe(localDay(NOW));
    expect(s.days.every((d, i) => i === 0 || d.day > s.days[i - 1].day)).toBe(true);
    expect(s.days.reduce((t, d) => t + d.income, 0)).toBe(99750 + 22800 + 475);
  });
});
