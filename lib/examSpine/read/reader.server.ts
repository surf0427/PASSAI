// Exam Spine — server-side source reader（Phase 2）。
//
// 位置づけ:
//   auth-scoped な durable table から **row を読むだけ**の層。
//   lib/contextBuilders/tutorContext.ts に同居していた Supabase 読み取りを、
//   feature 方針（truncate 件数 / 表示ラベル / prompt 文言）を持ち込まずに移設したもの。
//
// 責務:
//   - user-scoped client の解決
//   - kind ごとの SELECT（owner RLS 配下）
//   - 例外 / PostgREST error を SourceState へ畳む（throw しない）
//   - 複数 source の並列実行（Promise.allSettled）と所要時間の観測
//
// 責務でないもの（呼び出し側 = feature の projection 層に残す）:
//   - 何件 / 何文字に切るか
//   - 表示ラベル・日本語文言・section header・prompt 文言
//   - どの source を prompt に出すかの判断
//
// セキュリティ契約（E-L3 / E-L4）:
//   - userId は **引数でのみ**受け取る。body / query / JSON から読まない。
//   - client は anon key + owner RLS の user-scoped client に限る。
//     service_role client を受け取らない・作らない・import しない。
//   - RLS は auth.uid() = user_id で閉じるが、明示 .eq('user_id', userId) も併記する（二重防御）。
//   - `*_mirrors` は user_id 列も owner SELECT policy も持たないため読まない。
//   - **read only。** insert / update / upsert / delete を書かない。
//
// fail-open（E-S1）:
//   table 不存在 / RLS 拒否 / 通信断 / 例外 のいずれでも throw しない。
//   その kind だけが unavailable になり、他 kind と全体は成功として継続する。
//
// 関連:
//   lib/examSpine/read/rowMappers.ts
//   lib/examSpine/read/snapshot.server.ts
//   lib/contextBuilders/tutorContext.ts（Phase 2 時点で唯一の consumer）

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getServerSupabaseClient } from '@/lib/supabase/serverClient';
import {
  SOURCE_ABSENT,
  SOURCE_UNAVAILABLE,
  sourceReady,
  type SourceState,
} from '@/lib/examSpine/types';
import { asRecord, firstRecord } from './rowMappers';

// ── 0. 観測ラベル ─────────────────────────────────────────────────
//
// 既存の運用ログ（`[TutorContextSources]` / `tutor supabase context: ...`）を
// 1 文字も変えないため、ラベルは呼び出し側から受け取る。
// Spine 側で固定文言を持たない = feature を跨いでも log 契約が壊れない。

export type ExamSpineReadOptions = {
  /** console.warn の接頭辞。例: 'tutor supabase context'。 */
  logLabel: string;
};

function warn(
  opts: ExamSpineReadOptions,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (meta === undefined) console.warn(`${opts.logLabel}: ${message}`);
  else console.warn(`${opts.logLabel}: ${message}`, meta);
}

// ── 1. client 解決 ────────────────────────────────────────────────

/**
 * user-scoped Supabase client を解決する。
 *
 * route 側で auth 済みの client を注入すると、ここでの再生成（= cookie 再パース）を避けられる。
 * 未指定なら cookie から生成する。env 未設定 / cookie 無しなら null。
 *
 * ⚠️ 注入してよいのは **anon key + RLS の user-scoped client** のみ。
 *    service_role client を渡すと owner 境界が消える。
 */
export async function resolveExamSpineClient(
  injectedClient?: SupabaseClient | null,
): Promise<SupabaseClient | null> {
  return injectedClient ?? (await getServerSupabaseClient());
}

// ── 2. kind reader（snapshot 型）───────────────────────────────────

/**
 * snapshot 型 table（1 user 1 行 / payload jsonb）を userId scope で 1 件読む。
 * basic_info_logs / diagnosis_logs / activity_logs が該当する。
 */
