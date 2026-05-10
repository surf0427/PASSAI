import Anthropic from '@anthropic-ai/sdk';

// Anthropic クライアントのシングルトン。
// モデル名・タイムアウト・API キー名を変えるときはここだけ直す。
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// AIの返答からJSON部分を抽出する。
// 優先順位: 1) ```json ブロック → 2) ``` ブロック → 3) { または [ から始まる部分
export function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  const jsonStart = text.search(/[{[]/);
  if (jsonStart !== -1) return text.slice(jsonStart).trim();

  return text.trim();
}
