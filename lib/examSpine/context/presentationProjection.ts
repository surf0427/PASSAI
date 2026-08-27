// PASSAI 受験版 Exam Spine — Stage 5.9 presentation → Tutor 表現の canonical 射影。
//
// ★ presentation は class 2（server_authoritative / E-S3）★
//   Source-Sync（device claim / fingerprint / verified）は適用しない。
//   device に canonical は存在せず、client の値は表示用 cache にすぎないため、
//   claim を作ると「cache が古い＝正しい server の値を使えない」という逆向きの
//   誤りになる。したがって本 Stage が作るのは **read → 射影 → block** だけである。
//
// ★ 正規化を再実装しない ★
//   件数（3/3/2）・1 要素 40 字・総合評価 120 字・カテゴリ順・日本語ラベル・
//   行の組み立ては `lib/contextBuilders/tutorPresentationSection.ts` が正本。
//   legacy（Supabase 層）と canonical がそこを共有するため、定数を書き写さない
//   （E-P6 / Stage 5.7 interview_record と同じ判断）。
//
// ★ selection は legacy と同じ「最新 1 件」★
//   legacy は `presentation_results` を `created_at DESC` / `LIMIT 1` で読む。
//   canonical reader は `created_at DESC, id DESC` で cap 件読むため、
//   先頭行が同じ「最新 1 件」である（tie の残余は E-S50 の tie-break 監査と同種）。
//
// 純関数。I/O / env / Math.random を持たない。

import {
  projectTutorPresentationContext,
  renderTutorPresentationLines,
  type TutorPresentationContext,
} from '@/lib/contextBuilders/tutorPresentationSection';

import type { ExamPresentationServerRow } from '../read/rowMappers';

/**
 * canonical rows → legacy tutor が prompt に出している presentation の値。
 *
 * ★ 材料は `feedback`（jsonb）であって `categories` column ではない ★
 *   `presentation_results` には `categories` column もあるが、それは書込時に
 *   `projectCategories(feedback) = { ...feedback.categories }` で作られる派生コピーで
 *   `DEFAULT '{}'` を持つ。legacy は一貫して `feedback.categories` を読むため、
 *   canonical も同じ field を authority にする。
 *   「似た値が別 column にある」ことを理由に出所を変えない（Stage 5.8 essay の教訓）。
 *
 * 大学名 / 学部名 / テーマは enrichment（session）由来。取れていなければ落ちる。
 * 出せるものが無ければ `null`（legacy も section を出さない。代替文言を作らない）。
 */
export function projectPresentationContext(
  rows: readonly ExamPresentationServerRow[] | null | undefined,
): TutorPresentationContext | null {
  const latest = rows?.[0];
  if (!latest) return null;
  return projectTutorPresentationContext({
    feedback: latest.result.feedback,
    createdAt: latest.result.createdAt,
    universityName: latest.session?.universityName,
    facultyName: latest.session?.facultyName,
    theme: latest.session?.theme,
  });
}

/**
 * canonical rows → legacy と同じ「直近のプレゼン練習の結果」行（改行連結）。
 *
 * block content はこの文字列。legacy 側は同じ renderer に
 * `TutorStudentContext.presentation` を渡した結果であり、両者は同形で比較できる。
 */
export function projectPresentationResultSummary(
  rows: readonly ExamPresentationServerRow[] | null | undefined,
): string | null {
  const lines = renderTutorPresentationLines(projectPresentationContext(rows));
  return lines.length > 0 ? lines.join('\n') : null;
}
