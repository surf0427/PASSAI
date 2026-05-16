# Incremental Refactor Policy

PASSAI の incremental refactor 運用 rulebook。
**Claude Code は refactor を検討する前に必ず本ドキュメントを参照すること。**

関連: [ai_assisted_development.md](./ai_assisted_development.md), [architecture_rules.md](./architecture_rules.md)

---

## 基本原則

- 大規模 rewrite は禁止
- 「整理のための整理」は禁止
- diff 局所性を最優先
- rollback 容易性を維持
- production の UI / API 出力仕様を壊さない
- feature 開発を止めない

**整理は feature 開発の副作用としてのみ進める**。例外は本ドキュメントに明示された future trigger のみ。

---

## 1. リファクタ対象格上げの 4 軸スコア

各ファイルを 4 軸で評価。**2 軸以上が Red なら独立 PR 候補、1 軸だけなら「ついで refactor」対象**。

| 軸 | Green（放置） | Yellow（次に触る時直す） | Red（独立 PR 候補） |
|---|---|---|---|
| **行数** | < 250 行 | 250〜400 行 | > 400 行 |
| **import graph 深さ** | ≤ 3 段 | 4 段 / type 循環あり | runtime 循環 / 5 段以上 |
| **Claude edit 頻度** | 月 0〜1 回 | 月 2〜4 回 | 月 5 回以上 |
| **drift risk**（同パターンの並列実装数） | 1〜2 箇所 | 3 箇所 | 4 箇所以上 |

計測は機械的に再現可能であること（`wc -l` / `grep -c`）。判定者の主観に依存させない。

### 現状判定（参考）

| 対象 | 判定 | 備考 |
|---|---|---|
| `scripts/step15-qa.ts` | **Red**（行数 / edit 頻度） | production 非経路のため優先度中 |
| `app/api/interview-feedback/route.ts` | **Red**（行数） | SYSTEM_PROMPT lift 候補 |
| StudentProfile fallback（4 route 並列） | **Red**（drift） | 5 route 目追加時に統合 |
| `buildXxxUniversityContext` 系（5 ファイル） | **Yellow**（drift） | 6 つ目追加時に統合 |
| `lib/prompts/*` type 循環 | **Yellow**（import graph） | runtime 影響なし。次 module 追加時に解消 |

---

## 2. feature 開発「ついで refactor」許可基準

機能追加 PR の diff 拡張を許可するのは以下のいずれかを満たす場合のみ。

### 許可される「ついで refactor」

1. **触ったファイル内で完結する局所整理**
   例: route.ts に新 helper を足すついでに、同 route 内の 50 行関数を private function に切り出す
2. **新規追加と同形のパターンが既にある場合の helper 抽出**
   例: 4 つ目の `buildXxxUniversityContext` 追加時に共通 helper を `contextBuilders/common.ts` に集約
3. **新機能が依存する path 上の type 循環解消**
   例: `lib/prompts/` に 5 つ目の module を足す PR で `AnalysisPromptContext` を `lib/prompts/types.ts` に切り出す
4. **rollback 単位として PR に閉じる削除**
   例: 新 component が古い component を完全置換するなら同 PR に削除を含める

### 禁止される「ついで refactor」

- リネーム（grep noise が増える）
- 別ファイルへの import path 変更で複数 route が修正対象になるもの
- 「全 route 統一」系の網羅変更
- 「いつかやるなら今」式の予防的整理

---

## 3. 30% ルールと 3 ファイル境界

### 30% ルール

refactor 行数が **feature 行数の 30% を超えたら分離**。

```
feature: +120 行
refactor: +40 行  →  OK（33% だがギリ許容）
refactor: +80 行  →  分離
```

### 3 ファイル境界

refactor が **3 ファイルを超えて広がるなら別 PR**。

- 例外: 中核 type の追加に伴う各層の同時更新（types → API → client の縦串）

---

## 4. 今はやらない方がいい refactor

| 対象 | 理由 |
|---|---|
| 大規模リネーム（`buildXxx` → `contextBuilders/...`） | shim 戦略の意味が薄れる |
| `lib/prompts.ts` shim の削除 | 5 route + 3 lib が一斉に壊れる |
| type 循環解消の単独 STEP 化 | runtime 影響なし。次の prompt module 追加に抱き合わせる方が経済的 |
| `scripts/step15-qa.ts` の単独分割 | 「production を触らない」約束を破るリスク。次 QA Case 追加に抱き合わせる |
| 既存 flat `lib/` ファイルの sub-directory 移設 | import 書き換えが広範。新規追加のみ sub-directory に入れる |
| 「全 route 統一」系の網羅変更 | diff 局所性破壊 |

---

## 5. Future-trigger 型 refactor

**trigger 条件が満たされた時のみ実行する予約 refactor 一覧。**
trigger 前に単独で実行してはいけない。

### T1. `getStudentProfileFromRequest` helper 統合

- **trigger**: StudentProfile を受け取るサーバ route が 5 つ目になった時
- **作業**: 3 段フォールバック（`body.studentProfile → toStudentProfile → null`）を `lib/getStudentProfileFromRequest.ts` に集約
- **理由**: 4 route の drift を許容しているが 5 で Red 確定

