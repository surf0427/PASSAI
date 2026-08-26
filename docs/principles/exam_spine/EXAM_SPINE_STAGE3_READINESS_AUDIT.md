# EXAM_SPINE_SOURCE_AUTHORITY_STAGE3_READINESS — 監査レポート

- 実施日: 2026-08-26
- 担当: Claude A（read-only audit セッション）
- worktree: `/Users/yk/paid-app` / branch `feature/interview-realtime-step1` / HEAD `b910d90`
- 種別: **監査のみ**。runtime / prompt / DB / RLS / localStorage を一切変更しない。
- 位置づけ: Stage 3（server reader / row mapper）実装前の source authority 確定。
  本ファイルは **Stage 1 の source registry（`lib/examSpine/types.ts`）を変更しない**。
  変更が必要と判断した項目は `PROPOSED_DOC_CHANGE` として §4 / §13 に提示するに留める。

関連: `EXAM_SPINE_ARCHITECTURE.md` / `EXAM_SPINE_DECISIONS.md` / `EXAM_SPINE_STATE.md`（いずれも本監査では無変更）

---

## 1. Result

**PARTIAL**

- 10 source kind の authority / write path / read path / row shape / ownership: **確定**
- `presentation_practice_records` の architecture verdict: **確定（C）**
- E-H1（production DDL 完全検証）: **PARTIAL** — table / column / type / nullability / default / PK / FK は
  live DB から実証。constraint（UNIQUE / CHECK）/ index / trigger / policy 定義 / grant は
  read-only 手段が無く **NOT_VERIFIED**（§5）。

E-H1 が完全に閉じないため PASS ではなく PARTIAL。ただし Stage 3 reader の設計に必要な情報は揃っている（§17）。

---

## 2. Worktree / Git

開始時の記録:

```
pwd                      /Users/yk/paid-app
git branch --show-current feature/interview-realtime-step1
git status --short        (clean)
git log -1 --oneline      b910d90 refactor(exam-spine): add core source contracts and purpose registry
```

監査中に **他セッション由来の untracked ファイルが本 worktree に出現**した（§15 参照）。
いずれも触っていない。

---

## 3. Source Authority Matrix

10 kind。すべて `supabase/schema.sql` / repository / route / helper を実 evidence とした。

### 3.1 一覧（authority / table / cardinality）

| kind | localStorage canonical key | durable table | 行モデル | natural key | Stage1 authority | 実コードとの整合 |
|---|---|---|---|---|---|---|
| `basic_info` | `basicFormData`<br>`lib/basicInfoStorage.ts:4` | `basic_info_logs` | 1 user 1 行 | `UNIQUE(user_id)` | device_canonical_mirrored | ✅ |
| `activity` | `activityFormData`<br>`lib/activityStorage.ts:9` | `activity_logs` | 1 user 1 行 | `UNIQUE(user_id)` | device_canonical_mirrored | ✅ |
| `diagnosis` | `passai_diagnosis_result`<br>`lib/diagnosisStorage.ts:27` | `diagnosis_logs` | 1 user 1 行 | `UNIQUE(user_id)` | device_canonical_mirrored | ✅ |
| `self_analysis` | `selfAnalysisLogs`<br>`lib/selfAnalysisLogStorage.ts:23` | `self_analysis_logs` | 履歴 many | `UNIQUE(user_id, summary_input_hash)` | device_canonical_mirrored | ✅ |
| `statement_review` | `statementReviewHistory`<br>`lib/statement/review/statementStorage.ts:40` | `statement_review_history` | 履歴 many | `UNIQUE(user_id, local_review_id)` | device_canonical_mirrored | ✅ |
| `self_pr` | `selfPRs`<br>`lib/selfPRStorage.ts:4` | `self_prs` | many（カード） | `UNIQUE(user_id, local_pr_id)` | device_canonical_mirrored | ✅ |
| `essay` | `essayWorkspaces`<br>`lib/essayWorkspaceStorage.ts:42` | `essay_workspaces` | many（LRU 10） | `UNIQUE(user_id, local_workspace_id)` | device_canonical_mirrored | ✅ |
| `interview_record` | `interview_records`<br>`lib/interviewRecordStorage.ts:4` | `interview_practice_records` | 履歴 many | `UNIQUE(user_id, local_record_id)` | device_canonical_mirrored | ✅ |
| `interview_ai` | （なし） | `interview_ai_sessions` (+ `interview_ai_results` / `_turns`) | session many | PK `id`, `UNIQUE(session_id)` on results | server_authoritative | ✅ |
| `presentation` | （なし。`presentation:university:v1` は setup 画面の一時受け渡しのみ） | `presentation_results` (+ `_attempts` / `_sessions`) | attempt many | PK `id`, `UNIQUE(attempt_id)` on results | server_authoritative | ✅ |

**Stage 1 の 10 kind 分類は、実コードと矛盾しない。** 修正提案なし。

### 3.2 write path（client → durable）

| kind | canonical mutation 起点 | mirror dispatch 起点 | 使用 client | delete 伝播 |
|---|---|---|---|---|
| `basic_info` | `app/input/basic/page.tsx:208 saveBasicInfo` | 同 `:218 dualWriteBasicInfoLog` | browser (authenticated) | 該当なし（snapshot 上書き） |
| `activity` | `hooks/useActivityForm.ts:89 saveActivityData`（autosave） | `:347 dualWriteActivityLog`（**submit 時のみ**） | browser | ❌ `handleReset` 非伝播 |
| `diagnosis` | `app/diagnosis/page.tsx:133` / `ExamDiagnosisFlow.tsx:89` | 同 `:142` / `:96` | browser | 該当なし |
| `self_analysis` | `lib/selfAnalysisLogStorage.ts persistSelfAnalysisLog` | `dualWriteSelfAnalysisLog` | browser | ❌ 未実装 |
| `statement_review` | `app/statement/edit/page.tsx:552` / `:629 saveReviewHistory` | 同 `:553` / `:630 mirrorStatementReview` | browser | ❌ delete / 10 件 cap 非伝播 |
| `self_pr` | `app/self-pr/page.tsx` state effect | `:400 dualWriteSelfPRsDelta({propagateDelete:false})` | browser | ❌ 明示的に無効 |
| `essay` | `lib/essayWorkspaceStorage.ts:108 upsertEssayWorkspace` | 同 `:117 mirrorHook`（storage 層に注入） | browser | ❌ LRU eviction 非伝播（意図的） |
| `interview_record` | `lib/interviewRecordStorage.ts addInterviewRecord` | `InterviewRecordForm.tsx:291 mirrorInterviewPracticeRecordOnce` | browser | ❌ `deleteInterviewRecord` 非伝播 |
| `interview_ai` | — | `app/api/interview-ai/**`（9 route） | **service_role** | server 管理 |
| `presentation` | — | `app/api/presentation/**`（8 route） | **service_role** | server 管理 |

初回一括同期は `app/components/AuthProvider.tsx`（`profileReady` 後の fire-and-forget）で
8 kind すべて `backfill*Once` が起動する（`:212`–`:356`）。

### 3.3 server read path（現状）

**現時点で server read を持つのは `lib/contextBuilders/tutorContext.ts` のみ**（purpose `tutor`）。
使用 client は `getServerSupabaseClient()`（**cookie ベースの user-scoped anon key client**。
service_role ではない）。

| kind | 現行 server read | 行 |
|---|---|---|
| `basic_info` / `activity` / `diagnosis` | `readSnapshotPayload()` → `.select('payload').eq('user_id').maybeSingle()` | `:212`–`:215` |
| `self_analysis` | `.select('analysis, summary, created_at').eq('user_id').order('created_at',desc).limit(1)` | `:239`–`:243` |
| `interview_ai` | `.from('interview_ai_sessions').select('created_at, interview_type, interview_ai_results(feedback)').eq('user_id').eq('status','completed').order('created_at',desc).limit(1)` | `:399`–`:404` |
| `presentation` | `.from('presentation_results').select('created_at, feedback, attempt_id').eq('user_id').order('created_at',desc).limit(1)` + enrichment `.from('presentation_attempts').select('presentation_sessions(...)').eq('id',attemptId).maybeSingle()` | `:480`–`:484`, `:540`–`:543` |
| `statement_review` / `self_pr` / `essay` / `interview_record` | **server read なし** | — |

`self_prs` / `statement_review_history` / `essay_workspaces` / `interview_practice_records` の
browser 側 `list*FromSupabase` はいずれも **どこからも呼ばれていない**（restore 未実装）。

---

## 4. `presentation_practice_records` Verdict

### Verdict: **C. DIFFERENT_MODEL_REQUIRED**

### 4.1 監査質問への回答（すべてコード実証）

