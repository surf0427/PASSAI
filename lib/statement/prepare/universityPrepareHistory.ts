// 大学軸の整理メモ history（① 書く前に整理する機能の出力ストア）。
//
// 既存 storage との関係:
//   - 既存 `statement_prepare_summary` (lib/statement/prepare/statementPrepareStorage.ts)
//     は「最新 1 枚」を上書き保存していて、② edit の左サイド欄が直接参照している。
//     新フローでも appendUniversityPrepareEntry() の中で同 key に summary だけ
//     書き戻すため、② サイド欄は無変更で動く。
//   - 本 history は「過去ログ一覧」表示のために配列で保持する。最大 10 件。先頭が最新。
//     個別削除は deleteUniversityPrepareEntry(id) を使う。clear は clearUniversityPrepareHistory。
//     ※ 本 helper では statement_prepare_summary（最新 1 枚）には触れない。
//       理由：UI 上は「履歴」を消すだけで、「最新整理メモ」の単体表示はそのまま残しておく
//       のがユーザー期待。連動削除はせず別 store として扱う。
//
// 触らない:
//   - 既存 `statement_prepare_summary` の shape / signature / updatedAt 契約。
//     書き戻す payload は cached helper が受け付ける 5 項目 + inputSignature のみ。
//
// ── 将来 AI 生成への拡張ポイント（本ファイルは型のみ。実装は触らない） ──────
// 最終形は「友人が拡張中の大学DB」を使い、大学・学部・学科別の評価軸 / 過去問傾向 /
// アドミッションポリシー / ai_strategy_hint を AI に渡して、質問・整理メモを生成する想定。
// それを見越して以下の optional フィールドを先に schema に置く:
//   - UniversityPrepareEntry.evaluationContext   ... 生成時に AI へ渡した(= 渡す)
//                                                   DB スナップショット
//   - UniversityPrepareEntry.generationMode      ... 'deterministic' | 'ai'
//   - 各 question.sourceContext                  ... その質問文を作る根拠となった
//                                                   DB 由来スニペット
// すべて optional 扱いで normalize 通過させるので、旧データとの後方互換は保たれる。
// AI 化したい時はこのファイルの shape を変えずに、buildUniversityFocusedQuestions の
// 実装を「DB 由来テンプレ」から「AI 生成 + sourceContext 付き」へ差し替えるだけで済む。

import {
  safeGetStorage,
  safeSetStorage,
  safeRemoveStorage,
} from '@/lib/storage/safeStorage';
import {
  saveStatementPrepareSummary,
  type StatementPrepareSummary,
} from '@/lib/statement/prepare/statementPrepareStorage';

const HISTORY_KEY = 'statement_prepare_summary_history';
const MAX_HISTORY = 10;

export type UniversityFocusedQuestionId =
  | 'why_this_uni'
  | 'philosophy_fit'
  | 'learning_focus'
  | 'future_link'
  | 'why_only_here'
  | 'activity_link';

// 質問文を作る根拠となった DB 由来スニペット。
// 今は label 生成時に使った admission_policy / evaluation_points / ai_strategy_hint の
// 抜粋を保持する。将来 AI 生成に切り替えても、AI に「どのスニペットから生成したか」を
// 戻り値に含めさせれば同じ shape で書き込める。すべて optional。
export type QuestionSourceContext = {
  admissionPolicySnippet?: string;
  evaluationPointSnippet?: string;
  aiStrategyHintSnippet?: string;
  // 将来追加候補（schema 変更不要）:
  //   pastExamHintSnippet ... 過去問傾向（selection_type === '小論文' 等の format / hint）
  //   facultyAxisSnippet  ... 学部・学科別の評価軸（DB 拡張後）
};

