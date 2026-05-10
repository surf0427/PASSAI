// ── 文章生成層 (Narrative Layer) ─────────────────────────────────
// このAPIは Claude を使って各大学への narrative（reason / strengthPoints /
// weaknesses / actionItems / nextStep）を生成する。
//
// スコアリング層 (lib/matching/*) で deterministic に算出した
// MatchingResult[] を入力として受け取り、AI による文章だけを返す。
// 数値判定（スコア・breakdown）は AI に依存させない。
//
// TODO: 大学DB が整備されたら以下の処理を追加する
//   1. UniversityContext[] を受け取った時点で、それぞれの universityId をキーに
//      admissionPolicy / preferredTraits / preferredExperiences を DB から enrich
//   2. 学科別の面接傾向・小論文傾向を DB から取得して prompt に注入
//   3. 学科適性（学部より細かい deterministic 判定）を score breakdown に追加
//
import type { WallHittingResult } from '@/types/analysis';
import type { MatchingResult } from '@/types/matching';
import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { UniversityContext } from '@/types/universityContext';
import { anthropic, extractJson } from '@/lib/ai';
import {
  buildBasicInfoPromptSection,
  hasAnyDepartmentSpecified,
} from '@/lib/buildBasicInfoPromptSection';
import { buildUniversityContextPromptSection } from '@/lib/buildUniversityContext';
import {
  buildUniversityContextsFromBasicInfo,
  findUniversityContextByName,
} from '@/lib/matching/buildUniversityContextsFromBasicInfo';

// AI が生成する各大学への強化アドバイス
export type AiMatchAdvice = {
  universityId: string;
  reason: string;
  strengthPoints: string[];
  weaknesses: string[];
  actionItems: string[];
  nextStep?: string;
};

// JSON.parse を安全に行う
function safeParseJson<T>(text: string): T {
  const textToParse = extractJson(text);
  try {
    return JSON.parse(textToParse) as T;
  } catch (error) {
    console.error("JSON parse failed:", error);
    console.error("Text to parse:", textToParse);
    throw error;
  }
}

// 受験方式に応じたAI助言の方針を生成する。マッチング機能専用の文言。
// examTypes が複数選択されている場合はそれぞれのルールを併記する。
function buildExamTypeMatchingGuidance(
  examTypes: string[] | undefined,
  hasDepartment: boolean,
): string {
  const types = examTypes ?? [];
  const rules: string[] = [];

  if (types.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）対策として、活動の一貫性・探究性・将来目標・主体性を重視して判定する。');
  }
  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜対策として、評定平均（GPA）・学校生活・安定性・継続力を最重要視して判定する。');
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、一般受験との両立負担・推薦利用の現実性を踏まえて助言する。');
  }
  if (types.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、語学力・国際経験の評価軸も加味する。');
  }
  if (types.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定のため、複数方式を比較しながら選び方の助言も行う。');
  }
  if (hasDepartment) {
    rules.push('- 学科名が指定されている場合は、学部全体ではなく該当学科の専門性・カリキュラムとの適合度を一段細かく判定する。');
  }

  if (rules.length === 0) return '';
  return ['【受験方式に応じた助言ルール】', ...rules].join('\n');
}

// 活動整理の概要を短く整形する。詳細は出さず件数とラベルだけ出して、AI の文脈に渡す。
function buildActivityContext(data: ActivityData | null): string {
  if (!data) return '';
  const lines: string[] = [];
  if (data.clubActivities?.length) lines.push(`部活: ${data.clubActivities.map((a) => a.clubName).filter(Boolean).join('・') || `${data.clubActivities.length}件`}`);
  if (data.volunteerActivities?.length) lines.push(`ボランティア: ${data.volunteerActivities.length}件`);
  if (data.researchActivities?.length) lines.push(`探究: ${data.researchActivities.map((a) => a.theme).filter(Boolean).join('・') || `${data.researchActivities.length}件`}`);
  if (data.studyAbroadActivities?.length) lines.push(`留学: ${data.studyAbroadActivities.length}件`);
  if (data.contestActivities?.length) lines.push(`コンテスト: ${data.contestActivities.length}件`);
  if (data.certificationActivities?.length) lines.push(`資格: ${data.certificationActivities.map((a) => a.certificationName).filter(Boolean).join('・') || `${data.certificationActivities.length}件`}`);
  if (lines.length === 0) return '';
  return ['【活動整理の概要】', ...lines].join('\n');
}

// 1大学分の詳細アドバイス生成プロンプト（文字数制限を明示）。
// 入力は文章生成に必要な「すでに整形済みの情報」だけを受け取る。
type BuildDetailPromptOptions = {
  result: MatchingResult;
  selfAnalysis: WallHittingResult;
  basicInfo: BasicInfo | null;
  activityData: ActivityData | null;
  universityContext: UniversityContext | null;
};

