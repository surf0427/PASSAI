# EXAM_SPINE_CONVERGENCE_DECISION — 2 lineage 収束判定

- 実施日: 2026-08-26
- 担当: Claude A（Architecture / Authority / Convergence Owner）
- worktree: `/Users/yk/paid-app-spine-a` / branch `exam-spine-w1-convergence-v2`（base `a009116`）
- 種別: **判定のみ**。`lib/**` / `app/**` / `scripts/**` / `supabase/**` / `package.json` を 1 行も変更しない。
- 判定基準: `/Users/yk/Downloads/PASSAI_Exam_Spine_Architecture_Canon.md`（以下 Canon）
  ＋ `EXAM_SPINE_DECISIONS.md`（Decision Register。**本 Register が権威**）

関連: `EXAM_SPINE_ARCHITECTURE.md` / `EXAM_SPINE_STATE.md` / `EXAM_SPINE_STAGE3_READINESS_AUDIT.md`
（いずれも本判定では無変更）

---

## 1. Result

```text
RESULT              = DECIDED
CANONICAL_LINEAGE   = L2
Stage2 asset        = KEEP_AS_CANONICAL
Stage3 reader       = ADOPT（条件つき。§8 の 3 点を Wave 2 で解消）
Stage4 blockers     = 6 件（うち新規発見 4 件。当初リスト 6 件のうち real は 1 件のみ）
Canon change needed = NO（Canon 本文の変更は不要。implementation 側が Canon に追いついていない）
New Decision IDs    = E-S23 / E-S24 / E-S25 / E-S26 / E-S27 / E-P9（draft）
```

**採番の根拠（実ファイル確認済み）**

```text
docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md（branch exam-spine-stage3 / HEAD a009116）
  E-L: 最大 E-L6
  E-S: 最大 E-S22   → 新規は E-S23 から
  E-P: 最大 E-P8    → 新規は E-P9 から
  E-H: 最大 E-H6
```

※ L1（`feature/interview-realtime-step1`）の Register は `E-S14` / `E-P7` までしか持たない。
　 **採番の正本は最大値を持つ側**であり、E-S15 からの再採番は禁止（§10-D1）。

---

## 2. Current lineages

**旧「3 lineage」前提は使用していない。** uncommitted WIP は存在せず、比較は 2 系統である。

| | L1 — shipping lineage | L2 — Stage1→2→3 lineage |
|---|---|---|
| branch | `feature/interview-realtime-step1` | `exam-spine-stage3` |
| HEAD | `3411ab1` | `a009116` |
| 分岐点 | `5558216 fix(security): allow authenticated mirror telemetry writes` | 同左 |
| 分岐後 commit | 11 | 8 |
| `lib/examSpine/**` | 5 file / 881 行 | 19 file / 4,618 行 |
| production runtime 接続 | **あり**（`/api/tutor`） | **なし**（import 元 0 本。E-S17 により意図的） |
| Decision Register への登録 | **0 件**（E-H2 の RESOLVED 更新のみ） | **9 件**（E-S15〜E-S22 / E-P8） |
| 語彙 | Phase 1〜3.5 | Stage 0〜3 |

### 2.1 L1 の実装

```text
lib/examSpine/types.ts            ExamSourceKind / ExamSourceAuthorityClass /
                                  EXAM_SOURCE_PRIMARY_TABLE / SourceState<T>
lib/examSpine/purpose.ts          ExamSpinePurpose(8) / EXAM_PURPOSE_REGISTRY（sources 宣言つき）
lib/examSpine/read/reader.server.ts   kind ごとの read* 関数 9 本 + loadExamSources（allSettled）
lib/examSpine/read/rowMappers.ts      shape guard 6 本
lib/examSpine/read/snapshot.server.ts module-level Map + TTL cache

consumer: lib/contextBuilders/tutorContext.ts → app/api/tutor/route.ts
gate    : lib/tutor/spineContextFlag.ts（TUTOR_SPINE_CONTEXT_ENABLED / default deny / allowlist）
QA      : tutorLoader(T1–T9) / tutorComposition(A–F) / tutorCanary(25 case) / liveSources
```

**runtime 実態（コードで確認）**: `app/api/tutor/route.ts:348` が
`loadTutorStudentContextCached()` を **canary flag と無関係に毎 request 呼ぶ**。
flag が制御するのは「body 由来 block2 を落とすか」だけである。
したがって L1 の read 層は production で**常時稼働している**。

### 2.2 L2 の実装

```text
lib/examSpine/types.ts               ExamContextPurpose(17) / ExamContextOrigin(3)
lib/examSpine/sourceData/types.ts    ExamSourceKind / AuthorityClass / EXAM_SOURCE_TABLES(1:N) /
                                     ExamSourceReadStatus(4) / ExamSourceBundle
lib/examSpine/budget.ts              purpose 別 character budget（enforce しない）
lib/examSpine/blocks/**              35 block の contract / registry / build
lib/examSpine/orchestrator/**        input / plan(Layer3,4) / render(Layer5) / assemble
lib/examSpine/read/types.ts          ExamReadQuery / ExamReadExecutor / EXAM_READ_CAPS
lib/examSpine/read/guards.ts         shape guard 8 本
lib/examSpine/read/queries.ts        10 kind の SELECT を「データ」として宣言
lib/examSpine/read/rowMappers.ts     row → server projection（12 mapper）
lib/examSpine/read/readSources.ts    readExamSources → ExamSourceBundle
lib/examSpine/read/requestSnapshot.server.ts  WeakMap<Request> + 毎回 authorize
lib/examSpine/read/supabaseExecutor.server.ts 唯一の I/O 境界

consumer: なし（QA script のみ）
QA      : stage1 / stage2(880 checks) / stage3(180 checks)
```

### 2.3 検証実行（本セッションで実測）

| コマンド | 結果 |
|---|---|
| `npx tsx scripts/exam-spine-stage1-check.ts`（L2） | PASS / network 0 |
| `npx tsx scripts/exam-spine-stage2-check.ts`（L2） | **PASS / checks 880 / fixtures 6 / blocks 35 / purposes 17 / network 0 / AI SDK NO** |
| `npx tsx scripts/exam-spine-stage3-check.ts`（L2） | **PASS / checks 180 / kinds 10 / network 0 / AI SDK NO** |
| `npm run qa:examSpine:tutorLoader`（L1） | PASS（T1–T9 + cache-semantics） / network 0 |
| `npm run qa:examSpine:tutorComposition`（L1） | PASS（A–F） / network 0 |
| `npm run qa:examSpine:tutorCanary`（L1） | PASS（25 case。default deny 成立） |
| `npm run qa:examSpine:characterization`（L1） | PASS（F1–F6） / network 0 |
| `npx tsc --noEmit`（L2 worktree） | **exit 0** |

**両 lineage とも QA は通る。**「片方が壊れているから」という理由での判定はできない。

---

## 3. Detailed comparison

Canon §82 の調査順（runtime call graph → write path → read path → contract →
DB representation → dead helper）に従って比較する。

### 3.1 runtime call graph

| | L1 | L2 |
|---|---|---|
| production consumer | `/api/tutor`（1 purpose） | 0 |
| 稼働範囲 | 9 kind の read が毎 request 実行される | なし |
| gate | canary（default deny）。ただし read 自体は gate されない | なし |

→ **この軸は L1 の勝ち。** ただし §82 が定めているのは
「**どのデータが権威か**を調べるときは runtime を最優先せよ」であって、
「shipping 実装の contract が architecture である」ではない。
実際、L2 の Stage 3 reader は L1 の runtime 実態（`tutorContext.ts` の 6 selection rule /
audit §8.1）から導出されており、**runtime evidence は L2 に既に取り込まれている**。

### 3.2 write path

