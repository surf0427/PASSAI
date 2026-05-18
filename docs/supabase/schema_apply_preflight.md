# Schema Apply Preflight + Smoke Test Runbook

operator が `supabase/schema.sql` を Supabase project に apply する直前 → apply 直後 → smoke test → soak 開始判定までを **mechanical に** 回すための single-page runbook。

[`soak_launch_audit.md`](./soak_launch_audit.md) で identified した最後の operator-action ギャップ (schema apply / smoke / kill-switch verify) を埋める。判断要素は本 doc 外（[`phase1_completion_declaration.md`](./phase1_completion_declaration.md) / [`phase1_boundary_freeze.md`](./phase1_boundary_freeze.md)）に委ね、本 doc は **コマンド + 期待結果 + 分岐** に特化する。

関連: [phase1_completion_declaration.md](./phase1_completion_declaration.md), [phase1_completion_checklist.md](./phase1_completion_checklist.md), [phase1_soak_runbook.md](./phase1_soak_runbook.md), [soak_launch_audit.md](./soak_launch_audit.md), [basic_info_post_apply_checklist.md](./basic_info_post_apply_checklist.md), [diagnosis_post_apply_checklist.md](./diagnosis_post_apply_checklist.md), [activity_post_apply_checklist.md](./activity_post_apply_checklist.md), [observability_sink.md](./observability_sink.md), [phase1_boundary_freeze.md](./phase1_boundary_freeze.md)

---

## 1. Purpose

### Why preflight before schema apply

[`soak_launch_audit.md §7`](./soak_launch_audit.md) は **READY WITH NARROWED CAVEATS** を判定し、残る gate は:

- schema apply 未確認
- chunk-fetch silent failure（外部 signal なしでは検知不能 / day1 smoke で代替検知）
- commit-level `client_version` (env optional)

これらのうち **schema apply は doc-first で mechanical に潰せる**。schema apply 失敗 / 部分 apply / RLS 設定漏れは soak 開始後に detect すると `mirror_events` 全件 `network_error` に化け、failure_reason の意味が消える。soak 開始前の最後のチェックポイントとして preflight が必要。

### Code readiness vs live DB readiness

| 軸 | 確認手段 | 本 doc の責任 |
|---|---|---|
| **Code readiness** | `npx tsc --noEmit` / `npx eslint` / grep audit / [`phase1_completion_checklist.md`](./phase1_completion_checklist.md) | §2 で再確認 |
| **Live DB readiness** | SQL Editor で実行する `pg_class` / `pg_policies` / `pg_trigger` query | §4 が all-table sweep を担当 |
| **End-to-end smoke** | 4 mirror を実際に dispatch して `mirror_events` 反映を確認 | §5 が browser-side 手順を担当 |
| **Trigger contract integrity** | activityData の typing-only verification（autosave leak 検出） | §6 が担当 |
| **Kill-switch propagation** | env flip + redeploy → `disabled` row 観測 | §7 が担当 |
| **Failure mode taxonomy** | failure_reason 分布の事前理解 | §8 decision tree |
| **Final go / no-go** | 7 gates の集約判定 | §9 が verdict を出す |

本 doc は **operator が打つコマンドのみ** を記述する。runtime 変更 / schema 変更を一切行わない。

---

## 2. Pre-Apply Checklist

apply ボタンを押す **直前** に、operator がローカルマシンで実行する pre-flight。**全項目 PASS でなければ apply に進まない**。

### 2.1 Repo state

```bash
git status                                     # 想定外の uncommitted runtime 変更が無いか
git log --oneline -5                           # 直近 commit を確認
git branch --show-current                      # 想定 branch にいるか
```

期待:
- supabase/schema.sql に未 commit の変更がある場合は **STOP**（apply 内容と repo 内容が乖離する）
- runtime コード (`lib/supabase/` / `hooks/` / `lib/*Storage.ts` / `app/`) に未 commit の変更がある場合は merge 後に再評価

### 2.2 TypeScript / ESLint clean

```bash
npx tsc --noEmit              # exit 0 期待
npx eslint lib/supabase/      # exit 0 期待
```

逸脱時:
- TS error → 修正してから再評価
- ESLint error → `lib/supabase/` 内に新規問題があれば修正 / 既知の他箇所 warning は対象外

### 2.3 Runtime invariant grep

