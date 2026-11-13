import { Engine, type CraftEval } from '../engine';
import { salesCell, soldPerDay } from '../flowView';
import { learnCost, type LearnCost } from '../learnCost';
import { learnLevel, learnLevelKnown } from '../leveling';
import { SPECIALIZATIONS } from '../recipeMaster';
import { engineOptions, inventory, knownSpells, type AppState } from '../state';
import type { Recipe } from '../types';
import { h, itemLink, money, nodes, notice, signedPct, table } from '../ui';
import { recipePanel } from './crafts';

interface LearnRow {
  e: CraftEval;
  learn: number;
  learnKnown: boolean; // false: no data for it, `learn` is its yellow level as a guess
  rank?: number; // your skill in that profession
  cost: LearnCost; // cheapest way to learn it
  payback?: number; // crafts until learning it has paid for itself
}

/** The four skill levels where a recipe turns orange, yellow, green and grey. */
export function skillLevels(r: Recipe, learn: number): HTMLElement {
  const green = r.green ?? Math.round((r.yellow + r.grey) / 2);
  return h(
    'span',
    { class: 'levels', title: 'Orange from the learn level (always a point), yellow (usually), green (rarely), grey (never)' },
    h('span', { class: 'skill-orange' }, String(learn)),
    ' ',
    h('span', { class: 'skill-yellow' }, String(r.yellow)),
    ' ',
    h('span', { class: 'skill-green' }, String(green)),
    ' ',
    h('span', { class: 'skill-grey' }, String(r.grey)),
  );
}

/** "Trainer 1g", "Vendor 25s", "AH 3g", "not on AH"… */
export function costCell(state: AppState, c: LearnCost, r: Recipe): HTMLElement {
  const { data } = state;
  const spec = r.rm?.spec ? h('span', { class: 'tag', title: 'Needs this specialization' }, SPECIALIZATIONS[r.rm.spec] ?? 'specialization') : null;
  const itemName = c.item ? data.items.get(c.item)?.name : undefined;
  const main: (Node | string)[] =
    c.how === 'trainer'
      ? c.guess
        ? [h('span', { class: 'muted', title: 'No recipe item teaches it, so most likely a trainer does. Load Recipe Master on the Import page to know for sure.' }, 'trainer?')]
        : ['Trainer', ...(c.cost !== undefined ? [' ', money(c.cost)] : [])]
      : c.how === 'vendor'
        ? ['Vendor ', c.cost !== undefined ? money(c.cost) : (c.text ?? '')]
        : c.how === 'ah'
          ? [h('span', { title: itemName ?? '' }, 'AH '), money(c.cost ?? 0)]
          : c.how === 'item'
            ? [h('span', { class: 'muted', title: `${itemName ?? 'The recipe item'} is not on the AH right now` }, 'not on AH')]
            : [h('span', { class: 'muted' }, '—')];
  return h('span', {}, ...main, spec ? ' ' : null, spec);
}

