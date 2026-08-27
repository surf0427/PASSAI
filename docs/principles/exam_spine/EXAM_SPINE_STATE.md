# PASSAI 受験版 — Exam Spine State

**Purpose:** 運用状態のスナップショット。
**Update rule:** 検証済み状態を変える slice の後に必ず更新する。**architecture をここに書き直さない。**
**Upstream reference:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_STATE.md`

---

# 1. Snapshot

| 項目 | 値 |
|---|---|
| Date | 2026-08-27 |
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
| Canonical HEAD at this arbitration | `40b76a85a2ab86874316d7c3808fcef57b7580a1` |
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
| `exam-spine-w1-convergence-v2` | `de30cae`（tip / Stage 5.9 まで） | **PARTIAL（Stage 5.1〜5.9 昇格済み。5.8 は blocker 確定まで）** | Stage 5.1（Packet J = shadow comparison）は S5-P3 で（`1f05b74`／decision → **E-S42 / E-S43**）、Stage 5.2（canonical diagnosis block）は S5-P4 で（`9f270c6`／decision → **E-S44**）、Stage 5.3（canonical activity block ＋ device activity claim）は S5-P5 で（`51f3a9f`〜`54d429e`／decision → **E-S45**）、Stage 5.4（self-analysis device claim ＋ 比較元訂正、および前提となる device window primitive）は S5-P6 で（`861398a`〜`5b1ae25`／decision → **E-S46 / E-S47**）、Stage 5.5（cap を比較 window とみなす windowed readability feature）は S5-P7 で（`b873572`〜`c3d2bdf`／decision → **E-S48**）、Stage 5.6（statement_review の **transport のみ**）は S5-P8 で（`e6fa941`〜`3c34d5b`／decision → **E-S49 / E-S50**）、Stage 5.7（interview_record の transport ＋ semantics ＋ `interview_issue_line` block）は S5-P9 で（`69821e0`〜`50ce097`／decision → **E-S51**、E-S50 に interview_record 行を追記）、Stage 5.8（essay の **blocker 確定のみ**。claim / window / block は意図的に作らない）は S5-P10 で（`f3fa929`〜`985ba0f`／decision → **E-S52 / E-S53**、E-S50 に essay 行を追記）Stage 5.9（presentation の canonical block ＋ shadow 実比較。class 2 なので Source-Sync は増やさない）は S5-P11 で（`91e9ca6`〜`7792ebc`／decision → **E-S54**、E-S50 に presentation の **N/A** 行を追記）canonical へ targeted promotion 済み。**source branch の tip はここまで**（Stage 5.10 相当は source にも未実装）。**未昇格**は statement_review の **consumer semantics**（product 判断待ち / E-S49）、essay の **transport**（E-S52 の read window blocker）、および全 kind の **AI-visible consumer activation** である |
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
      ↓
Stage 5.5  history comparison window feature ← ★ S5-P7 で canonical へ昇格済み ★
  27cf0a0  define the history comparison window semantics
           → canonical E-S48 として再採番（branch-local E-S43）
  9457eb4  treat the read cap as a comparison window          → canonical b873572
           ※ assemble.server.ts の overflow 分岐
             ＋ serverMirrorCandidate の windowed opt-in
  34a6fd0  verify the history comparison window semantics     → canonical c3d2bdf
           ※ Stage 5.4 T11 を blocker pin → 解消後の挙動 pin へ移設（削除ではない）
  bc8b6c2  mark self-analysis ready after the window semantics fix
           → canonical では STATE の readiness 行として反映
      ↓
Stage 5.6  statement_review transport        ← ★ S5-P8 で canonical へ昇格済み（transport のみ）★
  64975c2  classify statement_review semantics and audit history tie-breaks
           → canonical E-S49 / E-S50 として再採番（branch-local E-S44 / E-S45）
  0aca51b  add statement-review to tutor device claims       → canonical e6fa941
           ※ deviceStatementReviewView へ selectDeviceSyncWindow を適用（window parity）
  19628fb  project a legacy-equivalent statement-review line for shadow only
                                                              → canonical b0af91c
  5d6e711  verify statement-review transport and semantic parity separately
                                                              → canonical 3c34d5b（+ prompt anchor 修正）
  d2f9daa  record statement_review transport ready and semantics deferred
           → canonical では STATE の readiness 行として反映
      ↓
Stage 5.7  interview_record   ← ★ S5-P9 で canonical へ昇格済み ★
  4929964  classify interview_record semantics and require a tutor block
           → canonical E-S51 として再採番（branch-local E-S46）
  1bae1c8  claim interview_record from the tutor device        → canonical 69821e0
           ※ device window ＋ claim を同一 commit で適用（claim-first を作らない）
  bff2e77  build a canonical tutor block for interview_record  → canonical 2d45b68
           ※ interview_issue_line を registry ＋ tutor plan に追加（AI 非可視のまま）
  029fafd  verify interview_record transport, semantics, and block separately
                                                                → canonical 50ce097（+ anchor 修正）
  acb7fb1  record interview_record as ready                     → canonical では STATE 行として反映
      ↓
Stage 5.8  essay            ← ★ S5-P10 で canonical へ昇格（blocker 確定まで）★
  6bbc4d4  close the E-S27 sub-path residual and split the essay blockers
           → canonical E-S52 / E-S53 として再採番（branch-local E-S47 / E-S48）
  131ba32  retarget the essay runtime blocker
           → canonical bb700a0（canonical は blocker が空だったため **再投入**）
  def3882  verify essay projection, window, and semantics separately
           → canonical f3fa929 + 985ba0f（blocker 検査を実値化 / claim 未配線 pin 追加）
  acb7fb1 相当の STATE 反映 → 本 STATE の essay 行
      ↓
Stage 5.9  presentation      ← ★ S5-P11 で canonical へ昇格 ★
  85f3e27  extract the presentation section normalizer as a pure module
           → canonical 91e9ca6（内容不変。byte 不変を 30 fixture で実測）
  29a7bfc  build a canonical tutor block for presentation
           → canonical 6d8d77f（E-S45 参照のみ E-S50 へ訂正。source の E-S45 は
             tie-break 監査だが canonical の E-S45 は activity で別 decision）
  7c082d7  promote the presentation shadow comparison to a real comparison
           → canonical c920de9（内容不変）
  57743de  verify presentation authority, semantics, and block separately
           → canonical 2cb3150 + 6add46b + 7792ebc
             （固定長 slice 廃止 / robust prompt anchor / 先行 Stage 境界 /
               golden bytes / negative control で見つけた 5 つの盲点を追加）
  de30cae  register E-S49 …
           → canonical 1d9c0a9（**E-S54** へ再採番。E-H7（採番衝突の PENDING_HUMAN）は
             canonical では E-S37 / E-S38 が lineage 帰属を LOCKED 済みのため持ち込まない）
      ↓（5.10 以降は未昇格 / source branch にもまだ存在しない）
self_pr（Stage 5.10 相当）← source branch の tip が de30cae のため **未実装**
```

