# EXAM_SPINE_STAGE5_ENTRY — Stage 5 Entry Contract

**Status:** Stage 5 entry gate（Stage 4 完了後・最初の consumer 切替前）
**Authority:** 本書は `EXAM_SPINE_DECISIONS.md` の下位文書である。矛盾したら Register が正。
**関連 Decision:** E-S26 / E-S28 / E-S33 / E-S34 / E-S37 / E-S38 / **E-S39** / **E-S40** / E-P7 / E-P8 / E-S1 / E-S2 / E-S11

> ⚠️ 本書は decision を定義しない（`##` 見出しに decision ID を置かない）。
> ID の採番権は Register だけが持つ（E-S38）。

---

## 1. Stage 5 の境界（曖昧さを残さない）

Stage 4 は「canonical context を **組み立てるが使わない**」ところで意図的に止まっている。

```text
Stage 4 現在        legacy / body bridge = authority
                    canonical namespace  = dormant（production importer 0）
                    shadow               = 組み立てて破棄（結果を変数へ束縛しない）
```

**Stage 5 に入った瞬間の定義:**

```text
CONSUMER_SWITCH_PERFORMED = YES
  ⇔
canonical context に由来する値が、ある consumer の
**最終 prompt / response / AI 入力のいずれかに 1 byte でも到達した**時点
```

判定は「env を ON にしたか」ではなく「到達したか」で行う。したがって:

- shadow で組み立てて **破棄**している間は `NO`（Stage 4）
- 比較結果を enum / 件数として **log にだけ**出す間も `NO`（Stage 4。E-S34）
- canary allowlist の 1 ユーザーにでも canonical 値が prompt へ入ったら **`YES`**（Stage 5）

---

## 2. 最初の consumer（E-S40）

```text
FIRST_STAGE5_CONSUMER = tutor
FIRST_STAGE5_SLOT     = basic_info（単独）
```

同 request の他 slot は bridge / legacy のまま据え置く。per-kind origin（E-S26）が
per-slot 移行を表現できるため、consumer 単位で一括切替しない。

### 選定の実測根拠

| purpose | server read | device claim | canary gate | 必要 kind | block 不在 kind |
|---|---|---|---|---|---|
| **tutor** | ✅ legacy serverRead | ✅ basic_info（E-S33） | ✅ E-S34 | 9 | 5 |
| essay 系 5 / statement_prepare | ✗ | ✗ | ✗ | 1 | 0 |
| self_analysis 系 3 | ✗ | ✗ | ✗ | 2 | 0 |
| interview_questions / matching | ✗ | ✗ | ✗ | 3 | 0 |
| self_pr / statement_review / interview_feedback | ✗ | ✗ | ✗ | 5〜6 | 2 |

block を持つ kind は `basic_info` / `activity` / `self_analysis` / `statement_review` の 4 つ。

- kind 数だけ見れば essay 系（1 kind / block 不在 0）が最小に見えるが、
  **Stage 5 infra を 1 つも持たない**ため gate / claim / shadow / 比較経路を新設することになる。
- tutor は 4 つすべてを持つが、**consumer 全体では block 不在 5 kind** で E-P7 に違反する。
- → **tutor × basic_info slot 単独**が「既存 infra を使い」「E-P7 を満たす」唯一の交点である。

---

## 3. Canary contract（最初の consumer）

Stage 4 の SHADOW と Stage 5 の CANARY は**別物**である。境界を state で固定する。

| state | legacy authority | Spine authority | comparison | verification | fallback | user-visible | `CONSUMER_SWITCH_PERFORMED` |
|---|---|---|---|---|---|---|---|
| `OFF` | **全 slot** | なし（query 0 本） | なし | なし | — | 不変 | **NO** |
| `SHADOW` | **全 slot** | 組み立てるが**破棄** | enum / 件数のみ log | 実行する | — | **不変** | **NO** |
| `CANARY` | basic_info 以外 | **basic_info slot のみ**（allowlist ユーザー） | する | **必須** | bridge | allowlist のみ変化 | **YES** |
| `ON` | basic_info 以外 | **basic_info slot**（scope 内全員） | する | **必須** | bridge | 変化 | **YES** |
| `HOLD` | **全 slot** | なし | なし | なし | — | 不変 | **NO** |

### state 遷移の gate

```text
OFF → SHADOW      Stage 4 の条件（本書 §6 の entry gate が YES）
SHADOW → CANARY   basic_info の verified 率 / mismatch 原因が kind 単位で説明できる
                  E-P7 分岐（server 空 + bridge 有 → bridge）が shadow で実観測されている
                  氏名 overlay が bridgeFields として記録されている（E-P8）
CANARY → ON       canary 期間に user-visible 劣化の報告が無い
                  safety_fallback 率が恒常的でない
any → HOLD        denylist に userId を足すだけで即時縮退（E-S11）
HOLD → SHADOW     復帰は SHADOW へ戻す。CANARY / ON へ直接戻さない
```

`HOLD` からの復帰を SHADOW 経由に限定するのは、縮退の原因が verification 側か
consumer 側かを切り分けないまま再有効化しないため。

**unsafe rollback は実装しない**（E-S11 / E-S1）。「verification に失敗したので
古い server 値を使う」経路を作らない。縮退は常に bridge / legacy へ戻る方向のみ。

---

## 4. Failure matrix（最初の consumer / basic_info slot）

適用順序を固定する。実装者が状況判断で入れ替えてはならない。

