// 面接で話せる要点を StudentProfile から派生する deterministic helper。
//
// 役割:
//   旧 SummaryResult.interviewPoints の代替。
//   AI を呼ばずに、StudentProfile（canonical artifact）の素材を「面接で答えるときの足場」
//   として並べ替える。strengths / signatureEpisodes / futureConnections / weaknesses を
//   1 件ずつ抽出し、想定質問とセットで提示する。
//
// canonical source:
//   StudentProfile のみ。analyzeState.summary は補助参照しない
//   （StudentProfile に必要素材は揃っており、二重参照は drift の原因になるため）。
//
// 制約:
//   - /api/summarize に interviewPoints を戻さない（summary API 責務は変えない）
//   - AI は呼ばない（純粋関数）
//   - 出力は最大 4 件（強み / 経験 / 将来 / 弱み）。素材が空ならその項目は省く
//
// 関連:
//   - types/studentProfile.ts
//   - lib/getStudentProfileForFeature.ts
//   - lib/contextBuilders/interviewContext.ts（server-side prompt 用、別レーン）
//   - app/interview/page.tsx（consumer）
//   - app/interview/components/InterviewTalkingPointsCard.tsx（render）

import type { StudentProfile } from '@/types/studentProfile';

export type InterviewTalkingPointCategory =
  | '強み'
  | '代表的な経験'
  | '将来像'
  | '弱みへの向き合い方';

export type InterviewTalkingPoint = {
  category: InterviewTalkingPointCategory;
  headline: string; // 想定質問・切り口
  body: string;     // 話す内容のコア
};

export function buildInterviewTalkingPoints(
  profile: StudentProfile | null,
): InterviewTalkingPoint[] {
  if (!profile) return [];
  const points: InterviewTalkingPoint[] = [];

  // 1. 強み（PR 寄りの定番質問）
  const topStrength = pickFirstNonEmpty(profile.strengths);
  if (topStrength) {
    points.push({
      category: '強み',
      headline: '「あなたの強みは？」と聞かれたら',
      body: topStrength,
    });
  }

  // 2. 代表的な経験（具体的な裏付け）
  const topEpisode = profile.signatureEpisodes?.find(
    (e) => typeof e?.summary === 'string' && e.summary.trim().length > 0,
  );
  if (topEpisode) {
    const title = topEpisode.title?.trim();
    const body = topEpisode.summary.trim();
    points.push({
      category: '代表的な経験',
      headline: '具体的なエピソードを語るときは',
      body: title ? `${title}：${body}` : body,
    });
  }

  // 3. 将来像（志望理由との接続）
  const topFuture = pickFirstNonEmpty(profile.futureConnections);
  if (topFuture) {
    points.push({
      category: '将来像',
      headline: '「将来やりたいことは？」と聞かれたら',
      body: topFuture,
    });
  }

  // 4. 弱みへの向き合い方（突っ込み質問への構え）
  const topWeakness = pickFirstNonEmpty(profile.weaknesses);
  if (topWeakness) {
    points.push({
      category: '弱みへの向き合い方',
      headline: '「弱みは？」と聞かれたら（補強として何をしているかも添える）',
      body: topWeakness,
    });
  }

  return points;
}

// ── 内部 helper ───────────────────────────────────────────────────

function pickFirstNonEmpty(arr: readonly string[] | undefined | null): string {
  if (!arr) return '';
  for (const s of arr) {
    if (typeof s === 'string' && s.trim().length > 0) return s.trim();
  }
  return '';
}