```bash
# .select( runtime hit = 0（README literal 除く）
grep -rn "\.select(" lib/supabase/ app/ hooks/ lib/ \
  | grep -v "node_modules\|.next" \
  | grep -v "select-none\|select-auto\|select-all\|select-text\|select-contain"
# 期待: hit は README literal text のみ

# 4 mirror dispatch site 各 1 箇所のみ
for h in mirrorStudentProfile mirrorBasicInfo mirrorDiagnosis mirrorActivityData; do
  echo "=== $h ==="
  grep -rn "${h}ToSupabase" --include="*.ts" --include="*.tsx" . \
    | grep -v "node_modules\|.next" \
    | grep -v "lib/supabase/"  # 自己定義は除外
done
# 期待: 各 mirror について storage 側 dispatch 行 + 自己 export の 2 hit のみ
#   studentProfile → lib/studentProfileStorage.ts
#   basicInfo      → lib/basicInfoStorage.ts
#   diagnosis      → lib/diagnosisStorage.ts
#   activityData   → hooks/useActivityForm.ts

# autosave 経路 leak 検出
grep -rn "mirrorActivityData\|mirrorBasicInfo\|mirrorDiagnosis\|mirrorStudentProfile" hooks/ \
  | grep -i "onChange"
# 期待: hit ゼロ
```

逸脱時: 新 dispatch site が増えていれば [`phase1_boundary_freeze.md §5`](./phase1_boundary_freeze.md) gate 違反 — apply 前に別 STEP で原因特定。

### 2.4 Required env present

```bash
grep -E "^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY)=" .env.local \
  | sed 's/=.*/=<REDACTED>/'
```

期待: 2 行とも `<REDACTED>` 出力。値そのものは Supabase Studio で Settings → API から再確認。

production / preview deploy 環境では Vercel dashboard で同 2 env が設定済であることを確認。

### 2.5 Kill-switch env intent

```bash
grep -E "^NEXT_PUBLIC_SUPABASE_(MIRROR|OBSERVABILITY)_DISABLED=" .env.local
```

期待:
- 未設定 → mirror / sink 共に **enabled** (デフォルト) で apply に進む
- `true` / `1` / `yes` 設定がある → **意図したものかを operator が確認**（soak 開始時に意図せず disabled で立ち上げると `mirror_events` 0 件と区別不能になる）

### 2.6 `NEXT_PUBLIC_APP_COMMIT` (optional)

```bash
grep -E "^NEXT_PUBLIC_APP_COMMIT=" .env.local
```

未設定でも soak 開始は可能（STEP-SOAK-1 の `"unknown"` sentinel で degrade）。commit 別 deploy 識別を取りたい場合は Vercel project の Environment Variables に `NEXT_PUBLIC_APP_COMMIT=$VERCEL_GIT_COMMIT_SHA` を追加 + redeploy。

### 2.7 schema.sql 最新確認

```bash
wc -l supabase/schema.sql                 # 行数の sanity check (現行 420 行)
grep -E "^CREATE TABLE" supabase/schema.sql
grep -E "^CREATE POLICY" supabase/schema.sql
```

期待:
- `CREATE TABLE` 5 行: `student_profile_mirrors` / `mirror_events` / `basic_info_mirrors` / `diagnosis_mirrors` / `activity_mirrors`
- `CREATE POLICY` 9 行: 各 mirror table の `anon insert` + `anon update` (8) + `mirror_events anon insert` (1)
- **SELECT / DELETE policy が grep に出てきたら STOP** — Phase1 contract 違反

### 2.8 Pre-apply gate summary

全 PASS でなければ §3 に進まない:

- [ ] §2.1 repo state clean / branch correct
- [ ] §2.2 tsc / eslint exit 0
- [ ] §2.3 grep: `.select(` 0 / 4 dispatch site 各 1 / onChange leak 0
- [ ] §2.4 `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` 設定済
- [ ] §2.5 kill-switch env が意図通り
- [ ] §2.6 `NEXT_PUBLIC_APP_COMMIT` の有無を意識（必須ではない）
- [ ] §2.7 schema.sql に予期しない SELECT/DELETE policy なし

---

## 3. Apply Order

`supabase/schema.sql` は 1 ファイルで `CREATE TABLE` × 5 + trigger + RLS + policy をまとめて含む。Supabase SQL Editor で **全体を 1 トランザクション** として実行するのが標準。

### 3.1 Standard apply (一括)

