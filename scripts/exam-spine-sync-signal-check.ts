// Exam Spine — Stage 5 Packet 1 / claim → verdict → enable contract check。
//
// ★ E-H7 human ruling（OPTION 1）適用後の姿 ★
//
//   E-S33 / sync/claim/**  （wire `edc1` / header x-exam-spine-device-claim）
//        ↓ parse（1 回だけ。transport parsing authority は E-S33 に一元化）
//   validated claim set（transport 非依存の最小 interface）
//        ↓
//   E-S2 の **4 値** verdict（unreadable > unclaimed > mismatch > verified）
//        ↓ default-deny usability decision（E-S11 / runtime block）
//   usable / veto
//
//   を PII 0 / authority decision 0 / runtime consumption 0 /
//   第 5 の外部 verdict 0 / **transport authority 1 本** で成立させる。
//
// ★ 旧 `esy1`（sync/signal.ts）は transport authority として廃止済み ★
//   本 script は `edc1` を正本として検証する。esy1 固有の serialize / 上限 /
//   区切り / version parse の検査は E-S33 側（stage5-check）へ責務が移っている。
//   ここに残したのは **transport 非依存**の verification 契約と、
//   「transport authority が 1 本であること」の構造検査である。
//
// 厳守: 実ネットワーク 0 / 実 DB 0 / AI 0 / clock 0 / random 0 / production 変更 0
//
// 使い方: npm run qa:examSpine:syncSignal

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(`[exam-spine-sync-signal] 外部通信が発生しました: ${target}`);
}) as typeof globalThis.fetch;
void originalFetch;

import { EXAM_SOURCE_KINDS } from '@/lib/examSpine/sourceData/types';
import type { ExamSourceKind, ExamSourceReadStatus } from '@/lib/examSpine/sourceData/types';
import { EXAM_FINGERPRINT_VERSION } from '@/lib/examSpine/sync/fingerprint';
import type { ExamFingerprint } from '@/lib/examSpine/sync/fingerprint';
import { EXAM_SYNC_SUPPORTED_KINDS } from '@/lib/examSpine/sync/adapters/registry';
import type { ExamSyncSupportedKind } from '@/lib/examSpine/sync/adapters/registry';
import { examSyncObservation } from '@/lib/examSpine/sync/adapters/views';
import type { ExamSyncObservation } from '@/lib/examSpine/sync/adapters/types';
import { sourcesForPurpose } from '@/lib/examSpine/purpose';

import * as VerdictMod from '@/lib/examSpine/sync/verdict';
import * as EnableMod from '@/lib/examSpine/sync/enable';

// ★ transport は E-S33 の 1 本だけを使う（重複 parser を作らない / §9）
import {
  EXAM_DEVICE_CLAIM_HEADER,
  EXAM_DEVICE_CLAIM_MAX_BYTES,
  EXAM_DEVICE_CLAIM_MAX_ENTRIES,
  EXAM_DEVICE_CLAIM_VERSION,
} from '@/lib/examSpine/sync/claim/types';
import { serializeDeviceClaim } from '@/lib/examSpine/sync/claim/serialize';
import {
  parseDeviceClaimHeader,
  parseDeviceClaimValue,
  summarizeDeviceClaim,
  toDeviceClaims,
} from '@/lib/examSpine/sync/claim/parse';

import {
  EMPTY_EXAM_SYNC_CLAIM_SET,
  EXAM_SYNC_EXTERNAL_VERDICTS,
  allExamSyncVerified,
  claimedFingerprint,
  foldExamSyncInternalStatus,
  examSyncVerdict,
  examSyncVerdicts,
  isExamSyncUsableVerdict,
  summarizeExamSyncVeto,
} from '@/lib/examSpine/sync/verdict';
import type {
  ExamSyncClaimSet,
  ExamSyncExternalVerdict,
  ExamSyncVerdictMap,
} from '@/lib/examSpine/sync/verdict';
import {
  examSyncUsability,
  examSyncUsableKinds,
  isExamSyncRuntimeBlocked,
  summarizeExamSyncEnable,
} from '@/lib/examSpine/sync/enable';
import { EXAM_SYNC_RUNTIME_ENABLE_BLOCKED } from '@/lib/examSpine/sync/adapters/registry';

// ── assertion helper ──────────────────────────────────────────────
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
const CONTRACT_FILES = ['verdict.ts', 'enable.ts'];
/** 制御文字を source に直接置かないため code point から作る。 */
const NUL = String.fromCharCode(0);

