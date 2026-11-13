-- FlipExport / Core.lua
-- Pure helpers with no WoW API calls, so they can be tested outside the game:
-- JSON encoding, Base64, auction aggregation and the export string format.

local _, ns = ...
ns = ns or {}

local Core = {}
ns.Core = Core

Core.PREFIX = "FLIPX1:"

local type, pairs, tostring, floor, format = type, pairs, tostring, math.floor, string.format
local concat, byte, char, sub, gsub = table.concat, string.byte, string.char, string.sub, string.gsub

---------------------------------------------------------------------------
-- JSON
---------------------------------------------------------------------------

local escapes = { ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }

local function escapeString(s)
	return '"' .. gsub(s, '[%c"\\]', function(c)
		return escapes[c] or format("\\u%04x", byte(c))
	end) .. '"'
end

local function isArray(t)
	local n = 0
	for k in pairs(t) do
		if type(k) ~= "number" or k < 1 or k % 1 ~= 0 then return false end
		n = n + 1
	end
	for i = 1, n do
		if t[i] == nil then return false end
	end
	return true
end

local function encode(v, buf)
	local tv = type(v)
	if v == nil then
		buf[#buf + 1] = "null"
	elseif tv == "boolean" then
		buf[#buf + 1] = v and "true" or "false"
	elseif tv == "number" then
		if v ~= v or v == math.huge or v == -math.huge then
			buf[#buf + 1] = "null"
		elseif v % 1 == 0 and v > -2^53 and v < 2^53 then
			buf[#buf + 1] = format("%d", v)
		else
			buf[#buf + 1] = format("%.14g", v)
		end
	elseif tv == "string" then
		buf[#buf + 1] = escapeString(v)
	elseif tv == "table" then
		if isArray(v) then
			buf[#buf + 1] = "["
			for i = 1, #v do
				if i > 1 then buf[#buf + 1] = "," end
				encode(v[i], buf)
			end
			buf[#buf + 1] = "]"
		else
			buf[#buf + 1] = "{"
			local first = true
			for k, val in pairs(v) do
				if not first then buf[#buf + 1] = "," end
				first = false
				buf[#buf + 1] = escapeString(tostring(k))
				buf[#buf + 1] = ":"
				encode(val, buf)
			end
			buf[#buf + 1] = "}"
		end
	else
		buf[#buf + 1] = "null"
	end
end

function Core.ToJSON(value)
	local buf = {}
	encode(value, buf)
	return concat(buf)
end

---------------------------------------------------------------------------
-- Base64 (standard alphabet, with padding)
---------------------------------------------------------------------------

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local b64chars = {}
for i = 1, 64 do b64chars[i - 1] = sub(B64, i, i) end

function Core.Base64(data)
	local out, n = {}, #data
	local i = 1
	while i <= n - 2 do
		local a, b, c = byte(data, i, i + 2)
		local v = a * 65536 + b * 256 + c
		out[#out + 1] = b64chars[floor(v / 262144)] .. b64chars[floor(v / 4096) % 64]
			.. b64chars[floor(v / 64) % 64] .. b64chars[v % 64]
		i = i + 3
	end
	local rest = n - i + 1
	if rest == 2 then
		local a, b = byte(data, i, i + 1)
		local v = a * 65536 + b * 256
		out[#out + 1] = b64chars[floor(v / 262144)] .. b64chars[floor(v / 4096) % 64] .. b64chars[floor(v / 64) % 64] .. "="
	elseif rest == 1 then
		local v = byte(data, i) * 65536
		out[#out + 1] = b64chars[floor(v / 262144)] .. b64chars[floor(v / 4096) % 64] .. "=="
	end
	return concat(out)
end

---------------------------------------------------------------------------
-- Auction aggregation: one row per item with the lowest unit price,
-- the total quantity listed and the cheapest few price levels.
---------------------------------------------------------------------------

function Core.NewAggregator()
	local items = {}
	local agg = { auctions = 0 }

	function agg:Add(itemID, unitPrice, quantity)
		if not itemID or not unitPrice or unitPrice <= 0 or not quantity or quantity <= 0 then return end
		self.auctions = self.auctions + 1
		local e = items[itemID]
		if not e then
			e = { min = unitPrice, qty = 0, levels = {} }
			items[itemID] = e
		end
		if unitPrice < e.min then e.min = unitPrice end
		e.qty = e.qty + quantity
		e.levels[unitPrice] = (e.levels[unitPrice] or 0) + quantity
	end

	-- Returns { {itemID, minUnit, totalQty, {{price, qty}, ...}}, ... }
	function agg:Result(maxLevels)
		maxLevels = maxLevels or 5
		local rows = {}
		for itemID, e in pairs(items) do
			local prices = {}
			for p in pairs(e.levels) do prices[#prices + 1] = p end
			table.sort(prices)
			local levels = {}
			for i = 1, math.min(maxLevels, #prices) do
				levels[i] = { prices[i], e.levels[prices[i]] }
			end
			rows[#rows + 1] = { itemID, e.min, e.qty, levels }
		end
		table.sort(rows, function(a, b) return a[1] < b[1] end)
		return rows
	end

	return agg
end

-- Item counts map {[itemID] = count} -> sorted list {{itemID, count}, ...}
function Core.CountsToList(map)
	local list = {}
	for id, count in pairs(map) do list[#list + 1] = { id, count } end
	table.sort(list, function(a, b) return a[1] < b[1] end)
	return list
end

---------------------------------------------------------------------------
-- Export string: PREFIX .. base64(rawDeflate(json))
---------------------------------------------------------------------------

function Core.Encode(payload, LibDeflate, level)
	local json = Core.ToJSON(payload)
	local compressed = LibDeflate:CompressDeflate(json, { level = level or 5 })
	return Core.PREFIX .. Core.Base64(compressed), #json
end
