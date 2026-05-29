// PASSAI 受験チューターAI 用 intent 判定ヘルパー（実装 STEP6）。
//
// 役割:
//   - message + currentFeature から TutorIntent を rule-based で推定する
//   - AI 呼び出しせずに client / route 両方で deterministic に判定できるようにする
//
// なぜ rule-based か:
//   - Token 節約: intent 判定で AI を呼ぶと 1 ターンに 2 回 AI 呼び出しになる
//   - Latency 削減: rule-based なら 1ms 以内
//   - Runtime drift 防止: モデル更新の影響を受けない
//   - Intent ブレ防止: 同じ message に対して常に同じ intent を返す
//
// 判定優先順位（高い順）:
//   1. stabilize  — 強い不安 / 自己否定 / メルトダウン系
//   2. advice     — 具体アドバイス要求系（STEP-MVP で追加）
//   3. statement  — 志望理由書系
//   4. interview  — 面接系
//   5. self_analysis — 自己分析・強み弱み系
//   6. selfpr     — 自己PR系
//   7. currentFeature fallback（指定があれば対応する intent）
//   8. general    — 最終 fallback
//
// advice の位置:
//   stabilize の次・既存 topic intent の前。理由:
//     - 「もう無理、どうすればいい」型では stabilize を優先したい（重相談優先）
//     - 「志望理由書を具体的にどう書けばいい」型では advice の踏み込み助言を優先したい
//       （単なる topic 分類より「答えを欲してる」シグナルが強い）
//   decision intent は将来 STEP（advice 検出に含まれる「どっち」「すべき」系はまず
//   advice として処理し、後続 STEP で必要なら独立化する）。
//
// 純粋関数: fetch / localStorage / Supabase / Date / Math.random / console 一切なし。
//
// 関連: [lib/tutor/types.ts](./types.ts)（TutorIntent）

import type { TutorIntent } from './types';

// ── keyword リスト ───────────────────────────────────────────────
//
// 文字列マッチは toLowerCase で case-insensitive に行う。
// ASCII 2 文字以下のキーワード（'es' 等）は英文混入で偶発的にマッチする可能性があるが、
// PASSAI ユーザーの message はほぼ日本語のため許容範囲。
// SYSTEM PROMPT 側で off-topic redirect が機能するため false positive の害は限定的。

const STABILIZE_KEYWORDS: readonly string[] = [
  'もう無理',
  '病む',
  '消えたい',
  '終わった',
  '受かる気がしない',
  '受かる気しない',
  '何もできない',
  'メンタル',
  'しんどい',
  'きつい',
  // STEP-MVP-G 追加: SYSTEM PROMPT [V-8] 重相談シグナルと runtime 検出の整合性確保。
  // STEP-MVP-F で「しんどすぎる、何から始めればいい」が advice 誤発動した
  // defense-in-depth gap を閉塞する。
  'しんどすぎる',
  '限界',
  // 「不合格」単体ではなく「不合格で」phrase 化。理由:
  //   bare の「不合格」は「不合格体験記を読みたい」等の中立文脈を substring で誤検出する。
  //   「不合格で」(例: 不合格で病みそう / 不合格でショック) は distress 文脈を限定捕捉する。
  '不合格で',
  '泣きそう',
  '泣く',
];

// advice: 具体アドバイス要求のシグナル。
// 重相談ではなく「答えを欲してる」明示要求 turn を捕捉する。
// stabilize より下、既存 topic 系より上で判定（STEP-MVP-C 追加）。
const ADVICE_KEYWORDS: readonly string[] = [
  'どうすれば',
  'どうしたら',
  '何から',
  '何をすれば',
  '具体的に',
  '踏み込んで',
  'で、結局',
  '結局どう',
  '私のケース',
  '自分の場合',
];

const STATEMENT_KEYWORDS: readonly string[] = [
  '志望理由書',
  '志望理由',
  'es', // 'ES' / 'Es' / 'es' に case-insensitive で一致
  'エントリーシート',
  '書けない',
  '添削',
];

const INTERVIEW_KEYWORDS: readonly string[] = [
  '面接',
  '深掘り',
  '質問',
  '緊張',
];

const SELF_ANALYSIS_KEYWORDS: readonly string[] = [
  '自己分析',
  '強み',
  '弱み',
  'やりたいこと',
  '将来',
  '自分がわからない',
  '自分が分からない',
];

const SELFPR_KEYWORDS: readonly string[] = [
  '自己pr', // '自己PR' / '自己Pr' / '自己pr' に一致
  'pr文', // 'PR文' / 'pr文' に一致
];

// ── helper ───────────────────────────────────────────────────────

function matchesAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function currentFeatureToIntent(feature: string | null | undefined): TutorIntent {
  switch (feature) {
    case 'statement':
      return 'statement';
    case 'interview':
      return 'interview';
    case 'self_analysis':
      return 'self_analysis';
    case 'selfpr':
      return 'selfpr';
    default:
      return 'general';
  }
}

// ── main ─────────────────────────────────────────────────────────

export function detectTutorIntent(input: {
  message: string;
  currentFeature?: string | null;
}): TutorIntent {
  const message = input.message;

  // stabilize が最優先（メルトダウン signal は currentFeature を上書きする）
  if (matchesAny(message, STABILIZE_KEYWORDS)) return 'stabilize';

  // advice（具体アドバイス要求）— 既存 topic intent より優先（STEP-MVP-C 追加）
  if (matchesAny(message, ADVICE_KEYWORDS)) return 'advice';

  // 機能 keyword（user 指定の優先順位通り）
  if (matchesAny(message, STATEMENT_KEYWORDS)) return 'statement';
  if (matchesAny(message, INTERVIEW_KEYWORDS)) return 'interview';
  if (matchesAny(message, SELF_ANALYSIS_KEYWORDS)) return 'self_analysis';
  if (matchesAny(message, SELFPR_KEYWORDS)) return 'selfpr';

  // currentFeature fallback（page context があれば寄せる）
  return currentFeatureToIntent(input.currentFeature);
}
