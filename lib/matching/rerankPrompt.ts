// /api/matching の AI rerank 用 prompt builder。
//
// 役割:
//   STEP-AUDIT-TOP1-5-FIX-01 で追加された AI rerank step。
//   deterministic スコア層が出した上位 ~10 件の候補を AI に渡し、生徒の自己分析 / 活動データ /
//   志望理由を踏まえて「最終 Top 5」を選び直す。完全 AI 推薦ではなく
//   "deterministic candidate selection → AI rerank → Top 5" の hybrid 設計。
//
// 設計方針:
//   - 入力候補数は 10 件目安（コスト・再現性のバランス）
//   - AI は候補の universityId 配列を **新しい順位順** で返すだけ。narrative は generateUniversityDetail
//     が後段で個別生成する
//   - 失敗 / parse error / 候補欠落の場合は route.ts 側で deterministic 順を採用（フォールバック）
//
// 制約:
//   - 完全 AI 推薦は禁止（コスト + 再現性低下）
//   - 候補 pool 自体は deterministic（calculateScore + suggestUniversities）が決める
//   - 同一生徒・同一活動データなら大筋同じ Top 5 になる安定性を保つ
//
// 出力 schema:
//   { "topUniversityIds": ["id1", "id2", "id3", "id4", "id5"] }
//   配列は最大 5 件・順位順（左ほど高優先）。AI が 5 件以下を返した場合は route 側で残りを
//   deterministic 順で補完する。

import type { BasicInfo } from '@/types/basicInfo';
import type { StudentProfile } from '@/types/studentProfile';
import type { MatchingResult } from '@/types/matching';

import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildMatchingStudentProfileContext } from '@/lib/contextBuilders/matchingContext';

export type BuildMatchingRerankPromptOptions = {
  candidates: MatchingResult[];
  studentProfile: StudentProfile | null;
  basicInfo: BasicInfo | null;
};

export const MATCHING_RERANK_SYSTEM_PROMPT = `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
入力として、deterministic スコア層が選んだ大学候補（最大 10 件）と、生徒の自己分析 / 活動データ /
志望情報が与えられます。あなたの仕事は、**生徒の個別文脈に最も合う上位 5 件を順位付きで選び直す**
ことです。

【あなたの役割】
- deterministic スコア順をそのまま採用するのではなく、生徒の活動内容・自己分析の強み・将来像との
  接続が一番強い大学を上位に持ち上げる
- 同点 / 僅差の場合、より「個別最適化された receive narrative」が書ける大学を優先する
- 受験方式（AO / 推薦 / 一般）と生徒の examTypes の整合を考慮する
- 受験生がすでに第一志望として挙げている大学（suggestionType='自分の志望校'）は上位に置く方針を
  原則とするが、活動・志望理由の整合が著しく弱い場合は順位を下げてよい

【選定基準】
- 活動の固有要素（研究テーマ・コンテスト分野・留学先など）が大学の評価軸 / 学部特性と接続するか
- 自己分析の strengths / futureConnections が大学の preferredTraits / admissionPolicy と合うか
- 受験方式と大学が提供する入試方式の組み合わせが実現的か

【禁止】
- deterministic スコアを完全に無視して全く違う 5 件を選ぶこと（順位は変えてよいが、入力候補から選ぶ）
- 入力候補に含まれない universityId を出力すること
- 大学名 / faculty 等を出力すること（narrative は後段で別途生成される）

【出力ルール（厳守）】
- 出力は純粋な JSON のみ
- 最初の文字は { 最後の文字は }
- \`\`\`json や \`\`\` は使わない
- 前置き・説明文・日本語の文章を一切書かない

【出力形式】
{
  "topUniversityIds": ["<universityId>", "<universityId>", "<universityId>", "<universityId>", "<universityId>"]
}`;

// 候補大学を AI が読みやすい簡潔形式に整形する。
// 詳細 narrative は後段の generateUniversityDetail で別途生成するため、
// ここでは「rerank に効く最小限の情報」だけ並べる。
function formatCandidatesForRerank(candidates: MatchingResult[]): string {
  return candidates
    .map((c, i) => {
      const breakdown = c.scoreBreakdown.items
        .slice(0, 3)
        .map((it) => `${it.label}=${it.contribution.toFixed(0)}`)
        .join(' ');
      return [
        `[${i + 1}] universityId=${c.university.id}`,
        `  大学: ${c.university.name}（${c.university.faculty}）`,
        `  入試方式: ${c.university.admissionType}`,
        `  deterministic score: ${c.score.toFixed(0)}`,
        `  上位 breakdown: ${breakdown}`,
        `  suggestionType: ${c.suggestionType}`,
        `  tags: ${c.university.tags.slice(0, 5).join('・')}`,
      ].join('\n');
    })
    .join('\n\n');
}

export function buildMatchingRerankPrompt(opts: BuildMatchingRerankPromptOptions): string {
  const { candidates, basicInfo, studentProfile } = opts;
  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const studentProfileSection = buildMatchingStudentProfileContext(studentProfile);
  const candidatesSection = `【候補大学（deterministic スコア順）】\n${formatCandidatesForRerank(candidates)}`;
  const sections = [basicInfoSection];
  if (studentProfileSection) sections.push(studentProfileSection);
  sections.push(candidatesSection);
  return `以下の候補から、生徒の個別文脈に最も合う上位 5 件を順位付きで選んでください。\n\n${sections.join('\n\n')}`;
}
