// Exam Spine — 内部設計 Final Closure（Run 3）。
//
// ★ 本 suite は「新しい Stage」ではない ★
//   全 source kind / consumer / runtime path の **最終状態そのもの**を固定する。
//   個々の Stage suite が「その Stage で何をしたか」を見るのに対し、ここは
//   「Exam Spine 全体が今どういう形で閉じているか」を 1 箇所に集約して pin する。
//
// ★ 「READY でない」＝「未完成」ではない（E-S61）★
//   閉じ方は 4 種類ある。混同すると、正しく閉じた kind を未完成と誤読して
//   不要な migration を始めてしまう。
//
//     SWITCHED   controlled consumer 切替済み（AI-visible 同値を実測済み）
//     DEFERRED   技術的に到達可能だが、product 判断 or 追加 Decision が要る
//     BLOCKED    runtime 有効化を構造的に禁止している
//     N/A        その軸が概念的に適用されない（class 2）
//
// ★ この suite が落ちるべきとき ★
//   kind が黙って増減した / 閉じ方が黙って変わった / consumer が無断で増えた /
//   canonical read が 2 本になった / AI call が増えた / 宣言と実装がずれた。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
globalThis.fetch = ((...args: Parameters<typeof globalThis.fetch>) => {
  fetchCallCount += 1;
  throw new Error(`[final-closure] 外部通信: ${String(args[0])}`);
}) as typeof globalThis.fetch;

import type { ExamSourceKind } from '@/lib/examSpine/sourceData/types';
import type { ExamRequestAuthorization } from '@/lib/examSpine/read/requestSnapshot.server';

import {
  EXAM_SOURCE_KINDS,
  EXAM_SOURCE_AUTHORITY,
  EXAM_SOURCE_TABLES,
} from '@/lib/examSpine/sourceData/types';
import {
  EXAM_SYNC_SUPPORTED_KINDS,
  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED,
  EXAM_SYNC_ADAPTER_CONTRACTS,
  EXAM_WRITER_SCHEMA_CONTRACTS,
} from '@/lib/examSpine/sync/adapters/registry';
import { isExamSyncRuntimeBlocked, examSyncUsability } from '@/lib/examSpine/sync/enable';
import { EXAM_SPINE_SWITCHABLE_SLOTS } from '@/lib/examSpine/context/slotSwitchGate.server';
import { sourcesForPurpose, purposeAllowsSource } from '@/lib/examSpine/purpose';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from '@/lib/examSpine/blocks/registry';
import { EXAM_CONTEXT_BLOCK_IDS } from '@/lib/examSpine/blocks/types';
import { EXAM_PURPOSE_PLANS } from '@/lib/examSpine/orchestrator/plan';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { createRecordingExecutor, USER_A, type FakeDb } from './fixtures/examSpineStage3';

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

const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
const routeCode = route.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');
const state = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STATE.md'), 'utf8');
const dec = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md'), 'utf8');

// ══════════════════════════════════════════════════════════════════
// 1. Final source-kind matrix
// ══════════════════════════════════════════════════════════════════

/** 閉じ方の分類（E-S61）。 */
type Closure = 'SWITCHED' | 'DEFERRED' | 'BLOCKED' | 'N/A';

type Row = {
  readonly kind: ExamSourceKind;
  readonly cls: 1 | 2;
  /** Source-Sync を適用するか（class 2 は適用しない / E-S3）。 */
  readonly syncApplies: boolean;
  readonly runtimeBlocked: boolean;
  readonly claimWired: boolean;
  readonly consumer: Closure;
  /** consumer が SWITCHED でない場合、解除に何の authority が要るか。 */
  readonly gatingAuthority: string;
};

/**
 * ★ 最終状態の宣言（この表が Run 3 の結論そのもの）★
 *   実装から導出せず **手で宣言**し、下の検査で実装と突き合わせる。
 *   導出すると「実装が変わったら表も変わる」ため、無断変更を検出できない。
 */
