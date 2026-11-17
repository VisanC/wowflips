-- Plain-Lua tests for the addon's logic (Data, Prices, Engine, Leveling, Deals, Sales).
-- Run from the repo root: lua5.1 addon/tests/logic.lua

local ROOT = "addon/FlipExport/"
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
GetItemInfo = function() return nil end
time, date = os.time, os.date

local ns = {}
local function load(file) assert(loadfile(file))("FlipExport", ns) end
load("addon/tests/fixtures/GameData.lua")
for _, f in ipairs({ "Logic/Data.lua", "Logic/Prices.lua", "Logic/Engine.lua", "Logic/Leveling.lua", "Logic/Deals.lua", "Logic/Sales.lua", "Logic/Queue.lua" }) do load(ROOT .. f) end
local Data, Prices, Engine, Leveling, Deals, Sales, Queue = ns.Data, ns.Prices, ns.Engine, ns.Leveling, ns.Deals, ns.Sales, ns.Queue

local passed = 0
local function eq(a, b, msg)
	if a ~= b then error(("%s: expected %s, got %s"):format(msg or "value", tostring(b), tostring(a)), 2) end
end
local function test(name, fn)
	local ok, err = xpcall(fn, debug.traceback)
	if not ok then io.stderr:write("FAIL ", name, "\n", err, "\n") os.exit(1) end
	passed = passed + 1
end

local d = Data.Build(ns.GameData)
local function scanOf(rows) return { t = 1000, i = rows } end

