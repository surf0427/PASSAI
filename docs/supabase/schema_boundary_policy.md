# Supabase Schema Boundary Policy

PASSAI における Supabase **persistent schema の境界規約** を、最初の table / 最初の SQL migration / 最初の schema 定義ファイルが書かれる **前** に固定する。
本ドキュメントは「どの localStorage オブジェクトが schema 候補で、どれが候補ではないか」を **意図的に判断する基準** を提供し、「現に存在する runtime オブジェクトの形」をそのまま schema に複製する事故を防ぐ。

関連: [migration_phases.md](./migration_phases.md), [client_boundary.md](./client_boundary.md), [phase1_runtime_strategy.md](./phase1_runtime_strategy.md), [feature_rollout_matrix.md](./feature_rollout_matrix.md), [mirror_observability.md](./mirror_observability.md), [student_profile_contract.md](../principles/student_profile_contract.md), [localstorage_keys.md](../shared/localstorage_keys.md), [storage/README.md](../../lib/storage/README.md), [architecture_rules.md](../principles/architecture_rules.md)

---

## 1. Purpose

- 最初の Supabase schema が書かれる **前** に、persistent / cache / ephemeral の境界を契約として固定する
- 「localStorage に存在するから schema に入れる」という **形ベースの schema 設計** を architectural に禁止する
- canonical / derived / cache / ephemeral の各レイヤで persistence 適格性の判定基準を分けることで、後段 PR が「これは schema に入れるべきか / 入れるべきでないか」を本ドキュメントから引ける状態を作る
- AI 出力の persistence について prompt 版 / cache 版との結合を予め定義し、prompt-version-blind な永続化を防ぐ
- [feature_rollout_matrix.md](./feature_rollout_matrix.md) の rollout 順と整合した schema 化スコープを規定する

本ドキュメント自体は契約 / planning 専用であり、schema / SQL / type 定義の実装は含まない。実装は feature 単位の Phase1 着手 STEP で別途行う。

---

## 2. Current Migration Position

- branch: `feature/supabase-migration`
- Phase: **S0 完了 / Phase1 未着手**
- Supabase schema / table / SQL migration いずれも **存在しない**
- canonical 永続層: localStorage 一択。窓口は `lib/*Storage.ts` 群（[storage/README.md](../../lib/storage/README.md)）
- [feature_rollout_matrix.md](./feature_rollout_matrix.md) で feature 別 risk 分類済みだが、schema は未起票
- 本ドキュメントは「これから書く最初の Supabase schema」が **何を / どこまで** を対象にするかを決めるためのインプット

---

## 3. Schema Boundary Philosophy

schema 設計を貫く 5 つの哲学。Phase1 期間中、これらが他の判断より優先される。

1. **persistence 適格性は意図的に判定する**。localStorage に存在するからといって persistence 候補になるわけではない。「なぜ persist したいか」を毎回明示する。
2. **canonical user-authored state > derived AI output > cache > ephemeral**。優先度はこの順。下位に行くほど persistence の justification が重くなる。
3. **runtime 都合のオブジェクトは schema 候補ではない**。hydration helper / UI 復元 helper / streaming 中間状態などは ephemeral として閉じる。
4. **cache は別 layer / 別判断**。`*InputHash` 等の cache は canonical artifact の persistence と切り離して扱う（[phase1_runtime_strategy.md §11](./phase1_runtime_strategy.md)）。
5. **schema 形は localStorage 形に追随しない**。localStorage の object shape は「ある時点の便宜形」であり、schema は「長期にわたって意味を保つ形」であるべき。両者の差分を意図的に設計する。

これらは [phase1_runtime_strategy.md §3](./phase1_runtime_strategy.md) / [client_boundary.md §3](./client_boundary.md) を schema 視点で再宣言したもの。

---

## 4. Canonical vs Derived Data

PASSAI の data を 4 つの層に分け、persistence 適格性の **default 判定** を固定する。

