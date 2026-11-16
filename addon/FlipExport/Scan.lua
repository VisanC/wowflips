-- FlipExport / Scan.lua
-- Auction House scans without the full-scan limit (one ReplicateItems per 15 minutes):
--  - Summary: an empty browse query, paged until the AH has sent every item, like Auctionator's
--    summary scan: each item's lowest price and how many are for sale.
--  - Listings: a search per item, its listings sorted by price, for the price levels (how many
--    at each price). Deals use it to count how many are really at the good price.
-- Each request waits until the AH accepts the next one (its throttle).

local _, ns = ...
local Scan = { busy = nil, progress = "", keys = {} }
ns.Scan = Scan

local MAX_LISTINGS = 200 -- listing rows per item: plenty to count the cheap ones
local frame = CreateFrame("Frame")
local requests, waiting = {}, false

local function ahReady()
	return not (C_AuctionHouse and C_AuctionHouse.IsThrottledMessageSystemReady) or C_AuctionHouse.IsThrottledMessageSystemReady()
end

local pump
function pump()
	if #requests == 0 then return end
	if not ahReady() then
		-- AUCTION_HOUSE_THROTTLED_SYSTEM_READY pumps too; this is in case it never comes
		if not waiting then
			waiting = true
			C_Timer.After(0.3, function() waiting = false pump() end)
		end
		return
	end
	local fn = table.remove(requests, 1)
	local ok, err = pcall(fn)
	if not ok then ns.Say("|cffff4040AH request failed:|r %s", tostring(err)) end
end

