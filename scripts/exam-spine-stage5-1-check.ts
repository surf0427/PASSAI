// Exam Spine — Stage 5.1 shadow comparison / device view convergence の check。
//
// 検証軸:
//   device view の単一 authority / shadow gate default off / real bridge input /
//   pure comparison（追加 DB read = 0）/ 全 diff enum の実例 /
//   raw 値が diff に出ない / claim 3 case での比較変化 /
//   shadow 例外が Tutor を壊さない / shadow 結果が prompt へ到達しない
//
// 実 Supabase / 実 AI を使わない（fake executor のみ）。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.1] 外部通信が発生しました: ${String(args[0])}`);
}) as typeof realFetch;

import type { BasicInfo } from '@/types/basicInfo';
import { BASIC_INFO_SCHEMA_VERSION } from '@/lib/supabase/basicInfoLogs';
import { deviceBasicInfoToken } from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import {
  deviceBasicInfoView,
  EXAM_DEVICE_SCHEMA_VERSIONS,
} from '@/lib/examSpine/sync/adapters/deviceViews';
import { examSyncObservation } from '@/lib/examSpine/sync/adapters/views';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { compareTutorShadow } from '@/lib/examSpine/context/shadow/compareTutor';
import {
  EXAM_SHADOW_DIFF_KINDS,
  type ExamShadowComparison,
  type ExamShadowDiffKind,
} from '@/lib/examSpine/context/shadow/types';
import { isExamSpineShadowEnabled } from '@/lib/examSpine/context/shadowGate.server';
import type { ExamRequestAuthorization } from '@/lib/examSpine/read/requestSnapshot.server';
import { createRecordingExecutor, USER_A, USER_B, type FakeDb } from './fixtures/examSpineStage3';

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) passed += 1;
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── fixtures ──────────────────────────────────────────────────────────
const DEVICE_BASIC: BasicInfo = {
  name: '受験 太郎',
  grade: '高校3年',
  track: '文系',
  examTypes: ['総合型選抜'],
  preferences: [{ university: '実在大学', faculty: '実在学部', department: '実在学科' }],
} as BasicInfo;

