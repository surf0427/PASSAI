// PASSAI 受験版 Exam Spine — Stage 5.7 interview_record → Tutor 表現の canonical 射影。
//
// ★ statement_review の shadow 専用射影とは位置づけが違う（E-S46）★
//   `shadow/statementReviewProjection.ts` は「測るためだけ」の射影で、canonical 側に
//   既存の別 projection（反復論点）があり、どちらを採るかが product 判断だった。
//   interview_record には競合する canonical projection が存在しないため、
//   legacy 同等表現をそのまま canonical block の入力にしてよい。
//   （block を持つことと consumer が使うことは別。接続は別 Stage。）
//
// ★ 正規化を再実装しない ★
//   先頭 3 件 / 各 80 字 / ' / ' 連結 / 全体 500 字という整形は legacy 側の
//   `buildInterviewLine` が正本。定数を複製すると legacy と canonical で表現が
//   静かにずれ、比較そのものが意味を失う（E-P6）。
//
// 純関数。I/O / Date / Math.random を持たない。

import { buildInterviewLine } from '@/lib/contextBuilders/tutorStudentContext';

import type { ExamInterviewRecordServerRow } from '../read/rowMappers';

/**
 * canonical rows → legacy tutor が出している「面接練習の課題」行の値。
 *
 * ★ legacy の 2 入力は同じ 1 レコード由来である（E-S46）★
 *   `app/tutor/page.tsx:423` の `getInterviewRecords()[0]` から
 *     interviewRecordLatest   = { improvementSummary, whatWentWrong }
 *     interviewFeedbackLatest = JSON.parse(record.feedbackJson).improvements
 *   の両方が作られている。つまり `interviewFeedbackLatest` は `interview_ai` ではなく
 *   `interview_practice_records.feedback_json` であり、この行は
 *   **interview_record 単独で再現できる**。
 *
 * selection は legacy と同じ「最新 1 件」。canonical rows は Stage 3 が
 * `created_at DESC` で返すため先頭が最新である。
 *
 * 優先順位も legacy と同じで、`buildInterviewLine` に委ねる:
 *   1. feedback.improvements → 2. improvementSummary / whatWentWrong → 3. null
 *
 * ★ client 側の guard との差（意図的）★
 *   client は `isInterviewFeedback` で厳密判定してから improvements を渡すが、
 *   ここでは jsonb をそのまま渡す。`buildInterviewLine` は `improvements` が
 *   string[] でなければ空配列として扱い、優先順位 2 へ落ちるため、
 *   guard を通らない値に対する挙動は両者で一致する。
 *   （guard を canonical 側で再実装すると判定表が 2 つになる。）
 *
 * 出せるものが無ければ `null`（legacy も行ごと省略し、代替文言を出さない）。
 */
export function projectInterviewIssueLine(
  rows: readonly ExamInterviewRecordServerRow[] | null | undefined,
): string | null {
  const latest = rows?.[0];
  if (!latest) return null;
  return buildInterviewLine(latest.feedback, {
    improvementSummary: latest.improvementSummary,
    whatWentWrong: latest.whatWentWrong,
  });
}
