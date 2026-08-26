# EXAM_SPINE_WAVE2_CONVERGENCE — Canonical Convergence 報告

- 実施日: 2026-08-26
- 担当: Claude A（Canonical Convergence / Governance）
- worktree: `/Users/yk/paid-app-spine-a` / branch `exam-spine-w1-convergence-v2`（base `647e4b9`）
- 前提: `EXAM_SPINE_CONVERGENCE_DECISION.md`（Wave 1 / commit `647e4b9`）
- 種別: contract 収束 + Stage 3 read projection 修正 + validation / readiness tooling。
  **Stage 4 runtime は実装しない**（revision / fingerprint / veto engine / consumer 移行はゼロ）。

---

## 0. Result

```text
RESULT        = PARTIAL
STAGE4_READY  = NO
HARD_BLOCKERS = 1   （E-H1 の authenticated SELECT policy 検証 / BLOCKED_BY_ENV）
CANON_CHANGE  = NONE
```

> **この §0 は Wave 2 実施時点（2026-08-26）の結果であり、書き換えない。**
> 残っていた R6 はその後 production SQL Editor で確認され、クローズした。
> 現在の readiness は **§14 POST-WAVE2 R6 VERIFICATION** を参照すること。

Wave 1 で 6 件挙げた Stage 4 blocker のうち **5 件を本 Wave で解消**し、残る 1 件は
本セッションから到達できない手段（本番 SQL Editor）を必要とする。

---

## 1. Wave 1 報告の矛盾訂正

Wave 1 の最終報告には次の矛盾があった。

```text
本文:      「当初リスト 6 件のうち real は 1 件だけ」
同じ表の REAL 欄: B1 / B7 / B8 / B9 / B10 / B11 の 6 件
```

**正しい読み方（実ファイル・実コードで再確認した結果）:**

```text
「当初提示された 6 項目（B1〜B6）のうち REAL_STAGE4_BLOCKER は B1 の 1 件だけ」
  B1 origin 単一値              REAL
  B2 BasicInfo.name             ALREADY_RESOLVED（E-P8）
  B3 diagnosis block            DEFER（Stage 5/6）
  B4 authority verification     NOT_BLOCKER（Stage 4 の成果物そのもの）
  B5 client wiring              NOT_BLOCKER（実装タスク）
  B6 dormant_no_author          ALREADY_RESOLVED（E-S16）

「Wave 1 で新規に発見した blocker が 5 件」
  B7 essay 丸ごと SELECT / B8 purpose gate 不在 / B9 path collision /
  B10 live schema 未検証 / B11 E-H1 残余

→ Wave 1 終了時点の hard blocker 総数 = 6（B1 + B7〜B11）
```

本文の「1 件」は **当初リストに対する内訳**、表の 6 件は **合計**であり、
どちらか一方が誤りなのではなく、2 つの数え方を区別せずに並記したことが誤りだった。
以後は「当初リスト内 REAL 数」と「hard blocker 総数」を必ず分けて書く。

Wave 2 終了時点の hard blocker 総数は **1**（§8）。

---

## 2. W2-1 — Decision Register convergence

### 2.1 探索結果（6 worktree すべての `EXAM_SPINE_DECISIONS.md`）

| worktree | branch | content sha256(12) | 行数 | ID 範囲 |
|---|---|---|---|---|
| `paid-app` | `feature/interview-realtime-step1` | `e306eb5cf3b3` | 527 | E-S14 / E-P7 まで ＋ **E-H2 = RESOLVED** |
| `paid-app-spine-a` | `exam-spine-w1-convergence-v2` | `c0b3a1064ad8` | 589 | E-S22 / E-P8 まで |
| `paid-app-spine-b` | `exam-spine-w1-sync-core-v2` | `c0b3a1064ad8` | 589 | 同上（a と同一内容） |
| `paid-app-spine-c` | `exam-spine-w1-consumer-map-v2` | `e306eb5cf3b3` | 527 | 同上（shipping と同一内容） |
| `paid-app-spine-stage1` | `exam-spine-stage1` | `10fd9909f3c2` | 477 | E-S14 / E-P7 まで |
| `paid-app-spine-stage3` | `exam-spine-stage3` | `c0b3a1064ad8` | 589 | E-S22 / E-P8 まで |

→ **3 種類**の Register が並存していた（Wave 1 は 2 種類と報告。stage1 系列を数え落としていた）。
いずれにも E-S23 以降・E-P9 以降は存在せず、**ID 衝突は無かった**。

並行 session（spine-b: sync primitives / spine-c: adversarial audit）は
いずれも Register を変更していない（`git log` で確認）。

### 2.2 E-H2 の再検証（報告を信用せず実コードで確認）