function buildDetailPrompt(opts: BuildDetailPromptOptions): string {
  const { result, selfAnalysis, basicInfo, activityData, universityContext } = opts;
  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const universityContextSection = buildUniversityContextPromptSection(universityContext);
  const activitySection = buildActivityContext(activityData);
  const guidanceSection = buildExamTypeMatchingGuidance(
    basicInfo?.examTypes,
    hasAnyDepartmentSpecified(basicInfo),
  );

  return `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の生徒データと大学情報をもとに、この大学への受験アドバイスをJSON形式で出力してください。

${basicInfoSection}
${activitySection ? `\n${activitySection}\n` : ''}
【自己分析サマリー】
${selfAnalysis.summary}

強み: ${selfAnalysis.strengths.slice(0, 3).map((s) => `・${s}`).join(' ')}
弱み: ${selfAnalysis.weaknesses.slice(0, 2).map((w) => `・${w}`).join(' ')}
${guidanceSection ? `\n${guidanceSection}\n` : ''}${universityContextSection ? `\n${universityContextSection}\n` : ''}
【大学情報（スコアリング層から）】
大学ID: ${result.university.id}
大学名: ${result.university.name}（${result.university.faculty}）
入試方式: ${result.university.admissionType}
スコア: ${result.score}点
特徴: ${result.university.description}

【出力ルール（必ず守ること）】
- reason: 120文字以内
- strengthPoints: 60文字以内の文字列、最大3つ
- weaknesses: 60文字以内の文字列、最大3つ
- actionItems: 60文字以内・「〜する」で終わる文、最大3つ
- nextStep: 80文字以内
- 「汎用的な褒め文章」にしない。志望大学・学部・学科・評定平均・受験方式・活動整理・自己分析の具体に踏み込むこと。

【出力形式】
必ずJSONのみを出力してください。説明文・補足・前置き・後書きは一切禁止です。
最初の1文字は「{」、最後の1文字は「}」にしてください。
{
  "universityId": "${result.university.id}",
  "reason": "...",
  "strengthPoints": ["..."],
  "weaknesses": ["..."],
  "actionItems": ["..."],
  "nextStep": "..."
}`;
}

// 1大学分の詳細アドバイスを生成する
async function generateUniversityDetail(
  opts: BuildDetailPromptOptions,
): Promise<AiMatchAdvice> {
  const universityId = opts.result.university.id;
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: buildDetailPrompt(opts) }],
  });

  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `Claude response was truncated by max_tokens for university ${universityId}. Reduce output length or increase max_tokens.`,
    );
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';

  return safeParseJson<AiMatchAdvice>(raw);
}

// 大学候補リストを返す
// 現在はクライアント側で生成済みの上位5件をそのまま使用。
// TODO: 大学DBが整備されたら、universityContexts（admission policy 等）を見て
//   AI に候補を再ランクさせる選択肢も検討する。
async function generateUniversityCandidates(
  _selfAnalysis: WallHittingResult,
  results: MatchingResult[],
): Promise<MatchingResult[]> {
  return results.slice(0, 5);
}

export async function POST(req: Request) {
  const body = await req.json();
  // スコアリング層からの出力（クライアント側で計算済み）
  const results: MatchingResult[] | undefined = body.results;
  // 自己分析。後方互換のため body.wallHitting と body.selfAnalysis の両方を受ける。
  const selfAnalysis: WallHittingResult | undefined = body.selfAnalysis ?? body.wallHitting;
  // 基本情報（任意・未送信時 null フォールバック）
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;
  // 活動整理データ（任意）
  const activityData: ActivityData | null = body.activityData ?? null;
  // 各志望校の UniversityContext。クライアント側で構築されて送られてくることもあれば、
  // basicInfo から派生させることもある。
  // TODO: 将来は basicInfo.preferences[*].university から大学DBを引き当てて
  //   admissionPolicy / preferredTraits / requiredGpa などを enrich する処理をここに追加する。
  const universityContexts: UniversityContext[] =
    body.universityContexts ?? buildUniversityContextsFromBasicInfo(basicInfo);

  if (!selfAnalysis || !results || results.length === 0) {
    return Response.json({ error: 'selfAnalysis and results are required' }, { status: 400 });
  }

  try {
    const candidates = await generateUniversityCandidates(selfAnalysis, results);
    const advices = await Promise.all(
      candidates.map((candidate) =>
        generateUniversityDetail({
          result: candidate,
          selfAnalysis,
          basicInfo,
          activityData,
          // 候補大学に対応する UniversityContext を引く（無ければ null）。
          // DB enrich されている場合は admission policy 等が prompt に流れる。
          universityContext: findUniversityContextByName(
            universityContexts,
            candidate.university.name,
          ),
        }),
      ),
    );
    return Response.json({ advices });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Matching AI error:', msg);
    return Response.json({ error: 'AI matching failed', detail: msg }, { status: 500 });
  }
}
