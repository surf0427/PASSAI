import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import type { StudentProfile } from '@/types/studentProfile';
import type { NgWordIssue } from '@/lib/detectNgWords';
import type { StructureAnalysis } from '@/lib/structureAnalysis';
import { toStudentProfile } from '@/lib/studentProfile';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildStatementUniversityContext } from '@/lib/statement/review/buildStatementUniversityContext';
// 【context builder layer】StudentProfile → feature-specific context への変換は
// lib/contextBuilders/ 配下に集約された。statementPrompt.ts は prompt builder 層に専念する。
import { buildStatementStudentProfileContext } from '@/lib/contextBuilders/statementContext';
// STEP15b: subjectGrades semantic instruction（shared）を SYSTEM_PROMPT に接続する。
// 文字列の中身は lib/prompts.ts に集約。本ファイルは「statement-review でどう使うか」だけ持つ。
// これら 2 つの const の文字列が lib/prompts.ts 側で変わったら STATEMENT_REVIEW_PROMPT_VERSION
// （lib/aiInputHash.ts）を必ず bump すること。
import {
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
} from '@/lib/prompts';

// ── 添削プロンプトのオプション ─────────────────────────────────
// university / faculty / department / essay は今回の添削対象。
// basicInfo / activityData は AI が文脈を踏まえるための補助情報。
//
// 自己分析素材は studentProfile / wallHittingResult の両方を受け取る:
//   - studentProfile: クライアントが localStorage の canonical artifact から渡してきた場合に使う。最優先
//   - wallHittingResult: 後方互換用。studentProfile が無い場合に内部で toStudentProfile() で派生
// どちらも null なら自己分析セクションをプロンプトに含めない。
export type StatementReviewPromptOptions = {
  university: string;
  faculty: string;
  department: string;
  essay: string;
  basicInfo: BasicInfo | null;
  activityData: ActivityData | null;
  studentProfile?: StudentProfile | null;
  wallHittingResult: WallHittingResult | null;
  // STEP4b: 大学側の評価軸（入試タイプ推定）を user prompt に optional 差し込みするための context。
  // route.ts 側で getAdmissionFocusContextForUser() から取得して渡す。
  // 未指定 / 空文字なら従来通り該当 section をプロンプトに含めない（旧 v2 と意味等価）。
  admissionFocusContext?: string;
  // DET-2: NG 指摘候補（deterministic 検出済）。route.ts 側で detectNgWords() を
  // AI call 前に走らせて渡す。AI は同じ phrase を再判定せず、改善提案や深い構造分析に
  // 注力する。空配列 / 未指定なら【既知のNG指摘候補】section をプロンプトに含めない
  // （旧 v6 と意味等価）。NG 検出は essay / activityData / university / faculty から
  // deterministic に派生するため hash 入力には含めない（hash signature 不変）。
  ngIssues?: NgWordIssue[];
  // DET-4: 構造分析結果（deterministic 検出済）。route.ts 側で analyzeStructure() を
  // AI call 前に走らせて渡す。AI は同じ 6 要素を再判定せず、改善提案 / partialExamples /
  // actions に注力する。空配列 / 未指定なら【既存構造分析】section をプロンプトに含めない
  // （旧 v7 と意味等価）。構造分析は essay から deterministic に派生するため hash 入力には
  // 含めない（hash signature 不変）。DET-2 の NG section と独立 / 共存する。
  structureAnalysis?: StructureAnalysis[];
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
  if (data.otherActivities?.length) lines.push(`その他: ${data.otherActivities.map((a) => a.activityName).filter(Boolean).join('・') || `${data.otherActivities.length}件`}`);
  if (lines.length === 0) return '';
  return ['【活動概要】', ...lines].join('\n');
}

// DET-2: deterministic NG 検出結果を AI に "既知" として提示する section。
// 再判定 / 重複指摘を抑えて、改善提案 / 構造分析に token を割かせる目的。
// issue 数が 0 / undefined のときは空文字を返し、section を出さない（旧 v6 と意味等価）。
// phrase + reason のみ載せる（suggestion / activityHint / starterHint 等は AI 側の責務として残す）。
function buildNgIssuesSection(issues: NgWordIssue[] | undefined): string {
  if (!issues || issues.length === 0) return '';
  const lines = issues.map((i) => `- 「${i.phrase}」：${i.reason}`);
  return [
    '【既知のNG指摘候補】',
    '以下は deterministic ルールベース検出器が既に判定済みの NG パターンです。これらを再判定するのではなく、改善提案や深い構造分析に注力してください。',
    '',
    ...lines,
  ].join('\n');
}

