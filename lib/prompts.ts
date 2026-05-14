import type { SummarizeMode, WallHittingResult } from '@/types/analysis';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildUniversityContextPromptSection } from '@/lib/buildUniversityContext';
// 共有指示文 4 定数は lib/prompts/sharedInstructions.ts に切り出し済み。
// 旧来 `from '@/lib/prompts'` 経由で参照する route 経路を維持するため、本ファイルからも
// SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE を re-export する。
// STUDENT_FIT_INSTRUCTION / FREE_MEMO_INSTRUCTION は元々 module-private なので re-export しない。
import {
  STUDENT_FIT_INSTRUCTION,
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
  FREE_MEMO_INSTRUCTION,
} from '@/lib/prompts/sharedInstructions';

export { SUBJECT_GRADES_SHARED_INSTRUCTION, SUBJECT_GRADES_ASYMMETRY_RULE };

// STUDENT_FIT_INSTRUCTION の役割:
// プロンプトに「志望先の文脈で読み解く」共通指示を差し込むための定型文。
// AIに「性格を作り変えるな、相性の良い側面を発見せよ」という制約を伝える。

// ── STEP15a: subjectGrades semantic instruction layer (shared) ──────
//
// 役割:
//   subjectGrades（科目別評定・欠席日数）を AI が意味的に解釈するための
//   shared system instruction。STUDENT_FIT_INSTRUCTION の兄弟として並置する。
//
// 配置方針:
//   - STUDENT_FIT_INSTRUCTION         = 学部 fit の切り口（既存・触らない）
//   - SUBJECT_GRADES_SHARED_INSTRUCTION = 禁止・重要度ヒエラルキー
//   - SUBJECT_GRADES_ASYMMETRY_RULE     = 強み・弱み接続の非対称性
//
// 現状（STEP15a 時点）:
//   この 2 つの const はまだ **どの SYSTEM_PROMPT にも import されていない**。
//   STEP15b（statement-review）以降で 1 route ずつ段階導入する。未参照のまま
//   commit する判断は phased rollout のため意図的。15a を単独で長期滞留させない。
//
// 変更時のルール:
//   これら 2 つの const の文字列を変更したら、参照している全 route の
//   PROMPT_VERSION を必ず bump すること（lib/aiInputHash.ts の各 *_PROMPT_VERSION）。
//   bump しないと既存 cache が古い prompt の出力を hit 扱いで返し続ける。
//
// レイヤ境界:
//   本 instruction は AI narrative 層に対する指示で、
//   eligibility (lib/matching/checkEligibility.ts) や
//   score      (lib/matching/calculateScore.ts)     の deterministic 層には
//   一切影響させない。narrative の解釈・言語化だけが本 instruction の責務。
//
// 関連:
//   docs/principles/ai_policy.md           ← レイヤ境界とロールアウト方針
//   docs/principles/ai_cache_observability.md ← PROMPT_VERSION 運用

// SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE の本文は
// lib/prompts/sharedInstructions.ts に移設。import + re-export は本ファイル冒頭。

// 自己分析API群で共有するオプション型。
// universityContext は basicInfo から派生させた値を受け取ることもあれば、
// 将来 大学DB から enrich された値を受け取ることもある（呼び出し側で構築）。
export type AnalysisPromptContext = {
  basicInfo: BasicInfo | null;
  universityContext: UniversityContext | null;
};

// 旧 buildContextPreamble はここに存在していたが、STEP3.5 / STEP3.8 / STEP3.9 で
// /api/analysis 系列の system / user 分離が完了し、呼び出し元がゼロになったため撤去した。
// preamble に含まれていた STUDENT_FIT_INSTRUCTION は各 API の SYSTEM_PROMPT 側に移った。
// basicInfo / universityContext の section helper は各 build*Prompt が直接呼ぶ。

