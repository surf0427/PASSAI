// PASSAI 受験版 Exam Spine — Stage 4 Wave 3 / device canonical view（純関数）。
//
//   device の domain object（localStorage canonical）
//        ↓  deviceXxxRow: writer が書く row 形へ（本 file の唯一の新規責務）
//        ↓  rowMappers.mapXxxRow: **server と同一の mapper**
//        ↓  views.xxxSyncView: **server と同一の view**
//        ↓  normalize → fingerprint（Wave 1/2）
//   claim candidate
//
// ★★ 設計の中心: device 側に別実装を作らない ★★
//   Wave 3 で最も危険なのは「device は full text / server は truncated」のような
//   **永久 mismatch**（同じ内容なのに一致しない → Source-Sync が常に veto → 機能が無効化）。
//   これを避けるため、本 file が持つのは **「writer が書いたであろう row」を組み立てる部分だけ**で、
//   truncate / guard / projection / view は Stage 3 と Wave 2 の実装をそのまま呼ぶ。
//   truncateString / toStringArray / asRecord を device 用に書き直さない（E-P6）。
//
//   したがって「device view の contract」は存在しない。**server view の contract が 1 本だけ**あり、
//   device はその入口に別経路から入る。
//
// ★ row 形は writer ではなく **reader の projection** に合わせる ★
//   writer が書くが query が SELECT しない列（statement_review.essay /
//   interview_record.{partner,questions_asked,my_answers}）は row にも入れない。
//   mapper が読まないので結果は変わらないうえ、本文・逐語を adapter 層へ持ち込まずに済む。
//
// ★ DB が決める値は device 側で捏造しない ★
//   id（uuid PK）/ updated_at（trigger）/ 未送信時の created_at は device に存在しない。
//   いずれも Wave 2 registry で content から除外済みなので、row では null を置く。
//
// 非依存: I/O / clock / random / logging / network / DB / AI。
//   localStorage も window も触らない（読み出しは deviceSources.ts の注入境界が受ける）。

import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { DiagnosisResult } from '@/lib/diagnosisStorage';
import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import type { ReviewHistoryItem } from '@/lib/statement/review/statementStorage';
import type { SelfPR } from '@/types/selfPR';
import type { StoredInterviewRecord } from '@/lib/interviewRecordStorage';
import type { EssayWorkspace } from '@/types/essay';

import { EXAM_READ_FIELD_LIMITS } from '../../read/readSources';
import { EXAM_READ_CAPS } from '../../read/types';
import {
  mapActivityRow,
  mapBasicInfoRow,
  mapDiagnosisRow,
  mapEssayRow,
  mapInterviewRecordRow,
  mapSelfAnalysisRow,
  mapSelfPrRow,
  mapStatementReviewRow,
} from '../../read/rowMappers';
import {
  activitySyncView,
  basicInfoSyncView,
  diagnosisSyncView,
  essaySyncView,
  interviewRecordItemView,
  listSyncView,
  selfAnalysisItemView,
  selfPrItemView,
  statementReviewItemView,
} from './views';

/**
 * ★ writer の schema_version 定数（device 側にも同じ値が要る）★
 *   これらは `lib/supabase/*Logs.ts` の module private 定数であり export されていない。
 *   値がずれると schemaVersion が content field なので **全ユーザーが永久 mismatch** になるため、
 *   QA が writer の実ソースから値を読み直して一致を検査する。
 *     lib/supabase/basicInfoLogs.ts:38  const SCHEMA_VERSION = "1"
 *     lib/supabase/activityLogs.ts:31   const SCHEMA_VERSION = "1"
 *     lib/supabase/diagnosisLogs.ts:36  const SCHEMA_VERSION = "3"
 */
export const EXAM_DEVICE_SCHEMA_VERSIONS = {
  // ★ 3 kind とも「値を宣言し、QA が writer の実ソースと突き合わせる」で統一する ★
  //   adapter が writer module（persistence 実装）を import すると layer inversion に
  //   なり、`adapters の import は sync core + Spine 内部 contract + 許可 domain 型のみ`
  //   という不変条件（sync-adapters QA）を破る。adapter を pure に保つ方を優先し、
  //   drift は QA の pin 検査（writer の実ソースを読んで一致を確認）で塞ぐ。
  basic_info: '1',
  activity: '1',
  diagnosis: '3',
} as const;

// ── 結果型（fail-closed）──────────────────────────────────────────────
//
// device 側のデータが **意味を確定できない**とき、勝手に null / {} へ丸めない。
// 丸めると「壊れた device データ」と「本当に空の device データ」が同じ claim になり、
// verified を名乗り得る。Canon §40（EMPTY ≠ UNREADABLE）/ E-S1 の姿勢に合わせて
// claim を作らない方向へ倒す（＝ E-S2 の `unclaimed`）。

