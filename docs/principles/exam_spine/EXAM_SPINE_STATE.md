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
| Branch | `exam-spine-w1-convergence-v2`（canonical lineage = `exam-spine-stage3` 系列 / E-S23） |
| Base HEAD（Stage 0 着手時） | `200b5a62f8287a55daf434a2f69c46a4296bc39d` |
| Supabase project | `oarzldvteiuyuwkdoauq` |
| 採用 architecture | 案E — Architecture Transplant + Exam Authority Model |

---

# 1.1 Canonical Implementation Lineage（正本 / E-S37）

**Packet / worker はここを読んで canonical HEAD を解決する。推測しない。**

| 項目 | 値 |
|---|---|
| Canonical implementation branch | `exam-spine-stage4-stabilize`（Stage 4 final arbitration / E-S38 で確定） |
| Canonical HEAD at this arbitration | `__S5P6_HEAD__` |
| Canonical ancestry root | `exam-spine-stage3` @ `a009116`（L2 / E-S23） |

## 解決手順（毎回これを実行する）

```bash
# 1. 上表の branch の現在 HEAD を取る（hash 欄は「この収束時点」の記録であって固定値ではない）
git rev-parse exam-spine-stage4-stabilize

# 2. 候補 branch が canonical に含まれるか
git merge-base --is-ancestor <candidate> exam-spine-stage4-stabilize

# 3. 含まれないなら unique commits を必ず列挙してから統合を判断する
git log --oneline exam-spine-stage4-stabilize..<candidate>
```

## non-canonical candidate branch（削除しない / canonical でもない）

`exam-spine-stage4-stabilize` の ancestry に入っていない branch は **non-canonical** である。
branch が存在すること自体は違反ではなく、canonical tip 数にも数えない（E-S38-4）。

| branch | HEAD（arbitration 時点） | 分類 | 理由 |
|---|---|---|---|
| `exam-spine-w1-convergence-v2` | `acb7fb1`（継続前進中） | **PARTIAL（Stage 5.1 + 5.2 + 5.3 + 5.4 昇格済み）** | Stage 5.1（Packet J = shadow comparison）は S5-P3 で（`1f05b74`／decision → **E-S42 / E-S43**）、Stage 5.2（canonical diagnosis block）は S5-P4 で（`9f270c6`／decision → **E-S44**）、Stage 5.3（canonical activity block ＋ device activity claim）は S5-P5 で（`51f3a9f`〜`54d429e`／decision → **E-S45**）、Stage 5.4（self-analysis device claim ＋ 比較元訂正、および前提となる device window primitive）は S5-P6 で（`861398a`〜`5b1ae25`／decision → **E-S46 / E-S47**）canonical へ targeted cherry-pick 済み。**未昇格**は Stage 5.5 の **feature**（cap を比較 window とみなし truncated を unreadable にしない）/ 5.6（statement_review）/ interview_record で、consumer migration の前提作業として後続 packet で判断する |
| `exam-spine-w45-production-verification` | `6501cd4` | **NON_CANONICAL_VERIFICATION_CANDIDATE** | 本番 read 前提の検証 script。実 DB 依存のため Stage 4 canonical の deterministic QA に含めない |
| `exam-spine-w5-r5-evidence` | `398e7f4` | **PROMOTED（S5-P2 で昇格済み）** | 唯一の unique commit を cherry-pick で canonical へ取り込み、**E-S41** として登録した（`8b0cbc8` + `90fff84`）。cherry-pick のため commit ancestry には入らないが内容は canonical に存在する。**branch は削除しない**（昇格元の記録として保持） |
| `exam-spine-s5p1-transport-convergence` | `5359108` | **NON_CANONICAL_SUPERSEDED（部分）** | canonical から分岐し `398e7f4` を merge しただけの状態。branch 名が示す transport convergence 自体は未実装で、その判断は canonical 側で **E-S39** として確定済み。R5 部分は上行と同一 commit |

### Deferred Stage 5 candidate（成果は保全する）