// DET-4: deterministic 構造分析結果（6 要素の score 0〜2）を AI に "既知" として提示する section。
// 再判定 / 重複指摘を抑えて、改善提案 / partialExamples / actions に token を割かせる目的。
// analyzeStructure は常に 6 要素を返す pure 関数（lib/structureAnalysis.ts）。万一空配列が来た
// 場合は空文字を返し section を出さない（旧 v7 と意味等価）。各要素は `type: score` の 1 行形式で
// 出力する（簡潔さ優先、reason / hint は AI 側の責務として残す）。
// DET-2 の NG section と独立 / 共存する。AI は両 section を踏まえた重複しない指摘に集中する。
function buildStructureAnalysisSection(
  analyses: StructureAnalysis[] | undefined,
): string {
  if (!analyses || analyses.length === 0) return '';
  const lines = analyses.map((a) => `${a.type}: ${a.score}`);
  return [
    '【既存構造分析】',
    '',
    ...lines,
    '',
    '以下は deterministic 構造分析結果です。',
    'これらを再判定するのではなく、改善提案や具体例作成に注力してください。',
  ].join('\n');
}

// 【LEGACY】WallHittingResult を直接プロンプトに流すレガシー経路。
// 新しい下流コードは buildStudentProfileContext(toStudentProfile(result)) を使うこと。
// このタスクでは段階移行のため残してある（他に呼び出し元が無くなり次第削除可）。
export function buildWallHittingContext(result: WallHittingResult | null): string {
  if (!result) return '';
  const parts: string[] = ['【自己分析サマリー】'];
  if (result.summary) parts.push(result.summary);
  if (result.strengths?.length) parts.push(`強み: ${result.strengths.slice(0, 3).map((s) => `・${s}`).join(' ')}`);
  if (result.weaknesses?.length) parts.push(`弱み: ${result.weaknesses.slice(0, 2).map((w) => `・${w}`).join(' ')}`);
  return parts.join('\n');
}

// 旧 buildStudentProfileContext はこのファイルから lib/contextBuilders/statementContext.ts に
// 移設し、buildStatementStudentProfileContext へリネームした。context builder layer 参照。

// ── STEP3.2: static rule を system パラメータへ切り出し ──────────
// 「毎回変わらない指示」（役割宣言・採点ルール・JSON schema 等）を SYSTEM_PROMPT に固定し、
// user 側（buildStatementReviewPrompt）には「今回の入力データ」だけを渡す。これにより:
//   1. interview-feedback / essay-review と同じ system / user 分離構造に揃う
//   2. 将来 prompt caching（cache_control）を system 部にかけられる足場になる
// 現状 prompt caching 自体は未適用（STEP3.1 の調査で system 候補が ~1,589 tokens と
// Sonnet 4-6 の実効 caching 閾値 ~2,048+ を下回るため、cache_control は付けない）。
//
// 不変条件:
//   - prompt の意味を変えない（採点軸・スコア範囲・JSON schema は一切変えない）
//   - actions 例の ${university} / ${faculty} interpolation は generic literal に置換した。
//     実大学名は user 側 dynamic context（【今回の添削対象】）に既に存在するため。
//   - departmentRule は user 側の条件分岐から system 側の unconditional な条件文に移した。
//     department 未指定時は条件が満たされず影響しない、という意味で同等。
//
// STEP15b: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）を import
//   - route 固有の field-level 制約（採点軸を動かさない / weaknesses[0] の置き方 等）は
//     下記 STATEMENT_REVIEW_SUBJECT_GRADES_QUALIFIER に書く。route 内 const のため非 export。
//   - 挿入位置は役割宣言の直後・既存「基本ルール」の前。
//   - user prompt（buildStatementReviewPrompt の戻り値）は本 STEP では 1 文字も変えない。

// statement-review 固有の subjectGrades 取り扱い制約。
// 採点 5 軸（logic / specificity / universityFit / futureGoal / originality）には反映させず、
// strengths / weaknesses / actions の文脈内でのみ参照させる。weaknesses[0] への置き方など
// field-level の制約はここで縛る。shared 側（lib/prompts.ts）で AO/推薦混同や断定は既に禁止済み。
const STATEMENT_REVIEW_SUBJECT_GRADES_QUALIFIER = `【本 route での subjectGrades の使い方】
・採点（totalScore / scores の 5 軸 logic / specificity / universityFit / futureGoal / originality）には subjectGrades を反映しない。採点は本文の質のみで行う。

・subjectGrades は strengths / weaknesses / actions の文脈内でだけ参照する。

・志望学部に関連する科目の高評定は、活動・志望理由とセットで strengths または actions に接続してよい。評定値単独で strengths にしない。

・志望学部に関連しない科目の低評定を weaknesses[0] に置かない。weaknesses[0] は本文の論理・具体性・大学一致・将来目標・独自性のいずれかから選ぶ。

・志望学部に関連する科目の低評定は weaknesses に含めてよい。

・評定が低くても志望理由書の改善で挽回できる前提を保つ。「評定が低いので合格は難しい」型の文を書かない。

・評定が高くても、本文の論理・具体性が薄い場合は本文改善を最優先する。評定の高さで本文の弱さを上書きしない。

・subjectGrades 未入力時はこの指示を一切適用せず、本文の質のみで採点・添削する。`;

