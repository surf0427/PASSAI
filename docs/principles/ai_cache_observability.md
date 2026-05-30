# AI Cache Observability（運用ガイド）

## 1. 目的

- AI を **呼ばなかった** 瞬間（cache hit）と **呼ぶ必要があった** 瞬間（cache miss）を観測する
- `ai usage`（[`docs/principles/ai_usage_observability.md`](./ai_usage_observability.md)）は「**実際に AI を呼んだとき**」の token 量を観測するレーン
- 両者は責務が異なるため、log key と payload shape を分けて集計する
- STEP4.x で固めた `logAiUsage` の status contract（`success` / `truncated` / `parse_failed` / `failed` の 4 値）は **変更しない**

実装は `lib/aiCacheLog.ts` の `logAiCache()` 1 本に集約。STEP5.2 で `/api/analysis` に最初に導入。

---

## 2. ログ仕様

### 2.1 log key

```
ai cache
```

`console.info('ai cache', payload)` の第 1 引数として固定。platform 側の構造化 log 収集（Vercel / Datadog 等）で `ai cache` と `ai usage` を別 stream として抽出する。

### 2.2 payload shape

| key | type | 意味 |
|---|---|---|
| `route` | `string` | AI route 識別子（例: `'api/analysis'`） |
| `action` | `'hit' \| 'miss'` | hit = AI call を skip、miss = AI call が必要だった |
| `inputHash` | `string` | 入力ハッシュ（djb2 base36）。集計時にケースを束ねる識別子。元入力は復元不可 |

### 2.3 個人情報ガード

`LogAiCacheEvent` の型で以下は **渡せない構造** になっている:

- request body / 活動本文 / 自己分析データ / 基本情報の中身
- prompt 本文・AI 出力本文
- user-agent / IP / cookie / session

`inputHash` は固定長文字列で逆引き不可。

---

## 3. `ai usage` との時系列関係

同じ user の「分析開始」アクション 1 回あたりに出る log:

| シナリオ | `ai cache` | `ai usage` |
|---|---|---|
| 初回（cache 無し） | `action='miss'` 1 行 | AI call return 直後に 1 行 |
| 同入力 2 回目（cache hit） | `action='hit'` 1 行 | 出ない（AI を呼ばない） |
| 入力変更後 | `action='miss'` 1 行 | AI call return 直後に 1 行 |

集計指標:

- **cache hit 率** = `hit / (hit + miss)`
- **削減 token 推計** = 同 route の `ai usage` 平均 `total_tokens` × `hit` 件数

---

## 4. `logAiUsage` の contract は変更しない

`AiUsageStatus` の 4 値（`success` / `truncated` / `parse_failed` / `failed`）に `cache_hit` などの新値を追加しない。**ログ key を分けることで集計責務を分離する**。

理由:

- `ai usage` は「token cost を観測する」レーン。cache hit は 0 token であり、distribution に混ぜると指標が歪む
- STEP4.x で 11 route 全部に統一形 payload を入れた contract を壊さない
- 集計クエリは log key 単位で書かれている前提

---

## 5. 実装と利用箇所

### 5.1 `/api/analysis`（STEP5.2）

- ログ関数: [`lib/aiCacheLog.ts`](../../lib/aiCacheLog.ts) の `logAiCache()`
- 型: `LogAiCacheEvent` / `AiCacheAction`
- 利用箇所: [`hooks/useWallHitting.ts`](../../hooks/useWallHitting.ts)
- 関連 storage: [`lib/wallHittingInputHashStorage.ts`](../../lib/wallHittingInputHashStorage.ts)
- input hash 計算: [`lib/aiInputHash.ts`](../../lib/aiInputHash.ts) の `hashAnalysisInput()`

### 5.2 `/api/analysis/additional`（STEP5.4）

- ログ関数: 同じ `logAiCache()` を再利用（`route: 'api/analysis/additional'`）
- 利用箇所: [`app/self-analysis/page.tsx`](../../app/self-analysis/page.tsx) の `handleAddMoreQuestions`
- 関連 storage: [`lib/additionalQuestionsCache.ts`](../../lib/additionalQuestionsCache.ts)（hash と生成済み questions を 1 key に同居）
- input hash 計算: [`lib/aiInputHash.ts`](../../lib/aiInputHash.ts) の `hashAdditionalQuestionsInput()`