両 lineage とも Spine から write しない（Canon §7 準拠）。
`ExamReadQuery` は SELECT 以外を表現できないため、L2 は **mutation を書く手段が構造的に無い**（E-S22）。
L1 は Supabase client を直接扱うため、mutation 禁止は grep 依存である。

→ **L2 が構造的に強い。**

### 3.3 read path

| 観点 | L1 | L2 |
|---|---|---|
| I/O 境界 | `reader.server.ts` の 9 関数すべてが `client.from(...)` を直接叩く | `supabaseExecutor.server.ts` **1 箇所のみ** |
| client 生成 | `resolveExamSpineClient()` が `getServerSupabaseClient()` を **自分で呼べる** | executor は client を受け取るだけ。作らない・env を読まない |
| query の検証可能性 | 文字列 select。実 DB 無しでは列名を検証できない | `ExamReadQuery` として宣言。列名・ordering・limit・filter を QA が構造で freeze |
| owner filter | 各関数に `.eq('user_id', userId)` を手書き | 全 query が `owner(userId)` を持ち、QA が全 query に強制 |
| service_role | import なし（✅） | import なし（✅） |
| 逐語列の非読み取り | コメント + 実装 | **列配列に現れないこと**で構造保証（`queries.ts` 冒頭に非読取列を明記） |

→ **L2。** Canon §54 / §69（`Context Builder → table-specific SQL` 禁止）に対して、
L1 は「reader 内に SQL が散在」、L2 は「query は data / 実行は 1 点」。

### 3.4 contract

| Canon 要求 | L1 | L2 |
|---|---|---|
| §10 `ExamSourceBundle` | **無い**（kind ごとに `SourceState<T>` を返すだけ） | ある（10 slot） |
| §11 / §40 Source status | `ready` / `absent` / `unavailable` の 3 値 | `ok` / `truncated` / `error` / `skipped` ＋ snapshot の `present`/`absent` |
| E-S8 `truncated` を権威にしない | **`truncated` を表現する型が無い** | `ExamSourceReadStatus.truncated` + `EXAM_READ_CAPS`（cap+1 方式） |
| §17 mixed-origin | **origin の語彙が無い** | `ExamContextOrigin`（server / bridge / not_server_capable）※単一値（§9-B1） |
| §39 provenance | **無い** | `ExamDataProvenance` 4 値 + `ExamContentDerivation` 3 値（block 単位） |
| §16 revision / fingerprint | 無い（Stage 4） | 無い（Stage 4）※status/outcome に接続点あり |
| §18 context veto | 無い | 無い（Stage 4）※`outcome` に veto 入力が揃っている |
| §5 authority matrix の型表現 | authority class のみ | authority class + `EXAM_SOURCE_TABLES`（1:N）+ `dormant_no_author` |

→ **L2 が決定的に優位。**

### 3.5 DB representation（registry の completeness）

**L1 の registry は read graph を覆っていない。** 実コードで確認した:

```text
lib/examSpine/types.ts:EXAM_SOURCE_PRIMARY_TABLE
  presentation : 'presentation_results'          ← 1 table のみ
  interview_ai : 'interview_ai_sessions'         ← 1 table のみ

しかし reader.server.ts は実際に:
  readPresentationSessionByAttempt()  → presentation_attempts / presentation_sessions を SELECT
  readLatestInterviewAiRow()          → interview_ai_results を embed
```

これは Canon §22 が禁じる「registry から Spine の権限内 table が読めない」状態そのものであり、
**L2 が E-S15 で明示的に修正した欠陥**（`EXAM_SOURCE_TABLES` を 1:N 配列にし
presentation を 3 table で宣言）である。L1 側は未修正のまま production で稼働している。

### 3.6 dead helper / orphan implementation

| | L1 | L2 |
|---|---|---|
| `purpose.ts` | **orphan**。`EXAM_PURPOSE_REGISTRY` の import 元は repo 全体で 0 本。reader は purpose を参照せず、tutorContext が読む kind を直書きしている | QA script のみが参照（Stage 3 まで未通電。設計どおり） |
| その他 | — | `lib/examSpine/**` 全体が runtime 未接続（E-S17 により意図的） |

Canon §47（dead code）の観点では、L1 の `purpose.ts` は
「宣言はあるが runtime には効いていない」= Canon §22 が警告する状態にある。
一方 L2 の未接続は Decision（E-S17）で宣言済みの意図的状態であり、性質が違う。

### 3.7 request-local snapshot（最重要の contract 矛盾）

```text
L1: lib/examSpine/read/snapshot.server.ts
      const store = new Map<string, { value: T; expiresAt: number }>()   ← module-level
    lib/contextBuilders/tutorContext.ts:915
      CONTEXT_CACHE_TTL_MS = 60_000
      cacheKey = includeParitySources ? `${userId}|parity` : userId       ← userId が key
```

これは **L1 自身の Register に LOCKED で載っている E-S6 が明示的に reject した設計**である。

```text
E-S6 — request-local snapshot（LOCKED / L1・L2 双方の Register に存在）
  Decision: `Request` インスタンスを key にした `WeakMap` で保持する
  Alternatives rejected:
    - global cache — cross-user 汚染のリスク
```

L1 は「global cache」側を実装し、しかもその判断を Register に登録していない。
L2 は E-S21 で同じ論点を再度明文化し、`WeakMap<Request>` + 毎回 `authorize()` 再評価 +
userId 不一致 entry の破棄を実装している（E-S6 / E-S7 を満たす）。

→ **この 1 点だけでも、L1 の contract を canonical に昇格させることはできない。**
昇格させると LOCKED decision を実装都合で上書きしたことになり、Canon §59（architecture
decisions are frozen）/ §60（変更 protocol）に反する。

### 3.8 byte-equivalence 資産

| | L1 | L2 |
|---|---|---|
| 対象 | tutor 1 purpose の loader / composition | **17 purpose × 35 block** |
| fixture | T1–T9（loader 9）+ A–F（composition 6） | F1–F6（6）× 880 checks |
| 依存 formatter | — | `lib/contextBuilders/**` / `lib/tutor/tutorPrompt.ts` 等 legacy formatter を **再実装せず import** |
| 移植性 | tutor runtime に強く結合 | **依存 formatter 8 file が両 lineage で完全一致**（`git diff` = 空）→ 無改変で移植可能 |

依存 formatter の一致を実測した（`git diff exam-spine-stage3 feature/interview-realtime-step1 -- <file>` が全て空）:

```text
lib/contextBuilders/tutorStudentContext.ts   SAME
lib/tutor/tutorPrompt.ts                     SAME
lib/buildBasicInfoPromptSection.ts           SAME
lib/contextBuilders/statementContext.ts      SAME
lib/contextBuilders/interviewContext.ts      SAME
lib/contextBuilders/matchingContext.ts       SAME
lib/interview/buildInterviewQuestionMaterials.ts  SAME
lib/studentProfile.ts                        SAME
```

→ **L2 の 880 checks は shipping branch へそのまま載る。** L1 側の tutor fixture も失われない（§6）。

### 3.9 L1 だけが持つ資産（L2 に無い / 失ってはいけないもの）

| # | 資産 | 性質 |
|---|---|---|
| A1 | `EXAM_PURPOSE_REGISTRY` の **purpose → sources 宣言** | **L2 に存在しない。** L2 の `EXAM_CONTEXT_REGISTRY` は block 包含 policy のみで、purpose→kind の写像を持たない。purpose gate（「purpose に無い kind は query を発行しない」/ audit §12）の data source が L2 には無い |
| A2 | `scripts/exam-spine-live-source-check.ts` | reader の SELECT 列を **実 PostgREST** に当てて 400/200 を判定（negative control つき）。L2 の Stage 3 QA は fake executor のみで、列名は live 未検証 |
| A3 | canary gate 実装 + 25 case QA（`spineContextFlag.ts`） | E-S11（default deny）の実装実績。Stage 4 の gate をゼロから書かなくてよい |
| A4 | tutor の truncate policy（`TUTOR_CONTEXT_SECTION_CAPS` / 行単位 drop / サロゲートペア保護） | Canon §56 の実運用知見。L2 の budget は宣言のみ |
| A5 | E-H2（mirror anon 露出）の **RESOLVED 記録**と本番適用 + `supabase/schema.sql` 追随 | Spine とは独立の security 成果。L2 の docs には無い |
| A6 | `EXAM_SPINE_STAGE3_READINESS_AUDIT.md`（1,068 行） | L2 の branch に存在しない |
| A7 | tutor loader/composition fixture 15 本 | tutor 移行時の regression 基準 |

