'use strict';
// Explicitly supplied authorized files only. Output contains aggregate counts,
// never raw prompts, private paths, request IDs, or tool bodies.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Store } = require('../dist/database');
const { Collector, discover } = require('../dist/collector');
const { initializeConfig } = require('../dist/config');
const { report } = require('../dist/reports');
const source = process.argv[2];
if (!source) throw new Error('Supply an authorized extracted JSONL directory.');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-replay-'));
const config = initializeConfig(home);
config.sources = [
  { name: 'verification', path: path.resolve(source), kind: 'rollouts', account: 'unattributed' },
];
const store = new Store(home);
async function main() {
  const files = discover(source).filter((f) => f.endsWith('.jsonl'));
  const expected = new Map();
  for (const file of files) {
    let owner = '';
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const record = JSON.parse(line),
        p = record.payload || {};
      if (record.type === 'session_meta' && !owner) owner = p.id;
      if (record.type === 'token_usage_record' && p.thread_id === owner && p.response_id)
        expected.set('n:' + p.response_id, p);
    }
  }
  await new Collector(store, config).sync();
  const native = store.samples().filter((s) => s.format === 'native');
  assert.equal(native.length, expected.size, 'Native identity count');
  for (const s of native) {
    const p = expected.get(s.id);
    if (
      !p ||
      s.thread !== p.thread_id ||
      s.turn !== p.turn_id ||
      s.rootThread !== p.session_id ||
      s.rootTurn !== p.root_turn_id
    )
      throw new Error('Request attribution mismatch.');
    for (const [key, upstream] of [
      ['input', 'input_tokens'],
      ['cached', 'cached_input_tokens'],
      ['write', 'cache_write_input_tokens'],
      ['output', 'output_tokens'],
      ['reasoning', 'reasoning_output_tokens'],
    ])
      if (s[key] !== Number(p.usage[upstream] ?? 0)) throw new Error('Token vector mismatch.');
  }
  const r = report(store, config, { scope: 'lifetime' });
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        files: files.length,
        nativeRequests: native.length,
        processed: r.totals.processed,
        tasks: [...r.tasks].reverse().map((t) => ({
          number: t.number,
          status: t.status,
          requests: t.totals.requests,
          input: t.totals.input,
          output: t.totals.output,
          workers: t.workers,
          reviewers: t.reviewers,
        })),
      },
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
