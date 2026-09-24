import { createRequire } from 'node:module';

const packageMetadata: { version: string } = createRequire(__filename)('../package.json');
export const VERSION = packageMetadata.version;
export const MINIMUM_NODE = '18.20.8';
export function assertRuntime(version = process.versions.node): void {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) throw new Error('Invalid Node version.');
  if (major < 18 || (major === 18 && (minor < 20 || (minor === 20 && patch < 8)))) {
    throw new Error(`Codex Report requires Node ${MINIMUM_NODE} or newer; found ${version}.`);
  }
}
