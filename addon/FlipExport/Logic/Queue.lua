-- FlipExport / Logic/Queue.lua
-- The craft queue: what you want to make, expanded into every craft needed (parts the plan
-- crafts, like bars, come first) and a shopping list of what to buy, after what you already
-- have in your bags and bank. Buy/craft follows the same engine (strategy and flipped parts)
-- as the Crafts tab.

local _, ns = ...
local Queue = {}
ns.Queue = Queue

--- Buying `qty` on the AH, cheapest listings first.
--- @return total copper, top (what the last unit costs), est (true when it went past the known
--- listings of an item whose listings weren't all seen: the rest is priced at the dearest known
--- price, so the real cost can be higher), short (units more than are on the AH)
function Queue.AhWalk(row, qty)
	if not row then return 0, nil, false, 0 end
	local base = row.price or row.min or 0
	if qty <= 0 then return 0, base, false, 0 end
	local left, total, last = qty, 0, nil
	for _, lv in ipairs(row.levels or {}) do
		local take = math.min(left, lv[2] or 0)
		if take > 0 then
			total = total + take * lv[1]
			last = lv[1]
			left = left - take
		end
		if left <= 0 then break end
	end
	local est, short = false, 0
	if left > 0 then
		local price = math.max(last or 0, base)
		total = total + left * price
		last = price
		if row.complete then
			short = left
		else
			est = true
			if (row.qty or 0) > 0 and qty > row.qty then short = qty - row.qty end
		end
	end
	return total, last, est, short
end

--- Copper to buy `qty` on the AH, walking the listings.
function Queue.AhCost(row, qty) return (Queue.AhWalk(row, qty)) end

--- What the k-th unit bought costs (listings cheapest first). price, est, gone: est = past the
--- known listings (priced at the dearest known), gone = more than are on the AH.
function Queue.PriceAt(row, k)
	if not row then return nil, false, true end
	local seen, last = 0, nil
	for _, lv in ipairs(row.levels or {}) do
		seen = seen + (lv[2] or 0)
		last = lv[1]
		if k <= seen then return lv[1], false, false end
	end
	local price = math.max(last or 0, row.price or row.min or 0)
	if row.complete then return price, false, true end
	return price, true, (row.qty or 0) > 0 and k > row.qty
end

