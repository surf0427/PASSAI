# Accordion システム責務境界（ADR）

PASSAI の `ActivitySectionShell` 体系について「**何を Shell に統合し、何を統合しないか**」「**いつ拡張してよいか**」を決める設計憲法。

実装は [`components/activity/ActivitySectionShell.tsx`](../../components/activity/ActivitySectionShell.tsx)。本書はその上位の **責務境界・拡張ガバナンス** を担当する。

Button フェーズの [`button_system.md`](./button_system.md) と同じ思想（**primitive に責務を寄せる、ただし寄せすぎない**）を継承する。

---

## 0. 本書の位置づけ

| ドキュメント | 担当 |
| --- | --- |
| [`components/activity/ActivitySectionShell.tsx`](../../components/activity/ActivitySectionShell.tsx) | Shell の実装（API: `title` / `count` / `hasError` / `isOpen` / `onToggle` / `contentId` / `rightSlot` / `children`） |
| **本書** | Shell の責務境界・state ownership・拡張可否の判断基準 |
| [`docs/principles/button_system.md`](./button_system.md) | Button 体系の責務境界（本書と同じ思想・姉妹 ADR） |
| [`docs/principles/architecture_rules.md`](./architecture_rules.md) | components の配置層（ui / shared / feature） |
| [`docs/activity/activity_refactor.md`](../activity/activity_refactor.md) | activity フォーム全体の refactor 経緯（STEP 単位の履歴） |

新規 ActivitySection を追加する人は **本書 → Shell 実装** の順に読む。「どう実装するか」より先に「Shell に何を渡し、何を呼び出し側に残すか」を判断するため。

---

## 1. Accordion フェーズの目的

9 種類の活動入力 section（部活動 / ボランティア / 留学 / 探究 / バイト / 資格 / コンテスト / 読書 / 趣味）が、それぞれ独自に同じ accordion 外枠を直書きしていた。これを **`ActivitySectionShell` 1 つに揃える** のが本フェーズの目的。

達成したかったこと：

- 視覚一貫性（外枠 / header / chevron / content wrapper の class 文字列・タグ構造を 1 箇所で定義）
- 認知コスト削減（呼び出し側が触るのは state と children だけ）
- 9 ファイル間の意図しない drift の防止（コピペ起源の section が個別に綻ぶことを防ぐ）
- 直書き禁止による設計逸脱の防止

ただし「accordion を全部 Shell にする」ことは目的ではない。詳細セクション（[`SimulationSummaryCard`](../../components/SimulationSummaryCard.tsx) などで使う [`Accordion.tsx`](../../components/ui/Accordion.tsx)）は別 primitive のまま分離する（10 節）。

---

## 2. なぜ共通化したか

9 ファイルそれぞれが、同一の外枠構造をローカル直書きで持っていた：

- `<section className="mb-4 border border-gray-200 rounded-xl bg-white overflow-hidden">`
- header row（`flex items-center justify-between px-4 py-3`）
- 開閉 trigger button（`type="button"` / `aria-expanded` / `aria-controls`）
- title `<span>` + count badge + 「要確認」 error badge + chevron SVG
- `{isOpen && (<div id={contentId} className="border-t border-gray-100 px-4 pt-3 pb-4">…</div>)}`

この外枠は「**どの section でも同じ見た目** であるべき」性質を持っており、9 件のうち 1 件だけ class が違う・chevron の SVG path が違う・`px-4 py-3` が `px-3 py-2` になっている、といった drift が将来的に発生する可能性が高かった。primitive に寄せることでこの drift を構造的に不可能にした。

一方で **state（`isOpen` / `editingIndex` / `prevLen` / `isMounted`）と handler（`handleAdd` / `confirmRemove`）と content の中身（AlertBox / 空状態文言 / `ActivityCard` ループ / 各 `FormField`）は section ごとに微妙に違う**（4 節 / 5 節）。これらを Shell に取り込むと API が肥大化するため、**外枠だけ** を共通化対象とした。

---

## 3. なぜ ActivitySectionShell は最小 API に固定したか

Shell の props は 8 つだけで凍結する：

```ts
type Props = {
  title: string;
  count?: number;
  hasError?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  contentId: string;
  rightSlot?: ReactNode;
  children: ReactNode;
};
```

これ以上増やさない理由：