// ── 非決定性 trap ─────────────────────────────────────────────────
function withNondeterminismTrap(run: () => void): { dateCalls: number; randomCalls: number } {
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

// ── fixtures ──────────────────────────────────────────────────────

function obs(kind: ExamSyncSupportedKind, seed: unknown): ExamSyncObservation {
  return examSyncObservation({ kind, source: 'server_mirror', view: seed });
}

/** kind ごとの実 fingerprint（Wave 1/2 の実装で生成する。手書きしない）。 */
const FP: Record<ExamSyncSupportedKind, ExamFingerprint> = (() => {
  const out = {} as Record<ExamSyncSupportedKind, ExamFingerprint>;
  for (const kind of EXAM_SYNC_SUPPORTED_KINDS) {
    out[kind] = obs(kind, { seed: kind }).fingerprint;
  }
  return out;
})();

// ── 1. transport authority が 1 本であること ──────────────────────
//
// ★ E-H7 の中心的な不変条件 ★
//   「device claim を wire で運ぶ」責務の実装が canonical namespace に 1 本しか無く、
//   production から到達できる transport も 1 本であることを構造で固定する。
//   docs に歴史的経緯として `esy1` が残ることは許すが、**active code に残ることは許さない**。

const RUNTIME_DIRS = ['app', 'lib'] as const;

function activeCodeFiles(): string[] {
  const out: string[] = [];
  for (const dir of RUNTIME_DIRS) out.push(...listFiles(join(REPO_ROOT, dir)));
  return out;
}

function transportAuthority(): void {
  // 1-a. retired transport module が存在しない
  check('E-H7: sync/signal.ts（esy1）が存在しない',
    !statSyncSafe(join(SYNC_DIR, 'signal.ts')));

  // 1-b. active code に esy1 が 1 箇所も無い（docs は対象外 = 歴史記述は許す）
  const esy1: string[] = [];
  for (const file of activeCodeFiles()) {
    if (readFileSync(file, 'utf8').includes('esy1')) esy1.push(relative(REPO_ROOT, file));
  }
  check('E-H7: active code に esy1 が 0 箇所', esy1.length === 0, esy1.join(', '));

  // 1-c. claim header 名の定数宣言が 1 箇所だけ
  const headerDecls: string[] = [];
  const headerLiterals: string[] = [];
  for (const file of activeCodeFiles()) {
    const src = readFileSync(file, 'utf8');
    if (/EXAM_DEVICE_CLAIM_HEADER\s*=\s*'/.test(src)) headerDecls.push(relative(REPO_ROOT, file));
    if (src.includes("'x-exam-spine-device-claim'") &&
        !/EXAM_DEVICE_CLAIM_HEADER\s*=\s*'/.test(src)) {
      headerLiterals.push(relative(REPO_ROOT, file));
    }
  }
  eq('E-H7: claim header の宣言は 1 箇所だけ', headerDecls,
    [join('lib', 'examSpine', 'sync', 'claim', 'types.ts')]);
  check('E-H7: header 名を別 file で直書きしていない',
    headerLiterals.length === 0, headerLiterals.join(', '));

  // 1-d. wire version literal の宣言も 1 箇所だけ
  const versionDecls: string[] = [];
  for (const file of activeCodeFiles()) {
    if (/EXAM_DEVICE_CLAIM_VERSION\s*=\s*'/.test(readFileSync(file, 'utf8'))) {
      versionDecls.push(relative(REPO_ROOT, file));
    }
  }
  eq('E-H7: wire version の宣言は 1 箇所だけ', versionDecls,
    [join('lib', 'examSpine', 'sync', 'claim', 'types.ts')]);
  eq('E-H7: canonical wire version は edc1', EXAM_DEVICE_CLAIM_VERSION, 'edc1');

  // 1-e. verification 層が transport module を import しない（transport independence）
  //   ★ 判定は **実コード行**に対して行う（comment の説明文は対象外）★
  //     verdict.ts は E-H7 の経緯を doc に書くため 'edc1' の語を含むが、
  //     それは transport への依存ではない。§20 の「歴史記述と active code を区別する」。
  for (const name of ['verdict.ts', 'enable.ts'] as const) {
    const full = readFileSync(join(SYNC_DIR, name), 'utf8');
    const code = codeLines(join(SYNC_DIR, name)).join('\n');
    check(`E-H7: ${name} が transport module を import しない`,
      !/from\s+'\.\/claim\//.test(full) && !/from\s+'\.\/signal'/.test(full));
    check(`E-H7: ${name} の実コードに wire literal が無い`,
      !code.includes('edc1') && !code.includes('esy1') && !code.includes('x-exam-spine'),
      code.split('\n').filter((l) => /edc1|esy1|x-exam-spine/.test(l)).join(' | '));
  }

  // 1-f. production importer: claim/** は > 0、他の transport は 0
  const claimImporters: string[] = [];
  for (const file of activeCodeFiles()) {
    const rel = relative(REPO_ROOT, file);
    if (rel.startsWith(join('lib', 'examSpine'))) continue;
    if (/examSpine\/sync\/claim/.test(readFileSync(file, 'utf8'))) claimImporters.push(rel);
  }
  check(`E-H7: E-S33 transport の production importer > 0（実測 ${claimImporters.length}）`,
    claimImporters.length > 0, claimImporters.join(', '));

  // 1-g. header を読む / 書く場所が choke point に閉じている
  const headerTouchers: string[] = [];
  for (const file of activeCodeFiles()) {
    const rel = relative(REPO_ROOT, file);
    const src = readFileSync(file, 'utf8');
    if (src.includes('EXAM_DEVICE_CLAIM_HEADER')) headerTouchers.push(rel);
  }
  const ALLOWED_HEADER_TOUCHERS = new Set([
    join('lib', 'examSpine', 'sync', 'claim', 'types.ts'),
    join('lib', 'examSpine', 'sync', 'claim', 'parse.ts'),
    join('lib', 'examSpine', 'sync', 'claim', 'serialize.ts'),
    join('app', 'tutor', 'page.tsx'),
  ]);
  const unexpected = headerTouchers.filter((f) => !ALLOWED_HEADER_TOUCHERS.has(f));
  check('E-H7: header に触れる file が allowlist 内だけ',
    unexpected.length === 0, unexpected.join(', '));
}

function statSyncSafe(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

// ── 2. E-S33 transport → validated claim set → verdict ────────────

const ALL_ALLOWED: readonly ExamSourceKind[] = EXAM_SYNC_SUPPORTED_KINDS;
const USER = '00000000-0000-4000-8000-0000000000a1';

/** E-S33 の実 transport を往復させて validated claim set を得る（parse は 1 回だけ）。 */
function claimSetVia(
  entries: readonly { kind: ExamSourceKind; token: string }[],
  allowed: readonly ExamSourceKind[] = ALL_ALLOWED,
  userId: string | null = USER,
): ExamSyncClaimSet {
  const wire = serializeDeviceClaim(entries);
  const parsed = parseDeviceClaimValue(wire);
  return toDeviceClaims(parsed, { authenticatedUserId: userId, allowedSources: allowed });
}

function claimRoundTrip(): void {
  const entries = EXAM_SYNC_SUPPORTED_KINDS.map((kind) => ({ kind, token: FP[kind] as string }));
  const wire = serializeDeviceClaim(entries);
  check('T1 全 kind を 1 header に載せられる', typeof wire === 'string' && wire !== null);
  check(`T1 header が上限内（実測 ${wire?.length ?? -1} / 上限 ${EXAM_DEVICE_CLAIM_MAX_BYTES}）`,
    (wire?.length ?? Number.MAX_SAFE_INTEGER) <= EXAM_DEVICE_CLAIM_MAX_BYTES);
  check('T1 entry 数が上限内',
    EXAM_SYNC_SUPPORTED_KINDS.length <= EXAM_DEVICE_CLAIM_MAX_ENTRIES);

  const claims = claimSetVia(entries);
  const missing = EXAM_SYNC_SUPPORTED_KINDS.filter((k) => claimedFingerprint(claims, k) !== FP[k]);
  check('T1 8 kind すべてが claim set へ復元される', missing.length === 0, missing.join(', '));

  // Headers 経由でも同じ
  const h = new Headers({ [EXAM_DEVICE_CLAIM_HEADER]: wire ?? '' });
  const viaHeaders = toDeviceClaims(parseDeviceClaimHeader(h),
    { authenticatedUserId: USER, allowedSources: ALL_ALLOWED });
  eq('T1 Headers 経由でも同じ claim set',
    Object.keys(viaHeaders).sort(), Object.keys(claims).sort());

  // 空 claim set
  eq('T1 空 claim set は全 kind unclaimed',
    EXAM_SYNC_SUPPORTED_KINDS.filter((k) => claimedFingerprint(EMPTY_EXAM_SYNC_CLAIM_SET, k) !== null),
    []);

  // purpose gate は広がらない（E-S28）
  const narrow = claimSetVia(entries, sourcesForPurpose('tutor'));
  const outside = Object.keys(narrow).filter(
    (k) => !(sourcesForPurpose('tutor') as readonly string[]).includes(k));
  check('T1 purpose が許可しない kind は claim set に入らない',
    outside.length === 0, outside.join(', '));

  // 未認証では 1 件も採用しない（E-L3）
  eq('T1 未認証の申告は 0 件', Object.keys(claimSetVia(entries, ALL_ALLOWED, null)), []);
}

// ── 3. malformed transport から verified が生まれない ─────────────

function malformedClaimMatrix(): void {
  const tok = FP.basic_info;
  const V = EXAM_DEVICE_CLAIM_VERSION;
  const cases: Array<[string, string | null]> = [
    ['absent', null],
    ['空文字', ''],
    ['壊れた JSON', '{not json'],
    ['非 object', '"str"'],
    ['未知 version', JSON.stringify({ v: 'zzz', c: [{ kind: 'basic_info', token: tok }] })],
    ['esy1 形式（旧 transport）', `esy1:basic_info=${tok.slice('efp1:'.length)}`],
    ['base64 風', Buffer.from(JSON.stringify({ v: V, c: [] })).toString('base64')],
    ['c が配列でない', JSON.stringify({ v: V, c: 1 })],
    ['oversize', JSON.stringify({ v: V, c: [] }) + 'x'.repeat(EXAM_DEVICE_CLAIM_MAX_BYTES)],
    ['entry 数超過', JSON.stringify({
      v: V,
      c: Array.from({ length: EXAM_DEVICE_CLAIM_MAX_ENTRIES + 2 },
        () => ({ kind: 'basic_info', token: tok })),
    })],
    ['未知 kind', JSON.stringify({ v: V, c: [{ kind: 'zzz', token: tok }] })],
    ['__proto__ kind', JSON.stringify({ v: V, c: [{ kind: '__proto__', token: tok }] })],
    ['class 2（interview_ai）', JSON.stringify({ v: V, c: [{ kind: 'interview_ai', token: tok }] })],
    ['class 2（presentation）', JSON.stringify({ v: V, c: [{ kind: 'presentation', token: tok }] })],
    ['token が短い', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: tok.slice(0, -1) }] })],
    ['token が大文字', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: tok.toUpperCase() }] })],
    ['token が非 hex', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: 'efp1:' + 'z'.repeat(64) }] })],
    ['token が空', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: '' }] })],
    ['token に改行', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: `${tok}\n` }] })],
    ['token に NUL', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: `${tok}${NUL}` }] })],
  ];

  const threw: string[] = [];
  const leakedVerified: string[] = [];
  for (const [label, raw] of cases) {
    let claims: ExamSyncClaimSet;
    try {
      claims = toDeviceClaims(parseDeviceClaimValue(raw),
        { authenticatedUserId: USER, allowedSources: ALL_ALLOWED });
    } catch {
      threw.push(label);
      continue;
    }
    for (const kind of EXAM_SYNC_SUPPORTED_KINDS) {
      const v = examSyncVerdict({
        kind,
        status: 'ok',
        mirror: obs(kind, { seed: kind }),
        claim: claimedFingerprint(claims, kind),
      });
      if (v.verdict === 'verified') leakedVerified.push(`${label} / ${kind}`);
    }
  }
  check(`malformed ${cases.length} 種で throw しない`, threw.length === 0, threw.join(', '));
  check('★ どの malformed transport 入力からも verified が生まれない',
    leakedVerified.length === 0, leakedVerified.join(', '));

  // ★ parser 層で落ちていることを直接見る ★
  //   下流には二重防御がある（toDeviceClaims の purpose filter / claimedFingerprint の
  //   `isExamFingerprint`）。そのため「verified が出ない」だけを見ていると、
  //   **parser 側の退行を下流が隠してしまう**。E-S33 は transport parsing authority なので、
  //   ここで落ちていることを parse 結果に対して直接 assert する。
  const parserCases: Array<[string, string]> = [
    ['不正 token', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: 'x' }] })],
    ['token が短い', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: tok.slice(0, -1) }] })],
    ['token が大文字', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: tok.toUpperCase() }] })],
    ['token が非 hex', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: 'efp1:' + 'z'.repeat(64) }] })],
    ['token の prefix 違い', JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: 'efp9:' + 'a'.repeat(64) }] })],
    ['未知 kind', JSON.stringify({ v: V, c: [{ kind: 'zzz', token: tok }] })],
    ['__proto__ kind', JSON.stringify({ v: V, c: [{ kind: '__proto__', token: tok }] })],
    ['class 2（interview_ai）', JSON.stringify({ v: V, c: [{ kind: 'interview_ai', token: tok }] })],
    ['class 2（presentation）', JSON.stringify({ v: V, c: [{ kind: 'presentation', token: tok }] })],
  ];
  const parserLeaks: string[] = [];
  for (const [label, raw] of parserCases) {
    const keys = Object.keys(parseDeviceClaimValue(raw).claims);
    if (keys.length !== 0) parserLeaks.push(`${label}: ${keys.join(',')}`);
  }
  check(`★ parser 層で落ちている（${parserCases.length} 種 / 下流の二重防御に隠させない）`,
    parserLeaks.length === 0, parserLeaks.join(' | '));

  // ★ 拒否理由も pin する ★
  //   parser には kind の gate が 2 段ある（`isExamSourceKind` → `isExamSyncSupportedKind`）。
  //   claims の中身だけを見ていると、前段を外しても後段が拾うため退行が観測できない。
  //   理由 enum まで固定して、どちらの段が落としたのかを機械的に見分ける。
  const reasonCases: Array<[string, string, string]> = [
    ['ExamSourceKind ですらない kind',
      JSON.stringify({ v: V, c: [{ kind: 'zzz', token: tok }] }), 'unknown_kind'],
    ['__proto__',
      JSON.stringify({ v: V, c: [{ kind: '__proto__', token: tok }] }), 'unknown_kind'],
    ['class 2（既知だが非対象）',
      JSON.stringify({ v: V, c: [{ kind: 'interview_ai', token: tok }] }), 'not_syncable'],
    ['不正 token',
      JSON.stringify({ v: V, c: [{ kind: 'basic_info', token: 'x' }] }), 'invalid_token'],
  ];
  const wrongReason: string[] = [];
  for (const [label, raw, reason] of reasonCases) {
    const reasons = parseDeviceClaimValue(raw).rejected.map((r) => r.reason);
    if (!reasons.includes(reason as never)) {
      wrongReason.push(`${label}: ${reasons.join(',') || 'なし'}（期待 ${reason}）`);
    }
  }
  check('★ parser の拒否理由が段ごとに正しい（gate の前段を外すと落ちる）',
    wrongReason.length === 0, wrongReason.join(' | '));

  // positive control: 正しい claim は parser を通る（上の assertion が vacuous でないこと）
  eq('parser: 正しい claim は通る',
    Object.keys(parseDeviceClaimValue(
      serializeDeviceClaim([{ kind: 'basic_info', token: tok }]))
      .claims),
    ['basic_info']);

  // 旧 transport 形式は 1 件も通らない
  const esy1Claims = toDeviceClaims(
    parseDeviceClaimValue(`esy1:basic_info=${tok.slice('efp1:'.length)}`),
    { authenticatedUserId: USER, allowedSources: ALL_ALLOWED });
  eq('★ esy1 形式の header は 1 件も claim にならない', Object.keys(esy1Claims), []);

  // class 2 は claim set に入らない（E-S3）
  for (const k of ['interview_ai', 'presentation'] as const) {
    const c2 = toDeviceClaims(
      parseDeviceClaimValue(JSON.stringify({ v: V, c: [{ kind: k, token: tok }] })),
      { authenticatedUserId: USER, allowedSources: EXAM_SOURCE_KINDS });
    eq(`${k} の申告は claim set に入らない（E-S3）`, Object.keys(c2), []);
  }

  // prototype pollution
  const polluted = toDeviceClaims(
    parseDeviceClaimValue(JSON.stringify({ v: V, c: [{ kind: '__proto__', token: tok }] })),
    { authenticatedUserId: USER, allowedSources: ALL_ALLOWED });
  check('prototype pollution: Object.prototype が汚染されない',
    ({} as Record<string, unknown>).basic_info === undefined);
  check('prototype pollution: claim set に __proto__ の own property が無い',
    !Object.prototype.hasOwnProperty.call(polluted, '__proto__'));

  // 観測要約に token / 本文が出ない（E-S12 / E-S13）
  const summary = summarizeDeviceClaim(parseDeviceClaimValue(
    serializeDeviceClaim([{ kind: 'basic_info', token: tok }])));
  check('観測要約に token が出ない', !JSON.stringify(summary).includes('efp1:'));
}
// ── 4. verdict truth table ────────────────────────────────────────

