// A small reader for Lua table literals, as addons write them in their data files and
// SavedVariables: { [1] = "x", key = 2, nested = { 3, 4 } }. Not a Lua interpreter: only
// literals (tables, strings, numbers, true/false/nil) and comments.

export type LuaValue = number | string | boolean | null | LuaTable;
/** Keys as Lua sees them: positional items get 1, 2, 3…; all keys are stored as strings. */
export interface LuaTable {
  [key: string]: LuaValue;
}

export class LuaReader {
  pos = 0;
  constructor(readonly src: string) {}

  fail(msg: string): never {
    const line = this.src.slice(0, this.pos).split('\n').length;
    throw new Error(`${msg} at line ${line}`);
  }

  skip() {
    const s = this.src;
    for (;;) {
      while (this.pos < s.length && /\s/.test(s[this.pos])) this.pos++;
      if (s.startsWith('--', this.pos)) {
        const long = /^--\[(=*)\[/.exec(s.slice(this.pos, this.pos + 16));
        if (long) {
          const end = s.indexOf(`]${long[1]}]`, this.pos);
          this.pos = end < 0 ? s.length : end + long[1].length + 2;
        } else {
          const nl = s.indexOf('\n', this.pos);
          this.pos = nl < 0 ? s.length : nl + 1;
        }
        continue;
      }
      return;
    }
  }

  value(): LuaValue {
    this.skip();
    const s = this.src;
    const c = s[this.pos];
    if (c === '{') return this.table();
    if (c === '"' || c === "'") return this.string();
    if (c === '[' && /^\[=*\[/.test(s.slice(this.pos, this.pos + 8))) return this.longString();
    const word = /^(true|false|nil)\b/.exec(s.slice(this.pos, this.pos + 6));
    if (word) {
      this.pos += word[1].length;
      return word[1] === 'true' ? true : word[1] === 'false' ? false : null;
    }
    const num = /^-?(0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)/.exec(s.slice(this.pos, this.pos + 40));
    if (num) {
      this.pos += num[0].length;
      return Number(num[0]);
    }
    return this.fail(`Unexpected "${c ?? 'end of file'}"`);
  }

  table(): LuaTable {
    const s = this.src;
    const out: LuaTable = {};
    let n = 0;
    this.pos++; // {
    for (;;) {
      this.skip();
      if (s[this.pos] === '}') {
        this.pos++;
        return out;
      }
      let key: string | undefined;
      if (s[this.pos] === '[' && !/^\[=*\[/.test(s.slice(this.pos, this.pos + 8))) {
        this.pos++;
        const k = this.value();
        this.skip();
        if (s[this.pos] !== ']') this.fail('Expected ]');
        this.pos++;
        key = String(k);
        this.expectEquals();
      } else {
        const name = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(s.slice(this.pos, this.pos + 200));
        if (name) {
          key = name[1];
          this.pos += name[0].length;
        }
      }
      const v = this.value();
      out[key ?? String(++n)] = v;
      this.skip();
      if (s[this.pos] === ',' || s[this.pos] === ';') this.pos++;
      else if (s[this.pos] !== '}') this.fail('Expected , or }');
    }
  }

  private expectEquals() {
    this.skip();
    if (this.src[this.pos] !== '=') this.fail('Expected =');
    this.pos++;
  }

  private string(): string {
    const s = this.src;
    const q = s[this.pos++];
    let out = '';
    for (;;) {
      const c = s[this.pos++];
      if (c === undefined) this.fail('Unterminated string');
      if (c === q) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = s[this.pos++];
      const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '\n': '\n', a: '\x07', b: '\b', f: '\f', v: '\v' };
      if (e in simple) out += simple[e];
      else if (/\d/.test(e)) {
        const d = /^\d{1,3}/.exec(s.slice(this.pos - 1, this.pos + 2))![0];
        this.pos += d.length - 1;
        out += String.fromCharCode(Number(d));
      } else out += e;
    }
  }

  private longString(): string {
    const s = this.src;
    const open = /^\[(=*)\[/.exec(s.slice(this.pos, this.pos + 8))!;
    const close = `]${open[1]}]`;
    const start = this.pos + open[0].length;
    const end = s.indexOf(close, start);
    if (end < 0) this.fail('Unterminated long string');
    this.pos = end + close.length;
    return s.slice(start, end).replace(/^\r?\n/, '');
  }
}

/** Every `<lhs> = { … }` assignment in a file whose left side matches `lhs` (a regexp ending just before the =). */
export function luaAssignments(src: string, lhs: RegExp): { match: RegExpExecArray; value: LuaValue }[] {
  const re = new RegExp(`${lhs.source}\\s*=\\s*(?=\\{)`, 'g');
  const out: { match: RegExpExecArray; value: LuaValue }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const r = new LuaReader(src);
    r.pos = m.index + m[0].length;
    out.push({ match: m, value: r.value() });
    re.lastIndex = r.pos;
  }
  return out;
}

export function isTable(v: LuaValue | undefined): v is LuaTable {
  return typeof v === 'object' && v !== null;
}

/** Positional items 1..n of a table. */
export function luaList(t: LuaValue | undefined): LuaValue[] {
  if (!isTable(t)) return [];
  const out: LuaValue[] = [];
  for (let i = 1; String(i) in t; i++) out.push(t[String(i)]);
  return out;
}