1. **state を Shell に持たせると 9 件分の "微妙な違い" が雪崩込む**（5 節）。`editingIndex` / `prevLen` / `isMounted` / atLimit はそれぞれ 1〜数件にしか必要なく、Shell に入れると不要な section にも prop が伝播する
2. **9 件は API 設計を判断するには十分なサンプル**。STEP44〜STEP52 で全 9 件を実装し、追加が必要だった prop は 0 だった
3. **Shell は "見た目の外枠" であり、それ以上のものではない**。controlled state container でも layout component でもない。`button_system.md` の「`success` は variant でなく state」と同じ理屈で、**Shell に state 由来の prop を増やさない**

---

## 4. Shell の責務

Shell が担うのは **見た目の外枠** に限る。

| 責務 | 内訳 |
| --- | --- |
| section 外枠 | `<section className="mb-4 border border-gray-200 rounded-xl bg-white overflow-hidden">` |
| header row | `flex items-center justify-between px-4 py-3` の `<div>` |
| 開閉 trigger button | `type="button"` / `aria-expanded={isOpen}` / `aria-controls={contentId}` / `flex items-center gap-2 flex-1 min-w-0 text-left` |
| title 表示 | `<span className="text-sm font-semibold text-gray-700">{title}</span>` |
| count badge | `count !== undefined && count > 0` のとき青 badge（`text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full shrink-0`） |
| error badge | `hasError` のとき赤「要確認」 badge（同形状、red token） |
| chevron | `ml-auto w-4 h-4 text-gray-400 transition-transform shrink-0` の SVG、`isOpen` で `rotate-180` |
| rightSlot 配置 | trigger button の sibling として直接出力（wrapper なし、7 節） |
| content wrapper | `{isOpen && <div id={contentId} className="border-t border-gray-100 px-4 pt-3 pb-4">{children}</div>}` |

これだけ。**それ以外は全部呼び出し側**。

---

## 5. Shell の責務ではないもの

以下はすべて呼び出し側に残す。Shell に足してはいけない：

| 領域 | 例 | 残す理由 |
| --- | --- | --- |
| 開閉 state | `isOpen` / `setIsOpen` / `useState(activities.length > 0)` 初期値 | section ごとに初期 open 条件が違う（`activities.length > 0` / `defaultOpen` / 親 prop 経由など）。Shell は controlled trigger だけ提供する |
| 編集 state | `editingIndex` / `setEditingIndex` | `ActivityCard` の編集モードは Shell から見えない |
| 新規追加検知 | `prevLen = useRef(activities.length)` + `useEffect` で `setEditingIndex(activities.length - 1)` | 「追加した瞬間に新カードを編集モードで開く」UX。section の中身（`ActivityCard`）と連動するため Shell の関心外 |
| hydration ガード | `isMounted` + `useEffect(() => setIsMounted(true), [])`（[`PartTimeJobActivitySection`](../../components/activity/PartTimeJobActivitySection.tsx) のみ） | 8 節 |
| 上限ガード | `atLimit = activities.length >= N`（[`CertificationActivitySection`](../../components/activity/CertificationActivitySection.tsx) のみ） | 8 節 |
| handler | `handleAdd` / `confirmRemove` / `window.confirm` | section ごとに `onAdd` / `onRemove` の挙動と確認文言が異なる可能性。Shell が握ると硬直化する |
| content の中身 | `AlertBox`（errors 表示）/ 空状態文言 / `<div className="space-y-4">` / `activities.map(...)` / 各 `ActivityCard` / 各 `FormField` / `Input` / `Textarea` | section 固有のフォーム構造。Shell の関心外 |
| per-field error 判定 | `errors?.some(e => e.startsWith(\`資格${i+1}: 資格名\`)) ?? false` 等の prefix 判定 | section ごとに error key の prefix が違う。`hasError` boolean に丸めて Shell に渡すのは header の赤 badge 表示用のみで、card 内 input への `!border-red-400` 適用は呼び出し側の責任 |

---

## 6. state ownership を呼び出し側に残す理由

「Shell が `isOpen` を内包し、`defaultOpen` だけ受け取る」設計（[`Accordion.tsx`](../../components/ui/Accordion.tsx) 型）も検討したが採用しなかった。理由：