// DET-2: user prompt に【既知のNG指摘候補】section が来た時の解釈ルール。
// AI が同じ phrase を再 discovery して weaknesses を機械的に並べることを抑え、
// 改善提案 / 深い構造分析 / partial examples の質を上げる方向に token を割かせる。
// section が未提示のときは本 qualifier を適用しない（後方互換）。
const STATEMENT_REVIEW_NG_ISSUES_QUALIFIER = `【既知のNG指摘候補について】
・user prompt に【既知のNG指摘候補】section が含まれている場合、それは deterministic ルールベース検出器が既に判定済みの NG パターンです。

・同じ phrase に対して再判定や同じ趣旨の weaknesses を繰り返さないでください。weaknesses に機械的に並べる必要はありません。

・検出済みの NG を踏まえた改善提案 / 深い構造分析 / 具体的な partial examples の質を上げることに token を割いてください。

・deterministic 検出に含まれていない論理・具体性・大学一致・将来目標・独自性の弱点は従来通り自前で判断してください。

・採点（totalScore / scores の 5 軸）には NG 検出を直接反映しない。採点は本文の質のみで行う（NG が多くても 5 軸の採点ルールを優先）。

・section が含まれていない場合は、本ルールを適用せず従来通りすべて自前で判断してください。`;

// DET-4: user prompt に【既存構造分析】section が来た時の解釈ルール。
// AI が同じ 6 要素（trigger / problem / action / learning / future / universityConnection）の
// 検出を再 discovery することを避け、改善提案 / partialExamples / actions の質を上げる方向に
// token を割かせる。DET-2 の NG_ISSUES_QUALIFIER と同形・同思想。
// section が未提示のときは本 qualifier を適用しない（後方互換）。
const STATEMENT_REVIEW_STRUCTURE_ANALYSIS_QUALIFIER = `【既存構造分析について】
・user prompt に【既存構造分析】section が含まれている場合、それは deterministic ルールベース検出器が既に判定済みの 6 要素（trigger / problem / action / learning / future / universityConnection）の評価結果です。各要素 0〜2 の整数で、2=明確に含まれる / 1=部分的 / 0=本文から読み取れない。

・同じ 6 要素を再判定したり、同じ趣旨の weaknesses を機械的に並べたりしないでください。

・検出済みのスコアを踏まえた改善提案 / partialExamples / actions の質を上げることに token を割いてください。特に score=0 の要素は本文に欠落している前提で、「何を 1 文追加すれば補えるか」を行動レベルで示してください。

・採点（totalScore / scores の 5 軸: logic / specificity / universityFit / futureGoal / originality）には deterministic 構造分析結果を直接反映しない。採点は本文の質のみで行う（構造分析の合計を score に変換しない）。

・section が含まれていない場合は、本ルールを適用せず従来通りすべて自前で判断してください。`;

