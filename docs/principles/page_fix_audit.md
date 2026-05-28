# Page Fix Audit — `react-hooks/set-state-in-effect` 違反の分類

## 1. 目的

STEP-PAGE-FIX-01 で admission-matching/page.tsx の pre-existing 違反を解消したのを契機に、project 全体の `react-hooks/set-state-in-effect` 違反を網羅し、「修正すべき」「意図的に許容する」を分類する。STEP-PAGE-FIX-02 で audit を取り、その後の **STEP-PAGE-FIX-02-{PREPARE, HISTORIES-SCORE, HISTORIES-IMPROVE, HISTORIES-EDIT, HOME}** で category B の主要候補を canonical pattern に移行済み。本 doc は audit + 移行後の最新状態を反映する。

関連:
- STEP-PAGE-FIX-01（admission-matching の修正例）
- STEP-PAGE-FIX-02-PREPARE / -HISTORIES-{SCORE, IMPROVE, EDIT} / -HOME（category B → canonical pattern 移行）
- [`docs/principles/incremental_refactor_policy.md`](./incremental_refactor_policy.md) — 整理ポリシーの正本

---

## 2. 計測手法

```bash
npx eslint app components hooks
```

**現状**: project-wide eslint で `react-hooks/set-state-in-effect` の **error / warning 件数はゼロ**。全違反は **block-scoped `/* eslint-disable react-hooks/set-state-in-effect */` で正当化済み**。

```bash
grep -rnE "eslint-(disable|enable).*react-hooks/set-state-in-effect" app/ components/ hooks/
```

**結果**: **8 disable / enable ペア（7 ファイル）**。STEP-PAGE-FIX-02 audit 時点の **13 ペア / 11 ファイル** から、5 ペアが canonical pattern 移行により撤去済み。

| audit 時 | 移行後（現在） | 撤去された block |
|---|---|---|
| 13 ペア / 11 file | 8 ペア / 7 file | #1 home / #5 prepare / #7 score / #8 edit-prepareHistory / #10 improve |

---

## 3. 違反 inventory（最新）

| # | ファイル | 行範囲 | 内容（setter） | エフェクト依存 | 分類 | 状態 |
|---|---|---|---|---|---|---|
| 1 | `app/home/page.tsx` | — | `setBasicInfo` / `setStatuses` / `setIsLoading` | — | — | ✅ **撤去済**（STEP-PAGE-FIX-02-HOME, commit `f088214`） |
| 2 | `app/admission-matching/page.tsx` | L210-218 | `setHasCachedResult` / `setCachedTimestamp` | `[]`（mount） | **B** | 維持 |
| 3 | `app/self-pr/page.tsx` | L146-294 | `setSelfPRs` / `setUsage` / `setHasSelfAnalysis` / `setOpenedFromRun` 等 + legacy drain + seed prefill + `router.replace` | `[]`（mount） | **C** | 維持 |
| 4 | `app/self-pr/page.tsx` | L302-350 | mode=direct リアクティブ。前 session state 全消し + `openPR` + `router.replace` | `[modeParam]` | **C** | 維持 |
| 5 | `app/statement/prepare/page.tsx` | — | `setFollowUpAnswers(getStatementPrepareFollowUpAnswers())` | — | — | ✅ **撤去済**（STEP-PAGE-FIX-02-PREPARE, commit `bb988e5`、draft override pattern） |
| 6 | `app/statement/prepare/university/page.tsx` | L113-117 | `setHistory(loadUniversityPrepareHistory())` | `[]`（mount） | **B** | 維持 |
| 7 | `app/statement/score/page.tsx` | — | `setHistory(loadReviewHistory())` | — | — | ✅ **撤去済**（STEP-PAGE-FIX-02-HISTORIES-SCORE, commit `007c16f`、version-counter pattern） |
| 8 | `app/statement/edit/page.tsx` (prepareHistory) | — | `setPrepareHistory(loadUniversityPrepareHistory())` | — | — | ✅ **撤去済**（STEP-PAGE-FIX-02-HISTORIES-EDIT, commit `61e0062`、version-counter pattern） |
| 9 | `app/statement/edit/page.tsx` (form prefill) | L297-335 | form 入力 prefill（u/f/d/statementText）+ `setRemainingCount` + `setPrepareFollowUps` + `setRewriteContext` | `[]`（mount） | **C** | 維持 |
| 10 | `app/statement/improve/page.tsx` | — | `setHistory(loadReviewHistory())` | — | — | ✅ **撤去済**（STEP-PAGE-FIX-02-HISTORIES-IMPROVE, commit `ac7865f`、version-counter pattern） |
| 11 | `app/statement/improve/rewrite/[id]/page.tsx` | L204-216 | autosave baseline tracking：`setMemo` / `setWorkAnswers` / `setLastSavedAt` + `initialMemoRef.current` / `initialWorkRef.current` | `[entry.id]` | **C** | 維持 |
| 12 | `app/self-analysis/resume/page.tsx` | L62-83 | legacy migration `persistSelfAnalysisLog` + `setLogs` / `setSelectedLogId` | `[]`（mount） | **C** | 維持 |
| 13 | `app/self-analysis/run/page.tsx` | L228-236 | `[freshAnalysis]` reactive：`setSummary(null)` / `setDisplayedQuestions` / `setAnswers` / `setDeepAnswers` / `setStep('answering')` | `[freshAnalysis]` | **C** | 維持 |

