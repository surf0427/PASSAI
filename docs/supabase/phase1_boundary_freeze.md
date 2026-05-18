# Phase1 Boundary Freeze (N=4)

PASSAI Supabase 移行の Phase1 mirror boundary を **N=4 時点で「凍結」** するための運用契約。
本ドキュメントは新規 mirror / 新規 abstraction の追加可否を判定する **gate** として機能する。
runtime 仕様の説明ではなく「これ以上 boundary を広げない / 変えない」ための運用ルール集。

関連: [migration_phases.md](./migration_phases.md), [phase1_runtime_strategy.md](./phase1_runtime_strategy.md), [client_boundary.md](./client_boundary.md), [feature_rollout_matrix.md](./feature_rollout_matrix.md), [mirror_observability.md](./mirror_observability.md), [schema_boundary_policy.md](./schema_boundary_policy.md), [`lib/supabase/README.md`](../../lib/supabase/README.md)

---

## 1. Purpose

なぜ凍結するのか。

- Phase1 は **「shipping-safe stabilization layer」** であり、Phase2 / Phase3 へ向けた “きれいさ” のための踏み台ではない。Phase1 期間中の最大価値は「mirror が動いても動かなくても canonical UX が壊れない」ことそのもの。
- N=4（studentProfile / basicInfo / diagnosis / activityData）まで mirror を積み上げた現時点で、**boundary が「壊れにくさ」を最適化点として既に成立** している。ここから “DRY 化” / “generic 化” / “helper 統合” のリファクタを行うと、各 mirror の差分（PII pattern / hash strategy / trigger contract）が abstraction の中に隠れ、**rollback 単位** と **observability 単位** が崩壊する。
- Phase1 期間中の判断軸を **「綺麗さ」より「壊れなさ」** に固定するため、abstraction / mirror 追加の条件を本ドキュメントで明文化し、即興判断を排除する。
- 「便利そう」「DRY にできそう」「次の mirror で再利用しそう」という incremental な動機での変更を `boundary は frozen` として reject する根拠を提供する。

本ドキュメントは **freeze 契約**。実装着手のスイッチではなく、変更着手の **gate** として参照される。

---

## 2. Final Boundary Inventory (N=4)

Phase1 boundary を構成する **4 feature mirror** のスナップショット。`runtime writer` は **canonical 書き込みを実行する唯一の caller**（mirror dispatch 元）を指す。

| Feature | Mirror Table | Runtime Writer (dispatch site) | Hash Strategy | PII Pattern | Trigger | Schema Version |
|---|---|---|---|---|---|---|
| `studentProfile` | `student_profile_mirrors` | `lib/studentProfileStorage.ts:saveStudentProfile()` | caller-supplied `sourceHash`（canonical pipeline `lib/studentProfile.ts` が計算） | AI-synthesized payload, no direct-PII field（[`student_profile_contract.md`](../principles/student_profile_contract.md)） | canonical localStorage 書き込み成功後の save 経路 | caller-supplied `schemaVersion` |
| `basicInfo` | `basic_info_mirrors` | `lib/basicInfoStorage.ts:saveBasicInfo()` | mirror-local `sha256(JSON.stringify(payloadWithoutName) + SCHEMA_VERSION)` | **direct-PII strip**: `name` を mirror payload 組み立て前に削除 | canonical localStorage 書き込み成功後の save 経路 | `"1"` (mirror-pinned) |
| `diagnosis` | `diagnosis_mirrors` | `lib/diagnosisStorage.ts:saveDiagnosisResult()` | mirror-local `sha256(JSON.stringify({ answers, resultType }) + SCHEMA_VERSION)` | **no-PII**: payload に user 自由記述ゼロ（answers=numeric / resultType=enum / title/description=app-authored static） | canonical localStorage 書き込み成功後の save 経路（診断完了 1 イベント） | `"1"` (mirror-pinned) |
| `activityData` | `activity_mirrors` | `hooks/useActivityForm.ts:handleSubmit()` | mirror-local `sha256(JSON.stringify(payload) + SCHEMA_VERSION)` | **narrative-soft PII**: direct-name field 無し / narrative free-text（clubName, theme, description, achievement 等）は contextual identity を持つが artifact そのもの。strip layer 無し | **submit-driven**（autosave 経路には乗らない、STEP-PHASE1M 決定） | `"1"` (mirror-pinned) |

不変条件:

- 各 mirror は **1 つの runtime writer / 1 つの dispatch site** を持つ。複数 writer による mirror 起動は禁止。
- 各 mirror の `MIRROR_TABLE` 定数は **file-local**。他 mirror から参照されない。
- 各 mirror は `mirrorFinalize.finalize(feature, result)` を **唯一の exit point** とする。observability sink との結合は `finalize` 経由でのみ発生する。
- 各 mirror は **`.select(` を呼ばない**（read path 不在）。
- 各 mirror の hash strategy / PII pattern / trigger contract は **feature-local の契約**。他 mirror に汎用化しない。

---

## 3. Accepted Phase1 Design Tradeoffs

Phase1 が **「綺麗さ」を犠牲にして「壊れなさ」を優先した** トレードオフ。これらは bug ではなく **意図された設計** であり、Phase1 期間中は是正対象にしない。

- **duplicate try/catch allowed.** 各 `mirrorXxx.ts` は同形の skip → env check → client check → try { upsert } catch (err) 構造を持つ。abstraction で吸収しない（[§6](#6-abstraction-threshold-rule)）。
- **per-feature mirror files allowed.** `mirrorStudentProfile.ts` / `mirrorBasicInfo.ts` / `mirrorDiagnosis.ts` / `mirrorActivityData.ts` は別ファイル。`mirrors/index.ts` への集約は行わない（rollback 単位を file-local に保つため）。
- **no generic upsert helper.** `upsertMirror(table, payload, ...)` のような generic 化はしない。各 mirror の `onConflict` キーと payload 形状は feature-local の契約。
- **no shared payload normalizer.** PII strip（basicInfo の `stripName`）/ hash 対象選別（diagnosis の `{ answers, resultType }`）/ payload 全体 hash（activityData）は feature-local 実装。共通化しない。
- **anonymous write-only RLS accepted.** Phase1 は認証無しで mirror INSERT を許す RLS を採用。auth-scoped read / user-scoped policy は Phase2 以降の責務。`activityData` mirror の narrative-soft payload もこの前提下で受容（operator sign-off が gate）。
- **no read paths accepted.** mirror から `.select(` しない / `.from(...).select(...)` パターンを 1 つも書かない。read 経路は localStorage canonical 一択。
- **source_hash collision risk accepted.** SHA-256 を採用しているため理論上の衝突は無視できる。`onConflict: "source_hash"` による idempotent upsert を採用し、衝突時は意味論的に「同一 input の再書き込み」として扱う。
- **narrative-soft PII accepted with operator control.** activityData の narrative free-text は strip 不能（narrative IS the artifact）。Phase1 anonymous mode 下で許容するのは **kill-switch (`NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED`) で全停止可能**、かつ observability sink で件数を観測できることが gate になっているため。

これらは [`phase1_runtime_strategy.md §3 Philosophy`](./phase1_runtime_strategy.md) の「失敗は沈黙する / mirror は副次効果」と一貫した tradeoff であり、Phase1 期間中は固定。

---

## 4. Explicit Non-Goals

Phase1 が **やらない** ことの明文化。これらを Phase1 PR で「準備として」配線することも禁止する（[`phase1_runtime_strategy.md §6 Forbidden Runtime Behaviors`](./phase1_runtime_strategy.md)）。

- **auth-scoped reads** — Phase1 は anonymous で完動。`user_id` を mirror payload / クエリ条件 / RLS に含めない。
- **user dashboards** — mirror データを利用者本人に見せる UI を作らない。mirror は backstage 観測のみ。
- **analytics warehouse** — BigQuery / dbt / OLAP 連携を Phase1 では設計しない。`mirror_events` は infra observability であり analytics layer ではない。
- **live sync** — Realtime / WebSocket / channel subscription を Phase1 では使わない。
- **bidirectional sync** — Supabase → localStorage の write-back / merge 経路を作らない（Phase3 の責務）。
- **optimistic reconciliation** — 「Supabase 側が新しい / localStorage 側が新しい」を runtime で解決しない。
- **generic ORM layer** — Prisma / Drizzle / 自前 query builder の導入禁止。`lib/supabase/` 配下の helper のみが Supabase client に触れる。
- **normalized relational decomposition** — mirror payload は JSONB 1 column。多 table への正規化分解はしない（schema drift 面積を最小化）。
- **admin UI** — mirror データ閲覧 / 編集 UI を作らない。確認は Supabase Studio で operator が直接行う。
- **retention automation** — TTL / cron / partition 自動運用を入れない（必要なら別 STEP で operator-driven に設計）。
- **mirror querying from runtime** — runtime コードから `mirror_*` table を `select` しない。runtime は mirror table の存在を知らない設計を維持する。

---

## 5. Mirror Addition Gate

**新しい mirror を追加してよい条件を厳格化** する。Phase1 期間中、本セクションの **全条件** が満たされなければ mirror 追加 PR を出さない。1 つでも満たさない条件があれば、それを満たすまでの doc / observability / canonical 整備を別 STEP として先行する。

### 5.1 必須条件（全て満たす）

- **canonical UX が既に安定している**
  - 当該 feature の `lib/{feature}Storage.ts` API（signature / 戻り値型 / 例外契約）が直近の STEP で変動していない
  - canonical 書き込みの latency / 失敗挙動が既知 / 文書化済み
- **payload contract が固定されている**
  - `payload` 型（`BasicInfo`, `DiagnosisResult`, `ActivityData` 等）が active 開発で頻繁に変動していない
  - field 追加 / 削除のペースが落ち着いている（追加するなら `SCHEMA_VERSION` bump triggers を mirror header に書き起こせる）
- **submit boundary が明確である**
  - 「いつ mirror が起動すべきか」が `save 経路` / `submit 経路` / `特定イベント` のどれかで **1 つに固定できる**
  - autosave / 即時 reactive 経路に乗せると per-keystroke 起動になる feature は **submit-driven の dispatch site が事前に存在する** ことを確認（[STEP-PHASE1M 決定根拠](#7-runtime-invariants) と整合）
- **autosave leakage risk が低い**
  - dispatch site が autosave 経路と物理的に分離されている（`handleSubmit` / `saveResult` / 単一イベントなど）
  - `lastSaved*` 系の dedup gate が既存または不要であることを確認
- **PII pattern が分類済み**
  - direct-PII strip / no-PII / narrative-soft の 3 分類のいずれに属するかを **mirror PR 着手前** に schema preview doc で確定
  - 3 分類のいずれにも当てはまらない場合は本ドキュメント追補が先行
- **rollback path が存在する**
  - 当該 mirror を無効化する手段が `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` の global kill-switch で確実に発火する
  - PR を revert すれば 1 commit で boundary 状態に戻れる（cross-cutting refactor を mirror PR に混ぜない）
- **mirror_events observability が使い回せる**
  - feature 名 / 結果 3 分類 / 失敗種別マッピングが既存 enum で表現可能
  - 新規 feature 名は既存 enum に「追加するだけ」で済む
- **operator verification checklist が先に存在する**
  - `docs/supabase/{feature}_post_apply_checklist.md` を mirror PR と **同 PR か先行 PR** で commit する
  - apply 待ち / apply 後の挙動 / `mirror_events` での確認手順が明文化されている
- **grep で single runtime writer が確認可能**
  - `grep -rn "mirror{Feature}" .` で **dispatch site が 1 箇所のみ** であることを確認できる
  - 複数 component / hook から呼ぶ場合は `lib/{feature}Storage.ts` 側に dispatch を集約する設計が事前に成立している

### 5.2 禁止される追加動機

以下の理由は mirror 追加の **根拠にならない**。

- 「便利そうだから」
- 「mirror パターンが揃っていて綺麗だから」
- 「もう boundary は出来ているから足すだけ」
- 「他 feature も mirror しているから」
- 「将来 Phase2 で読みたくなりそうだから」
- 「次の AB テストで使いたいから」
- 「analytics 用に貯めておきたいから」

追加根拠は **operational risk と observability readiness のみ**（[`feature_rollout_matrix.md §3 Matrix Philosophy`](./feature_rollout_matrix.md) と整合）。

---

## 6. Abstraction Threshold Rule

**N=4 時点では abstraction を追加しない**。Phase1 期間中、本セクションの全条件を満たすまで generic 化を禁止する。

### 6.1 abstraction 禁止条件（現状）

現状の `lib/supabase/` には既に **意図的に共通化された primitive** がある:

- `mirrorTypes.ts` / `mirrorResult.ts` — `MirrorResult` 型と constructor（feature 知識を持たない）
- `mirrorGuard.ts` — `shouldSkipMirror` の skip-reason mapping
- `mirrorFinalize.ts` — `finalize(feature, result)` の observability finalization
- `mirrorSourceHash.ts` — `sha256Hex(input)` のハッシュ helper
- `mirrorEventSink.ts` — `mirror_events` への best-effort INSERT
- `mirrorMetrics.ts` / `mirrorLogger.ts` / `mirrorConfig.ts` — observability / kill-switch

ここ **以上の abstraction**（`mirrorXxx.ts` を generic にする / `upsertMirror` を切る / payload 構築を共通化する / try-catch / skip flow を helper 化する）は **N=4 時点で禁止**。

### 6.2 abstraction 解禁条件（全て満たすまで導入不可）

- **N >= 5** — 5 つ目の mirror が **既に landed** している（仮 mirror / WIP は含まない）
- **identical logic block が 3 箇所以上** で **完全一致** している（PII strip / hash 戦略 / trigger contract のいずれかで差異がある箇所は「同じ」と見なさない）
- **future mirrors confirmed** — `feature_rollout_matrix.md` で次に着手する mirror が確定し、その mirror も同じ abstraction を必要とする
- **runtime bug actually caused by duplication** — duplicate code が原因で発生した bug が **実際に observe された**（「いつかバグるかも」は理由にならない）
- **diff size reduction measurable** — abstraction 導入 PR の diff が `+lines < -lines` で **少なくとも 20% 縮む** ことを示せる
- **observability consistency cannot be maintained manually** — `mirror_events` の rows shape / finalize 順序が、duplicate 構造のままでは整合維持不能であると **観測結果ベース** で示せる

### 6.3 abstraction 導入が認められない動機

- **「美しさ」** — 美しさは abstraction 導入の根拠にならない
- **「DRY 原則」だけ** — DRY を満たすだけの abstraction は導入しない（[architecture_rules.md](../principles/architecture_rules.md) 追補）
- **「将来の mirror で再利用したい」** — 未来の mirror が確定していない abstraction は YAGNI 違反
- **「pattern 統一」** — 4 mirror が同じ shape を持っているという事実そのものは abstraction の理由にならない
- **「helper 統合」** — helper 統合のための統合は禁止（rollback 単位を file-local に保つことを優先）

### 6.4 abstraction 解禁時の制約

abstraction が解禁される条件を満たした場合でも:

- 解禁判断は **本ドキュメント PR でのみ** 行う（runtime PR の付帯変更として「足しました」と判定しない）
- abstraction PR は **1 PR = 1 abstraction** を維持し、mirror 配線と混ぜない
- abstraction 後も **rollback unit が degrade しない** ことを示す（abstraction を revert すれば boundary が以前の状態に戻る）

---

## 7. Runtime Invariants

grep ベース invariant の固定セット。本ドキュメントが「現在の boundary 状態」を保証する根拠は以下の検出可能性に依存する。

- **`.select(` 禁止** — `lib/supabase/` 配下の mirror runtime コードから `.select(` を呼ばない。`grep -rn "\.select(" lib/supabase/` が **mirror helper 内に hit しない** ことを以て read path 不在を確認する
- **mirror runtime writer 単一性** — 各 `mirrorXxxToSupabase` の dispatch site は 1 箇所のみ。`grep -rn "mirrorXxx" .` が **mirror 自身の export 1 件 + dispatch 1 件** に収束する
- **mirror は submit / save path のみ** — render path / server component / hydration 前 effect から mirror を起動しない（[`phase1_runtime_strategy.md §12 Hydration Safety Expectations`](./phase1_runtime_strategy.md)）
- **read path なし** — runtime コードから `mirror_*` table を select しない / `mirror_events` を select しない
- **mirror failure が canonical UX を止めない** — `mirrorXxxToSupabase` は **never throws**。`MirrorResult` 戻り値で UI 判定を許さない（fire-and-forget 推奨）
- **kill-switch always wins** — `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` が立っていれば mirror 全停止される。`shouldSkipMirror({ killSwitchActive })` 経由で必ず判定される
- **`mirror_events` が唯一の observability source** — feature mirror の結果は `mirror_events` table 経由でのみ persist される。独立の sink を新規に切らない

これらは [`phase1_runtime_strategy.md §5 Allowed`](./phase1_runtime_strategy.md) / [`§6 Forbidden`](./phase1_runtime_strategy.md) の再宣言。本ドキュメントは違反検出の **grep 起点** を提供する。

---

## 8. Allowed Future Directions

Phase1 期間中 **禁止**、Phase2 以降で **初めて検討** される方向性。Phase1 PR でこれらを「準備として」配線することは禁止する。

- **auth integration** — login UI / session management / user identity 確定
- **user_id** — mirror payload / RLS / 検索条件への user_id 導入
- **RLS tightening** — anonymous write-only → user-scoped read+write への移行
- **retention jobs** — TTL / archival / partition rotation の operator-driven 自動化
- **dashboards** — operator 用 / user 用 dashboards（Supabase Studio + 専用 UI）
- **read APIs** — runtime から mirror を読む経路（fallback / restore のいずれも Phase2 以降）
- **analytics** — BigQuery / dbt / OLAP 連携
- **append-only mirrors** — `interview_records` 等の append-only 履歴 mirror
- **AI-output mirrors** — `wallHittingResult`, `statement_prepare_summary`, `essayPracticeReview` 等の AI canonical artifact mirror
- **sharded payload tables** — JSONB 1 column を関係正規化する場合の table 分割

これらは [`feature_rollout_matrix.md §12 Features Explicitly Deferred`](./feature_rollout_matrix.md) と整合。Phase2 計画着手時に本ドキュメントの後継（仮: `docs/supabase/phase2_boundary.md`）を起票し、現在の freeze 契約を段階的に解く。

---

## 9. Freeze Declaration

> **Phase1 boundary is considered operationally complete at N=4.**

宣言:

- **N=4（studentProfile / basicInfo / diagnosis / activityData）** の mirror セットを Phase1 の最終 boundary とする
- 本 boundary は **「次の機能追加」のための踏み台ではなく、operational stabilization layer そのもの**
- 新規 mirror / 新規 abstraction は本ドキュメントの **[§5 Mirror Addition Gate](#5-mirror-addition-gate)** / **[§6 Abstraction Threshold Rule](#6-abstraction-threshold-rule)** を満たさない限り追加しない
- 本 boundary を変更する PR は、本ドキュメントの **PR を先行** させる（doc-first）
- Phase2 移行は本ドキュメントの後継ドキュメントで定義する

freeze 解除の **唯一の経路** は本ドキュメントの PR であり、runtime PR の付帯変更として freeze を解除しない。

---

## 10. Operator Environment Contract

Phase1 期間中、operator が kill-switch を flip した際の **propagation contract** を明文化する。STEP-PHASE1O の boundary pressure audit で発見された documentation drift（「再 deploy 不要」の誤記）を受けて、本セクションが **operator-facing single source of truth** として正本になる。

### 10.1 The two operator-facing kill-switches

| 環境変数 | 影響範囲 | sole reader |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` | 4 mirror すべての upsert を `disabled` に倒す | [`lib/supabase/mirrorConfig.ts`](../../lib/supabase/mirrorConfig.ts) |
| `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` | `mirror_events` への INSERT のみを抑止（mirror upsert は継続） | [`lib/supabase/mirrorEventSink.ts`](../../lib/supabase/mirrorEventSink.ts) |

両者は **独立** であり、`true` / `1` / `yes`（case-insensitive）で ON。それ以外（unset / `false` / `0` / 任意文字列）で OFF（fail-open）。

### 10.2 Build-time inlining contract

**最重要 invariant**:

- `NEXT_PUBLIC_*` 環境変数は Next.js の build phase で **client bundle に inlining** される。client JS は env を runtime に読まず、build 時に baked-in された値を使う。
- したがって **「Vercel dashboard で env var を変更しただけ」では client 挙動は変わらない**。値変更後の **redeploy（新 build + 新 deploy）** を経て初めて kill-switch が反映される。
- `lib/supabase/mirrorConfig.ts` / `lib/supabase/mirrorEventSink.ts` の module-level cache (`cachedEnabled` / `cachedSinkEnabled`) は per-page-load の最初の read 結果を保持するが、これは「env が baked-in 後の値を再読みしない」ための optimization であり、build-time inlining の代替ではない。
- operator は常に **「env var 変更 → redeploy → verification」を 1 セット** として扱う。

### 10.3 Stale client behavior

- 既存に開かれている browser tab（モバイル user の長時間滞在 / PWA cache / bfcache 復元 / 開きっぱなしの session）は **新 deploy を取得するまで旧 bundle で動作** する。
- redeploy 完了直後でも、stale client は新 kill-switch 値を知らない。新 page load / hard reload を経て初めて新 bundle が download される。
- `activityData` mirror は submit-driven trigger のため、stale tab が submit を行わない限り mirror は発火しない。redeploy 直後の "残響" は他 3 mirror（save-driven）より小さく観測される。

### 10.4 Phase1 kill-switch posture

kill-switch は **operational best-effort control** であり、**instant global shutdown system ではない**。具体的に:

- **deploy propagation lag**: redeploy 反映までに数十秒〜数分、stale client 解消までに数時間〜数日（モバイル user の tab lifetime に依存）
- **partial propagation acceptable**: Phase1 anonymous infra であり、stale client の旧挙動が canonical UX を壊さない（mirror は best-effort）ため、propagation lag を許容する
- **immediate hard stop が必要な場合**: `DROP TABLE` / RLS policy 入れ替え 等の **Supabase 側 operator 操作** が唯一の即時停止経路。kill-switch は redeploy 経路、Supabase 側操作は **client deploy と独立に即時反映** する dual-rail 設計
- **rollback**: kill-switch を OFF に戻す場合も同じ redeploy 経路。revert deploy が最速

### 10.5 Operator runbook（standard procedure）

env var を flip する際の標準手順:

1. **Vercel dashboard** → Project → Settings → Environment Variables
2. 対象 scope（`Production` / `Preview` / `Development`）に env var を追加または値変更
3. **Redeploy** を起動（Vercel UI の "Redeploy" ボタン、または next commit の自動 deploy 待ち）
4. deploy 完了後、`mirror_events` を query して propagation を verify:
   - `mirror_disabled` を起こした場合: `mirror_status='disabled'` の row が新規発生
   - `observability_disabled` を起こした場合: 該当環境からの `mirror_events` INSERT が止まる（観測そのものが見えなくなる）
5. stale client 残量を accept（Phase1 では監視継続のみ、強制停止は §10.4 の Supabase 側経路）

immediate kill が必要な incident（PII 漏洩疑い等）では:

- step 1–3 を並行して走らせる **と同時に** Supabase 側で `DROP TABLE {mirror_table}` または anon-insert policy 撤去で物理停止
- redeploy 完了を待たず、stale client の追加 INSERT も Supabase 側で拒否される状態を作る

### 10.6 Why Phase1 accepts build-time env

Phase1 で runtime-config / remote feature flag を導入しない理由:

- **complexity budget**: Phase1 は localStorage canonical + Supabase mirror の 2 軸のみで動く。runtime config endpoint / Vercel KV / Edge Config / middleware を導入すると infra 軸が増え、boundary が肥大化する（[`phase1_boundary_freeze.md §6 Abstraction Threshold Rule`](#6-abstraction-threshold-rule) と整合）
- **operational dual-rail is sufficient**: Phase1 で求められる operator control は「（1）通常の deploy 経由の kill」「（2）incident 時の Supabase 側即時 kill」の 2 系統で十分。"instant" は dual-rail の (2) で達成されており、(1) に runtime config を被せる operational ニーズが現時点で無い
- **anonymous infra で UX 影響ゼロ**: stale client の propagation lag が canonical UX を破壊しない（mirror は best-effort）。runtime config の即時性が UX 上の必須要件ではない
- **Phase2 で再評価**: authn / user-scoped read が入る Phase2 / Phase3 で runtime-readable feature flag table（`feature_flags` 等）の導入を検討する。Phase1 で先回り実装しない

これらは [`phase1_boundary_freeze.md §6 Abstraction Threshold Rule`](#6-abstraction-threshold-rule) の「便利そうだから」を禁止理由とする方針と整合した運用判断。

---

## 締めくくり

Phase1 boundary の価値は **「mirror が動いても動かなくても canonical UX が壊れない」** という invariant を維持し続けることそのものにある。
N=4 時点での duplication / per-feature ファイル群 / 共通化されていない skip flow は、Phase2 へ向けた負債ではなく **「壊れにくさ」を最適化点として選んだ意図的な設計** であり、Phase1 期間中はこの形を保つ。
abstraction も新規 mirror も、**operational risk と observability readiness が要求する** タイミングでのみ追加されるべきであり、「便利そう」「綺麗そう」「pattern が揃っている」という incremental な動機を gate で reject することが、Phase1 全体の予測可能性を担保する。
