// POST /api/mirrors の request body 検証（純関数）。
//
// 役割:
//   client から届く body を allowlist ベースで検証し、DB へ渡してよい形へ正規化する。
//   route から I/O を分離しているため、AI / DB / network 無しで QA できる。
//
// 厳守:
//   - 純関数。throw しない。I/O / env / Supabase / Date / Math.random を使わない。
//   - **unknown field を保存しない**（payload 以外の余分な key は捨てる）。
//   - table 名を body から受け取らない（kind のみ）。
//   - user_id を body から受け取らない・信用しない（anonymous mirror には owner 概念が無い）。
//   - 失敗理由は enum 的な短い code のみ返す。payload 本文をメッセージへ入れない。
//
// source_hash について:
//   **server 再計算はしない。** 理由:
//     - studentProfile の sourceHash は canonical pipeline（lib/studentProfile.ts）が
//       payload 外の素材も含めて算出しており、payload だけからは再現できない。
//     - 他 3 種は `sha256(JSON.stringify(payload) + schemaVersion)` だが、
//       JSON.stringify のキー順は object の挿入順に依存する。server が受信 JSON を
//       再 stringify するとキー順が変わり得るため、再計算すると **既存行と別 hash**
//       になり重複行を生む。
//   したがってここでは「形式（hex / 長さ）」のみを検証する。
//   偽造された sourceHash で起こりうる最悪ケースは「自分の mirror 行が重複する」ことで、
//   他ユーザーのデータへは到達しない（行は owner 概念を持たない anonymous sink）。
//
// 関連: lib/mirrors/mirrorKinds.ts / app/api/mirrors/route.ts

import {
  MIRROR_ALLOWED_SCHEMA_VERSIONS,
  MIRROR_PAYLOAD_MAX_BYTES,
  MIRROR_SOURCE_HASH_PATTERN,
  isMirrorKind,
  type MirrorKind,
} from './mirrorKinds';

/** 検証失敗の理由。enum 的な固定文字列のみ（PII / 本文を含めない）。 */
export type MirrorValidationError =
  | 'invalid_body'
  | 'invalid_kind'
  | 'invalid_schema_version'
  | 'invalid_source_hash'
  | 'invalid_payload'
  | 'payload_too_large';

export type MirrorValidationResult =
  | {
      ok: true;
      kind: MirrorKind;
      sourceHash: string;
      schemaVersion: string;
      /** DB へ渡す payload。unknown field は含めず、受け取った object をそのまま保持する。 */
      payload: Record<string, unknown>;
      /** 観測用（byte 数のみ。中身は持たない）。 */
      payloadBytes: number;
    }
  | { ok: false; error: MirrorValidationError };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** UTF-8 byte 長。TextEncoder が使えない環境では文字数へ fallback する（never-throw）。 */
function byteLength(value: string): number {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

export function validateMirrorRequest(body: unknown): MirrorValidationResult {
  if (!isPlainObject(body)) return { ok: false, error: 'invalid_body' };

  // 1. kind — 固定 allowlist。table 名は受け取らない。
  const kind = body.kind;
  if (!isMirrorKind(kind)) return { ok: false, error: 'invalid_kind' };

  // 2. schemaVersion — allowlist。
  const schemaVersion = body.schemaVersion;
  if (
    typeof schemaVersion !== 'string' ||
    !MIRROR_ALLOWED_SCHEMA_VERSIONS.includes(schemaVersion)
  ) {
    return { ok: false, error: 'invalid_schema_version' };
  }

  // 3. sourceHash — 形式のみ検証（再計算しない。理由は本ファイル冒頭）。
  const sourceHash = body.sourceHash;
  if (
    typeof sourceHash !== 'string' ||
    !MIRROR_SOURCE_HASH_PATTERN.test(sourceHash)
  ) {
    return { ok: false, error: 'invalid_source_hash' };
  }

  // 4. payload — object のみ。配列 / スカラ / null は拒否（DB の CHECK と同方針）。
  const payload = body.payload;
  if (!isPlainObject(payload)) return { ok: false, error: 'invalid_payload' };

  // 5. size guard — kind 別上限。JSON 化できない payload もここで弾く。
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return { ok: false, error: 'invalid_payload' };
  }
  if (typeof serialized !== 'string') return { ok: false, error: 'invalid_payload' };

  const payloadBytes = byteLength(serialized);
  if (payloadBytes > MIRROR_PAYLOAD_MAX_BYTES[kind]) {
    return { ok: false, error: 'payload_too_large' };
  }

  // 6. unknown field は保存しない — 返すのは検証済みの 4 値だけ。
  //    body に余分な key（user_id / table 等）があっても以降へ伝播しない。
  return { ok: true, kind, sourceHash, schemaVersion, payload, payloadBytes };
}

/** 検証エラー → HTTP status。payload 本文はどの経路でも返さない。 */
export function mirrorValidationStatus(error: MirrorValidationError): number {
  return error === 'payload_too_large' ? 413 : 400;
}