| # | 質問 | 回答 | evidence |
|---|---|---|---|
| 1 | canonical client state は何か | **存在しない** | `lib/storage/README.md` の key 一覧に該当キーなし。`lib/**` の `*_KEY` 定数全列挙でも該当なし |
| 2 | localStorage key | **なし** | 同上 |
| 3 | client → API → table の write path | **API と table のみ存在。client が存在しない** | `app/api/presentation/practice-record/route.ts:34` が唯一の書き手。repo 全体 grep `practice-record` → route 自身と `docs/presentation/pr0_design.md` のみ。**caller ゼロ** |
| 4 | table → client の read/recovery path | **存在しない** | route は POST のみ。`lib/supabase/presentationPracticeRecords.ts` 不在、`lib/repository/presentationPracticeRecordRepository.ts` 不在 |
| 5 | `interview_record` と同じ class か | **違う** | §4.2 |
| 6 | `presentation_results/attempts` と lifecycle 独立か | **完全に独立** | FK なし。`session_id` / `attempt_id` を持たず、key は `(user_id, local_record_id)` のみ。AI 不使用・課金なし・録画なし（schema.sql §73） |
| 7 | 単一 `presentation` kind に統合すると authority ambiguity が出るか | **出る** | §4.3 |
| 8 | Stage 3 reader で別 mapper が必要か | **不要（読むべきでない）** | §4.4 |
| 9 | 第 11 kind `presentation_record` を追加すべきか | **今は追加すべきでない** | §4.4 |

補足（corroborating、決定的ではない）: production の service_role count は
`presentation_practice_records` = **0 行**（`interview_practice_records` も 0 行なので、
0 行だけでは未実装の証明にならない。決定的なのは caller ゼロ）。

### 4.2 `interview_record` との構造比較

| 観点 | `interview_record` | `presentation_practice_records` |
|---|---|---|
| localStorage canonical | ✅ `interview_records` | ❌ なし |
| storage 層 | ✅ `lib/interviewRecordStorage.ts` | ❌ なし |
| DB 境界 | ✅ `lib/supabase/interviewPracticeRecords.ts` | ❌ なし |
| repository | ✅ `lib/repository/interviewPracticeRecordRepository.ts` | ❌ なし |
| backfill | ✅ `AuthProvider.tsx:288` | ❌ なし |
| 書き込み主体 | browser authenticated client（owner RLS 経由） | **service_role**（route が owner を固定） |
| UI | ✅ `app/interview/record/` | ❌ `app/presentation/practice` 不在 |
| 実書き込み | ✅ 記録保存時に upsert | ❌ 発火経路ゼロ |

「同思想」と schema コメント（§73）は述べているが、**実装は同思想に到達していない**。
Stage 1 が `class 1 相当` と観測したのは schema コメントと DDL 形（owner 全 CRUD policy /
`UNIQUE(user_id, local_record_id)`）に基づくもので、**write path の実在を確認すると成立しない**。

### 4.3 統合すると壊れるもの

1. **authority class の矛盾**: `presentation` kind は `server_authoritative`（`EXAM_SOURCE_AUTHORITY`）。
   `presentation_practice_records` は将来 UI が載れば device canonical になる設計であり、
   同一 kind 内に 2 つの authority class が同居する。E-L2 / E-S3 は「Source-Sync 検証を
   kind 単位で切り替える」ため、kind 内に両方あると検証を適用も不適用もできない。
2. **row shape の非互換**: `presentation_results` は `feedback jsonb` / `categories jsonb`。
   `presentation_practice_records` は 14 本の自由記述 `text` 列。
   1 つの mapper で `unknown → typed` に落とせない。
3. **lifecycle の非互換**: 前者は session → attempt → result の連鎖で `created_at DESC` 最新 1 件。
   後者は独立行の履歴。latest-row rule が別物になる。

→ **B（KEEP_SINGLE_PRESENTATION_KIND）は不可。**

### 4.4 なぜ A（第 11 kind 追加）でもないか

`ExamSourceKind` に追加すると:

- `EXAM_SOURCE_AUTHORITY` に値を入れる必要があるが、
  `device_canonical_mirrored`（= device に canonical がある）でも
  `server_authoritative`（= server route が著者である）でもない。**著者が存在しない**。
  二値の `ExamSourceAuthorityClass` はこの状態を表現できない。
- `EXAM_SOURCE_PRIMARY_TABLE` に載せると Stage 3 reader の対象になるが、
  結果は恒久的に `absent`。`purpose.ts` の設計意図（「載っていない kind は query を発行しない
  = 常時全 table SELECT を構造的に防ぐ」）に反して、無意味な SELECT を 1 本増やす。

→ **A も現時点では不可。**

### 4.5 推奨アーキテクチャ

**Stage 3 では Spine の対象外とし、「schema は landed / author 不在」という第 3 の状態として
別レジストリに記録する。**

```
presentation_practice_records
  status: dormant_no_author
  reason: schema + RLS + POST route は landed。canonical storage / repository / UI が未実装で
          書き手が存在しない（route caller ゼロ）。
  action: ExamSourceKind に追加しない。Stage 3 reader は SELECT しない。
  revisit: 対人プレゼン記録 UI（docs/presentation/pr0_design.md §289 `/presentation/practice`）
           が実装された時点で再分類する。その時の write path が
             - browser authenticated client + localStorage canonical → device_canonical_mirrored
             - 現行 route（service_role）のまま + client canonical なし → server_authoritative
           のどちらになるかで class が決まる。設計より先に実装が決める。
```

### PROPOSED_DOC_CHANGE（coordinator 判断待ち。本監査では実施しない）

1. `EXAM_SPINE_ARCHITECTURE.md` §3（Source Authority Classes）に
   **`not_wired` / `dormant_no_author`** を「Spine 対象外テーブルの記録用ラベル」として追記する。
   `ExamSourceAuthorityClass`（型）には追加しない — Spine が読む kind の分類に混ぜないため。
2. `lib/examSpine/types.ts` の「ここに載っていない kind は Spine の対象外」コメント末尾に
   `presentation_practice_records`（著者不在の durable table）を、`*_mirrors` と同様の
   除外理由付きで 1 行追記する。
3. `EXAM_SPINE_DECISIONS.md` に決定として記録（例: `E-S14 presentation_practice_records は
   author 不在のため Spine 対象外`）。

いずれも Claude B 所有ファイルのため、本セッションでは変更していない。

---

## 5. Production DDL / E-H1

### **PARTIAL**

### 5.1 検証手段

read-only の PostgREST GET のみ（`GET /rest/v1/<table>?select=...&limit=0` と
`GET /rest/v1/` の OpenAPI）。**DDL / DML / policy 変更・行取得を一切行っていない**
（`limit=0` により行データは 1 件も取得していない）。
`psql` / `supabase` CLI は本環境に無く、SQL 実行経路は存在しない（`npx supabase` は
2.115.0 が入るが DB 接続情報が無い）。RPC も未公開（OpenAPI の `/rpc/*` パスゼロ）。

### 5.2 RESOLVED（live DB で実証）

**17 table すべて production に存在し、`schema.sql` 宣言どおりの列・型・nullability・default・PK・FK を持つ。**

| table | 存在 | 列一致 | anon 可読行数 | service_role 行数 |
|---|---|---|---|---|
| `basic_info_logs` | ✅ | ✅ 8/8 | 0 | 1 |
| `activity_logs` | ✅ | ✅ 8/8 | 0 | 1 |
| `diagnosis_logs` | ✅ | ✅ 8/8 | 0 | 1 |
| `self_analysis_logs` | ✅ | ✅ 13/13 | 0 | 11 |
| `self_prs` | ✅ | ✅ 11/11 | 0 | 15 |
| `statement_review_history` | ✅ | ✅ 10/10 | 0 | 13 |
| `essay_workspaces` | ✅ | ✅ 6/6 | 0 | 10 |
| `interview_practice_records` | ✅ | ✅ 19/19 | 0 | 0 |
| `interview_ai_sessions` | ✅ | ✅ 12/12 | 0 | 37 |
| `interview_ai_results` | ✅ | ✅ 8/8 | 0 | 1 |
| `interview_ai_turns` | ✅ | ✅ 8/8 | 0 | 57 |
| `presentation_sessions` | ✅ | ✅ 24/24 | 0 | 1 |
| `presentation_attempts` | ✅ | ✅ 13/13 | 0 | 2 |
| `presentation_results` | ✅ | ✅ 8/8 | 0 | 2 |
| `presentation_qa_turns` | ✅ | ✅ 8/8 | 0 | 0 |
| `presentation_qa_reviews` | ✅ | ✅ 8/8 | 0 | 6 |
| `presentation_practice_records` | ✅ | ✅ 20/20 | 0 | 0 |