```text
branch : exam-spine-w1-convergence-v2
HEAD   : 3285d55（arbitration 時点の観測値。**この branch は前進を続けている**）

⚠️ HEAD を固定値として使わない。昇格を検討する時点で必ず再解決する:
     git log --oneline exam-spine-stage4-stabilize..exam-spine-w1-convergence-v2
     git diff --stat exam-spine-stage4-stabilize...exam-spine-w1-convergence-v2

arbitration 時点で観測した unique commits:
  Stage 5.1（shadow comparison / Packet J 相当）
    42cdf18  feat(spine): compare tutor legacy and canonical context in shadow
    6d5eee5  test(spine): verify tutor shadow migration readiness
    d7b1100  docs(exam-spine): freeze stage 5.1 comparison contract
  Stage 5.2（canonical diagnosis block / consumer migration 相当）
    4b30dfd  refactor(spine): make the diagnosis hint table a single authority
    4ad3bd1  feat(spine): add canonical diagnosis block
    b151190  feat(spine): claim device diagnosis so the canonical block can be present
    7a80aaa  test(spine): verify diagnosis block migration semantics
    3285d55  docs(exam-spine): resolve tutor diagnosis migration gap

内容 : lib/examSpine/context/shadow/**（compareTutor / types）
        canonical diagnosis block（blocks/registry / orchestrator の拡張）
        app/api/tutor/route.ts の shadow comparison wiring
        scripts/exam-spine-stage5-1-check.ts / exam-spine-stage5-2-check.ts

canonical に入れない理由:
  Stage 4 canonical stabilization の freeze 対象（Packet J / shadow harness /
  new context behavior / Stage 5 continuation）に該当する。Stage 4 は
  loader / gate / verification までであり、shadow comparison と block 追加は
  それぞれ Packet J / Stage 5 の entry gate で扱う。

⚠️ 「捨てる」ではない。branch も commit も保持する。revert しない。
   再検討時は E-S38-3 の手順（canonical Register HEAD 解決 → 未使用 ID を再採番 →
   branch-local ID は捨てる → 登録してから統合）に従うこと。
   この branch の E-S35 / E-S36 / E-S37 / E-S38 は
   **canonical decision ID ではない**（衝突は branch の前進のたびに増える）。
```

### Stage 5 candidate DAG（`exam-spine-w1-convergence-v2` / 昇格していない）

観測時点の unique commits は **3 波・13 commit**。各波が
「単一 authority 化 → canonical block 追加 → device claim 追加 → QA → Register/STATE」
という同じ形をしており、**波の内部は直列・波の間も直列**である。

```text
Stage 5.1  shadow comparison（Packet J 相当）
  42cdf18  compare tutor legacy and canonical context in shadow
  6d5eee5  verify tutor shadow migration readiness            ← 42cdf18 に依存
  d7b1100  freeze stage 5.1 comparison contract               ← 上 2 件に依存
      ↓（5.2 は compareTutor.ts を拡張するため 5.1 が前提）
Stage 5.2  diagnosis block
  4b30dfd  make the diagnosis hint table a single authority   ← 独立に port 可能
  4ad3bd1  add canonical diagnosis block                      ← 4b30dfd + 42cdf18 に依存
  b151190  claim device diagnosis                             ← 4ad3bd1 に依存
  7a80aaa  verify diagnosis block migration semantics         ← 上に依存
  3285d55  resolve tutor diagnosis migration gap              ← 上に依存
      ↓（5.3 も compareTutor.ts を拡張するため 5.2 が前提）
Stage 5.3  activity category counts block   ← ★ S5-P5 で canonical へ昇格済み ★
  6432b54  unify the activity category label map              → canonical 51f3a9f
  e02c60c  add canonical activity category counts block       → canonical 569fa94
  4309244  add activity to tutor device claims                → canonical 377ce06
  501734b  verify activity claim sync semantics               → canonical 54d429e（+ prompt anchor 修正）
  8a5bd09  resolve tutor activity claim gap                   → canonical E-S45 として再採番
      ↓
Stage 5.4  self-analysis device claim        ← ★ S5-P6 で canonical へ昇格済み ★
  c9736b5  match the server read window in device list views  → canonical 861398a
           ※ Stage 5.4 の **前提**（E-S47）。5.5 feature ではない（下記 §window 分類）
  9e29781  add self-analysis to tutor device claims           → canonical 25951b1
  c3b1d59  compare self-analysis against the legacy prompt source
           + guard false MATCH                                → canonical d1e79d1
  23f9221  verify self-analysis sync and shadow parity        → canonical 5b1ae25（+ prompt anchor 修正）
  d3d1704  record the self-analysis claim wiring              → canonical E-S46 / E-S47 として再採番
      ↓（5.5 feature 以降は未昇格）
Stage 5.5  history comparison window **feature**  ← 未昇格
  27cf0a0  define the history comparison window semantics（branch-local E-S43）
  9457eb4  treat the read cap as a comparison window
           ※ assemble.server.ts の truncated 早期 return 除去
             ＋ serverMirrorCandidate の windowed opt-in
  34a6fd0  verify the history comparison window semantics（Stage 5.4 T11 を書き換える）
  bc8b6c2  mark self-analysis ready after the window semantics fix
Stage 5.6  statement_review device claim      ← 未昇格
interview_record（5.6 の先）← 未昇格。新 block `interview_issue_line` を足す
```

