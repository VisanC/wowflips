import { decodeExport } from '../decode';
import { db, importPayload, listSnapshots } from '../db';
import type { AppState } from '../state';
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
          `Vendor prices: ${r.vendorItems}.`,
      );
      await refresh();
    } catch (e) {
      status.replaceChildren(notice('error', (e as Error).message));
    } finally {
      button.disabled = false;
    }
  });

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
              h('td', {}, s.charKey),
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
    h('h1', {}, 'Import from the game'),
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
    status,
    h('h2', {}, 'Imported scans'),
    state.latest ? null : notice('info', 'Each import with a new AH scan is kept, so price history builds up over time.'),
    history,
  );
}
