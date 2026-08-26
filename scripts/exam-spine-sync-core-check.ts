// Exam Spine — Stage 4 Wave 1 / sync core primitive check。
//
// 目的:
//   lib/examSpine/sync/** の primitive が
//     deterministic / pure / no I/O / no clock / no random
//   であり、かつ **architecture guard**（下記）を満たすことを機械的に示す。
//
// 本 script が守らせる architecture guard:
//   G1  object key order は非 semantic（順が違っても同じ fingerprint）
//   G2  ★ array order は semantic（逆順にしたら **必ず** fingerprint が変わる）★
//       generic primitive が配列を sort していないことの negative control。
//   G3  null / undefined / 空文字 / 0 / false / key 欠落 を潰さない
//   G4  fingerprint は hash であり、本文へ復号できる serialization を公開しない
//   G5  error / 返り値に入力本文・key 名が漏れない
//   G6  revision は kind 固有規則を持たない（generic primitive のみ）
//   G7  verification は Authority 判断（採用側 / 新しい方）を返さない
//   G8  sync/** は sync/** 以外を import しない（lineage 未確定のため結合を作らない）
//
// 厳守:
//   - 実ネットワーク 0 / AI 呼び出し 0（fetch を trap する）
//   - production runtime を一切変更しない（本 script は読むだけ）
//   - 自作 SHA-256 の正しさは node:crypto と test vector で突き合わせる
//
// 使い方:
//   npm run qa:examSpine:syncCore

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

// ── 0. 外部通信 trap ───────────────────────────────────────────────
let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(`[exam-spine-sync-core] 外部通信が発生しました（sync core では禁止）: ${target}`);
}) as typeof globalThis.fetch;
void originalFetch;

import * as HashMod from '@/lib/examSpine/sync/hash';
import * as FingerprintMod from '@/lib/examSpine/sync/fingerprint';
import * as RevisionMod from '@/lib/examSpine/sync/revision';
import * as VerificationMod from '@/lib/examSpine/sync/verification';

import { sha256Hex } from '@/lib/examSpine/sync/hash';
import {
  EXAM_FINGERPRINT_MAX_DEPTH,
  EXAM_FINGERPRINT_SEMANTICS,
  EXAM_FINGERPRINT_VERSION,
  ExamFingerprintError,
  examFingerprint,
  fingerprintEquality,
  isExamFingerprint,
  tryExamFingerprint,
} from '@/lib/examSpine/sync/fingerprint';
import {
  ABSENT_REVISION,
  EXAM_REVISION_FORMS,
  EXAM_REVISION_ORDERABLE_FORMS,
  compareRevision,
  normalizeRevisionInput,
  revisionEquality,
  revisionFromCounter,
  revisionFromOpaque,
  revisionFromTimestampText,
} from '@/lib/examSpine/sync/revision';
import type { ExamRevisionValue } from '@/lib/examSpine/sync/revision';
import {
  EMPTY_CANDIDATE,
  EXAM_SYNC_STATUSES,
  UNCLAIMED_CANDIDATE,
  UNREADABLE_CANDIDATE,
  presentCandidate,
  verifyExamSourcePair,
} from '@/lib/examSpine/sync/verification';
import type { ExamSyncCandidate } from '@/lib/examSpine/sync/verification';

// ── 1. assertion helper ───────────────────────────────────────────
let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    return;
  }
  failures.push(detail ? `${label}\n      ${detail}` : label);
}

function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `expected=${e}\n      actual  =${a}`);
}

const REPO_ROOT = process.cwd();
const SYNC_DIR = join(REPO_ROOT, 'lib', 'examSpine', 'sync');

// ★ 本 script が守るのは **generic core の 4 file だけ** ★
//   Wave 2 以降 `lib/examSpine/sync/adapters/**` に kind 固有 adapter が入る。adapter は
//   sourceData / read layer の型を **正当に** import するため、core と同じ「相対 import のみ」
//   規則を当てると落ちる。目的（core が source を知らない純粋な層であること）は変えず、
//   対象だけを core に絞る（Stage 1 QA が Stage 2/3 に対して行った Stage-scoped 化と同形）。
//   adapter 側の境界は scripts/exam-spine-sync-adapters-check.ts が別途検査する。
const CORE_FILES = ['hash.ts', 'fingerprint.ts', 'revision.ts', 'verification.ts'] as const;

// ── 2. 非決定性 trap（clock / random を実行時に捕まえる）───────────
//
// static grep だけでは「別名経由で時計を触る」を捕まえられないため、
// pure section の実行中は Date / Math.random の呼び出し回数を数える。
type Nondeterminism = { dateCalls: number; randomCalls: number };

