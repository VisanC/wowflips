-- FlipExport / UI/Main.lua
-- The Forever Flips window: Crafts, Deals, Leveling and Sales, worked out in game from the
-- addon's own scans, Auctionator, TSM (when installed) and Recipe Master's learn levels.
-- Open with /flip or the minimap button.

local _, ns = ...
local W = ns.Widgets
local Data, Prices, Engine, Leveling, Deals, Sales = ns.Data, ns.Prices, ns.Engine, ns.Leveling, ns.Deals, ns.Sales
local C = W.COLOR

local App = { tabs = {}, overrides = {}, statusHooks = {} }
ns.App = App

local DEFAULTS = {
	tab = "crafts", priceDepth = 3, useTsm = true, cut = 0.05,
	crafts = { prof = "mine", scope = "known", craftMode = "known", strategy = "best", profitable = true, hideGathered = false },
	deals = { mode = "vendor", maxPct = 0.7, minProfit = 10000 },
	lvl = { prof = nil, target = nil, pool = "trainer" },
	minimap = { angle = 200, hide = false },
}

local function merge(dst, src)
	for k, v in pairs(src) do
		if type(v) == "table" then
			if type(dst[k]) ~= "table" then dst[k] = {} end
			merge(dst[k], v)
		elseif dst[k] == nil then
			dst[k] = v
		end
	end
	return dst
end

---------------------------------------------------------------------------
-- State: everything the views need, recomputed on Refresh
---------------------------------------------------------------------------

function App.Compute()
	local DB = ns.GetDB()
	local ui = App.ui
	App.data = App.data or Data.Build(ns.GameData)
	local d = App.data
	local char = ns.CharData()
	local ok, skills = pcall(ns.ReadSkills)
	char.skills = ok and skills or char.skills
	Data.ApplyLearnData(d, char, ns.RecipeMasterData)
	Prices.ResetCache()
	if ns.WatchAuctionator then ns.WatchAuctionator() end
	local atr = ns.AuctionatorDB()
	local tsmTime = ns.TsmDataTime and ns.TsmDataTime("AUCTIONDB_NON_COMMODITY_DATA")
	local market = Prices.Build(d, { scan = DB.ah, detail = DB.detail, atr = atr, atrSeen = DB.atrSeen, depth = ui.priceDepth, learnedVendor = DB.vendor, useTsm = ui.useTsm, tsmTime = tsmTime })
	local profs = Data.Professions(d, char)
	local profSkills = {}
	for _, p in pairs(profs) do profSkills[p.skill] = true end
	local known = Data.KnownSpells(char)
	App.state = {
		d = d, char = char, profs = profs, profSkills = profSkills, known = known, market = market, atr = atr,
		tsmTime = tsmTime, faction = UnitFactionGroup and UnitFactionGroup("player") or nil,
		specs = Leveling.KnownSpecs(d, known),
	}
	App.RefreshBags()
	return App.state
end

--- Re-reads the bags (and the bank as last seen): cheap, for the craft button between refreshes.
function App.RefreshBags()
	local s = App.state
	if not s then return end
	local inv, bags = {}, {}
	for _, e in ipairs(ns.ReadBagCounts and ns.ReadBagCounts() or {}) do bags[e[1]] = (bags[e[1]] or 0) + (e[2] or 0) end
	for k, v in pairs(bags) do inv[k] = v end
	for _, e in ipairs((s.char.bank and s.char.bank.i) or {}) do inv[e[1]] = (inv[e[1]] or 0) + (e[2] or 0) end
	s.bags, s.inventory = bags, inv
end

function App.Engine(craftMode, strategy, overrides)
	local s = App.state
	return Engine.New(s.d, s.market, {
		cut = App.ui.cut, craftMode = craftMode or "known", known = s.known, profSkills = s.profSkills,
		strategy = strategy or "best", overrides = overrides,
	})
end

--- With the Auction House open, searches it for the item (Auctionator's search when installed).
function App.SearchItem(id)
	if not (id and id > 0 and ns.IsAuctionHouseOpen()) then return false end
	return ns.SearchAH(Data.ItemName(App.data, id))
end

local function itemText(d, id, name)
	local q = Data.ItemQuality(d, id)
	return W.QualityColor(q) .. (name or Data.ItemName(d, id)) .. "|r"
end

local function profName(d, skill) return d.skills[skill] or ("Skill " .. tostring(skill)) end

---------------------------------------------------------------------------
-- Window
---------------------------------------------------------------------------

local frame

local function createWindow()
	local f = CreateFrame("Frame", "ForeverFlipsFrame", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
	f:SetSize(900, 580)
	f:SetPoint("CENTER")
	f:SetFrameStrata("HIGH")
	f:SetToplevel(true)
	f:SetClampedToScreen(true)
	f:EnableMouse(true)
	f:SetMovable(true)
	f:RegisterForDrag("LeftButton")
	f:SetScript("OnDragStart", function(self)
		App.HideCraftButton()
		self:StartMoving()
	end)
	f:SetScript("OnDragStop", function(self)
		self:StopMovingOrSizing()
		local point, _, rel, x, y = self:GetPoint()
		App.ui.pos = { point, rel, x, y }
		App.PlaceCraftButton()
	end)
	if f.SetBackdrop then
		f:SetBackdrop({
			bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
			tile = true, tileSize = 16, edgeSize = 16, insets = { left = 4, right = 4, top = 4, bottom = 4 },
		})
		f:SetBackdropColor(0.06, 0.06, 0.08, 0.96)
		f:SetBackdropBorderColor(0.45, 0.45, 0.5, 1)
	end
	if App.ui.pos then
		f:ClearAllPoints()
		f:SetPoint(App.ui.pos[1], UIParent, App.ui.pos[2], App.ui.pos[3], App.ui.pos[4])
	end
	tinsert(UISpecialFrames, "ForeverFlipsFrame")

	local title = W.Label(f, "Forever Flips", "GameFontNormalLarge")
	title:SetPoint("TOPLEFT", 16, -14)
	local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
	close:SetPoint("TOPRIGHT", -4, -4)

	-- tabs
	local x = 160
	f.tabButtons = {}
	for _, t in ipairs({ { "crafts", "Crafts" }, { "deals", "Deals" }, { "leveling", "Leveling" }, { "sales", "Sales" } }) do
		local b = W.Button(f, t[2], 90, function() App.Show(t[1]) end)
		b:SetPoint("TOPLEFT", f, "TOPLEFT", x, -12)
		f.tabButtons[t[1]] = b
		x = x + 94
	end

	-- status line and actions
	f.status = W.Label(f, "", "GameFontHighlightSmall")
	f.status:SetPoint("BOTTOMLEFT", 16, 14)
	f.status:SetPoint("RIGHT", f, "RIGHT", -230, 0)
	f.status:SetJustifyH("LEFT")
	if f.status.SetWordWrap then f.status:SetWordWrap(false) end
	local refresh = W.Button(f, "Refresh", 80, function() App.Refresh() end)
	refresh:SetPoint("BOTTOMRIGHT", -14, 10)
	local scan = W.Button(f, "Scan AH", 80, function()
		if ns.Scan and ns.Scan.busy then ns.Scan.Stop()
		elseif IsShiftKeyDown and IsShiftKeyDown() then ns.StartFullScan()
		else ns.StartScan() end
	end)
	scan:SetPoint("RIGHT", refresh, "LEFT", -6, 0)
	scan:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, "Scan the AH", "With the Auction House open: every item's cheapest price and how many are up, as often as you like (about a minute).", "Shift-click: full scan, with the price levels of everything; Blizzard allows one every 15 minutes.", "Click while scanning: stop.") end)
	scan:SetScript("OnLeave", W.HideTooltip)
	f.scanButton = scan

	-- content area
	local content = CreateFrame("Frame", nil, f)
	content:SetPoint("TOPLEFT", 12, -44)
	content:SetPoint("BOTTOMRIGHT", -12, 36)
	f.content = content

	for key, tab in pairs(App.tabs) do
		local panel = CreateFrame("Frame", nil, content)
		panel:SetAllPoints()
		panel:Hide()
		tab.panel = panel
		tab.Create(panel)
		tab.key = key
	end
	f:SetScript("OnShow", function() App.Refresh() end)
	f:SetScript("OnHide", function() App.HideCraftButton() end)
	f:Hide() -- new frames start out shown; Toggle shows it, which refreshes
	return f