### presentation readiness（S5-P11 / class 2 なので Source-Sync 軸を使わない）

```text
authority model READY    class 2 = server_authoritative（E-S3 / LOCKED）。
                         device に canonical は存在せず client の値は表示用 cache。
                         構造的証明: EXAM_SYNC_SUPPORTED_KINDS に無く、
                         examSyncUsability は canary 許可 + verified でも
                         `kind_not_syncable` で veto する

Source-Sync     N/A      ★ transport READY / NOT_READY という語を使わない ★
                         claim / device window / fingerprint / verified は
                         **1 つも作っていない**。作るべきでもない（E-S3）。
                         essay 用の EXAM_SYNC_RUNTIME_ENABLE_BLOCKED も流用しない
                         （class 2 は既に構造的に落ちており、blocker を足すと
                           「解除すれば使える」という誤った含意が生まれる）

order audit     N/A      E-S50 は device↔server の window parity 監査であり、
                         claim を配線する kind が対象。presentation は claim を
                         配線しないため Level A/B/C を与えない（E-S50 に N/A 行を追加）

semantics       READY    E-S54 classification **B — EQUIVALENT_AFTER_NORMALIZATION**。
                         legacy と canonical は同一 table・同一 read graph・同一 record
                         （presentation_results を created_at DESC で最新 1 件）。
                         差は canonical mapper の shortText=200 / longText=4000 の
                         先行 truncate だけで、legacy の 40 / 120 字がそれより短いため
                         冪等（結果を変えない）

block           READY    presentation_result_summary。整形の正本は
                         lib/contextBuilders/tutorPresentationSection.ts を legacy と共有し、
                         canonical 側で書き写さない（E-P6）

shadow          READY    presentation.resultSummary を実比較（両側を同じ renderer に通す）。
                         録画 / STT 全文 / 発表原稿 / Q&A 履歴は
                         presentation.rawArtifacts = raw_body_excluded

consumer        DEFERRED plan に載せたのは shadow から build させるためで、
                         production prompt は legacy の Supabase 層のまま。
                         AI-visible ではない（PRE_HASH == POST_HASH で実測）

overall         READY_AS_CANONICAL_CONTRACT
                         「consumer 未活性だから未完了」ではない。Stage 5.9 の authority は
                         block と shadow contract の確立までであり、AI-visible 化を
                         要求していない
```

