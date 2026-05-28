# Page Fix Audit — `react-hooks/set-state-in-effect` 違反の分類

## 1. 目的

STEP-PAGE-FIX-01 で admission-matching/page.tsx の pre-existing 違反を解消したのを契機に、project 全体の `react-hooks/set-state-in-effect` 違反を網羅し、「修正すべき」「意図的に許容する」を分類する。今回は **audit のみ**で、runtime 修正は伴わない。次の修正 STEP の発火条件を観測ベースで固定するための土台。

関連:
- STEP-PAGE-FIX-01（admission-matching の修正例）
- [`docs/principles/incremental_refactor_policy.md`](./incremental_refactor_policy.md) — 整理ポリシーの正本

---

## 2. 計測手法

```bash
npx eslint app components hooks
```

**現状**: project-wide eslint で `react-hooks/set-state-in-effect` の **error / warning 件数はゼロ**。全違反は **block-scoped `/* eslint-disable react-hooks/set-state-in-effect */` で正当化済み**。

ただし「disable で正当化」は「将来も触らなくていい」ではない。本 audit ではこれら disable block すべてを inventory し、A / B / C に分類する。

```bash
grep -rnE "eslint-(disable|enable).*react-hooks/set-state-in-effect" app/ components/ hooks/
```

**結果**: 13 disable / enable ペア（11 ファイル）。

---

## 3. 違反 inventory

| # | ファイル | 行範囲 | 内容（setter） | エフェクト依存 | 分類 |
|---|---|---|---|---|---|
| 1 | `app/home/page.tsx` | L188-199 | `setBasicInfo` / `setStatuses`（6 keys）/ `setIsLoading(false)` | `[]`（mount） | **C** |
| 2 | `app/admission-matching/page.tsx` | L210-218 | `setHasCachedResult` / `setCachedTimestamp` | `[]`（mount） | **B** |
| 3 | `app/self-pr/page.tsx` | L146-294 | `setSelfPRs` / `setUsage` / `setHasSelfAnalysis` / `setOpenedFromRun` 等 + legacy drain + seed prefill + `router.replace` | `[]`（mount） | **C** |
| 4 | `app/self-pr/page.tsx` | L302-350 | mode=direct リアクティブ。前 session state 全消し + `openPR` + `router.replace` | `[modeParam]` | **C** |
| 5 | `app/statement/prepare/page.tsx` | L152-157 | `setFollowUpAnswers(getStatementPrepareFollowUpAnswers())` | `[]`（mount） | **B** |
| 6 | `app/statement/prepare/university/page.tsx` | L113-117 | `setHistory(loadUniversityPrepareHistory())` | `[]`（mount） | **B** |
| 7 | `app/statement/score/page.tsx` | L75-79 | `if (isMounted) setHistory(loadReviewHistory())` | `[isMounted]` | **B**（isMounted-gated） |
| 8 | `app/statement/edit/page.tsx` | L222-226 | `if (isMounted) setPrepareHistory(loadUniversityPrepareHistory())` | `[isMounted]` | **B**（isMounted-gated） |
| 9 | `app/statement/edit/page.tsx` | L296-334 | form 入力 prefill（u/f/d/statementText）+ `setRemainingCount` + `setPrepareFollowUps` + `setRewriteContext` | `[]`（mount） | **C** |
| 10 | `app/statement/improve/page.tsx` | L61-65 | `if (isMounted) setHistory(loadReviewHistory())` | `[isMounted]` | **B**（isMounted-gated） |
| 11 | `app/statement/improve/rewrite/[id]/page.tsx` | L204-216 | autosave baseline tracking：`setMemo` / `setWorkAnswers` / `setLastSavedAt` + `initialMemoRef.current` / `initialWorkRef.current` | `[entry.id]` | **C** |
| 12 | `app/self-analysis/resume/page.tsx` | L62-83 | legacy migration `persistSelfAnalysisLog` + `setLogs` / `setSelectedLogId` | `[]`（mount） | **C** |
| 13 | `app/self-analysis/run/page.tsx` | L228-236 | `[freshAnalysis]` reactive：`setSummary(null)` / `setDisplayedQuestions` / `setAnswers` / `setDeepAnswers` / `setStep('answering')` | `[freshAnalysis]` | **C** |

---

## 4. 分類定義

### A: genuine bug risk（修正優先）

- cascading render risk（setState → 別 setState → render → 同 effect で再度 setState…）
- derived state を state 化している（lazy initializer / useMemo / useSyncExternalStore で表現可能）
- mount effect が肥大（複数責務を 1 effect に詰め込みすぎ）
- effect の依存配列が不正確

**現状: 該当なし（0 件）**

13 disable block すべてが load-bearing コメント付きで justification 済み。cascading render を引き起こすパターンは観測されない。

### B: hydration-safe mount initialization（許容、長期の構造改善候補）

- isMounted gate + localStorage restore
- 単一 / 少数 setter で機能的に derived
- 将来的に `useSyncExternalStore + useMemo + version counter` パターンへ移行可能
- 後で外部経路（delete 等）からも同 storage の再 sync が必要 → state のままが現実的

