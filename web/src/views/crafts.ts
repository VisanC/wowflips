import { Engine, type CraftEval, type Part, type Source } from '../engine';
import { engineOptions, inventory, knownSpells, saveSettings, type AppState } from '../state';
import { ago, h, itemLink, money, nodes, notice, pct, table, type Child } from '../ui';

function sourceLabel(s: Source, state: AppState): Child {
  switch (s.kind) {
    case 'ah':
      return h('span', { class: 'src ah' }, 'AH ', money(s.unit));
    case 'vendor':
      return h('span', { class: 'src vendor' }, 'vendor ', money(s.unit));
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

export function filterRecipes(state: AppState) {
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

export function renderCrafts(state: AppState, rerender: () => void): HTMLElement {
  const { data, settings, char, latest } = state;
  const engine = new Engine(data, state.market, engineOptions(state));
  const inv = inventory(char).total;
  const recipes = filterRecipes(state);
  const evals = recipes.map((r) => engine.evaluate(r, inv)).filter((e) => data.items.has(e.recipe.out));

  const filters = { q: '', prof: 'all', profitable: false, makeable: false };
  const out = h('div');

  const profOptions = [...new Set(evals.map((e) => e.recipe.skill))].map((s) => [String(s), data.skills.get(s) ?? `Skill ${s}`]);

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
        title: 'How to cost crafted reagents (tubes, bars, …)',
        onchange: (e: Event) => { settings.craftMode = (e.target as HTMLSelectElement).value as typeof settings.craftMode; saveSettings(settings); rerender(); },
      },
      h('option', { value: 'known', selected: settings.craftMode === 'known' }, 'Sub-crafts: only recipes I know'),
      h('option', { value: 'all', selected: settings.craftMode === 'all' }, 'Sub-crafts: any recipe'),
      h('option', { value: 'none', selected: settings.craftMode === 'none' }, 'Sub-crafts: buy everything'),
    ),
    h('label', {}, h('input', { type: 'checkbox', onchange: (e: Event) => { filters.profitable = (e.target as HTMLInputElement).checked; draw(); } }), ' profitable only'),
    h('label', {}, h('input', { type: 'checkbox', onchange: (e: Event) => { filters.makeable = (e.target as HTMLInputElement).checked; draw(); } }), ' can make now'),
  );

  const results = h('div');
  const draw = () => {
    const rows = evals.filter((e) => {
      if (filters.prof !== 'all' && String(e.recipe.skill) !== filters.prof) return false;
      if (filters.profitable && !(e.complete && e.profit > 0)) return false;
      if (filters.makeable && e.craftableNow < 1) return false;
      if (filters.q) {
        const itemName = data.items.get(e.recipe.out)?.name.toLowerCase() ?? '';
        if (!e.recipe.name.toLowerCase().includes(filters.q) && !itemName.includes(filters.q)) return false;
      }
      return true;
    });
    results.replaceChildren(
      table<CraftEval>(
        rows,
        [
          {
            label: 'Makes',
            value: (e) => data.items.get(e.recipe.out)?.name ?? '',
            render: (e) => {
              const it = data.items.get(e.recipe.out);
              return [e.recipe.qty > 1 ? `${e.recipe.qty} × ` : '', itemLink(e.recipe.out, it?.name, it?.quality)];
            },
          },
          { label: 'Profession', value: (e) => data.skills.get(e.recipe.skill) ?? '' },
          { label: 'Cost', numeric: true, value: (e) => (e.complete ? e.cost : Infinity), render: (e) => (e.complete ? money(e.cost) : h('span', { class: 'muted', title: 'Some reagent has no AH or vendor price' }, 'missing price')) },
          {
            label: 'Sells for',
            numeric: true,
            title: 'Per craft, after the AH cut, or the vendor price if that is better',
            value: (e) => e.revenue,
            render: (e) => [money(e.revenue), ' ', h('span', { class: `tag ${e.channel}` }, e.channel === 'ah' ? 'AH' : 'vendor')],
          },
          { label: 'Listed', numeric: true, title: 'How many are on the AH right now', value: (e) => e.ahQty },
          { label: 'Profit', numeric: true, value: (e) => (e.complete ? e.profit : -Infinity), render: (e) => (e.complete ? money(e.profit, { signed: true }) : '—') },
          { label: 'Margin', numeric: true, value: (e) => (e.complete ? e.margin : -Infinity), render: (e) => (e.complete ? pct(e.margin) : '—') },
          { label: 'Can make', numeric: true, title: 'From your bags and bank (direct reagents)', value: (e) => e.craftableNow },
        ],
        {
          sortBy: 5,
          desc: true,
          empty: char ? 'No recipes match. Try "All recipes in my professions" or clear the filters.' : 'Import an export from the game first.',
          onRow: (e, tr) => {
            const next = tr.nextElementSibling;
            if (next?.classList.contains('detail')) return next.remove();
            const it = data.items.get(e.recipe.out);
            tr.after(
              h(
                'tr',
                { class: 'detail' },
                h(
                  'td',
                  { colSpan: 8 },
                  h('div', { class: 'chain' },
                    h('strong', {}, e.recipe.name), ` makes ${e.recipe.qty} × ${it?.name ?? e.recipe.out}. `,
                    'Lowest on AH: ', money(e.ahUnit), ` (${e.ahQty} listed), vendor pays `, money(e.vendorUnit), '.',
                    partsTree(e.parts, state),
                  ),
                ),
              ),
            );
          },
        },
      ),
    );
  };
  draw();

  out.append(
    ...nodes(
    h('h1', {}, 'Crafts'),
    !latest ? notice('warn', 'No AH scan yet. Costs and sale prices need one: in game, open the Auction House and type /flip scan, then /flip export.') : null,
    latest && Date.now() / 1000 - latest.takenAt > 6 * 3600 ? notice('warn', `Your latest AH scan is from ${ago(latest.takenAt)}. Prices move fast in week one; scan again before acting.`) : null,
    !char?.profs.length ? notice('info', 'No professions captured yet. In game, open each profession window once, then export again.') : null,
    controls,
    results,
    h('p', { class: 'muted small' }, 'Click a row to see where every reagent comes from. Profit does not include the AH deposit.'),
    ),
  );
  return out;
}
