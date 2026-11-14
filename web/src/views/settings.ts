import { agreement } from '../aggregate';
import { connect, type ForeverApi, type HouseSnapshot, type Named } from '../blizzard';
import { db, exportBackup, importBackup, saveApiSnapshot, wipeAll } from '../db';
import { hoursText } from '../flowView';
import { saveSettings, type AppState } from '../state';
import { ago, h, nodes, notice } from '../ui';

const RULESET_HINT: Record<number, string> = { 1: 'PvP', 2: 'Normal', 3: 'Roleplay', 15: 'Roleplay PvP' };

function blizzardSection(state: AppState, refresh: () => Promise<void>): HTMLElement {
  const { settings } = state;
  const save = () => saveSettings(settings);
  const out = h('div');
  let api: ForeverApi | undefined;
  let rulesets: Named[] = [];
  let tested: { ruleset: number; house: Named; snap: HouseSnapshot } | undefined;

  const current = () =>
    settings.blizzHouse
      ? notice('ok', 'Fetching from ', h('strong', {}, settings.blizzHouseLabel ?? `house ${settings.blizzHouse}`), '. Use "Fetch prices from Blizzard" on the Import page or in the top bar.')
      : notice('info', 'Not set up yet: connect, then pick your auction house below.');
  const currentBox = h('div', {}, current());

  async function pickHouse() {
    if (!api) return;
    const rulesetSel = h(
      'select',
      {},
      rulesets.map((r) => h('option', { value: String(r.id), selected: r.id === (settings.blizzRuleset ?? 1) }, `${r.name} (${r.id})`)),
    );
    const houseSel = h('select', {});
    const result = h('div');
    const loadHouses = async () => {
      houseSel.replaceChildren(h('option', {}, 'Loading…'));
      try {
        const houses = await api!.houses(Number(rulesetSel.value));
        houseSel.replaceChildren(...houses.map((x) => h('option', { value: String(x.id), selected: x.id === settings.blizzHouse }, `${x.name} (${x.id})`)));
      } catch (e) {
        houseSel.replaceChildren();
        result.replaceChildren(notice('error', (e as Error).message));
      }
    };
    rulesetSel.addEventListener('change', loadHouses);

    const testBtn = h('button', {}, 'Download and check this house');
    testBtn.addEventListener('click', async () => {
      const ruleset = Number(rulesetSel.value);
      const houseId = Number(houseSel.value);
      const house = { id: houseId, name: houseSel.selectedOptions[0]?.textContent ?? `House ${houseId}` };
      testBtn.disabled = true;
      try {
        const snap = await api!.houseSnapshot(ruleset, houseId, (m) => result.replaceChildren(notice('info', m)));
        tested = { ruleset, house, snap };
        const game = (await db.snapshots.orderBy('takenAt').reverse().filter((s) => s.source === 'paste').first()) ?? undefined;
        const match = game ? agreement(snap.rows, game.rows) : undefined;
        const useBtn = h('button', { class: 'primary' }, 'Use this house and save this scan');
        useBtn.addEventListener('click', async () => {
          if (!tested) return;
          settings.blizzRuleset = tested.ruleset;
          settings.blizzHouse = tested.house.id;
          settings.blizzHouseLabel = `${tested.snap.houseName}${tested.snap.rulesetName ? `, ${tested.snap.rulesetName}` : `, ruleset ${RULESET_HINT[tested.ruleset] ?? tested.ruleset}`} (#${tested.house.id})`;
          save();
          await saveApiSnapshot(tested.snap);
          await refresh();
        });
        result.replaceChildren(
          notice(
            'ok',
            h('strong', {}, snap.houseName), snap.rulesetName ? ` — ruleset reported: ${snap.rulesetName}` : '', '. ',
            `${snap.itemAuctions.toLocaleString()} item auctions + ${snap.commodityAuctions.toLocaleString()} commodity auctions, ${snap.rows.length.toLocaleString()} different items. Data from ${ago(snap.takenAt)}.`,
          ),
          match && match.common
            ? notice(
                match.close / match.common >= 0.6 ? 'ok' : 'warn',
                `Compared with your in-game scan from ${ago(game!.takenAt)}: ${match.close} of ${match.common} shared items have a lowest price within 10% (${Math.round((100 * match.close) / match.common)}%). `,
                match.close / match.common >= 0.6 ? 'Looks like your auction house.' : 'Probably not your auction house: try another one.',
              )
            : notice('info', 'Import an in-game scan (/flip export) to check this is really your auction house: the app compares prices.'),
          h('div', { class: 'row' }, useBtn),
        );
      } catch (e) {
        result.replaceChildren(notice('error', (e as Error).message));
      } finally {
        testBtn.disabled = false;
      }
    });

    out.replaceChildren(
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Ruleset ', rulesetSel), h('label', { class: 'field' }, 'Auction house ', houseSel)),
      h('p', { class: 'muted small' }, 'Every ruleset lists the same 15 houses (Alliance, Horde and Blackwater). Check a house: the app compares its prices with your last in-game scan to confirm it is yours.'),
      h('div', { class: 'row' }, testBtn),
      result,
    );
    await loadHouses();
  }

  const connectBtn = h('button', {}, 'Connect');
  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    out.replaceChildren(notice('info', 'Connecting…'));
    try {
      api = await connect(settings.blizzRegion, settings.blizzId, settings.blizzSecret);
      rulesets = await api.rulesets();
      if (!rulesets.length) rulesets = Object.entries(RULESET_HINT).map(([id, name]) => ({ id: Number(id), name }));
      await pickHouse();
    } catch (e) {
      out.replaceChildren(notice('error', (e as Error).message));
    } finally {
      connectBtn.disabled = false;
    }
  });

  return h(
    'div',
    {},
    h('h2', {}, 'Blizzard API (WoW Forever auction house)'),
    h(
      'p',
      {},
      'Fetch prices without logging in. Create an API client at ',
      h('a', { href: 'https://develop.battle.net/access/clients', target: '_blank', rel: 'noopener' }, 'develop.battle.net'),
      ' and enter it here. It is stored only in this browser and sent only to Blizzard. The Forever API is undocumented, so it may change.',
    ),
    currentBox,
    h(
      'div',
      { class: 'grid2' },
      h('label', { class: 'field' }, 'Region ', h('select', { onchange: (e: Event) => { settings.blizzRegion = (e.target as HTMLSelectElement).value; save(); } },
        ['eu', 'us', 'kr', 'tw'].map((r) => h('option', { value: r, selected: settings.blizzRegion === r }, r.toUpperCase())))),
      h('label', { class: 'field' }, 'Client ID ', h('input', { type: 'text', value: settings.blizzId, autocomplete: 'off', onchange: (e: Event) => { settings.blizzId = (e.target as HTMLInputElement).value; save(); } })),
      h('label', { class: 'field' }, 'Client secret ', h('input', { type: 'password', value: settings.blizzSecret, autocomplete: 'off', onchange: (e: Event) => { settings.blizzSecret = (e.target as HTMLInputElement).value; save(); } })),
    ),
    h('div', { class: 'row' }, connectBtn),
    out,
    h(
      'label',
      { class: 'field' },
      h('input', { type: 'checkbox', checked: settings.autoFetch, onchange: (e: Event) => { settings.autoFetch = (e.target as HTMLInputElement).checked; save(); } }),
      ' Fetch new prices every hour while this site is open (a background tab is fine). Sales per day come from comparing these hourly snapshots.',
    ),
    h(
      'p',
      { class: 'muted small' },
      state.tsm
        ? `TradeSkillMaster sales data (${state.tsm.region.toUpperCase()}): ${state.tsm.items.size.toLocaleString()} items, from TSM's scan ${ago(state.tsm.updatedAt || state.tsm.fetchedAt)}. TSM publishes region data once a day.`
        : 'TradeSkillMaster sales data: not available for this region in the current site build.',
    ),
    h(
      'label',
      { class: 'field' },
      h('input', { type: 'checkbox', checked: settings.useTsmHouse, onchange: async (e: Event) => { settings.useTsmHouse = (e.target as HTMLInputElement).checked; save(); await refresh(); } }),
      " Use TSM's scan of my auction house for prices when it is newer than my own scan",
    ),
    h(
      'p',
      { class: 'muted small' },
      state.tsmHouse
        ? `TSM, your auction house (${state.tsmHouse.region.toUpperCase()} ${state.tsmHouse.house}): ${state.tsmHouse.items.size.toLocaleString()} items, scanned ${ago(state.tsmHouse.updatedAt || state.tsmHouse.fetchedAt)}. TSM scans about every 3 hours; the site checks every 30 minutes.`
        : 'TSM, your auction house: not known yet. Import your character from the game (its realm and faction pick the auction house).',
    ),
    state.flow
      ? h('p', { class: 'muted small' }, state.flow.records
          ? `Sales data: ${state.flow.records} hourly comparisons in the last week (${hoursText(state.flow.hoursCommodities)} of commodities, ${hoursText(state.flow.hoursItems)} of gear and other items).`
          : 'Sales data: none yet. It starts after two fetches about an hour apart (at most 3 hours apart).')
      : null,
  );
}