| 主張 | 検証手段 | 結果 |
|---|---|---|
| mirror の書き込みが server へ移設された | `app/api/mirrors/route.ts` の存在と export | ✅ `POST` のみ（GET / reader 無し） |
| browser が mirror table へ直接書かない | `lib` / `app` / `components` / `hooks` の `*_mirrors` 参照を全数 grep | ✅ 実参照は `lib/mirrors/mirrorKinds.ts` の kind→table map のみ。他はコメント |
| 4 helper が `/api/mirrors` 経由 | `lib/supabase/mirror{BasicInfo,ActivityData,Diagnosis,StudentProfile}.ts` → `lib/supabase/mirrorTransport.ts:42 fetch('/api/mirrors')` | ✅ browser Supabase client を import しない |
| server 側 writer が単一 | `lib/mirrors/mirrorWriteServer.ts`（唯一の consumer = `app/api/mirrors/route.ts`） | ✅ |

→ **E-H2 の RESOLVED は実コードで裏付けられる。** canonical Register へ統合した。

### 2.3 前回 draft の再判定（実コード再確認後）

| draft | 判定 | 変更点 |
|---|---|---|
| `E-S23` canonical lineage = L2 | **ACCEPT** | 根拠を 5 点に整理し、各点に実ファイル位置を付けた |
| `E-S24` rejected lineage の退避 | **REVISE → ACCEPT** | ① 移設先 path を確定（`lib/contextBuilders/tutor/serverRead/`）② `purpose.ts` は import 元 0 本の orphan なので**移設ではなく削除**に変更 ③ 受け入れ条件を DoD として明記 |
| `E-S25` Stage 2 凍結 | **REVISE → ACCEPT** | 「凍結 ≠ 完成」を明記。Stage 3 が読む 10 kind に対し **block を持つ kind は 4 件**しかないという Wave 2 の実測を decision 本文へ入れた |
| `E-S26` origin を kind / block 単位で持つ | **ACCEPT（実装済み）** | 単一値では不十分であることをコードで証明し、実装 + QA まで完了させた |
| `E-S27` essay field-level projection | **REVISE → ACCEPT（実装済み）** | Wave 1 は「shipping の `workspace->reviews` が salvage 対象」としていたが、**`ReviewEntry.essayBodySnapshot` があるため reviews に絞っても本文が流れる**ことが判明。query 絞り込み **＋** mapper 側の本文除去の 2 点セットに変更 |
| `E-P9` Register 未登録 contract を昇格させない | **ACCEPT** | 「Register は 1 本だけ」「採番は canonical の実ファイルから」を追記 |
| （新規）`E-S28` purpose gate | **新規 ACCEPT** | Wave 1 の B8 を decision 化。shipping の宣言をそのまま移植しなかった理由を実測付きで記録 |

### 2.4 canonical Register の最終状態

```text
E-L1 … E-L6      （6 / 連番）
E-S1 … E-S28     （28 / 連番）
E-P1 … E-P9      （9 / 連番）
E-H1 … E-H6      （6 / 連番）
重複 0 / 未定義参照 0
```

`scripts/exam-spine-readiness-check.ts` の R1 が毎回機械検証する。

---

## 3. W2-2 — Canonical purpose gate（E-S28）

### 3.1 何を作ったか

```text
EXAM_CONTEXT_REGISTRY[purpose].sources        readonly ExamSourceKind[]
EXAM_CONTEXT_REGISTRY[purpose].sourceEvidence kind ごとの実コード根拠（必須）

sourcesForPurpose(purpose)          未知 purpose は []（default deny）
purposeAllowsSource(purpose, kind)  未知は false
gateExamSourceKinds(purpose, req)   { allowed, denied } を返す純関数

readExamSources({ ..., purpose? })            許可外は query 0 本 / status='skipped'
readExamSourcesForRequest({ ..., purpose? })  gate は snapshot の **手前**
ExamReadResult.deniedByPurpose                enum のみ（PII なし）
```

### 3.2 canonical mapping（実コードから導出）

| purpose | allowed source kinds |
|---|---|
| `self_analysis` | basic_info, activity |
| `self_analysis_additional` | basic_info, activity |
| `summarize` | basic_info, activity |
| `statement_prepare` | basic_info |
| `statement_review` | basic_info, activity, self_analysis, statement_review, self_pr, interview_record |
| `essay_themes` | basic_info |
| `essay_review` | basic_info |
| `essay_chat` | basic_info |
| `essay_deep_questions` | basic_info |
| `essay_improve_summary` | basic_info |
| `interview_questions` | basic_info, activity, self_analysis |
| `interview_feedback` | basic_info, activity, self_analysis, statement_review, self_pr, interview_record |
| `interview_ai` | self_analysis, activity, statement_review, essay, interview_record |
| `presentation_feedback` | presentation |
| `matching` | basic_info, activity, self_analysis |
| `self_pr` | activity, self_analysis, self_pr, statement_review, interview_record |
| `tutor` | basic_info, self_analysis, diagnosis, activity, interview_ai, presentation, statement_review, essay, interview_record |

kind 別の被参照 purpose 数:
`basic_info:14 activity:10 self_analysis:7 statement_review:5 interview_record:5 self_pr:3 essay:2 presentation:2 diagnosis:1 interview_ai:1`

### 3.3 shipping の `purpose.ts` を authority にしなかった理由（実測）