function verdictTruthTable(): void {
  const statuses: readonly ExamSourceReadStatus[] = ['ok', 'truncated', 'error', 'skipped'];
  const mirrorA = obs('self_pr', { seed: 'self_pr' });
  const mirrorB = obs('self_pr', { seed: 'other' });
  const claims: Array<[string, ExamFingerprint | null]> = [
    ['claim 無し', null],
    ['claim 一致', mirrorA.fingerprint],
    ['claim 不一致', mirrorB.fingerprint],
  ];
  const mirrors: Array<[string, ExamSyncObservation | null]> = [
    ['mirror 空', null],
    ['mirror A', mirrorA],
    ['mirror B', mirrorB],
  ];

  const rows: string[] = [];
  const unexpected: string[] = [];
  const outside: string[] = [];
  let combos = 0;

  for (const status of statuses) {
    for (const [cl, claim] of claims) {
      for (const [ml, mirror] of mirrors) {
        combos += 1;
        const r = examSyncVerdict({ kind: 'self_pr', status, mirror, claim });

        let expected: ExamSyncExternalVerdict;
        if (status !== 'ok') expected = 'unreadable';
        else if (claim === null) expected = 'unclaimed';
        else if (mirror === null) expected = 'mismatch';
        else expected = mirror.fingerprint === claim ? 'verified' : 'mismatch';

        if (r.verdict !== expected) {
          rows.push(`${status}/${cl}/${ml}: ${r.verdict}（期待 ${expected}）`);
        }
        if (r.unexpectedInternalStatus) unexpected.push(`${status}/${cl}/${ml}`);
        if (!(EXAM_SYNC_EXTERNAL_VERDICTS as readonly string[]).includes(r.verdict)) {
          outside.push(r.verdict);
        }
      }
    }
  }
  check(`verdict truth table（${combos} 組）が E-S2 の優先順位どおり`,
    rows.length === 0, rows.join(' | '));
  check('★ incomparable が構造的に発生しない（unexpectedInternalStatus = false）',
    unexpected.length === 0, unexpected.join(', '));
  check('★ 外部 verdict が 4 値の外へ出ない', outside.length === 0, [...new Set(outside)].join(', '));

  eq('error + claim 無し → unreadable（unclaimed に落ちない）',
    examSyncVerdict({ kind: 'self_pr', status: 'error', mirror: null, claim: null }).verdict,
    'unreadable');
  eq('truncated + claim 一致 → unreadable（verified に落ちない / E-S8）',
    examSyncVerdict({ kind: 'self_pr', status: 'truncated', mirror: mirrorA, claim: mirrorA.fingerprint }).verdict,
    'unreadable');
  eq('skipped + claim 一致 → unreadable',
    examSyncVerdict({ kind: 'self_pr', status: 'skipped', mirror: mirrorA, claim: mirrorA.fingerprint }).verdict,
    'unreadable');
  eq('ok + claim 無し + mirror 有り → unclaimed（mismatch にしない）',
    examSyncVerdict({ kind: 'self_pr', status: 'ok', mirror: mirrorA, claim: null }).verdict,
    'unclaimed');
  eq('ok + claim 有り + mirror 空 → mismatch（EMPTY を verified にしない / E-H1）',
    examSyncVerdict({ kind: 'self_pr', status: 'ok', mirror: null, claim: mirrorA.fingerprint }).verdict,
    'mismatch');
  eq('ok + claim 一致 → verified',
    examSyncVerdict({ kind: 'self_pr', status: 'ok', mirror: mirrorA, claim: mirrorA.fingerprint }).verdict,
    'verified');

  // ★ 内部 5 値 → 外部 4 値の畳み込みを直接検査する ★
  //   `incomparable` は上の全探索では発生しないため、fold 自体を単体で当てないと
  //   「incomparable → verified」に書き換えられても気付けない（unreachable な分岐は
  //   truth table では守れない）。
  const folds: Array<[string, string, boolean]> = [
    ['unreadable', 'unreadable', false],
    ['unclaimed', 'unclaimed', false],
    ['mismatch', 'mismatch', false],
    ['verified', 'verified', false],
    ['incomparable', 'unreadable', true],
  ];
  for (const [internal, expected, unexpectedFlag] of folds) {
    const f = foldExamSyncInternalStatus(internal as never);
    eq(`fold: ${internal} → ${expected}`, f.verdict, expected as ExamSyncExternalVerdict);
    eq(`fold: ${internal} の unexpected flag`, f.unexpected, unexpectedFlag);
  }
  check('★ fold は incomparable を verified にしない',
    foldExamSyncInternalStatus('incomparable' as never).verdict !== 'verified');
  const foldOutside = folds
    .map(([i]) => foldExamSyncInternalStatus(i as never).verdict)
    .filter((v) => !(EXAM_SYNC_EXTERNAL_VERDICTS as readonly string[]).includes(v));
  check('fold の出力は必ず 4 値の中', foldOutside.length === 0, foldOutside.join(', '));

  eq('外部 verdict は 4 値', [...EXAM_SYNC_EXTERNAL_VERDICTS],
    ['unreadable', 'unclaimed', 'mismatch', 'verified']);
  eq('usable は verified のみ',
    EXAM_SYNC_EXTERNAL_VERDICTS.filter(isExamSyncUsableVerdict), ['verified']);
}

