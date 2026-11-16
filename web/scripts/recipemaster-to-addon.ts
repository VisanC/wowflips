// Turns your own copy of the Recipe Master addon's database into the file the in-game Forever
// Flips reads for learn levels, skill-up levels and learn prices:
//   addon/FlipExport/Data/RecipeMaster.lua  (gitignored: Recipe Master's data must not be redistributed)
// Usage: npx vite-node scripts/recipemaster-to-addon.ts <RecipeMaster folder> <output .lua>

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isRecipeMasterFile, parseRecipeMaster, type RmData } from '../src/recipeMaster';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const q = (s: string | undefined) => `"${(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Lua: ns.RecipeMasterData = { version, r = { [spell] = { learn, orange, yellow, green, grey, trainer, vendor copper, vendor price, faction, specialization, key item } } } */
export function rmToLua(rm: RmData): string {
  const lines = [
    '-- Made on this PC from your Recipe Master addon by web/scripts/recipemaster-to-addon.ts.',
    "-- Recipe Master's data: for your own use only, not part of the repo.",
    'local _, ns = ...',
    `local D = { version = ${q(rm.version)}, made = ${rm.loadedAt}, r = {} }`,
    'ns.RecipeMasterData = D',
    'local R = D.r',
  ];
  const stmts = rm.recipes.map((r) => {
    const c = r.colors ?? [0, 0, 0, 0];
    return `R[${r.spell}] = { ${r.learn}, ${c[0]}, ${c[1]}, ${c[2]}, ${c[3]}, ${r.trainer ? 1 : 0}, ${r.vendorCost ?? 0}, ${q(r.vendorPrice)}, ${q(r.faction)}, ${r.spec ?? 0}, ${r.isSpell ? r.spell : r.key} }`;
  });
  for (let i = 0; i < stmts.length; i += 400) lines.push('do', ...stmts.slice(i, i + 400), 'end');
  return lines.join('\n') + '\n';
}

async function main() {
  const [folder, out] = process.argv.slice(2);
  if (!folder || !out) throw new Error('usage: recipemaster-to-addon.ts <RecipeMaster folder> <output .lua>');
  const files = [];
  for (const p of await walk(folder)) {
    const rel = relative(folder, p).replace(/\\/g, '/');
    if (isRecipeMasterFile(rel)) files.push({ path: rel, text: await readFile(p, 'utf8') });
  }
  const rm = parseRecipeMaster(files);
  await writeFile(out, rmToLua(rm));
  console.log(`Recipe Master ${rm.version ?? '?'}: ${rm.recipes.length} recipes from ${rm.files} files -> ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
