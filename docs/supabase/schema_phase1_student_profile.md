# Phase1 Schema — StudentProfile Mirror

PASSAI における **最初の Supabase mirror table** の最小設計。Phase1 の「localStorage canonical + Supabase best-effort mirror」契約に閉じる範囲で、`lib/supabase/mirrorStudentProfile.ts` が upsert 先として参照する 1 table のみを定義する。

関連:
- mirror helper: [`lib/supabase/mirrorStudentProfile.ts`](../../lib/supabase/mirrorStudentProfile.ts) (unused at runtime)
- contract: [`client_boundary.md`](./client_boundary.md)
- runtime rules: [`phase1_runtime_strategy.md`](./phase1_runtime_strategy.md)
- observability: [`mirror_observability.md`](./mirror_observability.md)
- ownership: [`schema_boundary_policy.md`](./schema_boundary_policy.md)
- canonical: [`student_profile_contract.md`](../principles/student_profile_contract.md)
- 適用対象 SQL: [`supabase/schema.sql`](../../supabase/schema.sql)

---

## 1. Scope

- 対象: `student_profile_mirrors` テーブル **1 つだけ**
- 用途: `mirrorStudentProfile.ts` の `upsert(..., { onConflict: "source_hash" })` 先
- **範囲外**: runtime wiring / SELECT 経路 / 認証連携 / マルチテナント RLS / FK / Realtime / Subscriptions / Edge Functions / 他 feature の mirror table

本ドキュメントは「Phase1 で動かす最小構成」のみを記述する。Phase2 以降の structured-column 化・auth 連携・RLS 厳格化は §9 に future-migration として書き残す。

---

## 2. Current Migration Position

- branch: `feature/supabase-migration`
- Phase: **Phase1 着手準備中 / 本 SQL は未適用 / runtime 未配線**
- 既存 boundary（`lib/supabase/`）の helper 群は **すべて unused** 状態のまま
- 本ドキュメント merge 時点では Supabase project にもこの table は **存在しない**

---

## 3. Schema

