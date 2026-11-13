import { db } from '../db';
import { Engine } from '../engine';
import { flowLine } from '../flowView';
import { engineOptions, type AppState } from '../state';
import type { AhExportRow } from '../types';
import { ago, h, itemLink, money, notice, sparkline, when } from '../ui';

function findRow(rows: AhExportRow[], id: number): AhExportRow | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] === id) return rows[mid];
    if (rows[mid][0] < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return rows.find((r) => r[0] === id); // rows from older exports may be unsorted
}

async function itemDetail(state: AppState, id: number): Promise<HTMLElement> {
  const { data, market } = state;
  const item = data.items.get(id);
  const history: { t: number; min: number; qty: number }[] = [];
  await db.snapshots.orderBy('takenAt').each((s) => {
    const row = findRow(s.rows, id);
    if (row) history.push({ t: s.takenAt, min: row[1], qty: row[2] });
  });
  const ah = market.ah.get(id);
  const cost = new Engine(data, market, engineOptions(state)).unitCost(id);
  const madeBy = data.recipesByOutput.get(id) ?? [];
  const usedIn = data.recipes.filter((r) => r.reagents.some(([rid]) => rid === id));

  return h(
    'div',
    { class: 'card' },
    h('h2', {}, itemLink(id, item?.name, item?.quality)),
    h(
      'p',
      {},
      'Lowest on AH: ', money(ah?.min), ah ? ` (${ah.qty} listed)` : '', '. Vendor pays ', money(item?.sell), '. ',
      cost.kind === 'craft' ? ['Cheapest to make yourself: ', money(cost.unit), ` via ${cost.recipe.name}.`] : null,
      cost.kind === 'vendor' ? ['Vendors sell it for ', money(cost.unit), '.'] : null,
    ),
    ah?.levels.length
      ? h('p', {}, 'Cheapest listings: ', ah.levels.flatMap(([p, q], i) => [i ? ', ' : '', `${q} at `, money(p)]))
      : null,
    flowLine(state, id, ah?.qty),
    history.length > 1 ? h('div', {}, sparkline(history.map((x) => x.min), 320, 60)) : null,
    history.length
      ? h(
          'table',
          { class: 'compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Scan'), h('th', { class: 'num' }, 'Lowest'), h('th', { class: 'num' }, 'Listed'))),
          h('tbody', {}, history.slice().reverse().map((x) => h('tr', {}, h('td', {}, when(x.t), h('span', { class: 'muted' }, ` (${ago(x.t)})`)), h('td', { class: 'num' }, money(x.min)), h('td', { class: 'num' }, x.qty)))),
        )
      : h('p', { class: 'muted' }, 'Not seen in any imported scan.'),
    madeBy.length ? h('p', {}, 'Made by: ', madeBy.map((r) => r.name).join(', ')) : null,
    usedIn.length ? h('p', {}, `Used in ${usedIn.length} recipes: `, usedIn.slice(0, 25).map((r) => r.name).join(', '), usedIn.length > 25 ? '…' : '') : null,
  );
}

export function renderItems(state: AppState): HTMLElement {
  const { data, market } = state;
  const results = h('div');
  const detail = h('div');
  const input = h('input', { type: 'search', placeholder: 'Item name, e.g. Mithril Bar', autofocus: true });

  const search = () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return results.replaceChildren();
    const matches = [...data.items.values()].filter((i) => i.name.toLowerCase().includes(q));
    matches.sort((a, b) => (market.ah.has(b.id) ? 1 : 0) - (market.ah.has(a.id) ? 1 : 0) || a.name.length - b.name.length);
    results.replaceChildren(
      h(
        'ul',
        { class: 'matches' },
        matches.slice(0, 30).map((i) =>
          h(
            'li',
            {},
            h('button', { class: 'link', onclick: async () => detail.replaceChildren(await itemDetail(state, i.id)) }, i.name),
            ' ',
            market.ah.has(i.id) ? money(market.ah.get(i.id)!.min) : h('span', { class: 'muted' }, 'not listed'),
          ),
        ),
      ),
    );
  };
  input.addEventListener('input', search);

  return h(
    'div',
    {},
    h('h1', {}, 'Items'),
    !state.latest ? notice('info', 'Import an AH scan to see prices.') : null,
    input,
    results,
    detail,
  );
}
