import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
// 共有指示文 4 定数は lib/prompts/sharedInstructions.ts に切り出し済み。
// 旧来 `from '@/lib/prompts'` 経由で参照する route 経路を維持するため、本ファイルからも
// SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE を re-export する。
// STUDENT_FIT_INSTRUCTION / FREE_MEMO_INSTRUCTION は本ファイル内では参照されないため
// import しない（参照したい route / 新ファイルは sharedInstructions.ts から直接 import）。
export {
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
} from '@/lib/prompts/sharedInstructions';

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

// 旧 buildAnalyzePrompt は DET-6 で撤去した（/api/analyze route 削除に伴う dead code 整理）。
// `/api/analyze` route は STEP4.10 時点で client 呼び出し元ゼロのまま orphan 化しており、
// `/api/analysis` 系列で置き換え済みであった。AnalysisResult 型と共に削除。
// 呼び出し元なしを grep（'/api/analyze' / buildAnalyzePrompt / AnalysisResult）で確認済。

// ANALYSIS_SYSTEM_PROMPT / buildWallHittingPrompt / BuildWallHittingOptions /
// 関連 qualifier は lib/prompts/analysisPrompt.ts に切り出した。
// `from '@/lib/prompts'` 経由の既存 import を壊さないため re-export shim を残す。
export {
  ANALYSIS_SYSTEM_PROMPT,
  buildWallHittingPrompt,
  type BuildWallHittingOptions,
} from '@/lib/prompts/analysisPrompt';

// BuildSummarizeOptions / SUMMARIZE_SYSTEM_PROMPT / SUMMARIZE_LIGHT_SYSTEM_PROMPT /
// SUMMARIZE_DEEP_SYSTEM_PROMPT / getSummarizeSystemPrompt / buildSummarizePrompt /
// 関連 private qualifier は lib/prompts/summarizePrompt.ts に切り出した。
// `from '@/lib/prompts'` 経由の既存 import を壊さないため re-export shim を残す。
export {
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARIZE_LIGHT_SYSTEM_PROMPT,
  SUMMARIZE_DEEP_SYSTEM_PROMPT,
  getSummarizeSystemPrompt,
  buildSummarizePrompt,
  type BuildSummarizeOptions,
} from '@/lib/prompts/summarizePrompt';

// ADDITIONAL_QUESTIONS_SYSTEM_PROMPT / buildAdditionalQuestionsPrompt /
// BuildAdditionalQuestionsOptions / 関連 qualifier は lib/prompts/additionalQuestionsPrompt.ts に
// 切り出した。`from '@/lib/prompts'` 経由の既存 import を壊さないため re-export shim を残す。
export {
  ADDITIONAL_QUESTIONS_SYSTEM_PROMPT,
  buildAdditionalQuestionsPrompt,
  type BuildAdditionalQuestionsOptions,
} from '@/lib/prompts/additionalQuestionsPrompt';

// STEP-DIVERGENCE-03B/04A: ThemeFrequency / UnusedExperience section（探索 context）を optional に注入。
// いずれも空文字 / 未指定なら従来どおり section なし（完全後方互換）。
// /api/reason は cache を持たないため PROMPT_VERSION 管理対象外（本文変更で invalidation 不要）。
// section の実データは route 側で buildThemeFrequencySection() / buildUnusedExperienceSection() で
// 整形済みの string を受け取る。順序は「テーマ偏り（抽象）→ 未使用経験（具体）→【自己PR】（本体）」。
export function buildReasonPrompt(
  text: string,
  opts: { themeFrequencySection?: string; unusedExperienceSection?: string } = {},
): string {
  const themeBlock = opts.themeFrequencySection
    ? `${opts.themeFrequencySection}

以下はこの受験生が活動・自己分析でよく使う／まだ薄いテーマの参考情報です。自己PRの主軸（本人の核となる強み）は変えないでください。よく出ているテーマを否定・抑制する必要はありません。まだ薄いテーマは、本人に実際に当てはまる場合のみ自然に活かしてください。無理に盛り込んだり、書かれていない事実を捏造したりしてはいけません。

`
    : '';
  // STEP-DIVERGENCE-04A: 未使用経験 section。formatter 側に框組み文言を含むためそのまま連結する。
  const unusedBlock = opts.unusedExperienceSection
    ? `${opts.unusedExperienceSection}

`
    : '';
  return `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の自己PRを、今ある材料だけで自然な仮版に整えてください。

${themeBlock}${unusedBlock}【自己PR】
${text}

【出力の構成】

「添削後の自己PR」を書いてください。
・元の内容を活かしつつ、伝わりやすい文章に整える
・志望理由や将来像とのつながりを意識した表現にする
・今ある情報だけで自然に仮版を書く。書かれていない事実（年数・大会名・役職・受賞歴・将来の目標など）を捏造しない
・情報が不足している箇所は、抽象度を上げて自然につなぐ。穴埋め指示や placeholder を本文に残さない
・「（ここに〜を補足してください）」「（◯◯について追記してください）」のような補足要求文を本文中に絶対に書かない
・角括弧（）や ◯◯ を使った placeholder / 穴埋め記号を本文に残さない

仮版として書き切ったうえで、情報が薄いと感じた場合のみ、本文の最後に1文だけ「より具体化するには深掘り質問機能で材料を追加してください」と添えてください。
不足情報の箇条書き・追加で答えてほしい質問のリストは本文に書かないでください（深掘り質問機能の責務です）。

【禁止事項】
・Markdownの表形式（「|」や「---」を使った表）は絶対に使わない
・箇条書きは「・」か「-」を使う
・番号付きリストは「1.」「2.」の形式を使う
・JSON形式での出力はしない
・専門用語の羅列はしない`;
}
