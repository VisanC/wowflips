-- FlipExport / Logic/Deals.lua
--  - Vendor flips: listings cheaper than what a vendor pays (guaranteed profit).
--  - Under market: listings well below the item's usual price, for items that sell. The usual
--    price is TSM's region average sale price (or market value) when TSM is installed, else the
--    median of Auctionator's daily lows over two weeks.
-- Only the cheapest few price levels are known per item, so unit counts are "at least";
-- `more` marks items where cheap listings may go on past them.

local _, ns = ...
local Deals = {}
ns.Deals = Deals

local function levelsOf(ah)
	if ah.levels and #ah.levels > 0 then return ah.levels end
	return { { ah.min, ah.qty } }
end

function Deals.VendorFlips(d, market)
	local out = {}
	for item, ah in pairs(market.ah) do
		local vendor = ns.Data.ItemSell(d, item)
		if vendor > 0 and (ah.min or 0) > 0 and ah.min < vendor then
			local units, profit = 0, 0
			local levels = levelsOf(ah)
			local allBelow = true
			for _, lv in ipairs(levels) do
				if lv[1] >= vendor then allBelow = false break end
				units = units + lv[2]
				profit = profit + (vendor - lv[1]) * lv[2]
			end
			out[#out + 1] = { item = item, price = ah.min, vendor = vendor, units = units, profit = profit, more = #levels >= 3 and allBelow and ah.qty > units, src = ah.src }
		end
	end
	table.sort(out, function(a, b) return a.profit > b.profit end)
	return out
end

--- @param opts { maxPct = 0.7, minSold = 1, minProfit = 10000, cut = 0.05, atr = Auctionator's price table }
function Deals.UnderMarket(d, market, opts)
	local out = {}
	for item, ah in pairs(market.ah) do
		if (ah.min or 0) > 0 then
			local sales = ns.Prices.Sales(item)
			local reference, soldPerDay, saleRate, refSrc
			if sales and ((sales.avgSale or 0) > 0 or (sales.market or 0) > 0) then
				reference = (sales.avgSale or 0) > 0 and sales.avgSale or sales.market
				soldPerDay, saleRate, refSrc = sales.soldPerDay, sales.saleRate, "tsm"
			else
				reference, refSrc = ns.Prices.AtrMedian(opts.atr, item, 14, 5), "auctionator"
			end
			local sells = soldPerDay == nil or soldPerDay >= (opts.minSold or 0)
			if reference and reference > 0 and sells then
				local limit = reference * (opts.maxPct or 0.7)
				if ah.min <= limit then
					local net = reference * (1 - (opts.cut or 0.05))
					local units, profit, allBelow = 0, 0, true
					local levels = levelsOf(ah)
					for _, lv in ipairs(levels) do
						if lv[1] > limit then allBelow = false break end
						units = units + lv[2]
						profit = profit + (net - lv[1]) * lv[2]
					end
					if profit >= (opts.minProfit or 0) then
						out[#out + 1] = {
							item = item, price = ah.min, reference = reference, refSrc = refSrc, pct = ah.min / reference,
							profitEach = net - ah.min, units = units, profit = profit, soldPerDay = soldPerDay, saleRate = saleRate,
							more = #levels >= 3 and allBelow and ah.qty > units, src = ah.src,
						}
					end
				end
			end
		end
	end
	table.sort(out, function(a, b) return a.profit > b.profit end)
	return out
end
