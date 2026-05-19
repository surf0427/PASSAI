// PASSAI 受験チューターAI の AI 応答パーサー（実装 STEP9）。
//
// 役割:
//   - AI 応答末尾の「→ 〜してみるのもアリです」のような 1 行を検出し、
//     PASSAI 内機能への接続ボタン化に必要な情報（feature / href / label）を返す
//   - 残りの本文（bodyText）は通常の bubble 表示に使う
//
// 安全設計:
//   - 解析対象は **最終行 1 行のみ**（複数 suggestion は出さない）
//   - href は **固定 whitelist** からのみ生成（AI 生成 URL は使わない、hallucination 対策）
//   - rawLine に URL が含まれていても無視（whitelist の href が常に勝つ）
//   - AI が想定外フォーマットを返しても全文を bodyText として fallback 表示（graceful degradation）
//   - 純粋関数: fetch / localStorage / Supabase / Date / Math.random / console 一切なし
//
// 関連:
//   - [lib/tutor/types.ts](./types.ts)（TutorFeature）
//   - [app/tutor/components/TutorBubble.tsx](../../app/tutor/components/TutorBubble.tsx)（消費側）

import type { TutorFeature } from './types';

export type TutorReplySuggestion = {
  feature: TutorFeature;
  href: string;
  label: string;
  rawLine: string;
};

export type ParsedTutorReply = {
  bodyText: string;
  suggestion: TutorReplySuggestion | null;
};

// 固定 whitelist。AI 生成 URL は絶対に使わない（hallucination 対策）。
// 4 機能のみ（admission-matching / 小論文 / その他は意図的に含めない）。
// SYSTEM PROMPT [I] / detectTutorSuggestedFeature と整合。
const FEATURE_LINKS = {
  self_analysis: '/self-analysis',
  statement: '/statement/prepare',
  interview: '/interview',
  selfpr: '/self-pr',
} as const satisfies Record<TutorFeature, string>;

// 優先順位: 自己分析 → 志望理由書 → 面接 → 自己PR（SYSTEM PROMPT [I] の宣言順と一致）。
// 同一行に複数 keyword が含まれる場合、上から最初に一致したものが採用される。
// keyword は小文字で保持し、case-insensitive 比較する（'自己PR' / '自己pr' 両対応）。
const FEATURE_KEYWORDS: ReadonlyArray<{
  feature: TutorFeature;
  keywords: readonly string[];
}> = [
  { feature: 'self_analysis', keywords: ['自己分析', '壁打ち'] },
  { feature: 'statement', keywords: ['志望理由書', '志望理由'] },
  { feature: 'interview', keywords: ['面接'] },
  { feature: 'selfpr', keywords: ['自己pr', 'pr文'] },
];

// 最終行が「→」で始まるかの判定。直後の空白は許容（半角・全角）。
const ARROW_PREFIX_PATTERN = /^→\s*/;

export function parseTutorReply(reply: string): ParsedTutorReply {
  // 型不一致・空入力 → 空で安全に返す（呼び出し側で crash しない）
  if (typeof reply !== 'string' || reply === '') {
    return { bodyText: '', suggestion: null };
  }

  // 末尾の余分な改行・空白を整理（先頭は保持）
  const normalized = reply.replace(/\s+$/, '');
  if (normalized === '') {
    return { bodyText: '', suggestion: null };
  }

  const lines = normalized.split('\n');
  const lastLine = lines[lines.length - 1].trim();

  // 最終行が「→」で始まらない → 通常本文として全文を返す
  if (!ARROW_PREFIX_PATTERN.test(lastLine)) {
    return { bodyText: normalized, suggestion: null };
  }

  // feature keyword 検出（case-insensitive、優先順位の先勝ち）
  const lastLineLower = lastLine.toLowerCase();
  let matchedFeature: TutorFeature | null = null;
  for (const { feature, keywords } of FEATURE_KEYWORDS) {
    if (keywords.some((kw) => lastLineLower.includes(kw))) {
      matchedFeature = feature;
      break;
    }
  }

  // 「→」始まりだが feature keyword 無し → 通常本文扱い
  if (matchedFeature === null) {
    return { bodyText: normalized, suggestion: null };
  }

  // 最終行を切り離して bodyText を作る
  const bodyText = lines.slice(0, -1).join('\n').replace(/\s+$/, '');
  const label = lastLine.replace(ARROW_PREFIX_PATTERN, '');

  return {
    bodyText,
    suggestion: {
      feature: matchedFeature,
      href: FEATURE_LINKS[matchedFeature],
      label,
      rawLine: lastLine,
    },
  };
}
