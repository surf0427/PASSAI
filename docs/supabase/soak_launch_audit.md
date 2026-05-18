# Phase1 Soak Launch Audit

Phase1 completion declaration ([`phase1_completion_declaration.md`](./phase1_completion_declaration.md)) は doc 上 "operationally complete" を宣言した。本ドキュメントはその宣言と並行に、**operator が今この瞬間に soak observation を開始できるか** を **live state** で監査する。

関連: [phase1_completion_declaration.md](./phase1_completion_declaration.md), [phase1_completion_checklist.md](./phase1_completion_checklist.md), [phase1_soak_runbook.md](./phase1_soak_runbook.md), [phase1_boundary_freeze.md](./phase1_boundary_freeze.md), [observability_sink.md](./observability_sink.md), [feature_rollout_matrix.md](./feature_rollout_matrix.md)

> **本監査は audit doc であり、runtime / schema / abstraction を一切変更しない。** 観測された gap は本ドキュメントで **flag only**、対応は別 STEP で起票する（[`phase1_boundary_freeze.md §5/§6`](./phase1_boundary_freeze.md) gate を通すため）。

> **2026-05-17 STEP-SOAK-1 update**: 本監査が flag した 3 つの observability gap（`mirror_events.schema_version` / `client_version` / `duration_ms` が常時 NULL）は **observability metadata patch STEP** で解消した。`buildMirrorEvent` が 3 列を強制的に propagate し、`readClientVersion` は `NEXT_PUBLIC_APP_COMMIT` 未設定時に `"unknown"` sentinel を返す。詳細は本ドキュメント [§6 Observability Live Audit](#6-observability-live-audit) の inline note と [§9 Final Launch Verdict](#9-final-launch-verdict) を参照。

---

## 1. Audit Purpose

### Why "soak launch audit"

[`phase1_completion_checklist.md`](./phase1_completion_checklist.md) は code/grep/doc 軸で readiness を判定する。[`phase1_completion_declaration.md`](./phase1_completion_declaration.md) は architectural completion を宣言する。**いずれも "live runtime state" を観測しない**。

例:

- `supabase/schema.sql` が repo に存在する ≠ Supabase project に apply されている
- `lib/supabase/env.ts` が `process.env.NEXT_PUBLIC_SUPABASE_URL` を読む ≠ deploy 環境に env が configured
- `mirror_events` が schema 上に存在する ≠ insert が到達して row が観測できる
- `useActivityForm.ts:handleSubmit` 1 箇所のみ dispatch ≠ 別 contributor が直近 24h に dispatch を追加していない

doc readiness と live readiness の差分が **soak 開始時の盲点**。soak 観測の意味論を初日から保証するために、本ドキュメントが live state を mechanical に audit する。

### What this audit is NOT

- doc 内容の review ではない（[`phase1_completion_readiness.md`](./phase1_completion_readiness.md) が担当）
- contract/invariant の boundary 設計レビューではない（[`phase1_boundary_pressure_audit.md`](./phase1_boundary_pressure_audit.md) が担当）
- Phase2 設計議論ではない
- soak 中の運用 runbook ではない（[`phase1_soak_runbook.md`](./phase1_soak_runbook.md) が担当）

本監査は **「soak launch button を押す瞬間」の live state snapshot** にのみ責任を負う。

---

## 2. Live Environment Status

監査時点 (2026-05-17) の live state を mechanical に記録する。verification は repo / filesystem / env file / git log の **観測可能な事実のみ** に基づく。

| Item | Status | Evidence |
|---|---|---|
| `supabase/schema.sql` が repo に存在 | **verified** | `ls supabase/schema.sql` hit 1 / 419 lines |
| Supabase project が存在する | **unverified** | `.env.local` に `NEXT_PUBLIC_SUPABASE_URL` が設定されている事実は確認できるが、project が live で reachable かは本監査の範囲外（operator が browser / CLI で確認） |
| schema が Supabase project に applied | **unverified** | repo file の存在は確認、`psql` / Supabase Studio での apply 状態は operator action として未確認 |
| 4 mirror tables (`student_profile_mirrors` / `basic_info_mirrors` / `diagnosis_mirrors` / `activity_mirrors`) が存在 | **unverified** | schema.sql §2/§7/§10/§13 で DDL は定義済 / live 存在は operator が確認 |
| `mirror_events` table が存在 | **unverified** | schema.sql §5 で DDL は定義済 / live 存在は operator が確認 |
| `.env.local` 存在 | **verified** | 432 bytes, `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` の 2 key のみ |
| `NEXT_PUBLIC_APP_COMMIT` 設定 | **NOT SET (degraded but resolved)** | `.env.local` 内に該当 key なし → 旧仕様では `mirror_events.client_version` 常時 NULL / **STEP-SOAK-1 以降は `"unknown"` sentinel が入る**（[`mirrorFinalize.ts:readClientVersion`](../../lib/supabase/mirrorFinalize.ts)）。production deploy で値を設定すれば commit 識別が回復、未設定時も all-NULL ではなく 1 bucket として stale tail と区別可能 |
| `NEXT_PUBLIC_VERCEL_ENV` 設定 | **NOT SET (local default)** | `.env.local` 内に該当 key なし → `deriveEnvironment()` は `NODE_ENV` 経由で `"development"` を返す（local dev では仕様内 / production deploy では Vercel が自動 inject） |
| `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` 設定 | **NOT SET (default: enabled)** | `.env.local` 内に該当 key なし → `isMirrorRuntimeEnabled()` が `true` を返す（fail-open / 仕様通り） |
| `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` 設定 | **NOT SET (default: enabled)** | `.env.local` 内に該当 key なし → sink は emit する（仕様通り） |
| Production deploy 完了 | **unverified** | repo branch は `feature/supabase-migration` / `main` への merge / Vercel deploy 状態は本監査の範囲外 |
| `current client_version` 識別可能 | **partial** | `NEXT_PUBLIC_APP_COMMIT` 未設定時は `"unknown"` sentinel（STEP-SOAK-1 後）。複数 deploy 間の commit 別識別を取りたければ env 設定が必要だが、stale tail（旧 bundle）と現 bundle の区別は sentinel × deploy ごとに 1 値固定で粗く識別可能 |

### Verdict

- repo-side state は **clean and complete**（schema DDL, runtime helper, .env.local の 2 key）
- **live state（schema apply / mirror tables / mirror_events 存在）は本監査では verify できない** — operator が Supabase Studio で確認する必要あり
- **client_version 不在は STEP-SOAK-1 sentinel 導入で degrade-but-survive**。production で値が欲しい場合は Vercel 側で env 設定 → redeploy

---

## 3. Mirror Reachability Audit

4 mirror それぞれの dispatch → finalize → mirror_events 経路を **code-side で trace** し、live 到達可能性を判定する。

| Mirror | Dispatch reachable? | finalize() reachable? | mirror_events emit reachable? | schema_version emitted? | failure taxonomy valid? |
|---|---|---|---|---|---|
| **studentProfile** | **PASS** ([`lib/studentProfileStorage.ts:57-59`](../../lib/studentProfileStorage.ts#L57-L59) で dynamic import + dispatch) | **PASS** ([`mirrorStudentProfile.ts`](../../lib/supabase/mirrorStudentProfile.ts) の各 return が `finalize(..., meta)` 経由) | **PARTIAL** (browser-side で `client.from('mirror_events').insert(...)` reachable / 但し schema apply 未確認) | **PASS** (STEP-SOAK-1 以降 / storage 側 `input.schemaVersion = String(profile.version)` が `meta.schemaVersion` 経由で `mirror_events.schema_version` に到達) | **PASS** (`missing_env` / `client_unavailable` / `network_error` / `unknown` の 4 reason をカバー) |
| **basicInfo** | **PASS** ([`lib/basicInfoStorage.ts:20-22`](../../lib/basicInfoStorage.ts#L20-L22)) | **PASS** ([`mirrorBasicInfo.ts`](../../lib/supabase/mirrorBasicInfo.ts)) | **PARTIAL** (同上) | **PASS** (STEP-SOAK-1 以降 / helper 内 `SCHEMA_VERSION = "1"` が `meta` 経由で到達) | **PASS** |
| **diagnosis** | **PASS** ([`lib/diagnosisStorage.ts:35-37`](../../lib/diagnosisStorage.ts#L35-L37)) | **PASS** ([`mirrorDiagnosis.ts`](../../lib/supabase/mirrorDiagnosis.ts)) | **PARTIAL** (同上) | **PASS** (STEP-SOAK-1 以降) | **PASS** |
| **activityData** | **PASS** ([`hooks/useActivityForm.ts:298-304`](../../hooks/useActivityForm.ts#L298-L304) で submit-only dispatch) | **PASS** ([`mirrorActivityData.ts`](../../lib/supabase/mirrorActivityData.ts)) | **PARTIAL** (同上) | **PASS** (STEP-SOAK-1 以降) | **PASS** |

### Key finding (reachability)

- **dispatch / finalize** の到達性は 4 mirror 全てで **PASS** — code-side で boundary は完全
- **mirror_events emit** は **PARTIAL** — 経路は確立しているが、Supabase 側 table 存在は本監査では確認不可（operator action）
- **schema_version emit**: 旧 audit 時点では **UNKNOWN (code gap)** だったが、**STEP-SOAK-1 で解消**:
  - 各 mirror helper の `SCHEMA_VERSION = "1"` 定数（studentProfile は `input.schemaVersion`）が `finalize(feature, result, meta)` の `meta.schemaVersion` 経由で `buildMirrorEvent` → `mirror_events.schema_version` に到達する
  - [`phase1_soak_runbook.md §2.4`](./phase1_soak_runbook.md) "schema_version distribution" クエリは **意味のある値を返す**
  - これは Phase1 invariant を壊さない（runtime read 追加なし / abstraction 追加なし / dispatch site 不変 / payload 不変）

---

## 4. Kill-Switch Live Audit

| Item | Status | Detail |
|---|---|---|
| current `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` 値 | **unset → enabled** | `.env.local` 未設定 = `cachedEnabled = true` |
| current `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` 値 | **unset → enabled** | `.env.local` 未設定 = sink emit する |
| deploy propagation 確認可能か | **partial** | `NEXT_PUBLIC_APP_COMMIT` 未設定時は `"unknown"` 1 bucket のみ / 設定時は commit 単位識別。STEP-SOAK-1 で all-NULL は解消 |
| stale deployment 可能性 | **MEDIUM** | `schema_version` 列が STEP-SOAK-1 で populated になったため、schema-level の stale tab は識別可能 / commit-level 識別は env 設定有無に依存 |
| dual-rail kill readiness | **PASS (slow path) / PASS (fast path)** | slow: Vercel env var + redeploy / fast: Supabase SQL Editor で RLS DROP or `DROP TABLE` — Supabase access が operator にある前提 |
| operator rollback readiness | **PASS** | PR revert / kill-switch / `DROP TABLE` の 3 段防御独立（[`phase1_completion_declaration.md §4 invariant #8`](./phase1_completion_declaration.md)） |

### Kill-switch verdict

- kill-switch **mechanism** は仕様通り動く（fail-open default、build-time inlining、module-level cache）
- kill-switch **propagation 観測** は STEP-SOAK-1 以降:
  - `client_version` 未設定時は `"unknown"` sentinel が入るため `disabled` row × `client_version` のクロス集計で「envless deploy 全体」を 1 bucket として識別可能
  - `client_version` 設定時は commit 別の deploy 識別が可能
  - `schema_version` も populate されるため、stale tab が旧 SCHEMA_VERSION で叩いていれば識別可能
- soak 第 1 週の kill-switch verification step（[`phase1_completion_declaration.md §5.1`](./phase1_completion_declaration.md)）は **発火確認** + **deploy 整合性の粗い識別** 共に可能

---

## 5. activityData Live Risk Audit

最重要。Phase1 で activityData は唯一 narrative-soft PII を mirror する feature であり、submit-driven invariant が破壊されれば即座に flood する。

### Code-side invariants (verified)

| Invariant | Status | Evidence |
|---|---|---|
| submit-only invariant | **PASS** | `mirrorActivityData` の dispatch site は `hooks/useActivityForm.ts:298` の 1 箇所のみ（grep `mirrorActivityData` 結果より） |
| autosave leakage absent | **PASS** | `lib/activityStorage.ts:saveActivityData` 内に dispatch なし（grep 結果より） |
| unexpected dispatch path absent | **PASS** | grep `mirrorActivityData` で hits = 4 行（dispatch 1 + 自己定義 3）/ 他経路ゼロ |
| onChange × mirror leak | **PASS** | grep `mirrorActivityData\|mirrorBasicInfo\|mirrorDiagnosis\|mirrorStudentProfile` × `hooks/` × `onChange` = ゼロ hit |

### Live blind spots (production-traffic-only)

`activityData` について **production traffic が入るまで観測不可** な項目:

- **volume baseline**: 1 submit = 1 mirror_events row の仮定が現実の user 行動で成立するか（form 連打 / back navigation で重複 / モバイル bfcache replay 等）
- **payload distribution**: narrative-soft PII の現実 size。schema preview / pressure audit は推定値ベース。p50 / p90 / p99 / max の実測は soak でしか取れない
- **failure mode 分布**: `network_error` 中の Postgres `error.code` の現実分布（unique violation / RLS reject / size limit 等）
- **bfcache replay rate**: モバイル PWA で bfcache 復元時に submit が二重発火するシナリオの現実頻度
- **stale tab impact**: 旧 bundle が新 schema の `activity_mirrors` に対して上記の dispatch を発射した場合の `mirror_events` 上の signature

### activityData live risk verdict

- code-side では **submit-only contract が holds**
- live では **何件出るか / どんな size か / どんな failure_reason 分布か が一切わかっていない** — これは soak の最大の観測価値（[§10A](#a-今の-soak-で最も価値ある観測は何か) 参照）

---

## 6. Observability Live Audit

| Item | Status | Detail |
|---|---|---|
| `mirror_events` rows visible? | **unverified** | schema apply 後に operator が Supabase Studio で query 必要 |
| success / failure distinguishable? | **PASS (code-side)** | `mirror_status` 4-value enum 仕様通り（[`mirrorFinalize.ts buildMirrorEvent`](../../lib/supabase/mirrorFinalize.ts)） |
| schema_version distinguishable? | **PASS (STEP-SOAK-1 以降)** | `finalize(feature, result, meta)` の `meta.schemaVersion` 経由で各 mirror の `SCHEMA_VERSION` / `input.schemaVersion` が `mirror_events.schema_version` に到達 |
| feature distinguishable? | **PASS** | 4 mirror それぞれ `MIRROR_FEATURE` 定数 / `event.feature` で識別可能 |
| stale client distinguishable? | **PARTIAL (STEP-SOAK-1 以降)** | `NEXT_PUBLIC_APP_COMMIT` 未設定時は `"unknown"` sentinel が `mirror_events.client_version` に入る / 値が欲しい場合は env 設定 + redeploy |
| duration_ms 観測可能? | **PASS (STEP-SOAK-1 以降)** | 各 mirror entry で `performance.now()` を capture / `finalize()` で `Math.round(performance.now() - startedAt)` を `mirror_events.duration_ms` に書き込み（負値は 0 clamp） |
| blind spots remaining | **schema apply / commit-level identifiability** | `schema apply` は operator action / commit-level の client_version は env 設定の有無に依存（未設定時は sentinel `"unknown"` で degrade） |

### Observability verdict (STEP-SOAK-1 後)

soak runbook が前提とする observability **6 column 全てが populated** になった:

| Column | 期待 | 実態（旧 → 新） |
|---|---|---|
| `feature` | identifier | **OK** / **OK** |
| `mirror_status` | 4-value enum | **OK** / **OK** |
| `failure_reason` / `skip_reason` | reason enum | **OK** / **OK** |
| `environment` | `dev/preview/production` | partial / **partial**（Vercel deploy で自動 inject される前提は変わらず） |
| `schema_version` | `"1"` (Phase1) | always NULL → **populated**（meta propagation） |
| `client_version` | commit sha | always NULL → **populated**（env 値 or `"unknown"` sentinel） |
| `duration_ms` | int (ms) | always NULL → **populated**（`performance.now()` diff） |

[`phase1_soak_runbook.md §2.4 / §3.4`](./phase1_soak_runbook.md) のクエリは **意味のある結果を返す**:

- **schema mismatch 発生時の partial deploy 識別** → schema_version で識別可能
- **redeploy lag 観測 / stale client tail 観測** → client_version で粗く識別可能（commit 値 or sentinel）
- **slow upsert 検知 / Supabase 側応答時間 観測** → duration_ms で観測可能

**残存 caveat**: `NEXT_PUBLIC_APP_COMMIT` が deploy に設定されていない場合、`client_version` は `"unknown"` 1 値固定。複数 deploy 間の細かい識別を取りたければ operator が env 設定 → redeploy する必要がある。

---

## 7. Soak Start Gate Verdict

[`phase1_completion_declaration.md §5.1`](./phase1_completion_declaration.md) の Soak Launch Gates を **live state** で再判定する。

| Gate | Live verdict | Note |
|---|---|---|
| schema applied | **BLOCKED** | repo の `supabase/schema.sql` を Supabase project に apply する operator action が未実施 / 完了が未確認 |
| `mirror_events` reachable | **BLOCKED** | schema apply 後でなければ insert が到達しない |
| no runtime drift | **PASS** | `npx tsc --noEmit` exit 0 / `npx eslint lib/supabase/` exit 0（STEP-SOAK-1 後も維持） |
| no read path | **PASS** | `.select(` runtime hit = 0（README literal text のみ） |
| activityData submit-only | **PASS** | dispatch site = 1（`hooks/useActivityForm.ts:298`） |
| env contract synced | **PARTIAL** | `URL` / `ANON_KEY` は OK / `NEXT_PUBLIC_APP_COMMIT` 未設定でも sentinel で degrade（STEP-SOAK-1） |
| incident ladder available | **PASS** | [`phase1_completion_declaration.md §7`](./phase1_completion_declaration.md) Level 0-4 / [`phase1_soak_runbook.md §5-§9`](./phase1_soak_runbook.md) decision tree |
| rollback path available | **PASS** | 3 段防御独立 / fast path (Supabase) + slow path (Vercel) |

### Gate aggregate verdict

- **PASS**: 5 gates (code-side invariants + incident infra)
- **PARTIAL**: 1 gate (env contract; observability degrades to `"unknown"` sentinel when env unset, writes succeed)
- **BLOCKED**: 2 gates (schema apply / mirror_events reachability — operator action 待ち)

---

## 8. Immediate Soak Risks

soak day 1-7 に **今すぐ起こりうる** リスクを mechanical に列挙する。

| Risk | Impact | Detectability | Response speed |
|---|---|---|---|
| **network_error flood** (schema 未 apply / RLS 未設定) | mirror 全件 failure / canonical UX 無影響 / `mirror_events` 自身も同 RLS 問題なら全件 silent | **HIGH** (Supabase Studio で対象 table 不在を即確認 / failure_reason 分布が `network_error` 単色になる) | **MEDIUM** (schema apply は SQL editor で即時 / `mirror_events` 自身が落ちていれば気付くまで完全 silent) |
| **stale deployment**（旧 bundle が new schema を叩く） | partial failure / mirror_events 上で混在 row | **MEDIUM** (STEP-SOAK-1 後: `schema_version` で SCHEMA_VERSION 差を識別 / `client_version` で commit 差 or sentinel bucket で識別 / 件数の時系列分布も併用可能) | **MEDIUM** (列値混在として直接観測できる) |
| **missing env**（production で `NEXT_PUBLIC_SUPABASE_*` 設定欠落） | `mirror_events.failure_reason='missing_env'` で全件 failure | **HIGH** (`failure_reason` enum 経由で即識別) | **HIGH** (Vercel dashboard で env 追加 → redeploy) |
| **operator misread**（`mirror_events` 不在を network_error と誤読、または逆） | mitigation 方向が誤る / 時間ロス | **MEDIUM** (failure_reason の `error.code` (Postgres) で識別可能だが `code` は string で来る) | **MEDIUM** (decision tree §5.1 follow すれば収束) |
| **dynamic import silent failure**（4 mirror helper の `import()` chunk が browser で fetch 失敗） | dispatch site の `.catch(() => {})` で完全 silent / `mirror_events` 1 件も来ない | **VERY LOW** (catch swallow / observability path も走らない / volume drop で初めて気付く) | **VERY LOW** (Sentry 等が無いため bundle 配信エラーを別経路で観測する手段なし) |
| **activityData spike** (autosave 経路に dispatch が混入する将来 PR) | `mirror_events` flood + `activity_mirrors` flood / narrative-soft PII の蓄積率が想定 1000× | **HIGH** (§2.3 typing-only verification で 1 min 単位で検出) | **HIGH** (Level 1 kill-switch flip → redeploy 数分 / Level 3 RLS DROP 即時) |

### Top concern

**dynamic import silent failure**（chunk fetch 失敗 silent）が依然として最深の盲点。

STEP-SOAK-1 後でも、chunk が browser に到達しなければ `mirror_events` に何も書かれない（dispatch site の `.catch(() => {})` で吸収 + observability path 自体が走らない）。

ただし STEP-SOAK-1 後は **「届いた dispatch」については** schema_version / client_version / duration_ms 全てが populated なので、stale deployment との区別が改善。

→ soak day 1 baseline capture の段階で、**意図的に 1 mirror dispatch を browser で叩いて `mirror_events` に 1 件入ることを確認** すべき（[§11 operator TODO](#11-operator-todo-extraction) §6）。

---

## 9. Final Launch Verdict

### Verdict: **READY WITH CAVEATS (narrowed)**

> 旧 verdict は 5 caveats / 内 3 が observability NULL fixation。**STEP-SOAK-1 で 3 NULL は解消**したため caveat は **schema apply 未確認 + chunk-fetch silent + commit-level identifiability の env 依存** の 3 件に減った。

#### 理由

**Soak を開始してよい根拠**:

1. code-side invariant が 8/8 holds（[`phase1_completion_declaration.md §4`](./phase1_completion_declaration.md)）
2. tsc / eslint 共に exit 0（STEP-SOAK-1 patch 後も維持）
3. `.select(` runtime hit 0 / dispatch site 各 1 / onChange leak 0
4. canonical UX は mirror layer 完全 disable / failure でも bit-identical（思考実験ベース）
5. incident ladder Level 0-4 + dual-rail kill が doc-first で確立
6. activityData submit-only invariant が code-side で holds
7. **mirror_events 6 column 全て populated**（feature / mirror_status / reason / environment / schema_version / client_version / duration_ms）

**Caveats（soak 開始時に operator が了承すべき）**:

1. **schema apply 未確認** — soak day 0 の最初の action は schema apply + 4 mirror table + mirror_events 存在確認
2. **chunk-fetch silent failure の盲点** — dynamic import が browser に届かなければ `mirror_events` 0 件 / `mirror_events` 0 件 と kill-switch ON との区別が依然として外部 signal 不要では困難
3. **commit-level client_version の env 依存** — `NEXT_PUBLIC_APP_COMMIT` 未設定なら `"unknown"` 1 bucket に丸まる。commit 別識別が欲しければ Vercel 側で env 設定 + redeploy

#### "NOT READY" にしない理由

上記 3 caveat は **operator-resolvable** であり、**canonical UX を脅かす runtime drift ではない**。

- canonical localStorage は不変
- 4 mirror best-effort 契約 holds
- kill-switch 自体は仕様通り fail-open
- rollback 3 段防御独立

これらが holds する限り、caveat 解消は schema apply / env 設定 / day1 smoke の operator action で完結する。

#### "READY (no caveats)" にしない理由

caveat #1（schema apply）は operator action 完了次第 PASS に昇格、caveat #3（env 設定）も operator 判断次第。schema 未 apply 状態で soak を "開始" 宣言することはできない。

---

## 10. Reality Review

### A. 今の soak で最も価値ある観測は何か

**activityData の volume × payload size × failure_reason 分布の実測**。

理由:

- 他 3 mirror（studentProfile / basicInfo / diagnosis）は **idempotent saves** で 1 user × 1 lifetime に dispatch 数件レベル。volume と size は予測範囲内
- activityData は narrative-soft PII で **size 推定が pure 想像** / submit-only にしたとは言え user 1 人あたり何件 submit するかの実数値は不明
- pressure audit が推定値ベースで設定した 5 MB / 500 KB / p99 等の threshold が、現実の user 行動と整合するかを **本 soak で初めて検証** する

これが production で破綻すれば、Phase2 で payload column 設計 / max length / archival policy 全てが連動して reshape される。

### B. 今の soak でしか見えないものは何か

- **bfcache replay の現実頻度** — モバイル PWA で submit が二重発火するシナリオ
- **stale tab tail length の現実値** — redeploy 後何日で旧 schema/bundle がほぼゼロになるか
- **anonymous-RLS への bot 流入の現実値** — anon insert を許している activity_mirrors への自動 submit
- **`network_error` 中の Postgres `error.code` の現実分布** — RLS reject / size limit / unique violation の比率
- **chunk fetch 失敗の現実頻度** — dynamic import が config 上ゼロを保証している `mirror_events` が、実際に **どれだけ多くの user で 1 件も来ないか**（CDN edge / 古い browser cache）

これらは **production traffic × 時間軸** がなければ何ひとつ確定値を持たない。

### C. もし mirror_events が全く増えなかったら最初に疑うべきものは何か

**順番に**:

1. **schema apply 未実施** — `mirror_events` table 自体が存在しないため insert silently fail（PostgREST error path → `mirror_events` 自身に書こうとして同じく fail → 完全 silent）
2. **env 未設定 in production** — `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` が Vercel 側で設定されていない → `failure_reason='missing_env'` だが、`mirror_events` 自身も書けない → 完全 silent
3. **kill-switch ON** — `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` が誤設定 → mirror 全て skip / `mirror_events` には `mirror_status='disabled'` row が出るはず（出ない場合は §4 へ）
4. **observability sink disabled** — `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED=true` → mirror upsert は走るが event 0 件
5. **dynamic import chunk fetch 失敗** — code-split chunk が CDN で 404 / browser cache 不整合 → catch swallow で完全 silent
6. **production deploy 失敗** — 旧 bundle (mirror infra 不在) が serve 中

`mirror_events` 0 件は **silent failure の最も難しい signal** で、これらを順に潰す decision tree が [`phase1_soak_runbook.md §6 drop section`](./phase1_soak_runbook.md) にあるが、本監査が示すように **`client_version` 不在で deploy 識別が落ちる** ため (6) の判別が現状最も難しい。

### D. なぜ soak は "backend migration" ではなく "observability validation" なのか

- canonical state は localStorage のまま (`mirrorXxxToSupabase` は best-effort / 結果が UI に届かない)
- `.select(` runtime hit = 0 / Supabase からデータを **読まない**
- mirror table への INSERT は副次 / 失敗しても UX 不変
- soak で観測するのは「**mirror infra が想定通り fail / succeed しているか**」「**observability が想定通り見える / blind になっているか**」

「Supabase に書く」のは Phase1 が **boundary を作って観測の信号源を確保した** という事実を表す手段にすぎない。canonical の所有権移動（backend migration）は Phase3 deferred。

→ **本 soak の output は "data" ではなく "observability の解像度の証拠"** であり、Phase2 設計の input になる。

### E. 今 Phase2 に行くと危険な理由は何か

Phase2 で解禁が議論される項目（runtime read / auth / runtime config / dashboards / abstraction 等）は、全て **soak で観測された数値を入力に設計判断する** べきもの:

- runtime read の解禁判断 → soak で observe した `mirror_events.success_rate` がベース
- auth introduction の判断 → soak で observe した anonymous-RLS への bot 流入が input
- abstraction 解禁の判断 → soak で observe した 4 mirror 共通 failure pattern が input
- payload column 設計 → soak で observe した activityData payload distribution が input

soak data なしで Phase2 設計 STEP を起票すると、**推定ベースで boundary を解除** することになり、Phase1 の最大資産（観測 boundary）を Phase2 入口で empty にする。

加えて本監査が示す observability gap（schema_version / client_version / duration_ms）を Phase2 に持ち込むと、Phase2 設計が "Phase1 soak で blind だった盲点" を遺伝する。**Phase2 design doc の前に observability gap を埋める別 STEP を起票するのが望ましい順序**。

---

## 11. Operator TODO Extraction

mechanical に。priority 順:

1. **schema apply**: Supabase SQL Editor で `supabase/schema.sql` を実行 → 4 mirror tables + `mirror_events` の存在を `\d <table>` で確認
2. **dispatch test (smoke)**: local dev で StudentProfile / BasicInfo / Diagnosis / Activity それぞれの save flow を 1 回ずつ実行 → Supabase Studio で `SELECT feature, schema_version, client_version, duration_ms FROM mirror_events ORDER BY created_at DESC LIMIT 10` を回し、4 feature 全てで **3 column が NULL でない** ことを確認（STEP-SOAK-1 の patch 後検証）
3. **kill-switch verify**: `.env.local`（または Vercel preview env）で `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` → restart / redeploy → 任意の save flow → `mirror_events` に `mirror_status='disabled'` row が 1 件以上出現することを確認 → 終わったら env を元に戻す
4. **(optional) commit-level client_version 設定**: Vercel project の env に `NEXT_PUBLIC_APP_COMMIT=$VERCEL_GIT_COMMIT_SHA` を追加して redeploy。設定しない場合 `mirror_events.client_version` は `"unknown"` 1 bucket に固定（degrade-but-survive）
5. **activityData submit-only confirm**: form に文字を typing → 1 minute 待つ → `SELECT count(*) FROM mirror_events WHERE feature='activityData' AND created_at >= now() - interval '1 minute'` が 0 件のままであることを確認 → その後 1 回 submit → 同 query が 1 件に increment することを確認
6. **stale deployment baseline note**: 現 deploy 時点で `mirror_events` に既存 row がある場合（preview env 等で先行 dispatch がある場合）、soak day 0 開始時点の `count(*)` を記録する（baseline 起点として保存）
7. **production deploy verify**: production / preview / development 各環境で env が intended 通り設定されているかを Vercel dashboard で再確認（特に `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` の preview/production 設定有無）
8. **soak day1 baseline capture**: 24 時間後に `phase1_soak_runbook.md §2.1-§2.5` の 5 query を実行 / 結果を保存 / 異常があれば §5-§11 の decision tree へ進む

---

## 12. Drift Detection

runtime drift 検出結果（STEP-SOAK-0 audit 時点）:

- **runtime drift**: **ZERO**
- code 変更: なし
- schema 変更: なし
- helper 追加: なし
- abstraction 追加: なし
- mirror 追加: なし
- import graph 変更: なし
- env behavior 変更: なし

本監査は read-only audit + doc 1 件新規追加（本ドキュメント）のみ。

### STEP-SOAK-1 follow-up (observability metadata patch)

別 STEP で実施した観測 metadata 補修。**Phase1 invariant を一切壊さない範囲**:

- code 変更: `mirrorFinalize.ts` (signatures + duration measurement + `"unknown"` client_version fallback) / `mirrorEventSink.ts` (MirrorEvent type tightening) / 4 mirror helpers (`startedAt = performance.now()` capture + `meta` propagation to `finalize()`)
- schema 変更: なし（DB column は元から nullable）
- helper 追加: なし（既存 `MirrorFinalizeMeta` type のみ）
- abstraction 追加: なし
- mirror 追加: なし
- import graph 変更: なし
- env behavior 変更: 元と同じ build-time inlining 契約 / 未設定時 sentinel 化のみ
- dispatch site 不変 / payload 不変 / source_hash 不変 / kill-switch 動作不変

---

## 締めくくり

本監査は Phase1 completion declaration の **closing 補強** ではなく、soak operator が live state で「launch button を押す」ための **last-mile audit**。

- code/doc は完了 / kill-switch / dispatch / 4 mirror invariant は live で holds
- schema apply / dispatch live 到達確認 / kill-switch live 発火確認は **本監査 後の operator action** として残る
- observability 3 column NULL は **runbook 解釈の前提を弱める known limitation** として了承の上で soak を開始する

これらを了承した上で「**READY WITH CAVEATS**」を最終判定とする。