**daily limit との関係（STEP5.4）**:

| 経路 | `ai cache` | `ai usage` | daily limit (`additionalQuestionsUsage`) |
|---|---|---|---|
| cache hit | `action='hit'` | 出ない（AI を呼ばない） | **消費しない**（AI call が起きていないため） |
| cache miss + AI 成功 | `action='miss'` | `status='success'` | +1 消費 |
| cache miss + AI 失敗 / network エラー | `action='miss'` | `status='truncated'/'parse_failed'/'failed'` または出ない | 消費しない（既存挙動維持） |

cache hit 時に daily limit を消費しないのは、limit の semantics が「AI 生成回数」であり、cache 復元では新規生成が起きていないため。**`logAiUsage` の status contract（4 値）は変更しない**。

### 5.3 `/api/summarize`（STEP5.8）

- ログ関数: 同じ `logAiCache()` を再利用（`route: 'api/summarize'`）
- 利用箇所: [`app/self-analysis/page.tsx`](../../app/self-analysis/page.tsx) の `handleSummarize`
- 関連 storage: [`lib/summarizeCache.ts`](../../lib/summarizeCache.ts)（hash と生成済み `SummaryResult` を 1 key に同居）
- input hash 計算: [`lib/aiInputHash.ts`](../../lib/aiInputHash.ts) の `hashSummarizeInput()`
- daily limit との関係: `/api/summarize` には daily limit 機構が無いため考慮事項なし
- 入力: `activityData` / `basicInfo` / `universityContext`（client 側派生）/ `analysis`（呼び出し側で `questions` を `displayedQuestions` に差し替え済）/ `answers` / `model` / `promptVersion`。`displayedQuestions` は `analysis.questions` に既に差し替え済のため別途含めない（二重カウント防止）

### 5.4 `/api/statement-review`（STEP5.10）

> AI が返す数値スコアの整合性ルール（totalScore と scores 合計、PROMPT_VERSION bump 条件など）は [ai_score_contract.md](./ai_score_contract.md) を参照。本 route は v3 で score 制約に矛盾があり STEP5b で v4 に bump 済み。


- ログ関数: 同じ `logAiCache()` を再利用（`route: 'api/statement-review'`）
- 利用箇所: [`app/statement/edit/page.tsx`](../../app/statement/edit/page.tsx) の `submitReview`
- 関連 storage: [`lib/statementReviewCache.ts`](../../lib/statementReviewCache.ts)（hash と生成済み `ApiReviewResponse` を 1 key に同居）
- input hash 計算: [`lib/aiInputHash.ts`](../../lib/aiInputHash.ts) の `hashStatementReviewInput()`
- 入力（STEP-F / v5 以降）: `university` / `faculty` / `department` / `essay` / `basicInfo` / `activityData` / `studentProfile` / `model` / `promptVersion`。`statementReviewHistory` / `statementReviewLimit` / 出力 score・feedback は含めない。`wallHittingResult` は v5 で **hash 入力から除外**（canonical `studentProfile` 一本化）。ただし `fetch('/api/statement-review')` の body には引き続き含める（route.ts 側の prompt builder が canonical 不在ユーザに対して `toStudentProfile(wallHittingResult)` で fallback を作るため。hash と prompt body が input source 上 intentional に非対称）

**daily limit / history との関係（STEP5.10）**:

| 経路 | `ai cache` | `ai usage` | `statementReviewLimit` | `statementReviewHistory` |
|---|---|---|---|---|
| cache hit | `action='hit'` | 出ない | **消費しない** | **append する**（ユーザーが確認した添削履歴 semantics） |
| cache miss + AI 成功 | `action='miss'` | `status='success'` | +1 消費 | append する |
| cache miss + AI 失敗 / network エラー | `action='miss'` | `status='truncated'/'parse_failed'/'failed'` または出ない | 消費しない（既存挙動維持） | append しない |

cache hit が daily limit を消費しないのは limit semantics が「AI 生成回数」であるため。history は STEP5.4 の displayedQuestions と思想を変え、**ユーザー側に見える添削の参照履歴**として hit 時も残す。

### 5.5 `/api/essay-review`（STEP5.11）