1. Supabase project の SQL Editor を開く（`https://app.supabase.com/project/<project>/sql`）
2. 新規 query タブを開き、`supabase/schema.sql` の全内容を貼り付け
3. **Run** を押す
4. エラーが出なければ §4 へ
5. エラーが出たら §3.2 segment-by-segment apply へ移行

### 3.2 Segment-by-segment apply (失敗切り分け)

一括 apply が失敗した場合 / 途中の section を再適用したい場合の順序。順序は **DDL 依存関係** で決まる（trigger function が table より先に存在しないと壊れる）。

```
1. CREATE EXTENSION pgcrypto         (§1)
2. CREATE TABLE student_profile_mirrors  (§2)
3. CREATE FUNCTION set_updated_at()      (§3) ← 後段の trigger が依存
4. CREATE TRIGGER student_profile_mirrors_set_updated_at  (§3 続き)
5. RLS + policies for student_profile_mirrors  (§4)
6. CREATE TABLE mirror_events            (§5)
7. RLS + policy for mirror_events        (§6)
8. CREATE TABLE basic_info_mirrors       (§7)
9. CREATE TRIGGER basic_info_mirrors_set_updated_at  (§8)
10. RLS + policies for basic_info_mirrors  (§9)
11. CREATE TABLE diagnosis_mirrors       (§10)
12. CREATE TRIGGER diagnosis_mirrors_set_updated_at  (§11)
13. RLS + policies for diagnosis_mirrors  (§12)
14. CREATE TABLE activity_mirrors        (§13)
15. CREATE TRIGGER activity_mirrors_set_updated_at  (§14)
16. RLS + policies for activity_mirrors  (§15)
```

各 step 後に §4 の対応 query を実行し、成功した step まで progress する。

### 3.3 Idempotency note

`schema.sql` は `CREATE TABLE` / `CREATE POLICY` を `IF NOT EXISTS` 無しで書いている（運用上、誤った再 apply で sliently 上書きするのを避けるため）。同 project に再 apply するとエラー:

- `relation "..." already exists` → **正常**（既に apply 済）/ §4 で内容を verify
- `policy "..." for table "..." already exists` → **正常**

drop して re-apply したいときは fast-path kill 手順（§5.2 / [`activity_post_apply_checklist.md §5.2`](./activity_post_apply_checklist.md)）を別途実行。

---

## 4. Post-Apply Verification SQL

apply 完了直後に Supabase SQL Editor で実行する **5 系統 × 5 table** の sweep。

### 4.1 Tables exist

```sql
SELECT relname
FROM pg_class
WHERE relkind = 'r'
  AND relname IN (
    'student_profile_mirrors',
    'basic_info_mirrors',
    'diagnosis_mirrors',
    'activity_mirrors',
    'mirror_events'
  )
ORDER BY relname;
```

期待: 5 行（順に `activity_mirrors` / `basic_info_mirrors` / `diagnosis_mirrors` / `mirror_events` / `student_profile_mirrors`）。

**1 つでも欠ければ STOP** — §3.2 の対応 step を再実行。

### 4.2 RLS enabled

```sql
SELECT relname, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname IN (
  'student_profile_mirrors',
  'basic_info_mirrors',
  'diagnosis_mirrors',
  'activity_mirrors',
  'mirror_events'
)
ORDER BY relname;
```

期待: 全 5 行で `rls_enabled = true`。

**false が 1 つでもあれば STOP** — anon が無防備に reach できる状態。`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` を再実行。

### 4.3 INSERT policy exists (all 5 tables)

```sql
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename IN (
  'student_profile_mirrors',
  'basic_info_mirrors',
  'diagnosis_mirrors',
  'activity_mirrors',
  'mirror_events'
) AND cmd = 'INSERT'
ORDER BY tablename;
```

期待: 5 行。各 table に対し `{anon}` ロールの INSERT policy 1 つずつ。

| tablename | policyname | cmd | roles |
|---|---|---|---|
| activity_mirrors | activity_mirrors anon insert | INSERT | {anon} |
| basic_info_mirrors | basic_info_mirrors anon insert | INSERT | {anon} |
| diagnosis_mirrors | diagnosis_mirrors anon insert | INSERT | {anon} |
| mirror_events | mirror_events anon insert | INSERT | {anon} |
| student_profile_mirrors | student_profile_mirrors anon insert | INSERT | {anon} |

### 4.4 UPDATE policy exists (4 mirror tables only)