// 生成時に AI へ渡した DB スナップショット。
// 「あとから AI で再生成したいときに DB バージョン差を気にせず replay できる」
// ことを目的に、生成入力を entry にも保存しておく。
// 今は deterministic 生成のため populated されるが、将来 AI 生成でも同じ shape に乗る。
export type UniversityEvaluationContext = {
  // 「書類」selection_type の admission_policy 集約（uniqueMeaningful 済み）
  admissionPolicies: string[];
  // 「書類」selection_type の evaluation_points 集約
  evaluationPoints: string[];
  // 「書類」selection_type の ai_strategy_hint 集約
  aiStrategyHints: string[];
  // 過去問傾向。今は未収集（後段 STEP で「小論文」「面接」selection_type の
  // format / evaluation_points / ai_strategy_hint から抽出する想定）。
  // 型に席だけ用意しておき、収集ロジックは AI 化と同じ STEP で導入する。
  pastExamHints?: string[];
};

export type UniversityPrepareEntry = {
  id: string;
  createdAt: string; // ISO 8601
  university: string;
  faculty: string;
  department: string;
  questions: Array<{
    id: UniversityFocusedQuestionId;
    label: string;
    answer: string;
    // 将来拡張: その質問を作る根拠になった DB スニペット。AI 生成切替時に必要。
    sourceContext?: QuestionSourceContext;
  }>;
  // 既存 /api/statement-prepare の戻り 5 項目をそのまま保持。
  // shape は StatementPrepareSummary の subset と一致（updatedAt / inputSignature を持たない）。
  summary: {
    impressiveExperience: string;
    feltIssue: string;
    interestInField: string;
    universityLearning: string;
    futureApplication: string;
  };
  // 将来拡張: 生成時に AI へ渡した DB スナップショット。今は deterministic でも populate する。
  evaluationContext?: UniversityEvaluationContext;
  // 将来拡張: この entry をどう作ったかの audit。AI 化後の解析・migration に使う。
  generationMode?: 'deterministic' | 'ai';
};

const VALID_QUESTION_IDS: ReadonlySet<UniversityFocusedQuestionId> = new Set<
  UniversityFocusedQuestionId
>([
  'why_this_uni',
  'philosophy_fit',
  'learning_focus',
  'future_link',
  'why_only_here',
  'activity_link',
]);

export function loadUniversityPrepareHistory(): UniversityPrepareEntry[] {
  const raw = safeGetStorage<unknown>(HISTORY_KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: UniversityPrepareEntry[] = [];
  for (const item of raw) {
    const normalized = normalizeEntry(item);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function appendUniversityPrepareEntry(
  entry: UniversityPrepareEntry,
): void {
  const existing = loadUniversityPrepareHistory();
  const updated = [entry, ...existing].slice(0, MAX_HISTORY);
  safeSetStorage(HISTORY_KEY, updated);

  // ② edit 左サイド欄が参照する既存 key にも最新 summary を同期する。
  // inputSignature は本 flow では 6 問入力なので互換 signature を作れない。
  // 旧 key の inputSignature 比較は「同入力なら API 呼ばずに再利用」用途で、
  // 本 flow からは旧 /statement/prepare の API 経路に乗らない（独立した cache 一致）。
  // 旧 page 側の cache 一致経路はそちらの入力に紐づくため、本書き戻しは
  // signature 空文字で問題ない（旧 page で signature 空 → 必ず比較が外れて API 再呼出し、
  // という既存挙動と同じ）。
  const summaryForSync: Omit<StatementPrepareSummary, 'updatedAt'> = {
    impressiveExperience: entry.summary.impressiveExperience,
    feltIssue: entry.summary.feltIssue,
    interestInField: entry.summary.interestInField,
    universityLearning: entry.summary.universityLearning,
    futureApplication: entry.summary.futureApplication,
    inputSignature: '',
  };
  saveStatementPrepareSummary(summaryForSync);
}

export function deleteUniversityPrepareEntry(id: string): void {
  const existing = loadUniversityPrepareHistory();
  const updated = existing.filter((item) => item.id !== id);
  safeSetStorage(HISTORY_KEY, updated);
}

export function clearUniversityPrepareHistory(): void {
  safeRemoveStorage(HISTORY_KEY);
}

// ── 内部 normalize ────────────────────────────────────────────────
// 破損 / 未知 key を drop しつつ、最低限の shape を満たすものだけ通す。

function normalizeEntry(value: unknown): UniversityPrepareEntry | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    typeof v.createdAt !== 'string' ||
    typeof v.university !== 'string' ||
    typeof v.faculty !== 'string' ||
    typeof v.department !== 'string'
  ) {
    return null;
  }
  const summary = normalizeSummary(v.summary);
  if (!summary) return null;
  const questions = normalizeQuestions(v.questions);
  const entry: UniversityPrepareEntry = {
    id: v.id,
    createdAt: v.createdAt,
    university: v.university,
    faculty: v.faculty,
    department: v.department,
    questions,
    summary,
  };
  // optional 拡張フィールドは、存在する場合のみ shape を満たすかチェックして付与する。
  // 旧データ（フィールド無し）も新データ（フィールド有り）もそのまま通す。
  const evaluationContext = normalizeEvaluationContext(v.evaluationContext);
  if (evaluationContext) entry.evaluationContext = evaluationContext;
  if (v.generationMode === 'deterministic' || v.generationMode === 'ai') {
    entry.generationMode = v.generationMode;
  }
  return entry;
}

function normalizeSummary(
  value: unknown,
): UniversityPrepareEntry['summary'] | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.impressiveExperience !== 'string' ||
    typeof v.feltIssue !== 'string' ||
    typeof v.interestInField !== 'string' ||
    typeof v.universityLearning !== 'string' ||
    typeof v.futureApplication !== 'string'
  ) {
    return null;
  }
  return {
    impressiveExperience: v.impressiveExperience,
    feltIssue: v.feltIssue,
    interestInField: v.interestInField,
    universityLearning: v.universityLearning,
    futureApplication: v.futureApplication,
  };
}

