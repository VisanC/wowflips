import { inventory, type AppState } from '../state';
import { h, itemLink, money, notice, table } from '../ui';

interface InvRow {
  id: number;
  name: string;
  quality: number;
  bags: number;
  bank: number;
  count: number;
  ahUnit?: number;
  ahValue: number;
  vendorValue: number;
  listed: number;
}

export function renderInventory(state: AppState): HTMLElement {
  const { char, data, market, settings } = state;
  if (!char) return h('div', {}, h('h1', {}, 'Inventory'), notice('info', 'Import an export from the game first.'));

  const inv = inventory(char);
  const rows: InvRow[] = [...inv.total.entries()].map(([id, count]) => {
    const item = data.items.get(id);
    const ah = market.ah.get(id);
    return {
      id,
      name: item?.name ?? `Item ${id}`,
      quality: item?.quality ?? 1,
      bags: inv.bags.get(id) ?? 0,
      bank: inv.bank.get(id) ?? 0,
      count,
      ahUnit: ah?.price,
      ahValue: ah ? ah.price * (1 - settings.cut) * count : 0,
      vendorValue: (item?.sell ?? 0) * count,
      listed: ah?.qty ?? 0,
    };
  });
  const best = (r: InvRow) => Math.max(r.ahValue, r.vendorValue);
  const total = rows.reduce((s, r) => s + best(r), 0);

  return h(
    'div',
    {},
    h('h1', {}, 'Inventory'),
    h('p', {}, `${char.name} — bags`, char.bank ? ' and bank' : '', ' are worth about ', money(total), ' at the best of AH (after cut) or vendor. ', char.bank ? null : h('span', { class: 'muted' }, 'Open your bank in game to include it.')),
    table<InvRow>(
      rows,
      [
        { label: 'Item', value: (r) => r.name, render: (r) => itemLink(r.id, r.name, r.quality) },
        { label: 'Bags', numeric: true, value: (r) => r.bags },
        { label: 'Bank', numeric: true, value: (r) => r.bank },
        { label: 'AH each', numeric: true, value: (r) => r.ahUnit ?? 0, render: (r) => money(r.ahUnit) },
        { label: 'Listed', numeric: true, value: (r) => r.listed },
        { label: 'AH value', numeric: true, title: 'All of them at the lowest AH price, after the cut', value: (r) => r.ahValue, render: (r) => money(r.ahValue) },
        { label: 'Vendor value', numeric: true, value: (r) => r.vendorValue, render: (r) => money(r.vendorValue) },
        {
          label: 'Best',
          value: (r) => (r.ahValue > r.vendorValue * 1.15 ? 'AH' : r.vendorValue > 0 ? 'vendor' : '—'),
          render: (r) => {
            if (r.ahValue > r.vendorValue * 1.15) return h('span', { class: 'tag ah' }, 'AH');
            if (r.vendorValue > 0) return h('span', { class: 'tag vendor', title: 'Less than 15% difference: not worth the AH hassle' }, 'vendor');
            return '—';
          },
        },
      ],
      { sortBy: 5, desc: true, empty: 'Bags are empty.' },
    ),
  );
}