---

## 4. CANONICAL_LINEAGE

```text
CANONICAL_LINEAGE = L2
```

対象は **`lib/examSpine/**` の contract と実装**である。
「L1 の production runtime を止める」ことでも「L1 の commit を捨てる」ことでもない（§6）。

---

## 5. Why

### 5.1 判定の骨子

Canon §82 は「Authority 調査では runtime を最優先せよ」と定めている。
**その指示に従った結果として L2 を選ぶ**、というのが本判定の構造である。

```text
runtime evidence（L1 が持つもの）
  = どの table を読むか / selection rule / 実行される client / 実測 row 形状 / truncate 実績

その evidence は既に:
  EXAM_SPINE_STAGE3_READINESS_AUDIT.md §3 / §8 / §9 / §10
  → L2 の queries.ts / rowMappers.ts / E-S18 / E-S19 / E-S20
  へ取り込まれている（L2 の interview_ai driver 変更 E-S18 は、
    production 実測 sessions 37 / results 1 という runtime 事実から導かれている）

したがって「L2 を採ると runtime evidence を失う」は成立しない。
逆は成立する ——「L1 を採ると Stage 1/2/3 の contract 4,618 行を失う」。
```

### 5.2 L1 を canonical にできない具体的理由（すべてコード実証）

1. **LOCKED decision との矛盾**（§3.7）
   `snapshot.server.ts` の module-level `Map<userId,…>` + 60 秒 TTL は、
   L1 自身の Register の **E-S6 が reject した alternative** である。
   Canon §60 は「好みや refactor 理由で architecture を変えない」と定める。
   矛盾実装を canonical に昇格させることは、Register を実装が上書きする前例になる。

2. **registry が read graph を覆っていない**（§3.5）
   `EXAM_SOURCE_PRIMARY_TABLE` は 1 kind 1 table。実際の reader は
   `presentation_attempts` / `presentation_sessions` / `interview_ai_results` を読む。
   Canon §22 の「どの table が Spine の権限内か registry から読めること」を満たさない。

3. **Canon の中核語彙を型として持たない**（§3.4）
   `ExamSourceBundle`（§10）/ `truncated`（E-S8）/ origin（§17）/ provenance（§39）が無い。
   Stage 4 の中心概念（§57: revision / fingerprint / verified / mismatch / unclaimed /
   unreadable / veto / mixed-origin）を載せる場所が `SourceState<T>` の 3 値には無い。
   載せるには結局 L2 相当の型を作り直すことになる。

4. **Decision Register への登録がゼロ**
   L1 は Phase 1〜3.5 で canary flag / TTL cache / parity source 3 本 / prompt 合成の切替を
   production へ入れているが、`EXAM_SPINE_DECISIONS.md` への追加は **E-H2 の RESOLVED 更新 1 件のみ**。
   `EXAM_SPINE_ARCHITECTURE.md` §0 は「Register の Human Decision が最優先」と定めている。
   未登録 contract を canonical にすると、権威文書と実装の対応が永久に取れなくなる。

5. **purpose registry が orphan**（§3.6）
   宣言は存在するが runtime から 1 本も import されていない。
   Canon §22 の「関数が存在する ≠ Production authority」がそのまま当てはまる。

### 5.3 L2 を canonical にできる理由

1. **Stage 1→2→3 の contract が連続している。** 型の系譜が 1 本で、Stage 4 は
   `ExamSourceReadOutcome` / `ExamSourceReadStatus` / `ExamContextOrigin` の上に
   verdict を足すだけで載る（新しい型体系を作り直さなくてよい）。
2. **I/O 境界が 1 点。** Canon §35（Prompt と Data Retrieval の分離）を構造で満たす。
   Stage 4 の verification は executor と readSources の間に差し込める。
3. **mutation 不可能性が型で閉じている**（E-S22）。Canon §7 を grep でなく構造で保証する。
4. **request-local snapshot が E-S6 / E-S7 を満たす**（`WeakMap<Request>` + 毎回 authorize +
   userId 不一致 entry 破棄 + unauthorized を保存しない）。
5. **byte-equivalence 資産が移植可能**（§3.8）。依存 formatter 8 file が両 lineage で一致。
6. **runtime impact が 0。** shipping branch へ追加しても production 挙動が変わらないため、
   Canon §43（一気に書き換えない）/ §46（legacy を先に消さない）を自動的に満たす。

### 5.4 なぜ「両方 canonical」も「融合した第 3 案」も採らなかったか

- 両方 canonical: Canon §2.1 / §31（Dual Authority 禁止）の architecture 版に相当する。
  `lib/examSpine/types.ts` は両 lineage で**同一パスに別内容**（L1: `ExamSourceKind` +
  `SourceState`、L2: `ExamContextPurpose` + `ExamContextOrigin`）であり、
  技術的にも共存できない。
- 第 3 案の発明: 本セッションの禁止事項であり、Canon §59（architecture decisions are frozen）
  にも反する。§9 の blocker はすべて **既存 contract の穴を埋める**形で解消できる。

---

## 6. Rejected lineage treatment

**L1 は「捨てる lineage」ではない。**次の 3 分類で扱う。

### 6.1 KEEP AS-IS（触らない）

```text
app/api/tutor/route.ts
lib/contextBuilders/tutorContext.ts
lib/tutor/composeTutorPrompt.ts
lib/tutor/spineContextFlag.ts
supabase/schema.sql（mirror RLS 追随）
scripts/mirror-server-write-qa.ts
scripts/exam-spine-tutor-{loader,composition,canary}-qa.ts + fixtures
docs/.../EXAM_SPINE_STAGE3_READINESS_AUDIT.md
```

理由: production で稼働している唯一の server read 経路であり、Canon §46 は
「新経路が production で確認される前に legacy を削除しない」と定める。
tutor の移行は Stage 5/6 の課題であって本判定の scope ではない。

### 6.2 RELOCATE（`lib/examSpine/**` の外へ退避。挙動不変）

```text
lib/examSpine/read/reader.server.ts      → tutor 所有の legacy read path へ
lib/examSpine/read/rowMappers.ts（L1 版）→ 同上
lib/examSpine/read/snapshot.server.ts    → 同上
lib/examSpine/types.ts（L1 版 SourceState 等）→ 同上
```

理由: L2 を canonical にすると同一パスが衝突する（`types.ts` / `read/rowMappers.ts`）。
**削除ではなく移設**にすることで、tutor の production 挙動を 1 byte も変えずに
`lib/examSpine/**` を L2 contract の専有空間にできる。
移設は import path の書き換えのみで、`qa:examSpine:tutorLoader` / `tutorComposition` が
無改変で PASS することを移設の受け入れ条件とする（→ E-S24）。

### 6.3 SALVAGE（L2 へ取り込む。§7 / §12）

