# Button システム責務境界（ADR）

PASSAI の Button / LinkButton システムについて「**何を Button に統合し、何を統合しないか**」「**いつ拡張してよいか**」を決める設計憲法。

実装仕様（variant / size の token 値・利用実績スナップショット）は [`docs/shared/ui_components.md` Section 2](../shared/ui_components.md) にある。本書はその上位の **責務境界・拡張ガバナンス** を担当する。

---

## 0. 本書の位置づけ

| ドキュメント | 担当 |
| --- | --- |
| [`docs/shared/ui_components.md`](../shared/ui_components.md) | 各 primitive の token 値・variant/size 一覧・利用実績スナップショット |
| **本書** | Button 体系の責務境界・raw 許容条件・拡張可否の判断基準 |
| [`docs/principles/architecture_rules.md`](./architecture_rules.md) | components の配置層（ui / shared / feature） |

新規 button を実装する人は **本書 → ui_components.md** の順に読む。「どう実装するか」より先に「そもそも Button にすべきか」を判断するため。

---

## 1. Button システムの目的

「**機能ごとに違う見た目の button**」を「**同じ token の組み合わせで表現された button**」に揃え、以下を達成する：

- 視覚一貫性（青 = primary、緑は原則使わない）
- 認知コスト削減（呼び出し側が選ぶのは variant × size の 2 軸のみ）
- 直書き禁止による設計逸脱の防止

ただし「全 button を Button にする」ことは目的ではない。次節以降で **統合しない領域** を明確に切り出す。

---

## 2. Button を使うべき条件

Button が担うのは「**視覚 = variant × size だけで決まるアクション**」である。

### 必須条件（5 つ全て満たすこと）

1. **静的な見た目**：state による className 切替がない（`disabled:opacity-50` は OK）
2. **テキストは固定 or 単純な loading 切替のみ**：`{loading ? 'A中...' : 'A'}` は OK、3 段階以上の文言切替は要警戒
3. **配色は 6 variant のいずれか**：primary / accent / secondary / outline / ghost / danger
4. **サイズは 5 size のいずれか**：sm / md / lg / hero / cta
5. **disabled は opacity-50 で意味が伝わる**：`disabled:bg-blue-400` のような淡色 disabled は不要

### Button が担う代表機能

- フォーム submit / 送信 / 確定
- ページ内主要アクション（rewrite / 添削 / 整理）
- カードのプライマリ遷移ボタン
- LP の主役 CTA（accent + cta）
- パネル内の close（背景色に依存しない場合のみ）

---

## 3. raw button を許容する条件

raw `<button>` は「**視覚が文脈に従属するアクション**」を担う。以下のいずれか 1 つに該当すれば raw 維持を正式に許容する。

| # | 条件 | 代表例 |
| --- | --- | --- |
| 1 | **背景色との連動** | 青パネル内の青 close、緑パネル内の緑 close（DeepDivePanel × 3） |
| 2 | **state でスタイル軸が変わる** | gray → green の success トグル、border-gray → border-red の hover 警告 |
| 3 | **意味的に "button" でない** | accordion trigger、tab、disclosure |
| 4 | **チップ / インラインアクション** | `text-xs px-2 py-1` の Button.sm より小さいサイズ |
| 5 | **完全な text link 化** | `text-gray-400 hover:text-gray-600` のような枠なしテキスト |
| 6 | **既存 raw 同士のペアで成立** | InterviewHistoryCard の「詳細を見る / 削除」のように両方 raw で意図的に揃っている |

### raw を許容しない条件

- 上記 6 条件をどれも満たさず、**単に「移行されていないだけ」のもの**
- 同一画面で既に Button 化された兄弟がいて、その並びで raw だけ浮いているもの

### raw を増やしてよい時

- 新画面・新パネルで上記 6 条件のいずれかに該当する場合は、**Button 化を強制せず raw でよい**。
- Button に向かないものを Button にすると、後から API 拡張圧力（ghost variant、chip size 等）を生む。

---

