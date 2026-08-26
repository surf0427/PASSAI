// Exam Spine — Stage 4 Wave 4 / signal・verdict・enable contract check。
//
// 証明したいこと:
//
//   untrusted device claim
//        ↓ strict bounded parser（default deny / never-throw）
//   canonical claim
//        ↓ trusted server observation
//   E-S2 の **4 値** verdict（unreadable > unclaimed > mismatch > verified）
//        ↓ default-deny usability decision（E-S11 / runtime block）
//   usable / veto
//
//   を PII 0 / authority decision 0 / runtime wiring 0 / 第 5 の外部 verdict 0 で成立させる。
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
import type { ExamSourceReadStatus } from '@/lib/examSpine/sourceData/types';
import { EXAM_FINGERPRINT_VERSION, isExamFingerprint } from '@/lib/examSpine/sync/fingerprint';
import type { ExamFingerprint } from '@/lib/examSpine/sync/fingerprint';
import { EXAM_SYNC_SUPPORTED_KINDS } from '@/lib/examSpine/sync/adapters/registry';
import type { ExamSyncSupportedKind } from '@/lib/examSpine/sync/adapters/registry';
import { examSyncObservation } from '@/lib/examSpine/sync/adapters/views';
import type { ExamSyncObservation } from '@/lib/examSpine/sync/adapters/types';

import * as SignalMod from '@/lib/examSpine/sync/signal';
import * as VerdictMod from '@/lib/examSpine/sync/verdict';
import * as EnableMod from '@/lib/examSpine/sync/enable';

import {
  EMPTY_EXAM_SYNC_SIGNAL,
  EXAM_SYNC_SIGNAL_FINGERPRINT_VERSION,
  EXAM_SYNC_SIGNAL_MAX_CLAIMS,
  EXAM_SYNC_SIGNAL_MAX_LENGTH,
  EXAM_SYNC_SIGNAL_VERSION,
  claimedFingerprint,
  isExamSyncSignalSchemaConsistent,
  parseExamSyncSignal,
  serializeExamSyncSignal,
} from '@/lib/examSpine/sync/signal';
import {
  EXAM_SYNC_EXTERNAL_VERDICTS,
  allExamSyncVerified,
  foldExamSyncInternalStatus,
  examSyncVerdict,
  examSyncVerdicts,
  isExamSyncUsableVerdict,
  summarizeExamSyncVeto,
} from '@/lib/examSpine/sync/verdict';
import type { ExamSyncExternalVerdict, ExamSyncVerdictMap } from '@/lib/examSpine/sync/verdict';
import {
  examSyncUsability,
  examSyncUsableKinds,
  isExamSyncRuntimeBlocked,
  summarizeExamSyncEnable,
} from '@/lib/examSpine/sync/enable';

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
const CONTRACT_FILES = ['signal.ts', 'verdict.ts', 'enable.ts'];
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

const FP_OTHER = obs('self_pr', { seed: 'other' }).fingerprint;
const HEX_OF = (fp: ExamFingerprint): string => fp.slice(`${EXAM_FINGERPRINT_VERSION}:`.length);

// ── 1. schema / bounds ────────────────────────────────────────────

function schemaContract(): void {
  check('signal version が fingerprint version に束縛されている',
    isExamSyncSignalSchemaConsistent() &&
      EXAM_SYNC_SIGNAL_FINGERPRINT_VERSION === EXAM_FINGERPRINT_VERSION);
  eq('signal version', EXAM_SYNC_SIGNAL_VERSION, 'esy1');
  eq('claim 数上限 = Source-Sync 対象 kind 数', EXAM_SYNC_SIGNAL_MAX_CLAIMS,
    EXAM_SYNC_SUPPORTED_KINDS.length);

  // 上限が worst case から導出されていること（恣意的な値でないことの検査）
  const longestKind = EXAM_SYNC_SUPPORTED_KINDS.reduce((a, b) => (a.length >= b.length ? a : b));
  const worst =
    `${EXAM_SYNC_SIGNAL_VERSION}:`.length +
    EXAM_SYNC_SUPPORTED_KINDS.length * (longestKind.length + 1 + 64) +
    (EXAM_SYNC_SUPPORTED_KINDS.length - 1);
  check(`最大長 ${EXAM_SYNC_SIGNAL_MAX_LENGTH} が worst case ${worst} を上回る`,
    EXAM_SYNC_SIGNAL_MAX_LENGTH > worst);
  check('最大長が非現実的に大きくない（parser abuse の上限として機能する）',
    EXAM_SYNC_SIGNAL_MAX_LENGTH <= worst * 4);

  const full = serializeExamSyncSignal(FP);
  check(`全 kind signal が上限内（実測 ${full.length} bytes）`,
    full.length <= EXAM_SYNC_SIGNAL_MAX_LENGTH, `${full.length}`);
  check('全 kind signal が worst case を超えない', full.length <= worst);
}