function withNondeterminismTrap(run: () => void): Nondeterminism {
  const realDate = globalThis.Date;
  const realRandom = Math.random;
  let dateCalls = 0;
  let randomCalls = 0;

  const trapped = new Proxy(realDate, {
    construct(target, args, newTarget) {
      dateCalls += 1;
      return Reflect.construct(target as never, args, newTarget as never) as object;
    },
    apply(target, thisArg, args) {
      dateCalls += 1;
      return Reflect.apply(target as never, thisArg, args) as unknown;
    },
    get(target, prop, receiver) {
      if (prop === 'now' || prop === 'parse' || prop === 'UTC') {
        const fn = Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown;
        return (...a: unknown[]) => {
          dateCalls += 1;
          return fn.apply(target, a);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });

  (globalThis as { Date: unknown }).Date = trapped;
  Math.random = () => {
    randomCalls += 1;
    return realRandom();
  };
  try {
    run();
  } finally {
    (globalThis as { Date: unknown }).Date = realDate;
    Math.random = realRandom;
  }
  return { dateCalls, randomCalls };
}

// ── 3. 静的境界（G8 / forbidden import / no logging）──────────────

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** コメント行を除いた実コード行だけを返す（説明文中の語で誤検出しないため）。 */
function codeLines(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: string[] = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('*')) continue;
    // 行末コメントも落とす（`//` を含む文字列 / 正規表現は sync/** に存在しない）。
    const idx = raw.indexOf('//');
    out.push(idx >= 0 ? raw.slice(0, idx) : raw);
  }
  return out;
}

const FORBIDDEN_TOKENS: readonly string[] = [
  '@supabase',
  'supabase',
  'next/',
  'server-only',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'document.',
  'window.',
  'globalThis',
  'process.',
  'require(',
  'node:',
  'fetch(',
  'XMLHttpRequest',
  'Date.now',
  'Date.parse',
  'new Date',
  'Math.random',
  'crypto.',
  'randomUUID',
  'performance.now',
  'console.',
  '@anthropic-ai',
  'openai',
  'OpenAI',
  'Anthropic',
  'Gemini',
  '@google/genai',
  'ai-sdk',
];

function staticBoundaries(): void {
  const files = CORE_FILES.map((name) => join(SYNC_DIR, name));
  const allSyncFiles = listFiles(SYNC_DIR);
  const coreLevel = allSyncFiles.filter((f) => !relative(SYNC_DIR, f).includes(sep));
  check('sync core が 4 file 構成である（sync/ 直下に core 以外を置かない）',
    coreLevel.length === 4 &&
      coreLevel.every((f) => (CORE_FILES as readonly string[]).includes(relative(SYNC_DIR, f))),
    coreLevel.map((f) => relative(REPO_ROOT, f)).join(', '));

  const tokenHits: string[] = [];
  for (const file of files) {
    for (const line of codeLines(file)) {
      for (const token of FORBIDDEN_TOKENS) {
        if (line.includes(token)) {
          tokenHits.push(`${relative(REPO_ROOT, file)}: ${token}`);
        }
      }
    }
  }
  check('G8 forbidden token = 0（I/O / clock / random / vendor / logging）',
    tokenHits.length === 0, tokenHits.join(' | '));

  // import は sync/** 内部の相対 import だけ。lineage 未確定なので
  // 既存 types / reader / purpose contract へ結合を作らない。
  const importHits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)) {
      const spec = m[1];
      if (!/^\.\/[A-Za-z0-9_-]+$/.test(spec)) {
        importHits.push(`${relative(REPO_ROOT, file)}: ${spec}`);
      }
    }
  }
  check('G8 sync/** の import は sync/** 内部のみ', importHits.length === 0, importHits.join(' | '));

  // DB を触る動詞が存在しないこと。
  //   `.from(` は `Uint8Array.from(` のような builtin にも現れるため **受け手**で判定する。
  const BUILTIN_FROM = new Set(['Array', 'Uint8Array', 'Uint32Array', 'Object', 'String', 'Set', 'Map']);
  const mutation: string[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    for (const line of codeLines(file)) {
      for (const p of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
        if (line.includes(p)) mutation.push(`${rel}: ${p}`);
      }
      for (const m of line.matchAll(/([A-Za-z0-9_$]+)\.from\(/g)) {
        if (!BUILTIN_FROM.has(m[1])) mutation.push(`${rel}: ${m[1]}.from(`);
      }
    }
  }
  check('sync core に DB 動詞が 0 本', mutation.length === 0, mutation.join(' | '));

  // G7 の構造保証: verification は順序 API を触らない（= 新しい方を採用する経路を作らない）。
  const verificationSrc = codeLines(join(SYNC_DIR, 'verification.ts')).join('\n');
  check('G7 verification.ts は compareRevision を参照しない',
    !verificationSrc.includes('compareRevision'));
  for (const word of ['adopt', 'winner', 'newer', 'prefer', 'chooseSide', 'resolveConflict']) {
    check(`G7 verification.ts に "${word}" が現れない`, !verificationSrc.includes(word));
  }

  // G4: canonical serialization を公開していない（fingerprint から本文へ戻れない）。
  const fingerprintSrc = readFileSync(join(SYNC_DIR, 'fingerprint.ts'), 'utf8');
  check('G4 canonical encoder を export していない',
    !/^\s*export\s+function\s+encode/m.test(fingerprintSrc));

  // production runtime からの import = 0（Wave 1 は dead module）。
  const importers: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of listFiles(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(join('lib', 'examSpine'))) continue;
      const src = readFileSync(file, 'utf8');
      if (/examSpine\/sync/.test(src)) importers.push(rel);
    }
  }
  // ★ Stage 5.0 で sync/claim が pilot の production path に入った（E-S33）。
  //   sync core（revision / fingerprint / verification / adapters）自体は
  //   引き続き production から直接 import されない。接続点は claim 層だけである。
  const pilotImporters = ['app/tutor/page.tsx', 'app/api/tutor/route.ts'];
  const unexpected = importers.filter((f) => !pilotImporters.includes(f));
  check('sync を import する production file は Stage 5.0 pilot だけ',
    unexpected.length === 0, unexpected.join(', '));

  const coreDirect: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of listFiles(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(join('lib', 'examSpine'))) continue;
      const src = readFileSync(file, 'utf8');
      // claim 層以外の sync module を production が直接触っていないこと。
      if (/examSpine\/sync\/(revision|fingerprint|hash|verification|adapters)/.test(src)) {
        coreDirect.push(rel);
      }
    }
  }
  check('sync core 本体は production から直接 import されない（接続点は claim 層のみ）',
    coreDirect.length === 0, coreDirect.join(', '));
}