### ★ window 用語の分類（S5-P6 で確定 / 混同注意）★

`c9736b5` と `9457eb4` はどちらも「window」を扱うが **別物**である。
S5-P5 の boundary guard は前者を「Stage 5.5 の read-cap window」として一律禁止して
おり、これは誤分類だった（S5-P6 で訂正）。

```text
device sync window primitive   c9736b5 / deviceViews.ts / E-S47      昇格済み
  device 側が server と同じ「上位 cap 件」を選ぶだけの選択規則。
  canonical source の可読性判定は変えない。
  Stage 5.4 QA はこれを import しないと type check が通らない（TS2305 実測）。

Stage 5.5 feature              9457eb4 / assemble.server.ts
                                       + sync/adapters/types.ts       未昇格
  「cap を比較 window とみなし truncated を unreadable にしない」。
  canonical source の可読性 semantics そのものの変更。
```

`bc8b6c2`（self-analysis を READY にする）が依存しているのは **後者**であり、
`c9736b5` ではない。したがって Stage 5.4 は `c9736b5` を伴えば単独で昇格でき、
その状態の self_analysis readiness は `DEFERRED`（truncation blocker が残る）である。

**独立に port 可能な commit（2 件のみ）:**
`4b30dfd`（diagnosis hint table の単一 authority 化）と
`6432b54`（activity category label map の統一）は
`lib/examDiagnosis/tutorHints.ts` / `lib/activityCategories.ts` を新設して
`tutorContext.ts` の重複を畳む refactor であり、canonical block にも
shadow comparison にも依存しない。

**それ以外はすべて `42cdf18`（shadow comparison）に連鎖する。**
したがって「5.1 だけ捨てて 5.2 を採る」はできない。

⚠️ この branch の decision ID は **E-S35〜E-S39** を branch-local に使っている。
canonical はすでに E-S35〜E-S40 を別の意味で確定済み（E-S38）。
実例: Stage 5.3 の branch-local `E-S39`（activity の canonical 表現）は、canonical の
`E-S39`（device claim transport は 1 本）と **別 Decision** である。S5-P5 では
verbatim で持ち込まず canonical の次番 **E-S45** へ再採番した。
実例 2: Stage 5.4 の branch-local `E-S40` / `E-S41` / `E-S42` も canonical の同番とは
すべて別 Decision である（canonical E-S40 = Stage 5 最初の consumer 固定 /
E-S41 = R5 essay sync eligibility / E-S42 = Packet J shadow contract）。S5-P6 では
Stage 5.4 の semantic decision を **E-S46** へ統合し、window prerequisite だけを
**E-S47** として分離、branch-local `E-S41`（truncation blocker）は独立した authority では
ないので E-S46 の blocker 節へ吸収した。
昇格時は **必ず未使用 ID へ再採番**すること。verbatim merge は禁止。

