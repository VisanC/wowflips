import { connect, type HouseSnapshot } from './blizzard';
import { saveApiSnapshot } from './db';
import type { Settings } from './state';

/** Fetches the configured auction house from Blizzard and stores it as a scan. */
export async function fetchConfiguredHouse(settings: Settings, onProgress?: (msg: string) => void): Promise<{ added: boolean; snap: HouseSnapshot }> {
  if (!settings.blizzRuleset || !settings.blizzHouse) throw new Error('Pick your auction house in Settings first.');
  onProgress?.('Logging in to Blizzard…');
  const api = await connect(settings.blizzRegion, settings.blizzId, settings.blizzSecret);
  const snap = await api.houseSnapshot(settings.blizzRuleset, settings.blizzHouse, onProgress);
  return { added: await saveApiSnapshot(snap), snap };
}