```text
shipping: interviewAi.sources = ['basic_info','self_analysis','statement_review','essay']
          provenance「app/api/interview-ai/** は basicInfo / studentProfile / activityData を参照しない」

実測    : app/interview/ai/sourceData.ts:19-23 が client 側で 5 feature を集約
          loadWallHittingResult / loadActivityData / loadDraft+loadReviewHistory /
          loadEssayWorkspaces / getInterviewRecords
          → basic_info は使っていない（over-declaration）
          → activity / interview_record が欠落（under-declaration）
```

route の body field 名ではなく、**その context を組み立てるために読まれている storage / table**
を根拠にした。同じ方法で 2 件の誤りを訂正した:

| purpose | Wave 1 までの理解 | 実測 |
|---|---|---|
| `essay_review` | previousOutputSummary（横断ログ）を受ける | `buildPreviousOutputSummary` の呼び出しは `app/statement/edit/page.tsx:482` と `app/interview/record/.../InterviewRecordForm.tsx:151` の **2 箇所のみ**。essay の client は送っていない → sources は `basic_info` のみ |
| `interview_feedback` の `previous_output_summary` | block registry 上は `sourceKind: 'statement_review'` | 実際は `getInterviewRecords()` 由来 → `interview_record`。**同じ block id でも purpose が違えば source kind が違う** |

→ この 2 例目が示すとおり、**block の `sourceKind` から purpose の sources を導出することはできない**。
purpose → kind を直接持つ設計にした理由がここにある。

### 3.4 QA

`scripts/exam-spine-stage3-check.ts`:

```text
S20  許可外 kind は executor へ到達しない（query 1 本のみ / slot null / queryCount 0）
S20b 未知 purpose は全 kind denied（query 0 本。basic_info すら読まない）
S20c gate は拡張しない（許可されていても要求外は読まない）／重複除去
S20d gate は snapshot の手前（許可外 kind は snapshot に入らず、別 purpose が拾えない）
S21  registry 内部整合（sources ⊆ 10 kind / evidence と 1:1 / 全 evidence が実体を持つ）
```

---

## 4. W2-3 — Essay projection（E-S27）

### 4.1 before / after

```text
before  columns: ['id','local_workspace_id','workspace','created_at','updated_at']
        mapEssayRow(row)                → workspace: asRecord(rec.workspace)  ← 素通し

after   columns: ['id','local_workspace_id','reviews:workspace->reviews','created_at','updated_at']
        mapEssayRow(row, limits)        → reviews: ExamEssayReviewServerRow[]（新しい順 / cap）
                                          readonly bodyOnServer: false
                                          reviewCount / reviewsTruncated
```

### 4.2 field 判定

| 区分 | field | 根拠 |
|---|---|---|
| **required** | `reviews[*].weakPoints` | 実在する唯一の consumer（`lib/contextBuilders/tutorContext.ts:projectEssay`）が使う |
| **required** | `id` / `local_workspace_id` / `created_at` / `updated_at` | identity と ordering（`updated_at DESC, created_at DESC, id DESC`） |
| **optional（採る）** | `reviews[*].{totalScore, verdict, improvement, goodPoints, createdAt, source, parseError}` | Stage 4 の divergence / 信頼度判定の材料。いずれも短い scalar / 配列で bounded |
| **forbidden** | `workspace.body` | 小論文本文（正本）。Canon §55 / §56 / E-P5 |
| **forbidden** | `reviews[*].essayBodySnapshot` | 本文の複製。**reviews に絞っても残るため mapper で落とす** |
| **forbidden** | `workspace.improvementInProgress.rewriteDraft` / `workspace.sparring.answers[]` | 本人の本文 |
| **unnecessary** | `reviews[*].breakdown` / `sourceIssueId` | 現時点で consumer が無い。必要になった時点で足す |

### 4.3 payload の変化

```text
before  1 行 = EssayWorkspace 全体
          body 1 本 ＋ essayBodySnapshot 最大 20 本 ＋ rewriteDraft ＋ sparring answers
        × cap 5 + 1 行

after   bundle に載るのは reviews の bounded projection のみ
          文字列は shortText(200) / longText(4000) / arrayItems(20) × arrayItemLength(400) で上限つき
          review 件数は recordItems(10) で cap、元件数は reviewCount に保持
        → **本文は 1 文字も bundle に載らない**（S15b/S15c で機械検証）
```

### 4.4 null behavior / backward compatibility

```text
reviews が null            → []（throw しない）
`->` が text で返る        → JSON.parse を試み、失敗すれば []
reviews が配列でない       → []
review が object でない    → その要素だけ skip
どの場合も kind status は 'ok'（fail-open は「減らす」だけ）
```

`ExamSourceBundle.essayWorkspaces` の slot 型は `readonly unknown[] | null` のままなので、
bundle contract の破壊的変更は無い。

### 4.5 残余（意図的に受け入れる）

`workspace->reviews` は PostgREST 上では `essayBodySnapshot` を含んだまま転送される
（jsonb の sub-field を除外する PostgREST 表現が無い）。**bundle には載らない**が network 転送は残る。
消すには生成列か正規化 table が必要で DB migration を伴うため、本 Stage の範囲外とした。

---

## 5. W2-4 — Live PostgREST schema verification

