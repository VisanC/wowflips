-- FlipExport / UI/Widgets.lua
-- Small building blocks for the Forever Flips window: money text, item text, buttons that
-- cycle through choices, checkboxes, a sortable scrolling list, and a bar chart.

local _, ns = ...
local W = {}
ns.Widgets = W

---------------------------------------------------------------------------
-- Text
---------------------------------------------------------------------------

local GOLD, SILVER, COPPER = "|cffffd700", "|cffc7c7cf", "|cffeda55f"

--- 12g 34s 56c (coloured); nil/NaN -> "-".
function W.Money(c, short)
	if c == nil or c ~= c or c == math.huge or c == -math.huge then return "|cff808080-|r" end
	local neg = c < 0
	c = math.floor(math.abs(c) + 0.5)
	local g, s, cp = math.floor(c / 10000), math.floor(c / 100) % 100, c % 100
	local parts = {}
	if g > 0 then parts[#parts + 1] = (g >= 1000 and (BreakUpLargeNumbers and BreakUpLargeNumbers(g) or tostring(g)) or tostring(g)) .. GOLD .. "g|r" end
	if s > 0 and not (short and g >= 100) then parts[#parts + 1] = s .. SILVER .. "s|r" end
	if (cp > 0 and not (short and g > 0)) or #parts == 0 then parts[#parts + 1] = cp .. COPPER .. "c|r" end
	return (neg and "|cffff6060-|r" or "") .. table.concat(parts, " ")
end

--- Money in one colour (no gold/silver/copper colours): for "too much" red and such.
function W.MoneyIn(c, color)
	local plain = W.Money(c):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
	return color .. plain .. "|r"
end

function W.Pct(x)
	if x == nil or x ~= x then return "|cff808080-|r" end
	local s = ("%d%%"):format(math.floor(x * 100 + (x >= 0 and 0.5 or -0.5)))
	return x >= 0 and ("|cff4fd16b+" .. s .. "|r") or ("|cffff6060" .. s .. "|r")
end

function W.Num(x, decimals)
	if x == nil or x ~= x then return "|cff808080-|r" end
	if decimals and decimals > 0 then return ("%." .. decimals .. "f"):format(x) end
	return tostring(math.floor(x + 0.5))
end

function W.Ago(t)
	if not t or t <= 0 then return "never" end
	local s = time() - t
	if s < 90 then return "just now" end
	if s < 5400 then return ("%d min ago"):format(math.floor(s / 60)) end
	if s < 129600 then return ("%d h ago"):format(math.floor(s / 3600 + 0.5)) end
	return ("%d days ago"):format(math.floor(s / 86400 + 0.5))
end

--- A duration: 40 s, 12 min, 1 h 05 min (minutes rounded up).
function W.Duration(s)
	if not s then return "-" end
	if s < 59.5 then return ("%d s"):format(math.floor(s + 0.5)) end
	local m = math.ceil(s / 60)
	if m < 60 then return ("%d min"):format(m) end
	return ("%d h %02d min"):format(math.floor(m / 60), m % 60)
end

--- A duration to the second, so steps add up: 45s, 14m 05s, 1h 02m 30s.
function W.Clock(s)
	if not s then return "-" end
	s = math.floor(s + 0.5)
	if s < 60 then return s .. "s" end
	if s < 3600 then return ("%dm %02ds"):format(math.floor(s / 60), s % 60) end
	return ("%dh %02dm %02ds"):format(math.floor(s / 3600), math.floor(s / 60) % 60, s % 60)
end

W.COLOR = {
	orange = "|cffff8040", yellow = "|cffffff00", green = "|cff40c040", grey = "|cff808080", locked = "|cffff4040",
	muted = "|cff9a9a9a", good = "|cff4fd16b", bad = "|cffff6060", accent = "|cff4fc3f7",
}

local getIcon = (C_Item and C_Item.GetItemIconByID) or GetItemIcon

function W.ItemIcon(id)
	return (getIcon and id and id > 0 and getIcon(id)) or "Interface\\Icons\\INV_Misc_QuestionMark"
end

function W.QualityColor(q)
	local c = ITEM_QUALITY_COLORS and ITEM_QUALITY_COLORS[q or 1]
	if c and c.hex then return c.hex end
	return ({ [0] = "|cff9d9d9d", "|cffffffff", "|cff1eff00", "|cff0070dd", "|cffa335ee", "|cffff8000" })[q or 1] or "|cffffffff"
end

function W.ShowItemTooltip(owner, id)
	if not id or id <= 0 or not GameTooltip then return end
	GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
	if GameTooltip.SetItemByID then GameTooltip:SetItemByID(id) else GameTooltip:SetHyperlink("item:" .. id) end
	if W.OnItemAltClick then GameTooltip:AddLine("Alt-click: price history", 0.6, 0.6, 0.6) end
	GameTooltip:Show()
end

--- The item a list row is about (lists of items, crafts, queue steps...).
function W.ItemOf(row)
	if type(row.item) == "number" and row.item > 0 then return row.item end
	local r = row.recipe or (row.e and row.e.recipe)
	return r and r.out or nil
end

function W.ShowTextTooltip(owner, title, ...)
	if not GameTooltip then return end
	GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
	GameTooltip:SetText(title, 1, 1, 1)
	for i = 1, select("#", ...) do
		local line = select(i, ...)
		if line then GameTooltip:AddLine(line, 0.85, 0.85, 0.85, true) end
	end
	GameTooltip:Show()
end

function W.HideTooltip() if GameTooltip then GameTooltip:Hide() end end

---------------------------------------------------------------------------
-- Controls
---------------------------------------------------------------------------

function W.Label(parent, text, template)
	local fs = parent:CreateFontString(nil, "OVERLAY", template or "GameFontNormalSmall")
	fs:SetText(text or "")
	return fs
end

function W.Button(parent, text, width, onClick)
	local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
	b:SetSize(width or 90, 22)
	b:SetText(text)
	b:SetScript("OnClick", onClick)
	return b
end

--- A button that cycles through choices: choices = { { value, label }, ... }; get() / set(value).
function W.Cycle(parent, prefix, width, choices, get, set, tooltip)
	local b = W.Button(parent, "", width)
	local function label()
		local cur = get()
		for _, c in ipairs(choices()) do
			if c[1] == cur then return prefix .. c[2] end
		end
		local first = choices()[1]
		return prefix .. (first and first[2] or "?")
	end
	function b:Refresh() self:SetText(label()) end
	b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	b:SetScript("OnClick", function(self, button)
		local list, cur = choices(), get()
		if #list == 0 then return end
		local idx = 1
		for i, c in ipairs(list) do if c[1] == cur then idx = i end end
		idx = button == "RightButton" and (idx - 2) % #list + 1 or idx % #list + 1
		set(list[idx][1])
		self:Refresh()
	end)
	if tooltip then
		b:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, tooltip, "Click: next, right-click: previous") end)
		b:SetScript("OnLeave", W.HideTooltip)
	end
	b:Refresh()
	return b
