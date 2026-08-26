# PASSAI 受験版 — Exam Spine Architecture

**Status:** Normative architecture document（Stage 0 で固定）
**Audience:** 人間メンテナ + Claude Code
**採用 architecture:** 案E — Architecture Transplant + Exam Authority Model
**Upstream architecture reference:** `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_ARCHITECTURE.md`

---

## 0. このドキュメントの使い方

本ファイルは受験版 Exam Spine の **実装憲章** である。Exam Spine に関わる作業の前に、次の順で読むこと。

1. `EXAM_SPINE_ARCHITECTURE.md`（本ファイル）— 意図する不変条件と境界
2. `EXAM_SPINE_STATE.md` — 最後に監査・検証した運用状態
3. `EXAM_SPINE_DECISIONS.md` — 確定済み Decision（**こちらが権威**）
4. 該当 Stage のリポジトリ実コード

### 権威ルール

- `EXAM_SPINE_DECISIONS.md` の明示的な Human Decision が最優先。
- 本ファイルは「意図する不変条件と境界」を定義する。
- `EXAM_SPINE_STATE.md` は「最後に検証した運用状態」を定義する。
- **リポジトリのコードが、実装されている内容の唯一の証拠である。**
- コードと本ドキュメントが食い違った場合、**どちらかを黙って書き換えてはならない**。実装前に食い違いを報告すること。

### 既存規約との関係

Exam Spine は既存規約を置き換えない。次はすべて有効なまま継続する。

- `docs/principles/student_profile_contract.md` — StudentProfile の責務・更新方針
- `docs/principles/architecture_rules.md` — storage / lib / components 配置
- `docs/principles/incremental_refactor_policy.md` — refactor 許可基準・trigger
- `docs/principles/ai_policy.md` — **本文代筆禁止**（Spine は prompt の *出所* を変えるだけで、AI の役割を広げない）
- `docs/supabase/{schema_boundary_policy,phase2_auth_boundary,client_boundary}.md`
- `docs/qa/cross_feature_persona_consistency.md`
- `lib/contextBuilders/README.md` / `lib/storage/README.md`

---

## 1. Mission

受験版は現在、機能ごとに次の経路をたどっている。

```text
feature A
  ↓
client localStorage collection      … 各 page が load* helper を個別に呼ぶ
  ↓
ad-hoc body bridge                  … fetch body へ人格データを詰めて送る
  ↓
route-specific guard                … route ごとの isPlainObject / isStudentProfile
  ↓
route-specific context              … route ごとの materials / prompt 組み立て
  ↓
AI
```

これを、次の経路へ **段階移行** する。

```text
Layer 1 Sources                     … localStorage canonical + auth-scoped Supabase tables
  ↓
authority-aware server read         … kind ごとに権威の性質を踏まえて server が読む
  ↓
request-local snapshot              … 1 request 内で kind ごとに 1 回だけ読む
  ↓
purpose projection                  … purpose が必要とする最小情報だけを抽出（純関数）
  ↓
pure orchestrator                   … I/O を持たず、用途別ブロックに分けて返す
  ↓
feature prompt
```

### 解決したい具体的問題（実測済み）

| ID | 問題 | 実測 |
|---|---|---|
| M1 | 同一ユーザー情報の並列組み立て | `loadBasicInfo()` が 31 ファイルから直接呼ばれ、11 route が `body.basicInfo` を受ける |
| M2 | 同じ人物を prompt に重複投入 | `/api/tutor` が basicInfo / 自己分析 / activity / statement review を最大 3 経路で 1 prompt に載せる |
| M3 | cross-device で人格が消える | `studentProfile` / `wallHittingResult` / `analyzeState` / `statementDraft` に復元経路が無く、別端末では `getStudentProfileForFeature()` が null を返す |
| M4 | fallback の不一致 | client / server / tutor block2 で 3 系統の解決順序が並存 |
| M5 | AI 生成文が事実として次段へ流れる | `analyzeState.summary.activitySummary`（AI 出力）が生文字列で interview-questions の materials に混ざる |
| M6 | prompt 断片の DB 凍結 | `interview_ai_sessions.target_ref.sourceContext` に client 組み立ての最大 6000 字が型・版なしで永続化される |
| M7 | 新機能ほど人格を持たない | `interview-ai` / `presentation` は basicInfo / studentProfile / activityData を一切参照しない |

---

## 2. Three-Layer Architecture

CAREER の 5 層のうち、受験版が採るのは **3 層のみ**。

