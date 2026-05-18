# Supabase Migration Phases

PASSAI の Supabase 移行を **段階ごとの canonical / mirror 責任分担** として固定化する規約。
契約を先に書くことで、後段の実装 PR が「どこまでが Phase 内 / どこからが越境か」を即判断できる状態を目指す。

関連: [architecture_rules.md](../principles/architecture_rules.md), [student_profile_contract.md](../principles/student_profile_contract.md), [incremental_refactor_policy.md](../principles/incremental_refactor_policy.md), [localstorage_keys.md](../shared/localstorage_keys.md)

---

## 1. Purpose

- Supabase 着手前に **「どの Phase で何を canonical とみなすか」** を固定する
- runtime 実装が phase をまたいだ判断を即興で行わないよう、各 phase の責務・境界・撤退条件を予め文書化する
- localStorage 正準アーキテクチャ（[student_profile_contract.md](../principles/student_profile_contract.md) §7 / [architecture_rules.md](../principles/architecture_rules.md) §Supabase 移行に向けて）と整合した移行レーンを引く
- 各 feature を **個別タイミング** で持ち上げる前提を明示し、「全機能一括移行」を避ける

このドキュメント自体は **contract 専用** であり、実装着手のスイッチではない。実装着手は feature ごとに別 STEP で起票する。

---

## 2. Current State

- Supabase 実装は未着手（client / schema / env / package いずれも未導入）
- localStorage が **唯一の永続層** であり、すべての feature の canonical store として機能している
- StudentProfile は canonical contract が固定済み（[student_profile_contract.md](../principles/student_profile_contract.md)）
- `lib/*Storage.ts` 群が localStorage 操作の単一窓口になっており、Supabase 置換時の対象範囲は grep 一発で特定可能
- cache / version semantics（`*InputHash`, `sourceHash` 等）は feature 単位で安定済み
- 認証は未導入。user identity に依存した UX は現状ゼロ

つまり **「Phase 0」= localStorage canonical のみ** の状態にある。本ドキュメントが定義する Phase1 はここからの最初の一歩。

---

## 3. Migration Principles

Supabase 移行全体を貫く前提。Phase 横断で守る。

1. **canonical は一度に 1 箇所だけ**。「localStorage と Supabase が同時に canonical」という状態を作らない（mirror 期間は明確に non-canonical 側を mirror と呼ぶ）。
2. **UX は canonical のみで成立する**。mirror 側の成否が UX を壊さない（mirror 失敗時のフォールバック設計を mirror 導入と同じ PR で書く）。
3. **feature 単位で phase を進める**。プロジェクト全体の phase はいきなり上げない。常に「StudentProfile は Phase2 / statement は Phase1」のように **feature × phase の二次元** で管理する。
4. **contract を先に固定する**。実装の都合で phase 定義を変えない。phase 定義を変えるときは本ドキュメントの PR を先に出す。
5. **撤退可能性を維持する**。各 phase は **同 PR 内で revert 可能** な粒度で導入する。Supabase 側の状態を引き返せない形にしない（destructive な migration を phase 進行時に走らせない）。
6. **observability を先行させる**。Phase 進行に先立って mirror 成否 / fallback 発火率を観測できる状態を作る（[ai_usage_observability.md](../principles/ai_usage_observability.md) と同様のスタンス）。

---

## 4. Phase Definitions

各 phase は **feature 単位** で適用される。複数の feature が同時に異なる phase に存在することが前提。

### Phase1: localStorage canonical + Supabase mirror write

**canonical**: localStorage
**Supabase**: write-only mirror（best-effort）
**read 経路**: localStorage のみ

責務:

- canonical 書き込みは従来通り `lib/*Storage.ts` 経由の localStorage 書き込みで完結する
- canonical 書き込みが成功した **後** に、best-effort で Supabase に同等データを mirror する
- mirror helper は canonical 経路の **後段** に置く。canonical 経路の前段で Supabase を触ってはならない（[Runtime Safety Rules](#6-runtime-safety-rules) 参照）
- Supabase 側から **読み出さない**。read は localStorage のみが正
- mirror が失敗しても UX は無傷であり、リトライ責務も持たない（best-effort）
- 失敗は observability 層に記録するに留め、user-visible なエラーを出さない

Phase1 が満たすべき前提（feature が Phase1 に入ってよい条件）:

- 当該 feature の localStorage canonical helper が `lib/*Storage.ts` に集約されている
- restore 動作（reload / cache hit / sourceHash 一致時の振る舞い）が文書化または安定している
- cache / version semantics（`*InputHash`, `sourceHash` 等）が文書化されている
- localStorage 書き込み失敗時の挙動が既知 / 文書化されている

Phase1 の non-goals:

- Supabase からの read
- 認証導入
- localStorage と Supabase の不整合に対する自動 reconciliation
- schema migration の自動生成

### Phase2: localStorage primary + Supabase fallback read

**canonical**: localStorage（primary）
**Supabase**: write mirror + fallback read source
**read 経路**: localStorage を試し、空 / 欠損なら Supabase をフォールバック

責務:

- 書き込み側の責務は Phase1 と同じ（canonical = localStorage、Supabase は best-effort mirror）
- 読み込み時に **localStorage に値が無いケース** で Supabase を二次ソースとして読む（端末乗り換え / cache 退避からの復旧シナリオ）
- Supabase から復元した値は localStorage に書き戻して以降は通常 read 経路に乗せる
- fallback 経路の hit を observability 層で計測する（hit 率が高い ＝ Phase3 移行の判断材料）

Phase2 が満たすべき前提:

- feature が Phase1 で十分な期間運用され、mirror 成功率が安定して高い
- Supabase 側のスキーマが当該 feature の正準型と一致している（type drift がない）
- 認証 / user identity が利用可能（fallback read は「誰の data か」が確定していないと不可）

Phase2 の non-goals:

- Supabase の値を localStorage より優先すること
- localStorage と Supabase の差分検出 / merge UI
- 双方向 sync

### Phase3: Supabase canonical

**canonical**: Supabase
**localStorage**: cache / offline buffer
**read 経路**: Supabase が正。localStorage は cache としてのみ参照

責務:

- canonical 書き込みは Supabase に対して行う
- localStorage は **derived cache** に降格する（[student_profile_contract.md §7](../principles/student_profile_contract.md) のスタンスに整合）
- Supabase 書き込み失敗時の UX 影響を許容範囲内に収める（retry / queue / 明示エラー UI 等を当該 feature の PR で同時に設計する）
- localStorage cache は invalidate / staleness 管理の対象になる

Phase3 が満たすべき前提:

- 認証導入済み
- 当該 feature の Supabase スキーマが本番運用に耐える状態（index / RLS / backup 含む）
- offline / 書き込み失敗時の UX が設計済み

Phase3 の non-goals:

- legacy localStorage key の削除（これは Phase4 で行う）
- 旧データの migration script 自動実行（別 ops タスク）

### Phase4: legacy localStorage removal

**canonical**: Supabase
**localStorage**: legacy key 削除完了
**read 経路**: Supabase のみ

責務:

- 当該 feature の旧 localStorage key を removal フェーズに入れる
- 削除前に「現存ユーザが旧 key だけを持つ可能性」を観測で確認する（移行残存率の確認）
- removal は per-feature で順次行う（プロジェクト全体一括削除はしない）

Phase4 が満たすべき前提:

- Phase3 で十分な期間運用され、Supabase canonical 経路で feature が完結している
- Phase3 期間中に localStorage cache → Supabase の back-sync 経路が一巡している
- 旧 key 残存ユーザに対する救済導線が設計済み（必要な場合）

Phase4 の non-goals:

- 旧 key を読まないが残すという中途半端な状態を長期化させること（残すなら理由を明示し、削除予定日を併記する）

---

## 5. S0 Non-goals

Phase1 着手前の **「S0」期間**（＝本ドキュメントが存在し、実装は未着手な現在の状態）における non-goals。

- Supabase client / package / env / schema の追加
- 任意の runtime コードの変更
- 既存 localStorage key の rename / removal
- `lib/*Storage.ts` の API 改変
- 認証導入
- 「将来 Supabase で使うはず」という理由での先回り抽象化（repository pattern 含む。[architecture_rules.md §Supabase 移行に向けて](../principles/architecture_rules.md) と整合）
- mirror helper の prototype 実装

S0 で許可されるのは **contract 文書（本ドキュメント）の追加・更新のみ**。

---

## 6. Runtime Safety Rules

すべての phase で守る runtime 側の不可侵ルール。Phase1 で特に重要。

1. **canonical 書き込みより前に Supabase を触らない**
   - mirror は canonical 書き込みが成功した **後段** に置く
   - canonical 経路の中に await Supabase を挟まない（latency を canonical に持ち込まない）

2. **mirror 失敗は throw しない**
   - mirror helper は try/catch で吸収し、observability 層へ記録するに留める
   - user-visible なエラー UI / トーストを出さない

3. **mirror は idempotent に書く**
   - 同じ input に対する再 mirror が壊れない設計にする
   - canonical 側の `sourceHash` などを併送して dedup 可能にする

4. **read は phase の宣言通りに限定する**
   - Phase1 では Supabase から読まない（リクエスト送信もしない）
   - Phase2 でも fallback 以外の read 経路を作らない

5. **auth-dependent UX を Phase1 に持ち込まない**
   - Phase1 はログイン無しでも完全に動く前提
   - mirror helper が「user_id が無い場合 no-op」を内部で吸収する

6. **runtime 影響を局所化する**
   - mirror 配線は feature 単位で 1 PR、1 helper、1 call site を原則とする
   - cross-cutting refactor を mirror 導入 PR に同居させない（[incremental_refactor_policy.md](../principles/incremental_refactor_policy.md)）

---

## 7. Naming Conventions

canonical と mirror の責任を **名前で見分けられる** ようにする。read 時に「これは canonical か mirror か」を悩ませない。

許容される命名:

| 用途 | 命名例 | 備考 |
|---|---|---|
| canonical write helper | `saveStudentProfile`, `saveStatementDraft` | 従来通り。canonical ownership を示す |
| canonical read helper | `loadStudentProfile`, `getStudentProfileForFeature` | 従来通り |
| Supabase mirror write helper | `mirrorStudentProfileToSupabase`, `bestEffortMirrorStatement` | best-effort であることを名前で示す |
| Supabase fallback read（Phase2 以降） | `fallbackLoadXxxFromSupabase` | fallback であることを名前で示す |
| Supabase canonical write（Phase3 以降） | `saveXxx`（Supabase 側に責務移動済みの helper として） | Phase3 達成後の話 |

禁止される命名（Phase1 / Phase2 において）:

- `saveXxxToSupabase` — `save` は canonical ownership を強く含意するため mirror に使うと誤読を招く
- `syncXxx` — sync は双方向 / 整合保証を含意するため best-effort mirror には強すぎる
- `persistXxx` — どこに persist するかを曖昧にするため避ける（mirror か canonical かを名前で表現する）

原則: **「`save` / `persist` は canonical 側の語彙、`mirror` / `bestEffort` は副次側の語彙」** として固定する。

---

## 8. Rollout Policy

- **feature-by-feature でロールアウトする**。プロジェクト全体の phase は同時には上げない
- 着手順は **StudentProfile から開始する**。理由:
  - canonical contract が既に固定済み（[student_profile_contract.md](../principles/student_profile_contract.md)）
  - 下流 feature が StudentProfile を読む構造になっているため、StudentProfile を先に持ち上げれば下流 feature の意思決定材料が増える
  - schema を最小（1 entity）から検証できる
- StudentProfile 以降の順序は **canonical helper / restore 挙動 / cache 意味論が文書化または安定している feature** から選ぶ
- ある feature を Phase1 に入れる前提として、以下が **すでに満たされている** こと:
  - canonical helper が `lib/*Storage.ts` に集約されている
  - restore behavior（reload / cache hit / `sourceHash` 一致時等）が文書化または安定している
  - cache / version semantics（`*InputHash`, `sourceHash` 等）が文書化されている
  - 失敗時挙動（localStorage 書き込み失敗 / parse 失敗 / version mismatch）が既知
- 上記を満たさない feature は **Phase1 に入れる前** に該当 docs を整備する（doc-first）
- Phase 進行は **STEP として起票** し、本ドキュメントに該当 STEP 番号を追記する（後追いの履歴で参照可能にする）

---

## 9. Failure Policy

| 失敗種別 | Phase1 の挙動 | Phase2 の挙動 | Phase3 の挙動 |
|---|---|---|---|
| Supabase 書き込み失敗 | 無視（observability 記録のみ）、UX 無傷 | 無視（同上） | 当該 feature の policy に従う（retry / 明示 UI 等） |
| Supabase 読み込み失敗 | 起きない（read しないため） | localStorage 値を継続使用、observability 記録 | 当該 feature の policy に従う（cache 経路 / 明示 UI 等） |
| Supabase 認証失敗 | mirror を no-op として skip（user_id 不明） | fallback read を skip | feature ごとに UX を設計 |
| localStorage 書き込み失敗 | 既存の挙動を維持（Supabase 側を補助使用しない） | 同左 | localStorage は cache 扱いのため挙動緩和可能 |
| Supabase スキーマ mismatch | mirror payload を drop（observability 記録） | fallback 値を drop | 当該 feature の policy に従う |

原則:

- **Phase1 / Phase2 の失敗は UX を壊さない** ことを最優先とする
- 失敗時のリトライ責務を持たない（best-effort の定義そのもの）
- 失敗は observability に蓄積し、Phase 進行判断の材料にする

---

## 10. Backward Compatibility Policy

- localStorage key は Phase1 / Phase2 を通して **削除・rename しない**
- 既存 user の localStorage に残っているデータは **当該 feature が Phase3 に到達するまで** 正準として扱う
- Phase3 到達後も、当該 feature の旧 key からの **一度きりの back-sync 経路** を Phase3 期間内に提供する
- Phase4 に入って初めて旧 key を **削除候補** にする（即削除ではなく、観測で残存率を確認したうえで判断）
- 本ドキュメントで定義した命名規約（`mirrorXxxToSupabase` 等）は **新規 helper にのみ適用** する。既存 helper の rename は Phase 進行とは独立して、必要なときに別 PR で行う
- 既存 cache key の semantics（`*InputHash` の hash 入力など）は Supabase 移行に伴って勝手に変えない

---

## 11. QA / Verification Policy

- Phase1 の導入 PR は **以下の検証** を含む:
  - canonical 書き込み経路の既存挙動が変わっていないことを示す（mirror を無効化した状態と有効化した状態で UX が同一）
  - Supabase 書き込み失敗を **意図的に発生** させた場合に UX が無傷であることを示す
  - mirror helper が canonical 経路の latency / blocking を増やしていないこと
  - 認証無しユーザで mirror が no-op になること
- Phase2 の導入 PR は上記に加え:
  - localStorage 空状態で Supabase fallback が hit し、復元後に localStorage に書き戻されること
  - Supabase fallback 失敗時に localStorage 空状態の UX（空 state UI / re-input 導線）が壊れないこと
- Phase3 の導入 PR は上記に加え:
  - Supabase 書き込み失敗時の UX policy（retry / 明示 UI / queue）が当該 feature 要件に合致していること
- すべての Phase 進行 PR で **observability** に基づく判定材料（mirror 成功率 / fallback hit 率等）を PR description に貼る
- 単体テスト / 統合テストの方針は当該 feature の既存 QA ハーネス（例: `scripts/STEP*` 群）と整合させる

---

## 12. Future TODOs

本ドキュメントの範囲外。Phase 進行と同期して別 STEP として起票する。

- **Phase1 着手用の `supabase` client / env / schema 設計ドキュメント**
  - 本ドキュメントは contract のみ。client / schema の設計は別ファイル（例: `docs/supabase/client_setup.md`, `docs/supabase/schema_overview.md`）で扱う
  - 着手は StudentProfile の Phase1 移行 STEP と同時
- **mirror observability 設計**
  - mirror 成功率 / 失敗種別 / fallback hit 率の集計方法
  - 既存 `ai_usage_observability` 系の枠組みに乗せるか、独立した sink を切るか
- **認証導入計画**
  - Phase2 以降の前提となる user identity の獲得経路
  - 認証導入は単独 STEP として独立させ、phase 進行 PR と混ぜない
- **repository pattern 抽象化の判断**
  - [architecture_rules.md §Supabase 移行に向けて](../principles/architecture_rules.md) の TODO と整合
  - Phase2 か Phase3 のどちらで導入するかは、実装時の感触で判断する（早すぎる抽象化を避ける）
- **`lib/*Storage.ts` の legacy normalization 削除条件**
  - 同上。Phase3 / Phase4 移行時の判断材料を各 storage ファイルにコメントで残す
- **per-feature phase 進行表**
  - 「どの feature が今どの phase にいるか」を一覧できる表を本ドキュメントに追補する（Phase1 が最初の feature に適用された時点で追加）

---

## 締めくくり

Supabase 移行は **「localStorage を捨てて Supabase に置き換える」作業ではなく**、「canonical の所在を feature ごとに段階的に移し替える」作業として進める。
canonical / mirror の責任が名前と phase 定義で明確に分かれている限り、移行は revert 可能な小さな PR の連なりで完了できる。
本ドキュメントは contract であり、各 phase の実装着手スイッチは STEP 単位で別途起票する。
