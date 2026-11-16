-- FlipExport / Logic/QuietTSM.lua
-- TradeSkillMaster for its data only: Forever Flips reads TSM's prices and sales through
-- TSM_API, and (unless /flip tsm turns it off) keeps TSM out of sight by setting TSM's own
-- options before TSM reads them: Blizzard's windows at the AH, mailbox, vendors and
-- professions, no TSM banking or task-list window, no destroy pop-up, no TSM tooltip lines,
-- no minimap icon. Forever Flips loads before TSM (alphabetical, no dependency), so it sees
-- TSM's ADDON_LOADED first. It also notes when the TSM app's data was downloaded, so TSM's
-- prices can win over an older scan.

local _, ns = ...

local QUIET = {
	["g@ @auctionUIContext@showDefault"] = true,
	["g@ @craftingUIContext@showDefault"] = true,
	["g@ @mailingUIContext@showDefault"] = true,
	["g@ @vendoringUIContext@showDefault"] = true,
	["g@ @bankingUIContext@isOpen"] = false,
	["g@ @taskListUIContext@isOpen"] = false,
	["g@ @destroyingOptions@autoShow"] = false,
	["g@ @tooltipOptions@enabled"] = false,
}

ns.tsmTimes = {} -- "TAG|realmOrRegion" -> download time of the TSM app's data

local function quietWanted()
	local ui = FlipExportDB and FlipExportDB.ui
	return not (ui and ui.quietTsm == false)
end

--- Sets TSM's options so it stays out of sight. Only keys TSM already has are touched.
function ns.QuietTSM()
	local db = TradeSkillMasterDB
	if type(db) ~= "table" or not quietWanted() then return false end
	for key, value in pairs(QUIET) do
		if db[key] ~= nil then db[key] = value end
	end
	local icon = db["g@ @coreOptions@minimapIcon"]
	if type(icon) == "table" then icon.hide = true end
	return true
end

local function hideMinimapIcon()
	local LibDBIcon = LibStub and LibStub("LibDBIcon-1.0", true)
	if LibDBIcon and LibDBIcon.Hide then pcall(LibDBIcon.Hide, LibDBIcon, "TradeSkillMaster") end
end

--- When the TSM app last downloaded prices for an auction house ("PvP-Alliance") or region.
function ns.TsmDataTime(tag, where)
	if where then return ns.tsmTimes[tag .. "|" .. where] end
	local best
	for key, t in pairs(ns.tsmTimes) do
		if key:sub(1, #tag + 1) == tag .. "|" and (not best or t > best) then best = t end
	end
	return best
end

local f = CreateFrame("Frame")
f:RegisterEvent("ADDON_LOADED")
f:RegisterEvent("PLAYER_LOGIN")
f:SetScript("OnEvent", function(_, event, name)
	if event == "ADDON_LOADED" and name == "TradeSkillMaster" then
		pcall(ns.QuietTSM)
		-- TSM's data addon calls this global while it loads, right after TSM: note the download times
		local load = TSM_APPHELPER_LOAD_DATA
		if type(load) == "function" then
			TSM_APPHELPER_LOAD_DATA = function(tag, where, data)
				if type(tag) == "string" and type(where) == "string" and type(data) == "string" then
					local t = tonumber(data:sub(1, 80):match("downloadTime=(%d+)"))
					if t then ns.tsmTimes[tag .. "|" .. where] = t end
				end
				return load(tag, where, data)
			end
		end
	elseif event == "PLAYER_LOGIN" then
		if quietWanted() and TradeSkillMasterDB then
			pcall(ns.QuietTSM)
			hideMinimapIcon()
		end
	end
end)