// ── 4. Export surface freeze ──────────────────────────────────────
//
// 「採用側を返す関数」が後から生えたことを、名前の集合で検出する。
function exportSurface(): void {
  const surfaces: Array<[string, Record<string, unknown>, readonly string[]]> = [
    ['hash.ts', HashMod as unknown as Record<string, unknown>, ['sha256Hex']],
    ['fingerprint.ts', FingerprintMod as unknown as Record<string, unknown>, [
      'EXAM_FINGERPRINT_MAX_DEPTH',
      'EXAM_FINGERPRINT_SEMANTICS',
      'EXAM_FINGERPRINT_VERSION',
      'ExamFingerprintError',
      'examFingerprint',
      'fingerprintEquality',
      'isExamFingerprint',
      'tryExamFingerprint',
    ]],
    ['revision.ts', RevisionMod as unknown as Record<string, unknown>, [
      'ABSENT_REVISION',
      'EXAM_REVISION_FORMS',
      'EXAM_REVISION_ORDERABLE_FORMS',
      'compareRevision',
      'normalizeRevisionInput',
      'revisionEquality',
      'revisionFromCounter',
      'revisionFromOpaque',
      'revisionFromTimestampText',
    ]],
    ['verification.ts', VerificationMod as unknown as Record<string, unknown>, [
      'EMPTY_CANDIDATE',
      'EXAM_SYNC_STATUSES',
      'UNCLAIMED_CANDIDATE',
      'UNREADABLE_CANDIDATE',
      'presentCandidate',
      'verifyExamSourcePair',
    ]],
  ];
  for (const [name, mod, expected] of surfaces) {
    const actual = Object.keys(mod).sort();
    eq(`export surface が freeze されている: ${name}`, actual, [...expected].sort());
  }

  const banned = /adopt|select|choose|pick|winner|newer|prefer|resolveConflict|merge/i;
  const offenders: string[] = [];
  for (const [name, mod] of surfaces) {
    for (const key of Object.keys(mod)) {
      if (banned.test(key)) offenders.push(`${name}: ${key}`);
    }
  }
  check('G7 「採用 / 選択」を示す export が 0（Canon §31）', offenders.length === 0,
    offenders.join(', '));
}

// ── 5. SHA-256 を node:crypto と突き合わせる ───────────────────────

function hashVectors(): void {
  const vectors: readonly string[] = [
    '',
    'a',
    'abc',
    'a'.repeat(55), // padding 境界
    'a'.repeat(56),
    'a'.repeat(63),
    'a'.repeat(64),
    'a'.repeat(65),
    'a'.repeat(1000),
    '日本語のテキスト',
    '絵文字🌸🎓👨‍👩‍👧‍👦',
    '\u{1f600}\u{10ffff}',
    '\ud800', // 孤立 surrogate（U+FFFD へ置換されること）
    'x\udc00y',
    'あ🌸'.repeat(500),
  ];
  const mismatched: string[] = [];
  for (let i = 0; i < vectors.length; i += 1) {
    const mine = sha256Hex(vectors[i]);
    const node = createHash('sha256').update(vectors[i], 'utf8').digest('hex');
    if (mine !== node) mismatched.push(`vector#${i} (len=${vectors[i].length})`);
  }
  check(`SHA-256 が node:crypto と一致（${vectors.length} vector）`,
    mismatched.length === 0, mismatched.join(', '));

  check('SHA-256 は 64 桁 hex', /^[0-9a-f]{64}$/.test(sha256Hex('abc')));
  check('SHA-256 は決定論的', sha256Hex('abc') === sha256Hex('abc'));
}

// ── 6. fingerprint: 決定論 / 形式 ─────────────────────────────────

const NESTED_FIXTURE = {
  basicInfo: { grade: 3, school: 'テスト高校' },
  history: [
    { id: 'a', body: '活動その1', tags: ['部活', '委員会'] },
    { id: 'b', body: '活動その2', tags: [] },
  ],
  diagnosis: null,
  draft: undefined,
};

function fingerprintBasics(): void {
  check('形式が efp1:<hex64>', isExamFingerprint(examFingerprint(NESTED_FIXTURE)));
  check('version 定数が efp1', EXAM_FINGERPRINT_VERSION === 'efp1');
  check('isExamFingerprint は他形式を弾く',
    !isExamFingerprint('deadbeef') && !isExamFingerprint('efp2:' + 'a'.repeat(64)) &&
    !isExamFingerprint(null) && !isExamFingerprint('efp1:' + 'A'.repeat(64)));

  const first = examFingerprint(NESTED_FIXTURE);
  let stable = true;
  for (let i = 0; i < 200; i += 1) {
    if (examFingerprint(NESTED_FIXTURE) !== first) stable = false;
  }
  check('determinism: 同一入力 200 回で同じ fingerprint', stable);

  // 別インスタンスの構造的同値も同じ（参照 identity に依存しない）。
  const clone = JSON.parse(JSON.stringify({ ...NESTED_FIXTURE, draft: null }));
  const withNullDraft = { ...NESTED_FIXTURE, draft: null };
  check('参照 identity ではなく構造で決まる',
    examFingerprint(clone) === examFingerprint(withNullDraft));

  // 凍結 vector。ここが変わる = encoding が変わったということなので、
  // 値を書き換えて PASS させず EXAM_FINGERPRINT_VERSION を上げること。
  eq('凍結 vector: ""', examFingerprint(''),
    'efp1:fb912574cecad54c6a0bc75b46172350b6374929d602d5fbcb4ca0ec831fd532');
  eq('凍結 vector: null', examFingerprint(null),
    'efp1:594e519ae499312b29433b7dd8a97ff068defcba9755b6d5d00e84c524d67b06');
  eq('凍結 vector: nested', examFingerprint({ a: [1, 'x', null], b: { c: true } }),
    'efp1:800607c9259dfddcfe36e453d5736c36be1fda621394d8c34cc5f3d1be448add');
}

// ── 7. G1: object key order 非依存 ────────────────────────────────

function keyOrderInvariance(): void {
  const a = { z: 1, a: 2, m: { y: 'b', x: 'a' }, list: [{ q: 1, p: 2 }] };
  const b = { m: { x: 'a', y: 'b' }, list: [{ p: 2, q: 1 }], a: 2, z: 1 };
  check('G1 object key 順が違っても同じ fingerprint',
    examFingerprint(a) === examFingerprint(b));

  // 動的に順を変えても同じ。
  const keys = ['k1', 'k2', 'k3', 'k4', 'k5'];
  const forward: Record<string, unknown> = {};
  const backward: Record<string, unknown> = {};
  for (const k of keys) forward[k] = `${k}-value`;
  for (const k of [...keys].reverse()) backward[k] = `${k}-value`;
  check('G1 挿入順を逆にしても同じ fingerprint',
    examFingerprint(forward) === examFingerprint(backward));
  check('G1 宣言と一致: objectKeyOrder=non_semantic',
    EXAM_FINGERPRINT_SEMANTICS.objectKeyOrder === 'non_semantic');

  // 非 ASCII / 記号 key でも locale 非依存で安定すること。
  const u1 = { 'ä': 1, 'z': 2, 'A': 3, 'a': 4, '_': 5, '面接': 6 };
  const u2 = { '面接': 6, '_': 5, 'a': 4, 'A': 3, 'z': 2, 'ä': 1 };
  check('G1 非 ASCII key でも順序非依存', examFingerprint(u1) === examFingerprint(u2));

  // Object.create(null) も plain object として扱える。
  const nullProto = Object.create(null) as Record<string, unknown>;
  nullProto.a = 1;
  check('null prototype object も fingerprint できる', isExamFingerprint(examFingerprint(nullProto)));
}

