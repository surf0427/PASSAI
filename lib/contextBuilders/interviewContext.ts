// 面接フィードバック向けの context builder（純粋関数・AI 呼び出しなし）。
//
// 責務階層:
//   StudentProfile → [context builder layer] → prompt builder → AI
//
//   このファイルは「StudentProfile を面接向け最小コンテキストへ変換する」だけ。
//   面接フィードバックの文言・採点軸・betterAnswer 指示は
//   app/api/interview-feedback/route.ts の prompt 組み立て側に置く（責務分離）。
//
// feature-specific 最適化:
//   面接は「話し方・一貫性・自然さ」が肝。prompt に長文を渡すほど betterAnswer が
//   不自然な暗記文化しやすいため、StudentProfile から「面接に必要な最小限」だけ抜き出す。
//     summary             : 受験生像の 1 文要約（必須）
//     strengths           : 上位 3 件（面接で実際に話す柱）
//     futureConnections   : 上位 2 件（志望理由とのブリッジ）
//     valueKeywords       : 上位 6 件（精神論ではなく行動文の補助）
//     signatureEpisodes   : 上位 2 件（代表例。strengths 全文を再掲しないため）
//   weaknesses は意図的に外す（面接 prompt では混乱の元になりやすい）。
//
//   format は multi-line bullets（`・a\n・b`）で視認性を優先。
//
// 関連: lib/studentProfile.ts(toStudentProfile)

import type { StudentProfile } from '@/types/studentProfile';
import { formatBulletList, formatInlineList } from '@/lib/contextBuilders/common';
// STEP E: applicantType（5 種）由来の「傾向」1 行 helper。
// interview-questions と同じ hint table（lib/interview/applicantTypeHint.ts）を共有する。
import { formatInterviewApplicantTypeHint } from '@/lib/interview/applicantTypeHint';

const STRENGTHS_MAX = 3;
const FUTURE_CONNECTIONS_MAX = 2;
const VALUE_KEYWORDS_MAX = 6;
const SIGNATURE_EPISODES_MAX = 2;

export function buildInterviewStudentProfileContext(
  profile: StudentProfile | null,
): string {
  if (!profile) return '';

  const parts: string[] = ['【自己分析サマリー（面接用・最小コンテキスト）】'];

  if (profile.summary) parts.push(profile.summary);

  if (profile.strengths.length) {
    parts.push(`強み（上位 ${STRENGTHS_MAX}）:\n${formatBulletList(profile.strengths, STRENGTHS_MAX)}`);
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

  // STEP E: applicantType（5 種 enum）由来の「傾向」1 行を末尾に optional 注入。
  // 旧 StudentProfile（applicantType undefined）では追加されず prompt 文字列従来と同一。
  // interview-questions と同じ hint table を共有しているため両 route で薄く整合した
  // 傾向情報が流れる（interview-feedback には input cache 機構がないので bump 対象外だが、
  // 出力挙動は副作用として変わる）。
  if (profile.applicantType) {
    parts.push(formatInterviewApplicantTypeHint(profile.applicantType));
  }

  return parts.join('\n');
}