export async function readSnapshotPayload(
  client: SupabaseClient,
  table: string,
  userId: string,
  opts: ExamSpineReadOptions,
): Promise<SourceState<Record<string, unknown>>> {
  try {
    const { data, error } = await client
      .from(table)
      .select('payload')
      .eq('user_id', userId)
      .maybeSingle<{ payload: unknown }>();
    if (error) {
      // SQL 未 apply（relation 不存在）/ RLS 失敗 等。静かに no-op。
      warn(opts, 'snapshot read error', { table, code: error.code });
      return SOURCE_UNAVAILABLE;
    }
    const payload = asRecord(data?.payload);
    return payload ? sourceReady(payload) : SOURCE_ABSENT;
  } catch {
    warn(opts, 'snapshot read threw', { table });
    return SOURCE_UNAVAILABLE;
  }
}

export function readBasicInfoSnapshot(
  client: SupabaseClient,
  userId: string,
  opts: ExamSpineReadOptions,
): Promise<SourceState<Record<string, unknown>>> {
  return readSnapshotPayload(client, 'basic_info_logs', userId, opts);
}

export function readDiagnosisSnapshot(
  client: SupabaseClient,
  userId: string,
  opts: ExamSpineReadOptions,
): Promise<SourceState<Record<string, unknown>>> {
  return readSnapshotPayload(client, 'diagnosis_logs', userId, opts);
}

export function readActivitySnapshot(
  client: SupabaseClient,
  userId: string,
  opts: ExamSpineReadOptions,
): Promise<SourceState<Record<string, unknown>>> {
  return readSnapshotPayload(client, 'activity_logs', userId, opts);
}

// ── 3. kind reader（履歴型 / 最新 1 件）────────────────────────────

/**
 * self_analysis_logs の最新 1 件。row をそのまま（guard 済み record として）返す。
 * どの field を採るかは呼び出し側の projection が決める。
 */
export async function readLatestSelfAnalysisRow(
  client: SupabaseClient,
  userId: string,
  opts: ExamSpineReadOptions,
): Promise<SourceState<Record<string, unknown>>> {
  try {
    const res = await client
      .from('self_analysis_logs')
      .select('analysis, summary, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (res.error) {
      warn(opts, 'self_analysis_logs read error', { code: res.error.code });
      return SOURCE_UNAVAILABLE;
    }
    const rec = firstRecord(res.data);
    return rec ? sourceReady(rec) : SOURCE_ABSENT;
  } catch {
    warn(opts, 'self_analysis_logs read threw');
    return SOURCE_UNAVAILABLE;
  }
}

/**
 * 最新の completed AI 面接 1 件（session row + embed した result.feedback）。
 * turn 履歴 / 音声 / STT 全文は読まない（SELECT 対象に含めない）。
 * interview_ai_results の SELECT は session 経由 EXISTS RLS で owner に閉じる（schema §60）。
 */
export async function readLatestInterviewAiRow(
  client: SupabaseClient,
  userId: string,
  opts: ExamSpineReadOptions,
): Promise<SourceState<Record<string, unknown>>> {
  try {
    const res = await client
      .from('interview_ai_sessions')
      .select('created_at, interview_type, interview_ai_results(feedback)')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1); // 最新 1 件。3 件対応時はここを上げて配列化する。
    if (res.error) {
      warn(opts, 'interview_ai read error', { code: res.error.code });
      return SOURCE_UNAVAILABLE;
    }
    const rec = firstRecord(res.data);
    return rec ? sourceReady(rec) : SOURCE_ABSENT;
  } catch {
    warn(opts, 'interview_ai read threw');
    return SOURCE_UNAVAILABLE;
  }
}

/**
 * 最新のプレゼン評価結果 1 件。
 * 録画 / Storage URL / STT 全文 / Q&A 履歴は読まない（SELECT 対象に含めない）。
 */
