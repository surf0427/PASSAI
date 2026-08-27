# PASSAI 受験版 — Exam Spine Decisions

**Purpose:** Exam Spine の確定済み Decision Register。**本ファイルが権威**。
**Update rule:** 承認された各 slice の後に更新する。architecture をここに書き直さない。
**Upstream reference:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_DECISIONS.md`

---

# 1. Decision status vocabulary

| Status | 意味 |
|---|---|
| `LOCKED` | 確定。変更には本ファイルの更新（＝明示的な決定）が要る |
| `PENDING_HUMAN` | Human の判断が必要。Claude Code が勝手に決めてはならない |
| `RESOLVED` | `PENDING_HUMAN` だった項目が決定され、対応が完了・検証済み（判断内容と実測を本文に残す） |
| `SUPERSEDED` | 後続 Decision に置き換えられた（履歴として残す） |

# 2. ID 体系

| Prefix | 範囲 |
|---|---|
| `E-L*` | Locked architecture decision（基礎不変条件） |
| `E-S*` | Spine implementation decision（実装方針） |
| `E-P*` | Policy / persistence decision |
| `E-H*` | Human decision 待ち |

各 Decision は次のフィールドを持つ。

```text
ID / Status / Decision / Reason / Alternatives rejected /
Upstream CAREER decision / Upstream CAREER path /
Exam-specific differences / Rollback implications
```

---

# 3. Locked architecture decisions

## E-L1 — localStorage を即廃止しない

- **Status:** `LOCKED`
- **Decision:** class 1 の Source について localStorage を canonical として維持する。Exam Spine は localStorage を「UI 表示 / オフライン / rollback 用の client projection」として残したまま、server 側の読み取り経路を **追加** する。
- **Reason:** 既存 UX は localStorage だけで完動する設計であり（`docs/supabase/client_boundary.md` §3-4）、canonical ownership を Supabase へ暗黙移行させると Phase1 boundary 契約を破る。移行中の rollback 可能性も localStorage が残っていることに依存する。
- **Alternatives rejected:**
  - *Supabase を全面 canonical にする（server-authoritative Layer 1）* — グローバル canonical の導入に相当し、multi-device write 競合の解決が別途必要になる。upstream も同じ選択肢を検討して保留している。
  - *localStorage を段階的に削除する* — Stage 途中で rollback 先が消える。
- **Upstream CAREER decision:** `D-L1`（Source Data remains original truth）
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_ARCHITECTURE.md` §4
- **Exam-specific differences:** 受験版は class 2 の Source（`interview_ai` / `presentation`）を持つため、「全 Source が device canonical」ではない。E-L2 で kind 単位に分ける。
- **Rollback implications:** なし（現状維持）。

## E-L2 — authority class を kind 単位で持つ

- **Status:** `LOCKED`
- **Decision:** Source を kind 単位で列挙し、各 kind に `device_canonical_mirrored` / `server_authoritative` のいずれかを割り当てる。割り当ては `EXAM_SPINE_ARCHITECTURE.md` §3 の表を正本とする。
- **Reason:** 受験版には「server route が著者で client は表示用 cache しか持たない」Source（AI 面接・プレゼン）が実在する。これを device canonical と同一視すると、正しい server データを「client の cache が古い」という理由で捨てる逆向きの誤りが起きる。
- **Alternatives rejected:**
  - *全 kind を device canonical として扱う* — 上記の逆向きの誤りが起きる。
  - *authority を purpose 単位で持つ* — 同じ kind が purpose によって権威を変えることはない。kind が正しい粒度。
- **Upstream CAREER decision:** `D-S10`（Source authority class）
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerSourceData/types.ts`
- **Exam-specific differences:** upstream は class 2 が 1 kind のみ。受験版は 2 kind（`interview_ai` / `presentation`）が最初から class 2。
- **Rollback implications:** 型の追加のみ。runtime 影響なし。

## E-L3 — identity authority は owner auth + RLS

- **Status:** `LOCKED`
- **Decision:** ユーザー識別は **server 側の Supabase auth**（session からの user 解決）のみを権威とする。request body / header / client 申告値を user_id の根拠にしない。RLS（`auth.uid() = user_id`）に加えて、query にも明示的な `user_id` 絞り込みを付ける。
- **Reason:** owner scoping を client 由来の値に依存させると、1 箇所のバグが cross-user 露出になる。RLS と明示絞り込みの二重にすることで、どちらか一方の設定漏れが直ちに事故にならない。
- **Alternatives rejected:**
  - *body の userId を信用する* — 明白な脆弱性。
  - *RLS のみに任せて明示絞り込みを省く* — policy の適用漏れ（後述 E-H2 の実例あり）を検出できない。
- **Upstream CAREER decision:** `D-L7` / `D-S1` の authority model
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerSourceData/serverReader.server.ts` 冒頭の安全境界コメント
- **Exam-specific differences:** なし。
- **Rollback implications:** なし。

## E-L4 — service-role で通常ユーザーの context を読まない

- **Status:** `LOCKED`
- **Decision:** Exam Spine の Layer 1 read で service-role client を使わない。anon client + cookie session のみを使う。
- **Reason:** service-role は RLS を迂回する。通常の member read でこれを使うと、owner scoping がコードの正しさだけに依存する状態になり、RLS という構造的な防御が無効化される。
- **Alternatives rejected:**
  - *service-role で読んでコード側で user_id を絞る* — 絞り込みを 1 箇所忘れると全ユーザーのデータが読める。
- **Upstream CAREER decision:** `D-L7`（Ordinary member reads must not use service-role bypass）
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerSourceData/serverReader.server.ts`
- **Exam-specific differences:** 受験版の既存 cron / webhook 経路（`lib/supabase/serviceRoleClient.ts`）は対象外。Spine が使わないというルール。
- **Rollback implications:** なし。

## E-L5 — StudentProfile は request-time projection

- **Status:** `LOCKED`
- **Decision:** `ExamSpine.selfUnderstanding` は `self_analysis_logs` から **request-time に決定的に再構築**する。localStorage の `studentProfile` は client projection として維持し、書き込み経路・型・storage helper を変更しない。
- **Reason:** `StudentProfile` を Supabase canonical に昇格させると `self_analysis_logs` と併せて 2 つの原本が生まれる。「第三の権威を追加しない」という不変条件に反する。`self_analysis_logs` は既に auth-scoped で存在し、別端末 restore も稼働中なので、新規テーブル無しで cross-device 問題を解ける。
- **Alternatives rejected:**
  - *A. StudentProfile を Supabase canonical にする* — 二重原本。既存 6 client 画面の書き込み経路改修も必要。
  - *C. StudentProfile を廃止して Spine に統合する* — 6 client 画面と全 cache が壊れる。破壊的。
- **Upstream CAREER decision:** `D-L1` / `D-L2`（Layer 2 は projection であって original record ではない）
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_ARCHITECTURE.md` §5
- **Exam-specific differences:** upstream は Layer 2 を DB に永続化する設計を持つ（read は gate 済み）。受験版は永続化しない（E-P2）。
- **Rollback implications:** localStorage 経路が無改修で残るため、Spine を無効化すれば従来挙動へ即復帰する。
- **関連:** `docs/principles/student_profile_contract.md`（引き続き有効）

## E-L6 — CAREER との runtime 共有を作らない

- **Status:** `LOCKED`
- **Decision:** 受験版と CAREER の間に runtime 依存を作らない。npm 共有 package / git submodule / monorepo 移行のいずれも行わない。CAREER の **ファイルパス**を upstream reference としてコメント・本 Register に記録することのみ許可する。
- **Reason:** 別 GitHub repo・別 Supabase project であり、共通化には package 化 or submodule が要る。これは Spine 設計とは独立したインフラ意思決定であり、CAREER 側が canary 進行中の今に混ぜるべきでない。
- **Alternatives rejected:**
  - *共通 core package を切る* — 両製品を同時に止めるリスク。判断材料も不足。
  - *コードをコピーする* — 二重管理になり、どちらの decision が効いているか判別不能になる。
- **Upstream CAREER decision:** —（受験版固有）
- **Upstream CAREER path:** —
- **Exam-specific differences:** 受験版側だけの制約。
- **Rollback implications:** なし。
- **将来の再判断:** `E-H6`

---

# 4. Spine implementation decisions

## E-S1 — fail-open semantics

- **Status:** `LOCKED`
- **Decision:** fail-open とは「**context を減らして AI を続行する**」ことである。「verified できない古いデータを代わりに使う」ことでは **断じてない**。Spine の read / verify / projection はすべて never-throw で、失敗時は該当 kind を使わずに続行する。
- **Reason:** 「fail-open」という語は「緩い方に倒す」と誤読されやすい。誤読すると stale なデータを prompt に注入する実装になり、Spine 導入の目的（一貫した人物理解）と正反対の結果になる。定義を明文化して固定する。
- **Alternatives rejected:**
  - *検証できないときは古い値を使う* — 人格の破綻を招く。上流が明示的に禁じている。
  - *検証できないときは 500 を返す* — 可用性を落とす。既存挙動の非回帰にも反する。
- **Upstream CAREER decision:** `D-S1` の Failure semantics / Failure philosophy
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_ARCHITECTURE.md` §13
- **Exam-specific differences:** 受験版には fail-closed 対象が存在しない（Layer 4/5 を持ち込まないため）。
- **Rollback implications:** なし（方針）。

## E-S2 — class 1 のみ Source-Sync 検証の対象にする

- **Status:** `LOCKED`
- **Decision:** `device_canonical_mirrored`（class 1）の kind についてのみ Source-Sync 検証を行う。client が算出した revision token を header で申告し、server が mirror から再算出した revision と照合する。**`verified` 以外はすべて使わない（veto）**。
- **Reason:** class 1 では「server が読んだ mirror の内容が、その request を出した端末の canonical と一致する」保証が無い。照合できない限り使わないという一方向の制約を置くことで、stale / 削除済み / 巻き戻った mirror が prompt を汚染する経路を構造的に塞ぐ。
- **重要（過大主張しないこと）:** この signal は **client-provided consistency claim** であり、negative safety gate である。「その申告が本当に localStorage から生成された」という cryptographic proof ではない。保証しているのは「申告と server 可視状態が一致しない限り使わない」だけ。
  - 使ってよい用途: server 側データを「使わない」方向へ倒す veto 入力
  - 使ってはいけない用途: 内容の権威 / DB selector / user_id や権限の根拠
  - 偽造クライアントにできること: 自分自身の stale own-data 使用を自分で許可すること（veto 導入前の既定挙動と同一）。他人のデータ参照・identity 変更・RLS 迂回はいずれも不可能（owner scoping は E-L3 が決める）。
- **verdict の優先順位:** `unreadable` > `unclaimed` > `mismatch` > `verified`（「読めていない」を最優先で表面化し、検証不能を verified に落とさない）
- **Alternatives rejected:**
  - *検証せず mirror を信じる* — 旧来の stale 注入問題がそのまま残る。
  - *content hash を送る* — 本文が network を通る。PII 露出面が増える。
- **Upstream CAREER decision:** `D-S1`（Source-Sync Veto）
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerSourceSync/signal.ts` / `revision.ts`
- **Exam-specific differences:** 受験版は class 2 が 2 kind あるため、適用範囲が upstream より狭い。
- **Rollback implications:** gate を落とせば bridge 経路へ縮退する。unsafe rollback（検証なしで使う経路）は実装しない。

## E-S3 — class 2 に Source-Sync を適用しない

- **Status:** `LOCKED`
- **Decision:** `server_authoritative`（class 2 = `interview_ai` / `presentation`）には Source-Sync 検証を適用しない。authority は「authenticated owner + owner-scoped RLS + server state」である。
- **Reason:** class 2 には「client canonical」という概念が存在しない。client の copy は表示用 cache にすぎないため、Source-Sync を適用すると「client の cache が古い＝server の正しいデータを使えない」という **逆向きの誤り**になる。
- **免除されるのは verification だけ:** canary gate（purpose opt-in AND canary user）は class 2 にも **同じように必要**。authorization は免除されない。
- **Alternatives rejected:**
  - *一律に Source-Sync を適用する* — 上記の逆向きの誤り。
  - *class 2 は gate も免除する* — authorization の穴になる。
- **Upstream CAREER decision:** `D-S10`
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerSourceData/types.ts` の authority class コメント
- **Exam-specific differences:** 受験版の class 2 は 2 kind。
- **Rollback implications:** なし。

## E-S4 — Orchestrator は純関数

- **Status:** `LOCKED`
- **Decision:** Context Orchestrator は I/O・env 参照・Supabase read を一切持たない純関数とする。read は route 側の server loader が担い、Orchestrator へは検証済みの値だけを引数で渡す。
- **Reason:** 純関数であれば snapshot テストで byte 一致を機械的に固定でき、AI を呼ばずに回帰検出できる。I/O が混ざると characterization が成立しない。
- **Alternatives rejected:**
  - *Orchestrator が自分で読む* — テスト不能。呼び出し元ごとに read 回数が変わり read skew も生む。
- **Upstream CAREER decision:** `D-S5` / Orchestrator の設計制約
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerContext/orchestrator.ts`
- **Exam-specific differences:** upstream は 4 ブロックを返す（企業公式情報ブロックを含む）。受験版に対応概念が無いため **3 ブロック**（base / crossFeature / selfUnderstanding）とする。
- **Rollback implications:** なし。

## E-S5 — purpose 単位で 1 回だけ read する

- **Status:** `LOCKED`
- **Decision:** purpose が必要とする kind をまとめて **1 回の read** で解決する。purpose ごとに 2 回以上 Layer 1 を読まない。
- **Reason:** (a) latency と DB 負荷、(b) base と cross-feature が **同じ snapshot** を見る（read skew を作らない）、(c) observability を purpose あたり 1 件に保つ（二重計上の防止）。
- **Alternatives rejected:**
  - *consumer ごとに読む* — upstream で「1 request で同じ table を 2 回読み、その間の write で request 内 snapshot が食い違う」欠陥が実測されている。
- **Upstream CAREER decision:** `D-S6` / `D-S13`
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerServerContext/purposeContext.server.ts`
- **Exam-specific differences:** なし。
- **Rollback implications:** なし。

## E-S6 — request-local snapshot

- **Status:** `LOCKED`
- **Decision:** `Request` インスタンスを key にした `WeakMap` で、その request 中に読んだ kind を保持する。2 番目以降の consumer は **不足 kind だけ**を読む。
- **保証範囲（過大主張しない）:**
  ```text
  保証する  : read-once per kind per request
  保証しない: 複数 table を跨ぐ single transaction snapshot
  ```
- **Reason:** kind ごとに別 select である以上、その間の write は依然観測されうる。read 安全性は E-S2 の veto が担保する。
- **Alternatives rejected:**
  - *global cache* — cross-user 汚染のリスク。
  - *cache しない* — 重複 read と read skew が残る。
- **Upstream CAREER decision:** `D-S13`
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_DECISIONS.md` `D-S13`
- **Exam-specific differences:** なし。
- **Rollback implications:** cache 機構が壊れたら通常 read に落ちる（正しさは cache 無しでも成立）。

## E-S7 — cache hit でも authorize を再評価する

- **Status:** `LOCKED`
- **Decision:** request-local snapshot の cache hit でも `authorize(userId)` を再評価する。userId は reader が authorize hook へ渡す server auth 由来の値を entry 内に保持する（meta にも log にも出さない）。捕捉できていない entry は cache から返さず再 read する（fail-closed）。`unauthorized` / `unauthenticated` の read は **cache しない**。
- **Reason:** これが無いと「緩い gate の consumer が読んだ結果を、厳しい gate の consumer が受け取る」経路ができる。cache は性能最適化であって認可の迂回路であってはならない。
- **Alternatives rejected:**
  - *cache hit では authorize を省く* — 上記の認可迂回。
- **Upstream CAREER decision:** `D-S13`（安全性のために崩さなかったもの）
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_DECISIONS.md` `D-S13`
- **Exam-specific differences:** なし。
- **Rollback implications:** なし。

## E-S8 — `truncated` / `error` を freshness の権威にしない

- **Status:** `LOCKED`
- **Decision:** 履歴系 Source の読み取りに件数上限を設け、上限に達した場合は `truncated` として扱う。`truncated` / `error` の Source から導いた revision を freshness の権威にしない。
- **Reason:** 一部しか読めていない状態から算出した revision は「内容が同じ」ことを意味しない。これを verified に落とすと stale を fresh と誤認する。
- **Alternatives rejected:**
  - *truncated を ok と同一視する* — 誤認のリスク。
- **Upstream CAREER decision:** `D-S1` の Freshness / Layer 1 server-read path
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_ARCHITECTURE.md` §4
- **Exam-specific differences:** なし。
- **Rollback implications:** なし。

## E-S9 — bridge を 2 種類に分類する

- **Status:** `LOCKED`
- **Decision:** bridge を `safety-fallback bridge`（server 経路は完成。mismatch / flag OFF / non-canary / unreadable のときだけ使う＝debt ではない）と `structural bridge`（server-readable な source が存在せず、正常 flow でも必要＝architecture debt）に分類する。観測でも別値で数える。
- **Reason:** 「bridge が残っている」を一括で debt と数えると、意図的な安全装置と本当に未解決の欠落が区別できなくなる。canary 中の高い bridge 率を見て「移行が進んでいない」と誤読する。
- **現状:** 受験版の bridge は原則すべて structural debt（server 経路が存在しないため）。
- **Alternatives rejected:**
  - *bridge を 1 種類として数える* — 上記の誤読。