export type ExamDeviceUnclaimableReason =
  /** serialize された field（interview_record.feedbackJson）が JSON として読めない。 */
  | 'unparseable_serialized_field'
  /** row projection が成立しない（domain object が想定の形でない）。 */
  | 'row_projection_failed';

export type ExamDeviceViewResult =
  | { readonly ok: true; readonly view: unknown }
  | { readonly ok: false; readonly reason: ExamDeviceUnclaimableReason };

const L = EXAM_READ_FIELD_LIMITS;

function failed(reason: ExamDeviceUnclaimableReason): ExamDeviceViewResult {
  return { ok: false, reason };
}

// ── snapshot kind ─────────────────────────────────────────────────────

/**
 * ★ `name` を落とす ★
 *   `lib/supabase/basicInfoLogs.ts` の `stripName()` が書き込み前に削除するため、
 *   mirror に氏名は存在しない（E-P8）。device 側が落とし忘れると **全ユーザーが永久 mismatch**。
 *   writer と同じく canonical を mutate せず新 object を返す。
 */
function stripName(payload: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...payload };
  delete rest.name;
  return rest;
}

export function deviceBasicInfoRow(info: BasicInfo): Record<string, unknown> {
  return {
    payload: stripName(info as unknown as Record<string, unknown>),
    schema_version: EXAM_DEVICE_SCHEMA_VERSIONS.basic_info,
  };
}

export function deviceBasicInfoView(info: BasicInfo): ExamDeviceViewResult {
  const mapped = mapBasicInfoRow(deviceBasicInfoRow(info), L);
  if (!mapped) return failed('row_projection_failed');
  return { ok: true, view: basicInfoSyncView(mapped) };
}

export function deviceActivityRow(data: ActivityData): Record<string, unknown> {
  return {
    payload: data as unknown as Record<string, unknown>,
    schema_version: EXAM_DEVICE_SCHEMA_VERSIONS.activity,
  };
}

export function deviceActivityView(data: ActivityData): ExamDeviceViewResult {
  const mapped = mapActivityRow(deviceActivityRow(data));
  if (!mapped) return failed('row_projection_failed');
  return { ok: true, view: activitySyncView(mapped) };
}

export function deviceDiagnosisRow(result: DiagnosisResult): Record<string, unknown> {
  return {
    payload: result as unknown as Record<string, unknown>,
    schema_version: EXAM_DEVICE_SCHEMA_VERSIONS.diagnosis,
  };
}

export function deviceDiagnosisView(result: DiagnosisResult): ExamDeviceViewResult {
  const mapped = mapDiagnosisRow(deviceDiagnosisRow(result));
  if (!mapped) return failed('row_projection_failed');
  return { ok: true, view: diagnosisSyncView(mapped) };
}

// ── history kind（item view）──────────────────────────────────────────
//
// `id`（DB uuid）は device に存在しないので null。Wave 2 registry で content 除外済み。

export function deviceSelfAnalysisRow(log: SelfAnalysisLog): Record<string, unknown> {
  return {
    id: null,
    created_at: log.createdAt,
    analysis: log.analysis,
    summary: log.summary,
    displayed_questions: log.displayedQuestions,
    answers: log.answers,
    deep_answers: log.deepAnswers,
    free_memo: log.freeMemo,
  };
}

export function deviceSelfAnalysisItemView(log: SelfAnalysisLog): ExamDeviceViewResult {
  const mapped = mapSelfAnalysisRow(deviceSelfAnalysisRow(log), L);
  if (!mapped) return failed('row_projection_failed');
  return { ok: true, view: selfAnalysisItemView(mapped) };
}

/** `essay`（志望理由書の本文）は query が SELECT しないため row にも入れない。 */
export function deviceStatementReviewRow(item: ReviewHistoryItem): Record<string, unknown> {
  return {
    id: null,
    local_review_id: item.id,
    university: item.university,
    faculty: item.faculty,
    department: item.department,
    result: item.result,
    created_at: item.createdAt,
  };
}

export function deviceStatementReviewItemView(item: ReviewHistoryItem): ExamDeviceViewResult {
  const mapped = mapStatementReviewRow(deviceStatementReviewRow(item), L);
  if (!mapped) return failed('row_projection_failed');
  return { ok: true, view: statementReviewItemView(mapped) };
}

/**
 * writer（lib/supabase/selfPRs.ts:67 prToRow）と同じ写像:
 *   local_pr_id = pr.id / pr_index = pr.index / title = pr.title ?? '' / body = pr.text
 * `title` の `?? ''` を落とすと undefined と '' が食い違って永久 mismatch になる。
 */