// ── 8. G2: array order は semantic（★ negative control ★）─────────

function arrayOrderSensitivity(): void {
  check('G2 宣言と一致: arrayOrder=semantic',
    EXAM_FINGERPRINT_SEMANTICS.arrayOrder === 'semantic');

  const cases: Array<[string, unknown[]]> = [
    ['数値配列', [1, 2, 3]],
    ['文字列配列', ['a', 'b', 'c']],
    ['面接履歴', [{ q: 'Q1', a: 'A1' }, { q: 'Q2', a: 'A2' }, { q: 'Q3', a: 'A3' }]],
    ['活動履歴', [{ id: 1 }, { id: 2 }]],
    ['ranking', ['第1志望', '第2志望', '第3志望']],
    ['混在', [null, undefined, 0, false, '']],
  ];
  const unchanged: string[] = [];
  for (const [label, arr] of cases) {
    const forward = examFingerprint(arr);
    const reversed = examFingerprint([...arr].reverse());
    if (forward === reversed) unchanged.push(label);
  }
  check('G2 ★ 逆順の配列は必ず別 fingerprint（generic 層で sort していない）',
    unchanged.length === 0, `sort されている疑い: ${unchanged.join(', ')}`);

  // 入れ子の内側の配列でも順序が効くこと。
  const deepA = { a: { b: { c: [{ x: [1, 2] }] } } };
  const deepB = { a: { b: { c: [{ x: [2, 1] }] } } };
  check('G2 入れ子の配列でも順序が効く', examFingerprint(deepA) !== examFingerprint(deepB));

  // 隣接 2 要素の入れ替えだけでも検出できる（sort されていれば同値になる）。
  check('G2 隣接 swap を検出',
    examFingerprint(['b', 'a', 'c']) !== examFingerprint(['a', 'b', 'c']));

  // 対称なケースは同じで良い（false positive を作っていないことの確認）。
  check('G2 回文配列は逆順でも同じ（過検出していない）',
    examFingerprint([1, 1]) === examFingerprint([1, 1]));

  // 配列と object を混同しない。
  check('配列 [1,2] と object {0:1,1:2} は別物',
    examFingerprint([1, 2]) !== examFingerprint({ 0: 1, 1: 2 }));
}

// ── 9. G3: 値の区別 / negative content change ─────────────────────

function valueDistinctions(): void {
  const distinct: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['空文字', ''],
    ['文字列 "null"', 'null'],
    ['文字列 "undefined"', 'undefined'],
    ['0', 0],
    ['文字列 "0"', '0'],
    ['false', false],
    ['true', true],
    ['空配列', []],
    ['空 object', {}],
    ['{a:undefined}', { a: undefined }],
    ['{a:null}', { a: null }],
    ['[undefined]', [undefined]],
    ['[null]', [null]],
    ['bigint 0', BigInt(0)],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['tag 文字列 u', 'u'],
    ['tag 文字列 z', 'z'],
    ['{a:{b:1}}', { a: { b: 1 } }],
    ['{"a.b":1}', { 'a.b': 1 }],
    ["['ab','c']", ['ab', 'c']],
    ["['a','bc']", ['a', 'bc']],
  ];
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const [label, value] of distinct) {
    const fp = examFingerprint(value);
    const prev = seen.get(fp);
    if (prev !== undefined) collisions.push(`${prev} == ${label}`);
    seen.set(fp, label);
  }
  check(`G3 ${distinct.length} 種の値がすべて別 fingerprint`,
    collisions.length === 0, collisions.join(' | '));

  check('G3 宣言と一致: undefined ≠ null',
    EXAM_FINGERPRINT_SEMANTICS.undefinedDistinctFromNull &&
    examFingerprint(undefined) !== examFingerprint(null));
  check('G3 宣言と一致: {a:undefined} ≠ {}',
    EXAM_FINGERPRINT_SEMANTICS.absentPropertyDistinctFromUndefinedProperty &&
    examFingerprint({ a: undefined }) !== examFingerprint({}));
  check('宣言と一致: -0 は 0 と同じ（JSON round-trip で保てないため）',
    EXAM_FINGERPRINT_SEMANTICS.minusZeroNormalizedToZero &&
    examFingerprint(-0) === examFingerprint(0) &&
    examFingerprint({ n: -0 }) === examFingerprint({ n: 0 }));

  // negative content change: 深い位置の 1 文字 / 1 bit の変化を必ず検出する。
  const base = examFingerprint(NESTED_FIXTURE);
  const mutations: Array<[string, unknown]> = [
    ['深い文字列を 1 文字変更', {
      ...NESTED_FIXTURE,
      history: [
        { id: 'a', body: '活動その１', tags: ['部活', '委員会'] },
        { id: 'b', body: '活動その2', tags: [] },
      ],
    }],
    ['数値を微小変更', { ...NESTED_FIXTURE, basicInfo: { grade: 3.0000000001, school: 'テスト高校' } }],
    ['key 名を変更', { ...NESTED_FIXTURE, basicInfoX: NESTED_FIXTURE.basicInfo }],
    ['null → undefined', { ...NESTED_FIXTURE, diagnosis: undefined }],
    ['空配列に 1 件追加', {
      ...NESTED_FIXTURE,
      history: [
        { id: 'a', body: '活動その1', tags: ['部活', '委員会'] },
        { id: 'b', body: '活動その2', tags: [''] },
      ],
    }],
    ['末尾に空白を追加', { ...NESTED_FIXTURE, basicInfo: { grade: 3, school: 'テスト高校 ' } }],
  ];
  const missed: string[] = [];
  for (const [label, mutated] of mutations) {
    if (examFingerprint(mutated) === base) missed.push(label);
  }
  check('negative control: 内容変更をすべて検出', missed.length === 0, missed.join(', '));
}

