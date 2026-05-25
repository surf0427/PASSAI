# /statement 系 現在仕様

> **役割**: 今の仕様だけを記述する。STEP 履歴は [statement_steps.md](./statement_steps.md)、score 思想は [statement_score_system.md](./statement_score_system.md) へ分離。

## ページ構成

責務分離: analysis = 理解 / rewrite = 整理 / edit = 執筆

- `/statement` — エントリ画面（使い方ガイド + 「下書きを添削する」/「書く内容を整理する」の選択）
- `/statement/edit` — **執筆**画面。本文 textarea + AI 添削。左カラムに整理素材（prepare summary / 履歴 / 追記）と、`?rewriteFrom=<id>` 時の breadcrumb（analysis link + 方針メモ link）
- `/statement/prepare` — 整理フロー（執筆素材生成）
- `/statement/score` — 完成度スコア表示（保存済み正規化スコアを表示、view 専用）
- `/statement/compare` — 合格ライン比較（同上）
- `/statement/improve` — 過去添削一覧 hub（クリックで `/statement/analysis/[id]` へ遷移）
- `/statement/analysis/[id]` — **理解**ページ。actions / weaknesses / strengths + 詳細分析 3 種（NGワード・構造・評価軸）を集約。master = `statementReviewHistory.result`
- `/statement/improve/rewrite/[id]` — **整理**ページ。元本文（details）+ 書き直し方針メモ（rewriteMemo、reviewId 単位の autosave）+ 書き直しの参考例（details）+ ②へ書き直す CTA

旧 `/statement/improve/[slug]`（軸別ガイド書き直し）は撤去済み（STEP-ORPHAN-2 / STEP-MEMO-1〜2）。

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
