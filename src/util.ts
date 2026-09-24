import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
export function integer(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
export function clean(value: unknown, max = 160): string {
  return str(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .slice(0, max);
}
export function hash(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
export function timestamp(value: unknown, fallback = ''): string {
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(str(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}
export function dataHome(): string {
  if (process.env.CODEX_REPORT_HOME) return path.resolve(process.env.CODEX_REPORT_HOME);
  if (process.platform === 'win32')
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'CodexReport',
    );
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'codex-report');
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'),
    'codex-report',
  );
}
export function privateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
export function atomicWrite(file: string, content: string | Buffer): void {
  privateDir(path.dirname(file));
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}
export function readJson(file: string, maxBytes = 4 * 1024 * 1024): unknown {
  if (fs.statSync(file).size > maxBytes) throw new Error(`JSON file exceeds ${maxBytes} bytes.`);
  return parseJson(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
export function writeJson(file: string, value: unknown): void {
  atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
}
export function within(file: string, roots: string[]): boolean {
  const target = fs.realpathSync(file);
  return roots.some((root) => {
    let resolved: string;
    try {
      resolved = fs.realpathSync(root);
    } catch {
      return false;
    }
    const relative = path.relative(resolved, target);
    return (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    );
  });
}
export function exclusiveOutput(file: string, content: string | Buffer): void {
  const fd = fs.openSync(path.resolve(file), 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function safeId(id: string): string {
  if (!id || id.length > 240 || /[\u0000-\u001f]/.test(id)) throw new Error('Invalid identifier.');
  return id;
}

/** Strict JSON for settings: reject duplicate keys instead of losing user settings. */
export function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  let i = 0;
  const ws = (): void => {
    while (/\s/.test(text[i] ?? '') && i < text.length) i++;
  };
  const string = (): string => {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') i++;
      else if (c === '"') break;
    }
    return JSON.parse(text.slice(start, i)) as string;
  };
  const scan = (depth: number): void => {
    if (depth > 100) throw new Error('JSON nesting exceeds the settings limit.');
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      const seen = new Set<string>();
      while (text[i] !== '}') {
        ws();
        const key = string();
        if (seen.has(key)) throw new Error('Duplicate JSON key.');
        seen.add(key);
        ws();
        i++;
        scan(depth + 1);
        ws();
        if (text[i] !== ',') break;
        i++;
      }
      i++;
    } else if (c === '[') {
      i++;
      ws();
      while (text[i] !== ']') {
        scan(depth + 1);
        ws();
        if (text[i] !== ',') break;
        i++;
      }
      i++;
    } else if (c === '"') string();
    else {
      while (i < text.length && !/[\s,}\]]/.test(text[i] ?? '')) i++;
    }
  };
  scan(0);
  return value;
}