| Layer | 定義 | persistence default | 例 |
|---|---|---|---|
| **Canonical user-authored** | user が直接書き / 選んだ state。再生成不能（loss = user 損失） | **eligible**（最優先で persist） | basicInfo (`basicFormData`) / activityData 入力 / selfPR 本文 / statementDraft / 各 prepare answers |
| **Canonical derived (stable)** | AI 出力等の derived だが contract で固定されており再生成しても意味が同じになる canonical artifact | **eligible（条件付き）** | StudentProfile（[student_profile_contract.md](../principles/student_profile_contract.md) で canonical 化済み） |
| **Derived (unstable)** | AI 出力で prompt / cache / 上流 input に依存し、再生成で内容が drift しうる artifact | **deferred / 慎重判断** | wallHittingResult / analyzeState / SummaryResult 中間 / statement_prepare_summary / 各 review |
| **Cache** | hit/miss 判定のための hash + 生成済み artifact の同居キャッシュ | **deferred（Phase1 原則対象外）** | `*InputHash` 系すべて |
| **Ephemeral** | render / hydration / streaming / UI 復元のための一時 state | **non-eligible** | drag/drop の途中 state / streaming token buffer / scroll 復元キー |

ルール:

- **canonical user-authored** は loss の不可逆性が最大。Phase1 mirror の最優先対象
- **canonical derived (stable)** は contract がある場合のみ canonical 扱い（StudentProfile が唯一の現存例）
- **derived (unstable)** は schema 化を即決しない。「persist しないと困る根拠」を別 STEP で明示する
- **cache** は Phase1 では schema 対象外（[phase1_runtime_strategy.md §11](./phase1_runtime_strategy.md) と整合）
- **ephemeral** は schema 化しない。例外を作るときは本ドキュメントの更新を先行させる

判定は **feature 単位** で行い、[feature_rollout_matrix.md §6](./feature_rollout_matrix.md) の各行に「どの layer に属するか」を schema 設計時に併記する。

---

## 5. Persistent vs Ephemeral State

persistent 候補と ephemeral 候補を **明示的に分ける** ためのチェックリスト。schema 設計時にこのリストで filter する。

persistent 候補となる条件（**すべて満たす場合のみ** persistent 適格）:

- (1) **loss が不可逆**（再生成不能 / 再入力に大きな user cost）
- (2) **長期にわたって意味が保たれる**（schema として固定して 6 ヶ月後も解釈可能）
- (3) **canonical 経路 / mirror 経路の責務がはっきり分かれる**（[migration_phases.md §4](./migration_phases.md) の Phase 定義に当てはまる）
- (4) **他 feature が読む / 将来読みうる**、または **user の意思表示として残す価値がある**

ephemeral 扱いとする条件（**いずれか 1 つに該当すれば** non-persistent）:

- (a) render / hydration / mount 順序のための補助 state（[phase1_runtime_strategy.md §12](./phase1_runtime_strategy.md)）
- (b) streaming / 進行中の AI 生成の中間 token
- (c) UI 操作（drag / scroll / focus）に紐付く一時 state
- (d) tab / window 単位で再生成可能なキャッシュ
- (e) page 間受け渡しのためだけの transient buffer（例: `sessionStorage` 利用箇所）
- (f) retry / queue / backoff のための内部 state（Phase1 では retry 自体禁止のため、永続化対象にしない）

ルール:

- persistent 候補の (1)〜(4) すべてに justification を **書ける** ことが schema 化条件
- ephemeral 条件 (a)〜(f) のいずれかに該当する場合、schema 化前に「なぜ ephemeral では足りないか」を doc-first で議論する
- 「将来 persist したくなるかもしれない」は schema 化の根拠にしない（[Phase1 哲学: 先取り禁止](./phase1_runtime_strategy.md)）

---

## 6. Cache Artifact Policy

`*InputHash` 系の hash-cache および同種の派生 cache は **Phase1 では schema 対象外**。

- 対象 cache（既知）: `wallHittingInputHash`, `additionalQuestionsInputHash`, `summarizeInputHash`, `statementReviewInputHash`, `essayReviewInputHash`, `interviewQuestionsCache`（hash 部分）
- 上記いずれも **Phase1 で persist しない**（[phase1_runtime_strategy.md §11](./phase1_runtime_strategy.md) と整合）
- 理由:
  - cache validity は localStorage の状態のみで決定されるべきであり、Supabase 側状態が cache validity を変えると canonical sync 責務（[student_profile_contract.md §5.4](../principles/student_profile_contract.md)）と衝突する
  - cache を persist すると「Supabase に hash が残っているから AI を呼ばない」という新 semantics が生まれ、cache 経路の挙動が device 横断で変質する
  - cache hit 経路で Supabase を呼ばない原則と衝突する

Phase1 で cache を schema 化したくなった場合の対応:

- 必ず **本ドキュメントの PR を先に出す**
- 「なぜ cache validity が device 横断で共有される必要があるか」を justification として書く
- canonical artifact の persist が安定（rollout gate stage 3、[mirror_observability.md §14](./mirror_observability.md)）に到達してから判断
- cache 用 table は canonical 用 table と **物理的に分離** する（同 table に混ぜない）
- cache 用 schema は invalidate / TTL / version 列を canonical schema と切り離して設計する

ルール:

- cache schema の存在は **canonical schema の存在を前提にしない**（順序: canonical 先 / cache 後 / その逆は禁止）
- cache schema を作る前に **本当に必要かを再判定**（「現状 localStorage cache で困っていない」場合は schema 化しない）

---

## 7. AI Artifact Persistence Rules

AI 出力 artifact の persistence は **canonical 化された artifact** に限定する。それ以外の AI 出力は Phase1 では原則 persist しない。

persist 適格な AI artifact（条件付き）:

- **StudentProfile**: canonical contract 固定済み（[student_profile_contract.md](../principles/student_profile_contract.md)）。Phase1 rollout 順の最初。
- **statementDraft 本文**（user が AI 出力を選択して保存した結果）: user が認知的に「これを残す」と決めた瞬間の snapshot
- **selfPRs / interview_records / essayPracticeReview** など、「履歴」として user 側にも意味がある artifact: AI 出力起源だが user 行動の結果として残る

persist 非適格 / Phase1 deferred な AI artifact:

