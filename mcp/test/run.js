// Tests the MCP's data loading and tools on a made-up WoW folder: the addon's logic with the
// test game data, a saved FlipExport, an Auctionator database (CBOR, as the game saves it) and
// TSM app data (base 32, as the TSM app writes it). Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Flips } from '../server/flips.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADDON = path.join(HERE, '..', '..', 'addon', 'FlipExport');
const wow = fs.mkdtempSync(path.join(os.tmpdir(), 'flips-'));
const addon = path.join(wow, 'addon');
for (const f of ['Core.lua', 'Logic/Data.lua', 'Logic/Prices.lua', 'Logic/Engine.lua', 'Logic/Leveling.lua', 'Logic/Deals.lua', 'Logic/Sales.lua', 'Logic/Queue.lua']) {
  fs.mkdirSync(path.dirname(path.join(addon, f)), { recursive: true });
  fs.copyFileSync(path.join(ADDON, f), path.join(addon, f));
}
fs.mkdirSync(path.join(addon, 'Data'), { recursive: true });
fs.copyFileSync(path.join(HERE, '..', '..', 'addon', 'tests', 'fixtures', 'GameData.lua'), path.join(addon, 'Data', 'GameData.lua'));

const now = Math.floor(Date.now() / 1000);
const sv = path.join(wow, 'WTF', 'Account', 'ACC', 'SavedVariables');
fs.mkdirSync(sv, { recursive: true });
fs.writeFileSync(path.join(sv, 'FlipExport.lua'), `
FlipExportDB = {
	["ah"] = { ["t"] = ${now - 3600}, ["kind"] = "summary", ["i"] = {
		{ 2840, 10, 50, {} }, { 3576, 20, 40, {} }, { 2841, 100, 30, {} }, { 4371, 2600, 8, {} },
		{ 4382, 4000, 3, {} }, { 2592, 30, 99, {} }, { 3860, 300, 12, {} }, { 2770, 4, 80, {} }, { 2771, 5, 80, {} },
	} },
	["detail"] = { [3860] = { ["t"] = ${now - 60}, ["levels"] = { { 300, 2 }, { 350, 3 } }, ["qty"] = 5, ["complete"] = true } },
	["atrSeen"] = { ["4371"] = ${now - 10} },
	["vendor"] = {},
	["ui"] = { ["priceDepth"] = 3, ["cut"] = 0.05 },
	["chars"] = {
		["Tu-Test Realm"] = {
			["profs"] = {
				["Engineering"] = { ["n"] = "Engineering", ["r"] = 150, ["m"] = 225, ["t"] = ${now}, ["s"] = { 3938, 3953, 3958 } },
				["Mining"] = { ["n"] = "Mining", ["r"] = 175, ["m"] = 225, ["t"] = ${now}, ["s"] = { 2657, 3304, 2659, 3307, 10097 } },
			},
			["queue"] = { [3953] = 2 },
			["bags"] = { ["t"] = ${now}, ["i"] = { { 2770, 2 }, { 2771, 2 } } },
			["bank"] = { ["t"] = ${now}, ["i"] = { { 2592, 1 } } },
			["info"] = { ["t"] = ${now}, ["n"] = "Tu", ["f"] = "Alliance", ["l"] = 40, ["g"] = 123456 },
			["ledger"] = { ["mail"] = { a = { k = "sold", n = "Bronze Tube", i = 4371, c = 2, p = 5000, f = 250, t = ${now - 7200} } }, ["crafts"] = {} },
		},
		["Alt-Test Realm"] = { ["profs"] = {} },
	},
}`);

// Auctionator: the realm's table as CBOR (byte-string keys, like C_EncodingUtil does)
function cbor(v) {
  const out = [];
  const head = (major, n) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 256) out.push((major << 5) | 24, n);
    else if (n < 65536) out.push((major << 5) | 25, n >> 8, n & 255);
    else out.push((major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  };
  const enc = (x) => {
    if (typeof x === 'number') head(0, x);
    else if (typeof x === 'string') { const b = Buffer.from(x); head(2, b.length); out.push(...b); }
    else { const keys = Object.keys(x); head(5, keys.length); for (const k of keys) { enc(k); enc(x[k]); } }
  };
  enc(v);
  return Buffer.from(out);
}
const day = Math.floor((now - Date.UTC(2020, 0, 1) / 1000) / 86400);
const realm = cbor({ 4371: { m: 2200, h: { [day]: 2300 }, l: { [day]: 2200 }, a: { [day]: 6 } }, 2592: { m: 25, h: { [day - 1]: 30 }, l: { [day - 1]: 25 }, a: { [day - 1]: 10 } } });
// the game writes binary strings as is, escaping only a few bytes
let lit = '';
for (const b of realm) lit += b === 34 || b === 92 || b === 10 || b === 13 || b === 0 || b === 26 ? `\\${b}` : String.fromCharCode(b);
fs.writeFileSync(path.join(sv, 'Auctionator.lua'), Buffer.concat([Buffer.from('AUCTIONATOR_PRICE_DATABASE = {\n["__dbversion"] = 8,\n["PvP"] = "'), Buffer.from(lit, 'latin1'), Buffer.from('",\n}\n')]));

