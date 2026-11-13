// Browser test of the Blizzard API flow with the API mocked (Forever-shaped responses).
// Usage: node test/e2e-blizzard.mjs <baseUrl> <gamePaste> [screenshotDir]
import { readFileSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const [base, paste, shots = '/tmp/shots'] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });

// House 110 = same prices as the in-game paste; 111 = a different house (prices doubled).
const prices = { 3858: 840, 3860: 1199, 2841: 175, 4371: 399, 4375: 410, 4400: 1888, 1705: 600, 2840: 164, 3576: 150, 2592: 138 };
// Snapshot times relative to now (the app plans auto-fetches from them): hour 0 is ~4 h ago.
const BASE = Math.floor(Date.now() / 3600e3) * 3600e3 - 4 * 3600e3 + 5 * 60e3;
const lm = (hour) => new Date(BASE + hour * 3600e3).toUTCString();
let lastModified = lm(0);
// Hours since the first snapshot: the market moves each hour so sales can be measured.
const tick = () => Math.max(0, Math.round((Date.parse(lastModified) - BASE) / 3600e3));
const house = (id, factor) => {
  const t = tick();
  const rifles = [
    { id: 1, item: { id: 4383 }, buyout: 10890 * factor, quantity: 1, time_left: 'LONG' }, // sells in hour 1
    { id: 2, item: { id: 4383 }, buyout: 24000 * factor, quantity: 2, time_left: 'LONG' },
    { id: 4, item: { id: 4383 }, buyout: 30000 * factor, quantity: 1, time_left: 'SHORT' }, // expires in hour 1: not a sale
  ].filter((a) => t === 0 || (a.id !== 1 && a.id !== 4));
  if (t >= 2) rifles.push({ id: 3, item: { id: 4383 }, buyout: 11500 * factor, quantity: 1, time_left: 'VERY_LONG' });
  const commodities = Object.entries(prices).map(([item, p], i) => ({
    id: 100 + i,
    item: { id: Number(item) },
    // Mithril Bar (3860): 10 bought every hour
    quantity: Number(item) === 3860 ? 50 - 10 * t : 50,
    unit_price: p * factor,
    time_left: 'LONG',
  }));
  if (t >= 1) commodities.push({ id: 900 + t, item: { id: 3858 }, quantity: 20, unit_price: prices[3858] * factor, time_left: 'VERY_LONG' });
  return {
    item: { id, name: id === 110 ? 'Alliance Auction House' : 'Horde Auction House', ruleset: { key: { href: 'x' }, name: 'PvP', id: 1 }, auctions: rifles, commodities: { href: 'x' } },
    commodities: { auctions: commodities },
  };
};
const routes = {
  '/data/wow/ruleset/index': () => ({ rulesets: [{ name: 'PvP', id: 1 }, { name: 'Normal', id: 2 }, { name: 'Roleplay', id: 3 }, { name: 'Roleplay PvP', id: 15 }] }),
  '/data/wow/ruleset/1/auctions/': () => ({ auctions: [{ name: 'Alliance Auction House', id: 110 }, { name: 'Horde Auction House', id: 111 }] }),
  '/data/wow/ruleset/1/auctions/110': () => house(110, 1).item,
  '/data/wow/ruleset/1/auctions/110/commodities': () => house(110, 1).commodities,
  '/data/wow/ruleset/1/auctions/111': () => house(111, 2).item,
  '/data/wow/ruleset/1/auctions/111/commodities': () => house(111, 2).commodities,
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 900 },
});
const page = await browser.newPage();
const errors = [];
const apiCalls = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(`console: ${m.text()}`));
await page.setRequestInterception(true);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
page.on('request', (req) => {
  const url = new URL(req.url());
  if (url.host !== 'oauth.battle.net' && !url.host.endsWith('api.blizzard.com')) return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
  apiCalls.push(`${req.method()} ${url.pathname}?${url.searchParams.get('namespace') ?? ''}`);
  if (url.host === 'oauth.battle.net') {
    const ok = req.headers().authorization === `Basic ${Buffer.from('my-id:my-secret').toString('base64')}`;
    return req.respond({ status: ok ? 200 : 401, headers: cors, contentType: 'application/json', body: JSON.stringify(ok ? { access_token: 'tok' } : { error: 'unauthorized' }) });
  }
  const body = url.searchParams.get('namespace') === 'dynamic-forever-eu' ? routes[url.pathname]?.() : undefined;
  if (!body) return req.respond({ status: 404, headers: cors, body: '' });
  req.respond({ status: 200, headers: { ...cors, 'Last-Modified': lastModified }, contentType: 'application/json', body: JSON.stringify(body) });
});

