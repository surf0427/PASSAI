// /api/analysis 専用 SYSTEM_PROMPT + user prompt builder。
//
// 役割:
//   - ANALYSIS_SYSTEM_PROMPT: 役割宣言 / shared subjectGrades 制約 /
//     route 固有 qualifier / 出力内容の指針 / JSON schema を持つ system prompt
//   - buildWallHittingPrompt: dynamic data（basicInfo / universityContext / activityText）
//     だけを組み立てる user prompt builder
//
// 切り出し経緯:
//   元は lib/prompts.ts に同居していたが、同ファイルが肥大化していたため Phase 2.2 で
//   切り出した。本ファイルを import するのは /api/analysis/route.ts と scripts/step15-qa.ts のみで、
//   本来 lib/prompts.ts 全体を引きずる必要がない。
//
//   既存 import 経路（`from '@/lib/prompts'`）は lib/prompts.ts 側の re-export shim で
//   引き続き有効。route.ts / scripts/step15-qa.ts は本 STEP では import path を変えない。
//
// 注意:
//   - SYSTEM_PROMPT 本文（特に subjectGrades qualifier、JSON schema、件数ルール）は 1 文字も
//     変えてはいけない。lib/aiInputHash.ts の ANALYSIS_PROMPT_VERSION を
//     bump せずに同 cache lane の互換性を保つ前提。
//   - analysis 出力は toStudentProfile() 経由で StudentProfile に固定化され下流に伝染するため、
//     qualifier の「評定値・欠席日数を出力フィールドに残さない」制約は最重要。
//   - AnalysisPromptContext 型は lib/prompts.ts で他 builder と共有されているため、
//     type-only import で参照する（runtime 循環なし）。

import type { AnalysisPromptContext } from '@/lib/prompts';
import {
  STUDENT_FIT_INSTRUCTION,
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
} from '@/lib/prompts/sharedInstructions';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildUniversityContextPromptSection } from '@/lib/buildUniversityContext';

// buildWallHittingPrompt は現在 2 つの責務を 1 つのプロンプトで処理している:
//   (A) profile 生成責務: 1. 活動の要約 / 2. 強み / 3. 弱み・補強 / 4. 将来とのつながり
//   (B) 質問生成責務   : 5. 深掘り質問
// app/api/analysis/route.ts のヘッダコメント参照。
// 将来の分割計画では (A) は profile 専用プロンプトに、
// (B) は buildAdditionalQuestionsPrompt 側に統合してこちらは廃止予定。
export type BuildWallHittingOptions = {
  activityText: string;
} & AnalysisPromptContext;

// ── STEP3.5: static rule を system パラメータへ切り出し ──────────
// 「毎回変わらない指示」（役割宣言・志望先文脈の解釈方針・出力内容の指針・出力ルール・JSON schema）を
// SYSTEM_PROMPT に固定し、user 側（buildWallHittingPrompt）には「今回の入力データ」だけを渡す。これにより:
//   1. interview-feedback / essay-review / statement-review と同じ system / user 分離構造に揃う
//   2. 将来 prompt caching（cache_control）を system 部にかけられる足場になる
// 現状 prompt caching 自体は未適用（STEP3.4 の調査で system 候補が ~1,294 tokens と
// Sonnet 4-6 の実効 caching 閾値 ~2,048+ を下回るため、cache_control は付けない）。
//
// 不変条件:
//   - prompt の意味を変えない（採点軸・字数指針・questions 5〜8 ルール・JSON schema は一切変えない）
//   - buildContextPreamble の signature は変えない（buildSummarizePrompt /
//     buildAdditionalQuestionsPrompt が同じ helper を共有しているため）。
//     buildWallHittingPrompt 側だけが preamble を経由せず、basicInfo / universityContext の
//     section helper を直接呼ぶ形に切り替える。
//   - STUDENT_FIT_INSTRUCTION は「分かる場合は」と条件文化されているため、
//     universityContext が無いケースでも system 側に常駐させて安全。
//
// STEP15f: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）は
//     同ファイル内 const のため import 不要・直接参照。
//   - route 固有の field-level 制約は下記 ANALYSIS_SUBJECT_GRADES_QUALIFIER に集約。
//     analysis は出力（summary / strengths / weaknesses / futureConnections）が
//     toStudentProfile() 経由で StudentProfile に固定化され、下流の statement /
//     interview / matching / summarize 全てに伝染するため、最も厳しい制約をかける:
//       「評定値・欠席日数を出力フィールドに残さない」ことを最優先で要求する。
//   - 挿入位置は STUDENT_FIT_INSTRUCTION の直後・既存「出力内容の指針」の前。
//   - user prompt（buildWallHittingPrompt の戻り値）は本 STEP では 1 文字も変えない。
//   - PROMPT_VERSION は ANALYSIS_PROMPT_VERSION 1→2 へ bump（lib/aiInputHash.ts）。