export function buildAnalyzePrompt(activityText: string): string {
  return `あなたは総合型選抜・学校推薦型選抜の指導に強いアシスタントです。

目的：
以下の活動データをもとに、自己PRや志望理由書に必要な情報を「不足している項目」に対してのみ質問してください。

重要ルール：
- すでに情報がある項目については質問しない
- 空欄・情報が弱い部分だけを補う質問をする
- 質問は3〜5問に制限する
- 抽象的な質問は禁止（例：「頑張ったことは？」など）
- 具体性を引き出す質問にする

対象の構造（この形に最終的に埋めたい）：
【共通項目】
- 期間
- 役割 / 立場
- 内容（何をしたか）
- 課題
- 行動 / 工夫
- 成果
- 学び
- 将来とのつながり

【活動データ】
${activityText}

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
  "strengths": ["活動から見える強み（2〜4個）"],
  "interests": ["関心分野（1〜3個）"],
  "gaps": ["不足している項目名（例：行動/工夫、将来とのつながり）"],
  "questions": ["（項目名）具体的な質問文"]
}

questionsの形式例：
- "（課題）〇〇活動で一番うまくいかなかったのはどの場面でしたか？"
- "（行動/工夫）その状況を乗り越えるために、具体的にどんな行動をとりましたか？"
- "（将来とのつながり）この経験は、志望する学部・学科でどう活かせると思いますか？"`;
}

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
  ]
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

export type BuildSummarizeOptions = {
  activityText: string;
  analysis: WallHittingResult;
  answers: string[];
  // 各質問に対する任意の「追加深掘りメモ」。answers と index 一対一対応。
  // 呼び出し側 (route.ts) で normalizeDeepAnswers(input, answers.length) を通した
  // trim 済み・同長の配列を渡す前提。空文字エントリは prompt section から自動的に省略する。
  // 全要素空文字 or undefined の場合は section ヘッダごと出力しない（token 削減）。
  deepAnswers?: string[];
  // 任意の自由メモ（全体単位）。質問では拾いきれない気づき・違和感を書く欄。
  // 呼び出し側 (route.ts) で normalizeFreeMemo(input) を通した trim+truncate 済み文字列を渡す前提。
  // 空文字（または undefined）の場合は section ヘッダごと出力しない（token 削減）。
  // /api/summarize のみが読む。StudentProfile / Context Builder には流さない。
  freeMemo?: string;
} & AnalysisPromptContext;

// buildSummarizePrompt の責務範囲:
//   /api/summarize は「自己分析の簡潔な要約」を返す API。下流 feature の完成物を作る API ではない。
//   出力させるのは activitySummary / strengths / appealPoints の 3 つのみ。
//   自己PR下書き / 面接要点は feature 側（self-pr / interview）が StudentProfile から自前で派生する。

// ── STEP3.9: static rule を system パラメータへ切り出し ──────────
// 「毎回変わらない指示」（役割宣言・志望先文脈の解釈方針・出力ルール・JSON schema）を
// SYSTEM_PROMPT に固定し、user 側（buildSummarizePrompt）には「今回の入力データ」だけを渡す。これにより:
//   1. /api/analysis（STEP3.5）/ /api/analysis/additional（STEP3.8）と同じ system / user 分離構造に揃う
//   2. 将来 prompt caching（cache_control）を system 部にかけられる足場になる
// 現状 prompt caching 自体は未適用（system 候補は短く、Sonnet 4-6 の実効 caching 閾値
// ~2,048+ を下回るため、cache_control は付けない）。
//
// 不変条件:
//   - prompt の意味を変えない（activitySummary / strengths / appealPoints の 3 フィールド schema、
//     字数指針、トーン、JSON strict 規律はすべて逐字保持）
//   - buildContextPreamble の signature は変えない（STEP3.5 / STEP3.8 と同じ方針）。
//     本関数は preamble を経由せず section helper を直接呼ぶ形に切り替える。
//   - STUDENT_FIT_INSTRUCTION は「分かる場合は…」と条件文化されているため、
//     universityContext が無いケースでも system 側に常駐させて安全。
//
// 補足: STEP3.9 完了時点で buildContextPreamble の呼び出し元はゼロになったため、
// 関数定義そのものは本 STEP で撤去した（dead code 化を防ぐため）。
// 既存 SUMMARIZE_SYSTEM_PROMPT は後方互換のためそのまま残す。
// 現行 /api/summarize は light/deep の二系統 (SUMMARIZE_LIGHT_SYSTEM_PROMPT /
// SUMMARIZE_DEEP_SYSTEM_PROMPT) を getSummarizeSystemPrompt(mode) で選び分けて使う。
// 旧版を直接 import している箇所が無くなった時点で本 export を deprecate / 削除する想定。
export const SUMMARIZE_SYSTEM_PROMPT = `あなたは総合型選抜の受験指導の専門家です。
以下の情報をもとに学生の「自己分析の簡潔な要約」を作成し、指定のJSON形式のみで回答してください。
自己PRの完成文や面接の話し方サンプルは出さないこと（それらは別機能の責務）。

${STUDENT_FIT_INSTRUCTION}

【出力ルール（厳守）】
・出力は純粋なJSONのみ
・最初の文字は { でなければならない
・最後の文字は } でなければならない
・\`\`\`json や \`\`\` は絶対に使わない
・前置き・説明文・日本語の文章を一切書かない
・JSON以外の文字を1文字も含めない
・ただし、正しいJSON構造を保つことを最優先とする。JSON構造が壊れるくらいなら正確なJSONを優先すること
・activitySummary / strengths / appealPoints の 3 フィールドのみを返す。他のキーは追加しない

【出力形式】
{
  "activitySummary": "活動の要約（100字程度）",
  "strengths": "見える強み（2〜3文）",
  "appealPoints": "アピールポイント（2〜3文）"
}`;