追加で実証できたこと:

- **FK**: `interview_ai_results.session_id → interview_ai_sessions.id`、
  `interview_ai_turns.session_id → interview_ai_sessions.id`、
  `presentation_attempts.session_id → presentation_sessions.id`、
  `presentation_results.attempt_id → presentation_attempts.id`、
  `presentation_qa_turns.attempt_id`、`presentation_qa_reviews.attempt_id`
  はいずれも production に実在（OpenAPI の `<fk .../>` 注記）。
- **PK**: 全 table `id uuid default gen_random_uuid()` が `<pk/>`。
- **nullability / default**: `schema.sql` と完全一致。特に後追い migration 分
  （`presentation_sessions.material_*` / `theme_mode` / `generated_*` / `*_deleted_at`、
  `interview_ai_sessions.interview_type` / `source_type` / `source_id`、
  `presentation_results.qa_summary` / `final_report`）は **すべて適用済み**。
- **anon 露出**: 行を持つ 12 table すべてで anon count = 0。
  mirror security closure 後の状態が維持されている（Stage 3 の read は anon では通らない）。

### 5.3 NOT_VERIFIED（read-only では到達不能）

pg_catalog に触れられないため、以下は **コードから推測せず未検証のままとする**:

| 項目 | 状態 | 影響 |
|---|---|---|
| UNIQUE constraint（`UNIQUE(user_id)` / `UNIQUE(user_id, local_*)` / `UNIQUE(session_id)` / `UNIQUE(attempt_id)`） | NOT_VERIFIED | Stage 3 の `maybeSingle()` 前提（1 user 1 行）が破れると実行時 error。§8 参照 |
| 部分 unique index（`*_one_in_progress`） | NOT_VERIFIED | Stage 3 read には非影響（書き込み側の制約） |
| 通常 index（`presentation_sessions_user_created_idx` 等） | NOT_VERIFIED | 性能のみ。correctness 非影響 |
| trigger（`set_updated_at`） | NOT_VERIFIED | `updated_at` 順序に依存する selection rule を作るなら要検証 |
| CHECK constraint の内容（特に `interview_ai_sessions_source_check` に `'realtime'` が入っているか） | NOT_VERIFIED | production の column COMMENT は旧文言（`CHECK in (voice, text)`）のまま。migration が `DROP+ADD CONSTRAINT` のみで COMMENT を更新しないため **comment drift は期待どおり**であり、制約本体の状態は別問題。Stage 3 read には非影響 |
| RLS `relrowsecurity` フラグ | 間接的にのみ確認 | 行を持つ table で anon count=0 → anon には閉じている。ただし `authenticated` role に対する policy の実在は未検証 |
| `authenticated` role の SELECT policy 実在 | **NOT_VERIFIED** | **Stage 3 の主要リスク。§9 参照** |
| GRANT | NOT_VERIFIED | — |

### 5.4 E-H1 を閉じるために必要なもの

`supabase/mirror_select_exposure_check.sql` と同形の **SELECT のみ**の検証 SQL を
production SQL Editor で 1 回実行すること（人手）。確認すべきは:

```
pg_class.relrowsecurity          … 17 table すべて true か
pg_policies                      … 各 table の authenticated SELECT policy 実在と qual
pg_constraint (contype='u','c')  … UNIQUE / CHECK の実在と定義
pg_indexes                       … 部分 unique index の実在
pg_trigger                       … set_updated_at の実在
information_schema.role_table_grants … anon/authenticated の grant
```

本セッションでは SQL Editor を叩けないため実施しない。

---

## 6. Row Shape Findings

Stage 3 の rowMapper が `unknown` → typed に落とす際の実 shape。

### 6.1 `basic_info`

```
client canonical (types/basicInfo.ts BasicInfo)
  name: string          ← 必須
  grade, track, preferences[], overallGpa?, examTypes[], subjectGrades?
        ↓ lib/repository/basicInfoRepository.ts:dualWriteBasicInfoLog
mirror payload = BasicInfo 全体（無加工）
        ↓ lib/supabase/basicInfoLogs.ts:upsertBasicInfoLogToSupabase
        ↓ stripName()  ← ★ ここで delete rest.name
durable payload (basic_info_logs.payload jsonb)
  name を持たない BasicInfo
```

**失われるもの: `name` のみ。** 境界（`lib/supabase/basicInfoLogs.ts:58-64`）の責務として
除去されており、呼び出し側の消し忘れでは漏れない設計。

Stage 3 への含意:
- **`payload` を `BasicInfo` として型付けしてはいけない**（`name: string` 必須が満たせない）。
  `Omit<BasicInfo, 'name'>` 相当、かつ全 field を `unknown` から個別 narrow する。
- `restoreBasicInfoLogOnce`（`basicInfoRepository.ts:141`）は strip 済み payload を
  `saveBasicInfo` で LS に書き戻すため、**cross-device 復元後は端末の `name` も空になる**。
  これは既知の仕様（同ファイル `:119` コメント）。
- `dualWriteBasicInfoLog` は `isEmptyBasicInfo`（grade / track / preferences すべて空）なら
  **書かない**。`absent` は「未入力」だけでなく「grade も track も志望校も空」を含む。

### 6.2 `activity`

```
ActivityData（types/activity.ts:126）= 10 カテゴリの配列
  clubActivities / volunteerActivities / studyAbroadActivities / researchActivities /
  partTimeJobActivities / certificationActivities / contestActivities /
  readingActivities / hobbyActivities / otherActivities
        ↓ 無加工
activity_logs.payload jsonb
```

- strip なし。**narrative free-text（clubName / theme / description / achievement 等）が
  そのまま durable に入る**（`lib/supabase/README.md`: narrative-soft PII precedent）。
- `dualWriteActivityLog` は総件数 0 なら書かない。
- ⚠️ `schema.sql` §47 の COMMENT は「9 カテゴリ配列」と書いているが実体は **10 カテゴリ**。
  doc drift（Stage 3 の mapper は key を列挙せず `Object.values().filter(Array.isArray)` で
  数えるのが安全。tutorContext もそうしている）。

### 6.3 `diagnosis`

```
DiagnosisResult（lib/diagnosisStorage.ts:19）
  resultType: DiagnosisType | ExamType
  resultTitle: string        ← app 製固定文
  resultDescription: string  ← app 製固定文
  answers: number[]          ← 数値 index のみ
  createdAt: string
        ↓ 無加工
diagnosis_logs.payload jsonb
```

- **no-PII**（自由記述ゼロ）。strip 不要。
- ⚠️ `lib/supabase/diagnosisLogs.ts:36` の `SCHEMA_VERSION = "3"` に対し
  DDL default は `'1'`。既存行の `schema_version` は書き込み時期により `1` / `3` が混在しうる。
  **Stage 3 は `schema_version` で分岐しないこと**（payload shape は version 間で不変）。
- `dualWriteDiagnosisLog` は `answers` が空配列なら書かない。

### 6.4 `self_analysis`

3 つの localStorage state の関係（**別レーン**であることが重要）:

| state | key | 役割 | durable |
|---|---|---|---|
| `analyzeState` | `analyzeState` | 壁打ち **編集中バッファ**。step / 入力中 answers の autosave。単一エントリ | ❌ **なし** |
| `wallHittingResult` | `wallHittingResult` | 壁打ち **分析結果**（`WallHittingResult`）。単一 | ❌ 単体では無し |
| `selfAnalysisLogs` | `selfAnalysisLogs` | **完了済み履歴**。summary 確定時の immutable snapshot。複数 | ✅ `self_analysis_logs` |

`SelfAnalysisLog`（`types/selfAnalysisLog.ts`）→ 行マッピング（`lib/supabase/selfAnalysisLogs.ts:108-119`）:

| domain | column | 備考 |
|---|---|---|
| `id` | `local_log_id` (nullable) | 旧行は NULL → read は `local_log_id ?? id` にフォールバック（`:65`） |
| `summaryInputHash` | `summary_input_hash` | **conflict key**。legacy 救済値 `"legacy:v1"` が入りうる |
| `analysis` | `analysis` jsonb | = `WallHittingResult` |
| `displayedQuestions` / `answers` / `deepAnswers` | 同名 snake jsonb | |
| `freeMemo` | `free_memo` text | |
| `summary` | `summary` jsonb | = `SummaryResult` |

**structural bridge が必要になる理由**: 下流 feature が実際に読むのは
`analyzeState` でも `selfAnalysisLogs` でもなく **`studentProfile`**（`lib/studentProfileStorage.ts`）。
`studentProfile` に durable table は無い（`student_profile_mirrors` は `user_id` 列を持たない
匿名 sink）。ただし `lib/studentProfile.ts:36 toStudentProfile(wallHitting, options)` は
**`WallHittingResult` からの純粋導出**であり、`WallHittingResult` は
`self_analysis_logs.analysis` として server 側に存在する。
→ `studentProfile` は **新規 table 不要で server 側から再構成できる**（§11.1）。

