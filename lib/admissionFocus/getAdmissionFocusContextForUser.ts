// Admission Focus Context を「ユーザー入力（大学・学部・学科）」から DB を引いて生成する
// 唯一の wrapper（STEP2b）。
//
// 責務:
// - DB 境界（lib/universities.ts）を呼ぶ唯一の admissionFocus layer ファイル。
// - infer → context までを順に呼んで string を返すだけ。AI / I/O なし。
// - route / prompt builder からはこの helper だけを使う。route 内に推定ロジックや
//   DB 呼び出しを書かないための窓口。
//
// 設計方針:
// - 入力は「分解済み」（faculty / department を別フィールドで受ける）。parseFacultyName は
//   呼ばない。parse 責務を admissionFocus layer に持ち込まないため。
// - examTypes は signature に含めるが、現 STEP では絞り込みに使わない:
//     basicInfo.examTypes（'総合型選抜（AO入試）'等）と CSV の entry.exam_type
//     （'学校推薦型選抜(公募制)' / '自己推薦特別入学試験' 等）の表記乖離が大きく、
//     雑な regex 一致は取りこぼし / 誤マッチ両方を生む。alias 整備までは entries 全件
//     合算で推定する（STEP1b の score 集約方針と整合）。
//     将来 STEP で alias 表を入れた時点で本 wrapper 内に filter を追加する。
// - 該当 entries が無い場合は空文字を返す（既存 buildInterviewUniversityContext と同作法）。
//
// 関連: lib/universities.ts / lib/admissionFocus/inferAdmissionFocusType.ts /
//       lib/admissionFocus/buildAdmissionFocusContext.ts

import {
  findUniversityEntriesByUserChoices,
  getSelectionStepsByEntryId,
} from '@/lib/universities';
import { inferAdmissionFocusType } from '@/lib/admissionFocus/inferAdmissionFocusType';
import { buildAdmissionFocusContext } from '@/lib/admissionFocus/buildAdmissionFocusContext';

export type GetAdmissionFocusContextInput = {
  university: string;
  faculty?: string;
  department?: string;
  // 現 STEP では未使用。将来の絞り込み拡張のための forward-compatible 受け口。
  examTypes?: readonly string[];
};

export function getAdmissionFocusContextForUser(
  input: GetAdmissionFocusContextInput,
): string {
  const entries = findUniversityEntriesByUserChoices({
    university: input.university,
    faculty: input.faculty,
    department: input.department,
  });
  if (entries.length === 0) return '';

  const steps = entries.flatMap((e) =>
    getSelectionStepsByEntryId(e.entry_id),
  );

  const inference = inferAdmissionFocusType({ entries, steps });
  return buildAdmissionFocusContext(inference);
}
