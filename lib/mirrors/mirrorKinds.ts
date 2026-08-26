// anonymous mirror の kind allowlist と上限値（純データ・client / server 共有）。
//
// 役割:
//   「どの mirror kind が存在し、どの table へ書くか」を **1 箇所で固定**する。
//   table 名は client 入力から一切受け取らない。client が送れるのは kind だけで、
//   kind → table の解決は本 module の固定 map が単独で行う。
//
// 厳守:
//   - 純データのみ。I/O / env / secret / Supabase 依存を持たない。
//   - client bundle に入る前提で書く（secret を置かない）。
//   - table 名を export するのは server 側 writer だけが使う目的。client は kind しか使わない。
//
// 関連:
//   app/api/mirrors/route.ts          … 唯一の consumer（server）
//   lib/mirrors/validateMirrorRequest.ts … 検証（純関数）
//   lib/mirrors/mirrorWriteServer.ts  … server-only writer
//   supabase/schema.sql               … table 定義（source_hash UNIQUE）

/** 受け付ける mirror kind。ここに無い値はすべて拒否する。 */
export type MirrorKind =
  | 'studentProfile'
  | 'basicInfo'
  | 'activity'
  | 'diagnosis';

/** 反復・runtime 判定用の正本リスト。 */
export const MIRROR_KINDS = [
  'studentProfile',
  'basicInfo',
  'activity',
  'diagnosis',
] as const satisfies readonly MirrorKind[];

/**
 * kind → table 名の固定 map。
 *
 * ★ client 入力を table 名として使わないための唯一の解決経路。
 *   新しい kind を足すときは schema.sql の table と対で追加する。
 */
export const MIRROR_KIND_TABLE: Readonly<Record<MirrorKind, string>> = {
  studentProfile: 'student_profile_mirrors',
  basicInfo: 'basic_info_mirrors',
  activity: 'activity_mirrors',
  diagnosis: 'diagnosis_mirrors',
};

/**
 * kind 別の payload 上限（JSON 文字列の byte 数）。
 *
 * 値の根拠:
 *   - activity は 10 カテゴリ × 自由記述を持ちうるため最も大きい。
 *   - 他 3 種は構造化された小さな snapshot。
 *   実データの中身は参照せず、データモデル上の妥当な上限として設定している。
 *   超過は 413 で拒否し、DB へは書かない（abuse / 事故的な巨大 payload の遮断）。
 */
export const MIRROR_PAYLOAD_MAX_BYTES: Readonly<Record<MirrorKind, number>> = {
  studentProfile: 64 * 1024,
  basicInfo: 32 * 1024,
  activity: 256 * 1024,
  diagnosis: 32 * 1024,
};

/**
 * 受け付ける schema_version の allowlist。
 * schema.sql / 各 mirror helper の SCHEMA_VERSION と一致させる。
 * 版を上げるときはここに追加してから client を更新する（前方互換）。
 */
export const MIRROR_ALLOWED_SCHEMA_VERSIONS: readonly string[] = ['1'];

/** source_hash の形式。sha256 hex（64 桁）を基本とし、既存 hash 実装の桁差を吸収する幅を持たせる。 */
export const MIRROR_SOURCE_HASH_PATTERN = /^[0-9a-f]{8,128}$/;

/** 任意の値が MirrorKind かを判定する type guard。 */
export function isMirrorKind(value: unknown): value is MirrorKind {
  return (
    typeof value === 'string' &&
    (MIRROR_KINDS as readonly string[]).includes(value)
  );
}
