-- Smoke test for the Forever Flips window: loads the whole addon in .toc order against a
-- generic mock of WoW's frame API, opens the window and goes through every tab and control.
-- It catches Lua errors and empty views, not layout. Run from the repo root:
--   lua5.1 addon/tests/ui.lua                      (test fixture data)
--   GAMEDATA=addon/FlipExport/Data/GameData.lua SV=<SavedVariables/FlipExport.lua> lua5.1 addon/tests/ui.lua

local ROOT = "addon/FlipExport/"
local chat = {}
local function log(...) io.stderr:write(string.format(...), "\n") end

-- Generic widget mock; scripts run on Show/Click/etc.
local Methods = {}
local function mock(kind, name)
	local o = { kind = kind, name = name, shown = true, w = 120, h = 400, scripts = {}, text = "", min = 0, max = 0, value = 0 }
	-- like real frames: unknown API methods (Capitalized) are no-ops, other unset fields are nil
	return setmetatable(o, { __index = function(_, k)
		if Methods[k] then return Methods[k] end
		if type(k) == "string" and k:match("^%u") then return function() end end
		return nil
	end })
end
function Methods:SetSize(w, h) self.w, self.h = w, h end
function Methods:SetWidth(w) self.w = w end
function Methods:SetHeight(h) self.h = h if self.scripts.OnSizeChanged then self.scripts.OnSizeChanged(self) end end
function Methods:GetWidth() return self.w end
function Methods:GetHeight() return self.h end
function Methods:Show() local was = self.shown self.shown = true if not was and self.scripts.OnShow then self.scripts.OnShow(self) end end
function Methods:Hide() self.shown = false end
function Methods:IsShown() return self.shown end
function Methods:SetScript(n, fn) self.scripts[n] = fn end
function Methods:GetScript(n) return self.scripts[n] end
function Methods:SetText(t) self.text = t end
function Methods:GetText() return self.text end
local fontStrings = {}
function Methods:CreateFontString() local f = mock("FontString") fontStrings[#fontStrings + 1] = f return f end
function Methods:CreateTexture() return mock("Texture") end
function Methods:SetChecked(v) self.checked = v end
function Methods:GetChecked() return self.checked end
function Methods:SetMinMaxValues(a, b) self.min, self.max = a, b end
function Methods:GetMinMaxValues() return self.min, self.max end
function Methods:SetValue(v) self.value = v if self.scripts.OnValueChanged then self.scripts.OnValueChanged(self, v) end end
function Methods:GetPoint() return "CENTER", nil, "CENTER", 0, 0 end
function Methods:GetCenter() return 0, 0 end
function Methods:GetEffectiveScale() return 1 end
function Methods:RegisterEvent(e) local ev = rawget(self, "events") or {} self.events = ev ev[e] = true end
function Methods:Click(button) if self.scripts.OnClick then self.scripts.OnClick(self, button or "LeftButton") end end
function Methods:IsVisible()
	local f = self
	while f do
		if not rawget(f, "shown") then return false end
		f = rawget(f, "parent")
	end
	return true
end
function Methods:GetRect() return 100, 40, self.w, self.h end
function Methods:SetAttribute(k, v) local a = rawget(self, "attrs") or {} self.attrs = a a[k] = v end
function Methods:GetAttribute(k) local a = rawget(self, "attrs") return a and a[k] end

local frames = {}
CreateFrame = function(kind, name, parent, template)
	local f = mock(kind, name)
	f.parent = parent
	if name then _G[name] = f end
	frames[#frames + 1] = f
	return f
end
UIParent, Minimap, GameTooltip = mock("Frame"), mock("Frame"), mock("GameTooltip")
UISpecialFrames, BackdropTemplateMixin = {}, {}
tinsert = table.insert
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
time, date = os.time, os.date
GetServerTime = os.time
-- timers run when the test says so: those due within `upTo` seconds (default 5; listing
-- timeouts are 8, so they wait unless asked for)
local timers = {}
C_Timer = { After = function(d, fn) timers[#timers + 1] = { d, fn } end }
local function runTimers(upTo)
	upTo = upTo or 5
	local ran = true
	while ran do
		ran = false
		for i, t in ipairs(timers) do
			if t[1] <= upTo then table.remove(timers, i) t[2]() ran = true break end
		end
	end
end
local clock = 1000
GetTime = function() clock = clock + 0.1 return clock end
SlashCmdList = {}
print = function(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = tostring(select(i, ...)) end chat[#chat + 1] = table.concat(t, " ") log("[chat] %s", chat[#chat]) end
UnitName = function() return os.getenv("CHAR_NAME") or "Tudor" end
GetRealmName = function() return os.getenv("CHAR_REALM") or "Test Realm" end
UnitFactionGroup = function() return "Alliance" end
UnitClass = function() return "Hunter", "HUNTER" end
UnitLevel = function() return 36 end
GetMoney = function() return 123456 end
GetBuildInfo = function() return "1.60.1", "70938", "", 16001 end
GetCursorPosition = function() return 10, 10 end
GetNumSkillLines = function() return 0 end
GetItemInfo = function() return nil end
C_Container = { GetContainerNumSlots = function() return 0 end }

-- the addon, in .toc order
local ns = {}
local toc = io.open(ROOT .. "FlipExport.toc"):read("*a")
for line in toc:gmatch("[^\r\n]+") do
	if not line:match("^##") and line:match("%.lua$") then
		local path = line:gsub("\\", "/")
		if path == "Data/GameData.lua" and not os.getenv("GAMEDATA") then path = "../tests/fixtures/GameData.lua" end
		if path == "Data/GameData.lua" then path = os.getenv("GAMEDATA"):gsub("^" .. ROOT, "") end
		local fn = loadfile(ROOT .. path)
		if fn then fn("FlipExport", ns) elseif path ~= "Data/RecipeMaster.lua" then error("cannot load " .. path) end
	end
end
assert(ns.App and ns.GameData, "addon did not load")

if os.getenv("SV") then dofile(os.getenv("SV")) end

-- TSM: its options are set before it reads them, and the app data's download time is noted
TradeSkillMasterDB = {
	["g@ @auctionUIContext@showDefault"] = false, ["g@ @tooltipOptions@enabled"] = true,
	["g@ @bankingUIContext@isOpen"] = true, ["g@ @coreOptions@minimapIcon"] = { hide = false, minimapPos = 220 },
}
local tsmLoaded
TSM_APPHELPER_LOAD_DATA = function(tag, where, data) tsmLoaded = tag end
FlipExportDB = FlipExportDB or {}
for _, f in ipairs(frames) do
	local ev = rawget(f, "events")
	if ev and ev.ADDON_LOADED then f.scripts.OnEvent(f, "ADDON_LOADED", "TradeSkillMaster") end
end
TSM_APPHELPER_LOAD_DATA("AUCTIONDB_NON_COMMODITY_DATA", "PvP-Alliance", "return {downloadTime=1794835141,fields={},data={}}")
assert(tsmLoaded == "AUCTIONDB_NON_COMMODITY_DATA", "TSM still gets its data")
assert(ns.TsmDataTime("AUCTIONDB_NON_COMMODITY_DATA") == 1794835141, "download time noted")
assert(TradeSkillMasterDB["g@ @auctionUIContext@showDefault"] == true and TradeSkillMasterDB["g@ @tooltipOptions@enabled"] == false, "TSM windows and tooltips off")
assert(TradeSkillMasterDB["g@ @bankingUIContext@isOpen"] == false and TradeSkillMasterDB["g@ @coreOptions@minimapIcon"].hide == true, "TSM banking and minimap icon off")
assert(TradeSkillMasterDB["g@ @mailingUIContext@showDefault"] == nil, "keys TSM does not have are left alone")
log("TSM kept out of sight, download time noted: ok")
TradeSkillMasterDB, TSM_APPHELPER_LOAD_DATA = nil, nil
local eventFrame
for _, f in ipairs(frames) do local ev = rawget(f, "events") if ev and ev.ADDON_LOADED then eventFrame = f end end
eventFrame.scripts.OnEvent(eventFrame, "ADDON_LOADED", "FlipExport")
local DB = ns.GetDB()
if not os.getenv("SV") then
	-- a small made-up character: knows Bronze Tube and smelting, a scan, a few mails
	local c = ns.CharData()
	c.profs = {
		Engineering = { n = "Engineering", r = 150, m = 225, s = { 3938, 3953, 3958 } },
		Mining = { n = "Mining", r = 175, m = 225, s = { 2659, 3307, 10097 } },
	}
	c.ledger = { mail = { a = { k = "sold", n = "Bronze Tube", i = 4371, c = 2, p = 5000, f = 250, t = time() - 3600 } }, crafts = {} }
	DB.ah = { t = time() - 600, i = {
		{ 2840, 10, 50, { { 10, 50 } } }, { 3576, 20, 40, { { 20, 40 } } }, { 2841, 100, 30, { { 100, 30 } } },
		{ 4371, 2600, 8, { { 2600, 8 } } }, { 4382, 4000, 3, { { 4000, 3 } } }, { 2592, 30, 99, { { 30, 99 } } },
		{ 3860, 300, 12, { { 300, 2 }, { 350, 3 }, { 500, 7 } } }, { 3858, 250, 40, { { 250, 40 } } },
	} }
end

-- open the window and go through everything
local errors = 0
for _, m in ipairs(chat) do if m:find("failed") then errors = errors + 1 end end
SlashCmdList.FLIPEXPORT("")
runTimers()
local win = _G.ForeverFlipsFrame
assert(win and win.shown, "window did not open")
log("status: %s", win.status.text)

local App = ns.App
local function rowsOf(list) return #list.data end
local function findLists(tab)
	local out = {}
	for _, f in ipairs(frames) do if rawget(f, "rows") and rawget(f, "headers") and f.parent == App.tabs[tab].panel then out[#out + 1] = f end end
	return out
end
local function clickAll(tab)
	for _, f in ipairs(frames) do
		if f.parent == App.tabs[tab].panel and f.kind == "Button" and f.scripts.OnClick and not rawget(f, "data") then
			for _ = 1, 3 do f.scripts.OnClick(f, "LeftButton") end
		end
		if f.parent == App.tabs[tab].panel and f.kind == "CheckButton" and f.scripts.OnClick then
			f.checked = not f.checked
			f.scripts.OnClick(f)
			f.checked = not f.checked
			f.scripts.OnClick(f)
		end
	end
	runTimers()
end

for _, tab in ipairs({ "crafts", "deals", "leveling", "sales" }) do
	App.Show(tab)
	local lists = findLists(tab)
	local counts = {}
	for _, l in ipairs(lists) do counts[#counts + 1] = rowsOf(l) end
	log("%s: lists %s", tab, table.concat(counts, ", "))
	-- first rows as text
	for _, l in ipairs(lists) do
		for i = 1, math.min(3, #l.rows) do
			local r = l.rows[i]
			if r.shown and r.data then
				local cells = {}
				for _, c in ipairs(r.cells) do cells[#cells + 1] = (c.text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "") end
				log("   %s", table.concat(cells, " | "))
			end
		end
	end
	clickAll(tab)
	-- click the first row of each list, and sort by every column
	for _, l in ipairs(lists) do
		if l.rows[1] and l.rows[1].data then l.rows[1]:Click("LeftButton") end
		for _, h in ipairs(l.headers) do h:Click() h:Click() end
		for _, r in ipairs(l.rows) do if r.shown and r.scripts.OnEnter then r.scripts.OnEnter(r) end end
		l.scripts.OnMouseWheel(l, -1)
	end
	runTimers()
end
-- craft queue, shopping list, Auctionator list, AH search, craft next, queue counting down
if not os.getenv("SV") then
	local crafts = App.tabs.crafts
	local bagItems = { { itemID = 2840, stackCount = 10 }, { itemID = 3576, stackCount = 10 } }
	C_Container = {
		GetContainerNumSlots = function(bag) return bag == 0 and #bagItems or 0 end,
		GetContainerItemInfo = function(bag, slot) return bagItems[slot] end,
	}
	local created, searched, crafted
	Auctionator = { API = { v1 = {
		CreateShoppingList = function(_, name, list) created = { name, list } end,
		ConvertToSearchString = function(_, t) return '"' .. t.searchString .. '";;;;;;;;;;;#;;' .. t.quantity end,
		MultiSearchExact = function(_, terms) searched = terms[1] end,
	} } }
	C_TradeSkillUI = { GetAllRecipeIDs = function() return {} end, CraftRecipe = function(spell, n) crafted = { spell, n } end }
	-- Auctionator's database: the time of each price it records is noted
	hooksecurefunc = function(t, name, fn) local orig = t[name] t[name] = function(...) local r = orig(...) fn(...) return r end end
	Auctionator.Database = { db = {}, SetPrice = function(self, key, price) self.db[key] = { m = price, h = {}, l = {}, a = {} } end }
	ns.WatchAuctionator()
	Auctionator.Database:SetPrice("2592", 25, 10)
	assert(ns.GetDB().atrSeen["2592"], "Auctionator's price time noted")
	runTimers()
	App.Refresh()
	crafts.AddToQueue(App.state.d.bySpell[3938], 2) -- Bronze Tube: 2 bronze bars + weak flux each
	crafts.AddToQueue(App.state.d.bySpell[3953], 1) -- Bronze Framework: 2 bronze bars + wool cloth
	App.ui.crafts.view = "queue"
	GetSpellInfo = function(id) return "spell " .. id, nil, nil, id == 2659 and 3000 or 5000 end
	crafts.Update()
	local q = findLists("crafts")[3]
	-- time per step and from the start: 3 smelts x 3.5 s, then 1 x 5.5 s and 2 x 5.5 s
	assert(q.data[1].seconds == 10.5 and q.data[#q.data].doneAt == 10.5 + 3 * 5.5, "craft times")
	local title
	for _, f in ipairs(fontStrings) do if type(f.text) == "string" and f.text:find("crafts, about") then title = f.text end end
	assert(title and title:find("6 crafts, about 27 s\n", 1, true), "queue title: " .. tostring(title))
	log("queue title: %s", (title:gsub("\n", " / ")))
	GetSpellInfo = nil
	local names = {}
	for _, c in ipairs(q.data) do names[#names + 1] = c.recipe.name .. " x" .. c.count end
	log("queue: %s", table.concat(names, ", "))
	assert(q.data[1].recipe.name == "Smelt Bronze" and q.data[1].count == 3, "parts first: 6 bronze bars = 3 smelts")
	App.ui.crafts.view = "shop"
	crafts.Update()
	local shop = findLists("crafts")[4]
	local buys = {}
	for _, b in ipairs(shop.data) do buys[#buys + 1] = ("%s %d (%s)"):format(ns.Data.ItemName(App.state.d, b.item), b.qty, b.kind) end
	log("shopping: %s", table.concat(buys, ", "))
	crafts.SendToAuctionator()
	assert(created and created[1] == "Forever Flips" and #created[2] == 1, "Auctionator list with the wool cloth")
	log("auctionator list: %s", created[2][1])
	eventFrame.scripts.OnEvent(eventFrame, "AUCTION_HOUSE_SHOW")
	runTimers()
	App.SearchItem(2592)
	assert(searched == "Wool Cloth", "AH search through Auctionator")
	crafts.CraftNext()
	assert(crafted and crafted[1] == 2659 and crafted[2] == 3, "crafts the smelting first: " .. tostring(crafted and crafted[1]))
	eventFrame.scripts.OnEvent(eventFrame, "UNIT_SPELLCAST_SUCCEEDED", "player", "c1", 3938)
	assert(ns.CharData().queue[3938] == 1, "a crafted Bronze Tube comes off the queue")
	log("queue, shopping list, Auctionator, AH search, craft next: ok")

	-- the craft button: opens the step's profession window first, then crafts all of the step
	local cb = _G.ForeverFlipsCraftButton
	assert(cb and cb.parent == UIParent, "secure craft button on UIParent")
	App.Show("crafts")
	App.ui.crafts.view = "queue"
	crafts.Update()
	runTimers()
	assert(cb.shown, "craft button over the queue view")
	assert(cb.text == "Open Smelting", "first it opens the profession: " .. tostring(cb.text))
	crafted = nil
	cb.scripts.PreClick(cb, "LeftButton")
	assert(cb.attrs.type == "spell" and cb.attrs.spell == "Smelting", "the secure click casts Smelting")
	cb.scripts.PostClick(cb, "LeftButton")
	assert(not crafted, "nothing crafted while the window opens")
	C_TradeSkillUI.GetAllRecipeIDs = function() return { 2659, 3307, 10097 } end
	C_TradeSkillUI.GetRecipeInfo = function() return { learned = true } end
	C_TradeSkillUI.GetBaseProfessionInfo = function() return { professionName = "Mining", skillLevel = 175, maxSkillLevel = 225 } end
	eventFrame.scripts.OnEvent(eventFrame, "TRADE_SKILL_SHOW")
	runTimers()
	assert(cb.text == "Craft 2 x Smelt Bronze", "then it crafts: " .. tostring(cb.text))
	cb.scripts.PreClick(cb, "LeftButton")
	assert(cb.attrs.type == nil, "nothing to open now")
	cb.scripts.PostClick(cb, "LeftButton")
	assert(crafted and crafted[1] == 2659 and crafted[2] == 2, "all of the step at once: " .. tostring(crafted and crafted[2]))
	eventFrame.scripts.OnEvent(eventFrame, "TRADE_SKILL_CLOSE")
	runTimers()
	assert(cb.text == "Open Smelting", "closed: open it again first")
	App.Show("deals")
	assert(not cb.shown, "hidden away from the queue view")
	SlashCmdList.FLIPEXPORT("") runTimers()
	assert(not cb.shown, "hidden with the window")
	SlashCmdList.FLIPEXPORT("") runTimers()
	log("craft button: opens the profession, then crafts a whole step: ok")

	-- the AH scan: browse pages until the AH has sent all, then the deals' listings, one search each
	local page1 = { { itemKey = { itemID = 2840 }, minPrice = 12, totalQuantity = 50 }, { itemKey = { itemID = 3576 }, minPrice = 20, totalQuantity = 40 } }
	local page2 = { { itemKey = { itemID = 3860 }, minPrice = 300, totalQuantity = 12 }, { itemKey = { itemID = 2592 }, minPrice = 5, totalQuantity = 30 } }
	local browse, full, searches, answer = {}, false, {}, {}
	local LISTED = { [2592] = { { 5, 10 }, { 40, 20 } }, [3860] = { { 300, 2 }, { 350, 3 }, { 380, 4 }, { 500, 7 } }, [3576] = { { 20, 6 }, { 30, 34 } } }
	C_AuctionHouse = {
		IsThrottledMessageSystemReady = function() return true end,
		SendBrowseQuery = function() browse, full = {}, false for _, r in ipairs(page1) do browse[#browse + 1] = r end end,
		GetBrowseResults = function() return browse end,
		HasFullBrowseResults = function() return full end,
		RequestMoreBrowseResults = function() for _, r in ipairs(page2) do browse[#browse + 1] = r end full = true end,
		MakeItemKey = function(id) return { itemID = id } end,
		SendSearchQuery = function(key) searches[#searches + 1] = key.itemID end,
		GetNumCommoditySearchResults = function(id) return #(LISTED[id] or {}) end,
		GetCommoditySearchResultInfo = function(id, i) local l = LISTED[id][i] return { unitPrice = l[1], quantity = l[2] } end,
		HasFullCommoditySearchResults = function() return true end,
		GetNumItemSearchResults = function(key) return #(LISTED[key.itemID] or {}) end,
		GetItemSearchResultInfo = function(key, i) local l = LISTED[key.itemID][i] return { buyoutAmount = l[1] * l[2], quantity = l[2] } end,
		HasFullItemSearchResults = function() return true end,
	}
	local scanFrame
	for _, f in ipairs(frames) do local ev = rawget(f, "events") if ev and ev.AUCTION_HOUSE_BROWSE_RESULTS_UPDATED then scanFrame = f end end
	local function fire(...) scanFrame.scripts.OnEvent(scanFrame, ...) end
	App.ui.deals.mode, App.ui.deals.minProfit = "vendor", 0
	App.Show("deals")
	SlashCmdList.FLIPEXPORT("scan")
	assert(ns.Scan.busy == "summary", "scan started")
	fire("AUCTION_HOUSE_BROWSE_RESULTS_UPDATED")
	fire("AUCTION_HOUSE_BROWSE_RESULTS_UPDATED") -- the same page again: no second request
	assert(#browse == 4, "asked for the next page once: " .. #browse)
	fire("AUCTION_HOUSE_BROWSE_RESULTS_ADDED", page2)
	assert(not ns.Scan.busy and DB.ah.kind == "summary" and #DB.ah.i == 4, "summary scan saved")
	local rowOf = {}
	for _, r in ipairs(DB.ah.i) do rowOf[r[1]] = r end
	assert(#rowOf[3860][4] == 3 and #rowOf[2840][4] == 0, "the full scan's levels kept only where nothing changed")
	-- with the Deals tab open, a scan goes on to check the deals' listings
	runTimers()
	assert(ns.Scan.busy == "listings" and #searches == 1, "deals checked after the scan")
	local n = 0
	while ns.Scan.busy and n < 20 do
		n = n + 1
		local id = searches[#searches]
		if id == 3860 then fire("ITEM_SEARCH_RESULTS_UPDATED", { itemID = id }) else fire("COMMODITY_SEARCH_RESULTS_UPDATED", id) end
	end
	assert(not ns.Scan.busy and #searches == 3, "3 deals searched: " .. #searches)
	assert(DB.detail[2592].complete and DB.detail[2592].qty == 30, "every listing of wool cloth")
	runTimers()
	local deals = {}
	for _, r in ipairs(App.tabs.deals.rows) do deals[r.item] = r end
	assert(deals[2592].checked and deals[2592].units == 10 and not deals[2592].more, "10 wool cloth under the vendor price")
	assert(deals[3860].checked and deals[3860].units == 9 and deals[3576].units == 6, "mithril and tin counted")
	log("deals after checking: wool %d, mithril %d, tin %d units", deals[2592].units, deals[3860].units, deals[3576].units)
	-- the next scan keeps the counts while an item's cheapest price and amount are the same
	SlashCmdList.FLIPEXPORT("scan")
	fire("AUCTION_HOUSE_BROWSE_RESULTS_UPDATED")
	fire("AUCTION_HOUSE_BROWSE_RESULTS_ADDED", page2)
	for _, r in ipairs(DB.ah.i) do rowOf[r[1]] = r end
	assert(#rowOf[2592][4] == 2 and rowOf[2592][5] == true, "wool cloth's listings kept")
	runTimers()
	assert(not ns.Scan.busy, "nothing to check again so soon")
	for _, r in ipairs(App.tabs.deals.rows) do deals[r.item] = r end
	assert(deals[2592].checked and deals[2592].units == 10, "still counted")
	-- an item that isn't listed any more
	LISTED[3576] = {}
	ns.Scan.Listings({ 3576 })
	fire("COMMODITY_SEARCH_RESULTS_UPDATED", 3576)
	runTimers()
	assert(not App.state.market:Ah(3576), "tin bar gone from the AH")
	runTimers(math.huge) -- the listing timeouts: nothing left to time out
	log("AH scan without the 15-minute limit, listing checks: ok")
	C_AuctionHouse = nil
	Auctionator, C_TradeSkillUI = nil, nil
end

App.Show("crafts")
App.ui.crafts.view = "plan"
-- the crafts plan: click a part to flip buy/craft
local craftLists = findLists("crafts")
eventFrame.scripts.OnEvent(eventFrame, "AUCTION_HOUSE_CLOSED")
runTimers()
if craftLists[2] and craftLists[2].rows[1] and craftLists[2].rows[1].data then
	craftLists[2].rows[1]:Click("LeftButton")
	log("plan after flipping a part: %s", craftLists[2].rows[1].cells[5].text)
end
-- new data while open
ns.App.DataChanged()
runTimers()
SlashCmdList.FLIPEXPORT("")
assert(not win.shown, "window did not close")

for _, m in ipairs(chat) do if m:find("failed") or m:find("could not") then errors = errors + 1 end end
assert(errors == 0, "errors in chat")
log("UI_OK")
