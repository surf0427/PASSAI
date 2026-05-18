# Phase1 Completion Checklist

Phase1 完了宣言を **mechanical に再現可能** な形で検証するためのチェックリスト。
本ドキュメントは [`phase1_completion_readiness.md`](./phase1_completion_readiness.md) の判定根拠に対応する **operator-facing verification list** であり、future-you / operator / 別 contributor が「本当に completion 宣言して良いか」を独立に確認するために使う。

各項目は **grep / query / 観察** のいずれかで verify 可能な形に固定する。判断要素を含む項目は含めない。

関連: [phase1_completion_readiness.md](./phase1_completion_readiness.md), [phase1_boundary_freeze.md](./phase1_boundary_freeze.md), [phase1_boundary_pressure_audit.md](./phase1_boundary_pressure_audit.md), [phase1_runtime_strategy.md](./phase1_runtime_strategy.md)

---

## How to use

1. 各 section の全 checkbox を上から順に verify する
2. 1 項目でも FAIL なら Phase1 完了宣言を保留 / 該当 STEP を起票
3. 全 PASS で **architecture / runtime / docs** 完了 → operational soak と並行して Phase1 完了宣言可
4. operator-side checkbox（§4 / §5）は Phase1 完了宣言の **並行進行 step**。宣言時点で in-progress でも可（completion との関係は [`phase1_completion_readiness.md §9.5`](./phase1_completion_readiness.md) を参照）

---

## 1. Runtime invariant (grep-verifiable)

```bash
# All grep commands run from repo root.
```

- [ ] **`.select(` runtime hit = 0**
  ```bash
  grep -rn "\.select(" lib/supabase/ app/ hooks/ lib/ \
    | grep -v "node_modules\|.next" \
    | grep -v "select-none\|select-auto\|select-all\|select-text\|select-contain"
  ```
  期待: README 内の literal text 以外 hit 無し。runtime コード hit があれば FAIL。
- [ ] **`mirror_events` runtime SELECT hit = 0**
  ```bash
  grep -rn "mirror_events" lib/supabase/ app/ hooks/ lib/ | grep -v "node_modules\|.next"
  ```
  期待: hit は doc comment / `SINK_TABLE = "mirror_events"` の INSERT 経路の constant 定義のみ。`.from('mirror_events').select(` 等の SELECT 経路はゼロ。
- [ ] **`mirrorActivityData` dispatch site = 1**
  ```bash
  grep -rn "mirrorActivityData" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next"
  ```
  期待: dispatch site は `hooks/useActivityForm.ts:handleSubmit` 1 箇所のみ + mirror 自身の export / JSDoc 自己参照。
- [ ] **`mirrorBasicInfo` dispatch site = 1**
  ```bash
  grep -rn "mirrorBasicInfo" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next"
  ```
  期待: dispatch site は `lib/basicInfoStorage.ts:saveBasicInfo` 1 箇所のみ。
- [ ] **`mirrorDiagnosis` dispatch site = 1**
  ```bash
  grep -rn "mirrorDiagnosis" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next"
  ```
  期待: dispatch site は `lib/diagnosisStorage.ts:saveDiagnosisResult` 1 箇所のみ。
- [ ] **`mirrorStudentProfile` dispatch site = 1**
  ```bash
  grep -rn "mirrorStudentProfile" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next"
  ```
  期待: dispatch site は `lib/studentProfileStorage.ts:saveStudentProfile` 1 箇所のみ。
- [ ] **mirror × `onChange` 紐付けゼロ**
  ```bash
  grep -rn "mirrorActivityData\|mirrorBasicInfo\|mirrorDiagnosis\|mirrorStudentProfile" hooks/ \
    | grep -i "onChange"
  ```
  期待: hit ゼロ。activityData の submit-driven contract 維持の verification。
- [ ] **`NEXT_PUBLIC_SUPABASE_*` env reader spread = boundary only**
  ```bash
  grep -rn "NEXT_PUBLIC_SUPABASE" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next\|docs"
  ```
  期待: hit は `lib/supabase/env.ts` / `lib/supabase/mirrorConfig.ts` / `lib/supabase/mirrorEventSink.ts` の 3 file のみ。