| # | 資産 | 取り込み先 |
|---|---|---|
| A1 | purpose → sources 宣言 | `EXAM_CONTEXT_POLICY` に `sources: readonly ExamSourceKind[]` を追加（17 purpose 分。L1 の 8 purpose 分は根拠つきで移植し、残りは実コード再確認のうえ宣言） |
| A2 | live source check の方式 | L2 の `queries.ts` を実 PostgREST に当てる同型 script（negative control 必須） |
| A3 | canary gate | Stage 4 の gate 実装のベースにする（default deny + allowlist の 25 case QA ごと） |
| A4 | truncate 実績値 | `budget.ts` の `EXAM_OBSERVED_CONTEXT_CAPS` に tutor parity 値（1200 / 1800）を追記 |
| A5 | E-H2 RESOLVED | L2 branch の `EXAM_SPINE_STATE.md` / `DECISIONS.md` へ反映（doc 統合。§10-D2） |
| A6 | Stage3 readiness audit | L2 branch へ持ち込む（doc のみ） |
| A7 | tutor fixture 15 本 | そのまま維持（§6.1） |

### 6.4 DISCARD（採用しない contract）

```text
SourceState<T> を Spine 横断の戻り値契約にすること     … ExamSourceReadStatus + Bundle を使う
EXAM_SOURCE_PRIMARY_TABLE（1 kind 1 table）           … EXAM_SOURCE_TABLES（1:N）を使う
module-level Map + TTL の snapshot 契約                … E-S6 / E-S21 に反する
ExamSpinePurpose（8 値）                               … ExamContextPurpose（17 値）を使う
```

※ 「contract として採用しない」であって、`lib/examSpine/**` 外へ退避した実装コードは
　 tutor の legacy path として動き続ける（§6.2）。

---

## 7. Stage2 asset verdict

```text
lib/examSpine/blocks/**        KEEP_AS_CANONICAL
lib/examSpine/orchestrator/**  KEEP_AS_CANONICAL
lib/examSpine/budget.ts        KEEP_AS_CANONICAL（enforcement は引き続きしない）
```

### 7.1 Canon §34（Context Builder の責務）

Canon が禁じる形:

```text
if localStorage exists ... else if Supabase exists ... else ...
```

`blocks/build.ts` は source 探索を一切しない。`ExamContextInput` に**すでに入っている値**を
block へ写すだけで、`undefined` / `null` は `presence: 'missing'`、空文字は `'empty'` に落ちる。
Canon が求める `ExamSourceBundle → Context Builder → Prompt Context` の形になっている。

さらに Canon §34 が Context Builder に求める「選択 / 圧縮 / 文章化 / token budget」は
`orchestrator/plan.ts`（選択 = Layer 3 / 順序 = Layer 4）、`render.ts`（文章化 = Layer 5）、
`budget.ts`（token budget の宣言）へ分離されている。

→ **適合。**

### 7.2 Canon §35（Prompt と Data Retrieval の分離）

Canon が禁じる「DB read / conflict resolution / normalization / prompt generation / LLM call を
1 つの巨大関数へまとめる」形に対し、L2 は:

```text
Source → (Stage 3) readExamSources → ExamSourceBundle
       → (Stage 2) buildExamContextBlocks   ← Layer 2
       → selectExamContextBlocks            ← Layer 3
       → orderExamContextBlocks             ← Layer 4
       → renderExamContext                  ← Layer 5
```

に分かれている。`assemble.ts` は純関数（I/O / AI / Date / Math.random / env なし）。

**重要な設計上の美点**: `blocks/build.ts` は legacy formatter を**再実装せず import している**
（`buildBasicInfoPromptSection` / `buildStatementStudentProfileContext` /
`buildTutorStudentContextSection` 等）。「同じ section を 2 度実装しない」という
E-P6（client / server で同一の pure selector を使う）の精神をそのまま守っており、
byte-equivalence が構成的に保証される（比較で担保しているのではない）。

→ **適合。** Canon §49 が禁じる `getEverythingForTutor()` 型の集約とは逆の構造。

### 7.3 Canon §56（Token Efficiency）

- `budget.ts` は purpose ごとの `maxContextChars` を宣言し、`basis`（`code_enforced` /
  `observed_only`）と `derivation`（どの定数・どの実測から来たか）を必須 field にしている。
  「推測で置いた数値」を構造的に区別できる。
- ただし **Stage 2 では enforce しない**。これは E-P7（移行時に context を減らさない）に従った
  意図的な判断であり、Canon §56 違反ではない（Canon は「Context Builder 側で token 量を制御する」
  と定めるが、制御の実施時期は定めていない）。
- `observed_only` が大半である点は、Stage 4 で truncation に使う前に実測し直すことが
  `budget.ts` 自身のコメントで要求されている。

→ **適合（enforcement は Stage 5 以降の課題として据え置き）。**

### 7.4 Stage 2 の既知の穴（DISCARD ではなく修正対象）

| # | 内容 | 扱い |
|---|---|---|
| S2-1 | `ExamContextInput.origin` が単一値 → mixed-origin を表現できない | §9-B1 で REAL_STAGE4_BLOCKER |
| S2-2 | `diagnosis` kind に対応する block が 35 block 中に無い | §9-B3 で DEFER |
| S2-3 | `render` が null の purpose がある（byte 検証済み contract を持たない） | 意図的。`plan.ts` が理由を `notes` / `notYetModeled` に明記済み。Stage 5 の per-purpose 移行で埋める |

いずれも **contract を捨てる理由にはならない**（穴の位置が宣言されており、埋め方が一意に決まる）。

---

## 8. Stage3 reader verdict

```text
ADOPT（canonical Stage 3 reader とする）
条件: §8.5 の 3 点を Wave 2 の前提として解消する
```

指定された 7 file をすべて読み、Canon と突き合わせた。

### 8.1 query as data — ✅ 適合

`ExamReadQuery` は `{ kind, role, table, columns[], embed?, filters[], order[], limit, mode }`。
`queries.ts` は 10 kind 分をデータとして宣言し、実行しない。
`formatSelect()` を executor と QA が共有するため、**QA が検証した select 文字列と
production が発行する select 文字列が同一である**ことが構造で保証される。

`role: 'core' | 'enrichment'` により「core が取れたときだけ enrichment を発行する」を
型で表現している（`readPresentation` は core が空なら enrichment を **0 本**にする）。

### 8.2 single I/O boundary — ✅ 適合

`lib/examSpine/**` 全体で `client.from(...)` を呼ぶのは `supabaseExecutor.server.ts` の
1 関数のみ。`readSources.ts` / `queries.ts` / `rowMappers.ts` / `guards.ts` は
Supabase / next / env / fetch を一切知らない。Canon §69 の
「Context Builder → table-specific SQL」を構造的に成立させない。

### 8.3 mutation impossibility — ✅ 適合

`ExamReadQuery` は SELECT の語彙しか持たない。executor は `client.from(t).select(...)` から
始めるほかなく、`insert` / `update` / `upsert` / `delete` を書く型的な入口が存在しない。
Canon §7 / §69 を grep ではなく型で満たす。

### 8.4 request-local memo / fail-open / candidate / service_role — ✅ 適合