export function deviceSelfPrRow(pr: SelfPR): Record<string, unknown> {
  return {
    id: null,
    local_pr_id: pr.id,
    pr_index: pr.index,
    title: pr.title ?? '',
    body: pr.text,
    latest_result: pr.latestResult,
    created_at: pr.createdAt ?? null,
    updated_at: pr.updatedAt,
  };
}

export function deviceSelfPrItemView(pr: SelfPR): ExamDeviceViewResult {
  const mapped = mapSelfPrRow(deviceSelfPrRow(pr), L);
  if (!mapped) return failed('row_projection_failed');
  return { ok: true, view: selfPrItemView(mapped) };
}

/**
 * ★ `feedbackJson` は device では **JSON 文字列**、mirror では jsonb ★
 *   writer（interviewPracticeRecords.ts:77 parseFeedbackJson / :113）が
 *   `JSON.parse` して jsonb で保存する。device 側も同じ境界で object へ戻す。
 *
 *   ただし **parse 失敗を null へ丸めない**。writer は devWarn して null を書くが、
 *   device 側で同じことをすると「壊れた JSON を持つ端末」が「feedback 無しの端末」と
 *   同じ claim を出し、verified を名乗り得る。Canon §40 / E-S1 に従い claim を作らない
 *   （＝ unclaimed へ倒す）。
 *   空 / 未設定（`!raw`）は writer と同じく null であり、これは失敗ではない。
 */
type FeedbackParse =
  | { ok: true; value: unknown }
  | { ok: false };

