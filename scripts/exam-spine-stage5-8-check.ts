// Exam Spine — Stage 5.8 essay convergence（G2）。
//
// ★ 本 Stage の結論は「essay を READY にする」ことではない ★
//   E-S27 の `workspace->reviews` 残余を out-of-band で解消した上で、
//   transport / semantics / block を **独立に**判定する。
//   本 script は次の 3 つを別々に pin する。
//
//     1. E-S27 projection  = SAME_PROJECTION_PROVEN
//        `workspace->reviews` は `EssayWorkspace.reviews` そのものである
//        （writer が EssayWorkspace を jsonb へ丸ごと書くため、構成上そうなる）。
//
//     2. transport         = NOT_READY（E-S52）
//        server は `updated_at DESC` で read window を選ぶが、`updated_at` は
//        **DB trigger / mirror 書込時刻**であって device の `workspace.updatedAt`
//        ではない。backfill は LS の updatedAt DESC 順に逐次 upsert するため、
//        DB の updated_at は device の recency と **逆順**になる。
//        したがって device は server と同じ N 件を選べない。
//
//     3. semantics         = DIFFERENT_SEMANTICS（E-S53）
//        legacy Tutor の小論文材料は localStorage `essayPracticeReview`
//        （SavedReview 単数）であり、canonical が読む `essayWorkspaces` /
//        `essay_workspaces` とは **別 store**である。前者に mirror は存在しない。
//
// ★ 本 Stage で **成立してはいけない**こと ★
//   essay の claim wiring / canonical block / production 到達。§5 で検査する。

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.8] 外部通信: ${String(args[0])}`);
}) as typeof realFetch;

import type { EssayWorkspace, ReviewEntry } from '@/types/essay';
import type { BasicInfo } from '@/types/basicInfo';
import { buildTutorDeviceClaimEntries } from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import {
  deviceEssayView,
  deviceEssayRow,
  deviceEssayItemView,
  selectDeviceSyncWindow,
} from '@/lib/examSpine/sync/adapters/deviceViews';
import { essaySyncView, examSyncObservation, ESSAY_REVIEW_CONTENT_FIELDS } from '@/lib/examSpine/sync/adapters/views';
import { mapEssayRow } from '@/lib/examSpine/read/rowMappers';
import { EXAM_READ_FIELD_LIMITS } from '@/lib/examSpine/read/readSources';
import { serializeDeviceClaim } from '@/lib/examSpine/sync/claim/serialize';
import { EXAM_DEVICE_CLAIM_MAX_BYTES } from '@/lib/examSpine/sync/claim/types';
import { EXAM_READ_CAPS, isExamCappedSourceKind } from '@/lib/examSpine/read/types';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from '@/lib/examSpine/blocks/registry';
import { EXAM_SYNC_ADAPTER_CONTRACTS,
  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED } from '@/lib/examSpine/sync/adapters/registry';
import { isExamSyncRuntimeBlocked } from '@/lib/examSpine/sync/enable';
import { sourcesForPurpose } from '@/lib/examSpine/purpose';
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

const CAP = EXAM_READ_CAPS.essay;
const L = EXAM_READ_FIELD_LIMITS;
const BODY = 'ESSAY_BODY_SECRET_TEXT';

function review(n: number, over: Record<string, unknown> = {}): ReviewEntry {
  return {
    totalScore: 60 + n,
    verdict: `判定${n}`,
    breakdown: [{ label: '論理構造', score: 3 }],
    improvement: `改善${n}`,
    goodPoints: [`良い点${n}`],
    weakPoints: [`弱点${n}`],
    createdAt: `2026-03-${String((n % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    essayBodySnapshot: `${BODY}-${n}`,
    ...over,
  } as unknown as ReviewEntry;
}

function ws(n: number, over: Partial<EssayWorkspace> = {}): EssayWorkspace {
  return {
    id: `ws-${String(n).padStart(2, '0')}`,
    createdAt: `2026-01-${String((n % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-06-${String((n % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    target: { university: 'A大学', faculty: '法学部', department: '法律学科', examType: '総合型' },
    theme: { text: 'テーマ', type: 't', source: 'admission_policy', reason: 'r' },
    mini: { conclusion: 'c', reasonOne: 'r1', reasonTwo: 'r2' },
    body: BODY,
    reviews: [review(n)],
    improvementInProgress: null,
    sparring: null,
    ...over,
  } as EssayWorkspace;
}

function fp(view: unknown): string {
  return examSyncObservation({ kind: 'essay', source: 'server_mirror', view }).fingerprint;
}

/**
 * server の canonical row を **writer の構成どおり**に作る。
 *
 * ★ ここが E-S27 の out-of-band 証明の核 ★
 *   `lib/supabase/essayWorkspaces.ts` は `workspace`（EssayWorkspace そのもの）を
 *   jsonb column へ丸ごと渡す。したがって `workspace->reviews` は
 *   `EssayWorkspace.reviews` を JSON 往復しただけの値である。
 *   PostgREST の selector は sub-path の存在を schema 検証できないが、
 *   **書き手の構成**からは一意に決まる。ここではその構成を再現する。
 */
function canonicalRowFromWriter(w: EssayWorkspace): Record<string, unknown> {
  // writer: upsert({ user_id, local_workspace_id: workspace.id, workspace, created_at: workspace.createdAt })
  const jsonb = JSON.parse(JSON.stringify(w)) as Record<string, unknown>;
  return {
    id: `db-${w.id}`,
    local_workspace_id: w.id,
    // essayQuery の selector `reviews:workspace->reviews` が返す値
    reviews: jsonb.reviews,
    created_at: w.createdAt,
    // ★ trigger / DEFAULT now() が決める。device の updatedAt ではない。
    updated_at: '(server-assigned)',
  };
}

// ══════════════════════════════════════════════════════════════════
// 1. Authority
// ══════════════════════════════════════════════════════════════════
function s1Authority(): void {
  console.log('\n1. Authority');
  const q = Q.essayQuery('00000000-0000-4000-8000-000000000000');
  eq('A1 table', q.table, 'essay_workspaces');
  eq('A1 mode は many', q.mode, 'many');
  eq('A1 limit は cap+1', q.limit, CAP + 1);
  eq('A1 cap は 5（勝手に変えない）', CAP, 5);
  check('A1 E-S27 selector', q.columns.includes('reviews:workspace->reviews'), q.columns.join(','));
  check('A1 workspace を丸ごと読まない', !q.columns.includes('workspace'));
  check('A1 local_workspace_id を読む（device と共有される安定 id）',
    q.columns.includes('local_workspace_id'));
  eq('A1 capped(history) kind', isExamCappedSourceKind('essay'), true);
  check('A1 tutor purpose は essay を許可', sourcesForPurpose('tutor').includes('essay'));
  check('A1 essay_chat purpose は essay を許可しない',
    !sourcesForPurpose('essay_chat').includes('essay'));

  // ★ ordering の authority ★ essay は created_at ではなく updated_at 主キー。
  eq('A1 ordering は updated_at 主（device が持たない列）',
    q.order.map((o) => `${o.column}:${o.ascending ? 'asc' : 'desc'}`),
    ['updated_at:desc', 'created_at:desc', 'id:desc']);

  // registry の宣言と実装の整合
  const c = EXAM_SYNC_ADAPTER_CONTRACTS.essay;
  eq('A1 authority 宣言', c.authority, 'device_canonical_mirrored');
  check('A1 updatedAt は content から除外されている（trigger 上書き）',
    c.excludedFields.some((f) => f.field === 'updatedAt' && f.reason === 'trigger_overwritten'));

  // writer が jsonb を丸ごと書くこと（E-S27 証明の前提）を実ファイルで pin する。
  const writer = readFileSync(join(ROOT, 'lib/supabase/essayWorkspaces.ts'), 'utf8');
  check('A1 writer は workspace を丸ごと jsonb へ書く',
    /upsert\(\s*\{[\s\S]*?\bworkspace,/.test(writer));
  check('A1 writer は created_at に workspace.createdAt を入れる',
    writer.includes('created_at: workspace.createdAt'));
  check('A1 writer は updated_at を送らない（trigger 任せ）',
    !/updated_at:/.test(writer.slice(writer.indexOf('upsert('), writer.indexOf('upsert(') + 400)));
}

// ══════════════════════════════════════════════════════════════════
// 2. E-S27 projection — SAME_PROJECTION_PROVEN
// ══════════════════════════════════════════════════════════════════
function s2Projection(): void {
  console.log('\n2. E-S27 projection');

  const w = ws(1, { reviews: [review(1), review(2), review(3)] });

  // device 側 row（deviceEssayRow）と canonical 側 row（writer 構成）の
  // `reviews` が **同一値**であること = sub-path が同じ集合を指すこと。
  const dRow = deviceEssayRow(w);
  const cRow = canonicalRowFromWriter(w);
  eq('P1 sub-path == parent（device row の reviews と一致）', cRow.reviews, dRow.reviews);
  eq('P1 sub-path == EssayWorkspace.reviews', cRow.reviews, JSON.parse(JSON.stringify(w.reviews)));

  // 同じ mapper を通れば同じ view / 同じ fingerprint になる。
  const dView = deviceEssayItemView(w);
  const cMapped = mapEssayRow(cRow, L);
  check('P1 canonical row が mapper を通る', cMapped !== null);
  check('P1 device view が成立', dView.ok);
  if (dView.ok && cMapped) {
    const cView = essaySyncView(cMapped);
    eq('P2 device view == canonical view', dView.view, cView);
    eq('P2 fingerprint 一致', fp(dView.view), fp(cView));
  }

  // ★ false MATCH 防止 ★ 中身が違えば必ず割れる。
  const other = ws(1, { reviews: [review(1), review(2), review(99)] });
  const oView = deviceEssayItemView(other);
  check('P3 内容が違えば fingerprint も違う（false MATCH ガード）',
    oView.ok && dView.ok && fp(oView.view) !== fp(dView.view));

  // ★ false EMPTY 防止 ★ reviews 0 件と workspace 不在を同一視しない。
  const empty = deviceEssayItemView(ws(1, { reviews: [] }));
  check('P3 reviews 0 件でも view は成立する（空 = 不在ではない）', empty.ok);
  check('P3 reviews 0 件は非空 workspace と別 fingerprint',
    empty.ok && dView.ok && fp(empty.view) !== fp(dView.view));

  // 位置反転 / cap / reviewCount は mapper の責務（device で再実装しない）
  const many = Array.from({ length: L.recordItems + 3 }, (_, i) => review(i + 1));
  const capped = deviceEssayItemView(ws(1, { reviews: many }));
  if (capped.ok) {
    const v = capped.view as Record<string, unknown>;
    eq('P4 reviews は recordItems 件で cap', (v.reviews as unknown[]).length, L.recordItems);
    eq('P4 reviewCount は cap 前の件数', v.reviewCount, many.length);
    // append-only 配列の **末尾が最新** → 反転して新しい順
    const first = (v.reviews as Record<string, unknown>[])[0];
    eq('P4 先頭は最新 review', first.verdict, `判定${many.length}`);
  }

  // malformed / missing の fail 挙動（throw しない）
  check('P5 reviews が壊れた JSON 文字列でも throw しない',
    mapEssayRow({ id: null, local_workspace_id: 'x', reviews: '{ not json', created_at: null, updated_at: null }, L) !== null);
  eq('P5 壊れた reviews は空配列に倒れる',
    (mapEssayRow({ id: null, local_workspace_id: 'x', reviews: '{ not json', created_at: null, updated_at: null }, L) as { reviews: unknown[] }).reviews.length, 0);
  check('P5 reviews 欠落でも throw しない',
    mapEssayRow({ id: null, local_workspace_id: 'x', created_at: null, updated_at: null }, L) !== null);
  check('P5 row が非 object なら null', mapEssayRow('nope', L) === null);

  // privacy: 本文が 1 文字も view に出ない
  const serialized = JSON.stringify(dView.ok ? dView.view : {});
  check('P6 view に essay 本文が載らない', !serialized.includes(BODY), serialized.slice(0, 120));
  check('P6 view に essayBodySnapshot key が無い', !serialized.includes('essayBodySnapshot'));
  check('P6 view に breakdown が無い', !serialized.includes('breakdown'));
  eq('P6 review content field 宣言と実 view の key 集合が一致',
    dView.ok ? Object.keys(((dView.view as Record<string, unknown>).reviews as Record<string, unknown>[])[0]).sort() : [],
    [...ESSAY_REVIEW_CONTENT_FIELDS].sort());
}

// ══════════════════════════════════════════════════════════════════
// 3. Window / ordering audit — E-S52（transport NOT_READY の根拠）
// ══════════════════════════════════════════════════════════════════
function s3Window(): void {
  console.log('\n3. Window / ordering');

  // device の LS は updatedAt DESC（applyLruCap）で並ぶ。最大 10 件。
  const N = 8;
  const deviceOrder = Array.from({ length: N }, (_, i) => ws(N - i, {
    // updatedAt は新しい順（index 0 が最新）
    updatedAt: `2026-06-${String(N - i).padStart(2, '0')}T00:00:00.000Z`,
    createdAt: `2026-01-${String(N - i).padStart(2, '0')}T00:00:00.000Z`,
  }));
  eq('W0 device は updatedAt DESC で並ぶ', deviceOrder[0].id, `ws-0${N}`);

  // ★ backfill の再現 ★
  //   backfillEssayWorkspacesOnce は loadEssayWorkspaces() の順（updatedAt DESC）で
  //   逐次 upsert する。各 INSERT の updated_at は DEFAULT now() なので
  //   **反復順に増加**する。つまり device の新しいものほど updated_at が小さい。
  const backfilled = deviceOrder.map((w, i) => ({
    w, dbUpdatedAt: `2026-07-01T00:00:${String(i).padStart(2, '0')}.000Z`,
  }));

  // server: ORDER BY updated_at DESC → cap+1 → applyCap
  const serverWindow = [...backfilled]
    .sort((a, b) => (a.dbUpdatedAt < b.dbUpdatedAt ? 1 : -1))
    .slice(0, CAP)
    .map((e) => e.w.id);

  // device が「自分の recency」で選ぶなら
  const deviceWindow = selectDeviceSyncWindow(deviceOrder, CAP, (w) => w.updatedAt).map((w) => w.id);

  check('W1 backfill 後、server window と device window が一致しない',
    JSON.stringify(serverWindow) !== JSON.stringify(deviceWindow),
    `server=${serverWindow.join(',')} device=${deviceWindow.join(',')}`);

  // ★ 逆順であることを明示的に pin する（tie-break の揺らぎではなく構造的反転）★
  const deviceOldest = [...deviceOrder]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
    .slice(0, CAP)
    .map((w) => w.id)
    .sort();
  eq('W1 server window は device の「最も古い CAP 件」と一致する（完全反転）',
    [...serverWindow].sort(), deviceOldest);

  // 現行実装は window を掛けていない（全件 hash）→ 件数からして割れる
  const all = deviceEssayView(deviceOrder);
  check('W2 現行 deviceEssayView は window を掛けない（全件 hash）', all.ok);
  if (all.ok) {
    const items = all.view as unknown[];
    check('W2 view は item 配列（listSyncView）', Array.isArray(items));
    eq('W2 device は CAP を超える件数を hash している（cap 未適用の証拠）', items.length, N);
  }
  const src = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export function deviceEssayView'));
  check('W2 deviceEssayView に selectDeviceSyncWindow が無いことを pin（E-S52）',
    !fn.slice(0, 300).includes('selectDeviceSyncWindow'));

  // ★ CAP 以下なら両者は必ず一致する（transport が成立する境界）★
  for (const n of [0, 1, CAP]) {
    const subset = deviceOrder.slice(0, n);
    const sWindow = [...backfilled].slice(0, n)
      .sort((a, b) => (a.dbUpdatedAt < b.dbUpdatedAt ? 1 : -1))
      .slice(0, CAP).map((e) => e.w.id).sort();
    const dWindow = selectDeviceSyncWindow(subset, CAP, (w) => w.updatedAt).map((w) => w.id).sort();
    eq(`W3 件数 ${n}（<= CAP）なら window は一致`, dWindow, sWindow);
  }

  // CAP+1 が境界であることを明示
  const nPlus = deviceOrder.slice(0, CAP + 1);
  const sPlus = [...backfilled].slice(0, CAP + 1)
    .sort((a, b) => (a.dbUpdatedAt < b.dbUpdatedAt ? 1 : -1))
    .slice(0, CAP).map((e) => e.w.id).sort();
  const dPlus = selectDeviceSyncWindow(nPlus, CAP, (w) => w.updatedAt).map((w) => w.id).sort();
  check('W3 CAP+1 件で window が割れ始める', JSON.stringify(dPlus) !== JSON.stringify(sPlus),
    `device=${dPlus.join(',')} server=${sPlus.join(',')}`);

  // 同一 updatedAt の tie（device view は id を持たないため解けない）
  const tie = [ws(1, { updatedAt: 'T' }), ws(2, { updatedAt: 'T' })];
  const t1 = deviceEssayView(tie);
  const t2 = deviceEssayView([tie[1], tie[0]]);
  check('W4 device 配列順は fingerprint に影響しない（sortSyncItems）',
    t1.ok && t2.ok && fp(t1.view) === fp(t2.view));
}

// ══════════════════════════════════════════════════════════════════
// 4. Legacy Tutor semantics — E-S53（DIFFERENT_SEMANTICS）
// ══════════════════════════════════════════════════════════════════
function s4Semantics(): void {
  console.log('\n4. Legacy semantics');

  const page = readFileSync(join(ROOT, 'app/tutor/page.tsx'), 'utf8');
  const practice = readFileSync(join(ROOT, 'lib/essayPracticeStorage.ts'), 'utf8');
  const wsStore = readFileSync(join(ROOT, 'lib/essayWorkspaceStorage.ts'), 'utf8');
  const builder = readFileSync(join(ROOT, 'lib/contextBuilders/tutorStudentContext.ts'), 'utf8');

  // legacy Tutor が prompt に出している小論文材料の出所
  const idx = page.indexOf('const essayReviewLatest');
  check('S1 client は essayReviewLatest を組み立てる', idx !== -1);
  const win = page.slice(idx, idx + 400);
  check('S1 その材料は loadReviewResult() 由来', win.includes('loadReviewResult()'));
  check('S1 loadReviewResult は essayPracticeReview を読む',
    practice.includes("REVIEW_KEY = 'essayPracticeReview'") && practice.includes('safeGetStorage<SavedReview | null>(REVIEW_KEY'));
  check('S1 canonical 側の device store は essayWorkspaces',
    wsStore.includes("ESSAY_WORKSPACES_KEY = 'essayWorkspaces'"));

  // ★ 別 store であることが本 Stage の semantic 結論 ★
  // ★ 実ソースから key を読み出して比較する（定数を script 内に書き写して自明比較にしない）★
  const legacyKey = /REVIEW_KEY = '([^']+)'/.exec(practice)?.[1] ?? '';
  const canonicalKey = /ESSAY_WORKSPACES_KEY = '([^']+)'/.exec(wsStore)?.[1] ?? '';
  check('S2 legacy key を読めた', legacyKey !== '', legacyKey);
  check('S2 canonical key を読めた', canonicalKey !== '', canonicalKey);
  check('S2 legacy store と canonical store は別 key', legacyKey !== canonicalKey,
    `legacy=${legacyKey} canonical=${canonicalKey}`);
  check('S2 essayPracticeReview に Supabase mirror が存在しない',
    !readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8').includes('essayPracticeReview'));
  check('S2 registry の canonicalSource は essayWorkspaces のみ',
    EXAM_SYNC_ADAPTER_CONTRACTS.essay.canonicalSource.includes('essayWorkspaces')
    && !EXAM_SYNC_ADAPTER_CONTRACTS.essay.canonicalSource.includes('essayPracticeReview'));

  // legacy の semantic unit（weakPoints の先頭 1 件・60 字 truncate）
  check('S3 legacy は weakPoints の先頭 1 件のみ使う',
    /function buildEssayWeaknessLine[\s\S]*?toStringArray\(rec\.weakPoints\)[\s\S]*?\.slice\(0, 1\)/.test(builder));
  check('S3 truncate は MAX_REVIEW_WEAKNESS_LENGTH=60',
    builder.includes('const MAX_REVIEW_WEAKNESS_LENGTH = 60'));
  check('S3 prompt 行の見出しは「小論文添削の直近の課題」',
    builder.includes("label: '小論文添削の直近の課題'"));

  // ★ 再現不能性の具体例 ★
  //   Phase 2（/essay/structure）は workspaces にだけ書き、essayPracticeReview を更新しない。
  const body2 = readFileSync(join(ROOT, 'app/essay/structure/[wid]/body/page.tsx'), 'utf8');
  check('S4 Phase 2 経路は essayPracticeReview を書かない',
    !body2.includes('saveReviewResult('));
  const practicePage = readFileSync(join(ROOT, 'app/essay-practice/page.tsx'), 'utf8');
  check('S4 Phase 1 経路のみが両方へ dual-write する',
    practicePage.includes('saveReviewResult(') && practicePage.includes('persistReviewToWorkspace('));
  check('S4 dual-write は best-effort（失敗しても legacy だけ進む）',
    /catch \(e\) \{[\s\S]{0,200}dual-write to essayWorkspaces failed/.test(practicePage));

  // → canonical の最新 review と legacy の singleton は独立に進む
  const canonicalLatest = deviceEssayItemView(ws(1, { reviews: [review(1), review(2)] }));
  const legacySingleton = { weakPoints: ['弱点1'] }; // Phase 1 時点で固定された値
  check('S5 canonical 最新 review と legacy singleton は別値になり得る',
    canonicalLatest.ok
    && JSON.stringify((canonicalLatest.view as Record<string, unknown>).reviews).includes('弱点2')
    && legacySingleton.weakPoints[0] === '弱点1');

  // LRU eviction は DB に伝播しない = legacy だけが持つ材料も存在し得る
  check('S6 上り mirror only（eviction / delete は伝播しない）',
    readFileSync(join(ROOT, 'lib/repository/essayWorkspaceRepository.ts'), 'utf8')
      .includes('上り mirror only'));
}

// ══════════════════════════════════════════════════════════════════
// 5. Consumer invariance / boundaries（成立してはいけないこと）
// ══════════════════════════════════════════════════════════════════
function s5Invariants(): void {
  console.log('\n5. Invariants');

  const basic = { name: 'x', grade: '高3' } as unknown as BasicInfo;
  const entries = buildTutorDeviceClaimEntries(basic);
  check('I1 essay は claim entry に載らない（未配線）',
    !entries.some((e) => e.kind === 'essay'), entries.map((e) => e.kind).join(','));
  eq('I1 basicInfo のみなら claim は 1 kind', entries.length, 1);

  // 6 kind 全部を渡しても essay は増えない
  const full = buildTutorDeviceClaimEntries(basic, null, null, null, null, null);
  check('I1 essay を渡す引数が存在しない', full.every((e) => e.kind !== 'essay'));

  // header bound
  const claimStr = serializeDeviceClaim(entries);
  check('I2 claim header は上限内',
    claimStr !== null && Buffer.byteLength(claimStr, 'utf8') <= EXAM_DEVICE_CLAIM_MAX_BYTES,
    `${claimStr ? Buffer.byteLength(claimStr, 'utf8') : 0}/${EXAM_DEVICE_CLAIM_MAX_BYTES}`);

  // ★ header は履歴件数に比例しない（essay を将来載せる場合の前提）★
  const small = fp(deviceEssayView([ws(1)]).ok ? (deviceEssayView([ws(1)]) as { view: unknown }).view : {});
  const huge = deviceEssayView(Array.from({ length: 200 }, (_, i) => ws(i + 1)));
  check('I2 200 件でも device token は固定長 hash',
    huge.ok && fp(huge.view).length === small.length, `${huge.ok ? fp(huge.view).length : -1} vs ${small.length}`);

  // canonical block が存在しない
  const essayBlocks = Object.values(EXAM_CONTEXT_BLOCK_REGISTRY)
    .filter((b) => (b as { sourceKind?: string }).sourceKind === 'essay');
  eq('I3 sourceKind=essay の canonical block は存在しない', essayBlocks.length, 0);

  // shadow は essay を「canonical block 無し」として扱ったまま
  const cmp = readFileSync(join(ROOT, 'lib/examSpine/context/shadow/compareTutor.ts'), 'utf8');
  const eIdx = cmp.indexOf("field: 'essay.reviewLatest'");
  check('I4 shadow に essay 行がある', eIdx !== -1);
  const eWin = cmp.slice(eIdx, eIdx + 220);
  check('I4 shadow の essay は canonical: null のまま', eWin.includes('canonical: null'));
  check('I4 shadow の essay は no_canonical_block', eWin.includes("omitted: 'no_canonical_block'"));

  // production consumer が変わっていない
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  check('I5 legacy prompt は body.essayReviewLatest を使い続ける',
    route.includes('essayReviewLatest: body.essayReviewLatest ?? null'));
  // ★ canonical context は essay の prompt 材料にならない ★
  //
  // ★ S5-P11 retarget（不変条件は 1 つも弱めていない）★
  //   source 側は「section 構築 → shadow gate → canonical 組み立て」の **位置関係**を
  //   proxy にしていた。本 lineage では controlled consumer switch（E-S55 / E-S57）が
  //   prompt より前に canonical を必要とするため canonical の組み立てが前へ移り、
  //   さらに prompt 合成が composeTutorPrompt へ抽出済みで `iSection` が route に無い。
  //   位置は不変条件ではない。**不変条件は「essay の prompt 材料が body.* だけであり、
  //   canonical / shadow 由来の値が prompt 引数に入らないこと」**なので、そちらを直接見る。
  const composeSrc = readFileSync(join(ROOT, 'lib/tutor/composeTutorPrompt.ts'), 'utf8');
  const sectionCall = /const studentContext = buildTutorStudentContext\(\{([\s\S]*?)\n      \}\);/
    .exec(composeSrc);
  check('I5 prompt section の組み立てを特定できる', sectionCall !== null);
  if (sectionCall) {
    const args = sectionCall[1];
    // すべての field が body.* 由来（canonical / spine 由来が 1 つも無い）
    const nonBody = args
      .split('\n')
      .filter((l) => /:\s*\S/.test(l))
      .filter((l) => !/:\s*body\./.test(l));
    eq('I5 prompt section の材料は body.* だけ', nonBody.map((l) => l.trim()), []);
    check('I5 essay の材料も body 由来', /essayReviewLatest:\s*body\.essayReviewLatest/.test(args));
    for (const forbidden of ['canonical', 'spineContext', 'shadow', 'tutorActivitySlot', 'tutorBasicInfoSlot']) {
      check(`I5 prompt section の材料に ${forbidden} が無い`, !args.includes(forbidden));
    }
  }
  // 呼び出しは 1 箇所だけ（import は数えない）。
  const routeCode = route.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');
  const calls: number[] = [];
  for (let i = routeCode.indexOf('buildCanonicalExamContext('); i !== -1;
       i = routeCode.indexOf('buildCanonicalExamContext(', i + 1)) calls.push(i);
  eq('I5 canonical の呼び出しは 1 箇所', calls.length, 1);
  // ★ 位置ではなく **gate の内側であること** を見る（default deny / E-S11）★
  //   canonical は「slot 切替か shadow が ON のとき」以外は 1 本も組み立てられない。
  check('I5 canonical の組み立ては default-deny gate の内側',
    /if \([A-Za-z]*[Ss]lotSwitchEnabled \|\| shadowEnabled\) \{[\s\S]*?buildCanonicalExamContext\s*\(/
      .test(routeCode));
  check('I5 shadow gate が存在する',
    /const shadowEnabled = isExamSpineShadowEnabled\(/.test(routeCode));
  check('I5 shadow の出力は enum と件数のみ（本文を prompt へ戻さない）',
    route.includes('shadowOverall = comparison.overall')
    && route.includes('shadowMismatchCount = comparison.mismatchCount')
    && !/studentContextSection\s*=\s*[^;]*shadow/i.test(route));
  check('I5 route は essay の device store を読まない',
    !route.includes('essay_workspaces') && !route.includes('loadEssayWorkspaces'));

  // registry の blocker が残っている（out-of-band 済でも window が未解決）
  //
  // ★ source 実装は registry.ts の**ソース文字列**を
  //   /essay:\s*'[^']*runtime claim/ で見ていたが、これは blocker 文が
  //   1 行の single-quoted literal であることに依存する脆い anchor だった
  //   （canonical では複数行連結にしたため誤検出した）。
  //   宣言の **実値** と、それを読む decision layer の判定を直接見る。
  // ★ essay の device claim は配線しない（E-S52）★
  //   window parity が構造的に成立しない以上、claim を送ると 6〜10 件の user で
  //   永久 mismatch になる。claim kind 集合を実ソースから抽出して pin する
  //   （arity 非依存。後続 stage が引数を増やしても見逃さない）。
  const claimSrc = readFileSync(
    join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8');
  const fnIdx = claimSrc.indexOf('export function buildTutorDeviceClaimEntries(');
  check('I6 claim 組み立て関数を特定できる', fnIdx !== -1);
  const claimKinds = Array.from(
    claimSrc.slice(Math.max(fnIdx, 0)).matchAll(/entries\.push\(\{\s*kind:\s*'([a-z_]+)'/g),
  ).map((m) => m[1]).sort();
  check('I6 essay の claim は配線されていない（E-S52）', !claimKinds.includes('essay'));
  eq('I6 tutor の claim kind は 5.1-5.7 の 6 つのまま', claimKinds,
    ['activity', 'basic_info', 'diagnosis', 'interview_record',
     'self_analysis', 'statement_review']);

  const blockedReason = EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay;
  check('I6 essay の runtime blocker が残っている（claim / enable / canary 禁止）',
    typeof blockedReason === 'string' && blockedReason.includes('runtime claim'));
  check('I6 blocker は現 blocker（read window）を名指しする',
    (blockedReason ?? '').includes('read window'));
  check('I6 decision layer が構造的に veto する',
    isExamSyncRuntimeBlocked('essay'));
  //   禁止 kind の集合は essay のみ（他 kind が黙って増えない）。
  eq('I6 runtime block は essay のみ',
    Object.keys(EXAM_SYNC_RUNTIME_ENABLE_BLOCKED).sort(), ['essay']);
  //   ★ 宣言であって gate ではない ★ production は blocker を読まない。
  const blockerConsumers: string[] = [];
  const walkB = (dir: string): void => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walkB(rel); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (rel === 'lib/examSpine/sync/adapters/registry.ts') continue;
      if (rel === 'lib/examSpine/sync/enable.ts') continue;
      if (readFileSync(join(ROOT, rel), 'utf8').includes('EXAM_SYNC_RUNTIME_ENABLE_BLOCKED')) {
        blockerConsumers.push(rel);
      }
    }
  };
  for (const d of ['lib', 'app']) walkB(d);
  eq('I6 blocker を読むのは宣言元と pure decision layer だけ', blockerConsumers, []);
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.8] essay convergence（projection / transport / semantics を分離）');
  s1Authority();
  s2Projection();
  s3Window();
  s4Semantics();
  s5Invariants();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.8] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.8] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.8] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.8] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.8] PASS');
}
void main();