// ── light / deep の二系統 system prompt ─────────────────────────────────────
// 共通の出力ルール（JSON 規約・schema・SummaryResult 3 フィールド固定）を
// SUMMARIZE_BASE_OUTPUT_RULES に切り出し、mode-specific な役割宣言・トーン・禁止事項だけを
// それぞれの SYSTEM_PROMPT 側に書く。SummaryResult schema は light / deep とも同一で、
// 内容の密度・観点だけが mode で変わる（downstream の summarizeCache / SummarySection への影響を回避）。
const SUMMARIZE_BASE_OUTPUT_RULES = `【出力ルール（厳守）】
・出力は純粋なJSONのみ
・最初の文字は { でなければならない
・最後の文字は } でなければならない
・\`\`\`json や \`\`\` は絶対に使わない
・前置き・説明文・日本語の文章を一切書かない
・JSON以外の文字を1文字も含めない
・ただし、正しいJSON構造を保つことを最優先とする。JSON構造が壊れるくらいなら正確なJSONを優先すること
・activitySummary / strengths / appealPoints の 3 フィールドのみを返す。他のキーは追加しない

【出力形式】
{
  "activitySummary": "活動の要約（100字程度）",
  "strengths": "見える強み（2〜3文）",
  "appealPoints": "アピールポイント（2〜3文）"
}`;

// 自由メモ（任意入力）の扱いに関する共通注意。
// light / deep 共通で system に常駐させ、受験生の未整理な思考を AI が「事実」として
// 採用してしまうのを防ぐ。memo が無いケースでも害は無く（条件文化されている）、
// memo がある時に AI 出力の安全側を担保する。
// FREE_MEMO_INSTRUCTION の本文は lib/prompts/sharedInstructions.ts に移設。import は本ファイル冒頭。

// STEP15i: summarize 固有の subjectGrades 取り扱い制約（light / deep 共通）。
// shared 側（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）で
// 断定禁止・AO 推薦混同禁止・関連科目以外の過剰減点禁止は既に効いている。
// 本 route は SummaryResult の 3 フィールド（activitySummary / strengths / appealPoints）が
// 短文中心のため、評定値・欠席日数の直接転記が起きると即「自己分析 = 成績表」化する。
// したがって最優先で「数値を出力に残さない / 能力・姿勢に変換する」を縛る。
// STEP15f (analysis) と並んで「downstream に流れやすい出力」を守る STEP として位置づける。
const SUMMARIZE_SUBJECT_GRADES_QUALIFIER = `【summarize route での subjectGrades の使い方】
・subjectGrades は、自己分析要約の補助文脈としてのみ使う。

・activitySummary / strengths / appealPoints に、評定値・欠席日数・科目別評定を直接書かない。

・「英語評定4.8」「数学2.9」「欠席18日」のような数値表現を出力に残さない。

・activitySummary は活動・経験・探究・役割・行動を中心にまとめる。評定や出席状況を中心にしない。

・strengths は活動から見える姿勢・能力・価値観として表現する。評定値単独を strength にしない。

・appealPoints は志望理由書・面接で使える人物像としてまとめる。成績表情報ではなく、活動・経験・将来目標との接続を優先する。

・関連科目の高評定がある場合でも、「英語で発信する姿勢」「論理的に考える力」など能力・姿勢に変換して表現する。

・志望学部に関連しない低評定を弱み・不安材料として扱わない。

・欠席日数がある場合でも、summary 内に日数を残さない。必要なら「面接で背景を整理する」程度の内部文脈に留める。

・subjectGrades 未入力時は、評定や欠席を推測しない。`;