---

## 4. 分類定義（最新）

### A: genuine bug risk（修正優先）

**現状: 該当なし（0 件）**

### B: hydration-safe mount initialization（許容、長期の構造改善候補）

- isMounted gate + localStorage restore
- 単一 / 少数 setter で機能的に derived
- 将来的に canonical pattern（§9）へ移行可能

**該当**: #2, #6（**2 件**、audit 時 6 件 → 移行で 4 件削減）

特徴:
- ほぼ「mount に storage を 1 度読む」だけ
- #2 admission-matching: cache hit/timestamp は state のままが現実的（cache 操作からも再 sync が必要だが、現状コードでは mount のみで write side-effect 無し）
- #6 statement/prepare/university: delete handler から `setHistory(loadXxx())` で再 sync する形式 → version-counter pattern が適用可能だが、未着手

### C: intentional state synchronization（低優先）

**該当**: #3, #4, #9, #11, #12, #13（**6 件**、audit 時 7 件 → 移行で 1 件削減 = #1 home）

特徴:
- 多数の setter を 1 effect に集約しており、分離すると render timing が変わる
- URL routing / async system completion / 外部 storage write / autosave baseline が絡む
- 構造変換すると invariant が破綻するか、複雑度が増えるだけ

---

## 5. 各違反への推奨対応（最新）

| # | 推奨対応 | 修正コスト | UX リスク |
|---|---|---|---|
| 2 admission-matching | 維持（STEP-PAGE-FIX-01 で整流済み・最小サイズ） | ─ | ─ |
| 3, 4 self-pr | 維持（URL routing + prefill consumption が密。分解すると seed 重複作成 / redirect replay リスク） | 高 | 中 |
| 6 statement/prepare/university | version-counter pattern で derived 化可能（同パターン適用済の SCORE / IMPROVE / EDIT-prepareHistory と同形）。**次候補**（§11） | 中 | 低 |
| 9 statement/edit form prefill | hydration-critical な form value SSR/CSR 一致を維持しつつ rewriteFrom 由来の prefill を実行する genuine side-effect。**維持**。 | 高 | 高 |
| 11 statement/improve/rewrite/[id] | autosave 三位一体は STEP-PAGE-03 で意図的に温存。**維持**。 | 高 | 高 |
| 12 self-analysis/resume | legacy 1 回 migration を含む genuine write side-effect。**維持**。 | 高 | 中 |
| 13 self-analysis/run | useWallHitting hook の async 完了通知に対する state 遷移。await 後の関数本体に置けず、genuine side-effect として隔離済み。**維持**。 | 高 | 高 |

---

## 6. 完了済み STEP（STEP-PAGE-FIX-02 系列）

