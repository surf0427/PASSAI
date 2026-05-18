# Supabase Feature Rollout Matrix

PASSAI における Phase1 (localStorage canonical + Supabase best-effort mirror) の **feature 移行順序・リスク分類** を、最初の mirror PR が書かれる **前** に固定する。
本ドキュメントは「どの feature が安全に持ち上がるか / どの feature を保留すべきか」を PR レビューで即判断するための根拠リストとして機能する。

関連: [migration_phases.md](./migration_phases.md), [client_boundary.md](./client_boundary.md), [phase1_runtime_strategy.md](./phase1_runtime_strategy.md), [student_profile_contract.md](../principles/student_profile_contract.md), [localstorage_keys.md](../shared/localstorage_keys.md), [storage/README.md](../../lib/storage/README.md)

---

## 1. Purpose

- Phase1 移行を **feature 単位の risk 分類** に基づいて順序付け、観測値が積み上がるまで高リスク feature を保留する
- 「人気がある」「最近触ったから」「実装しやすい」といった **risk 以外の動機** で移行順が決まる事故を防ぐ
- StudentProfile を起点に「canonical helper の安定度 / restore 複雑度 / cache 結合度 / AI 依存度 / hydration 感度」を一覧化し、各 PR が **どの feature を / いつ持ち上げるか** を本ドキュメントから引ける状態にする
- [phase1_runtime_strategy.md §14 Feature Rollout Order](./phase1_runtime_strategy.md) の rollout 規約に対する **具体 feature リスト** を提供する

本ドキュメント自体は contract / planning 専用であり、実装は行わない。本ドキュメントの分類は実装着手の前提情報として参照される。

---

## 2. Current Migration Position

- branch: `feature/supabase-migration`
- Phase: **Phase1 着手中 — 第1 mirror (StudentProfile) + 第2 mirror (basicInfo, direct-PII strip) + 第3 mirror (diagnosis, no-PII) + 第4 mirror (activityData, narrative-soft PII / submit-driven) 配線済 / 観測 sink (`mirror_events`) 配線済 / **全 4 mirror table DDL が `schema.sql` §2–§15 にコミット済** (Supabase project への実 apply は operator 操作)**
- 残りの mirror は本 matrix の Recommended Order に従って段階的に追加する。観測値の蓄積が次 mirror 着手判断のインプット
- canonical 永続層: localStorage 一択。窓口は `lib/*Storage.ts` 群（[storage/README.md](../../lib/storage/README.md)）
- 認証は未導入。anonymous で全 feature が完動
- 本ドキュメントは「次に書かれる mirror PR」が **どの feature** を対象にすべきかを決めるためのインプット

---

## 3. Matrix Philosophy

5 つの哲学を貫く。Phase1 期間中、これらが他の判断より優先される。

1. **localStorage semantics が安定している feature から持ち上げる**。`*Storage.ts` の API / 形式 / 失敗挙動が現に変動していない feature が先。
2. **restore semantics が複雑な feature は後回し**。reload / cache hit / hydration / sourceHash 同期の絡む経路は mirror 配線で副作用が出やすい。
3. **AI 出力を含む canonical artifact + cache の同居 feature は高リスク**。cache 経路を踏みやすく、`cache validity must remain independent from mirror state` (`phase1_runtime_strategy.md §11`) との衝突点が増える。
4. **hydration-sensitive feature は高リスク**。SSR / hydration mismatch / mount 順序依存を持つ feature では mirror 起動位置のミスが UX に直結する。
5. **observability readiness が無い feature は持ち上げない**。観測不能な mirror は Phase 進行判断の入力にならないため、観測 sink 整備前の追加 mirror を許さない。

これらは [phase1_runtime_strategy.md §3 Phase1 Runtime Philosophy](./phase1_runtime_strategy.md) を「feature 選定」視点で再宣言したもの。

---

## 4. Risk Classification Definitions

5 つの軸で feature を採点する。

### 4.1 Hydration Sensitivity（low / medium / high）

- **low**: SSR / hydration 経路に関与しない / 単純な input form / mount 後の effect でしか read されない
- **medium**: page mount 直後の effect で復元するが、hydration mismatch リスクが小さい
- **high**: hydration-safe restore が明示的に設計済み（mount 順序依存を持つ）/ 複数 storage を mount 後の同期で組み上げる