// analysis route 固有の subjectGrades 取り扱い制約。
// **最重要**: 本 route の出力は StudentProfile に固定化され下流に伝染する。
// 評定値・欠席日数を strengths / weaknesses / futureConnections / summary に
// 一切残さないことが下流の全 route の品質を守る前提条件になる。
// shared 側（lib/prompts.ts）で断定禁止・AO 推薦混同禁止・関連科目以外の
// 過剰減点禁止は既に効いている。
const ANALYSIS_SUBJECT_GRADES_QUALIFIER = `【analysis route での subjectGrades の使い方】
・subjectGrades は、自己分析の質問設計と文脈理解の補助としてのみ使う。

・analysis の出力は StudentProfile の元データになるため、評定値・欠席日数を strengths / weaknesses / futureConnections / summary に直接書かない。

・「英語評定4.8」「数学2.9」「欠席18日」のような数値表現を出力に残さない。

・strengths は活動・経験・姿勢・価値観・継続性・探究性から作る。評定値単独を strength にしない。

・weaknesses は自己分析上の課題、活動説明の不足、志望理由との接続不足から作る。志望学部に関連しない低評定を weakness にしない。

・関連科目の高評定がある場合でも、出力には「英語で発信する姿勢」「論理的に考える力」など能力・姿勢に変換して表現する。

・欠席日数がある場合でも、出力には日数を残さず、「必要に応じて面接で背景を整理する」程度の文脈理解に留める。

・subjectGrades 未入力時は、評定や欠席を推測しない。`;