| STEP | 対象 file | pattern | commit |
|---|---|---|---|
| STEP-PAGE-FIX-02-PREPARE | `app/statement/prepare/page.tsx` | draft override pattern (§9-A) | `bb988e5 Derive statement prepare follow-up answers` |
| STEP-PAGE-FIX-02-HISTORIES-SCORE | `app/statement/score/page.tsx` | version-counter pattern (§9-B) | `007c16f Derive statement score history` |
| STEP-PAGE-FIX-02-HISTORIES-IMPROVE | `app/statement/improve/page.tsx` | version-counter pattern (§9-B) | `ac7865f Derive statement improve history` |
| STEP-PAGE-FIX-02-HISTORIES-EDIT | `app/statement/edit/page.tsx` (prepareHistory block) | version-counter pattern (§9-B) | `61e0062 Derive statement edit prepare history` |
| STEP-PAGE-FIX-02-HOME | `app/home/page.tsx` | derived initial state + isolated navigation effect (§9-C) | `f088214 Derive home page initial state` |

5 STEP 完了。category B 6 件 → 2 件、category C 7 件 → 6 件。

---

## 7. hydration-safe と判断した根拠（残 B 級の SSR/CSR 安全性）

| 条件 | 該当 # |
|---|---|
| storage read のみで client navigation の影響なし | #2, #6 |
| SSR/CSR 初回 render が同値（空 / null）に保たれる | #2, #6 |
| 表示は post-mount のみで flicker や hydration mismatch なし | #2, #6 |

→ 残 B 級 2 件はいずれも hydration-safe。conversion せず disable 維持でも runtime risk なし。

---

## 8. dangerous pattern の定義（次回追加時に避けるべき）

新規 useEffect で setState を書くとき、以下のパターンは **避ける**:

| パターン | なぜ危険か | 代替 |
|---|---|---|
| setState in async / await callback within effect | rule は async ブロック内は許容するが、cleanup function 取りこぼし / race condition リスク | event handler に逃がす |
| effect 内で複数 setState を連鎖発火 | cascading render（rerender → effect 再実行）リスク | useMemo / derived state |
| effect 内で setState + 同一 state に依存する deps | 無限ループ | deps の見直し |
| useEffect(() => { setState(loadStorage()) }, []) で SSR-unsafe storage 読み | hydration mismatch | canonical pattern §9 |
| ref と state を一緒に書き換える 1 effect | 三位一体が破綻すると autosave skip ガード等が無効化 | 明示的に「genuine side-effect」と comment 化 + scoped disable |

---

## 9. canonical patterns（projects 内で確立済み）

### 9-A. draft override pattern（user 入力あり、SCORE 系には不適）

ユーザー編集中の入力値が storage の最新と乖離する局面で使う。**storage の値を base とし、編集が始まったら draft が override する**。

```ts
// SSR-stable mount flag
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

const isMounted = useSyncExternalStore(
  subscribeMount, getMountedSnapshot, getMountedServerSnapshot,
);

// storage 値（read-only、isMounted で gate）
const restored = useMemo<T>(
  () => (isMounted ? loadFromStorage() : EMPTY_VALUE),
  [isMounted],
);

// 編集中 draft（null のうちは restored を見せる）
const [draft, setDraft] = useState<T | null>(null);
const value: T = draft ?? restored;

// 入力時
function handleChange(next: T) {
  setDraft(next);
  saveToStorage(next);
}
```

**採用**: `statement/prepare/page.tsx`（STEP-PAGE-FIX-02-PREPARE）。

### 9-B. version-counter pattern（delete のみ・user 入力なし、HISTORIES 系）

storage を source of truth とし、外部経路（delete handler 等）から再評価をトリガする最小コスト pattern。

```ts
const isMounted = useSyncExternalStore(/* §9 module-level 3 const */);

const [version, setVersion] = useState(0);
const items = useMemo<T[]>(() => {
  void version;
  return isMounted ? loadFromStorage() : [];
}, [isMounted, version]);

function handleDelete(id: string) {
  deleteFromStorage(id);
  setVersion((v) => v + 1);
}
```

- `void version;` で `react-hooks/exhaustive-deps` を満足させつつ、version 自体は useMemo body 内で使わない（純粋に再評価トリガとしてのみ機能）
- SSR / 初回 client render は `isMounted=false` で `[]` を返し hydration セーフ

**採用**: `statement/score/page.tsx`、`statement/improve/page.tsx`、`statement/edit/page.tsx`（prepareHistory block）。