```sql
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename IN (
  'student_profile_mirrors',
  'basic_info_mirrors',
  'diagnosis_mirrors',
  'activity_mirrors'
) AND cmd = 'UPDATE'
ORDER BY tablename;
```

期待: 4 行。各 mirror table に対し `{anon}` ロールの UPDATE policy 1 つずつ。

`mirror_events` には UPDATE policy が存在しないこと（append-only sink）も §4.5 で確認。

### 4.5 SELECT policy absent (全 5 table)

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN (
  'student_profile_mirrors',
  'basic_info_mirrors',
  'diagnosis_mirrors',
  'activity_mirrors',
  'mirror_events'
) AND cmd = 'SELECT';
```

期待: **0 行**。Phase1 invariant: runtime read path 不在は SQL 層でも保証する。

**1 行でも出たら STOP** — `DROP POLICY "..." ON ...;` で即座に撤去。

### 4.6 DELETE policy absent (全 5 table)

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN (
  'student_profile_mirrors',
  'basic_info_mirrors',
  'diagnosis_mirrors',
  'activity_mirrors',
  'mirror_events'
) AND cmd = 'DELETE';
```

期待: **0 行**。client から DELETE できる経路は無い（service-role 経由のみ rollback / purge 可能）。

### 4.7 Triggers exist (4 mirror tables)

```sql
SELECT tgname, tgrelid::regclass AS table_name
FROM pg_trigger
WHERE tgname IN (
  'student_profile_mirrors_set_updated_at',
  'basic_info_mirrors_set_updated_at',
  'diagnosis_mirrors_set_updated_at',
  'activity_mirrors_set_updated_at'
)
ORDER BY tgname;
```

期待: 4 行。それぞれ対応する `<feature>_mirrors` table に紐づく。

`mirror_events` に trigger は存在しない（append-only / `updated_at` カラム自体無し）。

### 4.8 `set_updated_at()` function exists

```sql
SELECT proname, pronargs
FROM pg_proc
WHERE proname = 'set_updated_at';
```

期待: 1 行 / `pronargs = 0`。

§4.7 の 4 trigger が共有する function。欠落していれば trigger は壊れる（INSERT 自体は通るが UPDATE 時に `updated_at` が固定値のまま）。

### 4.9 Column shape sweep (任意 / spot-check)

```sql
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name IN (
  'student_profile_mirrors',
  'basic_info_mirrors',
  'diagnosis_mirrors',
  'activity_mirrors',
  'mirror_events'
)
ORDER BY table_name, ordinal_position;
```

mirror table 4 つは `id / source_hash / schema_version / payload / created_at / updated_at` の 6 列。`mirror_events` は `id / feature / mirror_status / failure_reason / skip_reason / duration_ms / environment / schema_version / client_version / created_at` の 10 列。各 post_apply checklist (basicInfo §1.4 / diagnosis §1.4 / activity §1.4) の per-table 期待値と整合することを確認。

### 4.10 Post-apply gate summary

全 PASS でなければ §5 smoke test に進まない:

- [ ] §4.1 5 table 存在
- [ ] §4.2 全 5 table で `rls_enabled = true`
- [ ] §4.3 INSERT policy 5 つ全て
- [ ] §4.4 UPDATE policy 4 つ全て
- [ ] §4.5 SELECT policy **0 件**
- [ ] §4.6 DELETE policy **0 件**
- [ ] §4.7 trigger 4 つ全て
- [ ] §4.8 `set_updated_at()` function 存在
- [ ] §4.9 column shape spot-check（任意）

---

## 5. Smoke Test Procedure

4 mirror それぞれを **browser から実際に dispatch** し、`mirror_events` + 対応 mirror table に row が立つことを確認する。dev / preview / production のいずれか **traffic を operator が制御できる環境** で実行。

### Common precondition

```sql
-- baseline: smoke test 直前の row count を記録
SELECT feature, count(*) AS before_n
FROM mirror_events
WHERE created_at >= now() - interval '1 hour'
GROUP BY feature
ORDER BY feature;
```

### 5.1 studentProfile smoke

operator 手順:
1. browser で `/diagnosis` → `/wall-hitting` を経由するなどして `lib/studentProfile.ts:toStudentProfile()` が呼ばれる feature flow を 1 回完了する（`/wall-hitting/result` まで到達 → confirm で `saveStudentProfile()` が走る経路）
2. 30 秒待機

verification:

