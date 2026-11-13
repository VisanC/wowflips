// Browser smoke test: import two pastes, then visit every page.
// Usage: node test/e2e.mjs <baseUrl> <paste1> <paste2> <screenshotDir>
import { readFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import puppeteer from 'puppeteer-core';

const [base, paste1, paste2, shots = '/tmp/shots'] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const text = async (sel) => page.$eval(sel, (el) => el.innerText);
const go = async (route) => {
  await page.goto(`${base}#/${route}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(`main[data-route="${route}"] h1`);
};

async function importPaste(file) {
  await go('import');
  await page.$eval('textarea', (el, v) => { el.value = v; }, readFileSync(file, 'utf8'));
  await page.click('button.primary');
  await page.waitForSelector('.notice.ok, .notice.error');
  return text('.notice.ok, .notice.error');
}

console.log('import 1:', await importPaste(paste1));
console.log('import 2:', await importPaste(paste2));
console.log('import again (dupe):', (await importPaste(paste2)).slice(0, 80));
await page.screenshot({ path: `${shots}/import.png`, fullPage: true });

await go('crafts');
await page.waitForSelector('table');
const craftRows = await page.$$eval('main table tbody tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ')));
console.log('crafts rows:\n  ' + craftRows.join('\n  '));
// expand the rifle row
await page.$$eval('main table tbody tr', (r) => r.find((x) => x.innerText.startsWith('Moonsight Rifle')).click());
await page.waitForSelector('tr.detail');
console.log('top row chain:', (await text('tr.detail')).replace(/\s+/g, ' ').slice(0, 400));
await page.screenshot({ path: `${shots}/crafts.png`, fullPage: true });

// presets with their costs, the plan table, and a shopping list for each preset at qty 3
const presets = await page.$$eval('tr.detail .presets > button', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ')));
console.log('presets:\n  ' + presets.join('\n  '));
const planRows = async () => page.$$eval('tr.detail table.plan tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
console.log('plan (cheapest):\n  ' + (await planRows()).join('\n  '));
for (let i = 0; i < presets.length; i++) {
  await page.$$eval('tr.detail .presets > button', (b, i) => b[i].click(), i);
  await page.$eval('tr.detail input.qty', (el) => { el.value = '3'; });
  await page.click('tr.detail .row button.primary');
  await page.waitForSelector('tr.detail .shopping');
  console.log(`shopping list #${i + 1}:`, (await text('tr.detail .shopping')).replace(/\s+/g, ' ').slice(0, 500));
}
// back to cheapest, then flip Bronze Tube to Craft: its parts open underneath and the plan becomes custom
await page.$$eval('tr.detail .presets > button', (b) => b[0].click());
await page.$$eval('tr.detail table.plan tbody tr', (r) => r.find((x) => x.innerText.startsWith('Bronze Tube')).querySelectorAll('.seg button')[1].click());
console.log('plan (tube crafted):\n  ' + (await planRows()).join('\n  '));
console.log('summary:', await text('tr.detail .plan-summary'), '| presets bar:', await text('tr.detail .presets'));
await page.screenshot({ path: `${shots}/crafts-plan.png`, fullPage: true });
await page.click('tr.detail .row button.primary');
await page.waitForSelector('tr.detail .shopping');
console.log('custom shopping list:', (await text('tr.detail .shopping')).replace(/\s+/g, ' ').slice(0, 500));
await page.screenshot({ path: `${shots}/crafts-shopping.png`, fullPage: true });

// sales column (TSM) and the hide-gathered toggle
const rowCount = async () => page.$$eval('main table tbody tr', (r) => r.filter((x) => !x.classList.contains('detail') && !x.parentElement.closest('tr.detail')).length);
const soldCol = await page.$$eval('main table thead th', (ths) => ths.findIndex((t) => t.innerText.startsWith('Sold/day')));
console.log('sold/day for rifle:', await page.$$eval('main table tbody tr', (r, i) => { const row = r.find((x) => x.innerText.startsWith('Moonsight Rifle')); return row.children[i].innerText + ' | ' + row.children[i].querySelector('span')?.title; }, soldCol));
console.log('rifle sales line:', (await page.$$eval('tr.detail p.flow', (p) => p.map((x) => x.innerText))).join(' / '));
const before = await rowCount();
await page.$$eval('main .controls label', (ls) => ls.find((l) => l.innerText.includes('hide gathered')).querySelector('input').click());
await page.waitForFunction(() => ![...document.querySelectorAll('main table tbody tr')].some((x) => x.innerText.includes('gathered')));
console.log(`hide gathered: ${before} rows -> ${await rowCount()} rows; gathered left: ${await page.$$eval('main table tbody tr', (r) => r.filter((x) => x.innerText.includes('gathered')).length)}`);
await page.$$eval('main .controls label', (ls) => ls.find((l) => l.innerText.includes('hide gathered')).querySelector('input').click());
await page.waitForFunction(() => [...document.querySelectorAll('main table tbody tr')].some((x) => x.innerText.includes('gathered')));

// "Sub-crafts: any recipe" re-renders without errors
await page.select('main .controls select:nth-of-type(3)', 'all');
await page.waitForSelector('main table');
console.log('any-recipe mode, top rows:', (await page.$$eval('main table tbody tr', (t) => t.slice(0, 3).map((r) => r.innerText.replace(/\s+/g, ' ')))).join(' | '));
await page.select('main .controls select:nth-of-type(3)', 'known');

// gathered items appear as rows; their detail compares selling raw with processing
const gatherRows = await page.$$eval('main table tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')).filter((t) => t.includes('gathered')));
console.log('gather rows:\n  ' + gatherRows.join('\n  '));
await page.$$eval('main table tbody tr', (r) => r.find((x) => x.innerText.startsWith('Mithril Ore')).click());
await page.waitForSelector('tr.detail .chain');
console.log('mithril ore detail:', (await text('tr.detail')).replace(/\s+/g, ' '));
await page.screenshot({ path: `${shots}/crafts-gather.png`, fullPage: true });