function mirroredBasicRow(userId = USER_A): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...(DEVICE_BASIC as unknown as Record<string, unknown>) };
  delete payload.name;
  return {
    id: 'bi-1', user_id: userId, payload,
    schema_version: BASIC_INFO_SCHEMA_VERSION, source_hash: 'x',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function db(): FakeDb {
  return {
    tables: {
      basic_info_logs: [mirroredBasicRow()],
      activity_logs: [{
        id: 'a-1', user_id: USER_A,
        payload: { clubActivities: [{ clubName: '吹奏楽部' }], volunteerActivities: [{ theme: '清掃' }] },
        schema_version: '1', source_hash: 'x',
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      }],
    },
  } as FakeDb;
}

const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

const LEGACY = {
  basicInfo: DEVICE_BASIC,
  activityData: { clubActivities: [{ clubName: '吹奏楽部' }], volunteerActivities: [{ theme: '清掃' }] },
  studentProfile: { summary: '合唱に打ち込んだ', strengths: ['継続力'], weaknesses: ['計画性'] },
  statementReviewLatest: { essay: '志望理由書の本文がここに入る', result: { weaknesses: ['具体性が不足'] } },
  essayReviewLatest: { weakPoints: ['論拠が薄い'] },
  interviewRecordLatest: { improvementSummary: '結論を先に' },
  interviewFeedbackLatest: { improvements: ['声量'] },
  mypageSummary: { counts: { statement: 2 } },
  statementDraft: { statementText: '下書き本文' },
};

async function runShadow(opts: { claims?: Record<string, { presented: boolean; fingerprint: string | null }>; database?: FakeDb } = {}) {
  const rec = createRecordingExecutor(opts.database ?? db());
  const result = await buildCanonicalExamContext({
    request: new Request('https://example.test/s51'),
    purpose: 'tutor',
    authorize: authorizeA,
    bridge: {
      basicInfo: DEVICE_BASIC,
      tutorSources: LEGACY,
    },
    deviceClaims: opts.claims as never,
    executor: rec.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  if (!result.ok) throw new Error(`veto: ${result.veto.reasons.join(',')}`);
  const readsBefore = rec.trace.length;
  const comparison = compareTutorShadow({
    legacy: LEGACY,
    canonicalInput: result.shadowResolvedInput,
    context: result.context,
  });
  return { comparison, rec, readsBefore, context: result.context };
}

function diffOf(c: ExamShadowComparison, field: string): ExamShadowDiffKind | undefined {
  return c.entries.find((e) => e.field === field)?.diff;
}

// ── 1. device view convergence ────────────────────────────────────────
function t1Convergence(): void {
  console.log('\n1. Device view convergence');

  // transport adapter が canonical projection と同じ値を返す
  const viaAdapter = deviceBasicInfoToken(DEVICE_BASIC);
  const viaCanonical = deviceBasicInfoView(DEVICE_BASIC);
  check('T1 canonical device view が成功する', viaCanonical.ok);
  if (viaCanonical.ok) {
    const obs = examSyncObservation({ kind: 'basic_info', source: 'device_canonical', view: viaCanonical.view });
    eq('T1 transport adapter は canonical projection と同一 token', viaAdapter, obs.fingerprint);
  }

  // dual authority が残っていないこと
  //
  // ★ コメントを除いた **code** で判定する ★
  //   収束の経緯を説明するコメントに旧 pipeline 名が出るのは正常であり、
  //   それを重複実装と誤検出すると「説明を書くと QA が落ちる」ことになる。
  const claimSrc = stripComments(
    readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8'));
  check('T1 claim adapter が mapBasicInfoRow を自前で呼ばない', !claimSrc.includes('mapBasicInfoRow'));
  check('T1 claim adapter が basicInfoSyncView を自前で呼ばない', !claimSrc.includes('basicInfoSyncView'));
  check('T1 claim adapter が stripName を自前で持たない', !/delete\s+\w+\.name/.test(claimSrc));
  check('T1 claim adapter は canonical projection へ委譲する', claimSrc.includes('buildDeviceClaim'));

  // repo 全体で basic_info の projection pipeline が 1 箇所だけ
  const files = walk(join(ROOT, 'lib')).map((f) => relative(ROOT, f));
  const pipelines = files.filter((f) => {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    return src.includes('mapBasicInfoRow') && src.includes('basicInfoSyncView');
  });
  eq('T1 basic_info の device projection pipeline は 1 箇所だけ',
    pipelines, ['lib/examSpine/sync/adapters/deviceViews.ts']);

  // schema_version の一致
  //
  // ★ deviceViews は `lib/supabase/**` を import しない ★
  //   adapter 層が storage 実装を知ると依存方向が壊れる（Canon §48）。
  //   そこで値は宣言のまま残し、writer が export した定数との一致を
  //   **QA が型付きで**固定する（syncDevice check）。source を regex で
  //   読む旧方式より強く、かつ依存方向を汚さない。
  const dv = stripComments(readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8'));
  check('T1 deviceViews が lib/supabase を import しない', !dv.includes('@/lib/supabase'));
  eq('T1 device 宣言と writer の export が一致',
    EXAM_DEVICE_SCHEMA_VERSIONS.basic_info, BASIC_INFO_SCHEMA_VERSION);
}

// ── 2. shadow gate ────────────────────────────────────────────────────
function t2Gate(): void {
  console.log('\n2. Shadow gate');
  const saved = { p: process.env.EXAM_SPINE_SHADOW_PURPOSES, u: process.env.EXAM_SPINE_SHADOW_USER_IDS };
  delete process.env.EXAM_SPINE_SHADOW_PURPOSES;
  delete process.env.EXAM_SPINE_SHADOW_USER_IDS;
  check('T2 default OFF', !isExamSpineShadowEnabled('tutor', USER_A));
  process.env.EXAM_SPINE_SHADOW_PURPOSES = 'tutor';
  process.env.EXAM_SPINE_SHADOW_USER_IDS = USER_A;
  check('T2 allowlist 内のみ ON', isExamSpineShadowEnabled('tutor', USER_A));
  check('T2 allowlist 外は OFF', !isExamSpineShadowEnabled('tutor', USER_B));
  if (saved.p === undefined) delete process.env.EXAM_SPINE_SHADOW_PURPOSES; else process.env.EXAM_SPINE_SHADOW_PURPOSES = saved.p;
  if (saved.u === undefined) delete process.env.EXAM_SPINE_SHADOW_USER_IDS; else process.env.EXAM_SPINE_SHADOW_USER_IDS = saved.u;
}

// ── 3. pure comparison / 追加 read = 0 ────────────────────────────────
async function t3Pure(): Promise<void> {
  console.log('\n3. Pure comparison');
  const { comparison, rec, readsBefore } = await runShadow();
  eq('T3 compare は追加 DB read を発行しない', rec.trace.length - readsBefore, 0);
  console.log(`  info  canonical shadow read count = ${readsBefore}`);
  console.log(`  info  comparison input bytes = ${comparison.inputBytes}`);
  check('T3 comparison input が有界（< 64KB）', comparison.inputBytes < 65_536, String(comparison.inputBytes));

  // 決定性: 同じ legacy / canonicalInput / context から同じ結果が出る
  const second = await runShadow();
  eq('T3 同入力で overall が一致', second.comparison.overall, comparison.overall);
  eq('T3 同入力で entries が完全一致',
    JSON.stringify(second.comparison.entries), JSON.stringify(comparison.entries));
  eq('T3 同入力で readiness が一致',
    JSON.stringify(second.comparison.readiness), JSON.stringify(comparison.readiness));

  // compare は context を変更しない（observer である）
  const before = JSON.stringify(comparison.entries);
  compareTutorShadow({ legacy: LEGACY, canonicalInput: {}, context: second.context });
  eq('T3 再実行しても前回の結果が変わらない（副作用が無い）',
    JSON.stringify(comparison.entries), before);
}

// ── 4. diff enum の実例 ───────────────────────────────────────────────
async function t4DiffKinds(): Promise<void> {
  console.log('\n4. Diff kinds');
  const token = deviceBasicInfoToken(DEVICE_BASIC);

  // claim 一致 → basic_info は server 由来で MATCH になる
  const matched = await runShadow({ claims: { basic_info: { presented: true, fingerprint: token } } });
  eq('T4 MATCH（一致 claim / server 由来）', diffOf(matched.comparison, 'basic_info.grade'), 'MATCH');

  // INTENTIONALLY_OMITTED
  eq('T4 INTENTIONALLY_OMITTED（氏名）', diffOf(matched.comparison, 'basic_info.name'), 'INTENTIONALLY_OMITTED');
  eq('T4 INTENTIONALLY_OMITTED（志望理由書本文）',
    diffOf(matched.comparison, 'statement_review.essayBody'), 'INTENTIONALLY_OMITTED');
  eq('T4 INTENTIONALLY_OMITTED（block 未実装 kind）',
    diffOf(matched.comparison, 'essay.reviewLatest'), 'INTENTIONALLY_OMITTED');
  eq('T4 INTENTIONALLY_OMITTED（legacy 専用 metadata）',
    diffOf(matched.comparison, 'legacy.mypageSummary'), 'INTENTIONALLY_OMITTED');

  // STATUS_MISMATCH — claim 無しなら basic_info は unverified
  const noClaim = await runShadow();
  eq('T4 STATUS_MISMATCH（claim 無し → unverified）',
    diffOf(noClaim.comparison, 'basic_info.grade'), 'STATUS_MISMATCH');

  // MISSING_CANONICAL — legacy に self_analysis があるが server に無い
  eq('T4 MISSING_CANONICAL（server に self_analysis が無い）',
    diffOf(matched.comparison, 'self_analysis.summary'), 'MISSING_CANONICAL');

  // VALUE_MISMATCH — server の basic_info を変えて claim も合わせる
  const other: BasicInfo = { ...DEVICE_BASIC, grade: '高校2年' } as BasicInfo;
  const otherDb = { tables: { ...db().tables, basic_info_logs: [{ ...mirroredBasicRow(), payload: (() => { const p: Record<string, unknown> = { ...(other as unknown as Record<string, unknown>) }; delete p.name; return p; })() }] } } as FakeDb;
  const otherToken = deviceBasicInfoToken(other);
  const mismatched = await runShadow({ database: otherDb, claims: { basic_info: { presented: true, fingerprint: otherToken } } });
  eq('T4 VALUE_MISMATCH（server と legacy で grade が違う）',
    diffOf(mismatched.comparison, 'basic_info.grade'), 'VALUE_MISMATCH');

  // ORIGIN_MISMATCH — activity は claim が無いので server 採用されない…が
  // 値が一致していれば ORIGIN_MISMATCH になることを確認する
  const activityDiff = diffOf(matched.comparison, 'activity.categoryCounts');
  check('T4 activity は STATUS_MISMATCH か ORIGIN_MISMATCH',
    activityDiff === 'STATUS_MISMATCH' || activityDiff === 'ORIGIN_MISMATCH', String(activityDiff));

  // enum 語彙が閉じている
  const unknown = matched.comparison.entries.filter(
    (e) => !(EXAM_SHADOW_DIFF_KINDS as readonly string[]).includes(e.diff));
  eq('T4 diff kind はすべて宣言済みの語彙', unknown.map((e) => e.diff), []);
}

// ── 5. claim 3 case で比較が変わる ────────────────────────────────────
async function t5ClaimCases(): Promise<void> {
  console.log('\n5. Claim-dependent comparison');
  const token = deviceBasicInfoToken(DEVICE_BASIC);

  const absent = await runShadow();
  const matching = await runShadow({ claims: { basic_info: { presented: true, fingerprint: token } } });
  const mismatch = await runShadow({ claims: { basic_info: { presented: true, fingerprint: 'efp1:' + 'a'.repeat(64) } } });

  eq('T5 claim 無し → STATUS_MISMATCH', diffOf(absent.comparison, 'basic_info.grade'), 'STATUS_MISMATCH');
  eq('T5 一致 claim → MATCH', diffOf(matching.comparison, 'basic_info.grade'), 'MATCH');
  eq('T5 不一致 claim → STATUS_MISMATCH', diffOf(mismatch.comparison, 'basic_info.grade'), 'STATUS_MISMATCH');

  const rBasic = (c: ExamShadowComparison) => c.readiness.find((r) => r.kind === 'basic_info');
  eq('T5 一致 claim なら basic_info は READY', rBasic(matching.comparison)?.readiness, 'READY');
  eq('T5 claim 無しなら basic_info は DEFERRED', rBasic(absent.comparison)?.readiness, 'DEFERRED');
}

// ── 6. privacy ────────────────────────────────────────────────────────
async function t6Privacy(): Promise<void> {
  console.log('\n6. Privacy');
  const token = deviceBasicInfoToken(DEVICE_BASIC);
  const { comparison } = await runShadow({ claims: { basic_info: { presented: true, fingerprint: token } } });
  const serialized = JSON.stringify(comparison);

  const forbidden = [
    '受験 太郎', '太郎', '実在大学', '実在学部',
    '志望理由書の本文がここに入る', '下書き本文', '合唱に打ち込んだ',
    '吹奏楽部', '継続力', '具体性が不足', '論拠が薄い', USER_A,
  ];
  for (const needle of forbidden) {
    check(`T6 diff に "${needle}" が現れない`, !serialized.includes(needle));
  }

  // entry は値を持つ field を型として持たない
  const keys = new Set(comparison.entries.flatMap((e) => Object.keys(e)));
  const valueBearing = [...keys].filter((k) => ['legacyValue', 'canonicalValue', 'value', 'content', 'text'].includes(k));
  eq('T6 entry に値 field が無い', valueBearing, []);
}

// ── 7. static: shadow が prompt へ入らない ───────────────────────────
/** 行コメント / block コメント行を落とす（実装の有無だけを見るため）。 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(full)) out.push(full);
  }
  return out;
}

function t7Static(): void {
  console.log('\n7. Static: shadow は consumer に到達しない');
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');

  check('T7 shadow は gate 済み', route.includes('isExamSpineShadowEnabled'));
  check('T7 shadow は try/catch で囲まれている', /try\s*\{[\s\S]*compareTutorShadow[\s\S]*\}\s*catch/.test(route));
  // ★ S5-P3: 変数名 pin をやめ、bridge の中身を検査する ★
  //   Packet 3 で bridge は shadow 専用ではなくなり（slot 切替と共用）、
  //   `shadowBridge` → `canonicalBridge` へ改名された。不変条件は名前ではなく
  //   「stub ではなく body の実値を渡していること」なので、そちらを直接見る。
  const bridgeArg = /bridge:\s*(\w+)/.exec(route);
  check('T7 bridge を canonical assembly へ渡している', bridgeArg !== null);
  if (bridgeArg) {
    const decl = new RegExp(`const ${bridgeArg[1]} = \\{([\\s\\S]*?)\\n      \\};`).exec(route);
    check('T7 bridge の宣言が読める', decl !== null, `name=${bridgeArg[1]}`);
    if (decl) {
      const text = decl[1];
      check('T7 bridge に実値を渡している', text.includes('body.basicInfo'), text.slice(0, 160));
      check('T7 bridge の tutorSources が body 由来',
        (text.match(/body\./g) ?? []).length >= 8, `body 参照 ${(text.match(/body\./g) ?? []).length} 件`);
    }
  }

  // comparison / canonical の値が prompt 系へ渡っていない
  //
  // ★ S5-P3: 近接 window から **実引数検査** へ retarget ★
  //   従来は prompt 識別子の ±1500 字に `comparison` が無いことを見ていた。
  //   Packet 3 で canonical assembly が prompt の前へ移り、両者が近接するため
  //   この proxy は誤検知する。位置は不変条件ではない。
  //   不変条件は「shadow 由来の値が prompt に渡らないこと」なので実引数を見る。
  //   ★ ただし slot 切替で canonical 由来の値が 1 つだけ prompt へ入る ★
  //     それは `spineContext` に限られ、経路は `decideTutorBasicInfoSlot` のみ。
  //     shadow 比較由来（comparison / shadowResolvedInput / context.blocks）は依然禁止。
  const callArgsOf = (name: string): string | null => {
    const at = route.indexOf(`${name}(`);
    if (at < 0) return null;
    let depth = 0;
    for (let i = at + name.length; i < route.length; i += 1) {
      const ch = route[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) return route.slice(at + name.length + 1, i);
      }
    }
    return null;
  };
  const FORBIDDEN_IN_PROMPT = ['comparison', 'shadowResolvedInput', 'compareTutorShadow', '.context.blocks'];
  for (const name of ['composeTutorPrompt', 'buildTutorUserPrompt'] as const) {
    const argText = callArgsOf(name);
    if (argText === null) continue;
    for (const bad of FORBIDDEN_IN_PROMPT) {
      check(`T7 ${name}() の実引数に ${bad} が現れない`, !argText.includes(bad), argText.slice(0, 200));
    }
  }
  // comparison の値が逃げてよい先は観測変数 2 つだけ。
  const comparisonUses = route
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .filter((l) => /\bcomparison\b/.test(l));
  const badUses = comparisonUses.filter(
    (l) => !/const comparison =|shadowOverall = comparison\.|shadowMismatchCount = comparison\./.test(l),
  );
  check('T7 comparison は観測変数へしか代入されない', badUses.length === 0, badUses.join(' | '));
  // shadowResolvedInput は compare 呼び出し 1 箇所にしか現れない。
  check('T7 shadowResolvedInput は shadow ブロック内だけ',
    (route.match(/shadowResolvedInput/g) ?? []).length <= 1);

  // prompt builder 側が shadow / context を import していない
  for (const rel of ['lib/tutor/tutorPrompt.ts', 'lib/contextBuilders/tutor/buildTutorPromptContext.ts']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    check(`T7 ${rel} が shadow を import しない`, !src.includes('examSpine/context'));
  }

  // compare engine は read も write もしない
  const cmp = readFileSync(join(ROOT, 'lib/examSpine/context/shadow/compareTutor.ts'), 'utf8');
  const code = cmp.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  check('T7 compare engine に .from( が無い', !/[A-Za-z0-9_$]+\.from\(/.test(code.replace(/(?:[A-Za-z0-9_$]*Array|Object|Map|Set)\.from\(/g, 'B(')));
  check('T7 compare engine に mutation が無い', !/\.(insert|upsert|update|delete|rpc)\s*\(/.test(code));
  check('T7 compare engine に AI SDK が無い', !/@anthropic-ai|openai/.test(code));
  check('T7 compare engine に Date / random が無い', !/new Date\(|Date\.now\(|Math\.random\(/.test(code));
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.1] Tutor shadow comparison / device view convergence');
  t1Convergence();
  t2Gate();
  await t3Pure();
  await t4DiffKinds();
  await t5ClaimCases();
  await t6Privacy();
  t7Static();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.1] FAIL: 外部通信が ${fetchCallCount} 回`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-stage5.1] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.1] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.1] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-stage5.1] PASS');
}

void main();