**該当**: #2, #5, #6, #7, #8, #10（**6 件**）

特徴:
- ほぼ「mount に storage を 1 度読む」だけ
- #7, #8, #10 は既に **isMounted-gated**（SSR/CSR mismatch なし、hydration-safe）
- 単一 setter のため scoped disable で十分

### C: intentional state synchronization（低優先）

- 外部システムとの genuine sync（URL / async callback / 外部 mutation）
- ref + state + effect の三位一体（autosave baseline tracking 等）
- write side-effect を含む（migration / persist）
- 構造変換すると invariant が破綻するか、複雑度が増えるだけ

**該当**: #1, #3, #4, #9, #11, #12, #13（**7 件**）

特徴:
- 多数の setter を 1 effect に集約しており、分離すると render timing が変わる
- comment に「lazy init / useMemo / useSyncExternalStore で SSR 安全性が保てない」明記
- URL routing / async system completion / 外部 storage write が絡む

---

## 5. 各違反への推奨対応

| # | 推奨対応 | 修正コスト | UX リスク |
|---|---|---|---|
| 1 home | 6 setter を分解。STEP-PAGE-FIX-01 と同パターンで `setBasicInfo`/`setStatuses` を useMemo 化、`isLoading` を `!isMounted` 化。`statuses` は status 計算が同 effect 内 → useMemo 化で OK | 中 | 低（status 計算は pure） |
| 2 admission-matching | 維持（既に最小サイズ・FIX-01 で整流済み） | ─ | ─ |
| 3, 4 self-pr | 維持（URL routing + prefill consumption が密。分解すると seed 重複作成 / redirect replay リスク） | 高 | 中 |
| 5 statement/prepare | `useMemo(() => isMounted ? getStatementPrepareFollowUpAnswers() : {}, [isMounted])` 化候補。ただし `filledFollowUpAnswers` 派生先が gate 無し描画 → SSR 安全性検証必要 | 低 | 低 |
| 6 statement/prepare/university | history が delete handler でも再 sync される。version counter で derived 化可能だが state 増加。**維持で十分**。 | 中 | 低 |
| 7, 8, 10 statement/score / edit / improve | 同形 3 件。`useMemo + isMounted + version counter` で derived 化、または共通カスタムフック（**user 禁止事項**）。当面は維持 | 中 | 低 |
| 9 statement/edit form prefill | hydration-critical な form value SSR/CSR 一致を維持しつつ rewriteFrom 由来の prefill を実行する genuine side-effect。**維持**。 | 高 | 高 |
| 11 statement/improve/rewrite/[id] | autosave 三位一体は STEP-PAGE-03 で意図的に温存。**維持**。 | 高 | 高 |
| 12 self-analysis/resume | legacy 1 回 migration を含む genuine write side-effect。**維持**。 | 高 | 中 |
| 13 self-analysis/run | useWallHitting hook の async 完了通知に対する state 遷移。await 後の関数本体に置けず、genuine side-effect として隔離済み。**維持**。 | 高 | 高 |

---

## 6. 今すぐ直すべき Top 3

### 1 位: `app/home/page.tsx` L188-199（**唯一の A 寄り C**）

**理由**:
- 6 setter を 1 effect に詰め込んでいる（最重）
- `setBasicInfo` は storage 由来で derived 候補
- `setStatuses` は 6 個の `checkXxxStatus()` の純粋計算 → useMemo 化で行ける
- `setIsLoading(false)` は `!isMounted` 化で除去可能
- 構造改善で disable 自体を除去できる可能性が最も高い

**修正後イメージ**:
```ts
const isMounted = useSyncExternalStore(subscribeMount, getMountedSnapshot, getMountedServerSnapshot);
const basicInfo = useMemo(() => isMounted ? loadBasicInfo() : null, [isMounted]);
const statuses = useMemo(() => isMounted ? {
  '/input/activity':     checkActivityStatus(),
  '/self-analysis':      checkSelfAnalysisStatus(),
  '/admission-matching': checkMatchingStatus(),
  '/statement':          checkStatementStatus(),
  '/essay':              checkEssayStatus(),
  '/interview':          checkInterviewStatus(),
} : EMPTY_STATUSES, [isMounted]);
const isLoading = !isMounted;
```

**懸念**: `router.replace('/input/basic')` の早期 return が `if (!info)` の前に置かれている。effect の早期 return ロジックも一緒に解体する必要があり、scope が広がる可能性。

### 2 位: `app/statement/prepare/page.tsx` L152-157

**理由**:
- 単一 setter のため最も小さい
- 既にコメントで「`filledFollowUpAnswers` 派生先が gate 無しで描画されるため lazy initializer 不可」と明記
- gate 追加で `useSyncExternalStore + useMemo` パターンへ移行可能

**修正後イメージ**:
```ts
const isMounted = useSyncExternalStore(...);
const followUpAnswers = useMemo(
  () => isMounted ? getStatementPrepareFollowUpAnswers() : {},
  [isMounted]
);
```
description: `filledFollowUpAnswers` の派生も `isMounted` gate 配下に置く必要あり。

