import {
  safeGetStorage,
  safeSetStorage,
  safeRemoveStorage,
} from '@/lib/storage/safeStorage';
import type { StatementPrepareWeakPointKey } from '@/lib/statement/prepare/detectStatementPrepareWeakPoints';

// ── 型定義 ────────────────────────────────────────────────────────

export type StatementPrepareAnswers = {
  interestReason: string;
  memorableExperience: string;
  futureGoal: string;
  updatedAt: string;
};

// 志望理由書の構造に近い5項目構成。API（/api/statement-prepare）の返却型と一致させる。
// 1. 印象に残った経験              → impressiveExperience
// 2. その経験から感じたこと・問題意識 → feltIssue
// 3. なぜその分野・学部に興味を持ったか → interestInField
// 4. 大学で深めたいこと             → universityLearning
// 5. 将来どう活かしたいか           → futureApplication
//
// inputSignature: 入力3項目の正規化キー（STEP 8）。同じ入力なら API を呼ばずに再利用するため。
//   - STEP 8 以降の保存データには必ず付与される
//   - STEP 7 以前の旧データには無いので、読み込み時に "" を補完する（comparison が必ず外れる）
export type StatementPrepareSummary = {
  impressiveExperience: string;
  feltIssue: string;
  interestInField: string;
  universityLearning: string;
  futureApplication: string;
  inputSignature: string;
  updatedAt: string;
};

// STEP 18: 深掘り回答（trim 済み・1文字以上のみ）の保存型。
//   - 構造: Partial<Record<WeakPointKey, string>>
//   - 永続化のみ担当。trim や value 検査は読み込み時にも行う（旧データ・部分破損対策）。
export type StatementPrepareFollowUpAnswers = Partial<
  Record<StatementPrepareWeakPointKey, string>
>;

// ── localStorage キー ─────────────────────────────────────────────

const ANSWERS_KEY = 'statement_prepare_answers';
const SUMMARY_KEY = 'statement_prepare_summary';
const FOLLOW_UP_KEY = 'statementPrepareFollowUpAnswers';

// STEP 18: 既知の WeakPointKey のみを許可（未知キーは読み捨て）。
const FOLLOW_UP_VALID_KEYS: ReadonlySet<StatementPrepareWeakPointKey> = new Set<
  StatementPrepareWeakPointKey
>(['experience', 'issue', 'interest', 'universityLearning', 'future']);

// ── 入力回答 ──────────────────────────────────────────────────────

export function saveStatementPrepareAnswers(
  data: Omit<StatementPrepareAnswers, 'updatedAt'>,
): void {
  const payload: StatementPrepareAnswers = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  safeSetStorage(ANSWERS_KEY, payload);
}

export function getStatementPrepareAnswers(): StatementPrepareAnswers | null {
  return safeGetStorage<StatementPrepareAnswers | null>(ANSWERS_KEY, null);
}

export function clearStatementPrepareAnswers(): void {
  safeRemoveStorage(ANSWERS_KEY);
}

// ── 整理結果 ──────────────────────────────────────────────────────

export function saveStatementPrepareSummary(
  data: Omit<StatementPrepareSummary, 'updatedAt'>,
): void {
  const payload: StatementPrepareSummary = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  safeSetStorage(SUMMARY_KEY, payload);
}

// 旧スキーマが localStorage に残っていても、5項目 + updatedAt が string なら受け入れる。
// inputSignature は STEP 7 以前のデータに存在しないので、欠落時は "" を補う。
//   → 「保存済みの整理結果は表示できる」「ただし signature 比較は必ず外れて API 再呼び出しになる」
export function getStatementPrepareSummary(): StatementPrepareSummary | null {
  const raw = safeGetStorage<unknown>(SUMMARY_KEY, null);
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (
    typeof v.impressiveExperience !== 'string' ||
    typeof v.feltIssue !== 'string' ||
    typeof v.interestInField !== 'string' ||
    typeof v.universityLearning !== 'string' ||
    typeof v.futureApplication !== 'string' ||
    typeof v.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    impressiveExperience: v.impressiveExperience,
    feltIssue: v.feltIssue,
    interestInField: v.interestInField,
    universityLearning: v.universityLearning,
    futureApplication: v.futureApplication,
    inputSignature:
      typeof v.inputSignature === 'string' ? v.inputSignature : '',
    updatedAt: v.updatedAt,
  };
}

export function clearStatementPrepareSummary(): void {
  safeRemoveStorage(SUMMARY_KEY);
}

// ── 深掘り回答（STEP 18） ─────────────────────────────────────────

// 受け取った値からトリム後 1 文字以上のものだけを保存する。0 件なら何もしない（呼び出し側で判定）。
export function saveStatementPrepareFollowUpAnswers(
  data: StatementPrepareFollowUpAnswers,
): void {
  safeSetStorage(FOLLOW_UP_KEY, data);
}

// 既知キー × string × trim 後 1 文字以上、の条件を満たすエントリだけを返す。
// それ以外（未知キー・空文字・型不一致・全体が壊れている）は空オブジェクト扱い。
export function getStatementPrepareFollowUpAnswers(): StatementPrepareFollowUpAnswers {
  const raw = safeGetStorage<unknown>(FOLLOW_UP_KEY, null);
  if (!raw || typeof raw !== 'object') return {};
  const result: StatementPrepareFollowUpAnswers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    if (v.trim().length === 0) continue;
    if (!FOLLOW_UP_VALID_KEYS.has(k as StatementPrepareWeakPointKey)) continue;
    result[k as StatementPrepareWeakPointKey] = v;
  }
  return result;
}

export function clearStatementPrepareFollowUpAnswers(): void {
  safeRemoveStorage(FOLLOW_UP_KEY);
}

// ── 再利用判定キー（STEP 8） ──────────────────────────────────────

// 入力3項目から再利用判定用の簡易キーを作る。
//   - 各項目を trim
//   - 連続空白（半角・全角ともに \s で吸収される）を1つに寄せる
//   - "|" で結合
// 全空入力（"||"）はクライアント側で事前ブロックされるので、ここに到達しない想定。
// 旧データ補完時の "" センチネルとは別物。
export function buildInputSignature(input: {
  interestReason: string;
  memorableExperience: string;
  futureGoal: string;
}): string {
  const norm = (s: string): string => s.trim().replace(/\s+/g, ' ');
  return [
    norm(input.interestReason),
    norm(input.memorableExperience),
    norm(input.futureGoal),
  ].join('|');
}
