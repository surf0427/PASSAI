// PASSAI 受験版 Exam Spine — Layer 3 / 4 / 5 の purpose plan（Stage 2 / 静的宣言のみ）。
//
//   Layer 3  purpose policy による block selection
//   Layer 4  ordering / omission
//   Layer 5  render contract（heading / separator / placeholder / trim / 空 block の落とし方）
//
// を purpose ごとに **1 箇所で宣言**する。route ごとの if 文を増やさないための正本。
//
// ★ Stage 2 の最重要ルール ★
//   - 本 plan は **現行挙動の宣言**である。「本来こうすべき」ではない。
//     admission_focus が interview_feedback にしか付いていないのも、self_pr に基本情報が
//     無いのも、現行コードを読んだ結果をそのまま写している（Stage 1 registry と同じ規律）。
//   - render が null の purpose は「Stage 2 で byte 検証済みの render contract を持たない」を意味する。
//     推測で contract を書かない。理由は notes / notYetModeled に残し Stage 3 以降へ渡す。
//   - budget を参照して truncate / drop / summarize しない（Stage 2 は enforcement しない）。
//
// 純粋な型・定数のみ（I/O / AI / Date 非依存）。

import type { ExamContextPurpose } from '../types';
import type { ExamContextBlockId } from '../blocks/types';

// ── Render contract（§Render Contract）───────────────────────────────
//
// ★ `.trim()` / `.filter(Boolean)` / `.join('\n\n')` を安易に共通化しない、という
//   Stage 2 の制約に従い、legacy が実際にやっている操作だけを宣言できる形にしてある。
//   便利そうという理由で field を増やさない（増やすと「現行はどれだったか」が失われる）。

export type ExamBlockSlot = {
  id: ExamContextBlockId;
  /**
   * caller 側が付けている heading（【活動データ】等）。
   * legacy formatter が content に heading を含めている block では **指定しない**
   * （registry の headingOwner が 'block' のもの）。指定すると二重 heading になる。
   */
  heading?: string;
  /**
   * content が空のときに使う代替本文。空文字 `''` も有効な値で、
   * 「本文は空だが heading は必ず出す」を表す（legacy が無条件 push している section）。
   * undefined のときだけ slot ごと落とす。
   */
  placeholder?: string;
  /** legacy が content を trim してから空判定している場合のみ true。 */
  trim?: boolean;
  /** slot が出力されたときにだけ後ろへ足す固定文（legacy が section と一体で持つ框組み）。 */
  suffix?: string;
};

export type ExamRenderContract = {
  /** body の前に置く固定行。 */
  preamble: readonly string[];
  /** body の後ろに置く固定行。 */
  postamble: readonly string[];
  /** preamble / body / postamble を繋ぐ文字列。 */
  joiner: string;
  /** slot 同士を繋ぐ文字列。 */
  separator: string;
  /**
   * 空 slot の落とし方。
   *   'falsy' … content === '' で落とす（legacy の `x ? ... : ''` 相当）
   *   'blank' … content.trim() === '' で落とす（legacy の `.filter((s) => s.trim() !== '')` 相当）
   */
  dropEmpty: 'falsy' | 'blank';
  /** 末尾改行。現行 builder はいずれも付けないため全 purpose false。 */
  trailingNewline: boolean;
};

export type ExamPurposePlan = {
  /** 選択 + 順序（Layer 3 / 4）。宣言順がそのまま出力順。 */
  blocks: readonly ExamBlockSlot[];
  /** Layer 5。null = Stage 2 で byte 検証済みの render contract を持たない。 */
  render: ExamRenderContract | null;
  /** byte-equivalence の比較対象（あれば）。 */
  legacyBuilder: string | null;
  /**
   * legacy prompt に存在するが Stage 2 では block 化していない section。
   * 「見落とし」と「意図的な未着手」を区別するために必ず書く。
   */
  notYetModeled?: readonly string[];
  notes?: string;
};

// ── 共通 render contract ──────────────────────────────────────────────
//
// /api/analysis 系 3 purpose は完全に同じ形（先頭 1 文 + 空行 + section を 2 改行で連結）。
// 同じものを 3 回書かない。
function joinedWithLead(lead: string): ExamRenderContract {
  return {
    preamble: [lead],
    postamble: [],
    joiner: '\n\n',
    separator: '\n\n',
    dropEmpty: 'falsy',
    trailingNewline: false,
  };
}

