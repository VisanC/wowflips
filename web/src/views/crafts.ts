import { Engine, STRATEGY_LABEL, type CraftEval, type Part, type Source, type Strategy } from '../engine';
import { buildShoppingList, shoppingListText, type ShoppingList } from '../shopping';
import { engineOptions, inventory, knownSpells, saveSettings, type AppState } from '../state';
import type { Recipe } from '../types';
import { ago, h, itemLink, money, moneyText, nodes, notice, pct, table, type Child } from '../ui';

const STRATEGIES: Strategy[] = ['best', 'buy', 'craft'];

interface Row {
  best: CraftEval;
  buy: CraftEval;
  craft: CraftEval;
}

function sourceLabel(s: Source, state: AppState): Child {
  switch (s.kind) {
    case 'ah':
      return h('span', { class: 'src ah' }, 'buy on AH ', money(s.unit));
    case 'vendor':
      return h('span', { class: 'src vendor' }, 'buy from vendor ', money(s.unit));
    case 'craft':
      return h('span', { class: 'src craft' }, `craft (${s.recipe.name}) `, money(s.unit), ' each');
    default:
      return h('span', { class: 'src none' }, 'no price', state.latest ? '' : ' (import an AH scan)');
  }
}

function partsTree(parts: Part[], state: AppState): HTMLElement {
  return h(
    'ul',
    { class: 'tree' },
    parts.map((p) => {
      const item = state.data.items.get(p.item);
      return h(
        'li',
        {},
        `${p.count} × `,
        itemLink(p.item, item?.name, item?.quality),
        ' — ',
        sourceLabel(p.source, state),
        Number.isFinite(p.source.unit) ? h('span', { class: 'muted' }, ' = ', money(p.source.unit * p.count)) : null,
        p.source.kind === 'craft' ? partsTree(p.source.parts, state) : null,
      );
    }),
  );
}

export function filterRecipes(state: AppState): Recipe[] {
  const { data, settings, char } = state;
  const known = knownSpells(char);
  const profSkills = new Set(
    (char?.profs ?? []).map((p) => [...data.skills.entries()].find(([, name]) => name === p.n)?.[0]).filter((x): x is number => x !== undefined),
  );
  return data.recipes.filter((r) => {
    if (settings.recipeScope === 'known') return known.has(r.spell);
    if (settings.recipeScope === 'profession') return profSkills.has(r.skill);
    return true;
  });
}

const costCell = (e: CraftEval, best?: number) =>
  e.complete
    ? h('span', { class: best !== undefined && Math.abs(e.cost - best) < 0.5 ? 'cheapest' : '' }, money(e.cost))
    : h('span', { class: 'muted', title: 'Some reagent has no AH or vendor price' }, '—');

