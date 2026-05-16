# AI-assisted Development 運用ルール

PASSAI の AI 支援開発（ChatGPT + Claude Code）の実務用 rulebook。
**Claude Code は新規セッション開始時に必ず本ドキュメントを参照すること。**

関連: [incremental_refactor_policy.md](./incremental_refactor_policy.md), [ai_policy.md](./ai_policy.md), [architecture_rules.md](./architecture_rules.md)

---

## 1. 役割分担

| Role | ChatGPT | Claude Code |
|---|---|---|
| STEP 分割 | ◎ 主担当 | × 任せない |
| 設計判断 | ◎ 主担当 | △ 補助のみ |
| 探索（Where is X） | △ | ◎（Explore agent） |
| 実装 | △ | ◎ 主担当 |
| 検証（typecheck / lint） | × | ◎ |
| 構造観測 / review | ◎ | ◎ |
| PROMPT_VERSION 判断 | ◎ | × |
| commit 文起草 | ○ | ◎ |

**原則: ChatGPT が判断 → Claude が実装。** Claude が STEP 設計を始めると粒度が膨張する。

---

## 2. 良い STEP の条件

### 定量条件（ハード制約）

| 軸 | 推奨 | 上限 | 超えたら |
|---|---|---|---|
| 編集ファイル数 | 1〜2 | 3 | STEP を分割 |
| 1 ファイル内編集行数 | < 50 行 | 100 行 | 「lift → modify → 削除」を別 STEP に |
| 編集対象ファイルの総行数 | < 400 行 | 600 行 | Read offset で部分読みに切替 |
| 新規ファイル数 | 0〜1 | 2 | 機能追加と切り出しを別 STEP に |
| 触れる route 数 | 1 | 2 | route 横断は別 STEP |
| prompt 文言変更 + route 構造変更 | **同 STEP 禁止** | — | PROMPT_VERSION 管理が壊れる |

### 定性条件

- 可逆性が 1 行で説明できる（`git checkout HEAD -- <file>` で戻る）
- 検証手段が STEP 内に明記されている
- ゴールが diff サイズで予想できる（±30 行など）
- 触る / 読むのみ のファイルが分けて宣言されている

### STEP scope は 1 つだけ

`route` / `lib` / `prompt` / `type` / `client` のいずれか 1 scope のみ。
「prompt と route」のような複合 scope は禁止。

---

## 3. Claude に任せてよい作業 / 人間レビュー必須

### Safe-list（Claude に任せて良い）

- 同ファイル内の関数抽出
- 既存パターンの reproduce（例: 5 つ目の `buildXxxUniversityContext`）
- type 定義からの実装生成
- 純粋 helper の追加
- defensive guard（null check 等）の追加
- `console.error` / `logAiUsage` の追加
- shim → direct import の 1 route ずつの置換
- コメント整形・section header 統一

PR description には `[claude-safe-list]` タグを付ける。

### Review-required（人間レビュー必須）

| 領域 | 理由 |
|---|---|
| prompt 本文の文言変更 | PROMPT_VERSION bump 漏れ = cache 汚染 |
| 共有 helper の signature 変更 | drift 解消のつもりが新 drift を生む |
| 中核 type（`BasicInfo` / `StudentProfile` / `WallHittingResult`）の変更 | fan-out 大、partial fix リスク |
| import path のリネーム | grep noise 大、影響範囲を見落とす |
| `lib/prompts.ts` shim の削除 | 8 import site の同時破壊リスク |
| `scripts/step15-qa.ts` 編集 | production route への逆依存あり |
| 新 directory の作成 | 命名規則の一貫性は人間で担保 |

---

## 4. Claude が壊しやすいパターン

### Next.js App Router

- Server Component に client-only hook を混入
- `'use client'` の置き忘れ / 余計付与
- route.ts の handler 名違い（`POST` を `post` に）
- `NextResponse.json` と `Response.json` の混在
- `export const dynamic` の整形時消失

### AI route

- `system` を string と `TextBlockParam[]` で混在（cache_control 消失）
- `stop_reason === 'max_tokens'` ガードの消失
- `logAiUsage` 呼び忘れ（success / failed / truncated / parse_failed の 4 status 全てに必要）
- MODEL constant の string literal 直書き

