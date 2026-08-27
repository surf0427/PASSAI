// Exam Spine — Stage 5.10 self_pr runtime block（Level C ruling の固定）。
//
// ★ 本 Stage の結論は「self_pr を READY にする」ことではない ★
//   ruling は次のとおりで、product semantics は **未解決のまま据え置く**。
//
//     SELF_PR_LEVEL          = C
//     SELF_PR_RUNTIME_SYNC   = BLOCKED
//     SELF_PR_CLAIM_WIRING   = DO_NOT_ENABLE
//     SELF_PR_TUTOR_EXPOSURE = NO_CHANGE
//     EXAM_READ_CAPS.self_pr = KEEP_CURRENT
//     DELETE_PROPAGATION     = KEEP_DISABLED
//
//   したがって本 script は **mismatch を消しにいかない**。
//   mismatch が「存在すること」と、それが `verified` に化けないことの両方を固定する。
//
// ★ Level C の根拠（E-S50 / essay とは別物）★
//   essay（E-S52）は backfill による updated_at の **完全反転**が根拠だが、
//   self_pr では起きない。`prToRow` が `updated_at: pr.updatedAt` を明示送信するため、
//   全件 INSERT で終わる backfill では device の recency がそのまま DB に入る。
//   self_pr が Level C なのは次の 4 点である。
//     (a) `deviceSelfPrView` は window 未適用で **全件**を hash する（server は上位 5 件）
//     (b) `selectDeviceSyncWindow` は created_at でしか選べないが server の第 1 キーは
//         updated_at。DO UPDATE 経路では trigger が now() で上書きする
//     (c) `dualWriteSelfPRsDelta` は propagateDelete=false 固定で削除が mirror に残る
//     (d) `deviceSelfPrRow` は id: null を置き、server の id tie-break を再現できない
//
// ★ 本 Stage で **成立してはいけない**こと ★
//   self_pr の claim wiring / canonical block / Tutor 露出 / prompt 変化。§7〜§9 で検査する。

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
// 外部通信を trap する（本 suite は決定論・network 0 本）。
// ★ 元の fetch を変数に残さない ★ 呼び戻さないので保持する理由が無く、
//   保持すると type 参照だけの未使用変数として lint に出る。
globalThis.fetch = ((...args: Parameters<typeof globalThis.fetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.10] 外部通信: ${String(args[0])}`);
}) as typeof globalThis.fetch;

import type { SelfPR } from '@/types/selfPR';
import type { BasicInfo } from '@/types/basicInfo';
import type { ExamSyncExternalVerdict } from '@/lib/examSpine/sync/verdict';
import type { ExamRequestAuthorization } from '@/lib/examSpine/read/requestSnapshot.server';
import type { ExamDeviceViewResult } from '@/lib/examSpine/sync/adapters/deviceViews';

import {
  deviceSelfPrView,
  deviceSelfPrRow,
  deviceSelfPrItemView,
  selectDeviceSyncWindow,
} from '@/lib/examSpine/sync/adapters/deviceViews';
import { buildDeviceClaim } from '@/lib/examSpine/sync/adapters/deviceSources';
import { selfPrItemView, examSyncObservation, listSyncView } from '@/lib/examSpine/sync/adapters/views';
import {
  EXAM_SYNC_ADAPTER_CONTRACTS,
  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED,
  EXAM_SYNC_SUPPORTED_KINDS,
} from '@/lib/examSpine/sync/adapters/registry';
import { isExamSyncRuntimeBlocked, examSyncUsability } from '@/lib/examSpine/sync/enable';
import { mapSelfPrRow } from '@/lib/examSpine/read/rowMappers';
import { EXAM_READ_FIELD_LIMITS } from '@/lib/examSpine/read/readSources';
import { EXAM_READ_CAPS } from '@/lib/examSpine/read/types';
import { EXAM_SOURCE_AUTHORITY, EXAM_SOURCE_TABLES } from '@/lib/examSpine/sourceData/types';
import { sourcesForPurpose, purposeAllowsSource, gateExamSourceKinds } from '@/lib/examSpine/purpose';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from '@/lib/examSpine/blocks/registry';
import { EXAM_CONTEXT_BLOCK_IDS } from '@/lib/examSpine/blocks/types';
import { EXAM_PURPOSE_PLANS } from '@/lib/examSpine/orchestrator/plan';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { serializeDeviceClaim } from '@/lib/examSpine/sync/claim/serialize';
import { buildTutorDeviceClaimEntries } from '@/lib/examSpine/sync/claim/deviceBasicInfo';
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

const CAP = EXAM_READ_CAPS.self_pr;
const L = EXAM_READ_FIELD_LIMITS;
const U = USER_A;
/** device 本文に置く canary。claim / header / telemetry に出てはいけない。 */
const BODY_CANARY = 'SELF_PR_BODY_CANARY_TEXT';

// ── fixture ───────────────────────────────────────────────────────────

function pr(n: number, over: Partial<SelfPR> = {}): SelfPR {
  const d = String(n).padStart(2, '0');
  return {
    id: `pr-${d}`,
    index: n,
    title: `自己PR${n}`,
    text: `${BODY_CANARY}-${n}`,
    latestResult: `講評${n}`,
    createdAt: `2026-03-${d}T00:00:00.000Z`,
    updatedAt: `2026-03-${d}T00:00:00.000Z`,
    seedInputHash: `seed-${n}`,
    ...over,
  };
}

/**
 * lib/supabase/selfPRs.ts:prToRow ＋ DB 既定値を再現した「mirror 上の行」。
 * ★ updated_at は INSERT 経路の値（= device 値）を既定にする ★
 *   DO UPDATE 経路の trigger 上書きは、それを試す fixture 側が明示的に渡す。
 */
function mirrorRowOf(p: SelfPR, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `db-uuid-${p.id}`,
    user_id: U,
    local_pr_id: p.id,
    pr_index: p.index,
    title: p.title ?? '',
    body: p.text,
    latest_result: p.latestResult,
    seed_input_hash: p.seedInputHash ?? null,
    created_at: p.createdAt ?? '2026-01-01T00:00:00.000Z',
    updated_at: p.updatedAt,
    metadata: {},
    ...over,
  };
}

/**
 * ★ 順序と cap を **実 query 定義から**導出する（ハードコードしない）★
 *   `selfPrQuery` の order / limit を書き換えたら、この helper 経由で
 *   すべての negative control が追随する。
 */
function serverWindow(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const q = Q.selfPrQuery(U);
  const sorted = [...rows].sort((a, b) => {
    for (const o of q.order) {
      const av = String(a[o.column] ?? '');
      const bv = String(b[o.column] ?? '');
      if (av === bv) continue;
      return (av < bv ? -1 : 1) * (o.ascending ? 1 : -1);
    }
    return 0;
  });
  // readSources.applyCap と同じ: cap+1 件取得して cap 件へ落とす。
  return sorted.slice(0, q.limit ?? sorted.length).slice(0, CAP);
}

function fp(view: unknown): string {
  return examSyncObservation({ kind: 'self_pr', source: 'server_mirror', view }).fingerprint;
}
function serverFp(rows: readonly Record<string, unknown>[]): string {
  const views = serverWindow(rows).map((r) => selfPrItemView(mapSelfPrRow(r, L)!));
  return fp(listSyncView(views, (x) => x));
}
function deviceFp(result: ExamDeviceViewResult): string | null {
  return result.ok ? fp(result.view) : null;
}
function localIdsOfServer(rows: readonly Record<string, unknown>[]): string[] {
  return serverWindow(rows).map((r) => String(r.local_pr_id)).sort();
}

// ── 1. Authority 再確認（§7 の実測 pin）────────────────────────────────

function s1Authority(): void {
  console.log('\n1. Authority');

  eq('A1 source class は device_canonical_mirrored',
    EXAM_SOURCE_AUTHORITY.self_pr, 'device_canonical_mirrored');
  eq('A1 registry table は self_prs のみ', EXAM_SOURCE_TABLES.self_pr, ['self_prs']);
  eq('A1 read cap は 5（KEEP_CURRENT）', CAP, 5);

  // device authority は localStorage 'selfPRs'（server ではない）。
  const storage = readFileSync(join(ROOT, 'lib/selfPRStorage.ts'), 'utf8');
  check('A1 device authority は localStorage の selfPRs key',
    /const STORAGE_KEY = 'selfPRs'/.test(storage));

  const q = Q.selfPrQuery(U);
  eq('A2 query limit は cap + 1（overflow 検出のため）', q.limit, CAP + 1);
  eq('A2 server ordering は updated_at DESC → created_at DESC → id DESC',
    q.order.map((o) => `${o.column}:${o.ascending ? 'asc' : 'desc'}`),
    ['updated_at:desc', 'created_at:desc', 'id:desc']);
  eq('A2 mode は many（history kind）', q.mode, 'many');
  eq('A2 table は self_prs', q.table, 'self_prs');

  // ★ device が window を持たないことを **ソースで**固定する ★
  //   fingerprint の一致/不一致では「window を掛けたが揃わない」と区別できない。
  const dv = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8');
  const fnIdx = dv.indexOf('export function deviceSelfPrView(');
  check('A3 deviceSelfPrView を特定できる', fnIdx !== -1);
  const body = dv.slice(fnIdx, dv.indexOf('\n}', fnIdx));
  check('A3 deviceSelfPrView は window 未適用（selectDeviceSyncWindow を呼ばない）',
    !body.includes('selectDeviceSyncWindow'));
  // 対照: window を持つ kind では実際に呼ばれている（この guard 自体が機能する証明）。
  const swIdx = dv.indexOf('export function deviceStatementReviewView(');
  check('A3 対照: statement_review は window を適用している（guard の正の対照）',
    dv.slice(swIdx, dv.indexOf('\n}', swIdx)).includes('selectDeviceSyncWindow'));

  // ★ selectDeviceSyncWindow が created_at でしか選べないこと（Level C の (b)）★
  const winIdx = dv.indexOf('export function selectDeviceSyncWindow');
  check('A4 window selector を特定できる', winIdx !== -1);
  const winSig = dv.slice(winIdx, dv.indexOf('{', dv.indexOf('): readonly T[]', winIdx)));
  check('A4 window selector の第 3 引数は createdAt 取り出し関数である',
    winSig.includes('createdAtOf') && winSig.includes('string | null | undefined'),
    winSig.replace(/\s+/g, ' ').slice(0, 160));
  //   server の第 1 ソートキーは updated_at なので、この selector では揃わない。
  check('A4 server の第 1 キー（updated_at）は window selector のキーと一致しない',
    q.order[0].column === 'updated_at');
  //   trigger の実在（DO UPDATE 経路で device の updatedAt が保たれない根拠）。
  const schema = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8');
  check('A4 self_prs_set_updated_at trigger が schema に実在する',
    schema.includes('self_prs_set_updated_at'));

  // delete 非伝播（Level C の (c)）
  const page = readFileSync(join(ROOT, 'app/self-pr/page.tsx'), 'utf8');
  check('A5 dualWriteSelfPRsDelta は propagateDelete: false 固定',
    page.includes('propagateDelete: false') && !page.includes('propagateDelete: true'));
  const repo = readFileSync(join(ROOT, 'lib/repository/selfPRRepository.ts'), 'utf8');
  check('A5 repository 既定も propagateDelete = false',
    /propagateDelete\s*=\s*false/.test(repo));

  // id tie-break 不能（Level C の (d)）
  eq('A6 deviceSelfPrRow は id: null を置く（server の id DESC を再現できない）',
    deviceSelfPrRow(pr(1)).id, null);

  // adapter contract は「possible」のまま（capability と runtime enable は別軸）
  eq('A7 adapter capability は possible のまま（contract は確定している）',
    EXAM_SYNC_ADAPTER_CONTRACTS.self_pr.capability, 'possible');
  eq('A7 adapter の order 分類は multiset', EXAM_SYNC_ADAPTER_CONTRACTS.self_pr.order, 'multiset');

  // Tutor purpose は self_pr を許可しない（§7 の最後の行）
  eq('A8 Tutor purpose は self_pr を許可しない', purposeAllowsSource('tutor', 'self_pr'), false);
}

// ── 2. P1 runtime blocked ─────────────────────────────────────────────

function s2RuntimeBlock(): void {
  console.log('\n2. P1 runtime blocked');

  check('P1 isExamSyncRuntimeBlocked("self_pr") === true', isExamSyncRuntimeBlocked('self_pr'));

  //   ★ 4 段 veto の 2 段目で落ちる ★ canary 許可 + verified でも usable にならない。
  eq('P1 canary 許可 + verified でも runtime_blocked で veto',
    examSyncUsability({ kind: 'self_pr', verdict: 'verified', canaryAllowed: true }),
    { usability: 'veto', reason: 'runtime_blocked' });

  //   verdict がどれでも runtime_blocked が優先する（理由が揺れない）。
  const verdicts: ExamSyncExternalVerdict[] = ['verified', 'mismatch', 'unclaimed', 'unreadable'];
  const wrong = verdicts.filter((v) =>
    examSyncUsability({ kind: 'self_pr', verdict: v, canaryAllowed: true }).reason !== 'runtime_blocked');
  eq('P1 verdict によらず理由は runtime_blocked', wrong, []);

  //   ★ J. blocker exactness ★ 禁止 kind の集合は正確に 2 つ。
  //     3 つ目が黙って増えない / self_pr が黙って消えない、を同時に固定する。
  eq('P1 runtime block は essay と self_pr のみ',
    Object.keys(EXAM_SYNC_RUNTIME_ENABLE_BLOCKED).sort(), ['essay', 'self_pr']);
  check('P1 essay の blocker は残っている（Stage 5.8 を巻き戻していない）',
    isExamSyncRuntimeBlocked('essay'));
  //   class 2（presentation / interview_ai）は blocker に載らない（E-S3 / E-S54）。
  for (const kind of ['presentation', 'interview_ai'] as const) {
    check(`P1 class 2 の ${kind} は blocker に載らない`,
      !Object.prototype.hasOwnProperty.call(EXAM_SYNC_RUNTIME_ENABLE_BLOCKED, kind));
  }

  const reason = EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.self_pr ?? '';
  check('P1 理由は E-S50 Level C を根拠にする', reason.includes('E-S50'));
  check('P1 理由は window 未適用を名指しする', reason.includes('window'));
  check('P1 理由は delete 非伝播を名指しする', reason.includes('propagateDelete'));
  check('P1 理由は runtime claim / enable / canary の禁止を述べる',
    reason.includes('runtime claim'));
  //   ★ essay の根拠を流用していない ★ 同じ Level C でも原因が違う。
  check('P1 essay 固有の根拠（完全反転 / backfill）をコピーしていない',
    !reason.includes('反転') && !reason.includes('backfill'));
  //   ★ 逆向きも固定 ★ essay の理由が self_pr のもので上書きされていない。
  const essayReason = EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay ?? '';
  check('P1 essay の理由は E-S52 のまま', essayReason.includes('E-S52'));
  check('P1 essay の理由に self_pr の根拠が混ざっていない',
    !essayReason.includes('propagateDelete'));

  //   ★ 宣言であって gate ではない ★ production は blocker を読まない。
  const consumers: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (rel === 'lib/examSpine/sync/adapters/registry.ts') continue;
      if (rel === 'lib/examSpine/sync/enable.ts') continue;
      if (readFileSync(join(ROOT, rel), 'utf8').includes('EXAM_SYNC_RUNTIME_ENABLE_BLOCKED')) consumers.push(rel);
    }
  };
  for (const d of ['lib', 'app']) walk(d);
  eq('P1 blocker を読むのは宣言元と pure decision layer だけ', consumers, []);
}

// ── 3. A/B baseline + empty（transport parity は壊さない）──────────────

function s3TransportParity(): void {
  console.log('\n3. A/B baseline + empty（runtime enable とは別軸）');

  // A: 1 / 2 / 5 件（safe range）は従来どおり parity が成立する。
  for (const n of [1, 2, CAP]) {
    const prs = Array.from({ length: n }, (_, i) => pr(i + 1));
    const rows = prs.map((p) => mirrorRowOf(p));
    eq(`A ${n} 件は device/server fingerprint が一致する`,
      deviceFp(deviceSelfPrView(prs)), serverFp(rows));
  }

  // device 配列順を入れ替えても fingerprint は不変（listSyncView が item 順に正規化）。
  const three = [pr(1), pr(2), pr(3)];
  eq('A device 配列順は fingerprint に影響しない',
    deviceFp(deviceSelfPrView(three)),
    deviceFp(deviceSelfPrView([...three].reverse())));

  // 既存 adapter の写像は writer と同形のまま（deviceSelfPrRow → mapSelfPrRow → view）。
  const p1 = pr(1);
  eq('A deviceSelfPrItemView は selfPrItemView(mapSelfPrRow(deviceSelfPrRow)) と同値',
    deviceSelfPrItemView(p1),
    { ok: true, view: selfPrItemView(mapSelfPrRow(deviceSelfPrRow(p1), L)!) });

  // B: absent は claimed ではなく empty（false-empty を verified にしない）。
  const emptyClaim = buildDeviceClaim('self_pr', { state: 'absent' });
  eq('B absent な self_pr の claim state は empty', emptyClaim.state, 'empty');
  //   ★ 空配列を absent へ倒すのは **token helper 側の責務**である ★
  //     buildDeviceClaim は present を受け取れば空配列でも claimed を作る（既存 contract）。
  //     既存 token helper（例: deviceSelfAnalysisToken）は length===0 を absent へ倒しており、
  //     self_pr にはその helper 自体が無い（§9 で不在を固定する）。
  const emptyListClaim = buildDeviceClaim('self_pr', { state: 'present', value: [] });
  eq('B present + 空配列は claimed（buildDeviceClaim の既存 contract）',
    emptyListClaim.state, 'claimed');
  check('B 空配列 claim の fingerprint は空リストの fingerprint と一致する',
    emptyListClaim.state === 'claimed'
      && emptyListClaim.observation.fingerprint === deviceFp(deviceSelfPrView([])));
  //   ★ 空でも runtime enable は開かない ★（P1 と連立）
  eq('B 空でも usability は runtime_blocked',
    examSyncUsability({ kind: 'self_pr', verdict: 'verified', canaryAllowed: true }).reason,
    'runtime_blocked');
}

// ── 4. C over-cap（C1）────────────────────────────────────────────────

function s4OverCap(): void {
  console.log('\n4. C over-cap（C1）');

  const prs = Array.from({ length: CAP + 1 }, (_, i) => pr(i + 1));
  const rows = prs.map((p) => mirrorRowOf(p));

  eq('C1 server の read window は cap 件に切られる', serverWindow(rows).length, CAP);
  eq('C1 device は全件を hash する（window 未適用）', prs.length, CAP + 1);

  // ★ mismatch を消しにいかない。存在することを固定する ★
  check('C1 cap 超過で device/server fingerprint は一致しない',
    deviceFp(deviceSelfPrView(prs)) !== serverFp(rows));

  // ★ それでも verified に化けない ★
  eq('C1 cap 超過でも usability は runtime_blocked（verified を主張しない）',
    examSyncUsability({ kind: 'self_pr', verdict: 'verified', canaryAllowed: true }),
    { usability: 'veto', reason: 'runtime_blocked' });

  // 近似 window を足しても揃わないこと（created_at 窓では server の選択と一致しない）。
  const approx = selectDeviceSyncWindow(prs, CAP, (p) => p.createdAt);
  const bumped = rows.map((r, i) =>
    // 最古の 1 件だけを「最近編集した」状態にする（updated_at のみ更新）。
    i === 0 ? { ...r, updated_at: '2026-12-31T00:00:00.000Z' } : r);
  check('C1 created_at 近似 window は server の updated_at 選択と一致しない',
    JSON.stringify(approx.map((p) => p.id).sort()) !== JSON.stringify(localIdsOfServer(bumped)));
}

// ── 5. D updated_at ordering mismatch（C2）────────────────────────────

function s5UpdatedOrder(): void {
  console.log('\n5. D updated-order mismatch（C2）');

  const prs = Array.from({ length: CAP + 1 }, (_, i) => pr(i + 1));
  const baseRows = prs.map((p) => mirrorRowOf(p));
  const beforeIds = localIdsOfServer(baseRows);

  // 「古い self_pr を編集する」= device は updatedAt を now へ、
  //   mirror は DO UPDATE 経路なので trigger が now() で上書きする。
  const editedDevice = prs.map((p, i) =>
    i === 0 ? { ...p, updatedAt: '2026-12-31T00:00:00.000Z', text: `${BODY_CANARY}-edited` } : p);
  const editedRows = baseRows.map((r, i) =>
    i === 0
      ? { ...r, body: `${BODY_CANARY}-edited`, updated_at: '2026-12-31T23:59:59.000Z' }
      : r);
  const afterIds = localIdsOfServer(editedRows);

  check('D 古い self_pr の編集で server の read window の中身が変わる',
    JSON.stringify(beforeIds) !== JSON.stringify(afterIds));
  check('D 編集された行が server window に入る', afterIds.includes('pr-01'));

  // device 側は全件なので「どれが最新か」を表現しない → 選択集合が一致しない。
  check('D device/server の fingerprint は一致しない',
    deviceFp(deviceSelfPrView(editedDevice)) !== serverFp(editedRows));

  // ★ trigger 上書きにより device の updatedAt と DB の updated_at は別値になる ★
  check('D device updatedAt と mirror updated_at は一致しない（trigger 上書き）',
    editedDevice[0].updatedAt !== String(editedRows[0].updated_at));

  eq('D ordering がずれても usability は runtime_blocked',
    examSyncUsability({ kind: 'self_pr', verdict: 'verified', canaryAllowed: true }).reason,
    'runtime_blocked');
}

// ── 6. E delete residue（C3）──────────────────────────────────────────

function s6DeleteResidue(): void {
  console.log('\n6. E delete residue（C3）');

  const all = [pr(1), pr(2), pr(3)];
  const mirror = all.map((p) => mirrorRowOf(p)); // mirror は削除前のまま
  const afterDelete = all.filter((p) => p.id !== 'pr-02'); // device から 1 件削除

  eq('E device は削除後 2 件', afterDelete.length, 2);
  eq('E mirror は削除が伝播せず 3 件のまま', serverWindow(mirror).length, 3);
  check('E 削除された PR が mirror 側の window に残っている',
    localIdsOfServer(mirror).includes('pr-02'));

  check('E delete 残存で device/server fingerprint は一致しない',
    deviceFp(deviceSelfPrView(afterDelete)) !== serverFp(mirror));

  eq('E delete 残存でも usability は runtime_blocked',
    examSyncUsability({ kind: 'self_pr', verdict: 'verified', canaryAllowed: true }),
    { usability: 'veto', reason: 'runtime_blocked' });

  // 極端形: device 全削除 → mirror が top-5 を独占する。
  const wipedFp = deviceFp(deviceSelfPrView([]));
  check('E device 全削除でも mirror の値が採用されることはない（fingerprint 不一致）',
    wipedFp !== serverFp(mirror));
}

// ── 7. F/G Tutor exposure（purpose denial + query 不発行）──────────────

const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function s7TutorDenial(): Promise<void> {
  console.log('\n7. F/G Tutor exposure');

  eq('F purposeAllowsSource("tutor","self_pr") === false',
    purposeAllowsSource('tutor', 'self_pr'), false);
  check('F tutor の sources に self_pr が無い',
    !sourcesForPurpose('tutor').includes('self_pr'));
  check('F essay_chat の sources にも self_pr が無い',
    !sourcesForPurpose('essay_chat').includes('self_pr'));
  //   gate は要求されても self_pr を denied 側へ落とす（default-deny の実挙動）。
  eq('F tutor で self_pr を要求しても gate が denied にする',
    gateExamSourceKinds('tutor', ['self_pr']), { allowed: [], denied: ['self_pr'] });
  //   ★ 対照 ★ self_pr を許可する purpose は実在する（gate が全落ちではない）。
  check('F 対照: self_pr purpose は self_pr を許可する（guard の正の対照）',
    purposeAllowsSource('self_pr', 'self_pr'));

  // ★ 宣言だけでなく、実際に query が発行されないことを recorder で見る ★
  for (const purpose of ['tutor', 'essay_chat'] as const) {
    const database = { tables: { self_prs: [mirrorRowOf(pr(1))] } } as unknown as FakeDb;
    const recorder = createRecordingExecutor(database);
    const r = await buildCanonicalExamContext({
      request: new Request(`https://example.test/s510/${purpose}`),
      purpose,
      authorize: authorizeA,
      bridge: {},
      executor: recorder.executor,
      projectionNow: '2026-01-01T00:00:00.000Z',
    });
    check(`G ${purpose}: context が組める`, r.ok);
    const selfPrQueries = recorder.trace.filter((t) => t.kind === 'self_pr');
    eq(`G ${purpose}: self_pr の query は 0 本`, selfPrQueries.length, 0);
    const selfPrTables = recorder.trace.filter((t) => (t as { table?: string }).table === 'self_prs');
    eq(`G ${purpose}: self_prs table を読まない`, selfPrTables.length, 0);
    if (r.ok) {
      // ★ provenance 表は全 kind を列挙する ★「載っていない」ではなく
      //   「purpose gate で拒否されたと記録されている」ことを固定する。
      const sp = r.context.sources.find((s) => s.kind === 'self_pr');
      check(`G ${purpose}: self_pr の provenance が存在する`, !!sp);
      eq(`G ${purpose}: self_pr は denied_by_purpose`, sp?.state, 'denied_by_purpose');
      eq(`G ${purpose}: self_pr の read は skipped`, sp?.readStatus, 'skipped');
      eq(`G ${purpose}: self_pr の contribution は none`, sp?.contribution, 'none');
      eq(`G ${purpose}: self_pr は block を 1 つも作らない`, sp?.blocks, []);
      eq(`G ${purpose}: self_pr の rowCount は 0`, sp?.rowCount, 0);
      eq(`G ${purpose}: self_pr の syncStatus は null（verification を試みない）`,
        sp?.syncStatus, null);
      // ★ 対照 ★ gate が全 kind を落としているわけではない（guard の正の対照）。
      const readKinds = recorder.trace.length;
      check(`G ${purpose}: 他 kind の query は発行されている（gate が全落ちではない）`,
        readKinds > 0, `trace=${readKinds}`);
    }
  }
}

