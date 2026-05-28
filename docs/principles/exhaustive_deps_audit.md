# Exhaustive Deps Audit — `react-hooks/exhaustive-deps` 違反の分類

## 1. 目的

STEP-PAGE-FIX-02 系列で `react-hooks/set-state-in-effect` の disable block を整理し終えた後、project に残る `react-hooks/exhaustive-deps` warning を audit する。`set-state-in-effect` audit ([`page_fix_audit.md`](./page_fix_audit.md)) と同じ A/B/C 分類体系を流用し、「修正すべき / intentional one-shot として残す / 別 STEP に分ける」を整理する。

関連:
- [`docs/principles/page_fix_audit.md`](./page_fix_audit.md) — `set-state-in-effect` audit の正本
- [`docs/principles/incremental_refactor_policy.md`](./incremental_refactor_policy.md) — 整理ポリシー

---

## 2. 計測手法

```bash
npx eslint app components hooks
```

`react-hooks/exhaustive-deps` warning のみ抽出:

```bash
npx eslint app components hooks 2>&1 | grep "react-hooks/exhaustive-deps"
```

既存 block disable も別途確認:

```bash
grep -rnE "eslint-(disable|disable-next-line|disable-line).*react-hooks/exhaustive-deps" app/ components/ hooks/
```

---

## 3. 違反 inventory

### 3.1. アクティブ warning（disable 無しで残っているもの）

| # | ファイル | 行 | 不足 dep | effect 用途 | 分類 | 状態 |
|---|---|---|---|---|---|---|
| 1 | `app/statement/edit/page.tsx` | L334 (旧) → L339 | `searchParams` | form prefill mount-init（`?rewriteFrom=<id>` を 1 回 read、u/f/d/statementText/rewriteContext を post-hydration セット） | **B intentional one-shot** | ✅ **本 STEP で `eslint-disable-next-line` + rationale コメント追加**（commit 同一 STEP） |

**現在 (post-STEP)**: **0 件**

### 3.2. 既存 block disable（intentional、変更なし）

| # | ファイル | 行範囲 | rule 同時 disable | 役割 |
|---|---|---|---|---|
| D1 | `app/self-pr/page.tsx` | L146-294 | `react-hooks/set-state-in-effect, react-hooks/exhaustive-deps` | mount-init で URL routing + legacy drain + seed prefill + `router.replace`。deps を空配列にすることで mount 1 回限り、router 参照変動による replay を回避（[`page_fix_audit.md`](./page_fix_audit.md) #3） |
| D2 | `app/self-pr/page.tsx` | L302-350 | `react-hooks/set-state-in-effect, react-hooks/exhaustive-deps` | `?mode=direct` リアクティブ。`[modeParam]` deps で意図的にトリガを限定。同 effect 内で読む他の変数（router 等）を deps に追加すると意図しない replay が走る（[`page_fix_audit.md`](./page_fix_audit.md) #4） |

**変更なし**。両ブロックとも `set-state-in-effect` audit で category C 維持判定済み。

---

## 4. 分類定義

`set-state-in-effect` audit と同じ A/B/C 体系。

### A: genuine stale closure risk（修正優先）

- effect が外部 mutable 値（state / props / context）を closure 参照しているが、deps に含まれていない
- 値が変わったときに古い snapshot で動作する経路が存在する
- 修正後の挙動が UX 上望ましい

**該当: 0 件**

### B: intentional one-shot mount prefill（許容、コメント明記）

- `useEffect(() => { ... }, [])` で意図的に mount 1 回限り
- 内部で参照する `searchParams` / `pathname` / `router` 等の **読み取り** は initial render の snapshot で正しく機能する
- deps 追加すると prefill 再実行 / user 編集の上書き / redirect replay などの UX drift を起こす

**該当: 1 件（#1、本 STEP で `eslint-disable-next-line` + rationale 追加済み）**

### C: deps 追加で UX drift / infinite loop risk（別 STEP）

- 多 setter effect で deps を増やすと setState → re-render → effect 再実行のループ
- 共通化 / カスタムフック化が user 禁止事項のため scope が広がる

**該当: 0 件（旧分類で C 候補だったものは既に block disable 済み D1/D2）**

### D: safe auto-fix 可能（必要なら eslint --fix）

- deps を素直に追加して挙動に影響なし
- closure 参照が pure helper のみ

**該当: 0 件**

---

## 5. アクティブ warning #1 の判断（`app/statement/edit/page.tsx` L334 → L339）

### 5.1. 現状

```ts
const searchParams = useSearchParams();
// ...
useEffect(() => {
  const rewriteId = searchParams?.get('rewriteFrom') ?? null;
  let rewritePrefilled = false;
  if (rewriteId) {
    const entry = loadReviewHistory().find((h) => h.id === rewriteId);
    if (entry) {
      setRewriteContext(entry);
      setUniversity(entry.university);
      setFaculty(entry.faculty);
      setDepartment(entry.department);
      setStatementText(entry.essay);
      rewritePrefilled = true;
    }
  }
  if (!rewritePrefilled) {
    const draft = loadDraft();
    if (draft) setStatementText(draft.statementText);
  }
  setRemainingCount(getRemainingStatementReviewCount());
  setPrepareFollowUps(getStatementPrepareFollowUpAnswers());
}, []);
```

### 5.2. searchParams を deps に追加した場合

`useSearchParams()` は Next.js App Router で **navigation 時に identity が変わる** ReadonlyURLSearchParams snapshot を返す。`searchParams` を deps に入れると:

1. **同一 mount 中の `router.replace` / `router.push` で query が変わった場合**: effect が再実行され、prefill ロジックが再度走る。
   - `?rewriteFrom=<id>` が新たに付くと、ユーザーがすでに編集中の `university` / `faculty` / `department` / `statementText` / `rewriteContext` を強制的に entry 由来の値に上書き。
   - `?rewriteFrom=<id>` が外れると、`loadDraft()` 経路に落ちて `statementText` を draft.statementText で上書き。
   - いずれも「ユーザー編集を消す」UX drift。

2. **同一 mount 中に query が変わらなくても**: 親 component の re-render などで `searchParams` の reference が変わる可能性があり、effect が無駄に再実行される。setState は idempotent でも、`loadReviewHistory()` / `loadDraft()` の I/O コストと `Math.random()` 由来の id 再生成（本 effect には無いが類似パターンで問題化済み）リスクが残る。

3. **autosave 副作用**: `useEffect(saveDraft, [u, f, d, statementText])` 等の autosave effect が下流に存在する場合、prefill による setState で autosave が誤発火し、ユーザーが意図しない時点で localStorage の draft が更新される。

### 5.3. 結論

**修正せず、`eslint-disable-next-line react-hooks/exhaustive-deps` + rationale コメントで明示的に intentional 化**。

- 本 STEP で適用済み（L334-339）
- L284-296 の元コメント（mount で 1 回だけ実行する根拠）と cross-ref
- 本 audit doc への link を comment 内に記載

block disable ではなく **line-level disable** を選んだ理由:
- block #9 自体は既に `/* eslint-disable react-hooks/set-state-in-effect */` で囲まれているが、`set-state-in-effect` 用の scope を `exhaustive-deps` まで広げると、将来 block 内で新規 deps バグが入ったときに silently 通る
- line 単位で disable すれば、対象は deps 配列 1 行のみに限定される

---

## 6. 推奨対応サマリ

| # | 推奨 | 修正コスト | UX リスク |
|---|---|---|---|
| 1 statement/edit form prefill | line-level disable + rationale（本 STEP で適用済み） | 低 | 0（コメント追加のみ） |
| D1, D2 self-pr | 維持（[`page_fix_audit.md`](./page_fix_audit.md) #3, #4 で C 判定済み） | ─ | ─ |

---

## 7. dangerous pattern の定義（次回追加時に避けるべき）

新規 useEffect で deps 配列を書くとき、以下は **避ける**:

| パターン | なぜ危険か | 代替 |
|---|---|---|
| `searchParams` を `[]` deps の effect 内で read | navigation 時に stale で動く / deps 追加で UX drift | one-shot ならば line-level disable + rationale。再評価が必要ならば値を派生化 (§9-D pattern) |
| `router` を deps に入れる | Next.js useRouter の戻り値が render ごとに新オブジェクトの可能性 → replay リスク | `router.push` / `router.replace` は外部副作用なので closure 経由で参照し、deps に入れない（line-level disable） |
| `useEffect(() => { ... }, deps)` の deps を後から増やす refactor | 既存の one-shot semantics を破壊 | 増やす前に audit doc を更新 |
| inline lambda を deps に入れる | 毎 render で identity 変動 → 毎回再実行 | `useCallback` または body 内に inline 化 |

---

## 8. canonical patterns（intentional one-shot の書き方）

```ts
useEffect(() => {
  // searchParams / router / pathname は **mount 時の snapshot を一度だけ** 使う。
  // 再評価が必要な値ではない（UX 上、navigation を跨いだ再実行を望まない）。
  const rewriteId = searchParams?.get('rewriteFrom') ?? null;
  // ... mount-init setState 群 ...
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot; rationale は L<n> 参照
}, []);
```

- 必ず **rationale コメント** を 1 行併記する（"intentional" だけでは不十分、将来の人が drift させないよう「何が起きると壊れるか」を書く）
- block disable ではなく line-level disable を優先する
- audit doc から page_fix_audit.md / exhaustive_deps_audit.md への back-link を comment に置く

---

## 9. 観測項目の不変条件

本 audit doc は以下を **絶対に変更しない**:

- 既存 block disable D1, D2（self-pr）の scope / コメント
- `app/statement/edit/page.tsx` block #9 の useEffect body（setState 順序、early return ロジック）
- PROMPT_VERSION / cache identity / storage 形式

---

## 10. 次の発火条件

- **STEP-PAGE-FIX-03-NO-UNUSED-VARS**: project-wide `@typescript-eslint/no-unused-vars` warning（現状 1 件: `app/interview/questions/utils/generateAdditionalQuestions.ts:110 '_basicInfo'`）の audit。helper 引数の cleanup のみで API logic 不変。
- **STEP-PAGE-FIX-04-CATEGORY-C-REVISIT**: `page_fix_audit.md` §11 と同期。`set-state-in-effect` category C 6 件の 6 ヶ月後再 audit と同時に、新規 `exhaustive-deps` warning が増えていないかも併せて確認する。

各 STEP は **本 audit doc / page_fix_audit.md の判定に基づき独立に発火**。

---

## 11. 関連 doc

- [`docs/principles/page_fix_audit.md`](./page_fix_audit.md) — `set-state-in-effect` audit の正本（本 doc と相互参照）
- [`docs/principles/incremental_refactor_policy.md`](./incremental_refactor_policy.md) — 整理ポリシー / future trigger
- [`docs/principles/feedback_dev_principles.md`](./feedback_dev_principles.md) — 開発方針
