import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

// 志望理由書「書き直し方針メモ」の永続化。reviewId（statementReviewHistory の id）単位で
// ユーザーが /statement/improve/rewrite/[id] に書いた内容を保持する。
//
// key: 'statement_rewrite_memo'  (JSON)
// 形 : Partial<Record<reviewId, RewriteMemoRecord>>
//
// 設計方針:
//   - rewrite = 整理 artifact。「ユーザーが書いた整理」だけを持つ。
//   - analysis = master 方針に従い、AI 出力（actions / weaknesses / strengths）や
//     pure function 派生（NgWord / Structure / EvaluationAxis）・score 派生 priority は
//     一切持たない。それらは ReviewHistoryItem.result を都度参照すれば derive 可能。
//   - 旧 'statement_rewrite_drafts'（軸別ガイド書き直し）の後継。
//     軸別 → reviewId 単位の紐付け換算ができないため migration は行わなかった。
//     旧 key は user の localStorage に残骸として残るが、誰も読まないため放置。
//
// schema version:
//   - v1（version 省略）: { text, updatedAt }                        … 旧フォーマット
//   - v2（version: 2）  : { text, updatedAt, version, workAnswers? } … 改善ポイント別ワーク回答対応
//   v1 record はそのまま load 可能（version / workAnswers が undefined になるだけ）。
//   workAnswers を初めて書いた時点で v2 にアップグレードされる。
//
// 容量見積:
//   1 memo 〜2KB（800字想定）× MAX_HISTORY 10 件 = 〜20KB。localStorage 5MB に対し誤差。
//   workAnswers が乗っても 1 record あたり数 KB 程度、容量上の懸念はない。
//
// API:
//   - loadRewriteMemo(reviewId)               : 1 件取得（v1/v2 透過）
//   - saveRewriteMemo(reviewId, record)        : 1 件 upsert。caller が workAnswers を
//                                                明示しない場合は既存 workAnswers を保持
//                                                （text-only autosave で wipe しない）
//   - saveRewriteMemoWorkAnswer(reviewId, axisKey, questionKey, answer):
//                                                改善ポイント別ワークの 1 回答を upsert
//   - loadAllRewriteMemos()                    : 全件取得（hasMemo 判定 / 一覧表示用）
//   clear 系 / migration 系は意図的に持たない（review 削除 UI が無いため YAGNI）。

const KEY = 'statement_rewrite_memo';

/**
 * 改善ポイント別ワークの回答。
 * 外側 key = 改善ポイントの安定 key（axis / improvement id / label など、
 *           ReviewHistoryItem.result から render-time に derive 可能なもの）。
 * 内側 key = ワーク内の各質問 id。
 *
 * 設計意図: AI summary や bullet snapshot は保存しない（stale / duplicated artifact 防止）。
 * edit 側では loadRewriteMemo の workAnswers から render-time で derive する。
 */
export type RewriteMemoWorkAnswers = Partial<
  Record<string, Partial<Record<string, string>>>
>;

export type RewriteMemoRecord = {
  text: string;
  updatedAt: string;    // ISO 8601
  version?: 2;          // undefined = v1 (legacy)。v2 から付与される
  workAnswers?: RewriteMemoWorkAnswers; // v2 から追加
};

export type RewriteMemosByReviewId = Partial<Record<string, RewriteMemoRecord>>;

export function loadAllRewriteMemos(): RewriteMemosByReviewId {
  const raw = safeGetStorage<unknown>(KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  // 部分破損データを drop して安全側に倒す。throw しない方針。
  const out: RewriteMemosByReviewId = {};
  for (const [reviewId, value] of Object.entries(raw as Record<string, unknown>)) {
    const sanitized = sanitizeRecord(value);
    if (sanitized) out[reviewId] = sanitized;
  }
  return out;
}

export function loadRewriteMemo(reviewId: string): RewriteMemoRecord | null {
  return loadAllRewriteMemos()[reviewId] ?? null;
}

/**
 * record を upsert する。
 * - caller が workAnswers を未指定の場合は既存 workAnswers を保持する。
 *   これにより text-only autosave（既存の `saveRewriteMemo(id, { text, updatedAt })`）が
 *   workAnswers を wipe しないことを保証する。
 * - caller が workAnswers を明示的に渡した場合はその値で置換する（partial merge ではない）。
 *   ワーク回答の 1 個 upsert には saveRewriteMemoWorkAnswer を使う。
 */
export function saveRewriteMemo(
  reviewId: string,
  record: RewriteMemoRecord,
): void {
  const all = loadAllRewriteMemos();
  const existing = all[reviewId];
  const workAnswers =
    record.workAnswers !== undefined ? record.workAnswers : existing?.workAnswers;
  const next: RewriteMemoRecord = {
    text: record.text,
    updatedAt: record.updatedAt,
  };
  if (workAnswers !== undefined) {
    next.version = 2;
    next.workAnswers = workAnswers;
  }
  all[reviewId] = next;
  safeSetStorage(KEY, all);
}

/**
 * 改善ポイント別ワークの 1 回答を upsert する。
 * 同一 reviewId の text / 他の workAnswers は維持される（partial update）。
 * record 自体が無い場合は text='' で初期化（mount-init 前の write を許容）。
 */
export function saveRewriteMemoWorkAnswer(
  reviewId: string,
  axisKey: string,
  questionKey: string,
  answer: string,
): void {
  const all = loadAllRewriteMemos();
  const existing = all[reviewId];
  const prevAxis = existing?.workAnswers?.[axisKey] ?? {};
  const nextWorkAnswers: RewriteMemoWorkAnswers = {
    ...(existing?.workAnswers ?? {}),
    [axisKey]: { ...prevAxis, [questionKey]: answer },
  };
  all[reviewId] = {
    text: existing?.text ?? '',
    updatedAt: new Date().toISOString(),
    version: 2,
    workAnswers: nextWorkAnswers,
  };
  safeSetStorage(KEY, all);
}

function sanitizeRecord(v: unknown): RewriteMemoRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.text !== 'string') return null;
  if (typeof r.updatedAt !== 'string') return null;
  const out: RewriteMemoRecord = { text: r.text, updatedAt: r.updatedAt };
  const workAnswers = sanitizeWorkAnswers(r.workAnswers);
  if (workAnswers) {
    out.version = 2;
    out.workAnswers = workAnswers;
  } else if (r.version === 2) {
    out.version = 2;
  }
  return out;
}

function sanitizeWorkAnswers(v: unknown): RewriteMemoWorkAnswers | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: RewriteMemoWorkAnswers = {};
  for (const [axisKey, axisVal] of Object.entries(v as Record<string, unknown>)) {
    if (!axisVal || typeof axisVal !== 'object' || Array.isArray(axisVal)) continue;
    const sanitizedAxis: Partial<Record<string, string>> = {};
    for (const [qKey, qVal] of Object.entries(axisVal as Record<string, unknown>)) {
      if (typeof qVal === 'string') sanitizedAxis[qKey] = qVal;
    }
    if (Object.keys(sanitizedAxis).length > 0) out[axisKey] = sanitizedAxis;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
