// Blizzard Game Data API probe: does the API expose WoW Forever's auction house?
// Credentials are typed into Settings and kept only in this browser's localStorage.

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

export interface ProbeResult {
  namespace: string;
  realms: string; // connected-realm index
  commodities: string; // region-wide commodity auctions
}

async function status(url: string, token: string): Promise<{ code: number; body?: unknown }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    void res.body?.cancel();
    return { code: res.status };
  }
  const big = Number(res.headers.get('content-length') ?? 0) > 2_000_000 || url.includes('/auctions');
  if (big) {
    void res.body?.cancel();
    return { code: res.status };
  }
  return { code: res.status, body: await res.json() };
}

export function candidateNamespaces(region: string): string[] {
  return ['dynamic', 'dynamic-classic', 'dynamic-classic1x', 'dynamic-classicann', 'dynamic-forever', 'dynamic-wowf', 'dynamic-classic-forever'].map(
    (ns) => `${ns}-${region}`,
  );
}

export async function probe(region: string, token: string, namespaces: string[]): Promise<ProbeResult[]> {
  const base = `https://${region}.api.blizzard.com/data/wow`;
  const out: ProbeResult[] = [];
  for (const ns of namespaces) {
    const realms = await status(`${base}/connected-realm/index?namespace=${ns}&locale=en_GB`, token).catch((e) => ({ code: 0, body: String(e) }));
    const count = (realms.body as { connected_realms?: unknown[] } | undefined)?.connected_realms?.length;
    const commodities = await status(`${base}/auctions/commodities?namespace=${ns}&locale=en_GB`, token).catch(() => ({ code: 0 }));
    out.push({
      namespace: ns,
      realms: realms.code === 200 ? `200 OK (${count ?? '?'} connected realms)` : String(realms.code || 'network error'),
      commodities: commodities.code === 200 ? '200 OK' : String(commodities.code || 'network error'),
    });
  }
  return out;
}