// ── 8. I prompt / AI-visible 不変 ─────────────────────────────────────

function s8PromptEquivalence(): void {
  console.log('\n8. I prompt equivalence');

  const REG = EXAM_CONTEXT_BLOCK_REGISTRY as unknown as
    Record<string, { sourceKind?: string; provenance?: string; legacySource?: string }>;
  const kindBlocks = (EXAM_CONTEXT_BLOCK_IDS as readonly string[])
    .filter((id) => REG[id]?.sourceKind === 'self_pr');
  eq('I sourceKind=self_pr の canonical block は 0 件（Stage 5.10 でも作らない）', kindBlocks, []);
  //   tutor plan にも self_pr 由来の block は載らない。
  const tutorBlockIds = EXAM_PURPOSE_PLANS.tutor.blocks.map((b) => b.id);
  check('I tutor plan に self_pr 由来の block は無い',
    tutorBlockIds.every((id) => REG[id]?.sourceKind !== 'self_pr'), tutorBlockIds.join(','));

  // ★ §13 feature input と spine source を混同しない ★
  //   self_pr_body は /api/reason の **feature 入力**であって self_prs read ではない。
  const bodyBlock = REG.self_pr_body;
  check('I self_pr_body block は存在する（既存 feature を削除していない）', !!bodyBlock);
  eq('I self_pr_body の provenance は user_authored（feature 入力）',
    bodyBlock?.provenance, 'user_authored');
  check('I self_pr_body は self_prs table 由来ではない（sourceKind を持たない）',
    bodyBlock?.sourceKind === undefined);
  check('I self_pr_body の legacy 由来は buildReasonPrompt（/api/reason の inline）',
    (bodyBlock?.legacySource ?? '').includes('buildReasonPrompt'));

  // Tutor route が self_pr の device store / table を読まない。
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  check('I tutor route は self_prs table を読まない', !route.includes('self_prs'));
  check('I tutor route は loadSelfPRs を呼ばない', !route.includes('loadSelfPRs'));

  // Tutor client も self_pr 本文を送らない（body に self_pr 系 field を足していない）。
  const page = readFileSync(join(ROOT, 'app/tutor/page.tsx'), 'utf8');
  const bodyStart = page.indexOf('const requestBody = {');
  check('I tutor の requestBody literal を特定できる', bodyStart !== -1);
  const bodyLiteral = page.slice(bodyStart, page.indexOf('};', bodyStart));
  check('I tutor の requestBody に selfPR 系 field は無い',
    !/selfPR|self_pr/i.test(bodyLiteral), bodyLiteral.slice(0, 200));

  // legacy の buildTutorSelfPrContext は selfPRDraft 専用のまま（selfPRs を読み始めない）。
  const legacy = readFileSync(join(ROOT, 'lib/contextBuilders/tutor/buildTutorSelfPrContext.ts'), 'utf8');
  check('I buildTutorSelfPrContext は selfPRs 一覧を読まない',
    !legacy.includes('loadSelfPRs') && !legacy.includes('self_prs'));

  // ★ characterization fixture の全件が残っていること ★
  //   prompt の byte 同値そのものは qa:examSpine:characterization /
  //   tutorLoader / tutorComposition が snapshot 比較で見る。ここでは
  //   「その suite が見る fixture 集合が痩せていない」ことだけを固定する
  //   （fixture を消して緑にする逃げ道を塞ぐ）。
  for (const [dir, expected] of [
    ['scripts/fixtures/exam-spine-characterization', 6],
    ['scripts/fixtures/exam-spine-tutor-loader', 9],
    ['scripts/fixtures/exam-spine-tutor-composition', 6],
  ] as const) {
    const files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json'));
    eq(`I characterization fixture 件数: ${dir}`, files.length, expected);
  }
}

