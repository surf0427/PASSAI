# API Error Handling Inventory（AI/API エラーハンドリング UX 棚卸し）

作成日: 2026-05-30（STEP-CODE-CLEANUP-A3）
status: **observation only**（runtime code 不変、本 doc は観察記録）

---

## 0. 目的とスコープ

PASSAI 全体で `fetch('/api/...')` を呼んでいる箇所の **loading / error / timeout / retry / cancel** UX を 1 表に集約し、リリース直前の UX 一貫性リスクを可視化する。

- **コード変更しない**。本 doc は次フェーズの整理 STEP の根拠とする。
- 観点: ユーザーが「成功 / 失敗 / 待機 / 中断」を理解できるか。silent fail の検出。
- 既存 contract（response shape, status 値, prompt 本文）は触らない。
- 関連: [`ai_cache_observability.md`](./ai_cache_observability.md) §6 / [`../release/freeze.md`](../release/freeze.md) §1.2

---

## 1. 全 fetch('/api/...') 呼び出し一覧

**API 呼び出し総数: 18 箇所 / 13 route**（同一 route を複数 caller から呼ぶ重複あり）。

| # | Caller | Route | Loading | Error | Timeout | Retry | Cancel | Class | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | [hooks/useWallHitting.ts:84](../../hooks/useWallHitting.ts) | `/api/analysis` | `setLoading(true)` (caller 側 spinner) | `setError(data.detail ?? '...')` inline | server `createTimeoutSignal()` のみ | なし | なし | **B** | `catch` 文言固定。client 側 AbortController 未使用 |
| 2 | [app/self-analysis/resume/page.tsx:157](../../app/self-analysis/resume/page.tsx) | `/api/analysis/additional` | `setLoading(true)` | `setError(data.detail ?? '深掘り質問の生成に失敗しました')` inline | server timeout のみ | なし | なし | **B** | `newQuestions.length === 0` も別 error 文言で扱う |
| 3 | [app/self-analysis/run/page.tsx:340](../../app/self-analysis/run/page.tsx) | `/api/analysis/additional` | `setAddQuestionsLoading(true)` | `setAddQuestionsError(data.detail ?? '質問の追加に失敗しました')` inline | server timeout のみ | なし | なし | **B** | cache hit / miss 両方を logAiCache に観測 |
| 4 | [app/self-analysis/run/page.tsx:464](../../app/self-analysis/run/page.tsx) | `/api/summarize` | `setSummarizeLoading(true)` + `setSummarizeLoadingStartedAt(Date.now())` | `setSummarizeError(data.detail ?? 'まとめの生成に失敗しました')` inline | server timeout のみ | なし | なし | **B** | LoadingProgress 候補（startedAt あり） |
| 5 | [app/essay-practice/page.tsx:261](../../app/essay-practice/page.tsx) | `/api/essay-chat` | `setChatLoading(true)` | `setChatError(data.message ?? data.error ?? '...')` inline | server timeout のみ | なし | なし | **B** | 構造化 error message を優先 |
| 6 | [app/essay-practice/page.tsx:435](../../app/essay-practice/page.tsx) | `/api/essay-review` | `setReviewLoading(true)` + `setReviewLoadingStartedAt(Date.now())` + `<LoadingProgress>` | `setReviewError(data.message ?? data.error ?? '...')` inline | server timeout のみ | なし | **なし**（LoadingProgress に cancel button 配線なし） | **B+** | cancel 配線が無いだけで A 相当の UX |
| 7 | [app/essay/improve/[wid]/page.tsx:232](../../app/essay/improve/[wid]/page.tsx) | `/api/essay-improve-summary` | `setSummaryLoading(true)` | `setSummaryError(data.message ?? data.error ?? '...')` inline | server timeout のみ | なし | なし | **B** | workspace save 失敗 (catch) は `console.warn` で silent |
| 8 | [app/essay/improve/[wid]/rewrite/page.tsx:230](../../app/essay/improve/[wid]/rewrite/page.tsx) | `/api/essay-review` | `setReviewLoading(true)` | `setReviewError(data.message ?? data.error ?? '...')` inline | server timeout のみ | なし | なし | **B** | API 失敗時に workspace 不変（rollback safety） |
| 9 | [app/essay/structure/[wid]/body/page.tsx:224](../../app/essay/structure/[wid]/body/page.tsx) | `/api/essay-review` | `setReviewLoading(true)` | `setReviewError(...)` inline | server timeout のみ | なし | なし | **B** | 同上 |
| 10 | [app/essay/write/[wid]/body/page.tsx:175](../../app/essay/write/[wid]/body/page.tsx) | `/api/essay-review` | `setReviewLoading(true)` | `setReviewError(...)` inline | server timeout のみ | なし | なし | **B** | 同上 |
| 11 | [app/interview/questions/components/InterviewQuestionForm.tsx:190](../../app/interview/questions/components/InterviewQuestionForm.tsx) | `/api/interview-questions` | `setIsAiLoading(true)` + `setAiLoadingStartedAt(Date.now())` | `catch { applyFallback() }` で deterministic fallback → `setUsedFallback(true)` → [`InterviewQuestionPreview`](../../app/interview/questions/components/InterviewQuestionPreview.tsx) 内 `<FallbackNotice />` を表示 | server timeout のみ | なし | なし | **B+**（初版 A3 では C と誤判定。A5 訂正） | A3 初版で「silent」と判定したが**実態は silent ではなかった**。amber notice で「AI 質問の生成に失敗したため、標準質問に切り替えました。練習はこのまま続けられます。」を inline 表示する経路が既存。STEP-CODE-CLEANUP-A4 で文言を「練習はこのまま続けられます」を含む安心文言に更新し `role="status" aria-live="polite"` を明示 |
| 12 | [app/interview/record/components/InterviewRecordForm.tsx:133](../../app/interview/record/components/InterviewRecordForm.tsx) | `/api/interview-feedback` | `isSubmitting` spinner | 構造化 error は `setApiError(data.message)`、**network 失敗 (`catch`) は `generateInterviewFeedback(myAnswers)` で local fallback + `setFallbackNotice(...)` で AlertBox variant="warning" 表示**（STEP-CODE-CLEANUP-A4） | server timeout のみ | なし | なし | **B+**（初版 A3 では C と判定。A4 で可視化済み） | `!response.ok` で `data.message` ありの場合は inline error (B)。`catch` 経路は A4 で silent → visible に修正。`generateInterviewFeedback` fallback と保存フロー (`addInterviewRecord` / `savedMessage`) は維持され、「保存はできた / フィードバックは簡易版」が両方ユーザーに伝わる |
| 13 | [app/admission-matching/page.tsx:299](../../app/admission-matching/page.tsx) | `/api/matching` | `setAiLoading(true)` + `setAiLoadingStartedAt(Date.now())` + `<LoadingProgress>` | `setAiError('マッチングに失敗しました。もう一度お試しください。')` inline banner | server timeout のみ | なし | **AbortController + cancel button** | **A** | LoadingProgress に cancel 配線済 (STEP-UX-FIX-06c)。partial fail も `setLivePartial(true)` で UX に出る |
| 14 | [app/self-pr/page.tsx:454](../../app/self-pr/page.tsx) | `/api/reason` | `setLoading(true)` | `setError('AIの処理に失敗しました。...')` inline | server timeout のみ | なし | なし | **B** | 文言固定（API の data.message を読まない） |
| 15 | [app/statement/edit/page.tsx:502](../../app/statement/edit/page.tsx) | `/api/statement-review` | `setLoading(true)` + `setLoadingStartedAt(Date.now())` + `<LoadingProgress>` | `setError(parseStatementReviewError(data))` inline | server timeout のみ | なし | **AbortController + cancel button** | **A** | parseStatementReviewError で構造化 error を message → error → fallback の順に展開 |
| 16 | [app/statement/prepare/page.tsx:227](../../app/statement/prepare/page.tsx) | `/api/statement-prepare` | `setLoading(true)` | `setApiError('整理に失敗しました。...')` inline / **429 専用文言 + Retry-After 反映** | server timeout のみ | なし | なし | **B+** | 429 / 4xx / parse fail / network すべてを inline で扱う。retry guidance あり |
| 17 | [app/statement/prepare/university/page.tsx:197](../../app/statement/prepare/university/page.tsx) | `/api/statement-prepare` | `setLoading(true)` | `setError(...)` inline / 429 専用文言 | server timeout のみ | なし | なし | **B+** | university page 経由 caller。同上 |
| 18 | [app/tutor/page.tsx:242](../../app/tutor/page.tsx) | `/api/tutor` | `setLoading(true)` + chat spinner | `setError(dataObj.message ?? '...')` inline、`response.json()` 失敗も `try/catch` で防御 | server timeout のみ | なし | なし | **B+** | reply 空文字 / 非 string も別 error で検出。tutor UX 全体で防御が一段厚い |

