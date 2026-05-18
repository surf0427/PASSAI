# Phase1 Completion Declaration

PASSAI Supabase 移行 Phase1 を **operationally complete** として正式宣言する closing document。

> **2026-05-17 STEP-SOAK-1 update — observability metadata patch landed**:
> [`soak_launch_audit.md`](./soak_launch_audit.md) で identified した 3 つの mirror_events 観測ギャップ (`schema_version` / `client_version` / `duration_ms` 常時 NULL) は observability metadata patch STEP で解消した。`finalize(feature, result, meta)` が `meta.schemaVersion` + 計測 `duration_ms` を強制 propagate し、`readClientVersion()` が `NEXT_PUBLIC_APP_COMMIT` 未設定時に `"unknown"` sentinel を返す。Phase1 invariant (no read / no abstraction / dispatch site 不変 / canonical 不変 / kill-switch fail-open / 3 段防御独立) は維持。詳細は [`soak_launch_audit.md §6 / §9 / §12`](./soak_launch_audit.md) と [`phase1_soak_runbook.md §2.4 / §3.4`](./phase1_soak_runbook.md) 参照。

本ドキュメントは:

- Phase1 で **達成したもの** を最終固定する
- Phase1 で **意図的にやらなかったもの** を最終固定する
- soak 開始の **operational gate** を確立する
- Phase2 着手前に **絶対壊してはいけない invariant** を再宣言する

関連: [phase1_boundary_freeze.md](./phase1_boundary_freeze.md), [phase1_boundary_pressure_audit.md](./phase1_boundary_pressure_audit.md), [phase1_completion_readiness.md](./phase1_completion_readiness.md), [phase1_completion_checklist.md](./phase1_completion_checklist.md), [phase1_soak_runbook.md](./phase1_soak_runbook.md), [migration_phases.md](./migration_phases.md), [phase1_runtime_strategy.md](./phase1_runtime_strategy.md)

---

## 1. Declaration Purpose

なぜ completion declaration が必要か:

- **Phase boundary lock**: Phase1 完了が doc 化されていないと、Phase2 着手 STEP が「Phase1 で何が完了しており / 何が未完か」を即興判断することになる。本ドキュメントを doc-first の root にすることで、Phase2 設計が **観測された soak data + 確定した Phase1 invariant** を入力にできる。
- **Soak handoff の境界**: soak 観測は production traffic を要するため、code / docs では完結しない。本宣言が「ここから先は observation が responsibility」という handoff の境界点になる。
- **Freeze の最終固定**: STEP-PHASE1N で freeze 契約、STEP-PHASE1O で pressure audit、STEP-PHASE1P で operator contract、STEP-PHASE1Q で readiness audit を積み上げてきた。本宣言が一連の Phase1 closing STEP の **顶点** として、未来の reader が「Phase1 はここで止まった」を 1 file で読めるようにする。
- **「未完」の正直な明文化**: completion declaration は「すべて完了した」を意味しない。observation-only / Phase2 deferred / production blind spot を **完了状態の一部として** 明文化することで、未来の判断が現実ベースで起票される。

### Definition

| 用語 | 本ドキュメントでの定義 |
|---|---|
| **Completion** | runtime 構造 / freeze governance / operator runbook が "Phase1 invariant を維持しながら soak を回せる状態" に到達したこと |
| **Not completed** | (1) operator 側 schema apply / soak observation の **実施そのもの** (2) Phase2 で扱う deferred risk (auth / read paths / dashboards / runtime config 等) |
| **Operationally complete** | architecture / runtime / docs が完了 + operator action と soak が並行進行可能な状態 |

本ドキュメントは **Operationally complete** を宣言する。

---

## 2. What Phase1 Achieved

Phase1 が **実際に landed させたもの** を最終固定する。

### 2.1 Architecture / runtime achievements

