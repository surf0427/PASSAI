# Phase1 Boundary Pressure Audit (Post-Freeze Reality Check)

[`phase1_boundary_freeze.md`](./phase1_boundary_freeze.md) で宣言した N=4 boundary を、**設計思想ではなく現実運用圧力** ベースで監査する。

「綺麗か」ではなく **「半年後に壊れないか」** を見る。

関連: [phase1_boundary_freeze.md](./phase1_boundary_freeze.md), [phase1_runtime_strategy.md](./phase1_runtime_strategy.md), [client_boundary.md](./client_boundary.md), [mirror_observability.md](./mirror_observability.md), [observability_sink.md](./observability_sink.md), [feature_rollout_matrix.md](./feature_rollout_matrix.md)

---

## 1. Audit Purpose

freeze 宣言は「abstraction / mirror を勝手に増やさない」ことを保証するが、それは **半年後に boundary が現実運用に耐える保証ではない**。本ドキュメントは以下を独立 axis で監査する:

- runtime に紛れ込む silent dependency
- payload growth による operational pressure
- operator がやらかすシナリオ
- 未来の開発者がやらかすシナリオ
- observability が degrade した時に何が見えなくなるか
- stale deployment / partial deploy 由来の不整合
- schema-version drift の許容範囲
- Supabase 側 outage 時の posture

監査の出力は **「Phase1 期間中に許容する blind spot のリスト」** と **「freeze 解除を検討すべき signal のリスト」** の 2 つ。

本ドキュメントは contract / audit memo であり、runtime 修正のスイッチではない。修正が必要な事項を発見した場合は **別 STEP として起票** する。

---

## 2. Pressure Categories

