"use client";

/**
 * STEP-INTERVIEW-AI-PR1: interview_practice_records の DB 境界
 * （SQL / snake_case 翻訳 / RLS / best-effort）。
 *
 * 位置づけ（tutor / selfAnalysisLogs / selfPRs / statementReviewHistory で確立した
 * 3 層構造の横展開）:
 *   UI / interview ページ
 *     ↓
 *   lib/interviewRecordStorage.ts … LS canonical（key='interview_records'。本ファイルを import しない）
 *     ↓
 *   lib/repository/interviewPracticeRecordRepository.ts … orchestration（いつ / 何件 / 冪等 / flag / delta）
 *     ↓ 委譲
 *   lib/supabase/interviewPracticeRecords.ts … 本ファイル。DB 境界
 *     ↓
 *   Supabase（interview_practice_records, supabase/schema.sql §53–§55）
 *
 * 設計方針（lib/supabase/statementReviewHistory.ts と同形）:
 *   - localStorage canonical は維持。本ファイルは durable mirror（best-effort 同期先）。
 *   - 失敗時は never throw。upsert / delete は void、list は空配列を返し、dev のみ devWarn で観測する。
 *     Supabase 障害で interview feature（記録 / 履歴表示）を壊さないことを最優先とする。
 *   - 所有者判定 / RLS / 保存キーには常に auth.users.id を使う。
 *   - getBrowserSupabaseClient() が null（env 未設定）なら no-op。
 *   - natural key = (user_id, local_record_id)。local_record_id = StoredInterviewRecord.id。
 *     contentHash では dedup しない。
 *
 * delete feature 注意:
 *   interview_practice_records は削除を伴う feature。本ファイルは owner-scoped delete を提供するが、
 *   restore / down-sync は実装しない（delete resurrection 回避。tombstone 別 STEP）。
 *
 * feedback_json:
 *   LS の StoredInterviewRecord.feedbackJson は JSON 文字列。本ファイルで parse して jsonb として
 *   送る。parse 失敗 / 欠落は NULL に倒す（best-effort。raw 文字列が壊れていても mirror を止めない）。
 *   read（row → domain）では JSON.stringify で元の文字列形に戻す。
 *
 * 型の方針:
 *   - 生成済み Database 型には依存しない。table 未適用でも build が通るよう、
 *     row 型は本ファイル内の local type で定義する。
 *   - domain 型は lib/interviewRecordStorage.ts の StoredInterviewRecord をそのまま使う。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import type { StoredInterviewRecord } from "@/lib/interviewRecordStorage";

const TABLE = "interview_practice_records";

// DB row（snake_case）の local type。生成 Database 型に依存しない。
type InterviewPracticeRecordRow = {
  id: string;
  user_id: string;
  local_record_id: string;
  practice_date: string;
  university_name: string;
  faculty_name: string;
  exam_type: string;
  partner: string;
  main_question: string;
  improvement_summary: string;
  questions_asked: string;
  my_answers: string;
  what_went_wrong: string;
  feedback_received: string;
  self_noted: string;
  feedback_json: unknown | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

// select で取り出す列（snake_case）。順序は schema.sql §53 に合わせる。
const ROW_COLUMNS =
  "id, user_id, local_record_id, practice_date, university_name, faculty_name, exam_type, partner, main_question, improvement_summary, questions_asked, my_answers, what_went_wrong, feedback_received, self_noted, feedback_json, created_at, updated_at, metadata";

// feedbackJson（JSON 文字列）→ jsonb 値。空 / 欠落 / parse 失敗は null に倒す（best-effort）。
function parseFeedbackJson(raw: string | undefined): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    devWarn("[interviewPracticeRecords] feedback_json parse failed", err);
    return null;
  }
}

// StoredInterviewRecord（domain）→ interview_practice_records row（upsert payload）。
//   - local_record_id = record.id（natural key の一部）。
//   - feedback_json は parse 済み object を送る（jsonb）。欠落 / 壊れは null。
//   - created_at は record.createdAt がある場合のみ送る。legacy LS データで欠けることが
//     あり、その場合は DB DEFAULT now() / onConflict 既存値保持に委ねる。
//   - updated_at は record.updatedAt を送る（§54 trigger が DO UPDATE 経路では now() で
//     上書きするため、初期 INSERT 時の値として効く）。
function recordToRow(
  userId: string,
  record: StoredInterviewRecord,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: userId,
    local_record_id: record.id,
    practice_date: record.practiceDate ?? "",
    university_name: record.universityName ?? "",
    faculty_name: record.facultyName ?? "",
    exam_type: record.examType ?? "",
    partner: record.partner ?? "",
    main_question: record.mainQuestion ?? "",
    improvement_summary: record.improvementSummary ?? "",
    questions_asked: record.questionsAsked ?? "",
    my_answers: record.myAnswers ?? "",
    what_went_wrong: record.whatWentWrong ?? "",
    feedback_received: record.feedbackReceived ?? "",
    self_noted: record.selfNoted ?? "",
    feedback_json: parseFeedbackJson(record.feedbackJson),
    updated_at: record.updatedAt,
  };
  if (record.createdAt) row.created_at = record.createdAt;
  return row;
}

// interview_practice_records row → StoredInterviewRecord（domain）。
//   - UI が使う id は local_record_id（= 元の StoredInterviewRecord.id）。
//   - feedback_json（jsonb）は JSON.stringify で元の文字列形（feedbackJson）に戻す。
//     null は undefined に倒す（domain は optional）。
function rowToRecord(row: InterviewPracticeRecordRow): StoredInterviewRecord {
  return {
    id: row.local_record_id,
    practiceDate: row.practice_date,
    universityName: row.university_name,
    facultyName: row.faculty_name,
    examType: row.exam_type,
    partner: row.partner,
    mainQuestion: row.main_question,
    improvementSummary: row.improvement_summary,
    questionsAsked: row.questions_asked,
    myAnswers: row.my_answers,
    whatWentWrong: row.what_went_wrong,
    feedbackReceived: row.feedback_received,
    selfNoted: row.self_noted,
    feedbackJson:
      row.feedback_json == null ? undefined : JSON.stringify(row.feedback_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * interview_practice_records を idempotent に upsert する（durable mirror への 1 件書き込み）。
 *
 * - natural key: (user_id, local_record_id)。onConflict で同一記録を冪等に書く。
 *   記録は in-place 編集されないため、再 upsert は同一内容を書くだけ（DO UPDATE）。
 * - localStorage が canonical なので、失敗しても throw しない（best-effort）。
 * - env 未設定 / error は dev のみ warn し、UI を壊さず黙って no-op する。
 */
