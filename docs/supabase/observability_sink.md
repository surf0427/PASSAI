# Phase1 Mirror Observability Sink

PASSAI における **mirror 観測 sink の最小設計**。Phase1 contract（localStorage canonical + Supabase best-effort mirror）の範囲で、rollout-stage 判断に必要な最低限の event 蓄積層を定義する。本 STEP は schema + 設計の確定のみ。runtime 配線（emit helper / mirror 側 wiring）は別 STEP で扱う。

関連:
- 設計根拠の上位 contract: [`mirror_observability.md`](./mirror_observability.md)
- 適用対象 SQL: [`supabase/schema.sql`](../../supabase/schema.sql)（§5 / §6 セクション）
- rollout 順序: [`feature_rollout_matrix.md §11`](./feature_rollout_matrix.md)
- 先行 mirror table 設計: [`schema_phase1_student_profile.md`](./schema_phase1_student_profile.md)
- runtime 哲学: [`phase1_runtime_strategy.md`](./phase1_runtime_strategy.md)
- boundary 規約: [`client_boundary.md`](./client_boundary.md)

---

## 1. Scope

- 対象: `mirror_events` テーブル **1 つだけ**
- 用途: mirror helper（StudentProfile / 将来の basicInfo / activityData ...）が **`finalize()` 時に 1 event を append** する先
- **範囲外**: runtime helper / emit 関数 / dashboard / alerting / scheduled job / retention 自動化 / batching / sampling / retries
- 本ドキュメントは PR A（schema + 設計確定）のみを規定する。runtime 配線は PR B / PR C で別途扱う

---

## 2. Current Migration Position

