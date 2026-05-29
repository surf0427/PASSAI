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
//   7. previousIntent 継承（STEP-TUTOR-CONTEXT-02 で追加 / 02b で閾値調整）
//      — 直前 intent が topic 系（statement/interview/self_analysis/selfpr）かつ
//        message が省略返答（「どっちも」「そう」「それ」等の完全一致 or 6 字以下）
//        の場合、直前 topic を継承して「面接相談の続き」として扱う
//   8. currentFeature fallback（指定があれば対応する intent）
//   9. general    — 最終 fallback
//
// advice の位置:
//   stabilize の次・既存 topic intent の前。理由:
//     - 「もう無理、どうすればいい」型では stabilize を優先したい（重相談優先）
//     - 「志望理由書を具体的にどう書けばいい」型では advice の踏み込み助言を優先したい
//       （単なる topic 分類より「答えを欲してる」シグナルが強い）
//   decision intent は将来 STEP（advice 検出に含まれる「どっち」「すべき」系はまず
//   advice として処理し、後続 STEP で必要なら独立化する）。
//
// previousIntent 継承の位置:
//   既存 topic keyword check の後・currentFeature fallback の前。理由:
//     - 「そう、志望理由書だけど」型は STATEMENT_KEYWORDS の明示マッチを優先したい
//       （ユーザーが明示的に話題転換した場合は previousIntent を上書きする）
//     - 「答えが出ない」「どっちも」型は省略返答とみなして直前 topic を継承する
//     - 「そういえば評定低い」のような新規情報を含む短文（>6 字）は継承せず
//       general 扱いとする（新規相談を阻害しない、STEP-TUTOR-CONTEXT-02b で 10 → 6 に
//       閾値を下げて誤継承を抑えた）
//   継承可能な previousIntent は topic 4 種（statement/interview/self_analysis/selfpr）に
//   限定する。general/stabilize/advice は継承しない:
//     - general 継承は no-op
//     - stabilize は state であり topic ではない
//     - advice は mode であり、省略返答で advice mode を再発動させると [V] block の
//       踏み込み構造が誤発動する
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

// 省略返答 keyword（STEP-TUTOR-CONTEXT-02 追加）。
// 完全一致（句読点除去後）で「直前 topic 継承」を発火させる。
// substring マッチではない（「そう」が「そういえば」に部分一致して新規相談を誤継承するのを防ぐ）。
const ELLIPTICAL_REPLY_KEYWORDS: readonly string[] = [
  'どっちも',
  'そう',
  'そうかも',
  'うん',
  'はい',
  'いや',
  '微妙',
  'たぶん',
  'かも',
  'それ',
  'これ',
  'あれ',
];

// 直前 intent を継承可能な topic 4 種。
// general/stabilize/advice は継承対象外（理由は冒頭コメント参照）。
const INHERITABLE_PREVIOUS_INTENTS: ReadonlySet<TutorIntent> = new Set<TutorIntent>([
  'statement',
  'interview',
  'self_analysis',
  'selfpr',
]);

// 省略返答かどうかの短文閾値（STEP-TUTOR-CONTEXT-02b で 10 → 6 に調整）。
//
// 意味:
//   この閾値は「省略返答を拾うための安全側の上限」であり、
//   新しい話題を含む短文まで継承しないために意図的に 6 字に絞っている。
//
// なぜ 6 字か（STEP-TUTOR-CONTEXT-02b の決定）:
//   ・「答えが出ない」(6 字) を継承させたい — 直前 topic の状態説明として典型
//   ・「どっちも」(4 字) / 「それ」「そう」(2 字) は ELLIPTICAL_REPLY_KEYWORDS の
//     完全一致でも拾えるが、短文閾値でも保険的に拾えるよう ≦ 4 は確実にカバーする
//   ・「そういえば評定低い」(9 字) のような新規話題を含む短文は継承させたくない
//   ・閾値 10 だと "評定低い" のような新規 topic 短文まで誤継承する
//   ・閾値 6 だと「答えが出ない」(6 字)・「分からない」(5 字)・「微妙です」(4 字) など
//     状態系の省略返答は継承され、「評定低い」(4 字単体)のような単独新規話題は
//     ELLIPTICAL exact match に無いため elliptical 判定にならず継承されない
//
// 上限を下げすぎないトレードオフ:
//   ・「うまくいかない」(7 字) は本閾値だと継承されなくなる（カバー外）
//   ・新規話題誤継承の害（topic 固定でアドバイスが噛み合わない）の方が大きいと判断し、
//     誤継承を減らす側に倒した
const ELLIPTICAL_SHORT_MAX_LENGTH = 6;