const FINAL_MATRIX: readonly Row[] = [
  { kind: 'basic_info', cls: 1, syncApplies: true, runtimeBlocked: false, claimWired: true,
    consumer: 'SWITCHED', gatingAuthority: '-' },
  { kind: 'activity', cls: 1, syncApplies: true, runtimeBlocked: false, claimWired: true,
    consumer: 'SWITCHED', gatingAuthority: '-' },
  { kind: 'diagnosis', cls: 1, syncApplies: true, runtimeBlocked: false, claimWired: true,
    consumer: 'SWITCHED', gatingAuthority: '-' },
  // transport / semantics / block はすべて READY。切替を阻むのは product 判断ではなく、
  // canonical mapper と legacy の feedback_json 解釈差（fingerprint 材料）である（E-S61）。
  { kind: 'interview_record', cls: 1, syncApplies: true, runtimeBlocked: false, claimWired: true,
    consumer: 'DEFERRED', gatingAuthority: 'E-S61 feedback_json 解釈差（Source-Sync 影響 / 新 Decision 要）' },
  // transport READY だが tutor 向け canonical block が無い（block coverage）。
  { kind: 'self_analysis', cls: 1, syncApplies: true, runtimeBlocked: false, claimWired: true,
    consumer: 'DEFERRED', gatingAuthority: 'tutor canonical block 未作成（block coverage / E-S25）' },
  // semantics C（legacy 相当射影と canonical 射影のどちらを正とするかが product 判断）。
  { kind: 'statement_review', cls: 1, syncApplies: true, runtimeBlocked: false, claimWired: true,
    consumer: 'DEFERRED', gatingAuthority: 'E-S49 product semantics' },
  { kind: 'self_pr', cls: 1, syncApplies: true, runtimeBlocked: true, claimWired: false,
    consumer: 'BLOCKED', gatingAuthority: 'E-S50 Level C + HD-1〜HD-6 product semantics' },
  { kind: 'essay', cls: 1, syncApplies: true, runtimeBlocked: true, claimWired: false,
    consumer: 'BLOCKED', gatingAuthority: 'E-S52 read window + E-S53 product semantics' },
  { kind: 'interview_ai', cls: 2, syncApplies: false, runtimeBlocked: false, claimWired: false,
    consumer: 'N/A', gatingAuthority: 'E-S3 class 2（device canonical が存在しない）' },
  { kind: 'presentation', cls: 2, syncApplies: false, runtimeBlocked: false, claimWired: false,
    consumer: 'N/A', gatingAuthority: 'E-S3 / E-S54 class 2' },
];

