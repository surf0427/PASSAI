# Cleanup Phase Summary — API 軽量化 / Page・Fix 整理フェーズ

## 1. 目的

PASSAI の大規模 UX 改善が完了した後に走らせた **コード整理フェーズ** の現在状態を 1 枚にまとめる。完了済み STEP、確立した canonical pattern、品質指標、残タスク、観測待ち項目、次フェーズ候補を一目で把握できる位置にする。本 doc は **runtime code を一切変更しない** index 性の summary で、各章は対応する audit doc / commit に link する。

関連:
- [`page_fix_audit.md`](./page_fix_audit.md) — `react-hooks/set-state-in-effect` audit の正本
- [`exhaustive_deps_audit.md`](./exhaustive_deps_audit.md) — `react-hooks/exhaustive-deps` audit の正本
- [`../observability/api_observability_audit.md`](../observability/api_observability_audit.md) — API 軽量化フェーズの観測整理
- [`incremental_refactor_policy.md`](./incremental_refactor_policy.md) — 整理ポリシーの正本
- [`ai_policy.md`](./ai_policy.md) — prompt / cache identity / PROMPT_VERSION の不変条件

---

## 2. フェーズ概観

```
STEP-LIB-01..06          → 共通 helper / SYSTEM_PROMPT lift
STEP-PAGE-01..06         → 大型 page.tsx の inline component 切り出し
STEP-PAGE-05b/06b        → 追加 leaf 切り出し
STEP-API-MEASURE/CACHE/  → prompt caching / timeout / partial-fail / observability
   TIMEOUT/OBSERVABILITY/
   MATCHING/AUDIT-02
STEP-PAGE-FIX-01..03     → set-state-in-effect / exhaustive-deps / no-unused-vars 整理
```

各 STEP は 1 commit に対応し、上から下に時系列順。次節以降で内容を整理。

---

## 3. API 軽量化フェーズ

### 3.1. 完了済み STEP

| STEP | 内容 | commit |
|---|---|---|
| STEP-API-MEASURE-01 | API route 単位の現在 token / latency / 失敗パターンの観測手法整理 | （docs 整備のみ、code 変更なし） |
| STEP-API-CACHE-01 | `statement-review` / `statement-analysis` で Anthropic prompt caching (`cache_control: ephemeral`) 有効化 | `d43ae1e Enable prompt caching for statement review and analysis` |
| STEP-API-CACHE-02 | `summarize` / additional analysis 系で prompt caching 拡張 | `4c25955 Enable prompt caching for summarize and additional analysis` |
| STEP-API-CACHE-NOTE-01 | prompt caching コメント整備 (各 route のヘッダコメント明示) | `b9c1b73 Update prompt caching documentation comments` |
| STEP-API-TIMEOUT-01 | `lib/aiTimeout.ts` 新設 (`DEFAULT_AI_TIMEOUT_MS=60_000` / `createTimeoutSignal` / `isAbortError`)、AI route に `AbortSignal.timeout` を適用 | `db7642d Add timeout handling to AI API routes` |
| STEP-API-OBSERVABILITY-01 | `lib/aiUsageLog.ts` の `AiUsageTokens` 型に `cache_creation_input_tokens` / `cache_read_input_tokens` を optional 追加、各 route で `logAiUsage` に渡す | `38f841a Record prompt cache token usage` |
| STEP-API-MATCHING-01 | `app/api/matching/route.ts` を `Promise.all` → `Promise.allSettled` 化、response shape に `partial` / `successfulCandidates` / `failedCandidates` を optional 追加 | `f36e3bc Handle partial failures in matching API` |
| STEP-API-AUDIT-02 | API 軽量化フェーズの KPI / 観測項目 / 次 STEP 発火条件を audit doc に固定 | `4d53723 Add API observability audit documentation` |

### 3.2. 観測待ち（本番ログ 1〜2 週間）

[`../observability/api_observability_audit.md`](../observability/api_observability_audit.md) の §「次の発火条件」に従い、以下は **本番ログ 1〜2 週間収集後に判定**:

- **STEP-API-INTERVIEW-01** (検討中): `interview-feedback` の system prompt 圧縮。cache hit 率と latency を実測してから着手判定。
- **Opus → Sonnet downgrade**: 一部 route の cost optimization。観測で品質劣化リスクが許容範囲内か確認後。
- **再 throttle / cache TTL 調整**: 本番アクセスパターンが見えてから。

### 3.3. 不変条件（守られた）

- `PROMPT_VERSION` bump 0 件
- `SYSTEM_PROMPT` 文字列 SHA-256 byte-identical (STEP-LIB-03..06 の lift で `scripts/` ベリフィケーション済み)
- `lib/aiInputHash.ts` の hash 関数 / cache key 形式 不変
- `request payload` / `response parse` / `validation logic` / `fallback logic` 不変
- `model` 文字列 不変

---

## 4. Page / Fix 整理フェーズ

### 4.1. pure props component 切り出し

| STEP | 切り出し対象 | 切り出し先 | commit |
|---|---|---|---|
| STEP-LIB-01 | `getStudentProfileFromRequest` helper | `lib/` 共通化 | `5321f4c Refactor StudentProfile request fallback helper` |
| STEP-LIB-02 | `lib/aiInputHash.ts` の feature 別分割 | `lib/aiInputHash/` 配下 | `5d36f32 Split AI input hash definitions by feature` |
| STEP-LIB-03..06 | 大型 AI route の SYSTEM_PROMPT lift (interview-feedback / essay-review / essay-chat / essay-improve-summary) | route file 冒頭の module-level const | `c9dd87a`, `810f372`, `7b555c1`, `989e690` |
| STEP-PAGE-01 | `statement/prepare/university/page.tsx` の SelectUniversityStep / AnswerStep / SummaryStep | `./components/` | `7e7435f Extract university prepare page components` |
| STEP-PAGE-02 | `self-analysis/run/page.tsx` の inline component 切り出し | `./components/` | `59b82a2 Extract self analysis run page components` |
| STEP-PAGE-03 | `statement/improve/rewrite/[id]/page.tsx` の leaf component | `./components/` | `c7371cb Extract statement rewrite page components` |
| STEP-PAGE-04 | `essay/improve/[wid]/rewrite/page.tsx` の GuardScreen | `./components/` | `a1e86e7 Extract essay rewrite guard screen` |
| STEP-PAGE-05 | `self-pr/page.tsx` の EmptyState | `app/self-pr/components/EmptyState.tsx` | `e00c78c Extract self pr empty state component` |
| STEP-PAGE-05b | `self-pr/page.tsx` の PrListItem | `app/self-pr/components/PrListItem.tsx` | `b95491b Extract self PR list item` |
| STEP-PAGE-06 | `essay-practice/page.tsx` の MiniThoughtFields | `app/essay-practice/components/` | `260db89 Extract essay practice mini thought fields` |
| STEP-PAGE-06b | `essay-practice/page.tsx` の BodyInputFields | `app/essay-practice/components/BodyInputFields.tsx` | `c3d4344 Extract essay practice body step` |

すべて **pure props rendering**（state / useEffect / useRef / fetch / router / storage を持たない leaf）として切り出し、parent から id 引数で callback を closure する form。

### 4.2. set-state-in-effect 整理（STEP-PAGE-FIX-01 / 02 系）

