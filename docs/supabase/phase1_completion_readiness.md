# Phase1 Completion Readiness Audit

PASSAI Supabase 移行 Phase1 を **「完了宣言して良いか」** を production-readiness 観点で最終監査する。本ドキュメントは実装 STEP ではなく **Phase1 → Phase2 の境界 gate review**。

関連: [phase1_boundary_freeze.md](./phase1_boundary_freeze.md), [phase1_boundary_pressure_audit.md](./phase1_boundary_pressure_audit.md), [phase1_runtime_strategy.md](./phase1_runtime_strategy.md), [migration_phases.md](./migration_phases.md), [feature_rollout_matrix.md](./feature_rollout_matrix.md), [phase1_completion_checklist.md](./phase1_completion_checklist.md)

---

## 1. Completion Audit Purpose

なぜ「完了宣言前監査」が必要か:

- Phase1 は **「backend migration」ではなく「observability boundary establishment」**。完了 = backend が動き始めた、ではない。完了 = 「Supabase が無くても feature が完動する」状態を **observable に保証できる infrastructure** が確立した、を意味する。
- 完了宣言は **Phase2 / Phase3 への進行 gate** であり、宣言後は本ドキュメントの後継（`phase2_runtime_strategy.md` 等）で初めて read path / auth / canonical shift が議論される。Phase1 完了宣言が早すぎると、Phase2 設計が観測値ベースではなく即興判断ベースになる。
- 完了宣言の根拠は **「足したもの」ではなく「足さなかったもの」と「壊れていない invariant」** の両方を verify する必要がある。本監査は両方を網羅する。
- 半年後 / Phase2 着手時に「あの時 Phase1 は何が完了していたのか」を辿れる **historical record** として機能する。

本ドキュメントは contract / audit memo であり、runtime 修正のスイッチではない。

---

## 2. Phase1 Scope Review