function claimKinds(): readonly string[] {
  const src = readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8');
  const i = src.indexOf('export function buildTutorDeviceClaimEntries(');
  check('M0 claim 組み立て関数を特定できる', i !== -1);
  return Array.from(src.slice(Math.max(i, 0)).matchAll(/entries\.push\(\{\s*kind:\s*'([a-z_]+)'/g))
    .map((m) => m[1]).sort();
}

function s1Matrix(): void {
  console.log('\n1. Final source-kind matrix');

  // ── kind 集合が黙って増減していない ──
  eq('M1 宣言した matrix と EXAM_SOURCE_KINDS が完全一致（順不同）',
    FINAL_MATRIX.map((r) => r.kind).sort(), [...EXAM_SOURCE_KINDS].sort());
  eq('M1 kind 数は 10', EXAM_SOURCE_KINDS.length, 10);
  eq('M1 matrix に重複が無い', FINAL_MATRIX.length, new Set(FINAL_MATRIX.map((r) => r.kind)).size);

  const claims = claimKinds();

  for (const r of FINAL_MATRIX) {
    // authority class
    eq(`M2 ${r.kind}: authority class`,
      EXAM_SOURCE_AUTHORITY[r.kind],
      r.cls === 1 ? 'device_canonical_mirrored' : 'server_authoritative');
    // Source-Sync 適用可否は「supported kind に載っているか」で構造的に決まる（E-S3）
    eq(`M2 ${r.kind}: Source-Sync 適用`,
      (EXAM_SYNC_SUPPORTED_KINDS as readonly string[]).includes(r.kind), r.syncApplies);
    // class 2 は adapter capability も not_applicable
    eq(`M2 ${r.kind}: adapter capability`,
      (EXAM_SYNC_ADAPTER_CONTRACTS[r.kind] as { capability: string }).capability,
      r.cls === 1 ? 'possible' : 'not_applicable');
    // runtime block
    eq(`M2 ${r.kind}: runtime blocked`, isExamSyncRuntimeBlocked(r.kind), r.runtimeBlocked);
    // claim wiring
    eq(`M2 ${r.kind}: claim wired`, claims.includes(r.kind), r.claimWired);
    // table 宣言が空でない
    check(`M2 ${r.kind}: source table が宣言されている`,
      (EXAM_SOURCE_TABLES[r.kind] ?? []).length > 0);
    // consumer 切替済みなら slot が実在する（逆も）
    eq(`M2 ${r.kind}: switchable slot の有無`,
      (EXAM_SPINE_SWITCHABLE_SLOTS as readonly string[]).includes(`tutor.${r.kind}`),
      r.consumer === 'SWITCHED');
  }

  // ── 閉じ方の整合（分類が自己矛盾しない）──
  for (const r of FINAL_MATRIX) {
    if (r.consumer === 'N/A') {
      check(`M3 ${r.kind}: N/A は class 2 に限る`, r.cls === 2);
      check(`M3 ${r.kind}: class 2 は Source-Sync を適用しない`, !r.syncApplies);
      check(`M3 ${r.kind}: class 2 は claim を持たない`, !r.claimWired);
      check(`M3 ${r.kind}: class 2 は runtime block に載せない（E-S3 で既に構造的に落ちる）`,
        !r.runtimeBlocked);
    }
    if (r.consumer === 'BLOCKED') {
      check(`M3 ${r.kind}: BLOCKED は runtime blocked である`, r.runtimeBlocked);
      check(`M3 ${r.kind}: BLOCKED は claim を配線しない`, !r.claimWired);
    }
    if (r.consumer === 'SWITCHED') {
      check(`M3 ${r.kind}: SWITCHED は runtime blocked でない`, !r.runtimeBlocked);
      check(`M3 ${r.kind}: SWITCHED は claim 配線済み`, r.claimWired);
      check(`M3 ${r.kind}: SWITCHED は tutor purpose が許可している`,
        purposeAllowsSource('tutor', r.kind));
      eq(`M3 ${r.kind}: SWITCHED に gating authority は無い`, r.gatingAuthority, '-');
    }
    if (r.consumer !== 'SWITCHED') {
      check(`M3 ${r.kind}: 非 SWITCHED は解除 authority を宣言している`,
        r.gatingAuthority !== '-' && r.gatingAuthority.length > 10, r.gatingAuthority);
    }
  }

  // ── 集合レベルの pin（黙って増えない）──
  eq('M4 SWITCHED は 3 kind', FINAL_MATRIX.filter((r) => r.consumer === 'SWITCHED').map((r) => r.kind),
    ['basic_info', 'activity', 'diagnosis']);
  eq('M4 BLOCKED は 2 kind', FINAL_MATRIX.filter((r) => r.consumer === 'BLOCKED').map((r) => r.kind).sort(),
    ['essay', 'self_pr']);
  eq('M4 N/A は class 2 の 2 kind',
    FINAL_MATRIX.filter((r) => r.consumer === 'N/A').map((r) => r.kind).sort(),
    ['interview_ai', 'presentation']);
  eq('M4 DEFERRED は 3 kind',
    FINAL_MATRIX.filter((r) => r.consumer === 'DEFERRED').map((r) => r.kind).sort(),
    ['interview_record', 'self_analysis', 'statement_review']);
  eq('M4 全 kind が分類されている（未分類 0）',
    FINAL_MATRIX.filter((r) => !['SWITCHED', 'DEFERRED', 'BLOCKED', 'N/A'].includes(r.consumer)).length, 0);
}

// ══════════════════════════════════════════════════════════════════
// 2. Consumer / slot architecture
// ══════════════════════════════════════════════════════════════════

function s2Consumers(): void {
  console.log('\n2. Consumer / slot');

  eq('C1 switchable slot は 3 つ（順序込み）', [...EXAM_SPINE_SWITCHABLE_SLOTS],
    ['tutor.basic_info', 'tutor.activity', 'tutor.diagnosis']);

  // ★ 禁止 kind が slot に混入していない ★
  for (const r of FINAL_MATRIX) {
    if (r.consumer === 'SWITCHED') continue;
    check(`C1 ${r.kind} は switchable slot に無い`,
      !(EXAM_SPINE_SWITCHABLE_SLOTS as readonly string[]).includes(`tutor.${r.kind}`));
  }

  // ★ 各 slot が route に実配線されている（module 直呼び harness では緑になる穴）★
  for (const [slot, decide] of [
    ['tutor.basic_info', 'decideTutorBasicInfoSlot'],
    ['tutor.activity', 'decideTutorActivitySlot'],
    ['tutor.diagnosis', 'decideTutorDiagnosisSlot'],
  ] as const) {
    check(`C2 route が ${slot} の gate を評価している`,
      routeCode.includes(`isExamSpineSlotSwitchEnabled('${slot}',`), slot);
    check(`C2 route が ${decide} を呼んでいる`, new RegExp(`${decide}\\s*\\(`).test(routeCode));
  }

  // ★ 差し替える key は 3 つだけ ★（spineContext 宣言に region を限定する）
  const spineDecl = /const spineContext =([\s\S]*?)\n      : contextResult\.context;/.exec(routeCode);
  check('C3 spineContext の宣言を特定できる', spineDecl !== null);
  const body = spineDecl?.[1] ?? '';
  const after = body.slice(body.indexOf('...contextResult.context'));
  eq('C3 差し替える slot key は 3 つだけ',
    [...new Set([...after.matchAll(/[{,]\s*(\w+)\s*:/g)].map((m) => m[1]))].sort(),
    ['activity', 'basicInfo', 'diagnosis']);

  // ★ fallback reason vocabulary が閉じている（permanent silent failure を作らない）★
  const REASONS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['lib/examSpine/context/tutorBasicInfoSlot.ts', []],
    ['lib/examSpine/context/tutorActivitySlot.ts',
      ['canonical_absent', 'divergent_projection', 'not_usable', 'would_reduce_context']],
    ['lib/examSpine/context/tutorDiagnosisSlot.ts',
      ['canonical_absent', 'divergent_projection', 'not_usable', 'schema_version_ineligible']],
  ];
  for (const [rel, expected] of REASONS) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const m = /FallbackReason =([\s\S]*?);/.exec(src);
    check(`C4 ${rel}: fallback reason 型を特定できる`, m !== null, rel);
    if (!m || expected.length === 0) continue;
    eq(`C4 ${rel}: reason 集合`,
      [...new Set(Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]))].sort(), [...expected]);
  }
  // ★ どの slot module も fail-open（legacy を返す）である ★
  for (const rel of REASONS.map(([r]) => r)) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    check(`C5 ${rel}: 非採用時は legacy 値を返す`,
      /authority: 'legacy', value: input\.legacy/.test(src), rel);
    check(`C5 ${rel}: 純関数（env / I/O / AI を持たない）`,
      !/process\.env|fetch\(|@anthropic-ai|supabase|Math\.random/.test(src), rel);
  }
}