export async function readLatestPresentationResultRow(
  client: SupabaseClient,
  userId: string,
  opts: ExamSpineReadOptions,
): Promise<SourceState<Record<string, unknown>>> {
  try {
    const res = await client
      .from('presentation_results')
      .select('created_at, feedback, attempt_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1); // 最新 1 件。3 件対応時はここを上げて配列化する。
    if (res.error) {
      warn(opts, 'presentation read error', { code: res.error.code });
      return SOURCE_UNAVAILABLE;
    }
    const rec = firstRecord(res.data);
    return rec ? sourceReady(rec) : SOURCE_ABSENT;
  } catch {
    warn(opts, 'presentation read threw');
    return SOURCE_UNAVAILABLE;
  }
}

/**
 * attempt → session の付随情報（大学名 / 学部名 / テーマ）を best-effort で読む。
 *
 * ⚠️ 呼び出しは **呼び出し側の判断**（core が使えるときだけ引く）に委ねる。
 *    ここで無条件に引くと、core が空のときにも query が 1 本増えてしまう。
 * 失敗しても SOURCE_UNAVAILABLE を返すだけで、core の結果には影響させない。
 */
export async function readPresentationSessionByAttempt(
  attemptClient: SupabaseClient,
  attemptId: string,
): Promise<SourceState<Record<string, unknown>>> {
  if (!attemptId) return SOURCE_ABSENT;
  try {
    const res = await attemptClient
      .from('presentation_attempts')
      .select('presentation_sessions(university_name, faculty_name, theme)')
      .eq('id', attemptId)
      .maybeSingle();
    const attemptRec = asRecord(res.data);
    return attemptRec ? sourceReady(attemptRec) : SOURCE_ABSENT;
  } catch {
    // enrichment 失敗は無視（呼び出し側は core だけで続行する）。
    return SOURCE_UNAVAILABLE;
  }
}

// ── 4. 並列実行 + 観測 ────────────────────────────────────────────
//
// 「複数 source を並列に読み、1 つ失敗しても全体を止めない」構造を Spine 側に持つ。
// 各 unit が何を返すかは呼び出し側の型 T に委ねる（Spine は中身を解釈しない）。

export type ExamSourceUnit<T> = {
  /** 観測ログのキー。例: 'selfAnalysis_ms'。 */
  timingKey: string;
  /** 実際の読み取り + 呼び出し側 projection。throw しても allSettled が受け止める。 */
  run: () => Promise<T>;
};

export type LoadExamSourcesOptions = {
  /** console.info の接頭辞。例: '[TutorContextSources]'。 */
  timingLabel: string;
  /** ログに載せる追加の真偽メタ。**PII / 本文 / UUID を入れないこと**（E-S13）。 */
  logMeta?: Record<string, boolean | number | string>;
};

/**
 * unit を並列実行し、settled 結果を返す。
 *
 * 保証:
 *   - throw しない。allSettled 自体が throw した場合も null を返して呼び出し側に委ねる。
 *   - 1 unit の失敗が他 unit に波及しない（fail-open）。
 *   - 所要時間と並列性を 1 行の JSON で観測する（duration と真偽のみ。PII は出さない）。
 */
export async function loadExamSources<T>(
  units: ReadonlyArray<ExamSourceUnit<T>>,
  opts: LoadExamSourcesOptions,
): Promise<Array<PromiseSettledResult<T>> | null> {
  const sourceTimings: Record<string, number> = {};
  const timed = async (name: string, fn: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    try {
      return await fn();
    } finally {
      sourceTimings[name] = Date.now() - s;
    }
  };

  const allSettledStart = Date.now();
  let settled: Array<PromiseSettledResult<T>>;
  try {
    settled = await Promise.allSettled(
      units.map((u) => timed(u.timingKey, u.run)),
    );
  } catch {
    // allSettled は本来 reject しないが、念のため。
    console.info(
      opts.timingLabel,
      JSON.stringify({
        ...sourceTimings,
        allSettled_ms: Date.now() - allSettledStart,
        ...(opts.logMeta ?? {}),
        error: 'allSettled_threw',
      }),
    );
    return null;
  }

  // 並列性の確認: allSettled_ms が max(各 source) に近ければ並列、合算に近ければ直列。
  console.info(
    opts.timingLabel,
    JSON.stringify({
      ...sourceTimings,
      allSettled_ms: Date.now() - allSettledStart,
      ...(opts.logMeta ?? {}),
    }),
  );

  return settled;
}
