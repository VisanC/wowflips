import { Engine, STRATEGY_LABEL, type Choice, type CraftEval, type Part, type Source, type Strategy } from '../engine';
import { flowCell, flowLine, hoursText, rate } from '../flowView';
import { BONUS_ITEMS, gathersFor, skillName, skillRank } from '../gather';
import { buildShoppingList, shoppingListText, type ShoppingList } from '../shopping';
import { engineOptions, flowFor, inventory, knownSpells, saveSettings, type AppState } from '../state';
import type { Recipe } from '../types';
import { ago, h, itemLink, money, moneyText, nodes, notice, signedPct, table } from '../ui';

const STRATEGIES: Strategy[] = ['best', 'buy', 'craft'];
const STRATEGY_HINT: Record<Strategy, string> = {
  best: 'buy or craft each part, whichever is cheaper',
  buy: 'buy every part ready-made',
  craft: 'craft every part you can',
};

interface Row {
  best: CraftEval;
  buy: CraftEval;
  craft: CraftEval;
}

/** One line of the plan: a part, how many one craft needs, and both ways to get it. */
interface PlanRow {
  item: number;
  need: number;
  depth: number;
  source: Source;
  choice: Choice;
}

function planRows(parts: Part[], mult: number, depth: number, engine: Engine, out: PlanRow[] = []): PlanRow[] {
  for (const p of parts) {
    const need = p.count * mult;
    out.push({ item: p.item, need, depth, source: p.source, choice: engine.explain(p.item, p.source) });
    if (p.source.kind === 'craft') planRows(p.source.parts, need / p.source.recipe.qty, depth + 1, engine, out);
  }
  return out;
}

const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

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

const pctTag = (e: CraftEval) => h('span', { class: `pct ${e.profit >= 0 ? 'pos' : 'neg'}` }, signedPct(e.margin));

/** Cost of one method with its profit % underneath. */
const costCell = (e: CraftEval, best?: number) =>
  e.complete
    ? h('span', { class: 'costcell' }, h('span', { class: best !== undefined && Math.abs(e.cost - best) < 0.5 ? 'cheapest' : '' }, money(e.cost)), pctTag(e))
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
  const units = list.crafts * list.recipe.qty;
  const invested = list.cashNeeded + list.stockValue;
  const f = flowFor(state, list.recipe.out);
  const sellTime = !f
    ? null
    : f.perDay > 0
      ? h('p', { class: units > f.perDay ? 'warn-text' : 'muted small' },
          `At the current rate (${rate(f.perDay)} a day sold, everyone's listings included) selling ${units} takes about ${(units / f.perDay).toFixed(1)} days.`)
      : h('p', { class: 'warn-text' }, `None sold in the last ${hoursText(f.hours)} of data: these may sit on the AH a long time.`);

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
        h('div', {}, h('strong', {}, 'Profit '), money(list.profit, { signed: true }), invested > 0 ? h('span', { class: `pct ${list.profit >= 0 ? 'pos' : 'neg'}` }, ` ${signedPct(list.profit / invested)}`) : null),
      ),
      sellTime,
      h('div', { class: 'row' }, copyBtn, copyStatus),
    ),
  );
}

const gathered = () => h('span', { class: 'muted', title: 'Gathered, not crafted: costs only your time' }, 'gathered');

