# Phase1 Soak Runbook

operator が Phase1 mirror infra の **soak observation** を実際に回すための **mechanical runbook**。
判断要素を含む決定は [`phase1_boundary_freeze.md`](./phase1_boundary_freeze.md) / [`phase1_boundary_pressure_audit.md`](./phase1_boundary_pressure_audit.md) / [`phase1_completion_declaration.md`](./phase1_completion_declaration.md) を参照。本ドキュメントは **手順 + クエリ + 閾値 + decision tree** に特化する。

関連: [phase1_completion_declaration.md](./phase1_completion_declaration.md), [phase1_completion_checklist.md](./phase1_completion_checklist.md), [schema_apply_preflight.md](./schema_apply_preflight.md), [basic_info_post_apply_checklist.md](./basic_info_post_apply_checklist.md), [diagnosis_post_apply_checklist.md](./diagnosis_post_apply_checklist.md), [activity_post_apply_checklist.md](./activity_post_apply_checklist.md), [observability_sink.md](./observability_sink.md), [soak_launch_audit.md](./soak_launch_audit.md)

> **2026-05-17 STEP-SOAK-1 update — observability columns now populated**:
> 本 runbook の §2.4 / §3.4 のクエリは旧仕様で `mirror_events.schema_version` / `client_version` / `duration_ms` 3 column が常時 NULL を返したため意味を持たなかった。STEP-SOAK-1 で `mirrorFinalize.finalize()` が 3 column を強制的に propagate するようになったため、本 runbook の query は **意味のある結果を返す**。
> - `schema_version`: 各 mirror の `SCHEMA_VERSION` 定数（studentProfile は `input.schemaVersion`）が反映される
> - `client_version`: `NEXT_PUBLIC_APP_COMMIT` 値 / 未設定時は sentinel `"unknown"`
> - `duration_ms`: 各 mirror entry で `performance.now()` を capture し、`finalize()` で差分を ms 整数で書き込み

---

## How to use

- **Daily checks (§2)**: 平日に operator が 1 日 1 回回す mechanical step
- **Weekly checks (§3)**: 週次の baseline 観測 / graduation 判定
- **Grep checks (§4)**: code-side invariant の継続検証（PR レビュー時 / 週次の任意の時点）
- **Anomaly handling (§5–§9)**: 異常 signal 検出時の decision tree + 手順

soak 期間中は **本 runbook が operator の primary reference**。各 checklist / pressure audit は本 runbook から cross-reference される。

---

## 1. Pre-soak verification

soak を **開始する前** に確認する。すべて PASS でなければ soak を開始しない。

- [ ] [`schema_apply_preflight.md §9`](./schema_apply_preflight.md) **Verdict が GO FOR SOAK**（schema apply + 4 mirror smoke + activityData submit-only + kill-switch round-trip すべて mechanical に PASS している）
- [ ] [`phase1_completion_checklist.md §1`](./phase1_completion_checklist.md) 全 grep が PASS
- [ ] [`phase1_completion_checklist.md §4`](./phase1_completion_checklist.md) operator-side schema apply checkbox が完了
- [ ] [`phase1_completion_declaration.md §5.1`](./phase1_completion_declaration.md) Soak Launch Gates が全 PASS
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npx eslint lib/supabase/` exit 0
- [ ] 直近 24h 以内に runtime PR が landed していない（soak baseline 安定のため、推奨）

---

## 2. Daily checks

operator が 1 日 1 回 Supabase SQL Editor で実行する **5 query**。

### 2.1 Per-feature success ratio (last 24h)

```sql
SELECT
  feature,
  count(*) FILTER (WHERE mirror_status = 'success') AS successes,
  count(*) FILTER (WHERE mirror_status = 'failure') AS failures,
  count(*) FILTER (WHERE mirror_status = 'skipped') AS skips,
  count(*) FILTER (WHERE mirror_status = 'disabled') AS disabled,
  count(*) AS total,
  ROUND(
    count(*) FILTER (WHERE mirror_status = 'success')::numeric
    / NULLIF(count(*), 0),
    4
  ) AS success_rate
FROM mirror_events
WHERE created_at >= now() - interval '24 hours'
GROUP BY feature
ORDER BY feature;
```

**期待**: 4 feature （`studentProfile` / `basicInfo` / `diagnosis` / `activityData`）すべてで `success_rate >= 0.95`、`disabled` = 0。

**逸脱時**:
- `success_rate < 0.95` → §5 failure_reason distribution へ
- `disabled > 0` → kill-switch ON 状態 / unintended deploy 疑い → §7 kill-switch verification へ
- 4 feature のいずれかが `total = 0` → §6 mirror volume anomaly へ

### 2.2 Failure reason distribution (last 24h)

```sql
SELECT
  feature,
  failure_reason,
  count(*) AS n
