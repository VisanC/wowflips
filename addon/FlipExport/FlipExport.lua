-- FlipExport / FlipExport.lua
-- Collects AH prices, bags, bank, known recipes and vendor prices, and
-- exports them as one copy-paste string for the Forever Flips web app.
--
-- Commands:  /flip scan    full AH scan (Auction House must be open)
--            /flip export  open the export window
--            /flip status  what has been captured so far

local ADDON, ns = ...
local Core = ns.Core
local LibDeflate = LibStub and LibStub:GetLibrary("LibDeflate", true)

local DB            -- FlipExportDB, set on ADDON_LOADED
local charKey       -- "Name-Realm"
local ahOpen = false
local scanPending = false
local SCAN_COOLDOWN = 15 * 60 -- Blizzard throttles full scans to one per 15 min per account

local function now() return GetServerTime and GetServerTime() or time() end

local function say(msg, ...)
	print("|cff4fc3f7FlipExport|r: " .. (select("#", ...) > 0 and msg:format(...) or msg))
end

local function charData()
	charKey = charKey or ((UnitName("player") or "?") .. "-" .. (GetRealmName() or "?"))
	DB.chars[charKey] = DB.chars[charKey] or { profs = {} }
	return DB.chars[charKey]
end

---------------------------------------------------------------------------
-- Containers (bags and bank)
---------------------------------------------------------------------------

local function numSlots(bag)
	local ok, n
	if C_Container and C_Container.GetContainerNumSlots then
		ok, n = pcall(C_Container.GetContainerNumSlots, bag)
	elseif GetContainerNumSlots then
		ok, n = pcall(GetContainerNumSlots, bag)
	end
	return (ok and n) or 0
end

local function readContainer(bag, counts)
	for slot = 1, numSlots(bag) do
		local id, count
		if C_Container and C_Container.GetContainerItemInfo then
			local info = C_Container.GetContainerItemInfo(bag, slot)
			if info then id, count = info.itemID, info.stackCount end
		elseif GetContainerItemInfo then
			local _, c, _, _, _, _, _, _, _, iid = GetContainerItemInfo(bag, slot)
			id, count = iid, c
		end
		if id then counts[id] = (counts[id] or 0) + (count or 1) end
	end
end

local function readBags()
	local counts = {}
	for bag = 0, (NUM_BAG_SLOTS or 4) do readContainer(bag, counts) end
	return Core.CountsToList(counts)
end

