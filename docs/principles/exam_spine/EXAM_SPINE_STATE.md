# PASSAI 受験版 — Exam Spine State

**Purpose:** 運用状態のスナップショット。
**Update rule:** 検証済み状態を変える slice の後に必ず更新する。**architecture をここに書き直さない。**
**Upstream reference:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_STATE.md`

---

# 1. Snapshot

| 項目 | 値 |
|---|---|
| Date | 2026-08-26 |
| Repository | `/Users/yk/paid-app` → `github.com/surf0427/PASSAI.git` |
| Branch | `feature/interview-realtime-step1` |
| Base HEAD（Stage 0 着手時） | `200b5a62f8287a55daf434a2f69c46a4296bc39d` |
| Supabase project | `oarzldvteiuyuwkdoauq` |
| 採用 architecture | 案E — Architecture Transplant + Exam Authority Model |

---

# 2. Stage

```text
現在地: Stage 0（Decision register + architecture docs + characterization baseline）完了
次:     Stage 1（types + purpose registry）未着手
```

## Stage 0 終了時点の保証

```text
runtime Spine implementation : NONE
production behavior change   : NONE
AI prompt change             : NONE
DB schema change             : NONE
env change                   : NONE
dependency change            : NONE
```

`app/**` / `lib/**` の runtime コードは 1 行も変更していない（`git diff HEAD --stat -- app/ lib/` が空）。

---

# 3. Implemented（Stage 0）

| 成果物 | 内容 |
|---|---|
| `docs/principles/exam_spine/EXAM_SPINE_ARCHITECTURE.md` | Mission / 3 層 / authority class / StudentProfile / fail-open / bridge 分類 / product boundary / 責務境界 / Stage 定義 / upstream 参照表 |
| `docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md` | `E-L1`〜`E-L6` / `E-S1`〜`E-S14` / `E-P1`〜`E-P7` / `E-H1`〜`E-H6` |
| `docs/principles/exam_spine/EXAM_SPINE_STATE.md` | 本ファイル |
| `scripts/exam-spine-characterization.ts` | 現行 builder 13 本 × fixture 6 種の snapshot（`--record` / `--check`） |
| `scripts/fixtures/examSpineCharacterization.ts` | 完全 synthetic fixture 定義 |
| `scripts/fixtures/exam-spine-characterization/*.json` | baseline snapshot 6 ファイル |
| `package.json` | QA script 2 本を追加（dependency 追加なし） |

---

# 4. Not Implemented（意図的・Stage 1 以降）

| 対象 | 予定 Stage |
|---|---|
| `lib/examSpine/types.ts`（Source kind / authority class） | Stage 1 |
| `lib/examSpine/purpose.ts`（purpose registry） | Stage 1 |
| `lib/examSpine/orchestrator.ts` | Stage 2 |
| `lib/examSpine/sourceData/rowMappers.ts` | Stage 3 |
| `lib/examSpine/sourceData/serverReader.server.ts` | Stage 3 |
| `lib/examSpine/sourceSync/*`（revision / signal / verdict） | Stage 4 |
| canary gate（env / runtime） | Stage 4 |
| `app/api/*/resolveContextInputs.ts` | Stage 5 |
| request-local snapshot（`WeakMap<Request>`） | Stage 4〜5 |
| observability counters | Stage 5 |
| StudentProfile の Layer 2 化 | Stage 8 |
| `interview_ai` の `sourceContext` 廃止 | Stage 9 |

## 恒久的に実装しない（Decision 済み）

| 対象 | Decision |
|---|---|
| Event Log / Aggregated Insight / Company Knowledge Base / consent subsystem | `E-P1` |
| `exam_personal_memory` テーブル（Layer 2 の DB 永続化 / write-back） | `E-P2` |
| `statement_drafts` テーブル | `E-P3` |
| CAREER との共通 package / submodule / monorepo / runtime 依存 | `E-L6` |

---

# 5. Canary Status

```text
env             : 未定義（Stage 0 では env を一切追加していない）
runtime gate    : 未実装
rollout scope   : N/A
allowlist       : N/A
denylist        : N/A
有効ユーザー数  : 0
```

Stage 4 で `EXAM_SPINE_*` 名前空間の env と gate を実装する。default deny（`E-S11`）。

---

# 6. Known Bridges

Stage 0 時点では **server 経路が 1 本も存在しない**ため、受験版の bridge は原則すべて `structural`（`E-S9`）。

| bridge | 経由 | 分類 | server 経路の予定 |
|---|---|---|---|
| `basicInfo` | body（11 route） | structural | Stage 3〜5 |
| `activityData` | body（7 route） | structural | Stage 3〜5 |
| `studentProfile` | body（6 route） | structural | Stage 8 |
| `wallHittingResult` | body（6 route） | structural | Stage 8 |
| `activitySummary` | body（interview-questions） | structural | Stage 7 |
| `statementReviewLatest` / `essayReviewLatest` / `interviewRecordLatest` / `interviewFeedbackLatest` / `mypageSummary` | body（tutor） | structural | Stage 6 |
| `statementDraft` | body（interview-questions / tutor） | **structural（恒久）** | 作らない（`E-P3`） |
| `sourceContext` | body → DB 凍結（interview-ai） | structural | Stage 9 で廃止 |

### 唯一の既存 server 経路

`lib/contextBuilders/tutorContext.ts` の `loadTutorStudentContext` / `loadTutorStudentContextCached`
（tutor 専用。6 source を `Promise.allSettled` で並列取得、60 秒 per-user cache、`sourceSummary` 付き）。
Stage 3 で Exam Spine の loader へ一般化する候補。

---

# 7. Known Structural Debt

| ID | 内容 | Decision |
|---|---|---|
| SD-1 | `statementDraft` に durable table が無く、`statement_review` purpose は server へ完全移行できない | `E-P3`（据え置き / 再判断 `E-H5`） |
| SD-2 | `analyzeState`（壁打ちセッション一時状態）に durable 経路が無い | 意図的（durable 化しない） |
| SD-3 | `interview_ai_sessions.target_ref.sourceContext` に client 組み立ての prompt 断片（最大 6000 字）が型・版なしで永続化されている | `E-P5` 違反の既存負債。Stage 9 で廃止 |
| SD-4 | `student_profile_mirrors` は `user_id` 列と SELECT policy を持たず、`StudentProfile` が durable に読み戻せない | `E-L5` で回避（`self_analysis_logs` から再構築） |
| SD-5 | `lib/buildBasicInfoPromptSection.ts` が氏名を prompt に入れる一方、DB 境界は氏名を strip しており方針が食い違う | `E-P4`（後続 Stage で解消） |
| SD-6 | shape guard が 3 系統重複（`tutorContext` / `tutorStudentContext` / `divergence/*`） | Stage 3 の `rowMappers` 集約で解消予定 |

---

# 8. Production Preconditions

Stage 3 以降（server reader が実際に Supabase を読む段階）に入る前に必要な前提。

| # | 前提 | 状態 |
|---|---|---|
| PP-1 | Layer 1 対象 table が本番に存在する | ✅ **検証済み**（§9 参照） |
| PP-2 | 各 table に `user_id` 列が存在する | ✅ 検証済み |
| PP-3 | auth-scoped table が anon から読めない（RLS が効いている） | ✅ 検証済み（12 table すべて 0 行） |
| PP-4 | RLS policy の定義内容が `supabase/schema.sql` と一致する | ⚠️ **未検証**（`E-H1`） |
| PP-5 | unique constraint / index が `supabase/schema.sql` と一致する | ⚠️ **未検証**（`E-H1`） |
| PP-6 | `*_mirrors` の anon 可読 drift への対応方針が決まっている | ⚠️ **未決**（`E-H2`。Spine はこれらを読まないため Stage をブロックしない） |

---

# 9. Production DDL Preflight（U1）

**実施日:** 2026-08-26 / **手段:** anon key（公開値）による PostgREST 経由の read-only 確認のみ。
**SQL 実行・DDL・migration・GRANT・policy 変更・write は一切行っていない。**

## 9.1 判定

```text
U1 = PARTIALLY_VERIFIED
```

## 9.2 検証できたこと

負のコントロールにより、この確認が意味を持つことを先に立証した。

| 負のコントロール | 結果 |
|---|---|
| 存在しない table を指定 | `PGRST205 Could not find the table 'public.zzz_not_a_table'` |
| 存在しない column を指定 | `42703 column basic_info_logs.zzz_not_a_col does not exist` |

その上で、対象 12 table すべてが **HTTP 200 + `user_id` 列の select 成功 + anon から 0 行**であった。

| table | 存在 | `user_id` 列 | anon 可読行数 |
|---|---|---|---|
| `basic_info_logs` | ✅ | ✅ | 0 |
| `activity_logs` | ✅ | ✅ | 0 |
| `diagnosis_logs` | ✅ | ✅ | 0 |
| `self_analysis_logs` | ✅ | ✅ | 0 |
| `statement_review_history` | ✅ | ✅ | 0 |
| `self_prs` | ✅ | ✅ | 0 |
| `essay_workspaces` | ✅ | ✅ | 0 |
| `interview_practice_records` | ✅ | ✅ | 0 |
| `interview_ai_sessions` | ✅ | ✅ | 0 |
| `interview_ai_results` | ✅ | ✅ | 0 |
| `presentation_results` | ✅ | ✅ | 0 |
| `presentation_attempts` | ✅ | ✅ | 0 |

→ **Stage 1〜5 で server read が可能な構造は揃っている**（PP-1〜PP-3）。

## 9.3 検証できていないこと

anon key では `pg_policies` / `pg_indexes` / `information_schema` を読めないため、次は未確認。

- RLS policy の **定義内容**（owner policy が `auth.uid() = user_id` になっているか）
- unique constraint（`basic_info_logs_user_unique` 等）
- index
- `supabase/schema.sql` との詳細 drift

→ `E-H1`（Human decision）。**Stage 3 以降の blocker**。

## 9.4 検出した drift（重要・Exam Spine とは独立の既存問題）

`supabase/schema.sql` は 4 つの `*_mirrors` テーブルについて "No SELECT policy by design" と宣言しているが、**本番では anon key で行が読める**。

```text
student_profile_mirrors : 21 行が anon から可読
basic_info_mirrors      : 10 行
activity_mirrors        :  6 行
diagnosis_mirrors       :  3 行
mirror_events           :  0 行
```

- anon key は client bundle に含まれる公開値であるため、これらの payload は事実上公開状態にある。
- `student_profile_mirrors.payload` は `StudentProfile`（summary / strengths / weaknesses / futureConnections / signatureEpisodes）を含む。
- 原因（RLS 自体が無効か、schema.sql に無い SELECT policy が存在するか）は anon key では特定できない。
- **本 drift は Stage 0 の変更で生じたものではない。** また Exam Spine はこれらの mirror を読まない（`E-L5`）。

→ `E-H2`（Human decision）。**Exam Spine の Stage はブロックしないが、独立した対応が必要**。

---

# 10. Unknowns

| ID | 内容 | Blocker |
|---|---|---|
| `E-H1` | RLS policy 定義 / constraint / index の検証手段 | **Stage 3** |
| `E-H2` | `*_mirrors` の anon 可読 drift への対応方針 | なし（独立対応） |
| `E-H3` | vitest 導入の再判断 | **Stage 5** |
| `E-H4` | Layer 2 永続化の再判断 | なし |
| `E-H5` | `statement_drafts` の要否 | なし |
| `E-H6` | CAREER との共通 package 化の再判断 | なし |

---

# 11. Characterization Baseline

| 項目 | 値 |
|---|---|
| script | `scripts/exam-spine-characterization.ts` |
| fixtures | 6（`F1`〜`F6`。**完全 synthetic**・実 PII なし） |
| builders | 13（すべて純関数・`server-only` 非依存） |
| snapshot 形式 | key ソート済み deterministic JSON（1 fixture = 1 ファイル） |
| snapshot 出力先 | `scripts/fixtures/exam-spine-characterization/` |
| AI API 呼び出し | **0**（`globalThis.fetch` trap + AI SDK module graph 検査で機械的に担保） |
| determinism | `--record` を 3 回連続実行し、全 snapshot の SHA-256 が完全一致 |
| `--check` | 2 回連続 PASS |

## 対象 builder（13 本）

| key | feature | source |
|---|---|---|
| `basicInfoPromptSection` | cross-cutting（11 route） | `lib/buildBasicInfoPromptSection.ts` |
| `subjectGradesPromptLines` | cross-cutting | `lib/buildBasicInfoPromptSection.ts` |
| `toStudentProfile` | self-analysis / summarize | `lib/studentProfile.ts` |
| `statementStudentProfileContext` | statement-review | `lib/contextBuilders/statementContext.ts` |
| `interviewStudentProfileContext` | interview-feedback | `lib/contextBuilders/interviewContext.ts` |
| `matchingStudentProfileContext` | matching | `lib/contextBuilders/matchingContext.ts` |
| `interviewQuestionMaterials` | interview-questions | `lib/interview/buildInterviewQuestionMaterials.ts` |
| `selfPRDraftSeed` | self-pr | `lib/buildSelfPRDraftSeed.ts` |
| `tutorStudentContext` | tutor（body 由来横断要約） | `lib/contextBuilders/tutorStudentContext.ts` |
| `tutorStudentContextSection` | tutor（SYSTEM block 2） | `lib/tutor/tutorPrompt.ts` |
| `divergencePreviousOutputSummary` | statement-review / interview-feedback | `lib/contextBuilders/divergence/buildPreviousOutputSummary.ts` |
| `divergenceUnusedExperience` | statement-review / interview-feedback / self-pr | `lib/contextBuilders/divergence/buildUnusedExperience.ts` |
| `divergenceThemeFrequency` | self-pr | `lib/contextBuilders/divergence/buildThemeFrequency.ts` |

## 対象外（理由つき）

| 対象 | 理由 | 追加予定 |
|---|---|---|
| `lib/contextBuilders/tutorContext.ts` の `buildTutorSupabaseContextSection` | 同一ファイルの Supabase server loader が `server-only` を transitively import するため、`tsx` から import できない | Stage 3（server reader を分離した時点） |

---

# 12. Rollback Position

Stage 0 の rollback は **2 commit の revert のみ**で完了する。

```text
revert commit 2  → scripts/exam-spine-characterization.ts / fixtures / package.json script が消える
revert commit 1  → docs/principles/exam_spine/ が消える
```

- production runtime への影響がゼロなので、rollback による挙動変化も無い。
- env / DB / dependency を変更していないため、コード以外の巻き戻し作業は不要。

---

# 13. Next Stage

## Stage 1 — types + purpose registry

| 項目 | 内容 |
|---|---|
| 作成 | `lib/examSpine/types.ts` / `purpose.ts` / `budget.ts` / `sourceData/types.ts` / `README.md` |
| 制約 | 既存ファイルを 0 変更。import 元ゼロ。runtime 挙動不変 |
| 内容 | `ExamSourceKind` 10 種 + `EXAM_SOURCE_AUTHORITY`（class 1 = 8 / class 2 = 2）。`EXAM_CONTEXT_REGISTRY` は**現行挙動をそのまま宣言**し、policy を強制しない |
| QA | `tsc --noEmit` / `npm run lint` / characterization `--check` が不変 |
| 追加 QA | CAREER 依存ゼロの静的 guard を `lib/examSpine/**` へ拡張 |
| commit | 2 |
| blocker | なし（`E-H1` は Stage 3 の blocker であり Stage 1 は進められる） |

## Stage 1 readiness

```text
READY
```
