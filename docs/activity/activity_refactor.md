# activity/page.tsx 分割進捗

996 行だった `app/input/activity/page.tsx` を段階的に分割中。元メモ時点で 831 行。

> **note**: 行数はメモ時点の値。最新の行数はコードを直接確認すること。

## Why

ファイルが大きすぎて保守しにくいため、既存機能を壊さず少しずつ切り出している。

## How to apply

次のチャットでも続きから始められる。「Step X を実装してください」と言えばすぐ進められる。

## 完了済み

### lib/

- `lib/activityFactories.ts` — 9 種の初期値ファクトリー関数（newClubActivity など）

### components/activity/

- `ActivityFormHint.tsx` — 青いヒントボックス（props なし）
- `ActivityErrorList.tsx` — エラー一覧（props: errors: string[]）
- `BasicInfoCard.tsx` — 基本情報カード（props: basicInfo: BasicFormData | null）
- `ActivitySubmitSuccess.tsx` — 保存完了画面（props: onBack: () => void）
- `ActivityFormActions.tsx` — 保存・リセットボタン（props: onReset: () => void）
- `ReadingActivitySection.tsx` — 読書セクション（props: activities, onAdd, onRemove, onUpdate）

## page.tsx に残っている責務

1. **state 管理** — activityData, errors, isSubmitted, basicInfo（useState と useEffect）
2. **8 つのフォームセクション JSX** — 部活/ボランティア/留学/探究/アルバイト/資格/コンテスト/趣味
3. **9 種 × add/remove/update ハンドラー関数**（約 240 行）
4. **validateForm 関数**（約 44 行）
5. **handleSubmit / handleReset 関数**

## 次にやるべき作業（推奨順）

### Step A: 残り 8 セクションを同じパターンで切り出す（8 回）

- 読書と同じ手順。period がないもの（趣味）→ period があるもの（部活など）の順が安全
- 趣味: onUpdate のみ（onUpdatePeriod 不要）
- 資格・コンテスト: period なし
- 部活・ボランティア・留学・探究・アルバイト: period あり（onUpdatePeriod も props に追加）

### Step B: `lib/activityValidator.ts` に `validateForm` を移す

- `validateForm` は `ActivityData` を受け取り `string[]` を返す純粋関数
- React 不要、切り出しリスク低

### Step C: `hooks/useActivityForm.ts` に全ハンドラーをまとめる（大きめ）

- state・useEffect・全 add/remove/update・handleSubmit をカスタムフックに
- page.tsx が `const { ... } = useActivityForm()` 1 行になる