### 4.2 Restore Complexity（low / medium / high）

- **low**: 単一 key の取り出し / 単純 JSON parse / 失敗時は空 state
- **medium**: 複数 key の組み合わせ / version migration / fallback 分岐あり
- **high**: cache 経路と canonical sync が交錯 / `sourceHash` 整合保証 / AI 出力との差分検知あり

### 4.3 Cache Coupling（low / medium / high）

- **low**: cache key を持たない / hash-based cache を介在させない
- **medium**: daily limit / 履歴のような append-only cache に依存
- **high**: `*InputHash` 型の hash-cache で hit/miss が UX に直結 / cache hit 時の canonical sync 責務あり

### 4.4 AI Dependency（low / medium / high）

- **low**: AI 出力を保存しない（ユーザ手入力のみ）
- **medium**: AI 出力を保存するが、画面遷移完了後の append のみ
- **high**: AI 出力を含む canonical artifact が下流 feature に読まれる（StudentProfile 等への波及あり）

### 4.5 Migration Risk（low / medium / high）

上記 4 軸の総合判定。`high` が 1 つでも含まれれば原則 **medium 以上**、`high` が 2 つ以上含まれれば **high** とする。Phase1 では low → medium → high の順に持ち上げる。

---

## 5. Rollout Priority Rules

順序固定の運用ルール。

1. **必ず StudentProfile から開始する**（[phase1_runtime_strategy.md §14](./phase1_runtime_strategy.md) と整合）。canonical contract が固定済み（[student_profile_contract.md](../principles/student_profile_contract.md)）であり、下流 feature が読む側であるため。
2. **同一 risk 段階の中では「canonical helper の単一窓口化が完了している feature」を優先**する。`lib/*Storage.ts` 単一窓口になっていない feature（例: `matchingResult` / `matchingTimestamp` が `app/admission-matching/page.tsx` に直書き）は事前整理を Phase1 mirror 着手の **前** に別 STEP で行う。
3. **AI restore flows / hash-cache feature は Phase1 後期** に回す。Phase1 前期の観測値（mirror 成功率 / 失敗分類 / 起動率）が揃ってから着手する。
4. **schema 完成度を順序付けの第一指標にしない**。schema は feature 移行に追随して個別に書き起こす（schema 完成を待って rollout 順を変えない）。
5. **Phase2 (fallback read) を見込んだ準備配線は順序付けに含めない**（[phase1_runtime_strategy.md §6](./phase1_runtime_strategy.md) と整合）。
6. **observability sink 未整備の段階で持ち上げてよいのは StudentProfile + observability sink 設計 PR まで**。それ以降の feature は sink 稼働後に着手する。

---

## 6. Feature Rollout Matrix

