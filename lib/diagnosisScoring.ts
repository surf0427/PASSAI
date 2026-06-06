// 受験タイプ診断（/diagnosis）の質問データと判定ロジック。
//
// Phase 1: page.tsx から純モジュールへ切り出し（挙動はそのまま固定）。
// Phase 2: raw count → normalized scoring + 安定タイブレークへ判定を更新。
//   juken-shindan の「設計思想」（normalized / maxPossible / 安定タイブレーク）だけを
//   4 タイプ診断向けに移植。9 タイプ・15 問・キャラ要素は移植しない。
//
// 検証: scripts/diagnosis-scoring-qa.ts
//
// ── Phase 2 の重要な設計判断（type3 面積偏りの是正） ───────────────────
// paid-app は「1 選択肢 = 1 タイプに +1 点」モデル。juken のように 1 選択肢が
// 複数タイプへ異なる重みを配る形ではない。そのため juken の computeMaxPossible
// （問ごとに各タイプのベスト 1 選択肢分を合計 → {1:4,2:4,3:4}）をそのまま移植
// しても type3 偏りは消えない。paid-app の偏りは「点の重み」ではなく
// 「タイプごとの選択肢の数（面積）」にあるため。
//   例: 採点対象 Q1/Q2/Q3/Q5 で type3 は計 9 選択肢、type1/type2 は各 4 選択肢。
//       迷った回答ほど面積の広い type3 に当たりやすい＝構造的に type3 有利。
// そこで maxPossible[type] = そのタイプの選択肢総数（面積）と定義し、
//   normalized[type] = raw[type] / maxPossible[type]
// とする。面積の広いタイプは同じ raw でも normalized が小さくなり、過剰有利が
// 是正される。decisive（全問同タイプ）ケースは各タイプとも自分の normalized が
// 最大になるため、正しく自分のタイプが勝つ（QA で確認）。

import type { DiagnosisType } from '@/types/diagnosis';

export type DiagnosisOption = { label: string; type: DiagnosisType };
export type DiagnosisQuestion = { q: string; options: DiagnosisOption[] };

// raw / normalized / maxPossible の 3 点セット（内部表現）。
// Phase 2 時点では判定にのみ使い、localStorage / Supabase payload には保存しない
// （保存は Phase 3）。内部関数からは返せる形にしてある。
export type DiagnosisScoreVector = {
  raw: Record<DiagnosisType, number>;
  normalized: Record<DiagnosisType, number>;
  maxPossible: Record<DiagnosisType, number>;
};

// ── 質問データ（5 問固定。Phase 1 から不変） ───────────────────────────
export const DIAGNOSIS_QUESTIONS: DiagnosisQuestion[] = [
  {
    q: '総合型選抜・学校推薦型選抜に対して、今どんな状態ですか？',
    options: [
      { label: '何から始めればいいか分からない', type: 1 },
      { label: '活動や経験はあるが、まとめ方が分からない', type: 2 },
      { label: '志望理由書を書いたが浅いと言われた', type: 3 },
      { label: '面接や小論文まで不安がある', type: 3 },
    ],
  },
  {
    q: '自分の活動や経験についてどう感じていますか?',
    options: [
      { label: '特に目立つ活動はないと思う', type: 1 },
      { label: 'あるけど、どう強みにすればいいか分からない', type: 2 },
      { label: 'ある程度まとまっている', type: 3 },
      { label: 'かなり自信がある', type: 3 },
    ],
  },
  {
    q: '志望理由書についてどの状態ですか？',
    options: [
      { label: '何を書けばいいか分からない', type: 1 },
      { label: '書き始めたけどまとまらない', type: 2 },
      { label: '一応書いたが自信がない', type: 3 },
      { label: '添削しながら完成度を上げたい', type: 3 },
    ],
  },
  {
    q: '一般受験との並行についてどう考えていますか？',
    options: [
      { label: '一般受験がメインで、推薦は片手間で進めたい', type: 4 },
      { label: 'どちらも同じくらい頑張りたい', type: 4 },
      { label: '推薦をメインにしたい', type: 3 },
      { label: 'まだ決めきれていない', type: 1 },
    ],
  },
  {
    q: '今一番サポートしてほしいことは？',
    options: [
      { label: '活動整理', type: 1 },
      { label: '自己分析', type: 2 },
      { label: '志望理由書', type: 3 },
      { label: '小論文', type: 3 },
      { label: '面接対策', type: 3 },
    ],
  },
];

