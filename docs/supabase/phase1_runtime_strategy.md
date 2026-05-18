# Phase1 Runtime Strategy

PASSAI における **Phase1 (localStorage canonical + Supabase best-effort mirror)** の runtime 統合戦略を、最初の Supabase 関連コードが書かれる **前** に固定する。
本ドキュメントは Phase1 着手 STEP の **契約根拠** として機能し、PR レビューで「これは Phase1 の範囲か / Phase2 への越境か」を即判断できる状態を目指す。

関連: [migration_phases.md](./migration_phases.md), [client_boundary.md](./client_boundary.md), [architecture_rules.md](../principles/architecture_rules.md), [student_profile_contract.md](../principles/student_profile_contract.md), [incremental_refactor_policy.md](../principles/incremental_refactor_policy.md), [localstorage_keys.md](../shared/localstorage_keys.md)

---

## 1. Purpose

- 最初の `createClient` / 最初の mirror helper が書かれる **前** に、Phase1 の runtime 振る舞いを契約として固定する
- 「mirror が動くべきタイミング」「Supabase を呼んでいいタイミング」「失敗時の挙動」「hydration / restore / cache との関係」を予め決め、feature ごとの即興判断を排除する
- canonical (localStorage) UX が **Supabase の存在 / 非存在に依存しない** ことを runtime 契約として明文化する
- [migration_phases.md §4 Phase1](./migration_phases.md) の Phase 定義と [client_boundary.md](./client_boundary.md) の境界規約を、runtime 側の実装ガイドとして翻訳する

本ドキュメント自体は contract 専用であり、本ドキュメントの作成によって Supabase 実装が始まるわけではない。実装着手は feature 単位で別 STEP として起票する。

---

## 2. Current Runtime Position

- branch: `feature/supabase-migration`
- Phase: **Phase1 着手中 — 第1 mirror (StudentProfile) + 第2 mirror (basicInfo) + 第3 mirror (diagnosis) + 第4 mirror (activityData, submit-driven) 配線済 / 観測 sink 配線済 / shared finalize helper + shared sourceHash helper 抽出済 (N=4)**
- Supabase boundary (`lib/supabase/`) は確立済み: client / env / kill-switch / mirror helper / 観測 sink / shared finalize / shared sourceHash が揃っている
  - mirror helper は **4 件** wired (`mirrorStudentProfile`, `mirrorBasicInfo`, `mirrorDiagnosis`, `mirrorActivityData`)。残りは [feature_rollout_matrix.md](./feature_rollout_matrix.md) の Recommended Order に従って追加
  - PII pattern 3 種を validate 済: direct-PII strip (basicInfo) / no-PII (diagnosis) / narrative-soft PII (activityData)
  - activityData mirror は **submit-driven** (`handleSubmit` 経由)。autosave 経路には mirror dispatch を入れない (STEP-PHASE1M 決定)
  - fallback helper / read 経路は引き続き **未実装**（Phase2 範囲）
- canonical は localStorage 一択。`lib/*Storage.ts` 群が唯一の永続層窓口
- StudentProfile contract は固定済み（[student_profile_contract.md](../principles/student_profile_contract.md)）
- 認証は未導入。anonymous で全 feature が完動する状態

本ドキュメントは「これから書く Supabase 関連 runtime コード」に適用される。既に landed した第1 mirror も本 doc 規約に従って配線されている。

---

## 3. Phase1 Runtime Philosophy

Phase1 runtime を貫く 5 つの哲学。Phase1 期間中、これらが他の判断より優先される。

1. **Supabase は無くても feature は完動する**。Phase1 期間中、Supabase 接続を無効化しても全 feature が canonical 経路のみで成立する状態を維持する。
2. **mirror は副次効果**。canonical 書き込みの成否は mirror の成否と独立する。mirror の存在が canonical UX を **遅らせない / 妨げない / 変えない**。
3. **rendering は canonical (localStorage) のみで決定する**。Supabase 状態が render 結果に影響しない。
4. **失敗は沈黙する**。mirror 失敗は throw / toast / UI block を生まず、observability に蓄積されるのみ。
5. **Phase 越境を runtime で先取りしない**。Phase2 用の read fallback や Phase3 用の Supabase canonical 経路を Phase1 PR で「準備として」書かない。

これらは [migration_phases.md §3 Migration Principles](./migration_phases.md) の Phase1 視点での再宣言。

---

