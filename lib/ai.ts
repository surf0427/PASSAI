import Anthropic from '@anthropic-ai/sdk';

// Anthropic クライアントのシングルトン。
// モデル名・タイムアウト・API キー名を変えるときはここだけ直す。
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// AIの返答から ```json ... ``` ブロックを取り出す。
// JSON ブロックがなければテキスト全体をそのまま返す。
export function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}