export async function renderSettings(state: AppState, refresh: () => Promise<void>): Promise<HTMLElement> {
  const { settings, data } = state;
  const save = () => saveSettings(settings);
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : undefined;
  const backupStatus = h('div');

  return h(
    'div',
    {},
    ...nodes(
      h('h1', {}, 'Settings'),

      h('h2', {}, 'Prices'),
      h(
        'label',
        { class: 'field' },
        'AH cut (%) ',
        h('input', {
          type: 'number', min: 0, max: 50, step: 0.5, value: String(settings.cut * 100),
          onchange: (e: Event) => { settings.cut = Number((e.target as HTMLInputElement).value) / 100; save(); },
        }),
      ),
      h(
        'label',
        { class: 'field', title: 'One listing far below the rest (bait, a misclick) can make an item look cheaper than you can really buy it for, or worth less than it sells for' },
        'AH price ',
        h(
          'select',
          { onchange: async (e: Event) => { settings.priceDepth = Number((e.target as HTMLSelectElement).value); save(); await refresh(); } },
          ...[
            [1, 'Lowest listing'],
            [3, 'Average of the cheapest 3 on sale'],
            [5, 'Average of the cheapest 5 on sale'],
            [10, 'Average of the cheapest 10 on sale'],
          ].map(([v, label]) => h('option', { value: String(v), selected: settings.priceDepth === v }, String(label))),
        ),
      ),
      h('p', { class: 'muted small' }, 'Counted per item, cheapest first: if 200 are listed at the lowest price, that is the price. Deals still show each cheap listing as it is.'),

      blizzardSection(state, refresh),

      h('h2', {}, 'Storage'),
      h(
        'p',
        {},
        `Everything you import is stored in this browser only (IndexedDB${estimate?.usage ? `, ${(estimate.usage / 1e6).toFixed(1)} MB used` : ''}). `,
        persisted ? 'The browser has agreed not to clear it automatically.' : 'The browser may clear it if your disk gets full: keep a backup.',
      ),
      h(
        'div',
        { class: 'row' },
        h('button', {
          onclick: async () => {
            const blob = await exportBackup();
            const a = h('a', { href: URL.createObjectURL(blob), download: `forever-flips-backup-${new Date().toISOString().slice(0, 10)}.json` });
            a.click();
            URL.revokeObjectURL(a.href);
          },
        }, 'Download backup'),
        h('label', { class: 'button' }, 'Restore backup…', h('input', {
          type: 'file', accept: 'application/json', hidden: true,
          onchange: async (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
              const r = await importBackup(file);
              await refresh();
              backupStatus.replaceChildren(notice('ok', `Restored ${r.snapshots} scans and ${r.characters} characters.`));
            } catch (err) {
              backupStatus.replaceChildren(notice('error', (err as Error).message));
            }
          },
        })),
        h('button', {
          class: 'danger',
          onclick: async () => {
            if (!confirm('Delete all imported scans, characters and vendor prices from this browser?')) return;
            await wipeAll();
            await refresh();
          },
        }, 'Delete all data'),
      ),
      backupStatus,

      h('h2', {}, 'About'),
      h('p', { class: 'muted' }, `Game data: WoW Forever build ${data.build} from wago.tools (${data.items.size.toLocaleString()} items, ${data.recipes.length.toLocaleString()} recipes), generated ${new Date(data.generatedAt).toLocaleString()}.`),
    ),
  );
}
