# lib/tutor — 受験チューターAI helper 群

PASSAI 受験チューターAI（`app/api/tutor` / `app/tutor`）が使う型・SYSTEM PROMPT・rule-based helper を集約するディレクトリ。

関連:
- [lib/aiInputHash.ts](../aiInputHash.ts) — `TUTOR_PROMPT_VERSION` / `TUTOR_MODEL`
- [lib/contextBuilders/tutor/](../contextBuilders/tutor/) — context builder 純粋関数群
- [app/api/tutor/route.ts](../../app/api/tutor/route.ts) — HTTP I/O 層

---

## 1. ファイル構成

| ファイル | 責務 |
|---|---|
| `types.ts` | `TutorIntent` / `TutorFeature` / API レスポンス型 / `PreferredProfileField` の型定義 |
| `tutorPrompt.ts` | `TUTOR_SYSTEM_PROMPT` 定数 + `buildTutorUserPrompt` 純粋関数 |
| `detectTutorIntent.ts` | message + currentFeature から `TutorIntent` を rule-based で推定 |
| `detectTutorStabilization.ts` | message からメルトダウン signal を rule-based で検出 |
| `detectTutorSuggestedFeature.ts` | intent から UI 提案用 `TutorFeature` を導出 |
| `README.md` | 本ドキュメント |

---

## 2. なぜ AI で intent 判定をしないか

intent 判定は **rule-based に固定** している。AI に分類させない理由:

- **Token 節約**: intent 判定だけで Anthropic を呼ぶと 1 ターンあたり 2 回 AI 呼び出しになる
- **Latency 削減**: rule-based なら 1ms 以内、AI 呼び出しは数百ms〜数秒
- **Runtime drift 防止**: モデル更新で intent 結果が動くリスクをゼロにする
- **Intent ブレ防止**: 同じ message に対して常に同じ intent を返す（deterministic）
- **観測容易性**: keyword リストが lib に固定されており、PR で差分が見える

intent はあくまで「**今どの整理に近いか**」のヒント。厳密分類ではない。SYSTEM PROMPT 側で off-topic redirect / 重トピック自動切替が効くため、rule-based の粗さは許容できる。

---

## 3. stabilize 優先思想

stabilize は他のすべての intent より **構造的に優先される**。

- `detectTutorIntent` は keyword 判定の最初に stabilize をチェック
- `detectTutorStabilization` は detectTutorIntent より broader な keyword で再判定（二重防御）
- `currentFeature='statement'` で message が「もう無理」なら → `stabilize`（statement に上書き）

理由:
- メルトダウン状態の受験生に分析モードで応答するのを構造的に防ぐ
- 分析を急がず、観察 + 安定化フレーズ + 内側アクションで受け止める
- SYSTEM PROMPT [F] と整合する三層防御の中段を担う:
  - 第 1 層: client UI の危険語チェック（外部窓口誘導）
  - 第 2 層: client UI の `detectTutorStabilization`（intent 上書き）+ server route の危険語 1 次検出
  - 第 3 層: SYSTEM PROMPT 内の [F] 安定化モード / [G] 危険語プロトコル

---

## 4. routing の役割

`detectTutorSuggestedFeature` は intent から UI 提案用の `TutorFeature` を返す。

| intent | suggestedFeature |
|---|---|
| `statement` | `'statement'` |
| `interview` | `'interview'` |
| `self_analysis` | `'self_analysis'` |
| `selfpr` | `'selfpr'` |
| `stabilize` | `null`（機能接続を出さない、SYSTEM PROMPT [F] と整合） |
| `general` | `null` |

UI 側で:
- 入口 chip クリック後の intent をそのまま使って先回り表示
- AI 応答末尾の「→ 〜してみる」（parseTutorReply、STEP9 想定）と二重表示しないよう優先制御

---

## 5. PASSAI 機能境界を守る理由

tutor は **4 機能だけ** に接続する:

- 自己分析（壁打ち） / 志望理由書整理 / 面接練習 / 自己PR

繋がない機能:
- マッチング（admission-matching） — 進路決定は AI の責務外
- 小論文添削 — 本文を既に持っているユーザー向け、tutor の入口とは噛み合わない
- その他

これは hallucination 防止（AI が存在しない機能を案内する事故）と、tutor の役割範囲を明示する両方の目的を持つ。SYSTEM PROMPT [I] と完全に整合する。

---

## 6. tutor が「全部やる AI」ではないこと

tutor の役割は **「整理を手伝う」「次の一歩を提案する」** に限定される。

- 学生は tutor で整理し、各機能で深く取り組む
- tutor は機能の中身を直接代替しない（志望理由書本文を書かない / 面接質問を生成しない / 自己PR を完成させない）
- 履歴を持たない、深い文脈を持たない（1 ターン完結）
- 「整理が終わったら自然に画面を閉じて行動に向かう」を成功体験として設計

詳細は [`tutorPrompt.ts`](./tutorPrompt.ts) の `TUTOR_SYSTEM_PROMPT` [A]〜[N] ブロック参照。

---

## 7. 純粋関数原則（全 helper 共通）

各 helper は次を厳守する。

- AI 呼び出ししない
- `fetch` / network 通信しない
- `localStorage` / Supabase / storage helper を読まない
- `Date.now()` / `new Date()` / `Math.random()` を使わない
- `console.*` を使わない
- 副作用（write / log / global mutation）を起こさない
- 同入力に対して同出力を返す（deterministic）

---

## 8. keyword リストの所在

各 helper の keyword は対応ファイル内に const として定義:

- `detectTutorIntent.ts`: STABILIZE / STATEMENT / INTERVIEW / SELF_ANALYSIS / SELFPR
- `detectTutorStabilization.ts`: STABILIZATION（detectTutorIntent stabilize の superset）

文字列マッチは `toLowerCase` 経由で case-insensitive。日本語文字列には影響なし、ASCII 文字（'ES' / 'PR' 等）が case 違いでも一致する。

ASCII 2 文字キーワード（'es' 等）は英文混入で偶発的にマッチする可能性があるが、PASSAI ユーザーの message はほぼ日本語のため許容範囲。SYSTEM PROMPT 側で off-topic redirect が効く。