1. **section ごとに「親 / 兄弟 state と連動して開閉する」需要がある**。`handleAdd` の中で `setIsOpen(true)` を呼ぶ（追加押下で section を開く）パターンは 9 件全てに存在する。Shell が state を握ると、外から強制的に open にする経路を別途用意する必要があり、API が増える
2. **初期 open 条件が `activities.length > 0`** の section が多く、これは props 由来。Shell 内部 state にすると props → state 同期問題（`useEffect` で `setIsOpen` する反パターン）を呼び込む
3. **controlled / uncontrolled の二択を Shell に持ち込むと API が倍**。`isOpen` / `defaultOpen` / `onToggle` / `onOpenChange` の 4 prop に膨らむ。9 件すべて controlled で十分だった
4. **state を呼び出し側に残しても、Shell の本来責務（外枠の見た目共通化）は損なわれない**。冗長な `useState(activities.length > 0)` の重複は許容コスト。`button_system.md` 10 節「raw を恥じない」と同じ姿勢で、**state の重複を恥じない**

---

## 7. rightSlot を wrapper div なしで出力する理由

Shell は `rightSlot` を `<div>` で包まず、header row の中に **trigger button の sibling として直接出力** する：

```tsx
<div className="flex items-center justify-between px-4 py-3">
  <button … className="flex items-center gap-2 flex-1 min-w-0 text-left">…</button>
  {rightSlot}
</div>
```

理由：

1. **元の 9 ファイルは全て `<Button … className="ml-3 shrink-0">＋ 追加</Button>` を trigger button の sibling として直に置いていた**。wrapper div で包むと flexbox の child 数が変わり、`flex-1 min-w-0` の trigger button の領域計算が変わって visual diff が出る（9 節）
2. **rightSlot に `ml-3 shrink-0` を渡す責任は呼び出し側**。Button の `className` で持つ。Shell が wrapper を作ると「wrapper 側で margin を付けるのか、Button 側で付けるのか」の二重管理が発生する
3. **rightSlot は 1 要素を想定した slot**。複数要素を並べる需要が出たら呼び出し側で `<>…</>` か単一 wrapper を渡せばよい。Shell が自動 wrapper を提供する必要はない

`rightSlot` は **位置だけ提供する slot**、**装飾は提供しない**。これを 11 節で「Shell に追加してはいけない責務」として固定する。

---

## 8. disabled / atLimit / isMounted を Shell に入れなかった理由

3 つの「section 固有の振る舞い」が STEP44-52 の途中で「Shell に入れたほうが綺麗では？」と思える瞬間があった。すべて却下した。

### 8.1 `disabled` / `atLimit`

[`CertificationActivitySection`](../../components/activity/CertificationActivitySection.tsx) のみが `atLimit = activities.length >= 3` を持つ（資格は最大 3 件）。これは「＋追加」 Button の `disabled` 表示と「（上限3件）」文言切替に使われる。

Shell に `addDisabled` / `addLimitLabel` を入れる案：**却下**。

- 該当が 1 ファイルのみ。`button_system.md` 9 節「該当 1 件のために追加しない」と同じ
- `rightSlot` で十分表現できる：呼び出し側が `<Button disabled={atLimit}>＋ 追加{atLimit ? '（上限3件）' : ''}</Button>` を組み立てて渡す
- Shell に入れると「上限のない section にも `addDisabled?: boolean` が見えてしまう」ノイズが発生

### 8.2 `isMounted`（hydration ガード）

[`PartTimeJobActivitySection`](../../components/activity/PartTimeJobActivitySection.tsx) のみが `isMounted` を持ち、count badge の SSR/CSR ミスマッチを避けている。STEP52 で Shell 化する際、`mounted?: boolean` prop を Shell に追加するかが論点になった。

**却下**。

- 該当が 1 ファイルのみ
- `count={isMounted ? activities.length : 0}` を呼び出し側で算出して渡せば、Shell の既存ガード `count !== undefined && count > 0` が pre-mount の 0 を弾く。**API 拡張ゼロで挙動完全一致** が達成できた
- Shell に hydration の知識を持たせると、「他の section も `isMounted` 入れた方がいいのでは？」という拡散圧力が発生する。1 件だけの事情を全件に染み出させない

### 共通する判断軸

これら 3 つの「Shell に入れたほうが綺麗そうに見える」拡張は、すべて以下の理由で却下された：

- **該当が 1 件のみで、共通化の価値がない**
- **呼び出し側の式（`isMounted ? n : 0` / `disabled={atLimit}`）で十分表現できる**
- **Shell に入れた瞬間、他 8 件にも prop が見えてしまい、無関係な section が「自分も使うべきか」と惑う**
- **`button_system.md` 9 節「state を表現するための variant は禁止」と同じ。state を Shell に染み込ませない**