### ★ 共有正本を持つ Stage では「比較」だけでは足りない ★

```text
legacy と canonical が同じ normalizer を共有した結果、書式を変えると
**両側が同時に変わり shadow comparison は MATCH のまま**通る。
S5-P11 の negative control は実際にこれを踏んだ（delimiter / 件数 cap の変更が
比較検査をすり抜けた）。したがって QA は
  絶対 bytes（golden 9 件。値は「抽出前の legacy 出力」から採る）
  legacy 由来のリテラル（3 / 3 / 2 / 40 / 120。定数と自分自身を比べない）
を併置する。
```

### essay readiness（S5-P10 / 層ごとに分ける）

```text
projection      READY    E-S27（reviews:workspace->reviews）は R5 / E-S41 で CLOSED。
                         device ↔ mirror の pure parity は成立（qa:examSpine:syncDevice）

transport       BLOCKED  ★ E-S52 read window ★
                         server は updated_at DESC（= mirror 書込時刻）で上位 cap 件を選ぶが、
                         device は workspace.updatedAt しか持たない。backfill 経路では
                         **完全反転**する。workspace 6〜10 件の user は内容が同期していても
                         永久 mismatch になる。→ claim を配線しない

device window   非適用（意図的） selectDeviceSyncWindow を掛けても
                         **揃えるべき順序キーを device が持っていない**ので解決しない。
                         近似で verified を作らないため据え置く。tie-break は Level C

semantics       DEFERRED ★ E-S53 classification C ★
                         legacy は essayPracticeReview（単数 / mirror 無し）、
                         canonical は essayWorkspaces（LRU 10 / mirror あり）で **別 store**。
                         server は legacy の材料を原理的に読めない。どちらを正とするかは
                         product 判断

block           作らない  E-S53。shadow は no_canonical_block のまま据え置く

runtime enable  BLOCKED  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay（宣言であって gate ではない）

overall         PARTIAL
```

### ★ blocker は「消えた」のではなく「入れ替わった」★

```text
S5-P2   R5 evidence（E-S41 / E-H1）で E-S27 が CLOSED → essay を宣言から撤去
S5-P10  canonical 実コードで別 blocker（E-S52 read window）の実在を確認 → 再投入

⚠️ 「R5 evidence が揃っている ⇔ block が外れている」という双条件を張ってはいけない。
   blocker の軸は 1 本ではない。syncDevice の drift guard は S5-P10 で 2 軸へ分離した:
     (1) R5 evidence が欠けているなら block は必須
     (2) block があるなら現に有効な blocker を名指しし、解消済みの理由を放置しない
   「block が 0 件であること」自体は不変条件ではない。
```

### interview_record readiness（S5-P9 / 4 層に分解する）

```text
transport  READY   claim 配線済み（tutor の 6 番目の kind）
                   device window parity 成立（selectDeviceSyncWindow を適用 / Level B）
                   cap 超過（truncated）でも top-N window 同士で verified
                   header は履歴 5 / 200 / 1000 件いずれも 228 bytes
                   逐語（questions_asked / my_answers）は server SELECT が読まない

semantics  READY   classification B — EQUIVALENT_AFTER_NORMALIZATION
                   legacy の buildInterviewLine を **共有**（再実装しない）
                   canonical 側に競合する projection が無いため product 判断が要らない
                   （statement_review が C で DEFERRED なのと対照的）

block      READY   interview_issue_line が registry ＋ tutor plan に登録済み
                   決定論的 / 空なら行を出さない / 整形上限は legacy と共有

consumer   DEFERRED  ★ AI-visible activation は別 Stage ★
                     plan に載っていても production は plan を読まない
                     （EXAM_PURPOSE_PLANS の import が production に 0 件、
                       tutor plan は render: null / legacyBuilder: null）
```

### ★ 「block がある」と「AI が見る」を混同しない ★

