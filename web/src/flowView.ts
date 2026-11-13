// How throughput (sales per day) is shown. Two sources:
//  - TradeSkillMaster's region data (EU or US, all rulesets and both factions), refreshed when the site builds;
//  - our own measurement on your auction house, from comparing hourly Blizzard snapshots.
import type { AppState } from './state';
import { flowFor, tsmFor } from './state';
import type { Flow } from './throughput';
import { TSM_CREDIT_URL, type TsmRow } from './tsm';
import { ago, h, money, pct, type Child } from './ui';

export function rate(n: number): string {
  if (n === 0) return '0';
  if (n < 1) return n.toFixed(1);
  if (n < 10) return n.toFixed(1).replace(/\.0$/, '');
  return Math.round(n).toLocaleString();
}

export function hoursText(hours: number): string {
  return hours < 48 ? `${Math.round(hours)} h` : `${(hours / 24).toFixed(1).replace(/\.0$/, '')} days`;
}

/** Units sold per day: TSM's region figure first, else our own measurement. */
export function soldPerDay(state: AppState, item: number): number | undefined {
  const t = tsmFor(state, item);
  if (t) return t.soldPerDay;
  return flowFor(state, item)?.perDay;
}

/** Table cell: "12/day" with both sources in the tooltip, or a dash. */
export function salesCell(state: AppState, item: number, listed?: number): Child {
  const t = tsmFor(state, item);
  const f = flowFor(state, item);
  const n = t ? t.soldPerDay : f?.perDay;
  if (n === undefined) return h('span', { class: 'muted', title: 'No sales data for this item yet.' }, '—');
  const tips = [
    t ? `TSM, ${state.tsm!.region.toUpperCase()} all rulesets and factions: ${rate(t.soldPerDay)} sold a day, ${pct(t.saleRate)} of listings sell` : '',
    f ? `Your auction house (measured, ${hoursText(f.hours)} of data): ${rate(f.perDay)} a day` : '',
    listed && n > 0 ? `${listed} listed now ≈ ${(listed / n).toFixed(1)} days of sales` : '',
  ].filter(Boolean);
  return h('span', { title: tips.join('\n') }, `${rate(n)}/day`);
}

function tsmSentence(state: AppState, t: TsmRow, listed?: number): HTMLElement {
  const region = state.tsm!.region.toUpperCase();
  return h(
    'p',
    { class: 'flow' },
    h('strong', {}, 'Sells '),
    t.soldPerDay > 0 ? `about ${rate(t.soldPerDay)} a day` : 'rarely',
    t.avgSalePrice > 0 ? [' at ', money(t.avgSalePrice), ' on average'] : null,
    t.saleRate > 0 ? `; ${pct(t.saleRate)} of listings sell` : '',
    listed && t.soldPerDay > 0 ? `; the ${listed.toLocaleString()} listed on your AH are about ${(listed / t.soldPerDay).toFixed(1)} days of that` : '',
    '. ',
    h(
      'span',
      { class: 'muted small' },
      `${region}, all rulesets and both factions together, from `,
      h('a', { href: TSM_CREDIT_URL, target: '_blank', rel: 'noopener' }, 'TradeSkillMaster'),
      state.tsm!.updatedAt ? ` (updated ${ago(state.tsm!.updatedAt)})` : '',
      '.',
    ),
  );
}

function ownSentence(f: Flow, listed?: number): HTMLElement {
  return h(
    'p',
    { class: 'flow' },
    h('strong', {}, 'On your AH '),
    f.sold ? [`about ${rate(f.perDay)} sold a day`, Number.isFinite(f.avg) ? [' at ', money(f.avg)] : null] : `none sold in the last ${hoursText(f.hours)}`,
    `; ${rate(f.listedPerDay)} a day newly listed`,
    listed && f.perDay > 0 ? `; ${(listed / f.perDay).toFixed(1)} days of supply listed` : '',
    '. ',
    h('span', { class: 'muted small' }, `Measured from ${hoursText(f.hours)} of hourly Blizzard snapshots${f.hours < 12 ? ', still a rough guess' : ''}.`),
  );
}

/** How fast an item sells: TSM's region figure and our own measurement, whichever exist. */
export function flowLine(state: AppState, item: number, listed?: number): HTMLElement {
  const t = tsmFor(state, item);
  const f = flowFor(state, item);
  if (!t && !f) {
    return h(
      'p',
      { class: 'muted small' },
      state.tsm ? 'Sales per day: TradeSkillMaster has no sales for this item yet.' : 'Sales per day: no data yet.',
      state.flow ? '' : ' Set up the Blizzard API in Settings to also measure sales on your own auction house.',
    );
  }
  return h('div', {}, t ? tsmSentence(state, t, listed) : null, f && f.hours > 0 ? ownSentence(f, listed) : null);
}
