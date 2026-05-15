// /api/summarize 専用 SYSTEM_PROMPT (light / deep / legacy) + user prompt builder。
//
// 役割:
//   - SUMMARIZE_LIGHT_SYSTEM_PROMPT / SUMMARIZE_DEEP_SYSTEM_PROMPT: light / deep の 2 系統。
//     getSummarizeSystemPrompt(mode) で dispatch される。
//   - SUMMARIZE_SYSTEM_PROMPT: 旧来の単一 system prompt（legacy 互換 export）。
//   - SUMMARIZE_BASE_OUTPUT_RULES: light / deep 共通の JSON 出力規約。
//   - SUMMARIZE_SUBJECT_GRADES_QUALIFIER: subjectGrades の field-level 制約（light / deep 共通）。
//   - buildSummarizePrompt: dynamic data（basicInfo / universityContext / activityText /
//     analysis / answers / deepAnswers / freeMemo）から user prompt を組み立てる builder。
//   - BuildSummarizeOptions: builder の入力型。
//
// 切り出し経緯:
//   元は lib/prompts.ts に同居していたが、同ファイルが肥大化していたため Phase 2.3 で
//   切り出した。本ファイルを import するのは /api/summarize/route.ts と scripts/step15-qa.ts のみで、
//   本来 lib/prompts.ts 全体を引きずる必要がない。
//
//   既存 import 経路（`from '@/lib/prompts'`）は lib/prompts.ts 側の re-export shim で
//   引き続き有効。route.ts / scripts/step15-qa.ts は本 STEP では import path を変えない。
//
// 注意:
//   - SYSTEM_PROMPT 本文（特に subjectGrades qualifier、JSON schema、SummaryResult 3 フィールド、
//     light / deep のトーン文言）は 1 文字も変えてはいけない。lib/aiInputHash.ts の
//     SUMMARIZE_PROMPT_VERSION を bump せずに同 cache lane の互換性を保つ前提。
//   - getSummarizeSystemPrompt の dispatch 条件 `mode === 'deep'` を変えない。
//   - AnalysisPromptContext 型は lib/prompts.ts で他 builder と共有されているため、
//     type-only import で参照する（runtime 循環なし）。
//   - FREE_MEMO_INSTRUCTION は sharedInstructions から直接 import する
//     （lib/prompts.ts 経由の参照を避ける）。

import type { SummarizeMode, WallHittingResult } from '@/types/analysis';
import type { AnalysisPromptContext } from '@/lib/prompts';
import {
  STUDENT_FIT_INSTRUCTION,
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
  FREE_MEMO_INSTRUCTION,
} from '@/lib/prompts/sharedInstructions';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildUniversityContextPromptSection } from '@/lib/buildUniversityContext';

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
