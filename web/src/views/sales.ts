import { dayBarsChart, priceChart, type PriceDay } from '../charts';
import { db } from '../db';
import { Engine } from '../engine';
import { summarizeLedger, type ItemLedger } from '../ledger';
import { engineOptions, knownSpells, type AppState } from '../state';
import type { Recipe } from '../types';
import { ago, h, itemLink, money, nodes, notice, pct, table } from '../ui';

/** Daily Auctionator history of one item, oldest first. */
export async function priceDays(item: number): Promise<PriceDay[]> {
  const rows = await db.history.where('item').equals(item).toArray();
  return rows.map((r) => ({ t: r.day, low: r.low, high: r.high, avail: r.avail })).sort((a, b) => a.t - b.t);
}

export async function renderSales(state: AppState): Promise<HTMLElement> {
  const { data, char, market } = state;
  const head = h('h1', {}, 'Your sales');
  const [mailAll, craftsAll, postsAll] = await Promise.all([db.mail.toArray(), db.crafts.toArray(), db.posts.toArray()]);
  const mine = <T extends { char: string }>(rows: T[]) => (char ? rows.filter((r) => r.char === char.key) : rows);
  const mail = mine(mailAll);
  const crafts = mine(craftsAll);
  const posts = mine(postsAll);

  if (!mail.length && !crafts.length && !posts.length) {
    return h(
      'div',
      {},
      head,
      notice(
        'info',
        'No sales recorded yet. With addon 0.3.0 or newer (download it again from the Import page): open your mailbox ',
        h('strong', {}, 'before'),
        ' you take the gold from AH mails (the addon reads them as they arrive), craft as usual, then /flip export and paste. ',
        'If you use Auctionator, its posting history comes along too.',
      ),
    );
  }

  const sum = summarizeLedger(data, mail, crafts, posts, { days: 30 });
  const known = knownSpells(char);
  const engine = new Engine(data, market, { ...engineOptions(state), strategy: 'best' });
  const recipeFor = (item: number): Recipe | undefined => {
    const list = data.recipesByOutput.get(item) ?? [];
    return list.find((r) => known.has(r.spell)) ?? list[0];
  };
  const costNow = (item: number) => {
    const r = item ? recipeFor(item) : undefined;
    if (!r) return undefined;
    const e = engine.evaluate(r);
    return e.complete ? e.cost / r.qty : undefined;
  };
  const avgNet = (e: ItemLedger) => (e.soldUnits ? e.net / e.soldUnits : undefined);
  const crafted = (e: ItemLedger) => e.crafted > 0 || (e.item > 0 && (data.recipesByOutput.get(e.item) ?? []).some((r) => known.has(r.spell)));
  const sellThrough = (e: ItemLedger) => (e.soldAuctions + e.expired + e.cancelled ? e.soldAuctions / (e.soldAuctions + e.expired + e.cancelled) : NaN);

  const kpi = (label: string, value: Node | string) => h('div', { class: 'kpi' }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label));
  const filters = { q: '', craftedOnly: false };
  const results = h('div');

  const draw = () => {
    const rows = sum.items.filter((e) => (!filters.craftedOnly || crafted(e)) && (!filters.q || e.name.toLowerCase().includes(filters.q)));
    results.replaceChildren(
      table<ItemLedger>(
        rows,
        [
          { label: 'Item', value: (e) => e.name, render: (e) => (e.item ? itemLink(e.item, e.name, data.items.get(e.item)?.quality) : e.name) },
          { label: 'Sold', numeric: true, title: 'Units sold', value: (e) => e.soldUnits },
          { label: 'Avg price', numeric: true, title: 'What buyers paid per unit, on average', value: (e) => (e.soldUnits ? e.gross / e.soldUnits : -1), render: (e) => (e.soldUnits ? money(e.gross / e.soldUnits) : '—') },
          { label: 'Earned', numeric: true, title: 'After the AH cut', value: (e) => e.net, render: (e) => (e.net ? money(e.net) : '—') },
          { label: 'Expired', numeric: true, title: 'Auctions that expired', value: (e) => e.expired },
          { label: 'Cancelled', numeric: true, value: (e) => e.cancelled },
          { label: 'Sell-through', numeric: true, title: 'Share of your auctions that sold', value: (e) => sellThrough(e) || -1, render: (e) => (Number.isFinite(sellThrough(e)) ? pct(sellThrough(e)) : '—') },
          { label: 'Bought', numeric: true, title: 'Units you bought on the AH', value: (e) => e.boughtUnits },
          { label: 'Spent', numeric: true, value: (e) => e.spent, render: (e) => (e.spent ? money(e.spent) : '—') },
          { label: 'Crafted', numeric: true, title: 'Units you crafted (counted by the addon)', value: (e) => e.crafted },
          { label: 'Cost now', numeric: true, title: 'Cheapest way to craft one at today’s prices', value: (e) => costNow(e.item) ?? -1, render: (e) => money(costNow(e.item)) },
          {
            label: 'Profit each',
            numeric: true,
            title: 'Average sale after the cut, minus what crafting one costs today',
            value: (e) => {
              const a = avgNet(e);
              const c = costNow(e.item);
              return a !== undefined && c !== undefined ? a - c : -Infinity;
            },
            render: (e) => {
              const a = avgNet(e);
              const c = costNow(e.item);
              return a !== undefined && c !== undefined ? money(a - c, { signed: true }) : '—';
            },
          },
        ],
        {
          sortBy: 3,
          desc: true,
          empty: 'Nothing matches.',
          onRow: async (e, tr) => {
            const next = tr.nextElementSibling;
            if (next?.classList.contains('detail')) return next.remove();
            const cell = h('td', { colSpan: 12 }, h('p', { class: 'muted' }, 'Loading…'));
            tr.after(h('tr', { class: 'detail' }, cell));
            const days = e.item ? await priceDays(e.item) : [];
            const c = costNow(e.item);
            cell.replaceChildren(
              ...nodes(
                h('div', {}, h('strong', {}, e.name), e.lastSale ? h('span', { class: 'muted' }, ` · last sale ${ago(e.lastSale)}`) : null, e.postedUnits ? h('span', { class: 'muted' }, ` · ${e.postedUnits} posted with Auctionator`) : null),
                days.length || e.sales.length
                  ? priceChart({ days, sales: e.sales, ref: c !== undefined ? { value: c, label: 'craft cost' } : undefined })
                  : h('p', { class: 'muted small' }, 'No price history for this item yet (it comes from Auctionator).'),
              ),
            );
          },
        },
      ),
    );
  };
  draw();

  const net30 = sum.income30 - sum.spend30;
  return h(
    'div',
    {},
    ...nodes(
      head,
      h('p', { class: 'muted' }, `${char ? `${char.key}: ` : ''}from ${sum.mails} AH mails the addon has read, plus your crafts and Auctionator's posting history.`),
      h(
        'div',
        { class: 'kpis' },
        kpi('Earned, last 7 days', money(sum.income7)),
        kpi('Earned, last 30 days', money(sum.income30)),
        kpi('Spent on the AH, 30 days', money(sum.spend30)),
        kpi('Net, 30 days', money(net30, { signed: true })),
        kpi('Auctions that sold, 30 days', Number.isFinite(sum.sellThrough30) ? pct(sum.sellThrough30) : '—'),
      ),
      h('h2', {}, 'Gold per day'),
      dayBarsChart(sum.days),
      h('h2', {}, 'By item'),
      h(
        'div',
        { class: 'controls' },
        h('input', { type: 'search', placeholder: 'Search items…', oninput: (ev: Event) => { filters.q = (ev.target as HTMLInputElement).value.toLowerCase(); draw(); } }),
        h('label', {}, h('input', { type: 'checkbox', onchange: (ev: Event) => { filters.craftedOnly = (ev.target as HTMLInputElement).checked; draw(); } }), ' only things I craft'),
      ),
      results,
      h('p', { class: 'muted small' }, 'Click an item for its price history on your auction house (from Auctionator) with your own sales on top.'),
    ),
  );
}