```sql
CREATE TABLE student_profile_mirrors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     text        NOT NULL UNIQUE,
  schema_version  text        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

列ごとの意図:

| 列 | 型 | 役割 |
|---|---|---|
| `id` | `uuid` PK | 合成 PK。helper は使わないが運用上の row identity を確保 |
| `source_hash` | `text` UNIQUE NOT NULL | canonical snapshot の deterministic identity。upsert の conflict target |
| `schema_version` | `text` NOT NULL | canonical contract version。outdated row を後段で識別可能にする |
| `payload` | `jsonb` NOT NULL | opaque snapshot。Phase1 では **クエリ要件なし**（§5 参照） |
| `created_at` | `timestamptz` DEFAULT now() | 初回 mirror 時刻 |
| `updated_at` | `timestamptz` DEFAULT now() | 直近 upsert 時刻。trigger 管理（§4） |

制約は **UNIQUE(source_hash) 1 本のみ**。FK / CHECK / partial index はこの段階では追加しない。

---

## 4. Trigger — updated_at maintenance

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER student_profile_mirrors_set_updated_at
  BEFORE UPDATE ON student_profile_mirrors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

helper 側（`mirrorStudentProfile.ts`）は `updated_at` を payload に含めない。trigger に委譲することで helper の input 型を **最小 3 field** に保つ。`set_updated_at()` は本テーブル専用ではなく、将来の mirror table でも流用できる共通関数として定義する。

---

## 5. RLS Posture — write-only for anon

```sql
ALTER TABLE student_profile_mirrors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_profile_mirrors anon insert"
  ON student_profile_mirrors
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "student_profile_mirrors anon update"
  ON student_profile_mirrors
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
```

設計意図:

- **RLS は ON**。Supabase の default に合わせ、policy なしに anon が触れない状態を baseline にする
- **INSERT / UPDATE のみ permissive**。upsert が INSERT … ON CONFLICT DO UPDATE 形式で動くため両方必要
- **SELECT / DELETE policy は意図的に存在しない**。Phase1 contract（`phase1_runtime_strategy.md §8`）の「Supabase reads 一切禁止」を **DB 層で architectural に強制** する
  - 仮に helper や他コードが accidental に `.select()` を呼んでも DB が空配列 + error を返すだけで、canonical 経路は無傷
- 認証導入後（Phase2）に user-scoped policy（`USING (auth.uid() = user_id)`）へ書き換える

最低限の 2 policy 以外を Phase1 で追加しない（[task constraint §3]）。

---

## 6. Why localStorage remains canonical

- runtime read path は `lib/*Storage.ts` 経由の localStorage 一択（`phase1_runtime_strategy.md §4 / §8`）
- mirror は副次効果。canonical UX は Supabase の存在 / 不在に依存しない
- mirror 成否は restore / cache / hydration semantics に影響しない
- 本 schema にも **canonical 役割を主張する列 / 制約は無い**。`payload` は単に最後の mirror snapshot を写し取った blob にすぎない

---

## 7. Why this is best-effort mirror only

- `mirrorStudentProfile.ts` は **best-effort** 設計（throw しない / UI 露出しない / retry しない）。schema 側もそれに合致した最弱契約とする
  - UNIQUE(source_hash) の競合は upsert で吸収される
  - validation は DB 側で payload 内部に踏み込まない（`jsonb NOT NULL` の有無のみ）
  - failure 分類（`network_error` / `schema_mismatch`）は helper 側で行い、DB は単に Postgres エラーを返すだけで良い
- table が無い / RLS が間違っている / カラム不足 — いずれの異常も helper 側で `mirrorFailed(...)` に正しく落ちる

---

## 8. Why no reads exist (and why it's enforced at DB level)

Phase1 read path は localStorage 一択。Supabase からの SELECT は **禁止**（`phase1_runtime_strategy.md §8`）。

DB 側の補強:

- SELECT policy が存在しないため、anon role からの `SELECT * FROM student_profile_mirrors` は **空配列 / 拒否** で返る
- これにより、helper 側の規律（read API を呼ばない）に加えて、**DB が architectural な防壁** として機能する
- Phase2 で fallback read を導入する際は、**まず本ドキュメントを後継版に書き換え** → SELECT policy を追加する PR を独立に出す（doc-first）

---

## 9. Why schema is intentionally denormalized (single jsonb payload)

`schema_boundary_policy.md §12` の **StudentProfile-specific guidance**:

> StudentProfile | `version` / `generatedAt` / `sourceHash` を schema 列として明示。strengths/weaknesses/futureConnections/valueKeywords/signatureEpisodes は array / structured 列で表現（JSON dump で済ませない）

本 Phase1 設計は **意図的にこの guidance を採用しない**。理由:

- Phase1 の使用形態は **opaque blob として保存し、Phase 期間中は一切 query しない**。`schema_boundary_policy.md §10` の 3 つ目（"明示的に opaque blob として持つ" 設計判断がある場合）に該当する
- structured 列化を先取りすると、StudentProfile contract の進化（field 追加・rename）が schema migration と直結し、helper / payload 構築 / migration の 3 箇所を同時に動かす爆発を Phase1 で抱える
- Phase1 は observability で「mirror が動いているか」だけを観測する段階であり、列単位の query 要件はまだ存在しない（`mirror_observability.md §14 stage1/2`）
- `schema_version` 列を分離して持つことで、Phase2 で structured 列に展開する際の **un-dump 移行** が version 別に分離可能

この設計はあくまで Phase1 期間限定の trade-off であり、§10 (Future Migration Possibilities) で structured 化への明示パスを定義する。

---

## 10. Future migration possibilities (out of scope for this STEP)

Phase2 以降で個別 STEP として扱う。ここでは migration 候補のみ列挙する。

1. **auth 連携 / user_id 列追加**
   - `ALTER TABLE student_profile_mirrors ADD COLUMN user_id uuid REFERENCES auth.users(id);`
   - 認証は単独 STEP として独立（`migration_phases.md §12`）
   - 既存 anon 行の扱い（破棄 / claim / orphan retention）は移行 STEP で決定
2. **RLS の user-scoped 化**
   - INSERT / UPDATE policy を `WITH CHECK (auth.uid() = user_id)` に書き換え
   - SELECT policy を `USING (auth.uid() = user_id)` で新規追加（Phase2 fallback read 用）
3. **payload structured 化**
   - StudentProfile contract に従い、strengths / weaknesses / futureConnections / valueKeywords / signatureEpisodes を array 列または関連 table に展開
   - 移行は schema_version 別に段階的に
4. **composite UNIQUE(user_id, source_hash)**
   - 現状は `source_hash` 単独 UNIQUE。auth 導入後は user 間で source_hash 衝突しうるため composite key に変更
   - index 入れ替えが必要、必ず別 STEP
5. **retention / cleanup**
   - 現状 source_hash 変動による orphan row が無限に増える。Phase2 で retention policy（age cutoff / latest-per-user の維持）を導入
6. **observability column の正規化**
   - 現在は `created_at` / `updated_at` のみ。Phase2 で `last_mirror_attempt_at` / `mirror_error_count` を追加するかを観測値ベースで判断
7. **他 feature mirror table の生成**
   - `basic_info_mirrors`, `activity_mirrors` 等を本 schema 設計をテンプレに同じ shape で展開（`feature_rollout_matrix.md §11` 順序）

---

## 11. Open questions

doc merge 時点で未決の項目。**この STEP では決めない**（runtime / Phase2 STEP に持ち越し）。

1. **anon の Phase1 mirror をそもそも書き込ませるか**
   - 認証なしで Supabase に snapshot が蓄積する状態を許容するかは observability sink 設計 PR で再評価する
   - 「Phase1 では production の mirror を完全に kill-switch OFF にしておく」運用も技術的には可能
2. **source_hash 衝突時の semantics**
   - 同じ source_hash に対する upsert で payload 差分が出る状況（cache 経路の `sourceHash` 再利用など）が起きた場合の DB 側挙動を観測する必要あり
   - 観測結果次第で composite key 化を Phase1 中に前倒しする判断もありうる
3. **payload 最大サイズ**
   - jsonb 自体は 1GB まで保持可能だが、PostgREST 経由の payload 上限・Supabase 側 quota を考慮し、helper 側で hard limit を設けるかを decide
   - 現状 helper には size guard なし（`mirrorStudentProfile.ts` は `unknown` で受け取る）
4. **`schema_version` の値域**
   - StudentProfile contract に `version` 列が存在する（`student_profile_contract.md §4`）。helper input の `schemaVersion` が contract の `version` と直結するかは整合確認が未済
5. **kill-switch の Phase1 default**
   - production で default ON にして mirror を抑止するか、最初から limited rollout に乗せるかは `phase1_execution_checklist.md §7` / `mirror_observability.md §13` を満たした後で判断
6. **`set_updated_at()` の他 mirror table 流用**
   - 関数を共有して trigger だけ table ごとに作るか、table ごとに別関数を持つか。共有が将来の interface 変更を脆弱化する可能性

---

## 12. Apply order (informational)

本 SQL の適用は **runtime 配線 PR と切り離す**。

1. 本 doc が main に merge される
2. `supabase/schema.sql` を Supabase SQL editor / CLI で apply
3. Supabase dashboard で:
   - table が ENABLE ROW LEVEL SECURITY 状態であること
   - policy が 2 件（insert / update のみ）であること
   - trigger が attach されていること
   を目視確認
4. apply 後も runtime は引き続き未配線。helper も unused のまま
5. wiring は別 STEP（`phase1_execution_checklist.md §15 stage1` 以降）

途中で問題が発覚した場合の rollback:

- `DROP TABLE student_profile_mirrors;` のみで完結（FK 未使用 / 他 table 依存なし）
- 本 doc の §10 (Future Migration Possibilities) に「rollback で破壊した row は復元しない」と一致

---

## 13. Anti-patterns specific to this schema

レビュー時の reject 根拠とする。

- **本 STEP に runtime 配線を混ぜる**（mirror helper を import / route を作る / page から呼ぶ）
- **payload を読む側のコードを Phase1 で書く**（`SELECT payload FROM student_profile_mirrors ...`）
- **`payload` を SELECT 経由で取り出して localStorage に書き戻す**（Phase2 の責務、`phase1_runtime_strategy.md §8`）
- **RLS policy に `SELECT` を追加**（Phase1 では DB レベルで read を遮断する設計が本来意図）
- **policy を `public` role に対して書く**（anon scope を明示する）
- **DELETE policy を追加**（Phase1 mirror は destructive 操作を行わない）
- **`payload` 内部の field に index を張る**（query 要件が無い段階の早すぎる最適化、`schema_boundary_policy.md §10`）
- **他 feature mirror を同 PR で追加する**（feature 単位 PR の原則を破壊、`phase1_execution_checklist.md §14`）
- **schema_version 列を捨てる / NULL 許容にする**（前方互換性を破壊）

---

## 14. Confirmation

本ドキュメント + `supabase/schema.sql` の merge では:

- runtime コード（`app/`, `components/`, `lib/*Storage.ts`, AI routes 等）は一切変更されない
- `lib/supabase/mirrorStudentProfile.ts` は unused のまま
- 既存 boundary helper 群は touch されない
- localStorage / restore / cache / hydration / AI 出力 / プロンプト いずれも behavior 変化なし

SQL 適用前の状態でも、適用後の状態でも、PASSAI の現行 UX は同一である。