function verdictMap(): void {
  const mirrors = {} as Record<ExamSyncSupportedKind, { status: ExamSourceReadStatus; observation: ExamSyncObservation }>;
  for (const kind of EXAM_SYNC_SUPPORTED_KINDS) {
    mirrors[kind] = { status: 'ok', observation: obs(kind, { seed: kind }) };
  }
  const claims = claimSetVia(
    EXAM_SYNC_SUPPORTED_KINDS.map((kind) => ({ kind, token: FP[kind] as string })));
  const { verdicts, unexpectedInternalStatus } = examSyncVerdicts({ claims, mirrors });

  eq('verdict map が 8 kind をちょうど覆う',
    Object.keys(verdicts).sort(), [...EXAM_SYNC_SUPPORTED_KINDS].sort());
  const notVerified = EXAM_SYNC_SUPPORTED_KINDS.filter((k) => verdicts[k] !== 'verified');
  check('全 kind 一致 → 全 verified', notVerified.length === 0, notVerified.join(', '));
  check('unexpectedInternalStatus = false', !unexpectedInternalStatus);
  check('allExamSyncVerified', allExamSyncVerified(verdicts, [...EXAM_SYNC_SUPPORTED_KINDS]));
  eq('全 verified なら veto 理由なし',
    summarizeExamSyncVeto(verdicts, [...EXAM_SYNC_SUPPORTED_KINDS]), null);

  const partial = examSyncVerdicts({ claims, mirrors: { self_pr: mirrors.self_pr } });
  eq('mirror 未提供の kind は unreadable', partial.verdicts.activity, 'unreadable');
  eq('mirror 提供済みは verified', partial.verdicts.self_pr, 'verified');

  const mixed = { ...verdicts, activity: 'mismatch' as const, diagnosis: 'unclaimed' as const };
  eq('veto 理由: unclaimed > mismatch',
    summarizeExamSyncVeto(mixed, [...EXAM_SYNC_SUPPORTED_KINDS]), 'unclaimed');
  const withUnreadable = { ...mixed, essay: 'unreadable' as const };
  eq('veto 理由: unreadable が最優先',
    summarizeExamSyncVeto(withUnreadable, [...EXAM_SYNC_SUPPORTED_KINDS]), 'unreadable');
}

