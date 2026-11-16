-- Forever Flips MCP: the addon's own logic (Logic/*.lua, loaded from your installed addon) over
-- your saved data, outside the game. Runs in Lua 5.4 (wasmoon); index.js loads the files and
-- calls Flips.Call(name, json) for each tool. Money is in gold (2.5 = 2g 50s).

local ns = {}

-- what the addon's logic expects from the game
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
time, date = os.time, os.date
GetItemInfo = function() return nil end

function LoadAddonFile(src, name)
	local fn, err = load(src, "=" .. name)
	if not fn then error(err) end
	fn("FlipExport", ns)
end

function LoadSavedVariables(src, name, isBase64)
	if isBase64 then src = Base64Decode(src) end
	local fn, err = load(src, "=" .. name)
	if not fn then error(err) end
	fn()
end

---------------------------------------------------------------------------
-- Auctionator: its price database is saved as CBOR (C_EncodingUtil.SerializeCBOR)
---------------------------------------------------------------------------

local function cbor(s)
	local pos = 1
	local function arg(info)
		if info < 24 then return info end
		local size = ({ [24] = 1, [25] = 2, [26] = 4, [27] = 8 })[info]
		if not size then error("CBOR: indefinite length at " .. pos) end
		local v = string.unpack(">I" .. size, s, pos)
		pos = pos + size
		return v
	end
	local function half(h)
		local sign = (h >> 15) == 1 and -1 or 1
		local e, f = (h >> 10) & 31, h & 1023
		if e == 0 then return sign * f * 2.0 ^ -24 end
		if e == 31 then return f == 0 and sign * math.huge or 0 / 0 end
		return sign * (1 + f / 1024) * 2.0 ^ (e - 15)
	end
	local item
	function item()
		local b = s:byte(pos)
		pos = pos + 1
		local major, info = b >> 5, b & 31
		if major == 0 then return arg(info)
		elseif major == 1 then return -1 - arg(info)
		elseif major == 2 or major == 3 then
			local len = arg(info)
			local v = s:sub(pos, pos + len - 1)
			pos = pos + len
			return v
		elseif major == 4 then
			local t = {}
			for i = 1, arg(info) do t[i] = item() end
			return t
		elseif major == 5 then
			local t = {}
			for _ = 1, arg(info) do
				local k = item()
				t[k] = item()
			end
			return t
		elseif major == 6 then
			arg(info)
			return item()
		end
		if info == 20 then return false elseif info == 21 then return true elseif info == 22 or info == 23 then return nil end
		if info == 25 then local v = string.unpack(">I2", s, pos) pos = pos + 2 return half(v) end
		if info == 26 then local v = string.unpack(">f", s, pos) pos = pos + 4 return v end
		if info == 27 then local v = string.unpack(">d", s, pos) pos = pos + 8 return v end
		return arg(info)
	end
	return item()
end

local function auctionatorRealm(realmName)
	local db = AUCTIONATOR_PRICE_DATABASE
	if type(db) ~= "table" then return nil end
	local best, bestKey, bestSize
	for key, data in pairs(db) do
		if key ~= "__dbversion" then
			if type(data) == "string" then
				local ok, t = pcall(cbor, data)
				data = ok and t or nil
				db[key] = data
			end
			if type(data) == "table" then
				local n = 0
				for _ in pairs(data) do n = n + 1 end
				-- the realm you play on, else the biggest
				local mine = realmName and (key == realmName or realmName:find(key, 1, true))
				if mine then return data, key end
				if not best or n > bestSize then best, bestKey, bestSize = data, key, n end
			end
		end
	end
	return best, bestKey
end

---------------------------------------------------------------------------
-- TSM: the TSM app's AuctionDB data (TradeSkillMaster_AppHelper/AppData.lua), read the way TSM
-- reads it, for TSM_API.GetCustomPriceValue.
---------------------------------------------------------------------------

local tsm = { loads = {}, fields = {}, times = {} }
local REGION_TAGS = { AUCTIONDB_REGION_STAT = true, AUCTIONDB_REGION_HISTORICAL = true, AUCTIONDB_REGION_SALE = true }