| 項目 | 実装 | 判定 |
|---|---|---|
| request-local memo | `WeakMap<Request, SnapshotEntry>`。module-level に置くのはこの WeakMap 1 つだけ | ✅ E-S6 / E-S21 |
| cache hit と認可 | `authorize()` を**毎回**呼ぶ。`!auth.ok` なら既存 entry があっても返さず保存もしない。`entry.userId !== auth.userId` なら entry を破棄 | ✅ E-S7 |
| 失敗の扱い | 失敗した kind も snapshot に保存し、同一 request 内で叩き直さない | ✅ fail-open の定義（retry で負荷を増やさない / 古い値へ差し替えない） |
| fail-open semantics | 1 kind の失敗は `status='error'` + slot `null` に閉じ、`Promise.allSettled` で他 kind を巻き込まない。executor の throw も query 失敗へ畳む | ✅ E-S1 |
| `null` と `[]` の分離 | snapshot kind は `{state:'present'|'absent'}`、履歴 kind は `[]`（読めて 0 件）と `null`（未取得）を分離 | ✅ Canon §40（EMPTY ≠ UNAVAILABLE） |
| `truncated` | cap+1 取得 → `rows > cap` で `truncated`。count query を足さない | ✅ E-S8 / E-S19 |
| server candidate ≠ canonical | `read/types.ts` 冒頭と `readSources.ts` 冒頭に E-S17 を明記。`verified` を名乗る field が型に存在しない | ✅ E-S17 |
| service_role の不在 | `lib/examSpine/**` に `service_role` / `SUPABASE_SERVICE_ROLE_KEY` / `serviceRoleClient` の参照ゼロ（README の比較表の 1 行のみ） | ✅ E-L4 / Canon §20 |
| owner 二重防御 | 全 query が `eq('user_id', …)`。`interview_ai` は `!inner` embed + `session.user_id` の filter も併記 | ✅ E-L3 / E-S18 |
| 観測の PII 非混入 | `ExamReadLogEntry` は number / boolean / closed enum のみ。caller が任意 metadata を足す口が無い | ✅ E-S12 / E-S13 |
| 逐語の非読み取り | `interview_ai_turns` / `presentation_attempts.transcript` / `presentation_sessions.script` / `statement_review_history.essay` が列配列に現れない | ✅ E-P5 |

### 8.5 Canon との矛盾（ADOPT の条件）

| # | 矛盾 | Canon | 重大度 |
|---|---|---|---|
| R-1 | `essayQuery` が `workspace` **jsonb を丸ごと** SELECT する（cap 5 行 ＋ 1）。`mapEssayRow` も `asRecord()` で素通しし、field 上限をかけない。`EssayWorkspace` には `body`（小論文本文）/ `reviews[*].essayBodySnapshot` / `improvementInProgress.rewriteDraft` が入る | §55 Privacy Boundary / §56 Token Efficiency。また `queries.ts` 冒頭の「読まない列は列配列に現れないことで構造保証」という主張が essay だけ成立しない | **高**。live read 開始前に必須 |
| R-2 | `EXAM_CONTEXT_REGISTRY` が purpose → source kind の写像を持たない。`readExamSources` は caller から `kinds[]` を受け取るだけで、purpose gate が存在しない | §55（必要なデータだけ選択）/ audit §12 の共通契約「registry に無い kind は query を発行しない」 | **高**。Stage 4 loader の前提 |
| R-3 | `queries.ts` の列名が **live PostgREST 未検証**（Stage 3 QA は fake executor のみ）。L1 は同種の検証 script を持つ | §79 Real DB Verification / §80「推測で PASS にしない」 | **中**。live read 開始前に必須 |

R-1 / R-2 / R-3 はいずれも **contract の欠陥ではなく充填漏れ**であり、L2 を採用しない理由にはならない。
ただし「Stage 3 = READY」と扱ってはならず、Wave 2 の入口作業とする（§12）。

---

## 9. Stage4 blocker freeze

### 9.1 当初リスト 6 件の判定

| # | 項目 | 判定 | 根拠 |
|---|---|---|---|
| B1 | `ExamContextInput.origin` が単一値 | **REAL_STAGE4_BLOCKER** | `orchestrator/input.ts:origin?: ExamContextOrigin` は input 全体に 1 つ。Canon §17 は「暗黙的 Mixed-Origin を禁止」、DoD §68 は「mixed-origin が追跡可能」を要求。さらに E-P7（server が空で bridge に中身があれば bridge を維持）は **per-field / per-kind** の判断を要求するため、単一 origin では表現できない。block 側（`ExamContextBlock.origin`）は既に per-block なので、修正は input 側を per-slot にする形になる |
| B2 | `BasicInfo.name` が server に存在しない | **ALREADY_RESOLVED** | E-P8 が LOCKED で決着済み。`rowMappers.ts` に `ExamBasicInfoServerRow`（`readonly nameOnServer: false`）が実装され、`name: ''` も `as BasicInfo` も無い。残るのは「bridge の氏名と server row の統合」だが、それは **B1 の per-field origin 解決に完全に包含される**。独立した blocker として残さない |
| B3 | diagnosis 用 Stage 2 block 不足 | **DEFER_TO_LATER_STAGE（Stage 5/6）** | `EXAM_CONTEXT_BLOCK_IDS` 35 個に diagnosis 由来 block が無い一方、Stage 3 は `diagnosisQuery` で読む。ただし Stage 4 は loader / gate / verification の Stage であり **consumer を切り替えない**（Stage 5 が per-field 移行）。block 不足が実害になるのは tutor が Spine へ移る時点。⚠️ L1 は既に production で diagnosis の `typeHint` を prompt へ出しているため、移行時に **E-P7 違反（context 減少）**にならないよう Stage 5 の受け入れ条件に含めること |
| B4 | authority verification | **NOT_BLOCKER** | これは Stage 4 の **成果物そのもの**（E-S2 / Canon §57）。blocker 欄に置くと「Stage 4 を始めるには Stage 4 が要る」という循環になる。§8.4 のとおり `ExamSourceReadOutcome` / `ExamSourceReadStatus` / `ExamContextOrigin` に verdict を載せる接続点は既に揃っている |
| B5 | authenticated server client wiring | **NOT_BLOCKER** | `createSupabaseExamReadExecutor(client)` は client を注入で受ける形が完成済み。必要なのは route 側で `getServerSupabaseClient()` を渡す配線のみで、**同じパターンが L1 の production で稼働している**（`tutorContext.ts:614` 相当 / `route.ts` が `auth.supabase` を注入）。Stage 4 の実装タスクであって前提条件ではない。ただし §9.2-B8 は別途 blocker |
| B6 | `presentation_practice_records` の `dormant_no_author` | **ALREADY_RESOLVED** | E-S16 が LOCKED。`sourceData/types.ts` の `EXAM_SOURCE_TABLES` から意図的に除外、`read/types.ts` に `EXAM_DORMANT_TABLES` として記録済み。Canon §23 / §24（DIFFERENT_MODEL_REQUIRED）と整合。再分類の trigger（対人プレゼン記録 UI の実装）も audit §4.5 に記録済み |

### 9.2 本判定で新規に確定した blocker

| # | 項目 | 判定 | 根拠 |
|---|---|---|---|
| B7 | `essay` の `workspace` jsonb 丸ごと SELECT（§8.5-R1） | **REAL_STAGE4_BLOCKER** | Stage 4 は live read を開始する Stage。小論文本文が毎 read で転送・bundle へ載る状態で通電してはならない。Canon §55 / §56。他 9 kind は `EXAM_READ_FIELD_LIMITS` で field 上限を持つのに essay だけ持たない非対称でもある |
| B8 | purpose gate の data source 不在（§8.5-R2） | **REAL_STAGE4_BLOCKER** | Stage 4 loader は purpose を受けて kind を決める必要がある。`EXAM_CONTEXT_REGISTRY` に `sources` field が無く、L1 の `EXAM_PURPOSE_REGISTRY.sources`（salvage 対象 A1）を移植しないと「常時全 kind SELECT」を構造的に防げない |
| B9 | `lib/examSpine/**` の path 衝突（§6.2） | **REAL_STAGE4_BLOCKER（運用）** | `types.ts` / `read/rowMappers.ts` が両 lineage で同一パス別内容。L1 の tutor runtime を退避しない限り、L2 contract を shipping branch へ載せられない。**Wave 2 の最初の作業** |
| B10 | `queries.ts` の live schema 未検証（§8.5-R3） | **REAL_STAGE4_BLOCKER** | Canon §79 / §80。fake executor だけで通電すると、列名不整合が production の `error` として初めて出る。L1 の `exam-spine-live-source-check.ts` と同型の read-only check（negative control つき）を L2 の query に対して実行する |
| B11 | E-H1 の残余（U2: `self_prs` / `statement_review_history` / `essay_workspaces` / `interview_practice_records` の **authenticated SELECT policy** 実在） | **REAL_STAGE4_BLOCKER（Human）** | audit §9.4 のとおり、この 4 kind は SELECT が一度も実行されたことがなく、policy の実在が未検証。fail-open で `error` に倒れるだけなので事故にはならないが、「Spine から 4 kind が恒久的に読めない」状態に気付かないまま Stage 4 を完了と判定する危険がある。E-H1 は `PENDING_HUMAN` のまま。§5.4 の SELECT 専用検証 SQL を 1 回実行すること |

