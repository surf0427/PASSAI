# self_prs — Schema Preview（STEP-SUPABASE-COMPLETE-05A）

`supabase/schema.sql` §35–§37 として追記した `self_prs` テーブルの設計メモ。本 STEP は **schema 定義の追記のみ**。DB への apply・アプリ実コード（`app` / `lib` / `types`）の変更は含まない。

関連:
- [`schema_apply_preflight.md`](./schema_apply_preflight.md) — apply 前提条件
- [`self_prs_post_apply_checklist.md`](./self_prs_post_apply_checklist.md) — apply 後検証
- 先行例: `supabase/schema.sql` §32–§34（`self_analysis_logs`）、§19–§23（`tutor_chat_*`）
- canonical 型: `types/selfPR.ts` の `SelfPR`、storage: `lib/selfPRStorage.ts`（key=`'selfPRs'`）

---

## 1. 位置づけ — auth-scoped mirror 系統（mirror_events 系統ではない）

本テーブルは **`self_analysis_logs` / `tutor_chat_*` と同じ auth-scoped mirror 系統**に属する。`localStorage` の `selfPRs`（key=`'selfPRs'`, `lib/selfPRStorage.ts`）を **canonical** とし、本テーブルはその durable mirror（同期先）として best-effort で後追い同期する。

N=4 mirror（`mirror_events` / 共有 `source_hash`, `supabase/schema.sql` §5）系統とは**別レイヤー**である。

| | mirror_events 系統 | auth-scoped 系統（**self_prs** / self_analysis_logs / tutor_chat_*） |
|---|---|---|
| 所有 | 匿名 anon、user 紐付けなし | `user_id = auth.users(id)` |
| RLS | anon INSERT/UPDATE のみ、SELECT 不可 | owner の SELECT/INSERT/UPDATE/**DELETE** |
| 観測 | `mirror_events` sink に記録 | sink には記録しない |
| dedup key | `source_hash`（payload ハッシュ） | natural key `(user_id, local_pr_id)` |

→ **本テーブルに `mirror_events` 由来の検証（success_rate / failure_reason 分布）は適用しない**。検証は RLS owner-isolation・delete owner-isolation・upsert 冪等性に絞る（checklist 参照）。

---

## 2. DDL 全文

```sql
-- 35. self_prs
CREATE TABLE self_prs (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_pr_id      text         NOT NULL,
  pr_index         integer      NOT NULL DEFAULT 0,
  title            text         NOT NULL DEFAULT '',
  body             text         NOT NULL DEFAULT '',
  latest_result    text         NOT NULL DEFAULT '',
  seed_input_hash  text,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  metadata         jsonb        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT self_prs_local_unique UNIQUE (user_id, local_pr_id)
);

-- 36. trigger: set_updated_at()（§3 で定義済みの共有関数を再利用）
CREATE TRIGGER self_prs_set_updated_at
  BEFORE UPDATE ON self_prs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 37. RLS
ALTER TABLE self_prs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self_prs owner select"
  ON self_prs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "self_prs owner insert"
  ON self_prs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "self_prs owner update"
  ON self_prs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "self_prs owner delete"
  ON self_prs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
```

---

## 3. 列設計と localStorage 型の対応

canonical 型: `types/selfPR.ts` の `SelfPR`。

| DB column | localStorage field | 型 / 既定 | 備考 |
|---|---|---|---|
| `id` | （DB 採番） | uuid PK | LS の `id` とは別。LS id は `local_pr_id` へ |
| `user_id` | （LS には無い） | uuid NOT NULL FK | owner key。`auth.users(id)` |
| `local_pr_id` | `id` | text NOT NULL | `SelfPR.id`（UUID 文字列）。natural key の一部 |
| `pr_index` | `index` | integer DEFAULT 0 | カードの並び順 |
| `title` | `title` | text DEFAULT `''` | 未入力なら空文字 |
| `body` | `text` | text DEFAULT `''` | 自己PR 本文 |
| `latest_result` | `latestResult` | text DEFAULT `''` | 最新生成結果 |
| `seed_input_hash` | `seedInputHash` | text NULL | 補助情報のみ。dedup key ではない |
| `created_at` | `createdAt` | timestamptz DEFAULT now() | LS merge では原値保持 |
| `updated_at` | `updatedAt` | timestamptz DEFAULT now() | trigger で前進 |
| `metadata` | （LS には無い） | jsonb DEFAULT `{}` | 将来拡張用 |

---

## 4. natural key が id ベースである理由

natural key は **`(user_id, local_pr_id)`**、すなわち `SelfPR.id` を identity とする。

- `SelfPR.id` は `crypto.randomUUID()` 由来でカードの安定 identity。LS 側でカード本文 (`text`) を編集しても `id` は不変であり、「同じカードの更新」を素直に同一行 update へ写せる。
- カードは編集される（本文・タイトル・最新結果が頻繁に変わる）ため、content を identity にすると編集のたびに別行に見え、mirror が重複する。

---

## 5. content hash を使わない理由

`self_analysis_logs` は `summary_input_hash`（生成入力のハッシュ）を natural key にしたが、self_prs では採らない。

- selfPR は **ユーザーが自由編集する可変ドキュメント**であり、安定したハッシュ可能な「入力」が存在しない（編集後の `text` をハッシュしても editable な値なので key として不安定）。
- `seed_input_hash`（`SelfPR.seedInputHash`）は `buildSelfPRDraftSeed` 由来 PR のみが持ち、手動作成 / legacy PR では `undefined`。全行を覆わないため dedup key には使えない。**補助情報（traceability）として保持するに留める。**

→ identity は安定 UUID（`id`）一本に寄せ、hash は dedup に関与させない。

---

## 6. delete feature のため restore を含めない理由

selfPR は **削除を伴う feature** である（ユーザーがカードを削除できる）。本 STEP では **down-sync / read-through / restore を実装しない**。

- mirror に「LS にあって DB に無い」と「DB にあって LS に無い」が両方起こり得る。後者は「別端末で追加」と「この端末で削除済み」を区別できない。
- restore を素朴に実装すると、削除したはずのカードが mirror から蘇る **delete resurrection** が起きる。
- 安全な双方向同期には **tombstone（削除マーカー）設計**が必要だが、本 STEP の範囲外。05A は durable mirror（上り同期先）の確立のみ。

---

## 7. localStorage canonical / Supabase mirror 方針

- **canonical = localStorage `selfPRs`**。read 経路は本 STEP 以降も LS のまま切り替えない。
- Supabase `self_prs` は durable mirror（best-effort 同期先）。後続 STEP で backfill（上り一括）と dualWrite（新規・更新の即時 mirror）により replica を構築する。
- hydrate / read-through の採否は計測のうえ別 STEP で判断する。

---

## 8. 将来 tombstone 設計が必要なこと

restore / down-sync を有効化する前に、以下を別 STEP で設計する:

- 削除を表す tombstone（例: `deleted_at` soft-delete 列、または削除イベントログ）。
- LS ⇄ DB の競合解決ルール（どちらの削除/更新を勝たせるか、端末間の last-writer-wins か）。
- restore 時に「DB にあるが LS に無い」を「未同期の新規」か「この端末で削除済み」かを判定する根拠。

これらが未確定のまま restore を入れると delete resurrection を招くため、05A では意図的に除外する。