---

## 9. visual diff 0 を維持した理由

STEP44-52 のすべての PR で「visual diff が出ないこと」を完了条件に置いた。

理由：

1. **refactor の正当性が visual diff の有無で証明できる**。class 文字列・タグ構造・children 順序を Shell に移すだけなので、見た目が変わったらどこかで mistake が起きている
2. **9 件を 1 件ずつ移行する小 STEP 制と相性が良い**。各 STEP は「単独で revert 可能」「PR review が機械的に終わる」状態を保てる
3. **見た目を変えたい改善（chevron アイコン差替・badge 配色調整など）は別フェーズに切り出す**。refactor STEP に乗せると差分の評価が混ざる

これは [`feedback_dev_principles.md`](./feedback_dev_principles.md) の小 STEP 制と整合する。Accordion フェーズの過去 9 STEP で見た目変更は **0 件**。

---

## 10. Accordion.tsx を流用しなかった理由

[`components/ui/Accordion.tsx`](../../components/ui/Accordion.tsx) は既に primitive として存在する（`SimulationSummaryCard` 等で使用）。Shell として `Accordion` を流用する案も検討したが、別 primitive として `ActivitySectionShell` を切り出した。

主な相違点：

| 項目 | `Accordion.tsx` | `ActivitySectionShell.tsx` |
| --- | --- | --- |
| state | 内部 `useState(defaultOpen)` で完結（uncontrolled） | controlled（`isOpen` / `onToggle` を必須で受け取る） |
| 外枠 class | `border border-gray-200 rounded-xl bg-white overflow-hidden`（`mb-4` なし） | 同 + `mb-4`（section 並列前提） |
| header padding | `px-5 py-4` | `px-4 py-3` |
| trigger 領域 | header 全体（`w-full flex items-center justify-between gap-3`） | header **の中の片側 child**。`rightSlot` が並ぶ |
| chevron | `▾` テキスト + `rotate-180` | SVG path + `rotate-180` |
| sibling action | なし | `rightSlot`（「＋ 追加」 Button） |
| count / error badge | なし | あり（青件数 / 赤「要確認」） |
| `aria-controls` / `contentId` | なし（`<div>` に id なし） | 必須 prop |
| 子 padding | `px-5 py-5` | `px-4 pt-3 pb-4` |
| children に求めるもの | 任意の説明 / 一覧 | フォーム入力（`AlertBox` / `ActivityCard` 群） |

**`Accordion.tsx` は単一トリガーの "詳細を開く / 閉じる" disclosure**。`ActivitySectionShell` は **「list + add CTA + per-card edit」 を内包する form section の外枠**。両者は **state ownership・header layout・aria 要件・padding token・children に対する期待値** がすべて違う。

Accordion を拡張して両方カバーする道もあったが、prop が `controlled?` / `defaultOpen?` / `rightSlot?` / `count?` / `hasError?` / `contentId?` / `padding?` … と肥大化する。**別 primitive のまま並立** が `button_system.md` 6.2「chip は別 primitive、Button に飲み込まない」と同じ判断。

`Accordion.tsx` は **触らない**。本書の射程外。

---

## 11. 今後 Shell に追加してはいけない責務

以下の追加リクエストは **却下** する。

### 11.1 state を Shell に持たせる系

- `defaultOpen` を受けて内部 `useState` する uncontrolled モード
- `editingIndex` を Shell に持たせる
- `isMounted` / `mounted` / `hydration` 系 prop
- `atLimit` / `addDisabled` / `addLabel` / `addLimitLabel`

理由：5 節 / 6 節 / 8 節。state は 9 件それぞれの事情を持つ。

### 11.2 装飾を Shell に持たせる系

- `variant` / `size`（外枠の太さや角丸を切り替える）
- `tone` / `accent`（color token の差し替え）
- chevron アイコンの差し替え prop
- `rightSlot` を wrapper div で包む（7 節）
- header に複数 sibling slot を生やす（`leftSlot` / `subtitleSlot` 等）

理由：9 件すべて同一見た目で十分。差別化したくなったら **見た目変更フェーズ** として別途検討する（refactor フェーズに混ぜない、9 節）。

### 11.3 動作を Shell に持たせる系

- 開閉 animation prop（`animateOpen` / `transition`）
- 開閉時のスクロール調整 / focus 制御
- `onOpen` / `onClose` の lifecycle callback（`onToggle` 1 つで十分）

