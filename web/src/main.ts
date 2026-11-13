import './style.css';
import { loadGameData, type GameData } from './gamedata';
import { loadSettings, loadState, saveSettings, type AppState } from './state';
import { ago, h, notice } from './ui';
import { renderChanges } from './views/changes';
import { renderCrafts } from './views/crafts';
import { renderImport } from './views/importView';
import { renderInventory } from './views/inventory';
import { renderItems } from './views/items';
import { renderSettings } from './views/settings';

const ROUTES = [
  ['crafts', 'Crafts'],
  ['inventory', 'Inventory'],
  ['changes', 'Changes'],
  ['items', 'Items'],
  ['import', 'Import'],
  ['settings', 'Settings'],
] as const;
type Route = (typeof ROUTES)[number][0];

const app = document.getElementById('app')!;
const settings = loadSettings();
let data: GameData;
let state: AppState;

function route(): Route {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.some(([k]) => k === r) ? r : state?.chars.length ? 'crafts' : 'import';
}

async function refresh() {
  state = await loadState(data, settings);
  await render();
}

function header(): HTMLElement {
  const current = route();
  const charSelect =
    state.chars.length > 1
      ? h(
          'select',
          {
            onchange: async (e: Event) => {
              settings.charKey = (e.target as HTMLSelectElement).value;
              saveSettings(settings);
              await refresh();
            },
          },
          state.chars.map((c) => h('option', { value: c.key, selected: c.key === state.char?.key }, c.key)),
        )
      : state.char
        ? h('span', {}, state.char.key)
        : null;
  return h(
    'header',
    {},
    h('a', { class: 'brand', href: '#/crafts' }, 'Forever Flips'),
    h('nav', {}, ROUTES.map(([k, label]) => h('a', { href: `#/${k}`, class: k === current ? 'active' : '' }, label))),
    h('div', { class: 'status' }, charSelect, state.latest ? h('span', { class: 'muted' }, ` · AH scan ${ago(state.latest.takenAt)}`) : h('span', { class: 'muted' }, ' · no AH scan yet')),
  );
}

async function render() {
  const r = route();
  let view: HTMLElement;
  switch (r) {
    case 'import': view = await renderImport(state, refresh); break;
    case 'inventory': view = renderInventory(state); break;
    case 'changes': view = renderChanges(state); break;
    case 'items': view = renderItems(state); break;
    case 'settings': view = await renderSettings(state, refresh); break;
    default: view = renderCrafts(state, () => void render());
  }
  app.replaceChildren(header(), h('main', {}, view));
}

async function start() {
  app.replaceChildren(h('main', {}, h('p', { class: 'muted' }, 'Loading game data…')));
  try {
    data = await loadGameData();
  } catch (e) {
    app.replaceChildren(h('main', {}, notice('error', (e as Error).message)));
    return;
  }
  await refresh();
  window.addEventListener('hashchange', () => void render());
}

void start();