```sql
SELECT feature, mirror_status, schema_version, client_version, duration_ms, failure_reason
FROM mirror_events
WHERE feature = 'studentProfile'
  AND created_at >= now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

期待:
- 1 行以上、`mirror_status = 'success'`
- `schema_version = '1'` (or `String(profile.version)` — Phase1 では `'1'`)
- `client_version`: env 設定済なら commit sha / 未設定なら `'unknown'`
- `duration_ms`: integer ≥ 0（通常 50-500ms 程度、Supabase region による）
- `failure_reason = NULL`

mirror table 側:

```sql
SELECT id, schema_version, length(payload::text) AS bytes
FROM student_profile_mirrors
WHERE created_at >= now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

期待: 1 行、`schema_version = '1'`、`bytes` は数 KB 程度。

### 5.2 basicInfo smoke

operator 手順:
1. browser で `/input/basic` を開く
2. name / overallGpa / preferences 等を入力して **保存** ボタンを押す（or autosave が走る — `saveBasicInfo` が呼ばれる経路）
3. 30 秒待機

verification:

```sql
SELECT feature, mirror_status, schema_version, client_version, duration_ms, failure_reason
FROM mirror_events
WHERE feature = 'basicInfo'
  AND created_at >= now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

期待: §5.1 と同形 / `schema_version = '1'`。

mirror table 側 (PII strip 確認):

```sql
SELECT id, schema_version, payload ? 'name' AS has_name
FROM basic_info_mirrors
WHERE created_at >= now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

期待: 1 行以上、`has_name = false`（mirror helper の stripName が機能している証拠）。

**`has_name = true` が出たら STOP** — `mirrorBasicInfo.ts:stripName` が破壊されている。即時 `DELETE FROM basic_info_mirrors WHERE id = '<上記 id>';`（service-role）で除去 + 原因調査。

### 5.3 diagnosis smoke

operator 手順:
1. browser で `/diagnosis` を開く
2. 全質問に回答 → 結果ページに到達（`saveDiagnosisResult` が呼ばれる）
3. 30 秒待機

verification:

```sql
SELECT feature, mirror_status, schema_version, client_version, duration_ms, failure_reason
FROM mirror_events
WHERE feature = 'diagnosis'
  AND created_at >= now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

期待: §5.1 と同形 / `schema_version = '1'`。

mirror table 側:

```sql
SELECT id, schema_version, payload->>'resultType' AS result_type
FROM diagnosis_mirrors
WHERE created_at >= now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

期待: 1 行、`result_type` は `1` / `2` / `3` / `4` のいずれか。

### 5.4 activityData smoke

operator 手順:
1. browser で `/input/activity` を開く
2. 任意の activity section に 1 件 entry を作成
3. **送信** ボタンを押す（`hooks/useActivityForm.ts:handleSubmit` が走る）
4. 30 秒待機

verification:

```sql
SELECT feature, mirror_status, schema_version, client_version, duration_ms, failure_reason
FROM mirror_events
WHERE feature = 'activityData'
  AND created_at >= now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

期待: §5.1 と同形 / `schema_version = '1'`。

mirror table 側:

```sql
SELECT id, schema_version, length(payload::text) AS bytes
FROM activity_mirrors
WHERE created_at >= now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

期待: 1 行、`bytes` は user 入力に依存（数 KB〜数十 KB）。

### 5.5 Smoke aggregate

```sql
-- 4 feature 全てが success row を持つかの 1 ショット確認
SELECT
  feature,
  count(*) FILTER (WHERE mirror_status = 'success') AS successes,
  count(*) FILTER (WHERE mirror_status = 'failure') AS failures,
  count(*) FILTER (WHERE schema_version IS NULL) AS null_schema_version,
  count(*) FILTER (WHERE client_version IS NULL) AS null_client_version,
  count(*) FILTER (WHERE duration_ms IS NULL) AS null_duration_ms
FROM mirror_events
WHERE created_at >= now() - interval '30 minutes'
GROUP BY feature
ORDER BY feature;
```

期待: 4 行（`activityData` / `basicInfo` / `diagnosis` / `studentProfile`）、各 `successes >= 1`、`null_*` 系 3 列が **すべて 0**（STEP-SOAK-1 patch 後の verification）。

`null_schema_version` / `null_client_version` / `null_duration_ms` のいずれかが > 0 なら **STEP-SOAK-1 patch が deploy に反映されていない** — Vercel deploy 状態を確認、stale bundle 残存なら自然減衰 or hard refresh。

