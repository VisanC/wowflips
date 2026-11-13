import { describe, expect, it } from 'vitest';
import { diffStates, packAuctions, summarize, type AuctionState, type RawAuction } from '../src/throughput';

const H = 3600;
const T0 = 1_800_000_000;

const c = (id: number, item: number, quantity: number, unit_price: number, time_left = 'LONG'): RawAuction => ({ id, item: { id: item }, quantity, unit_price, time_left });
const g = (id: number, item: number, buyout: number, time_left = 'LONG', quantity = 1): RawAuction => ({ id, item: { id: item }, quantity, buyout, time_left });

const state = (at: number, commodities: RawAuction[], items: RawAuction[] = [], itemsAt = at): AuctionState => ({
  house: 'eu-1-110',
  items: packAuctions(items, itemsAt),
  commodities: packAuctions(commodities, at),
});

const row = (rec: ReturnType<typeof diffStates>, item: number) => {
  const i = [...rec!.item].indexOf(item);
  return i < 0 ? undefined : { sold: rec!.sold[i], value: rec!.value[i], listed: rec!.listed[i], gone: rec!.gone[i], commodity: rec!.commodity[i] };
};

describe('diffStates', () => {
  const ORE = 3858;

  it('counts partly bought commodity auctions as sold', () => {
    const rec = diffStates(state(T0, [c(1, ORE, 20, 900)]), state(T0 + H, [c(1, ORE, 5, 900)]));
    expect(row(rec, ORE)).toMatchObject({ sold: 15, value: 15 * 900, gone: 0 });
    expect(rec!.hoursCommodities).toBe(1);
  });

  it('counts a vanished cheapest auction with time left as sold', () => {
    const rec = diffStates(state(T0, [c(1, ORE, 20, 900), c(2, ORE, 20, 950)]), state(T0 + H, [c(2, ORE, 20, 950)]));
    expect(row(rec, ORE)).toMatchObject({ sold: 20, gone: 0 });
  });

  it('treats a vanished auction priced above an untouched cheaper one as cancelled', () => {
    // 950 vanished but 900 is still there untouched: buyers always take 900 first, so 950 was cancelled.
    const rec = diffStates(state(T0, [c(1, ORE, 20, 900), c(2, ORE, 20, 950)]), state(T0 + H, [c(1, ORE, 20, 900), c(3, ORE, 20, 940)]));
    expect(row(rec, ORE)).toMatchObject({ sold: 0, gone: 20, listed: 20 });
  });

  it('a partly bought cheaper auction also proves pricier ones were not bought', () => {
    const rec = diffStates(state(T0, [c(1, ORE, 20, 900), c(2, ORE, 20, 950)]), state(T0 + H, [c(1, ORE, 5, 900)]));
    expect(row(rec, ORE)).toMatchObject({ sold: 15, gone: 20 });
  });

  it('allows same-price auctions to be bought in any order', () => {
    const rec = diffStates(state(T0, [c(1, ORE, 20, 900), c(2, ORE, 20, 900)]), state(T0 + H, [c(1, ORE, 20, 900)]));
    expect(row(rec, ORE)).toMatchObject({ sold: 20 });
  });

  it('does not count auctions that could have expired', () => {
    const prev = state(T0, [c(1, ORE, 20, 900, 'SHORT'), c(2, ORE, 10, 900, 'MEDIUM')]);
    expect(row(diffStates(prev, state(T0 + H, [])), ORE)).toMatchObject({ sold: 0, gone: 30 });
    // 20 minutes later a MEDIUM auction (30 min+ left) cannot have expired yet
    expect(row(diffStates(prev, state(T0 + 20 * 60, [])), ORE)).toMatchObject({ sold: 10, gone: 20 });
  });

  it('counts new auctions as listed', () => {
    const rec = diffStates(state(T0, []), state(T0 + H, [c(5, ORE, 40, 800), c(6, ORE, 2, 820)]));
    expect(row(rec, ORE)).toMatchObject({ listed: 42, sold: 0 });
  });

  it('gear: any vanished auction with time left counts (no cheapest-first rule)', () => {
    const RIFLE = 4383;
    const rec = diffStates(state(T0, [], [g(1, RIFLE, 10890), g(2, RIFLE, 24000)]), state(T0 + H, [], [g(1, RIFLE, 10890)]));
    expect(row(rec, RIFLE)).toMatchObject({ sold: 1, value: 24000, commodity: 0 });
    expect(rec!.hoursItems).toBe(1);
  });

  it('uses the price per unit for stacks of gear-type auctions', () => {
    const list = packAuctions([g(1, 4383, 3000, 'LONG', 3)], T0);
    expect(list.unit[0]).toBe(1000);
    expect(list.qty[0]).toBe(3);
  });

  it('skips snapshots too far apart, or not newer', () => {
    expect(diffStates(state(T0, [c(1, ORE, 20, 900)]), state(T0 + 4 * H, []))).toBeUndefined();
    expect(diffStates(state(T0, [c(1, ORE, 20, 900)]), state(T0, []))).toBeUndefined();
  });

  it('compares items and commodities separately when they update at different times', () => {
    const prev = state(T0, [c(1, ORE, 20, 900)], [g(9, 4383, 10000)], T0);
    const now = state(T0, [c(1, ORE, 20, 900)], [], T0 + H); // only the item list is newer
    const rec = diffStates(prev, now);
    expect(rec!.hoursCommodities).toBe(0);
    expect(rec!.hoursItems).toBe(1);
    expect(row(rec, 4383)).toMatchObject({ sold: 1 });
    expect(row(rec, ORE)).toBeUndefined();
  });
});

describe('summarize', () => {
  it('turns records into per-day rates and average prices', () => {
    const s0 = state(T0, [c(1, 3858, 20, 900), c(2, 3858, 30, 1000)]);
    const s1 = state(T0 + H, [c(2, 3858, 30, 1000), c(3, 3858, 10, 990)]);
    const s2 = state(T0 + 2 * H, [c(3, 3858, 4, 990)]);
    const t = summarize([diffStates(s0, s1)!, diffStates(s1, s2)!]);
    const f = t.flows.get(3858)!;
    // hour 1: 20 sold at 900. hour 2: 6 of #3 at 990 bought; #2 at 1000 vanished, but #3 at 990 still
    // has units left, so nobody bought at 1000: cancelled.
    expect(f.sold).toBe(20 + 6);
    expect(f.gone).toBe(30);
    expect(f.hours).toBe(2);
    expect(f.perDay).toBe(26 * 12);
    expect(f.avg).toBeCloseTo((20 * 900 + 6 * 990) / 26);
    expect(t.hoursCommodities).toBe(2);
    expect(t.records).toBe(2);
  });
});