/** Detail for a gathered item: what it sells for, how fast, what you hold, and whether processing it pays more. */
function renderGatherDetail(e: CraftEval, state: AppState, engine: Engine, inv: Map<number, number>): HTMLElement {
  const { data } = state;
  const item = data.items.get(e.recipe.out);
  const prof = skillName(data, e.recipe.skill);
  const rank = skillRank(state.char, prof);
  const held = inv.get(e.recipe.out) ?? 0;
  const perUnit = e.revenue;
  // Known single-reagent recipes that turn it into something else (smelting, cooking…).
  const known = knownSpells(state.char);
  const processing = data.recipes
    .filter((r) => r.reagents.length === 1 && r.reagents[0][0] === e.recipe.out && known.has(r.spell))
    .map((r) => {
      const out = engine.evaluate(r, inv);
      return { r, perInput: out.revenue / r.reagents[0][1] };
    })
    .sort((a, b) => b.perInput - a.perInput);
  const roughSkill = prof === 'Skinning' ? ' (about: it depends on the mob level)' : prof === 'Fishing' ? ' (about: it depends on the zone)' : '';

  return h(
    'div',
    { class: 'chain' },
    h(
      'div',
      {},
      itemLink(e.recipe.out, item?.name, item?.quality),
      ` is gathered with ${prof}, from skill ${e.recipe.yellow}${roughSkill}`,
      rank !== undefined ? `; you have ${rank}.` : '. Your skill is unknown: update the addon and export again.',
    ),
    BONUS_ITEMS.has(e.recipe.out) ? h('p', { class: 'muted small' }, `You can't gather this on purpose: it comes as a bonus while ${prof === 'Mining' ? 'mining ore veins' : 'picking other herbs'}.`) : null,
    h('div', {}, 'One sells for ', money(perUnit), ` after the AH cut (lowest on AH `, money(e.ahUnit), `, ${e.ahQty} listed); vendor pays `, money(e.vendorUnit), '.'),
    flowLine(state, e.recipe.out, e.ahQty),
    held ? h('p', {}, `You have ${held} in bags & bank, worth about `, money(perUnit * held), '.') : null,
    processing.length
      ? h(
          'ul',
          { class: 'tree' },
          processing.map(({ r, perInput }) => {
            const outItem = data.items.get(r.out);
            const diff = perInput - perUnit;
            return h(
              'li',
              {},
              `${r.name}: ${r.reagents[0][1]} → ${r.qty} × `,
              itemLink(r.out, outItem?.name, outItem?.quality),
              ', worth ',
              money(perInput),
              ' per one gathered ',
              h('span', { class: `pct ${diff >= 0 ? 'pos' : 'neg'}` }, diff >= 0 ? ['(', money(diff), ' more than selling it raw)'] : ['(', money(-diff), ' less than selling it raw)']),
            );
          }),
        )
      : null,
  );
}