| STEP | 対象 | pattern | commit |
|---|---|---|---|
| STEP-PAGE-FIX-01 | `app/admission-matching/page.tsx` pre-existing 違反 | matchingInput useState → useMemo (mount gate) | `e60c8ba Fix matching page state initialization` |
| STEP-PAGE-FIX-02 audit | `react-hooks/set-state-in-effect` 13 disable block を inventory + A/B/C 分類 | docs 整備 | `13c3838 Audit set-state-in-effect violations` |
| STEP-PAGE-FIX-02-PREPARE | `app/statement/prepare/page.tsx` follow-up answers | draft override pattern (§5-A) | `bb988e5 Derive statement prepare follow-up answers` |
| STEP-PAGE-FIX-02-HISTORIES-SCORE | `app/statement/score/page.tsx` | version-counter pattern (§5-B) | `007c16f Derive statement score history` |
| STEP-PAGE-FIX-02-HISTORIES-IMPROVE | `app/statement/improve/page.tsx` | version-counter pattern | `ac7865f Derive statement improve history` |
| STEP-PAGE-FIX-02-HISTORIES-EDIT | `app/statement/edit/page.tsx` (prepareHistory block) | version-counter pattern | `61e0062 Derive statement edit prepare history` |
| STEP-PAGE-FIX-02-HOME | `app/home/page.tsx` 6-setter mount effect | derived initial state + isolated navigation effect (§5-C) | `f088214 Derive home page initial state` |
| STEP-PAGE-FIX-02-NOTE | audit doc を post-移行状態に更新 | docs 整備 | `c1a4cd6 Update page fix audit status` |
| STEP-PAGE-FIX-02-PREPARE-UNIVERSITY | `app/statement/prepare/university/page.tsx` | version-counter pattern | `ae8bd4e Derive statement prepare university history` |

**Category B (hydration-safe mount init): audit 時 6 件 → 現在 0 件**。残 7 ブロックはすべて Category C (intentional state synchronization)。

### 4.3. exhaustive-deps 整理（STEP-PAGE-FIX-03 系）