// 入力素材が薄い受験生向け。
// 抽象化や価値観断定を避け、現時点の素材を素直に整理して 1〜2 点だけ柔らかく不足を指摘する。
//
// STEP15i: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）と
//     route 固有の SUMMARIZE_SUBJECT_GRADES_QUALIFIER（light/deep 共通）を
//     STUDENT_FIT_INSTRUCTION の直後・既存「今回のトーン」の前に挿入
//   - user prompt（buildSummarizePrompt の戻り値）は本 STEP では 1 文字も変えない
//   - PROMPT_VERSION は SUMMARIZE_PROMPT_VERSION 4→5 へ bump（lib/aiInputHash.ts）
export const SUMMARIZE_LIGHT_SYSTEM_PROMPT = `あなたは総合型選抜の受験指導の専門家です。
受験生はまだ自分の活動を十分に言語化できていません。書類添削に進むための入口として、
現時点の素材を素直に整理し、不足箇所を 1〜2 点だけ柔らかく指摘してください。

${STUDENT_FIT_INSTRUCTION}

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${SUMMARIZE_SUBJECT_GRADES_QUALIFIER}

【今回のトーン（light mode）】
・受験生を励ます姿勢で、現時点の素材を整理する
・「ここを補強するとさらに伝わる」型の柔らかい指摘を 1〜2 点だけ
・抽象化や価値観の断定はしない（材料が薄いと精度が出ないため）
・自己PRや志望理由書の完成文は書かない（別機能の責務）

${FREE_MEMO_INSTRUCTION}

${SUMMARIZE_BASE_OUTPUT_RULES}`;

// 入力素材が十分にある受験生向け。
// 表面の事実ではなく、活動を貫く動機・継続理由・価値観を抽出して構造化する。
// MBTI / Big5 / 占い的表現 / 断定的人格分析 / 完成文代筆は明示的に禁止する。
//
// STEP15i: subjectGrades semantic instruction は light と同一の 3 ブロック構成で接続する。
//   light / deep で同 qualifier を共有する（成績表化リスクは mode によらず同じため）。
export const SUMMARIZE_DEEP_SYSTEM_PROMPT = `あなたは総合型選抜の受験指導の専門家です。
受験生は活動について十分な分量を書いています。表面の事実ではなく、活動を貫く
動機・継続理由・価値観を抽出し、面接や志望理由書に繋がる観点で構造化して言語化してください。

${STUDENT_FIT_INSTRUCTION}

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${SUMMARIZE_SUBJECT_GRADES_QUALIFIER}

【今回のトーン（deep mode）】
・抽象化と共通点抽出を行い、活動の裏にある思考パターンを言語化する
・「事実 + その裏の思考パターン」のセットで強みを書く
・動機の変化や継続理由が読み取れる場合は触れる
・志望理由書や面接で活かせる観点を 1〜2 点 appealPoints に織り込む

【絶対の禁止事項】
・MBTI / Big5 などの人格類型化をしない
・占い的・運命論的な表現を使わない
・「あなたの本当の動機は◯◯です」型の断定・押し付けをしない
・自己PRや志望理由書の完成文は書かない（別機能の責務）
・受験生の記述に無い事実を創作しない

${FREE_MEMO_INSTRUCTION}

${SUMMARIZE_BASE_OUTPUT_RULES}`;

export function getSummarizeSystemPrompt(mode: SummarizeMode): string {
  return mode === 'deep' ? SUMMARIZE_DEEP_SYSTEM_PROMPT : SUMMARIZE_LIGHT_SYSTEM_PROMPT;
}

