// 自己PR たたき台を StudentProfile / analyzeState から派生する deterministic helper。
//
// 役割:
//   旧 /api/summarize が返していた selfPRDraft の代替。
//   AI を呼ばずに、整理済み素材（StudentProfile.strengths / signatureEpisodes /
//   futureConnections / analyzeState.summary 等）を PR文っぽい雛形へ並べ替える。
//
// canonical source priority:
//   1. StudentProfile（lib/studentProfileStorage）— canonical artifact
//   2. analyzeState.summary（lib/analyzeStorage）— /api/summarize の出力。
//      StudentProfile が無い旧データでも seed を作れるよう fallback として参照する。
//   3. どちらの素材も無ければ null（呼び出し側で空 textarea / 旧 legacy draft drain にフォールバック）
//
// 制約:
//   - selfPRDraft の writer は復活させない（lib/selfPRDraftStorage の writer 廃止維持）
//   - /api/summarize の出力 schema は変えない（types/analysis.ts SummaryResult は 3 フィールドのまま）
//   - AI は呼ばない（純粋関数）。AI 改善は /api/reason の従来経路に任せる
//
// 関連:
//   - types/studentProfile.ts / types/analysis.ts
//   - lib/getStudentProfileForFeature.ts
//   - app/self-pr/page.tsx（consumer）

import type { StudentProfile } from '@/types/studentProfile';
import type { SummaryResult } from '@/types/analysis';

export type SelfPRDraftSeedInput = {
  profile: StudentProfile | null;
  analyzeSummary: SummaryResult | null;
};

// PR文っぽい段落の配列を 2 改行で結合した文字列を返す。
// 200〜400字を目安に組み立てるが、素材数で前後する（短くても OK、ユーザーが膨らませる前提）。
// 素材が全く無い場合は null（呼び出し側で「空のまま新規作成」に倒す）。
export function buildSelfPRDraftSeed(input: SelfPRDraftSeedInput): string | null {
  const { profile, analyzeSummary } = input;
  if (!profile && !analyzeSummary) return null;

  const topStrength = pickFirstNonEmpty(profile?.strengths);
  const topFuture = pickFirstNonEmpty(profile?.futureConnections);
  const topEpisode = pickFirstEpisode(profile);
  const profileSummary = profile?.summary?.trim() ?? '';
  const analyzeSummaryText = analyzeSummary?.activitySummary?.trim() ?? '';
  const summary = profileSummary || analyzeSummaryText;
  const appealPoints = analyzeSummary?.appealPoints?.trim() ?? '';

  // 最低限 1 つの実体的素材が必要。strength / episode / summary のいずれかが無いと
  // 「私の強みは、です。」のような空虚な雛形になるため、null に倒す。
  if (!topStrength && !topEpisode && !summary) return null;

  const paragraphs: string[] = [];

  // 1 行目: 強みの宣言（strength が最も "PR の核" として馴染む）。
  if (topStrength) {
    paragraphs.push(`私の強みは、${topStrength} です。`);
  }

  // 2 行目: 具体的なエピソード。signatureEpisode を優先、無ければ summary を回す。
  if (topEpisode) {
    const title = topEpisode.title?.trim();
    const body = topEpisode.summary.trim();
    paragraphs.push(
      title
        ? `特に印象に残っているのは「${title}」での経験です。${body}`
        : `特に印象に残っている経験として、${body}`,
    );
  } else if (summary && topStrength) {
    // strength が先頭に来たケースで episode が無いとき、summary を活動概要として後段に置く。
    paragraphs.push(`これまでの取り組みとしては、${summary}`);
  } else if (summary) {
    // strength も無い場合は summary を冒頭に置く。
    paragraphs.push(`これまで、${summary}`);
  }

  // 3 行目: アピールポイント（analyzeSummary 由来）。strength / episode と意味的に
  // 補完関係になることが多く、被るときは drop して冗長を避ける。
  if (appealPoints && !containsSubstring(paragraphs.join('\n'), appealPoints)) {
    paragraphs.push(appealPoints);
  }

  // 4 行目: 将来とのつながり（PR の締めとして自然）。
  if (topFuture) {
    paragraphs.push(`今後は、${topFuture} を目指したいと考えています。`);
  }

  return paragraphs.join('\n\n');
}

// ── 内部 helper ───────────────────────────────────────────────────

function pickFirstNonEmpty(arr: readonly string[] | undefined | null): string {
  if (!arr) return '';
  for (const s of arr) {
    if (typeof s === 'string' && s.trim().length > 0) return s.trim();
  }
  return '';
}

function pickFirstEpisode(
  profile: StudentProfile | null,
): { title: string; summary: string } | null {
  if (!profile?.signatureEpisodes) return null;
  for (const ep of profile.signatureEpisodes) {
    if (typeof ep?.summary === 'string' && ep.summary.trim().length > 0) {
      return { title: ep.title ?? '', summary: ep.summary };
    }
  }
  return null;
}

// 既に積んだ段落に同等の内容（appealPoints が strength や episode と重複するケース）が
// 含まれているなら重複追加を避ける。ゆるい部分一致で判定する。
function containsSubstring(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const norm = (s: string) => s.replace(/\s+/g, '');
  return norm(haystack).includes(norm(needle));
}
