# Interview AI — PR10 リリース整理（導線 / quota 確認 / DDL apply / 本番前チェック）

PR1〜PR9 の Interview AI 機能を本番投入する前の最終整理。ハブ導線・旧機能の扱い・quota 表示確認・
DDL apply 手順・本番前チェックリストをまとめる。

関連: [pr0_design](./pr0_design.md) 〜 [pr9_ui](./pr9_ui.md)、
[../supabase/interview_practice_records_post_apply_checklist.md](../supabase/interview_practice_records_post_apply_checklist.md)、
[pr3_schema.md §4](./pr3_schema.md)。

---

## 1. /interview ハブ導線（最終整理）

[app/interview/page.tsx](../../app/interview/page.tsx) の `MENU_ITEMS`（上から）:

| 導線 | 位置づけ | href |
|---|---|---|
| AI面接を受ける（実践） | **主導線**。AI 面接の実践 + フィードバック | `/interview/ai` |
| 予想質問を作る（事前準備） | 準備ツール（AI/対人面接の前に） | `/interview/questions` |
| 対人練習を記録する | 対人練習の手入力記録 | `/interview/record` |
| 過去の記録を見る | 対人 + AI 面接の統合履歴（PR8） | `/interview/history` |

- AI面接を実践の主導線として先頭に配置。文言で「実践 / 事前準備」の役割を明示。
- 履歴は「対人練習とAI面接の記録・改善点をまとめて確認」と統合表示（PR8）を反映。

## 2. 旧「予想質問」機能の扱い

- `/interview/questions`（予想質問生成）は **撤去せず残置**。
- 位置づけを「面接前の事前準備ツール」に整理（タイトル/説明を調整）。AI面接（実践）と競合させず、
  準備 → 実践 → 記録/履歴 の流れに組み込む。
- ルート・API（`interview-questions`）は無変更。quota は既存 `interview` feature のまま
  （AI面接の `interview-ai` とは別計上）。

## 3. quota / 利用回数 UI の確認

- `interview-ai` は quota feature として登録済み（PR4）。free 0 / basic 10 / premium 30。
- **マイページ「今月の利用状況」**（[UsageStatusCard](../../app/mypage/UsageStatusCard.tsx)）:
  - `QUOTA_FEATURES` を動的に flatMap して描画 → `interview-ai` 行が自動表示。
  - ラベル `面接AI`（FEATURE_LABELS）。limit=0（free）/ unlimited は非表示ロジックで除外。
  - basic（10）/ premium（30）で「面接AI used/limit + progress」が自然に並ぶ。
- **quota 超過ダイアログ**（[QuotaExceededDialog](../../components/billing/QuotaExceededDialog.tsx)）: `面接AI` ラベルあり。
- 料金ページ（PricingSection）は機能名のみ列挙（数値 quota 非掲載）のため変更不要。「面接AI」を
  独立掲載するかは製品判断（本リリースでは既存「面接練習」表記に内包）。

---

## 4. DDL apply 手順（前後の確認項目）

Interview AI が追加した table は `supabase/schema.sql` の以下（**未 apply。operator 操作**）:

| § | object | 依存 |
|---|---|---|
| 53–55 | `interview_practice_records`（+trigger+RLS） | 独立（既存記録 mirror） |
| 56–58 | `interview_ai_sessions`（+trigger+部分unique index+RLS） | auth.users / set_updated_at |
| 59–60 | `interview_ai_results`（+RLS EXISTS） | **interview_ai_sessions** を参照 |
| 61–62 | `interview_ai_turns`（+RLS EXISTS） | **interview_ai_sessions** を参照 |

### 4.1 apply 前

```sql
-- 共有関数 / 拡張 / auth.users
SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';        -- 期待: 1
SELECT to_regclass('auth.users');                                    -- 期待: auth.users
-- 未適用確認（4 table すべて NULL 期待）
SELECT to_regclass('public.interview_practice_records'),
       to_regclass('public.interview_ai_sessions'),
       to_regclass('public.interview_ai_results'),
       to_regclass('public.interview_ai_turns');
```

### 4.2 apply 順序（依存順を厳守）

1. `§53–§55` interview_practice_records（独立。順不同可）
2. `§56–§58` **interview_ai_sessions（先）**
3. `§59–§60` interview_ai_results（sessions を参照）
4. `§61–§62` interview_ai_turns（sessions を参照）

