import './style.css';
import { loadGameData, type GameData } from './gamedata';
import { fetchConfiguredHouse } from './blizzardSync';
import { db } from './db';
import { blizzardReady, loadSettings, loadState, saveSettings, type AppState } from './state';
import { ago, h, moneyText, notice } from './ui';
import { renderChanges } from './views/changes';
import { renderCrafts } from './views/crafts';
import { renderDeals } from './views/deals';
import { renderLearn } from './views/learn';
import { renderLeveling } from './views/leveling';
import { renderSales } from './views/sales';
import { underMarket, vendorFlips } from './deals';
import { renderImport } from './views/importView';
import { renderInventory } from './views/inventory';
import { renderItems } from './views/items';
import { renderSettings } from './views/settings';

const ROUTES = [
  ['crafts', 'Crafts'],
  ['deals', 'Deals'],
  ['learn', 'Learn'],
  ['leveling', 'Leveling'],
  ['sales', 'Sales'],
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

let headerMsg = '';
let newDataWaiting = false;

// Blizzard publishes a new snapshot about once an hour. Auto-fetch checks as soon as the
// next one is due, then every 4 minutes until it appears. Each fetch also records what sold.
const RETRY_MS = 4 * 60_000;
const AFTER_UPDATE_MS = 61 * 60_000;
let nextAuto = 0;
let fetching = false;

async function runFetch(auto: boolean): Promise<boolean> {
  if (fetching) return false;
  fetching = true;
  try {
    const { added, snap } = await fetchConfiguredHouse(settings);
    nextAuto = Math.max(Date.now() + RETRY_MS, snap.takenAt * 1000 + AFTER_UPDATE_MS);
    headerMsg = added ? `${auto ? 'auto-fetched' : 'new scan'}: ${snap.rows.length.toLocaleString()} items` : auto ? '' : 'no newer data yet';
    return added;
  } catch (e) {
    nextAuto = Date.now() + 3 * RETRY_MS;
    headerMsg = (e as Error).message;
    return false;
  } finally {
    fetching = false;
  }
}

async function autoFetchTick() {
  if (!state || !settings.autoFetch || !blizzardReady(settings) || fetching || Date.now() < nextAuto) return;
  const added = await runFetch(true);
  // Don't re-render the page under the user (open rows, filters); offer a link instead.
  state = await loadState(data, settings);
  if (added) {
    newDataWaiting = true;
    notifyDeals();
  }
  app.querySelector('header')?.replaceWith(header());
}

const NOTIFIED_KEY = 'forever-flips:notified-deals';

/** After new prices arrive: a browser notification for deals not announced before (item at that price). */
function notifyDeals() {
  if (!settings.dealAlerts || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const opts = { maxPct: settings.dealMaxPct, minSold: settings.dealMinSold, minProfit: settings.dealMinProfit, cut: settings.cut };
  const found = [
    ...vendorFlips(data, state.market).filter((f) => f.profit >= settings.dealMinProfit).map((f) => ({ item: f.item, price: f.price, profit: f.profit, why: 'below vendor price' })),
    ...underMarket(state.market, state.tsm, opts).map((d) => ({ item: d.item, price: d.price, profit: d.profit, why: `${Math.round(d.pct * 100)}% of market` })),
  ];
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  const fresh = found.filter((d) => seen[d.item] !== d.price).sort((a, b) => b.profit - a.profit);
  if (!fresh.length) return;
  for (const d of found) seen[d.item] = d.price;
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
  const lines = fresh.slice(0, 4).map((d) => `${data.items.get(d.item)?.name ?? d.item}: ${d.why}, ~${moneyText(d.profit)} profit`);
  const n = new Notification(`${fresh.length} new deal${fresh.length > 1 ? 's' : ''} on the AH`, { body: lines.join('\n'), tag: 'forever-flips-deals' });
  n.onclick = () => {
    window.focus();
    location.hash = '#/deals';
  };
}

function fetchButton(): HTMLElement | null {
  if (!blizzardReady(settings)) return null;
  const btn = h('button', { class: 'small-btn', title: `Fetch the latest prices for ${settings.blizzHouseLabel ?? 'your auction house'} from Blizzard` }, fetching ? 'Fetching…' : '↻ Fetch AH');
  btn.disabled = fetching;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Fetching…';
    await runFetch(false);
    await refresh();
  });
  return btn;
}

function header(): HTMLElement {
  const current = route();
  const msg = headerMsg;
  headerMsg = '';
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
    h(
      'div',
      { class: 'status' },
      charSelect,
      state.latest
        ? h(
            'span',
            { class: 'muted' },
            ` · AH ${state.latest.source === 'api' ? 'from Blizzard' : 'scan'} ${ago(state.latest.takenAt)}`,
            state.settings.useTsmHouse && state.tsmHouse && state.tsmHouse.updatedAt > state.latest.takenAt ? `, TSM ${ago(state.tsmHouse.updatedAt)}` : '',
          )
        : state.settings.useTsmHouse && state.tsmHouse
          ? h('span', { class: 'muted' }, ` · AH from TSM ${ago(state.tsmHouse.updatedAt)}`)
          : h('span', { class: 'muted' }, ' · no AH scan yet'),
      fetchButton(),
      msg ? h('span', { class: 'muted small' }, msg) : null,
      newDataWaiting ? h('button', { class: 'link small', onclick: () => void render() }, 'show new prices') : null,
    ),
  );
}

let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  newDataWaiting = false;
  const r = route();
  let view: HTMLElement;
  switch (r) {
    case 'import': view = await renderImport(state, refresh); break;
    case 'inventory': view = renderInventory(state); break;
    case 'changes': view = renderChanges(state); break;
    case 'items': view = renderItems(state); break;
    case 'deals': view = renderDeals(state); break;
    case 'learn': view = renderLearn(state); break;
    case 'leveling': view = renderLeveling(state); break;
    case 'sales': view = await renderSales(state); break;
    case 'settings': view = await renderSettings(state, refresh); break;
    default: view = renderCrafts(state, () => void render());
  }
  if (seq !== renderSeq) return; // a newer render started while this one was loading
  app.replaceChildren(header(), h('main', { 'data-route': r }, view));
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

  const lastApi = await db.snapshots.orderBy('takenAt').reverse().filter((s) => s.source === 'api').first();
  nextAuto = lastApi ? lastApi.takenAt * 1000 + AFTER_UPDATE_MS : 0;
  setTimeout(() => void autoFetchTick(), 5_000);
  setInterval(() => void autoFetchTick(), 60_000);
}

void start();