// self_pr（/api/reason）の出力ルール。legacy の template literal 末尾をそのまま持つ。
const SELF_PR_OUTPUT_RULES = `【出力の構成】

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

// self_pr のテーマ偏り section に legacy が一体で付けている框組み文。
const SELF_PR_THEME_FREQUENCY_NOTE = `以下はこの受験生が活動・自己分析でよく使う／まだ薄いテーマの参考情報です。自己PRの主軸（本人の核となる強み）は変えないでください。よく出ているテーマを否定・抑制する必要はありません。まだ薄いテーマは、本人に実際に当てはまる場合のみ自然に活かしてください。無理に盛り込んだり、書かれていない事実を捏造したりしてはいけません。`;

// ── Purpose plans ─────────────────────────────────────────────────────
//
// 対応 route / prompt builder は Stage 1 の EXAM_CONTEXT_REGISTRY のコメントを正本とする。
// ここでは「その builder が実際にどの順で何を並べているか」だけを書く。

export const EXAM_PURPOSE_PLANS: Readonly<
  Record<ExamContextPurpose, ExamPurposePlan>
> = {
  // ── 自己分析（壁打ち）─────────────────────────────────────────
  self_analysis: {
    blocks: [
      { id: 'basic_profile' },
      { id: 'university_context' },
      // legacy は活動データを無条件 push する（空でも heading を出す）。
      { id: 'activity_text', heading: '【活動データ】', placeholder: '' },
    ],
    render: joinedWithLead('以下の活動データから自己分析を行ってください。'),
    legacyBuilder: 'lib/prompts/analysisPrompt.ts:buildWallHittingPrompt',
    notes:
      'この route は StudentProfile を生成する側なので自己理解 block は載らない（Stage 1 policy の selfUnderstanding: exclude と一致）。',
  },
  self_analysis_additional: {
    blocks: [
      { id: 'basic_profile' },
      { id: 'university_context' },
      { id: 'activity_text', heading: '【活動データ】', placeholder: '' },
      // 活動データの後・既存質問の前。legacy のコメントが位置を明示している。
      { id: 'theme_frequency_questions' },
      { id: 'existing_questions', heading: '【すでに出している質問（重複禁止）】', placeholder: '' },
    ],
    render: joinedWithLead('以下の活動データから追加の深掘り質問を生成してください。'),
    legacyBuilder: 'lib/prompts/additionalQuestionsPrompt.ts:buildAdditionalQuestionsPrompt',
    notes:
      'themeFrequency は theme_frequency（改善提案文脈）ではなく theme_frequency_questions（質問文脈）を使う。文言が別物なので block を分けている。',
  },
  summarize: {
    blocks: [
      { id: 'basic_profile' },
      { id: 'university_context' },
      // ★ 同じ activity_text だが heading が 【活動情報】 になる（self_analysis は【活動データ】）。
      //   heading は render contract の責務なので block は 1 つのまま扱える。
      { id: 'activity_text', heading: '【活動情報】', placeholder: '' },
      { id: 'analysis_result' },
      { id: 'analysis_qa' },
      { id: 'deep_answers' },
      { id: 'free_memo', heading: '【受験生の自由メモ】' },
    ],
    render: joinedWithLead('以下の情報から自己分析の簡潔な要約を作成してください。'),
    legacyBuilder: 'lib/prompts/summarizePrompt.ts:buildSummarizePrompt',
  },

  // ── 志望理由書 ────────────────────────────────────────────────
  statement_prepare: {
    blocks: [{ id: 'statement_university_context' }],
    render: null,
    legacyBuilder: null,
    notYetModeled: ['整理メモ用の設問・入力欄（feature 入力）'],
    notes:
      'Spine 由来は大学 DB section のみ。基本情報も StudentProfile も載せない現行挙動を維持する。user prompt の組み立ては app/api/statement-prepare/route.ts 内にあり、AI SDK を引き込むため Stage 2 では import できない。',
  },
  statement_review: {
    // legacy の section 配置順コメントをそのまま順序として持つ:
    //   … examTypeGuidance → structure（大局）→ ngIssues（細部）→ themeFrequency（大局）
    //   → unusedExperience（具体）→ previousOutput（直近）→【本文】
    blocks: [
      { id: 'basic_profile' },
      { id: 'statement_target' },
      { id: 'statement_university_context' },
      // ★ admission_focus は statement_review では **未接続**。
      //   buildStatementReviewPrompt には opts.admissionFocusContext という受け口があるが、
      //   route が値を渡していない（PR9 marker）。「本来入れた方がいい」を理由に block 化すると
      //   将来の誤接続を招くため、Stage 2 では slot を作らず notes に事実だけ残す。
      { id: 'activity_context' },
      { id: 'self_analysis_statement' },
      { id: 'exam_type_guidance_statement' },
      { id: 'structure_analysis' },
      { id: 'ng_issues' },
      { id: 'theme_frequency' },
      { id: 'unused_experience' },
      { id: 'previous_output_summary' },
      { id: 'statement_body', heading: '【志望理由書本文】', placeholder: '' },
    ],
    render: {
      preamble: ['以下の志望理由書を採点・添削してください。'],
      postamble: [],
      joiner: '\n\n',
      separator: '\n\n',
      dropEmpty: 'falsy',
      trailingNewline: false,
    },
    legacyBuilder: 'lib/statement/review/statementPrompt.ts:buildStatementReviewPrompt',
    notYetModeled: ['admissionFocusContext（受け口はあるが route が値を渡していない = 未接続）'],
    notes:
      'legacy は `${x ? `${x}\\n\\n` : ""}` の連鎖で書かれているが、先頭と末尾が常に非空なので「非空 slot を \\n\\n で連結」と厳密に等価になる（QA が byte で確認している）。',
  },

  // ── 小論文 ────────────────────────────────────────────────────
  essay_themes: {
    blocks: [{ id: 'basic_profile' }],
    render: null,
    legacyBuilder: null,
    notYetModeled: [
      '【志望校】label（大学 DB / basicInfo 由来）',
      '【アドミッションポリシー】',
      '【この学部で優先したいカテゴリ】',
      '【設問のトーン】',
      '【既出テーマ】/【既出カテゴリ】（同一 feature 内の状態）',
    ],
    notes:
      'buildEssayThemesPrompt は import 可能だが、大学 DB 由来 section を prompt builder 内で直接組み立てており、Spine の block へ写すには Stage 3 の大学 DB reader 契約が要る。推測で block を切らない。',
  },
  essay_review: {
    blocks: [
      { id: 'basic_profile' },
      { id: 'essay_university_context' },
      { id: 'previous_output_summary' },
    ],
    render: null,
    legacyBuilder: null,
    notYetModeled: ['examTypeGuidance（小論文用）', '設問・本文・字数（feature 入力）'],
    notes:
      'user prompt の組み立てが app/api/essay-review/route.ts 内にあり、AI SDK を引き込むため Stage 2 では import できない（NOT_YET_PORTABLE）。',
  },
  essay_chat: {
    blocks: [{ id: 'basic_profile' }, { id: 'essay_university_context' }],
    render: null,
    legacyBuilder: null,
    notYetModeled: ['相談本文・履歴（feature 入力）'],
    notes: 'user prompt の組み立てが app/api/essay-chat/route.ts 内にある（NOT_YET_PORTABLE）。',
  },
  essay_deep_questions: {
    blocks: [{ id: 'basic_profile' }],
    render: null,
    legacyBuilder: null,
    notYetModeled: [
      '【設問・テーマ】/【ミニ思考欄】/【小論文本文】/【今回取り組む改善対象】/【軸】',
      '【直前のAIフィードバック】/【すでに出した質問】',
    ],
    notes:
      '大学 DB section を持たない点が sibling（essay_review / essay_chat）と異なる。Spine 由来は basic_profile のみ。',
  },
  essay_improve_summary: {
    blocks: [{ id: 'basic_profile' }],
    render: null,
    legacyBuilder: null,
    notYetModeled: ['works / deepQuestions / answers（feature 入力）'],
    notes: 'user prompt の組み立てが app/api/essay-improve-summary/route.ts 内にある（NOT_YET_PORTABLE）。',
  },

  // ── 面接 ──────────────────────────────────────────────────────
  interview_questions: {
    // ★ 氏名を含まない minimal profile。basic_profile ではなく applicant_profile_basics を使う。
    //   Stage 1 policy の profile: 'minimal' はこの事実の宣言であり、Stage 2 で氏名を落とすのではない。
    blocks: [
      { id: 'applicant_profile_basics' },
      { id: 'subject_grades' },
      { id: 'statement_summary', heading: '【志望理由書サマリー】', placeholder: '志望理由書本文なし' },
      { id: 'activity_summary', heading: '【活動サマリー】', placeholder: '活動サマリーなし' },
      { id: 'self_analysis_questions' },
      {
        id: 'interview_university_context',
        heading: '【大学DB情報】',
        placeholder: '大学DB情報なし',
        trim: true,
      },
      {
        id: 'exam_type_guidance_interview',
        heading: '【受験方式に関するガイダンス】',
        placeholder: '受験方式ガイダンスなし',
        trim: true,
      },
      { id: 'question_variation_seed' },
    ],
    render: {
      preamble: [],
      postamble: [],
      joiner: '\n\n',
      separator: '\n\n',
      dropEmpty: 'falsy',
      trailingNewline: false,
    },
    legacyBuilder: 'lib/interview/buildInterviewQuestionPrompt.ts:buildInterviewQuestionUserPrompt',
    notes:
      'admissionFocus は route が意図的に非接続（PR8b marker）。statementDraft は structural bridge（E-P3）で、statement_summary block はそれを 1200 字圧縮したもの。',
  },
  interview_feedback: {
    blocks: [
      { id: 'basic_profile' },
      { id: 'interview_university_context' },
      // ★ admissionFocusContext が通電している唯一の purpose（faculty が解決できたときのみ）。
      { id: 'admission_focus' },
      { id: 'self_analysis_interview' },
      { id: 'previous_output_summary' },
      { id: 'unused_experience' },
    ],
    render: null,
    legacyBuilder: null,
    notYetModeled: [
      '【受験情報（今回の練習で対象とした内容）】',
      'examTypeGuidance（面接用）',
      '【質問と回答】/ heuristic section（feature 入力・決定論派生）',
    ],
    notes:
      'user prompt の組み立てが app/api/interview-feedback/route.ts 内の template literal にあり、AI SDK を引き込むため Stage 2 では import できない（NOT_YET_PORTABLE）。block 順序は route の template を読んで宣言している。',
  },
  interview_ai: {
    blocks: [],
    render: null,
    legacyBuilder: null,
    notYetModeled: ['target_ref.sourceContext（client が組み立てた 1 本の凍結文字列）'],
    notes:
      'Spine 由来 context が client 側で 1 本の文字列に凍結されており（app/interview/ai/sourceData.ts）、block へ分解できない。SD-3 / E-P5 違反の既存負債で Stage 9 廃止予定。Stage 2 では block を切らない。',
  },

  // ── プレゼン ──────────────────────────────────────────────────
  presentation_feedback: {
    blocks: [],
    render: null,
    legacyBuilder: null,
    notYetModeled: [
      'presentation_sessions の university_name / faculty_name / theme / admission_type / presentation_format / university_notes',
    ],
    notes:
      '学生の人格データ（基本情報 / 活動 / StudentProfile / 横断ログ）は一切載っていない。プレゼンだからといって profile block を自動挿入しない。session/university 情報は server_authoritative な行由来で、Stage 3 の reader 契約が要る。',
  },

  // ── 横断 ──────────────────────────────────────────────────────
  matching: {
    blocks: [
      { id: 'basic_profile' },
      // ★ matching は statement_review と同じ行構成の activity section を heading だけ変えて
      //   別実装している。Stage 2 は挙動を変えないので別 block として記録する。
      { id: 'activity_context_matching' },
      { id: 'self_analysis_matching' },
      { id: 'university_context' },
    ],
    render: null,
    legacyBuilder: null,
    notYetModeled: [
      'examTypeGuidance（matching 用）',
      '【他の候補大学（差分の参考）】',
      '【大学情報（スコアリング層から）】',
      'rerank prompt の【候補大学（deterministic スコア順）】',
    ],
    notes:
      'buildMatchingUserPrompt は `${x ? `\\n${x}\\n` : ""}` で section を改行で包む独自の連結をしており、他 purpose の「separator で連結」contract に収まらない。無理に一般化すると他 purpose の byte を壊すため Stage 2 では render contract を宣言しない。admissionFocus は route が意図的に非接続（PR9d-2 / C2 marker）。',
  },
  self_pr: {
    // ★ /api/reason は basicInfo も StudentProfile も受け取らない。共通 profile block を
    //   勝手に入れない（Stage 1 policy の profile: 'exclude' と一致）。
    blocks: [
      { id: 'theme_frequency', suffix: `\n\n${SELF_PR_THEME_FREQUENCY_NOTE}` },
      { id: 'unused_experience' },
      { id: 'self_pr_body', heading: '【自己PR】', placeholder: '' },
    ],
    render: {
      preamble: [
        'あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。\n以下の自己PRを、今ある材料だけで自然な仮版に整えてください。',
      ],
      postamble: [SELF_PR_OUTPUT_RULES],
      joiner: '\n\n',
      separator: '\n\n',
      dropEmpty: 'falsy',
      trailingNewline: false,
    },
    legacyBuilder: 'lib/prompts.ts:buildReasonPrompt',
    notes:
      'Spine 由来は themeFrequency と unusedExperience の 2 section のみ。下書き本文は client の buildSelfPRDraftSeed 出力をユーザーが編集した feature 入力として届く。',
  },
  tutor: {
    blocks: [{ id: 'tutor_student_context' }],
    render: null,
    legacyBuilder: null,
    notYetModeled: [
      'loadTutorStudentContextCached（server 経路・6 source の owner-scoped read）',
      'buildTutorPromptContext（intent 別の body 由来 context）',
    ],
    notes:
      '受験版で唯一 server 経路を持つ purpose。同じ人格データが最大 3 経路で入る三重投入の解消は Stage 6。tutor_student_context は SYSTEM block 2 の文字列で、user prompt の組み立ては app/api/tutor/route.ts 内にある（NOT_YET_PORTABLE）。',
  },
};

/** purpose に対応する plan を返す（純関数・union 全網羅のため fallback 不要）。 */
export function getExamPurposePlan(purpose: ExamContextPurpose): ExamPurposePlan {
  return EXAM_PURPOSE_PLANS[purpose];
}
