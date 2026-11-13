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
SlashCmdList.FLIPEXPORT("status")
t0 = os.clock()
SlashCmdList.FLIPEXPORT("export")
log("export (json + deflate + base64): %.2fs CPU", os.clock() - t0)
assert(exportText, "export window was not filled")
log("export string: %d KB", math.ceil(#exportText / 1024))
io.write(exportText)
