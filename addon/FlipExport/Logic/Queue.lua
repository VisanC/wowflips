-- FlipExport / Logic/Queue.lua
-- The craft queue: what you want to make, expanded into every craft needed (parts the plan
-- crafts, like bars, come first) and a shopping list of what to buy, after what you already
-- have in your bags and bank. Buy/craft follows the same engine (strategy and flipped parts)
-- as the Crafts tab.

local _, ns = ...
local Queue = {}
ns.Queue = Queue

--- Copper to buy `qty` on the AH, walking the known price levels (past them: the last price).
function Queue.AhCost(row, qty)
	if not row or qty <= 0 then return 0 end
	local levels = (row.levels and #row.levels > 0) and row.levels or { { row.price or row.min, math.huge } }
	local left, total, last = qty, 0, row.price or row.min
	for _, lv in ipairs(levels) do
		local take = math.min(left, lv[2] or 0)
		total = total + take * lv[1]
		left = left - take
		last = lv[1]
		if left <= 0 then break end
	end
	if left > 0 then total = total + left * math.max(last or 0, row.price or 0) end
	return total
end

--- @param engine     Engine (its strategy and overrides decide buy or craft)
--- @param entries    { { recipe = r, count = n }, ... } what you queued
--- @param inventory  { [item] = count } bags and bank
--- @return { crafts = { { recipe, count } } (parts first), buy = { { item, qty, have, need, kind, unit, cost } }, total = copper, missing = n }
function Queue.Expand(engine, entries, inventory)
	local stock = {}
	for k, v in pairs(inventory or {}) do stock[k] = v end
	local craftCount, craftOrder, need, buy = {}, {}, {}, {}
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

	local list, total, missing = {}, 0, 0
	for item, b in pairs(buy) do
		b.have = inventory and inventory[item] or 0
		b.need = need[item] or b.qty
		if b.kind == "ah" then
			b.cost = Queue.AhCost(engine.market:Ah(item), b.qty)
		elseif b.kind == "vendor" then
			b.cost = b.unit * b.qty
		else
			b.cost = nil
			missing = missing + 1
		end
		total = total + (b.cost or 0)
		list[#list + 1] = b
	end
	table.sort(list, function(a, b) return (a.cost or math.huge) > (b.cost or math.huge) end)
	return { crafts = crafts, buy = list, total = total, missing = missing }
end

--- How many of a recipe your bags allow right now (direct reagents).
function Queue.CraftableFrom(r, bags)
	local n = math.huge
	for _, rg in ipairs(r.reagents) do n = math.min(n, math.floor((bags[rg[1]] or 0) / rg[2])) end
	return n == math.huge and 0 or n
end