### 6.5 `statement_review`

```
ReviewHistoryItem（lib/statement/review/statementStorage.ts）
  id / createdAt / university / faculty / department / essay / result
        ↓ lib/supabase/statementReviewHistory.ts:itemToRow
statement_review_history（列展開型。jsonb 一括ではない）
  local_review_id / university / faculty / department / essay(text) / result(jsonb)
```

| 観点 | 事実 |
|---|---|
| history semantics | append-only。1 添削 = 1 行。`inputHash` では dedup せず `id` を identity にする（同一 essay の再添削も別行） |
| latest semantics | **DB 側に latest の概念は無い**。LS 側は `[item, ...existing].slice(0,10)` の先頭が最新 |
| draft / review / result が同一 row か | **同一 row**。`essay`（= 添削に出した本文 snapshot）と `result`（AI 出力）が 1 行に同居。`statementDraft`（編集中の下書き）は**別 localStorage key で durable なし** |
| user-authored と AI-derived の混在 | **する**。§7 参照 |
| 不変性 | `ReviewHistoryItem` は作成後不変。アプリからの in-place update 経路なし |
| LS と DB の件数差 | LS は 10 件 cap、DB は無制限。**DB のほうが多くなりうる**（意図的） |

`result` = `StatementResult`（`types/statement.ts:6`）:
`overallScore` / `evaluations[]` / `strengths[]` / `weaknesses[]` / `actions[]` /
`partialRevision` / `checklist[]` — **全部 AI 出力**。

### 6.6 `self_pr`

```
SelfPR → self_prs（列展開）
  local_pr_id = SelfPR.id / pr_index = SelfPR.index / title / body = SelfPR.text /
  latest_result = SelfPR.latestResult / seed_input_hash（補助。dedup key ではない）
```

- `body`（本人入力）と `latest_result`（AI 生成結果）が **同一行に同居**。§7 参照。
- delta 検知は `selfPRChanged()`（`selfPRRepository.ts`）で updatedAt / title / text /
  latestResult / index / seedInputHash / createdAt の比較。
- `deleteSelfPRFromSupabase` は実在するが `propagateDelete:false` 固定で **呼ばれない**。

### 6.7 `essay`

`essay_workspaces.workspace` は **`EssayWorkspace` 全体を jsonb 丸ごと**（列展開なし）。

Claude B の判断「SourceKind 単位では provenance を表現できない」を **コードから再検証 → 支持する**。
理由: 1 つの jsonb の中に本人入力・AI 出力・system snapshot が field 単位で混在しており、
kind 単位（= table 単位）では境界を引けない。field 単位の内訳は §7.2。

### 6.8 `interview_record`

`interview_practice_records`（列展開）。`StoredInterviewRecord` の全 text field が
1:1 で列になる。特殊なのは `feedback_json`:

- LS では `feedbackJson: string`（JSON 文字列）
- DB では `feedback_json: jsonb`（`lib/supabase/interviewPracticeRecords.ts:parseFeedbackJson` で parse）
- **parse 失敗 / 欠落は `NULL` に倒す**（best-effort）。旧記録は NULL になりうる
- read 時は `JSON.stringify` で文字列に戻す（`rowToRecord`）

Stage 3 への含意: `feedback_json` は **nullable かつ shape 非保証**。
`InterviewFeedback`（`types/interview.ts:45`）として narrow する前に
`isInterviewFeedback` 相当の guard が必須。

### 6.9 `interview_ai`

3 table の役割分離:

| table | 内容 | provenance |
|---|---|---|
| `interview_ai_sessions` | セッション状態 / 課金冪等 flag / `target_ref` / `interview_type` | system_metadata（`target_ref` の一部は user 選択由来） |
| `interview_ai_results` | `feedback jsonb` = `InterviewFeedback` + 正規化列 `strengths[]` / `improvements[]` / `next_practice[]` | **ai_derived**（全体） |
| `interview_ai_turns` | 1 ターンの transcript（`role` question/answer, `content`） | question = ai_derived / **answer = user_authored（STT または直接入力）** |

**音声は保存しない**（schema §59 / §61）。

production 実測: sessions 37 / results 1 / turns 57。
**大半の session は result を持たない**。§8 の selection rule に直結する重要事実。

### 6.10 `presentation`

| table | 内容 | provenance |
|---|---|---|
| `presentation_sessions` | 大学 / 学部 / テーマ / `script` / 時間 / 資料メタ / `theme_mode` | **user_authored**（`script` は本人の原稿）。`generated_conditions` / `generated_questions` は `theme_mode='generated'` 時 **ai_derived** |
| `presentation_attempts` | `storage_path`（動画）/ `transcript`（STT 全文）/ `duration_sec` / `status` | transcript = user_authored の機械転写 |
| `presentation_results` | `feedback jsonb`（`PresentationFeedback`）/ `categories jsonb` / `qa_summary` / `final_report` | **ai_derived**（全体） |
| `presentation_qa_turns` | 発表後 Q&A の 1 ターン transcript | question = ai_derived / answer = user_authored |
| `presentation_qa_reviews` | 1 交換（`question` / `answer_text` / `review jsonb`） | question + review = ai_derived / `answer_text` = user_authored |

`PresentationFeedback`（`lib/presentation/feedbackTypes.ts:32`）:
`categories` / `overallComment` / `goodPoints[]` / `improvements[]` / `nextPractice[]` /
`materialFeedback?[]`。

### 6.11 `presentation_record`（第 11 kind 候補）

**提案しない**（§4）。参考として実 shape のみ記録:
`presentation_practice_records` は 14 本の自由記述 text 列
（`composition` / `persuasion` / `concreteness` / `delivery` / `qa_note` /
`good_points` / `improvements` / `next_task` ほか）+ `theme` / `partner` / `time_limit_sec`。
評価は **数値化しない**（schema §73）。production 0 行。

---

## 7. Provenance Findings

Stage 2 の block-level provenance 設計に向けた **field 単位の境界候補**。型実装はしない。

### 7.1 kind 単位で provenance が一意に決まるもの

| kind | provenance | 根拠 |
|---|---|---|
| `basic_info` | 全 field `user_authored`（+ `created_at`/`updated_at`/`schema_version`/`source_hash` が `system_metadata`） | フォーム入力のみ |
| `activity` | 同上 | フォーム入力のみ |
| `diagnosis` | `answers` = `user_authored`（選択 index）、`resultType`/`resultTitle`/`resultDescription` = `system_metadata`（**AI ではなく app 製固定文**）、`createdAt` = `system_metadata` | `lib/diagnosisStorage.ts` / schema §44 COMMENT |
| `interview_ai` | `interview_ai_results.*` = `ai_derived` / `interview_ai_turns` は role で分岐 | schema §59 / §61 |
| `presentation` | `presentation_results.*` = `ai_derived` / `presentation_sessions.script` = `user_authored` | §6.10 |

### 7.2 `essay` — field 単位の境界候補（最重要）

`essay_workspaces.workspace`（`types/essay.ts:133 EssayWorkspace`）:

**user_authored**

```
target.university / target.faculty / target.department / target.examType
mini.conclusion / mini.reasonOne / mini.reasonTwo
body                                        ← 小論文本文（正本）
improvementInProgress.works[*].answers[]    ← 深掘り質問への本人回答
improvementInProgress.rewriteDraft          ← 改善後の本人リライト本文
sparring.answers[]                          ← 壁打ちへの本人回答
```

**ai_derived**

```
theme.text / theme.type / theme.source / theme.reason   ← /api/essay-themes 出力（parseEssayThemes）
reviews[*].totalScore
reviews[*].verdict
reviews[*].breakdown[*].label / .score
reviews[*].improvement
reviews[*].goodPoints[] / .weakPoints[]
improvementInProgress.summary.summary
improvementInProgress.summary.focusPoints[] / .suggestedDirections[]
```

**system_metadata**

```
id / createdAt / updatedAt
reviews[*].createdAt
reviews[*].essayBodySnapshot          ← 本人 body の複製。原本は body。derived-copy として扱う
reviews[*].sourceIssueId
reviews[*].source ('ai'|'partial'|'fallback') / .parseError / .fallbackReason
improvementInProgress.summary.source / .parseError / .fallbackReason
improvementInProgress.works[*].issueId / .sourceReviewIndex / .axis / .startedAt
improvementInProgress.works[*].deepQuestions[]  ← ★ AI ではない。lib/essay/deepDiveQuestions.ts の
                                                   静的テンプレ snapshot（system-authored）
improvementInProgress.works[*].templateVersion
improvementInProgress.works[*].issueText        ← reviews 由来 AI 文言の snapshot（ai_derived の複製）
improvementInProgress.startedAt
sparring.questions[]                            ← lib/essay/sparringQuestions.ts のテンプレ snapshot
sparring.templateVersion / .startedAt
```

