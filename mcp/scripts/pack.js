// Builds dist/forever-flips.mcpb: the server bundled into one file, with host.lua and
// wasmoon's glue.wasm next to it. Double-click the .mcpb to install it in Claude Desktop.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const out = 'dist/forever-flips';
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'server'), { recursive: true });
await build({
  entryPoints: ['server/index.js'], bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  outfile: path.join(out, 'server', 'index.cjs'), logLevel: 'warning',
});
fs.copyFileSync('server/host.lua', path.join(out, 'server', 'host.lua'));
fs.copyFileSync('node_modules/wasmoon/dist/glue.wasm', path.join(out, 'server', 'glue.wasm'));
fs.copyFileSync('manifest.json', path.join(out, 'manifest.json'));
fs.copyFileSync('README.md', path.join(out, 'README.md'));
execFileSync(process.execPath, ['node_modules/@anthropic-ai/mcpb/dist/cli/cli.js', 'pack', out, 'dist/forever-flips.mcpb'], { stdio: 'inherit' });