### 9.3 Freeze 後の Stage 4 blocker 一覧（これだけが残る）

```text
REAL_STAGE4_BLOCKER
  B1   ExamContextInput.origin を per-field / per-kind にする（B2 の氏名統合を包含）
  B7   essay read の field 単位 projection（workspace 丸ごと SELECT の廃止）
  B8   purpose → source kind の写像を EXAM_CONTEXT_REGISTRY へ追加（L1 A1 の salvage）
  B9   lib/examSpine/** の path 衝突解消（L1 tutor read path の退避）
  B10  10 kind の query を live PostgREST で検証（negative control つき read-only）
  B11  E-H1 残余の SELECT policy 検証（Human / SQL Editor で SELECT のみ 1 回）

DEFER_TO_LATER_STAGE
  B3   diagnosis 用 Stage 2 block（Stage 5/6。tutor 移行の受け入れ条件に含める）

NOT_BLOCKER
  B4   authority verification（= Stage 4 の成果物そのもの）
  B5   authenticated server client wiring（実装タスク。パターンは production 実績あり）

ALREADY_RESOLVED
  B2   BasicInfo.name（E-P8）
  B6   presentation_practice_records = dormant_no_author（E-S16）
```

---

## 10. Canon contradictions

Canon 本文の変更が必要か / 実装が Canon に追いついていないだけかを分けて判定する。

### 10.1 Canon の変更が必要なもの

```text
なし。
```

Canon §60 が定める変更事由（前提が誤り / production behavior との矛盾 / security 問題 /
既存モデルで表現できない要件）に該当する箇所は見つからなかった。

### 10.2 implementation が Canon に追いついていないだけのもの

| # | Canon | 現状 | 追いつく Stage |
|---|---|---|---|
| C1 | §11 / §40 Source status（`verified` / `mismatch` / `unclaimed` / `unreadable`） | L2 は `ok` / `truncated` / `error` / `skipped` の 4 値。verification 系 3 値は未実装。L1 は 3 値でさらに手前 | Stage 4（E-S2）。`ExamSourceReadStatus` に足すのではなく **verdict を別軸で持つ**こと（read status と trust verdict を 1 つの enum に混ぜない） |
| C2 | §17 mixed-origin を暗黙に作らない | 語彙（`ExamContextOrigin` 3 値）と block 単位の保持はあるが、input 側が単一値（B1） | Stage 4 |
| C3 | §16 revision / fingerprint | 未実装（両 lineage） | Stage 4（E-S2 は content hash を送らない方針。§16 の「UI 描画順で fingerprint が変わらない」要件に注意） |
| C4 | §18 context veto | 未実装。ただし `ExamSourceReadOutcome`（status / truncated / enrichmentFailed）が veto 入力として十分な情報を持つ | Stage 4 |
| C5 | §22 unused reader を authority にしない | **L2 は準拠**（`list*FromSupabase` を一切参照せず、queries.ts で独自に宣言）。**L1 の `EXAM_PURPOSE_REGISTRY` は逆に orphan 側**（§3.6） | B9 の退避で解消 |
| C6 | §36 / §69 consumer direct read | Spine 経路については両 lineage とも違反なし。ただし **Spine 未移行の 11 route が `body.basicInfo` 等を受ける**構造は残存（`EXAM_SPINE_ARCHITECTURE.md` M1/M2 の実測）。これは Canon §43（一気に書き換えない）に従った移行途上の正常状態であり、E-S9 の `structural bridge` として分類済み | Stage 5〜7 |
| C7 | §20 service_role を通常 read に使わない | 準拠。`app/api/interview-ai/**` / `app/api/presentation/**` の service_role 使用は **class 2 kind の write path**（Canon §4.2 で server が著者と定義されている側）であり、context read ではない | — |
| C8 | §39 provenance | L2 は block 単位で `ExamDataProvenance` + `ExamContentDerivation` を保持。ただし **kind → block へ provenance が伝播していない**（Stage 3 の bundle は provenance を持たない） | Stage 4〜5 |

### 10.3 doc drift（実装ではなく文書側の乖離）

| # | 内容 | 影響 |
|---|---|---|
| D1 | **Decision Register が 2 系統に分岐している。** L1 は `E-S14` / `E-P7` まで、L2 は `E-S22` / `E-P8` まで。L1 側には E-H2 の `RESOLVED` があり L2 側には無い | **最も危険な drift。** 採番衝突を生む。§12-W2-1 で統合する。本判定は L2 側（最大値）を採番の正本とした |
| D2 | `EXAM_SPINE_STATE.md`（L2 branch）が「現在地: Stage 0 完了 / 次: Stage 1 未着手」のまま。Stage 1〜3 が landed している実態と乖離。§4「Not Implemented」も Stage 1/2/3 の項目を未実装として列挙したまま | 高。State は「最後に検証した運用状態」の権威（ARCHITECTURE §0）であり、嘘の状態を宣言している |
| D3 | `EXAM_SPINE_ARCHITECTURE.md` §12 の Stage 表が全 Stage「未着手」。§3 に `dormant_no_author` / `not_wired` ラベルが未追記（audit §4.5 の PROPOSED_DOC_CHANGE 1 が未適用） | 中 |
| D4 | `EXAM_SPINE_STAGE3_READINESS_AUDIT.md` が L1 branch にしか存在しない | 中。canonical lineage 側に持ち込む必要がある |
| D5 | audit §16 の `U8`（Stage 3 の正本 worktree）が未解決のまま記録されている | **本判定で解消**（canonical lineage = L2 / worktree = `exam-spine-stage3` 系列） |
| D6 | audit §15 が「`lib/examSpine/read/` が `feature/interview-realtime-step1` に書き込まれている。worktree 境界が守られていない可能性」を警告している | **本判定で解消**。両者は別 lineage の別実装であり境界侵犯ではなかった。ただし path 衝突（B9）として実害が残る |
| D7 | `supabase/schema.sql` が 4 mirror の anon INSERT / UPDATE policy を宣言したまま（本番は削除済み）。新規 project 適用時に本番より緩い状態を再生する | Spine とは独立。L1 の STATE.md §9.5 に「追随は別 STEP」と記録済み。**本判定の scope 外だが未解決として明示する** |

---

## 11. New Decision drafts

以下は **draft** である。`EXAM_SPINE_DECISIONS.md` への反映は Wave 2 の作業とする（§12-W2-1）。
採番は実ファイル確認による現在の最大値（E-S22 / E-P8）の次から始めている。

### E-S23 — Exam Spine の canonical lineage は Stage lineage（L2）とする

- **Status:** `LOCKED`（提案）
- **Decision:** `lib/examSpine/**` の contract と実装は `exam-spine-stage3` 系列（Stage 1→2→3）を canonical とする。`feature/interview-realtime-step1` 上の `lib/examSpine/**`（Phase 1〜3.5）は canonical contract として採用しない。
- **Reason:** (1) L1 の `snapshot.server.ts` は自身の Register の `E-S6` が reject した「global cache」を実装しており、LOCKED decision と矛盾する。(2) L1 の `EXAM_SOURCE_PRIMARY_TABLE` は reader が実際に読む 3 table を覆っておらず Canon §22 を満たさない。(3) `ExamSourceBundle` / `truncated` / origin / provenance という Canon の中核語彙を L1 の型が持たない。(4) L1 は Phase 1〜3.5 の runtime 変更を Register に 1 件も登録していない。(5) L1 が持つ runtime evidence は既に audit 経由で L2 の Stage 3 reader へ取り込まれており、L2 採用で失われない。
- **Alternatives rejected:**
  - *L1 を canonical にする* — 上記 5 点。Stage 1/2/3 の 4,618 行を捨て、Stage 4 の型基盤を作り直すことになる。
  - *両方を canonical にする* — `lib/examSpine/types.ts` が同一パス別内容であり技術的に共存不能。Canon §31 の Dual Authority 禁止の architecture 版にも当たる。
  - *2 lineage を融合した新 architecture を作る* — Canon §59（architecture decisions are frozen）に反する。§9 の blocker はすべて既存 contract の充填で解消できる。