**Stage 2 設計への注意（コードから判明した非自明点）**:

1. `deepQuestions` / `sparring.questions` は **AI 出力ではなく静的テンプレ**。
   「質問だから AI」という素朴な分類は誤り。
2. `essayBodySnapshot` と `issueText` は **他 field の複製**。provenance は「原本と同じ」だが
   時点が違う。原本参照ではなく snapshot であることを block に持たせないと、
   「本人が後から書き換えた本文」と「添削時点の本文」を AI が混同する。
3. `theme` は AI 生成候補から本人が選ぶ形。**選択行為は user だが文言は AI**。
   `theme.source`（`'admission_policy' | 'fallback'` 等）が由来判別のヒントになる。
4. `source: 'fallback'` / `parseError: true` の review は **AI が正常出力していない**。
   provenance としては `ai_derived` だが信頼度が異なる。

### 7.3 その他の混在テーブル

| table | user_authored | ai_derived | 同一行か |
|---|---|---|---|
| `statement_review_history` | `essay` / `university` / `faculty` / `department` | `result` (jsonb 全体) | ✅ 同一行 |
| `self_prs` | `title` / `body` | `latest_result` | ✅ 同一行 |
| `interview_practice_records` | `my_answers` / `what_went_wrong` / `self_noted` / `questions_asked` / `feedback_received`（対人相手の言葉）/ `main_question` / `improvement_summary` | `feedback_json` | ✅ 同一行 |
| `presentation_qa_reviews` | `answer_text` | `question` / `review` | ✅ 同一行 |

→ **kind（= table）単位の provenance では 4 table + essay で表現不能。**
Stage 2 の block-level provenance は必須。

---

## 8. Latest-row / Ordering Rules

### 8.1 現存する selection rule（tutorContext。**Stage 3 はこれを踏襲すべき**）

| kind | rule | 行 |
|---|---|---|
| `basic_info` | `.eq('user_id', uid).maybeSingle()` — one-row-per-user | `tutorContext.ts:212-215` |
| `activity` | 同上 | 同上 |
| `diagnosis` | 同上 | 同上 |
| `self_analysis` | `.eq('user_id', uid).order('created_at', {ascending:false}).limit(1)` | `:239-243` |
| `interview_ai` | `.eq('user_id', uid).eq('status','completed').order('created_at',desc).limit(1)` + PostgREST embed `interview_ai_results(feedback)` | `:399-404` |
| `presentation` | `presentation_results` を `.eq('user_id', uid).order('created_at',desc).limit(1)`。enrichment は `presentation_attempts.eq('id', attempt_id).maybeSingle()` → embed `presentation_sessions(...)` | `:480-484`, `:540-543` |

### 8.2 `NO_EXISTING_SELECTION_RULE`

以下は **server 側の選択規則が存在しない**。Stage 3 で勝手に作らないこと。

| kind | 状態 | browser helper の order（**未使用**。参考値であって規則ではない） |
|---|---|---|
| `statement_review` | NO_EXISTING_SELECTION_RULE | `created_at DESC`（`statementReviewHistory.ts:145`） |
| `self_pr` | NO_EXISTING_SELECTION_RULE | `pr_index ASC, created_at ASC`（`selfPRs.ts:173-174`） |
| `essay` | NO_EXISTING_SELECTION_RULE | `updated_at DESC`（`essayWorkspaces.ts:127`） |
| `interview_record` | NO_EXISTING_SELECTION_RULE | `created_at DESC`（`interviewPracticeRecords.ts`） |
| `presentation_practice_records` | NO_EXISTING_SELECTION_RULE — read path 自体が無い | — |

`listSelfAnalysisLogsFromSupabase` のみ repository 経由で使われる（`hydrateSelfAnalysisLogs`）。

### 8.3 Stage 3 が承知すべき既知の弱点（**今回は直さない**）

1. **`interview_ai` の取りこぼし**: 「最新の completed session」を 1 件取り、
   その session に `interview_ai_results` が無ければ `{}` を返す（`tutorContext.ts:426-427`）。
   より古い session に result があっても拾わない。
   production 実測（sessions 37 / results 1）から **実害が出やすい形**。
   直すなら `interview_ai_results` 側を `created_at DESC` で引いて session を join する形になるが、
   これは既存 tutor の挙動変更なので Stage 3 の scope 外。**Stage 3 は現行 rule を踏襲し、
   変更提案は別 STEP に切ること。**
2. `presentation_results` は `status='evaluated'` で絞っていない（`attempts.status` は見ていない）。
   result 行が存在する = 評価済みなので実害は無いが、規則としては暗黙。
3. `basic_info` / `activity` / `diagnosis` の `maybeSingle()` は **`UNIQUE(user_id)` 前提**。
   §5.3 のとおり production の UNIQUE 実在は NOT_VERIFIED。
   万一 2 行あれば PostgREST は 406 を返し、reader は `unavailable` に倒れる
   （fail-open なので Spine 全体は壊れない）。

---

## 9. Auth / RLS / Ownership

### 9.1 client の種別と用途

| client | 実装 | key | 用途 |
|---|---|---|---|
| browser authenticated | `lib/supabase/browserClient.ts` | anon key + user session | 8 kind の mirror upsert / delete。RLS `auth.uid()=user_id` で閉じる |
| **server user-scoped** | `lib/supabase/serverClient.ts:getServerSupabaseClient()` | **anon key + cookie session**（`createServerClient` + `next/headers` cookies） | **tutorContext の全 read**。RLS が効く |
| service_role | `lib/supabase/serviceRoleClient.ts` | service role key、`server-only` + browser 構築時 throw | interview_ai / presentation の全書き込み、practice-record route |
| anon | — | anon key のみ | 実質不使用。production では対象 17 table すべて 0 行しか見えない（§5.2） |

### 9.2 ownership

`schema.sql` 上、Spine 対象 17 table すべてが `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` を持つ（production の OpenAPI でも `user_id` は全 table に NOT NULL で実在）。

policy の形は 2 種類:

| 方式 | 対象 | 判定 |
|---|---|---|
| owner 直接 | `basic_info_logs` / `activity_logs` / `diagnosis_logs` / `self_analysis_logs` / `self_prs` / `statement_review_history` / `essay_workspaces` / `interview_practice_records` / `interview_ai_sessions` / `presentation_sessions` / `presentation_attempts` / `presentation_results` / `presentation_qa_turns` / `presentation_qa_reviews` / `presentation_practice_records` | `auth.uid() = user_id` |
| EXISTS（親所有） | `interview_ai_results` / `interview_ai_turns` | `EXISTS(SELECT 1 FROM interview_ai_sessions s WHERE s.id = <t>.session_id AND s.user_id = auth.uid())` |

policy の CRUD 網羅は kind により異なる（`schema.sql` 実測）:

| table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| 8 mirror table（`basic_info_logs` … `interview_practice_records`） | ✅ | ✅ | ✅ | ✅ |
| `interview_ai_sessions` / `interview_ai_results` / `interview_ai_turns` | ✅ | ✅ | ✅ | ✅ |
| `presentation_sessions` | ✅ | ✅ | ✅ | ❌（server-only） |
| `presentation_attempts` / `presentation_results` / `presentation_qa_turns` / `presentation_qa_reviews` | ✅ のみ | ❌ | ❌ | ❌ |
| `presentation_practice_records` | ✅ | ✅ | ✅ | ✅ |

→ **Stage 3 が必要とするのは SELECT のみで、全 table に owner SELECT policy が宣言されている。**

### 9.3 service_role は必要か → **不要**

判断:

- Stage 3 reader が読む 10 kind の全 primary table + 補助 table に owner SELECT policy がある。
- 既存の唯一の server reader（tutorContext）は **すでに user-scoped client で全 kind を読めている**
  （production で tutor が動作している）。embed（`interview_ai_results(feedback)` /
  `presentation_sessions(...)`）も EXISTS / owner policy 配下で通っている。
- service_role を使うと RLS を丸ごとバイパスするため、reader の bug が
  **他ユーザーのデータ露出**に直結する。owner scope が構造的に保証されなくなる。

→ **Stage 3 は `authenticated user scoped read`（`getServerSupabaseClient()`、
route 側で auth 済 client を注入する既存パターン `tutorContext.ts:614`）を優先すべき。**
service_role を使う理由は現時点で 1 つも見つからない。

### 9.4 残る検証ギャップ