function renderDetail(row: Row, state: AppState, engines: Record<Strategy, Engine>, inv: Map<number, number>): HTMLElement {
  const { data } = state;
  const r = row.best.recipe;
  const product = data.items.get(r.out);
  const base = engineOptions(state);
  let strategy: Strategy = 'best';
  const overrides = new Map<number, 'buy' | 'craft'>();
  const qtyInput = h('input', { type: 'number', min: 1, max: 1000, value: String(Math.max(1, row.best.craftableNow || 1)), class: 'qty' });
  const useStock = h('input', { type: 'checkbox', checked: true });
  const listBox = h('div');
  const body = h('div');

  const planEngine = () => (overrides.size ? new Engine(data, state.market, { ...base, strategy, overrides }) : engines[strategy]);
  const planName = () => (overrides.size ? 'Custom mix' : STRATEGY_LABEL[strategy]);
  const cheapestCost = Math.min(...STRATEGIES.map((s) => (row[s].complete ? row[s].cost : Infinity)));

  const toggle = (item: number, use: 'buy' | 'craft') => {
    overrides.set(item, use);
    listBox.replaceChildren();
    draw();
  };

  const planRow = (pr: PlanRow) => {
    const it = data.items.get(pr.item);
    const c = pr.choice;
    const buyOk = Number.isFinite(c.buy.unit);
    const craft = c.craft;
    const chosen: 'buy' | 'craft' = pr.source.kind === 'craft' ? 'craft' : 'buy';
    const cheaper =
      buyOk && craft ? (Math.abs(c.buy.unit - craft.unit) <= 0.5 ? 'tie' : c.buy.unit < craft.unit ? 'buy' : 'craft') : buyOk ? 'buy' : craft ? 'craft' : 'none';
    const extra = chosen !== cheaper && cheaper !== 'tie' && buyOk && craft ? Math.abs(c.buy.unit - craft.unit) : 0;

    const use =
      buyOk && craft
        ? h(
            'div',
            { class: 'seg' },
            (['buy', 'craft'] as const).map((u) =>
              h('button', { class: u === chosen ? 'on' : '', onclick: (e: Event) => { e.stopPropagation(); toggle(pr.item, u); } }, u === 'buy' ? 'Buy' : 'Craft'),
            ),
          )
        : h('span', { class: 'muted small' }, craft ? 'craft (not sold)' : buyOk ? 'buy' : 'no price');

    return h(
      'tr',
      { class: `d${Math.min(pr.depth, 6)}${chosen === 'craft' ? ' crafted' : ''}` },
      h(
        'td',
        { class: 'part', style: { paddingLeft: `${0.5 + pr.depth * 1.4}rem` } },
        pr.depth ? h('span', { class: 'branch' }, '└ ') : null,
        itemLink(pr.item, it?.name, it?.quality),
        pr.source.kind === 'craft' && (pr.source.recipe.name !== it?.name || pr.source.recipe.qty > 1)
          ? h('span', { class: 'muted small' }, ` · ${pr.source.recipe.name !== it?.name ? pr.source.recipe.name : ''}${pr.source.recipe.qty > 1 ? ` makes ${pr.source.recipe.qty}` : ''}`)
          : null,
      ),
      h('td', { class: 'num' }, qtyText(pr.need)),
      h(
        'td',
        { class: `num${cheaper === 'buy' && craft ? ' cheaper' : ''}` },
        buyOk ? [money(c.buy.unit), h('span', { class: 'muted small' }, c.buy.kind === 'vendor' ? ' vendor' : ' AH')] : h('span', { class: 'muted small' }, 'not sold'),
      ),
      h('td', { class: `num${cheaper === 'craft' && buyOk ? ' cheaper' : ''}` }, craft ? money(craft.unit) : h('span', { class: 'muted small' }, '—')),
      h('td', {}, use, extra ? h('div', { class: 'warn-text small' }, cheaper === 'buy' ? 'buying is ' : 'crafting is ', money(extra), ' cheaper each') : null),
      h('td', { class: 'num' }, Number.isFinite(pr.source.unit) ? money(pr.source.unit * pr.need) : '—'),
    );
  };

  const draw = () => {
    const engine = planEngine();
    const ev = engine.evaluate(r, inv);
    const rows = planRows(ev.parts, 1, 0, engine);

    const presets = h(
      'div',
      { class: 'presets' },
      STRATEGIES.map((s) => {
        const pe = row[s];
        const active = !overrides.size && s === strategy;
        const isCheapest = pe.complete && Math.abs(pe.cost - cheapestCost) < 0.5;
        return h(
          'button',
          { class: active ? 'active' : '', title: STRATEGY_HINT[s], onclick: () => { strategy = s; overrides.clear(); listBox.replaceChildren(); draw(); } },
          h('span', { class: 'p-label' }, STRATEGY_LABEL[s]),
          h('span', { class: 'p-cost' }, pe.complete ? money(pe.cost) : 'missing prices', isCheapest ? h('span', { class: 'tag ah' }, 'cheapest') : null),
          h('span', { class: 'p-hint' }, STRATEGY_HINT[s]),
        );
      }),
      overrides.size ? h('span', { class: 'custom' }, h('span', { class: 'tag' }, 'custom mix'), ' ', h('button', { class: 'link small', onclick: () => { overrides.clear(); draw(); } }, 'reset')) : null,
    );

    const makeBtn = h('button', { class: 'primary' }, `Shopping list: ${planName()}`);
    makeBtn.addEventListener('click', () => {
      const crafts = Math.max(1, Math.min(1000, Math.floor(Number(qtyInput.value) || 1)));
      const list = buildShoppingList(data, state.market, planEngine(), r, crafts, { inventory: useStock.checked ? inv : undefined, cut: state.settings.cut });
      listBox.replaceChildren(renderShoppingList(list, planName(), state));
      listBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    body.replaceChildren(
      ...nodes(
        presets,
        h(
          'div',
          { class: 'plan-summary' },
          h('strong', {}, planName()),
          ': cost ',
          ev.complete ? money(ev.cost) : h('span', { class: 'muted' }, 'missing prices'),
          ' → sells for ',
          money(ev.revenue),
          ev.complete ? [' → profit ', money(ev.profit, { signed: true }), ' ', pctTag(ev)] : null,
        ),
        h(
          'table',
          { class: 'plan compact' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, `Parts for 1 craft`),
              h('th', { class: 'num' }, 'Need'),
              h('th', { class: 'num', title: 'Cheapest on the AH, or from a vendor' }, 'Buy each'),
              h('th', { class: 'num', title: 'Crafting one, with the choices made for its own parts below' }, 'Craft each'),
              h('th', {}, 'Use'),
              h('th', { class: 'num' }, 'Subtotal'),
            ),
          ),
          h('tbody', {}, rows.map(planRow)),
          h('tfoot', {}, h('tr', {}, h('td', { colSpan: 5 }, 'Total for 1 craft'), h('td', { class: 'num' }, ev.complete ? money(ev.cost) : '—'))),
        ),
        h('p', { class: 'muted small' }, 'Green = the cheaper way for that part. Switch any part between Buy and Craft: crafting it opens its own parts underneath.'),
        h('div', { class: 'row' }, h('label', { class: 'field' }, 'Crafts ', qtyInput), h('label', { class: 'field' }, useStock, ' use what I have in bags & bank'), makeBtn),
      ),
    );
  };
  draw();

  return h(
    'div',
    { class: 'chain' },
    h('div', {}, h('strong', {}, r.name), ` makes ${r.qty} × `, itemLink(r.out, product?.name, product?.quality), '. Lowest on AH: ', money(row.best.ahUnit), ` (${row.best.ahQty} listed), vendor pays `, money(row.best.vendorUnit), '.'),
    flowLine(state, r.out, row.best.ahQty),
    body,
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
  // Gathered items (ore, herbs, leather, fish): free to make, so "profit" is what they sell for.
  for (const g of gathersFor(data, char, settings.recipeScope)) {
    const e = { ...engines.best.evaluate(g, inv), craftableNow: inv.get(g.out) ?? 0, margin: NaN };
    rows.push({ best: e, buy: e, craft: e });
  }

  const filters = { q: '', prof: 'all', profitable: false, makeable: false };
  const profOptions = [...new Set(rows.map((e) => e.best.recipe.skill))].map((s) => [String(s), skillName(data, s)]);

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
              return [
                r.best.recipe.qty > 1 ? `${r.best.recipe.qty} × ` : '',
                itemLink(r.best.recipe.out, it?.name, it?.quality),
                r.best.recipe.gather && BONUS_ITEMS.has(r.best.recipe.out) ? h('span', { class: 'muted small', title: 'Only drops as a bonus while gathering something else' }, ' bonus') : null,
              ];
            },
          },
          { label: 'Profession', value: (r) => skillName(data, r.best.recipe.skill) },
          { label: 'Buy all', numeric: true, title: 'Buy every reagent, craft nothing but the item itself', value: (r) => cost(r.buy), render: (r) => (r.best.recipe.gather ? gathered() : costCell(r.buy, cost(r.best))) },
          { label: 'Craft all', numeric: true, title: 'Craft every reagent you can (with the allowed recipes), buy only the rest', value: (r) => cost(r.craft), render: (r) => (r.best.recipe.gather ? gathered() : costCell(r.craft, cost(r.best))) },
          { label: 'Best', numeric: true, title: 'Cheapest mix: buy or craft each reagent, whichever costs less', value: (r) => cost(r.best), render: (r) => (r.best.recipe.gather ? gathered() : costCell(r.best)) },
          {
            label: 'Sells for',
            numeric: true,
            title: 'Per craft, after the AH cut, or the vendor price if that is better',
            value: (r) => r.best.revenue,
            render: (r) => [money(r.best.revenue), ' ', h('span', { class: `tag ${r.best.channel}` }, r.best.channel === 'ah' ? 'AH' : 'vendor')],
          },
          { label: 'Listed', numeric: true, title: 'How many are on the AH right now', value: (r) => r.best.ahQty },
          {
            label: 'Sold/day',
            numeric: true,
            title: 'Estimated from the hourly Blizzard snapshots (all sellers). Low numbers mean it sells slowly.',
            value: (r) => flowFor(state, r.best.recipe.out)?.perDay ?? -1,
            render: (r) => flowCell(flowFor(state, r.best.recipe.out), r.best.ahQty),
          },
          { label: 'Profit', numeric: true, title: 'Per craft using the best mix; for gathered items, what one sells for', value: (r) => (r.best.complete ? r.best.profit : -Infinity), render: (r) => (r.best.complete ? money(r.best.profit, { signed: true }) : '—') },
          { label: 'Profit %', numeric: true, title: 'Profit as a share of what the best mix costs (none for gathered items: they cost only time)', value: (r) => (r.best.complete && Number.isFinite(r.best.margin) ? r.best.margin : -Infinity), render: (r) => (r.best.recipe.gather ? h('span', { class: 'muted' }, 'free') : r.best.complete ? pctTag(r.best) : '—') },
          { label: 'Can make', numeric: true, title: 'From your bags and bank (direct reagents); for gathered items, how many you have', value: (r) => r.best.craftableNow },
        ],
        {
          sortBy: 8,
          desc: true,
          empty: char ? 'No recipes match. Try "All recipes in my professions" or clear the filters.' : 'Import an export from the game first.',
          onRow: (row, tr) => {
            const next = tr.nextElementSibling;
            if (next?.classList.contains('detail')) return next.remove();
            tr.after(h('tr', { class: 'detail' }, h('td', { colSpan: 11 }, row.best.recipe.gather ? renderGatherDetail(row.best, state, engines.best, inv) : renderDetail(row, state, engines, inv))));
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