const text = async (sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' '));
const go = async (route) => {
  await page.goto(`${base}#/${route}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(`main[data-route="${route}"] h1`);
};
const waitText = (t) => page.waitForFunction((t) => document.querySelector('main').innerText.includes(t), { timeout: 15000 }, t);
/** Sets the hourly auto-fetch checkbox on the Settings page and checks it was saved. */
const setAutoFetch = async (want) => {
  await waitText('every hour');
  const before = await page.$$eval('main label', (ls, want) => {
    const input = ls.find((l) => l.innerText.includes('every hour')).querySelector('input');
    const was = input.checked;
    if (input.checked !== want) input.click();
    return was;
  }, want);
  const raw = await page.evaluate(() => localStorage.getItem('forever-flips:settings'));
  const saved = JSON.parse(raw ?? '{}').autoFetch;
  if (saved !== want) throw new Error(`autoFetch saved as ${saved}, wanted ${want} (checkbox was ${before}; stored ${raw})`);
};

// 1. In-game paste first, so the house check has something to compare with.
await go('import');
await page.$eval('textarea', (el, v) => { el.value = v; }, readFileSync(paste, 'utf8'));
await page.click('main button.primary');
await page.waitForSelector('main .notice.ok, main .notice.error');

// 2. Settings: hourly auto-fetch off for now (tested at the end), then wrong secret, then right one.
await go('settings');
await setAutoFetch(false);
const setInput = async (sel, value) => page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); }, value);
await setInput('input[type=text]', 'my-id');
await setInput('input[type=password]', 'wrong');
const connect = async () => (await page.$$('main button')).find(async (b) => (await b.evaluate((x) => x.textContent)) === 'Connect');
const clickButton = async (label) => {
  const btns = await page.$$('main button');
  for (const b of btns) if ((await b.evaluate((x) => x.textContent)) === label) return b.click();
  throw new Error(`no button ${label}`);
};
void connect;
await clickButton('Connect');
await waitText('rejected');
console.log('wrong secret ->', (await text('.notice.error')).slice(0, 80));
await setInput('input[type=password]', 'my-secret');
await clickButton('Connect');
await page.waitForFunction(() => document.querySelectorAll('main select').length >= 3 && [...document.querySelectorAll('main select')].some((s) => s.innerText.includes('Alliance Auction House')));
console.log('rulesets:', await page.$$eval('main select', (s) => s.map((x) => x.innerText.replace(/\s+/g, ' | '))));

// pick the Horde house first: should be flagged as not ours
const houseSelect = (await page.$$('main select'))[2];
await houseSelect.select('111');
await clickButton('Download and check this house');
await waitText('Compared with your in-game scan');
console.log('house 111 ->', (await page.$$eval('main .notice', (n) => n.map((x) => x.innerText.replace(/\s+/g, ' ')).filter((t) => t.includes('Compared'))))[0]);

await houseSelect.select('110');
await clickButton('Download and check this house');
await waitText('Looks like your auction house');
console.log('house 110 ->', (await page.$$eval('main .notice', (n) => n.map((x) => x.innerText.replace(/\s+/g, ' ')).filter((t) => t.includes('Compared'))))[0]);
await page.screenshot({ path: `${shots}/blizzard-settings.png`, fullPage: true });
await clickButton('Use this house and save this scan');
await waitText('Fetching from');
console.log('saved ->', (await page.$$eval('main .notice.ok', (n) => n.map((x) => x.innerText.replace(/\s+/g, ' '))))[0]);

// 3. Import page: fetch again (same Last-Modified -> no new scan), then newer data.
await go('import');
await clickButton('Fetch prices from Blizzard');
await waitText('not published newer data');
console.log('same data ->', (await text('main .notice')).slice(0, 120));
lastModified = lm(1);
await clickButton('Fetch prices from Blizzard');
await waitText('saved a scan');
console.log('newer data ->', (await text('main .notice')).slice(0, 120));
console.log('scans table:', await page.$$eval('main table tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' '))));
await page.screenshot({ path: `${shots}/blizzard-import.png`, fullPage: true });

// 4. Header button and crafts using API prices
await go('crafts');
console.log('header:', await text('header'));
const top = await page.$$eval('main table tbody tr', (r) => r.slice(0, 2).map((x) => x.innerText.replace(/\s+/g, ' ')));
console.log('crafts top:', top);
lastModified = lm(2);
await page.click('header button');
await page.waitForFunction(() => document.querySelector('header').innerText.includes('new scan'), { timeout: 15000 });
console.log('header after fetch:', await text('header'));

// 5. Throughput after two hourly comparisons
await go('crafts');
const sold = await page.$$eval('main table thead th', (ths) => ths.map((t) => t.innerText));
console.log('crafts columns:', sold.join(' | '));
const rifleRow = await page.$$eval('main table tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')).find((t) => t.startsWith('Moonsight')));
console.log('rifle row:', rifleRow);
await page.$$eval('main table tbody tr', (r) => r.find((x) => x.innerText.startsWith('Moonsight')).click());
await page.waitForSelector('tr.detail p.flow');
console.log('rifle flow:', await text('tr.detail p.flow'));
await page.$eval('tr.detail input.qty', (el) => { el.value = '4'; });
await page.click('tr.detail .row button.primary');
await page.waitForSelector('tr.detail .shopping');
console.log('shopping tail:', (await text('tr.detail .shopping .totals')) + ' / ' + (await page.$$eval('tr.detail .shopping p', (p) => p.map((x) => x.innerText).filter((t) => t.includes('days') || t.includes('None sold')).join(' '))));
await page.screenshot({ path: `${shots}/blizzard-crafts-flow.png`, fullPage: true });

await go('changes');
console.log('fastest sellers:', await page.$$eval('main table tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' '))));
await go('items');
await page.type('main input[type=search]', 'mithril bar');
await page.waitForSelector('.matches button');
await page.click('.matches button');
await page.waitForSelector('.card p.flow');
console.log('mithril bar flow:', await text('.card p.flow'));
await go('settings');
console.log('settings sales status:', await page.$$eval('main p', (p) => p.map((x) => x.innerText).find((t) => t.startsWith('Sales data'))));

// 6. Auto-fetch: turn it on, newer data appears, the page fetches by itself and offers to show it.
await setAutoFetch(true);
lastModified = lm(3);
const before = apiCalls.length;
await page.reload({ waitUntil: 'networkidle0' }); // auto-fetch is scheduled when the site loads
await go('crafts');
await page.waitForFunction(() => document.querySelector('header').innerText.includes('auto-fetched'), { timeout: 20000 });
console.log('auto-fetch header:', await text('header'), `(${apiCalls.length - before} API calls)`);
await page.$$eval('header button', (b) => b.find((x) => x.innerText.includes('show new prices')).click());
await page.waitForFunction(() => !document.querySelector('header').innerText.includes('show new prices'));
console.log('after show:', await text('header'));

console.log('API calls:', [...new Set(apiCalls)].join('\n  '));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