```text
A. projection が存在する            YES
B. canonical block が登録されている  YES
C. tutor plan に載っている           YES
D. prompt builder が plan を読む     NO  ← ここで止まっている
E. AI-visible prompt が変わる        NO

Stage 5.4-5.6 までは「tutor plan の block 数」を AI 非可視の proxy に使えていたが、
Stage 5.7 で plan に block が増えたためその proxy は使えない。
以後は D を直接検査すること（production の plan import 走査 / render 検査）。
```

### statement_review readiness（S5-P8 / transport と semantics を分ける）

```text
transport  READY
  claim 配線済み（tutor の 5 番目の kind）
  device window parity 成立（selectDeviceSyncWindow を statement_review へ適用）
  cap 超過（truncated）でも top-N window 同士で verified になる
  header は履歴 5 / 200 / 1000 件いずれも 228 bytes（件数に比例しない）
  raw 添削本文は claim / context / telemetry のいずれにも出ない

semantics  DEFERRED（E-S49 classification C）
  legacy   = 最新 1 件の weaknesses（先頭 2 件 / 60 字 / ' / ' 連結 / 1 件で出る）
  canonical = 履歴 N 件の反復論点（頻度順 / 2 件未満は空）
  → 選択・集約・下限がすべて違う。どちらを採るかは **product 判断**であり
    実装都合で先取りしない。

overall    DEFERRED
  ⚠️ したがって tutor-facing canonical block は作らない。
     「Source-Sync transport READY」と「AI-visible canonical block」を混同しない。
```

### self_analysis readiness（S5-P7 で更新）

```text
claim wiring（G7）          完了（Stage 5.4 / E-S46）
device window parity        完了（E-S47）
server windowed readability 完了（E-S48）
false-empty guard           有効（E-S46）
shadow 比較元               Supabase 層 projection（E-S46）

→ self_analysis = READY
   ⚠️ ただし consumer 移行には tutor 向け canonical block が別途必要である。
      これは Source-Sync の blocker ではなく block coverage の課題であり、
      G2-G5 と同じ扱いで後続 Stage に残す。
      S5-P7 でも self_analysis の canonical block は **追加していない**。

⚠️ mirror gap（E-S46 / G9）: dualWriteSelfAnalysisLog は削除を伝播しないため、
   端末で log を消した場合はその端末で正当に mismatch になる。設計どおり。
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
実例 3: Stage 5.5 の branch-local `E-S43`（cap は比較 window）は canonical の
`E-S43`（shadow の結果を consumer 経路へ渡さない）と別 Decision であり、S5-P7 で
**E-S48** へ再採番した。さらに source branch は essay 用に branch-local `E-S47` を
使っているが、canonical `E-S47` は device history window parity である。
**essay を昇格する packet では必ず再採番すること。**
実例 4: Stage 5.6 の branch-local `E-S44` / `E-S45` も canonical の同番とは別 Decision
（canonical E-S44 = diagnosis hint 表 / E-S45 = activity カテゴリ別件数）。S5-P8 で
**E-S49 / E-S50** へ再採番した。
✅ presentation 用の branch-local `E-S49` は S5-P11 で canonical `E-S54` へ再採番済み。
   canonical `E-S49` は statement_review の projection classification である。
実例 5: Stage 5.7 の branch-local `E-S46` も canonical の同番とは別 Decision
（canonical E-S46 = self_analysis の比較元と false-empty guard）。S5-P9 で
**E-S51** へ再採番した。
実例 6: Stage 5.8 の branch-local `E-S47` / `E-S48` も canonical の同番とは別 Decision
（canonical E-S47 = device history window parity / E-S48 = cap は比較 window）。
S5-P10 で **E-S52 / E-S53** へ再採番した。
実例 7: Stage 5.9 の branch-local `E-S49` も canonical の同番とは別 Decision
（canonical E-S49 = statement_review の projection classification）。
S5-P11 で **E-S54** へ再採番した。
✅ これで source branch tip（`de30cae`）までの衝突はすべて解消済み。
   source が今後 `E-S50` 以降を採番したら、同じ手順で canonical の未使用 ID へ再採番する。
   なお source は `E-H7`（採番衝突そのものを PENDING_HUMAN とする decision）も
   追加しているが、canonical では **持ち込まない**。canonical lineage の帰属は
   E-S37 / E-S38 が既に LOCKED で決めており（`exam-spine-stage4-stabilize`）、
   採番 authority もそこにある。canonical の `E-H7` は別内容（device claim transport
   の 2 実装 / RESOLVED）で既に埋まっている。
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
