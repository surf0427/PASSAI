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

---

# 5. Policy / persistence decisions

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

---

# 6. Human decisions（`PENDING_HUMAN`）

Claude Code はこれらを勝手に決めてはならない。

## E-H1 — 本番 DDL の完全検証（U1 の残り）

- **Status:** `PENDING_HUMAN`
- **問題:** Stage 0 の preflight では、anon key による PostgREST 経由の read-only 確認しかできなかった。**確認できたこと**: 対象 12 table の存在と `user_id` 列の存在、auth-scoped table が anon から 0 行であること。**確認できていないこと**: RLS policy の定義内容 / unique constraint / index / `supabase/schema.sql` との詳細 drift。
- **必要な判断:** 誰が・どの手段で（Supabase ダッシュボード / CLI 導入 / DB 接続情報の提供）残りを検証するか。
- **Blocker:** **Stage 3 以降**（server reader が実際に読む段階）。Stage 1〜2 は型と純関数のみなのでブロックしない。

## E-H2 — anonymous mirror テーブルが anon から読める drift への対応

- **Status:** `PENDING_HUMAN`
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
- **必要な判断:** 本番 RLS を schema.sql の宣言に合わせるか、schema.sql を実態に合わせるか。前者の場合の適用手順と影響。
- **Blocker:** Exam Spine の Stage をブロックしない（Spine は mirror を読まない）。ただし**独立した対応が要る**。

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
