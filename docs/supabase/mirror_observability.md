# Supabase Mirror Observability

PASSAI における Phase1 Supabase mirror 書き込みの **観測契約** を、最初の mirror helper / 最初の observability sink が書かれる **前** に固定する。
本ドキュメントは「mirror が何をどう観測されるか」「観測が UX に影響しない保証はどう取るか」「観測値で何を判断するか」を規定し、後段の runtime PR が **観測項目を独自定義しないで済む** 状態を目指す。

関連: [migration_phases.md](./migration_phases.md), [client_boundary.md](./client_boundary.md), [phase1_runtime_strategy.md](./phase1_runtime_strategy.md), [feature_rollout_matrix.md](./feature_rollout_matrix.md), [ai_usage_observability.md](../principles/ai_usage_observability.md), [ai_cache_observability.md](../principles/ai_cache_observability.md), [architecture_rules.md](../principles/architecture_rules.md)

---

## 1. Purpose

- 最初の mirror helper / 最初の observability sink が書かれる **前** に、観測契約（event 分類 / 必須 field / 失敗分類 / skip 分類 / UX 隔離規約）を固定する
- canonical (localStorage) success と mirror (Supabase) success を **別 metric として** 扱う契約を明文化する
- 観測が「mirror を必須化する」副作用を持たないことを architectural に保証する
- 観測値が **Phase 進行の判断材料** （rollout gate）として機能する形式を予め決める
- [phase1_runtime_strategy.md §13 Observability Requirements](./phase1_runtime_strategy.md) の要件に対する具体仕様レイヤを提供する

本ドキュメント自体は contract / planning 専用であり、observability sink の物理実装・配線は含まない。実装は Phase1 着手 STEP の **observability sink 設計 PR**（[feature_rollout_matrix.md §11 Order 0](./feature_rollout_matrix.md)）で別途行う。

---

## 2. Current Migration Position

