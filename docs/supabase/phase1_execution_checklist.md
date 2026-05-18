# Phase1 Execution Checklist

PASSAI における Phase1 runtime PR の **着手前ゲート** を規定する運用契約。
本ドキュメントは「mirror PR を出してよい / まだ出してはいけない」を PR レビュー段階で **チェックボックス単位** で判定する根拠として機能する。

関連: [migration_phases.md](./migration_phases.md), [client_boundary.md](./client_boundary.md), [phase1_runtime_strategy.md](./phase1_runtime_strategy.md), [feature_rollout_matrix.md](./feature_rollout_matrix.md), [mirror_observability.md](./mirror_observability.md), [schema_boundary_policy.md](./schema_boundary_policy.md), [student_profile_contract.md](../principles/student_profile_contract.md), [incremental_refactor_policy.md](../principles/incremental_refactor_policy.md)

---

## 1. Purpose

- 最初の mirror PR が起票される **前** に、Phase1 着手の必須前提条件をチェックボックス契約として固定する
- 「docs が揃っている / observability が稼働している / kill-switch が用意されている / rollback 設計が済んでいる」のような **横断前提** を feature ごとに即興判断させない
- mirror PR の **スコープを物理的に制限** することで、観測 / 撤退 / レビューの粒度を維持する
- [phase1_runtime_strategy.md §14](./phase1_runtime_strategy.md) / [feature_rollout_matrix.md §11](./feature_rollout_matrix.md) / [mirror_observability.md §14](./mirror_observability.md) の各規約が **PR 単位で必ず参照される** 状態を作る