test("game data lookups", function()
	eq(#d.recipes, 15, "recipes")
	eq(d.bySpell[3954].name, "Moonsight Rifle")
	eq(d.byOutput[3860][1].spell, 10097)
	eq(d.bySpell[2659].qty, 2, "Smelt Bronze makes 2")
	eq(#d.bySpell[3954].reagents, 4)
	eq(d.bySpell[3954].learnBase, 160, "learn level from the schematic")
	eq(d.skillByName.Engineering, 202)
	eq(Data.ItemSell(d, 3860), 400)
	assert(#d.gathers > 0, "gathered items")
end)

test("AH price: the cheapest 3 units", function()
	eq(Prices.AhPrice(100, { { 100, 1 }, { 100000, 5 } }, 3), math.floor((100 + 200000) / 3 + 0.5))
	eq(Prices.AhPrice(500, { { 500, 200 }, { 900, 1 } }, 3), 500)
	eq(Prices.AhPrice(100, { { 100, 1 }, { 300, 1 } }, 5), 200)
	eq(Prices.AhPrice(100, { { 100, 1 }, { 300, 9 } }, 1), 100)
end)

test("market: scan, newer Auctionator data, TSM for the rest", function()
	local today = math.floor((time() - time({ year = 2020, month = 1, day = 1, hour = 0 })) / 86400)
	local atr = {
		["3858"] = { m = 900, h = { [tostring(today)] = 950 }, a = { [tostring(today)] = 40 } }, -- seen today: newer than the scan
		["3860"] = { m = 1, h = { [tostring(today - 3000)] = 2 } }, -- seen long before the scan
		["g:123:45"] = { m = 5 },
	}
	TSM_API = { GetCustomPriceValue = function(src, s) if s == "i:2592" then return ({ DBRecent = 120, DBMinBuyout = 100, DBRegionSoldPerDay = 7.5 })[src] end end }
	local m = Prices.Build(d, { scan = { t = time() - 86400 * 2, i = { { 3858, 1000, 20, { { 1000, 20 } } }, { 3860, 5000, 3, { { 5000, 1 }, { 6000, 2 } } } } }, atr = atr, depth = 3 })
	eq(m:Ah(3858).price, 900, "Auctionator saw it after the scan")
	eq(m:Ah(3858).src, "auctionator")
	eq(m:Ah(3858).qty, 40)
	eq(m:Ah(3860).price, math.floor((5000 + 12000) / 3 + 0.5), "scan, average of the cheapest 3")
	eq(m:Ah(2592).price, 120, "TSM's recent value")
	eq(m:Ah(2592).src, "tsm")
	eq(m:Ah(99999), nil)
	eq(Prices.Sales(2592).soldPerDay, 7.5)
	eq(m.vendor[2880], 100, "vendor reagent from the game data")
	TSM_API = nil
	Prices.ResetCache()
	local m2 = Prices.Build(d, { learnedVendor = { [2880] = { p = 20, t = 1 } } })
	eq(m2.vendor[2880], 20, "a price the addon saw at a vendor")
	eq(m2:Ah(2592), nil, "no TSM")
end)

test("market: exact times decide between the scan, Auctionator and TSM", function()
	local now = time()
	local today = tostring(math.floor((now - time({ year = 2020, month = 1, day = 1, hour = 0 })) / 86400))
	local atr = {
		["3858"] = { m = 900, h = { [today] = 950 } }, -- searched a minute ago (time noted)
		["3860"] = { m = 4000, h = { [today] = 4000 } }, -- seen today, time unknown: the scan from 10 min ago wins
		["g:4383:40"] = { m = 30000, h = { [today] = 30000 } }, -- gear key with item level
	}
	local scan = { t = now - 600, i = { { 3858, 1000, 20, { { 1000, 20 } } }, { 3860, 5000, 3, { { 5000, 3 } } } } }
	TSM_API = { GetCustomPriceValue = function(src, s) return ({ DBRecent = 777, DBMinBuyout = 700 })[src] end }
	Prices.ResetCache()
	local m = Prices.Build(d, { scan = scan, atr = atr, atrSeen = { ["3858"] = now - 60, ["g:4383:40"] = now - 30 }, tsmTime = now - 300, depth = 1 })
	eq(m:Ah(3858).src, "auctionator", "the search a minute ago beats TSM from 5 min ago")
	eq(m:Ah(3858).price, 900)
	eq(m:Ah(3860).src, "tsm", "TSM from 5 min ago beats the scan from 10 min ago")
	eq(m:Ah(3860).price, 700, "lowest listing setting: TSM's lowest buyout")
	eq(m:Ah(4383).price, 30000, "gear keys count (searched 30 s ago)")
	local older = Prices.Build(d, { scan = scan, atr = atr, atrSeen = { ["3858"] = now - 60 }, tsmTime = now - 3600, depth = 1 })
	eq(older:Ah(3860).src, "scan", "TSM from an hour ago loses to the scan")
	TSM_API = nil
	Prices.ResetCache()
end)

local function market(rows) return Prices.Build(d, { scan = scanOf(rows), depth = 1 }) end
local function known(...) local s = {} for _, v in ipairs({ ... }) do s[v] = true end return s end

test("engine: buy or craft, ties craft from the raw material", function()
	local m = market({ { 3858, 100, 50, {} }, { 3860, 5000, 50, {} } })
	local e = Engine.New(d, m, { cut = 0.05, craftMode = "known", known = known(10097) })
	eq(e:UnitCost(3860).kind, "craft", "smelting is cheaper")
	eq(e:UnitCost(3860).unit, 100)
	local tie = Engine.New(d, market({ { 3858, 100, 50, {} }, { 3860, 100, 50, {} } }), { craftMode = "known", known = known(10097) })
	eq(tie:UnitCost(3860).kind, "craft", "equal price: smelt the ore")
	eq(tie:Explain(3860).reason, "tie-craft")
	local buy = Engine.New(d, m, { craftMode = "known", known = known(10097), strategy = "buy" })
	eq(buy:UnitCost(3860).kind, "ah")
	local unknown = Engine.New(d, m, { craftMode = "known", known = known() })
	eq(unknown:UnitCost(3860).kind, "ah", "a recipe you don't know is not used")
	eq(unknown:Explain(3860).reason, "no-recipe")
end)

test("engine: sub-crafts only from your professions", function()
	local m = market({ { 3858, 100, 50, {} }, { 3860, 5000, 50, {} } })
	eq(Engine.New(d, m, { craftMode = "profession", known = {}, profSkills = { [186] = true } }):UnitCost(3860).kind, "craft")
	eq(Engine.New(d, m, { craftMode = "profession", known = {}, profSkills = { [202] = true } }):UnitCost(3860).kind, "ah")
end)

test("engine: overrides and evaluate", function()
	local m = market({ { 2840, 10, 99, {} }, { 3576, 20, 99, {} }, { 2841, 100, 99, {} }, { 4371, 2000, 5, {} } })
	local e = Engine.New(d, m, { cut = 0.05, craftMode = "known", known = known(2659, 3938) })
	-- bronze: smelting makes 2 from 10 + 20 = 15 each, buying costs 100
	eq(e:UnitCost(2841).unit, 15)
	local ev = e:Evaluate(d.bySpell[3938], { [2841] = 4, [2880] = 3 })
	eq(ev.cost, 15 * 2 + 100, "2 bronze crafted + 1 weak flux from a vendor")
	eq(ev.revenue, 2000 * 0.95)
	eq(ev.channel, "ah")
	eq(ev.craftableNow, 2)
	local forced = Engine.New(d, m, { cut = 0.05, craftMode = "known", known = known(2659, 3938), overrides = { [2841] = "buy" } })
	eq(forced:Evaluate(d.bySpell[3938]).cost, 100 * 2 + 100, "bronze flipped to buy")
end)

test("leveling: chances, colours, plan", function()
	local r = { spell = 1, yellow = 100, grey = 140, learn = 90, reagents = {} }
	eq(Leveling.Chance(r, 89), 0, "below learn")
	eq(Leveling.Chance(r, 95), 1, "orange")
	eq(Leveling.Chance(r, 120), 0.5)
	eq(Leveling.Color(r, 119), "yellow")
	eq(Leveling.Color(r, 120), "green", "halfway")
	r.green = 125
	eq(Leveling.Color(r, 120), "yellow", "real green level")
	local cheap = { spell = 2, yellow = 110, grey = 130, learn = 100, reagents = {} }
	local plan = Leveling.Plan({ r, cheap }, 100, 112, function(x) return x.spell == 1 and 50 or 10 end, function(x) return x.spell == 2 and 1000 or 0 end)
	eq(plan.reached, 112)
	eq(plan.steps[1].recipe.spell, 2, "cheaper per point")
	eq(plan.steps[1].learnCost, 1000, "learning it counted once")
	local ups = Leveling.SkillUpsAt({ r, cheap }, 115, function(x) return x.spell == 1 and 50 or 10 end)
	eq(#ups, 2)
	eq(ups[1].recipe.spell, 2)
end)

test("learn data: Recipe Master over trainer lists over the recipe item", function()
	local rm = { r = {
		[3938] = { 105, 105, 105, 130, 155, 1, 0, "", "", 0, 4371 },
		[3954] = { 145, 145, 170, 182, 195, 0, 15000, "", "", 0, 10000 },
		[3961] = { 170, 170, 170, 180, 190, 1, 0, "", "Horde", 0, 4389 },
		[3971] = { 200, 200, 220, 230, 240, 0, 0, "180 Merchant's Favor", "", 20219, 7742 },
	} }
	local char = { trainers = { Engineering = { t = 1, l = { { "Bronze Tube", 100, 600, "available", 4371 } } } } }
	Data.ApplyLearnData(d, char, nil)
	local tube, rifle = d.bySpell[3938], d.bySpell[3954]
	eq(tube.learn, 100, "trainer list")
	eq(tube.trainerCost, 600)
	eq(rifle.learn, 160, "schematic")
	Data.ApplyLearnData(d, char, rm)
	eq(tube.learn, 105, "Recipe Master wins")
	eq(tube.trainerCost, 600, "price still from the trainer")
	eq(rifle.learn, 145)
	eq(rifle.green, 182)
	eq(rifle.teachItem, 10000)
	local m = market({ { 10000, 20000, 1, {} } })
	local lc = Leveling.LearnCost(rifle, m)
	eq(lc.how, "vendor", "vendor 1g50s beats the AH at 2g")
	eq(lc.cost, 15000)
	eq(Leveling.LearnCost(d.bySpell[3971], market({})).text, "180 Merchant's Favor")
	eq(Leveling.LearnCost(tube, market({})).how, "trainer")
	local specs = Leveling.KnownSpecs(d, known(3938))
	eq(Leveling.CanLearn(d.bySpell[3961], "Alliance", specs), false, "Horde only")
	eq(Leveling.CanLearn(d.bySpell[3971], "Alliance", specs), false, "Gnomish only")
	eq(Leveling.CanLearn(d.bySpell[3971], "Alliance", Leveling.KnownSpecs(d, known(3971))), true)
	Data.ApplyLearnData(d, {}, nil)
	eq(tube.learn, nil, "taken off again")
	eq(rifle.green, nil)
end)

test("deals: vendor flips and under market", function()
	local m = market({ { 3860, 300, 12, { { 300, 2 }, { 350, 3 }, { 500, 7 } } } }) -- vendor pays 400
	local flips = Deals.VendorFlips(d, m)
	eq(#flips, 1)
	eq(flips[1].units, 5)
	eq(flips[1].profit, 100 * 2 + 50 * 3)
	local today = math.floor((time() - time({ year = 2020, month = 1, day = 1, hour = 0 })) / 86400)
	local lows = {}
	for i = 0, 9 do lows[tostring(today - i)] = 2000 end
	local deals = Deals.UnderMarket(d, market({ { 3858, 1000, 4, { { 1000, 4 } } } }), { maxPct = 0.7, minProfit = 0, cut = 0.05, atr = { ["3858"] = { m = 1000, l = lows } } })
	eq(#deals, 1)
	eq(deals[1].reference, 2000, "Auctionator's two-week median")
	eq(deals[1].refSrc, "auctionator")
	eq(deals[1].profit, (2000 * 0.95 - 1000) * 4)
end)

test("sales ledger", function()
	local now = time()
	local ledger = {
		mail = {
			a = { k = "sold", n = "Bronze Tube", i = 4371, c = 5, p = 10000, f = 500, t = now - 3600 },
			b = { k = "sold", n = "Bronze Tube", i = 4371, c = 1, p = 2000, f = 100, t = now - 10 * 86400 },
			c = { k = "expired", n = "Bronze Tube", i = 4371, c = 1, t = now - 2 * 86400 },
			e = { k = "won", n = "Mithril Ore", i = 0, c = 20, p = 3000, t = now - 7200 },
		},
		crafts = { ["3938|" .. (now - now % 3600)] = 4 },
	}
	local s = Sales.Summarize(d, ledger, { now = now, nameToId = function(n) return n == "Mithril Ore" and 3858 or 0 end })
	eq(s.mails, 4)
	eq(s.income7, 9500)
	eq(s.income30, 9500 + 1900)
	eq(s.spend30, 3000)
	eq(s.sellThrough30, 2 / 3)
	eq(#s.days, 30)
	eq(s.days[30].income, 9500, "today")
	local tube
	for _, e in ipairs(s.items) do if e.item == 4371 then tube = e end end
	eq(tube.soldUnits, 6)
	eq(tube.crafted, 4)
	eq(tube.expired, 1)
end)

test("queue: parts first, leftovers, shopping cost along the listings", function()
	eq(Queue.AhCost({ price = 100, levels = { { 100, 2 }, { 150, 3 } } }, 4), 100 * 2 + 150 * 2)
	eq(Queue.AhCost({ price = 100, levels = { { 100, 2 } } }, 5), 100 * 5, "past the known listings: the last price")
	local m = market({ { 2840, 10, 99, {} }, { 3576, 20, 99, {} }, { 2841, 100, 99, {} }, { 2592, 30, 99, {} } })
	local e = Engine.New(d, m, { craftMode = "known", known = known(2659, 3938, 3953) })
	-- 2 tubes + 1 framework = 6 bronze bars; 1 in the bank: 5 more = 3 smelts (one bar left over)
	local x = Queue.Expand(e, { { recipe = d.bySpell[3938], count = 2 }, { recipe = d.bySpell[3953], count = 1 } }, { [2841] = 1, [2840] = 1 })
	eq(x.crafts[1].recipe.spell, 2659, "smelting first")
	eq(x.crafts[1].count, 3)
	local buy = {}
	for _, b in ipairs(x.buy) do buy[b.item] = b end
	eq(buy[2840].qty, 2, "copper: 3 needed, 1 in the bank")
	eq(buy[3576].qty, 3, "tin")
	eq(buy[2880].kind, "vendor", "weak flux from a vendor")
	eq(buy[2592].qty, 1, "wool cloth")
	eq(x.total, 2 * 10 + 3 * 20 + 2 * 100 + 30)
end)

test("queue: what you have comes first (ore you bought gets smelted)", function()
	-- bars are cheaper on the AH than ore + smelting, so the market alone would buy bars
	local m = market({ { 2840, 10, 99, {} }, { 3576, 12, 99, {} }, { 2770, 50, 99, {} }, { 2771, 50, 99, {} }, { 2841, 10, 99, {} }, { 2592, 30, 99, {} } })
	local e = Engine.New(d, m, { craftMode = "known", known = known(2657, 3304, 2659, 3953) })
	eq(e:UnitCost(2841).kind, "ah", "bronze bars: buying is cheapest")
	-- 3 frameworks = 6 bronze bars = 3 smelts = 3 copper + 3 tin bars; you have 3 of each ore
	local x = Queue.Expand(e, { { recipe = d.bySpell[3953], count = 3 } }, { [2770] = 3, [2771] = 3 })
	local crafts, buy = {}, {}
	for _, c in ipairs(x.crafts) do crafts[c.recipe.spell] = c end
	for _, b in ipairs(x.buy) do buy[b.item] = b end
	eq(crafts[2657] and crafts[2657].count, 3, "smelt your copper ore")
	eq(crafts[3304] and crafts[3304].count, 3, "smelt your tin ore")
	eq(crafts[2659] and crafts[2659].count, 3, "then bronze")
	eq(x.crafts[1].depth, 2, "ore first")
	eq(buy[2841], nil, "no bronze bars bought") eq(buy[2840], nil) eq(buy[2770], nil)
	eq(buy[2592].qty, 3, "only the wool cloth")
	-- 2 of each ore: 2 smelts from them, the rest the cheapest way (bronze bars)
	x = Queue.Expand(e, { { recipe = d.bySpell[3953], count = 3 } }, { [2770] = 2, [2771] = 2 })
	crafts, buy = {}, {}
	for _, c in ipairs(x.crafts) do crafts[c.recipe.spell] = c end
	for _, b in ipairs(x.buy) do buy[b.item] = b end
	eq(crafts[2659].count, 2) eq(buy[2841].qty, 2, "2 bronze bars bought")
	-- "Buy all parts" buys, whatever you have
	e = Engine.New(d, m, { craftMode = "known", known = known(2657, 3304, 2659, 3953), strategy = "buy" })
	x = Queue.Expand(e, { { recipe = d.bySpell[3953], count = 1 } }, { [2770] = 3, [2771] = 3 })
	eq(#x.crafts, 1, "only the framework")
end)

test("queue plan: costs rise up the listings, how many are worth making, what to pay up to", function()
	-- every listing known: bars 10 at 1s, 10 at 1s 50c, 50 at 3s; cores 5 at 1s 50c, 20 at 2s, 100 at 2s 60c
	local m = market({
		{ 3575, 100, 70, { { 100, 10 }, { 150, 10 }, { 300, 50 } }, true },
		{ 10558, 150, 125, { { 150, 5 }, { 200, 20 }, { 260, 100 } }, true },
	})
	local e = Engine.New(d, m, { craftMode = "known", known = known(3961, 12584, 3307), strategy = "buy" })
	local gyro = d.bySpell[3961]
	-- the vendor pays 4s: craft 1-5 makes 1s 50c, 6-10 1s, 11-20 50c, 21+ loses 1s
	local x = Queue.Plan(e, { { recipe = gyro, count = 10 } }, {})
	eq(x.revenue, 4000)
	eq(x.total, 10 * 100 + 5 * 150 + 5 * 200, "walks the listings")
	eq(x.extra, 250, "250c more than at the cheapest")
	eq(x.profit, 1250)
	local info = x.entries[3961]
	eq(info.best, 20, "the 21st loses money")
	eq(info.bestBy, "price")
	eq(info.marginal, 100, "the 10th: 4s - 1s - 2s")
	eq(x.caps[3575], 200, "a bar is worth up to 2s with cores at 2s")
	eq(x.caps[10558], 300)
	local rows = {}
	for _, b in ipairs(x.buy) do rows[b.item] = b end
	eq(rows[10558].top, 200, "the dearest core bought") eq(rows[10558].cap, 300)
	-- 25: past the best, the parts now cost too much
	x = Queue.Plan(e, { { recipe = gyro, count = 25 } }, {})
	eq(x.profit, 10000 - (1000 + 1500 + 1500) - (750 + 4000))
	eq(x.entries[3961].best, 20)
	eq(x.caps[10558], 100, "with bars at 3s, cores are worth only 1s")
	-- bars you have count at their price; the rest is bought
	x = Queue.Plan(e, { { recipe = gyro, count = 10 } }, { [3575] = 5 })
	eq(x.ownValue, 500) eq(x.total, 500 + 1750) eq(x.profit, 1250)
	-- more than the AH has
	x = Queue.Plan(e, { { recipe = gyro, count = 80 } }, {})
	eq(x.short, true)
	-- only the cheapest listing known (the normal scan): an estimate, flagged
	local m2 = market({ { 3575, 100, 500, {} }, { 10558, 150, 125, { { 150, 5 }, { 200, 20 }, { 260, 100 } }, true } })
	local e2 = Engine.New(d, m2, { craftMode = "known", known = known(3961), strategy = "buy" })
	x = Queue.Plan(e2, { { recipe = gyro, count = 10 } }, {})
	eq(x.est, true) eq(x.total, 1000 + 1750)
	eq(x.entries[3961].best, 125, "bars look flat at 1s, cores at 2s 60c still pay: until the cores run out")
	eq(x.entries[3961].bestBy, "supply")
	eq(x.entries[3961].bestEst, true)
	eq(Queue.AhCost(m2:Ah(3575), 3), 300)
end)

test("normal scan, listing checks and Auctionator: newest wins, unit counts", function()
	-- the normal (browse) scan knows only the cheapest price: 1 unit for sure, maybe more
	local scan = { t = 1000, kind = "summary", i = { { 3860, 300, 12, {} }, { 2592, 5, 30, {} } } }
	local m = Prices.Build(d, { scan = scan, depth = 3, useTsm = false })
	eq(m.ah[3860].partial, true, "partial")
	eq(m.ah[3860].price, 300, "price = cheapest when levels are unknown")
	local flips = Deals.VendorFlips(d, m)
	eq(flips[1].item, 3860) eq(flips[1].units, 1) eq(flips[1].more, true, "maybe more") eq(flips[1].checked, false)
	-- a listing check after it: every level
	local detail = { [3860] = { t = 1100, levels = { { 300, 2 }, { 350, 3 }, { 450, 7 } }, qty = 12, complete = true }, [2592] = { t = 1100, levels = {}, qty = 0, complete = true } }
	m = Prices.Build(d, { scan = scan, detail = detail, depth = 3, useTsm = false })
	eq(m.ah[3860].src, "listings") eq(m.ah[3860].price, 317, "average of the cheapest 3: (2 x 300 + 350) / 3")
	eq(m:Ah(2592), nil, "listed none: gone")
	flips = Deals.VendorFlips(d, m)
	eq(#flips, 1) eq(flips[1].units, 5) eq(flips[1].more, false) eq(flips[1].checked, true)
	eq(flips[1].profit, 100 * 2 + 50 * 3)
	-- an older check loses to a newer scan
	detail[3860].t = 900
	m = Prices.Build(d, { scan = scan, detail = detail, depth = 3, useTsm = false })
	eq(m.ah[3860].src, "scan")
	-- a scan row that kept a complete check's levels counts as checked
	scan.i[1] = { 3860, 300, 12, { { 300, 2 }, { 350, 3 }, { 450, 7 } }, true }
	m = Prices.Build(d, { scan = scan, depth = 3, useTsm = false })
	flips = Deals.VendorFlips(d, m)
	eq(flips[1].checked, true) eq(flips[1].units, 5)
end)

test("price history from Auctionator, plus today's scan; the median uses days without a low", function()
	local day0 = time({ year = 2020, month = 1, day = 1, hour = 0 })
	local today = math.floor((time() - day0) / 86400)
	local atr = {
		["2840"] = { m = 12, h = { [tostring(today - 2)] = 15, [tostring(today - 1)] = 14 }, l = { [tostring(today - 2)] = 11 }, a = { [tostring(today - 1)] = 300 } },
		["g:4383:30"] = { m = 9000, h = { [tostring(today - 1)] = 9000 }, l = {} },
	}
	local h = Prices.History(atr, 2840)
	eq(#h, 2) eq(h[1].low, 11) eq(h[1].high, 15) eq(h[2].low, 14, "no low saved: the low is the high") eq(h[2].qty, 300)
	eq(h[1].t, day0 + (today - 2) * 86400)
	h = Prices.History(atr, 2840, { min = 10, qty = 50, t = time(), src = "scan" })
	eq(#h, 3) eq(h[3].low, 10) eq(h[3].day, today)
	h = Prices.History(atr, 2840, { min = 13, qty = 50, t = day0 + (today - 1) * 86400 + 60, src = "scan" })
	eq(#h, 2) eq(h[2].low, 13, "merged into its day") eq(h[2].high, 14) eq(h[2].qty, 300)
	eq(#Prices.History(atr, 2840, { min = 1, t = time(), src = "tsm" }), 2, "TSM's price isn't a day's listing")
	eq(Prices.History(atr, 4383)[1].low, 9000, "gear: its item-level keys")
	eq(#Prices.History(nil, 2840), 0)
	eq(Prices.AtrMedian(atr, 2840, 14, 2), 13, "median of 11 and 14 (14 from the high), rounded")
end)

print(("logic tests: %d passed"):format(passed))