| Category | Goal | Status | Evidence | Remaining Gap | Phase2? |
|---|---|---|---|---|---|
| Mirror infrastructure | 4 feature mirror wired (N=4) | ✅ COMPLETE | `lib/supabase/mirrorStudentProfile.ts` / `mirrorBasicInfo.ts` / `mirrorDiagnosis.ts` / `mirrorActivityData.ts` 4 ファイル landed / 各 mirror 1 dispatch site grep 確認済 | mirror addition gate（[`phase1_boundary_freeze.md §5`](./phase1_boundary_freeze.md)）以降の追加は別 STEP | next mirror は order 5+（observability 安定後） |
| Observability | `mirror_events` 経由の 4 結果分類 + 失敗種別記録 | ✅ COMPLETE | `mirrorFinalize.finalize()` を唯一の exit point として 4 mirror 全てが invoke / `mirrorEventSink.emitMirrorEvent` が `mirror_events` table へ INSERT / kill-switch `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` 独立 | `durationMs` field 未送出 / payload_size 観測未実装 | latency / size 観測整備 |
| Rollback | mirror PR revert / kill-switch / table drop の 3 段防御 | ✅ COMPLETE | 各 mirror PR 独立 / `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` で全停止 / `DROP TABLE` で物理停止 / dual-rail kill ([`§10.4`](./phase1_boundary_freeze.md)) | — | unchanged |
| Runtime isolation | mirror 失敗が canonical UX を止めない | ✅ COMPLETE | `mirrorXxxToSupabase` は never throws / dispatch site 4 箇所すべて `.catch(() => {})` / mirror result が UI 判定に使われない / render path に mirror 起動なし | — | unchanged |
| Read-path prevention | runtime から Supabase を読まない | ✅ COMPLETE | `grep -rn ".select(" lib/supabase/ app/ hooks/ lib/` で **runtime hit 0** | — | Phase2 で fallback read 解禁検討 |
| PII handling | direct-strip / no-PII / narrative-soft の 3 pattern validate | ✅ COMPLETE | basicInfo `stripName()` / diagnosis no-PII payload / activityData narrative-soft + operator sign-off | retention 自動化未実装 | retention 自動化 / RLS tightening |
| Kill-switch control | mirror / observability の 2 系統独立 | ✅ COMPLETE | `mirrorConfig.ts` sole reader / `mirrorEventSink.ts` sole reader / fail-open / module cache + build-time inlining | runtime-readable feature flag は Phase1 では意図的に未導入 | Phase2 で runtime feature flag 検討 |
| Freeze governance | mirror / abstraction 追加の gate 明文化 | ✅ COMPLETE | [`phase1_boundary_freeze.md §5 / §6`](./phase1_boundary_freeze.md) で 9 必須条件 + 7 禁止動機 / abstraction AND 条件 6 件 | freeze 解除は doc-first | Phase2 着手 PR で本契約を継承 |
| Operator documentation | env / rollback / soak の operator-facing 手順 | ✅ COMPLETE | 4 schema preview + 2 post-apply checklist + observability sink runbook + [`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md) | retention runbook 未起票 | retention / dashboards STEP |
| Drift prevention | grep / invariant の検出可能性 | ✅ COMPLETE | runtime invariant 7 項目（[`phase1_boundary_freeze.md §7`](./phase1_boundary_freeze.md)）+ developer misuse audit 9 項目（[`phase1_boundary_pressure_audit.md §7`](./phase1_boundary_pressure_audit.md)）+ [`phase1_completion_checklist.md`](./phase1_completion_checklist.md) で mechanical 検証可能 | grep-based CI lint 未整備 | CI hook 整備（任意） |

**Scope verdict**: 10 categories すべて ✅ COMPLETE。残存 gap は Phase2 / 別 operational STEP に属する性質のもので、Phase1 完了宣言を blocking しない。

---

## 3. Architecture Completeness Audit

| Check | Verdict | Evidence |
|---|---|---|
| Mirror boundaries isolated? | **PASS** | `lib/supabase/` 配下のみが Supabase client / env を import。`@supabase/*` の import が他ディレクトリにゼロ（[`client_boundary.md §4`](./client_boundary.md) と整合） |
| Runtime reads absent? | **PASS** | `.select(` runtime grep = 0。`mirror_events` の SELECT 経路もゼロ。read path が物理的に存在しない |
| Canonical state ownership clear? | **PASS** | localStorage が唯一の canonical / `lib/*Storage.ts` 単一窓口 / mirror は副次的書き込み先のみ ([`phase1_runtime_strategy.md §4`](./phase1_runtime_strategy.md)) |
| Feature boundaries stable? | **PASS** | studentProfile / basicInfo / diagnosis / activityData 各 feature の canonical helper API が Phase1 期間中 unchanged ([`phase1_runtime_strategy.md §10`](./phase1_runtime_strategy.md)) |
| Rollback units independent? | **PASS** | 各 mirror が独立 PR で landed / file-local `MIRROR_TABLE` 定数 / `onConflict: source_hash` で per-feature idempotency / kill-switch flip が他 mirror に副作用なし |
| Observability centralized? | **PASS** | `mirrorFinalize.finalize()` が 4 mirror すべての唯一 exit point / `mirror_events` 1 table が durable sink / in-memory `mirrorMetrics` は副次 |
| Abstraction pressure contained? | **PASS** | N=2 / N=3 で必要な primitive のみ抽出（`mirrorGuard` / `mirrorFinalize` / `mirrorSourceHash`）/ N=4 時点で freeze ([`phase1_boundary_freeze.md §6`](./phase1_boundary_freeze.md)) / `upsertMirror` 等の generic helper 不在 |

**Architecture verdict**: 7/7 PASS。

---

## 4. Operational Completeness Audit

| Check | Verdict | Evidence |
|---|---|---|
| Operator can stop mirrors? | **PASS** | `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` + redeploy（[`phase1_boundary_freeze.md §10`](./phase1_boundary_freeze.md)）/ Supabase 側 `DROP TABLE` も独立に機能 / dual-rail kill 設計 |
| Operator can detect floods? | **PARTIAL** | `mirror_events` 直接 query で件数 / status 分布 / failure_reason 分布が観測可能 / per-feature soak query は post_apply_checklist に整備済 / **ただし** payload_size の per-row 観測は未整備（pressure audit §4.3 で「整備すべき閾値」を提案のみ） |
| Operator can identify stale deployments? | **PASS** | `mirror_events.environment` + `mirror_events.client_version`（`NEXT_PUBLIC_APP_COMMIT`）で識別可能 / [`phase1_boundary_pressure_audit.md §11.2`](./phase1_boundary_pressure_audit.md) で stale tab 認識を明文化 |
| Operator can rollback safely? | **PASS** | 3 段防御（PR revert / kill-switch / `DROP TABLE`）+ canonical UX 無影響 invariant / [`phase1_boundary_freeze.md §10.5 Operator Runbook`](./phase1_boundary_freeze.md) で incident response 手順明文化 |
| Operator docs coherent? | **PASS** | STEP-PHASE1P 完了後、全 schema preview / post-apply checklist が `phase1_boundary_freeze.md §10` を single source of truth として cross-reference / "再 deploy 不要" 誤記の解消済 |
| Deploy expectations documented? | **PASS** | build-time inlining contract + redeploy 必須 + stale client behavior が [`phase1_boundary_freeze.md §10.2-§10.4`](./phase1_boundary_freeze.md) で明文化 |

**Operational verdict**: 5 PASS + 1 PARTIAL。PARTIAL は payload_size 観測の未整備（operator が flood は検知できるが per-row size flood は手動 query が必要）。Phase1 完了 blocking ではないが Phase2 序盤の improve 候補。

---

## 5. Invariant Enforcement Audit

| Invariant | How enforced | How verified | How it could break | Phase1 acceptable? |
|---|---|---|---|---|
| No runtime read | mirror helper / dispatch site とも `.select(` を呼ばない設計 / `mirrorEventSink` も INSERT only | `grep -rn ".select(" lib/supabase/ app/ hooks/ lib/` runtime hit 0 を CI / PR review で検証 | 未来の開発者が "fallback read を Phase1 で先取り" / observability dashboard を runtime に組み込む | ✅ |
| Mirror best-effort only | `mirrorXxxToSupabase` の contract: `Promise<MirrorResult>` で never throws / `finalize` で `void emitMirrorEvent` | dispatch site 4 箇所すべて `.catch(() => {})` / mirror result の UI 利用ゼロ | sentry capture を mirror 内に追加 / retry loop / mirror Promise を await して UI 遷移 | ✅ |
| Canonical UX independent | mirror layer 削除しても UX が bit-identical な構造 / restore path に Supabase なし | `lib/supabase/` ディレクトリを思考実験で削除しても storage / UI 動作不変 | mirror 結果に基づく UI 分岐追加 / restore path の async Supabase fetch | ✅ |
| Submit-driven activityData | dispatch site が `useActivityForm.handleSubmit` 1 箇所のみ | `grep -rn "mirrorActivityData" hooks/` で dispatch 1 件 + `saveActivityData`（autosave path）に mirror なし | autosave 経路に mirror dispatch 追加 / onChange に紐付け | ✅ |
| Single runtime writer | 各 mirror が 1 dispatch site のみ | `grep -rn "mirror{Feature}"` で feature ごと dispatch 1 件 | 別 component / hook から並列 dispatch / mirror_events を別 sink でも書く | ✅ |
| Centralized observability | `mirrorFinalize.finalize()` を唯一 exit point として 4 mirror が invoke / `mirror_events` 1 table のみ | 各 `mirrorXxx.ts` の return 文がすべて `finalize(...)` を経由 | feature 固有 sink を新規作成 / `incrementMirrorMetric` を直接外部から呼ぶ | ✅ |
| Kill-switch precedence | window check inline → `shouldSkipMirror({ killSwitchActive })` → env check → client check の順序固定 | 4 mirror すべて同順序 / `shouldSkipMirror` 内部の skip-reason 優先順位 | 順序変更 / kill-switch を後段に移動 / `false` を disable と誤実装 | ✅ |
| Rollback safety | PR revert / kill-switch / table drop が独立に機能 | git history で各 mirror PR の独立性確認 / kill-switch dual-rail（[`§10.4`](./phase1_boundary_freeze.md)） | cross-cutting refactor を mirror PR に同居 / abstraction 経由化 | ✅ |

**Invariant verdict**: 8/8 invariant が enforceable + verifiable。Phase1 完了宣言の最も重要な根拠。

---

## 6. Deferred Risk Register

Phase1 で **intentionally deferred** したもの一覧。各項目について「なぜ defer か」「いつまで acceptable か」「escalation trigger は何か」を記録する。

| Item | Why deferred | Acceptable until when | Escalation trigger |
|---|---|---|---|
| **auth integration** | Phase1 は anonymous で完動が前提 / authn 導入は Phase2 の独立 STEP | Phase2 着手まで | user-scoped read が必要になった瞬間 / RLS tightening が runtime 要求になった瞬間 |
| **user_id in payload** | authn 未導入のため意味的に未定義 / RLS / 検索条件に user_id を含めない設計 | Phase2 着手まで | authn が landing して payload に user 識別子を載せる必然性が生じた瞬間 |
| **runtime config / feature flags** | Phase1 complexity budget 内に収まる operational ニーズが build-time env で充足 / [`phase1_boundary_freeze.md §10.6`](./phase1_boundary_freeze.md) | Phase2 着手まで | incident response で "redeploy lag が UX に直結" が観測された瞬間 / per-user / per-cohort kill-switch が必要になった瞬間 |
| **dashboards** | Supabase Studio 直 query で operator needs を充足 / dashboard 構築は別 infra | Phase2 着手まで | operator 数増加 / non-engineer による monitoring が必要になった瞬間 |
| **retention automation** | TTL / partition / archival は Phase1 では手動 operator action / scale pressure 顕在化前は acceptable | `mirror_events` 累積 > 1 GB / row 数が観測コスト圧迫まで | pressure audit §4.3 の operator intervention 閾値に到達 / Postgres index degradation が観測された瞬間 |
| **read APIs** | Phase1 は read path 不在が invariant / Phase2 の責務 | Phase2 着手まで | "Supabase の方が新しい" を runtime で解決したい強い要求が出た瞬間（その時点で Phase2 着手 STEP） |
| **append-only mirrors** | `interview_records` 等の履歴 mirror は冪等性設計が別途必要 / Phase1 後期で個別判定 | Phase1 後期 or Phase2 | feature_rollout_matrix の order 9 (`interview_records`) 着手判定時 |
| **analytics warehouse** | BigQuery / dbt / OLAP は infra 軸増加 / `mirror_events` は infra observability であり analytics layer ではない | Phase3 着手まで（または独立 analytics STEP） | business metric として mirror データを使いたい要求が出た瞬間 |
| **payload sharding** | JSONB 1 column で物理的に通る / 正規化分解は schema drift 面積を増やす | activity_mirrors の累積 size が pressure audit §4.3 閾値に到達まで | Postgres TOAST overhead が観測値で問題化 / per-row query latency が顕在化 |
| **AI-output mirrors** | `wallHittingResult` / `statement_prepare_summary` / `essayPracticeReview` 等は restore semantics と最も衝突しやすい / [`feature_rollout_matrix.md`](./feature_rollout_matrix.md) order 12+ | order 1–4 mirror 観測安定後 | observability sink で前段 feature の成功率が graduation 閾値（95%）を超え、AI restore flow への着手判断材料が揃った瞬間 |

これらは Phase1 完了宣言を blocking しない。Phase2 着手 STEP の入力 / scope 判定材料として再利用する。

---

## 7. Remaining Blind Spots

「正直ベース」で、Phase1 完了宣言時点でも **まだ分かっていないもの** を列挙する。これらは observation を要するため、`docs` だけでは解消できない性質のもの。

| Blind Spot | Why still unknown | Resolution path |
|---|---|---|
| **mirror_events の real-world failure ratio** | 本番 traffic を流していないため、`unknown` / `network_error` / `schema_mismatch` の実分布が不明 | post-apply 24h–7d soak（各 checklist §5 / §6）で観測 |
| **activityData payload size 分布** | submit-driven のため流量予測が realistic max しか分かっていない / abuse 系の tail behavior は不明 | 7-day soak で `length(payload::text)` の p50 / p90 / p99 を観測 / 閾値超過 row のサンプリング |
| **stale client tail length** | mobile / PWA / bfcache の tab lifetime が user 群依存 / 旧 `schema_version` row の減衰曲線が未観測 | redeploy 後 30-day で `mirror_events.schema_version` 別件数推移を観測 |
| **kill-switch 実 propagation lag** | Vercel build / CDN propagation の実 latency が production で未測定 | kill-switch flip 後の `mirror_events.mirror_status='disabled'` 出現 lag を計測 |
| **anonymous abuse 流入** | Phase1 anonymous-write RLS が攻撃的 bot に対してどこまで耐えるか未観測 | rate spike alarm + `mirror_events` の異常な burst で fast-path kill ready |
| **schema apply 状態の operator awareness** | 4 mirror table DDL は `supabase/schema.sql` にコミット済だが、operator が live project に apply しているかは本ドキュメント時点では未確認（apply は operator action） | post-apply checklist §2.1 の "first success row appears" query で operator が確認 |
| **dispatch import 失敗の頻度** | `void import('@/lib/supabase/...')` の dynamic import 失敗（CDN miss / network blip）の rate が未観測 | Phase2 で observability に dynamic import 失敗を載せる余地（現状は `.catch(() => {})` で吸収のみ） |

「production traffic を流すまで分からないもの」を **隠さず** 明記することで、Phase1 完了宣言が観測ベースで段階的に「強くなる」状態を保つ。Phase1 完了宣言 ≠ blind spot ゼロ。

---

## 8. Phase Boundary Clarity Audit

Phase1 / Phase2 / Phase3 の境界を **runtime 振る舞いの差** で固定する。

### 8.1 Phase 別 capability matrix

| Capability | Phase1（現在） | Phase2 | Phase3 |
|---|---|---|---|
| canonical store | **localStorage 一択** | localStorage primary + Supabase fallback read | **Supabase canonical** |
| Supabase write | best-effort mirror（後段、fire-and-forget） | mirror 継続 | canonical write |
| Supabase read | **不在**（physically zero `.select(` ） | localStorage 空時の二次ソース read 許可 | primary read |
| auth | 不在（anonymous で完動） | authn 導入済 / user-scoped read | authn 必須 |
| user identity | payload に含まない | user_id を識別子として併送 | user_id が canonical 識別子 |
| `mirror_events` 用途 | infra observability | rollout 判断材料 / fallback hit rate 観測 | canonical write の monitoring に再利用 |
| operator dashboards | Supabase Studio 直 query | 専用 operator dashboards 整備 | user-facing data view（admin / self） |
| feature flag mechanism | build-time env のみ | runtime-readable flag 検討 | runtime feature flag standard |
| retention | 手動 operator action | 自動 retention / partition | TTL + archival 標準化 |
| analytics | 不在 | 不在 | 別 STEP で BigQuery 等 |

### 8.2 「今どこにいるか」

**Phase1 後期 — completion 宣言直前の状態**。

- mirror infrastructure landed (N=4)
- observability sink 配線完了
- freeze contract 確立 / operator runbook 整備済
- 本ドキュメントで **完了宣言可能性を最終 audit** している段階
- 7-day soak 観測 / mirror table apply（operator action）は **Phase1 完了 と並行** して進行する operational step
- Phase2 着手 STEP は **未起票**。本ドキュメントの後継として `phase2_runtime_strategy.md` を別 STEP で起票する想定

### 8.3 Phase 越境を防ぐための boundary 強制

- **Phase 進行は doc-first**: 本ドキュメントの後継（`phase2_runtime_strategy.md` 等）を **PR 先行** で merge してから Phase2 runtime PR を出す
- **runtime PR が phase boundary を侵食しないこと** を本 audit / `phase1_boundary_freeze.md` で reject 可能
- **Phase 別の `migration_phases.md` capability** が runtime PR の scope 判断 gate になる

---

## 9. Final Readiness Verdict

### 9.1 Strongest Achievement

**runtime UX を Supabase 状態から物理的に切り離した状態**。

- `.select(` runtime hit 0 → read path 不在の **物理的保証**
- mirror layer を `lib/supabase/` ごと削除しても canonical UX が bit-identical → "Supabase なしで完動" を contract ではなく **構造** で担保
- 4 mirror × 1 dispatch site × `.catch(() => {})` × `never throws` の 4 重防御 → mirror 失敗が UX に伝播する経路がゼロ
- 3 PII pattern × 2 trigger contract の組み合わせを N=4 で validate → 後続 feature の PII / trigger 判定が既知 pattern の組み合わせで決まる

これは「Phase1 で達成した最大のもの」であり、Phase2 / Phase3 への進行の **前提条件** そのもの。

### 9.2 Weakest Unresolved Point

**production traffic に対する soak 観測が完了していない**。

- 4 mirror の table apply は operator action として未確定（schema.sql には DDL がコミット済だが live project への apply 状態は本ドキュメント時点で operator-confirmed ではない）
- 各 post-apply checklist の §5 / §6 7-day soak は未実施（traffic 蓄積が前提）
- `activity_mirrors` payload size の real-world tail behavior が未観測（pressure audit §4.3 閾値は推定）
- stale client の tail length が未測定

これらは **runtime 設計の弱点ではなく operational 観測の未蓄積** であり、本 STEP のような doc-driven audit では解消不能。Phase1 完了宣言と並行して進行する。

### 9.3 Why Phase1 Can Freeze

- **architecture completeness 7/7 PASS / invariant 8/8 enforceable** — runtime 構造が「次に何を足すか」ではなく「足さないことが invariant」として固定された
- **freeze governance が doc-first** — `phase1_boundary_freeze.md §5 / §6` が mirror / abstraction 追加の gate を独立に保持しており、runtime PR が freeze を回避できない
- **dual-rail kill posture が確立** — incident response が code change を要しない（[`§10`](./phase1_boundary_freeze.md)）
- **deferred risk register が明示** — defer したものが明文化され、escalation trigger が観測ベースで定義されているため、未来の判断が即興にならない

つまり「Phase1 で十分」ではなく「Phase1 でこれ以上足すと invariant が崩れる」状態に到達している。

### 9.4 What Absolutely Must NOT Happen Before Phase2

以下が起きた瞬間、Phase1 完了状態は破壊される。Phase2 着手 STEP までの間、これらを禁止する:

1. **runtime コードに `.select(` を追加すること** — read path 不在 invariant の破壊
2. **mirror result の UI 表示 / await による UI 分岐** — best-effort 契約の破壊
3. **autosave 経路 / onChange に mirror dispatch を追加** — submit-driven contract の破壊（activityData）
4. **`upsertMirror` 等の generic abstraction の追加** — rollback unit / observability 粒度の破壊
5. **Supabase 読み取りを canonical state 化** — phase 定義そのものの破壊
6. **`mirror_events` を runtime から query** — observability infra の runtime feature 化
7. **runtime config endpoint / Vercel KV / Edge Config の導入** — complexity budget 超過 / Phase2 設計自由度の破壊
8. **新規 mirror の追加（[`phase1_boundary_freeze.md §5`](./phase1_boundary_freeze.md) gate を満たさないもの）** — N=4 freeze の破壊

これらは [`phase1_boundary_freeze.md §7 Runtime Invariants`](./phase1_boundary_freeze.md) と整合した禁止リストであり、本 STEP では追加新規 invariant ではない。

### 9.5 Whether Phase1 Completion Declaration Is Justified

**Justified — with operational caveats**。

- **architecture / runtime / freeze governance / operator documentation** の 4 軸は完了宣言の根拠を満たす
- **operational soak / schema apply / observation baseline** の 3 軸は完了宣言と並行して進行中であり、宣言 blocking ではない（これらは「Phase1 が動き始めた」後でしか観測できない性質）
- Phase1 完了宣言は **「runtime 構造が freeze 可能な状態に到達した」** ことを意味し、production traffic 蓄積後の rollout judgment は Phase2 着手 STEP の input になる

詳細な mechanical 検証は [`phase1_completion_checklist.md`](./phase1_completion_checklist.md) で行う。本ドキュメントは判定根拠を提供し、checklist は判定の **再現可能性** を保証する。

---

## 締めくくり

Phase1 は **「backend を入れた」段階ではなく「Supabase が無くても完動する状態を observable に保証する infrastructure が確立した」段階**。完了宣言は Phase2 への進行 gate であり、宣言は「足したもの」と「足さなかったもの」の両方に依拠する。
runtime 構造 / freeze governance / operator runbook の 3 軸が完了している以上、Phase1 完了宣言は justified。残る operational caveats は宣言と並行して進行する性質のものであり、宣言を blocking しない。
Phase2 着手 STEP は本ドキュメントの後継として、observed soak data を入力にして起票される。
