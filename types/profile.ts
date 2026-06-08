// STEP-AUTH-02: profiles table types.
//
// 内部の auth user.id（= auth.users.id = auth.uid()）と、ユーザー表示用 ID
// （display_user_id）を 1:1 で対応付けるテーブル。
//
// 設計原則:
//   - 所有者判定 / RLS / 保存キーは常に Profile.id（auth user id）を使う。
//   - display_user_id は表示専用。所有者判定や FK には絶対に使わない。
//   - display_user_id は null 許容（任意設定）。

export type Profile = {
  /** auth.users(id). 所有者判定の正本。 */
  id: string;
  /** ユーザー表示用 ID。null = 未設定。所有者判定には使わない。 */
  displayUserId: string | null;
  /** 課金プラン。Phase1 では 'free' のみ。Stripe 連携は別 STEP。 */
  plan: string;
  /** QA バイパスフラグ。true なら quota / 課金ゲートを素通しする（service_role のみ更新可）。 */
  isQaUser: boolean;
  /** ISO8601 文字列。 */
  createdAt: string;
  /** ISO8601 文字列。 */
  updatedAt: string;
};

export const DEFAULT_PLAN = 'free';