```text
┌──────────────────────────────────────────────────────────┐
│ Layer 1 — Source Data                                    │
│   localStorage canonical  ＋  auth-scoped Supabase tables │
│   server read: owner-scoped RLS（service-role 不使用）    │
└──────────────────────────────────────────────────────────┘
                     │ deterministic projection（純関数）
                     ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 2 — Exam Self Understanding / Memory Projection    │
│   ★ request-local のみ。DB へ永続化しない（E-P2）        │
└──────────────────────────────────────────────────────────┘
                     │ purpose 別 selector
                     ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 3 相当 — Context Orchestrator                      │
│   純関数。I/O を持たない。用途別ブロックに分けて返す      │
└──────────────────────────────────────────────────────────┘
                     ▼
              feature prompt → AI
```

### 対象外（CAREER にはあるが受験版は持ち込まない）

| CAREER Layer | 受験版での扱い |
|---|---|
| Layer 3 — Event Log | **対象外**。行動メタデータの収集基盤は受験版の要件に無い |
| Layer 4 — Aggregated Insight（集合知） | **対象外**。CAREER 側でも production consumer ゼロ |
| Layer 5 — Company Knowledge Base | **対象外**。受験版に対応概念が無い |
| Personal Memory の DB 永続化 | **対象外**（E-P2）。request-local 再構築のみ |
| consent capture subsystem | **対象外** |

---

## 3. Source Authority Classes

Exam Spine は Source を **kind 単位で列挙し、権威の性質で分類する**。

```ts
// Stage 1 で lib/examSpine/sourceData/types.ts に実装する（Stage 0 では未実装）
type ExamSourceAuthorityClass =
  | 'device_canonical_mirrored'   // class 1
  | 'server_authoritative';       // class 2
```

| Class | 定義 | Source-Sync 検証 | canary gate |
|---|---|---|---|
| **1. device_canonical_mirrored** | canonical は端末の localStorage。Supabase は best-effort mirror。server が読んだ内容が「その request を出した端末の canonical」と一致する保証が無い | **必要**（E-S2） | 必要 |
| **2. server_authoritative** | **server route が著者**であり、client 側の copy は表示用 cache にすぎない。「client canonical」という概念が存在しない | **適用してはいけない**（E-S3）。適用すると「client の cache が古い＝server の正しいデータを使えない」という逆向きの誤りになる | **必要**（免除されるのは verification だけで、authorization は免除されない） |

### 想定 mapping（Stage 1 で型として実装する）

#### class 1 — device_canonical_mirrored

| kind | Layer 1 durable source |
|---|---|
| `basic_info` | `basic_info_logs` |
| `activity` | `activity_logs` |
| `diagnosis` | `diagnosis_logs` |
| `self_analysis` | `self_analysis_logs` |
| `statement_review` | `statement_review_history` |
| `self_pr` | `self_prs` |
| `essay` | `essay_workspaces` |
| `interview_record` | `interview_practice_records` |

#### class 2 — server_authoritative

| kind | Layer 1 durable source | 根拠 |
|---|---|---|
| `interview_ai` | `interview_ai_sessions` / `interview_ai_results` | server route が作成・更新する。client は結果表示のみ |
| `presentation` | `presentation_results` / `presentation_attempts` | 同上 |

> **受験版が upstream より前進する点**: CAREER は class 2 を 1 kind しか持たないため、multi-device consistency を「未保証」と明記している。受験版は 2 kind が最初から class 2 であり、その範囲では Source-Sync 無しで cross-device 一貫性が成立する。

**Stage 0 では型ファイルを実装しない。** 本ドキュメントに固定するのみ。

---

## 4. StudentProfile

### 決定（E-L5 / E-P1）

```text
localStorage 'studentProfile'
    = client projection。UI 表示 / オフライン / rollback 用として **維持**。
      書き込み経路（app/self-analysis/run/page.tsx）は改修しない。

self_analysis_logs
    = durable な Layer 1 source。既に auth-scoped で存在し、別端末への restore も稼働中。

ExamSpine selfUnderstanding
    = self_analysis_logs から **request-time に再構築**する Layer 2 projection。

DB write-back
    = しない（second writer を作らない）。

student_profile_mirrors
    = 今回読まない。消さない。
```

### 第三の原本を作らない

`StudentProfile` を Supabase canonical に昇格させると、`self_analysis_logs` と併せて **2 つの原本**が生まれる。これは upstream の「Layer 2 は projection であって original record ではない」という Required invariant に反する。

`types/studentProfile.ts` / `lib/studentProfile.ts` / `lib/studentProfileStorage.ts` は **変更しない**。

---

## 5. Fail-open Definition

**必ずこの定義に従うこと。**

```text
fail-open とは:

    context を減らして AI を続行する

である。
```

**絶対に、次の意味にしてはいけない。**

```text
    verified できない古いデータを代わりに使う
```

