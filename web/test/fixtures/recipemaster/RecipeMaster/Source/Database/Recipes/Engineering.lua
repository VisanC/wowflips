-- Test fixture in Recipe Master's layout. The numbers are made up for the tests.
local _, rm = ...

rm.recipeDB[202] = {
	[4037] = {
		isSpell = true,
		requiredSkill = 50,
		teaches = "Journeyman",
	},
	[4371] = {
		difficulty = {
			105,
			105,
			130,
			155,
		},
		requiredSkill = 105,
		teaches = 3938,
	},
	[4375] = {
		difficulty = { 125, 125, 137, 150 },
		requiredSkill = 125,
		teaches = 3942,
	},
	[4382] = {
		difficulty = { 140, 145, 158, 170 }, -- a trainer recipe the game data can't place
		requiredSkill = 140,
		teaches = 3953,
	},
	[4389] = {
		difficulty = { 170, 170, 180, 190 },
		faction = "Horde",
		requiredSkill = 170,
		teaches = 3961,
	},
	[7742] = {
		difficulty = { 200, 220, 230, 240 },
		requiredSkill = 200,
		specialization = 20219,
		teaches = 3971,
	},
	[10000] = {
		difficulty = { 145, 170, 182, 195 },
		requiredSkill = 145,
		teaches = 3954,
	},
	[20219] = {
		isSpecialization = true,
		isSpell = true,
		requiredSkill = 200,
	},
}
