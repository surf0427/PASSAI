// 志望校マッチング向けの context builder（純粋関数・AI 呼び出しなし）。
//
// 責務階層:
//   StudentProfile → [context builder layer] → prompt builder → AI
//
//   このファイルは「StudentProfile を matching 向け最小コンテキストへ変換する」だけ。
//   各大学への助言 prompt は app/api/matching/route.ts の prompt 組み立て側に置く（責務分離）。
//
// feature-specific 最適化:
//   matching は「学生像と複数大学の相性」を判定するため、自己分析の幅広い側面を見たい。
//   よって essay-review / interview-feedback より多めに使う:
//     summary             : 全文
//     strengths           : 上位 5 件（相性スコアの根拠）
//     weaknesses          : 上位 2 件（補強観点の根拠）
//     futureConnections   : 上位 3 件（志望先と将来像のブリッジ）
//     valueKeywords       : 上位 8 件（タグでの大学マッチング補助）
//     signatureEpisodes   : 上位 3 件（具体例。strengths 全文を再掲しないため）
//
//   ただし matching でも以下は絶対に渡さない（StudentProfile 設計の原則）:
//     - questions / answers      → 壁打ちフロー内部の working memory
//     - selfPRDraft / interviewPoints → 各 feature の artifact
//
//   format は multi-line bullets（`・a\n・b`）で視認性を優先。
//
// 関連: lib/studentProfile.ts(toStudentProfile)

import type { StudentProfile } from '@/types/studentProfile';
import { formatBulletList, formatInlineList } from '@/lib/contextBuilders/common';

const STRENGTHS_MAX = 5;
const WEAKNESSES_MAX = 2;
const FUTURE_CONNECTIONS_MAX = 3;
const VALUE_KEYWORDS_MAX = 8;
const SIGNATURE_EPISODES_MAX = 3;

export function buildMatchingStudentProfileContext(
  profile: StudentProfile | null,
): string {
  if (!profile) return '';

  const parts: string[] = ['【自己分析サマリー（matching 用）】'];

  if (profile.summary) parts.push(profile.summary);

  if (profile.strengths.length) {
    parts.push(`強み（上位 ${STRENGTHS_MAX}）:\n${formatBulletList(profile.strengths, STRENGTHS_MAX)}`);
  }

  if (profile.weaknesses.length) {
    parts.push(`弱み（上位 ${WEAKNESSES_MAX}）:\n${formatBulletList(profile.weaknesses, WEAKNESSES_MAX)}`);
  }

  if (profile.futureConnections.length) {
    parts.push(
      `将来とのつながり（上位 ${FUTURE_CONNECTIONS_MAX}）:\n${
        formatBulletList(profile.futureConnections, FUTURE_CONNECTIONS_MAX)
      }`,
    );
  }

  if (profile.valueKeywords.length) {
    parts.push(`価値観タグ: ${formatInlineList(profile.valueKeywords, VALUE_KEYWORDS_MAX)}`);
  }

  if (profile.signatureEpisodes.length) {
    const eps = profile.signatureEpisodes
      .slice(0, SIGNATURE_EPISODES_MAX)
      .map((e) => `・${e.title}：${e.summary}`)
      .join('\n');
    parts.push(`代表エピソード:\n${eps}`);
  }

  return parts.join('\n');
}
