// anonymous mirror の client 側 transport（Phase1 boundary helper）。
//
// 役割:
//   4 つの mirror helper が共有する「/api/mirrors への POST」を 1 箇所に閉じる。
//   従来はここが `browserClient.from(TABLE).upsert(...)`（anon 直接書き込み）だった。
//
// なぜ直接 upsert をやめたか:
//   `INSERT ... ON CONFLICT DO UPDATE` は RLS 下で対応する SELECT アクセスを要求する。
//   そのため本番には `"<table> anon select_for_upsert"`（FOR SELECT TO anon USING (true)）が
//   置かれており、mirror の全行が anon key で読める状態になっていた。
//   書き込みを server route へ移すことで、anon の SELECT / INSERT / UPDATE policy を
//   まとめて落とせるようにする。
//
// Phase1 契約（従来どおり維持）:
//   - Best-effort。**never throw**。常に結果 object へ解決する。
//   - No reads。応答に mirror payload は含まれない（route が返さない）。
//   - 呼び出し側は fire-and-forget。UX を妨げない。
//
// 失敗 code は既存の MirrorFailureReason 語彙へ写像できる短い文字列のみ。
// payload 本文は log にも戻り値にも出さない。
//
// 関連: app/api/mirrors/route.ts / lib/mirrors/mirrorKinds.ts

import type { MirrorKind } from '@/lib/mirrors/mirrorKinds';

export type MirrorTransportResult =
  | { ok: true }
  | { ok: false; code: string };

export type MirrorTransportInput = {
  kind: MirrorKind;
  sourceHash: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
};

/** mirror 1 件を server route へ送る。never-throw。 */
export async function postMirror(
  input: MirrorTransportInput,
): Promise<MirrorTransportResult> {
  try {
    const res = await fetch('/api/mirrors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: input.kind,
        sourceHash: input.sourceHash,
        schemaVersion: input.schemaVersion,
        payload: input.payload,
      }),
      // mirror は best-effort。キャッシュも認証 cookie も不要。
      cache: 'no-store',
    });

    if (res.ok) return { ok: true };

    // route は { ok:false, error } を返す契約。読めない場合は status へ落とす。
    let code = `http_${res.status}`;
    try {
      const data: unknown = await res.json();
      const err = (data as { error?: unknown } | null)?.error;
      if (typeof err === 'string' && err.length <= 64) code = err;
    } catch {
      // ignore — status ベースの code を使う
    }
    return { ok: false, code };
  } catch (err) {
    // network 断 / abort 等。message は URL やユーザー値を含みうるため使わない。
    return { ok: false, code: err instanceof Error ? err.name : 'unknown' };
  }
}