**手段:** `scripts/exam-spine-live-schema-check.ts`（`npm run qa:examSpine:liveSchema`）
GET のみ / anon key のみ / 全 query に `limit=0` を強制（**行データ取得ゼロ**）/ 値を出力しない。
select 文字列は production と同じ `formatSelect()` から生成する。

**negative control（先に判別力を立証）:**

```text
存在しない table   → 404 PGRST205
存在しない column  → 400 42703
存在しない order 列 → 400 42703
```

### 5.1 table / query 別の結果

| kind / query | table | 列数 | 判定 |
|---|---|---|---|
| basic_info | `basic_info_logs` | 5 | **VERIFIED** |
| activity | `activity_logs` | 5 | **VERIFIED** |
| diagnosis | `diagnosis_logs` | 5 | **VERIFIED** |
| self_analysis | `self_analysis_logs` | 8 | **VERIFIED** |
| statement_review | `statement_review_history` | 7 | **VERIFIED** |
| self_pr | `self_prs` | 8 | **VERIFIED** |
| essay | `essay_workspaces` | 5 | **VERIFIED**（列レベル。jsonb path は §5.2） |
| interview_record | `interview_practice_records` | 13 | **VERIFIED** |
| interview_ai | `interview_ai_results` + `interview_ai_sessions!inner` embed | 7 + 6 | **VERIFIED**（embed relation 込み） |
| presentation core | `presentation_results` | 7 | **VERIFIED** |
| presentation enrichment | `presentation_attempts` | 6 | **VERIFIED** |
| presentation enrichment | `presentation_sessions` | 9 | **VERIFIED** |

非読取列が本番に実在すること（「読んでいない」の主張が意味を持つこと）も確認:
`statement_review_history.essay` / `interview_practice_records.{questions_asked,my_answers}` /
`presentation_attempts.{transcript,storage_path}` / `presentation_sessions.script` — すべて 200。

### 5.2 UNVERIFIED（推測で PASS にしない / Canon §80）

| 項目 | 理由 |
|---|---|
| `essay` の `workspace->reviews` という **jsonb path** | PostgREST は jsonb の sub-path を検証しない。実測で `workspace->zzz_not_a_field` も **200** を返した。根拠は shipping production で同一 projection（`readLatestEssayReviewsRow`）が稼働している事実に依存する |
| `authenticated` role の SELECT policy | anon key では区別不能（§6） |
| UNIQUE / CHECK constraint / index / trigger / GRANT | `pg_catalog` へ到達できない。`supabase/exam_spine_rls_verification.sql` の §4〜§6 が担当 |
| column の型 / nullability の詳細 | OpenAPI root（`GET /rest/v1/`）が本 project では 401 を返すため取得できなかった。ただし Stage 3 mapper は全 field を `unknown` から guard 経由で narrow するため correctness 影響は無い |

**MISMATCH は 0 件。**

---

## 6. W2-5 — E-H1 残余（authenticated SELECT policy）

### 6.1 対象 4 kind の特定

Spine から **一度も authenticated SELECT が実行されたことがない** kind を実コードで特定した。

```text
判定基準: その table に対する .select( の runtime caller が存在するか
  self_prs                    lib/supabase/selfPRs.ts:list*             caller 0
  statement_review_history    lib/supabase/statementReviewHistory.ts    caller 0
  essay_workspaces            lib/supabase/essayWorkspaces.ts           caller 0
  interview_practice_records  lib/supabase/interviewPracticeRecords.ts  caller 0

  対照: self_analysis_logs は caller **あり**
        app/components/AuthProvider.tsx:201-202
          → restoreSelfAnalysisLogsOnce
          → hydrateSelfAnalysisLogs
          → listSelfAnalysisLogsFromSupabase
        （Canon §33 の Recovery path。AI Context の authority ではない）
```

shipping tutor の parity reader（`statement_review_history` / `essay_workspaces` /
`interview_practice_records`）は `includeParitySources: spineOnlyContext` でのみ実行され、
canary は default deny なので production では走っていない。`self_prs` はどの reader も読まない。

### 6.2 kind 別 verdict

| kind | table | authenticated SELECT 権限 | RLS enabled? | SELECT policy 実在? | policy 条件 | user isolation | reader 実行 role | 本番影響 | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `self_pr` | `self_prs` | GRANT あり（anon で 200 が返る＝権限拒否 42501 ではない） | **間接的に yes**（service_role では 15 行、anon では 0 行） | **UNVERIFIED** | schema.sql:1112-1116 は `FOR SELECT TO authenticated USING (auth.uid() = user_id)` | 宣言上は owner 限定 | anon key + cookie session（Postgres role `authenticated`） | policy が無ければ **200 + 0 行**で silent | **BLOCKED_BY_ENV** |
| `statement_review` | `statement_review_history` | 同上 | 同上（service_role 13 行 / anon 0 行） | **UNVERIFIED** | schema.sql:1221-1225 同形 | 同上 | 同上 | 同上 | **BLOCKED_BY_ENV** |
| `essay` | `essay_workspaces` | 同上 | 同上（service_role 10 行 / anon 0 行） | **UNVERIFIED** | schema.sql:1627-1631 同形 | 同上 | 同上 | 同上 | **BLOCKED_BY_ENV** |
| `interview_record` | `interview_practice_records` | 同上 | 本番 0 行のため行数からは判定不能 | **UNVERIFIED** | schema.sql:1751-1755 同形 | 同上 | 同上 | 同上 | **BLOCKED_BY_ENV** |

