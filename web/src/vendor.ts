// Reagents that NPC vendors sell in unlimited supply (checked against the
// WoW Forever item table). Prices come from the game data (BuyPrice / VendorStackCount).
// Anything else a vendor sells is learned automatically: the addon records
// every vendor you open, and those prices override this list.
export const VENDOR_REAGENTS: number[] = [
  2880, // Weak Flux
  3466, // Strong Flux
  2320, // Coarse Thread
  2321, // Fine Thread
  4291, // Silken Thread
  8343, // Heavy Silken Thread
  14341, // Rune Thread
  3371, // Empty Vial
  3372, // Leaded Vial
  8925, // Crystal Vial
  18256, // Imbued Vial
  4289, // Salt
  2678, // Mild Spices
  2692, // Hot Spices
  3713, // Soothing Spices
  159, // Refreshing Spring Water
  1179, // Ice Cold Milk
  2324, // Bleach
  4340, // Gray Dye
  2325, // Black Dye
  6260, // Blue Dye
  2604, // Red Dye
  2605, // Green Dye
  6261, // Orange Dye
  4341, // Yellow Dye
  4342, // Purple Dye
  10290, // Pink Dye
  4470, // Simple Wood
  4399, // Wooden Stock
  4400, // Heavy Stock
  6217, // Copper Rod
  10648, // Blank Parchment
  10647, // Engineer's Ink
];