local function enqueue(fn)
	requests[#requests + 1] = fn
	pump()
end

local function progress(text)
	Scan.progress = text or ""
	if ns.App and ns.App.UpdateStatus then pcall(ns.App.UpdateStatus) end
end

local function changed() if ns.App then ns.App.DataChanged() end end

---------------------------------------------------------------------------
-- Summary scan
---------------------------------------------------------------------------

local summary -- { seen, started, lastProgress, items }
local STALL = 15 -- seconds without an answer: keep what came

local function readBrowse()
	local acc, count = {}, 0
	for _, r in ipairs(C_AuctionHouse.GetBrowseResults() or {}) do
		local key = r.itemKey
		local id = key and key.itemID
		if id and (r.totalQuantity or 0) > 0 and (r.minPrice or 0) > 0 then
			local e = acc[id]
			if not e then
				acc[id] = { r.minPrice, r.totalQuantity }
				count = count + 1
				Scan.keys[id] = key
			else
				e[1] = math.min(e[1], r.minPrice)
				e[2] = e[2] + r.totalQuantity
			end
		end
	end
	return acc, count
end

local function finishSummary(partial)
	local acc, count = readBrowse()
	local DB = ns.GetDB()
	-- the full scan's price levels stay right while an item's cheapest price and amount don't change
	-- (same for a listing check's)
	local before = {}
	for _, r in ipairs((DB.ah and DB.ah.i) or {}) do before[r[1]] = r end
	local rows, total = {}, 0
	for id, e in pairs(acc) do
		local old, det = before[id], DB.detail and DB.detail[id]
		local levels, complete
		if det and det.levels and det.levels[1] and det.levels[1][1] == e[1] and det.qty == e[2] then
			levels, complete = det.levels, det.complete
		elseif old and old[2] == e[1] and old[3] == e[2] and old[4] then
			levels, complete = old[4], old[5]
		end
		rows[#rows + 1] = { id, e[1], e[2], levels or {}, complete or nil }
		total = total + e[2]
	end
	table.sort(rows, function(a, b) return a[1] < b[1] end)
	if count > 0 then
		DB.ah = { t = ns.Now(), n = total, i = rows, kind = "summary" }
		ns.Say("scanned the AH%s: %d items, %d for sale (%.0f s).", partial and " (it stopped answering, so not all of it)" or "", count, total, GetTime() - summary.started)
	else
		ns.Say("the AH sent nothing back; try again in a moment.")
	end
	summary = nil
	Scan.busy = nil
	progress("")
	changed()
	if count > 0 and Scan.onSummaryDone then pcall(Scan.onSummaryDone) end
end

local function watchdog(mine)
	C_Timer.After(5, function()
		if summary ~= mine then return end
		if GetTime() - mine.lastProgress > STALL then finishSummary(true) else watchdog(mine) end
	end)
end

local function onBrowse()
	if not summary then return end
	local n = #(C_AuctionHouse.GetBrowseResults() or {})
	local full = C_AuctionHouse.HasFullBrowseResults()
	-- UPDATED and ADDED can both come for one page: only ask for the next page once
	if n <= summary.seen and not full then return end
	summary.seen = n
	summary.lastProgress = GetTime()
	if full then
		finishSummary(false)
	else
		progress(("scanning the AH: %d results"):format(n))
		enqueue(function() C_AuctionHouse.RequestMoreBrowseResults() end)
	end
end

--- Scans every item's lowest price and quantity. The AH must be open.
function Scan.Summary()
	if Scan.busy then return ns.Say("busy: %s. Click again to stop.", Scan.progress ~= "" and Scan.progress or Scan.busy) end
	if not ns.IsAuctionHouseOpen() then return ns.Say("open the Auction House first.") end
	if not (C_AuctionHouse and C_AuctionHouse.SendBrowseQuery) then return ns.Say("this client has no browse API; use /flip fullscan.") end
	Scan.busy = "summary"
	summary = { seen = 0, started = GetTime(), lastProgress = GetTime() }
	progress("scanning the AH")
	ns.Say("scanning the AH (keep it open; about a minute)...")
	enqueue(function() C_AuctionHouse.SendBrowseQuery({ searchString = "", sorts = {}, filters = {}, itemClassFilters = {} }) end)
	watchdog(summary)
end

---------------------------------------------------------------------------
-- Listings per item
---------------------------------------------------------------------------

local listing -- { ids, index, current = { id, key, prices }, onItem, onDone }

local function priceSorts()
	local order = Enum and Enum.AuctionHouseSortOrder and Enum.AuctionHouseSortOrder.Price or 0
	return { { sortOrder = order, reverseSort = false } }
end

local startItem

local function finishItem()
	local cur = listing and listing.current
	if not cur then return end
	listing.current = nil
	local levels, qty = {}, 0
	for price, q in pairs(cur.prices) do levels[#levels + 1] = { price, q } qty = qty + q end
	table.sort(levels, function(a, b) return a[1] < b[1] end)
	if cur.answered then
		-- none listed is an answer too: none for sale now
		local DB = ns.GetDB()
		DB.detail = DB.detail or {}
		DB.detail[cur.id] = { t = ns.Now(), levels = levels, qty = qty, complete = cur.complete and true or false }
	end
	listing.done = listing.done + 1
	if listing.onItem then pcall(listing.onItem, cur.id, levels) end
	changed()
	startItem()
end

function startItem()
	if not listing then return end
	listing.index = listing.index + 1
	local id = listing.ids[listing.index]
	if not id or not ns.IsAuctionHouseOpen() then
		local done, n = listing.onDone, listing.done
		listing = nil
		Scan.busy = nil
		progress("")
		if done then pcall(done, n) end
		changed()
		return
	end
	progress(("checking listings %d/%d"):format(listing.index, #listing.ids))
	local cur = { id = id, key = Scan.keys[id] or C_AuctionHouse.MakeItemKey(id), prices = {} }
	listing.current = cur
	enqueue(function() C_AuctionHouse.SendSearchQuery(cur.key, priceSorts(), false) end)
	-- no answer (an item the AH doesn't know, or it is busy): keep what came and move on
	C_Timer.After(8, function() if listing and listing.current == cur then finishItem() end end)
end

local function readCommodity(id)
	local cur = listing and listing.current
	if not cur or cur.id ~= id then return end
	cur.answered = true
	wipe(cur.prices)
	local n = C_AuctionHouse.GetNumCommoditySearchResults(id) or 0
	for i = 1, n do
		local r = C_AuctionHouse.GetCommoditySearchResultInfo(id, i)
		if r and (r.unitPrice or 0) > 0 then cur.prices[r.unitPrice] = (cur.prices[r.unitPrice] or 0) + (r.quantity or 0) end
	end
	cur.complete = C_AuctionHouse.HasFullCommoditySearchResults(id)
	if not cur.complete and n < MAX_LISTINGS and n > (cur.n or -1) then
		cur.n = n
		enqueue(function() C_AuctionHouse.RequestMoreCommoditySearchResults(id) end)
	elseif cur.complete or n >= MAX_LISTINGS then
		finishItem()
	end
end

local function readItems(itemKey)
	local cur = listing and listing.current
	if not cur or type(itemKey) ~= "table" or itemKey.itemID ~= cur.id then return end
	cur.answered = true
	wipe(cur.prices)
	local n = C_AuctionHouse.GetNumItemSearchResults(itemKey) or 0
	for i = 1, n do
		local r = C_AuctionHouse.GetItemSearchResultInfo(itemKey, i)
		if r and (r.buyoutAmount or 0) > 0 then
			local q = math.max(1, r.quantity or 1)
			local unit = math.floor(r.buyoutAmount / q + 0.5)
			cur.prices[unit] = (cur.prices[unit] or 0) + q
		end
	end
	cur.complete = C_AuctionHouse.HasFullItemSearchResults(itemKey)
	if not cur.complete and n < MAX_LISTINGS and n > (cur.n or -1) then
		cur.n = n
		enqueue(function() C_AuctionHouse.RequestMoreItemSearchResults(itemKey) end)
	elseif cur.complete or n >= MAX_LISTINGS then
		finishItem()
	end
end

--- Searches each item in turn for all its listings (cheapest first). onItem(id, levels) after
--- each, onDone(count) at the end. Returns false when it can't start.
function Scan.Listings(ids, onItem, onDone)
	if Scan.busy or #ids == 0 or not ns.IsAuctionHouseOpen() then return false end
	if not (C_AuctionHouse and C_AuctionHouse.SendSearchQuery and C_AuctionHouse.MakeItemKey) then return false end
	Scan.busy = "listings"
	listing = { ids = ids, index = 0, done = 0, onItem = onItem, onDone = onDone }
	startItem()
	return true
end

--- Stops whatever scan is running (a summary keeps what came so far).
function Scan.Stop()
	wipe(requests)
	if summary then finishSummary(true) return end
	if listing then
		local done, n = listing.onDone, listing.done
		listing = nil
		Scan.busy = nil
		progress("")
		if done then pcall(done, n) end
		changed()
	end
end

---------------------------------------------------------------------------
-- Events
---------------------------------------------------------------------------

local handlers = {}
function handlers.AUCTION_HOUSE_THROTTLED_SYSTEM_READY() pump() end
handlers.AUCTION_HOUSE_BROWSE_RESULTS_UPDATED = onBrowse
handlers.AUCTION_HOUSE_BROWSE_RESULTS_ADDED = onBrowse
handlers.COMMODITY_SEARCH_RESULTS_UPDATED = readCommodity
handlers.COMMODITY_SEARCH_RESULTS_ADDED = readCommodity
handlers.ITEM_SEARCH_RESULTS_UPDATED = readItems
handlers.ITEM_SEARCH_RESULTS_ADDED = readItems
function handlers.AUCTION_HOUSE_CLOSED()
	wipe(requests)
	if summary then
		ns.Say("AH closed: scan stopped.")
		summary = nil
	end
	listing = nil
	Scan.busy = nil
	progress("")
end

frame:SetScript("OnEvent", function(_, event, ...)
	local h = handlers[event]
	if h then
		local ok, err = pcall(h, ...)
		if not ok then ns.Say("|cffff4040scan error:|r %s", tostring(err)) end
	end
end)
for event in pairs(handlers) do pcall(frame.RegisterEvent, frame, event) end