理由：9 件で必要になったケースなし。1 件の需要のために共通 API を増やさない。

### 11.4 「将来〜」で広げる系

- 「将来 9 件以上に増えたら必要になるかも」
- 「将来 admin 画面でも使うかも」
- 「将来 dark mode 対応するかも」

理由：[`feedback_dev_principles.md`](./feedback_dev_principles.md) の「未来予測ベースで設計しない」。今ある 9 件で必要十分なら、それで凍結する。

---

## 12. 今後 ActivitySection を追加する時の手順

10 個目の ActivitySection が必要になった場合の標準手順：

1. **`components/activity/<Name>ActivitySection.tsx` を作成**し、`ActivitySectionShell` を import
2. props 型を定義（`activities` / `errors` / `onAdd` / `onRemove` / `onUpdate` / 必要なら `onUpdatePeriod` 等）
3. 呼び出し側に置く state：
   - `useState(false)` の `isMounted`（hydration が必要なら。不要なら省略）
   - `useState(activities.length > 0)` の `isOpen`
   - `useState<number | null>(null)` の `editingIndex`
   - `useRef(activities.length)` の `prevLen`
   - 新規追加検知 `useEffect`
4. `handleAdd`（`setIsOpen(true)` → `onAdd()`）と `confirmRemove`（`window.confirm` → `setEditingIndex(null)` → `onRemove()`）を定義
5. `<ActivitySectionShell>` に渡す props：
   - `title`：日本語ラベル
   - `count`：基本は `activities.length`、hydration mismatch を避けたいなら `isMounted ? activities.length : 0`
   - `hasError`：`!!(errors && errors.length > 0)`
   - `isOpen` / `onToggle`
   - `contentId`：`"<kebab-name>-activity-section-content"`（kebab-case）
   - `rightSlot`：`<Button variant="outline" size="sm" onClick={handleAdd} className="ml-3 shrink-0">＋ 追加</Button>`（wrapper div は付けない）
6. `children` に `AlertBox`（errors）/ 空状態文言 / `<div className="space-y-4">` / `activities.map(...)` で `ActivityCard` を構築
7. per-field error 判定が必要なら呼び出し側で `errors?.some(e => e.startsWith(\`<prefix>${i+1}:\`)) ?? false` の形で取り回し、`Input` / `Textarea` に `!border-red-400 focus:!ring-red-400` を被せる
8. `npx tsc --noEmit` と `npx eslint components/activity/<Name>ActivitySection.tsx` を通す
9. 既存 9 件と並べて visual diff が出ないことを確認

**Shell の API は変更しない**。10 個目の section を作る過程で「Shell に prop を増やしたい」と感じたら、**まず本書 5 / 8 / 11 節を読み返す**。それでも必要だと判断した場合は、3 節「最小 API 凍結」を解凍する条件を満たすかを 13.5 のフェーズ再開条件に照らして判断する。

---

## 13. STEP44-52 の完了記録

### 13.1 フェーズ終了宣言

PASSAI の Accordion 共通化フェーズ（STEP44〜STEP52）は **STEP52 をもって実装上完了** した。

#### 達成状況スナップショット（STEP52 終了時点）

| 指標 | 値 |
| --- | --- |
| Shell 採用 ActivitySection | **9 / 9**（100%） |
| Shell の API（props 数） | **8**（`title` / `count` / `hasError` / `isOpen` / `onToggle` / `contentId` / `rightSlot` / `children`） |
| STEP44 以降の Shell API 拡張 | **0** |
| 各 STEP の visual diff | **0**（9 STEP 全てで維持） |
| 呼び出し側に残した state | `isOpen` / `editingIndex` / `prevLen` / 必要に応じて `isMounted` |
| 呼び出し側に残した handler | `handleAdd` / `confirmRemove` |
| 棄却された Shell API 拡張案 | uncontrolled mode / `defaultOpen` / `mounted` / `addDisabled` / `addLimitLabel` / `variant` / `size` / animation props |
| `Accordion.tsx` の改変 | **なし**（10 節） |

#### このフェーズの目的（再掲）

- ✅ **9 件の section 外枠を Shell に統合**（達成）
- ✅ **state / handler / content は呼び出し側に残す方針を確立**（達成 — 本書 5 / 6 節）
- ✅ **Shell の最小 API を凍結**（達成 — 本書 3 節）
- ❌ **「すべての accordion を Shell にする」は目的ではない**（明示的に否定 — 10 節）

