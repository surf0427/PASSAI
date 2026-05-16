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
import { formatBulletList, formatInlineList } from '@/lib/contextBuilders/common';

const STRENGTHS_MAX = 3;
const WEAKNESSES_MAX = 2;
const VALUE_KEYWORDS_MAX = 6;

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

  return parts.join('\n');
}
