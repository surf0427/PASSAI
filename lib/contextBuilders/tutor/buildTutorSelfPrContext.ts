// 受験チューターAI 用 自己PR (selfPRDraft) context を作る純粋関数。
//
// 含める:
//   - selfPRDraft 冒頭（MAX_SELF_PR_EXCERPT_LENGTH 字、省略記号なし）
// 含めない:
//   - selfPRs 一覧（過去 PR）
//   - reason 出力（AI 生成済み）
//
// selfPRDraft は localStorage 上 raw string で保存される（[lib/selfPRDraftStorage.ts](../../selfPRDraftStorage.ts) 参照）。
// 既存 storage helper を直接読まず、route 側 body 経由で文字列を受け取る。
//
// 入力欠損・型不一致時は throw せず空文字を返す。

import { MAX_SELF_PR_EXCERPT_LENGTH } from './types';

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

export function buildTutorSelfPrContext(selfPRDraft: unknown): string {
  if (typeof selfPRDraft !== 'string') return '';
  const trimmed = selfPRDraft.trim();
  if (trimmed === '') return '';
  return [
    '【自己PRの下書き】',
    `冒頭: ${truncate(trimmed, MAX_SELF_PR_EXCERPT_LENGTH)}`,
  ].join('\n');
}