本ドキュメント自体は contract / 運用専用であり、PR テンプレート / CI チェック / 自動化ツールの実装は含まない（[§17 Future Runtime TODOs](#17-future-runtime-todos)）。

---

## 2. Current Migration Position

- branch: `feature/supabase-migration`
- Phase: **S0 完了 / Phase1 未着手**
- Supabase 関連 runtime / schema / observability sink いずれも未導入
- 既存 Supabase docs（[§1 関連](#1-purpose)）は揃っており、本ドキュメントは **最後の運用契約レイヤ** として、最初の mirror PR を起票するための直接の入口になる
- 本ドキュメントの完成をもって「Phase1 着手 STEP の起票が可能」な状態になるが、本ドキュメントの完成自体が runtime 実装の開始を意味するわけではない

---

## 3. Checklist Philosophy

このチェックリストを貫く 5 つの哲学。Phase1 期間中、これらが他の判断より優先される。

1. **すべての前提は doc-first**。実装 PR 内で「ついでに docs を整備」しない。前提 docs が無い feature は着手禁止。
2. **チェックボックスは all-pass が default**。1 つでも未充足なら PR を起票しない（部分着手で観測値を取りに行かない）。
3. **happy path で良しとしない**。failure simulation / rollback / kill-switch 動作確認をしていない PR は merge しない。
4. **1 PR = 1 feature の mirror 配線**。横断 refactor / schema 再設計 / 別 feature 着手を mix しない。
5. **rollback は **destructive ではない****。Phase1 PR の rollback は localStorage を消さず、restore semantics を変えず、schema 都合の cleanup を持ち込まない。

これらは [phase1_runtime_strategy.md §3](./phase1_runtime_strategy.md) / [mirror_observability.md §3](./mirror_observability.md) の **PR 着手ゲート** 視点での再宣言。

---

## 4. Required Documentation Preconditions

mirror PR 起票 **前** に揃っているべき docs。**すべて** 充足が必須。

- [ ] [migration_phases.md](./migration_phases.md) が存在し、当該 feature の phase 定義（Phase1）が適用可能であることが本ドキュメントから読み取れる
- [ ] [client_boundary.md](./client_boundary.md) が存在し、Supabase client の境界（boundary file / singleton / browser/server 分離 / env policy）が確定している
- [ ] [phase1_runtime_strategy.md](./phase1_runtime_strategy.md) が存在し、Allowed / Forbidden Runtime Behaviors が確定している
- [ ] [feature_rollout_matrix.md](./feature_rollout_matrix.md) で当該 feature が **Phase1 Eligible** に分類されている
- [ ] [feature_rollout_matrix.md §11 Recommended Rollout Order](./feature_rollout_matrix.md) の **当該 feature の前段順序が完了している**（順序を飛ばさない）
- [ ] [feature_rollout_matrix.md §6](./feature_rollout_matrix.md) の **Blocking Preconditions** 列が当該 feature について空または満たされている
- [ ] [mirror_observability.md](./mirror_observability.md) が存在し、event taxonomy / required fields / status / failure / skip 分類が確定している
- [ ] [schema_boundary_policy.md](./schema_boundary_policy.md) で当該 feature の data layer 判定（canonical / derived / cache / ephemeral）が読み取れる
- [ ] 当該 feature の canonical helper の挙動・restore semantics・cache semantics が `lib/*Storage.ts` 周辺 docs（[storage/README.md](../../lib/storage/README.md), [localstorage_keys.md](../shared/localstorage_keys.md)）で documented または安定
- [ ] StudentProfile を読む側の feature を対象とする場合、[student_profile_contract.md](../principles/student_profile_contract.md) の関連条項（§5 更新ポリシー / §7 cache / §8 downstream feature rule）と矛盾しない設計であることが PR description に書ける状態

未充足項目がある場合、**まず該当 docs PR を起票** する。docs PR と mirror PR を 1 PR で同時提出しない（[§14 PR Scope Restrictions](#14-pr-scope-restrictions)）。

---

## 5. Required Runtime Safety Preconditions

runtime safety に関する前提。mirror PR 起票時にすべて充足が必須。

- [ ] boundary file の物理パス・export 関数名が確定している（[client_boundary.md §4](./client_boundary.md) / §5 / §8）
- [ ] mirror helper の物理配置・命名規約が確定している（[client_boundary.md §10](./client_boundary.md), [migration_phases.md §7](./migration_phases.md): `mirrorXxxToSupabase` / `bestEffortMirrorXxx`）
- [ ] env 取得経路が boundary file 内に閉じる設計になっている（[client_boundary.md §7](./client_boundary.md)）
- [ ] mirror 起動位置が **canonical 書き込み成功後** であることが PR description に明記されている（[phase1_runtime_strategy.md §7](./phase1_runtime_strategy.md)）
- [ ] mirror helper が **fire-and-forget** で起動される設計になっている / await 結果で UI 判定しないことが明示されている
- [ ] mirror helper が **idempotent**（同一 input の再呼び出しが壊れない）であることが PR description に書かれている
- [ ] auth 未確定時に mirror が **no-op skip** することが確認可能な実装
- [ ] env 未定義時に mirror が **no-op skip** することが確認可能な実装
- [ ] mirror 経路が **canonical 経路の latency を増やさない** ことが確認可能な実装

未充足のまま PR を進めない。1 つでも未充足の場合は前段 STEP（boundary file 設計 / mirror helper skeleton 設計）を独立 PR として先に出す。

---

## 6. Required Observability Preconditions

observability に関する前提。mirror PR 起票時にすべて充足が必須。

- [ ] observability sink の物理配置（既存 AI 観測枠統合 / 独立 sink）が確定している（[mirror_observability.md §11](./mirror_observability.md)）
- [ ] `mirror.attempt` event の required fields（[mirror_observability.md §6](./mirror_observability.md)）が enum / 型として整備済み
- [ ] `mirrorStatus` の 4 status（`success` / `failure` / `skipped` / `disabled`）が固定済み（[mirror_observability.md §7](./mirror_observability.md)）
- [ ] `failureReason` 8 分類が固定済み（[mirror_observability.md §8](./mirror_observability.md)）
- [ ] `skipReason` 6 分類が固定済み（[mirror_observability.md §9](./mirror_observability.md)）
- [ ] canonical success と mirror success が **別 field** で記録される設計になっている（[mirror_observability.md §4](./mirror_observability.md)）
- [ ] observability sink への書き込みが **fire-and-forget** であり、失敗が mirror helper / canonical helper の挙動を変えない
- [ ] PII を field に含まない設計が確認可能（[mirror_observability.md §6](./mirror_observability.md)）
- [ ] sink 稼働確認（development / preview 環境で event が記録されることの確認）が PR description に書ける状態

最初の mirror PR（StudentProfile）の **直前 PR** として observability sink 設計 PR が **独立して** merge 済みであること（[feature_rollout_matrix.md §11 Order 0](./feature_rollout_matrix.md)）。

---

## 7. Required Kill-switch Preconditions

kill-switch に関する前提。mirror PR 起票時にすべて充足が必須。

- [ ] kill-switch の実装方式（env / runtime config / feature flag service）が確定している（[mirror_observability.md §13](./mirror_observability.md)）
- [ ] kill-switch が **feature 単位 / environment 単位 / global** の 3 粒度で操作可能
- [ ] kill-switch ON 時、mirror helper が **即時** `disabled` を返す
- [ ] kill-switch ON 時、canonical helper の戻り値 / latency / 例外契約が **一切変わらない**
- [ ] kill-switch ON 時、`mirror.control` event が observability sink に記録される
- [ ] kill-switch の **ON/OFF 切替手順** が ops 用 docs / PR description に書かれている
- [ ] kill-switch OFF 戻しが **段階的**（feature → environment → global の逆順）で運用可能
- [ ] kill-switch を **発動する判断基準**（mirror 失敗率閾値 / unknown 比率閾値 / canonical UX 劣化検知）が PR description に書かれている

kill-switch が用意されていない feature の mirror 配線は **Phase1 では着手禁止**。Phase1 の哲学は「kill-switch を恐れず使う」前提で運用される（[mirror_observability.md §13](./mirror_observability.md)）。

---

## 8. Required Hydration Safety Verification

hydration safety の検証項目。mirror PR レビュー時にすべて確認が必須。

- [ ] mirror 起動が **render 関数本体に置かれていない**（[phase1_runtime_strategy.md §12](./phase1_runtime_strategy.md)）
- [ ] mirror 起動が **server component / route handler から起動されていない**（Phase1 のスコープ外）
- [ ] mirror 起動が **hydration 完了前の同期 effect に置かれていない**
- [ ] mirror 配線が **mount 順序依存** を生まないことが diff レビューで確認できる
- [ ] mirror 起動の `useEffect` 依存配列に Supabase state が含まれていない
- [ ] mirror 導入によって既存の hydration-safe restore（例: basicInfo の subjectGrades hydration-safe restore）の挙動差分が無いことが確認できる
- [ ] SSR / RSC から browser boundary file を import していない（[client_boundary.md §5](./client_boundary.md)）
- [ ] mirror 配線で `"use client"` 境界が新規に動かされていない / または動かす場合は別 PR で先に分離している

reviewer は diff の **import 経路と effect 依存配列を必ず読む**。hydration mismatch のリスクは PR description だけでは判断できない。

---

## 9. Required Restore Semantics Verification

restore semantics の保護確認。mirror PR レビュー時にすべて確認が必須。

- [ ] restore 経路（reload / cache hit / `sourceHash` 一致時 / mount 直後 hydration）が **canonical (localStorage) のみ** から復元される（[phase1_runtime_strategy.md §10](./phase1_runtime_strategy.md)）
- [ ] restore 経路から Supabase 呼び出しが **一切追加されていない**
- [ ] restore のタイミング（mount / effect / hydration 完了直後）が **既存挙動と同一**
- [ ] restore 結果に Supabase 由来の値が混ざっていない
- [ ] mirror 導入 PR が restore 経路のコードを **触る場合**、変更が mirror に必要な最小限であり、restore semantics の挙動差分が無いことが PR description に明示されている
- [ ] restore と mirror が **同一 helper / 同一ファイル** に同居していない（[client_boundary.md §10](./client_boundary.md), [phase1_runtime_strategy.md §16](./phase1_runtime_strategy.md)）
- [ ] 既存 user の localStorage を mirror に **back-fill** する behavior が含まれていない（[phase1_runtime_strategy.md §10](./phase1_runtime_strategy.md)）

restore semantics の変化は **手動 QA でも気付きにくい**。差分が小さく見えても review 段階で必ず確認する。

---

## 10. Required Cache Semantics Verification

cache semantics の保護確認。mirror PR レビュー時にすべて確認が必須。

- [ ] cache hit / miss 判定が **localStorage の状態のみ** から決まる設計が変更されていない（[phase1_runtime_strategy.md §11](./phase1_runtime_strategy.md)）
- [ ] cache validity が mirror 成否に依存しない（mirror 失敗を理由に cache invalidate していない / `*InputHash` を変えていない）
- [ ] cache hit 経路で Supabase が呼ばれていない
- [ ] `sourceHash` の手動偽装を mirror 都合で行っていない（[student_profile_contract.md §11 Anti-pattern](../principles/student_profile_contract.md)）
- [ ] canonical sync（cache hit 経路での StudentProfile patch 等、[student_profile_contract.md §5.4](../principles/student_profile_contract.md)）の責務が維持されている
- [ ] cache 自体の mirror を **Phase1 で追加していない**（`*InputHash` 系すべて、[feature_rollout_matrix.md §12](./feature_rollout_matrix.md) / [schema_boundary_policy.md §6](./schema_boundary_policy.md)）
- [ ] cache 経路の挙動を変える changes が **mirror PR と同 PR に混じっていない**

cache 経路を **「ついでに」整理する** ことは禁止。cache 関連の改善は別 STEP として独立 PR で扱う。

---

## 11. Required Failure Simulation

failure simulation の実施項目。mirror PR レビュー時にすべて確認が必須。**happy path テストのみで PR を merge しない**。

各 simulation について「UX 無傷 / canonical 経路無傷 / observability sink に適切な event 記録 / mirror 状態の expected status」が確認できる必要がある。

| simulation | 確認すべき結果 | 対応する `mirrorStatus` | 対応する `failureReason` / `skipReason` |
|---|---|---|---|
| **missing env**（Supabase URL / key が未設定） | UX 無傷 / canonical 完動 / mirror skip | `skipped` または `failure` | `skipReason = mirror_disabled` / `failureReason = missing_env` |
| **Supabase unavailable**（client 生成失敗 / DNS 不能） | UX 無傷 / canonical 完動 / mirror failure 記録 | `failure` | `failureReason = client_unavailable` または `network_error` |
| **network failure**（fetch 失敗 / TLS 失敗） | UX 無傷 / canonical 完動 / mirror failure 記録 | `failure` | `failureReason = network_error` |
| **mirror timeout**（応答遅延 / abort） | UX 無傷 / canonical latency 無加算 / mirror failure 記録 | `failure` | `failureReason = network_error` （またはより具体的な分類） |
| **mirror disabled**（kill-switch ON） | UX 無傷 / canonical 完動 / mirror が即時 `disabled` を返す / `mirror.control` event 記録 | `disabled` | n/a |
| **unsupported environment**（SSR / RSC からの誤起動） | UX 無傷 / canonical 完動 / mirror skip | `skipped` | `skipReason = unsupported_environment` |

ルール:

- 各 simulation は **手動 QA / 自動テスト / フィーチャーフラグ操作** のいずれかで再現可能であること
- simulation 結果が PR description に **status 値とともに記録** されていること（「動きました」では不可）
- simulation 中に user-visible エラー（toast / alert / loading state）が発生した場合、PR は merge 不可
- mirror retry / backoff の挙動が観測されないこと（Phase1 では retry 禁止、[phase1_runtime_strategy.md §9](./phase1_runtime_strategy.md)）

---

## 12. Required Naming Verification

命名規約の確認。mirror PR レビュー時にすべて確認が必須。

- [ ] mirror helper 名が `mirrorXxxToSupabase` / `bestEffortMirrorXxx` パターンを採用している（[client_boundary.md §10](./client_boundary.md), [migration_phases.md §7](./migration_phases.md)）
- [ ] mirror helper 名に `save` / `persist` / `sync` を **使っていない**（canonical ownership / 双方向 sync を含意するため）
- [ ] canonical helper（`lib/*Storage.ts` の `saveXxx` / `loadXxx` 等）が rename されていない
- [ ] boundary file 名 / export 関数名が [client_boundary.md §4](./client_boundary.md) / §5 / §8 の規約と整合している（browser/server 分離 / singleton getter）
- [ ] env 名（`process.env.SUPABASE_*` / `process.env.NEXT_PUBLIC_SUPABASE_*`）が boundary file 内のみで参照されている
- [ ] 新規 event field / status 値 / 分類 enum が [mirror_observability.md §6 / §7 / §8 / §9](./mirror_observability.md) の正本と一致

命名違反は **後から rename しない**。`save`/`persist`/`sync` で merge してしまうと、後段の reader が canonical ownership を誤読する経路が増える。

---

## 13. Required Rollback Planning

rollback 計画の事前定義。mirror PR レビュー時にすべて確認が必須。

各 PR は以下を **PR description に明記** する:

- [ ] rollback 手順（revert / kill-switch ON / feature flag OFF のうち何を使うか）
- [ ] rollback 後の expected state（mirror 0 件 / canonical 完動 / observability event は `disabled` のみ等）
- [ ] rollback が **localStorage data を破壊しない** ことの確認
- [ ] rollback が restore semantics / cache semantics を **変えない** ことの確認
- [ ] rollback が **schema-coupled な cleanup を要求しない** ことの確認（schema migration 削除 / table drop を rollback 前提にしない）
- [ ] rollback トリガ条件（観測値の閾値 / canonical UX 劣化検知 / 失敗種別の `unknown` 比率超過）
- [ ] rollback を発動する **判断者と判断時間枠**

rollback の哲学:

- **destructive ではない**（[§3 Philosophy](#3-checklist-philosophy)）。Supabase 側に書かれた mirror data を rollback で削除しない（観測対象として残す）
- **localStorage data を preserve**（mirror 失敗を理由に canonical を消さない、[phase1_runtime_strategy.md §16](./phase1_runtime_strategy.md)）
- **schema-coupled な仮定を持ち込まない**（rollback 時に schema migration を逆向きに走らせる前提を作らない）
- **revert 可能粒度**（mirror 配線 1 件の revert で完結する PR 構造であること、[migration_phases.md §3 原則 5](./migration_phases.md)）

---

## 14. PR Scope Restrictions

PR スコープの物理制限。違反 PR は **size に関わらず reject 対象**。

1 PR が **同時に行ってはならない** こと:

- 複数の **high-risk feature** の mirror 配線（[feature_rollout_matrix.md §4.5](./feature_rollout_matrix.md) の Migration Risk = high が 2 件以上）
- 複数 feature の同時 mirror 化（**1 PR = 1 feature**、[phase1_runtime_strategy.md §14](./phase1_runtime_strategy.md)）
- **Phase2 fallback read** の準備配線（[phase1_runtime_strategy.md §6](./phase1_runtime_strategy.md)）
- **auth-coupled UX** の導入（ログイン UI / user_id 必須化 / mirror 失敗の user-visible 化、[phase1_runtime_strategy.md §16](./phase1_runtime_strategy.md)）
- **schema 再設計** と mirror 配線の同居（schema は別 PR、[schema_boundary_policy.md §11](./schema_boundary_policy.md)）
- **cross-cutting refactor**（`lib/*Storage.ts` の API 整理 / 命名統一 / legacy normalization 撤去）の混入（[incremental_refactor_policy.md](../principles/incremental_refactor_policy.md)）
- observability sink の **初期構築** と feature mirror 配線の同居（sink 設計は order 0 として独立 PR）
- kill-switch の **初期実装** と feature mirror 配線の同居（kill-switch 整備は前段 PR で完了）
- canonical helper の **rename / signature 変更** と mirror 配線の同居
- docs PR と mirror PR の同居（[§4](#4-required-documentation-preconditions)）

許容される範囲:

- **1 feature × mirror 配線 1 件 × boundary 経由の最小 diff**
- 当該 feature の mirror に **直接必要な型定義 / event 配線**（runtime 改変を生じない補助変更）
- 当該 feature の **failure simulation** 用の最小限のテスト追加

「small PR とは何件か」は **diff 行数ではなく責務単位** で判断する。3 行でも横断 refactor が混じれば reject、300 行でも 1 feature の mirror 配線で閉じていれば accept しうる。

---

## 15. Feature Graduation Rules

feature の進行段階。[mirror_observability.md §14 Rollout Gate Usage](./mirror_observability.md) と同期して運用する。

| stage | 名称 | 進行条件 | 本ドキュメントでの該当チェック |
|---|---|---|---|
| 0 | **not mirrored** | docs preconditions ([§4](#4-required-documentation-preconditions)) を満たさない / order 待ち | docs 整備中の feature がここ |
| 1 | **dev-only mirror** | docs / runtime safety / observability / kill-switch / rollback の全前提 ([§4](#4-required-documentation-preconditions) – [§7](#7-required-kill-switch-preconditions), [§13](#13-required-rollback-planning)) 充足 | development / preview 環境で sink に event 記録、production は kill-switch ON |
| 2 | **limited mirror** | dev-only mirror で hydration / restore / cache / failure simulation の verification ([§8](#8-required-hydration-safety-verification) – [§11](#11-required-failure-simulation)) すべて pass、observability 値が想定範囲内 | production で段階的に enable（environment / feature flag による限定） |
| 3 | **Phase1 stable mirror** | limited mirror で **canonical UX 劣化なし / `unknown` 比率閾値以下 / kill-switch を発動せず運用可能** な期間を経過 | production 全試行で mirror 稼働。Phase1 卒業判断材料 |

ルール:

- stage 進行は **per-feature**。同 stage に複数 feature が並ぶことを許容
- stage 後退（例: stage 3 → stage 2 / stage 1）も observability 値に基づいて **積極的に行う**（kill-switch と並ぶ正常運用ツール、[mirror_observability.md §13](./mirror_observability.md)）
- stage 進行 / 後退の **具体閾値**（成功率 % / unknown 比率 % / 観測期間日数）は [mirror_observability.md §14 / §16](./mirror_observability.md) で確定する
- stage 進行に **observability 以外の根拠**（「実装が落ち着いたから」「他チームから希望があったから」）を用いない
- 高リスク feature（AI restore flows）は **stage 1 / stage 2 で停止判断** することも明示的に許容（Phase1 卒業を待つ必要はない）

stage 表示は PR description / 観測ダッシュボードで参照可能であること。

---

## 16. Anti-patterns

PR 起票 / レビュー段階での **境界違反**。reject の根拠とする。

- **「happy path で works」で merge**
  - 例: success ケースのみ確認、failure simulation を省略
  - 理由: Phase1 の哲学は失敗時の UX 無傷を保証することにある
- **mirror success のみをテスト**
  - 例: failure / skip / disabled の挙動を確認しない
  - 理由: 観測値の母数が偏り、Phase 進行判断ができなくなる
- **PR scope explosion**
  - 例: 「mirror PR のついでに `lib/*Storage.ts` を整理した」「ついでに schema を redesign した」
  - 理由: 撤退 / 観測 / レビュー粒度を破壊（[§14](#14-pr-scope-restrictions)）
- **hidden canonical shift**
  - 例: mirror PR の中で canonical helper の戻り値型 / 例外契約 / signature を変える
  - 理由: canonical ownership semantics を runtime PR で暗黙に動かす（[phase1_runtime_strategy.md §4](./phase1_runtime_strategy.md)）
- **retry-loop introduction**
  - 例: mirror failure を見て exponential backoff retry / queue を実装
  - 理由: Phase1 では retry を実装しない（[phase1_runtime_strategy.md §9](./phase1_runtime_strategy.md)）。retry で観測を曇らせない
- **Supabase 読み出しを「temporarily」追加**
  - 例: 「動作確認のため一時的に Supabase から読み出してみる」
  - 理由: Phase1 read 経路は localStorage 一択。temporary な逸脱は Phase2 越境
- **production users を observability strategy として使う**
  - 例: dev / preview で simulation せず、production で観測しながら問題を検出
  - 理由: production user に detectable な不具合を出してから直すのは Phase1 の UX 無傷哲学に反する
- **kill-switch を escalation 専用にする**
  - 例: kill-switch ON を「最後の手段」「事故」「敗北」として扱う
  - 理由: Phase1 では kill-switch は **default operating tool**（[§3](#3-checklist-philosophy), [mirror_observability.md §13](./mirror_observability.md)）
- **docs PR と mirror PR を 1 PR で同時提出**
  - 例: docs 整備が未済の feature について「docs と実装を同時に出します」と起票
  - 理由: doc-first の意味が消える。docs は実装 PR 着手 **前** に merge されている必要がある
- **rollback を schema-coupled にする**
  - 例: 「rollback したら schema migration も逆向きに走らせる」
  - 理由: rollback の destructive 化 / 副作用が増える（[§13](#13-required-rollback-planning)）
- **stage 進行を観測値以外で正当化**
  - 例: 「もう十分動いているから stage 3 にしたい」「実装者の体感では問題ない」
  - 理由: 観測値以外を Phase 進行判断に用いない（[§15](#15-feature-graduation-rules)）
- **simulation 結果を PR description に貼らない**
  - 例: 「動作確認しました」のみで status 値や observability event を貼らない
  - 理由: reviewer が再確認できない / 後段 PR の判断材料にならない

---

## 17. Future Runtime TODOs

本ドキュメントの範囲外。Phase1 着手 STEP 以降で順に消化する。

- **PR テンプレート化**: 本ドキュメントの §4 – §13 のチェックリストを `.github/pull_request_template.md` 等に翻訳する（doc-first を保つため、テンプレ更新は本ドキュメント更新を先行）
- **CI チェック**: 命名規約違反（`save*ToSupabase`, `*Save`系の mirror helper など）の grep ベースチェックを CI に組み込む
- **kill-switch 操作 docs**: kill-switch の物理操作手順 / 判断フロー / 通知経路を別ドキュメント候補（仮: `docs/supabase/kill_switch_runbook.md`）で扱う
- **simulation 自動化**: 6 種の failure simulation（[§11](#11-required-failure-simulation)）を自動テスト化する方針
- **rollback 自動化**: revert / kill-switch ON / feature flag OFF のうちどこまで CI 化するかの判断
- **stage 進行の dashboard 化**: feature × stage の現在地を一覧できるダッシュボード（[mirror_observability.md §16](./mirror_observability.md) と同期）
- **Phase2 着手前チェックリスト**: 本ドキュメントの後継（仮: `docs/supabase/phase2_execution_checklist.md`）として、fallback read PR 用の前提条件を起票
- **既存 AI 観測枠との PR description 整合**: AI 関連 PR と mirror PR の PR description テンプレ統合可否の判断

---

## 締めくくり

Phase1 の事故の多くは **「チェックを 1 項目飛ばした」** ことから起きる。
docs が揃わないまま着手した / observability sink が無いまま観測すべき値を取り損ねた / failure simulation を省いて happy path のみで merge した / rollback を考えずに mirror を有効化した — いずれも **着手前ゲート** で防げる。
本ドキュメントの checklist は単なる文書ではなく、**最初の mirror PR を起票する前に走らせる門番** として機能することで初めて意味を持つ。
all-pass でない feature は Phase1 に入れない、1 PR = 1 feature を守る、kill-switch を恐れず使う — この 3 つが Phase1 全体の予測可能性を支える。
