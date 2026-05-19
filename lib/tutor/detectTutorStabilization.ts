// PASSAI 受験チューターAI 用 stabilization 判定ヘルパー（実装 STEP6）。
//
// 役割:
//   - message からメルトダウン signal を rule-based で検出する
//   - 検出時は client / route 側で intent を 'stabilize' に上書きする想定
//
// detectTutorIntent との関係:
//   - detectTutorIntent も stabilize を判定するが、本ヘルパーは「少し広い」keyword で再判定する
//   - 目的: 「分析モードに入らないようにする」二重防御
//   - 例: currentFeature='statement' で intent が 'statement' になっても、
//         本ヘルパーが true を返すなら client 側で intent='stabilize' に上書きする
//
// 設計方針:
//   - false positive を許容（強い不安語が含まれていればとりあえず stabilize に倒す）
//   - false negative を最小化（メルトダウン signal を見逃さない）
//   - '不安' のような頻出語は含めない（毎ターン stabilize になり analysis が動かなくなる）
//
// 純粋関数: fetch / localStorage / Supabase / Date / Math.random / console 一切なし。
//
// 関連: [./detectTutorIntent.ts](./detectTutorIntent.ts)

// detectTutorIntent と重複する keyword + 安定化専用の broader keyword を含む superset。
// SYSTEM PROMPT [F] のメルトダウン signal と意図的に語彙を揃えてある。
const STABILIZATION_KEYWORDS: readonly string[] = [
  // detectTutorIntent と共通
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
  // 本ヘルパー専用（broader）
  '無理かも',
  '諦めたい',
  '諦めようかな',
  '諦めよう',
  'もういい',
  'やめたい',
  '自分だけ',
  'みんなより',
  '比べたら',
  '遅れてる',
  'ついていけない',
  '限界',
  '泣きたい',
  'パンク',
  'いっぱいいっぱい',
];

export function detectTutorStabilization(message: string): boolean {
  const lower = message.toLowerCase();
  return STABILIZATION_KEYWORDS.some((kw) => lower.includes(kw));
}