// TSM app data: values in base 32; sold per day and sale rate x1000
const b32 = (n) => n.toString(32).toUpperCase();
const tsmDir = path.join(wow, 'Interface', 'AddOns', 'TradeSkillMaster_AppHelper');
fs.mkdirSync(tsmDir, { recursive: true });
fs.writeFileSync(path.join(tsmDir, 'AppData.lua'), [
  `select(2, ...).LoadData("AUCTIONDB_REGION_SALE","Forever-EU",[[return {downloadTime=${now - 86400},fields={"itemString","regionSale","regionSoldPerDay","regionSalePercent"},data={{4371,${b32(2500)},${b32(12500)},${b32(450)}},{4382,${b32(3900)},${b32(800)},${b32(300)}},{2840,${b32(12)},${b32(400000)},${b32(900)}}}}]])`,
  `select(2, ...).LoadData("AUCTIONDB_NON_COMMODITY_DATA","PvP-Alliance",[[return {downloadTime=${now - 7200},fields={"itemString","minBuyout","numAuctions","marketValueRecent"},data={{4382,${b32(4100)},3,${b32(4200)}},{"i:12345:1",${b32(10)},1,${b32(10)}}}}]])`,
  `select(2, ...).LoadData("AUCTIONDB_NON_COMMODITY_DATA","PvP-Horde",[[return {downloadTime=${now - 7200},fields={"itemString","minBuyout","numAuctions","marketValueRecent"},data={{4382,${b32(99999)},3,${b32(99999)}}}}]])`,
  `select(2, ...).LoadData("AUCTIONDB_COMMODITY_HISTORICAL","Forever-EU",[[return {downloadTime=${now - 86400},fields={"itemString","historical"},data={{2840,${b32(1234567890123)}}}}]])`,
].join('\n'));

const flips = new Flips({ wowDir: wow, addonDir: addon });
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; } catch (e) { console.error('FAIL', name); throw e; }
}

await test('status: character, professions, sources', async () => {
  const s = await flips.call('status');
  assert.equal(s.character, 'Tu-Test Realm', 'the character played last');
  assert.equal(s.money_g, 12.3456);
  assert.equal(s.professions.length, 2);
  assert.equal(s.ah_scan.kind, 'summary');
  assert.equal(s.auctionator.items, 2, 'CBOR decoded');
  assert.equal(s.tsm.realm, 'PvP-Alliance', "your faction's realm data");
  assert.equal(s.queued_crafts, 2);
});

await test('item: every source', async () => {
  const tube = await flips.call('item', { item: 'bronze tube' });
  assert.equal(tube.id, 4371);
  assert.equal(tube.ah.source, 'auctionator', 'Auctionator saw it after the scan');
  assert.equal(tube.ah.price_g, 0.22);
  assert.equal(tube.tsm.region_sold_per_day, 12.5, 'x1000 in the data');
  assert.equal(tube.tsm.region_sale_rate_pct, 45);
  assert.equal(tube.tsm.region_avg_sale_g, 0.25);
  const bar = await flips.call('item', { item: 2840 });
  assert.equal(bar.tsm.historical_g, 123456789.0123, 'values past 6 base-32 digits');
  assert.equal(bar.tsm.region_sold_per_day, 400);
  const mithril = await flips.call('item', { item: 'Mithril Bar' });
  assert.equal(mithril.ah.source, 'listings');
  assert.deepEqual(mithril.ah.cheapest_listings, [{ price_g: 0.03, count: 2 }, { price_g: 0.035, count: 3 }]);
  const framework = await flips.call('item', { item: 'Bronze Framework' });
  assert.equal(framework.tsm.market_g, undefined, 'no market value stored');
  const vague = await flips.call('item', { item: 'bar' });
  assert.ok(vague.error && vague.candidates.length > 1, 'ambiguous names list candidates');
});

await test('best crafts and a plan', async () => {
  const b = await flips.call('best_crafts', { limit: 10, include_unprofitable: true });
  assert.ok(b.crafts.length > 0);
  const tube = b.crafts.find((c) => c.name === 'Bronze Tube');
  assert.ok(tube && tube.known && tube.region_sold_per_day === 12.5);
  const p = await flips.call('craft_plan', { recipe: 'Bronze Framework', count: 2 });
  assert.equal(p.count, 2);
  const steps = p.with_your_bags_and_bank.steps.map((s) => `${s.recipe} x${s.crafts}`);
  assert.deepEqual(steps.slice(0, 2).sort(), ['Smelt Copper x2', 'Smelt Tin x2'], 'your ore gets smelted: ' + steps);
  const shop = Object.fromEntries(p.with_your_bags_and_bank.shopping.map((s) => [s.item, s.buy]));
  assert.equal(shop['Wool Cloth'], 1, 'one wool cloth in the bank');
  const q = await flips.call('queue');
  assert.equal(q.queued[0].recipe, 'Bronze Framework');
});

await test('deals, leveling, sales', async () => {
  const d = await flips.call('deals', { mode: 'vendor' });
  assert.ok(Array.isArray(d.deals));
  const m = await flips.call('deals', { mode: 'market' });
  assert.ok(Array.isArray(m.deals));
  const l = await flips.call('leveling', { profession: 'Mining', target: 180 });
  assert.equal(l.from, 175);
  const s = await flips.call('sales');
  assert.equal(s.items[0].item, 'Bronze Tube');
  assert.equal(s.income_7_days_g, 0.475);
});

await test('reloads when the game saves', async () => {
  const file = path.join(sv, 'FlipExport.lua');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('["g"] = 123456', '["g"] = 654321'));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  const s = await flips.call('status');
  assert.equal(s.money_g, 65.4321);
});

fs.rmSync(wow, { recursive: true, force: true });
console.log(`mcp tests: ${passed} passed`);