// ── helper ───────────────────────────────────────────────────────

function matchesAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

// 句読点・空白を取り除いた本文（省略返答の完全一致判定に使う）。
// 全角/半角の句読点・感嘆符・疑問符・中点・三点リーダ・括弧類を除去する。
function stripPunctuation(message: string): string {
  return message.replace(/[\s、。.,！？!?・…ー「」『』()（）]+/g, '');
}

// 省略返答とみなすか:
//   1. 句読点除去後の本文が ELLIPTICAL_REPLY_KEYWORDS と完全一致 → true
//   2. 句読点除去後の本文が ELLIPTICAL_SHORT_MAX_LENGTH (6 字) 以下 → true
//   3. それ以外 → false
// 完全一致を先に判定するのは「そう」のような 2 字キーワードが「そういえば〜」を
// 誤継承するのを避けるため（substring マッチは使わない）。
function isEllipticalFollowUp(message: string): boolean {
  const stripped = stripPunctuation(message);
  if (stripped === '') return false;
  if (ELLIPTICAL_REPLY_KEYWORDS.includes(stripped)) return true;
  return stripped.length <= ELLIPTICAL_SHORT_MAX_LENGTH;
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
  // STEP-TUTOR-CONTEXT-02 追加。直前 turn の intent。
  // - 省略返答 / 短文 turn でのみ参照する（明示的な topic keyword は上書きしない）
  // - 継承対象は topic 4 種に限定（INHERITABLE_PREVIOUS_INTENTS 参照）
  // - 既存呼び出し（page.tsx / scripts/tutor-dry-run.ts）は未指定で OK（後方互換）
  previousIntent?: TutorIntent;
}): TutorIntent {
  const message = input.message;

  // stabilize が最優先（メルトダウン signal は currentFeature / previousIntent を上書きする）
  if (matchesAny(message, STABILIZE_KEYWORDS)) return 'stabilize';

  // advice（具体アドバイス要求）— 既存 topic intent より優先（STEP-MVP-C 追加）
  if (matchesAny(message, ADVICE_KEYWORDS)) return 'advice';

  // 機能 keyword（user 指定の優先順位通り）
  // ★ previousIntent 継承より先に判定する。「そう、志望理由書だけど」のような明示的な
  //   話題転換は previousIntent を上書きする（新規相談を阻害しない）。
  if (matchesAny(message, STATEMENT_KEYWORDS)) return 'statement';
  if (matchesAny(message, INTERVIEW_KEYWORDS)) return 'interview';
  if (matchesAny(message, SELF_ANALYSIS_KEYWORDS)) return 'self_analysis';
  if (matchesAny(message, SELFPR_KEYWORDS)) return 'selfpr';

  // previousIntent 継承（STEP-TUTOR-CONTEXT-02 追加）
  // 上の topic keyword で何も拾えなかった = 新規 topic 情報なし。
  // 直前 intent が topic 系で、かつ message が省略返答 / 短文なら、直前 topic を引き継ぐ。
  const previousIntent = input.previousIntent;
  if (
    previousIntent !== undefined &&
    INHERITABLE_PREVIOUS_INTENTS.has(previousIntent) &&
    isEllipticalFollowUp(message)
  ) {
    return previousIntent;
  }

  // currentFeature fallback（page context があれば寄せる）
  return currentFeatureToIntent(input.currentFeature);
}
