// How throughput (sales per day) is shown.
import type { AppState } from './state';
import { flowFor } from './state';
import type { Flow } from './throughput';
import { h, money, type Child } from './ui';

export function rate(n: number): string {
  if (n === 0) return '0';
  if (n < 1) return n.toFixed(1);
  if (n < 10) return n.toFixed(1).replace(/\.0$/, '');
  return Math.round(n).toLocaleString();
}

export function hoursText(hours: number): string {
  return hours < 48 ? `${Math.round(hours)} h` : `${(hours / 24).toFixed(1).replace(/\.0$/, '')} days`;
}

/** Table cell: "12/day", or a dash with a hint. */
export function flowCell(f: Flow | undefined, listed?: number): Child {
  if (!f) return h('span', { class: 'muted', title: 'No sales data yet. It builds up from hourly Blizzard fetches.' }, '—');
  const supply = listed && f.perDay > 0 ? ` · ${(listed / f.perDay).toFixed(1)} days of supply listed` : '';
  return h(
    'span',
    { class: f.hours < 6 ? 'muted' : '', title: `${f.sold} sold, ${f.listed} newly listed in ${hoursText(f.hours)} of hourly data${supply}` },
    `${rate(f.perDay)}/day`,
  );
}

/** One sentence about how fast an item sells. */
export function flowLine(state: AppState, item: number, listed?: number): HTMLElement {
  const f = flowFor(state, item);
  if (!state.flow) return h('p', { class: 'muted small' }, 'Sales per day: set up the Blizzard API in Settings. It compares the hourly snapshots to see what sold.');
  if (!f) return h('p', { class: 'muted small' }, 'Sales per day: no data yet. Keep the site open with hourly fetching on (Settings); the first numbers appear after two fetches an hour apart.');
  return h(
    'p',
    { class: 'flow' },
    h('strong', {}, 'Sells '),
    f.sold ? [`about ${rate(f.perDay)} a day`, Number.isFinite(f.avg) ? [' at ', money(f.avg), ' on average'] : null] : `none in the last ${hoursText(f.hours)}`,
    `; ${rate(f.listedPerDay)} a day newly listed`,
    listed && f.perDay > 0 ? `; the ${listed.toLocaleString()} listed now are ${(listed / f.perDay).toFixed(1)} days of sales` : '',
    '. ',
    h('span', { class: 'muted small' }, `From ${hoursText(f.hours)} of hourly Blizzard data${f.hours < 12 ? ', so still a rough guess' : ''}.`),
  );
}