### 9-C. derived initial state + isolated navigation effect（home 系、setState なし navigation only）

mount-init で複数 storage を読み、条件不一致なら redirect する page で使う。

```ts
const isMounted = useSyncExternalStore(/* module-level 3 const */);

const basicInfo = useMemo<BasicInfo | null>(
  () => (isMounted ? loadBasicInfo() : null),
  [isMounted],
);
const statuses = useMemo<Record<string, ProgressStatus>>(() => {
  if (!isMounted) return {} as Record<string, ProgressStatus>;
  return {/* pure 計算 */};
}, [isMounted]);

// genuine side-effect (setState なし)
useEffect(() => {
  if (isMounted && !basicInfo) {
    router.replace('/input/basic');
  }
}, [isMounted, basicInfo, router]);

if (!isMounted) return null;
if (!basicInfo) return null; // redirect 中
```

- setState を含まない effect なら `react-hooks/set-state-in-effect` は発火しない
- `isLoading` 専用 state は **不要**（`!isMounted` で代替）
- empty 分岐は object literal narrowing 回避のため `as Record<...>` 明示が必要

**採用**: `home/page.tsx`（STEP-PAGE-FIX-02-HOME）。

### 9-D. read-only derive（既存採用、最も軽量）

mount 後の値が不変で外部 mutation 不要な場合。

```ts
const isMounted = useSyncExternalStore(/* */);
const data = useMemo(
  () => (isMounted ? loadFromStorage() : null),
  [isMounted],
);
```

**採用**: `self-analysis/run`、`statement/prepare/university` の wallHitting/activities/basicInfo 派生、`statement/improve/rewrite/[id]`、`essay-practice`、`admission-matching` (matchingInput)、`statement/edit` の wallHitting/activities/prepareSummary 派生、`input/basic`、`statement/page.tsx`。

---

## 10. 観測項目の不変条件

本 audit ドキュメントは以下を **絶対に変更しない**:

- 残 8 disable block 内の setState 配列（runtime UX に直結）
- `useState` / `useEffect` の依存配列
- mount effect の早期 return 経路
- PROMPT_VERSION / cache identity / storage 形式
- `subscribeMount` / `getMountedSnapshot` / `getMountedServerSnapshot` の 3 const

これらが変わると hydration / autosave / cache 経路が崩れる。

---

## 11. 次の発火条件

以下が観測されたら個別 STEP として発火:

- **STEP-PAGE-FIX-02-PREPARE-UNIVERSITY**: `app/statement/prepare/university/page.tsx` L113-117 を version-counter pattern (§9-B) で derived 化。残 category B の最後の 1 件で、修正コスト 中・UX リスク 低。HISTORIES 系 3 STEP と同形のため再現容易。
- **STEP-PAGE-FIX-03-EXHAUSTIVE-DEPS**: project-wide で残る `react-hooks/exhaustive-deps` warning（現状 1 件: `statement/edit/page.tsx` block #9 form prefill `searchParams` missing dep）の audit。block #9 は intentional sync で「mount 1 回」が invariant のため、修正ではなく `// eslint-disable-next-line` 化または line comment 明記が候補。
- **STEP-PAGE-FIX-03-NO-UNUSED-VARS**: `app/interview/questions/utils/generateAdditionalQuestions.ts:110` `_basicInfo` の no-unused-vars warning 整理（API logic / prompt は不変、helper 引数の cleanup のみ）。
- **STEP-PAGE-FIX-04-CATEGORY-C-REVISIT**: category C 6 件（#3, #4, #9, #11, #12, #13）を 6 ヶ月後に再 audit。autosave / migration / async sync 系は時間経過で別パターンに置換できる可能性。

各 STEP は **本 audit doc の判定に基づき独立に発火**。1 つでも観測 / レビューでリスクが見えたら見送る。

---

## 12. 関連 doc

- [`docs/principles/incremental_refactor_policy.md`](./incremental_refactor_policy.md) — 整理ポリシー / future trigger
- [`docs/principles/feedback_dev_principles.md`](./feedback_dev_principles.md) — 開発方針
- [`docs/observability/api_observability_audit.md`](../observability/api_observability_audit.md) — API 軽量化フェーズの観測整理（並列 audit）