### 13.2 適用済み 9 ファイル一覧

STEP44 から STEP52 にかけて、以下 9 ファイルが順次 `ActivitySectionShell` 化された。最終的に各ファイルの header 外枠 / chevron / count badge / error badge / content wrapper はすべて Shell に委譲されている。

| # | ファイル | title | contentId | per-field error 判定 |
| --- | --- | --- | --- | --- |
| 1 | [`ClubActivitySection.tsx`](../../components/activity/ClubActivitySection.tsx) | 部活動・サークル | `club-activity-section-content` | あり |
| 2 | [`VolunteerActivitySection.tsx`](../../components/activity/VolunteerActivitySection.tsx) | ボランティア | `volunteer-activity-section-content` | あり |
| 3 | [`StudyAbroadActivitySection.tsx`](../../components/activity/StudyAbroadActivitySection.tsx) | 留学・海外経験 | `study-abroad-activity-section-content` | あり |
| 4 | [`ResearchActivitySection.tsx`](../../components/activity/ResearchActivitySection.tsx) | 探究・研究 | `research-activity-section-content` | あり |
| 5 | [`CertificationActivitySection.tsx`](../../components/activity/CertificationActivitySection.tsx) | 資格・検定 | `certification-activity-section-content` | あり（per-field 3 種 + `atLimit`） |
| 6 | [`ContestActivitySection.tsx`](../../components/activity/ContestActivitySection.tsx) | コンテスト・大会 | `contest-activity-section-content` | あり |
| 7 | [`ReadingActivitySection.tsx`](../../components/activity/ReadingActivitySection.tsx) | 読書 | `reading-activity-section-content` | あり |
| 8 | [`HobbyActivitySection.tsx`](../../components/activity/HobbyActivitySection.tsx) | 趣味・特技 | `hobby-activity-section-content` | あり |
| 9 | [`PartTimeJobActivitySection.tsx`](../../components/activity/PartTimeJobActivitySection.tsx) | アルバイト | `part-time-job-activity-section-content` | あり（+ `isMounted` 専有） |

STEP 単位の経緯は [`docs/activity/activity_refactor.md`](../activity/activity_refactor.md) を参照。

### 13.3 残存する section 固有要素（負債ではない）

以下は **意図的に呼び出し側に残されている** 振る舞いである。Shell に巻き取る対象ではない（5 / 8 節）。

- `isMounted` ガード（[`PartTimeJobActivitySection`](../../components/activity/PartTimeJobActivitySection.tsx) 1 件のみ）→ `count={isMounted ? n : 0}` で吸収済み
- `atLimit` 上限（[`CertificationActivitySection`](../../components/activity/CertificationActivitySection.tsx) 1 件のみ、上限 3 件）→ `rightSlot` の Button に `disabled` で吸収済み
- per-field error 判定（複数 section、prefix が section ごとに異なる）→ 呼び出し側で `errors?.some(...)` を組む
- `useState(activities.length > 0)` の冗長な重複（9 件すべて）→ 6 節の通り許容

### 13.4 棄却された Shell API 拡張案

STEP44〜52 の途中で議論され、本書 11 節に基づき却下された案：

| 拡張案 | 該当件数 | 判定 | 根拠 |
| --- | --- | --- | --- |
| `defaultOpen` + 内部 `useState`（uncontrolled） | 0 | 却下 | 6 節：呼び出し側 state ownership を維持 |
| `mounted` / `isMounted` prop | 1 | 却下 | 8.2 節：`count={isMounted ? n : 0}` で API 拡張ゼロ達成 |
| `addDisabled` / `addLabel` / `addLimitLabel` | 1 | 却下 | 8.1 節：`rightSlot` の Button が組み立てる |
| `variant` / `size` / `tone` | 0 | 却下 | 11.2 節：9 件で見た目を統一する目的に反する |
| `leftSlot` / `subtitleSlot` 等の追加 slot | 0 | 却下 | 11.2 節：1 件の需要なし |
| 開閉 animation / transition prop | 0 | 却下 | 11.3 節：1 件の需要なし |

### 13.5 フェーズ再開条件

Accordion フェーズは終了したが、以下のいずれかが起きた場合は **新規 STEP として再開** してよい。