function renderShoppingList(list: ShoppingList, label: string, state: AppState): HTMLElement {
  const { data } = state;
  const name = (id: number) => data.items.get(id)?.name;
  const copyStatus = h('span', { class: 'muted small' });
  const copyBtn = h('button', {}, 'Copy as text');
  copyBtn.addEventListener('click', async () => {
    const text = shoppingListText(list, data, label, moneyText);
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = ' copied';
    } catch {
      const ta = h('textarea', { rows: 12, readOnly: true }, text);
      copyStatus.replaceChildren(ta);
      ta.select();
    }
  });
  const product = data.items.get(list.recipe.out);

  return h(
    'div',
    { class: 'shopping card' },
    ...nodes(
      h('h3', {}, `Shopping list — ${label} — ${list.crafts} × ${list.recipe.name}`),
      list.missing.length
        ? notice('error', 'No price for: ', list.missing.map((id) => name(id) ?? id).join(', '), '. Scan the AH again or check a vendor.')
        : null,
      list.buy.length
        ? h(
            'table',
            { class: 'compact' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Buy'), h('th', { class: 'num' }, 'Qty'), h('th', {}, 'Where'), h('th', { class: 'num' }, 'Est. cost'), h('th', {}, ''))),
            h(
              'tbody',
              {},
              list.buy.map((b) => {
                const it = data.items.get(b.item);
                const note =
                  b.source === 'ah' && b.listed !== undefined && b.qty > b.listed
                    ? h('span', { class: 'warn-text' }, `only ${b.listed} listed`)
                    : b.estimated && b.source === 'ah'
                      ? h('span', { class: 'muted small', title: 'Needs more than the cheapest price levels we know; later ones may cost more' }, '≈ estimate')
                      : b.source === 'ah'
                        ? h('span', { class: 'muted small' }, `avg ${moneyText(b.avgUnit)}`)
                        : null;
                return h(
                  'tr',
                  {},
                  h('td', {}, itemLink(b.item, it?.name, it?.quality)),
                  h('td', { class: 'num' }, b.qty),
                  h('td', {}, b.source === 'vendor' ? h('span', { class: 'tag vendor' }, 'vendor') : b.source === 'ah' ? h('span', { class: 'tag ah' }, 'AH') : h('span', { class: 'src none' }, 'no price')),
                  h('td', { class: 'num' }, b.source === 'none' ? '—' : money(b.total)),
                  h('td', {}, note),
                );
              }),
            ),
          )
        : h('p', { class: 'muted' }, 'Nothing to buy: you have everything.'),
      list.fromStock.length
        ? h(
            'p',
            {},
            h('strong', {}, 'From your bags/bank: '),
            list.fromStock.flatMap((s, i) => [i ? ', ' : '', `${s.qty} × `, itemLink(s.item, name(s.item), data.items.get(s.item)?.quality)]),
          )
        : null,
      h('p', { class: 'nomargin' }, h('strong', {}, 'Craft, in this order:')),
      h(
        'ol',
        { class: 'steps' },
        list.steps.map((s) =>
          h('li', {}, `${s.crafts} × ${s.recipe.name}`, s.recipe.qty > 1 ? h('span', { class: 'muted' }, ` (makes ${s.makes})`) : ''),
        ),
      ),
      h(
        'div',
        { class: 'totals' },
        h('div', {}, 'Cash needed ', money(list.cashNeeded)),
        list.stockValue ? h('div', {}, 'Your own items used ', money(list.stockValue)) : null,
        h('div', {}, `Selling ${list.crafts * list.recipe.qty} × ${product?.name ?? ''} `, money(list.revenue)),
        h('div', {}, h('strong', {}, 'Profit '), money(list.profit, { signed: true })),
      ),
      h('div', { class: 'row' }, copyBtn, copyStatus),
    ),
  );
}

function renderDetail(row: Row, state: AppState, engines: Record<Strategy, Engine>, inv: Map<number, number>): HTMLElement {
  const { data } = state;
  const r = row.best.recipe;
  const product = data.items.get(r.out);
  const qtyInput = h('input', { type: 'number', min: 1, max: 1000, value: String(Math.max(1, row.best.craftableNow || 1)), class: 'qty' });
  const useStock = h('input', { type: 'checkbox', checked: true });
  const listBox = h('div');

  const options = STRATEGIES.map((s) => ({ strategy: s, ev: row[s] })).sort((a, b) => {
    if (a.ev.complete !== b.ev.complete) return a.ev.complete ? -1 : 1;
    return a.ev.cost - b.ev.cost || STRATEGIES.indexOf(a.strategy) - STRATEGIES.indexOf(b.strategy);
  });
  const cheapest = options[0].ev.cost;

  const makeList = (strategy: Strategy) => {
    const crafts = Math.max(1, Math.min(1000, Math.floor(Number(qtyInput.value) || 1)));
    const list = buildShoppingList(data, state.market, engines[strategy], r, crafts, {
      inventory: useStock.checked ? inv : undefined,
      cut: state.settings.cut,
    });
    listBox.replaceChildren(renderShoppingList(list, STRATEGY_LABEL[strategy], state));
    listBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  return h(
    'div',
    { class: 'chain' },
    h('div', {}, h('strong', {}, r.name), ` makes ${r.qty} × `, itemLink(r.out, product?.name, product?.quality), '. Lowest on AH: ', money(row.best.ahUnit), ` (${row.best.ahQty} listed), vendor pays `, money(row.best.vendorUnit), '.'),
    h(
      'div',
      { class: 'row' },
      h('label', { class: 'field' }, 'Crafts ', qtyInput),
      h('label', { class: 'field' }, useStock, ' use what I have in bags & bank'),
    ),
    options.map(({ strategy, ev }, i) => {
      const same = i > 0 && ev.complete && Math.abs(ev.cost - cheapest) < 0.5;
      const btn = h('button', { class: i === 0 ? 'primary' : '' }, 'Shopping list');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        makeList(strategy);
      });
      return h(
        'details',
        { class: `option${i === 0 ? ' best' : ''}`, open: i === 0 },
        h(
          'summary',
          {},
          h('span', { class: 'opt-label' }, STRATEGY_LABEL[strategy]),
          i === 0 ? h('span', { class: 'tag ah' }, 'cheapest') : same ? h('span', { class: 'tag' }, 'same cost') : null,
          h('span', { class: 'opt-cost' }, ev.complete ? ['cost ', money(ev.cost)] : h('span', { class: 'muted' }, 'missing prices')),
          ev.complete ? h('span', { class: 'opt-profit' }, 'profit ', money(ev.profit, { signed: true }), h('span', { class: 'muted' }, ` (${pct(ev.margin)})`)) : null,
          i > 0 && ev.complete && !same ? h('span', { class: 'muted small' }, ' +', money(ev.cost - cheapest), ' vs cheapest') : null,
          btn,
        ),
        partsTree(ev.parts, state),
      );
    }),
    listBox,
  );
}