end

function App.UpdateStatus()
	if not frame then return end
	local DB, s = ns.GetDB(), App.state
	local parts = {}
	local busy = ns.Scan and ns.Scan.busy
	if busy then
		parts[#parts + 1] = C.accent .. (ns.Scan.progress ~= "" and ns.Scan.progress or "scanning") .. "|r"
	elseif DB.ah and DB.ah.t then
		parts[#parts + 1] = ("AH %s %s (%d items)"):format(DB.ah.kind == "full" and "full scan" or "scan", W.Ago(DB.ah.t), #(DB.ah.i or {}))
	else
		parts[#parts + 1] = C.muted .. "no AH scan yet|r"
	end
	if s and s.atr then parts[#parts + 1] = ("Auctionator: %d newer"):format(s.market.atrCount or 0) end
	parts[#parts + 1] = Prices.TsmAvailable() and (App.ui.useTsm and ("TSM " .. (s and s.tsmTime and W.Ago(s.tsmTime) or "on")) or "TSM: off") or (C.muted .. "TSM: not installed|r")
	parts[#parts + 1] = ns.RecipeMasterData and ("learn levels: Recipe Master " .. (ns.RecipeMasterData.version or "")) or (C.muted .. "learn levels: estimates|r")
	frame.status:SetText(table.concat(parts, "  ·  "))
	frame.scanButton:SetText(busy == "summary" and "Stop scan" or "Scan AH")
	frame.scanButton:SetEnabled(ns.IsAuctionHouseOpen() or busy ~= nil)
	for _, fn in ipairs(App.statusHooks) do pcall(fn, busy) end
end

function App.Show(key)
	App.ui.tab = key or App.ui.tab
	if not frame then return end
	for k, tab in pairs(App.tabs) do
		if k == App.ui.tab then tab.panel:Show() else tab.panel:Hide() end
		local b = frame.tabButtons[k]
		if b then
			if k == App.ui.tab then b:LockHighlight() else b:UnlockHighlight() end
		end
	end
	local tab = App.tabs[App.ui.tab]
	if tab and App.state then
		local ok, err = xpcall(tab.Update, function(e) return tostring(e) end)
		if not ok then ns.Say("|cffff4040%s view failed:|r %s", App.ui.tab, err) end
	end
	App.PlaceCraftButton()
end

function App.Refresh()
	if not frame or not frame:IsShown() then return end
	local ok, err = xpcall(App.Compute, function(e) return tostring(e) end)
	if not ok then
		ns.Say("|cffff4040could not work out prices:|r %s", err)
		return
	end
	App.UpdateStatus()
	App.Show()
end

function App.Toggle()
	frame = frame or createWindow()
	if frame:IsShown() then frame:Hide() else frame:Show() end
end

--- Called by the capture code when new data arrives (scan done, mail read, recipes seen):
--- one refresh a second after the last of a burst.
local generation = 0
function App.DataChanged()
	if not (frame and frame:IsShown()) then return end
	generation = generation + 1
	local mine = generation
	-- once things settle (an Auctionator scan records thousands of prices): 1 s after the last change
	C_Timer.After(1, function()
		if mine == generation then App.Refresh() end
	end)
end

---------------------------------------------------------------------------
-- Craft button
---------------------------------------------------------------------------
-- A click crafts all of the queue's next step at once; when its profession window isn't open,
-- the click opens it instead (a second click crafts). Casting the profession spell needs a
-- secure button, so this one sits on UIParent over a placeholder in the window: anchored to the
-- window, it would make the window protected (not movable or closable in combat).

local PROFESSION_SPELL = { [171] = 2259, [164] = 2018, [333] = 7411, [202] = 4036, [165] = 2108, [197] = 3908, [185] = 2550, [129] = 3273, [186] = 2656 }
local PROFESSION_SPELL_NAME = { [186] = "Smelting" } -- Mining crafts in the Smelting window

local function spellName(id)
	if C_Spell and C_Spell.GetSpellName then
		local n = C_Spell.GetSpellName(id)
		if n then return n end
	end
	return GetSpellInfo and (GetSpellInfo(id)) or nil
end

--- The spell that opens a profession's window (by skill line).
function App.ProfessionSpell(skill)
	local id = PROFESSION_SPELL[skill]
	return (id and spellName(id)) or PROFESSION_SPELL_NAME[skill] or (App.data and App.data.skills[skill])
end

--- Seconds one craft of a recipe takes: its cast time (from the game) plus a moment before the
--- next cast starts. nil when the game doesn't say.
local CRAFT_GAP = 0.5
local castTimes = {}
function App.CraftSeconds(spell)
	local v = castTimes[spell]
	if v then return v end
	local ms
	if C_Spell and C_Spell.GetSpellInfo then
		local info = C_Spell.GetSpellInfo(spell)
		ms = info and info.castTime
	end
	if ms == nil and GetSpellInfo then ms = select(4, GetSpellInfo(spell)) end
	if type(ms) ~= "number" or ms < 0 then return nil end -- not loaded yet: ask again next time
	v = ms / 1000 + CRAFT_GAP
	castTimes[spell] = v
	return v
end

local craftButton
local function inCombat() return InCombatLockdown and InCombatLockdown() end

--- The queue's next step and whether its window must be opened first: step, why, spellToOpen.
function App.NextCraft()
	if not App.state then App.Compute() else App.RefreshBags() end
	local step, why = App.tabs.crafts.NextStep()
	local open = step and not ns.ProfessionOpenFor(step.recipe.spell) and App.ProfessionSpell(step.recipe.skill) or nil
	return step, why, open
end

local function craftLabel()
	local ok, step, _, open = pcall(App.NextCraft)
	if not ok or not step then return "Craft next" end
	if open then return "Open " .. open end
	return ("Craft %d x %s"):format(step.count, step.recipe.name)
end

local function createCraftButton()
	local b = CreateFrame("Button", "ForeverFlipsCraftButton", UIParent, "UIPanelButtonTemplate, SecureActionButtonTemplate")
	b:SetSize(210, 22)
	b:Hide()
	b:RegisterForClicks((GetCVarBool and GetCVarBool("ActionButtonUseKeyDown")) and "LeftButtonDown" or "LeftButtonUp")
	b:SetText("Craft next")
	b:SetScript("PreClick", function(self)
		self.step, self.why, self.opening = nil, nil, nil
		if inCombat() then return end
		local ok, step, why, open = pcall(App.NextCraft)
		if not ok then self.why = tostring(step) return end
		self.step, self.why, self.opening = step, why, open
		-- the secure click casts the profession spell when there is one to open
		self:SetAttribute("type", open and "spell" or nil)
		self:SetAttribute("spell", open)
	end)
	b:SetScript("PostClick", function(self)
		if inCombat() then return ns.Say("not in combat.") end
		if self.opening then
			ns.Say("opening %s: click again to craft %d x %s.", self.opening, self.step.count, self.step.recipe.name)
		else
			App.tabs.crafts.CraftStep(self.step, self.why)
		end
		C_Timer.After(0.5, App.CraftButtonChanged)
	end)
	b:SetScript("OnEnter", function(self)
		local ok, step, why, open = pcall(App.NextCraft)
		if ok and step then
			W.ShowTextTooltip(self, "Craft next", ("%d x %s (%s), all of it at once%s."):format(step.count, step.recipe.name, profName(App.state.d, step.recipe.skill), step.count < step.need and (", " .. step.need .. " needed") or ""),
				open and ("First click opens " .. open .. ", the next crafts.") or "Parts come first; then the next step.")
		else
			W.ShowTextTooltip(self, "Craft next", (ok and why) or "Crafts the queue, a step per click.")
		end
	end)
	b:SetScript("OnLeave", W.HideTooltip)
	local events = CreateFrame("Frame")
	events:RegisterEvent("PLAYER_REGEN_DISABLED")
	events:RegisterEvent("PLAYER_REGEN_ENABLED")
	events:SetScript("OnEvent", function(_, event)
		-- secure frames can still be hidden as combat starts, not during it
		if event == "PLAYER_REGEN_DISABLED" then b:Hide() else App.PlaceCraftButton() end
	end)
	craftButton = b
	return b
end

--- Puts the craft button over its place in the window (when that is showing), else hides it.
function App.PlaceCraftButton()
	if not craftButton or inCombat() then return end
	local slot = App.craftSlot
	if frame and frame:IsShown() and slot and slot:IsVisible() then
		local l, b, w, h = slot:GetRect()
		if l then
			craftButton:SetScale(slot:GetEffectiveScale() / UIParent:GetEffectiveScale())
			craftButton:ClearAllPoints()
			craftButton:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", l, b)
			craftButton:SetSize(w, h)
			craftButton:SetFrameStrata("DIALOG")
			craftButton:SetText(craftLabel())
			craftButton:Show()
		else
			C_Timer.After(0, App.PlaceCraftButton) -- not laid out yet
		end
		return
	end
	craftButton:Hide()
end

function App.HideCraftButton()
	if craftButton and not inCombat() then craftButton:Hide() end
end

--- The profession window opened or closed, or the bags changed: new label (a burst: once).
local labelPending
function App.CraftButtonChanged()
	if not (craftButton and craftButton:IsShown()) or labelPending then return end
	labelPending = true
	C_Timer.After(0.2, function()
		labelPending = false
		if craftButton:IsShown() then craftButton:SetText(craftLabel()) end
	end)
end

---------------------------------------------------------------------------
-- Crafts
---------------------------------------------------------------------------

local REASON = {
	cheaper = "cheaper", ["tie-craft"] = "same price: crafting from the raw material", ["tie-buy"] = "same price",
	plan = "your choice", ["no-recipe"] = "no recipe you can use", ["not-sold"] = "not on the AH", ["no-price"] = "no price anywhere",
}

local function sourceText(s, d)
	if s.kind == "ah" then return "Buy (AH)" end
	if s.kind == "vendor" then return "Buy (vendor)" end
	if s.kind == "craft" then return "Craft" end
	return C.bad .. "no price|r"
end

App.tabs.crafts = {}
do
	local T = App.tabs.crafts
	local list, plan, queueList, shopList, planTitle, controls, viewButtons, queueButtons, actionButtons

	--- The craft queue: { [spell] = count }, kept per character.
	local function queue()
		local c = App.state.char
		c.queue = c.queue or {}
		return c.queue
	end

	local function queuedCount()
		local n = 0
		for _, v in pairs(queue()) do n = n + v end
		return n
	end

	function T.AddToQueue(r, n)
		if not r or r.gather then return end
		local q = queue()
		q[r.spell] = math.max(0, (q[r.spell] or 0) + n)
		if q[r.spell] == 0 then q[r.spell] = nil end
		T.Update()
	end

	function T.Create(p)
		local ui = App.ui.crafts
		local function upd() T.Update() end
		local profChoice = W.Cycle(p, "", 150, function()
			local out = { { "mine", "All my professions" } }
			local names = {}
			for name in pairs((App.state and App.state.profs) or {}) do names[#names + 1] = name end
			table.sort(names)
			for _, n in ipairs(names) do out[#out + 1] = { n, n } end
			return out
		end, function() return ui.prof end, function(v) ui.prof = v upd() end, "Profession")
		profChoice:SetPoint("TOPLEFT", 0, 0)
		local scope = W.Cycle(p, "", 170, function() return { { "known", "Recipes I know" }, { "profession", "All in my professions" }, { "all", "Every recipe" } } end,
			function() return ui.scope end, function(v) ui.scope = v upd() end, "Which recipes to list")
		scope:SetPoint("LEFT", profChoice, "RIGHT", 6, 0)
		local sub = W.Cycle(p, "Parts: ", 190, function() return { { "known", "my recipes" }, { "profession", "my professions" }, { "none", "always buy" } } end,
			function() return ui.craftMode end, function(v) ui.craftMode = v App.overrides = {} upd() end, "Which recipes may make the parts (bars, tubes...)")
		sub:SetPoint("LEFT", scope, "RIGHT", 6, 0)
		local strat = W.Cycle(p, "", 130, function() return { { "best", "Best mix" }, { "buy", "Buy all parts" }, { "craft", "Craft all parts" } } end,
			function() return ui.strategy end, function(v) ui.strategy = v App.overrides = {} upd() end, "Buy or craft the parts")
		strat:SetPoint("LEFT", sub, "RIGHT", 6, 0)
		local prof = W.Check(p, "Profitable only", function() return ui.profitable end, function(v) ui.profitable = v upd() end)
		prof:SetPoint("LEFT", strat, "RIGHT", 6, 0)
		local gath = W.Check(p, "Hide gathered", function() return ui.hideGathered end, function(v) ui.hideGathered = v upd() end,
			"Gathered items are listed as free 'recipes': what you get for selling what you mine, pick, skin or fish.")
		gath:SetPoint("LEFT", prof.label, "RIGHT", 10, -1)
		controls = { profChoice, scope, sub, strat, prof, gath }

		list = W.List(p, {
			{ label = "Craft", width = 210, icon = function(r) return W.ItemIcon(r.e.recipe.out) end, text = function(r)
				local rec = r.e.recipe
				local tag = rec.gather and (C.muted .. (rec.bonus and " bonus" or " gathered") .. "|r") or ""
				local q = not rec.gather and queue()[rec.spell]
				return itemText(App.state.d, rec.out, rec.gather and Data.ItemName(App.state.d, rec.out) or rec.name) .. (rec.qty > 1 and (" x" .. rec.qty) or "") .. tag .. (q and (C.accent .. " [" .. q .. "]|r") or "")
			end, sort = function(r) return r.e.recipe.name end },
			{ label = "Profession", width = 85, text = function(r) return profName(App.state.d, r.e.recipe.skill) end, sort = function(r) return profName(App.state.d, r.e.recipe.skill) end },
			{ label = "Cost", width = 80, align = "RIGHT", text = function(r) return r.e.complete and W.Money(r.e.cost, true) or (C.bad .. "missing price|r") end, sort = function(r) return r.e.complete and r.e.cost or nil end },
			{ label = "Sells for", width = 80, align = "RIGHT", text = function(r) return W.Money(r.e.revenue, true) .. (r.e.channel == "vendor" and (C.muted .. " v|r") or "") end, sort = function(r) return r.e.revenue end, tip = "Per craft: the AH price after the 5% cut, or what a vendor pays (v) when that is more" },
			{ label = "Profit", width = 85, align = "RIGHT", text = function(r) return r.e.complete and W.Money(r.e.profit, true) or "-" end, sort = function(r) return r.e.complete and r.e.profit or nil end },
			{ label = "%", width = 50, align = "RIGHT", text = function(r) return r.e.complete and r.e.cost > 0 and W.Pct(r.e.margin) or "-" end, sort = function(r) return r.e.complete and r.e.cost > 0 and r.e.margin or nil end },
			{ label = "Sold/day", width = 60, align = "RIGHT", text = function(r) return r.sales and r.sales.soldPerDay and W.Num(r.sales.soldPerDay, 1) or "-" end, sort = function(r) return r.sales and r.sales.soldPerDay end, tip = "TSM: how many sell per day per auction house in the region" },
			{ label = "On AH", width = 50, align = "RIGHT", text = function(r) return r.e.ahUnit and tostring(r.e.ahQty) or "-" end, sort = function(r) return r.e.ahQty end },
			{ label = "Can make", width = 55, align = "RIGHT", text = function(r) return r.e.recipe.gather and "-" or tostring(r.e.craftableNow) end, sort = function(r) return r.e.craftableNow end, tip = "From what is in your bags and bank (direct reagents)" },
		}, {
			sortBy = 5,
			onClick = function(row, button)
				if button == "RightButton" then
					T.AddToQueue(row.e.recipe, IsShiftKeyDown and IsShiftKeyDown() and 5 or 1)
				else
					App.SearchItem(row.e.recipe.out)
					T.Select(row)
				end
			end,
			onEnter = function(f, row)
				W.ShowItemTooltip(f, row.e.recipe.out)
				if GameTooltip and not row.e.recipe.gather then GameTooltip:AddLine("Click: plan (and AH search when open). Right-click: queue 1, shift: 5", 0.3, 0.8, 1) GameTooltip:Show() end
			end,
		})
		list:SetPoint("TOPLEFT", 0, -30)
		list:SetPoint("RIGHT", p, "RIGHT", 0, 0)
		list:SetHeight(280)

		-- bottom: Plan | Queue | Shopping list
		viewButtons = {}
		local vx = 0
		for _, v in ipairs({ { "plan", "Plan" }, { "queue", "Queue" }, { "shop", "Shopping list" } }) do
			local b = W.Button(p, v[2], v[1] == "shop" and 110 or 80, function() ui.view = v[1] T.Update() end)
			b:SetPoint("TOPLEFT", list, "BOTTOMLEFT", vx, -6)
			viewButtons[v[1]] = b
			vx = vx + (v[1] == "shop" and 114 or 84)
		end
		-- two small lines beside the view buttons
		planTitle = W.Label(p, "", "GameFontNormalSmall")
		planTitle:SetPoint("TOPLEFT", list, "BOTTOMLEFT", vx + 8, -3)
		planTitle:SetPoint("RIGHT", p, "RIGHT", -310, 0)
		planTitle:SetHeight(28)
		planTitle:SetJustifyH("LEFT")
		if planTitle.SetJustifyV then planTitle:SetJustifyV("MIDDLE") end
		if planTitle.SetWordWrap then planTitle:SetWordWrap(true) end
		if planTitle.SetMaxLines then planTitle:SetMaxLines(2) end

		-- queue buttons for the selected recipe (plan view)
		queueButtons = {}
		local qx = 0
		for _, n in ipairs({ 20, 5, 1 }) do
			local b = W.Button(p, "Queue +" .. n, 80, function() T.AddToQueue(T.selected, n) end)
			b:SetPoint("TOPRIGHT", list, "BOTTOMRIGHT", qx, -6)
			queueButtons[#queueButtons + 1] = b
			qx = qx - 84
		end
		-- actions for the queue and shopping views
		actionButtons = {}
		local clear = W.Button(p, "Clear queue", 90, function() wipe(queue()) T.Update() end)
		clear:SetPoint("TOPRIGHT", list, "BOTTOMRIGHT", 0, -6)
		-- where the craft button goes (the button itself is secure and sits on UIParent: App.PlaceCraftButton)
		local craft = CreateFrame("Frame", nil, p)
		craft:SetSize(210, 22)
		craft:SetPoint("RIGHT", clear, "LEFT", -4, 0)
		App.craftSlot = craft
		local toAtr = W.Button(p, "To Auctionator", 120, function() T.SendToAuctionator() end)
		toAtr:SetPoint("TOPRIGHT", list, "BOTTOMRIGHT", 0, -6)
		toAtr:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, "Auctionator shopping list", "Makes (or replaces) the 'Forever Flips' list in Auctionator's Shopping tab with these items and amounts.") end)
		toAtr:SetScript("OnLeave", W.HideTooltip)
		local checkShop = W.Button(p, "Check AH", 90, function() T.CheckShopping() end)
		checkShop:SetPoint("RIGHT", toAtr, "LEFT", -4, 0)
		checkShop:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, "Check AH prices", "Searches the AH for each item to buy, so the costs walk the real listings. AH must be open.") end)
		checkShop:SetScript("OnLeave", W.HideTooltip)
		actionButtons.queue = { clear, craft }
		actionButtons.shop = { toAtr, checkShop }

		local function bottom(l, below)
			l:SetPoint("TOPLEFT", below, "BOTTOMLEFT", 0, -34)
			l:SetPoint("BOTTOMRIGHT", p, "BOTTOMRIGHT", 0, 0)
		end
		plan = W.List(p, {
			{ label = "Part", width = 250, icon = function(r) return W.ItemIcon(r.item) end, text = function(r) return string.rep("   ", r.depth) .. itemText(App.state.d, r.item) end },
			{ label = "Qty", width = 45, align = "RIGHT", text = function(r) return W.Num(r.count, r.count % 1 == 0 and 0 or 1) end },
			{ label = "Each", width = 80, align = "RIGHT", text = function(r) return W.Money(r.source.unit) end },
			{ label = "Total", width = 85, align = "RIGHT", text = function(r) return W.Money(r.source.unit * r.count) end },
			{ label = "How", width = 90, text = function(r) return sourceText(r.source) end },
			{ label = "Why", width = 260, text = function(r) return r.why end },
		}, {
			onClick = function(row, button)
				if button == "RightButton" or not App.SearchItem(row.item) then T.Flip(row) end
			end,
			onEnter = function(f, row)
				W.ShowItemTooltip(f, row.item)
				if GameTooltip and row.flippable then
					GameTooltip:AddLine((ns.IsAuctionHouseOpen() and "Right-click: " or "Click: ") .. (row.source.kind == "craft" and "buy it instead" or "craft it instead"), 0.3, 0.8, 1)
					GameTooltip:Show()
				end
			end,
		})
		bottom(plan, list)

		queueList = W.List(p, {
			{ label = "Craft", width = 250, icon = function(q) return W.ItemIcon(q.recipe.out) end, text = function(q) return itemText(App.state.d, q.recipe.out, q.recipe.name) .. (q.queued and "" or (C.muted .. "  (part)|r")) end },
			{ label = "Profession", width = 90, text = function(q) return profName(App.state.d, q.recipe.skill) end },
			{ label = "Queued", width = 55, align = "RIGHT", text = function(q) return q.queued and tostring(q.queued) or "-" end, tip = "What you queued; parts are worked out from it" },
			{ label = "To craft", width = 60, align = "RIGHT", text = function(q) return tostring(q.count) end, tip = "Crafts still needed after what you have" },
			{ label = "Can now", width = 60, align = "RIGHT", text = function(q) return tostring(math.min(q.count, ns.Queue.CraftableFrom(q.recipe, App.state.bags))) end, tip = "From what is in your bags" },
			{ label = "Profit", width = 85, align = "RIGHT", text = function(q) return q.profit and W.Money(q.profit, true) or "-" end, tip = "For the queued amount, at today's prices" },
			{ label = "Time", width = 65, align = "RIGHT", text = function(q) return W.Duration(q.seconds) end, tip = "Crafting this step: cast time of each craft (plus a moment between casts) x crafts to do" },
			{ label = "Done in", width = 70, align = "RIGHT", text = function(q) return q.seconds and (W.Duration(q.doneAt) .. (q.doneAtUnsure and "+" or "")) or "-" end, tip = "From the first step to the end of this one; the last row is the whole queue" },
		}, {
			onClick = function(q, button)
				if button == "RightButton" then
					if q.queued then T.AddToQueue(q.recipe, (IsShiftKeyDown and IsShiftKeyDown()) and -q.queued or -1) end
				else
					App.SearchItem(q.recipe.out)
				end
			end,
			onEnter = function(f, q)
				W.ShowItemTooltip(f, q.recipe.out)
				if GameTooltip and q.queued then GameTooltip:AddLine("Right-click: one less, shift: remove", 0.3, 0.8, 1) GameTooltip:Show() end
			end,
		})
		bottom(queueList, list)

		shopList = W.List(p, {
			{ label = "Item", width = 250, icon = function(b) return W.ItemIcon(b.item) end, text = function(b) return itemText(App.state.d, b.item) end },
			{ label = "Need", width = 55, align = "RIGHT", text = function(b) return tostring(b.need) end, sort = function(b) return b.need end },
			{ label = "Have", width = 55, align = "RIGHT", text = function(b) return tostring(b.have) end, sort = function(b) return b.have end, tip = "Bags and bank" },
			{ label = "Buy", width = 55, align = "RIGHT", text = function(b) return C.accent .. b.qty .. "|r" end, sort = function(b) return b.qty end },
			{ label = "Where", width = 70, text = function(b) return b.kind == "ah" and "AH" or b.kind == "vendor" and "Vendor" or (C.bad .. "no price|r") end, sort = function(b) return b.kind end },
			{ label = "About", width = 90, align = "RIGHT", text = function(b) return W.Money(b.cost, true) end, sort = function(b) return b.cost end, tip = "Walking the cheapest listings for that amount" },
		}, {
			sortBy = 6,
			onClick = function(b) App.SearchItem(b.item) end,
			onEnter = function(f, b) W.ShowItemTooltip(f, b.item) end,
		})
		bottom(shopList, list)
	end

	local function recipesFor(s, ui)
		local out = {}
		local function wanted(r)
			if ui.prof ~= "mine" and profName(s.d, r.skill) ~= ui.prof then return false end
			if ui.scope == "known" then return s.known[r.spell] or false end
			if ui.scope == "profession" then return s.profSkills[r.skill] or false end
			return true
		end
		for _, r in ipairs(s.d.recipes) do
			if wanted(r) and s.d.items[r.out] then out[#out + 1] = r end
		end
		if not ui.hideGathered then
			for _, g in ipairs(Data.GathersFor(s.d, s.profs, ui.scope)) do
				if ui.prof == "mine" or profName(s.d, g.skill) == ui.prof then out[#out + 1] = g end
			end
		end
		return out
	end

	local function planRows(engine, parts, depth, mult, out)
		for _, part in ipairs(parts) do
			local ex = engine:Explain(part.item, part.source)
			local count = part.count * mult
			out[#out + 1] = {
				item = part.item, count = count, source = part.source, depth = depth,
				why = (ex.reason and REASON[ex.reason] or "") .. ((ex.saving or 0) > 0.5 and (" (saves " .. W.Money(ex.saving) .. " each)") or ""),
				flippable = ex.craft ~= nil and ex.buy.unit ~= math.huge,
			}
			if part.source.kind == "craft" then planRows(engine, part.source.parts, depth + 1, count / part.source.recipe.qty, out) end
		end
		return out
	end

	function T.Select(row)
		T.selected = row and row.e.recipe or nil
		list.selected = row
		App.ui.crafts.view = "plan"
		list:Update()
		T.ShowBottom()
	end

	function T.Flip(row)
		if not row.flippable then return end
		App.overrides[row.item] = row.source.kind == "craft" and "buy" or "craft"
		T.Update()
	end

	--- The queue expanded: crafts (parts first) and the shopping list.
	function T.Expanded()
		local s, ui = App.state, App.ui.crafts
		local engine = App.Engine(ui.craftMode, ui.strategy, App.overrides)
		local entries = {}
		for spell, n in pairs(queue()) do
			local r = s.d.bySpell[spell]
			if r and n > 0 then entries[#entries + 1] = { recipe = r, count = n } end
		end
		table.sort(entries, function(a, b) return a.recipe.name < b.recipe.name end)
		local x = ns.Queue.Expand(engine, entries, s.inventory)
		for _, c in ipairs(x.crafts) do
			c.queued = queue()[c.recipe.spell]
			if c.queued then
				local e = engine:Evaluate(c.recipe)
				c.profit = e.complete and e.profit * c.queued or nil
			end
		end
		return x
	end

	function T.ShowBottom()
		local ui = App.ui.crafts
		local view = ui.view or "plan"
		local n = queuedCount()
		viewButtons.queue:SetText(n > 0 and ("Queue (" .. n .. ")") or "Queue")
		for k, b in pairs(viewButtons) do if k == view then b:LockHighlight() else b:UnlockHighlight() end end
		plan:Hide() queueList:Hide() shopList:Hide()
		for _, b in ipairs(queueButtons) do b:Hide() end
		for _, group in pairs(actionButtons) do for _, b in ipairs(group) do b:Hide() end end

		if view == "plan" then
			plan:Show()
			local r = T.selected
			if not r then
				planTitle:SetText(C.muted .. "Click a craft to see how each part is got, and why.|r")
				plan:SetData({}, "")
				return
			end
			if not r.gather then for _, b in ipairs(queueButtons) do b:Show() end end
			local engine = App.Engine(ui.craftMode, ui.strategy, App.overrides)
			local e = engine:Evaluate(r, App.state.inventory)
			planTitle:SetText(("%s\ncost %s · sells %s · profit %s"):format(
				itemText(App.state.d, r.out, r.gather and nil or r.name), W.Money(e.cost, true), W.Money(e.revenue, true), e.complete and W.Money(e.profit, true) or "-"))
			plan:SetData(planRows(engine, e.parts, 0, 1, {}), r.gather and "Gathered: nothing to buy." or "No parts.")
		elseif view == "queue" then
			queueList:Show()
			for _, b in ipairs(actionButtons.queue) do b:Show() end
			local x = T.Expanded()
			local profit, crafts, total, unknown = 0, 0, 0, false
			for _, c in ipairs(x.crafts) do
				profit = profit + (c.profit or 0)
				crafts = crafts + c.count
				-- time for this step, and from the start of the queue to its end
				local each = App.CraftSeconds(c.recipe.spell)
				c.seconds = each and each * c.count or nil
				if each then total = total + c.seconds else unknown = true end
				c.doneAt = total
				c.doneAtUnsure = unknown
			end
			planTitle:SetText(#x.crafts > 0 and ("%d crafts, about %s%s\nbuy about %s · profit about %s"):format(crafts, W.Duration(total), unknown and "+" or "", W.Money(x.total, true), W.Money(profit, true)) or (C.muted .. "Right-click a craft above to queue it.|r"))
			queueList:SetData(x.crafts, "The queue is empty. Right-click a craft above, or use Queue +1 in its plan.")
		else
			shopList:Show()
			for _, b in ipairs(actionButtons.shop) do b:Show() end
			local x = T.Expanded()
			planTitle:SetText(#x.buy > 0 and (("%d items to buy\nabout %s"):format(#x.buy, W.Money(x.total, true)) .. (x.missing > 0 and (C.bad .. ", " .. x.missing .. " without a price|r") or "")) or (C.muted .. "Nothing to buy.|r"))
			shopList:SetData(x.buy, next(queue()) and "You have everything for the queue." or "Queue crafts to get a shopping list.")
		end
		App.PlaceCraftButton()
	end

	--- The next step of the queue to craft: the first (parts first) your bags have the reagents
	--- for, with all of it you can make now. Or nil and why not.
	function T.NextStep()
		local x = T.Expanded()
		local bags = App.state.bags
		for _, c in ipairs(x.crafts) do
			local n = math.min(c.count, ns.Queue.CraftableFrom(c.recipe, bags))
			if n > 0 then return { recipe = c.recipe, count = n, need = c.count } end
		end
		return nil, #x.crafts > 0 and "nothing in the queue can be made from your bags yet: see the shopping list." or "the queue is empty."
	end

	--- Crafts all of a step at once (like Create All, capped at what the queue needs).
	function T.CraftStep(step, why)
		if not step then return ns.Say(why or "the queue is empty.") end
		if UnitCastingInfo and UnitCastingInfo("player") then return ns.Say("still crafting; click again when it's done.") end
		local ok, err = ns.CraftRecipe(step.recipe.spell, step.count)
		if ok then
			ns.Say("crafting %d x %s%s", step.count, step.recipe.name, step.count < step.need and (" (%d more once you have the reagents)"):format(step.need - step.count) or "")
		else
			ns.Say("%s: %s (%s)", step.recipe.name, err or "could not craft", profName(App.state.d, step.recipe.skill))
		end
	end

	function T.CraftNext() T.CraftStep(T.NextStep()) end

	function T.CheckShopping()
		if ns.Scan.busy == "listings" then return ns.Scan.Stop() end
		if not ns.IsAuctionHouseOpen() then return ns.Say("open the Auction House first.") end
		local ids = {}
		for _, b in ipairs(T.Expanded().buy) do if b.kind ~= "vendor" then ids[#ids + 1] = b.item end end
		if #ids == 0 then return ns.Say("nothing to buy on the AH.") end
		if not ns.Scan.Listings(ids, nil, function(n) ns.Say("checked the AH for %d items.", n) end) then ns.Say("busy: %s", ns.Scan.progress) end
	end

	function T.SendToAuctionator()
		local x = T.Expanded()
		local items = {}
		for _, b in ipairs(x.buy) do
			if b.kind == "ah" then items[#items + 1] = { Data.ItemName(App.state.d, b.item), b.qty } end
		end
		if #items == 0 then return ns.Say("nothing to buy on the AH.") end
		local name, err = ns.AuctionatorShoppingList(items)
		if name then ns.Say("Auctionator shopping list '%s': %d items. Open its Shopping tab at the AH.", name, #items) else ns.Say("could not make the Auctionator list: %s", err or "?") end
	end

	function T.Update()
		local s, ui = App.state, App.ui.crafts
		for _, c in ipairs(controls) do c:Refresh() end
		local engine = App.Engine(ui.craftMode, ui.strategy, App.overrides)
		local rows = {}
		for _, r in ipairs(recipesFor(s, ui)) do
			local e = engine:Evaluate(r, s.inventory)
			if not ui.profitable or (e.complete and e.profit > 0) then
				rows[#rows + 1] = { e = e, sales = Prices.Sales(r.out) }
			end
		end
		local empty = next(s.known) == nil and "No recipes known yet: open each profession window once." or "Nothing here. Try 'Profitable only' off, or scan the AH."
		list:SetData(rows, empty)
		if T.selected then
			for _, row in ipairs(rows) do if row.e.recipe == T.selected then list.selected = row end end
		end
		list:Update()
		T.ShowBottom()
	end
end

---------------------------------------------------------------------------
-- Deals
---------------------------------------------------------------------------

App.tabs.deals = {}
do
	local T = App.tabs.deals
	local flips, market, controls, note

	function T.Create(p)
		local ui = App.ui.deals
		local mode = W.Cycle(p, "", 150, function() return { { "vendor", "Vendor flips" }, { "market", "Under market" } } end,
			function() return ui.mode end, function(v) ui.mode = v T.Update() end,
			"Vendor flips: listings below what a vendor pays. Under market: listings well below the usual price.")
		mode:SetPoint("TOPLEFT", 0, 0)
		local pct = W.Cycle(p, "At most ", 140, function() return { { 0.5, "50% of usual" }, { 0.6, "60% of usual" }, { 0.7, "70% of usual" }, { 0.8, "80% of usual" } } end,
			function() return ui.maxPct end, function(v) ui.maxPct = v T.Update() end, "Under market: how cheap a listing must be")
		pct:SetPoint("LEFT", mode, "RIGHT", 6, 0)
		local minp = W.Cycle(p, "Profit ", 120, function() return { { 0, "any" }, { 1000, "10s+" }, { 10000, "1g+" }, { 50000, "5g+" }, { 200000, "20g+" } } end,
			function() return ui.minProfit end, function(v) ui.minProfit = v T.Update() end, "Least total profit for the cheap listings")
		minp:SetPoint("LEFT", pct, "RIGHT", 6, 0)
		local check = W.Button(p, "Check listings", 120, function() T.CheckListings(false) end)
		check:SetPoint("TOPRIGHT", 0, 0)
		check:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, "Check listings", "Searches the AH for each deal shown (the top " .. T.CHECK_MAX .. ") and counts every listing at the good price. AH must be open; about a second an item.", "Click while checking: stop.") end)
		check:SetScript("OnLeave", W.HideTooltip)
		App.statusHooks[#App.statusHooks + 1] = function(busy) check:SetText(busy == "listings" and "Stop checking" or "Check listings") end
		note = W.Label(p, "", "GameFontDisableSmall")
		note:SetPoint("LEFT", minp, "RIGHT", 10, 0)
		note:SetPoint("RIGHT", check, "LEFT", -6, 0)
		note:SetJustifyH("LEFT")
		if note.SetWordWrap then note:SetWordWrap(false) end
		controls = { mode, pct, minp }

		local function srcTag(src) return src == "auctionator" and (C.muted .. " A|r") or src == "tsm" and (C.muted .. " T|r") or "" end
		local UNITS_TIP = "How many are at the good price. Green: every listing counted (Check listings). +: maybe more; only the cheapest listings are known"
		local function units(r)
			if r.checked then return C.good .. r.units .. (r.more and "+" or "") .. "|r" end
			return r.units .. (r.more and "+" or "")
		end
		flips = W.List(p, {
			{ label = "Item", width = 260, icon = function(r) return W.ItemIcon(r.item) end, text = function(r) return itemText(App.state.d, r.item) end, sort = function(r) return Data.ItemName(App.state.d, r.item) end },
			{ label = "Cheapest", width = 90, align = "RIGHT", text = function(r) return W.Money(r.price) .. srcTag(r.src) end, sort = function(r) return r.price end, tip = "A = from Auctionator, T = from TSM; else your own scan" },
			{ label = "Vendor pays", width = 90, align = "RIGHT", text = function(r) return W.Money(r.vendor) end, sort = function(r) return r.vendor end },
			{ label = "Units", width = 60, align = "RIGHT", text = units, sort = function(r) return r.units end, tip = UNITS_TIP },
			{ label = "Profit", width = 100, align = "RIGHT", text = function(r) return W.Money(r.profit) end, sort = function(r) return r.profit end, tip = "Buying the cheap units and selling them to a vendor" },
		}, { sortBy = 5, onClick = function(row) App.SearchItem(row.item) end, onEnter = function(f, row) W.ShowItemTooltip(f, row.item) end })
		flips:SetPoint("TOPLEFT", 0, -30)
		flips:SetPoint("BOTTOMRIGHT", 0, 0)

		market = W.List(p, {
			{ label = "Item", width = 230, icon = function(r) return W.ItemIcon(r.item) end, text = function(r) return itemText(App.state.d, r.item) end, sort = function(r) return Data.ItemName(App.state.d, r.item) end },
			{ label = "Cheapest", width = 85, align = "RIGHT", text = function(r) return W.Money(r.price) .. srcTag(r.src) end, sort = function(r) return r.price end },
			{ label = "Usual", width = 85, align = "RIGHT", text = function(r) return W.Money(r.reference) .. (r.refSrc == "auctionator" and (C.muted .. " A|r") or "") end, sort = function(r) return r.reference end, tip = "TSM's region average sale price (or market value); A = median of Auctionator's daily lows over two weeks" },
			{ label = "%", width = 45, align = "RIGHT", text = function(r) return ("%d%%"):format(math.floor(r.pct * 100 + 0.5)) end, sort = function(r) return r.pct end },
			{ label = "Units", width = 50, align = "RIGHT", text = units, sort = function(r) return r.units end, tip = UNITS_TIP },
			{ label = "Profit", width = 90, align = "RIGHT", text = function(r) return W.Money(r.profit) end, sort = function(r) return r.profit end, tip = "Reselling them at the usual price, after the AH cut" },
			{ label = "Sold/day", width = 60, align = "RIGHT", text = function(r) return r.soldPerDay and W.Num(r.soldPerDay, 1) or "-" end, sort = function(r) return r.soldPerDay end },
		}, { sortBy = 6, onClick = function(row) App.SearchItem(row.item) end, onEnter = function(f, row) W.ShowItemTooltip(f, row.item) end })
		market:SetPoint("TOPLEFT", 0, -30)
		market:SetPoint("BOTTOMRIGHT", 0, 0)
	end

	T.CHECK_MAX = 40

	--- Searches the AH for the deals shown, best first, skipping ones checked in the last 5 min.
	function T.CheckListings(auto)
		if ns.Scan.busy == "listings" then return ns.Scan.Stop() end
		if not ns.IsAuctionHouseOpen() then return ns.Say("open the Auction House first.") end
		local ids, now = {}, ns.Now()
		for _, r in ipairs(T.rows or {}) do
			if #ids >= T.CHECK_MAX then break end
			if not (r.checked and r.t and now - r.t < 300) then ids[#ids + 1] = r.item end
		end
		if #ids == 0 and auto then return end
		if #ids == 0 then return ns.Say(#(T.rows or {}) > 0 and "every deal shown was checked in the last 5 minutes." or "no deals to check: scan the AH first.") end
		if not ns.Scan.Listings(ids, nil, function(n) ns.Say("checked the listings of %d items.", n) end) then ns.Say("busy: %s", ns.Scan.progress) end
	end

	-- after a scan, with the Deals tab open: count the listings of the deals it found
	ns.Scan.onSummaryDone = function()
		if frame and frame:IsShown() and App.ui.tab == "deals" then
			C_Timer.After(1.5, function()
				App.Refresh()
				if not ns.Scan.busy then T.CheckListings(true) end
			end)
		end
	end

	function T.Update()
		local s, ui = App.state, App.ui.deals
		for _, c in ipairs(controls) do c:Refresh() end
		local checked = 0
		if ui.mode == "vendor" then
			market:Hide() flips:Show()
			local rows = {}
			for _, r in ipairs(Deals.VendorFlips(s.d, s.market)) do if r.profit >= ui.minProfit then rows[#rows + 1] = r end end
			T.rows = rows
			flips:SetData(rows, "No listing below what a vendor pays. Scan the AH for fresh prices.")
			note:SetText("Buy and sell to any vendor: guaranteed profit.")
		else
			flips:Hide() market:Show()
			local rows = Deals.UnderMarket(s.d, s.market, { maxPct = ui.maxPct, minProfit = ui.minProfit, minSold = 1, cut = App.ui.cut, atr = s.atr })
			T.rows = rows
			market:SetData(rows, "No listing that far under its usual price.")
			note:SetText(Prices.TsmAvailable() and "Usual price: TSM's region sales; only items selling 1+ a day." or "Usual price: Auctionator's two-week median (install TSM for sales data).")
		end
		for _, r in ipairs(T.rows) do if r.checked then checked = checked + 1 end end
		if #T.rows > 0 and checked < #T.rows then
			note:SetText(note:GetText() .. "  " .. C.accent .. (checked > 0 and (checked .. "/" .. #T.rows .. " counted.") or "Check listings counts them.") .. "|r")
		end
	end
end

---------------------------------------------------------------------------
-- Leveling
---------------------------------------------------------------------------

App.tabs.leveling = {}
do
	local T = App.tabs.leveling
	local ups, path, summary, upsTitle, controls

	local function craftingProfs()
		local out = {}
		for name, p in pairs((App.state and App.state.profs) or {}) do
			local isGather = false
			for _, id in pairs(Data.GATHER_SKILLS) do if id == p.skill and name ~= "Mining" then isGather = true end end
			if not isGather then out[#out + 1] = { name, ("%s %d/%d"):format(name, p.rank, p.max) } end
		end
		table.sort(out, function(a, b) return a[1] < b[1] end)
		return out
	end

	local function colorChance(c, chance)
		return (C[c] or "") .. c .. "|r" .. (c ~= "orange" and (" " .. math.floor(chance * 100 + 0.5) .. "%") or "")
	end

	local function levels(r)
		return ("%s%d|r %s%d|r %s%d|r %s%d|r"):format(C.orange, Data.LearnLevel(r), C.yellow, r.yellow, C.green, Leveling.Green(r), C.grey, r.grey)
	end

	local function learnTag(s, r)
		if s.known[r.spell] then return "" end
		local lc = Leveling.LearnCost(r, s.market)
		local how = lc.how == "trainer" and ("trainer" .. (lc.cost and (" " .. W.Money(lc.cost, true)) or "") .. (lc.guess and "?" or ""))
			or lc.how == "vendor" and ("vendor " .. (lc.cost and W.Money(lc.cost, true) or (lc.text or "")))
			or lc.how == "ah" and ("AH " .. W.Money(lc.cost, true))
			or lc.how == "item" and "recipe not on AH" or "?"
		return C.accent .. "learn " .. (Data.LearnKnown(r) and "" or "~") .. Data.LearnLevel(r) .. "|r · " .. how
	end

	function T.Create(p)
		local ui = App.ui.lvl
		local profC = W.Cycle(p, "", 200, craftingProfs, function() return ui.prof end, function(v) ui.prof = v ui.target = nil T.Update() end, "Profession")
		profC:SetPoint("TOPLEFT", 0, 0)
		local targetC = W.Cycle(p, "To ", 90, function()
			local s = App.state
			local pr = s and ui.prof and s.profs[ui.prof]
			local out = {}
			if pr then
				for _, t in ipairs({ pr.rank + 10, pr.rank + 25, pr.max, 75, 150, 225, 300 }) do
					local seen = false
					for _, o in ipairs(out) do if o[1] == t then seen = true end end
					if t > pr.rank and t <= 300 and not seen then out[#out + 1] = { t, tostring(t) } end
				end
				table.sort(out, function(a, b) return a[1] < b[1] end)
			end
			return out
		end, function() return ui.target end, function(v) ui.target = v T.Update() end, "Target skill")
		targetC:SetPoint("LEFT", profC, "RIGHT", 6, 0)
		local poolC = W.Cycle(p, "", 210, function() return { { "known", "Recipes I know" }, { "trainer", "+ trainer recipes" }, { "all", "+ vendor and AH recipes" } } end,
			function() return ui.pool end, function(v) ui.pool = v T.Update() end, "Which recipes the plan may use (learning costs are added)")
		poolC:SetPoint("LEFT", targetC, "RIGHT", 6, 0)
		summary = W.Label(p, "", "GameFontHighlightSmall")
		summary:SetPoint("LEFT", poolC, "RIGHT", 10, 0)
		summary:SetPoint("RIGHT", p, "RIGHT", 0, 0)
		summary:SetJustifyH("LEFT")
		controls = { profC, targetC, poolC }

		upsTitle = W.Label(p, "", "GameFontNormal")
		upsTitle:SetPoint("TOPLEFT", 2, -32)
		ups = W.List(p, {
			{ label = "Craft", width = 220, icon = function(u) return W.ItemIcon(u.recipe.out) end, text = function(u) return itemText(App.state.d, u.recipe.out, u.recipe.name) end, sort = function(u) return u.recipe.name end },
			{ label = "Colour", width = 80, text = function(u) return colorChance(u.color, u.chance) end, sort = function(u) return u.chance end },
			{ label = "Profit each", width = 80, align = "RIGHT", text = function(u) return W.Money(-u.net, true) end, sort = function(u) return -u.net end, tip = "What the product sells for minus the cost of one craft (red: it costs you)" },
			{ label = "Per point", width = 80, align = "RIGHT", text = function(u) return W.Money(-u.net / u.chance, true) end, sort = function(u) return -u.net / u.chance end, tip = "Profit per skill point, counting the crafts that give no point (red: what each point costs)" },
			{ label = "Skill-ups", width = 110, text = function(u) return levels(u.recipe) end, sort = function(u) return u.recipe.grey end, tip = "Orange (always), yellow (usually), green (rarely), grey (never)" },
			{ label = "Learn", width = 200, text = function(u) return learnTag(App.state, u.recipe) end },
		}, { sortBy = 4, onClick = function(u) App.SearchItem(u.recipe.out) end, onEnter = function(f, u) W.ShowItemTooltip(f, u.recipe.out) end })
		ups:SetPoint("TOPLEFT", upsTitle, "BOTTOMLEFT", -2, -4)
		ups:SetPoint("RIGHT", p, "RIGHT", 0, 0)
		ups:SetHeight(220)

		local pathTitle = W.Label(p, "Cheapest path", "GameFontNormal")
		pathTitle:SetPoint("TOPLEFT", ups, "BOTTOMLEFT", 2, -8)
		path = W.List(p, {
			{ label = "Craft", width = 220, icon = function(st) return W.ItemIcon(st.recipe.out) end, text = function(st) return itemText(App.state.d, st.recipe.out, st.recipe.name) end },
			{ label = "Skill", width = 80, text = function(st) return st.from .. " - " .. st.to end },
			{ label = "Crafts", width = 55, align = "RIGHT", text = function(st) return W.Num(st.crafts, 0) end },
			{ label = "Profit each", width = 80, align = "RIGHT", text = function(st) return W.Money(-st.netEach, true) end },
			{ label = "Step profit", width = 90, align = "RIGHT", text = function(st) return W.Money(-st.total, true) end, tip = "All crafts of this step, minus learning it when not known (red: what the step costs)" },
			{ label = "Learn", width = 200, text = function(st) return learnTag(App.state, st.recipe) end },
		}, { onClick = function(st) App.SearchItem(st.recipe.out) end, onEnter = function(f, st) W.ShowItemTooltip(f, st.recipe.out) end })
		path:SetPoint("TOPLEFT", pathTitle, "BOTTOMLEFT", -2, -4)
		path:SetPoint("BOTTOMRIGHT", 0, 0)
	end

	function T.Update()
		local s, ui = App.state, App.ui.lvl
		local profs = craftingProfs()
		if not ui.prof or not s.profs[ui.prof] then
			-- start with a profession that still has room to grow
			ui.prof = nil
			for _, p in ipairs(profs) do
				local pr = s.profs[p[1]]
				if pr.rank < pr.max then ui.prof = p[1] break end
			end
			ui.prof = ui.prof or (profs[1] and profs[1][1])
		end
		local pr = ui.prof and s.profs[ui.prof]
		if not pr then
			for _, c in ipairs(controls) do c:Refresh() end
			summary:SetText(C.muted .. "Open a profession window once so the addon knows your skill and recipes.|r")
			ups:SetData({}, "") path:SetData({}, "")
			return
		end
		if not ui.target or ui.target <= pr.rank then ui.target = math.min(300, math.max(pr.max, pr.rank + 1)) end
		for _, c in ipairs(controls) do c:Refresh() end
		local engine = App.Engine("known", "best", nil)
		local function inPool(r)
			if s.known[r.spell] then return true end
			if ui.pool == "known" or not Leveling.CanLearn(r, s.faction, s.specs) then return false end
			if Leveling.IsTrainerRecipe(r) then return true end
			return ui.pool == "all" and Leveling.LearnCost(r, s.market).cost ~= nil
		end
		local recipes = {}
		for _, r in ipairs(s.d.recipes) do
			if r.skill == pr.skill and s.d.items[r.out] and inPool(r) then recipes[#recipes + 1] = r end
		end
		local function net(r)
			local e = engine:Evaluate(r)
			if not e.complete then return nil end
			return e.cost - e.revenue
		end
		local function learn(r)
			if s.known[r.spell] then return 0 end
			return Leveling.LearnCost(r, s.market).cost or 0
		end
		upsTitle:SetText(("Everything that gives a point at %d"):format(pr.rank))
		ups:SetData(Leveling.SkillUpsAt(recipes, pr.rank, net), "No recipe in this list gives a point at your skill. Try including trainer recipes.")
		local plan = Leveling.Plan(recipes, pr.rank, ui.target, net, learn)
		path:SetData(plan.steps, "No path found.")
		if plan.stuckAt then
			summary:SetText(("%s %s for %d crafts; %sstuck at %d|r (no priced recipe gives a point there)"):format(plan.total <= 0 and "makes" or "costs", W.Money(math.abs(plan.total), true), math.floor(plan.crafts + 0.5), C.bad, plan.stuckAt))
		else
			summary:SetText(("%d to %d %s %s, about %d crafts%s"):format(pr.rank, ui.target, plan.total <= 0 and (C.good .. "makes|r") or (C.bad .. "costs|r"), W.Money(math.abs(plan.total), true), math.floor(plan.crafts + 0.5),
				ui.target > pr.max and (C.bad .. " (above your cap " .. pr.max .. ": train the next rank)|r") or ""))
		end
	end
end

---------------------------------------------------------------------------
-- Sales
---------------------------------------------------------------------------

App.tabs.sales = {}
do
	local T = App.tabs.sales
	local summary, chart, list

	function T.Create(p)
		summary = W.Label(p, "", "GameFontHighlight")
		summary:SetPoint("TOPLEFT", 2, -2)
		summary:SetPoint("RIGHT", p, "RIGHT", 0, 0)
		summary:SetJustifyH("LEFT")
		local cap = W.Label(p, "Income per day, last 30 days (after the AH cut)", "GameFontDisableSmall")
		cap:SetPoint("TOPLEFT", summary, "BOTTOMLEFT", 0, -6)
		chart = W.Bars(p, 90)
		chart:SetPoint("TOPLEFT", cap, "BOTTOMLEFT", 0, -16)
		chart:SetPoint("RIGHT", p, "RIGHT", -4, 0)
		list = W.List(p, {
			{ label = "Item", width = 230, icon = function(e) return W.ItemIcon(e.item) end, text = function(e) return e.item ~= 0 and itemText(App.state.d, e.item) or e.name end, sort = function(e) return e.name end },
			{ label = "Sold", width = 50, align = "RIGHT", text = function(e) return tostring(e.soldUnits) end, sort = function(e) return e.soldUnits end },
			{ label = "Avg price", width = 85, align = "RIGHT", text = function(e) return e.soldUnits > 0 and W.Money(e.gross / e.soldUnits, true) or "-" end, sort = function(e) return e.soldUnits > 0 and e.gross / e.soldUnits or nil end },
			{ label = "Earned", width = 90, align = "RIGHT", text = function(e) return W.Money(e.net, true) end, sort = function(e) return e.net end, tip = "After the AH cut" },
			{ label = "Unsold", width = 55, align = "RIGHT", text = function(e) return tostring(e.expired + e.cancelled) end, sort = function(e) return e.expired + e.cancelled end, tip = "Expired or cancelled auctions" },
			{ label = "Bought", width = 55, align = "RIGHT", text = function(e) return tostring(e.boughtUnits) end, sort = function(e) return e.boughtUnits end },
			{ label = "Spent", width = 80, align = "RIGHT", text = function(e) return W.Money(e.spent, true) end, sort = function(e) return e.spent end },
			{ label = "Crafted", width = 55, align = "RIGHT", text = function(e) return tostring(e.crafted) end, sort = function(e) return e.crafted end },
			{ label = "Last sale", width = 80, text = function(e) return e.lastSale and W.Ago(e.lastSale) or "-" end, sort = function(e) return e.lastSale end },
		}, { sortBy = 4, onClick = function(e) App.SearchItem(e.item) end, onEnter = function(f, e) if e.item ~= 0 then W.ShowItemTooltip(f, e.item) end end })
		list:SetPoint("TOPLEFT", chart, "BOTTOMLEFT", 0, -10)
		list:SetPoint("BOTTOMRIGHT", 0, 0)
	end

	function T.Update()
		local s = App.state
		local getInstant = (C_Item and C_Item.GetItemInfoInstant) or GetItemInfoInstant
		local sum = Sales.Summarize(s.d, s.char.ledger, {
			nameToId = function(name)
				if not getInstant or not name then return 0 end
				local ok, id = pcall(getInstant, name)
				return ok and tonumber(id) or 0
			end,
		})
		summary:SetText(("Last 7 days %s   ·   30 days %s   ·   spent %s   ·   sold %s of auctions   ·   %d AH mails"):format(
			W.Money(sum.income7, true), W.Money(sum.income30, true), W.Money(sum.spend30, true),
			sum.sellThrough30 and (math.floor(sum.sellThrough30 * 100 + 0.5) .. "%") or "-", sum.mails))
		local values = {}
		for _, day in ipairs(sum.days) do
			values[#values + 1] = { day.income, date("%a %d %b", day.day), "Earned " .. W.Money(day.income) .. (day.spend > 0 and ("\nSpent " .. W.Money(day.spend)) or "") }
		end
		chart:SetValues(values, { 0.224, 0.529, 0.898 })
		list:SetData(sum.items, "No AH mail read yet: open your mailbox once.")
	end
end

---------------------------------------------------------------------------
-- Minimap button and start-up
---------------------------------------------------------------------------

local function createMinimapButton()
	if not Minimap or App.ui.minimap.hide then return end
	local b = CreateFrame("Button", "ForeverFlipsMinimapButton", Minimap)
	b:SetSize(31, 31)
	b:SetFrameStrata("MEDIUM")
	b:SetFrameLevel(8)
	b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	b:RegisterForDrag("LeftButton")
	b:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")
	local icon = b:CreateTexture(nil, "BACKGROUND")
	icon:SetTexture("Interface\\Icons\\INV_Misc_Coin_01")
	icon:SetSize(20, 20)
	icon:SetPoint("CENTER", 0, 1)
	local border = b:CreateTexture(nil, "OVERLAY")
	border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
	border:SetSize(53, 53)
	border:SetPoint("TOPLEFT")
	local function place()
		local a = math.rad(App.ui.minimap.angle or 200)
		b:ClearAllPoints()
		b:SetPoint("CENTER", Minimap, "CENTER", math.cos(a) * 80, math.sin(a) * 80)
	end
	b:SetScript("OnDragStart", function(self)
		self:SetScript("OnUpdate", function()
			local mx, my = Minimap:GetCenter()
			local cx, cy = GetCursorPosition()
			local scale = Minimap:GetEffectiveScale()
			App.ui.minimap.angle = math.deg(math.atan2(cy / scale - my, cx / scale - mx))
			place()
		end)
	end)
	b:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
	b:SetScript("OnClick", function(_, button)
		if button == "RightButton" then
			if ns.Scan and ns.Scan.busy then ns.Scan.Stop() else ns.StartScan() end
		else
			App.Toggle()
		end
	end)
	b:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, "Forever Flips", "Click: open", "Right-click: scan the AH (when open; again: stop)", "Drag: move") end)
	b:SetScript("OnLeave", W.HideTooltip)
	place()
end

--- Called once the saved variables are loaded.
function App.Init(DB)
	DB.ui = DB.ui or {}
	App.ui = merge(DB.ui, DEFAULTS)
	createMinimapButton()
	createCraftButton()
end