## 4. variant の役割定義

variant の token 値は [`ui_components.md` Section 2](../shared/ui_components.md) を参照。本節は **役割と使い分け** のみを定義する。

### 4.1 `secondary` の役割

**white-bg + gray-border の "control" 系 2 番手。**

#### 使用条件

- 親が brand 色で塗られている時の **白系コントロール**（panel close、ヘッダー閉じる）
- primary の隣に **1 個だけ** 並ぶ「保留・後戻り・キャンセル」相当
- 「閉じる / 戻る / 取り消す / 後で」など意味が **後ろ向き** のアクション

#### 使用禁止条件

- **同一行に 2 つ以上の secondary を並べる**（→ 灰色のカタマリ化）。2 個目は outline か primary に振る
- 「追加 / 再訪 / 補助」など意味が **前向き** のアクション（→ outline を使う）

### 4.2 `outline` の役割

**brand 色を border + text にだけ載せた "前向き 2 番手"。**

#### 使用条件

- **シリーズで並ぶ補助アクション**（activity 9 セクションの「+ 追加」、NgWordCheck の 3 アクション）
- **primary を補強する前向き 2 番手**（「もう一度改善する」「本文に入れる」「具体化する」）
- 親カードが白背景で、border が brand-200 と馴染む文脈

#### 使用禁止条件

- brand 色が周囲に既に多用されていて outline が埋もれる時（→ secondary に振る）
- ネガティブ系アクション（→ danger）

### 4.3 secondary vs outline 早見表

| 軸 | secondary | outline |
| --- | --- | --- |
| 色味 | gray (slate-700, gray-200) | brand (brand-700, brand-200) |
| 意味 | 後ろ向き / 中立 | 前向き / 補助 |
| 主 CTA との関係 | 打ち消し | 補強 |
| シリーズ並列 | × 灰色化 | ◎ 揃う |
| 単体使用 | ◎ control | ◎ |

→ 同一画面で「**2 番手 = outline、3 番手 = secondary**」という階層を作るのが理想形。

### 4.4 `danger` の役割

**white-bg + red-border の "破壊的アクション専用 2 番手"。**

#### 使用条件

- 入力リセット / アカウント削除 / データ全削除 / 取り消し不能な操作
- primary（保存・確定）と同行に置き、対比として機能させる

#### 使用禁止条件

- 局所的・元に戻せる「削除」（→ raw のチップで十分）
- danger を「目立たせる」ために primary 用途で使う

### 4.5 その他 variant

- `primary` / `accent` / `ghost`：用途は [`ui_components.md` Section 2](../shared/ui_components.md) の通り。`ghost` は本書 6 節の通り当面 raw 維持で代替できるため未採用が続く。

---

## 5. `success` variant を導入しない理由

PASSAI には緑系 success UI が 4 件存在する：

- ActivityFormActions の保存（進行中 → 完了の永続表示）
- ActivitySubmitSuccess の完了画面 CTA
- NgWordCheck のコピー成功トグル（2 秒で消える）
- QualityDeepDive の「本文に反映する」確定 CTA

それでも `success` variant は **追加しない**。

### 理由（4 つ）

1. **success は "variant" ではなく "state"**：variant は「同じ操作の見た目バリエーション」、success は「同じボタンの一時的な表情」。axis が異なる
2. **緑を増やすと「主要 CTA = 青」の規律が崩れる**：常時画面上に緑が存在すると青の優先性が薄まる
3. **既に "色を変えない success" の成功例がある**：`components/ImprovementGuide/RewriteForm.tsx` は Button primary のまま `{savedFlash ? '✓ 保存しました' : '保存する'}` で success を表現済み。色を変えずに children だけで成立している
4. **4 件のうち 3 件は raw 維持で違和感がない**：それぞれ panel 内文脈が成立しているため、Button 体系に組み込む必要がない

### 緑系 button の今後の運用ルール

