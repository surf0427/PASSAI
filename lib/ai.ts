import Anthropic from '@anthropic-ai/sdk';

// Anthropic クライアントのシングルトン。
// モデル名・タイムアウト・API キー名を変えるときはここだけ直す。
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// AIの返答からJSON部分を抽出する。
// 優先順位: 1) ```json ブロック → 2) ``` ブロック → 3) { または [ から始まる部分
//
// 3) の経路は bracket-balanced 走査で完成済み JSON の末尾を検出し、その後ろに
// 付いた余計な文章（`{...}\n\n以上です。` 等）を除去する。文字列リテラル内の
// `{`/`}`/`[`/`]` と `\"` エスケープを考慮する。
// 不完全 JSON（truncation 等で閉じ括弧が足りない場合）は救済せず、既存の
// `text.slice(jsonStart).trim()` 経路に落として JSON.parse 失敗へ流す。
export function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  const jsonStart = text.search(/[{[]/);
  if (jsonStart === -1) return text.trim();

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = jsonStart; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(jsonStart, i + 1).trim();
      }
    }
  }

  return text.slice(jsonStart).trim();
}