- **Rollback implications:** 本 decision 単体では runtime を変えない。L1 の production 経路は §6.1 のとおり無改変で稼働し続ける。

### E-S24 — 拒否した lineage の read 実装は削除せず `lib/examSpine/**` の外へ退避する

- **Status:** `LOCKED`（提案）
- **Decision:** L1 の `read/reader.server.ts` / `read/rowMappers.ts` / `read/snapshot.server.ts` / `types.ts`（`SourceState` 系）を、tutor が所有する legacy read path として `lib/examSpine/**` の外へ移設する。移設は import path の書き換えのみとし、**production 挙動を 1 byte も変えない**。受け入れ条件は `qa:examSpine:tutorLoader` / `qa:examSpine:tutorComposition` / `qa:examSpine:tutorCanary` / `qa:examSpine:characterization` が無改変で PASS すること。
- **Reason:** Canon §46 は「新経路が production で確認される前に legacy を削除しない」と定める。tutor は現在唯一の server read 経路であり、削除も書き換えもできない。一方で L2 を canonical にすると `types.ts` / `read/rowMappers.ts` が衝突する。**移設**が両方の要求を同時に満たす唯一の手段である。
- **Alternatives rejected:**
  - *L1 の read 層を削除して tutor を L2 の reader へ即移行する* — Canon §43 / §45（read consolidation を段階的に）に反し、1 commit で production の tutor 経路を全面差し替えることになる。
  - *L2 を別 namespace（`lib/examSpine2/` 等）へ置く* — 「どちらが canonical か」がパスから読めなくなる。Canon §84 の目的（どこが正しいか分かること）に反する。
- **Rollback implications:** 移設 commit の revert のみ。挙動不変なので rollback による挙動変化も無い。

### E-S25 — Stage 2 の block / orchestrator / budget を canonical な Layer 2〜5 contract として凍結する

- **Status:** `LOCKED`（提案）
- **Decision:** `lib/examSpine/blocks/**` / `lib/examSpine/orchestrator/**` / `lib/examSpine/budget.ts` を Layer 2〜5 の canonical contract とする。`budget.ts` は引き続き **enforce しない**。legacy formatter は再実装せず import し続ける。
- **Reason:** Canon §34（Context Builder は Source of Truth を探さない）/ §35（Prompt と Data Retrieval の分離）に構造で適合しており、17 purpose × 35 block × 880 checks の byte-equivalence を持つ。依存 formatter 8 file が両 lineage で完全一致しているため、shipping branch へ無改変で移植できる。
- **Alternatives rejected:**
  - *block を捨てて purpose ごとに route へ組み立てを戻す* — Canon §49 が禁じる集約関数へ回帰する。
  - *Stage 2 で budget を enforce する* — E-P7（移行時に context を減らさない）に反し、`basis: 'observed_only'` の見積り値で本文を切ることになる。
- **Rollback implications:** runtime 未接続のため revert で production 影響ゼロ。

### E-S26 — Context origin は kind / block 単位で持つ（単一 origin を廃止する）

- **Status:** `LOCKED`（提案）
- **Decision:** `ExamContextInput.origin`（input 全体で 1 値）を廃し、origin を **slot / kind 単位**で保持する。`ExamContextBlock.origin` は既に per-block なので、input 側を per-slot にして block へ透過する。
- **Reason:** Canon §17 は「暗黙的 Mixed-Origin を禁止」し、DoD §68 は「mixed-origin が追跡可能」を要求する。さらに `E-P7`（server が空で bridge に中身があれば bridge を維持）は per-field の判断を要求するため、単一 origin では移行期の実態（basicInfo は server / statementDraft は not_server_capable / activity は bridge）を表現できない。`E-P8`（server の basicInfo に氏名が無い）の bridge 統合も、この per-field origin が前提になる。
- **Alternatives rejected:**
  - *purpose 単位で origin を持つ* — 同一 purpose の中で kind ごとに origin が違うのが移行期の常態。
  - *origin を観測ログにだけ持つ* — 型で持たないと「暗黙的 Mixed-Origin」を構造的に防げない。
- **Rollback implications:** Stage 2 の byte-equivalence には影響しない（origin は render に出ない）。ただし `blocks/build.ts` の signature 変更を伴うため、880 checks の再実行が受け入れ条件。

### E-S27 — `essay` の read は field 単位 projection とし、`workspace` を丸ごと SELECT しない

- **Status:** `LOCKED`（提案）
- **Decision:** `essayQuery` の `columns` から `workspace` の丸ごと取得を外し、必要な sub-field に限定する（PostgREST の JSON 演算子で `reviews` 等へ絞る）。`mapEssayRow` は `EXAM_READ_FIELD_LIMITS` を required argument として受け、field 上限を適用する。
- **Reason:** `EssayWorkspace` には `body`（小論文本文）/ `reviews[*].essayBodySnapshot` / `improvementInProgress.rewriteDraft` が含まれ、cap 5 行 ＋ 1 で毎 read 転送される。Canon §55（必要以上のデータを投入しない）/ §56（Raw history dump にしない）に反する。また `queries.ts` 冒頭が主張する「読まない列は列配列に現れないことで構造保証」が essay だけ成立しない。他 9 kind はすべて field 上限を持っており、非対称でもある。
- **Alternatives rejected:**
  - *mapper 側で本文を落とす* — 転送は既に発生している。read layer の責務として境界の手前で落とす。
  - *cap を 1 行にする* — 1 行でも本文全体が載る。行数の問題ではない。
- **Rollback implications:** Stage 3 QA の essay fixture 更新を伴う。runtime 未接続のため production 影響ゼロ。
- **関連:** L1 の `readLatestEssayReviewsRow` が既に `workspace->reviews` へ絞る実装を持つ（salvage 参考）。

### E-P9 — Register に登録されていない contract を canonical に昇格させない

- **Status:** `LOCKED`（提案）
- **Decision:** Exam Spine の contract（型 / 契約 / cache 方式 / gate 方式 / 命名体系）を canonical として採用するには、`EXAM_SPINE_DECISIONS.md` に対応する Decision が存在することを必要条件とする。実装が先行した場合、canonical 昇格の前に Decision を起こす。実装が既存の LOCKED decision と矛盾する場合は、**実装ではなく Decision を先に改める**（Canon §60 の protocol に従う）。
- **Reason:** L1 は Phase 1〜3.5 で canary gate / TTL cache / parity source / prompt 合成切替を production へ入れながら、Register には E-H2 の RESOLVED 更新 1 件しか追加していない。その結果、`snapshot.server.ts` が `E-S6` の reject した設計であることが Register からは読めない状態になっていた。`EXAM_SPINE_ARCHITECTURE.md` §0 は「Register の Human Decision が最優先」と定めており、この非対称を放置すると権威文書が実態を説明できなくなる。
- **Alternatives rejected:**
  - *実装を正として Register を後追いで書き換える* — Canon §59 / §60 に反する。「実装できたから architecture が変わった」を許すと Register の意味が消える。
  - *runtime に出ている実装を無条件で canonical とする* — Canon §82 は Authority 調査の順序を定めたものであり、contract 決定の権威を runtime に与えてはいない。
