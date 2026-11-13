// Tiny DOM helpers, money formatting and shared widgets.

export type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

/** Drops null/false entries so the rest can go to replaceChildren/append. */
export function nodes(...items: (Node | null | undefined | false)[]): Node[] {
  return items.filter((x): x is Node => !!x);
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Copper -> "12g 34s 56c" as coloured spans. */
export function money(copper: number | undefined, opts: { signed?: boolean } = {}): HTMLElement {
  if (copper === undefined || !Number.isFinite(copper)) return h('span', { class: 'muted' }, '—');
  const neg = copper < 0;
  let c = Math.round(Math.abs(copper));
  const g = Math.floor(c / 10000);
  c -= g * 10000;
  const s = Math.floor(c / 100);
  c -= s * 100;
  const parts: Child[] = [];
  if (g) parts.push(h('span', { class: 'g' }, `${g.toLocaleString()}g`), ' ');
  if (g || s) parts.push(h('span', { class: 's' }, `${s}s`), ' ');
  parts.push(h('span', { class: 'c' }, `${c}c`));
  return h('span', { class: `money${neg ? ' neg' : ''}` }, neg ? '−' : opts.signed ? '+' : '', parts);
}

export function moneyText(copper: number): string {
  const c = Math.round(Math.abs(copper));
  const g = Math.floor(c / 10000);
  const s = Math.floor((c % 10000) / 100);
  return `${copper < 0 ? '-' : ''}${g ? `${g}g ` : ''}${g || s ? `${s}s ` : ''}${c % 100}c`;
}

export function ago(unixSeconds: number | undefined): string {
  if (!unixSeconds) return 'never';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function when(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function pct(x: number): string {
  return Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—';
}

/** "+88%" / "-12%" */
export function signedPct(x: number): string {
  return Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${pct(x)}` : '—';
}

const QUALITY = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5'];

export function itemLink(id: number, name: string | undefined, quality = 1): HTMLElement {
  return h(
    'a',
    { class: `item ${QUALITY[quality] ?? 'q1'}`, href: `https://www.wowhead.com/forever/item=${id}`, target: '_blank', rel: 'noopener' },
    name ?? `Item ${id}`,
  );
}

export interface Column<T> {
  label: string;
  value: (row: T) => number | string;
  render?: (row: T) => Child;
  numeric?: boolean;
  title?: string;
}

/** Sortable table. Clicking a row calls onRow (e.g. to expand details). */
export function table<T>(
  rows: T[],
  columns: Column<T>[],
  opts: { sortBy?: number; desc?: boolean; onRow?: (row: T, tr: HTMLTableRowElement) => void; limit?: number; empty?: string } = {},
): HTMLElement {
  let sortBy = opts.sortBy ?? 0;
  let desc = opts.desc ?? true;
  const limit = opts.limit ?? 500;
  const wrap = h('div', { class: 'table-wrap' });

  const render = () => {
    const sorted = [...rows].sort((a, b) => {
      const va = columns[sortBy].value(a);
      const vb = columns[sortBy].value(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return desc ? -cmp : cmp;
    });
    const thead = h(
      'thead',
      {},
      h(
        'tr',
        {},
        columns.map((c, i) =>
          h(
            'th',
            {
              class: `${c.numeric ? 'num' : ''} ${i === sortBy ? 'sorted' : ''}`,
              title: c.title,
              onclick: () => {
                if (sortBy === i) desc = !desc;
                else { sortBy = i; desc = !!c.numeric; }
                render();
              },
            },
            c.label,
            i === sortBy ? (desc ? ' ▾' : ' ▴') : '',
          ),
        ),
      ),
    );
    const tbody = h('tbody');
    for (const row of sorted.slice(0, limit)) {
      const tr = h('tr', { class: opts.onRow ? 'clickable' : '' }, columns.map((c) => h('td', { class: c.numeric ? 'num' : '' }, c.render ? c.render(row) : c.value(row))));
      if (opts.onRow) tr.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('a')) return;
        opts.onRow!(row, tr);
      });
      tbody.appendChild(tr);
    }
    const tbl = h('table', {}, thead, tbody);
    wrap.replaceChildren(
      ...nodes(
        rows.length ? tbl : h('p', { class: 'muted' }, opts.empty ?? 'Nothing to show.'),
        rows.length > limit ? h('p', { class: 'muted' }, `Showing ${limit} of ${rows.length}. Narrow the filters to see more.`) : null,
      ),
    );
  };
  render();
  return wrap;
}

/** Small inline SVG line chart. */
export function sparkline(values: number[], width = 160, height = 36): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.classList.add('spark');
  if (values.length < 2) return svg;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 2 - ((v - min) / span) * (height - 4)}`);
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts.join(' '));
  svg.appendChild(line);
  return svg;
}

export function notice(kind: 'info' | 'warn' | 'error' | 'ok', ...children: Child[]) {
  return h('div', { class: `notice ${kind}` }, ...children);
}