- **緑は「達成・完了の永続表示」専用**。一時 hover や進行中には使わない
- **新規に緑 button を追加する時は要レビュー**（[`buttonStyles.ts`](../../components/ui/buttonStyles.ts) のコメントに既に明記済）
- 既存 4 件は **raw 維持を許容**、Button 体系には組み込まない
- success を表現したい新規ケースが出たら、**まず children の文言切替**（`'✓ 保存しました'`）で対応できないか検討する

### 解凍条件

`success` variant の追加は、以下を全て満たした場合に限り再議論する：

- success 表現が必要な箇所が **5 件以上** に増える（現在 4 件）
- うち **3 件以上が raw 維持で違和感がある** と確認できる
- children 文言切替では表現できない（色変化が必須） と合意できる

---

## 6. text-link / chip / accordion trigger を Button に統合しない方針

### 6.1 text-link raw button

**永続的に raw 維持。`ghost` variant も追加しない。**

#### 理由

1. **text-link の本質は "button っぽくない"**：`<a>` のような外見を意図的に持たせている。Button 体系に入れた瞬間、外見が button 化されて狙いが崩れる
2. **ghost variant を作ると使い分け基準が増える**：今ですら secondary / outline の使い分けで議論が必要。ghost が加わるとさらに曖昧化
3. **raw `<button>` で `text-gray-400 hover:text-gray-600` を書くコストは 1 行**。共通化メリットが小さい
4. **text-link は文脈色（青パネルの青 / 緑パネルの緑 / 灰パネルの灰）に従属**することが多く、variant 化と相性が悪い

#### 許容条件

- 枠（border / bg）を持たない
- 親要素の色に従属する、または完全に gray 系の控えめな text-only
- アクセシビリティ的に `<button type="button">` であるべき（`<a>` ではない）操作

### 6.2 chip / pill

**Button 体系には統合しない。専用 primitive 化も急がない。**

- 該当箇所：`components/activity/ActivityCard.tsx` の編集 / 削除 / 完了 chip × 4 のみ
- chip の特徴：`text-xs px-2 py-1` と Button.sm（`text-xs px-3 py-1.5`）より一段小さい / 配色は意味で決まる（青=編集、赤=削除、緑=完了） / インライン配置の「行内の操作シール」
- 1 ファイル × 4 button のみで共通化メリットが薄い

#### 解凍条件

他画面で chip パターンが **3 つ以上** に増えたら、`<ChipButton>` を独立 primitive として切り出す。**Button の variant 拡張ではない**。

### 6.3 accordion trigger

意味的に "button" ではなく "disclosure"。
[`components/ui/Accordion.tsx`](../../components/ui/Accordion.tsx) または raw `<button aria-expanded>` を使う。Button 体系には入れない。

---

## 7. `rounded-xl` / `sm` size の扱い

### `rounded-xl` 全体評価

- **md / lg / hero / cta**：継続維持（自然）
- **sm**：許容範囲だがやや強い

### `sm` size の今後の方針

- **当面は変更しない**（既に 9+ 箇所で採用済、視覚破綻はない）
- もし将来「sm がやはり丸すぎる」という共通認識が出た場合、`sm` の rounded を `rounded-lg` に下げる検討は可
- **新 size を作って吸収しない**（chip は別 primitive、sm の小型化で対応）

### `subtle` size の追加可否

[`app/page.tsx`](../../app/page.tsx) の LP 末尾に「subtle size 追加待ち」のコメントが既存。該当する raw `<Link>` は **1 箇所のみ**のため追加は早計。

#### 解凍条件

「subtle = secondary の cta-寄せサイズ」が他に **2 件以上** 出てから追加判断（現在 1 件）。

---

## 8. Button API を拡張する条件

[`Button.tsx`](../../components/ui/Button.tsx) / [`buttonStyles.ts`](../../components/ui/buttonStyles.ts) は **当面凍結**。変更を入れてよいのは以下を **全て** 満たす場合のみ。

### 拡張ガード（5 条件）

