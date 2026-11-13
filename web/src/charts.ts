// Small SVG charts: gold per day (income up, spending down) and an item's price history.
// One y-axis per chart, thin marks with 4px rounded ends, recessive grid, a hover tooltip on
// every chart, and a legend whenever there are two series. Colours are the validated dark
// categorical slots 1 (blue) and 2 (orange), checked against this site's #121417 background.

import type { DayTotals, SalePoint } from './ledger';
import { h, moneyText } from './ui';

const SVG = 'http://www.w3.org/2000/svg';
const W = 720;
const PAD = { l: 52, r: 16, t: 10, b: 26 };

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

/** Compact money for axis ticks: 12g, 35s, 80c. */
export function moneyShort(c: number): string {
  const a = Math.abs(c);
  const sign = c < 0 ? '−' : '';
  if (a >= 10000) return `${sign}${+(a / 10000).toFixed(a >= 100000 ? 0 : 1)}g`;
  if (a >= 100) return `${sign}${Math.round(a / 100)}s`;
  return `${sign}${Math.round(a)}c`;
}

/** About `count` round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const dayLabel = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function frame(height: number, legend: { color: string; label: string }[]) {
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart-svg', role: 'img' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const box = h(
    'div',
    { class: 'chart' },
    legend.length > 1 ? h('div', { class: 'chart-legend' }, legend.map((l) => h('span', {}, h('i', { style: { background: l.color } }), l.label))) : null,
    svg,
    tip,
  );
  const showTip = (html: Node[], evt: MouseEvent) => {
    tip.replaceChildren(...html);
    tip.hidden = false;
    const r = box.getBoundingClientRect();
    const x = evt.clientX - r.left;
    tip.style.left = `${Math.min(Math.max(8, x + 12), r.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.max(0, evt.clientY - r.top - tip.offsetHeight - 10)}px`;
  };
  svg.addEventListener('mouseleave', () => (tip.hidden = true));
  return { svg, box, showTip, hideTip: () => (tip.hidden = true) };
}

function yAxis(svg: SVGSVGElement, ticks: number[], y: (v: number) => number, height: number) {
  for (const v of ticks) {
    svg.append(s('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis-zero' : 'grid' }));
    svg.append(s('text', { x: PAD.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, moneyShort(v)));
  }
  void height;
}

/** A bar with a 4px rounded end away from the baseline. */
function bar(x: number, w: number, base: number, end: number, fill: string): SVGPathElement {
  const up = end < base;
  const hgt = Math.abs(end - base);
  const r = Math.min(4, w / 2, hgt);
  const top = up ? end : base;
  const d = up
    ? `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`
    : `M${x},${base} V${base + hgt - r} Q${x},${base + hgt} ${x + r},${base + hgt} H${x + w - r} Q${x + w},${base + hgt} ${x + w},${base + hgt - r} V${base} Z`;
  return s('path', { d, fill });
}

