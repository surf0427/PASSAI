# statement_review_history — Schema Preview（STEP-SUPABASE-COMPLETE-06A）

`supabase/schema.sql` §38–§40 として追記した `statement_review_history` テーブルの設計メモ。本 STEP は **schema 定義の追記と docs 追加のみ**。DB への apply・migration 作成・アプリ実コード（`app` / `lib` / `types`）の変更は含まない。

関連:
- [`schema_apply_preflight.md`](./schema_apply_preflight.md) — apply 前提条件
- 先行例: `supabase/schema.sql` §35–§37（`self_prs`）、§32–§34（`self_analysis_logs`）、§19–§23（`tutor_chat_*`）
- 先行 design: [`self_prs_mirror_schema_preview.md`](./self_prs_mirror_schema_preview.md)（id natural key / restore 分離の雛形）、[`self_prs_delete_safety_design.md`](./self_prs_delete_safety_design.md)（delete resurrection / tombstone）
- canonical 型: `lib/statement/review/statementStorage.ts` の `ReviewHistoryItem`（key=`'statementReviewHistory'`）、`result` の型は `types/statement.ts` の `StatementResult`

---

## 1. 目的 / 位置づけ — auth-scoped mirror 系統（mirror_events 系統ではない）

本テーブルは **`self_prs` / `self_analysis_logs` / `tutor_chat_*` と同じ auth-scoped mirror 系統**に属する。`localStorage` の `statementReviewHistory`（key=`'statementReviewHistory'`, `lib/statement/review/statementStorage.ts`, 最大 10 件）を **canonical** とし、本テーブルはその durable mirror（同期先）として best-effort で後追い同期する。

N=4 mirror（`mirror_events` / 共有 `source_hash`, `supabase/schema.sql` §5）系統とは**別レイヤー**である。