1. **同種の用途が 3 件以上画面に存在する**（1〜2 件のために拡張しない）
2. **既存の variant × size の組み合わせで吸収できないことが証明されている**
3. **追加によって既存の役割分担（secondary vs outline など）が混乱しない**
4. **追加された機能が本書または `buttonStyles.ts` コメントで運用ルール化できる**
5. **追加後 1 ヶ月の運用で、追加した機能が想定外の場所で乱用されていないことを確認する prep がある**

[`ui_components.md` Section 9.3](../shared/ui_components.md) の「3 ページ以上で同じ独自パターンが出ている」原則と整合する。

---

## 9. variant / size を追加してはいけない条件

以下に該当する追加リクエストは **却下** する：

1. **「あるとキレイ」レベルの審美的要望**（実需が 1 件のみ）
2. **既存 variant のリネーム / 別名追加**（運用混乱の温床）
3. **state を表現するための variant**（success / loading / error など → state は children か disabled で表現）
4. **特定 1 ファイル / 1 画面のためだけの追加**
5. **「将来使うかも」という未来予測ベース**

### 直近で議論された拡張案の最終判定

| 拡張案 | 判定 | 理由 |
| --- | --- | --- |
| `loading` prop | **却下** | RewriteForm パターンで children 切替で十分。spinner UI が他の primitive で確立してから |
| `success` variant | **却下** | 5 節の通り。緑を増やさない |
| `subtle` size | **保留** | 該当 1 件のみ。3 件出るまで保留 |
| `chip` size | **却下** | 別 primitive 化が筋。Button に入れない |
| `subtle-danger` / `ghost-danger` | **却下** | 現 danger で需要を満たせている |
| `ghost` variant の実利用化 | **却下** | text-link は raw 維持で十分（6.1 節） |

---

## 10. "統一しすぎ問題" への対策

### 問題定義

Button を増やしすぎると、画面ごとの個性・文脈・温度が均質化し、「全画面が同じ UI に見える」状態に陥る。

### 対策ルール（5 つ）

1. **raw を恥じない**：raw `<button>` で適切な見た目が出せる時、Button 化を強制しない
2. **同一画面に 4 種類以上の Button を出さない**：variant × size の組み合わせを 3 種類以内に抑える。4 種類以上になったら、設計を見直す
3. **secondary を量産しない**：単体使用に限定（4.1 節）。これが守られないと「灰色だらけの画面」化する
4. **text-link / chip / accordion は必ず raw / 別 primitive にする**：これらを Button に飲み込もうとしない
5. **新画面を作る時は「Button を使わない選択肢」を最初に検討する**：raw で書けるなら raw、それでも統一感が必要になった時にだけ Button へ昇格

---

## 11. 関連 docs

- [`docs/shared/ui_components.md`](../shared/ui_components.md) — Button / LinkButton の variant / size token 値、利用実績スナップショット
- [`docs/principles/architecture_rules.md`](./architecture_rules.md) — components 配置層（ui / shared / feature）
- [`docs/principles/feedback_dev_principles.md`](./feedback_dev_principles.md) — 開発方針・小 STEP 制
- [`components/ui/Button.tsx`](../../components/ui/Button.tsx) — 実装
- [`components/ui/LinkButton.tsx`](../../components/ui/LinkButton.tsx) — 遷移用
- [`components/ui/buttonStyles.ts`](../../components/ui/buttonStyles.ts) — token 定義（緑系運用ルールのコメント含む）

---

## 12. フェーズ終了宣言と今後の運用

### 12.1 フェーズ終了宣言

PASSAI の Button 共通化フェーズ（STEP26〜STEP40）は **STEP40 をもって実装上完了** した。

#### 達成状況スナップショット（STEP40 終了時点）

