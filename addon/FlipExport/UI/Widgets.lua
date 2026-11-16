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
	GameTooltip:Show()
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
		row:SetScript("OnClick", function(self, button) if self.data and opts.onClick then opts.onClick(self.data, button) end end)
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
