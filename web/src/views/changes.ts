import { ahMap, compareScans, type Change } from '../engine';
import { hoursText, rate } from '../flowView';
import type { AppState } from '../state';
import { WINDOW_DAYS, type Flow } from '../throughput';
import { ago, h, itemLink, money, notice, pct, table } from '../ui';

interface Seller {
  item: number;
  f: Flow;
  listed: number;
  goldPerDay: number;
}

/** Items ranked by how much gold changes hands per day. */
function fastestSellers(state: AppState): HTMLElement {
  const { flow, data, market } = state;
  const head = h('h2', {}, 'Sells fastest');
  if (!flow || !(flow.hoursItems || flow.hoursCommodities)) {
    return h('div', {}, head, h('p', { class: 'muted' }, 'Needs hourly Blizzard fetches: set up the Blizzard API in Settings and keep the site open with hourly fetching on. The first numbers appear after two fetches about an hour apart.'));
  }
  const rows: Seller[] = [...flow.flows]
    .filter(([, f]) => f.sold > 0)
    .map(([item, f]) => ({ item, f, listed: market.ah.get(item)?.qty ?? 0, goldPerDay: f.perDay * (Number.isFinite(f.avg) ? f.avg : 0) }));
  const name = (s: Seller) => data.items.get(s.item);
  return h(
    'div',
    {},
    head,
    h('p', { class: 'muted small' }, `Estimated from ${flow.records} hourly comparisons (${hoursText(flow.hoursCommodities)} of commodity data, ${hoursText(flow.hoursItems)} of gear and other items) over the last ${WINDOW_DAYS} days. Gear counts can include cancelled auctions.`),
    table(
      rows,
      [
        { label: 'Item', value: (s) => name(s)?.name ?? '', render: (s) => itemLink(s.item, name(s)?.name, name(s)?.quality) },
        { label: 'Sold/day', numeric: true, value: (s) => s.f.perDay, render: (s) => rate(s.f.perDay) },
        { label: 'Avg price', numeric: true, title: 'Average price paid', value: (s) => s.f.avg, render: (s) => money(s.f.avg) },
        { label: 'Gold/day', numeric: true, title: 'Sold per day × average price: how much money moves through this item', value: (s) => s.goldPerDay, render: (s) => money(s.goldPerDay) },
        { label: 'Listed now', numeric: true, value: (s) => s.listed },
        { label: 'New/day', numeric: true, title: 'Units newly listed per day', value: (s) => s.f.listedPerDay, render: (s) => rate(s.f.listedPerDay) },
        { label: 'Days of supply', numeric: true, title: 'Listed now ÷ sold per day', value: (s) => s.listed / s.f.perDay, render: (s) => (s.listed / s.f.perDay).toFixed(1) },
      ],
      { sortBy: 3, desc: true, limit: 150, empty: 'Nothing has sold yet in the data collected.' },
    ),
  );
}

export function renderChanges(state: AppState): HTMLElement {
  const { latest, previous, data } = state;
  const head = h('h1', {}, 'Changes since the previous scan');
  if (!latest || !previous) {
    return h('div', {}, head, notice('info', 'You need at least two imported AH scans. Scan again later (Blizzard allows one full scan per 15 minutes) and import it.'), fastestSellers(state));
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
    fastestSellers(state),
  );
}
