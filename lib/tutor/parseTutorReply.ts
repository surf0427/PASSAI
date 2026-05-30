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
//
// v15 (STEP-TUTOR-FINAL-05) — FEATURE_KEYWORDS を 2-tier 構造へ:
//   ・STRONG tier: 明示的 PASSAI 機能名 (「面接練習」「志望理由書機能」「ガクチカ」等)。
//     複数 feature keyword が混在する arrow 行で単純先勝ちによる誤分類を防ぐため bare より優先。
//     優先順位は SYSTEM PROMPT [I] の発火優先順位
//     (interview > statement > selfpr > self_analysis) と一致。
//   ・BARE tier: bare 名詞 (「志望理由」「面接」等)。STRONG で no-match の場合のみ fallback。
//     後方互換のため statement → interview 順を保持。
//   外部 I/F (parseTutorReply, ParsedTutorReply, TutorReplySuggestion) と
//   戻り値 shape は完全不変。TutorFeature enum (4 機能) も不変。

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

// STEP-TUTOR-FINAL-05: 2-tier 優先構造。
//
// 旧仕様 (single-list 先勝ち) では「→ 面接練習で『志望理由』の深掘り...」のような
// arrow 行で、明示された feature (面接練習) より context 中の bare 名詞 (志望理由) が
// 配列順上位だったため statement へ誤分類される問題があった。
//
// 修正方針:
//   1. STRONG tier (明示的 PASSAI 機能名)
//      ・「面接練習 / 面接対策 / 面接機能」「志望理由書機能 / 志望理由書」
//        「自己PR / ガクチカ / PR文」「自己分析 / 壁打ち / 強み整理」
//      ・上から順に評価。複数 strong が match した場合の優先順位は
//        SYSTEM PROMPT [I] の発火優先順位 (interview > statement > selfpr > self_analysis) と一致
//   2. BARE tier (fallback、STRONG で何も match しなかった場合のみ評価)
//      ・「志望理由 / 志望動機」「面接」など bare 名詞
//      ・既存挙動の後方互換のため statement → interview の順を維持
//
// keyword は小文字で保持し、case-insensitive 比較する（'自己PR' / '自己pr' 両対応）。
const FEATURE_KEYWORDS_STRONG: ReadonlyArray<{
  feature: TutorFeature;
  keywords: readonly string[];
}> = [
  { feature: 'interview', keywords: ['面接練習', '面接対策', '面接機能'] },
  { feature: 'statement', keywords: ['志望理由書機能', '志望理由書'] },
  { feature: 'selfpr', keywords: ['自己pr', 'pr文', 'ガクチカ'] },
  { feature: 'self_analysis', keywords: ['自己分析', '壁打ち', '強み整理'] },
];

const FEATURE_KEYWORDS_BARE: ReadonlyArray<{
  feature: TutorFeature;
  keywords: readonly string[];
}> = [
  { feature: 'statement', keywords: ['志望理由', '志望動機'] },
  { feature: 'interview', keywords: ['面接'] },
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

  // feature keyword 検出 (case-insensitive、2-tier 優先構造):
  //   1) STRONG tier (明示的 PASSAI 機能名) を上から評価し最初に match した feature を採用
  //   2) STRONG で何も match しなければ BARE tier (bare 名詞) を fallback として評価
  // 詳細は FEATURE_KEYWORDS_STRONG / FEATURE_KEYWORDS_BARE の宣言コメント参照。
  const lastLineLower = lastLine.toLowerCase();
  let matchedFeature: TutorFeature | null = null;
  for (const { feature, keywords } of FEATURE_KEYWORDS_STRONG) {
    if (keywords.some((kw) => lastLineLower.includes(kw))) {
      matchedFeature = feature;
      break;
    }
  }
  if (matchedFeature === null) {
    for (const { feature, keywords } of FEATURE_KEYWORDS_BARE) {
      if (keywords.some((kw) => lastLineLower.includes(kw))) {
        matchedFeature = feature;
        break;
      }
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
