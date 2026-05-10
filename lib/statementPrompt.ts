import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildStatementUniversityContext } from '@/lib/buildStatementUniversityContext';

// ── 添削プロンプトのオプション ─────────────────────────────────
// university / faculty / department / essay は今回の添削対象。
// basicInfo / activityData / wallHittingResult は AI が文脈を踏まえるための補助情報。
export type StatementReviewPromptOptions = {
  university: string;
  faculty: string;
  department: string;
  essay: string;
  basicInfo: BasicInfo | null;
  activityData: ActivityData | null;
  wallHittingResult: WallHittingResult | null;
};

// 受験方式に応じた添削方針を生成する。志望理由書専用の文言。
function buildExamTypeStatementGuidance(examTypes: string[] | undefined): string {
  const types = examTypes ?? [];
  const rules: string[] = [];

  if (types.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）対策として、活動経験・将来目標・学びたい内容の一貫性を厳しめにチェックする。一貫性が弱ければ weaknesses に明記する。');
  }
  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜対策として、評定平均・学校生活・推薦理由との自然な接続を評価する。校内活動への言及があると加点要素として扱う。');
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、推薦・総合型を使う理由が不自然になっていないかをチェックする。「保険」と読める表現があれば weaknesses で指摘する。');
  }
  if (types.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、語学力・国際経験との接続も評価軸に加える。');
  }
  if (types.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定のため、特定方式に偏らず汎用的に評価する。');
  }
  if (rules.length === 0) return '';
  return ['【受験方式に応じた添削方針】', ...rules].join('\n');
}

// 活動整理データを短く要約してプロンプトに差し込む。
// 詳細をすべて入れると膨らむため、件数と主要なラベルだけ列挙する。
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
  return ['【活動概要】', ...lines].join('\n');
}

function buildWallHittingContext(result: WallHittingResult | null): string {
  if (!result) return '';
  const parts: string[] = ['【自己分析サマリー】'];
  if (result.summary) parts.push(result.summary);
  if (result.strengths?.length) parts.push(`強み: ${result.strengths.slice(0, 3).map((s) => `・${s}`).join(' ')}`);
  if (result.weaknesses?.length) parts.push(`弱み: ${result.weaknesses.slice(0, 2).map((w) => `・${w}`).join(' ')}`);
  return parts.join('\n');
}

export function buildStatementReviewPrompt(opts: StatementReviewPromptOptions): string {
  const { university, faculty, department, essay, basicInfo, activityData, wallHittingResult } = opts;

  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const universityDbSection = buildStatementUniversityContext({
    university,
    faculty,
    department,
  });
  const activitySection = buildActivityContext(activityData);
  const wallHittingSection = buildWallHittingContext(wallHittingResult);
  const examTypeGuidance = buildExamTypeStatementGuidance(basicInfo?.examTypes);
  const departmentLine = department ? `\n志望学科：${department}` : '';
  const departmentRule = department
    ? '- 学科が指定されているため、学部全体ではなく該当学科の専門性・カリキュラムとの適合度を一段細かく評価する。'
    : '';

  return `あなたは総合型選抜・学校推薦型選抜の指導に精通したアドバイザーです。

【基本ルール】
- 志望理由書の全文を書き直したり、完成文を代わりに生成したりしてはいけません
- 提出者が自分で改善できるよう、アドバイスのみを行ってください
- 出力はJSONのみ。前後の説明文・コードブロックは不要です

---
${basicInfoSection}

【今回の添削対象】
志望大学：${university || '（未入力）'}
志望学部：${faculty || '（未入力）'}${departmentLine}

${universityDbSection ? `${universityDbSection}\n\n` : ''}${activitySection ? `${activitySection}\n\n` : ''}${wallHittingSection ? `${wallHittingSection}\n\n` : ''}${examTypeGuidance ? `${examTypeGuidance}\n\n` : ''}【志望理由書本文】
${essay}
---

上記の志望理由書を以下の5観点で評価し、改善アドバイスをJSONで返してください。

【評価観点（各20点満点）】
- logic        : 論理構造（序論・本論・結論の流れ、主張の一貫性）
- specificity  : 具体性（数字・場面・エピソードの有無と深さ）
- universityFit: 大学との一致（志望大学・学部・学科のカリキュラム・研究・特色への言及）
- futureGoal   : 将来目標（目標の明確さ、学びとのつながり）
- originality  : 独自性（他の受験生と差別化できる個人の視点・経験）

【スコアルール】
- 各項目は8〜20点の範囲で採点すること（0〜7点は出さない）
- totalScore は 60〜100 の範囲にすること（60点未満は出さない）
- totalScore は各項目の合計と一致させること

【universityFit の採点基準】
- 志望大学・学部・学科の名称、授業名、研究室、教授名、教育方針などへの具体的な言及があれば加点
- 「他の大学でも通用する内容」だけの場合は12点以下にすること
- 大学名・学部名が未入力の場合は、汎用的な評価で採点すること
${departmentRule ? `${departmentRule}\n` : ''}
【originality の採点基準】
- 他の受験生との差別化ポイントが明確であれば高得点
- 「頑張った」「興味がある」等の抽象的な記述のみで差別化が見えない場合は12点以下にすること
- 弱い場合は weaknesses に「他の受験生との差別化ポイントが不明確」と明記すること

【actions の書き方ルール】
- 抽象的な表現は禁止。「具体性を上げる」「もっと書く」などはNG
- 必ず「何を・どのように・どのくらい」を含めること
- 各アクションは以下の形式に従うこと：
  「〇〇（具体的な行動）して、〇〇（何を書くか・調べるか）を〇〇字程度追加する」
- 例（OK）：「高校時代の部活動から1つ経験を選び、『課題→行動→結果→学び』の順で150字程度追加する」
- 例（OK）：「${university || '志望大学'}のウェブサイトで${faculty || '志望学部'}のカリキュラムを調べ、関連する授業名を1〜2つ本文に入れる」
- 例（NG）：「具体性を上げる」「大学との一致を強化する」

出力形式（JSONのみ・他の文字は不要）：
{
  "totalScore": <60〜100の整数>,
  "scores": {
    "logic": <8〜20の整数>,
    "specificity": <8〜20の整数>,
    "universityFit": <8〜20の整数>,
    "futureGoal": <8〜20の整数>,
    "originality": <8〜20の整数>
  },
  "strengths": ["この志望理由書の良い点（2〜3項目）"],
  "weaknesses": ["改善が必要な弱い点（2〜3項目）"],
  "actions": ["具体的な改善アクション（3項目・上記ルールに従うこと）"],
  "partialExamples": ["本文の一部を具体的に書き直した例（1〜2項目）"],
  "checklist": ["再提出前に確認すべき項目（3項目）"]
}`;
}