`authenticated` role に対する SELECT policy が **production に実在するか**は read-only では確認できない
（§5.3）。ただし tutor 機能が production で動作しており、その read path が
user-scoped client で `self_analysis_logs` / `basic_info_logs` / `activity_logs` /
`diagnosis_logs` / `interview_ai_sessions` / `interview_ai_results` /
`presentation_results` / `presentation_attempts` / `presentation_sessions` を読めている
という事実が、**この 9 table については間接証拠**になる。

未検証のまま残るのは `self_prs` / `statement_review_history` / `essay_workspaces` /
`interview_practice_records` の **authenticated SELECT policy**
（書き込みは動作しているので INSERT/UPDATE policy は実在すると分かるが、SELECT は
どこからも呼ばれていないため実行実績が無い）。

→ Stage 3 でこの 4 kind の read を wiring する際は、**最初の実測で 401/403 が出る可能性を
`unavailable` として fail-open で受けること**（型は既に `SourceState` で表現済み）。

---

## 10. Mirror Completeness

class 1（`device_canonical_mirrored`）8 kind について、
`canonical change → durable mirror write` が全 mutation path で成立するかを確認した。

### 10.1 MIRROR_GAP 一覧

| # | kind | gap | path | 影響 |
|---|---|---|---|---|
| G1 | `activity` | **autosave が mirror されない** | `hooks/useActivityForm.ts:89`（`activityData` 変更ごとの `saveActivityData`）に dispatch なし。mirror は `:347` の submit 時のみ | **最大の gap**。フォームに入力しただけで submit していないユーザーは durable が古い / 空 |
| G2 | `activity` | reset が伝播しない | `:93 clearActivityData`（`handleReset`） | LS 空 / DB 旧データ |
| G3 | `statement_review` | delete が伝播しない | `app/statement/score/page.tsx:105` / `app/statement/improve/page.tsx:76` | 本人が消した添削が DB に残る |
| G4 | `statement_review` | 10 件 cap eviction が伝播しない | `statementStorage.ts:saveReviewHistory` の `.slice(0,10)` | DB が LS より多い（意図的な利点） |
| G5 | `self_pr` | delete が伝播しない | `app/self-pr/page.tsx:404 propagateDelete:false` | 消したカードが DB に残る |
| G6 | `interview_record` | delete が伝播しない | `app/interview/history/.../InterviewHistoryClient.tsx:62`。`deleteInterviewPracticeRecordFromSupabase` は実装済みだが **caller ゼロ** | 同上 |
| G7 | `essay` | LRU 10 件 eviction が伝播しない | `essayWorkspaceStorage.ts:158 applyLruCap` | DB が LS より多い（意図的） |
| G8 | `essay` | legacy migration が hook を通らない | `essayWorkspaceStorage.ts:78-84`（`essayPracticeReview` → `essayWorkspaces` の初回移行）は `safeSetStorage` 直書きで `mirrorHook` を発火しない | `backfillEssayWorkspacesOnce` が同一セッションで後から拾えば救済されるが、**backfill flag が既に立っている user では取り残される** |
| G9 | `self_analysis` | delete が伝播しない | `lib/selfAnalysisLogStorage.ts` に削除経路があれば同様（削除 UI 未確認） | — |
| G10 | 全 8 kind | **mirror は「最新 canonical」ではなく「最後に dispatch できた canonical」** | 全 dispatch が fire-and-forget + `.catch(()=>{})`。userId 未確定時は skip し、その分は次回 backfill flag が既に立っていれば **永久に埋まらない** | — |
| G11 | `basic_info` / `activity` / `diagnosis` | 空判定でスキップ | `isEmptyBasicInfo` / `activityCount===0` / `isEmptyDiagnosis` | 「本人が全部消した」が durable に反映されない（旧値が残る） |

### 10.2 mirror が完全な path

- `basic_info`: `saveBasicInfo` の呼び出し元は `app/input/basic/page.tsx` 1 箇所のみで、
  同じ関数内で dualWrite する。**単一 mutation path で完結**（G11 を除き gap なし）。
  ※ `app/career/profile/profileStorage.ts:saveBasicInfo` は **別キー `careerBasicFormData`**
  （就活版）であり受験版 canonical ではない。Spine 対象外。
- `essay`: mirror hook を **storage 層（`upsertEssayWorkspace`）に注入**しており、
  create / edit / autosave / 添削結果保存 のすべてを 1 点で捕まえる。**8 kind 中もっとも完全**。
  G8 のみが例外。
- `statement_review` / `interview_record`: 作成経路は全て mirror される（delete のみ gap）。

### 10.3 Stage 3 への結論

> **`device_canonical_mirrored` 8 kind のどれについても、
> server で読んだ行を「その request を出した端末の canonical」と等値だと扱ってはいけない。**

特に:

- `activity`（G1）: **submit していない入力は server に存在しない**。
  「活動が 0 件」を server が観測しても、端末には入力途中のデータがある可能性が高い。
- `statement_review` / `self_pr` / `interview_record`（G3/G5/G6）: **本人が削除したデータを
  server は保持し続ける**。Spine が prompt に出すと「消したはずの情報を AI が知っている」
  という UX 事故になる。**Stage 3 の初期 wiring では latest 1 件に限定し、
  履歴を横断して出さないこと。**
- G10/G11: `absent` は「無い」ではなく「dispatch が届いていない / 空判定で skip された」も含む。
  `SOURCE_ABSENT` と `SOURCE_UNAVAILABLE` を prompt 上で同一視する E-S1 の方針は
  この観点からも正しい。

---

## 11. Structural Bridge Candidates

Stage 3 初期 wiring で `bridge`（server から復元できず body 経由で渡すしかない）に
なりうるデータ。

### 11.1 `studentProfile` — **bridge 不要（server 導出可能）**

| 観点 | 事実 |
|---|---|
| localStorage key | `studentProfile`（`lib/studentProfileStorage.ts:26`） |
| durable table | **なし**。`student_profile_mirrors` は `user_id` 列も owner SELECT policy も持たない匿名 sink（`schema.sql:22-33`） |
| なぜ server から復元できないか（従来の理解） | 上記のとおり匿名 sink だから |
| **本監査の発見** | `lib/studentProfile.ts:36 toStudentProfile(wallHitting, options)` は **`WallHittingResult` からの純粋導出**。`WallHittingResult` は `self_analysis_logs.analysis` として **server 側に owner RLS 付きで存在する** |
| 分類 | **`server`（導出）**。新規 durable mirror は不要 |
| 注意点 | `generatedAt`（`new Date().toISOString()`）と `sourceHash`（`extraSource` を含む）は再現できない。**profile の中身（summary / strengths / weaknesses / futureConnections / valueKeywords / signatureEpisodes）は完全に再現できるが、identity（hash / 生成時刻）は再現できない。** `docs/shared/localstorage_keys.md` が既に「`studentProfile.generatedAt` drift の完全解消は別 STEP」と記録している |

→ **推奨**: Stage 3 では `studentProfile` を kind として追加せず、
`self_analysis` kind の `analysis` から必要な field を読む。
`toStudentProfile` の再実行は Stage 3 では行わない（`generatedAt` が Spine を non-deterministic
にするため。E-L4 の純データ方針に反する）。

### 11.2 `analyzeState` — **`not_server_capable`。bridge のまま残す**

| 観点 | 事実 |
|---|---|
| key | `analyzeState`（`lib/analyzeStorage.ts:4`） |
| 中身 | `PersistedAnalyzeState`。step / 入力中 answers の autosave = **編集中バッファ** |
| durable | **なし** |
| なぜ復元できないか | durable table が存在しない。さらに **本質的に端末ローカルの UI 状態**（どの step にいるか、入力途中のテキスト）で、cross-device に持ち越す意味が薄い |
| durable mirror を追加すべきか | **すべきでない**。autosave（キーストローク単位）を mirror すると `activity` の G1 と同じ flood 問題が発生する。完了時の snapshot は既に `selfAnalysisLogs` → `self_analysis_logs` として durable 化されている（**役割分離が既に成立している**） |
| 分類 | **`not_server_capable`**。Spine の対象外のまま |

### 11.3 `statementDraft` — **`bridge`。durable 化は別 STEP**

| 観点 | 事実 |
|---|---|
| key | `statementDraft`（`lib/statement/review/statementStorage.ts:6`） |
| 中身 | `{ university, faculty, department, statementText }` = **本人が書いている志望理由書の下書き本文** |
| durable | **なし**。`statement_review_history.essay` は「添削に出した時点の snapshot」であり、下書きそのものではない |
| なぜ復元できないか | 添削を 1 度も実行していない下書きは server にまったく存在しない。添削済みでも、その後の編集は反映されない |
| body bridge の実績 | `app/api/interview-questions/route.ts:133-134` が `body.statementDraft` を受け取る |
| 分類 | **`bridge`**。Stage 3 では body 経由のまま |
| durable mirror を追加すべきか | **将来的には yes**（`interview` purpose が `statement_review` を読む設計になっている以上、下書き本文が server に無いのは片手落ち）。ただし **本 STEP では実装しない**。追加するなら `statement_review_history` とは別 table（1 user 1 行の snapshot 型、`basic_info_logs` と同形）が素直 |

