# self_prs — Delete Safety / Down-Sync Design（STEP-SUPABASE-COMPLETE-05E-DESIGN）

selfPRs の delete 伝播・down-sync / restore を**安全に**実装するための設計ドキュメント。本 STEP は**設計のみ**で、`schema.sql` / `app` / `lib` / `types` は一切変更しない。DB 適用・migration 作成も行わない。

関連:
- [`self_prs_mirror_schema_preview.md`](./self_prs_mirror_schema_preview.md) — §35–§37 の table/trigger/RLS（05A）
- [`self_prs_post_apply_checklist.md`](./self_prs_post_apply_checklist.md) — apply 検証（05A）
- 先行 restore 実装の参照: `lib/repository/selfAnalysisLogRepository.ts` の `mergeSelfAnalysisLogs` / `restoreSelfAnalysisLogsOnce`（04E）
- 現状の配線: backfill = `app/components/AuthProvider.tsx`（05C）／ dualWrite = `app/self-pr/page.tsx`（05D, `propagateDelete: false`）
- フェーズ位置: [`feature_rollout_matrix.md`](./feature_rollout_matrix.md) §2（Phase1 = localStorage canonical + best-effort mirror、認証は匿名、多端末はまだ実運用していない）

---

## 1. Purpose / Scope

- selfPR は **ユーザーが能動的に削除する feature**。05D 時点で **append / patch は mirror されるが delete は mirror されない**（`propagateDelete: false`）。
- このまま素朴な down-sync / restore を入れると **delete resurrection bug**（削除済み PR が別端末で復活）が起きる。本書はそれを防ぐ設計を確定する。
- **本書のゴール**: (a) 問題の正確な整理、(b) tombstone 方式の比較と推奨、(c) restore/merge ルールの確定、(d) `propagateDelete=true` 切替の前提条件、(e) 既存 orphan 行の扱い、(f) 後続 STEP 分割、(g) release 前後の判断。
- 非ゴール: 実装・schema 追記・DB 適用。

canonical は引き続き **localStorage key='selfPRs'**。Supabase `self_prs` は durable mirror。本設計が完了しても read 経路は LS のまま（restore は「下り書き戻し」であって read 切替ではない）。

---

## 2. 現状の問題整理

### 2.1 orphan 行（durable residue）の発生

05D の `dualWriteSelfPRsDelta` は `propagateDelete: false`。LS で PR を削除すると:

- LS（canonical）からは消える。
- Supabase `self_prs` には **行が残り続ける**（delete が伝播しない）。

この「LS にはないが SB に残った行」を本書では **orphan 行**と呼ぶ。

**現時点では orphan は許容される durable residue である。** 理由:
- read 経路は LS canonical のみ。誰も `self_prs` を読まない（`listSelfPRsFromSupabase` は未呼び出し）。
- よって orphan が UI に出ることは**ない**。mirror に余分な行があるだけで、機能・表示・課金いずれにも影響しない。

### 2.2 restore を入れた瞬間に orphan が危険化する

down-sync / restore（SB→LS 書き戻し）を実装すると、`self_prs` を読んで LS に反映するようになる。このとき orphan 行は「SB にあって LS にない行」として現れ、restore がそれを **「別端末で作られた未取得 PR」と誤認して LS に復活させる**。これが delete resurrection。

### 2.3 resurrection シナリオ（具体）

```
端末A: PR "X" を作成 → LS 保存 → dualWrite で SB に upsert（X が SB に存在）
端末A: PR "X" を削除 → LS から消える / propagateDelete=false なので SB には X が残る（orphan）
─────────────────────────────────────────────
端末B: ログイン → restore（素朴実装）が SB を読む
端末B: SB に X があり LS に X が無い → 「未取得の新規 PR」と誤認
端末B: X を LS に復活 ❌（ユーザーが消したはずの PR が蘇る）
さらに端末B の LS が dualWrite で SB に再 upsert され、削除が永久に効かなくなる
```

### 2.4 なぜ tombstone が必要か

上記の核心は **「SB にあって LS にない」が 2 つの異なる事実を表す**こと:

| SB有 / LS無 の意味 | restore のあるべき動作 |
|---|---|
| 別端末で**新規作成**された（未取得） | LS に**追加**する |
| この端末（or 別端末）で**削除済み** | LS に**復活させない** |

行が物理的に「在る/無い」だけでは、この 2 つを区別できない。**削除という事実を mirror 側に明示的に記録する仕組み（tombstone）**が無い限り、安全な down-sync は原理的に不可能。これが「restore は tombstone 設計後の別 STEP」（05A schema コメント／05B repository コメント）の根拠。

---

## 3. 設計案の比較

### 案 A: `self_prs` に soft-delete 列を追加