function parseDeviceFeedbackJson(raw: string | undefined): FeedbackParse {
  if (!raw) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

export function deviceInterviewRecordRow(
  record: StoredInterviewRecord,
): { ok: true; row: Record<string, unknown> } | { ok: false; reason: ExamDeviceUnclaimableReason } {
  const feedback = parseDeviceFeedbackJson(record.feedbackJson);
  if (!feedback.ok) return { ok: false, reason: 'unparseable_serialized_field' };
  return {
    ok: true,
    row: {
      id: null,
      local_record_id: record.id,
      practice_date: record.practiceDate ?? '',
      university_name: record.universityName ?? '',
      faculty_name: record.facultyName ?? '',
      exam_type: record.examType ?? '',
      main_question: record.mainQuestion ?? '',
      improvement_summary: record.improvementSummary ?? '',
      what_went_wrong: record.whatWentWrong ?? '',
      feedback_received: record.feedbackReceived ?? '',
      self_noted: record.selfNoted ?? '',
      feedback_json: feedback.value,
      created_at: record.createdAt,
    },
  };
}

export function deviceInterviewRecordItemView(
  record: StoredInterviewRecord,
): ExamDeviceViewResult {
  const row = deviceInterviewRecordRow(record);
  if (!row.ok) return failed(row.reason);
  const mapped = mapInterviewRecordRow(row.row, L);
  if (!mapped) return failed('row_projection_failed');
  return { ok: true, view: interviewRecordItemView(mapped) };
}

/**
 * ★ essay は query の projection に合わせる ★
 *   `essayQuery` は `reviews:workspace->reviews` を SELECT する（E-S27）。
 *   したがって row には workspace 全体ではなく `reviews` だけを置く。
 *   本文（body / rewriteDraft / sparring.answers / reviews[*].essayBodySnapshot）は
 *   `mapEssayRow` が落とすが、そもそも adapter 層へ持ち込まない方が安全なので
 *   row へ入れるのも `reviews` のみにする。
 *
 *   位置反転 / recordItems cap / reviewCount / 本文除去は **すべて mapEssayRow が行う**。
 *   device 側でその処理を書き直さない（時刻での再ソートも DB id での順序再現もしない）。
 */
export function deviceEssayRow(workspace: EssayWorkspace): Record<string, unknown> {
  return {
    id: null,
    local_workspace_id: workspace.id,
    reviews: workspace.reviews,
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
  };
}

export function deviceEssayItemView(workspace: EssayWorkspace): ExamDeviceViewResult {
  const mapped = mapEssayRow(deviceEssayRow(workspace), L);
  if (!mapped) return failed('row_projection_failed');
  return { ok: true, view: essaySyncView(mapped) };
}

// ── list（multiset kind）──────────────────────────────────────────────

/**
 * history kind の list view。
 *
 * ★ 1 件でも claim できない item があれば **kind 全体を unclaimable** にする ★
 *   壊れた item だけを落とすと、device の multiset が mirror より小さくなり
 *   「不一致」として観測される。それは事実に反する（device には存在する）。
 *   部分的な claim を出さない。
 *
 * 並べ替えは `listSyncView`（= Wave 2 の `sortSyncItems`）に委ねる。
 * device の配列順（append 順 / pr_index 昇順などの表示順）は fingerprint に載らない。
 */
export function deviceListView<T>(
  items: readonly T[],
  itemView: (item: T) => ExamDeviceViewResult,
): ExamDeviceViewResult {
  const views: Record<string, unknown>[] = [];
  for (const item of items) {
    const r = itemView(item);
    if (!r.ok) return r;
    views.push(r.view as Record<string, unknown>);
  }
  return { ok: true, view: listSyncView(views, (v) => v) };
}

/**
 * ★ server の read window と同じ部分集合を device 側でも選ぶ（Stage 5.4）★
 *
 * history 系 kind は Stage 3 が `EXAM_READ_CAPS` で **上位 N 件だけ**を読む
 * （`queries.ts` の `created_at DESC, id DESC` ＋ `readSources.ts` の `applyCap`）。
 * device 側が全件を hash すると、N 件を超えたユーザーは
 * **内容が完全に同期していても永久に mismatch** になる。
 * これは runtime では「mismatch」としか見えず原因が表面化しない
 * （E-S38 の schema_version と同じ検出不能な故障）。
 *
 * ★ 並び順そのものは fingerprint に影響しない ★
 *   `listSyncView` は `sortSyncItems` で **各 item の fingerprint 順**に並べ直すため、
 *   localStorage の挿入順や DB の返却順には依存しない。
 *   ここで揃える必要があるのは「**どの N 件を選ぶか**」だけである。
 *
 * ⚠️ tie: server は同一 `created_at` を `id DESC` で解くが、device 側の view は
 *   `id` を含まない（`deviceSelfAnalysisRow` が `id: null` を置く）。
 *   同一 timestamp の log が cap 境界をまたぐ場合だけ選択がずれ得る。
 *   実運用では `createdAt` は `new Date().toISOString()` でミリ秒まで入るため
 *   衝突は起きにくいが、構造的な保証ではないことを記録しておく。
 */
export function selectDeviceSyncWindow<T>(
  items: readonly T[],
  cap: number,
  createdAtOf: (item: T) => string | null | undefined,
): readonly T[] {
  if (items.length <= cap) return items;
  return [...items]
    .map((item, index) => ({ item, index, createdAt: createdAtOf(item) ?? '' }))
    // created_at DESC。同値は元の順序を保つ（stable）。
    .sort((a, b) => (a.createdAt === b.createdAt ? a.index - b.index : a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, cap)
    .map((entry) => entry.item);
}

export function deviceSelfAnalysisView(logs: readonly SelfAnalysisLog[]): ExamDeviceViewResult {
  // server が読むのと同じ上位 N 件だけを見る（cap parity）。
  const windowed = selectDeviceSyncWindow(
    logs,
    EXAM_READ_CAPS.self_analysis,
    (log) => log.createdAt,
  );
  return deviceListView(windowed, deviceSelfAnalysisItemView);
}

export function deviceStatementReviewView(
  items: readonly ReviewHistoryItem[],
): ExamDeviceViewResult {
  // server が読むのと同じ上位 N 件だけを見る（cap parity / E-S40）。
  const windowed = selectDeviceSyncWindow(
    items,
    EXAM_READ_CAPS.statement_review,
    (item) => item.createdAt,
  );
  return deviceListView(windowed, deviceStatementReviewItemView);
}

export function deviceSelfPrView(prs: readonly SelfPR[]): ExamDeviceViewResult {
  return deviceListView(prs, deviceSelfPrItemView);
}

export function deviceInterviewRecordView(
  records: readonly StoredInterviewRecord[],
): ExamDeviceViewResult {
  // server が読むのと同じ上位 N 件だけを見る（cap parity / E-S40 / E-S46）。
  //
  // ★ device の localStorage は newest-first で保存される ★
  //   `addInterviewRecord` が `[newRecord, ...current]` を書くため、格納順が既に
  //   created_at DESC と一致する。それでも `selectDeviceSyncWindow` を通すのは、
  //   「保存順が信頼できる」ことに依存せず **created_at で選ぶ**ためである
  //   （手編集や旧版データで順序が崩れていても server と同じ N 件を選ぶ）。
  const windowed = selectDeviceSyncWindow(
    records,
    EXAM_READ_CAPS.interview_record,
    (record) => record.createdAt,
  );
  return deviceListView(windowed, deviceInterviewRecordItemView);
}

export function deviceEssayView(workspaces: readonly EssayWorkspace[]): ExamDeviceViewResult {
  return deviceListView(workspaces, deviceEssayItemView);
}