## ancestry rule

```text
Stage 4 の implementation packet は、この branch から分岐するか、
この branch へ統合されて初めて canonical と呼べる。

並列 branch の出力は、
  a. contract が Register へ登録され（E-P9）、かつ
  b. 本 lineage へ統合される
まで **non-canonical** である。branch 名・commit 数・commit date は根拠にならない。

canonical tip 数は **branch 数ではなく ancestry で数える**（E-S38-4）。
non-canonical candidate branch が何本存在しても
  CANONICAL_TIP_COUNT = 1
である。並列 branch を削除しないと canonical にならない設計にはしない。
```

## この収束に含まれる lineage（機械検証済み）

```text
exam-spine-stage3                     a009116   ⊆ canonical
exam-spine-w1-sync-core-v2            44fc277   ⊆ canonical
exam-spine-w2-sync-adapters           a934321   ⊆ canonical
exam-spine-w25-canonical-convergence  bdcb6dd   ⊆ canonical
exam-spine-w3-device-views            ff5bf38   ⊆ canonical
exam-spine-w4-sync-signal             f7073a9   ⊆ canonical
exam-spine-w1-convergence-v2          82fb782   ⊆ canonical
```

`exam-spine-w1-packet-i` / `exam-spine-w1-packet-e` / `exam-spine-w1-consumer-map-v2` は
shipping lineage 側の packet であり、本 implementation lineage には含まれない（含む必要も無い）。

---

# 2. Stage

```text
現在地: Stage 5.0（Device Revision Claim Wiring）完了
        Stage 0-4 完了 / Wave 1-2 convergence 完了 / Stage 5.0 完了
次:     Stage 5.1（pilot purpose の shadow comparison）
```

## Stage 5.0 で成立したもの

```text
PILOT_PURPOSE = tutor / kind = basic_info

lib/examSpine/sync/claim/**        header contract / serializer / parser / device view
lib/examSpine/context/shadowGate.server.ts  default deny の activation gate（E-S11）
app/tutor/page.tsx                 claim header を既存 fetch に 1 本追加
app/api/tutor/route.ts             parse + auth binding + gate 済み shadow assembly
```

経路:

```text
localStorage basicFormData
→ stripName → mapBasicInfoRow → basicInfoSyncView → examSyncObservation（server と同一）
→ token（efp1:<hex64>）
→ header x-exam-spine-device-claim（120 bytes）
→ parse + auth binding + purpose gate filter
→ Source-Sync verification
→ Canonical Exam Context（shadow / default OFF）
```

## Stage 5.0 時点の保証

```text
consumer 出力経路   : 変更なし（prompt / response / 回答生成はすべて legacy のまま）
production 挙動     : shadow OFF（既定）では query 数も latency も不変
DB mutation         : なし
AI API call         : なし
service_role        : 不要のまま
global mutable cache: なし（claim は request-scoped）
Stage 2 prompt 経路 : production から未接続（QA が機械的に固定）
```


## Stage 4 で成立したもの

```text
lib/examSpine/sync/**      revision / fingerprint / verification / adapters
                           （canonical lineage へ収束済み。E-P9 の単一 authority を維持）
lib/examSpine/context/**   Canonical Exam Context の contract と assembler
                           types / project / identity / veto / assemble.server
```

pipeline:

```text
purpose 検証 → 許可 source 解決 → request-scoped snapshot → 許可 source のみ read
→ source state 正規化 + Source-Sync → Stage 2 で block 組み立て
→ provenance / origin → status → revision → fingerprint → veto → frozen context
```

## Stage 4 時点の保証

```text
production consumer wiring : 変更なし（context layer の import 元は QA だけ）
production behavior change : NONE
AI prompt change           : NONE（Stage 2 の 888 checks が byte-equivalence を維持）
DB schema change           : NONE
env / dependency change    : NONE
DB mutation path           : なし（context 層に insert/upsert/rpc/.from( が 0）
service_role dependency    : なし
global mutable cache       : なし（WeakMap<Request> のみ）
```

