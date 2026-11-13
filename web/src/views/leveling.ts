import { Engine } from '../engine';
import { canLearn, isTrainerRecipe, knownSpecs, learnCost as cheapestLearn } from '../learnCost';
import { learnLevel, planLeveling, skillUpChance, skillUpsAt, type LevelPlan, type LevelStep, type SkillUp } from '../leveling';
import { engineOptions, knownSpells, type AppState } from '../state';
import type { Recipe } from '../types';
import { h, itemLink, money, nodes, notice, table } from '../ui';
import { recipePanel } from './crafts';
import { costCell, skillLevels } from './learn';

type Pool = 'known' | 'trainer' | 'all';
type Resale = 'vendor' | 'ah' | 'none';

const COLOR_LABEL = { locked: 'not yet', orange: 'orange', yellow: 'yellow', green: 'green', grey: 'grey' } as const;
const crafts = (n: number) => (n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n)));

export function renderLeveling(state: AppState): HTMLElement {
  const { data, char, market } = state;
  const head = h('h1', {}, 'Skill-up planner');
  if (!char) return h('div', {}, head, notice('info', 'Import an export from the game first, so the site knows your professions and recipes.'));

  const profs = char.profs
    .map((p) => ({ p, id: [...data.skills.entries()].find(([, n]) => n === p.n)?.[0] }))
    .filter((x): x is { p: (typeof char.profs)[number]; id: number } => x.id !== undefined);
  if (!profs.length) return h('div', {}, head, notice('info', 'No crafting professions captured yet. In game, open each profession window once, then export again.'));

  const known = knownSpells(char);
  const engine = new Engine(data, market, { ...engineOptions(state), strategy: 'best' });
  const cfg = { prof: profs[0].id, from: profs[0].p.r, to: Math.max(profs[0].p.m, profs[0].p.r + 1), pool: 'known' as Pool, resale: 'vendor' as Resale };

  const fromInput = h('input', { type: 'number', min: 1, max: 450, class: 'qty' });
  const toInput = h('input', { type: 'number', min: 2, max: 450, class: 'qty' });
  const setRange = () => {
    fromInput.value = String(cfg.from);
    toInput.value = String(cfg.to);
  };
  setRange();
  const out = h('div');

  const isKnown = (r: Recipe) => known.has(r.spell);
  const specs = knownSpecs(data, known);
  const inPool = (r: Recipe) => {
    if (isKnown(r)) return true;
    if (cfg.pool === 'known' || !canLearn(r, char, specs)) return false;
    if (isTrainerRecipe(data, r)) return true;
    // vendor recipes and recipe items on the AH: only when there is a gold price
    return cfg.pool === 'all' && cheapestLearn(data, market, r).cost !== undefined;
  };
  const learnCost = (r: Recipe) => (isKnown(r) ? 0 : (cheapestLearn(data, market, r).cost ?? 0));
  const netCost = (r: Recipe): number | undefined => {
    const e = engine.evaluate(r);
    if (!e.complete) return undefined;
    const item = data.items.get(r.out);
    const back = cfg.resale === 'none' ? 0 : cfg.resale === 'vendor' ? (item?.sell ?? 0) * r.qty : e.revenue;
    return e.cost - back;
  };

  const draw = () => {
    const pool = data.recipes.filter((r) => r.skill === cfg.prof && data.items.has(r.out) && inPool(r));
    const plan: LevelPlan = planLeveling(pool, cfg.from, cfg.to, netCost, { learnCost });
    const now: SkillUp[] = skillUpsAt(pool, cfg.from, netCost);
    const prof = profs.find((x) => x.id === cfg.prof)!.p;
    const profName = data.skills.get(cfg.prof) ?? '';

    // materials for the whole plan (direct reagents, expected crafts rounded up per step)
    const mats = new Map<number, number>();
    for (const s of plan.steps) {
      const n = Math.ceil(s.crafts - 1e-9);
      for (const [item, count] of s.recipe.reagents) mats.set(item, (mats.get(item) ?? 0) + n * count);
    }
    const matRows = [...mats].map(([item, qty]) => ({ item, qty, src: engine.unitCost(item) }));

    const learnTag = (r: Recipe) => {
      if (isKnown(r)) return null;
      return h('span', { class: 'tag', title: `Not known yet: learn at ${learnLevel(r)}` }, `learn ${r.learn === undefined ? '≈' : ''}${learnLevel(r)} · `, costCell(state, cheapestLearn(data, market, r), r));
    };
    const colorCell = (color: string, chance: number) => h('span', { class: `skill-${color}` }, `${COLOR_LABEL[color as keyof typeof COLOR_LABEL]} · ${Math.round(chance * 100)}%`);

    out.replaceChildren(
      ...nodes(
        h(
          'p',
          { class: 'plan-summary' },
          h('strong', {}, `${profName} ${cfg.from} → ${plan.reached}`),
          plan.steps.length ? `: about ${Math.round(plan.crafts)} crafts, ` : '',
          plan.steps.length ? (plan.total >= 0 ? ['costing about ', money(plan.total)] : ['making about ', money(-plan.total)]) : '',
          plan.steps.length ? ` (${cfg.resale === 'none' ? 'keeping what you make' : cfg.resale === 'vendor' ? 'after selling what you make to a vendor' : 'after selling what you make on the AH'}).` : '',
        ),
        cfg.to > prof.m
          ? notice('warn', `Your ${prof.n} rank stops at ${prof.m}: you need the next rank from a trainer to go past it.`)
          : null,
        h('h2', {}, `Everything that gives a point at ${cfg.from} (${now.length})`),
        table<SkillUp>(
          now,
          [
            {
              label: 'Craft',
              value: (u) => u.recipe.name,
              render: (u) => [itemLink(u.recipe.out, data.items.get(u.recipe.out)?.name, data.items.get(u.recipe.out)?.quality), u.recipe.qty > 1 ? ` ×${u.recipe.qty}` : '', ' ', learnTag(u.recipe)],
            },
            { label: 'Color · chance', value: (u) => u.chance, render: (u) => colorCell(u.color, u.chance) },
            { label: 'Net each', numeric: true, title: 'Cost of one craft minus what the product brings back', value: (u) => u.net, render: (u) => money(u.net) },
            { label: 'Per point', numeric: true, title: 'Expected net cost per skill point (net each ÷ chance)', value: (u) => u.perPoint, render: (u) => money(u.perPoint) },
            { label: 'Skill-ups', title: 'Orange · yellow · green · grey', value: (u) => u.recipe.grey, render: (u) => skillLevels(u.recipe, learnLevel(u.recipe)) },
          ],
          {
            sortBy: 3,
            desc: false,
            empty: `Nothing in this list gives a point at ${cfg.from}.`,
            onRow: (u, tr) => {
              const next = tr.nextElementSibling;
              if (next?.classList.contains('detail')) return next.remove();
              tr.after(h('tr', { class: 'detail' }, h('td', { colSpan: 5 }, recipePanel(state, u.recipe))));
            },
          },
        ),
        h('h2', {}, 'Cheapest path'),
        plan.stuckAt !== undefined
          ? notice(
              'warn',
              `Stuck at ${plan.stuckAt}: no ${cfg.pool === 'known' ? 'recipe you know' : 'recipe in this list'} gives a skill point there${state.latest ? '' : ' (or nothing can be priced: no AH scan yet)'}. `,
              cfg.pool === 'known' ? 'Try "also trainer recipes", or learn new ones.' : '',
            )
          : null,
        table<LevelStep>(
          plan.steps,
          [
            { label: 'Skill', value: (s) => s.from, render: (s) => `${s.from} → ${s.to}` },
            {
              label: 'Craft',
              value: (s) => s.recipe.name,
              render: (s) => [itemLink(s.recipe.out, data.items.get(s.recipe.out)?.name, data.items.get(s.recipe.out)?.quality), s.recipe.qty > 1 ? ` ×${s.recipe.qty}` : '', ' ', learnTag(s.recipe)],
            },
            { label: 'Color', value: (s) => s.colorAtStart, render: (s) => h('span', { class: `skill-${s.colorAtStart}` }, `${COLOR_LABEL[s.colorAtStart]}${s.colorAtStart !== 'orange' ? ` (${Math.round(skillUpChance(s.recipe, s.from) * 100)}%)` : ''}`) },
            { label: 'Crafts', numeric: true, title: 'Expected number of crafts (yellow and green ones sometimes give no point)', value: (s) => s.crafts, render: (s) => `≈ ${crafts(s.crafts)}` },
            { label: 'Net each', numeric: true, title: 'Cost of one craft (best mix of buying and crafting parts) minus what the product brings back', value: (s) => s.netEach, render: (s) => money(s.netEach) },
            { label: 'Step total', numeric: true, title: 'Expected net cost, plus learning the recipe the first time it is used', value: (s) => s.total, render: (s) => [money(s.total), s.learnCost ? h('span', { class: 'muted small' }, [' incl. learning ', money(s.learnCost)]) : null] },
          ],
          {
            sortBy: 0,
            desc: false,
            empty: 'No steps: pick a higher target, or a recipe list with more recipes.',
            onRow: (s, tr) => {
              const next = tr.nextElementSibling;
              if (next?.classList.contains('detail')) return next.remove();
              tr.after(h('tr', { class: 'detail' }, h('td', { colSpan: 6 }, recipePanel(state, s.recipe))));
            },
          },
        ),
        matRows.length ? h('h2', {}, 'Materials for the whole plan') : null,
        matRows.length
          ? table(
              matRows,
              [
                { label: 'Item', value: (m) => data.items.get(m.item)?.name ?? '', render: (m) => itemLink(m.item, data.items.get(m.item)?.name, data.items.get(m.item)?.quality) },
                { label: 'Qty', numeric: true, value: (m) => m.qty },
                { label: 'Each', numeric: true, value: (m) => m.src.unit, render: (m) => money(m.src.unit) },
                { label: 'Total', numeric: true, value: (m) => m.src.unit * m.qty, render: (m) => money(m.src.unit * m.qty) },
                { label: 'Get it by', value: (m) => m.src.kind, render: (m) => (m.src.kind === 'craft' ? `crafting (${m.src.recipe.name})` : m.src.kind === 'vendor' ? 'vendor' : m.src.kind === 'ah' ? 'AH' : 'no price') },
              ],
              { sortBy: 3, desc: true },
            )
          : null,
        h('p', { class: 'muted small' }, 'Skill-up chance: orange always, then falling from 100% at yellow to 0% at grey. Crafts are expected counts, so real runs vary a little. Materials assume the expected crafts, rounded up per step; check in game, your bags may already hold some.'),
      ),
    );
  };

  const profSelect = h(
    'select',
    {
      onchange: (e: Event) => {
        cfg.prof = Number((e.target as HTMLSelectElement).value);
        const p = profs.find((x) => x.id === cfg.prof)!.p;
        cfg.from = p.r;
        cfg.to = Math.max(p.m, p.r + 1);
        setRange();
        draw();
      },
    },
    profs.map(({ p, id }) => h('option', { value: String(id) }, `${p.n} (${p.r}/${p.m})`)),
  );
  fromInput.addEventListener('change', () => { cfg.from = Math.max(1, Number(fromInput.value) || 1); draw(); });
  toInput.addEventListener('change', () => { cfg.to = Math.max(cfg.from + 1, Number(toInput.value) || cfg.from + 1); draw(); });

  draw();
  return h(
    'div',
    {},
    ...nodes(
      head,
      h('p', { class: 'muted' }, "The cheapest way to raise a profession at today's prices: for every skill point, the recipe with the lowest expected cost per point. Click a step for its full buy-or-craft plan."),
      !state.latest ? notice('warn', 'No AH scan yet, so nothing can be priced.') : null,
      h(
        'div',
        { class: 'controls' },
        profSelect,
        h('label', { class: 'field' }, 'From ', fromInput),
        h('label', { class: 'field' }, 'to ', toInput),
        h(
          'select',
          { title: 'Which recipes the plan may use', onchange: (e: Event) => { cfg.pool = (e.target as HTMLSelectElement).value as Pool; draw(); } },
          h('option', { value: 'known' }, 'Recipes I know'),
          h('option', { value: 'trainer' }, 'Also trainer recipes'),
          h('option', { value: 'all' }, 'Also vendor and AH recipes'),
        ),
        h(
          'select',
          { title: 'What happens to what you craft', onchange: (e: Event) => { cfg.resale = (e.target as HTMLSelectElement).value as Resale; draw(); } },
          h('option', { value: 'vendor' }, 'Sell products to a vendor'),
          h('option', { value: 'ah' }, 'Sell products on the AH'),
          h('option', { value: 'none' }, 'Keep products (no money back)'),
        ),
      ),
      out,
    ),
  );
}
