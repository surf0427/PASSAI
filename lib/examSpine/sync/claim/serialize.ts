// PASSAI 受験版 Exam Spine — device revision claim の serializer（client 側 / 純関数）。
//
// device canonical から算出した token を header 値へ落とすだけの層。
// **fingerprint の算出はここではしない**（device view 側の責務）。
//
// ★ 送らないもの ★
//   本文（志望理由書 / 小論文 / 面接記録 / 自己分析）/ 氏名 / userId /
//   localStorage の生 JSON / 件数 / 時刻。
//   型として `ExamDeviceClaimEntry`（kind と token だけ）しか受け取らないので、
//   呼び出し側が誤って本文を渡す口が構造的に無い。
//
// 純関数。I/O / localStorage / fetch / Date / Math.random を持たない（isomorphic）。

import { isExamSourceKind } from '../../sourceData/types';
import {
  EXAM_DEVICE_CLAIM_MAX_BYTES,
  EXAM_DEVICE_CLAIM_MAX_ENTRIES,
  EXAM_DEVICE_CLAIM_TOKEN_PATTERN,
  EXAM_DEVICE_CLAIM_VERSION,
  type ExamDeviceClaimEntry,
  type ExamDeviceClaimEnvelope,
} from './types';

/** header 値に現れてはいけない文字（制御文字 / DEL）。header injection の最終 gate。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * claim entry の配列 → header 値。
 *
 * 送るものが無ければ `null` を返す。**呼び出し側は null のとき header 自体を付けない**
 * （空文字や "null" を送ると parser 側で malformed 扱いになり、正常な「申告なし」と
 * 区別できなくなる）。
 *
 * 落とす条件（いずれも黙って除外。client 側で例外を投げない）:
 *   - 未知の kind
 *   - token の書式違反
 *   - 重複 kind（先勝ち）
 *   - entry 数 / byte 数の上限超過
 */
export function serializeDeviceClaim(
  entries: readonly ExamDeviceClaimEntry[],
): string | null {
  const seen = new Set<string>();
  const valid: ExamDeviceClaimEntry[] = [];

  for (const entry of entries) {
    if (valid.length >= EXAM_DEVICE_CLAIM_MAX_ENTRIES) break;
    if (!isExamSourceKind(entry.kind)) continue;
    if (typeof entry.token !== 'string') continue;
    if (!EXAM_DEVICE_CLAIM_TOKEN_PATTERN.test(entry.token)) continue;
    if (seen.has(entry.kind)) continue;
    seen.add(entry.kind);
    // kind と token 以外を持ち込まない（呼び出し側が余計な field を付けても落ちる）。
    valid.push({ kind: entry.kind, token: entry.token });
  }

  if (valid.length === 0) return null;

  const envelope: ExamDeviceClaimEnvelope = { v: EXAM_DEVICE_CLAIM_VERSION, c: valid };
  const encoded = JSON.stringify(envelope);

  // ★ 上限超過は切り詰めない ★
  //   切り詰めると別の JSON になり、parse できたとしても意味の無い mismatch を生む。
  //   送らない（= unclaimed）方が安全側に倒れる。
  if (byteLength(encoded) > EXAM_DEVICE_CLAIM_MAX_BYTES) return null;

  // JSON.stringify は制御文字を escape するため通常は到達しないが、
  // header injection の最終 gate として明示的に確認する。
  if (CONTROL_CHARS.test(encoded)) return null;

  return encoded;
}

/** UTF-8 byte 長（TextEncoder 非依存 / hash.ts と同じ扱い）。 */
function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const cp = text.codePointAt(i) ?? 0;
    if (cp > 0xffff) i += 1;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * fetch の `headers` へ merge するための helper。
 *
 * ★ 既存 header を上書きしない ★
 *   Content-Type / Authorization / cookie 送信（credentials）に触らない。
 *   claim が無ければ **header を足さずに** 元の headers をそのまま返す。
 */
export function withDeviceClaimHeader(
  headers: Record<string, string>,
  headerName: string,
  value: string | null,
): Record<string, string> {
  if (!value) return headers;
  if (Object.prototype.hasOwnProperty.call(headers, headerName)) return headers;
  return { ...headers, [headerName]: value };
}