## 4. Canonical Ownership During Phase1

Phase1 期間中、**canonical ownership は localStorage に固定される**。

- 唯一の canonical 書き込み先: `lib/*Storage.ts` 経由の localStorage
- 唯一の canonical 読み出し元: `lib/*Storage.ts` 経由の localStorage
- Supabase は **non-canonical mirror destination** であり、read 経路には登場しない
- canonical helper（`saveStudentProfile` 等）の signature / 戻り値型 / 例外契約は Phase1 で変更しない
- canonical 書き込みの成功条件は **従来どおり localStorage 書き込み完了のみ** で判定される。mirror 成功は条件に加わらない
- canonical 読み出しの戻り値は **localStorage の状態のみ** から構成される。Supabase 状態は混入しない
- canonical helper の **意味論的所有者**（責任の所在）は変わらない（[student_profile_contract.md](../principles/student_profile_contract.md) の責務分担を維持）

ルール:

- Phase1 期間中に「Supabase 側がより新しい」「Supabase 側にしか無い」状態を runtime が解決しようとしない（Phase2 以降の責務）
- canonical ownership を変える runtime 配線は Phase1 PR に含めない（Phase 進行は doc-first）

---

## 5. Allowed Runtime Behaviors

Phase1 期間中に runtime で行ってよい振る舞いの **すべて**。これ以外は禁止（[§6](#6-forbidden-runtime-behaviors) 参照）。

- canonical localStorage 書き込み（従来どおり）
- canonical localStorage 読み出し（従来どおり）
- canonical 書き込み **成功後** の mirror helper 起動（fire-and-forget が default）
- mirror helper 内部での Supabase client 呼び出し（[client_boundary.md §4](./client_boundary.md) の boundary file 経由で）
- mirror helper 内部での try/catch による失敗吸収
- mirror helper 内部での observability 層への記録
- mirror helper の **no-op skip**（env 未定義 / user identity 未確定 / kill-switch ON のとき）
- mirror helper の **idempotent retry**（呼び出し側ロジックではなく、同一 input の再呼び出しが壊れない設計、という意味）
- boundary file 内での singleton 化 / env 読み出し / kill-switch 判定

ここに列挙されない runtime 振る舞いは Phase1 では実装しない。

---

## 6. Forbidden Runtime Behaviors

Phase1 期間中に runtime で **行ってはならない** 振る舞い。レビューでは reject する。

- Supabase からの **read**（一切禁止。リクエスト送信そのものを行わない）
- canonical 書き込みの **前段** での Supabase 呼び出し
- canonical 書き込みの **同期 await** の中に Supabase 呼び出しを挟むこと
- mirror 失敗時の **throw / toast / UI block / loading 表示**
- mirror 完了を **await した上で UI 遷移する** 設計
- restore 経路（reload / cache hit / `sourceHash` 一致時の復元）から Supabase を呼ぶこと
- canonical helper の signature / 戻り値型 / 例外契約の変更
- `*InputHash` / `sourceHash` 等の cache semantics の変更
- localStorage key の rename / 削除
- 認証 / user identity に依存した UX の導入
- Phase2 用 fallback read 経路の **「準備」** としての配線
- Phase3 用 Supabase canonical 書き込み経路の **「実験的導入」**
- feature-local な retry loop / backoff の導入（best-effort 定義に反する）
- feature module 内での `@supabase/supabase-js` 直 import / `createClient` 直叩き（[client_boundary.md §6](./client_boundary.md)）
- mirror helper の `save` / `persist` / `sync` 命名（[migration_phases.md §7](./migration_phases.md), [client_boundary.md §10](./client_boundary.md)）

---

## 7. Mirror Write Lifecycle

mirror 書き込みの runtime ライフサイクルを **時系列固定** で定義する。

```
[ caller: feature module / canonical helper ]
        │
        │ 1. canonical 書き込み (localStorage) を実行
        ▼
[ canonical write success? ]
        │
        ├─ no  → 既存の canonical 失敗ハンドリング (Phase1 範囲外) / mirror は起動しない
        │
        └─ yes → 2. mirror helper を fire-and-forget で起動
                       │
                       ▼
                [ mirror helper ]
                       │
                       │ 3. boundary file から Supabase client を取得
                       │     - env 未定義 / kill-switch ON / user 未確定 → no-op skip & observability 記録
                       ▼
                [ Supabase 書き込み試行 ]
                       │
                       ├─ success → observability に success 記録
                       │
                       └─ failure → try/catch で吸収 / observability に failure 記録
                                    (throw しない / UI に出さない / retry しない)
```

ルール:

- mirror 起動は **常に canonical 書き込み成功後**。失敗時の mirror 起動はしない（canonical-fail 状態を Supabase に押し付けない）
- mirror helper は **戻り値で UI 判定を許さない**。caller は mirror の Promise を await しても、await 結果で分岐しない（推奨は fire-and-forget）
- mirror helper は **再入可能 / idempotent**。同一 input での再呼び出しが壊れない（`sourceHash` 併送等で dedup 可能に）
- mirror helper の起動位置（canonical helper 内部 vs caller 側）は feature ごとに決定し、PR description に明記（[client_boundary.md §11](./client_boundary.md)）
- mirror 内で **canonical (localStorage) を読み返さない**。canonical state は caller が持っている input を信頼する（重複 read で hydration 順序を破壊しないため）

---

## 8. Read Path Policy

Phase1 期間中、**read 経路は localStorage 一択**。

- 全 feature の read は `lib/*Storage.ts` 経由の localStorage 読み出しで完結する
- Supabase からの read 呼び出しは Phase1 PR に **含めない**（リクエスト送信を含む実装そのものを書かない）
- restore 経路（reload / cache hit / `sourceHash` 一致時 / mount 直後の hydration）は **canonical のみ** で動作する
- 「localStorage が空のときだけ Supabase を読む」というロジックは Phase1 では **書かない**（Phase2 の責務）
- fallback / 二次ソース / Plan B として Supabase を読む設計を Phase1 で先取りしない
- read 経路の latency / 失敗挙動は Phase1 で変えない

意図:

- read 経路に Supabase が混ざった瞬間、UI render が Supabase state に依存する可能性が生まれる
- Phase1 では「Supabase が無くても feature が完動する」を runtime 契約として強制する必要があるため、read 経路を一切触らない

---

## 9. Failure Handling Rules

失敗ハンドリングの runtime 規約。Phase1 では最弱の介入に統一する。

| 失敗種別 | runtime 挙動 | retry | UI 露出 |
|---|---|---|---|
| Supabase 書き込み失敗 | mirror helper 内 try/catch で吸収 / observability 記録 | しない | しない |
| Supabase auth 未確定 | mirror を no-op skip / observability 記録 | しない | しない |
| boundary 内 env 未定義 | mirror を no-op skip / observability 記録 | しない | しない |
| network 切断 | mirror 失敗扱い / observability 記録 | しない | しない（既存 offline UX があればそれに従う） |
| schema mismatch | mirror payload を drop / observability 記録 | しない | しない |
| canonical (localStorage) 書き込み失敗 | 既存挙動を維持 / mirror は起動しない | 既存ポリシーに従う | 既存ポリシーに従う |
| boundary file 内 client 生成失敗 | mirror を no-op skip / observability 記録 | しない | しない |

原則:

- **mirror 失敗は非致命**。throw / toast / loading 表示で UX に露出させない
- **retry / backoff / queue を Phase1 で実装しない**。best-effort 定義の境界を越えるため
- **destructive rollback を行わない**。mirror 失敗を理由に canonical (localStorage) を消す / cache を invalidate する / `sourceHash` を変更するなどの破壊操作を一切行わない
- **「失敗を見つけたら直す」のは Phase 進行判断の文脈**。Phase1 期間中の失敗は observability に蓄積し、Phase2 移行 STEP の入力情報として使う

---

## 10. Restore Semantics Protection

restore（既存 user の state を画面に復元する経路）の意味論は Phase1 で **一切変更しない**。

- restore 経路は **canonical (localStorage) のみ** から復元する
- restore 経路に Supabase 呼び出しを差し込まない（同期 / 非同期 / fallback いずれも）
- restore のタイミング（mount / effect / hydration 完了直後）は変更しない
- restore 結果に Supabase 由来の値を混ぜない
- restore 後の **canonical → mirror の back-fill 起動** は **行わない**（既存 user の localStorage を mirror に複製する behavior を Phase1 で導入しない。理由: idempotent な大量 mirror 起動を観測前提なしに行うと observability 設計と矛盾する）
  - 後追い back-fill が必要になった場合は、別 STEP として観測ベースで設計する
- restore の **失敗ハンドリング**（localStorage parse 失敗 / version mismatch / 空 state UI への分岐）は既存挙動を維持する

ルール:

- mirror 導入 PR で restore 経路のコードを **触る場合**、変更を mirror に必要な最小限に留め、restore semantics の挙動差分が無いことを PR description で明示する
- restore と mirror を **同一 helper / 同一ファイル** に混在させない（[client_boundary.md §10](./client_boundary.md), [§14 Anti-patterns](#16-anti-patterns)）

---

## 11. Cache Semantics Protection

PASSAI 各 feature が持つ cache semantics（`*InputHash`, `sourceHash`, `summarizeCache` 等。[localstorage_keys.md](../shared/localstorage_keys.md)）は Phase1 で **一切変更しない**。

- cache hit / miss の判定は **localStorage の状態のみ** から決まる
- cache validity が mirror 成否に依存しない（mirror 失敗を理由に cache を invalidate しない / `*InputHash` を変えない）
- cache hit 経路で Supabase を呼ばない（cache hit は AI 再呼び出しを skip するための機構であり、Supabase 呼び出しを追加する場ではない）
- `sourceHash` の手動偽装を mirror 都合で行わない（[student_profile_contract.md §11 Anti-pattern](../principles/student_profile_contract.md)）
- canonical sync（cache hit 経路でも StudentProfile patch を忘れない）の責務は Phase1 でも維持される（[student_profile_contract.md §5.4](../principles/student_profile_contract.md)）
- cache の **mirror** は Phase1 では原則行わない（cache は derived。canonical artifact の mirror を優先する）
  - feature 別に cache mirror が必要になった場合は別 STEP として個別判断（観測ベース）

---

## 12. Hydration Safety Expectations

Phase1 期間中、Next.js の hydration / SSR 文脈における安全性を **既存挙動から劣化させない**。

- mirror 起動は **client (browser) 文脈** に閉じる。server component / route handler から mirror helper を呼ばない（Phase1 のスコープ外）
- mirror 起動は **render path に置かない**。具体的には:
  - render 関数本体で mirror を起動しない
  - server component で mirror を起動しない
  - hydration 完了前の同期 effect で mirror を起動しない
- mirror 起動は **canonical 書き込みの後段の同期延長** に置く（既存の canonical 書き込みが行われるタイミングを変えない）
- mirror 導入によって **mount 順序依存** を生まない（mirror が走ったか否かで次の mount の振る舞いが変わる構造を作らない）
- async persistence logic を render path に挿入しない（既存の hydration-safe restore 設計を維持する）
- `useEffect` 内で mirror を起動する場合、依存配列に Supabase state を入れない（Supabase state を Phase1 では React state として持たない）
- SSR / RSC で boundary file の **browser 用** を import しない（[client_boundary.md §5](./client_boundary.md)）

意図:

- hydration mismatch を mirror 起動が誘発しない
- 既存の hydration-safe restore（StudentProfile / basicInfo / activity 等で実装済み）の挙動を mirror が壊さない

---

## 13. Observability Requirements

Phase1 期間中、mirror 配線は **以下を観測可能にする**。これは Phase2 進行判断の入力になる。

- mirror 起動の **3 結果** を区別して記録: `success` / `failure` / `skip(no-op)`
- 失敗種別の粗粒度分類: `auth_missing` / `env_missing` / `network` / `schema` / `unknown`
- feature 単位の **mirror 起動率**（canonical 書き込みのうち mirror が起動した割合）
- feature 単位の **mirror 成功率**（起動のうち success の割合）
- canonical 書き込み成功 vs mirror 成功 を **明確に区別** して記録する（混同しない）

ルール:

- observability への書き込みは **best-effort**。observability の失敗が mirror helper の挙動を変えない
- observability への書き込みは UX に影響しない（user-visible UI / toast / loading を出さない）
- 既存 AI 観測枠（[ai_usage_observability.md](../principles/ai_usage_observability.md) / [ai_cache_observability.md](../principles/ai_cache_observability.md)）に乗せるか独立 sink を切るかは Phase1 着手 STEP で決定し、別ドキュメント（仮: `docs/supabase/mirror_observability.md`）として起票する
- 観測項目の **正式リスト** は同 STEP で確定する。本ドキュメントは要件のみ規定し、項目名は固定しない
- boundary file は kill-switch を提供する（[client_boundary.md §13](./client_boundary.md)）。観測異常時に手動で mirror 全停止できる手段を Phase1 着手と同時に確保する

---

## 14. Feature Rollout Order

Phase1 期間中の feature 移行順序を固定する。順序固定の意図は「最初の数 feature で observability / boundary / 失敗哲学を検証し、後段の高リスク feature へ広げる」こと。

1. **StudentProfile**（最初）
   - canonical contract が固定済み（[student_profile_contract.md](../principles/student_profile_contract.md)）
   - canonical helper（`lib/studentProfileStorage.ts`）が単一窓口として確立
   - 下流 feature が読む側であり、StudentProfile を先に持ち上げると後段判断材料が増える
   - schema を最小（1 entity）から検証できる

2. **低リスク cache / domain surfaces**（次）
   - 候補例: `basicInfo`, `activityData` 等の **canonical 状態が明確で restore semantics が安定** している feature
   - cache 系 (`*InputHash`) は Phase1 では原則対象外（[§11](#11-cache-semantics-protection) 参照）。canonical artifact 自体を mirror する feature を優先する
   - 各 feature の選定は Phase1 着手 STEP で個別判定し、本ドキュメントに追記する

3. **高リスク AI restore flows**（最後）
   - 候補例: 壁打ち / summarize / interview / statement-review など、**AI 出力を含む canonical artifact** と **cache 経路** が同居する feature
   - 理由: AI 出力 + cache hit + canonical sync が絡む経路は restore semantics と最も衝突しやすい
   - これら feature は前段 feature の observability 結果を踏まえてから着手する

ルール（[migration_phases.md §8 Rollout Policy](./migration_phases.md) と整合）:

- feature を Phase1 に入れる前提として以下が満たされていること:
  - canonical helper が `lib/*Storage.ts` に集約済み
  - restore behavior が文書化または安定
  - cache / version semantics が文書化済み
  - 失敗時挙動が既知
- 上記を満たさない feature は **Phase1 に入れる前** に該当 docs を整備する（doc-first）
- 各 feature の Phase1 移行 PR は **mirror 配線 1 件のみ**（cross-cutting refactor を混ぜない、[incremental_refactor_policy.md](../principles/incremental_refactor_policy.md)）
- 移行順序の途中で前提が崩れた場合（observability 結果が悪い等）、当該 feature の Phase1 を **一時停止する** 判断を許す（Phase2 への自動進行は無い）

---

## 15. Phase1 Exit Criteria

Phase1 を「終わった」と判断するための条件。これらを満たさない feature は Phase2 に進めない。

- 当該 feature の mirror 配線が rollout 順序に沿って merge 済み
- 当該 feature の mirror 成功率が **十分に安定**（具体閾値は observability 結果に基づき Phase1 着手 STEP で定義）
- 当該 feature の mirror 失敗種別の分布が **既知 / 分類済み** で、未分類の `unknown` 比率が許容範囲内
- Phase1 期間中に observability 上 **canonical UX が壊れた事象がゼロ** であること
- boundary file / mirror helper / observability sink が **kill-switch で全停止可能** な状態を維持していること
- 当該 feature の restore semantics / cache semantics が Phase1 開始時点から **変化していない** ことを確認できること
- Phase1 期間中に発生した失敗事象が Phase2 移行 STEP の input として **整理されている** こと

Phase1 全体の終了（プロジェクト全体としての Phase1 卒業）は、**StudentProfile + 低リスク feature 群** が上記を満たした時点で宣言する。高リスク AI restore flows は Phase1 卒業判断後に着手することも許容する（順序は固定だが Phase 卒業は feature 単位で進む）。

Phase2 への遷移は **本ドキュメントの後継**（仮: `docs/supabase/phase2_runtime_strategy.md`）を起票してから行う。

---

## 16. Anti-patterns

Phase1 期間中、以下は **境界違反** として禁止。レビュー / PR 段階で reject する根拠とする。

- **Supabase-dependent rendering**
  - 例: render 関数 / server component が Supabase state を読んで描画分岐する
  - 理由: rendering は canonical (localStorage) のみで決定する原則に反する
- **canonical localStorage read の置き換え**
  - 例: 既存の `loadXxx` を Supabase 経由の async 関数に書き換える / wrapper を挟む
  - 理由: canonical ownership が暗黙に Supabase に移る
- **async restore branching**
  - 例: restore 経路に「Supabase の結果が来たら state を上書きする」分岐を入れる
  - 理由: restore semantics 保護に反する / hydration 順序を壊す
- **mixed canonical ownership**
  - 例: 一部の field を Supabase canonical / 一部の field を localStorage canonical にする
  - 理由: Phase1 は「localStorage 一択」が前提
- **optimistic Supabase assumptions**
  - 例: 「mirror が成功している前提」で UI を構築 / 「Supabase に存在するはず」を前提に分岐
  - 理由: mirror は best-effort であり成功保証が無い
- **blocking UI on mirror completion**
  - 例: mirror Promise を await して UI 遷移 / mirror 中 loading spinner / mirror 完了まで input を disable
  - 理由: UX を mirror 成否に縛り付ける
- **feature-local retry storms**
  - 例: feature module 側で mirror 失敗を検知して exponential backoff retry する / queue を作る
  - 理由: best-effort 定義の境界を越える / 観測前提が崩れる
- **hidden read fallback behavior**
  - 例: 「localStorage が空なら Supabase を読む」を Phase1 PR でこっそり入れる
  - 理由: Phase2 の責務を Phase1 が侵食する
- **restore と mirror の同居**
  - 例: 1 つの helper が「localStorage 復元 + Supabase mirror + Supabase fallback」を兼ねる
  - 理由: 失敗哲学と所有権が混在し、Phase 移行時の責任分割が崩れる（[client_boundary.md §14](./client_boundary.md)）
- **mirror 起動を render path に置く**
  - 例: server component / render 関数本体 / hydration 前 effect で mirror を起動
  - 理由: hydration safety 違反 / mount 順序依存を生む
- **mirror 失敗の UI 露出**
  - 例: `toast.error('Supabase に保存できませんでした')` / mirror 失敗で error boundary を発動
  - 理由: failure handling rule に反する
- **destructive rollback**
  - 例: mirror 失敗時に localStorage を消す / cache invalidate / `sourceHash` 偽装
  - 理由: canonical state 保護に反する
- **auth-dependent UX を Phase1 に持ち込む**
  - 例: mirror のためにログイン UI を導入 / mirror skip を user 起因の挙動として露出
  - 理由: Phase1 は anonymous で完動が前提
- **Phase2 / Phase3 先取り実装**
  - 例: fallback read の「準備」配線 / Supabase canonical write の「実験」配線
  - 理由: Phase 進行は doc-first

---

## 17. Future Phase2 Notes

Phase2 は本ドキュメントの範囲外。Phase2 着手時に独立した後継ドキュメント（仮: `docs/supabase/phase2_runtime_strategy.md`）として起票する。Phase1 期間中の判断材料として、Phase2 への引き継ぎ事項のみここに残す。

- Phase2 着手の前提:
  - Phase1 Exit Criteria（[§15](#15-phase1-exit-criteria)）を当該 feature が満たしている
  - 認証 / user identity が利用可能（fallback read は「誰の data か」が確定していないと不可、[migration_phases.md §4 Phase2](./migration_phases.md)）
  - Supabase 側 schema が canonical 型と一致している
- Phase2 で初めて許可される runtime 振る舞い:
  - localStorage が空のときの **二次ソース read**（fallback）
  - Supabase 由来値を localStorage に **書き戻す** 経路（以降は通常 read 経路に乗せる）
  - fallback hit 率の observability（Phase3 進行判断の材料）
- Phase2 で依然として禁止される振る舞い:
  - Supabase canonical 書き込み（Phase3 の責務）
  - 双方向 sync / 差分検出 / merge UI
  - localStorage を Supabase より優先しない設計
- 認証導入は **単独 STEP** として独立させ、Phase 進行 PR と混ぜない（[migration_phases.md §12](./migration_phases.md)）
- Phase2 着手のタイミング判断は **observability に基づく**（mirror 成功率 / 失敗種別 / mirror 起動率の安定性）

---

## 締めくくり

Phase1 runtime の最大の制約は **「Supabase が無くても feature が完動する」を runtime 契約として強制する** こと。
mirror が動いても動かなくても、UX 上の見え方が変わらない世界を維持する。
本ドキュメントの境界を runtime PR が侵食した瞬間、Phase1 は「mirror が前提の Phase」に変質し、Phase2 / Phase3 への段階的進行が成立しなくなる。
最初の mirror helper / 最初の boundary file が **本ドキュメントの契約に従って書かれる** ことが、移行全体の予測可能性の前提となる。