FROM mirror_events
WHERE mirror_status = 'failure'
  AND created_at >= now() - interval '24 hours'
GROUP BY feature, failure_reason
ORDER BY feature, n DESC;
```

**期待**: `network_error` が apply 直後の数件のみ、`unknown` < 1% / `missing_env` = 0 (production) / `client_unavailable` = 0。

**逸脱時**:
- `network_error` が継続増加 → §5.1 / §8 へ
- `unknown` 比率 > 1% → mirror header の `err.name` が分類不能 → 別 STEP で分類拡張検討
- `missing_env` > 0 in production → env var 設定欠落 → operator action

### 2.3 activityData typing-only verification

最近 1h で `feature='activityData'` の row が **submit 経路以外で increment していない** ことを確認:

```sql
SELECT
  date_trunc('minute', created_at) AS minute,
  count(*) AS n
FROM mirror_events
WHERE feature = 'activityData'
  AND mirror_status = 'success'
  AND created_at >= now() - interval '1 hour'
GROUP BY 1
ORDER BY 1 DESC;
```

**期待**: 1 minute あたりの件数が **submit rate と整合**（数件〜数十件 / 分が production max 想定）。

**逸脱時**:
- 1 minute あたり 100 件以上 → autosave leak の疑い → §9 activityData flood へ即移行

### 2.4 schema_version distribution

```sql
SELECT
  feature,
  schema_version,
  count(*) AS n
FROM mirror_events
WHERE created_at >= now() - interval '24 hours'
GROUP BY feature, schema_version
ORDER BY feature, schema_version;
```

**期待**: 各 feature について 1 つの `schema_version` のみ（`"1"`）。
STEP-SOAK-1 後の `mirror_events.schema_version` 値の出どころ:
- `basicInfo` / `diagnosis` / `activityData`: 各 mirror helper 内の `SCHEMA_VERSION = "1"` 定数
- `studentProfile`: caller (`lib/studentProfileStorage.ts`) が `String(profile.version)` を `input.schemaVersion` で渡し、`meta.schemaVersion` 経由で到達

**逸脱時**: 同 feature に複数 `schema_version` 混在 → partial deploy / stale tab 識別 → §10 stale client detection へ

### 2.5 Mirror volume sanity

```sql
SELECT
  date_trunc('hour', created_at) AS hour,
  feature,
  count(*) AS n
FROM mirror_events
WHERE created_at >= now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

**期待**: 各 hour の件数が前週同曜日 / 同時刻の baseline と概ね一致（±50%）。

**逸脱時**:
- baseline × 10 以上 → flood の疑い → §9 へ
- baseline × 0.1 以下 → kill-switch 誤 ON / deploy 失敗 / production traffic 消失の疑い → §7 へ

---

## 3. Weekly checks

soak 開始から 7 日後の **graduation 判定** に使う。

### 3.1 7-day success rate

```sql
SELECT
  feature,
  date_trunc('day', created_at) AS day,
  count(*) FILTER (WHERE mirror_status = 'success')::numeric
    / NULLIF(count(*), 0) AS success_rate,
  count(*) AS attempts
FROM mirror_events
WHERE created_at >= now() - interval '7 days'
GROUP BY feature, day
ORDER BY feature, day;
```

**Graduation threshold**: 全 feature × 7 日連続で `success_rate >= 0.95`。

### 3.2 7-day failure reason cumulative

```sql
SELECT
  feature,
  failure_reason,
  count(*) AS n
FROM mirror_events
WHERE mirror_status = 'failure'
  AND created_at >= now() - interval '7 days'
GROUP BY feature, failure_reason
ORDER BY feature, n DESC;
```

**Graduation threshold**: `unknown` failure 比率 < 1% / `network_error` が apply 直後の数件のみ。

### 3.3 7-day activityData payload size distribution

```sql
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY length(payload::text)) AS p50,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY length(payload::text)) AS p90,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY length(payload::text)) AS p99,
  max(length(payload::text)) AS max_bytes,
  count(*) AS rows
FROM activity_mirrors
WHERE created_at >= now() - interval '7 days';
```

**期待**: p50 < 50 KB / p90 < 100 KB / p99 < 500 KB / max < 5 MB（[`phase1_boundary_pressure_audit.md §4.3`](./phase1_boundary_pressure_audit.md) 閾値）。

**逸脱時**: §11 payload pressure investigation へ

