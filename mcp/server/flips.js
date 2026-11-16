// Loads the addon's Lua logic and your saved data into a Lua 5.4 engine (wasmoon) and answers
// tool calls through host.lua. Everything is re-read when a file changes (after a /reload).

import { LuaFactory } from 'wasmoon';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// this folder: the bundle (CommonJS, __dirname) or the source (ES module)
const HERE = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WOW_DIR = 'C:\\Program Files (x86)\\World of Warcraft\\_forever_';

const ADDON_FILES = [
  'Core.lua', 'Data/GameData.lua', 'Data/RecipeMaster.lua',
  'Logic/Data.lua', 'Logic/Prices.lua', 'Logic/Engine.lua', 'Logic/Leveling.lua',
  'Logic/Deals.lua', 'Logic/Sales.lua', 'Logic/Queue.lua',
];
const OPTIONAL = new Set(['Data/RecipeMaster.lua']);

function mtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

/** The account folder whose FlipExport saved data is newest. */
function savedVariablesDir(wowDir) {
  const accounts = path.join(wowDir, 'WTF', 'Account');
  let best = null, bestT = 0;
  for (const acct of fs.existsSync(accounts) ? fs.readdirSync(accounts) : []) {
    const dir = path.join(accounts, acct, 'SavedVariables');
    const t = mtime(path.join(dir, 'FlipExport.lua'));
    if (t > bestT) { best = dir; bestT = t; }
  }
  return best;
}

export function sources(wowDir, addonDir) {
  const addon = addonDir || path.join(wowDir, 'Interface', 'AddOns', 'FlipExport');
  const sv = savedVariablesDir(wowDir);
  return {
    addon,
    files: ADDON_FILES.map((f) => ({ name: f, file: path.join(addon, ...f.split('/')) })),
    flipexport: sv && path.join(sv, 'FlipExport.lua'),
    auctionator: sv && path.join(sv, 'Auctionator.lua'),
    tsm: path.join(wowDir, 'Interface', 'AddOns', 'TradeSkillMaster_AppHelper', 'AppData.lua'),
  };
}

/** Text for Lua: as is when it is valid UTF-8, else base64 (Auctionator's binary database). */
function readForLua(file) {
  const buf = fs.readFileSync(file);
  const text = buf.toString('utf8');
  if (Buffer.byteLength(text, 'utf8') === buf.length && !text.includes('\uFFFD')) return { text, base64: false };
  return { text: buf.toString('base64'), base64: true };
}

export class Flips {
  constructor({ wowDir = process.env.WOW_DIR || DEFAULT_WOW_DIR, addonDir = process.env.FLIPS_ADDON_DIR, character = process.env.FLIPS_CHARACTER } = {}) {
    this.wowDir = wowDir;
    this.addonDir = addonDir;
    this.character = character;
    // the bundle carries wasmoon's glue.wasm next to it
    const wasm = path.join(HERE, 'glue.wasm');
    this.factory = new LuaFactory(fs.existsSync(wasm) ? wasm : undefined);
    this.lua = null;
    this.stamp = null;
  }

  stampOf(src) {
    return [src.flipexport, src.auctionator, src.tsm, ...src.files.map((f) => f.file)].map((f) => `${f}:${f ? mtime(f) : 0}`).join('|');
  }

  async load() {
    const src = sources(this.wowDir, this.addonDir);
    const stamp = this.stampOf(src);
    if (this.lua && stamp === this.stamp) return;
    if (!src.flipexport || !fs.existsSync(src.flipexport)) {
      throw new Error(`No Forever Flips saved data under ${path.join(this.wowDir, 'WTF', 'Account')}. Is the WoW folder right (WOW_DIR), and has the addon run (log in, then /reload)?`);
    }
    if (this.lua) this.lua.global.close();
    const lua = await this.factory.createEngine();
    await lua.doString(fs.readFileSync(path.join(HERE, 'host.lua'), 'utf8'));
    const g = lua.global;
    for (const f of src.files) {
      if (!fs.existsSync(f.file)) {
        if (OPTIONAL.has(f.name)) continue;
        throw new Error(`Missing ${f.file}: is the Forever Flips addon (0.7.5 or later) installed there?`);
      }
      g.get('LoadAddonFile')(fs.readFileSync(f.file, 'utf8'), f.name);
    }
    const saved = readForLua(src.flipexport);
    g.get('LoadSavedVariables')(saved.text, 'FlipExport.lua', saved.base64);
    if (src.auctionator && fs.existsSync(src.auctionator)) {
      const atr = readForLua(src.auctionator);
      g.get('LoadSavedVariables')(atr.text, 'Auctionator.lua', atr.base64);
    }
    if (fs.existsSync(src.tsm)) g.get('LoadTsmAppData')(fs.readFileSync(src.tsm, 'utf8'));
    if (this.character) g.set('CHARACTER', this.character);
    g.get('BuildState')();
    this.lua = lua;
    this.stamp = stamp;
    this.files = {
      saved_variables: { file: src.flipexport, written: Math.floor(mtime(src.flipexport) / 1000) },
      auctionator: src.auctionator && fs.existsSync(src.auctionator) ? src.auctionator : null,
      tsm_app_data: fs.existsSync(src.tsm) ? src.tsm : null,
      addon: src.addon,
    };
  }

  async call(tool, args = {}) {
    await this.load();
    const json = this.lua.global.get('FlipsCall')(tool, JSON.stringify(args ?? {}));
    const result = JSON.parse(json);
    if (tool === 'status') result.files = this.files;
    return result;
  }
}