- ログ関数: 同じ `logAiCache()` を再利用（`route: 'api/essay-review'`）
- 利用箇所: [`app/essay-practice/page.tsx`](../../app/essay-practice/page.tsx) の `handleReviewEssay`
- 関連 storage: [`lib/essayReviewCache.ts`](../../lib/essayReviewCache.ts)（hash と生成済み `ReviewResult` を 1 key に同居）
- input hash 計算: [`lib/aiInputHash.ts`](../../lib/aiInputHash.ts) の `hashEssayReviewInput()`
- daily limit: `/api/essay-review` には専用 daily limit 機構が無いため考慮事項なし
- 入力: `theme` / `themeType` / `conclusion` / `reasonOne` / `reasonTwo` / `essayBody` / `basicInfo` / `model` / `promptVersion`。`savedReview` / `reviewHistory` / 出力 score 系は含めない
- hit 時の挙動: 通常成功時と同じ state 更新 + 既存 `essayPracticeReview`（`SavedReview`）保存 + ステップ 5 への遷移を通す（review 履歴を視覚的に維持する semantics）

他 route（`/api/interview-feedback` / `/api/matching` 等）への横展開は STEP5.x 以降で検討する。

---

## 6. Route → Prompt file → Hash file → Version 対応表

リリース前コード整理（STEP-CODE-CLEANUP-A1, 2026-05-30）で棚卸し。**prompt 本文を変更する PR では、対応する `Version constant` を必ず bump すること**（§6.2 ルール参照）。本表は doc。コードは触らない。

### 6.1 対応表

`Has cache?` = client 側 localStorage cache 機構（hash → result）の有無。`No` の route は PROMPT_VERSION bump 概念を持たない（cache identity に絡まないため）。