export function renderCrafts(state: AppState, rerender: () => void): HTMLElement {
  const { data, settings, char, latest } = state;
  if (settings.craftMode === 'none') settings.craftMode = 'known';
  const base = engineOptions(state);
  const engines = Object.fromEntries(STRATEGIES.map((s) => [s, new Engine(data, state.market, { ...base, strategy: s })])) as Record<Strategy, Engine>;
  const inv = inventory(char).total;
  const rows: Row[] = filterRecipes(state)
    .filter((r) => data.items.has(r.out))
    .map((r) => ({ best: engines.best.evaluate(r, inv), buy: engines.buy.evaluate(r, inv), craft: engines.craft.evaluate(r, inv) }));

  const filters = { q: '', prof: 'all', profitable: false, makeable: false };
  const profOptions = [...new Set(rows.map((e) => e.best.recipe.skill))].map((s) => [String(s), data.skills.get(s) ?? `Skill ${s}`]);

  const controls = h(
    'div',
    { class: 'controls' },
    h('input', { type: 'search', placeholder: 'Search recipes or items…', oninput: (e: Event) => { filters.q = (e.target as HTMLInputElement).value.toLowerCase(); draw(); } }),
    h(
      'select',
      { onchange: (e: Event) => { filters.prof = (e.target as HTMLSelectElement).value; draw(); } },
      h('option', { value: 'all' }, 'All professions'),
      profOptions.map(([v, label]) => h('option', { value: v }, label)),
    ),
    h(
      'select',
      {
        title: 'Which recipes to list',
        onchange: (e: Event) => { settings.recipeScope = (e.target as HTMLSelectElement).value as typeof settings.recipeScope; saveSettings(settings); rerender(); },
      },
      h('option', { value: 'known', selected: settings.recipeScope === 'known' }, 'Recipes I know'),
      h('option', { value: 'profession', selected: settings.recipeScope === 'profession' }, 'All recipes in my professions'),
      h('option', { value: 'all', selected: settings.recipeScope === 'all' }, 'Every recipe in the game'),
    ),
    h(
      'select',
      {
        title: 'Which recipes the "craft" options may use for reagents (tubes, bars, …)',
        onchange: (e: Event) => { settings.craftMode = (e.target as HTMLSelectElement).value as typeof settings.craftMode; saveSettings(settings); rerender(); },
      },
      h('option', { value: 'known', selected: settings.craftMode === 'known' }, 'Sub-crafts: only recipes I know'),
      h('option', { value: 'all', selected: settings.craftMode === 'all' }, 'Sub-crafts: any recipe'),
    ),
    h('label', {}, h('input', { type: 'checkbox', onchange: (e: Event) => { filters.profitable = (e.target as HTMLInputElement).checked; draw(); } }), ' profitable only'),
    h('label', {}, h('input', { type: 'checkbox', onchange: (e: Event) => { filters.makeable = (e.target as HTMLInputElement).checked; draw(); } }), ' can make now'),
  );

  const results = h('div');
  const draw = () => {
    const shown = rows.filter(({ best: e }) => {
      if (filters.prof !== 'all' && String(e.recipe.skill) !== filters.prof) return false;
      if (filters.profitable && !(e.complete && e.profit > 0)) return false;
      if (filters.makeable && e.craftableNow < 1) return false;
      if (filters.q) {
        const itemName = data.items.get(e.recipe.out)?.name.toLowerCase() ?? '';
        if (!e.recipe.name.toLowerCase().includes(filters.q) && !itemName.includes(filters.q)) return false;
      }
      return true;
    });
    const cost = (e: CraftEval) => (e.complete ? e.cost : Infinity);
    results.replaceChildren(
      table<Row>(
        shown,
        [
          {
            label: 'Makes',
            value: (r) => data.items.get(r.best.recipe.out)?.name ?? '',
            render: (r) => {
              const it = data.items.get(r.best.recipe.out);
              return [r.best.recipe.qty > 1 ? `${r.best.recipe.qty} × ` : '', itemLink(r.best.recipe.out, it?.name, it?.quality)];
            },
          },
          { label: 'Profession', value: (r) => data.skills.get(r.best.recipe.skill) ?? '' },
          { label: 'Buy all', numeric: true, title: 'Buy every reagent, craft nothing but the item itself', value: (r) => cost(r.buy), render: (r) => costCell(r.buy, cost(r.best)) },
          { label: 'Craft all', numeric: true, title: 'Craft every reagent you can (with the allowed recipes), buy only the rest', value: (r) => cost(r.craft), render: (r) => costCell(r.craft, cost(r.best)) },
          { label: 'Best', numeric: true, title: 'Cheapest mix: buy or craft each reagent, whichever costs less', value: (r) => cost(r.best), render: (r) => costCell(r.best) },
          {
            label: 'Sells for',
            numeric: true,
            title: 'Per craft, after the AH cut, or the vendor price if that is better',
            value: (r) => r.best.revenue,
            render: (r) => [money(r.best.revenue), ' ', h('span', { class: `tag ${r.best.channel}` }, r.best.channel === 'ah' ? 'AH' : 'vendor')],
          },
          { label: 'Listed', numeric: true, title: 'How many are on the AH right now', value: (r) => r.best.ahQty },
          { label: 'Profit', numeric: true, title: 'Using the best mix', value: (r) => (r.best.complete ? r.best.profit : -Infinity), render: (r) => (r.best.complete ? money(r.best.profit, { signed: true }) : '—') },
          { label: 'Margin', numeric: true, value: (r) => (r.best.complete ? r.best.margin : -Infinity), render: (r) => (r.best.complete ? pct(r.best.margin) : '—') },
          { label: 'Can make', numeric: true, title: 'From your bags and bank (direct reagents)', value: (r) => r.best.craftableNow },
        ],
        {
          sortBy: 7,
          desc: true,
          empty: char ? 'No recipes match. Try "All recipes in my professions" or clear the filters.' : 'Import an export from the game first.',
          onRow: (row, tr) => {
            const next = tr.nextElementSibling;
            if (next?.classList.contains('detail')) return next.remove();
            tr.after(h('tr', { class: 'detail' }, h('td', { colSpan: 10 }, renderDetail(row, state, engines, inv))));
          },
        },
      ),
    );
  };
  draw();

  return h(
    'div',
    {},
    ...nodes(
      h('h1', {}, 'Crafts'),
      !latest ? notice('warn', 'No AH scan yet. Costs and sale prices need one: in game, open the Auction House and type /flip scan, then /flip export.') : null,
      latest && Date.now() / 1000 - latest.takenAt > 6 * 3600 ? notice('warn', `Your latest AH scan is from ${ago(latest.takenAt)}. Prices move fast in week one; scan again before acting.`) : null,
      !char?.profs.length ? notice('info', 'No professions captured yet. In game, open each profession window once, then export again.') : null,
      controls,
      results,
      h('p', { class: 'muted small' }, 'Click a row for the three ways to make it, cheapest first, and a shopping list for any of them. Profit does not include the AH deposit.'),
    ),
  );
}
