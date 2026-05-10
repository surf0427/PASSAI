# PASSAI Design System v1（締め版）

PASSAI 全体の UI を「機能ごとに違う」状態から「同じパーツの組み合わせ」に揃える
ためのデザイン基盤の正本。

このドキュメントは **v1 の締め** にあたる。土台 PR から始まった一連の UI 統一フェーズで
達成したことを正本としてここに固定し、次フェーズ（v2 / 機能開発 / etc.）の判断材料にする。

---

## 0. 完成度サマリ

UI 統一フェーズで以下が完了した:

| カテゴリ | 状態 | 詳細 |
|---|---|---|
| デザイントークン | ✅ 完了 | brand / accent / shadow / section spacing を `@theme` で定義 |
| Button / LinkButton | ✅ 完了 | 6 variant + 5 size、buttonStyles.ts で共有 |
| Card | ✅ 完了 | 3 variant + 4 padding、`<Card>` で各ページ統一 |
| FormField + Input + Textarea | ✅ 完了 | label / required / hint / error の縦並び固定 |
| AlertBox / Accordion / Label / LinkButton | ✅ 既存維持 | 既に primitive 化されていたものはそのまま運用 |
| shared/result（AI 結果系）| 🟡 部分完了 | 4 パーツ実装済（AiThinkingState / AiInlineThinking / ImprovementList / StrengthWeaknessGrid）、4 パーツ未実装（ResultCard / ScoreBar / ScoreSummary / NgWordHighlight）|
| LP / Home / Header トークン化 | ✅ 完了 | blue/indigo 直書きを brand/accent に統一 |
| Form 共通化（input/basic, self-pr, essay-practice）| ✅ 完了 | FormField + Input + Textarea + hint 投入 |
| activity セクション群 Form 共通化 | ✅ 完了 | 9 ファイル + inputStyles.ts 削除 |
| AI 結果 UI 移行（admission-matching / essay-practice / self-analysis）| 🟡 部分完了 | 各 1〜6 箇所を shared/result 化 |

実装ファイル:
- [`app/globals.css`](../../app/globals.css) — デザイントークン（Tailwind v4 `@theme`）
- [`components/ui/`](../../components/ui/) — 純粋 UI primitive（10 ファイル）
- [`components/shared/result/`](../../components/shared/result/) — AI 結果表示の共通パーツ（4 + index）
- [`components/shared/`](../../components/shared/) — 機能横断の業務 UI（`BasicInfoSummary`）

---

## 1. カラールール

PASSAI は青系で統一する。緑系のボタンは原則使わない。

### Brand（通常 CTA / リンク / 軽いアクセント）

`--color-brand-50/100/200/500/600/700` を [`app/globals.css`](../../app/globals.css) の `@theme` で定義。
値は Tailwind 既定の `blue-*` と同等（移行時に視覚差なし）。

| トークン | 用途 |
| --- | --- |
| `bg-brand-600` / `text-white` | 通常の primary ボタン |
| `text-brand-600` | 本文中のリンク・強調 |
| `bg-brand-50` / `text-brand-700` | バッジ・soft な強調 |
| `ring-brand-200` | 軽い枠線アクセント |

### Accent（強い CTA / プレミアム訴求）

`--color-accent-50/100/200/500/600/700`。値は Tailwind 既定の `indigo-*` と同等。

| トークン | 用途 |
| --- | --- |
| `bg-accent-600` / `text-white` | LP 主役 CTA・プレミアムプラン強調 |
| `ring-accent-500` | おすすめカードの強調枠（Card variant `highlight`）|
| `border-accent-200` / `border-accent-100` | 診断タイプカードの弱めの強調枠 |

### 用途固定色（Tailwind 既定スケールを使用）

| 役割 | 使う色 |
| --- | --- |
| 文字（本文）| `text-slate-700` |
| 文字（見出し）| `text-slate-800` / `text-slate-900` |
| 文字（補助）| `text-slate-500` |
| 警告 | `bg-amber-50` / `text-amber-800` / `ring-amber-200` |
| エラー | `bg-red-50` / `text-red-700` / `ring-red-200` |
| 成功 | `bg-green-50` / `text-green-700`（控えめ運用） |

