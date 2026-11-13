import { Engine, type CraftEval } from '../engine';
import { salesCell, soldPerDay } from '../flowView';
import { learnLevel, learnLevelKnown } from '../leveling';
import { recipeItemFor } from '../recipeItems';
import { engineOptions, inventory, knownSpells, type AppState } from '../state';
import { h, itemLink, money, nodes, notice, signedPct, table } from '../ui';
import { recipePanel } from './crafts';

interface LearnRow {
  e: CraftEval;
  learn: number;
  learnKnown: boolean; // false: a trainer recipe not seen yet, `learn` is its yellow level as a guess
  rank?: number; // your skill in that profession
  recipeItem?: number;
  recipePrice?: number; // cheapest listing of the recipe item
  payback?: number; // crafts until the recipe item has paid for itself
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
    .map((r) => {
      const e = engine.evaluate(r, inv);
      const recipeItem = r.trainerSeen ? undefined : recipeItemFor(data, r);
      const recipePrice = recipeItem ? market.ah.get(recipeItem)?.min : undefined;
      const price = r.trainerSeen ? r.trainerCost : recipePrice;
      return {
        e,
        learn: learnLevel(r),
        learnKnown: learnLevelKnown(r),
        rank: rankBySkill.get(r.skill),
        recipeItem,
        recipePrice,
        payback: price !== undefined && e.complete && e.profit > 0 ? Math.ceil(price / e.profit) : undefined,
      };
    });

  const filters = { q: '', prof: 'mine', profitable: true, learnable: false, listedOnly: false };
  const seenTrainers = new Set((char.trainers ?? []).map((t) => t.prof));
  const missingTrainers = char.profs.map((p) => p.n).filter((n) => [...data.skills.values()].includes(n) && !seenTrainers.has(n));
  const profIds = [...new Set(all.map((x) => x.e.recipe.skill))].sort((a, b) => (data.skills.get(a) ?? '').localeCompare(data.skills.get(b) ?? ''));
  const results = h('div');

  const howToLearn = (x: LearnRow) => {
    const r = x.e.recipe;
    if (r.trainerSeen) return ['Trainer ', money(r.trainerCost ?? 0)];
    if (!x.recipeItem) return h('span', { class: 'muted', title: 'No recipe item teaches it, so most likely a trainer does. Talk to your trainer once with the addon to get its skill level and cost.' }, 'trainer (not seen yet)');
    const it = data.items.get(x.recipeItem);
    return [itemLink(x.recipeItem, it?.name.replace(/^[^:]+: /, ''), it?.quality), ' ', x.recipePrice !== undefined ? money(x.recipePrice) : h('span', { class: 'muted small' }, 'not on AH')];
  };

  const draw = () => {
    const rows = all.filter((x) => {
      const r = x.e.recipe;
      if (filters.prof === 'mine' ? x.rank === undefined : filters.prof !== 'all' && String(r.skill) !== filters.prof) return false;
      if (filters.profitable && !(x.e.complete && x.e.profit > 0)) return false;
      if (filters.learnable && !(x.rank !== undefined && x.rank >= x.learn)) return false;
      if (filters.listedOnly && x.recipeItem && x.recipePrice === undefined) return false;
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
            title: 'Skill needed; green when you have it. "≈" = trainer recipe not seen yet: its yellow level as a guess',
            value: (x) => x.learn,
            render: (x) =>
              h(
                'span',
                { class: x.rank !== undefined && x.rank >= x.learn ? 'cheaper' : 'muted', title: x.learnKnown ? '' : 'Not known yet: talk to your trainer once with the addon (0.4.0+) and export' },
                `${x.learnKnown ? '' : '≈ '}${x.learn}`,
              ),
          },
          { label: 'Profit/craft', numeric: true, title: 'Best mix of buying and crafting the parts', value: (x) => (x.e.complete ? x.e.profit : -Infinity), render: (x) => (x.e.complete ? money(x.e.profit, { signed: true }) : '—') },
          { label: 'Profit %', numeric: true, value: (x) => (x.e.complete ? x.e.margin : -Infinity), render: (x) => (x.e.complete ? h('span', { class: `pct ${x.e.profit >= 0 ? 'pos' : 'neg'}` }, signedPct(x.e.margin)) : '—') },
          { label: 'Sold/day', numeric: true, value: (x) => soldPerDay(state, x.e.recipe.out) ?? -1, render: (x) => salesCell(state, x.e.recipe.out, x.e.ahQty) },
          { label: 'How to learn', value: (x) => x.recipePrice ?? (x.recipeItem ? Infinity : 0), render: howToLearn },
          { label: 'Pays back', numeric: true, title: 'Crafts until the recipe (item or trainer cost) has paid for itself', value: (x) => x.payback ?? Infinity, render: (x) => (x.payback !== undefined ? `${x.payback} crafts` : '—') },
        ],
        {
          sortBy: 3,
          desc: true,
          empty: 'No recipes match. Untick "profitable only" or pick another profession.',
          onRow: (x, tr) => {
            const next = tr.nextElementSibling;
            if (next?.classList.contains('detail')) return next.remove();
            tr.after(h('tr', { class: 'detail' }, h('td', { colSpan: 8 }, recipePanel(state, x.e.recipe))));
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
      missingTrainers.length
        ? notice('info', `Trainer recipes show "≈" levels until the addon has seen your trainer: talk to your ${missingTrainers.join(' and ')} trainer once (addon 0.4.0+), then export.`)
        : null,
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
        h('label', { title: 'Hide recipes whose recipe item is not on the AH right now' }, h('input', { type: 'checkbox', onchange: (e: Event) => { filters.listedOnly = (e.target as HTMLInputElement).checked; draw(); } }), ' recipe for sale now'),
      ),
      results,
    ),
  );
}