## Wave 2 時点の保証

```text
runtime Spine implementation : canonical lineage 上では production 未接続（import 元 0 本）
                               shipping lineage 上では /api/tutor が別実装で稼働中（E-S24 で退避予定）
production behavior change   : NONE（canonical lineage の変更はすべて runtime 未接続）
AI prompt change             : NONE（Stage 2 の 888 checks で byte-equivalence を確認）
DB schema change             : NONE（本番への write / DDL は 0。read-only GET のみ）
env change                   : NONE
dependency change            : NONE
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
| ~~`lib/examSpine/types.ts`~~ | ✅ Stage 1 完了 |
| ~~`lib/examSpine/purpose.ts`~~ | ✅ Stage 1 完了 ＋ Wave 2 で purpose gate を追加（E-S28） |
| ~~`lib/examSpine/orchestrator.ts`~~ | ✅ Stage 2 完了（`orchestrator/` + `blocks/`。E-S25 で凍結） |
| ~~`lib/examSpine/sourceData/rowMappers.ts`~~ | ✅ Stage 3 完了（`read/rowMappers.ts`） |
| ~~`serverReader.server.ts`~~ | ✅ Stage 3 完了（`read/readSources.ts` + `read/supabaseExecutor.server.ts`） |
| `lib/examSpine/sourceSync/*`（revision / signal / verdict） | Stage 4 |
| canary gate（env / runtime） | Stage 4 |
| `app/api/*/resolveContextInputs.ts` | Stage 5 |
| ~~request-local snapshot（`WeakMap<Request>`）~~ | ✅ Stage 3 完了（`read/requestSnapshot.server.ts` / E-S21） |
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
| ~~`E-H1`~~ | ~~`authenticated` SELECT policy / constraint / index の検証~~ | ✅ `RESOLVED`（2026-08-26。live schema check ＋ 本番 SQL Editor で 4 table の owner SELECT policy を確認） |
| ~~`E-H2`~~ | ~~`*_mirrors` の anon 可読 drift~~ | ✅ `RESOLVED`（2026-08-26 本番適用済み。canonical Register へ統合） |
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

## Wave 2 — Canonical Convergence（完了）

| 項目 | 内容 |
|---|---|
| 成果 | Decision Register 単一化（E-H2 統合 / E-S23〜E-S28 / E-P9）・purpose gate（E-S28）・essay bounded projection（E-S27）・per-kind origin（E-S26）・live schema 検証・RLS 検証 SQL |
| 詳細 | `EXAM_SPINE_WAVE2_CONVERGENCE.md` |
| runtime 影響 | 0（canonical lineage は production 未接続） |

## Stage 4 — Source-Sync + canary gate + loader

着手条件は `EXAM_SPINE_WAVE2_CONVERGENCE.md` §8 の readiness matrix を参照。
2026-08-26 時点の hard blocker は **0 件**。
`E-H1` は本番 SQL Editor で `supabase/exam_spine_rls_verification.sql` を実行し、
4 table の owner 限定 authenticated SELECT policy を確認して `RESOLVED` になった
（`EXAM_SPINE_WAVE2_CONVERGENCE.md` §14）。

```text
STAGE4_READY = YES
```

Stage 4 の設計上の固定事項（Wave 2 で確定）:

```text
- read status（ok/truncated/error/skipped）と trust verdict（verified/mismatch/
  unclaimed/unreadable）を 1 つの enum に混ぜない
- verdict 優先順位は E-S2 のとおり unreadable > unclaimed > mismatch > verified
- class 2（interview_ai / presentation）に Source-Sync を適用しない（E-S3）。
  ただし canary gate は適用する
- loader は必ず purpose を渡す（E-S28。purpose 未指定は gate 無効を意味する）
```

## Stage 4 ではないもの

```text
consumer の切替（Stage 5）/ tutor の三重投入解消（Stage 6）
block を持たない 6 kind の block 追加（Stage 5-6 / E-S25）
budget の enforcement（Stage 5 以降）
schema.sql の mirror policy 追随（Spine 外の別 STEP）
```