### 直書き禁止

新規コードで `bg-blue-*` / `bg-indigo-*` 系の直書きは禁止。`bg-brand-*` / `bg-accent-*` を使う。

> 既知の例外: `text-blue-800` / `text-orange-800` などの 800 番台は `@theme` 未定義（brand-700 までしか定義していない）のため Tailwind 既定をそのまま使う。詳細は本ドキュメントの「未対応 / 既知の限界」参照。

---

## 2. Button ルール

実装: [`components/ui/Button.tsx`](../../components/ui/Button.tsx) / [`components/ui/LinkButton.tsx`](../../components/ui/LinkButton.tsx) / [`components/ui/buttonStyles.ts`](../../components/ui/buttonStyles.ts)

### Variant

| variant | 用途 | 利用実績 |
| --- | --- | --- |
| `primary` | 通常の主役ボタン（保存・次へ・送信）| **20 箇所**（最頻）|
| `accent` | LP 主役 CTA・プレミアム訴求 | 5 箇所 |
| `secondary` | 補助操作（戻る・キャンセル系）| 6 箇所 |
| `outline` | 並列に並ぶ補助ボタン | 1 箇所 |
| `ghost` | 文字だけのインライン操作 | **0 箇所**（未使用）|
| `danger` | 削除・破壊的操作 | **0 箇所**（未使用）|

### Size

| size | 用途 | 出力 | 利用実績 |
| --- | --- | --- | --- |
| `sm` | テーブル内・タグ風 | `rounded-xl text-xs px-3 py-1.5` | **0 箇所**（未使用）|
| `md`（既定）| 標準ボタン | `rounded-xl text-sm px-6 py-2.5` | **14 箇所**（最頻）|
| `lg` | やや強めの主役ボタン | `rounded-xl text-base px-6 py-3` | 7 箇所 |
| `hero` | LP / Home 上部の大きめ CTA | `rounded-2xl text-base sm:text-lg px-8 py-3.5 sm:py-4 shadow-sm` | 2 箇所 |
| `cta` | LP 主役・料金カード | `rounded-3xl shadow-cta hover:shadow-pop hover:-translate-y-0.5` | 3 箇所 |

> `ghost` / `danger` / `sm` は未使用だが API として保持。今後の機能追加で必要になる可能性があるため削除しない。

### 使用例

```tsx
<Button variant="primary" size="md">保存する</Button>
<LinkButton href="/diagnosis" variant="accent" size="cta">無料診断を始める</LinkButton>
```

### 直書き禁止

- `<button className="bg-blue-600 ...">` の直書きは新規禁止。`<Button>` または `<LinkButton>` を使う。
- 大型 CTA のために `rounded-2xl` / `rounded-3xl` を直書きしない。`size="hero"` / `size="cta"` を使う。

### 既知の限界

各機能で「Button のいずれの size とも合わない独自サイズ」が散見される（例: Home の `rounded-lg px-5 py-2.5 text-sm font-semibold`、self-pr / essay-practice / DiagnosisTypeCard の `rounded-xl px-6 py-3 text-sm sm:text-base font-bold shadow-sm`）。これらは**現状 raw のまま維持**。新 size を増やすかは v2 の議題。

---

## 3. Card ルール

実装: [`components/ui/Card.tsx`](../../components/ui/Card.tsx)

ベース: `bg-white rounded-2xl ring-1 ring-slate-200 shadow-card transition-shadow`

### Variant

| variant | 見た目 | 用途 |
| --- | --- | --- |
| `default`（既定）| `bg-white` + `ring-slate-200` + `hover:shadow-md` | 通常カード |
| `highlight` | `ring-2 ring-accent-500` | おすすめ・プレミアム・強調カード |
| `soft` | `bg-blue-50 ring-blue-100`（shadow なし）| 補足説明・ヒント・安心感を出す情報 |

### Padding

| padding | 出力 | 用途 |
| --- | --- | --- |
| `none` | なし | 内部で個別に余白を組みたい時 |
| `sm` | `p-3 sm:p-4` | タイトな小型カード |
| `md`（既定）| `p-4 sm:p-6` | 標準 |
| `lg` | `p-6 sm:p-8` | 大型カード・LP セクションカード |

