// Turns wago.tools DB2 CSV tables into the compact JSON the web app loads.
// Pure functions, no I/O, so they can be unit-tested and run anywhere.

/** RFC 4180-ish CSV parser (handles quoted fields with commas, quotes and newlines). */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, j) => [h, r[j]])));
}

const SPELL_EFFECT_CREATE_ITEM = 24;
const PROFESSION_CATEGORIES = new Set([9, 11]); // 11 = primary professions, 9 = secondary (Cooking, First Aid...)

const num = (v) => (v === undefined || v === '' ? 0 : Number(v));

/**
 * @param {Record<string, Record<string,string>[]>} t  parsed tables:
 *   ItemSparse, SkillLine, SkillLineAbility, SpellEffect, SpellReagents, SpellName
 */
export function transform(t, build) {
  const skillLines = new Map(
    t.SkillLine.filter((r) => PROFESSION_CATEGORIES.has(num(r.CategoryID)) && !/DNT/.test(r.DisplayName_lang)).map((r) => [
      num(r.ID),
      r.DisplayName_lang,
    ]),
  );

  // spell -> first CREATE_ITEM effect
  const creates = new Map();
  for (const e of t.SpellEffect) {
    if (num(e.Effect) !== SPELL_EFFECT_CREATE_ITEM || num(e.EffectItemType) <= 0) continue;
    const spell = num(e.SpellID);
    const prev = creates.get(spell);
    if (!prev || num(e.EffectIndex) < prev.index) {
      creates.set(spell, {
        index: num(e.EffectIndex),
        item: num(e.EffectItemType),
        qty: Math.max(1, Math.round(num(e.EffectBasePointsF))),
      });
    }
  }

  const reagents = new Map();
  for (const r of t.SpellReagents) {
    const list = [];
    for (let k = 0; k < 8; k++) {
      const item = num(r[`Reagent_${k}`]);
      const count = num(r[`ReagentCount_${k}`]);
      if (item > 0 && count > 0) list.push([item, count]);
    }
    if (list.length) reagents.set(num(r.SpellID), list);
  }

  const spellNames = new Map(t.SpellName.map((r) => [num(r.ID), r.Name_lang]));

  const recipes = [];
  const seen = new Set();
  const usedSkills = new Map();
  for (const a of t.SkillLineAbility) {
    const spell = num(a.Spell);
    const skill = num(a.SkillLine);
    if (seen.has(spell) || !skillLines.has(skill)) continue;
    const out = creates.get(spell);
    const reag = reagents.get(spell);
    if (!out || !reag) continue;
    seen.add(spell);
    usedSkills.set(skill, skillLines.get(skill));
    recipes.push([
      spell,
      spellNames.get(spell) ?? `Spell ${spell}`,
      skill,
      num(a.TrivialSkillLineRankLow),
      num(a.TrivialSkillLineRankHigh),
      out.item,
      out.qty,
      reag,
      num(a.MinSkillLineRank), // skill needed to learn it (0 if the table has no such column)
    ]);
  }
  recipes.sort((x, y) => x[0] - y[0]);

  const items = t.ItemSparse.filter((r) => !/^Monster - |DNT/.test(r.Display_lang)).map((r) => [
    num(r.ID),
    r.Display_lang,
    num(r.OverallQualityID),
    num(r.SellPrice),
    num(r.BuyPrice),
    Math.max(1, num(r.VendorStackCount)),
    num(r.Stackable),
  ]).sort((x, y) => x[0] - y[0]);

  return {
    meta: { build, generatedAt: new Date().toISOString(), items: items.length, recipes: recipes.length },
    skills: Object.fromEntries([...usedSkills.entries()].sort((a, b) => a[0] - b[0])),
    recipes,
    items,
  };
}

export const TABLES = ['ItemSparse', 'SkillLine', 'SkillLineAbility', 'SpellEffect', 'SpellReagents', 'SpellName'];
