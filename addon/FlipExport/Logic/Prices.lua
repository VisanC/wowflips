-- FlipExport / Logic/Prices.lua
-- What's on the AH now, per item, newest source first:
--   1. the addon's own full scan (/flip scan): cheapest price levels, price = average of the
--      cheapest few units so one bait listing can't set it;
--   2. Auctionator's price database (its scans and every search you make), when it saw the
--      item on a later day than the scan;
--   3. TradeSkillMaster, through its addon API, for items neither has (when TSM is installed).
-- TSM also gives market value, 60-day price and region sales (sold per day, sale rate).

local _, ns = ...
local Prices = {}
ns.Prices = Prices

--- Average unit price of the cheapest `depth` units, from the known price levels.
function Prices.AhPrice(min, levels, depth)
	if (depth or 1) <= 1 or not levels or #levels == 0 then return min end
	local units, total = 0, 0
	for _, lv in ipairs(levels) do
		local take = math.min(lv[2], depth - units)
		if take > 0 then
			total = total + take * lv[1]
			units = units + take
			if units >= depth then break end
		end
	end
	return units > 0 and math.floor(total / units + 0.5) or min
end

---------------------------------------------------------------------------
-- TradeSkillMaster (optional): TSM_API.GetCustomPriceValue(source, "i:<id>")
---------------------------------------------------------------------------

local tsmCache = {}

function Prices.TsmAvailable()
	return type(TSM_API) == "table" and type(TSM_API.GetCustomPriceValue) == "function"
end

--- A TSM price or value source for an item (DBMarket, DBRegionSoldPerDay…), or nil.
function Prices.TSM(source, id)
	if not Prices.TsmAvailable() then return nil end
	local key = source .. ":" .. id
	local v = tsmCache[key]
	if v == nil then
		local ok, r = pcall(TSM_API.GetCustomPriceValue, source, "i:" .. id)
		v = (ok and type(r) == "number") and r or false
		tsmCache[key] = v
	end
	return v or nil
end

function Prices.ResetCache() wipe(tsmCache) end

--- Region sales from TSM: sold per day, sale rate (0-1), average sale price, market value, 60-day price.
function Prices.Sales(id)
	if not Prices.TsmAvailable() then return nil end
	local sold = Prices.TSM("DBRegionSoldPerDay", id)
	local rate = Prices.TSM("DBRegionSaleRate", id)
	local avg = Prices.TSM("DBRegionSaleAvg", id)
	local market = Prices.TSM("DBMarket", id) or Prices.TSM("DBRegionMarketAvg", id)
	local hist = Prices.TSM("DBHistorical", id) or Prices.TSM("DBRegionHistorical", id)
	if not (sold or rate or avg or market) then return nil end
	return { soldPerDay = sold, saleRate = rate, avgSale = avg, market = market, historical = hist }
end

---------------------------------------------------------------------------
-- Auctionator: per item its last price (m) and daily highs/lows/quantities (h, l, a by day).
---------------------------------------------------------------------------

local function day0() return time({ year = 2020, month = 1, day = 1, hour = 0 }) end

--- Last day Auctionator saw the item, as {day number, key}.
local function lastDay(e)
	local last, lastKey = -1, nil
	if type(e.h) == "table" then
		for k in pairs(e.h) do
			local d = tonumber(k)
			if d and d > last then last, lastKey = d, k end
		end
	end
	return last, lastKey
end

--- Median of Auctionator's daily low prices over the last `days` days (needs `need` days), or nil.
function Prices.AtrMedian(atr, id, days, need)
	local e = atr and atr[tostring(id)]
	if type(e) ~= "table" or type(e.l) ~= "table" then return nil end
	local today = math.floor((time() - day0()) / 86400)
	local list = {}
	for k, v in pairs(e.l) do
		local d = tonumber(k)
		if d and d > today - days and type(v) == "number" and v > 0 then list[#list + 1] = v end
	end
	if #list < (need or 5) then return nil end
	table.sort(list)
	local n = #list
	return n % 2 == 1 and list[(n + 1) / 2] or math.floor((list[n / 2] + list[n / 2 + 1]) / 2 + 0.5)
end

---------------------------------------------------------------------------
-- The market
---------------------------------------------------------------------------

local Market = {}
Market.__index = Market

--- AH row for an item: { min, qty, levels, price, src = "scan"|"auctionator"|"tsm", t }, or nil.
function Market:Ah(id)
	local row = self.ah[id]
	if row then return row end
	if self.useTsm then
		local cached = self.tsmRows[id]
		if cached == nil then
			local recent = Prices.TSM("DBRecent", id)
			local min = Prices.TSM("DBMinBuyout", id)
			local price = (recent and recent > 0) and recent or min
			cached = (price and price > 0) and { min = min or price, qty = 0, levels = {}, price = price, src = "tsm" } or false
			self.tsmRows[id] = cached
		end
		return cached or nil
	end
	return nil
end

--- @param d     game data (Data.Build)
--- @param opts  { scan = DB.ah, atr = Auctionator's price table, depth = 3, learnedVendor = DB.vendor, useTsm = true }
function Prices.Build(d, opts)
	opts = opts or {}
	local depth = opts.depth or 3
	local m = setmetatable({ ah = {}, vendor = {}, tsmRows = {}, useTsm = opts.useTsm ~= false and Prices.TsmAvailable(), scanTime = 0, depth = depth }, Market)
	local scan = opts.scan
	if type(scan) == "table" and type(scan.i) == "table" then
		m.scanTime = scan.t or 0
		for _, r in ipairs(scan.i) do
			local id, min, qty, levels = r[1], r[2], r[3], r[4] or {}
			if id and min and min > 0 then
				if #levels == 0 then levels = { { min, qty or 0 } } end
				m.ah[id] = { min = min, qty = qty or 0, levels = levels, price = Prices.AhPrice(min, levels, depth), src = "scan", t = m.scanTime }
			end
		end
	end
	local atr = opts.atr
	if type(atr) == "table" then
		local base = day0()
		local scanDay = m.scanTime > 0 and math.floor((m.scanTime - base) / 86400) or -1
		m.atrCount = 0
		for key, e in pairs(atr) do
			local id = type(key) == "string" and key:match("^%d+$") and tonumber(key)
			if id and type(e) == "table" and type(e.m) == "number" and e.m > 0 then
				local last, lastKey = lastDay(e)
				local have = m.ah[id]
				if not have or last > scanDay then
					local qty = (lastKey and type(e.a) == "table" and e.a[lastKey]) or (have and have.qty) or 0
					m.ah[id] = { min = e.m, qty = qty, levels = { { e.m, qty } }, price = e.m, src = "auctionator", t = base + math.max(0, last) * 86400 }
					m.atrCount = m.atrCount + 1
				end
			end
		end
	end
	for _, id in ipairs(d.vendorReagents or {}) do
		local it = d.items[id]
		if it and (it.buy or 0) > 0 then m.vendor[id] = it.buy / math.max(1, it.vstack or 1) end
	end
	for id, v in pairs(opts.learnedVendor or {}) do
		if type(v) == "table" and type(v.p) == "number" then m.vendor[id] = v.p end
	end
	return m
end