// ── 9. H claim absence / 本文の非露出 ─────────────────────────────────

function s9ClaimAbsence(): void {
  console.log('\n9. H claim absence');

  // claim 組み立て関数の kind 集合を実ソースから抽出（arity 非依存）。
  const claimSrc = readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8');
  const fnIdx = claimSrc.indexOf('export function buildTutorDeviceClaimEntries(');
  check('H claim 組み立て関数を特定できる', fnIdx !== -1);
  const claimKinds = Array.from(
    claimSrc.slice(Math.max(fnIdx, 0)).matchAll(/entries\.push\(\{\s*kind:\s*'([a-z_]+)'/g),
  ).map((m) => m[1]).sort();
  check('H self_pr の claim は配線されていない', !claimKinds.includes('self_pr'));
  eq('H tutor の claim kind は 5.1-5.7 の 6 つのまま', claimKinds,
    ['activity', 'basic_info', 'diagnosis', 'interview_record', 'self_analysis', 'statement_review']);

  // deviceSelfPrToken を作っていない（token helper の追加も禁止）。
  check('H deviceSelfPrToken は存在しない', !claimSrc.includes('deviceSelfPrToken'));
  check('H claim module は self_pr storage を import しない',
    !claimSrc.includes('selfPRStorage') && !claimSrc.includes('SelfPR'));

  // ★ 実際に組み立てた header に self_pr も本文も出ない ★
  //   claim が 1 件も無いと header 自体が付かない（null）ので、
  //   **中身のある header** を作ってから self_pr の不在を見る。
  const basic = { name: 'x', grade: '高3' } as unknown as BasicInfo;
  const entries = buildTutorDeviceClaimEntries(basic, null, null, null, null, null);
  check('H claim entries が空でない（guard が空文字で緑にならない）', entries.length > 0);
  check('H claim entries に self_pr kind は無い',
    !entries.some((e) => e.kind === 'self_pr'), entries.map((e) => e.kind).join(','));
  const header = serializeDeviceClaim(entries) ?? '';
  check('H header が実体を持つ', header.length > 0);
  check('H header に self_pr は出ない', !header.includes('self_pr'));
  check('H header に本文 canary は出ない', !header.includes(BODY_CANARY));
  //   ★ self_pr の device 本文を渡す引数が、そもそも存在しない ★
  check('H buildTutorDeviceClaimEntries に self_pr を渡す口が無い',
    !/buildTutorDeviceClaimEntries\([^)]*[Ss]elfPR/.test(claimSrc.replace(/\n/g, ' ')));

  // blocker 宣言文にも本文 / PII は出さない（enum と構造の説明だけ）。
  const reason = EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.self_pr ?? '';
  check('H blocker 文に本文 canary は無い', !reason.includes(BODY_CANARY));

  // supported kinds からは外さない（transport contract は保持する）。
  check('H self_pr は EXAM_SYNC_SUPPORTED_KINDS に残る（capability は possible）',
    (EXAM_SYNC_SUPPORTED_KINDS as readonly string[]).includes('self_pr'));
}

// ── 10. K/L Decision / STATE の記録 ───────────────────────────────────

function s10Decision(): void {
  console.log('\n10. K/L Decision 記録');

  const dec = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md'), 'utf8');
  const i = dec.indexOf('## E-S50');
  const j = dec.indexOf('## E-S51');
  check('K E-S50 節を特定できる', i !== -1 && j > i);
  const es50 = dec.slice(i, j);

  check('K E-S50 の Level 表に self_pr 行がある', es50.includes('self_pr           server:'));
  check('K self_pr は Level C と記録されている',
    /self_pr[\s\S]*?\*\*Level C\*\*/.test(es50));
  // evidence の必須項目（C1〜C4 + essay と別根拠であること）
  for (const [label, needle] of [
    ['server ordering', 'updated_at DESC, created_at DESC, id DESC'],
    ['read cap', 'EXAM_READ_CAPS.self_pr'],
    ['C1 device window 未適用', 'window 未適用'],
    ['C2 updated_at key 不一致', 'self_prs_set_updated_at'],
    ['C3 delete 非伝播', 'propagateDelete'],
    ['C4 id tie-break 不能', 'id: null'],
    ['essay と別根拠', '流用しない'],
  ] as const) {
    check(`K evidence: ${label}`, es50.includes(needle), needle);
  }
  check('K Level C の定義行に self_pr が載っている',
    es50.includes('**self_pr**（Stage 5.10 で監査）'));

  // ★ product semantics を解決したことにしない ★
  check('K window を適用しないことが結論だと明記されている',
    es50.includes('window を適用しないことが結論である'));

  // ★ Stage 5.10 は新 Decision ID を採番していない ★
  //
  //   ⚠️ 以前ここは「E-S の最大 ID は 58」を pin していたが、それは **誤った不変条件**
  //     だった。後続 Stage が新 ID を採番するのは正常であり、Stage 5.10 の主張は
  //     「self_pr の ruling が既存 authority に載っている」ことでしかない。
  //     max ID を固定すると後続 Stage を無条件に落とす（Stage 5.11 で実測）。
  //     したがって **self_pr 専用の decision 見出しが存在しないこと**を pin する。
  const headings = Array.from(dec.matchAll(/^## (E-[A-Z]?\d+) — (.*)$/gm));
  check('K decision 見出しを抽出できる（空回り検査でない）', headings.length > 40);
  const selfPrOwned = headings.filter(([, , title]) => /self_pr|自己PR/.test(title));
  eq('K self_pr 専用の Decision 見出しは存在しない（既存 authority に載せた）',
    selfPrOwned.map(([, id]) => id), []);
  //   ruling の所在は E-S50（device history window の tie-break）である。
  check('K self_pr Level C の authority は E-S50 である',
    /self_pr[\s\S]*?\*\*Level C\*\*/.test(es50));
  //   E-S50 が別主題へすり替わっていないこと（N13 と同じ規律）。
  const es50Head = dec.split('\n').find((l) => l.startsWith('## E-S50 ')) ?? '';
  check('K E-S50 の見出しは device history window のまま',
    es50Head.includes('device history window'), es50Head.slice(0, 110));

  // ★ L. HD-1〜HD-6 が unresolved のまま ★
  const state = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STATE.md'), 'utf8');
  check('L STATE に self_pr readiness が記録されている',
    state.includes('### self_pr readiness（Stage 5.10 / ruling = Level C）'));
  check('L STATE の self_pr semantics は UNRESOLVED', state.includes('semantics       UNRESOLVED'));
  check('L STATE の self_pr runtime enable は BLOCKED',
    state.includes('runtime enable  BLOCKED  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.self_pr'));

  const hdAt = state.indexOf('### 未解決のまま据え置く product 判断（Stage 5.10');
  check('L HD 節を特定できる', hdAt !== -1);
  const hdEnd = state.indexOf('\n### ', hdAt + 10);
  const hdSection = state.slice(hdAt, hdEnd === -1 ? state.length : hdEnd);
  for (const hd of ['HD-1', 'HD-2', 'HD-3', 'HD-4', 'HD-5', 'HD-6']) {
    check(`L open question ${hd} が残っている`, hdSection.includes(hd));
  }
  //   ★ CLOSED / RESOLVED へ倒していない ★（文字列の存在だけで満足しない）
  for (const closed of ['CLOSED', 'RESOLVED', '解決済み']) {
    check(`L HD 節が ${closed} を宣言していない`, !hdSection.includes(closed), closed);
  }
  check('L Level C は semantics を決めたものではないと明記されている',
    state.includes('semantics を決めたものではない'));
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.10] self_pr runtime block（Level C ruling の固定）');
  s1Authority();
  s2RuntimeBlock();
  s3TransportParity();
  s4OverCap();
  s5UpdatedOrder();
  s6DeleteResidue();
  await s7TutorDenial();
  s8PromptEquivalence();
  s9ClaimAbsence();
  s10Decision();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.10] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.10] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.10] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.10] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.10] PASS');
}
void main();