| | mirror_events 系統 | auth-scoped 系統（**statement_review_history** / self_prs / self_analysis_logs / tutor_chat_*） |
|---|---|---|
| 所有 | 匿名 anon、user 紐付けなし | `user_id = auth.users(id)` |
| RLS | anon INSERT/UPDATE のみ、SELECT 不可 | owner の SELECT/INSERT/UPDATE/**DELETE** |
| 観測 | `mirror_events` sink に記録 | sink には記録しない（repository devWarn のみ） |
| dedup key | `source_hash`（payload ハッシュ） | natural key `(user_id, local_review_id)` |

→ **本テーブルに `mirror_events` 由来の検証（success_rate / failure_reason 分布）は適用しない。** 検証は RLS owner-isolation・upsert 冪等性に絞る。

ReviewHistoryItem は **添削履歴**であり、志望理由書本文（essay）と AI 添削結果（StatementResult）を保持する。多端末でも履歴を durable に残すための同期先を確立するのが本 STEP の目的。

---

## 2. DDL 全文

```sql
-- 38. statement_review_history
CREATE TABLE statement_review_history (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_review_id  text         NOT NULL,
  university       text         NOT NULL DEFAULT '',
  faculty          text         NOT NULL DEFAULT '',
  department       text         NOT NULL DEFAULT '',
  essay            text         NOT NULL DEFAULT '',
  result           jsonb        NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT statement_review_history_local_unique UNIQUE (user_id, local_review_id)
);

-- 39. trigger: set_updated_at()（§3 で定義済みの共有関数を再利用）
CREATE TRIGGER statement_review_history_set_updated_at
  BEFORE UPDATE ON statement_review_history
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 40. RLS
ALTER TABLE statement_review_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "statement_review_history owner select"
  ON statement_review_history FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "statement_review_history owner insert"
  ON statement_review_history FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "statement_review_history owner update"
  ON statement_review_history FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "statement_review_history owner delete"
  ON statement_review_history FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
```

（COMMENT ON TABLE / COLUMN / CONSTRAINT は `supabase/schema.sql` §38 に同梱。）

---

## 3. 列設計と localStorage 型の対応

canonical 型: `lib/statement/review/statementStorage.ts` の `ReviewHistoryItem`。

```ts
export type ReviewHistoryItem = {
  id: string;          // crypto.randomUUID()
  createdAt: string;   // ISO
  university: string;
  faculty: string;
  department: string;  // 学科
  essay: string;
  result: StatementResult;
};
```

| DB column | localStorage field | 型 / 既定 | 備考 |
|---|---|---|---|
| `id` | （DB 採番） | uuid PK | LS の `id` とは別。LS id は `local_review_id` へ |
| `user_id` | （LS には無い） | uuid NOT NULL FK | owner key。`auth.users(id)` |
| `local_review_id` | `id` | text NOT NULL | `ReviewHistoryItem.id`（UUID 文字列）。natural key の一部 |
| `university` | `university` | text DEFAULT `''` | |
| `faculty` | `faculty` | text DEFAULT `''` | |
| `department` | `department` | text DEFAULT `''` | 学科（STEP4 追加） |
| `essay` | `essay` | text DEFAULT `''` | 添削対象の志望理由書本文 |
| `result` | `result` | jsonb NOT NULL | `StatementResult` 全体（後述 §6） |
| `created_at` | `createdAt` | timestamptz DEFAULT now() | backfill 時に原値保持 |
| `updated_at` | （LS には無い） | timestamptz DEFAULT now() | trigger で前進。upsert payload には含めない |

> `ReviewHistoryItem` に `updatedAt` は存在しない。item は作成後不変なので、`updated_at` は DB の default / trigger に任せ、書込側は送らない（`self_analysis_logs` と同方針）。

---

## 4. natural key に `(user_id, local_review_id)` を使う理由

natural key は **`(user_id, local_review_id)`**、すなわち `ReviewHistoryItem.id` を identity とする。

- `ReviewHistoryItem.id` は `crypto.randomUUID()` 由来で、各添削履歴の安定 identity。
- **item は作成後 不変**（本文編集・in-place update が存在しない。read / delete のみ）。したがって同一 `id` への upsert は常に同一内容を書くだけで、natural key 1 本で冪等になる。
- `self_prs` と同形（id natural key）。ただし self_prs は本文編集があるため「同じカードの更新」を id 経由で同一行 update に写す必要があったのに対し、本テーブルは不変なので update 自体がアプリ起点では起きない（§7 の UPDATE policy も冪等再 upsert のための保険）。

---

## 5. inputHash / contentHash を使わない理由

`self_analysis_logs` は `summary_input_hash`（生成入力のハッシュ）を natural key にしたが、本テーブルでは採らない。

- **inputHash は履歴型に含まれない。** 入力ハッシュ（`statementReviewInputHash` / `StatementReviewCacheRecord`, `lib/statement/review/statementReviewCache.ts`）は **別 localStorage key の cache 専用**であり、`ReviewHistoryItem` の構造には載っていない。backfill で取得できないため key にできない。
- **誤 dedup になる。** 同一 essay + 大学での再添削も、ユーザーにとっては**別個の正当な履歴**であり両方残したい。入力ハッシュで dedup すると後の再添削が前を潰す。`self_analysis_logs`（同一入力は 1 件に集約したい）とはユースケースが逆。
- **contentHash も不安定。** `result` は AI 出力で非決定的。安定したハッシュ可能な identity にならない。

→ identity は安定 UUID（`local_review_id`）一本に寄せ、hash は dedup に関与させない。

---

## 6. `result` を jsonb 丸ごと保存する理由

`result`（`StatementResult`）は次の構造を持つ:

```ts
type StatementResult = {
  overallScore: number;
  evaluations: { label: string; score: number /* 0〜20 */ }[];
  strengths: string[]; weaknesses: string[]; actions: string[];
  partialRevision: string; checklist: string[];
};
```

- mirror の責務は **canonical artifact を忠実に durable 化すること**。構造化列に展開しても Phase1 にクエリ要件は無く、列展開は YAGNI（`student_profile_mirrors.payload` と同方針）。
- 表示時の score 正規化（AI の `overallScore` を信頼せず breakdown 合計から再計算する等）は **read 側の `normalizeStatementScore` が既に担保**しており、mirror は raw を保存すればよい。mirror 側で値域チェックを入れると、prompt 改修で値分布が変わった瞬間に過去履歴を弾く事故になる（`ai_score_contract.md` の cache guard 原則と同じ）。

→ `result jsonb` 1 列に丸ごと保存し、解釈は read 側に委ねる。

---

## 7. metadata / deleted_at を今回入れない理由

- **`metadata` 列を入れない。** self_prs / self_analysis_logs は将来拡張用に `metadata jsonb` を持つが、本 STEP の prompt 方針に従い**追加しない**。現時点で格納したい補助情報（例: promptVersion）は `ReviewHistoryItem` に載っておらず backfill で埋まらない。必要化したら additive な `ALTER TABLE ... ADD COLUMN metadata` で後付けする（破壊的でない）。
- **`deleted_at` 列を入れない。** restore / down-sync を本 STEP では実装しないため（§8）、tombstone 列も不要。restore を有効化する 06E で soft-delete 方式を採るなら、その STEP で additive に追加する（self_prs の `deleted_at` 前方互換議論＝`self_prs_delete_safety_design.md` §9 と同じ判断）。

### UPDATE policy を作った理由（self_prs 同形）

item は不変でアプリは content を更新しないが、**UPDATE policy は作成した**。理由:

- Supabase の `.upsert(..., { onConflict })`（06B で `upsertSelfPRToSupabase` と同パターンを使う想定）は `INSERT ... ON CONFLICT DO UPDATE` を発行する。
- UPDATE policy が無いと、冪等な再 upsert（backfill 再実行・重複 dispatch）が DO UPDATE 経路で RLS に弾かれ、mirror helper の `devWarn` に黙って失敗が出続ける。
- これを避けるため self_prs §37 と同形の owner update policy を置く。**アプリが content を能動更新することはない**（UPDATE 経路は同一内容の再書込のみ）。

---

## 8. restore を今回入れない理由（delete resurrection）

localStorage 側には削除がある:

- **id 指定の削除** `deleteReviewHistoryItem(id)`（score / improve ページ）。
- **10 件 cap による自動 eviction**（`saveReviewHistory` の `slice(0, 10)`、§9）。

このため素朴な down-sync / restore（SB→LS 書き戻し）は **delete resurrection**（削除済み履歴が別端末で復活）を起こす。これは `self_prs_delete_safety_design.md` §2 と完全に同型:

- mirror に「LS にあって DB に無い」と「DB にあって LS に無い」が両方起こり得る。後者は「別端末で追加」と「削除済み／eviction 済み」を区別できない。
- 区別には **tombstone（`deleted_at` soft-delete 等）**が必要だが、本 STEP の範囲外。

→ 本 STEP（06A）および release 前（06B〜06D）は **上り mirror（backfill + dualWrite, `propagateDelete=false`）のみ**。restore は tombstone 設計を伴う **06E** に分離し、多端末で履歴を揃えたい要望が出た段階で着手する。現フェーズは匿名認証・多端末未運用のため、上り only で実害は無い。

---

## 9. 10 件 cap eviction を DB delete として扱わない理由

`saveReviewHistory` は `[item, ...existing].slice(0, MAX_HISTORY=10)` で、**11 件目を追加すると最古が LS 配列から自動的に押し出される**（eviction）。

- dualWrite を「prev vs next 差分」で実装すると、eviction された item は「prev に有り / next に無し」となり、**id 指定 delete と同じ形**に見える。
- これを DB delete として伝播してはいけない。eviction はユーザーの削除意思ではなく、LS 容量制約に過ぎない。
- むしろ **DB は 10 件を超える履歴を durable に保持できる**のが mirror の利点。LS から押し出された古い履歴も DB には残る。

→ 上り mirror は **upsert-only**（`propagateDelete=false`）とする。これにより eviction も id 削除も DB に伝播せず、§8 の resurrection 回避と同時に「DB が LS の 10 件 cap を超えて保持する」挙動を自然に実現する。06D の dualWrite は delta delete を発行しない（新規・既存の upsert のみ）。

---

## 10. 次工程メモ（06B〜06E）

| STEP | 内容 | 主な対象 |
|---|---|---|
| **06-DB-APPLY** | `statement_review_history`（§38–§40）を Supabase SQL Editor で apply。`statement_review_history_post_apply_checklist.md`（RLS owner-isolation / upsert 冪等性）で検証。**DB 適用は operator** | DB / docs |
| **06B** | DB 境界 `lib/supabase/statementReviewHistory.ts`: `upsertStatementReviewToSupabase` / `listStatementReviewsFromSupabase`（never throw, `devWarn`、`onConflict: 'user_id,local_review_id'`）。repository `lib/repository/statementReviewHistoryRepository.ts` 骨組み（`selfPRs.ts` / `selfPRRepository.ts` を雛形に） | `lib/supabase/` / `lib/repository/` |
| **06C** ✅ | **配線済み**。AuthProvider backfill 配線: `backfillStatementReviewHistoryOnce({ userId })` を 4 本目の fire-and-forget として selfPRs backfill の直後に起動。`BackfillFeature` に `'statementReviewHistory'` 追加（`lib/repository/backfillFlag.ts`）。上りのみ・restore / delete 伝播なし・LS の 10 件 cap を DB に反映しない | `app/components/AuthProvider.tsx` / `backfillFlag.ts` / `statementReviewHistoryRepository.ts` |
| **06D** ✅ | **配線済み**。dualWrite 配線: 添削保存直後（`app/statement/edit/page.tsx` の cache hit / API 成功の 2 site）に repository 単一 entry point `mirrorStatementReviewOnce` を dynamic import で dispatch（**upsert-only**）。`useCurrentUserId` で userId 取得、未確定なら no-op。eviction / 削除は DB に伝播させない（§9）。app は supabase helper を直接 import しない | `app/statement/edit/page.tsx` |
| **06E** | restore / delete-safety 設計（`self_prs_delete_safety_design.md` 同型）: `deleted_at` soft-delete, `mergeStatementReviews` pure fn, restore 配線, 2 端末 resurrection テスト, orphan reconcile。**release 後・別 STEP** | 全層 |

依存順: 06-DB-APPLY → 06B → 06C → 06D →（後日）06E。**release 前スコープ（06A〜06D, 上り mirror）は 06D で完了。** restore（06E）のみ release 後送り。