### 3 位: `app/statement/score/page.tsx` / `app/statement/improve/page.tsx` / `app/statement/edit/page.tsx`（L222-226）の 3 ファイル同形パターン（**共通化候補だが user 禁止により単独修正**）

**理由**:
- どれも `useState<T[]>([]) + useEffect(if isMounted setHistory(loadXxx()))` の同形パターン
- delete handler で再 sync する点も同形
- version counter 導入で `useMemo` 化可能

ただし 3 件同形は **「カスタムフック化禁止」** の user 制約により共通化は不可。1 件ずつ個別に修正する形で、それぞれの diff は小さい。

---

## 7. hydration-safe と判断した根拠（B 級の SSR/CSR 安全性）

| 条件 | 該当 # |
|---|---|
| isMounted gate 経由で setter が呼ばれる | #7, #8, #10 |
| effect deps が `[isMounted]` → mount 後 1 回のみ実行（再実行されない） | #7, #8, #10 |
| storage read のみで client navigation の影響なし | #2, #5, #6, #7, #8, #10 |
| SSR/CSR 初回 render が同値（空 / null）に保たれる | #2, #5, #6, #7, #8, #10 |
| 表示は post-mount のみで flicker や hydration mismatch なし | #2, #5, #6, #7, #8, #10 |

→ B 級 6 件はすべて hydration-safe。conversion せず disable 維持でも runtime risk なし。

---

## 8. dangerous pattern の定義（次回追加時に避けるべき）

新規 useEffect で setState を書くとき、以下のパターンは **避ける**:

| パターン | なぜ危険か | 代替 |
|---|---|---|
| setState in async / await callback within effect | rule は async ブロック内は許容するが、cleanup function 取りこぼし / race condition リスク | event handler に逃がす |
| effect 内で複数 setState を連鎖発火 | cascading render（rerender → effect 再実行）リスク | useMemo / derived state |
| effect 内で setState + 同一 state に依存する deps | 無限ループ | deps の見直し |
| useEffect(() => { setState(loadStorage()) }, []) で SSR-unsafe storage 読み | hydration mismatch | useSyncExternalStore + useMemo + isMounted gate |
| ref と state を一緒に書き換える 1 effect | 三位一体が破綻すると autosave skip ガード等が無効化 | 明示的に「genuine side-effect」と comment 化 + scoped disable |

---

## 9. 共通化できる hydration-safe pattern

projects 内で確立済みの **canonical pattern**:

```ts
// 1. ファイル冒頭の module-level に 3 const
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// 2. component 内
const isMounted = useSyncExternalStore(
  subscribeMount,
  getMountedSnapshot,
  getMountedServerSnapshot,
);

// 3. storage 由来の derived value
const data = useMemo(
  () => (isMounted ? loadFromStorage() : null),
  [isMounted],
);

// 4. mount-only loading gate
const loading = !isMounted;
```

採用済 page: `self-analysis/run`、`statement/prepare/university`、`statement/improve/rewrite/[id]`、`essay-practice`、`admission-matching`（STEP-PAGE-FIX-01）、`statement/edit`（部分）、`statement/score`、`statement/improve`、`input/basic`、`statement/page.tsx`。

**この pattern は本 audit の改善方針の正本** とする。新規 conversion はこの pattern に合わせる。

---

## 10. 観測項目の不変条件

本 audit ドキュメントは以下を **絶対に変更しない**:

- 13 disable block 内の setState 配列（runtime UX に直結）
- `useState` / `useEffect` の依存配列
- mount effect の早期 return 経路
- PROMPT_VERSION / cache identity / storage 形式
- `subscribeMount` / `getMountedSnapshot` / `getMountedServerSnapshot` の 3 const

これらが変わると hydration / autosave / cache 経路が崩れる。

---

## 11. 次の発火条件

以下が観測されたら個別 STEP として発火:

- **STEP-PAGE-FIX-02-HOME**: `app/home/page.tsx` の 6 setter mount effect を `useMemo` + `useSyncExternalStore` で分解（Top 1）
- **STEP-PAGE-FIX-02-PREPARE**: `app/statement/prepare/page.tsx` の `setFollowUpAnswers` を useMemo 化（Top 2）
- **STEP-PAGE-FIX-02-HISTORIES**: 3 ファイル同形 history パターンの version counter 導入（Top 3、3 STEP に分割）

各 STEP は **本 audit doc の判定に基づき独立に発火**。1 つでも観測 / レビューでリスクが見えたら見送る。

---

## 12. 関連 doc

- [`docs/principles/incremental_refactor_policy.md`](./incremental_refactor_policy.md) — 整理ポリシー / future trigger
- [`docs/principles/feedback_dev_principles.md`](./feedback_dev_principles.md) — 開発方針
- [`docs/observability/api_observability_audit.md`](../observability/api_observability_audit.md) — API 軽量化フェーズの観測整理（並列 audit）
