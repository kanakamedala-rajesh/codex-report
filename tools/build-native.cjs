const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = {};
for (const os of ['linux', 'windows', 'darwin']) {
  for (const arch of ['amd64', 'arm64']) {
    const name = `zstd-${os}-${arch}${os === 'windows' ? '.exe' : ''}`;
    const out = path.join(root, 'runtime', name);
    const result = spawnSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', out, '.'], {
      cwd: path.join(root, 'tools', 'native'),
      env: { ...process.env, CGO_ENABLED: '0', GOOS: os, GOARCH: arch, GOTOOLCHAIN: 'local' },
      stdio: 'inherit',
    });
    if (result.status !== 0) process.exit(result.status || 1);
    manifest[name] = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  }
}
fs.writeFileSync(
  path.join(root, 'runtime', 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
fs.copyFileSync(
  path.join(root, 'tools', 'native', 'LICENSE'),
  path.join(root, 'runtime', 'LICENSE'),
);
