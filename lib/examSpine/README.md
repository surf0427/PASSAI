# `lib/examSpine/` — Exam Spine（受験版）

**Stage: 1（types + purpose registry）**
**現在の状態: production runtime から import されていない dead module。これが Stage 1 の正しい姿。**

正本ドキュメント（本 README より優先）:

- `docs/principles/exam_spine/EXAM_SPINE_ARCHITECTURE.md` — 意図する不変条件と境界
- `docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md` — 確定 Decision（**権威**）
- `docs/principles/exam_spine/EXAM_SPINE_STATE.md` — 最後に検証した運用状態

---

## Mission

受験版は現在、機能ごとに「client が localStorage から集めて body に詰める → route ごとに guard →
route ごとに prompt 組み立て」という経路をたどっている。同じ人格データが route ごとに別の形で
組み立てられ、どの feature が何を AI に渡しているかが 1 箇所で分からない。

Exam Spine はこれを

```text
Layer 1 Sources（localStorage canonical + owner-scoped Supabase）
  → Layer 2 projection（request-local・純関数）
  → Context Orchestrator（純関数）
  → feature prompt
```

へ **段階移行**するための骨格である。Stage 1 はその骨格の **静的 contract だけ**を置く。

---

## Stage ownership

| Stage | 内容 | 状態 |
|---|---|---|
| 0 | Decision register / architecture docs / characterization baseline | 完了（凍結） |
| **1** | **types + purpose registry（誰も呼ばない）** | **← 現在地** |
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

## Layer boundaries（このディレクトリの構成）

```text
lib/examSpine/
  types.ts            横断語彙。ExamContextPurpose / ExamContextOrigin
  sourceData/
    types.ts          Layer 1。ExamSourceKind / authority / table / read status / bundle
  budget.ts           purpose 別 context 上限の**数値の正本**
  purpose.ts          Purpose Registry。budget.ts から maxContextChars を読む
```

依存の向きは一方向で、循環しない。

```text
purpose.ts ──▶ budget.ts ──▶ types.ts
sourceData/types.ts（独立）
```

---

## Source authority

Source は **kind 単位**で列挙し、権威の性質で 2 分類する（`E-L2`。mapping の正本は
`EXAM_SPINE_ARCHITECTURE.md` §3）。

### class 1 — `device_canonical_mirrored`（8 kind）

canonical は端末の localStorage。Supabase は best-effort mirror。後続 Stage で Source-Sync による
負の安全ゲートが要る（`E-S2`）。

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

### class 2 — `server_authoritative`（2 kind）

server route が著者であり、client の copy は表示用 cache にすぎない。Source-Sync を適用しては
いけない（`E-S3`）。canary gate（authorization）は class 1 と同じように必要。

| kind | Layer 1 durable source |
|---|---|
| `interview_ai` | `interview_ai_sessions` / `interview_ai_results` |
| `presentation` | `presentation_results` / `presentation_attempts` |

---

## Purpose registry

`purpose.ts` の `EXAM_CONTEXT_REGISTRY` は **現行の 17 AI route が実際に何を渡しているか**の宣言
である。理想形ではない。値は route と prompt builder を直接読んで決めており、推測は入れていない。

