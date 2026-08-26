// anonymous mirror の server-only writer（service_role）。
//
// 役割:
//   検証済みの mirror payload を Supabase の anonymous mirror table へ upsert する。
//   これが mirror table への **唯一の書き込み経路**になる（browser から直接は書かない）。
//
// なぜ server 経由にするか:
//   従来は browser の anon client が直接 upsert していた。`INSERT ... ON CONFLICT DO UPDATE`
//   は RLS 下で対応する SELECT アクセスを要求するため、本番には
//   `"<table> anon select_for_upsert"`（FOR SELECT TO anon USING (true)）が置かれており、
//   結果として **全行が anon から読める**状態になっていた。
//   書き込みを server へ移すことで、anon の SELECT / INSERT / UPDATE policy をすべて
//   落とせるようになる（policy 削除は server 経路の QA 完了後に別 STEP で行う）。
//
// 厳守（安全境界）:
//   - `import 'server-only'`。client bundle に紛れたら build error。
//   - service_role client は本 module の外へ出さない。
//   - table 名は client 入力から受け取らない。呼び出し側が渡すのは MirrorKind のみ。
//   - never-throw。失敗は短い code へ畳む。
//   - **payload 本文 / PII を log に出さない**（byte 数と code のみ）。
//   - 行を読まない（`.select()` を付けない / count を要求しない）。戻り値に payload を含めない。
//
// 関連:
//   app/api/mirrors/route.ts（唯一の consumer）
//   lib/supabase/serviceRoleClient.ts（service_role 境界）
//   lib/mirrors/mirrorKinds.ts（kind → table の固定 map）

import 'server-only';

import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { MIRROR_KIND_TABLE, type MirrorKind } from './mirrorKinds';

export type MirrorWriteResult =
  | { ok: true }
  | { ok: false; code: 'client_unavailable' | 'write_failed' | 'unknown' };

export type MirrorWriteInput = {
  kind: MirrorKind;
  sourceHash: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
};

/**
 * 検証済み mirror payload を upsert する（never-throw）。
 *
 * conflict target は source_hash（schema.sql の UNIQUE 制約と一致）。
 * `.select()` を付けないため PostgREST は `return=minimal` で応答し、
 * 行データはサーバにもクライアントにも返らない。
 */
export async function writeMirrorRow(
  input: MirrorWriteInput,
): Promise<MirrorWriteResult> {
  const table = MIRROR_KIND_TABLE[input.kind];

  let client;
  try {
    client = getServiceRoleSupabaseClient();
  } catch {
    // env 未設定（SUPABASE_SERVICE_ROLE_KEY 欠落）等。詳細は log に出さない。
    return { ok: false, code: 'client_unavailable' };
  }

  try {
    const { error } = await client.from(table).upsert(
      {
        source_hash: input.sourceHash,
        schema_version: input.schemaVersion,
        payload: input.payload,
      },
      { onConflict: 'source_hash' },
    );

    if (error) {
      // Postgres / PostgREST の error code だけを観測に残す。message は payload や
      // 値を含みうるため出さない。
      console.warn('[mirror-write] failed', { kind: input.kind, code: error.code });
      return { ok: false, code: 'write_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[mirror-write] threw', {
      kind: input.kind,
      name: err instanceof Error ? err.name : 'UnknownError',
    });
    return { ok: false, code: 'unknown' };
  }
}