### 6.3 なぜ「service_role で読める」を解決扱いにしないか

Stage 3 canonical reader は `createSupabaseExamReadExecutor(client)` に
**authenticated user-scoped client**（anon key + cookie session）だけを受ける設計であり、
`lib/examSpine/**` に `service_role` 参照は 0 本（readiness R9 で機械検証）。
service_role は RLS を丸ごと迂回するため、そこで読めることは
`authenticated` role で読めることの証拠にならない（E-L4 / Canon §20）。

### 6.4 なぜ hard blocker なのか

```text
SELECT policy が無い場合、PostgREST は 403 ではなく 200 + 0 行を返す
  → Stage 3 reader は status='ok' / rows=[] として扱う
  → 「ユーザーにデータが無い」と構造的に区別できない（Canon §40 EMPTY ≠ UNREADABLE）
  → fail-open でも観測ログでも表面化しない
```

つまり **runtime では永久に検出できない**。だから out-of-band の確認が要る。

### 6.5 成果物

`supabase/exam_spine_rls_verification.sql`（**SELECT のみ / 143 行 / 本セッションでは未実行**）。
`pg_class.relrowsecurity` / `pg_policies` / `pg_constraint` / `pg_indexes` /
`information_schema.role_table_grants` を確認する。
**migration は作成していない**（policy は schema.sql 上は宣言済みであり、
必要なのは適用ではなく検証だから。検証の結果 policy が不在と判明した場合に初めて migration を起こす）。

---

## 7. W2-6 — Namespace / L1 relocation

### 7.1 実測した import graph（shipping worktree）

```text
lib/examSpine/types.ts               ← lib/contextBuilders/tutorContext.ts:84
lib/examSpine/read/reader.server.ts  ← lib/contextBuilders/tutorContext.ts:82
                                     ← scripts/exam-spine-live-source-check.ts:85（動的 import）
lib/examSpine/read/rowMappers.ts     ← lib/contextBuilders/tutorContext.ts:67
lib/examSpine/read/snapshot.server.ts ← lib/contextBuilders/tutorContext.ts:83
lib/examSpine/purpose.ts             ← （なし）★ orphan
```

→ 影響を受ける file は **2 本だけ**（`tutorContext.ts` と live-source-check script）。

### 7.2 relocation target（E-S24 で確定）

```text
lib/examSpine/read/reader.server.ts    → lib/contextBuilders/tutor/serverRead/reader.server.ts
lib/examSpine/read/rowMappers.ts       → lib/contextBuilders/tutor/serverRead/rowMappers.ts
lib/examSpine/read/snapshot.server.ts  → lib/contextBuilders/tutor/serverRead/snapshotCache.server.ts
lib/examSpine/types.ts（SourceState 系）→ lib/contextBuilders/tutor/serverRead/sourceState.ts
lib/examSpine/purpose.ts               → 削除（import 元 0 本）
```

`lib/contextBuilders/tutor/` は既存 directory であり、新しい top-level namespace を作らない。

### 7.3 safe to move now? → **NO（計画のみ freeze）**

理由は安全性ではなく **到達不能**である。

```text
canonical worktree（/Users/yk/paid-app-spine-a）には移設対象の 4 file が存在しない。
  base = exam-spine-stage3 であり、shipping の lib/examSpine/** を含まない。

移設は shipping worktree（/Users/yk/paid-app）で行う必要があるが、
  - 本セッションの禁止事項「他 worktree の変更」に該当する
  - 当該 worktree は並行 session（spine-c / adversarial audit）が使用中である
```

したがって W2-6 は **計画確定まで**とし、実施は shipping worktree を担当する session に委ねる。
canonical namespace の側は既に条件を満たしている（readiness R2 / R7 が PASS）:
canonical lineage の `lib/examSpine/**` に旧 lineage の `reader.server.ts` /
`snapshot.server.ts` / `SourceState` 契約は 1 つも存在しない。

### 7.4 migration order と削除条件

```text
順序:
  1. shipping worktree で 4 file を移設 + import 書き換え（挙動不変）
  2. tutor QA 4 本 + tsc が無改変で PASS することを確認 → commit
  3. canonical lineage の lib/examSpine/** を shipping へ載せる（追加のみ / import 元 0 本）
  4. Stage 4 以降で tutor を canonical reader へ段階移行
  5. production 検証後に legacy（serverRead/）を削除

削除条件（Canon §46）:
  - canonical reader 経由の tutor が production で検証済み
  - tutor loader / composition fixture が canonical 経路で再録され PASS
  - 旧 path への import が repo 全体で 0 本
```

---

## 8. W2-7 — Origin model contract（E-S26）

### 8.1 単一 origin では不十分であることの証明

```text
変更前 lib/examSpine/blocks/build.ts
  const origin = input.origin ?? 'bridge';
  return EXAM_CONTEXT_BLOCK_IDS.map((id) => createExamContextBlock(id, meta, contents[id], origin));

  → block 型は origin: ExamContextOrigin を持つが、build 経路が全 35 block に
    同一値をコピーするため、block ごとに異なる origin を持てなかった。
```