- [ ] **`@supabase/*` 直 import は `lib/supabase/` 配下のみ**
  ```bash
  grep -rn "from ['\"]@supabase" --include="*.ts" --include="*.tsx" . | grep -v "node_modules\|.next"
  ```
  期待: hit は `lib/supabase/` 配下のみ。

---

## 2. Mirror file structure invariants

- [ ] **4 feature mirror file が存在する**: `lib/supabase/mirrorStudentProfile.ts` / `mirrorBasicInfo.ts` / `mirrorDiagnosis.ts` / `mirrorActivityData.ts` がすべて存在
- [ ] **各 mirror が `finalize()` を唯一の return 経路として呼ぶ**: 各 `mirrorXxx.ts` の全 return 文が `return finalize(MIRROR_FEATURE, ...)` 形式
- [ ] **各 mirror が `MIRROR_TABLE` constant を file-local に持つ**: `MIRROR_TABLE = "student_profile_mirrors" / "basic_info_mirrors" / "diagnosis_mirrors" / "activity_mirrors"` がそれぞれ 1 mirror file に固定
- [ ] **`upsertMirror` 等の generic helper が `lib/supabase/` 配下に存在しない**:
  ```bash
  ls lib/supabase/ | grep -E "upsert|mirrorHelper|mirrorFactory"
  ```
  期待: hit ゼロ。
- [ ] **`lib/supabase/mirrors/` のような aggregator ディレクトリが存在しない**:
  ```bash
  ls lib/supabase/mirrors/ 2>&1 | grep -v "No such"
  ```
  期待: ディレクトリ不在。

---

## 3. Schema / DDL state

- [ ] **`supabase/schema.sql` に 4 mirror table + 1 observability table の DDL がコミット済**: `student_profile_mirrors` / `basic_info_mirrors` / `diagnosis_mirrors` / `activity_mirrors` / `mirror_events` が定義されている
  ```bash
  grep -E "CREATE TABLE (student_profile_mirrors|basic_info_mirrors|diagnosis_mirrors|activity_mirrors|mirror_events)" supabase/schema.sql
  ```
- [ ] **schema_version contract が各 mirror header に明文化されている**: `mirrorBasicInfo.ts` / `mirrorDiagnosis.ts` / `mirrorActivityData.ts` の header コメントに SCHEMA_VERSION bump trigger が記載

---

## 4. Operator-side state（並行進行可 — completion blocking ではない）

- [ ] Supabase project に `student_profile_mirrors` table apply 済（post-apply checklist §2.1 で確認）
- [ ] Supabase project に `basic_info_mirrors` table apply 済（[`basic_info_post_apply_checklist.md §2.1`](./basic_info_post_apply_checklist.md)）
- [ ] Supabase project に `diagnosis_mirrors` table apply 済（[`diagnosis_post_apply_checklist.md §2.1`](./diagnosis_post_apply_checklist.md)）
- [ ] Supabase project に `activity_mirrors` table apply 済（[`activity_post_apply_checklist.md §2.1`](./activity_post_apply_checklist.md)）
- [ ] Supabase project に `mirror_events` table apply 済（[`observability_sink.md §11`](./observability_sink.md)）
- [ ] 各 feature の `mirror_events` で `feature='{feature}' / mirror_status='success'` row が apply 後 24h 以内に > 0 件出現
- [ ] activityData typing-only verification: form を開いて typing するだけで `mirror_events.feature='activityData'` row が増えないこと（submit-driven trigger の implementation verification、[`activity_post_apply_checklist.md §3.3`](./activity_post_apply_checklist.md)）
- [ ] PII spot-check `basic_info_mirrors`: `payload ? 'name'` が全 row false（[`basic_info_post_apply_checklist.md §2.3`](./basic_info_post_apply_checklist.md)）
- [ ] PII spot-check `activity_mirrors`: top-level keys が 9 配列 + narrative content sanity（[`activity_post_apply_checklist.md §2.3`](./activity_post_apply_checklist.md)）

---

## 5. Soak observation（並行進行可 — completion blocking ではない）

- [ ] 7-day soak: 各 feature の daily `success_rate >= 0.95`（post-apply checklist §6）
- [ ] 7-day soak: `unknown` failure_reason 比率 < 1%
- [ ] 7-day soak: `disabled` row が production で 0（kill-switch 不使用）
- [ ] Stale tab observation: `mirror_events.schema_version` の旧 version 比率が想定範囲

---

## 6. Documentation coherence