// ── 2. round-trip（8/8）─────────────────────────────────────────

function roundTrip(): void {
  for (const kind of EXAM_SYNC_SUPPORTED_KINDS) {
    const wire = serializeExamSyncSignal({ [kind]: FP[kind] });
    const parsed = parseExamSyncSignal(wire);
    eq(`round-trip ${kind}: version`, parsed.version, EXAM_SYNC_SIGNAL_VERSION);
    eq(`round-trip ${kind}: claim が復元される`, claimedFingerprint(parsed, kind), FP[kind]);
    eq(`round-trip ${kind}: rejection 0`, parsed.rejections.length, 0);
  }

  const all = serializeExamSyncSignal(FP);
  const parsedAll = parseExamSyncSignal(all);
  eq('round-trip 全 kind: claim 数', Object.keys(parsedAll.claims).length,
    EXAM_SYNC_SUPPORTED_KINDS.length);
  const mismatched = EXAM_SYNC_SUPPORTED_KINDS.filter(
    (k) => claimedFingerprint(parsedAll, k) !== FP[k],
  );
  check('round-trip 全 kind: 全 claim が一致', mismatched.length === 0, mismatched.join(', '));
  eq('round-trip 全 kind: 再 serialize で同一 byte', serializeExamSyncSignal(parsedAll.claims), all);

  // ★ byte 決定性: 入力の key 順が違っても同じ wire
  const forward: Record<string, ExamFingerprint> = {};
  const backward: Record<string, ExamFingerprint> = {};
  for (const k of EXAM_SYNC_SUPPORTED_KINDS) forward[k] = FP[k];
  for (const k of [...EXAM_SYNC_SUPPORTED_KINDS].reverse()) backward[k] = FP[k];
  eq('serialize は入力 key 順に依存しない（byte 決定性）',
    serializeExamSyncSignal(forward as never), serializeExamSyncSignal(backward as never));
  check('serialize は宣言順に並ぶ',
    all.startsWith(`${EXAM_SYNC_SIGNAL_VERSION}:${EXAM_SYNC_SUPPORTED_KINDS[0]}=`));

  eq('不正 fingerprint は serialize しない',
    serializeExamSyncSignal({ self_pr: 'deadbeef' as ExamFingerprint }), '');
  eq('別 schema の fingerprint は serialize しない',
    serializeExamSyncSignal({ self_pr: `efp9:${HEX_OF(FP.self_pr)}` as ExamFingerprint }), '');
  eq('null / undefined claim は serialize しない',
    serializeExamSyncSignal({ self_pr: null, activity: undefined }), '');
  eq('claim 0 件は空文字', serializeExamSyncSignal({}), '');
  eq('空文字は parse で empty 扱い', parseExamSyncSignal('').rejections[0]?.reason, 'empty');

  check('wire は version / kind / 64hex / 区切りのみで構成される',
    /^esy1:(?:[a-z_]+=[0-9a-f]{64})(?:,[a-z_]+=[0-9a-f]{64})*$/.test(all), all.slice(0, 40));
  check('fingerprint 形式が Wave 1 の判定を通る',
    EXAM_SYNC_SUPPORTED_KINDS.every((k) => isExamFingerprint(claimedFingerprint(parsedAll, k))));
}

// ── 3. malformed input matrix ─────────────────────────────────────