// ── 10. G5: 失敗が本文を漏らさない ────────────────────────────────

class SomeDomainClass {
  value = 1;
}

const CANARY = 'CANARY_LEAK_PROBE_9f3a';

type ErrorCase = { label: string; value: unknown; code: string; valueType: string };

function buildErrorCases(): ErrorCase[] {
  // ★ fixture は非決定性 trap の **外** で作る（Date 構築が trap に数えられないように）。
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;

  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let i = 0; i < EXAM_FINGERPRINT_MAX_DEPTH + 5; i += 1) {
    const next: Record<string, unknown> = {};
    cursor.child = next;
    cursor = next;
  }

  const symbolKeyed: Record<string, unknown> = { note: CANARY };
  (symbolKeyed as Record<string | symbol, unknown>)[Symbol('secret')] = 1;

  return [
    { label: 'Date', value: { studentName: CANARY, at: new Date(0) }, code: 'unsupported_object', valueType: 'Date' },
    { label: 'Map', value: new Map([['k', CANARY]]), code: 'unsupported_object', valueType: 'Map' },
    { label: 'Set', value: new Set([CANARY]), code: 'unsupported_object', valueType: 'Set' },
    { label: 'RegExp', value: /secret/, code: 'unsupported_object', valueType: 'RegExp' },
    { label: 'class instance', value: new SomeDomainClass(), code: 'unsupported_object', valueType: 'SomeDomainClass' },
    { label: 'function', value: { fn: () => CANARY }, code: 'unsupported_value', valueType: 'function' },
    { label: 'symbol 値', value: { s: Symbol(CANARY) }, code: 'unsupported_value', valueType: 'symbol' },
    { label: 'symbol key', value: symbolKeyed, code: 'symbol_key', valueType: 'Object' },
    { label: '循環参照', value: circular, code: 'circular_reference', valueType: 'Object' },
    { label: '深さ超過', value: deep, code: 'max_depth_exceeded', valueType: 'Object' },
  ];
}

function failClosed(cases: readonly ErrorCase[]): void {
  const wrongCode: string[] = [];
  const leaks: string[] = [];
  for (const c of cases) {
    let thrown: unknown = null;
    try {
      examFingerprint(c.value);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof ExamFingerprintError)) {
      wrongCode.push(`${c.label}: throw されなかった`);
      continue;
    }
    if (thrown.code !== c.code) wrongCode.push(`${c.label}: code=${thrown.code} (期待 ${c.code})`);
    if (thrown.valueType !== c.valueType) {
      wrongCode.push(`${c.label}: valueType=${thrown.valueType} (期待 ${c.valueType})`);
    }
    const text = `${thrown.message} ${thrown.valueType}`;
    if (text.includes(CANARY)) leaks.push(`${c.label}: canary`);
    if (text.includes('studentName') || text.includes('note') || text.includes('child')) {
      leaks.push(`${c.label}: key 名`);
    }
  }
  check(`G5 表現できない値は fail-closed で throw（${cases.length} 種）`,
    wrongCode.length === 0, wrongCode.join(' | '));
  check('G5 error message に入力本文 / key 名が含まれない', leaks.length === 0, leaks.join(' | '));

  // tryExamFingerprint も同じ情報しか返さない。
  const r = tryExamFingerprint({ studentName: CANARY, fn: () => 1 });
  check('tryExamFingerprint は失敗を値で返す', r.ok === false);
  if (!r.ok) {
    check('tryExamFingerprint の失敗にも本文が含まれない',
      !JSON.stringify(r).includes(CANARY) && !JSON.stringify(r).includes('studentName'),
      JSON.stringify(r));
  }
  const ok = tryExamFingerprint({ a: 1 });
  check('tryExamFingerprint は成功時に fingerprint を返す',
    ok.ok === true && isExamFingerprint(ok.fingerprint));

  // G4: fingerprint から本文が読み取れない（本文の断片が hex に現れない）。
  const fp = examFingerprint({ body: CANARY });
  check('G4 fingerprint に本文が現れない',
    !fp.includes(CANARY) && fp.length === 'efp1:'.length + 64);
}

// ── 11. fingerprintEquality ───────────────────────────────────────

function fingerprintEqualityChecks(): void {
  const a = examFingerprint({ x: 1 });
  const b = examFingerprint({ x: 1 });
  const c = examFingerprint({ x: 2 });
  eq('fingerprintEquality equal', fingerprintEquality(a, b), 'equal');
  eq('fingerprintEquality different', fingerprintEquality(a, c), 'different');
  eq('fingerprintEquality null は unknown', fingerprintEquality(a, null), 'unknown');
  eq('fingerprintEquality 両方 null は unknown', fingerprintEquality(null, null), 'unknown');
  eq('fingerprintEquality 不正形式は unknown', fingerprintEquality(a, 'garbage'), 'unknown');
}

// ── 12. revision primitive ────────────────────────────────────────

