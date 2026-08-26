// PASSAI 受験版 Exam Spine — Stage 3 の唯一の I/O 境界。
//
// `ExamReadQuery`（データ）を PostgREST 呼び出しに変換する。**ここ以外に I/O は無い。**
//
// セキュリティ契約（E-L3 / E-L4 / Stage 3 §Auth）:
//   - 受け取るのは **authenticated user-scoped client** のみ。
//     anon key + cookie session + owner RLS で閉じた client を呼び出し側が渡す
//     （`lib/supabase/serverClient.ts:getServerSupabaseClient()` 相当）。
//   - service_role client を受け取らない・作らない・import しない。
//     `SUPABASE_SERVICE_ROLE_KEY` / `serviceRoleClient` を lib/examSpine/** から参照しない。
//   - RLS は auth.uid() = user_id で閉じるが、query 側にも明示 `.eq('user_id', userId)` を置く
//     （二重防御）。owner filter が無い query は QA が落とす。
//   - **read only**。`select` 以外を呼ばない。insert / update / upsert / delete は
//     `ExamReadQuery` として表現できないので、ここに書く手段が構造的に無い。
//
// 備考: 本 file は server 実行専用（`.server.ts`）だが `import 'server-only'` は入れていない
//   （理由は requestSnapshot.server.ts の header と同じ / dependency を増やさない）。
//   `@supabase/supabase-js` は **type-only import** なので runtime 依存も作らない。

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExamReadExecutor, ExamReadQuery, ExamReadResponse } from './types';
import { formatSelect } from './types';

/**
 * user-scoped Supabase client から executor を作る。
 *
 * ★ client の素性（anon key / cookie session / RLS 配下であること）は呼び出し側の責務。
 *   ここでは client を作らないし env も読まない。
 */
export function createSupabaseExamReadExecutor(
  client: SupabaseClient,
): ExamReadExecutor {
  return async function execute(query: ExamReadQuery): Promise<ExamReadResponse> {
    try {
      // select 以外の入口を使わない。
      let builder = client.from(query.table).select(formatSelect(query));

      for (const filter of query.filters) {
        builder =
          filter.op === 'eq'
            ? builder.eq(filter.column, filter.value)
            : builder.in(filter.column, [...filter.values]);
      }
      for (const order of query.order) {
        builder = builder.order(order.column, { ascending: order.ascending });
      }
      if (query.limit !== null) {
        builder = builder.limit(query.limit);
      }

      if (query.mode === 'maybeSingle') {
        const { data, error } = await builder.maybeSingle();
        if (error) return { rows: null, error: { code: error.code ?? null, message: error.message ?? null } };
        // maybeSingle は 0 行で null を返す。「読めて 0 行」を `[]` として表現し、
        // 失敗側の `null` と混同しないようにする。
        return { rows: data === null ? [] : [data], error: null };
      }

      const { data, error } = await builder;
      if (error) return { rows: null, error: { code: error.code ?? null, message: error.message ?? null } };
      return { rows: Array.isArray(data) ? data : [], error: null };
    } catch (thrown) {
      // network / cookie / SDK 由来の throw も「その query の失敗」に畳む。
      // 上位（readSources）が kind 単位の error に閉じ、他 source を巻き込まない。
      return {
        rows: null,
        error: {
          code: null,
          message: thrown instanceof Error ? thrown.message : String(thrown),
        },
      };
    }
  };
}