// ── 5. enable / fail-closed ───────────────────────────────────────

function enableContract(): void {
  const verified: ExamSyncExternalVerdict = 'verified';

  // ★ canary / verdict の段を試すには「runtime blocked でない kind」が要る ★
  //   veto は 4 段の連言で、2 段目（runtime_blocked）に落ちる kind を使うと
  //   3 段目（canary）も 4 段目（verdict）も **到達しないまま緑になる**。
  //   Stage 5.10 で self_pr が blocked になったため、この節の fixture kind を
  //   明示し、「fixture が blocked でないこと」自体を先に固定する。
  const HEALTHY = 'statement_review' as const;
  check('enable 節の fixture kind は runtime blocked でない（前提の自己検査）',
    !isExamSyncRuntimeBlocked(HEALTHY));

  const canaryValues: unknown[] = [undefined, null, false, 0, 1, '', 'true', 'TRUE', {}, [], Number.NaN];
  const leaked: string[] = [];
  for (const value of canaryValues) {
    const d = examSyncUsability({ kind: HEALTHY, verdict: verified, canaryAllowed: value });
    if (d.usability !== 'veto' || d.reason !== 'canary_denied') leaked.push(String(value));
  }
  check(`E-S11 default deny: canary が true 以外（${canaryValues.length} 種）はすべて veto`,
    leaked.length === 0, leaked.join(', '));
  eq('canary true + verified → usable',
    examSyncUsability({ kind: HEALTHY, verdict: verified, canaryAllowed: true }),
    { usability: 'usable', reason: null });

  for (const v of EXAM_SYNC_EXTERNAL_VERDICTS) {
    const d = examSyncUsability({ kind: HEALTHY, verdict: v, canaryAllowed: true });
    if (v === 'verified') check(`enable: ${v} → usable`, d.usability === 'usable');
    else check(`enable: ${v} → veto / not_verified`,
      d.usability === 'veto' && d.reason === 'not_verified');
  }

  for (const kind of ['interview_ai', 'presentation'] as const) {
    const d = examSyncUsability({ kind, verdict: verified, canaryAllowed: true });
    check(`enable: ${kind} は kind_not_syncable で veto（E-S3）`,
      d.usability === 'veto' && d.reason === 'kind_not_syncable');
  }

  // ★ essay は R5 closure 後も runtime block されている（Stage 5.8 / E-S52）★
  //
  //   S5-P2〜S5-P9 の間、この節は「R5 が closed だから essay は他 7 kind と同じ」
  //   と書いていた。これは **blocker は R5 しかない** という暗黙の前提であり、
  //   Stage 5.8 で別 blocker（server の updated_at DESC window を device が再現できない）
  //   が実測された時点で誤りになる。R5 は CLOSED のままだが essay は usable ではない。
  //
  //   したがって固定するのは「R5 が閉じたか」ではなく **veto 4 段のどこで落ちるか**。
  const essay = examSyncUsability({ kind: 'essay', verdict: verified, canaryAllowed: true });
  check('essay は runtime_blocked で veto（E-S52 read window）',
    essay.usability === 'veto' && essay.reason === 'runtime_blocked');
  check('essay は runtime block 宣言に載っている', isExamSyncRuntimeBlocked('essay'));
  //   ★ Stage 5.10: self_pr が Level C 監査で追加（E-S50）★
  const selfPr = examSyncUsability({ kind: 'self_pr', verdict: verified, canaryAllowed: true });
  check('self_pr は runtime_blocked で veto（E-S50 Level C）',
    selfPr.usability === 'veto' && selfPr.reason === 'runtime_blocked');
  check('self_pr は runtime block 宣言に載っている', isExamSyncRuntimeBlocked('self_pr'));
  //   ★ runtime_blocked は canary / verdict より **先に**落ちる（順序の固定）★
  eq('blocked kind は canary 許可 + verified でも runtime_blocked で落ちる',
    selfPr, { usability: 'veto', reason: 'runtime_blocked' });
  //   ★ 宣言順（EXAM_SOURCE_KINDS の順）で pin する。sort しない ★
  eq('runtime block は self_pr と essay のみ（機構は残す）',
    EXAM_SOURCE_KINDS.filter(isExamSyncRuntimeBlocked), ['self_pr', 'essay']);
  //   この 2 kind 以外は宣言に載らない（blocker が黙って広がらない）。
  check('essay / self_pr 以外の kind は runtime block されていない',
    EXAM_SOURCE_KINDS.filter((k) => k !== 'essay' && k !== 'self_pr')
      .every((k) => isExamSyncRuntimeBlocked(k) === false));
  //   ★ R5 の結論自体は覆っていない ★ 落ちる理由が read window であって
  //     jsonb sub-path（E-S27）ではないことを、宣言文で確認する。
  const essayReason = EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay ?? '';
  check('essay の禁止理由は read window であり R5 の再燃ではない',
    essayReason.includes('read window')
      && (essayReason.includes('CLOSED') || essayReason.includes('解消')));

  const verdicts = {} as Record<ExamSyncSupportedKind, ExamSyncExternalVerdict>;
  for (const k of EXAM_SYNC_SUPPORTED_KINDS) verdicts[k] = 'verified';
  const map = verdicts as ExamSyncVerdictMap;
  const usable = examSyncUsableKinds({ kinds: [...EXAM_SYNC_SUPPORTED_KINDS], verdicts: map, canaryAllowed: true });
  check('usable kinds に essay は含まれない（E-S52 runtime block）', !usable.includes('essay'));
  check('usable kinds に self_pr は含まれない（E-S50 Level C runtime block）',
    !usable.includes('self_pr'));
  //   ★ 実際に blocked な kind の集合から導出する（2 箇所に数字を書かない）★
  eq('usable kinds は blocked 2 kind を除く 6 kind',
    [...usable].sort(),
    [...EXAM_SYNC_SUPPORTED_KINDS].filter((k) => !isExamSyncRuntimeBlocked(k)).sort());
  eq('usable kinds は 6 件', usable.length, EXAM_SYNC_SUPPORTED_KINDS.length - 2);
  eq('canary false なら usable 0',
    examSyncUsableKinds({ kinds: [...EXAM_SYNC_SUPPORTED_KINDS], verdicts: map, canaryAllowed: false }).length, 0);
  eq('要求していない kind は足されない',
    examSyncUsableKinds({ kinds: [HEALTHY], verdicts: map, canaryAllowed: true }), [HEALTHY]);
  //   blocked kind だけを要求しても usable は空（要求が veto を上書きしない）。
  eq('blocked kind だけを要求しても usable は空',
    examSyncUsableKinds({ kinds: ['self_pr'], verdicts: map, canaryAllowed: true }), []);

  const summary = summarizeExamSyncEnable({
    kinds: [...EXAM_SYNC_SUPPORTED_KINDS], verdicts: map, canaryAllowed: true,
  });
  eq('summary: requested', summary.requested, EXAM_SYNC_SUPPORTED_KINDS.length);
  eq('summary: usable は blocked 2 kind を除く 6', summary.usable, EXAM_SYNC_SUPPORTED_KINDS.length - 2);
  eq('summary: blocked kind があるので reason は runtime_blocked',
    summary.reason, 'runtime_blocked');
  //   blocked kind を要求しなければ全 usable / reason null に戻る
  //   （veto が blocked kind 固有であって、他 kind へ波及していないこと）。
  const noBlocked = summarizeExamSyncEnable({
    kinds: EXAM_SYNC_SUPPORTED_KINDS.filter((k) => !isExamSyncRuntimeBlocked(k)),
    verdicts: map, canaryAllowed: true,
  });
  eq('summary: blocked kind を外せば全 usable', noBlocked.usable, EXAM_SYNC_SUPPORTED_KINDS.length - 2);
  eq('summary: blocked kind を外せば reason は null', noBlocked.reason, null);
  eq('summary の field が 3 つだけ', Object.keys(summary).sort(),
    ['reason', 'requested', 'usable']);
  check('summary が number / enum / null のみ',
    typeof summary.requested === 'number' && typeof summary.usable === 'number' &&
      (summary.reason === null || typeof summary.reason === 'string'));
}

