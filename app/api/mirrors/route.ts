// POST /api/mirrors — anonymous mirror の唯一の書き込み経路。
//
// 背景:
//   従来は browser の anon Supabase client が mirror table へ直接 upsert していた。
//   `INSERT ... ON CONFLICT DO UPDATE` は RLS 下で SELECT アクセスを要求するため、
//   本番には `"<table> anon select_for_upsert"`（FOR SELECT TO anon USING (true)）が
//   置かれており、結果として mirror の全行が anon key で読める状態になっていた。
//   書き込みを本 route へ集約することで、anon の SELECT / INSERT / UPDATE policy を
//   すべて落とせるようにする（policy 削除は本経路の QA 完了後・別 STEP）。
//
// 設計（単一 route を選んだ理由）:
//   4 つの mirror は body 形状・conflict target・失敗時の扱いが完全に同一で、
//   違いは「どの table へ書くか」だけ。kind → table を server 側の固定 map で解決すれば、
//   validation / rate limit / size guard / log 方針を 1 箇所に集約できる。
//   kind 別に 4 route へ分けると同じ検証が 4 重化し drift する。
//
// セキュリティ契約:
//   - client から user_id を受け取らない・信用しない（anonymous mirror に owner 概念は無い）。
//   - client から table 名を受け取らない。kind の固定 allowlist のみ。
//   - service_role は server-only module の内側に閉じ、browser へ出さない。
//   - payload は allowlist validation + kind 別 size 上限。unknown field は保存しない。
//   - **response に mirror payload を返さない**（{ ok: true } のみ）。
//   - **log に payload 本文 / PII を出さない**（kind / code / byte 数のみ）。
//   - rate limit（IP ベース）で anonymous 書き込みの濫用を抑える。
//
// UX 契約（既存を維持）:
//   呼び出し側（lib/supabase/mirror*.ts）は fire-and-forget / never-throw。
//   本 route が 4xx / 5xx を返しても canonical UX には影響しない。
//
// 関連:
//   lib/mirrors/mirrorKinds.ts / validateMirrorRequest.ts / mirrorWriteServer.ts
//   lib/supabase/mirrorTransport.ts（client 側 transport）
//   supabase/schema.sql（source_hash UNIQUE / RLS 宣言）

import { NextResponse } from 'next/server';

import { checkServerRateLimit } from '@/lib/serverRateLimit';
import {
  mirrorValidationStatus,
  validateMirrorRequest,
} from '@/lib/mirrors/validateMirrorRequest';
import { writeMirrorRow } from '@/lib/mirrors/mirrorWriteServer';

// mirror は毎回ユーザー固有入力に依存する。Next.js / fetch 層のキャッシュを明示無効化する。
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// rate limit: 1 分あたり 30 件 / IP。
//   実測の発火頻度は「基本情報保存・活動 submit・診断完了・自己分析完了」で、
//   いずれもユーザー操作 1 回につき 1 件（activity の autosave は対象外）。
//   30/min は通常操作に対して十分に余裕があり、スクリプトによる連投は抑えられる。
const RATE_LIMIT = { keyPrefix: 'mirrors', windowMs: 60_000, maxRequests: 30 };

export async function POST(req: Request): Promise<Response> {
  // 1. rate limit（body を読む前に判定してパース負荷も抑える）
  const rate = checkServerRateLimit(req, RATE_LIMIT);
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  // 2. body parse（壊れた JSON は 400。中身は log しない）
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  // 3. allowlist validation（純関数。kind / schemaVersion / sourceHash / payload / size）
  const validated = validateMirrorRequest(body);
  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, error: validated.error },
      { status: mirrorValidationStatus(validated.error) },
    );
  }

  // 4. server-only write（service_role。never-throw）
  const result = await writeMirrorRow({
    kind: validated.kind,
    sourceHash: validated.sourceHash,
    schemaVersion: validated.schemaVersion,
    payload: validated.payload,
  });

  if (!result.ok) {
    // 観測は enum のみ。payload 本文・source_hash・PII は出さない。
    console.warn('[api/mirrors] write failed', {
      kind: validated.kind,
      code: result.code,
      payloadBytes: validated.payloadBytes,
    });
    return NextResponse.json({ ok: false, error: result.code }, { status: 502 });
  }

  // 成功応答に mirror payload を含めない。
  return NextResponse.json({ ok: true }, { status: 200 });
}
