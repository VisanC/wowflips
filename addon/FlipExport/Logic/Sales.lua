-- FlipExport / Logic/Sales.lua
-- Your own auction house history from the AH mails the addon reads at the mailbox
-- (sales, purchases, expired and cancelled auctions) and the crafts it counts.

local _, ns = ...
local Sales = {}
ns.Sales = Sales

--- Local midnight of a time, as unix seconds.
function Sales.LocalDay(t)
	local d = date("*t", t)
	return time({ year = d.year, month = d.month, day = d.day, hour = 0 })
end

--- @param ledger  { mail = { [key] = { k, n, i, c, p, f, d, t } }, crafts = { ["spell|hour"] = n } }
--- @param opts    { now, days = 30, nameToId = function(name) -> id }
function Sales.Summarize(d, ledger, opts)
	opts = opts or {}
	local now = opts.now or time()
	local span = opts.days or 30
	local items, byKey = {}, {}
	local function get(id, name)
		if (id or 0) == 0 and opts.nameToId then id = opts.nameToId(name) or 0 end
		local key = (id or 0) ~= 0 and tostring(id) or ("n:" .. tostring(name))
		local e = byKey[key]
		if not e then
			e = {
				key = key, item = id or 0,
				name = ((id or 0) ~= 0 and ns.Data.ItemName(d, id)) or name or "?",
				soldUnits = 0, soldAuctions = 0, gross = 0, net = 0, expired = 0, cancelled = 0,
				boughtUnits = 0, spent = 0, crafted = 0, sales = {},
			}
			byKey[key] = e
			items[#items + 1] = e
		end
		return e
	end

	local today = Sales.LocalDay(now)
	local days, byDay = {}, {}
	for i = span - 1, 0, -1 do
		local day = Sales.LocalDay(today - i * 86400 + 43200) -- noon avoids daylight-saving edges
		local t = { day = day, income = 0, spend = 0 }
		days[#days + 1] = t
		byDay[day] = t
	end

	local income7, income30, spend30, sold30, unsold30, mails = 0, 0, 0, 0, 0, 0
	for _, m in pairs((ledger and ledger.mail) or {}) do
		mails = mails + 1
		local e = get(m.i, m.n)
		local recent = m.t >= now - 30 * 86400
		local dt = byDay[Sales.LocalDay(m.t)]
		if m.k == "sold" then
			local net = (m.p or 0) - (m.f or 0)
			e.soldUnits = e.soldUnits + (m.c or 1)
			e.soldAuctions = e.soldAuctions + 1
			e.gross = e.gross + (m.p or 0)
			e.net = e.net + net
			e.lastSale = math.max(e.lastSale or 0, m.t)
			e.sales[#e.sales + 1] = { t = m.t, unit = (m.p or 0) / math.max(1, m.c or 1), count = m.c or 1 }
			if dt then dt.income = dt.income + net end
			if recent then income30, sold30 = income30 + net, sold30 + 1 end
			if m.t >= now - 7 * 86400 then income7 = income7 + net end
		elseif m.k == "won" then
			e.boughtUnits = e.boughtUnits + (m.c or 1)
			e.spent = e.spent + (m.p or 0)
			if dt then dt.spend = dt.spend + (m.p or 0) end
			if recent then spend30 = spend30 + (m.p or 0) end
		else
			if m.k == "expired" then e.expired = e.expired + 1 else e.cancelled = e.cancelled + 1 end
			if recent then unsold30 = unsold30 + 1 end
		end
	end
	for key, n in pairs((ledger and ledger.crafts) or {}) do
		local spell = tonumber(tostring(key):match("^(%d+)|"))
		local r = spell and d.bySpell[spell]
		if r then
			local e = get(r.out, nil)
			e.crafted = e.crafted + n * r.qty
		end
	end
	for _, e in ipairs(items) do table.sort(e.sales, function(a, b) return a.t < b.t end) end
	return {
		items = items, days = days, mails = mails,
		income7 = income7, income30 = income30, spend30 = spend30,
		sellThrough30 = (sold30 + unsold30) > 0 and sold30 / (sold30 + unsold30) or nil,
	}
end
