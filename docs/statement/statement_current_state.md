# /statement 系 現在仕様

> **役割**: 今の仕様だけを記述する。STEP 履歴は [statement_steps.md](./statement_steps.md)、score 思想は [statement_score_system.md](./statement_score_system.md) へ分離。

## ページ構成

- `/statement` — エントリ画面（使い方ガイド + 「下書きを添削する」/「書く内容を整理する」の選択）
- `/statement/edit` — 下書き添削画面（整理メモ・追加メモ表示、表示 ON/OFF 切替、2 カラム UI、追加メモ削除、AI 添削、履歴）
- `/statement/prepare` — 整理フロー
- `/statement/score` — 完成度スコア表示（保存済み正規化スコアを表示）
- `/statement/compare` — 合格ライン比較（同上）
- `/statement/improve` — 改善トップ（同上）
- `/statement/improve/[slug]` — 改善詳細

## 整理フロー

入力：
- なぜその分野・学部に興味を持ったか
- 印象に残った経験
- 将来やりたいこと

↓ Claude API で整理メモ生成 ↓

整理メモ構造：
- `impressiveExperience`
- `feltIssue`
- `interestInField`
- `universityLearning`
- `futureApplication`

整理結果に付随する評価：
- `weakPoints`（浅さ検知）
- `logicGaps`（論理抜け検知）
- `qualityEvaluation`（◎ ○ △）
- `followUpQuestions`（固定深掘り質問）
- `followUpAnswers`（深掘り回答、localStorage 保存）

`followUpAnswers` を使った再整理が可能。

## 学部系統（FacultyCategory）

`business` / `international` / `education` / `law` / `economics` / `sociology` / `psychology` / `engineering` / `health` / `other`

学部系統別チェックポイント・下書き構成ガイドあり。

## 接続

自己分析・活動整理との接続：
- 候補カード表示
- 「この内容を参考にする」で入力欄へ追記

## storage / UI / score 構造 / rate limit

- localStorage キー一覧 → [shared/localstorage_keys.md](../shared/localstorage_keys.md)（TBD）
- 共通 UI コンポーネント → [shared/ui_components.md](../shared/ui_components.md)（TBD）
- score 構造 → [statement_score_system.md](./statement_score_system.md)
- rate limit 仕様 → TBD（コードから抽出して追記する）