export function buildSummarizePrompt(opts: BuildSummarizeOptions): string {
  const { activityText, analysis, answers } = opts;
  // 共有の buildContextPreamble は使わない。preamble は STUDENT_FIT_INSTRUCTION を含んでおり、
  // これは system 側に移したため。basicInfo / universityContext の section helper を
  // 直接呼んで dynamic 部だけを組み立てる（STEP3.5 / STEP3.8 と同じ方針）。
  const basicInfoSection = buildBasicInfoPromptSection(opts.basicInfo);
  const uniContextSection = buildUniversityContextPromptSection(opts.universityContext);
  const qa = analysis.questions
    .map((q, i) => `Q${i + 1}: ${q}\nA${i + 1}: ${answers[i]?.trim() || '（未回答）'}`)
    .join('\n\n');

  const sections: string[] = [basicInfoSection];
  if (uniContextSection) sections.push(uniContextSection);
  sections.push(`【活動情報】\n${activityText}`);
  sections.push(
    `【AI分析】\n活動の要約: ${analysis.summary}\n強み: ${analysis.strengths.join('・')}\n弱み・補強ポイント: ${analysis.weaknesses.join('・')}\n将来とのつながり: ${analysis.futureConnections.join('・')}`,
  );
  sections.push(`【深掘り質問と回答】\n${qa}`);

  // 追加深掘りメモは「非空エントリが 1 件以上ある場合のみ」section ごと出す。
  // 質問文を再掲しない（Q番号のみで参照）ことで token を節約する。
  // 各エントリも trim 済みで空のものは黙って省略する。
  const deepEntries = (opts.deepAnswers ?? [])
    .map((d, idx) => ({ idx, text: (d ?? '').trim() }))
    .filter((e) => e.text !== '');
  if (deepEntries.length > 0) {
    const deepText = deepEntries
      .map((e) => `Q${e.idx + 1} に対する追加メモ: ${e.text}`)
      .join('\n');
    sections.push(`【受験生の追加深掘りメモ】\n${deepText}`);
  }

  // 自由メモは非空のときだけ section ごと出す。
  // server 側で normalizeFreeMemo を通している前提だが、buildSummarizePrompt 自体も
  // 防衛的に trim して空判定する（万一の二重露出を防ぐ）。
  const memo = (opts.freeMemo ?? '').trim();
  if (memo !== '') {
    sections.push(`【受験生の自由メモ】\n${memo}`);
  }

  return `以下の情報から自己分析の簡潔な要約を作成してください。\n\n${sections.join('\n\n')}`;
}

// buildAdditionalQuestionsPrompt は「質問生成責務」専用プロンプト。
// profile 生成 (summary / strengths / weaknesses / futureConnections) は触らない。
// 将来は buildWallHittingPrompt の質問セクションをここに統合し、
// mode = 'initial' | 'additional' で切り替える形が候補（app/api/analysis/additional/route.ts 参照）。
export type BuildAdditionalQuestionsOptions = {
  activityText: string;
  existingQuestions: string[];
} & AnalysisPromptContext;

// ── STEP3.8: static rule を system パラメータへ切り出し ──────────
// 「毎回変わらない指示」（役割宣言・志望先文脈の解釈方針・制約・出力ルール・JSON schema）を
// SYSTEM_PROMPT に固定し、user 側（buildAdditionalQuestionsPrompt）には「今回の入力データ」だけを
// 渡す。これにより:
//   1. /api/analysis 本体（STEP3.5）と同じ system / user 分離構造に揃う
//   2. 将来 prompt caching（cache_control）を system 部にかけられる足場になる
// 現状 prompt caching 自体は未適用（system 候補は短く ~600 tokens 前後の見込みで、
// Sonnet 4-6 の実効 caching 閾値 ~2,048+ を大きく下回るため、付けても効果薄）。
//
// 不変条件:
//   - prompt の意味を変えない（questions=2 ルール / カテゴリプレフィックス /
//     JSON schema / トーンは一切変えない）
//   - buildContextPreamble の signature は変えない（buildSummarizePrompt /
//     buildAdditionalQuestionsPrompt の従来呼び出しを壊さないよう、本関数は preamble を
//     経由せず section helper を直接呼ぶ形に切り替える。STEP3.5 と同じ手法）
//   - STUDENT_FIT_INSTRUCTION は「分かる場合は…」と条件文化されているため、
//     universityContext が無いケースでも system 側に常駐させて安全。
//
// STEP15g: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）は
//     同ファイル内 const のため import 不要・直接参照。
//   - route 固有の field-level 制約は下記 ADDITIONAL_QUESTIONS_SUBJECT_GRADES_QUALIFIER に集約。
//     additional は AI 出力（質問 2 問）が次回 /api/summarize の入力にもなり、間接的に
//     StudentProfile の傾向にも影響しうるため、analysis 本体より一段軽い制約として
//     「subjectGrades 由来の質問を questions[0] に置かない」「数値直書き禁止」を中心に縛る。
//   - 挿入位置は STUDENT_FIT_INSTRUCTION の直後・「追加質問は」の前。
//   - user prompt（buildAdditionalQuestionsPrompt の戻り値）は本 STEP では 1 文字も変えない。
//   - PROMPT_VERSION は ADDITIONAL_QUESTIONS_PROMPT_VERSION 1→2 へ bump（lib/aiInputHash.ts）。