--- @param engine     Engine (its strategy and overrides decide buy or craft)
--- @param entries    { { recipe = r, count = n }, ... } what you queued
--- @param inventory  { [item] = count } bags and bank
--- @return { crafts = { { recipe, count } } (parts first), buy = { { item, qty, have, need, kind, unit, cost } }, total = copper, missing = n }
function Queue.Expand(engine, entries, inventory)
	local stock = {}
	for k, v in pairs(inventory or {}) do stock[k] = v end
	local craftCount, craftOrder, need, buy, used = {}, {}, {}, {}, {}
	local depthOf = {}

	local function mode(item)
		return (engine.opts.overrides and engine.opts.overrides[item]) or engine.opts.strategy or "best"
	end

	-- How many crafts of r what you have allows, making its parts from what you have too
	-- (ore you own -> bars -> bronze bars). Counts each part on its own, so it can promise a
	-- little more than there is when parts share materials; the rest is then bought.
	local fromStock
	local function canMake(item, path, level)
		local have = math.max(0, stock[item] or 0)
		if level > 3 or mode(item) == "buy" then return have end
		for _, r in ipairs(engine.d.byOutput[item] or {}) do
			if not r.gather and not path[r.spell] and engine:Allowed(r) then
				have = have + fromStock(r, path, level + 1) * r.qty
			end
		end
		return have
	end
	function fromStock(r, path, level)
		local sub = {}
		for k in pairs(path) do sub[k] = true end
		sub[r.spell] = true
		local n = math.huge
		for _, rg in ipairs(r.reagents) do
			n = math.min(n, math.floor(canMake(rg[1], sub, level) / rg[2]))
			if n <= 0 then return 0 end
		end
		return n == math.huge and 0 or n
	end

	local addCraft
	local function want(item, qty, depth)
		need[item] = (need[item] or 0) + qty
		local use = math.min(math.max(0, stock[item] or 0), qty)
		stock[item] = (stock[item] or 0) - use
		if use > 0 then used[item] = (used[item] or 0) + use end
		qty = qty - use
		if qty <= 0 then return end
		-- what you already have comes first: craft it from your materials (the ore you bought)
		-- before the cheapest way from the market, which may since have changed
		if mode(item) ~= "buy" then
			for _, r in ipairs(engine.d.byOutput[item] or {}) do
				if qty <= 0 then break end
				if not r.gather and engine:Allowed(r) then
					local n = math.min(fromStock(r, {}, 1), math.ceil(qty / r.qty - 1e-9))
					if n > 0 then
						stock[item] = (stock[item] or 0) + n * r.qty
						addCraft(r, n, depth + 1)
						local take = math.min(qty, n * r.qty)
						stock[item] = stock[item] - take
						qty = qty - take
					end
				end
			end
			if qty <= 0 then return end
		end
		local src = engine:UnitCost(item)
		if src.kind == "craft" then
			local r = src.recipe
			local n = math.ceil(qty / r.qty - 1e-9)
			addCraft(r, n, depth + 1)
			stock[item] = (stock[item] or 0) + n * r.qty - qty -- leftover from whole crafts
		else
			local b = buy[item]
			if not b then
				b = { item = item, qty = 0, kind = src.kind, unit = src.unit }
				buy[item] = b
			end
			b.qty = b.qty + qty
		end
	end

	function addCraft(r, n, depth)
		if not craftCount[r.spell] then
			craftCount[r.spell] = 0
			craftOrder[#craftOrder + 1] = r
		end
		craftCount[r.spell] = craftCount[r.spell] + n
		depthOf[r.spell] = math.max(depthOf[r.spell] or 0, depth)
		for _, rg in ipairs(r.reagents) do want(rg[1], rg[2] * n, depth) end
	end

	for _, e in ipairs(entries) do
		if e.count > 0 and not e.recipe.gather then addCraft(e.recipe, e.count, 0) end
	end

	-- parts first: deepest crafts before the ones that use them
	local crafts = {}
	for i, r in ipairs(craftOrder) do crafts[#crafts + 1] = { recipe = r, count = craftCount[r.spell], depth = depthOf[r.spell], order = i } end
	table.sort(crafts, function(a, b)
		if a.depth ~= b.depth then return a.depth > b.depth end
		return a.order < b.order
	end)

	local list, total, missing, extra, est, short = {}, 0, 0, 0, false, false
	for item, b in pairs(buy) do
		b.have = inventory and inventory[item] or 0
		b.need = need[item] or b.qty
		if b.kind == "ah" then
			local row = engine.market:Ah(item)
			b.cost, b.top, b.est, b.short = Queue.AhWalk(row, b.qty)
			-- what the same amount would cost if every unit were at the cheapest price
			b.rise = math.max(0, b.cost - b.qty * ((row and row.min) or b.unit or 0))
			extra = extra + b.rise
			est = est or b.est
			short = short or (b.short or 0) > 0
		elseif b.kind == "vendor" then
			b.cost, b.top, b.rise = b.unit * b.qty, b.unit, 0
		else
			b.cost = nil
			missing = missing + 1
		end
		total = total + (b.cost or 0)
		list[#list + 1] = b
	end
	table.sort(list, function(a, b) return (a.cost or math.huge) > (b.cost or math.huge) end)
	-- what you have that the queue uses, at what it would cost to get
	local ownValue = 0
	for item, n in pairs(used) do
		local u = engine:UnitCost(item).unit
		if u and u < math.huge then ownValue = ownValue + n * u end
	end
	return { crafts = crafts, buy = list, total = total, missing = missing, extra = extra, est = est, short = short, ownValue = ownValue, used = used }
end

--- What one craft of r takes from the market, all the way down (parts the plan crafts are
--- broken into what they're made from): { { item, q = per craft, kind = "ah"|"vendor"|... } }.
local PER = 60 -- crafts to average over: whole crafts of parts that make 2, 3, 4, 5 or 6
function Queue.PerCraft(engine, r)
	local x = Queue.Expand(engine, { { recipe = r, count = PER } }, {})
	local per = {}
	for _, b in ipairs(x.buy) do per[#per + 1] = { item = b.item, q = b.qty / PER, kind = b.kind, unit = b.unit } end
	return per
end

--- The queue with costs that rise as you buy deeper into the listings:
--- x = Expand(...) plus revenue (what the queued crafts sell for, after the AH cut), profit
--- (revenue - what you buy - your own materials it uses, at their price), caps[item] (the most
--- a unit is worth paying: past it the last craft loses money, the other parts at their
--- dearest), and per queued recipe in x.entries[spell]: { revenue, profit (on its own),
--- marginal (profit of its last craft), best (how many are worth making), bestEst, bestBy }.
function Queue.Plan(engine, entries, inventory)
	local x = Queue.Expand(engine, entries, inventory)
	local buyOf = {}
	for _, b in ipairs(x.buy) do buyOf[b.item] = b end
	x.revenue, x.entries, x.caps = 0, {}, {}
	for _, e in ipairs(entries) do
		local r, n = e.recipe, e.count
		local ev = engine:Evaluate(r)
		local rev = ev.revenue or 0 -- one craft, after the AH cut
		local info = { revenue = rev * n, perCraft = rev }
		x.revenue = x.revenue + rev * n
		-- on its own, for its row
		local alone = #entries == 1 and x or Queue.Expand(engine, { e }, inventory)
		info.profit = alone.missing == 0 and (rev * n - alone.total - alone.ownValue) or nil
		local per = Queue.PerCraft(engine, r)
		-- profit of the craft number n + extra: what it sells for minus its parts at the price of
		-- the units bought for it (the queue's other demand stays as it is)
		local function marginal(extra)
			local cost, est, gone = 0, false, false
			for _, p in ipairs(per) do
				if p.kind == "ah" then
					local row = engine.market:Ah(p.item)
					local bought = ((buyOf[p.item] and buyOf[p.item].qty) or 0) + extra * p.q
					local price, e2, g2 = Queue.PriceAt(row, math.max(1, math.ceil(bought - 1e-9)))
					if not price then return -math.huge, false, true end
					cost = cost + p.q * price
					est, gone = est or e2, gone or (bought > 0 and g2)
				elseif p.kind == "vendor" then
					cost = cost + p.q * p.unit
				else
					return nil
				end
			end
			if gone then return -math.huge, est, true end
			return rev - cost, est, false
		end
		local m = marginal(0)
		info.marginal = m ~= -math.huge and m or nil
		if m ~= nil and #per > 0 then
			-- the most worth making: the last craft still pays (binary search; the parts only get dearer)
			local function ok(k)
				local v = marginal(k - n)
				return v ~= nil and v >= 0
			end
			local best
			if not ok(1) then
				best = 0
			else
				local lo, hi = 1, math.max(2, n)
				while ok(hi) and hi < 100000 do lo, hi = hi, hi * 2 end
				if ok(hi) then lo = hi end
				while hi - lo > 1 do
					local mid = math.floor((lo + hi) / 2)
					if ok(mid) then lo = mid else hi = mid end
				end
				best = lo
			end
			local _, est, gone = marginal(best + 1 - n)
			info.best, info.bestEst = best, est
			info.bestBy = gone and "supply" or "price"
			-- the most each part is worth paying for the queued amount
			if m ~= -math.huge then
				for _, p in ipairs(per) do
					if p.kind == "ah" and p.q > 0 then
						local row = engine.market:Ah(p.item)
						local bought = (buyOf[p.item] and buyOf[p.item].qty) or 0
						local price = Queue.PriceAt(row, math.max(1, math.ceil(bought - 1e-9)))
						if price then
							local cap = price + m / p.q
							x.caps[p.item] = math.min(x.caps[p.item] or math.huge, cap)
						end
					end
				end
			end
		end
		x.entries[r.spell] = info
	end
	for _, b in ipairs(x.buy) do b.cap = x.caps[b.item] end
	x.profit = x.missing == 0 and (x.revenue - x.total - x.ownValue) or nil
	return x
end

--- How many of a recipe your bags allow right now (direct reagents).
function Queue.CraftableFrom(r, bags)
	local n = math.huge
	for _, rg in ipairs(r.reagents) do n = math.min(n, math.floor((bags[rg[1]] or 0) / rg[2])) end
	return n == math.huge and 0 or n
end