export const STATEMENT_REVIEW_SYSTEM_PROMPT = `あなたは総合型選抜・学校推薦型選抜の指導に精通したアドバイザーです。

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${STATEMENT_REVIEW_SUBJECT_GRADES_QUALIFIER}

${STATEMENT_REVIEW_NG_ISSUES_QUALIFIER}

${STATEMENT_REVIEW_STRUCTURE_ANALYSIS_QUALIFIER}

【基本ルール】
- 志望理由書の全文を書き直したり、完成文を代わりに生成したりしてはいけません
- 提出者が自分で改善できるよう、アドバイスのみを行ってください
- 出力はJSONのみ。前後の説明文・コードブロックは不要です

【トーンと文体（厳守）】
- 「次に何を直すか」が最短で伝わることを最優先する
- 前置き・総評の言い換え・自己言及（「以下に評価を…」等）は書かない
- 称賛だけの修飾（「素晴らしい」「とても良い」）は使わない。指摘は事実ベースで端的に
- 同じ趣旨を別の言い方で繰り返さない
- 1 文は短く（目安 60 字以内）。説教調・精神論を避け、行動レベルで書く

【優先度の付け方（必須）】
- weaknesses / actions は「直すと最も差が出る順」に並べる。配列の 0 番目が最重要
- partialExamples は弱点の核に対応する箇所を 1〜2 個だけ示す

【出力長の上限】
- strengths / weaknesses の各要素は 60〜100 字以内
- actions の各要素は 100〜140 字以内（具体行動を 1 文で言い切る）
- partialExamples の各要素は 180〜220 字以内
- checklist の各要素は 40〜60 字以内

【評価観点（各20点満点）】
- logic        : 論理構造（序論・本論・結論の流れ、主張の一貫性）
- specificity  : 具体性（数字・場面・エピソードの有無と深さ）
- universityFit: 大学との一致（志望大学・学部・学科のカリキュラム・研究・特色への言及）
- futureGoal   : 将来目標（目標の明確さ、学びとのつながり）
- originality  : 独自性（他の受験生と差別化できる個人の視点・経験）

【スコアルール】
- 各項目は8〜20点の範囲で採点すること（0〜7点は出さない）
- totalScore は各項目（logic + specificity + universityFit + futureGoal + originality）の単純合計値をそのまま入れる
- totalScore はサーバ側で各項目から再計算されるため、最低値の底上げや帳尻合わせの調整は行わない

【universityFit の採点基準】
- 志望大学・学部・学科の名称、授業名、研究室、教授名、教育方針などへの具体的な言及があれば加点
- 「他の大学でも通用する内容」だけの場合は12点以下にすること
- 大学名・学部名が未入力の場合は、汎用的な評価で採点すること
- 学科が指定されている場合は、学部全体ではなく該当学科の専門性・カリキュラムとの適合度を一段細かく評価すること

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
- 例（OK）：「志望大学のウェブサイトで志望学部のカリキュラムを調べ、関連する授業名を1〜2つ本文に入れる」
- 例（NG）：「具体性を上げる」「大学との一致を強化する」

出力形式（JSONのみ・他の文字は不要）：
{
  "totalScore": <5項目の単純合計（整数）>,
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

export function buildStatementReviewPrompt(opts: StatementReviewPromptOptions): string {
  const { university, faculty, department, essay, basicInfo, activityData } = opts;

  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const universityDbSection = buildStatementUniversityContext({
    university,
    faculty,
    department,
  });
  // STEP4b: route.ts 側で生成済みの string をそのまま使う（空文字なら section を出さない）。
  // 型名（活動アピール型 等）を本文で強調しないガードは helper 側の STATE_C_AI_NOTE に集約済み。
  const admissionFocusSection = opts.admissionFocusContext ?? '';
  const activitySection = buildActivityContext(activityData);
  // 【StudentProfile canonical 経路】
  //   1. opts.studentProfile が来ていればそれを優先（クライアントが storage から取得して送信した経路）
  //   2. 無ければ opts.wallHittingResult から toStudentProfile() で派生（後方互換）
  //   3. どちらも無ければ null（自己分析セクションをプロンプトに含めない）
  // WallHittingResult を直接プロンプトに流さないことが重要（questions / answers が混入しない）。
  const studentProfile: StudentProfile | null =
    opts.studentProfile
      ?? (opts.wallHittingResult ? toStudentProfile(opts.wallHittingResult) : null);
  const wallHittingSection = buildStatementStudentProfileContext(studentProfile);
  const examTypeGuidance = buildExamTypeStatementGuidance(basicInfo?.examTypes);
  // DET-2: deterministic NG 検出結果（route.ts で detectNgWords を実行済）を section 化。
  // 空ならそのまま空文字。SYSTEM_PROMPT 側の NG_ISSUES_QUALIFIER と組で動く。
  const ngIssuesSection = buildNgIssuesSection(opts.ngIssues);
  // DET-4: deterministic 構造分析結果（route.ts で analyzeStructure を実行済）を section 化。
  // 空ならそのまま空文字。SYSTEM_PROMPT 側の STRUCTURE_ANALYSIS_QUALIFIER と組で動く。
  // DET-2 の NG section と独立 / 共存。AI は両 section を踏まえて重複しない指摘に集中する。
  const structureSection = buildStructureAnalysisSection(opts.structureAnalysis);
  const departmentLine = department ? `\n志望学科：${department}` : '';

  // 採点軸・トーン規律・JSON schema 等の static 部は STATEMENT_REVIEW_SYSTEM_PROMPT に
  // 切り出し済み（route.ts 側で system パラメータに渡す）。ここでは「今回の入力データ」だけを返す。
  // section 配置順: ...examTypeGuidance → structureSection（大局）→ ngIssuesSection（細部）→ 【本文】
  return `以下の志望理由書を採点・添削してください。

${basicInfoSection}

【今回の添削対象】
志望大学：${university || '（未入力）'}
志望学部：${faculty || '（未入力）'}${departmentLine}

${universityDbSection ? `${universityDbSection}\n\n` : ''}${admissionFocusSection ? `${admissionFocusSection}\n\n` : ''}${activitySection ? `${activitySection}\n\n` : ''}${wallHittingSection ? `${wallHittingSection}\n\n` : ''}${examTypeGuidance ? `${examTypeGuidance}\n\n` : ''}${structureSection ? `${structureSection}\n\n` : ''}${ngIssuesSection ? `${ngIssuesSection}\n\n` : ''}【志望理由書本文】
${essay}`;
}