- branch: `feature/supabase-migration`
- Phase: **Phase1 期間中 / StudentProfile mirror 配線済 / 観測 sink 配線済（PR C）**
- `lib/supabase/mirrorEventSink.ts` の `emitMirrorEvent` を `mirrorStudentProfile.ts:finalize()` から fire-and-forget で 1 回呼ぶ経路が runtime に存在する
- `mirror_events` table は [§11 Apply order](#11-apply-order-informational) の手順に従い Supabase project に手動 apply 済み前提（runtime は table 不在でも安全 — 未 apply 時は INSERT が silently 失敗するだけで UX 影響なし）

---

## 3. Schema

```sql
CREATE TABLE mirror_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  feature         text        NOT NULL,
  mirror_status   text        NOT NULL,
  failure_reason  text,
  skip_reason     text,
  duration_ms     integer,
  environment     text        NOT NULL,
  schema_version  text,
  client_version  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

列ごとの意図:

| 列 | 型 | 役割 |
|---|---|---|
| `id` | `uuid` PK | append-only event の合成 PK |
| `feature` | `text` NOT NULL | feature 識別子（`studentProfile` / `basicInfo` / ...）。[`feature_rollout_matrix.md`](./feature_rollout_matrix.md) の Feature/Domain 列に揃える |
| `mirror_status` | `text` NOT NULL | `success` / `failure` / `skipped` / `disabled`（[`mirror_observability.md §7`](./mirror_observability.md)）|
| `failure_reason` | `text` NULL 可 | `mirror_status = failure` の時のみ非 NULL（[`mirror_observability.md §8`](./mirror_observability.md)）|
| `skip_reason` | `text` NULL 可 | `mirror_status = skipped` の時のみ非 NULL（[`mirror_observability.md §9`](./mirror_observability.md)）|
| `duration_ms` | `integer` NULL 可 | 試行所要時間。pre-flight skip では NULL 許容 |
| `environment` | `text` NOT NULL | `development` / `preview` / `production`（[`mirror_observability.md §12`](./mirror_observability.md)）|
| `schema_version` | `text` NULL 可 | mirror payload contract version |
| `client_version` | `text` NULL 可 | app build 識別子（commit hash / release tag）|
| `created_at` | `timestamptz` DEFAULT now() | event 発火時刻 |

制約は **NOT NULL のみ**。enum 値の DB 側 CHECK は意図的に置かない（[§6](#6-design-decisions)）。

---

## 4. RLS Posture — append-only for anon

```sql
ALTER TABLE mirror_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mirror_events anon insert"
  ON mirror_events
  FOR INSERT TO anon
  WITH CHECK (true);
```

設計意図:

- **RLS は ON**。policy 無しでは anon が触れない baseline を維持
- **INSERT policy のみ permissive**。append-only contract を DB 層で強制する
- **SELECT / UPDATE / DELETE policy は意図的に存在しない**
  - SELECT: client から observability 結果を読める経路を作らない（user-visible UI を生まないことを保証）
  - UPDATE: append-only contract を破る経路を作らない（イベントは事実、上書き不可）
  - DELETE: rollback / retention は service-role 経由の SQL editor 操作に閉じる（クライアント主導の破壊操作を防止）
- 操作者は Supabase SQL editor / service-role context 経由でのみ集計クエリを実行する

Phase1 で複雑な RLS（user-scoped / row-level filtering）を導入しない。auth 連携は Phase2 ([§9](#9-future-migration-path))。

---

## 5. What is intentionally excluded

`mirror_events` テーブルに **意図的に存在しない** 要素と、その理由。

### 5.1 `payload` 列 が無い

- 観測の目的は「mirror が動いたか / 失敗種別の分布」を見ることであり、書き込み内容を再現することではない
- canonical artifact 自体は mirror table（例: `student_profile_mirrors`）に既に存在する。event 側に payload を重複保持する正当な理由がない
- payload を sink に持つと **PII / 自由記述 / AI 出力本文が観測経路に漏出** する。Phase1 の UX 隔離規約（[`mirror_observability.md §10`](./mirror_observability.md)）に反する
- 列を追加する additive migration はいつでも可能。先に追加して後で削除する方が困難なため、defer する

### 5.2 `source_hash` 列 が無い（Phase1 deferred）

- `source_hash` は content-derived hash であり、技術的には PII ではない（[`mirror_observability.md §6`](./mirror_observability.md) の `payloadHash` 相当）
- ただし Phase1 の event 集計クエリ（[§8](#8-rollout-stage-usage)）に source_hash を含める要件は **未確認**
- 列を増やせば schema 進化が必要、減らせない（[`schema_boundary_policy.md §11`](./schema_boundary_policy.md) additive 原則）
- 「相関分析の use case が具体化したら additive に追加」とする運用に倒し、Phase1 MVP からは外す

### 5.3 `user_id` / auth 結合 が無い

- Phase1 は anonymous 完動が前提。event にも user identity を載せない
- Phase2 で auth が入った際に `user_id uuid REFERENCES auth.users(id)` を additive に追加可能
- 認証導入は単独 STEP（[`migration_phases.md §12`](./migration_phases.md)）

### 5.4 `ip_address` / `user_agent` / browser fingerprint が無い

- PostgREST / Supabase 側で transport layer ログがあれば運用上十分
- アプリ層から fingerprint 系を意図的に送ると、運用ポリシー（GDPR / 規約）との整合確認が必要になる
- 観測の本来目的（rollout-stage 判断）にこれらは不要

### 5.5 `prompt_version` / `cache_version` 列 が無い（Phase1 deferred）

- [`mirror_observability.md §6`](./mirror_observability.md) で conditional field として記載されているが、対象 feature（AI 出力起源 / cache 由来）が Phase1 後半まで mirror 対象に入らない
- 必要になった時点で additive に追加する

---

## 6. Design decisions

### 6.1 enum 値の CHECK 制約を置かない

- `mirror_status` / `failure_reason` / `skip_reason` の enum 値は [`mirror_observability.md`](./mirror_observability.md) §7 / §8 / §9 を **doc-first source of truth** とする
- application 層（TypeScript の `MirrorResult` 系 union）が値の正しさを保証する
- DB 側 CHECK を入れると enum 更新が schema migration を要求し、doc-first 進化を阻害する（[`schema_boundary_policy.md §11`](./schema_boundary_policy.md)）
- 結果として malformed event は許容される。観測値の信頼性は application 層の type 設計に依存する

### 6.2 観測 sink は AI 観測枠から **独立** させる

- 候補は [`mirror_observability.md §11`](./mirror_observability.md):
  - A) 既存 AI 観測枠（`ai_usage_observability.md` / `ai_cache_observability.md`）に統合
  - B) 独立 sink を切る
- 選択: **B（独立 sink）**
- 理由:
  - 観測 semantics が異なる（mirror status vs API token / cost）
  - 混在は集計クエリの cognitive overhead を増やす
  - 独立であれば mirror sink の進化（field 追加 / 分類更新）が AI 観測の dashboard 設計に波及しない
  - kill-switch を独立に持てる（mirror を止めずに観測だけ止める / 逆）

[`mirror_observability.md §11`](./mirror_observability.md) の "Phase1 着手 STEP で決定" 要件への回答として記録する。

### 6.3 dashboard を作らない（Phase1）

- 観測値の参照は Supabase SQL editor 経由の手動クエリで十分（[§8](#8-rollout-stage-usage)）
- dashboard を build すると "operator 用 UI を保守する責務" が増え、Phase1 の最小化原則に反する
- Phase 進行判断に必要な数値は ad-hoc SQL で取り出せる粒度を維持する

### 6.4 retries / batching / sampling を実装しない

- **retries**: [`phase1_runtime_strategy.md §9`](./phase1_runtime_strategy.md) で禁止。observability 自身の retry は二重に best-effort 哲学を破る
- **batching**: Phase1 の event 発生頻度は per-user-action（年単位で数百〜数千 event/user 想定）。batching の利益が見えるほどの volume ではない
- **sampling**: 低 volume で sampling すると統計検出力が落ちる。volume 増加後に再評価
- 「1 mirror attempt = 1 event INSERT」を baseline に据える

### 6.5 emit helper の場所と命名（Phase1 STEP B で確定）

- 仮置き: `lib/supabase/mirrorEventSink.ts` に `emitMirrorEvent(event)` を export
- 「sink」命名は AI 観測枠と semantically 衝突しない
- 本ドキュメントの merge 時点では未作成。PR B で別途扱う

### 6.6 sink 自体の kill-switch を mirror kill-switch と分離する

- 環境変数案: `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED`
- 目的: 観測 sink に問題が出た時に mirror を止めずに観測だけ止められる / 逆も可能
- 既存の `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` とは別軸の operator control
- 評価ルールは `mirrorConfig.ts` と同じ default-safe pattern を採用予定（PR B）

---

## 7. Retention strategy

- Phase1: **自動 retention 無し**
- 操作者が必要に応じて Supabase SQL editor から手動 purge
  ```sql
  DELETE FROM mirror_events WHERE created_at < now() - interval '90 days';
  ```
- 90 日 rolling window は [`mirror_observability.md §14`](./mirror_observability.md) の stage 進行判断（成功率 / failure 種別分布 / `unknown` 比率）に十分
- Phase1 volume は per-user-action（StudentProfile mirror = 1 user の壁打ち完了で 1 event）。table 肥大は数ヶ月〜年単位の運用観察で再評価する
- 自動 retention（scheduled function / time-bucketed rollup / pg_cron）は **本 STEP の範囲外**。volume 観測後に必要性を判断
- Phase2 retention は [`§9 Future migration path`](#9-future-migration-path) で再評価する

---

## 8. Rollout-stage usage

全クエリは Supabase SQL editor で実行可能。dashboard 不要。

### 8.1 feature 別 / 日別 mirror 成功率

```sql
SELECT
  feature,
  date_trunc('day', created_at) AS day,
  count(*)                                                AS attempts,
  count(*) FILTER (WHERE mirror_status = 'success')       AS success_count,
  count(*) FILTER (WHERE mirror_status = 'failure')       AS failure_count,
  count(*) FILTER (WHERE mirror_status = 'skipped')       AS skip_count,
  count(*) FILTER (WHERE mirror_status = 'disabled')      AS disabled_count,
  ROUND(
    count(*) FILTER (WHERE mirror_status = 'success')::numeric
    / NULLIF(count(*), 0), 4
  ) AS success_rate
FROM mirror_events
WHERE created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1, 2;
```

### 8.2 failure_reason 分布

```sql
SELECT feature, failure_reason, count(*) AS n
FROM mirror_events
WHERE mirror_status = 'failure'
  AND created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1, 3 DESC;
```

`unknown` 比率を観測する（[`phase1_runtime_strategy.md §15`](./phase1_runtime_strategy.md) Phase1 卒業条件）。

### 8.3 skip_reason 分布

```sql
SELECT feature, skip_reason, count(*) AS n
FROM mirror_events
WHERE mirror_status = 'skipped'
  AND created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1, 3 DESC;
```

Phase1 では `no_user_context` が支配的になる前提（auth 未導入）。

### 8.4 environment 別比較

```sql
SELECT environment, mirror_status, count(*) AS n
FROM mirror_events
WHERE created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1, 2;
```

production が dev / preview と乖離していないかを stage 進行前に確認する。

### 8.5 stage 進行判断の対応関係

[`mirror_observability.md §14`](./mirror_observability.md) / [`phase1_execution_checklist.md §15`](./phase1_execution_checklist.md):

| stage 移行 | 確認クエリ | 通過閾値（暫定） |
|---|---|---|
| stage 1 → 2 | §8.1（dev / preview のみ） | 攻撃的 failure 無し / `unknown` 比率低 |
| stage 2 → 3 | §8.1（production limited） | success rate ≥ 設定値 / canonical UX 劣化ゼロ |
| stage 3 graduation | §8.1 + §8.2 + §8.4 | kill-switch 不使用継続 / 失敗種別分布が安定 |

具体閾値（成功率 % / unknown 比率 % / 観測期間日数）は **データ蓄積後に operator が決定** し、後追いで本ドキュメントに追記する（[§10 Open questions](#10-open-questions)）。

---

## 9. Future migration path

本 STEP の範囲外。Phase2 着手前に検討する候補のみ列挙する。

1. **`source_hash` 列の additive 追加** — 相関分析 use case が具体化した時点
2. **`user_id` 列 + auth.users FK** — Phase2 認証導入と同時に additive 追加
3. **`prompt_version` / `cache_version` 列** — AI restore flow を mirror 対象に入れる時点で additive 追加（[`feature_rollout_matrix.md §11 Order 11+`](./feature_rollout_matrix.md)）
4. **CHECK 制約の事後導入** — enum 値の安定が複数 release で観測できた時点で考慮
5. **自動 retention** — table size 観測結果に基づき `pg_cron` / scheduled function で実装
6. **dashboard** — operator の運用負荷次第。ad-hoc SQL で回らなくなった時点で投資判断
7. **per-environment 分離** — production / preview の event を別 sink に分離する選択肢（プライバシー / 観測ノイズ次第）
8. **alerting** — internal 通知（[`mirror_observability.md §10`](./mirror_observability.md)）。user-visible 経路は持たない

---

## 10. Open questions

doc merge 時点で未決。**この STEP では決めない**。

1. **stage 進行の閾値**（成功率 % / unknown 比率 % / 観測期間日数）— PR C 配線後に最初のデータ蓄積を待ち、operator が決定
2. **`client_version` の供給元** — `NEXT_PUBLIC_APP_COMMIT` を build script で埋める案が暫定。PR B 着手時に確定
3. **`environment` の供給元** — `NODE_ENV` を boundary 内で `development` / `production` に正規化。`preview`（Vercel preview 等）の判定方法は本 PR では決めない
4. **operator runbook** — stage 進行クエリ実行手順 / 失敗時のエスカレーション経路 — PR C 直後に整備
5. **PR C 配線時に sink kill-switch を default で ON / OFF どちらにするか** — production 初配線時は ON（観測無効）→ dev 検証 → 段階解放 を提案するが PR B で再確認
6. **既存 `student_profile_mirrors` event のバックフィル** — Phase1 では行わない方針（[`phase1_runtime_strategy.md §10`](./phase1_runtime_strategy.md)）が、event sink 配線後の最初の数日に手動 spot-check が必要かを別途判断

---

## 11. Apply order (informational)

本 PR の SQL は **runtime 配線と切り離す**。

1. 本 doc が main に merge される
2. `supabase/schema.sql` の §5 / §6 を Supabase SQL editor / CLI で apply
3. Supabase dashboard で:
   - `mirror_events` table が `ENABLE ROW LEVEL SECURITY` 状態であること
   - policy が 1 件（INSERT のみ）であること
   - SELECT / UPDATE / DELETE policy が無いこと
   を目視確認
4. apply 後も runtime は引き続き未配線。emit helper も未作成のまま
5. PR B（`lib/supabase/mirrorEventSink.ts` 追加 / unused state）→ PR C（`mirrorStudentProfile.ts:finalize()` から 1 line 配線）へ進む

問題発覚時の rollback:

- `DROP TABLE mirror_events;` のみで完結（FK 無し / 他 table 依存無し）
- rollback で破棄した event row は復元しない
- runtime には何も配線されていないため、rollback は user-visible UX に一切影響しない

---

## 12. Anti-patterns specific to this sink

レビュー時の reject 根拠とする。

- **本 STEP に runtime 配線を混ぜる**（emit helper を実装 / mirror helper を更新 / route 追加）
- **`payload` 列を追加する**（[§5.1](#51-payload-列-が無い)）
- **`SELECT` policy を追加する**（observability が client から漏出する経路を作らない / [§4](#4-rls-posture--append-only-for-anon)）
- **`DELETE` / `UPDATE` policy を追加する**（append-only contract を破る）
- **dashboard を build する PR を本 PR に混ぜる**（[§6.3](#63-dashboard-を作らない-phase1)）
- **enum 値の CHECK 制約を追加する**（doc-first 進化を阻害 / [§6.1](#61-enum-値の-check-制約を置かない)）
- **`pg_cron` などで自動 retention を Phase1 に導入する**（volume 観測前の早すぎる最適化 / [§7](#7-retention-strategy)）
- **AI 観測枠と同 table に統合する**（[§6.2](#62-観測-sink-は-ai-観測枠から-独立-させる)）
- **user_id / IP / user_agent 列を追加する**（Phase1 anonymous 完動 / [§5.3](#53-user_id--auth-結合-が無い) / [§5.4](#54-ip_address--user_agent--browser-fingerprint-が無い)）
- **本 doc の更新なしに event field / enum 範囲を変える**（doc-first 違反 / [`mirror_observability.md §15`](./mirror_observability.md)）

---

## 13. Confirmation

本ドキュメント + `supabase/schema.sql` §5 / §6 の merge では:

- runtime コード（`app/`, `components/`, `lib/*Storage.ts`, AI routes, `lib/supabase/` 含む既存 helper）は一切変更されない
- `emitMirrorEvent` 等の TypeScript surface は存在しない
- 既存 mirror helper（`mirrorStudentProfile.ts`）の挙動は不変
- localStorage / restore / cache / hydration / AI 出力 / プロンプト いずれも behavior 変化なし

SQL 適用前の状態でも、適用後の状態でも、PASSAI の現行 UX は同一である。