function revisionChecks(expectedEpoch: number): void {
  eq('form 一覧が 5 種', [...EXAM_REVISION_FORMS].sort(),
    ['absent', 'counter', 'opaque', 'timestamp', 'uninterpretable']);
  eq('順序を持つ form は timestamp / counter のみ',
    [...EXAM_REVISION_ORDERABLE_FORMS], ['timestamp', 'counter']);
  eq('ABSENT_REVISION', ABSENT_REVISION, { form: 'absent' });

  // normalize
  eq('undefined → absent', normalizeRevisionInput(undefined), { form: 'absent' });
  eq('null → absent', normalizeRevisionInput(null), { form: 'absent' });
  eq('空白のみ → absent', normalizeRevisionInput('   '), { form: 'absent' });
  eq('数値 → counter', normalizeRevisionInput(42), { form: 'counter', value: 42 });
  eq('数字文字列は counter へ昇格しない', normalizeRevisionInput('42'),
    { form: 'opaque', token: '42' });
  eq('uuid → opaque', normalizeRevisionInput(' 3f2504e0-4f89-11d3-9a0c-0305e82c3301 '),
    { form: 'opaque', token: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' });
  eq('小数 → uninterpretable', normalizeRevisionInput(1.5),
    { form: 'uninterpretable', valueType: 'number' });
  eq('NaN → uninterpretable', normalizeRevisionInput(Number.NaN),
    { form: 'uninterpretable', valueType: 'number' });
  eq('boolean → uninterpretable', normalizeRevisionInput(true),
    { form: 'uninterpretable', valueType: 'boolean' });
  eq('object → uninterpretable', normalizeRevisionInput({}),
    { form: 'uninterpretable', valueType: 'object' });
  eq('array → uninterpretable', normalizeRevisionInput([]),
    { form: 'uninterpretable', valueType: 'array' });
  eq('bigint(小) → counter', normalizeRevisionInput(BigInt(7)), { form: 'counter', value: 7 });
  eq('bigint(巨大) → uninterpretable', normalizeRevisionInput(BigInt('90071992547409931')),
    { form: 'uninterpretable', valueType: 'bigint' });
  eq('日時の形だが実在しない値は opaque に落とさない',
    normalizeRevisionInput('2026-02-30T00:00:00Z'), { form: 'uninterpretable', valueType: 'string' });

  // timestamp 解析（Date を使わない実装を Date.UTC の値と突き合わせる）
  const ts = normalizeRevisionInput('2026-08-26T09:12:33.123456+00:00');
  eq('PostgREST 形式の timestamp',
    ts, { form: 'timestamp', epochSeconds: expectedEpoch, nanos: 123456000, offsetKnown: true });

  const z = revisionFromTimestampText('2026-08-26T09:12:33.123456Z');
  eq('Z 表記が同じ instant', revisionEquality(ts, z), 'equal');
  const jst = revisionFromTimestampText('2026-08-26T18:12:33.123456+09:00');
  eq('+09:00 表記が同じ instant', revisionEquality(ts, jst), 'equal');
  const jstCompact = revisionFromTimestampText('2026-08-26T18:12:33.123456+0900');
  eq('+0900 表記も同じ instant', revisionEquality(ts, jstCompact), 'equal');

  const noZone = revisionFromTimestampText('2026-08-26T09:12:33.123456');
  check('offset 無しは offsetKnown=false',
    noZone.form === 'timestamp' && noZone.offsetKnown === false);
  eq('offset 有無が混ざる比較は unknown', revisionEquality(ts, noZone), 'unknown');
  eq('offset 有無が混ざる比較は zone_unknown', compareRevision(ts, noZone),
    { comparable: false, reason: 'zone_unknown' });

  // うるう年 / 世紀境界
  check('うるう年 2024-02-29 は有効',
    revisionFromTimestampText('2024-02-29T00:00:00Z').form === 'timestamp');
  eq('平年 2023-02-29 は無効', revisionFromTimestampText('2023-02-29T00:00:00Z'),
    { form: 'uninterpretable', valueType: 'string' });
  check('1900-02-29 は無効（400 年規則）',
    revisionFromTimestampText('1900-02-29T00:00:00Z').form === 'uninterpretable');
  check('2000-02-29 は有効（400 年規則）',
    revisionFromTimestampText('2000-02-29T00:00:00Z').form === 'timestamp');
  eq('epoch 原点', revisionFromTimestampText('1970-01-01T00:00:00Z'),
    { form: 'timestamp', epochSeconds: 0, nanos: 0, offsetKnown: true });
  eq('epoch より前', revisionFromTimestampText('1969-12-31T23:59:59Z'),
    { form: 'timestamp', epochSeconds: -1, nanos: 0, offsetKnown: true });

  // 精度
  const micro1 = revisionFromTimestampText('2026-08-26T09:12:33.123456Z');
  const micro2 = revisionFromTimestampText('2026-08-26T09:12:33.123457Z');
  eq('microsecond 差を落とさない', revisionEquality(micro1, micro2), 'different');

  // equality の 3 値
  eq('両方 absent は unknown（一致ではない）',
    revisionEquality(ABSENT_REVISION, ABSENT_REVISION), 'unknown');
  eq('form 違いは unknown',
    revisionEquality(revisionFromCounter(1), revisionFromOpaque('1')), 'unknown');
  eq('uninterpretable は unknown',
    revisionEquality(normalizeRevisionInput(1.5), revisionFromCounter(1)), 'unknown');
  eq('counter 一致', revisionEquality(revisionFromCounter(3), revisionFromCounter(3)), 'equal');
  eq('counter 不一致', revisionEquality(revisionFromCounter(3), revisionFromCounter(4)), 'different');
  eq('opaque 一致', revisionEquality(revisionFromOpaque('e1'), revisionFromOpaque('e1')), 'equal');
  eq('opaque 不一致', revisionEquality(revisionFromOpaque('e1'), revisionFromOpaque('e2')), 'different');
  eq('空 opaque は absent', revisionFromOpaque('   '), { form: 'absent' });
  eq('非整数 counter は uninterpretable', revisionFromCounter(1.5),
    { form: 'uninterpretable', valueType: 'number' });

  // compare — 「観測」であって採用ではない
  eq('counter の順序', compareRevision(revisionFromCounter(1), revisionFromCounter(2)),
    { comparable: true, order: -1 });
  eq('timestamp の順序', compareRevision(micro1, micro2), { comparable: true, order: -1 });
  eq('同値は 0', compareRevision(micro1, micro1), { comparable: true, order: 0 });
  eq('absent は比較不能', compareRevision(ABSENT_REVISION, revisionFromCounter(1)),
    { comparable: false, reason: 'absent' });
  eq('form 違いは比較不能', compareRevision(revisionFromCounter(1), revisionFromOpaque('a')),
    { comparable: false, reason: 'form_mismatch' });
  eq('opaque は順序を持たない',
    compareRevision(revisionFromOpaque('a'), revisionFromOpaque('b')),
    { comparable: false, reason: 'not_ordered' });
  eq('uninterpretable は比較不能',
    compareRevision(normalizeRevisionInput(1.5), revisionFromCounter(1)),
    { comparable: false, reason: 'uninterpretable' });

  // 反対称性 + equality との整合
  const sample: ExamRevisionValue[] = [
    ABSENT_REVISION,
    normalizeRevisionInput(1.5),
    revisionFromCounter(1),
    revisionFromCounter(2),
    revisionFromOpaque('a'),
    revisionFromOpaque('b'),
    micro1,
    micro2,
    noZone,
  ];
  const broken: string[] = [];
  for (const a of sample) {
    for (const b of sample) {
      const ab = compareRevision(a, b);
      const ba = compareRevision(b, a);
      if (ab.comparable !== ba.comparable) broken.push('comparable が非対称');
      else if (ab.comparable && ba.comparable && ab.order !== -ba.order) {
        broken.push(`order が非対称: ${ab.order} vs ${ba.order}`);
      }
      const equality = revisionEquality(a, b);
      if (ab.comparable && ab.order === 0 && equality !== 'equal') broken.push('order 0 なのに equal でない');
      if (equality === 'different' && ab.comparable && ab.order === 0) broken.push('different なのに order 0');
    }
  }
  check('compareRevision は反対称で equality と整合', broken.length === 0,
    [...new Set(broken)].join(' | '));

  // G6: kind 固有語彙が漏れていないこと。
  const src = readFileSync(join(SYNC_DIR, 'revision.ts'), 'utf8');
  const kindWords = ['self_pr', 'statement_review', 'interview_ai', 'presentation',
    'basic_info', 'activity_logs', 'updated_at', 'created_at'];
  const leaked = kindWords.filter((w) => codeLines(join(SYNC_DIR, 'revision.ts')).join('\n').includes(w));
  check('G6 revision.ts に kind 固有 / 列固有の規則が無い', leaked.length === 0, leaked.join(', '));
  void src;
}

// ── 13. verification primitive ────────────────────────────────────

function verificationChecks(): void {
  eq('status は 5 種', [...EXAM_SYNC_STATUSES],
    ['verified', 'mismatch', 'unclaimed', 'unreadable', 'incomparable']);

  const fpA = examFingerprint({ body: 'A' });
  const fpB = examFingerprint({ body: 'B' });
  const rev1 = revisionFromCounter(1);
  const rev2 = revisionFromCounter(2);

  const presentA = presentCandidate({ fingerprint: fpA, revision: rev1 });
  const presentA2 = presentCandidate({ fingerprint: fpA, revision: rev1 });
  const presentB = presentCandidate({ fingerprint: fpB, revision: rev1 });
  const presentANoFp = presentCandidate({ revision: rev1 });
  const presentANoRev = presentCandidate({ fingerprint: fpA });

  // 1. unreadable が最優先（Canon §15）
  eq('canonical が unreadable',
    verifyExamSourcePair({ canonical: UNREADABLE_CANDIDATE, mirror: presentA }).status, 'unreadable');
  eq('mirror が unreadable',
    verifyExamSourcePair({ canonical: presentA, mirror: UNREADABLE_CANDIDATE }).status, 'unreadable');
  const bothUnreadable = verifyExamSourcePair({
    canonical: UNREADABLE_CANDIDATE, mirror: UNREADABLE_CANDIDATE });
  check('両方 unreadable は side=both',
    bothUnreadable.status === 'unreadable' && bothUnreadable.side === 'both');
  const sideCheck = verifyExamSourcePair({ canonical: UNREADABLE_CANDIDATE, mirror: EMPTY_CANDIDATE });
  check('side が canonical と分かる',
    sideCheck.status === 'unreadable' && sideCheck.side === 'canonical');
  eq('unreadable は unclaimed より優先',
    verifyExamSourcePair({ canonical: UNCLAIMED_CANDIDATE, mirror: UNREADABLE_CANDIDATE }).status,
    'unreadable');

  // ★ unreadable を empty として扱わない（Canon §15 の中心）
  const emptyBoth = verifyExamSourcePair({ canonical: EMPTY_CANDIDATE, mirror: EMPTY_CANDIDATE });
  check('★ unreadable と empty が同じ結果にならない',
    bothUnreadable.status !== emptyBoth.status);

  // 2. unclaimed（Canon §14）
  eq('canonical が unclaimed',
    verifyExamSourcePair({ canonical: UNCLAIMED_CANDIDATE, mirror: presentA }).status, 'unclaimed');
  eq('mirror が unclaimed',
    verifyExamSourcePair({ canonical: presentA, mirror: UNCLAIMED_CANDIDATE }).status, 'unclaimed');

  // 3. 両方 empty
  check('両方 empty は verified / both_empty',
    emptyBoth.status === 'verified' && emptyBoth.agreement === 'both_empty' &&
    emptyBoth.fingerprint === null);

  // 4. 片方だけ empty
  for (const pair of [
    { canonical: EMPTY_CANDIDATE, mirror: presentA },
    { canonical: presentA, mirror: EMPTY_CANDIDATE },
  ]) {
    const r = verifyExamSourcePair(pair);
    check('片方だけ empty は mismatch / presence',
      r.status === 'mismatch' && r.evidence === 'presence');
  }

  // 5. 両方 present
  const verified = verifyExamSourcePair({ canonical: presentA, mirror: presentA2 });
  check('内容一致 + revision 一致 → verified / fingerprint',
    verified.status === 'verified' && verified.agreement === 'fingerprint' &&
    verified.fingerprint === fpA);

  const verifiedNoRev = verifyExamSourcePair({
    canonical: presentANoRev, mirror: presentCandidate({ fingerprint: fpA }) });
  check('内容一致 + revision 不明 → verified（revision が矛盾していない）',
    verifiedNoRev.status === 'verified' && verifiedNoRev.agreement === 'fingerprint');

  const contentMismatch = verifyExamSourcePair({ canonical: presentA, mirror: presentB });
  check('内容不一致 → mismatch / fingerprint',
    contentMismatch.status === 'mismatch' && contentMismatch.evidence === 'fingerprint');

  const revMismatch = verifyExamSourcePair({
    canonical: presentA, mirror: presentCandidate({ fingerprint: fpA, revision: rev2 }) });
  check('内容一致でも revision 相違 → mismatch / revision（Canon §13）',
    revMismatch.status === 'mismatch' && revMismatch.evidence === 'revision');

  const incomparable = verifyExamSourcePair({ canonical: presentANoFp, mirror: presentA });
  check('fingerprint 欠落 → incomparable（verified にも mismatch にもしない）',
    incomparable.status === 'incomparable' && incomparable.reason === 'fingerprint_missing');

  const noFpDiffRev = verifyExamSourcePair({
    canonical: presentANoFp, mirror: presentCandidate({ revision: rev2 }) });
  check('fingerprint 欠落 + revision 相違 → mismatch / revision',
    noFpDiffRev.status === 'mismatch' && noFpDiffRev.evidence === 'revision');

  // signals が判定根拠を保持している
  eq('signals が根拠を残す', verified.signals,
    { content: 'equal', revision: 'equal', presence: 'both_present' });
  eq('incomparable の signals', incomparable.signals,
    { content: 'unknown', revision: 'equal', presence: 'both_present' });

  // 6. G7: 採用側を返さない / 対称である
  const candidates: ExamSyncCandidate[] = [
    UNREADABLE_CANDIDATE, UNCLAIMED_CANDIDATE, EMPTY_CANDIDATE,
    presentA, presentB, presentANoFp, presentANoRev,
    presentCandidate({ fingerprint: fpA, revision: rev2 }),
  ];
  const ALLOWED_KEYS = new Set([
    'status', 'side', 'evidence', 'agreement', 'fingerprint', 'reason', 'signals',
  ]);
  const badKeys: string[] = [];
  const asymmetric: string[] = [];
  let combos = 0;
  for (const canonical of candidates) {
    for (const mirror of candidates) {
      combos += 1;
      const r = verifyExamSourcePair({ canonical, mirror });
      for (const key of Object.keys(r)) {
        if (!ALLOWED_KEYS.has(key)) badKeys.push(key);
      }
      if (!(EXAM_SYNC_STATUSES as readonly string[]).includes(r.status)) {
        badKeys.push(`status=${r.status}`);
      }
      const swapped = verifyExamSourcePair({ canonical: mirror, mirror: canonical });
      if (swapped.status !== r.status) {
        asymmetric.push(`${canonical.state}/${mirror.state}: ${r.status} vs ${swapped.status}`);
      }
    }
  }
  check(`G7 返り値に採用側を示す field が無い（${combos} 組）`,
    badKeys.length === 0, [...new Set(badKeys)].join(', '));
  check('G7 canonical / mirror を入れ替えても status が変わらない（採用判断をしていない）',
    asymmetric.length === 0, [...new Set(asymmetric)].join(' | '));

  // 7. G6: Authority / kind 語彙が verification に無い
  const src = codeLines(join(SYNC_DIR, 'verification.ts')).join('\n');
  const authorityWords = ['device_canonical_mirrored', 'server_authoritative', 'localStorage',
    'self_pr', 'statement_review', 'interview_ai', 'presentation', 'veto'];
  const leaked = authorityWords.filter((w) => src.includes(w));
  check('G6 verification.ts に authority / kind / veto 判断が無い',
    leaked.length === 0, leaked.join(', '));
}

// ── 14. run ───────────────────────────────────────────────────────

function aiSdkLoaded(): boolean {
  const cache =
    (globalThis as { require?: { cache?: Record<string, unknown> } }).require?.cache ??
    (typeof require !== 'undefined' ? require.cache : undefined);
  if (!cache) return false;
  return Object.keys(cache).some(
    (p) => p.includes('@anthropic-ai') || p.includes('/openai/') || p.includes('@google/genai'),
  );
}

function main(): void {
  console.log('[exam-spine-sync-core] Stage 4 Wave 1 sync core primitive check');
  console.log(`[exam-spine-sync-core] fingerprint=${EXAM_FINGERPRINT_VERSION} maxDepth=${EXAM_FINGERPRINT_MAX_DEPTH}`);

  // Date を trap する前に、Date に依存する期待値と fixture を作っておく。
  const expectedEpoch = Date.UTC(2026, 7, 26, 9, 12, 33) / 1000;
  const errorCases = buildErrorCases();

  staticBoundaries();
  exportSurface();
  hashVectors();

  // pure section — この中で clock / random が 1 度でも呼ばれたら fail。
  const nondet = withNondeterminismTrap(() => {
    fingerprintBasics();
    keyOrderInvariance();
    arrayOrderSensitivity();
    valueDistinctions();
    failClosed(errorCases);
    fingerprintEqualityChecks();
    revisionChecks(expectedEpoch);
    verificationChecks();
  });

  check(`clock 呼び出し = 0（実測 ${nondet.dateCalls}）`, nondet.dateCalls === 0);
  check(`random 呼び出し = 0（実測 ${nondet.randomCalls}）`, nondet.randomCalls === 0);

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-sync-core] FAIL: 外部通信が ${fetchCallCount} 回発生しました`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-sync-core] network calls = ${fetchCallCount}（実 Supabase / AI 呼び出しゼロ）`);
  console.log(`[exam-spine-sync-core] clock calls   = ${nondet.dateCalls}`);
  console.log(`[exam-spine-sync-core] random calls  = ${nondet.randomCalls}`);
  console.log(`[exam-spine-sync-core] AI SDK loaded = ${aiSdkLoaded() ? 'YES' : 'NO'}`);
  if (aiSdkLoaded()) {
    console.error('[exam-spine-sync-core] FAIL: AI SDK が module graph に載っています');
    process.exitCode = 1;
    return;
  }

  console.log(`[exam-spine-sync-core] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`\n[exam-spine-sync-core] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 25)) console.error(`  - ${f}`);
    if (failures.length > 25) console.error(`  … 他 ${failures.length - 25} 件`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-sync-core] PASS');
}

main();
