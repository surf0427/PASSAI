// PASSAI 受験版 Exam Spine — Stage 5.6 statement_review の legacy 相当射影（shadow 専用）。
//
// ★ これは canonical の consumer contract ではない（E-S44）★
//   目的は「canonical rows から legacy と同じ表現を作れるか」を **測る**ことだけである。
//   prompt / block / ExamContextInput へ接続してはいけない。
//   移行後に statement_review をどう表現するか（最新 1 件の課題 / 反復論点 / 両方）は
//   product 判断であり、本 module はその判断を先取りしない。
//
// ★ 正規化を再実装しない ★
//   先頭 2 件 / 各 60 字 / ' / ' 連結 という整形は legacy 側の
//   `buildStatementWeaknessLine` が正本。定数を複製すると legacy と canonical で
//   表現がずれ、比較そのものが意味を失う（E-P6 と同じ理由）。
//
// 純関数。I/O / Date / Math.random を持たない。

import { buildStatementWeaknessLine } from '@/lib/contextBuilders/tutorStudentContext';

import type { ExamStatementReviewServerRow } from '../../read/rowMappers';

/**
 * canonical rows → legacy tutor が出している「志望理由書の課題」行の値。
 *
 * legacy の selection rule をそのまま写す:
 *   `loadReviewHistory()[0]?.result`（＝ **最新 1 件**の result）
 * canonical の rows は Stage 3 が `created_at DESC` で返すため、先頭が最新である。
 *
 * ★ 反復論点（buildPreviousOutputSummary）とは別物 ★
 *   あちらは履歴 N 件を頻度で集約する projection で、2 件未満では空になる。
 *   ここでは legacy と同じく **1 件でも出る**。
 *
 * 出せるものが無ければ `null`（legacy も行ごと省略する）。
 */
export function projectStatementReviewLegacyLine(
  rows: readonly ExamStatementReviewServerRow[] | null | undefined,
): string | null {
  const latest = rows?.[0];
  if (!latest) return null;
  // legacy は `{ weaknesses }` だけを見る（client も weaknesses だけを送っている）。
  const result = latest.result;
  if (!result) return null;
  return buildStatementWeaknessLine({ weaknesses: result.weaknesses });
}
