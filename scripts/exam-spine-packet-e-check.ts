// Exam Spine — Stage 4 / Packet E: canonical namespace dormancy check。
//
// 目的:
//   canonical Stage 4 namespace（lib/examSpine/**）が shipping lineage 上に
//   **存在し、かつ production runtime から 1 本も import されていない**
//   ことを機械的に固定する。
//
//   Packet E は namespace import であって consumer switch ではない。
//   「canonical code が shipping に存在すること」と
//   「canonical code を production consumer が使うこと」は別工程である。
//
// Packet E の exit criteria（STAGE4_IMPLEMENTATION_PACKETS.md / arbitration 指示）:
//   CANONICAL_NAMESPACE_ON_SHIPPING = YES
//   CANONICAL_RUNTIME_IMPORTERS     = 0
//   LEGACY_SERVER_READ_INTACT       = YES
//   CONSUMER_SWITCH_PERFORMED       = NO
//
// 厳守:
//   - 実ネットワーク 0 / 実 Supabase 0 / AI 呼び出し 0（fetch を trap する）
//   - production runtime を変更しない（本 script は読むだけ）
//   - PII / 本文 / UUID を出力しない
//
// 使い方:
//   npx tsx scripts/exam-spine-packet-e-check.ts
//   （= npm run qa:examSpine:packetE）

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── 外部通信 trap ─────────────────────────────────────────────────
let fetchCallCount = 0;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(`[packet-e] 外部通信が発生しました（禁止）: ${target}`);
}) as typeof globalThis.fetch;

const ROOT = process.cwd();

let passed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1;
  else {
    failures.push(detail ? `${label} — ${detail}` : label);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ── 1. canonical namespace が存在する ─────────────────────────────
const SPINE_DIR = join(ROOT, 'lib/examSpine');
const spineFiles = walk(SPINE_DIR).map((f) => relative(ROOT, f)).sort();
check('canonical namespace lib/examSpine/** が存在する', spineFiles.length > 0);
check(
  'canonical namespace に read / sync / context / blocks / orchestrator が揃う',
  ['read', 'sync', 'context', 'blocks', 'orchestrator'].every((d) =>
    spineFiles.some((f) => f.startsWith(`lib/examSpine/${d}/`)),
  ),
);

// ── 2. Stage 5.1 / 5.2 の work が混入していない ───────────────────
//   A branch（exam-spine-w1-convergence-v2）固有の shadow comparison は
//   Stage 4 canonical に含まれない（arbitration / E-S38）。
const shadowLeak = spineFiles.filter((f) => f.startsWith('lib/examSpine/context/shadow/'));
check(
  'Stage 5.1 shadow comparison が混入していない',
  shadowLeak.length === 0,
  shadowLeak.join(', '),
);

// ── 3. production runtime importer = 0（Packet E の核心）──────────
//   scripts/** は QA であり production runtime ではないので対象外。
//   lib/examSpine/** 内部の相互 import も当然除外する。
const PROD_DIRS = ['app', 'components', 'hooks', 'lib'];
const prodImporters: string[] = [];
for (const dir of PROD_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('lib/examSpine/')) continue;
    if (!/\.(ts|tsx)$/.test(rel)) continue;
    const text = readFileSync(file, 'utf8');
    // import / dynamic import / re-export のいずれも拾う
    if (/from\s+'@\/lib\/examSpine|import\('@\/lib\/examSpine|require\('@\/lib\/examSpine/.test(text)) {
      prodImporters.push(rel);
    }
  }
}
check(
  'production runtime から canonical namespace を import していない',
  prodImporters.length === 0,
  prodImporters.join(', '),
);

// ── 4. legacy serverRead が現役である ─────────────────────────────
const LEGACY = [
  'lib/contextBuilders/tutor/serverRead/reader.server.ts',
  'lib/contextBuilders/tutor/serverRead/rowMappers.ts',
  'lib/contextBuilders/tutor/serverRead/snapshotCache.server.ts',
  'lib/contextBuilders/tutor/serverRead/sourceState.ts',
];
for (const f of LEGACY) {
  check(`legacy serverRead が存在する: ${f.split('/').pop()}`, existsSync(join(ROOT, f)), f);
}

const tutorContextPath = join(ROOT, 'lib/contextBuilders/tutorContext.ts');
const tutorContextSrc = existsSync(tutorContextPath) ? readFileSync(tutorContextPath, 'utf8') : '';
check(
  'tutorContext が legacy serverRead を import している（consumer 未切替）',
  /@\/lib\/contextBuilders\/tutor\/serverRead\//.test(tutorContextSrc),
);
check(
  'tutorContext が canonical namespace を import していない',
  !/@\/lib\/examSpine/.test(tutorContextSrc),
);

// ── 5. path collision が無い ──────────────────────────────────────
//   canonical namespace と legacy runtime が同じ path を占有しないこと。
const legacyDirFiles = walk(join(ROOT, 'lib/contextBuilders/tutor/serverRead')).map((f) =>
  relative(ROOT, f),
);
const overlap = spineFiles.filter((f) => legacyDirFiles.includes(f));
check('canonical / legacy の path 衝突が 0', overlap.length === 0, overlap.join(', '));

// ── 6. 外部通信 0 ─────────────────────────────────────────────────
check('外部通信 0 回', fetchCallCount === 0);

// ── 出力 ──────────────────────────────────────────────────────────
console.log('');
console.log('=== Exam Spine Stage 4 / Packet E — canonical namespace dormancy ===');
console.log(`canonical namespace files : ${spineFiles.length}`);
console.log(`production runtime importers : ${prodImporters.length}`);
console.log(`checks passed : ${passed}`);
console.log(`failed        : ${failures.length}`);
if (failures.length > 0) {
  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log('');
  console.log('PACKET_E_CANONICAL_NAMESPACE_DORMANT = PASS');
}