| 指標 | 値 |
| --- | --- |
| Button 採用箇所 | 33 |
| 残存 raw button（activity / interview / shared / components スコープ） | 27 |
| A 分類（即移行候補） | **0 件** |
| B 分類（条件付き移行候補） | **0 件** |
| C 分類（raw 維持が正しい） | 27 件（本書 3 / 5 / 6 節にマッピング済） |
| D 分類（将来別 primitive 候補） | 記録のみ・実装なし |
| Button API 拡張 | なし（凍結を維持） |
| 採用された variant | primary / accent / secondary / outline / danger |
| 採用された size | sm / md / lg / hero / cta |
| 未採用のまま残った variant | `ghost`（本書 6.1 節で raw 維持を明文化） |

#### このフェーズの目的（再掲）

- ✅ **Button に向く button を Button に統合**（達成）
- ✅ **raw が正しい button を分類し言語化**（達成 — 本書 3 / 5 / 6 節）
- ❌ **「すべての raw button を消す」は目的ではない**（明示的に否定）

#### 残存 raw button の扱い

残る 27 件の raw button は **負債ではなく、意図的に残された UI** である。

- 9 件 = ActivitySection の accordion trigger（本書 6.3）
- 4 件 = ActivityCard の chip × 4（本書 6.2）
- 5 件 = panel 背景色連動 close（本書 3 節 条件 1）
- 3 件 = text-link（本書 6.1）
- 2 件 = success / 緑 state CTA（本書 5 節）
- 2 件 = ペアで raw として揃っている兄弟（本書 3 節 条件 6）
- 1 件 = copy feedback の state shift（本書 3 節 条件 2）
- 1 件 = NgWordCheck の text-link 閉じる（本書 6.1）

これらを Button 化すると、本書で禁止している API 拡張圧力（`ghost` / `success` / `chip` size 等）を生む。**raw 維持が設計上の正解** である。

---

### 12.2 今後 raw button を見つけた時の判断フロー

新規実装 / 既存画面修正で raw `<button>` に遭遇した時、以下の順で判断する。

```
raw button を見つけた
        │
        ▼
[1] text-link / chip / accordion trigger / success state / panel close か？
        │
        ├─ Yes ──→ raw 維持（本書 3節 / 5節 / 6節 の該当条件をコメント等で明記）
        │
        └─ No
            │
            ▼
[2] 見た目が既存 variant × size で表現できるか？
        │
        ├─ No ──→ raw 維持（または D 分類として別 primitive 候補に記録）
        │
        └─ Yes
            │
            ▼
[3] 同じ用途・同じ見た目が画面内 / プロジェクト内に 3 箇所以上あるか？
        │
        ├─ No ──→ 既存 Button で対応可能なら Button 化、そうでなければ raw 維持
        │         （1〜2 箇所のために primitive / variant を増やさない）
        │
        └─ Yes
            │
            ▼
[4] Button にすると意味 / hover / disabled / 状態表現が変わらないか？
        │
        ├─ 変わる ──→ 移行しない（state を表現するための variant 追加は禁止）
        │
        └─ 変わらない ──→ Button 化候補（本書 8 節 拡張ガード 5 条件で最終判断）
```

---

### 12.3 今後 Button に移行してよい条件

以下を **全て** 満たす場合のみ、Button 化を許容する。

1. **本書 2 節 必須条件 5 つ全てを満たす**（静的見た目 / 単純文言切替 / 6 variant のいずれか / 5 size のいずれか / opacity-50 disabled）
2. **本書 3 節 raw 許容条件 6 つに該当しない**
3. **既存の variant × size の組み合わせで吸収できる**（API 追加不要）
4. **同一画面の兄弟 Button と統合した方が視覚一貫性が増す**
5. **移行後の見た目差分が UX 上の後退を招かない**

---

### 12.4 今後 Button に移行してはいけない条件

以下のいずれか 1 つでも該当すれば、raw を維持する。

- text-link（枠なし / 親要素色従属）
- chip / pill（`text-xs px-2 py-1` の Button.sm より小さいサイズ）
- accordion trigger / disclosure
- panel 内 close で背景色に従属するもの
- success / 完了の永続表示（緑系 state）
- copy feedback など state でスタイル軸が変わるもの
- 既存 raw 同士のペアで意図的に揃っているもの
- 該当が 1〜2 箇所のみで「あるとキレイ」レベルの審美的要望