具体的な帰結:

| 状況 | 正しい挙動 |
|---|---|
| Spine の read に失敗した | その kind を使わず続行する |
| Source-Sync が verified にならなかった | その kind を使わず続行する |
| 未ログイン / env 未設定 | 空 Spine で続行する |
| テーブルが存在しない | その kind を `error` として扱い、他 kind は使う |
| 履歴の読み取りが上限に達した（`truncated`） | **freshness の権威にしない**（E-S8） |

Exam Spine には fail-closed 対象が存在しない（Layer 4/5 を持ち込まないため）。

---

## 6. Bridge Classification

upstream の bridge 2 分類を受験版へ翻訳する（E-S9）。

| 種別 | 定義 | technical debt か |
|---|---|---|
| **safety-fallback bridge** | server 経路が完成している。mismatch / flag OFF / non-canary / unreadable のときだけ使う | ❌ 設計どおり |
| **structural bridge** | server-readable な source が存在せず、正常な verified flow でも client bridge が必要 | ⭕ architecture debt |

### 現状

**受験版の bridge は原則すべて structural debt である。** server 経路が 1 本も存在しないため（`lib/contextBuilders/tutorContext.ts` の tutor 専用経路のみが例外）。

後続 migration で server 経路が用意できた source についてのみ、bridge を **safety fallback へ降格**できる。

### 恒久的な structural bridge（E-P3）

| 対象 | 理由 |
|---|---|
| `statementDraft`（localStorage `statementDraft`） | durable な table が存在しない。**当面維持**。`statement_drafts` table は作らない |
| `analyzeState` | 壁打ちセッションの一時状態。durable 化しない（意図的） |

観測でも区別する:

```text
<kind>:bridge                → safety fallback
statementDraft:not_server_capable → structural
```

この区別が無いと、canary 中の高い bridge 率を見て「移行が進んでいない」と誤読する。

---

## 7. Product Boundary

```text
EXAM Supabase   ≠   CAREER Supabase
EXAM Auth       ≠   CAREER Auth
```

| | EXAM | CAREER |
|---|---|---|
| repository | `/Users/yk/paid-app` → `github.com/surf0427/PASSAI.git` | `/Users/yk/PASSAI-CAREER` → `github.com/surf0427/PASSAI-CAREER.git` |
| Supabase project | `oarzldvteiuyuwkdoauq` | 別 project（本ドキュメントでは参照しない） |
| env 名前空間 | `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` | 別名前空間（本ドキュメントでは参照しない） |

### 不可侵ルール

> **Exam Spine は CAREER の table / env / auth を絶対に読んではならない。**

- `lib/examSpine/**` は CAREER の env 変数名・table 名・runtime module を一切含まない。
- CAREER リポジトリは **read-only upstream architecture reference** である。コード・commit・push・Supabase write・env・migration のいずれも行わない。
- CAREER の **ファイルパス**を upstream reference としてコメント・Decision Register に記録することは許可する。
- Stage 1 で静的 guard（QA）を入れ、この境界を機械的に検証する。

---

## 8. 責務境界

| 層 | 責務 | 禁止 |
|---|---|---|
| **Layer 1 server reader** | owner-scoped RLS で要求 kind だけ読む | service-role 使用 / body の userId を信用する / throw する / PII・本文・UUID を log する |
| **Source-Sync** | class 1 kind の「申告と server 可視状態の一致」を検証し、**使わない方向へ倒す** | 内容の権威にする / DB selector にする / user_id や権限の根拠にする |
| **request-local snapshot** | 1 request 内で kind ごとに 1 回だけ読む | authorize の再評価を省く / unauthorized な結果を cache する |
| **Layer 2 projection** | Layer 1 から決定的に Layer 2 を再構築する（純関数） | AI を呼ぶ / 副作用を持つ / DB へ write-back する |
| **purpose selector** | purpose が必要とする最小情報だけを抽出（純関数） | Spine 全体を渡す |
| **Orchestrator** | 用途別ブロックに分けて返す（純関数） | I/O / env 参照 / Supabase read を持つ |
| **route** | HTTP I/O + gate + loader 呼び出し + block 結合 + AI 呼び出し | prompt 文言の直書き / 人格データを body から受け取る（移行完了後） |
| **quota / billing** | Spine の **外**。Spine より前段（E-S10） | Spine が quota を判断する |

---

## 9. Prompt Assembly（目標形）

```text
system: [
  block 1  FEATURE_SYSTEM_PROMPT       … 静的。cache_control: 'ephemeral'（cache breakpoint）
  block 2  crossFeatureContext         … 他機能の確定成果の要約（AI 派生ラベルつき）
  block 3  selfUnderstandingContext    … 自己理解（AI 派生ラベルつき）
]
messages: [ ...history（sanitize 済み）, { role: 'user', content: 機能固有入力 } ]
```