| purpose | route | profile | activity | selfUnderstanding | recentLogs | university |
|---|---|---|---|---|---|---|
| `self_analysis` | `analysis` | include | compact | exclude | exclude | include |
| `self_analysis_additional` | `analysis/additional` | include | compact | exclude | exclude | include |
| `summarize` | `summarize` | include | compact | exclude | exclude | include |
| `statement_prepare` | `statement-prepare` | exclude | exclude | exclude | exclude | include |
| `statement_review` | `statement-review` | include | compact | include | include | include |
| `essay_themes` | `essay-themes` | include | exclude | exclude | exclude | include |
| `essay_review` | `essay-review` | include | exclude | exclude | include | include |
| `essay_chat` | `essay-chat` | include | exclude | exclude | exclude | include |
| `essay_deep_questions` | `essay-deep-questions` | include | exclude | exclude | exclude | exclude |
| `essay_improve_summary` | `essay-improve-summary` | include | exclude | exclude | exclude | exclude |
| `interview_questions` | `interview-questions` | **minimal** | minimal | include | include | include |
| `interview_feedback` | `interview-feedback` | include | minimal | include | include | **admission_focus** |
| `interview_ai` | `interview-ai/*` | exclude | minimal | include | include | exclude |
| `presentation_feedback` | `presentation/{theme,evaluate,qa}` | exclude | exclude | exclude | exclude | include |
| `matching` | `matching` | include | compact | include | exclude | include |
| `self_pr` | `reason` | exclude | minimal | exclude | exclude | exclude |
| `tutor` | `tutor` | include | compact | include | include | include |

監査で確定した非自明な事実:

- 氏名（構造化 PII）は `buildBasicInfoPromptSection` 経由で **11 route** に乗っている。
  `interview_questions` は既に氏名を載せていない（`buildInterviewQuestionMaterials` が
  `basicInfo` から `examTypes` / `subjectGrades` / `preferences` しか取らないため）。
- `admissionFocusContext` が通電しているのは **`interview_feedback` だけ**。
  `statement_review` は route の PR9 marker のとおり未接続、`matching` / `interview_questions` は
  意図的に非接続。
- `quota / billing` の feature 語彙（`QuotaFeature` 8 種）とは粒度も目的も異なる。
  quota は Spine の前段であり Spine の外（`E-S10`）。

### 現在値と target を混同しない

`E-P4` は「氏名を後続 Stage で prompt から落とす」を LOCKED としている。registry では

- `profile` … **現在値**
- `profileTarget` … `E-P4` の target（現在 `profile: 'include'` の purpose にだけ付く）

と field を分けている。Stage 1 では `profileTarget` を通電しない。実施は `PROMPT_VERSION` bump と
同一 commit で行う（`buildBasicInfoPromptSection` は 11 route から参照されており、prompt byte が
変わると client の input-hash cache が全 miss する）。

---

## Budget

`budget.ts` が数値の正本で、`purpose.ts` はそこから読むだけ（二重管理を避ける）。

- `EXAM_OBSERVED_CONTEXT_CAPS` … 受験版リポジトリに **実在する上限定数の写し**。
- `ExamContextBudget.basis`
  - `code_enforced` … 現行コードが実際にその値で clip している（`interview_ai` の 6500 のみ）。
  - `observed_only` … 上限を持たない block を含むため、実測 + 構造上限からの見積り。
    後続 Stage で truncation に使う前に必ず実測し直すこと。
- `derivation` … その数値がどの定数 / どの実測から来たかを必ず書く。

**Stage 1 では enforcement しない。** 値は現行より小さくしない（`E-P7`: 移行時に context を減らさない）。

---

## What this module does

- Source kind と authority class を宣言する
- Layer 1 durable source table を宣言する
- purpose を列挙し、purpose ごとの現行 context 方針を宣言する
- purpose ごとの context budget を、導出根拠つきで宣言する

## What this module does NOT do（Stage 1 の非目標）

- Orchestrator / server reader / rowMappers / Source-Sync / revision token / request-local cache
- canary gate / environment flag / `resolveContextInputs`
- API route の変更 / prompt の変更 / `PROMPT_VERSION` の変更
- `StudentProfile` 挙動の変更 / `self_analysis_logs` の変更 / localStorage の変更
- DB schema / migration / Supabase write / mirror security / billing / quota / UI の変更
- AI 呼び出し（このディレクトリは AI SDK を一切 import しない）

### 意図的に Stage 1 で作っていない型

