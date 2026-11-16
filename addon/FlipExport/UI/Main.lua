-- FlipExport / UI/Main.lua
-- The Forever Flips window: Crafts, Deals, Leveling and Sales, worked out in game from the
-- addon's own scans, Auctionator, TSM (when installed) and Recipe Master's learn levels.
-- Open with /flip or the minimap button.

local _, ns = ...
local W = ns.Widgets
local Data, Prices, Engine, Leveling, Deals, Sales = ns.Data, ns.Prices, ns.Engine, ns.Leveling, ns.Deals, ns.Sales
local C = W.COLOR

local App = { tabs = {}, overrides = {} }
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
	local atr = ns.AuctionatorDB()
	local market = Prices.Build(d, { scan = DB.ah, atr = atr, depth = ui.priceDepth, learnedVendor = DB.vendor, useTsm = ui.useTsm })
	local profs = Data.Professions(d, char)
	local profSkills = {}
	for _, p in pairs(profs) do profSkills[p.skill] = true end
	local known = Data.KnownSpells(char)
	local inv = {}
	for _, list in ipairs({ ns.ReadBagCounts and ns.ReadBagCounts() or {}, (char.bank and char.bank.i) or {} }) do
		for _, e in ipairs(list) do inv[e[1]] = (inv[e[1]] or 0) + (e[2] or 0) end
	end
	App.state = {
		d = d, char = char, profs = profs, profSkills = profSkills, known = known, market = market, atr = atr,
		inventory = inv, faction = UnitFactionGroup and UnitFactionGroup("player") or nil,
		specs = Leveling.KnownSpecs(d, known),
	}
	return App.state
end

function App.Engine(craftMode, strategy, overrides)
	local s = App.state
	return Engine.New(s.d, s.market, {
		cut = App.ui.cut, craftMode = craftMode or "known", known = s.known, profSkills = s.profSkills,
		strategy = strategy or "best", overrides = overrides,
	})
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
	f:SetScript("OnDragStart", f.StartMoving)
	f:SetScript("OnDragStop", function(self)
		self:StopMovingOrSizing()
		local point, _, rel, x, y = self:GetPoint()
		App.ui.pos = { point, rel, x, y }
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
	local scan = W.Button(f, "Scan AH", 80, function() ns.StartScan() end)
	scan:SetPoint("RIGHT", refresh, "LEFT", -6, 0)
	scan:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, "Full AH scan", "With the Auction House open. Blizzard allows one every 15 minutes; Auctionator's own scans and searches count too.") end)
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
	f:Hide() -- new frames start out shown; Toggle shows it, which refreshes
	return f
end

