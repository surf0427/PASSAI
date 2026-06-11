// AI route が返す error code を、ユーザー向けの日本語文言にマッピングする。
//
// 目的:
//   /api/analysis・/api/summarize・/api/analysis/additional は失敗時に
//   `{ error: <code>, detail: <英語の実装メッセージ> }` を返す。従来フロントは
//   `data.detail` をそのまま画面表示しており、"AI response could not be parsed as JSON"
//   のような実装詳細・英文がユーザーに露出していた。
//
//   本 helper は `data.error`（code）だけを受け取り、日本語のユーザー向け文言に変換する。
//   `data.detail`（英語）は一切表示に使わない。未知 code は汎用文言にフォールバックするため、
//   500 系の英語 detail（'AI analysis failed' 等）も画面に出ない。
//
// 注意:
//   - ここは「ユーザー向け文言」専用。サーバ側のログ / Sentry には従来どおり code を使う。
//   - 402（quota）は呼び出し側のダイアログ経路で吸収済みのため本 helper は扱わない。
export function aiErrorMessage(code: unknown): string {
  switch (code) {
    case 'AI_ANALYSIS_PARSE_FAILED':
    case 'AI_SUMMARY_PARSE_FAILED':
    case 'AI_ADDITIONAL_QUESTIONS_PARSE_FAILED':
      return 'AIの出力形式が一時的に乱れました。もう一度お試しください。';
    case 'AI_ANALYSIS_TRUNCATED':
    case 'AI_SUMMARY_TRUNCATED':
    case 'AI_ADDITIONAL_QUESTIONS_TRUNCATED':
      return 'AIの出力が長くなりすぎました。入力内容を少し短くして再度お試しください。';
    default:
      return '処理中にエラーが発生しました。時間をおいて再度お試しください。';
  }
}