### 直書き禁止

`bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm` の直書き、および `border border-gray-200` のカード枠線は新規禁止。

### 既知の限界

- `<li>` / `<details>` / `<section>` などの semantic 要素を Card 化したい場面では、Card primitive が `<div>` 固定なので使えない（LP の StepCard・FAQItem など）。`as` prop 追加は v2 候補。
- 一部の「淡いカラー枠（`border border-accent-200` / `border border-brand-200`）」を持つカード（DiagnosisTypeCard、PromoCard、LP の解決メッセージ等）は `default` / `highlight` / `soft` のどれにも合わず raw 維持。`accent-soft` / `brand-soft` variant 追加は v2 候補。

---

## 4. FormField + Input + Textarea ルール

実装: [`components/ui/FormField.tsx`](../../components/ui/FormField.tsx) / [`components/ui/Input.tsx`](../../components/ui/Input.tsx) / [`components/ui/Textarea.tsx`](../../components/ui/Textarea.tsx)

入力フォームの「label / 必須印 / hint / 入力欄 / error」の縦並びを 1 パーツに固定化する。
高校生向けに **hint を出しやすい構造** にしているのが特徴。

### Props

| prop | 型 | 用途 |
| --- | --- | --- |
| `label` | `string` | 入力欄のタイトル（必須） |
| `required` | `boolean` | `*` 印を表示 |
| `hint` | `string` | label の下に出る薄い補助文 |
| `error` | `string` | 入力欄の下に出る赤字エラー |
| `htmlFor` | `string` | 子要素の id を明示したい時 |
| `children` | `ReactElement` | `<Input>` / `<Textarea>` / `<select>` など 1 つ |

### 表示順

1. `label`（`required="*"` 付き）
2. `hint`（薄色の補助文）
3. `children`（入力欄）
4. `error`（赤字、`role="alert"`）

### 使用例

```tsx
<FormField
  label="志望動機"
  required
  hint="短くてOK。あとで AI が整理します。"
  error={errors.motivation}
>
  <Textarea name="motivation" rows={6} placeholder="思いついた順で大丈夫です" />
</FormField>
```

### 高校生向けに hint で書きたい例文

- 「短くてOK」「100 文字以内で大丈夫です」
- 「あとで AI が整理するので、思いついた順で OK」
- 「うまく書けなくても問題ありません」「まだ決まっていなければ空欄でも大丈夫です」

> hint は **入力前の不安を減らす** 役目。エラーではなく、書く前の安心感のために使う。

### アクセシビリティ

- `<label htmlFor>` が子要素の `id` と自動的に紐付く（無ければ `useId()` で自動生成）。
- `error` 時は子要素に `aria-invalid="true"` と `aria-describedby` を `cloneElement` で伝播。

### 既知の限界

- **複数 input を持つ複合 field**（活動セクションの「期間: from〜to」、basic ページの radio group / checkbox group）には FormField が使えない（単一 ReactElement 子要素前提）。これらは raw 維持。
- **エラー時の赤枠 input**（activity セクション）は `<Input className="!border-red-400 focus:!ring-red-400">` の `!important` 上書きで実現。FormField の `error` プロパティは error 文を出すだけで input 自体の枠色は変えない（error variant を Input に持たせない方針）。

---

## 5. shared/result ルール（AI 結果表示）

実装: [`components/shared/result/`](../../components/shared/result/)

機能ごとに散らばっていた AI 結果表示 UI を共通パーツに集約する。

### 実装済み（v1）

| パーツ | 責務 | 実利用 |
| --- | --- | --- |
| `AiThinkingState` | フルカード型「AI 処理中」表示（早期 return パネル）| admission-matching |
| `AiInlineThinking` | ボタン内 / 行内のインライン spinner + テキスト | self-analysis |
| `ImprovementList` | プレフィックス付きリスト（success ✓ / warning △ / info → / neutral ・）| admission-matching・essay-practice・self-analysis |
| `StrengthWeaknessGrid` | 強み・補強ポイントの 2 カラム（青/オレンジ・xs サイズ）| admission-matching |

### 未実装（意図的に v1 ではスコープアウト）

