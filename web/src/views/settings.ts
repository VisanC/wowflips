import { candidateNamespaces, getToken, probe } from '../blizzard';
import { exportBackup, importBackup, wipeAll } from '../db';
import { saveSettings, type AppState } from '../state';
import { h, notice } from '../ui';

export async function renderSettings(state: AppState, refresh: () => Promise<void>): Promise<HTMLElement> {
  const { settings, data } = state;
  const save = () => saveSettings(settings);
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : undefined;
  const backupStatus = h('div');

  // Blizzard API probe
  const probeOut = h('div');
  const nsBox = h('textarea', { rows: 4, spellcheck: false }, candidateNamespaces(settings.blizzRegion).join('\n'));
  const runProbe = async () => {
    probeOut.replaceChildren(notice('info', 'Getting a token…'));
    try {
      const token = await getToken(settings.blizzId.trim(), settings.blizzSecret.trim());
      probeOut.replaceChildren(notice('info', 'Token OK. Probing namespaces…'));
      const results = await probe(settings.blizzRegion, token, nsBox.value.split(/\s+/).filter(Boolean));
      probeOut.replaceChildren(
        h(
          'table',
          { class: 'compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Namespace'), h('th', {}, 'Connected realms'), h('th', {}, 'Commodities AH'))),
          h('tbody', {}, results.map((r) => h('tr', {}, h('td', {}, h('code', {}, r.namespace)), h('td', {}, r.realms), h('td', {}, r.commodities)))),
        ),
        h('p', { class: 'muted small' }, 'A namespace answering 200 for both columns is where Forever\'s AH data would live. "dynamic-<region>" is retail, for comparison.'),
      );
    } catch (e) {
      probeOut.replaceChildren(notice('error', (e as Error).message));
    }
  };

  return h(
    'div',
    {},
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

    h('h2', {}, 'Blizzard API (optional, for later)'),
    h(
      'p',
      {},
      'To check whether Blizzard publishes Forever\'s auction house, create an API client at ',
      h('a', { href: 'https://develop.battle.net/access/clients', target: '_blank', rel: 'noopener' }, 'develop.battle.net'),
      ' and enter it here. It is stored only in this browser and sent only to Blizzard.',
    ),
    h(
      'div',
      { class: 'grid2' },
      h('label', { class: 'field' }, 'Region ', h('select', { onchange: (e: Event) => { settings.blizzRegion = (e.target as HTMLSelectElement).value; save(); nsBox.value = candidateNamespaces(settings.blizzRegion).join('\n'); } },
        ['eu', 'us', 'kr', 'tw'].map((r) => h('option', { value: r, selected: settings.blizzRegion === r }, r.toUpperCase())))),
      h('label', { class: 'field' }, 'Client ID ', h('input', { type: 'text', value: settings.blizzId, autocomplete: 'off', onchange: (e: Event) => { settings.blizzId = (e.target as HTMLInputElement).value; save(); } })),
      h('label', { class: 'field' }, 'Client secret ', h('input', { type: 'password', value: settings.blizzSecret, autocomplete: 'off', onchange: (e: Event) => { settings.blizzSecret = (e.target as HTMLInputElement).value; save(); } })),
    ),
    h('label', { class: 'field block' }, 'Namespaces to try', nsBox),
    h('div', { class: 'row' }, h('button', { onclick: runProbe }, 'Probe the API')),
    probeOut,

    h('h2', {}, 'About'),
    h('p', { class: 'muted' }, `Game data: WoW Forever build ${data.build} from wago.tools (${data.items.size.toLocaleString()} items, ${data.recipes.length.toLocaleString()} recipes), generated ${new Date(data.generatedAt).toLocaleString()}.`),
  );
}