end

function W.Check(parent, text, get, set, tooltip)
	local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
	cb:SetSize(22, 22)
	local fs = W.Label(parent, text, "GameFontHighlightSmall")
	fs:SetPoint("LEFT", cb, "RIGHT", 0, 1)
	cb.label = fs
	cb:SetChecked(get() and true or false)
	cb:SetScript("OnClick", function(self) set(self:GetChecked() and true or false) end)
	if tooltip then
		cb:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, text, tooltip) end)
		cb:SetScript("OnLeave", W.HideTooltip)
	end
	function cb:Refresh() self:SetChecked(get() and true or false) end
	return cb
end

---------------------------------------------------------------------------
-- Sortable scrolling list
---------------------------------------------------------------------------
-- columns: { label, width, align = "LEFT"|"RIGHT"|"CENTER", text = function(row) -> string,
--            sort = function(row) -> number|string (optional), icon = function(row) -> texture (first column),
--            tip = "header tooltip" }
-- opts: { rowHeight = 18, onClick = function(row, button), onEnter = function(rowFrame, row), sortBy = index, desc = true }

local ROW_H = 18

function W.List(parent, columns, opts)
	opts = opts or {}
	local rowH = opts.rowHeight or ROW_H
	local list = CreateFrame("Frame", nil, parent)
	list.columns, list.data, list.offset = columns, {}, 0
	list.sortBy, list.desc = opts.sortBy, opts.desc ~= false
	list.rows, list.headers = {}, {}

	local bg = list:CreateTexture(nil, "BACKGROUND")
	bg:SetAllPoints()
	if bg.SetColorTexture then bg:SetColorTexture(0, 0, 0, 0.25) end

	-- header
	local x = 4
	for i, col in ipairs(columns) do
		local h = CreateFrame("Button", nil, list)
		h:SetSize(col.width, rowH)
		h:SetPoint("TOPLEFT", list, "TOPLEFT", x, 0)
		local fs = h:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
		fs:SetAllPoints()
		fs:SetJustifyH(col.align or "LEFT")
		h.fs = fs
		h:SetScript("OnClick", function()
			if not col.sort then return end
			if list.sortBy == i then list.desc = not list.desc else list.sortBy, list.desc = i, col.align == "RIGHT" end
			list:Sort()
			list:Update()
		end)
		if col.tip then
			h:SetScript("OnEnter", function(self) W.ShowTextTooltip(self, col.label, col.tip) end)
			h:SetScript("OnLeave", W.HideTooltip)
		end
		list.headers[i] = h
		x = x + col.width + 6
	end

	local scroll = CreateFrame("Slider", nil, list)
	scroll:SetOrientation("VERTICAL")
	scroll:SetWidth(12)
	scroll:SetPoint("TOPRIGHT", list, "TOPRIGHT", -1, -rowH)
	scroll:SetPoint("BOTTOMRIGHT", list, "BOTTOMRIGHT", -1, 0)
	scroll:SetThumbTexture("Interface\\Buttons\\UI-ScrollBar-Knob")
	scroll:SetMinMaxValues(0, 0)
	scroll:SetValueStep(1)
	if scroll.SetObeyStepOnDrag then scroll:SetObeyStepOnDrag(true) end
	local sbg = scroll:CreateTexture(nil, "BACKGROUND")
	sbg:SetAllPoints()
	if sbg.SetColorTexture then sbg:SetColorTexture(1, 1, 1, 0.06) end
	scroll:SetScript("OnValueChanged", function(_, v)
		local o = math.floor(v + 0.5)
		if o ~= list.offset then list.offset = o list:Update() end
	end)
	list.scroll = scroll

	list:EnableMouseWheel(true)
	list:SetScript("OnMouseWheel", function(_, delta)
		local _, max = scroll:GetMinMaxValues()
		scroll:SetValue(math.max(0, math.min(max, list.offset - delta * 3)))
	end)

	local empty = list:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
	empty:SetPoint("TOP", list, "TOP", 0, -rowH - 12)
	empty:SetWidth(500)
	list.emptyText = empty

	function list:VisibleRows()
		local h = self:GetHeight() or 0
		return math.max(1, math.floor((h - rowH) / rowH))
	end

	local function makeRow(i)
		local row = CreateFrame("Button", nil, list)
		row:SetHeight(rowH)
		row:SetPoint("TOPLEFT", list, "TOPLEFT", 0, -rowH * i)
		row:SetPoint("RIGHT", scroll, "LEFT", -2, 0)
		row:RegisterForClicks("LeftButtonUp", "RightButtonUp")
		row:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight", "ADD")
		local sel = row:CreateTexture(nil, "BACKGROUND")
		sel:SetAllPoints()
		if sel.SetColorTexture then sel:SetColorTexture(0.3, 0.6, 1, 0.18) end
		sel:Hide()
		row.sel = sel
		row.cells = {}
		local cx = 4
		for c, col in ipairs(columns) do
			local fs = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
			fs:SetJustifyH(col.align or "LEFT")
			if fs.SetWordWrap then fs:SetWordWrap(false) end
			local w, left = col.width, cx
			if c == 1 and col.icon then
				local icon = row:CreateTexture(nil, "ARTWORK")
				icon:SetSize(rowH - 3, rowH - 3)
				icon:SetPoint("LEFT", row, "LEFT", cx, 0)
				row.icon = icon
				left, w = cx + rowH, col.width - rowH
			end
			fs:SetPoint("LEFT", row, "LEFT", left, 0)
			fs:SetWidth(w)
			row.cells[c] = fs
			cx = cx + col.width + 6
		end
		row:SetScript("OnClick", function(self, button)
			if not self.data then return end
			-- alt-click any item: its price history
			if W.OnItemAltClick and IsAltKeyDown and IsAltKeyDown() then
				local id = (opts.itemOf or W.ItemOf)(self.data)
				if id then return W.OnItemAltClick(id) end
			end
			if opts.onClick then opts.onClick(self.data, button) end
		end)
		row:SetScript("OnEnter", function(self) if self.data and opts.onEnter then opts.onEnter(self, self.data) end end)
		row:SetScript("OnLeave", W.HideTooltip)
		return row
	end

	function list:Sort()
		local col = self.columns[self.sortBy or 0]
		if not (col and col.sort) then return end
		local key, desc = col.sort, self.desc
		local keys = {}
		for _, r in ipairs(self.data) do
			local k = key(r)
			if k == nil or k ~= k then k = desc and -math.huge or math.huge end
			keys[r] = k
		end
		table.sort(self.data, function(a, b)
			local ka, kb = keys[a], keys[b]
			if type(ka) ~= type(kb) then ka, kb = tostring(ka), tostring(kb) end
			if ka == kb then return false end
			if desc then return ka > kb end
			return ka < kb
		end)
	end

	function list:SetData(rows, emptyText)
		self.data = rows or {}
		self.emptyText:SetText(emptyText or "Nothing to show.")
		self:Sort()
		self.offset = 0
		self:Update()
	end

	function list:Update()
		for i, col in ipairs(self.columns) do
			local mark = (self.sortBy == i) and (self.desc and " v" or " ^") or ""
			self.headers[i].fs:SetText(col.label .. mark)
		end
		local n = self:VisibleRows()
		local max = math.max(0, #self.data - n)
		self.scroll:SetMinMaxValues(0, max)
		if self.offset > max then self.offset = max end
		self.scroll:SetValue(self.offset)
		if max > 0 then self.scroll:Show() else self.scroll:Hide() end
		for i = 1, n do
			local row = self.rows[i] or makeRow(i)
			self.rows[i] = row
			local data = self.data[self.offset + i]
			row.data = data
			if data then
				for c, col in ipairs(self.columns) do
					local ok, text = pcall(col.text, data)
					row.cells[c]:SetText(ok and text or "?")
				end
				if row.icon then row.icon:SetTexture(self.columns[1].icon(data)) end
				if self.selected and self.selected == data then row.sel:Show() else row.sel:Hide() end
				row:Show()
			else
				row:Hide()
			end
		end
		for i = n + 1, #self.rows do self.rows[i]:Hide() end
		if #self.data == 0 then self.emptyText:Show() else self.emptyText:Hide() end
	end

	list:SetScript("OnSizeChanged", function(self) self:Update() end)
	return list
end

---------------------------------------------------------------------------
-- Bar chart (one bar per day)
---------------------------------------------------------------------------

function W.Bars(parent, height)
	local chart = CreateFrame("Frame", nil, parent)
	chart:SetHeight(height or 90)
	chart.bars = {}
	local axis = chart:CreateTexture(nil, "ARTWORK")
	axis:SetHeight(1)
	axis:SetPoint("BOTTOMLEFT")
	axis:SetPoint("BOTTOMRIGHT")
	if axis.SetColorTexture then axis:SetColorTexture(1, 1, 1, 0.25) end
	local maxLabel = W.Label(chart, "", "GameFontDisableSmall")
	maxLabel:SetPoint("TOPLEFT", chart, "TOPLEFT", 0, 12)
	--- values: { { value, tooltipTitle, tooltipLine }, ... } oldest first
	function chart:SetValues(values, color)
		local max = 0
		for _, v in ipairs(values) do max = math.max(max, v[1] or 0) end
		maxLabel:SetText(max > 0 and ("max " .. W.Money(max, true)) or "")
		local w = (self:GetWidth() or 600)
		local n = #values
		local bw = n > 0 and math.max(2, math.floor(w / n) - 3) or 0
		for i, v in ipairs(values) do
			local b = self.bars[i]
			if not b then
				b = CreateFrame("Frame", nil, self)
				b.tex = b:CreateTexture(nil, "ARTWORK")
				b.tex:SetPoint("BOTTOMLEFT")
				b.tex:SetPoint("BOTTOMRIGHT")
				b:EnableMouse(true)
				b:SetScript("OnEnter", function(f) if f.tip then W.ShowTextTooltip(f, f.tip[1], f.tip[2]) end end)
				b:SetScript("OnLeave", W.HideTooltip)
				self.bars[i] = b
			end
			b:ClearAllPoints()
			b:SetPoint("BOTTOMLEFT", self, "BOTTOMLEFT", (i - 1) * (bw + 3), 1)
			b:SetSize(bw, (self:GetHeight() or 90) - 2)
			local hgt = max > 0 and math.max(1, ((self:GetHeight() or 90) - 4) * (v[1] or 0) / max) or 1
			b.tex:SetHeight(hgt)
			if b.tex.SetColorTexture then b.tex:SetColorTexture(color[1], color[2], color[3], (v[1] or 0) > 0 and 0.9 or 0.2) end
			b.tip = { v[2] or "", v[3] }
			b:Show()
		end
		for i = n + 1, #self.bars do self.bars[i]:Hide() end
	end
	return chart
end

---------------------------------------------------------------------------
-- Line chart: price history, a point a day
---------------------------------------------------------------------------
-- Series are lines (Line objects; dots on clients without them), reference values are dashed
-- lines named in the legend, amounts for sale are faint bars along the bottom, and hovering
-- shows the day. Colours: blue / orange / aqua from a palette checked for colour blindness on
-- a dark background; text stays grey or white.

W.CHART = {
	series = { 0.224, 0.529, 0.898 }, -- #3987e5
	ref1 = { 0.851, 0.349, 0.149 },   -- #d95926
	ref2 = { 0.098, 0.620, 0.439 },   -- #199e70
	neutral = { 0.765, 0.761, 0.718 }, -- #c3c2b7
}

function W.LineChart(parent)
	local c = CreateFrame("Frame", nil, parent)
	local plot = CreateFrame("Frame", nil, c)
	plot:SetPoint("TOPLEFT", c, "TOPLEFT", 62, -22)
	plot:SetPoint("BOTTOMRIGHT", c, "BOTTOMRIGHT", -8, 18)
	local bg = plot:CreateTexture(nil, "BACKGROUND")
	bg:SetAllPoints()
	if bg.SetColorTexture then bg:SetColorTexture(0, 0, 0, 0.3) end
	c.plot = plot
	local pool = { line = {}, tex = {}, text = {} }
	local used = { line = 0, tex = 0, text = 0 }

	local function take(kind, make)
		used[kind] = used[kind] + 1
		local o = pool[kind][used[kind]]
		if not o then o = make() pool[kind][used[kind]] = o end
		if o.ClearAllPoints then o:ClearAllPoints() end
		o:Show()
		return o
	end
	local function tex(layer, r, g, b, a)
		local t = take("tex", function() return plot:CreateTexture(nil, "ARTWORK") end)
		if t.SetDrawLayer then t:SetDrawLayer(layer or "ARTWORK") end
		if t.SetColorTexture then t:SetColorTexture(r, g, b, a or 1) end
		return t
	end
	local function text(s, font)
		local f = take("text", function() return c:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall") end)
		if f.SetFontObject then f:SetFontObject(font or "GameFontHighlightSmall") end
		f:SetText(s)
		return f
	end
	local function line(x1, y1, x2, y2, col, a, w)
		if plot.CreateLine then
			local l = take("line", function() return plot:CreateLine(nil, "OVERLAY") end)
			l:SetThickness(w or 2)
			l:SetColorTexture(col[1], col[2], col[3], a or 1)
			l:SetStartPoint("BOTTOMLEFT", plot, x1, y1)
			l:SetEndPoint("BOTTOMLEFT", plot, x2, y2)
		else
			local d = tex("OVERLAY", col[1], col[2], col[3], a or 1)
			d:SetSize(w or 2, w or 2)
			d:SetPoint("CENTER", plot, "BOTTOMLEFT", x2, y2)
		end
	end
	local function dashed(y, w, col)
		local x = 0
		while x < w do
			local t = tex("ARTWORK", col[1], col[2], col[3], 0.9)
			t:SetSize(math.min(6, w - x), 1)
			t:SetPoint("BOTTOMLEFT", plot, "BOTTOMLEFT", x, y)
			x = x + 10
		end
	end

	local cross = plot:CreateTexture(nil, "OVERLAY")
	cross:SetWidth(1)
	if cross.SetColorTexture then cross:SetColorTexture(1, 1, 1, 0.35) end
	cross:Hide()
	local dot = plot:CreateTexture(nil, "OVERLAY")
	dot:SetSize(6, 6)
	if dot.SetColorTexture then dot:SetColorTexture(1, 1, 1, 1) end
	dot:Hide()

	--- points: { { t, low, high, qty } } oldest first. refs: { { value, color, label } }.
	--- names: { low = "...", high = "..." } for the legend and the hover.
	function c:SetData(points, refs, names)
		for kind, list in pairs(pool) do
			for i = 1, #list do list[i]:Hide() end
			used[kind] = 0
		end
		cross:Hide() dot:Hide()
		self.points, self.xs, self.ys = points or {}, {}, {}
		names = names or {}
		local W_, H = plot:GetWidth() or 0, plot:GetHeight() or 0
		if (W_ <= 0 or H <= 0) and C_Timer and not self.retried then
			-- not laid out yet (just shown): next frame
			self.retried = true
			C_Timer.After(0, function() self:SetData(points, refs, names) end)
			return
		end
		self.retried = nil
		local col = W.CHART

		-- legend: a swatch and grey text per series and reference line
		local lx = 62
		local function legend(swatch, label, dashedSwatch, alpha)
			local s = tex("OVERLAY", swatch[1], swatch[2], swatch[3], alpha or 1)
			s:ClearAllPoints()
			s:SetSize(dashedSwatch and 6 or 12, dashedSwatch and 1 or 2)
			s:SetPoint("LEFT", c, "TOPLEFT", lx, -9)
			local f = text(label)
			f:SetTextColor(0.8, 0.8, 0.8)
			f:SetPoint("LEFT", c, "TOPLEFT", lx + 16, -9)
			lx = lx + 16 + (f:GetStringWidth() or 60) + 14
		end
		if #self.points > 0 then
			legend(col.series, names.low or "Lowest of the day")
			if names.high ~= false then legend(col.series, names.high or "Highest", false, 0.4) end
		end

		local lo, hi = math.huge, -math.huge
		for _, p in ipairs(self.points) do
			lo, hi = math.min(lo, p.low), math.max(hi, p.high or p.low)
		end
		if lo == math.huge then
			lo, hi = nil, nil
			for _, r in ipairs(refs or {}) do
				if r[1] then lo, hi = math.min(lo or r[1], r[1]), math.max(hi or r[1], r[1]) end
			end
			if not lo then return end
		end
		-- reference lines join the scale unless they're far off (then only the legend has them)
		local onChart = {}
		for i, r in ipairs(refs or {}) do
			if r[1] and r[1] > 0 and r[1] >= lo / 3 and r[1] <= hi * 3 then
				onChart[i] = true
				lo, hi = math.min(lo, r[1]), math.max(hi, r[1])
			end
		end
		local pad = (hi - lo) * 0.1
		if pad <= 0 then pad = math.max(1, hi * 0.1) end
		lo, hi = math.max(0, lo - pad), hi + pad
		local function Y(v) return (v - lo) / (hi - lo) * H end

		-- grid and price labels
		for i = 0, 3 do
			local v = lo + (hi - lo) * i / 3
			local g = tex("BORDER", 1, 1, 1, 0.06)
			g:SetHeight(1)
			g:SetPoint("BOTTOMLEFT", plot, "BOTTOMLEFT", 0, Y(v))
			g:SetPoint("BOTTOMRIGHT", plot, "BOTTOMRIGHT", 0, Y(v))
			local f = text(W.Money(v, true), "GameFontDisableSmall")
			f:SetJustifyH("RIGHT")
			f:SetPoint("RIGHT", plot, "BOTTOMLEFT", -4, Y(v))
		end

		-- time axis: by day, gaps stay gaps
		local n = #self.points
		local t0 = n > 0 and self.points[1].t or 0
		local t1 = n > 0 and self.points[n].t or 0
		local span = math.max(86400, t1 - t0)
		local function X(t) return n == 1 and W_ / 2 or (t - t0) / span * W_ end
		local days = math.max(1, span / 86400 + 1)
		local barW = math.max(2, math.min(14, W_ / days - 3))

		-- amounts for sale: faint bars, a fifth of the height
		local maxQ = 0
		for _, p in ipairs(self.points) do maxQ = math.max(maxQ, p.qty or 0) end
		for _, p in ipairs(self.points) do
			if maxQ > 0 and p.qty and p.qty > 0 then
				local b = tex("BORDER", col.neutral[1], col.neutral[2], col.neutral[3], 0.18)
				b:SetSize(barW, math.max(1, H * 0.2 * p.qty / maxQ))
				b:SetPoint("BOTTOM", plot, "BOTTOMLEFT", X(p.t), 0)
			end
		end

		-- reference lines
		for i, r in ipairs(refs or {}) do
			if r[1] and r[1] > 0 then
				if onChart[i] then dashed(Y(r[1]), W_, r[2]) end
				legend(r[2], r[3] .. " " .. W.Money(r[1], true) .. (onChart[i] and "" or " (off the chart)"), true)
			end
		end

		-- the day's highest (faint) and lowest (strong)
		for i, p in ipairs(self.points) do
			self.xs[i], self.ys[i] = X(p.t), Y(p.low)
			if i > 1 then
				local q = self.points[i - 1]
				if names.high ~= false then line(X(q.t), Y(q.high or q.low), X(p.t), Y(p.high or p.low), col.series, 0.4, 1) end
				line(X(q.t), Y(q.low), X(p.t), Y(p.low), col.series, 1, 2)
			end
			local d = tex("OVERLAY", col.series[1], col.series[2], col.series[3], 1)
			d:SetSize(4, 4)
			d:SetPoint("CENTER", plot, "BOTTOMLEFT", X(p.t), Y(p.low))
		end

		-- dates under the axis: first, middle, last
		if n > 0 then
			local marks = { 1, n }
			if n > 4 then marks[3] = math.floor((n + 1) / 2) end
			for _, i in ipairs(marks) do
				local f = text(date("%b %d", self.points[i].t), "GameFontDisableSmall")
				f:SetPoint("TOP", plot, "BOTTOMLEFT", X(self.points[i].t), -3)
			end
		end
		self.names = names
	end

	-- hover: the nearest day
	plot:EnableMouse(true)
	local function nearest()
		local pts = c.points
		if not pts or #pts == 0 or not GetCursorPosition then return nil end
		local x = GetCursorPosition() / (plot:GetEffectiveScale() or 1) - (plot:GetLeft() or 0)
		local best, bd = nil, math.huge
		for i, px in ipairs(c.xs) do
			local dd = math.abs(px - x)
			if dd < bd then best, bd = i, dd end
		end
		return best
	end
	local shown
	plot:SetScript("OnUpdate", function(self)
		if not (self.IsMouseOver and self:IsMouseOver()) then
			if shown then shown = nil cross:Hide() dot:Hide() W.HideTooltip() end
			return
		end
		local i = nearest()
		if not i or i == shown then return end
		shown = i
		local p = c.points[i]
		cross:ClearAllPoints()
		cross:SetPoint("TOP", self, "TOPLEFT", c.xs[i], 0)
		cross:SetPoint("BOTTOM", self, "BOTTOMLEFT", c.xs[i], 0)
		cross:Show()
		dot:ClearAllPoints()
		dot:SetPoint("CENTER", self, "BOTTOMLEFT", c.xs[i], c.ys[i])
		dot:Show()
		local names = c.names or {}
		W.ShowTextTooltip(self, date("%A %b %d", p.t),
			(names.low or "Lowest of the day") .. ": " .. W.Money(p.low),
			(names.high ~= false and p.high and p.high ~= p.low) and ((names.high or "Highest") .. ": " .. W.Money(p.high)) or nil,
			p.qty and ("For sale (most seen): " .. p.qty) or nil)
	end)
	return c
end
