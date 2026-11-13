import type { ExportPayload } from './types';

export const PREFIX = 'FLIPX1:';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function inflateRaw(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/** Decodes the string from the in-game /flip export window. */
export async function decodeExport(text: string): Promise<ExportPayload> {
  const s = text.replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) throw new Error('This is not a FlipExport string. It should start with "FLIPX1:".');
  let json: string;
  try {
    json = await inflateRaw(base64ToBytes(s.slice(PREFIX.length)));
  } catch {
    throw new Error('The string is damaged or incomplete. Copy it again with Ctrl+A, Ctrl+C in the export window.');
  }
  const data = JSON.parse(json) as ExportPayload;
  if (data.v !== 1) throw new Error(`Unsupported export version ${data.v}. Update the web app or the addon.`);
  if (!data.char?.n || !data.char?.r) throw new Error('The export has no character information.');
  // Lua encodes empty tables as [], and omits nil fields.
  data.bags ??= [];
  data.profs ??= [];
  data.vend ??= [];
  return data;
}