- **`ExamDataProvenance`（`user_confirmed` / `deterministic` / `ai_derived`）**
  `EXAM_SPINE_ARCHITECTURE.md` §9 が要求する「AI 派生ラベル」は Layer 2 の **出力 block**
  に付くものであり、Source kind に付くものではない。実際、kind 単位に 1 ラベルを割り当てると
  `essay`（本人の本文 + AI レビューが同じ `essay_workspaces` に同居）などで嘘になる。
  block contract を作る Stage 2 で、そこに置く。
  「消費者ゼロの型を先に作らない」（`E-P1` / `incremental_refactor_policy.md`）に従う。

---

## CAREER upstream references

CAREER のコードは **コピーしない**。architecture decision / responsibility boundary /
failure semantics / trust model のみを翻訳している。

| Exam Spine の要素 | Upstream architecture reference |
|---|---|
| Purpose Registry | `/Users/yk/PASSAI-CAREER/lib/careerContext/purpose.ts` |
| Source kind / authority class / read status / bundle | `/Users/yk/PASSAI-CAREER/lib/careerSourceData/types.ts` |
| Context origin（server / bridge） | `/Users/yk/PASSAI-CAREER/app/api/career/consultation/resolveContextInputs.ts` |
| Orchestrator（Stage 2） | `/Users/yk/PASSAI-CAREER/lib/careerContext/orchestrator.ts` |
| pure selector（Stage 2）| `/Users/yk/PASSAI-CAREER/lib/careerMemory/selector.ts` / `snapshot.ts` |

翻訳にあたっての受験版固有の差分:

- 受験版は class 2 を最初から 2 kind 持つ（CAREER は 1 kind）。
- 受験版は Layer 2 を DB へ永続化しない（`E-P2`）。
- `ExamContextOrigin` は CAREER の 2 値に `not_server_capable` を足した 3 値。
  `EXAM_SPINE_ARCHITECTURE.md` §6 が structural bridge（`statementDraft` / `analyzeState`）を
  safety fallback と区別して観測することを要求しているため。

---

## Runtime dependency prohibition（`E-L6`）

> **`lib/examSpine/**` は CAREER の table / env / auth / runtime module を絶対に含めない。**

CAREER の**ファイルパスをコメントに書くこと**だけが許可される。禁止語（`NEXT_PUBLIC_CAREER_` /
`CAREER_SUPABASE` / `career_profiles` / `career_activities` / `career_values` /
`career_personal_memory` / CAREER の Supabase project ref）はゼロであることを
`npm run qa:examSpine:stage1` が機械的に検証する。

## Product / Supabase boundary

| | EXAM（このリポジトリ） | CAREER |
|---|---|---|
| repository | `github.com/surf0427/PASSAI.git` | `/Users/yk/PASSAI-CAREER` |
| Supabase project | `oarzldvteiuyuwkdoauq` | 別 project（参照しない） |
| env 名前空間 | `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` | 別名前空間（参照しない） |

---

## QA

```bash
npx tsc --noEmit
npx eslint lib/examSpine
npm run qa:examSpine:stage1            # Stage 1 contract checks
npm run qa:examSpine:characterization  # Stage 0 baseline が不変であること
```

`qa:examSpine:stage1` が検証すること:

- `ExamSourceKind` / `ExamContextPurpose` に重複が無い
- `EXAM_SOURCE_AUTHORITY` / `EXAM_SOURCE_TABLES` / `EXAM_CONTEXT_REGISTRY` /
  `EXAM_CONTEXT_BUDGETS` が全 kind / 全 purpose を過不足なく 1 度ずつ覆う
- authority class 1 = 8 kind / class 2 = 2 kind（`EXAM_SPINE_ARCHITECTURE.md` §3 と一致）
- `maxContextChars` が finite かつ > 0 で、`budget.ts` の値と一致する
- `profileTarget` が付くのは `profile: 'include'` の purpose だけ
- `lib/examSpine/**` に CAREER runtime 依存がゼロ
- production runtime（`app/**` / `lib/**`）からの `examSpine` import がゼロ