- [ ] [`phase1_boundary_freeze.md`](./phase1_boundary_freeze.md) に Operator Environment Contract §10 が存在
- [ ] [`phase1_boundary_pressure_audit.md`](./phase1_boundary_pressure_audit.md) に Environment Propagation Risk §11 が存在
- [ ] [`lib/supabase/README.md`](../../lib/supabase/README.md) に "Environment switches require redeploy" 節が存在
- [ ] 全 schema preview / post-apply checklist が `phase1_boundary_freeze.md §10` を cross-reference
- [ ] "再 deploy 不要" 誤記が runtime / operator docs に残存していない
  ```bash
  grep -rn "再 deploy 不要\|再deploy不要" docs/supabase/ lib/supabase/ | grep -v "phase1_boundary_pressure_audit\|phase1_boundary_freeze"
  ```
  期待: hit ゼロ（残存ヒットは audit / freeze 内の historical reference のみ）。
- [ ] [`docs/principles/architecture_rules.md`](../principles/architecture_rules.md) に "Supabase mirror boundary（Phase1 freeze）" section が存在
- [ ] [`feature_rollout_matrix.md`](./feature_rollout_matrix.md) が N=4 状態を反映

---

## 7. Freeze governance state

- [ ] [`phase1_boundary_freeze.md §5 Mirror Addition Gate`](./phase1_boundary_freeze.md) の 9 必須条件 + 7 禁止動機が現存
- [ ] [`phase1_boundary_freeze.md §6 Abstraction Threshold Rule`](./phase1_boundary_freeze.md) の AND 条件 6 件が現存
- [ ] N=4 freeze declaration が `phase1_boundary_freeze.md §9` に存在
- [ ] 新規 mirror PR が pending していない
  ```bash
  ls lib/supabase/mirror*.ts | wc -l
  ```
  期待: 4 + 4 sidecar (`mirrorConfig.ts` / `mirrorEventSink.ts` / `mirrorFinalize.ts` / `mirrorGuard.ts` / `mirrorLogger.ts` / `mirrorMetrics.ts` / `mirrorResult.ts` / `mirrorSourceHash.ts` / `mirrorTypes.ts` = 9 sidecar) を超えない
- [ ] 新規 abstraction PR が pending していない（pressure audit §6.2 の N>=5 / 3 箇所完全一致 / 確定 future mirror / observed bug / diff 20% / observability 維持不能 のいずれかが trigger された場合のみ解禁）

---

## 8. Runtime drift absence

- [ ] `npx tsc --noEmit` exit 0 / 型エラー 0
- [ ] `npx eslint lib/supabase/` exit 0 / lint エラー 0
- [ ] `git status` 上の runtime ファイル差分が「現 STEP の関与する範囲のみ」 — Phase1 完了 audit 自体は doc-only であり、`lib/supabase/*.ts` / `hooks/` / `lib/*Storage.ts` を変更していないこと

---

## 9. Phase boundary clarity

- [ ] [`phase1_completion_readiness.md §8.2`](./phase1_completion_readiness.md) の「今どこにいるか」が現在状態と整合
- [ ] Phase2 着手 PR がまだ landed していない（Phase1 完了宣言が Phase2 進行の前提）
- [ ] [`migration_phases.md`](./migration_phases.md) の Phase 定義が runtime と矛盾していない

---

## Completion Decision

- 全 §1 / §2 / §3 / §6 / §7 / §8 / §9 が PASS → **architecture / runtime / docs completion 達成**
- §4 / §5 はすべて PASS → operational completion 達成（並行進行可）
- 1 項目でも FAIL → 該当事項を別 STEP として起票し completion 宣言を保留

---

## 締めくくり

本 checklist は **「Phase1 完了宣言を再現可能にする」** ためにある。判断要素を含めず grep / query / 観察ベースで verify 可能な形に固定することで、future-you / operator / 別 contributor が独立に completion を verify できる。
判断要素（「acceptable か / Phase1 で許容するか」）は本 checklist ではなく [`phase1_completion_readiness.md`](./phase1_completion_readiness.md) / [`phase1_boundary_freeze.md`](./phase1_boundary_freeze.md) / [`phase1_boundary_pressure_audit.md`](./phase1_boundary_pressure_audit.md) で扱う。両者の役割分担を維持することで、completion 判定の **再現可能性と意味論** が両立する。