| パーツ | 想定 | スコープアウト理由 |
| --- | --- | --- |
| `ResultCard` | AI 結果の汎用ラッパー（タイトル + 説明 + 子）| 既存の colored card とどう統合するか設計が固まらない |
| `ScoreBar` | スコアの横バー（0-100）| 機能ごとに `studentScore/required` 比較や閾値色が違い、汎用 API が定まらない |
| `ScoreSummary` | 大型スコア + ランク表示 | statement/score の `TotalScoreCard` + `RankBadge` が既に高完成度。再共通化メリット薄 |
| `NgWordHighlight` | NG ワード警告 | `components/NgWordCheck.tsx` 1 箇所のみで使われており共通化の価値が低い |

### shared/result の運用方針

- 新機能で AI 結果を表示する時は **既存機能の独自実装をコピーせず**、まず shared/result に該当パーツがあるかを確認する。
- 該当パーツがあるが視覚仕様が違う場合は、**安易に variant を増やさず raw 維持** を許す。共通化のために既存ページの見た目を大きく変えてはいけない。
- 該当パーツが無い場合は、まず該当機能で raw 実装し、**2 回目に同じパターンが出てきた時点で**初めて shared/result に抽出する（「2 回ルール」）。

---

## 6. shared/（業務 UI）ルール

実装: [`components/shared/BasicInfoSummary.tsx`](../../components/shared/BasicInfoSummary.tsx)

### 配置基準（`docs/principles/architecture_rules.md` を参照）

- 純粋な UI primitive（ドメイン文脈なし）→ `components/ui/`
- 2 機能以上で実利用される業務 UI → `components/shared/`
- 1 機能専用 → `app/{feature}/components/`

`BasicInfoSummary` は 6 機能（input/activity・admission-matching・essay-practice・statement/edit・interview・self-analysis）で実利用されているため `components/shared/` 配置。

### shared/ に新たに置く条件

1. **2 機能以上で実利用が確定している**こと（候補レベルでは置かない）。
2. **API 都合のロジックを含まない**こと（業務ロジックは `lib/` 配下）。
3. **1 機能専用に逆戻りしない**見込みであること（実装直後に専用化されたら逆移動）。

---

## 7. Typography 方針

> v1 では Tailwind 既定 utility に「使い分けの規則」を載せて運用する（`@theme` での typography 上書きはしない）。

### 階層（4 段階）

| 役割 | 推奨 class |
| --- | --- |
| ページタイトル（h1）| `text-2xl sm:text-3xl font-bold tracking-tight text-slate-900` |
| セクション見出し（h2）| `text-lg sm:text-xl font-bold text-slate-900` |
| カード見出し（h3）| `text-base font-semibold text-slate-800` |
| 補助文 / ヘルパー | `text-xs text-slate-500 leading-relaxed` |
| 本文 | `text-sm text-slate-700 leading-relaxed`（既定）|

### LP 例外

LP の hero タイトルは商業的なリズムを優先し、`text-2xl sm:text-4xl font-extrabold` を許容。
**LP 以外で `font-extrabold` は使わない**。

### 角丸（radius）の使い分け

`@theme` でのトークン上書きは行わない。Tailwind 既定 utility に意味付けして運用:

| PASSAI scale | 推奨 utility | px | 用途 |
| --- | --- | --- | --- |
| sm | `rounded-lg` | 8 | バッジ・ピル・小さい input |
| md | `rounded-xl` | 12 | 標準 button・標準 input |
| lg | `rounded-2xl` | 16 | Card 標準（primitive 既定）|
| xl | `rounded-3xl` | 24 | LP 主役 CTA（Button `size="cta"`）|

### Shadow / Section spacing

| トークン | 用途 |
| --- | --- |
| `shadow-card` | Card 標準 |
| `shadow-cta` | 主役 CTA |
| `shadow-pop` | hover / active |
| `py-section-sm/md/lg` | 縦リズム（2.5 / 4 / 6 rem）|

---

## 8. Tailwind 直書きを避ける対象（まとめ）

新規コードでは以下の直書きを禁止。**既存コードは段階移行で許容**。