```sql
ALTER TABLE self_prs ADD COLUMN deleted_at timestamptz;            -- NULL = 生存, 非NULL = tombstone
-- 任意（観測 / 将来の競合解決用、いずれも nullable）:
ALTER TABLE self_prs ADD COLUMN deleted_client_id text;           -- どの端末が消したか（diagnostics）
```

- natural key は **(user_id, local_pr_id) のまま**。削除は行を消さず `deleted_at = now()` を立てる soft delete に変える。
- restore は `deleted_at IS NOT NULL` の行を復活対象から除外するだけで resurrection を防げる。

### 案 B: 別 delete event log table

```sql
CREATE TABLE self_pr_delete_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_pr_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  client_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

- event sourcing 寄り。削除履歴が独立に残る。
- restore merge は `self_prs` と `self_pr_delete_events` を **2 テーブル突き合わせ**する必要があり、repository / RLS / merge が重くなる。

### 案 C: tombstone なし（updated_at / last-writer-wins のみ）

- schema 変更なし。delete は引き続き行を物理削除（または mirror しない）。
- 削除の事実が mirror に残らないため、§2.4 の区別が原理的に不能。**resurrection を完全には防げない。**

### 比較表

| 観点 | A: soft-delete 列 | B: delete event log | C: tombstone なし |
|---|---|---|---|
| schema 影響 | 小（列追加のみ、§35 拡張） | 中（新 table + trigger + RLS = 新 §） | なし |
| repository 影響 | 小（delete を soft-delete に、merge が `deleted_at` 1 列を見る） | 大（2 table join 相当の merge） | 小だが**正しく書けない** |
| RLS 影響 | なし（既存 owner policy が列追加にそのまま効く） | 中（新 table に owner 4 policy 追加） | なし |
| restore merge の単純さ | ◎ `deleted_at` を見るだけ | △ 2 ソース統合 | ✕ 区別不能 |
| 多端末安全性 | ○（resurrection 防止可） | ○（同上、履歴も残る） | ✕ |
| 実装コスト | 低 | 高 | 最低（だが未解決） |
| release 前に入れるべきか | 任意（§9 参照） | 過剰 | 不可（バグ温存） |
| PASSAI 現フェーズ適合 | ◎ canonical=LS / mirror best-effort の軽量方針に合致 | △ 観測要件が無い段階では over-engineering | ✕ |

---

## 4. 推奨案

### 4.1 推奨: 案 A（`self_prs` に `deleted_at` を追加する soft-delete 方式）

理由:
- natural key `(user_id, local_pr_id)` を維持でき、既存 upsert / backfill / dualWrite の構造を壊さない。
- restore で `deleted_at` を見るだけで resurrection を防げる（merge が単純）。
- event log（案 B）より軽く、RLS も既存 owner policy がそのまま効く。
- canonical=LS / mirror=best-effort という現フェーズの軽量方針に最も適合。

### 4.2 `deleted_at` だけで足りるか

| 候補列 | 必要性 | 判断 |
|---|---|---|
| `deleted_at timestamptz` | **必須**。resurrection 防止の核。 | **05E で導入** |
| `deleted_client_id text` | 任意。どの端末が消したかの観測 / 自端末 tombstone echo の識別。**correctness には不要**。 | nullable で**同時導入推奨**（コスト極小・後で効く） |
| `mutation_seq` / `deleted_version bigint` | 真の cross-device last-writer-wins（§5 ケース2 の自動解決）に必要。**conservative merge を採る限り不要**。 | **当面見送り**。必要化したら追加 |
| `updated_at` との比較利用 | SB の `updated_at` は §36 trigger が **書込時刻（server clock）で上書き**するため、LS の `updatedAt`（client clock）とは別時計。**cross-clock 比較は不正確** → delete vs edit の順序判定には使わない。 | **使わない**。順序判定が必要になったら client 供給の専用列を別途設計 |

**結論**: 現フェーズは **`deleted_at`（必須）＋ `deleted_client_id`（任意・観測用）で開始**。`mutation_seq` / 厳密 LWW は、多端末の同時編集衝突を自動解決したくなった段階で追加する。それまでは §5 の conservative merge（local を壊さない）で衝突を回避する。

---

## 5. restore / merge ルール設計

key = `local_pr_id`（= `SelfPR.id`）で LS と SB を突き合わせる。restore は **下り one-way merge**（read 経路は変えず LS に書き戻すだけ）。**大原則: restore は local データを決して破壊しない（best-effort 下りで silent delete をしない）。**

下表は **soft-delete（案 A）導入後、かつ delete が tombstone を書く（propagateDelete=true）状態**を前提とする。

| # | LS | SB | SB.deleted_at | 意味 | restore 動作 |
|---|----|----|----|------|------|
| 1 | 有 | 有 | null | 両方生存 | **何もしない**（LS canonical 維持。上りは dualWrite が担当） |
| 2 | 有 | 有 | **非null** | 別端末で削除されたが local には在る | **何もしない（local 保持）**＋ conflict として log。silent に local 削除しない |
| 3 | 有 | 無 | — | local-only（未 mirror） | **何もしない**（backfill / dualWrite が上げる） |
| 4 | 無 | 有 | null | 別端末で新規作成された未取得 PR | **LS に追加**（genuine restore） |
| 5 | 無 | 有 | **非null** | tombstone（削除済み） | **何もしない**（= resurrection 防止の本体） |

明記事項:
- **ケース5: `deleted_at IS NOT NULL` の PR は restore で LS に復活させない。** これが delete safety の核。
- **ケース2: LS にあるが SB が削除済みの場合、release 前は LS から消さない（conservative）。** 別端末の削除を local に伝播させるには「local の編集が削除より後か」を判定する必要があるが、`updated_at` が cross-clock で信頼できない（§4.2）ため、**自動削除はしない**。データ消失より「削除が端末間で遅れて伝わらない」方を許容する。将来 `mutation_seq` を入れたらケース2の自動解決を再設計する。
- **ケース1: cross-device の edit-merge（どちらの編集が新しいか）も当面は LS 優先で「何もしない」。** selfAnalysisLogs の `mergeSelfAnalysisLogs` は LWW だが、あちらは hash key で in-place 上書きの semantics が明確なのに対し、selfPR は自由編集ドキュメントで安定 hash が無い（schema preview §5）。release 前は LS 優先の conservative merge とし、cross-device edit 衝突の自動解決は後続課題とする。
- restore は `mergeSelfPRs(localPRs, remoteRows)` のような **pure 関数**として実装し（`mergeSelfAnalysisLogs` を参照）、入力を mutate せず、`pr_index`→`createdAt` 順に正規化して返す。`deleted_at` は domain `SelfPR` には載せず、merge 内部でのみ参照する（types は変えない方針を維持）。

---

## 6. `propagateDelete=true` への切替条件

05D の `propagateDelete: false` を `true` に切り替えてよいのは、**以下が全て満たされたとき**:

1. `self_prs` に `deleted_at`（＋任意 `deleted_client_id`）が **追加適用済み**（05E-1）。
2. `deleteSelfPRFromSupabase` が **物理 delete から soft delete（`deleted_at = now()` を立てる UPDATE）に変更済み**（05E-2）。物理削除のままだと tombstone が残らずケース4/5を区別できない。
3. restore/merge が **`deleted_at` を尊重する**（ケース5 で復活させない）実装が入っている（05E-4）。
4. **既存 orphan 行の扱いを決定・実施済み**（§7）。
5. post-apply checklist で **resurrection が起きないこと**を 2 端末シナリオで確認済み（05E-6）。

順序の要点: **soft-delete 列と soft-delete 化（1,2）が restore 有効化（3,5）より先**。物理 delete のまま propagateDelete=true にすると、削除が行消滅になり orphan ではなく「消えた行」になって、tombstone を残せない。

---

## 7. 既存 orphan 行の扱い

05D までに `propagateDelete=false` で生じた orphan 行（SB に在るが LS で削除済み、`deleted_at` も無い）は、restore 導入時に **ケース4（生存・未取得）に誤分類され resurrection を起こす**。対処の選択肢:

| 選択肢 | 内容 | 評価 |
|---|---|---|
| (a) 放置 | restore 未導入の間は無視 | restore を入れない限り安全（現状）。だが restore 前提では不可 |
| (b) restore 前 cleanup | restore 導入前に orphan を一掃 | 必要。ただし「どれが orphan か」を多端末で一意に決められない点に注意 |
| (c) 無条件で SB→LS 復元 | LS に無い SB 行を全部復元候補に | **危険**（resurrection そのもの）。採らない |
| (d) restore 前に mirror 再構築 | LS truth で SB を作り直す | 多端末では「どの端末の LS が truth か」決められず、単独では不可 |

**推奨: (b) を「クライアント側 one-time reconcile」として実施する。**

- 現フェーズは **多端末が実運用されていない**（restore が今まで存在しなかったため、各ユーザーの `self_prs` 行は実質**単一端末の backfill + dualWrite 由来**）。したがって「自分の LS に無い SB 行 = 自分が過去に削除した orphan」とみなして安全。
- 05E のロールアウト時に **`BACKFILL_VERSION` を +1** し、その世代の初回起動で per-user に:
  1. 現在の LS（canonical）を読む。
  2. SB の自分の行のうち `local_pr_id` が LS に無いものへ `deleted_at = now()` を立てる（soft-delete = tombstone 化）。
  3. これで以後 restore はそれらをケース5として正しく無視する。
- caveat（doc に明記する）: ごく稀に「別端末で作ったが当該端末の LS に無い真正 PR」があれば誤って tombstone 化し得る。しかし restore は今まで動いていないため、そうした cross-device 真正データは原理上ほぼ存在しない。release 前にこの reconcile を一度通すのが最も安全。

放置(a)は「restore を当面入れない」と決めた場合の既定（§9）。その場合 orphan は §2.1 の無害な residue のまま。

---

## 8. 後続実装 STEP 分割

| STEP | 内容 | 主な対象 |
|---|---|---|
| **05E-1** | schema 追記案: `self_prs` に `deleted_at`（＋任意 `deleted_client_id`）を追加。§35 拡張 or 新 §38。post-apply 検証 SQL も用意。**DB 適用は operator** | `supabase/schema.sql` / docs |
| **05E-2** | repository soft-delete 対応: `deleteSelfPRFromSupabase` を soft delete（`deleted_at=now()` UPDATE）に変更。`listSelfPRsFromSupabase` を `deleted_at` 込みで返すよう拡張（domain には漏らさない） | `lib/supabase/selfPRs.ts` |
| **05E-3** | `app/self-pr/page.tsx` の `propagateDelete` を `true` に切替（§6 の前提充足後） | `app/self-pr/page.tsx` |
| **05E-4** | `restoreSelfPRsOnce` / `mergeSelfPRs`（pure）実装。§5 の 5 ケース表を実装。`deleted_at` を尊重 | `lib/repository/selfPRRepository.ts` |
| **05E-5** | AuthProvider に restore 配線（backfill → restore の順、独立 fire-and-forget、flag `'selfPRsRestore'`） | `app/components/AuthProvider.tsx` / `backfillFlag.ts` |
| **05E-6** | post-apply checklist / resurrection test（2 端末: A 削除 → B restore で復活しないこと）。§7 orphan reconcile の検証も含む | docs |

依存順: **05E-1 → 05E-2 → (05E-3, 05E-4) → 05E-5 → 05E-6**。05E-3（delete 伝播 ON）は 05E-2 完了が前提（§6）。

flag/世代への影響: 05E-5 の restore は `BackfillFeature` に `'selfPRsRestore'` を追加（上り `'selfPRs'` とは別 key、04E と同パターン）。§7 の orphan reconcile を入れる場合は `BACKFILL_VERSION` を +1 し、上り `'selfPRs'` を再実行させて reconcile を兼ねさせる設計が素直。

---

## 9. release 前に実装すべきか / release 後でよいか

**判断: release 前は 05D のまま（restore 未実装・`propagateDelete=false`）で良い。05E 一式は release 後送りを推奨。**

根拠:
- 現フェーズは **認証=匿名・多端末が実運用されていない**（feature_rollout_matrix §2）。resurrection は「同一ユーザーが複数端末で selfPR を編集/削除する」状況でのみ顕在化するが、その状況自体がまだ無い。
- 05D の orphan は read 経路が LS のみである限り **完全に無害な durable residue**（§2.1）。UI・課金・表示いずれにも出ない。
- 一方 05E は「schema 変更 + soft-delete 化 + restore + merge + 2端末テスト」で実装・検証コストが大きい。release 前のクリティカルパスに載せる便益が薄い。
- リスク順序として正しいのは「canonical(LS) は常に正 / mirror は best-effort」。restore を急いで入れて resurrection を出す方が、orphan を残すより有害。

ただし **release 後に「複数端末で履歴を揃えたい」要望が出たら 05E を着手する**前提を明記しておく。それまでは:
- `propagateDelete=false` を維持（05D のコメント通り）。
- `self_prs` の orphan は放置（§7 (a)）。
- restore は導入しない。

**唯一 release 前に検討する価値があるもの**: 05E-1 の `deleted_at` 列を **schema にだけ先に足しておく**（DDL の前方互換確保）。列があっても誰も使わなければ無害で、後で soft-delete 化するときに ALTER を本番に流す手間／タイミングを前倒しできる。これは任意。

---

## 10. Open Questions（後続 STEP で確定）

- cross-device の edit 衝突（ケース1/2 の自動 LWW）をいつ・どの clock で解決するか（`mutation_seq` 導入要否）。
- `deleted_client_id` を実際に観測に使うか（自端末 tombstone echo の抑止に使うなら client_id の発番元を決める）。
- restore 後の UI 反映タイミング（self-pr ページは LS 書き戻しを自動 re-render しない。selfAnalysisLogs 同様「次回 mount で反映」で許容するか）。
- orphan reconcile（§7 (b)）を本当に流すか、それとも restore を「05E 適用後に作られた行のみ対象」に限定して orphan を構造的に回避するか。