// ══════════════════════════════════════════════════════════════════
// 3. Canonical read / query / AI call architecture
// ══════════════════════════════════════════════════════════════════

async function s3Architecture(): Promise<void> {
  console.log('\n3. Canonical read / query / AI call');

  // ── canonical assembly は route に 1 箇所 ──
  eq('A1 canonical assembly の呼び出しは route に 1 箇所',
    (routeCode.match(/buildCanonicalExamContext\s*\(/g) ?? []).length, 1);
  // ── production で assembler を import するのは route だけ ──
  const importers: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${e}`;
      if (statSync(join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(e)) continue;
      if (rel === 'lib/examSpine/context/assemble.server.ts') continue;
      if (readFileSync(join(ROOT, rel), 'utf8').includes('buildCanonicalExamContext')) importers.push(rel);
    }
  };
  for (const d of ['lib', 'app']) walk(d);
  eq('A1 assembler を import する production file は tutor route だけ',
    importers, ['app/api/tutor/route.ts']);

  // ── gate は 1 段（3 slot × shadow = 16 通りで read は 0 か 1）──
  const cond = /if \((anySlotSwitchEnabled \|\| shadowEnabled)\)/.exec(routeCode);
  check('A2 canonical assembly の gate 条件を読める', cond !== null);
  eq('A2 gate は anySlot OR shadow の 1 段', cond?.[1], 'anySlotSwitchEnabled || shadowEnabled');
  const anyDecl = /const anySlotSwitchEnabled = ([^;]+);/.exec(routeCode);
  check('A2 anySlotSwitchEnabled の定義を読める', anyDecl !== null);
  eq('A2 anySlotSwitchEnabled は 3 slot の OR',
    anyDecl?.[1].replace(/\s+/g, ' ').trim(),
    'slotSwitchEnabled || activitySlotSwitchEnabled || diagnosisSlotSwitchEnabled');
  let two = 0; let zero = 0;
  for (const b of [false, true]) for (const a of [false, true])
    for (const d of [false, true]) for (const sh of [false, true]) {
      const reads = (b || a || d || sh) ? 1 : 0;
      if (reads > 1) two += 1;
      if (reads === 0) zero += 1;
    }
  eq('A2 16 通りのどれでも canonical read は 2 にならない', two, 0);
  eq('A2 全 OFF の 1 通りだけ canonical read = 0', zero, 1);

  // ── canonical read 1 回の内部で source kind / table の重複が無い ──
  const rec = createRecordingExecutor({ tables: {} } as unknown as FakeDb);
  const r = await buildCanonicalExamContext({
    request: new Request('https://example.test/final-closure'),
    purpose: 'tutor',
    authorize: async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A }),
    bridge: {}, executor: rec.executor, projectionNow: '2026-01-01T00:00:00.000Z',
  });
  check('A3 canonical context が組める', r.ok);
  const byKind = new Map<string, number>();
  const byTable = new Map<string, number>();
  for (const t of rec.trace) {
    byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + 1);
    byTable.set(t.table, (byTable.get(t.table) ?? 0) + 1);
  }
  eq('A3 同一 kind への duplicate query は 0',
    [...byKind.entries()].filter(([, n]) => n > 1), []);
  eq('A3 同一 table への duplicate query は 0',
    [...byTable.entries()].filter(([, n]) => n > 1), []);
  // tutor が許可する kind の数と一致（許可外は query を出さない）
  eq('A3 query 本数 = tutor purpose の許可 kind 数',
    rec.trace.length, sourcesForPurpose('tutor').length);
  eq('A3 purpose 拒否 kind（self_pr）の query は 0',
    rec.trace.filter((t) => t.kind === 'self_pr').length, 0);
  eq('A3 self_prs table を読まない',
    rec.trace.filter((t) => t.table === 'self_prs').length, 0);

  // ── AI call は 1 request 1 本（Run 1 N6）──
  eq('A4 tutor route の AI call は 1 本', (routeCode.match(/anthropic\.messages\.create\s*\(/g) ?? []).length, 1);
  eq('A4 tutor route に stream 呼び出しは無い', (routeCode.match(/anthropic\.messages\.stream\s*\(/g) ?? []).length, 0);
  // ★ Spine / slot / shadow / compose のどれも model を呼ばない ★
  const aiOffenders: string[] = [];
  const walkAi = (dir: string): void => {
    for (const e of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${e}`;
      if (statSync(join(ROOT, rel)).isDirectory()) { walkAi(rel); continue; }
      if (!/\.tsx?$/.test(e)) continue;
      const src = readFileSync(join(ROOT, rel), 'utf8');
      if (/@anthropic-ai|messages\.create\s*\(|messages\.stream\s*\(/.test(src)) aiOffenders.push(rel);
    }
  };
  for (const d of ['lib/examSpine', 'lib/tutor', 'lib/contextBuilders']) walkAi(d);
  eq('A4 Spine / tutor builder に AI SDK 呼び出しが無い', aiOffenders, []);
}

// ══════════════════════════════════════════════════════════════════
// 4. Shadow / privacy / telemetry
// ══════════════════════════════════════════════════════════════════

function s4Containment(): void {
  console.log('\n4. Shadow / privacy / telemetry');

  // ── shadow observation は prompt 経路に出ない ──
  const composeArgs = /composeTutorPrompt\(\{([\s\S]*?)\n  \}\);/.exec(routeCode);
  check('P1 composeTutorPrompt の実引数が読める', composeArgs !== null);
  for (const forbidden of [
    'shadowOverall', 'shadowMismatchCount', 'comparison', 'shadowResolvedInput',
    'slotDecision.reason', 'activitySlotDecision.reason', 'diagnosisSlotDecision.reason',
    'tutorDiagnosisSchemaVersion', 'fingerprint',
  ]) {
    check(`P1 prompt 実引数に ${forbidden} が無い`,
      !(composeArgs?.[1] ?? '').includes(forbidden));
  }

  // ── telemetry は enum / 数値のみ（生の受験生データを載せない）──
  //
  // ★ route 全体ではなく `lat.flush({ ... })` の引数 span だけを見る ★
  //   route 本体には slot の値そのものを扱う行（`categoryCounts` 等）が正当に存在する。
  //   全体検索にすると「telemetry に出ている」と誤検出する（実測）。
  const flushSpans: Array<[number, number]> = [];
  for (const m of routeCode.matchAll(/lat\.flush\(\{/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < routeCode.length; i += 1) {
      if (routeCode[i] === '{') depth += 1;
      else if (routeCode[i] === '}') { depth -= 1; if (depth === 0) { flushSpans.push([open, i]); break; } }
    }
  }
  check('P2 telemetry flush の引数 span を特定できる', flushSpans.length > 0);
  const flushText = flushSpans.map(([a, b]) => routeCode.slice(a, b)).join('\n');
  for (const forbidden of [
    'spineSlotBasicInfoValue', 'spineSlotActivityValue', 'spineSlotDiagnosisValue',
    'typeHint', 'categoryCounts', 'payload', 'fingerprint', 'schemaVersion',
  ]) {
    check(`P2 telemetry 引数に ${forbidden} が無い`, !flushText.includes(forbidden), forbidden);
  }
  check('P2 telemetry に slot の authority / reason enum は載っている（空回り検査でない）',
    flushText.includes('spineSlotDiagnosis') && flushText.includes('spineSlotBasicInfo'));
  check('P2 telemetry は userId を tail だけに縮める',
    /userId: userIdTail\(userId\)/.test(routeCode));
  check('P2 schema_version の値を telemetry に載せない',
    !routeCode.includes('tutorDiagnosisSchemaVersion,'));

  // ── canonical block / slot に本文系 field が現れない ──
  const REG = EXAM_CONTEXT_BLOCK_REGISTRY as unknown as Record<string, { sourceKind?: string }>;
  //   BLOCKED / 未切替 kind は tutor plan に block を持たない or 持っても接続されない。
  const tutorPlan = EXAM_PURPOSE_PLANS.tutor;
  eq('P3 tutor plan は render を持たない（plan は prompt 経路ではない / E-S51）',
    tutorPlan.render, null);
  eq('P3 tutor plan は legacyBuilder を持たない', tutorPlan.legacyBuilder, null);
  //   BLOCKED kind は canonical block を 1 つも持たない。
  for (const kind of ['self_pr', 'essay'] as const) {
    eq(`P3 ${kind} の canonical block は 0 件`,
      (EXAM_CONTEXT_BLOCK_IDS as readonly string[]).filter((id) => REG[id]?.sourceKind === kind), []);
  }
}

// ══════════════════════════════════════════════════════════════════
// 5. Claim / runtime block / purpose
// ══════════════════════════════════════════════════════════════════

function s5Invariants(): void {
  console.log('\n5. Claim / runtime block / purpose');

  // ── claim exact set ──
  eq('B1 claim kind は 6 つ（順序ソート済み）', claimKinds(),
    ['activity', 'basic_info', 'diagnosis', 'interview_record', 'self_analysis', 'statement_review']);
  for (const kind of ['self_pr', 'essay', 'presentation', 'interview_ai'] as const) {
    check(`B1 ${kind} の claim は配線されていない`, !claimKinds().includes(kind));
  }

  // ── runtime block exact set（宣言順で pin。sort しない）──
  eq('B2 runtime block は self_pr と essay のみ',
    EXAM_SOURCE_KINDS.filter(isExamSyncRuntimeBlocked), ['self_pr', 'essay']);
  //   blocked kind は canary 許可 + verified でも usable にならない。
  for (const kind of ['self_pr', 'essay'] as const) {
    eq(`B2 ${kind} は runtime_blocked で veto`,
      examSyncUsability({ kind, verdict: 'verified', canaryAllowed: true }),
      { usability: 'veto', reason: 'runtime_blocked' });
  }
  //   ★ blocker の理由文が自分の authority を名指ししている ★
  //     集合だけ pin すると、理由文が別 kind のものへ差し替わっても気付けない。
  for (const [kind, id, forbidden] of [
    ['essay', 'E-S52', 'propagateDelete'],
    ['self_pr', 'E-S50', '反転'],
  ] as const) {
    const reason = EXAM_SYNC_RUNTIME_ENABLE_BLOCKED[kind] ?? '';
    check(`B2 ${kind} の blocker 理由は ${id} を根拠にする`, reason.includes(id), reason.slice(0, 60));
    check(`B2 ${kind} の理由に他 kind の根拠が混ざっていない`, !reason.includes(forbidden));
    check(`B2 ${kind} の理由は runtime claim / enable / canary の禁止を述べる`,
      reason.includes('runtime claim'));
  }
  //   class 2 は blocker ではなく kind_not_syncable で落ちる（理由を取り違えない）。
  for (const kind of ['presentation', 'interview_ai'] as const) {
    eq(`B2 ${kind} は kind_not_syncable で veto（E-S3）`,
      examSyncUsability({ kind, verdict: 'verified', canaryAllowed: true }),
      { usability: 'veto', reason: 'kind_not_syncable' });
  }

  // ── purpose matrix ──
  const tutor = sourcesForPurpose('tutor');
  eq('B3 tutor が許可する kind は 9（self_pr のみ拒否）', [...tutor].sort(),
    [...EXAM_SOURCE_KINDS].filter((k) => k !== 'self_pr').sort());
  check('B3 tutor は self_pr を許可しない', !purposeAllowsSource('tutor', 'self_pr'));
  //   SWITCHED kind はすべて tutor が許可している。
  for (const r of FINAL_MATRIX.filter((x) => x.consumer === 'SWITCHED')) {
    check(`B3 SWITCHED の ${r.kind} は tutor が許可`, purposeAllowsSource('tutor', r.kind));
  }
  //   未知 purpose は default deny。
  eq('B3 未知 purpose は空（default deny / E-S28）', sourcesForPurpose('__unknown__'), []);

  // ── writer schema contract（Run 2 / E-S59）──
  eq('B4 schema contract を宣言する kind は 3 つ',
    Object.keys(EXAM_WRITER_SCHEMA_CONTRACTS).sort(), ['activity', 'basic_info', 'diagnosis']);
  eq('B4 diagnosis の current 版は "3"', EXAM_WRITER_SCHEMA_CONTRACTS.diagnosis.current, '3');
  eq('B4 diagnosis の superseded は "1" と "2"',
    [...EXAM_WRITER_SCHEMA_CONTRACTS.diagnosis.superseded].sort(), ['1', '2']);
}

// ══════════════════════════════════════════════════════════════════
// 6. Decision graph / STATE
// ══════════════════════════════════════════════════════════════════

function s6Docs(): void {
  console.log('\n6. Decision graph / STATE');

  // ── ID の重複と最大値 ──
  const ids = Array.from(dec.matchAll(/^## E-S(\d+)/gm)).map((m) => Number(m[1]));
  eq('D1 E-S ID に重複が無い', ids.length, new Set(ids).size);
  eq('D1 E-S の最大 ID は 61', Math.max(...ids), 61);
  //   欠番が無い（1..max が連続）。
  const missing = Array.from({ length: Math.max(...ids) }, (_, i) => i + 1).filter((n) => !ids.includes(n));
  eq('D1 E-S ID に欠番が無い', missing, []);

  // ── 見出しの主題（意味的 retarget の検出 / Run 1 N13 と同じ規律）──
  for (const [id, needle] of [
    ['E-S44', 'diagnosis の canonical 表現'],
    ['E-S49', 'statement_review'],
    ['E-S50', 'device history window'],
    ['E-S51', 'interview_record'],
    ['E-S52', '`essay` の read window'],
    ['E-S54', '`presentation`'],
    ['E-S56', 'tutor `basic_info` の consumer 切替'],
    ['E-S58', 'tutor `activity` を 2 番目の controlled consumer 切替'],
    ['E-S59', '`schema_version` は writer contract の版'],
    ['E-S60', 'tutor `diagnosis` を 3 番目の controlled consumer 切替'],
    ['E-S61', 'Exam Spine 内部設計の最終 closure'],
  ] as const) {
    const head = dec.split('\n').find((l) => l.startsWith(`## ${id} `)) ?? '';
    check(`D2 ${id} の見出しが期待の主題`, head.includes(needle), head.slice(0, 110));
  }

  // ── E-S61（final closure）の内容 ──
  const i61 = dec.indexOf('## E-S61 ');
  //   ★ 節の終端は「次の Decision 見出し」で取る ★ E-S61 の本文には `## 1.` 等の
  //     小見出しがあるため `\n## ` で切ると本文をほぼ全部落とす（実測）。
  const nextDecision = /\n## E-[A-Z]?\d+ /.exec(dec.slice(i61 + 5));
  const es61 = dec.slice(i61, nextDecision ? i61 + 5 + nextDecision.index : dec.length);
  check('D3 E-S61 節を特定できる', i61 !== -1);
  for (const [label, needle] of [
    ['4 分類の定義', 'SWITCHED'],
    ['READY でない ≠ 未完成', '「READY でない」'],
    ['interview_record の実技術理由', 'feedback_json'],
    ['fingerprint 材料であること', 'fingerprint'],
    ['self_analysis の block coverage', 'block coverage'],
    ['production integration は別 phase', 'PRODUCTION_INTEGRATION'],
  ] as const) {
    check(`D3 E-S61 evidence: ${label}`, es61.includes(needle), needle);
  }

  // ── STATE が現実と一致（stale 表記が残っていない）──
  check('D4 STATE に Final Closure 節がある',
    state.includes('# Exam Spine 内部設計 Final Closure（Run 3）'));
  //   ★ Run 2 が残した stale な「diagnosis は未実装」表記を潰したこと ★
  check('D4 STATE に「diagnosis … 未実装」が残っていない',
    !/diagnosis \/ schema_version convergence \/ consumer switch\s+← \*\*未実装\*\*/.test(state));
  //   先行 Stage の宣言は巻き戻っていない。
  for (const [label, needle] of [
    ['statement_review semantics DEFERRED', 'semantics  DEFERRED（E-S49 classification C）'],
    ['essay runtime blocked', 'runtime enable  BLOCKED  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay'],
    ['self_pr semantics UNRESOLVED', 'semantics       UNRESOLVED'],
    ['diagnosis 切替済み', 'CONSUMER_SWITCHED = YES'],
  ] as const) {
    check(`D4 STATE: ${label} が保たれている`, state.includes(needle), needle);
  }
  //   ★ 完成宣言が事実と矛盾していないこと ★
  //     STATE が COMPLETE を名乗るなら、実装側の 3 slot が実在しなければならない。
  if (state.includes('EXAM_SPINE_INTERNAL_DESIGN_COMPLETE = YES')) {
    eq('D5 COMPLETE を名乗るなら switchable slot は 3 つ',
      [...EXAM_SPINE_SWITCHABLE_SLOTS],
      ['tutor.basic_info', 'tutor.activity', 'tutor.diagnosis']);
    check('D5 COMPLETE を名乗るなら runtime block は self_pr / essay の 2 つ',
      EXAM_SOURCE_KINDS.filter(isExamSyncRuntimeBlocked).length === 2);
    check('D5 COMPLETE を名乗るなら completion blocker 0 と宣言している',
      state.includes('TECHNICAL_COMPLETION_BLOCKERS = 0'));
  }
  //   STATE の matrix 宣言が本 suite の matrix と一致（2 箇所に別の真実を置かない）。
  for (const r of FINAL_MATRIX) {
    check(`D6 STATE に ${r.kind} の最終 status 行がある`,
      new RegExp(`\\|\\s*\`${r.kind}\`\\s*\\|`).test(state), r.kind);
  }
}

async function main(): Promise<void> {
  console.log('[exam-spine-final-closure] Exam Spine 内部設計の最終状態');
  s1Matrix();
  s2Consumers();
  await s3Architecture();
  s4Containment();
  s5Invariants();
  s6Docs();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-final-closure] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-final-closure] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-final-closure] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-final-closure] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-final-closure] PASS');
}
void main();