function normalizeQuestions(
  value: unknown,
): UniversityPrepareEntry['questions'] {
  if (!Array.isArray(value)) return [];
  const out: UniversityPrepareEntry['questions'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    if (
      typeof v.id !== 'string' ||
      typeof v.label !== 'string' ||
      typeof v.answer !== 'string'
    ) {
      continue;
    }
    if (!VALID_QUESTION_IDS.has(v.id as UniversityFocusedQuestionId)) continue;
    const question: UniversityPrepareEntry['questions'][number] = {
      id: v.id as UniversityFocusedQuestionId,
      label: v.label,
      answer: v.answer,
    };
    const sourceContext = normalizeSourceContext(v.sourceContext);
    if (sourceContext) question.sourceContext = sourceContext;
    out.push(question);
  }
  return out;
}

function normalizeSourceContext(value: unknown): QuestionSourceContext | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const out: QuestionSourceContext = {};
  if (typeof v.admissionPolicySnippet === 'string') {
    out.admissionPolicySnippet = v.admissionPolicySnippet;
  }
  if (typeof v.evaluationPointSnippet === 'string') {
    out.evaluationPointSnippet = v.evaluationPointSnippet;
  }
  if (typeof v.aiStrategyHintSnippet === 'string') {
    out.aiStrategyHintSnippet = v.aiStrategyHintSnippet;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeEvaluationContext(
  value: unknown,
): UniversityEvaluationContext | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const admissionPolicies = toStringArray(v.admissionPolicies);
  const evaluationPoints = toStringArray(v.evaluationPoints);
  const aiStrategyHints = toStringArray(v.aiStrategyHints);
  if (
    admissionPolicies === null ||
    evaluationPoints === null ||
    aiStrategyHints === null
  ) {
    return null;
  }
  const out: UniversityEvaluationContext = {
    admissionPolicies,
    evaluationPoints,
    aiStrategyHints,
  };
  const pastExamHints = toStringArrayOptional(v.pastExamHints);
  if (pastExamHints) out.pastExamHints = pastExamHints;
  return out;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

function toStringArrayOptional(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
  }
  return out.length > 0 ? out : undefined;
}