凡例:
- **Loading**: 「待機中」を UI で明示しているか
- **Error**: 失敗時のユーザー通知手段
- **Timeout**: client 側で fetch を中断する仕組み (server 側 `createTimeoutSignal()` は全 route 共通で常にあり)
- **Retry**: 自動 / 手動 retry の仕組み
- **Cancel**: ユーザーが進行中の AI 呼び出しを中断できるか

---

## 2. 分類定義

| Class | 定義 | 条件 |
|---|---|---|
| **A** | ユーザーが状況を理解できる | LoadingProgress（時間経過の見える化）+ inline error banner（文言が状況に応じる）+ AbortController cancel |
| **B+** | 一応表示される（情報量は十分） | spinner / 簡易 loading + inline error banner + 構造化 error message 反映 |
| **B** | 一応表示される（最低限） | spinner + inline error banner（固定文言寄り） |
| **C** | silent fail の可能性あり | catch 経路で local fallback / deterministic 切替に黙って falling back する。**UI 上「AI が失敗した」が見えない** |

---

## 3. silent fail 候補（重点監査）

`catch(console.error)` / `return null` / `return undefined` / `alert()` / swallow error 観点で精査した。

### 3.1 silent fail（A4 / A5 で訂正・解消済み）

| 箇所 | A3 初版判定 | 訂正・解消後の実態 |
|---|---|---|
| [InterviewQuestionForm.tsx:221](../../app/interview/questions/components/InterviewQuestionForm.tsx) | 「`catch { applyFallback() }` で silent fallback」 | **誤判定（A5 訂正）**。`applyFallback()` 内で `setUsedFallback(true)` を立て、[`InterviewQuestionPreview`](../../app/interview/questions/components/InterviewQuestionPreview.tsx) の `<FallbackNotice />` で amber notice を inline 表示する経路が**初版時点で既存**。A3 inventory が Preview コンポーネント側まで追わずに silent と判定したのが原因。A4 で文言だけ「練習はこのまま続けられます」へ更新（mechanism 変更なし）。**現状 silent fail ではない** |
| [InterviewRecordForm.tsx:167-169](../../app/interview/record/components/InterviewRecordForm.tsx) | 「`catch` で `generateInterviewFeedback` に silent fallback」 | **A4 で解消**。`fallbackNotice` state を新設し、catch 内で `setFallbackNotice('AIフィードバックの生成に失敗したため、簡易フィードバックを表示しています。')` を実行。AlertBox variant="warning" でレンダー（`apiError` と `savedMessage` の間）。fallback (`generateInterviewFeedback(myAnswers)`) と保存フロー (`addInterviewRecord` / `setSavedMessage('練習記録を保存しました。')`) は維持され、「保存はできた / フィードバックは簡易版」が両方伝わる。**現状 silent fail ではない** |