| Route | Prompt file | Hash file | Version constant | Current version | Model | Has cache? | Notes |
|---|---|---|---|---|---|---|---|
| `/api/analysis` | [`lib/prompts/analysisPrompt.ts`](../../lib/prompts/analysisPrompt.ts) | [`lib/hash/analysis.ts`](../../lib/hash/analysis.ts) | `ANALYSIS_PROMPT_VERSION` | `3` | `claude-sonnet-4-6` | Yes | `lib/aiInputHash.ts` 経由 re-export。`hashAnalysisInput` |
| `/api/analysis/additional` | [`lib/prompts/additionalQuestionsPrompt.ts`](../../lib/prompts/additionalQuestionsPrompt.ts) | [`lib/hash/additionalQuestions.ts`](../../lib/hash/additionalQuestions.ts) | `ADDITIONAL_QUESTIONS_PROMPT_VERSION` | `2` | `claude-sonnet-4-6` | Yes | `hashAdditionalQuestionsInput` |
| `/api/summarize` | [`lib/prompts/summarizePrompt.ts`](../../lib/prompts/summarizePrompt.ts) | [`lib/hash/summarize.ts`](../../lib/hash/summarize.ts) | `SUMMARIZE_PROMPT_VERSION` | `5` | `claude-sonnet-4-6` | Yes | `hashSummarizeInput` |
| `/api/statement-review` | [`lib/statement/review/statementPrompt.ts`](../../lib/statement/review/statementPrompt.ts) | [`lib/hash/statementReview.ts`](../../lib/hash/statementReview.ts) | `STATEMENT_REVIEW_PROMPT_VERSION` | `8` | `claude-sonnet-4-6` | Yes | prompt は `lib/statement/review/` 配下（`lib/prompts/` ではない）。`hashStatementReviewInput`。`wallHittingResult` は v5 で hash 入力から除外（[`ai_score_contract.md`](./ai_score_contract.md) 参照） |
| `/api/essay-review` | [`lib/prompts/essayReviewPrompt.ts`](../../lib/prompts/essayReviewPrompt.ts) | [`lib/hash/essayReview.ts`](../../lib/hash/essayReview.ts) | `ESSAY_REVIEW_PROMPT_VERSION` | `3` | `claude-sonnet-4-6` | Yes | `hashEssayReviewInput`。`buildExamTypeGuidance` ヘルパが route 内に存在（[`app/api/essay-review/route.ts`](../../app/api/essay-review/route.ts)）。同じパターンが `/api/essay-improve-summary` にもあるが共通化されていない（リリース後の整理候補） |
| `/api/essay-improve-summary` | [`lib/prompts/essayImproveSummaryPrompt.ts`](../../lib/prompts/essayImproveSummaryPrompt.ts) | [`lib/hash/essayImproveSummary.ts`](../../lib/hash/essayImproveSummary.ts) | `ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION` | `2` | `claude-sonnet-4-6` | Yes | `hashEssayImproveSummaryInput` |
| `/api/interview-questions` | [`lib/interview/buildInterviewQuestionPrompt.ts`](../../lib/interview/buildInterviewQuestionPrompt.ts) | [`lib/hash/interviewQuestions.ts`](../../lib/hash/interviewQuestions.ts) | `INTERVIEW_QUESTIONS_PROMPT_VERSION` | `5` | `claude-sonnet-4-6` | Yes | prompt は `lib/interview/` 配下（`lib/prompts/` ではない）。**route 内 line 111 のコメント "PROMPT_VERSION v4" は stale**（現値は 5；v4 で導入された seed 機構の由来説明として残っているが、初見では誤読しやすい）。`hashInterviewQuestionsInput` |
| `/api/tutor` | [`lib/tutor/tutorPrompt.ts`](../../lib/tutor/tutorPrompt.ts) | [`lib/hash/tutor.ts`](../../lib/hash/tutor.ts) | `TUTOR_PROMPT_VERSION` | `14` | `claude-sonnet-4-6` (`TUTOR_MODEL`) | No (server rate limit のみ) | prompt は `lib/tutor/` 配下。version は cache identity ではなく **bump 履歴 / observability** 用途として運用（[`lib/hash/tutor.ts`](../../lib/hash/tutor.ts) 冒頭コメント参照）。client cache は持たない |
| `/api/essay-chat` | [`lib/prompts/essayChatPrompt.ts`](../../lib/prompts/essayChatPrompt.ts) | — | — | — | `claude-sonnet-4-6` | No | route line 9 に「cache を持たないため PROMPT_VERSION bump 対象外」と明示。**文言改修は PR description で明示**（version での自動 invalidate は無し） |
| `/api/interview-feedback` | [`lib/prompts/interviewFeedbackPrompt.ts`](../../lib/prompts/interviewFeedbackPrompt.ts) | — | — | — | `claude-sonnet-4-6` | No | route line 23 に「localStorage cache に PROMPT_VERSION 概念を持たない（cache 自体なし）」と明示。文言変更は PR description 明示 |
| `/api/matching` | [`lib/matching/matchingPrompt.ts`](../../lib/matching/matchingPrompt.ts) | — | — | — | `claude-sonnet-4-6` | Yes (`aiMatchAdviceCache` 単一 key) | matchingPrompt.ts line 24 に「PROMPT_VERSION 概念は持たないため、本 STEP の prompt 改修では cache を強制 invalidate しない」と明示。**特殊**: cache は単一 entry の localStorage key で、prompt 改修時はユーザーが「再診断する」ボタンを押すまで旧 reason が残る（仕様として許容） |
| `/api/statement-prepare` | [`lib/statement/prepare/statementPreparePrompt.ts`](../../lib/statement/prepare/statementPreparePrompt.ts) | — | — | — | `claude-sonnet-4-6` | No | route line 123 に「statement-prepare には PROMPT_VERSION / hash / cache 機構がない」と明示。文言変更は PR description 明示 |
| `/api/reason` | [`lib/prompts.ts`](../../lib/prompts.ts) (`buildReasonPrompt`) | — | — | — | `claude-sonnet-4-6` | No | self-pr ページから呼ばれる plain text 経路。cache 機構なし。route / prompt ファイルに version 関連コメントが **無い**（リリース後の整理候補：route 冒頭に「cache なし / PROMPT_VERSION 対象外」コメントを追加するか、または `buildReasonPrompt` を `lib/prompts/` 配下に移動して構成を統一） |

### 6.2 PROMPT_VERSION bump ルール

**Has cache? = Yes の route**:

