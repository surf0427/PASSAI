/**
 * Shared mirror source-hash derivation.
 *
 * Extracted at N=3 (when `mirrorDiagnosis` joined `mirrorBasicInfo` as a
 * second mirror that derives its own `source_hash` at write time, rather
 * than receiving it from the canonical artifact like `mirrorStudentProfile`).
 *
 * Two mirrors using byte-identical hex-encoding logic was the trigger for
 * extraction; centralising prevents accidental drift in the digest format
 * (lowercase / no separators / fixed length) that would invalidate
 * `source_hash` UNIQUE constraints across `<feature>_mirrors` tables.
 *
 * Phase1 contract:
 *   - Runs in the browser only (mirror callers short-circuit when
 *     `typeof window === "undefined"`). `crypto.subtle.digest` is the
 *     API used.
 *   - No fallback hash. If `crypto.subtle.digest` rejects, the caller's
 *     outer try/catch in the mirror helper converts to
 *     `mirrorFailed("unknown", err.name)`.
 *   - No salt, no normalisation of input. The input string IS the contract.
 *     Callers control what they feed in (e.g.
 *     `JSON.stringify(payloadWithoutName) + SCHEMA_VERSION`); the helper
 *     does not stringify, sort keys, or rewrite anything.
 *   - No Supabase imports, no feature knowledge, no `process.env`.
 *
 * Output format: lowercase hex, no separators, length 64 (SHA-256 digest).
 * Stable across browsers under the WebCrypto contract.
 */

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}