実際に同時成立する 3 origin（いずれも実コード由来）:

```text
basic_info      server              tutor は既に server で読んでいる（runBasicInfoUnit）
activity        bridge              server 経路はあるが canary OFF なら body 由来
statementDraft  not_server_capable  durable table が存在しない（E-P3 で恒久据え置き）
```

Canon §17 は暗黙的 Mixed-Origin を禁止し、§68 は mixed-origin の追跡可能性を要求する。
E-P7（server が空で bridge に中身があれば bridge を維持）は **per-field の判断**を要求する。
→ 単一値では移行期の実態を表現できない。**証明成立。**

### 8.2 確定した contract（型境界まで。Stage 4 Context object は作らない）

```ts
ExamContextInput.origin?: ExamContextOrigin                                  // fallback へ降格
ExamContextInput.origins?: Partial<Record<ExamSourceKind, ExamContextOrigin>> // kind 単位
ExamContextInput.notServerCapableSlots?: readonly ExamNotServerCapableSlot[]  // durable source 無し
```

解決順序（`resolveBlockOrigin`）:

```text
1. block が notServerCapableSlots に挙がった slot 由来 → 'not_server_capable'
2. block の sourceKind に origins の申告がある        → その値
3. それ以外                                           → input.origin（既定 'bridge'）
```

**推測しない。** 申告の無い kind を「server 経路があるはずだから server」と補完しない。

### 8.3 QA（`scripts/exam-spine-stage2-check.ts` E1〜E5）

```text
E1 kind ごとに異なる origin が block へ届く（server / bridge / not_server_capable）
E2 1 つの context に 3 origin が同時に存在できる
E3 origins 未指定なら従来どおり全 block 同一 origin（後方互換）
E4 origin を変えても block content は 1 byte も変わらない
E5 申告が無い kind を server に補完しない
```

byte-equivalence は 880 → **888 checks PASS**（既存 880 は無変更）。

---

## 9. Stage 4 Readiness Matrix

| gate | 内容 | 判定 | 根拠 |
|---|---|---|---|
| **R1** | Decision Register singular | **PASS** | 3 種類 → 1 本へ統合。E-H2 統合済み。E-L1-6 / E-S1-28 / E-P1-9 / E-H1-6 が連番・重複 0・未定義参照 0（readiness R1 が機械検証） |
| **R2** | canonical lineage singular | **PASS** | E-S23 で確定。canonical namespace に旧 lineage の contract 0（readiness R2） |
| **R3** | purpose gate defined | **PASS** | E-S28。17 purpose すべてに `sources` + `sourceEvidence`。default deny を S20b で検証 |
| **R4** | essay projection bounded | **PASS** | E-S27。bundle に本文が 1 文字も載らないことを S15b/S15c で検証。残余（network 転送）は §4.5 に明記 |
| **R5** | live schema verified | **PASS**（jsonb path のみ UNVERIFIED） | 12 query すべて 200。negative control 3 種成立。jsonb sub-path は PostgREST が検証しないため §5.2 に UNVERIFIED として分離 |
| **R6** | required authenticated reads proven | **BLOCKED_BY_ENV** | 4 kind の `authenticated` SELECT policy が未検証。本番 SQL Editor へ到達できない。§6 |
| **R7** | canonical namespace collision resolved/frozen | **DEFERRED_WITH_REASON** | canonical 側は PASS。shipping 側の移設は他 worktree のため実施不可。計画は E-S24 で freeze 済み。§7.3 |
| **R8** | Stage 2 contracts frozen | **PASS** | E-S25。888 checks PASS。production runtime からの import 0 本（readiness R8）。「凍結 ≠ 完成」は decision 本文に明記 |
| **R9** | Stage 3 reader contract frozen | **PASS** | 231 checks PASS。I/O 境界 1 file / insert-upsert-rpc 0 / service_role 0 / supabase client の値 import 0 / 全 query owner filter あり（readiness R9） |
| **R10** | no unresolved Canon contradiction | **PASS** | §10。Canon 本文の変更は不要。未解消は「implementation が追いついていない」側のみで、すべて Stage 4 以降の scope として登録済み |

```text
HARD_BLOCKERS = 1
  R6  E-H1 の authenticated SELECT policy 検証（BLOCKED_BY_ENV）
      閉じ方: supabase/exam_spine_rls_verification.sql を本番 SQL Editor で 1 回実行する

非 hard:
  R7  DEFERRED_WITH_REASON（他 worktree 担当。canonical 側は条件充足済み）
  R5  jsonb path のみ UNVERIFIED（shipping production の稼働実績で代替）
```

**STAGE4_READY = NO**（hard blocker が 0 でないため）。

---

## 10. Canon contradictions

```text
CANON_CHANGE_REQUIRED = NONE
```

Canon §60 が定める変更事由（前提が誤り / production behavior との矛盾 / security 問題 /
既存モデルで要件を表現できない）に該当する箇所は Wave 2 でも見つからなかった。