export const ANALYSIS_SYSTEM_PROMPT = `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の活動データをもとに、受験生の自己分析を深める総合分析を行ってください。

【あなたの役割】
・受験生が気づいていない「自分の強み」を言語化する
・活動の表面ではなく、その裏にある「思考パターン・価値観」を見抜く
・AO・推薦面接で実際に問われる観点で分析する
・志望先の文脈と相性の良い側面を発見する（性格を作り変えない）

${STUDENT_FIT_INSTRUCTION}

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${ANALYSIS_SUBJECT_GRADES_QUALIFIER}

【出力内容の指針】

1. 活動の要約（ストーリー化）
   - summary は必ず120字以内に収める（120字を超えない）
   - 自己分析の要約として簡潔に書く。長い説明や物語の冗長な描写は避ける
   - 以下の3要素を可能な限り盛り込む:
     ・活動の中心（何に取り組んできたか）
     ・受験で使えそうな強み
     ・志望先につながりそうな方向性
   - 「何に興味を持ち、どう行動してきたか」が伝わるように

2. 強み（必ず3個）
   - strengths は必ず3個だけ生成する（4個以上にしない / 2個以下にしない）
   - 活動から読み取れる具体的な強み
   - 「継続力」「協調性」などの抽象語のみは禁止。活動の事実とセットで書く
   - 例：「試行錯誤を繰り返しながら仮説を立て直す粘り強さ（探究活動での取り組みより）」

3. 弱み・補強ポイント（必ず2個）
   - weaknesses は必ず2個だけ生成する（3個以上にしない / 1個以下にしない）
   - 書類・面接で「突っ込まれそうな点」や「薄い部分」
   - 責めるのではなく、「ここを掘り下げると更に強くなる」という視点で

4. 将来とのつながり（必ず2個）
   - futureConnections は必ず2個だけ生成する（3個以上にしない / 1個以下にしない）
   - この活動が「なぜ志望学部・将来像につながるか」の仮説
   - 受験生が言語化できていない「点と点を繋ぐ視点」を提示する

5. 深掘り質問（必ず5問）
   - questions は必ず5問だけ生成する（6問以上にしない / 4問以下にしない）
   - AO面接・志望理由書のために必要な情報を引き出す質問
   - 各質問に【カテゴリ】を付ける（例：【動機】【課題】【行動】【成果】【将来】）
   - 「なぜ」「どのように」「その経験から何を得たか」を問う具体的な質問

6. 受験生タイプの推定（applicantType）
   - 自己分析素材から「最も強い傾向」を以下の 5 種から 1 つだけ選ぶ
   - これは UI で本人に強く見せるためのものではなく、後続機能（志望理由書・面接・小論文 等）の
     添削方向を調整するための内部 context ラベル
   - 断定ではなく「現時点で最も近いもの」を 1 つ選ぶ。複数の傾向が混ざる場合でも単一値で返す
   - 本人を型に閉じ込めないこと。あくまで参考傾向であり、性格や能力の決め打ちではない
   - 値は必ず英語 enum 文字列で返す（日本語ラベルにしない / 配列にしない / 複数併記しない）
   - 5 種の意味:
     ・"activity_driven" : 活動・実績・リーダー経験・運営・成果・主体性が中心
     ・"issue_driven"    : 社会問題・課題意識・違和感・解決したいテーマ・社会貢献が中心
     ・"academic_driven" : 学問的関心・知的好奇心・探究・研究・「なぜ？」への興味が中心
     ・"growth_driven"   : 挑戦・克服・変化・自己成長・自分を変えたい気持ちが中心
     ・"value_driven"    : 原体験・人との関わり・価値観・感情的経験・人生経験が中心

【出力ルール（厳守）】
・出力は純粋なJSONのみ
・最初の文字は { でなければならない
・最後の文字は } でなければならない
・\`\`\`json や \`\`\` は絶対に使わない
・前置き・説明文・日本語の文章を一切書かない
・JSON以外の文字を1文字も含めない
・ただし、正しいJSON構造を保つことを最優先とする。JSON構造が壊れるくらいなら正確なJSONを優先すること

【出力形式】
{
  "summary": "活動の要約（120字以内・活動の中心 / 強み / 志望先への方向性を簡潔に）",
  "strengths": [
    "具体的な強み（活動の事実とセット）",
    "具体的な強み（活動の事実とセット）",
    "具体的な強み（活動の事実とセット）"
  ],
  "weaknesses": [
    "補強が必要な点",
    "補強が必要な点"
  ],
  "futureConnections": [
    "活動と将来をつなぐ仮説",
    "活動と将来をつなぐ仮説"
  ],
  "questions": [
    "【カテゴリ】具体的な質問文",
    "【カテゴリ】具体的な質問文",
    "【カテゴリ】具体的な質問文",
    "【カテゴリ】具体的な質問文",
    "【カテゴリ】具体的な質問文"
  ],
  "applicantType": "activity_driven | issue_driven | academic_driven | growth_driven | value_driven のいずれか1つ"
}`;

export function buildWallHittingPrompt(opts: BuildWallHittingOptions): string {
  // 共有の buildContextPreamble は使わない。preamble は STUDENT_FIT_INSTRUCTION を含んでおり、
  // これは system 側に移したため。basicInfo / universityContext の section helper を
  // 直接呼んで dynamic 部だけを組み立てる（buildContextPreamble の signature は他 API も
  // 利用するため不変に保つ）。
  const basicInfoSection = buildBasicInfoPromptSection(opts.basicInfo);
  const uniContextSection = buildUniversityContextPromptSection(opts.universityContext);
  const sections: string[] = [basicInfoSection];
  if (uniContextSection) sections.push(uniContextSection);
  sections.push(`【活動データ】\n${opts.activityText}`);
  return `以下の活動データから自己分析を行ってください。\n\n${sections.join('\n\n')}`;
}