// analysis/additional route 固有の subjectGrades 取り扱い制約。
// shared 側で断定禁止・AO 推薦混同禁止・関連科目以外の過剰減点禁止は既に効いている。
// 本 route は追加質問 2 問を生成する route のため、subjectGrades は「質問観点の補助」に
// 限定し、活動・価値観・志望理由・将来目標の深掘りを主軸にする。
const ADDITIONAL_QUESTIONS_SUBJECT_GRADES_QUALIFIER = `【analysis/additional route での subjectGrades の使い方】
・subjectGrades は、追加質問の観点を補助するためだけに使う。

・追加質問は、活動・価値観・志望理由・将来目標の深掘りを主軸にする。

・評定値や欠席日数を質問文に直接書かない。

・subjectGrades 由来の質問を questions[0] に置かない。questions[0] は活動・経験・価値観の深掘りを優先する。

・志望学部に関連する高評定がある場合でも、「その力をどの活動でどう使ったか」を聞く形に変換する。

・志望学部に関連しない低評定を質問主題にしない。

・欠席日数がある場合は、不安を煽らず「その期間に何を大切にして行動したか」「継続したことは何か」を整理する方向の質問に留める。

・subjectGrades 未入力時は、評定・欠席に関する質問を作らない。`;

export const ADDITIONAL_QUESTIONS_SYSTEM_PROMPT = `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の活動データをもとに、深掘り質問を2問だけ追加生成してください。

${STUDENT_FIT_INSTRUCTION}

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${ADDITIONAL_QUESTIONS_SUBJECT_GRADES_QUALIFIER}

追加質問は、上記の志望大学・学部・学科の特性に踏み込む内容にすること。
学部のカリキュラム適合性、学科の専門性、受験方式に応じた観点を意識する。

【制約】
・questions は必ず2問だけ生成する
・上記の既存質問と重複しないこと
・AO面接・志望理由書で役立つ具体的な質問にする
・各質問には【カテゴリ】を付ける（例：【動機】【課題】【行動】【成果】【将来】）

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
  "questions": [
    "【カテゴリ】具体的な質問文",
    "【カテゴリ】具体的な質問文"
  ]
}`;

export function buildAdditionalQuestionsPrompt(opts: BuildAdditionalQuestionsOptions): string {
  const { activityText, existingQuestions } = opts;
  // 共有の buildContextPreamble は使わない。preamble は STUDENT_FIT_INSTRUCTION を含んでおり、
  // これは system 側に移したため。basicInfo / universityContext の section helper を
  // 直接呼んで dynamic 部だけを組み立てる（buildContextPreamble の signature は他 API も
  // 利用するため不変に保つ。STEP3.5 と同じ方針）。
  const basicInfoSection = buildBasicInfoPromptSection(opts.basicInfo);
  const uniContextSection = buildUniversityContextPromptSection(opts.universityContext);
  const existingQuestionsText = existingQuestions
    .map((q, i) => `${i + 1}. ${q}`)
    .join('\n');

  const sections: string[] = [basicInfoSection];
  if (uniContextSection) sections.push(uniContextSection);
  sections.push(`【活動データ】\n${activityText}`);
  sections.push(`【すでに出している質問（重複禁止）】\n${existingQuestionsText}`);
  return `以下の活動データから追加の深掘り質問を生成してください。\n\n${sections.join('\n\n')}`;
}

export function buildReasonPrompt(text: string): string {
  return `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の自己PRを添削し、改善版と不足情報をフィードバックしてください。

【自己PR】
${text}

【出力の構成】

まず「添削後の自己PR」を書いてください。
・元の内容を活かしつつ、伝わりやすい文章に整える
・志望理由や将来像とのつながりを意識した表現にする
・不足している情報がある場合は「（ここに◯◯を補足してください）」と角括弧で示す

次に、情報が不足していて完全な添削ができない場合は以下の形式で書いてください。

---

ただし、正直に申し上げます。
この改善版はまだ仮版です。

なぜかというと、まだ以下の情報が不足しているからです。

不足している情報：
・（不足している点を1つずつ箇条書きで書く）
・（なぜその情報が必要かも一言添える）

次に答えてほしい質問：
1. （具体的な質問を番号付きで書く）
2. （AO面接で実際に問われる観点で質問する）
3. （答えやすい、具体的な問いかけにする）

---

【禁止事項】
・Markdownの表形式（「|」や「---」を使った表）は絶対に使わない
・箇条書きは「・」か「-」を使う
・番号付きリストは「1.」「2.」の形式を使う
・JSON形式での出力はしない
・専門用語の羅列はしない`;
}