### 11.4 その他の local-only state（すべて `not_server_capable` / Spine 対象外）

| key | 内容 | 分類 | 理由 |
|---|---|---|---|
| `wallHittingResult` | 壁打ち分析結果（単一） | `server`（`self_analysis_logs.analysis` に含まれる） | latest log の `analysis` が同一 shape |
| `*InputHash` 系 6 key | AI cache（`wallHitting` / `additionalQuestions` / `summarize` / `statementReview` / `essayReview` / `essayImproveSummary` / `interviewQuestions`） | `not_server_capable` | **cache only**。Spine が読む意味がない |
| `*Limit` / `*Usage` 系 | daily limit カウンタ | `not_server_capable` | 課金・quota は Spine の外（E-S10） |
| `statement_prepare_*` (3 key) | 志望理由書 整理メモ（入力 3 項目 / AI 出力 5 項目 / 深掘り回答） | `bridge` 候補 | durable なし。`statementReview` purpose の質に効きうるが本 STEP 対象外 |
| `statement_rewrite_memo` | 書き直し方針メモ | `bridge` 候補 | durable なし |
| `selfPR_draft` | 自己 PR 下書き（raw string） | `not_server_capable` | ページ間受け渡し用の一時値 |
| `admissionMatching*` / `matchingResult` / `matchingTimestamp` | マッチング入出力 cache | `not_server_capable` | cache only |
| `interviewDraft` | 面接記録フォーム入力途中 | `not_server_capable` | `analyzeState` と同性質 |
| `presentation:university:v1` | プレゼン大学選択の画面間受け渡し | `not_server_capable` | 一時値。確定値は `presentation_sessions` に入る |
| `essayPracticeData` / `essayPracticeReview` | legacy（rollback safety で維持） | `not_server_capable` | `essayWorkspaces` が正本 |
| `supabaseBackfill` | backfill flag | `not_server_capable` | 最適化用 flag |
| `tutorChatThreads` | チューター会話履歴 | `server`（`tutor_chat_*`） | Spine の 10 kind 外（会話履歴は purpose 側の責務） |

---

## 12. Stage 3 Reader Contract Proposal

**10 kind。`presentation_record` は追加しない（§4）。**
`authority` は Stage 1 の `EXAM_SOURCE_AUTHORITY` をそのまま踏襲する（変更提案なし）。
`fallback` は全 kind 共通で「例外・RLS 拒否・table 不存在は `SOURCE_UNAVAILABLE`、
行なし / 空判定は `SOURCE_ABSENT`、いずれも Spine 全体を失敗させない（E-S1）」。

```ts
basic_info:
  table:                 basic_info_logs
  readCardinality:       one            // UNIQUE(user_id)
  identity:              user_id = <authenticated uid>
  ordering:              none (maybeSingle)
  mapperInput:           row.payload (jsonb)
  expectedMissingFields: name（境界で strip。恒久的に不在）
                         grade / track / preferences / examTypes が空のケースは
                         そもそも書かれていない（isEmptyBasicInfo で skip）
  authority:             device_canonical_mirrored
  fallback:              row なし → absent

activity:
  table:                 activity_logs
  readCardinality:       one            // UNIQUE(user_id)
  identity:              user_id = uid
  ordering:              none (maybeSingle)
  mapperInput:           row.payload (jsonb) = ActivityData（10 カテゴリ配列）
  expectedMissingFields: 旧行はカテゴリ配列が欠落しうる（key 列挙ではなく
                         Object.values().filter(Array.isArray) で走査すること）
  authority:             device_canonical_mirrored
  fallback:              row なし → absent
  ⚠️ MIRROR_GAP G1: submit 前の入力は server に無い

diagnosis:
  table:                 diagnosis_logs
  readCardinality:       one            // UNIQUE(user_id)
  identity:              user_id = uid
  ordering:              none (maybeSingle)
  mapperInput:           row.payload (jsonb) = DiagnosisResult
  expectedMissingFields: なし。schema_version は 1 / 3 が混在するが payload shape は不変。
                         **schema_version で分岐しないこと**
  authority:             device_canonical_mirrored
  fallback:              row なし → absent

self_analysis:
  table:                 self_analysis_logs
  readCardinality:       latest-one（履歴 many から 1 件）
  identity:              user_id = uid
  ordering:              created_at DESC, limit 1      // 既存 rule（tutorContext:242）
  mapperInput:           row.analysis (jsonb = WallHittingResult)
                         row.summary  (jsonb = SummaryResult)
                         row.created_at
  expectedMissingFields: local_log_id は旧行 NULL（read は local_log_id ?? id）
                         summary_input_hash に "legacy:v1" が入りうる
  authority:             device_canonical_mirrored
  fallback:              row なし → absent
  note:                  studentProfile はここから導出可能（§11.1）。
                         ただし toStudentProfile は再実行しない（generatedAt が非決定的）

statement_review:
  table:                 statement_review_history
  readCardinality:       latest-one
  identity:              user_id = uid
  ordering:              NO_EXISTING_SELECTION_RULE
                         → 提案: created_at DESC, limit 1
                           （LS 側 saveReviewHistory が [item, ...existing] で先頭を最新にする
                            挙動と一致し、browser list helper の order とも一致する）
                         **coordinator の承認を得てから固定すること**
  mapperInput:           row.result (jsonb = StatementResult) + university/faculty/department/essay/created_at
  expectedMissingFields: なし（全列 NOT NULL + default）
  authority:             device_canonical_mirrored
  fallback:              row なし → absent
  ⚠️ MIRROR_GAP G3: 本人が削除した添削が残る。**latest 1 件に限定し履歴を出さない**

self_pr:
  table:                 self_prs
  readCardinality:       many（カード群。1 件に潰す意味がない）
                         → 初期 wiring では latest-one を推奨（prompt 予算 E-L3）
  identity:              user_id = uid
  ordering:              NO_EXISTING_SELECTION_RULE
                         → 提案: pr_index ASC, created_at ASC（browser helper と一致）
                           latest 1 件にするなら updated_at DESC
                         **coordinator 判断**
  mapperInput:           title / body / latest_result / pr_index / updated_at
  expectedMissingFields: seed_input_hash は手動作成 / legacy で NULL
  authority:             device_canonical_mirrored
  fallback:              0 件 → absent
  ⚠️ MIRROR_GAP G5: 削除カードが残る

essay:
  table:                 essay_workspaces
  readCardinality:       latest-one
  identity:              user_id = uid
  ordering:              NO_EXISTING_SELECTION_RULE
                         → 提案: updated_at DESC, limit 1（browser helper と一致）
  mapperInput:           row.workspace (jsonb = EssayWorkspace 全体)
  expectedMissingFields: sparring は Phase 1 経路で常に null
                         improvementInProgress は未開始なら null
                         reviews[].source / parseError / fallbackReason は旧データで undefined
  authority:             device_canonical_mirrored
  fallback:              0 件 → absent
  ⚠️ provenance: 単一 jsonb 内に user_authored / ai_derived / system_metadata が混在（§7.2）。
     **Stage 3 の mapper は jsonb 全体を素通ししないこと。**
     どの field を prompt に出すかは Stage 2 の block-level provenance を待つ

interview_record:
  table:                 interview_practice_records
  readCardinality:       latest-one
  identity:              user_id = uid
  ordering:              NO_EXISTING_SELECTION_RULE
                         → 提案: created_at DESC, limit 1
  mapperInput:           text 列群 + feedback_json (jsonb, nullable)
  expectedMissingFields: feedback_json は NULL / 壊れた JSON で NULL になりうる。
                         InterviewFeedback として narrow する前に guard 必須
  authority:             device_canonical_mirrored
  fallback:              0 件 → absent
  ⚠️ MIRROR_GAP G6: 削除記録が残る

interview_ai:
  table:                 interview_ai_sessions（primary）+ interview_ai_results（embed）
  readCardinality:       latest-one
  identity:              user_id = uid AND status = 'completed'
  ordering:              created_at DESC, limit 1     // 既存 rule（tutorContext:402-404）
  mapperInput:           row.created_at / row.interview_type
                         embed interview_ai_results(feedback) → InterviewFeedback
                         （embed は array or object で返りうる。両方扱うこと）
  expectedMissingFields: **result が無い completed session が多数**（prod: sessions 37 / results 1）。
                         feedback 不在 → absent
  authority:             server_authoritative
  fallback:              feedback 不在 → absent
  ⚠️ 既存 rule の弱点（§8.3-1）は Stage 3 では直さない。踏襲する

presentation:
  table:                 presentation_results（primary）
                         + presentation_attempts → presentation_sessions（enrichment）
  readCardinality:       latest-one
  identity:              user_id = uid
  ordering:              created_at DESC, limit 1     // 既存 rule（tutorContext:483-484）
  mapperInput:           core:       row.feedback (jsonb = PresentationFeedback) / row.created_at
                         enrichment: attempts.eq('id', attempt_id).maybeSingle()
                                     → sessions(university_name, faculty_name, theme)
  expectedMissingFields: qa_summary / final_report は nullable
                         materialFeedback は資料添付時のみ
                         enrichment は best-effort。失敗しても core は返す（既存挙動）
  authority:             server_authoritative
  fallback:              feedback 不在 → absent。enrichment 失敗は無視
```