- **Upstream CAREER decision:** `D-S14`
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_DECISIONS.md` `D-S14`
- **Exam-specific differences:** upstream は既に大半が safety fallback。受験版は移行前なので全部 structural。
- **Rollback implications:** なし（分類のみ）。

## E-S10 — quota / billing は Spine の外

- **Status:** `LOCKED`
- **Decision:** Exam Spine は quota / plan / billing を一切判断しない。既存の `lib/billing/*`（`ensurePlanQuota` / `checkPlanQuota` / `recordUsage`）が単独の判定者であり続ける。Spine load は quota 判定の **前段または並列**に置き、quota reject 時は Spine 結果を破棄して即 return する（AI 課金を発生させない）。
- **Reason:** 責務混在を避ける。また `/api/tutor` は既に quota と context load を `Promise.all` で並列化しており、この構造を壊さない。
- **Alternatives rejected:**
  - *Spine が quota を持つ* — 責務混在。billing の変更が Spine を壊す。
  - *Spine load を quota の後に直列化する* — 既存 route の latency 最適化を退行させる。
- **Upstream CAREER decision:** consultation route の gate 順序規約（有料ゲート → quota → context → AI）
- **Upstream CAREER path:** `PASSAI-CAREER/app/api/career/consultation/route.ts`
- **Exam-specific differences:** 受験版には CAREER の単一プラン有料ゲートに相当するものが無く、`ensurePlanQuota` に統合されている。
- **Rollback implications:** なし。billing コードを一切触らない。

## E-S11 — rollout は default deny

- **Status:** `LOCKED`
- **Decision:** Spine の有効化は **purpose flag AND user allowlist の連言**とし、default deny とする。env 未設定 / 空 / 不正値はすべて「誰も許可しない」に倒す。コードに default true や development 自動 ON を入れない。将来 4 層設計（master enabled / rollout scope / allowlist / denylist）へ拡張する。
- **Reason:** master flag だけ ON にしても allowlist が空なら誰にも届かない（no-op）。「全開放する意思」を別 env で明示させることで、事故 ON を構造的に防ぐ。緊急 deny list は master flag を落とさずに個別縮退するための経路。
- **Alternatives rejected:**
  - *purpose flag だけで全ユーザーへ有効化* — canary 段階を飛ばすことになる。
  - *2 env（purposes / allowlist）に簡略化* — upstream が 4 env に分けた理由（no-op 問題・緊急縮退）が受験版にもそのまま当てはまる。
- **Upstream CAREER decision:** `D-S4`（Canary activation gate）
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerServerContext/canaryGate.server.ts` / `PASSAI-CAREER/lib/careerMemory/persistence/readGateConfig.server.ts`
- **Exam-specific differences:** env 名は受験版固有（`EXAM_SPINE_*`）。CAREER の env 名前空間を一切使わない。
- **Rollback implications:** env を落とすだけで従来挙動へ復帰する。**unsafe rollback 経路（検証なしで stale を使う code path）は実装しない。**
- **Stage 0 での扱い:** env も runtime gate も実装しない。設計判断のみ固定（Human Decision D2）。

## E-S12 — observability は enum のみ

- **Status:** `LOCKED`
- **Decision:** Spine の観測語彙は enum に限定する。記録軸は `purpose` / `sourceOrigins`（kind → server / bridge / not_server_capable）/ `sourceVerdicts` / `coverage` / `baseReason`。counter の key 空間を有界に保つ。
- **Reason:** 自由文字列を許すと counter の key が無限に増え、かつ PII が混入する経路ができる。enum に限定することで PII を **構造的に**持てなくする。
- **Alternatives rejected:**
  - *自由文字列の label* — key 空間の爆発と PII 混入。
- **Upstream CAREER decision:** `D-S4` の Observability
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerDataSpineCanary/observation.ts`
- **Exam-specific differences:** なし。
- **Rollback implications:** なし。

## E-S13 — PII / 本文 / UUID を観測ログへ出さない

- **Status:** `LOCKED`
- **Decision:** Spine の log・counter・戻り値の meta に、氏名 / 本文 / 生の Supabase error / env 値 / user UUID を出さない。
- **Reason:** 観測は障害切り分けのためのものであり、個人データの副次的な流出経路にしてはならない。`lib/contextBuilders/tutorContext.ts` の既存 `[TutorContextSources]` も duration と真偽のみを出力しており、その方針を Spine 全体へ広げる。
- **Alternatives rejected:**
  - *デバッグのため一時的に出す* — 一時が恒久化する。必要なら enum で表現する。
- **Upstream CAREER decision:** `D-S4` / `D-L7` の log 制約
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerSourceData/serverReader.server.ts` 冒頭
- **Exam-specific differences:** なし。
- **Rollback implications:** なし。

## E-S14 — テスト基盤は `scripts/*.ts` + `npx tsx`

- **Status:** `LOCKED`（Human Decision D1）
- **Decision:** Stage 0〜4 のテストは `scripts/*.ts` + `npx tsx` 方式で書く。vitest 等のテストフレームワークを追加しない。**Stage 0〜4 では dependency 追加禁止。**
- **Reason:** 受験版の既存 QA はすべてこの方式（`scripts/*-qa.ts` 12 本）。upstream も 192 本の script + Playwright で運用しており、この方式で十分機能する実績がある。dependency 追加は独立した判断として後回しにできる。
- **Alternatives rejected:**
  - *即座に vitest を導入する* — Stage 0 の scope を超える。dependency 追加は今回禁止事項。
- **Upstream CAREER decision:** —（受験版固有）
- **Upstream CAREER path:** `PASSAI-CAREER/scripts/` の QA script 群（方式の参考）
- **Exam-specific differences:** —
- **Rollback implications:** script の削除のみ。
- **再判断:** `E-H3`（Stage 5 の前）

## E-S15 — `presentation` の table registry を read graph と一致させる

- **Status:** `LOCKED`
- **Decision:** `EXAM_SOURCE_TABLES.presentation` を `presentation_results` / `presentation_attempts` / `presentation_sessions` の 3 table とする。reader が実際に読む table を registry が過不足なく覆う。
- **Reason:** presentation の read graph は `presentation_results → attempt_id → presentation_attempts → session_id → presentation_sessions` であり、enrichment が `presentation_sessions` を実際に読む。registry に無い table を reader が黙って SELECT する状態を残すと、「どの table が Spine の権限内か」が registry から読めなくなる。
- **Alternatives rejected:**
  - *`presentation_sessions` を読まない* — 大学 / 学部 / テーマ / 発表形式は presentation purpose の context 本体であり、読まないと機能しない。
  - *registry を read graph の部分集合のままにする* — QA が「registry 外 SELECT」を検出できなくなる。
- **Upstream CAREER decision:** —（受験版固有）
- **Exam-specific differences:** 1 kind が複数 table にまたがるため CAREER の 1:1 map ではなく配列で持つ。
- **Rollback implications:** 宣言のみ。runtime 挙動を持たない。
- **補足:** これは **1:N registry の completeness 修正**であり、新しい `ExamSourceKind` の追加ではない。

## E-S16 — `presentation_practice_records` は `dormant_no_author`

- **Status:** `LOCKED`
- **Decision:** `presentation_practice_records` を `ExamSourceKind` に追加せず、authority binary（`device_canonical_mirrored` / `server_authoritative`）にも入れず、Stage 3 reader から SELECT しない。分類は `dormant_no_author`。
- **Reason:** schema と write route（`app/api/presentation/practice-record/route.ts`）は存在するが、`app/**` / `lib/**` に呼び出し元が 1 つも無く、実質的に行が書かれていない。著者のいない table を kind に昇格させると、authority class の 2 分類がどちらも当てはまらない例外を作ることになる。
- **Alternatives rejected:**
  - *11 個目の kind として追加する* — 著者がいないため authority を決められない。
  - *authority token を 3 分類へ rename する* — 既存 2 分類の意味は正しく、dormant は authority の軸ではない。
- **Upstream CAREER decision:** —（受験版固有）
- **Exam-specific differences:** —
- **Rollback implications:** 宣言のみ。
- **補足:** これは「将来も使わない」という決定ではなく **現時点の観測事実の記録**である。使うことになった時点で kind 追加として別 decision を起こす。

## E-S17 — Stage 3 の出力は未 verify な server candidate

- **Status:** `LOCKED`
- **Decision:** Stage 3 の reader が返す `ExamSourceBundle` は **未 verify な候補**として扱う。`device_canonical_mirrored` の 8 kind について「server row が存在する == canonical」と解釈しない。Stage 3 の結果**だけ**を理由に bridge / client source を排除しない。
- **Reason:** class 1 の canonical は端末の localStorage であり、server の mirror が「今 request を出している端末の canonical」と一致する保証が無い（E-L1 / E-S2）。ここで verified を名乗ると、Stage 4 の Source-Sync が「既に verified なものを再検証する」意味の無い層になる。
- **Alternatives rejected:**
  - *Stage 3 で verified フラグを付ける* — 検証していないものに verified と名付けることになる。
  - *server row があれば bridge を止める* — 古い mirror で新しい端末の入力を上書きする事故経路になる。
- **Upstream CAREER decision:** `D-S2` 系（Source-Sync の負の安全ゲート）
- **Exam-specific differences:** class 2（`interview_ai` / `presentation`）は Source-Sync の対象外だが、Stage 3 では runtime activation 自体をしないため差は出ない。
- **Rollback implications:** なし（Stage 3 は runtime に接続しない）。

## E-S18 — `interview_ai` は result を driver にする

- **Status:** `LOCKED`
- **Decision:** `interview_ai` の読み取りは `interview_ai_results` を driver とし、`created_at DESC, id DESC` で **result が実在する最新 record**を取る。親 `interview_ai_sessions` は `!inner` embed で解決し、所有は **session 側**の `user_id` でも filter する。
- **Reason:** 旧経路（最新の completed session を取り、その session の result を探す）は、production の実形状（completed session が多数 / result は少数）では空振りが常態化する。最新 session に result が無いというだけで、実在する過去の result まで一切見えなくなる。また RLS（schema §60）は親 session の所有を EXISTS で判定する設計なので、query 側でも同じ構造で閉じる。
- **Alternatives rejected:**
  - *session を driver にして result を後追いする* — 上記の空振りが起きる。
  - *results の `user_id` だけで閉じる* — 列は複製にすぎず、親の所有と結果の所有が一致することを構造的に保証しない。
- **Upstream CAREER decision:** —（受験版固有 / class 2 の server_authoritative source）
- **Exam-specific differences:** `interview_ai_turns`（逐語）は SELECT しない（E-P5）。
- **Rollback implications:** query 定義の変更のみ。

## E-S19 — read cap は read layer が所有し、Stage 2 の budget と分離する

- **Status:** `LOCKED`
- **Decision:** history / array source は `EXAM_READ_CAPS` に **row count cap** を持ち、`cap + 1` 件取得して `<= cap` を `ok` / `cap + 1` を `truncated` とし余剰行を drop する。count query は追加しない。これは Stage 2 の `EXAM_CONTEXT_BUDGETS`（character budget）とは別物であり、相互に流用しない。
- **Reason:** 無制限 read は 1 request の latency と memory を予測不能にする。一方で「prompt に何文字載せるか」は feature の判断であり、read layer が持つと Stage 2 の byte-equivalence と二重管理になる。cap + 1 方式なら追加 round-trip 無しで truncated を判定できる。
- **Alternatives rejected:**
  - *count query で総数を取る* — 1 往復増やす価値が無い。
  - *Stage 2 の budget から row 数を導く* — 文字数と行数は別次元で、budget は現状 `observed_only` が大半（enforcement contract ではない）。
- **Upstream CAREER decision:** —（受験版固有）
- **Exam-specific differences:** —
- **Rollback implications:** 定数変更のみ。**Stage 2 の budget は引き続き enforce しない。**

## E-S20 — row mapper は policy-free で、既定値を持たない

- **Status:** `LOCKED`
- **Decision:** row mapper は「server row → 同型 projection」だけを行う。Supabase / fetch / localStorage / server auth / Date / Math.random / prompt 文言 / 日本語見出し / feature ラベル / storage を持たない。`max` / `maxItemLength` の類は **required argument** とし、mapper 内に既定値を置かない。jsonb と embedded relation は必ず shape guard（`asRecord` / `firstRecord` / `unwrapEmbedded`）を通し、object / 配列 / null のいずれでも throw しない。
- **Reason:** 既定値は「なぜその長さか」という feature 都合を mapper に埋め込む経路になり、後から policy がどこにあるか追えなくなる。PostgREST の embedded relation は同じ relation でも object / 配列 / null のいずれでも返り得るため、型 assertion して field access すると schema 変更で落ちる。
- **Alternatives rejected:**
  - *使いやすさのため既定値を持たせる* — 呼び出し側が値を意識しなくなり、policy が暗黙化する。
  - *jsonb を domain 型へ cast する* — 実データが型と食い違ったときに throw する（`basic_info_logs.payload` に氏名が無い件が実例）。
- **Upstream CAREER decision:** `D-L7` 系（rowMapper の純粋性）
- **Exam-specific differences:** —
- **Rollback implications:** なし。

## E-S21 — request-local snapshot（`WeakMap<Request, …>`）

- **Status:** `LOCKED`
- **Decision:** 1 request 内で同じ kind を 2 度読まないための memo を `WeakMap<Request, …>` で持つ。global TTL cache（module-level `Map<userId, …>` + TTL）を作らない。認可は **cache hit でも毎回**再評価し、unauthenticated / unauthorized の結果は保存も返却もしない。保存済み entry の userId が認可結果と一致しない場合はその entry を破棄する。snapshot を外しても reader の正しさが変わらない設計にする。
- **Reason:** userId を key にした module-level Map は、process 内で request を跨いで他人の request が入れた値に触れ得る構造になる。TTL は「いつの時点のデータか」を曖昧にし、Stage 4 の verification を無意味にする。また「stale を使わない」という fail-open の定義（E-S1 / E-S8）と正面から衝突する。`WeakMap<Request>` なら別 request での再利用が **構造的に**起きず、TTL も明示 invalidation も不要になる。
- **Alternatives rejected:**
  - *60 秒 TTL の per-user cache* — 上記のとおり request 跨ぎと stale の両方を招く。
  - *cache hit 時に認可を省く* — snapshot は読み取り結果の memo であって認可の memo ではない。
- **Upstream CAREER decision:** `D-S3` 系（request-local snapshot）
- **Exam-specific differences:** —
- **Rollback implications:** snapshot 経路を外すだけで reader の出力は変わらない。

## E-S22 — query を data として持ち、I/O 境界を 1 箇所に閉じる

- **Status:** `LOCKED`
- **Decision:** 各 kind の SELECT を `ExamReadQuery`（table / 列配列 / filter / ordering / limit / mode）という **データ**として宣言し、実行は注入された `ExamReadExecutor` 1 本に閉じる。実際に PostgREST を叩くのは `supabaseExecutor.server.ts` だけとする。
- **Reason:** (1) read layer が Supabase / next を知らずに済み、純粋で決定論的になる。(2) QA が ordering / limit / filter / **列名**を宣言的に freeze でき、「逐語列を SELECT していない」を文字列 grep ではなく構造で示せる。(3) `ExamReadQuery` は SELECT しか表現できないため、mutation を書く手段が構造的に存在しない。(4) 実 DB 無しで cap + 1 / enrichment 本数 / embedded の形まで検証できる。
- **Alternatives rejected:**
  - *reader が直接 Supabase client を呼ぶ* — 実 DB 無しでは query shape を検証できず、mutation 禁止も grep 頼みになる。
  - *ORM / query builder を導入する* — dependency 追加禁止（E-S14）。
- **Upstream CAREER decision:** —（受験版固有）
- **Exam-specific differences:** —
- **Rollback implications:** executor 差し替えのみ。

## E-S23 — canonical lineage は Stage lineage（L2）とする

- **Status:** `LOCKED`（Wave 1 判定 / Wave 2 で実コード再検証のうえ確定）
- **Decision:** `lib/examSpine/**` の contract と実装は `exam-spine-stage3` 系列（Stage 1→2→3）を canonical とする。`feature/interview-realtime-step1` 上の `lib/examSpine/**`（Phase 1〜3.5）を canonical contract として採用しない。**shipping runtime は停止させない**（E-S24）。
- **Reason（Wave 2 で再検証した順に）:**
  1. **LOCKED decision との矛盾**: shipping の `lib/examSpine/read/snapshot.server.ts` は module-level `Map<key,{value,expiresAt}>` + 60 秒 TTL であり（`lib/contextBuilders/tutorContext.ts:915` が `CONTEXT_CACHE_TTL_MS = 60_000` / key = `userId` または `${userId}|parity`）、これは **E-S6 が "global cache — cross-user 汚染のリスク" として reject した alternative** そのものである。E-S6 は shipping 側の Register にも LOCKED で存在する。
  2. **registry が read graph を覆っていない**: shipping の `EXAM_SOURCE_PRIMARY_TABLE` は 1 kind 1 table だが、reader は `presentation_attempts` / `presentation_sessions`（`readPresentationSessionByAttempt`）と `interview_ai_results`（embed）を実際に読む。Canon §22 を満たさない。canonical 側は E-S15 でこれを 1:N registry として修正済み。
  3. **orphan**: shipping の `lib/examSpine/purpose.ts` は repo 全体で import 元 **0 本**（Wave 2 再確認）。宣言が runtime に効いていない。
  4. **Register 未登録**: shipping は Phase 1〜3.5 で canary flag / TTL cache / parity reader 3 本 / prompt 合成切替を production へ入れているが、Register への追加は E-H2 の RESOLVED 更新 1 件のみ（Wave 2 で全 6 worktree の Register を比較して確認）。
  5. **runtime evidence は失われない**: shipping の runtime 実態は `EXAM_SPINE_STAGE3_READINESS_AUDIT.md` 経由で canonical 側の `queries.ts` / E-S18 / E-S19 / E-S20 に取り込み済み。E-S18（`interview_ai` は result を driver にする）は production 実測（sessions 37 / results 1）から導かれている。
- **Alternatives rejected:**
  - *shipping を canonical にする* — 上記 1〜4。Stage 1/2/3 の contract 4,618 行を捨て、Stage 4 の型基盤（`ExamSourceBundle` / 4 値 status / origin / provenance）を作り直すことになる。
  - *両方を canonical にする* — `lib/examSpine/types.ts` が同一パス別内容であり技術的に共存不能。Canon §31 の Dual Authority 禁止の architecture 版。
  - *2 lineage を融合した新 architecture を作る* — Canon §59（architecture decisions are frozen）に反する。残 blocker はすべて既存 contract の充填で解消できることを Wave 2 で実証した。
- **Rollback implications:** 本 decision 単体では runtime を変えない。shipping の `/api/tutor` 経路は無改変で稼働し続ける。

## E-S24 — 拒否した lineage の read 実装は削除せず canonical namespace の外へ退避する

- **Status:** `LOCKED`（実施は shipping worktree 側。canonical worktree からは実行しない）
- **Decision:** shipping の Exam Spine read 実装を `lib/examSpine/**` の外へ **移設**する。削除しない。移設は import path の書き換えのみとし、production 挙動を 1 byte も変えない。orphan である `lib/examSpine/purpose.ts`（import 元 0 本）だけは移設せず削除してよい。
  ```text
  lib/examSpine/read/reader.server.ts    → lib/contextBuilders/tutor/serverRead/reader.server.ts
  lib/examSpine/read/rowMappers.ts       → lib/contextBuilders/tutor/serverRead/rowMappers.ts
  lib/examSpine/read/snapshot.server.ts  → lib/contextBuilders/tutor/serverRead/snapshotCache.server.ts
  lib/examSpine/types.ts（SourceState 系）→ lib/contextBuilders/tutor/serverRead/sourceState.ts
  lib/examSpine/purpose.ts               → 削除（import 元 0 本）
  ```
- **import graph（Wave 2 実測。この 2 file 以外に参照は無い）:**
  ```text
  lib/contextBuilders/tutorContext.ts:67,82,83,84   … 4 module すべて
  scripts/exam-spine-live-source-check.ts:85        … reader.server.ts のみ（動的 import）
  ```
- **Reason:** Canon §46 は「新経路が production で確認される前に legacy を削除しない」と定める。tutor は現在唯一の server read 経路であり、削除も書き換えもできない。一方 canonical を L2 にすると `types.ts` / `read/rowMappers.ts` が同一パスで衝突する。**移設**が両方の要求を同時に満たす唯一の手段である。
- **Alternatives rejected:**
  - *shipping の read 層を削除して tutor を canonical reader へ即移行する* — Canon §43 / §45 に反し、1 commit で production の tutor 経路を全面差し替えることになる。
  - *canonical を別 namespace（`lib/examSpine2/` 等）へ置く* — どちらが canonical かがパスから読めなくなる。Canon §84 に反する。
- **受け入れ条件（移設 commit の DoD）:**
  ```text
  qa:examSpine:tutorLoader        PASS（fixture 無改変）
  qa:examSpine:tutorComposition   PASS（fixture 無改変）
  qa:examSpine:tutorCanary        PASS
  qa:examSpine:characterization   PASS
  npx tsc --noEmit                exit 0
  app/api/tutor/route.ts          差分ゼロ
  ```
- **Rollback implications:** 移設 commit の revert のみ。挙動不変なので rollback による挙動変化も無い。

## E-S25 — Stage 2 の block / orchestrator / budget を canonical contract として凍結する

- **Status:** `LOCKED`
- **Decision:** `lib/examSpine/blocks/**` / `lib/examSpine/orchestrator/**` / `lib/examSpine/budget.ts` を Layer 2〜5 の canonical contract とする。`budget.ts` は引き続き **enforce しない**。legacy formatter は再実装せず import し続ける。
- **Reason:** Canon §34（Context Builder は Source of Truth を探さない）/ §35（Prompt と Data Retrieval の分離）に構造で適合し、17 purpose × 35 block の byte-equivalence を持つ（Wave 2 実測 888 checks PASS）。依存 formatter 8 file が両 lineage で完全一致しているため、shipping branch へ無改変で移植できる。
- **★ 凍結は「完成」を意味しない（Wave 2 で確定した被覆範囲）:**
  ```text
  Stage 3 が読む kind        : 10
  Stage 2 の block が参照する kind : 4（basic_info / activity / self_analysis / statement_review）
  block を持たない kind      : 6（diagnosis / self_pr / essay / interview_record / interview_ai / presentation）
  ```
  したがって Stage 3 bundle をそのまま prompt へ流せる purpose は現時点で存在しない。
  **consumer 移行（Stage 5/6）の前に、対象 purpose が使う kind の block を足す必要がある。**
  凍結対象は「今ある block の contract」であって「block 集合の完全性」ではない。
- **Alternatives rejected:**
  - *block を捨てて purpose ごとに route へ組み立てを戻す* — Canon §49 が禁じる集約関数へ回帰する。
  - *Stage 2 で budget を enforce する* — E-P7 に反し、`basis: 'observed_only'` の見積り値で本文を切ることになる。
- **Rollback implications:** runtime 未接続のため revert で production 影響ゼロ。

## E-S26 — Context origin は kind / block 単位で持つ（単一 origin を廃止する）

- **Status:** `LOCKED`（Wave 2 で実装 + QA 済み）
- **Decision:** `ExamContextInput.origin`（context 全体で 1 値）を **fallback へ降格**し、origin を kind 単位（`origins?: Partial<Record<ExamSourceKind, ExamContextOrigin>>`）と、durable source を持たない slot 単位（`notServerCapableSlots?: readonly ExamNotServerCapableSlot[]`）で申告できるようにする。block は自分の `sourceKind` に対応する申告を受け取る。
- **単一値では不十分であることの証明（Wave 2 / 実コード）:**
  ```text
  変更前 lib/examSpine/blocks/build.ts
    const origin = input.origin ?? 'bridge';
    return EXAM_CONTEXT_BLOCK_IDS.map((id) => createExamContextBlock(..., origin));
      → 全 35 block に同一値をコピー。block 型は origin を持つが、build 経路が
        block ごとに異なる origin を持てなくしていた。
  ```
  実際に同時成立する 3 origin:
  ```text
  basic_info      server              … tutor は既に server で読んでいる
  activity        bridge              … server 経路はあるが canary OFF なら body 由来
  statementDraft  not_server_capable  … durable table が存在しない（E-P3 で恒久）
  ```
  Canon §17 は「暗黙的 Mixed-Origin」を禁止し、`Definition of Done — Sync`（§68）は
  「mixed-origin が追跡可能」を要求する。E-P7（server が空で bridge に中身があれば bridge を維持）は
  **per-field の判断**を要求するため、単一値では移行期の実態を表現できない。
- **推測しない:** 申告の無い kind を「server 経路があるはずだから server」と補完しない。補完すると Spine 自身が暗黙的 Mixed-Origin を作る。申告が無ければ fallback（既定 `'bridge'`）。
- **Alternatives rejected:**
  - *purpose 単位で origin を持つ* — 同一 purpose の中で kind ごとに origin が違うのが移行期の常態。
  - *origin を観測ログにだけ持つ* — 型で持たないと暗黙的 Mixed-Origin を構造的に防げない。
- **QA:** `scripts/exam-spine-stage2-check.ts` の E1〜E5（3 origin の同時成立 / 未申告 kind を補完しない / origin を変えても block content が 1 byte も変わらない）。
- **Rollback implications:** origin は render に出ないため byte-equivalence に影響しない（888 checks PASS で確認済み）。Stage 4 の Context object 本体は **本 decision の範囲外**（型境界のみ）。

## E-S27 — `essay` の read は field 単位 projection とし、本文を server projection に載せない

- **Status:** `LOCKED`（Wave 2 で実装 + QA 済み）
- **Decision:** `essayQuery` の SELECT を `workspace` 丸ごとから `reviews:workspace->reviews` へ絞り、`mapEssayRow(row, limits)` が各 review から **`essayBodySnapshot` を落として**採る。`ExamEssayServerRow` / `ExamEssayReviewServerRow` に `readonly bodyOnServer: false` を置き、「server 由来 essay に本文がある」と書いたコードが型検査で落ちるようにする（E-P8 と同じ手法）。reviews は append-only なので新しい順に並べ替え、`limits.recordItems` 件で cap し、`reviewCount` / `reviewsTruncated` を保持する。
- **Reason（Wave 2 で判明した非自明点）:**
  ```text
  EssayWorkspace（types/essay.ts）の本文系:
    workspace.body                                … 小論文本文（正本）
    workspace.reviews[*].essayBodySnapshot        … 添削時点の本文の複製（reviews は最大 20 件）
    workspace.improvementInProgress.rewriteDraft  … 改善後リライト本文
    workspace.sparring.answers[]                  … 壁打ちへの本人回答
  ```
  変更前は `workspace` を丸ごと SELECT し、`mapEssayRow` が `asRecord()` で素通ししていたため、
  cap 5 行 ＋ 1 の各行について上記すべてが bundle に載っていた。
  **さらに重要な点:** shipping が採っていた `workspace->reviews` への絞り込み**だけでは足りない**。
  `ReviewEntry.essayBodySnapshot` があるため、reviews に絞っても本文の複製が最大 20 件流れる。
  query 側の絞り込みと mapper 側の除去は **1 組で初めて対策になる**。
- **残余（意図的に受け入れる範囲）:** `workspace->reviews` は PostgREST 上で `essayBodySnapshot` を含んだまま転送される（jsonb の sub-field を除外する PostgREST 表現が無いため）。**bundle には載らない**が network 転送は残る。これを消すには生成列か正規化 table が要り、DB migration を伴うため本 Stage の範囲外とする。
- **live 検証の限界（Canon §80）:** PostgREST は jsonb の sub-path を検証しない（存在しない `workspace->zzz` も 200 を返す）ことを Wave 2 で実測した。したがって `->reviews` の妥当性は **live schema check では証明できない**。根拠は shipping production で同じ projection が稼働している事実（`readLatestEssayReviewsRow`）である。
- **Alternatives rejected:**
  - *mapper 側だけで本文を落とす* — 転送は既に発生している。read layer の責務として境界の手前でも絞る。
  - *cap を 1 行にする* — 1 行でも本文全体が載る。行数の問題ではない。
  - *推測で生成列 / 正規化 table を前提にする* — 本番に存在しない column を production code に入れない。
- **QA:** `scripts/exam-spine-stage3-check.ts` S15b/S15c/S15d（bundle に `essayBodySnapshot` が現れない / cap と truncated / `->` が text 返却・壊れた JSON・null でも throw しない）。

## E-S28 — purpose gate を canonical contract として持ち、default deny とする

- **Status:** `LOCKED`（Wave 2 で実装 + QA 済み）
- **Decision:** `EXAM_CONTEXT_REGISTRY[purpose]` に `sources: readonly ExamSourceKind[]` と `sourceEvidence`（kind ごとの実コード根拠）を持たせ、`gateExamSourceKinds(purpose, requested)` を唯一の判定点とする。`readExamSources` / `readExamSourcesForRequest` は optional な `purpose` を受け、許可外 kind については **query を 1 本も発行せず** `status='skipped'` / `queryCount=0` のままにする。落とした kind は `deniedByPurpose` として返す（enum のみ / PII なし）。
- **default deny:** registry に無い purpose、`sources` に無い kind はすべて拒否。未知の purpose に対して「全部読む」「基本情報だけ読む」等の暗黙の特権拡大をしない。gate は **減らす方向にしか働かない**（許可されているが要求されていない kind を足さない）。
- **Reason:** Canon §55（available data ≠ prompt へ全部送る）と Stage 3 の共通契約「registry に無い kind は query を発行しない」を満たす data source が canonical 側に存在しなかった。shipping 側の `EXAM_PURPOSE_REGISTRY` は 8 purpose 分の `sources` を持つが orphan（E-S23-3）であり、内容も再検証が必要だった。
- **★ shipping の宣言をそのまま移植しなかった理由（Wave 2 の実測）:**
  ```text
  shipping: interviewAi.sources = ['basic_info','self_analysis','statement_review','essay']
            provenance「app/api/interview-ai/** は basicInfo / studentProfile / activityData を参照しない」

  実際     : app/interview/ai/sourceData.ts:19-23 が client 側で 5 feature を集約する
            self_analysis / activity / statement_review / essay / interview_record
            → basic_info は **使っていない**（over-declaration）
            → activity / interview_record が **欠落**（under-declaration）
  ```
  route の body field 名ではなく、その context を組み立てるために読まれている storage / table を根拠にする。
- **同様に訂正した例:**
  ```text
  essay_review        : previousOutputSummary を送る client が存在しない
                        （buildPreviousOutputSummary の呼び出しは
                         app/statement/edit/page.tsx:482 と
                         app/interview/record/.../InterviewRecordForm.tsx:151 の 2 箇所のみ）
                        → sources は basic_info のみ
  interview_feedback  : previousOutputSummary は getInterviewRecords() 由来
                        → statement_review ではなく interview_record が正しい
                        （同じ block id でも purpose が違えば source kind が違う）
  ```
- **Alternatives rejected:**
  - *block の `sourceKind` から purpose の sources を導出する* — `previous_output_summary` のように **同じ block id が purpose によって別 kind から作られる**ため導出できない。purpose → kind を直接持つ。
  - *「将来読みたい kind」も宣言しておく* — default deny の意味が消える。必要になった時点で Decision を起こす。
- **QA:** `scripts/exam-spine-stage3-check.ts` S20/S20b/S20c/S20d/S21（許可外は query 0 本 / 未知 purpose は全拒否 / gate は拡張しない / gate は snapshot の手前 / registry の内部整合）。
- **Rollback implications:** `purpose` を渡さなければ従来どおり `kinds` がそのまま使われる。runtime 未接続のため production 影響ゼロ。

## E-S29 — Canonical Exam Context は blocks だけが本文を持ち、sources は metadata に限る

- **Status:** `LOCKED`（Stage 4 で実装 + QA 済み）
- **Decision:** `CanonicalExamContext`（`lib/examSpine/context/types.ts`）は次の構造を持つ。
  ```text
  version / purpose / status / subject / blocks / sources / allowedSources /
  deniedSources / revision / fingerprint / veto / omissions / diagnostics
  ```
  **prompt へ載る文字列は `blocks` にしか存在しない。** `sources` は 10 kind すべてについて
  必ず 1 件返るが、保持するのは metadata（state / readStatus / syncStatus / origin /
  bridgeFields / rowCount / truncated / fingerprint / revision / authority / tables /
  contribution / blocks）だけで、**生の値を 1 つも持たない**。
- **Reason:** Stage 2 の block は現時点で 10 kind 中 4 kind しか覆っていない（E-S25）。
  block を持たない 6 kind の値を context に載せる場所を作ると、**block 化されていない
  kind の本文が prompt 経路へ紛れ込む口**ができる。実例として `essay` は
  `workspace->reviews` 経由で `essayBodySnapshot` を含み得る（E-S27 の残余）。
  sources を metadata に限ることで、この経路が**構造的に存在しなくなる**
  （Canon §55 / E-P5）。block coverage が広がるまで Stage 4 が止まる必要も無くなる。
- **subject（識別子境界）:** context は `userId` を持たない。認可済みであることと
  `subjectFingerprint`（userId の domain-separated hash）だけを持つ（E-S13）。
- **bridgeFields（明示的 Mixed-Origin）:** origin が `server` の kind でも、
  一部 field が bridge 由来なら `bridgeFields` に列挙する。現状の実例は
  `basic_info` の `name`（server の payload に存在しない / E-P8）。
  Canon §17 が禁じるのは **暗黙の** Mixed-Origin であり、列挙すれば許容される。
- **immutability:** context / sources / blocks / diagnostics / 各 provenance を
  `Object.freeze` する。downstream が破壊的変更で provenance を書き換えられないようにする。
- **Alternatives rejected:**
  - *sources に値を持たせ、block が無い kind も context へ載せる* — 本文混入経路を作る。
  - *block を持たない kind を context から消す* — 「読んだが使わなかった」ことが
    説明できなくなり、Canon §39（provenance）を満たせない。
- **Rollback implications:** runtime 未接続（import 元は QA のみ）のため production 影響ゼロ。

## E-S30 — read status / sync verdict / context state を 1 つの enum に混ぜない

- **Status:** `LOCKED`（Stage 4 で実装 + QA 済み）
- **Decision:** source の状態を **3 軸**で保持する。
  ```text
  readStatus  : ok | truncated | error | skipped        … Stage 3。取得できたか
  syncStatus  : verified | mismatch | unclaimed | unreadable | incomparable | null
                                                        … Stage 4 sync。信用してよいか
  state       : available | empty | denied_by_purpose |
                unreadable | unverified | unsupported   … context にとって何であったか
  ```
  `state` は Canon §40 が要求する区別を潰さない。特に次の 4 つは**すべて別状態**である。
  ```text
  DB が 0 行             → empty
  purpose が許可しない   → denied_by_purpose（query を 1 本も発行していない）
  query が失敗した       → unreadable
  Spine が対応していない → unsupported
  ```
- **★ 「読めて 0 件」は Source-Sync より手前で確定させる:** class 1 の kind でも
  `readStatus === 'ok'` かつ 0 行なら、verify に回さず `empty` にする。
  verify に回すと device 申告が無い間ずっと `unclaimed` → `unverified` になり、
  **「データが無い新規ユーザー」と「検証できない」が区別できなくなる**（Canon §40 違反）。
  0 件なら注入され得る内容が存在しないので、verified を待つ意味も無い。
- **context status:** `ok`（要求 source がすべて available / empty）/ `partial`（一部が
  unreadable・unverified・unsupported だが使えるものがある）/ `degraded`（available が
  1 つも無い。**それでも AI は続行する** = fail-open）/ `vetoed`。
- **Reason:** 1 enum に畳むと必ずどれかが失われる。`truncated` を `ok` に寄せれば
  E-S8 に反し、`unclaimed` を `mismatch` に寄せれば「一致しない証拠」が無いのに
  不一致を主張することになり、`empty` を `unreadable` に寄せれば Canon §15 に反する。
- **Alternatives rejected:**
  - *単一の status enum に統合する* — 上記のいずれかが必ず潰れる。
  - *state を bool（usable / not usable）にする* — omission の理由が説明できなくなる。
- **Rollback implications:** なし（型と分類のみ）。

## E-S31 — revision は入力状態、fingerprint は出力 context の識別子

- **Status:** `LOCKED`（Stage 4 で実装 + QA 済み）
- **Decision:** Canon §16 の 2 概念を役割で固定し、混同しない。
  ```text
  revision     入力状態の識別子。どの source の、どの論理状態から作ったか。
               材料 = kind / state / source fingerprint / revision form / rowCount / truncated
               purpose・block 選択・render・時刻・userId に依存しない。
               → 同じユーザーデータなら tutor 用でも matching 用でも同じ revision。

  fingerprint  出力 context の識別子。consumer が受け取るものが同一かを比較する。
               材料 = version / purpose / revision / allowedSources /
                      block(id・presence・origin・provenance・derivation・content の hash・長さ) /
                      source(kind・state・origin・contribution・bridgeFields)
               → 同じ revision でも purpose が違えば別 fingerprint。
  ```
- **決定性の要件（すべて QA 済み）:** 同一入力 → 同一値 / sources・allowedSources の
  順序に依存しない / Request identity と実行時刻に依存しない / canonical data が変われば変わる。
  block の順序には**意図的に依存する**（順序が変われば prompt が変わるため）。
- **★ hash 材料に prompt 本文を置かない:** block の `content` は氏名・志望理由書・
  小論文の断片を含む。材料 object に生で入れると、その object を誤って log や
  diagnostics へ出した瞬間に PII 露出になる（E-S13）。したがって **content は先に
  1 段 hash してから**材料へ載せる。1 文字変われば block hash が変わるので情報は落ちない。
- **hash 実装:** sync core の `examFingerprint`（安定 serialization ＋ 自作 SHA-256）を使う。
  **context 層で別の hash 実装を作らない**（E-P9 / 単一 authority）。dependency も追加しない（E-S14）。
- **Alternatives rejected:**
  - *revision と fingerprint を 1 つにする* — 「内容が同じでも purpose が違えば別物」か
    「purpose が同じなら入力が変わっても同じ」のどちらかの誤りが必ず起きる。
  - *時刻や request id を材料に入れる* — 毎回変わり、比較の意味が消える。
- **Rollback implications:** なし（純関数）。

## E-S32 — veto は contract 違反のみを対象とし、データ不足は fail-open で通す

- **Status:** `LOCKED`（Stage 4 で実装 + QA 済み）
- **Decision:** veto する理由を次に限定する。
  ```text
  unknown_purpose               registry に無い purpose（E-S28 default deny）
  unauthenticated / unauthorized server auth が解決できない / 認可されない（E-L3 / E-S7）
  forbidden_source_contribution purpose が許可していない kind に read の痕跡がある
  unregistered_table            registry 外の table を読んだ（E-S15 / Canon §22）
  provenance_incomplete         寄与している source の provenance が欠けている（Canon §39）
  fingerprint_unavailable       identity を主張できない
  ```
  **次は veto しない**（fail-open で context を返す）。
  ```text
  source が空 / 一部の source が読めない / Source-Sync が verified にならない /
  その kind の block が定義されていない
  ```
- **★ 判定材料は block の有無ではなく read の痕跡:** purpose gate は
  「Spine が server から読んでよい kind」を決めるものであり、bridge 由来の値
  （legacy body 経路）を禁じるものではない。許可外 kind は reader が query を
  1 本も出さないので state は必ず `denied_by_purpose` になる。それ以外の state が
  付いていたら gate が漏れたということである。
  この取り違えは実害として観測された: `essay_review` の plan には
  `previous_output_summary`（`sourceKind: 'statement_review'`）が宣言されているが、
  essay 側の client は値を送っていないため block は空になる。block の有無で
  判定すると、この**空 block を「禁止 source の寄与」と誤判定して veto**していた。
- **Reason:** Canon §18 は「読めたっぽいからとりあえず LLM へ渡す」を禁じるが、
  Canon §5 / §41 / E-S1 の fail-open は「context を減らして続行する」ことを要求する。
  境界を曖昧にすると 2 方向に壊れる。veto を緩めれば検証できていないものを prompt に
  載せることになり、veto を強めれば**新規ユーザーには AI が一切使えなくなる**。
- **Alternatives rejected:**
  - *source が空なら veto する* — 新規ユーザーの可用性を破壊する（E-S1 違反）。
  - *veto を例外（throw）で表現する* — 呼び出し側が握り潰せる。contract として返す。
- **Rollback implications:** なし（純関数の判定）。

## E-S33 — device revision claim は request-scoped の advisory signal であり、header 1 本で運ぶ

- **Status:** `LOCKED`（Stage 5.0 で実装 + QA 済み。pilot = `tutor` / kind = `basic_info`）
- **Decision:** E-S2 が要求する device 申告の transport を次に固定する。
  ```text
  header   x-exam-spine-device-claim   （canonical。1 個だけ）
  wire     {"v":"edc1","c":[{"kind":"<ExamSourceKind>","token":"efp1:<hex64>"}]}
  上限     2048 bytes / 12 entries     （超過は切り詰めず破棄）
  token    content 由来 fingerprint（`efp1:` + SHA-256 hex 64）
  ```
  実測サイズは pilot（1 kind）で **120 bytes**。
- **token を content 由来にする根拠:** `sync/adapters/registry.ts` が全 class 1 kind について
  「往復する revision token が存在しないため生成しない（E-S2 は content 由来 token を
  signal とする）」と宣言している（`updated_at` は trigger 上書き、`source_hash` は
  key 順依存で server 再算出不能）。E-S2 が却下した *content hash を送る* は
  「**本文が network を通る**」ことへの拒否であり、本文を 1 byte も送らない
  fingerprint はこれに当たらない。
- **★ claim は verification input であって policy input ではない ★**
  型に `userId` / `authority` / `table` / `purpose` / `verified` が存在しないため、
  claim では次のいずれも **構造的にできない**。
  ```text
  他 user を名乗る        … owner scoping は server auth のみ（E-L3）
  purpose gate を広げる   … toDeviceClaims が purpose の許可 source で filter（E-S28）
  authority / table を指定 … registry だけが決める（E-S15）
  自分を verified にする   … 判定は server 側の照合結果だけ
  RLS を迂回する          … claim は query を 1 本も変えない
  ```
- **request-scoped:** claim は request ごとに評価する。`Map<userId, claim>` /
  `lastClaimByUser` / `globalCurrentRevision` のような cross-request state を作らない。
  同一 user の別 tab が別 revision を持っていても独立に評価される（QA 済み）。
- **fail-safe（E-S1）:** missing / malformed / unknown version / unknown kind /
  duplicate / oversize / invalid token のいずれでも throw せず request を落とさない。
  その kind を `unclaimed` にして続行し、結果として server 値は採用されない。
  **壊れた claim で request が落ちることも、壊れた claim で verified になることもない。**
- **class 2 の申告を受け取らない:** `interview_ai` / `presentation` は server route が
  著者であり client canonical が存在しない。申告を受け取ると「server 著作データを
  client の申告で検証する」逆向きの誤りになる（E-S3）。parser が `not_syncable` で捨てる。
- **device view を書き起こさない:** device 側 token は server が同じ行から算出する値と
  完全一致しなければ意味が無い。したがって device 側も
  `mapBasicInfoRow → basicInfoSyncView → examSyncObservation` という
  **server と同一の経路**を通す。device 固有なのは「`name` を strip して
  `schema_version` を添える」ところだけで、どちらも writer 契約から決まる。
  `BASIC_INFO_SCHEMA_VERSION` は writer から export して正本を 1 箇所にした
  （重複させると bump 時に fingerprint が永久不一致になり、runtime では検出できない）。
- **空のときは申告しない:** writer は空の `BasicInfo` を書かないため、device が空なら
  server にも行が無い。server 0 行は Stage 4 が Source-Sync より手前で `empty` を
  確定させる（E-S30）ので、空の申告に意味は無い。header から外す。
- **Alternatives rejected:**
  - *timestamp を送る* — client 時刻だけで verified を判定する経路になり E-S2 に反する。
    「往復する revision が無いなら生成しない」が registry の宣言でもある。
  - *body に claim を入れる* — 全 consumer の body contract を変えることになる。
    header なら consumer の request shape を 1 つも壊さずに載せられる。
  - *claim を複数 header に分ける* — kind ごとに header が増え、上限管理と
    injection 面が広がる。1 header に閉じる。
- **Rollback implications:** client が header を送らなくなれば全 kind が `unclaimed` に戻る
  だけで、consumer の出力は変わらない（Stage 5.0 時点で出力に影響しないため）。

## E-S34 — Spine の production 接続は allowlist で管理し、Stage 2 prompt 経路は接続しない

- **Status:** `LOCKED`（Stage 5.0 で実装 + QA 済み）
- **Decision:** Stage 1〜4 が保っていた「production runtime からの `examSpine` import = 0」を、
  Stage 5.0 以降は次の 2 本立てに置き換える。
  ```text
  1. examSpine を import してよい production file は **allowlist** に列挙されたものだけ
     現在: app/tutor/page.tsx（claim serializer）/ app/api/tutor/route.ts（parser + gated shadow）
  2. **どの production file も `examSpine/blocks` `examSpine/orchestrator` を import しない**
     = Stage 2 の prompt 経路が未接続であること ＝ consumer migration が起きていないこと
  ```
  さらに sync core 本体（`revision` / `fingerprint` / `hash` / `verification` / `adapters`）は
  production から直接 import しない。接続点は `sync/claim` 層だけとする。
- **Reason:** 「import 0 本」は Stage 4 までは正しい invariant だったが、Stage 5.0 は
  pilot を意図的に接続するため、そのままでは**正しい変更が QA を落とす**。かといって
  check を消すと「どこまで接続が広がったか」を機械的に追えなくなる。
  allowlist にすることで接続の増加が必ず diff に現れ、prompt 経路の禁止を別 check に
  分けることで **consumer migration の有無を独立に固定**できる。
  実際この置き換えで各 QA の check 数は減っていない（invariant は 1 本増えている）。
- **★ 拡張の手続き ★** allowlist に file を足してよいのは、その Stage の Decision で
  接続対象が明示されている場合だけである。「実装上必要だった」を理由に足さない（E-P9）。
- **Alternatives rejected:**
  - *check を削除する* — 接続範囲が追跡不能になる。
  - *「0 本」を維持して pilot を別扱いの例外にする* — 例外が増えるほど invariant が形骸化する。
- **Rollback implications:** なし（QA の判定条件のみ）。

## E-S35 — 外部へ出す Source-Sync verdict は E-S2 の 4 値に畳み、`incomparable` を昇格させない

- **Status:** `LOCKED`（Stage 4 Wave 4 で実装 + QA 済み）
- **Decision:** Source-Sync の内部 status は 5 値（`verified` / `mismatch` / `unclaimed` / `unreadable` / `incomparable`）だが、**Spine の外へ出す verdict は E-S2 が列挙する 4 値だけ**とする。畳み込みは `lib/examSpine/sync/verdict.ts` の 1 箇所に閉じ、`incomparable → verified` を構造的に禁止する。畳んだ事実は無言の cast ではなく観測可能な flag として残す。
- **Reason:** `incomparable` は「判定材料が無い」であって「一致した」ではない。外部 4 値へ写すときに `verified` へ寄せると、未検証を検証済みと呼ぶことになり E-S2 の負の安全ゲートが無効化される。かといって外部に 5 値を出すと E-S2（LOCKED）の語彙と食い違う。畳み先を 1 関数に固定し、そこだけを QA で押さえるのが最小の解である。
- **優先順位:** E-S2 のとおり `unreadable` > `unclaimed` > `mismatch` > `verified`。
- **Implementation evidence:** `lib/examSpine/sync/verdict.ts`（`foldExamSyncInternalStatus` / `examSyncVerdict` / `examSyncVerdicts`）。QA は `scripts/exam-spine-sync-signal-check.ts`（外部 verdict union に `incomparable` が現れないことを含む）。
- **Failure semantics:** 畳めない入力は `verified` へ倒さない。上位は「使わない」方向へ倒れる。
- **Stage:** Stage 4（判定層。consumer 接続を含まない）。
- **Alternatives rejected:**
  - *外部にも 5 値を出す* — E-S2 の語彙と二重定義になる。
  - *`incomparable` を `mismatch` に潰す* — 不一致の証拠が無いのに不一致を主張することになる。
- **Rollback implications:** なし（純関数。runtime 接続を持たない）。

## E-S36 — usability 判定は verdict / canary / runtime block の宣言層に閉じ、flag 実装を持たない

- **Status:** `LOCKED`（Stage 4 Wave 4 で実装 + QA 済み）
- **Decision:** 「その kind を実際に使ってよいか（`usable` / `veto`）」の判定を `lib/examSpine/sync/enable.ts` に置く。ただしこの層は **env も allowlist も canary infrastructure も持たない**。評価済みの値を引数で受け取るだけの純粋な宣言層とし、canary の実評価（E-S11 の「purpose flag AND user allowlist」の連言）は runtime 側が持つ。canary 状態が missing / unknown / false / malformed のいずれでも enable しない（`=== true` の厳密一致のみ）。
- **Reason:** verdict（照合結果）と usability（使ってよいか）は別の判断である。混ぜると「verified だから使う」という短絡が生まれ、canary や runtime block を迂回できてしまう。一方でこの層に env を持たせると feature flag 実装が二重化する（E-S11 が正本）。判定と評価を分けることで、default deny を型で担保したまま flag 実装を 1 箇所に保てる。
- **Implementation evidence:** `lib/examSpine/sync/enable.ts`（`examSyncUsability` / `examSyncUsableKinds` / `isExamSyncRuntimeBlocked` / `summarizeExamSyncEnable`）。QA は `scripts/exam-spine-sync-signal-check.ts`。
- **Failure semantics:** 判定不能はすべて `veto`。理由は enum で返す（E-S12）。
- **Stage:** Stage 4（宣言層）。
- **Alternatives rejected:**
  - *verdict から直接 usable を導く* — canary / runtime block を迂回する。
  - *この層に env を読ませる* — E-S11 と二重の flag 実装になる。
- **Rollback implications:** なし（純関数）。

## E-S37 — canonical implementation lineage を 1 本宣言し、並列 branch は登録+統合まで canonical ではない

- **Status:** `LOCKED`（Stage 4 stabilization で制定）
- **背景（実際に 2 回起きた事故）:**
  ```text
  1 回目  558ddca から convergence 系列と device-views 系列が分岐。
          Register が E-S28 / E-S34 の 2 本になり CANONICAL_HEAD = UNDEFINED になった。
  2 回目  上を merge した直後、sync-signal 系列が ff5bf38 から再分岐。
          同じ構造の分岐が再発した。
  ```
  どちらも「並列 worker が自分の branch を canonical のつもりで進めた」ことが原因である。
- **Decision:**
  ```text
  1. canonical implementation lineage は **1 本**であり、その所在は
     EXAM_SPINE_STATE.md §1.1「Canonical Implementation Lineage」が唯一の正本とする。
  2. 並列 worker の branch は **canonical ではない**。branch 名に canonical / convergence が
     入っていても、worktree が新しくても、commit が多くても canonical にはならない。
  3. worker の成果が canonical になるのは、次の 2 つを**両方**満たしたときだけである。
       a. その contract が Register に登録されている（E-P9）
       b. canonical lineage へ統合（merge / cherry-pick）されている
  4. packet / worker は開始時に canonical HEAD を **re-resolve** し、その値を記録する。
     記録した HEAD から分岐すること。stale branch の上に新しい feature を積まない。
  5. 統合前に必ず ancestry check を行う。
       git merge-base --is-ancestor <canonical> <branch>
       git log --oneline <canonical>..<branch>
     unique commits を列挙せずに merge しない。
  6. 「commit date が新しい」「HEAD が進んでいる」「branch 名」を根拠に
     canonical を選ばない（Canon §31 の latest-wins 禁止と同じ理由）。
  ```
- **Reason:** 分岐そのものは並列開発の正常な副産物である。事故になったのは *どれが canonical かを機械的に答えられなかった* からで、Packet E が「どの HEAD を import するのか」を人間の推測に頼る状態になっていた。所在を 1 箇所に固定し、canonical 化の手続きを明文化すれば、分岐しても復帰できる。
- **Implementation evidence:** `EXAM_SPINE_STATE.md` §1.1。`scripts/exam-spine-readiness-check.ts` が Register の単一性（R1）を機械検証する。
- **Failure semantics:** canonical HEAD を解決できない場合、後続 packet は推測で進めず停止する（Packet E の BLOCKED 判定が正しい挙動だった）。
- **Stage:** 運用規約（実装を持たない）。
- **Alternatives rejected:**
  - *hash を Register 本文に恒久固定する* — 収束のたびに手更新が要り、必ず陳腐化する。branch + ancestry rule を正本にし、hash は「この収束時点」の記録に留める。
  - *worker branch を canonical と呼ぶ運用を続ける* — 2 回とも同じ失敗をした。
- **Rollback implications:** なし（運用規約）。

## E-S38 — Stage 4 canonical は arbitration で 1 本に確定し、branch-local な decision ID を canonical に持ち込まない

- **Status:** `LOCKED`（Stage 4 final arbitration で制定）
- **背景:** E-S37 で canonical lineage の単一性を規約化した後も、並列 branch が
  **同じ次番 ID を同時に採番**する事故が起きた。branch が分岐している間、双方が
  「次の空き ID は E-S35」と判断できてしまうためである。
  ```text
  canonical (exam-spine-stage4-stabilize)     A branch (exam-spine-w1-convergence-v2)
    E-S35 外部 verdict を 4 値へ畳む            E-S35 device projection authority
    E-S36 usability を宣言層に閉じる            E-S36 shadow comparison は observer
    E-S37 canonical lineage / fork governance   E-S37 shadow 結果を consumer へ渡さない
  ```
- **Decision:**
  ```text
  1. decision ID の採番権は **Stage 4 canonical branch の Register だけ**が持つ。
     canonical branch は EXAM_SPINE_STATE.md §1.1 が指すものとする（E-S37）。

  2. canonical における E-S35 / E-S36 / E-S37 は本 Register の定義が正であり、
     他 branch が同じ ID に割り当てた decision は **NON_CANONICAL** とする。

  3. non-canonical branch の decision を後から昇格させる場合、
     **ID をそのまま持ち込んではならない**（verbatim merge 禁止）。手順は次で固定する。
       a. canonical Register の現 HEAD を解決する
       b. その時点の未使用 ID を新たに採番する
       c. branch-local の ID は捨てる（本文・QA・コード内の参照もすべて付け替える）
       d. 登録を済ませてから canonical lineage へ統合する（E-P9）

  4. 「branch が存在する」ことは canonical 性の根拠にならない（E-S37 の再確認）。
     canonical tip 数は **branch 数ではなく ancestry で数える**。
     non-canonical candidate branch が何本あっても canonical は 1 本である。
  ```
- **Reason:** ID 衝突を放置すると、同じ `E-S35` が文脈によって別の contract を指す。
  Register は「参照される ID が一意である」ことに全面的に依存しており、これが壊れると
  decision 参照そのものが機能しなくなる。採番権を canonical 1 本に固定し、昇格時の
  再採番を義務化すれば、分岐中に何本 branch があっても canonical の ID 空間は壊れない。
- **なぜ「新しい方の ID を採る」ではないのか:** commit が新しいことと decision が正しいことは
  無関係である（Canon §31 / E-S37）。採番権は lineage の地位で決まり、時刻では決まらない。
- **Implementation evidence:** `EXAM_SPINE_STATE.md` §1.1（canonical branch 宣言 / deferred lineage 記録）。
  `scripts/exam-spine-readiness-check.ts` R1（canonical tree 内の Register 単一性・ID 一意性・
  canonical branch 宣言の存在）。
- **Failure semantics:** ID を解決できない場合、後続 packet は推測せず停止する。
- **Stage:** 運用規約（実装を持たない）。
- **Alternatives rejected:**
  - *両方の ID を残し文脈で区別する* — 参照時に必ず曖昧になる。
  - *A branch を書き換えて採番し直させる* — 他 worker の履歴改変にあたる。昇格時の再採番で足りる。
  - *canonical 側を E-S38 以降へずらす* — 既に登録・QA 済みの canonical 側を動かす理由が無い。
- **Rollback implications:** なし（運用規約）。

## E-S39 — device claim の request transport は 1 本だけとし、`signal.ts` を transport にしない

- **Status:** `SUPERSEDED_IN_PART`（2026-08-26。**人間の裁定**により Decision 2 を `E-S45` が置換）
- **★ 置換された範囲（`E-S45` を正本とする）★**
  ```text
  旧 Decision 2  signal.ts は transport ではない。内部 codec / verdict 入力として維持する。
  新（E-S45）    signal.ts は transport codec としても廃止する。
                 runtime serialization / parsing authority を持ってはならない。
                 必要なら type-only module としてのみ維持してよい。
  ```
  **Decision 1 / 3 / 4 は有効なまま**である（request transport は `sync/claim/**` 1 本 /
  header 束縛の追加禁止 / QA による機械固定）。本 decision 全体を破棄していない。
- **背景:** `sync/claim/**`（wire `edc1`）と `sync/signal.ts`（wire `esy1`）が
  「同じ payload（kind → fingerprint）を bounded 文字列へ直列化する」ため、
  **request transport が 2 本あるように見えていた**（E-H7 / `PENDING_HUMAN`）。
- **コード実測で確定した事実:**
  ```text
  canonical namespace 全体で HTTP header に束縛されている module は 1 つだけ:
    sync/claim/types.ts:32  EXAM_DEVICE_CLAIM_HEADER = 'x-exam-spine-device-claim'
    sync/claim/parse.ts:36  parseDeviceClaimHeader(headers: Headers)
    sync/claim/serialize.ts withDeviceClaimHeader(...)

  sync/signal.ts:
    header 定数        なし
    Headers への依存   なし
    signature          serializeExamSyncSignal(claims) -> string
                       parseExamSyncSignal(raw: unknown) -> ExamSyncSignal
    file header 自身が明記: 「★ header にはまだ載せない ★ …
      Request / Response / headers …」（signal.ts:26-27）
    production importer 0。唯一の consumer は sync/verdict.ts（Spine 内部）
  ```
- **したがって関係は `DIFFERENT_LAYER` であり、`DUPLICATE` ではない:**
  ```text
  claim/**    request transport   HTTP header 束縛あり / production 接続あり
  signal.ts   内部 codec          transport 束縛なし / verdict.ts の入力型
  ```
- **Decision:**
  ```text
  1. device claim の **request transport は sync/claim/**（edc1）1 本**とする。
     canonical namespace で HTTP header に束縛してよい device-claim module はこれだけ。

  2. 〔SUPERSEDED by E-S42〕sync/signal.ts は **transport ではない**。
     内部 codec / verdict 入力として維持する。verdict / enable の semantics は有用なので削除しない。
     → E-S45 により「transport codec としても廃止。type-only なら可」へ置換。
       verdict / enable の semantics は E-S45 の実装で **失われていない**
       （verdict の入力を transport 非依存 interface へ narrow したため）。

  3. signal.ts に header 定数・`Headers` 依存・request 束縛を **追加してはならない**。
     追加が必要になった場合は、それは transport の二重化なので新しい Decision を要する。

  4. 上記 1/3 は QA で機械的に固定する
     （`scripts/exam-spine-readiness-check.ts`: device-claim header 束縛が 1 module のみ）。
  ```
- **Reason:** 「2 実装あるから片方を消す」ではなく、**層が違うことを確定させ、
  層をまたぐ変更を禁止する**のが正しい解である。signal.ts を消すと `verdict.ts`（E-S35）の
  入力型と Wave 4 の QA 資産を失う。逆に放置すると、将来 signal.ts に header を足した瞬間に
  wire format が 2 本になり、旧 client の hex を新 schema として誤解釈する経路
  （signal.ts が自ら警告している false-positive verified）が開く。
- **Alternatives rejected:**
  - *signal.ts を削除する* — verdict / enable の内部 semantics を巻き添えにする。
  - *両方を transport として残す* — Stage 5 で claim を消費し始めた時点で二重定義に依存する。
  - *PENDING_HUMAN のまま据え置く* — runtime architecture が既に決定的な答えを持っており、
    人間が選ぶ余地のある product tradeoff は存在しない。
- **Rollback implications:** なし（宣言 + QA）。既存 runtime 挙動を変えない。

## E-S40 — Stage 5 の最初の consumer 切替は tutor の `basic_info` slot 単独とする

- **Status:** `LOCKED`（Stage 5 entry gate で制定。実装は本 Decision の範囲外）
- **Decision:** Stage 5 の **最初の** consumer 切替は
  **`tutor` purpose の `basic_info` slot だけ**を対象とする。同じ request 内の
  他 slot（`self_analysis` / `activity` / `diagnosis` / `statement_review` / `essay` /
  `interview_record` / `interview_ai` / `presentation`）は bridge / legacy のまま据え置く。
  per-kind origin（E-S26）が per-slot 移行を表現できるため、consumer 単位で一括切替しない。
- **なぜ tutor か（実測。branch や新しさではなく infra 充足度で選んだ）:**
  ```text
  tutor だけが Stage 5 に必要な 4 つを既に持っている:
    server read 経路   legacy serverRead（production 稼働中）
    device claim       E-S33（basic_info を申告。production 接続済み）
    canary gate        E-S34（default deny。shadow で通電実績あり）
    canonical block    basic_info block が存在する

  他 purpose は上記 4 つを 1 つも持たない。kind 数が少ない purpose
  （essay 系 / statement_prepare は basic_info 1 kind のみ）は一見安いが、
  gate / claim / shadow / 比較経路をゼロから作る必要があり総リスクは大きい。
  ```
- **なぜ `basic_info` slot 単独か（実測）:**
  ```text
  block を持つ kind        basic_info / activity / self_analysis / statement_review（4）
  tutor が必要とする kind  9
  → tutor 全体を一度に移すと 5 kind が block 不在で E-P7（context を減らさない）に違反する

  tutor が現在申告している claim は basic_info だけ
    sync/claim/deviceBasicInfo.ts:65 buildTutorDeviceClaimEntries → [{ kind: 'basic_info' }]
  → Source-Sync で verified を出せる kind も現状 basic_info だけである
  ```
- **氏名の扱い:** server 側 `basic_info` に氏名は存在しない（E-P8）。
  切替後も氏名が prompt から消えてはならない（E-P7）。
  `context/project.ts` が bridge の氏名を明示合成し `bridgeFields` として記録する経路を使う。
  暗黙の Mixed-Origin にしない（Canon §17）。
- **Alternatives rejected:**
  - *essay 系 / statement_prepare を先に移す* — kind 数は少ないが Stage 5 infra を
    ゼロから作ることになる。既存の claim / gate / shadow を活かせない。
  - *tutor を consumer 単位で一括移行する* — block 不在 5 kind で E-P7 違反。
  - *block を先に 5 つ足してから tutor 全体を移す* — 最初の切替の blast radius が最大化する。
    block 追加は per-slot 移行の各回で必要になった分だけ行う。
- **Rollback implications:** canary env を落とすと bridge へ縮退する（E-S11 / E-S34）。
  unsafe rollback（検証なしで server 値を使う経路）は実装しない。

## E-S41 — R5 evidence は `essay` の sync eligibility を開くだけであり、consumer を有効化しない

- **Status:** `LOCKED`（Stage 5 / S5-P2 で昇格）
- **背景（R5 とは何だったか）:** `essay` の server projection は
  `reviews:workspace->reviews` という **jsonb sub-path** を使う（E-S27）。
  PostgREST は sub-path の存在を検証せず、誤った path でも 200 を返すため、
  live schema check（Wave 2.5 の R5）では「path が実データ上で解決するか」を証明できなかった。
  path が誤っていれば **mirror 側だけ `reviews` が空**になり、fail-open（E-S1）に
  吸収されて runtime では気付けない silent failure になる。そのため `essay` を
  `EXAM_SYNC_RUNTIME_ENABLE_BLOCKED` に載せ、Source-Sync 対象から構造的に外していた。
- **R5 を閉じた evidence:** 本番 SQL Editor（SELECT のみ）の jsonb 型集計で
  `reviews` が全行 array であること、および存在しない sub-path が 0 行になる
  negative control が成立した。read-only PostgREST probe も同じ結論。
  INSERT / UPDATE / DELETE / DDL / policy 変更 / migration は 1 件も無い（Canon §79 / §80）。
  ```text
  ★ 数値の正本は E-H1 本文だけに置く。ここへ複製しない。★
    drift guard（scripts/exam-spine-sync-device-check.ts）は Register 全体から
    rows_reviews_is_array 等を grep して evidence の有無を判定する。
    同じ数値を 2 箇所へ書くと **E-H1 側を壊しても guard が落ちなくなる**
    （本 Decision の作成中に負例で実際に確認した）。evidence の所在は 1 箇所に保つ。
  ```
- **Decision:**
  ```text
  1. R5 は CLOSED。`essay` を EXAM_SYNC_RUNTIME_ENABLE_BLOCKED から外す。
     宣言の理由（out-of-band 確認まで）が消えた以上、残すこと自体が drift になる。

  2. 機構（空の map）は残す。「contract は確定しているが production evidence が
     未取得」という状態は今後も起こり得るため、宣言 1 行で veto できる口を保つ。

  3. ★ これは eligibility の解放であって consumer の有効化ではない ★
     essay の consumer / prompt / route を 1 つも変更しない。
     Stage 5 の最初の切替対象は **E-S40 のまま tutor の basic_info slot** である。
  ```
- **★ `EXAM_SYNC_RUNTIME_ENABLE_BLOCKED` の実際の意味（名前が誤解を招くため明記）★**
  この定数は「runtime で有効化されている」ことを表さない。**宣言**であり、
  `examSyncUsability`（`sync/enable.ts`）の **4 段 veto のうち 2 段目**にすぎない。
  ```text
  1. !isExamSyncSupportedKind(kind)  → VETO 'kind_not_syncable'
  2. isExamSyncRuntimeBlocked(kind)  → VETO 'runtime_blocked'   ← R5 が外したのはここだけ
  3. canaryAllowed !== true          → VETO 'canary_denied'     ← E-S11 の連言。既定 deny
  4. !isExamSyncUsableVerdict(v)     → VETO 'not_verified'      ← E-S2
  ```
  さらに `sync/enable.ts` の **consumer は production に 0 本**
  （`lib/examSpine/**` 内部にも 0 本。参照するのは QA script 2 本のみ）。
  したがって 2 段目を外しても **runtime 挙動は構造的に変化し得ない**。
  有効化には 3 と 4 が別途必要で、そのどちらも本 Decision の範囲外である。
- **Failure semantics:** evidence と gate を双方向で縛る。
  「block を外した」ことと「その根拠が Register に残っている」ことは常に同時に成立する
  必要がある。片方だけ revert されると「根拠が消えたのに有効化されたまま」になり、
  fail-open が吸収するため runtime では気付けない。QA が両方向を検査する:
  ```text
  R5 evidence が揃っている → runtime block は外れていること
  R5 evidence が欠けている → runtime block が必要であること
  再検証用の read-only SQL（jsonb_typeof / negative control）が保持されていること
  E-H1 が RESOLVED であること
  ```
- **Stage:** Stage 5（eligibility のみ。consumer 切替を含まない）。
- **Implementation evidence:** `lib/examSpine/sync/adapters/registry.ts`（空 map）／
  `supabase/exam_spine_rls_verification.sql`（再検証 SQL）／
  `scripts/exam-spine-sync-device-check.ts`・`exam-spine-sync-signal-check.ts`（双方向 drift guard）／
  `EXAM_SPINE_DECISIONS.md` `E-H1`（evidence 本体）。
- **Alternatives rejected:**
  - *evidence を Register に残したまま block も残す* — stale な blocker は drift になり、
    「なぜ block されているのか」を次のセッションが再調査することになる。
  - *block を外すついでに essay consumer を有効化する* — eligibility と activation の混同。
    E-S40（最初の切替は tutor / basic_info）に反する。
  - *`EXAM_SYNC_RUNTIME_ENABLE_BLOCKED` を改名する* — 名前は誤解を招くが、改名は本 Decision と
    無関係な変更であり diff を膨らませる。意味は本項で固定する。
- **Rollback implications:** `essay` を map へ戻せば 2 段目の veto が復活する。
  consumer 側の変更が無いため rollback による挙動変化も無い。

## E-S42 — shadow comparison は observer であり、enum と hash しか持たない

- **Status:** `LOCKED`（Stage 5 / S5-P3 で Packet J とともに昇格）
- **由来:** `exam-spine-w1-convergence-v2` が branch-local に `E-S36` として持っていた内容を、
  E-S38 の手続きに従い canonical の未使用 ID へ**再採番**して登録する
  （branch-local ID は持ち込まない）。
- **Decision:** legacy consumer の出力と Canonical Exam Context の比較を
  `lib/examSpine/context/shadow/compareTutor.ts`（純関数）で行い、
  結果を `ExamShadowComparison`（`context/shadow/types.ts`）として返す。
  比較器は **read も write もしない**。渡された 2 つの出力を突き合わせるだけで、
  purpose を広げることも source を verified にすることもできない。
  ```text
  diff kind  MATCH / MISSING_CANONICAL / EXTRA_CANONICAL / VALUE_MISMATCH /
             ORIGIN_MISMATCH / STATUS_MISMATCH / INTENTIONALLY_OMITTED / UNCOMPARABLE
  overall    equivalent / compatible_with_omissions / not_equivalent / insufficient_evidence
  readiness  READY / NOT_READY / DEFERRED / INTENTIONALLY_LEGACY（source 単位）
  ```
- **★ 差分ゼロを目的にしない ★** Canonical Spine は legacy の複製ではない。
  意図的な省略（`INTENTIONALLY_OMITTED`）と不一致（`VALUE_MISMATCH`）を型で分ける。
- **観測に出せる値:** enum と件数、および内容比較用の hash のみ。
  本文 / fingerprint 値 / userId / UUID を出さない（E-S12 / E-S13）。
- **Implementation evidence:** `lib/examSpine/context/shadow/{types,compareTutor}.ts`。
  QA は `scripts/exam-spine-stage5-1-check.ts`（compare engine の purity: DB 動詞 0 /
  AI SDK 0 / `Date` `Math.random` 0）。
- **Failure semantics:** 比較の失敗は観測の欠落であって consumer の失敗ではない（E-S1）。
- **Stage:** Stage 5（observability。consumer 切替を含まない）。
- **Rollback implications:** なし（純関数 + 観測）。

## E-S43 — shadow の結果と canonical の値を consumer 経路へ渡さない

- **Status:** `LOCKED`（Stage 5 / S5-P3 で Packet J とともに昇格）
- **由来:** `exam-spine-w1-convergence-v2` の branch-local `E-S37` を再採番して登録
  （E-S38。branch-local ID は持ち込まない）。
- **Decision:** shadow 実行は既存の default deny gate（E-S11 / `isExamSpineShadowEnabled`）の
  背後でのみ動き、次を **consumer 経路へ渡さない**。
  ```text
  ExamShadowComparison / CanonicalExamContext / shadowResolvedInput
    ↛ prompt builder / systemBlocks / messages / AI request / response
  ```
  `shadowResolvedInput` は assembler が返す **shadow 専用の副産物**であり、
  `CanonicalExamContext` の一部ではない（context は生値を持たない / E-S29）。
  shadow ブロックから外へ出てよいのは **観測用の enum と件数だけ**である。
- **失敗は consumer を巻き込まない:** canonical read 失敗 / claim mismatch / 比較例外 /
  正規化失敗 / fingerprint 失敗のいずれでも `/api/tutor` は 500 にならず、
  legacy consumer がそのまま応答する（E-S1）。
- **★ これは consumer switch ではない ★** 本 Decision は shadow を **観測に留める**
  ための禁止であり、Stage 5 の最初の切替対象は **E-S40 のまま tutor の `basic_info` slot** である。
- **Implementation evidence:** `app/api/tutor/route.ts`（gate 済み shadow ブロック。
  脱出するのは `shadowOverall: string | undefined` と `shadowMismatchCount: number | undefined` のみ）。
- **QA（2 層で検査する）:**
  ```text
  scripts/exam-spine-stage5-1-check.ts   prompt / systemBlocks 近傍に comparison と
                                         shadowResolvedInput が現れないこと（近接検査）、
                                         prompt builder が shadow を import しないこと
  scripts/exam-spine-sync-signal-check.ts shadow ブロックが prompt 組み立てより前にあること、
                                         prompt 以降に shadow 由来の識別子が現れないこと、
                                         観測値が enum / 件数として宣言されていること
  ```
  ⚠️ Stage 5.0 期の proxy 検査「shadow の戻り値を変数へ束縛していない」は
  **本 Decision で置き換えた**。比較には束縛が必要であり、束縛の有無は本来の不変条件ではない。
  本来の不変条件は「shadow 由来の値が consumer 経路へ出ないこと」であり、上記 2 層がそれを直接検査する。
- **Stage:** Stage 5（observability）。
- **Rollback implications:** gate env を落とせば shadow ごと止まる。consumer 挙動は不変。

## E-S44 — diagnosis の canonical 表現は hint 1 文であり、言い換え表は 1 箇所に置く

- **Status:** `LOCKED`（Stage 5 / S5-P4 で Stage 5.2 とともに昇格）
- **由来:** `exam-spine-w1-convergence-v2` が branch-local に `E-S38` として持っていた内容を、
  E-S38（canonical）の手続きに従い canonical の未使用 ID へ**再採番**して登録する。
  branch-local ID は持ち込んでいない（canonical の `E-S38` は別 authority である）。
- **Decision:** `diagnosis` kind の canonical 表現は
  **`resultType` を言い換えた会話補助 hint 1 文**（block id `diagnosis_type_hint`）とする。
  `diagnosis_logs.payload` の `resultTitle` / `resultDescription` / `answers` /
  `createdAt` は canonical block にも `ExamContextInput` にも載せない。
  言い換え表と判別ロジックの正本は `lib/examDiagnosis/tutorHints.ts` の
  `resolveDiagnosisTypeHint()` **1 箇所**とし、legacy（`tutorContext.ts`）も
  canonical（assembler）も device view も**同じ関数**を通す。
- **Reason:** legacy Tutor が prompt に出しているのは hint 1 文だけである
  （`tutorContext.ts:loadDiagnosisContext` → `・保存情報からは、{hint}。`）。
  payload 全体を Layer 2 へ持ち込むと診断タイプ名・説明文・回答が block へ流れる
  （Canon §55 / E-P5）。また言い換え表を 2 箇所に置くと、同じ診断結果から
  **legacy と canonical で違う prompt が出る**。表は Stage 5.2 時点で server-only file の
  module private だったため、pure module へ移して共有した。
  ```text
  ★ これは DRY のための refactor ではない ★
    2 箇所に置くこと自体が migration の正しさを壊すため、単一化が要件である。
    移動時に値は 1 文字も変えていない（byte 一致は characterization QA が担保）。
  ```
- **★ block 追加は E-S25 の範囲内 ★** E-S25 は「凍結対象は今ある block の contract で
  あって block 集合の完全性ではない」「consumer 移行の前に対象 purpose が使う kind の
  block を足す必要がある」と定めている。本 block の追加に新しい許可 Decision は要らない。
- **presence:** Stage 4 の source state に従う。Source-Sync が `verified` のときだけ `present`。
  `unverified` / `empty` / `unreadable` / `denied_by_purpose`、および `resultType` を
  解決できない場合は block を出さない。
  **legacy に無い「診断データはありません」等の代替文言を作らない**（E-P7）。
- **★ 既知の制約（migration blocker として記録。本 Stage では直さない）★**
  `diagnosisSyncView` は `schemaVersion` を content field に含む。writer
  （`lib/supabase/diagnosisLogs.ts`）は現在 `"3"` を書くが DDL default は `'1'` であり、
  **bump 前に書かれた行は `'1'` のまま残る**（`EXAM_SPINE_STAGE3_READINESS_AUDIT.md` §6.3）。
  ```text
  影響    : 旧行を持つ既存 user では diagnosis の canonical 移行が成立しない（永久 mismatch）
  検出性  : runtime では mismatch としか見えず原因が表面化しない
  対処    : mirror の schema_version semantics 側で解く。
            **transport 側に回避策を入れない**（2 つ目の正規化規則を作ることになる）
  影響範囲: consumer は未切替のため user 影響は無い。切替時の受け入れ条件に含めること
  ```
- **★ これは consumer switch ではない ★** canonical context に diagnosis block が
  存在することと、AI consumer がそれを使うことは別工程である。
  Stage 5 の最初の切替対象は **E-S40 のまま tutor の `basic_info` slot**であり、
  production tutor prompt は本 Decision 後も legacy 経路のままである（E-S43）。
- **Implementation evidence:** `lib/examDiagnosis/tutorHints.ts`（`resolveDiagnosisTypeHint`）／
  `lib/examSpine/blocks/{types,registry,build}.ts`（`diagnosis_type_hint`）／
  `lib/examSpine/context/assemble.server.ts` / `orchestrator/{input,plan}.ts` ／
  `lib/examSpine/sync/claim/deviceBasicInfo.ts`（`deviceDiagnosisToken`）。
  QA は `scripts/exam-spine-stage5-2-check.ts`。
- **Alternatives rejected:**
  - *payload をそのまま block に載せる* — タイプ名・説明文・回答が prompt 経路へ入る。
  - *canonical 側で言い換えを書き直す* — 表が 2 つになり legacy と乖離する。
  - *`schemaVersion` を sync view から外して回避する* — 本 Stage の scope 外であり、
    transport 側に 2 つ目の正規化規則を作ることになる。
- **Rollback implications:** block を出さなくしても legacy 経路は不変。
  `resolveDiagnosisTypeHint` は legacy が既に使っているため戻さない。

## E-S45 — activity の canonical 表現はカテゴリ別件数であり、mirror gap は Source-Sync に委ねる

- **Status:** `LOCKED`（Stage 5.3 で実装 + QA 済み。Tutor migration gap G6）
- **ID 由来（S5-P5 promotion）:** source branch `exam-spine-w1-convergence-v2` では
  branch-local に `E-S39` として採番されていたが、canonical の `E-S39` は
  「device claim の request transport は 1 本だけとし、`signal.ts` を transport に
  しない」であり **別 Decision** である。verbatim で持ち込むと衝突するため、
  canonical の次番 **E-S45** へ再採番した（内容は不変）。
- **Decision:** Tutor における `activity` の canonical 表現は
  **カテゴリ別件数の 1 行表現**（block id `activity_category_counts`）とする。
  `activity_logs.payload` の narrative（活動名 / テーマ / 説明 / 成果）は
  canonical block にも `ExamContextInput` にも載せない。
  ラベル表・件数集計・1 行整形の正本は `lib/activityCategories.ts` の
  `ACTIVITY_CATEGORY_LABELS` / `summarizeActivityCategories()` /
  `formatActivityCategoryCounts()` とし、legacy（`tutorContext.ts` /
  `tutorStudentContext.ts`）も canonical（assembler）も**同じ関数**を通す。
- **★ 既存 activity block では代用できない ★**
  ```text
  activity_text            formatActivityData の全文        … self_analysis 系 purpose 向け
  activity_context         buildActivityContext             … matching purpose 向け
  activity_summary         800 字圧縮の要約                 … interview_questions 向け
  activity_category_counts カテゴリ別件数（Stage 5.3 で追加）… tutor が実際に出している表現
  ```
  したがって claim を配線するだけでは activity は canonical 経路に載らない。
  block の追加は E-S25（「凍結対象は今ある block の contract であって block 集合の
  完全性ではない」）の範囲内であり、許可のための Decision は別途要らない。
- **label 表を 1 箇所にする理由:** Stage 5.3 の時点で同一内容の
  `ACTIVITY_CATEGORY_LABELS` が **2 箇所**に存在していた。canonical 側にもう 1 つ作ると
  3 箇所になり、カテゴリ追加やラベル変更のときに
  **同じ活動データから違う prompt が出る**（E-S35 / E-S44 と同じ失敗形）。
- **claim transport:** 既存の `edc1` header に entry を 1 つ足すだけで、
  header 名 / version / payload 形式 / server parser のいずれも変更しない
  （E-S39 の「transport は 1 本」を維持する）。
  client が申告するのは **device canonical の `ActivityData` 本体**であり、
  body に載せている counts 射影ではない（射影を claim にすると server payload と
  一致しない）。実測 120 → 220 bytes、活動 200 件でも 220 bytes のまま
  （token は content 由来の固定長なので claim size は data size に比例しない）。
- **★ mirror gap は Source-Sync に委ねる（握り潰さない）★**
  `dualWriteActivityLog` は **submit 時にしか発火せず、autosave は mirror されない**
  （`EXAM_SPINE_STAGE3_READINESS_AUDIT.md` §10.1 G1）。
  したがって入力途中の端末では device と server が**正当に**食い違い、claim は
  `mismatch` になって server 値が採用されない。
  ```text
  これは欠陥ではなく設計どおりの挙動である（E-S2 の負の安全ゲート）。
  stale な server 値を prompt に載せないための仕組みが働いている状態。
  transport 側で許容範囲を設けたり、autosave を mirror させたりして
  「一致しやすくする」ことはしない。前者は verified の意味を壊し、
  後者は G1（mirror gap）という別 STEP の課題である。
  ```
- **schema_version の drift は無い（実測）:** writer（`lib/supabase/activityLogs.ts`）は
  `"1"`、DDL default も `'1'`、device 宣言も `'1'` で一致する。
  diagnosis（E-S38）のような既存行の永久 mismatch リスクは **activity には無い**。
  QA が writer の実ソースと `supabase/schema.sql` の DDL default を読んで一致を固定する。
- **presence:** Stage 4 の source state に従う。`available`（Source-Sync verified）の
  ときだけ `present`。`unverified` / `empty` / `unreadable` / `denied_by_purpose`、
  および全カテゴリが 0 件の場合は block を出さない
  （legacy も合計 0 件なら行ごと省略しており、代替文言を作らない）。
- **★ これは consumer switch ではない ★** canonical context に activity block が
  存在することと、AI consumer がそれを使うことは別工程である。
  Stage 5 の最初の切替対象は **E-S40 のまま tutor の `basic_info` slot**であり、
  production tutor prompt は本 Decision 後も legacy 経路のままである（E-S43）。
  S5-P5 では promotion 前後で `buildTutorSupabaseContextSection` /
  `buildTutorStudentContextSection` の出力を **byte 一致**で確認している。
- **Implementation evidence:** `lib/activityCategories.ts` ／
  `lib/examSpine/blocks/{types,registry,build}.ts`（`activity_category_counts`）／
  `lib/examSpine/context/assemble.server.ts` / `orchestrator/{input,plan}.ts` ／
  `lib/examSpine/context/shadow/compareTutor.ts` ／
  `lib/examSpine/sync/claim/deviceBasicInfo.ts`（`deviceActivityToken`）。
  QA は `scripts/exam-spine-stage5-3-check.ts`。
- **Alternatives rejected:**
  - *payload をそのまま block に載せる* — 活動の narrative が prompt 経路へ入る。
  - *body の counts 射影を claim token の材料にする* — server payload は
    `ActivityData` 本体なので永久に一致しない。
  - *既存の `activity_text` を tutor に流用する* — legacy が出しているのは件数であり、
    全文を載せると移行で prompt が大きく変わる（E-P7 の逆方向の劣化）。
- **Rollback implications:** block は shadow からしか参照されないため、
  plan から外せば consumer への影響なく取り消せる。claim も送らなくなれば
  `unclaimed` に戻るだけで legacy 挙動は不変。

## E-S46 — self_analysis の canonical 比較元は Supabase 層 projection であり、readiness は実データを要求する

- **Status:** `LOCKED`（Stage 5.4 で実装 + QA 済み。Tutor migration gap G7）
- **ID 由来（S5-P6 promotion）:** source branch は Stage 5.4 の Decision を
  branch-local に `E-S40` / `E-S41` / `E-S42` として採番していたが、canonical の
  同番はいずれも別 Decision である（E-S40 = Stage 5 最初の consumer 固定、
  E-S41 = R5 essay sync eligibility、E-S42 = Packet J shadow contract）。
  verbatim では持ち込まず、Stage 5.4 の semantic decision を **E-S46** へ統合再採番した。
  branch-local `E-S40`（window parity）だけは独立した locked authority が要るため
  **E-S47** として分離した（下記）。branch-local `E-S41`（truncation blocker）は
  「未解消の制約の記録」であって独立した authority ではないので、本 Decision の
  §blocker として吸収した。
- **Decision:** Tutor における `self_analysis` の device claim を配線する。
  claim token の材料と window 選択は canonical device view
  （`deviceSelfAnalysisView`）へ委譲し、client は `loadSelfAnalysisLogs()` を読むだけ。
  shadow の **legacy 側比較元**は body の `studentProfile` ではなく
  Supabase 層の `context.selfAnalysis` とする。
- **★ 比較元を訂正する理由 ★**
  Tutor が prompt に出しているのは `buildTutorSupabaseContextSection` の 4 行
  （強み / 課題 / 将来の方向性 / 要約）であり、その材料は `tutorContext.ts` の
  `context.selfAnalysis` である。body の `studentProfile` は block 2 の材料なので、
  そちらと比べると「どの経路の差か」が混ざる。activity（E-S45）で同じ取り違えがあった。
  併せて legacy が実際に出している 4 つ目 `futureConnections` の比較を追加する。
- **★ false-empty MATCH を READY にしない ★**
  双方に値が無い比較も `MATCH` として数えるが、それだけで readiness を `READY` に
  しない。fixture や shape 違いで両側が空になっているだけの可能性があり、実際
  activity と self_analysis の両方で「shape 違いにより常に空同士」という latent bug が
  起きていた。kind ごとに **実データのある比較が 1 件以上**あることを READY の必要条件とする。
  ```text
  この guard は導入時点で Stage 5.1 の assertion を落としており
  （空同士で MATCH になっていた）、実際に機能することが確認できている。
  ```
- **★ self_analysis の readiness（S5-P7 で更新）★** claim wiring（G7）は Stage 5.4 で完了。
  下記 ① は S5-P7（E-S48）で解消したため readiness は **`READY`** へ進んだ。
  ② は block coverage の課題として残るが Source-Sync の blocker ではない。
  ```text
  ① truncation blocker  → ★ S5-P7 の E-S48 で RESOLVED ★
     （Stage 5.4 時点の記述）server の行数が cap（5）を超えると Stage 3 が
     truncated を立て、Stage 4 が unreadable に落とす（E-S8 / E-S30）。claim が
     一致していても available にならない。self_analysis は log が貯まる kind なので
     実運用では大半の user が該当し得る。
     → S5-P7 で Stage 5.5（E-S48「cap は比較 window」）を昇格し解消した。
       overflow は unreadable にせず、top-cap window 同士を比較する。
       Stage 5.4 QA の T11 は blocker の pin から **解消後の挙動の pin** へ移設済み。
  ② tutor 向けの canonical block が無い
     legacy が prompt に出している 4 行に対応する block を Stage 5.4 では追加しない
     （新 block を乱造しない方針）。block coverage の課題であり G2-G5 と同じ扱い。
  ```
- **★ これは consumer switch ではない ★** Stage 5 の最初の切替対象は **E-S40 のまま
  tutor の `basic_info` slot**であり、production tutor prompt は本 Decision 後も
  legacy 経路のままである（E-S43）。S5-P6 では promotion 前後で
  `buildTutorSupabaseContextSection` / `buildTutorStudentContextSection` の出力を
  8 fixture（0 件 / 1 件 / 複数 / window 境界 / 同一 timestamp / device-server 不一致 /
  full / 空）で **byte 一致**確認している。
- **mirror gap（既知 / 本 Stage では直さない）:** `dualWriteSelfAnalysisLog` は log 確定時に
  発火するが **削除は伝播しない**（`EXAM_SPINE_STAGE3_READINESS_AUDIT.md` §10.1 G9）。
  端末で log を消しても server に残るため、その端末では正当に mismatch になる。
  Source-Sync が stale な server 値を使わせない設計どおりの挙動であり握り潰さない。
- **Implementation evidence:** `lib/examSpine/sync/claim/deviceBasicInfo.ts`
  （`deviceSelfAnalysisToken`）／`app/tutor/page.tsx`（`loadSelfAnalysisLogs()`）／
  `lib/examSpine/context/shadow/compareTutor.ts`（比較元訂正 ＋ `readinessOf` の
  meaningful 要件）／`app/api/tutor/route.ts`（shadow へ渡す legacy projection）。
  QA は `scripts/exam-spine-stage5-4-check.ts`。
- **Alternatives rejected:**
  - *body の `studentProfile` と比べ続ける* — 経路の違いが値の違いに化ける。
  - *空同士 MATCH で READY にする* — latent bug を「移行可能」と誤報する。
  - *tutor 向け block をこの Stage で追加する* — locked intent の変更であり、
    block coverage は別 Stage の課題。
- **Rollback implications:** claim を送らなくなれば `unclaimed` に戻るだけで legacy 挙動は
  不変。比較元訂正と false-empty guard は shadow の内部評価のみに効く。

## E-S47 — device の history window は server の read window と一致させる（Stage 5.5 feature とは別物）

- **Status:** `LOCKED`（Stage 5.4 の前提として S5-P6 で昇格。branch-local `E-S40` を再採番）
- **Decision:** history 系 kind の device canonical view は、server が読むのと
  **同じ部分集合**（`created_at` DESC で上位 `EXAM_READ_CAPS[kind]` 件）を選ぶ。
  選択規則は `selectDeviceSyncWindow()` として canonical device view 側に置き、
  Stage 5.4 で claim を配線する `self_analysis` にのみ適用する。
- **★ なぜ Stage 5.4 の前提なのか ★**
  Stage 3 は `cap + 1` 件取得して `cap` を超えたら `truncated` にする
  （`queries.ts` の `created_at DESC, id DESC` ＋ `readSources.ts` の `applyCap`）。
  device 側が **全件**を hash すると、cap を超えた user は
  **内容が完全に同期していても永久に mismatch** になる。runtime では「mismatch」と
  しか見えず原因が表面化しない（E-S38 の schema_version と同じ検出不能な故障）。
  ```text
  実測: この primitive が無いと Stage 5.4 QA は type check すら通らない
        （TS2305: no exported member 'selectDeviceSyncWindow'）。
        Stage 5.4 の T3（cap parity）と T6（device 7 件 / server cap 5 件でも
        verified）は本 primitive の semantics を直接 assert している。
  ```
- **★ Stage 5.5 feature と同一視しない（S5-P6 の分類訂正）★**
  ```text
  device sync window primitive（本 Decision / deviceViews.ts）
    device 側の「どの N 件を選ぶか」だけを server に合わせる。
    canonical source の可読性判定は一切変えない。          → 昇格済み

  Stage 5.5 feature（assemble.server.ts + adapters/types.ts）
    「cap を比較 window とみなし truncated を unreadable にしない」。
    canonical source の可読性 semantics そのものの変更。    → 未昇格
  ```
  S5-P5 の boundary guard は前者を「Stage 5.5 の read-cap window」として
  一律禁止しており、これは誤分類だった。S5-P6 で guard を
  「primitive の存在」ではなく「feature surface の不在」を見る形へ訂正した。
- **★ 並び順そのものは fingerprint に影響しない ★** `listSyncView` は `sortSyncItems` で
  **各 item の fingerprint 順**に並べ直すため、localStorage の挿入順にも DB の返却順にも
  依存しない。揃える必要があるのは「どの N 件を選ぶか」だけである。
- **⚠️ tie（構造的保証ではない / 記録）:** server は同一 `created_at` を `id DESC` で解くが、
  device 側の view は `id` を含まない（`deviceSelfAnalysisRow` が `id: null` を置く）。
  同一 timestamp の log が cap 境界をまたぐ場合だけ選択がずれ得る。実運用では
  `createdAt` がミリ秒まで入るため衝突は起きにくいが、保証ではないことを記録しておく。
- **適用範囲を広げない:** `statement_review` / `self_pr` / `interview_record` / `essay` の
  device view にも同じ window 問題があるが、いずれも claim 未配線で production 影響が
  無いため適用しない。広げるのは各 kind の claim を配線する Stage の判断とする
  （Stage 5.4 QA の T12 が「self_analysis 以外へ広がっていない」ことを pin する）。
- **Rollback implications:** primitive を外すと cap 超過 user の claim が
  永久 mismatch に戻るだけで、production prompt には影響しない。

## E-S48 — canonical read cap は「比較 window」であり、overflow は unreadable ではない

- **Status:** `LOCKED`（Stage 5.5 で実装 + QA 済み。**E-S46 の blocker ① を解消する**）
- **ID 由来（S5-P7 promotion）:** source branch では branch-local `E-S43` として
  採番されていたが、canonical の `E-S43`（shadow の結果と canonical の値を consumer
  経路へ渡さない）は **別 Decision** である。verbatim では持ち込まず canonical の
  次番 **E-S48** へ再採番した（内容は不変）。
  なお source branch は別途 branch-local `E-S47`（essay の read window は device から
  再現できない）も使用しているが、canonical `E-S47` は device history window parity で
  あり別物。essay 側は本 packet では昇格しない。
- **対象:** *ordered bounded history source* ＝ `EXAM_READ_CAPS` にエントリを持つ kind
  （`self_analysis` / `statement_review` / `self_pr` / `essay` / `interview_record` /
  `interview_ai` / `presentation`）。`basic_info` / `activity` / `diagnosis` のような
  `maybeSingle` snapshot kind は対象外（構造的に truncate し得ない）。
- **Decision:**
  ```text
  canonical read cap は「読めた範囲」ではなく **意図された比較 window** を定義する。

  canonical comparison window =
    canonical ordering（queries.ts の order）→ 先頭 EXAM_READ_CAPS[kind] 件
  device comparison window =
    同一の logical ordering → 先頭 EXAM_READ_CAPS[kind] 件（E-S47）

  fingerprint / claim verification に参加するのは **window の中身だけ**である。

  `cap + 1` 件目を受け取ったことは overflow（＝ window の外にまだ行がある）という
  **観測**であって、canonical source が読めなかったことの証拠ではない。
  したがって overflow は `unreadable` にしない。
  ```
- **★ E-S8 と矛盾しない理由（重要）★**
  E-S8 は *「truncated を ok と同一視する」* を明示的に却下しており、本 Decision は
  それを覆さない。E-S8 が禁じているのは
  **「一部しか読めていない状態から source 全体の同一性を主張する」**ことである。
  ```text
  E-S8 が守るもの     : 「この source の内容は同じ」という主張を部分読みから導かない
  E-S48 が定めるもの  : そもそも主張の対象を「source 全体」ではなく
                        「決定論的に選ばれた top-N window」に限定する
  ```
  `readStatus` は引き続き `truncated` のまま保持し `ok` へ書き換えない
  （overflow の事実を消さない）。freshness の権威にしない点も変わらない。
- **★ opt-in であり、無条件 readable ではない ★**
  ```text
  serverMirrorCandidate({ status, observation })                 → 既定 strict
    truncated は unreadable のまま（window 契約を宣言していない呼び出し）
  serverMirrorCandidate({ status, observation, windowed: true }) → opt-in
    truncated のみ readable。error / skipped は依然 unreadable
  ```
  assembler は `windowed: isExamCappedSourceKind(kind)` を渡す。すなわち
  **capped kind だけ**が opt-in され、非 capped kind が `truncated` を返した場合は
  契約違反として `unreadable` に倒す。新しい public status enum は追加しない。
- **★ 適用範囲（誤読しやすいので明示）★**
  opt-in の対象は capped kind **全部**であって `self_analysis` 限定ではない。
  ただし canonical で実際に `verified` へ到達し得るのは `self_analysis` だけである
  （他の capped kind は device claim が未配線なので `unclaimed` 止まり）。
  この非対称性は Stage 5.5 QA の T7（opt-in scope）が機械的に固定する。
  ```text
  windowed 対象      : capped kind すべて（E-S48）
  device window 適用 : self_analysis のみ（E-S47）
  claim 配線済み     : basic_info / diagnosis / activity / self_analysis
  → verified 到達可  : self_analysis のみ
  ```
- **★ 実際の失敗は引き続き unreadable ★**
  query failure / mapping failure / `skipped` は従来どおり `unreadable` で、
  sync 判定に進まず origin も `bridge` のまま。overflow とは別物である。
- **★ window が違えば必ず mismatch のまま ★**
  本 Decision は「overflow なら自動 MATCH」にする変更ではない。
  top-N window の中身が 1 つでも違えば fingerprint が変わり mismatch になる。
- **既知の残余（E-S47 から継続）:** server は同一 `created_at` を `id DESC` で解くが
  device view は `id` を持たない。同一 timestamp の record が **cap 境界をまたぐ**場合だけ
  選択がずれ得る。構造的保証ではないことを記録しておく。
- **★ これは consumer switch ではない ★** 本 Decision は canonical source の可読性判定を
  変えるだけで、production tutor prompt は legacy 経路のままである（E-S43）。
  S5-P7 では promotion 前後で `buildTutorSupabaseContextSection` /
  `buildTutorStudentContextSection` の出力を 14 fixture（0 件 / 1 件 / cap ちょうど /
  cap+1 / cap 超過 / 同一 timestamp 境界 / device-server 一致 / device-server 不一致 /
  truncated / 空 / full ほか）で **byte 一致**確認している。
  self_analysis の tutor 向け canonical block も引き続き **追加しない**。
- **Alternatives rejected:**
  - *cap を上げる* — 転送量と prompt budget が増えるだけで、どこかに必ず境界が残る。
  - *overflow 時に全件読む* — cap の目的（latency / memory の予測可能性 / E-S19）を壊す。
  - *`readStatus` を `ok` に書き換える* — E-S8 が却下した「truncated を ok と同一視する」
    そのものになり、overflow の観測が失われる。
  - *全 kind の truncated を無条件 readable にする* — window 契約が無い呼び出しでも
    部分読みからの同一性主張になる。opt-in を必須にした理由。
  - *新しい status enum（`windowed` 等）を足す* — 消費側の分岐が増える。
- **Implementation evidence:** `lib/examSpine/context/assemble.server.ts`
  （`normalizeSourceStates` の overflow 分岐）／`lib/examSpine/sync/adapters/types.ts`
  （`serverMirrorCandidate` の `windowed` opt-in）。
  QA は `scripts/exam-spine-stage5-5-check.ts`、および Stage 5.4 QA の T11（解消後の挙動）。
- **Rollback implications:** `assemble.server.ts` の state 判定 1 箇所を戻せば従来挙動。
  consumer は未接続なので production 影響ゼロ。

## E-S49 — statement_review は同一 source の別 projection であり、legacy 相当射影は shadow 専用とする

- **Status:** `LOCKED`（Stage 5.6 で分類 + 実装 + QA 済み。Tutor migration gap G8）
- **ID 由来（S5-P8 promotion）:** source branch では branch-local `E-S44` として
  採番されていたが、canonical の `E-S44`（diagnosis の canonical 表現は hint 1 文で
  あり言い換え表は 1 箇所に置く）は **別 Decision** である。verbatim では持ち込まず
  canonical の次番 **E-S49** へ再採番した（内容は不変）。
- **semantic classification:** **C — DIFFERENT_PROJECTION_SAME_SOURCE**
  ```text
  legacy（tutor）
    source     localStorage 'statementReviewHistory' の **最新 1 件**
    fields     weaknesses のみ
    normalize  先頭 2 件 / 各 60 字 / ' / ' 連結
    threshold  1 件でも出る
    empty      行ごと省略（代替文言なし）

  canonical（buildPreviousOutputSummary）
    source     履歴 N 件（Stage 3 の top-cap window）
    fields     weaknesses ＋ actions → repeatedAdvice / strengths → repeatedThemes
    normalize  頻度順 ＋ 総量 cap
    threshold  **2 件未満は空**（反復は 2 件以上でしか定義できない）
  ```
  同じ table を読むが、**選択・集約・下限**がすべて異なる。したがって A / B ではなく C。
- **★ canonical 側の集約を legacy に合わせない ★**
  `buildPreviousOutputSummary` は「反復して指摘され続けている論点」を出す projection で
  あり、「直近の課題」とは目的が違う。consumer migration の都合で canonical の意味を
  legacy へ寄せると canonical 側の設計意図が失われる（E-S25）。
- **Decision:** legacy 相当の射影（最新 1 件の weaknesses）は
  **shadow comparison 専用の projection** として実装してよい。ただし:
  ```text
  許可  canonical rows → legacy と同じ selection / fields / normalization を通す
        （normalization は legacy の buildStatementWeaknessLine を再利用する。
          定数を複製すると legacy と canonical で表現がずれ比較が意味を失う）
  禁止  prompt / block / ExamContextInput へ接続すること
        canonical の正式 consumer contract として宣言すること
  ```
  実装上は `ExamContextInputSnapshot`（shadow 専用の型）にだけ slot を足し、
  `ExamContextInput`（block builder の入力）には載せない。
  QA が「block builder / ExamContextInput に漏れていない」ことを機械検証する。
- **★ transport READY と semantics READY を混同しない ★**
  ```text
  transport  READY   claim 配線 / window parity（E-S47 の primitive を statement_review へ適用）/
                     cap 超過でも検証可 / header は履歴件数に比例しない / raw 非混入
  semantics  DEFERRED 上記 classification C のため
  overall    DEFERRED
  ```
  claim / fingerprint / window parity は semantic 分類とは無関係に検証できる。
  両者の verdict を混同しない。
- **consumer migration blocker（未解決 / 記録）:**
  ```text
  Tutor を canonical へ移す際、statement_review の表現として
    (a) 最新 1 件の課題（legacy 相当）
    (b) 反復論点（canonical の既存 projection）
    (c) 両方
  のどれを採るかは **product 判断**であり、本 Stage では決めない。
  この判断が済むまで statement_review の consumer semantics は DEFERRED。
  ```
  したがって S5-P8 でも tutor-facing canonical block は **追加しない**
  （`STATEMENT_REVIEW_CANONICAL_BLOCK=NO`）。
- **★ これは consumer switch ではない ★** production tutor prompt は legacy 経路の
  ままである（E-S43）。S5-P8 では promotion 前後で `buildTutorSupabaseContextSection` /
  `buildTutorStudentContextSection` / **`buildTutorUserPrompt`** の出力を 13 fixture
  （0 件 / 1 件 / cap / cap+1 / cap 超過 / tie 境界 / device-server 一致 / 不一致 /
  空 result / read failure / full ほか）で **byte 一致**確認している。
  `buildStatementWeaknessLine` の `export` 化は可視性のみの変更で、出力は不変。
- **Implementation evidence:** `lib/examSpine/context/shadow/statementReviewProjection.ts` ／
  `lib/examSpine/context/types.ts`（`ExamContextInputSnapshot` の shadow slot）／
  `lib/examSpine/context/assemble.server.ts`（`resolveContextInput` の副産物）／
  `lib/examSpine/context/shadow/compareTutor.ts`（legacy 相当同士の比較）／
  `lib/examSpine/sync/claim/deviceBasicInfo.ts`（`deviceStatementReviewToken`）。
  QA は `scripts/exam-spine-stage5-6-check.ts`。
- **mirror gap（既知 / 本 Stage では直さない）:** 削除と 10 件 cap の eviction が
  server へ伝播しない（`EXAM_SPINE_STAGE3_READINESS_AUDIT.md` §10.1 G3 / G4）。
  device が消した添削も server に残るため、その端末では正当に mismatch になる。
  Source-Sync が stale を使わせない設計どおりの挙動であり握り潰さない。
- **Alternatives rejected:**
  - *canonical の aggregation を legacy 仕様に置き換える* — canonical の設計意図を壊す。
  - *legacy 相当射影を正式 block にする* — product 判断を実装都合で先取りする。
  - *空同士の一致で semantic MATCH と見なす* — E-S46 の false-empty guard に反する。
- **Rollback implications:** shadow projection は comparator からしか呼ばれない。
  削除しても consumer に影響しない。claim も送らなくなれば `unclaimed` に戻るだけ。

## E-S50 — device history window の tie-break は kind ごとに保証度が異なる

- **Status:** `LOCKED`（Stage 5.6 で監査。S5-P8 で昇格。**S5-P9 で interview_record / S5-P10 で essay / S5-P11 で presentation（N/A）/ Stage 5.10 で self_pr を追加**）
- **ID 由来（S5-P8 promotion）:** source branch では branch-local `E-S45` として
  採番されていたが、canonical の `E-S45`（activity の canonical 表現はカテゴリ別件数）は
  **別 Decision** である。**E-S50** へ再採番した。
- **背景:** E-S47 / E-S48 の window parity は「device と server が同じ top-N を選ぶ」ことに
  依存する。ordering は `created_at DESC` だが、**同一 timestamp の tie を何で解くか**が
  kind によって違う。
- **監査結果:**
  ```text
  self_analysis     server: created_at DESC, id DESC（DB uuid）
                    device: createdAt DESC + 挿入順（安定ソート）
                    device view は id を持たない（deviceSelfAnalysisRow が id: null）
                    → cap 境界で同一 createdAt が跨ぐ場合のみ選択がずれ得る（残余リスク）

  statement_review  server: created_at DESC, id DESC（DB uuid）
                    device: createdAt DESC + 挿入順（安定ソート）
                    ★ item view は localReviewId を含む（両側で共有される安定 id）
                    → **選ばれた集合が同じなら fingerprint は必ず一致する**
                      （sortSyncItems が localReviewId 込みの fingerprint 順で正規化）
                    → 残余リスクは「どの N 件を選ぶか」だけに限定される
                    → **Level B**

  interview_record  server: created_at DESC, id DESC（DB uuid）      ★ S5-P9 で追加
                    device: createdAt DESC + 挿入順（安定ソート）
                    ★ item view は localRecordId を含む（両側で共有される安定 id）
                    ★ device row は `id: null` を置き DB id を持たない
                    → statement_review と同じ保証度。選ばれた集合が同じなら
                      fingerprint は必ず一致し、残余は cap 境界の同一 created_at のみ
                    → **Level B**

  essay             server: updated_at DESC, created_at DESC, id DESC    ★ S5-P10 で追加
                    ただし `updated_at` は DB の `DEFAULT now()` が決める
                    **mirror 書込時刻**であり device の値ではない
                    device: localStorage は `workspace.updatedAt` DESC（applyLruCap / 最大 10）
                    ★ backfill 経路で **完全反転**する
                      （`backfillEssayWorkspacesOnce` が updatedAt DESC 順に逐次 upsert
                        するため、device で最も新しい workspace が最小の updated_at を得る）
                    → device は **揃えるべき順序キーそのものを持っていない**。
                      selectDeviceSyncWindow を掛けても解決しない（近似で verified を作らない）
                    → **Level C**（tie の揺らぎではなく選択規則そのものの不一致）

  self_pr           server: updated_at DESC, created_at DESC, id DESC        ★ Stage 5.10 で追加
                    cap = 5（`EXAM_READ_CAPS.self_pr`）/ query limit = cap + 1 = 6
                    device: `deviceSelfPrView` は **window 未適用**で全件を hash する
                    ★ essay と違い「完全反転」は起きない
                      `prToRow` が `updated_at: pr.updatedAt` を明示送信するため、
                      全件 INSERT で終わる backfill では device の recency が DB に入る。
                      **essay の根拠をここへ流用しない。**
                    ★ それでも選択集合の一致を構造的に保証できない ★
                      (a) device 全件 vs server 上位 5 件 → 6 件以上で永久 mismatch
                      (b) `selectDeviceSyncWindow` は created_at でしか選べないが
                          server の第 1 キーは updated_at。さらに DO UPDATE 経路では
                          trigger `self_prs_set_updated_at` が now() で上書きするため、
                          編集後の device `updatedAt` と DB `updated_at` は一致しない
                      (c) `dualWriteSelfPRsDelta` は `propagateDelete: false` 固定で、
                          device で削除した PR が mirror に残り top-5 を占め得る
                      (d) device row は `id: null` を置き、server の id tie-break を再現できない
                    → **Level C**（window / ordering parity が未成立。claim は配線しない）
  ```

## Level 分類（S5-P9 で明文化）

```text
Level A  structural parity
         device / server が共有された stable id を持ち、境界の順序決定まで一致する。
         → 現時点で該当する kind は **無い**（device は DB id を知り得ないため）。

Level B  selected-set parity only
         選ばれた集合が同じなら fingerprint parity は保証される。
         同一 created_at が cap 境界を跨ぐ場合だけ選択がずれ得る。
         → self_analysis / statement_review / interview_record

Level C  no structural guarantee
         共有 stable id / 共有 ordering key が無く、選択集合の一致自体を構造的に
         保証できない。→ **essay**（S5-P10 で実測）/ **self_pr**（Stage 5.10 で監査）。
         ⚠️ 同じ Level C でも **根拠は別**である。essay は backfill による updated_at の
            完全反転、self_pr は window 未適用 ＋ created_at/updated_at のキー不一致 ＋
            delete 非伝播 ＋ id tie-break 不能。片方の evidence をもう片方の説明に使わない。

N/A      本監査の対象外。**class 2（server_authoritative / E-S3）で device claim を
         持たない kind**は、device↔server window parity という命題自体が成立しない。
         → **presentation** / **interview_ai**（S5-P11 で確定）
```

## `presentation` = N/A の根拠（S5-P11 / Stage 5.9）

```text
presentation      SOURCE_SYNC_APPLIES = NO（E-S3 / LOCKED）
                  server: presentation_results を created_at DESC, id DESC で cap 3 件
                  device: **比較対象が存在しない**
                          - EXAM_SYNC_SUPPORTED_KINDS に presentation が無い
                          - devicePresentationView / devicePresentationToken 不在
                          - buildTutorDeviceClaimEntries が presentation を出さない
                          - examSyncUsability({kind:'presentation'}) は canary 許可 +
                            verified でも `kind_not_syncable` で veto される
                  → tie-break の「揺らぎ」以前に **突き合わせる 2 つの window が無い**
                  → **N/A**（Level A/B/C のいずれでもない）
```

★ class 2 に A/B/C を付けない ★
Level A/B/C は「device が server と同じ top-N を選べるか」の保証度であって、
device が canonical を持たない kind に適用すると **保証度を捏造する**ことになる。
「claim が無い＝Level C（保証なし）」と書くのも誤りで、それは
「いつか claim を配線すべきだが未着手」という含意を持ってしまう。
class 2 は claim を配線しないことが決定事項である（E-S3）。

★ この行は Stage 5.9 が新設した canonical block とは独立である ★
`presentation_result_summary`（E-S54）は server read → 射影 → block であり、
Source-Sync の verified/mismatch 軸をまったく通らない。block ができたことは
window parity を要求する理由にならない。

★ 「実運用ではほぼ起きない」を理由に Level A へ格上げしない ★
発生確率と構造的保証は別物である。確率の議論は「今回は解消しない理由」に書き、
保証度そのものは device が持つ情報だけで判定する。
- **Decision:** tie-break の保証度を kind ごとに記録し、**一律の保証を主張しない**。
  device 側が server の DB `id` を知り得ない以上、「同一 `created_at` が cap 境界を
  跨ぐ」ケースでの選択一致は構造的に保証できない。
  ```text
  実運用での発生条件: 同一ミリ秒に 2 件以上が作られ、かつその境界が cap にかかる
  statement_review  saveReviewHistory は 1 添削 = 1 件で、人手操作が挟まる
  self_analysis     persistSelfAnalysisLog は summaryInputHash で dedup する
  → いずれも実運用では考えにくいが、構造的保証ではない
  ```
- **今回は解消しない理由:** 解消には device 側が server の row id を知る必要があり、
  claim に server 由来の識別子を持ち込むか、ordering を content 由来へ変えるかになる。
  前者は claim を policy input へ近づけ（E-S33 に反する）、後者は「最新 N 件」という
  window の意味を変える。いずれも Stage 5.6 の scope を超える。
- **★ 新 kind へ window を広げる packet はこの表を更新すること ★**
  `self_pr` / `essay` の device view は window 未適用であり、claim も未配線。
  **両者とも Level C として監査済みで、window を適用しないことが結論である**
  （essay = S5-P10 / E-S52、self_pr = Stage 5.10）。近似 window で verified を
  作らないため、この 2 kind は `EXAM_SYNC_RUNTIME_ENABLE_BLOCKED` に宣言してある。
  今後 window を広げる新 kind は、「その kind の tie-break 保証度」を本表へ追記し、
  Level を判定してから window を適用する。
  （`interview_record` は S5-P9 でこの手順どおり追記 → Level B 判定 → window 適用した。）
  **class 2（`presentation` / `interview_ai`）はこの手順の対象ではない。**
  claim を配線しないことが E-S3 で決まっているため、Level 判定ではなく
  `N/A` を記録する（S5-P11 で `presentation` を確定。旧記述はこの 2 kind を
  「claim 配線時に評価を始める」候補として挙げていたが、E-S3 と矛盾するため訂正した）。
- **Rollback implications:** なし（監査記録）。

## E-S51 — interview_record の Tutor 表現は canonical から再現でき、専用 block を持つ（ただし接続はしない）

- **Status:** `LOCKED`（Stage 5.7 で実装 + QA 済み。Tutor migration gap G5）
- **ID 由来（S5-P9 promotion）:** source branch では branch-local `E-S46` として
  採番されていたが、canonical の `E-S46`（self_analysis の canonical 比較元は
  Supabase 層 projection であり readiness は実データを要求する）は **別 Decision**
  である。verbatim では持ち込まず canonical の次番 **E-S51** へ再採番した。
- **semantic classification:** **B — EQUIVALENT_AFTER_NORMALIZATION**
  （`statement_review` の C とは異なり、canonical 側に競合する projection が無い）
- **★ 前提の訂正（重要）★**
  legacy の「面接の課題」行（`buildInterviewLine`）は 2 つの入力を取るため、
  一見 `interview_ai`（AI 面接）と `interview_record`（対人練習）の 2 kind に
  またがるように見える。**実際は両方とも同じ 1 レコード由来である。**
  ```text
  app/tutor/page.tsx  const interviewRecord = getInterviewRecords()[0]
    interviewRecordLatest   = { improvementSummary, whatWentWrong }   ← その record
    interviewFeedbackLatest = JSON.parse(record.feedbackJson).improvements ← 同じ record の列
  ```
  すなわち `interviewFeedbackLatest` は `interview_ai` ではなく
  `interview_practice_records.feedback_json` である。したがって Tutor の面接行は
  **`interview_record` 単独で再現できる**（`interview_ai` を待つ必要がない）。
  従来の gap 表は「interview_ai が prompt に出ている」という誤った記述だった。
- **legacy の選択・整形規則（正確に写す対象）:**
  ```text
  selection  getInterviewRecords()[0]（= 最新 1 件。localStorage は newest-first）
  priority   1. feedbackJson を isInterviewFeedback で guard → improvements
             2. improvementSummary → whatWentWrong（空でないものを順に）
             3. どちらも無ければ行を出さない（代替文言なし）
  normalize  先頭 3 件 / 各 80 字 / ' / ' 連結 / 全体 500 字
  ```
- **Decision:** canonical `interview_record` から legacy 同等の「面接の課題」1 行を
  生成する専用 Stage 2 block を持つ（block id `interview_issue_line`）。
  正規化は legacy の `buildInterviewLine` を **再実装せず共有**する
  （定数を複製すると legacy と canonical が静かにずれ、比較が意味を失う / E-P6）。
- **★ block がある ≠ consumer が使う（本 packet の最重要境界）★**
  ```text
  A. projection が存在する            YES（interviewRecordProjection.ts）
  B. canonical block が登録されている  YES（registry / EXAM_CONTEXT_BLOCK_IDS）
  C. tutor plan に載っている           YES（shadow から build させるため）
  D. prompt builder が plan を読む     NO  ★ここで止まる★
  E. AI-visible prompt が変わる        NO
  ```
  `EXAM_PURPOSE_PLANS` は production code から一切 import されておらず、
  tutor plan は `render: null` / `legacyBuilder: null` である。すなわち plan は
  **shadow / QA 専用の宣言**であって prompt 経路ではない。したがって
  「plan に載る」ことは activation ではない。この非同値性は Stage 5.7 QA の
  T6 が機械検証する（production file の import 走査 ＋ render/legacyBuilder 検査）。
  ```text
  plan に tutor_student_context と interview_issue_line が併存するのは重複ではなく、
  移行時に前者（bridge 由来の横断要約）を後者（interview_record を source kind に
  持つ server 由来の同等表現）へ置き換えるための対応関係の明示である。
  ```
  Tutor consumer の切替は別 Stage（E-S40 の first-consumer pin を維持）。
- **window / tie-break:** history kind として cap window を適用する（E-S48）。
  device view は `local_record_id`（device の `record.id`）を持ち、server の SELECT にも
  `local_record_id` があるため **Level B**（E-S50 に追記済み）。
  device 側の `selectDeviceSyncWindow` は `createdAt` で選ぶ。localStorage は
  `addInterviewRecord` が newest-first で書くため格納順は既に一致するが、
  「保存順が信頼できる」ことに依存しないため明示的に created_at で選ぶ。
- **privacy:** server SELECT は `questions_asked` / `my_answers`（逐語）を読まない。
  block content は整形後の 1 行のみで、逐語・質問文・feedback 本文は block にも
  `ExamContextInput` にも telemetry にも現れない。mismatch path も含めて QA が固定する。
- **lossy field の確認:** canonical mapper は `improvement_summary` / `what_went_wrong` を
  `longText`(4000) で先に truncate するが、legacy の整形は 80 字 / 500 字なので
  **4000 字を超える値でも先頭 80 字は一致する**。実用上の欠落は無い。
- **★ readiness を 4 つに分解する ★**
  ```text
  transport  READY     claim 配線 / window parity / cap 超過でも検証可 /
                       header は履歴件数に比例しない（5/200/1000 いずれも 228 bytes）
  semantics  READY     classification B。legacy と同じ normalizer を共有し
                       同一入力から同一行を得る（QA が MATCH を実証）
  block      READY     registry contract 固定 / 決定論的 / 空なら行を出さない /
                       整形上限は legacy と共有 / plan 位置の authority も確定
  consumer   DEFERRED  AI-visible activation は別 Stage（本 Decision の D/E）
  overall    READY（Source-Sync として）／consumer 移行は未
  ```
  `statement_review`（E-S49）が semantics DEFERRED なのは canonical に競合 projection が
  あり product 判断が要るからで、`interview_record` にはそれが無い。両者を同一視しない。
- **Alternatives rejected:**
  - *`interview_ai` の wiring を待つ* — 前提の誤り。legacy の面接行は interview_record 単独で足りる。
  - *shadow 専用射影に留める* — 競合する canonical projection が無いので block にしてよい。
    留めると Tutor 移行時に必ず block 追加が再燃する。
  - *canonical 側で整形を書き直す* — 定数が 2 箇所になり legacy と乖離する。
  - *plan に載せずに block だけ作る* — shadow comparison が block を build できず、
    「canonical が legacy を再現できるか」を測れなくなる。
- **Rollback implications:** block は plan から外せば消える。claim も送らなければ
  `unclaimed` に戻るだけで legacy 挙動は不変。production prompt は本 Decision の
  前後で **byte 一致**（S5-P9 で 14 fixture 実測）。

## E-S52 — `essay` の read window は device から再現できない（claim 配線の blocker）

- **Status:** `LOCKED`（Stage 5.8 で実測 + QA 済み。S5-P10 で canonical へ昇格）
- **ID 由来（S5-P10 promotion）:** source branch では branch-local `E-S47` として
  採番されていたが、canonical の `E-S47`（device の history window は server の read
  window と一致させる）は **別 Decision** である。**E-S52** へ再採番した。
- **Decision:** `essay` の device claim を **配線しない**。
  `EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay` を維持する。
  理由は E-S27 の projection ではなく **read window の選択規則**である。
- **★ canonical では blocker が一度消えていた（S5-P10 の重要な発見）★**
  ```text
  S5-P2   R5 evidence（E-S41 / E-H1）で E-S27 が CLOSED になり essay を宣言から撤去
  S5-P10  canonical の実コードで **別の blocker** が実在することを確認し、再投入
  ```
  E-S41 は「機構（空の map）は残す。contract は確定しているが production evidence が
  未取得という状態は今後も起こり得るため、宣言 1 行で veto できる口を保つ」と定めており、
  本 Decision はその口を**想定どおりに使い直した**ものである。**R5 は CLOSED のまま**で、
  E-S27 の結論は覆っていない。
- **観測（canonical 実コードで再検証）:**
  ```text
  server : essayQuery は ORDER BY updated_at DESC, created_at DESC, id DESC / LIMIT cap+1
           essay_workspaces.updated_at は `timestamptz NOT NULL DEFAULT now()`
           essayWorkspaceRepository は updated_at を明示的に書かない
           = **mirror 書込時刻**であって device の値ではない
  device : localStorage `essayWorkspaces` は applyLruCap により
           `workspace.updatedAt` DESC で並ぶ（最大 10 件 / MAX_ESSAY_WORKSPACES）
           deviceEssayRow は updated_at に workspace.updatedAt を置く
  ```
  この 2 つは別物であり、しかも **backfill 経路では逆順になる**。
  `backfillEssayWorkspacesOnce` は `loadEssayWorkspaces()`（updatedAt DESC）の順に
  逐次 `await` で upsert するため、device で最も新しい workspace が最も小さい
  `updated_at` を得る。結果、`ORDER BY updated_at DESC` の上位 cap 件は
  **device の「最も古い cap 件」と一致する**（完全反転。tie-break の揺らぎではない）。
- **影響範囲:** workspace 件数が `EXAM_READ_CAPS.essay`（=5）以下なら
  両者の window は必ず全件一致するため fingerprint も一致する。
  **6〜10 件の user でのみ**、内容が完全に同期していても永久 mismatch になる。
  これは E-S38 / Stage 5.4 と同種の「runtime では mismatch としか見えない」故障である。
- **★ device window を足しても解決しない（tie-break Level C）★**
  `deviceEssayView` は `selectDeviceSyncWindow` を **掛けていない**。
  Stage 5.4 の window primitive 導入時に「essay は claim 未配線なので触らない」と
  明記されたまま残っている。ここに window を足しても、
  **揃えるべき順序キー（DB の `updated_at`）を device が持っていない**ため解決しない。
  近似で verified を作らないため、essay の device view は意図的に window 未適用のまま
  据え置く。tie-break 保証度は **Level C**（E-S50 に追記）。
- **解除条件（いずれか。どれも本 Stage の範囲を超える）:**
  ```text
  1. essayQuery の ORDER BY を created_at DESC, id DESC に変える。
     created_at は writer が workspace.createdAt を原値で書くため device が再現できる。
     ただし「AI に見せる 5 件」が *直近に編集した順* から *作成が新しい順* に変わる
     = **product semantic の変更**であり人間判断が要る。
  2. essay_workspaces に device 由来の recency 列（例 workspace_updated_at）を持たせる。
     DB migration を伴う。
  3. EXAM_READ_CAPS.essay を MAX_ESSAY_WORKSPACES（10）以上にし window 選択自体を消す。
     token 予算と Canon §56 への影響を評価する必要がある。
  ```
  1 つでも未検証なら blocker は維持する。
- **★ これは宣言であって gate ではない ★**
  `EXAM_SYNC_RUNTIME_ENABLE_BLOCKED` は `examSyncUsability` の 4 段 veto のうち
  2 段目にすぎず、3 段目の canary は既定 deny。production code からの参照は **0 本**で、
  読むのは宣言元（`registry.ts`）と pure decision layer（`sync/enable.ts`）だけ。
  したがって本 Decision は runtime 挙動を変えない（usable kinds が 8 → 7 になるのは
  `examSyncUsability` の判定結果であって production の経路ではない）。
- **Alternatives rejected:**
  - *`workspace.updatedAt` で device window を掛けて「だいたい合う」ことにする* —
    backfill 経路で **確実に反転する**ことを実測済み。近似で verified を作らない。
  - *cap を超える user を無視する* — LRU は 10 件なので 6〜10 件は実在しうる帯域である。
  - *mismatch を握り潰して fail-open にする* — Source-Sync の目的（stale な server 値を
    canonical として採用しない）を壊す。
  - *R5 が CLOSED だから blocker を空のままにする* — blocker の軸が 1 本だと誤認する。
    S5-P10 の drift guard 分離（syncDevice）はこの誤りを機械的に落とす。
- **QA:** `scripts/exam-spine-stage5-8-check.ts` §3（W1 完全反転 / W2 window 未適用の pin /
  W3 cap 以下は一致・cap+1 で割れる / W4 配列順は fingerprint に影響しない）＋
  §5（blocker 実値 / decision layer veto / claim 未配線 / 宣言 consumer 0）。

## E-S53 — legacy Tutor の小論文材料は canonical `essay` とは別 store であり、専用 block を作らない

- **Status:** `LOCKED`（Stage 5.8 で実測 + QA 済み。S5-P10 で canonical へ昇格）
- **ID 由来（S5-P10 promotion）:** source branch では branch-local `E-S48` として
  採番されていたが、canonical の `E-S48`（canonical read cap は比較 window であり
  overflow は unreadable ではない）は **別 Decision** である。**E-S53** へ再採番した。
- **semantic classification:** **C — DIFFERENT_SEMANTICS**
- **Decision:** `essay` の canonical Tutor block を **作らない**。shadow の
  `essay.reviewLatest` は `canonical: null` / `omitted: 'no_canonical_block'` のまま据え置く。
- **★ 実 runtime path から確定した legacy の材料 ★**
  ```text
  app/tutor/page.tsx        const review = loadReviewResult()
  lib/essayPracticeStorage  REVIEW_KEY = 'essayPracticeReview'（SavedReview 単数）
    → body.essayReviewLatest = { weakPoints }
  app/api/tutor/route.ts    → buildTutorStudentContext
  tutorStudentContext       buildEssayWeaknessLine = weakPoints[0] を 60 字 truncate
    → prompt 行 label = '小論文添削の直近の課題'
  ```
  一方 canonical `essay` kind が読むのは
  `essay_workspaces` ← localStorage **`essayWorkspaces`**（`EssayWorkspace[]`）である。
- **★ 2 つは別 store であり、独立に進む ★**
  ```text
                     legacy                        canonical
  LS key             essayPracticeReview           essayWorkspaces
  record model       単数・上書き                  複数（LRU 10）× reviews append-only（最大 20）
  Supabase mirror    **存在しない**                essay_workspaces
  書き手             /essay-practice のみ          /essay-practice（dual-write）＋ /essay/structure
  ```
  `essayPracticeReview` に mirror は 1 つも無いため、server は legacy の材料を
  **原理的に読めない**。Phase 2 経路は workspaces にだけ書くため canonical が進んでも
  legacy は stale のまま。LS の eviction / delete も DB へ伝播しない。
- **Reason（E-S49 の失敗を繰り返さない）:** shape が違うものを無理に突き合わせると
  常に VALUE_MISMATCH になり「移行できない」という誤った結論になる。
  正しい結論は「**同じ意味の値が canonical 側に存在しない**」であって、
  canonical を legacy に寄せて捏造することではない。
- **product 判断として残すもの（人間判断 / 本 Stage では決めない）:**
  Tutor が見るべき「直近の添削」を legacy 単数 store と canonical workspaces の
  どちらに置くか。これが決まるまで essay の consumer semantics は DEFERRED。
- **Rollback implications:** block を作っていないので rollback 対象が無い。

## E-S54 — `presentation` の Tutor 表現は canonical から再現でき、正規化の正本を legacy と共有する

- **Status:** `LOCKED`（Stage 5.9 で実装 + QA 済み。S5-P11 で canonical へ昇格）
- **ID 由来（S5-P11 promotion）:** source branch（`exam-spine-w1-convergence-v2`）では
  branch-local `E-S49` として採番されていたが、canonical の `E-S49`
  （statement_review は同一 source の別 projection）は **別 Decision** である。
  verbatim では持ち込まず canonical の次番 **E-S54** へ再採番した（内容は不変）。
  採番の authority は canonical lineage（E-S37 / E-S38 で `exam-spine-stage4-stabilize`
  に確定済み）にあり、source 側の採番には触れていない。
- **semantic classification:** **B — EQUIVALENT_AFTER_NORMALIZATION**
- **Decision:** `presentation_result_summary` block を追加し、canonical の
  `presentation_results`（+ attempts / sessions enrichment）から legacy Tutor が prompt に
  出しているのと同じ「直近のプレゼン練習の結果」行を作る。整形規則（件数 3/3/2・1 要素 40 字・
  総合評価 120 字・カテゴリ順・weak/normal/strong の日本語ラベル・行の組み立て）は
  **`lib/contextBuilders/tutorPresentationSection.ts` を唯一の正本**とし、legacy と canonical が
  そこを共有する。canonical 側で書き写さない。
- **★ class 2 のまま扱う（E-S3 / LOCKED を変更しない）★**
  `presentation` は `server_authoritative` であり、本 Stage は Source-Sync を**増やさない**。
  `devicePresentationToken` / claim header / device fingerprint / device mirror parity /
  `verified` status を **1 つも作っていない**。device に canonical は存在せず、
  client の値は表示用 cache にすぎないため、claim を作ると「cache が古い＝正しい server の値を
  使えない」という逆向きの誤りになる（E-S3 の Reason そのもの）。
  ```text
  構造的な証明（QA §1 が実コードから機械検証する）
    EXAM_SYNC_SUPPORTED_KINDS         presentation を含まない
    isExamSyncSupportedKind            false
    examSyncUsability(presentation)    canary 許可 + verified でも veto
                                       reason = kind_not_syncable
                                       （canary_denied / not_verified より前段で落ちる）
    isExamSyncRuntimeBlocked           false ← essay 用の runtime blocker を流用しない
    adapter contract                   capability: not_applicable / revision.form: absent
                                       contentFields: []
  ```
- **★ `TRANSPORT_READY` という語を使わない ★**
  transport / window parity / tie-break Level は Source-Sync（class 1）の語彙である。
  class 2 に当てはめると「まだ検証していない」ように読めるが、実際には
  **検証すべき device 側の canonical が存在しない**。readiness は
  `AUTHORITY_MODEL` / `SEMANTICS` / `BLOCK` / `SHADOW` / `CONSUMER` で表現し、
  Source-Sync 軸は `N/A` と書く（E-S50 の presentation 行も同じ理由で `N/A`）。
- **★ source identity を 7 軸で照合した（Stage 5.8 essay の教訓）★**
  「似た feedback がある」ことを理由に同一 semantics としないため、次を実コードで突き合わせた。
  ```text
  軸              legacy                                   canonical
  writer          app/api/presentation/evaluate/route.ts   同じ（table が 1 つしかない）
  source table    presentation_results                     presentation_results（E-S15 の registry に含む）
  read graph      results → attempt_id → attempts          同じ
                  → session_id → sessions
  record identity 最新 1 件（created_at DESC / LIMIT 1）    created_at DESC, id DESC → 先頭行
  selection       最新のみ（履歴へ遡らない）                同じ（rows[0] のみ参照）
  field           feedback.{overallComment,goodPoints,     同一 field。canonical mapper は
                  improvements,nextPractice,categories}    feedback を raw Record のまま保持
                  + created_at + session の 3 列
  meaning         直近のプレゼン評価の要約                  同じ
  ```
  essay（`essayPracticeReview` vs `essayWorkspaces` = **別 store**）と違い、
  presentation は **同一 table・同一 read graph・同一 record** である。
- **★ `categories` は `feedback.categories` が authority ★（取り違え防止）**
  `presentation_results` には `categories` column も存在するが、これは書込時に
  `projectCategories(feedback) = { ...feedback.categories }` で作られる**派生コピー**で
  `DEFAULT '{}'::jsonb` を持つ。legacy は一貫して `feedback.categories` を読むため
  canonical も同じ field を採る。「似た値が別 column にある」ことを理由に出所を変えない。
  QA は両者に**意図的に違う値**を置いて取り違えを検出する。
- **B（A ではない）とした理由:** 意味・選択・record は同一だが、canonical mapper が
  session 文字列を `shortText=200` / `longText=4000` で先に切る点だけ表現が異なる。
  legacy の 40 / 120 字はそれより短いため二重 truncate は結果を変えない（冪等）。
  この「deterministic normalization を通せば同一」という条件付きなので B とする。
- **legacy 側の変更（behavior-preserving な抽出のみ）:**
  `loadPresentationContext` と `buildTutorSupabaseContextSection` に埋め込まれていた
  純粋部分を上記 module へ出し、legacy はそれを呼ぶだけにした。read（table / 順序 / limit /
  enrichment の発行条件）は一切変えていない。**出せるものが無い評価では従来どおり
  attempt/session を読まない**（projector は純関数なので enrichment 無しで 1 度試し、
  出るものがあると分かってから enrichment を読む）。
  ```text
  byte 不変の実測（S5-P11）
    fake supabase client を注入して loadTutorStudentContext →
    buildTutorSupabaseContextSection を 30 fixture で実行し、抽出前後の
    section bytes が完全一致することを確認した（PRE_HASH == POST_HASH）。
    fixture: presentation 22（none / minimal / full / multiple / 空 feedback /
    部分 field / 長文 / truncation 境界 40・41・120・121 字 / 日本語 / unicode /
    malformed feedback（null・配列・文字列）/ 不正 created_at / enrichment 欠落 /
    read error / 同一 created_at）＋ 既存 regression 8（self_analysis / basic_info /
    diagnosis / activity / interview_ai / 全部入り / 1200 字上限）。
  ```
- **★ 共有 module の drift は「比較」では検出できない ★**
  legacy と canonical が同じ normalizer を共有した結果、書式を変えると**両側が同時に**
  変わり shadow comparison は MATCH のまま通る。したがって QA は相対比較だけでなく
  **絶対 bytes**（`golden` 8 件）を固定する。golden の値は「抽出前の legacy 出力」から
  採っており、抽出後の実装から採っていない。
- **Alternatives rejected:**
  - *canonical 側に整形規則を書き写す* — legacy と静かにずれ、shadow comparison が意味を失う（E-P6）。
  - *`tutorContext.ts` から直接 import する* — `server-only` を transitively import するため
    canonical / QA から使えない。純粋部分だけを別 module へ出すのが唯一の解。
  - *`categories` column を使う* — 派生コピーであり `DEFAULT '{}'` を持つ。出所が変わる。
  - *presentation にも device claim を足す* — E-S3 に反する。class 2 に Source-Sync を適用しない。
  - *essay と同じ `EXAM_SYNC_RUNTIME_ENABLE_BLOCKED` を足す* — runtime blocker は
    class 1 の kind を「対象だがまだ有効化しない」と宣言する仕組みである。
    class 2 は `kind_not_syncable` で既に構造的に落ちており、blocker を足すと
    「解除すれば使える」という誤った含意が生まれる。
  - *block content を record（object）にする* — legacy が prompt に出しているのは行である。
    shape の違う値を突き合わせると常に VALUE_MISMATCH になる（E-S49 で踏んだ罠）。
- **★ consumer は切り替えない ★** plan に載せたのは shadow comparison から build されるように
  するためで、production の tutor prompt は従来どおり legacy の Supabase 層から組み立てる。
  Stage 5.9 の authority は block と shadow contract の確立までであり、AI-visible 化を
  要求していない。`AI_VISIBLE_CONTEXT_CHANGED=NO` / `PROMPT_CHANGED=NO`。
- **残余:** legacy の core query は tie-break を持たない（`created_at DESC` のみ）が canonical は
  `id DESC` を持つ。同一 `created_at` の result が複数ある場合だけ選択がずれ得る。
  `presentation_results` は `UNIQUE(attempt_id)` を持ち 1 attempt 1 結果なので実運用では
  起きにくいが、構造的保証ではない。**これは E-S50 の device window tie-break とは別物**で、
  server 内部の legacy read と canonical read の差である（device は関与しない）。
- **QA:** `scripts/exam-spine-stage5-9-check.ts`（183 checks）。§1 class-2 / no-claim の構造的証明、
  §2 canonical query と legacy read の一致・非読取列、§3 正本共有と `feedback.categories` authority、
  §4 semantic matrix S1〜S10、§5 block registry / purpose、§6 privacy と boundedness、
  §7 consumer invariance（robust prompt anchor）、§8 先行 Stage 境界（essay E-S52 blocker /
  statement_review E-S49 / interview_record E-S51 / E-S50 の N/A）、§9 golden bytes。
- **Rollback implications:** block は plan にのみ載り production prompt へ到達しないため、
  revert しても AI 出力は変わらない。legacy の抽出も byte 不変であるため同様。

---

# 5. Policy / persistence decisions

## E-S55 — active な device claim wire format は `edc1` 1 本とし、`signal.ts` の runtime codec を廃止する

- **Status:** `LOCKED`（2026-08-26。**人間の裁定**による。`E-S39` Decision 2 を supersede する）
- **ID 由来（S5-P7 promotion）:** source branch は本 Decision を branch-local に
  `E-S45` → `E-S46` として採番していたが、canonical はその後 `E-S46` を Stage 5.4
  （self_analysis 比較元）へ割り当てた（S5-P6）。canonical の番号は動かさず、
  後発である本 Decision を再採番した。canonical はその後さらに `E-S48` を
  Stage 5.5 read-window contract に割り当てたため再々採番し、さらに canonical が
  S5-P11 で `E-S54` を **presentation**（Stage 5.9）へ LOCKED 済みだったため、
  S5-P12 の controlled lineage 再収束で **E-S55** へ再々々採番した
  （E-S38-3 の手順。canonical の番号は 1 つも動かしていない）。内容は無変更。
- **HUMAN RULING（本 decision の権威）:**
  ```text
  E-H7 = OPTION C

  edc1        唯一の active device claim wire format / transport authority
  esy1        active wire format ではない。serialize / parse transport codec としては廃止
  signal.ts   必要なら型定義のみ残してよい。
              runtime serialization / parsing authority を持ってはいけない
  verdict.ts  ExamSyncSignal / esy1 codec への依存を除去し、最小 claim interface へ narrow

  DEVICE_CLAIM_TRANSPORT_AUTHORITIES = 1
  ACTIVE_DEVICE_CLAIM_WIRE_FORMATS   = 1
  ACTIVE_DEVICE_CLAIM_WIRE_FORMAT    = edc1
  ```
- **なぜ `E-S39` の layer 分離だけでは足りないか:** `E-S39` は「header に束縛された module が
  1 つだけ」であることを根拠に `DIFFERENT_LAYER` と判定した。これは観測として正しいが、
  **header を持たない wire codec がもう 1 本あること自体**が残る。`esy1` は独自の version /
  上限 / 区切りを持つ第 2 の wire schema であり、将来 header を足さなくても
  「どちらの schema として hex を解釈するか」という曖昧さを Spine 内部に残す。
  人間の裁定はこの残余を許容しないという判断である。
- **`E-S39` の削除懸念に対する実測回答:** `E-S39` は「signal.ts を消すと `verdict.ts`（E-S35）の
  入力型と Wave 4 の QA 資産を失う」ことを削除しない理由に挙げていた。実装で確認したところ
  **どちらも失われない**:
  ```text
  verdict.ts   入力を ExamSyncClaimSet（transport 非依存）へ narrow。
               この型は E-S33 の toDeviceClaims 戻り値と構造的に一致するため adapter 0 本、
               header の parse も E-S33 の parser 1 回だけ（同じ wire を 2 回 parse しない）。
  QA 資産      verdict の 4 値 / 優先順位 / incomparable の fail-closed fold /
               enable の判定順 / canary default deny / PII containment をすべて保持し、
               malformed matrix は E-S33 の実 parser を通す形へ移植した。
  ```
- **保持したもの（transport 収束を理由に 1 つも弱めていない）:** 外部 verdict の 4 値（`E-S35`）/
  `incomparable → unreadable` の fold と `unexpectedInternalStatus` / `enable.ts` の判定順（`E-S36`）/
  canary default deny（`E-S11`）/ PII containment。claim は引き続き kind + content fingerprint のみで
  revision 軸を追加していない（`E-S2`）。
- **機械検証（`scripts/exam-spine-readiness-check.ts` / `exam-spine-sync-signal-check.ts`）:**
  ```text
  active な device-claim wire codec は sync/claim/** だけ
  active code（app/** + lib/**）に 'esy1' が 0 箇所   ※ docs の歴史記述は対象外
  claim header の宣言が 1 箇所 / 別 file での直書き 0
  wire version の宣言が 1 箇所 / canonical は 'edc1'
  verdict.ts / enable.ts が transport module を import せず、実コードに wire literal を持たない
  E-S33 transport の production importer > 0
  ```
- **Alternatives rejected:** `E-S39` の原案（内部 codec として維持）— 上記のとおり第 2 wire schema が
  Spine 内部に残る。人間裁定により不採用。
- **Rollback implications:** `verdict.ts` の入力型を戻せば復帰できるが、`esy1` codec を復活させる
  意味は無い（production importer 0 のまま廃止された）。

## E-S56 — tutor `basic_info` の consumer 切替は「AI-visible 出力の同値」を採用条件とする

- **Status:** `LOCKED`（2026-08-27 / Stage 5 Packet 3。`E-S40` が開けた最初の consumer 切替の実装判断）
- **ID 由来（S5-P7 promotion）:** source branch は本 Decision を branch-local に
  `E-S47` として採番していたが、canonical はその後 `E-S47` を Stage 5.5 の
  window parity へ割り当てた（S5-P6）。後発である本 Decision を再採番し、
  S5-P12 の controlled lineage 再収束で **E-S56** へ再々採番した
  （canonical が `E-S54` を presentation、`E-S55` を transport で占めるため）。
  E-S38-3 の手順。内容は無変更。参照していた `E-S48`（transport）は
  再採番後の `E-S55` を指す。
- **決定:**
  ```text
  切替対象   tutor purpose の basic_info slot のみ（E-S40）
  採用条件   Source-Sync verified ＋ canary 許可 ＋ canonical slot が legacy と完全一致
  不一致時   legacy を維持し、理由を enum（divergent_projection / would_reduce_context /
             canonical_absent / not_usable）として観測へ残す
  承認 slot  EXAM_SPINE_SWITCHABLE_SLOTS = ['tutor.basic_info'] の 1 件のみ
  ```
- **なぜ「完全一致」を採用条件にしたか:** Packet 3 の制約は「consumer authority を切り替えるが、
  AI が見る文字列は変えない」である。行が増えるのも減るのも AI-visible の変化なので、
  同値を採用条件に据えるのが制約の機械的な強制になる。これは切替を骨抜きにする妥協ではなく、
  **切替は provenance（authority of record）に対して起き、出力には起きない**という宣言である。
  実測では 34 payload 中 25 件で canonical が authority を取り、切替は空回りしていない。
- **一致しない構造差（本 packet で解消できないもの）:**
  ```text
  legacy      preferences を 生のまま 3 件へ切ってから 非 record を捨てる
  canonical   read mapper が 非 record を捨てながら 10 件へ詰める
  ```
  壊れた entry が 3 件境界より前にあると採用件数がずれる。ずれの原因である
  「どの生 slot が壊れた entry に消費されたか」は mapper 通過後の row に残らないため、
  **row だけから legacy を再現することは原理的にできない**。read layer（Stage 3 / 全 consumer 共有）
  を本 packet で変えるのは scope 外なので fail-closed に倒し、`divergent_projection` として
  観測可能にした。壊れた entry は writer の型上は発生せず、localStorage 破損時のみ現れる。
  **read layer 側を legacy 順序へ寄せるかどうかは、consumer を広げる前に人間が決める論点である。**
- **cap の扱い:** legacy tutor は 40 字 / 3 件、canonical read layer は 200 字 / 10 件で切る。
  40 ≤ 200 / 3 ≤ 10 なので legacy cap を後段でかけ直せば二段切りは 1 段切りと等価。
  cap 値は `tutorBasicInfoSlot.ts` に宣言し、QA が `tutorContext.ts` の実値と突き合わせる
  （adapter が `BASIC_INFO_SCHEMA_VERSION` に対して採った宣言 + pin と同じ pattern）。
- **保持したもの:** legacy serverRead は削除しない（切替の土台であり、同値検査の相手でもある）/
  transport は `edc1` 1 本のまま（`E-S48`）/ shadow は observer のまま（`E-S42` / `E-S43`）/
  canary は default deny の連言（`E-S11`）/ 評定・氏名は slot に載せない（`E-P5` / `E-P8`）。
- **query 本数:** slot 切替と shadow は同じ canonical context を 1 回だけ組み立てて共用する。
  どちらも OFF の user では canonical assembly を 1 本も発行しない。

## E-S57 — read layer は生 `preferences` slot を事実として報告し、consumer 互換 projection をそこから作る

- **Status:** `LOCKED`（2026-08-27 / Stage 5 Packet S5-P8。`E-S56` が bounded fallback として
  残した projection 差の解消。`E-S56` の採用条件（AI-visible 同値）自体は変更しない）
- **解決した差:**
  ```text
  legacy      preferences を **生配列のまま 3 件へ切ってから** 非 record を捨てる。
              record でありさえすれば university / faculty を独立に読む
              （university: 123 の行でも faculty は採る）。
  canonical   read mapper が 非 record を捨てながら 10 件へ詰め、さらに
              university が string でない行を **行ごと** 落とす。
  → 壊れた entry が 3 件境界より前にあると採用件数がずれ、
    型不整合行の faculty は消える。
  ```
- **★ authority の判定（実測。どちらかを「好み」で選んでいない）★**
  ```text
  legacy 側 slice-before-filter
    A 明示仕様            該当なし。仕様文書にも DECISIONS にも記述が無い。
    B characterization    ★ 該当 ★ scripts/fixtures/exam-spine-tutor-loader/
                          T5-adversarial-shapes（"defensive parsing を固定する"）が
                          preferences: [null, 'string-not-object', {university:123,
                          faculty:'…'}] に対する section を golden で凍結している。
    C 偶然の実装詳細      ★ 該当 ★ 導入は無題の単一 commit a03c52c "Update UX"
                          （2026-06-05）。**同じ commit の中で** examTypes は
                          toStringArray（filter-before-slice）になっており、
                          2 つの配列で規則が食い違う。設計された規則ではない。
    D bug と判定済み      該当なし。bug fix を許可した decision は存在しない。
  canonical 側 filter-before-cap
    A source contract     ★ 該当 ★ E-S20（mapper は policy-free / 既定値を持たない）に
                          沿った read layer の正規化。
    C 他 consumer が依存  ★ 該当 ★ basicInfoSyncView の fingerprint（device / server の
                          両側が同じ mapper を通る）と projectBasicInfo（canonical block）。
  ```
  **両者を同じ authority level で LOCK した decision は存在しない**ので human ruling は要らない。
  由来が「無題 commit の実装詳細」である legacy を仕様として read layer へ持ち込むのも、
  characterization で凍結された AI-visible 出力を今変えるのも、どちらも採らない。
- **Decision:** read layer は **正規化した列を変えず**、生 slot の事実を併せて報告する。
  ```text
  guards.ts     toIndexedRecordArray(value, max)  … 生 index つき走査。
                toRecordArray はこれを map するだけに縮退（走査規則は 1 本）。
  rowMappers.ts ExamBasicInfoServerRow.rawPreferences
                  { sourceIndex, university, faculty, department }（string でなければ null）
                `preferences`（正規化列）と **同じ走査・同じ cap**（limits.recordItems）で
                1 回のループから作る。型不整合行も落とさない。
  consumer      projectTutorBasicInfoSlot が rawPreferences を sourceIndex < 3 で読み、
                legacy の規則を **書き写す**。mapper 後の値から「壊れた entry が
                あったはず」と推測する経路は作らない。
  ```
- **なぜ read layer に置いてよいか:** `sourceIndex` は payload に対する **事実**であって
  feature の方針ではない。どの slot を採るか・型不整合行を使うかは consumer が決めたままである。
  E-S20 が禁じているのは mapper が policy（cap の既定値・prompt 文言・採否判断）を持つことで、
  事実を報告することではない（`rowMappers.ts` の既存コメント「Stage 3 は事実をそのまま報告する」）。
- **★ AI-visible ではない / wire でもない（実測で封じ込め）★**
  ```text
  sync view        basicInfoSyncView は Pick で rawPreferences を受けない。
                   fingerprint は変更前後で byte 一致（efp1:2dcd09d8…）。
                   ここに漏れると device と server の claim が永久不一致になる。
  device view      deviceBasicInfoView も同じ mapper を通るが view には出ない。
  canonical block  projectBasicInfo の出力に sourceIndex は出ない。
  slot / section   slot の key は 5 つのまま。section 文字列にも出ない。
  DB               schema 変更なし。read model（in-memory）だけで閉じている。
  ```
- **実測結果:** 79 payload（malformed の位置 × 型 × 件数 × 長さ境界）で
  legacy と **byte 一致**。`divergent_projection` は 7 → **0**。canonical が authority を
  取る payload は 64 件（切替が空回りしていない）。
- **★ 残す bounded fallback（projection 差ではない）★**
  ```text
  先頭 200 字がすべて空白の文字列は read cap（E-S19 / shortText=200）により
  canonical 側が中身を見られない。legacy は trim 後に 40 字で切るので値が残る。
  → would_reduce_context / canonical_absent として legacy 維持。
    「canonical が値を持っていない」ケースであり、fail-closed が正しい。
  ```
- **equivalence veto は外さない:** 差が 0 になっても `E-S56` の採用条件は残す。
  将来 mapper や legacy を触ったときに黙って AI-visible 出力が変わらないための安全網である。
- **legacy serverRead は削除しない:** 同値検査の相手であり fallback でもある（`E-S56`）。
- **Alternatives rejected:**
  - *legacy を filter-before-cap へ揃える* — AI-visible 出力が変わる。characterization
    golden（T5）を書き換えることになり、本 packet の制約に反する。
  - *canonical mapper を slice-before-filter へ変える* — `preferences` の値が変わり
    Source-Sync の fingerprint が動く。他 consumer（canonical block）も巻き込む。
  - *consumer 側で「不正値があったはず」と件数から推測する* — mapper 後の値からは
    復元できない。payload 推測ロジックを consumer に増殖させる。
  - *`divergent_projection` を無条件に canonical 扱いする* — 制約そのものの放棄。
- **QA:** `scripts/exam-spine-packet3-check.ts`（79 payload byte 比較 / 封じ込め /
  4 gate combination の read 本数 0-1-1-1 / shadow legacy input の定数短絡検出）。
  negative control 20 件を mutation で実測しすべて検出。
- **Rollback implications:** `rawPreferences` を読まなくすれば Packet 3 時点の
  fail-closed 挙動へ戻るだけで、AI-visible 出力は不変。DB / wire / deploy への影響なし。

## E-S58 — tutor `activity` を 2 番目の controlled consumer 切替とし、集計正本の共有だけでは同値証明にしない

- **Status:** `LOCKED`（2026-08-27 / Stage 5 Packet S5-P10。`E-S40` が定めた「最初は basic_info 単独」の次段）
- **決定:**
  ```text
  切替対象   tutor purpose の activity slot のみ
  採用条件   Source-Sync verified ＋ canary 許可 ＋ canonical slot が legacy と完全一致
  不一致時   legacy を維持し、理由を enum（divergent_projection / would_reduce_context /
             canonical_absent / not_usable）として観測へ残す
  承認 slot  EXAM_SPINE_SWITCHABLE_SLOTS = ['tutor.basic_info', 'tutor.activity'] の 2 件
  ```
- **★ なぜ activity が次なのか（実測。branch の新しさではなく `E-S40` の 4 条件で選んだ）★**
  ```text
  E-S40 が「最初に tutor を選んだ理由」として挙げた 4 条件を現在値で再測した:
                       server read   device claim   canary gate   canonical block
    activity              ○             ○（E-S45）      ○            ○ activity_category_counts
    diagnosis             ○             ○（E-S44）      ○            ○ diagnosis_type_hint
    self_analysis         ○             ○（E-S46）      ○            ✗ tutor 向け block が無い
    statement_review      ○             ○（E-S49）      ○            ✗ block を作らないと決定済み
    interview_record      ○             ○（E-S51）      ○            ○（ただし接続しないと決定済み）

  4 条件を満たすのは activity と diagnosis。activity を先に採る根拠:
    schema_version drift  activity は writer / DDL default / device 宣言がすべて '1' で一致し、
                          既存行の永久 mismatch リスクが無い（E-S45 で実測済み）。
                          diagnosis は writer '3' / DDL default '1' で、bump 前に書かれた行を
                          持つ user が永久 mismatch になる既知の制約がある（E-S38）。
    集計正本              activity は legacy / canonical が既に同一関数を共有している（E-S45）。
    → 「切替の risk が最も小さい slot」を次に選ぶ。順序は decision で固定する。
  ```
- **★ 集計正本の共有は同値証明ではない（本 packet の最重要知見）★**
  legacy（`tutorContext.ts:projectActivity`）も canonical（`projectTutorActivitySlot`）も
  `lib/activityCategories.ts:summarizeActivityCategories()` を通る（`E-S45`）。
  そのため両者の byte 比較は **共有 oracle の比較**であり、
  **共有関数そのものが変わると両側が同じように壊れて素通りする**。
  ```text
  実測（負例）: summarizeActivityCategories の `arr.length > 0` を `>= 0` に変えると
               0 件カテゴリが prompt に出るようになるが、legacy / canonical の
               44 payload 全件が一致したまま通過した。
  ```
  したがって本 packet は **section 行そのものを golden として凍結**した
  （`ACTIVITY_LINE_GOLDEN`）。凍結対象は宣言順・ラベル・区切り「・」・
  「が保存されています（計N件）。」の定型・0 件時の行ごと省略・非配列の除外。
  **期待値をコードから再生成して更新してはいけない。** 更新は prompt 文言を
  意図的に変えるという別の決定である。
- **legacy `activity` semantics（byte-level で固定した内容）:**
  ```text
  source     activity_logs.payload（auth-scoped / maybeSingle / user_id scope）
  走査順     ACTIVITY_CATEGORY_LABELS の **宣言順**（payload の key 順ではない）
  採用条件   Array.isArray(v) && v.length > 0
  未知 key   集計しない（prompt に出ない）
  0 件       カテゴリごと出さない。合計 0 なら **行ごと省略**（代替文言を作らない）
  要素       **中身を一切見ない**。長さだけ。narrative / timestamp / 重複は無関係
  cap        件数 cap も文字 cap も無い（section 全体 1200 字の行単位 fit のみ）
  行         `・活動整理には、{label}{n}件・… が保存されています（計{total}件）。`
  ```
- **★ `ExamActivityServerRow.categoryCounts` を consumer が使わないこと ★**
  あれは「payload 内で配列だった **生 key** → 長さ」であり、未知カテゴリと 0 件を
  含み、ラベルではなく key のままである。**別の表現**なので tutor slot が読むと
  prompt が変わる。slot は `row.payload` だけを読む（QA が `row.*` の参照先を
  `payload` のみに pin し、`row.categoryCounts` が実際に別物であることも実測で示す）。
- **query 本数:** slot 切替（basic_info / activity）と shadow は同じ canonical context を
  **1 回だけ**組み立てて共用する。gate は `anySlotSwitchEnabled || shadowEnabled` の 1 段で、
  2 slot × shadow の 8 通りすべてで canonical read は 0 か 1（2 にならない）。
- **slot 独立:** gate / usability / veto は slot ごとに独立に評価する。
  `tutor.basic_info` を許可しても `tutor.activity` は ON にならない（E-S11 の連言を slot 単位で維持）。
- **保持したもの:** legacy serverRead は削除しない（同値検査の相手であり fallback）/
  transport は `edc1` 1 本のまま（`E-S55`）/ shadow は observer のまま（`E-S42` / `E-S43`）/
  canary は default deny の連言（`E-S11`）/ basic_info の `rawPreferences` 互換 projection（`E-S57`）は不変 /
  narrative は canonical block にも slot にも載せない（`E-S45`）。
- **★ shadow observation は prompt 経路へ流さない ★**
  `shadowOverall` / `shadowMismatchCount` は宣言 / shadow block 内の代入 / telemetry 以外に
  現れてはいけない。これも負例で穴が見つかったため QA を追加した
  （比較結果で context を分岐させる変異が、従来の禁止識別子リストを素通りしていた）。
- **Alternatives rejected:**
  - *diagnosis を先に切り替える* — schema_version drift による永久 mismatch を抱えたまま
    consumer authority を移すことになる。risk の小さい方から進める。
  - *legacy / canonical が同じ関数を通ることを以て同値とする* — 共有 oracle の盲点。
    上記のとおり負例で実際に素通りした。
  - *`row.categoryCounts` をそのまま slot にする* — 未知カテゴリと 0 件が prompt に出る。
  - *golden を廃して byte 比較だけにする* — AI-visible の凍結点が無くなる。
- **QA:** `scripts/exam-spine-packet4-check.ts`（44 payload byte 比較 / golden 6 件 /
  narrative・PII containment / slot 独立 gate / 4+8 gate combination の read 本数 /
  route wiring / essay_chat 非漏洩）。negative control 24 件を mutation で実測しすべて検出。
- **Rollback implications:** env から `tutor.activity` を外せば legacy へ戻る。
  slot module を削除しても AI-visible 出力は不変（legacy 経路が土台のまま）。
  DB / wire / deploy への影響なし。

## E-S59 — `schema_version` は writer contract の版であり、旧版 row は「内容が違う」のではなく「比較の資格が無い」

- **Status:** `LOCKED`（Stage 5.11 / Run 2。`E-S44` が migration blocker として記録した
  schema_version divergence の解消。`E-S44` の block 定義・hint 正本は変更しない）
- **背景:** `E-S44` は「`diagnosisSyncView` は `schemaVersion` を content field に含む。
  writer は `"3"` を書くが DDL default は `'1'` であり、bump 前に書かれた行は `'1'` のまま。
  その行を持つ user は永久 `mismatch` になる」を **切替時の受け入れ条件**として残していた。
  本 Decision がその受け入れ条件に答える。

## 1. `schema_version` が表すもの（実測で確定）

```text
schema_version = **writer contract の版**

× payload の shape 版          diagnosis の v1→v2 は shape を変えずに bump した
                               （calcDiagnosisResultType の判定変更のみ）
× storage row の版             行の物理形式は DDL が決めており版に依らない
× device が保持する値          device は保存していない。`EXAM_DEVICE_SCHEMA_VERSIONS`
                               という **build 時定数を合成**して比較に載せている
```

したがって sync view の `schemaVersion` を突き合わせることは
「この行を最後に書いた writer は、今の build と同じ contract か」を問うている。
**内容の一致とは別の問い**である。

## 2. 版の実測（`EXAM_WRITER_SCHEMA_CONTRACTS` が正本）

```text
basic_info   current '1' / superseded なし  … bump 実績なし。DDL DEFAULT も '1'（divergence なし）
activity     current '1' / superseded なし  … 同上
diagnosis    current '3' / superseded '2','1'

★ "1" だけではない ★ diagnosis の writer 定数は 1 → 2 → 3 と **2 度** bump している。
  各時期に書かれた行がそのまま残るため、mirror に存在し得る版は '1' / '2' / '3' である
  （`E-S44` の記述は '1' のみを挙げていた。本 Decision で '2' を追加した）。
```

## 3. 版が上がると既存 row は comparison ineligible になる（一般則）

`schemaVersion` は content field なので、writer が bump した瞬間に **bump 前に書かれた
全 row** が device 側の新定数と一致しなくなる。これは事故ではなく、
「古い contract で書かれた行を verified と呼ばない」という fail-closed な設計である。
ineligible な行は canonical 経路に乗らず legacy へ倒れる。

**したがって writer の `SCHEMA_VERSION` を bump する packet は、その kind の既存 mirror row
全件を comparison から外すことになる。** `EXAM_WRITER_SCHEMA_CONTRACTS` へ影響を明示すること。

## 4. ineligible ≠ 内容が違う（consumer switch を許す根拠）

```text
payloadMappingStable   writer が device canonical を **無加工で** payload に載せるか
                       diagnosis: true（upsertDiagnosisLogToSupabase は payload: input.diagnosis）
                       basic_info: false（stripName が氏名を落とす / E-P8）

projectionCompatible   superseded な版の row でも canonical 射影が現行版と同じ
                       AI-visible 値になるか
                       diagnosis: true（resolveDiagnosisTypeHint が number(1-4) と
                       ExamType(9種) の両系統を扱うため、v1 / v2 の row でも
                       hint 1 文は現行と同じ規則で解決できる）
```

`projectionCompatible = true` は **射影の互換性**であって **比較の資格**ではない。
両者を混同しないこと。前者が真でも ineligible は開かない。

## 5. 採った戦略 — eligibility gate（Strategy B）

```text
v3（current）    comparison eligible → verified になり得る → canonical 経路
v1 / v2         comparison ineligible → legacy 経路へ倒れる（fail-open / E-P7）
```

現行の Source-Sync では `schemaVersion` が content field なので、この結果は
**既に成立している**（旧版 row は fingerprint が一致せず `usable` の時点で落ちる）。
本 Decision が足したのは **宣言と検出可能性**である。`E-S44` は
「検出性: runtime では mismatch としか見えず原因が表面化しない」を defect として
挙げていた。`decideTutorDiagnosisSlot` は `schema_version_ineligible` を
`divergent_projection` と **別の reason enum** として返し、telemetry に enum で残す。

## 6. やらないこと（禁止事項）

```text
× DB backfill / migration apply        本 Run は DB write をしない。将来やる場合も
                                       本表の役目ではなく別 Decision が要る
× v1 row を verified 扱いする          「たぶん同じ contract だろう」で verified を作らない
× `schemaVersion` を sync view から    `E-S44` が既に rejected。比較を弱めて mismatch を
  外して一致させる                     消すのは authority を一致させたことにならない
× DDL DEFAULT '1' を '3' へ変える      DEFAULT は「版を明示しない writer」のための値であり、
                                       現行版を入れると **未知の contract で書かれた行に
                                       現行版のラベルを貼る**ことになる。全 write path が
                                       明示送信する以上 DEFAULT に落ちる経路は存在せず、
                                       変更の便益は無い。schema.sql は live DB の写しなので、
                                       apply しない変更を書くと doc drift を作る
```

- **DDL default の扱い（結論）:** `diagnosis_logs.schema_version` の
  `NOT NULL DEFAULT '1'` は **latent hazard であって現に発火していない**。
  repo 全走査で diagnosis_logs への write path は
  `lib/supabase/diagnosisLogs.ts:upsertDiagnosisLogToSupabase` **1 本のみ**で、
  `schema_version: SCHEMA_VERSION` を必ず送る（caller は `dualWriteDiagnosisLog` /
  `backfillDiagnosisLogOnce` の 2 つで、どちらも同関数を通る）。
  したがって DEFAULT に落ちる経路は存在しない。**変更せず、QA で「全 write path が
  明示送信すること」を pin する**方を選ぶ（default が発火し得る経路が生まれたら QA が落ちる）。

## 7. legacy row は自然治癒しない（静的推論）

`backfillDiagnosisLogOnce` は `backfillDone(userId, 'diagnosisLog')` で **一度きり**に
gate されており、flag は localStorage（`supabaseBackfill`）にある。
したがって bump 前に backfill を終えた端末は、ユーザーが **診断を取り直さない限り**
再 upsert しない。旧版 row は持続する母集団である。
live DB を見ずに（本 Run は DB read も禁止）QA fixture で v1 / v2 / v3 を再現して
safety ruling を作る。

- **★ snapshot kind に「mixed 版」は存在しない ★**
  `diagnosis_logs` は `UNIQUE(user_id)` の 1 行/ユーザーなので、1 user の中で
  v1 と v3 が混在することはあり得ない。混在は **母集団レベル**（user ごとに版が違う）
  であり、QA はそれを「版の異なる user を並べて全員 fallback が正しく決まるか」で検証する。

- **Decision:** 上記 1〜7 を `EXAM_WRITER_SCHEMA_CONTRACTS` /
  `isComparableSchemaVersion()`（`lib/examSpine/sync/adapters/registry.ts`）として宣言し、
  `diagnosis` の consumer 切替の受け入れ条件に組み込む。
- **Implementation evidence:** `lib/examSpine/sync/adapters/registry.ts`
  （`EXAM_WRITER_SCHEMA_CONTRACTS` / `isComparableSchemaVersion`）／
  `lib/examSpine/context/tutorDiagnosisSlot.ts`（`schema_version_ineligible`）。
  QA は `scripts/exam-spine-stage5-11-check.ts`。
- **Alternatives rejected:**
  - *Strategy A（read-time normalization で v1 を v3 相当に正規化）* — 版は writer contract の
    事実であって正規化の対象ではない。正規化すると「古い contract で書かれた」という
    情報が消え、`E-S44` の検出性 defect が悪化する。
  - *Strategy C（semantic incompatibility として consumer switch を BLOCKED）* —
    `payloadMappingStable` かつ `projectionCompatible` が実測で真であり、
    旧版 row は legacy へ倒れて **出力が変わらない**。BLOCKED にする根拠が無い。
  - *DDL DEFAULT を bump する* — 上記 §6 のとおり。
- **Rollback implications:** 宣言と reason enum の追加のみ。runtime の比較規則は変えていない
  ため、削除しても AI-visible 出力・verdict・fingerprint は不変。

## E-S60 — tutor `diagnosis` を 3 番目の controlled consumer 切替とし、旧 schema 版は legacy へ倒す

- **Status:** `LOCKED`（Stage 5.11 / Run 2）
- **Decision:** Stage 5 の 3 番目の consumer 切替を **tutor purpose の `diagnosis` slot 単独**とする。
  slot token は `tutor.diagnosis`。同じ request の他 slot（self_analysis / statement_review /
  interview_record / presentation / …）は legacy のまま。
  `basic_info`（`E-S56`）/ `activity`（`E-S58`）の authority には触れない。
- **採用条件（`E-S56` / `E-S58` と同じ **AI-visible 同値**）:** canonical から作った slot が
  legacy と **完全一致**したときだけ canonical を採る。一致しなければ legacy を維持する。
- **同値の構造的根拠:**
  ```text
  legacy    tutorContext.ts:projectDiagnosis
            resolveDiagnosisTypeHint(payload.resultType) → truncate(hint, 120)
  canonical tutorDiagnosisSlot.ts:projectTutorDiagnosisSlot
            resolveDiagnosisTypeHint(row.payload.resultType) → slice(0, 120)

  ★ 言い換え表は 1 箇所（E-S44）★ 両者は同じ pure module を通る
  ★ cap も同値 ★ truncate(v, max) は `v.length > max ? v.slice(0, max) : v` で
    省略記号を足さない（rowMappers.ts）。したがって slice(0, max) と byte 一致する
  ★ 同じ行 ★ legacy も canonical も diagnosis_logs の同一 row を読む
  ```
  それでも同値 veto は **恒久的な安全網**として残す。将来
  `resolveDiagnosisTypeHint` の呼び出し側が片方だけ差し替えられたとき、黙って prompt が
  変わるのではなく legacy へ倒れて観測に残るようにするため。
- **fallback reason（closed enum / PII なし）:**
  ```text
  not_usable                canary / verdict / runtime block が canonical を許さない
  schema_version_ineligible mirror row が現行 writer contract の版でない（E-S59）
  canonical_absent          server 0 行 / resultType を解決できない
  divergent_projection      canonical と legacy の射影が一致しない
  ```
  **`would_reduce_context` を持たない。** activity の slot は「カテゴリ数 / 総件数」という
  **量**を持つため「減った」が定義できるが、diagnosis の slot は hint 1 文しか持たず
  量の概念が無い。`E-P7` の語彙を意味の無い場所へコピーしない。
- **★ `summary` を作らない ★** `TutorStudentContext['diagnosis']` は `summary?: string` も
  宣言しているが、legacy はこれを **一度も書かず** section renderer も読まない（repo 全走査 0 件）。
  canonical 側で埋めると legacy に無い行が prompt に出る（`E-P7` 違反）。
  同値検査は `summary` の有無も見るため、将来 legacy が使い始めたら
  `divergent_projection` で legacy へ倒れる。
- **query 本数:** slot 切替 3 つと shadow は同じ canonical context を **1 回だけ**組み立てて
  共用する。gate は `anySlotSwitchEnabled || shadowEnabled` の 1 段のままで、
  3 slot × shadow の 16 通りすべてで canonical read は 0 か 1（2 にならない）。
  **diagnosis 専用の assembly を作らない。**
- **slot 独立:** gate / usability / eligibility / veto は slot ごとに独立に評価する。
  `tutor.basic_info` を許可しても `tutor.diagnosis` は ON にならない（`E-S11` の連言を slot 単位で維持）。
- **★ 2 枚目の gate は近道の trap である ★**
  `schema_version_ineligible` は現行の Source-Sync では **通常到達しない**
  （旧版 row は fingerprint 不一致で `usable` の時点で落ちる）。それでも置くのは、
  `E-S44` が禁じた近道（`schemaVersion` を sync view から外して mismatch を消す）を
  取った瞬間に **黙って旧版 row が canonical 経路へ流れ込む**のを止めるためである。
  近道を取れば本 gate が発火し QA が落ちる（negative control D-N4 で実測）。
- **保持したもの:** legacy serverRead は削除しない（同値検査の相手であり fallback）/
  `E-S44` の block `diagnosis_type_hint` と hint 正本は不変 / shadow は observer のまま
  （`E-S42` / `E-S43`）/ canary は default deny の連言（`E-S11`）/ AI call は 1 request 1 本
  （Run 1 の N6 guard）。
- **QA:** `scripts/exam-spine-stage5-11-check.ts`。negative control D-N1〜D-N10 を
  mutation で実測しすべて検出。
- **Alternatives rejected:**
  - *schema_version を先に backfill してから切り替える* — DB write が要り、
    本 Run の scope 外。かつ旧版 row は legacy へ倒れて出力が変わらないため不要。
  - *`schemaVersion` を sync view から外して全 user を eligible にする* — `E-S44` が
    既に rejected。比較を弱めて mismatch を消すのは authority の一致ではない。
  - *`would_reduce_context` を activity からコピーする* — hint 1 文に量の概念が無く、
    到達不能な reason を増やすだけになる。
- **Rollback implications:** env から `tutor.diagnosis` を外せば legacy へ戻る。
  slot module を削除しても AI-visible 出力は不変（legacy 経路が土台のまま）。
  DB / wire / deploy への影響なし。

## E-S61 — Exam Spine 内部設計の最終 closure：閉じ方は 4 種類あり、「READY でない」は「未完成」ではない

- **Status:** `LOCKED`（Run 3 / 全 source kind・consumer・runtime path の再棚卸し）
- **背景:** Stage 5.x を kind ごとに進めた結果、「switch されていない kind が残っている」
  という見え方が生じた。しかし switch されていない理由は kind ごとに **質が違う**。
  区別せずに「未完成」と読むと、正しく閉じた kind に対して不要な migration を始める。

## 1. 閉じ方は 4 種類ある

```text
SWITCHED   controlled consumer 切替済み。AI-visible 同値を実測済み
           → basic_info（E-S56）/ activity（E-S58）/ diagnosis（E-S60）

DEFERRED   技術的には到達可能だが、解除に product 判断 or 追加 Decision が要る
           → statement_review / self_analysis / interview_record

BLOCKED    runtime 有効化を構造的に禁止している（fail-closed）
           → self_pr（E-S50 Level C）/ essay（E-S52）

N/A        その軸が概念的に適用されない（class 2 = server_authoritative / E-S3）
           → presentation（E-S54）/ interview_ai
```

★ **「READY でない」＝「内部設計が未完成」ではない** ★
理由付きで閉じていれば design closure として成立する。上の 4 分類のいずれにも
当てはまらない kind が 1 つでもあれば、そのときが未完成である。

## 2. DEFERRED 3 kind の解除条件（それぞれ質が違う）

```text
statement_review   E-S49 の product 判断待ち
                   legacy（最新 1 件 / 先頭 2 件 / 60 字）と canonical（履歴 N 件の
                   反復論点 / 頻度順）は選択・集約・下限がすべて違う。
                   どちらを正とするかは product 判断であり実装都合で先取りしない。
                   transport は READY（claim 配線済み / Level B）。

self_analysis      block coverage 待ち（E-S25）
                   transport READY / claim 配線済みだが、tutor 向け canonical block が
                   **存在しない**。legacy は強み / 課題 / 将来の方向性 / 要約の 4 行を
                   独自の cap（3 / 2 / 2 件）で出しており、canonical block を新設して
                   同値を実測する作業が要る。Source-Sync の blocker ではない。

interview_record   ★ Run 3 で判明した技術理由（E-S51 の「別 Stage」を置き換える）★
                   E-S51 は transport / semantics / block をすべて READY と判定し、
                   consumer 切替を「別 Stage」として先送りしていた。Run 3 の実測で、
                   先送りの理由が staging ではなく **実在する射影差**だと判明した。
```

## 3. `interview_record` の射影差（実測）

```text
legacy   tutorContext.ts:projectInterviewPractice
         feedback_json が **string なら JSON.parse する**
         （「文字列で入っている旧データも考慮して両方を受ける」と明示されている）

canonical lib/examSpine/read/rowMappers.ts:mapInterviewRecordRow
         feedback: asRecord(rec.feedback_json)
         → string は record ではないので **null** になる

実測（feedback_json = '{"improvements":["AI改善点1","AI改善点2"]}' の string）:
  legacy    → "AI改善点1 / AI改善点2"   （優先順位 1 = AI フィードバック）
  canonical → "自己記録の課題"           （優先順位 2 へ落ちる）
  → **DIVERGENT**
```

★ mapper を legacy に合わせれば直る、とは言えない ★

`feedback` は `interviewRecordItemView` の content field、すなわち
**Source-Sync の fingerprint 材料**である。`mapInterviewRecordRow` の
`feedback` 解釈を変えると、既存の全 interview_record row の fingerprint が動き、
**全ユーザーの comparison が一斉に mismatch へ倒れる**。
これは diagnosis の `schema_version` と同じ種類の変更であり、
E-S59 と同様に **独立した Decision と evidence** を要求する。

加えて「string で入った `feedback_json` は正当なデータか」という判断が要る。
現行 writer（`interviewPracticeRecords.ts:parseFeedbackJson`）は parse 済み object を
書くため、string 行は legacy 由来である。どちらを正とするかは
`schema_version` の legacy 版と同じ **contract の問題**であって、
consumer 切替のついでに決めてよいものではない。

- **Decision:** `interview_record` の consumer 切替は **DEFERRED** とし、解除条件を
  「`feedback_json` 解釈の contract を定める Decision と、その fingerprint 影響の evidence」
  とする。E-S51 の「別 Stage（E-S40 の first-consumer pin を維持）」という理由は
  **本 Decision が置き換える**（pin は E-S56 / E-S58 / E-S60 で 3 度動いており、
  staging を理由として維持できない）。
- **★ これは欠陥ではない ★** 現在 canonical block は prompt 経路へ接続されていない
  （`EXAM_PURPOSE_PLANS` は production から import されず `render: null`）。
  したがって射影差は **runtime に現れない**。切替を急がないことが正しい対処である。

## 4. Exam Spine 内部設計の completion 条件

```text
technical completion blocker = 0
全 source kind が 4 分類のいずれかに入っている
active consumer がすべて安全（AI-visible 同値 / fail-open / canonical read <= 1 / AI call = 1）
非 active consumer が理由付きで DEFERRED / BLOCKED / N/A
Decision graph valid / STATE が実装と一致
```

★ product 判断待ちは completion を妨げない ★
`self_pr` HD-1〜HD-6 / `statement_review` semantics / `essay` semantics は
いずれも runtime safety が確保された状態で deferred であり、
Exam Spine の **architecture completion** の条件ではない。

★ deployment も completion 条件ではない ★
remote push / merge / production deploy / live DB backfill / 本番トラフィックは
`PRODUCTION_INTEGRATION` という別 phase に属する。

- **Implementation evidence:** `scripts/exam-spine-final-closure-check.ts`
  （final matrix / consumer / architecture / containment / invariants / docs の 6 節）。
- **Alternatives rejected:**
  - *残り 3 kind の consumer を全部切り替えて「完成」にする* — statement_review は
    product 判断、self_analysis は block 新設、interview_record は fingerprint に
    影響する contract 変更を要する。いずれも機械的な作業ではなく、
    「完成に見せるため」に semantics を先取りすることになる。
  - *DEFERRED をすべて BLOCKED と書く* — 解除条件の質（product 判断 / block coverage /
    contract Decision）が消え、次の担当者が何をすべきか分からなくなる。
  - *interview_record の mapper だけ legacy に合わせる* — fingerprint が動いて
    全ユーザーが mismatch になる。E-S59 と同じ轍。
- **Rollback implications:** 宣言と QA のみ。runtime 挙動は 1 つも変えていない。

## E-P1 — 3 層のみ採用する（Layer 3/4/5 を持ち込まない）

- **Status:** `LOCKED`
- **Decision:** Exam Spine は Layer 1（Source Data）/ Layer 2（Self Understanding projection）/ Orchestrator の 3 層のみを持つ。upstream の Event Log / Aggregated Insight / Company Knowledge Base / consent subsystem は導入しない。
- **Reason:** いずれも受験版に対応する要件が無い。upstream 側でも Layer 4/5 は production consumer ゼロで fail-closed のまま。持ち込むと未使用のまま保守対象だけが増える。
- **Alternatives rejected:**
  - *将来に備えて scaffold だけ置く* — 消費者ゼロの skeleton を増やす。`incremental_refactor_policy.md` の「予防的整理の禁止」に抵触する。
- **Upstream CAREER decision:** `D-L3` / `D-L6`
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_ARCHITECTURE.md` §6〜§8
- **Exam-specific differences:** 受験版固有の scope 縮小。
- **Rollback implications:** なし。

## E-P2 — Layer 2 の DB write-back をしない

- **Status:** `LOCKED`（Human Decision D4）
- **Decision:** `exam_personal_memory` に相当するテーブルを作らない。Layer 2 は request-local projection として毎回再構築する。server から DB へ書き戻さない。
- **Reason:** **second writer を作らない。** `self_analysis_logs` からの再構築は軽量であり、永続化する利得が小さい。永続化すると「いつ再生成するか」という新しい stale 問題が生まれる。upstream も write-back を Human decision として保留したままである。
- **Alternatives rejected:**
  - *`exam_personal_memory` を作る* — 二重書き手・stale 判定・schema version 管理・migration がすべて増える。
- **Upstream CAREER decision:** `H-3`（write-back / 保留中）
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_ARCHITECTURE.md` §5 Rebuild / write-back
- **Exam-specific differences:** upstream は Layer 2 の永続テーブルを持つ（read は gate 済み）。受験版は **テーブル自体を作らない**。
- **Rollback implications:** なし（DB 変更ゼロ）。
- **再判断:** `E-H4`

## E-P3 — `statementDraft` は structural bridge として据え置く

- **Status:** `LOCKED`（Human Decision D5）
- **Decision:** `statementDraft`（localStorage）に対応する durable table を作らない。`statement_drafts` テーブルは新設しない。structural bridge として当面維持し、technical debt として記録する。
- **Reason:** 現時点で durable 化の必要性が実測で示されていない。テーブルを増やす判断は、必要性が観測されてから行う。
- **Alternatives rejected:**
  - *`statement_drafts` を新設する* — 「なぜ既存構造では不十分か」を現時点で示せない。`docs/supabase/schema_boundary_policy.md` の「persistence 適格性は意図的に判定する」に反する。
- **Upstream CAREER decision:** `D-S11`（server-readable representation が無いものを structural bridge として据え置く）
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_DECISIONS.md` `D-S11`
- **Exam-specific differences:** 対象が異なる（upstream はソロ GD、受験版は志望理由書ドラフト）。
- **Rollback implications:** なし。
- **Technical debt 記録:** `statement_review` purpose は server へ完全移行できない。観測では `statementDraft:not_server_capable` として structural に数える。
- **再判断:** `E-H5`

## E-P4 — 氏名は後続 Stage で prompt から削除する

- **Status:** `LOCKED`（Human Decision D6）
- **Decision:** 将来の Spine 移行で AI prompt から氏名（構造化 PII）を落とす方針を採用する。ただし **Stage 0 では prompt を一切変更しない。** 実施は後続 Stage で `PROMPT_VERSION` 変更とセットにする。
- **Reason:** 受験版の DB 境界は既に氏名を落としている（`lib/supabase/basicInfoLogs.ts` の name strip）。一方 `lib/buildBasicInfoPromptSection.ts` は氏名を prompt に入れており、方針が食い違っている。Spine を Supabase 由来にする以上、氏名は Spine に入らないため整合させる。
- **影響範囲:** `buildBasicInfoPromptSection` は 11 箇所から参照されており、変更は prompt byte を変える。client の input-hash cache が全 miss するため `PROMPT_VERSION` bump と同一 commit にする必要がある。
- **Alternatives rejected:**
  - *氏名を残す* — Spine とは別経路で氏名だけを body で運ぶ例外が必要になり、bridge が 1 本残る。
  - *Stage 0 で実施する* — Stage 0 の production behavior diff をゼロに保てなくなる。
- **Upstream CAREER decision:** PII 除外 pilot（`profile: 'minimal'` の全 purpose 展開）
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerContext/purpose.ts` / `PASSAI-CAREER/lib/careerContext/orchestrator.ts`
- **Exam-specific differences:** 受験版は purpose registry が未実装なので、Stage 1 で registry に `profile: 'minimal'` を宣言し、通電は後続 Stage。
- **Rollback implications:** `PROMPT_VERSION` を戻せば旧 cache が再 hit する。ただし cache は一度 miss する。

## E-P5 — feature artifact を Layer 2 に保存しない

- **Status:** `LOCKED`
- **Decision:** Layer 2 projection に次を含めない。
  - prompt 完成文字列
  - 志望理由書本文 / 小論文本文 / 面接 Q&A 本文 / 自己PR本文
  - 録画 / Storage 署名 URL / STT 全文 / 面接 turn 全文 / プレゼン Q&A turn 全文
  - `WallHittingResult.questions` / `.answers`（壁打ち working memory）
  - AI 呼び出しに失敗した部分結果
  - 氏名 / 欠席日数 / メールアドレス / Stripe customer id
- **Reason:** Layer 2 は「下流共通に渡って意味がある中立な学生像」だけを持つ。feature artifact を混ぜると、Layer 2 が肥大化し、prompt token・PII 露出面・stale 判定のすべてが悪化する。`docs/principles/student_profile_contract.md` §4 の「入れないもの」と整合させる。
- **特記:** `interview_ai_sessions.target_ref.sourceContext`（client 組み立ての最大 6000 字 prompt 断片）は本 Decision に真っ向から反する既存負債である。Stage 9 で廃止する。
- **Alternatives rejected:**
  - *本文も持たせて projection の精度を上げる* — token 肥大と PII 露出。
- **Upstream CAREER decision:** `D-L2` / Layer 2 の保存禁止事項
- **Upstream CAREER path:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_ARCHITECTURE.md` §5
- **Exam-specific differences:** `sourceContext` に相当する負債は受験版固有。
- **Rollback implications:** なし。

## E-P6 — client / server で同一の pure selector を使う

- **Status:** `LOCKED`
- **Decision:** purpose payload を組み立てる selector を純関数として実装し、**client と server の両方が同じ関数を実行**する。server 側で再実装しない。
- **Reason:** 移行期は同じ purpose に対して bridge 経路（client 組み立て）と server 経路が併存する。両者が別実装だと出力が食い違い、移行の可否を判断できない。同一関数を verified な server 生データで実行することが parity の根拠になる。
- **Alternatives rejected:**
  - *server 側で作り直す* — parity を目視・snapshot で担保し続ける必要が生じ、drift が不可避。
- **Upstream CAREER decision:** `D-S6`（pure selector の再利用・再実装しない）
- **Upstream CAREER path:** `PASSAI-CAREER/lib/careerMemory/selector.ts` / `snapshot.ts`
- **Exam-specific differences:** なし。
- **Rollback implications:** なし。

## E-P7 — 移行時に context を減らさない

- **Status:** `LOCKED`
- **Decision:** per-field / per-kind の server↔bridge 共存において、**server 側が空で bridge 側に中身がある場合は bridge を維持**する。移行によってユーザーに渡る情報量が減ってはならない。
- **Reason:** fail-open（E-S1）は「context を減らして続行する」ことを許すが、それは「使えないものを使わない」場合に限る。使えるものがあるのに server 側の空を優先するのは、単なる品質劣化である。
- **Alternatives rejected:**
  - *server 経路が有効なら常に server を採用する* — 移行で出力品質が落ちる。
- **Upstream CAREER decision:** `D-S6`（fail-open の追加規則: context を減らさない）
- **Upstream CAREER path:** `PASSAI-CAREER/app/api/career/consultation/resolveContextInputs.ts`
- **Exam-specific differences:** なし。
- **Rollback implications:** なし。

## E-P8 — server 由来 `basicInfo` に氏名を捏造しない

- **Status:** `LOCKED`
- **Decision:** `basic_info_logs.payload` には氏名が存在しない。したがって server 側 projection は **`name` を持たない専用 type**（`ExamBasicInfoServerRow`。`nameOnServer: false` を型で固定）として扱い、`name: ''` を作らない・ダミー名を作らない・`as BasicInfo` の unsafe cast をしない・server row に無い field を mapper で生成しない。氏名は bridge 側に残し、統合は Stage 4 の mixed-source resolution が行う。
- **Reason:** writer（`lib/supabase/basicInfoLogs.ts`）が氏名を strip して書く契約であり、schema の COMMENT にも明記されている。Stage 2 の `ExamContextInput.basicInfo` は `BasicInfo`（`name` 必須）を要求するが、その型を満たすために空文字を入れると「氏名が空のユーザー」と「server から氏名が来ないユーザー」が区別できなくなり、prompt から氏名が黙って消える。型の辻褄合わせのために Stage 2 contract（byte-equivalence 済み）を壊すのは順序が逆である。
- **Alternatives rejected:**
  - *`name: ''` で埋める* — 空文字が prompt に流れ、E-P4（氏名の prompt 除外）を意図せず前倒しで実施したのと同じ結果になる。しかも意図的でないため観測もできない。
  - *`as BasicInfo` で cast する* — 実データと型が食い違ったまま下流へ流れる。
  - *Stage 2 の `ExamContextInput.basicInfo` を optional な型へ変える* — Stage 2 は byte-equivalence 済みで凍結中。Stage 3 の都合で触らない。
- **Upstream CAREER decision:** —（受験版固有 / 氏名を mirror しない受験版の writer 契約に由来）
- **Exam-specific differences:** —
- **Rollback implications:** なし（Stage 3 は runtime に接続しない）。
- **関連:** `E-P4`（氏名を将来 prompt から落とす）と混同しない。E-P4 は「載せるのをやめる」判断、本 decision は「無いものを作らない」判断。

## E-P9 — Register に登録されていない contract を canonical に昇格させない

- **Status:** `LOCKED`
- **Decision:** Exam Spine の contract（型 / 契約 / cache 方式 / gate 方式 / 命名体系）を canonical として採用するには、本 Register に対応する Decision が存在することを必要条件とする。実装が先行した場合、canonical 昇格の前に Decision を起こす。実装が既存の `LOCKED` decision と矛盾する場合は、**実装ではなく Decision を先に改める**（Canon §60 の protocol に従う）。
- **併せて固定する: Register は 1 本だけ**
  ```text
  canonical Register : docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md（canonical lineage 上）
  他 worktree / 他 branch の同名ファイル : 参照のみ。ID を採番しない。
  採番は必ず canonical Register の実ファイルから最大値を確認して行う。
  ```
- **Reason:** Wave 2 の調査時点で、6 worktree に **3 種類**の Register が存在した。
  ```text
  e306eb5c（527 行 / E-S14 / E-P7 まで + E-H2 RESOLVED）… shipping・adversarial audit worktree
  c0b3a106（589 行 / E-S22 / E-P8 まで）                … canonical lineage・sync 実装 worktree
  10fd9909（477 行 / E-S14 / E-P7 まで）                … stage1 worktree
  ```
  この状態では誰が次に何を書いても採番が衝突する。実際 shipping 側は Phase 1〜3.5 の contract を 1 件も登録しておらず、その結果 `snapshot.server.ts` が E-S6 の reject した設計であることが Register から読めない状態になっていた。`EXAM_SPINE_ARCHITECTURE.md` §0 は「Register の Human Decision が最優先」と定めており、この非対称を放置すると権威文書が実態を説明できなくなる。
- **Alternatives rejected:**
  - *実装を正として Register を後追いで書き換える* — Canon §59 / §60 に反する。「実装できたから architecture が変わった」を許すと Register の意味が消える。
  - *runtime に出ている実装を無条件で canonical とする* — Canon §82 は Authority 調査の順序を定めたものであり、contract 決定の権威を runtime に与えてはいない。
- **補足:** これは「実装を先に書くな」ではない。**先に書いてよいが、canonical に昇格させる前に Decision を起こせ**という順序の固定である。
- **Rollback implications:** なし（governance rule）。

---

# 6. Human decisions（`PENDING_HUMAN` / `RESOLVED`）

Claude Code はこれらを勝手に決めてはならない。決定済みのものは `RESOLVED` として、判断内容と実測を残したまま本節に置く。

## E-H1 — 本番 DDL の完全検証（U1 の残り）

- **Status:** `RESOLVED`（2026-08-26。live PostgREST 検証 ＋ 本番 SQL Editor 実行で確定）
- **Wave 2 で解消した部分（live PostgREST / read-only / GET のみ / `limit=0` で行取得ゼロ）:**
  `scripts/exam-spine-live-schema-check.ts` により、Stage 3 の canonical reader が発行する
  **12 query すべて**（10 kind + presentation の enrichment 2 本）が本番 schema と互換であることを実証した。
  select 文字列は `formatSelect()` を production と共有しているため
  「QA が通した select == reader が発行する select」である。
  ```text
  negative control : 存在しない table = 404 / 存在しない column = 400 / 存在しない order 列 = 400
  12 query         : すべて 200（interview_ai の !inner embed を含む）
  非読取列の実在    : statement_review_history.essay / interview_practice_records.{questions_asked,my_answers} /
                     presentation_attempts.{transcript,storage_path} / presentation_sessions.script = すべて実在
  ```
- **★ Post-Wave 2 に本番 SQL Editor で確定した部分（R6 のクローズ）:**
  `supabase/exam_spine_rls_verification.sql` を本番で実行し、
  一度も authenticated SELECT が実行されたことのなかった 4 table について次を確認した。
  ```text
  table                       grant  RLS    policy                                  roles            cmd     qual
  self_prs                    YES    true   self_prs owner select                   {authenticated}  SELECT  (auth.uid() = user_id)
  statement_review_history    YES    true   statement_review_history owner select   {authenticated}  SELECT  (auth.uid() = user_id)
  essay_workspaces            YES    true   essay_workspaces owner select           {authenticated}  SELECT  (auth.uid() = user_id)
  interview_practice_records  YES    true   interview_practice_records owner select {authenticated}  SELECT  (auth.uid() = user_id)
  ```
  → Stage 3 reader（anon key + cookie session = Postgres role `authenticated`）は
  4 kind すべてを owner scope で読める。**`service_role` は不要**（E-L4 / Canon §20 を維持）。
  「policy 不在なら 200 + 0 行になり runtime では検出できない」という silent failure のリスクは、
  policy 実在が確認されたことで解消した。
- **★ Post-Wave 4.5 に本番 SQL Editor で確定した部分（R5 のクローズ）:**
  `supabase/exam_spine_rls_verification.sql` §7 を本番で実行し、E-S27 の
  `reviews:workspace->reviews` が **jsonb 上で実際に配列として解決する**ことを確認した。
  ```text
  total_rows              = 10
  rows_reviews_is_array   = 10
  rows_reviews_wrong_type =  0
  rows_bogus_path         =  0   （存在しない sub-path の negative control）
  ```
  → 本番 10 / 10 行で `jsonb_typeof(workspace->'reviews') = 'array'`。
  加えて Wave 4.5 の read-only PostgREST probe（GET / `select=id&limit=0` /
  `Prefer: count=exact`。行データ 0 byte）で次を実測済み:
  ```text
  workspace->reviews が非 null              = 10 / 10 行
  workspace->zzz_not_a_field が非 null      =  0 行（negative control）
  ```
  → `->` が実データ上で解決し、PostgREST が sub-path を無条件一致させていないことの
  両方が示された。**これで「object / scalar が混ざって mirror だけ `reviews` が空になり、
  fail-open に吸収されて runtime では気付けない」という silent failure は解消した。**
  なお本番検証では INSERT / UPDATE / DELETE / DDL / policy 変更 / migration を 1 件も行っていない。
- **★ 残る検証の限界（推測で PASS にしない / Canon §80）— Stage をブロックしない:**
  - PostgREST は **jsonb の sub-path を検証しない**（`workspace->zzz_not_a_field` も 200）。
    したがって *live schema check の 200 だけ*では R5 を主張できない。上記のとおり
    R5 は schema check ではなく **本番の jsonb 型集計 + negative control** で閉じている。
  - UNIQUE constraint / index / trigger は correctness ではなく
    「`maybeSingle()` が 406 に倒れないか」「性能」に効く。破れても fail-open が吸収する
    （その kind だけ `status='error'`）。
- **Blocker:** なし（Stage 4 の hard blocker から外れた）。
- **再検証手段:** `supabase/exam_spine_rls_verification.sql` を保持する。schema drift の
  再発時（E-H2 の前例あり）に同じ手順で確認できるようにするため。

## E-H2 — anonymous mirror テーブルが anon から読める drift への対応

- **Status:** `RESOLVED`（2026-08-26。本番適用 + 実測検証済み）
- **観測（Stage 0 preflight・read-only）:** `supabase/schema.sql` は 4 つの `*_mirrors` テーブルについて "No SELECT policy by design" と宣言しているが、本番では anon key で行が読める。
  ```text
  student_profile_mirrors : 21 行が anon から読める
  basic_info_mirrors      : 10 行
  activity_mirrors        :  6 行
  diagnosis_mirrors       :  3 行
  ```
  一方 auth-scoped table（`basic_info_logs` / `self_analysis_logs` / `profiles` / `usage_records` 等）は anon から 0 行で、RLS が意図どおり効いている。
- **確認できていないこと:** 原因（RLS 自体が無効なのか、schema.sql に無い SELECT policy が存在するのか）。anon key では `pg_policies` を読めない。
- **性質:** anon key は client bundle に含まれる公開値であるため、これらの payload は事実上公開状態にある。`student_profile_mirrors.payload` は StudentProfile（summary / strengths / weaknesses / futureConnections / signatureEpisodes）を含む。
- **注:** これは **Exam Spine とは独立した既存の問題**であり、Stage 0 の変更によって生じたものではない。Exam Spine はこれらの mirror を読まない（E-L5）。
- **必要だった判断:** 本番 RLS を schema.sql の宣言に合わせるか、schema.sql を実態に合わせるか。前者の場合の適用手順と影響。
- **Blocker:** Exam Spine の Stage をブロックしなかった（Spine は mirror を読まない）。独立対応として完了済み。

### 判断と結果（2026-08-26 / production `oarzldvteiuyuwkdoauq`）

**採った方針:** 本番 RLS を schema.sql の宣言（no anon read）に合わせる。

確定した原因は「RLS 無効」ではなく、schema.sql に無い `"<table> anon select_for_upsert"`（`FOR SELECT TO anon USING (true)`）が 4 table すべてに存在していたこと。これは browser の anon client が `INSERT ... ON CONFLICT DO UPDATE` を実行するために追加されたもので、PostgreSQL が upsert に対応する SELECT アクセスを要求するため、**anon 直接 upsert を維持したまま SELECT policy だけを落とすことはできない**。したがって書き込みを server へ移してから policy を削除した。

```text
Anonymous mirror read exposure closed in production.

Four mirror tables:
- browser SELECT/INSERT/UPDATE removed
- writes mediated through /api/mirrors
- production write verified after RLS hardening

mirror_events:
- remains write-only telemetry sink
- required browser roles may INSERT
- no SELECT policy
```

**実測（適用後・本番）**

| table | RLS | anon/public policy | anon SELECT | auth SELECT | anon INSERT | auth INSERT | rows |
|---|---|---|---|---|---|---|---|
| `student_profile_mirrors` | enabled | 0 | 0 行 | 0 行 | `42501` | `42501` | 21 |
| `basic_info_mirrors` | enabled | 0 | 0 行 | 0 行 | `42501` | `42501` | 12 |
| `activity_mirrors` | enabled | 0 | 0 行 | 0 行 | `42501` | `42501` | 6 |
| `diagnosis_mirrors` | enabled | 0 | 0 行 | 0 行 | `42501` | `42501` | 3 |
| `mirror_events` | enabled | INSERT のみ | 0 行 | 0 行 | 許可 | 許可 | 74 |

UPDATE / DELETE は 4 table + `mirror_events` とも、anon / authenticated の双方で affected = 0（read policy が無いため対象行が 1 件も可視化されない）。既存行の削除は発生していない。

**書き込み経路（現行）**

```text
browser → POST /api/mirrors → server-side service_role writer → *_mirrors
browser → mirror_events（telemetry のみ・INSERT only）
```

本番実測: 基本情報保存 1 回で `basic_info_mirrors.updated_at = 2026-08-26T15:09:04Z` が更新され、同一操作の telemetry が `mirror_events` に `feature=basicInfo / mirror_status=success / environment=production / duration_ms=1143 / created_at=2026-08-26T15:09:05Z` として積まれた。

**`mirror_events` 403 の副次 incident（同日クローズ）**

policy 削除後、`mirror_events` への browser INSERT が `42501` になった。原因は role の取り違えで、`lib/supabase/auth.ts:ensureAnonymousUser()` が未ログイン訪問者にも `signInAnonymously()` を実行するため、browser client の Postgres role は常に `authenticated`（実測 JWT: `role=authenticated` / `is_anonymous=true`）であり、既存の anon 専用 INSERT policy が実トラフィックに一致していなかった。`supabase/mirror_events_authenticated_insert.sql` で `FOR INSERT TO authenticated WITH CHECK (true)` を 1 件追加して解消。SELECT / UPDATE / DELETE policy は作っていないため read exposure は広がらない。`mirror_events` は owner 列を持たない設計（`schema.sql §5`）のため owner 条件は書けず、anon policy と条件を揃えた。

**関連:** `supabase/mirror_select_exposure_migration.sql` / `supabase/mirror_events_authenticated_insert.sql` / `app/api/mirrors/route.ts` / `lib/mirrors/mirrorWriteServer.ts` / `lib/supabase/mirrorEventSink.ts`

**残存リスク:** `supabase/schema.sql` は 4 mirror について anon の INSERT / UPDATE policy を宣言したままで、本番実態（policy 0 件）と乖離している。新規 project へ schema.sql をそのまま適用すると本番より緩い状態が再生される。schema.sql 側の追随は別 STEP。

## E-H3 — vitest 導入の再判断

- **Status:** `PENDING_HUMAN`
- **必要な判断:** Stage 5 の前に、テストフレームワーク（vitest）を導入するか、`scripts/*.ts` + `npx tsx` を継続するか。
- **判断材料:** Stage 0〜4 の characterization script の保守しやすさ、fixture 数の増加度合い。
- **Blocker:** Stage 5 の着手前。

## E-H4 — Layer 2 永続化の再判断

- **Status:** `PENDING_HUMAN`
- **必要な判断:** E-P2 の write-back なし方針を、実測（projection コスト / latency）に基づき見直すか。
- **Blocker:** なし（現状 `LOCKED` で進める）。

## E-H5 — `statement_drafts` テーブルの要否

- **Status:** `PENDING_HUMAN`
- **必要な判断:** E-P3 の structural bridge 据え置きを見直し、durable table を作るか。
- **判断材料:** `statement_review` purpose の bridge 率と、cross-device での実害の有無。
- **Blocker:** なし（現状 `LOCKED` で進める）。

## E-H6 — CAREER との共通 package 化の再判断

- **Status:** `PENDING_HUMAN`
- **必要な判断:** 受験版 Spine が安定した後（Stage 11 完了後）に、architecture-level module を共有 package 化するか。
- **判断材料:** 両実装が実際に収束したか。各 module の header に記録した upstream reference との差分。
- **Blocker:** なし。

## E-H7 — device claim transport が 2 実装ある状態の解消

- **Status:** `RESOLVED`（Stage 5 entry gate。**E-S39** が解決した。以下は経緯の記録）
- **判断（当時）:** 同じ「device revision claim を wire で運ぶ」責務に対して、canonical namespace に実装が 2 本存在する。どちらを恒久 transport とするか。
  ```text
  A. lib/examSpine/sync/claim/**   wire version 'edc1'
       E-S33 で LOCKED。header 'x-exam-spine-device-claim'。
       Stage 5.0 pilot として production（tutor）へ接続済み。
       purpose gate filter（toDeviceClaims）を持つ。

  B. lib/examSpine/sync/signal.ts  wire version 'esy1'
       Register 未登録。production 接続なし。
       bounded parse / rejection enum を持ち、verdict.ts の claim 入力型として使われる。
  ```
- **判断材料:**
  - E-P9 により、B は Register 未登録のままでは canonical transport へ昇格できない。
  - 一方 B を単純に削除すると `verdict.ts`（E-S35）の入力型と w4 の QA 資産（`sync-signal-check.ts`）を失う。
  - 現時点で **実害は無い**: B は production から 1 本も import されておらず（E-S34 の allowlist で機械検証）、2 つの wire format が同時に流れることはない。
- **想定される解:**
  1. `verdict.ts` の入力を「claim 参照の最小 interface」へ narrow し、A の `toDeviceClaims` 出力で満たす。B は transport としては廃止し、型のみ残すか削除する。
  2. B を正式に登録し、A を B へ寄せる（E-S33 の改訂が必要）。
  3. 両方を維持し、用途境界（production transport = A / 内部判定入力 = B）を Decision として固定する。
- **Blocker 分類（Stage 4 final arbitration で確定）:**
  ```text
  BLOCKS_PACKET_E            = NO
  BLOCKS_STAGE5_CONSUMPTION  = YES
  ```
  根拠（コード実測）:
  ```text
  production path で使われている transport は claim/** だけ
    app/tutor/page.tsx      → sync/claim/serialize, sync/claim/types
    app/api/tutor/route.ts  → sync/claim/parse
  signal.ts の production importer = 0
    唯一の参照は lib/examSpine/sync/verdict.ts（Spine 内部）
  ```
  重複は **Spine 内部に閉じており、runtime path に 2 つの wire format が同時に出ない**。
  Packet E は `lib/examSpine/**` を runtime importer 0 のまま shipping へ置く作業なので、
  内部に未使用 module が 1 本多いことは import の可否に影響しない。
  一方 Stage 5 で claim を実際に消費し始める時点では、どちらが transport かが
  確定していないと consumer が二重定義に依存するため、そこでは blocker になる。
- **Claude が勝手に決めてはいけない理由:** E-S33 は LOCKED であり、A を B へ寄せる案は LOCKED decision の改訂にあたる。

---

# 7. Human Decisions 反映表（今回の承認事項）

| 承認 ID | 内容 | 反映先 Decision |
|---|---|---|
| **D1** | テスト基盤 = `scripts/*.ts` + `npx tsx`。Stage 0〜4 で vitest 追加なし。dependency 追加禁止 | `E-S14`（再判断 `E-H3`） |
| **D2** | 将来 4 層 rollout gate を採用。Stage 0 では env / runtime gate を実装しない | `E-S11` |
| **D3** | CAREER との共通 package 化をしない。upstream reference のコメント記録は可 | `E-L6`（再判断 `E-H6`） |
| **D4** | `exam_personal_memory` を作らない。Layer 2 は request-local。second writer を作らない | `E-P2`（再判断 `E-H4`） |
| **D5** | `statementDraft` を structural bridge として維持。`statement_drafts` を作らない | `E-P3`（再判断 `E-H5`） |
| **D6** | 氏名を将来 prompt から落とす。Stage 0 では prompt 不変 | `E-P4` |