const DIAGNOSIS_TYPES: DiagnosisType[] = [1, 2, 3, 4];

// Q4（index 3）は「一般受験並行」の戦略軸であり、type4 ショートサーキット専用。
// normalized scoring の集計対象には含めない（Phase 1 までの「Q4 は集計対象外」を踏襲）。
const Q4_INDEX = 3;
const SCORING_QUESTION_INDICES = [0, 1, 2, 4] as const;

function zeroRecord(): Record<DiagnosisType, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0 };
}

// 各タイプの maxPossible（= 採点対象問における「そのタイプの選択肢総数 = 面積」）を
// 質問データから自動算出する。設計判断はファイル冒頭コメント参照。
export function computeMaxPossible(
  questions: DiagnosisQuestion[] = DIAGNOSIS_QUESTIONS,
): Record<DiagnosisType, number> {
  const max = zeroRecord();
  for (const qi of SCORING_QUESTION_INDICES) {
    for (const opt of questions[qi].options) {
      max[opt.type] += 1;
    }
  }
  return max;
}

// 回答からスコアベクトル（raw / normalized / maxPossible）を算出する。
// raw[type]  = 採点対象問で選んだ選択肢のうち、そのタイプの数。
// normalized = raw / maxPossible（面積）。maxPossible 0（= type4）は 0 除算を避け 0。
// 注: answers[qi] が範囲外 / 不在だと options[...] が undefined になり throw する
//     （Phase 1 までの不正入力挙動を維持。本番は 5 問完答後にのみ呼ばれる前提）。
export function computeDiagnosisScoreVector(
  answers: number[],
  questions: DiagnosisQuestion[] = DIAGNOSIS_QUESTIONS,
): DiagnosisScoreVector {
  const raw = zeroRecord();
  for (const qi of SCORING_QUESTION_INDICES) {
    const opt = questions[qi].options[answers[qi]];
    raw[opt.type] += 1;
  }

  const maxPossible = computeMaxPossible(questions);
  const normalized = zeroRecord();
  for (const t of DIAGNOSIS_TYPES) {
    normalized[t] = maxPossible[t] > 0 ? raw[t] / maxPossible[t] : 0;
  }

  return { raw, normalized, maxPossible };
}

// ── 安定タイブレーク ───────────────────────────────────────────────
// 「同点は小さい番号が勝つ」を廃止し、回答由来の安定ハッシュで決める。
// 乱数は使わない。同一 answers なら常に同一結果。

// 回答から決定論的なキーを作る（質問順に index:選択 を連結）。
function stableKey(answers: number[]): string {
  return answers.map((a, i) => `${i}:${a}`).join('|');
}

// FNV-1a 32bit ハッシュ。乱数を使わず、入力が同じなら常に同じ値。
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// normalized 降順で全タイプを並べる。完全同点は回答由来の安定ハッシュで決める
// （宣言順・番号順には依存しない）。
export function rankDiagnosisTypes(
  normalized: Record<DiagnosisType, number>,
  tiebreakKey: string,
): DiagnosisType[] {
  return [...DIAGNOSIS_TYPES].sort((a, b) => {
    if (normalized[b] !== normalized[a]) return normalized[b] - normalized[a];
    return fnv1a(`${tiebreakKey}#${b}`) - fnv1a(`${tiebreakKey}#${a}`);
  });
}

// ── 判定本体 ──────────────────────────────────────────────────────
// 仕様:
//   1) Q4（一般受験並行）の選択肢が type4 なら最優先で 4（paid-app の重要仕様。維持）。
//   2) それ以外は Q1/Q2/Q3/Q5 を normalized scoring で比較し、最大の type を返す。
//   3) 完全同点は安定ハッシュで決める（小さい番号固定ではない）。
export function calcDiagnosisResultType(answers: number[]): DiagnosisType {
  // Q4 ショートサーキット（answers[3] 不在なら throw。Phase 1 までと同一）。
  const q4 = DIAGNOSIS_QUESTIONS[Q4_INDEX].options[answers[Q4_INDEX]];
  if (q4.type === 4) return 4;

  const { normalized } = computeDiagnosisScoreVector(answers, DIAGNOSIS_QUESTIONS);
  const ranked = rankDiagnosisTypes(normalized, stableKey(answers));
  return ranked[0];
}