### 10.1 implementation が Canon に追いついていない項目（Stage 4 以降で解消）

| # | Canon | 現状 | 解消 Stage |
|---|---|---|---|
| C1 | §11 / §40 status（verified / mismatch / unclaimed / unreadable） | canonical は `ok`/`truncated`/`error`/`skipped` の 4 値。trust verdict は未実装 | Stage 4。**read status と trust verdict を 1 enum に混ぜないこと** |
| C2 | §17 mixed-origin | **Wave 2 で型は解消**（E-S26）。申告する側（loader）は Stage 4 | Stage 4 |
| C3 | §16 revision / fingerprint | 未実装 | Stage 4 |
| C4 | §18 context veto | 未実装。`ExamSourceReadOutcome` に veto 入力は揃っている | Stage 4 |
| C5 | §39 provenance | block 単位では実装済み。kind → block への伝播が無い | Stage 4〜5 |
| C6 | §36 / §69 consumer direct read | Spine 経路は違反 0。Spine 未移行の 15 route が body bridge のまま = E-S9 の structural bridge（移行途上の正常状態） | Stage 5〜7 |

### 10.2 Canon の適用範囲について確認した 2 件（矛盾ではない）

| # | 観測 | 判定 |
|---|---|---|
| A | `app/api/interview-ai/{turn,prefetch,complete,state}` が `service_role` で `interview_ai_sessions.target_ref` を SELECT し、`target_ref.sourceContext`（client が 5 feature から集約した受験データ要約・最大 6500 字）を AI 生成へ投入している（`lib/interviewAi/sessionGuard.ts:41` / `app/api/interview-ai/turn/route.ts:203,223,492` で確認） | **Canon §20 違反ではない**（§20 は Exam Spine の context read を対象とする。これは class 2 feature が自身の session 状態を読む write-path 側の経路であり、owner 判定は `sessionGuard.ts:56-58` で明示的に行われている）。ただし **同一 kind に 2 つの read authority model が併存**する状態であり、`SD-3` / `E-P5` 違反の既存負債として Stage 9 で廃止予定。**新規の Canon 矛盾としては登録しない** |
| B | `listSelfAnalysisLogsFromSupabase` が `AuthProvider.tsx:201-202` から到達し、mirror から localStorage canonical を書き戻す | **Canon §33（Recovery を通常 read と分ける）に適合**。明示 flag 付き 1 回限りの restore path であり、AI Context の authority ではない（`lib/examSpine/**` からの参照 0）。ただし `lib/repository/selfAnalysisLogRepository.ts:43,209` のコメント「未配線（誰も呼ばない）」は **stale**。Authority Matrix の記載更新を Stage 5 で行う |

### 10.3 doc drift

| # | 内容 | 状態 |
|---|---|---|
| D1 | Register の 3 系統分岐 | **解消**（§2） |
| D2 | `EXAM_SPINE_STATE.md` が「Stage 0 完了 / Stage 1 未着手」のまま | **解消**（本 Wave で更新） |
| D3 | `EXAM_SPINE_ARCHITECTURE.md` §12 の Stage 表 / §3 の dormant ラベル | **未解消**。ARCHITECTURE は「意図する不変条件」の文書であり Stage 進捗の正本ではないため、Stage 4 着手時にまとめて更新する |
| D4 | `EXAM_SPINE_STAGE3_READINESS_AUDIT.md` が shipping branch にのみ存在 | **未解消**。canonical へ持ち込むのは shipping 側の commit と同時が安全（§7.4 の順序 3） |
| D5 | audit §16 `U8`（Stage 3 の正本 worktree） | **解消**（E-S23） |
| D6 | audit §15 の worktree 境界警告 | **解消**（別 lineage の別実装であり境界侵犯ではなかった。path 衝突は E-S24 で対処） |
| D7 | `supabase/schema.sql` が 4 mirror の anon INSERT / UPDATE policy を宣言したまま | **未解消**。Spine 外の別 STEP（E-H2 の残余として記録済み） |
| D8 | `selfAnalysisLogRepository.ts:43,209` の「誰も呼ばない」コメントが stale | **未解消**（§10.2-B）。Stage 5 |

---

## 11. Files changed

```text
docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md      Register 統合 + E-S23〜E-S28 / E-P9 + E-H1 更新
docs/principles/exam_spine/EXAM_SPINE_STATE.md          Stage 状態を実態へ更新
docs/principles/exam_spine/EXAM_SPINE_WAVE2_CONVERGENCE.md  本ファイル（新規）

lib/examSpine/purpose.ts                 sources / sourceEvidence / purpose gate（E-S28）
lib/examSpine/orchestrator/input.ts      origins / notServerCapableSlots（E-S26）
lib/examSpine/blocks/build.ts            resolveBlockOrigin（E-S26）
lib/examSpine/read/queries.ts            essayQuery の field 単位 projection（E-S27）
lib/examSpine/read/rowMappers.ts         mapEssayRow の bounded projection（E-S27）
lib/examSpine/read/readSources.ts        purpose gate 配線 + deniedByPurpose（E-S28）
lib/examSpine/read/requestSnapshot.server.ts  gate を snapshot の手前へ（E-S28）

scripts/exam-spine-stage2-check.ts       mixed-origin QA（E1〜E5）
scripts/exam-spine-stage3-check.ts       essay QA（S15b/c/d）+ purpose gate QA（S20/b/c/d, S21）
scripts/fixtures/examSpineStage3.ts      essay fixture を reviews alias 形へ
scripts/exam-spine-live-schema-check.ts  新規（live PostgREST 検証 / read-only）
scripts/exam-spine-readiness-check.ts    新規（Stage 4 readiness の機械判定）
supabase/exam_spine_rls_verification.sql 新規（SELECT のみ / 未実行）
package.json                             QA script 2 本を追加（dependency 追加なし）
```

