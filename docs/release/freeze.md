# Release Freeze Boundary（リリース凍結境界一覧）

作成日: 2026-05-30（STEP-CODE-CLEANUP-A2）
status: **active**（リリース期間中、解除日未定）

---

## 0. このドキュメントの位置づけ

PASSAI のリリース前後で **触ってはいけない領域** を 1 ページに集約する index。各領域の詳細仕様は既存 doc に正本があり、本 doc は **「どこからどこまでが frozen か」「どの判断軸で gate するか」** を 1 枚で見せる役割を担う。

- 本 doc は **freeze 契約**。新規 PR 着手前に boundary に触れないかを判定する gate として参照する。
- 詳細仕様や runtime contract は本 doc に書き写さない。**参照のみ** に留め、正本側を直す → 本 doc は同期、の順で扱う。
- 本 doc は **runtime code を変更しない**。文言追記・参照修正のみ。

---

## 1. 凍結対象（"絶対に触らない方がいい" 領域）

リリース期間中、以下は **PR で直接的にも間接的にも変更しない**。

### 1.1 AI prompt 本文 / version 管理

| 対象 | 正本 | 触らない理由 |
|---|---|---|
| `lib/prompts/*.ts` の SYSTEM_PROMPT 文字列 | [`../principles/ai_policy.md`](../principles/ai_policy.md) / [`../principles/ai_cache_observability.md`](../principles/ai_cache_observability.md) §6 | 文言 1 文字の変更でも cache identity が崩れる。PROMPT_VERSION bump 漏れは silent corruption（KPI ログでしか検出不可）になる |
| `lib/statement/review/statementPrompt.ts` / `lib/interview/buildInterviewQuestionPrompt.ts` / `lib/tutor/tutorPrompt.ts` / `lib/matching/matchingPrompt.ts` / `lib/statement/prepare/statementPreparePrompt.ts` | 同上 §6.1 対応表 | feature 別ディレクトリに置かれた prompt も SYSTEM_PROMPT と等価。version 系列が違う route ごとに固有の bump rule が効く |
| `PROMPT_VERSION` / `*_MODEL` 定数 (`lib/hash/*.ts`, `lib/aiInputHash.ts`) | [`../principles/ai_cache_observability.md`](../principles/ai_cache_observability.md) §6.2 | 値変更は本番 cache 全 miss を引き起こす |
| hash 入力 shape (`hashAnalysisInput` 等) | 同上 | 入力 shape 変更も version bump 対象。bump せずに変えると同じ user で hit/miss が変わる |
| AI 出力の deterministic 整合性ルール（score 数値、totalScore と scores 合計） | [`../principles/ai_score_contract.md`](../principles/ai_score_contract.md) | score 矛盾解消はリリース後の別 STEP（v3 → v4 → v5 の経緯あり） |

### 1.2 cache identity / response schema

| 対象 | 正本 | 触らない理由 |
|---|---|---|
| AI route の response JSON schema (`/api/analysis` `/api/summarize` `/api/statement-review` `/api/essay-review` 等) | route handler + `lib/validation/*` | client パーサが固定 shape を前提。schema 変更 = client 全画面の再検証 |
| AI route の input body shape (`fetch('/api/...')` 側の body) | 同上 | hash 入力と body の intentional asymmetry を持つ route あり（`/api/statement-review` の `wallHittingResult` 等）。安易な「不要に見える field を消す」変更は禁止 |
| cache storage 形式（`lib/statementReviewCache.ts` / `lib/essayReviewCache.ts` / `lib/summarizeCache.ts` / `lib/aiMatchAdviceCache` 系） | [`../shared/localstorage_keys.md`](../shared/localstorage_keys.md) | hash と生成済み result を 1 key に同居する shape。形を変えると過去 cache が一斉 invalidate |

### 1.3 score 計算ロジック（deterministic layer）

