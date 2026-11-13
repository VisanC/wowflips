// Blizzard Game Data API for WoW: Forever (undocumented; found by community probing).
//
//   namespace   dynamic-forever-{region}
//   rulesets    /data/wow/ruleset/index                       (1 PvP, 2 Normal, 3 Roleplay, 15 Roleplay PvP)
//   houses      /data/wow/ruleset/{id}/auctions/              (trailing slash required)
//   items       /data/wow/ruleset/{id}/auctions/{houseId}     (gear etc.: buyout for the whole stack)
//   commodities /data/wow/ruleset/{id}/auctions/{houseId}/commodities  (ore, bars: unit_price)
//
// Every ruleset lists the same houses; the house itself says which ruleset it belongs to.
// Credentials are typed into Settings and kept only in this browser's localStorage.

import { aggregate, type Listing } from './aggregate';
import type { AhExportRow } from './types';

const LOCALE = 'en_GB';

export class ApiError extends Error {
  constructor(public status: number, path: string) {
    super(
      status === 401 ? 'Blizzard rejected the token. Check the client ID and secret.'
      : status === 403 ? `Blizzard refused access to ${path} (403).`
      : status === 404 ? `Blizzard has no data at ${path} (404). The Forever API is undocumented and may have changed.`
      : status === 429 ? 'Blizzard rate limit hit (429). Wait a minute and try again.'
      : `Blizzard API error ${status} for ${path}.`,
    );
  }
}

export async function getToken(clientId: string, secret: string): Promise<string> {
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Blizzard rejected the client ID or secret.' : `Token request failed (${res.status}).`);
  return (await res.json()).access_token as string;
}

export interface Named {
  id: number;
  name: string;
}

/** Names come back as plain strings when a locale is given, but tolerate localized objects too. */
export function nameOf(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (typeof o.name === 'string' || (o.name && typeof o.name === 'object')) return nameOf(o.name);
    for (const k of [LOCALE, 'en_US', 'en_GB']) if (typeof o[k] === 'string') return o[k] as string;
    const first = Object.values(o).find((v) => typeof v === 'string');
    if (typeof first === 'string') return first;
  }
  return '';
}

function namedList(data: unknown, preferredKey?: string): Named[] {
  const obj = (data ?? {}) as Record<string, unknown>;
  const arr = (preferredKey && Array.isArray(obj[preferredKey]) ? obj[preferredKey] : Object.values(obj).find(Array.isArray)) as unknown[] | undefined;
  return (arr ?? [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.id === 'number')
    .map((x) => ({ id: x.id as number, name: nameOf(x.name) || `#${x.id}` }));
}

interface ApiAuction {
  item?: { id?: number };
  buyout?: number;
  quantity?: number;
}
interface ApiCommodity {
  item?: { id?: number };
  unit_price?: number;
  quantity?: number;
}

export class ForeverApi {
  constructor(
    private region: string,
    private token: string,
  ) {}

  private async get<T>(path: string): Promise<{ data: T; lastModified?: string }> {
    const sep = path.includes('?') ? '&' : '?';
    const url = `https://${this.region}.api.blizzard.com${path}${sep}namespace=dynamic-forever-${this.region}&locale=${LOCALE}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) {
      void res.body?.cancel();
      throw new ApiError(res.status, path);
    }
    return { data: (await res.json()) as T, lastModified: res.headers.get('last-modified') ?? undefined };
  }

  async rulesets(): Promise<Named[]> {
    return namedList((await this.get('/data/wow/ruleset/index')).data, 'rulesets');
  }

  async houses(ruleset: number): Promise<Named[]> {
    return namedList((await this.get(`/data/wow/ruleset/${ruleset}/auctions/`)).data, 'auctions');
  }

  /** Downloads one house (items + commodities) and aggregates it into scan rows. */
  async houseSnapshot(ruleset: number, house: number, onProgress?: (msg: string) => void): Promise<HouseSnapshot> {
    onProgress?.('Downloading item auctions…');
    const items = await this.get<{ name?: unknown; ruleset?: unknown; auctions?: ApiAuction[] }>(`/data/wow/ruleset/${ruleset}/auctions/${house}`);
    onProgress?.('Downloading commodities (ore, bars, herbs…)…');
    const commodities = await this.get<{ auctions?: ApiCommodity[] }>(`/data/wow/ruleset/${ruleset}/auctions/${house}/commodities`);

    const listings: Listing[] = [];
    for (const a of items.data.auctions ?? []) {
      const qty = a.quantity ?? 1;
      if (a.item?.id && a.buyout) listings.push({ item: a.item.id, unit: Math.floor(a.buyout / qty), qty });
    }
    for (const c of commodities.data.auctions ?? []) {
      if (c.item?.id && c.unit_price) listings.push({ item: c.item.id, unit: c.unit_price, qty: c.quantity ?? 1 });
    }
    const modified = [items.lastModified, commodities.lastModified]
      .map((s) => (s ? Date.parse(s) : NaN))
      .filter((n) => Number.isFinite(n));
    return {
      takenAt: Math.floor((modified.length ? Math.max(...modified) : Date.now()) / 1000),
      houseName: nameOf(items.data.name) || `House ${house}`,
      rulesetName: nameOf(items.data.ruleset),
      itemAuctions: items.data.auctions?.length ?? 0,
      commodityAuctions: commodities.data.auctions?.length ?? 0,
      rows: aggregate(listings),
    };
  }
}

export interface HouseSnapshot {
  takenAt: number;
  houseName: string;
  rulesetName: string;
  itemAuctions: number;
  commodityAuctions: number;
  rows: AhExportRow[];
}

export async function connect(region: string, clientId: string, secret: string): Promise<ForeverApi> {
  return new ForeverApi(region, await getToken(clientId.trim(), secret.trim()));
}
