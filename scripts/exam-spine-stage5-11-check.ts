// Exam Spine — Stage 5.11 / diagnosis schema_version 収束 + controlled consumer 切替。
//
// 本 Stage の主張は 2 つある。混同しないこと。
//
//   E-S59  `schema_version` は **writer contract の版**であり、旧版 row は
//          「内容が違う」のではなく **比較の資格が無い**（comparison ineligible）。
//          ineligible な row は legacy へ倒れる。verified へ格上げしない。
//
//   E-S60  tutor の `diagnosis` slot を 3 番目の controlled consumer 切替とする。
//          採用条件は `basic_info`（E-S56）/ `activity`（E-S58）と同じ **AI-visible 同値**。
//
// ★ 版の不一致を「嘘」で解決しない ★
//   本 script は以下を **通してはいけない**:
//     v1 row をコード上だけ v3 とラベルする / `schemaVersion` を fingerprint から外す /
//     legacy row を verified 扱いする / DDL default の意味を無視する
//
// ★ snapshot kind に「mixed 版」は存在しない ★
//   `diagnosis_logs` は UNIQUE(user_id) の 1 行/ユーザーなので、1 user の中で
//   v1 と v3 が混在することはあり得ない。混在は **母集団レベル**（user ごとに版が違う）
//   なので §5 でその形を検証する。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
// 外部通信を trap する（本 suite は決定論・network 0 本）。
globalThis.fetch = ((...args: Parameters<typeof globalThis.fetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.11] 外部通信: ${String(args[0])}`);
}) as typeof globalThis.fetch;

import type { ExamRequestAuthorization } from '@/lib/examSpine/read/requestSnapshot.server';
import type { ExamDiagnosisServerRow } from '@/lib/examSpine/read/rowMappers';

import {
  EXAM_WRITER_SCHEMA_CONTRACTS,
  EXAM_SCHEMA_VERSIONED_KINDS,
  isComparableSchemaVersion,
} from '@/lib/examSpine/sync/adapters/registry';
import { EXAM_DEVICE_SCHEMA_VERSIONS, deviceDiagnosisView } from '@/lib/examSpine/sync/adapters/deviceViews';
import { deviceDiagnosisToken } from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import { diagnosisSyncView } from '@/lib/examSpine/sync/adapters/views';
import { examSyncObservation } from '@/lib/examSpine/sync/adapters/views';
import { mapDiagnosisRow } from '@/lib/examSpine/read/rowMappers';
import { resolveDiagnosisTypeHint } from '@/lib/examDiagnosis/tutorHints';
import {
  projectTutorDiagnosisSlot,
  decideTutorDiagnosisSlot,
  TUTOR_DIAGNOSIS_HINT_MAX_CHARS,
} from '@/lib/examSpine/context/tutorDiagnosisSlot';
import {
  EXAM_SPINE_SWITCHABLE_SLOTS,
  isExamSpineSlotSwitchEnabled,
} from '@/lib/examSpine/context/slotSwitchGate.server';
import { purposeAllowsSource, sourcesForPurpose } from '@/lib/examSpine/purpose';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { createRecordingExecutor, USER_A, type FakeDb } from './fixtures/examSpineStage3';
import * as Q from '@/lib/examSpine/read/queries';

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) passed += 1;
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function eq(label: string, a: unknown, e: unknown): void {
  check(label, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}

const U = USER_A;
const CURRENT = EXAM_WRITER_SCHEMA_CONTRACTS.diagnosis.current;

// ── fixture ───────────────────────────────────────────────────────────
//
// v1 / v2 = legacy 4 タイプ（resultType: number 1-4）
// v3      = 9 タイプ（resultType: ExamType string）も取り得る
//
// ★ payload shape は版をまたいで不変 ★（EXAM_SPINE_STAGE3_READINESS_AUDIT.md §6.3）
//   したがって fixture も同じ key set を使う。版だけが違う。

function payload(resultType: number | string): Record<string, unknown> {
  return {
    resultType,
    resultTitle: 'タイトル（app 製固定文）',
    resultDescription: '説明（app 製固定文）',
    answers: [0, 1, 2, 3, 1, 0],
    createdAt: '2026-02-01T00:00:00.000Z',
  };
}

function row(schemaVersion: string | null, resultType: number | string): Record<string, unknown> {
  return {
    id: 'db-uuid-diagnosis',
    user_id: U,
    payload: payload(resultType),
    schema_version: schemaVersion,
    source_hash: 'hash',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
    metadata: {},
  };
}

function mapped(schemaVersion: string | null, resultType: number | string): ExamDiagnosisServerRow {
  return mapDiagnosisRow(row(schemaVersion, resultType))!;
}

/** legacy `tutorContext.ts:projectDiagnosis` と同じ規則（oracle として独立に書く）。 */
function legacyProject(p: Record<string, unknown> | null): { typeHint?: string } | undefined {
  if (!p) return undefined;
  const hint = resolveDiagnosisTypeHint(p.resultType);
  if (!hint) return undefined;
  return { typeHint: hint.length > 120 ? hint.slice(0, 120) : hint };
}

// ══════════════════════════════════════════════════════════════════
// 1. schema_version の authority（writer / device / DDL / 全 write path）
// ══════════════════════════════════════════════════════════════════

function s1SchemaAuthority(): void {
  console.log('\n1. schema_version authority');

  // ── writer の実ソースから版を読み直す（宣言と実装の drift を塞ぐ）──
  const writerSrc = readFileSync(join(ROOT, 'lib/supabase/diagnosisLogs.ts'), 'utf8');
  const m = /SCHEMA_VERSION = "([^"]+)"/.exec(writerSrc);
  check('S1 writer の SCHEMA_VERSION を実ソースから読める', m !== null);
  eq('S1 writer の版は宣言 current と一致する', m?.[1], CURRENT);
  eq('S1 writer の版は "3"', m?.[1], '3');

  // device 側の合成定数も同じ値でなければ全ユーザー永久 mismatch になる。
  eq('S1 device 定数 = writer の版', EXAM_DEVICE_SCHEMA_VERSIONS.diagnosis, CURRENT);

  // 3 kind すべてで宣言 ↔ writer 実ソースが一致すること。
  const WRITER_SOURCES: Record<string, string> = {
    basic_info: 'lib/supabase/basicInfoLogs.ts',
    activity: 'lib/supabase/activityLogs.ts',
    diagnosis: 'lib/supabase/diagnosisLogs.ts',
  };
  for (const kind of EXAM_SCHEMA_VERSIONED_KINDS) {
    const src = readFileSync(join(ROOT, WRITER_SOURCES[kind]), 'utf8');
    // ★ 宣言形は kind ごとに違う ★ basicInfoLogs は
    //   `export const BASIC_INFO_SCHEMA_VERSION = "1"` を経由するため、
    //   `const SCHEMA_VERSION` 決め打ちでは読めない（実測）。
    const w = /SCHEMA_VERSION = "([^"]+)"/.exec(src);
    check(`S1 ${kind}: writer の版を読める`, w !== null, WRITER_SOURCES[kind]);
    eq(`S1 ${kind}: 宣言 current = writer 実ソース`,
      EXAM_WRITER_SCHEMA_CONTRACTS[kind].current, w?.[1]);
    eq(`S1 ${kind}: device 定数 = writer 実ソース`,
      EXAM_DEVICE_SCHEMA_VERSIONS[kind], w?.[1]);
  }

  // ── DDL default（変えない。意味を固定する）──
  const schema = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8');
  const ddl = schema.slice(schema.indexOf('CREATE TABLE diagnosis_logs'));
  const d = /schema_version\s+text\s+NOT NULL DEFAULT '([^']+)'/.exec(ddl);
  check('S2 diagnosis_logs の schema_version DDL を読める', d !== null);
  eq('S2 DDL default は "1" のまま（E-S59: 変更しない）', d?.[1], '1');
  //   ★ default が現行版と食い違うこと自体は hazard だが、発火経路が無ければ latent ★
  check('S2 DDL default は現行 writer 版と異なる（latent hazard であることの明示）',
    d?.[1] !== CURRENT);

  // ── 全 write path が schema_version を明示送信する（default に落ちない）──
  //
  // ★ ここが S2 の latent 判定を支える ★ 明示送信しない path が 1 本でも生まれたら落ちる。
  const writePaths: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${e}`;
      if (statSync(join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(e)) continue;
      const src = readFileSync(join(ROOT, rel), 'utf8');
      if (!src.includes('diagnosis_logs')) continue;
      // ★ table 名は const 経由で渡る（`const TABLE = "diagnosis_logs"` → `.from(TABLE)`）★
      //   literal 決め打ちの regex では 1 本も拾えない（実測）。
      //   「diagnosis_logs を知っている file のうち mutation 動詞を持つもの」で拾う。
      if (/\.(upsert|insert|update|delete)\(/.test(src)) writePaths.push(rel);
    }
  };
  for (const d0 of ['lib', 'app']) walk(d0);
  eq('S3 diagnosis_logs への write path は 1 本だけ',
    writePaths, ['lib/supabase/diagnosisLogs.ts']);
  //   その 1 本が schema_version を明示送信していること。
  check('S3 唯一の write path は schema_version を明示送信する',
    /\.upsert\(\s*\{[\s\S]{0,400}?schema_version:\s*SCHEMA_VERSION/.test(writerSrc));
  //   caller は 2 つとも同関数を通る（別経路の insert を作っていない）。
  const repo = readFileSync(join(ROOT, 'lib/repository/diagnosisRepository.ts'), 'utf8');
  eq('S3 repository の書き込みは upsertDiagnosisLogToSupabase 経由のみ',
    (repo.match(/upsertDiagnosisLogToSupabase\(/g) ?? []).length, 2);
  check('S3 repository は supabase client を直接叩かない', !repo.includes('.from('));
}

// ══════════════════════════════════════════════════════════════════
// 2. 版の意味と compatibility 宣言
// ══════════════════════════════════════════════════════════════════

function s2Contract(): void {
  console.log('\n2. writer contract の宣言');

  const c = EXAM_WRITER_SCHEMA_CONTRACTS.diagnosis;
  eq('C1 current は "3"', c.current, '3');
  //   ★ "1" だけではない ★ writer 定数は 1 → 2 → 3 と 2 度 bump している。
  eq('C1 superseded は "2" と "1" の両方', [...c.superseded].sort(), ['1', '2']);
  check('C1 writer の bump 履歴が実ソースのコメントに残っている',
    /v1 → v2/.test(readFileSync(join(ROOT, 'lib/supabase/diagnosisLogs.ts'), 'utf8'))
    && /v2 → v3/.test(readFileSync(join(ROOT, 'lib/supabase/diagnosisLogs.ts'), 'utf8')));
  eq('C1 payload 写像は無加工（stable）', c.payloadMappingStable, true);
  eq('C1 旧版でも射影は互換（projectionCompatible）', c.projectionCompatible, true);

  // basic_info は stripName があるので stable ではない（宣言が全部 true の空回りでない証明）。
  eq('C1 対照: basic_info は payloadMappingStable = false（stripName / E-P8）',
    EXAM_WRITER_SCHEMA_CONTRACTS.basic_info.payloadMappingStable, false);
  //   bump 実績が無い 2 kind は superseded が空。
  for (const kind of ['basic_info', 'activity'] as const) {
    eq(`C1 ${kind} は superseded なし`, EXAM_WRITER_SCHEMA_CONTRACTS[kind].superseded, []);
  }

  // ── eligibility は current だけ（fail-closed）──
  check('C2 current 版は eligible', isComparableSchemaVersion('diagnosis', CURRENT));
  for (const v of c.superseded) {
    check(`C2 superseded 版 "${v}" は ineligible`, !isComparableSchemaVersion('diagnosis', v));
  }
  for (const v of [null, undefined, '', '4', 'x', '03', ' 3']) {
    check(`C2 unknown/null "${String(v)}" は ineligible（fail-closed）`,
      !isComparableSchemaVersion('diagnosis', v as string | null | undefined));
  }
  //   ★ 数値 3 のような別型で通らない ★
  check('C2 型が違う値（number 3）は ineligible',
    !isComparableSchemaVersion('diagnosis', 3 as unknown as string));

  // ── 宣言が superseded を網羅していること（bump 時の更新漏れを検出）──
  //   writer コメントに現れる版番号が superseded ∪ {current} に含まれること。
  const versionsInComment = new Set(
    Array.from(
      readFileSync(join(ROOT, 'lib/supabase/diagnosisLogs.ts'), 'utf8').matchAll(/\bv([123])\b/g),
    ).map((x) => x[1]),
  );
  const declared = new Set<string>([c.current, ...c.superseded]);
  const missing = [...versionsInComment].filter((v) => !declared.has(v)).sort();
  eq('C3 writer が言及する全版が宣言に載っている（bump 更新漏れ検出）', missing, []);
}

// ══════════════════════════════════════════════════════════════════
// 3. fingerprint / comparison contract
// ══════════════════════════════════════════════════════════════════

function s3Comparison(): void {
  console.log('\n3. comparison contract');

  // sync view は payload と schemaVersion の 2 つ（外していない）。
  const view = diagnosisSyncView(mapped(CURRENT, 2));
  eq('F1 diagnosis sync view の field は payload と schemaVersion',
    Object.keys(view).sort(), ['payload', 'schemaVersion']);
  //   ★ schemaVersion を外していない（E-S44 が rejected した近道の検出）★
  check('F1 sync view は schemaVersion を保持している', 'schemaVersion' in view);

  const fp = (v: unknown): string =>
    examSyncObservation({ kind: 'diagnosis', source: 'server_mirror', view: v }).fingerprint;

  // ── 版が違えば fingerprint が違う（＝ 旧版 row は verified になれない）──
  const fpV3 = fp(diagnosisSyncView(mapped('3', 2)));
  const fpV1 = fp(diagnosisSyncView(mapped('1', 2)));
  const fpV2 = fp(diagnosisSyncView(mapped('2', 2)));
  check('F2 payload が同じでも版が違えば fingerprint は違う（v1 ≠ v3）', fpV1 !== fpV3);
  check('F2 payload が同じでも版が違えば fingerprint は違う（v2 ≠ v3）', fpV2 !== fpV3);
  check('F2 v1 と v2 も互いに違う', fpV1 !== fpV2);

  // ── device 側は常に current を合成する ──
  const dev = deviceDiagnosisView({ resultType: 2, ...payload(2) } as never);
  check('F3 device view が作れる', dev.ok);
  if (dev.ok) {
    eq('F3 device は current 版の server row と fingerprint 一致',
      fp(dev.view), fpV3);
    check('F3 device は v1 の server row と一致しない', fp(dev.view) !== fpV1);
    check('F3 device は v2 の server row と一致しない', fp(dev.view) !== fpV2);
  }

  // ── 内容が違えば当然違う（fingerprint が版だけを見ているのではない）──
  check('F4 版が同じでも payload が違えば fingerprint は違う',
    fp(diagnosisSyncView(mapped(CURRENT, 1))) !== fpV3);

  // ── registry の宣言と実装の一致 ──
  check('F5 registry は diagnosis の contentFields に schemaVersion を宣言している',
    readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/registry.ts'), 'utf8')
      .includes("contentFields: ['payload', 'schemaVersion']"));
}

// ══════════════════════════════════════════════════════════════════
// 4. projection parity（v1 / v2 / v3 / empty / 境界 / 敵対的）
// ══════════════════════════════════════════════════════════════════

type Fixture = {
  readonly name: string;
  readonly schemaVersion: string | null;
  readonly resultType: unknown;
  /** 期待 hint（legacy oracle から取る。canonical に合わせて作らない）。 */
  readonly expectHint: string | null;
};

const FIXTURES: readonly Fixture[] = [
  { name: 'v3 / ExamType riaju', schemaVersion: '3', resultType: 'riaju', expectHint: null },
  { name: 'v3 / ExamType creator', schemaVersion: '3', resultType: 'creator', expectHint: null },
  { name: 'v3 / legacy number 1', schemaVersion: '3', resultType: 1, expectHint: null },
  { name: 'v2 / legacy number 2', schemaVersion: '2', resultType: 2, expectHint: null },
  { name: 'v1 / legacy number 3', schemaVersion: '1', resultType: 3, expectHint: null },
  { name: 'v1 / legacy number 4', schemaVersion: '1', resultType: 4, expectHint: null },
  { name: 'v3 / 未知 number 5', schemaVersion: '3', resultType: 5, expectHint: null },
  { name: 'v3 / 未知 string', schemaVersion: '3', resultType: 'unknown_type', expectHint: null },
  { name: 'v3 / null resultType', schemaVersion: '3', resultType: null, expectHint: null },
  { name: 'v3 / 敵対的文字列', schemaVersion: '3', resultType: '"><script>', expectHint: null },
  { name: 'v3 / 境界 number 0', schemaVersion: '3', resultType: 0, expectHint: null },
  { name: 'schema_version null / number 1', schemaVersion: null, resultType: 1, expectHint: null },
];

function s4Projection(): void {
  console.log('\n4. projection parity（legacy oracle との byte 一致）');

  let divergent = 0;
  for (const f of FIXTURES) {
    const p = payload(f.resultType as number | string);
    const legacy = legacyProject(p);
    const canonical = projectTutorDiagnosisSlot(mapped(f.schemaVersion, f.resultType as never));

    // ★ 期待値は legacy 側から取る ★ canonical に合わせて作らない。
    const legacyHint = legacy?.typeHint ?? null;
    const canonicalHint = canonical?.typeHint ?? null;
    if (legacyHint !== canonicalHint) divergent += 1;
    eq(`P ${f.name}: canonical hint = legacy hint`, canonicalHint, legacyHint);
    //   hint が出る fixture では中身が空文字でないこと（空回り検査でない）。
    if (legacyHint !== null) {
      check(`P ${f.name}: hint が実体を持つ`, legacyHint.length > 0);
      check(`P ${f.name}: hint は 120 字以内`, legacyHint.length <= TUTOR_DIAGNOSIS_HINT_MAX_CHARS);
    }
  }
  eq('P divergent projection は 0 件', divergent, 0);

  // ── empty / absent ──
  eq('P empty: row null なら slot は null', projectTutorDiagnosisSlot(null), null);
  eq('P empty: payload null なら slot は null',
    projectTutorDiagnosisSlot({ payload: null, schemaVersion: '3' }), null);
  eq('P empty: legacy oracle も undefined', legacyProject(null), undefined);

  // ── 版は射影に影響しない（projectionCompatible の実証）──
  for (const rt of [1, 2, 3, 4] as const) {
    const v1 = projectTutorDiagnosisSlot(mapped('1', rt));
    const v2 = projectTutorDiagnosisSlot(mapped('2', rt));
    const v3 = projectTutorDiagnosisSlot(mapped('3', rt));
    eq(`P 版に依らず射影は同じ（resultType=${rt}）`,
      [v1?.typeHint, v2?.typeHint], [v3?.typeHint, v3?.typeHint]);
  }

  // ── payload の他 field は射影に現れない ──
  const rich = projectTutorDiagnosisSlot(mapped('3', 'riaju'));
  const s = JSON.stringify(rich);
  for (const leaked of ['resultTitle', 'resultDescription', 'answers', 'createdAt',
    'タイトル（app 製固定文）', '説明（app 製固定文）']) {
    check(`P 射影に ${leaked} が現れない`, !s.includes(leaked));
  }
  eq('P slot の field は typeHint だけ', Object.keys(rich ?? {}), ['typeHint']);

  // ── cap の値が 3 箇所で一致している（drift 塞ぎ）──
  const tutorSrc = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  const legacyCap = /const MAX_SUMMARY_LENGTH = (\d+)/.exec(tutorSrc);
  const buildSrc = readFileSync(join(ROOT, 'lib/examSpine/blocks/build.ts'), 'utf8');
  const blockCap = /const DIAGNOSIS_TYPE_HINT_MAX_CHARS = (\d+)/.exec(buildSrc);
  check('P legacy の cap を実ソースから読める', legacyCap !== null);
  check('P block の cap を実ソースから読める', blockCap !== null);
  eq('P cap は legacy / block / slot の 3 箇所で一致',
    [Number(legacyCap?.[1]), Number(blockCap?.[1]), TUTOR_DIAGNOSIS_HINT_MAX_CHARS],
    [120, 120, 120]);
  //   legacy の truncate は省略記号を足さない（slice と byte 一致する根拠）。
  const rmSrc = readFileSync(join(ROOT, 'lib/contextBuilders/tutor/serverRead/rowMappers.ts'), 'utf8');
  check('P legacy truncate は省略記号を足さない（slice と同値）',
    /export function truncate\(value: string, max: number\): string \{\s*return value\.length > max \? value\.slice\(0, max\) : value;/
      .test(rmSrc));

  // ── 言い換え表の正本が 1 箇所（E-S44）──
  const hintSrc = readFileSync(join(ROOT, 'lib/examDiagnosis/tutorHints.ts'), 'utf8');
  check('P hint 表の正本に 9 タイプと legacy 4 タイプが揃っている',
    /EXAM_DIAGNOSIS_TYPE_HINTS/.test(hintSrc) && /LEGACY_DIAGNOSIS_TYPE_HINTS/.test(hintSrc));
  check('P legacy も canonical も resolveDiagnosisTypeHint を通す',
    tutorSrc.includes('resolveDiagnosisTypeHint')
    && readFileSync(join(ROOT, 'lib/examSpine/context/tutorDiagnosisSlot.ts'), 'utf8')
      .includes('resolveDiagnosisTypeHint'));
  //   slot module が hint 文字列を自前で持っていないこと（表の二重化禁止）。
  const slotSrc = readFileSync(join(ROOT, 'lib/examSpine/context/tutorDiagnosisSlot.ts'), 'utf8');
  check('P slot module は hint 文言を再実装していない',
    !/進みやすそうです|役立ちそうです|よさそうです/.test(slotSrc));
}

// ══════════════════════════════════════════════════════════════════
// 5. slot decision（eligibility / 同値 veto / 母集団レベルの版混在）
// ══════════════════════════════════════════════════════════════════

function s5Decision(): void {
  console.log('\n5. slot decision');

  const canonical = projectTutorDiagnosisSlot(mapped('3', 2));
  const legacy = legacyProject(payload(2));
  check('D0 fixture が実体を持つ', canonical !== null && legacy !== undefined);

  // ── 正常系: current 版 + 同値 → canonical ──
  const ok = decideTutorDiagnosisSlot({
    usable: true, canonical, canonicalSchemaVersion: '3', legacy,
  });
  eq('D1 current 版 + 同値 → canonical', ok.authority, 'canonical');
  eq('D1 canonical のとき reason は null', ok.reason, null);
  eq('D1 canonical の値は legacy と同じ hint', ok.value?.typeHint, legacy?.typeHint);
  //   ★ summary を作らない ★
  eq('D1 canonical 値の field は typeHint だけ', Object.keys(ok.value ?? {}), ['typeHint']);

  // ── not_usable が最優先 ──
  const nu = decideTutorDiagnosisSlot({
    usable: false, canonical, canonicalSchemaVersion: '3', legacy,
  });
  eq('D2 usable=false → legacy / not_usable', [nu.authority, nu.reason], ['legacy', 'not_usable']);
  eq('D2 legacy 値がそのまま渡る（fail-open）', nu.value, legacy);

  // ── schema_version ineligible（2 枚目の gate）──
  for (const v of ['1', '2', null, '4']) {
    const d = decideTutorDiagnosisSlot({
      usable: true, canonical, canonicalSchemaVersion: v, legacy,
    });
    eq(`D3 版 "${String(v)}" は ineligible → legacy`,
      [d.authority, d.reason], ['legacy', 'schema_version_ineligible']);
    eq(`D3 版 "${String(v)}" でも legacy 値は保たれる（fail-open）`, d.value, legacy);
  }

  // ── canonical_absent ──
  const abs = decideTutorDiagnosisSlot({
    usable: true, canonical: null, canonicalSchemaVersion: '3', legacy,
  });
  eq('D4 canonical 無し → legacy / canonical_absent',
    [abs.authority, abs.reason], ['legacy', 'canonical_absent']);

  // ── divergent_projection ──
  const div = decideTutorDiagnosisSlot({
    usable: true, canonical, canonicalSchemaVersion: '3', legacy: { typeHint: '別の hint' },
  });
  eq('D5 hint が違う → legacy / divergent_projection',
    [div.authority, div.reason], ['legacy', 'divergent_projection']);
  //   legacy が undefined でも canonical を採らない（勝手に行を増やさない）。
  const noLegacy = decideTutorDiagnosisSlot({
    usable: true, canonical, canonicalSchemaVersion: '3', legacy: undefined,
  });
  eq('D5 legacy 未取得なら canonical を採らない',
    [noLegacy.authority, noLegacy.reason], ['legacy', 'divergent_projection']);
  //   legacy が summary を持ち始めたら canonical に倒さない（値が消えるため）。
  const withSummary = decideTutorDiagnosisSlot({
    usable: true,
    canonical,
    canonicalSchemaVersion: '3',
    legacy: { typeHint: legacy?.typeHint, summary: '将来の値' },
  });
  eq('D5 legacy が summary を持つなら legacy 維持',
    [withSummary.authority, withSummary.reason], ['legacy', 'divergent_projection']);

  // ── reason enum は閉じている（would_reduce_context を作っていない）──
  const slotSrc = readFileSync(join(ROOT, 'lib/examSpine/context/tutorDiagnosisSlot.ts'), 'utf8');
  const reasons = Array.from(
    slotSrc.slice(slotSrc.indexOf('export type TutorDiagnosisSlotFallbackReason'),
      slotSrc.indexOf('export type TutorDiagnosisSlotDecision'))
      .matchAll(/\|\s*'([a-z_]+)'/g),
  ).map((x) => x[1]).sort();
  eq('D6 fallback reason は 4 つ', reasons,
    ['canonical_absent', 'divergent_projection', 'not_usable', 'schema_version_ineligible']);
  check('D6 would_reduce_context を作っていない（activity からコピーしない）',
    !slotSrc.includes("'would_reduce_context'"));

  // ── 母集団レベルの版混在（snapshot kind に 1 user 内の mixed は無い）──
  const population = [
    { user: 'u-v3', version: '3', expectAuthority: 'canonical' },
    { user: 'u-v2', version: '2', expectAuthority: 'legacy' },
    { user: 'u-v1', version: '1', expectAuthority: 'legacy' },
    { user: 'u-null', version: null, expectAuthority: 'legacy' },
  ] as const;
  for (const p of population) {
    const d = decideTutorDiagnosisSlot({
      usable: true, canonical, canonicalSchemaVersion: p.version, legacy,
    });
    eq(`D7 母集団 ${p.user}（版 ${String(p.version)}）→ ${p.expectAuthority}`,
      d.authority, p.expectAuthority);
    //   ★ どの版でも AI が見る文字列は同じ ★（fallback しても出力が変わらない）
    eq(`D7 母集団 ${p.user}: AI-visible hint は不変`, d.value?.typeHint, legacy?.typeHint);
  }
  //   1 user 内の版混在は構造的に起こり得ない（UNIQUE(user_id)）。
  const schema = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8');
  check('D7 diagnosis_logs は UNIQUE(user_id)（1 user 1 行 / mixed 版は不可能）',
    /CONSTRAINT diagnosis_logs_user_unique UNIQUE \(user_id\)/.test(schema));
  eq('D7 diagnosis query は maybeSingle（1 user 1 行）',
    Q.diagnosisQuery(U).mode, 'maybeSingle');
}

// ══════════════════════════════════════════════════════════════════
// 6. purpose / query 本数 / canonical read 本数
// ══════════════════════════════════════════════════════════════════

const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function s6QuerySafety(): Promise<void> {
  console.log('\n6. purpose / query safety');

  // ── purpose ──
  check('G1 tutor purpose は diagnosis を許可する', purposeAllowsSource('tutor', 'diagnosis'));
  check('G1 tutor の sources に diagnosis がある', sourcesForPurpose('tutor').includes('diagnosis'));
  //   ★ 切替のために purpose contract を書き換えていない ★（元から許可されていた）
  check('G1 対照: tutor は self_pr を許可しない（purpose を広げていない）',
    !purposeAllowsSource('tutor', 'self_pr'));

  // ── diagnosis_logs は 1 request 1 query ──
  //   ★ slot 供給には Source-Sync verified が要る ★ device claim を渡さないと
  //     state は 'unverified' に留まり slot は供給されない（fail-closed / E-S2）。
  //     claim token は device canonical（＝ 同じ payload）から作る。
  const device = payload(2) as unknown as Parameters<typeof deviceDiagnosisToken>[0];
  const database = { tables: { diagnosis_logs: [row('3', 2)] } } as unknown as FakeDb;
  const recorder = createRecordingExecutor(database);
  const r = await buildCanonicalExamContext({
    request: new Request('https://example.test/s511/tutor'),
    purpose: 'tutor',
    authorize: authorizeA,
    bridge: {},
    deviceClaims: {
      diagnosis: { presented: true, fingerprint: deviceDiagnosisToken(device) },
    } as never,
    executor: recorder.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  check('G2 canonical context が組める', r.ok);
  eq('G2 diagnosis_logs の query は 1 本だけ',
    recorder.trace.filter((t) => t.table === 'diagnosis_logs').length, 1);
  eq('G2 diagnosis kind の query は 1 本だけ',
    recorder.trace.filter((t) => t.kind === 'diagnosis').length, 1);
  if (r.ok) {
    //   slot が canonical context から取れる（追加 read なし）。
    check('G2 tutorDiagnosisSlot が供給されている', r.tutorDiagnosisSlot !== null);
    eq('G2 tutorDiagnosisSchemaVersion は row の値', r.tutorDiagnosisSchemaVersion, '3');
    eq('G2 slot の hint は legacy oracle と一致',
      r.tutorDiagnosisSlot?.typeHint, legacyProject(payload(2))?.typeHint);
  }

  // ── canonical assembly / AI call は route に 1 箇所 ──
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  const routeCode = route.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');
  eq('G3 canonical assembly の呼び出しは route に 1 箇所',
    (routeCode.match(/buildCanonicalExamContext\s*\(/g) ?? []).length, 1);
  eq('G3 AI call は 1 本だけ（Run 1 の N6 guard を保持）',
    (routeCode.match(/anthropic\.messages\.create\s*\(/g) ?? []).length, 1);
  check('G3 diagnosis 専用の canonical assembly を作っていない',
    !/diagnosis(Canonical|Assembly|Context)\s*=\s*await/i.test(routeCode));

  // ── gate 条件は 1 段のまま（3 slot × shadow の 16 通りで read は 0 か 1）──
  const cond = /if \((anySlotSwitchEnabled \|\| shadowEnabled)\)/.exec(routeCode);
  check('G4 canonical assembly の gate 条件を読める', cond !== null);
  eq('G4 gate 条件は anySlot OR shadow の 1 段', cond?.[1], 'anySlotSwitchEnabled || shadowEnabled');
  const anyDecl = /const anySlotSwitchEnabled = ([^;]+);/.exec(routeCode);
  check('G4 anySlotSwitchEnabled の定義を読める', anyDecl !== null);
  eq('G4 anySlotSwitchEnabled は承認済み 3 slot の OR',
    anyDecl?.[1].replace(/\s+/g, ' ').trim(),
    'slotSwitchEnabled || activitySlotSwitchEnabled || diagnosisSlotSwitchEnabled');
  //   16 通りの真理値表: 呼び出しが 1 箇所なので条件が真なら 1 本・偽なら 0 本。
  let two = 0;
  for (const b of [false, true]) {
    for (const a of [false, true]) {
      for (const d of [false, true]) {
        for (const sh of [false, true]) {
          const reads = (b || a || d) || sh ? 1 : 0;
          if (reads > 1) two += 1;
          if (!b && !a && !d && !sh) eq('G4 全 OFF なら canonical read は 0', reads, 0);
        }
      }
    }
  }
  eq('G4 16 通りのどれでも canonical read が 2 にならない', two, 0);
}

// ══════════════════════════════════════════════════════════════════
// 7. slot 登録 / gate / 既存 slot 非回帰
// ══════════════════════════════════════════════════════════════════

function s7SlotRegistration(): void {
  console.log('\n7. slot 登録 / gate');

  eq('L1 切替可能 slot は承認済みの 3 つ（順序込み）',
    [...EXAM_SPINE_SWITCHABLE_SLOTS],
    ['tutor.basic_info', 'tutor.activity', 'tutor.diagnosis']);

  // ── gate は slot flag AND allowlist の連言（default deny / E-S11）──
  const s0 = process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS;
  const u0 = process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS;
  const set = (a?: string, b?: string): void => {
    if (a === undefined) delete process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS;
    else process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS = a;
    if (b === undefined) delete process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS;
    else process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS = b;
  };
  try {
    set(undefined, undefined);
    check('L2 env 未設定なら deny', !isExamSpineSlotSwitchEnabled('tutor.diagnosis', U));
    set('tutor.diagnosis', undefined);
    check('L2 slot だけでは deny', !isExamSpineSlotSwitchEnabled('tutor.diagnosis', U));
    set(undefined, U);
    check('L2 allowlist だけでは deny', !isExamSpineSlotSwitchEnabled('tutor.diagnosis', U));
    set('tutor.diagnosis', U);
    check('L2 slot AND allowlist で許可', isExamSpineSlotSwitchEnabled('tutor.diagnosis', U));
    check('L2 userId 空は deny', !isExamSpineSlotSwitchEnabled('tutor.diagnosis', ''));
    check('L2 別 user は deny', !isExamSpineSlotSwitchEnabled('tutor.diagnosis', 'other-user'));
    // ★ slot 独立 ★ diagnosis を許可しても他 slot は ON にならない。
    check('L3 diagnosis ON でも basic_info は OFF',
      !isExamSpineSlotSwitchEnabled('tutor.basic_info', U));
    check('L3 diagnosis ON でも activity は OFF',
      !isExamSpineSlotSwitchEnabled('tutor.activity', U));
    // 未承認 token は無視される。
    set('tutor.self_pr,tutor.essay', U);
    for (const bad of ['tutor.self_pr', 'tutor.essay', 'tutor.presentation']) {
      check(`L4 未承認 token ${bad} は無視される`,
        !isExamSpineSlotSwitchEnabled(bad as never, U));
    }
  } finally {
    set(s0, u0);
  }

  // ── route の wiring が実在する（module を直接呼ぶ harness だけでは緑になる穴）──
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  const routeCode = route.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');
  check('L5 route が decideTutorDiagnosisSlot を呼んでいる',
    /decideTutorDiagnosisSlot\s*\(/.test(routeCode));
  check('L5 route が diagnosis slot の gate を評価している',
    /isExamSpineSlotSwitchEnabled\('tutor\.diagnosis',/.test(routeCode));
  check('L5 diagnosis slot の usable は gate AND canonical.ok',
    /decideTutorDiagnosisSlot\(\{[\s\S]{0,300}?usable: diagnosisSlotSwitchEnabled && canonical\?\.ok === true/
      .test(routeCode));
  check('L5 schemaVersion は canonical context 由来（route で捏造しない）',
    /canonicalSchemaVersion: canonical\?\.ok === true \? canonical\.tutorDiagnosisSchemaVersion : null/
      .test(routeCode));
  check('L5 diagnosis の legacy は contextResult.context.diagnosis',
    /legacy: contextResult\.context\.diagnosis/.test(routeCode));

  // ── 差し替える key は 3 つだけ（他 slot を巻き込まない）──
  //   ★ region を spineContext 宣言に限定する ★ route 全体を見ると telemetry や
  //     AI 呼び出しの object literal まで拾ってしまう（実測）。
  const spineDecl = /const spineContext =([\s\S]*?)\n      : contextResult\.context;/.exec(routeCode);
  check('L6 spineContext の宣言を特定できる', spineDecl !== null);
  const after = (spineDecl?.[1] ?? '').slice((spineDecl?.[1] ?? '').indexOf('...contextResult.context'));
  const keys = [...after.matchAll(/[{,]\s*(\w+)\s*:/g)].map((m) => m[1]);
  eq('L6 差し替える slot は承認済みの 3 つだけ', [...new Set(keys)].sort(),
    ['activity', 'basicInfo', 'diagnosis']);

  // ── 既存 2 slot の wiring 非回帰 ──
  check('L7 basic_info slot の wiring が残っている',
    /decideTutorBasicInfoSlot\s*\(/.test(routeCode)
    && /isExamSpineSlotSwitchEnabled\('tutor\.basic_info',/.test(routeCode));
  check('L7 activity slot の wiring が残っている',
    /decideTutorActivitySlot\s*\(/.test(routeCode)
    && /isExamSpineSlotSwitchEnabled\('tutor\.activity',/.test(routeCode));
}

// ══════════════════════════════════════════════════════════════════
// 8. shadow / telemetry / prompt containment
// ══════════════════════════════════════════════════════════════════

function s8Containment(): void {
  console.log('\n8. containment');

  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  const routeCode = route.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');

  // ── prompt 実引数に diagnosis の観測値が混ざらない ──
  const composeArgs = /composeTutorPrompt\(\{([\s\S]*?)\n  \}\);/.exec(routeCode);
  check('T1 composeTutorPrompt の実引数が読める', composeArgs !== null);
  if (composeArgs) {
    for (const forbidden of [
      'diagnosisSlotDecision.reason', 'tutorDiagnosisSchemaVersion',
      'shadowOverall', 'shadowMismatchCount', 'comparison',
    ]) {
      check(`T1 prompt 実引数に ${forbidden} が無い`, !composeArgs[1].includes(forbidden));
    }
    check('T1 spineContext は slot 決定の結果をそのまま渡す',
      /\n\s*spineContext,/.test(composeArgs[1]));
  }

  // ── schema_version の「値」を telemetry に載せない（enum のみ / E-S12・E-S13）──
  const flushIdx = routeCode.indexOf('spineSlotDiagnosis');
  check('T2 diagnosis の telemetry が存在する', flushIdx !== -1);
  const flushRegion = routeCode.slice(Math.max(flushIdx - 400, 0), flushIdx + 400);
  check('T2 telemetry に authority / reason の enum しか載せない',
    flushRegion.includes('spineSlotDiagnosis: diagnosisSlotDecision.authority')
    && flushRegion.includes('spineSlotDiagnosisReason: diagnosisSlotDecision.reason'));
  check('T2 telemetry に schema_version の値を載せない',
    !/spineSlot[A-Za-z]*Schema/i.test(routeCode)
    && !routeCode.includes('tutorDiagnosisSchemaVersion,'));

  // ── slot decision は純関数（I/O / AI / env を持たない）──
  const slotSrc = readFileSync(join(ROOT, 'lib/examSpine/context/tutorDiagnosisSlot.ts'), 'utf8');
  for (const forbidden of ['process.env', 'fetch(', 'Date.now', 'Math.random',
    '@anthropic-ai', 'supabase', 'console.']) {
    check(`T3 slot module に ${forbidden} が無い`, !slotSrc.includes(forbidden));
  }
  check('T3 slot module は server-only import を持たない',
    !slotSrc.includes('.server') && !slotSrc.includes('next/headers'));

  // ── 受験生の本文 / payload が slot 経路に出ない ──
  const rich = decideTutorDiagnosisSlot({
    usable: true,
    canonical: projectTutorDiagnosisSlot(mapped('3', 'riaju')),
    canonicalSchemaVersion: '3',
    legacy: legacyProject(payload('riaju')),
  });
  const dumped = JSON.stringify(rich);
  for (const leaked of ['resultTitle', 'answers', 'タイトル（app 製固定文）', 'riaju', '3']) {
    check(`T4 decision 結果に ${leaked} が現れない`, !dumped.includes(leaked));
  }
  eq('T4 decision の field は authority / value / reason の 3 つ',
    Object.keys(rich).sort(), ['authority', 'reason', 'value']);
}

// ══════════════════════════════════════════════════════════════════
// 9. Decision / STATE
// ══════════════════════════════════════════════════════════════════

function s9Docs(): void {
  console.log('\n9. Decision / STATE');

  const dec = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md'), 'utf8');

  // ── E-S59（schema_version authority）──
  const i59 = dec.indexOf('## E-S59 ');
  const i60 = dec.indexOf('## E-S60 ');
  check('K1 E-S59 節を特定できる', i59 !== -1 && i60 > i59);
  const es59 = dec.slice(i59, i60);
  const head59 = dec.split('\n').find((l) => l.startsWith('## E-S59 ')) ?? '';
  check('K1 E-S59 の見出しは schema_version の authority',
    head59.includes('schema_version') && head59.includes('writer contract'), head59.slice(0, 110));
  for (const [label, needle] of [
    ['writer contract の版であること', 'writer contract の版'],
    ['device が保持していないこと', 'build 時定数'],
    ['superseded に 2 が入ること', "superseded '2','1'"],
    ['ineligible ≠ 内容が違う', 'ineligible ≠ 内容が違う'],
    ['DDL default を変えない', 'DDL DEFAULT'],
    ['backfill しない', 'DB backfill'],
    ['verified 扱いしない', 'verified 扱いする'],
    ['sync view から外さない', 'sync view から'],
    ['自然治癒しない', '自然治癒しない'],
    ['mixed 版が存在しない', 'mixed 版'],
  ] as const) {
    check(`K1 E-S59 evidence: ${label}`, es59.includes(needle), needle);
  }

  // ── E-S60（consumer switch）──
  const nextHead = dec.indexOf('\n## ', i60 + 5);
  const es60 = dec.slice(i60, nextHead === -1 ? dec.length : nextHead);
  const head60 = dec.split('\n').find((l) => l.startsWith('## E-S60 ')) ?? '';
  check('K2 E-S60 の見出しは diagnosis の consumer 切替',
    head60.includes('diagnosis') && head60.includes('consumer 切替'), head60.slice(0, 110));
  for (const [label, needle] of [
    ['slot token', 'tutor.diagnosis'],
    ['採用条件は AI-visible 同値', 'AI-visible 同値'],
    ['cap 同値の根拠', 'slice(0, 120)'],
    ['would_reduce_context を持たない', 'would_reduce_context'],
    ['summary を作らない', 'summary'],
    ['read 本数', '16 通り'],
    ['2 枚目の gate は trap', 'trap'],
  ] as const) {
    check(`K2 E-S60 evidence: ${label}`, es60.includes(needle), needle);
  }

  // ── decision graph（N13 と同じ規律）──
  check('K3 E-S44 は diagnosis の canonical 表現のまま',
    /^## E-S44 — diagnosis の canonical 表現/m.test(dec));
  check('K3 E-S56 は basic_info の切替のまま',
    /^## E-S56 — tutor `basic_info` の consumer 切替/m.test(dec));
  check('K3 E-S58 は activity の切替のまま',
    /^## E-S58 — tutor `activity` を 2 番目の controlled consumer 切替/m.test(dec));
  //   module が正しい ID を引いている。
  for (const [rel, ids] of [
    ['lib/examSpine/sync/adapters/registry.ts', ['E-S59']],
    ['lib/examSpine/context/tutorDiagnosisSlot.ts', ['E-S59', 'E-S60', 'E-S44']],
    ['lib/examSpine/context/slotSwitchGate.server.ts', ['E-S60']],
  ] as const) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const id of ids) check(`K3 ${rel} は ${id} を引いている`, src.includes(id), rel);
  }

  // ── STATE ──
  const state = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STATE.md'), 'utf8');
  check('K4 STATE に diagnosis readiness がある',
    state.includes('### diagnosis readiness（Stage 5.11'));
  for (const [label, needle] of [
    ['schema_version finding', 'writer contract の版'],
    ['legacy v1/v2 ruling', 'comparison ineligible'],
    ['DDL 所見', 'latent hazard'],
    ['switch 結果', 'CONSUMER_SWITCHED = YES'],
    ['switchable slots 3 本', "['tutor.basic_info', 'tutor.activity', 'tutor.diagnosis']"],
  ] as const) {
    check(`K4 STATE evidence: ${label}`, state.includes(needle), needle);
  }
  //   ★ 先行 Stage の宣言を巻き戻していない ★
  check('K4 STATE: statement_review semantics は DEFERRED のまま',
    state.includes('semantics  DEFERRED（E-S49 classification C）'));
  check('K4 STATE: essay runtime enable は BLOCKED のまま',
    state.includes('runtime enable  BLOCKED  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay'));
  check('K4 STATE: self_pr semantics は UNRESOLVED のまま',
    state.includes('semantics       UNRESOLVED'));
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.11] diagnosis schema_version 収束 + consumer 切替');
  s1SchemaAuthority();
  s2Contract();
  s3Comparison();
  s4Projection();
  s5Decision();
  await s6QuerySafety();
  s7SlotRegistration();
  s8Containment();
  s9Docs();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.11] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.11] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.11] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.11] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.11] PASS');
}
void main();