### T2. `interview-feedback/route.ts` の SYSTEM_PROMPT lift

- **trigger**: 同 route の SYSTEM_PROMPT 文言を次に変える時
- **作業**: SYSTEM_PROMPT を `lib/prompts/interviewFeedbackPrompt.ts` に切り出し。`scripts/step15-qa.ts` の import も同 PR で path 付け替え
- **理由**: QA から route.ts への逆依存を断つ

### T3. `lib/prompts/types.ts` 切り出し

- **trigger**: `lib/prompts/` に 5 つ目の module を足す時
- **作業**: `AnalysisPromptContext` を `lib/prompts/types.ts` に移し、`lib/prompts.ts` も per-route module も両方それを参照する DAG に
- **理由**: type 循環の構造的解消

### T4. `scripts/step15-qa.ts` 分割

- **trigger**: 新 QA Case の追加 PR
- **作業**: `scripts/step15-qa/{fixtures,runner,reporter,routes}/*.ts` への分割
- **理由**: 単独 STEP では production を触るリスクが高い

### T5. `lib/contextBuilders/universityDb/` への集約

- **trigger**: 6 つ目の `buildXxxUniversityContext` を追加する時
- **作業**: 共通 helper を `lib/contextBuilders/common.ts` に集約、新規は `contextBuilders/universityDb/` 配下に
- **理由**: 既存 5 ファイルは触らない。新規追加でパターンを正す

### T6. shim layer の方向決定（ADR 化）

- **trigger**: 次に新 route を追加する時
- **作業**: 新規 route は `from '@/lib/prompts/<file>'`（direct）を必須化。既存 shim 経由は触らない
- **理由**: 削除しないが「新規は direct」のルールで自然減を促す

---

## 6. drift 許容上限

「同パターンの並列実装が **4 箇所以上になった瞬間** に Red 認定」をルール化。
**3 箇所までは drift より diff 局所性を優先**。

現状の drift watch list:

- StudentProfile fallback: 4 route ＝ **既に Red**
- `buildXxxUniversityContext`: 5 ファイル ＝ **Red 寄りの Yellow**（helper 抽出未実施）
- AI route の `logAiUsage` パターン: 全 route ＝ 統一済み（drift なし）

---

## 7. STEP 種別の分離

これまで STEP15 系は prompt 改修と route 切り出しがセットだった。今後は分離:

- `STEP-XX-prompt`: SYSTEM_PROMPT / shared instruction の文言変更（PROMPT_VERSION bump 必須・人間レビュー必須）
- `STEP-XX-route`: route 内部の構造変更（QA 影響なし・claude-safe-list 対象）
- `STEP-XX-lib`: lib 切り出し・helper 統合
- `STEP-XX-type`: type 定義変更
- `STEP-XX-client`: client component の変更
- `STEP-OBSERVATION`: 構造観測（月 1 routine）

混在させると「diff 局所性」と「PROMPT_VERSION 管理の精度」が両立しない。

---

## 8. 「触ったら測る」習慣

PR description に以下を必ず記載:

- 編集対象ファイルが Red（行数 > 400 / 頻度 > 5/月）に該当するか
- 該当する場合、なぜ refactor を抱き合わせなかったか

Red 該当でも直す義務はない。**可視化が目的**。判断を意識化することで放置の暗黙化を防ぐ。

---

## 次回 STEP 作成時の使い方

### refactor を含む STEP を作る時

1. **4 軸スコアを測る**（Section 1）
2. **Red 2 軸以上 → 独立 PR、それ未満 → ついで refactor 検討**
3. **「ついで refactor」許可基準に該当するか確認**（Section 2）
4. **30% ルール / 3 ファイル境界を満たすか確認**（Section 3）
5. **「今はやらない方がいい refactor」に該当しないか確認**（Section 4）
6. **future-trigger 一覧の trigger 条件が今満たされていないか確認**（Section 5）
7. **STEP 種別を 1 つに絞る**（Section 7）

### feature 開発 STEP を作る時

1. **future-trigger の T1〜T6 が trigger 発火していないか確認**（Section 5）
2. 発火していれば該当 refactor を抱き合わせ
3. 30% / 3 ファイル境界を超えるなら trigger を分離

### 迷ったら

- **「scope は 1 つか」「3 ファイル以内か」**を確認
- **「今直さないと壊れるか」を自問**。壊れないなら future-trigger に登録して放置
- 整理しない判断も価値ある決定。**整理しない理由を PR description に書く**

---

## 関連ドキュメント

- 良い STEP の書き方・Claude への投げ方: [ai_assisted_development.md](./ai_assisted_development.md)
- code 配置ルール（components / lib / storage）: [architecture_rules.md](./architecture_rules.md)
- AI 機能の役割境界: [ai_policy.md](./ai_policy.md)
- PROMPT_VERSION 運用: [ai_cache_observability.md](./ai_cache_observability.md)
- AI 数値スコア contract の予防ルール（PROMPT_VERSION bump 条件含む）: [ai_score_contract.md](./ai_score_contract.md)
