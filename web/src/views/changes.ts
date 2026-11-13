import { ahMap, compareScans, type Change } from '../engine';
import type { AppState } from '../state';
import { ago, h, itemLink, money, notice, pct, table } from '../ui';

export function renderChanges(state: AppState): HTMLElement {
  const { latest, previous, data } = state;
  const head = h('h1', {}, 'Changes since the previous scan');
  if (!latest || !previous) {
    return h('div', {}, head, notice('info', 'You need at least two imported AH scans. Scan again later (Blizzard allows one full scan per 15 minutes) and import it.'));
  }
  const { boughtOut, crashed, gone } = compareScans(ahMap(previous.rows), ahMap(latest.rows));

  const cols = [
    { label: 'Item', value: (c: Change) => data.items.get(c.item)?.name ?? '', render: (c: Change) => itemLink(c.item, data.items.get(c.item)?.name, data.items.get(c.item)?.quality) },
    { label: 'Before', numeric: true, value: (c: Change) => c.before.min, render: (c: Change) => [money(c.before.min), h('span', { class: 'muted' }, ` × ${c.before.qty}`)] },
    { label: 'Now', numeric: true, value: (c: Change) => c.after.min, render: (c: Change) => [money(c.after.min), h('span', { class: 'muted' }, ` × ${c.after.qty}`)] },
    { label: 'Price', numeric: true, value: (c: Change) => c.priceRatio, render: (c: Change) => `${c.priceRatio >= 1 ? '+' : ''}${pct(c.priceRatio - 1)}` },
    { label: 'Listed', numeric: true, value: (c: Change) => c.qtyRatio, render: (c: Change) => `${c.qtyRatio >= 1 ? '+' : ''}${pct(c.qtyRatio - 1)}` },
  ];

  return h(
    'div',
    {},
    head,
    h('p', { class: 'muted' }, `Comparing the scan from ${ago(latest.takenAt)} with the one from ${ago(previous.takenAt)}.`),
    h('h2', {}, `Bought out (${boughtOut.length})`),
    h('p', { class: 'muted small' }, 'Listings dropped by half or more and the lowest price rose 10%+. Someone bought the cheap ones: if you have this item or can craft it cheaply, now is the time to list.'),
    table(boughtOut, cols, { sortBy: 3, desc: true, empty: 'No buyouts between these scans.' }),
    h('h2', {}, `Price drops (${crashed.length})`),
    h('p', { class: 'muted small' }, 'Lowest price fell 30% or more. Good moments to buy materials.'),
    table(crashed, cols, { sortBy: 3, desc: false, empty: 'No big drops.' }),
    gone.length ? h('h2', {}, `Sold out (${gone.length})`) : null,
    gone.length
      ? h('p', {}, gone.slice(0, 60).flatMap((id, i) => [i ? ', ' : '', itemLink(id, data.items.get(id)?.name, data.items.get(id)?.quality)]))
      : null,
  );
}
