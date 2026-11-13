import { fetchConfiguredHouse } from '../blizzardSync';
import { decodeExport } from '../decode';
import { db, importPayload, listSnapshots } from '../db';
import { clearRecipeMaster, readRecipeMasterFiles, saveRecipeMaster } from '../recipeMaster';
import { blizzardReady, type AppState } from '../state';
import { ago, h, notice, when } from '../ui';

// Survives the re-render that follows an import.
let lastResult: HTMLElement | null = null;

export async function renderImport(state: AppState, refresh: () => Promise<void>): Promise<HTMLElement> {
  const status = h('div');
  if (lastResult) {
    status.append(lastResult);
    lastResult = null;
  }
  const box = h('textarea', { rows: 6, placeholder: 'Paste the FLIPX1:… string from the in-game export window here', spellcheck: false });
  const button = h('button', { class: 'primary' }, 'Import');

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.replaceChildren(notice('info', 'Decoding…'));
    try {
      const payload = await decodeExport(box.value);
      const r = await importPayload(payload);
      if (navigator.storage?.persist) void navigator.storage.persist();
      lastResult = notice(
          'ok',
          h('strong', {}, `Imported ${r.charKey}. `),
          r.snapshotAdded
            ? `AH scan from ${ago(Math.floor(Date.now() / 1000) - (r.scanAge ?? 0))}: ${r.snapshotItems.toLocaleString()} items, ${r.auctions.toLocaleString()} auctions. `
            : r.snapshotItems ? 'That AH scan was already imported. ' : 'No AH scan in this export (open the AH and /flip scan). ',
          `Bags: ${r.bags} item types. `,
          r.bankAge !== undefined ? `Bank: captured ${ago(Math.floor(Date.now() / 1000) - r.bankAge)}. ` : 'Bank: not captured yet (open your bank once). ',
          r.profs.length ? `Professions: ${r.profs.join(', ')}. ` : 'Professions: none yet (open each profession window once). ',
          `Vendor prices: ${r.vendorItems}. `,
          r.atrItems || r.atrHistory ? `Auctionator: ${r.atrItems.toLocaleString()} prices from today, ${r.atrHistory.toLocaleString()} item-days of price history. ` : '',
          r.mails ? `Sales ledger: ${r.mails} new AH mails.` : '',
      );
      await refresh();
    } catch (e) {
      status.replaceChildren(notice('error', (e as Error).message));
    } finally {
      button.disabled = false;
    }
  });

  const blizzStatus = h('div');
  const fetchBtn = h('button', { class: 'primary' }, 'Fetch prices from Blizzard');
  fetchBtn.addEventListener('click', async () => {
    fetchBtn.disabled = true;
    try {
      const { added, snap } = await fetchConfiguredHouse(state.settings, (m) => blizzStatus.replaceChildren(notice('info', m)));
      lastResult = notice(
        'ok',
        h('strong', {}, `${snap.houseName}: `),
        added
          ? `saved a scan from ${ago(snap.takenAt)} with ${snap.rows.length.toLocaleString()} items (${(snap.itemAuctions + snap.commodityAuctions).toLocaleString()} auctions).`
          : `Blizzard has not published newer data yet (latest is from ${ago(snap.takenAt)}, already saved). It updates about once an hour.`,
      );
      await refresh();
    } catch (e) {
      blizzStatus.replaceChildren(notice('error', (e as Error).message));
      fetchBtn.disabled = false;
    }
  });
  const blizzard = blizzardReady(state.settings)
    ? h('div', { class: 'card' }, h('strong', {}, 'Blizzard API'), ` — ${state.settings.blizzHouseLabel ?? ''}`, h('div', { class: 'row' }, fetchBtn), blizzStatus,
        h('p', { class: 'muted small' }, 'Prices only: bags, bank and professions still come from the in-game export below.'))
    : h('p', { class: 'muted small' }, 'Tip: connect the Blizzard API in Settings to fetch AH prices without logging in.');

  // Recipe Master: the addon's recipe database, read from its folder on this computer.
  const rmStatus = h('div');
  const rmInput = h('input', { type: 'file', multiple: true, class: 'rm-input' });
  rmInput.setAttribute('webkitdirectory', '');
  rmInput.addEventListener('change', async () => {
    if (!rmInput.files?.length) return;
    rmStatus.replaceChildren(notice('info', 'Reading Recipe Master…'));
    try {
      const rm = await readRecipeMasterFiles(rmInput.files);
      await saveRecipeMaster(rm);
      lastResult = notice('ok', h('strong', {}, `Recipe Master${rm.version ? ` ${rm.version}` : ''}: `), `${rm.recipes.length.toLocaleString()} recipes with learn levels, skill-up levels and prices.`);
      await refresh();
    } catch (e) {
      rmStatus.replaceChildren(notice('error', (e as Error).message));
    } finally {
      rmInput.value = '';
    }
  });
  const rm = state.recipeMaster;
  const rmCard = h(
    'div',
    { class: 'card' },
    rm
      ? h(
          'p',
          {},
          h('strong', {}, `Loaded Recipe Master${rm.version ? ` ${rm.version}` : ''}`),
          `: ${rm.recipes.length.toLocaleString()} recipes, ${ago(rm.loadedAt)}. `,
          h('button', { class: 'link', onclick: async () => { await clearRecipeMaster(); await refresh(); } }, 'remove'),
        )
      : null,
    h(
      'p',
      { class: 'muted small' },
      'Recipe Master (another addon) knows every recipe\'s learn level, skill-up levels and vendor price. Pick its folder once: ',
      h('code', {}, 'World of Warcraft\\_forever_\\Interface\\AddOns\\RecipeMaster'),
      '. Your browser reads the files right here and keeps them in this page. If it asks to "upload" them: nothing leaves your computer. Pick it again after the addon updates.',
    ),
    h('label', { class: 'field' }, rm ? 'Reload from folder ' : 'Recipe Master folder ', rmInput),
    rmStatus,
  );

  const snaps = await listSnapshots();
  const history = snaps.length
    ? h(
        'table',
        { class: 'compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Scan time'), h('th', { class: 'num' }, 'Items'), h('th', { class: 'num' }, 'Auctions'), h('th', {}, 'From'), h('th', {}))),
        h(
          'tbody',
          {},
          snaps.map((s) =>
            h(
              'tr',
              {},
              h('td', {}, when(s.takenAt), h('span', { class: 'muted' }, ` (${ago(s.takenAt)})`)),
              h('td', { class: 'num' }, s.items.toLocaleString()),
              h('td', { class: 'num' }, s.auctions.toLocaleString()),
              h('td', {}, s.source === 'api' ? `Blizzard API — ${s.realm}` : s.source === 'auctionator' ? `Auctionator${s.partial ? ' (a few items)' : ''} — ${s.charKey}` : s.charKey),
              h(
                'td',
                {},
                h('button', {
                  class: 'link',
                  onclick: async () => {
                    if (!confirm(`Delete the scan from ${when(s.takenAt)}?`)) return;
                    await db.snapshots.delete(s.id!);
                    await refresh();
                  },
                }, 'delete'),
              ),
            ),
          ),
        ),
      )
    : h('p', { class: 'muted' }, 'No scans imported yet.');

  return h(
    'div',
    {},
    h('h1', {}, 'Import'),
    status,
    blizzard,
    h('h2', {}, 'From the game'),
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, 'Install the ', h('a', { href: `${import.meta.env.BASE_URL}FlipExport.zip` }, 'FlipExport addon'), ' into your WoW Forever ', h('code', {}, 'Interface/AddOns'), ' folder.'),
      h('li', {}, 'Open your bank and each profession window once. The addon remembers them.'),
      h('li', {}, 'At the Auction House type ', h('code', {}, '/flip scan'), ' (one full scan per 15 minutes).'),
      h('li', {}, 'Type ', h('code', {}, '/flip export'), ', press Ctrl+C, and paste below.'),
    ),
    box,
    h('div', { class: 'row' }, button),
    h('h2', {}, 'Recipe Master (learn levels)'),
    rmCard,
    h('h2', {}, 'Imported scans'),
    state.latest ? null : notice('info', 'Each import with a new AH scan is kept, so price history builds up over time.'),
    history,
  );
}