**production runtime（`app/**`）への変更は 0。** canonical lineage の `lib/examSpine/**` は
production から import 元 0 本（readiness R8 で機械検証）。

---

## 12. QA

| command | exit | 結果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | エラー 0 |
| `npm run qa:examSpine:stage1` | 0 | CHECK PASS |
| `npm run qa:examSpine:stage2` | 0 | **888 checks PASS**（既存 880 + mixed-origin 8） |
| `npm run qa:examSpine:stage3` | 0 | **231 checks PASS**（既存 180 + essay 20 + gate 31） |
| `npm run qa:examSpine:characterization` | 0 | CHECK PASS（Stage 0 baseline 不変） |
| `npm run qa:examSpine:liveSchema` | 0 | PASS（negative control 3 / query 12 / 非読取列 6 / 構造 3） |
| `npm run qa:examSpine:readiness` | 0 | **43 checks PASS** |

```text
AI API call     : 0
DB mutation     : 0（HTTP は GET のみ / limit=0 で行取得も 0）
network（QA）   : stage1/2/3 / characterization / readiness はすべて 0
                  liveSchema のみ意図的に GET を発行する
dependency 追加 : 0
```

---

## 13. Next

```text
NEXT_ACTION = Wave 2.x（R6 のみ）

supabase/exam_spine_rls_verification.sql を本番 SQL Editor で 1 回実行し、
4 kind（self_prs / statement_review_history / essay_workspaces /
interview_practice_records）の authenticated SELECT policy 実在を確認する。

  policy が実在した場合   → E-H1 を RESOLVED にして Stage 4 着手（HARD_BLOCKERS = 0）
  policy が不在だった場合 → migration を起こす（本 Wave では作成していない）

並行して実施できるもの（Stage 4 の blocker ではない）:
  - shipping worktree での E-S24 relocation（担当 session へ引き継ぎ）
  - D3 / D4 の doc 追随
```

---

## 14. POST-WAVE2 R6 VERIFICATION（追記 / 2026-08-26）

**本節は Wave 2 本文の事後訂正ではない。** §0 / §6 / §9 は実施時点の記録として
そのまま残し、その後に得られた production evidence を追記する。

### 14.1 実施内容

`supabase/exam_spine_rls_verification.sql` を **本番 Supabase の SQL Editor で実行**した
（実行者: human。本セッションからは SQL Editor へ到達できないため Wave 2 では未実施だった）。

### 14.2 evidence

E-H1 残余の 4 table すべてについて、次が確認された。

| table | `authenticated` SELECT grant | RLS enabled | SELECT policy | roles | cmd | qual |
|---|---|---|---|---|---|---|
| `self_prs` | YES | `true` | `self_prs owner select` | `{authenticated}` | `SELECT` | `(auth.uid() = user_id)` |
| `statement_review_history` | YES | `true` | `statement_review_history owner select` | `{authenticated}` | `SELECT` | `(auth.uid() = user_id)` |
| `essay_workspaces` | YES | `true` | `essay_workspaces owner select` | `{authenticated}` | `SELECT` | `(auth.uid() = user_id)` |
| `interview_practice_records` | YES | `true` | `interview_practice_records owner select` | `{authenticated}` | `SELECT` | `(auth.uid() = user_id)` |

→ 4 table とも **RLS 有効 ＋ owner 限定の authenticated SELECT policy が実在**する。
Stage 3 canonical reader（anon key + cookie session = Postgres role `authenticated`）は
これらを owner scope で読める。`service_role` は不要（E-L4 / Canon §20 を満たしたまま）。

§6.4 で述べた「policy 不在なら 200 + 0 行になり runtime では検出できない」という
silent failure のリスクは、**policy 実在が確認されたことで解消**した。

### 14.3 readiness の更新

```text
R6  required authenticated reads proven   BLOCKED_BY_ENV  →  PASS

HARD_BLOCKERS = 1 → 0
STAGE4_READY  = NO → YES
```

他の gate（R1〜R5 / R7〜R10）の判定は Wave 2 実施時点から変更なし。
R7（namespace collision）は `DEFERRED_WITH_REASON` のままで、Stage 4 の hard blocker ではない。

### 14.4 Register への反映

`E-H1` を `PENDING_HUMAN` → `RESOLVED` に更新した（本 evidence を decision 本文へ記録）。
`supabase/exam_spine_rls_verification.sql` は再検証用として保持する
（schema drift の再発時に同じ手順で確認できるようにするため）。