| 対象 | 正本 | 触らない理由 |
|---|---|---|
| `lib/matching/calculateScore.ts` / `checkEligibility.ts` / `suggestUniversities.ts` | [`../matching/`](../matching/) 配下 | hash 入力に含まれるため値変更で過去結果が再現不可。AI prompt 側の reason narrative は別レイヤだが、deterministic score は freeze |
| `lib/interview/levelEvaluationHeuristic.ts` | [`../principles/deterministic_supplement_verification.md`](../principles/deterministic_supplement_verification.md) | interview-feedback の数値出力に直結 |
| `lib/structureAnalysis.ts` | 同上 | essay-review / statement-review が hash に取り込む。修正で過去 cache が崩れる |
| `lib/scoreRank/*` | [`../principles/ai_score_contract.md`](../principles/ai_score_contract.md) | rank 算出の deterministic レイヤ |

### 1.4 localStorage key / 保存形式

| 対象 | 正本 | 触らない理由 |
|---|---|---|
| 既存 key 名（`basicInfo` / `wallHittingResult` / `statementDraft` / `activityData` / `selfPRWorkspaces` / `essayWorkspaces` / `studentProfile` 等） | [`../shared/localstorage_keys.md`](../shared/localstorage_keys.md) | Phase1 では Supabase migration 未対応。key rename / 形式変更 = 既存ユーザーの保存データ消失 |
| 保存 payload の JSON shape | 同上 | 旧 shape を読む reader と新 shape を書く writer が分離する事故が起きやすい |
| `safeGetStorage` / `safeSetStorage` wrapper の振る舞い | [`../principles/architecture_rules.md`](../principles/architecture_rules.md) | SSR guard / try-catch / JSON.parse fallback の契約。直接 `localStorage.getItem` する例外は既知 10 件のみで、新規追加禁止 |

### 1.5 Supabase mirror write 関連

| 対象 | 正本 | 触らない理由 |
|---|---|---|
| `lib/supabase/mirror*.ts` の 4 mirror（studentProfile / basicInfo / diagnosis / activityData）と writer dispatch site | [`../supabase/phase1_boundary_freeze.md`](../supabase/phase1_boundary_freeze.md) §2-§7 | N=4 boundary 凍結。schema / hash strategy / PII pattern / trigger contract は feature-local 契約として固定 |
| mirror schema（payload shape, `MIRROR_TABLE` 定数, `onConflict` キー） | [`../supabase/schema_boundary_policy.md`](../supabase/schema_boundary_policy.md) | DB 不整合のリスク。Phase2 で再設計予定 |
| **新規 read path** (`supabase.from(...).select(...)`) の追加 | [`../supabase/client_boundary.md`](../supabase/client_boundary.md) | Phase1 では read path を一つも書かない契約 |
| 新規 mirror / 新規 abstraction の追加 | [`../supabase/phase1_boundary_freeze.md`](../supabase/phase1_boundary_freeze.md) §5-§6（Mirror Addition Gate / Abstraction Threshold Rule） | gate を満たさない追加は reject |

### 1.6 既存 UX フロー

| 対象 | 正本 | 触らない理由 |
|---|---|---|
| home → diagnosis → 各 feature の navigation 構成 | [`../ux/`](../ux/) 配下 | feature 間の状態引き継ぎ（`admissionMatchingInput` 等）を壊すと進捗判定が崩壊 |
| 進捗判定ロジック（home の「次に進む」ボタン表示判定など） | 同上 | localStorage の複数 key を AND 条件で読む構造。1 key の意味を変えると全画面影響 |
| 既存の loading bar / cancel button / confirm dialog / toast の発火条件 | [`../principles/cleanup_phase_summary.md`](../principles/cleanup_phase_summary.md) §8b | STEP-UX-FIX-01..06 で固定済み。alert → toast 等の標準化が完了している |

### 1.7 React Hydration / SSR pattern

| 対象 | 正本 | 触らない理由 |
|---|---|---|
| `useSyncExternalStore` による mount gate | [`../principles/cleanup_phase_summary.md`](../principles/cleanup_phase_summary.md) §5-A | SSR / CSR の hydration mismatch 対策として全 page で確立済み。「シンプル化」しようとすると割れる |
| storage restore の version-counter pattern | 同上 §5-C | useEffect + version counter で driven。同期更新を入れると無限ループ / stale read が出る |
| `'use client'` 境界（70 ファイル） | [`../principles/architecture_rules.md`](../principles/architecture_rules.md) | server / client の責務境界。`use client` 追加・削除はいずれも事故源 |
| render 中の `Date.now()` / `Math.random()` / `localStorage` 直呼び（既存箇所はすべて handler/useEffect 経由） | 同上 | render 中呼び出しは hydration mismatch の典型原因 |