---

## 6. activityData Submit-Only Test

[`activity_post_apply_checklist.md §3.3`](./activity_post_apply_checklist.md) の typing-only verification を、smoke test と分離して必須化する。activityData の **submit-driven trigger contract** ([STEP-PHASE1M](./phase1_completion_declaration.md)) が live で機能していることの最重要 verification。

### 6.1 Typing-only (no submit)

```sql
SELECT count(*) AS before_n
FROM mirror_events
WHERE feature = 'activityData'
  AND mirror_status = 'success';
```
→ `before_n` 値を memo。

operator 手順:
1. browser で `/input/activity` を開く
2. 任意の activity section に文字を typing（**送信ボタンは押さない**）
3. localStorage の `activityFormData` 更新を DevTools で確認（autosave が canonical で動いている = OK）
4. ブラウザ tab を閉じる or 他ページに navigation
5. 60 秒待機

```sql
SELECT count(*) AS after_n
FROM mirror_events
WHERE feature = 'activityData'
  AND mirror_status = 'success';
```

期待: `after_n === before_n`（増分ゼロ）。

**増分 > 0 が出たら STOP** — autosave 経路に mirror dispatch 混入。`hooks/useActivityForm.ts` を再 grep、`saveActivityData` の中に `mirrorActivityDataToSupabase` 呼び出しが入っていないか確認。

### 6.2 Single submit increment

operator 手順:
1. browser で `/input/activity` を再度開く（前段で entry が残っていればそのまま使用）
2. **送信** を 1 回押す

```sql
SELECT count(*) AS submit_after_n
FROM mirror_events
WHERE feature = 'activityData'
  AND mirror_status = 'success';
```

期待: `submit_after_n === after_n + 1`（ちょうど 1 件増分）。

### 6.3 Double submit upsert idempotency

operator 手順:
1. `/input/activity` で同 entry のまま **送信を 2 回連続で押す**（実 UI では isLoading guard が走るので、isLoading guard を意図的に避けるなら DevTools console から `mirrorActivityDataToSupabase` を 2 回 invoke する。通常 UI 操作で再現できなければ skip 可）

```sql
-- mirror_events 側
SELECT count(*)
FROM mirror_events
WHERE feature = 'activityData'
  AND mirror_status = 'success'
  AND created_at >= now() - interval '5 minutes';

-- mirror table 側
SELECT source_hash, count(*) AS rows_per_hash
FROM activity_mirrors
WHERE created_at >= now() - interval '5 minutes'
GROUP BY source_hash
ORDER BY rows_per_hash DESC;
```

期待:
- `mirror_events` 側は 2 件増（dispatch 2 回 = event 2 件は仕様通り）
- `activity_mirrors` 側は同 `source_hash` で **1 行のみ**（upsert idempotency / UNIQUE constraint が機能）

**同 source_hash で 2 行以上に膨らんでいたら STOP** — `onConflict: "source_hash"` が壊れている。

### 6.4 Submit-only gate

- [ ] §6.1 typing only → increment 0
- [ ] §6.2 single submit → increment +1
- [ ] §6.3 double submit → mirror table の同 source_hash row が 1 のまま（任意 / 再現可能なら）

---

## 7. Kill-Switch Smoke Test