- branch: `feature/supabase-migration`
- Phase: **S0 完了 / Phase1 未着手**
- Supabase 関連 runtime は一切存在しない（client / package / env / schema / mirror helper / observability sink すべて未導入）
- canonical 永続層: localStorage 一択
- 既存 observability 枠: AI 利用量 / cache hit-miss の観測が [ai_usage_observability.md](../principles/ai_usage_observability.md) / [ai_cache_observability.md](../principles/ai_cache_observability.md) で運用中。本ドキュメントは **mirror 観測** を独立スコープとして規定し、既存枠との統合可否は実装 STEP で判断する（[§11](#11-logging-destination-policy)）
- 本ドキュメントは Phase1 着手 STEP の **第 1 PR**（observability sink 設計 PR）の input になる

---

## 3. Observability Philosophy

mirror 観測を貫く 5 つの哲学。Phase1 期間中、これらが他の判断より優先される。

1. **canonical success ≠ mirror success**。両者は別 metric であり、混同 / 統合 / 「全体成功率」のような **誤集約をしない**。
2. **観測は UX を変えない**。観測経路の追加 / 失敗 / 性能劣化は user 体験に出てはならない（observability sink への書き込み失敗を含む）。
3. **観測は mirror を必須化しない**。「mirror が走ったか否か」は観測対象だが、「mirror が走らなければ失敗扱い」を意味しない（mirror は best-effort のままであり、skip は正常）。
4. **観測失敗は product 失敗ではない**。observability sink への書き込みが失敗しても、mirror helper の戻り値 / canonical UX / Phase 判断のロジックを変えない（観測自体も best-effort）。
5. **観測は撤退可能**。observability sink は kill-switch で全停止可能、event スキーマは前方互換に進化、観測項目の削除は doc-first。

これらは [phase1_runtime_strategy.md §3 / §13](./phase1_runtime_strategy.md) の観測視点での再宣言。

---

## 4. Canonical Success vs Mirror Success

canonical (localStorage) 成功と mirror (Supabase) 成功を **完全に別レイヤとして** 集計する。

- canonical 成功 = `lib/*Storage.ts` 経由の localStorage 書き込みが完了したこと
- mirror 成功 = boundary 経由の Supabase 書き込みが成功 status で完了したこと
- canonical 成功は **mirror の起動可否を決定する条件**（[phase1_runtime_strategy.md §7](./phase1_runtime_strategy.md)）であり、mirror の成否を含まない
- mirror 成功は **canonical 成功の上に乗る** 副次 metric であり、canonical UX の判定材料にしない
- 集計時の表現:
  - 別 metric として記録する（合算 / OR / AND のような統合集計を default にしない）
  - 必要に応じてダッシュボード側で「canonical 成功 AND mirror 成功」のような統計を派生させることは許可するが、**event レベルでは別 field として保持** する
- canonical 成功 0 件の状況での mirror 起動は **設計バグ**（[phase1_runtime_strategy.md §6](./phase1_runtime_strategy.md)）。観測上「canonical 失敗 + mirror 起動」が現れた場合はアラート対象とする

ルール:

- 1 つの user action から派生する mirror 試行は **1 つの event** として記録する（canonical 試行も同 event 内に同梱する。両者は分離して比較可能であるべき）
- canonical 失敗時の event は mirror status を `not_started` / `skipped:canonical_failed` のいずれかで明示する（実際の status 値は [§7](#7-allowed-status-values) / [§9](#9-skip--no-op-classification) で定義）

---

## 5. Event Taxonomy

mirror 観測で扱う event の種別を **3 種** に固定する。

### 5.1 `mirror.attempt`

- 1 mirror 試行 = 1 event
- canonical 書き込み成功後に発火（mirror helper の起動と同タイミング、または起動直後）
- skip / disabled の場合も attempt を発火させる（**skip は invisible にしない**）
- `mirrorStatus` は最終結果に応じて `success` / `failure` / `skipped` / `disabled` のいずれか

### 5.2 `mirror.health`

- 定期 / 集計用の health metric。個別 attempt とは別のレイヤ
- feature 単位の mirror 成功率 / 起動率 / 失敗種別分布を **派生集計** として保持
- attempt 集計を sink 内で再集計する形でもよいし、別 channel として書く形でもよい（実装 STEP で決定）
- health 集計のソースは attempt event。**health 用に attempt と矛盾する独立集計を入れない**

### 5.3 `mirror.control`

- kill-switch ON/OFF / 設定変更 / 障害宣言など operational イベント
- 観測ダッシュボード上で「いつ disabled に切り替えたか」を追えるように記録
- `mirror.attempt` の `mirrorStatus = disabled` と紐付け可能であること

3 種のいずれにも該当しない event は本ドキュメントの観測スコープ外。**新しい event 種別を追加する際は本ドキュメントを更新してから** とする。

---

## 6. Required Event Fields

すべての `mirror.attempt` event が **最低限保持すべき** field。実装 STEP で field 名を確定し、本ドキュメントに追記する。

| field | 型イメージ | 役割 |
|---|---|---|
| `feature` | string | 対象 feature 識別子（例: `studentProfile`, `basicInfo`）。`feature_rollout_matrix.md` の Feature/Domain 列と一致 |
| `operation` | string | 操作種別（例: `mirror.write`）。Phase1 では `mirror.write` 一択。Phase2 以降で拡張余地 |
| `phase` | string | `phase1` を default。doc-first で値が増える |
| `canonicalStatus` | enum | `success` / `failure` / `not_attempted` のいずれか（[§4](#4-canonical-success-vs-mirror-success) と整合） |
| `mirrorStatus` | enum | [§7 Allowed Status Values](#7-allowed-status-values) のいずれか |
| `failureReason` | enum \| null | mirrorStatus = `failure` の場合のみ非 null。[§8 Failure Classification](#8-failure-classification) のいずれか |
| `skipReason` | enum \| null | mirrorStatus = `skipped` の場合のみ非 null。[§9 Skip / No-op Classification](#9-skip--no-op-classification) のいずれか |
| `durationMs` | number | mirror 試行に要した時間。skip / disabled でも 0 でよい |
| `timestamp` | ISO string | event 発火時刻（UTC） |
| `environment` | enum | `development` / `preview` / `production` のいずれか |
| `schemaVersion` | string | mirror 対象 entity の schema version。差異検知の根拠 |
| `clientVersion` | string | アプリ build 版（commit hash / release tag） |

feature によって追加で記録される条件付き field:

| field | 適用条件 | 役割 |
|---|---|---|
| `promptVersion` | mirror payload が AI 出力起源（StudentProfile / SummaryResult / review 等）の場合 | prompt drift と mirror 失敗の相関分析 |
| `cacheVersion` | mirror payload が cache 由来の場合（Phase1 は対象外だが拡張余地として field を予約） | cache 経路と mirror 経路の整合確認 |
| `payloadHash` | feature 個別判断 | 内容差分検知 / 不変性確認（PII を含まないこと） |

field 設計のルール:

- **PII を field に含めない**（user 個人情報 / 自由記述本文を生で入れない。payload の意味づけは別 channel）
- field 名は **doc-first** で確定。実装 PR で field を追加する場合は本ドキュメントに行を足す
- 値の **enum 範囲は本ドキュメントが正本**（[§7 / §8 / §9](#7-allowed-status-values)）
- 新規 field は **optional として導入** する（既存 sink が落ちないこと）

---

## 7. Allowed Status Values

`mirrorStatus` が取り得る値を 4 つに固定する。これ以外の値は禁止。

| status | 意味 | 期待される field |
|---|---|---|
| `success` | mirror 書き込みが成功 status で完了した | `failureReason = null`, `skipReason = null` |
| `failure` | mirror 書き込みが失敗した（throw 含む） | `failureReason ∈ §8`, `skipReason = null` |
| `skipped` | mirror を意図的に起動しなかった（no-op） | `failureReason = null`, `skipReason ∈ §9` |
| `disabled` | kill-switch ON / feature flag OFF などで mirror 経路自体が disable | `failureReason = null`, `skipReason = null` |

ルール:

- `success` と `failure` を distinguish せずに合算しない（成功率の計算は両者の比率で行う）
- `skipped` を `failure` に含めない（skip は正常）
- `disabled` を `skipped` に含めない（kill-switch 由来は別レイヤとして観測）
- 「status 不明」の状態は **発生してはならない**。observability sink への書き込み時点で status は確定する必要がある（途中 state を保存しない）

---

## 8. Failure Classification

`failureReason` の enum を以下に固定する。実装 STEP で値の文字列表記を確定し（snake_case 推奨）、本ドキュメントに追記する。

| reason | 該当ケース | 推奨アクション（観測者視点） |
|---|---|---|
| `missing_env` | Supabase 関連 env が boundary 内で未定義 | 環境設定の確認 / kill-switch 観点で正常運用かを判断 |
| `client_unavailable` | boundary 内 client 生成失敗 / runtime で client インスタンス取得不可 | boundary 実装のバグ / dependency 障害を疑う |
| `network_error` | 通信失敗（DNS / TCP / TLS / timeout） | 外部要因。継続的に高い場合は Supabase 側 / NW 側を確認 |
| `auth_unavailable` | mirror に必要な user identity / token が取得できない | Phase1 では skip ではなく failure に倒すケースが明示的に発生した場合のみ。通常は `skipped:no_user_context`（[§9](#9-skip--no-op-classification)） |
| `validation_error` | payload が validation を通らない（client side / server side） | mirror helper の payload 構築バグを疑う |
| `schema_mismatch` | Supabase 側 schema が想定と乖離 | schema migration の前進 / 後退のいずれかを判断 |
| `rate_limited` | Supabase / 中継層からの rate limit 応答 | 起動率の見直し / Phase 進行判断材料 |
| `unknown` | 上記いずれにも分類できない | 比率の上限を保つことが Phase1 卒業条件の 1 つ（[§14](#14-rollout-gate-usage)） |

ルール:

- **新規 reason の追加は本ドキュメント更新を先行** させる
- `unknown` の比率が一定値を超える場合は分類精度の改善 PR を起票する（具体閾値は実装 STEP で決定し追記）
- 同一試行が複数の失敗原因を持つ場合、**より具体的な reason** を選ぶ（例: schema_mismatch と validation_error の両方が当てはまる場合は schema_mismatch 優先）
- failureReason の付与は mirror helper 内部での分類に基づく（observability sink 側の後付け推論は行わない）

---

## 9. Skip / No-op Classification

`skipReason` の enum を以下に固定する。skip は正常な観測対象であり、`failure` と混ぜない。

| reason | 該当ケース |
|---|---|
| `no_user_context` | mirror に必要な user identity が現時点で取得不能（Phase1 では anonymous 完動が前提のため頻発しうる） |
| `empty_payload` | mirror 対象 payload が空（canonical 側で意味のある値がない） |
| `unchanged_payload` | 直前の mirror 成功時の payload と同一（idempotent dedup 由来の skip） |
| `feature_not_enabled` | feature 単位の flag が off（rollout 段階での部分 disable） |
| `mirror_disabled` | global kill-switch によって mirror 経路が disable（注: status は `disabled` を優先するため、`skipped` の skipReason として登場するのは「per-call の disable 判定」のような細粒度の場合のみ） |
| `unsupported_environment` | runtime 環境（SSR / RSC 等）で mirror が許可されていない |

ルール:

- skip 比率は **mirror 起動率** の母数で計算する。canonical 成功総数 / mirror 起動数 / skip 数 / 試行数を別々に計上できること
- `unchanged_payload` skip が高い feature は **正常**（idempotent な再 mirror が抑止されている証拠）
- `no_user_context` skip が高い feature は Phase1 では **正常**（認証未導入のため）。Phase2 進行時には skip → 成功への遷移を観測する
- `feature_not_enabled` skip は per-feature の rollout gate（[§14](#14-rollout-gate-usage)）と整合する分類

---

## 10. UX Isolation Rules

観測が UX に **染み出さない** ことを architectural に保証するルール。

- mirror 失敗 / skip / disabled いずれも:
  - **toast / alert / modal を出さない**
  - **navigation を block / cancel しない**
  - **loading / disabled state を生成しない**
  - **error boundary を発動しない**
- observability sink への書き込みは:
  - **fire-and-forget** が default
  - 失敗しても mirror helper / canonical helper の戻り値を変えない
  - latency を canonical 経路に加算しない（mirror helper の戻り値も canonical helper を block しない、[phase1_runtime_strategy.md §7](./phase1_runtime_strategy.md)）
- retry / backoff:
  - **mirror 自体の retry は Phase1 で実装しない**（[phase1_runtime_strategy.md §9](./phase1_runtime_strategy.md)）
  - observability sink の retry も Phase1 で実装しない（best-effort）
- destructive rollback:
  - mirror 失敗を理由に localStorage を消す / cache invalidate / `sourceHash` を改変する操作を行わない（[phase1_runtime_strategy.md §16](./phase1_runtime_strategy.md)）
- user-visible error reporting:
  - mirror 失敗を user-visible エラーレポート機構（feedback widget 等）にエスカレートしない

ルール:

- 観測ダッシュボードを **user に表示しない**（運用者向け）
- mirror 関連の通知（成功 / 失敗 / disabled の telemetry に基づく Slack 等）は internal 通知に限定し、user-visible 経路を持たない

---

## 11. Logging Destination Policy

observability sink の **物理配置** は本ドキュメントで固定しない。実装 STEP（[feature_rollout_matrix.md §11 Order 0](./feature_rollout_matrix.md)）で決定し、本セクションに追記する。

選択候補（実装 STEP で判断する観点）:

- 既存 AI 観測枠（[ai_usage_observability.md](../principles/ai_usage_observability.md) / [ai_cache_observability.md](../principles/ai_cache_observability.md)）に乗せる
  - 利点: 集約場所が一本化される / 既存ダッシュボードが流用可能
  - 注意: AI 観測の semantics と mirror 観測の semantics が混ざらないよう、event 種別 (`mirror.attempt` 等) を明確に分離する
- 独立 sink を切る
  - 利点: mirror 観測の進化（field 追加 / 分類更新）が他観測に波及しない
  - 注意: 集計ダッシュボードを 2 系統メンテする必要が出る

決定ルール:

- 選択結果（既存統合 / 独立 sink）を本ドキュメント §11 と Phase1 着手 STEP の PR description に **同時に記録** する
- sink の **書き込み経路は boundary 層に閉じる**（[client_boundary.md §6](./client_boundary.md)）。feature module / UI / page / route から sink を直叩きしない
- sink の認証情報・URL 等は env として `process.env.SUPABASE_*` と **同じ集約ルール** で扱う（[client_boundary.md §7](./client_boundary.md)）
- sink への書き込みが Supabase 自身に依存する場合、**mirror 失敗が観測失敗を連鎖** しないよう経路を分ける（または失敗を二段階に分類する）

---

## 12. Dev vs Production Expectations

環境別の挙動と観測強度を分ける。

| environment | mirror 起動 | 観測強度 | 補足 |
|---|---|---|---|
| `development` | feature flag に従う（default disabled） | full（attempt / health / control すべて記録） | sink への書き込み確認を行う場として位置付ける |
| `preview` | feature flag に従う（default disabled） | full | PR レビュー用環境。dashboard で観測可能 |
| `production` | rollout gate に従う（[§14](#14-rollout-gate-usage)） | full | 観測強度を落とさない。観測は Phase 判断の入力であるため |

ルール:

- 環境フラグは boundary file 内部で評価する（feature module / page / route が `process.env.NODE_ENV` を mirror 判断に使わない）
- production で mirror を初めて有効化する際は **single feature × limited rollout** から始める（[§14](#14-rollout-gate-usage)）
- development 環境の observability sink は production と物理的に分ける（dev event が production dashboard に混ざらないこと）
- staging / preview 環境のデータ保持期間は production より短くする（実装 STEP で具体値を決定）
- environment 値の改竄 / spoofing が起きた場合は `unknown` 環境として扱う（観測除外ではなく明示分類）

---

## 13. Kill-switch Expectations

mirror 経路を **任意のタイミングで全停止** できる kill-switch を Phase1 着手 STEP の **最初** から備える。

- kill-switch は boundary file 内で評価され、`mirrorStatus = disabled` を返す経路を有効化する
- kill-switch の実装方式（env / runtime config / feature flag service）は実装 STEP で決定し本ドキュメントに追記
- kill-switch ON への切り替えは:
  - feature 単位の disable
  - global 全停止
  - environment 単位の disable
  - のいずれかを選択可能であること
- kill-switch ON 後の挙動:
  - mirror helper は **即時** に `disabled` を返す
  - canonical helper の戻り値 / latency / 例外契約は変わらない
  - observability sink には `mirror.control` event が記録される（切替時刻 / 切替理由）
  - 既に走行中の mirror 試行は cancel / abort しない（fire-and-forget の挙動を維持）
- kill-switch OFF への戻し:
  - 段階的（feature → environment → global の逆順）で行う
  - 戻し直後は **mirror 起動率 / 失敗率** を集中観測する
- Phase1 期間中、kill-switch を **使う前提** で運用する（恐れずに停止できることが Phase1 の哲学）

---

## 14. Rollout Gate Usage

観測値を rollout 判断にどう使うかを **4 段階の gate** として規定する。各 feature は以下の段階を順に進む。

| stage | 名称 | 説明 | 進行条件（観測ベース） |
|---|---|---|---|
| 0 | **not mirrored** | mirror 配線が存在しない | 該当 feature の docs 整備が完了（[feature_rollout_matrix.md §11 前提](./feature_rollout_matrix.md)） |
| 1 | **dev-only mirror** | development / preview 環境で mirror が動く。production は disabled | sink に attempt event が記録されることを確認 / canonical UX への影響ゼロを確認 |
| 2 | **limited mirror** | production で mirror が動くが、対象を限定する（環境 / feature flag による段階的 enable） | dev-only mirror で **mirror 起動率 / mirror 成功率 / 失敗種別分布** が想定範囲内 / `unknown` 比率が閾値以下 |
| 3 | **Phase1 stable mirror** | production で当該 feature の全試行に mirror が動く（無分別ではなく、`skipped` の正常パターンを含む通常運用） | limited mirror で **連続観測期間中に canonical UX 劣化なし / mirror 失敗種別が予想分布内 / kill-switch を一度も発動せず運用可能** |

ルール:

- stage 進行は **per-feature**。同一 stage に複数 feature が並ぶことを許容
- stage 後退（例: stage 3 → stage 2）も **観測値に基づいて積極的に行う**。後退は失敗ではなく、kill-switch と並ぶ正常運用ツール
- stage 進行判断の **具体的閾値**（成功率 % / unknown 比率 % / 観測期間日数）は実装 STEP で決定し本ドキュメントに追記する
- Phase1 全体の卒業条件（[phase1_runtime_strategy.md §15](./phase1_runtime_strategy.md)）は **StudentProfile + 低リスク feature 群が stage 3 に到達** することが前提
- 高リスク feature（AI restore flows）は **stage 1 / stage 2 で停止判断** することも明示的に許容する（Phase1 卒業を待つ必要はない）
- stage 進行に **observability 以外の根拠**（「実装が落ち着いたから」「他チームから希望があったから」等）を用いない

---

## 15. Anti-patterns

観測契約に対する **境界違反**。PR レビュー段階で reject する根拠とする。

- **canonical success と mirror success を 1 metric に統合**
  - 例: 「全体保存成功率」を計算して表示する
  - 理由: canonical 成功と mirror 成功は別レイヤ。統合は意味的に誤り
- **mirror 失敗を user-visible にする**
  - 例: toast / alert / error boundary 発動 / loading spinner
  - 理由: UX 隔離規約に反する（[§10](#10-ux-isolation-rules)）
- **observability sink の失敗で mirror 挙動を変える**
  - 例: sink 失敗時に mirror を retry / mirror を abort
  - 理由: 観測は best-effort であり、product 挙動の入力にしない
- **mirror retry / backoff を helper 側で実装**
  - 例: mirror failure 時に exponential backoff で再送
  - 理由: Phase1 では retry を実装しない（[phase1_runtime_strategy.md §9](./phase1_runtime_strategy.md)）。観測値で Phase 判断を行うべきであり、retry で表面化を抑えない
- **PII を event field に含める**
  - 例: payload 本文 / user 自由記述 / email を field に積む
  - 理由: 観測経路から個人情報が漏出する
- **event 種別 / status 値 / 分類 enum を doc 更新なしで増やす**
  - 例: 実装 PR で `mirrorStatus = "pending"` を追加 / 新規 `failureReason` を勝手に追加
  - 理由: 観測契約の予測可能性が崩れる（doc-first 違反）
- **skip を invisible にする**
  - 例: skip を attempt event として記録しない
  - 理由: skip 比率が rollout gate の判定材料（[§14](#14-rollout-gate-usage)）
- **destructive rollback を mirror 失敗で発動**
  - 例: mirror 失敗時に localStorage を消す / cache invalidate
  - 理由: canonical state 保護に反する（[phase1_runtime_strategy.md §16](./phase1_runtime_strategy.md)）
- **observability を rollout gate 以外の判断に流用**
  - 例: 「mirror 起動率を上げるために feature 起動率を盛る」「観測値を user 向け実績数値に転用」
  - 理由: 観測は Phase 判断のための internal metric であり、user-facing 数値の根拠にしない
- **environment 値の偽装**
  - 例: production で `environment = "development"` を送って disable 判定を回避
  - 理由: 観測の信頼性が崩れる。environment は boundary 内で確定的に評価
- **kill-switch を「最後の手段」として扱う**
  - 例: kill-switch ON を escalation / 異常事態として扱い、運用 default 経路から除外する
  - 理由: kill-switch は Phase1 期間中 **積極利用** が前提

---

## 16. Future Runtime TODOs

本ドキュメントの範囲外。Phase1 着手 STEP 以降で順に消化する。

- **observability sink の物理選定**（既存統合 / 独立）と本ドキュメント §11 への結果追記
- **event field 名 / enum 文字列表記** の確定（snake_case 推奨）と本ドキュメント §6 / §7 / §8 / §9 への追記
- **kill-switch 実装方式**（env / runtime config / flag service）と本ドキュメント §13 への追記
- **rollout gate の閾値**（成功率 % / unknown 比率 % / 観測期間日数）と本ドキュメント §14 への追記
- **dashboard 仕様**（per-feature 表示 / 環境別表示 / drill-down 軸）— 別ドキュメント候補（仮: `docs/supabase/mirror_dashboard.md`）
- **alert 設計**（internal 通知の閾値 / 通知経路 / 重複抑制）— internal 限定。user-visible 経路を持たない（[§10](#10-ux-isolation-rules)）
- **PII 取り扱い方針** の正式版（payloadHash の hash 関数 / salt 管理 / 保持期間）
- **dev / preview / production の sink 分離方針**（保持期間 / projection / 認証情報）
- **Phase2 観測拡張**（fallback hit 率 / fallback success rate 等の追加要件）— Phase2 着手時に後継ドキュメント（仮: `docs/supabase/phase2_observability.md`）で扱う
- **既存 AI 観測枠との semantics 整合**（[ai_usage_observability.md](../principles/ai_usage_observability.md) / [ai_cache_observability.md](../principles/ai_cache_observability.md) の field / 集計軸との対応関係明文化）

---

## 締めくくり

Supabase mirror の観測契約は **「mirror が走ったかどうかを観るためのもの」** であり、**「mirror が成功する責務を product に強制するためのもの」ではない**。
canonical success と mirror success を別レイヤとして扱い、観測の失敗が product の失敗にならない設計を貫くことで、Phase1 は「mirror が無くても feature が完動する」という哲学を観測経路ごと貫徹できる。
本ドキュメントの分類・field・閾値は **doc-first で進化** し、最初の observability sink PR より前に確定していることが、Phase1 全体の予測可能性を支える。