// ── 6. PII / privacy ──────────────────────────────────────────────

function privacyContract(): void {
  const CANARY = 'CANARY_ESSAY_BODY_2f8c';
  const view = { body: CANARY, notes: [CANARY] };
  const observation = examSyncObservation({ kind: 'self_pr', source: 'server_mirror', view });
  const wire = serializeDeviceClaim([{ kind: 'self_pr', token: observation.fingerprint }]);
  check('claim header に本文が現れない', wire !== null && !wire.includes(CANARY));
  check('claim header は fingerprint token しか含まない',
    wire !== null && /"token":"efp1:[0-9a-f]{64}"/.test(wire) && !wire.includes(CANARY));

  const parsed = toDeviceClaims(parseDeviceClaimValue(wire),
    { authenticatedUserId: USER, allowedSources: ALL_ALLOWED });
  check('claim set に本文が現れない', !JSON.stringify(parsed).includes(CANARY));

  const r = examSyncVerdict({ kind: 'self_pr', status: 'ok', mirror: observation, claim: observation.fingerprint });
  check('verdict 結果に本文 / fingerprint が現れない',
    !JSON.stringify(r).includes(CANARY) && !JSON.stringify(r).includes(observation.fingerprint));
  eq('verdict 結果の field が 3 つだけ', Object.keys(r).sort(),
    ['internalStatus', 'unexpectedInternalStatus', 'verdict']);
}