### 1.8 既存保存データの読み込みロジック

| 対象 | 正本 | 触らない理由 |
|---|---|---|
| `lib/*Storage.ts` の reader 関数 | [`../shared/localstorage_keys.md`](../shared/localstorage_keys.md) | 旧形式 fallback / migration idempotency を含む。read 側の挙動変更で過去ユーザーが「白紙」状態に戻る |
| `getStudentProfileFromRequest` 等の server 側 fallback | [`../principles/student_profile_contract.md`](../principles/student_profile_contract.md) | canonical 不在ユーザに対する fallback chain。順序を変えると prompt 入力が変わる |
| migration コメント（例: `essayWorkspaceStorage.ts:67` の直 `localStorage.getItem`）と理由 | 各ファイル冒頭コメント | intentional な例外。意図を残すコメントを消すと将来「整理」されて壊れる |

---

## 2. 触ってよい変更（allowed in freeze window）

凍結中でも以下は安全に進められる。**ただし「副次的に §1 に触れていないか」** を PR セルフレビューで確認すること。

| 種別 | 例 |
|---|---|
| ドキュメント追加・更新 | `/docs/**` 配下の新規作成・追記・修正。runtime 仕様の **正本** を変えるときは正本側を先に直して本 doc を同期 |
| コメント修正 | 既存ロジックの説明改善、stale な日付・version 表記の修正 |
| typo 修正 | UI 文言の typo（ただし AI prompt 内文字列は除外: §1.1） |
| 明らかな stale コメント修正 | 例: [`app/api/interview-questions/route.ts:111`](../../app/api/interview-questions/route.ts) の `PROMPT_VERSION v4` → `v4 で導入された seed 機構` のような **挙動非依存** な書き換え |
| 未使用 import 削除 | linter で検出されたもの。**型の export 経路に含まれていないこと** を grep で確認してから削除 |
| UI に影響しない型補助 | `as const` / 既存型からの `Pick` / 内部 helper 関数の型注釈追加。**生成型が変わらない** こと |
| テスト・QA チェックリスト追加 | `docs/release/` `docs/qa/` 配下の手順書追加、`scripts/` の `--dry` モード追加 |
| observability ログの **追加** | 既存 contract（`logAiUsage` / `logAiCache`）を呼ぶだけの追加。新規 status 値や payload key の追加は禁止 |

---

## 3. グレーゾーンの判定方針

判断に迷う変更は以下のルールで gate する。

1. **同じ PR 内で「ついで」に §1 領域を触らない**。「ついで refactor」の許可基準は [`../principles/incremental_refactor_policy.md`](../principles/incremental_refactor_policy.md) §2 を参照。本 freeze 期間中は同 doc の閾値より **更に厳しく** 運用する。
2. **「変えても挙動は同じはず」を理由に変えない**。同じはずの runtime が同じ output を返す保証は cache identity / hash 一致を経由する。コードの「等価書き換え」が cache 上では非等価になる事故が起きやすい。
3. **`/docs` 側の正本を先に直して、code 側はリリース後の STEP に分離する**。本 STEP（CLEANUP-A1 / A2）と同じパターン。
4. **「触らない理由」が本 doc / 正本 doc に書かれていない領域を見つけたら**、まず本 doc に追記してから PR を起票する。判断軸を未文書化のまま個別 PR で決めない。

---

## 4. PR 前チェックリスト

リリース期間中の PR を出す前に、PR 作成者が自分で確認する。各項目は「No」なら **PR を見送る or 範囲を縮める**。

### 4.1 触ってよい変更しか含んでいないか

- [ ] §2 の allowed カテゴリにすべての変更が収まっているか
- [ ] 「ついで」に §1 領域を触っていないか（特に: prompt 文字列、PROMPT_VERSION、hash 入力、score 計算、localStorage key、mirror schema）
- [ ] UI 文言修正の場合、対象が **AI prompt 内の文字列ではない** ことを確認したか
- [ ] 削除する import が **型 re-export 経路に含まれていない** ことを grep で確認したか

### 4.2 既存 contract を破っていないか