### 3.4 7-day stale client residual

```sql
SELECT
  feature,
  client_version,
  count(*) AS n,
  min(created_at) AS first_seen,
  max(created_at) AS last_seen
FROM mirror_events
WHERE created_at >= now() - interval '7 days'
GROUP BY feature, client_version
ORDER BY feature, n DESC;
```

**期待**: 最新 `client_version` が支配的、旧 version 比率が時間経過で減衰。
STEP-SOAK-1 後の `mirror_events.client_version` 値の出どころ:
- `NEXT_PUBLIC_APP_COMMIT` が build 時に設定されていれば commit sha が入る
- 設定されていない deploy では sentinel `"unknown"` 1 bucket に丸まる（all-NULL 回避目的）

`"unknown"` bucket が支配的なまま soak を回す場合、commit 別の deploy 識別はできず stale tail / 現 bundle の区別が粗い。改善したければ Vercel project の env に `NEXT_PUBLIC_APP_COMMIT=$VERCEL_GIT_COMMIT_SHA` を追加 + redeploy。

**逸脱時**: redeploy 後 7 日経過しても旧 version 5% 以上 → §10 へ

### 3.5 7-day kill-switch verification

`disabled` row が 0 件である:

```sql
SELECT count(*) AS n
FROM mirror_events
WHERE mirror_status = 'disabled'
  AND created_at >= now() - interval '7 days';
```

**期待**: `n = 0`（kill-switch を意図的に ON にしていない場合）。

**逸脱時**: §7 へ

---

## 4. Grep checks

soak 期間中、**code-side invariant が破壊されていないこと** を確認する。PR レビュー時 or 週次の任意の時点で実行。

```bash
# .select( runtime hit = 0
grep -rn "\.select(" lib/supabase/ app/ hooks/ lib/ \
  | grep -v "node_modules\|.next" \
  | grep -v "select-none\|select-auto\|select-all\|select-text\|select-contain"
# 期待: hit は README literal text のみ

# Each mirror dispatch site = 1
grep -rn "mirrorActivityData" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next"
grep -rn "mirrorBasicInfo" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next"
grep -rn "mirrorDiagnosis" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next"
grep -rn "mirrorStudentProfile" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next"
# 期待: 各 mirror 1 dispatch site のみ + 自己参照

# Mirror × onChange leak
grep -rn "mirrorActivityData\|mirrorBasicInfo\|mirrorDiagnosis\|mirrorStudentProfile" hooks/ \
  | grep -i "onChange"
# 期待: hit ゼロ

# NEXT_PUBLIC_SUPABASE_* reader spread
grep -rn "NEXT_PUBLIC_SUPABASE" --include="*.ts" --include="*.tsx" . \
  | grep -v "node_modules\|.next\|docs"
# 期待: hit は lib/supabase/env.ts / mirrorConfig.ts / mirrorEventSink.ts のみ

# Generic upsert helper の不在
ls lib/supabase/ | grep -E "upsert|mirrorHelper|mirrorFactory|mirrors/"
# 期待: hit ゼロ
```

invariant 違反が検出されたら **soak 中断** + [`phase1_boundary_freeze.md`](./phase1_boundary_freeze.md) gate 違反 PR を特定。

---

## 5. Anomaly: failure_reason flood

### Decision tree

```
failure_reason flood detected (24h cumulative > prev week × 5)
│
├─ failure_reason == "network_error" 主体?
│   ├─ Yes → §5.1 network_error investigation
│   └─ No  → §5.2 へ
│
├─ failure_reason == "unknown" 主体?
│   ├─ Yes → §5.3 unknown failure investigation
│   └─ No  → §5.2 へ
│
└─ failure_reason == "missing_env" / "client_unavailable" 出現?
    ├─ Yes → §5.4 env / client investigation
    └─ No  → 続報待ち / observation only
```

### 5.1 network_error investigation

possible causes:

- **mirror table 不在 / DROP された** → Supabase Studio で対象 table 存在確認
- **RLS policy が anon insert を reject** → `pg_policies` で policy 確認
- **schema_version mismatch（NOT NULL column 追加 等）** → schema 比較
- **DNS / TLS / Supabase project outage** → Supabase status page 確認 / 別 sink から ping

action: 原因確定までは **Level 0 observation**、確定後 Level 1 / Level 3 を選択。

### 5.2 mixed failure_reason

`failure_reason` 分布が分散 → root cause 不確定。Level 0 で観測継続、24h 後再評価。

### 5.3 unknown failure investigation

possible causes:

- mirror helper `catch (err)` で `err.name` が `Error` 標準を外れている → mirror header の `err instanceof Error` 分岐を確認
- 新しい error class（fetch abort / DOMException 等）→ 別 STEP で分類拡張検討
- production traffic に bot / proxy が混入 → `mirror_events.environment` で識別

action: `unknown` 比率が 5% 未満なら observation only、5% 超なら別 STEP 起票。

### 5.4 env / client investigation

`missing_env` が production で観測 → `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` の env 設定欠落。

action: Vercel dashboard で env 設定を確認 → 修正 → redeploy。

---

## 6. Anomaly: mirror volume spike or drop

### Spike (24h count > prev week × 10)

possible causes:

- **autosave leak**（activityData の場合）→ §9 へ即移行
- **bot abuse**（anonymous-write RLS への攻撃）→ Level 3 fast-path kill 検討
- **client retry loop**（誰かが retry を実装した PR）→ §4 grep でローカル retry 検出

action: 原因確定までに 30 分以内 → Level 1 kill-switch ON + redeploy / 並行で Level 3 Supabase 側 RLS 撤去 / `DROP TABLE` 検討。

### Drop (24h count < prev week × 0.1)

possible causes:

- **kill-switch 誤 ON** → §7 へ
- **deploy 失敗 / build error で旧 bundle が serve されている** → Vercel deploy log 確認
- **observability sink 側だけ落ちている** → `mirror_*` mirror table の row 数と比較
- **production traffic 自体が消失** → Vercel analytics / 他 sink 確認

action: 原因確定。kill-switch 誤 ON なら redeploy で解除、deploy 失敗なら rollback。

---

## 7. Anomaly: kill-switch unexpected state

### `disabled` rows 出現（kill-switch を意図的に ON にしていない）

possible causes:

- 別 contributor が誤って `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` を Vercel に設定
- Preview env で `true` 設定が production にコピーされた
- env override が CI / build script に混入

action:

1. Vercel dashboard → Environment Variables で対象 env 確認
2. `true` 設定があれば削除 or `false`（実装上 DISABLED_VALUES に含まれないため OFF と等価）に変更
3. redeploy
4. propagation 確認: 24h 以内に `disabled` row 出現が止まる

### `disabled` rows が消えない（kill-switch 解除したのに残る）

possible causes:

- redeploy 完了前 / stale client が旧 bundle で動いている
- module-level cache（`cachedEnabled`）が build-time 値を保持

action: Level 0 observation で stale tail を観察。redeploy 後 24h 経過で減衰しなければ別 STEP。

---

## 8. Anomaly: schema mismatch

possible causes:

- runtime SCHEMA_VERSION と DB schema の組み合わせが不整合
- 新 NOT NULL column 追加 + partial deploy
- RENAME / TYPE 変更後の deploy 順序間違い

action:

1. `mirror_events.schema_version` と現 deploy の `client_version` を突き合わせ
2. Supabase Studio で対象 table の column 構成を runtime 期待と比較
3. mismatch があれば deploy 順序 / schema 整備の別 STEP

---

## 9. Anomaly: activityData flood

最も重要な incident pattern。submit-driven contract（STEP-PHASE1M / N）への違反を検知する。

### Detection

```sql
-- 1 minute あたり 100 件以上の activityData success row
SELECT
  date_trunc('minute', created_at) AS minute,
  count(*) AS n
FROM mirror_events
WHERE feature = 'activityData'
  AND mirror_status = 'success'
  AND created_at >= now() - interval '1 hour'
GROUP BY 1
HAVING count(*) >= 100
ORDER BY 1 DESC;
```

または:

```sql
-- 単一 source_hash の上に多重 update が出現（idempotent ですらない rapid update）
SELECT
  source_hash,
  count(*) AS update_count
FROM activity_mirrors
WHERE created_at >= now() - interval '1 hour'
GROUP BY source_hash
HAVING count(*) >= 50
ORDER BY update_count DESC;
```

### Likely root causes

順に疑う:

1. **autosave 経路に mirror dispatch が追加された**: §4 grep で `mirrorActivityData` の dispatch site が 2 箇所以上に増えていないか確認。`saveActivityData` 内 / `useActivityForm` の autosave path に dispatch があれば bingo
2. **`handleSubmit` のループ呼び出し**: form 連打 / `isLoading` / `isSuccess` state guard 破壊 / React strict-mode の dev double-effect が production に漏れている
3. **stale tab の bfcache replay flood**: モバイル user 群が bfcache 復元で submit を多重発火 → `mirror_events.environment` / 時刻分布で識別
4. **自動化 bot**: anonymous endpoint への自動 submit。RLS は anonymous insert を許しているため authn では止まらない