local function bankBagIDs()
	local ids, seen = {}, {}
	local function add(id)
		if id and not seen[id] then seen[id] = true; ids[#ids + 1] = id end
	end
	add(BANK_CONTAINER or -1)
	local first = (NUM_BAG_SLOTS or 4) + 1
	for id = first, first + (NUM_BANKBAGSLOTS or 7) - 1 do add(id) end
	if Enum and Enum.BagIndex then
		for name, id in pairs(Enum.BagIndex) do
			if type(name) == "string" and name:find("Bank") and not name:find("Account") then add(id) end
		end
	end
	return ids
end

local function captureBank()
	local counts = {}
	for _, bag in ipairs(bankBagIDs()) do readContainer(bag, counts) end
	charData().bank = { t = now(), i = Core.CountsToList(counts) }
end

---------------------------------------------------------------------------
-- Professions: known recipe spell IDs per profession
---------------------------------------------------------------------------

local function storeProfession(name, rank, max, spells)
	if not name or name == "" or name == "UNKNOWN" or #spells == 0 then return end
	charData().profs[name] = { n = name, r = rank or 0, m = max or 0, t = now(), s = spells }
end

local function captureTradeSkill()
	-- Modern client API
	if C_TradeSkillUI and C_TradeSkillUI.GetAllRecipeIDs then
		local ok, ids = pcall(C_TradeSkillUI.GetAllRecipeIDs)
		if not ok or not ids then return end
		local name, rank, max
		if C_TradeSkillUI.GetBaseProfessionInfo then
			local info = C_TradeSkillUI.GetBaseProfessionInfo()
			if info then name, rank, max = info.professionName, info.skillLevel, info.maxSkillLevel end
		end
		if not name and C_TradeSkillUI.GetTradeSkillLine then
			local _, n, r, m = C_TradeSkillUI.GetTradeSkillLine()
			name, rank, max = n, r, m
		end
		local spells = {}
		for _, id in ipairs(ids) do
			local info = C_TradeSkillUI.GetRecipeInfo(id)
			if info and info.learned then spells[#spells + 1] = id end
		end
		storeProfession(name, rank, max, spells)
		return
	end
	-- Classic-style API
	if GetNumTradeSkills and GetTradeSkillLine then
		local name, rank, max = GetTradeSkillLine()
		local spells = {}
		for i = 1, GetNumTradeSkills() do
			local _, kind = GetTradeSkillInfo(i)
			if kind ~= "header" and kind ~= "subheader" and GetTradeSkillRecipeLink then
				local link = GetTradeSkillRecipeLink(i)
				local spellID = link and tonumber(link:match("enchant:(%d+)"))
				if spellID then spells[#spells + 1] = spellID end
			end
		end
		storeProfession(name, rank, max, spells)
	end
end

local function captureCraft() -- classic Enchanting window
	if not (GetNumCrafts and GetCraftDisplaySkillLine) then return end
	local name, rank, max = GetCraftDisplaySkillLine()
	local spells = {}
	for i = 1, GetNumCrafts() do
		local _, _, kind = GetCraftInfo(i)
		if kind ~= "header" and GetCraftItemLink then
			local link = GetCraftItemLink(i)
			local spellID = link and tonumber(link:match("enchant:(%d+)"))
			if spellID then spells[#spells + 1] = spellID end
		end
	end
	storeProfession(name, rank, max, spells)
end

---------------------------------------------------------------------------
-- Vendors: remember unlimited-supply items and their unit price
---------------------------------------------------------------------------

local function captureMerchant()
	if not GetMerchantNumItems then return end
	local t = now()
	for i = 1, GetMerchantNumItems() do
		local id = GetMerchantItemID and GetMerchantItemID(i)
		local price, quantity, available, extendedCost
		if C_MerchantFrame and C_MerchantFrame.GetItemInfo then
			local info = C_MerchantFrame.GetItemInfo(i)
			if info then
				price, quantity, available, extendedCost = info.price, info.stackCount, info.numAvailable, info.hasExtendedCost
			end
		else
			-- Classic returns 7 values (extendedCost 7th), newer clients 8+ (extendedCost 8th).
			local r = { GetMerchantItemInfo(i) }
			local n = select("#", GetMerchantItemInfo(i))
			price, quantity, available = r[3], r[4], r[5]
			if n >= 8 then extendedCost = r[8] else extendedCost = r[7] end
		end
		if id and price and price > 0 and not extendedCost and (available == nil or available < 0) then
			DB.vendor[id] = { p = price / math.max(1, quantity or 1), t = t }
		end
	end
end

---------------------------------------------------------------------------
-- Auction House full scan
---------------------------------------------------------------------------

local function finishScan(agg, total)
	DB.ah = { t = now(), n = total, i = agg:Result(3) }
	say("scanned %d auctions, %d different items. Type |cffffff00/flip export|r to copy.", total, #DB.ah.i)
end

local function processReplicate()
	local total = C_AuctionHouse.GetNumReplicateItems()
	local agg = Core.NewAggregator()
	local index = 0
	local function step()
		local stop = math.min(index + 1000, total)
		for i = index, stop - 1 do
			local _, _, count, _, _, _, _, _, _, buyout, _, _, _, _, _, _, itemID = C_AuctionHouse.GetReplicateItemInfo(i)
			if itemID and buyout and buyout > 0 and count and count > 0 then
				agg:Add(itemID, math.floor(buyout / count), count)
			end
		end
		index = stop
		if index < total then C_Timer.After(0, step) else finishScan(agg, total) end
	end
	step()
end

local function startScan()
	if not ahOpen then return say("open the Auction House first.") end
	if not (C_AuctionHouse and C_AuctionHouse.ReplicateItems) then
		return say("this client has no full-scan API, sorry.")
	end
	local wait = SCAN_COOLDOWN - (now() - (DB.lastScanRequest or 0))
	if wait > 0 then
		say("Blizzard allows one full scan per 15 min. Trying anyway; if nothing happens, retry in %d min.", math.ceil(wait / 60))
	end
	DB.lastScanRequest = now()
	scanPending = true
	C_AuctionHouse.ReplicateItems()
	say("scanning the Auction House... keep it open for a few seconds.")
end

---------------------------------------------------------------------------
-- Export window
---------------------------------------------------------------------------

local exportFrame
local function showExport(text, rawSize)
	if not exportFrame then
		local f = CreateFrame("Frame", "FlipExportFrame", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
		f:SetSize(620, 420)
		f:SetPoint("CENTER")
		f:SetFrameStrata("DIALOG")
		f:SetMovable(true)
		f:EnableMouse(true)
		f:RegisterForDrag("LeftButton")
		f:SetScript("OnDragStart", f.StartMoving)
		f:SetScript("OnDragStop", f.StopMovingOrSizing)
		if f.SetBackdrop then
			f:SetBackdrop({
				bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
				edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
				tile = true, tileSize = 32, edgeSize = 32,
				insets = { left = 11, right = 12, top = 12, bottom = 11 },
			})
		end
		f.title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
		f.title:SetPoint("TOP", 0, -16)
		f.title:SetText("FlipExport")
		f.info = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
		f.info:SetPoint("TOP", f.title, "BOTTOM", 0, -6)
		local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
		close:SetPoint("TOPRIGHT", -6, -6)
		local scroll = CreateFrame("ScrollFrame", "FlipExportScroll", f, "UIPanelScrollFrameTemplate")
		scroll:SetPoint("TOPLEFT", 20, -56)
		scroll:SetPoint("BOTTOMRIGHT", -40, 20)
		local edit = CreateFrame("EditBox", nil, scroll)
		edit:SetMultiLine(true)
		edit:SetMaxLetters(0)
		edit:SetAutoFocus(false)
		edit:SetFontObject(ChatFontNormal)
		edit:SetWidth(540)
		edit:SetScript("OnEscapePressed", function() f:Hide() end)
		scroll:SetScrollChild(edit)
		f.edit = edit
		tinsert(UISpecialFrames, "FlipExportFrame")
		exportFrame = f
	end
	exportFrame.info:SetText(("Press Ctrl+C, then paste into Forever Flips.  (%d KB, %d KB uncompressed)"):format(
		math.ceil(#text / 1024), math.ceil((rawSize or 0) / 1024)))
	exportFrame.edit:SetText(text)
	exportFrame:Show()
	exportFrame.edit:SetFocus()
	exportFrame.edit:HighlightText()
end

---------------------------------------------------------------------------
-- Skill levels (gathering professions like Fishing, Herbalism and Skinning
-- have no recipe window, so their level is read from the skill list)
---------------------------------------------------------------------------

local function readSkills()
	local out = {}
	if GetNumSkillLines and GetSkillLineInfo then
		-- collapsed headers hide their lines: expand them first
		for _ = 1, 10 do
			local expanded = false
			for i = 1, GetNumSkillLines() do
				local _, isHeader, isExpanded = GetSkillLineInfo(i)
				if isHeader and not isExpanded and ExpandSkillHeader then
					ExpandSkillHeader(i)
					expanded = true
					break
				end
			end
			if not expanded then break end
		end
		for i = 1, GetNumSkillLines() do
			local name, isHeader, _, rank, _, _, max = GetSkillLineInfo(i)
			if name and not isHeader and max and max > 1 then out[#out + 1] = { name, rank or 0, max } end
		end
	elseif GetProfessions and GetProfessionInfo then
		local list = { GetProfessions() }
		for k = 1, 6 do
			if list[k] then
				local name, _, rank, max = GetProfessionInfo(list[k])
				if name then out[#out + 1] = { name, rank or 0, max or 0 } end
			end
		end
	end
	return out
end

local function buildPayload()
	local c = charData()
	local profs = {}
	for _, p in pairs(c.profs) do profs[#profs + 1] = p end
	local vend = {}
	for id, v in pairs(DB.vendor) do vend[#vend + 1] = { id, v.p, v.t } end
	local _, classFile = UnitClass("player")
	return {
		v = 1,
		t = now(),
		build = (GetBuildInfo()),
		char = {
			n = UnitName("player"), r = GetRealmName(), f = UnitFactionGroup("player"),
			c = classFile, l = UnitLevel("player"), g = GetMoney(),
		},
		ah = DB.ah,
		bags = readBags(),
		bank = c.bank,
		profs = profs,
		skills = readSkills(),
		vend = vend,
	}
end

local function export()
	if not LibDeflate then return say("LibDeflate failed to load; the addon files may be incomplete.") end
	local text, rawSize = Core.Encode(buildPayload(), LibDeflate, 3)
	showExport(text, rawSize)
end

local function status()
	local c = charData()
	local t = now()
	local function age(ts) return ts and ("%d min ago"):format(math.floor((t - ts) / 60)) or "never" end
	say("AH scan: %s%s", age(DB.ah and DB.ah.t), DB.ah and (" (%d items)"):format(#DB.ah.i) or "")
	say("bank: %s", age(c.bank and c.bank.t))
	local n = 0
	for name, p in pairs(c.profs) do
		n = n + 1
		say("profession %s %d/%d: %d recipes, %s", name, p.r, p.m, #p.s, age(p.t))
	end
	if n == 0 then say("professions: none yet, open each profession window once.") end
	local v = 0
	for _ in pairs(DB.vendor) do v = v + 1 end
	say("vendor prices remembered: %d items", v)
end

---------------------------------------------------------------------------
-- Events and slash command
---------------------------------------------------------------------------

local frame = CreateFrame("Frame")
local handlers = {}

function handlers.ADDON_LOADED(name)
	if name ~= ADDON then return end
	FlipExportDB = FlipExportDB or {}
	DB = FlipExportDB
	DB.chars = DB.chars or {}
	DB.vendor = DB.vendor or {}
	charKey = (UnitName("player") or "?") .. "-" .. (GetRealmName() or "?")
end

function handlers.AUCTION_HOUSE_SHOW()
	ahOpen = true
	say("type |cffffff00/flip scan|r for a full AH scan.")
end
function handlers.AUCTION_HOUSE_CLOSED() ahOpen = false end

function handlers.REPLICATE_ITEM_LIST_UPDATE()
	if not scanPending then return end
	scanPending = false
	processReplicate()
end

function handlers.BANKFRAME_OPENED() captureBank() end
function handlers.PLAYERBANKSLOTS_CHANGED() if BankFrame and BankFrame:IsShown() then captureBank() end end
function handlers.BANKFRAME_CLOSED() end

function handlers.TRADE_SKILL_SHOW() C_Timer.After(0.5, captureTradeSkill) end
function handlers.TRADE_SKILL_LIST_UPDATE() captureTradeSkill() end
function handlers.TRADE_SKILL_DATA_SOURCE_CHANGED() C_Timer.After(0.5, captureTradeSkill) end
function handlers.CRAFT_SHOW() C_Timer.After(0.5, captureCraft) end
function handlers.CRAFT_UPDATE() captureCraft() end

function handlers.MERCHANT_SHOW() C_Timer.After(0.3, captureMerchant) end
function handlers.MERCHANT_UPDATE() captureMerchant() end

frame:SetScript("OnEvent", function(_, event, ...)
	if event ~= "ADDON_LOADED" and not DB then return end
	local h = handlers[event]
	if h then h(...) end
end)
for event in pairs(handlers) do
	pcall(frame.RegisterEvent, frame, event) -- some events only exist on some clients
end

SLASH_FLIPEXPORT1 = "/flip"
SLASH_FLIPEXPORT2 = "/flipexport"
SlashCmdList.FLIPEXPORT = function(msg)
	local cmd = (msg or ""):lower():match("^%s*(%S*)")
	if cmd == "scan" then startScan()
	elseif cmd == "export" then export()
	elseif cmd == "status" then status()
	else
		say("|cffffff00/flip scan|r (AH open), |cffffff00/flip export|r, |cffffff00/flip status|r")
		say("Open your bank and each profession window once so they're included.")
	end
end