- **Rollback implications:** なし（governance rule）。
- **補足:** これは「実装を先に書くな」ではない。**先に書いてよいが、canonical に昇格させる前に Decision を起こせ**という順序の固定である。

---

## 12. Exact Wave2 prerequisites

Wave 2（＝ canonical lineage の上で実装を再開する段階）に入る前に、以下を **この順で**満たすこと。
各項目は 1 commit 相当の粒度に切ってある（Canon §64 / §77）。

### W2-0 — Human 承認（着手前）

```text
[ ] E-S23〜E-S27 / E-P9 の draft を承認する（§11）
[ ] canonical worktree / branch を確定する（本判定は exam-spine-stage3 系列を前提とする）
[ ] E-H1 残余（B11）の検証手段を決める（誰が SQL Editor で SELECT 専用検証を実行するか）
```

### W2-1 — Decision Register の統合（doc のみ / 最優先）

```text
[ ] L1 側の E-H2 = RESOLVED を canonical branch の DECISIONS.md / STATE.md へ取り込む（D1 / A5）
[ ] E-S23〜E-S27 / E-P9 を DECISIONS.md へ追記（採番衝突なきことを再確認）
[ ] Register が 1 本になったことを確認（以後 L1 側の Register は更新しない）
```

**これが最優先である理由:** Register が 2 本ある限り、次に誰が何を書いても採番が衝突する。

### W2-2 — doc drift の解消（doc のみ）

```text
[ ] EXAM_SPINE_STATE.md を Stage 3 landed の実態へ更新（D2）
    - §2 現在地 / §4 Not Implemented / §12 Rollback Position / §13 Next Stage
[ ] EXAM_SPINE_ARCHITECTURE.md §12 の Stage 表を更新（D3）
[ ] EXAM_SPINE_ARCHITECTURE.md §3 に dormant_no_author / not_wired ラベルを追記（D3 / audit §4.5-1）
[ ] EXAM_SPINE_STAGE3_READINESS_AUDIT.md を canonical branch へ持ち込む（D4 / A6）
[ ] audit §16 の U8 を「解消（本 convergence decision）」として更新（D5）
```

### W2-3 — path 衝突の解消（B9 / runtime 挙動不変）

```text
[ ] L1 の tutor read 実装 4 file を lib/examSpine/** の外へ移設（E-S24）
[ ] tutorContext.ts / composeTutorPrompt.ts の import path を書き換え
[ ] 受け入れ条件:
      npm run qa:examSpine:tutorLoader        PASS（fixture 無改変）
      npm run qa:examSpine:tutorComposition   PASS（fixture 無改変）
      npm run qa:examSpine:tutorCanary        PASS
      npm run qa:examSpine:characterization   PASS
      npx tsc --noEmit                        exit 0
      git diff -- app/api/tutor/route.ts      挙動差分なし（import path のみ）
[ ] L2 の lib/examSpine/** を canonical branch から shipping 系へ載せられる状態にする
```

### W2-4 — Stage 3 reader の欠陥充填（B7 / B8 / B10）

```text
[ ] B7  essayQuery の field 単位 projection 化 + mapEssayRow の limits 適用（E-S27）
        受け入れ: stage3 checks が essay の非読取 field を構造で freeze すること
[ ] B8  EXAM_CONTEXT_REGISTRY へ sources: readonly ExamSourceKind[] を追加（A1 salvage）
        - L1 の EXAM_PURPOSE_REGISTRY 8 purpose 分は provenance コメントごと移植
        - 残り 9 purpose は対象 route の実コードを読んで宣言（推測で埋めない）
        - readExamSources / requestSnapshot が purpose から kinds を導けること
        受け入れ: 「registry に無い kind は query を発行しない」を stage3 QA が検証
[ ] B10 L2 の 10 kind query を実 PostgREST に当てる read-only check を追加（A2 salvage）
        - anon key のみ / GET のみ / 値を出力しない / negative control 必須
        - 判定: unavailable が 0 件（= select list が本番 schema と互換）
        ⚠️ 実行は API コストを伴わないが外部通信を伴う。--dry 相当の確認後に別途承認を取る
```

### W2-5 — Stage 4 着手条件（B1 / B11）

```text
[ ] B1  ExamContextOrigin を per-slot / per-kind へ（E-S26）
        - orchestrator/input.ts の origin 単一値を廃止
        - blocks/build.ts が slot ごとの origin を block へ透過
        受け入れ: stage2 の 880 checks が無改変で PASS（origin は render に出ないため byte 不変）
[ ] B11 E-H1 残余の検証（Human / SQL Editor / SELECT のみ 1 回）
        確認対象は audit §5.4 のとおり:
          pg_class.relrowsecurity / pg_policies / pg_constraint / pg_indexes /
          pg_trigger / information_schema.role_table_grants
        特に self_prs / statement_review_history / essay_workspaces /
        interview_practice_records の authenticated SELECT policy 実在
[ ] E-H1 を RESOLVED または PARTIAL（残余明示）へ更新
```

### W2-6 — Stage 4 の scope 確認（着手時）

```text
Stage 4 = Source-Sync（E-S2）+ canary gate（E-S11 / L1 の A3 を salvage）+ loader
Stage 4 ではない:
  - consumer の切替（Stage 5）
  - tutor の三重投入解消（Stage 6）
  - diagnosis block の追加（B3 / Stage 5-6）
  - budget の enforcement（Stage 5 以降）
  - schema.sql の mirror policy 追随（D7 / Spine 外の別 STEP）

Stage 4 の設計上の注意（本判定から）:
  - read status（ok/truncated/error/skipped）と trust verdict（verified/mismatch/
    unclaimed/unreadable）を **1 つの enum に混ぜない**（C1）
  - verdict 優先順位は E-S2 のとおり unreadable > unclaimed > mismatch > verified
  - class 2（interview_ai / presentation）に Source-Sync を適用しない（E-S3）。
    ただし canary gate は適用する
```

### W2-7 — Wave 2 全体の不変条件

```text
[ ] Canon / ARCHITECTURE / DECISIONS を実装都合で書き換えない（E-P9）
[ ] 1 unit = edit + targeted QA + commit（Canon §63 / §64）
[ ] 他 session の WIP を commit へ混ぜない（Canon §65）
[ ] 他 worktree へ書き込まない
[ ] production runtime を変える commit と contract を足す commit を分ける
```

---

## 付録 A — 本判定で実行した検証コマンド一覧

```text
git worktree list / git merge-base / git log --oneline（lineage 構造の確認）
git diff --stat exam-spine-stage3 feature/interview-realtime-step1 -- <paths>
git diff exam-spine-stage3 feature/interview-realtime-step1 -- docs/...
grep -oE 'E-[SP][0-9]+' docs/.../EXAM_SPINE_DECISIONS.md | sort -n   （採番の実ファイル確認）
grep -rn "examSpine" app lib components hooks scripts                （consumer graph）
grep -rn "service_role|SERVICE_ROLE|serviceRoleClient" lib/examSpine/
npx tsx scripts/exam-spine-stage{1,2,3}-check.ts                     （L2）
npm run qa:examSpine:{tutorLoader,tutorComposition,tutorCanary,characterization}（L1）
npx tsc --noEmit                                                     （L2 worktree / exit 0）
```

**実行していないもの:** AI API 呼び出し / DB mutation / `qa:examSpine:liveSources`（外部通信を伴うため）/
`git reset` / `checkout` / `stash` / `delete` / force push / 他 worktree への書き込み。

## 付録 B — 本判定の Runtime Impact

| 種別 | diff |
|---|---|
| `app/**` / `lib/**` / `scripts/**` / `supabase/**` / `package.json` | **0** |
| AI prompt / AI route / DB / env / dependency / localStorage | **0** |
| 追加ファイル | 本ファイル 1 件のみ |