`NEXT_PUBLIC_*` は **build-time inlining** のため env 変更だけでは反映されない。必ず redeploy が必要（[`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md)）。

### 7.1 Baseline capture

```sql
SELECT count(*) AS baseline_disabled
FROM mirror_events
WHERE mirror_status = 'disabled'
  AND created_at >= now() - interval '1 hour';
```
→ `baseline_disabled` を memo（通常 0）。

### 7.2 Enable kill-switch

operator 手順:
1. Vercel project の Environment Variables で `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` を **対象環境** (Preview / Production) に追加
2. 該当環境を **Redeploy**（Vercel の "Redeploy" ボタン or `vercel --prod`）
3. deploy 完了を確認

### 7.3 Trigger any save flow

§5.1〜§5.4 のいずれか（最小は §5.2 basicInfo / form 入力 + 保存）を **redeploy 後の bundle で** 1 回実行。

### 7.4 Verify disabled rows

```sql
SELECT feature, mirror_status, client_version, count(*)
FROM mirror_events
WHERE mirror_status = 'disabled'
  AND created_at >= now() - interval '15 minutes'
GROUP BY feature, mirror_status, client_version;
```

期待:
- §7.3 で叩いた feature について `mirror_status = 'disabled'` row が 1 件以上
- mirror table（`basic_info_mirrors` 等）には **新規 row が増えていない**

```sql
SELECT count(*) AS new_basic_info_rows
FROM basic_info_mirrors
WHERE created_at >= now() - interval '15 minutes';
```
期待: §7.3 を §5.2 で実行した場合、`new_basic_info_rows = 0`（kill-switch ON で table 側書き込みが止まっている）。

### 7.5 Restore enabled state

operator 手順:
1. Vercel Environment Variables で `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` を **削除**（または `false` に変更 — `DISABLED_VALUES` に含まれない値ならば OFF と等価）
2. 対象環境を **再度 Redeploy**
3. §5 smoke を 1 回追試して `success` row が再び立つことを確認

### 7.6 Kill-switch gate

- [ ] §7.4 で `disabled` row 出現 + mirror table row 増えなし
- [ ] §7.5 で kill-switch OFF 後 `success` row 再出現
- [ ] kill-switch ON → OFF の 2 回の redeploy が完了して env が baseline に戻っている

---

## 8. Failure Handling

apply / smoke 中に発生し得る代表的な failure と decision tree。

### 8.1 `failure_reason = 'network_error'` が大量

- **first suspect**: schema apply 漏れ / RLS policy 未設定 / 対象 table DROP 済
- **verification**:
  ```sql
  -- 該当 feature の mirror table が存在し、anon insert が許可されているか
  SELECT relname FROM pg_class
  WHERE relname IN ('student_profile_mirrors','basic_info_mirrors','diagnosis_mirrors','activity_mirrors');
  SELECT tablename, policyname, cmd FROM pg_policies
  WHERE tablename IN ('student_profile_mirrors','basic_info_mirrors','diagnosis_mirrors','activity_mirrors');
  ```
- **action**: §3.2 で欠落 step を再 apply / §4 を再走

### 8.2 `failure_reason = 'missing_env'` が production で出現

- **first suspect**: Vercel project の `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` が target environment (Preview / Production) に設定されていない
- **verification**: Vercel dashboard → Settings → Environment Variables / 各環境の有無を確認
- **action**: env 追加 + redeploy / 再 smoke

### 8.3 `failure_reason = 'client_unavailable'`

- **first suspect**: env は読めたが `getBrowserSupabaseClient()` が `null` を返している → env 値の形式不正（URL に空白混入 / anon key の prefix 欠落）
- **verification**: browser DevTools console で `process.env.NEXT_PUBLIC_SUPABASE_URL` を確認 / Supabase Studio の Settings → API の正規 URL と diff
- **action**: env 値を正規形に修正 + redeploy

### 8.4 Schema mismatch / `mirror_events.schema_version` 混在

- **first suspect**: deploy 後に runtime 側 `SCHEMA_VERSION` が bump されたが、stale tab が旧 SCHEMA_VERSION で叩いている / または逆方向
- **verification**:
  ```sql
  SELECT feature, schema_version, client_version, count(*)
  FROM mirror_events
  WHERE created_at >= now() - interval '24 hours'
  GROUP BY feature, schema_version, client_version
  ORDER BY feature, schema_version;
  ```
- **action**: 旧 schema_version が「stale tab 自然減衰」で説明可能なら observe only / 不可解な混在は別 STEP で起票

### 8.5 RLS reject (`network_error` 内訳調査)

- **first suspect**: anon role に対する INSERT policy が `WITH CHECK` 条件で reject している（Phase1 の policy はすべて `WITH CHECK (true)` のはずなので、誤った custom policy 追加を疑う）
- **verification**:
  ```sql
  SELECT tablename, policyname, qual, with_check
  FROM pg_policies
  WHERE tablename LIKE '%_mirrors' OR tablename = 'mirror_events';
  ```
- **action**: 想定外 policy があれば `DROP POLICY "..." ON ...;` で撤去 → §4 を再走

### 8.6 `mirror_events` not reachable (sink 自身が落ちている)

- **first suspect**: `mirror_events` table 不在 / `mirror_events` の RLS が anon insert を拒否
- **verification**: §4.1 / §4.3 を `mirror_events` だけ走らせる / `mirror_events` 行が **完全に増えない** 場合は §3.2 step 6-7 を再 apply
- **action**: sink 復旧 / 並行して `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED=true` で sink を一時停止して mirror 自体は維持する選択肢もあり（mirror table への INSERT は継続、`mirror_events` だけ silent）

---

## 9. Go / No-Go Verdict

§2〜§8 を集約した **soak 開始判定**。

### 9.1 Verdict matrix

| Gate | 要件 | 出典 |
|---|---|---|
| 1. Pre-apply checklist | §2.8 全 PASS | §2 |
| 2. Schema apply success | §3 で実行 + errors なし or 既存表エラーのみ | §3 |
| 3. Post-apply SQL sweep | §4.10 全 PASS | §4 |
| 4. 4 mirror smoke | §5.5 で 4 feature 全 `success >= 1` + 3 null 系 0 | §5 |
| 5. activityData submit-only | §6.4 全 PASS | §6 |
| 6. Kill-switch round-trip | §7.6 全 PASS | §7 |
| 7. Failure handling rehearsed | §8 の decision tree を operator が読み終えている | §8 |

### 9.2 GO FOR SOAK

**全 7 gates PASS** のとき。

直後の action:
- [`phase1_soak_runbook.md §2`](./phase1_soak_runbook.md) Daily check を 24h 後に初回実行
- §5.5 / §6.1 の baseline 数値を「soak day 0 baseline」として記録（soak day 7 の比較対象）
- `NEXT_PUBLIC_APP_COMMIT` 未設定なら、soak 中の任意のタイミングで Vercel env 追加 + redeploy を計画（observability 解像度向上 / 必須ではない）

### 9.3 GO WITH CAVEATS

**Gate 1-4 + 6 PASS / Gate 5 (submit-only) または Gate 7 (failure handling) が部分**:

- §6.3 double submit upsert を確認できなかった → observation-only として soak 開始可（idempotency は code-side の `onConflict: "source_hash"` で保証）
- §8 decision tree の通読 / 共有が未済 → operator 1 名が単独運用するなら可、複数 operator なら共有後に GO

直後の action:
- 上記 caveat を [`phase1_soak_runbook.md §1`](./phase1_soak_runbook.md) Pre-soak verification に追記

### 9.4 NO-GO

以下のいずれかが満たされた場合:

- §4.5 SELECT policy が 1 つでも存在
- §4.6 DELETE policy が 1 つでも存在
- §4.2 で RLS が無効な table がある
- §5.5 で 4 feature のいずれかが `success = 0`（traffic 不在ではなく dispatch 失敗）
- §5.2 mirror table 側 `has_name = true`（PII strip 破壊）
- §6.1 typing-only で `mirror_events.activityData` 増分 > 0（autosave leak）
- §7.4 kill-switch ON でも `disabled` row が出現しない（kill-switch 機能していない）

直後の action:
- soak 開始を **中断**
- 該当 gate の原因を別 STEP で起票
- 修正 PR landed + redeploy 後に §2 から再走

---

## 10. Sign-off

apply + smoke が完了したら以下を operator が記録:

- [ ] §2 pre-apply checklist 全 PASS（日時 / branch / commit sha）
- [ ] §3 schema apply 完了（一括 or segment-by-segment / エラー有無）
- [ ] §4 post-apply SQL sweep 全 PASS（全 5 table verify 済）
- [ ] §5 4 mirror smoke 全 PASS（`success` row 観測 / 3 metadata column populated）
- [ ] §6 activityData submit-only verification 全 PASS
- [ ] §7 kill-switch round-trip 全 PASS
- [ ] §8 failure handling decision tree 通読済
- [ ] §9 verdict: **GO FOR SOAK** / GO WITH CAVEATS / NO-GO のいずれか

判定が **GO FOR SOAK** なら [`phase1_soak_runbook.md §2 Daily checks`](./phase1_soak_runbook.md) を 24h 後に初回実行 → 7 日後に §3 Weekly checks → §13 Soak completion で graduation 判定へ。

---

## 締めくくり

本 runbook は **judgement を含まず mechanical に運用** できることが価値。原因の意味解釈 / 進行判断は [`phase1_completion_declaration.md`](./phase1_completion_declaration.md) / [`phase1_boundary_freeze.md`](./phase1_boundary_freeze.md) / [`soak_launch_audit.md`](./soak_launch_audit.md) を参照する。
schema apply は Phase1 で最も外側に残った operator action — 本 runbook を 1 度回せば soak の初期 24h を blind に始めない保証になる。