「現状」スナップショット。各セルは Phase1 着手前の評価であり、Phase1 観測値・docs 整備状況に応じて [§14](#14-future-re-evaluation-rules) のルールで再評価される。

凡例: H=high / M=medium / L=low

| # | Feature / Domain | Current Canonical Source | Hydration Sensitivity | Restore Complexity | Cache Coupling | AI Dependency | Migration Risk | Phase1 Eligibility | Recommended Order | Blocking Preconditions | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **StudentProfile** | `lib/studentProfileStorage.ts` (`studentProfile`) | M | M | L | M | **Low** | Eligible (first) | 1 | boundary file / mirror helper 設計の決定 (`client_boundary.md §4 / §10`) | canonical contract 固定済み ([student_profile_contract.md](../principles/student_profile_contract.md))。下流 feature が読む側 |
| 2 | **basicInfo** | `lib/basicInfoStorage.ts` (`basicFormData`) | L | L | L | L | **Low** | Eligible | 2 | observability sink 稼働 | 純粋な input form。legacy normalization あり（[architecture_rules.md §Supabase 移行に向けて](../principles/architecture_rules.md)）。**PII**: mirror payload は `name` を strip — raw user-supplied name は Phase1 anonymous 完動の下 browser を出ない（[basic_info_mirror_schema_preview.md §6](./basic_info_mirror_schema_preview.md)）|
| 3 | **activityData (form-side)** | `lib/activityStorage.ts` (`activityFormData`) | L | L | L | L | **Low** | **Wired (4th mirror, submit-driven)** | 3 | — | 入力途中の form state。AI 出力は含まない。**Narrative-soft PII mirror precedent** — direct-PII field 無し / 但し narrative free-text (clubName / theme / description / achievement 等) は contextual identity を持つ ([`activity_mirror_schema_preview.md §6`](./activity_mirror_schema_preview.md))。`shouldUpdateActivityData` + `lastSavedJson` dedup gate landed (STEP-PHASE1L)、mirror dispatch は `handleSubmit` のみ (STEP-PHASE1M / N)、autosave 経路には乗らない。schema は [`activity_mirror_schema_preview.md`](./activity_mirror_schema_preview.md) で apply 待ち |
| 4 | **diagnosis result** | `lib/diagnosisStorage.ts` (`passai_diagnosis_result`) | L | L | L | L | **Low** | **Wired (3rd mirror)** | 4 | — | LP → 診断 → 結果動線の再訪復元用。**No-PII mirror precedent** — payload に user 自由記述ゼロ（answers=numeric index / resultType=enum / title/description=app-authored static）。schema は [`diagnosis_mirror_schema_preview.md`](./diagnosis_mirror_schema_preview.md) で apply 待ち |
| 5 | **selfPR drafts (selfPRs)** | `lib/selfPRStorage.ts` (`selfPRs`) | L | L | L | L | **Low** | Eligible | 5 | observability sink 稼働 | 自己 PR 一覧（save / list） |
| 6 | **selfPR_draft (raw string)** | `lib/selfPRDraftStorage.ts` (`selfPR_draft`) | L | L | L | L | **Low** | Eligible | 5 | raw string mirror の schema 表現方針確定 | 既存例外 raw string ([storage/README.md](../../lib/storage/README.md))。schema 表現を別途決定 |
| 7 | **statementDraft (本文)** | `lib/statementStorage.ts` (`statementDraft`) | L | M | L | L | **Low** | Eligible | 6 | legacy normalization の扱い決定 | 本文 text。legacy 正規化が同 storage 内にある |
| 8 | **statement_prepare_answers (入力 3 項目)** | `lib/statementPrepareStorage.ts` (`statement_prepare_answers`) | L | L | L | L | **Low** | Eligible | 7 | observability sink 稼働 | ユーザ手入力 3 項目 |
| 9 | **interviewDraft (form 入力途中)** | `lib/interviewDraftStorage.ts` (`interviewDraft`) | L | L | L | L | **Low** | Eligible | 7 | observability sink 稼働 | 面接記録フォームの入力途中 |
| 10 | **admission matching input/result** | `lib/admissionMatchingStorage.ts` (`admissionMatchingInput`, `admissionMatchingResult`) | M | M | L | M | **Medium** | Eligible (後期) | 8 | 直書き 2 key (`matchingResult`/`matchingTimestamp`) の `lib/` 集約 (TODO) | TODO 未消化: 直書き 2 key の集約が前提 ([storage/README.md](../../lib/storage/README.md)) |
| 11 | **interview_records (履歴)** | `lib/interviewRecordStorage.ts` (`interview_records`) | L | M | M | M | **Medium** | Eligible (後期) | 9 | append-only mirror の冪等性設計確定 | 履歴 list。AI 出力含むが append のみ |
| 12 | **statementReviewHistory** | `lib/statementStorage.ts` (`statementReviewHistory`) | L | M | M | H | **Medium-High** | Conditional | 10 | 観測安定 + StudentProfile / statement-review cache との因果関係文書化 | AI 添削履歴。cache (`statementReviewInputHash`) と分離して扱う |
| 13 | **essayPracticeData (進捗)** | `lib/essayPracticeStorage.ts` (`essayPracticeData`) | M | M | L | M | **Medium** | Eligible (後期) | 10 | essay 動的テーマ系の hydration 経路文書化 | 多段フローの進捗 state |
| 14 | **essayPracticeReview** | `lib/essayPracticeStorage.ts` (`essayPracticeReview`) | M | M | M | H | **High** | Deferred | 12 | StudentProfile + cache mirror 設計確定 | AI 出力 + 多段フロー結合 |
| 15 | **wallHittingResult (壁打ち分析結果)** | `lib/wallHittingStorage.ts` (`wallHittingResult`) | H | H | H | H | **High** | Deferred | 13 | StudentProfile mirror 観測安定 + cache mirror 方針確定 | StudentProfile canonical の **派生元 raw**。下流に直流させない契約 ([student_profile_contract.md §3](../principles/student_profile_contract.md)) |
| 16 | **analyzeState (壁打ちセッション)** | `lib/analyzeStorage.ts` (`analyzeState`) | H | H | M | H | **High** | Deferred | 13 | 同上 + working memory mirror 方針判断 | 壁打ち working state。mirror すべきか自体を Phase2 で判断 |
| 17 | **statement_prepare_summary + follow-up answers** | `lib/statementPrepareStorage.ts` (`statement_prepare_summary`, `statementPrepareFollowUpAnswers`) | M | H | M | H | **High** | Deferred | 11 | StudentProfile mirror 観測安定 | AI 出力 5 項目 + 弱点別深掘り回答 |
| 18 | **summarizeCache** | `lib/summarizeCache.ts` (`summarizeInputHash`) | M | H | H | H | **High** | Deferred (Phase1 原則対象外) | — | cache mirror の必要性判断（Phase2 以降） | [phase1_runtime_strategy.md §11](./phase1_runtime_strategy.md) に基づき Phase1 では原則 mirror しない |
| 19 | **additionalQuestionsCache** | `lib/additionalQuestionsCache.ts` (`additionalQuestionsInputHash`) | M | H | H | H | **High** | Deferred (Phase1 原則対象外) | — | 同上 | 同上 |
| 20 | **statementReviewCache** | `lib/statement/review/statementReviewCache.ts` (`statementReviewInputHash`) | M | H | H | H | **High** | Deferred (Phase1 原則対象外) | — | 同上 | STEP-F (v5) で canonical `studentProfile` 一本化済み |
| 21 | **essayReviewCache** | `lib/essayReviewCache.ts` (`essayReviewInputHash`) | M | H | H | H | **High** | Deferred (Phase1 原則対象外) | — | 同上 | `essayPracticeReview` とは独立 cache |
| 22 | **interviewQuestionsCache** | `lib/interviewQuestionCache.ts` (`interviewQuestionsCache`) | M | H | H | H | **High** | Deferred (Phase1 原則対象外) | — | 同上 | legacy fallback 経路は cache 対象外 |
| 23 | **wallHittingInputHash** | `lib/wallHittingInputHashStorage.ts` (`wallHittingInputHash`) | M | H | H | H | **High** | Deferred (Phase1 原則対象外) | — | 同上 | `wallHittingResult` と AND 照合 |
| 24 | **daily limit counters** | `lib/dailyLimit.ts`, `lib/statementLimit.ts`, `lib/statementPrepareLimit.ts`, `lib/interviewAdditionalUsage.ts` 等 | L | L | M | L | **Low-Medium** | Deferred (Phase1 対象外) | — | quota mirror が必要かの判断（Phase2 以降） | date-bound counter。device cap として localStorage に閉じる方が自然 |

---

## 7. Cross-feature Dependency Notes

feature 間の依存関係に起因する移行順序制約。

- **StudentProfile は他のすべての feature が「読む側」**（[student_profile_contract.md §8](../principles/student_profile_contract.md)）。先に StudentProfile を Phase1 に入れることで、後段 feature の判断材料が増える
- **statementReviewCache (v5)** は canonical として `studentProfile` を直接読む（`wallHittingResult` 依存を除外済み、STEP-F）。StudentProfile mirror が稼働している前提で statement-review 系の mirror 設計を行う
- **interviewQuestionsCache** も `studentProfile` を hash 入力に含む（[storage/README.md](../../lib/storage/README.md)）。同上の依存
- **wallHittingResult / analyzeState** は StudentProfile **canonical の派生元 raw** であり、下流 feature が直読みする経路を禁じる契約（[student_profile_contract.md §3](../principles/student_profile_contract.md)）。mirror すべきか自体を Phase2 で改めて判断する
- **statement_prepare_summary** は statement-review / interview-questions に間接的に影響しうる canonical artifact。先に StudentProfile を持ち上げてから判断する
- **selfPR 系** は StudentProfile を `getStudentProfileForFeature()` 経由で参照する（feature 側に人格を持たない）。selfPR 自身の mirror は独立だが、`selfPRs` と `selfPR_draft` の同時 mirror で raw-string 表現方針を統一する
- **admission matching** は `matchingResult` / `matchingTimestamp` が page.tsx 直書き ([storage/README.md](../../lib/storage/README.md))。Phase1 mirror に入れる **前** に `lib/admissionMatchingStorage.ts` への集約を別 STEP で完了させる
- **interview_records** は AI 出力を含む append-only 履歴。mirror の冪等性（同一 record の二重 push 防止）を設計してから着手する

---

## 8. Hydration / Restore Risk Analysis

hydration / restore 経路に対する mirror 配線の副作用リスクを feature 別に列挙する。

- **hydration-safe restore が既に明示設計されている feature**:
  - basicInfo（subjectGrades hydration-safe restore あり、recent commit `390826c`）
  - StudentProfile（restore は canonical のみ）
  - 上記は **mirror 起動を canonical 書き込みの後段** に置くだけで hydration への波及がない
- **hydration リスクが高い feature**:
  - wallHittingResult / analyzeState（多段 step state、壁打ち UI の mount 順序依存）
  - essayPracticeData / essayPracticeReview（多段フロー、動的テーマ）
  - 上記は **mirror 起動位置（canonical helper 内部 vs caller 側）の判断を慎重に** 行う必要があり、Phase1 後期に回す
- **render path 内 mirror 起動の禁止**（[phase1_runtime_strategy.md §12](./phase1_runtime_strategy.md)）
  - render 関数 / server component / hydration 前 effect での mirror 起動は **全 feature で禁止**
  - effect 内起動でも依存配列に Supabase state を入れない
- **restore 経路から Supabase を呼ばない**（[phase1_runtime_strategy.md §10](./phase1_runtime_strategy.md)）
  - reload / cache hit / `sourceHash` 一致時 / mount 直後の hydration、いずれの restore 経路でも Supabase を呼ばない
  - 既存 user の localStorage を mirror に **back-fill** する behavior は Phase1 では導入しない

---

## 9. AI Flow Sensitivity Notes

AI 出力を含む経路に対する特別な注意事項。

- **AI 出力 canonical artifact**（StudentProfile / wallHittingResult / SummaryResult / 各 review / 各 question 等）の mirror は **canonical artifact 側のみ** を対象とし、cache (`*InputHash` 系) は Phase1 で原則 mirror しない（[phase1_runtime_strategy.md §11](./phase1_runtime_strategy.md)）
- **cache hit 経路で Supabase を呼ばない**。cache hit は AI 再呼び出しを skip する機構であり、Supabase 呼び出しを追加する場ではない
- **canonical sync 責務は cache hit 経路でも維持される**（[student_profile_contract.md §5.4](../principles/student_profile_contract.md)）。cache hit 経路で StudentProfile patch を忘れることは引き続き禁止であり、mirror 導入で **緩めない**
- **mirror 失敗を理由に AI 出力を再生成しない**。mirror 失敗は best-effort であり、AI cost を mirror 失敗の理由で消費しない
- **`sourceHash` の手動偽装を mirror 都合で行わない**（[student_profile_contract.md §11 Anti-pattern](../principles/student_profile_contract.md)）。mirror dedup のための hash 偽装は canonical 意味論を破壊する
- AI restore flows（壁打ち / summarize / interview / statement-review / essay-practice review）の mirror 着手は **StudentProfile mirror が観測安定** してから

---

## 10. Observability Readiness Notes

mirror の **観測可能性** が整っていない段階での feature 追加を禁止する。

- mirror 配線 PR の前提として、以下が稼働していること:
  - mirror 結果 3 分類（`success` / `failure` / `skip(no-op)`）の記録
  - 失敗種別の粗粒度分類（`auth_missing` / `env_missing` / `network` / `schema` / `unknown`）
  - feature 単位の mirror 起動率 / 成功率の集約
- 上記が稼働するまでは **StudentProfile（順序 1）と observability sink 設計 PR のみ** が Phase1 で許可される
- observability sink 整備は Phase1 着手 STEP の **第 1 PR** として独立させる（[phase1_runtime_strategy.md §13](./phase1_runtime_strategy.md)）
- observability への書き込み失敗は mirror helper の挙動を変えない（observability も best-effort）
- 観測項目の **正式リスト** は別ドキュメント（仮: `docs/supabase/mirror_observability.md`）で確定する。本ドキュメントは要件のみ規定する
- 観測結果が「Phase2 へ進むに足る安定」を示すまで、Phase1 期間中の feature 追加は中断可能（[phase1_runtime_strategy.md §14](./phase1_runtime_strategy.md)）

---

## 11. Phase1 Recommended Rollout Order

実行順序の推奨。各順序は独立 PR として実装する（cross-cutting refactor を mixed しない、[incremental_refactor_policy.md](../principles/incremental_refactor_policy.md)）。

| Order | Target | 主な目的 | 前提 |
|---|---|---|---|
| 0 | observability sink 設計 PR | mirror 3 分類 / 失敗分類 / 起動率の sink を準備 | boundary file の物理パス決定（[client_boundary.md §4](./client_boundary.md)） |
| 1 | **StudentProfile** mirror | canonical 持ち上げの最初の検証 | order 0 完了 |
| 2 | **basicInfo** mirror | 純粋 input form での observability 確認 | order 1 観測安定 |
| 3 | **activityData (form-side)** mirror | 同上の検証拡大 | order 2 観測安定 |
| 4 | **diagnosis result** mirror | append 一発の簡素 feature 検証 | order 2 観測安定 |
| 5 | **selfPRs + selfPR_draft** mirror | raw-string mirror 表現を確立 | order 1〜2 観測安定 / raw-string schema 表現確定 |
| 6 | **statementDraft (本文)** mirror | legacy normalization 対象 feature の検証 | legacy 正規化扱い決定 |
| 7 | **statement_prepare_answers + interviewDraft** mirror | 並列で input form feature を持ち上げ | order 2 観測安定 |
| 8 | **admission matching input/result** mirror | medium-risk への進行 | `matchingResult`/`matchingTimestamp` の `lib/` 集約完了 |
| 9 | **interview_records** mirror | append-only 履歴 mirror の冪等性検証 | append 冪等性設計確定 |
| 10 | **essayPracticeData** mirror | 多段フロー進捗 mirror の検証 | order 9 までの観測安定 |
| 10b | **statementReviewHistory** mirror | AI 添削履歴 mirror（cache とは分離） | order 1 観測安定 + cache 分離方針文書化 |
| 11 | **statement_prepare_summary + follow-up answers** mirror | AI 出力 canonical artifact mirror への進行 | StudentProfile mirror 観測安定 |
| 12 | **essayPracticeReview** mirror | 高リスク AI restore flow への着手 | order 11 までの観測安定 + cache 方針確定 |
| 13 | **wallHittingResult / analyzeState** の mirror 判断 | mirror するか自体を Phase2 で改めて判定 | order 11〜12 観測 + StudentProfile 派生元 raw を mirror する妥当性の再評価 |

注:

- 順序は **目安**。各 PR は前段の **observability 結果** に基づいて着手判断する
- 同一順序内（例: 7）でも 1 PR = 1 feature が原則
- order 13 は「Phase1 期間中に着手する保証はしない」決定であり、Phase2 計画と合流させる可能性がある

---

## 12. Features Explicitly Deferred

Phase1 期間中に **着手しない** ことを本ドキュメントで明文化する。

- **Supabase からの read 経路を含む feature**（全 feature 共通。[phase1_runtime_strategy.md §8](./phase1_runtime_strategy.md)）
- **auth-coupled persistence**（ログイン UI 導入 / user_id 必須化 / mirror skip を user 行動として露出）
- **cross-device sync 想定の挙動**（同一 user の別 device 間で state を引き継ぐ前提の design）
- **Phase2 fallback-read 経路の準備配線**（「localStorage が空なら Supabase を読む」の先取り）
- **canonical ownership shift**（Supabase 側で先に書いてから localStorage に書き戻す / 「Supabase の方が新しい」前提の merge）
- **hash-cache feature の mirror**（`*InputHash` 系すべて。Phase1 原則対象外。[phase1_runtime_strategy.md §11](./phase1_runtime_strategy.md)）
- **daily limit counter の mirror**（device cap として localStorage に閉じる方が自然。Phase2 以降で必要性を判断）
- **wallHittingResult / analyzeState の mirror**（StudentProfile 派生元 raw。mirror すべきか自体を Phase2 で再判断）
- **既存 user の localStorage → Supabase back-fill バッチ**（observation 前提なしの大量 mirror 起動を禁ずる。別 STEP で観測ベース設計）

deferred feature を Phase1 期間中に **「準備として」** 触ることも禁止する。準備配線は Phase 進行の予測可能性を破壊する（[phase1_runtime_strategy.md §6](./phase1_runtime_strategy.md)）。

---

## 13. Anti-patterns

順序付け / 移行判断における **境界違反**。PR レビュー段階で reject する根拠とする。

- **人気度 / 開発活発度で順序を決める**
  - 例: 「最近 essay-practice を触っているから先に持ち上げる」
  - 理由: risk philosophy（§3）に反する。risk が順序付けの第一指標
- **AI restore flows を早期に移行する**
  - 例: 観測安定前に wallHittingResult / statement_prepare_summary を mirror に入れる
  - 理由: AI 出力 canonical artifact + cache の同居経路は restore semantics と最も衝突しやすい
- **schema 完成度を順序付けに連動させる**
  - 例: 「schema が決まった順に持ち上げる」
  - 理由: schema は feature 移行に追随して書き起こす。schema 都合で risk 高 feature を先に持ち上げない
- **hidden fallback read を入れる**
  - 例: Phase1 PR の中で「localStorage が空なら Supabase を見る」をこっそり配線
  - 理由: Phase2 責務を Phase1 が侵食する。canonical UX が Supabase に依存し始める
- **observability readiness を optional として扱う**
  - 例: 「観測はあとで入れる」「mirror を先に動かして観測は次の PR で」
  - 理由: 観測不能な mirror は Phase 進行判断に寄与しない / 失敗を発見できないまま積み上げる
- **複数 feature を 1 PR で持ち上げる**
  - 例: 「StudentProfile と basicInfo を同時に mirror 化」
  - 理由: 観測 / 撤退の粒度が崩れる。1 PR = 1 feature を維持
- **cross-cutting refactor を mirror PR に同居**
  - 例: mirror 配線 PR で `lib/*Storage.ts` の API を整える
  - 理由: 撤退可能性 / レビュー粒度を破壊（[incremental_refactor_policy.md](../principles/incremental_refactor_policy.md)）
- **deferred feature の「準備」**
  - 例: hash-cache feature に「将来の mirror のための hook 引数」を先に足す
  - 理由: Phase 進行の予測可能性を破壊
- **risk 軽減のために canonical を変質させる**
  - 例: 「mirror しやすくするために `sourceHash` の意味を変える」
  - 理由: canonical 意味論を mirror 都合で変えない（[student_profile_contract.md §11](../principles/student_profile_contract.md)）

---

## 14. Future Re-evaluation Rules

matrix は **凍結文書ではない**。以下の条件で再評価し、本ドキュメントを更新する。

- **観測値が出揃った時点**で再評価する:
  - 各 feature の mirror 成功率 / 失敗種別分布が安定したら、後段 feature の risk 評価を更新する
  - 観測値が予想と乖離した feature は順序を組み替える（後ろに下げる方向のみ。前倒しは慎重に）
- **canonical 設計が変わった feature** は再評価する:
  - 例: cache 経路が見直された / canonical helper が分割された / 新規 storage が追加された
- **新規 feature が追加された** ら matrix に行を追加する（Phase1 期間中は新規 feature の即時 mirror を許さない。低リスク行に分類されても、まず docs 整備 + 観測安定 1 サイクルを経る）
- **deferred 判定の解除** は本ドキュメント PR でのみ行う。runtime PR の付帯変更として「実は eligible でした」と判定変更しない
- **再評価は doc-first**。実装 PR が matrix と矛盾した瞬間、PR ではなく matrix を直す方向で議論する（matrix と現実が乖離したら matrix が古いだけ）
- **Phase2 計画着手時** に本ドキュメントの後継（仮: `docs/supabase/phase2_rollout_matrix.md`）を起票する。Phase1 で残った deferred feature の扱いを Phase2 で改めて判断する

---

## 締めくくり

Supabase 移行の事故の多くは **「移行順序を間違えた」** ことから生まれる。
人気 / 開発活発度 / 実装しやすさは順序付けの根拠にならない。
本ドキュメントの分類は **risk と observability readiness** のみで構成される。
最初の mirror PR が **StudentProfile から始まる** こと、AI restore flows が **観測安定後** に着手されること、deferred feature が **準備として触られない** ことが、Phase1 全体の予測可能性を支える。