1. **10 個目以降の ActivitySection が追加** され、それが既存 8 prop で表現できないことが具体的に証明された
2. **既存 9 件のうち 2 件以上で、Shell に追加すべき同一の prop が独立に必要になった**（1 件のための拡張は禁止）
3. **新画面で Shell と同等の "list + add CTA + per-card edit" form section が 3 つ以上発生**し、`ActivitySectionShell` を component 名・配置層含めて再評価する必要が出た
4. **`Accordion.tsx` と Shell が混乱を招いている**（呼び出し側がどちらを使うか迷うケースが頻発）。10 節の前提を再評価する

これら以外で「Shell を綺麗にしたい」「prop が増えても困らないだろう」という動機での再開は **禁止**。

---

## 14. "統一しすぎ問題" への対策

`button_system.md` 10 節と同じ問題が Shell にも当てはまる。primitive を肥大化させると、画面ごとの個性・section ごとの事情が均質化され、不要な抽象が共通負債になる。

### 対策ルール（5 つ）

1. **state の重複を恥じない**：9 件すべてが `useState(activities.length > 0)` を書く重複は許容。Shell に吸い上げない（6 節）
2. **1 件の事情を全件に染み出させない**：`isMounted` / `atLimit` のような 1 件専有の振る舞いは Shell に入れない（8 節）
3. **rightSlot に装飾を入れない**：wrapper div / margin / variant は呼び出し側の責任（7 節）
4. **見た目変更を refactor STEP に混ぜない**：visual diff 0 を維持（9 節）
5. **`Accordion.tsx` を兼用させない**：state ownership・aria・padding が違うものは別 primitive に並立させる（10 節）

---

## 15. Button フェーズとの思想接続

本書は [`button_system.md`](./button_system.md) の姉妹 ADR である。両者は同じ思想を共有する：

| 軸 | Button フェーズ | Accordion フェーズ |
| --- | --- | --- |
| primitive の責務 | variant × size の 2 軸で「見た目」だけを担う | title / count / hasError / rightSlot で「外枠の見た目」だけを担う |
| state | 持たない（disabled も外から） | 持たない（`isOpen` も外から、controlled） |
| 1 件の需要で API を増やさない | `loading` / `success` / `chip` size 却下 | `mounted` / `addDisabled` / `defaultOpen` 却下 |
| 別 primitive と並立 | `Button` ⊥ `ChipButton`（将来） ⊥ raw `<button>` | `ActivitySectionShell` ⊥ `Accordion.tsx` |
| 「全部統合する」は目的ではない | raw 27 件は意図的に残存 | `Accordion.tsx` 利用箇所は Shell 化しない |
| visual diff 0 で refactor | 達成 | 達成 |
| 凍結方針 | `Button.tsx` / `buttonStyles.ts` 凍結 | `ActivitySectionShell.tsx` 凍結 |

要点：**「共通化しすぎない共通化」**。primitive は責務を狭く保ち、外側の事情を吸い上げない。これにより API が肥大化せず、9 件以降の section 追加でも同じ Shell が使い続けられる。

---

## 16. 関連 docs

- [`docs/principles/button_system.md`](./button_system.md) — 姉妹 ADR、思想の起点
- [`docs/principles/architecture_rules.md`](./architecture_rules.md) — components 配置層
- [`docs/principles/feedback_dev_principles.md`](./feedback_dev_principles.md) — 小 STEP 制・visual diff 0 の前提
- [`docs/activity/activity_refactor.md`](../activity/activity_refactor.md) — STEP 単位の history
- [`components/activity/ActivitySectionShell.tsx`](../../components/activity/ActivitySectionShell.tsx) — Shell 実装（凍結）
- [`components/ui/Accordion.tsx`](../../components/ui/Accordion.tsx) — 別 primitive（本書射程外）

---

## 17. 終了宣言サマリー

> **PASSAI Accordion フェーズは STEP52 をもって正式終了する。**
>
> 9 件の ActivitySection は `ActivitySectionShell` 化され、STEP44 から API 拡張ゼロ・各 STEP visual diff 0 で達成された。
> Shell は **見た目の外枠** のみを責務に持ち、state container ではない。
> `isMounted` / `atLimit` / `editingIndex` / `prevLen` 等の section 固有 state は呼び出し側に残す。
> `Accordion.tsx` には触らない。`ActivitySectionShell.tsx` は引き続き凍結する。
> 新 ActivitySection を追加する時は本書 12 節の手順に従い、Shell の 8 prop で表現できることを self-check する。
