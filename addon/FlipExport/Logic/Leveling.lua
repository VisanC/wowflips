-- FlipExport / Logic/Leveling.lua
-- Skill-up planner. A recipe can be used from its learn level; below yellow (orange) every
-- craft gives a point, from yellow to grey the chance falls in a straight line to zero:
-- chance = (grey - skill) / (grey - yellow). For each point the planner picks the recipe with
-- the lowest expected net cost per point (craft cost minus what the product sells for,
-- divided by the chance), adding a recipe's learn cost the first time it is used.

local _, ns = ...
local Leveling = {}
ns.Leveling = Leveling

local Data = ns.Data

function Leveling.Chance(r, skill)
	if skill < Data.LearnLevel(r) or skill >= r.grey then return 0 end
	if skill < r.yellow then return 1 end
	local span = r.grey - r.yellow
	return span > 0 and (r.grey - skill) / span or 0
end

--- locked | orange | yellow | green | grey
function Leveling.Color(r, skill)
	if skill < Data.LearnLevel(r) then return "locked" end
	if skill >= r.grey then return "grey" end
	if skill < r.yellow then return "orange" end
	return skill < (r.green or (r.yellow + r.grey) / 2) and "yellow" or "green"
end

--- Green level as shown (the real one when known, else halfway from yellow to grey).
function Leveling.Green(r) return r.green or math.floor((r.yellow + r.grey) / 2 + 0.5) end

--- @param netCost   function(r) -> copper per craft (cost minus resale), or nil when it can't be priced
--- @param learnCost function(r) -> one-time copper to learn it (0 when known)
function Leveling.Plan(recipes, from, to, netCost, learnCost)
	local steps, learned, nets = {}, {}, {}
	local function net(r)
		if nets[r.spell] == nil then nets[r.spell] = netCost(r) or false end
		return nets[r.spell] or nil
	end
	local skill = from
	while skill < to do
		local best
		for _, r in ipairs(recipes) do
			local chance = Leveling.Chance(r, skill)
			if chance > 0 then
				local n = net(r)
				if n and n == n and n ~= math.huge then
					-- a craft that makes money is worth doing however often it fails; the most profit wins
					local score = n >= 0 and n / chance or n
					if not best or score < best.score - 1e-9 or (math.abs(score - best.score) <= 1e-9 and chance > best.chance) then
						best = { r = r, chance = chance, n = n, score = score }
					end
				end
			end
		end
		if not best then break end
		local crafts = 1 / best.chance
		local last = steps[#steps]
		if last and last.recipe.spell == best.r.spell then
			last.to = skill + 1
			last.crafts = last.crafts + crafts
			last.total = last.total + best.n * crafts
		else
			local lc = 0
			if not learned[best.r.spell] then lc = (learnCost and learnCost(best.r)) or 0 end
			learned[best.r.spell] = true
			steps[#steps + 1] = { recipe = best.r, from = skill, to = skill + 1, crafts = crafts, netEach = best.n, total = best.n * crafts + lc, color = Leveling.Color(best.r, skill), learnCost = lc }
		end
		skill = skill + 1
	end
	local total, crafts = 0, 0
	for _, s in ipairs(steps) do total, crafts = total + s.total, crafts + s.crafts end
	return { steps = steps, total = total, crafts = crafts, reached = skill, stuckAt = skill < to and skill or nil }
end

--- Every recipe that can give a point at this skill, cheapest per point first.
--- Crafts expected to go from skill `from` to `to` with only this recipe (a point every 1/chance
--- crafts at each level), stopping where it turns grey: crafts, reach (the skill it gets to).
function Leveling.CraftsTo(r, from, to)
	local crafts, skill = 0, from
	while skill < to do
		local c = Leveling.Chance(r, skill)
		if c <= 0 then break end
		crafts = crafts + 1 / c
		skill = skill + 1
	end
	return crafts, skill
end

--- @param target optional skill to aim for: each row also gets toCrafts and reach (CraftsTo)
function Leveling.SkillUpsAt(recipes, skill, netCost, target)
	local out = {}
	for _, r in ipairs(recipes) do
		local chance = Leveling.Chance(r, skill)
		if chance > 0 then
			local n = netCost(r)
			if n and n == n and n ~= math.huge then
				local row = { recipe = r, chance = chance, color = Leveling.Color(r, skill), net = n, perPoint = n >= 0 and n / chance or n }
				if target then row.toCrafts, row.reach = Leveling.CraftsTo(r, skill, target) end
				out[#out + 1] = row
			end
		end
	end
	table.sort(out, function(a, b)
		if a.perPoint ~= b.perPoint then return a.perPoint < b.perPoint end
		return a.chance > b.chance
	end)
	return out
end

---------------------------------------------------------------------------
-- Learning recipes you don't know yet
---------------------------------------------------------------------------

--- Taught by a trainer: Recipe Master says so, the addon saw it at a trainer, or (a guess) no recipe item teaches it.
function Leveling.IsTrainerRecipe(r)
	if r.rm then return r.rm.trainer end
	return r.trainerSeen or not r.teachItem
end

--- Cheapest known way to learn it: { how = "trainer"|"vendor"|"ah"|"item"|"unknown", cost, text, item, guess }.
function Leveling.LearnCost(r, market)
	local opts = {}
	if Leveling.IsTrainerRecipe(r) then opts[#opts + 1] = { how = "trainer", cost = r.trainerCost, guess = not r.rm and not r.trainerSeen } end
	if r.rm and r.rm.vendorCost then opts[#opts + 1] = { how = "vendor", cost = r.rm.vendorCost } end
	local item = r.teachItem
	local ah = item and market and market:Ah(item)
	if ah and (ah.price or 0) > 0 then opts[#opts + 1] = { how = "ah", cost = ah.price, item = item } end
	for _, o in ipairs(opts) do
		if o.how == "trainer" and o.cost == nil then return o end
	end
	local best
	for _, o in ipairs(opts) do
		if o.cost and (not best or o.cost < best.cost) then best = o end
	end
	if best then return best end
	if r.rm and r.rm.vendorPrice then return { how = "vendor", text = r.rm.vendorPrice } end
	if item then return { how = "item", item = item } end
	return { how = "unknown" }
end

--- Specializations you have, judged by the recipes you know.
function Leveling.KnownSpecs(d, known)
	local out = {}
	for spell in pairs(known) do
		local r = d.bySpell[spell]
		if r and r.rm and r.rm.spec then out[r.rm.spec] = true end
	end
	return out
end

--- False for the other faction's recipes and a specialization you don't have.
function Leveling.CanLearn(r, faction, specs)
	if r.rm and r.rm.faction and faction and r.rm.faction ~= faction then return false end
	if r.rm and r.rm.spec and not specs[r.rm.spec] then return false end
	return true
end