function malformedMatrix(): void {
  const hex = HEX_OF(FP.self_pr);
  const V = EXAM_SYNC_SIGNAL_VERSION;
  const cases: Array<[string, unknown, string | null]> = [
    ['null', null, 'not_a_string'],
    ['undefined', undefined, 'not_a_string'],
    ['number', 12345, 'not_a_string'],
    ['object', { self_pr: hex }, 'not_a_string'],
    ['array', [`self_pr=${hex}`], 'not_a_string'],
    ['空文字', '', 'empty'],
    ['空白のみ', '   \t  ', 'empty'],
    ['version 区切り無し', `self_pr=${hex}`, 'missing_version'],
    ['先頭が区切り', `:self_pr=${hex}`, 'missing_version'],
    ['未知 version', `v999:self_pr=${hex}`, 'unknown_version'],
    ['旧 version', `esy0:self_pr=${hex}`, 'unknown_version'],
    ['fingerprint version を version に使う', `efp1:self_pr=${hex}`, 'unknown_version'],
    ['version のみ', `${V}:`, 'empty'],
    ['oversize', `${V}:${'a'.repeat(EXAM_SYNC_SIGNAL_MAX_LENGTH)}`, 'oversize'],
    ['claim 数超過', `${V}:${Array.from({ length: EXAM_SYNC_SIGNAL_MAX_CLAIMS + 1 }, () => `self_pr=${hex}`).join(',')}`, 'too_many_claims'],
    ['未知 kind', `${V}:unknown_kind=${hex}`, null],
    ['__proto__', `${V}:__proto__=${hex}`, null],
    ['constructor', `${V}:constructor=${hex}`, null],
    ['prototype', `${V}:prototype=${hex}`, null],
    ['class 2 kind（interview_ai）', `${V}:interview_ai=${hex}`, null],
    ['class 2 kind（presentation）', `${V}:presentation=${hex}`, null],
    ['Unicode confusable kind', `${V}:sеlf_pr=${hex}`, null],
    ['fingerprint 短い', `${V}:self_pr=${hex.slice(0, 63)}`, null],
    ['fingerprint 長い', `${V}:self_pr=${hex}a`, null],
    ['fingerprint 大文字', `${V}:self_pr=${hex.toUpperCase()}`, null],
    ['fingerprint 非 hex', `${V}:self_pr=${'z'.repeat(64)}`, null],
    ['fingerprint 空', `${V}:self_pr=`, 'malformed_entry'],
    ['fingerprint に prefix 込み', `${V}:self_pr=${FP.self_pr}`, null],
    ['= が無い', `${V}:self_pr`, 'malformed_entry'],
    ['= で始まる', `${V}:=${hex}`, 'malformed_entry'],
    ['空 entry', `${V}:,`, 'malformed_entry'],
    ['末尾が切れている', `${V}:self_pr=${hex},activi`, 'malformed_entry'],
    ['重複 kind（同値）', `${V}:self_pr=${hex},self_pr=${hex}`, null],
    ['重複 kind（別値）', `${V}:self_pr=${hex},self_pr=${HEX_OF(FP_OTHER)}`, null],
    ['埋め込み改行', `${V}:self_pr\n=${hex}`, null],
    ['NUL', `${V}:self_pr${NUL}=${hex}`, null],
    ['値に空白', `${V}:self_pr= ${hex}`, null],
    ['kind に空白', `${V}: self_pr=${hex}`, null],
    ['区切りが ;', `${V}:self_pr=${hex};activity=${HEX_OF(FP.activity)}`, null],
  ];

  const threw: string[] = [];
  const leakedVerified: string[] = [];
  const wrongReason: string[] = [];

  for (const [label, input, expectedWhole] of cases) {
    let parsed;
    try {
      parsed = parseExamSyncSignal(input);
    } catch {
      threw.push(label);
      continue;
    }
    if (expectedWhole !== null) {
      if (parsed.version !== '') wrongReason.push(`${label}: version が空でない`);
      if (parsed.rejections[0]?.reason !== expectedWhole) {
        wrongReason.push(`${label}: reason=${parsed.rejections[0]?.reason ?? 'なし'}（期待 ${expectedWhole}）`);
      }
      if (Object.keys(parsed.claims).length !== 0) wrongReason.push(`${label}: claim が残った`);
    }
    // ★ どの壊れた入力からも verified は生まれない
    for (const kind of EXAM_SYNC_SUPPORTED_KINDS) {
      const v = examSyncVerdict({
        kind,
        status: 'ok',
        mirror: obs(kind, { seed: kind }),
        claim: claimedFingerprint(parsed, kind),
      });
      if (v.verdict === 'verified') leakedVerified.push(`${label} / ${kind}`);
    }
  }

  check(`malformed ${cases.length} 種で throw しない`, threw.length === 0, threw.join(', '));
  check('malformed の全体拒否理由が正しい', wrongReason.length === 0, wrongReason.join(' | '));
  check('★ どの malformed 入力からも verified が生まれない',
    leakedVerified.length === 0, leakedVerified.join(', '));

  // ★ truncated signal の「生き残った前半」を採用しない
  const truncated = parseExamSyncSignal(`${V}:self_pr=${hex},activi`);
  eq('truncated signal は前半の claim も捨てる', claimedFingerprint(truncated, 'self_pr'), null);
  eq('truncated signal は version を立てない', truncated.version, '');

  const dup = parseExamSyncSignal(`${V}:self_pr=${hex},self_pr=${HEX_OF(FP_OTHER)}`);
  eq('重複 kind は claim を残さない（first/last-wins しない）',
    claimedFingerprint(dup, 'self_pr'), null);
  check('重複 kind が rejection として記録される',
    dup.rejections.some((r) => r.reason === 'duplicate_kind' && r.kind === 'self_pr'));

  const mixed = parseExamSyncSignal(
    `${V}:self_pr=${hex},unknown_kind=${hex},activity=${HEX_OF(FP.activity)}`,
  );
  eq('部分拒否: 正しい claim は残る', claimedFingerprint(mixed, 'activity'), FP.activity);
  check('部分拒否: 未知 kind は rejection に enum だけで記録される',
    mixed.rejections.some((r) => r.reason === 'unknown_kind' && r.kind === undefined));
  for (const k of ['interview_ai', 'presentation'] as const) {
    const c2 = parseExamSyncSignal(`${V}:${k}=${hex}`);
    check(`部分拒否: ${k} は not_syncable_kind として記録される（E-S3）`,
      c2.rejections.some((r) => r.reason === 'not_syncable_kind' && r.kind === k));
    eq(`部分拒否: ${k} の claim は 1 件も残らない`, Object.keys(c2.claims).length, 0);
  }

  const polluted = parseExamSyncSignal(`${V}:__proto__=${hex}`);
  check('prototype pollution: Object.prototype が汚染されない',
    ({} as Record<string, unknown>).self_pr === undefined &&
      (Object.prototype as unknown as Record<string, unknown>).self_pr === undefined);
  check('prototype pollution: claims に __proto__ の own property が無い',
    !Object.prototype.hasOwnProperty.call(polluted.claims, '__proto__'));

  const canaryKind = 'CANARY_UNKNOWN_KIND_7d3e';
  const leaky = parseExamSyncSignal(`${V}:${canaryKind}=${hex}`);
  check('rejection に未知 kind 名が載らない',
    !JSON.stringify(leaky).includes(canaryKind), JSON.stringify(leaky).slice(0, 120));
  check('rejection に fingerprint hex が載らない', !JSON.stringify(leaky).includes(hex));
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
  const signal = parseExamSyncSignal(serializeExamSyncSignal(FP));
  const { verdicts, unexpectedInternalStatus } = examSyncVerdicts({ signal, mirrors });

  eq('verdict map が 8 kind をちょうど覆う',
    Object.keys(verdicts).sort(), [...EXAM_SYNC_SUPPORTED_KINDS].sort());
  const notVerified = EXAM_SYNC_SUPPORTED_KINDS.filter((k) => verdicts[k] !== 'verified');
  check('全 kind 一致 → 全 verified', notVerified.length === 0, notVerified.join(', '));
  check('unexpectedInternalStatus = false', !unexpectedInternalStatus);
  check('allExamSyncVerified', allExamSyncVerified(verdicts, [...EXAM_SYNC_SUPPORTED_KINDS]));
  eq('全 verified なら veto 理由なし',
    summarizeExamSyncVeto(verdicts, [...EXAM_SYNC_SUPPORTED_KINDS]), null);

  const partial = examSyncVerdicts({ signal, mirrors: { self_pr: mirrors.self_pr } });
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

  const canaryValues: unknown[] = [undefined, null, false, 0, 1, '', 'true', 'TRUE', {}, [], Number.NaN];
  const leaked: string[] = [];
  for (const value of canaryValues) {
    const d = examSyncUsability({ kind: 'self_pr', verdict: verified, canaryAllowed: value });
    if (d.usability !== 'veto' || d.reason !== 'canary_denied') leaked.push(String(value));
  }
  check(`E-S11 default deny: canary が true 以外（${canaryValues.length} 種）はすべて veto`,
    leaked.length === 0, leaked.join(', '));
  eq('canary true + verified → usable',
    examSyncUsability({ kind: 'self_pr', verdict: verified, canaryAllowed: true }),
    { usability: 'usable', reason: null });

  for (const v of EXAM_SYNC_EXTERNAL_VERDICTS) {
    const d = examSyncUsability({ kind: 'self_pr', verdict: v, canaryAllowed: true });
    if (v === 'verified') check(`enable: ${v} → usable`, d.usability === 'usable');
    else check(`enable: ${v} → veto / not_verified`,
      d.usability === 'veto' && d.reason === 'not_verified');
  }

  for (const kind of ['interview_ai', 'presentation'] as const) {
    const d = examSyncUsability({ kind, verdict: verified, canaryAllowed: true });
    check(`enable: ${kind} は kind_not_syncable で veto（E-S3）`,
      d.usability === 'veto' && d.reason === 'kind_not_syncable');
  }

  const essay = examSyncUsability({ kind: 'essay', verdict: verified, canaryAllowed: true });
  check('★ essay は verified + canary true でも veto（runtime_blocked / R5）',
    essay.usability === 'veto' && essay.reason === 'runtime_blocked');
  check('essay が runtime block 宣言に載っている', isExamSyncRuntimeBlocked('essay'));
  eq('runtime block は essay のみ',
    EXAM_SOURCE_KINDS.filter(isExamSyncRuntimeBlocked), ['essay']);

  const verdicts = {} as Record<ExamSyncSupportedKind, ExamSyncExternalVerdict>;
  for (const k of EXAM_SYNC_SUPPORTED_KINDS) verdicts[k] = 'verified';
  const map = verdicts as ExamSyncVerdictMap;
  const usable = examSyncUsableKinds({ kinds: [...EXAM_SYNC_SUPPORTED_KINDS], verdicts: map, canaryAllowed: true });
  check('usable kinds に essay が含まれない', !usable.includes('essay'));
  eq('usable kinds は essay 以外の 7 kind',
    [...usable].sort(), EXAM_SYNC_SUPPORTED_KINDS.filter((k) => k !== 'essay').sort());
  eq('canary false なら usable 0',
    examSyncUsableKinds({ kinds: [...EXAM_SYNC_SUPPORTED_KINDS], verdicts: map, canaryAllowed: false }).length, 0);
  eq('要求していない kind は足されない',
    examSyncUsableKinds({ kinds: ['self_pr'], verdicts: map, canaryAllowed: true }), ['self_pr']);

  const summary = summarizeExamSyncEnable({
    kinds: [...EXAM_SYNC_SUPPORTED_KINDS], verdicts: map, canaryAllowed: true,
  });
  eq('summary: requested', summary.requested, EXAM_SYNC_SUPPORTED_KINDS.length);
  eq('summary: usable', summary.usable, EXAM_SYNC_SUPPORTED_KINDS.length - 1);
  eq('summary: reason は runtime_blocked', summary.reason, 'runtime_blocked');
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
  const wire = serializeExamSyncSignal({ self_pr: observation.fingerprint });
  check('signal に本文が現れない', !wire.includes(CANARY));
  check('signal は hex しか含まない', /^esy1:self_pr=[0-9a-f]{64}$/.test(wire));

  const parsed = parseExamSyncSignal(wire);
  check('parse 結果に本文が現れない', !JSON.stringify(parsed).includes(CANARY));

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
    ['signal.ts', SignalMod as unknown as Record<string, unknown>],
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

  //   1. shadow 組み立ての戻り値を **受け取らない**（= AI へ渡らない）。
  //      `const x = await buildCanonicalExamContext` の形になっていたら FAIL。
  check('shadow build の結果を変数へ束縛していない（結果は破棄）',
    /(?:^|\n)\s*await buildCanonicalExamContext\(/.test(routeSrc) &&
      !/=\s*await buildCanonicalExamContext\(/.test(routeSrc));

  //   2. shadow は default deny gate の内側だけで動く。
  check('shadow 組み立ては canary gate の内側にある',
    /isExamSpineShadowEnabled\(/.test(routeSrc) && /if \(shadowEnabled\)/.test(routeSrc));

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
  console.log('[exam-spine-sync-signal] Stage 4 Wave 4 signal / verdict / enable contract check');
  console.log(`[exam-spine-sync-signal] signal=${EXAM_SYNC_SIGNAL_VERSION} fingerprint=${EXAM_FINGERPRINT_VERSION} maxLen=${EXAM_SYNC_SIGNAL_MAX_LENGTH} maxClaims=${EXAM_SYNC_SIGNAL_MAX_CLAIMS}`);

  staticBoundaries();

  const nondet = withNondeterminismTrap(() => {
    schemaContract();
    roundTrip();
    malformedMatrix();
    verdictTruthTable();
    verdictMap();
    enableContract();
    privacyContract();
  });

  check(`clock 呼び出し = 0（実測 ${nondet.dateCalls}）`, nondet.dateCalls === 0);
  check(`random 呼び出し = 0（実測 ${nondet.randomCalls}）`, nondet.randomCalls === 0);
  check('EMPTY_EXAM_SYNC_SIGNAL は claim を持たない',
    Object.keys(EMPTY_EXAM_SYNC_SIGNAL.claims).length === 0);

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