> 2 → 3/4 の順を守る（results / turns は sessions の FK + EXISTS policy が sessions を参照する）。

### 4.3 apply 後（構造検証）

```sql
-- 4 table 存在
SELECT to_regclass('public.interview_practice_records'),
       to_regclass('public.interview_ai_sessions'),
       to_regclass('public.interview_ai_results'),
       to_regclass('public.interview_ai_turns');
-- RLS 有効 + policy 本数（practice=4 / sessions=4 / results=4 / turns=4）
SELECT tablename, count(*) FROM pg_policies
WHERE tablename IN ('interview_practice_records','interview_ai_sessions',
                    'interview_ai_results','interview_ai_turns')
GROUP BY tablename;
-- CHECK / 部分 index / unique
SELECT conname FROM pg_constraint
WHERE conrelid='public.interview_ai_sessions'::regclass AND contype IN ('c');     -- source/status
SELECT indexname FROM pg_indexes WHERE indexname='interview_ai_sessions_one_in_progress';
SELECT conname FROM pg_constraint
WHERE conrelid='public.interview_ai_results'::regclass AND contype='u';           -- session_unique
```

各 table 個別の詳細手順:
[interview_practice_records_post_apply_checklist](../supabase/interview_practice_records_post_apply_checklist.md) /
[pr3_schema.md §4](./pr3_schema.md)。

### 4.4 環境変数

| env | 用途 | 本リリース |
|---|---|---|
| `INTERVIEW_AI_STT_PROVIDER` | voice STT プロバイダ | **未設定で可**（text モードのみ動作。voice は stt-unavailable で text 誘導） |

---

## 5. 本番前チェックリスト

### 5.1 DB / インフラ
- [ ] §53–§62 を 4.2 の順で apply、4.3 の構造検証が全 PASS
- [ ] RLS owner-isolation smoke（別ユーザーで session/results/turns が読めない）
- [ ] `interview_ai_sessions_one_in_progress` で 2 件目 in_progress が弾かれる
- [ ] usage_recorded compare-and-set が 1 回のみ true を返す

### 5.2 課金 / quota
- [ ] basic/premium で「面接AI」がマイページ利用状況に表示される
- [ ] text 1 セッション完了で usage_records に `interview-ai`/`ok` が **1 件**
- [ ] 同一セッションで複数ターンでも usage_records は増えない（冪等）
- [ ] 上限到達で session 作成が 402、quota 超過ダイアログに「面接AI」
- [ ] complete / abandon で usage_records が増えない

### 5.3 フロー
- [ ] setup → AI面接 → 回答（text）→ followup → 結果表示
- [ ] in_progress 中に再訪 → 再開ダイアログ → 続きから
- [ ] followup 失敗時に再試行導線（自動遷移しない）
- [ ] voice 選択 + STT 未設定 → text モード誘導
- [ ] 中断（abandon）→ 履歴非表示、再開不可

### 5.4 履歴
- [ ] completed AI 面接が履歴に出る（source='ai_voice' バッジ、対人前提UI非表示）
- [ ] in_progress / abandoned は履歴に出ない
- [ ] 対人記録と AI 面接が practiceDate 降順で結合表示

### 5.5 品質ゲート
- [ ] `tsc --noEmit` exit 0
- [ ] `eslint` exit 0
- [ ] 既存 `feedbackToText` / `parseImprovementSummary` / `InterviewFeedback` 型が無変更

---

## 6. コミット前の最終差分確認

- [ ] `git status` で interview-ai 関連の新規/変更のみ（無関係差分が混ざっていない）
- [ ] schema.sql の差分は §53–§62 の追加 + status 値 `abandoned` 統一のみ
- [ ] quotas.ts は `interview-ai`（QUOTA_FEATURES / QUOTAS / FEATURE_ROUTE_KEYS）追加のみ
- [ ] 新規 route は `app/api/interview-ai/{session,turn,complete,abandon,state}`
- [ ] recordUsage 実呼び出しは [lib/interviewAi/billing.ts] の 1 箇所のみ（grep 確認）
- [ ] docs/interview_ai 配下に PR0〜PR10 のドキュメントが揃っている

> コミットはユーザー承認後。DDL の実 apply は operator 操作。
