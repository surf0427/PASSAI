# /statement score システム設計

> **役割**: score の思想・データ構造・正本統一方針を独立管理する。

## 正本統一の方針（STEP 33 で実装）

ページごとに score がズレる問題を解消するため、score の **計算・正規化・読み出しを 1 箇所に集約** した。

- 計算・正規化：[`lib/statementScore.ts`](../../lib/statementScore.ts)
  - `normalizeStatementScore()` が breakdown 5 項目（各 0〜20）をクランプして合計を total（0〜100）に。AI の `totalScore` は無視。
  - `statementResultToScore()` が旧形式（label ベース evaluations）→ breakdown 形式へ変換。内部で `normalizeStatementScore` を呼ぶ。
- ランク判定：[`lib/scoreRank.ts`](../../lib/scoreRank.ts)
  - `getRank()` が S/A/B/C/D を返す唯一の関数。
- 合格ライン比較：[`lib/passLineComparison.ts`](../../lib/passLineComparison.ts) — `getPassLineComparison()` が唯一の比較ロジック。
- 改善提案：[`lib/improvementSuggestions.ts`](../../lib/improvementSuggestions.ts) — `getPassLineComparison` を内部で呼ぶ。
- **読み出しの単一口**：[`lib/statementScoreSource.ts`](../../lib/statementScoreSource.ts)（STEP 33 で新設）
  - `getLatestStatementScore()` — `statementReviewHistory` localStorage の最新エントリを `statementResultToScore` で正規化して返す。履歴ゼロなら null。
  - `breakdownToPassLineItems()` / `breakdownToRankItems()` — breakdown を各 helper の入力形式へ変換するアダプタ。

## breakdown 構造

```ts
type StatementScoreBreakdown = {
  logic: number;         // 論理構造
  specificity: number;   // 具体性
  universityFit: number; // 大学との一致
  futureGoal: number;    // 将来目標
  originality: number;   // 独自性
};
```

各項目 0〜20 点。total は 5 項目の合計（0〜100 点）。

## normalize 思想

- AI の `totalScore` は信用しない。**total は必ず breakdown 5 項目の合計から導出**する。
- 各項目は `clampItem()` で `Math.max(0, Math.min(20, Math.round(value)))` に丸める。`NaN` や非 number は 0。
- 保存前 normalize：API レスポンスを保存する前に必ず `normalizeStatementScore()` を通す。実装は [`app/statement/edit/page.tsx`](../../app/statement/edit/page.tsx) の `mapApiResponse()`。

## total 算出

`total = logic + specificity + universityFit + futureGoal + originality`（範囲 0〜100）。

## rank 基準

[`lib/scoreRank.ts`](../../lib/scoreRank.ts) の `RANK_DEFINITIONS`：

| Rank | min | max | label |
|---|---|---|---|
| S | 90 | 100 | 合格圏 上位 |
| A | 75 | 89 | 合格圏 |
| B | 60 | 74 | あと一歩 |
| C | 40 | 59 | 改善が必要 |
| D | 0 | 39 | 土台から再構築 |

合格ライン：`PASS_LINE_RANK = 'A'`、`PASS_LINE_SCORE = 75`。

## localStorage 保存フロー

1. `/statement/edit` で AI 添削を実行
2. レスポンスを `mapApiResponse()` 内で `normalizeStatementScore()` を通す
3. `StatementResult`（label ベース evaluations + overallScore）として `saveReviewHistory()` で `statementReviewHistory` に保存（最大 10 件）
4. 各表示ページは `getLatestStatementScore()` で先頭エントリを読み、`statementResultToScore()` で breakdown へ変換して表示

> **note**: 現状は label ベース保存 → 読み出し時に breakdown へ変換、というフロー。将来 Supabase 移行時に breakdown 直接保存に変えると変換ステップが消える（互換性のため当面 label ベースで保持）。

## 表示フロー（ページごとの責務）

| ページ | 役割 | helper 呼び出し |
|---|---|---|
| `/statement/edit` | 添削実行 + 保存 | `normalizeStatementScore`（保存前） |
| `/statement/score` | 完成度の可視化 | `getLatestStatementScore` → `breakdownToRankItems` → `getImprovementPriority` |
| `/statement/compare` | 合格ライン目安との差分 | `getLatestStatementScore` → `breakdownToPassLineItems` → `getPassLineComparison` |
| `/statement/improve` | 改善優先度の提示 | `getLatestStatementScore` → `breakdownToPassLineItems` → `getImprovementSuggestions` |

**各ページは保存済み正規化スコアを表示するだけ**。再計算しない。ハードコード評価値は STEP 33 で全撤去。

## 履歴がない場合の扱い

`getLatestStatementScore()` が `null` を返したら、各ページは「添削履歴がまだありません」誘導カードを表示し、`/statement/edit` への動線だけ残す。スコア表示用セクションは描画しない。

## 関連メモ

- AI ポリシー（代筆禁止）：[../principles/ai_policy.md](../principles/ai_policy.md)
- アーキテクチャルール：[../principles/architecture_rules.md](../principles/architecture_rules.md)
- AI 数値スコア contract の予防ルール（totalScore / 合計一致 / PROMPT_VERSION bump 条件）：[../principles/ai_score_contract.md](../principles/ai_score_contract.md)
- 現在仕様：[statement_current_state.md](./statement_current_state.md)
- STEP 履歴：[statement_steps.md](./statement_steps.md)
