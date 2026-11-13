// Gathering professions have no recipes, so gathered items are listed in Crafts as
// zero-cost "recipes": what you get for selling what you mine, pick, skin or fish.
//
// Item ids are classic ones (Forever keeps them); each entry is checked against the game
// data by name, so a wrong or missing id is simply left out.
// Skill levels: Mining and Herbalism are the node requirements. Skinning depends on the
// mob's level and Fishing on the zone, so those are rough guides.

import type { GameData } from './gamedata';
import type { Character, Recipe } from './types';

export const GATHER_SKILL_LINES: Record<string, number> = { Mining: 186, Herbalism: 182, Skinning: 393, Fishing: 356 };
const SKILL_NAME = Object.fromEntries(Object.entries(GATHER_SKILL_LINES).map(([n, id]) => [id, n])) as Record<number, string>;

type Entry = [item: number, name: string, skill: number];

const GATHERS: Record<string, Entry[]> = {
  Mining: [
    [2770, 'Copper Ore', 1], [2835, 'Rough Stone', 1], [774, 'Malachite', 1], [818, 'Tigerseye', 1],
    [2771, 'Tin Ore', 65], [2836, 'Coarse Stone', 65], [1210, 'Shadowgem', 65], [1705, 'Lesser Moonstone', 65], [1206, 'Moss Agate', 65],
    [2775, 'Silver Ore', 75],
    [2772, 'Iron Ore', 125], [2838, 'Heavy Stone', 125], [1529, 'Jade', 125], [3864, 'Citrine', 125],
    [2776, 'Gold Ore', 155],
    [3858, 'Mithril Ore', 175], [7912, 'Solid Stone', 175], [7909, 'Aquamarine', 175], [7910, 'Star Ruby', 175],
    [7911, 'Truesilver Ore', 230], [11370, 'Dark Iron Ore', 230],
    [10620, 'Thorium Ore', 245], [12365, 'Dense Stone', 245], [12799, 'Large Opal', 245], [12364, 'Huge Emerald', 245],
    [12800, 'Azerothian Diamond', 245], [12361, 'Blue Sapphire', 245], [12363, 'Arcane Crystal', 245],
  ],
  Herbalism: [
    [2447, 'Peacebloom', 1], [765, 'Silverleaf', 1], [2449, 'Earthroot', 15], [785, 'Mageroyal', 50],
    [2450, 'Briarthorn', 70], [2452, 'Swiftthistle', 70], [3820, 'Stranglekelp', 85], [2453, 'Bruiseweed', 100],
    [3355, 'Wild Steelbloom', 115], [3369, 'Grave Moss', 120], [3356, 'Kingsblood', 125], [3357, 'Liferoot', 150],
    [3818, 'Fadeleaf', 160], [3821, 'Goldthorn', 170], [3358, "Khadgar's Whisker", 185], [3819, 'Wintersbite', 195],
    [4625, 'Firebloom', 205], [8831, 'Purple Lotus', 210], [8153, 'Wildvine', 210], [8836, "Arthas' Tears", 220],
    [8838, 'Sungrass', 230], [8839, 'Blindweed', 235], [8845, 'Ghost Mushroom', 245], [8846, 'Gromsblood', 250],
    [13464, 'Golden Sansam', 260], [13463, 'Dreamfoil', 270], [13465, 'Mountain Silversage', 280],
    [13466, 'Plaguebloom', 285], [13467, 'Icecap', 290], [13468, 'Black Lotus', 300],
  ],
  Skinning: [
    [2934, 'Ruined Leather Scraps', 1], [2318, 'Light Leather', 1], [783, 'Light Hide', 1],
    [2319, 'Medium Leather', 100], [4232, 'Medium Hide', 100],
    [4234, 'Heavy Leather', 150], [4235, 'Heavy Hide', 150],
    [4304, 'Thick Leather', 200], [8169, 'Thick Hide', 200], [8167, 'Turtle Scale', 200],
    [8170, 'Rugged Leather', 250], [8171, 'Rugged Hide', 250],
  ],
  Fishing: [
    [6291, 'Raw Brilliant Smallfish', 1], [6303, 'Raw Slitherskin Mackerel', 1], [6289, 'Raw Longjaw Mud Snapper', 1],
    [6308, 'Raw Bristle Whisker Catfish', 75], [6361, 'Raw Rainbow Fin Albacore', 75], [6358, 'Oily Blackmouth', 75],
    [6522, 'Deviate Fish', 75], [6359, 'Firefin Snapper', 100], [8365, 'Raw Mithril Head Trout', 150],
    [6362, 'Raw Rockscale Cod', 150], [4603, 'Raw Spotted Yellowtail', 175], [21071, 'Raw Sagefish', 75],
    [13422, 'Stonescale Eel', 205], [13754, 'Raw Glossy Mightfish', 205], [13758, 'Raw Redgill', 205],
    [13756, 'Raw Summer Bass', 205], [13759, 'Raw Nightfin Snapper', 205], [13760, 'Raw Sunscale Salmon', 205],
    [13889, 'Raw Whitescale Salmon', 205], [21153, 'Raw Greater Sagefish', 205], [13893, 'Large Raw Mightfish', 250],
  ],
};

/** Items you only get as a bonus while gathering something else (gems and stone from veins, some herbs). */
export const BONUS_ITEMS = new Set([
  2835, 2836, 2838, 7912, 12365, // stone
  774, 818, 1210, 1705, 1206, 1529, 3864, 7909, 7910, 12799, 12364, 12800, 12361, 12363, // gems
  2452, 8153, // Swiftthistle, Wildvine
]);

/** Name of a skill line, for gathering lines that have no recipes in the game data. */
export function skillName(data: GameData, skill: number): string {
  return data.skills.get(skill) ?? SKILL_NAME[skill] ?? `Skill ${skill}`;
}

/** Gathered items as zero-cost recipes (spell id = -item id). */
export function gatherRecipes(data: GameData): Recipe[] {
  const out: Recipe[] = [];
  for (const [prof, entries] of Object.entries(GATHERS)) {
    for (const [item, name, skill] of entries) {
      if (data.items.get(item)?.name !== name) continue;
      out.push({ spell: -item, name: `${prof}: ${name}`, skill: GATHER_SKILL_LINES[prof], yellow: skill, grey: skill, out: item, qty: 1, reagents: [], gather: true });
    }
  }
  return out;
}

/** Skill rank in a profession by name, from the profession windows or the skill list. */
export function skillRank(char: Character | undefined, name: string): number | undefined {
  const fromProf = char?.profs.find((p) => p.n === name)?.r;
  const fromSkills = char?.skills?.find(([n]) => n === name)?.[1];
  if (fromProf === undefined && fromSkills === undefined) return undefined;
  return Math.max(fromProf ?? 0, fromSkills ?? 0);
}

/** Gathers for a recipe scope: what your skill allows, your gathering professions, or all. */
export function gathersFor(data: GameData, char: Character | undefined, scope: 'known' | 'profession' | 'all'): Recipe[] {
  const all = gatherRecipes(data);
  if (scope === 'all') return all;
  return all.filter((r) => {
    const rank = skillRank(char, SKILL_NAME[r.skill]);
    if (rank === undefined) return false;
    return scope === 'profession' || rank >= r.yellow;
  });
}
