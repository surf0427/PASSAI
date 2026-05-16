# localStorage キー一覧

将来 Supabase に移行する想定で、現在 localStorage に保存しているキーを横断的に集約管理する。

## 正本

**キー一覧の正本は [`lib/storage/README.md`](../../lib/storage/README.md) に置く。**

- 全キーの一覧表（key 名 / ファイル / 形式 / 用途）
- `safeStorage` ヘルパーの使い方
- raw string キーの扱い（`selfPR_draft`）
- sessionStorage の扱い
- 新しい storage を追加するときのルール

このファイル（`docs/shared/localstorage_keys.md`）は **`lib/storage/README.md` への入り口** として機能する。仕様の二重化を避けるため、ここに表は書かない。

## STEP5.2 で追加された key

- `wallHittingInputHash`（[`lib/wallHittingInputHashStorage.ts`](../../lib/wallHittingInputHashStorage.ts), JSON）— `/api/analysis` の input hash cache。同一入力なら AI call を skip して保存済み `wallHittingResult` を復元するための判定 key。

## STEP5.4 で追加された key

- `additionalQuestionsInputHash`（[`lib/additionalQuestionsCache.ts`](../../lib/additionalQuestionsCache.ts), JSON）— `/api/analysis/additional` の input hash + 生成済み追加質問の同居 cache。同一入力なら AI call を skip して保存済み questions を復元するための判定 key。hit 時は daily limit を消費しない。

## STEP5.8 で追加された key

- `summarizeInputHash`（[`lib/summarizeCache.ts`](../../lib/summarizeCache.ts), JSON）— `/api/summarize` の input hash + 生成済み `SummaryResult` の同居 cache。同一入力（activityData / basicInfo / universityContext / analysis / answers / model / promptVersion）なら AI call を skip して保存済み summary を復元するための判定 key。`analyzeState.summary` とは独立。

## STEP5.10 で追加された key

- `statementReviewInputHash`（[`lib/statement/review/statementReviewCache.ts`](../../lib/statement/review/statementReviewCache.ts), JSON）— `/api/statement-review` の input hash + 生成済み `ApiReviewResponse` の同居 cache。同一入力（university / faculty / department / essay / basicInfo / activityData / studentProfile / model / promptVersion）なら AI call を skip して保存済み response を復元するための判定 key。hit 時は `statementReviewLimit` を消費しないが、`statementReviewHistory` には append される。STEP-F (v5) で `wallHittingResult` を hash 入力から除外し canonical `studentProfile` 一本化（旧 v4 cache は一律 miss → 1 回 AI call → 新 v5 cache 保存）。`fetch` body には引き続き `wallHittingResult` を含めるため hash と body は intentional に非対称（route.ts の prompt builder が canonical 不在ユーザに対して fallback を作る）。`studentProfile.generatedAt` drift の完全解消は別 STEP として残す（STEP-F は minimum migration）。

## STEP5.11 で追加された key

- `essayReviewInputHash`（[`lib/essayReviewCache.ts`](../../lib/essayReviewCache.ts), JSON）— `/api/essay-review` の input hash + 生成済み `ReviewResult` の同居 cache。同一入力（theme / themeType / conclusion / reasonOne / reasonTwo / essayBody / basicInfo / model / promptVersion）なら AI call を skip して保存済み review を復元するための判定 key。`essayPracticeReview` (`SavedReview`) とは独立。

## STEP8 で追加された key

- `interviewQuestionsCache`（[`lib/interviewQuestionCache.ts`](../../lib/interviewQuestionCache.ts), JSON）— `/api/interview-questions` の input hash + 生成済み `TwoLayerInterviewQuestions` の同居 cache。同一入力（basicInfo / statementDraft / studentProfile / activitySummary / model / promptVersion）なら AI call を skip して保存済み 2 層質問を復元する。`legacy` fallback 経路は保存対象外。route 側には cache を入れずクライアント側のみで管理する。

## storage 配置ルール

- すべての `*Storage.ts` は `lib/` 直下に配置する（flat な命名規則）。
- 機能ローカル（`app/{feature}/storage/`）には storage ファイルを置かない。Supabase 移行時に「localStorage 操作箇所」を grep する際の漏れを防ぐため。
- 新規 storage は JSON 形式を基本とする。raw string 形式は既存の `selfPR_draft` のみ。

## Supabase 移行時の注意

- `lib/*Storage.ts` 群が置換対象になる。grep 対象は `lib/storage/safeStorage.ts` を import している全ファイル。
- 一部の storage ファイルにレガシースキーマの正規化ロジックが入っている（例: [`lib/statementStorage.ts`](../../lib/statementStorage.ts), [`lib/basicInfoStorage.ts`](../../lib/basicInfoStorage.ts)）。Supabase 移行時に「DB 側 migration として再実装するか / レガシー互換を打ち切るか」を判断する必要がある。
- raw string 形式の `selfPR_draft` は JSON 列に入れる前に正規化が必要。
- 詳細な移行戦略は別途 TODO（`docs/principles/architecture_rules.md` を参照）。