export function renderLearn(state: AppState): HTMLElement {
  const { data, char, market } = state;
  const head = h('h1', {}, 'Recipes to learn');
  if (!char) return h('div', {}, head, notice('info', 'Import an export from the game first, so the site knows your professions and recipes.'));

  const known = knownSpells(char);
  const rankBySkill = new Map<number, number>();
  for (const p of char.profs) {
    const id = [...data.skills.entries()].find(([, n]) => n === p.n)?.[0];
    if (id !== undefined) rankBySkill.set(id, p.r);
  }
  const engine = new Engine(data, market, { ...engineOptions(state), strategy: 'best' });
  const inv = inventory(char).total;

  const all: LearnRow[] = data.recipes
    .filter((r) => !known.has(r.spell) && data.items.has(r.out))
    .filter((r) => !(r.rm?.faction && char.faction && r.rm.faction !== char.faction))
    .map((r) => {
      const e = engine.evaluate(r, inv);
      const cost = learnCost(data, market, r);
      return {
        e,
        learn: learnLevel(r),
        learnKnown: learnLevelKnown(r),
        rank: rankBySkill.get(r.skill),
        cost,
        payback: cost.cost !== undefined && e.complete && e.profit > 0 ? Math.ceil(cost.cost / e.profit) : undefined,
      };
    });

  const filters = { q: '', prof: 'mine', profitable: true, learnable: false, listedOnly: false };
  const profIds = [...new Set(all.map((x) => x.e.recipe.skill))].sort((a, b) => (data.skills.get(a) ?? '').localeCompare(data.skills.get(b) ?? ''));
  const results = h('div');

  const draw = () => {
    const rows = all.filter((x) => {
      const r = x.e.recipe;
      if (filters.prof === 'mine' ? x.rank === undefined : filters.prof !== 'all' && String(r.skill) !== filters.prof) return false;
      if (filters.profitable && !(x.e.complete && x.e.profit > 0)) return false;
      if (filters.learnable && !(x.rank !== undefined && x.rank >= x.learn)) return false;
      if (filters.listedOnly && x.cost.cost === undefined && !x.cost.text) return false;
      if (filters.q && !r.name.toLowerCase().includes(filters.q) && !(data.items.get(r.out)?.name.toLowerCase().includes(filters.q) ?? false)) return false;
      return true;
    });
    results.replaceChildren(
      table<LearnRow>(
        rows,
        [
          {
            label: 'Makes',
            value: (x) => data.items.get(x.e.recipe.out)?.name ?? '',
            render: (x) => [x.e.recipe.qty > 1 ? `${x.e.recipe.qty} × ` : '', itemLink(x.e.recipe.out, data.items.get(x.e.recipe.out)?.name, data.items.get(x.e.recipe.out)?.quality)],
          },
          { label: 'Profession', value: (x) => data.skills.get(x.e.recipe.skill) ?? '' },
          {
            label: 'Learn at',
            numeric: true,
            title: 'Skill needed; green when you have it. "≈" = no data for it: its yellow level as a guess',
            value: (x) => x.learn,
            render: (x) =>
              h(
                'span',
                { class: x.rank !== undefined && x.rank >= x.learn ? 'cheaper' : 'muted', title: x.learnKnown ? '' : 'Not known: load Recipe Master on the Import page' },
                `${x.learnKnown ? '' : '≈ '}${x.learn}`,
              ),
          },
          { label: 'Skill-ups', title: 'Orange · yellow · green · grey: points always, usually, rarely, never', value: (x) => x.e.recipe.grey, render: (x) => skillLevels(x.e.recipe, x.learn) },
          { label: 'Profit/craft', numeric: true, title: 'Best mix of buying and crafting the parts', value: (x) => (x.e.complete ? x.e.profit : -Infinity), render: (x) => (x.e.complete ? money(x.e.profit, { signed: true }) : '—') },
          { label: 'Profit %', numeric: true, value: (x) => (x.e.complete ? x.e.margin : -Infinity), render: (x) => (x.e.complete ? h('span', { class: `pct ${x.e.profit >= 0 ? 'pos' : 'neg'}` }, signedPct(x.e.margin)) : '—') },
          { label: 'Sold/day', numeric: true, value: (x) => soldPerDay(state, x.e.recipe.out) ?? -1, render: (x) => salesCell(state, x.e.recipe.out, x.e.ahQty) },
          { label: 'Learn cost', title: 'Cheapest way to learn it: trainer, vendor, or the recipe on the AH', value: (x) => x.cost.cost ?? (x.cost.how === 'trainer' ? 0 : Infinity), render: (x) => costCell(state, x.cost, x.e.recipe) },
          { label: 'Pays back', numeric: true, title: 'Crafts until learning it has paid for itself', value: (x) => x.payback ?? Infinity, render: (x) => (x.payback !== undefined ? `${x.payback} crafts` : '—') },
        ],
        {
          sortBy: 4,
          desc: true,
          empty: 'No recipes match. Untick "profitable only" or pick another profession.',
          onRow: (x, tr) => {
            const next = tr.nextElementSibling;
            if (next?.classList.contains('detail')) return next.remove();
            tr.after(h('tr', { class: 'detail' }, h('td', { colSpan: 9 }, recipePanel(state, x.e.recipe))));
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
      head,
      h('p', { class: 'muted' }, "Recipes you don't know yet, with what they would earn at today's prices. Click one for its full buy-or-craft plan."),
      !state.latest ? notice('warn', 'No AH scan yet, so nothing can be priced.') : null,
      state.recipeMaster
        ? null
        : notice('info', 'Trainer recipes show "≈" learn levels (a guess). Load Recipe Master on the Import page for the real learn levels, skill-up levels and vendor prices.'),
      h(
        'div',
        { class: 'controls' },
        h('input', { type: 'search', placeholder: 'Search recipes or items…', oninput: (e: Event) => { filters.q = (e.target as HTMLInputElement).value.toLowerCase(); draw(); } }),
        h(
          'select',
          { onchange: (e: Event) => { filters.prof = (e.target as HTMLSelectElement).value; draw(); } },
          h('option', { value: 'mine' }, 'My professions'),
          h('option', { value: 'all' }, 'All professions'),
          profIds.map((id) => h('option', { value: String(id) }, data.skills.get(id) ?? `Skill ${id}`)),
        ),
        h('label', {}, h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => { filters.profitable = (e.target as HTMLInputElement).checked; draw(); } }), ' profitable only'),
        h('label', {}, h('input', { type: 'checkbox', onchange: (e: Event) => { filters.learnable = (e.target as HTMLInputElement).checked; draw(); } }), ' I can learn it now'),
        h('label', { title: 'Hide recipes you cannot buy right now (recipe item not on the AH, no trainer or vendor)' }, h('input', { type: 'checkbox', onchange: (e: Event) => { filters.listedOnly = (e.target as HTMLInputElement).checked; draw(); } }), ' recipe for sale now'),
      ),
      results,
    ),
  );
}