/** Gold earned (up) and spent on the AH (down) per day. */
export function dayBarsChart(days: DayTotals[]): HTMLElement {
  const H = 220;
  const { svg, box, showTip } = frame(H, [
    { color: 'var(--series-1)', label: 'Earned from sales (after cut)' },
    { color: 'var(--series-2)', label: 'Spent buying on the AH' },
  ]);
  const max = Math.max(1, ...days.map((d) => d.income));
  const min = Math.min(0, ...days.map((d) => -d.spend));
  const ticks = niceTicks(min, max, 4);
  const lo = Math.min(min, ticks[0]);
  const hi = Math.max(max, ticks[ticks.length - 1]);
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b);
  yAxis(svg, ticks, y, H);
  const slot = (W - PAD.l - PAD.r) / days.length;
  const bw = Math.max(2, Math.min(18, slot - 2)); // 2px gap between neighbouring bars
  const every = Math.ceil(days.length / 8);
  days.forEach((d, i) => {
    const x = PAD.l + i * slot + (slot - bw) / 2;
    if (d.income > 0) svg.append(bar(x, bw, y(0), y(d.income), 'var(--series-1)'));
    if (d.spend > 0) svg.append(bar(x, bw, y(0), y(-d.spend), 'var(--series-2)'));
    if ((days.length - 1 - i) % every === 0) {
      svg.append(s('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'tick' }, dayLabel(d.day)));
    }
    // hit target: the whole column
    const hit = s('rect', { x: PAD.l + i * slot, y: PAD.t, width: slot, height: H - PAD.t - PAD.b, class: 'hit' });
    hit.addEventListener('mousemove', (e) =>
      showTip(
        [
          h('strong', {}, dayLabel(d.day)),
          h('div', {}, `Earned ${moneyText(d.income)}`),
          h('div', {}, `Spent ${moneyText(d.spend)}`),
          h('div', {}, `Net ${d.income - d.spend >= 0 ? '+' : ''}${moneyText(d.income - d.spend)}`),
        ],
        e,
      ),
    );
    svg.append(hit);
  });
  return box;
}

export interface PriceDay {
  t: number; // start of day
  low: number;
  high: number;
  avail: number;
}

/**
 * An item's daily lowest price on your auction house (line, with the day's low-high range
 * shaded), your own sales as dots, and an optional reference line (e.g. what crafting one costs).
 */
export function priceChart(opts: { days: PriceDay[]; sales?: SalePoint[]; ref?: { value: number; label: string } }): HTMLElement {
  const H = 220;
  const days = [...opts.days].sort((a, b) => a.t - b.t);
  const sales = opts.sales ?? [];
  const legend = [{ color: 'var(--series-1)', label: 'Lowest price each day (shaded: the day’s range)' }];
  if (sales.length) legend.push({ color: 'var(--series-2)', label: 'Your sales' });
  const { svg, box, showTip } = frame(H, legend);
  const ts = [...days.map((d) => d.t), ...sales.map((x) => x.t)];
  if (!ts.length) return h('p', { class: 'muted small' }, 'No price history yet.');
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts, t0 + 86400);
  const vals = [...days.flatMap((d) => [d.low, d.high]), ...sales.map((x) => x.unit), ...(opts.ref ? [opts.ref.value] : [])];
  const ticks = niceTicks(0, Math.max(1, ...vals), 4);
  const hi = Math.max(...vals, ticks[ticks.length - 1]);
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((hi - v) / hi) * (H - PAD.t - PAD.b);
  yAxis(svg, ticks, y, H);

  if (days.length) {
    const area = days.map((d) => `${x(d.t)},${y(d.high)}`).join(' ') + ' ' + [...days].reverse().map((d) => `${x(d.t)},${y(d.low)}`).join(' ');
    svg.append(s('polygon', { points: area, class: 'band' }));
    svg.append(s('polyline', { points: days.map((d) => `${x(d.t)},${y(d.low)}`).join(' '), class: 'line' }));
    if (days.length === 1) svg.append(s('circle', { cx: x(days[0].t), cy: y(days[0].low), r: 4, fill: 'var(--series-1)' }));
  }
  if (opts.ref) {
    svg.append(s('line', { x1: PAD.l, x2: W - PAD.r, y1: y(opts.ref.value), y2: y(opts.ref.value), class: 'ref' }));
    svg.append(s('text', { x: W - PAD.r, y: y(opts.ref.value) - 5, 'text-anchor': 'end', class: 'tick' }, `${opts.ref.label} ${moneyShort(opts.ref.value)}`));
  }
  for (const p of sales) svg.append(s('circle', { cx: x(p.t), cy: y(p.unit), r: 4, class: 'sale' }));
  const step = Math.max(1, Math.ceil(days.length / 7));
  days.forEach((d, i) => {
    if ((days.length - 1 - i) % step === 0) svg.append(s('text', { x: x(d.t), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, dayLabel(d.t)));
  });

  // crosshair + tooltip for the nearest day
  const cross = s('line', { x1: 0, x2: 0, y1: PAD.t, y2: H - PAD.b, class: 'cross', visibility: 'hidden' });
  svg.append(cross);
  const hit = s('rect', { x: PAD.l, y: PAD.t, width: W - PAD.l - PAD.r, height: H - PAD.t - PAD.b, class: 'hit' });
  hit.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const tx = t0 + (((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r) * (t1 - t0);
    const near = (a: { t: number }, b: { t: number }) => Math.abs(a.t - tx) - Math.abs(b.t - tx);
    const d = [...days].sort(near)[0];
    const sold = sales.filter((p) => d && Math.abs(p.t - d.t - 43200) < 43200);
    if (d) {
      cross.setAttribute('x1', String(x(d.t)));
      cross.setAttribute('x2', String(x(d.t)));
      cross.setAttribute('visibility', 'visible');
    }
    showTip(
      [
        d ? h('strong', {}, dayLabel(d.t)) : null,
        d ? h('div', {}, `Lowest ${moneyText(d.low)}${d.high !== d.low ? `, up to ${moneyText(d.high)}` : ''}`) : null,
        d && d.avail ? h('div', {}, `${d.avail.toLocaleString()} listed`) : null,
        ...sold.map((p) => h('div', {}, `You sold ${p.count} at ${moneyText(p.unit)} each`)),
      ].filter((n): n is HTMLElement => !!n),
      e,
    );
  });
  hit.addEventListener('mouseleave', () => cross.setAttribute('visibility', 'hidden'));
  svg.append(hit);
  return box;
}