- Spine 由来テキストは **system 側**に置く。会話履歴（`messages`）に混ぜない。
- AI 派生ブロックには「AI が過去に整理した内容であり、本人の確定情報ではない」旨のラベルを必ず付ける。
- purpose ごとに文字数上限を持つ。
- ユーザー入力は `messages` にのみ置く。Spine 由来テキストは DB 値だがユーザー入力文字列（活動名等）を含むため、見出し偽装を防ぐ正規化を projection 側で行う。

**Stage 0 では prompt を一切変更しない。** 上記は Stage 2 以降の目標形である。

---

## 10. Observability

- 観測語彙は **enum のみ**。PII / 本文 / UUID を出さない（E-S12 / E-S13）。
- 記録する軸: `purpose` / `sourceOrigins`（kind → server / bridge / not_server_capable）/ `sourceVerdicts` / `coverage` / `baseReason`。
- 既存の `[TutorContextSources]` 形式（source 別レイテンシの JSON 出力）と整合させる。

---

## 11. Rollout / Rollback

- gate は **purpose flag AND user allowlist の連言**、default deny（E-S11）。
- 4 層設計（master enabled / rollout scope / allowlist / denylist）を将来採用する（D2 / E-S11）。
- **unsafe rollback 経路をコードに作らない**。「検証なしで stale を使う」code path を実装しない。
- rollback は「env flag を落とす」または「revert 1 commit」で完了すること。

**Stage 0 では env も runtime gate も実装しない。**

---

## 12. Stage 定義

| Stage | 内容 | 本ドキュメント時点 |
|---|---|---|
| **0** | Decision register + architecture docs + characterization baseline | ← **現在地** |
| 1 | types + purpose registry（誰も呼ばない） | 未着手 |
| 2 | Orchestrator（純関数・byte 一致） | 未着手 |
| 3 | rowMappers + serverReader（read のみ） | 未着手 |
| 4 | sourceSync + canary gate + loader | 未着手 |
| 5 | 1 feature の per-field 移行 | 未着手 |
| 6 | tutor 三重投入の解消 | 未着手 |
| 7 | 残り feature の段階移行 | 未着手 |
| 8 | StudentProfile の Layer 2 化 | 未着手 |
| 9 | interview-ai `sourceContext` 廃止 | 未着手 |
| 10 | bridge 削除 + dead code | 未着手 |
| 11 | 全開放と監視 | 未着手 |

---

## 13. Upstream Architecture Reference

CAREER のコードは **コピーしない**。architecture decision / responsibility boundary / failure semantics / trust model のみを翻訳する。

| Exam Spine 概念 | Upstream reference |
|---|---|
| Purpose Registry | `PASSAI-CAREER/lib/careerContext/purpose.ts` |
| Context Orchestrator | `PASSAI-CAREER/lib/careerContext/orchestrator.ts` |
| Source Kind / Authority Class | `PASSAI-CAREER/lib/careerSourceData/types.ts` |
| Layer 1 server reader | `PASSAI-CAREER/lib/careerSourceData/serverReader.server.ts` |
| row → domain の単一実装 | `PASSAI-CAREER/lib/careerSourceData/rowMappers.ts` |
| Source-Sync Veto | `PASSAI-CAREER/lib/careerSourceSync/signal.ts` |
| revision 算出 | `PASSAI-CAREER/lib/careerSourceSync/revision.ts` |
| purpose 単位の 1 回 read | `PASSAI-CAREER/lib/careerServerContext/purposeContext.server.ts` |
| pure selector（client/server 共有） | `PASSAI-CAREER/lib/careerMemory/selector.ts` |
| snapshot → projection | `PASSAI-CAREER/lib/careerMemory/snapshot.ts` |
| server / bridge coexistence | `PASSAI-CAREER/app/api/career/consultation/resolveContextInputs.ts` |
| architecture 憲章 | `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_ARCHITECTURE.md` |
| Decision Register 方式 | `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_DECISIONS.md` |
| State snapshot 方式 | `PASSAI-CAREER/docs/career/data_spine/DATA_SPINE_STATE.md` |

---

## 14. Change discipline

Exam Spine の各実装 slice は次を満たすこと。

- 範囲が限定されている（1 Stage = 1〜3 commit）
- 単独でレビュー可能
- 可能な限り追加のみ（additive）
- リスクがあるときは既存 gate の背後に置く
- diff が局所的
- 該当 QA でカバーされている
- **Human の architectural decision が必要な地点で止まる**（`E-H*` として記録する）
