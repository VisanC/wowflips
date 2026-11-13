-- Runs FlipExport outside the game with a mocked WoW API.
-- Usage (from repo root):  lua5.1 addon/tests/run.lua [auctions] [items] > export.txt
-- Prints the export string on stdout and a summary on stderr.

local AUCTIONS = tonumber(arg[1]) or 60000
local ITEMS = tonumber(arg[2]) or 12000
local ROOT = "addon/FlipExport/"

math.randomseed(42)
local function log(...) io.stderr:write(string.format(...), "\n") end

-- Generic mock object: any method call is a no-op returning the object.
local function mock(name)
	local o = { _name = name, scripts = {} }
	return setmetatable(o, { __index = function(t, k)
		return function(self, ...) return self end
	end })
end

-- Timers --------------------------------------------------------------------
local queue = {}
C_Timer = { After = function(_, fn) queue[#queue + 1] = fn end }
local function drain()
	while #queue > 0 do
		local fn = table.remove(queue, 1)
		fn()
	end
end

-- Frames ----------------------------------------------------------------------
local eventFrame
local exportText
function CreateFrame(kind, name)
	local f = mock(kind)
	f.RegisterEvent = function(self, ev) self.events = self.events or {}; self.events[ev] = true end
	f.SetScript = function(self, what, fn) self.scripts[what] = fn end
	f.CreateFontString = function() return mock("FontString") end
	f.SetText = function(self, text) self.text = text; if kind == "EditBox" then exportText = text end end
	if kind == "Frame" and not name and not eventFrame then eventFrame = f end
	return f
end
UIParent, ChatFontNormal, UISpecialFrames = mock("UIParent"), mock("Font"), {}
tinsert = table.insert
SlashCmdList = {}
print = function(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = tostring(select(i, ...)) end log("[chat] %s", table.concat(t, " ")) end

local function fire(event, ...)
	eventFrame.scripts.OnEvent(eventFrame, event, ...)
	drain()
end

-- Player ------------------------------------------------------------------------
GetServerTime = function() return os.time() end
time = os.time
UnitName = function() return "Tudor" end
GetRealmName = function() return "Test Realm" end
UnitFactionGroup = function() return "Alliance" end
UnitClass = function() return "Hunter", "HUNTER" end
UnitLevel = function() return 36 end
GetMoney = function() return 312345 end
GetBuildInfo = function() return "1.60.1", "70938" end
NUM_BAG_SLOTS, NUM_BANKBAGSLOTS, BANK_CONTAINER = 4, 7, -1

-- Containers: bags 0-4, bank -1 and 5-11 ------------------------------------------
local containers = {
	[0] = { { 3858, 20 }, { 3860, 7 }, { 7910, 1 } },
	[1] = { { 2772, 15 }, { 3858, 9 } },
	[-1] = { { 4371, 6 }, { 4375, 6 } },
	[5] = { { 4400, 2 }, { 1705, 4 } },
}
C_Container = {
	GetContainerNumSlots = function(bag) return containers[bag] and #containers[bag] or 0 end,
	GetContainerItemInfo = function(bag, slot)
		local s = containers[bag] and containers[bag][slot]
		return s and { itemID = s[1], stackCount = s[2] } or nil
	end,
}

-- Auction House ------------------------------------------------------------------
local auctions = {}
for i = 1, AUCTIONS do
	local item = math.random(1, ITEMS) + 2000
	local count = math.random(1, 20)
	local unit = math.random(50, 50000)
	auctions[i] = { item, count, unit * count }
end
C_AuctionHouse = {
	ReplicateItems = function() C_Timer.After(0, function() fire("REPLICATE_ITEM_LIST_UPDATE") end) end,
	GetNumReplicateItems = function() return #auctions end,
	GetReplicateItemInfo = function(i)
		local a = auctions[i + 1]
		return "name", 0, a[2], 1, true, 1, 0, 0, 0, a[3], 0, false, nil, "seller", nil, 0, a[1], true
	end,
}

-- Professions --------------------------------------------------------------------
C_TradeSkillUI = {
	GetAllRecipeIDs = function() return { 3938, 3954, 3962, 99999 } end,
	GetBaseProfessionInfo = function() return { professionName = "Engineering", skillLevel = 177, maxSkillLevel = 225 } end,
	GetRecipeInfo = function(id) return { learned = id ~= 99999 } end,
}

-- Skill list (classic style), with a collapsed header ------------------------------
local skillLines = {
	{ "Professions", true, true },
	{ "Engineering", false, false, 177, 0, 0, 225 },
	{ "Mining", false, false, 177, 0, 0, 225 },
	{ "Secondary Skills", true, false }, -- collapsed: its lines appear once expanded
}
local hidden = {
	{ "Fishing", false, false, 120, 0, 0, 150 },
	{ "Cooking", false, false, 95, 0, 0, 150 },
}
GetNumSkillLines = function() return #skillLines end
GetSkillLineInfo = function(i) return unpack(skillLines[i]) end
ExpandSkillHeader = function(i)
	skillLines[i][3] = true
	for k, line in ipairs(hidden) do table.insert(skillLines, i + k, line) end
	hidden = {}
end

-- Merchant: retail-style GetMerchantItemInfo (10 returns) ---------------------------
local merchant = {
	{ 2880, 100, 1, -1, false },  -- Weak Flux, unlimited
	{ 3371, 20, 5, -1, false },   -- Empty Vial, sold in 5s
	{ 9999, 5000, 1, 1, false },  -- limited supply: must be skipped
	{ 8888, 0, 1, -1, true },     -- extended cost: must be skipped
}
GetMerchantNumItems = function() return #merchant end
GetMerchantItemID = function(i) return merchant[i][1] end
GetMerchantItemInfo = function(i)
	local m = merchant[i]
	return "name", 0, m[2], m[3], m[4], true, true, m[5], nil, nil
end

-- Mailbox: AH mails (globals as in the enUS client) -------------------------------
AUCTION_SOLD_MAIL_SUBJECT = "Auction successful: %s"
AUCTION_WON_MAIL_SUBJECT = "Auction won: %s"
AUCTION_EXPIRED_MAIL_SUBJECT = "Auction expired: %s"
AUCTION_REMOVED_MAIL_SUBJECT = "Auction cancelled: %s"
local inbox = {
	{ subject = "Auction successful: Moonsight Rifle", daysLeft = 29.9, invoice = { "seller", "Moonsight Rifle", "Buyer", 105000, 105000, 600, 5250, 0, 0, 1 } },
	{ subject = "Auction successful: Mithril Bar (20)", daysLeft = 29.5, invoice = { "seller", "Mithril Bar", "Buyer", 24000, 24000, 300, 1200, 0, 0, 20 } },
	{ subject = "Auction successful: Mithril Bar (20)", daysLeft = 29.5, invoice = { "seller", "Mithril Bar", "Buyer", 24000, 24000, 300, 1200, 0, 0, 20 } },
	{ subject = "Auction expired: Moonsight Rifle", daysLeft = 29.0, link = "|cff1eff00|Hitem:4383::::::::36:::::|h[Moonsight Rifle]|h|r" },
	{ subject = "Auction won: Mithril Ore (20)", daysLeft = 28.0, link = "|cffffffff|Hitem:3858::::::::36:::::|h[Mithril Ore]|h|r", invoice = { "buyer", "Mithril Ore", "Seller", 16800, 16800, 0, 0, 0, 0, 20 } },
	{ subject = "Hello from a friend", daysLeft = 20 },
}
GetInboxNumItems = function() return #inbox end
GetInboxHeaderInfo = function(i)
	local m = inbox[i]
	return nil, nil, "sender", m.subject, 0, 0, m.daysLeft, m.link and 1 or nil
end
GetInboxInvoiceInfo = function(i) local inv = inbox[i].invoice if inv then return unpack(inv) end end
GetInboxItemLink = function(i) return inbox[i].link end
GetItemInfoInstant = function(name) local ids = { ["Moonsight Rifle"] = 4383, ["Mithril Bar"] = 3860 } return ids[name] end

-- Your listings -----------------------------------------------------------------------
local owned = {
	{ auctionID = 9001, itemKey = { itemID = 4383 }, quantity = 1, buyoutAmount = 110000, status = 0 },
	{ auctionID = 9002, itemKey = { itemID = 3860 }, quantity = 20, buyoutAmount = 1250, status = 1 },
}
C_AuctionHouse_extra = {
	GetNumOwnedAuctions = function() return #owned end,
	GetOwnedAuctionInfo = function(i) return owned[i] end,
	QueryOwnedAuctions = function() end,
}

-- Auctionator: its runtime price database (shape copied from a real Forever install) ------
local atrToday = math.floor((os.time() - os.time({ year = 2020, month = 1, day = 1, hour = 0 })) / 86400)
local d = function(n) return tostring(atrToday - n) end
AUCTIONATOR_PRICE_DATABASE = { __dbversion = 8 }
AUCTIONATOR_POSTING_HISTORY = {
	["4371"] = { { price = 509, quantity = 14, time = os.time() - 3600 } },
	["1210"] = { { price = 270, quantity = 1, time = os.time() - 7200 }, { price = 300, quantity = 1, time = os.time() - 100 * 86400 } },
}
Auctionator = { API = { v1 = {} }, State = { CurrentRealm = "PvP" }, Database = { db = {
	["3858"] = { m = 1039, h = { [d(2)] = 1077, [d(1)] = 720, [d(0)] = 1070 }, l = { [d(0)] = 855 }, a = { [d(2)] = 6932, [d(1)] = 3335, [d(0)] = 4491 } },
	["4383"] = { m = 9588, h = { [d(3)] = 9000, [d(0)] = 9790 }, l = { [d(0)] = 9588 }, a = { [d(3)] = 62, [d(0)] = 38 } },
	["15622"] = { m = 21500, h = { [d(0)] = 21500 }, l = {}, a = { [d(0)] = 3 } },
	["g:15622:30"] = { m = 21500, h = { [d(0)] = 21500 }, l = {}, a = {} },
	["p:123"] = { m = 5000, h = { [d(0)] = 5000 }, l = {}, a = {} },
	["2772"] = { m = 244, h = { [d(30)] = 300 }, l = {}, a = { [d(30)] = 50 } },
} } }

-- Engineering trainer ------------------------------------------------------------------
local services = {
	{ "Engineering", "header" },
	{ "Mithril Tube", "available", "Engineering", 195, 1500, "|cffffffff|Hitem:10559::::::::|h[Mithril Tube]|h|r" },
	{ "Unstable Trigger", "unavailable", "Engineering", 200, 1800, "|cffffffff|Hitem:10560::::::::|h[Unstable Trigger]|h|r" },
	{ "Bronze Tube", "used", "Engineering", 105, 600, "|cffffffff|Hitem:4371::::::::|h[Bronze Tube]|h|r" },
	{ "Artisan Engineering", "unavailable" },
}
local shown = { available = true, unavailable = false, used = false } -- the player hid some
local function visible()
	local v = {}
	for _, sv in ipairs(services) do if sv[2] == "header" or shown[sv[2]] or sv[2] == nil then v[#v + 1] = sv end end
	return v
end
GetNumTrainerServices = function() return #visible() end
GetTrainerServiceInfo = function(i) local sv = visible()[i] return sv[1], "", sv[2] end
GetTrainerServiceSkillReq = function(i) local sv = visible()[i] if sv[3] then return sv[3], sv[4], true end end
GetTrainerServiceCost = function(i) return visible()[i][5] or 0 end
GetTrainerServiceItemLink = function(i) return visible()[i][6] end
GetTrainerServiceTypeFilter = function(kind) return shown[kind] end
SetTrainerServiceTypeFilter = function(kind, on) shown[kind] = on == 1 or on == true end

-- Load the addon like the client does ------------------------------------------------
local ns = {}
local function load(file) assert(loadfile(ROOT .. file))("FlipExport", ns) end
load("Libs/LibStub/LibStub.lua")
load("Libs/LibDeflate/LibDeflate.lua")
load("Core.lua")
load("FlipExport.lua")

fire("ADDON_LOADED", "FlipExport")
fire("AUCTION_HOUSE_SHOW")
local t0 = os.clock()
SlashCmdList.FLIPEXPORT("scan")
drain()
log("scan processing: %.2fs CPU for %d auctions", os.clock() - t0, AUCTIONS)
fire("BANKFRAME_OPENED")
fire("TRADE_SKILL_SHOW")
fire("MERCHANT_SHOW")
for k, v in pairs(C_AuctionHouse_extra) do C_AuctionHouse[k] = v end
fire("TRAINER_SHOW")
assert(shown.available and not shown.unavailable and not shown.used, "trainer filters were not restored")
fire("OWNED_AUCTIONS_UPDATED")
fire("MAIL_SHOW")
fire("MAIL_INBOX_UPDATE") -- seen twice: must not double count
fire("UNIT_SPELLCAST_SUCCEEDED", "player", "cast-1", 3954)
fire("UNIT_SPELLCAST_SUCCEEDED", "player", "cast-2", 3954)
fire("UNIT_SPELLCAST_SUCCEEDED", "player", "cast-3", 75) -- not a recipe (Auto Shot)
SlashCmdList.FLIPEXPORT("status")
t0 = os.clock()
SlashCmdList.FLIPEXPORT("export")
log("export (json + deflate + base64): %.2fs CPU", os.clock() - t0)
assert(exportText, "export window was not filled")
log("export string: %d KB", math.ceil(#exportText / 1024))
io.write(exportText)
