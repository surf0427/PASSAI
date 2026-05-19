// 志望理由書添削向けの context builder（純粋関数・AI 呼び出しなし）。
//
// 責務階層:
//   StudentProfile → [context builder layer] → prompt builder → AI
//
//   このファイルの責務は「StudentProfile を志望理由書向け最小コンテキストへ変換する」のみ。
//   志望理由書添削の文言（「以下を評価してください…」等）は lib/statementPrompt.ts の
//   prompt builder 側に置く（責務分離）。
//
// feature-specific 最適化:
//   志望理由書では「論理性 + 一貫性」が評価軸の中心。
//   - strengths を上位 3 件（書類の主張の柱）
//   - weaknesses を上位 2 件（補強箇所の指摘材料）
//   - valueKeywords 上位 6 件（書類の方向性を AI が掴むタグ）
//   - futureConnections / signatureEpisodes は今回は使わない（書類フォーマット上、
//     志望動機・将来像セクションが本文に既に書かれている前提のため重複させない）
//
//   format は legacy WallHittingContext と揃えるため inline bullets（`・a ・b`）。
//
// 関連: lib/studentProfile.ts(toStudentProfile) / lib/statementPrompt.ts

import type { StudentProfile } from '@/types/studentProfile';
import { APPLICANT_TYPE_LABELS, type ApplicantType } from '@/types/applicantType';
import { formatBulletList, formatInlineList } from '@/lib/contextBuilders/common';

const STRENGTHS_MAX = 3;
const WEAKNESSES_MAX = 2;
const VALUE_KEYWORDS_MAX = 6;

// applicantType（5 種）ごとの「志望理由書添削時に AI が意識すべき方向性」を表す短いヒント。
//
// 取り扱い方針:
//   - APPLICANT_TYPE_DESCRIPTIONS は「型の意味」を説明する general purpose 文言なので、
//     statement-review 専用に「添削で何を見るか」を局所定義する（feature 都合の整形は
//     context builder の責務）。
//   - 「断定ではなく傾向」「本人を型に閉じ込めない」を保つため、文末は「〜が薄くなりがち。
//     〜との接続を意識する」のような柔らかい注意喚起にする。
//   - 添削の採点軸（statement_score_system.md の 5 軸）には踏み込まない。あくまで強調点の
//     ヒントに留め、scoring rule を上書きしない。
//   - 文字列は UI には出さない。AI prompt の内部 context にだけ流す。
const STATEMENT_APPLICANT_TYPE_HINTS: Record<ApplicantType, string> = {
  activity_driven:
    '活動・経験の言語化は厚くなりやすいが、問題意識や学問との接続が薄くなりがち。志望先での学びとの結びつきを丁寧に見る',
  issue_driven:
    '社会課題への問題意識は明確になりやすいが、自分の経験との具体的な接続が抜けがち。経験との結びつきと深掘りを意識する',
  academic_driven:
    '知的関心や探究意欲は強くなりやすいが、具体的な行動・経験への落とし込みが薄くなりがち。具体活動との接続を意識する',
  growth_driven:
    '自己変容の物語は伝わりやすいが、志望先での学びや将来像との接続が薄くなりがち。志望先との結びつきを意識する',
  value_driven:
    '原体験や価値観は伝わりやすいが、学問・将来像との論理的接続が抜けがち。価値観と志望先の接続を意識する',
};

export function buildStatementStudentProfileContext(
  profile: StudentProfile | null,
): string {
  if (!profile) return '';

  const parts: string[] = ['【自己分析サマリー】'];
  if (profile.summary) parts.push(profile.summary);

  if (profile.strengths.length) {
    parts.push(`強み: ${formatBulletList(profile.strengths, STRENGTHS_MAX, ' ')}`);
  }
  if (profile.weaknesses.length) {
    parts.push(`弱み: ${formatBulletList(profile.weaknesses, WEAKNESSES_MAX, ' ')}`);
  }
  if (profile.valueKeywords.length) {
    parts.push(`価値観タグ: ${formatInlineList(profile.valueKeywords, VALUE_KEYWORDS_MAX)}`);
  }

  // applicantType は optional。旧 StudentProfile（field 未保持）は何も追加しない。
  // 文言は「断定ではない参考情報」「本人を型に閉じ込めない」というニュアンスで固定する。
  if (profile.applicantType) {
    const label = APPLICANT_TYPE_LABELS[profile.applicantType];
    const hint = STATEMENT_APPLICANT_TYPE_HINTS[profile.applicantType];
    parts.push(`傾向（参考情報・断定ではない）: ${label} — ${hint}`);
  }

  return parts.join('\n');
}
