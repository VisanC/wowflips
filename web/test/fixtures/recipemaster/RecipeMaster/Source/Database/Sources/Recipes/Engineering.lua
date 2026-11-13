-- Test fixture in Recipe Master's layout. The numbers are made up for the tests.
local _, rm = ...

rm.recipeSourceDB[202] = {
	[4371] = { trainer = { [1] = "", [2] = "" } },
	[4375] = { trainer = { [1] = "" } },
	[4382] = { trainer = { [1] = "" } },
	[4389] = { trainer = { [3] = "" } },
	[7742] = {
		vendor = {
			[5] = { cost = "180mfv", reputationFaction = 9, reputationLevel = 5 },
		},
	},
	[10000] = {
		vendor = {
			[6] = { cost = "2gld", stock = 1 },
			[7] = { cost = "1gld50svr" },
		},
		drop = { [8] = 0.5 },
	},
}