| Category | Pressure Source | Current Mitigation | Remaining Risk | Phase1 Acceptable? | Phase2 Direction |
|---|---|---|---|---|---|
| **Runtime Pressure** | mirror Promise の resolution / latency / error が caller に漏れる | `void import(...).then(...).catch(() => {})` パターン × 4 dispatch site、`finalize` が `void emitMirrorEvent(...)`、helper は `never throws` 契約 | `useActivityForm.handleSubmit` の outer `try/catch` が mirror import 本体（dynamic import 失敗時）をキャッチする境界が **import-level error** に限られる — mirror が完全に独立した promise chain にいるため、`then` 内例外も `.catch(() => {})` で吸収される | ✅ acceptable | unchanged — same pattern for Phase2 fallback read |
| **Payload Pressure** | activityData JSONB 行サイズの未上限化、narrative free-text の copy-paste 流入 | `mirror_events` 1 行 = 1 submit（submit-driven contract）/ Supabase JSONB 1 column / `onConflict: source_hash` で同一 content の重複は idempotent UPDATE | client-side `payload` size cap **無し**。Postgres TOAST 圧縮で 1 GB まで物理的に通過する。realistic max ≈ 50–150 KB / row だが abuse シナリオで MB 級まで上振れ可能 | ⚠️ acceptable but monitor — operator が `payload` size 90p / 99p を観測する手順は未整備 | per-row size cap / `BYTEA` size summary column / per-feature soft limit を検討 |
| **Operational Pressure** | operator が kill-switch を flip しても **redeploy するまで反映されない**（`NEXT_PUBLIC_*` は Vercel build 時に inlining される）。`mirrorConfig.ts` / `mirrorEventSink.ts` の module-level cache が「一度読んだら更新されない」を更に強化 | kill-switch 2 系統（mirror / observability）が独立しており、片方の事故が他方に伝播しない。observability sink は mirror INSERT を妨げない（fire-and-forget の void chain） | **検証不十分の blind spot**: 既存 operator checklists の **「`NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` で再 deploy 不要」記述** は build-time inlining の現実と矛盾する（[§5 Kill-Switch Audit](#5-kill-switch-audit) 5.3 参照） | ⚠️ acceptable but doc-correction needed | runtime-readable feature flag table（Supabase 側 `feature_flags`）で `NEXT_PUBLIC_*` 依存を脱却 |
| **Developer Pressure** | 未来の開発者が「Phase1 boundary は既に成立しているから足すだけ」と認識して runtime dependency を増やすリスク | [`phase1_boundary_freeze.md §5 Mirror Addition Gate`](./phase1_boundary_freeze.md) + [`§6 Abstraction Threshold Rule`](./phase1_boundary_freeze.md) + grep ベース invariant + [feature_rollout_matrix.md §13 Anti-patterns](./feature_rollout_matrix.md) | freeze ドキュメントを読まずに PR を出す開発者が出現するシナリオが残る。CI で grep invariant を自動検証していない | ⚠️ acceptable but CI hook 検討の余地 | grep-based CI lint（`.select(` / `mirrorXxx` の dispatch site 単一性検証） |
| **Observability Pressure** | mirror_events 自体が失敗すると mirror がブラックボックスになる。`NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` が ON のときは沈黙が二重化される | observability sink が `try { ... } catch {}` で完全に吸収 / `mirror_events` table 不在でも `mirror_events.failure_reason=network_error` のメタ蓄積はされない（`mirror_events` 自身が落ちると `void error` で破棄）/ feature mirror 側に `incrementMirrorMetric` の in-memory counter（`mirrorMetrics.ts`）が残る | observability 完全停止時に **mirror 成否を runtime から取り出す経路が存在しない**。in-memory counter は page-reload で消える。「mirror が動いていない」状態を operator が早期検知する手段が事実上 Supabase Studio の `mirror_events` 直接 query のみ | ⚠️ acceptable — Phase1 は anonymous infra で UX に影響しないため | Phase2 で uptime ping / alerting を別 sink に積む |
| **Deployment Pressure** | 旧 client が走っている browser（モバイル user の長時間滞在 / PWA cache）が **stale `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=false` で動き続ける** ケース。新 deploy で `true` にしても旧 client は止まらない | mirror 側に server-side 強制停止経路はない。**operator は RLS DELETE policy + table rename / DROP で物理停止できる**（Phase1 anonymous-write の特性として、operator の table-level 操作が常に最上位） | stale client が新 schema を破壊するシナリオ: stale client は旧 SCHEMA_VERSION を吐き、`mirror_events.schema_version` で識別可能。`source_hash` も SCHEMA_VERSION 包含で衝突しない | ✅ acceptable — Phase1 anonymous で UX 無影響 + 物理停止経路あり | server-fetched feature flag を導入する Phase2 で対応 |
| **Rollback Pressure** | mirror PR の revert が想定通り効くか / kill-switch でも止まらない事故時の fallback | 各 mirror が独立 PR で landed。grep で dispatch site 単一性が確認できる ([§3 Runtime Dependency Audit](#3-runtime-dependency-audit))。`NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` で全 mirror 停止 / `DROP TABLE` で物理停止可能 | revert と kill-switch の **両方** が同時に効かない事象は現実装上 unreachable（runtime が mirror result を一切利用していないため） | ✅ acceptable — 3 段防御（PR revert / kill-switch / table drop）が独立 | unchanged for Phase2 |
| **Scale Pressure** | `mirror_events` 行数の累積（4 feature × 1 submit/save あたり 1 row）/ anonymous-write RLS 下での INSERT スパイク | Postgres TOAST + standard indexing で当面は問題なし。`mirror_events` の retention は未設定（infinite growth） | 半年 / 1 年スパンで `mirror_events` 行数が増え続ける。retention policy / archival が未定義 | ⚠️ acceptable for 6 months — retention は Phase2 別 operational STEP で設計 | TTL partition / archival to cheap storage / observability の sampling |

---

## 3. Runtime Dependency Audit

確認したい invariant: **mirror の成功・失敗・存在に runtime UX が依存していないこと**。

| Surface | Pattern | Verdict |
|---|---|---|
| **conditional branching** | mirror result（`MirrorResult` / `success` / `failed` / `skipped`）に基づく分岐 | ✅ **存在せず**。grep でも `MirrorResult` を import している runtime コードは feature mirror 自身のみ。dispatch site（4 箇所）はすべて `.catch(() => {})` で promise を捨てている |
| **await dependency** | mirror Promise を `await` してから UI 遷移 | ✅ **存在せず**。dispatch は `void import(...).then(...).catch(() => {})` パターンで promise を `void` 化している。`router.push('/home')` は mirror promise を待たない |
| **render dependency** | render 関数 / server component が mirror state を読む | ✅ **存在せず**。mirror は React state を更新しない。`getBrowserSupabaseClient()` の戻り値も React state に入っていない |
| **loading state coupling** | mirror 中 loading spinner / disable button | ✅ **存在せず**。`useActivityForm.setIsLoading(false)` は `sessionStorage.setItem` 後 mirror dispatch とは独立にトリガー |
| **retry UX** | failure を見せて再試行 button | ✅ **存在せず**。`MirrorResult` を UI 表示する経路ゼロ |
| **state hydration assumptions** | mount 直後 effect が mirror 結果を読む | ✅ **存在せず**。restore は localStorage 一択（[`phase1_runtime_strategy.md §10`](./phase1_runtime_strategy.md)）。Supabase を読む経路が物理的に存在しない（`.select(` grep ゼロ） |
| **optimistic read assumptions** | 「mirror が成功している前提」で feature を分岐 | ✅ **存在せず**。mirror table / mirror_events を runtime からの read 対象にしていない |

`mirror failure が UX に影響する経路` は **物理的に存在しない**。これは Phase1 boundary の最大の強み。

---

## 4. Payload Growth Audit

各 feature について現実的な payload size を推定する。`mirror_events.payload_size` 相当の観測は現状未実装のため、本セクションは **推定 + 観測すべき指標** のドキュメント化。

### 4.1 feature 別 scenario 別推定

| Feature | small (常用) | medium (90p) | extreme (abuse / outlier) |
|---|---|---|---|
| `studentProfile` | 1–3 KB（AI synthesis 結果、`student_profile_contract.md` の固定 shape） | 5–8 KB | 20 KB（AI が長文 narrative を生成、prompt 設計上 cap あり） |
| `basicInfo` | 0.3–1 KB（form 5–10 fields） | 2 KB（`subjectGrades` 全埋め） | 5 KB（理論上限、`stripName` 後） |
| `diagnosis` | 0.5 KB（`answers: number[]` + enum） | 0.5 KB（shape 固定） | 0.5 KB（user 自由記述ゼロのため上振れ無し） |
| `activityData` | 5–15 KB（5 activities × 1 KB） | 30–80 KB（10–20 activities × medium narrative） | **MB 級まで物理的に通過可能** — narrative 9 系統 free-text に大量 copy-paste すると client-side cap が無いため Postgres TOAST 経由で 1 GB まで通る |

### 4.2 activityData specific scenarios

- **realistic max narrative**: 受験 1 年分の真面目な記述 → 20 activities × 9 narrative fields × 平均 300 文字 = 約 50 KB / row。Phase1 期間中の常用想定はここ。
- **copy-paste abuse**: ESSAY 草稿をそのまま `description` に貼る → 1 entry で 50–200 KB。realistic にあり得る。
- **accidental giant textarea**: 「メモを全部貼る」user → 1 entry で 500 KB–2 MB。runtime の `textarea` に `maxLength` 制限なし（要 [`hooks/useActivityForm.ts`](../../hooks/useActivityForm.ts) 確認）。発生確率は低いが防御もない。
- **repeated autosave risk**: STEP-PHASE1M で submit-driven contract に確定済み。autosave 経路 (`saveActivityData`) は mirror dispatch を **持たない**。再 grep 確認済み（[§ grep §](#grep-結果)）。
- **mobile reconnect replay**: `handleSubmit` は idempotent でない（連打防止は `isLoading` / `isSuccess` state のみ）。ただし `onConflict: source_hash` が UPDATE 経路に倒すため、同 content 再送は同 row UPDATE で済む。content 変更後再送は新 row。これは仕様通り。

### 4.3 operator intervention 閾値（提案）

現状 retention / size 監視は未実装だが、operator が検知すべき signal:

| Trigger | Action |
|---|---|
| `activity_mirrors` 単一行 > **5 MB** | client-side cap 検討（runtime change → 別 STEP） |
| `mirror_events` 24h 件数 > 前週平均 × **10** | abuse / loop の調査（kill-switch flip 検討） |
| `mirror_events` 24h 件数 < 前週平均 × **0.1** | kill-switch / table drop / RLS 設定の事故疑い |
| `activity_mirrors` 累積 size > **1 GB** | retention policy 起票 |
| feature 別 row サイズ 99p が前 30 日中央値の **5×** を超える | payload 仕様 drift / abuse の調査 |

これらの閾値は **observation 整備 STEP** で正式化する。本ドキュメントは方針のみ提示。

---

## 5. Kill-Switch Audit

`NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` と `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` の 2 系統を検証。

### 5.1 precedence

| State | mirror upsert | mirror_events INSERT |
|---|---|---|
| 両方 OFF（デフォルト） | 実行 | 実行 |
| MIRROR_DISABLED=true | skip（reason: `mirror_disabled`） | `mirror_status: "disabled"` で INSERT（observability は残る） |
| OBSERVABILITY_DISABLED=true | 実行 | skip（silent） |
| 両方 ON | skip | skip — **完全沈黙** |

両方 ON の状態は **observability blind spot** だが意図された設計（[`mirrorEventSink.ts` header §`The sink observing its own observability is not Phase1`](../../lib/supabase/mirrorEventSink.ts)）。

### 5.2 failure mode

- env vars が **空文字 / unset**: kill-switch OFF（デフォルト enabled）
- env vars が **`true` / `1` / `yes`**（case-insensitive）: kill-switch ON
- env vars が **`false` / `0` / `no` / その他文字列**: kill-switch OFF（**`false` を書いても無効化されない仕様** ← 直感に反する点なので operator misuse 候補）
- env vars が **同時に正しい値**: 両 kill-switch は独立に動作

### 5.3 stale deployment / partial deploy

**重大な blind spot として記録する:**

- `NEXT_PUBLIC_*` env vars は Next.js build 時に client bundle に **inlining** される。Vercel で env var を変更しても **redeploy するまで client は古い値で動作**。
- `mirrorConfig.ts` / `mirrorEventSink.ts` 内の **module-level cache (`cachedEnabled` / `cachedSinkEnabled`)** は per-page-load の最初の read 結果を保持するため、ページ遷移またぎでは挙動が一貫している。
- **既存 operator checklists（`basic_info_post_apply_checklist.md` / `diagnosis_mirror_schema_preview.md` 等）に "再 deploy 不要" の記述があった** → build-time inlining と矛盾する **operator 認識を誤らせるリスク**として記録。
  - **解消済 (STEP-PHASE1P)**: 4 schema preview / 2 post-apply checklist の文言を redeploy 必須に統一し、[`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md) を operator-facing single source of truth として確立。本 audit §11 が pressure 視点のリスク列挙を担当。

### 5.4 operator misuse

| Misuse | Result | Detectable? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=false` を書く（≠ disable） | mirror **継続実行**（`false` は DISABLED_VALUES に含まれない） | Vercel env var 設定の `false` 文字列を operator 自身が見直すしかない。`mirror_events` 観測では「mirror が動いている」事実しか見えない |
| 値だけ設定して redeploy 忘れ | client 側で kill-switch 未反映 | observable: `mirror_events.mirror_status='disabled'` が 0 件のまま続く |
| Production scope のみに設定し Preview / Dev に未設定 | env 違い | observable: `mirror_events.environment` 別の status 分布で気付ける |
| Observability だけ ON のつもりで Mirror も ON にしてしまう | mirror 全停止 | observable: 全 feature の upsert が止まる |

### 5.5 rollback behavior

- kill-switch 反映に redeploy が必要 → revert deploy で kill-switch を以前の状態に戻せる
- module-level cache は per-page-load なので revert deploy 後の新 page-load で新値が反映される
- 既存 in-flight mirror promise が cache flip で挙動を変えることはない（read は dispatch 直前のみ）

### 5.6 「kill-switch 自体が壊れたら」

シナリオ:

- `mirrorConfig.ts` が build 時に死ぬ → import 失敗 → mirror helper も import 失敗 → dynamic `import('@/lib/supabase/mirrorXxx')` が reject → dispatch site の `.catch(() => {})` で吸収。**UX 影響なし**。
- `process.env.NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` が undefined（unset）→ `readKillSwitchActive` returns `false` → kill-switch OFF（デフォルト enabled）。**fail-open**。
- Module cache が破損（理論上 unreachable）→ `cachedEnabled === undefined` のまま re-read → 期待動作。

**結論**: kill-switch が壊れても mirror が **fail-open** に倒れる設計。これは operational stabilization layer の哲学とは整合（mirror 失敗 ≠ UX 失敗）だが、**「kill-switch が壊れていることを kill-switch 経由で検知できない」** という二次 blind spot は残る。

### 5.7 acceptable Phase1 blind spots（kill-switch 系）

- `NEXT_PUBLIC_*` build-time inlining への依存
- module-level cache による per-page-load 固定
- `false` を書いても disable されない仕様（DISABLED_VALUES の意図）

これらは **意図された tradeoff**（implementation の単純さを保つため）。Phase2 で server-fetched feature flag に移行する際に同時に解消する。

---

## 6. Observability Degradation Audit

`mirror_events` が degrade した時に何が見えなくなるかを enumerate。

### 6.1 失敗種別 flood

| Flood パターン | 何が起きているか | 何が見えなくなるか |
|---|---|---|
| `unknown` failure_reason の flood | `mirrorXxx.ts` の `catch (err)` 経路。`err instanceof Error` で `err.name` を拾うが分類不能なエラー | 真の原因（network / CORS / DNS / TLS / RLS reject など）が区別できない。Phase1 では acceptable（分類粒度の細かさより failure ゼロを優先する哲学） |
| `disabled` flood | kill-switch ON 状態 | 「mirror が動かないのは意図的なのか / kill-switch flip ミスか」が operator 文脈無しでは区別不能 → operator checklist との突き合わせが必要 |
| `network_error` flood | PostgREST から `{ error: ... }` が返る。RLS reject / schema mismatch / table 不在 / connectivity の 4 系統 | `error.code` を `failure_reason` の details として記録するが、PostgREST 側のエラーコード taxonomy に依存 |
| schema mismatch flood | `mirror_events.schema_version` 列で識別可能だが、`activity_mirrors` 等の payload が schema_version 違いで rejection されるケースは現状 PostgREST `network_error` に吸収される | failure_reason が `network_error` に統合されるため schema 由来か network 由来か即時識別不能 |
| duplicate `source_hash` flood | `onConflict: source_hash` で UPDATE 経路に倒れるため flood とはならない。idempotent retake が成立する | （非該当） |

### 6.2 observability 完全停止

`NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED=true` 状態:

- `mirror_events` への INSERT は silently skip
- `mirrorMetrics.ts` の in-memory counter は引き続き increment（が page-reload で消える）
- `mirrorLogger.ts` の dev-only `console.debug` は引き続き発火（production では no-op）
- **production で observability disabled のまま mirror_events が止まると、mirror 挙動を runtime から取り出す経路がゼロ**

### 6.3 Phase1 で acceptable な blind spots

明示的に「Phase1 では見ない / 見えなくてよい」もの:

- 個別 mirror 失敗の **詳細 root cause**（PostgREST error の細分類 / network スタックの error breakdown）
- mirror **per-call latency 分布**（`durationMs` field は schema にあるが現在の helper では送出していない）
- mirror payload size の **per-row 観測**
- mirror 経由で書き込まれた **row の content** との突き合わせ（operator は Supabase Studio で直 query する想定）
- **user 単位の mirror 成功率**（anonymous 前提のため user_id がない）

これらを必要とする operational ニーズが出てきた時点で Phase2 観測整備 STEP に積む。

---

## 7. Developer Misuse Audit

未来の開発者がやりそうな事故と、それぞれの対策。

| Misuse | Why dangerous | How detectable | How prevented |
|---|---|---|---|
| **`.select()` を mirror file 内に追加** | Phase1 read path 不在の invariant が破壊される。canonical UX が Supabase に依存し始める | `grep -rn "\.select(" lib/supabase/` で即検出 | [`phase1_boundary_freeze.md §7 Runtime Invariants`](./phase1_boundary_freeze.md) + grep-based CI lint（未整備、推奨）|
| **mirror result を UI 表示** | `MirrorResult` が UI レンダリングに依存する → mirror failure が UX に表出 | dispatch site の `.then(...)` 戻り値が React state setter / toast に渡されているか PR diff で確認 | [`phase1_runtime_strategy.md §6 Forbidden Runtime Behaviors`](./phase1_runtime_strategy.md) で禁止明記 |
| **retry button 実装** | best-effort 契約違反 / retry storm のリスク / observability の signal/noise 破壊 | PR diff で `mirrorXxxToSupabase` の dispatch site が button onClick / retry hook に紐付いていないか | [`phase1_runtime_strategy.md §16 Anti-patterns: feature-local retry storms`](./phase1_runtime_strategy.md) |
| **save path ではなく onChange に mirror dispatch** | per-keystroke flood が `mirror_events` を圧迫 / row = intent 属性が破壊される | `mirror_events` 24h 件数の急増で detectable / PR diff の dispatch site でも grep 可能 | [`phase1_boundary_freeze.md §5.1 submit boundary が明確`](./phase1_boundary_freeze.md) + [STEP-PHASE1M 決定の `useActivityForm.handleSubmit` コメント](../../hooks/useActivityForm.ts) |
| **`upsertMirror(table, payload)` 等の abstraction 追加** | rollback unit が file-local から abstraction 経由になり revert 操作の複雑度が上がる / PII pattern / hash 戦略の差が abstraction に隠れる | PR diff で `lib/supabase/` 配下の新規 helper file 追加を検出 | [`phase1_boundary_freeze.md §6 Abstraction Threshold Rule`](./phase1_boundary_freeze.md) の AND 条件で reject |
| **Supabase read を canonical source 化** | Phase1 / Phase2 / Phase3 の phase 定義そのものが崩壊。canonical ownership が暗黙に Supabase に移る | `loadXxx` / restore 経路に `client.from(...)` / `.select(` 追加があれば即 grep 検出 | [`phase1_runtime_strategy.md §6` / `§8 Read Path Policy`](./phase1_runtime_strategy.md) |
| **mirror row count を KPI 利用** | mirror が success-rate-tracked metric になると best-effort 契約が事実上 binding になる / kill-switch flip / retention 操作が KPI dashboard を壊す | KPI dashboard 定義 / business metric 化のレビューで検出（コードでの自動検出は困難） | [`phase1_boundary_freeze.md §`本 freeze doc が "operational infrastructure, not app state"](./phase1_boundary_freeze.md) を再確認 |
| **mirror 失敗を sentry / error monitor に流す** | `mirror_events` と sentry の二重 sink になり「沈黙する」原則が崩れる | sentry capture を mirror helper 内に追加する diff を検出 | mirror helper header の `Never throws` + finalize が唯一の exit point の明文化 |
| **runtime から `mirror_events` を query** | observability が runtime feature 化される / observability sink への dependency 経路が runtime に侵入 | `grep -rn "mirror_events"` で runtime 側 SELECT を検出 | [`phase1_runtime_strategy.md §8 Read Path Policy`](./phase1_runtime_strategy.md) + observability sink header の `INSERT only. No reads.` |

---

## 8. Schema-Version Drift Audit

mirror schema と runtime SCHEMA_VERSION の組み合わせを matrix で確認。

| runtime SCHEMA_VERSION | DB schema | 挙動 | 識別可能性 |
|---|---|---|---|
| `"1"` | apply 前（table 不在） | INSERT は `network_error` で失敗 | `mirror_events.failure_reason = "network_error"` |
| `"1"` | v1 schema applied | 正常 upsert | `mirror_events.schema_version = "1"` |
| `"2"` runtime + `"1"` DB schema | 互換性次第。新規 column 追加なら通る / NOT NULL column 追加なら reject | reject 時は `network_error` / 通る時は `schema_version = "2"` 行が混入 | `mirror_events` で混在 |
| `"1"` runtime（stale tab）+ `"2"` DB schema | DB が拡張型（column 追加 / NOT NULL default）なら通る。RENAME / TYPE 変更があれば reject | reject 時は `network_error` | `mirror_events.schema_version = "1"` で stale tab を識別 |
| stale localStorage（旧 shape） | hash 入力 (`JSON.stringify(payload) + SCHEMA_VERSION`) が異なるため新 row として書き込まれる | 正常 upsert（content 違いは別 row） | `mirror_events.schema_version` で識別 |

### 8.1 partial deploy

- Vercel deploy が partial（preview / production の片方だけ）→ `mirror_events.environment` で識別可能
- A/B group の片方だけ新 SCHEMA_VERSION → `schema_version` で識別可能

### 8.2 stale mobile tab

- mobile user が長時間 tab open + bfcache 復元 → 旧 SCHEMA_VERSION の mirror が継続発火
- `onConflict: source_hash` により旧 content の重複は idempotent UPDATE
- 新規 content（typo 修正など）は **旧 SCHEMA_VERSION で新 row 作成** → `mirror_events.schema_version="1"` が `"2"` runtime deploy 後も観測される
- これは feature ではなく **観測上 acceptable な long-tail**。retention で削除する想定

### 8.3 stale localStorage

- 旧 shape の localStorage payload が新 SCHEMA_VERSION runtime で mirror される → hash 入力に新 SCHEMA_VERSION が含まれるため衝突なし
- 旧 shape が新 schema で reject される → `failure_reason = "network_error"`、canonical UX 無影響
- canonical 経路で旧 shape を再度 hydration → 旧 user が破壊されない（localStorage canonical 保護）

### 8.4 absorption capability

現在の設計が absorb できる drift:
- **stale tab × old schema_version**: ✅（hash + onConflict で安全）
- **partial deploy**: ✅（`environment` + `schema_version` 識別）
- **新 column 追加のみの DB schema 拡張**: ✅（payload JSONB は無関係 / Postgres column 追加は破壊なし）
- **新 NOT NULL column 追加**: ⚠️ runtime 側も同 deploy で更新が必要（partial deploy 時は失敗）
- **RENAME / TYPE 変更**: ⚠️ runtime / DB 同期 deploy 前提

absorb できない drift は **schema 設計時の制約事項** として `schema_boundary_policy.md` に既に明文化されている。Phase1 で運用上の追加対策は不要。

---

## 9. Freeze Stress Verdict

### 9.1 Strongest Point

**Runtime UX が mirror 結果に物理的に依存できない構造**。これは以下の積層で担保される:

1. dispatch site が `void import(...).then(...).catch(() => {})` パターン × 4 箇所のみ
2. `mirrorXxxToSupabase` が contract 上 `never throws`
3. `MirrorResult` 戻り値が dispatch site で握りつぶされる
4. `.select(` が `lib/supabase/` 配下にゼロ（read path 不在）
5. mirror table から runtime コードへの import が物理的に存在しない

**mirror layer を `lib/supabase/` ディレクトリごと削除しても canonical UX が bit-identical** という invariant が現在も成立。これが Phase1 boundary の存在理由そのもの。

### 9.2 Weakest Point

**activityData の payload growth と operator awareness**:

1. activityData は narrative-soft PII × payload 上限なし × `mirror_events.payload_size` 観測なし の **3 重 risk** が重畳
2. operator が `NEXT_PUBLIC_*` kill-switch を flip しても再 deploy が必要であることが既存 checklists で曖昧（"再 deploy 不要" の誤記）
3. `mirror_events` retention policy が無定義 → 半年〜1 年スパンで infinite growth

これらは Phase1 期間中は **observation で監視すべき blind spot**（修正は別 STEP）。

### 9.3 N=4 freeze が合理的な理由

- N=4 で **3 つの PII pattern**（direct-strip / no-PII / narrative-soft）と **2 つの trigger contract**（save-driven / submit-driven）が validate 済み
- 同形に見える 4 mirror の中身は **PII × hash × trigger** の 3 軸で各々別契約 → これ以上の abstraction は契約差を隠す
- 残りの未配線 feature（`feature_rollout_matrix.md` order 5+）は **observability sink 稼働 + 観測安定** を前提とする → 着手判断は観測値が必要であり、現時点で着手しないことが Phase1 哲学と整合
- 「次の mirror も同じ shape」が確定していない以上、abstraction を入れるべきデータが無い

### 9.4 Freeze 解除を検討すべき trigger

以下のいずれかが observable に発生した場合、本 freeze 契約 PR で解除条件を更新する:

1. **N >= 5 が観測値ベースで確定** — `feature_rollout_matrix.md` 順序 5+ のうち少なくとも 2 つが Phase1 着手判断の入力（observability 安定）を満たす
2. **identical logic block が 3 箇所以上で完全一致** — PII pattern / hash / trigger の **3 軸全てで一致** する mirror が 3 件以上 landed
3. **runtime bug が duplication 由来で発生** — duplicate 構造が原因で UX 影響のある bug が production で observe される（思考実験ではなく実観測）
4. **observability consistency が manual 維持不能** — `mirror_events.feature` の追加 / `failure_reason` enum 拡張のコスト / 整合性維持コストが abstraction 導入コストを実測で上回る
5. **payload growth が operator intervention 閾値**（§4.3）を超えて 1 週間以上継続
6. **kill-switch / observability の operational incident** が発生し doc 修正 / runtime-readable feature flag への移行が必要になる

これらは **「実観測 trigger」** であり、設計判断や思想変更による解除は禁止。

---

## 10. Audit Memo: Found Blind Spots

本 STEP で発見した blind spot のうち、Phase1 期間中に **解消が必要なもの** と **acceptable と判定したもの** を区別する。

### 10.1 解消が必要（別 STEP で起票）

| Blind Spot | Severity | Suggested Next Step |
|---|---|---|
| operator checklists の "再 deploy 不要" 記述が build-time inlining と矛盾 | medium | **解消済 (STEP-PHASE1P)** — `basic_info_post_apply_checklist.md` / `diagnosis_mirror_schema_preview.md` / `diagnosis_post_apply_checklist.md` / `activity_mirror_schema_preview.md` / `activity_post_apply_checklist.md` / `basic_info_mirror_schema_preview.md` の文言を redeploy 必須に統一し、[`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md) を正本化 |
| `mirror_events` retention policy が無定義 | medium-low | Phase1 中後期に retention 設計 STEP を起票 |
| grep-based CI invariant が未整備（`.select(` 検出 / dispatch site 単一性検証） | low | CI hook 整備 STEP（任意） |
| `durationMs` が `MirrorEvent` schema にあるが現 runtime helper で未送出 | low | Phase2 観測整備 STEP で latency 観測を有効化 |

### 10.2 acceptable と判定（Phase1 期間中は対応不要）

| Blind Spot | 判定理由 |
|---|---|
| `NEXT_PUBLIC_*` build-time inlining 依存 | Phase1 anonymous infra で kill-switch + table-drop の 2 段防御が独立に機能するため acceptable |
| `false` を書いても disable されない仕様 | DISABLED_VALUES の意図 / fail-open 設計と整合 |
| observability 完全停止時の runtime 取り出し経路ゼロ | Phase1 は UX に影響しない infra のため、Supabase Studio 直 query が operator の primary path として acceptable |
| `unknown` failure_reason の解像度の粗さ | failure ゼロを優先する哲学と整合。詳細分類は Phase2 |
| stale mobile tab の long-tail | `onConflict: source_hash` + `schema_version` 識別で absorb 可能 |
| `activity_mirrors` 単一行 size cap なし | observation 整備 → 閾値超過時に別 STEP として cap 検討（先回り cap は YAGNI） |

---

## 11. Environment Propagation Risk

STEP-PHASE1P で documentation drift が修正された後、本セクションが **operator-facing env propagation contract** を audit 視点で記録する。正本は [`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md)。本セクションはその **リスク列挙** に特化する。

### 11.1 Build-time inlining

- `NEXT_PUBLIC_*` は Next.js build phase で client bundle に inlining される。client JS は env を runtime に読まない
- Vercel dashboard の env var 変更は **次の build までは無効**。`mirrorConfig.ts` / `mirrorEventSink.ts` の module-level cache は build-time inlining の追加保護（cache が壊れていても build-baked 値が変わらない）
- operator action は **「env 変更 → redeploy → verification」を 1 セット** として扱う

### 11.2 Stale mobile tabs

- 長時間滞在する mobile user の tab は **新 deploy 取得まで旧 bundle で動作**
- redeploy 完了直後でも、stale tab は新 kill-switch 値を知らない
- `activityData` mirror は submit-driven trigger のため、stale tab が submit を行わなければ mirror 自体は発火しない（他 3 mirror は save 経路発火のため stale 発火率が高い）
- `mirror_events.client_version`（`NEXT_PUBLIC_APP_COMMIT`）で stale client を識別可能

### 11.3 CDN / edge propagation delay

- Vercel deploy 完了から CDN edge propagation 完了まで数十秒〜数分のラグ
- redeploy 直後の short window は **旧 client が新 deploy を取得しに来ても古い asset を受け取る**
- Phase1 anonymous infra で UX 影響ゼロのため propagation lag を許容

### 11.4 Partial deployment windows

- Vercel preview / production scope が片方だけ env 設定されているケース → `mirror_events.environment` で識別
- A/B canary rollout 中の片方だけ kill-switch flip → `mirror_events.environment` + `client_version` で識別
- Phase1 は anonymous で env 別に挙動差を持つ前提無し → partial 状態は「観測可能なノイズ」として acceptable

### 11.5 Operator expectation mismatch

- 過去 docs（修正前）が「再 deploy 不要」と誤記していたため、operator が env 変更だけで止まると信じる risk が存在した
- STEP-PHASE1P で全 operator-facing checklist / schema preview を redeploy-required に統一
- 今後 docs に新規 kill-switch 言及を追加する際は本 audit / [`phase1_boundary_freeze.md §10`](./phase1_boundary_freeze.md) を参照させる cross-link を必須とする

### 11.6 Why Phase1 still accepts this

- **dual-rail kill が成立**: kill-switch redeploy 経路（slow path）と Supabase 側 `DROP TABLE` / RLS 撤去（fast path）が独立に機能
- **anonymous infra**: stale client が canonical UX を壊さない。propagation lag が UX failure に直結しない
- **complexity budget**: runtime config endpoint / Edge Config / Vercel KV / middleware / websocket / polling / dynamic env loader の **いずれも Phase1 では禁止**（[`phase1_boundary_freeze.md §10.6`](./phase1_boundary_freeze.md)）。boundary 肥大の代償が現時点の operational ニーズを上回るため
- **Phase2 で再評価**: authn / user-scoped read が入る段階で runtime-readable feature flag を別 STEP で起票する

### 11.7 Verdict

`NEXT_PUBLIC_*` build-time inlining 由来のリスクは Phase1 期間中 **acceptable**。operator runbook + dual-rail kill posture + observability identification（`environment` + `client_version`）の 3 段で blind spot を回収しており、追加の runtime config 導入は YAGNI。本 STEP（PHASE1P）の docs 修正により operator expectation mismatch は解消した。

---

## 締めくくり

Phase1 boundary は **「綺麗さ」ではなく「壊れにくさ」を最適化点として** 成立しており、本監査でも runtime dependency / rollback path / read path 不在の 3 つの強み が verifiable に維持されていることを確認した。

最も重い blind spot は **operator 認知の中**（"再 deploy 不要" の誤記）と **payload growth の未観測**（activityData 特有）にあった。前者は STEP-PHASE1P で解消（[§11 Environment Propagation Risk](#11-environment-propagation-risk) / [`phase1_boundary_freeze.md §10`](./phase1_boundary_freeze.md)）。後者は observability 整備の別 STEP で対応する。runtime コードの修正は不要。

freeze は半年後も合理的に維持される見通し。解除 trigger（§9.4）は **設計判断ではなく実観測ベース** に固定されており、Phase 進行の予測可能性は損なわれていない。
