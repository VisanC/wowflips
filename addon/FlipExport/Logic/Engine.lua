-- FlipExport / Logic/Engine.lua
-- What an item really costs you, and what a craft really earns. An item's cost is the cheapest
-- of buying it (AH or vendor) or crafting it, each reagent costed the same way. Crafting only
-- uses recipes the options allow and never loops back into itself. On a tie (within half a
-- copper) it crafts from the cheaper raw material, e.g. smelts ore rather than buying bars.
-- Strategies for parts (the recipe itself is always crafted): best, buy, craft; and per-item
-- overrides (a part flipped to buy or craft).

local _, ns = ...
local Engine = {}
Engine.__index = Engine
ns.Engine = Engine

local TIE = 0.5
local INF = math.huge
local NONE = { kind = "none", unit = INF }

--- @param d       game data
--- @param market  Prices.Build result
--- @param opts    { cut = 0.05, craftMode = "known"|"profession"|"all"|"none", known = set, profSkills = set, strategy = "best"|"buy"|"craft", overrides = { [item] = "buy"|"craft" } }
function Engine.New(d, market, opts)
	return setmetatable({ d = d, market = market, opts = opts, memo = {} }, Engine)
end

function Engine:Allowed(r)
	local mode = self.opts.craftMode or "known"
	if mode == "none" then return false end
	if mode == "all" then return true end
	if mode == "profession" then return (self.opts.known[r.spell] or (self.opts.profSkills and self.opts.profSkills[r.skill])) and true or false end
	return self.opts.known[r.spell] and true or false
end

--- Cheapest way to buy one (AH or vendor), ignoring crafting.
function Engine:MarketSource(item)
	local best = NONE
	local ah = self.market:Ah(item)
	if ah and (ah.price or 0) > 0 then best = { kind = "ah", unit = ah.price } end
	local vendor = self.market.vendor[item]
	if vendor and vendor < best.unit then best = { kind = "vendor", unit = vendor } end
	return best
end

local function copySet(path, add)
	local n = {}
	for k in pairs(path) do n[k] = true end
	n[add] = true
	return n
end

function Engine:ReagentCost(r, path)
	local cost, complete, parts = 0, true, {}
	for _, rg in ipairs(r.reagents) do
		local item, count = rg[1], rg[2]
		local source = self:UnitCost(item, path)
		if source.unit == INF then complete = false else cost = cost + source.unit * count end
		parts[#parts + 1] = { item = item, count = count, source = source }
	end
	return cost, parts, complete
end

--- Cheapest way to craft one, reagents got this engine's way; nil if no usable recipe has prices.
function Engine:CraftSource(item, path)
	path = path or {}
	local crafted
	for _, r in ipairs(self.d.byOutput[item] or {}) do
		if self:Allowed(r) and not path[r.spell] then
			local cost, parts, complete = self:ReagentCost(r, copySet(path, r.spell))
			if complete then
				local unit = cost / r.qty
				if not crafted or unit < crafted.unit then crafted = { kind = "craft", unit = unit, recipe = r, parts = parts } end
			end
		end
	end
	return crafted
end

--- How to get one unit of `item` under this engine's strategy.
function Engine:UnitCost(item, path)
	path = path or {}
	local top = next(path) == nil
	if top and self.memo[item] then return self.memo[item] end
	local bought = self:MarketSource(item)
	local mode = (self.opts.overrides and self.opts.overrides[item]) or self.opts.strategy or "best"
	local best = bought
	if mode ~= "buy" or bought.unit == INF then
		local crafted = self:CraftSource(item, path)
		if crafted and (mode == "craft" or crafted.unit <= bought.unit + TIE) then best = crafted end
	end
	if top then self.memo[item] = best end
	return best
end

--- Both ways to get one unit, which one is picked, and why.
--- reason: cheaper | tie-craft | tie-buy | plan | no-recipe | not-sold | no-price
function Engine:Explain(item, chosen)
	chosen = chosen or self:UnitCost(item)
	local buy = self:MarketSource(item)
	local craft = chosen.kind == "craft" and chosen or self:CraftSource(item)
	local canBuy = buy.unit ~= INF
	local pick = chosen.kind == "craft" and "craft" or (canBuy and "buy" or "none")
	local reason
	if pick == "none" then reason = "no-price"
	elseif not craft then reason = "no-recipe"
	elseif not canBuy then reason = "not-sold"
	elseif math.abs(craft.unit - buy.unit) <= TIE then reason = pick == "craft" and "tie-craft" or "tie-buy"
	elseif pick == "craft" then reason = craft.unit < buy.unit and "cheaper" or "plan"
	else reason = buy.unit < craft.unit and "cheaper" or "plan" end
	local other = pick == "craft" and buy.unit or (craft and craft.unit)
	return { buy = buy, craft = craft, pick = pick, reason = reason, saving = (other and other ~= INF) and (other - chosen.unit) or 0 }
end

--- A recipe's cost, revenue and profit per craft.
function Engine:Evaluate(r, inventory)
	inventory = inventory or {}
	local cost, parts, complete = self:ReagentCost(r, { [r.spell] = true })
	local ah = self.market:Ah(r.out)
	local vendorUnit = ns.Data.ItemSell(self.d, r.out)
	local ahNet = ah and ah.price * (1 - (self.opts.cut or 0.05)) or 0
	local channel = (ah and ahNet >= vendorUnit) and "ah" or "vendor"
	local revenue = math.max(ahNet, vendorUnit) * r.qty
	local profit = revenue - cost
	local craftable = INF
	for _, rg in ipairs(r.reagents) do craftable = math.min(craftable, math.floor((inventory[rg[1]] or 0) / rg[2])) end
	return {
		recipe = r, cost = cost, parts = parts, complete = complete,
		ahUnit = ah and ah.price, ahQty = ah and ah.qty or 0, ahSrc = ah and ah.src,
		vendorUnit = vendorUnit, revenue = revenue, channel = channel,
		profit = profit, margin = cost > 0 and profit / cost or 0,
		craftableNow = craftable == INF and 0 or craftable,
	}
end