### 共通契約（全 kind）

```
client:        getServerSupabaseClient()（cookie ベース user-scoped）。
               route 側で auth 済 client を注入できること（tutorContext.ts:614 と同形）。
               **service_role は使わない**（§9.3）。
concurrency:   Promise.allSettled。1 kind の失敗が他 kind を巻き込まない（E-S1）。
purpose gate:  EXAM_PURPOSE_REGISTRY[purpose].sources に無い kind は query を発行しない。
state:         SourceState<T>（ready / absent / unavailable）。
               absent と unavailable は型では区別、prompt では同一視。
observability: enum レベルのみログ。PII / 本文は出さない（E-S12 / E-S13）。
```

---

## 13. Runtime Impact

| 種別 | diff |
|---|---|
| runtime（`app` / `lib` / `components` / `hooks` / `types`） | **0**（`git diff -- app lib` 空。`git status --short` に tracked 変更ゼロ） |
| AI prompt | **0** |
| AI route | **0** |
| DB（schema / migration / DDL / RLS / policy / grant） | **0**（production への write request ゼロ。GET のみ） |
| env | **0**（`.env.local` 未編集。値は読み取りのみで出力していない） |
| dependency（`package.json` / lockfile） | **0** |
| localStorage | **0** |
| Claude B 所有ファイル（`lib/examSpine/**` / `scripts/exam-spine-stage1-check.ts` / `EXAM_SPINE_ARCHITECTURE.md` / `EXAM_SPINE_STATE.md` / `EXAM_SPINE_DECISIONS.md`） | **0**（読み取りのみ） |

本監査が追加したファイル: **本ファイル 1 件のみ**
（`docs/principles/exam_spine/EXAM_SPINE_STAGE3_READINESS_AUDIT.md`）。

一時的な probe script（PostgREST GET のみ）は scratchpad
（`/private/tmp/claude-501/.../scratchpad/`）に置き、repo には入れていない。

---

## 14. QA

| コマンド | 結果 |
|---|---|
| `git status --short` | tracked 変更ゼロ（untracked は他セッション由来。§15） |
| `git diff --check` | クリーン（出力なし） |
| `npx tsc --noEmit` | **exit 0 / エラーゼロ** |
| `git diff -- app lib` | 空 |

- 新規 lint error: **0**（コード無変更のため）
- 既知 lint error: 本監査では新たに走らせていない（コード無変更のため差分比較の意味がない）
- **AI API call: 0**（Anthropic / OpenAI ともに未呼び出し）
- **network mutation: 0**（PostgREST への request は `GET` のみ。`POST`/`PATCH`/`DELETE` ゼロ、
  `limit=0` により行データ取得もゼロ）

---

## 15. Parallel Safety

- 開始時 `git status --short` は clean。
- 監査中（17:34–17:37）に **他セッション由来の untracked ファイルが本 worktree に出現**した:

```
?? lib/examSpine/read/reader.server.ts      (17:36)
?? lib/examSpine/read/rowMappers.ts         (17:35)
?? lib/examSpine/read/snapshot.server.ts    (17:37)
?? scripts/exam-spine-tutor-loader-qa.ts    (17:34)
?? scripts/fixtures/exam-spine-tutor-loader/  (T1–T6 fixtures, 17:34)
?? scripts/fixtures/examSpineTutorLoader.ts (17:34)
?? supabase/.temp/cli-latest                (17:34)
```

- **いずれも読んでいない / 変更していない / commit していない。**
- ⚠️ **coordinator への注意喚起**: 指示では Claude B は別 worktree
  `/Users/yk/paid-app-spine-stage1`（branch `exam-spine-stage1`）で作業しているはずだが、
  `lib/examSpine/read/`（= Stage 3 reader / rowMapper）が
  **本 worktree（`feature/interview-realtime-step1`）に書き込まれている**。
  worktree 境界が守られていない可能性がある。本監査は Stage 3 reader を実装していないため
  衝突は起きていないが、**この監査結果を Stage 3 実装に反映する前に、
  どちらの worktree が Stage 3 の正本かを確定すること。**
- force push: なし。他セッションの変更の取り込み: なし。
- commit する場合は本ファイル 1 件をパス指定で追加すること（`git add` のワイルドカード禁止）。

---

## 16. Remaining Unknowns

| # | 未確定事項 | ブロッカーか | 解消手段 |
|---|---|---|---|
| U1 | production の UNIQUE / CHECK constraint / index / trigger / policy 定義 / grant（E-H1 残余） | **No**（fail-open で吸収可能） | SQL Editor で SELECT のみの検証 SQL を 1 回実行（§5.4） |
| U2 | `self_prs` / `statement_review_history` / `essay_workspaces` / `interview_practice_records` の authenticated **SELECT** policy の実動作 | **No**（`unavailable` に倒れるだけ） | Stage 3 の初回実測、または U1 と同時 |
| U3 | `statement_review` / `self_pr` / `essay` / `interview_record` の server latest-row rule | **Yes（設計判断）** | §12 の提案を coordinator が承認して固定する。**reader が勝手に決めないこと** |
| U4 | `interview_ai` の「result を持たない最新 completed session」問題（§8.3-1） | No（既存挙動） | 別 STEP。Stage 3 は現行 rule を踏襲 |
| U5 | `presentation_practice_records` の最終分類 | No | 対人プレゼン記録 UI が実装された時点で再監査（§4.5） |
| U6 | `statementDraft` の durable 化要否 | No | `interview` purpose を wiring する STEP で判断（§11.3） |
| U7 | `essay` の field 単位 provenance を型でどう表現するか | No（Stage 2 の scope） | §7.2 の分類を Stage 2 の入力にする |
| U8 | Stage 3 の正本 worktree | **Yes（運用）** | §15。coordinator が確定 |

---

## 17. Stage 3 Readiness

### **READY**（U3 / U8 の判断待ちを条件とする）

Stage 3 reader / rowMapper の実装に必要な情報は揃っている:

- ✅ 10 kind すべての durable table / 行モデル / natural key / ownership 列が確定
- ✅ 各 kind の実 row shape と「何が失われるか」が確定（`basic_info.name` strip 含む）
- ✅ 使用すべき client が確定（**user-scoped server client。service_role 不要**）
- ✅ 既存 selection rule が 6 kind で確定、残り 4 kind は `NO_EXISTING_SELECTION_RULE` と明示
- ✅ MIRROR_GAP 11 件を特定 → 「server の行 = 端末の canonical」と誤認しない前提が確立
- ✅ production に全 table / 全列が実在することを live DB で実証
- ✅ `presentation_practice_records` の扱いが確定（Spine 対象外）

Stage 3 に着手する前に coordinator が決めるべきこと:

1. **U3**: `statement_review` / `self_pr` / `essay` / `interview_record` の latest-row rule
   （§12 の提案を採用するか）。
2. **U8**: Stage 3 の正本 worktree（§15）。
3. §4.5 の `PROPOSED_DOC_CHANGE` 3 点を適用するか（Claude B 所有ファイルのため B が実施）。

Stage 3 実装時の必須制約（本監査から導出）:

- reader は **`getServerSupabaseClient()` のみ**を使う。service_role を使わない。
- `EXAM_PURPOSE_REGISTRY` に無い kind の query を発行しない。
- `absent` / `unavailable` を型で区別し、prompt では同一視する。
- `statement_review` / `self_pr` / `interview_record` は **latest 1 件に限定**する
  （削除済みデータが durable に残っているため。G3 / G5 / G6）。
- `essay_workspaces.workspace` の jsonb を **素通ししない**（provenance 混在。§7.2）。
- `basic_info` の payload を `BasicInfo` として型付けしない（`name` 不在）。
- `diagnosis` の `schema_version` で分岐しない。