| 直書きパターン | 代替 |
| --- | --- |
| `<button className="bg-blue-600 ...">` | `<Button variant="primary">` |
| `<a className="bg-indigo-600 ...">` | `<LinkButton variant="accent">` |
| `bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm` | `<Card>` |
| `<input className="border-slate-300 ...">` | `<Input>` |
| `<textarea className="border-slate-300 ...">` | `<Textarea>` |
| `<label className="block text-sm font-medium ...">` 単独 | `<FormField>` でラップ |
| `bg-blue-600` / `bg-indigo-600` 直値 | `bg-brand-600` / `bg-accent-600` |
| 大型 CTA の `rounded-3xl shadow-lg ...` | `<Button size="cta">` |
| AI 結果の `<ul>` + ✓/△/→ prefix を独自実装 | `<ImprovementList>` |
| AI 思考中の独自 spinner SVG | `<AiThinkingState>` / `<AiInlineThinking>` |

ESLint warn ルールは v2 候補。

---

## 9. 開発ルール（v1 で確立した運用指針）

UI 統一フェーズの実践で得られた知見を、今後のルールとして固定する。

### 9.1 共通化の判断基準

- **2 回以上実利用が出たら shared 化**を検討する（**2 回ルール**）。1 回しか出ていない UI を予備的に共通化しない（YAGNI）。
- **1 ページ専用の UI は raw 維持**してよい。`app/{feature}/components/` に置けば良い。
- **API 都合で props が複雑になりそうなら共通化しない**。共通化により呼び出し側の認知コストが上がるなら raw のほうが読みやすい。

### 9.2 見た目維持の優先

- 共通化のために既存ページの **見た目を大きく変えない**。視覚差が大きいなら共通化を見送る。
- 軽微な変化（色 1 シェード違い・余白 ±2px・shadow 強度差）は許容する。
- 「軽微 vs 大幅」の判断軸:
  - **軽微**: 同じ色相・同じ役割・同じレイアウト構造。例: green-900 → green-700。
  - **大幅**: 色相変更（紫 → 青）、構造変更（per-column card → flat grid）、サイズ変更（text-sm → text-base）。

### 9.3 variant / size の追加抑制

- variant を増やせば共通化はしやすいが、API が肥大化して使う側の選択肢が増える。
- **新 variant 追加は「3 ページ以上で同じ独自パターンが出ている」**を目安にする。1〜2 ページ程度なら raw 維持。
- 例: self-analysis の per-column colored card は 1 ページのみのため StrengthWeaknessGrid に `variant="card"` を追加せず raw 維持。

### 9.4 raw Tailwind を許容する条件

以下のいずれかに該当する場合は raw Tailwind を許容する:

1. **semantic 要素**（`<li>` / `<details>` / `<fieldset>` 等）が必要で primitive と合わない。
2. **既存サイズと既存 size 系列が完全一致しない**（e.g. `rounded-lg px-5 py-2.5` のような独自寸法）。3 ページ以上で同じものが出るまで variant 追加を待つ。
3. **複合 field**（複数 input・複数子要素）で primitive の単一 child 制約に合わない。
4. **特殊な視覚意図**（オレンジ警告ブロック・紫の future hypothesis ブロック等）でデザインシステムの色相外。

### 9.5 新しい primitive を作る条件

新規 primitive 追加は以下を全部満たす場合に限る:

1. **3 機能以上で同じ視覚パターン**が出ている（または出ることが確実）。
2. **API が単純**（props 5 個以下、optional 中心）。
3. **責務が 1 つ**（複数の責務を持つなら分割）。
4. **既存 primitive の variant / size 拡張で吸収できない**。

### 9.6 削除の判断基準

未使用に見えるコードでも、以下を全部満たす場合のみ削除する:

1. **grep で実利用 0 件**を確認。
2. **docs での将来利用計画にない**ことを確認。
3. **同等機能を持つ別実装が既にある**わけではない（重複でない孤児）こと。

満たさないなら **「未使用認識」だけ docs に残し削除しない**。

---

## 10. 既知の dead code 候補（v1 では削除しない）

UI 統一フェーズの結果、以下が「実利用 0 だが将来候補として保持」となっている。