| STEP | 対象 | 内容 | commit |
|---|---|---|---|
| STEP-PAGE-FIX-03-EXHAUSTIVE-DEPS | `app/statement/edit/page.tsx:334` (block #9 form prefill `searchParams` missing dep) | intentional one-shot として `// eslint-disable-next-line` + rationale コメント追加、[`exhaustive_deps_audit.md`](./exhaustive_deps_audit.md) 新設 | `bb89f2e Audit exhaustive deps warnings` |
| STEP-PAGE-FIX-03-NO-UNUSED-VARS | `app/interview/questions/utils/generateAdditionalQuestions.ts:110` `_basicInfo` 未使用引数 | 引数削除 + caller 引数削除 + `BasicInfo` import 削除 | `429d608 Remove unused lint warning` |

### 4.4. project-wide ESLint 0 warning 到達

```
npx eslint app components hooks
→ 0 errors / 0 warnings
```

- `react-hooks/set-state-in-effect`: 0 active (全違反は block-scoped disable で intentional 化、Category C 7 件は維持判定)
- `react-hooks/exhaustive-deps`: 0 active
- `@typescript-eslint/no-unused-vars`: 0 active
- TypeScript: `npx tsc --noEmit` clean

---

## 5. 確立した canonical patterns

詳細は [`page_fix_audit.md`](./page_fix_audit.md) §9 と [`exhaustive_deps_audit.md`](./exhaustive_deps_audit.md) §8 参照。本 doc では呼称と適用先のみ。

### 5-A. useSyncExternalStore mount gate（基盤）

```ts
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;
const isMounted = useSyncExternalStore(subscribeMount, getMountedSnapshot, getMountedServerSnapshot);
```

projects で SSR/CSR hydration セーフな storage 読み出しの基盤。下記 5-A〜5-D の全 pattern が依存する。

### 5-B. draft override pattern（user 入力あり）

`storage 由来の restored` を base にし、編集中だけ `draft` が override する。

**採用**: `statement/prepare/page.tsx`。

### 5-C. version-counter pattern（delete / append のみ、user 入力なし）

`storage を source of truth` として `useMemo` で derive、外部 mutation 時に `setVersion((v) => v + 1)` で再評価をトリガ。

**採用**: `statement/score`, `statement/improve`, `statement/edit` (prepareHistory), `statement/prepare/university`（4 page で同形）。

### 5-D. derived initial state + isolated navigation effect

mount-init で複数 storage を読み + 条件不一致なら redirect する page。setState を伴わない side-effect-only useEffect で navigation だけを切り出し、`isLoading` 専用 state は `!isMounted` で代替。

**採用**: `home/page.tsx`。

### 5-E. read-only derive（軽量、外部 mutation なし）

外部 mutation 経路がない storage 値の単純 derive。

**採用**: `self-analysis/run`, `essay-practice`, `admission-matching`, `statement/edit` の wallHitting/activities/prepareSummary 派生 等多数。

### 5-F. scoped eslint-disable + rationale（intentional の明示化）

`block`/`line` の小さい scope に絞り、必ず「何が起きると壊れるか」を 1〜2 行で書く。`page_fix_audit.md` / `exhaustive_deps_audit.md` への back-link を comment に置く。

**採用**: `statement/edit:334` (intentional one-shot mount prefill), `self-pr:146-294` / `:302-350` (URL routing + replay 回避)。

### 5-G. intentional one-shot mount prefill

`useEffect(() => { /* searchParams / router を 1 回 read */ }, [])` + line-level disable + rationale。新規追加時のテンプレ。

**採用**: `statement/edit` block #9。

---

## 6. 現在の品質状態

| 指標 | 値 |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint app components hooks` | 0 errors / 0 warnings |
| `react-hooks/set-state-in-effect` warning | 0（disable block は intentional のみ 7 ブロック） |
| `react-hooks/exhaustive-deps` warning | 0 |
| `@typescript-eslint/no-unused-vars` warning | 0 |
| PROMPT_VERSION bump | 0 (フェーズ全体で 0 件) |
| SYSTEM_PROMPT byte-identical 確認 | 全 lift で SHA-256 検証済み |
| cache identity (input hash) drift | 観測されず |
| storage 形式変更 | 0 件 |
| API route signature 変更 | matching の partial fail 拡張のみ (optional field 追加、後方互換) |

「runtime UX を一切触らずに整理しきる」原則が守られた状態。

---

## 7. 残タスク

### 7.1. API フェーズ（観測待ち）

- 本番ログ **1〜2 週間** 収集後に判定:
  - `STEP-API-INTERVIEW-01`: interview-feedback の system prompt 圧縮
  - Opus → Sonnet downgrade 候補 (一部 route)
  - cache TTL / 再 throttle 調整
- KPI / 観測項目は [`../observability/api_observability_audit.md`](../observability/api_observability_audit.md) §「次の発火条件」に固定済み

### 7.2. Page / Fix フェーズ（観測 / 時限）

- **STEP-PAGE-FIX-04-CATEGORY-C-REVISIT** (将来): set-state-in-effect Category C 7 ブロックを **6 ヶ月後に再 audit**。autosave / migration / async sync 系は時間経過で別パターンに置換できる可能性。
- 同タイミングで `exhaustive-deps` 既存 disable D1/D2 (self-pr) も合わせて re-audit。
- 大型 page (e.g. `statement/edit/page.tsx` 600+ 行) の追加抽出は **別フェーズ**。今フェーズの 3-file boundary / 30% rule (整理ポリシー) を逸脱するため未着手。

### 7.3. 構造系（未着手）

- AI 化拡張枠: `generateAdditionalQuestions` の AI mode、`statement/prepare/university` の `generationMode: 'ai'` 切替（コメントに「将来 STEP」明記済み）
- Supabase migration (Phase 1 boundary): フリーズ維持。フェーズが切り替わるまで storage 形式変更禁止
- 受験チューターAI (`/tutor`) の content 改善

---

## 8. 次の推奨フェーズ候補

複数候補があるが、相互排他ではない。観測待ちと並走できるものを **括弧内に並走可否** で示す。

| 候補 | 内容 | 並走可 | 状態 |
|---|---|---|---|
| **A. UX 最終確認** | 本番導線を端から端まで通し、edge case / empty state / error 表示の最終調整 | yes (観測と並走) | 🟢 進行中 — UX audit phase 1 + UX fix STEP 8 件完了で release blocker S-01/02/03 解消。残: release QA pass + real user test (詳細は [`../ux/ux_audit_phase1.md`](../ux/ux_audit_phase1.md) §14) |
| **B. 受験相談AI 改善** | `/tutor` の content / prompt / UX 整備。新規機能ではなく既存 page の磨き込み | yes | ⬜ 未着手 |
| **C. LP / marketing / release checklist** | 公開前チェック。analytics、SEO、OG image、release notes | yes | ⬜ 未着手 |
| **D. API 観測ログ収集準備** | 本番 log destination / dashboard / alert wiring。観測フェーズ自体の準備 | yes (推奨先行) | ⬜ 未着手 |
| **E. interview-feedback 圧縮 (API)** | STEP-API-INTERVIEW-01 の本実装 | **観測 1〜2 週間後** | ⬜ 観測待ち |
| **F. Opus downgrade** | 一部 route の model 切替 | **観測 1〜2 週間後 + 品質検証** | ⬜ 観測待ち |
| **G. 大型 page 抽出 (継続)** | edit/score 等の追加切り出し | yes (中規模 STEP) | ⬜ 未着手 |

**推奨着手順**: A の残 (release QA pass + real user test) を release 前に消化。並行して D (観測準備) を進める。B / C は release 直前 / 直後。E / F は観測後。G は工数次第。

---

## 8b. UX fix フェーズ (STEP-UX-AUDIT-01 後の実装)

[`../ux/ux_audit_phase1.md`](../ux/ux_audit_phase1.md) の Top10 / release blocker に対する 8 件の STEP を順次実施。runtime UX を改善するが、本フェーズも **PROMPT_VERSION / cache identity / storage 形式 / API route shape を一切変更しない** 不変条件を維持。詳細状況は audit doc §14 を正本とし、本 summary には commit 一覧のみ載せる。

| STEP | commit | 主な変更 |
|---|---|---|
| STEP-UX-AUDIT-01 | `de1b906` | audit doc 作成 (`docs/ux/ux_audit_phase1.md`) |
| STEP-UX-FIX-01-ALERT | `1acd017` | `/statement/edit` の保存 alert → self-contained toast |
| STEP-UX-FIX-02-STATEMENT-NEXT-ACTION | `0ec5f83` | `ReviewResultView` に 3-button next-action bar |
| STEP-UX-FIX-04-CONFIRM-DIALOG | `0eeec50` | `components/ui/ConfirmDialog.tsx` 新設 + 4 caller 置換 |
| STEP-UX-FIX-05-HUB-SUGGEST | `4796364` | `statement` / `self-analysis` / `interview` hub に next-step suggestion |
| STEP-UX-FIX-06-LOADING-PROGRESS | `e8653f3` | `components/ui/LoadingProgress.tsx` 新設 + 2 caller |
| STEP-UX-FIX-06b-LOADING-PROGRESS-EXTEND | `38a625a` | `LoadingProgress` を主要 4 flow に横展開 |
| STEP-UX-FIX-06c-CANCEL-WIRING | `0067317` | `AbortController` + cancel button (`/statement/edit` + `/admission-matching`) |
| STEP-UX-FIX-06d-CANCEL-TAP-TARGET | `104dc7c` | cancel button を mobile 44px tap target に底上げ |

**release blocker 解消状態**: S-01 / S-02 / S-03 すべて主要 flow で解消。残タスクは release 後の品質向上 (詳細は audit doc §14.4)。

---

## 9. 観測項目の不変条件

本 summary doc を再生成 / 更新するとき、以下を **絶対に変更しない**:

- 既出 audit doc (`page_fix_audit.md` / `exhaustive_deps_audit.md` / `api_observability_audit.md` / `../ux/ux_audit_phase1.md`) の判定結果 (本 doc は index に徹し、判定の上書きはしない)
- フェーズ全体の不変条件 (§3.3 / §6 / §8b の指標) と矛盾する記述
- PROMPT_VERSION / cache identity / storage 形式

矛盾を見つけたら **audit doc を先に直し、その上で本 doc を更新** する。本 doc が単独で先行することはない。

---

## 10. 関連 doc

- [`page_fix_audit.md`](./page_fix_audit.md)
- [`exhaustive_deps_audit.md`](./exhaustive_deps_audit.md)
- [`../observability/api_observability_audit.md`](../observability/api_observability_audit.md)
- [`incremental_refactor_policy.md`](./incremental_refactor_policy.md)
- [`ai_policy.md`](./ai_policy.md)
- [`ai_cache_observability.md`](./ai_cache_observability.md)
- [`ai_usage_observability.md`](./ai_usage_observability.md)
- [`feedback_dev_principles.md`](./feedback_dev_principles.md)