**残タスク（A5 時点）**: 実装上の silent fail は両方とも解消済み。残るは **手動 fail 再現での視認確認**（[release_smoke_test_01.md](../release/release_smoke_test_01.md) #33 / #34 で扱う）。コード変更は不要。

### 3.2 intentional な silent（best-effort、副作用が無いので許容）

| 箇所 | 内容 | 評価 |
|---|---|---|
| [essay-practice/page.tsx:350](../../app/essay-practice/page.tsx) `persistReviewToWorkspace` | `console.warn('[essay STEP B] dual-write to essayWorkspaces failed')` | legacy `essayPracticeReview` への保存が成功している前提。dual-write 側の失敗を user に伝播させないのは intentional |
| [essay/improve/[wid]/page.tsx:223,260,273](../../app/essay/improve/[wid]/page.tsx) | `console.warn(...)` for workspace upsert / cache save 失敗 | best-effort cache。次回 fetch で再生成可能なので silent OK |
| [essay/improve/[wid]/rewrite/page.tsx:268](../../app/essay/improve/[wid]/rewrite/page.tsx) | `console.warn('[essay STEP G] cache save failed')` | 同上 |
| [essay/structure/[wid]/body/page.tsx:263](../../app/essay/structure/[wid]/body/page.tsx) | `console.warn('[essay STEP N] cache save failed')` | 同上 |
| [essay/write/[wid]/body/page.tsx:213,229](../../app/essay/write/[wid]/body/page.tsx) | `console.warn('[essay STEP O] write cache save failed')` / `... workspace save after review failed` | 同上 |
| [InterviewRecordForm.tsx:113-114](../../app/interview/record/components/InterviewRecordForm.tsx) | `previousFeedback` load の `try { ... } catch { return undefined; }` | 履歴読み込み失敗を「履歴なし」として扱う。AI 入力の質が下がるだけで silent OK |
| [tutor/page.tsx:277-278](../../app/tutor/page.tsx) | `response.json()` 失敗を `try/catch` で握って `data = null` に倒し、その後の `!res.ok` で error 文言を出す | 防御層として intentional |
| [self-pr/page.tsx](../../app/self-pr/page.tsx) 周辺 | `loadSelfPRs()` / saver 全般は localStorage 例外を try/catch で握る | safeStorage wrapper と整合 |