- **wallHittingResult**（StudentProfile 派生元 raw。下流が直読みしない契約）
- **analyzeState**（壁打ち working memory）
- **AI 生成中の streaming buffer / token 中間値**
- **AI 呼び出しの retry 中 state**
- **prompt 構築 / context builder の中間 object**
- **cache 由来の hit 値**（[§6](#6-cache-artifact-policy)）

AI artifact を persist する場合の **追加要件**:

- prompt version / cache version の **記録**（[§8](#8-prompt--cache-version-coupling-rules)）
- 上流 input の identity（`sourceHash` 等、[student_profile_contract.md §11](../principles/student_profile_contract.md)）を schema に保持
- 再生成時の **drift 検出可能性**（観測 field と整合、[mirror_observability.md §6](./mirror_observability.md) の `promptVersion`）
- legal / 透明性の観点で「AI 出力を保存している」事実が ops 側で説明可能であること
- user が AI 出力を **削除 / 編集** できる UX が canonical 側に存在すること（persist する artifact は user controllable）

ルール:

- **prompt-version-blind な永続化を禁止**（[§14 Anti-patterns](#14-anti-patterns)）
- 「再生成すれば取り戻せる」AI artifact は default で persist 非適格
- AI artifact の persist は **canonical 化（contract 化）を先に経た artifact** のみに許す。contract 化されていない AI 中間 artifact を「とりあえず保存」しない

---

## 8. Prompt / Cache Version Coupling Rules

AI 出力を persist する schema は **prompt version / cache version との結合** を明示する。

必須項目:

- **`promptVersion`** 列: 生成時に使用された prompt の version（既存 `lib/prompts/` の version 管理と整合）
- **`schemaVersion`** 列: artifact 自体の schema version（structure 変更時に bump）
- **`sourceHash`** 列または同等: 上流 canonical input の identity（StudentProfile の `sourceHash` 同等）

cache 経由で生成された artifact を persist する場合（Phase1 では原則該当しない）:

- **`cacheVersion`** 列を併記
- cache hit / miss の区別を artifact 自体に持たせるか、別 metadata table に分離するかを **schema 設計時に明示**

ルール:

- prompt version が変わった瞬間に既存 persist 済み artifact の意味が drift しうる前提で schema を設計する
- 同一 user × 同一 canonical input × 同一 promptVersion での artifact 再生成は **idempotent 扱い**（dedup 可能）
- prompt version 列を欠いた AI artifact の persist は **禁止**（後から「いつの prompt で出力したか」が分からなくなる）
- 既存 cache の hash 構成（[localstorage_keys.md](../shared/localstorage_keys.md) 各 STEP 解説）を schema 列に翻訳する際は **hash 入力の構成要素を schema コメントで明文化** する
- 互換性のための version migration（schema version bump 時の対応）は別 STEP で planning する

---

## 9. Denormalization Philosophy

denormalization（同じ data を複数箇所に重複保持）は **default で禁止**。例外には明示的 justification を要求する。

denormalize **してよい** ケース:

- **読み手の性能要件**で必要（実測根拠あり）
- **canonical 側が消滅した場合の独立保持**が contract で求められる（StudentProfile の strengths スナップショット等、[student_profile_contract.md §6](../principles/student_profile_contract.md)）
- **ownership が明示的に異なる**（user 編集可 / AI 生成不変 のような責務分割）

denormalize **してはならない** ケース:

- 「join 書くのが面倒」「JSON で持つ方が楽」
- 「とりあえず両方持っておく」
- 同じ data の同一性質 copy（差分管理 / staleness が不明)

ルール:

- 重複を入れる場合、**どちらが canonical か** を schema コメントで明示
- canonical 側更新時の **mirror 側追従ポリシー**（即時 / 遅延 / 手動）を明示
- 「schema 都合の denormalization」が ownership 曖昧化を生む場合は yield せず、別 STEP で正規化案を議論する

---

## 10. JSON Usage Policy

PostgreSQL の `json` / `jsonb` 列の使用方針を限定する。

許容される JSON 利用:

- **schema が短期間に頻繁に変化する草案段階**で、明確な「ここまでが JSON、ここからは列分離」の境界を持つ場合
- **AI 出力の構造化前 raw 形式**で、列分離するほど整っていない過渡期形式
- **明示的に「opaque blob として持つ」** 設計判断がある場合（query 要件なし）

禁止される JSON 利用:

- **localStorage 全体を 1 列にまとめる** dump（store-everything design）
- **進化途上の runtime オブジェクト** をそのまま JSON 列に投入し続ける
- **複数の意味的に独立した entity** を 1 JSON 列に詰める
- **query 要件のある field** を JSON 内に隠す（後で indexable 列に分離できなくなる）
- canonical artifact を **JSON dump で済ませる** こと（artifact の構造は schema 列で表現）

ルール:

- JSON 列を使う場合は **JSON 内部の structure を schema コメントで documented** にする
- 「JSON で持っているが将来列分離する予定」の field は **TODO コメント + 期限** を schema に書く
- JSON 列の中身を index する必要が出た時点で **列分離の PR** を起票する（JSON 内 index 化で対応しない）
- 1 entity につき JSON 列は **最大 1 つ**（複数 JSON 列は責務不明瞭のサイン）

---

## 11. Schema Evolution Rules

schema 進化は **doc-first / additive 優先**。

進化の原則:

- **additive change を default** にする（新規列 / 新規 table を足す方向）
- **breaking change**（列削除 / 型変更 / 制約強化）は別 STEP として独立 PR で扱う
- すべての breaking change は **本ドキュメントの PR を先行** させる
- schema version 列を bump する条件:
  - artifact の構造変更（列追加 / semantic 変更）
  - prompt version 変更が schema 解釈に波及する場合
  - 移行不可能な breaking change
- migration script は **separate file** として管理（[architecture_rules.md §Supabase 移行に向けて](../principles/architecture_rules.md)）
- legacy normalization の扱い（`lib/*Storage.ts` 群の正規化ロジック）は schema migration として再実装するか互換打ち切るかを **schema 化時に判断** し、本ドキュメントに記録

進化の禁止事項:

- 「現に存在する runtime オブジェクトの形」を schema に直接複写する schema-by-shape
- 同一 schema を複数の意味で兼用する（schema を「便利な何でも箱」化しない）
- 「save now, normalize later」設計（後から normalize できる保証は無い）
- schema 内の field を **runtime 都合で hide / unhide** する切替（schema は安定であるべき）

---

## 12. Feature-specific Schema Risk Notes

[feature_rollout_matrix.md §6](./feature_rollout_matrix.md) と整合した、schema 視点の追加注意事項。

| Feature | schema 視点の注意 |
|---|---|
| **StudentProfile** | canonical contract 固定済み ([student_profile_contract.md §4](../principles/student_profile_contract.md))。`version` / `generatedAt` / `sourceHash` を schema 列として明示。strengths/weaknesses/futureConnections/valueKeywords/signatureEpisodes は array / structured 列で表現（JSON dump で済ませない） |
| **basicInfo** | input form。schema は user-authored fields の **列分離** が default。subject grades 等の sub-structure は適切に列 / 関連 table に展開 |
| **activityData (form-side)** | 入力途中 state は `unchanged_payload` skip 比率が高くなる前提で idempotent mirror 設計 |
| **diagnosis result** | 再生成可能だが user 認知的に「結果」として意味がある artifact。schema には diagnosis logic version 列を持つ |
| **selfPRs / selfPR_draft** | `selfPR_draft` は raw string 例外 ([storage/README.md](../../lib/storage/README.md))。schema 上 string 型として表現し、JSON dump にしない |
| **statementDraft + statementReviewHistory** | 本文と review 履歴は **別 entity**。同 table に混ぜない。`statementReviewHistory` は append-only の row 追加で表現 |
| **statement_prepare_answers / summary / follow-up** | answers (user-authored) と summary (AI 出力) は schema 上分離。follow-up answers は弱点別構造を schema で表現 (JSON dump 禁止) |
| **interview_records / interviewDraft** | record は履歴 (rows)、draft は単一 row の作業中状態。両者の semantics を schema コメントで明示 |
| **admission matching** | `matchingResult` / `matchingTimestamp` は page 直書きで `lib/` 集約 TODO ([storage/README.md](../../lib/storage/README.md))。集約完了前に schema を切らない |
| **essayPracticeData / essayPracticeReview** | 進捗 state と review は **別 entity**。dynamic theme system との結合に注意 |
| **wallHittingResult / analyzeState** | derived (unstable) layer。Phase1 では schema 化しない（[§13](#13-explicitly-deferred-data)） |
| **`*InputHash` 系 cache** | Phase1 schema 対象外（[§6](#6-cache-artifact-policy)） |
| **daily limit counters** | device cap として localStorage に閉じる方が自然。schema 化は Phase2 以降の判断 |

ルール:

- 各 feature の schema PR は本表の該当行に **schema 化結果（テーブル名 / 列構成 / version 列の運用）** を追記する
- 上記 risk note を満たさない schema 設計案は PR レビュー段階で reject 根拠とする

---

## 13. Explicitly Deferred Data

Phase1 期間中、schema 化を **明示的に行わない** data を列挙する。これらは「準備として」も schema に入れない（[phase1_runtime_strategy.md §6](./phase1_runtime_strategy.md) と整合）。

- **wallHittingResult**（StudentProfile 派生元 raw。下流が直読みしない契約）
- **analyzeState**（壁打ち working memory）
- **temporary interview streaming state**（streaming token buffer 等）
- **transient UI restore state**（scroll / focus / drag 復元キー / accordion 開閉状態 / page-internal step index）
- **in-progress AI generation artifacts**（途中まで生成された AI 出力 / abort された AI 試行）
- **retry queues / backoff state**（Phase1 では retry 自体禁止）
- **client-only hydration helpers**（hydration mismatch 防止のための補助 state / SSR/CSR 境界 buffer）
- **`*InputHash` 系すべて**（cache layer は Phase1 schema 対象外、[§6](#6-cache-artifact-policy)）
- **daily limit counters**（device cap として localStorage に閉じる）
- **prompt 構築 / context builder の中間 object**
- **observability raw event の長期 archive**（observability sink は別 layer、[§14](#14-anti-patterns) の「mixing observability and product schema」参照）

deferred data を **「将来のために」** schema 列として予約することも禁止する。schema 列の予約は実装の予測可能性を破壊する（[client_boundary.md §3](./client_boundary.md) と整合）。

---

## 14. Anti-patterns

schema 設計における **境界違反**。PR レビュー段階で reject する根拠とする。

- **schema-by-current-object-shape**
  - 例: `localStorage` の object をそのまま `jsonb` 列 1 つに dump
  - 理由: 現在の object shape は短期便宜形。schema は長期 contract
- **進化途上の runtime オブジェクトを JSON 列に dump し続ける**
  - 例: 新規 field が増えるたびに JSON 内に push し、列分離を先送りし続ける
  - 理由: JSON 内 schema drift が観測不能になり、後段の query / migration が爆発
- **treating cache as canonical**
  - 例: `*InputHash` 系を schema 化して「Supabase 側に hash があれば cache hit」とする
  - 理由: cache validity が device 横断で変質し、canonical sync 責務と衝突する（[student_profile_contract.md §5.4](../principles/student_profile_contract.md)）
- **persisting hydration-only state**
  - 例: scroll 位置 / accordion 開閉 / SSR/CSR 境界 buffer を schema 化
  - 理由: render 都合の state は ephemeral であり、schema 化で意味が drift する
- **prompt-version-blind persistence**
  - 例: AI 出力 artifact を `promptVersion` 列なしで persist
  - 理由: 後から「いつの prompt の出力か」分からなくなる / drift 検出不能
- **mixing observability and product schema**
  - 例: `mirror.attempt` event を user-facing product table に同居させる / observability raw event を canonical artifact table に append
  - 理由: 観測 schema は別 layer（[mirror_observability.md](./mirror_observability.md)）。product schema が観測都合で歪む
- **「save now, normalize later」設計**
  - 例: 「とりあえず全部 JSON で持って、後で列分離する」
  - 理由: 後から normalize できる保証は無い。schema は最初の判断で長期決まる
- **store-everything schema**
  - 例: 1 entity につき複数の意味的独立 fields を 1 JSON 列に詰める / 「user 関連は全部 user table」
  - 理由: ownership 不明瞭 / query 不可 / breaking change が連鎖
- **denormalization 都合での ownership 隠蔽**
  - 例: 「両方持っておく」だけで canonical / mirror どちらが正かを書かない
  - 理由: 不整合発生時の責任所在が不明
- **deferred data を schema 予約**
  - 例: wallHittingResult 用 table を「将来のため」に空で作る
  - 理由: 実装の予測可能性を破壊（[phase1_runtime_strategy.md §6](./phase1_runtime_strategy.md)）
- **schema 都合の canonical 意味論変更**
  - 例: schema 化しやすいように `sourceHash` の意味を変える / canonical helper の戻り値型を schema に合わせる
  - 理由: canonical 意味論は schema 都合で変えない（[student_profile_contract.md §11](../principles/student_profile_contract.md)）
- **schema を doc-first なしで進化させる**
  - 例: 列追加 / 列削除を本ドキュメント更新なしで PR
  - 理由: schema 進化の予測可能性を破壊（[§11](#11-schema-evolution-rules)）

---

## 15. Future Runtime TODOs

本ドキュメントの範囲外。Phase1 着手 STEP 以降で順に消化する。

- **最初の schema 起票対象の選定**
  - [feature_rollout_matrix.md §11](./feature_rollout_matrix.md) の Order 1（StudentProfile）から開始
  - schema 設計 PR は **本ドキュメント §4 / §7 / §8 / §12 の判定を passed** な状態で起票
- **schema 物理配置 / migration tooling 選定**
  - SQL migration の置き場所 / tooling（Supabase migration / sqlx / 別 tool）を Phase1 着手 STEP で決定し、本ドキュメント §11 / §12 に追記
- **`promptVersion` / `schemaVersion` / `sourceHash` 列の正式命名**
  - 列名 / 型 / 制約を実装 STEP で決定し本ドキュメントに追記
- **legacy normalization の扱い決定**
  - [architecture_rules.md §Supabase 移行に向けて](../principles/architecture_rules.md) の TODO と整合
  - 各 storage の正規化を schema migration に持ち上げるか互換打ち切るかを feature 別に判断
- **JSON 列の境界点宣言**
  - 各 schema で JSON を使う場合の「JSON 内 structure と TODO 列分離期限」を schema コメントとして documented にする運用ルール
- **schema vs observability event の物理分離**
  - product schema と observability schema を **別 logical 配置** にする運用ルールを明文化（[mirror_observability.md §11](./mirror_observability.md) の sink 配置決定と整合）
- **denormalization rationale テンプレート**
  - denormalize を許可する PR description に書くべき justification の項目を別ドキュメント候補（仮: `docs/supabase/schema_review_checklist.md`）として起票
- **Phase2 fallback read 用 schema 要件**
  - Phase2 着手時に本ドキュメントの後継（仮: `docs/supabase/phase2_schema_policy.md`）で扱う

---

## 締めくくり

Supabase schema は **「localStorage に何があるか」を schema にコピーする作業ではなく**、「user に対して長期にわたって意味を保つ data の形を決める作業」である。
runtime の便宜形を schema に複写した瞬間、schema は短命な runtime 形に縛られ、後の breaking change で大きな代償を払う。
本ドキュメントの境界（canonical / derived / cache / ephemeral / prompt-version coupling / denormalization）は、最初の table が書かれる **前** に確定していることが、schema 全体の予測可能性を支える。