### Response sequence

1. **immediate**: `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` → redeploy（Level 1 slow path、数分）
2. **parallel**: Supabase SQL Editor で `DROP POLICY ... ON activity_mirrors;` で anon insert 撤去（Level 3 fast path、即時反映）
3. **investigate**: §4 grep + recent PR diff で原因特定
4. **cleanup**: `DELETE FROM activity_mirrors WHERE created_at >= '...'` で flood row 削除（service-role）
5. **recover**: 原因修正 PR → land → kill-switch OFF + RLS 復活 → soak 再開

---

## 10. Anomaly: stale client persistence

### Detection

```sql
SELECT
  feature,
  client_version,
  count(*) AS n
FROM mirror_events
WHERE created_at >= now() - interval '7 days'
GROUP BY feature, client_version
ORDER BY feature, n DESC;
```

最新 `client_version` 以外が **>= 5%** の比率で出現し続ける。

### Action

- Phase1 では **強制停止しない**（observation only）
- mobile / PWA / bfcache が user 群依存のため、tail length は自然減衰を待つ
- stale client が新 schema を破壊するシナリオ: `mirror_events.schema_version` 単独で識別可能 → 別 STEP で対応判定
- 30 日以上 5% を超えて残るようなら、user-side 強制 reload の手段を Phase2 設計に組み込む（dashboard / banner 等）

---

## 11. Anomaly: payload pressure investigation

### Trigger

§3.3 で `p99 > 推定値 5×` または `max > 5 MB`。

### Action

```sql
-- 異常 size の row を identify
SELECT id, length(payload::text) AS bytes, created_at
FROM activity_mirrors
WHERE length(payload::text) > 1000000  -- > 1 MB
ORDER BY bytes DESC
LIMIT 50;
```

可能性:

- **copy-paste abuse**: ESSAY 全文を `description` に貼った user → individual case 対応（observation only）
- **accidental giant textarea**: メモを丸ごと貼った user → individual case 対応
- **automated abuse**: bot が large payload を送り続ける → Level 3 fast-path kill 検討

action: individual case なら observation only / accumulated abuse なら client-side `maxLength` 追加 STEP を起票。

---

## 12. Incident response sequence (summary)

事故発生時の典型シーケンス:

1. **Detect** — daily / weekly check で anomaly 検出
2. **Triage** — §5–§11 の decision tree で原因仮定
3. **Mitigate** — [`phase1_completion_declaration.md §7 Incident Escalation Ladder`](./phase1_completion_declaration.md) の適切な Level を起動
4. **Investigate** — root cause を §4 grep + git log + Supabase Studio で特定
5. **Fix** — 修正 PR を起票（soak 中断 → 修正 PR landed → soak 再開）
6. **Verify** — 修正後 24h で `mirror_events` が正常に戻ったことを確認
7. **Document** — 事後 postmortem を別 STEP として記録 / 必要なら本 runbook を更新

すべての response で **canonical UX は不変**。incident 中も localStorage に書き込まれた user data は失われない。

---

## 13. Soak completion

soak 期間（典型 7 日）の最終日に以下を確認:

- [ ] §3.1 7-day success rate: 全 feature × 7 日連続で `>= 0.95`
- [ ] §3.2 7-day failure reason: `unknown` < 1% / `network_error` apply 直後のみ
- [ ] §3.3 7-day activityData payload: p99 < 推定範囲内
- [ ] §3.4 7-day stale client: tail が時間経過で減衰
- [ ] §3.5 7-day kill-switch: `disabled` row = 0
- [ ] §4 grep checks: 全 PASS
- [ ] 期間中 incident なし、または incident response 後に baseline 復帰

すべて PASS なら Phase1 soak は **graduation 達成**。Phase2 着手 STEP の input data として soak query 結果を保存。

部分 PASS でも、soak 期間延長 / Phase2 設計入力としての継続観測は可能。Phase1 完了宣言 ≠ soak graduation（[`phase1_completion_declaration.md §9.2`](./phase1_completion_declaration.md)）。

---

## 締めくくり

本 runbook は **judgement を含まず** mechanical に運用できることが最大の価値。判断要素（許容するか / Phase 進行するか）は [`phase1_completion_declaration.md`](./phase1_completion_declaration.md) / [`phase1_boundary_freeze.md`](./phase1_boundary_freeze.md) を参照する。
operator は本 runbook を手元に置きつつ、anomaly detection 時には判断 doc 群を referenced して response level を選択する。両者の役割分担で、soak 期間中の operator 判断が再現可能 + 説明可能な状態を維持する。
