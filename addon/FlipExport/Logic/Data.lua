-- FlipExport / Logic/Data.lua
-- The game data (Data/GameData.lua) as lookups, learn levels and skill-up levels, and
-- gathered items as zero-cost "recipes". No WoW API here except item info fallbacks.

local _, ns = ...
local Data = {}
ns.Data = Data

Data.GATHER_SKILLS = { Mining = 186, Herbalism = 182, Skinning = 393, Fishing = 356 }
-- Items you only get as a bonus while gathering something else (stone, gems, some herbs).
Data.BONUS = {}
for _, id in ipairs({ 2835, 2836, 2838, 7912, 12365, 774, 818, 1210, 1705, 1206, 1529, 3864, 7909, 7910, 12799, 12364, 12800, 12361, 12363, 2452, 8153 }) do
	Data.BONUS[id] = true
end
Data.SPECS = {
	[20219] = "Gnomish", [20222] = "Goblin", [9787] = "Weaponsmith", [9788] = "Armorsmith",
	[17039] = "Swordsmith", [17040] = "Hammersmith", [17041] = "Axesmith",
	[10656] = "Dragonscale", [10658] = "Elemental", [10660] = "Tribal",
}

--- Builds lookups from the raw game data table.
function Data.Build(raw)
	raw = raw or {}
	local d = {
		build = raw.build or "?",
		items = {}, recipes = {}, bySpell = {}, byOutput = {},
		skills = {}, skillByName = {},
		vendorReagents = raw.vendorReagents or {}, gather = raw.gather or {},
	}
	for id, t in pairs(raw.items or {}) do
		d.items[id] = { id = id, name = t[1], quality = t[2], sell = t[3], buy = t[4], vstack = t[5], stack = t[6] }
	end
	for _, t in ipairs(raw.recipes or {}) do
		local reagents, flat = {}, t[8] or {}
		for i = 1, #flat, 2 do reagents[#reagents + 1] = { flat[i], flat[i + 1] } end
		local r = {
			spell = t[1], name = t[2], skill = t[3], yellow = t[4], grey = t[5], out = t[6], qty = math.max(1, t[7] or 1),
			reagents = reagents,
			learnBase = (t[9] or 0) > 0 and t[9] or nil,
			teachItem = (t[10] or 0) > 0 and t[10] or nil,
		}
		r.base = { yellow = r.yellow, grey = r.grey, teachItem = r.teachItem }
		r.learn = r.learnBase
		d.recipes[#d.recipes + 1] = r
		d.bySpell[r.spell] = r
		local list = d.byOutput[r.out]
		if not list then list = {}; d.byOutput[r.out] = list end
		list[#list + 1] = r
	end
	for id, name in pairs(raw.skills or {}) do d.skills[id] = name end
	for name, id in pairs(Data.GATHER_SKILLS) do d.skills[id] = d.skills[id] or name end
	for id, name in pairs(d.skills) do d.skillByName[name] = id end
	-- Gathered items: zero-cost recipes (spell id = -item id), usable from the node's skill level.
	d.gathers = {}
	for prof, list in pairs(d.gather) do
		local skill = Data.GATHER_SKILLS[prof]
		for _, e in ipairs(list) do
			local item = d.items[e[1]]
			if skill and item then
				d.gathers[#d.gathers + 1] = {
					spell = -e[1], name = prof .. ": " .. item.name, skill = skill, yellow = e[2], grey = e[2],
					out = e[1], qty = 1, reagents = {}, gather = true, bonus = Data.BONUS[e[1]],
				}
			end
		end
	end
	return d
end

local getItemInfo = (C_Item and C_Item.GetItemInfo) or GetItemInfo

function Data.ItemName(d, id)
	local name = getItemInfo and getItemInfo(id)
	if type(name) == "string" and name ~= "" then return name end
	local it = d.items[id]
	return it and it.name or ("Item " .. tostring(id))
end

--- What a vendor pays for one (game data, else the item cache).
function Data.ItemSell(d, id)
	local it = d.items[id]
	if it then return it.sell or 0 end
	if getItemInfo then
		local sell = select(11, getItemInfo(id))
		if type(sell) == "number" then return sell end
	end
	return 0
end

function Data.ItemQuality(d, id)
	local it = d.items[id]
	if it then return it.quality or 1 end
	if getItemInfo then
		local q = select(3, getItemInfo(id))
		if type(q) == "number" then return q end
	end
	return 1
end

--- Skill needed to learn it; unknown (no Recipe Master, no recipe item, no trainer list): its yellow level as a guess.
function Data.LearnLevel(r) return r.learn or r.yellow end
function Data.LearnKnown(r) return r.learn ~= nil end

--- Learn levels, skill-up levels and learn costs, in order of trust: Recipe Master's data
--- (Data/RecipeMaster.lua, made on your PC), the trainer lists the addon saw, the recipe item.
function Data.ApplyLearnData(d, char, rm)
	for _, r in ipairs(d.recipes) do
		r.yellow, r.grey, r.teachItem = r.base.yellow, r.base.grey, r.base.teachItem
		r.learn, r.green, r.trainerCost, r.trainerSeen, r.rm = r.learnBase, nil, nil, nil, nil
	end
	for prof, tr in pairs((char and char.trainers) or {}) do
		local skill = d.skillByName[prof]
		if skill then
			local byOut, byName = {}, {}
			for _, r in ipairs(d.recipes) do
				if r.skill == skill then
					byOut[r.out] = byOut[r.out] or r
					byName[r.name:lower()] = byName[r.name:lower()] or r
				end
			end
			for _, s in ipairs(tr.l or {}) do
				local name, rank, cost, item = s[1], s[2], s[3], s[5]
				local r = (item and item ~= 0 and byOut[item]) or (type(name) == "string" and byName[name:lower()])
				if r then
					if (rank or 0) > 0 then r.learn = rank end
					r.trainerCost, r.trainerSeen = cost, true
				end
			end
		end
	end
	for spell, x in pairs((rm and rm.r) or {}) do
		local r = d.bySpell[spell]
		if r then
			-- { learn, orange, yellow, green, grey, trainer, vendor copper, vendor price text, faction, specialization, key item }
			r.learn = x[1]
			if (x[5] or 0) > 0 then r.yellow, r.green, r.grey = x[3], x[4], x[5] end
			local key = x[11]
			if key and key ~= r.out and key ~= spell then r.teachItem = key elseif x[6] == 1 then r.teachItem = nil end
			r.rm = {
				trainer = x[6] == 1,
				vendorCost = (x[7] or 0) > 0 and x[7] or nil,
				vendorPrice = (x[8] or "") ~= "" and x[8] or nil,
				faction = (x[9] or "") ~= "" and x[9] or nil,
				spec = (x[10] or 0) > 0 and x[10] or nil,
			}
		end
	end
end

--- Your professions: name -> { skill = skill line id, rank, max }. From the profession windows and the skill list.
function Data.Professions(d, char)
	local out = {}
	for name, p in pairs((char and char.profs) or {}) do
		local id = d.skillByName[name]
		if id then out[name] = { skill = id, rank = p.r or 0, max = p.m or 0, known = p.s } end
	end
	for _, s in ipairs((char and char.skills) or {}) do
		local name, rank, max = s[1], s[2], s[3]
		local id = d.skillByName[name]
		if id and (not out[name] or (rank or 0) > out[name].rank) then
			out[name] = out[name] or { skill = id, known = {} }
			out[name].rank, out[name].max = rank or 0, math.max(max or 0, out[name].max or 0)
		end
	end
	return out
end

--- Spell ids you know, as a set.
function Data.KnownSpells(char)
	local set = {}
	for _, p in pairs((char and char.profs) or {}) do
		for _, s in ipairs(p.s or {}) do set[s] = true end
	end
	return set
end

--- Gathered items for a scope: 'known' (your skill reaches the node), 'profession' (your gathering professions) or 'all'.
function Data.GathersFor(d, profs, scope)
	local out = {}
	for _, g in ipairs(d.gathers) do
		local p = profs[d.skills[g.skill]]
		if scope == "all" or (p and (scope == "profession" or p.rank >= g.yellow)) then out[#out + 1] = g end
	end
	return out
end
