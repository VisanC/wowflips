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
	eq(#d.recipes, 13, "recipes")
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

print(("logic tests: %d passed"):format(passed))