### 3.3 `alert()` / native dialog

- 全 caller を grep した結果、**runtime コードに `alert(` 呼び出しは 0 件**。
- [admission-matching/page.tsx](../../app/admission-matching/page.tsx) / [statement/edit/page.tsx](../../app/statement/edit/page.tsx) の `alert(` は **すべてコメント** 内（STEP-QA-FIX-01-MATCHING-ALERTS / STEP-UX-FIX-01-ALERT で inline banner / toast に置換済）。
- `confirm()` も `confirmDeletePR` 等は React state による `ConfirmDialog` 経由（ネイティブ confirm 不使用）。

### 3.4 `return null` / `return undefined` の swallow

- API caller では `if (!res.ok) { set*Error(...); return; }` のパターンが統一されており、**error を setState せずに silent return する経路は無い**。
- ただし [InterviewQuestionForm.tsx:221](../../app/interview/questions/components/InterviewQuestionForm.tsx) は `applyFallback()` を呼ぶため厳密には silent return ではないが、UX 上は silent fail と等価。

---

## 4. Priority 分類

### Priority A（リリース前に検討すべき）

**release blocker ではない** が、UX 上「AI が失敗した」がユーザーに伝わらない経路を release notes / known issue として記録するか、軽量に明示化したい。

| # | 箇所 | A4 / A5 後の status | 残タスク |
|---|---|---|---|
| A-1 | [InterviewQuestionForm.tsx:221](../../app/interview/questions/components/InterviewQuestionForm.tsx) `catch { applyFallback() }` | **解消（誤判定）**。A3 初版で silent と判定したが、既存の `<FallbackNotice />` で amber notice を inline 表示する経路が初版時点で存在していた。A4 で文言を「練習はこのまま続けられます」を含む安心文言に更新し、`role="status" aria-live="polite"` 明示 | 手動 fail 再現での視認確認のみ ([smoke test #33](../release/release_smoke_test_01.md)) |
| A-2 | [InterviewRecordForm.tsx:167](../../app/interview/record/components/InterviewRecordForm.tsx) `catch` 経路の silent local fallback | **解消（A4）**。`fallbackNotice` state + AlertBox variant="warning" で「AIフィードバックの生成に失敗したため、簡易フィードバックを表示しています。」を表示。fallback と保存フローは維持 | 手動 fail 再現での視認確認のみ ([smoke test #34](../release/release_smoke_test_01.md)) |

### Priority B（リリース後に整理）

| # | 箇所 | 提案（今回は実装しない） | リスク |
|---|---|---|---|
| B-1 | essay-practice / essay/improve / essay/structure / essay/write の `/api/essay-review` 4 caller | error 文言と cache 判定ロジックが 4 ファイルにコピペ。1 hook (`useEssayReview`) 抽出候補 | 1 文言の修正が 4 箇所に分散。リリース後の文言統一でリスク |
| B-2 | self-pr/page.tsx /api/reason | 構造化 error `data.message` を読まずに固定文言を表示 | 他 caller と error message の解像度が違う |
| B-3 | essay-practice handleChatSubmit `/api/essay-chat` / handleReviewEssay `/api/essay-review` に AbortController 未配線 | 既存 cancel 配線（matching / statement-review）と pattern を揃える | 長時間 fetch を user が中断できない |
| B-4 | /api/analysis (useWallHitting), /api/summarize, /api/essay-improve-summary 等の cancel 未配線 | 同上 | 同上 |
| B-5 | 13 個別 caller の error handling コピペ | `lib/api/fetchWithErrorHandling.ts` 共通化候補（[freeze.md](../release/freeze.md) §3 と整合し、リリース後の独立 STEP で扱う） | 1 文言修正が全 caller に波及する |

### Priority C（触らなくてよい / intentional）

| # | 箇所 | 理由 |
|---|---|---|
| C-1 | essay-practice / essay/improve の `console.warn` cache 保存失敗 | best-effort cache。次回 fetch で再生成可能 |
| C-2 | InterviewRecordForm `previousFeedback` load の swallow | 履歴読み込み失敗は AI 入力欠落として許容 |
| C-3 | tutor `response.json()` の try/catch 防御 | 5xx でボディが空のケースに対する intentional 防御 |
| C-4 | error 文言「通信エラーが発生しました。インターネット接続を確認してください。」固定 | 多くの caller で同一文言。release 後の文言統一 STEP（B-5）で扱う |
| C-5 | self-pr 系 localStorage 例外の try/catch swallow | safeStorage wrapper 経由で intentional |

---

## 5. 観測総括

### 5.1 統一されているもの（変えない）

- **server-side timeout**: 全 route が `createTimeoutSignal()` を使用（[`lib/aiTimeout.ts`](../../lib/aiTimeout.ts)）
- **server-side validation**: V-6 validators (`lib/validation/validate*Input.ts`) が AI 到達前に弾く構造
- **logAiCache / logAiUsage / logAiValidation**: observability 3 lane の contract は不変
- **構造化 error message の優先順位**: `data.message ?? data.error ?? 固定文言` パターンが essay 系 / interview-record で統一
- **cache miss path で AI 成功時のみ cache 保存** (`saveXxxCache` を try の最後で呼ぶ pattern)

### 5.2 ブレているもの（リリース後の整理候補）

- **client 側 cancel (AbortController)**: A-class 2 件 (matching / statement-review) のみ配線。他 16 caller は未配線
- **LoadingProgress (時間経過の sub-message rotate)**: A-class 2 件 + essay-practice の 1 件のみ採用。他は単純 spinner
- **error 文言の解像度**: tutor / essay 系は構造化 message を反映、self-pr / useWallHitting / summarize 等は固定文言寄り
- **silent fallback の有無**: interview 系 2 caller のみ採用。他は明示 error 表示

### 5.3 リリース blocker の有無

**release blocker は無い**:
- 全 caller で loading は明示される（spinner or LoadingProgress）
- 18 caller 中 16 で error は inline で表示される
- 残り 2 (interview 系) は silent fallback だが **動作自体は継続する**（deterministic / local fallback で代替結果が出る）
- native `alert()` / `confirm()` の残存は 0

A-1 / A-2 の silent fail は known issue として release notes に記録するか、リリース後の即時 STEP で扱うのが妥当。

---

## 6. 今回触らなかった改善案（次フェーズの候補）

すべて本 STEP のスコープ外（観察のみ）。次フェーズでは [`../release/freeze.md`](../release/freeze.md) §3 のグレーゾーン判定方針に沿って優先度を決める。

| 提案 | 対象 | 種別 |
|---|---|---|
| `useApiCall` / `fetchWithErrorHandling` hook 抽出 | 18 caller 全体 | refactor（共通化） |
| AbortController を全 caller に標準配線 | matching / statement-review 以外の 16 caller | UX 強化 |
| LoadingProgress を `>3 sec` の見込み caller に拡大 | essay-review (4 caller) / summarize / analysis | UX 強化 |
| 構造化 error message の helper 化 (`parseStatementReviewError` を generalize) | tutor / essay / interview-record | refactor |
| ~~silent fallback を「fallback 中であること」の non-blocking notice に変更~~ | ~~InterviewQuestionForm / InterviewRecordForm~~ | **A4 で完了** |
| retry button の標準化（現状は user が同じボタンを再押下） | 18 caller 全体 | UX 強化 |
| error 文言の中央集権化（`lib/i18n/errors.ts` 等） | 全 caller | refactor |
| `console.warn` ベースの best-effort 失敗を observability に統合 | essay workspace dual-write、cache 保存 | 観測強化 |

---

## 7. 関連 doc

- [`./ai_cache_observability.md`](./ai_cache_observability.md) — §6 が route × prompt × hash × version 対応表
- [`./ai_usage_observability.md`](./ai_usage_observability.md) — `logAiUsage` の status contract
- [`./ai_validation_observability.md`](./ai_validation_observability.md) — validation reject log contract
- [`./architecture_rules.md`](./architecture_rules.md) — client / server boundary
- [`./cleanup_phase_summary.md`](./cleanup_phase_summary.md) — STEP-UX-FIX-01..06 履歴（alert → toast、LoadingProgress 拡張、cancel 配線）
- [`../release/freeze.md`](../release/freeze.md) — リリース凍結境界（§1.2 で response schema は frozen）
- [`../release/release_qa_pass_01.md`](../release/release_qa_pass_01.md) — 静的 QA pass
- [`../release/release_smoke_test_01.md`](../release/release_smoke_test_01.md) — production build smoke test

---

## 8. 改訂履歴

- 2026-05-30: STEP-CODE-CLEANUP-A3 — 初版作成。18 caller × 9 列の inventory、A/B+/B/C 4 段階分類、silent fail 2 件（interview 系）の特定、Priority A/B/C の整理。code 不変、観察のみ。
- 2026-05-30: STEP-CODE-CLEANUP-A4 — Priority A-2 (InterviewRecordForm) を `fallbackNotice` state + AlertBox warning で可視化解消。A-1 (InterviewQuestionForm) は `<FallbackNotice />` 文言を「練習はこのまま続けられます」を含む安心文言に更新（mechanism 変更なし）。本 doc は変更せず。
- 2026-05-30: STEP-CODE-CLEANUP-A5 — A3 inventory の **InterviewQuestionForm 判定誤り** を訂正。A3 初版で C (silent) と判定したが、実態は初版時点から `<FallbackNotice />` で amber inline 表示する経路が存在していた（Preview コンポーネント側まで追わずに判定したのが原因）。§1 表 / §3.1 / §4 Priority A を訂正、§6 改善案の該当行を取消線表示。残タスクは smoke test #33 / #34 の手動 fail 再現に限定。