### Prompt module

- **`PROMPT_VERSION` bump 忘れ**（最重要）
- 全角・半角・空白・改行の不可視差分
- `import type` を value import に格上げ（runtime cycle 発生）
- shim と direct import の中途半端な混在

### StudentProfile / fallback

- 3 段フォールバック（`body.studentProfile → toStudentProfile → null`）の順序入れ替え
- `isStudentProfile` guard の省略

---

## 5. 「Claude に全部読ませない」運用

### ファイルサイズ別 Read 戦略

| サイズ | 戦略 |
|---|---|
| < 200 行 | 全読み OK |
| 200〜400 行 | 編集対象前後 100 行のみ offset 指定 |
| 400〜800 行 | section header を Grep → 該当 section のみ Read |
| > 800 行 | 構造把握 → 該当部分のみ Read |

### プロンプトで明示すべきこと

- 「`<file>` は読まなくて良い」「`<directory>` は出力対象外」を明示
- 編集に必要な signature / 型は STEP description に貼り付け（Claude が Read せずに済むよう）
- 「触らない」と「読まない」を区別して書く

### Agent 使い分け

- **Explore agent**: 「どこに何があるか」（context 分離）
- **Plan agent**: 「どう設計するか」（結論だけ main に戻す）
- **main Claude**: 実装に集中

---

## 6. session を分ける基準

新しい session を開始すべきタイミング:

- 1 session で 3 ファイル以上を深く読んだ後の次 STEP
- scope（route / lib / prompt / type / client）が切り替わる時
- 前 STEP で大きな探索が走った後（context が広がっている）
- ChatGPT による設計フェーズと Claude による実装フェーズの切替時

新 session には **前 STEP の前提だけ要約**を渡す。Read 履歴は引きずらせない。

---

## 7. STEP template

新 STEP を起こす時は以下の形式に揃える。

```
STEP-XX-<scope>: <one verb> <one noun>

対象:
  - touch: <file1>, <file2>
  - read only: <file3>

変更:
  - <ファイル>: <変更内容>（目安 ~XX 行）

検証:
  - pnpm typecheck
  - <route なら curl コマンド>

Rollback:
  git checkout HEAD -- <file1> <file2>

注意（該当する場合のみ）:
  - prompt 文言を変える場合: PROMPT_VERSION を <const名> で bump
  - claude-safe-list: <yes/no>
```

`<scope>` は `route` / `lib` / `prompt` / `type` / `client` のいずれか 1 つ。

---

## 8. PROMPT_VERSION 運用 checklist

prompt 本文を変えた STEP では以下を必ず実行:

- [ ] 変更した shared 定数を import している全 route を確認
- [ ] 該当 route の `*_PROMPT_VERSION` を `lib/aiInputHash.ts` で bump
- [ ] cache 概念のない route（interview-feedback / essay-chat 等）は bump 不要だが PR description に明示
- [ ] diff レビューで全角・半角・空白の不可視差分が無いか確認

---

## 9. observation routine

月 1 回、本ドキュメントと [incremental_refactor_policy.md](./incremental_refactor_policy.md) に基づき構造観測を実施:

```
wc -l app/api/*/route.ts lib/prompts/*.ts scripts/*.ts
ls lib/ | wc -l
```

- 4 軸スコア（行数 / import graph / Claude edit 頻度 / drift risk）を再計測
- Yellow / Red 昇格・降格を記録
- STEP として実行しない。15〜30 分の routine task

---

## 次回 STEP 作成時の使い方

1. **scope を 1 つに絞る**（Section 2: STEP scope）
2. **定量条件をチェック**（Section 2: 良い STEP の条件）
3. **STEP template に流し込む**（Section 7）
4. **claude-safe-list かどうか判定**（Section 3）
5. **PROMPT_VERSION 影響があれば checklist 実行**（Section 8）
6. **巨大ファイルを触る場合は Read 戦略を STEP に明記**（Section 5）
7. **scope 切替時は新 session 起動**（Section 6）

迷ったら: **「scope は 1 つか」「touch する file は 3 つ以下か」**だけ確認すれば 8 割の事故は防げる。