| 場所 | 状況 | 判断 |
|---|---|---|
| [`components/activity/ActivityErrorList.tsx`](../../components/activity/ActivityErrorList.tsx) | 実利用 0 件。docs/activity/activity_refactor.md に refactor 計画として残る | activity セクションの section-level error list（`bg-red-50 border-red-200` の inline 実装が 9 箇所）の共通化先として再利用候補。**保持** |
| Button variant `ghost` | 実利用 0 件 | API として保持。文字だけのインライン操作（次のフォームで使う想定）|
| Button variant `danger` | 実利用 0 件 | API として保持。削除確認 dialog の primary action 等で必要になる |
| Button size `sm` | 実利用 0 件 | API として保持。テーブル内・タグ風の極小ボタンで必要になる |

これらを削除すると、将来必要になった時に再追加する手間と「以前は何が定義されていたか」のヒストリ追跡コストが発生する。**v1 では保持**し、v2 で「6 ヶ月使われていない」等の基準で再評価。

---

## 11. 未対応 / 既知の限界（v1 でスコープアウトした項目）

### 11.1 primitive レベル

- **`@theme` の brand-800 / brand-300〜400 未定義**: 9 番手・3〜4 番手のシェードが必要な箇所では Tailwind 既定の `text-blue-800` 等を直書き使用中（admission-matching `text-blue-800` 等）。
- **`@theme` の radius / typography トークン未定義**: 既存画面破壊リスク回避のため。Tailwind 既定 utility に意味付けて運用。
- **dark mode 未対応**: globals.css の `@media (prefers-color-scheme: dark)` ブロックは `body` の `--background` / `--foreground` のみ切替で、各 primitive は light theme 固定。`color-scheme: light` を form 要素に強制している。

### 11.2 primitive で吸収できていないパターン

- **Select primitive 未整備**: basic ページの「学年」select は raw `<select>` のまま FormField でラップ。
- **RadioGroup / CheckboxGroup primitive 未整備**: basic ページの「文系/理系/未定」radio、「受験予定の方式」checkbox は raw 維持。
- **Badge primitive 未整備**: 「N 件」「要確認」「添削済み」等の pill 型バッジが各所に散在。
- **複合 field**（期間 from-to）の汎用パーツ未整備。

### 11.3 shared/result 未実装

- ResultCard / ScoreBar / ScoreSummary / NgWordHighlight を v1 では作らなかった（[セクション 5](#5-sharedresult-ルールai-結果表示) 参照）。

### 11.4 旧資産の整理待ち（AGENTS.md TODO）

- `components/` 直下のフラット 7 ファイル（NgWordCheck / RewriteGuide / StructureCheck / EvaluationAxisCheck / DeepDivePanel / QualityDeepDive / StructureMapping）を `components/statement/` に集約する作業は statement 機能の active 開発が落ち着いてから。

---

## 12. v2 候補（次フェーズで議論する項目）

優先度順:

1. **AI 処理中ボタンに spinner を付けるかのデザイン方針決定 + 一括適用** — `AiInlineThinking` は揃ったので、self-pr / essay-practice / admission-matching の各 AI ボタンに付けるかを 1 PR で決着させる。
2. **interview 配下の AI 結果 UI 移行** — `app/interview/{record,history,questions}/` の AI フィードバック画面に shared/result を適用。
3. **`components/` 直下フラット 7 ファイルの `components/statement/` 集約**（AGENTS.md TODO）。
4. **ESLint warn ルール** — `bg-blue-` / `bg-indigo-` / 大型カード直書きパターンを警告。
5. **完了状態の意味色決定** — 緑 CTA（Home の「活動整理を見直す」、self-pr の「完了してホームに戻る」）の扱いを統一するか raw のままか。
6. **Card / Button への semantic / size 拡張**:
   - Card に `as` prop（`<li>` / `<details>` 対応）。
   - Button に subtle / xs+ size（self-pr / essay-practice / Home の独自サイズ吸収）。
   - StrengthWeaknessGrid に `variant="card"`（self-analysis の per-column card 対応）。
7. **shared/result の続き** — ResultCard / ScoreBar / ScoreSummary を 3 機能で同じパターンが出た時点で抽出。
8. **デザイントークン拡張** — brand-800 / accent-300 など足りないシェードの追加。

> v2 を始めるかは別フェーズの判断。**v1 はここで凍結**する。
