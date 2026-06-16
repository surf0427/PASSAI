'use client';

// STEP-INTERVIEW-AI-PR8: 面接履歴の read-through + 2 ソース結合（orchestration 層）。
//
// 役割:
//   - AI 面接履歴（completed）を Supabase から read-through で取得し、UnifiedInterviewRecord に射影。
//   - 対人記録（localStorage / StoredInterviewRecord）と結合し、source を付与して 1 リストに。
//
// 設計:
//   - 既存 feedbackToText を **再利用**して improvementSummary を生成（feedbackToText は変更しない）。
//     これにより AI 履歴も対人記録と同じ ①〜⑥ 構造で Card に表示できる。
//   - InterviewFeedback / LevelEvaluation 型は変更しない。
//   - never throw（委譲先 DB 境界が best-effort）。失敗時は AI 分 0 件で対人記録のみ表示。
//
// boundary 安全:
//   委譲先 interviewAiResults.ts は "use client"。本ファイルも "use client" を宣言する。

import type { StoredInterviewRecord } from '@/lib/interviewRecordStorage';
import { feedbackToText } from '@/lib/interview/feedbackToText';
import { listCompletedAiInterviews } from '@/lib/supabase/interviewAiResults';
import type { UnifiedInterviewRecord } from '@/types/interviewHistory';

// target_ref から大学 / 学部を取り出す（version 付き jsonb。欠落は ''）。
function pickString(ref: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = ref[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * 自分の completed AI 面接を UnifiedInterviewRecord（source='ai_voice'）として返す。
 *
 * - practiceDate は session.created_at の日付部（YYYY-MM-DD）。
 * - improvementSummary は feedbackToText(feedback) を再利用して生成。
 * - feedbackJson は feedback の JSON 文字列（Card の insights CTA に渡す）。
 * - partner / examType / mainQuestion は対人前提 UI なので '' にし、Card 側で非表示にする。
 * - 失敗時は空配列（never throw）。
 */
export async function getAiInterviewHistory(
  userId: string,
): Promise<UnifiedInterviewRecord[]> {
  const rows = await listCompletedAiInterviews(userId);
  return rows.map((row) => ({
    id: row.sessionId,
    source: 'ai_voice' as const,
    interviewType: row.interviewType,
    practiceDate: row.createdAt.slice(0, 10),
    universityName: pickString(row.targetRef, 'universityName', 'university'),
    facultyName: pickString(row.targetRef, 'faculty', 'facultyName'),
    examType: '', // ai_voice は対人前提の入試方式バッジを出さない
    partner: '', // 同上（練習相手なし）
    mainQuestion: '', // 同上（主な質問は対人記録の手入力項目）
    improvementSummary: feedbackToText(row.feedback),
    feedbackJson: JSON.stringify(row.feedback),
  }));
}

// 対人記録（StoredInterviewRecord）→ UnifiedInterviewRecord（source='human'）。
function humanToUnified(record: StoredInterviewRecord): UnifiedInterviewRecord {
  return {
    id: record.id,
    source: 'human',
    practiceDate: record.practiceDate,
    universityName: record.universityName,
    facultyName: record.facultyName,
    examType: record.examType,
    partner: record.partner,
    mainQuestion: record.mainQuestion,
    improvementSummary: record.improvementSummary,
    feedbackJson: record.feedbackJson,
  };
}

/**
 * 対人記録（localStorage）と AI 履歴（Supabase）を結合し、practiceDate 降順で返す。
 *
 * - human / ai_voice の source を付与（呼び出し前に ai 側は付与済み）。
 * - practiceDate（YYYY-MM-DD 文字列）で降順ソート。同日は human を先に安定化。
 * - 純関数。fetch / storage に触れない（呼び出し側が両ソースを渡す）。
 */
export function mergeInterviewHistory(
  humanRecords: StoredInterviewRecord[],
  aiRecords: UnifiedInterviewRecord[],
): UnifiedInterviewRecord[] {
  const merged: UnifiedInterviewRecord[] = [
    ...humanRecords.map(humanToUnified),
    ...aiRecords,
  ];
  return merged.sort((a, b) => {
    if (a.practiceDate === b.practiceDate) {
      // 同日: human を先（安定的な並び）。
      if (a.source === b.source) return 0;
      return a.source === 'human' ? -1 : 1;
    }
    return a.practiceDate < b.practiceDate ? 1 : -1; // 降順
  });
}