| Achievement | Evidence |
|---|---|
| **Observability boundary established** | `lib/supabase/` ディレクトリが Supabase client / env / mirror dispatch / observability sink の唯一の境界。`@supabase/*` 直 import は同ディレクトリ外でゼロ |
| **4 mirror architecture stabilized (N=4)** | `mirrorStudentProfile.ts` / `mirrorBasicInfo.ts` / `mirrorDiagnosis.ts` / `mirrorActivityData.ts` が landed / 3 PII pattern × 2 trigger contract を validate |
| **No runtime reads** | `.select(` runtime hit 0 — read path 不在の物理保証 |
| **localStorage canonical preserved** | `lib/*Storage.ts` 群が canonical 窓口の単一性を維持 / restore semantics 不変 / cache semantics 不変 |
| **Rollback-safe mirror infra** | PR revert / kill-switch / `DROP TABLE` の 3 段防御独立 / dispatch site 単一性 grep verifiable |
| **Centralized observability** | `mirrorFinalize.finalize()` が 4 mirror すべての唯一 exit point / `mirror_events` 1 table が durable sink / in-memory `mirrorMetrics` が副次 |
| **Freeze governance** | [`phase1_boundary_freeze.md §5 Mirror Addition Gate`](./phase1_boundary_freeze.md) / [`§6 Abstraction Threshold Rule`](./phase1_boundary_freeze.md) が mirror / abstraction 追加の gate を doc-first で固定 |
| **Operator contract formalized** | [`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md) が build-time inlining / dual-rail kill / operator runbook の single source of truth |

### 2.2 Doc surface achievements

Phase1 期間中に整備された operator-facing / contributor-facing doc 群:

- contract docs: `migration_phases.md` / `phase1_runtime_strategy.md` / `client_boundary.md` / `schema_boundary_policy.md`
- design / inventory: `feature_rollout_matrix.md` / `mirror_observability.md` / `observability_sink.md` / `schema_phase1_student_profile.md`
- schema previews × 4: `student_profile` / `basic_info` / `diagnosis` / `activity`
- post-apply checklists × 3: `basic_info` / `diagnosis` / `activity`
- closing docs: `phase1_boundary_freeze.md` / `phase1_boundary_pressure_audit.md` / `phase1_completion_readiness.md` / `phase1_completion_checklist.md` / 本ドキュメント / `phase1_soak_runbook.md`

これらは Phase2 設計の **input set** として再利用される。

---

## 3. What Phase1 Explicitly Did NOT Do

以下は **意図的に Phase1 ではやらなかった** もの。Phase2 / Phase3 の責務として deferred。

| Not done | Why deferred | Phase 帰属 |
|---|---|---|
| **Backend migration** | Phase1 は observability boundary 確立のみ。canonical は localStorage のまま | Phase3 |
| **Canonical Supabase state** | localStorage が canonical / mirror は best-effort 副次 | Phase3 |
| **Runtime reads** | `.select(` 不在を invariant として固定 | Phase2 で fallback read を解禁検討 |
| **Auth integration** | Phase1 は anonymous で完動 | Phase2（独立 STEP） |
| **User sync / cross-device** | authn 未導入のため未定義 | Phase2+ |
| **Dashboards** | Supabase Studio 直 query で operator needs を充足 | Phase2 |
| **Analytics infra** | BigQuery / dbt / OLAP は infra 軸を増やす / `mirror_events` は infra observability layer のみ | Phase3 / 別 STEP |
| **Runtime config / feature flags** | Phase1 complexity budget 内で build-time env が充足 / [`phase1_boundary_freeze.md §10.6`](./phase1_boundary_freeze.md) | Phase2 |
| **Append-only persistence** | `interview_records` 等の append-only 履歴は冪等性設計が別途必要 | Phase1 後期 / Phase2 |
| **AI-output mirrors** | `wallHittingResult` / `statement_prepare_summary` / `essayPracticeReview` は restore semantics と最も衝突しやすい | Phase1 後期 / Phase2 |
| **Retention automation** | TTL / partition / archival は手動 operator action / scale pressure 顕在化前は acceptable | Phase2 |
| **Read APIs** | Phase1 は read path 不在 invariant の物理境界 | Phase2 |

**「準備として」これらを Phase1 で触ることも禁止**（[`phase1_runtime_strategy.md §6`](./phase1_runtime_strategy.md) / [`feature_rollout_matrix.md §12`](./feature_rollout_matrix.md)）。

---

## 4. Final Invariants

Phase1 完了時点での **最終 invariant 一覧**。これらは Phase2 着手 STEP（仮 `phase2_runtime_strategy.md`）が doc-first で landed するまで **inviolable**。

| # | Invariant | Verification |
|---|---|---|
| 1 | **`.select(` runtime に不在** | `grep -rn ".select(" lib/supabase/ app/ hooks/ lib/` runtime hit 0（README literal 除く） |
| 2 | **mirror best-effort only** | `mirrorXxxToSupabase` は never throws / dispatch site 4 箇所すべて `.catch(() => {})` / mirror result が UI 判定に渡らない |
| 3 | **canonical UX independent** | `lib/supabase/` ディレクトリ削除でも canonical UX が bit-identical（思考実験ベースで検証可能） |
| 4 | **submit-driven activityData** | `mirrorActivityData` dispatch が `hooks/useActivityForm.ts:handleSubmit` 1 箇所のみ / autosave 経路 (`saveActivityData`) に dispatch なし |
| 5 | **single runtime writer per mirror** | 4 mirror それぞれ dispatch site が 1 箇所のみ（grep verifiable） |
| 6 | **centralized `mirror_events`** | `mirrorFinalize.finalize()` が唯一 exit point / `mirror_events` 1 table が durable sink |
| 7 | **build-time kill-switch** | `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` / `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` が build-time inlining + module-level cache / fail-open / redeploy 必須 |
| 8 | **rollback-safe units** | PR revert / kill-switch / `DROP TABLE` の 3 段防御独立 / cross-cutting refactor を mirror PR に同居させない |

これらは [`phase1_boundary_freeze.md §7`](./phase1_boundary_freeze.md) と整合し、[`phase1_completion_checklist.md §1 / §7`](./phase1_completion_checklist.md) で mechanical 検証可能。本宣言時点で **8/8 hold**。

---

## 5. Soak Launch Contract

operator が soak 観測を **開始してよい** 条件 + soak 中の禁止事項を固定する。詳細手順は [`phase1_soak_runbook.md`](./phase1_soak_runbook.md) が担当、本セクションは **gate 契約** のみ。

### 5.1 Soak launch gates（全て満たすこと）

- [ ] **schema applied**: 4 mirror table + `mirror_events` table が Supabase project に apply 済（[`phase1_completion_checklist.md §4`](./phase1_completion_checklist.md)）
- [ ] **`mirror_events` reachable**: 各 feature の `mirror_events` で `mirror_status='success'` row が apply 後 24h 以内に > 0 件出現
- [ ] **no unexpected runtime errors**: `npx tsc --noEmit` / `npx eslint lib/supabase/` が exit 0
- [ ] **activityData submit-only verified**: form 上で typing するだけで `mirror_events.feature='activityData'` row が増えない（typing-only verification、[`activity_post_apply_checklist.md §3.3`](./activity_post_apply_checklist.md)）
- [ ] **kill-switch verification complete**: `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` + redeploy 後、対象 feature の mirror_events に `mirror_status='disabled'` row が出現
- [ ] **no pending mirror PR**: [`phase1_boundary_freeze.md §5`](./phase1_boundary_freeze.md) gate を満たさない mirror が in-flight でない
- [ ] **no pending abstraction PR**: [`phase1_boundary_freeze.md §6`](./phase1_boundary_freeze.md) AND 条件を満たさない abstraction が in-flight でない

### 5.2 Soak 中にやってはいけない変更

soak 観測期間中（典型 7-day soak）、以下は **PR を起票してはならない**:

- runtime コードへの mirror dispatch 追加 / 移動 / 削除
- `MIRROR_TABLE` constant の rename / 移動
- `SCHEMA_VERSION` の bump（soak data の連続性が破壊される）
- mirror 結果に基づく UI 分岐の追加
- `mirror_events` を runtime から query するコード
- abstraction の preview / prototype（feature_rollout_matrix の次 feature の "準備" 配線も禁止）
- kill-switch 値の連続 flip（観測 baseline が不安定になる）
- `NEXT_PUBLIC_APP_COMMIT` / `NEXT_PUBLIC_VERCEL_ENV` の意味変更

これらが必要になった場合、soak を **中断** して原因を別 STEP で起票する。soak 中の "ついで修正" は観測値の意味論を破壊する。

---

## 6. Soak Observation Targets

各 target について **why it matters / what counts as abnormal / what action to take** を明文化する。詳細クエリは [`phase1_soak_runbook.md`](./phase1_soak_runbook.md) を参照。

| Target | Why it matters | Abnormal threshold | Action |
|---|---|---|---|
| **mirror success ratio** (per feature) | best-effort 契約が現実の数字で機能していることの最小 confirmation | 7-day 連続で daily `success_rate < 0.95` | failure_reason 分布を調査 / graduation 保留 |
| **`network_error` distribution** | apply 直後の数件のみ想定。継続的増加は RLS / schema / table 不在を示唆 | 24h 累積で前週 baseline × 5 倍以上 | Supabase Studio で `mirror_*` table 存在 / RLS policy を確認 |
| **activityData payload distribution** | narrative-soft PII の現実 size を可視化 / abuse 検知 | 99p > 推定値 5× / single row > 5 MB | [`phase1_boundary_pressure_audit.md §4.3`](./phase1_boundary_pressure_audit.md) の閾値判定 → operator intervention 検討 |
| **stale client persistence** | redeploy 後の旧 bundle 残存量を観測 | redeploy 後 30 日以上、旧 `schema_version` / `client_version` 比率が 5% 以上 | observe only — Phase1 では強制停止しない |
| **kill-switch propagation lag** | redeploy 後 kill-switch 反映までの実 latency 測定 | flip 後 1h 経過しても `mirror_status='disabled'` row が出現しない | Vercel deploy 状態 / DISABLED_VALUES 設定 / module cache 動作を確認 / `client_version` 列で stale bundle と現 bundle を粗く識別（STEP-SOAK-1 後 / `NEXT_PUBLIC_APP_COMMIT` 未設定時は sentinel `"unknown"`） |
| **mirror volume anomaly** | abuse / loop / autosave leak 検知 | 24h 件数 > 前週 baseline × 10 / 24h 件数 < baseline × 0.1 | abuse なら kill-switch flip + Supabase 側 RLS 撤去 / 過少なら kill-switch 状態を確認 |
| **unexpected `schema_version` mix** | partial deploy / stale tab tail / migration 進行の識別 | 同時刻 traffic 内に 2 以上の `schema_version` が共存 | deploy 状態を operator 確認 / 通常は acceptable |

これらは Phase1 期間中の **observation target** であり、SLO ではない。閾値到達は incident 起票の signal であって自動 alarm の前提ではない。

---

## 7. Incident Escalation Ladder

incident 発生時の段階的対応。各 level は **trigger / expected blast radius / UX impact** を明示。

### Level 0 — Observation only

- **Trigger**: 異常 signal が観測されたが、原因が確定していない / canonical UX に影響していない
- **Blast radius**: なし（観測のみ）
- **UX impact**: なし
- **Action**: `mirror_events` query / Supabase Studio 直確認 / operator log 確認 / 必要なら Level 1 へ昇格判定

### Level 1 — Mirror disable via env + redeploy

- **Trigger**: 単一 mirror または全 mirror の挙動が明らかに異常 / abuse 流入 / unexpected schema mismatch flood
- **Blast radius**: 4 mirror すべてが `disabled` に倒れる（global kill-switch / per-feature kill-switch は Phase1 では実装していない）
- **UX impact**: ゼロ（mirror layer は infrastructure。canonical UX は localStorage のみで完動）
- **Action**: Vercel dashboard で `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` → redeploy → propagation 観測（[`phase1_boundary_freeze.md §10.5`](./phase1_boundary_freeze.md)）

### Level 2 — Observability disable

- **Trigger**: `mirror_events` 自体に問題（量過多 / RLS reject / Supabase 側 sink 問題） / observability sink が canonical 観測の bottleneck になっている疑い
- **Blast radius**: mirror upsert は継続するが `mirror_events` への INSERT が停止
- **UX impact**: ゼロ
- **Action**: `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED=true` → redeploy → `mirror_events` の問題を別 STEP で調査
- **Caveat**: Level 1 + Level 2 同時 ON は完全沈黙 — in-memory counter 以外の観測手段が消える。incident response 中は意図的に並行 ON する判断は許すが、放置しないこと

### Level 3 — Supabase-side immediate stop

- **Trigger**: PII 漏洩疑い / 緊急停止が redeploy lag より速くなければならない / RLS 突破の疑い
- **Blast radius**: 対象 table への INSERT が **client deploy と独立に即時** reject される（dual-rail kill の fast path）
- **UX impact**: ゼロ
- **Action**: Supabase SQL Editor で:
  - `DROP TABLE {mirror_table};` または
  - `DROP POLICY "{policy}" ON {mirror_table};` で anon insert 撤去
- **Caveat**: Level 1 と並行実施。Level 3 単独だと stale client が continued attempt → `mirror_events` に `failure / network_error` が積み上がる（UX 無影響だが noise）

### Level 4 — Full rollback

- **Trigger**: mirror layer / observability sink が runtime PR で fundamental に破壊された（例: invariant 違反 PR が landed して revert 必要）
- **Blast radius**: 対象 PR の revert / `mirror_events` の row 蓄積継続 / canonical は不変
- **UX impact**: ゼロ（canonical UX は revert 前後で bit-identical のはず）
- **Action**: PR revert → kill-switch ON で並行運用 → `mirror_events` で revert 効果を verify → 別 STEP で再設計

### Cross-level note

- すべての level で **canonical (localStorage) は不変**。incident response 中も user data は user 自身の手元（localStorage）に残る
- Level 0 → 1 → 2 → 3 → 4 は **段階的** ではなく **並行使用可能**。incident severity に応じて任意組み合わせを起動する
- Level 1 / 2 / 4 は **redeploy 経路（slow path）**、Level 3 は **Supabase 経路（fast path）**。両 rail を独立に使えるのが Phase1 設計の最大の防御

---

## 8. Phase Boundary Lock

Phase1 完了宣言と同時に、以下を **再宣言** する。これらは Phase2 着手 STEP（仮 `phase2_runtime_strategy.md`）が doc-first で landed するまで **解禁不可**。

### 8.1 Phase1 中に禁止されるもの

- **runtime reads** — `.select(` を `lib/supabase/` 配下 / runtime コードに追加しない
- **mirror abstraction** — `upsertMirror(table, payload)` / `mirrorFactory` / `mirrors/index.ts` aggregator を追加しない（[`phase1_boundary_freeze.md §6`](./phase1_boundary_freeze.md)）
- **new mirrors** — N=4 freeze gate（[`phase1_boundary_freeze.md §5`](./phase1_boundary_freeze.md)）を満たさない feature を mirror に入れない
- **feature flags** — runtime-readable flag table / polling / SSE を導入しない
- **runtime config** — Vercel KV / Edge Config / middleware の dynamic config を導入しない
- **analytics infra** — BigQuery / dbt / OLAP / 別 sink への二重書きを導入しない
- **dashboards** — operator 用 / user 用 dashboard を作らない（Supabase Studio で十分）
- **canonical ownership change** — localStorage canonical を Supabase / sessionStorage / 別 store に部分的にも移さない

### 8.2 解禁条件

上記いずれかを解禁するには:

1. **Phase2 design doc を doc-first で起票** — 解禁対象 invariant / 解禁の代償 / 設計境界を明文化する
2. **本ドキュメント + `phase1_boundary_freeze.md` の PR で freeze を解除** — Phase2 design doc が landed した後に、本 freeze 契約 PR を別途出す
3. **Phase2 runtime PR は (1) + (2) の後** にのみ landed 可能

「Phase2 design doc なしでは解禁不可」を本宣言で固定する。

### 8.3 Why this lock matters

- Phase1 boundary は **「次の機能のための踏み台」ではなく "壊れにくさ" の最適化点**。lock なしでは "ついで refactor" が boundary を侵食する
- Phase2 設計は **観測された soak data を入力に doc-first で起票** されるべき。lock があることで「Phase2 設計の input は soak data + Phase1 invariant のみ」が制約として機能する
- 未来の contributor / operator が「Phase1 はここで止まった」を **物理的に確認できる** 状態を維持する

---

## 9. Completion Declaration

> ## Phase1 is operationally complete.

**正式宣言**:

1. **Phase1 is operationally complete** — runtime / freeze governance / operator documentation / drift prevention の 4 軸が完了している ([§2](#2-what-phase1-achieved) / [§4](#4-final-invariants))
2. **Remaining work is observational** — schema apply / soak observation / production blind spot resolution は本宣言と並行して進行する operational step であり、宣言を blocking しない ([§5](#5-soak-launch-contract) / [§6](#6-soak-observation-targets))
3. **Phase2 requires new boundary negotiation** — Phase2 着手は本ドキュメント + freeze の boundary を解除する別 STEP（仮 `phase2_runtime_strategy.md`）が doc-first で起票されてから ([§8](#8-phase-boundary-lock))
4. **Current boundary frozen at N=4** — studentProfile / basicInfo / diagnosis / activityData の 4 mirror セットを Phase1 の最終 boundary とする。新規 mirror / 新規 abstraction は freeze 契約 PR で gate を解除するまで追加不可

### 9.1 Declaration date and scope

- **Declaration scope**: PASSAI `feature/supabase-migration` branch における Phase1
- **Boundary state**: N=4 mirror landed / 0 read path / 0 runtime drift
- **Effective from**: 本ドキュメント PR が landed した時点。soak は本宣言の **直後または並行** に operator action として開始する

### 9.2 What this declaration does NOT mean

- 「mirror が production で完全に動いている」を意味しない（soak 結果次第）
- 「Phase2 着手の準備が整った」を意味しない（soak data が Phase2 設計の input）
- 「invariant が永遠に維持される」を意味しない（boundary lock は doc-first 解除可能）

### 9.3 What this declaration DOES mean

- Phase1 期間の **architectural / governance / doc 作業は終わり**
- Phase1 invariant が **soak 期間中も維持される** 契約が確立
- Phase2 設計 STEP は本宣言と soak data を **input** にして起票される
- 未来の reader が「Phase1 はここで止まった / 何が固定されたか」を 1 file で読める状態に到達

---

## 締めくくり

Phase1 は **「Supabase を入れた」段階ではなく「Supabase が無くても完動する状態を observable に保証する infrastructure が landed した」段階**。本宣言で完了するのはこの infrastructure 確立であり、production traffic に対する観測は soak で続く。
N=4 boundary が freeze contract / operator runbook / 8 invariant lock に支えられている限り、Phase2 への進行は doc-first で予測可能に進む。本宣言は Phase1 closing の **最終 anchor** として、未来の Phase 進行 PR が参照する root document となる。