export async function upsertInterviewPracticeRecordToSupabase(args: {
  userId: string;
  record: StoredInterviewRecord;
}): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(recordToRow(args.userId, args.record), {
        onConflict: "user_id,local_record_id",
      });
    if (error) {
      devWarn("[interviewPracticeRecords] upsert error", error);
    }
  } catch (err) {
    devWarn("[interviewPracticeRecords] upsert threw", err);
  }
}

/**
 * interview_practice_records の 1 行を owner-scoped で削除する。
 *
 * - 条件: user_id = args.userId AND local_record_id = args.localRecordId。
 * - RLS（§55 owner delete）と二重で owner を絞る。
 * - 失敗しても throw しない（best-effort）。
 *
 * 注: 本関数は delete 伝播（dualWrite の propagateDelete）からのみ使う想定。
 *     down-sync / restore は実装しないため、ここでは tombstone を残さず物理削除する。
 */
export async function deleteInterviewPracticeRecordFromSupabase(args: {
  userId: string;
  localRecordId: string;
}): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq("user_id", args.userId)
      .eq("local_record_id", args.localRecordId);
    if (error) {
      devWarn("[interviewPracticeRecords] delete error", error);
    }
  } catch (err) {
    devWarn("[interviewPracticeRecords] delete threw", err);
  }
}

/**
 * 自分の interview_practice_records を created_at 降順で返す。RLS により他人の行は取れない。
 *
 * 将来の restore（下り）用に用意するが、本 STEP ではどこからも呼ばない。
 * env 未設定 / error 時は空配列を返す（never throw）。restore を実装する STEP では
 * 「空配列」と「取得失敗」を区別する必要が出るため、その時点で戻り型を見直すこと。
 */
export async function listInterviewPracticeRecordsFromSupabase(
  userId: string,
): Promise<StoredInterviewRecord[]> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      devWarn("[interviewPracticeRecords] list error", error);
      return [];
    }
    const rows = (data ?? []) as InterviewPracticeRecordRow[];
    return rows.map(rowToRecord);
  } catch (err) {
    devWarn("[interviewPracticeRecords] list threw", err);
    return [];
  }
}