- [ ] [`../principles/ai_cache_observability.md`](../principles/ai_cache_observability.md) §6.1 対応表のどの行にも該当する変更がないか
- [ ] [`../shared/localstorage_keys.md`](../shared/localstorage_keys.md) のどの key にも該当する変更がないか
- [ ] [`../supabase/phase1_boundary_freeze.md`](../supabase/phase1_boundary_freeze.md) §2 Inventory のどの行にも該当する変更がないか
- [ ] AI route の response / request shape に変更がないか
- [ ] `'use client'` の追加・削除が無いか（する場合は §1.7 を読み直す）

### 4.3 release smoke / QA との整合

- [ ] [`release_smoke_test_01.md`](./release_smoke_test_01.md) §7 観測項目に矛盾しないか
- [ ] [`release_qa_pass_01.md`](./release_qa_pass_01.md) §10 不変条件に矛盾しないか
- [ ] PR description に「触った領域」「触っていない領域」を明記したか

### 4.4 検証

- [ ] `npx tsc --noEmit` clean
- [ ] `npx eslint app components hooks` 0 errors / 0 warnings
- [ ] AI 関連の挙動変更を含む場合は **dry run** で再現確認したか（`scripts/**` の `--dry` モードを使う）

---

## 5. 関連 doc（参照先一覧）

凍結境界の **正本** は以下に分散している。本 doc は索引であり、矛盾を見つけたら正本側を先に修正する。

### 5.1 原則 / 契約

- [`../principles/ai_policy.md`](../principles/ai_policy.md) — AI の役割と禁止事項（代筆禁止 / 新事実創作禁止）
- [`../principles/ai_cache_observability.md`](../principles/ai_cache_observability.md) — §6 が route × prompt × hash × version 対応表の正本
- [`../principles/ai_score_contract.md`](../principles/ai_score_contract.md) — AI score 整合性契約
- [`../principles/ai_usage_observability.md`](../principles/ai_usage_observability.md) — `logAiUsage` contract（4 status 値）
- [`../principles/ai_validation_observability.md`](../principles/ai_validation_observability.md) — validation reject log contract
- [`../principles/architecture_rules.md`](../principles/architecture_rules.md) — storage / client / server boundary
- [`../principles/student_profile_contract.md`](../principles/student_profile_contract.md) — canonical artifact の生成と fallback
- [`../principles/incremental_refactor_policy.md`](../principles/incremental_refactor_policy.md) — 触っていい範囲の判断軸
- [`../principles/cleanup_phase_summary.md`](../principles/cleanup_phase_summary.md) — STEP 履歴と確立済み pattern
- [`../principles/feedback_dev_principles.md`](../principles/feedback_dev_principles.md) — 開発方針

### 5.2 Supabase 凍結（feature-local 契約）

- [`../supabase/phase1_boundary_freeze.md`](../supabase/phase1_boundary_freeze.md) — N=4 boundary 凍結（mirror inventory / addition gate）
- [`../supabase/client_boundary.md`](../supabase/client_boundary.md) — client / server 境界
- [`../supabase/schema_boundary_policy.md`](../supabase/schema_boundary_policy.md) — schema 凍結方針
- [`../supabase/mirror_observability.md`](../supabase/mirror_observability.md) — mirror 観測契約

### 5.3 storage / shared

- [`../shared/localstorage_keys.md`](../shared/localstorage_keys.md) — localStorage key 一覧（正本）
- [`../shared/ui_components.md`](../shared/ui_components.md) — 共通 UI コンポーネント一覧

### 5.4 release 運用

- [`release_smoke_test_01.md`](./release_smoke_test_01.md) — production build での smoke test 手順
- [`release_qa_pass_01.md`](./release_qa_pass_01.md) — static QA pass 報告
- [`release_smoke_test_results_template.md`](./release_smoke_test_results_template.md) — smoke 実施結果テンプレート
- [`real_user_test_observation_sheet.md`](./real_user_test_observation_sheet.md) — 実ユーザーテスト観察シート

---

## 6. 改訂履歴

- 2026-05-30: STEP-CODE-CLEANUP-A2 — 初版作成。§1 凍結対象 8 カテゴリ、§2 allowed 変更、§3 グレーゾーン判定、§4 PR チェックリスト、§5 参照先索引を集約。既存 doc への参照のみで内容は重複させない方針。