- prompt 本文（SYSTEM_PROMPT / user prompt builder の文字列）を変更したら、対応する `Version constant` を **必ず +1** する。
- bump し忘れると、本番 cache が旧 prompt の結果を新 prompt の名のもとに返し続ける **silent corruption** が発生する（検出は KPI ログでしか不可能）。
- 同 PR 内で hash 入力の shape を変えた場合も同様に bump。
- bump 履歴は対応 hash file 冒頭のコメントブロックに 1 行追記する（既存 STEP 履歴の形式に揃える）。

**Has cache? = No の route** (`/api/essay-chat`, `/api/interview-feedback`, `/api/statement-prepare`, `/api/reason`, `/api/tutor` は cache が無い):

- version bump は不要。ただし **PR description に「prompt 文言を変えた」旨を明記** する（observability log との突合用）。
- `/api/matching` は単一 entry cache のため、強制 invalidate は仕様として行わない（ユーザー操作待ち）。

**特殊: `/api/tutor`**:

- `TUTOR_PROMPT_VERSION` は cache identity 用途ではなく、bump 履歴と observability のためだけに維持されている。
- 文言変更時は引き続き +1 することで bump 履歴の連続性を保つ（[`lib/hash/tutor.ts`](../../lib/hash/tutor.ts) 冒頭コメントの運用と一致）。

### 6.3 棚卸しで観測したリスク（このPRでは触らない）

A1 観測のみ。コード変更は別 STEP で扱う。

| 項目 | 内容 | 影響度 |
|---|---|---|
| stale コメント | [`app/api/interview-questions/route.ts:111`](../../app/api/interview-questions/route.ts) の `PROMPT_VERSION v4` 表記が現値 5 と食い違う | 低（読者の誤読） |
| version コメント不在 | [`app/api/reason/route.ts`](../../app/api/reason/route.ts) と [`lib/prompts.ts`](../../lib/prompts.ts) の `buildReasonPrompt` に cache/version 方針コメントが無い | 中（新規開発者が誤って「あるはず」と探す） |
| prompt file 配置の不統一 | `/api/statement-review` `/api/interview-questions` `/api/tutor` `/api/matching` `/api/statement-prepare` の prompt は `lib/prompts/` 配下ではなく feature 別ディレクトリ（intentional だが initial reader に分かりにくい） | 低 |
| route 内ヘルパの重複 | `buildExamTypeGuidance` 系が `/api/essay-review` と `/api/essay-improve-summary` の route ファイル内に類似実装で重複 | 中（リリース後の整理候補） |
| version 集約 shim | [`lib/aiInputHash.ts`](../../lib/aiInputHash.ts) は 8 つの version を re-export する shim で、新規 route は直接 `lib/hash/<feature>.ts` から import 推奨（既存 import 経路は不変） | 低 |

---

## 7. 改訂履歴

- 2026-05-11: 初版作成（STEP5.2）。`/api/analysis` への client-side input hash cache 導入と同時に整備。
- 2026-05-11: STEP5.4 — `/api/analysis/additional` への横展開を追記。daily limit との関係を明文化。
- 2026-05-11: STEP5.8 — `/api/summarize` への横展開を追記（活動まとめ生成 cache）。
- 2026-05-11: STEP5.10 — `/api/statement-review` への横展開を追記。hit 時の daily limit / history 扱いを明文化（hit は limit 不消費、history は append）。
- 2026-05-11: STEP5.11 — `/api/essay-review` への横展開を追記（小論文添削 cache）。daily limit なし。
- 2026-05-16: STEP-F — `/api/statement-review` の `STATEMENT_REVIEW_PROMPT_VERSION` を 4 → 5 に bump。`hashStatementReviewInput` から `wallHittingResult` を除外し、cache identity を canonical `studentProfile` 一本に揃えた（同素材を 2 object で二重 hash していたのを 1 object に縮める変更）。route.ts / prompt 本文は不変で、`fetch` body は両方を引き続き送信する（hash と body の intentional asymmetry）。bump により旧 v4 cache は一律 miss になる（intentional 1 回損失）。`studentProfile.generatedAt` drift の完全解消は別 STEP として残す（minimum migration）。
- 2026-05-30: STEP-CODE-CLEANUP-A1 — §6 を新設。13 route × prompt file × hash file × Version constant の対応表と PROMPT_VERSION bump ルールを集約。observation のみで code 不変。`/api/interview-questions` route 内コメントの stale 表記等のリスク 5 件も同 §6.3 に記録。
