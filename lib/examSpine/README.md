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
| 1 | types + purpose registry（誰も呼ばない） | 完了 |
| **2** | **Orchestrator（純関数・byte 一致）** | **← 現在地** |
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

  blocks/             ── Stage 2 ──
    types.ts          Layer 2。ExamContextBlock / ExamDataProvenance / presence
    registry.ts       block id → provenance / derivation / heading 所有者 / legacy 実装位置
    build.ts          Layer 2 builder。現行の共有 formatter を呼んで block にする
  orchestrator/
    input.ts          Layer 2 の入力 container（Stage 3 の reader とは無関係）
    plan.ts           Layer 3 / 4 / 5。purpose ごとの選択・順序・render contract
    render.ts         Layer 5。block 列 → 1 本の文字列
    assemble.ts       select / order と pipeline entry（assembleExamContext）
```

依存の向きは一方向で、循環しない。

```text
purpose.ts ──▶ budget.ts ──▶ types.ts
sourceData/types.ts（独立）

orchestrator/assemble.ts ──▶ orchestrator/plan.ts ──▶ blocks/types.ts ──▶ types.ts
                         ├─▶ orchestrator/render.ts
                         └─▶ blocks/build.ts ──▶ blocks/registry.ts
                                              └─▶ 既存の共有 formatter（lib/** の純関数）
```

### Stage 2 pipeline

```text
ExamContextInput
  ↓ buildExamContextBlocks()      Layer 2  全 block を組み立てる
  ↓ selectExamContextBlocks()     Layer 3  purpose policy で選ぶ
  ↓ orderExamContextBlocks()      Layer 4  purpose plan の宣言順に並べる
  ↓ renderExamContext()           Layer 5  heading / separator / placeholder / trim
  → string
```

Stage 2 の設計上の要点:

- **block content は書き直さない。** heading や区切りの持ち方（`headingOwner`）だけを宣言し、
  文字列そのものは既存の共有 formatter（`buildBasicInfoPromptSection` など）に委ねる。
  同じ section を route ごとに別実装しないことが Stage 2 の目的だから、Spine 側で再実装すると
  実装が 3 つ目になってしまう。
- **module-private な legacy helper だけは写経する。**（`statementPrompt.ts` の
  `buildActivityContext` など）。legacy に `export` を足すのは production diff なので行わない。
  写経ズレは byte-equivalence QA が検出する。
- **render contract を安易に一般化しない。** `.trim()` / `.filter(Boolean)` / `.join('\n\n')` は
  purpose ごとに実際の挙動が違う。`plan.render` が `null` の purpose は「まだ byte 検証済みの
  contract を持たない」であって「同じだろう」ではない。
- **budget を enforce しない。** Stage 1 の budget はほとんどが `observed_only`（実測値）で
  enforcement contract ではないため、Stage 2 では参照するだけで truncate / drop をしない。

### provenance を block 単位で持つ理由

`essay_workspaces` には「本人が書いた本文」と「AI の添削結果」が同居する。
`essay = ai_derived` のような **SourceKind 単位のラベルは必ず誤りになる**ため、
provenance は block に付ける。加えて `derivation`（verbatim / deterministic / generative）を
別軸で持ち、「AI 生成物（`ai_derived`）を決定論的に整形した block」と
「AI を使わない決定論統計」を混同しないようにしている。

`mixed` は「1 つの legacy section に 2 系統が融合していて、byte を変えずには分割できない」
場合だけに使い、`registry.ts` の `mixedReason` に理由を必ず書く（現在 5 block）。

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

### Stage 1 で作らず Stage 2 で置いた型 — `ExamDataProvenance`

`EXAM_SPINE_ARCHITECTURE.md` §9 が要求する「AI 派生ラベル」は Layer 2 の **出力 block**
に付くものであり、Source kind に付くものではない。kind 単位に 1 ラベルを割り当てると
`essay`（本人の本文 + AI レビューが同じ `essay_workspaces` に同居）などで嘘になるため、
Stage 1 では意図的に作らず、block contract を導入する Stage 2 に置いた
（「消費者ゼロの型を先に作らない」＝ `E-P1` / `incremental_refactor_policy.md`）。

Stage 1 時点の想定は `user_confirmed` / `deterministic` / `ai_derived` の 3 値だったが、
Stage 2 では **2 軸**に分けた。1 軸に混ぜると「AI が生成した StudentProfile を決定論的に
整形した block」と「AI を使わない決定論統計」が同じラベルになり、区別できなくなるため。

| 軸 | 値 | 意味 |
|---|---|---|
| `provenance` | `user_authored` / `ai_derived` / `system_metadata` / `mixed` | 誰の情報か |
| `derivation` | `verbatim` / `deterministic` / `generative` | その文字列がどう作られたか |

`ExamContextOrigin`（server / bridge / not_server_capable ＝ **どこから取ったか**）とは
直交する別軸であり、混同しない。

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
npm run qa:examSpine:stage2            # Stage 2 contract + byte-equivalence
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

`qa:examSpine:stage2` が検証すること:

- Stage 1 の語彙が不変（purpose 17 / source kind 10）
- block id と `EXAM_CONTEXT_BLOCK_REGISTRY` が 1:1 で、`mixed` には理由がある
- purpose plan の block が Stage 1 policy と矛盾しない
  （`exclude` と宣言した区分の block が混ざっていない / `admission_focus` は
  `university: 'admission_focus'` の purpose だけが持つ）
- **byte-equivalence**: 現行の prompt builder を実際に import して呼び、
  Spine pipeline の出力と `===` で比較する（normalize / trim / snapshot 更新をしない）
- pipeline が `Date` / `Math.random` に触れない（実際に throw する stub を差して確認）
- budget を超える入力でも truncate しない
- production runtime からの `examSpine` import が 0 本 / CAREER 依存が 0 / network call 0 / AI SDK 未ロード
