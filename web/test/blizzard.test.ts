import { afterEach, describe, expect, it, vi } from 'vitest';
import { agreement, aggregate } from '../src/aggregate';
import { ApiError, connect, nameOf } from '../src/blizzard';

// Response shapes as reported by people probing the (undocumented) Forever API.
const LAST_MODIFIED = 'Fri, 13 Nov 2026 11:05:00 GMT';
const routes: Record<string, unknown> = {
  '/data/wow/ruleset/index': { rulesets: [{ key: { href: 'x' }, name: 'PvP', id: 1 }, { key: { href: 'x' }, name: 'Normal', id: 2 }] },
  '/data/wow/ruleset/1/auctions/': { auctions: [{ key: { href: 'x' }, name: 'Alliance Auction House', id: 110 }, { key: { href: 'x' }, name: 'Horde Auction House', id: 111 }] },
  '/data/wow/ruleset/1/auctions/110': {
    id: 110,
    name: 'Alliance Auction House',
    ruleset: { key: { href: 'x' }, name: 'PvP', id: 1 },
    auctions: [
      { id: 1, item: { id: 4383 }, buyout: 10890, quantity: 1, time_left: 'LONG' },
      { id: 2, item: { id: 4383 }, buyout: 25000, quantity: 2, time_left: 'LONG' },
      { id: 3, item: { id: 9999 }, bid: 500, quantity: 1, time_left: 'SHORT' }, // bid-only: ignored
    ],
    commodities: { href: 'x' },
  },
  '/data/wow/ruleset/1/auctions/110/commodities': {
    auctions: [
      { id: 10, item: { id: 3858 }, quantity: 200, unit_price: 840, time_left: 'LONG' },
      { id: 11, item: { id: 3858 }, quantity: 50, unit_price: 860, time_left: 'LONG' },
      { id: 12, item: { id: 3860 }, quantity: 20, unit_price: 1199, time_left: 'LONG' },
    ],
  },
};

function mockFetch() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    calls.push(input);
    if (input.startsWith('https://oauth.battle.net/token')) {
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    }
    const url = new URL(input);
    expect(url.searchParams.get('namespace')).toBe('dynamic-forever-eu');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const body = routes[url.pathname];
    if (!body) return new Response('', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'last-modified': LAST_MODIFIED } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('ForeverApi', () => {
  it('lists rulesets and houses', async () => {
    mockFetch();
    const api = await connect('eu', ' id ', ' secret ');
    expect(await api.rulesets()).toEqual([{ id: 1, name: 'PvP' }, { id: 2, name: 'Normal' }]);
    expect(await api.houses(1)).toEqual([{ id: 110, name: 'Alliance Auction House' }, { id: 111, name: 'Horde Auction House' }]);
  });

  it('turns a house into scan rows (items per stack, commodities per unit)', async () => {
    const calls = mockFetch();
    const api = await connect('eu', 'id', 'secret');
    const snap = await api.houseSnapshot(1, 110);
    expect(snap.houseName).toBe('Alliance Auction House');
    expect(snap.rulesetName).toBe('PvP');
    expect(snap.itemAuctions).toBe(3);
    expect(snap.commodityAuctions).toBe(3);
    expect(snap.takenAt).toBe(Date.parse(LAST_MODIFIED) / 1000);
    expect(snap.rows).toEqual([
      [3858, 840, 250, [[840, 200], [860, 50]]],
      [3860, 1199, 20, [[1199, 20]]],
      [4383, 10890, 3, [[10890, 1], [12500, 2]]],
    ]);
    expect(calls.some((c) => c.includes('/auctions/110/commodities'))).toBe(true);
  });

  it('explains API errors', async () => {
    mockFetch();
    const api = await connect('eu', 'id', 'secret');
    await expect(api.houseSnapshot(1, 999)).rejects.toBeInstanceOf(ApiError);
    await expect(api.houseSnapshot(1, 999)).rejects.toThrow(/404/);
  });
});

describe('helpers', () => {
  it('reads plain and localized names', () => {
    expect(nameOf('PvP')).toBe('PvP');
    expect(nameOf({ en_US: 'PvP', de_DE: 'PvP-DE' })).toBe('PvP');
    expect(nameOf({ name: 'PvP', id: 1 })).toBe('PvP');
    expect(nameOf(undefined)).toBe('');
  });

  it('scores agreement between two scans', () => {
    const a = aggregate([{ item: 1, unit: 100, qty: 1 }, { item: 2, unit: 200, qty: 1 }, { item: 3, unit: 300, qty: 1 }]);
    const b = aggregate([{ item: 1, unit: 105, qty: 1 }, { item: 2, unit: 400, qty: 1 }, { item: 4, unit: 1, qty: 1 }]);
    expect(agreement(a, b)).toEqual({ common: 2, close: 1 });
  });
});