function App.UpdateStatus()
	if not frame then return end
	local DB, s = ns.GetDB(), App.state
	local parts = {}
	if DB.ah and DB.ah.t then
		parts[#parts + 1] = ("AH scan %s (%d items)"):format(W.Ago(DB.ah.t), #(DB.ah.i or {}))
	else
		parts[#parts + 1] = C.muted .. "no AH scan yet|r"
	end
	if s and s.atr then parts[#parts + 1] = ("Auctionator: %d newer"):format(s.market.atrCount or 0) end
	parts[#parts + 1] = Prices.TsmAvailable() and (App.ui.useTsm and "TSM: on" or "TSM: off") or (C.muted .. "TSM: not installed|r")
	parts[#parts + 1] = ns.RecipeMasterData and ("learn levels: Recipe Master " .. (ns.RecipeMasterData.version or "")) or (C.muted .. "learn levels: estimates|r")
	frame.status:SetText(table.concat(parts, "  ·  "))
	frame.scanButton:SetEnabled(ns.IsAuctionHouseOpen())
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
--- one refresh half a second after the last of a burst.
local pending = false
function App.DataChanged()
	if not (frame and frame:IsShown()) or pending then return end
	pending = true
	C_Timer.After(0.5, function()
		pending = false
		App.Refresh()
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
	local list, plan, planTitle, controls

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
				return itemText(App.state.d, rec.out, rec.gather and Data.ItemName(App.state.d, rec.out) or rec.name) .. (rec.qty > 1 and (" x" .. rec.qty) or "") .. tag
			end, sort = function(r) return r.e.recipe.name end },
			{ label = "Profession", width = 85, text = function(r) return profName(App.state.d, r.e.recipe.skill) end, sort = function(r) return profName(App.state.d, r.e.recipe.skill) end },
			{ label = "Cost", width = 80, align = "RIGHT", text = function(r) return r.e.complete and W.Money(r.e.cost, true) or (C.bad .. "missing price|r") end, sort = function(r) return r.e.complete and r.e.cost or nil end },
			{ label = "Sells for", width = 80, align = "RIGHT", text = function(r) return W.Money(r.e.revenue, true) .. (r.e.channel == "vendor" and (C.muted .. " v|r") or "") end, sort = function(r) return r.e.revenue end, tip = "Per craft: the AH price after the 5% cut, or what a vendor pays (v) when that is more" },
			{ label = "Profit", width = 85, align = "RIGHT", text = function(r) return r.e.complete and W.Money(r.e.profit, true) or "-" end, sort = function(r) return r.e.complete and r.e.profit or nil end },
			{ label = "%", width = 50, align = "RIGHT", text = function(r) return r.e.complete and r.e.cost > 0 and W.Pct(r.e.margin) or "-" end, sort = function(r) return r.e.complete and r.e.cost > 0 and r.e.margin or nil end },
			{ label = "Sold/day", width = 60, align = "RIGHT", text = function(r) return r.sales and r.sales.soldPerDay and W.Num(r.sales.soldPerDay, 1) or "-" end, sort = function(r) return r.sales and r.sales.soldPerDay end, tip = "TSM: how many sell per day per auction house in the region (TSM addon and app needed)" },
			{ label = "On AH", width = 50, align = "RIGHT", text = function(r) return r.e.ahUnit and tostring(r.e.ahQty) or "-" end, sort = function(r) return r.e.ahQty end },
			{ label = "Can make", width = 55, align = "RIGHT", text = function(r) return r.e.recipe.gather and "-" or tostring(r.e.craftableNow) end, sort = function(r) return r.e.craftableNow end, tip = "From what is in your bags and bank (direct reagents)" },
		}, {
			sortBy = 5,
			onClick = function(row) T.Select(row) end,
			onEnter = function(f, row) W.ShowItemTooltip(f, row.e.recipe.out) end,
		})
		list:SetPoint("TOPLEFT", 0, -30)
		list:SetPoint("RIGHT", p, "RIGHT", 0, 0)
		list:SetHeight(300)

		planTitle = W.Label(p, "", "GameFontNormal")
		planTitle:SetPoint("TOPLEFT", list, "BOTTOMLEFT", 2, -6)
		planTitle:SetPoint("RIGHT", p, "RIGHT", 0, 0)
		planTitle:SetJustifyH("LEFT")
		plan = W.List(p, {
			{ label = "Part", width = 250, icon = function(r) return W.ItemIcon(r.item) end, text = function(r) return string.rep("   ", r.depth) .. itemText(App.state.d, r.item) end },
			{ label = "Qty", width = 45, align = "RIGHT", text = function(r) return W.Num(r.count, r.count % 1 == 0 and 0 or 1) end },
			{ label = "Each", width = 80, align = "RIGHT", text = function(r) return W.Money(r.source.unit) end },
			{ label = "Total", width = 85, align = "RIGHT", text = function(r) return W.Money(r.source.unit * r.count) end },
			{ label = "How", width = 90, text = function(r) return sourceText(r.source) end },
			{ label = "Why", width = 260, text = function(r) return r.why end },
		}, {
			onClick = function(row) T.Flip(row) end,
			onEnter = function(f, row)
				W.ShowItemTooltip(f, row.item)
				if GameTooltip and row.flippable then GameTooltip:AddLine("Click: " .. (row.source.kind == "craft" and "buy it instead" or "craft it instead"), 0.3, 0.8, 1) GameTooltip:Show() end
			end,
		})
		plan:SetPoint("TOPLEFT", planTitle, "BOTTOMLEFT", -2, -4)
		plan:SetPoint("BOTTOMRIGHT", p, "BOTTOMRIGHT", 0, 0)
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
		list:Update()
		T.ShowPlan()
	end

	function T.ShowPlan()
		local r = T.selected
		if not r then
			planTitle:SetText(C.muted .. "Click a craft to see how each part is got, and why. Click a part to buy or craft it instead.|r")
			plan:SetData({}, "")
			return
		end
		local ui = App.ui.crafts
		local engine = App.Engine(ui.craftMode, ui.strategy, App.overrides)
		local e = engine:Evaluate(r, App.state.inventory)
		planTitle:SetText(("%s  —  cost %s, sells for %s, profit %s"):format(
			itemText(App.state.d, r.out, r.gather and nil or r.name), W.Money(e.cost), W.Money(e.revenue), e.complete and W.Money(e.profit) or "-"))
		plan:SetData(planRows(engine, e.parts, 0, 1, {}), r.gather and "Gathered: nothing to buy." or "No parts.")
	end

	function T.Flip(row)
		if not row.flippable then return end
		App.overrides[row.item] = row.source.kind == "craft" and "buy" or "craft"
		T.Update()
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
		T.ShowPlan()
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
		note = W.Label(p, "", "GameFontDisableSmall")
		note:SetPoint("LEFT", minp, "RIGHT", 10, 0)
		note:SetPoint("RIGHT", p, "RIGHT", 0, 0)
		note:SetJustifyH("LEFT")
		controls = { mode, pct, minp }

		local function srcTag(src) return src == "auctionator" and (C.muted .. " A|r") or src == "tsm" and (C.muted .. " T|r") or "" end
		flips = W.List(p, {
			{ label = "Item", width = 260, icon = function(r) return W.ItemIcon(r.item) end, text = function(r) return itemText(App.state.d, r.item) end, sort = function(r) return Data.ItemName(App.state.d, r.item) end },
			{ label = "Cheapest", width = 90, align = "RIGHT", text = function(r) return W.Money(r.price) .. srcTag(r.src) end, sort = function(r) return r.price end, tip = "A = from Auctionator, T = from TSM; else your own scan" },
			{ label = "Vendor pays", width = 90, align = "RIGHT", text = function(r) return W.Money(r.vendor) end, sort = function(r) return r.vendor end },
			{ label = "Units", width = 60, align = "RIGHT", text = function(r) return r.units .. (r.more and "+" or "") end, sort = function(r) return r.units end },
			{ label = "Profit", width = 100, align = "RIGHT", text = function(r) return W.Money(r.profit) end, sort = function(r) return r.profit end, tip = "Buying the cheap units and selling them to a vendor" },
		}, { sortBy = 5, onEnter = function(f, row) W.ShowItemTooltip(f, row.item) end })
		flips:SetPoint("TOPLEFT", 0, -30)
		flips:SetPoint("BOTTOMRIGHT", 0, 0)

		market = W.List(p, {
			{ label = "Item", width = 230, icon = function(r) return W.ItemIcon(r.item) end, text = function(r) return itemText(App.state.d, r.item) end, sort = function(r) return Data.ItemName(App.state.d, r.item) end },
			{ label = "Cheapest", width = 85, align = "RIGHT", text = function(r) return W.Money(r.price) .. srcTag(r.src) end, sort = function(r) return r.price end },
			{ label = "Usual", width = 85, align = "RIGHT", text = function(r) return W.Money(r.reference) .. (r.refSrc == "auctionator" and (C.muted .. " A|r") or "") end, sort = function(r) return r.reference end, tip = "TSM's region average sale price (or market value); A = median of Auctionator's daily lows over two weeks" },
			{ label = "%", width = 45, align = "RIGHT", text = function(r) return ("%d%%"):format(math.floor(r.pct * 100 + 0.5)) end, sort = function(r) return r.pct end },
			{ label = "Units", width = 50, align = "RIGHT", text = function(r) return r.units .. (r.more and "+" or "") end, sort = function(r) return r.units end },
			{ label = "Profit", width = 90, align = "RIGHT", text = function(r) return W.Money(r.profit) end, sort = function(r) return r.profit end, tip = "Reselling them at the usual price, after the AH cut" },
			{ label = "Sold/day", width = 60, align = "RIGHT", text = function(r) return r.soldPerDay and W.Num(r.soldPerDay, 1) or "-" end, sort = function(r) return r.soldPerDay end },
		}, { sortBy = 6, onEnter = function(f, row) W.ShowItemTooltip(f, row.item) end })
		market:SetPoint("TOPLEFT", 0, -30)
		market:SetPoint("BOTTOMRIGHT", 0, 0)
	end

	function T.Update()
		local s, ui = App.state, App.ui.deals
		for _, c in ipairs(controls) do c:Refresh() end
		if ui.mode == "vendor" then
			market:Hide() flips:Show()
			local rows = {}
			for _, r in ipairs(Deals.VendorFlips(s.d, s.market)) do if r.profit >= ui.minProfit then rows[#rows + 1] = r end end
			flips:SetData(rows, "No listing below what a vendor pays. Scan the AH for fresh prices.")
			note:SetText("Buy and sell to any vendor: guaranteed profit.")
		else
			flips:Hide() market:Show()
			local rows = Deals.UnderMarket(s.d, s.market, { maxPct = ui.maxPct, minProfit = ui.minProfit, minSold = 1, cut = App.ui.cut, atr = s.atr })
			market:SetData(rows, "No listing that far under its usual price.")
			note:SetText(Prices.TsmAvailable() and "Usual price: TSM's region sales; only items selling 1+ a day." or "Usual price: Auctionator's two-week median (install TSM for sales data).")
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
			{ label = "Net each", width = 80, align = "RIGHT", text = function(u) return W.Money(u.net, true) end, sort = function(u) return u.net end, tip = "Cost of one craft minus what the product sells for (negative: it makes money)" },
			{ label = "Per point", width = 80, align = "RIGHT", text = function(u) return W.Money(u.perPoint, true) end, sort = function(u) return u.perPoint end },
			{ label = "Skill-ups", width = 110, text = function(u) return levels(u.recipe) end, sort = function(u) return u.recipe.grey end, tip = "Orange (always), yellow (usually), green (rarely), grey (never)" },
			{ label = "Learn", width = 200, text = function(u) return learnTag(App.state, u.recipe) end },
		}, { sortBy = 4, desc = false, onEnter = function(f, u) W.ShowItemTooltip(f, u.recipe.out) end })
		ups:SetPoint("TOPLEFT", upsTitle, "BOTTOMLEFT", -2, -4)
		ups:SetPoint("RIGHT", p, "RIGHT", 0, 0)
		ups:SetHeight(220)

		local pathTitle = W.Label(p, "Cheapest path", "GameFontNormal")
		pathTitle:SetPoint("TOPLEFT", ups, "BOTTOMLEFT", 2, -8)
		path = W.List(p, {
			{ label = "Craft", width = 220, icon = function(st) return W.ItemIcon(st.recipe.out) end, text = function(st) return itemText(App.state.d, st.recipe.out, st.recipe.name) end },
			{ label = "Skill", width = 80, text = function(st) return st.from .. " - " .. st.to end },
			{ label = "Crafts", width = 55, align = "RIGHT", text = function(st) return W.Num(st.crafts, 0) end },
			{ label = "Net each", width = 80, align = "RIGHT", text = function(st) return W.Money(st.netEach, true) end },
			{ label = "Step cost", width = 90, align = "RIGHT", text = function(st) return W.Money(st.total, true) end, tip = "Including learning it, when not known" },
			{ label = "Learn", width = 200, text = function(st) return learnTag(App.state, st.recipe) end },
		}, { onEnter = function(f, st) W.ShowItemTooltip(f, st.recipe.out) end })
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
			summary:SetText(("%s for %d crafts; %sstuck at %d|r (no priced recipe gives a point there)"):format(W.Money(plan.total, true), math.floor(plan.crafts + 0.5), C.bad, plan.stuckAt))
		else
			summary:SetText(("%d to %d: %s for about %d crafts%s"):format(pr.rank, ui.target, W.Money(plan.total, true), math.floor(plan.crafts + 0.5),
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
		}, { sortBy = 4, onEnter = function(f, e) if e.item ~= 0 then W.ShowItemTooltip(f, e.item) end end })
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
		if button == "RightButton" then ns.StartScan() else App.Toggle() end
	end)
	b:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, "Forever Flips", "Click: open", "Right-click: scan the AH (when open)", "Drag: move") end)
	b:SetScript("OnLeave", W.HideTooltip)
	place()
end

--- Called once the saved variables are loaded.
function App.Init(DB)
	DB.ui = DB.ui or {}
	App.ui = merge(DB.ui, DEFAULTS)
	createMinimapButton()
end
