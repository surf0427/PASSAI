// STEP-AUTH-02: display_user_id バリデーション（pure 関数）。
//
// ルール:
//   - 3〜20 文字
//   - 半角英小文字、数字、アンダースコアのみ
//   - 先頭と末尾は英数字（_ 始まり / _ 終わりは NG）
//   - 予約語禁止
//
// このモジュールは Supabase / DOM / React に依存しない。
// 同じ ruleset を将来サーバー側（route handler / SQL CHECK 等）でも
// 再現できるよう、文字列のみを入力に取り、structured な結果を返す。

export const DISPLAY_USER_ID_MIN_LENGTH = 3;
export const DISPLAY_USER_ID_MAX_LENGTH = 20;

export const DISPLAY_USER_ID_RESERVED: readonly string[] = [
  'admin',
  'root',
  'passai',
  'support',
  'official',
  'null',
  'undefined',
  'me',
  'api',
];

// 全体パターン:
//   - ^[a-z0-9]               先頭は英数字
//   - [a-z0-9_]{1,18}         中段は英数字または _
//   - [a-z0-9]$               末尾は英数字
//   - 長さは 3〜20 で別途チェック（regex 内 quantifier だけだと
//     先頭・末尾の 1 文字を足して合計 3〜20 の意図を読みづらい）。
const SHAPE_REGEX = /^[a-z0-9][a-z0-9_]*[a-z0-9]$/;

export type DisplayUserIdValidation =
  | { ok: true }
  | { ok: false; error: string };

export function validateDisplayUserId(
  value: string,
): DisplayUserIdValidation {
  if (typeof value !== 'string') {
    return { ok: false, error: '文字列を入力してください。' };
  }

  if (value.length < DISPLAY_USER_ID_MIN_LENGTH) {
    return {
      ok: false,
      error: `${DISPLAY_USER_ID_MIN_LENGTH}文字以上で入力してください。`,
    };
  }

  if (value.length > DISPLAY_USER_ID_MAX_LENGTH) {
    return {
      ok: false,
      error: `${DISPLAY_USER_ID_MAX_LENGTH}文字以内で入力してください。`,
    };
  }

  if (!SHAPE_REGEX.test(value)) {
    return {
      ok: false,
      error:
        '半角英小文字・数字・アンダースコアのみ使えます。先頭と末尾は英数字にしてください。',
    };
  }

  if (DISPLAY_USER_ID_RESERVED.includes(value)) {
    return { ok: false, error: 'この ID は使用できません。' };
  }

  return { ok: true };
}