---

### 12.5 variant / size / API を追加する時の解凍条件

本書 8 節 / 9 節 / 5.解凍条件 / 7.解凍条件 を **すべて** 参照すること。要点を再掲：

| 拡張対象 | 解凍条件 |
| --- | --- |
| 新 variant 全般 | 同種用途が **3 件以上** + 既存組み合わせで吸収不能の証明 + 役割分担を混乱させない |
| `success` variant | 5 件以上に増 + うち 3 件以上が raw で違和感 + 色変化が必須と合意（本書 5 節） |
| `ghost` variant の実利用化 | 該当 text-link が枠付きに変質した場合のみ再議論（本書 6.1 節） |
| `subtle` size | 該当が **2 件以上** に増（本書 7 節） |
| `chip` size | **追加禁止**。別 primitive 化が筋（本書 6.2 節） |
| `loading` prop | **追加禁止**。children 切替で十分（本書 9 節） |

---

### 12.6 Button 化を再開する条件（フェーズ再開条件）

Button フェーズは終了したが、以下のいずれかが起きた場合は **新規 STEP として再開** してよい。

1. **新画面追加で同種 button が 3 箇所以上発生** し、既存 variant × size で吸収可能と確認できた
2. **既存 raw button が C 分類条件から外れた**（例：text-link が枠付きに変質した、accordion trigger が単純 button 化した）
3. **本書 12.5 の解凍条件を満たす拡張要望** が複数発生
4. **新 primitive（ChipButton / IconButton 等）の独立切り出し** が必要になった

これら以外で「raw を見つけたから Button 化する」という動機での再開は **禁止**。

---

### 12.7 新規実装時のルール

新画面 / 新コンポーネントを実装する時の優先順位：

1. **まず raw `<button>` で書けるか検討する**（本書 10 節 対策ルール 5）
2. raw で書く場合は本書 3 節の 6 条件のいずれかに該当することを self-check
3. Button を使う場合は variant × size の 2 軸のみで決定（className での見た目上書きは原則禁止、レイアウト系のみ許容）
4. 同一画面で variant × size の組み合わせは **3 種類以内** に抑える（本書 10 節 対策ルール 2）
5. 新規 Button 化は本書 12.3 / 12.5 の条件を満たすことをコミットメッセージで言及

---

### 12.8 次フェーズへの引き継ぎ

Button フェーズ終了に伴い、以下を次フェーズの判断材料として残す。

#### D 分類（将来別 primitive 候補）— 実装は本書解凍条件達成まで保留

| 候補 | 該当数（STEP40 時点） | 解凍条件 |
| --- | --- | --- |
| `ChipButton` | 4（[ActivityCard.tsx](../../components/activity/ActivityCard.tsx) 1 ファイル内のみ） | 他画面で 3 パターン以上に増（本書 6.2 節） |
| `CopyButton` | 1（[NgWordCheck.tsx](../../components/NgWordCheck.tsx)） | 複数箇所に増えてから再判断 |
| `IconButton` | 0 | 該当発生時に再判断 |
| `TextLinkButton` | 3 | **永続的に追加しない**（本書 6.1 節） |

#### Accordion 統一余地（Button フェーズ外の refactor 候補）

[components/ui/Accordion.tsx](../../components/ui/Accordion.tsx) は primitive 化されているが、9 件の ActivitySection は独自実装の accordion trigger を持っている。Button フェーズの責務外だが、別フェーズ（Accordion 統一フェーズ）として検討余地あり。**本書では扱わない**。

---

### 12.9 終了宣言サマリー

> **PASSAI Button フェーズは STEP40 をもって正式終了する。**
>
> 残存 raw button 27 件は負債ではなく、本書 3 / 5 / 6 節で正式に許容された UI である。
> 今後 Button 化を行う場合は本書 12.3 / 12.5 / 12.6 の条件を満たす必要がある。
> Button.tsx / buttonStyles.ts は引き続き凍結する。