// Deals, Learn and Leveling tabs
const rowsOf = async (sel = 'main table tbody tr') => page.$$eval(sel, (r) => r.filter((x) => !x.classList.contains('detail') && !x.parentElement.closest('tr.detail')).map((x) => x.innerText.replace(/\s+/g, ' ')));
await go('deals');
console.log('deals headings:', await page.$$eval('main h2', (hs) => hs.map((x) => x.innerText)));
console.log('deals tables:', JSON.stringify(await page.$$eval('main table', (ts) => ts.map((t) => [...t.querySelectorAll('tbody tr')].slice(0, 3).map((r) => r.innerText.replace(/\s+/g, ' '))))));
await page.screenshot({ path: `${shots}/deals.png`, fullPage: true });

await go('learn');
console.log('learn rows:\n  ' + (await rowsOf()).slice(0, 6).join('\n  '));
await page.$$eval('main table tbody tr', (r) => r[0]?.click());
await page.waitForSelector('tr.detail table.plan');
console.log('learn detail presets:', await text('tr.detail .presets'));
await page.screenshot({ path: `${shots}/learn.png`, fullPage: true });

// Recipe Master: load the made-up fixture through the folder input, as a folder pick would
const rmDir = new URL('./fixtures/recipemaster/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const rmFiles = walk(rmDir).map((p) => ({ path: relative(rmDir, p), text: readFileSync(p, 'utf8') }));
await go('import');
await page.$eval('input.rm-input', (el, files) => {
  const dt = new DataTransfer();
  for (const f of files) {
    const file = new File([f.text], f.path.split('/').pop());
    Object.defineProperty(file, 'webkitRelativePath', { value: f.path });
    dt.items.add(file);
  }
  el.files = dt.files;
  el.dispatchEvent(new Event('change'));
}, rmFiles);
await page.waitForSelector('.notice.ok, .notice.error');
console.log('recipe master:', await text('.notice.ok, .notice.error'));
console.log('recipe master card:', (await text('main .card:last-of-type')).replace(/\s+/g, ' ').slice(0, 120));
await go('learn');
await page.$$eval('main .controls input[type=checkbox]', (c) => { c[0].click(); });
console.log('learn rows with Recipe Master:\n  ' + (await rowsOf()).slice(0, 8).join('\n  '));
console.log('learn notice gone:', !(await page.$('main .notice.info')));
await page.screenshot({ path: `${shots}/learn-rm.png`, fullPage: true });

await go('leveling');
console.log('leveling profs:', await page.$$eval('main .controls select', (s) => s[0].innerText.replace(/\s+/g, ' | ')));
console.log('leveling summary:', await text('main .plan-summary'));
console.log('leveling steps:\n  ' + (await rowsOf('main > div > div > div > .table-wrap table tbody tr, main table tbody tr')).slice(0, 8).join('\n  '));
await page.$$eval('main .controls select', (s) => { s[1].value = 'trainer'; s[1].dispatchEvent(new Event('change')); });
console.log('leveling with trainer recipes:', await text('main .plan-summary'));
await page.screenshot({ path: `${shots}/leveling.png`, fullPage: true });

await go('inventory');
console.log('inventory:', (await text('main p')).replace(/\s+/g, ' '));
await page.screenshot({ path: `${shots}/inventory.png`, fullPage: true });

await go('changes');
console.log('changes:', (await text('main')).replace(/\s+/g, ' ').slice(0, 300));
console.log('sells fastest:', await page.$$eval('main h2', (hs) => { const h = hs.find((x) => x.innerText === 'Sells fastest'); let el = h.nextElementSibling; const out = [el.innerText]; el = el.nextElementSibling; out.push(...[...el.querySelectorAll('tbody tr')].slice(0, 4).map((r) => r.innerText.replace(/\s+/g, ' '))); return out; }));
await page.screenshot({ path: `${shots}/changes.png`, fullPage: true });

await go('items');
await page.type('main input[type=search]', 'mithril');
await page.waitForSelector('.matches button');
await page.click('.matches button');
await page.waitForSelector('.card');
console.log('item detail:', (await text('.card')).replace(/\s+/g, ' ').slice(0, 400));
await page.screenshot({ path: `${shots}/items.png`, fullPage: true });

await go('settings');
console.log('settings about:', (await text('main')).includes('Game data: WoW Forever build'));
await page.screenshot({ path: `${shots}/settings.png`, fullPage: true });

// reload: data must persist in IndexedDB
await page.reload({ waitUntil: 'networkidle0' });
await go('crafts');
console.log('after reload, header:', (await text('header')).replace(/\s+/g, ' '));

// Sales ledger + Auctionator data (an export from the addon test with mails, crafts and Auctionator)
if (process.env.LEDGER_PASTE) {
  console.log('import 3 (ledger):', await importPaste(process.env.LEDGER_PASTE));
  await go('sales');
  console.log('sales kpis:', await text('main .kpis'));
  console.log('sales rows:\n  ' + (await page.$$eval('main table tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')))).join('\n  '));
  await page.$$eval('main table tbody tr', (r) => r.find((x) => x.innerText.startsWith('Moonsight Rifle')).click());
  await page.waitForSelector('tr.detail .chart svg');
  console.log('rifle chart legend:', await text('tr.detail .chart-legend'), '| marks:', await page.$$eval('tr.detail .chart svg', (s) => [s[0].querySelectorAll('.sale').length, s[0].querySelectorAll('polyline').length]));
  await page.$eval('tr.detail .chart', (el) => el.scrollIntoView({ block: 'center' }));
  const box = await page.$('tr.detail .chart svg .hit');
  const bb = await box.boundingBox();
  await page.mouse.move(bb.x + bb.width - 5, bb.y + bb.height / 2);
  console.log('hover tooltip:', await page.$eval('tr.detail .chart-tip', (t) => (t.hidden ? '(hidden)' : t.innerText.replace(/\s+/g, ' '))));
  await page.screenshot({ path: `${shots}/sales.png`, fullPage: true });
  await go('items');
  await page.type('main input[type=search]', 'moonsight rifle');
  await page.waitForSelector('.matches button');
  await page.click('.matches button');
  await page.waitForSelector('.card');
  console.log('item card chart:', await page.$$eval('.card .chart', (c) => c.length), await text('.card h3').catch(() => 'no h3'));
  await page.screenshot({ path: `${shots}/item-chart.png`, fullPage: true });
}

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
