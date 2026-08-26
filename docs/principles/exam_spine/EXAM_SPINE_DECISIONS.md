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

# 6. Human decisions（`PENDING_HUMAN`）

Claude Code はこれらを勝手に決めてはならない。

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
- **★ 残る検証の限界（推測で PASS にしない / Canon §80）— Stage をブロックしない:**
  - PostgREST は **jsonb の sub-path を検証しない**。`workspace->zzz_not_a_field` も 200 を返す。
    したがって `essay` の `reviews:workspace->reviews`（E-S27）の妥当性は live schema check では
    証明できず、shipping production で同一 projection が稼働している事実に依存する。
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

- **Status:** `PENDING_HUMAN`
- **必要な判断:** 同じ「device revision claim を wire で運ぶ」責務に対して、canonical namespace に実装が 2 本存在する。どちらを恒久 transport とするか。
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
- **Blocker:** Stage 4 stabilization の blocker では**ない**（QA は全 green）。Stage 5 で claim を実際に消費し始める前に決めること。
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
