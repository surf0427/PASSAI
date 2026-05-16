# Context Builder Layer

PASSAI の「人格コンテキスト生成層」。StudentProfile を feature 用の文字列／構造体に整形する純粋関数の置き場。

関連: [docs/principles/student_profile_contract.md](../../docs/principles/student_profile_contract.md) / [docs/principles/architecture_rules.md](../../docs/principles/architecture_rules.md) / [docs/principles/incremental_refactor_policy.md](../../docs/principles/incremental_refactor_policy.md)

---

## 1. 目的

- prompt builder と人格データ取得を分離する
- feature-specific context を 1 箇所に isolate する（route.ts での adhoc 組み立てを防ぐ）
- prompt layer の肥大化を防ぐ（prompt builder は文言を組み立てるだけにする）
- Supabase 化 / context 形式変更時の影響範囲を絞る

---

## 2. 理想構造

```
StudentProfile          (canonical, lib/studentProfileStorage)
        ↓
Context Builder         (本ディレクトリ・純粋関数のみ)
        ↓
Prompt Builder          (lib/prompts/*, lib/{feature}Prompt.ts)
        ↓
API Route               (app/api/{feature}/route.ts)
```

各層の責務分離:

| 層 | 責務 | 禁止 |
|---|---|---|
| Context Builder | StudentProfile → feature 向け中間 context（純粋関数・AI 呼ばない） | localStorage 直読み / 副作用 |
| Prompt Builder | context + 文言テンプレで prompt 文字列を組み立てる | StudentProfile 直接整形 |
| API Route | HTTP I/O + AI 呼び出し + parse | prompt 文言の直書き |

---

## 3. shared の役割

`shared/` は **全 feature が共通で使う最小定義** だけを置く。

- `shared/types.ts` — `BaseStudentContext`（共通 canonical 中間表現） / `FeatureContextBuilder<T>`（builder の関数型）
- `shared/buildBaseStudentContext.ts` — StudentProfile → BaseStudentContext の placeholder helper

注意: 既存 [`common.ts`](./common.ts) は formatter（`formatBulletList` / `formatInlineList`）の置き場として **flat 配置で稼働中**。今は移動しない（[incremental_refactor_policy.md](../../docs/principles/incremental_refactor_policy.md) の「flat→sub-directory 移設禁止」）。`shared/` の types / helper は新規消費者が現れた時点で `common.ts` と統合方針を決める。

---

## 4. feature builder の役割

各 feature builder は **feature-specific augmentation のみ** 担う。

| feature | 想定責務 |
|---|---|
| selfPr | 強み / signatureEpisodes / appealPoints から PR 文脈を組み立てる |
| statement | university context / admission policy / motivation alignment 整形 |
| interview | expected question focus / weak points / growth memo 抽出 |
| matching | admission style / scoring factors / recommendation basis 抽出 |

---

## 5. 現在の状態

**まだ migrate していない**。本 STEP-CB-0 は future architecture anchor を作るだけ。

### 5.1 既存 flat ファイル（稼働中）

| ファイル | 消費者 |
|---|---|
| [`common.ts`](./common.ts) | interview / matching / statement の formatter |
| [`interviewContext.ts`](./interviewContext.ts) | `app/api/interview-feedback/route.ts` |
| [`matchingContext.ts`](./matchingContext.ts) | `app/api/matching/route.ts` |
| [`statementContext.ts`](./statementContext.ts) | statement 関連 prompt builder |

### 5.2 skeleton ディレクトリ（消費者なし）

| ディレクトリ | 状態 |
|---|---|
| [`shared/`](./shared/) | types.ts / buildBaseStudentContext.ts を置く。**まだ import されない** |
| [`selfPr/`](./selfPr/) | builder 未作成（現状 `lib/buildSelfPRDraftSeed.ts` で代替） |
| [`statement/`](./statement/) | 将来の移動先。現状は flat `statementContext.ts` |
| [`interview/`](./interview/) | 将来の移動先。現状は flat `interviewContext.ts` |
| [`matching/`](./matching/) | 将来の移動先。現状は flat `matchingContext.ts` |

各 subdir には README のみ置く。実 .ts ファイルは migrate 時に追加する。

---

## 6. Anti-pattern

- route.ts 内で StudentProfile / WallHittingResult を直接整形する
- prompt builder が localStorage / storage helper を直接読む
- feature ごとの人格 state を別途キャッシュする
- context builder で AI を呼ぶ
- context builder で副作用（fetch / storage write）を起こす
- 「migrate 完了前」に shared/buildBaseStudentContext を消費する（消費者が現れたら docs 更新とセットで取り込む）

---

## 7. Migration path（将来）

trigger 発火時に下記を順次実行する。今は何もしない:

1. **selfPr 消費者の整理**: `lib/buildSelfPRDraftSeed.ts` の責務を `selfPr/buildSelfPrContext.ts` に持ち上げる契機があった時
2. **shared types の本採用**: 2 つ目以上の builder が `BaseStudentContext` を必要としたタイミング
3. **flat → subdir 移設**: 既存 `*Context.ts` を `{feature}/` に移動する PR（import 書き換えが広範になるため最小 1 STEP）
4. **`incremental_refactor_policy.md §T5` 連動**: `buildXxxUniversityContext` 系の集約と同じ PR で扱える場合は抱き合わせ

---

## 8. 規約遵守

- [`student_profile_contract.md`](../../docs/principles/student_profile_contract.md) §10 (Context Builder Layer との関係) と整合
- [`architecture_rules.md`](../../docs/principles/architecture_rules.md) の storage / lib 配置ルールと整合（storage 直読み禁止）
- [`incremental_refactor_policy.md`](../../docs/principles/incremental_refactor_policy.md) の「skeleton 先行 / migrate は trigger 発火後」と整合
