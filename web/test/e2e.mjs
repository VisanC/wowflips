// Browser smoke test: import two pastes, then visit every page.
// Usage: node test/e2e.mjs <baseUrl> <paste1> <paste2> <screenshotDir>
import { readFileSync, mkdirSync } from 'node:fs';
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
  await page.waitForSelector('main h1');
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
// expand the top row (sorted by profit)
await page.click('main table tbody tr');
await page.waitForSelector('tr.detail');
console.log('top row chain:', (await text('tr.detail')).replace(/\s+/g, ' ').slice(0, 400));
await page.screenshot({ path: `${shots}/crafts.png`, fullPage: true });

// the three options, cheapest first, then a shopping list for each at qty 3
const options = await page.$$eval('tr.detail details.option > summary', (s) => s.map((x) => x.innerText.replace(/\s+/g, ' ')));
console.log('options (ranked):\n  ' + options.join('\n  '));
const costs = await page.$$eval('tr.detail details.option .opt-cost', (s) => s.map((x) => x.innerText));
console.log('option costs:', costs.join(' | '));
await page.$eval('tr.detail input.qty', (el) => { el.value = '3'; });
const btnCount = (await page.$$('tr.detail details.option summary button')).length;
for (let i = 0; i < btnCount; i++) {
  const btns = await page.$$('tr.detail details.option summary button');
  await btns[i].click();
  await page.waitForSelector('tr.detail .shopping');
  console.log(`shopping list #${i + 1}:`, (await text('tr.detail .shopping')).replace(/\s+/g, ' ').slice(0, 600));
}
await page.screenshot({ path: `${shots}/crafts-shopping.png`, fullPage: true });

// "Sub-crafts: any recipe" re-renders without errors
await page.select('main .controls select:nth-of-type(3)', 'all');
await page.waitForSelector('main table');
console.log('any-recipe mode, top rows:', (await page.$$eval('main table tbody tr', (t) => t.slice(0, 3).map((r) => r.innerText.replace(/\s+/g, ' ')))).join(' | '));
await page.select('main .controls select:nth-of-type(3)', 'known');

await go('inventory');
console.log('inventory:', (await text('main p')).replace(/\s+/g, ' '));
await page.screenshot({ path: `${shots}/inventory.png`, fullPage: true });

await go('changes');
console.log('changes:', (await text('main')).replace(/\s+/g, ' ').slice(0, 500));
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

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