// ── 7. 静的境界 ───────────────────────────────────────────────────

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

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
    const idx = raw.indexOf('//');
    out.push(idx >= 0 ? raw.slice(0, idx) : raw);
  }
  return out;
}

function staticBoundaries(): void {
  const files = CONTRACT_FILES.map((f) => join(SYNC_DIR, f));
  const FORBIDDEN = [
    'Request', 'Response', 'Headers', 'headers', 'cookies', 'NextRequest', 'NextResponse',
    'localStorage', 'sessionStorage', 'window.', 'document.', 'globalThis',
    'fetch(', '@supabase', 'process.', 'require(', 'node:', 'next/', 'server-only',
    'Date.now', 'Date.parse', 'new Date', 'Math.random', 'crypto.', 'console.',
    '@anthropic-ai', 'openai', 'OpenAI', 'Anthropic', '@google/genai',
  ];
  const hits: string[] = [];
  for (const file of files) {
    for (const line of codeLines(file)) {
      for (const t of FORBIDDEN) if (line.includes(t)) hits.push(`${relative(REPO_ROOT, file)}: ${t}`);
    }
  }
  check('contract layer に transport / I/O / clock / random / vendor / logging が 0',
    hits.length === 0, hits.join(' | '));

  const importHits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)) {
      const spec = m[1];
      if (!/^\.{1,2}\//.test(spec)) importHits.push(`${relative(REPO_ROOT, file)}: ${spec}`);
    }
  }
  check('contract layer の import は Spine 内部の相対のみ',
    importHits.length === 0, importHits.join(' | '));

  const banned = /adopt|winner|prefer|choose|selectSource|merge|repair|reconcile|newerWins/i;
  const nameOffenders: string[] = [];
  const surfaces: Array<[string, Record<string, unknown>]> = [
    ['verdict.ts', VerdictMod as unknown as Record<string, unknown>],
    ['enable.ts', EnableMod as unknown as Record<string, unknown>],
  ];
  for (const [name, mod] of surfaces) {
    for (const key of Object.keys(mod)) if (banned.test(key)) nameOffenders.push(`${name}: ${key}`);
  }
  check('採用 / 修復 / 統合を示す export が 0', nameOffenders.length === 0, nameOffenders.join(', '));

  const bodyOffenders: string[] = [];
  for (const file of files) {
    const src = codeLines(file).join('\n');
    for (const w of ['adopt', 'winner', 'newerWins', 'selectSource', 'reconcile', 'autoHeal']) {
      if (src.includes(w)) bodyOffenders.push(`${relative(REPO_ROOT, file)}: ${w}`);
    }
  }
  check('contract layer の実装に採用語彙が無い', bodyOffenders.length === 0, bodyOffenders.join(' | '));

  const verdictSrc = readFileSync(join(SYNC_DIR, 'verdict.ts'), 'utf8');
  const unionMatch = /export type ExamSyncExternalVerdict =([^;]+);/.exec(verdictSrc);
  check('ExamSyncExternalVerdict の union が読める', unionMatch !== null);
  if (unionMatch) {
    check('★ external verdict union に incomparable が無い',
      !unionMatch[1].includes('incomparable'), unionMatch[1].trim());
    for (const w of ['unknown', 'invalid', 'empty', 'error', 'skipped']) {
      check(`external verdict union に "${w}" が無い`, !unionMatch[1].includes(`'${w}'`));
    }
  }

  const consumers: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of listFiles(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(join('lib', 'examSpine'))) continue;
      if (/examSpine\/sync/.test(readFileSync(file, 'utf8'))) consumers.push(rel);
    }
  }
  // ★ Stage 5.0（E-S33 / E-S34）で pilot 1 purpose の transport が接続済み ★
  //   「production から 0 本」は Wave 4 時点の実態であり、現在の contract ではない。
  //   ただし条件を緩めるのではなく、**接続してよい範囲**を allowlist で固定し、
  //   接続が transport 止まりであること（consumer authority を切り替えないこと）を
  //   behavioral に検査する側へ retarget する。
  const PILOT_CONSUMERS = ['app/tutor/page.tsx', 'app/api/tutor/route.ts'];
  const unexpectedConsumers = consumers.filter((f) => !PILOT_CONSUMERS.includes(f));
  check('sync を import する production file は Stage 5.0 pilot だけ',
    unexpectedConsumers.length === 0, unexpectedConsumers.join(', '));

  // ★ transport 止まりであることの behavioral 検査（条件緩和ではない）★
  const routeSrc = readFileSync(join(REPO_ROOT, 'app/api/tutor/route.ts'), 'utf8');

  //   1. shadow 組み立ての結果が shadow ブロックの外へ出ないこと。
  //
  //      ★ retarget の理由（条件緩和ではない）★
  //        Stage 5.0 では shadow の戻り値が本当に未使用だったため
  //        「変数へ束縛していない」を proxy として検査していた。
  //        Packet J（shadow comparison）は **比較のために戻り値を束縛する必要がある**。
  //        束縛したかどうかは本来の不変条件ではなく、本来の不変条件は
  //        「shadow 由来の値が consumer 経路へ出ないこと」である。
  //        そこで proxy を捨て、**脱出面**を直接検査する形へ retarget した。
  //        より強い近接検査（prompt 近傍に comparison / shadowResolvedInput が
  //        現れないこと等）は scripts/exam-spine-stage5-1-check.ts が担当する。
  //
  //      脱出してよいのは観測用の enum と件数だけ（E-S12 / E-S13）。
  //      ★ コメント行を除いた実コードだけを見る（見出しコメントに builder 名が出るため）。
  const routeCode = routeSrc
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  //      ★ S5-P3 で **位置ではなく脱出面**へ再 retarget ★
  //        直前の版は「shadow block と prompt 組み立ての前後関係」で region を割り、
  //        その region に leak identifier が無いことを見ていた。
  //        Packet 3 で canonical assembly は prompt より**前**へ移り（slot 切替が
  //        prompt 前に canonical を必要とするため）、comparison は prompt より**後**に残った。
  //        両者が prompt を挟むため、どちら向きの region 分割でも誤検知する。
  //
  //        位置は不変条件ではない。不変条件は「shadow 由来の値が prompt / response へ
  //        入らないこと」なので、**呼び出しの実引数そのもの**を検査する形へ変える。
  //        これは region 検査より強い（間に何行あっても、引数に無ければ渡っていない）。
  const lastImport = routeCode.lastIndexOf('\nimport ');
  const bodyStart = lastImport >= 0
    ? routeCode.indexOf('\n', routeCode.indexOf(';', lastImport)) + 1
    : 0;
  const body = routeCode.slice(bodyStart);

  /** `name(` の実引数テキストを括弧の対応で切り出す。 */
  const callArgs = (source: string, name: string): string | null => {
    const at = source.indexOf(`${name}(`);
    if (at < 0) return null;
    let depth = 0;
    for (let i = at + name.length; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) return source.slice(at + name.length + 1, i);
      }
    }
    return null;
  };

  const SHADOW_LEAKS = ['shadowResolvedInput', 'compareTutorShadow', 'comparison', '.context.blocks'];
  const PROMPT_CALLS = ['composeTutorPrompt', 'buildTutorUserPrompt'];
  let promptCallsFound = 0;
  for (const name of PROMPT_CALLS) {
    const argText = callArgs(body, name);
    if (argText === null) continue;
    promptCallsFound += 1;
    for (const leaked of SHADOW_LEAKS) {
      check(`${name}() の実引数に ${leaked} が現れない`, !argText.includes(leaked),
        `args=${argText.slice(0, 200)}`);
    }
  }
  check('prompt 組み立ての呼び出しが route に存在する', promptCallsFound > 0);

  //      canonical assembly は default-deny gate の内側だけで走る。
  //      （Packet 3 で gate は shadow 単独から「shadow OR slot 切替」の連言集合になった。
  //        どちらも allowlist 方式の default deny なので、無指定 user では 1 本も読まない。）
  const buildIdx = body.indexOf('buildCanonicalExamContext(');
  check('canonical assembly が route に存在する', buildIdx >= 0);
  if (buildIdx >= 0) {
    const before = body.slice(0, buildIdx);
    const gates = ['isExamSpineShadowEnabled', 'isExamSpineSlotSwitchEnabled'];
    const present = gates.filter((g) => before.includes(g));
    check('canonical assembly は canary gate の内側にある', present.length > 0,
      `検出 gate=${present.join(',')}`);
    // gate 変数が同じ if 条件に現れること（gate を読むだけで使っていない事故を防ぐ）。
    const guard = /if\s*\(([^)]*(?:Enabled|enabled)[^)]*)\)\s*\{[\s\S]{0,2000}?buildCanonicalExamContext\(/.exec(body);
    check('canonical assembly は gate 変数を条件に使っている', guard !== null,
      guard ? guard[1] : '(条件が見つからない)');
  }

  //      観測へ出る値は enum（string）と件数（number）に限る。
  check('shadow の観測値は enum（string）として宣言されている',
    /\bshadowOverall\s*:\s*string \| undefined/.test(routeCode));
  check('shadow の観測値は件数（number）として宣言されている',
    /\bshadowMismatchCount\s*:\s*number \| undefined/.test(routeCode));

  //   2. shadow **比較** は shadow canary の内側だけで動く。
  //      ★ S5-P3 で literal `if (shadowEnabled)` 依存をやめた ★
  //        canonical assembly の guard は slot 切替との連言（`slotSwitchEnabled || shadowEnabled`）
  //        になったため、条件式の字面を pin すると正当な変更で落ちる。
  //        assembly 側の gate は上で検査済みなので、ここは
  //        「compareTutorShadow を含む block の guard に shadowEnabled があること」だけを見る
  //        = shadow 比較が shadow canary 単独で守られていること。
  check('shadow gate が route に存在する', /isExamSpineShadowEnabled\(/.test(routeSrc));
  const cmpGuard =
    /if\s*\(([^)]*shadowEnabled[^)]*)\)\s*\{[\s\S]{0,3000}?compareTutorShadow\(/.exec(routeCode);
  check('shadow 比較は shadow canary の内側にある', cmpGuard !== null,
    cmpGuard ? cmpGuard[1] : '(compareTutorShadow を守る shadowEnabled 条件が無い)');

  //   3. Spine 由来の値が prompt / response の組み立てに現れない。
  const promptLines = routeSrc
    .split('\n')
    .filter((l) => /systemBlocks|userPrompt|messages:|NextResponse\.json/.test(l))
    .filter((l) => /[Ss]pine|canonical|deviceClaim|shadow/.test(l));
  check('prompt / response 経路に Spine 由来の値が現れない',
    promptLines.length === 0, promptLines.join(' | '));
}

// ── run ───────────────────────────────────────────────────────────

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
  console.log('[exam-spine-sync-signal] Stage 5 Packet 1 claim / verdict / enable contract check（transport = E-S33 edc1）');
  console.log(`[exam-spine-sync-signal] transport=${EXAM_DEVICE_CLAIM_VERSION}（E-S33）fingerprint=${EXAM_FINGERPRINT_VERSION} maxBytes=${EXAM_DEVICE_CLAIM_MAX_BYTES} maxEntries=${EXAM_DEVICE_CLAIM_MAX_ENTRIES}`);

  staticBoundaries();

  const nondet = withNondeterminismTrap(() => {
    transportAuthority();
    claimRoundTrip();
    malformedClaimMatrix();
    verdictTruthTable();
    verdictMap();
    enableContract();
    privacyContract();
  });

  check(`clock 呼び出し = 0（実測 ${nondet.dateCalls}）`, nondet.dateCalls === 0);
  check(`random 呼び出し = 0（実測 ${nondet.randomCalls}）`, nondet.randomCalls === 0);
  check('EMPTY_EXAM_SYNC_CLAIM_SET は claim を持たない',
    Object.keys(EMPTY_EXAM_SYNC_CLAIM_SET).length === 0);

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-sync-signal] FAIL: 外部通信が ${fetchCallCount} 回発生しました`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-sync-signal] network calls = ${fetchCallCount}（実 Supabase / AI 呼び出しゼロ）`);
  console.log(`[exam-spine-sync-signal] clock calls   = ${nondet.dateCalls}`);
  console.log(`[exam-spine-sync-signal] random calls  = ${nondet.randomCalls}`);
  console.log(`[exam-spine-sync-signal] AI SDK loaded = ${aiSdkLoaded() ? 'YES' : 'NO'}`);
  if (aiSdkLoaded()) {
    console.error('[exam-spine-sync-signal] FAIL: AI SDK が module graph に載っています');
    process.exitCode = 1;
    return;
  }

  console.log(`[exam-spine-sync-signal] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`\n[exam-spine-sync-signal] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 25)) console.error(`  - ${f}`);
    if (failures.length > 25) console.error(`  … 他 ${failures.length - 25} 件`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-sync-signal] PASS');
}

main();