```text
1. authorize 失敗            → BLOCK_REQUEST（既存挙動。E-S7）
2. purpose gate に kind が無い → BLOCK_REQUEST（E-S28。query 発行前に落とす）
3. canary 無効 / 非該当       → bridge（safety_fallback として計上。E-S9）
4. slot ごとに E-S2 の優先順位 unreadable > unclaimed > mismatch > verified
5. veto された slot → bridge に値があれば bridge / 無ければ omit（E-P7 / E-S1）
```

| 事象 | basic_info slot の挙動 | 根拠 |
|---|---|---|
| source absent（読めて 0 行） | bridge に値があれば **bridge**、無ければ omit | E-P7 |
| source unavailable（RLS / 通信 / relation） | **bridge**（`safety_fallback`） | E-S1 / E-P7 |
| source invalid（行はあるが shape 不正） | **bridge** + degraded 計上。`absent` に潰さない | Canon §40 |
| verification mismatch | server を **使わない** → bridge | E-S2 veto |
| verification unclaimed | server を使わない → bridge | E-S2（`mismatch` より優先） |
| verification incomparable | server を使わない → bridge。`verified` に寄せない | E-S35 |
| server read failure（read 層全体） | 全 Spine slot を bridge / omit。**AI call は継続** | E-S1 |
| old client body present | 受理して bridge として使う。**400 にしない** | Canon §43 / §46 |
| canonical context build failure | try/catch で握り、legacy 経路を巻き込まない | E-S1 |
| canary disabled | bridge（`safety_fallback`） | E-S11 |
| canary enabled but vetoed | bridge（`safety_fallback`）。degraded を観測 | E-S2 |

**禁止（新規に導入しない）**: latest-wins / `updated_at` が新しい方を採用 /
Contract に無い fallback / `absent` と `unavailable` の同一視 / 検証失敗時の stale 採用。

---

## 5. Shipping QA strategy

canonical branch で green だったことを consumer 切替の根拠にしない。
shipping 由来の統合 branch で**何を**回すかを 3 層に分けて定義する。

### 層 1 — canonical namespace intrinsic QA（canonical branch の責務）

`stage1〜5` / `syncCore` / `syncAdapters` / `syncDevice` / `syncSignal` / `readiness`。
canonical branch で全 green を維持する。**shipping へ全面移植しない**
（script が canonical 実装と一体で、移植すると二重管理になる）。

### 層 2 — shipping integration QA（**Packet E で成立済み**）

| 検査 | 実装 | 状態 |
|---|---|---|
| canonical path byte identity | `git diff --exit-code <CANONICAL_HEAD> -- lib/examSpine` | ✅ |
| dormant / runtime importer guard | `qa:examSpine:packetE` | ✅ |
| legacy characterization | `qa:examSpine:characterization` | ✅ |
| tutor composition | `qa:examSpine:tutorComposition` | ✅ |
| tutor loader | `qa:examSpine:tutorLoader` | ✅ |
| canary containment | `qa:examSpine:tutorCanary` | ✅ |
| prompt byte equivalence | snapshot fixture checksum 不変 | ✅ |

### 層 3 — consumer migration QA（**最初の切替 packet が新設する**）

最小要件:

```text
1. canary OFF で prompt が byte-identical（既存 snapshot で検証）
2. canary OFF で Spine query が 0 本
3. basic_info slot の origin が per-slot provenance に記録される（E-S26）
4. E-P7 分岐（server 空 + bridge 有 → bridge）の明示テスト
5. 氏名 overlay が消えない（E-P8 / E-P7）
6. verification veto 時に bridge へ縮退する
7. 他 8 slot が bridge のままであることの機械検証
```

**層 1 を shipping で回す必要が生じた場合の最小の正道:**
canonical namespace 自体は byte-identical なので、必要なのは script と
`package.json` entry のみ。移植するなら **その packet の scope として明示的に行う**
（Packet E は「大量移植しない」方針を守った）。

---

## 6. Stage 5 Entry Gate（機械判定）

| 条件 | 状態 | 根拠 |
|---|---|---|
| `STAGE4_CANONICAL_FROZEN` | ✅ | canonical tip 1 本 / Register singular（E-S38） |
| `PACKET_E_COMPLETE` | ✅ | `ea20e07` |
| `CANONICAL_NAMESPACE_ON_SHIPPING` | ✅ | 42 file |
| `CANONICAL_PATH_DIFF_ZERO` | ✅ | `git diff --exit-code` = 0 |
| `LEGACY_AUTHORITY_INTACT` | ✅ | serverRead 4 file / tutorContext が import |
| `E_H7_RESOLVED` | ✅ | **E-S39** |
| `FIRST_CONSUMER_SELECTED` | ✅ | **E-S40**（tutor / basic_info slot） |
| `FIRST_CONSUMER_CONTRACT_REGISTERED` | ✅ | **E-S40** |
| `SHIPPING_STAGE5_QA_DEFINED` | ✅ | 本書 §5 |
| `CANARY_CONTRACT_DEFINED` | ✅ | 本書 §3 |
| `FAILURE_MATRIX_DEFINED` | ✅ | 本書 §4 |
| `NONCANONICAL_STAGE5_WORK_CLASSIFIED` | ✅ | `EXAM_SPINE_STATE.md` §1.1 |
| `R5_EVIDENCE_CLASSIFIED` | ✅ | `EXAM_SPINE_STATE.md` §1.1 |
| `NO_UNREGISTERED_DECISION_IDS_PROMOTED` | ✅ | canonical は E-S1..E-S40 連番・重複 0（readiness R1） |

```text
STAGE5_ENTRY_READY = YES
```

ただし **最初の切替そのものは別 packet**である。本書はその前提条件を固定するだけで、
切替を許可した時点で自動的に実行してよいという意味ではない。
`CONSUMER_SWITCH_PERFORMED` は §1 の定義で判定する。