local function tsmLoad(tag, where, data)
	if type(data) ~= "string" then return end
	local metaEnd, dataStart = data:find(",data={", 1, true)
	if not metaEnd then return end
	local metaFn = load(data:sub(1, metaEnd - 1) .. "}")
	local meta = metaFn and metaFn()
	if type(meta) ~= "table" or type(meta.fields) ~= "table" then return end
	local items = {}
	for itemString, other in data:sub(dataStart + 1, -3):gmatch('{"?([^,"]+)"?,([^}]+)}') do
		if tonumber(itemString) then itemString = "i:" .. itemString end
		items[itemString] = other
	end
	tsm.loads[#tsm.loads + 1] = { tag = tag, where = where, time = meta.downloadTime, fields = meta.fields, items = items }
end

function LoadTsmAppData(src)
	local fn, err = load(src, "=AppData.lua")
	if not fn then error(err) end
	fn(nil, { LoadData = tsmLoad })
end

--- Picks the realm data (your faction's when there are several) and indexes the fields.
local function tsmIndex(faction)
	local realms = {}
	for _, l in ipairs(tsm.loads) do
		if not REGION_TAGS[l.tag] and l.tag:find("NON_COMMODITY", 1, true) then realms[l.where] = true end
	end
	local realm
	for where in pairs(realms) do
		if not realm or (faction and where:find(faction, 1, true)) then realm = where end
	end
	for _, l in ipairs(tsm.loads) do
		local isRegion = REGION_TAGS[l.tag]
		local isCommodity = l.tag:find("^AUCTIONDB_COMMODITY") ~= nil
		if isRegion or isCommodity or l.where == realm then
			tsm.times[l.tag] = l.time
			for i = 2, #l.fields do
				local f = l.fields[i]
				tsm.fields[f] = tsm.fields[f] or {}
				table.insert(tsm.fields[f], { items = l.items, index = i - 1 })
			end
		end
	end
	tsm.realm = realm
end

local function tsmUnpack(raw)
	local out = {}
	for val in (raw .. ","):gmatch("([^,]*),") do
		local v
		if #val > 6 then
			v = tonumber(val:sub(-6), 32) + tonumber(val:sub(1, -7), 32) * 2 ^ 30
		else
			v = tonumber(val, 32) or 0
		end
		out[#out + 1] = v
	end
	return out
end

local function tsmValue(field, itemString)
	for _, src in ipairs(tsm.fields[field] or {}) do
		local raw = src.items[itemString]
		if raw then
			if type(raw) == "string" then
				raw = tsmUnpack(raw)
				src.items[itemString] = raw
			end
			local v = raw[src.index] or 0
			if v > 0 then return v end
		end
	end
	return nil
end

local TSM_SOURCES = {
	DBMarket = { "marketValue" }, DBMinBuyout = { "minBuyout" }, DBRecent = { "marketValueRecent" },
	DBHistorical = { "historical" }, DBNumAuctions = { "numAuctions" },
	DBRegionMarketAvg = { "regionMarketValue" }, DBRegionHistorical = { "regionHistorical" }, DBRegionSaleAvg = { "regionSale" },
	DBRegionSaleRate = { "regionSalePercent", 1000 }, DBRegionSoldPerDay = { "regionSoldPerDay", 1000 },
}

local function installTsmApi()
	if #tsm.loads == 0 then return end
	TSM_API = {
		GetCustomPriceValue = function(source, itemString)
			local s = TSM_SOURCES[source]
			if not s then return nil end
			local v = tsmValue(s[1], itemString)
			if not v then return nil end
			if s[2] then return v / s[2] end
			return math.floor(v + 0.5)
		end,
	}
end

---------------------------------------------------------------------------
-- State: like the in-game window's App.Compute
---------------------------------------------------------------------------

local Data, Prices, Engine, Leveling, Deals, Sales, Queue
local S

local function round(x, n)
	if x == nil or x ~= x or x == math.huge or x == -math.huge then return nil end
	local m = 10 ^ (n or 0)
	local v = math.floor(x * m + 0.5) / m
	if (n or 0) == 0 then return math.tointeger(v) or v end
	return v
end
local function gold(c) return c and round(c / 10000, 4) or nil end
local function pct(x) return x and round(x * 100, 1) or nil end

local function pickChar(DB, wanted)
	local best, bestKey, bestT
	for key, c in pairs(DB.chars or {}) do
		if wanted and key:lower():find(wanted:lower(), 1, true) then return c, key end
		local t = 0
		for _, part in ipairs({ c.info, c.bags, c.bank }) do if type(part) == "table" and (part.t or 0) > t then t = part.t end end
		for _, p in pairs(c.profs or {}) do if (p.t or 0) > t then t = p.t end end
		if not bestT or t > bestT then best, bestKey, bestT = c, key, t end
	end
	return best, bestKey
end

function BuildState(optsJson)
	Data, Prices, Engine, Leveling, Deals, Sales, Queue = ns.Data, ns.Prices, ns.Engine, ns.Leveling, ns.Deals, ns.Sales, ns.Queue
	local DB = FlipExportDB or {}
	local ui = DB.ui or {}
	local char, charKey = pickChar(DB, CHARACTER)
	if not char then error("No character in the Forever Flips saved data yet: log in with the addon on, then /reload.") end
	local d = Data.Build(ns.GameData)
	Data.ApplyLearnData(d, char, ns.RecipeMasterData)
	local realmName = charKey:match("%-(.+)$")
	local faction = char.info and char.info.f
	tsmIndex(faction)
	installTsmApi()
	Prices.ResetCache()
	local atr, atrRealm = auctionatorRealm(realmName)
	local tsmTime = tsm.times.AUCTIONDB_NON_COMMODITY_DATA
	local market = Prices.Build(d, {
		scan = DB.ah, detail = DB.detail, atr = atr, atrSeen = DB.atrSeen, depth = ui.priceDepth or 3,
		learnedVendor = DB.vendor, useTsm = ui.useTsm ~= false, tsmTime = tsmTime,
	})
	local profs = Data.Professions(d, char)
	local profSkills = {}
	for _, p in pairs(profs) do profSkills[p.skill] = true end
	local known = Data.KnownSpells(char)
	local bags, inv = {}, {}
	for _, e in ipairs((char.bags and char.bags.i) or {}) do bags[e[1]] = (bags[e[1]] or 0) + (e[2] or 0) end
	for k, v in pairs(bags) do inv[k] = v end
	for _, e in ipairs((char.bank and char.bank.i) or {}) do inv[e[1]] = (inv[e[1]] or 0) + (e[2] or 0) end
	local itemByName = {}
	for id, it in pairs(d.items) do
		local name = Data.ItemName(d, id)
		if name then itemByName[name:lower()] = itemByName[name:lower()] or id end
	end
	S = {
		DB = DB, ui = ui, d = d, char = char, charKey = charKey, profs = profs, profSkills = profSkills, known = known,
		market = market, atr = atr, atrRealm = atrRealm, tsmTime = tsmTime, bags = bags, inventory = inv,
		faction = faction, specs = Leveling.KnownSpecs(d, known), itemByName = itemByName, cut = ui.cut or 0.05,
	}
	return "ok"
end

local function engine(craftMode, strategy)
	return Engine.New(S.d, S.market, { cut = S.cut, craftMode = craftMode or "known", known = S.known, profSkills = S.profSkills, strategy = strategy or "best" })
end

local function profName(skill) return S.d.skills[skill] or ("skill " .. tostring(skill)) end
local function itemName(id) return Data.ItemName(S.d, id) or ("item " .. tostring(id)) end

--- An item by id or name: exact name, else the only name containing it. id, or nil and candidates.
local function findItem(q)
	if type(q) == "number" or tostring(q):match("^%d+$") then return tonumber(q) end
	local s = tostring(q or ""):lower()
	if S.itemByName[s] then return S.itemByName[s] end
	local hits = {}
	for name, id in pairs(S.itemByName) do if name:find(s, 1, true) then hits[#hits + 1] = { id = id, name = itemName(id) } end end
	table.sort(hits, function(a, b) return #a.name < #b.name end)
	if #hits == 1 then return hits[1].id end
	return nil, hits
end

--- A recipe by spell id, recipe name or the item it makes. recipe, or nil and candidates.
local function findRecipe(q)
	local n = tonumber(q)
	if n and S.d.bySpell[n] then return S.d.bySpell[n] end
	local s = tostring(q or ""):lower()
	local hits, exact = {}, nil
	for _, r in ipairs(S.d.recipes) do
		local rn, on = (r.name or ""):lower(), itemName(r.out):lower()
		if rn == s or on == s then
			if not exact or (S.known[r.spell] and not S.known[exact.spell]) then exact = r end
		elseif rn:find(s, 1, true) or on:find(s, 1, true) then
			hits[#hits + 1] = r
		end
	end
	if exact then return exact end
	if #hits == 1 then return hits[1] end
	local out = {}
	for i = 1, math.min(15, #hits) do out[#out + 1] = { spell = hits[i].spell, name = hits[i].name, profession = profName(hits[i].skill) } end
	return nil, out
end

local function ahInfo(id)
	local ah = S.market:Ah(id)
	if not ah then return nil end
	local levels = {}
	for i = 1, math.min(5, #(ah.levels or {})) do levels[i] = { price_g = gold(ah.levels[i][1]), count = ah.levels[i][2] } end
	return {
		price_g = gold(ah.price), cheapest_g = gold(ah.min), listed = ah.qty, source = ah.src, seen = ah.t,
		cheapest_listings = (not ah.partial) and levels or nil, only_cheapest_known = ah.partial or nil, every_listing_counted = ah.complete or nil,
	}
end

local function learnInfo(r)
	if S.known[r.spell] then return nil end
	local lc = Leveling.LearnCost(r, S.market)
	return {
		level = Data.LearnLevel(r), level_known = Data.LearnKnown(r), how = lc.how, cost_g = gold(lc.cost), note = lc.text,
		can_learn = Leveling.CanLearn(r, S.faction, S.specs),
	}
end

local function rankOf(skill)
	for _, p in pairs(S.profs) do if p.skill == skill then return p.rank, p.max end end
end

---------------------------------------------------------------------------
-- Tools
---------------------------------------------------------------------------

local T = {}

function T.status()
	local DB, c = S.DB, S.char
	local profs = {}
	for name, p in pairs(S.profs) do profs[#profs + 1] = { name = name, rank = p.rank, max = p.max } end
	table.sort(profs, function(a, b) return a.name < b.name end)
	local chars = {}
	for key in pairs(DB.chars or {}) do chars[#chars + 1] = key end
	local atrCount, atrNewest = 0, 0
	for _ in pairs(S.atr or {}) do atrCount = atrCount + 1 end
	for _, t in pairs(DB.atrSeen or {}) do if t > atrNewest then atrNewest = t end end
	local queued = 0
	for _, n in pairs(c.queue or {}) do queued = queued + n end
	local tsmTimes = {}
	for tag, t in pairs(tsm.times) do tsmTimes[tag] = t end
	return {
		now = os.time(), character = S.charKey, characters = chars, level = c.info and c.info.l, money_g = c.info and gold(c.info.g),
		faction = S.faction, professions = profs, known_recipes = (function() local n = 0 for _ in pairs(S.known) do n = n + 1 end return n end)(),
		bags_saved_at = c.bags and c.bags.t, bank_saved_at = c.bank and c.bank.t,
		ah_scan = DB.ah and { at = DB.ah.t, kind = DB.ah.kind or "full", items = #(DB.ah.i or {}) } or nil,
		listing_checks = (function() local n = 0 for _ in pairs(DB.detail or {}) do n = n + 1 end return n end)(),
		auctionator = S.atr and { realm = S.atrRealm, items = atrCount, newest_price_at = atrNewest > 0 and atrNewest or nil, newer_than_scan = S.market.atrCount } or nil,
		tsm = next(tsmTimes) and { realm = tsm.realm, downloaded = tsmTimes } or nil,
		recipe_master = ns.RecipeMasterData and ns.RecipeMasterData.version or nil,
		queued_crafts = queued,
		price_depth = S.ui.priceDepth or 3, ah_cut_pct = pct(S.cut),
	}
end

local function craftRow(e, r)
	local sales = Prices.Sales(r.out)
	local rank = rankOf(r.skill)
	return {
		spell = r.spell, name = r.name, makes = itemName(r.out), makes_count = r.qty, profession = profName(r.skill),
		known = S.known[r.spell] or false, color = rank and Leveling.Color(r, rank) or nil,
		cost_g = e.complete and gold(e.cost) or nil, sells_g = gold(e.revenue), sell_to = e.channel,
		profit_g = e.complete and gold(e.profit) or nil, margin_pct = e.complete and pct(e.margin) or nil,
		price_each_g = gold(e.ahUnit), on_ah = e.ahQty, price_source = e.ahSrc,
		region_sold_per_day = sales and round(sales.soldPerDay, 2) or nil, region_sale_rate_pct = sales and sales.saleRate and pct(sales.saleRate) or nil,
		region_avg_sale_g = sales and gold(sales.avgSale) or nil,
		can_make_now = e.craftableNow, learn = learnInfo(r), missing_prices = (not e.complete) or nil,
	}
end

function T.best_crafts(o)
	local mode, strategy = o.parts or "known", o.strategy or "best"
	local eng = engine(mode, strategy)
	local scope, prof = o.scope or "known", o.profession
	if prof and (prof == "" or prof:lower() == "mine" or prof:lower() == "all") then prof = nil end
	local rows = {}
	for _, r in ipairs(S.d.recipes) do
		local ok = S.d.items[r.out] ~= nil
		if ok and prof then ok = profName(r.skill):lower() == prof:lower() end
		if ok and scope == "known" then ok = S.known[r.spell] or false end
		if ok and scope == "profession" then ok = S.profSkills[r.skill] or false end
		if ok and scope == "learnable" then
			local rank = rankOf(r.skill)
			ok = S.profSkills[r.skill] and rank and Data.LearnLevel(r) <= rank and Leveling.CanLearn(r, S.faction, S.specs) or false
		end
		if ok then
			local e = eng:Evaluate(r, S.inventory)
			if e.complete and (o.include_unprofitable or e.profit > 0) then
				local row = craftRow(e, r)
				local sold = row.region_sold_per_day or 0
				if sold >= (o.min_sold_per_day or 0) then rows[#rows + 1] = row end
			end
		end
	end
	local key = o.sort or "profit"
	local function val(r)
		if key == "margin" then return r.margin_pct or -math.huge end
		if key == "sold_per_day" then return r.region_sold_per_day or 0 end
		if key == "profit_x_sold" then return (r.profit_g or 0) * math.min(r.region_sold_per_day or 0, 20) end
		return r.profit_g or -math.huge
	end
	table.sort(rows, function(a, b) return val(a) > val(b) end)
	local out = {}
	for i = 1, math.min(o.limit or 25, #rows) do out[i] = rows[i] end
	return { count = #rows, shown = #out, scope = scope, parts = mode, strategy = strategy, crafts = out }
end

local REASON = {
	cheaper = "cheaper", ["tie-craft"] = "same price: crafted from the raw material", ["tie-buy"] = "same price",
	["no-price"] = "no price known", ["no-recipe"] = "no recipe you can use", ["not-sold"] = "not on the AH", plan = "your choice",
}

local function partRows(eng, parts, depth, mult, out)
	for _, part in ipairs(parts) do
		local ex = eng:Explain(part.item, part.source)
		local count = part.count * mult
		local src = part.source
		out[#out + 1] = {
			depth = depth, item = itemName(part.item), count = round(count, 2), how = src.kind == "craft" and ("craft: " .. src.recipe.name) or src.kind,
			unit_g = gold(src.unit), total_g = gold((src.unit or 0) * count), why = REASON[ex.reason] or ex.reason,
			buy_instead_g = src.kind == "craft" and ex.buy and ex.buy.unit ~= math.huge and gold(ex.buy.unit) or nil,
			craft_instead_g = src.kind ~= "craft" and ex.craft and gold(ex.craft.unit) or nil,
		}
		if src.kind == "craft" then partRows(eng, src.parts, depth + 1, count / src.recipe.qty, out) end
	end
	return out
end

local function expanded(eng, entries)
	local x = Queue.Expand(eng, entries, S.inventory)
	local steps, buy = {}, {}
	for _, c in ipairs(x.crafts) do
		steps[#steps + 1] = {
			recipe = c.recipe.name, spell = c.recipe.spell, profession = profName(c.recipe.skill), crafts = c.count,
			makes = itemName(c.recipe.out), can_make_now_from_bags = math.min(c.count, Queue.CraftableFrom(c.recipe, S.bags)),
		}
	end
	for _, b in ipairs(x.buy) do
		buy[#buy + 1] = { item = itemName(b.item), id = b.item, need = b.need, have = b.have, buy = b.qty, where = b.kind, cost_g = gold(b.cost) }
	end
	return { steps = steps, shopping = buy, shopping_total_g = gold(x.total), items_without_price = x.missing > 0 and x.missing or nil }
end

function T.craft_plan(o)
	local r, cands = findRecipe(o.recipe)
	if not r then return { error = "recipe not found or ambiguous", candidates = cands } end
	local count = math.max(1, math.floor(o.count or 1))
	local eng = engine(o.parts or "known", o.strategy or "best")
	local e = eng:Evaluate(r, S.inventory)
	local sales = Prices.Sales(r.out)
	local made = count * r.qty
	local plan = expanded(eng, { { recipe = r, count = count } })
	return {
		recipe = craftRow(e, r),
		per_craft = { cost_g = gold(e.cost), sells_g = gold(e.revenue), profit_g = gold(e.profit), all_prices_known = e.complete },
		count = count, makes_total = made,
		total = { cost_g = gold(e.cost * count), revenue_g = gold(e.revenue * count), profit_g = gold(e.profit * count) },
		days_to_sell_at_region_rate = sales and sales.soldPerDay and sales.soldPerDay > 0 and round(made / sales.soldPerDay, 1) or nil,
		output_on_ah = ahInfo(r.out),
		parts = partRows(eng, e.parts, 0, count, {}),
		with_your_bags_and_bank = plan,
	}
end

function T.item(o)
	local id, cands = findItem(o.item)
	if not id then return { error = "item not found or ambiguous", candidates = cands } end
	local d = S.d
	local it = d.items[id] or {}
	local sales = Prices.Sales(id)
	local made, used = {}, {}
	for _, r in ipairs(d.byOutput[id] or {}) do made[#made + 1] = { recipe = r.name, spell = r.spell, profession = profName(r.skill), known = S.known[r.spell] or false } end
	for _, r in ipairs(d.recipes) do
		for _, rg in ipairs(r.reagents) do
			if rg[1] == id and #used < 15 then used[#used + 1] = { recipe = r.name, needs = rg[2], known = S.known[r.spell] or false } end
		end
	end
	return {
		id = id, name = itemName(id), ah = ahInfo(id),
		auctionator_14_day_median_g = gold(Prices.AtrMedian(S.atr, id, 14, 3)),
		tsm = sales and {
			market_g = gold(sales.market), historical_g = gold(sales.historical), region_avg_sale_g = gold(sales.avgSale),
			region_sold_per_day = round(sales.soldPerDay, 2), region_sale_rate_pct = sales.saleRate and pct(sales.saleRate) or nil,
		} or nil,
		vendor_buys_for_g = gold(Data.ItemSell(d, id)), vendor_sells_for_g = gold(S.market.vendor[id]),
		you_have = { bags = S.bags[id] or 0, bags_and_bank = S.inventory[id] or 0 },
		made_by = made, used_in = used,
	}
end

function T.deals(o)
	local rows, out = {}, {}
	if (o.mode or "vendor") == "vendor" then
		rows = Deals.VendorFlips(S.d, S.market)
	else
		rows = Deals.UnderMarket(S.d, S.market, { maxPct = o.max_pct and o.max_pct / 100 or 0.7, minProfit = (o.min_profit_g or 0) * 10000, minSold = 1, cut = S.cut, atr = S.atr })
	end
	for _, r in ipairs(rows) do
		if r.profit >= (o.min_profit_g or 0) * 10000 and #out < (o.limit or 25) then
			out[#out + 1] = {
				item = itemName(r.item), id = r.item, cheapest_g = gold(r.price), vendor_pays_g = gold(r.vendor), usual_g = gold(r.reference),
				pct_of_usual = r.pct and pct(r.pct) or nil, units = r.units, maybe_more = r.more or nil, every_listing_counted = r.checked or nil,
				profit_g = gold(r.profit), region_sold_per_day = r.soldPerDay and round(r.soldPerDay, 2) or nil, price_source = r.src,
			}
		end
	end
	return { mode = o.mode or "vendor", count = #rows, deals = out }
end

function T.leveling(o)
	local prof, pr = o.profession, nil
	for name, p in pairs(S.profs) do if prof and name:lower() == prof:lower() then pr, prof = p, name end end
	if not pr then return { error = "profession not found; yours: see status" } end
	local target = o.target or math.min(300, math.max(pr.max, pr.rank + 1))
	local pool = o.pool or "trainer"
	local eng = engine("known", "best")
	local function inPool(r)
		if S.known[r.spell] then return true end
		if pool == "known" or not Leveling.CanLearn(r, S.faction, S.specs) then return false end
		if Leveling.IsTrainerRecipe(r) then return true end
		return pool == "all" and Leveling.LearnCost(r, S.market).cost ~= nil
	end
	local recipes = {}
	for _, r in ipairs(S.d.recipes) do
		if r.skill == pr.skill and S.d.items[r.out] and inPool(r) then recipes[#recipes + 1] = r end
	end
	local function net(r)
		local e = eng:Evaluate(r)
		if not e.complete then return nil end
		return e.cost - e.revenue
	end
	local function learn(r)
		if S.known[r.spell] then return 0 end
		return Leveling.LearnCost(r, S.market).cost or 0
	end
	local plan = Leveling.Plan(recipes, pr.rank, target, net, learn)
	local steps = {}
	for _, st in ipairs(plan.steps) do
		steps[#steps + 1] = {
			recipe = st.recipe.name, spell = st.recipe.spell, from = st.from, to = st.to, color_at_start = st.color, crafts = round(st.crafts, 1),
			cost_each_g = gold(st.netEach), total_g = gold(st.total), learn = learnInfo(st.recipe), learn_cost_g = st.learnCost and st.learnCost > 0 and gold(st.learnCost) or nil,
		}
	end
	return {
		profession = prof, from = pr.rank, to = target, cap = pr.max, pool = pool,
		total_g = gold(plan.total), note = "total_g > 0 costs that much; < 0 makes money", crafts = round(plan.crafts, 0),
		stuck_at = plan.stuckAt, steps = steps,
	}
end

function T.queue()
	local entries = {}
	for spell, n in pairs(S.char.queue or {}) do
		local r = S.d.bySpell[spell]
		if r and n > 0 then entries[#entries + 1] = { recipe = r, count = n } end
	end
	if #entries == 0 then return { queued = {}, note = "the in-game queue is empty" } end
	local ui = S.ui.crafts or {}
	local eng = engine(ui.craftMode, ui.strategy)
	local queued = {}
	for _, e in ipairs(entries) do queued[#queued + 1] = { recipe = e.recipe.name, count = e.count } end
	local x = expanded(eng, entries)
	x.queued = queued
	return x
end

function T.sales(o)
	local sum = Sales.Summarize(S.d, S.char.ledger, { nameToId = function(name) return name and S.itemByName[name:lower()] or 0 end })
	local items = {}
	for _, e in ipairs(sum.items) do
		if e.soldUnits > 0 or e.boughtUnits > 0 then
			items[#items + 1] = {
				item = e.name, sold = e.soldUnits, net_g = gold(e.net), bought = e.boughtUnits, spent_g = gold(e.spent),
				expired = e.expired, cancelled = e.cancelled, crafted = e.crafted, last_sale = e.lastSale,
			}
		end
	end
	table.sort(items, function(a, b) return (a.net_g or 0) > (b.net_g or 0) end)
	local top = {}
	for i = 1, math.min(o.limit or 25, #items) do top[i] = items[i] end
	return {
		income_7_days_g = gold(sum.income7), income_30_days_g = gold(sum.income30), spent_30_days_g = gold(sum.spend30),
		sell_through_30_days_pct = sum.sellThrough30 and pct(sum.sellThrough30) or nil, ah_mails = sum.mails, items = top,
	}
end

--- Tool arguments arrive as JSON (objects, arrays, strings, numbers, booleans).
local function jsonDecode(s)
	local pos = 1
	local function ws() pos = s:find("[^ \t\r\n]", pos) or #s + 1 end
	local value
	local function str()
		local out = {}
		pos = pos + 1
		while true do
			local c = s:sub(pos, pos)
			if c == '"' then pos = pos + 1 break end
			if c == "\\" then
				local e = s:sub(pos + 1, pos + 1)
				local map = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
				if e == "u" then
					out[#out + 1] = utf8.char(tonumber(s:sub(pos + 2, pos + 5), 16))
					pos = pos + 6
				else
					out[#out + 1] = map[e] or e
					pos = pos + 2
				end
			elseif c == "" then error("JSON: unterminated string")
			else
				out[#out + 1] = c
				pos = pos + 1
			end
		end
		return table.concat(out)
	end
	function value()
		ws()
		local c = s:sub(pos, pos)
		if c == "{" then
			local t = {}
			pos = pos + 1
			ws()
			if s:sub(pos, pos) == "}" then pos = pos + 1 return t end
			while true do
				ws()
				local k = str()
				ws()
				pos = pos + 1 -- :
				t[k] = value()
				ws()
				local d = s:sub(pos, pos)
				pos = pos + 1
				if d == "}" then return t end
			end
		elseif c == "[" then
			local t = {}
			pos = pos + 1
			ws()
			if s:sub(pos, pos) == "]" then pos = pos + 1 return t end
			while true do
				t[#t + 1] = value()
				ws()
				local d = s:sub(pos, pos)
				pos = pos + 1
				if d == "]" then return t end
			end
		elseif c == '"' then return str()
		elseif s:sub(pos, pos + 3) == "true" then pos = pos + 4 return true
		elseif s:sub(pos, pos + 4) == "false" then pos = pos + 5 return false
		elseif s:sub(pos, pos + 3) == "null" then pos = pos + 4 return nil
		end
		local num = s:match("^-?[%d%.eE+-]+", pos)
		if not num then error("JSON: unexpected " .. c .. " at " .. pos) end
		pos = pos + #num
		return math.tointeger(tonumber(num)) or tonumber(num)
	end
	return value()
end

--- Bytes that aren't valid UTF-8 (Auctionator's saved database) arrive as base64.
local B64 = {}
for i = 1, 64 do B64[("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"):byte(i)] = i - 1 end
function Base64Decode(s)
	local out, n = {}, 0
	for i = 1, #s - 3, 4 do
		local a, b, c, d = s:byte(i, i + 3)
		local v = (B64[a] << 18) | (B64[b] << 12) | ((B64[c] or 0) << 6) | (B64[d] or 0)
		n = n + 1
		if d == 61 then
			out[n] = c == 61 and string.char(v >> 16) or string.char(v >> 16, (v >> 8) & 255)
		else
			out[n] = string.char(v >> 16, (v >> 8) & 255, v & 255)
		end
	end
	return table.concat(out)
end

--- index.js: FlipsCall(tool, argsJson) -> JSON text.
function FlipsCall(name, argsJson)
	local fn = T[name]
	if not fn then error("unknown tool " .. tostring(name)) end
	local args = (argsJson and argsJson ~= "") and jsonDecode(argsJson) or {}
	local ok, result = xpcall(function() return fn(args) end, debug.traceback)
	if not ok then error(result) end
	return ns.Core.ToJSON(result)
end

FLIPS_NS = ns
