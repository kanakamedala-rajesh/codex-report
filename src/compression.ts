import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { hash, object, readJson } from './util';
export function decoderPath(): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const name = `zstd-${platform}-${arch}${platform === 'windows' ? '.exe' : ''}`;
  const dir = path.resolve(__dirname, '../runtime');
  const file = path.join(dir, name);
  const expected = object(readJson(path.join(dir, 'manifest.json')))[name];
  if (typeof expected !== 'string' || hash(fs.readFileSync(file)) !== expected) throw new Error('Missing, unsupported, or altered Zstandard decoder.');
  return file;
}
export async function compressedBytes(file: string, limit: number, timeout = 20000): Promise<Buffer> {
  if (fs.statSync(file).size > limit) throw new Error('Compressed source exceeds the import bound.');
  if (file.endsWith('.gz')) return zlib.gunzipSync(fs.readFileSync(file), { maxOutputLength: limit });
  const decoder = decoderPath();
  if (process.platform !== 'win32') fs.chmodSync(decoder, 0o755);
  return new Promise((resolve, reject) => {
    const child = spawn(decoder, [String(limit)], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const parts: Buffer[] = []; let size = 0; let failure: Error | undefined;
    const input = fs.createReadStream(file);
    const timer = setTimeout(() => { failure = new Error('Zstandard decoding timed out.'); child.kill(); }, timeout);
    child.on('error', (e) => { failure = e; input.destroy(); });
    child.stdin.on('error', () => { /* A failed decoder can close its input early. */ });
    input.on('error', (e) => { failure = e; child.kill(); });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { failure = new Error('Decoded source exceeds the import bound.'); child.kill(); }
      else parts.push(chunk);
    });
    child.on('close', (code) => { clearTimeout(timer); input.destroy();
      if (failure || code !== 0) reject(failure ?? new Error('Corrupt or unsupported Zstandard stream.'));
      else resolve(Buffer.concat(parts));
    });
    input.pipe(child.stdin);
  });
}
